import { createDeck, formatCard, type Card, type Suit } from '../cards';
import {
  CalculatorError,
  type DuplicateComboPolicy,
  type OpponentRangeInput,
  type RangeAssumptionSummary,
  type WeightedCombo,
} from './types';

const SUIT_INDEX: Readonly<Record<Suit, number>> = Object.freeze({
  s: 0,
  h: 1,
  d: 2,
  c: 3,
});

const HALF_DECK = 26;

export interface CardMask {
  readonly lo: number;
  readonly hi: number;
}

export interface CanonicalComboEntry {
  readonly key: string;
  readonly cards: readonly [Card, Card];
  readonly cardIds: readonly [number, number];
  readonly maskLo: number;
  readonly maskHi: number;
  readonly weight: number;
}

export interface NormalizedOpponentRange {
  readonly opponentId: string;
  readonly label?: string;
  readonly combos: readonly CanonicalComboEntry[];
  readonly totalWeight: number;
  readonly summary: RangeAssumptionSummary;
}

export interface NormalizeRangeOptions {
  readonly duplicatePolicy?: DuplicateComboPolicy;
  readonly allowEmpty?: boolean;
}

export function validateCard(card: Card, context = 'card'): void {
  if (
    typeof card !== 'object' ||
    card === null ||
    !Number.isInteger(card.rank) ||
    card.rank < 2 ||
    card.rank > 14 ||
    !Object.hasOwn(SUIT_INDEX, card.suit)
  ) {
    throw new CalculatorError('invalid-card', `Invalid ${context}: ${JSON.stringify(card)}`);
  }
}

/** Deterministic physical card index in [0, 51]. */
export function cardToIndex(card: Card): number {
  validateCard(card);
  return (card.rank - 2) * 4 + SUIT_INDEX[card.suit];
}

export function cardMaskBit(cardIndex: number): CardMask {
  if (cardIndex < HALF_DECK) {
    return { lo: 1 << cardIndex, hi: 0 };
  }
  return { lo: 0, hi: 1 << (cardIndex - HALF_DECK) };
}

export function hasCardInMask(mask: CardMask, cardIndex: number): boolean {
  if (cardIndex < HALF_DECK) {
    return (mask.lo & (1 << cardIndex)) !== 0;
  }
  return (mask.hi & (1 << (cardIndex - HALF_DECK))) !== 0;
}

export function buildUniqueCardMask(
  cards: readonly Card[],
  context = 'cards',
): { readonly mask: CardMask; readonly indices: readonly number[] } {
  let lo = 0;
  let hi = 0;
  const indices: number[] = [];

  for (const card of cards) {
    validateCard(card, context);
    const idx = cardToIndex(card);
    if (idx < HALF_DECK) {
      const bit = 1 << idx;
      if ((lo & bit) !== 0) {
        throw new CalculatorError(
          'duplicate-card',
          `Duplicate card ${formatCard(card)} in ${context}`,
        );
      }
      lo |= bit;
    } else {
      const bit = 1 << (idx - HALF_DECK);
      if ((hi & bit) !== 0) {
        throw new CalculatorError(
          'duplicate-card',
          `Duplicate card ${formatCard(card)} in ${context}`,
        );
      }
      hi |= bit;
    }
    indices.push(idx);
  }

  return {
    mask: { lo, hi },
    indices,
  };
}

/**
 * Canonicalizes a 2-card physical combo independent of card order:
 * higher physical index first (higher rank first, deterministic suit tie-break).
 */
export function canonicalizeComboCards(
  cards: readonly [Card, Card],
  context = 'combo',
): {
  readonly cards: readonly [Card, Card];
  readonly cardIds: readonly [number, number];
  readonly key: string;
  readonly maskLo: number;
  readonly maskHi: number;
} {
  if (!Array.isArray(cards) || cards.length !== 2) {
    throw new CalculatorError('invalid-combo', `Expected exactly 2 cards in ${context}`);
  }
  const [first, second] = cards;
  validateCard(first, context);
  validateCard(second, context);

  const idA = cardToIndex(first);
  const idB = cardToIndex(second);
  if (idA === idB) {
    throw new CalculatorError(
      'invalid-combo',
      `Combo cannot contain the same card twice (${formatCard(first)})`,
    );
  }

  const orderedCards: readonly [Card, Card] = idA > idB ? [first, second] : [second, first];
  const orderedIds: readonly [number, number] = idA > idB ? [idA, idB] : [idB, idA];
  const bit0 = cardMaskBit(orderedIds[0]);
  const bit1 = cardMaskBit(orderedIds[1]);

  return {
    cards: Object.freeze([orderedCards[0], orderedCards[1]] as const),
    cardIds: orderedIds,
    key: `${formatCard(orderedCards[0])}${formatCard(orderedCards[1])}`,
    maskLo: bit0.lo | bit1.lo,
    maskHi: bit0.hi | bit1.hi,
  };
}

/** Canonical order-independent string key for a 2-card combo (e.g. "AsKs"). */
export function comboKey(cards: readonly [Card, Card]): string {
  return canonicalizeComboCards(cards).key;
}

export function getRemainingDeck(blockerMask: CardMask): Card[] {
  const remaining: Card[] = [];
  for (const card of createDeck()) {
    const idx = cardToIndex(card);
    if (!hasCardInMask(blockerMask, idx)) {
      remaining.push(card);
    }
  }
  return remaining;
}

