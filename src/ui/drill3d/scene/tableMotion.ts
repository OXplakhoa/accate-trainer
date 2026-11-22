import { DENOMINATIONS, emptyChips, type ChipCounts, type Street } from '../../../engine';
import type { PublicTableSeat, TableSeatId } from '../../sandbox/types';
import type { LiveSceneDetails, SceneTableSnapshot } from '../contract';
import { countTotalChips } from './outs';

export const MAX_PLAN_DURATION_MS = 450;

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

export const ALL_SEAT_IDS: readonly TableSeatId[] = ['hero', 'ca', 'cao', 'nong'];

const STREET_ORDER: Readonly<Record<Street, number>> = {
  preflop: 0,
  flop: 1,
  turn: 2,
  river: 3,
};

export interface LiveProgressMark {
  readonly handNumber: number;
  readonly inHand: boolean;
  readonly timelineLength: number;
}

export type LiveProgressRelation = 'forward' | 'equal' | 'stale';

export interface TableChipAllocation {
  readonly reconcilable: boolean;
  readonly centerPot: ChipCounts;
  readonly seatStacks: Readonly<Record<TableSeatId, ChipCounts>>;
  readonly seatBets: Readonly<Record<TableSeatId, ChipCounts>>;
  readonly inFlight: ChipCounts;
}

export type TableAnimation =
  | {
      readonly type: 'deal-hand';
      readonly seatIds: readonly TableSeatId[];
      readonly dealerSeatId?: TableSeatId | null;
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
      readonly dealerSeatId?: TableSeatId | null;
      readonly delayMs: number;
      readonly cardDurationMs: number;
      readonly staggerMs: number;
      readonly totalDurationMs: number;
    }
  | {
      readonly type: 'bet-chips';
      readonly seatId: TableSeatId;
      readonly chips: ChipCounts;
      readonly toPot?: boolean;
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
  readonly highWater?: LiveProgressMark | null;
}

type MutableChipCounts = { 5: number; 10: number; 50: number; 100: number };

function copyMutableChips(src: ChipCounts | undefined): MutableChipCounts {
  return {
    5: src ? src[5] : 0,
    10: src ? src[10] : 0,
    50: src ? src[50] : 0,
    100: src ? src[100] : 0,
  };
}

function addInPlace(target: MutableChipCounts, delta: ChipCounts): void {
  target[5] += delta[5];
  target[10] += delta[10];
  target[50] += delta[50];
  target[100] += delta[100];
}

function subInPlace(target: MutableChipCounts, delta: ChipCounts): void {
  target[5] -= delta[5];
  target[10] -= delta[10];
  target[50] -= delta[50];
  target[100] -= delta[100];
}

function hasNegativeDenom(chips: ChipCounts): boolean {
  return chips[5] < 0 || chips[10] < 0 || chips[50] < 0 || chips[100] < 0;
}

function chipsEqual(a: ChipCounts, b: ChipCounts): boolean {
  return a[5] === b[5] && a[10] === b[10] && a[50] === b[50] && a[100] === b[100];
}

export function getLiveEventKey(live: LiveSceneDetails): string {
  return `${live.handNumber}:${live.street !== null ? 1 : 0}:${live.timelineLength}`;
}

export function getLiveProgressMark(live: LiveSceneDetails): LiveProgressMark {
  return {
    handNumber: live.handNumber,
    inHand: live.street !== null,
    timelineLength: live.timelineLength,
  };
}

/**
 * Classifies an incoming live snapshot against the monotonic high-water mark:
 * - Forward: larger handNumber; same hand + longer timeline while in-hand;
 *   or same hand transitioning in-hand -> idle (the between-hands boundary).
 * - Equal: exact same progress mark (never replays).
 * - Stale: lower handNumber, same hand with shorter in-hand timeline,
 *   or returning in-hand after the same hand already reached idle.
 */
