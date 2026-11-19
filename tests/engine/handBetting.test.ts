import { describe, expect, it } from 'vitest';
import { initialDistribution } from '../../src/engine/bank';
import { addChips, CHIP_SET, chipValue, subtractChips, type ChipCounts } from '../../src/engine/chips';
import { exchangeHandChips, getLegalActions, startHand } from '../../src/engine/hand';
import { createRng } from '../../src/engine/rng';
import {
  assertHandInvariants,
  betAction,
  buildFixtureDeck,
  callAction,
  mustApply,
  mustDeclare,
  mustExchange,
  mustRejectAction,
  mustStartHand,
  pickChips,
  raiseAction,
  seatOf,
  stackValueOf,
} from './handTestHelpers';

function fourPlayerTable(
  seed = 'betting-seed',
  options?: {
    openerId?: string;
    enablePreflopBetting?: boolean;
    preflopCap?: number;
    holeCardsByPlayer?: Readonly<Record<string, string>>;
    board?: string;
  },
) {
  const init = initialDistribution(4);
  const playerIds = ['A', 'B', 'C', 'D'];
  const deck = buildFixtureDeck({
    playerIds,
    dealerIndex: 3,
    holeCardsByPlayer: options?.holeCardsByPlayer ?? {
      A: 'As Kd',
      B: 'Qh Qd',
      C: 'Jh Td',
      D: '8c 7c',
    },
    board: options?.board ?? '2s 5h 9c 3d 4s',
  });

  return mustStartHand({
    seats: playerIds.map((playerId) => ({ playerId, stack: init.perPlayer })),
    bank: init.bank,
    rng: createRng(seed),
    config: {
      dealerIndex: 3,
      enablePreflopBetting: options?.enablePreflopBetting ?? false,
      preflopCap: options?.preflopCap ?? 50,
    },
    fixtures: {
      deck,
      openerId: options?.openerId ?? 'A',
    },
  }).state;
}

