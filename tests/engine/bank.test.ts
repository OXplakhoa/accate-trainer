import { describe, expect, it } from 'vitest';
import {
  BUY_IN,
  initialDistribution,
  MAX_PLAYERS,
  MIN_PLAYERS,
  planBuyIn,
  structureFor500,
  takeExactLargeFirst,
  type SeatedStack,
} from '../../src/engine/bank';
import {
  addChips,
  CHIP_SET,
  checkInv1,
  chipValue,
  emptyChips,
  subtractChips,
  type ChipCounts,
} from '../../src/engine/chips';

const SPEC_TABLE_3_5_1: ReadonlyArray<{
  readonly n: number;
  readonly perPlayer: ChipCounts;
  readonly bank: ChipCounts;
}> = [
  {
    n: 4,
    perPlayer: { 5: 24, 10: 23, 50: 3, 100: 0 },
    bank: { 5: 4, 10: 8, 50: 38, 100: 25 },
  },
  {
    n: 5,
    perPlayer: { 5: 20, 10: 20, 50: 4, 100: 0 },
    bank: { 5: 0, 10: 0, 50: 30, 100: 25 },
  },
  {
    n: 6,
    perPlayer: { 5: 16, 10: 12, 50: 6, 100: 0 },
    bank: { 5: 4, 10: 28, 50: 14, 100: 25 },
  },
  {
    n: 7,
    perPlayer: { 5: 14, 10: 13, 50: 6, 100: 0 },
    bank: { 5: 2, 10: 9, 50: 8, 100: 25 },
  },
  {
    n: 8,
    perPlayer: { 5: 12, 10: 9, 50: 5, 100: 1 },
    bank: { 5: 4, 10: 28, 50: 10, 100: 17 },
  },
  {
    n: 9,
    perPlayer: { 5: 10, 10: 10, 50: 5, 100: 1 },
    bank: { 5: 10, 10: 10, 50: 5, 100: 16 },
  },
  {
    n: 10,
    perPlayer: { 5: 10, 10: 10, 50: 5, 100: 1 },
    bank: { 5: 0, 10: 0, 50: 0, 100: 15 },
  },
];

