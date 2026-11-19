import { CalculatorError } from './types';

/**
 * Spec §5 & AC M3: a "clear spot" requires |equity - requiredEquity| STRICTLY GREATER than 5
 * percentage points (> 5 điểm %). Boundary equality (=== 5) is NOT a clear spot.
 */
export const CLEAR_SPOT_THRESHOLD_PP = 5;

/** Spec §10 #2: target error for outs -> % is <= 3 percentage points. */
export const OUTS_PROBABILITY_ERROR_TARGET_PP = 3;

/** Spec §10 #3: target error for pot odds is <= 3 percentage points. */
export const POT_ODDS_ERROR_TARGET_PP = 3;

/**
 * Small tolerance (1e-9 percentage points = 1e-11 probability ratio) to eliminate IEEE-754
 * representation artifacts at exact decimal boundaries (e.g. (0.29 - 0.24) * 100 = 5.000000000000002).
 */
const BOUNDARY_EPSILON_PP = 1e-9;

export interface OutsCountMetric {
  readonly userOuts: number;
  readonly expectedOuts: number;
  readonly signedError: number;
  readonly absoluteError: number;
  readonly isCorrect: boolean;
}

export interface PercentagePointErrorMetric {
  readonly userRatio: number;
  readonly exactRatio: number;
  /** Signed error in percentage points: (userRatio - exactRatio) * 100. */
  readonly signedErrorPp: number;
  /** Absolute error in percentage points: |userRatio - exactRatio| * 100. */
  readonly absoluteErrorPp: number;
  readonly targetPp: number;
  /** True when absoluteErrorPp <= targetPp (within floating-point tolerance). */
  readonly withinTarget: boolean;
}

export type ClearSpotRecommendation = 'call' | 'fold' | 'marginal';

export interface ClearSpotClassification {
  readonly equity: number;
  readonly requiredEquity: number;
  /** (equity - requiredEquity) * 100 in percentage points. */
  readonly signedMarginPp: number;
  /** |equity - requiredEquity| * 100 in percentage points. */
  readonly marginPp: number;
  readonly thresholdPp: number;
  /** True strictly when marginPp > thresholdPp (exact boundary 5 is false). */
  readonly isClearSpot: boolean;
  /** Mirrors isClearSpot: spots with marginPp <= 5 do not count toward clear-spot accuracy (M3). */
  readonly countsTowardClearSpotMetric: boolean;
  readonly recommendedAction: ClearSpotRecommendation;
}

export interface ClearSpotDecisionEvaluation extends ClearSpotClassification {
  readonly heroDecision: 'call' | 'fold';
  readonly counted: boolean;
  /** `null` when the spot is not clear (not counted per M3). */
  readonly isCorrect: boolean | null;
}

function assertProbabilityRatio(value: number, name: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new CalculatorError(
      'invalid-metric-input',
      `${name} must be a finite probability ratio in [0, 1], received ${String(value)}`,
    );
  }
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new CalculatorError(
      'invalid-metric-input',
      `${name} must be a finite non-negative number, received ${String(value)}`,
    );
  }
}

/** Converts a percentage in [0, 100] to a probability ratio in [0, 1]. */
export function percentToRatio(percent: number): number {
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new CalculatorError(
      'invalid-metric-input',
      `percent must be a finite number in [0, 100], received ${String(percent)}`,
    );
  }
  return percent / 100;
}

/** Converts a probability ratio in [0, 1] to a percentage in [0, 100]. */
export function ratioToPercent(ratio: number): number {
  assertProbabilityRatio(ratio, 'ratio');
  return ratio * 100;
}

/**
 * Evaluates hero's outs count against the expected outs count (AC M1, spec §10 #1).
 * Example (M1): userOuts=9, expectedOuts=8 -> isCorrect=false, signedError=+1, absoluteError=1.
 */
export function evaluateOutsCount(userOuts: number, expectedOuts: number): OutsCountMetric {
  if (!Number.isInteger(userOuts) || userOuts < 0) {
    throw new CalculatorError(
      'invalid-metric-input',
      `userOuts must be a non-negative integer, received ${String(userOuts)}`,
    );
  }
  if (!Number.isInteger(expectedOuts) || expectedOuts < 0) {
    throw new CalculatorError(
      'invalid-metric-input',
      `expectedOuts must be a non-negative integer, received ${String(expectedOuts)}`,
    );
  }

  const signedError = userOuts - expectedOuts;
  return Object.freeze({
    userOuts,
    expectedOuts,
    signedError,
    absoluteError: Math.abs(signedError),
    isCorrect: userOuts === expectedOuts,
  });
}

