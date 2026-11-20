import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRivalSeatMetadata, parseCard, RIVAL_IDS } from '../../../src/engine';
import {
  cashOutPlayerAtBoundary,
  createSandboxSession,
  enterHandBoundary,
  getHeroActionValidation,
  HERO_PLAYER_ID,
  performHeroAction,
  SandboxApp,
  stageChip,
  stepOneBotTurn,
} from '../../../src/ui/sandbox';
import { BoundaryPanel } from '../../../src/ui/sandbox/components/BoundaryPanel';
import { HandReviewModal } from '../../../src/ui/sandbox/components/HandReviewModal';
import { HeroControls } from '../../../src/ui/sandbox/components/HeroControls';
import { TableSeat } from '../../../src/ui/sandbox/components/TableSeat';
import {
  syncDealAnimationLifecycle,
  type DealAnimState,
  type PendingDealDescriptor,
} from '../../../src/ui/sandbox/dealAnimation';
import type { DealAnimationEndInfo } from '../../../src/ui/sandbox/types';

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
    expect(html).toContain('data-deal-state="animating"');
    expect(html).toContain('data-slot="tournament-timer"');
    expect(html).toContain('20s');
    expect(html).toContain('Đổi chip');
    expect(html).toContain('Sổ phiên');
    expect(html).toContain('Cài đặt');

    // Reduced motion renders deal state immediately as ready
    const reducedHtml = renderToStaticMarkup(
      createElement(SandboxApp, {
        initialSeed: 'ui-render-seed-1',
        initialSettings: {
          playerCount: 4,
          reducedMotion: true,
        },
        mode: 'sandbox',
        storage: null,
      }),
    );
    expect(reducedHtml).toContain('data-deal-state="ready"');
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

  it('HeroControls disables "Rời bàn" button when Hero is spectating (not seated) and enables when seated', () => {
    const base = createSandboxSession({
      seed: 'ui-leave-spectator-check',
      settings: { playerCount: 4, allowOutOfTurn: false },
      fixtures: { openerId: HERO_PLAYER_ID },
    });
    const heroSeat = base.hand!.seats.find((s) => s.playerId === HERO_PLAYER_ID)!;

    const seatedHtml = renderToStaticMarkup(
      createElement(HeroControls, {
        heroCards: heroSeat.holeCards,
        availableStack: heroSeat.stack,
        stagedChips: base.stagedChips,
        validation: getHeroActionValidation(base),
        potValue: 20,
        streetCap: 50,
        terminology: 'en-standard',
        isHeroSeated: true,
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
    expect(seatedHtml).toMatch(/<button type="button" class="sb-btn sb-btn--ghost">Rời bàn<\/button>/);

    const spectatorHtml = renderToStaticMarkup(
      createElement(HeroControls, {
        heroCards: null,
        availableStack: { 5: 0, 10: 0, 50: 0, 100: 0 },
        stagedChips: { 5: 0, 10: 0, 50: 0, 100: 0 },
        validation: {
          ...getHeroActionValidation(base),
          isHeroTurn: false,
          canDeclareOutOfTurn: false,
        },
        potValue: 20,
        streetCap: 50,
        terminology: 'en-standard',
        isHeroSeated: false,
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
    expect(spectatorHtml).toMatch(/disabled=""[^>]*>Rời bàn<\/button>/);
    expect(spectatorHtml).toContain('Bạn đang xem bàn');
  });

  it('HandReviewModal renders decision quality, pot odds, estimated Call EV vs exact Fold EV, cancelled OOT status, and gates Drill button to Hero-turn states only', () => {
    const sBeforeFold = createSandboxSession({
      seed: 'ui-review-modal-seed',
      settings: { playerCount: 4, allowOutOfTurn: false },
      fixtures: { openerId: HERO_PLAYER_ID },
    });
    const heroTurnHand = sBeforeFold.hand!;
    const sAfterFold = performHeroAction(sBeforeFold, 'fold');
    const botTurnHand = sAfterFold.hand!;

    expect(heroTurnHand.activePlayerId).toBe(HERO_PLAYER_ID);
    expect(botTurnHand.activePlayerId).not.toBe(HERO_PLAYER_ID);

    // Review with:
    // 0: normal Hero-turn Call (eligible for Drill, EV estimated by range/samples)
    // 1: executed OOT Call (NOT eligible for Drill, EV estimated by range/samples)
    // 2: cancelled OOT Bet 20 (NOT eligible for Drill, status "Hô sớm · đã hủy")
    // 3: normal Hero-turn Fold (eligible for Drill, Fold EV = 0 exact)
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
                handStateAtDecision: heroTurnHand,
                chosenAction: { type: 'call', chips: { 5: 0, 10: 3, 50: 0, 100: 0 } },
                fromOutOfTurn: false,
                executed: true,
                outOfTurnStatus: null,
                cancelReason: null,
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
              turnLabelVi: 'Đúng lượt',
              chosenEv: 24,
              chosenEvPrecision: 'estimated',
              bestAlternativeLabel: 'Call 30',
              bestAlternativeEv: 24,
              evDiff: 0,
              qualityLabel: 'Tốt',
              qualityTone: 'good',
              explanationVi: 'Cần 30,0% để hòa vốn; equity ước lượng 54,0%.',
              assumptionsVi: ['Street: Flop · Cap street: 50 điểm.'],
              rangeSummariesVi: ['Điên có range rộng gồm draw và bluff.'],
            },
            {
              record: {
                decisionIndex: 1,
                street: 'turn',
                snapshot: {
                  heroId: HERO_PLAYER_ID,
                  heroCards: [parseCard('Js'), parseCard('Jd')],
                  board: [
                    parseCard('9h'),
                    parseCard('7h'),
                    parseCard('2c'),
                    parseCard('4s'),
                  ],
                  street: 'turn',
                  potBeforeCall: 130,
                  heroStack: 465,
                  heroStreetContribution: 0,
                  heroTotalContribution: 35,
                  currentBet: 20,
                  streetCap: 50,
                  remainingCapAllowance: 50,
                  toCall: 20,
                  callAmount: 20,
                  isCallAllIn: false,
                  activeOpponentCount: 2,
                  actingOpponentCount: 2,
                  position: { label: 'Nói sau 2 người' },
                  potSlices: [],
                  legalActions: null,
                },
                handStateAtDecision: botTurnHand,
                chosenAction: { type: 'call', chips: { 5: 0, 10: 2, 50: 0, 100: 0 } },
                fromOutOfTurn: true,
                executed: true,
                outOfTurnStatus: 'executed',
                cancelReason: null,
                potOdds: {
                  hasCall: true,
                  potBeforeCall: 130,
                  callAmount: 20,
                  potAfterCall: 150,
                  requiredEquity: 20 / 150,
                  requiredEquityPercent: (20 / 150) * 100,
                  potToCallRatio: 130 / 20,
                  oddsAgainst: 130 / 20,
                  potToCallLabel: '6.50-to-1',
                },
                activeOpponentIds: ['dien', 'ca'],
                timelineLengthAtDecision: 6,
              },
              estimatedEquity: 0.62,
              equitySamples: 450,
              equitySeed: 'test-seed-oot',
              chosenActionLabel: 'Call 20 (Hô trước lượt)',
              turnLabelVi: 'Hô trước lượt',
              chosenEv: 73,
              chosenEvPrecision: 'estimated',
              bestAlternativeLabel: 'Call 20',
              bestAlternativeEv: 73,
              evDiff: 0,
              qualityLabel: 'Tốt',
              qualityTone: 'good',
              explanationVi: 'Bạn đã hô trước Call 20.',
              assumptionsVi: ['Thời điểm quyết định: Hô trước lượt.'],
              rangeSummariesVi: ['Điên có range rộng gồm draw và bluff.'],
            },
            {
              record: {
                decisionIndex: 2,
                street: 'river',
                snapshot: {
                  heroId: HERO_PLAYER_ID,
                  heroCards: [parseCard('Js'), parseCard('Jd')],
                  board: [
                    parseCard('9h'),
                    parseCard('7h'),
                    parseCard('2c'),
                    parseCard('4s'),
                    parseCard('Kd'),
                  ],
                  street: 'river',
                  potBeforeCall: 170,
                  heroStack: 445,
                  heroStreetContribution: 0,
                  heroTotalContribution: 55,
                  currentBet: 0,
                  streetCap: 50,
                  remainingCapAllowance: 50,
                  toCall: 0,
                  callAmount: 0,
                  isCallAllIn: false,
                  activeOpponentCount: 2,
                  actingOpponentCount: 2,
                  position: { label: 'Nói sau 1 người' },
                  potSlices: [],
                  legalActions: null,
                },
                handStateAtDecision: botTurnHand,
                chosenAction: { type: 'bet', amount: 20, chips: { 5: 0, 10: 2, 50: 0, 100: 0 } },
                fromOutOfTurn: true,
                executed: false,
                outOfTurnStatus: 'cancelled',
                cancelReason: 'bet-changed',
                potOdds: {
                  hasCall: false,
                  potBeforeCall: 170,
                  callAmount: 0,
                  potAfterCall: 170,
                  requiredEquity: 0,
                  requiredEquityPercent: 0,
                  potToCallRatio: 0,
                  oddsAgainst: 0,
                  potToCallLabel: '—',
                },
                activeOpponentIds: ['dien', 'ca'],
                timelineLengthAtDecision: 7,
              },
              estimatedEquity: 0.48,
              equitySamples: 450,
              equitySeed: 'test-seed-oot-cancel',
              chosenActionLabel: 'Bet 20 (Hô sớm · đã hủy)',
              turnLabelVi: 'Hô sớm · đã hủy',
              chosenEv: 18,
              chosenEvPrecision: 'estimated',
              bestAlternativeLabel: 'Check',
              bestAlternativeEv: 81.6,
              evDiff: -63.6,
              qualityLabel: 'Sai lầm',
              qualityTone: 'mistake',
              explanationVi: 'Bạn đã hô sớm Bet 20 (đã hủy, không thực hiện).',
              assumptionsVi: ['Thời điểm quyết định: Hô sớm · đã hủy (không được thực hiện).'],
              rangeSummariesVi: ['Điên có range rộng gồm draw và bluff.'],
            },
            {
              record: {
                decisionIndex: 3,
                street: 'river',
                snapshot: {
                  heroId: HERO_PLAYER_ID,
                  heroCards: [parseCard('Js'), parseCard('Jd')],
                  board: [
                    parseCard('9h'),
                    parseCard('7h'),
                    parseCard('2c'),
                    parseCard('4s'),
                    parseCard('Kd'),
                  ],
                  street: 'river',
                  potBeforeCall: 220,
                  heroStack: 445,
                  heroStreetContribution: 0,
                  heroTotalContribution: 55,
                  currentBet: 50,
                  streetCap: 50,
                  remainingCapAllowance: 50,
                  toCall: 50,
                  callAmount: 50,
                  isCallAllIn: false,
                  activeOpponentCount: 2,
                  actingOpponentCount: 2,
                  position: { label: 'Nói sau 1 người' },
                  potSlices: [],
                  legalActions: null,
                },
                handStateAtDecision: heroTurnHand,
                chosenAction: { type: 'fold' },
                fromOutOfTurn: false,
                executed: true,
                outOfTurnStatus: null,
                cancelReason: null,
                potOdds: {
                  hasCall: true,
                  potBeforeCall: 220,
                  callAmount: 50,
                  potAfterCall: 270,
                  requiredEquity: 50 / 270,
                  requiredEquityPercent: (50 / 270) * 100,
                  potToCallRatio: 220 / 50,
                  oddsAgainst: 220 / 50,
                  potToCallLabel: '4.40-to-1',
                },
                activeOpponentIds: ['dien', 'ca'],
                timelineLengthAtDecision: 8,
              },
              estimatedEquity: 0.14,
              equitySamples: 450,
              equitySeed: 'test-seed-fold',
              chosenActionLabel: 'Fold',
              turnLabelVi: 'Đúng lượt',
              chosenEv: 0,
              chosenEvPrecision: 'exact',
              bestAlternativeLabel: 'Fold',
              bestAlternativeEv: 0,
              evDiff: 0,
              qualityLabel: 'Tốt',
              qualityTone: 'good',
              explanationVi: 'Bạn chọn Fold (EV chính xác 0,0 điểm).',
              assumptionsVi: ['EV Fold = 0 điểm là giá trị chính xác theo định nghĩa.'],
              rangeSummariesVi: ['Điên có range rộng gồm draw và bluff.'],
            },
          ],
          timeline: botTurnHand.timeline,
          showdownResolution: null,
          foldWinnerId: null,
          foldWinPotAmount: 0,
        },
        seatProfiles: sAfterFold.seatProfiles,
        terminology: 'en-standard',
        onPracticeSpot: () => undefined,
        onClose: () => undefined,
      }),
    );

    expect(reviewHtml).toContain('không ảnh hưởng điểm quyết định');
    expect(reviewHtml).toContain('Pot odds · Equity cần (chính xác)');
    expect(reviewHtml).toContain('30,0% (2.33-to-1)');
    expect(reviewHtml).toContain('54,0%');
    expect(reviewHtml).toContain('+24,0 điểm');
    expect(reviewHtml).toContain('EV hành động (ước lượng theo range/mẫu)');
    expect(reviewHtml).toContain('EV hành động (chính xác)');
    expect(reviewHtml).toContain('Tốt');
    expect(reviewHtml).toContain('Đúng lượt');
    expect(reviewHtml).toContain('Hô trước lượt');
    expect(reviewHtml).toContain('Call 20 (Hô trước lượt)');
    expect(reviewHtml).toContain('Hô sớm · đã hủy');
    expect(reviewHtml).toContain('Bet 20 (Hô sớm · đã hủy)');
    // Exact EV label appears ONLY ONCE (for the Fold decision, NOT for the Call decisions!)
    const exactEvMatches = reviewHtml.match(/EV hành động \(chính xác\)/g) ?? [];
    expect(exactEvMatches.length).toBe(1);
    const callEstimatedEvMatches =
      reviewHtml.match(/EV hành động \(ước lượng theo range\/mẫu\)/g) ?? [];
    expect(callEstimatedEvMatches.length).toBe(2);
    // Drill jump button must appear TWICE (only for the 2 valid in-turn Hero decisions, NOT for executed or cancelled OOT decisions)
    const drillButtons = reviewHtml.match(/Luyện spot này trong Drill/g) ?? [];
    expect(drillButtons.length).toBe(2);
  });

  it('Mobile-first priority & 10-seat progressive detail: board and hero controls precede seats panel while preserving all styles & chip details', () => {
    const html10 = renderToStaticMarkup(
      createElement(SandboxApp, {
        initialSeed: 'ui-10-seat-priority',
        initialSettings: {
          playerCount: 10,
          enabledRivalIds: [...RIVAL_IDS],
        },
        mode: 'sandbox',
        storage: null,
      }),
    );

    const boardIdx = html10.indexOf('class="sb-board"');
    const actionBarIdx = html10.indexOf('class="sb-action-bar"');
    const seatsPanelIdx = html10.indexOf('class="sb-seats-panel"');

    expect(boardIdx).toBeGreaterThan(-1);
    expect(actionBarIdx).toBeGreaterThan(boardIdx);
    expect(seatsPanelIdx).toBeGreaterThan(actionBarIdx);

    // Progressive detail controls and all 9 rival style labels remain present & accessible
    expect(html10).toContain('Hiện chip tất cả');
    expect(html10).toContain('aria-expanded="false"');
    expect(html10).toContain('aria-label="Cơ cấu chip theo mệnh giá"');
    expect(html10).toContain('10 ghế');
    for (const rivalId of RIVAL_IDS) {
      expect(html10).toContain(getRivalSeatMetadata(rivalId).styleLabel);
    }
  });

  it('BoundaryPanel allows explicit next-hand click when < 4 seats (T4 auto-invite) while preserving manual invite controls', () => {
    let s = createSandboxSession({
      seed: 'ui-boundary-t4',
      settings: { playerCount: 4, allowOutOfTurn: false },
      fixtures: { openerId: HERO_PLAYER_ID },
    });
    s = performHeroAction(s, 'fold');
    let guard = 0;
    while (s.phase === 'in-hand' && s.hand?.phase === 'betting' && guard < 100) {
      s = stepOneBotTurn(s);
      guard++;
    }
    s = enterHandBoundary(s);
    s = cashOutPlayerAtBoundary(s, HERO_PLAYER_ID);
    expect(s.boundary!.seats.length).toBe(3);

    const html = renderToStaticMarkup(
      createElement(BoundaryPanel, {
        boundary: s.boundary!,
        seatProfiles: s.seatProfiles,
        hasPendingSettings: false,
        onRebuyPlayer: () => undefined,
        onCashOutPlayer: () => undefined,
        onInviteRival: () => undefined,
        onSeatHeroBack: () => undefined,
        onOpenExchange: () => undefined,
        onStartNextHand: () => undefined,
      }),
    );

    expect(html).toContain('Mời rival mới (+500)');
    expect(html).toContain('+ Mời thêm rival');
    expect(html).toContain('Ngồi lại bàn (+500)');
    expect(html).toMatch(/<button type="button" class="sb-btn sb-btn--primary">Chia ván tiếp theo<\/button>/);
  });
});

