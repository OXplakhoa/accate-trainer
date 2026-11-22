import { DENOMINATIONS } from '../../../engine';
import type {
  LessonHighlight,
  LiveSceneDetails,
  ScenePhase,
  SceneRival,
  SceneTableSnapshot,
} from '../contract';
import { getEffectiveHighlight } from './snapshot';

export interface CharacterPoseState {
  readonly caHeadRotY: number;
  readonly caHeadRotX: number;
  readonly caLean: number;
  readonly caLidOffset: number;
  readonly caoHeadRotY: number;
  readonly caoHeadRotX: number;
  readonly caoLean: number;
  readonly caoBrowLift: number;
  readonly nongHeadRotY: number;
  readonly nongHeadRotX: number;
  readonly nongLean: number;
  readonly nongLidTilt: number;
  readonly nongSteamScale: number;
  readonly nongBrowTilt: number;
}

export const PHASE_CHARACTER_POSES: Record<ScenePhase, CharacterPoseState> = {
  arrival: {
    caHeadRotY: 0.06,
    caHeadRotX: -0.02,
    caLean: 0,
    caLidOffset: 0.0,
    caoHeadRotY: -0.05,
    caoHeadRotX: 0.03,
    caoLean: 0,
    caoBrowLift: 0.0,
    nongHeadRotY: -0.05,
    nongHeadRotX: 0.02,
    nongLean: 0,
    nongLidTilt: 0.02,
    nongSteamScale: 0.65,
    nongBrowTilt: 0.16,
  },
  decision: {
    caHeadRotY: 0.14,
    caHeadRotX: 0.08,
    caLean: 0,
    caLidOffset: -0.01,
    caoHeadRotY: 0.02,
    caoHeadRotX: 0.09,
    caoLean: 0,
    caoBrowLift: -0.012,
    nongHeadRotY: -0.1,
    nongHeadRotX: 0.08,
    nongLean: 0,
    nongLidTilt: 0.08,
    nongSteamScale: 1.0,
    nongBrowTilt: 0.3,
  },
  review: {
    caHeadRotY: 0.22,
    caHeadRotX: -0.05,
    caLean: 0,
    caLidOffset: 0.024,
    caoHeadRotY: -0.14,
    caoHeadRotX: -0.04,
    caoLean: 0,
    caoBrowLift: 0.026,
    nongHeadRotY: -0.16,
    nongHeadRotX: -0.06,
    nongLean: 0,
    nongLidTilt: 0.28,
    nongSteamScale: 1.45,
    nongBrowTilt: -0.12,
  },
};

const LIVE_NEUTRAL_EXPRESSION = {
  caLidOffset: 0.0,
  caoBrowLift: 0.0,
  nongLidTilt: 0.04,
  nongSteamScale: 0.78,
  nongBrowTilt: 0.18,
} as const;

const STREET_BOARD_PITCH: Record<NonNullable<LiveSceneDetails['street']>, number> = {
  preflop: 0,
  flop: 0.02,
  turn: 0.03,
  river: 0.04,
};

/**
 * Live-mode character posture based strictly on public turn order and street (no inferred tells).
 * The active rival leans subtly forward toward the table while other occupied rivals
 * turn their gaze toward the active seat. When Hero is deciding, posture is fixed and still.
 */
