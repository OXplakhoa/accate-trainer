import { MAX_PLAYERS, MIN_PLAYERS, planBuyIn, type BuyInPlan, type SeatedStack } from './bank';
import { addChips, checkInv1, chipValue, subtractChips, type ChipCounts } from './chips';
import type { HandState } from './handTypes';
import type { LedgerEvent } from './ledger';

export interface TableSeat {
  readonly seatIndex: number;
  readonly playerId: string;
  readonly stack: ChipCounts;
}

export interface TableBoundaryState {
  readonly seats: readonly TableSeat[];
  readonly bank: ChipCounts;
  readonly lastDealerSeatIndex: number;
  readonly lastOpenerSeatIndex: number | null;
}

export type BoundaryErrorCode =
  | 'hand-not-complete'
  | 'player-not-found'
  | 'seat-occupied'
  | 'table-full'
  | 'invalid-seat-index'
  | 'duplicate-player'
  | 'stack-not-empty'
  | 'plan-failed'
  | 'invalid-invariants';

export interface BoundaryReadiness {
  readonly ready: boolean;
  readonly playerCount: number;
  readonly needsPlayers: number;
  readonly zeroStackPlayerIds: readonly string[];
  readonly missingAnteDenominationPlayerIds: readonly string[];
}

export type CreateBoundaryResult =
  | { readonly ok: true; readonly state: TableBoundaryState }
  | { readonly ok: false; readonly code: BoundaryErrorCode; readonly message: string };

export type BoundaryBuyInResult =
  | {
      readonly ok: true;
      readonly state: TableBoundaryState;
      readonly plan: BuyInPlan;
      readonly ledgerEvents: readonly LedgerEvent[];
    }
  | {
      readonly ok: false;
      readonly code: BoundaryErrorCode;
      readonly message: string;
      readonly state: TableBoundaryState;
    };

export type BoundaryLeaveResult =
  | {
      readonly ok: true;
      readonly state: TableBoundaryState;
      readonly returnedChips: ChipCounts;
      readonly ledgerEvents: readonly LedgerEvent[];
    }
  | {
      readonly ok: false;
      readonly code: BoundaryErrorCode;
      readonly message: string;
      readonly state: TableBoundaryState;
    };

/**
 * Transitions a finished hand into a between-hands table boundary state.
 * Rejects if pot settlement is not yet complete (including `betting` and `awaiting-payout`).
 */
export function createBoundaryFromHand(handState: HandState): CreateBoundaryResult {
  if (handState.phase !== 'complete' || chipValue(handState.pot) !== 0) {
    return {
      ok: false,
      code: 'hand-not-complete',
      message: 'Pot payout must complete before between-hands rebuy or leaving the table',
    };
  }

  const seats: TableSeat[] = [...handState.seats]
    .sort((a, b) => a.seatIndex - b.seatIndex)
    .map((seat) => ({
      seatIndex: seat.seatIndex,
      playerId: seat.playerId,
      stack: seat.stack,
    }));

  const inv1 = checkInv1([handState.bank, ...seats.map((s) => s.stack)]);
  if (!inv1.ok) {
    return {
      ok: false,
      code: 'invalid-invariants',
      message: `Boundary state fails INV-1: ${JSON.stringify(inv1.diff)}`,
    };
  }

  return {
    ok: true,
    state: {
      seats,
      bank: handState.bank,
      lastDealerSeatIndex: handState.dealerSeatIndex,
      lastOpenerSeatIndex: handState.openerSeatIndex,
    },
  };
}

/**
 * Maps a physical opener seat anchor clockwise to the first currently occupied seat index
 * in `seats` (which is sorted clockwise by `seatIndex`). Preserves C6/O9 tie-breaking even
 * after the previous hand's opener has left the table.
 */
export function mapOpenerToSeatedIndex(seats: readonly TableSeat[], anchorSeatIndex: number): number {
  if (seats.length === 0) {
    return 0;
  }
  const nextIndex = seats.findIndex((seat) => seat.seatIndex >= anchorSeatIndex);
  return nextIndex === -1 ? 0 : nextIndex;
}