export function classifyLiveProgress(
  highWater: LiveProgressMark | null,
  nextLive: LiveSceneDetails,
): LiveProgressRelation {
  if (highWater === null) {
    return 'forward';
  }
  const next = getLiveProgressMark(nextLive);
  if (next.handNumber > highWater.handNumber) {
    return 'forward';
  }
  if (next.handNumber < highWater.handNumber) {
    return 'stale';
  }
  // Same handNumber
  if (highWater.inHand && !next.inHand) {
    return 'forward';
  }
  if (!highWater.inHand && !next.inHand) {
    return next.timelineLength === highWater.timelineLength ? 'equal' : 'stale';
  }
  if (!highWater.inHand && next.inHand) {
    return 'stale';
  }
  // Both in-hand on same handNumber
  if (next.timelineLength > highWater.timelineLength) {
    return 'forward';
  }
  if (next.timelineLength === highWater.timelineLength) {
    return 'equal';
  }
  return 'stale';
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

/**
 * Computes stationary resting chip piles for a live snapshot with strict chip conservation:
 * - Center pot draws `potChips - Σ streetChips (all seats)` per denomination.
 * - If any denomination would go negative (e.g., after a pot chip exchange), draws NO seat
 *   bet piles and puts the entire `potChips` in the center pot (`reconcilable: false`).
 * In all cases: `centerPot + Σ seatBets + Σ seatStacks === potChips + Σ seat.stackChips`.
 */
export function computeRestingChipAllocation(live: LiveSceneDetails): TableChipAllocation {
  const seatStacks: Record<TableSeatId, MutableChipCounts> = {
    hero: copyMutableChips(undefined),
    ca: copyMutableChips(undefined),
    cao: copyMutableChips(undefined),
    nong: copyMutableChips(undefined),
  };
  const seatBets: Record<TableSeatId, MutableChipCounts> = {
    hero: copyMutableChips(undefined),
    ca: copyMutableChips(undefined),
    cao: copyMutableChips(undefined),
    nong: copyMutableChips(undefined),
  };

  for (const seat of live.seats) {
    seatStacks[seat.id] = copyMutableChips(seat.stackChips);
  }

  const inHand = live.street !== null;
  const handSettled = live.payoutTransfers.length > 0;

  if (!inHand || handSettled) {
    return {
      reconcilable: true,
      centerPot: copyMutableChips(live.potChips),
      seatStacks,
      seatBets,
      inFlight: emptyChips(),
    };
  }

  const totalStreet = copyMutableChips(undefined);
  for (const seat of live.seats) {
    addInPlace(totalStreet, seat.streetChips);
  }

  const centerPot = copyMutableChips(live.potChips);
  subInPlace(centerPot, totalStreet);

  if (hasNegativeDenom(centerPot)) {
    return {
      reconcilable: false,
      centerPot: copyMutableChips(live.potChips),
      seatStacks,
      seatBets,
      inFlight: emptyChips(),
    };
  }

  for (const seat of live.seats) {
    seatBets[seat.id] = copyMutableChips(seat.streetChips);
  }

  return {
    reconcilable: true,
    centerPot,
    seatStacks,
    seatBets,
    inFlight: emptyChips(),
  };
}

/**
 * Computes stationary and in-flight chip counts at any elapsed time `elapsedMs`
 * of a live animation run, enforcing strict per-denomination conservation:
 * `centerPot + Σ seatBets + Σ seatStacks + inFlight === live.potChips + Σ seat.stackChips`.
 *
 * - During a `bet-chips` flight to a seat bet pile, only the increment is withheld from
 *   `seatBets[seatId]` so the seat's prior bet pile stays visible.
 * - During a `bet-chips` flight straight to pot or a `street-sweep`, in-flight chips are
 *   withheld from `centerPot` until arrival.
 * - During a `payout` flight (and any pre-launch reveal delay), payout chips are withheld
 *   from the winner's `seatStacks[seatId]` until arrival.
 *
 * Returns `reconcilable: false` (with resting piles) if any pile would go negative.
 */
export function computeTableChipAllocation(
  live: LiveSceneDetails,
  animations: readonly TableAnimation[],
  elapsedMs: number,
): TableChipAllocation {
  const resting = computeRestingChipAllocation(live);
  if (!resting.reconcilable || animations.length === 0) {
    return resting;
  }

  const centerPot = copyMutableChips(resting.centerPot);
  const seatStacks: Record<TableSeatId, MutableChipCounts> = {
    hero: copyMutableChips(resting.seatStacks.hero),
    ca: copyMutableChips(resting.seatStacks.ca),
    cao: copyMutableChips(resting.seatStacks.cao),
    nong: copyMutableChips(resting.seatStacks.nong),
  };
  const seatBets: Record<TableSeatId, MutableChipCounts> = {
    hero: copyMutableChips(resting.seatBets.hero),
    ca: copyMutableChips(resting.seatBets.ca),
    cao: copyMutableChips(resting.seatBets.cao),
    nong: copyMutableChips(resting.seatBets.nong),
  };
  const inFlight = copyMutableChips(undefined);

  for (const anim of animations) {
    if (anim.type === 'bet-chips') {
      const local = elapsedMs - anim.delayMs;
      if (local < 0) {
        addInPlace(seatStacks[anim.seatId], anim.chips);
        if (anim.toPot) {
          subInPlace(centerPot, anim.chips);
        } else {
          subInPlace(seatBets[anim.seatId], anim.chips);
        }
      } else if (local < anim.durationMs) {
        addInPlace(inFlight, anim.chips);
        if (anim.toPot) {
          subInPlace(centerPot, anim.chips);
        } else {
          subInPlace(seatBets[anim.seatId], anim.chips);
        }
      }
    } else if (anim.type === 'street-sweep') {
      const local = elapsedMs - anim.delayMs;
      if (local < 0) {
        for (const src of anim.fromSeats) {
          addInPlace(seatBets[src.seatId], src.chips);
          subInPlace(centerPot, src.chips);
        }
      } else if (local < anim.durationMs) {
        for (const src of anim.fromSeats) {
          addInPlace(inFlight, src.chips);
          subInPlace(centerPot, src.chips);
        }
      }
    } else if (anim.type === 'payout') {
      const local = elapsedMs - anim.delayMs;
      if (local < 0) {
        for (const transfer of anim.transfers) {
          addInPlace(centerPot, transfer.chips);
          subInPlace(seatStacks[transfer.seatId], transfer.chips);
        }
      } else if (local < anim.durationMs) {
        for (const transfer of anim.transfers) {
          addInPlace(inFlight, transfer.chips);
          subInPlace(seatStacks[transfer.seatId], transfer.chips);
        }
      }
    }
  }

  if (hasNegativeDenom(centerPot) || hasNegativeDenom(inFlight)) {
    return { ...resting, reconcilable: false };
  }
  for (const seatId of ALL_SEAT_IDS) {
    if (hasNegativeDenom(seatStacks[seatId]) || hasNegativeDenom(seatBets[seatId])) {
      return { ...resting, reconcilable: false };
    }
  }

  return {
    reconcilable: true,
    centerPot,
    seatStacks,
    seatBets,
    inFlight,
  };
}

/**
 * Verifies that `computeTableChipAllocation` stays non-negative across every
 * phase boundary of all chip-moving animations in the plan.
 */
export function isChipPlanReconcilable(
  live: LiveSceneDetails,
  animations: readonly TableAnimation[],
): boolean {
  if (!computeRestingChipAllocation(live).reconcilable) {
    return false;
  }

  const boundarySet = new Set<number>([0]);
  for (const anim of animations) {
    if (anim.type === 'bet-chips' || anim.type === 'street-sweep' || anim.type === 'payout') {
      boundarySet.add(anim.delayMs);
      boundarySet.add(anim.delayMs + anim.durationMs);
    }
  }

  const sorted = [...boundarySet].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i += 1) {
    const t = sorted[i]!;
    if (!computeTableChipAllocation(live, animations, t).reconcilable) {
      return false;
    }
    if (i + 1 < sorted.length) {
      const mid = (t + sorted[i + 1]!) / 2;
      if (!computeTableChipAllocation(live, animations, mid).reconcilable) {
        return false;
      }
    }
  }
  return true;
}

