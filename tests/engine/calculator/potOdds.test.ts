import { describe, expect, it } from 'vitest';
import {
  CalculatorError,
  calculateCallEv,
  calculatePotOdds,
  calculatePotOddsFromSnapshot,
  classifyClearSpot,
  exactHitProbability,
  extractDecisionSnapshot,
} from '../../../src/engine/calculator';
import {
  assertHandUnchangedAndValid,
  assertPureFixtureInv1,
  buildD8TurnState,
  buildH1DecisionStates,
  captureChipSnapshot,
} from './helpers';

describe('calculator/potOdds', () => {
  it('locks AC H1 #7 (70/30), #13 (170/50), and #16 (270/50) directly from real H1 engine states', () => {
    const { step7FlopC, step13TurnC, step16RiverC } = buildH1DecisionStates();

    // H1 #7: potBeforeCall = 70, call = 30 -> 30 / 100 = 30.0%
    const before7 = captureChipSnapshot(step7FlopC);
    const snap7 = extractDecisionSnapshot(step7FlopC, 'C');
    const odds7 = calculatePotOddsFromSnapshot(snap7);
    expect(odds7.hasCall).toBe(true);
    expect(odds7.potBeforeCall).toBe(70);
    expect(odds7.callAmount).toBe(30);
    expect(odds7.potAfterCall).toBe(100);
    expect(odds7.requiredEquity).toBeCloseTo(30 / 100, 12);
    expect(odds7.requiredEquityPercent).toBeCloseTo(30.0, 10);
    expect(odds7.potToCallRatio).toBeCloseTo(70 / 30, 12);
    expect(odds7.oddsAgainst).toBeCloseTo(70 / 30, 12);
    expect(odds7.potToCallLabel).toBe('2.33-to-1');
    assertHandUnchangedAndValid(step7FlopC, before7);

    // H1 #13: potBeforeCall = 170, call = 50 -> 50 / 220 = 22.727...%
    const before13 = captureChipSnapshot(step13TurnC);
    const snap13 = extractDecisionSnapshot(step13TurnC, 'C');
    const odds13 = calculatePotOddsFromSnapshot(snap13);
    expect(odds13.potBeforeCall).toBe(170);
    expect(odds13.callAmount).toBe(50);
    expect(odds13.potAfterCall).toBe(220);
    expect(odds13.requiredEquity).toBeCloseTo(50 / 220, 12);
    expect(odds13.requiredEquityPercent).toBeCloseTo(22.7272727, 5);
    expect(odds13.potToCallRatio).toBeCloseTo(3.4, 12);
    expect(odds13.potToCallLabel).toBe('3.4-to-1');
    assertHandUnchangedAndValid(step13TurnC, before13);

    // H1 #16: potBeforeCall = 270, call = 50 -> 50 / 320 = 15.625%
    const before16 = captureChipSnapshot(step16RiverC);
    const snap16 = extractDecisionSnapshot(step16RiverC, 'C');
    const odds16 = calculatePotOddsFromSnapshot(snap16);
    expect(odds16.potBeforeCall).toBe(270);
    expect(odds16.callAmount).toBe(50);
    expect(odds16.potAfterCall).toBe(320);
    expect(odds16.requiredEquity).toBeCloseTo(50 / 320, 12);
    expect(odds16.requiredEquityPercent).toBeCloseTo(15.625, 10);
    expect(odds16.potToCallRatio).toBeCloseTo(5.4, 12);
    expect(odds16.potToCallLabel).toBe('5.4-to-1');
    assertHandUnchangedAndValid(step16RiverC, before16);
  });

  it('locks AC D8 (turn pot 300, hero bets cap 50 -> villain faces 350/50 = 12.5% < ~19.6% flush draw)', () => {
    const { afterHeroBetCap50 } = buildD8TurnState();
    const before = captureChipSnapshot(afterHeroBetCap50);

    const villainSnap = extractDecisionSnapshot(afterHeroBetCap50, 'B');
    const villainOdds = calculatePotOddsFromSnapshot(villainSnap);

    expect(villainOdds.potBeforeCall).toBe(350);
    expect(villainOdds.callAmount).toBe(50);
    expect(villainOdds.potAfterCall).toBe(400);
    expect(villainOdds.requiredEquity).toBeCloseTo(50 / 400, 12);
    expect(villainOdds.requiredEquityPercent).toBeCloseTo(12.5, 10);
    expect(villainOdds.potToCallRatio).toBe(7);
    expect(villainOdds.potToCallLabel).toBe('7-to-1');

    // Villain's flush draw on turn: 9 outs / 46 unseen = ~19.57% > 12.5% -> clear +EV call
    const flushDrawProb = exactHitProbability(9, 46, 1);
    expect(flushDrawProb).toBeCloseTo(9 / 46, 12);
    expect(flushDrawProb).toBeGreaterThan(villainOdds.requiredEquity);

    const clearCheck = classifyClearSpot(flushDrawProb, villainOdds.requiredEquity);
    expect(clearCheck.isClearSpot).toBe(true);
    expect(clearCheck.recommendedAction).toBe('call');

    const callEv = calculateCallEv({
      potBeforeCall: villainOdds.potBeforeCall,
      callAmount: villainOdds.callAmount,
      equity: flushDrawProb,
    });
    expect(callEv.ev).toBeGreaterThan(0);

    assertHandUnchangedAndValid(afterHeroBetCap50, before);
  });

  it('handles zero callAmount safely without NaN or Infinity, and rejects invalid inputs', () => {
    assertPureFixtureInv1(6);

    const noBet = calculatePotOdds({ potBeforeCall: 120, callAmount: 0 });
    expect(noBet.hasCall).toBe(false);
    expect(noBet.potBeforeCall).toBe(120);
    expect(noBet.callAmount).toBe(0);
    expect(noBet.potAfterCall).toBe(120);
    expect(noBet.requiredEquity).toBe(0);
    expect(noBet.requiredEquityPercent).toBe(0);
    expect(Number.isFinite(noBet.requiredEquity)).toBe(true);
    expect(noBet.potToCallRatio).toBeNull();
    expect(noBet.oddsAgainst).toBeNull();
    expect(noBet.potToCallLabel).toBe('Không cần call');

    const emptyPotNoBet = calculatePotOdds({ potBeforeCall: 0, callAmount: 0 });
    expect(emptyPotNoBet.requiredEquity).toBe(0);
    expect(emptyPotNoBet.potToCallRatio).toBeNull();
    expect(emptyPotNoBet.oddsAgainst).toBeNull();

    // Invalid negative / non-finite values
    expect(() => calculatePotOdds({ potBeforeCall: -10, callAmount: 20 })).toThrowError(
      CalculatorError,
    );
    expect(() => calculatePotOdds({ potBeforeCall: 100, callAmount: -5 })).toThrowError(
      CalculatorError,
    );
    expect(() => calculatePotOdds({ potBeforeCall: Number.NaN, callAmount: 10 })).toThrowError(
      CalculatorError,
    );
    expect(() =>
      calculatePotOdds({ potBeforeCall: 100, callAmount: Number.POSITIVE_INFINITY }),
    ).toThrowError(CalculatorError);

    assertPureFixtureInv1(6);
  });
});
