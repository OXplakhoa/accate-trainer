import * as THREE from 'three';
import type { ScenePhase, SceneTableSnapshot } from '../contract';
import {
  buildCharacters,
  getLiveCharacterPose,
  PHASE_CHARACTER_POSES,
  type CharacterPoseState,
  type CharactersRig,
} from './buildCharacters';
import { buildRoomAndTable } from './buildRoomAndTable';
import { buildTabletop, type TabletopRig } from './buildTabletop';
import {
  copyCharacterPose,
  createMutableCharacterPose,
  isHeroDecisionTurn,
  lerpCharacterPoseInto,
  planSceneMotion,
  type MutableCharacterPoseState,
  type SceneMotionState,
} from './motion';
import { disposeObject3DResources, SCENE_COLORS } from './palette';
import { getEffectiveHighlight, getOccupiedRivals } from './snapshot';
import {
  classifyLiveProgress,
  getLiveProgressMark,
  planTableAnimations,
  type LiveProgressMark,
} from './tableMotion';

export interface CameraPreset {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly baseFov: number;
  readonly minHFov: number;
}

/**
 * Three distinct camera angles per spec:
 * - arrival: horizontal / eye-level establishing shot across the cream room & oval table with unoccluded pot
 * - decision: fixed elevated diagonal angle with legible board, pot, call, Hero cards & all 3 rival faces
 * - review: shifted reaction diagonal focusing on the rivals' expressions & synced table highlights
 */
export const CAMERA_PRESETS: Record<ScenePhase, CameraPreset> = {
  arrival: {
    position: [0.0, 1.44, 4.24],
    target: [0.0, 0.3, -0.3],
    baseFov: 38,
    minHFov: 56,
  },
  decision: {
    position: [-0.88, 2.22, 3.48],
    target: [-0.14, 0.12, -0.18],
    baseFov: 38,
    minHFov: 58,
  },
  review: {
    position: [0.96, 1.66, 3.38],
    target: [0.18, 0.26, -0.34],
    baseFov: 37,
    minHFov: 58,
  },
};

export type SceneControllerState = SceneMotionState;

const TRANSITION_DURATION_MS = 360;
const POSE_SETTLE_DURATION_MS = 260;

function easeOutCubic(t: number): number {
  const inv = 1 - t;
  return 1 - inv * inv * inv;
}

function computeAdaptiveFov(baseFov: number, minHFov: number, aspect: number): number {
  if (aspect <= 0 || !Number.isFinite(aspect)) {
    return baseFov;
  }
  const minHRad = THREE.MathUtils.degToRad(minHFov);
  const vRadForMinH = 2 * Math.atan(Math.tan(minHRad / 2) / aspect);
  const vDeg = THREE.MathUtils.radToDeg(vRadForMinH);
  return Math.min(60, Math.max(baseFov, vDeg));
}

function resolveTargetPose(state: SceneControllerState): CharacterPoseState {
  if (state.spot.live) {
    if (state.reducedMotion) {
      return getLiveCharacterPose(null, false, null);
    }
    return getLiveCharacterPose(
      state.spot.live.activeRival,
      isHeroDecisionTurn(state.spot),
      state.spot.live.street,
    );
  }
  return PHASE_CHARACTER_POSES[state.phase];
}

export class DrillSceneController {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly characters: CharactersRig;
  private readonly tabletop: TabletopRig;
  private readonly resizeObserver: ResizeObserver | null;
  private readonly onContextLostCallback: () => void;

  private disposed = false;
  private lastState: SceneControllerState;
  private liveHighWater: LiveProgressMark | null = null;
  private lastAcceptedLiveSpot: SceneTableSnapshot | null = null;

  // Preallocated vectors & pose buffers so animation frames perform zero heap allocations
  private readonly currentPos = new THREE.Vector3();
  private readonly currentTarget = new THREE.Vector3();
  private readonly phaseStartPos = new THREE.Vector3();
  private readonly phaseStartTarget = new THREE.Vector3();
  private readonly phaseEndPos = new THREE.Vector3();
  private readonly phaseEndTarget = new THREE.Vector3();
  private currentBaseFov = 38;
  private currentMinHFov = 54;
  private readonly currentPose: MutableCharacterPoseState;
  private readonly transitionStartPose: MutableCharacterPoseState;
  private readonly transitionEndPose: MutableCharacterPoseState;

