import {
  CLEAR_SPOT_THRESHOLD_PP,
  OUTS_PROBABILITY_ERROR_TARGET_PP,
  POT_ODDS_ERROR_TARGET_PP,
} from '../calculator';
import { RIVAL_DISPLAY_INFO, RIVAL_IDS, type RivalId } from '../rivals';
import { DRILL_CONCEPT_TITLES_VI } from './lessons';
import {
  DRILL_CONCEPT_IDS,
  type ActiveDrillLevel,
  type DrillAttemptRecord,
  type DrillConceptId,
  type DrillConceptProgress,
  type DrillLevel,
  type DrillLevelProgress,
  type DrillMetricsSummary,
  type DrillPersistedState,
  type DrillProgressReport,
  type DrillTimeTrendPoint,
  type LevelUpSuggestion,
  type RivalMetricSummary,
} from './types';

export const LEVEL_UP_WINDOW_SIZE = 20;
export const LEVEL_UP_MIN_ACCURACY_RATIO = 0.8;
export const LEVEL_UP_MIN_ACCURACY_PERCENT = 80;
export const OUTS_ACCURACY_TARGET_PERCENT = 90;
export const CLEAR_SPOT_ACCURACY_TARGET_PERCENT = 90;
export const BOARD_TEXTURE_ACCURACY_TARGET_PERCENT = 85;
export const DEFAULT_TARGET_CLOCK_SECONDS = 20;

export const DRILL_LEVEL_TITLES_VI: Readonly<Record<DrillLevel, string>> = Object.freeze({
  0: 'Cấp 0 — Học lại',
  1: 'Cấp 1 — Tính từng bước',
  2: 'Cấp 2 — Tự giải',
  3: 'Cấp 3 — Áp lực thật',
});

/**
 * Computes the exact median of a numeric array, or returns `null` if the array is empty.
 */
export function computeMedian(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid]!;
  }
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Evaluates whether the app should display a non-binding level-up suggestion (AC D7, Spec §6):
 * Requires at least 20 recent attempts (`windowSize = 20`) and accuracy >= 80% (>= 16/20 correct).
 * No level is ever locked.
 */
export function evaluateLevelUpSuggestion(
  attempts: readonly DrillAttemptRecord[],
  currentLevel: DrillLevel,
): LevelUpSuggestion {
  if (currentLevel === 0) {
    return Object.freeze({
      currentLevel: 0,
      windowSize: LEVEL_UP_WINDOW_SIZE,
      recentAttemptCount: 0,
      recentCorrectCount: 0,
      recentAccuracyRatio: null,
      recentAccuracyPercent: null,
      thresholdPercent: LEVEL_UP_MIN_ACCURACY_PERCENT,
      shouldSuggestLevelUp: false,
      suggestedNextLevel: 1,
      messageVi: 'Bạn có thể chuyển sang Cấp 1 (Tính từng bước) bất cứ lúc nào — mọi cấp luôn mở tự do.',
    });
  }

  const levelAttempts = attempts.filter((a) => a.level === currentLevel);
  const pool = levelAttempts;
  const recentWindow = pool.slice(-LEVEL_UP_WINDOW_SIZE);
  const recentAttemptCount = recentWindow.length;
  const recentCorrectCount = recentWindow.filter((a) => a.isDecisionCorrect).length;

  const recentAccuracyRatio =
    recentAttemptCount > 0 ? recentCorrectCount / recentAttemptCount : null;
  const recentAccuracyPercent =
    recentAccuracyRatio !== null ? recentAccuracyRatio * 100 : null;

  const hasFullWindow = recentAttemptCount >= LEVEL_UP_WINDOW_SIZE;
  const meetsAccuracy =
    recentAccuracyRatio !== null && recentAccuracyRatio + 1e-9 >= LEVEL_UP_MIN_ACCURACY_RATIO;
  const shouldSuggestLevelUp = hasFullWindow && meetsAccuracy;

  const suggestedNextLevel: ActiveDrillLevel | null =
    shouldSuggestLevelUp && currentLevel < 3
      ? ((currentLevel + 1) as ActiveDrillLevel)
      : shouldSuggestLevelUp && currentLevel === 3
        ? 3
        : null;

  let messageVi: string | null = null;
  if (shouldSuggestLevelUp) {
    const pctStr = (recentAccuracyPercent ?? 0).toFixed(0);
    if (currentLevel < 3 && suggestedNextLevel !== null) {
      messageVi = `Gợi ý lên cấp: Bạn đã đạt ${pctStr}% (${recentCorrectCount}/${LEVEL_UP_WINDOW_SIZE}) trong 20 lần gần nhất! Hãy thử sức ở ${DRILL_LEVEL_TITLES_VI[suggestedNextLevel]} (mọi cấp đều chọn tự do, không khóa).`;
    } else {
      messageVi = `Xuất sắc! Bạn đã duy trì độ chính xác ${pctStr}% (${recentCorrectCount}/${LEVEL_UP_WINDOW_SIZE}) trong 20 lần gần nhất ở Cấp 3 (Áp lực thật)!`;
    }
  }

  return Object.freeze({
    currentLevel,
    windowSize: LEVEL_UP_WINDOW_SIZE,
    recentAttemptCount,
    recentCorrectCount,
    recentAccuracyRatio,
    recentAccuracyPercent,
    thresholdPercent: LEVEL_UP_MIN_ACCURACY_PERCENT,
    shouldSuggestLevelUp,
    suggestedNextLevel,
    messageVi,
  });
}

