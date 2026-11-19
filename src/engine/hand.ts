import { MAX_PLAYERS, MIN_PLAYERS } from './bank';
import { shuffledDeck, type Card } from './cards';
import {
  addChips,
  checkInv1,
  chipValue,
  DENOMINATIONS,
  emptyChips,
  subtractChips,
  type ChipCounts,
} from './chips';
import { exchangeChips, selectionMatches } from './exchange';
import {
  ANTE,
  BET_STEP,
  DEFAULT_HAND_CONFIG,
  MAX_PREFLOP_CAP,
  MIN_PREFLOP_CAP,
  STREET_CAP,
  type BettingAction,
  type HandConfig,
  type HandErrorCode,
  type HandExchangeRequest,
  type HandInvariantReport,
  type HandOutcome,
  type HandState,
  type HandStepResult,
  type HandTimelineEvent,
  type LegalActions,
  type OutOfTurnDeclaration,
  type PendingPayout,
  type SeatState,
  type StartHandInput,
  type StartHandResult,
  type Street,
} from './handTypes';
import { calculatePots, planPotPayouts, type PayoutTransfer } from './pots';
import { createRng } from './rng';
import { resolveShowdown } from './showdown';

const ANTE_CHIPS: ChipCounts = Object.freeze({ 5: 1, 10: 0, 50: 0, 100: 0 });
const VALID_SUITS = new Set<string>(['s', 'h', 'd', 'c']);

interface MutableSeatState {
  seatIndex: number;
  playerId: string;
  stack: ChipCounts;
  holeCards: readonly [Card, Card];
  status: 'active' | 'folded' | 'all-in';
  streetContribution: number;
  totalContribution: number;
  unsettledContribution: number;
  hasActedThisStreet: boolean;
  declaration: OutOfTurnDeclaration | null;
  cancelledDeclarationThisStreet: boolean;
}

interface ValidatedAction {
  readonly addedAmount: number;
  readonly chips: ChipCounts;
  readonly newStreetContribution: number;
  readonly newCurrentBet: number;
  readonly raisesBet: boolean;
}

function isValidChipCounts(chips: ChipCounts): boolean {
  for (const denom of DENOMINATIONS) {
    const count = chips[denom];
    if (!Number.isInteger(count) || count < 0) {
      return false;
    }
  }
  return true;
}

function hasEnoughChips(available: ChipCounts, needed: ChipCounts): boolean {
  if (!isValidChipCounts(available) || !isValidChipCounts(needed)) {
    return false;
  }
  for (const denom of DENOMINATIONS) {
    if (available[denom] < needed[denom]) {
      return false;
    }
  }
  return true;
}

