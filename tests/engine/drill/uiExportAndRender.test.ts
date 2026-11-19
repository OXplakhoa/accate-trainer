import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { checkHandInvariants, checkInv1, initialDistribution } from '../../../src/engine';
import {
  buildDrillProgressReport,
  createInitialDrillPersistedState,
  markLessonCompleted,
  recordCompletedAttempt,
} from '../../../src/engine/drill';
import { DrillApp, LessonView, ProgressView } from '../../../src/ui/drill';
import { buildD8TurnState, buildH1DecisionStates } from '../calculator/helpers';

function renderStaticWithFixedClock(element: ReactElement): string {
  const prevDescriptor = Object.getOwnPropertyDescriptor(globalThis.performance, 'now');
  Object.defineProperty(globalThis.performance, 'now', {
    configurable: true,
    writable: true,
    value: () => 0,
  });
  try {
    return renderToStaticMarkup(element);
  } finally {
    if (prevDescriptor !== undefined) {
      Object.defineProperty(globalThis.performance, 'now', prevDescriptor);
    }
  }
}

describe('P3 Drill — UI export, standalone rendering, and Sandbox initialSpot prop', () => {
  it('exports DrillApp from src/ui/drill/index.ts and renders standalone across Levels 0, 1, 2, 3', () => {
    const dist = initialDistribution(6);
    expect(
      checkInv1([dist.bank, ...Array.from({ length: 6 }, () => dist.perPlayer)]),
    ).toEqual({ ok: true });

    // Standalone Level 1 render (default H1 #7 spot)
    const htmlL1 = renderStaticWithFixedClock(createElement(DrillApp, { defaultLevel: 1 }));
    expect(htmlL1).toContain('Accate Trainer — Mode Drill');
    expect(htmlL1).toContain('Cấp 1 — Tính từng bước');
    expect(htmlL1).toContain('1. Đếm Outs');
    expect(htmlL1).toContain('2. Số lá chưa biết');
    expect(htmlL1).toContain('3. % Turn (1 lá)');
    expect(htmlL1).toContain('4. % tới River');
    expect(htmlL1).toContain('5. Pot Odds (%)');
    expect(htmlL1).toContain('6. Hành động &amp; Chip');
    expect(htmlL1).toContain('Gợi ý miễn phí');

    // Standalone Level 0 render (Lessons)
    const htmlL0 = renderStaticWithFixedClock(
      createElement(DrillApp, { defaultLevel: 0, defaultConcept: 'bet-sizing' }),
    );
    expect(htmlL0).toContain('Bài 7: Bet Sizing Hợp lệ vs Chiến thuật');
    expect(htmlL0).toContain('Hopkins L2 slide 18–20');
    expect(htmlL0).toContain('350/50');
    expect(htmlL0).toContain('12,5%');

    // Standalone Level 2 render (One-shot form + recorded hint button)
    const htmlL2 = renderStaticWithFixedClock(createElement(DrillApp, { defaultLevel: 2 }));
    expect(htmlL2).toContain('Cấp 2 — Tự giải');
    expect(htmlL2).toContain('Xem gợi ý (ghi chỉ số)');
    expect(htmlL2).toContain('Call 30');

    // Standalone Level 3 render (Timer + no hint button)
    const htmlL3 = renderStaticWithFixedClock(
      createElement(DrillApp, { defaultLevel: 3, defaultClockSeconds: 20 }),
    );
    expect(htmlL3).toContain('Cấp 3 — Áp lực thật');
    expect(htmlL3).toContain('Đồng hồ Cấp 3');
    expect(htmlL3).toContain('20 giây');
    expect(htmlL3).not.toContain('Gợi ý miễn phí');
    expect(htmlL3).not.toContain('Xem gợi ý (ghi chỉ số)');
  });

  it('supports optional initialSpot={{ hand, heroId }} prop from Sandbox without importing Sandbox modules', () => {
    const { step13TurnC } = buildH1DecisionStates();
    expect(checkHandInvariants(step13TurnC).ok).toBe(true);

    const htmlSandbox = renderStaticWithFixedClock(
      createElement(DrillApp, {
        initialSpot: { hand: step13TurnC, heroId: 'C' },
      }),
    );
    expect(htmlSandbox).toContain('Spot từ Bàn chơi');
    expect(htmlSandbox).toContain('Pot: 170 điểm');
    expect(htmlSandbox).toContain('Cần Call:');

    const d8 = buildD8TurnState();
    expect(checkHandInvariants(d8.beforeHeroBet).ok).toBe(true);
    const htmlD8 = renderStaticWithFixedClock(
      createElement(DrillApp, {
        initialSpot: { hand: d8.beforeHeroBet, heroId: 'A' },
        defaultLevel: 2,
      }),
    );
    expect(htmlD8).toContain('Pot: 300 điểm');
    expect(htmlD8).toContain('Check (0)');
  });

  it('renders ProgressView both in empty state and with all 8 metrics & 4 trend breakdowns (M4)', () => {
    const emptyState = createInitialDrillPersistedState();
    const emptyReport = buildDrillProgressReport(emptyState);

    const emptyHtml = renderStaticWithFixedClock(
      createElement(ProgressView, {
        report: emptyReport,
        storageAvailable: true,
        storageWarningVi: null,
        onStartPractice: () => {},
        onResetProgress: () => {},
      }),
    );
    expect(emptyHtml).toContain('Chưa có lượt luyện tập nào được ghi nhận');
    expect(emptyHtml).toContain('#1 · Đếm outs đúng');
    expect(emptyHtml).toContain('#4 · Quyết định đúng ở Spot rõ');
    expect(emptyHtml).toContain('#6 · Tốc độ trung vị câu đúng');
    expect(emptyHtml).toContain('Chỉ tính trên câu đúng');

    let popState = markLessonCompleted(emptyState, 'outs');
    popState = recordCompletedAttempt(popState, {
      attemptId: 'att-1',
      sequenceIndex: 1,
      spotId: 'spot-1',
      conceptId: 'outs',
      level: 1,
      street: 'flop',
      primaryRivalId: 'dien',
      contestingRivalIds: ['dien'],
      isNongTilted: false,
      actionTaken: 'call',
      actionAmount: 30,
      recommendedAction: 'fold',
      isDecisionCorrect: false,
      evLoss: 12,
      chosenActionEv: -12,
      bestActionEv: 0,
      responseTimeMs: 9500,
      timedOut: false,
      hintUsed: false,
      outsMetric: {
        userOuts: 9,
        expectedOuts: 8,
        signedError: 1,
        absoluteError: 1,
        isCorrect: false,
      },
      outsPercentMetric: null,
      potOddsMetric: null,
      clearSpotMetric: {
        equity: 0.18,
        requiredEquity: 0.3,
        signedMarginPp: -12,
        marginPp: 12,
        thresholdPp: 5,
        isClearSpot: true,
        countsTowardClearSpotMetric: true,
        recommendedAction: 'fold',
        heroDecision: 'call',
        counted: true,
        isCorrect: false,
      },
      boardTextureMetric: {
        userClassification: 'wet',
        expectedClassification: 'wet',
        isCorrect: true,
      },
      handWon: false,
      decisionVsOutcomeBadgeVi: 'Quyết định: Chưa tối ưu (-EV) — thua pot',
    });

    const popReport = buildDrillProgressReport(popState);
    const popHtml = renderStaticWithFixedClock(
      createElement(ProgressView, {
        report: popReport,
        storageAvailable: false,
        storageWarningVi: 'Trình duyệt chặn storage',
        onStartPractice: () => {},
        onResetProgress: () => {},
      }),
    );
    expect(popHtml).toContain('Trình duyệt chặn storage');
    expect(popHtml).toContain('Bạn hay call/theo cược sai trước Điên');
    expect(popHtml).toContain('1. Tiến bộ theo Cấp độ');
    expect(popHtml).toContain('2. Tiến bộ theo Khái niệm');
    expect(popHtml).toContain('3. Tiến bộ theo từng Nhân vật Rival');
    expect(popHtml).toContain('4. Xu hướng theo Thời gian');

    const lessonHtml = renderStaticWithFixedClock(
      createElement(LessonView, {
        conceptId: 'outs',
        completedLessons: ['outs'],
        onSelectConcept: () => {},
        onCompleteAndPractice: () => {},
      }),
    );
    expect(lessonHtml).toContain('Hopkins L2 slide 24–27');
    expect(lessonHtml).toContain('Đã học xong');
  });
});
