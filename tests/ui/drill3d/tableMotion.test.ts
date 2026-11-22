import type * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DENOMINATIONS, emptyChips, type ChipCounts } from '../../../src/engine';
import {
  DEMO_SPOT,
  type LiveSceneDetails,
  type SceneTableSnapshot,
} from '../../../src/ui/drill3d/contract';
import {
  ACTION_BUBBLE_CANVAS,
  formatSeatActionBubble,
} from '../../../src/ui/drill3d/scene/actionBubble';
import { getSceneVisualKey, type SceneMotionState } from '../../../src/ui/drill3d/scene/motion';
import {
  ALL_SEAT_IDS,
  classifyLiveProgress,
  computeRestingChipAllocation,
  computeTableChipAllocation,
  getLiveEventKey,
  getLiveProgressMark,
  getPlanDurationMs,
  MAX_PLAN_DURATION_MS,
  planTableAnimations,
  TABLE_ANIMATION_DURATIONS,
  type LiveProgressMark,
} from '../../../src/ui/drill3d/scene/tableMotion';
import { toLiveSceneSnapshot } from '../../../src/ui/liveSandbox3d/snapshot';
import {
  createSandboxSession,
  enterHandBoundary,
  getHeroActionValidation,
  performHeroAction,
  stageChip,
  startNextHand,
  stepOneBotTurn,
} from '../../../src/ui/sandbox/controller';
import { buildSandboxTableView } from '../../../src/ui/sandbox/tableView';
import type { PublicTableSeat, SandboxSessionState, TableSeatId } from '../../../src/ui/sandbox/types';

function makeChips(partial: Partial<ChipCounts> = {}): ChipCounts {
  return { ...emptyChips(), ...partial };
}

function makeSeat(
  id: TableSeatId,
  overrides: Partial<PublicTableSeat> = {},
): PublicTableSeat {
  return {
    id,
    stackChips: makeChips({ 5: 20, 10: 20, 50: 4, 100: 0 }),
    streetChips: emptyChips(),
    status: 'active',
    lastAction: null,
    isActor: false,
    isWinner: false,
    revealedCards: null,
    ...overrides,
  };
}

function makeDefaultSeats(): readonly PublicTableSeat[] {
  return [makeSeat('hero'), makeSeat('ca'), makeSeat('cao'), makeSeat('nong')];
}

function makeLiveSnapshot(
  overrides: Partial<Omit<SceneTableSnapshot, 'live'>> & {
    readonly live?: Partial<LiveSceneDetails>;
  } = {},
): SceneTableSnapshot {
  const { live, ...rest } = overrides;
  return {
    pot: 20,
    call: 0,
    heroCards: ['A♥', 'K♦'],
    board: ['Q♥', '7♣', '2♠'],
    ...rest,
    live: {
      potChips: makeChips({ 5: 4 }),
      handNumber: 1,
      timelineLength: 4,
      seats: makeDefaultSeats(),
      payoutTransfers: [],
      street: 'flop',
      occupiedRivals: ['ca', 'cao', 'nong'],
      activeRival: 'ca',
      activePlayerName: 'Cá',
      ...live,
    },
  };
}

function makeMotionState(
  spot: SceneTableSnapshot,
  reducedMotion = false,
): SceneMotionState {
  return {
    phase: 'decision',
    highlight: null,
    spot,
    reducedMotion,
  };
}

