import { describe, expect, it } from 'vitest';
import {
  buildFixtureDrillSpot,
  createDrillSession,
  DRILL_CONCEPT_IDS,
  evaluateLessonMiniCheck,
  finalizeDrillSessionHand,
  getAllDrillLessons,
  getDrillLesson,
  getVisibleFeedback,
  LEVEL1_STEP_ORDER,
  requestDrillHint,
  resolveLevel3TimeoutAction,
  submitLevel1Step,
  submitLevel2Decision,
  submitLevel3Decision,
} from '../../../src/engine/drill';
import { checkHandInvariants, checkInv1, createRng, type HandState } from '../../../src/engine';

function assertInvariants(state: HandState): void {
  const report = checkHandInvariants(state);
  expect(report.inv1).toEqual({ ok: true });
  expect(report.inv2.ok).toBe(true);
  expect(report.ok).toBe(true);
  expect(
    checkInv1([
      state.bank,
      state.pot,
      ...state.seats.map((s) => s.stack),
      ...state.seats.flatMap((s) => (s.declaration ? [s.declaration.reservedChips] : [])),
    ]),
  ).toEqual({ ok: true });
}

describe('P3 Drill — Levels 0–3, D1 step sequence, hint policies, and feedback visibility timing (D1–D3, C2)', () => {
  it('Level 0 (Cấp 0 — Học lại): provides 2–3 minute lessons, Accate examples, Lecture/slide citations, and in-lesson feedback for all 7 concepts', () => {
    const lessons = getAllDrillLessons();
    expect(lessons).toHaveLength(DRILL_CONCEPT_IDS.length);

    for (const conceptId of DRILL_CONCEPT_IDS) {
      const lesson = getDrillLesson(conceptId);
      expect(lesson.conceptId).toBe(conceptId);
      expect([2, 3]).toContain(lesson.estimatedMinutes);
      expect(lesson.lectureRefs.length).toBeGreaterThan(0);
      expect(lesson.lectureRefs.some((r) => /L\d+\s+slide/i.test(r))).toBe(true);
      expect(lesson.sections.length).toBeGreaterThanOrEqual(2);
      expect(lesson.accateExample.calculationStepsVi.length).toBeGreaterThanOrEqual(3);

      const correctCheck = evaluateLessonMiniCheck(conceptId, lesson.miniCheck.correctIndex);
      expect(correctCheck.isCorrect).toBe(true);
      expect(correctCheck.explanationVi.length).toBeGreaterThan(0);

      const wrongIndex = (lesson.miniCheck.correctIndex + 1) % lesson.miniCheck.optionsVi.length;
      const wrongCheck = evaluateLessonMiniCheck(conceptId, wrongIndex);
      expect(wrongCheck.isCorrect).toBe(false);
    }
  });

  it('D1 (Level 1 — Tính từng bước): asks in exact D1 order (outs -> unseen-cards -> turn-percent -> river-percent -> pot-odds -> action), gives free hints, and gives immediate per-step feedback pinpointing errors', () => {
    const spot = buildFixtureDrillSpot('h1-step7', createRng('d1-h1-seed'), undefined, 500);
    assertInvariants(spot.handState);

    expect(LEVEL1_STEP_ORDER).toEqual([
      'outs',
      'unseen-cards',
      'turn-percent',
      'river-percent',
      'pot-odds',
      'action',
    ]);

    let session = createDrillSession(spot, 1);
    expect(session.currentStepId).toBe('outs');

    // Out-of-order jump to 'pot-odds' before 'outs' is rejected
    const jumpAttempt = submitLevel1Step(session, { stepId: 'pot-odds', value: 30 });
    expect(jumpAttempt.ok).toBe(false);
    if (!jumpAttempt.ok) {
      expect(jumpAttempt.code).toBe('invalid-step-order');
    }

    // Free hint in Level 1: allowed and NOT recorded as metric penalty
    const hintRes = requestDrillHint(session);
    expect(hintRes.ok).toBe(true);
    if (hintRes.ok) {
      expect(hintRes.recordedInMetrics).toBe(false);
      expect(hintRes.session.hintUsed).toBe(false);
      expect(hintRes.hintVi).toContain('Bước 1');
      session = hintRes.session;
    }

    // Step 1 ('outs'): First test wrong answer (e.g. 5 outs instead of 2) -> immediate feedback pinpoints Step 1
    const wrongStep1 = submitLevel1Step(session, { stepId: 'outs', value: 5 });
    expect(wrongStep1.ok).toBe(true);
    if (wrongStep1.ok) {
      expect(wrongStep1.evaluation.stepId).toBe('outs');
      expect(wrongStep1.evaluation.isCorrect).toBe(false);
      expect(wrongStep1.evaluation.feedbackVi).toContain('Bước 1 (Đếm outs): Sai');
      expect(wrongStep1.evaluation.feedbackVi).toContain('2 lá');
    }

    // Re-submit correct answer for Step 1 ('outs' = 2)
    const step1 = submitLevel1Step(wrongStep1.ok ? wrongStep1.session : session, {
      stepId: 'outs',
      value: 2,
    });
    expect(step1.ok).toBe(true);
    if (!step1.ok) throw new Error('Step 1 failed');
    expect(step1.evaluation.isCorrect).toBe(true);
    session = step1.session;
    expect(session.currentStepId).toBe('unseen-cards');
    expect(getVisibleFeedback(session).kind).toBe('step-by-step');
    expect(getVisibleFeedback(session).stepFeedbacks.outs?.isCorrect).toBe(true);

    // Step 2 ('unseen-cards' = 47)
    const step2 = submitLevel1Step(session, { stepId: 'unseen-cards', value: 47 });
    expect(step2.ok).toBe(true);
    if (!step2.ok) throw new Error('Step 2 failed');
    expect(step2.evaluation.isCorrect).toBe(true);
    session = step2.session;
    expect(session.currentStepId).toBe('turn-percent');

    // Step 3 ('turn-percent' = 4.26%)
    const step3 = submitLevel1Step(session, { stepId: 'turn-percent', value: 4.26 });
    expect(step3.ok).toBe(true);
    if (!step3.ok) throw new Error('Step 3 failed');
    expect(step3.evaluation.isCorrect).toBe(true);
    session = step3.session;
    expect(session.currentStepId).toBe('river-percent');

    // Step 4 ('river-percent' = 8.42% or Rule of 4 = 8%)
    const step4 = submitLevel1Step(session, { stepId: 'river-percent', value: 8.42 });
    expect(step4.ok).toBe(true);
    if (!step4.ok) throw new Error('Step 4 failed');
    expect(step4.evaluation.isCorrect).toBe(true);
    expect(step4.evaluation.feedbackVi).toContain('8,42%');
    expect(step4.evaluation.feedbackVi).toContain('Rule of 4: 8%');
    session = step4.session;
    expect(session.currentStepId).toBe('pot-odds');

    // Step 5 ('pot-odds' = 30.0%)
    const step5 = submitLevel1Step(session, { stepId: 'pot-odds', value: 30 });
    expect(step5.ok).toBe(true);
    if (!step5.ok) throw new Error('Step 5 failed');
    expect(step5.evaluation.isCorrect).toBe(true);
    session = step5.session;
    expect(session.currentStepId).toBe('action');

    // Step 6 ('action'): First test invalid chip selection (35 points instead of 30, AC C2) -> rejected, no attempt recorded!
    const badChipsRes = submitLevel1Step(session, {
      stepId: 'action',
      action: { type: 'call', chips: { 5: 1, 10: 3, 50: 0, 100: 0 } },
    });
    expect(badChipsRes.ok).toBe(false);
    if (!badChipsRes.ok) {
      expect(badChipsRes.code).toBe('chips-mismatch-amount');
      expect(badChipsRes.session.attemptRecord).toBeNull();
    }

    // Valid physical chip selection (3x10 = 30 -> Call 30)
    const step6 = submitLevel1Step(session, {
      stepId: 'action',
      action: { type: 'call', chips: { 5: 0, 10: 3, 50: 0, 100: 0 } },
      boardTexture: 'wet',
      responseTimeMs: 9200,
      sequenceIndex: 1,
      rng: createRng('d1-complete-rng'),
    });
    expect(step6.ok).toBe(true);
    if (!step6.ok) throw new Error('Step 6 failed');
    session = step6.session;

    expect(session.phase).toBe('hand-completed');
    expect(session.attemptRecord).not.toBeNull();
    expect(session.attemptRecord!.hintUsed).toBe(false);
    expect(session.attemptRecord!.isDecisionCorrect).toBe(true);
    expect(session.attemptRecord!.decisionVsOutcomeBadgeVi).toBe('Quyết định: Tốt — thua do river');
    assertInvariants(session.postHandFeedback!.completedHandState);

    const visibleAfter = getVisibleFeedback(session);
    expect(visibleAfter.kind).toBe('full-post-hand');
    expect(visibleAfter.fullAnalysis?.decisionVsOutcomeBadgeVi).toBe(
      'Quyết định: Tốt — thua do river',
    );
  });

  it('D2 (Level 2 — Tự giải): enters all inputs in one turn, records hint usage, shows ONLY one line immediately after action, and shows full analysis only after hand finishes', () => {
    const spot = buildFixtureDrillSpot('h1-step7', createRng('d2-h1-seed'), undefined, 500);
    assertInvariants(spot.handState);

    let session = createDrillSession(spot, 2);

    // 1. Before action: no feedback visible
    expect(getVisibleFeedback(session)).toEqual({
      kind: 'none',
      stepFeedbacks: {},
      summaryLineVi: null,
      fullAnalysis: null,
    });

    // 2. Request hint in Level 2 -> recordedInMetrics: true
    const hintRes = requestDrillHint(session);
    expect(hintRes.ok).toBe(true);
    if (hintRes.ok) {
      expect(hintRes.recordedInMetrics).toBe(true);
      expect(hintRes.session.hintUsed).toBe(true);
      session = hintRes.session;
    }

    // 3. Submit one-shot inputs + valid physical-chip action (with autoCompleteHand: false to inspect mid-hand state)
    const submitRes = submitLevel2Decision(session, {
      outs: 2,
      turnPercent: 4.26,
      riverPercent: 8.42,
      potOddsPercent: 30.0,
      boardTexture: 'wet',
      action: { type: 'call', chips: { 5: 0, 10: 3, 50: 0, 100: 0 } },
      responseTimeMs: 11500,
      sequenceIndex: 2,
      autoCompleteHand: false,
      rng: createRng('d2-complete-rng'),
    });
    expect(submitRes.ok).toBe(true);
    if (!submitRes.ok) throw new Error('Level 2 submit failed');
    session = submitRes.session;

    expect(session.phase).toBe('action-submitted');
    assertInvariants(session.stateAfterHeroAction!);

    // IMMEDIATELY AFTER ACTION (before hand completes): ONLY 1 line is visible, fullAnalysis is NULL!
    const midFeedback = getVisibleFeedback(session);
    expect(midFeedback.kind).toBe('one-line');
    expect(typeof midFeedback.summaryLineVi).toBe('string');
    expect(midFeedback.summaryLineVi!.length).toBeGreaterThan(10);
    expect(midFeedback.fullAnalysis).toBeNull();

    // 4. Finalize hand -> full post-hand analysis becomes visible
    const finRes = finalizeDrillSessionHand(session);
    expect(finRes.ok).toBe(true);
    if (!finRes.ok) throw new Error('Finalize failed');
    session = finRes.session;

    expect(session.phase).toBe('hand-completed');
    const postFeedback = getVisibleFeedback(session);
    expect(postFeedback.kind).toBe('full-post-hand');
    expect(postFeedback.fullAnalysis).not.toBeNull();
    expect(postFeedback.fullAnalysis!.decisionVsOutcomeBadgeVi).toBe(
      'Quyết định: Tốt — thua do river',
    );
    expect(session.attemptRecord?.hintUsed).toBe(true);
    assertInvariants(postFeedback.fullAnalysis!.completedHandState);
  });

  it('D3 (Level 3 — Áp lực thật): blocks hints, accepts UI clock responseTimeMs into pure logic, hides ALL mid-hand feedback, and reveals feedback only after hand completes', () => {
    const spot = buildFixtureDrillSpot('h1-step13', createRng('d3-h1-13-seed'), undefined, 500);
    assertInvariants(spot.handState);

    let session = createDrillSession(spot, 3);

    // 1. Hints are strictly rejected in Level 3
    const hintAttempt = requestDrillHint(session);
    expect(hintAttempt.ok).toBe(false);
    if (!hintAttempt.ok) {
      expect(hintAttempt.code).toBe('hints-disabled-in-level-3');
    }

    // 2. Invalid action (illegal check facing a 50 bet) is rejected and does NOT record an attempt
    const illegalCheck = submitLevel3Decision(session, {
      action: { type: 'check' },
      responseTimeMs: 4200,
    });
    expect(illegalCheck.ok).toBe(false);
    if (!illegalCheck.ok) {
      expect(illegalCheck.code).toBe('cannot-check-facing-bet');
      expect(illegalCheck.session.attemptRecord).toBeNull();
    }

    // 3. Submit valid physical chip action (1x50 chip to Call 50) with UI timer responseTimeMs = 7850
    const submitRes = submitLevel3Decision(session, {
      action: { type: 'call', chips: { 5: 0, 10: 0, 50: 1, 100: 0 } },
      responseTimeMs: 7850,
      sequenceIndex: 3,
      autoCompleteHand: false,
      rng: createRng('d3-complete-rng'),
    });
    expect(submitRes.ok).toBe(true);
    if (!submitRes.ok) throw new Error('Level 3 submit failed');
    session = submitRes.session;

    expect(session.phase).toBe('action-submitted');
    assertInvariants(session.stateAfterHeroAction!);

    // MID-HAND in Level 3: ZERO feedback visible (kind: 'none', summaryLineVi: null, fullAnalysis: null)
    const midFeedback = getVisibleFeedback(session);
    expect(midFeedback).toEqual({
      kind: 'none',
      stepFeedbacks: {},
      summaryLineVi: null,
      fullAnalysis: null,
    });

    // 4. After hand completes: full post-hand feedback is revealed and responseTimeMs is stored
    const finRes = finalizeDrillSessionHand(session);
    expect(finRes.ok).toBe(true);
    if (!finRes.ok) throw new Error('Level 3 finalize failed');
    session = finRes.session;

    const postFeedback = getVisibleFeedback(session);
    expect(postFeedback.kind).toBe('full-post-hand');
    expect(postFeedback.fullAnalysis).not.toBeNull();
    expect(session.attemptRecord?.responseTimeMs).toBe(7850);
    expect(session.attemptRecord?.hintUsed).toBe(false);
    assertInvariants(postFeedback.fullAnalysis!.completedHandState);

    // 5. Verify Level 3 timeout action helper (D36: check when toCall === 0, fold when facing bet)
    expect(resolveLevel3TimeoutAction(spot)).toEqual({ type: 'fold' });
    const d8Spot = buildFixtureDrillSpot('d8-chase-draw', createRng('d3-timeout-d8'), undefined, 300);
    expect(resolveLevel3TimeoutAction(d8Spot)).toEqual({ type: 'check' });
  });
});
