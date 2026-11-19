import {
  addChips,
  chipValue,
  DENOMINATIONS,
  subtractChips,
  type ChipCounts,
  type Denomination,
} from './chips';

/**
 * Exchanges `fromA` from `a` with `fromB` from `b` of equal total point value.
 * Throws if total values differ or either side lacks any denomination being given.
 */
export function exchangeChips(
  a: ChipCounts,
  b: ChipCounts,
  fromA: ChipCounts,
  fromB: ChipCounts,
): { a: ChipCounts; b: ChipCounts } {
  const valueFromA = chipValue(fromA);
  const valueFromB = chipValue(fromB);

  if (valueFromA !== valueFromB) {
    throw new RangeError(`Exchange values must be equal: fromA=${valueFromA}, fromB=${valueFromB}`);
  }

  const nextA = addChips(subtractChips(a, fromA), fromB);
  const nextB = addChips(subtractChips(b, fromB), fromA);

  return { a: nextA, b: nextB };
}

/**
 * Suggests a breakdown of a single `chip` into smaller denominations from `counterparty`
 * with equal total value, greedily taking the largest smaller denominations first.
 * Returns `null` if `counterparty` cannot cover the value with strictly smaller chips.
 */
export function defaultBreakdown(chip: Denomination, counterparty: ChipCounts): ChipCounts | null {
  chipValue(counterparty);
  if (!DENOMINATIONS.includes(chip)) {
    throw new RangeError(`Invalid chip denomination: ${String(chip)}`);
  }

  let remaining: number = chip;
  const breakdown: Record<Denomination, number> = { 5: 0, 10: 0, 50: 0, 100: 0 };

  for (let i = DENOMINATIONS.length - 1; i >= 0; i--) {
    const denom = DENOMINATIONS[i];
    if (denom === undefined || denom >= chip) {
      continue;
    }
    const take = Math.min(counterparty[denom], Math.floor(remaining / denom));
    breakdown[denom] = take;
    remaining -= take * denom;
  }

  return remaining === 0 ? breakdown : null;
}

/**
 * Checks whether the selected chips match the exact target `amount` (AC C2).
 */
export function selectionMatches(selection: ChipCounts, amount: number): boolean {
  const total = chipValue(selection);
  return Number.isInteger(amount) && amount >= 0 && total === amount;
}
