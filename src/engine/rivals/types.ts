import type { Card } from '../cards';
import type { ChipCounts } from '../chips';
import type {
  BettingAction,
  ExchangeTarget,
  HandConfig,
  LegalActions,
  OutOfTurnCancelReason,
  OutOfTurnDeclaration,
  PlayerStatus,
  Street,
} from '../handTypes';
import type { RecipientAmount } from '../pots';
import type { Rng } from '../rng';

export const RIVAL_IDS = [
  'da',
  'ca',
  'cao',
  'soi',
  'dien',
  'dai-gia',
  'tho',
  'bay',
  'nong',
] as const;

export type RivalId = (typeof RIVAL_IDS)[number];

/**
 * Vietnamese user-facing display strings for a rival character (spec §4.1, §4.1.1, B3).
 * Kept strictly separate from numerical behavior parameters.
 */
export interface RivalDisplayInfo {
  readonly id: RivalId;
  readonly name: string;
  readonly styleLabel: string;
  readonly styleTagVi: string;
  readonly summaryVi: string;
  readonly normalStyleLabel?: string;
  readonly tiltStyleLabel?: string;
  readonly tiltSummaryVi?: string;
}

/**
 * Pure numerical behavior parameters for a rival profile (spec §4.1, §4.1.1).
 * Kept separate from Vietnamese display strings so behavior can be tuned independently.
 */
export interface RivalBehaviorParams {
  /** Minimum effective hand strength to continue when facing a normal bet. */
  readonly continueThreshold: number;
  /** Minimum effective hand strength to bet or raise for value. */
  readonly valueThreshold: number;
  /** Minimum made/effective hand strength considered a strong hand. */
  readonly strongThreshold: number;
  /** Base probability of choosing an aggressive action (bet/raise) when continuing. */
  readonly aggressionFreq: number;
  /** Probability of raising when facing a bet with a playable/strong hand. */
  readonly raiseVsBetFreq: number;
  /** Probability of bluffing (betting or raising) with a weak hand. */
  readonly bluffFreq: number;
  /** Multiplier applied to draw strength when evaluating continuation and semi-bluffs. */
  readonly drawContinueBoost: number;
  /** Minimum hand strength required to comfortably continue when facing a raise. */
  readonly foldToRaiseThreshold: number;
  /** Probability of folding a hand below `foldToRaiseThreshold` when facing a raise. */
  readonly foldToRaiseFreq: number;
  /** Probability of slowplaying (checking a strong hand when currentBet === 0). */
  readonly slowplayFreq: number;
  /** Probability of check-raising when facing a bet after checking earlier on the same street. */
  readonly checkRaiseFreq: number;
  /** Probability of declaring an out-of-turn action when eligible (§3.4, D39). */
  readonly outOfTurnFreq: number;
  /** Target sizing as a fraction of the remaining street cap in (0, 1]. */
  readonly preferredSizingCapRatio: number;
}

export interface RivalProfile {
  readonly id: RivalId;
  readonly display: RivalDisplayInfo;
  readonly behavior: RivalBehaviorParams;
  /** Only present for `nong` (Tilter), overriding `behavior` while tilted (§4.1.1, D45). */
  readonly tiltBehavior?: RivalBehaviorParams;
}

export type NongTiltTriggerReason = 'big-pot-loss' | 'turn-bad-beat';

export interface NongTiltState {
  readonly isTilted: boolean;
  readonly handsRemaining: number;
  readonly totalTiltDuration: number;
  readonly triggerReason: NongTiltTriggerReason | null;
}

/**
 * Public metadata exposed for a seated rival so the UI can always render their playing style
 * and Nóng's public tilt status on the seat (spec §4.1, §4.1.1, D30, B3, B5).
 */
export interface RivalSeatMetadata {
  readonly rivalId: RivalId;
  readonly name: string;
  readonly styleLabel: string;
  readonly styleTagVi: string;
  readonly styleSummaryVi: string;
  readonly isTilted: boolean;
  readonly publicMood: 'normal' | 'tilted';
  readonly tiltHandsRemaining: number;
  readonly publicStatusLabelVi: string;
}