function buildRivalSummaries(
  attempts: readonly DrillAttemptRecord[],
): Readonly<Record<RivalId, RivalMetricSummary>> {
  const map = {} as Record<RivalId, RivalMetricSummary>;

  for (const rivalId of RIVAL_IDS) {
    const display = RIVAL_DISPLAY_INFO[rivalId];
    const rivalAttempts = attempts.filter(
      (a) => a.primaryRivalId === rivalId || a.contestingRivalIds.includes(rivalId),
    );
    const measuredCount = rivalAttempts.length;
    const correctDecisions = rivalAttempts.filter((a) => a.isDecisionCorrect).length;
    const accuracyPercent =
      measuredCount > 0 ? (correctDecisions / measuredCount) * 100 : null;

    const clearAttempts = rivalAttempts.filter((a) => a.clearSpotMetric.counted);
    const clearSpotCount = clearAttempts.length;
    const clearSpotCorrectCount = clearAttempts.filter(
      (a) => a.clearSpotMetric.isCorrect === true,
    ).length;
    const clearSpotAccuracyPercent =
      clearSpotCount > 0 ? (clearSpotCorrectCount / clearSpotCount) * 100 : null;

    const totalEvLoss = rivalAttempts.reduce((acc, a) => acc + a.evLoss, 0);
    const meanEvLoss = measuredCount > 0 ? totalEvLoss / measuredCount : null;

    let wrongCallCount = 0;
    let wrongFoldCount = 0;
    let tiltedEncounterCount = 0;

    for (const att of rivalAttempts) {
      if (rivalId === 'nong' && att.isNongTilted) {
        tiltedEncounterCount += 1;
      }
      if (!att.isDecisionCorrect) {
        if (att.actionTaken === 'fold') {
          wrongFoldCount += 1;
        } else {
          wrongCallCount += 1;
        }
      }
    }

    let insightVi: string;
    if (measuredCount === 0) {
      insightVi = `Chưa có lượt luyện tập nào trước ${display.name}.`;
    } else if (wrongCallCount > wrongFoldCount && wrongCallCount >= 1) {
      insightVi = `Bạn hay call/theo cược sai trước ${display.name} (${wrongCallCount} lần mất EV).`;
    } else if (wrongFoldCount > wrongCallCount && wrongFoldCount >= 1) {
      insightVi = `Bạn hay fold quá chặt trước ${display.name} (${wrongFoldCount} lần bỏ pot +EV).`;
    } else if ((accuracyPercent ?? 0) >= 85) {
      insightVi = `Bạn đang đọc rất chuẩn kiểu chơi của ${display.name} (${(accuracyPercent ?? 0).toFixed(0)}%).`;
    } else {
      insightVi = `Độ chính xác trước ${display.name}: ${(accuracyPercent ?? 0).toFixed(0)}% qua ${measuredCount} lượt.`;
    }

    map[rivalId] = Object.freeze({
      rivalId,
      name: display.name,
      styleLabel: display.styleLabel,
      measuredCount,
      correctDecisions,
      accuracyPercent,
      clearSpotCount,
      clearSpotCorrectCount,
      clearSpotAccuracyPercent,
      meanEvLoss,
      wrongCallCount,
      wrongFoldCount,
      tiltedEncounterCount,
      insightVi,
    });
  }

  return Object.freeze(map);
}

