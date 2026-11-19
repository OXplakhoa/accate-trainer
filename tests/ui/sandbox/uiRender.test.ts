import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRivalSeatMetadata, parseCard } from '../../../src/engine';
import {
  createSandboxSession,
  getHeroActionValidation,
  HERO_PLAYER_ID,
  performHeroAction,
  SandboxApp,
  stageChip,
} from '../../../src/ui/sandbox';
import { HandReviewModal } from '../../../src/ui/sandbox/components/HandReviewModal';
import { HeroControls } from '../../../src/ui/sandbox/components/HeroControls';
import { TableSeat } from '../../../src/ui/sandbox/components/TableSeat';

describe('P4 Sandbox UI Rendering — B3, B5, C2, P5 Tournament Slots & Review', () => {
  // React 19's react-dom/server calls performance.now() internally during renderToStaticMarkup.
  // Provide a deterministic constant 0 only for UI render tests and restore immediately after.
  beforeEach(() => {
    vi.spyOn(globalThis.performance, 'now').mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('B3 & P5: SandboxApp renders all rival styles, pot/board, deal state attribute, and optional timerSlot', () => {
    const html = renderToStaticMarkup(
      createElement(SandboxApp, {
        initialSeed: 'ui-render-seed-1',
        initialSettings: {
          playerCount: 6,
          enabledRivalIds: ['da', 'ca', 'cao', 'soi', 'dien'],
        },
        mode: 'sandbox',
        timerSlot: createElement('div', { className: 'test-timer' }, '20s'),
        storage: null,
      }),
    );

    // Always displays rival playing style labels (B3)
    expect(html).toContain('Tight-passive (nit)');
    expect(html).toContain('Loose-passive (calling station)');
    expect(html).toContain('Tight-aggressive (TAG)');
    expect(html).toContain('Loose-aggressive (LAG)');
    expect(html).toContain('Maniac');

    // Exposes observable deal state and dedicated Tournament timer slot
    expect(html).toContain('data-deal-state=');
    expect(html).toContain('data-slot="tournament-timer"');
    expect(html).toContain('20s');
    expect(html).toContain('Đổi chip');
    expect(html).toContain('Sổ phiên');
    expect(html).toContain('Cài đặt');
  });

  it('B5: TableSeat visibly transforms Nóng avatar & badge when tilted', () => {
    const normalMeta = getRivalSeatMetadata('nong', {
      isTilted: false,
      handsRemaining: 0,
      totalTiltDuration: 0,
      triggerReason: null,
    });
    const tiltedMeta = getRivalSeatMetadata('nong', {
      isTilted: true,
      handsRemaining: 3,
      totalTiltDuration: 4,
      triggerReason: 'big-pot-loss',
    });

    const normalHtml = renderToStaticMarkup(
      createElement(TableSeat, {
        seatIndex: 1,
        playerId: 'nong',
        displayName: 'Nóng',
        isHero: false,
        rivalMetadata: normalMeta,
        stack: { 5: 10, 10: 10, 50: 5, 100: 1 },
        cardsRevealed: false,
        isActiveTurn: false,
        isDealer: false,
        isOpener: false,
        declaration: null,
        isBetweenHands: false,
        terminology: 'en-standard',
      }),
    );

    const tiltedHtml = renderToStaticMarkup(
      createElement(TableSeat, {
        seatIndex: 1,
        playerId: 'nong',
        displayName: 'Nóng',
        isHero: false,
        rivalMetadata: tiltedMeta,
        stack: { 5: 10, 10: 10, 50: 5, 100: 1 },
        cardsRevealed: false,
        isActiveTurn: false,
        isDealer: false,
        isOpener: false,
        declaration: null,
        isBetweenHands: false,
        terminology: 'en-standard',
      }),
    );

    expect(normalHtml).toContain('data-tilted="false"');
    expect(normalHtml).toContain('data-avatar-mood="normal"');
    expect(tiltedHtml).toContain('data-tilted="true"');
    expect(tiltedHtml).toContain('data-avatar-mood="tilted"');
    expect(tiltedHtml).toContain('Đang tilt (còn 3 ván)');
  });

  it('C2: HeroControls disables Bet button when staged chip total is invalid (0 or > cap) and enables when valid', () => {
    const base = createSandboxSession({
      seed: 'ui-c2-hero-controls',
      settings: { playerCount: 4, allowOutOfTurn: false },
      fixtures: { openerId: HERO_PLAYER_ID },
    });
    const heroSeat = base.hand!.seats.find((s) => s.playerId === HERO_PLAYER_ID)!;

    // 0 staged -> Bet button is disabled
    const htmlDisabled = renderToStaticMarkup(
      createElement(HeroControls, {
        heroCards: heroSeat.holeCards,
        availableStack: heroSeat.stack,
        stagedChips: base.stagedChips,
        validation: getHeroActionValidation(base),
        potValue: 20,
        streetCap: 50,
        terminology: 'en-standard',
        pendingHeroLeave: false,
        isAwaitingPayout: false,
        isHandComplete: false,
        canPracticeSpot: false,
        onStageChip: () => undefined,
        onUnstageChip: () => undefined,
        onUndoLastChip: () => undefined,
        onClearStaged: () => undefined,
        onAction: () => undefined,
        onDeclareOutOfTurn: () => undefined,
        onOpenExchange: () => undefined,
        onRequestLeave: () => undefined,
      }),
    );
    expect(htmlDisabled).toMatch(/disabled=""[^>]*data-action-btn="bet"/);

    // Stage 20 -> Bet 20 enabled
    const s20 = stageChip(stageChip(base, 10), 10);
    const htmlEnabled = renderToStaticMarkup(
      createElement(HeroControls, {
        heroCards: heroSeat.holeCards,
        availableStack: heroSeat.stack,
        stagedChips: s20.stagedChips,
        validation: getHeroActionValidation(s20),
        potValue: 20,
        streetCap: 50,
        terminology: 'en-standard',
        pendingHeroLeave: false,
        isAwaitingPayout: false,
        isHandComplete: false,
        canPracticeSpot: false,
        onStageChip: () => undefined,
        onUnstageChip: () => undefined,
        onUndoLastChip: () => undefined,
        onClearStaged: () => undefined,
        onAction: () => undefined,
        onDeclareOutOfTurn: () => undefined,
        onOpenExchange: () => undefined,
        onRequestLeave: () => undefined,
      }),
    );
    expect(htmlEnabled).toContain('Bet 20');
    expect(htmlEnabled).not.toMatch(/disabled=""[^>]*data-action-btn="bet"/);
  });

  it('HandReviewModal renders decision quality, pot odds, EV, assumptions, and outcome separation banner', () => {
    let s = createSandboxSession({
      seed: 'ui-review-modal-seed',
      settings: { playerCount: 4, allowOutOfTurn: false },
      fixtures: { openerId: HERO_PLAYER_ID },
    });
    s = performHeroAction(s, 'fold');

    // Use a completed hand review
    const reviewHtml = renderToStaticMarkup(
      createElement(HandReviewModal, {
        review: {
          handNumber: 1,
          outcomeKind: 'showdown',
          heroNetDelta: -135,
          heroPayout: 0,
          heroInvested: 135,
          outcomeBannerVi:
            'Kết quả ván: Thua (-135 điểm) — không ảnh hưởng điểm quyết định (chấm theo thông tin tại thời điểm quyết định).',
          decisions: [
            {
              record: {
                decisionIndex: 0,
                street: 'flop',
                snapshot: {
                  heroId: HERO_PLAYER_ID,
                  heroCards: [parseCard('Js'), parseCard('Jd')],
                  board: [parseCard('9h'), parseCard('7h'), parseCard('2c')],
                  street: 'flop',
                  potBeforeCall: 70,
                  heroStack: 495,
                  heroStreetContribution: 0,
                  heroTotalContribution: 5,
                  currentBet: 30,
                  streetCap: 50,
                  remainingCapAllowance: 50,
                  toCall: 30,
                  callAmount: 30,
                  isCallAllIn: false,
                  activeOpponentCount: 2,
                  actingOpponentCount: 2,
                  position: { label: 'Nói sau 2 người' },
                  potSlices: [],
                  legalActions: null,
                },
                handStateAtDecision: s.hand!,
                chosenAction: { type: 'call', chips: { 5: 0, 10: 3, 50: 0, 100: 0 } },
                fromOutOfTurn: false,
                potOdds: {
                  hasCall: true,
                  potBeforeCall: 70,
                  callAmount: 30,
                  potAfterCall: 100,
                  requiredEquity: 0.3,
                  requiredEquityPercent: 30,
                  potToCallRatio: 70 / 30,
                  oddsAgainst: 70 / 30,
                  potToCallLabel: '2.33-to-1',
                },
                activeOpponentIds: ['dien', 'ca'],
                timelineLengthAtDecision: 5,
              },
              estimatedEquity: 0.54,
              equitySamples: 450,
              equitySeed: 'test-seed',
              chosenActionLabel: 'Call 30',
              chosenEv: 24,
              chosenEvPrecision: 'exact',
              bestAlternativeLabel: 'Call 30',
              bestAlternativeEv: 24,
              evDiff: 0,
              qualityLabel: 'Tốt',
              qualityTone: 'good',
              explanationVi: 'Cần 30,0% để hòa vốn; equity ước lượng 54,0%.',
              assumptionsVi: ['Street: Flop · Cap street: 50 điểm.'],
              rangeSummariesVi: ['Điên có range rộng gồm draw và bluff.'],
            },
          ],
          timeline: s.hand!.timeline,
          showdownResolution: null,
          foldWinnerId: null,
          foldWinPotAmount: 0,
        },
        seatProfiles: s.seatProfiles,
        terminology: 'en-standard',
        onPracticeSpot: () => undefined,
        onClose: () => undefined,
      }),
    );

    expect(reviewHtml).toContain('không ảnh hưởng điểm quyết định');
    expect(reviewHtml).toContain('30,0% (2.33-to-1)');
    expect(reviewHtml).toContain('54,0%');
    expect(reviewHtml).toContain('+24,0 điểm');
    expect(reviewHtml).toContain('Tốt');
    expect(reviewHtml).toContain('Luyện spot này trong Drill');
  });
});