describe('tableMotion pure event-diff animation planner', () => {
  it('plans deal-hand (and flop deal-board when board is dealt) on a new hand', () => {
    const betweenHands = makeLiveSnapshot({
      pot: 0,
      heroCards: [],
      board: [],
      live: {
        handNumber: 1,
        timelineLength: 0,
        street: null,
        potChips: emptyChips(),
        seats: makeDefaultSeats(),
      },
    });
    const newHandFlop = makeLiveSnapshot({
      pot: 20,
      heroCards: ['A♥', 'K♦'],
      board: ['Q♥', '7♣', '2♠'],
      live: {
        handNumber: 2,
        timelineLength: 3,
        street: 'flop',
        potChips: makeChips({ 5: 4 }),
        seats: [
          makeSeat('hero'),
          makeSeat('ca'),
          makeSeat('cao'),
          makeSeat('nong', { status: 'out', stackChips: emptyChips() }),
        ],
      },
    });

    const plan = planTableAnimations(betweenHands, newHandFlop, false);
    expect(plan.mode).toBe('animate');
    expect(plan.animations.map((a) => a.type)).toEqual(['deal-hand', 'deal-board']);

    const dealHand = plan.animations[0]!;
    expect(dealHand.type).toBe('deal-hand');
    if (dealHand.type === 'deal-hand') {
      // Excludes 'out' seat
      expect(dealHand.seatIds).toEqual(['hero', 'ca', 'cao']);
      expect(dealHand.cardsPerSeat).toBe(2);
      expect(dealHand.totalDurationMs).toBeGreaterThanOrEqual(150);
      expect(dealHand.totalDurationMs).toBeLessThanOrEqual(450);
    }

    const dealBoard = plan.animations[1]!;
    expect(dealBoard.type).toBe('deal-board');
    if (dealBoard.type === 'deal-board') {
      expect(dealBoard.fromIndex).toBe(0);
      expect(dealBoard.toIndex).toBe(3);
      expect(dealBoard.cards).toEqual(['Q♥', '7♣', '2♠']);
      expect(dealBoard.totalDurationMs).toBeGreaterThanOrEqual(150);
      expect(dealBoard.totalDurationMs).toBeLessThanOrEqual(450);
    }
  });

  it('plans street-dealt animations for flop, turn, and river', () => {
    const preflop = makeLiveSnapshot({
      board: [],
      live: { handNumber: 1, timelineLength: 3, street: 'preflop' },
    });
    const flop = makeLiveSnapshot({
      board: ['K♥', '8♦', '5♣'],
      live: { handNumber: 1, timelineLength: 6, street: 'flop' },
    });
    const turn = makeLiveSnapshot({
      board: ['K♥', '8♦', '5♣', '2♠'],
      live: { handNumber: 1, timelineLength: 9, street: 'turn' },
    });
    const river = makeLiveSnapshot({
      board: ['K♥', '8♦', '5♣', '2♠', '9♥'],
      live: { handNumber: 1, timelineLength: 12, street: 'river' },
    });

    const flopPlan = planTableAnimations(preflop, flop, false);
    expect(flopPlan.animations).toEqual([
      expect.objectContaining({
        type: 'deal-board',
        fromIndex: 0,
        toIndex: 3,
        cards: ['K♥', '8♦', '5♣'],
      }),
    ]);

    const turnPlan = planTableAnimations(flop, turn, false);
    expect(turnPlan.animations).toEqual([
      expect.objectContaining({
        type: 'deal-board',
        fromIndex: 3,
        toIndex: 4,
        cards: ['2♠'],
      }),
    ]);

    const riverPlan = planTableAnimations(turn, river, false);
    expect(riverPlan.animations).toEqual([
      expect.objectContaining({
        type: 'deal-board',
        fromIndex: 4,
        toIndex: 5,
        cards: ['9♥'],
      }),
    ]);
  });

  it('plans bet-chips with exact added denominations when a seat bets, calls, or raises', () => {
    const beforeBet = makeLiveSnapshot({
      pot: 30,
      live: {
        timelineLength: 4,
        potChips: makeChips({ 5: 4, 10: 1 }),
        seats: [
          makeSeat('hero'),
          makeSeat('ca', { streetChips: makeChips({ 10: 1 }), isActor: true }),
          makeSeat('cao'),
          makeSeat('nong'),
        ],
      },
    });
    const afterRaise = makeLiveSnapshot({
      pot: 55,
      live: {
        timelineLength: 5,
        potChips: makeChips({ 5: 5, 10: 3 }),
        seats: [
          makeSeat('hero'),
          makeSeat('ca', {
            streetChips: makeChips({ 5: 1, 10: 3 }),
            lastAction: { type: 'raise', amount: 25 },
            isActor: false,
          }),
          makeSeat('cao', { isActor: true }),
          makeSeat('nong'),
        ],
      },
    });

    const plan = planTableAnimations(beforeBet, afterRaise, false);
    expect(plan.mode).toBe('animate');
    expect(plan.animations).toEqual([
      {
        type: 'bet-chips',
        seatId: 'ca',
        chips: makeChips({ 5: 1, 10: 2 }),
        delayMs: 0,
        durationMs: TABLE_ANIMATION_DURATIONS.betChipsMs,
      },
    ]);
  });

  it('plans street-sweep from all seats with streetChips when a street ends', () => {
    const endOfFlop = makeLiveSnapshot({
      pot: 80,
      board: ['K♥', '8♦', '5♣'],
      live: {
        timelineLength: 8,
        street: 'flop',
        potChips: makeChips({ 5: 6, 10: 5 }),
        seats: [
          makeSeat('hero', { streetChips: makeChips({ 10: 3 }) }),
          makeSeat('ca', { streetChips: makeChips({ 5: 2, 10: 2 }) }),
          makeSeat('cao', { streetChips: emptyChips(), status: 'folded' }),
          makeSeat('nong', { streetChips: emptyChips(), status: 'folded' }),
        ],
      },
    });
    const startOfTurn = makeLiveSnapshot({
      pot: 80,
      board: ['K♥', '8♦', '5♣', '2♠'],
      live: {
        timelineLength: 9,
        street: 'turn',
        potChips: makeChips({ 5: 6, 10: 5 }),
        seats: [
          makeSeat('hero', { streetChips: emptyChips() }),
          makeSeat('ca', { streetChips: emptyChips() }),
          makeSeat('cao', { streetChips: emptyChips(), status: 'folded' }),
          makeSeat('nong', { streetChips: emptyChips(), status: 'folded' }),
        ],
      },
    });

    const plan = planTableAnimations(endOfFlop, startOfTurn, false);
    expect(plan.mode).toBe('animate');
    expect(plan.animations.map((a) => a.type)).toEqual(['street-sweep', 'deal-board']);
    const sweep = plan.animations[0]!;
    if (sweep.type === 'street-sweep') {
      expect(sweep.fromSeats).toEqual([
        { seatId: 'hero', chips: makeChips({ 10: 3 }) },
        { seatId: 'ca', chips: makeChips({ 5: 2, 10: 2 }) },
      ]);
      expect(sweep.durationMs).toBeGreaterThanOrEqual(150);
      expect(sweep.durationMs).toBeLessThanOrEqual(450);
    }
  });

  it('plans fold-seat animation when a seat transitions to folded', () => {
    const beforeFold = makeLiveSnapshot({
      live: {
        timelineLength: 5,
        seats: [
          makeSeat('hero'),
          makeSeat('ca', { status: 'active', isActor: true }),
          makeSeat('cao'),
          makeSeat('nong'),
        ],
      },
    });
    const afterFold = makeLiveSnapshot({
      live: {
        timelineLength: 6,
        seats: [
          makeSeat('hero'),
          makeSeat('ca', { status: 'folded', lastAction: { type: 'fold', amount: 0 } }),
          makeSeat('cao', { isActor: true }),
          makeSeat('nong'),
        ],
      },
    });

    const plan = planTableAnimations(beforeFold, afterFold, false);
    expect(plan.animations).toEqual([
      {
        type: 'fold-seat',
        seatId: 'ca',
        delayMs: 0,
        durationMs: TABLE_ANIMATION_DURATIONS.foldSeatMs,
      },
    ]);
  });

  it('plans showdown-reveal ONLY from revealedCards and payout with exact transfer chips', () => {
    const beforeShowdown = makeLiveSnapshot({
      pot: 120,
      board: ['K♥', '8♦', '5♣', '2♠', '9♥'],
      live: {
        timelineLength: 14,
        street: 'river',
        potChips: makeChips({ 50: 2, 10: 2 }),
        seats: [
          makeSeat('hero', { revealedCards: ['A♥', 'K♦'] }),
          makeSeat('ca', { status: 'active', revealedCards: null }),
          makeSeat('cao', { status: 'folded', revealedCards: null }),
          makeSeat('nong', { status: 'active', revealedCards: null }),
        ],
        payoutTransfers: [],
      },
    });
    const atShowdown = makeLiveSnapshot({
      pot: 0,
      board: ['K♥', '8♦', '5♣', '2♠', '9♥'],
      live: {
        timelineLength: 16,
        street: 'river',
        potChips: emptyChips(),
        seats: [
          makeSeat('hero', { revealedCards: ['A♥', 'K♦'], isWinner: false }),
          makeSeat('ca', { status: 'active', revealedCards: ['9♣', '9♦'], isWinner: true }),
          makeSeat('cao', { status: 'folded', revealedCards: null }),
          makeSeat('nong', { status: 'active', revealedCards: ['A♣', 'Q♣'], isWinner: false }),
        ],
        payoutTransfers: [{ seatId: 'ca', chips: makeChips({ 50: 2, 10: 2 }) }],
      },
    });

    const plan = planTableAnimations(beforeShowdown, atShowdown, false);
    expect(plan.mode).toBe('animate');
    const reveals = plan.animations.filter((a) => a.type === 'showdown-reveal');
    expect(reveals).toHaveLength(2);
    expect(reveals).toEqual([
      {
        type: 'showdown-reveal',
        seatId: 'ca',
        cards: ['9♣', '9♦'],
        delayMs: 0,
        durationMs: TABLE_ANIMATION_DURATIONS.showdownRevealMs,
      },
      {
        type: 'showdown-reveal',
        seatId: 'nong',
        cards: ['A♣', 'Q♣'],
        delayMs: 0,
        durationMs: TABLE_ANIMATION_DURATIONS.showdownRevealMs,
      },
    ]);

    const payout = plan.animations.find((a) => a.type === 'payout');
    expect(payout).toEqual({
      type: 'payout',
      transfers: [{ seatId: 'ca', chips: makeChips({ 50: 2, 10: 2 }) }],
      winnerIds: ['ca'],
      delayMs: TABLE_ANIMATION_DURATIONS.payoutAfterRevealDelayMs,
      durationMs: TABLE_ANIMATION_DURATIONS.payoutMs,
    });
    expect(getPlanDurationMs(plan.animations)).toBeLessThanOrEqual(450);
  });

  it('never re-fires animations when event key (handNumber, inHand, timelineLength) is unchanged', () => {
    const snap = makeLiveSnapshot({
      live: { handNumber: 3, timelineLength: 7, street: 'turn' },
    });
    const clone = makeLiveSnapshot({
      live: { handNumber: 3, timelineLength: 7, street: 'turn' },
    });

    expect(getLiveEventKey(snap.live!)).toBe('3:1:7');
    const plan = planTableAnimations(snap, clone, false);
    expect(plan.mode).toBe('none');
    expect(plan.animations).toEqual([]);
  });

  it('treats shrinking timelineLength on the same handNumber as hand-ended (snap, no animations)', () => {
    const handFinished = makeLiveSnapshot({
      pot: 0,
      live: {
        handNumber: 4,
        timelineLength: 18,
        street: 'river',
        payoutTransfers: [{ seatId: 'hero', chips: makeChips({ 50: 1 }) }],
      },
    });
    const boundaryReset = makeLiveSnapshot({
      pot: 0,
      heroCards: [],
      board: [],
      live: {
        handNumber: 4,
        timelineLength: 0,
        street: null,
        potChips: emptyChips(),
        payoutTransfers: [],
      },
    });

    const plan = planTableAnimations(handFinished, boundaryReset, false);
    expect(plan.mode).toBe('snap');
    expect(plan.animations).toEqual([]);
  });

  it('skips every animation and returns snap when reducedMotion is true', () => {
    const prev = makeLiveSnapshot({
      board: ['K♥', '8♦', '5♣'],
      live: { handNumber: 1, timelineLength: 6, street: 'flop' },
    });
    const next = makeLiveSnapshot({
      board: ['K♥', '8♦', '5♣', '2♠'],
      live: {
        handNumber: 1,
        timelineLength: 9,
        street: 'turn',
        payoutTransfers: [{ seatId: 'hero', chips: makeChips({ 50: 1 }) }],
      },
    });

    const plan = planTableAnimations(prev, next, true);
    expect(plan.mode).toBe('snap');
    expect(plan.animations).toEqual([]);
  });

  it('returns none and zero animations for Drill mode snapshots', () => {
    const plan = planTableAnimations(DEMO_SPOT, { ...DEMO_SPOT, pot: 200 }, false);
    expect(plan.eventKey).toBeNull();
    expect(plan.mode).toBe('none');
    expect(plan.animations).toEqual([]);
  });

  it('never emits showdown-reveal for rivals without non-null revealedCards (including fold-win)', () => {
    const prev = makeLiveSnapshot({
      live: {
        timelineLength: 6,
        seats: [
          makeSeat('hero', { revealedCards: ['A♥', 'K♦'] }),
          makeSeat('ca', { revealedCards: null }),
          makeSeat('cao', { status: 'folded', revealedCards: null }),
          makeSeat('nong', { status: 'folded', revealedCards: null }),
        ],
      },
    });
    const foldWin = makeLiveSnapshot({
      pot: 0,
      live: {
        timelineLength: 8,
        potChips: emptyChips(),
        seats: [
          makeSeat('hero', { status: 'folded', revealedCards: ['A♥', 'K♦'] }),
          makeSeat('ca', { status: 'active', isWinner: true, revealedCards: null }),
          makeSeat('cao', { status: 'folded', revealedCards: null }),
          makeSeat('nong', { status: 'folded', revealedCards: null }),
        ],
        payoutTransfers: [{ seatId: 'ca', chips: makeChips({ 5: 4 }) }],
      },
    });

    const plan = planTableAnimations(prev, foldWin, false);
    expect(plan.animations.some((a) => a.type === 'showdown-reveal')).toBe(false);
    expect(plan.animations.some((a) => a.type === 'payout')).toBe(true);
  });

  it('enforces hidden-information guard across a real seeded Sandbox hand and next-hand boundary', () => {
    let session = createSandboxSession({
      seed: 'l1-motion-seed-1',
      settings: { playerCount: 4, enabledRivalIds: ['ca', 'cao', 'nong'] },
    });
    let prevSnap = toLiveSceneSnapshot(buildSandboxTableView(session, 0, false));
    let sawBetOrFold = false;
    let sawBoardDeal = false;
    let sawPayout = false;

    for (let step = 0; step < 120 && session.hand?.phase === 'betting'; step += 1) {
      session =
        session.hand.activePlayerId === 'hero'
          ? performHeroAction(session, 'fold')
          : stepOneBotTurn(session);
      const nextSnap = toLiveSceneSnapshot(buildSandboxTableView(session, 0, false));
      const plan = planTableAnimations(prevSnap, nextSnap, false);

      // Re-rendering the exact same snapshot must produce zero animations
      expect(planTableAnimations(nextSnap, { ...nextSnap }, false).animations).toEqual([]);

      // Strict hidden information: never reveal any rival card when revealedCards is null
      for (const anim of plan.animations) {
        if (anim.type === 'showdown-reveal') {
          const seat = nextSnap.live?.seats.find((s) => s.id === anim.seatId);
          expect(seat?.revealedCards).not.toBeNull();
          expect(anim.cards).toEqual(seat?.revealedCards);
        }
        if (anim.type === 'bet-chips' || anim.type === 'fold-seat') sawBetOrFold = true;
        if (anim.type === 'deal-board') sawBoardDeal = true;
        if (anim.type === 'payout') sawPayout = true;
      }

      prevSnap = nextSnap;
    }

    expect(sawBetOrFold).toBe(true);
    expect(sawPayout).toBe(true);
    expect(sawBoardDeal || prevSnap.board.length >= 3).toBe(true);

    // Entering hand boundary resets timelineLength to 0 with same handNumber -> snap, no animations
    const boundary = enterHandBoundary(session);
    const boundarySnap = toLiveSceneSnapshot(buildSandboxTableView(boundary, 0, false));
    const boundaryPlan = planTableAnimations(prevSnap, boundarySnap, false);
    expect(boundaryPlan.mode).toBe('snap');
    expect(boundaryPlan.animations).toEqual([]);

    // Starting next hand deals cards
    const nextHandSession = startNextHand(boundary);
    const nextHandSnap = toLiveSceneSnapshot(buildSandboxTableView(nextHandSession, 0, false));
    const nextHandPlan = planTableAnimations(boundarySnap, nextHandSnap, false);
    expect(nextHandPlan.mode).toBe('animate');
    expect(nextHandPlan.animations.some((a) => a.type === 'deal-hand')).toBe(true);
  });
});