function getAddedChips(prev: ChipCounts | undefined, next: ChipCounts): ChipCounts {
  const result = copyMutableChips(undefined);
  for (const d of DENOMINATIONS) {
    const prevCount = prev ? prev[d] : 0;
    const diff = next[d] - prevCount;
    if (diff > 0) {
      result[d] = diff;
    }
  }
  return result;
}

function hasDecreasedDenom(prev: ChipCounts | undefined, next: ChipCounts): boolean {
  if (!prev) {
    return false;
  }
  for (const d of DENOMINATIONS) {
    if (next[d] < prev[d]) {
      return true;
    }
  }
  return false;
}

function getDealtSeatIds(live: LiveSceneDetails): readonly TableSeatId[] {
  const baseIds: readonly TableSeatId[] =
    live.seats.length > 0
      ? live.seats.filter((seat) => seat.status !== 'out').map((seat) => seat.id)
      : ['hero', ...live.occupiedRivals];
  const dealerSeatId = live.dealerSeatId ?? null;
  if (!dealerSeatId) {
    return baseIds;
  }
  const dealerIdx = baseIds.indexOf(dealerSeatId);
  if (dealerIdx === -1 || baseIds.length <= 1) {
    return baseIds;
  }
  // Standard poker deal order: clockwise starting from the seat after the dealer, ending on dealer
  const startIdx = (dealerIdx + 1) % baseIds.length;
  return [...baseIds.slice(startIdx), ...baseIds.slice(0, startIdx)];
}

