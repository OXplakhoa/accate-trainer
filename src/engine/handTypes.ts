import type { Card } from './cards';
import type { ChipCounts, Denomination } from './chips';
import type { PayoutTransfer, RecipientAmount } from './pots';
import type { Rng } from './rng';
import type { ShowdownResolution, TieBreakMode } from './showdown';

export const ANTE = 5;
export const STREET_CAP = 50;
export const BET_STEP = 5;
export const MIN_PREFLOP_CAP = 5;
export const MAX_PREFLOP_CAP = 50;

export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export type HandPhase = 'betting' | 'awaiting-payout' | 'complete';
export type PlayerStatus = 'active' | 'folded' | 'all-in';

export interface HandConfig {
  readonly enablePreflopBetting: boolean;
  readonly preflopCap: number;
  readonly tieBreakMode: TieBreakMode;
  readonly allowOutOfTurn: boolean;
  readonly dealerIndex: number;
}

export const DEFAULT_HAND_CONFIG: HandConfig = Object.freeze({
  enablePreflopBetting: false,
  preflopCap: STREET_CAP,
  tieBreakMode: 'bai-cao',
  allowOutOfTurn: true,
  dealerIndex: 0,
});

export interface StartHandSeatInput {
  readonly seatIndex?: number;
  readonly playerId: string;
  readonly stack: ChipCounts;
}

export interface HandFixtures {
  readonly deck?: readonly Card[];
  readonly openerId?: string;
}

export interface StartHandInput {
  readonly seats: readonly StartHandSeatInput[];
  readonly bank: ChipCounts;
  readonly rng: Rng;
  readonly config?: Partial<HandConfig>;
  readonly fixtures?: HandFixtures;
}

export type BettingAction =
  | { readonly type: 'fold' }
  | { readonly type: 'check' }
  | { readonly type: 'bet'; readonly amount: number; readonly chips: ChipCounts }
  | { readonly type: 'call'; readonly chips: ChipCounts }
  | { readonly type: 'raise'; readonly raiseTo: number; readonly chips: ChipCounts };

export interface OutOfTurnDeclaration {
  readonly playerId: string;
  readonly street: Street;
  readonly action: BettingAction;
  readonly declaredAtCurrentBet: number;
  readonly reservedChips: ChipCounts;
}

export interface SeatState {
  readonly seatIndex: number;
  readonly playerId: string;
  readonly stack: ChipCounts;
  readonly holeCards: readonly [Card, Card];
  readonly status: PlayerStatus;
  readonly streetContribution: number;
  readonly totalContribution: number;
  readonly unsettledContribution: number;
  readonly hasActedThisStreet: boolean;
  readonly declaration: OutOfTurnDeclaration | null;
  readonly cancelledDeclarationThisStreet: boolean;
}

export interface DecisionSignal {
  readonly playerId: string;
  readonly street: Street;
  readonly hadCancelledDeclaration: boolean;
}

export interface AmountRange {
  readonly min: number;
  readonly max: number;
  readonly step: typeof BET_STEP;
}

export interface LegalActions {
  readonly playerId: string;
  readonly street: Street;
  readonly streetCap: number;
  readonly currentBet: number;
  readonly playerStreetContribution: number;
  readonly toCall: number;
  readonly canFold: boolean;
  readonly canCheck: boolean;
  readonly canBet: boolean;
  readonly betRange: AmountRange | null;
  readonly canCall: boolean;
  readonly callAmount: number | null;
  readonly isCallAllIn: boolean;
  readonly canRaise: boolean;
  readonly raiseRange: AmountRange | null;
}

export type ExchangeTarget =
  | { readonly kind: 'player'; readonly playerId: string }
  | { readonly kind: 'pot' };

export interface HandExchangeRequest {
  readonly fromPlayerId: string;
  readonly target: ExchangeTarget;
  readonly give: ChipCounts;
  readonly receive: ChipCounts;
}

export type OutOfTurnCancelReason = 'bet-changed' | 'street-ended' | 'hand-ended';