describe('getSceneVisualKey live change detection', () => {
  it('changes when potChips, seats, payoutTransfers, handNumber, or timelineLength change', () => {
    const base = makeMotionState(makeLiveSnapshot());
    const baseKey = getSceneVisualKey(base);

    // Exact clone => identical key
    expect(getSceneVisualKey(makeMotionState(makeLiveSnapshot()))).toBe(baseKey);

    // potChips change at same numeric value
    const potDiff = makeMotionState(
      makeLiveSnapshot({ pot: 20, live: { potChips: makeChips({ 10: 2 }) } }),
    );
    expect(getSceneVisualKey(potDiff)).not.toBe(baseKey);

    // handNumber change
    const handDiff = makeMotionState(makeLiveSnapshot({ live: { handNumber: 2 } }));
    expect(getSceneVisualKey(handDiff)).not.toBe(baseKey);

    // timelineLength change
    const timelineDiff = makeMotionState(makeLiveSnapshot({ live: { timelineLength: 5 } }));
    expect(getSceneVisualKey(timelineDiff)).not.toBe(baseKey);

    // seat stackChips / streetChips / lastAction / isActor / isWinner / revealedCards change
    const seatBetDiff = makeMotionState(
      makeLiveSnapshot({
        live: {
          seats: [
            makeSeat('hero'),
            makeSeat('ca', {
              streetChips: makeChips({ 5: 2 }),
              lastAction: { type: 'bet', amount: 10 },
            }),
            makeSeat('cao'),
            makeSeat('nong'),
          ],
        },
      }),
    );
    expect(getSceneVisualKey(seatBetDiff)).not.toBe(baseKey);

    const seatRevealDiff = makeMotionState(
      makeLiveSnapshot({
        live: {
          seats: [
            makeSeat('hero'),
            makeSeat('ca', { revealedCards: ['9♥', '9♣'], isWinner: true }),
            makeSeat('cao'),
            makeSeat('nong'),
          ],
        },
      }),
    );
    expect(getSceneVisualKey(seatRevealDiff)).not.toBe(baseKey);

    // payoutTransfers change
    const payoutDiff = makeMotionState(
      makeLiveSnapshot({
        live: {
          payoutTransfers: [{ seatId: 'ca', chips: makeChips({ 5: 4 }) }],
        },
      }),
    );
    expect(getSceneVisualKey(payoutDiff)).not.toBe(baseKey);
  });
});