function evaluateRatioError(
  userRatio: number,
  exactRatio: number,
  targetPp: number,
  userLabel: string,
  exactLabel: string,
): PercentagePointErrorMetric {
  assertProbabilityRatio(userRatio, userLabel);
  assertProbabilityRatio(exactRatio, exactLabel);
  assertNonNegativeFinite(targetPp, 'targetPp');

  const signedErrorPp = (userRatio - exactRatio) * 100;
  const absoluteErrorPp = Math.abs(signedErrorPp);

  return Object.freeze({
    userRatio,
    exactRatio,
    signedErrorPp,
    absoluteErrorPp,
    targetPp,
    withinTarget: absoluteErrorPp <= targetPp + BOUNDARY_EPSILON_PP,
  });
}

/**
 * Computes percentage-point error between hero's estimated hit probability and exact hit probability
 * (spec §10 #2, default target <= 3 percentage points). Inputs are probability ratios in [0, 1].
 */
export function evaluateOutsProbabilityError(
  userProbability: number,
  exactProbability: number,
  targetPp = OUTS_PROBABILITY_ERROR_TARGET_PP,
): PercentagePointErrorMetric {
  return evaluateRatioError(
    userProbability,
    exactProbability,
    targetPp,
    'userProbability',
    'exactProbability',
  );
}

/**
 * Computes percentage-point error between hero's estimated pot odds and exact required equity
 * (spec §10 #3, AC M2, default target <= 3 percentage points). Inputs are probability ratios in [0, 1].
 * Example (M2): userRequiredEquity=0.25, exactRequiredEquity=0.214 -> absoluteErrorPp=3.6, withinTarget=false.
 */
export function evaluatePotOddsError(
  userRequiredEquity: number,
  exactRequiredEquity: number,
  targetPp = POT_ODDS_ERROR_TARGET_PP,
): PercentagePointErrorMetric {
  return evaluateRatioError(
    userRequiredEquity,
    exactRequiredEquity,
    targetPp,
    'userRequiredEquity',
    'exactRequiredEquity',
  );
}

/**
 * Classifies whether a spot is a "clear spot" (spec §5, AC M3):
 * |equity - requiredEquity| * 100 > thresholdPp (strictly > 5 percentage points by default).
 *
 * Note: AC M4 (Progress screen trends over time, by concept, level, and rival) belongs to the
 * Progress UI layer and is intentionally outside this calculator module.
 */
export function classifyClearSpot(
  equity: number,
  requiredEquity: number,
  thresholdPp = CLEAR_SPOT_THRESHOLD_PP,
): ClearSpotClassification {
  assertProbabilityRatio(equity, 'equity');
  assertProbabilityRatio(requiredEquity, 'requiredEquity');
  assertNonNegativeFinite(thresholdPp, 'thresholdPp');

  const signedMarginPp = (equity - requiredEquity) * 100;
  const marginPp = Math.abs(signedMarginPp);
  const isClearSpot = marginPp > thresholdPp + BOUNDARY_EPSILON_PP;

  const recommendedAction: ClearSpotRecommendation = !isClearSpot
    ? 'marginal'
    : signedMarginPp > 0
      ? 'call'
      : 'fold';

  return Object.freeze({
    equity,
    requiredEquity,
    signedMarginPp,
    marginPp,
    thresholdPp,
    isClearSpot,
    countsTowardClearSpotMetric: isClearSpot,
    recommendedAction,
  });
}

export function evaluateClearSpotDecision(input: {
  readonly equity: number;
  readonly requiredEquity: number;
  readonly heroDecision: 'call' | 'fold';
  readonly thresholdPp?: number;
}): ClearSpotDecisionEvaluation {
  const classification = classifyClearSpot(
    input.equity,
    input.requiredEquity,
    input.thresholdPp,
  );

  if (!classification.isClearSpot) {
    return Object.freeze({
      ...classification,
      heroDecision: input.heroDecision,
      counted: false,
      isCorrect: null,
    });
  }

  return Object.freeze({
    ...classification,
    heroDecision: input.heroDecision,
    counted: true,
    isCorrect: input.heroDecision === classification.recommendedAction,
  });
}
