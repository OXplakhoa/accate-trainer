import { describe, expect, it } from 'vitest';
import {
  aggregateDrillMetrics,
  buildDrillProgressReport,
  buildFixtureDrillSpot,
  createDrillSession,
  createInitialDrillPersistedState,
  DRILL_CONCEPT_IDS,
  DRILL_STORAGE_KEY,
  DRILL_STORAGE_VERSION,
  evaluateLevelUpSuggestion,
  loadDrillStateFromStorage,
  markLessonCompleted,
  parseDrillPersistedState,
  recordCompletedAttempt,
  saveDrillStateToStorage,
  submitLevel2Decision,
  updateDrillPreferences,
  type DrillAttemptRecord,
  type DrillStorageProvider,
} from '../../../src/engine/drill';
import {
  checkHandInvariants,
  checkInv1,
  createRng,
  evaluateClearSpotDecision,
  evaluateOutsCount,
  evaluateOutsProbabilityError,
  evaluatePotOddsError,
  initialDistribution,
  percentToRatio,
  RIVAL_IDS,
} from '../../../src/engine';

function assertPureInv1(): void {
  const dist = initialDistribution(6);
  expect(
    checkInv1([dist.bank, ...Array.from({ length: 6 }, () => dist.perPlayer)]),
  ).toEqual({ ok: true });
}

function makeAttemptFixture(overrides: Partial<DrillAttemptRecord>, seq = 1): DrillAttemptRecord {
  const defaultClear = evaluateClearSpotDecision({
    equity: 0.45,
    requiredEquity: 0.3,
    heroDecision: 'call',
  });
  const primaryRivalId = overrides.primaryRivalId ?? 'dien';
  return {
    attemptId: `att:${seq}`,
    sequenceIndex: seq,
    spotId: `spot:${seq}`,
    conceptId: 'outs',
    level: 1,
    street: 'flop',
    primaryRivalId,
    contestingRivalIds: [primaryRivalId],
    isNongTilted: false,
    actionTaken: 'call',
    actionAmount: 30,
    recommendedAction: 'call',
    isDecisionCorrect: true,
    evLoss: 0,
    chosenActionEv: 15,
    bestActionEv: 15,
    responseTimeMs: 8000,
    timedOut: false,
    hintUsed: false,
    outsMetric: evaluateOutsCount(8, 8),
    outsPercentMetric: evaluateOutsProbabilityError(0.32, 0.3145),
    potOddsMetric: evaluatePotOddsError(0.3, 0.3),
    clearSpotMetric: defaultClear,
    boardTextureMetric: {
      userClassification: 'wet',
      expectedClassification: 'wet',
      isCorrect: true,
    },
    handWon: true,
    decisionVsOutcomeBadgeVi: 'Quyết định: Tốt — thắng pot',
    ...overrides,
  };
}