  private activeRafId: number | null = null;
  private resizeRafId: number | null = null;
  private activeTransitionKind: 'none' | 'phase' | 'pose' = 'none';
  private transitionStartTime = 0;
  private phaseStartBaseFov = 38;
  private phaseStartMinHFov = 54;
  private phaseEndBaseFov = 38;
  private phaseEndMinHFov = 54;
  private width = 1;
  private height = 1;

  constructor(
    container: HTMLElement,
    initialState: SceneControllerState,
    onContextLost: () => void,
  ) {
    this.container = container;
    this.onContextLostCallback = onContextLost;
    this.lastState = initialState;

    const initialPose = resolveTargetPose(initialState);
    this.currentPose = createMutableCharacterPose(initialPose);
    this.transitionStartPose = createMutableCharacterPose(initialPose);
    this.transitionEndPose = createMutableCharacterPose(initialPose);

    // Renderer setup — throws cleanly if WebGL is disabled so caller can switch to 2D fallback
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;

    const canvas = this.renderer.domElement;
    canvas.className = 'drill3d-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.addEventListener('webglcontextlost', this.handleContextLost, false);
    this.container.appendChild(canvas);

    // Scene & bright warm cream sunlit lighting
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SCENE_COLORS.roomWall);
    this.scene.fog = new THREE.Fog(SCENE_COLORS.roomWall, 10.5, 22);

    this.camera = new THREE.PerspectiveCamera(38, 16 / 10, 0.1, 32);

    this.setupLights();

    const roomAndTable = buildRoomAndTable();
    this.scene.add(roomAndTable);

    this.characters = buildCharacters();
    this.characters.setOccupiedRivals(getOccupiedRivals(initialState.spot));
    this.scene.add(this.characters.root);

    this.tabletop = buildTabletop(initialState.spot);
    this.scene.add(this.tabletop.root);
    this.tabletop.updateHighlight(getEffectiveHighlight(initialState.spot, initialState.highlight));

    // Snap immediately to initial phase & pose
    this.snapCameraAndPose(initialState.phase, initialPose);

    // Track monotonic live progress and play initial deal once if eligible
    let shouldStartInitialDealLoop = false;
    if (initialState.spot.live) {
      const initialPlan = planTableAnimations(null, initialState.spot, initialState.reducedMotion, null);
      this.liveHighWater = initialPlan.highWater ?? getLiveProgressMark(initialState.spot.live);
      this.lastAcceptedLiveSpot = initialState.spot;
      if (
        !initialState.reducedMotion &&
        initialPlan.mode === 'animate' &&
        initialPlan.animations.length > 0
      ) {
        this.tabletop.playAnimations?.(initialPlan.animations, performance.now());
        shouldStartInitialDealLoop = this.tabletop.hasActiveAnimations?.() ?? false;
      }
    }