/**
 * Validates, deduplicates, and blocker-filters an opponent's weighted combo range.
 *
 * - Weights must be finite and non-negative.
 * - Combos are matched by their two physical cards regardless of ordering.
 * - Combos colliding with `blockerCards` (hero, board, public dead cards) are removed.
 * - Zero-weight combos are removed after canonicalization/deduplication.
 * - Duplicate physical combos follow `duplicatePolicy` (default `'sum'`: weights are summed
 *   and `mergedDuplicateCount` is recorded; `'error'` rejects duplicates with `CalculatorError`).
 * - Throws `CalculatorError('empty-range' | 'empty-range-after-blockers')` when no positive-weight
 *   combos survive unless `allowEmpty` is true.
 */
export function normalizeOpponentRange(
  range: OpponentRangeInput,
  blockerCards: readonly Card[],
  options?: NormalizeRangeOptions,
): NormalizedOpponentRange {
  const duplicatePolicy: DuplicateComboPolicy = options?.duplicatePolicy ?? 'sum';
  const allowEmpty = options?.allowEmpty ?? false;

  if (typeof range.opponentId !== 'string' || range.opponentId.trim().length === 0) {
    throw new CalculatorError('empty-range', 'Opponent range must specify a non-empty opponentId');
  }
  if (!Array.isArray(range.combos)) {
    throw new CalculatorError('empty-range', `Opponent "${range.opponentId}" combos must be an array`);
  }

  const { mask: blockerMask } = buildUniqueCardMask(blockerCards, 'blockers');

  if (range.combos.length === 0 && !allowEmpty) {
    throw new CalculatorError(
      'empty-range',
      `Opponent "${range.opponentId}" range is empty`,
    );
  }

  const byKey = new Map<
    string,
    {
      cards: readonly [Card, Card];
      cardIds: readonly [number, number];
      maskLo: number;
      maskHi: number;
      weight: number;
    }
  >();

  let removedByBlockerCount = 0;
  let removedZeroWeightCount = 0;
  let mergedDuplicateCount = 0;

  for (const rawCombo of range.combos) {
    if (typeof rawCombo.weight !== 'number' || !Number.isFinite(rawCombo.weight) || rawCombo.weight < 0) {
      throw new CalculatorError(
        'invalid-weight',
        `Invalid combo weight for opponent "${range.opponentId}": ${String(rawCombo.weight)}`,
      );
    }

    const canonical = canonicalizeComboCards(
      rawCombo.cards,
      `opponent "${range.opponentId}" combo`,
    );

    const existing = byKey.get(canonical.key);
    if (existing !== undefined) {
      if (duplicatePolicy === 'error') {
        throw new CalculatorError(
          'duplicate-combo',
          `Duplicate combo ${canonical.key} in opponent "${range.opponentId}" range`,
        );
      }
      const summed = existing.weight + rawCombo.weight;
      if (!Number.isFinite(summed)) {
        throw new CalculatorError(
          'invalid-weight',
          `Merged weight overflow for combo ${canonical.key} in opponent "${range.opponentId}" range`,
        );
      }
      existing.weight = summed;
      mergedDuplicateCount++;
      continue;
    }

    byKey.set(canonical.key, {
      cards: canonical.cards,
      cardIds: canonical.cardIds,
      maskLo: canonical.maskLo,
      maskHi: canonical.maskHi,
      weight: rawCombo.weight,
    });
  }

  const validEntries: CanonicalComboEntry[] = [];
  let totalWeight = 0;

  for (const [key, entry] of byKey) {
    if (entry.weight === 0) {
      removedZeroWeightCount++;
      continue;
    }
    const blocked =
      (entry.maskLo & blockerMask.lo) !== 0 || (entry.maskHi & blockerMask.hi) !== 0;
    if (blocked) {
      removedByBlockerCount++;
      continue;
    }

    validEntries.push(
      Object.freeze({
        key,
        cards: entry.cards,
        cardIds: entry.cardIds,
        maskLo: entry.maskLo,
        maskHi: entry.maskHi,
        weight: entry.weight,
      }),
    );
    totalWeight += entry.weight;
  }

  if (validEntries.length === 0 && !allowEmpty) {
    throw new CalculatorError(
      'empty-range-after-blockers',
      `Opponent "${range.opponentId}" has no viable combos after removing blockers and zero-weight entries`,
    );
  }

  const summaryCombos: WeightedCombo[] = validEntries.map((entry) =>
    Object.freeze({
      cards: entry.cards,
      weight: entry.weight,
    }),
  );

  const summary: RangeAssumptionSummary = Object.freeze({
    opponentId: range.opponentId,
    ...(range.label !== undefined ? { label: range.label } : {}),
    inputComboCount: range.combos.length,
    validComboCount: validEntries.length,
    totalWeight,
    removedByBlockerCount,
    removedZeroWeightCount,
    mergedDuplicateCount,
    duplicatePolicy,
    combos: Object.freeze(summaryCombos),
  });

  return Object.freeze({
    opponentId: range.opponentId,
    ...(range.label !== undefined ? { label: range.label } : {}),
    combos: Object.freeze(validEntries),
    totalWeight,
    summary,
  });
}