function validateDeck(deck: readonly Card[]): boolean {
  if (deck.length !== 52) {
    return false;
  }
  const seen = new Set<string>();
  for (const card of deck) {
    if (
      !Number.isInteger(card.rank) ||
      card.rank < 2 ||
      card.rank > 14 ||
      !VALID_SUITS.has(card.suit)
    ) {
      return false;
    }
    const key = `${card.rank}:${card.suit}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
  }
  return true;
}

function findNextActiveIndex(
  seats: readonly MutableSeatState[],
  startExclusive: number,
  predicate: (seat: MutableSeatState) => boolean,
): number | null {
  const n = seats.length;
  for (let offset = 1; offset <= n; offset++) {
    const idx = (startExclusive + offset) % n;
    const seat = seats[idx]!;
    if (seat.status === 'active' && predicate(seat)) {
      return idx;
    }
  }
  return null;
}

function findFirstActiveFrom(
  seats: readonly MutableSeatState[],
  startInclusive: number,
): number | null {
  const n = seats.length;
  for (let offset = 0; offset < n; offset++) {
    const idx = (startInclusive + offset) % n;
    if (seats[idx]!.status === 'active') {
      return idx;
    }
  }
  return null;
}

function validateActionAgainstState(
  streetCap: number,
  currentBet: number,
  seat: Pick<SeatState, 'streetContribution'>,
  sourceChips: ChipCounts,
  action: BettingAction,
): { readonly ok: true; readonly validated: ValidatedAction } | { readonly ok: false; readonly code: HandErrorCode; readonly message: string } {
  const availableValue = chipValue(sourceChips);
  const toCall = currentBet - seat.streetContribution;

  switch (action.type) {
    case 'fold':
      return {
        ok: true,
        validated: {
          addedAmount: 0,
          chips: emptyChips(),
          newStreetContribution: seat.streetContribution,
          newCurrentBet: currentBet,
          raisesBet: false,
        },
      };

    case 'check':
      if (toCall > 0) {
        return {
          ok: false,
          code: 'cannot-check-facing-bet',
          message: `Cannot check while facing a bet of ${toCall}`,
        };
      }
      return {
        ok: true,
        validated: {
          addedAmount: 0,
          chips: emptyChips(),
          newStreetContribution: seat.streetContribution,
          newCurrentBet: currentBet,
          raisesBet: false,
        },
      };

    case 'bet': {
      if (currentBet > 0) {
        return {
          ok: false,
          code: 'cannot-bet-when-bet-exists',
          message: `Cannot bet when current bet is already ${currentBet}; use call or raise`,
        };
      }
      if (
        !Number.isInteger(action.amount) ||
        action.amount < BET_STEP ||
        action.amount % BET_STEP !== 0 ||
        action.amount > streetCap
      ) {
        return {
          ok: false,
          code: 'invalid-amount',
          message: `Bet amount must be a multiple of ${BET_STEP} in [${BET_STEP}, ${streetCap}], received ${String(action.amount)}`,
        };
      }
      if (!isValidChipCounts(action.chips) || !selectionMatches(action.chips, action.amount)) {
        return {
          ok: false,
          code: 'chips-mismatch-amount',
          message: `Selected chips do not match bet amount ${action.amount}`,
        };
      }
      if (!hasEnoughChips(sourceChips, action.chips)) {
        return {
          ok: false,
          code: 'insufficient-chips',
          message: 'Player stack lacks the selected chip denominations for bet',
        };
      }
      return {
        ok: true,
        validated: {
          addedAmount: action.amount,
          chips: action.chips,
          newStreetContribution: seat.streetContribution + action.amount,
          newCurrentBet: seat.streetContribution + action.amount,
          raisesBet: true,
        },
      };
    }

    case 'call': {
      if (toCall <= 0) {
        return {
          ok: false,
          code: 'cannot-call-without-bet',
          message: 'Cannot call when there is no bet to match',
        };
      }
      if (availableValue <= 0) {
        return {
          ok: false,
          code: 'insufficient-chips',
          message: 'Player has no chips to call',
        };
      }
      const callAmount = Math.min(toCall, availableValue);
      if (!isValidChipCounts(action.chips) || !selectionMatches(action.chips, callAmount)) {
        return {
          ok: false,
          code: 'chips-mismatch-amount',
          message: `Selected chips do not match required call amount ${callAmount}`,
        };
      }
      if (!hasEnoughChips(sourceChips, action.chips)) {
        return {
          ok: false,
          code: 'insufficient-chips',
          message: 'Player stack lacks the selected chip denominations for call',
        };
      }
      return {
        ok: true,
        validated: {
          addedAmount: callAmount,
          chips: action.chips,
          newStreetContribution: seat.streetContribution + callAmount,
          newCurrentBet: currentBet,
          raisesBet: false,
        },
      };
    }

    case 'raise': {
      if (currentBet === 0) {
        return {
          ok: false,
          code: 'cannot-raise-without-bet',
          message: 'Cannot raise when no bet has been made on this street',
        };
      }
      if (currentBet >= streetCap) {
        return {
          ok: false,
          code: 'cap-reached',
          message: `Street cap of ${streetCap} has already been reached`,
        };
      }
      if (
        !Number.isInteger(action.raiseTo) ||
        action.raiseTo % BET_STEP !== 0 ||
        action.raiseTo < currentBet + BET_STEP ||
        action.raiseTo > streetCap
      ) {
        return {
          ok: false,
          code: 'invalid-amount',
          message: `Raise target must be a multiple of ${BET_STEP} in [${currentBet + BET_STEP}, ${streetCap}], received ${String(action.raiseTo)}`,
        };
      }
      const addedAmount = action.raiseTo - seat.streetContribution;
      if (addedAmount > availableValue) {
        return {
          ok: false,
          code: 'insufficient-chips',
          message: `Player stack (${availableValue}) cannot cover raise addition (${addedAmount})`,
        };
      }
      if (!isValidChipCounts(action.chips) || !selectionMatches(action.chips, addedAmount)) {
        return {
          ok: false,
          code: 'chips-mismatch-amount',
          message: `Selected chips do not match raise addition ${addedAmount}`,
        };
      }
      if (!hasEnoughChips(sourceChips, action.chips)) {
        return {
          ok: false,
          code: 'insufficient-chips',
          message: 'Player stack lacks the selected chip denominations for raise',
        };
      }
      return {
        ok: true,
        validated: {
          addedAmount,
          chips: action.chips,
          newStreetContribution: action.raiseTo,
          newCurrentBet: action.raiseTo,
          raisesBet: true,
        },
      };
    }
  }
}

function freezeSeat(seat: MutableSeatState): SeatState {
  return {
    seatIndex: seat.seatIndex,
    playerId: seat.playerId,
    stack: seat.stack,
    holeCards: seat.holeCards,
    status: seat.status,
    streetContribution: seat.streetContribution,
    totalContribution: seat.totalContribution,
    unsettledContribution: seat.unsettledContribution,
    hasActedThisStreet: seat.hasActedThisStreet,
    declaration: seat.declaration,
    cancelledDeclarationThisStreet: seat.cancelledDeclarationThisStreet,
  };
}

function cloneSeats(seats: readonly SeatState[]): MutableSeatState[] {
  return seats.map((seat) => ({
    seatIndex: seat.seatIndex,
    playerId: seat.playerId,
    stack: seat.stack,
    holeCards: seat.holeCards,
    status: seat.status,
    streetContribution: seat.streetContribution,
    totalContribution: seat.totalContribution,
    unsettledContribution: seat.unsettledContribution,
    hasActedThisStreet: seat.hasActedThisStreet,
    declaration: seat.declaration,
    cancelledDeclarationThisStreet: seat.cancelledDeclarationThisStreet,
  }));
}

function nextStreetAfter(street: Street): Exclude<Street, 'preflop'> | null {
  switch (street) {
    case 'preflop':
      return 'flop';
    case 'flop':
      return 'turn';
    case 'turn':
      return 'river';
    case 'river':
      return null;
  }
}

function runoutAndShowdown(draft: {
  readonly config: HandConfig;
  readonly rngSeed: string;
  readonly seats: MutableSeatState[];
  readonly deck: readonly Card[];
  deckCursor: number;
  board: Card[];
  pot: ChipCounts;
  street: Street;
  newEvents: HandTimelineEvent[];
}): {
  readonly phase: 'complete' | 'awaiting-payout';
  readonly outcome: HandOutcome;
  readonly pendingPayout: PendingPayout | null;
  readonly settledTransfers: readonly PayoutTransfer[];
} {
  if (draft.board.length === 0) {
    const flop = draft.deck.slice(draft.deckCursor, draft.deckCursor + 3);
    draft.deckCursor += 3;
    draft.board.push(...flop);
    draft.newEvents.push({ type: 'street-dealt', street: 'flop', cards: flop });
  }
  if (draft.board.length === 3) {
    const turn = draft.deck.slice(draft.deckCursor, draft.deckCursor + 1);
    draft.deckCursor += 1;
    draft.board.push(...turn);
    draft.newEvents.push({ type: 'street-dealt', street: 'turn', cards: turn });
  }
  if (draft.board.length === 4) {
    const river = draft.deck.slice(draft.deckCursor, draft.deckCursor + 1);
    draft.deckCursor += 1;
    draft.board.push(...river);
    draft.newEvents.push({ type: 'street-dealt', street: 'river', cards: river });
  }
  draft.street = 'river';

  const undealt = draft.deck.slice(draft.deckCursor);
  const handRng = createRng(draft.rngSeed);
  const resolution = resolveShowdown({
    players: draft.seats.map((seat) => ({
      playerId: seat.playerId,
      holeCards: seat.holeCards,
      contribution: seat.unsettledContribution,
      folded: seat.status === 'folded',
    })),
    board: draft.board,
    undealt,
    tieBreakMode: draft.config.tieBreakMode,
    baiCaoRng: handRng.fork('bai-cao'),
    oddChipRng: handRng.fork('odd-chip'),
  });

  draft.newEvents.push({ type: 'showdown', resolution });
  const outcome: HandOutcome = { kind: 'showdown', resolution };

  const transfers = planPotPayouts(draft.pot, resolution.totalPayouts);
  if (transfers === null) {
    draft.newEvents.push({
      type: 'payout-pending',
      requiredPayouts: resolution.totalPayouts,
      reason: 'insufficient-pot-denominations',
    });
    return {
      phase: 'awaiting-payout',
      outcome,
      pendingPayout: { requiredPayouts: resolution.totalPayouts },
      settledTransfers: [],
    };
  }

  for (const transfer of transfers) {
    draft.pot = subtractChips(draft.pot, transfer.chips);
    const recipient = draft.seats.find((s) => s.playerId === transfer.playerId)!;
    recipient.stack = addChips(recipient.stack, transfer.chips);
  }
  for (const seat of draft.seats) {
    seat.unsettledContribution = 0;
  }
  draft.newEvents.push({ type: 'payout-settled', transfers });

  return {
    phase: 'complete',
    outcome,
    pendingPayout: null,
    settledTransfers: transfers,
  };
}

/**
 * Checks INV-1 (all chip locations equal CHIP_SET per denomination, counting reserved out-of-turn
 * chips exactly once) and INV-2 (pot value equals sum of unsettled contributions including ante).
 */
export function checkHandInvariants(state: HandState): HandInvariantReport {
  const locations: ChipCounts[] = [state.bank, state.pot];
  let unsettledTotal = 0;

  for (const seat of state.seats) {
    locations.push(seat.stack);
    if (seat.declaration !== null) {
      locations.push(seat.declaration.reservedChips);
    }
    unsettledTotal += seat.unsettledContribution;
  }

  const inv1 = checkInv1(locations);
  const potValue = chipValue(state.pot);
  const inv2Ok = potValue === unsettledTotal;

  return {
    ok: inv1.ok && inv2Ok,
    inv1,
    inv2: {
      ok: inv2Ok,
      potValue,
      unsettledTotal,
    },
  };
}

/**
 * Starts a new Accate hand: validates seats/config/INV-1, collects ante 5 from every seat,
 * deals 2 hole cards per seat clockwise from left of dealer, picks the hand opener once,
 * and opens either preflop (when enabled) or flop (default) — or runs straight to showdown
 * if <= 1 seat can act after ante.
 */
export function startHand(input: StartHandInput): StartHandResult {
  const seatCount = input.seats.length;
  if (seatCount < MIN_PLAYERS || seatCount > MAX_PLAYERS) {
    return {
      ok: false,
      code: 'invalid-player-count',
      message: `Hand requires between ${MIN_PLAYERS} and ${MAX_PLAYERS} seats, received ${seatCount}`,
    };
  }

  const config: HandConfig = {
    ...DEFAULT_HAND_CONFIG,
    ...input.config,
  };

  if (
    !Number.isInteger(config.preflopCap) ||
    config.preflopCap < MIN_PREFLOP_CAP ||
    config.preflopCap > MAX_PREFLOP_CAP ||
    config.preflopCap % BET_STEP !== 0
  ) {
    return {
      ok: false,
      code: 'invalid-config',
      message: `preflopCap must be a multiple of ${BET_STEP} in [${MIN_PREFLOP_CAP}, ${MAX_PREFLOP_CAP}], received ${String(config.preflopCap)}`,
    };
  }

  if (
    !Number.isInteger(config.dealerIndex) ||
    config.dealerIndex < 0 ||
    config.dealerIndex >= seatCount
  ) {
    return {
      ok: false,
      code: 'invalid-config',
      message: `dealerIndex must be an integer in [0, ${seatCount - 1}], received ${String(config.dealerIndex)}`,
    };
  }

  const seenIds = new Set<string>();
  const seenSeatIndices = new Set<number>();
  for (let i = 0; i < seatCount; i++) {
    const seat = input.seats[i]!;
    if (seenIds.has(seat.playerId)) {
      return {
        ok: false,
        code: 'duplicate-player',
        message: `Duplicate playerId "${seat.playerId}"`,
      };
    }
    seenIds.add(seat.playerId);

    const physicalSeatIndex = seat.seatIndex ?? i;
    if (!Number.isInteger(physicalSeatIndex) || physicalSeatIndex < 0 || seenSeatIndices.has(physicalSeatIndex)) {
      return {
        ok: false,
        code: 'invalid-config',
        message: `Invalid or duplicate physical seatIndex for "${seat.playerId}"`,
      };
    }
    seenSeatIndices.add(physicalSeatIndex);

    if (!isValidChipCounts(seat.stack)) {
      return {
        ok: false,
        code: 'invalid-invariants',
        message: `Invalid chip counts for "${seat.playerId}"`,
      };
    }
  }

  if (!isValidChipCounts(input.bank)) {
    return {
      ok: false,
      code: 'invalid-invariants',
      message: 'Invalid bank chip counts',
    };
  }

  const initialInv1 = checkInv1([input.bank, ...input.seats.map((s) => s.stack)]);
  if (!initialInv1.ok) {
    return {
      ok: false,
      code: 'invalid-invariants',
      message: `Initial chip set fails INV-1: ${JSON.stringify(initialInv1.diff)}`,
    };
  }

  // Validate T3 (no 0-chip seats) and ante denomination availability (QUESTIONS.md #2) before mutating.
  for (const seat of input.seats) {
    const totalValue = chipValue(seat.stack);
    if (totalValue === 0) {
      return {
        ok: false,
        code: 'zero-stack-seat',
        message: `Seat "${seat.playerId}" has 0 chips and must rebuy or leave before ante`,
      };
    }
    if (seat.stack[5] < 1) {
      return {
        ok: false,
        code: 'insufficient-ante-denomination',
        message: `Seat "${seat.playerId}" lacks a 5-point chip to post ante; exchange chips first`,
      };
    }
  }

  const deck =
    input.fixtures?.deck !== undefined
      ? [...input.fixtures.deck]
      : shuffledDeck(input.rng.fork('deck'));
  if (!validateDeck(deck)) {
    return {
      ok: false,
      code: 'invalid-deck',
      message: 'Deck must contain 52 distinct valid cards',
    };
  }

  let openerIndex: number;
  if (input.fixtures?.openerId !== undefined) {
    openerIndex = input.seats.findIndex((s) => s.playerId === input.fixtures!.openerId);
    if (openerIndex === -1) {
      return {
        ok: false,
        code: 'invalid-opener',
        message: `Fixture openerId "${input.fixtures.openerId}" is not seated`,
      };
    }
  } else {
    openerIndex = input.rng.fork('opener').int(seatCount);
  }

  // Collect ante 5 from every seat, including dealer.
  let pot = emptyChips();
  const holeDealt: Card[][] = Array.from({ length: seatCount }, () => []);
  let deckCursor = 0;
  for (let round = 0; round < 2; round++) {
    for (let offset = 1; offset <= seatCount; offset++) {
      const idx = (config.dealerIndex + offset) % seatCount;
      holeDealt[idx]!.push(deck[deckCursor++]!);
    }
  }

  const allInAfterAnte: string[] = [];
  const seats: MutableSeatState[] = input.seats.map((seatInput, idx) => {
    const nextStack = subtractChips(seatInput.stack, ANTE_CHIPS);
    pot = addChips(pot, ANTE_CHIPS);
    const isAllIn = chipValue(nextStack) === 0;
    if (isAllIn) {
      allInAfterAnte.push(seatInput.playerId);
    }
    const cards = holeDealt[idx]!;
    return {
      seatIndex: seatInput.seatIndex ?? idx,
      playerId: seatInput.playerId,
      stack: nextStack,
      holeCards: [cards[0]!, cards[1]!] as const,
      status: isAllIn ? 'all-in' : 'active',
      streetContribution: 0,
      totalContribution: ANTE,
      unsettledContribution: ANTE,
      hasActedThisStreet: false,
      declaration: null,
      cancelledDeclarationThisStreet: false,
    };
  });

  const newEvents: HandTimelineEvent[] = [
    {
      type: 'ante-collected',
      antePerPlayer: ANTE,
      playerIds: seats.map((s) => s.playerId),
      allInPlayerIds: allInAfterAnte,
    },
    {
      type: 'cards-dealt',
      dealerPlayerId: seats[config.dealerIndex]!.playerId,
      openerPlayerId: seats[openerIndex]!.playerId,
      playerIds: seats.map((s) => s.playerId),
    },
  ];

  const activeCount = seats.filter((s) => s.status === 'active').length;
  const board: Card[] = [];

  if (activeCount <= 1) {
    const draft = {
      config,
      rngSeed: input.rng.seed,
      seats,
      deck,
      deckCursor,
      board,
      pot,
      street: 'flop' as Street,
      newEvents,
    };
    const result = runoutAndShowdown(draft);
    const state: HandState = {
      phase: result.phase,
      config,
      rngSeed: input.rng.seed,
      seats: seats.map(freezeSeat),
      dealerIndex: config.dealerIndex,
      dealerSeatIndex: seats[config.dealerIndex]!.seatIndex,
      openerIndex,
      openerSeatIndex: seats[openerIndex]!.seatIndex,
      openerPlayerId: seats[openerIndex]!.playerId,
      street: draft.street,
      streetCap: STREET_CAP,
      currentBet: 0,
      activePlayerIndex: null,
      activePlayerId: null,
      awaitingDecision: null,
      deck,
      deckCursor: draft.deckCursor,
      board: draft.board,
      pot: draft.pot,
      bank: input.bank,
      timeline: [...newEvents],
      outcome: result.outcome,
      pendingPayout: result.pendingPayout,
      settledTransfers: result.settledTransfers,
    };
    return {
      ok: true,
      state,
      events: newEvents,
      decisionRequiredFor: null,
    };
  }

  let street: Street;
  let streetCap: number;
  if (config.enablePreflopBetting) {
    street = 'preflop';
    streetCap = config.preflopCap;
  } else {
    street = 'flop';
    streetCap = STREET_CAP;
    const flop = deck.slice(deckCursor, deckCursor + 3);
    deckCursor += 3;
    board.push(...flop);
    newEvents.push({ type: 'street-dealt', street: 'flop', cards: flop });
  }

  const firstActorIndex = findFirstActiveFrom(seats, openerIndex)!;
  const firstActorId = seats[firstActorIndex]!.playerId;

  const state: HandState = {
    phase: 'betting',
    config,
    rngSeed: input.rng.seed,
    seats: seats.map(freezeSeat),
    dealerIndex: config.dealerIndex,
    dealerSeatIndex: seats[config.dealerIndex]!.seatIndex,
    openerIndex,
    openerSeatIndex: seats[openerIndex]!.seatIndex,
    openerPlayerId: seats[openerIndex]!.playerId,
    street,
    streetCap,
    currentBet: 0,
    activePlayerIndex: firstActorIndex,
    activePlayerId: firstActorId,
    awaitingDecision: {
      playerId: firstActorId,
      street,
      hadCancelledDeclaration: false,
    },
    deck,
    deckCursor,
    board,
    pot,
    bank: input.bank,
    timeline: [...newEvents],
    outcome: null,
    pendingPayout: null,
    settledTransfers: [],
  };

  return {
    ok: true,
    state,
    events: newEvents,
    decisionRequiredFor: firstActorId,
  };
}

/**
 * Computes legal actions and bet/raise ranges for the current actor, or `null` when not in betting.
 */
export function getLegalActions(state: HandState): LegalActions | null {
  if (state.phase !== 'betting' || state.activePlayerIndex === null) {
    return null;
  }
  const seat = state.seats[state.activePlayerIndex]!;
  const availableStack = chipValue(seat.stack);
  const toCall = state.currentBet - seat.streetContribution;

  const canCheck = toCall === 0;
  const canBet = state.currentBet === 0 && availableStack >= BET_STEP && state.streetCap >= BET_STEP;
  const maxBet = Math.min(state.streetCap, availableStack);
  const betRange = canBet ? ({ min: BET_STEP, max: maxBet, step: BET_STEP } as const) : null;

  const canCall = toCall > 0 && availableStack > 0;
  const callAmount = canCall ? Math.min(toCall, availableStack) : null;
  const isCallAllIn = canCall && availableStack <= toCall;

  const minRaiseTo = state.currentBet + BET_STEP;
  const maxRaiseTo = Math.min(state.streetCap, seat.streetContribution + availableStack);
  const canRaise =
    state.currentBet > 0 && state.currentBet < state.streetCap && maxRaiseTo >= minRaiseTo;
  const raiseRange = canRaise ? ({ min: minRaiseTo, max: maxRaiseTo, step: BET_STEP } as const) : null;

  return {
    playerId: seat.playerId,
    street: state.street,
    streetCap: state.streetCap,
    currentBet: state.currentBet,
    playerStreetContribution: seat.streetContribution,
    toCall,
    canFold: true,
    canCheck,
    canBet,
    betRange,
    canCall,
    callAmount,
    isCallAllIn,
    canRaise,
    raiseRange,
  };
}

/**
 * Records a public out-of-turn declaration (X1–X7, D39–D39c).
 * Moves any declared chips from `seat.stack` into `seat.declaration.reservedChips` (still owned by
 * the player, not yet in pot or contributions).
 */
export function declareOutOfTurn(
  state: HandState,
  playerId: string,
  action: BettingAction,
): HandStepResult {
  if (state.phase !== 'betting') {
    return {
      ok: false,
      code: 'hand-not-in-betting-phase',
      message: `Cannot declare out of turn during phase "${state.phase}"`,
      state,
    };
  }
  if (!state.config.allowOutOfTurn) {
    return {
      ok: false,
      code: 'out-of-turn-disabled',
      message: 'Out-of-turn declarations are disabled in hand config',
      state,
    };
  }
  const seatIdx = state.seats.findIndex((s) => s.playerId === playerId);
  if (seatIdx === -1) {
    return {
      ok: false,
      code: 'player-not-found',
      message: `Player "${playerId}" is not seated in this hand`,
      state,
    };
  }
  if (seatIdx === state.activePlayerIndex) {
    return {
      ok: false,
      code: 'is-players-turn',
      message: `It is already "${playerId}"'s turn; use applyAction instead`,
      state,
    };
  }
  const seat = state.seats[seatIdx]!;
  if (seat.status !== 'active') {
    return {
      ok: false,
      code: 'player-not-active',
      message: `Player "${playerId}" has status "${seat.status}" and cannot act`,
      state,
    };
  }
  if (seat.declaration !== null) {
    return {
      ok: false,
      code: 'declaration-already-active',
      message: `Player "${playerId}" already has an active out-of-turn declaration`,
      state,
    };
  }
  if (seat.hasActedThisStreet && seat.streetContribution === state.currentBet) {
    return {
      ok: false,
      code: 'no-upcoming-turn',
      message: `Player "${playerId}" has already matched the current bet and has no upcoming turn unless action changes`,
      state,
    };
  }

  const check = validateActionAgainstState(
    state.streetCap,
    state.currentBet,
    seat,
    seat.stack,
    action,
  );
  if (!check.ok) {
    return {
      ok: false,
      code: check.code,
      message: check.message,
      state,
    };
  }

  const reservedChips = check.validated.chips;
  const declaration: OutOfTurnDeclaration = {
    playerId,
    street: state.street,
    action,
    declaredAtCurrentBet: state.currentBet,
    reservedChips,
  };

  const nextSeats = cloneSeats(state.seats);
  const targetSeat = nextSeats[seatIdx]!;
  targetSeat.stack = subtractChips(targetSeat.stack, reservedChips);
  targetSeat.declaration = declaration;

  const event: HandTimelineEvent = {
    type: 'out-of-turn-declared',
    street: state.street,
    playerId,
    action,
    declaredAtCurrentBet: state.currentBet,
    reservedChips,
  };

  const nextState: HandState = {
    ...state,
    seats: nextSeats.map(freezeSeat),
    timeline: [...state.timeline, event],
  };

  return {
    ok: true,
    state: nextState,
    events: [event],
    autoExecutedDeclarations: [],
    cancelledDeclarations: [],
    decisionRequiredFor: nextState.activePlayerId,
  };
}

