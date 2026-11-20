import {
  evaluateClearSpotDecision,
  evaluateOutsCount,
  evaluateOutsProbabilityError,
  evaluatePotOddsError,
  OUTS_PROBABILITY_ERROR_TARGET_PP,
  percentToRatio,
  POT_ODDS_ERROR_TARGET_PP,
  type OutsCountMetric,
  type PercentagePointErrorMetric,
} from '../calculator';
import { formatCard } from '../cards';
import { chipValue } from '../chips';
import { applyAction, getLegalActions } from '../hand';
import type { BettingAction } from '../handTypes';
import { createRng, type Rng } from '../rng';
import { assertDrillHandInvariants } from './fixtures';
import { completeDrillHand } from './spotGenerator';
import {
  LEVEL1_STEP_ORDER,
  type ActiveDrillLevel,
  type BoardTextureClass,
  type DrillAttemptRecord,
  type DrillSessionErrorCode,
  type DrillSessionInputs,
  type DrillSessionState,
  type DrillSpot,
  type DrillVisibleFeedback,
  type Level1StepEvaluation,
  type Level1StepId,
} from './types';

function formatPctVi(ratio: number, decimals = 2): string {
  return `${(ratio * 100).toFixed(decimals).replace(/\.00$/, '').replace('.', ',')}%`;
}

