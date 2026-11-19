export const DENOMINATIONS = [5, 10, 50, 100] as const;
export type Denomination = (typeof DENOMINATIONS)[number];

/** Chip count per denomination; every count must be a non-negative integer. */
export type ChipCounts = Readonly<Record<Denomination, number>>;

/** Physical Accate chip set: total 6,500 points across 4 denominations. */
export const CHIP_SET: ChipCounts = Object.freeze({
  5: 100,
  10: 100,
  50: 50,
  100: 25,
});

function assertNonNegativeCounts(c: ChipCounts, context: string): void {
  for (const denom of DENOMINATIONS) {
    const count = c[denom];
    if (!Number.isInteger(count) || count < 0) {
      throw new RangeError(`${context}: invalid chip count for ${denom}: ${String(count)}`);
    }
  }
}

export function emptyChips(): ChipCounts {
  return { 5: 0, 10: 0, 50: 0, 100: 0 };
}

export function chipValue(c: ChipCounts): number {
  assertNonNegativeCounts(c, 'chipValue');
  let total = 0;
  for (const denom of DENOMINATIONS) {
    total += denom * c[denom];
  }
  return total;
}

export function addChips(a: ChipCounts, b: ChipCounts): ChipCounts {
  assertNonNegativeCounts(a, 'addChips(a)');
  assertNonNegativeCounts(b, 'addChips(b)');
  return {
    5: a[5] + b[5],
    10: a[10] + b[10],
    50: a[50] + b[50],
    100: a[100] + b[100],
  };
}

/**
 * Subtracts `b` from `a` per denomination.
 * Throws if any denomination would become negative, regardless of total point value.
 */
export function subtractChips(a: ChipCounts, b: ChipCounts): ChipCounts {
  assertNonNegativeCounts(a, 'subtractChips(a)');
  assertNonNegativeCounts(b, 'subtractChips(b)');

  const next5 = a[5] - b[5];
  const next10 = a[10] - b[10];
  const next50 = a[50] - b[50];
  const next100 = a[100] - b[100];

  if (next5 < 0 || next10 < 0 || next50 < 0 || next100 < 0) {
    throw new RangeError(
      `Insufficient chips by denomination: a=${JSON.stringify(a)}, b=${JSON.stringify(b)}`,
    );
  }

  return {
    5: next5,
    10: next10,
    50: next50,
    100: next100,
  };
}

/**
 * INV-1: total chips across all locations (stacks, pots, out-of-turn chips, bank)
 * must equal CHIP_SET for EACH denomination.
 * When `ok` is false, `diff[denom]` is `actualTotal[denom] - CHIP_SET[denom]`
 * (positive = surplus, negative = deficit).
 */
export function checkInv1(
  locations: readonly ChipCounts[],
): { ok: true } | { ok: false; diff: Record<Denomination, number> } {
  const totals: Record<Denomination, number> = { 5: 0, 10: 0, 50: 0, 100: 0 };
  let hasNegative = false;

  for (const loc of locations) {
    for (const denom of DENOMINATIONS) {
      const count = loc[denom];
      if (!Number.isInteger(count)) {
        throw new RangeError(`checkInv1: non-integer chip count for ${denom}: ${String(count)}`);
      }
      if (count < 0) {
        hasNegative = true;
      }
      totals[denom] += count;
    }
  }

  const diff: Record<Denomination, number> = {
    5: totals[5] - CHIP_SET[5],
    10: totals[10] - CHIP_SET[10],
    50: totals[50] - CHIP_SET[50],
    100: totals[100] - CHIP_SET[100],
  };

  if (hasNegative || diff[5] !== 0 || diff[10] !== 0 || diff[50] !== 0 || diff[100] !== 0) {
    return { ok: false, diff };
  }

  return { ok: true };
}
