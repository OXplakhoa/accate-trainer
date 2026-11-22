import type * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyChips, type ChipCounts } from '../../../src/engine';
import {
  DEMO_SPOT,
  type LiveSceneDetails,
  type SceneTableSnapshot,
} from '../../../src/ui/drill3d/contract';
import { formatSeatActionBubble } from '../../../src/ui/drill3d/scene/actionBubble';
import { getSceneVisualKey, type SceneMotionState } from '../../../src/ui/drill3d/scene/motion';
import {
  getLiveEventKey,
  getPlanDurationMs,
  planTableAnimations,
  TABLE_ANIMATION_DURATIONS,
} from '../../../src/ui/drill3d/scene/tableMotion';
import { toLiveSceneSnapshot } from '../../../src/ui/liveSandbox3d/snapshot';
import {
  createSandboxSession,
  enterHandBoundary,
  performHeroAction,
  startNextHand,
  stepOneBotTurn,
} from '../../../src/ui/sandbox/controller';
import { buildSandboxTableView } from '../../../src/ui/sandbox/tableView';
import type { PublicTableSeat, TableSeatId } from '../../../src/ui/sandbox/types';

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
      pot: 20,
      live: {
        timelineLength: 4,
        seats: [
          makeSeat('hero'),
          makeSeat('ca', { streetChips: makeChips({ 10: 1 }), isActor: true }),
          makeSeat('cao'),
          makeSeat('nong'),
        ],
      },
    });
    const afterRaise = makeLiveSnapshot({
      pot: 45,
      live: {
        timelineLength: 5,
        potChips: makeChips({ 5: 5, 10: 2 }),
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
      live: {
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
