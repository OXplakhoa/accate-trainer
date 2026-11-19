import { describe, expect, it } from 'vitest';
import {
  CLEAR_SPOT_THRESHOLD_PP,
  CalculatorError,
  OUTS_PROBABILITY_ERROR_TARGET_PP,
  POT_ODDS_ERROR_TARGET_PP,
  classifyClearSpot,
  evaluateClearSpotDecision,
  evaluateOutsCount,
  evaluateOutsProbabilityError,
  evaluatePotOddsError,
  exactHitProbability,
  percentToRatio,
  ratioToPercent,
} from '../../../src/engine/calculator';
import { assertPureFixtureInv1 } from './helpers';

describe('calculator/metrics (AC M1-M3; M4 belongs to Progress UI)', () => {
  it('locks AC M1: hero enters 9 outs when answer is 8 -> incorrect with stored error = 1', () => {
    assertPureFixtureInv1(6);

    const m1 = evaluateOutsCount(9, 8);
    expect(m1.userOuts).toBe(9);
    expect(m1.expectedOuts).toBe(8);
    expect(m1.isCorrect).toBe(false);
    expect(m1.signedError).toBe(1);
    expect(m1.absoluteError).toBe(1);

    const exact = evaluateOutsCount(8, 8);
    expect(exact.isCorrect).toBe(true);
    expect(exact.signedError).toBe(0);
    expect(exact.absoluteError).toBe(0);

    const under = evaluateOutsCount(6, 8);
    expect(under.isCorrect).toBe(false);
    expect(under.signedError).toBe(-2);
    expect(under.absoluteError).toBe(2);

    assertPureFixtureInv1(6);
  });

  it('locks AC M2 and outs->% error: hero enters 25% when required equity is 21.4% -> 3.6 pp error', () => {
    assertPureFixtureInv1(6);

    expect(POT_ODDS_ERROR_TARGET_PP).toBe(3);
    expect(OUTS_PROBABILITY_ERROR_TARGET_PP).toBe(3);

    const m2 = evaluatePotOddsError(percentToRatio(25), percentToRatio(21.4));
    expect(m2.absoluteErrorPp).toBeCloseTo(3.6, 10);
    expect(m2.signedErrorPp).toBeCloseTo(3.6, 10);
    expect(m2.withinTarget).toBe(false);

    // Within <= 3 pp target, including exact 3.0 pp boundary with IEEE-754 decimals (0.28 - 0.25)
    const exactBoundary3 = evaluatePotOddsError(0.28, 0.25);
    expect(exactBoundary3.absoluteErrorPp).toBeCloseTo(3.0, 10);
    expect(exactBoundary3.withinTarget).toBe(true);

    // Outs -> % error on H1 #7: Rule of 4 (8%) vs exact 1-(45*44)/(47*46) (~8.42%) -> ~0.42 pp <= 3 pp
    const exactH1ToRiver = exactHitProbability(2, 47, 2);
    const outsProbErr = evaluateOutsProbabilityError(0.08, exactH1ToRiver);
    expect(outsProbErr.absoluteErrorPp).toBeCloseTo(0.41813, 4);
    expect(outsProbErr.withinTarget).toBe(true);

    expect(ratioToPercent(0.214)).toBeCloseTo(21.4, 10);

    assertPureFixtureInv1(6);
  });

  it('locks AC M3 and exact boundary 5 percentage points (clear spot strictly > 5 pp)', () => {
    assertPureFixtureInv1(6);

    expect(CLEAR_SPOT_THRESHOLD_PP).toBe(5);

    // Strictly < 5 pp -> NOT a clear spot, excluded from clear-spot accuracy (M3)
    const below = classifyClearSpot(0.349, 0.3);
    expect(below.marginPp).toBeCloseTo(4.9, 10);
    expect(below.isClearSpot).toBe(false);
    expect(below.countsTowardClearSpotMetric).toBe(false);
    expect(below.recommendedAction).toBe('marginal');

    const belowEval = evaluateClearSpotDecision({
      equity: 0.349,
      requiredEquity: 0.3,
      heroDecision: 'fold',
    });
    expect(belowEval.counted).toBe(false);
    expect(belowEval.isCorrect).toBeNull();

    // Exact boundary = 5.0 pp (including IEEE-754 traps like 0.29 - 0.24 = 0.05000000000000002)
    // MUST NOT be classified as a clear spot because threshold is STRICTLY > 5 pp!
    for (const [eq, req] of [
      [0.35, 0.3],
      [0.29, 0.24],
      [0.25, 0.3],
      [0.24, 0.29],
      [0.05, 0.0],
      [1.0, 0.95],
    ] as const) {
      const boundary = classifyClearSpot(eq, req);
      expect(boundary.marginPp).toBeCloseTo(5, 10);
      expect(boundary.isClearSpot).toBe(false);
      expect(boundary.countsTowardClearSpotMetric).toBe(false);
      expect(boundary.recommendedAction).toBe('marginal');

      const decision = evaluateClearSpotDecision({
        equity: eq,
        requiredEquity: req,
        heroDecision: 'call',
      });
      expect(decision.counted).toBe(false);
      expect(decision.isCorrect).toBeNull();
    }

    // Strictly > 5 pp -> clear call
    const clearCall = evaluateClearSpotDecision({
      equity: 0.351,
      requiredEquity: 0.3,
      heroDecision: 'call',
    });
    expect(clearCall.isClearSpot).toBe(true);
    expect(clearCall.countsTowardClearSpotMetric).toBe(true);
    expect(clearCall.recommendedAction).toBe('call');
    expect(clearCall.counted).toBe(true);
    expect(clearCall.isCorrect).toBe(true);

    // Strictly > 5 pp -> clear fold (hero wrongly calls -> isCorrect = false)
    const clearFoldWrong = evaluateClearSpotDecision({
      equity: 0.249,
      requiredEquity: 0.3,
      heroDecision: 'call',
    });
    expect(clearFoldWrong.isClearSpot).toBe(true);
    expect(clearFoldWrong.recommendedAction).toBe('fold');
    expect(clearFoldWrong.counted).toBe(true);
    expect(clearFoldWrong.isCorrect).toBe(false);

    // Invalid inputs rejected
    expect(() => evaluateOutsCount(-1, 8)).toThrowError(CalculatorError);
    expect(() => evaluateOutsCount(8.5, 8)).toThrowError(CalculatorError);
    expect(() => evaluatePotOddsError(1.2, 0.2)).toThrowError(CalculatorError);
    expect(() => classifyClearSpot(-0.1, 0.2)).toThrowError(CalculatorError);
    expect(() => percentToRatio(105)).toThrowError(CalculatorError);

    assertPureFixtureInv1(6);
  });
});