/**
 * Pure aggregation of all 8 metrics in Spec §10 (D38, AC M1–M4).
 * Records measurable counts first (`measuredCount`), computes speed median strictly on
 * correct decisions, and filters clear-spot accuracy strictly by `> 5` percentage points.
 */
export function aggregateDrillMetrics(
  attempts: readonly DrillAttemptRecord[],
  targetClockSeconds = DEFAULT_TARGET_CLOCK_SECONDS,
): DrillMetricsSummary {
  // #1: Đếm outs đúng (target >= 90%, Hopkins L2 slide 24–27)
  const outsMeasured = attempts.filter((a) => a.outsMetric !== null);
  const outsCount = outsMeasured.length;
  const outsCorrectCount = outsMeasured.filter((a) => a.outsMetric!.isCorrect).length;
  const outsAccuracyRatio = outsCount > 0 ? outsCorrectCount / outsCount : null;
  const outsAccuracyPercent = outsAccuracyRatio !== null ? outsAccuracyRatio * 100 : null;
  const outsMeanAbsError =
    outsCount > 0
      ? outsMeasured.reduce((acc, a) => acc + a.outsMetric!.absoluteError, 0) / outsCount
      : null;

  // #2: Sai số outs -> % (target <= 3 pp, L7 slide 6)
  const pctMeasured = attempts.filter((a) => a.outsPercentMetric !== null);
  const pctCount = pctMeasured.length;
  const pctWithinCount = pctMeasured.filter((a) => a.outsPercentMetric!.withinTarget).length;
  const pctMeanAbsErrorPp =
    pctCount > 0
      ? pctMeasured.reduce((acc, a) => acc + a.outsPercentMetric!.absoluteErrorPp, 0) / pctCount
      : null;
  const pctMaxAbsErrorPp =
    pctCount > 0
      ? pctMeasured.reduce(
          (max, a) => Math.max(max, a.outsPercentMetric!.absoluteErrorPp),
          0,
        )
      : null;

  // #3: Sai số pot odds (target <= 3 pp, L2 slide 12–13; L7 slide 7–9)
  const poMeasured = attempts.filter((a) => a.potOddsMetric !== null);
  const poCount = poMeasured.length;
  const poWithinCount = poMeasured.filter((a) => a.potOddsMetric!.withinTarget).length;
  const poMeanAbsErrorPp =
    poCount > 0
      ? poMeasured.reduce((acc, a) => acc + a.potOddsMetric!.absoluteErrorPp, 0) / poCount
      : null;
  const poMaxAbsErrorPp =
    poCount > 0
      ? poMeasured.reduce((max, a) => Math.max(max, a.potOddsMetric!.absoluteErrorPp), 0)
      : null;

  // #4: Quyết định đúng ở spot rõ (strict > 5 pp threshold, target >= 90%, L2 slide 10–11, AC M3)
  const clearCounted = attempts.filter((a) => a.clearSpotMetric.counted);
  const clearCount = clearCounted.length;
  const excludedMarginalCount = attempts.filter((a) =>
    a.clearSpotMetric.requiredEquity > 0 && a.clearSpotMetric.heroDecision !== null &&
    !a.clearSpotMetric.isClearSpot,
  ).length;
  const clearCorrectCount = clearCounted.filter(
    (a) => a.clearSpotMetric.isCorrect === true,
  ).length;
  const clearAccuracyRatio = clearCount > 0 ? clearCorrectCount / clearCount : null;
  const clearAccuracyPercent = clearAccuracyRatio !== null ? clearAccuracyRatio * 100 : null;

  // #5: EV mất / quyết định (chip, giảm dần, L2 slide 8)
  const evCount = attempts.length;
  const totalEvLoss = attempts.reduce((acc, a) => acc + a.evLoss, 0);
  const meanEvLoss = evCount > 0 ? totalEvLoss / evCount : null;

  let recentMeanEvLoss: number | null = null;
  let earlierMeanEvLoss: number | null = null;
  let isDecreasingTrend: boolean | null = null;

  if (evCount > 0) {
    const splitPoint = Math.max(1, Math.floor(evCount / 2));
    const recentSlice = attempts.slice(-Math.min(10, Math.ceil(evCount / 2)));
    recentMeanEvLoss =
      recentSlice.reduce((acc, a) => acc + a.evLoss, 0) / recentSlice.length;

    if (evCount >= 2) {
      const earlierSlice = attempts.slice(0, splitPoint);
      earlierMeanEvLoss =
        earlierSlice.reduce((acc, a) => acc + a.evLoss, 0) / earlierSlice.length;
      isDecreasingTrend = recentMeanEvLoss <= earlierMeanEvLoss + 1e-9;
    }
  }

  // #6: Tốc độ trung vị câu đúng (ONLY correct decision attempts with valid responseTimeMs, L7 slide 5)
  const correctTimedValues = attempts
    .filter(
      (a) =>
        a.isDecisionCorrect &&
        a.responseTimeMs !== null &&
        Number.isFinite(a.responseTimeMs) &&
        a.responseTimeMs >= 0,
    )
    .map((a) => a.responseTimeMs!);

  const medianMs = computeMedian(correctTimedValues);
  const medianSeconds = medianMs !== null ? medianMs / 1000 : null;

  // #7: Đọc board texture (target >= 85%, L5 slide 23–24; L8 slide 18)
  const btMeasured = attempts.filter((a) => a.boardTextureMetric !== null);
  const btCount = btMeasured.length;
  const btCorrectCount = btMeasured.filter((a) => a.boardTextureMetric!.isCorrect).length;
  const btAccuracyRatio = btCount > 0 ? btCorrectCount / btCount : null;
  const btAccuracyPercent = btAccuracyRatio !== null ? btAccuracyRatio * 100 : null;

  // #8: Đọc theo kiểu rival (L5 slide 25, 41, 65)
  const byRival = buildRivalSummaries(attempts);

  return Object.freeze({
    outsAccuracy: Object.freeze({
      measuredCount: outsCount,
      correctCount: outsCorrectCount,
      accuracyRatio: outsAccuracyRatio,
      accuracyPercent: outsAccuracyPercent,
      meanAbsoluteError: outsMeanAbsError,
      targetPercent: OUTS_ACCURACY_TARGET_PERCENT,
      meetsTarget:
        outsAccuracyPercent !== null
          ? outsAccuracyPercent + 1e-9 >= OUTS_ACCURACY_TARGET_PERCENT
          : null,
      sourceRef: 'Hopkins L2 slide 24–27',
    }),
    outsPercentError: Object.freeze({
      measuredCount: pctCount,
      withinTargetCount: pctWithinCount,
      meanAbsoluteErrorPp: pctMeanAbsErrorPp,
      maxAbsoluteErrorPp: pctMaxAbsErrorPp,
      targetPp: OUTS_PROBABILITY_ERROR_TARGET_PP,
      meetsTarget:
        pctMeanAbsErrorPp !== null
          ? pctMeanAbsErrorPp <= OUTS_PROBABILITY_ERROR_TARGET_PP + 1e-9
          : null,
      sourceRef: 'L7 slide 6',
    }),
    potOddsError: Object.freeze({
      measuredCount: poCount,
      withinTargetCount: poWithinCount,
      meanAbsoluteErrorPp: poMeanAbsErrorPp,
      maxAbsoluteErrorPp: poMaxAbsErrorPp,
      targetPp: POT_ODDS_ERROR_TARGET_PP,
      meetsTarget:
        poMeanAbsErrorPp !== null
          ? poMeanAbsErrorPp <= POT_ODDS_ERROR_TARGET_PP + 1e-9
          : null,
      sourceRef: 'L2 slide 12–13; L7 slide 7–9',
    }),
    clearSpotAccuracy: Object.freeze({
      measuredCount: clearCount,
      excludedMarginalCount,
      correctCount: clearCorrectCount,
      accuracyRatio: clearAccuracyRatio,
      accuracyPercent: clearAccuracyPercent,
      thresholdPp: CLEAR_SPOT_THRESHOLD_PP,
      targetPercent: CLEAR_SPOT_ACCURACY_TARGET_PERCENT,
      meetsTarget:
        clearAccuracyPercent !== null
          ? clearAccuracyPercent + 1e-9 >= CLEAR_SPOT_ACCURACY_TARGET_PERCENT
          : null,
      sourceRef: 'L2 slide 10–11',
    }),
    evLossPerDecision: Object.freeze({
      measuredCount: evCount,
      meanEvLoss,
      totalEvLoss,
      recentMeanEvLoss,
      earlierMeanEvLoss,
      isDecreasingTrend,
      sourceRef: 'L2 slide 8',
    }),
    medianSpeedCorrect: Object.freeze({
      measuredCount: correctTimedValues.length,
      medianMs,
      medianSeconds,
      targetClockSeconds,
      meetsTarget:
        medianSeconds !== null ? medianSeconds < targetClockSeconds : null,
      sourceRef: 'L7 slide 5',
    }),
    boardTextureAccuracy: Object.freeze({
      measuredCount: btCount,
      correctCount: btCorrectCount,
      accuracyRatio: btAccuracyRatio,
      accuracyPercent: btAccuracyPercent,
      targetPercent: BOARD_TEXTURE_ACCURACY_TARGET_PERCENT,
      meetsTarget:
        btAccuracyPercent !== null
          ? btAccuracyPercent + 1e-9 >= BOARD_TEXTURE_ACCURACY_TARGET_PERCENT
          : null,
      sourceRef: 'L5 slide 23–24; L8 slide 18',
    }),
    byRival,
  });
}

