import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../../../src/ui/App';
import { DrillApp } from '../../../src/ui/drill';
import {
  createSandboxSession,
  getHeroActionValidation,
  HERO_PLAYER_ID,
  SandboxApp,
} from '../../../src/ui/sandbox';
import { HeroControls } from '../../../src/ui/sandbox/components/HeroControls';
import { SettingsDrawer } from '../../../src/ui/sandbox/components/SettingsDrawer';
import {
  createInitialTournamentClockState,
  TournamentApp,
  TournamentTimerWidget,
  type TournamentClockState,
} from '../../../src/ui/tournament';

describe('P5 Tournament — UI Rendering, Accessibility, O6 Suppression & App Navigation', () => {
  beforeAll(() => {
    vi.spyOn(globalThis.performance, 'now').mockReturnValue(0);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('App keeps Drill open by default and exposes Tournament in top navigation', async () => {
    const html = renderToStaticMarkup(createElement(App));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(html).toContain('aria-label="Chế độ chơi"');
    expect(html).toContain('Luyện tập');
    expect(html).toContain('Bàn Sandbox');
    expect(html).toContain('Tournament');
    // Drill button is pressed by default
    expect(html).toMatch(/aria-pressed="true"[^>]*>Luyện tập<\/button>/);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Bàn Sandbox<\/button>/);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Tournament<\/button>/);
  });

  it('TournamentApp reuses Sandbox table (mode="tournament", D40 felt), renders accessible timerSlot, and uses 20s default or configured timer', () => {
    const htmlDefault = renderToStaticMarkup(
      createElement(TournamentApp, {
        initialSeed: 'tm-ui-default',
        storage: null,
      }),
    );

    expect(htmlDefault).toContain('class="accate-tournament"');
    expect(htmlDefault).toContain('data-mode="tournament"');
    expect(htmlDefault).toContain('Accate Tournament');
    expect(htmlDefault).toContain('data-slot="tournament-timer"');
    expect(htmlDefault).toContain('role="timer"');
    expect(htmlDefault).toContain('tabindex="0"');
    expect(htmlDefault).toContain('20s');
    expect(htmlDefault).toContain('Mỗi lượt 20s');
    // Reuses Sandbox felt & controls
    expect(htmlDefault).toContain('sb-table-felt');
    expect(htmlDefault).toContain('Đổi chip');
    expect(htmlDefault).toContain('Sổ phiên');
    expect(htmlDefault).toContain('Cài đặt');

    const html15 = renderToStaticMarkup(
      createElement(TournamentApp, {
        initialSeed: 'tm-ui-15s',
        initialSettings: { tournamentTimerSeconds: 15, reducedMotion: true },
        storage: null,
      }),
    );
    expect(html15).toContain('15s');
    expect(html15).toContain('Mỗi lượt 15s');
    expect(html15).toContain('data-deal-state="ready"');
  });

  it('TournamentTimerWidget exposes non-color state labels, urgent last-3s indicators, and screen-reader announcements', () => {
    const base = createInitialTournamentClockState(20, false);

    const waitingState: TournamentClockState = {
      ...base,
      status: 'waiting-animation',
      activeTurn: {
        turnKey: 's:1:flop:2',
        dealKey: 's:1:flop',
        sessionSeed: 's',
        handNumber: 1,
        street: 'flop',
        durationSeconds: 20,
        hadCancelledDeclaration: false,
      },
      remainingMs: 20_000,
      remainingSeconds: 20,
    };
    const waitingHtml = renderToStaticMarkup(
      createElement(TournamentTimerWidget, { clockState: waitingState }),
    );
    expect(waitingHtml).toContain('Chờ lật bài…');
    expect(waitingHtml).toContain('data-timer-status="waiting-animation"');

    const urgentState: TournamentClockState = {
      ...waitingState,
      status: 'running',
      remainingMs: 2_500,
      remainingSeconds: 3,
      pendingTimerSeconds: 10,
      activeTurn: {
        ...waitingState.activeTurn!,
        hadCancelledDeclaration: true,
      },
    };
    const urgentHtml = renderToStaticMarkup(
      createElement(TournamentTimerWidget, { clockState: urgentState }),
    );
    expect(urgentHtml).toContain('Sắp hết giờ!');
    expect(urgentHtml).toContain('3s');
    expect(urgentHtml).toContain('data-urgent="true"');
    expect(urgentHtml).toContain('Lời hô hủy · đủ giờ chọn lại');
    expect(urgentHtml).toContain('Còn 3 giây.');

    const timedOutState: TournamentClockState = {
      ...waitingState,
      status: 'timed-out',
      remainingMs: 0,
      remainingSeconds: 0,
    };
    const timedOutHtml = renderToStaticMarkup(
      createElement(TournamentTimerWidget, { clockState: timedOutState }),
    );
    expect(timedOutHtml).toContain('Hết giờ');
    expect(timedOutHtml).toContain('0s');
    expect(timedOutHtml).toContain('Hết giờ, hệ thống tự động xử lý lượt.');

    const ootIdleHtml = renderToStaticMarkup(
      createElement(TournamentTimerWidget, {
        clockState: { ...base, hasBindingOutOfTurn: true },
      }),
    );
    expect(ootIdleHtml).toContain('Đã hô trước');
    expect(ootIdleHtml).toContain('Tự chạy nếu cược giữ nguyên');
  });

  it('O6: suppresses mid-hand pot odds and mid-hand Drill feedback while preserving operational chip hints', () => {
    // Build a spot where Hero faces a bet (so Sandbox shows Pot odds, while Tournament suppresses it)
    const s = createSandboxSession({
      seed: 'p5-o6-suppression',
      settings: {
        playerCount: 4,
        enabledRivalIds: ['dien', 'da', 'ca'],
        allowOutOfTurn: false,
      },
      fixtures: { openerId: 'dien' },
    });
    // Step Điên so Điên bets and Hero faces a bet
    const sFacingBet = createSandboxSession({
      seed: 'p5-o6-facing',
      settings: {
        playerCount: 4,
        enabledRivalIds: ['dien', 'da', 'ca'],
        allowOutOfTurn: false,
        pauseOnImportantSpot: true,
      },
      fixtures: { openerId: HERO_PLAYER_ID },
    });

    const heroSeat = sFacingBet.hand!.seats.find((seat) => seat.playerId === HERO_PLAYER_ID)!;
    const baseValidation = getHeroActionValidation(sFacingBet);
    const mockFacingBetValidation = {
      ...baseValidation,
      isHeroTurn: true,
      canCheck: false,
      callAmount: 30,
      legalActions: {
        playerId: HERO_PLAYER_ID,
        street: 'flop' as const,
        streetCap: 50,
        currentBet: 30,
        playerStreetContribution: 0,
        toCall: 30,
        canFold: true,
        canCheck: false,
        canBet: false,
        betRange: null,
        canCall: true,
        callAmount: 30,
        isCallAllIn: false,
        canRaise: true,
        raiseRange: { min: 35, max: 50, step: 5 as const },
      },
      validationHintVi: 'Bấm chip từ stack để chọn đúng 30 điểm cho lệnh Call.',
    };

    const sandboxHtml = renderToStaticMarkup(
      createElement(HeroControls, {
        heroCards: heroSeat.holeCards,
        availableStack: heroSeat.stack,
        stagedChips: sFacingBet.stagedChips,
        validation: mockFacingBetValidation,
        potValue: 70,
        streetCap: 50,
        terminology: 'en-standard',
        pendingHeroLeave: false,
        isAwaitingPayout: false,
        isHandComplete: false,
        disableMidHandFeedback: false,
        canPracticeSpot: true,
        onStageChip: () => undefined,
        onUnstageChip: () => undefined,
        onUndoLastChip: () => undefined,
        onClearStaged: () => undefined,
        onAction: () => undefined,
        onDeclareOutOfTurn: () => undefined,
        onOpenExchange: () => undefined,
        onRequestLeave: () => undefined,
        onPracticeSpot: () => undefined,
      }),
    );
    expect(sandboxHtml).toContain('Pot odds: 30,0%');
    expect(sandboxHtml).toContain('Luyện spot này');

    const tournamentHtml = renderToStaticMarkup(
      createElement(HeroControls, {
        heroCards: heroSeat.holeCards,
        availableStack: heroSeat.stack,
        stagedChips: sFacingBet.stagedChips,
        validation: mockFacingBetValidation,
        potValue: 70,
        streetCap: 50,
        terminology: 'en-standard',
        pendingHeroLeave: false,
        isAwaitingPayout: false,
        isHandComplete: false,
        disableMidHandFeedback: true,
        canPracticeSpot: false,
        onStageChip: () => undefined,
        onUnstageChip: () => undefined,
        onUndoLastChip: () => undefined,
        onClearStaged: () => undefined,
        onAction: () => undefined,
        onDeclareOutOfTurn: () => undefined,
        onOpenExchange: () => undefined,
        onRequestLeave: () => undefined,
        onPracticeSpot: () => undefined,
      }),
    );
    expect(tournamentHtml).not.toContain('Pot odds:');
    expect(tournamentHtml).not.toContain('sb-odds-chip');
    expect(tournamentHtml).not.toContain('Luyện spot này');
    // Operational chip guidance still stays visible
    expect(tournamentHtml).toContain('Bấm chip từ stack để chọn đúng 30 điểm cho lệnh Call.');

    // Also verify SandboxApp with mode="tournament" + disableMidHandFeedback suppresses important-spot banner & mid-hand Drill button
    const tournamentSandboxHtml = renderToStaticMarkup(
      createElement(SandboxApp, {
        initialSeed: 'p5-o6-sb',
        initialSettings: {
          playerCount: 4,
          pauseOnImportantSpot: true,
        },
        mode: 'tournament',
        disableMidHandFeedback: true,
        onPracticeSpot: () => undefined,
        storage: null,
      }),
    );
    expect(tournamentSandboxHtml).not.toContain('Luyện spot này');
    expect(tournamentSandboxHtml).not.toContain('muốn chuyển nhanh sang Drill');
    expect(s.hand).not.toBeNull();

    // SettingsDrawer exposes 10/15/20/25s options and hides mid-hand Drill hint toggle when disabled
    const settingsHtml = renderToStaticMarkup(
      createElement(SettingsDrawer, {
        appliedSettings: s.appliedSettings,
        pendingSettings: null,
        isInHand: true,
        hasPracticeSpotCallback: false,
        onApply: () => undefined,
        onClose: () => undefined,
      }),
    );
    expect(settingsHtml).toContain('10s');
    expect(settingsHtml).toContain('15s');
    expect(settingsHtml).toContain('20s');
    expect(settingsHtml).toContain('25s');
    expect(settingsHtml).not.toContain('Gợi ý dừng ở spot quan trọng');
  });

  it('DrillApp shows "← Quay lại Tournament" when opened from Tournament while preserving "← Quay lại Bàn Sandbox" for Sandbox', () => {
    const s = createSandboxSession({
      seed: 'p5-drill-back-label',
      settings: { playerCount: 4, allowOutOfTurn: false },
      fixtures: { openerId: HERO_PLAYER_ID },
    });

    const sandboxReturnHtml = renderToStaticMarkup(
      createElement(DrillApp, {
        initialSpot: { hand: s.hand!, heroId: HERO_PLAYER_ID },
        onBackToSandbox: () => undefined,
      }),
    );
    expect(sandboxReturnHtml).toContain('← Quay lại Bàn Sandbox');
    expect(sandboxReturnHtml).not.toContain('← Quay lại Tournament');

    const tournamentReturnHtml = renderToStaticMarkup(
      createElement(DrillApp, {
        initialSpot: { hand: s.hand!, heroId: HERO_PLAYER_ID },
        onBackToSandbox: () => undefined,
        backToTableLabel: '← Quay lại Tournament',
      }),
    );
    expect(tournamentReturnHtml).toContain('← Quay lại Tournament');
    expect(tournamentReturnHtml).not.toContain('← Quay lại Bàn Sandbox');
  });
});
