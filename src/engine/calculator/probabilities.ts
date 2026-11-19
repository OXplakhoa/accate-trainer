import type { Street } from '../handTypes';
import { CalculatorError } from './types';

export const STANDARD_DECK_SIZE = 52;
export const HERO_HOLE_CARD_COUNT = 2;

export interface RuleApproximation {
  readonly kind: 'rule-of-2' | 'rule-of-4' | 'rule-of-4-adjusted';
  /** Approximated probability clamped to [0, 1]. */
  readonly probability: number;
  /** Raw unclamped percentage before [0, 100] clamping. */
  readonly rawPercent: number;
  /** True if rawPercent exceeded 100 and was clamped to 1. */
  readonly isClamped: boolean;
  /** True when the >8 outs adjustment was applied (rule-of-4-adjusted only). */
  readonly adjustmentApplied: boolean;
  readonly isApproximation: true;
  readonly formula: string;
}

export interface DrawProbabilityReport {
  readonly street: Street;
  readonly outs: number;
  readonly unseenCards: number;
  readonly cardsRemainingToRiver: 0 | 1 | 2;
  /** Exact probability of hitting at least one out on the next single card (0 on river). */
  readonly nextCardExact: number;
  /** Exact probability of hitting at least one out by the river (0 on river). */
  readonly toRiverExact: number;
  readonly ruleOf2: RuleApproximation | null;
  readonly ruleOf4: RuleApproximation | null;
  readonly ruleOf4Adjusted: RuleApproximation | null;
}

function assertValidOutsCount(outs: number, maxOuts: number): void {
  if (!Number.isInteger(outs) || outs < 0 || outs > maxOuts) {
    throw new CalculatorError(
      'invalid-probability-input',
      `Outs must be an integer in [0, ${maxOuts}], received ${String(outs)}`,
    );
  }
}

/**
 * Returns the standard unseen card count for a given street given 2 hero hole cards
 * and optional additional publicly known dead cards.
 * Flop -> 47 - deadCardCount, Turn -> 46 - deadCardCount, River -> 45 - deadCardCount.
 */
export function unseenCardCountForStreet(street: Street, deadCardCount = 0): number {
  if (!Number.isInteger(deadCardCount) || deadCardCount < 0) {
    throw new CalculatorError(
      'invalid-probability-input',
      `deadCardCount must be a non-negative integer, received ${String(deadCardCount)}`,
    );
  }
  const boardCount =
    street === 'preflop' ? 0 : street === 'flop' ? 3 : street === 'turn' ? 4 : 5;
  const unseen = STANDARD_DECK_SIZE - HERO_HOLE_CARD_COUNT - boardCount - deadCardCount;
  if (unseen < 0) {
    throw new CalculatorError(
      'invalid-probability-input',
      `Invalid deadCardCount (${deadCardCount}) for street ${street}: unseen cards would be negative`,
    );
  }
  return unseen;
}

/**
 * Exact probability of hitting at least one of `outs` when drawing `cardsToDraw` (0, 1, or 2)
 * cards without replacement from `unseenCards`.
 *
 * - `cardsToDraw === 0` (e.g. river): returns `0`.
 * - `cardsToDraw === 1`: `outs / unseenCards`.
 * - `cardsToDraw === 2`: `1 - ((unseenCards - outs) * (unseenCards - outs - 1)) / (unseenCards * (unseenCards - 1))`.
 */
export function exactHitProbability(
  outs: number,
  unseenCards: number,
  cardsToDraw: 0 | 1 | 2,
): number {
  if (cardsToDraw !== 0 && cardsToDraw !== 1 && cardsToDraw !== 2) {
    throw new CalculatorError(
      'invalid-probability-input',
      `cardsToDraw must be 0, 1, or 2, received ${String(cardsToDraw)}`,
    );
  }
  if (
    !Number.isInteger(unseenCards) ||
    unseenCards < cardsToDraw ||
    unseenCards > STANDARD_DECK_SIZE
  ) {
    throw new CalculatorError(
      'invalid-probability-input',
      `unseenCards must be an integer in [${cardsToDraw}, ${STANDARD_DECK_SIZE}], received ${String(unseenCards)}`,
    );
  }
  assertValidOutsCount(outs, unseenCards);

  if (cardsToDraw === 0 || outs === 0) {
    return 0;
  }
  if (cardsToDraw === 1) {
    return outs / unseenCards;
  }

  // cardsToDraw === 2 without replacement: 1 - C(U - n, 2) / C(U, 2)
  const misses = unseenCards - outs;
  if (misses < 2) {
    return 1;
  }
  return 1 - (misses * (misses - 1)) / (unseenCards * (unseenCards - 1));
}

