import type { HandState, Street } from '../../engine';
import type { SandboxSettings, TournamentTimerSeconds } from '../sandbox';

export type TournamentTimerStatus =
  | 'idle'
  | 'waiting-animation'
  | 'running'
  | 'paused'
  | 'timed-out';

export interface TournamentTurnDescriptor {
  readonly turnKey: string;
  readonly dealKey: string;
  readonly sessionSeed: string;
  readonly handNumber: number;
  readonly street: Street;
  readonly dealGeneration?: number;
  readonly durationSeconds: TournamentTimerSeconds;
  readonly hadCancelledDeclaration: boolean;
}

export interface TournamentClockState {
  readonly status: TournamentTimerStatus;
  readonly activeTurn: TournamentTurnDescriptor | null;
  readonly completedDealKey: string | null;
  readonly completedDealGeneration: number | null;
  readonly deadlineMs: number | null;
  readonly remainingMs: number;
  readonly remainingSeconds: number;
  readonly configuredDurationSeconds: TournamentTimerSeconds;
  readonly pendingTimerSeconds: TournamentTimerSeconds | null;
  readonly hasBindingOutOfTurn: boolean;
  readonly lastTickedSecond: number | null;
  readonly timedOutTurnKey: string | null;
  readonly reducedMotion: boolean;
}

export interface TournamentAppProps {
  /** Optional deterministic seed for tests. */
  readonly initialSeed?: string;
  /** Optional initial settings override (merged & sanitized with persisted settings). */
  readonly initialSettings?: Partial<SandboxSettings>;
  /** Optional callback exposed for Control to jump into Drill mode from post-hand review. */
  readonly onPracticeSpot?: (hand: HandState, heroId: string) => void;
  /** Whether Tournament mode is currently visible/active (pauses & cleans timer when hidden). */
  readonly active?: boolean;
  /** Optional ref populated with a synchronous audio-unlock callback for revisit gestures. */
  readonly audioUnlockRef?: { current: (() => boolean) | null };
  /** Optional storage override for testing persistence/fallback. */
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

export interface TournamentTimerWidgetProps {
  readonly clockState: TournamentClockState;
}
