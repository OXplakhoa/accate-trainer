import { describe, expect, it } from 'vitest';
import { initialDistribution } from '../../src/engine/bank';
import { chipValue } from '../../src/engine/chips';
import {
  declareOutOfTurn,
  exchangeHandChips,
  getLegalActions,
  withdrawOutOfTurnDeclaration,
} from '../../src/engine/hand';
import { createRng } from '../../src/engine/rng';
import {
  assertHandInvariants,
  betAction,
  buildFixtureDeck,
  mustApply,
  mustDeclare,
  mustExchange,
  mustStartHand,
  raiseAction,
  seatOf,
  stackValueOf,
} from './handTestHelpers';

function sixPlayerTable(seed: string, openerId = 'D') {
  const init = initialDistribution(6);
  const playerIds = ['A', 'B', 'C', 'D', 'E', 'F'];
  const deck = buildFixtureDeck({
    playerIds,
    dealerIndex: 5,
    holeCardsByPlayer: {
      A: 'Kd 4c',
      B: '8h 6h',
      C: 'Js Jd',
      D: 'Qc 3d',
      E: 'Ac Ts',
      F: '4d 3c',
    },
    board: '9h 7h 2c 5s Kc',
  });

  return mustStartHand({
    seats: playerIds.map((playerId) => ({ playerId, stack: init.perPlayer })),
    bank: init.bank,
    rng: createRng(seed),
    config: { dealerIndex: 5, allowOutOfTurn: true },
    fixtures: { deck, openerId },
  }).state;
}