/**
 * Rule of 2 approximation for 1 card to come (`2 * outs`%), clamped to `[0, 1]`.
 */
export function approximateRuleOf2(outs: number): RuleApproximation {
  assertValidOutsCount(outs, STANDARD_DECK_SIZE);
  const rawPercent = 2 * outs;
  const clampedPercent = Math.min(100, Math.max(0, rawPercent));
  return Object.freeze({
    kind: 'rule-of-2',
    probability: clampedPercent / 100,
    rawPercent,
    isClamped: rawPercent > 100,
    adjustmentApplied: false,
    isApproximation: true,
    formula: '2 * outs (%)',
  });
}

/**
 * Unadjusted Rule of 4 approximation for 2 cards to come (`4 * outs`%), clamped to `[0, 1]`.
 */
export function approximateRuleOf4(outs: number): RuleApproximation {
  assertValidOutsCount(outs, STANDARD_DECK_SIZE);
  const rawPercent = 4 * outs;
  const clampedPercent = Math.min(100, Math.max(0, rawPercent));
  return Object.freeze({
    kind: 'rule-of-4',
    probability: clampedPercent / 100,
    rawPercent,
    isClamped: rawPercent > 100,
    adjustmentApplied: false,
    isApproximation: true,
    formula: '4 * outs (%)',
  });
}

/**
 * Adjusted Rule of 4 for 2 cards to come (Hopkins L7 s6):
 * - For `outs <= 8`: `4 * outs` (%)
 * - For `outs > 8`: `4 * outs - (outs - 8)` (%) = `3 * outs + 8` (%)
 * Clamped to `[0, 1]`.
 */
export function approximateRuleOf4Adjusted(outs: number): RuleApproximation {
  assertValidOutsCount(outs, STANDARD_DECK_SIZE);
  const adjustmentApplied = outs > 8;
  const rawPercent = adjustmentApplied ? 4 * outs - (outs - 8) : 4 * outs;
  const clampedPercent = Math.min(100, Math.max(0, rawPercent));
  return Object.freeze({
    kind: 'rule-of-4-adjusted',
    probability: clampedPercent / 100,
    rawPercent,
    isClamped: rawPercent > 100,
    adjustmentApplied,
    isApproximation: true,
    formula: adjustmentApplied ? '4 * outs - (outs - 8) (%)' : '4 * outs (%)',
  });
}

export interface CalculateDrawProbabilitiesInput {
  readonly outs: number;
  readonly street: Exclude<Street, 'preflop'>;
  /** Optional explicit unseen card pool. Defaults to 47 (flop), 46 (turn), 45 (river) minus `deadCardCount`. */
  readonly unseenCards?: number;
  readonly deadCardCount?: number;
}

/**
 * Computes exact draw hit probabilities (1-card and to-river) alongside separate
 * Rule of 2/4 approximations for flop, turn, or river.
 */
export function calculateDrawProbabilities(
  input: CalculateDrawProbabilitiesInput,
): DrawProbabilityReport {
  const { outs, street } = input;
  const unseenCards =
    input.unseenCards !== undefined
      ? input.unseenCards
      : unseenCardCountForStreet(street, input.deadCardCount ?? 0);

  const cardsRemainingToRiver: 0 | 1 | 2 =
    street === 'flop' ? 2 : street === 'turn' ? 1 : 0;

  if (
    !Number.isInteger(unseenCards) ||
    unseenCards < cardsRemainingToRiver ||
    unseenCards > STANDARD_DECK_SIZE
  ) {
    throw new CalculatorError(
      'invalid-probability-input',
      `unseenCards must be an integer in [${cardsRemainingToRiver}, ${STANDARD_DECK_SIZE}], received ${String(unseenCards)}`,
    );
  }
  assertValidOutsCount(outs, unseenCards);

  if (cardsRemainingToRiver === 0) {
    return Object.freeze({
      street,
      outs,
      unseenCards,
      cardsRemainingToRiver: 0,
      nextCardExact: 0,
      toRiverExact: 0,
      ruleOf2: null,
      ruleOf4: null,
      ruleOf4Adjusted: null,
    });
  }

  const nextCardExact = exactHitProbability(outs, unseenCards, 1);
  const toRiverExact = exactHitProbability(outs, unseenCards, cardsRemainingToRiver);

  return Object.freeze({
    street,
    outs,
    unseenCards,
    cardsRemainingToRiver,
    nextCardExact,
    toRiverExact,
    ruleOf2: approximateRuleOf2(outs),
    ruleOf4: cardsRemainingToRiver === 2 ? approximateRuleOf4(outs) : null,
    ruleOf4Adjusted: cardsRemainingToRiver === 2 ? approximateRuleOf4Adjusted(outs) : null,
  });
}