/**
 * Attempting to withdraw a valid out-of-turn declaration before action changes is rejected (X6, §3.4).
 */
export function withdrawOutOfTurnDeclaration(state: HandState, playerId: string): HandStepResult {
  const seat = state.seats.find((s) => s.playerId === playerId);
  if (seat === undefined) {
    return {
      ok: false,
      code: 'player-not-found',
      message: `Player "${playerId}" is not seated in this hand`,
      state,
    };
  }
  if (seat.declaration === null) {
    return {
      ok: false,
      code: 'invalid-amount',
      message: `Player "${playerId}" has no active out-of-turn declaration`,
      state,
    };
  }
  return {
    ok: false,
    code: 'declaration-binding',
    message: `Player "${playerId}" cannot withdraw a binding out-of-turn declaration while action is unchanged`,
    state,
  };
}

/**
 * Applies a betting action for the current actor, then advances turns (auto-executing any valid
 * out-of-turn declarations, cancelling declarations when bets change, closing streets, handling
 * uncalled excess refunds, fold-wins, runouts, and showdown settlement).
 */
export function applyAction(
  state: HandState,
  playerId: string,
  action: BettingAction,
): HandStepResult {
  if (state.phase !== 'betting' || state.activePlayerIndex === null) {
    return {
      ok: false,
      code: 'hand-not-in-betting-phase',
      message: `Cannot apply action during phase "${state.phase}"`,
      state,
    };
  }
  const actorIdx = state.seats.findIndex((s) => s.playerId === playerId);
  if (actorIdx === -1) {
    return {
      ok: false,
      code: 'player-not-found',
      message: `Player "${playerId}" is not seated in this hand`,
      state,
    };
  }
  if (actorIdx !== state.activePlayerIndex) {
    return {
      ok: false,
      code: 'not-players-turn',
      message: `It is "${state.activePlayerId}"'s turn, not "${playerId}"'s`,
      state,
    };
  }

  const activeSeat = state.seats[actorIdx]!;
  const initialCheck = validateActionAgainstState(
    state.streetCap,
    state.currentBet,
    activeSeat,
    activeSeat.stack,
    action,
  );
  if (!initialCheck.ok) {
    return {
      ok: false,
      code: initialCheck.code,
      message: initialCheck.message,
      state,
    };
  }

  const seats = cloneSeats(state.seats);
  const board = [...state.board];
  let deckCursor = state.deckCursor;
  let pot = state.pot;
  let street = state.street;
  let streetCap = state.streetCap;
  let currentBet = state.currentBet;
  const newEvents: HandTimelineEvent[] = [];
  const autoExecutedDeclarations: OutOfTurnDeclaration[] = [];
  const cancelledDeclarations: OutOfTurnDeclaration[] = [];

  const releaseAllDeclarations = (reason: 'street-ended' | 'hand-ended'): void => {
    for (const s of seats) {
      if (s.declaration !== null) {
        const decl = s.declaration;
        s.stack = addChips(s.stack, decl.reservedChips);
        s.declaration = null;
        cancelledDeclarations.push(decl);
        newEvents.push({
          type: 'out-of-turn-cancelled',
          street,
          playerId: s.playerId,
          action: decl.action,
          reason,
          returnedChips: decl.reservedChips,
        });
      }
    }
  };

  let currentActorIdx = actorIdx;
  let currentAction: BettingAction = action;
  let currentValidated = initialCheck.validated;
  let fromOutOfTurn = false;

  while (true) {
    const seat = seats[currentActorIdx]!;

    if (fromOutOfTurn) {
      const decl = seat.declaration!;
      seat.declaration = null;
      if (currentValidated.addedAmount > 0) {
        pot = addChips(pot, decl.reservedChips);
      }
    } else {
      seat.cancelledDeclarationThisStreet = false;
      if (currentValidated.addedAmount > 0) {
        seat.stack = subtractChips(seat.stack, currentValidated.chips);
        pot = addChips(pot, currentValidated.chips);
      }
    }

    if (currentValidated.addedAmount > 0) {
      seat.streetContribution = currentValidated.newStreetContribution;
      seat.totalContribution += currentValidated.addedAmount;
      seat.unsettledContribution += currentValidated.addedAmount;
    }
    seat.hasActedThisStreet = true;
    currentBet = currentValidated.newCurrentBet;

    let isAllIn = false;
    if (currentAction.type === 'fold') {
      seat.status = 'folded';
    } else if (chipValue(seat.stack) === 0) {
      seat.status = 'all-in';
      isAllIn = true;
    }

    newEvents.push({
      type: 'player-action',
      street,
      playerId: seat.playerId,
      action: currentAction,
      addedAmount: currentValidated.addedAmount,
      newStreetContribution: seat.streetContribution,
      newCurrentBet: currentBet,
      isAllIn,
      fromOutOfTurn,
    });

    // If bet/raise increased currentBet, cancel all pending out-of-turn declarations immediately.
    if (currentValidated.raisesBet) {
      for (const other of seats) {
        if (other.declaration !== null) {
          const decl = other.declaration;
          other.stack = addChips(other.stack, decl.reservedChips);
          other.declaration = null;
          other.cancelledDeclarationThisStreet = true;
          cancelledDeclarations.push(decl);
          newEvents.push({
            type: 'out-of-turn-cancelled',
            street,
            playerId: other.playerId,
            action: decl.action,
            reason: 'bet-changed',
            triggeredByPlayerId: seat.playerId,
            returnedChips: decl.reservedChips,
          });
        }
      }
    }

    // Check fold-win (R8 / R15): only one non-folded player remains.
    const nonFolded = seats.filter((s) => s.status !== 'folded');
    if (nonFolded.length === 1) {
      releaseAllDeclarations('hand-ended');
      const winner = nonFolded[0]!;
      const potAmount = chipValue(pot);
      newEvents.push({
        type: 'fold-win',
        winnerId: winner.playerId,
        amount: potAmount,
      });
      const transfer: PayoutTransfer = {
        playerId: winner.playerId,
        amount: potAmount,
        chips: { 5: pot[5], 10: pot[10], 50: pot[50], 100: pot[100] },
      };
      winner.stack = addChips(winner.stack, transfer.chips);
      pot = emptyChips();
      for (const s of seats) {
        s.unsettledContribution = 0;
      }
      newEvents.push({ type: 'payout-settled', transfers: [transfer] });

      const nextState: HandState = {
        ...state,
        phase: 'complete',
        seats: seats.map(freezeSeat),
        street,
        streetCap,
        currentBet,
        activePlayerIndex: null,
        activePlayerId: null,
        awaitingDecision: null,
        deckCursor,
        board,
        pot,
        timeline: [...state.timeline, ...newEvents],
        outcome: {
          kind: 'fold-win',
          winnerId: winner.playerId,
          potAmount,
          revealedCards: false,
        },
        pendingPayout: null,
        settledTransfers: [transfer],
      };

      return {
        ok: true,
        state: nextState,
        events: newEvents,
        autoExecutedDeclarations,
        cancelledDeclarations,
        decisionRequiredFor: null,
      };
    }

    // Check whether the current betting street closes.
    const activeSeats = seats.filter((s) => s.status === 'active');
    const streetClosed = activeSeats.every(
      (s) => s.hasActedThisStreet && s.streetContribution === currentBet,
    );

    if (!streetClosed) {
      const nextIdx = findNextActiveIndex(
        seats,
        currentActorIdx,
        (s) => !s.hasActedThisStreet || s.streetContribution < currentBet,
      )!;
      const nextSeat = seats[nextIdx]!;

      if (nextSeat.declaration !== null && nextSeat.declaration.declaredAtCurrentBet === currentBet) {
        const decl = nextSeat.declaration;
        const declCheck = validateActionAgainstState(
          streetCap,
          currentBet,
          nextSeat,
          decl.reservedChips,
          decl.action,
        );
        if (declCheck.ok) {
          autoExecutedDeclarations.push(decl);
          currentActorIdx = nextIdx;
          currentAction = decl.action;
          currentValidated = declCheck.validated;
          fromOutOfTurn = true;
          continue;
        }
        // Defensive fallback if reserved chips ever failed validation: cancel and return chips.
        nextSeat.stack = addChips(nextSeat.stack, decl.reservedChips);
        nextSeat.declaration = null;
        nextSeat.cancelledDeclarationThisStreet = true;
        cancelledDeclarations.push(decl);
        newEvents.push({
          type: 'out-of-turn-cancelled',
          street,
          playerId: nextSeat.playerId,
          action: decl.action,
          reason: 'bet-changed',
          returnedChips: decl.reservedChips,
        });
      }

      const nextState: HandState = {
        ...state,
        seats: seats.map(freezeSeat),
        street,
        streetCap,
        currentBet,
        activePlayerIndex: nextIdx,
        activePlayerId: nextSeat.playerId,
        awaitingDecision: {
          playerId: nextSeat.playerId,
          street,
          hadCancelledDeclaration: nextSeat.cancelledDeclarationThisStreet,
        },
        deckCursor,
        board,
        pot,
        timeline: [...state.timeline, ...newEvents],
      };

      return {
        ok: true,
        state: nextState,
        events: newEvents,
        autoExecutedDeclarations,
        cancelledDeclarations,
        decisionRequiredFor: nextSeat.playerId,
      };
    }

    // Street closed: release any remaining declarations and check for uncalled excess.
    releaseAllDeclarations('street-ended');

    const breakdown = calculatePots(
      seats.map((s) => ({
        playerId: s.playerId,
        amount: s.unsettledContribution,
        folded: s.status === 'folded',
      })),
    );
    if (breakdown.uncalledRefund !== null) {
      const refundPlan = planPotPayouts(pot, [breakdown.uncalledRefund]);
      if (refundPlan !== null && refundPlan.length === 1) {
        const transfer = refundPlan[0]!;
        const refundSeat = seats.find((s) => s.playerId === transfer.playerId)!;
        pot = subtractChips(pot, transfer.chips);
        refundSeat.stack = addChips(refundSeat.stack, transfer.chips);
        refundSeat.unsettledContribution -= transfer.amount;
        newEvents.push({
          type: 'uncalled-refund',
          street,
          playerId: transfer.playerId,
          amount: transfer.amount,
          chips: transfer.chips,
        });
      }
    }

    const upcomingStreet = nextStreetAfter(street);
    if (upcomingStreet === null || activeSeats.length <= 1) {
      const draft = {
        config: state.config,
        rngSeed: state.rngSeed,
        seats,
        deck: state.deck,
        deckCursor,
        board,
        pot,
        street,
        newEvents,
      };
      const result = runoutAndShowdown(draft);

      const nextState: HandState = {
        ...state,
        phase: result.phase,
        seats: seats.map(freezeSeat),
        street: draft.street,
        streetCap: STREET_CAP,
        currentBet: 0,
        activePlayerIndex: null,
        activePlayerId: null,
        awaitingDecision: null,
        deckCursor: draft.deckCursor,
        board: draft.board,
        pot: draft.pot,
        timeline: [...state.timeline, ...newEvents],
        outcome: result.outcome,
        pendingPayout: result.pendingPayout,
        settledTransfers: result.settledTransfers,
      };

      return {
        ok: true,
        state: nextState,
        events: newEvents,
        autoExecutedDeclarations,
        cancelledDeclarations,
        decisionRequiredFor: null,
      };
    }

    // Deal next street and open betting from hand opener clockwise.
    street = upcomingStreet;
    streetCap = STREET_CAP;
    currentBet = 0;
    const cardsToDeal = upcomingStreet === 'flop' ? 3 : 1;
    const dealt = state.deck.slice(deckCursor, deckCursor + cardsToDeal);
    deckCursor += cardsToDeal;
    board.push(...dealt);
    newEvents.push({ type: 'street-dealt', street: upcomingStreet, cards: dealt });

    for (const s of seats) {
      s.streetContribution = 0;
      s.hasActedThisStreet = false;
      s.declaration = null;
      s.cancelledDeclarationThisStreet = false;
    }

    const firstActorIdx = findFirstActiveFrom(seats, state.openerIndex)!;
    const firstActorId = seats[firstActorIdx]!.playerId;

    const nextState: HandState = {
      ...state,
      seats: seats.map(freezeSeat),
      street,
      streetCap,
      currentBet: 0,
      activePlayerIndex: firstActorIdx,
      activePlayerId: firstActorId,
      awaitingDecision: {
        playerId: firstActorId,
        street,
        hadCancelledDeclaration: false,
      },
      deckCursor,
      board,
      pot,
      timeline: [...state.timeline, ...newEvents],
    };

    return {
      ok: true,
      state: nextState,
      events: newEvents,
      autoExecutedDeclarations,
      cancelledDeclarations,
      decisionRequiredFor: firstActorId,
    };
  }
}