describe('actionBubble formatting', () => {
  it('formats Vietnamese-UI English poker labels accurately', () => {
    expect(formatSeatActionBubble({ status: 'active', lastAction: { type: 'check', amount: 0 } })?.label).toBe('Check');
    expect(formatSeatActionBubble({ status: 'active', lastAction: { type: 'call', amount: 35 } })?.label).toBe('Call 35');
    expect(formatSeatActionBubble({ status: 'active', lastAction: { type: 'bet', amount: 50 } })?.label).toBe('Bet 50');
    expect(formatSeatActionBubble({ status: 'active', lastAction: { type: 'raise', amount: 100 } })?.label).toBe('Raise 100');
    expect(formatSeatActionBubble({ status: 'folded', lastAction: { type: 'fold', amount: 0 } })?.label).toBe('Fold');
    expect(formatSeatActionBubble({ status: 'all-in', lastAction: { type: 'bet', amount: 45 } })?.label).toBe('All-in');
    expect(formatSeatActionBubble({ status: 'out', lastAction: { type: 'fold', amount: 0 } })).toBeNull();
    expect(formatSeatActionBubble({ status: 'active', lastAction: null })).toBeNull();
  });
});

vi.mock('../../../src/ui/drill3d/scene/textures', async () => {
  const three = await import('three');
  const makeTex = (name: string) => {
    const tex = new three.Texture();
    tex.name = name;
    return tex;
  };
  return {
    createCardBackTexture: () => makeTex('card-back'),
    createCardFaceTexture: (card: string) => makeTex(`card-face:${card}`),
    createChipEdgeTexture: () => makeTex('chip-edge'),
    createChipTopTexture: (_b: string, _s: string, _a: string, label: string) => makeTex(`chip:${label}`),
    createRiverSlotTexture: () => makeTex('river-slot'),
  };
});

vi.mock('../../../src/ui/drill3d/scene/actionBubble', async (importOriginal) => {
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
  try {
    const actual = await importOriginal<typeof import('../../../src/ui/drill3d/scene/actionBubble')>();
    const three = await import('three');
    return {
      ...actual,
      createActionBubbleTexture: (spec: { label: string; tone: string }) => {
        const tex = new three.Texture();
        tex.name = `bubble:${spec.label}`;
        return tex;
      },
    };
  } finally {
    random.mockRestore();
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildTabletop 3D live seats, hidden info, board legibility, and Drill preservation', () => {
  it('keeps rival cards strictly face-down without revealedCards and flips ONLY from revealedCards', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { buildTabletop } = await import('../../../src/ui/drill3d/scene/buildTabletop');
    const live = makeLiveSnapshot({
      pot: 40,
      live: {
        potChips: makeChips({ 5: 4, 10: 2 }),
        seats: [
          makeSeat('hero', { isActor: true, revealedCards: ['A♥', 'K♦'] }),
          makeSeat('ca', {
            status: 'active',
            streetChips: makeChips({ 10: 2 }),
            lastAction: { type: 'bet', amount: 20 },
            revealedCards: null,
          }),
          makeSeat('cao', { status: 'folded', lastAction: { type: 'fold', amount: 0 }, revealedCards: null }),
          makeSeat('nong', { status: 'out', stackChips: emptyChips(), revealedCards: null }),
        ],
      },
    });

    const rig = buildTabletop(live);

    // Cá: active without revealedCards -> BOTH card textures must be card-back
    const caCards = rig.root.getObjectByName('RivalCards-ca')!;
    expect(caCards.visible).toBe(true);
    expect(caCards.children).toHaveLength(2);
    for (const card of caCards.children) {
      const mats = (card as THREE.Mesh).material as THREE.MeshStandardMaterial[];
      expect(mats[2]!.map!.name).toBe('card-back');
      expect(mats[3]!.map!.name).toBe('card-back');
    }

    // Cáo: folded -> cards slid toward muck and faded, still strictly card-back
    const caoCards = rig.root.getObjectByName('RivalCards-cao')!;
    expect(caoCards.visible).toBe(true);
    const caoFirstMat = ((caoCards.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial[])[2]!;
    expect(caoFirstMat.map!.name).toBe('card-back');
    expect(caoFirstMat.opacity).toBeLessThan(0.6);

    // Nóng: status 'out' -> no cards visible
    const nongCards = rig.root.getObjectByName('RivalCards-nong')!;
    expect(nongCards.visible).toBe(false);

    // Actor glow on Hero only
    expect(rig.root.getObjectByName('SeatActorRing-hero')!.visible).toBe(true);
    expect(rig.root.getObjectByName('SeatActorRing-ca')!.visible).toBe(false);

    // Action bubble on Cá shows "Bet 20"
    const caBubble = rig.root.getObjectByName('SeatBubble-ca') as THREE.Sprite;
    expect(caBubble.visible).toBe(true);
    expect(caBubble.material.map!.name).toBe('bubble:Bet 20');

    // Bet pile & stack pile on Cá contain real instanced meshes
    const caBet = rig.root.getObjectByName('SeatBet-ca')!;
    expect(caBet.children.length).toBeGreaterThan(0);
    const caStack = rig.root.getObjectByName('SeatStack-ca')!;
    expect(caStack.children.length).toBeGreaterThan(0);

    // Showdown: reveal Cá's cards ONLY from revealedCards
    const showdown = makeLiveSnapshot({
      pot: 0,
      live: {
        timelineLength: 10,
        potChips: emptyChips(),
        seats: [
          makeSeat('hero', { revealedCards: ['A♥', 'K♦'] }),
          makeSeat('ca', { status: 'active', isWinner: true, revealedCards: ['Q♣', 'Q♦'] }),
          makeSeat('cao', { status: 'folded', revealedCards: null }),
          makeSeat('nong', { status: 'out', stackChips: emptyChips(), revealedCards: null }),
        ],
        payoutTransfers: [{ seatId: 'ca', chips: makeChips({ 10: 2 }) }],
      },
    });
    rig.updateSpot(showdown);

    const revealedFaces = caCards.children.map(
      (card) => ((card as THREE.Mesh).material as THREE.MeshStandardMaterial[])[2]!.map!.name,
    );
    expect(revealedFaces).toEqual(['card-face:Q♣', 'card-face:Q♦']);
    expect(rig.root.getObjectByName('SeatWinnerRing-ca')!.visible).toBe(true);
  });

  it('preserves Drill mode cleanly: no live seats/bubbles, enlarged board, unoccluded pot, and lifting highlights', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { buildTabletop, TABLETOP_METRICS } = await import(
      '../../../src/ui/drill3d/scene/buildTabletop'
    );
    const rig = buildTabletop(DEMO_SPOT);

    // No live seat overlays in Drill
    expect(rig.root.getObjectByName('LiveSeats')!.visible).toBe(false);
    expect(rig.root.getObjectByName('FixtureSeatProps')!.visible).toBe(true);

    // Enlarged board cards
    expect(TABLETOP_METRICS.boardCardScale).toBeGreaterThan(1.15);

    // Pot is positioned left-center and separated from Hero's cards so it is not occluded
    const potGroup = rig.root.getObjectByName('PotChips')!;
    const callGroup = rig.root.getObjectByName('CallChips')!;
    expect(potGroup.position.x).toBeLessThan(-0.35);
    expect(TABLETOP_METRICS.heroCardZ - potGroup.position.z).toBeGreaterThan(0.5);

    // Drill highlights lift the right chip piles
    rig.updateHighlight('pot');
    expect(potGroup.position.y).toBeGreaterThan(0.02);
    expect(callGroup.position.y).toBe(0);

    rig.updateHighlight('call');
    expect(potGroup.position.y).toBe(0);
    expect(callGroup.position.y).toBeGreaterThan(0.02);

    rig.updateHighlight('total');
    expect(potGroup.position.y).toBeGreaterThan(0.02);
    expect(callGroup.position.y).toBeGreaterThan(0.02);

    rig.updateHighlight(null);
    expect(potGroup.position.y).toBe(0);
    expect(callGroup.position.y).toBe(0);
  });

  it('plays, steps, and cleanly completes/snaps tabletop animations including exact payout chips', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { buildTabletop } = await import('../../../src/ui/drill3d/scene/buildTabletop');
    const prev = makeLiveSnapshot({
      pot: 65,
      board: ['K♥', '8♦', '5♣', '2♠', '9♥'],
      live: {
        timelineLength: 14,
        street: 'river',
        potChips: makeChips({ 5: 1, 10: 1, 50: 1 }),
        seats: [
          makeSeat('hero', { revealedCards: ['A♥', 'K♦'] }),
          makeSeat('ca', { revealedCards: null }),
          makeSeat('cao', { status: 'folded' }),
          makeSeat('nong', { status: 'folded' }),
        ],
        payoutTransfers: [],
      },
    });
    const next = makeLiveSnapshot({
      pot: 0,
      board: ['K♥', '8♦', '5♣', '2♠', '9♥'],
      live: {
        timelineLength: 16,
        street: 'river',
        potChips: emptyChips(),
        seats: [
          makeSeat('hero', { revealedCards: ['A♥', 'K♦'] }),
          makeSeat('ca', { revealedCards: ['9♣', '9♦'], isWinner: true }),
          makeSeat('cao', { status: 'folded' }),
          makeSeat('nong', { status: 'folded' }),
        ],
        payoutTransfers: [{ seatId: 'ca', chips: makeChips({ 5: 1, 10: 1, 50: 1 }) }],
      },
    });

    const rig = buildTabletop(prev);
    const plan = planTableAnimations(prev, next, false);
    expect(plan.mode).toBe('animate');

    rig.updateSpot(next);
    rig.playAnimations?.(plan.animations, 1000);
    expect(rig.hasActiveAnimations?.()).toBe(true);

    // Mid-animation: TableAnimFx holds the exact payout chip pile (3 denominations: 5, 10, 50)
    const animFx = rig.root.getObjectByName('TableAnimFx')!;
    expect(animFx.children).toHaveLength(1);
    const payoutPile = animFx.children[0]!;
    expect(payoutPile.children).toHaveLength(3);

    // Stepping mid-flight keeps animation active
    expect(rig.stepAnimations?.(1200)).toBe(true);
    expect(rig.hasActiveAnimations?.()).toBe(true);

    // Stepping past duration completes animation and clears temporary FX meshes
    expect(rig.stepAnimations?.(2000)).toBe(false);
    expect(rig.hasActiveAnimations?.()).toBe(false);
    expect(animFx.children).toHaveLength(0);

    // Snap mid-animation immediately stops and clears temporary FX
    rig.playAnimations?.(plan.animations, 3000);
    expect(rig.hasActiveAnimations?.()).toBe(true);
    rig.snapAnimations?.();
    expect(rig.hasActiveAnimations?.()).toBe(false);
    expect(animFx.children).toHaveLength(0);
  });
});

