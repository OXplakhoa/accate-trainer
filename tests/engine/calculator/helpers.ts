import { expect } from 'vitest';
import {
  checkInv1,
  chipValue,
  createRng,
  initialDistribution,
  type ChipCounts,
  type HandState,
} from '../../../src/engine';
import {
  assertHandInvariants,
  betAction,
  buildFixtureDeck,
  callAction,
  mustApply,
  mustStartHand,
  raiseAction,
  seatOf,
} from '../handTestHelpers';

export interface ChipStateSnapshot {
  readonly bank: ChipCounts;
  readonly pot: ChipCounts;
  readonly seats: readonly {
    readonly playerId: string;
    readonly stack: ChipCounts;
    readonly totalContribution: number;
    readonly unsettledContribution: number;
  }[];
}

export function captureChipSnapshot(state: HandState): ChipStateSnapshot {
  return {
    bank: { ...state.bank },
    pot: { ...state.pot },
    seats: state.seats.map((seat) => ({
      playerId: seat.playerId,
      stack: { ...seat.stack },
      totalContribution: seat.totalContribution,
      unsettledContribution: seat.unsettledContribution,
    })),
  };
}

export function assertHandUnchangedAndValid(
  state: HandState,
  before: ChipStateSnapshot,
): void {
  expect(captureChipSnapshot(state)).toEqual(before);
  assertHandInvariants(state);
  const allChipLocations = [
    state.bank,
    state.pot,
    ...state.seats.map((s) => s.stack),
    ...state.seats.flatMap((s) => (s.declaration ? [s.declaration.reservedChips] : [])),
  ];
  expect(checkInv1(allChipLocations)).toEqual({ ok: true });
}

export function assertPureFixtureInv1(playerCount = 6): {
  readonly perPlayer: ChipCounts;
  readonly bank: ChipCounts;
} {
  const dist = initialDistribution(playerCount);
  const stacks = Array.from({ length: playerCount }, () => dist.perPlayer);
  expect(checkInv1([dist.bank, ...stacks])).toEqual({ ok: true });
  return dist;
}

export interface H1DecisionStates {
  /** H1 #7: Hero C facing 30 into pot 70 on flop 9h 7h 2c. */
  readonly step7FlopC: HandState;
  /** H1 #13: Hero C facing 50 (cap) into pot 170 on turn 9h 7h 2c 5s. */
  readonly step13TurnC: HandState;
  /** H1 #16: Hero C facing 50 (cap) into pot 270 on river 9h 7h 2c 5s Kc. */
  readonly step16RiverC: HandState;
}

/**
 * Replays AC H1 using the real hand engine with a fixed seed and returns the exact
 * HandStates at hero C's three decision points (#7, #13, #16).
 */
export function buildH1DecisionStates(): H1DecisionStates {
  const playerIds = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
  const init = initialDistribution(6);
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

  let state = mustStartHand({
    seats: playerIds.map((playerId) => ({ playerId, stack: init.perPlayer })),
    bank: init.bank,
    rng: createRng('P2a-H1-seed'),
    config: {
      dealerIndex: 5,
      enablePreflopBetting: false,
      allowOutOfTurn: false,
    },
    fixtures: {
      deck,
      openerId: 'D',
    },
  }).state;

  // Flop: D, E, F check; A bet 10; B raise to 30 -> C's turn (#7)
  state = mustApply(state, 'D', { type: 'check' }).state;
  state = mustApply(state, 'E', { type: 'check' }).state;
  state = mustApply(state, 'F', { type: 'check' }).state;
  state = mustApply(state, 'A', betAction(state, 'A', 10)).state;
  state = mustApply(state, 'B', raiseAction(state, 'B', 30)).state;
  const step7FlopC = state;

  // C calls 30; D, E, F fold; A calls +20 -> Turn 5s dealt; A check, B bet 50 -> C's turn (#13)
  state = mustApply(state, 'C', {
    type: 'call',
    chips: { 5: 0, 10: 3, 50: 0, 100: 0 },
  }).state;
  state = mustApply(state, 'D', { type: 'fold' }).state;
  state = mustApply(state, 'E', { type: 'fold' }).state;
  state = mustApply(state, 'F', { type: 'fold' }).state;
  state = mustApply(state, 'A', callAction(state, 'A')).state;
  state = mustApply(state, 'A', { type: 'check' }).state;
  state = mustApply(state, 'B', betAction(state, 'B', 50)).state;
  const step13TurnC = state;

  // C calls 50; A folds -> River Kc dealt; B bet 50 -> C's turn (#16)
  state = mustApply(state, 'C', callAction(state, 'C')).state;
  state = mustApply(state, 'A', { type: 'fold' }).state;
  state = mustApply(state, 'B', betAction(state, 'B', 50)).state;
  const step16RiverC = state;

  return { step7FlopC, step13TurnC, step16RiverC };
}

/**
 * Builds a legal 6-player Accate turn HandState matching AC D8:
 * - Ante 5 x 6 = 30; flop all 6 put in 45 -> pot = 300.
 * - Turn: Hero (A) bets max cap 50 -> pot = 350, Villain (B, holding flush draw) faces call 50.
 */
