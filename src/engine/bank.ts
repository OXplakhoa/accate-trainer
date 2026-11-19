import { addChips, CHIP_SET, chipValue, emptyChips, subtractChips, type ChipCounts } from './chips';

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 10;
export const BUY_IN = 500;

interface SmallChipCandidate {
  readonly a: number;
  readonly b: number;
  readonly smallVal: number;
}

/**
 * Computes a 500-point chip breakdown from `available` using the generalized spec §3.5.1 algorithm:
 * maximize `a + b` (count of 5 and 10 chips) where `5a + 10b` is a multiple of 50 (tie-breaking by
 * larger `a`), then make up `500 - 5a - 10b` from 50 and 100 chips prioritizing larger count of 50s.
 * Returns `null` if no valid 500-point combination exists in `available`.
 */
export function structureFor500(available: ChipCounts): ChipCounts | null {
  if (chipValue(available) < BUY_IN) {
    return null;
  }

  const maxA = Math.min(available[5], BUY_IN / 5);
  const maxB = Math.min(available[10], BUY_IN / 10);
  const candidates: SmallChipCandidate[] = [];

  for (let a = 0; a <= maxA; a++) {
    for (let b = 0; b <= maxB; b++) {
      const smallVal = 5 * a + 10 * b;
      if (smallVal > BUY_IN) {
        break;
      }
      if (smallVal % 50 === 0) {
        candidates.push({ a, b, smallVal });
      }
    }
  }

  candidates.sort((x, y) => {
    const countDiff = y.a + y.b - (x.a + x.b);
    return countDiff !== 0 ? countDiff : y.a - x.a;
  });

  for (const { a, b, smallVal } of candidates) {
    const remainder = BUY_IN - smallVal;
    const maxC = Math.min(available[50], remainder / 50);

    for (let c = maxC; c >= 0; c--) {
      const after50 = remainder - 50 * c;
      if (after50 % 100 === 0) {
        const d = after50 / 100;
        if (d <= available[100]) {
          return { 5: a, 10: b, 50: c, 100: d };
        }
      }
    }
  }

  return null;
}

/**
 * Computes the initial per-player 500-point chip distribution and remaining bank for `n` players
 * (spec §3.5.1, AC C1/C1b). Throws `RangeError` if `n` is not an integer in `[4, 10]`.
 */
export function initialDistribution(n: number): { perPlayer: ChipCounts; bank: ChipCounts } {
  if (!Number.isInteger(n) || n < MIN_PLAYERS || n > MAX_PLAYERS) {
    throw new RangeError(
      `Player count must be an integer in [${MIN_PLAYERS}, ${MAX_PLAYERS}], received ${String(n)}`,
    );
  }

  const perPlayerMax: ChipCounts = {
    5: Math.floor(CHIP_SET[5] / n),
    10: Math.floor(CHIP_SET[10] / n),
    50: Math.floor(CHIP_SET[50] / n),
    100: Math.floor(CHIP_SET[100] / n),
  };

  const perPlayer = structureFor500(perPlayerMax);
  if (perPlayer === null) {
    throw new Error(`Unable to compute initial chip distribution for ${n} players`);
  }

  const totalDealt: ChipCounts = {
    5: n * perPlayer[5],
    10: n * perPlayer[10],
    50: n * perPlayer[50],
    100: n * perPlayer[100],
  };

  return {
    perPlayer,
    bank: subtractChips(CHIP_SET, totalDealt),
  };
}

/**
 * Extracts chips summing to `amount` from `source`, prioritizing largest denominations first
 * (100, then 50, then 10, then 5). Returns `null` if `amount` cannot be formed exactly.
 */
