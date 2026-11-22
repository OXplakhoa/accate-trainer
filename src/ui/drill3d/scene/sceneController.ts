import * as THREE from 'three';
import type { ScenePhase } from '../contract';
import {
  buildCharacters,
  getLiveCharacterPose,
  lerpCharacterPose,
  PHASE_CHARACTER_POSES,
  type CharacterPoseState,
  type CharactersRig,
} from './buildCharacters';
import { buildRoomAndTable } from './buildRoomAndTable';
import { buildTabletop, type TabletopRig } from './buildTabletop';
import { isHeroDecisionTurn, planSceneMotion, type SceneMotionState } from './motion';
import { disposeObject3DResources, SCENE_COLORS } from './palette';
import { getEffectiveHighlight, getOccupiedRivals } from './snapshot';

export interface CameraPreset {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly baseFov: number;
  readonly minHFov: number;
}

/**
 * Three distinct camera angles per spec:
 * - arrival: horizontal / eye-level establishing shot across the cream room & oval table
 * - decision: fixed elevated diagonal angle with legible board, pot, call, Hero cards & all 3 rival faces
 * - review: shifted reaction diagonal focusing on the rivals' expressions & synced table highlights
 */
export const CAMERA_PRESETS: Record<ScenePhase, CameraPreset> = {
  arrival: {
    position: [0.0, 1.24, 4.3],
    target: [0.0, 0.36, -0.3],
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
  private currentPos = new THREE.Vector3();
  private currentTarget = new THREE.Vector3();
  private currentBaseFov = 38;
  private currentMinHFov = 54;
  private currentPose: CharacterPoseState;

  private activeRafId: number | null = null;
  private resizeRafId: number | null = null;
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
    this.currentPose = resolveTargetPose(initialState);

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

    // Snap immediately to initial phase & pose, then measure & render initial frame once
    this.snapToState(initialState.phase, this.currentPose, false);
    this.measureAndResize(true);

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.disposed) {
          return;
        }
        if (this.resizeRafId !== null) {
          cancelAnimationFrame(this.resizeRafId);
        }
        this.resizeRafId = requestAnimationFrame(() => {
          this.resizeRafId = null;
          if (!this.disposed) {
            this.measureAndResize();
          }
        });
      });
      this.resizeObserver.observe(this.container);
    } else {
      this.resizeObserver = null;
    }
  }

  private setupLights(): void {
    // Low warm ambient bounce so outer room walls fall off into a cosy evening vignette
    const hemiLight = new THREE.HemisphereLight(0xf6e6ce, 0x6b503b, 0.44);
    hemiLight.position.set(0, 6, 0);
    this.scene.add(hemiLight);

    // Warm overhead pendant lamp spotlight forming a distinct bright pool on the table felt
    // (the ONLY shadow-casting light, 1024x1024 map for mobile-friendly performance)
    const tableSpot = new THREE.SpotLight(0xfff0d2, 9.6, 9.5, Math.PI * 0.35, 0.84, 1.5);
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

    // Localized short-range front-table fill so Cá, Cáo and Nóng faces stay crisp and readable
    // without illuminating the far room walls (distance = 5.1 cuts off before walls at z = -4.4)
    const characterFill = new THREE.PointLight(0xffe8c6, 1.48, 5.1, 1.6);
    characterFill.position.set(0, 1.42, 1.12);
    this.scene.add(characterFill);

    // Subtle warm window cross-rim accent for 3D form separation
    const rimFill = new THREE.DirectionalLight(0xffe7c4, 0.26);
    rimFill.position.set(-3.8, 3.2, 1.8);
    this.scene.add(rimFill);
  }

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

  private snapToState(phase: ScenePhase, pose: CharacterPoseState, render = true): void {
    this.cancelTransition();
    const preset = CAMERA_PRESETS[phase];
    this.currentPos.set(preset.position[0], preset.position[1], preset.position[2]);
    this.currentTarget.set(preset.target[0], preset.target[1], preset.target[2]);
    this.currentBaseFov = preset.baseFov;
    this.currentMinHFov = preset.minHFov;
    this.currentPose = pose;
    this.characters.applyPose(this.currentPose);
    this.applyCameraState();
    if (render) {
      this.renderOnce();
    }
  }

  private animateToPhase(phase: ScenePhase, endPose: CharacterPoseState): void {
    this.cancelTransition();

    const startPos = this.currentPos.clone();
    const startTarget = this.currentTarget.clone();
    const startBaseFov = this.currentBaseFov;
    const startMinHFov = this.currentMinHFov;
    const startPose = this.currentPose;

    const preset = CAMERA_PRESETS[phase];
    const endPos = new THREE.Vector3(preset.position[0], preset.position[1], preset.position[2]);
    const endTarget = new THREE.Vector3(preset.target[0], preset.target[1], preset.target[2]);

    const startTime = performance.now();

    const tick = (now: number) => {
      if (this.disposed) {
        this.activeRafId = null;
        return;
      }
      const rawT = Math.min(1, Math.max(0, (now - startTime) / TRANSITION_DURATION_MS));
      const eased = easeOutCubic(rawT);

      this.currentPos.lerpVectors(startPos, endPos, eased);
      this.currentTarget.lerpVectors(startTarget, endTarget, eased);
      this.currentBaseFov = startBaseFov + (preset.baseFov - startBaseFov) * eased;
      this.currentMinHFov = startMinHFov + (preset.minHFov - startMinHFov) * eased;
      this.currentPose = lerpCharacterPose(startPose, endPose, eased);

      this.characters.applyPose(this.currentPose);
      this.applyCameraState();
      this.renderOnce();

      if (rawT < 1) {
        this.activeRafId = requestAnimationFrame(tick);
      } else {
        // Strictly stop rendering once the finite transition finishes
        this.activeRafId = null;
      }
    };

    this.activeRafId = requestAnimationFrame(tick);
  }

  /**
   * Finite pose-only settle when active turn changes while keeping camera locked/decision-stable.
   */
  private animatePoseOnly(endPose: CharacterPoseState): void {
    this.cancelTransition();

    const startPose = this.currentPose;
    const startTime = performance.now();

    const tick = (now: number) => {
      if (this.disposed) {
        this.activeRafId = null;
        return;
      }
      const rawT = Math.min(1, Math.max(0, (now - startTime) / POSE_SETTLE_DURATION_MS));
      const eased = easeOutCubic(rawT);

      this.currentPose = lerpCharacterPose(startPose, endPose, eased);
      this.characters.applyPose(this.currentPose);
      this.renderOnce();

      if (rawT < 1) {
        this.activeRafId = requestAnimationFrame(tick);
      } else {
        // Strictly stop rendering once the finite pose settle finishes
        this.activeRafId = null;
      }
    };

    this.activeRafId = requestAnimationFrame(tick);
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

    const plan = planSceneMotion(this.lastState, state, this.activeRafId !== null);
    this.lastState = state;

    if (plan.kind === 'none' && !plan.needsRender) {
      return;
    }

    this.tabletop.updateSpot(state.spot);
    this.tabletop.updateHighlight(getEffectiveHighlight(state.spot, state.highlight));
    this.characters.setOccupiedRivals(getOccupiedRivals(state.spot));

    const nextPose = resolveTargetPose(state);

    switch (plan.kind) {
      case 'snap':
        this.snapToState(state.phase, nextPose);
        return;
      case 'animate-phase':
        this.animateToPhase(state.phase, nextPose);
        return;
      case 'animate-pose':
        this.animatePoseOnly(nextPose);
        return;
      case 'none':
        // No camera/pose transition running: re-render a single frame for spot/highlight/occupancy change
        if (this.activeRafId === null) {
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