/**
 * Exchanges equal-value chips between a player and another player or the pot (D20/D21, C3).
 * Uses `exchangeChips` on available stacks (preserving reserved out-of-turn chips) and does not
 * alter turn order, current bet, or contributions.
 */
export function exchangeHandChips(state: HandState, request: HandExchangeRequest): HandStepResult {
  const fromIdx = state.seats.findIndex((s) => s.playerId === request.fromPlayerId);
  if (fromIdx === -1) {
    return {
      ok: false,
      code: 'player-not-found',
      message: `Player "${request.fromPlayerId}" is not seated in this hand`,
      state,
    };
  }

  if (!isValidChipCounts(request.give) || !isValidChipCounts(request.receive)) {
    return {
      ok: false,
      code: 'invalid-exchange',
      message: 'Exchange chip counts must be non-negative integers',
      state,
    };
  }

  const giveVal = chipValue(request.give);
  const receiveVal = chipValue(request.receive);
  if (giveVal === 0 || giveVal !== receiveVal) {
    return {
      ok: false,
      code: 'invalid-exchange',
      message: `Exchange values must be positive and equal (give=${giveVal}, receive=${receiveVal})`,
      state,
    };
  }

  const fromSeat = state.seats[fromIdx]!;
  if (!hasEnoughChips(fromSeat.stack, request.give)) {
    return {
      ok: false,
      code: 'insufficient-chips',
      message: `Player "${request.fromPlayerId}" lacks the requested denominations in available stack`,
      state,
    };
  }

  const nextSeats = cloneSeats(state.seats);
  let nextPot = state.pot;

  if (request.target.kind === 'pot') {
    if (!hasEnoughChips(state.pot, request.receive)) {
      return {
        ok: false,
        code: 'insufficient-chips',
        message: 'Pot lacks the requested chip denominations for exchange',
        state,
      };
    }
    const swapped = exchangeChips(fromSeat.stack, state.pot, request.give, request.receive);
    nextSeats[fromIdx]!.stack = swapped.a;
    nextPot = swapped.b;
  } else {
    const targetPlayerId = request.target.playerId;
    if (targetPlayerId === request.fromPlayerId) {
      return {
        ok: false,
        code: 'invalid-exchange',
        message: 'Cannot exchange chips with oneself',
        state,
      };
    }
    const targetIdx = state.seats.findIndex((s) => s.playerId === targetPlayerId);
    if (targetIdx === -1) {
      return {
        ok: false,
        code: 'player-not-found',
        message: `Target player "${targetPlayerId}" is not seated in this hand`,
        state,
      };
    }
    const targetSeat = state.seats[targetIdx]!;
    if (!hasEnoughChips(targetSeat.stack, request.receive)) {
      return {
        ok: false,
        code: 'insufficient-chips',
        message: `Target player "${targetPlayerId}" lacks the requested denominations in available stack`,
        state,
      };
    }
    const swapped = exchangeChips(fromSeat.stack, targetSeat.stack, request.give, request.receive);
    nextSeats[fromIdx]!.stack = swapped.a;
    nextSeats[targetIdx]!.stack = swapped.b;
  }

  const event: HandTimelineEvent = {
    type: 'chip-exchange',
    street: state.phase === 'betting' ? state.street : null,
    fromPlayerId: request.fromPlayerId,
    target: request.target,
    give: request.give,
    receive: request.receive,
  };

  const nextState: HandState = {
    ...state,
    seats: nextSeats.map(freezeSeat),
    pot: nextPot,
    timeline: [...state.timeline, event],
  };

  return {
    ok: true,
    state: nextState,
    events: [event],
    autoExecutedDeclarations: [],
    cancelledDeclarations: [],
    decisionRequiredFor: nextState.activePlayerId,
  };
}

