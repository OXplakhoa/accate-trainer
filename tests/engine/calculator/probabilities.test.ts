import { describe, expect, it } from 'vitest';
import {
  CalculatorError,
  approximateRuleOf2,
  approximateRuleOf4,
  approximateRuleOf4Adjusted,
  calculateDrawProbabilities,
  exactHitProbability,
  unseenCardCountForStreet,
} from '../../../src/engine/calculator';
import { assertPureFixtureInv1 } from './helpers';

describe('calculator/probabilities', () => {
  it('computes exact 1-card and 2-card draw probabilities for H1 #7 (2 outs / 47) and D8 flush draw (9 outs / 46)', () => {
    assertPureFixtureInv1(6);

    // H1 #7: 2 outs (Jh, Jc) on flop (47 unseen)
    expect(unseenCardCountForStreet('flop')).toBe(47);
    const h1 = calculateDrawProbabilities({ outs: 2, street: 'flop' });
    expect(h1.unseenCards).toBe(47);
    expect(h1.cardsRemainingToRiver).toBe(2);
    expect(h1.nextCardExact).toBeCloseTo(2 / 47, 12);
    expect(h1.toRiverExact).toBeCloseTo(1 - (45 * 44) / (47 * 46), 12);
    expect(h1.nextCardExact * 100).toBeCloseTo(4.2553, 3);
    expect(h1.toRiverExact * 100).toBeCloseTo(8.4181, 3);
    expect(h1.ruleOf2?.probability).toBeCloseTo(0.04, 12);
    expect(h1.ruleOf4?.probability).toBeCloseTo(0.08, 12);
    expect(h1.ruleOf4Adjusted?.probability).toBeCloseTo(0.08, 12);
    expect(h1.ruleOf4Adjusted?.adjustmentApplied).toBe(false);

    // D8 / Hopkins L2 s10-11: flush draw on turn (9 outs / 46 unseen)
    expect(unseenCardCountForStreet('turn')).toBe(46);
    const turnFlush = calculateDrawProbabilities({ outs: 9, street: 'turn' });
    expect(turnFlush.unseenCards).toBe(46);
    expect(turnFlush.cardsRemainingToRiver).toBe(1);
    expect(turnFlush.nextCardExact).toBeCloseTo(9 / 46, 12);
    expect(turnFlush.toRiverExact).toBeCloseTo(9 / 46, 12);
    expect(turnFlush.ruleOf2?.probability).toBeCloseTo(0.18, 12);
    expect(turnFlush.ruleOf4).toBeNull();
    expect(turnFlush.ruleOf4Adjusted).toBeNull();

    // Custom unseen card pool when additional public dead cards are known
    const withDead = calculateDrawProbabilities({ outs: 9, street: 'flop', deadCardCount: 2 });
    expect(withDead.unseenCards).toBe(45);
    expect(withDead.nextCardExact).toBeCloseTo(9 / 45, 12);
    expect(withDead.toRiverExact).toBeCloseTo(1 - (36 * 35) / (45 * 44), 12);

    assertPureFixtureInv1(6);
  });

  it('handles edge cases: 0 outs, river (0 cards left), guaranteed hit, and invalid inputs', () => {
    assertPureFixtureInv1(6);

    // 0 outs
    expect(exactHitProbability(0, 47, 1)).toBe(0);
    expect(exactHitProbability(0, 47, 2)).toBe(0);

    // River: no cards left to hit before river
    const river = calculateDrawProbabilities({ outs: 9, street: 'river' });
    expect(river.cardsRemainingToRiver).toBe(0);
    expect(river.nextCardExact).toBe(0);
    expect(river.toRiverExact).toBe(0);
    expect(river.ruleOf2).toBeNull();
    expect(river.ruleOf4).toBeNull();
    expect(river.ruleOf4Adjusted).toBeNull();
    expect(exactHitProbability(9, 45, 0)).toBe(0);

    // Guaranteed hit when at most 1 non-out card remains for 2 draws
    expect(exactHitProbability(47, 47, 1)).toBe(1);
    expect(exactHitProbability(46, 47, 2)).toBe(1);
    expect(exactHitProbability(47, 47, 2)).toBe(1);

    // Invalid inputs
    expect(() => exactHitProbability(-1, 47, 1)).toThrowError(CalculatorError);
    expect(() => exactHitProbability(1.5, 47, 1)).toThrowError(CalculatorError);
    expect(() => exactHitProbability(48, 47, 1)).toThrowError(CalculatorError);
    expect(() => exactHitProbability(1, 1, 2)).toThrowError(CalculatorError);
    expect(() => exactHitProbability(1, 53, 1)).toThrowError(CalculatorError);
    expect(() => unseenCardCountForStreet('flop', -1)).toThrowError(CalculatorError);
    expect(() => unseenCardCountForStreet('flop', 50)).toThrowError(CalculatorError);

    assertPureFixtureInv1(6);
  });

  it('keeps Rule of 2/4 and >8 outs adjusted Rule of 4 separate, documented, and clamped to [0, 1]', () => {
    assertPureFixtureInv1(6);

    const r4At8 = approximateRuleOf4Adjusted(8);
    expect(r4At8.isApproximation).toBe(true);
    expect(r4At8.adjustmentApplied).toBe(false);
    expect(r4At8.probability).toBeCloseTo(0.32, 12);
    expect(r4At8.formula).toBe('4 * outs (%)');

    const r4At9 = approximateRuleOf4Adjusted(9);
    expect(r4At9.adjustmentApplied).toBe(true);
    expect(r4At9.rawPercent).toBe(35);
    expect(r4At9.probability).toBeCloseTo(0.35, 12);
    expect(r4At9.formula).toBe('4 * outs - (outs - 8) (%)');
    expect(approximateRuleOf4(9).probability).toBeCloseTo(0.36, 12);

    const r4At15 = approximateRuleOf4Adjusted(15);
    expect(r4At15.rawPercent).toBe(53);
    expect(r4At15.probability).toBeCloseTo(0.53, 12);

    // Clamping above 100%
    const r4Clamped = approximateRuleOf4(30);
    expect(r4Clamped.rawPercent).toBe(120);
    expect(r4Clamped.isClamped).toBe(true);
    expect(r4Clamped.probability).toBe(1);

    const r4AdjClamped = approximateRuleOf4Adjusted(35);
    expect(r4AdjClamped.rawPercent).toBe(113);
    expect(r4AdjClamped.isClamped).toBe(true);
    expect(r4AdjClamped.probability).toBe(1);

    const r2Clamped = approximateRuleOf2(52);
    expect(r2Clamped.rawPercent).toBe(104);
    expect(r2Clamped.isClamped).toBe(true);
    expect(r2Clamped.probability).toBe(1);

    assertPureFixtureInv1(6);
  });
});