export function buildD8TurnState(): {
  readonly beforeHeroBet: HandState;
  readonly afterHeroBetCap50: HandState;
} {
  const playerIds = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
  const init = initialDistribution(6);
  const deck = buildFixtureDeck({
    playerIds,
    dealerIndex: 5,
    holeCardsByPlayer: {
      A: 'As Kd',
      B: 'Qh Th',
      C: '8c 8d',
      D: '7s 6s',
      E: '5c 4c',
      F: '3d 2d',
    },
    board: 'Ah 9h 2c 4d Ks',
  });

  let state = mustStartHand({
    seats: playerIds.map((playerId) => ({ playerId, stack: init.perPlayer })),
    bank: init.bank,
    rng: createRng('P2a-D8-seed'),
    config: {
      dealerIndex: 5,
      enablePreflopBetting: false,
      allowOutOfTurn: false,
    },
    fixtures: {
      deck,
      openerId: 'A',
    },
  }).state;

  // Flop: A bets 45, B..F all call 45 -> pot = 30 + 6*45 = 300
  state = mustApply(state, 'A', betAction(state, 'A', 45)).state;
  for (const id of ['B', 'C', 'D', 'E', 'F'] as const) {
    state = mustApply(state, id, callAction(state, id)).state;
  }
  expect(state.street).toBe('turn');
  expect(chipValue(state.pot)).toBe(300);
  const beforeHeroBet = state;

  // Turn: Hero A bets cap 50 -> pot = 350, B faces call 50
  const afterHeroBetCap50 = mustApply(state, 'A', betAction(state, 'A', 50)).state;
  expect(chipValue(afterHeroBetCap50.pot)).toBe(350);
  expect(afterHeroBetCap50.activePlayerId).toBe('B');

  return { beforeHeroBet, afterHeroBetCap50 };
}

/**
 * Builds a legal 4-player Accate flop HandState matching AC P1 side-pot structure:
 * - A starts with 35 (ante 5 -> 30 left), B/C/D start with 500.
 * - Flop: B bets 50, A calls all-in 30 -> C's turn facing 50 with main pot + side pot.
 */
export function buildP1SidePotDecisionState(): HandState {
  const init = initialDistribution(4);
  // Give A 35 (3x10 + 1x5) and return the difference (465) to bank to keep exact INV-1.
  const stackA: ChipCounts = { 5: 1, 10: 3, 50: 0, 100: 0 };
  const bankWithRefund: ChipCounts = {
    5: init.bank[5] + (init.perPlayer[5] - stackA[5]),
    10: init.bank[10] + (init.perPlayer[10] - stackA[10]),
    50: init.bank[50] + (init.perPlayer[50] - stackA[50]),
    100: init.bank[100] + (init.perPlayer[100] - stackA[100]),
  };
  expect(
    checkInv1([bankWithRefund, stackA, init.perPlayer, init.perPlayer, init.perPlayer]),
  ).toEqual({ ok: true });

  const playerIds = ['A', 'B', 'C', 'D'] as const;
  const deck = buildFixtureDeck({
    playerIds,
    dealerIndex: 3,
    holeCardsByPlayer: {
      A: 'As Ad',
      B: 'Kh Qh',
      C: 'Jd Td',
      D: '4c 3c',
    },
    board: 'Kd 9d 2h 7c 5s',
  });

  let state = mustStartHand({
    seats: [
      { playerId: 'A', stack: stackA },
      { playerId: 'B', stack: init.perPlayer },
      { playerId: 'C', stack: init.perPlayer },
      { playerId: 'D', stack: init.perPlayer },
    ],
    bank: bankWithRefund,
    rng: createRng('P2a-P1-seed'),
    config: {
      dealerIndex: 3,
      enablePreflopBetting: false,
      allowOutOfTurn: false,
    },
    fixtures: {
      deck,
      openerId: 'B',
    },
  }).state;

  // Ante = 20; A has 30 left.
  expect(chipValue(seatOf(state, 'A').stack)).toBe(30);

  // Flop: B bets 50; C calls? Wait: order from opener B is B -> C -> D -> A.
  // Let's instead have opener = B, B bets 50, C folds? No, for C facing B(50) + A(all-in 30),
  // start opener at B -> B bets 50, let's check seat order: B -> C -> D -> A.
  // Actually let's set seats order B, A, C, D so A acts right after B and goes all-in 30 before C acts!
  state = mustStartHand({
    seats: [
      { playerId: 'B', stack: init.perPlayer },
      { playerId: 'A', stack: stackA },
      { playerId: 'C', stack: init.perPlayer },
      { playerId: 'D', stack: init.perPlayer },
    ],
    bank: bankWithRefund,
    rng: createRng('P2a-P1-seed-order'),
    config: {
      dealerIndex: 3,
      enablePreflopBetting: false,
      allowOutOfTurn: false,
    },
    fixtures: {
      deck: buildFixtureDeck({
        playerIds: ['B', 'A', 'C', 'D'],
        dealerIndex: 3,
        holeCardsByPlayer: {
          B: 'Kh Qh',
          A: 'As Ad',
          C: 'Jd Td',
          D: '4c 3c',
        },
        board: 'Kd 9d 2h 7c 5s',
      }),
      openerId: 'B',
    },
  }).state;

  state = mustApply(state, 'B', betAction(state, 'B', 50)).state;
  state = mustApply(state, 'A', callAction(state, 'A')).state;
  expect(seatOf(state, 'A').status).toBe('all-in');
  expect(state.activePlayerId).toBe('C');
  return state;
}
