import { describe, expect, it } from 'vitest';
import { addChips, CHIP_SET, checkInv1, chipValue, emptyChips, subtractChips, type ChipCounts } from '../../src/engine/chips';
import { calculatePots, planPotPayouts } from '../../src/engine/pots';

function verifyPotConservation(
  contributions: readonly { playerId: string; amount: number; folded: boolean }[],
) {
  const breakdown = calculatePots(contributions);
  const totalIn = contributions.reduce((sum, c) => sum + c.amount, 0);
  const totalOut =
    breakdown.pots.reduce((sum, p) => sum + p.amount, 0) +
    (breakdown.uncalledRefund?.amount ?? 0);
  expect(totalOut).toBe(totalIn);
  return breakdown;
}

describe('pots and payout planning', () => {
  it('P1: builds main pot 110 (A, B, C) and side pot 40 (B, C) while keeping folded D ante in pot', () => {
    const breakdown = verifyPotConservation([
      { playerId: 'A', amount: 35, folded: false }, // 5 ante + 30 all-in
      { playerId: 'B', amount: 55, folded: false }, // 5 ante + 50 bet
      { playerId: 'C', amount: 55, folded: false }, // 5 ante + 50 call
      { playerId: 'D', amount: 5, folded: true }, // 5 ante then folded
    ]);

    expect(breakdown.uncalledRefund).toBeNull();
    expect(breakdown.pots).toEqual([
      { index: 0, amount: 110, eligiblePlayerIds: ['A', 'B', 'C'] },
      { index: 1, amount: 40, eligiblePlayerIds: ['B', 'C'] },
    ]);
    expect(checkInv1([CHIP_SET])).toEqual({ ok: true });
  });

  it('P2: adds turn betting between B and C into side pot (120) without changing main pot (110)', () => {
    const breakdown = verifyPotConservation([
      { playerId: 'A', amount: 35, folded: false },
      { playerId: 'B', amount: 95, folded: false }, // +40 on turn
      { playerId: 'C', amount: 95, folded: false }, // +40 on turn
      { playerId: 'D', amount: 5, folded: true },
    ]);

    expect(breakdown.uncalledRefund).toBeNull();
    expect(breakdown.pots).toEqual([
      { index: 0, amount: 110, eligiblePlayerIds: ['A', 'B', 'C'] },
      { index: 1, amount: 120, eligiblePlayerIds: ['B', 'C'] },
    ]);
    expect(checkInv1([CHIP_SET])).toEqual({ ok: true });
  });

  it('P4: builds main 80 (A,B,C,D), side 1 60 (B,C,D), side 2 30 (B,C) totaling 170', () => {
    const breakdown = verifyPotConservation([
      { playerId: 'A', amount: 20, folded: false }, // 5 ante + 15 all-in
      { playerId: 'B', amount: 55, folded: false }, // 5 ante + 50 bet
      { playerId: 'C', amount: 55, folded: false }, // 5 ante + 50 call
      { playerId: 'D', amount: 40, folded: false }, // 5 ante + 35 all-in
    ]);

    expect(breakdown.uncalledRefund).toBeNull();
    expect(breakdown.pots).toEqual([
      { index: 0, amount: 80, eligiblePlayerIds: ['A', 'B', 'C', 'D'] },
      { index: 1, amount: 60, eligiblePlayerIds: ['B', 'C', 'D'] },
      { index: 2, amount: 30, eligiblePlayerIds: ['B', 'C'] },
    ]);
    expect(checkInv1([CHIP_SET])).toEqual({ ok: true });
  });

  it('separates uncalled bet excess when one player exceeds all others at showdown', () => {
    const breakdown = verifyPotConservation([
      { playerId: 'A', amount: 35, folded: false },
      { playerId: 'B', amount: 55, folded: false },
      { playerId: 'C', amount: 5, folded: true },
      { playerId: 'D', amount: 5, folded: true },
    ]);

    expect(breakdown.uncalledRefund).toEqual({ playerId: 'B', amount: 20 });
    expect(breakdown.pots).toEqual([{ index: 0, amount: 80, eligiblePlayerIds: ['A', 'B'] }]);
    expect(checkInv1([CHIP_SET])).toEqual({ ok: true });
  });

  it('awards entire pot to sole non-folded player on fold-win (R8/R15)', () => {
    const breakdown = verifyPotConservation([
      { playerId: 'A', amount: 55, folded: false },
      { playerId: 'B', amount: 5, folded: true },
      { playerId: 'C', amount: 5, folded: true },
      { playerId: 'D', amount: 5, folded: true },
    ]);

    expect(breakdown.uncalledRefund).toBeNull();
    expect(breakdown.pots).toEqual([{ index: 0, amount: 70, eligiblePlayerIds: ['A'] }]);
    expect(checkInv1([CHIP_SET])).toEqual({ ok: true });
  });

  it('planPotPayouts computes exact denomination transfers for multi-way payouts and refunds while preserving INV-1', () => {
    const pot: ChipCounts = { 5: 4, 10: 6, 50: 3, 100: 0 }; // 230
    const rest = subtractChips(CHIP_SET, pot);
    expect(checkInv1([pot, rest])).toEqual({ ok: true });

    const transfers = planPotPayouts(pot, [
      { playerId: 'A', amount: 110 },
      { playerId: 'B', amount: 120 },
    ]);
    expect(transfers).not.toBeNull();
    expect(transfers!.map((t) => [t.playerId, t.amount, chipValue(t.chips)])).toEqual([
      ['A', 110, 110],
      ['B', 120, 120],
    ]);

    let remainingPot = pot;
    let paid = emptyChips();
    for (const transfer of transfers!) {
      remainingPot = subtractChips(remainingPot, transfer.chips);
      paid = addChips(paid, transfer.chips);
    }
    expect(remainingPot).toEqual(emptyChips());
    expect(checkInv1([remainingPot, paid, rest])).toEqual({ ok: true });

    // Partial extraction (uncalled refund of 20 from 230 pot)
    const refund = planPotPayouts(pot, [{ playerId: 'B', amount: 20 }]);
    expect(refund).not.toBeNull();
    expect(chipValue(refund![0]!.chips)).toBe(20);
    const potAfterRefund = subtractChips(pot, refund![0]!.chips);
    expect(chipValue(potAfterRefund)).toBe(210);
    expect(checkInv1([potAfterRefund, refund![0]!.chips, rest])).toEqual({ ok: true });
  });

  it('planPotPayouts returns null when pot denominations cannot form exact split (QUESTIONS.md #2)', () => {
    const unbreakablePot: ChipCounts = { 5: 1, 10: 1, 50: 0, 100: 1 }; // 115
    const rest = subtractChips(CHIP_SET, unbreakablePot);
    expect(checkInv1([unbreakablePot, rest])).toEqual({ ok: true });

    expect(
      planPotPayouts(unbreakablePot, [
        { playerId: 'B', amount: 60 },
        { playerId: 'C', amount: 55 },
      ]),
    ).toBeNull();
    expect(checkInv1([unbreakablePot, rest])).toEqual({ ok: true });
  });
});
