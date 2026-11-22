import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_SPOT, type LiveSceneDetails, type SceneTableSnapshot } from '../../../src/ui/drill3d/contract';
import { DrillScene } from '../../../src/ui/drill3d/scene/DrillScene';
import { FallbackScene } from '../../../src/ui/drill3d/scene/FallbackScene';
import {
  getCharacterPoseKey,
  getLiveCharacterPose,
  getSceneVisualKey,
  isHeroDecisionTurn,
  planSceneMotion,
  type SceneMotionState,
} from '../../../src/ui/drill3d/scene/motion';
import {
  ALL_SCENE_RIVALS,
  getEffectiveHighlight,
  getLiveStreetLabel,
  getOccupiedRivals,
  isLiveSnapshot,
  isRivalCardsVisible,
  shouldShowOuts,
  shouldShowRiverPlaceholder,
} from '../../../src/ui/drill3d/scene/snapshot';

function makeLiveSpot(
  overrides: Partial<Omit<SceneTableSnapshot, 'live'>> & {
    readonly live?: Partial<LiveSceneDetails>;
  } = {},
): SceneTableSnapshot {
  const { live, ...rest } = overrides;
  return {
    pot: 55,
    call: 35,
    heroCards: ['A♥', 'J♠'],
    board: ['K♥', '8♦', '5♣'],
    ...rest,
    live: {
      potChips: { 5: 1, 10: 0, 50: 1, 100: 0 }, handNumber: 1, timelineLength: 0, seats: [], payoutTransfers: [],
      street: 'flop',
      occupiedRivals: ['ca', 'cao', 'nong'],
      activeRival: 'ca',
      activePlayerName: 'Cá',
      ...live,
    },
  };
}

function makeMotionState(
  overrides: Partial<SceneMotionState> = {},
): SceneMotionState {
  return {
    phase: 'decision',
    highlight: null,
    spot: makeLiveSpot(),
    reducedMotion: false,
    ...overrides,
  };
}