/**
 * Builds the complete Progress Screen report (AC M4: trends over time, by concept, by level,
 * and by rival, plus empty state handling).
 */
export function buildDrillProgressReport(
  persisted: DrillPersistedState,
  targetClockSeconds = persisted.clockSeconds ?? DEFAULT_TARGET_CLOCK_SECONDS,
): DrillProgressReport {
  const attempts = persisted.attempts;
  const metrics = aggregateDrillMetrics(attempts, targetClockSeconds);

  // 1. Trend over time (`byTime` with rolling 5-attempt window)
  const byTime: DrillTimeTrendPoint[] = [];
  for (let i = 0; i < attempts.length; i++) {
    const att = attempts[i]!;
    const windowStart = Math.max(0, i - 4);
    const rollingSlice = attempts.slice(windowStart, i + 1);
    const rollingCorrect = rollingSlice.filter((a) => a.isDecisionCorrect).length;
    const rollingAccuracyPercent = (rollingCorrect / rollingSlice.length) * 100;
    const rollingMeanEvLoss =
      rollingSlice.reduce((acc, a) => acc + a.evLoss, 0) / rollingSlice.length;

    byTime.push(
      Object.freeze({
        attemptIndex: i + 1,
        sequenceIndex: att.sequenceIndex,
        labelVi: `Lần #${i + 1}`,
        conceptId: att.conceptId,
        level: att.level,
        primaryRivalId: att.primaryRivalId,
        isDecisionCorrect: att.isDecisionCorrect,
        rollingAccuracyPercent,
        evLoss: att.evLoss,
        rollingMeanEvLoss,
        outsError: att.outsMetric?.signedError ?? null,
        potOddsErrorPp: att.potOddsMetric?.absoluteErrorPp ?? null,
        responseTimeMs: att.responseTimeMs,
      }),
    );
  }

  // 2. Breakdown by concept (`byConcept`)
  const byConcept = {} as Record<DrillConceptId, DrillConceptProgress>;
  for (const conceptId of DRILL_CONCEPT_IDS) {
    const cAttempts = attempts.filter((a) => a.conceptId === conceptId);
    const measuredCount = cAttempts.length;
    const correctDecisions = cAttempts.filter((a) => a.isDecisionCorrect).length;
    const accuracyPercent =
      measuredCount > 0 ? (correctDecisions / measuredCount) * 100 : null;
    const meanEvLoss =
      measuredCount > 0
        ? cAttempts.reduce((acc, a) => acc + a.evLoss, 0) / measuredCount
        : null;

    const cOuts = cAttempts.filter((a) => a.outsMetric !== null);
    const outsAccuracyPercent =
      cOuts.length > 0
        ? (cOuts.filter((a) => a.outsMetric!.isCorrect).length / cOuts.length) * 100
        : null;

    const cPo = cAttempts.filter((a) => a.potOddsMetric !== null);
    const potOddsMeanErrorPp =
      cPo.length > 0
        ? cPo.reduce((acc, a) => acc + a.potOddsMetric!.absoluteErrorPp, 0) / cPo.length
        : null;

    byConcept[conceptId] = Object.freeze({
      conceptId,
      titleVi: DRILL_CONCEPT_TITLES_VI[conceptId],
      lessonCompleted: persisted.completedLessons.includes(conceptId),
      measuredCount,
      correctDecisions,
      accuracyPercent,
      meanEvLoss,
      outsAccuracyPercent,
      potOddsMeanErrorPp,
    });
  }

  // 3. Breakdown by level (`byLevel`)
  const byLevel = {} as Record<ActiveDrillLevel, DrillLevelProgress>;
  for (const level of [1, 2, 3] as const) {
    const lAttempts = attempts.filter((a) => a.level === level);
    const measuredCount = lAttempts.length;
    const correctDecisions = lAttempts.filter((a) => a.isDecisionCorrect).length;
    const accuracyPercent =
      measuredCount > 0 ? (correctDecisions / measuredCount) * 100 : null;
    const meanEvLoss =
      measuredCount > 0
        ? lAttempts.reduce((acc, a) => acc + a.evLoss, 0) / measuredCount
        : null;
    const hintUsedCount = lAttempts.filter((a) => a.hintUsed).length;
    const correctTimes = lAttempts
      .filter((a) => a.isDecisionCorrect && a.responseTimeMs !== null)
      .map((a) => a.responseTimeMs!);
    const medianCorrectTimeMs = computeMedian(correctTimes);

    byLevel[level] = Object.freeze({
      level,
      titleVi: DRILL_LEVEL_TITLES_VI[level],
      measuredCount,
      correctDecisions,
      accuracyPercent,
      meanEvLoss,
      hintUsedCount,
      medianCorrectTimeMs,
      levelUpSuggestion: evaluateLevelUpSuggestion(lAttempts, level),
    });
  }

  const overallLevelUpSuggestion = evaluateLevelUpSuggestion(
    attempts,
    persisted.lastSelectedLevel,
  );

  return Object.freeze({
    isEmpty: attempts.length === 0,
    totalAttempts: attempts.length,
    completedLessons: persisted.completedLessons,
    metrics,
    byTime: Object.freeze(byTime),
    byConcept: Object.freeze(byConcept),
    byLevel: Object.freeze(byLevel),
    byRival: metrics.byRival,
    overallLevelUpSuggestion,
  });
}