    this.measureAndResize(true);
    if (shouldStartInitialDealLoop) {
      this.ensureAnimationLoop();
    }

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.disposed) {
          return;
        }
        if (this.resizeRafId !== null) {
          cancelAnimationFrame(this.resizeRafId);
        }
        this.resizeRafId = requestAnimationFrame(this.handleResizeFrame);
      });
      this.resizeObserver.observe(this.container);
    } else {
      this.resizeObserver = null;
    }
  }

  private setupLights(): void {
    // Warm ambient bounce lifted modestly so cabinet woodwork and near rail grain read clearly
    // while outer room edges still fall off into a cosy evening vignette
    const hemiLight = new THREE.HemisphereLight(0xf6e6ce, 0x8e6f54, 0.54);
    hemiLight.position.set(0, 6, 0);
    this.scene.add(hemiLight);

    // Warm overhead pendant lamp spotlight forming a distinct bright pool on the table felt
    // (the ONLY shadow-casting light, 1024x1024 map for mobile-friendly performance)
    const tableSpot = new THREE.SpotLight(0xfff0d2, 10.2, 9.5, Math.PI * 0.35, 0.84, 1.5);
    tableSpot.position.set(0, 2.82, -0.12);
    tableSpot.target.position.set(0, 0, -0.12);
    tableSpot.castShadow = true;
    tableSpot.shadow.mapSize.set(1024, 1024);
    tableSpot.shadow.camera.near = 0.6;
    tableSpot.shadow.camera.far = 7.5;
    tableSpot.shadow.bias = -0.0005;
    tableSpot.shadow.normalBias = 0.022;
    this.scene.add(tableSpot);
    this.scene.add(tableSpot.target);

    // Localized front-table fill positioned low and ahead of the near rail (z = 3.45, distance = 5.65)
    // so the full camera-facing near rail band and rival faces stay crisp without reaching the back wall
    const characterFill = new THREE.PointLight(0xffe8c6, 6.6, 5.65, 1.45);
    characterFill.position.set(0, 0.5, 3.45);
    this.scene.add(characterFill);

    // Localized short-range window-alcove bounce illuminating the tea cabinet woodwork & brass pulls
    const windowFill = new THREE.PointLight(0xffe8c6, 0.95, 3.2, 1.5);
    windowFill.position.set(-3.35, 0.25, -2.55);
    this.scene.add(windowFill);

    // Subtle warm window cross-rim accent for 3D form separation
    const rimFill = new THREE.DirectionalLight(0xffe7c4, 0.3);
    rimFill.position.set(-3.4, 3.0, 2.2);
    this.scene.add(rimFill);
  }

  private readonly handleResizeFrame = (): void => {
    this.resizeRafId = null;
    if (!this.disposed) {
      this.measureAndResize();
    }
  };

  private readonly handleAnimationFrame = (now: number): void => {
    if (this.disposed) {
      this.activeRafId = null;
      return;
    }

    const cameraOrPoseActive = this.stepCameraAndPoseTransition(now);
    const tabletopActive = this.tabletop.stepAnimations?.(now) ?? false;
    this.renderOnce();

    if (cameraOrPoseActive || tabletopActive) {
      this.activeRafId = requestAnimationFrame(this.handleAnimationFrame);
    } else {
      this.activeRafId = null;
    }
  };

  private handleContextLost = (event: Event): void => {
    event.preventDefault();
    if (this.disposed) {
      return;
    }
    this.cancelTransition();
    if (this.resizeRafId !== null) {
      cancelAnimationFrame(this.resizeRafId);
      this.resizeRafId = null;
    }
    this.onContextLostCallback();
  };

  private cancelTransition(): void {
    this.activeTransitionKind = 'none';
    if (this.activeRafId !== null) {
      cancelAnimationFrame(this.activeRafId);
      this.activeRafId = null;
    }
  }

  private applyCameraState(): void {
    const aspect = this.width / Math.max(1, this.height);
    this.camera.aspect = aspect;
    this.camera.fov = computeAdaptiveFov(this.currentBaseFov, this.currentMinHFov, aspect);
    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentTarget);
    this.camera.updateProjectionMatrix();
  }

  private renderOnce(): void {
    if (this.disposed) {
      return;
    }
    this.renderer.render(this.scene, this.camera);
  }

  private snapCameraAndPose(phase: ScenePhase, pose: CharacterPoseState): void {
    this.activeTransitionKind = 'none';
    const preset = CAMERA_PRESETS[phase];
    this.currentPos.set(preset.position[0], preset.position[1], preset.position[2]);
    this.currentTarget.set(preset.target[0], preset.target[1], preset.target[2]);
    this.currentBaseFov = preset.baseFov;
    this.currentMinHFov = preset.minHFov;
    copyCharacterPose(pose, this.currentPose);
    this.characters.applyPose(this.currentPose);
    this.applyCameraState();
  }

  private snapToState(phase: ScenePhase, pose: CharacterPoseState, render = true): void {
    this.cancelTransition();
    this.tabletop.snapAnimations?.();
    this.snapCameraAndPose(phase, pose);
    if (render) {
      this.renderOnce();
    }
  }

  private startPhaseTransition(phase: ScenePhase, endPose: CharacterPoseState): void {
    const preset = CAMERA_PRESETS[phase];
    this.activeTransitionKind = 'phase';
    this.transitionStartTime = performance.now();
    this.phaseStartPos.copy(this.currentPos);
    this.phaseStartTarget.copy(this.currentTarget);
    this.phaseStartBaseFov = this.currentBaseFov;
    this.phaseStartMinHFov = this.currentMinHFov;
    this.phaseEndPos.set(preset.position[0], preset.position[1], preset.position[2]);
    this.phaseEndTarget.set(preset.target[0], preset.target[1], preset.target[2]);
    this.phaseEndBaseFov = preset.baseFov;
    this.phaseEndMinHFov = preset.minHFov;
    copyCharacterPose(this.currentPose, this.transitionStartPose);
    copyCharacterPose(endPose, this.transitionEndPose);
    this.ensureAnimationLoop();
  }

  /**
   * Finite pose-only settle when active turn changes while keeping camera locked/decision-stable.
   */
  private startPoseTransition(endPose: CharacterPoseState): void {
    this.activeTransitionKind = 'pose';
    this.transitionStartTime = performance.now();
    copyCharacterPose(this.currentPose, this.transitionStartPose);
    copyCharacterPose(endPose, this.transitionEndPose);
    this.ensureAnimationLoop();
  }

  private stepCameraAndPoseTransition(now: number): boolean {
    if (this.activeTransitionKind === 'none') {
      return false;
    }

    if (this.activeTransitionKind === 'phase') {
      const rawT = Math.min(1, Math.max(0, (now - this.transitionStartTime) / TRANSITION_DURATION_MS));
      const eased = easeOutCubic(rawT);

      this.currentPos.lerpVectors(this.phaseStartPos, this.phaseEndPos, eased);
      this.currentTarget.lerpVectors(this.phaseStartTarget, this.phaseEndTarget, eased);
      this.currentBaseFov =
        this.phaseStartBaseFov + (this.phaseEndBaseFov - this.phaseStartBaseFov) * eased;
      this.currentMinHFov =
        this.phaseStartMinHFov + (this.phaseEndMinHFov - this.phaseStartMinHFov) * eased;
      lerpCharacterPoseInto(this.transitionStartPose, this.transitionEndPose, eased, this.currentPose);

      this.characters.applyPose(this.currentPose);
      this.applyCameraState();

      if (rawT >= 1) {
        this.activeTransitionKind = 'none';
        return false;
      }
      return true;
    }

    const rawT = Math.min(1, Math.max(0, (now - this.transitionStartTime) / POSE_SETTLE_DURATION_MS));
    const eased = easeOutCubic(rawT);
    lerpCharacterPoseInto(this.transitionStartPose, this.transitionEndPose, eased, this.currentPose);
    this.characters.applyPose(this.currentPose);

    if (rawT >= 1) {
      this.activeTransitionKind = 'none';
      return false;
    }
    return true;
  }

  /**
   * Runs a single unified on-demand rAF loop only while a camera/pose transition
   * or live tabletop animation is active, then stops strictly at completion.
   */
  private ensureAnimationLoop(): void {
    if (this.disposed || this.activeRafId !== null) {
      return;
    }
    this.activeRafId = requestAnimationFrame(this.handleAnimationFrame);
  }

  public measureAndResize(forceRender = false): void {
    if (this.disposed) {
      return;
    }
    const rect = this.container.getBoundingClientRect();
    const nextW = Math.max(1, Math.round(rect.width));
    const nextH = Math.max(1, Math.round(rect.height));
    if (nextW === this.width && nextH === this.height) {
      if (forceRender) {
        this.applyCameraState();
        this.renderOnce();
      }
      return;
    }
    this.width = nextW;
    this.height = nextH;
    this.renderer.setSize(nextW, nextH, false);
    this.applyCameraState();
    this.renderOnce();
  }

  public update(state: SceneControllerState): void {
    if (this.disposed) {
      return;
    }

    const prevState = this.lastState;
    const isAnimating =
      this.activeRafId !== null || (this.tabletop.hasActiveAnimations?.() ?? false);
    const plan = planSceneMotion(prevState, state, isAnimating);

    let tablePlan;
    if (state.spot.live) {
      const relation = classifyLiveProgress(this.liveHighWater, state.spot.live);
      tablePlan = planTableAnimations(
        this.lastAcceptedLiveSpot,
        state.spot,
        state.reducedMotion,
        this.liveHighWater,
      );
      if (relation === 'forward') {
        this.liveHighWater = tablePlan.highWater ?? getLiveProgressMark(state.spot.live);
        this.lastAcceptedLiveSpot = state.spot;
      }
    } else {
      tablePlan = planTableAnimations(prevState.spot, state.spot, state.reducedMotion, null);
      this.liveHighWater = null;
      this.lastAcceptedLiveSpot = null;
    }

    this.lastState = state;

    const shouldPlayTableAnims =
      !state.reducedMotion && tablePlan.mode === 'animate' && tablePlan.animations.length > 0;
    const needsTableSnap =
      state.reducedMotion && (this.tabletop.hasActiveAnimations?.() ?? false);

    if (plan.kind === 'none' && !plan.needsRender && !shouldPlayTableAnims && !needsTableSnap) {
      return;
    }

    if (tablePlan.mode === 'snap' || shouldPlayTableAnims || state.reducedMotion) {
      this.tabletop.snapAnimations?.();
    }

    this.tabletop.updateSpot(state.spot);
    this.tabletop.updateHighlight(getEffectiveHighlight(state.spot, state.highlight));
    this.characters.setOccupiedRivals(getOccupiedRivals(state.spot));

    if (shouldPlayTableAnims) {
      this.tabletop.playAnimations?.(tablePlan.animations, performance.now());
    }

    const nextPose = resolveTargetPose(state);
    const tabletopActive = this.tabletop.hasActiveAnimations?.() ?? false;

    switch (plan.kind) {
      case 'snap':
        if (state.reducedMotion || !tabletopActive) {
          this.snapToState(state.phase, nextPose);
        } else {
          this.snapCameraAndPose(state.phase, nextPose);
          this.renderOnce();
          this.ensureAnimationLoop();
        }
        return;
      case 'animate-phase':
        this.startPhaseTransition(state.phase, nextPose);
        return;
      case 'animate-pose':
        this.startPoseTransition(nextPose);
        return;
      case 'none':
        if (tabletopActive) {
          this.renderOnce();
          this.ensureAnimationLoop();
        } else if (this.activeRafId === null) {
          this.renderOnce();
        }
        return;
    }
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.cancelTransition();
    this.tabletop.snapAnimations?.();

    if (this.resizeRafId !== null) {
      cancelAnimationFrame(this.resizeRafId);
      this.resizeRafId = null;
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    const canvas = this.renderer.domElement;
    canvas.removeEventListener('webglcontextlost', this.handleContextLost, false);

    disposeObject3DResources(this.scene);
    this.renderer.dispose();

    if (canvas.parentNode === this.container) {
      this.container.removeChild(canvas);
    }
  }
}

