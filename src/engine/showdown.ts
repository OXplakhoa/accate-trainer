import {
  createBaiCaoDeck,
  resolveBaiCaoWithDeck,
  type BaiCaoDeckState,
  type BaiCaoResult,
} from './baiCao';
import type { Card } from './cards';
import { compareHands, evaluateHand, type HandValue } from './handEval';
import {
  calculatePots,
  type PotContribution,
  type RecipientAmount,
  type UncalledRefund,
} from './pots';
import type { Rng } from './rng';

export type TieBreakMode = 'bai-cao' | 'split';

export interface ShowdownPlayerInput {
  readonly playerId: string;
  readonly holeCards: readonly [Card, Card];
  readonly contribution: number;
  readonly folded: boolean;
}

export type PotTieBreak =
  | { readonly kind: 'none' }
  | { readonly kind: 'bai-cao'; readonly result: BaiCaoResult }
  | {
      readonly kind: 'split';
      readonly baseAmount: number;
      readonly oddChipRecipients: readonly string[];
    };

export interface PotAward {
  readonly potIndex: number;
  readonly potAmount: number;
  readonly eligiblePlayerIds: readonly string[];
  readonly evaluatedHands: Readonly<Record<string, HandValue>>;
  readonly tiedTopPlayerIds: readonly string[];
  readonly tieBreak: PotTieBreak;
  readonly awards: readonly RecipientAmount[];
}

export interface ShowdownInput {
  readonly players: readonly ShowdownPlayerInput[];
  readonly board: readonly Card[];
  readonly undealt: readonly Card[];
  readonly tieBreakMode: TieBreakMode;
  readonly baiCaoRng: Rng;
  readonly oddChipRng: Rng;
}

export interface ShowdownResolution {
  readonly uncalledRefund: UncalledRefund | null;
  readonly potAwards: readonly PotAward[];
  readonly totalPayouts: readonly RecipientAmount[];
  readonly finalBaiCaoDeck: BaiCaoDeckState | null;
}

function splitPotEvenly(
  potAmount: number,
  tiedWinners: readonly string[],
  potOddChipRng: Rng,
): {
  readonly baseAmount: number;
  readonly oddChipRecipients: readonly string[];
  readonly awards: readonly RecipientAmount[];
} {
  if (potAmount % 5 !== 0) {
    throw new RangeError(`Pot amount must be a multiple of 5, received ${String(potAmount)}`);
  }
  const units = potAmount / 5;
  const baseUnits = Math.floor(units / tiedWinners.length);
  const remainderUnits = units % tiedWinners.length;
  const baseAmount = baseUnits * 5;

  const oddChipRecipients =
    remainderUnits > 0 ? potOddChipRng.shuffle(tiedWinners).slice(0, remainderUnits) : [];
  const oddRecipientSet = new Set(oddChipRecipients);

  const awards: RecipientAmount[] = tiedWinners
    .map((playerId) => ({
      playerId,
      amount: baseAmount + (oddRecipientSet.has(playerId) ? 5 : 0),
    }))
    .filter((entry) => entry.amount > 0);

  return { baseAmount, oddChipRecipients, awards };
}

/**
 * Resolves a full Hold'em showdown across main pot and all side pots.
 * Evaluates each non-folded player's best 5 of 7 cards once, resolves ties per pot via
 * shared-deck bài cào (default) or unit-5 even split with seeded random odd chips, and
 * aggregates total payouts per player (including any uncalled excess still in the pot).
 */