describe('P3 Drill — Metrics M1–M4, level-up suggestion D7, and resilient versioned storage', () => {
  it('M1: hero enters 9 outs when expected answer is 8 on dirty-outs-flop-oesd -> records incorrect outs metric with error +1', () => {
    const spot = buildFixtureDrillSpot(
      'dirty-outs-flop-oesd',
      createRng('m1-dirty-outs-seed'),
      undefined,
      400,
    );
    expect(checkHandInvariants(spot.handState).ok).toBe(true);
    expect(spot.solution.expectedOuts).toBe(8);

    // Hero naively counts 9 hearts (failing to subtract the dirty out Qh that pairs Qc on board)
    const session = createDrillSession(spot, 2);
    const res = submitLevel2Decision(session, {
      outs: 9,
      riverPercent: 32,
      potOddsPercent: 37.5,
      action: { type: 'call', chips: { 5: 0, 10: 3, 50: 0, 100: 0 } },
      responseTimeMs: 10000,
      sequenceIndex: 1,
      autoCompleteHand: true,
      rng: createRng('m1-complete-rng'),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('Expected submission to succeed');

    const record = res.session.attemptRecord!;
    expect(record.outsMetric).not.toBeNull();
    expect(record.outsMetric!.userOuts).toBe(9);
    expect(record.outsMetric!.expectedOuts).toBe(8);
    expect(record.outsMetric!.isCorrect).toBe(false);
    expect(record.outsMetric!.signedError).toBe(1);
    expect(record.outsMetric!.absoluteError).toBe(1);

    const summary = aggregateDrillMetrics([record]);
    expect(summary.outsAccuracy.measuredCount).toBe(1);
    expect(summary.outsAccuracy.correctCount).toBe(0);
    expect(summary.outsAccuracy.accuracyPercent).toBe(0);
    expect(summary.outsAccuracy.meanAbsoluteError).toBe(1);
    expect(summary.outsAccuracy.meetsTarget).toBe(false);
  });

  it('M2 & M3: records 3.6 pp pot odds error (25% vs 21.4%) and excludes spots with margin <= 5 pp from clear-spot accuracy', () => {
    assertPureInv1();

    // M2: user enters 25% when required equity is 21.4% -> 3.6 pp error
    const poError = evaluatePotOddsError(percentToRatio(25), percentToRatio(21.4));
    expect(poError.absoluteErrorPp).toBeCloseTo(3.6, 10);
    expect(poError.withinTarget).toBe(false);

    // M3: marginal spot with |equity - requiredEquity| = 4.2 pp (< 5 pp) -> counted: false
    const marginalClear = evaluateClearSpotDecision({
      equity: 0.256,
      requiredEquity: 0.214,
      heroDecision: 'fold',
    });
    expect(marginalClear.marginPp).toBeCloseTo(4.2, 10);
    expect(marginalClear.isClearSpot).toBe(false);
    expect(marginalClear.counted).toBe(false);

    // Exact boundary 5.0 pp (0.264 vs 0.214) -> ALSO excluded because threshold is strictly > 5 pp
    const boundaryClear = evaluateClearSpotDecision({
      equity: 0.264,
      requiredEquity: 0.214,
      heroDecision: 'fold',
    });
    expect(boundaryClear.marginPp).toBeCloseTo(5.0, 10);
    expect(boundaryClear.isClearSpot).toBe(false);
    expect(boundaryClear.counted).toBe(false);

    // Clear spot with margin 12.0 pp (> 5 pp) -> counted: true
    const clearCallCorrect = evaluateClearSpotDecision({
      equity: 0.42,
      requiredEquity: 0.3,
      heroDecision: 'call',
    });
    expect(clearCallCorrect.isClearSpot).toBe(true);
    expect(clearCallCorrect.counted).toBe(true);
    expect(clearCallCorrect.isCorrect).toBe(true);

    const attMarginal = makeAttemptFixture(
      {
        potOddsMetric: poError,
        clearSpotMetric: marginalClear,
        isDecisionCorrect: false,
      },
      1,
    );
    const attBoundary = makeAttemptFixture(
      {
        clearSpotMetric: boundaryClear,
        isDecisionCorrect: false,
      },
      2,
    );
    const attClear = makeAttemptFixture(
      {
        clearSpotMetric: clearCallCorrect,
        isDecisionCorrect: true,
      },
      3,
    );

    const summary = aggregateDrillMetrics([attMarginal, attBoundary, attClear]);

    // Pot odds error tracks the 3.6 pp error
    expect(summary.potOddsError.measuredCount).toBe(3);
    expect(summary.potOddsError.maxAbsoluteErrorPp).toBeCloseTo(3.6, 10);

    // Clear spot accuracy ONLY counts attClear (1/1 = 100%) and excludes the 2 marginal/boundary spots
    expect(summary.clearSpotAccuracy.measuredCount).toBe(1);
    expect(summary.clearSpotAccuracy.excludedMarginalCount).toBe(2);
    expect(summary.clearSpotAccuracy.correctCount).toBe(1);
    expect(summary.clearSpotAccuracy.accuracyPercent).toBe(100);
    expect(summary.clearSpotAccuracy.meetsTarget).toBe(true);
  });

  it('computes all 8 metrics of Spec §10 including median speed strictly on correct answers, decreasing EV loss trend, board texture, and per-rival insights', () => {
    assertPureInv1();

    // Incorrect fast guesses (1000ms, 1500ms) MUST NOT skew the median speed of correct decisions!
    const attempts: DrillAttemptRecord[] = [
      makeAttemptFixture(
        {
          isDecisionCorrect: false,
          actionTaken: 'call',
          recommendedAction: 'fold',
          evLoss: 18,
          responseTimeMs: 1000,
          primaryRivalId: 'dien',
          boardTextureMetric: {
            userClassification: 'dry',
            expectedClassification: 'wet',
            isCorrect: false,
          },
        },
        1,
      ),
      makeAttemptFixture(
        {
          isDecisionCorrect: false,
          actionTaken: 'call',
          recommendedAction: 'fold',
          evLoss: 14,
          responseTimeMs: 1500,
          primaryRivalId: 'dien',
        },
        2,
      ),
      makeAttemptFixture(
        {
          isDecisionCorrect: true,
          evLoss: 2,
          responseTimeMs: 9000,
          primaryRivalId: 'cao',
        },
        3,
      ),
      makeAttemptFixture(
        {
          isDecisionCorrect: true,
          evLoss: 0,
          responseTimeMs: 11000,
          primaryRivalId: 'da',
        },
        4,
      ),
      makeAttemptFixture(
        {
          isDecisionCorrect: true,
          evLoss: 0,
          responseTimeMs: 15000,
          primaryRivalId: 'nong',
          isNongTilted: true,
        },
        5,
      ),
    ];

    const summary = aggregateDrillMetrics(attempts, 20);

    // Metric #6: Median speed ONLY over correct decisions [9000, 11000, 15000] -> 11000ms (11.0s < 20s)
    expect(summary.medianSpeedCorrect.measuredCount).toBe(3);
    expect(summary.medianSpeedCorrect.medianMs).toBe(11000);
    expect(summary.medianSpeedCorrect.medianSeconds).toBe(11);
    expect(summary.medianSpeedCorrect.meetsTarget).toBe(true);

    // Metric #5: EV loss decreasing trend (earlier [18, 14] mean 16 -> recent [2, 0, 0] mean 0.67)
    expect(summary.evLossPerDecision.measuredCount).toBe(5);
    expect(summary.evLossPerDecision.isDecreasingTrend).toBe(true);
    expect(summary.evLossPerDecision.recentMeanEvLoss!).toBeLessThan(
      summary.evLossPerDecision.earlierMeanEvLoss!,
    );

    // Metric #7: Board texture accuracy (4 correct out of 5 = 80%)
    expect(summary.boardTextureAccuracy.measuredCount).toBe(5);
    expect(summary.boardTextureAccuracy.correctCount).toBe(4);
    expect(summary.boardTextureAccuracy.accuracyPercent).toBe(80);

    // Metric #8: Per-rival tracking (hero called wrongly twice against Điên)
    expect(summary.byRival.dien.measuredCount).toBe(2);
    expect(summary.byRival.dien.wrongCallCount).toBe(2);
    expect(summary.byRival.dien.insightVi).toContain('Điên');
    expect(summary.byRival.dien.insightVi).toContain('call');
    expect(summary.byRival.nong.tiltedEncounterCount).toBe(1);
  });

  it('D7: suggests level-up ONLY when at least 20 recent attempts exist and accuracy is >= 80% (>= 16/20), without locking any level', () => {
    assertPureInv1();

    // 19 attempts at 100% -> NOT enough attempts (< 20)
    const nineteenCorrect = Array.from({ length: 19 }, (_, i) =>
      makeAttemptFixture({ level: 1, isDecisionCorrect: true }, i + 1),
    );
    const sug19 = evaluateLevelUpSuggestion(nineteenCorrect, 1);
    expect(sug19.recentAttemptCount).toBe(19);
    expect(sug19.shouldSuggestLevelUp).toBe(false);
    expect(sug19.suggestedNextLevel).toBeNull();

    // 20 attempts with 15 correct (75% < 80%) -> no suggestion
    const twentyAt75 = Array.from({ length: 20 }, (_, i) =>
      makeAttemptFixture({ level: 1, isDecisionCorrect: i < 15 }, i + 1),
    );
    const sug75 = evaluateLevelUpSuggestion(twentyAt75, 1);
    expect(sug75.recentAttemptCount).toBe(20);
    expect(sug75.recentCorrectCount).toBe(15);
    expect(sug75.recentAccuracyPercent).toBe(75);
    expect(sug75.shouldSuggestLevelUp).toBe(false);

    // 20 attempts with 16 correct (80% >= 80%) -> suggests Level 2!
    const twentyAt80 = Array.from({ length: 20 }, (_, i) =>
      makeAttemptFixture({ level: 1, isDecisionCorrect: i < 16 }, i + 1),
    );
    const sug80 = evaluateLevelUpSuggestion(twentyAt80, 1);
    expect(sug80.recentAttemptCount).toBe(20);
    expect(sug80.recentCorrectCount).toBe(16);
    expect(sug80.recentAccuracyPercent).toBe(80);
    expect(sug80.shouldSuggestLevelUp).toBe(true);
    expect(sug80.suggestedNextLevel).toBe(2);
    expect(sug80.messageVi).toContain('80%');
    expect(sug80.messageVi).toContain('Cấp 2');

    // Sliding window of 20: 10 old failures followed by 17 correct + 3 wrong in latest 20 (17/20 = 85%) -> suggests Level 3 from Level 2
    const thirtyWithStrongRecent = [
      ...Array.from({ length: 10 }, (_, i) =>
        makeAttemptFixture({ level: 2, isDecisionCorrect: false }, i + 1),
      ),
      ...Array.from({ length: 20 }, (_, i) =>
        makeAttemptFixture({ level: 2, isDecisionCorrect: i < 17 }, i + 11),
      ),
    ];
    const sugSliding = evaluateLevelUpSuggestion(thirtyWithStrongRecent, 2);
    expect(sugSliding.recentAttemptCount).toBe(20);
    expect(sugSliding.recentCorrectCount).toBe(17);
    expect(sugSliding.recentAccuracyPercent).toBe(85);
    expect(sugSliding.shouldSuggestLevelUp).toBe(true);
    expect(sugSliding.suggestedNextLevel).toBe(3);
  });

  it('M4 & storage resilience: builds empty and populated Progress reports (by time, concept, level, rival) and recovers from corrupted JSON, version mismatch, or blocked storage', () => {
    assertPureInv1();

    // 1. Empty state
    let state = createInitialDrillPersistedState();
    const emptyReport = buildDrillProgressReport(state);
    expect(emptyReport.isEmpty).toBe(true);
    expect(emptyReport.totalAttempts).toBe(0);
    expect(emptyReport.byTime).toHaveLength(0);
    expect(emptyReport.metrics.outsAccuracy.measuredCount).toBe(0);
    expect(emptyReport.metrics.outsAccuracy.accuracyPercent).toBeNull();
    expect(emptyReport.metrics.medianSpeedCorrect.medianMs).toBeNull();

    // 2. Populate lessons and attempts across concepts, levels, and rivals
    state = markLessonCompleted(state, 'outs');
    state = markLessonCompleted(state, 'pot-odds');
    state = updateDrillPreferences(state, {
      lastSelectedLevel: 2,
      lastSelectedConcept: 'pot-odds',
      clockSeconds: 15,
    });

    for (let i = 0; i < 6; i++) {
      const conceptId = DRILL_CONCEPT_IDS[i % DRILL_CONCEPT_IDS.length]!;
      const rivalId = RIVAL_IDS[i % RIVAL_IDS.length]!;
      const level = ((i % 3) + 1) as 1 | 2 | 3;
      state = recordCompletedAttempt(
        state,
        makeAttemptFixture(
          {
            conceptId,
            primaryRivalId: rivalId,
            contestingRivalIds: [rivalId],
            level,
            isDecisionCorrect: i !== 1,
            evLoss: i === 1 ? 10 : 0,
            hintUsed: level === 2 && i === 4,
          },
          i + 1,
        ),
      );
    }

    const report = buildDrillProgressReport(state);
    expect(report.isEmpty).toBe(false);
    expect(report.totalAttempts).toBe(6);
    expect(report.completedLessons).toEqual(['outs', 'pot-odds']);
    expect(report.byTime).toHaveLength(6);
    expect(Object.keys(report.byConcept)).toEqual([...DRILL_CONCEPT_IDS]);
    expect(Object.keys(report.byLevel)).toEqual(['1', '2', '3']);
    expect(Object.keys(report.byRival)).toEqual([...RIVAL_IDS]);
    expect(report.byConcept.outs.lessonCompleted).toBe(true);
    expect(report.byLevel[2].hintUsedCount).toBe(1);

    // 3. Round-trip save & load via memory storage provider
    const store = new Map<string, string>();
    const memoryProvider: DrillStorageProvider = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => {
        store.set(k, v);
      },
    };

    const saveRes = saveDrillStateToStorage(memoryProvider, state);
    expect(saveRes.ok).toBe(true);
    expect(store.has(DRILL_STORAGE_KEY)).toBe(true);

    const loadRes = loadDrillStateFromStorage(memoryProvider);
    expect(loadRes.storageAvailable).toBe(true);
    expect(loadRes.recoveredFromError).toBe(false);
    expect(loadRes.state.version).toBe(DRILL_STORAGE_VERSION);
    expect(loadRes.state.attempts).toHaveLength(6);
    expect(loadRes.state.completedLessons).toEqual(['outs', 'pot-odds']);
    expect(loadRes.state.clockSeconds).toBe(15);

    // 4. Corrupted JSON recovery
    const corruptJson = parseDrillPersistedState('{broken json');
    expect(corruptJson.recoveredFromError).toBe(true);
    expect(corruptJson.errorReason).toBe('invalid-json');
    expect(corruptJson.state.attempts).toHaveLength(0);

    // 5. Unsupported version recovery
    const wrongVersion = parseDrillPersistedState(
      JSON.stringify({ version: 99, attempts: [], completedLessons: [] }),
    );
    expect(wrongVersion.recoveredFromError).toBe(true);
    expect(wrongVersion.errorReason).toBe('unsupported-version:99');

    // 6. Malformed attempt items dropped while preserving valid attempts
    const mixedPayload = JSON.stringify({
      version: 1,
      nextSequenceIndex: 5,
      completedLessons: ['outs', 'invalid-concept'],
      attempts: [state.attempts[0], { corrupted: true }, state.attempts[1]],
    });
    const mixedParsed = parseDrillPersistedState(mixedPayload);
    expect(mixedParsed.recoveredFromError).toBe(true);
    expect(mixedParsed.errorReason).toBe('dropped-malformed-entries');
    expect(mixedParsed.state.attempts).toHaveLength(2);
    expect(mixedParsed.state.completedLessons).toEqual(['outs']);

    // 7. Blocked browser storage (throwing SecurityError on getter or read/write)
    const blockedGetter = (): DrillStorageProvider => {
      throw new Error('SecurityError: The operation is insecure.');
    };
    const blockedLoad = loadDrillStateFromStorage(blockedGetter);
    expect(blockedLoad.storageAvailable).toBe(false);
    expect(blockedLoad.recoveredFromError).toBe(true);
    expect(blockedLoad.errorReason).toBe('storage-access-blocked');
    expect(blockedLoad.state.attempts).toHaveLength(0);

    const quotaProvider: DrillStorageProvider = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const blockedSave = saveDrillStateToStorage(quotaProvider, state);
    expect(blockedSave.ok).toBe(false);
    expect(blockedSave.errorReason).toBe('storage-write-blocked');
  });
});