/**
 * Completes a pending pot payout once pot denominations can form the exact required payouts
 * (e.g. after exchanging large pot chips per QUESTIONS.md #2).
 */
export function settlePendingPayout(state: HandState): HandStepResult {
  if (state.phase !== 'awaiting-payout' || state.pendingPayout === null) {
    return {
      ok: false,
      code: 'payout-not-pending',
      message: 'Hand does not have a pending payout to settle',
      state,
    };
  }

  const transfers = planPotPayouts(state.pot, state.pendingPayout.requiredPayouts);
  if (transfers === null) {
    return {
      ok: false,
      code: 'insufficient-pot-denominations',
      message: 'Pot still lacks the chip denominations needed for exact payout; exchange chips first',
      state,
    };
  }

  const nextSeats = cloneSeats(state.seats);
  let nextPot = state.pot;
  for (const transfer of transfers) {
    nextPot = subtractChips(nextPot, transfer.chips);
    const recipient = nextSeats.find((s) => s.playerId === transfer.playerId)!;
    recipient.stack = addChips(recipient.stack, transfer.chips);
  }
  for (const seat of nextSeats) {
    seat.unsettledContribution = 0;
  }

  const event: HandTimelineEvent = {
    type: 'payout-settled',
    transfers,
  };

  const nextState: HandState = {
    ...state,
    phase: 'complete',
    seats: nextSeats.map(freezeSeat),
    pot: nextPot,
    pendingPayout: null,
    settledTransfers: transfers,
    timeline: [...state.timeline, event],
  };

  return {
    ok: true,
    state: nextState,
    events: [event],
    autoExecutedDeclarations: [],
    cancelledDeclarations: [],
    decisionRequiredFor: null,
  };
}