export function getLiveCharacterPose(
  activeRival: SceneRival | null,
  heroActive: boolean,
  street: LiveSceneDetails['street'] = null,
): CharacterPoseState {
  const boardPitch = street ? STREET_BOARD_PITCH[street] : 0;

  if (activeRival === 'ca') {
    return {
      ...LIVE_NEUTRAL_EXPRESSION,
      caHeadRotY: 0.08,
      caHeadRotX: 0.1 + boardPitch,
      caLean: 0.095,
      caoHeadRotY: -0.34,
      caoHeadRotX: 0.03 + boardPitch,
      caoLean: 0,
      nongHeadRotY: -0.26,
      nongHeadRotX: 0.03 + boardPitch,
      nongLean: 0,
    };
  }
  if (activeRival === 'cao') {
    return {
      ...LIVE_NEUTRAL_EXPRESSION,
      caHeadRotY: 0.34,
      caHeadRotX: 0.02 + boardPitch,
      caLean: 0,
      caoHeadRotY: 0.0,
      caoHeadRotX: 0.11 + boardPitch,
      caoLean: 0.095,
      nongHeadRotY: -0.34,
      nongHeadRotX: 0.02 + boardPitch,
      nongLean: 0,
    };
  }
  if (activeRival === 'nong') {
    return {
      ...LIVE_NEUTRAL_EXPRESSION,
      caHeadRotY: 0.26,
      caHeadRotX: 0.03 + boardPitch,
      caLean: 0,
      caoHeadRotY: 0.34,
      caoHeadRotX: 0.03 + boardPitch,
      caoLean: 0,
      nongHeadRotY: -0.08,
      nongHeadRotX: 0.1 + boardPitch,
      nongLean: 0.095,
    };
  }
  if (heroActive) {
    return {
      ...LIVE_NEUTRAL_EXPRESSION,
      caHeadRotY: -0.18,
      caHeadRotX: 0.05,
      caLean: 0,
      caoHeadRotY: 0.0,
      caoHeadRotX: 0.06,
      caoLean: 0,
      nongHeadRotY: 0.18,
      nongHeadRotX: 0.05,
      nongLean: 0,
    };
  }
  return {
    ...LIVE_NEUTRAL_EXPRESSION,
    caHeadRotY: 0.06,
    caHeadRotX: 0.01,
    caLean: 0,
    caoHeadRotY: 0.0,
    caoHeadRotX: 0.02,
    caoLean: 0,
    nongHeadRotY: -0.06,
    nongHeadRotX: 0.01,
    nongLean: 0,
  };
}

export function lerpCharacterPose(
  from: CharacterPoseState,
  to: CharacterPoseState,
  t: number,
): CharacterPoseState {
  const l = (a: number, b: number) => a + (b - a) * t;
  return {
    caHeadRotY: l(from.caHeadRotY, to.caHeadRotY),
    caHeadRotX: l(from.caHeadRotX, to.caHeadRotX),
    caLean: l(from.caLean, to.caLean),
    caLidOffset: l(from.caLidOffset, to.caLidOffset),
    caoHeadRotY: l(from.caoHeadRotY, to.caoHeadRotY),
    caoHeadRotX: l(from.caoHeadRotX, to.caoHeadRotX),
    caoLean: l(from.caoLean, to.caoLean),
    caoBrowLift: l(from.caoBrowLift, to.caoBrowLift),
    nongHeadRotY: l(from.nongHeadRotY, to.nongHeadRotY),
    nongHeadRotX: l(from.nongHeadRotX, to.nongHeadRotX),
    nongLean: l(from.nongLean, to.nongLean),
    nongLidTilt: l(from.nongLidTilt, to.nongLidTilt),
    nongSteamScale: l(from.nongSteamScale, to.nongSteamScale),
    nongBrowTilt: l(from.nongBrowTilt, to.nongBrowTilt),
  };
}

export interface SceneMotionState {
  readonly phase: ScenePhase;
  readonly highlight: LessonHighlight;
  readonly spot: SceneTableSnapshot;
  readonly reducedMotion: boolean;
}

export type SceneMotionKind = 'none' | 'snap' | 'animate-phase' | 'animate-pose';

export interface SceneMotionPlan {
  readonly kind: SceneMotionKind;
  readonly shouldAnimate: boolean;
  readonly cameraChanges: boolean;
  readonly poseChanges: boolean;
  readonly needsRender: boolean;
  readonly poseKey: string;
  readonly visualKey: string;
}

/**
 * True when the live table is waiting on Hero's decision (no rival is active,
 * and a public active turn belongs to Hero).
 */
export function isHeroDecisionTurn(spot: SceneTableSnapshot): boolean {
  return (
    spot.live !== undefined &&
    spot.live.activeRival === null &&
    spot.live.activePlayerName !== null
  );
}

/**
 * Deterministic key identifying the target character pose.
 * - Live + reducedMotion: locked to neutral pose (zero turn-driven movement).
 * - Live + Hero deciding: locked to Hero-watching pose regardless of street.
 * - Live + active rival: keyed by public activeRival and street.
 * - Drill: keyed by Drill phase.
 */
