import { describe, expect, it } from 'vitest';
import { initialDistribution } from '../../src/engine/bank';
import {
  addChips,
  CHIP_SET,
  chipValue,
  emptyChips,
  subtractChips,
  type ChipCounts,
} from '../../src/engine/chips';
import { startHand } from '../../src/engine/hand';
import { createRng } from '../../src/engine/rng';
import {
  checkReadyForNextHand,
  createBoundaryFromHand,
  leaveTableAtBoundary,
  mapOpenerToSeatedIndex,
  nextDealerArrayIndex,
  rebuyAtBoundary,
  seatPlayerAtBoundary,
  type TableBoundaryState,
} from '../../src/engine/tableBoundary';
import {
  assertBoundaryInv1,
  betAction,
  buildFixtureDeck,
  callAction,
  mustApply,
  mustStartHand,
} from './handTestHelpers';

describe('hand boundary integration (T3, T4, C5, C6, O9)', () => {
  it('blocks boundary transitions until pot settlement completes', () => {
    const init = initialDistribution(4);
    const active = mustStartHand({
      seats: ['A', 'B', 'C', 'D'].map((playerId) => ({ playerId, stack: init.perPlayer })),
      bank: init.bank,
      rng: createRng('boundary-guard'),
      fixtures: { openerId: 'A' },
    }).state;

    const blocked = createBoundaryFromHand(active);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.code).toBe('hand-not-complete');
    }
  });

  it('T3 & T4: enforces 0-chip resolution before ante and >=4 players before next hand', () => {
    const init = initialDistribution(4);
    const aStack: ChipCounts = { 5: 1, 10: 0, 50: 0, 100: 0 }; // 5 -> busted if A loses
    const bank = addChips(init.bank, subtractChips(init.perPlayer, aStack));
    const deck = buildFixtureDeck({
      playerIds: ['A', 'B', 'C', 'D'],
      dealerIndex: 3,
      holeCardsByPlayer: {
        A: '2c 3d', // loses
        B: 'As Ah', // wins
        C: '7c 8d',
        D: '9c Td',
      },
      board: '4s 6h Jc Qd Ks',
    });

    let hand = mustStartHand({
      seats: [
        { playerId: 'A', stack: aStack },
        { playerId: 'B', stack: init.perPlayer },
        { playerId: 'C', stack: init.perPlayer },
        { playerId: 'D', stack: init.perPlayer },
      ],
      bank,
      rng: createRng('T3-T4'),
      config: { dealerIndex: 3 },
      fixtures: { deck, openerId: 'B' },
    }).state;

    // B bets 10, C & D fold -> A is all-in for ante -> runout & showdown -> B wins all, A has 0 chips!
    hand = mustApply(hand, 'B', betAction(hand, 'B', 10)).state;
    hand = mustApply(hand, 'C', { type: 'fold' }).state;
    hand = mustApply(hand, 'D', { type: 'fold' }).state;
    expect(hand.phase).toBe('complete');

    const boundaryRes = createBoundaryFromHand(hand);
    expect(boundaryRes.ok).toBe(true);
    if (!boundaryRes.ok) throw new Error('Expected boundary creation');
    let boundary = boundaryRes.state;
    assertBoundaryInv1(boundary.bank, boundary.seats.map((s) => s.stack));

    // T3: A has 0 chips -> table is NOT ready and startHand rejects before ante
    expect(checkReadyForNextHand(boundary)).toEqual({
      ready: false,
      playerCount: 4,
      needsPlayers: 0,
      zeroStackPlayerIds: ['A'],
      missingAnteDenominationPlayerIds: [],
    });

    const badNext = startHand({
      seats: boundary.seats,
      bank: boundary.bank,
      rng: createRng('T3-blocked'),
    });
    expect(badNext.ok).toBe(false);
    if (!badNext.ok) {
      expect(badNext.code).toBe('zero-stack-seat');
    }

    // Path 1: A rebuys 500 via planBuyIn -> ready!
    const afterRebuy = rebuyAtBoundary(boundary, 'A');
    expect(afterRebuy.ok).toBe(true);
    if (!afterRebuy.ok) throw new Error('Expected rebuy');
    assertBoundaryInv1(afterRebuy.state.bank, afterRebuy.state.seats.map((s) => s.stack));
    expect(checkReadyForNextHand(afterRebuy.state).ready).toBe(true);
    expect(afterRebuy.ledgerEvents).toHaveLength(1);
    expect(afterRebuy.ledgerEvents[0]!.type).toBe('rebuy');

    // Path 2 (T4): A leaves table instead -> only 3 players left -> needs 1 player!
    const afterLeave = leaveTableAtBoundary(boundary, 'A');
    expect(afterLeave.ok).toBe(true);
    if (!afterLeave.ok) throw new Error('Expected leave');
    boundary = afterLeave.state;
    assertBoundaryInv1(boundary.bank, boundary.seats.map((s) => s.stack));

    expect(checkReadyForNextHand(boundary)).toEqual({
      ready: false,
      playerCount: 3,
      needsPlayers: 1,
      zeroStackPlayerIds: [],
      missingAnteDenominationPlayerIds: [],
    });

    const tooFew = startHand({
      seats: boundary.seats,
      bank: boundary.bank,
      rng: createRng('T4-blocked'),
    });
    expect(tooFew.ok).toBe(false);
    if (!tooFew.ok) {
      expect(tooFew.code).toBe('invalid-player-count');
    }

    // Seat a 4th player (E) in physical seat 0 using planBuyIn -> ready for next hand!
    const afterSeat = seatPlayerAtBoundary(boundary, 0, 'E');
    expect(afterSeat.ok).toBe(true);
    if (!afterSeat.ok) throw new Error('Expected seating E');
    assertBoundaryInv1(afterSeat.state.bank, afterSeat.state.seats.map((s) => s.stack));
    expect(checkReadyForNextHand(afterSeat.state).ready).toBe(true);

    // Next hand starts cleanly with rotated dealer
    const nextHand = mustStartHand({
      seats: afterSeat.state.seats,
      bank: afterSeat.state.bank,
      rng: createRng('T4-next-hand'),
      config: { dealerIndex: nextDealerArrayIndex(afterSeat.state) },
    });
    expect(nextHand.state.seats.map((s) => s.playerId)).toEqual(['E', 'B', 'C', 'D']);
  });

  it('C5, C6, O9: preserves physical opener seat anchor after opener leaves when breaking cash-out ties', () => {
    // Physical seats: 0(A)=0 buyer, 1(B)=2000, 2(C)=500, 3(D)=1000 (previous opener!), 4(E)=2000, 5(F)=1000 -> total 6500, bank empty
    const boundary: TableBoundaryState = {
      seats: [
        { seatIndex: 0, playerId: 'A', stack: emptyChips() },
        { seatIndex: 1, playerId: 'B', stack: { 5: 20, 10: 20, 50: 14, 100: 10 } }, // 2000 (tied largest)
        { seatIndex: 2, playerId: 'C', stack: { 5: 20, 10: 20, 50: 4, 100: 0 } }, // 500
        { seatIndex: 3, playerId: 'D', stack: { 5: 20, 10: 20, 50: 10, 100: 2 } }, // 1000 (previous opener)
        { seatIndex: 4, playerId: 'E', stack: { 5: 20, 10: 20, 50: 14, 100: 10 } }, // 2000 (tied largest)
        { seatIndex: 5, playerId: 'F', stack: { 5: 20, 10: 20, 50: 8, 100: 3 } }, // 1000
      ],
      bank: emptyChips(),
      lastDealerSeatIndex: 5,
      lastOpenerSeatIndex: 3, // D was previous opener at physical seat 3
    };
    assertBoundaryInv1(boundary.bank, boundary.seats.map((s) => s.stack));

    // Suppose D leaves, AND suppose we have an empty bank scenario after D's cash-out isn't enough (test with D having 0 stack leaving!)
    const boundaryWithZeroOpener: TableBoundaryState = {
      seats: [
        { seatIndex: 0, playerId: 'A', stack: emptyChips() }, // buyer
        { seatIndex: 1, playerId: 'B', stack: { 5: 20, 10: 20, 50: 14, 100: 10 } }, // 2000 (tied largest)
        { seatIndex: 2, playerId: 'C', stack: { 5: 40, 10: 40, 50: 14, 100: 2 } }, // 1500
        { seatIndex: 3, playerId: 'D', stack: emptyChips() }, // previous opener leaves with 0 chips
        { seatIndex: 4, playerId: 'E', stack: { 5: 20, 10: 20, 50: 14, 100: 10 } }, // 2000 (tied largest)
        { seatIndex: 5, playerId: 'F', stack: { 5: 20, 10: 20, 50: 8, 100: 3 } }, // 1000
      ],
      bank: emptyChips(),
      lastDealerSeatIndex: 5,
      lastOpenerSeatIndex: 3,
    };
    assertBoundaryInv1(
      boundaryWithZeroOpener.bank,
      boundaryWithZeroOpener.seats.map((s) => s.stack),
    );

    const afterDLeaves = leaveTableAtBoundary(boundaryWithZeroOpener, 'D');
    expect(afterDLeaves.ok).toBe(true);
    if (!afterDLeaves.ok) throw new Error('Expected D leave');

    // Physical opener seat 3 is preserved and maps clockwise to occupied seat 4 (E) -> index 3 in [A,B,C,E,F]
    expect(afterDLeaves.state.lastOpenerSeatIndex).toBe(3);
    expect(mapOpenerToSeatedIndex(afterDLeaves.state.seats, 3)).toBe(3);

    // Rebuy for A with empty bank: B(seat 1) and E(seat 4) tie at 2000 -> E is clockwise closest to physical seat 3!
    const rebuyRes = rebuyAtBoundary(afterDLeaves.state, 'A');
    expect(rebuyRes.ok).toBe(true);
    if (!rebuyRes.ok) throw new Error('Expected rebuy');
    expect(rebuyRes.plan.kind).toBe('cash-out-then-bank');
    if (rebuyRes.plan.kind !== 'cash-out-then-bank') throw new Error('Expected forced cash-out');
    expect(rebuyRes.plan.cashOutPlayerId).toBe('E');
    expect(rebuyRes.plan.cashOutChips).toEqual({ 5: 0, 10: 0, 50: 0, 100: 5 });
    assertBoundaryInv1(rebuyRes.state.bank, rebuyRes.state.seats.map((s) => s.stack));

    // Also test wrap-around when physical seats >= anchor are all gone (anchor = 5, seats = [0, 1, 2, 4])
    const wrapped = mapOpenerToSeatedIndex(
      [
        { seatIndex: 0, playerId: 'A', stack: emptyChips() },
        { seatIndex: 1, playerId: 'B', stack: emptyChips() },
        { seatIndex: 2, playerId: 'C', stack: emptyChips() },
        { seatIndex: 4, playerId: 'E', stack: emptyChips() },
      ],
      5,
    );
    expect(wrapped).toBe(0);
  });

  it('QUESTIONS.md #2: detects and rejects ante when a non-zero seat lacks a 5-point chip', () => {
    const noFivesStack: ChipCounts = { 5: 0, 10: 10, 50: 2, 100: 3 }; // 500 value, zero 5-chips
    const normalStack: ChipCounts = { 5: 10, 10: 10, 50: 5, 100: 1 }; // 500
    const seats = [
      { seatIndex: 0, playerId: 'A', stack: noFivesStack },
      { seatIndex: 1, playerId: 'B', stack: normalStack },
      { seatIndex: 2, playerId: 'C', stack: normalStack },
      { seatIndex: 3, playerId: 'D', stack: normalStack },
    ];
    const used = seats.reduce((acc, s) => addChips(acc, s.stack), emptyChips());
    const bank = subtractChips(CHIP_SET, used);
    assertBoundaryInv1(bank, seats.map((s) => s.stack));

    const boundary: TableBoundaryState = {
      seats,
      bank,
      lastDealerSeatIndex: 3,
      lastOpenerSeatIndex: 0,
    };
    expect(checkReadyForNextHand(boundary)).toEqual({
      ready: false,
      playerCount: 4,
      needsPlayers: 0,
      zeroStackPlayerIds: [],
      missingAnteDenominationPlayerIds: ['A'],
    });

    const rejected = startHand({
      seats,
      bank,
      rng: createRng('missing-ante-5'),
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.code).toBe('insufficient-ante-denomination');
    }
    expect(chipValue(noFivesStack)).toBe(500);
  });

  it('integrates end-to-end across a completed hand into boundary rebuy and next hand', () => {
    const init = initialDistribution(4);
    const shortStack: ChipCounts = { 5: 1, 10: 2, 50: 0, 100: 0 }; // 25 -> 20 after ante
    const bank = addChips(init.bank, subtractChips(init.perPlayer, shortStack));
    const deck = buildFixtureDeck({
      playerIds: ['A', 'B', 'C', 'D'],
      dealerIndex: 0,
      holeCardsByPlayer: {
        A: '2c 3d',
        B: 'As Ah',
        C: '7c 8d',
        D: '9c Td',
      },
      board: '4s 6h Jc Qd Ks',
    });

    let hand = mustStartHand({
      seats: [
        { seatIndex: 0, playerId: 'A', stack: shortStack },
        { seatIndex: 1, playerId: 'B', stack: init.perPlayer },
        { seatIndex: 2, playerId: 'C', stack: init.perPlayer },
        { seatIndex: 3, playerId: 'D', stack: init.perPlayer },
      ],
      bank,
      rng: createRng('hand-to-boundary'),
      config: { dealerIndex: 0 },
      fixtures: { deck, openerId: 'B' },
    }).state;

    hand = mustApply(hand, 'B', betAction(hand, 'B', 20)).state;
    hand = mustApply(hand, 'C', { type: 'fold' }).state;
    hand = mustApply(hand, 'D', { type: 'fold' }).state;
    hand = mustApply(hand, 'A', callAction(hand, 'A')).state;
    expect(hand.phase).toBe('complete');

    const boundaryRes = createBoundaryFromHand(hand);
    expect(boundaryRes.ok).toBe(true);
    if (!boundaryRes.ok) throw new Error('Expected boundary');

    const rebuy = rebuyAtBoundary(boundaryRes.state, 'A');
    expect(rebuy.ok).toBe(true);
    if (!rebuy.ok) throw new Error('Expected rebuy');
    assertBoundaryInv1(rebuy.state.bank, rebuy.state.seats.map((s) => s.stack));

    const hand2 = mustStartHand({
      seats: rebuy.state.seats,
      bank: rebuy.state.bank,
      rng: createRng('hand-2'),
      config: { dealerIndex: nextDealerArrayIndex(rebuy.state) },
    }).state;
    expect(hand2.dealerSeatIndex).toBe(1); // rotated clockwise from 0 -> 1
  });
});