export function resolveShowdown(input: ShowdownInput): ShowdownResolution {
  if (input.board.length !== 5) {
    throw new RangeError(`Showdown requires 5 board cards, received ${String(input.board.length)}`);
  }

  const contributions: PotContribution[] = input.players.map((p) => ({
    playerId: p.playerId,
    amount: p.contribution,
    folded: p.folded,
  }));
  const breakdown = calculatePots(contributions);

  const handValues = new Map<string, HandValue>();
  for (const player of input.players) {
    if (!player.folded) {
      handValues.set(player.playerId, evaluateHand([...player.holeCards, ...input.board]));
    }
  }

  let baiCaoDeck: BaiCaoDeckState | null = null;
  const potAwards: PotAward[] = [];
  const payoutTotals = new Map<string, number>();

  const credit = (playerId: string, amount: number): void => {
    if (amount > 0) {
      payoutTotals.set(playerId, (payoutTotals.get(playerId) ?? 0) + amount);
    }
  };

  if (breakdown.uncalledRefund !== null) {
    credit(breakdown.uncalledRefund.playerId, breakdown.uncalledRefund.amount);
  }

  for (const pot of breakdown.pots) {
    const evaluatedForPot = Object.create(null) as Record<string, HandValue>;
    for (const playerId of pot.eligiblePlayerIds) {
      const value = handValues.get(playerId);
      if (value === undefined) {
        throw new Error(`Missing evaluated hand for eligible player "${playerId}"`);
      }
      evaluatedForPot[playerId] = value;
    }

    if (pot.eligiblePlayerIds.length === 1) {
      const soleWinner = pot.eligiblePlayerIds[0]!;
      credit(soleWinner, pot.amount);
      potAwards.push({
        potIndex: pot.index,
        potAmount: pot.amount,
        eligiblePlayerIds: pot.eligiblePlayerIds,
        evaluatedHands: evaluatedForPot,
        tiedTopPlayerIds: [soleWinner],
        tieBreak: { kind: 'none' },
        awards: [{ playerId: soleWinner, amount: pot.amount }],
      });
      continue;
    }

    let bestHand = evaluatedForPot[pot.eligiblePlayerIds[0]!]!;
    let tiedTop: string[] = [pot.eligiblePlayerIds[0]!];

    for (let i = 1; i < pot.eligiblePlayerIds.length; i++) {
      const playerId = pot.eligiblePlayerIds[i]!;
      const value = evaluatedForPot[playerId]!;
      const cmp = compareHands(value, bestHand);
      if (cmp > 0) {
        bestHand = value;
        tiedTop = [playerId];
      } else if (cmp === 0) {
        tiedTop.push(playerId);
      }
    }

    if (tiedTop.length === 1) {
      const winnerId = tiedTop[0]!;
      credit(winnerId, pot.amount);
      potAwards.push({
        potIndex: pot.index,
        potAmount: pot.amount,
        eligiblePlayerIds: pot.eligiblePlayerIds,
        evaluatedHands: evaluatedForPot,
        tiedTopPlayerIds: tiedTop,
        tieBreak: { kind: 'none' },
        awards: [{ playerId: winnerId, amount: pot.amount }],
      });
      continue;
    }

    if (input.tieBreakMode === 'bai-cao') {
      if (baiCaoDeck === null) {
        baiCaoDeck = createBaiCaoDeck(input.undealt);
      }
      const resolved = resolveBaiCaoWithDeck(tiedTop, baiCaoDeck, input.baiCaoRng);
      baiCaoDeck = resolved.nextDeck;
      const winnerId = resolved.result.winnerId;
      credit(winnerId, pot.amount);
      potAwards.push({
        potIndex: pot.index,
        potAmount: pot.amount,
        eligiblePlayerIds: pot.eligiblePlayerIds,
        evaluatedHands: evaluatedForPot,
        tiedTopPlayerIds: tiedTop,
        tieBreak: { kind: 'bai-cao', result: resolved.result },
        awards: [{ playerId: winnerId, amount: pot.amount }],
      });
    } else {
      const potOddRng = input.oddChipRng.fork(`pot-${pot.index}`);
      const split = splitPotEvenly(pot.amount, tiedTop, potOddRng);
      for (const award of split.awards) {
        credit(award.playerId, award.amount);
      }
      potAwards.push({
        potIndex: pot.index,
        potAmount: pot.amount,
        eligiblePlayerIds: pot.eligiblePlayerIds,
        evaluatedHands: evaluatedForPot,
        tiedTopPlayerIds: tiedTop,
        tieBreak: {
          kind: 'split',
          baseAmount: split.baseAmount,
          oddChipRecipients: split.oddChipRecipients,
        },
        awards: split.awards,
      });
    }
  }

  // Emit totalPayouts in deterministic seat order.
  const totalPayouts: RecipientAmount[] = [];
  for (const player of input.players) {
    const amount = payoutTotals.get(player.playerId) ?? 0;
    if (amount > 0) {
      totalPayouts.push({ playerId: player.playerId, amount });
    }
  }

  return {
    uncalledRefund: breakdown.uncalledRefund,
    potAwards,
    totalPayouts,
    finalBaiCaoDeck: baiCaoDeck,
  };
}