export function takeExactLargeFirst(source: ChipCounts, amount: number): ChipCounts | null {
  const totalAvailable = chipValue(source);
  if (!Number.isInteger(amount) || amount < 0) {
    throw new RangeError(`amount must be a non-negative integer, received ${String(amount)}`);
  }
  if (amount === 0) {
    return emptyChips();
  }
  if (amount % 5 !== 0 || totalAvailable < amount) {
    return null;
  }

  const maxRemAfter100 = 50 * source[50] + 10 * source[10] + 5 * source[5];
  const maxRemAfter50 = 10 * source[10] + 5 * source[5];
  const maxRemAfter10 = 5 * source[5];

  for (let d100 = Math.min(source[100], Math.floor(amount / 100)); d100 >= 0; d100--) {
    const rem100 = amount - 100 * d100;
    if (rem100 > maxRemAfter100) {
      break;
    }
    for (let d50 = Math.min(source[50], Math.floor(rem100 / 50)); d50 >= 0; d50--) {
      const rem50 = rem100 - 50 * d50;
      if (rem50 > maxRemAfter50) {
        break;
      }
      for (let d10 = Math.min(source[10], Math.floor(rem50 / 10)); d10 >= 0; d10--) {
        const rem10 = rem50 - 10 * d10;
        if (rem10 > maxRemAfter10) {
          break;
        }
        if (rem10 % 5 === 0) {
          return { 5: rem10 / 5, 10: d10, 50: d50, 100: d100 };
        }
      }
    }
  }

  return null;
}

export interface SeatedStack {
  readonly playerId: string;
  readonly stack: ChipCounts;
}

export type BuyInPlan =
  | { readonly kind: 'from-bank'; readonly chips: ChipCounts }
  | {
      readonly kind: 'cash-out-then-bank';
      readonly cashOutPlayerId: string;
      readonly cashOutChips: ChipCounts;
      readonly chips: ChipCounts;
    };

/**
 * Plans a 500-point buy-in or rebuy for `buyerId` (AC C4, C5, C6, T4).
 * Uses `structureFor500(bank)` directly if possible; otherwise cashes out 500 (large chips first)
 * from the eligible seated player with the highest stack value (excluding `buyerId`, breaking ties
 * clockwise starting from `openerIndex`), then draws 500 from the replenished bank.
 */
export function planBuyIn(
  bank: ChipCounts,
  seats: readonly SeatedStack[],
  buyerId: string,
  openerIndex: number,
): BuyInPlan {
  if (
    seats.length > 0 &&
    (!Number.isInteger(openerIndex) || openerIndex < 0 || openerIndex >= seats.length)
  ) {
    throw new RangeError(
      `openerIndex must be an integer in [0, ${seats.length - 1}], received ${String(openerIndex)}`,
    );
  }

  for (const seat of seats) {
    chipValue(seat.stack);
  }

  const direct = structureFor500(bank);
  if (direct !== null) {
    return { kind: 'from-bank', chips: direct };
  }

  if (seats.length === 0) {
    throw new Error('Cannot plan buy-in: bank lacks 500 chips and no seated players can cash out');
  }

  let bestSeat: SeatedStack | null = null;
  let bestValue = -1;

  for (let offset = 0; offset < seats.length; offset++) {
    const seat = seats[(openerIndex + offset) % seats.length];
    if (seat === undefined || seat.playerId === buyerId) {
      continue;
    }
    const stackValue = chipValue(seat.stack);
    if (bestSeat === null || stackValue > bestValue) {
      bestSeat = seat;
      bestValue = stackValue;
    }
  }

  if (bestSeat === null) {
    throw new Error(
      `Cannot plan buy-in for "${buyerId}": bank lacks 500 chips and no other player is seated to cash out`,
    );
  }

  if (bestValue < BUY_IN) {
    throw new Error(
      `Cannot plan buy-in for "${buyerId}": largest eligible stack ("${bestSeat.playerId}" with ${bestValue}) is below ${BUY_IN}`,
    );
  }

  const cashOutChips = takeExactLargeFirst(bestSeat.stack, BUY_IN);
  if (cashOutChips === null) {
    throw new Error(
      `Cannot cash out exact ${BUY_IN} from player "${bestSeat.playerId}" stack: ${JSON.stringify(bestSeat.stack)}`,
    );
  }

  const replenishedBank = addChips(bank, cashOutChips);
  const chips = structureFor500(replenishedBank);
  if (chips === null) {
    throw new Error(
      `Cannot form ${BUY_IN} from bank after cashing out player "${bestSeat.playerId}"`,
    );
  }

  return {
    kind: 'cash-out-then-bank',
    cashOutPlayerId: bestSeat.playerId,
    cashOutChips,
    chips,
  };
}