describe('drill3d scene snapshot helpers', () => {
  it('distinguishes Drill vs Live snapshots and occupied rivals', () => {
    expect(isLiveSnapshot(DEMO_SPOT)).toBe(false);
    expect(getOccupiedRivals(DEMO_SPOT)).toEqual(ALL_SCENE_RIVALS);

    const liveSubset = makeLiveSpot({ live: { occupiedRivals: ['ca', 'nong'] } });
    expect(isLiveSnapshot(liveSubset)).toBe(true);
    expect(getOccupiedRivals(liveSubset)).toEqual(['ca', 'nong']);

    const liveEmpty = makeLiveSpot({ live: { occupiedRivals: [] } });
    expect(getOccupiedRivals(liveEmpty)).toEqual([]);
  });

  it('formats live street labels including between-hands idle state', () => {
    expect(getLiveStreetLabel('preflop')).toBe('Preflop');
    expect(getLiveStreetLabel('flop')).toBe('Flop');
    expect(getLiveStreetLabel('turn')).toBe('Turn');
    expect(getLiveStreetLabel('river')).toBe('River');
    expect(getLiveStreetLabel(null)).toBe('Chờ ván mới');
  });

  it('shows outs highlight only in Drill mode and suppresses it in Live mode', () => {
    expect(shouldShowOuts(DEMO_SPOT, 'outs')).toBe(true);
    expect(shouldShowOuts(DEMO_SPOT, 'pot')).toBe(false);
    expect(shouldShowOuts(DEMO_SPOT, null)).toBe(false);
    expect(getEffectiveHighlight(DEMO_SPOT, 'outs')).toBe('outs');

    const live = makeLiveSpot();
    expect(shouldShowOuts(live, 'outs')).toBe(false);
    expect(getEffectiveHighlight(live, 'outs')).toBeNull();
    expect(getEffectiveHighlight(live, 'pot')).toBe('pot');
    expect(getEffectiveHighlight(live, 'call')).toBe('call');
  });

  it('controls River "?" placeholder across 0 / 3 / 4 / 5 board cards so River replaces "?"', () => {
    // Drill mode (4-card Turn shows "?", 5-card board hides "?")
    expect(shouldShowRiverPlaceholder(DEMO_SPOT)).toBe(true);
    expect(
      shouldShowRiverPlaceholder({
        ...DEMO_SPOT,
        board: ['K♥', '8♥', '5♣', '2♠', '9♦'],
      }),
    ).toBe(false);

    // Live mode: 0 cards (preflop / idle) -> no placeholder
    expect(
      shouldShowRiverPlaceholder(makeLiveSpot({ board: [], live: { street: 'preflop' } })),
    ).toBe(false);
    expect(
      shouldShowRiverPlaceholder(makeLiveSpot({ board: [], live: { street: null } })),
    ).toBe(false);

    // Live mode: 3 cards (flop) -> no placeholder
    expect(
      shouldShowRiverPlaceholder(
        makeLiveSpot({ board: ['K♥', '8♦', '5♣'], live: { street: 'flop' } }),
      ),
    ).toBe(false);

    // Live mode: 4 cards on Turn -> shows "?" River placeholder
    expect(
      shouldShowRiverPlaceholder(
        makeLiveSpot({ board: ['K♥', '8♦', '5♣', '2♠'], live: { street: 'turn' } }),
      ),
    ).toBe(true);

    // Live mode: 4 cards when hand is idle (street: null) -> no placeholder
    expect(
      shouldShowRiverPlaceholder(
        makeLiveSpot({ board: ['K♥', '8♦', '5♣', '2♠'], live: { street: null } }),
      ),
    ).toBe(false);

    // Live mode: 5 cards on River -> River card replaces "?" placeholder
    expect(
      shouldShowRiverPlaceholder(
        makeLiveSpot({
          board: ['K♥', '8♦', '5♣', '2♠', '9♥'],
          live: { street: 'river' },
        }),
      ),
    ).toBe(false);
  });

  it('shows face-down rival cards only for occupied rivals during active live hands', () => {
    for (const rival of ALL_SCENE_RIVALS) {
      expect(isRivalCardsVisible(DEMO_SPOT, rival)).toBe(true);
    }

    const activeLive = makeLiveSpot({
      live: { street: 'turn', occupiedRivals: ['ca', 'nong'] },
    });
    expect(isRivalCardsVisible(activeLive, 'ca')).toBe(true);
    expect(isRivalCardsVisible(activeLive, 'cao')).toBe(false);
    expect(isRivalCardsVisible(activeLive, 'nong')).toBe(true);

    const betweenHands = makeLiveSpot({
      board: [],
      heroCards: [],
      live: { street: null, occupiedRivals: ['ca', 'cao', 'nong'], activeRival: null, activePlayerName: null },
    });
    for (const rival of ALL_SCENE_RIVALS) {
      expect(isRivalCardsVisible(betweenHands, rival)).toBe(false);
    }
  });
});