export interface SelectRivalsInput {
  readonly rng: Rng;
  /** Count of rival seats needed (1..9). If omitted, derived from `totalPlayers - 1` or `seatIndices.length`. */
  readonly rivalCount?: number;
  /** Total players at table including hero (4..10). Used when `rivalCount` is omitted. */
  readonly totalPlayers?: number;
  /** Physical seat indices to assign rivals to. */
  readonly seatIndices?: readonly number[];
  /** Hero's physical seat index when deriving rival seats from `totalPlayers` (defaults to 0). */
  readonly heroSeatIndex?: number;
  /** Pool of enabled rival IDs from Settings (defaults to all 9 `RIVAL_IDS`). */
  readonly enabledRivalIds?: readonly RivalId[];
  /** Optional tilt state for Nóng to reflect in returned seat metadata. */
  readonly nongTiltState?: NongTiltState;
}

export interface RivalSeatAssignment {
  readonly seatIndex: number;
  readonly rivalId: RivalId;
  readonly metadata: RivalSeatMetadata;
}

export type SelectRivalsErrorCode =
  | 'invalid-rival-id'
  | 'duplicate-rival-id-in-pool'
  | 'invalid-seat-count'
  | 'invalid-seat-indices'
  | 'insufficient-rival-pool';

export type SelectRivalsResult =
  | {
      readonly ok: true;
      readonly rivalIds: readonly RivalId[];
      readonly assignments: readonly RivalSeatAssignment[];
    }
  | {
      readonly ok: false;
      readonly code: SelectRivalsErrorCode;
      readonly message: string;
    };

/**
 * Public view of a seat during a hand. Explicitly excludes `holeCards` and internal bookkeeping.
 */
export interface PublicSeatView {
  readonly seatIndex: number;
  readonly playerId: string;
  readonly stack: ChipCounts;
  readonly status: PlayerStatus;
  readonly streetContribution: number;
  readonly totalContribution: number;
  readonly hasActedThisStreet: boolean;
  readonly declaration: OutOfTurnDeclaration | null;
  readonly cancelledDeclarationThisStreet: boolean;
}

/**
 * Sanitized public timeline events visible during a hand (excludes showdown/hidden card resolutions).
 */
export type PublicTimelineEvent =
  | {
      readonly type: 'ante-collected';
      readonly antePerPlayer: number;
      readonly playerIds: readonly string[];
      readonly allInPlayerIds: readonly string[];
    }
  | {
      readonly type: 'cards-dealt';
      readonly dealerPlayerId: string;
      readonly openerPlayerId: string;
      readonly playerIds: readonly string[];
    }
  | {
      readonly type: 'street-dealt';
      readonly street: Exclude<Street, 'preflop'>;
      readonly cards: readonly Card[];
    }
  | {
      readonly type: 'out-of-turn-declared';
      readonly street: Street;
      readonly playerId: string;
      readonly action: BettingAction;
      readonly declaredAtCurrentBet: number;
      readonly reservedChips: ChipCounts;
    }
  | {
      readonly type: 'out-of-turn-cancelled';
      readonly street: Street;
      readonly playerId: string;
      readonly action: BettingAction;
      readonly reason: OutOfTurnCancelReason;
      readonly triggeredByPlayerId?: string;
      readonly returnedChips: ChipCounts;
    }
  | {
      readonly type: 'player-action';
      readonly street: Street;
      readonly playerId: string;
      readonly action: BettingAction;
      readonly addedAmount: number;
      readonly newStreetContribution: number;
      readonly newCurrentBet: number;
      readonly isAllIn: boolean;
      readonly fromOutOfTurn: boolean;
    }
  | {
      readonly type: 'chip-exchange';
      readonly street: Street | null;
      readonly fromPlayerId: string;
      readonly target: ExchangeTarget;
      readonly give: ChipCounts;
      readonly receive: ChipCounts;
    }
  | {
      readonly type: 'uncalled-refund';
      readonly street: Street;
      readonly playerId: string;
      readonly amount: number;
      readonly chips: ChipCounts;
    };

/**
 * Strict boundary DTO passed into rival decision functions (spec §4.2, D42, O7, B1).
 * Contains ONLY the rival's own 2 hole cards, revealed board cards, public seats,
 * public timeline (including out-of-turn declarations), pot, turn/position, cap, and legal actions.
 */