describe('hand betting rules (R1-R16, C2, C3, exchanges, uncalled refund)', () => {
  it('R1: at cap 50, C only has Call 50 / Fold and A only has Call +30 / Fold', () => {
    let state = fourPlayerTable('R1', { openerId: 'A' });

    state = mustApply(state, 'A', betAction(state, 'A', 20)).state;
    state = mustApply(state, 'B', raiseAction(state, 'B', 50)).state;

    // C's turn at cap 50
    const legalC = getLegalActions(state)!;
    expect(legalC.playerId).toBe('C');
    expect(legalC.canFold).toBe(true);
    expect(legalC.canCall).toBe(true);
    expect(legalC.callAmount).toBe(50);
    expect(legalC.canCheck).toBe(false);
    expect(legalC.canBet).toBe(false);
    expect(legalC.canRaise).toBe(false);
    expect(legalC.raiseRange).toBeNull();
    mustRejectAction(state, 'C', { type: 'check' }, 'cannot-check-facing-bet');
    mustRejectAction(
      state,
      'C',
      { type: 'raise', raiseTo: 55, chips: { 5: 1, 10: 0, 50: 1, 100: 0 } },
      'cap-reached',
    );

    state = mustApply(state, 'C', callAction(state, 'C')).state;
    state = mustApply(state, 'D', { type: 'fold' }).state;

    // Back to A who already put in 20 -> needs +30 to call, no raise
    const legalA = getLegalActions(state)!;
    expect(legalA.playerId).toBe('A');
    expect(legalA.canFold).toBe(true);
    expect(legalA.canCall).toBe(true);
    expect(legalA.callAmount).toBe(30);
    expect(legalA.canRaise).toBe(false);
    expect(legalA.canCheck).toBe(false);

    state = mustApply(state, 'A', callAction(state, 'A')).state;
    expect(state.street).toBe('turn');
    expect(state.currentBet).toBe(0);
    expect(chipValue(state.pot)).toBe(20 + 50 * 3);
  });

  it('R2: street cap resets to 0 on each street (50 on flop, then 50 on turn)', () => {
    let state = fourPlayerTable('R2', { openerId: 'B' });

    state = mustApply(state, 'B', betAction(state, 'B', 50)).state;
    state = mustApply(state, 'C', callAction(state, 'C')).state;
    state = mustApply(state, 'D', callAction(state, 'D')).state;
    state = mustApply(state, 'A', callAction(state, 'A')).state;

    expect(state.street).toBe('turn');
    expect(state.currentBet).toBe(0);
    expect(state.activePlayerId).toBe('B');
    expect(seatOf(state, 'B').streetContribution).toBe(0);

    // B bets 50 again on turn -> valid
    state = mustApply(state, 'B', betAction(state, 'B', 50)).state;
    expect(state.currentBet).toBe(50);
    expect(seatOf(state, 'B').streetContribution).toBe(50);
    expect(seatOf(state, 'B').totalContribution).toBe(5 + 50 + 50);
  });

  it('R3: ante is excluded from street cap (first actor can bet 50 on flop, total contribution 55)', () => {
    let state = fourPlayerTable('R3', { openerId: 'A' });
    expect(chipValue(state.pot)).toBe(20);
    expect(seatOf(state, 'A').totalContribution).toBe(5);
    expect(seatOf(state, 'A').streetContribution).toBe(0);

    state = mustApply(state, 'A', betAction(state, 'A', 50)).state;
    expect(seatOf(state, 'A').streetContribution).toBe(50);
    expect(seatOf(state, 'A').totalContribution).toBe(55);
    expect(stackValueOf(state, 'A')).toBe(445);
  });

  it('R4: accepts raise to 25, rejects raise to 22 (non-multiple of 5) and 55 (exceeds cap)', () => {
    let state = fourPlayerTable('R4', { openerId: 'A' });
    state = mustApply(state, 'A', betAction(state, 'A', 20)).state;

    mustRejectAction(
      state,
      'B',
      { type: 'raise', raiseTo: 22, chips: { 5: 0, 10: 2, 50: 0, 100: 0 } },
      'invalid-amount',
    );
    mustRejectAction(
      state,
      'B',
      { type: 'raise', raiseTo: 55, chips: { 5: 1, 10: 0, 50: 1, 100: 0 } },
      'invalid-amount',
    );

    // Retry valid raise to 25 on the exact unchanged state
    const res = mustApply(state, 'B', raiseAction(state, 'B', 25));
    expect(res.state.currentBet).toBe(25);
    expect(seatOf(res.state, 'B').streetContribution).toBe(25);
  });

  it('R5: forbids check when facing a bet', () => {
    let state = fourPlayerTable('R5', { openerId: 'A' });
    state = mustApply(state, 'A', betAction(state, 'A', 10)).state;

    const legalB = getLegalActions(state)!;
    expect(legalB.canCheck).toBe(false);
    mustRejectAction(state, 'B', { type: 'check' }, 'cannot-check-facing-bet');
  });

  it('R6: rejects bet 0 and bet 3 without mutating state', () => {
    const state = fourPlayerTable('R6', { openerId: 'A' });

    mustRejectAction(
      state,
      'A',
      { type: 'bet', amount: 0, chips: { 5: 0, 10: 0, 50: 0, 100: 0 } },
      'invalid-amount',
    );
    mustRejectAction(
      state,
      'A',
      { type: 'bet', amount: 3, chips: { 5: 0, 10: 0, 50: 0, 100: 0 } },
      'invalid-amount',
    );
    expect(state.activePlayerId).toBe('A');
    expect(state.currentBet).toBe(0);
  });

  it('R7: when opener D folds on flop, turn starts at first remaining clockwise seat from D', () => {
    let state = fourPlayerTable('R7', { openerId: 'D' });
    expect(state.activePlayerId).toBe('D');

    state = mustApply(state, 'D', { type: 'fold' }).state;
    state = mustApply(state, 'A', { type: 'check' }).state;
    state = mustApply(state, 'B', { type: 'check' }).state;
    state = mustApply(state, 'C', { type: 'check' }).state;

    expect(state.street).toBe('turn');
    expect(state.activePlayerId).toBe('A');
  });

  it('R8: when everyone folds to A on flop, A wins pot immediately without dealing turn or revealing cards', () => {
    let state = fourPlayerTable('R8', { openerId: 'A' });
    state = mustApply(state, 'A', betAction(state, 'A', 10)).state;
    state = mustApply(state, 'B', { type: 'fold' }).state;
    state = mustApply(state, 'C', { type: 'fold' }).state;
    state = mustApply(state, 'D', { type: 'fold' }).state;

    expect(state.phase).toBe('complete');
    expect(state.board).toHaveLength(3); // turn was NOT dealt
    expect(state.outcome).toEqual({
      kind: 'fold-win',
      winnerId: 'A',
      potAmount: 30,
      revealedCards: false,
    });
    expect(chipValue(state.pot)).toBe(0);
    expect(stackValueOf(state, 'A')).toBe(515);
  });

  it('R9: sole remaining active player still resolves facing bet, then board runs out to showdown', () => {
    const init = initialDistribution(4);
    // Give A exactly 35 (5 ante + 30 stack) so A goes all-in for 30 on flop
    const aStack: ChipCounts = { 5: 1, 10: 3, 50: 0, 100: 0 }; // 35
    const extraToBank = subtractChips(init.perPlayer, aStack);
    const bank = addChips(init.bank, extraToBank);
    const deck = buildFixtureDeck({
      playerIds: ['A', 'B', 'C', 'D'],
      dealerIndex: 3,
      holeCardsByPlayer: { A: 'As Ah', B: 'Ks Kh', C: '7c 2d', D: '8c 3d' },
      board: '2c 4h 9s Jd Qc',
    });

    let state = mustStartHand({
      seats: [
        { playerId: 'A', stack: aStack },
        { playerId: 'B', stack: init.perPlayer },
        { playerId: 'C', stack: init.perPlayer },
        { playerId: 'D', stack: init.perPlayer },
      ],
      bank,
      rng: createRng('R9'),
      config: { dealerIndex: 3 },
      fixtures: { deck, openerId: 'A' },
    }).state;

    // A bets 30 (all-in!), B still faces 30, C & D fold
    state = mustApply(state, 'A', betAction(state, 'A', 30)).state;
    expect(seatOf(state, 'A').status).toBe('all-in');
    // B must still decide on A's bet
    expect(state.phase).toBe('betting');
    expect(state.activePlayerId).toBe('B');

    // Have C and D fold after B calls? Let's test B being the last actor after C/D fold:
    // Re-run with opener C -> C folds, D folds, A bets 30 all-in -> B is the ONLY active player left, MUST still act!
    let state2 = mustStartHand({
      seats: [
        { playerId: 'A', stack: aStack },
        { playerId: 'B', stack: init.perPlayer },
        { playerId: 'C', stack: init.perPlayer },
        { playerId: 'D', stack: init.perPlayer },
      ],
      bank,
      rng: createRng('R9-b'),
      config: { dealerIndex: 3 },
      fixtures: { deck, openerId: 'C' },
    }).state;

    state2 = mustApply(state2, 'C', { type: 'fold' }).state;
    state2 = mustApply(state2, 'D', { type: 'fold' }).state;
    state2 = mustApply(state2, 'A', betAction(state2, 'A', 30)).state;

    // R9: A is all-in, B is the only active player left, yet B MUST still resolve the facing 30 call!
    expect(state2.phase).toBe('betting');
    expect(state2.activePlayerId).toBe('B');
    expect(state2.board).toHaveLength(3);
    expect(getLegalActions(state2)!.callAmount).toBe(30);

    // Once B calls, engine auto-runs out turn + river and finishes showdown with no turn/river betting
    state2 = mustApply(state2, 'B', callAction(state2, 'B')).state;
    expect(state2.phase).toBe('complete');
    expect(state2.board).toHaveLength(5);
    expect(state2.outcome?.kind).toBe('showdown');
    expect(stackValueOf(state2, 'A')).toBe(80); // 20 ante + 30 + 30
  });

  it('R9-fix1: goes straight to runout and showdown when sole active player matches currentBet without acting (A all-in on ante 5, opener B, B and C fold)', () => {
    const init = initialDistribution(4);
    const aStack: ChipCounts = { 5: 1, 10: 0, 50: 0, 100: 0 }; // 5 -> all-in on ante
    const bank = addChips(init.bank, subtractChips(init.perPlayer, aStack));
    const deck = buildFixtureDeck({
      playerIds: ['A', 'B', 'C', 'D'],
      dealerIndex: 3,
      holeCardsByPlayer: { A: 'As Ah', B: '7c 2d', C: '8c 3d', D: 'Ks Kh' },
      board: '2c 4h 9s Jd Qc',
    });

    let state = mustStartHand({
      seats: [
        { playerId: 'A', stack: aStack },
        { playerId: 'B', stack: init.perPlayer },
        { playerId: 'C', stack: init.perPlayer },
        { playerId: 'D', stack: init.perPlayer },
      ],
      bank,
      rng: createRng('R9-ante-allin-runout'),
      config: { dealerIndex: 3 },
      fixtures: { deck, openerId: 'B' },
    }).state;

    expect(seatOf(state, 'A').status).toBe('all-in');
    expect(state.phase).toBe('betting');
    expect(state.activePlayerId).toBe('B');
    expect(state.board).toHaveLength(3);

    state = mustApply(state, 'B', { type: 'fold' }).state;
    expect(state.phase).toBe('betting');
    expect(state.activePlayerId).toBe('C');

    // After C folds, only A (all-in) and D (active, never acted, facing 0) remain -> immediate runout & showdown
    const afterC = mustApply(state, 'C', { type: 'fold' });
    state = afterC.state;

    expect(afterC.decisionRequiredFor).toBeNull();
    expect(state.phase).toBe('complete');
    expect(state.activePlayerId).toBeNull();
    expect(getLegalActions(state)).toBeNull();
    expect(state.board).toHaveLength(5);
    expect(seatOf(state, 'D').hasActedThisStreet).toBe(false);
    expect(state.outcome?.kind).toBe('showdown');
    if (state.outcome?.kind !== 'showdown') {
      throw new Error('Expected showdown outcome');
    }
    expect(state.outcome.resolution.potAwards).toHaveLength(1);
    expect(state.outcome.resolution.potAwards[0]!.potAmount).toBe(20);
    expect(state.outcome.resolution.potAwards[0]!.eligiblePlayerIds).toEqual(['A', 'D']);
    expect(state.outcome.resolution.potAwards[0]!.awards).toEqual([{ playerId: 'A', amount: 20 }]);
    expect(stackValueOf(state, 'A')).toBe(20);
    expect(stackValueOf(state, 'D')).toBe(495);
    expect(chipValue(state.pot)).toBe(0);

    // Same scenario when D had declared an out-of-turn bet 20: reserved chips return cleanly before runout
    let ootState = mustStartHand({
      seats: [
        { playerId: 'A', stack: aStack },
        { playerId: 'B', stack: init.perPlayer },
        { playerId: 'C', stack: init.perPlayer },
        { playerId: 'D', stack: init.perPlayer },
      ],
      bank,
      rng: createRng('R9-ante-allin-runout-oot'),
      config: { dealerIndex: 3, allowOutOfTurn: true },
      fixtures: { deck, openerId: 'B' },
    }).state;

    const bet20Chips: ChipCounts = { 5: 0, 10: 2, 50: 0, 100: 0 };
    const dStackBeforeDeclare = seatOf(ootState, 'D').stack;
    ootState = mustDeclare(ootState, 'D', { type: 'bet', amount: 20, chips: bet20Chips }).state;
    expect(stackValueOf(ootState, 'D')).toBe(475);

    ootState = mustApply(ootState, 'B', { type: 'fold' }).state;
    const afterCOot = mustApply(ootState, 'C', { type: 'fold' });
    ootState = afterCOot.state;

    expect(afterCOot.decisionRequiredFor).toBeNull();
    expect(afterCOot.autoExecutedDeclarations).toHaveLength(0);
    expect(afterCOot.cancelledDeclarations).toHaveLength(1);
    expect(afterCOot.cancelledDeclarations[0]!.playerId).toBe('D');
    expect(seatOf(ootState, 'D').declaration).toBeNull();
    expect(seatOf(ootState, 'D').stack).toEqual(dStackBeforeDeclare);
    expect(ootState.phase).toBe('complete');
    expect(ootState.board).toHaveLength(5);
    expect(ootState.outcome?.kind).toBe('showdown');
    expect(stackValueOf(ootState, 'A')).toBe(20);
    expect(stackValueOf(ootState, 'D')).toBe(495);
  });

  it('R9-fix1: goes straight to runout and showdown when zero active players remain', () => {
    const init = initialDistribution(4);
    const stack35: ChipCounts = { 5: 1, 10: 3, 50: 0, 100: 0 }; // 35 -> 30 after ante
    const deck = buildFixtureDeck({
      playerIds: ['A', 'B', 'C', 'D'],
      dealerIndex: 3,
      holeCardsByPlayer: { A: 'As Ah', B: 'Ks Kh', C: '7c 2d', D: '8c 3d' },
      board: '2c 4h 9s Jd Qc',
    });

    // Case 1: Both remaining players go all-in on flop (A bets 30 all-in, B calls 30 all-in) -> 0 active players
    const bank1 = addChips(
      init.bank,
      addChips(subtractChips(init.perPlayer, stack35), subtractChips(init.perPlayer, stack35)),
    );
    let state1 = mustStartHand({
      seats: [
        { playerId: 'A', stack: stack35 },
        { playerId: 'B', stack: stack35 },
        { playerId: 'C', stack: init.perPlayer },
        { playerId: 'D', stack: init.perPlayer },
      ],
      bank: bank1,
      rng: createRng('R9-zero-active-call'),
      config: { dealerIndex: 3 },
      fixtures: { deck, openerId: 'C' },
    }).state;

    state1 = mustApply(state1, 'C', { type: 'fold' }).state;
    state1 = mustApply(state1, 'D', { type: 'fold' }).state;
    state1 = mustApply(state1, 'A', betAction(state1, 'A', 30)).state;

    const legalB = getLegalActions(state1)!;
    expect(legalB.canCall).toBe(true);
    expect(legalB.callAmount).toBe(30);
    expect(legalB.isCallAllIn).toBe(true);
    expect(legalB.canFold).toBe(true);
    expect(legalB.canRaise).toBe(false);

    const afterCall = mustApply(state1, 'B', callAction(state1, 'B'));
    state1 = afterCall.state;
    expect(afterCall.decisionRequiredFor).toBeNull();
    expect(state1.seats.filter((s) => s.status === 'active')).toHaveLength(0);
    expect(state1.phase).toBe('complete');
    expect(state1.board).toHaveLength(5);
    expect(state1.outcome?.kind).toBe('showdown');
    expect(stackValueOf(state1, 'A')).toBe(80);
    expect(stackValueOf(state1, 'B')).toBe(0);

    // Case 2: A all-in on ante 5, B bets 30 all-in, C & D fold -> 0 active players, uncalled 30 refunded to B, showdown A vs B
    const stack5: ChipCounts = { 5: 1, 10: 0, 50: 0, 100: 0 };
    const bank2 = addChips(
      init.bank,
      addChips(subtractChips(init.perPlayer, stack5), subtractChips(init.perPlayer, stack35)),
    );
    let state2 = mustStartHand({
      seats: [
        { playerId: 'A', stack: stack5 },
        { playerId: 'B', stack: stack35 },
        { playerId: 'C', stack: init.perPlayer },
        { playerId: 'D', stack: init.perPlayer },
      ],
      bank: bank2,
      rng: createRng('R9-zero-active-uncalled'),
      config: { dealerIndex: 3 },
      fixtures: { deck, openerId: 'B' },
    }).state;

    state2 = mustApply(state2, 'B', betAction(state2, 'B', 30)).state;
    state2 = mustApply(state2, 'C', { type: 'fold' }).state;
    const afterD = mustApply(state2, 'D', { type: 'fold' });
    state2 = afterD.state;

    expect(afterD.decisionRequiredFor).toBeNull();
    expect(state2.seats.filter((s) => s.status === 'active')).toHaveLength(0);
    expect(state2.phase).toBe('complete');
    expect(state2.board).toHaveLength(5);
    expect(state2.outcome?.kind).toBe('showdown');
    expect(stackValueOf(state2, 'A')).toBe(20); // wins 20 ante pot
    expect(stackValueOf(state2, 'B')).toBe(30); // uncalled 30 refunded
  });

  it('R9-fix1: sole active player facing all-in bet can call or fold, cannot raise to 40, and call runs out to showdown', () => {
    const init = initialDistribution(4);
    const aStack: ChipCounts = { 5: 1, 10: 3, 50: 0, 100: 0 }; // 35 -> 30 after ante
    const bank = addChips(init.bank, subtractChips(init.perPlayer, aStack));
    const deck = buildFixtureDeck({
      playerIds: ['A', 'B', 'C', 'D'],
      dealerIndex: 3,
      holeCardsByPlayer: { A: 'As Ah', B: 'Ks Kh', C: '7c 2d', D: '8c 3d' },
      board: '2c 4h 9s Jd Qc',
    });

    let state = mustStartHand({
      seats: [
        { playerId: 'A', stack: aStack },
        { playerId: 'B', stack: init.perPlayer },
        { playerId: 'C', stack: init.perPlayer },
        { playerId: 'D', stack: init.perPlayer },
      ],
      bank,
      rng: createRng('R9-no-raise-allin'),
      config: { dealerIndex: 3 },
      fixtures: { deck, openerId: 'C' },
    }).state;

    state = mustApply(state, 'C', { type: 'fold' }).state;
    state = mustApply(state, 'D', { type: 'fold' }).state;
    state = mustApply(state, 'A', betAction(state, 'A', 30)).state;

    expect(seatOf(state, 'A').status).toBe('all-in');
    expect(state.phase).toBe('betting');
    expect(state.activePlayerId).toBe('B');
    expect(state.board).toHaveLength(3);

    const legalB = getLegalActions(state)!;
    expect(legalB.playerId).toBe('B');
    expect(legalB.canCall).toBe(true);
    expect(legalB.callAmount).toBe(30);
    expect(legalB.isCallAllIn).toBe(false);
    expect(legalB.canFold).toBe(true);
    expect(legalB.canCheck).toBe(false);
    expect(legalB.canBet).toBe(false);
    expect(legalB.betRange).toBeNull();
    expect(legalB.canRaise).toBe(false);
    expect(legalB.raiseRange).toBeNull();

    // Raising to 40 against an all-in opponent is rejected without mutating state (INV-1 & INV-2 checked)
    mustRejectAction(
      state,
      'B',
      raiseAction(state, 'B', 40),
      'cannot-raise-without-active-opponent',
    );
    expect(state.activePlayerId).toBe('B');
    expect(state.currentBet).toBe(30);
    expect(stackValueOf(state, 'B')).toBe(495);

    // Folding is still legal and ends immediately without runout
    const folded = mustApply(state, 'B', { type: 'fold' }).state;
    expect(folded.phase).toBe('complete');
    expect(folded.board).toHaveLength(3);
    expect(folded.outcome).toEqual({
      kind: 'fold-win',
      winnerId: 'A',
      potAmount: 50,
      revealedCards: false,
    });
    expect(stackValueOf(folded, 'A')).toBe(50);

    // Calling 30 goes straight to runout and showdown
    const called = mustApply(state, 'B', callAction(state, 'B'));
    expect(called.decisionRequiredFor).toBeNull();
    expect(called.state.phase).toBe('complete');
    expect(called.state.board).toHaveLength(5);
    expect(called.state.outcome?.kind).toBe('showdown');
    expect(stackValueOf(called.state, 'A')).toBe(80);
    expect(stackValueOf(called.state, 'B')).toBe(465);
  });

  it('R9-fix1: cancels declared raise and returns reserved chips when all other opponents fold or go all-in before actor turn', () => {
    const init = initialDistribution(4);
    const stack35: ChipCounts = { 5: 1, 10: 3, 50: 0, 100: 0 }; // 35 -> 30 after ante
    const deck = buildFixtureDeck({
      playerIds: ['A', 'B', 'C', 'D'],
      dealerIndex: 3,
      holeCardsByPlayer: { A: 'As Ah', B: '7c 2d', C: 'Qc Qd', D: 'Ks Kh' },
      board: '2c 4h 9s Jd 5c',
    });

    // Subcase A: D declares raise to 40 while B and C are active; B and C both fold -> D's raise is cancelled, 40 returned
    const bankA = addChips(init.bank, subtractChips(init.perPlayer, stack35));
    let stateA = mustStartHand({
      seats: [
        { playerId: 'A', stack: stack35 },
        { playerId: 'B', stack: init.perPlayer },
        { playerId: 'C', stack: init.perPlayer },
        { playerId: 'D', stack: init.perPlayer },
      ],
      bank: bankA,
      rng: createRng('R9-oot-raise-cancel-fold'),
      config: { dealerIndex: 3, allowOutOfTurn: true },
      fixtures: { deck, openerId: 'A' },
    }).state;

    stateA = mustApply(stateA, 'A', betAction(stateA, 'A', 30)).state;
    const dStackBeforeDeclare = seatOf(stateA, 'D').stack;
    const raise40Chips: ChipCounts = { 5: 0, 10: 4, 50: 0, 100: 0 };

    stateA = mustDeclare(stateA, 'D', { type: 'raise', raiseTo: 40, chips: raise40Chips }).state;
    expect(seatOf(stateA, 'D').declaration?.reservedChips).toEqual(raise40Chips);
    expect(stackValueOf(stateA, 'D')).toBe(455);

    stateA = mustApply(stateA, 'B', { type: 'fold' }).state;
    expect(seatOf(stateA, 'D').declaration).not.toBeNull();

    const afterC = mustApply(stateA, 'C', { type: 'fold' });
    stateA = afterC.state;

    expect(afterC.autoExecutedDeclarations).toHaveLength(0);
    expect(afterC.cancelledDeclarations).toHaveLength(1);
    expect(afterC.cancelledDeclarations[0]!.playerId).toBe('D');
    expect(afterC.decisionRequiredFor).toBe('D');
    expect(stateA.phase).toBe('betting');
    expect(stateA.activePlayerId).toBe('D');
    expect(stateA.awaitingDecision).toEqual({
      playerId: 'D',
      street: 'flop',
      hadCancelledDeclaration: true,
    });
    expect(seatOf(stateA, 'D').declaration).toBeNull();
    expect(seatOf(stateA, 'D').stack).toEqual(dStackBeforeDeclare);
    expect(stackValueOf(stateA, 'D')).toBe(495);

    const cancelEvent = afterC.events.find((e) => e.type === 'out-of-turn-cancelled');
    expect(cancelEvent).toEqual({
      type: 'out-of-turn-cancelled',
      street: 'flop',
      playerId: 'D',
      action: { type: 'raise', raiseTo: 40, chips: raise40Chips },
      reason: 'action-no-longer-legal',
      triggeredByPlayerId: 'C',
      returnedChips: raise40Chips,
    });

    const legalD = getLegalActions(stateA)!;
    expect(legalD.canCall).toBe(true);
    expect(legalD.callAmount).toBe(30);
    expect(legalD.canFold).toBe(true);
    expect(legalD.canRaise).toBe(false);
    expect(legalD.raiseRange).toBeNull();

    mustRejectAction(
      stateA,
      'D',
      raiseAction(stateA, 'D', 40),
      'cannot-raise-without-active-opponent',
    );

    stateA = mustApply(stateA, 'D', callAction(stateA, 'D')).state;
    expect(stateA.phase).toBe('complete');
    expect(stateA.board).toHaveLength(5);
    expect(stateA.outcome?.kind).toBe('showdown');
    expect(stackValueOf(stateA, 'A')).toBe(80);
    expect(stackValueOf(stateA, 'D')).toBe(465);

    // Subcase B: C auto-executes all-in call 30 after B folds -> A and C both all-in -> D's declared raise 40 cancelled & chips returned
    const bankB = addChips(
      init.bank,
      addChips(subtractChips(init.perPlayer, stack35), subtractChips(init.perPlayer, stack35)),
    );
    let stateB = mustStartHand({
      seats: [
        { playerId: 'A', stack: stack35 },
        { playerId: 'B', stack: init.perPlayer },
        { playerId: 'C', stack: stack35 },
        { playerId: 'D', stack: init.perPlayer },
      ],
      bank: bankB,
      rng: createRng('R9-oot-raise-cancel-allin'),
      config: { dealerIndex: 3, allowOutOfTurn: true },
      fixtures: { deck, openerId: 'A' },
    }).state;

    stateB = mustApply(stateB, 'A', betAction(stateB, 'A', 30)).state;
    const dStackB = seatOf(stateB, 'D').stack;
    stateB = mustDeclare(stateB, 'C', { type: 'call', chips: { 5: 0, 10: 3, 50: 0, 100: 0 } }).state;
    stateB = mustDeclare(stateB, 'D', { type: 'raise', raiseTo: 40, chips: raise40Chips }).state;

    const afterB = mustApply(stateB, 'B', { type: 'fold' });
    stateB = afterB.state;

    expect(afterB.autoExecutedDeclarations.map((d) => d.playerId)).toEqual(['C']);
    expect(afterB.cancelledDeclarations.map((d) => d.playerId)).toEqual(['D']);
    expect(seatOf(stateB, 'C').status).toBe('all-in');
    expect(seatOf(stateB, 'D').declaration).toBeNull();
    expect(seatOf(stateB, 'D').stack).toEqual(dStackB);
    expect(stateB.activePlayerId).toBe('D');
    expect(getLegalActions(stateB)!.canRaise).toBe(false);

    stateB = mustApply(stateB, 'D', callAction(stateB, 'D')).state;
    expect(stateB.phase).toBe('complete');
    expect(stateB.board).toHaveLength(5);
    expect(stateB.outcome?.kind).toBe('showdown');
    expect(stackValueOf(stateB, 'A')).toBe(110); // 20 ante + 30*3
  });

  it('R10: allows unlimited raises by steps of 5 up to 50, then restricts to call/fold', () => {
    let state = fourPlayerTable('R10', { openerId: 'A' });
    const order = ['A', 'B', 'C', 'D'];
    state = mustApply(state, 'A', betAction(state, 'A', 5)).state;

    let turn = 1;
    for (let target = 10; target <= 50; target += 5) {
      const playerId = order[turn % 4]!;
      expect(state.activePlayerId).toBe(playerId);
      state = mustApply(state, playerId, raiseAction(state, playerId, target)).state;
      turn += 1;
    }

    expect(state.currentBet).toBe(50);
    const nextLegal = getLegalActions(state)!;
    expect(nextLegal.canRaise).toBe(false);
    expect(nextLegal.canCall).toBe(true);
    expect(nextLegal.canFold).toBe(true);
  });

  it('R11: default config disables preflop betting and deals flop immediately', () => {
    const state = fourPlayerTable('R11', { openerId: 'B' });
    expect(state.config.enablePreflopBetting).toBe(false);
    expect(state.street).toBe('flop');
    expect(state.board).toHaveLength(3);
    expect(state.activePlayerId).toBe('B');
  });

  it('R12: enabling preflop betting runs a preflop street from opener before dealing flop', () => {
    let state = fourPlayerTable('R12', {
      openerId: 'C',
      enablePreflopBetting: true,
      preflopCap: 50,
    });
    expect(state.street).toBe('preflop');
    expect(state.board).toHaveLength(0);
    expect(state.activePlayerId).toBe('C');

    state = mustApply(state, 'C', betAction(state, 'C', 15)).state;
    state = mustApply(state, 'D', callAction(state, 'D')).state;
    state = mustApply(state, 'A', callAction(state, 'A')).state;
    state = mustApply(state, 'B', callAction(state, 'B')).state;

    expect(state.street).toBe('flop');
    expect(state.board).toHaveLength(3);
    expect(state.activePlayerId).toBe('C');
    expect(chipValue(state.pot)).toBe(20 + 15 * 4);
  });

  it('R13: preflop cap 50 and flop cap 50 are tracked independently', () => {
    let state = fourPlayerTable('R13', {
      openerId: 'A',
      enablePreflopBetting: true,
      preflopCap: 50,
    });

    state = mustApply(state, 'A', betAction(state, 'A', 50)).state;
    state = mustApply(state, 'B', callAction(state, 'B')).state;
    state = mustApply(state, 'C', callAction(state, 'C')).state;
    state = mustApply(state, 'D', callAction(state, 'D')).state;

    expect(state.street).toBe('flop');
    expect(state.streetCap).toBe(50);
    state = mustApply(state, 'A', betAction(state, 'A', 50)).state;
    expect(seatOf(state, 'A').streetContribution).toBe(50);
    expect(seatOf(state, 'A').totalContribution).toBe(5 + 50 + 50);
  });

  it('R14: enforces configured preflopCap (20) while keeping flop cap at 50', () => {
    let state = fourPlayerTable('R14', {
      openerId: 'A',
      enablePreflopBetting: true,
      preflopCap: 20,
    });
    expect(state.streetCap).toBe(20);

    state = mustApply(state, 'A', betAction(state, 'A', 15)).state;
    mustRejectAction(
      state,
      'B',
      { type: 'raise', raiseTo: 25, chips: pickChips(seatOf(state, 'B').stack, 25) },
      'invalid-amount',
    );
    state = mustApply(state, 'B', raiseAction(state, 'B', 20)).state;
    state = mustApply(state, 'C', callAction(state, 'C')).state;
    state = mustApply(state, 'D', callAction(state, 'D')).state;
    state = mustApply(state, 'A', callAction(state, 'A')).state;

    expect(state.street).toBe('flop');
    expect(state.streetCap).toBe(50);
    state = mustApply(state, 'A', betAction(state, 'A', 50)).state;
    expect(state.currentBet).toBe(50);
  });

  it('R15: everyone folding preflop awards pot immediately without dealing flop', () => {
    let state = fourPlayerTable('R15', {
      openerId: 'A',
      enablePreflopBetting: true,
    });
    state = mustApply(state, 'A', betAction(state, 'A', 10)).state;
    state = mustApply(state, 'B', { type: 'fold' }).state;
    state = mustApply(state, 'C', { type: 'fold' }).state;
    state = mustApply(state, 'D', { type: 'fold' }).state;

    expect(state.phase).toBe('complete');
    expect(state.board).toHaveLength(0);
    expect(state.outcome).toEqual({
      kind: 'fold-win',
      winnerId: 'A',
      potAmount: 30,
      revealedCards: false,
    });
  });

  it('R16: everyone checking preflop deals flop and begins flop betting normally', () => {
    let state = fourPlayerTable('R16', {
      openerId: 'A',
      enablePreflopBetting: true,
    });
    for (const id of ['A', 'B', 'C', 'D']) {
      state = mustApply(state, id, { type: 'check' }).state;
    }

    expect(state.street).toBe('flop');
    expect(state.board).toHaveLength(3);
    expect(state.activePlayerId).toBe('A');
    expect(chipValue(state.pot)).toBe(20);
  });

  it('C2: rejects chip selection whose value does not match call amount, accepts exact retry', () => {
    let state = fourPlayerTable('C2', { openerId: 'A' });
    state = mustApply(state, 'A', betAction(state, 'A', 30)).state;

    // B selects 35 (3x10 + 1x5) when call is 30 -> rejected
    mustRejectAction(
      state,
      'B',
      { type: 'call', chips: { 5: 1, 10: 3, 50: 0, 100: 0 } },
      'chips-mismatch-amount',
    );

    // Retry with exact 30 (3x10) -> succeeds
    state = mustApply(state, 'B', { type: 'call', chips: { 5: 0, 10: 3, 50: 0, 100: 0 } }).state;
    expect(seatOf(state, 'B').streetContribution).toBe(30);
  });

  it('C3: exchanges chips with another player and with the pot without altering turn, bet, or invariants', () => {
    const heroStack: ChipCounts = { 5: 1, 10: 0, 50: 3, 100: 1 }; // 255 -> 250 after ante (3x50 + 1x100)
    const p1Stack: ChipCounts = { 5: 10, 10: 10, 50: 5, 100: 1 }; // 500
    const p2Stack: ChipCounts = { 5: 10, 10: 10, 50: 5, 100: 1 };
    const p3Stack: ChipCounts = { 5: 10, 10: 10, 50: 5, 100: 1 };
    const totalUsed = addChips(addChips(heroStack, p1Stack), addChips(p2Stack, p3Stack));
    const bank = subtractChips(CHIP_SET, totalUsed);

    let state = mustStartHand({
      seats: [
        { playerId: 'A', stack: p1Stack },
        { playerId: 'hero', stack: heroStack },
        { playerId: 'C', stack: p2Stack },
        { playerId: 'D', stack: p3Stack },
      ],
      bank,
      rng: createRng('C3'),
      config: { dealerIndex: 3 },
      fixtures: { openerId: 'A' },
    }).state;

    // A bets 35 (3x10 + 1x5 -> now pot has 5x5 + 3x10 = 55)
    state = mustApply(state, 'A', {
      type: 'bet',
      amount: 35,
      chips: { 5: 1, 10: 3, 50: 0, 100: 0 },
    }).state;

    // Hero has {5:0, 10:0, 50:3, 100:1} and cannot directly pay 35
    mustRejectAction(
      state,
      'hero',
      { type: 'call', chips: { 5: 1, 10: 3, 50: 0, 100: 0 } },
      'insufficient-chips',
    );

    // Rejected exchange (unequal values) leaves state unchanged
    const badEx = exchangeHandChips(state, {
      fromPlayerId: 'hero',
      target: { kind: 'pot' },
      give: { 5: 0, 10: 0, 50: 1, 100: 0 },
      receive: { 5: 0, 10: 4, 50: 0, 100: 0 },
    });
    expect(badEx.ok).toBe(false);
    expect(badEx.state).toBe(state);
    assertHandInvariants(state);

    // Exchange 1x50 with the pot for 3x10 + 4x5 (= 50)
    const afterPotEx = mustExchange(state, {
      fromPlayerId: 'hero',
      target: { kind: 'pot' },
      give: { 5: 0, 10: 0, 50: 1, 100: 0 },
      receive: { 5: 4, 10: 3, 50: 0, 100: 0 },
    }).state;
    expect(afterPotEx.activePlayerId).toBe('hero');
    expect(afterPotEx.currentBet).toBe(35);
    expect(chipValue(afterPotEx.pot)).toBe(chipValue(state.pot));
    expect(stackValueOf(afterPotEx, 'hero')).toBe(250);

    // Also verify player-to-player exchange (hero exchanges 1x50 with C for 4x10 + 2x5)
    const afterPlayerEx = mustExchange(afterPotEx, {
      fromPlayerId: 'hero',
      target: { kind: 'player', playerId: 'C' },
      give: { 5: 0, 10: 0, 50: 1, 100: 0 },
      receive: { 5: 2, 10: 4, 50: 0, 100: 0 },
    }).state;
    expect(afterPlayerEx.activePlayerId).toBe('hero');
    expect(stackValueOf(afterPlayerEx, 'hero')).toBe(250);
    expect(stackValueOf(afterPlayerEx, 'C')).toBe(495);

    // Now hero can call exact 35
    const afterCall = mustApply(afterPlayerEx, 'hero', {
      type: 'call',
      chips: { 5: 1, 10: 3, 50: 0, 100: 0 },
    }).state;
    expect(seatOf(afterCall, 'hero').streetContribution).toBe(35);
    expect(stackValueOf(afterCall, 'hero')).toBe(215);
  });

  it('refunds uncalled bet excess to bettor when only shorter all-in calls and others fold', () => {
    const init = initialDistribution(4);
    const aStack: ChipCounts = { 5: 1, 10: 3, 50: 0, 100: 0 }; // 35 -> 30 after ante
    const bank = addChips(init.bank, subtractChips(init.perPlayer, aStack));
    const deck = buildFixtureDeck({
      playerIds: ['A', 'B', 'C', 'D'],
      dealerIndex: 3,
      holeCardsByPlayer: {
        A: 'As Ah', // wins main pot 80
        B: 'Ks Kh', // loses main pot, keeps uncalled 20
        C: '2c 7d',
        D: '3c 8d',
      },
      board: '4s 6h 9c Jd Qc',
    });

    let state = mustStartHand({
      seats: [
        { playerId: 'A', stack: aStack },
        { playerId: 'B', stack: init.perPlayer },
        { playerId: 'C', stack: init.perPlayer },
        { playerId: 'D', stack: init.perPlayer },
      ],
      bank,
      rng: createRng('uncalled-refund'),
      config: { dealerIndex: 3 },
      fixtures: { deck, openerId: 'B' },
    }).state;

    // B bets 50, C folds, D folds, A calls all-in 30 -> B gets 20 uncalled refunded!
    state = mustApply(state, 'B', betAction(state, 'B', 50)).state;
    state = mustApply(state, 'C', { type: 'fold' }).state;
    state = mustApply(state, 'D', { type: 'fold' }).state;
    state = mustApply(state, 'A', callAction(state, 'A')).state;

    expect(state.phase).toBe('complete');
    const refundEvent = state.timeline.find((e) => e.type === 'uncalled-refund');
    expect(refundEvent).toBeDefined();
    expect(refundEvent?.type === 'uncalled-refund' && refundEvent.playerId).toBe('B');
    expect(refundEvent?.type === 'uncalled-refund' && refundEvent.amount).toBe(20);
    // Main pot = 20 ante + 30 (A) + 30 (B) = 80 -> won by A
    expect(stackValueOf(state, 'A')).toBe(80);
    // B started at 500, paid 5 ante + 30 matched = 35 net loss -> 465 (got 20 back!)
    expect(stackValueOf(state, 'B')).toBe(465);
  });

  it('produces identical deck and opener for the same seed using forked RNG streams', () => {
    const init = initialDistribution(4);
    const make = (seed: string) =>
      mustStartHand({
        seats: ['A', 'B', 'C', 'D'].map((playerId) => ({ playerId, stack: init.perPlayer })),
        bank: init.bank,
        rng: createRng(seed),
      }).state;

    const s1 = make('deterministic-hand');
    const s2 = make('deterministic-hand');
    expect(s1.deck).toEqual(s2.deck);
    expect(s1.openerPlayerId).toBe(s2.openerPlayerId);
    expect(s1.board).toEqual(s2.board);

    // Rejects invalid preflopCap values
    const badCap = startHand({
      seats: ['A', 'B', 'C', 'D'].map((playerId) => ({ playerId, stack: init.perPlayer })),
      bank: init.bank,
      rng: createRng('bad-cap'),
      config: { enablePreflopBetting: true, preflopCap: 12 },
    });
    expect(badCap.ok).toBe(false);
    if (!badCap.ok) {
      expect(badCap.code).toBe('invalid-config');
    }
  });
});