describe('drill3d pure scene motion and on-demand render planner', () => {
  it('identifies Hero decision turn accurately', () => {
    expect(isHeroDecisionTurn(DEMO_SPOT)).toBe(false);
    expect(
      isHeroDecisionTurn(makeLiveSpot({ live: { activeRival: 'ca', activePlayerName: 'Cá' } })),
    ).toBe(false);
    expect(
      isHeroDecisionTurn(makeLiveSpot({ live: { activeRival: null, activePlayerName: null } })),
    ).toBe(false);
    expect(
      isHeroDecisionTurn(makeLiveSpot({ live: { activeRival: null, activePlayerName: 'Hero' } })),
    ).toBe(true);
  });

  it('animates pose only when public activeRival or street changes during rival turns', () => {
    const caFlop = makeMotionState({
      spot: makeLiveSpot({ live: { street: 'flop', activeRival: 'ca', activePlayerName: 'Cá' } }),
    });
    const caoFlop = makeMotionState({
      spot: makeLiveSpot({ live: { street: 'flop', activeRival: 'cao', activePlayerName: 'Cáo' } }),
    });
    const caTurn = makeMotionState({
      spot: makeLiveSpot({
        board: ['K♥', '8♦', '5♣', '2♠'],
        live: { street: 'turn', activeRival: 'ca', activePlayerName: 'Cá' },
      }),
    });

    const rivalSwitch = planSceneMotion(caFlop, caoFlop);
    expect(rivalSwitch.kind).toBe('animate-pose');
    expect(rivalSwitch.shouldAnimate).toBe(true);
    expect(rivalSwitch.cameraChanges).toBe(false);
    expect(rivalSwitch.poseChanges).toBe(true);
    expect(rivalSwitch.needsRender).toBe(true);

    const streetAdvance = planSceneMotion(caFlop, caTurn);
    expect(streetAdvance.kind).toBe('animate-pose');
    expect(streetAdvance.shouldAnimate).toBe(true);
    expect(streetAdvance.cameraChanges).toBe(false);
    expect(streetAdvance.poseChanges).toBe(true);
    expect(streetAdvance.needsRender).toBe(true);
  });

  it('keeps camera and characters still while Hero is deciding and skips redundant renders', () => {
    const nongFlop = makeMotionState({
      spot: makeLiveSpot({ live: { street: 'flop', activeRival: 'nong', activePlayerName: 'Nóng' } }),
    });
    const heroFlop = makeMotionState({
      spot: makeLiveSpot({ live: { street: 'flop', activeRival: null, activePlayerName: 'Hero' } }),
    });
    const heroFlopClone = makeMotionState({
      spot: makeLiveSpot({ live: { street: 'flop', activeRival: null, activePlayerName: 'Hero' } }),
    });
    const heroTurn = makeMotionState({
      spot: makeLiveSpot({
        board: ['K♥', '8♦', '5♣', '2♠'],
        pot: 90,
        call: 0,
        live: { street: 'turn', activeRival: null, activePlayerName: 'Hero' },
      }),
    });

    // Entering Hero decision snaps immediately (no running animation during decision)
    const enterHero = planSceneMotion(nongFlop, heroFlop);
    expect(enterHero.kind).toBe('snap');
    expect(enterHero.shouldAnimate).toBe(false);
    expect(enterHero.cameraChanges).toBe(false);
    expect(enterHero.needsRender).toBe(true);

    // Identical snapshot during Hero decision skips rendering entirely (on-demand)
    const unchangedHero = planSceneMotion(heroFlop, heroFlopClone);
    expect(unchangedHero.kind).toBe('none');
    expect(unchangedHero.shouldAnimate).toBe(false);
    expect(unchangedHero.cameraChanges).toBe(false);
    expect(unchangedHero.poseChanges).toBe(false);
    expect(unchangedHero.needsRender).toBe(false);
    expect(getSceneVisualKey(heroFlop)).toBe(getSceneVisualKey(heroFlopClone));

    // Board/pot/street update while Hero remains deciding keeps camera and characters still
    const heroNextStreet = planSceneMotion(heroFlop, heroTurn);
    expect(heroNextStreet.kind).toBe('none');
    expect(heroNextStreet.shouldAnimate).toBe(false);
    expect(heroNextStreet.cameraChanges).toBe(false);
    expect(heroNextStreet.poseChanges).toBe(false);
    expect(heroNextStreet.needsRender).toBe(true);

    // Character pose while Hero decides has zero lean and does not depend on street
    const poseFlop = getLiveCharacterPose(null, true, 'flop');
    const poseRiver = getLiveCharacterPose(null, true, 'river');
    expect(poseFlop).toEqual(poseRiver);
    expect(poseFlop.caLean).toBe(0);
    expect(poseFlop.caoLean).toBe(0);
    expect(poseFlop.nongLean).toBe(0);
  });

  it('disables all animation and live character motion when reducedMotion is enabled', () => {
    const caReduced = makeMotionState({
      reducedMotion: true,
      spot: makeLiveSpot({ live: { street: 'flop', activeRival: 'ca', activePlayerName: 'Cá' } }),
    });
    const caoReduced = makeMotionState({
      reducedMotion: true,
      spot: makeLiveSpot({ live: { street: 'flop', activeRival: 'cao', activePlayerName: 'Cáo' } }),
    });

    expect(getCharacterPoseKey(caReduced)).toBe('live:reduced-neutral');
    expect(getCharacterPoseKey(caoReduced)).toBe('live:reduced-neutral');

    const turnSwitchReduced = planSceneMotion(caReduced, caoReduced);
    expect(turnSwitchReduced.kind).toBe('none');
    expect(turnSwitchReduced.shouldAnimate).toBe(false);
    expect(turnSwitchReduced.poseChanges).toBe(false);
    expect(turnSwitchReduced.needsRender).toBe(true);

    // Turning reducedMotion on mid-transition snaps immediately and stops rAF
    const caNormal = makeMotionState({
      reducedMotion: false,
      spot: makeLiveSpot({ live: { street: 'flop', activeRival: 'ca', activePlayerName: 'Cá' } }),
    });
    const enabledMidTurn = planSceneMotion(caNormal, caReduced, true);
    expect(enabledMidTurn.kind).toBe('snap');
    expect(enabledMidTurn.shouldAnimate).toBe(false);
    expect(enabledMidTurn.needsRender).toBe(true);

    // Drill phase changes also snap with no animation under reducedMotion
    const drillDecision: SceneMotionState = {
      phase: 'decision',
      highlight: null,
      spot: DEMO_SPOT,
      reducedMotion: true,
    };
    const drillReview: SceneMotionState = {
      phase: 'review',
      highlight: 'pot',
      spot: DEMO_SPOT,
      reducedMotion: true,
    };
    const drillSnap = planSceneMotion(drillDecision, drillReview);
    expect(drillSnap.kind).toBe('snap');
    expect(drillSnap.shouldAnimate).toBe(false);
    expect(drillSnap.cameraChanges).toBe(true);
  });

  it('preserves Drill 3D camera cuts and transitions', () => {
    const arrival: SceneMotionState = {
      phase: 'arrival',
      highlight: null,
      spot: DEMO_SPOT,
      reducedMotion: false,
    };
    const decision: SceneMotionState = {
      phase: 'decision',
      highlight: null,
      spot: DEMO_SPOT,
      reducedMotion: false,
    };
    const review: SceneMotionState = {
      phase: 'review',
      highlight: 'outs',
      spot: DEMO_SPOT,
      reducedMotion: false,
    };

    // Entering decision cuts immediately so camera never competes with timer
    expect(planSceneMotion(arrival, decision)).toMatchObject({
      kind: 'snap',
      shouldAnimate: false,
      cameraChanges: true,
    });
    // Entering review animates smoothly
    expect(planSceneMotion(decision, review)).toMatchObject({
      kind: 'animate-phase',
      shouldAnimate: true,
      cameraChanges: true,
    });
    // Highlight-only update renders once on demand without animation
    expect(planSceneMotion(review, { ...review, highlight: 'pot' })).toMatchObject({
      kind: 'none',
      shouldAnimate: false,
      needsRender: true,
    });
    // Identical state needs no render
    expect(planSceneMotion(review, { ...review })).toMatchObject({
      kind: 'none',
      shouldAnimate: false,
      needsRender: false,
    });
  });
});

