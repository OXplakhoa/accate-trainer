import { expect } from 'vitest';
import { takeExactLargeFirst } from '../../src/engine/bank';
import { createDeck, formatCard, parseCards, type Card } from '../../src/engine/cards';
import { checkInv1, chipValue, type ChipCounts } from '../../src/engine/chips';
import {
  applyAction,
  checkHandInvariants,
  declareOutOfTurn,
  exchangeHandChips,
  startHand,
} from '../../src/engine/hand';
import type {
  BettingAction,
  HandErrorCode,
  HandExchangeRequest,
  HandState,
  StartHandInput,
} from '../../src/engine/handTypes';

export interface FixtureDeckSpec {
  readonly playerIds: readonly string[];
  readonly dealerIndex: number;
  readonly holeCardsByPlayer: Readonly<Record<string, string>>;
  readonly board: string;
  readonly undealtPrefix?: string;
}

/**
 * Builds a valid 52-card fixture deck arranged in the engine's exact dealing order:
 * 2 rounds of 1 card clockwise from left of dealer, then flop (3), turn (1), river (1),
 * then `undealtPrefix`, then all remaining standard deck cards.
 */
export function buildFixtureDeck(spec: FixtureDeckSpec): Card[] {
  const n = spec.playerIds.length;
  const used = new Set<string>();
  const deck: Card[] = [];

  const pushCard = (card: Card): void => {
    const key = formatCard(card);
    if (used.has(key)) {
      throw new Error(`Duplicate card in fixture deck: ${key}`);
    }
    used.add(key);
    deck.push(card);
  };

  const holeByIndex = spec.playerIds.map((playerId) => {
    const raw = spec.holeCardsByPlayer[playerId];
    if (raw === undefined) {
      return null;
    }
    const parsed = parseCards(raw);
    if (parsed.length !== 2) {
      throw new Error(`Expected 2 hole cards for "${playerId}", got ${parsed.length}`);
    }
    return parsed as [Card, Card];
  });

  // Reserve explicitly specified cards first so unspecified slots don't collide.
  const reserved = new Set<string>();
  for (const pair of holeByIndex) {
    if (pair !== null) {
      reserved.add(formatCard(pair[0]));
      reserved.add(formatCard(pair[1]));
    }
  }
  const boardCards = parseCards(spec.board);
  if (boardCards.length !== 5) {
    throw new Error(`Expected 5 board cards, got ${boardCards.length}`);
  }
  for (const card of boardCards) {
    reserved.add(formatCard(card));
  }
  const undealtPrefixCards = spec.undealtPrefix ? parseCards(spec.undealtPrefix) : [];
  for (const card of undealtPrefixCards) {
    reserved.add(formatCard(card));
  }

  const filler = createDeck().filter((c) => !reserved.has(formatCard(c)));
  let fillerIdx = 0;
  const nextFiller = (): Card => {
    const card = filler[fillerIdx++];
    if (card === undefined) {
      throw new Error('Ran out of filler cards while building fixture deck');
    }
    return card;
  };

  for (let round = 0; round < 2; round++) {
    for (let offset = 1; offset <= n; offset++) {
      const seatIdx = (spec.dealerIndex + offset) % n;
      const explicit = holeByIndex[seatIdx] ?? null;
      pushCard(explicit !== null ? explicit[round]! : nextFiller());
    }
  }

  for (const card of boardCards) {
    pushCard(card);
  }
  for (const card of undealtPrefixCards) {
    pushCard(card);
  }
  while (deck.length < 52) {
    pushCard(nextFiller());
  }

  return deck;
}

export function assertHandInvariants(state: HandState): void {
  const report = checkHandInvariants(state);
  expect(report.inv1).toEqual({ ok: true });
  expect(report.inv2.ok).toBe(true);
  expect(report.ok).toBe(true);
}

export function assertBoundaryInv1(bank: ChipCounts, stacks: readonly ChipCounts[]): void {
  expect(checkInv1([bank, ...stacks])).toEqual({ ok: true });
}

export function pickChips(stack: ChipCounts, amount: number): ChipCounts {
  const taken = takeExactLargeFirst(stack, amount);
  if (taken === null) {
    throw new Error(`Cannot form exact ${amount} from stack ${JSON.stringify(stack)}`);
  }
  return taken;
}

export function seatOf(state: HandState, playerId: string) {
  const seat = state.seats.find((s) => s.playerId === playerId);
  if (seat === undefined) {
    throw new Error(`Seat "${playerId}" not found`);
  }
  return seat;
}

export function stackValueOf(state: HandState, playerId: string): number {
  return chipValue(seatOf(state, playerId).stack);
}

export function mustStartHand(input: StartHandInput) {
  const res = startHand(input);
  if (!res.ok) {
    throw new Error(`startHand failed (${res.code}): ${res.message}`);
  }
  assertHandInvariants(res.state);
  return res;
}

export function mustApply(state: HandState, playerId: string, action: BettingAction) {
  const res = applyAction(state, playerId, action);
  if (!res.ok) {
    throw new Error(`applyAction(${playerId}, ${action.type}) failed (${res.code}): ${res.message}`);
  }
  assertHandInvariants(res.state);
  return res;
}

export function mustRejectAction(
  state: HandState,
  playerId: string,
  action: BettingAction,
  expectedCode: HandErrorCode,
): void {
  const res = applyAction(state, playerId, action);
  expect(res.ok).toBe(false);
  if (res.ok) {
    throw new Error('Expected action rejection');
  }
  expect(res.code).toBe(expectedCode);
  expect(res.state).toBe(state);
  assertHandInvariants(res.state);
}

export function mustDeclare(state: HandState, playerId: string, action: BettingAction) {
  const res = declareOutOfTurn(state, playerId, action);
  if (!res.ok) {
    throw new Error(`declareOutOfTurn(${playerId}) failed (${res.code}): ${res.message}`);
  }
  assertHandInvariants(res.state);
  return res;
}

export function mustExchange(state: HandState, request: HandExchangeRequest) {
  const res = exchangeHandChips(state, request);
  if (!res.ok) {
    throw new Error(`exchangeHandChips failed (${res.code}): ${res.message}`);
  }
  assertHandInvariants(res.state);
  return res;
}

export function betAction(state: HandState, playerId: string, amount: number): BettingAction {
  return { type: 'bet', amount, chips: pickChips(seatOf(state, playerId).stack, amount) };
}

export function callAction(state: HandState, playerId: string): BettingAction {
  const seat = seatOf(state, playerId);
  const toCall = state.currentBet - seat.streetContribution;
  const amount = Math.min(toCall, chipValue(seat.stack));
  return { type: 'call', chips: pickChips(seat.stack, amount) };
}

export function raiseAction(state: HandState, playerId: string, raiseTo: number): BettingAction {
  const seat = seatOf(state, playerId);
  const added = raiseTo - seat.streetContribution;
  return { type: 'raise', raiseTo, chips: pickChips(seat.stack, added) };
}
