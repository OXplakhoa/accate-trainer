import { DENOMINATIONS, emptyChips, type ChipCounts } from '../../../engine';
import type { PublicTableSeat, TableSeatId } from '../../sandbox/types';
import type { LiveSceneDetails, SceneTableSnapshot } from '../contract';
import { countTotalChips } from './outs';

export const TABLE_ANIMATION_DURATIONS = {
  dealCardMs: 170,
  dealStaggerMs: 35,
  boardCardMs: 220,
  boardStaggerMs: 60,
  betChipsMs: 220,
  streetSweepMs: 240,
  foldSeatMs: 220,
  showdownRevealMs: 280,
  payoutMs: 340,
  payoutAfterRevealDelayMs: 90,
  boardAfterSweepDelayMs: 90,
  flopAfterDealDelayMs: 110,
} as const;

export type TableAnimation =
  | {
      readonly type: 'deal-hand';
      readonly seatIds: readonly TableSeatId[];
      readonly cardsPerSeat: number;
      readonly delayMs: number;
      readonly cardDurationMs: number;
      readonly staggerMs: number;
      readonly totalDurationMs: number;
    }
  | {
      readonly type: 'street-sweep';
      readonly fromSeats: readonly { readonly seatId: TableSeatId; readonly chips: ChipCounts }[];
      readonly delayMs: number;
      readonly durationMs: number;
    }
  | {
      readonly type: 'deal-board';
      readonly fromIndex: number;
      readonly toIndex: number;
      readonly cards: readonly string[];
      readonly delayMs: number;
      readonly cardDurationMs: number;
      readonly staggerMs: number;
      readonly totalDurationMs: number;
    }
  | {
      readonly type: 'bet-chips';
      readonly seatId: TableSeatId;
      readonly chips: ChipCounts;
      readonly delayMs: number;
      readonly durationMs: number;
    }
  | {
      readonly type: 'fold-seat';
      readonly seatId: TableSeatId;
      readonly delayMs: number;
      readonly durationMs: number;
    }
  | {
      readonly type: 'showdown-reveal';
      readonly seatId: TableSeatId;
      readonly cards: readonly string[];
      readonly delayMs: number;
      readonly durationMs: number;
    }
  | {
      readonly type: 'payout';
      readonly transfers: readonly { readonly seatId: TableSeatId; readonly chips: ChipCounts }[];
      readonly winnerIds: readonly TableSeatId[];
      readonly delayMs: number;
      readonly durationMs: number;
    };

export interface TableAnimationPlan {
  readonly eventKey: string | null;
  readonly mode: 'none' | 'snap' | 'animate';
  readonly animations: readonly TableAnimation[];
}

export function getLiveEventKey(live: LiveSceneDetails): string {
  return `${live.handNumber}:${live.street !== null ? 1 : 0}:${live.timelineLength}`;
}

export function getAnimationEndMs(anim: TableAnimation): number {
  switch (anim.type) {
    case 'deal-hand':
    case 'deal-board':
      return anim.delayMs + anim.totalDurationMs;
    case 'street-sweep':
    case 'bet-chips':
    case 'fold-seat':
    case 'showdown-reveal':
    case 'payout':
      return anim.delayMs + anim.durationMs;
  }
}

export function getPlanDurationMs(animations: readonly TableAnimation[]): number {
  let maxEnd = 0;
  for (const anim of animations) {
    const end = getAnimationEndMs(anim);
    if (end > maxEnd) {
      maxEnd = end;
    }
  }
  return maxEnd;
}

function getAddedChips(prev: ChipCounts | undefined, next: ChipCounts): ChipCounts {
  const result = { ...emptyChips() };
  for (const d of DENOMINATIONS) {
    const prevCount = prev ? prev[d] : 0;
    const diff = next[d] - prevCount;
    if (diff > 0) {
      result[d] = diff;
    }
  }
  return result;
}

function getDealtSeatIds(live: LiveSceneDetails): readonly TableSeatId[] {
  if (live.seats.length > 0) {
    return live.seats.filter((seat) => seat.status !== 'out').map((seat) => seat.id);
  }
  return ['hero', ...live.occupiedRivals];
}

function findSeat(
  seats: readonly PublicTableSeat[],
  id: TableSeatId,
): PublicTableSeat | undefined {
  return seats.find((seat) => seat.id === id);
}

