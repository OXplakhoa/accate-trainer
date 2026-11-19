import { chipValue, type ChipCounts, type Denomination } from './chips';

export interface PotContribution {
  readonly playerId: string;
  readonly amount: number;
  readonly folded: boolean;
}

export interface PotSlice {
  readonly index: number;
  readonly amount: number;
  readonly eligiblePlayerIds: readonly string[];
}

export interface UncalledRefund {
  readonly playerId: string;
  readonly amount: number;
}

export interface PotBreakdown {
  readonly pots: readonly PotSlice[];
  readonly uncalledRefund: UncalledRefund | null;
}

export interface RecipientAmount {
  readonly playerId: string;
  readonly amount: number;
}

export interface PayoutTransfer {
  readonly playerId: string;
  readonly amount: number;
  readonly chips: ChipCounts;
}

const DESCENDING_DENOMINATIONS: readonly Denomination[] = [100, 50, 10, 5];

function samePlayerList(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Computes main pot, side pots, and any uncalled bet excess from per-player contributions.
 * - Folded players' chips remain in the pot, but folded players are excluded from eligibility.
 * - When only one non-folded player remains (R8/R15 fold-win), the entire pot is awarded to that player.
 * - Otherwise, any top contribution slice paid by a single non-folded player is separated as an uncalled refund (§3.6).
 */
export function calculatePots(contributions: readonly PotContribution[]): PotBreakdown {
  const seen = new Set<string>();
  let totalAmount = 0;

  for (const entry of contributions) {
    if (seen.has(entry.playerId)) {
      throw new Error(`Duplicate playerId in contributions: "${entry.playerId}"`);
    }
    seen.add(entry.playerId);
    if (!Number.isInteger(entry.amount) || entry.amount < 0) {
      throw new RangeError(
        `Invalid contribution amount for "${entry.playerId}": ${String(entry.amount)}`,
      );
    }
    totalAmount += entry.amount;
  }

  if (totalAmount === 0) {
    return { pots: [], uncalledRefund: null };
  }

  const nonFolded = contributions.filter((entry) => !entry.folded);
  if (nonFolded.length === 0) {
    throw new Error('At least one non-folded player is required to calculate pots');
  }

  // Fold-win path (R8/R15): sole non-folded player receives the entire pot.
  if (nonFolded.length === 1) {
    return {
      pots: [
        {
          index: 0,
          amount: totalAmount,
          eligiblePlayerIds: [nonFolded[0]!.playerId],
        },
      ],
      uncalledRefund: null,
    };
  }

  const positiveLevels = Array.from(
    new Set(contributions.filter((entry) => entry.amount > 0).map((entry) => entry.amount)),
  ).sort((a, b) => a - b);

  const mergedPots: Array<{ amount: number; eligiblePlayerIds: readonly string[] }> = [];
  let uncalledRefund: UncalledRefund | null = null;
  let previousLevel = 0;

  for (let levelIdx = 0; levelIdx < positiveLevels.length; levelIdx++) {
    const level = positiveLevels[levelIdx]!;
    const delta = level - previousLevel;
    previousLevel = level;

    const contributors = contributions.filter((entry) => entry.amount >= level);
    const sliceAmount = delta * contributors.length;
    const isTopLevel = levelIdx === positiveLevels.length - 1;

    if (isTopLevel && contributors.length === 1 && !contributors[0]!.folded) {
      uncalledRefund = {
        playerId: contributors[0]!.playerId,
        amount: sliceAmount,
      };
      continue;
    }

    const eligiblePlayerIds = contributors
      .filter((entry) => !entry.folded)
      .map((entry) => entry.playerId);

    if (eligiblePlayerIds.length === 0) {
      // Defensive fallback: dead chips above all active stacks attach to the last contested pot.
      const lastPot = mergedPots[mergedPots.length - 1];
      if (lastPot !== undefined) {
        lastPot.amount += sliceAmount;
      }
      continue;
    }

    const lastPot = mergedPots[mergedPots.length - 1];
    if (lastPot !== undefined && samePlayerList(lastPot.eligiblePlayerIds, eligiblePlayerIds)) {
      lastPot.amount += sliceAmount;
    } else {
      mergedPots.push({
        amount: sliceAmount,
        eligiblePlayerIds,
      });
    }
  }

  const pots: PotSlice[] = mergedPots.map((pot, index) => ({
    index,
    amount: pot.amount,
    eligiblePlayerIds: pot.eligiblePlayerIds,
  }));

  return { pots, uncalledRefund };
}

/**
 * Computes exact per-denomination chip transfers from `pot` for the requested `payouts`.
 * Supports both full-pot payouts (`sum === chipValue(pot)`) and partial extractions such as
 * uncalled bet refunds (`sum < chipValue(pot)`).
 *
 * Because Accate denominations satisfy 5 | 10 | 50 | 100, greedy distribution from 100 down to 5
 * across `[...payouts, remainingPot]` is mathematically exact (finds a valid partition iff one exists).
 * Returns `null` when `pot` lacks the chip denominations needed to form exact payouts.
 */
export function planPotPayouts(
  pot: ChipCounts,
  payouts: readonly RecipientAmount[],
): readonly PayoutTransfer[] | null {
  const potTotal = chipValue(pot);

  const mergedByPlayer = new Map<string, number>();
  for (const payout of payouts) {
    if (!Number.isInteger(payout.amount) || payout.amount < 0) {
      throw new RangeError(
        `Invalid payout amount for "${payout.playerId}": ${String(payout.amount)}`,
      );
    }
    if (payout.amount === 0) {
      continue;
    }
    if (payout.amount % 5 !== 0) {
      return null;
    }
    mergedByPlayer.set(payout.playerId, (mergedByPlayer.get(payout.playerId) ?? 0) + payout.amount);
  }

  const merged: RecipientAmount[] = [];
  let totalRequested = 0;
  for (const [playerId, amount] of mergedByPlayer) {
    merged.push({ playerId, amount });
    totalRequested += amount;
  }

  if (totalRequested === 0) {
    return [];
  }
  if (totalRequested > potTotal) {
    return null;
  }

  // Fast path: single recipient receives the entire pot.
  if (merged.length === 1 && totalRequested === potTotal) {
    return [
      {
        playerId: merged[0]!.playerId,
        amount: potTotal,
        chips: { 5: pot[5], 10: pot[10], 50: pot[50], 100: pot[100] },
      },
    ];
  }

  const leftoverPotAmount = potTotal - totalRequested;
  const bucketTargets =
    leftoverPotAmount > 0
      ? [...merged.map((entry) => entry.amount), leftoverPotAmount]
      : merged.map((entry) => entry.amount);

  const remaining = [...bucketTargets];
  const allocations: Array<Record<Denomination, number>> = bucketTargets.map(() => ({
    5: 0,
    10: 0,
    50: 0,
    100: 0,
  }));

  for (const denom of DESCENDING_DENOMINATIONS) {
    let available = pot[denom];
    let capacity = 0;
    for (const rem of remaining) {
      capacity += Math.floor(rem / denom);
    }
    if (available > capacity) {
      return null;
    }

    for (let i = 0; i < remaining.length && available > 0; i++) {
      const rem = remaining[i]!;
      const take = Math.min(available, Math.floor(rem / denom));
      if (take > 0) {
        allocations[i]![denom] = take;
        remaining[i] = rem - take * denom;
        available -= take;
      }
    }

    if (available !== 0) {
      return null;
    }
  }

  for (const rem of remaining) {
    if (rem !== 0) {
      return null;
    }
  }

  return merged.map((entry, index) => ({
    playerId: entry.playerId,
    amount: entry.amount,
    chips: allocations[index]!,
  }));
}
