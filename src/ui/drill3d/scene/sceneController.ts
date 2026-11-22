import * as THREE from 'three';
import type { LessonHighlight, ScenePhase, SceneTableSnapshot } from '../contract';
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

export interface SceneControllerState {
  readonly phase: ScenePhase;
  readonly highlight: LessonHighlight;
  readonly spot: SceneTableSnapshot;
  readonly reducedMotion: boolean;
}

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
    return getLiveCharacterPose(
      state.spot.live.activeRival,
      state.spot.live.activePlayerName !== null,
    );
  }
  return PHASE_CHARACTER_POSES[state.phase];
}

function resolvePoseKey(state: SceneControllerState): string {
  if (state.spot.live) {
    const heroFlag = state.spot.live.activePlayerName !== null ? 'turn' : 'idle';
    return `live:${state.spot.live.activeRival ?? 'none'}:${heroFlag}`;
  }
  return `drill:${state.phase}`;
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
  private currentPhase: ScenePhase;
  private currentPos = new THREE.Vector3();
  private currentTarget = new THREE.Vector3();
  private currentBaseFov = 38;
  private currentMinHFov = 54;
  private currentPose: CharacterPoseState;
  private targetPose: CharacterPoseState;
  private currentPoseKey: string;

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
    this.currentPhase = initialState.phase;
    this.currentPose = resolveTargetPose(initialState);
    this.targetPose = this.currentPose;
    this.currentPoseKey = resolvePoseKey(initialState);

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
    this.snapToState(initialState.phase, this.targetPose, this.currentPoseKey);

    // Measure & render initial frame
    this.measureAndResize();

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
    // Soft bright warm cream room ambient bounce
    const hemiLight = new THREE.HemisphereLight(0xfff9ee, 0xcab08d, 1.38);
    hemiLight.position.set(0, 6, 0);
    this.scene.add(hemiLight);

    // Warm sunlit key light streaming from the left-front window side
    const keyLight = new THREE.DirectionalLight(0xfff5e2, 1.55);
    keyLight.position.set(-4.2, 5.4, 3.2);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 15;
    keyLight.shadow.camera.left = -4.0;
    keyLight.shadow.camera.right = 4.0;
    keyLight.shadow.camera.top = 3.6;
    keyLight.shadow.camera.bottom = -3.6;
    keyLight.shadow.bias = -0.0007;
    keyLight.shadow.normalBias = 0.025;
    this.scene.add(keyLight);

    // Gentle right-side fill light so Nóng's kettle head & Cáo's face never go muddy
    const fillLight = new THREE.DirectionalLight(0xf6ead7, 0.62);
    fillLight.position.set(4.5, 3.0, 2.2);
    this.scene.add(fillLight);

    // Warm overhead table pendant pool accent
    const tablePool = new THREE.PointLight(0xffefc9, 1.3, 8.5, 1.6);
    tablePool.position.set(0, 2.55, -0.1);
    this.scene.add(tablePool);
  }

  private handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.cancelTransition();
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

  private snapToState(phase: ScenePhase, pose: CharacterPoseState, poseKey: string): void {
    this.cancelTransition();
    const preset = CAMERA_PRESETS[phase];
    this.currentPhase = phase;
    this.currentPos.set(preset.position[0], preset.position[1], preset.position[2]);
    this.currentTarget.set(preset.target[0], preset.target[1], preset.target[2]);
    this.currentBaseFov = preset.baseFov;
    this.currentMinHFov = preset.minHFov;
    this.currentPose = pose;
    this.targetPose = pose;
    this.currentPoseKey = poseKey;
    this.characters.applyPose(this.currentPose);
    this.applyCameraState();
    this.renderOnce();
  }

  private animateToPhase(phase: ScenePhase, endPose: CharacterPoseState, poseKey: string): void {
    this.cancelTransition();

    const startPos = this.currentPos.clone();
    const startTarget = this.currentTarget.clone();
    const startBaseFov = this.currentBaseFov;
    const startMinHFov = this.currentMinHFov;
    const startPose = this.currentPose;

    const preset = CAMERA_PRESETS[phase];
    const endPos = new THREE.Vector3(preset.position[0], preset.position[1], preset.position[2]);
    const endTarget = new THREE.Vector3(preset.target[0], preset.target[1], preset.target[2]);
    this.currentPhase = phase;
    this.targetPose = endPose;
    this.currentPoseKey = poseKey;

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
  private animatePoseOnly(endPose: CharacterPoseState, poseKey: string): void {
    this.cancelTransition();

    const startPose = this.currentPose;
    this.targetPose = endPose;
    this.currentPoseKey = poseKey;

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

  public measureAndResize(): void {
    if (this.disposed) {
      return;
    }
    const rect = this.container.getBoundingClientRect();
    const nextW = Math.max(1, Math.round(rect.width));
    const nextH = Math.max(1, Math.round(rect.height));
    if (nextW === this.width && nextH === this.height) {
      this.renderOnce();
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

    this.tabletop.updateSpot(state.spot);
    this.tabletop.updateHighlight(getEffectiveHighlight(state.spot, state.highlight));
    this.characters.setOccupiedRivals(getOccupiedRivals(state.spot));

    const nextPoseKey = resolvePoseKey(state);
    const nextPose = resolveTargetPose(state);

    if (state.phase !== this.currentPhase) {
      // Instantaneous cut when entering decision OR when reducedMotion is enabled
      if (state.phase === 'decision' || state.reducedMotion) {
        this.snapToState(state.phase, nextPose, nextPoseKey);
      } else {
        this.animateToPhase(state.phase, nextPose, nextPoseKey);
      }
      return;
    }

    if (nextPoseKey !== this.currentPoseKey) {
      // Keep camera locked on decision while characters settle smoothly (or snap on reducedMotion)
      if (state.reducedMotion) {
        this.cancelTransition();
        this.currentPose = nextPose;
        this.targetPose = nextPose;
        this.currentPoseKey = nextPoseKey;
        this.characters.applyPose(this.currentPose);
        this.renderOnce();
      } else {
        this.animatePoseOnly(nextPose, nextPoseKey);
      }
      return;
    }

    // If reducedMotion turned on mid-transition, snap cleanly to target
    if (state.reducedMotion && this.activeRafId !== null) {
      this.snapToState(this.currentPhase, this.targetPose, this.currentPoseKey);
      return;
    }

    // No camera/pose transition running: re-render a single frame for spot/highlight/occupancy change
    if (this.activeRafId === null) {
      this.renderOnce();
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

    if (canvas.parentElement === this.container) {
      this.container.removeChild(canvas);
    }
  }
}