function isFinitePercent(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Evaluates a single numeric step (Steps 1–5 of AC D1) against the spot's frozen solution.
 */
export function evaluateLevel1NumericStep(
  spot: DrillSpot,
  stepId: Exclude<Level1StepId, 'action'>,
  value: number,
):
  | { readonly ok: true; readonly evaluation: Level1StepEvaluation }
  | { readonly ok: false; readonly code: DrillSessionErrorCode; readonly message: string } {
  const { solution, snapshot } = spot;

  switch (stepId) {
    case 'outs': {
      if (!isNonNegativeInt(value) || value > 52) {
        return {
          ok: false,
          code: 'invalid-numeric-input',
          message: 'Số outs phải là số nguyên không âm (0–52).',
        };
      }
      const outsMetric = evaluateOutsCount(value, solution.expectedOuts);
      const cardsText =
        solution.expectedOutsCards.length > 0
          ? ` (${solution.expectedOutsCards.map(formatCard).join(', ')})`
          : '';
      const feedbackVi = outsMetric.isCorrect
        ? `Bước 1 (Đếm outs): Chính xác! Đáp án là ${solution.expectedOuts} lá${cardsText}. ${solution.expectedOutsExplanationVi}`
        : `Bước 1 (Đếm outs): Sai — bạn nhập ${value} outs (sai số ${outsMetric.signedError > 0 ? `+${outsMetric.signedError}` : outsMetric.signedError}), đáp án đúng là ${solution.expectedOuts} lá${cardsText}. ${solution.expectedOutsExplanationVi}`;

      return {
        ok: true,
        evaluation: Object.freeze({
          stepId: 'outs',
          isCorrect: outsMetric.isCorrect,
          userInputDisplay: `${value} lá`,
          expectedDisplay: `${solution.expectedOuts} lá${cardsText}`,
          feedbackVi,
          lectureRef: 'Hopkins L2 slide 24–27',
          outsMetric,
        }),
      };
    }

    case 'unseen-cards': {
      if (!isNonNegativeInt(value) || value < 1 || value > 52) {
        return {
          ok: false,
          code: 'invalid-numeric-input',
          message: 'Số lá chưa biết phải là số nguyên trong khoảng [1, 52].',
        };
      }
      const isCorrect = value === solution.unseenCards;
      const feedbackVi = isCorrect
        ? `Bước 2 (Số lá chưa biết): Chính xác! 52 lá trừ 2 lá riêng của bạn và ${snapshot.board.length} lá chung trên bàn còn ${solution.unseenCards} lá chưa biết.`
        : `Bước 2 (Số lá chưa biết): Sai — bạn nhập ${value} lá, đáp án đúng là ${solution.unseenCards} lá (52 − 2 lá riêng − ${snapshot.board.length} lá trên bàn = ${solution.unseenCards}).`;

      return {
        ok: true,
        evaluation: Object.freeze({
          stepId: 'unseen-cards',
          isCorrect,
          userInputDisplay: `${value} lá`,
          expectedDisplay: `${solution.unseenCards} lá`,
          feedbackVi,
          lectureRef: 'Hopkins L2 slide 24–27',
        }),
      };
    }

    case 'turn-percent': {
      if (!isFinitePercent(value)) {
        return {
          ok: false,
          code: 'invalid-numeric-input',
          message: 'Phần trăm trúng ở lá tiếp theo phải nằm trong khoảng [0, 100].',
        };
      }
      const percentMetric = evaluateOutsProbabilityError(
        percentToRatio(value),
        solution.nextCardExactProbability,
        OUTS_PROBABILITY_ERROR_TARGET_PP,
      );
      const exactVi = formatPctVi(solution.nextCardExactProbability);
      const r2Vi = solution.ruleOf2Percent !== null ? `${solution.ruleOf2Percent}%` : '0%';
      const stepLabel = snapshot.street === 'flop' ? '% trúng ở Turn' : '% trúng 1 lá tiếp theo';
      const feedbackVi = percentMetric.withinTarget
        ? `Bước 3 (${stepLabel}): Đúng (sai số ${percentMetric.absoluteErrorPp.toFixed(2).replace('.', ',')} điểm % ≤ mục tiêu 3%)! Chính xác ${solution.expectedOuts}/${solution.unseenCards} = ${exactVi} (Rule of 2: ${r2Vi}).`
        : `Bước 3 (${stepLabel}): Sai — bạn nhập ${value.toFixed(2).replace('.', ',')}% (lệch ${percentMetric.absoluteErrorPp.toFixed(2).replace('.', ',')} điểm % > 3%), đáp án chính xác là ${solution.expectedOuts}/${solution.unseenCards} = ${exactVi} (nhẩm Rule of 2: ${r2Vi}).`;

      return {
        ok: true,
        evaluation: Object.freeze({
          stepId: 'turn-percent',
          isCorrect: percentMetric.withinTarget,
          userInputDisplay: `${value.toFixed(2).replace('.', ',')}%`,
          expectedDisplay: `${exactVi} (Rule of 2: ${r2Vi})`,
          feedbackVi,
          lectureRef: 'Hopkins L7 slide 6',
          percentMetric,
        }),
      };
    }

    case 'river-percent': {
      if (!isFinitePercent(value)) {
        return {
          ok: false,
          code: 'invalid-numeric-input',
          message: 'Phần trăm trúng tới River phải nằm trong khoảng [0, 100].',
        };
      }
      const percentMetric = evaluateOutsProbabilityError(
        percentToRatio(value),
        solution.toRiverExactProbability,
        OUTS_PROBABILITY_ERROR_TARGET_PP,
      );
      const exactVi = formatPctVi(solution.toRiverExactProbability);
      const ruleVi =
        snapshot.street === 'flop'
          ? `Rule of 4: ${solution.ruleOf4Percent ?? 0}%${solution.expectedOuts > 8 ? ` (bản chỉnh >8 outs: ${solution.ruleOf4AdjustedPercent ?? 0}%)` : ''}`
          : `Rule of 2 (1 lá tới river): ${solution.ruleOf2Percent ?? 0}%`;
      const formulaVi =
        snapshot.street === 'flop'
          ? `1 − (${solution.unseenCards - solution.expectedOuts}·${solution.unseenCards - solution.expectedOuts - 1})/(${solution.unseenCards}·${solution.unseenCards - 1}) = ${exactVi}`
          : `${solution.expectedOuts}/${solution.unseenCards} = ${exactVi}`;

      const feedbackVi = percentMetric.withinTarget
        ? `Bước 4 (% trúng tới River): Đúng (sai số ${percentMetric.absoluteErrorPp.toFixed(2).replace('.', ',')} điểm % ≤ 3%)! Chính xác ${formulaVi} (${ruleVi}). ${solution.improvementVsWinEquityNoteVi}`
        : `Bước 4 (% trúng tới River): Sai — bạn nhập ${value.toFixed(2).replace('.', ',')}% (lệch ${percentMetric.absoluteErrorPp.toFixed(2).replace('.', ',')} điểm % > 3%), đáp án đúng là ${formulaVi} (${ruleVi}). ${solution.improvementVsWinEquityNoteVi}`;

      return {
        ok: true,
        evaluation: Object.freeze({
          stepId: 'river-percent',
          isCorrect: percentMetric.withinTarget,
          userInputDisplay: `${value.toFixed(2).replace('.', ',')}%`,
          expectedDisplay: `${exactVi} (${ruleVi})`,
          feedbackVi,
          lectureRef: 'Hopkins L7 slide 6–9',
          percentMetric,
        }),
      };
    }

    case 'pot-odds': {
      if (!isFinitePercent(value)) {
        return {
          ok: false,
          code: 'invalid-numeric-input',
          message: 'Pot odds (%) phải nằm trong khoảng [0, 100].',
        };
      }
      const potOddsMetric = evaluatePotOddsError(
        percentToRatio(value),
        solution.potOdds.requiredEquity,
        POT_ODDS_ERROR_TARGET_PP,
      );
      const exactVi = formatPctVi(solution.potOdds.requiredEquity, 1);
      const ratioDetail = solution.potOdds.hasCall
        ? `${snapshot.callAmount} / (${solution.potOdds.potBeforeCall} + ${snapshot.callAmount}) = ${snapshot.callAmount}/${solution.potOdds.potAfterCall} = ${exactVi} (${solution.potOdds.potToCallLabel})`
        : '0% (không cần call)';
      const feedbackVi = potOddsMetric.withinTarget
        ? `Bước 5 (Pot odds / Equity cần): Đúng (sai số ${potOddsMetric.absoluteErrorPp.toFixed(1).replace('.', ',')} điểm % ≤ 3%)! Equity cần = ${ratioDetail}.`
        : `Bước 5 (Pot odds / Equity cần): Sai — bạn nhập ${value.toFixed(1).replace('.', ',')}% (lệch ${potOddsMetric.absoluteErrorPp.toFixed(1).replace('.', ',')} điểm % > 3%), đáp án đúng là ${ratioDetail}.`;

      return {
        ok: true,
        evaluation: Object.freeze({
          stepId: 'pot-odds',
          isCorrect: potOddsMetric.withinTarget,
          userInputDisplay: `${value.toFixed(1).replace('.', ',')}%`,
          expectedDisplay: `${exactVi} (${solution.potOdds.potToCallLabel})`,
          feedbackVi,
          lectureRef: 'Hopkins L2 slide 12–13; L7 slide 7–9',
          potOddsMetric,
        }),
      };
    }
  }
}

/**
 * Creates a new drill session for a spot at Level 1, 2, or 3.
 */
export function createDrillSession(
  spot: DrillSpot,
  level: ActiveDrillLevel,
): DrillSessionState {
  assertDrillHandInvariants(spot.handState, 'createDrillSession');
  return Object.freeze({
    level,
    spot,
    phase: 'answering',
    currentStepIndex: 0,
    currentStepId: LEVEL1_STEP_ORDER[0],
    stepFeedbacks: Object.freeze({}),
    inputs: Object.freeze({}),
    hintUsed: false,
    hintsRequestedCount: 0,
    lastHintVi: null,
    submittedAction: null,
    stateAfterHeroAction: null,
    responseTimeMs: null,
    timedOut: false,
    oneLineFeedbackVi: null,
    postHandFeedback: null,
    attemptRecord: null,
  });
}

/**
 * Requests a hint for the current session:
 * - Level 1: Free hint (`recordedInMetrics: false`, `session.hintUsed` remains `false`).
 * - Level 2: Hint allowed and recorded in metrics (`recordedInMetrics: true`, `session.hintUsed = true`).
 * - Level 3: Hints strictly forbidden (`ok: false, code: 'hints-disabled-in-level-3'`, AC D3).
 */
export function requestDrillHint(
  session: DrillSessionState,
  stepId?: Level1StepId,
):
  | {
      readonly ok: true;
      readonly hintVi: string;
      readonly recordedInMetrics: boolean;
      readonly session: DrillSessionState;
    }
  | {
      readonly ok: false;
      readonly code: 'hints-disabled-in-level-3';
      readonly message: string;
      readonly session: DrillSessionState;
    } {
  if (session.level === 3) {
    return {
      ok: false,
      code: 'hints-disabled-in-level-3',
      message: 'Cấp 3 (Áp lực thật) không có gợi ý (hint).',
      session,
    };
  }

  const targetStep = stepId ?? session.currentStepId;
  const hintVi =
    session.level === 1
      ? session.spot.solution.stepHintsVi[targetStep]
      : `${session.spot.solution.stepHintsVi.outs} · ${session.spot.solution.stepHintsVi['pot-odds']} · ${session.spot.solution.stepHintsVi.action}`;
  const recordedInMetrics = session.level === 2;

  const nextSession: DrillSessionState = Object.freeze({
    ...session,
    hintUsed: session.hintUsed || recordedInMetrics,
    hintsRequestedCount: session.hintsRequestedCount + 1,
    lastHintVi: hintVi,
  });

  return {
    ok: true,
    hintVi,
    recordedInMetrics,
    session: nextSession,
  };
}

function buildAttemptRecord(params: {
  readonly session: DrillSessionState;
  readonly action: BettingAction;
  readonly postHandFeedback: NonNullable<DrillSessionState['postHandFeedback']>;
  readonly inputs: DrillSessionInputs;
  readonly responseTimeMs: number | null;
  readonly timedOut: boolean;
  readonly sequenceIndex: number;
  readonly recordedAtIso?: string;
}): DrillAttemptRecord {
  const { session, action, postHandFeedback, inputs, responseTimeMs, timedOut, sequenceIndex, recordedAtIso } =
    params;
  const { spot } = session;
  const { solution, snapshot } = spot;

  const outsMetric: OutsCountMetric | null =
    inputs.outs !== undefined ? evaluateOutsCount(inputs.outs, solution.expectedOuts) : null;

  const targetRiverProb =
    snapshot.street === 'turn'
      ? solution.nextCardExactProbability
      : solution.toRiverExactProbability;
  const userPercentValue = inputs.riverPercent ?? inputs.turnPercent;
  const outsPercentMetric: PercentagePointErrorMetric | null =
    userPercentValue !== undefined
      ? evaluateOutsProbabilityError(
          percentToRatio(userPercentValue),
          targetRiverProb,
          OUTS_PROBABILITY_ERROR_TARGET_PP,
        )
      : null;

  const potOddsMetric: PercentagePointErrorMetric | null =
    inputs.potOddsPercent !== undefined
      ? evaluatePotOddsError(
          percentToRatio(inputs.potOddsPercent),
          solution.potOdds.requiredEquity,
          POT_ODDS_ERROR_TARGET_PP,
        )
      : null;

  const heroDecision = action.type === 'call' || action.type === 'fold' ? action.type : null;
  const evaluatedClear = evaluateClearSpotDecision({
    equity: solution.effectiveEquity,
    requiredEquity: solution.potOdds.requiredEquity,
    heroDecision: heroDecision ?? 'call',
  });
  const clearSpotMetric = solution.potOdds.hasCall && heroDecision !== null
    ? evaluatedClear
    : Object.freeze({ ...evaluatedClear, ...solution.clearSpot, heroDecision, counted: false, isCorrect: null });

  const boardTextureMetric =
    inputs.boardTexture !== undefined
      ? Object.freeze({
          userClassification: inputs.boardTexture,
          expectedClassification: solution.boardTexture.classification,
          isCorrect: inputs.boardTexture === solution.boardTexture.classification,
        })
      : null;

  const actionAmount =
    action.type === 'bet'
      ? action.amount
      : action.type === 'raise'
        ? action.raiseTo
        : action.type === 'call'
          ? chipValue(action.chips)
          : 0;

  return Object.freeze({
    attemptId: `${spot.spotId}:L${session.level}:${sequenceIndex}`,
    sequenceIndex,
    ...(recordedAtIso !== undefined ? { recordedAtIso } : {}),
    spotId: spot.spotId,
    conceptId: spot.conceptId,
    level: session.level,
    street: snapshot.street,
    primaryRivalId: spot.primaryRivalId,
    contestingRivalIds: spot.contestingRivalIds,
    isNongTilted: spot.nongTiltState.isTilted && spot.nongTiltState.handsRemaining > 0,
    actionTaken: action.type,
    actionAmount,
    recommendedAction: solution.actionEvs.bestOption.actionType,
    isDecisionCorrect: postHandFeedback.isDecisionCorrect,
    evLoss: postHandFeedback.evLoss,
    chosenActionEv: postHandFeedback.chosenActionEv,
    bestActionEv: postHandFeedback.bestActionEv,
    responseTimeMs:
      responseTimeMs !== null && Number.isFinite(responseTimeMs) && responseTimeMs >= 0
        ? Math.round(responseTimeMs)
        : null,
    timedOut,
    hintUsed: session.level === 2 ? session.hintUsed : false,
    outsMetric,
    outsPercentMetric,
    potOddsMetric,
    clearSpotMetric,
    boardTextureMetric,
    handWon: postHandFeedback.heroWonHand,
    decisionVsOutcomeBadgeVi: postHandFeedback.decisionVsOutcomeBadgeVi,
  });
}

/**
 * Submits a step in Level 1 (Cấp 1 — Tính từng bước, AC D1).
 * Enforces the D1 order: `outs` -> `unseen-cards` -> `turn-percent` -> `river-percent` -> `pot-odds` -> `action`.
 * Returns immediate feedback after every single step and pinpoints any incorrect step.
 */
export function submitLevel1Step(
  session: DrillSessionState,
  payload:
    | {
        readonly stepId: Exclude<Level1StepId, 'action'>;
        readonly value: number;
      }
    | {
        readonly stepId: 'action';
        readonly action: BettingAction;
        readonly boardTexture?: BoardTextureClass;
        readonly responseTimeMs?: number;
        readonly sequenceIndex?: number;
        readonly recordedAtIso?: string;
        readonly autoCompleteHand?: boolean;
        readonly rng?: Rng;
      },
):
  | {
      readonly ok: true;
      readonly evaluation: Level1StepEvaluation;
      readonly session: DrillSessionState;
    }
  | {
      readonly ok: false;
      readonly code: DrillSessionErrorCode;
      readonly message: string;
      readonly session: DrillSessionState;
    } {
  if (session.phase !== 'answering') {
    return {
      ok: false,
      code: 'already-submitted',
      message: 'Lượt drill này đã kết thúc.',
      session,
    };
  }

  const targetStepIdx = LEVEL1_STEP_ORDER.indexOf(payload.stepId);
  if (targetStepIdx === -1 || targetStepIdx > session.currentStepIndex) {
    return {
      ok: false,
      code: 'invalid-step-order',
      message: `Cấp 1 yêu cầu trả lời theo đúng thứ tự D1: hiện đang ở bước "${session.currentStepId}", không thể nhảy tới "${payload.stepId}".`,
      session,
    };
  }

  if (payload.stepId !== 'action') {
    const evalRes = evaluateLevel1NumericStep(session.spot, payload.stepId, payload.value);
    if (!evalRes.ok) {
      return {
        ok: false,
        code: evalRes.code,
        message: evalRes.message,
        session,
      };
    }

    const nextInputs: DrillSessionInputs = Object.freeze({
      ...session.inputs,
      ...(payload.stepId === 'outs' ? { outs: payload.value } : {}),
      ...(payload.stepId === 'unseen-cards' ? { unseenCards: payload.value } : {}),
      ...(payload.stepId === 'turn-percent' ? { turnPercent: payload.value } : {}),
      ...(payload.stepId === 'river-percent' ? { riverPercent: payload.value } : {}),
      ...(payload.stepId === 'pot-odds' ? { potOddsPercent: payload.value } : {}),
    });

    const nextStepFeedbacks = Object.freeze({
      ...session.stepFeedbacks,
      [payload.stepId]: evalRes.evaluation,
    });

    const nextIdx =
      targetStepIdx === session.currentStepIndex
        ? Math.min(LEVEL1_STEP_ORDER.length - 1, session.currentStepIndex + 1)
        : session.currentStepIndex;

    const nextSession: DrillSessionState = Object.freeze({
      ...session,
      currentStepIndex: nextIdx,
      currentStepId: LEVEL1_STEP_ORDER[nextIdx]!,
      stepFeedbacks: nextStepFeedbacks,
      inputs: nextInputs,
    });

    return {
      ok: true,
      evaluation: evalRes.evaluation,
      session: nextSession,
    };
  }

  // Step 6: 'action' — validate physical chips and legal action through engine
  const completion = completeDrillHand(
    session.spot,
    payload.action,
    payload.rng ?? createRng(`L1-complete:${session.spot.spotId}`),
  );
  if (!completion.ok) {
    return {
      ok: false,
      code: completion.code,
      message: completion.message,
      session,
    };
  }

  const { postHandFeedback, stateAfterHeroAction } = completion;
  const actionEval: Level1StepEvaluation = Object.freeze({
    stepId: 'action',
    isCorrect: postHandFeedback.isDecisionCorrect,
    userInputDisplay: postHandFeedback.heroActionLabelVi,
    expectedDisplay: session.spot.solution.actionEvs.bestOption.labelVi,
    feedbackVi: postHandFeedback.isDecisionCorrect
      ? `Bước 6 (Hành động): Chính xác! ${postHandFeedback.oneLineSummaryVi}`
      : `Bước 6 (Hành động): Chưa tối ưu — bạn chọn ${postHandFeedback.heroActionLabelVi} (mất ${postHandFeedback.evLoss.toFixed(1)} chip EV so với ${session.spot.solution.actionEvs.bestOption.labelVi}). ${session.spot.solution.actionEvs.explanationVi}`,
    lectureRef: session.spot.solution.lectureRef,
  });

  const nextInputs: DrillSessionInputs = Object.freeze({
    ...session.inputs,
    ...(payload.boardTexture !== undefined ? { boardTexture: payload.boardTexture } : {}),
  });

  const nextStepFeedbacks = Object.freeze({
    ...session.stepFeedbacks,
    action: actionEval,
  });

  const autoComplete = payload.autoCompleteHand ?? true;
  const attemptRecord = buildAttemptRecord({
    session,
    action: payload.action,
    postHandFeedback,
    inputs: nextInputs,
    responseTimeMs: payload.responseTimeMs ?? null,
    timedOut: false,
    sequenceIndex: payload.sequenceIndex ?? 1,
    recordedAtIso: payload.recordedAtIso,
  });

  const nextSession: DrillSessionState = Object.freeze({
    ...session,
    phase: autoComplete ? 'hand-completed' : 'action-submitted',
    currentStepIndex: LEVEL1_STEP_ORDER.length - 1,
    currentStepId: 'action',
    stepFeedbacks: nextStepFeedbacks,
    inputs: nextInputs,
    submittedAction: payload.action,
    stateAfterHeroAction,
    responseTimeMs: payload.responseTimeMs ?? null,
    oneLineFeedbackVi: postHandFeedback.oneLineSummaryVi,
    postHandFeedback,
    attemptRecord,
  });

  return {
    ok: true,
    evaluation: actionEval,
    session: nextSession,
  };
}

/**
 * Submits a one-shot answer and physical-chip action in Level 2 (Cấp 2 — Tự giải, AC D2).
 * - Only records the attempt when all numeric inputs and physical chip selection are valid.
 * - Immediately enters `'action-submitted'` where ONLY a 1-line summary is visible
 *   (unless `autoCompleteHand: true` is passed to advance immediately to `'hand-completed'`).
 */
export function submitLevel2Decision(
  session: DrillSessionState,
  input: {
    readonly outs?: number;
    readonly turnPercent?: number;
    readonly riverPercent?: number;
    readonly potOddsPercent: number;
    readonly unseenCards?: number;
    readonly boardTexture?: BoardTextureClass;
    readonly action: BettingAction;
    readonly responseTimeMs?: number;
    readonly sequenceIndex?: number;
    readonly recordedAtIso?: string;
    readonly autoCompleteHand?: boolean;
    readonly rng?: Rng;
  },
):
  | { readonly ok: true; readonly session: DrillSessionState }
  | {
      readonly ok: false;
      readonly code: DrillSessionErrorCode;
      readonly message: string;
      readonly session: DrillSessionState;
    } {
  if (session.phase !== 'answering') {
    return {
      ok: false,
      code: 'already-submitted',
      message: 'Lượt drill này đã được gửi.',
      session,
    };
  }

  const outsEval = input.outs === undefined ? undefined : evaluateLevel1NumericStep(session.spot, 'outs', input.outs);
  if (outsEval !== undefined && !outsEval.ok) return { ok: false, code: outsEval.code, message: outsEval.message, session };
  const riverEval = input.riverPercent === undefined ? undefined : evaluateLevel1NumericStep(session.spot, 'river-percent', input.riverPercent);
  if (riverEval !== undefined && !riverEval.ok) return { ok: false, code: riverEval.code, message: riverEval.message, session };
  const potOddsEval = evaluateLevel1NumericStep(session.spot, 'pot-odds', input.potOddsPercent);
  if (!potOddsEval.ok) {
    return { ok: false, code: potOddsEval.code, message: potOddsEval.message, session };
  }

  let turnEval: Level1StepEvaluation | undefined;
  if (input.turnPercent !== undefined) {
    const res = evaluateLevel1NumericStep(session.spot, 'turn-percent', input.turnPercent);
    if (!res.ok) {
      return { ok: false, code: res.code, message: res.message, session };
    }
    turnEval = res.evaluation;
  }

  // Validate action and physical chips via engine before recording anything
  const completion = completeDrillHand(
    session.spot,
    input.action,
    input.rng ?? createRng(`L2-complete:${session.spot.spotId}`),
  );
  if (!completion.ok) {
    return {
      ok: false,
      code: completion.code,
      message: completion.message,
      session,
    };
  }

  const { postHandFeedback, stateAfterHeroAction } = completion;
  const nextInputs: DrillSessionInputs = Object.freeze({
    ...(input.outs !== undefined ? { outs: input.outs } : {}),
    ...(input.unseenCards !== undefined ? { unseenCards: input.unseenCards } : {}),
    ...(input.turnPercent !== undefined ? { turnPercent: input.turnPercent } : {}),
    ...(input.riverPercent !== undefined ? { riverPercent: input.riverPercent } : {}),
    potOddsPercent: input.potOddsPercent,
    ...(input.boardTexture !== undefined ? { boardTexture: input.boardTexture } : {}),
  });

  const actionEval: Level1StepEvaluation = Object.freeze({
    stepId: 'action',
    isCorrect: postHandFeedback.isDecisionCorrect,
    userInputDisplay: postHandFeedback.heroActionLabelVi,
    expectedDisplay: session.spot.solution.actionEvs.bestOption.labelVi,
    feedbackVi: postHandFeedback.oneLineSummaryVi,
    lectureRef: session.spot.solution.lectureRef,
  });

  const stepFeedbacks = Object.freeze({
    ...(outsEval?.ok ? { outs: outsEval.evaluation } : {}),
    ...(turnEval !== undefined ? { 'turn-percent': turnEval } : {}),
    ...(riverEval?.ok ? { 'river-percent': riverEval.evaluation } : {}),
    'pot-odds': potOddsEval.evaluation,
    action: actionEval,
  });

  const attemptRecord = buildAttemptRecord({
    session,
    action: input.action,
    postHandFeedback,
    inputs: nextInputs,
    responseTimeMs: input.responseTimeMs ?? null,
    timedOut: false,
    sequenceIndex: input.sequenceIndex ?? 1,
    recordedAtIso: input.recordedAtIso,
  });

  const nextSession: DrillSessionState = Object.freeze({
    ...session,
    phase: input.autoCompleteHand === true ? 'hand-completed' : 'action-submitted',
    stepFeedbacks,
    inputs: nextInputs,
    submittedAction: input.action,
    stateAfterHeroAction,
    responseTimeMs: input.responseTimeMs ?? null,
    oneLineFeedbackVi: postHandFeedback.oneLineSummaryVi,
    postHandFeedback,
    attemptRecord,
  });

  return { ok: true, session: nextSession };
}

/**
 * Resolves the fallback action when the Level 3 timer expires (D36: Check if legal, else Fold).
 */
export function resolveLevel3TimeoutAction(spot: DrillSpot): BettingAction {
  const legal = getLegalActions(spot.handState);
  if (legal !== null && legal.canCheck) {
    return Object.freeze({ type: 'check' });
  }
  return Object.freeze({ type: 'fold' });
}

/**
 * Submits a timed decision in Level 3 (Cấp 3 — Áp lực thật, AC D3).
 * - Accepts `responseTimeMs` from the UI clock into pure logic.
 * - No feedback is visible during `'action-submitted'` (mid-hand); feedback only appears after
 *   the hand completes (`'hand-completed'`).
 */
export function submitLevel3Decision(
  session: DrillSessionState,
  input: {
    readonly action: BettingAction;
    readonly responseTimeMs: number;
    readonly timedOut?: boolean;
    readonly outs?: number;
    readonly riverPercent?: number;
    readonly potOddsPercent?: number;
    readonly boardTexture?: BoardTextureClass;
    readonly sequenceIndex?: number;
    readonly recordedAtIso?: string;
    readonly autoCompleteHand?: boolean;
    readonly rng?: Rng;
  },
):
  | { readonly ok: true; readonly session: DrillSessionState }
  | {
      readonly ok: false;
      readonly code: DrillSessionErrorCode;
      readonly message: string;
      readonly session: DrillSessionState;
    } {
  if (session.phase !== 'answering') {
    return {
      ok: false,
      code: 'already-submitted',
      message: 'Lượt drill này đã kết thúc.',
      session,
    };
  }
  if (typeof input.responseTimeMs !== 'number' || !Number.isFinite(input.responseTimeMs) || input.responseTimeMs < 0) {
    return {
      ok: false,
      code: 'invalid-numeric-input',
      message: 'Thời gian phản hồi (responseTimeMs) phải là số không âm hợp lệ.',
      session,
    };
  }

  // Validate action and physical chips via engine first
  const actionStep = applyAction(session.spot.handState, session.spot.heroId, input.action);
  if (!actionStep.ok) {
    return {
      ok: false,
      code: actionStep.code,
      message: actionStep.message,
      session,
    };
  }

  const completion = completeDrillHand(
    session.spot,
    input.action,
    input.rng ?? createRng(`L3-complete:${session.spot.spotId}`),
  );
  if (!completion.ok) {
    return {
      ok: false,
      code: completion.code,
      message: completion.message,
      session,
    };
  }

  const { postHandFeedback, stateAfterHeroAction } = completion;
  const nextInputs: DrillSessionInputs = Object.freeze({
    ...(input.outs !== undefined ? { outs: input.outs } : {}),
    ...(input.riverPercent !== undefined ? { riverPercent: input.riverPercent } : {}),
    ...(input.potOddsPercent !== undefined ? { potOddsPercent: input.potOddsPercent } : {}),
    ...(input.boardTexture !== undefined ? { boardTexture: input.boardTexture } : {}),
  });

  const attemptRecord = buildAttemptRecord({
    session,
    action: input.action,
    postHandFeedback,
    inputs: nextInputs,
    responseTimeMs: input.responseTimeMs,
    timedOut: input.timedOut ?? false,
    sequenceIndex: input.sequenceIndex ?? 1,
    recordedAtIso: input.recordedAtIso,
  });

  const nextSession: DrillSessionState = Object.freeze({
    ...session,
    phase: input.autoCompleteHand === true ? 'hand-completed' : 'action-submitted',
    inputs: nextInputs,
    submittedAction: input.action,
    stateAfterHeroAction,
    responseTimeMs: input.responseTimeMs,
    timedOut: input.timedOut ?? false,
    oneLineFeedbackVi: postHandFeedback.oneLineSummaryVi,
    postHandFeedback,
    attemptRecord,
  });

  return { ok: true, session: nextSession };
}

/**
 * Transitions a session from `'action-submitted'` to `'hand-completed'` once the hand runout
 * finishes, unlocking full post-hand analysis for Level 2 and Level 3.
 */
export function finalizeDrillSessionHand(
  session: DrillSessionState,
):
  | { readonly ok: true; readonly session: DrillSessionState }
  | {
      readonly ok: false;
      readonly code: 'action-not-submitted';
      readonly message: string;
      readonly session: DrillSessionState;
    } {
  if (session.phase === 'answering' || session.postHandFeedback === null) {
    return {
      ok: false,
      code: 'action-not-submitted',
      message: 'Cần xác nhận hành động hợp lệ trước khi kết thúc ván.',
      session,
    };
  }
  if (session.phase === 'hand-completed') {
    return { ok: true, session };
  }
  return {
    ok: true,
    session: Object.freeze({
      ...session,
      phase: 'hand-completed',
    }),
  };
}

/**
 * Pure selector enforcing the exact feedback visibility timing rules for each Drill level (AC D1, D2, D3):
 * - Level 1: Immediate step-by-step feedback during `'answering'` and `'action-submitted'`, plus full post-hand analysis at `'hand-completed'`.
 * - Level 2: No feedback during `'answering'`; ONLY 1-line summary at `'action-submitted'`; full post-hand analysis at `'hand-completed'`.
 * - Level 3: NO feedback during `'answering'` or `'action-submitted'`; full post-hand analysis ONLY at `'hand-completed'`.
 */
export function getVisibleFeedback(session: DrillSessionState): DrillVisibleFeedback {
  if (session.level === 1) {
    if (session.phase === 'hand-completed' && session.postHandFeedback !== null) {
      return Object.freeze({
        kind: 'full-post-hand',
        stepFeedbacks: session.stepFeedbacks,
        summaryLineVi: session.postHandFeedback.oneLineSummaryVi,
        fullAnalysis: session.postHandFeedback,
      });
    }
    return Object.freeze({
      kind: 'step-by-step',
      stepFeedbacks: session.stepFeedbacks,
      summaryLineVi: session.oneLineFeedbackVi,
      fullAnalysis: null,
    });
  }

  if (session.level === 2) {
    if (session.phase === 'answering') {
      return Object.freeze({
        kind: 'none',
        stepFeedbacks: Object.freeze({}),
        summaryLineVi: null,
        fullAnalysis: null,
      });
    }
    if (session.phase === 'action-submitted') {
      return Object.freeze({
        kind: 'one-line',
        stepFeedbacks: Object.freeze({}),
        summaryLineVi: session.oneLineFeedbackVi ?? '',
        fullAnalysis: null,
      });
    }
    return Object.freeze({
      kind: 'full-post-hand',
      stepFeedbacks: session.stepFeedbacks,
      summaryLineVi: session.postHandFeedback!.oneLineSummaryVi,
      fullAnalysis: session.postHandFeedback!,
    });
  }

  // Level 3: Strictly no feedback until hand is completed (AC D3)
  if (session.phase !== 'hand-completed' || session.postHandFeedback === null) {
    return Object.freeze({
      kind: 'none',
      stepFeedbacks: Object.freeze({}),
      summaryLineVi: null,
      fullAnalysis: null,
    });
  }

  return Object.freeze({
    kind: 'full-post-hand',
    stepFeedbacks: session.stepFeedbacks,
    summaryLineVi: session.postHandFeedback.oneLineSummaryVi,
    fullAnalysis: session.postHandFeedback,
  });
}
