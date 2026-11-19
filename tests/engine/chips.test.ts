import { describe, expect, it } from 'vitest';
import {
  addChips,
  CHIP_SET,
  checkInv1,
  chipValue,
  DENOMINATIONS,
  emptyChips,
  subtractChips,
  type ChipCounts,
} from '../../src/engine';

describe('chips', () => {
  it('computes chipValue(CHIP_SET) === 6500', () => {
    expect(DENOMINATIONS).toEqual([5, 10, 50, 100]);
    expect(chipValue(CHIP_SET)).toBe(6500);
    expect(chipValue(emptyChips())).toBe(0);
  });

  it('addChips and subtractChips operate per denomination', () => {
    const a: ChipCounts = { 5: 4, 10: 3, 50: 2, 100: 1 };
    const b: ChipCounts = { 5: 1, 10: 2, 50: 1, 100: 0 };

    const sum = addChips(a, b);
    expect(sum).toEqual({ 5: 5, 10: 5, 50: 3, 100: 1 });
    expect(chipValue(sum)).toBe(chipValue(a) + chipValue(b));

    const diff = subtractChips(a, b);
    expect(diff).toEqual({ 5: 3, 10: 1, 50: 1, 100: 1 });
  });

  it('subtractChips throws when any denomination goes negative even if total value is sufficient', () => {
    const tenTens: ChipCounts = { 5: 0, 10: 10, 50: 0, 100: 0 }; // value 100
    const oneFifty: ChipCounts = { 5: 0, 10: 0, 50: 1, 100: 0 }; // value 50

    expect(chipValue(tenTens)).toBe(100);
    expect(chipValue(oneFifty)).toBe(50);
    expect(() => subtractChips(tenTens, oneFifty)).toThrow();
  });

  it('checkInv1 passes for [CHIP_SET] and for a 4-way partition of CHIP_SET', () => {
    expect(checkInv1([CHIP_SET])).toEqual({ ok: true });

    const p1: ChipCounts = { 5: 25, 10: 25, 50: 10, 100: 5 };
    const p2: ChipCounts = { 5: 25, 10: 25, 50: 15, 100: 5 };
    const pot: ChipCounts = { 5: 10, 10: 10, 50: 5, 100: 5 };
    const bank: ChipCounts = { 5: 40, 10: 40, 50: 20, 100: 10 };

    expect(checkInv1([p1, p2, pot, bank])).toEqual({ ok: true });
  });

  it('checkInv1 reports exact per-denomination diff when missing 1x10 and having 2 extra 5s', () => {
    // Total value happens to be 6500 (2*5 - 1*10 = 0), so value-only check would miss this bug!
    const skewed: ChipCounts = { 5: 102, 10: 99, 50: 50, 100: 25 };
    expect(chipValue(skewed)).toBe(6500);

    expect(checkInv1([skewed])).toEqual({
      ok: false,
      diff: { 5: 2, 10: -1, 50: 0, 100: 0 },
    });
  });

  it('checkInv1 throws RangeError when any location has negative or non-integer counts', () => {
    const over: ChipCounts = { 5: 101, 10: 100, 50: 50, 100: 25 };
    const negative: ChipCounts = { 5: -1, 10: 0, 50: 0, 100: 0 };
    const fractional: ChipCounts = { 5: 0.5, 10: 0, 50: 0, 100: 0 };

    expect(() => checkInv1([over, negative])).toThrow(RangeError);
    expect(() => checkInv1([CHIP_SET, fractional])).toThrow(RangeError);
  });

  it('checkInv1([]) returns ok:false with diff equal to -CHIP_SET', () => {
    expect(checkInv1([])).toEqual({
      ok: false,
      diff: {
        5: -CHIP_SET[5],
        10: -CHIP_SET[10],
        50: -CHIP_SET[50],
        100: -CHIP_SET[100],
      },
    });
  });

  it('chipValue, addChips, and subtractChips throw RangeError on negative or fractional counts', () => {
    const valid = emptyChips();
    const negative: ChipCounts = { 5: 0, 10: -1, 50: 0, 100: 0 };
    const fractional: ChipCounts = { 5: 0, 10: 0, 50: 1.5, 100: 0 };

    expect(() => chipValue(negative)).toThrow(RangeError);
    expect(() => chipValue(fractional)).toThrow(RangeError);

    expect(() => addChips(negative, valid)).toThrow(RangeError);
    expect(() => addChips(valid, negative)).toThrow(RangeError);
    expect(() => addChips(fractional, valid)).toThrow(RangeError);
    expect(() => addChips(valid, fractional)).toThrow(RangeError);

    expect(() => subtractChips(negative, valid)).toThrow(RangeError);
    expect(() => subtractChips(valid, negative)).toThrow(RangeError);
    expect(() => subtractChips(fractional, valid)).toThrow(RangeError);
    expect(() => subtractChips(valid, fractional)).toThrow(RangeError);
  });
});