function playHeroCheckOrCall(session: SandboxSessionState): SandboxSessionState {
  const hand = session.hand;
  if (!hand || hand.phase !== 'betting') {
    return session;
  }
  if (hand.activePlayerId !== 'hero') {
    return stepOneBotTurn(session);
  }
  const validation = getHeroActionValidation(session);
  if (validation.canCheck) {
    return performHeroAction(session, 'check');
  }
  const hero = hand.seats.find((s) => s.playerId === 'hero')!;
  let remaining = validation.callAmount ?? 0;
  let staged = session;
  for (const d of [100, 50, 10, 5] as const) {
    const count = Math.min(hero.stack[d], Math.floor(remaining / d));
    for (let n = 0; n < count; n += 1) {
      staged = stageChip(staged, d);
    }
    remaining -= count * d;
  }
  if (remaining === 0 && getHeroActionValidation(staged).canConfirmCall) {
    return performHeroAction(staged, 'call');
  }
  return performHeroAction(session, 'fold');
}

function collectSeededSnapshots(seed: string): readonly SceneTableSnapshot[] {
  let session = createSandboxSession({
    seed,
    settings: { playerCount: 4, enabledRivalIds: ['ca', 'cao', 'nong'] },
  });
  const snaps: SceneTableSnapshot[] = [toLiveSceneSnapshot(buildSandboxTableView(session, 0, false))];
  for (let i = 0; i < 80 && session.hand?.phase === 'betting'; i += 1) {
    session = playHeroCheckOrCall(session);
    snaps.push(toLiveSceneSnapshot(buildSandboxTableView(session, 0, false)));
  }
  return snaps;
}

function readPileChipCounts(group: THREE.Object3D): ChipCounts {
  const counts = { ...emptyChips() };
  group.traverse((obj) => {
    const inst = obj as THREE.InstancedMesh;
    if (!inst.isInstancedMesh || !obj.visible) {
      return;
    }
    // Check ancestor visibility up to group
    let cur: THREE.Object3D | null = obj;
    while (cur && cur !== group) {
      if (!cur.visible) return;
      cur = cur.parent;
    }
    const mats = Array.isArray(inst.material) ? inst.material : [inst.material];
    const topMat = mats[1] as THREE.MeshStandardMaterial | undefined;
    const label = topMat?.map?.name ?? '';
    const match = /^chip:(\d+)$/.exec(label);
    if (match) {
      const denom = Number(match[1]) as (typeof DENOMINATIONS)[number];
      if (denom in counts) {
        counts[denom] += inst.count;
      }
    }
  });
  return counts;
}

