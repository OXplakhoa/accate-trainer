import { describe, expect, it } from 'vitest';
import {
  addChips,
  CHIP_SET,
  checkInv1,
  chipValue,
  emptyChips,
  subtractChips,
  type ChipCounts,
} from '../../src/engine/chips';
import { defaultBreakdown, exchangeChips, selectionMatches } from '../../src/engine/exchange';

describe('exchange', () => {
  it('C2: selectionMatches checks exact chip selection value against target amount', () => {
    const bank: ChipCounts = subtractChips(CHIP_SET, { 5: 1, 10: 3, 50: 0, 100: 0 });
    const stack: ChipCounts = { 5: 1, 10: 3, 50: 0, 100: 0 };
    expect(checkInv1([bank, stack])).toEqual({ ok: true });

    // Selecting 35 when 30 is required -> false (confirm button locked)
    expect(selectionMatches({ 5: 1, 10: 3, 50: 0, 100: 0 }, 30)).toBe(false);
    // Selecting 30 when 30 is required -> true (confirm button enabled)
    expect(selectionMatches({ 5: 0, 10: 3, 50: 0, 100: 0 }, 30)).toBe(true);
    expect(selectionMatches({ 5: 2, 10: 2, 50: 0, 100: 0 }, 30)).toBe(true);
    expect(selectionMatches(emptyChips(), 0)).toBe(true);
    expect(selectionMatches(emptyChips(), -5)).toBe(false);
    expect(selectionMatches(emptyChips(), 10.5)).toBe(false);
    expect(checkInv1([bank, stack])).toEqual({ ok: true });
  });

  it('C3: hero breaks a 50 chip with counterparty to call 35 while preserving INV-1', () => {
    const heroStack: ChipCounts = { 5: 0, 10: 0, 50: 3, 100: 1 }; // 250
    const counterparty: ChipCounts = { 5: 4, 10: 4, 50: 1, 100: 0 }; // 110
    const pot: ChipCounts = emptyChips();
    const restOfTable: ChipCounts = subtractChips(CHIP_SET, addChips(heroStack, counterparty));

    expect(checkInv1([heroStack, counterparty, pot, restOfTable])).toEqual({ ok: true });

    const breakdown = defaultBreakdown(50, counterparty);
    expect(breakdown).toEqual({ 5: 2, 10: 4, 50: 0, 100: 0 });
    expect(chipValue(breakdown!)).toBe(50);

    const { a: nextHero, b: nextCounterparty } = exchangeChips(
      heroStack,
      counterparty,
      { 5: 0, 10: 0, 50: 1, 100: 0 },
      breakdown!,
    );

    expect(chipValue(nextHero)).toBe(chipValue(heroStack));
    expect(chipValue(nextCounterparty)).toBe(chipValue(counterparty));
    expect(checkInv1([nextHero, nextCounterparty, pot, restOfTable])).toEqual({ ok: true });

    // Hero can now pay exact 35 (e.g. 3x10 + 1x5) into the pot
    const call35: ChipCounts = { 5: 1, 10: 3, 50: 0, 100: 0 };
    expect(selectionMatches(call35, 35)).toBe(true);
    const heroAfterCall = subtractChips(nextHero, call35);
    const potAfterCall = addChips(pot, call35);
    expect(checkInv1([heroAfterCall, nextCounterparty, potAfterCall, restOfTable])).toEqual({
      ok: true,
    });

    // Insufficient smaller chips at counterparty -> null
    const noSmallChips: ChipCounts = { 5: 1, 10: 4, 50: 2, 100: 1 }; // only 45 in <50 chips
    const remainder = subtractChips(CHIP_SET, noSmallChips);
    expect(checkInv1([noSmallChips, remainder])).toEqual({ ok: true });
    expect(defaultBreakdown(50, noSmallChips)).toBeNull();
    expect(defaultBreakdown(5, { 5: 10, 10: 10, 50: 5, 100: 5 })).toBeNull();
    expect(checkInv1([noSmallChips, remainder])).toEqual({ ok: true });
  });

  it('defaultBreakdown handles 100 and 10 chips greedily from largest smaller denomination down', () => {
    const counterparty: ChipCounts = { 5: 4, 10: 4, 50: 1, 100: 2 };
    const rest = subtractChips(CHIP_SET, counterparty);
    expect(checkInv1([counterparty, rest])).toEqual({ ok: true });

    expect(defaultBreakdown(100, counterparty)).toEqual({ 5: 2, 10: 4, 50: 1, 100: 0 });
    expect(defaultBreakdown(10, counterparty)).toEqual({ 5: 2, 10: 0, 50: 0, 100: 0 });
    expect(checkInv1([counterparty, rest])).toEqual({ ok: true });
  });

  it('exchangeChips throws when values differ or either side lacks a denomination', () => {
    const a: ChipCounts = { 5: 0, 10: 0, 50: 2, 100: 0 };
    const b: ChipCounts = { 5: 4, 10: 8, 50: 0, 100: 0 };
    const rest = subtractChips(CHIP_SET, addChips(a, b));
    expect(checkInv1([a, b, rest])).toEqual({ ok: true });

    // Value mismatch (50 vs 40)
    expect(() =>
      exchangeChips(a, b, { 5: 0, 10: 0, 50: 1, 100: 0 }, { 5: 0, 10: 4, 50: 0, 100: 0 }),
    ).toThrow();

    // Side a lacks 10-chips even though total stack value is 100
    expect(() =>
      exchangeChips(a, b, { 5: 0, 10: 5, 50: 0, 100: 0 }, { 5: 0, 10: 5, 50: 0, 100: 0 }),
    ).toThrow();

    // Side b lacks 50-chips
    expect(() =>
      exchangeChips(a, b, { 5: 0, 10: 0, 50: 1, 100: 0 }, { 5: 0, 10: 0, 50: 1, 100: 0 }),
    ).toThrow();

    expect(checkInv1([a, b, rest])).toEqual({ ok: true });
  });
});
