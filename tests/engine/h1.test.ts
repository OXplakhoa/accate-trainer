import { describe, expect, it } from 'vitest';
import {
  ANTE,
  BET_STEP,
  STREET_CAP,
  chipValue,
  createRng,
  formatCard,
  getLegalActions,
  initialDistribution,
  type HandState,
} from '../../src/engine';
import {
  assertHandInvariants,
  betAction,
  buildFixtureDeck,
  callAction,
  mustApply,
  mustRejectAction,
  mustStartHand,
  raiseAction,
  seatOf,
  stackValueOf,
} from './handTestHelpers';

const PLAYER_IDS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
const DEALER_INDEX = 5; // F
const HERO_ID = 'C';

function assertPotAndCall(state: HandState, expectedPot: number, expectedCall: number): void {
  const legal = getLegalActions(state);
  expect(legal).not.toBeNull();
  expect(legal!.playerId).toBe(HERO_ID);
  expect(chipValue(state.pot)).toBe(expectedPot);
  expect(legal!.toCall).toBe(expectedCall);
  expect(legal!.callAmount).toBe(expectedCall);
}

describe('H1 — Full 6-player hand integration (steps 1-18)', () => {
  it('replays H1 from ante through showdown with exact pots, turn order, cap, invariants, and final stacks', () => {
    const init = initialDistribution(6);
    expect(init.perPlayer).toEqual({ 5: 16, 10: 12, 50: 6, 100: 0 });
    expect(chipValue(init.perPlayer)).toBe(500);

    const deck = buildFixtureDeck({
      playerIds: PLAYER_IDS,
      dealerIndex: DEALER_INDEX,
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

    // Steps 1-3: Ante -> Deal hole cards -> Deal flop (preflop & out-of-turn disabled)
    const startRes = mustStartHand({
      seats: PLAYER_IDS.map((playerId) => ({ playerId, stack: init.perPlayer })),
      bank: init.bank,
      rng: createRng('H1-seed'),
      config: {
        dealerIndex: DEALER_INDEX,
        enablePreflopBetting: false,
        allowOutOfTurn: false,
      },
      fixtures: {
        deck,
        openerId: 'D',
      },
    });
    let state = startRes.state;
    assertHandInvariants(state);

    expect(startRes.events.map((e) => e.type)).toEqual([
      'ante-collected',
      'cards-dealt',
      'street-dealt',
    ]);
    expect(startRes.events[0]).toEqual({
      type: 'ante-collected',
      antePerPlayer: ANTE,
      playerIds: [...PLAYER_IDS],
      allInPlayerIds: [],
    });
    expect(startRes.events[1]).toEqual({
      type: 'cards-dealt',
      dealerPlayerId: 'F',
      openerPlayerId: 'D',
      playerIds: [...PLAYER_IDS],
    });
    expect(startRes.events[2]).toMatchObject({
      type: 'street-dealt',
      street: 'flop',
    });

    // Step 1: Ante 5 each -> pot 30, every stack 495
    expect(chipValue(state.pot)).toBe(30);
    for (const id of PLAYER_IDS) {
      expect(stackValueOf(state, id)).toBe(495);
      expect(seatOf(state, id).totalContribution).toBe(ANTE);
      expect(seatOf(state, id).streetContribution).toBe(0);
    }

    // Step 2: Exact hole cards for A-F
    expect(seatOf(state, 'A').holeCards.map(formatCard)).toEqual(['Kd', '4c']);
    expect(seatOf(state, 'B').holeCards.map(formatCard)).toEqual(['8h', '6h']);
    expect(seatOf(state, 'C').holeCards.map(formatCard)).toEqual(['Js', 'Jd']);
    expect(seatOf(state, 'D').holeCards.map(formatCard)).toEqual(['Qc', '3d']);
    expect(seatOf(state, 'E').holeCards.map(formatCard)).toEqual(['Ac', 'Ts']);
    expect(seatOf(state, 'F').holeCards.map(formatCard)).toEqual(['4d', '3c']);

    // Step 3: Flop 9h 7h 2c dealt, opener D acts first
    expect(state.phase).toBe('betting');
    expect(state.street).toBe('flop');
    expect(state.streetCap).toBe(STREET_CAP);
    expect(state.currentBet).toBe(0);
    expect(state.board.map(formatCard)).toEqual(['9h', '7h', '2c']);
    expect(state.activePlayerId).toBe('D');
    expect(startRes.decisionRequiredFor).toBe('D');

    // Step 4: Flop: D check, E check, F check
    let step = mustApply(state, 'D', { type: 'check' });
    state = step.state;
    expect(state.activePlayerId).toBe('E');

    step = mustApply(state, 'E', { type: 'check' });
    state = step.state;
    expect(state.activePlayerId).toBe('F');

    step = mustApply(state, 'F', { type: 'check' });
    state = step.state;
    expect(state.activePlayerId).toBe('A');
    expect(chipValue(state.pot)).toBe(30);
    expect(state.currentBet).toBe(0);

    // Step 5: A bet 10
    step = mustApply(state, 'A', betAction(state, 'A', 10));
    state = step.state;
    expect(state.currentBet).toBe(10);
    expect(chipValue(state.pot)).toBe(40);
    expect(stackValueOf(state, 'A')).toBe(485);
    expect(seatOf(state, 'A').streetContribution).toBe(10);
    expect(state.activePlayerId).toBe('B');

    // Step 6: B raise to 30 (spends 30 chips from stack, raises currentBet from 10 to 30)
    step = mustApply(state, 'B', raiseAction(state, 'B', 30));
    state = step.state;
    expect(step.events).toHaveLength(1);
    expect(step.events[0]).toMatchObject({
      type: 'player-action',
      street: 'flop',
      playerId: 'B',
      addedAmount: 30,
      newStreetContribution: 30,
      newCurrentBet: 30,
    });
    expect(state.currentBet).toBe(30);
    expect(chipValue(state.pot)).toBe(70);
    expect(stackValueOf(state, 'B')).toBe(465);
    expect(seatOf(state, 'B').streetContribution).toBe(30);
    expect(state.activePlayerId).toBe(HERO_ID);

    // Step 7: Hero C's turn on flop — Fold / Call 30 / Raise 35..50, no Check; pot odds 70/30
    const legalCFlop = getLegalActions(state)!;
    expect(legalCFlop).toMatchObject({
      playerId: 'C',
      street: 'flop',
      streetCap: STREET_CAP,
      currentBet: 30,
      playerStreetContribution: 0,
      toCall: 30,
      canFold: true,
      canCheck: false,
      canBet: false,
      canCall: true,
      callAmount: 30,
      isCallAllIn: false,
      canRaise: true,
      raiseRange: { min: 35, max: STREET_CAP, step: BET_STEP },
    });
    mustRejectAction(state, 'C', { type: 'check' }, 'cannot-check-facing-bet');
    assertPotAndCall(state, 70, 30);
    expect(legalCFlop.callAmount! / (chipValue(state.pot) + legalCFlop.callAmount!)).toBeCloseTo(
      0.3,
      6,
    );

    // Step 8: C selects 10+10+10 -> Call 30
    step = mustApply(state, 'C', {
      type: 'call',
      chips: { 5: 0, 10: 3, 50: 0, 100: 0 },
    });
    state = step.state;
    expect(chipValue(state.pot)).toBe(100);
    expect(stackValueOf(state, 'C')).toBe(465);
    expect(seatOf(state, 'C').streetContribution).toBe(30);
    expect(state.activePlayerId).toBe('D');

    // Step 9: D, E, F cannot check facing 30 and all fold
    for (const id of ['D', 'E', 'F'] as const) {
      expect(state.activePlayerId).toBe(id);
      const legal = getLegalActions(state)!;
      expect(legal.canCheck).toBe(false);
      expect(legal.toCall).toBe(30);
      mustRejectAction(state, id, { type: 'check' }, 'cannot-check-facing-bet');
      step = mustApply(state, id, { type: 'fold' });
      state = step.state;
      expect(seatOf(state, id).status).toBe('folded');
    }
    expect(state.activePlayerId).toBe('A');

    // Step 10 & 11: A calls +20 -> flop closes at pot 120 -> turn 5s dealt -> A opens
    const legalAFlop = getLegalActions(state)!;
    expect(legalAFlop.callAmount).toBe(20);
    expect(legalAFlop.toCall).toBe(20);
    expect(legalAFlop.canCheck).toBe(false);
    expect(legalAFlop.canRaise).toBe(true);
    expect(legalAFlop.raiseRange).toEqual({ min: 35, max: STREET_CAP, step: BET_STEP });

    step = mustApply(state, 'A', callAction(state, 'A'));
    state = step.state;
    expect(chipValue(state.pot)).toBe(120);
    expect(stackValueOf(state, 'A')).toBe(465);
    expect(seatOf(state, 'A').totalContribution).toBe(35);
    expect(seatOf(state, 'B').totalContribution).toBe(35);
    expect(seatOf(state, 'C').totalContribution).toBe(35);

    expect(step.events.map((e) => e.type)).toEqual(['player-action', 'street-dealt']);
    expect(step.events[1]).toMatchObject({ type: 'street-dealt', street: 'turn' });
    expect(state.street).toBe('turn');
    expect(state.board.map(formatCard)).toEqual(['9h', '7h', '2c', '5s']);
    expect(state.currentBet).toBe(0);
    expect(state.streetCap).toBe(STREET_CAP);
    expect(state.activePlayerId).toBe('A');
    expect(step.decisionRequiredFor).toBe('A');

    // Step 12: Turn: A check, B bet 50 (hits cap)
    step = mustApply(state, 'A', { type: 'check' });
    state = step.state;
    expect(state.activePlayerId).toBe('B');

    step = mustApply(state, 'B', betAction(state, 'B', 50));
    state = step.state;
    expect(state.currentBet).toBe(STREET_CAP);
    expect(chipValue(state.pot)).toBe(170);
    expect(stackValueOf(state, 'B')).toBe(415);
    expect(state.activePlayerId).toBe(HERO_ID);

    // Step 13: Hero C's turn on turn — Fold / Call 50, Raise disabled (cap); pot odds 170/50
    const legalCTurn = getLegalActions(state)!;
    expect(legalCTurn).toMatchObject({
      playerId: 'C',
      street: 'turn',
      streetCap: STREET_CAP,
      currentBet: 50,
      toCall: 50,
      canFold: true,
      canCheck: false,
      canBet: false,
      canCall: true,
      callAmount: 50,
      canRaise: false,
      raiseRange: null,
    });
    mustRejectAction(
      state,
      'C',
      { type: 'raise', raiseTo: 55, chips: { 5: 1, 10: 0, 50: 1, 100: 0 } },
      'cap-reached',
    );
    assertPotAndCall(state, 170, 50);
    expect(legalCTurn.callAmount! / (chipValue(state.pot) + legalCTurn.callAmount!)).toBeCloseTo(
      50 / 220,
      6,
    );

    // Step 14 & 15: C calls 50, A folds -> turn closes at pot 220 -> river Kc dealt -> B opens
    step = mustApply(state, 'C', callAction(state, 'C'));
    state = step.state;
    expect(chipValue(state.pot)).toBe(220);
    expect(stackValueOf(state, 'C')).toBe(415);
    expect(state.activePlayerId).toBe('A');

    const legalATurn = getLegalActions(state)!;
    expect(legalATurn.canRaise).toBe(false);
    expect(legalATurn.callAmount).toBe(50);

    step = mustApply(state, 'A', { type: 'fold' });
    state = step.state;
    expect(seatOf(state, 'A').status).toBe('folded');
    expect(chipValue(state.pot)).toBe(220);
    expect(stackValueOf(state, 'A')).toBe(465);
    expect(stackValueOf(state, 'B')).toBe(415);
    expect(stackValueOf(state, 'C')).toBe(415);

    expect(step.events.map((e) => e.type)).toEqual(['player-action', 'street-dealt']);
    expect(step.events[1]).toMatchObject({ type: 'street-dealt', street: 'river' });
    expect(state.street).toBe('river');
    expect(state.board.map(formatCard)).toEqual(['9h', '7h', '2c', '5s', 'Kc']);
    expect(state.currentBet).toBe(0);
    expect(state.streetCap).toBe(STREET_CAP);
    expect(state.activePlayerId).toBe('B');
    expect(step.decisionRequiredFor).toBe('B');

    // Step 16: River: B bet 50; C pot odds 270/50 -> C call -> pot 320 -> showdown
    step = mustApply(state, 'B', betAction(state, 'B', 50));
    state = step.state;
    expect(state.currentBet).toBe(STREET_CAP);
    expect(chipValue(state.pot)).toBe(270);
    expect(stackValueOf(state, 'B')).toBe(365);
    expect(state.activePlayerId).toBe(HERO_ID);

    const legalCRiver = getLegalActions(state)!;
    expect(legalCRiver).toMatchObject({
      playerId: 'C',
      street: 'river',
      streetCap: STREET_CAP,
      currentBet: 50,
      toCall: 50,
      canFold: true,
      canCheck: false,
      canCall: true,
      callAmount: 50,
      canRaise: false,
      raiseRange: null,
    });
    assertPotAndCall(state, 270, 50);
    expect(legalCRiver.callAmount! / (chipValue(state.pot) + legalCRiver.callAmount!)).toBeCloseTo(
      50 / 320,
      6,
    );

    step = mustApply(state, 'C', callAction(state, 'C'));
    state = step.state;

    // Steps 17-18: Showdown (B wins 320 with straight 5-6-7-8-9) and final stacks
    expect(step.events.map((e) => e.type)).toEqual(['player-action', 'showdown', 'payout-settled']);
    expect(step.events[0]).toMatchObject({
      type: 'player-action',
      street: 'river',
      playerId: 'C',
      addedAmount: 50,
    });

    expect(state.phase).toBe('complete');
    expect(state.activePlayerId).toBeNull();
    expect(step.decisionRequiredFor).toBeNull();
    expect(chipValue(state.pot)).toBe(0);

    expect(state.outcome?.kind).toBe('showdown');
    if (state.outcome?.kind !== 'showdown') {
      throw new Error('Expected showdown outcome');
    }
    const { resolution } = state.outcome;
    expect(resolution.potAwards).toHaveLength(1);
    const mainPotAward = resolution.potAwards[0]!;
    expect(mainPotAward.potAmount).toBe(320);
    expect(mainPotAward.eligiblePlayerIds).toEqual(['B', 'C']);
    expect(mainPotAward.evaluatedHands['B']?.category).toBe('straight');
    expect(mainPotAward.evaluatedHands['B']?.ranks).toEqual([9]);
    expect(mainPotAward.evaluatedHands['B']?.best5.map((c) => c.rank)).toEqual([9, 8, 7, 6, 5]);
    expect(mainPotAward.evaluatedHands['C']?.category).toBe('pair');
    expect(mainPotAward.evaluatedHands['C']?.ranks[0]).toBe(11);
    expect(mainPotAward.tiedTopPlayerIds).toEqual(['B']);
    expect(mainPotAward.tieBreak).toEqual({ kind: 'none' });
    expect(mainPotAward.awards).toEqual([{ playerId: 'B', amount: 320 }]);
    expect(resolution.totalPayouts).toEqual([{ playerId: 'B', amount: 320 }]);

    expect(state.settledTransfers).toHaveLength(1);
    expect(state.settledTransfers[0]!.playerId).toBe('B');
    expect(state.settledTransfers[0]!.amount).toBe(320);
    expect(chipValue(state.settledTransfers[0]!.chips)).toBe(320);

    const finalStacks = PLAYER_IDS.map((id) => stackValueOf(state, id));
    expect(finalStacks).toEqual([465, 685, 365, 495, 495, 495]);
    expect(finalStacks.reduce((sum, v) => sum + v, 0)).toBe(3000);
    assertHandInvariants(state);
  });
});
