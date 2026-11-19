import type { Card } from '../cards';
import { chipValue } from '../chips';
import { getLegalActions } from '../hand';
import type { HandState, LegalActions, Street } from '../handTypes';
import { calculatePots, type PotSlice } from '../pots';

export type CalculatorErrorCode =
  | 'invalid-card'
  | 'duplicate-card'
  | 'invalid-combo'
  | 'duplicate-combo'
  | 'invalid-weight'
  | 'empty-range'
  | 'empty-range-after-blockers'
  | 'impossible-range-combination'
  | 'insufficient-deck-cards'
  | 'invalid-board-length'
  | 'invalid-probability-input'
  | 'invalid-pot-odds-input'
  | 'invalid-equity-input'
  | 'invalid-sample-config'
  | 'max-attempts-exceeded-no-samples'
  | 'exact-enumeration-limit-exceeded'
  | 'invalid-ev-input'
  | 'invalid-bet-amount'
  | 'exceeds-street-cap'
  | 'cap-reached'
  | 'invalid-metric-input'
  | 'player-not-found';

export class CalculatorError extends Error {
  readonly code: CalculatorErrorCode;

  constructor(code: CalculatorErrorCode, message: string) {
    super(message);
    this.name = 'CalculatorError';
    this.code = code;
  }
}

export interface WeightedCombo {
  readonly cards: readonly [Card, Card];
  readonly weight: number;
}

export type DuplicateComboPolicy = 'sum' | 'error';

export interface OpponentRangeInput {
  readonly opponentId: string;
  readonly label?: string;
  readonly combos: readonly WeightedCombo[];
}

export interface RangeAssumptionSummary {
  readonly opponentId: string;
  readonly label?: string;
  readonly inputComboCount: number;
  readonly validComboCount: number;
  readonly totalWeight: number;
  readonly removedByBlockerCount: number;
  readonly removedZeroWeightCount: number;
  readonly mergedDuplicateCount: number;
  readonly duplicatePolicy: DuplicateComboPolicy;
  readonly combos: readonly WeightedCombo[];
}

export interface PositionAssumption {
  readonly seatIndex?: number;
  readonly openerPlayerId?: string;
  readonly playersToActBeforeHero?: readonly string[];
  readonly playersToActAfterHero?: readonly string[];
  readonly actsFirst?: boolean;
  readonly actsLast?: boolean;
  readonly label?: string;
}

export interface DecisionAssumptionsContext {
  readonly street?: Street;
  readonly opponentCount?: number;
  readonly potBeforeAction?: number;
  readonly heroStack?: number;
  readonly streetCap?: number;
  readonly position?: PositionAssumption;
  readonly notes?: readonly string[];
}

export type CalculationMethod =
  | 'exact-formula'
  | 'rule-of-2-4-approximation'
  | 'exact-next-card-enumeration'
  | 'exact-enumeration'
  | 'monte-carlo'
  | 'exact-ev'
  | 'estimated-ev';

export interface SimulationSampleStats {
  readonly requested: number;
  readonly completed: number;
  readonly attempts: number;
  readonly rejectedAttempts: number;
  readonly reachedTarget: boolean;
  readonly seed: string;
}

export interface CalculationAssumptions {
  readonly method: CalculationMethod;
  readonly street?: Street;
  readonly opponentCount?: number;
  readonly ranges?: readonly RangeAssumptionSummary[];
  readonly potBeforeAction?: number;
  readonly heroStack?: number;
  readonly streetCap?: number;
  readonly position?: PositionAssumption;
  readonly samples?: SimulationSampleStats;
  readonly exactEvaluations?: number;
  readonly notes: readonly string[];
}

/**
 * Public decision-time snapshot for hero.
 * Contains ONLY hero's own hole cards and public table state (no undealt deck,
 * no opponent hole cards, no future runout, no hand outcome).
 */
export interface DecisionSnapshot {
  readonly heroId: string;
  readonly heroCards: readonly [Card, Card];
  readonly board: readonly Card[];
  readonly street: Street;
  readonly potBeforeCall: number;
  readonly heroStack: number;
  readonly heroStreetContribution: number;
  readonly heroTotalContribution: number;
  readonly currentBet: number;
  readonly streetCap: number;
  readonly remainingCapAllowance: number;
  readonly toCall: number;
  readonly callAmount: number;
  readonly isCallAllIn: boolean;
  readonly activeOpponentCount: number;
  readonly actingOpponentCount: number;
  readonly position: PositionAssumption;
  readonly potSlices: readonly PotSlice[];
  readonly legalActions: LegalActions | null;
}