/**
 * Computes the next hand's dealer array index clockwise after `lastDealerSeatIndex` (O3).
 */
export function nextDealerArrayIndex(boundary: TableBoundaryState): number {
  if (boundary.seats.length === 0) {
    return 0;
  }
  const nextIdx = boundary.seats.findIndex((seat) => seat.seatIndex > boundary.lastDealerSeatIndex);
  return nextIdx === -1 ? 0 : nextIdx;
}

/**
 * Evaluates whether the table is ready to collect ante and start the next hand (T3, T4, QUESTIONS.md #2).
 */
export function checkReadyForNextHand(boundary: TableBoundaryState): BoundaryReadiness {
  const zeroStackPlayerIds: string[] = [];
  const missingAnteDenominationPlayerIds: string[] = [];

  for (const seat of boundary.seats) {
    const value = chipValue(seat.stack);
    if (value === 0) {
      zeroStackPlayerIds.push(seat.playerId);
    } else if (seat.stack[5] < 1) {
      missingAnteDenominationPlayerIds.push(seat.playerId);
    }
  }

  const playerCount = boundary.seats.length;
  const needsPlayers = playerCount < MIN_PLAYERS ? MIN_PLAYERS - playerCount : 0;
  const ready =
    playerCount >= MIN_PLAYERS &&
    playerCount <= MAX_PLAYERS &&
    zeroStackPlayerIds.length === 0 &&
    missingAnteDenominationPlayerIds.length === 0;

  return {
    ready,
    playerCount,
    needsPlayers,
    zeroStackPlayerIds,
    missingAnteDenominationPlayerIds,
  };
}

function applyBuyInPlan(
  boundary: TableBoundaryState,
  plan: BuyInPlan,
  buyerId: string,
  eventType: 'buy-in' | 'rebuy',
  newSeatIndex?: number,
): { readonly state: TableBoundaryState; readonly ledgerEvents: readonly LedgerEvent[] } {
  let nextBank = boundary.bank;
  const ledgerEvents: LedgerEvent[] = [];
  let nextSeats = [...boundary.seats];

  if (plan.kind === 'cash-out-then-bank') {
    nextSeats = nextSeats.map((seat) =>
      seat.playerId === plan.cashOutPlayerId
        ? { ...seat, stack: subtractChips(seat.stack, plan.cashOutChips) }
        : seat,
    );
    nextBank = addChips(nextBank, plan.cashOutChips);
    ledgerEvents.push({
      type: 'cash-out',
      playerId: plan.cashOutPlayerId,
      chips: plan.cashOutChips,
    });
  }

  nextBank = subtractChips(nextBank, plan.chips);
  if (newSeatIndex !== undefined) {
    nextSeats.push({ seatIndex: newSeatIndex, playerId: buyerId, stack: plan.chips });
    nextSeats.sort((a, b) => a.seatIndex - b.seatIndex);
  } else {
    nextSeats = nextSeats.map((seat) =>
      seat.playerId === buyerId ? { ...seat, stack: addChips(seat.stack, plan.chips) } : seat,
    );
  }

  ledgerEvents.push({
    type: eventType,
    playerId: buyerId,
    chips: plan.chips,
  });

  return {
    state: {
      ...boundary,
      seats: nextSeats,
      bank: nextBank,
    },
    ledgerEvents,
  };
}

/**
 * Rebuys 500 chips for a busted (0-chip) seated player at the hand boundary using `planBuyIn`
 * (AC T3, C4, C5, C6, O9).
 */