function findSeat(
  seats: readonly PublicTableSeat[],
  id: TableSeatId,
): PublicTableSeat | undefined {
  return seats.find((seat) => seat.id === id);
}

/**
 * Checks whether a live snapshot represents a clean hand start with no prior player actions:
 * - Preflop opening deal: `street === 'preflop'` and empty board (`board.length === 0`).
 * - Accate default "Flop trước" opening deal: `street === 'flop'`, `board.length === 3`,
 *   and `timelineLength <= 3` (ante + hole-deal + flop deal only, zero player actions).
 * Any snapshot with actions/folds/streetChips/payouts or turn/river/mismatched board cards
 * is a mid-hand or forward-gap snapshot and returns false.
 */
function isCleanOpeningDeal(spot: SceneTableSnapshot): boolean {
  const live = spot.live;
  if (!live || live.street === null || live.payoutTransfers.length > 0) {
    return false;
  }
  for (const seat of live.seats) {
    if (
      seat.lastAction !== null ||
      seat.status === 'folded' ||
      countTotalChips(seat.streetChips) > 0
    ) {
      return false;
    }
  }
  if (live.street === 'preflop') {
    return spot.board.length === 0;
  }
  if (live.street === 'flop') {
    return spot.board.length === 3 && live.timelineLength <= 3;
  }
  return false;
}