export interface RivalDecisionInput {
  readonly rivalId: RivalId;
  readonly playerId: string;
  readonly holeCards: readonly [Card, Card];
  readonly board: readonly Card[];
  readonly street: Street;
  readonly streetCap: number;
  readonly currentBet: number;
  readonly pot: ChipCounts;
  readonly activePlayerId: string | null;
  readonly openerPlayerId: string;
  readonly dealerPlayerId: string;
  readonly isMyTurn: boolean;
  readonly allowOutOfTurn: boolean;
  readonly config: Pick<
    HandConfig,
    'enablePreflopBetting' | 'preflopCap' | 'allowOutOfTurn' | 'dealerIndex'
  >;
  readonly publicSeats: readonly PublicSeatView[];
  readonly publicTimeline: readonly PublicTimelineEvent[];
  readonly legalActions: LegalActions | null;
  readonly tiltState?: NongTiltState;
}

export interface RivalValidationResult {
  readonly ok: boolean;
  readonly reason?: string;
}

export interface RivalDecisionResult {
  readonly action: BettingAction;
  readonly rivalId: RivalId;
  readonly styleLabel: string;
  readonly personalityTagVi: string;
  readonly reasoningVi: string;
  readonly isTilted: boolean;
  readonly madeStrength: number;
  readonly drawStrength: number;
  readonly effectiveStrength: number;
  readonly usedFallbackForMissingDenominations: boolean;
}

export interface RivalOutOfTurnDecisionResult {
  readonly action: BettingAction | null;
  readonly rivalId: RivalId;
  readonly styleLabel: string;
  readonly personalityTagVi: string;
  readonly reasoningVi: string;
  readonly isTilted: boolean;
}

/**
 * Quantitative range combo format consumed by Calculator (P2a) and Drill feedback (§5, §6.1).
 */
export interface WeightedCombo {
  readonly cards: readonly [Card, Card];
  readonly weight: number;
}

export interface PublicActionDescriptor {
  readonly type: BettingAction['type'];
  readonly amount?: number;
  readonly raiseTo?: number;
  readonly fromOutOfTurn?: boolean;
  readonly isCheckRaise?: boolean;
}

export interface RangeAssumptionContext {
  readonly opponentCount?: number;
  readonly stackValue?: number;
  readonly potValue?: number;
  readonly positionLabelVi?: string;
  readonly streetCap?: number;
}

export interface EstimateRivalRangeInput {
  readonly rivalId: RivalId;
  readonly board: readonly Card[];
  readonly street?: Street;
  readonly streetCap?: number;
  readonly action?: PublicActionDescriptor;
  readonly publicTimeline?: readonly PublicTimelineEvent[];
  readonly playerId?: string;
  readonly tiltState?: NongTiltState;
  readonly blockers?: readonly Card[];
  readonly context?: RangeAssumptionContext;
}

export interface RivalRangeEstimate {
  readonly rivalId: RivalId;
  readonly name: string;
  readonly styleLabel: string;
  readonly isTilted: boolean;
  readonly street: Street;
  readonly combos: readonly WeightedCombo[];
  readonly descriptionVi: string;
  readonly assumptionsVi: readonly string[];
}

export interface PublicShowdownPotSummary {
  readonly potIndex: number;
  readonly potAmount: number;
  readonly eligiblePlayerIds: readonly string[];
  readonly tiedTopPlayerIds: readonly string[];
  readonly awards: readonly RecipientAmount[];
}

/**
 * Public hand result summary extracted at the between-hands boundary for Nóng tilt evaluation (B5–B7).
 * Only includes hole cards of players who actually revealed their cards at showdown.
 */
export interface PublicHandResultSummary {
  readonly seatedPlayerIds: readonly string[];
  readonly outcomeKind: 'fold-win' | 'showdown';
  readonly board: readonly Card[];
  readonly revealedShowdownCards: Readonly<Record<string, readonly [Card, Card]>>;
  readonly potAwards: readonly PublicShowdownPotSummary[];
}

export interface NongTiltEvaluation {
  readonly triggered: boolean;
  readonly reason: NongTiltTriggerReason | null;
  readonly triggeringPotIndex: number | null;
  readonly triggeringPotAmount: number | null;
}