export function rebuyAtBoundary(
  boundary: TableBoundaryState,
  playerId: string,
): BoundaryBuyInResult {
  const seat = boundary.seats.find((s) => s.playerId === playerId);
  if (seat === undefined) {
    return {
      ok: false,
      code: 'player-not-found',
      message: `Player "${playerId}" is not seated at the table`,
      state: boundary,
    };
  }
  if (chipValue(seat.stack) !== 0) {
    return {
      ok: false,
      code: 'stack-not-empty',
      message: `Player "${playerId}" still has ${chipValue(seat.stack)} chips and cannot rebuy`,
      state: boundary,
    };
  }

  const seatedStacks: SeatedStack[] = boundary.seats.map((s) => ({
    playerId: s.playerId,
    stack: s.stack,
  }));
  const openerIndex =
    boundary.lastOpenerSeatIndex === null
      ? 0
      : mapOpenerToSeatedIndex(boundary.seats, boundary.lastOpenerSeatIndex);

  let plan: BuyInPlan;
  try {
    plan = planBuyIn(boundary.bank, seatedStacks, playerId, openerIndex);
  } catch (err) {
    return {
      ok: false,
      code: 'plan-failed',
      message: err instanceof Error ? err.message : 'Unable to plan rebuy',
      state: boundary,
    };
  }

  const applied = applyBuyInPlan(boundary, plan, playerId, 'rebuy');
  return {
    ok: true,
    state: applied.state,
    plan,
    ledgerEvents: applied.ledgerEvents,
  };
}

/**
 * Removes a seated player between hands, cashing out their stack back to the bank (AC T1, T3).
 * Preserves `lastOpenerSeatIndex` as the physical seat anchor for subsequent `planBuyIn` calls.
 */
export function leaveTableAtBoundary(
  boundary: TableBoundaryState,
  playerId: string,
): BoundaryLeaveResult {
  const seat = boundary.seats.find((s) => s.playerId === playerId);
  if (seat === undefined) {
    return {
      ok: false,
      code: 'player-not-found',
      message: `Player "${playerId}" is not seated at the table`,
      state: boundary,
    };
  }

  const nextBank = addChips(boundary.bank, seat.stack);
  const nextSeats = boundary.seats.filter((s) => s.playerId !== playerId);
  const ledgerEvents: LedgerEvent[] =
    chipValue(seat.stack) > 0
      ? [{ type: 'cash-out', playerId, chips: seat.stack }]
      : [];

  return {
    ok: true,
    state: {
      ...boundary,
      seats: nextSeats,
      bank: nextBank,
    },
    returnedChips: seat.stack,
    ledgerEvents,
  };
}

/**
 * Seats a new player at an unoccupied physical seat index between hands using `planBuyIn` (AC T4).
 */
export function seatPlayerAtBoundary(
  boundary: TableBoundaryState,
  seatIndex: number,
  playerId: string,
): BoundaryBuyInResult {
  if (!Number.isInteger(seatIndex) || seatIndex < 0) {
    return {
      ok: false,
      code: 'invalid-seat-index',
      message: `Invalid physical seatIndex: ${String(seatIndex)}`,
      state: boundary,
    };
  }
  if (boundary.seats.length >= MAX_PLAYERS) {
    return {
      ok: false,
      code: 'table-full',
      message: `Table already has ${MAX_PLAYERS} seated players`,
      state: boundary,
    };
  }
  if (boundary.seats.some((s) => s.playerId === playerId)) {
    return {
      ok: false,
      code: 'duplicate-player',
      message: `Player "${playerId}" is already seated`,
      state: boundary,
    };
  }
  if (boundary.seats.some((s) => s.seatIndex === seatIndex)) {
    return {
      ok: false,
      code: 'seat-occupied',
      message: `Physical seat ${seatIndex} is already occupied`,
      state: boundary,
    };
  }

  const seatedStacks: SeatedStack[] = boundary.seats.map((s) => ({
    playerId: s.playerId,
    stack: s.stack,
  }));
  const openerIndex =
    boundary.seats.length === 0 || boundary.lastOpenerSeatIndex === null
      ? 0
      : mapOpenerToSeatedIndex(boundary.seats, boundary.lastOpenerSeatIndex);

  let plan: BuyInPlan;
  try {
    plan = planBuyIn(boundary.bank, seatedStacks, playerId, openerIndex);
  } catch (err) {
    return {
      ok: false,
      code: 'plan-failed',
      message: err instanceof Error ? err.message : 'Unable to plan buy-in',
      state: boundary,
    };
  }

  const applied = applyBuyInPlan(boundary, plan, playerId, 'buy-in', seatIndex);
  return {
    ok: true,
    state: applied.state,
    plan,
    ledgerEvents: applied.ledgerEvents,
  };
}