describe('bank', () => {
  it('exports expected constants', () => {
    expect(MIN_PLAYERS).toBe(4);
    expect(MAX_PLAYERS).toBe(10);
    expect(BUY_IN).toBe(500);
    expect(checkInv1([CHIP_SET])).toEqual({ ok: true });
  });

  it('C1: initialDistribution matches every row of spec §3.5.1 and satisfies INV-1', () => {
    for (const row of SPEC_TABLE_3_5_1) {
      const { perPlayer, bank } = initialDistribution(row.n);
      expect(perPlayer).toEqual(row.perPlayer);
      expect(bank).toEqual(row.bank);
      expect(chipValue(perPlayer)).toBe(BUY_IN);

      const stacks = Array.from({ length: row.n }, () => perPlayer);
      expect(checkInv1([bank, ...stacks])).toEqual({ ok: true });
    }
  });

  it('C1b: initialDistribution throws for invalid player counts', () => {
    for (const bad of [3, 11, 0, -4, 4.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => initialDistribution(bad)).toThrow(RangeError);
    }
    expect(checkInv1([CHIP_SET])).toEqual({ ok: true });
  });

  it('structureFor500 handles partial/odd banks and returns null when 500 cannot be formed', () => {
    const onlyLarge: ChipCounts = { 5: 0, 10: 0, 50: 4, 100: 5 };
    const onlyLargeChosen = structureFor500(onlyLarge);
    expect(onlyLargeChosen).toEqual({ 5: 0, 10: 0, 50: 4, 100: 3 });
    expect(
      checkInv1([
        onlyLargeChosen!,
        subtractChips(onlyLarge, onlyLargeChosen!),
        subtractChips(CHIP_SET, onlyLarge),
      ]),
    ).toEqual({ ok: true });

    const noFives: ChipCounts = { 5: 0, 10: 10, 50: 2, 100: 4 };
    const noFivesChosen = structureFor500(noFives);
    expect(noFivesChosen).toEqual({ 5: 0, 10: 10, 50: 2, 100: 3 });
    expect(
      checkInv1([
        noFivesChosen!,
        subtractChips(noFives, noFivesChosen!),
        subtractChips(CHIP_SET, noFives),
      ]),
    ).toEqual({ ok: true });

    // Backtracks (a, b) from (4, 2) (sum 40 -> not multiple of 50) / (5, 0) (rem 475, no 25) to (0, 0)
    const fallbackTo100s: ChipCounts = { 5: 5, 10: 0, 50: 0, 100: 5 };
    const fallbackChosen = structureFor500(fallbackTo100s);
    expect(fallbackChosen).toEqual({ 5: 0, 10: 0, 50: 0, 100: 5 });
    expect(
      checkInv1([
        fallbackChosen!,
        subtractChips(fallbackTo100s, fallbackChosen!),
        subtractChips(CHIP_SET, fallbackTo100s),
      ]),
    ).toEqual({ ok: true });

    const insufficient: ChipCounts = { 5: 1, 10: 4, 50: 1, 100: 4 }; // 495 < 500
    expect(structureFor500(insufficient)).toBeNull();
    expect(checkInv1([insufficient, subtractChips(CHIP_SET, insufficient)])).toEqual({ ok: true });
  });

  it('takeExactLargeFirst prioritizes 100 > 50 > 10 > 5 and returns null when impossible', () => {
    const stack: ChipCounts = { 5: 10, 10: 10, 50: 6, 100: 3 };
    const taken = takeExactLargeFirst(stack, 500);
    expect(taken).toEqual({ 5: 0, 10: 0, 50: 4, 100: 3 });
    expect(
      checkInv1([taken!, subtractChips(stack, taken!), subtractChips(CHIP_SET, stack)]),
    ).toEqual({ ok: true });

    // 140 cannot form 50 because no 50/5 and only 4x10
    const cannotMake50: ChipCounts = { 5: 0, 10: 4, 50: 0, 100: 1 };
    expect(takeExactLargeFirst(cannotMake50, 50)).toBeNull();
    expect(takeExactLargeFirst(stack, 503)).toBeNull();
    expect(takeExactLargeFirst(stack, 0)).toEqual(emptyChips());
    expect(() => takeExactLargeFirst(stack, -5)).toThrow(RangeError);
    expect(checkInv1([stack, subtractChips(CHIP_SET, stack)])).toEqual({ ok: true });
  });

  it('C4: with N = 10, three sequential rebuys draw 5x100 from bank leaving bank at 0', () => {
    const init = initialDistribution(10);
    let bank = init.bank;
    const seats: SeatedStack[] = Array.from({ length: 10 }, (_, i) => ({
      playerId: `p${i}`,
      stack: init.perPlayer,
    }));
    expect(checkInv1([bank, ...seats.map((s) => s.stack)])).toEqual({ ok: true });

    // Simulate p7, p8, p9 busting by transferring their chips to p0, p1, p2
    seats[0] = { playerId: 'p0', stack: addChips(seats[0]!.stack, seats[7]!.stack) };
    seats[7] = { playerId: 'p7', stack: emptyChips() };
    expect(checkInv1([bank, ...seats.map((s) => s.stack)])).toEqual({ ok: true });

    seats[1] = { playerId: 'p1', stack: addChips(seats[1]!.stack, seats[8]!.stack) };
    seats[8] = { playerId: 'p8', stack: emptyChips() };
    expect(checkInv1([bank, ...seats.map((s) => s.stack)])).toEqual({ ok: true });

    seats[2] = { playerId: 'p2', stack: addChips(seats[2]!.stack, seats[9]!.stack) };
    seats[9] = { playerId: 'p9', stack: emptyChips() };
    expect(checkInv1([bank, ...seats.map((s) => s.stack)])).toEqual({ ok: true });

    for (const rebuyIdx of [7, 8, 9]) {
      const buyer = seats[rebuyIdx]!;
      const plan = planBuyIn(bank, seats, buyer.playerId, 0);
      expect(plan).toEqual({ kind: 'from-bank', chips: { 5: 0, 10: 0, 50: 0, 100: 5 } });

      if (plan.kind !== 'from-bank') {
        throw new Error('Expected from-bank plan');
      }
      bank = subtractChips(bank, plan.chips);
      seats[rebuyIdx] = { playerId: buyer.playerId, stack: addChips(buyer.stack, plan.chips) };
      expect(checkInv1([bank, ...seats.map((s) => s.stack)])).toEqual({ ok: true });
    }

    expect(bank).toEqual(emptyChips());
  });

  it('C5: fourth rebuy after bank depletion cashes out largest stack (large chips first) then funds buyer', () => {
    const init = initialDistribution(10);
    let bank = init.bank;
    const seats: SeatedStack[] = Array.from({ length: 10 }, (_, i) => ({
      playerId: `p${i}`,
      stack: init.perPlayer,
    }));

    // Bust p7, p8, p9 -> p0, p1, p2 and rebuy them to exhaust bank (C4 setup)
    seats[0] = { playerId: 'p0', stack: addChips(seats[0]!.stack, seats[7]!.stack) };
    seats[7] = { playerId: 'p7', stack: emptyChips() };
    seats[1] = { playerId: 'p1', stack: addChips(seats[1]!.stack, seats[8]!.stack) };
    seats[8] = { playerId: 'p8', stack: emptyChips() };
    seats[2] = { playerId: 'p2', stack: addChips(seats[2]!.stack, seats[9]!.stack) };
    seats[9] = { playerId: 'p9', stack: emptyChips() };
    expect(checkInv1([bank, ...seats.map((s) => s.stack)])).toEqual({ ok: true });

    for (const rebuyIdx of [7, 8, 9]) {
      const plan = planBuyIn(bank, seats, seats[rebuyIdx]!.playerId, 0);
      if (plan.kind !== 'from-bank') throw new Error('Expected from-bank plan');
      bank = subtractChips(bank, plan.chips);
      seats[rebuyIdx] = {
        playerId: seats[rebuyIdx]!.playerId,
        stack: addChips(seats[rebuyIdx]!.stack, plan.chips),
      };
      expect(checkInv1([bank, ...seats.map((s) => s.stack)])).toEqual({ ok: true });
    }
    expect(bank).toEqual(emptyChips());

    // Now p6 loses their stack to p0 -> p0 is unique largest stack (1500: 3x100, 15x50, 30x10, 30x5)
    seats[0] = { playerId: 'p0', stack: addChips(seats[0]!.stack, seats[6]!.stack) };
    seats[6] = { playerId: 'p6', stack: emptyChips() };
    expect(checkInv1([bank, ...seats.map((s) => s.stack)])).toEqual({ ok: true });

    const plan = planBuyIn(bank, seats, 'p6', 0);
    expect(plan.kind).toBe('cash-out-then-bank');
    if (plan.kind !== 'cash-out-then-bank') {
      throw new Error('Expected cash-out-then-bank plan');
    }

    expect(plan.cashOutPlayerId).toBe('p0');
    // Large chips first from {5: 30, 10: 30, 50: 15, 100: 3}: 3x100 + 4x50 = 500
    expect(plan.cashOutChips).toEqual({ 5: 0, 10: 0, 50: 4, 100: 3 });
    expect(chipValue(plan.chips)).toBe(BUY_IN);

    // Step 1: cash out p0 -> bank
    seats[0] = { playerId: 'p0', stack: subtractChips(seats[0]!.stack, plan.cashOutChips) };
    bank = addChips(bank, plan.cashOutChips);
    expect(checkInv1([bank, ...seats.map((s) => s.stack)])).toEqual({ ok: true });

    // Step 2: bank -> buyer p6
    bank = subtractChips(bank, plan.chips);
    seats[6] = { playerId: 'p6', stack: addChips(seats[6]!.stack, plan.chips) };
    expect(checkInv1([bank, ...seats.map((s) => s.stack)])).toEqual({ ok: true });

    expect(chipValue(seats[0]!.stack)).toBe(1000);
    expect(chipValue(seats[6]!.stack)).toBe(500);
    expect(bank).toEqual(emptyChips());
  });

  it('C6: breaks ties among largest stacks clockwise starting from openerIndex', () => {
    // 10-player chip pool partitioned into 5 seats + empty bank for clean INV-1 verification
    const bank = emptyChips();
    const seats: SeatedStack[] = [
      { playerId: 'p0', stack: emptyChips() }, // buyer (0)
      { playerId: 'p1', stack: { 5: 20, 10: 20, 50: 4, 100: 10 } }, // 1500
      { playerId: 'p2', stack: { 5: 20, 10: 20, 50: 14, 100: 0 } }, // 1000
      { playerId: 'p3', stack: { 5: 20, 10: 20, 50: 4, 100: 10 } }, // 1500 (tied with p1)
      { playerId: 'p4', stack: { 5: 40, 10: 40, 50: 28, 100: 5 } }, // 2500 -> wait, test with p4 lower so p1 & p3 tie at max!
    ];
    // Adjust seats so p1 and p3 tie as the largest stacks (2000 each) and total equals CHIP_SET
    seats[1] = { playerId: 'p1', stack: { 5: 20, 10: 20, 50: 14, 100: 10 } }; // 2000
    seats[2] = { playerId: 'p2', stack: { 5: 40, 10: 40, 50: 12, 100: 3 } }; // 1500
    seats[3] = { playerId: 'p3', stack: { 5: 20, 10: 20, 50: 14, 100: 10 } }; // 2000
    seats[4] = { playerId: 'p4', stack: { 5: 20, 10: 20, 50: 10, 100: 2 } }; // 1000
    expect(checkInv1([bank, ...seats.map((s) => s.stack)])).toEqual({ ok: true });

    // openerIndex = 0 -> clockwise order is p0, p1, p2, p3, p4 -> p1 wins
    const planFrom0 = planBuyIn(bank, seats, 'p0', 0);
    expect(planFrom0.kind).toBe('cash-out-then-bank');
    if (planFrom0.kind !== 'cash-out-then-bank') throw new Error('Expected cash-out-then-bank');
    expect(planFrom0.cashOutPlayerId).toBe('p1');

    // openerIndex = 2 -> clockwise order is p2, p3, p4, p0, p1 -> p3 wins
    const planFrom2 = planBuyIn(bank, seats, 'p0', 2);
    expect(planFrom2.kind).toBe('cash-out-then-bank');
    if (planFrom2.kind !== 'cash-out-then-bank') throw new Error('Expected cash-out-then-bank');
    expect(planFrom2.cashOutPlayerId).toBe('p3');

    // openerIndex = 3 -> p3 is the opener itself (distance 0) -> p3 wins
    const planFrom3 = planBuyIn(bank, seats, 'p0', 3);
    expect(planFrom3.kind).toBe('cash-out-then-bank');
    if (planFrom3.kind !== 'cash-out-then-bank') throw new Error('Expected cash-out-then-bank');
    expect(planFrom3.cashOutPlayerId).toBe('p3');

    // Execute planFrom2 step-by-step and verify INV-1 after each step
    const afterCashOutSeats = seats.map((s) =>
      s.playerId === planFrom2.cashOutPlayerId
        ? { playerId: s.playerId, stack: subtractChips(s.stack, planFrom2.cashOutChips) }
        : s,
    );
    const midBank = addChips(bank, planFrom2.cashOutChips);
    expect(checkInv1([midBank, ...afterCashOutSeats.map((s) => s.stack)])).toEqual({ ok: true });

    const finalSeats = afterCashOutSeats.map((s) =>
      s.playerId === 'p0' ? { playerId: s.playerId, stack: addChips(s.stack, planFrom2.chips) } : s,
    );
    const finalBank = subtractChips(midBank, planFrom2.chips);
    expect(checkInv1([finalBank, ...finalSeats.map((s) => s.stack)])).toEqual({ ok: true });
  });

  it('T4: 3 seated players invite a 4th rival and planBuyIn draws 500 from bank', () => {
    const init = initialDistribution(4);
    let bank = init.bank;
    const seats: SeatedStack[] = [
      { playerId: 'hero', stack: init.perPlayer },
      { playerId: 'rival-1', stack: init.perPlayer },
      { playerId: 'rival-2', stack: init.perPlayer },
      { playerId: 'rival-3', stack: init.perPlayer },
    ];
    expect(checkInv1([bank, ...seats.map((s) => s.stack)])).toEqual({ ok: true });

    // One rival cashes out between hands, leaving 3 seated players
    bank = addChips(bank, seats[3]!.stack);
    const threeSeated = seats.slice(0, 3);
    expect(checkInv1([bank, ...threeSeated.map((s) => s.stack)])).toEqual({ ok: true });

    // Invite replacement rival-4 before next hand
    const plan = planBuyIn(bank, threeSeated, 'rival-4', 0);
    expect(plan.kind).toBe('from-bank');
    expect(chipValue(plan.chips)).toBe(BUY_IN);

    bank = subtractChips(bank, plan.chips);
    const fourSeated: SeatedStack[] = [...threeSeated, { playerId: 'rival-4', stack: plan.chips }];
    expect(checkInv1([bank, ...fourSeated.map((s) => s.stack)])).toEqual({ ok: true });
  });

  it('planBuyIn throws clear errors when no eligible player can cover 500 or openerIndex is invalid', () => {
    const bank: ChipCounts = { 5: 0, 10: 0, 50: 0, 100: 4 }; // 400 < 500
    const seats: SeatedStack[] = [
      { playerId: 'buyer', stack: emptyChips() },
      { playerId: 'p1', stack: { 5: 10, 10: 10, 50: 4, 100: 1 } }, // 450 < 500
    ];
    expect(() => planBuyIn(bank, seats, 'buyer', 0)).toThrow(/below 500/);
    expect(() => planBuyIn(bank, seats, 'buyer', -1)).toThrow(RangeError);
    expect(() => planBuyIn(bank, seats, 'buyer', 2)).toThrow(RangeError);
  });
});