describe('P4 Deal Animation Lifecycle — O3 Superseded, Hand-End, Strict Mode & Reduced Motion', () => {
  const DEAL_MS = 320;

  interface ScheduledTimer {
    readonly id: number;
    readonly dueAt: number;
    readonly callback: () => void;
    cleared: boolean;
    fired: boolean;
  }

  function createFakeClock() {
    let now = 0;
    let nextId = 1;
    const timers: ScheduledTimer[] = [];

    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((cb: () => void, ms?: number) => {
      const entry: ScheduledTimer = {
        id: nextId++,
        dueAt: now + (ms ?? 0),
        callback: cb,
        cleared: false,
        fired: false,
      };
      timers.push(entry);
      return entry.id as unknown as ReturnType<typeof setTimeout>;
    }) as typeof globalThis.setTimeout);

    vi.spyOn(globalThis, 'clearTimeout').mockImplementation(((
      id?: ReturnType<typeof setTimeout>,
    ) => {
      const numericId = id as unknown as number;
      const found = timers.find((t) => t.id === numericId);
      if (found) {
        found.cleared = true;
      }
    }) as typeof globalThis.clearTimeout);

    const advance = (ms: number) => {
      const target = now + ms;
      for (;;) {
        const nextDue = timers
          .filter((t) => !t.cleared && !t.fired && t.dueAt <= target)
          .sort((a, b) => a.dueAt - b.dueAt || a.id - b.id)[0];
        if (!nextDue) {
          break;
        }
        now = nextDue.dueAt;
        nextDue.fired = true;
        nextDue.callback();
      }
      now = target;
    };

    return { timers, advance };
  }

  function createDealHarness(initialCallback?: (info: DealAnimationEndInfo) => void) {
    const completions: DealAnimationEndInfo[] = [];
    const stateHistory: DealAnimState[] = [];
    let currentState: DealAnimState = 'idle';
    let activeCleanup: (() => void) | undefined;

    const pendingDealRef: { current: PendingDealDescriptor | null } = { current: null };
    const completedDealKeyRef: { current: string | null } = { current: null };
    const onDealAnimationEndRef: {
      current: ((info: DealAnimationEndInfo) => void) | undefined;
    } = {
      current: initialCallback ?? ((info) => completions.push(info)),
    };

    const runEffect = (params: {
      readonly dealKey: string | null;
      readonly info: DealAnimationEndInfo | null;
      readonly effectiveReducedMotion?: boolean;
    }) => {
      activeCleanup?.();
      activeCleanup = syncDealAnimationLifecycle({
        dealKey: params.dealKey,
        effectiveReducedMotion: params.effectiveReducedMotion ?? false,
        durationMs: DEAL_MS,
        getDealInfo: () => params.info,
        pendingDealRef,
        completedDealKeyRef,
        onDealAnimationEndRef,
        setDealAnimState: (next) => {
          currentState = next;
          stateHistory.push(next);
        },
      });
    };

    const unmount = () => {
      activeCleanup?.();
      activeCleanup = undefined;
    };

    return {
      completions,
      stateHistory,
      getState: () => currentState,
      onDealAnimationEndRef,
      runEffect,
      unmount,
    };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('O3 regression: key A replaced by key B before 320ms emits A once with original info, keeps animating for B, then marks ready and emits B once', () => {
    const clock = createFakeClock();
    const harness = createDealHarness();
    const infoA: DealAnimationEndInfo = { handNumber: 1, street: 'flop', eventCount: 4 };
    const infoB: DealAnimationEndInfo = { handNumber: 1, street: 'turn', eventCount: 9 };

    // Key A starts at t = 0ms
    harness.runEffect({ dealKey: 'seed-1:1:flop:3', info: infoA });
    expect(harness.getState()).toBe('animating');
    expect(harness.completions).toEqual([]);

    // At t = 300ms (fast bot speed), street advances to turn (key B) before A's 320ms expiry
    clock.advance(300);
    harness.runEffect({ dealKey: 'seed-1:1:turn:4', info: infoB });

    // A's interrupted completion emitted once with A's original info; B is still animating (NOT ready)
    expect(harness.completions).toEqual([infoA]);
    expect(harness.getState()).toBe('animating');
    expect(harness.stateHistory).not.toContain('ready');

    // Passing A's original 320ms mark (t = 320ms..619ms) must NOT trigger a stale callback or mark B ready
    clock.advance(319);
    expect(harness.completions).toEqual([infoA]);
    expect(harness.getState()).toBe('animating');

    // At t = 620ms (320ms after B started), B completes once and transitions to ready
    clock.advance(1);
    expect(harness.completions).toEqual([infoA, infoB]);
    expect(harness.getState()).toBe('ready');

    // Further time produces no duplicate callbacks
    clock.advance(1000);
    expect(harness.completions).toEqual([infoA, infoB]);
  });

  it('O3 regression: key A replaced by none (hand ends -> between-hands) before 320ms emits A once and settles to idle', () => {
    const clock = createFakeClock();
    const harness = createDealHarness();
    const infoA: DealAnimationEndInfo = { handNumber: 2, street: 'flop', eventCount: 6 };

    harness.runEffect({ dealKey: 'seed-1:2:flop:3', info: infoA });
    expect(harness.getState()).toBe('animating');
    expect(harness.completions).toEqual([]);

    // Hand ends and enters between-hands (dealKey = null) at t = 250ms
    clock.advance(250);
    harness.runEffect({ dealKey: null, info: null });

    expect(harness.completions).toEqual([infoA]);
    expect(harness.getState()).toBe('idle');

    // Original timer must not re-fire or flip state back to ready
    clock.advance(500);
    expect(harness.completions).toEqual([infoA]);
    expect(harness.getState()).toBe('idle');
  });

  it('O3 regression: rapid A -> B -> C before expiry emits each once in order and marks ready only after C completes', () => {
    const clock = createFakeClock();
    const harness = createDealHarness();
    const infoA: DealAnimationEndInfo = { handNumber: 1, street: 'flop', eventCount: 3 };
    const infoB: DealAnimationEndInfo = { handNumber: 1, street: 'turn', eventCount: 7 };
    const infoC: DealAnimationEndInfo = { handNumber: 1, street: 'river', eventCount: 11 };

    harness.runEffect({ dealKey: 'seed-1:1:flop:3', info: infoA });
    clock.advance(100);
    harness.runEffect({ dealKey: 'seed-1:1:turn:4', info: infoB });
    expect(harness.completions).toEqual([infoA]);
    expect(harness.getState()).toBe('animating');

    clock.advance(100);
    harness.runEffect({ dealKey: 'seed-1:1:river:5', info: infoC });
    expect(harness.completions).toEqual([infoA, infoB]);
    expect(harness.getState()).toBe('animating');
    expect(harness.stateHistory).not.toContain('ready');

    clock.advance(320);
    expect(harness.completions).toEqual([infoA, infoB, infoC]);
    expect(harness.getState()).toBe('ready');
  });

  it('avoids duplicate completion across Strict Mode remount, reduced-motion toggles, callback swaps, stale timers, and never emits on unmount', () => {
    const clock = createFakeClock();

    // 1. Strict Mode double-invoke with normal motion + callback identity swap
    const normalResults: Array<{ tag: string; info: DealAnimationEndInfo }> = [];
    const h1 = createDealHarness((info) => normalResults.push({ tag: 'v1', info }));
    const info1: DealAnimationEndInfo = { handNumber: 1, street: 'flop', eventCount: 4 };

    // Mount -> Strict Mode cleanup -> immediate remount for same key (even if timeline moved on)
    h1.runEffect({ dealKey: 'seed-sm:1:flop:3', info: info1 });
    h1.runEffect({
      dealKey: 'seed-sm:1:flop:3',
      info: { handNumber: 1, street: 'flop', eventCount: 5 },
    });
    expect(normalResults).toEqual([]);
    expect(h1.getState()).toBe('animating');

    // Swap callback ref before completion
    h1.onDealAnimationEndRef.current = (info) => normalResults.push({ tag: 'v2', info });
    clock.advance(320);
    expect(normalResults).toEqual([{ tag: 'v2', info: info1 }]);
    expect(h1.getState()).toBe('ready');

    // 2. Strict Mode + reduced motion emits once, and toggling reducedMotion off afterwards does not re-emit
    const h2 = createDealHarness();
    const info2: DealAnimationEndInfo = { handNumber: 1, street: 'flop', eventCount: 4 };
    h2.runEffect({ dealKey: 'seed-rm:1:flop:3', info: info2, effectiveReducedMotion: true });
    h2.runEffect({ dealKey: 'seed-rm:1:flop:3', info: info2, effectiveReducedMotion: true });
    h2.runEffect({ dealKey: 'seed-rm:1:flop:3', info: info2, effectiveReducedMotion: false });
    expect(h2.completions).toEqual([info2]);
    expect(h2.getState()).toBe('ready');

    // 3. Toggling reducedMotion on mid-animation completes immediately once with original info
    const h3 = createDealHarness();
    const info3: DealAnimationEndInfo = { handNumber: 1, street: 'turn', eventCount: 8 };
    h3.runEffect({ dealKey: 'seed-mid:1:turn:4', info: info3, effectiveReducedMotion: false });
    clock.advance(100);
    h3.runEffect({
      dealKey: 'seed-mid:1:turn:4',
      info: { handNumber: 1, street: 'turn', eventCount: 10 },
      effectiveReducedMotion: true,
    });
    expect(h3.completions).toEqual([info3]);
    expect(h3.getState()).toBe('ready');
    clock.advance(500);
    expect(h3.completions).toEqual([info3]);

    // 4. Unmount while animating cancels timer and emits zero callbacks
    const h4 = createDealHarness();
    const info4: DealAnimationEndInfo = { handNumber: 3, street: 'river', eventCount: 14 };
    h4.runEffect({ dealKey: 'seed-unmount:3:river:5', info: info4 });
    clock.advance(150);
    h4.unmount();
    clock.advance(1000);
    expect(h4.completions).toEqual([]);

    // 5. Stale timer callback invoked after key A is superseded by key B cannot mark B ready or duplicate A
    const h5 = createDealHarness();
    const info5A: DealAnimationEndInfo = { handNumber: 4, street: 'flop', eventCount: 3 };
    const info5B: DealAnimationEndInfo = { handNumber: 4, street: 'turn', eventCount: 8 };
    const beforeCount = clock.timers.length;
    h5.runEffect({ dealKey: 'seed-stale:4:flop:3', info: info5A });
    const staleCallbackA = clock.timers[beforeCount]!.callback;
    clock.advance(200);
    h5.runEffect({ dealKey: 'seed-stale:4:turn:4', info: info5B });
    expect(h5.completions).toEqual([info5A]);
    expect(h5.getState()).toBe('animating');

    // Manually invoke stale callback from key A while key B is animating
    staleCallbackA();
    expect(h5.completions).toEqual([info5A]);
    expect(h5.getState()).toBe('animating');

    // Only key B's own expiry marks ready and emits B once
    clock.advance(320);
    expect(h5.completions).toEqual([info5A, info5B]);
    expect(h5.getState()).toBe('ready');
  });
});