export function getCharacterPoseKey(state: SceneMotionState): string {
  const live = state.spot.live;
  if (!live) {
    return `drill:${state.phase}`;
  }
  if (state.reducedMotion) {
    return 'live:reduced-neutral';
  }
  if (isHeroDecisionTurn(state.spot)) {
    return 'live:hero';
  }
  if (live.activeRival !== null) {
    return `live:rival:${live.activeRival}:${live.street ?? 'idle'}`;
  }
  return 'live:idle';
}

/**
 * Deterministic visual key used for on-demand rendering.
 * When unchanged and no transition is running, the renderer does not need a frame.
 */
export function getSceneVisualKey(state: SceneMotionState): string {
  const effectiveHighlight = getEffectiveHighlight(state.spot, state.highlight) ?? 'none';
  const base = [
    state.phase,
    effectiveHighlight,
    String(state.spot.pot),
    String(state.spot.call),
    state.spot.heroCards.join(','),
    state.spot.board.join(','),
  ];

  const live = state.spot.live;
  if (!live) {
    return `drill|${base.join('|')}`;
  }

  return [
    'live',
    ...base,
    DENOMINATIONS.map(d => live.potChips[d]).join(','),
    live.street ?? 'idle',
    live.occupiedRivals.join(','),
    live.activeRival ?? 'none',
    live.activePlayerName ?? 'none',
    state.reducedMotion ? 'rm' : 'motion',
  ].join('|');
}

/**
 * Pure transition planner deciding camera movement, character pose motion,
 * and whether a WebGL frame render is needed.
 */
export function planSceneMotion(
  prev: SceneMotionState,
  next: SceneMotionState,
  isAnimating = false,
): SceneMotionPlan {
  const prevVisualKey = getSceneVisualKey(prev);
  const nextVisualKey = getSceneVisualKey(next);
  const visualChanged = prevVisualKey !== nextVisualKey;

  const prevPoseKey = getCharacterPoseKey(prev);
  const nextPoseKey = getCharacterPoseKey(next);
  const cameraChanges = prev.phase !== next.phase;
  const poseChanges = prevPoseKey !== nextPoseKey;

  if (cameraChanges) {
    // Instantaneous cut when entering decision OR when reducedMotion is enabled
    if (next.reducedMotion || next.phase === 'decision') {
      return {
        kind: 'snap',
        shouldAnimate: false,
        cameraChanges: true,
        poseChanges: true,
        needsRender: true,
        poseKey: nextPoseKey,
        visualKey: nextVisualKey,
      };
    }
    return {
      kind: 'animate-phase',
      shouldAnimate: true,
      cameraChanges: true,
      poseChanges: true,
      needsRender: true,
      poseKey: nextPoseKey,
      visualKey: nextVisualKey,
    };
  }

  if (poseChanges) {
    // Reduced motion has no animation; entering Hero's decision snaps immediately so
    // camera and characters remain completely still while Hero decides.
    if (next.reducedMotion || isHeroDecisionTurn(next.spot)) {
      return {
        kind: 'snap',
        shouldAnimate: false,
        cameraChanges: false,
        poseChanges: true,
        needsRender: true,
        poseKey: nextPoseKey,
        visualKey: nextVisualKey,
      };
    }
    return {
      kind: 'animate-pose',
      shouldAnimate: true,
      cameraChanges: false,
      poseChanges: true,
      needsRender: true,
      poseKey: nextPoseKey,
      visualKey: nextVisualKey,
    };
  }

  // If reducedMotion turned on mid-transition, cancel immediately and snap to target
  if (next.reducedMotion && isAnimating) {
    return {
      kind: 'snap',
      shouldAnimate: false,
      cameraChanges: false,
      poseChanges: false,
      needsRender: true,
      poseKey: nextPoseKey,
      visualKey: nextVisualKey,
    };
  }

  return {
    kind: 'none',
    shouldAnimate: false,
    cameraChanges: false,
    poseChanges: false,
    needsRender: visualChanged,
    poseKey: nextPoseKey,
    visualKey: nextVisualKey,
  };
}