function buildPositionFromHandState(state: HandState, heroSeatIdx: number): PositionAssumption {
  const n = state.seats.length;
  const order: number[] = [];
  for (let offset = 0; offset < n; offset++) {
    const idx = (state.openerIndex + offset) % n;
    const seat = state.seats[idx]!;
    if (seat.status !== 'folded') {
      order.push(idx);
    }
  }

  const heroPosInOrder = order.indexOf(heroSeatIdx);
  const playersToActBeforeHero: string[] = [];
  const playersToActAfterHero: string[] = [];

  if (heroPosInOrder !== -1) {
    for (let i = 0; i < heroPosInOrder; i++) {
      const seat = state.seats[order[i]!]!;
      if (seat.status === 'active') {
        playersToActBeforeHero.push(seat.playerId);
      }
    }
    for (let i = heroPosInOrder + 1; i < order.length; i++) {
      const seat = state.seats[order[i]!]!;
      if (seat.status === 'active') {
        playersToActAfterHero.push(seat.playerId);
      }
    }
  }

  const actsFirst = playersToActBeforeHero.length === 0;
  const actsLast = playersToActAfterHero.length === 0;
  const label =
    actsFirst && actsLast
      ? 'Hành động duy nhất'
      : actsFirst
        ? 'Nói trước (mở lời)'
        : actsLast
          ? 'Nói cuối'
          : `Nói sau ${playersToActBeforeHero.length} người, trước ${playersToActAfterHero.length} người`;

  return Object.freeze({
    seatIndex: state.seats[heroSeatIdx]!.seatIndex,
    openerPlayerId: state.openerPlayerId,
    playersToActBeforeHero: Object.freeze(playersToActBeforeHero),
    playersToActAfterHero: Object.freeze(playersToActAfterHero),
    actsFirst,
    actsLast,
    label,
  });
}

/**
 * Extracts a pure, read-only decision snapshot for `heroId` from a `HandState`.
 * Never inspects `state.deck`, `state.outcome`, or any opponent's `holeCards`,
 * and never mutates `state`.
 */
export function extractDecisionSnapshot(state: HandState, heroId: string): DecisionSnapshot {
  const heroIdx = state.seats.findIndex((seat) => seat.playerId === heroId);
  if (heroIdx === -1) {
    throw new CalculatorError('player-not-found', `Hero "${heroId}" is not seated in this hand`);
  }

  const heroSeat = state.seats[heroIdx]!;
  const heroStack = chipValue(heroSeat.stack);
  const potBeforeCall = chipValue(state.pot);
  const toCall = Math.max(0, state.currentBet - heroSeat.streetContribution);
  const callAmount = Math.min(toCall, heroStack);
  const isCallAllIn = toCall > 0 && heroStack <= toCall;
  const remainingCapAllowance = Math.max(0, state.streetCap - heroSeat.streetContribution);

  let activeOpponentCount = 0;
  let actingOpponentCount = 0;
  for (const seat of state.seats) {
    if (seat.playerId === heroId) {
      continue;
    }
    if (seat.status !== 'folded') {
      activeOpponentCount++;
      if (seat.status === 'active') {
        actingOpponentCount++;
      }
    }
  }

  const breakdown = calculatePots(
    state.seats.map((seat) => ({
      playerId: seat.playerId,
      amount: seat.totalContribution,
      folded: seat.status === 'folded',
    })),
  );

  const legalActions =
    state.activePlayerId === heroId ? getLegalActions(state) : null;

  return Object.freeze({
    heroId,
    heroCards: Object.freeze([heroSeat.holeCards[0], heroSeat.holeCards[1]] as const),
    board: Object.freeze([...state.board]),
    street: state.street,
    potBeforeCall,
    heroStack,
    heroStreetContribution: heroSeat.streetContribution,
    heroTotalContribution: heroSeat.totalContribution,
    currentBet: state.currentBet,
    streetCap: state.streetCap,
    remainingCapAllowance,
    toCall,
    callAmount,
    isCallAllIn,
    activeOpponentCount,
    actingOpponentCount,
    position: buildPositionFromHandState(state, heroIdx),
    potSlices: Object.freeze([...breakdown.pots]),
    legalActions,
  });
}

export function assumptionsContextFromSnapshot(
  snapshot: DecisionSnapshot,
  extraNotes?: readonly string[],
): DecisionAssumptionsContext {
  return {
    street: snapshot.street,
    opponentCount: snapshot.activeOpponentCount,
    potBeforeAction: snapshot.potBeforeCall,
    heroStack: snapshot.heroStack,
    streetCap: snapshot.streetCap,
    position: snapshot.position,
    notes: extraNotes,
  };
}