/**
 * Pure event-diff animation planner for Live Sandbox 3D.
 *
 * Keys events strictly on `(handNumber, street !== null, timelineLength)`:
 * - Same key => zero animations (never re-fires on re-render).
 * - Shrinking `timelineLength` with same `handNumber` => treated as "hand ended" (snap, no animations).
 * - `reducedMotion` => snap only, zero animations.
 * - Drill mode (no `live`) => none, zero animations.
 * - Hidden information: `showdown-reveal` is emitted ONLY for non-hero, non-folded seats
 *   whose `revealedCards` transitioned from null to non-null.
 */
export function planTableAnimations(
  prev: SceneTableSnapshot | null,
  next: SceneTableSnapshot,
  reducedMotion: boolean,
): TableAnimationPlan {
  const nextLive = next.live;
  if (!nextLive) {
    return { eventKey: null, mode: 'none', animations: [] };
  }

  const nextKey = getLiveEventKey(nextLive);
  const nextInHand = nextLive.street !== null;

  if (reducedMotion) {
    return { eventKey: nextKey, mode: 'snap', animations: [] };
  }

  if (!prev || !prev.live) {
    return { eventKey: nextKey, mode: 'snap', animations: [] };
  }

  const prevLive = prev.live;
  const prevKey = getLiveEventKey(prevLive);
  const prevInHand = prevLive.street !== null;

  // Same event key: never re-fire animations on re-renders
  if (prevKey === nextKey) {
    return { eventKey: nextKey, mode: 'none', animations: [] };
  }

  // Between-hands boundary: timelineLength resets to 0 while handNumber stays on the finished hand.
  // Treat shrinking timelineLength on the same hand as "hand ended", not a new event.
  if (prevLive.handNumber === nextLive.handNumber && nextLive.timelineLength < prevLive.timelineLength) {
    return { eventKey: nextKey, mode: 'snap', animations: [] };
  }

  // Hand ended into between-hands idle state
  if (!nextInHand) {
    return { eventKey: nextKey, mode: 'snap', animations: [] };
  }

  const animations: TableAnimation[] = [];
  const isNewHand = nextLive.handNumber !== prevLive.handNumber || !prevInHand;

  if (isNewHand) {
    const seatIds = getDealtSeatIds(nextLive);
    if (seatIds.length > 0) {
      const totalCards = seatIds.length * 2;
      const totalDurationMs =
        TABLE_ANIMATION_DURATIONS.dealCardMs +
        Math.max(0, totalCards - 1) * TABLE_ANIMATION_DURATIONS.dealStaggerMs;
      animations.push({
        type: 'deal-hand',
        seatIds,
        cardsPerSeat: 2,
        delayMs: 0,
        cardDurationMs: TABLE_ANIMATION_DURATIONS.dealCardMs,
        staggerMs: TABLE_ANIMATION_DURATIONS.dealStaggerMs,
        totalDurationMs,
      });
    }

    // Accate's default "Flop trước" variant deals the 3 flop cards immediately on hand start
    const boardCount = Math.min(5, next.board.length);
    if (boardCount > 0) {
      const cards = next.board.slice(0, boardCount);
      const totalDurationMs =
        TABLE_ANIMATION_DURATIONS.boardCardMs +
        Math.max(0, cards.length - 1) * TABLE_ANIMATION_DURATIONS.boardStaggerMs;
      animations.push({
        type: 'deal-board',
        fromIndex: 0,
        toIndex: boardCount,
        cards,
        delayMs: seatIds.length > 0 ? TABLE_ANIMATION_DURATIONS.flopAfterDealDelayMs : 0,
        cardDurationMs: TABLE_ANIMATION_DURATIONS.boardCardMs,
        staggerMs: TABLE_ANIMATION_DURATIONS.boardStaggerMs,
        totalDurationMs,
      });
    }

    return {
      eventKey: nextKey,
      mode: animations.length > 0 ? 'animate' : 'none',
      animations,
    };
  }

  // --- Same active hand ---
  const streetAdvanced = prevLive.street !== nextLive.street;

  // 1. End-of-street bet pile sweep into pot
  const sweepSources: { readonly seatId: TableSeatId; readonly chips: ChipCounts }[] = [];
  for (const prevSeat of prevLive.seats) {
    if (countTotalChips(prevSeat.streetChips) <= 0) {
      continue;
    }
    const nextSeat = findSeat(nextLive.seats, prevSeat.id);
    const clearedOnSameStreet =
      !streetAdvanced &&
      nextSeat !== undefined &&
      countTotalChips(nextSeat.streetChips) === 0 &&
      next.pot >= prev.pot;
    if (streetAdvanced || clearedOnSameStreet) {
      sweepSources.push({ seatId: prevSeat.id, chips: prevSeat.streetChips });
    }
  }
  if (sweepSources.length > 0) {
    animations.push({
      type: 'street-sweep',
      fromSeats: sweepSources,
      delayMs: 0,
      durationMs: TABLE_ANIMATION_DURATIONS.streetSweepMs,
    });
  }

  // 2. Newly dealt community cards (Flop / Turn / River)
  const prevBoardLen = Math.min(5, prev.board.length);
  const nextBoardLen = Math.min(5, next.board.length);
  if (nextBoardLen > prevBoardLen) {
    const cards = next.board.slice(prevBoardLen, nextBoardLen);
    const totalDurationMs =
      TABLE_ANIMATION_DURATIONS.boardCardMs +
      Math.max(0, cards.length - 1) * TABLE_ANIMATION_DURATIONS.boardStaggerMs;
    animations.push({
      type: 'deal-board',
      fromIndex: prevBoardLen,
      toIndex: nextBoardLen,
      cards,
      delayMs: sweepSources.length > 0 ? TABLE_ANIMATION_DURATIONS.boardAfterSweepDelayMs : 0,
      cardDurationMs: TABLE_ANIMATION_DURATIONS.boardCardMs,
      staggerMs: TABLE_ANIMATION_DURATIONS.boardStaggerMs,
      totalDurationMs,
    });
  }

  // 3. Per-seat bet/call/raise chips, folds, and showdown reveals
  let hasReveal = false;
  for (const nextSeat of nextLive.seats) {
    const prevSeat = findSeat(prevLive.seats, nextSeat.id);

    // Bet / call / raise added chips flying from stack -> bet pile (only within same street)
    if (!streetAdvanced) {
      const added = getAddedChips(prevSeat?.streetChips, nextSeat.streetChips);
      if (countTotalChips(added) > 0) {
        animations.push({
          type: 'bet-chips',
          seatId: nextSeat.id,
          chips: added,
          delayMs: 0,
          durationMs: TABLE_ANIMATION_DURATIONS.betChipsMs,
        });
      }
    }

    // Folded seat slides & fades cards toward muck
    if (nextSeat.status === 'folded' && prevSeat?.status !== 'folded') {
      animations.push({
        type: 'fold-seat',
        seatId: nextSeat.id,
        delayMs: 0,
        durationMs: TABLE_ANIMATION_DURATIONS.foldSeatMs,
      });
    }

    // Showdown reveal: STRICTLY non-hero, non-folded seats whose revealedCards became non-null
    const hadRevealed = prevSeat?.revealedCards !== null && prevSeat?.revealedCards !== undefined;
    const nowRevealed =
      nextSeat.id !== 'hero' &&
      nextSeat.status !== 'folded' &&
      nextSeat.revealedCards !== null &&
      nextSeat.revealedCards.length > 0;
    if (nowRevealed && !hadRevealed && nextSeat.revealedCards) {
      hasReveal = true;
      animations.push({
        type: 'showdown-reveal',
        seatId: nextSeat.id,
        cards: nextSeat.revealedCards,
        delayMs: 0,
        durationMs: TABLE_ANIMATION_DURATIONS.showdownRevealMs,
      });
    }
  }

  // 4. Payout transfers sliding exact chips from pot -> winner(s) + winner highlight
  const hadTransfers = prevLive.payoutTransfers.length > 0;
  const hasTransfers = nextLive.payoutTransfers.length > 0;
  if (!hadTransfers && hasTransfers) {
    const transfers = nextLive.payoutTransfers.filter((t) => countTotalChips(t.chips) > 0);
    const winnerSet = new Set<TableSeatId>();
    for (const seat of nextLive.seats) {
      if (seat.isWinner) {
        winnerSet.add(seat.id);
      }
    }
    if (winnerSet.size === 0) {
      for (const t of transfers) {
        winnerSet.add(t.seatId);
      }
    }
    if (transfers.length > 0 || winnerSet.size > 0) {
      animations.push({
        type: 'payout',
        transfers,
        winnerIds: [...winnerSet],
        delayMs: hasReveal ? TABLE_ANIMATION_DURATIONS.payoutAfterRevealDelayMs : 0,
        durationMs: TABLE_ANIMATION_DURATIONS.payoutMs,
      });
    }
  }

  return {
    eventKey: nextKey,
    mode: animations.length > 0 ? 'animate' : 'none',
    animations,
  };
}