describe('out-of-turn declarations (X1-X7)', () => {
  it('X1: B declares bet 20 while D acts; D, E, F, A check -> B bet 20 auto-executes mandatorily', () => {
    let state = sixPlayerTable('X1', 'D');
    expect(state.activePlayerId).toBe('D');

    const bet20Chips = { 5: 0, 10: 2, 50: 0, 100: 0 };
    const declRes = mustDeclare(state, 'B', { type: 'bet', amount: 20, chips: bet20Chips });
    state = declRes.state;

    // Reserved chips are removed from B's available stack but NOT yet in pot or contributions
    expect(seatOf(state, 'B').declaration?.reservedChips).toEqual(bet20Chips);
    expect(stackValueOf(state, 'B')).toBe(475);
    expect(chipValue(state.pot)).toBe(30); // still only 6x5 ante
    expect(seatOf(state, 'B').streetContribution).toBe(0);
    expect(seatOf(state, 'B').totalContribution).toBe(5);

    state = mustApply(state, 'D', { type: 'check' }).state;
    state = mustApply(state, 'E', { type: 'check' }).state;
    state = mustApply(state, 'F', { type: 'check' }).state;

    // When A checks, turn reaches B -> B's declared bet 20 executes automatically and turn moves to C
    const afterA = mustApply(state, 'A', { type: 'check' });
    state = afterA.state;

    expect(afterA.autoExecutedDeclarations).toHaveLength(1);
    expect(afterA.autoExecutedDeclarations[0]!.playerId).toBe('B');
    expect(afterA.decisionRequiredFor).toBe('C');
    expect(state.activePlayerId).toBe('C');
    expect(state.currentBet).toBe(20);
    expect(chipValue(state.pot)).toBe(50);
    expect(seatOf(state, 'B').streetContribution).toBe(20);
    expect(seatOf(state, 'B').declaration).toBeNull();
  });

  it('X2: if A bets 10 before B turn, B declaration is cancelled, 20 returned, B acts freely', () => {
    let state = sixPlayerTable('X2', 'D');
    const bet20Chips = { 5: 0, 10: 2, 50: 0, 100: 0 };
    state = mustDeclare(state, 'B', { type: 'bet', amount: 20, chips: bet20Chips }).state;

    state = mustApply(state, 'D', { type: 'check' }).state;
    state = mustApply(state, 'E', { type: 'check' }).state;
    state = mustApply(state, 'F', { type: 'check' }).state;

    // A bets 10 -> cancels B's declaration and returns 2x10 to B's stack
    const afterA = mustApply(state, 'A', betAction(state, 'A', 10));
    state = afterA.state;

    expect(afterA.cancelledDeclarations).toHaveLength(1);
    expect(afterA.cancelledDeclarations[0]!.playerId).toBe('B');
    expect(seatOf(state, 'B').declaration).toBeNull();
    expect(stackValueOf(state, 'B')).toBe(495); // exact 20 returned
    expect(state.activePlayerId).toBe('B');

    const legalB = getLegalActions(state)!;
    expect(legalB.canFold).toBe(true);
    expect(legalB.canCall).toBe(true);
    expect(legalB.callAmount).toBe(10);
    expect(legalB.canRaise).toBe(true);
    expect(legalB.raiseRange).toEqual({ min: 15, max: 50, step: 5 });

    // B can freely raise to 30
    state = mustApply(state, 'B', raiseAction(state, 'B', 30)).state;
    expect(state.currentBet).toBe(30);
  });

  it('X3: public timeline retains declared, cancelled, and auto-executed out-of-turn actions', () => {
    let state = sixPlayerTable('X3', 'D');
    const bet20 = { 5: 0, 10: 2, 50: 0, 100: 0 };
    state = mustDeclare(state, 'B', { type: 'bet', amount: 20, chips: bet20 }).state;
    state = mustDeclare(state, 'C', { type: 'check' }).state;

    state = mustApply(state, 'D', { type: 'check' }).state;
    state = mustApply(state, 'E', { type: 'check' }).state;
    state = mustApply(state, 'F', { type: 'check' }).state;
    // A checks -> B's bet 20 auto-executes, which in turn cancels C's out-of-turn check!
    state = mustApply(state, 'A', { type: 'check' }).state;

    const declaredEvents = state.timeline.filter((e) => e.type === 'out-of-turn-declared');
    const cancelledEvents = state.timeline.filter((e) => e.type === 'out-of-turn-cancelled');
    const autoActionEvents = state.timeline
      .filter((e) => e.type === 'player-action')
      .filter((e) => e.fromOutOfTurn);

    expect(declaredEvents.map((e) => e.playerId)).toEqual(['B', 'C']);
    expect(autoActionEvents).toHaveLength(1);
    expect(autoActionEvents[0]!.playerId).toBe('B');
    expect(cancelledEvents).toHaveLength(1);
    expect(cancelledEvents[0]!.playerId).toBe('C');
    expect(cancelledEvents[0]!.reason).toBe('bet-changed');
    expect(cancelledEvents[0]!.triggeredByPlayerId).toBe('B');
  });

  it('X4: hero declares bet 20 with 2x10 out of turn; priors check -> executes automatically without prompting hero', () => {
    let state = sixPlayerTable('X4', 'D'); // Hero is C
    const chips2x10 = { 5: 0, 10: 2, 50: 0, 100: 0 };
    state = mustDeclare(state, 'C', { type: 'bet', amount: 20, chips: chips2x10 }).state;
    expect(chipValue(state.pot)).toBe(30);
    expect(stackValueOf(state, 'C')).toBe(475);

    for (const id of ['D', 'E', 'F', 'A']) {
      state = mustApply(state, id, { type: 'check' }).state;
    }

    const afterB = mustApply(state, 'B', { type: 'check' });
    state = afterB.state;

    expect(afterB.autoExecutedDeclarations).toHaveLength(1);
    expect(afterB.autoExecutedDeclarations[0]!.playerId).toBe('C');
    expect(afterB.decisionRequiredFor).toBe('D');
    expect(state.activePlayerId).toBe('D');
    expect(state.currentBet).toBe(20);
    expect(chipValue(state.pot)).toBe(50);
    expect(seatOf(state, 'C').streetContribution).toBe(20);
  });

  it('X5: rival raises to 40 before hero turn -> hero declaration cancelled, 2x10 returned, hero folds without losing 20', () => {
    let state = sixPlayerTable('X5', 'D'); // Hero is C
    const chips2x10 = { 5: 0, 10: 2, 50: 0, 100: 0 };
    const stackBeforeDeclare = seatOf(state, 'C').stack;

    state = mustDeclare(state, 'C', { type: 'bet', amount: 20, chips: chips2x10 }).state;
    state = mustApply(state, 'D', { type: 'check' }).state;
    state = mustApply(state, 'E', { type: 'check' }).state;
    state = mustApply(state, 'F', { type: 'check' }).state;
    state = mustApply(state, 'A', betAction(state, 'A', 15)).state;
    // A's bet 15 already cancelled C's declaration; now B raises to 40 before C's turn!
    const afterB = mustApply(state, 'B', raiseAction(state, 'B', 40));
    state = afterB.state;

    expect(state.activePlayerId).toBe('C');
    expect(seatOf(state, 'C').stack).toEqual(stackBeforeDeclare); // exact 2x10 restored!

    const legalHero = getLegalActions(state)!;
    expect(legalHero.canFold).toBe(true);
    expect(legalHero.canCall).toBe(true);
    expect(legalHero.callAmount).toBe(40);
    expect(legalHero.canRaise).toBe(true);
    expect(legalHero.raiseRange).toEqual({ min: 45, max: 50, step: 5 });

    // Hero folds and keeps all 495 (never lost the 20)
    state = mustApply(state, 'C', { type: 'fold' }).state;
    expect(stackValueOf(state, 'C')).toBe(495);
    expect(seatOf(state, 'C').totalContribution).toBe(5);
  });

  it('X6: hero cannot withdraw a binding out-of-turn declaration while action has not changed', () => {
    const state = mustDeclare(sixPlayerTable('X6', 'D'), 'C', {
      type: 'bet',
      amount: 20,
      chips: { 5: 0, 10: 2, 50: 0, 100: 0 },
    }).state;

    const withdrawRes = withdrawOutOfTurnDeclaration(state, 'C');
    expect(withdrawRes.ok).toBe(false);
    if (!withdrawRes.ok) {
      expect(withdrawRes.code).toBe('declaration-binding');
    }
    expect(withdrawRes.state).toBe(state);
    assertHandInvariants(state);

    // Also cannot overwrite an active declaration
    const overwriteRes = declareOutOfTurn(state, 'C', { type: 'check' });
    expect(overwriteRes.ok).toBe(false);
    if (!overwriteRes.ok) {
      expect(overwriteRes.code).toBe('declaration-already-active');
    }
    expect(overwriteRes.state).toBe(state);
    assertHandInvariants(state);
  });

  it('X7: signals manual decision only after declaration cancellation, never when valid declaration auto-executes', () => {
    // Path A: valid declaration -> auto-executes, never requests manual decision for hero C
    let stateValid = sixPlayerTable('X7-valid', 'D');
    stateValid = mustDeclare(stateValid, 'C', {
      type: 'bet',
      amount: 20,
      chips: { 5: 0, 10: 2, 50: 0, 100: 0 },
    }).state;
    const seenDecisionTargets: Array<string | null> = [];
    for (const id of ['D', 'E', 'F', 'A', 'B']) {
      const step = mustApply(stateValid, id, { type: 'check' });
      seenDecisionTargets.push(step.decisionRequiredFor);
      stateValid = step.state;
    }
    expect(seenDecisionTargets).not.toContain('C');
    expect(stateValid.awaitingDecision).toEqual({
      playerId: 'D',
      street: 'flop',
      hadCancelledDeclaration: false,
    });

    // Path B: rival bets before hero -> declaration cancelled, engine signals decision for hero C
    let stateCancelled = sixPlayerTable('X7-cancel', 'D');
    stateCancelled = mustDeclare(stateCancelled, 'C', {
      type: 'bet',
      amount: 20,
      chips: { 5: 0, 10: 2, 50: 0, 100: 0 },
    }).state;
    for (const id of ['D', 'E', 'F', 'A']) {
      stateCancelled = mustApply(stateCancelled, id, { type: 'check' }).state;
    }
    const afterB = mustApply(stateCancelled, 'B', betAction(stateCancelled, 'B', 15));
    expect(afterB.decisionRequiredFor).toBe('C');
    expect(afterB.state.awaitingDecision).toEqual({
      playerId: 'C',
      street: 'flop',
      hadCancelledDeclaration: true,
    });
  });

  it('preserves reserved out-of-turn chips during chip exchange and rejects spending reserved chips', () => {
    let state = sixPlayerTable('reserved-exchange', 'D');
    // B has {5: 15, 10: 12, 50: 6, 100: 0} after ante; reserve ALL 12x10? No, reserve 1x50 for bet 50
    const reserved50 = { 5: 0, 10: 0, 50: 1, 100: 0 };
    state = mustDeclare(state, 'B', { type: 'bet', amount: 50, chips: reserved50 }).state;
    expect(seatOf(state, 'B').stack[50]).toBe(5);
    expect(seatOf(state, 'B').declaration?.reservedChips).toEqual(reserved50);

    // Attempting to exchange all 6x50 fails because 1x50 is reserved
    const badEx = exchangeHandChips(state, {
      fromPlayerId: 'B',
      target: { kind: 'player', playerId: 'A' },
      give: { 5: 0, 10: 0, 50: 6, 100: 0 },
      receive: { 5: 10, 10: 10, 50: 3, 100: 0 },
    });
    expect(badEx.ok).toBe(false);
    expect(badEx.state).toBe(state);
    assertHandInvariants(state);

    // Valid exchange using available stack leaves reservedChips untouched
    const okEx = mustExchange(state, {
      fromPlayerId: 'B',
      target: { kind: 'player', playerId: 'A' },
      give: { 5: 0, 10: 0, 50: 1, 100: 0 },
      receive: { 5: 2, 10: 4, 50: 0, 100: 0 },
    }).state;
    expect(seatOf(okEx, 'B').declaration?.reservedChips).toEqual(reserved50);
    expect(seatOf(okEx, 'B').stack[50]).toBe(4);
  });
});