describe('FallbackScene and DrillScene rendering parity', () => {
  beforeEach(() => {
    vi.spyOn(globalThis.performance, 'now').mockReturnValue(0);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('omits Drill wall-print frames behind characters in Live fallback while keeping Drill unchanged', () => {
    const drillFallbackHtml = renderToStaticMarkup(
      createElement(FallbackScene, {
        phase: 'decision',
        highlight: null,
        spot: DEMO_SPOT,
        reducedMotion: false,
      }),
    );
    expect(drillFallbackHtml).toContain('data-wall-prints="drill"');

    const liveFallbackHtml = renderToStaticMarkup(
      createElement(FallbackScene, {
        phase: 'decision',
        highlight: null,
        spot: makeLiveSpot(),
        reducedMotion: false,
      }),
    );
    expect(liveFallbackHtml).not.toContain('data-wall-prints="drill"');
    // No decorative framed wall rects at y=34 / y=26 behind Cá, Cáo, Nóng heads
    expect(liveFallbackHtml).not.toContain('x="92" y="34"');
    expect(liveFallbackHtml).not.toContain('x="297" y="26"');
    expect(liveFallbackHtml).not.toContain('x="502" y="34"');
  });

  it('renders 0 / 3 / 4 / 5 board cards in Live mode and replaces "?" on River', () => {
    const preflopHtml = renderToStaticMarkup(
      createElement(FallbackScene, {
        phase: 'decision',
        highlight: null,
        spot: makeLiveSpot({ board: [], live: { street: 'preflop' } }),
      }),
    );
    expect(preflopHtml).not.toContain('>?</text>');

    const flopHtml = renderToStaticMarkup(
      createElement(FallbackScene, {
        phase: 'decision',
        highlight: null,
        spot: makeLiveSpot({ board: ['K♥', '8♦', '5♣'], live: { street: 'flop' } }),
      }),
    );
    expect(flopHtml).toContain('>K</text>');
    expect(flopHtml).toContain('>8</text>');
    expect(flopHtml).toContain('>5</text>');
    expect(flopHtml).not.toContain('>?</text>');

    const turnHtml = renderToStaticMarkup(
      createElement(FallbackScene, {
        phase: 'decision',
        highlight: null,
        spot: makeLiveSpot({ board: ['K♥', '8♦', '5♣', '2♠'], live: { street: 'turn' } }),
      }),
    );
    expect(turnHtml).toContain('translate(182, 0)');
    expect(turnHtml).toContain('>?</text>');

    const riverSpot = makeLiveSpot({
      board: ['K♥', '8♦', '5♣', '2♠', 'Q♣'],
      live: { street: 'river' },
    });
    const riverFallbackHtml = renderToStaticMarkup(
      createElement(FallbackScene, {
        phase: 'decision',
        highlight: null,
        spot: riverSpot,
      }),
    );
    expect(riverFallbackHtml).toContain('translate(182, 0)');
    expect(riverFallbackHtml).toContain('>Q</text>');
    expect(riverFallbackHtml).not.toContain('>?</text>');

    const riverSceneHtml = renderToStaticMarkup(
      createElement(DrillScene, {
        phase: 'decision',
        highlight: 'outs',
        spot: riverSpot,
        reducedMotion: false,
      }),
    );
    expect(riverSceneHtml).toContain('Q');
    expect(riverSceneHtml).not.toContain('drill3d-card--river-slot');
    expect(riverSceneHtml).not.toContain('drill3d-outs-tray');
  });

  it('keeps rival cards strictly face-down in Live fallback and respects reducedMotion', () => {
    const liveCaActive = makeLiveSpot({
      board: [],
      heroCards: ['A♥', 'K♥'],
      live: {
        street: 'preflop',
        occupiedRivals: ['ca', 'nong'],
        activeRival: 'ca',
        activePlayerName: 'Cá',
      },
    });

    const motionHtml = renderToStaticMarkup(
      createElement(FallbackScene, {
        phase: 'decision',
        highlight: null,
        spot: liveCaActive,
        reducedMotion: false,
      }),
    );
    // Cá leans slightly forward when active and reducedMotion is false
    expect(motionHtml).toContain('translate(138, 141)');
    // Occupied rivals (Cá & Nóng) have face-down card backs; unoccupied Cáo does not
    expect(motionHtml).toContain('x="138" y="214"');
    expect(motionHtml).toContain('x="470" y="218"');
    expect(motionHtml).not.toContain('x="302" y="182"');

    const reducedHtml = renderToStaticMarkup(
      createElement(FallbackScene, {
        phase: 'decision',
        highlight: null,
        spot: liveCaActive,
        reducedMotion: true,
      }),
    );
    // Zero lean displacement when reducedMotion is enabled
    expect(reducedHtml).toContain('translate(132, 134)');
    expect(reducedHtml).not.toContain('translate(138, 141)');

    // Between hands: all rival face-down cards are hidden
    const idleHtml = renderToStaticMarkup(
      createElement(FallbackScene, {
        phase: 'decision',
        highlight: null,
        spot: makeLiveSpot({
          board: [],
          heroCards: [],
          live: { street: null, occupiedRivals: ['ca', 'cao', 'nong'], activeRival: null, activePlayerName: null },
        }),
      }),
    );
    expect(idleHtml).not.toContain('x="138" y="214"');
    expect(idleHtml).not.toContain('x="302" y="182"');
    expect(idleHtml).not.toContain('x="470" y="218"');
  });
});