describe('L1 fix1: chip conservation, closing call, monotonic progress, dealer dealing, disposal, camera & readability', () => {
  it('conserves every physical chip per denomination across sandbox3d-1 resting and mid-flight states (including 3D scene graph & same-key updates)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { buildTabletop } = await import('../../../src/ui/drill3d/scene/buildTabletop');
    const snaps = collectSeededSnapshots('sandbox3d-1');
    expect(snaps.length).toBeGreaterThan(6);

    let highWater: LiveProgressMark | null = null;
    let prev: SceneTableSnapshot | null = null;
    const rig = buildTabletop(snaps[0]!);

    for (const snap of snaps) {
      const live = snap.live!;
      const expectedTotal = { ...emptyChips() };
      for (const d of DENOMINATIONS) {
        expectedTotal[d] =
          live.potChips[d] + live.seats.reduce((sum, s) => sum + s.stackChips[d], 0);
      }

      // Resting conservation
      const resting = computeRestingChipAllocation(live);
      for (const d of DENOMINATIONS) {
        const restingSum =
          resting.centerPot[d] +
          ALL_SEAT_IDS.reduce((sum, id) => sum + resting.seatStacks[id][d] + resting.seatBets[id][d], 0);
        expect(restingSum).toBe(expectedTotal[d]);
      }

      const plan = planTableAnimations(prev, snap, false, highWater);
      expect(getPlanDurationMs(plan.animations)).toBeLessThanOrEqual(MAX_PLAN_DURATION_MS);
      highWater = plan.highWater ?? getLiveProgressMark(live);
      prev = snap;

      rig.snapAnimations?.();
      rig.updateSpot(snap);

      if (plan.mode === 'animate' && plan.animations.length > 0) {
        const duration = getPlanDurationMs(plan.animations);
        rig.playAnimations?.(plan.animations, 1000);

        for (const t of [0, Math.floor(duration * 0.25), Math.floor(duration * 0.5), duration - 1]) {
          // Pure allocator conservation mid-flight
          const alloc = computeTableChipAllocation(live, plan.animations, t);
          expect(alloc.reconcilable).toBe(true);
          for (const d of DENOMINATIONS) {
            const totalAtT =
              alloc.centerPot[d] +
              alloc.inFlight[d] +
              ALL_SEAT_IDS.reduce((sum, id) => sum + alloc.seatStacks[id][d] + alloc.seatBets[id][d], 0);
            expect(totalAtT).toBe(expectedTotal[d]);
          }

          // Real 3D InstancedMesh conservation mid-flight
          rig.stepAnimations?.(1000 + t);
          const potMeshCounts = readPileChipCounts(rig.root.getObjectByName('PotChips')!);
          const fxMeshCounts = readPileChipCounts(rig.root.getObjectByName('TableAnimFx')!);
          const seatSum = { ...emptyChips() };
          for (const seatId of ALL_SEAT_IDS) {
            const st = readPileChipCounts(rig.root.getObjectByName(`SeatStack-${seatId}`)!);
            const bt = readPileChipCounts(rig.root.getObjectByName(`SeatBet-${seatId}`)!);
            for (const d of DENOMINATIONS) {
              seatSum[d] += st[d] + bt[d];
            }
          }
          for (const d of DENOMINATIONS) {
            expect(potMeshCounts[d] + fxMeshCounts[d] + seatSum[d]).toBe(expectedTotal[d]);
          }
        }

        // Same-key update mid-flight (e.g. only `call` changed) must preserve mid-flight piles
        rig.stepAnimations?.(1000 + Math.floor(duration * 0.4));
        const beforeSameKeyStack = readPileChipCounts(rig.root.getObjectByName('SeatStack-cao')!);
        rig.updateSpot({ ...snap, call: snap.call + 15 });
        expect(rig.hasActiveAnimations?.()).toBe(true);
        const afterSameKeyStack = readPileChipCounts(rig.root.getObjectByName('SeatStack-cao')!);
        expect(afterSameKeyStack).toEqual(beforeSameKeyStack);

        rig.stepAnimations?.(1000 + duration + 10);
        expect(rig.hasActiveAnimations?.()).toBe(false);
      }
    }
  });

  it('keeps existing bet pile visible during a raise and snaps non-reconcilable pot chip exchanges', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { buildTabletop } = await import('../../../src/ui/drill3d/scene/buildTabletop');

    const beforeRaise = makeLiveSnapshot({
      pot: 30,
      live: {
        timelineLength: 4,
        potChips: makeChips({ 5: 4, 10: 1 }),
        seats: [
          makeSeat('hero'),
          makeSeat('ca', { streetChips: makeChips({ 10: 1 }), stackChips: makeChips({ 5: 10, 10: 10 }) }),
          makeSeat('cao'),
          makeSeat('nong'),
        ],
      },
    });
    const afterRaise = makeLiveSnapshot({
      pot: 55,
      live: {
        timelineLength: 5,
        potChips: makeChips({ 5: 5, 10: 3 }),
        seats: [
          makeSeat('hero'),
          makeSeat('ca', { streetChips: makeChips({ 5: 1, 10: 3 }), stackChips: makeChips({ 5: 9, 10: 8 }) }),
          makeSeat('cao'),
          makeSeat('nong'),
        ],
      },
    });

    const rig = buildTabletop(beforeRaise);
    const plan = planTableAnimations(beforeRaise, afterRaise, false);
    expect(plan.mode).toBe('animate');
    rig.updateSpot(afterRaise);
    rig.playAnimations?.(plan.animations, 500);
    rig.stepAnimations?.(600);

    // Existing 10-chip bet pile stays visible while only the +25 increment (1x5, 2x10) flies
    const caBetMid = readPileChipCounts(rig.root.getObjectByName('SeatBet-ca')!);
    expect(caBetMid).toEqual(makeChips({ 10: 1 }));
    const fxMid = readPileChipCounts(rig.root.getObjectByName('TableAnimFx')!);
    expect(fxMid).toEqual(makeChips({ 5: 1, 10: 2 }));
    const potMid = readPileChipCounts(rig.root.getObjectByName('PotChips')!);
    expect(potMid).toEqual(makeChips({ 5: 4 }));

    // Non-reconcilable pot chip exchange: potChips cannot cover streetChips by denomination -> snap, no seat bets
    const exchanged = makeLiveSnapshot({
      pot: 55,
      live: {
        timelineLength: 6,
        potChips: makeChips({ 50: 1, 5: 1 }),
        seats: [
          makeSeat('hero'),
          makeSeat('ca', { streetChips: makeChips({ 5: 1, 10: 3 }) }),
          makeSeat('cao'),
          makeSeat('nong'),
        ],
      },
    });
    const exchangePlan = planTableAnimations(afterRaise, exchanged, false);
    expect(exchangePlan.mode).toBe('snap');
    expect(exchangePlan.animations).toEqual([]);
    const exAlloc = computeRestingChipAllocation(exchanged.live!);
    expect(exAlloc.reconcilable).toBe(false);
    expect(exAlloc.centerPot).toEqual(makeChips({ 50: 1, 5: 1 }));
    expect(exAlloc.seatBets.ca).toEqual(emptyChips());
  });

  it('plans Cá closing Call 35 alongside street sweep and River deal on sandbox3d-1 timeline 10 -> 12', () => {
    const snaps = collectSeededSnapshots('sandbox3d-1');
    const idx10 = snaps.findIndex((s) => s.live?.timelineLength === 10);
    expect(idx10).toBeGreaterThanOrEqual(0);
    const snap10 = snaps[idx10]!;
    const snap12 = snaps[idx10 + 1]!;
    expect(snap12.live?.timelineLength).toBe(12);
    expect(snap10.live?.street).toBe('turn');
    expect(snap12.live?.street).toBe('river');

    const plan = planTableAnimations(snap10, snap12, false);
    expect(plan.mode).toBe('animate');
    expect(getPlanDurationMs(plan.animations)).toBeLessThanOrEqual(MAX_PLAN_DURATION_MS);

    const closingBet = plan.animations.find((a) => a.type === 'bet-chips');
    expect(closingBet).toBeDefined();
    if (closingBet?.type === 'bet-chips') {
      expect(closingBet.seatId).toBe('ca');
      expect(closingBet.toPot).toBe(true);
      expect(closingBet.chips).toEqual(makeChips({ 5: 1, 10: 3 }));
    }
    expect(plan.animations.some((a) => a.type === 'street-sweep')).toBe(true);
    expect(plan.animations.some((a) => a.type === 'deal-board')).toBe(true);

    // Ambiguous compound update (two seats drop stacks on street advance) must snap
    const ambiguousNext = makeLiveSnapshot({
      pot: 250,
      board: snap12.board,
      live: {
        ...snap12.live!,
        potChips: makeChips({ 5: snap12.live!.potChips[5] + 4, 10: snap12.live!.potChips[10], 50: snap12.live!.potChips[50], 100: snap12.live!.potChips[100] }),
        seats: snap12.live!.seats.map((s) =>
          s.id === 'nong' ? { ...s, stackChips: { ...s.stackChips, 5: s.stackChips[5] - 4 } } : s,
        ),
      },
    });
    const ambiguousPlan = planTableAnimations(snap10, ambiguousNext, false);
    expect(ambiguousPlan.mode).toBe('snap');
    expect(ambiguousPlan.animations).toEqual([]);
  });

  it('enforces monotonic progress (3 -> 4 -> 3 -> 4 replays never, lower handNumber snaps, multi-street jump snaps)', () => {
    const snaps = collectSeededSnapshots('sandbox3d-1');
    const snap3 = snaps.find((s) => s.live?.timelineLength === 3)!;
    const snap4 = snaps.find((s) => s.live?.timelineLength === 4)!;
    expect(snap3).toBeDefined();
    expect(snap4).toBeDefined();

    // Start at timeline 3
    let highWater: LiveProgressMark | null = getLiveProgressMark(snap3.live!);
    let lastAccepted: SceneTableSnapshot = snap3;

    // 3 -> 4 plays Cáo's Bet 35 once
    const first4 = planTableAnimations(lastAccepted, snap4, false, highWater);
    expect(first4.mode).toBe('animate');
    expect(first4.animations.some((a) => a.type === 'bet-chips' && a.seatId === 'cao')).toBe(true);
    highWater = first4.highWater!;
    lastAccepted = snap4;

    // 4 -> 3 (stale): snaps and does NOT lower highWater
    expect(classifyLiveProgress(highWater, snap3.live!)).toBe('stale');
    const stale3 = planTableAnimations(lastAccepted, snap3, false, highWater);
    expect(stale3.mode).toBe('snap');
    expect(stale3.animations).toEqual([]);
    expect(stale3.highWater).toEqual(highWater);

    // 3 -> 4 again (equal to highWater): must NOT replay Cáo's Bet 35
    expect(classifyLiveProgress(highWater, snap4.live!)).toBe('equal');
    const second4 = planTableAnimations(lastAccepted, snap4, false, highWater);
    expect(second4.mode).toBe('none');
    expect(second4.animations).toEqual([]);

    // Lower handNumber snaps and preserves high-water mark
    const hand2HighWater: LiveProgressMark = { handNumber: 2, inHand: true, timelineLength: 3 };
    const lowerHandPlan = planTableAnimations(snap4, snap3, false, hand2HighWater);
    expect(lowerHandPlan.mode).toBe('snap');
    expect(lowerHandPlan.animations).toEqual([]);
    expect(lowerHandPlan.highWater).toEqual(hand2HighWater);

    // Skipped multi-street snapshot (flop -> river) snaps
    const flopSnap = makeLiveSnapshot({
      board: ['K♥', '8♦', '5♣'],
      live: { handNumber: 1, timelineLength: 5, street: 'flop' },
    });
    const riverSkip = makeLiveSnapshot({
      board: ['K♥', '8♦', '5♣', '2♠', '9♥'],
      live: { handNumber: 1, timelineLength: 14, street: 'river' },
    });
    const multiStreetPlan = planTableAnimations(flopSnap, riverSkip, false);
    expect(multiStreetPlan.mode).toBe('snap');
    expect(multiStreetPlan.animations).toEqual([]);

    // Skipped new-hand snapshot with 5 board cards already dealt snaps (never exceeds 450 ms)
    const skippedNewHand = makeLiveSnapshot({
      board: ['K♥', '8♦', '5♣', '2♠', '9♥'],
      live: { handNumber: 2, timelineLength: 12, street: 'river' },
    });
    const skippedNewPlan = planTableAnimations(flopSnap, skippedNewHand, false);
    expect(skippedNewPlan.mode).toBe('snap');
    expect(skippedNewPlan.animations).toEqual([]);
  });

  it('deals from the real dealer seat, settles each card individually without hiding the whole seat, and supports initial mount deal', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { buildTabletop, getDealOrigin } = await import('../../../src/ui/drill3d/scene/buildTabletop');

    // Initial preflop empty-board snapshot on mount (prev === null) plays deal once from dealer seat
    const initialPreflop = makeLiveSnapshot({
      board: [],
      live: {
        handNumber: 1,
        timelineLength: 2,
        dealerSeatId: 'ca',
        street: 'preflop',
        potChips: makeChips({ 5: 4 }),
        seats: makeDefaultSeats(),
      },
    });
    const initPlan = planTableAnimations(null, initialPreflop, false);
    expect(initPlan.mode).toBe('animate');
    expect(initPlan.animations).toHaveLength(1);
    const deal = initPlan.animations[0]!;
    expect(deal.type).toBe('deal-hand');
    if (deal.type === 'deal-hand') {
      expect(deal.dealerSeatId).toBe('ca');
      // Starts clockwise after Cá: Cáo -> Nóng -> Hero -> Cá
      expect(deal.seatIds).toEqual(['cao', 'nong', 'hero', 'ca']);
    }
    expect(getPlanDurationMs(initPlan.animations)).toBeLessThanOrEqual(MAX_PLAN_DURATION_MS);

    // Mid-hand initial mount snaps
    const midHandMount = makeLiveSnapshot({
      board: ['K♥', '8♦', '5♣', '2♠'],
      live: { handNumber: 1, timelineLength: 9, street: 'turn', dealerSeatId: 'hero' },
    });
    expect(planTableAnimations(null, midHandMount, false).mode).toBe('snap');

    // Verify 3D flight origin starts at Cá's dealOrigin and each card settles at its own flight end
    const rig = buildTabletop(initialPreflop);
    rig.playAnimations?.(initPlan.animations, 1000);
    const animFx = rig.root.getObjectByName('TableAnimFx')!;
    const caoOrigin = getDealOrigin('ca');
    // At t=0: first flying card is visible right at Cá's deal origin
    const firstFlyingCard = animFx.children[0]!;
    expect(firstFlyingCard.visible).toBe(true);
    expect(firstFlyingCard.position.x).toBeCloseTo(caoOrigin[0], 4);
    expect(firstFlyingCard.position.z).toBeCloseTo(caoOrigin[2], 4);

    // Hero seat group stays visible while individual cards settle on their own schedule
    const heroGroup = rig.root.getObjectByName('HeroCards')!;
    expect(heroGroup.visible).toBe(true);
    expect(heroGroup.children[0]!.visible).toBe(false);
    expect(heroGroup.children[1]!.visible).toBe(false);

    // Hero's 1st card is index 2 in deal order (startDelay = 2*35 = 70ms, end = 240ms).
    // Hero's 2nd card is index 6 in deal order (startDelay = 6*35 = 210ms, end = 380ms).
    // At elapsed = 260ms: Hero's 1st card MUST be settled and visible while 2nd card is still flying!
    rig.stepAnimations?.(1260);
    expect(heroGroup.visible).toBe(true);
    expect(heroGroup.children[0]!.visible).toBe(true);
    expect(heroGroup.children[1]!.visible).toBe(false);
    expect(animFx.children[6]!.visible).toBe(true);
  });

  it('disposes reveal meshes/textures and bubble textures/materials on between-hands transition and guards status=out reveals', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { buildTabletop } = await import('../../../src/ui/drill3d/scene/buildTabletop');

    // Guard showdown-reveal against synthetic status === 'out' with non-null revealedCards
    const prevActive = makeLiveSnapshot({
      live: {
        timelineLength: 8,
        seats: [
          makeSeat('hero'),
          makeSeat('ca', { status: 'out', stackChips: emptyChips(), revealedCards: null }),
          makeSeat('cao'),
          makeSeat('nong'),
        ],
      },
    });
    const nextOutReveal = makeLiveSnapshot({
      live: {
        timelineLength: 9,
        seats: [
          makeSeat('hero'),
          makeSeat('ca', { status: 'out', stackChips: emptyChips(), revealedCards: ['A♠', 'K♠'] }),
          makeSeat('cao'),
          makeSeat('nong'),
        ],
      },
    });
    const outPlan = planTableAnimations(prevActive, nextOutReveal, false);
    expect(outPlan.animations.some((a) => a.type === 'showdown-reveal')).toBe(false);

    // Build showdown state with Cáo revealed cards + action bubble
    const showdownSnap = makeLiveSnapshot({
      pot: 0,
      board: ['K♥', '8♦', '5♣', '2♠', '9♥'],
      live: {
        handNumber: 1,
        timelineLength: 16,
        street: 'river',
        potChips: emptyChips(),
        seats: [
          makeSeat('hero', { revealedCards: ['A♥', 'K♦'] }),
          makeSeat('ca', { status: 'folded' }),
          makeSeat('cao', {
            status: 'active',
            isWinner: true,
            lastAction: { type: 'call', amount: 35 },
            revealedCards: ['Q♠', 'Q♣'],
          }),
          makeSeat('nong', { status: 'folded' }),
        ],
        payoutTransfers: [{ seatId: 'cao', chips: makeChips({ 10: 5 }) }],
      },
    });

    const rig = buildTabletop(showdownSnap);
    const caoCards = rig.root.getObjectByName('RivalCards-cao')!;
    expect(caoCards.children).toHaveLength(2);
    const caoFaceTex = (
      (caoCards.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial[]
    )[2]!.map!;
    const caoFaceDispose = vi.spyOn(caoFaceTex, 'dispose');

    const caoBubble = rig.root.getObjectByName('SeatBubble-cao') as THREE.Sprite;
    expect(caoBubble).toBeDefined();
    const bubbleMapDispose = vi.spyOn(caoBubble.material.map!, 'dispose');
    const bubbleMatDispose = vi.spyOn(caoBubble.material, 'dispose');

    // Enter between-hands snapshot: reveal meshes and bubble must be removed and disposed
    const betweenHandsSnap = makeLiveSnapshot({
      pot: 0,
      heroCards: [],
      board: [],
      live: {
        handNumber: 1,
        timelineLength: 0,
        dealerSeatId: null,
        street: null,
        potChips: emptyChips(),
        seats: makeDefaultSeats(),
        payoutTransfers: [],
      },
    });
    rig.updateSpot(betweenHandsSnap);

    expect(caoFaceDispose).toHaveBeenCalledOnce();
    expect(bubbleMapDispose).toHaveBeenCalledOnce();
    expect(bubbleMatDispose).toHaveBeenCalledOnce();
    expect(caoCards.children).toHaveLength(0);
    expect(rig.root.getObjectByName('SeatBubble-cao')).toBeUndefined();
  });

  it('keeps the Drill pot completely unoccluded in Arrival, Decision, and Review and action bubbles readable at 390x844', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const THREE = await import('three');
    const { buildTabletop, SEAT_LAYOUTS, TABLETOP_METRICS } = await import(
      '../../../src/ui/drill3d/scene/buildTabletop'
    );
    const { CAMERA_PRESETS } = await import('../../../src/ui/drill3d/scene/sceneController');

    const rig = buildTabletop(DEMO_SPOT);
    rig.root.updateMatrixWorld(true);
    const heroCards = rig.root.getObjectByName('HeroCards')!;
    const raycaster = new THREE.Raycaster();

    const makeCamera = (phase: 'arrival' | 'decision' | 'review', w: number, h: number) => {
      const preset = CAMERA_PRESETS[phase];
      const aspect = w / h;
      const minHRad = THREE.MathUtils.degToRad(preset.minHFov);
      const vDeg = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(minHRad / 2) / aspect));
      const fov = Math.min(60, Math.max(preset.baseFov, vDeg));
      const cam = new THREE.PerspectiveCamera(fov, aspect, 0.1, 32);
      cam.position.set(preset.position[0], preset.position[1], preset.position[2]);
      cam.lookAt(preset.target[0], preset.target[1], preset.target[2]);
      cam.updateMatrixWorld(true);
      cam.updateProjectionMatrix();
      return cam;
    };

    // Sample 96 surface points across the 2-column Drill Pot 150 pile across all 3 cameras
    for (const phase of ['arrival', 'decision', 'review'] as const) {
      const cam = makeCamera(phase, 892, 670);
      let occluded = 0;
      for (const cx of [-0.08, 0.08]) {
        for (const y of [0.005, 0.015, 0.022]) {
          for (let a = 0; a < 16; a += 1) {
            const theta = (a / 16) * Math.PI * 2;
            const pt = new THREE.Vector3(
              TABLETOP_METRICS.potPos.x + cx + Math.cos(theta) * 0.072,
              y,
              TABLETOP_METRICS.potPos.z + Math.sin(theta) * 0.072,
            );
            const dir = pt.clone().sub(cam.position);
            const dist = dir.length();
            raycaster.set(cam.position, dir.normalize());
            const hits = raycaster.intersectObjects(heroCards.children, true);
            if (hits.some((h) => h.distance < dist - 0.001)) {
              occluded += 1;
            }
          }
        }
      }
      expect(occluded).toBe(0);
    }

    // Mobile 390x844 (364x310 canvas) live decision camera: every seat action bubble cap height >= 9 CSS px
    const mobileW = 364;
    const mobileH = 310;
    const mobileCam = makeCamera('decision', mobileW, mobileH);
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(mobileCam.quaternion);
    const projectY = (v: THREE.Vector3) => (-v.clone().project(mobileCam).y * 0.5 + 0.5) * mobileH;

    for (const seatId of ALL_SEAT_IDS) {
      const pos = SEAT_LAYOUTS[seatId].bubblePos;
      const center = new THREE.Vector3(pos[0], pos[1], pos[2]);
      const halfH = TABLETOP_METRICS.bubbleScale.y / 2;
      const topY = projectY(center.clone().addScaledVector(camUp, halfH));
      const botY = projectY(center.clone().addScaledVector(camUp, -halfH));
      const spriteCssPx = Math.abs(botY - topY);
      const capHeightNormalPx =
        spriteCssPx * ((ACTION_BUBBLE_CANVAS.fontSizeNormal * 0.72) / ACTION_BUBBLE_CANVAS.height);
      const capHeightLongPx =
        spriteCssPx * ((ACTION_BUBBLE_CANVAS.fontSizeLong * 0.72) / ACTION_BUBBLE_CANVAS.height);
      expect(capHeightNormalPx).toBeGreaterThanOrEqual(9);
      expect(capHeightLongPx).toBeGreaterThanOrEqual(9);
    }
  });
});