function buildOpeningDealAnimations(spot: SceneTableSnapshot): readonly TableAnimation[] {
  const live = spot.live!;
  const animations: TableAnimation[] = [];
  const dealerSeatId = live.dealerSeatId ?? null;
  const seatIds = getDealtSeatIds(live);
  if (seatIds.length > 0) {
    const totalCards = seatIds.length * 2;
    const maxStagger =
      totalCards > 1
        ? Math.floor((MAX_PLAN_DURATION_MS - TABLE_ANIMATION_DURATIONS.dealCardMs) / (totalCards - 1))
        : TABLE_ANIMATION_DURATIONS.dealStaggerMs;
    const staggerMs = Math.max(10, Math.min(TABLE_ANIMATION_DURATIONS.dealStaggerMs, maxStagger));
    const totalDurationMs =
      TABLE_ANIMATION_DURATIONS.dealCardMs + Math.max(0, totalCards - 1) * staggerMs;
    animations.push({
      type: 'deal-hand',
      seatIds,
      dealerSeatId,
      cardsPerSeat: 2,
      delayMs: 0,
      cardDurationMs: TABLE_ANIMATION_DURATIONS.dealCardMs,
      staggerMs,
      totalDurationMs,
    });
  }

  // Accate default "Flop trước" variant deals the 3 flop cards immediately on hand start
  const boardCount = Math.min(5, spot.board.length);
  if (boardCount > 0) {
    const cards = spot.board.slice(0, boardCount);
    const delayMs = seatIds.length > 0 ? TABLE_ANIMATION_DURATIONS.flopAfterDealDelayMs : 0;
    const remainingBudget = Math.max(0, MAX_PLAN_DURATION_MS - delayMs - TABLE_ANIMATION_DURATIONS.boardCardMs);
    const maxBoardStagger =
      cards.length > 1 ? Math.floor(remainingBudget / (cards.length - 1)) : TABLE_ANIMATION_DURATIONS.boardStaggerMs;
    const staggerMs = Math.max(15, Math.min(TABLE_ANIMATION_DURATIONS.boardStaggerMs, maxBoardStagger));
    const totalDurationMs =
      TABLE_ANIMATION_DURATIONS.boardCardMs + Math.max(0, cards.length - 1) * staggerMs;
    animations.push({
      type: 'deal-board',
      fromIndex: 0,
      toIndex: boardCount,
      cards,
      dealerSeatId,
      delayMs,
      cardDurationMs: TABLE_ANIMATION_DURATIONS.boardCardMs,
      staggerMs,
      totalDurationMs,
    });
  }

  return animations;
}

/**
 * Ensures the sequenced plan duration never exceeds `MAX_PLAN_DURATION_MS` (450 ms)
 * by compressing stagger/delays proportionally; returns `null` (caller snaps) if
 * even compressed timings would exceed the cap.
 */
function enforceMaxPlanDuration(
  animations: readonly TableAnimation[],
  maxMs = MAX_PLAN_DURATION_MS,
): readonly TableAnimation[] | null {
  const currentMax = getPlanDurationMs(animations);
  if (currentMax <= maxMs) {
    return animations;
  }
  const scale = maxMs / currentMax;
  const compressed: TableAnimation[] = animations.map((anim) => {
    switch (anim.type) {
      case 'deal-hand': {
        const delayMs = Math.floor(anim.delayMs * scale);
        const cardDurationMs = Math.max(110, Math.floor(anim.cardDurationMs * scale));
        const totalCards = anim.seatIds.length * anim.cardsPerSeat;
        const staggerMs =
          totalCards > 1
            ? Math.max(0, Math.floor((maxMs - delayMs - cardDurationMs) / (totalCards - 1)))
            : 0;
        const totalDurationMs = cardDurationMs + Math.max(0, totalCards - 1) * staggerMs;
        return { ...anim, delayMs, cardDurationMs, staggerMs, totalDurationMs };
      }
      case 'deal-board': {
        const delayMs = Math.floor(anim.delayMs * scale);
        const cardDurationMs = Math.max(120, Math.floor(anim.cardDurationMs * scale));
        const count = anim.cards.length;
        const staggerMs =
          count > 1
            ? Math.max(0, Math.floor((maxMs - delayMs - cardDurationMs) / (count - 1)))
            : 0;
        const totalDurationMs = cardDurationMs + Math.max(0, count - 1) * staggerMs;
        return { ...anim, delayMs, cardDurationMs, staggerMs, totalDurationMs };
      }
      case 'street-sweep':
      case 'bet-chips':
      case 'fold-seat':
      case 'showdown-reveal':
      case 'payout': {
        const delayMs = Math.floor(anim.delayMs * scale);
        const durationMs = Math.max(120, Math.min(maxMs - delayMs, Math.floor(anim.durationMs * scale)));
        return { ...anim, delayMs, durationMs };
      }
    }
  });
  return getPlanDurationMs(compressed) <= maxMs ? compressed : null;
}