export type HandTimelineEvent =
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
    }
  | {
      readonly type: 'fold-win';
      readonly winnerId: string;
      readonly amount: number;
    }
  | {
      readonly type: 'showdown';
      readonly resolution: ShowdownResolution;
    }
  | {
      readonly type: 'payout-pending';
      readonly requiredPayouts: readonly RecipientAmount[];
      readonly reason: 'insufficient-pot-denominations';
    }
  | {
      readonly type: 'payout-settled';
      readonly transfers: readonly PayoutTransfer[];
    };

export type HandOutcome =
  | {
      readonly kind: 'fold-win';
      readonly winnerId: string;
      readonly potAmount: number;
      readonly revealedCards: false;
    }
  | {
      readonly kind: 'showdown';
      readonly resolution: ShowdownResolution;
    };

export interface PendingPayout {
  readonly requiredPayouts: readonly RecipientAmount[];
}

export interface HandState {
  readonly phase: HandPhase;
  readonly config: HandConfig;
  readonly rngSeed: string;
  readonly seats: readonly SeatState[];
  readonly dealerIndex: number;
  readonly dealerSeatIndex: number;
  readonly openerIndex: number;
  readonly openerSeatIndex: number;
  readonly openerPlayerId: string;
  readonly street: Street;
  readonly streetCap: number;
  readonly currentBet: number;
  readonly activePlayerIndex: number | null;
  readonly activePlayerId: string | null;
  readonly awaitingDecision: DecisionSignal | null;
  readonly deck: readonly Card[];
  readonly deckCursor: number;
  readonly board: readonly Card[];
  readonly pot: ChipCounts;
  readonly bank: ChipCounts;
  readonly timeline: readonly HandTimelineEvent[];
  readonly outcome: HandOutcome | null;
  readonly pendingPayout: PendingPayout | null;
  readonly settledTransfers: readonly PayoutTransfer[];
}

export type HandErrorCode =
  | 'invalid-player-count'
  | 'duplicate-player'
  | 'invalid-config'
  | 'invalid-deck'
  | 'invalid-opener'
  | 'invalid-invariants'
  | 'zero-stack-seat'
  | 'insufficient-ante-denomination'
  | 'hand-not-in-betting-phase'
  | 'not-players-turn'
  | 'is-players-turn'
  | 'player-not-found'
  | 'player-not-active'
  | 'out-of-turn-disabled'
  | 'declaration-already-active'
  | 'declaration-binding'
  | 'no-upcoming-turn'
  | 'cannot-check-facing-bet'
  | 'cannot-bet-when-bet-exists'
  | 'cannot-call-without-bet'
  | 'cannot-raise-without-bet'
  | 'cap-reached'
  | 'invalid-amount'
  | 'chips-mismatch-amount'
  | 'insufficient-chips'
  | 'invalid-exchange'
  | 'payout-not-pending'
  | 'insufficient-pot-denominations';

export type StartHandResult =
  | {
      readonly ok: true;
      readonly state: HandState;
      readonly events: readonly HandTimelineEvent[];
      readonly decisionRequiredFor: string | null;
    }
  | {
      readonly ok: false;
      readonly code: HandErrorCode;
      readonly message: string;
    };

export type HandStepResult =
  | {
      readonly ok: true;
      readonly state: HandState;
      readonly events: readonly HandTimelineEvent[];
      readonly autoExecutedDeclarations: readonly OutOfTurnDeclaration[];
      readonly cancelledDeclarations: readonly OutOfTurnDeclaration[];
      readonly decisionRequiredFor: string | null;
    }
  | {
      readonly ok: false;
      readonly code: HandErrorCode;
      readonly message: string;
      readonly state: HandState;
    };

export interface HandInvariantReport {
  readonly ok: boolean;
  readonly inv1: { readonly ok: true } | { readonly ok: false; readonly diff: Record<Denomination, number> };
  readonly inv2: {
    readonly ok: boolean;
    readonly potValue: number;
    readonly unsettledTotal: number;
  };
}