export interface ManagedSceneController {
  update(state: SceneControllerState): void;
  dispose(): void;
}

export function disposeManagedController(
  controllerRef: { current: ManagedSceneController | null },
): boolean {
  const active = controllerRef.current;
  if (!active) {
    return false;
  }
  controllerRef.current = null;
  active.dispose();
  return true;
}

export function createManagedSceneController(options: {
  container: HTMLElement;
  controllerRef: { current: ManagedSceneController | null };
  initialState: SceneControllerState;
  isCancelled: () => boolean;
  onWebglFailed: () => void;
  createController?: (
    container: HTMLElement,
    initialState: SceneControllerState,
    onContextLost: () => void,
  ) => ManagedSceneController;
}): void {
  if (options.isCancelled()) {
    return;
  }

  let failedDuringInit = false;
  const factory =
    options.createController ??
    ((el, state, onContextLost) => new DrillSceneController(el, state, onContextLost));

  try {
    const created = factory(options.container, options.initialState, () => {
      failedDuringInit = true;
      if (!options.isCancelled()) {
        disposeManagedController(options.controllerRef);
        options.onWebglFailed();
      }
    });

    if (options.isCancelled() || failedDuringInit) {
      if (options.controllerRef.current === created) {
        options.controllerRef.current = null;
      }
      created.dispose();
      return;
    }

    options.controllerRef.current = created;
  } catch {
    if (!options.isCancelled()) {
      disposeManagedController(options.controllerRef);
      options.onWebglFailed();
    }
  }
}