/**
 * Pure event-diff animation planner for Live Sandbox 3D.
 *
 * Enforces:
 * - Monotonic progress against `highWater` (`handNumber`, `inHand`, `timelineLength`):
 *   stale/rewound snapshots snap without lowering `highWater`; equal keys never replay.
 * - Strict chip conservation: non-reconcilable resting piles or chip flights snap cleanly.
 * - Compound closing call + street advance: reconciles per-seat stack drop with pot delta.
 * - Forward gaps (skipped multi-street jumps or mid-hand new-hand snapshots) snap cleanly.
 * - Initial opening deal on mount when motion is enabled.
 * - Total sequenced plan duration always <= 450 ms.
 * - Hidden information: `showdown-reveal` is emitted ONLY for non-hero, non-folded, non-out
 *   seats whose `revealedCards` transitioned from null to non-null.
 */
export function planTableAnimations(
  prev: SceneTableSnapshot | null,
  next: SceneTableSnapshot,
  reducedMotion: boolean,
  highWater?: LiveProgressMark | null,
): TableAnimationPlan {
  const nextLive = next.live;
  if (!nextLive) {
    return { eventKey: null, mode: 'none', animations: [], highWater: null };
  }

  const nextKey = getLiveEventKey(nextLive);
  const nextMark = getLiveProgressMark(nextLive);
  const nextInHand = nextLive.street !== null;
  const effectiveHighWater =
    highWater !== undefined ? highWater : prev?.live ? getLiveProgressMark(prev.live) : null;
  const relation = classifyLiveProgress(effectiveHighWater, nextLive);

  if (reducedMotion) {
    return {
      eventKey: nextKey,
      mode: 'snap',
      animations: [],
      highWater: relation === 'forward' ? nextMark : effectiveHighWater,
    };
  }

  if (relation === 'equal') {
    return { eventKey: nextKey, mode: 'none', animations: [], highWater: effectiveHighWater };
  }

  if (relation === 'stale') {
    return { eventKey: nextKey, mode: 'snap', animations: [], highWater: effectiveHighWater };
  }

  // Monotonic forward step: advance high-water mark
  const nextHighWater = nextMark;

  // Non-reconcilable resting piles (e.g. pot chip exchange) must snap with no flight
  if (!computeRestingChipAllocation(nextLive).reconcilable) {
    return { eventKey: nextKey, mode: 'snap', animations: [], highWater: nextHighWater };
  }

  // Hand ended into between-hands idle state
  if (!nextInHand) {
    return { eventKey: nextKey, mode: 'snap', animations: [], highWater: nextHighWater };
  }

  // Initial live snapshot after mount: play deal once if clean opening deal, else snap
  if (!prev || !prev.live) {
    if (!isCleanOpeningDeal(next)) {
      return { eventKey: nextKey, mode: 'snap', animations: [], highWater: nextHighWater };
    }
    const openingAnims = enforceMaxPlanDuration(buildOpeningDealAnimations(next));
    if (!openingAnims || openingAnims.length === 0) {
      return { eventKey: nextKey, mode: 'snap', animations: [], highWater: nextHighWater };
    }
    return {
      eventKey: nextKey,
      mode: 'animate',
      animations: openingAnims,
      highWater: nextHighWater,
    };
  }

  const prevLive = prev.live;
  const prevInHand = prevLive.street !== null;
  const isNewHand = nextLive.handNumber > prevLive.handNumber || !prevInHand;

  if (isNewHand) {
    // Forward gaps (e.g. new hand arriving mid-hand or with turn/river board cards) snap
    if (!isCleanOpeningDeal(next)) {
      return { eventKey: nextKey, mode: 'snap', animations: [], highWater: nextHighWater };
    }
    const openingAnims = enforceMaxPlanDuration(buildOpeningDealAnimations(next));
    if (!openingAnims || openingAnims.length === 0) {
      return { eventKey: nextKey, mode: 'snap', animations: [], highWater: nextHighWater };
    }
    return {
      eventKey: nextKey,
      mode: 'animate',
      animations: openingAnims,
      highWater: nextHighWater,
    };
  }

  // --- Same active hand ---
  const animations: TableAnimation[] = [];
  const streetAdvanced = prevLive.street !== nextLive.street;
  const prevBoardLen = Math.min(5, prev.board.length);
  const nextBoardLen = Math.min(5, next.board.length);
  const hadTransfers = prevLive.payoutTransfers.length > 0;
  const hasTransfers = nextLive.payoutTransfers.length > 0;
  const justSettled = !hadTransfers && hasTransfers;
  const dealerSeatId = nextLive.dealerSeatId ?? null;

  if (streetAdvanced) {
    const prevOrder = STREET_ORDER[prevLive.street!];
    const nextOrder = STREET_ORDER[nextLive.street!];
    const streetDelta = nextOrder - prevOrder;
    const expectedBoardDelta =
      prevLive.street === 'preflop' && nextLive.street === 'flop' ? 3 : 1;
    const actualBoardDelta = nextBoardLen - prevBoardLen;

    // Multi-street jump or inconsistent board delta -> forward gap, snap cleanly
    if (streetDelta !== 1 || actualBoardDelta !== expectedBoardDelta) {
      return { eventKey: nextKey, mode: 'snap', animations: [], highWater: nextHighWater };
    }

    // If actions already occurred on the new street in the same snapshot -> ambiguous gap, snap
    for (const nextSeat of nextLive.seats) {
      if (countTotalChips(nextSeat.streetChips) > 0) {
        return { eventKey: nextKey, mode: 'snap', animations: [], highWater: nextHighWater };
      }
    }

    // Detect closing call(s) via exact per-seat stack drop reconciling with pot delta
    const sweepSources: { readonly seatId: TableSeatId; readonly chips: ChipCounts }[] = [];
    for (const prevSeat of prevLive.seats) {
      if (countTotalChips(prevSeat.streetChips) > 0) {
        sweepSources.push({ seatId: prevSeat.id, chips: prevSeat.streetChips });
      }
    }

    let hasClosingCall = false;
    if (!hasTransfers) {
      const potDelta = copyMutableChips(nextLive.potChips);
      subInPlace(potDelta, prevLive.potChips);
      if (hasNegativeDenom(potDelta)) {
        // Pot refund or chip exchange during street transition -> snap
        return { eventKey: nextKey, mode: 'snap', animations: [], highWater: nextHighWater };
      }

      const closingContributions: { readonly seatId: TableSeatId; readonly chips: ChipCounts }[] = [];
      const sumClosing = copyMutableChips(undefined);

      for (const nextSeat of nextLive.seats) {
        const prevSeat = findSeat(prevLive.seats, nextSeat.id);
        if (!prevSeat) {
          continue;
        }
        const stackDrop = copyMutableChips(prevSeat.stackChips);
        subInPlace(stackDrop, nextSeat.stackChips);
        if (hasNegativeDenom(stackDrop)) {
          // Refund or stack increase during street transition -> snap
          return { eventKey: nextKey, mode: 'snap', animations: [], highWater: nextHighWater };
        }
        if (countTotalChips(stackDrop) > 0) {
          closingContributions.push({ seatId: nextSeat.id, chips: stackDrop });
          addInPlace(sumClosing, stackDrop);
        }
      }

      if (!chipsEqual(sumClosing, potDelta) || closingContributions.length > 1) {
        // Ambiguous compound deltas or multiple stack changes -> snap
        return { eventKey: nextKey, mode: 'snap', animations: [], highWater: nextHighWater };
      }

      if (closingContributions.length === 1) {
        const closing = closingContributions[0]!;
        hasClosingCall = true;
        animations.push({
          type: 'bet-chips',
          seatId: closing.seatId,
          chips: closing.chips,
          toPot: true,
          delayMs: 0,
          durationMs: TABLE_ANIMATION_DURATIONS.streetSweepMs,
        });
      }
    } else if (sweepSources.length > 0) {
      // Street advance combined with settlement and prior street bets -> ambiguous, snap
      return { eventKey: nextKey, mode: 'snap', animations: [], highWater: nextHighWater };
    }

    if (sweepSources.length > 0) {
      animations.push({
        type: 'street-sweep',
        fromSeats: sweepSources,
        delayMs: 0,
        durationMs: TABLE_ANIMATION_DURATIONS.streetSweepMs,
      });
    }

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
        dealerSeatId,
        delayMs:
          sweepSources.length > 0 || hasClosingCall
            ? TABLE_ANIMATION_DURATIONS.boardAfterSweepDelayMs
            : 0,
        cardDurationMs: TABLE_ANIMATION_DURATIONS.boardCardMs,
        staggerMs: TABLE_ANIMATION_DURATIONS.boardStaggerMs,
        totalDurationMs,
      });
    }
  } else {
    // Same street: board cards should not unexpectedly change
    if (nextBoardLen !== prevBoardLen) {
      return { eventKey: nextKey, mode: 'snap', animations: [], highWater: nextHighWater };
    }

    if (!justSettled) {
      const sweepSources: { readonly seatId: TableSeatId; readonly chips: ChipCounts }[] = [];
      for (const prevSeat of prevLive.seats) {
        if (countTotalChips(prevSeat.streetChips) <= 0) {
          continue;
        }
        const nextSeat = findSeat(nextLive.seats, prevSeat.id);
        if (
          nextSeat !== undefined &&
          countTotalChips(nextSeat.streetChips) === 0 &&
          next.pot >= prev.pot
        ) {
          sweepSources.push({ seatId: prevSeat.id, chips: prevSeat.streetChips });
        } else if (nextSeat !== undefined && hasDecreasedDenom(prevSeat.streetChips, nextSeat.streetChips)) {
          // Same-street uncalled refund or mismatched denomination change -> snap
          return { eventKey: nextKey, mode: 'snap', animations: [], highWater: nextHighWater };
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

      for (const nextSeat of nextLive.seats) {
        const prevSeat = findSeat(prevLive.seats, nextSeat.id);
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
    }
  }

  // Per-seat fold & showdown reveal animations
  let hasReveal = false;
  for (const nextSeat of nextLive.seats) {
    const prevSeat = findSeat(prevLive.seats, nextSeat.id);

    if (nextSeat.status === 'folded' && prevSeat?.status !== 'folded') {
      animations.push({
        type: 'fold-seat',
        seatId: nextSeat.id,
        delayMs: 0,
        durationMs: TABLE_ANIMATION_DURATIONS.foldSeatMs,
      });
    }

    // Showdown reveal: STRICTLY non-hero, non-folded, non-out seats whose revealedCards became non-null
    const hadRevealed = prevSeat?.revealedCards !== null && prevSeat?.revealedCards !== undefined;
    const nowRevealed =
      nextSeat.id !== 'hero' &&
      nextSeat.status !== 'folded' &&
      nextSeat.status !== 'out' &&
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

  // Payout transfers sliding exact chips from pot -> winner(s) + winner highlight
  if (justSettled) {
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

  if (animations.length === 0) {
    return { eventKey: nextKey, mode: 'none', animations: [], highWater: nextHighWater };
  }

  const bounded = enforceMaxPlanDuration(animations, MAX_PLAN_DURATION_MS);
  if (!bounded || !isChipPlanReconcilable(nextLive, bounded)) {
    return { eventKey: nextKey, mode: 'snap', animations: [], highWater: nextHighWater };
  }

  return {
    eventKey: nextKey,
    mode: 'animate',
    animations: bounded,
    highWater: nextHighWater,
  };
}
