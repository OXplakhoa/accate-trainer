import { describe, expect, it } from 'vitest';
import { initialDistribution } from '../../src/engine/bank';
import { formatCard } from '../../src/engine/cards';
import {
  addChips,
  CHIP_SET,
  chipValue,
  emptyChips,
  subtractChips,
  type ChipCounts,
} from '../../src/engine/chips';
import { settlePendingPayout } from '../../src/engine/hand';
import { createRng } from '../../src/engine/rng';
import {
  assertHandInvariants,
  betAction,
  buildFixtureDeck,
  callAction,
  mustApply,
  mustExchange,
  mustStartHand,
  seatOf,
  stackValueOf,
} from './handTestHelpers';

function bankRemainder(stacks: readonly ChipCounts[]): ChipCounts {
  let sum = emptyChips();
  for (const s of stacks) {
    sum = addChips(sum, s);
  }
  return subtractChips(CHIP_SET, sum);
}

describe('side pots and showdown integration (P1-P6, S1-S7)', () => {
  it('P1, P2, P3: side pots across flop/turn and showdown payout A > B > C (A gets 110, B gets 120)', () => {
    const init = initialDistribution(4);
    const aStack: ChipCounts = { 5: 1, 10: 3, 50: 0, 100: 0 }; // 35 -> 30 after ante
    const seats = [
      { playerId: 'A', stack: aStack },
      { playerId: 'B', stack: init.perPlayer },
      { playerId: 'C', stack: init.perPlayer },
      { playerId: 'D', stack: init.perPlayer },
    ];
    const bank = bankRemainder(seats.map((s) => s.stack));
    const deck = buildFixtureDeck({
      playerIds: ['A', 'B', 'C', 'D'],
      dealerIndex: 3,
      holeCardsByPlayer: {
        A: 'As Ah', // top pair aces -> A > B > C
        B: 'Ks Kh',
        C: 'Qs Qh',
        D: '2c 7d',
      },
      board: '3s 5d 8c 9h Jd',
    });

    let state = mustStartHand({
      seats,
      bank,
      rng: createRng('P1-P3'),
      config: { dealerIndex: 3 },
      fixtures: { deck, openerId: 'B' },
    }).state;

    // P1: Flop B bet 50, C call 50, D fold, A all-in 30
    state = mustApply(state, 'B', betAction(state, 'B', 50)).state;
    state = mustApply(state, 'C', callAction(state, 'C')).state;
    state = mustApply(state, 'D', { type: 'fold' }).state;
    state = mustApply(state, 'A', callAction(state, 'A')).state;

    expect(seatOf(state, 'A').status).toBe('all-in');
    expect(state.street).toBe('turn');
    expect(chipValue(state.pot)).toBe(150); // Main 110 + Side 40

    // P2: Turn B bet 40, C call 40 -> A does not contribute, still sees river
    state = mustApply(state, 'B', betAction(state, 'B', 40)).state;
    state = mustApply(state, 'C', callAction(state, 'C')).state;

    expect(state.street).toBe('river');
    expect(chipValue(state.pot)).toBe(230); // Main 110 + Side 120
    expect(seatOf(state, 'A').totalContribution).toBe(35);

    // River: B check, C check -> Showdown (P3)
    state = mustApply(state, 'B', { type: 'check' }).state;
    state = mustApply(state, 'C', { type: 'check' }).state;

    expect(state.phase).toBe('complete');
    expect(state.outcome?.kind).toBe('showdown');
    if (state.outcome?.kind !== 'showdown') throw new Error('Expected showdown');

    const { potAwards } = state.outcome.resolution;
    expect(potAwards).toHaveLength(2);
    expect(potAwards[0]!.potAmount).toBe(110);
    expect(potAwards[0]!.eligiblePlayerIds).toEqual(['A', 'B', 'C']);
    expect(potAwards[0]!.awards).toEqual([{ playerId: 'A', amount: 110 }]);
    expect(potAwards[1]!.potAmount).toBe(120);
    expect(potAwards[1]!.eligiblePlayerIds).toEqual(['B', 'C']);
    expect(potAwards[1]!.awards).toEqual([{ playerId: 'B', amount: 120 }]);

    expect(stackValueOf(state, 'A')).toBe(110);
    expect(stackValueOf(state, 'B')).toBe(500 - 5 - 50 - 40 + 120);
    expect(stackValueOf(state, 'C')).toBe(500 - 5 - 50 - 40);
    expect(stackValueOf(state, 'D')).toBe(495);
  });

  it('P4, P5: multi-level side pots (80 / 60 / 30) and showdown D > A > B > C (D gets 140, B gets 30)', () => {
    const init = initialDistribution(4);
    const aStack: ChipCounts = { 5: 2, 10: 1, 50: 0, 100: 0 }; // 20 -> 15 after ante
    const dStack: ChipCounts = { 5: 2, 10: 3, 50: 0, 100: 0 }; // 40 -> 35 after ante
    const seats = [
      { playerId: 'A', stack: aStack },
      { playerId: 'B', stack: init.perPlayer },
      { playerId: 'C', stack: init.perPlayer },
      { playerId: 'D', stack: dStack },
    ];
    const bank = bankRemainder(seats.map((s) => s.stack));
    const deck = buildFixtureDeck({
      playerIds: ['A', 'B', 'C', 'D'],
      dealerIndex: 3,
      holeCardsByPlayer: {
        D: 'As Ah', // D > A > B > C
        A: 'Ks Kh',
        B: 'Qs Qh',
        C: 'Js Jd',
      },
      board: '2c 4d 7h 9s Tc',
    });

    let state = mustStartHand({
      seats,
      bank,
      rng: createRng('P4-P5'),
      config: { dealerIndex: 3 },
      fixtures: { deck, openerId: 'B' },
    }).state;

    // Flop: B bet 50, C call 50, D all-in 35, A all-in 15
    state = mustApply(state, 'B', betAction(state, 'B', 50)).state;
    state = mustApply(state, 'C', callAction(state, 'C')).state;
    state = mustApply(state, 'D', callAction(state, 'D')).state;
    state = mustApply(state, 'A', callAction(state, 'A')).state;

    expect(seatOf(state, 'A').status).toBe('all-in');
    expect(seatOf(state, 'D').status).toBe('all-in');
    expect(chipValue(state.pot)).toBe(170);

    // Check down turn and river between B and C
    for (const id of ['B', 'C', 'B', 'C']) {
      state = mustApply(state, id, { type: 'check' }).state;
    }

    expect(state.phase).toBe('complete');
    if (state.outcome?.kind !== 'showdown') throw new Error('Expected showdown');

    const { potAwards } = state.outcome.resolution;
    expect(potAwards.map((p) => [p.potAmount, p.eligiblePlayerIds])).toEqual([
      [80, ['A', 'B', 'C', 'D']],
      [60, ['B', 'C', 'D']],
      [30, ['B', 'C']],
    ]);
    expect(potAwards[0]!.awards).toEqual([{ playerId: 'D', amount: 80 }]);
    expect(potAwards[1]!.awards).toEqual([{ playerId: 'D', amount: 60 }]);
    expect(potAwards[2]!.awards).toEqual([{ playerId: 'B', amount: 30 }]);

    expect(stackValueOf(state, 'D')).toBe(140);
    expect(stackValueOf(state, 'B')).toBe(500 - 55 + 30);
    expect(stackValueOf(state, 'A')).toBe(0);
    expect(stackValueOf(state, 'C')).toBe(500 - 55);
  });

  it('P6: seat with 5 chips goes all-in on ante, sees showdown, and wins only the ante main pot', () => {
    const init = initialDistribution(4);
    const aStack: ChipCounts = { 5: 1, 10: 0, 50: 0, 100: 0 }; // exactly 5
    const seats = [
      { playerId: 'A', stack: aStack },
      { playerId: 'B', stack: init.perPlayer },
      { playerId: 'C', stack: init.perPlayer },
      { playerId: 'D', stack: init.perPlayer },
    ];
    const bank = bankRemainder(seats.map((s) => s.stack));
    const deck = buildFixtureDeck({
      playerIds: ['A', 'B', 'C', 'D'],
      dealerIndex: 3,
      holeCardsByPlayer: {
        A: 'As Ah', // strongest hand, only eligible for 20 ante main pot
        B: 'Ks Kh', // wins side pot
        C: 'Qs Qh',
        D: '2c 7d',
      },
      board: '3s 5d 8c 9h Jd',
    });

    // Even when A is chosen as opener, betting skips all-in A to B
    let state = mustStartHand({
      seats,
      bank,
      rng: createRng('P6'),
      config: { dealerIndex: 3 },
      fixtures: { deck, openerId: 'A' },
    }).state;

    expect(seatOf(state, 'A').status).toBe('all-in');
    expect(stackValueOf(state, 'A')).toBe(0);
    expect(state.activePlayerId).toBe('B');

    state = mustApply(state, 'B', betAction(state, 'B', 20)).state;
    state = mustApply(state, 'C', callAction(state, 'C')).state;
    state = mustApply(state, 'D', { type: 'fold' }).state;

    // Turn & river check-check between B and C (A skipped on every street)
    for (const id of ['B', 'C', 'B', 'C']) {
      state = mustApply(state, id, { type: 'check' }).state;
    }

    expect(state.phase).toBe('complete');
    if (state.outcome?.kind !== 'showdown') throw new Error('Expected showdown');
    expect(state.outcome.resolution.potAwards.map((p) => [p.potAmount, p.eligiblePlayerIds])).toEqual([
      [20, ['A', 'B', 'C']],
      [40, ['B', 'C']],
    ]);
    expect(stackValueOf(state, 'A')).toBe(20);
    expect(stackValueOf(state, 'B')).toBe(500 - 25 + 40);

    // Edge case: all 4 seats have 5 chips -> immediate runout and showdown in startHand
    const fiveOnly: ChipCounts = { 5: 1, 10: 0, 50: 0, 100: 0 };
    const allFiveSeats = ['A', 'B', 'C', 'D'].map((playerId) => ({ playerId, stack: fiveOnly }));
    const allInStart = mustStartHand({
      seats: allFiveSeats,
      bank: bankRemainder(allFiveSeats.map((s) => s.stack)),
      rng: createRng('P6-all-five'),
      config: { dealerIndex: 3 },
      fixtures: { deck, openerId: 'A' },
    });
    expect(allInStart.state.phase).toBe('complete');
    expect(allInStart.state.board).toHaveLength(5);
    expect(stackValueOf(allInStart.state, 'A')).toBe(20);
  });

  it('S1: board 5-6-7-8-9 tie on pot 320 resolves via bai cao (ba tay beats 9 points -> C wins 320)', () => {
    const init = initialDistribution(4);
    const deck = buildFixtureDeck({
      playerIds: ['A', 'B', 'C', 'D'],
      dealerIndex: 3,
      holeCardsByPlayer: {
        A: '2c 3c',
        B: '2s 3d',
        C: '2h 4d',
        D: '2d 3h',
      },
      board: '5c 6d 7h 8s 9c',
      undealtPrefix: '4c 5d Kh Qc Jd Ks', // B draws 4,5,K (9); C draws Q,J,K (ba tay)
    });

    let state = mustStartHand({
      seats: ['A', 'B', 'C', 'D'].map((playerId) => ({ playerId, stack: init.perPlayer })),
      bank: init.bank,
      rng: createRng('S1'),
      config: { dealerIndex: 3, tieBreakMode: 'bai-cao' },
      fixtures: { deck, openerId: 'A' },
    }).state;

    // Reach pot 320: ante 20 + flop 50*2 + turn 50*2 + river 50*2 = 320
    state = mustApply(state, 'A', { type: 'fold' }).state;
    state = mustApply(state, 'B', betAction(state, 'B', 50)).state;
    state = mustApply(state, 'C', callAction(state, 'C')).state;
    state = mustApply(state, 'D', { type: 'fold' }).state;

    // Turn
    state = mustApply(state, 'B', betAction(state, 'B', 50)).state;
    state = mustApply(state, 'C', callAction(state, 'C')).state;

    // River
    state = mustApply(state, 'B', betAction(state, 'B', 50)).state;
    state = mustApply(state, 'C', callAction(state, 'C')).state;

    expect(state.phase).toBe('complete');
    if (state.outcome?.kind !== 'showdown') throw new Error('Expected showdown');
    const award = state.outcome.resolution.potAwards[0]!;
    expect(award.potAmount).toBe(320);
    expect(award.tiedTopPlayerIds).toEqual(['B', 'C']);
    expect(award.tieBreak.kind).toBe('bai-cao');
    if (award.tieBreak.kind !== 'bai-cao') throw new Error('Expected bai-cao');

    expect(award.tieBreak.result.winnerId).toBe('C');
    expect(award.tieBreak.result.rounds[0]!.map((d) => [d.playerId, d.points, d.baTay])).toEqual([
      ['B', 9, false],
      ['C', 0, true],
    ]);
    expect(stackValueOf(state, 'C')).toBe(500 - 155 + 320);
    expect(stackValueOf(state, 'B')).toBe(500 - 155);
  });

  it('S2, S3, S4: showdown bai cao redraws ties, narrows 3-way tie to highest only, and scores 10-J-Q as 0', () => {
    const init = initialDistribution(4);
    const deck = buildFixtureDeck({
      playerIds: ['A', 'B', 'C', 'D'],
      dealerIndex: 3,
      holeCardsByPlayer: {
        A: '2c 3c',
        B: '2s 3d',
        C: '2h 4d',
        D: '2d 3h',
      },
      board: '5c 6d 7h 8s 9c',
      // Round 1: A gets 2? Wait avoid used cards: A gets Tc Js Qh (0, NOT ba tay - S4!),
      // B gets 3s 4h Ks (7 pts), C gets 3h 4s Kd (7 pts) -> B & C tie at 7 (S2/S3), A eliminated!
      // Round 2: B gets 4c 5h Ad (0 pts), C gets 4h? (already used!) -> use Ah 8d Kc (9 pts)
      undealtPrefix: 'Tc Js Qh 3s 4h Ks As 6s Kd 4c 6h Qd Ah 8d Kc',
    });

    let state = mustStartHand({
      seats: ['A', 'B', 'C', 'D'].map((playerId) => ({ playerId, stack: init.perPlayer })),
      bank: init.bank,
      rng: createRng('S2-S4'),
      config: { dealerIndex: 3, tieBreakMode: 'bai-cao' },
      fixtures: { deck, openerId: 'A' },
    }).state;

    // D folds; A, B, C check down all three streets
    state = mustApply(state, 'A', { type: 'check' }).state;
    state = mustApply(state, 'B', { type: 'check' }).state;
    state = mustApply(state, 'C', { type: 'check' }).state;
    state = mustApply(state, 'D', { type: 'fold' }).state;
    for (const id of ['A', 'B', 'C', 'A', 'B', 'C']) {
      state = mustApply(state, id, { type: 'check' }).state;
    }

    expect(state.phase).toBe('complete');
    if (state.outcome?.kind !== 'showdown') throw new Error('Expected showdown');
    const tieBreak = state.outcome.resolution.potAwards[0]!.tieBreak;
    if (tieBreak.kind !== 'bai-cao') throw new Error('Expected bai-cao');

    expect(tieBreak.result.rounds).toHaveLength(2);
    expect(tieBreak.result.rounds[0]![0]).toMatchObject({ playerId: 'A', points: 0, baTay: false });
    expect(tieBreak.result.rounds[0]![1]).toMatchObject({ playerId: 'B', points: 7, baTay: false });
    expect(tieBreak.result.rounds[0]![2]).toMatchObject({ playerId: 'C', points: 7, baTay: false });
    expect(tieBreak.result.rounds[1]!.map((d) => d.playerId)).toEqual(['B', 'C']);
    expect(tieBreak.result.winnerId).toBe('C');
  });

  it('S5: split mode on pot 115 pays 55 and 60 with odd 5-chip awarded deterministically by seed', () => {
    const init = initialDistribution(5);
    const playerIds = ['A', 'B', 'C', 'D', 'E'];
    const deck = buildFixtureDeck({
      playerIds,
      dealerIndex: 4,
      holeCardsByPlayer: {
        A: '2c 3c',
        B: '2s 3d',
        C: '2h 4d',
        D: '2d 3h',
        E: '3s 4s',
      },
      board: '5c 6d 7h 8s 9c',
    });

    const playSplit = (seed: string) => {
      let state = mustStartHand({
        seats: playerIds.map((playerId) => ({ playerId, stack: init.perPlayer })),
        bank: init.bank,
        rng: createRng(seed),
        config: { dealerIndex: 4, tieBreakMode: 'split' },
        fixtures: { deck, openerId: 'A' },
      }).state;

      // Ante 25 + B bet 45 + C call 45 = 115
      state = mustApply(state, 'A', { type: 'fold' }).state;
      state = mustApply(state, 'B', betAction(state, 'B', 45)).state;
      state = mustApply(state, 'C', callAction(state, 'C')).state;
      state = mustApply(state, 'D', { type: 'fold' }).state;
      state = mustApply(state, 'E', { type: 'fold' }).state;

      for (const id of ['B', 'C', 'B', 'C']) {
        state = mustApply(state, id, { type: 'check' }).state;
      }
      return state;
    };

    const run1 = playSplit('S5-fixed');
    const run2 = playSplit('S5-fixed');
    expect(run1.phase).toBe('complete');
    expect(run1.outcome).toEqual(run2.outcome);
    if (run1.outcome?.kind !== 'showdown') throw new Error('Expected showdown');

    const award = run1.outcome.resolution.potAwards[0]!;
    expect(award.potAmount).toBe(115);
    expect(award.awards.map((a) => a.amount).sort((x, y) => x - y)).toEqual([55, 60]);
    expect(award.tieBreak.kind).toBe('split');
    if (award.tieBreak.kind === 'split') {
      expect(award.tieBreak.baseAmount).toBe(55);
      expect(award.tieBreak.oddChipRecipients).toHaveLength(1);
      expect(['B', 'C']).toContain(award.tieBreak.oddChipRecipients[0]);
    }

    // 3-way split of pot 115 (25 ante + 30x3): shares are 35, 40, 40 (max diff <= 5)
    let threeWay = mustStartHand({
      seats: playerIds.map((playerId) => ({ playerId, stack: init.perPlayer })),
      bank: init.bank,
      rng: createRng('S5-3way'),
      config: { dealerIndex: 4, tieBreakMode: 'split' },
      fixtures: { deck, openerId: 'A' },
    }).state;
    threeWay = mustApply(threeWay, 'A', { type: 'fold' }).state;
    threeWay = mustApply(threeWay, 'B', betAction(threeWay, 'B', 30)).state;
    threeWay = mustApply(threeWay, 'C', callAction(threeWay, 'C')).state;
    threeWay = mustApply(threeWay, 'D', callAction(threeWay, 'D')).state;
    threeWay = mustApply(threeWay, 'E', { type: 'fold' }).state;
    for (const id of ['B', 'C', 'D', 'B', 'C', 'D']) {
      threeWay = mustApply(threeWay, id, { type: 'check' }).state;
    }
    expect(threeWay.phase).toBe('complete');
    if (threeWay.outcome?.kind !== 'showdown') throw new Error('Expected showdown');
    const threeAward = threeWay.outcome.resolution.potAwards[0]!;
    expect(threeAward.potAmount).toBe(115);
    expect(threeAward.awards.map((a) => a.amount).sort((x, y) => x - y)).toEqual([35, 40, 40]);
  });

  it('S5 + QUESTIONS.md #2: preserves awaiting-payout when pot 100+10+5 cannot split 60/55, then settles after pot exchange', () => {
    const init = initialDistribution(5);
    // Give A a 100-chip from bank so A can exchange it into the pot
    const aWith100 = addChips(subtractChips(init.perPlayer, { 5: 0, 10: 0, 50: 2, 100: 0 }), {
      5: 0,
      10: 0,
      50: 0,
      100: 1,
    });
    const bank = addChips(subtractChips(init.bank, { 5: 0, 10: 0, 50: 0, 100: 1 }), {
      5: 0,
      10: 0,
      50: 2,
      100: 0,
    });
    const playerIds = ['A', 'B', 'C', 'D', 'E'];
    const deck = buildFixtureDeck({
      playerIds,
      dealerIndex: 4,
      holeCardsByPlayer: {
        A: '2c 3c',
        B: '2s 3d',
        C: '2h 4d',
        D: '2d 3h',
        E: '3s 4s',
      },
      board: '5c 6d 7h 8s 9c',
    });

    let state = mustStartHand({
      seats: [
        { playerId: 'A', stack: aWith100 },
        { playerId: 'B', stack: init.perPlayer },
        { playerId: 'C', stack: init.perPlayer },
        { playerId: 'D', stack: init.perPlayer },
        { playerId: 'E', stack: init.perPlayer },
      ],
      bank,
      rng: createRng('S5-unbreakable'),
      config: { dealerIndex: 4, tieBreakMode: 'split' },
      fixtures: { deck, openerId: 'A' },
    }).state;

    // Ante 25 (5x5) + B bet 45 (4x10 + 1x5) + C call 45 (4x10 + 1x5) -> pot = {5:7, 10:8, 50:0, 100:0} = 115
    state = mustApply(state, 'A', { type: 'fold' }).state;
    state = mustApply(state, 'B', {
      type: 'bet',
      amount: 45,
      chips: { 5: 1, 10: 4, 50: 0, 100: 0 },
    }).state;
    state = mustApply(state, 'C', {
      type: 'call',
      chips: { 5: 1, 10: 4, 50: 0, 100: 0 },
    }).state;
    state = mustApply(state, 'D', { type: 'fold' }).state;
    state = mustApply(state, 'E', { type: 'fold' }).state;

    // Exchange 1x100 from A into pot for 7x10 + 6x5 (= 100) -> pot is now {5:1, 10:1, 50:0, 100:1} = 115!
    state = mustExchange(state, {
      fromPlayerId: 'A',
      target: { kind: 'pot' },
      give: { 5: 0, 10: 0, 50: 0, 100: 1 },
      receive: { 5: 6, 10: 7, 50: 0, 100: 0 },
    }).state;
    expect(state.pot).toEqual({ 5: 1, 10: 1, 50: 0, 100: 1 });

    // Check down turn and river -> showdown hits unbreakable pot -> awaiting-payout!
    for (const id of ['B', 'C', 'B', 'C']) {
      state = mustApply(state, id, { type: 'check' }).state;
    }

    expect(state.phase).toBe('awaiting-payout');
    expect(state.pot).toEqual({ 5: 1, 10: 1, 50: 0, 100: 1 });
    expect(state.pendingPayout?.requiredPayouts.map((p) => p.amount).sort((a, b) => a - b)).toEqual([
      55, 60,
    ]);

    // Attempting to settle before exchange rejects cleanly without mutating state
    const premature = settlePendingPayout(state);
    expect(premature.ok).toBe(false);
    if (!premature.ok) {
      expect(premature.code).toBe('insufficient-pot-denominations');
    }
    expect(premature.state).toBe(state);
    assertHandInvariants(state);

    // D exchanges 2x50 for pot's 1x100 -> pot becomes {5:1, 10:1, 50:2, 100:0}
    state = mustExchange(state, {
      fromPlayerId: 'D',
      target: { kind: 'pot' },
      give: { 5: 0, 10: 0, 50: 2, 100: 0 },
      receive: { 5: 0, 10: 0, 50: 0, 100: 1 },
    }).state;
    expect(state.pot).toEqual({ 5: 1, 10: 1, 50: 2, 100: 0 });

    // Now settlePendingPayout succeeds cleanly!
    const settled = settlePendingPayout(state);
    expect(settled.ok).toBe(true);
    if (!settled.ok) throw new Error('Expected settlement success');
    assertHandInvariants(settled.state);
    expect(settled.state.phase).toBe('complete');
    expect(settled.state.pot).toEqual(emptyChips());
    expect(settled.state.settledTransfers.map((t) => t.amount).sort((a, b) => a - b)).toEqual([
      55, 60,
    ]);
  });

  it('S6: runs bai cao only for tied side pot when main pot has a clear winner, and shares deck across multi-pot ties', () => {
    const init = initialDistribution(4);
    const aStack: ChipCounts = { 5: 1, 10: 3, 50: 0, 100: 0 }; // 35 -> 30 after ante
    const seats = [
      { playerId: 'A', stack: aStack },
      { playerId: 'B', stack: init.perPlayer },
      { playerId: 'C', stack: init.perPlayer },
      { playerId: 'D', stack: init.perPlayer },
    ];
    const bank = bankRemainder(seats.map((s) => s.stack));

    // A has As Ah (wins main pot outright!), B and C both play board 5-6-7-8-9 (tie ONLY in side pot!)
    const deck = buildFixtureDeck({
      playerIds: ['A', 'B', 'C', 'D'],
      dealerIndex: 3,
      holeCardsByPlayer: {
        A: 'Td Jd', // straight 7-8-9-T-J beats board 5-6-7-8-9 -> A wins main pot cleanly!
        B: '2s 3d',
        C: '2h 4d',
        D: '2c 3c',
      },
      board: '5c 6d 7h 8s 9c',
      undealtPrefix: '4c 5d Kh Qc Js Kd', // B draws 9 pts, C draws ba tay -> C wins side pot
    });

    let state = mustStartHand({
      seats,
      bank,
      rng: createRng('S6-side-only'),
      config: { dealerIndex: 3, tieBreakMode: 'bai-cao' },
      fixtures: { deck, openerId: 'B' },
    }).state;

    state = mustApply(state, 'B', betAction(state, 'B', 50)).state;
    state = mustApply(state, 'C', callAction(state, 'C')).state;
    state = mustApply(state, 'D', { type: 'fold' }).state;
    state = mustApply(state, 'A', callAction(state, 'A')).state;
    for (const id of ['B', 'C', 'B', 'C']) {
      state = mustApply(state, id, { type: 'check' }).state;
    }

    expect(state.phase).toBe('complete');
    if (state.outcome?.kind !== 'showdown') throw new Error('Expected showdown');
    const [mainAward, sideAward] = state.outcome.resolution.potAwards;
    expect(mainAward!.potAmount).toBe(110);
    expect(mainAward!.tieBreak).toEqual({ kind: 'none' });
    expect(mainAward!.awards).toEqual([{ playerId: 'A', amount: 110 }]);
    expect(sideAward!.potAmount).toBe(40);
    expect(sideAward!.tiedTopPlayerIds).toEqual(['B', 'C']);
    expect(sideAward!.tieBreak.kind).toBe('bai-cao');
    if (sideAward!.tieBreak.kind === 'bai-cao') {
      expect(sideAward!.tieBreak.result.winnerId).toBe('C');
    }

    // Multi-pot tie: A, B, C ALL play board -> BOTH Main (110) and Side (40) need bai cao, sharing physical deck!
    const multiTieDeck = buildFixtureDeck({
      playerIds: ['A', 'B', 'C', 'D'],
      dealerIndex: 3,
      holeCardsByPlayer: {
        A: '2d 3h',
        B: '2s 3d',
        C: '2h 4d',
        D: '2c 3c',
      },
      board: '5c 6d 7h 8s 9c',
      // Main pot (A, B, C) uses first 9 cards: A=4c 5d Kh(9), B=3s 4s Kd(7), C=Qs Js Kc(ba tay -> C wins Main!)
      // Side pot (B, C) continues at card index 9 (next 6 cards): B=Qh Jh Qd(ba tay -> B wins Side!), C=Ac 6h Tc(7)
      undealtPrefix: '4c 5d Kh 3s 4s Kd Qs Js Kc Qh Jh Qd Ac 6h Tc',
    });

    let multiState = mustStartHand({
      seats,
      bank,
      rng: createRng('S6-multi'),
      config: { dealerIndex: 3, tieBreakMode: 'bai-cao' },
      fixtures: { deck: multiTieDeck, openerId: 'B' },
    }).state;
    multiState = mustApply(multiState, 'B', betAction(multiState, 'B', 50)).state;
    multiState = mustApply(multiState, 'C', callAction(multiState, 'C')).state;
    multiState = mustApply(multiState, 'D', { type: 'fold' }).state;
    multiState = mustApply(multiState, 'A', callAction(multiState, 'A')).state;
    for (const id of ['B', 'C', 'B', 'C']) {
      multiState = mustApply(multiState, id, { type: 'check' }).state;
    }

    if (multiState.outcome?.kind !== 'showdown') throw new Error('Expected showdown');
    const [mPot, sPot] = multiState.outcome.resolution.potAwards;
    expect(mPot!.tieBreak.kind).toBe('bai-cao');
    expect(sPot!.tieBreak.kind).toBe('bai-cao');
    if (mPot!.tieBreak.kind !== 'bai-cao' || sPot!.tieBreak.kind !== 'bai-cao') {
      throw new Error('Expected bai-cao on both pots');
    }

    // Pot 1 (Main) used 9 cards and Pot 2 (Side) used the NEXT 6 distinct cards from the shared deck
    const pot1Cards = mPot!.tieBreak.result.rounds[0]!.flatMap((d) => d.cards.map(formatCard));
    const pot2Cards = sPot!.tieBreak.result.rounds[0]!.flatMap((d) => d.cards.map(formatCard));
    expect(pot1Cards).toHaveLength(9);
    expect(pot2Cards).toHaveLength(6);
    expect(new Set([...pot1Cards, ...pot2Cards]).size).toBe(15); // no overlap!
    expect(mPot!.tieBreak.result.winnerId).toBe('C');
    expect(sPot!.tieBreak.result.winnerId).toBe('B');
  });

  it('S7: 10-player showdown tie recycles the 27 undealt cards deterministically without using dealt cards', () => {
    const init = initialDistribution(10);
    const playerIds = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
    // All 10 players have low cards below the board straight Ts Js Qs Ks As (royal flush on board!)
    const holeCardsByPlayer: Record<string, string> = {
      A: '2c 3c',
      B: '2d 3d',
      C: '2h 3h',
      D: '2s 3s',
      E: '4c 5c',
      F: '4d 5d',
      G: '4h 5h',
      H: '4s 5s',
      I: '6c 7c',
      J: '6d 7d',
    };
    const board = 'Ts Js Qs Ks As';
    const deck = buildFixtureDeck({
      playerIds,
      dealerIndex: 9,
      holeCardsByPlayer,
      board,
    });
    const dealtKeys = new Set(deck.slice(0, 25).map(formatCard));

    const playTenWay = (seed: string) => {
      let state = mustStartHand({
        seats: playerIds.map((playerId) => ({ playerId, stack: init.perPlayer })),
        bank: init.bank,
        rng: createRng(seed),
        config: { dealerIndex: 9, tieBreakMode: 'bai-cao' },
        fixtures: { deck, openerId: 'A' },
      }).state;

      // Everyone checks flop, turn, river -> 10-way tie at showdown!
      for (let street = 0; street < 3; street++) {
        for (const id of playerIds) {
          state = mustApply(state, id, { type: 'check' }).state;
        }
      }
      return state;
    };

    const run1 = playTenWay('S7-10-players');
    const run2 = playTenWay('S7-10-players');
    expect(run1.phase).toBe('complete');
    expect(run1.outcome).toEqual(run2.outcome);
    if (run1.outcome?.kind !== 'showdown') throw new Error('Expected showdown');

    const award = run1.outcome.resolution.potAwards[0]!;
    expect(award.potAmount).toBe(50);
    expect(award.tiedTopPlayerIds).toEqual(playerIds);
    expect(award.tieBreak.kind).toBe('bai-cao');
    if (award.tieBreak.kind !== 'bai-cao') throw new Error('Expected bai-cao');

    // 10 players x 3 cards = 30 cards needed in round 1 > 27 undealt -> recycle triggered!
    expect(award.tieBreak.result.rounds[0]).toHaveLength(10);
    for (const round of award.tieBreak.result.rounds) {
      for (const draw of round) {
        expect(draw.cards).toHaveLength(3);
        expect(new Set(draw.cards.map(formatCard)).size).toBe(3);
        for (const card of draw.cards) {
          expect(dealtKeys.has(formatCard(card))).toBe(false);
        }
      }
    }
    expect(playerIds).toContain(award.tieBreak.result.winnerId);
    expect(stackValueOf(run1, award.tieBreak.result.winnerId)).toBe(545);
  });
});
