import { describe, expect, it } from 'vitest';
import {
  CalculatorError,
  assumptionsContextFromSnapshot,
  calculateBetOrRaiseEv,
  calculateCallEv,
  calculateCheckEv,
  calculateFoldEv,
  calculateMultiPotCallEv,
  extractDecisionSnapshot,
} from '../../../src/engine/calculator';
import {
  assertHandUnchangedAndValid,
  assertPureFixtureInv1,
  buildH1DecisionStates,
  buildP1SidePotDecisionState,
  captureChipSnapshot,
} from './helpers';

describe('calculator/ev', () => {
  it('computes exact Fold EV = 0 and exact single-pot Call EV on H1 decision points', () => {
    const { step7FlopC, step13TurnC, step16RiverC } = buildH1DecisionStates();

    const before7 = captureChipSnapshot(step7FlopC);
    const snap7 = extractDecisionSnapshot(step7FlopC, 'C');

    const foldEv = calculateFoldEv(assumptionsContextFromSnapshot(snap7));
    expect(foldEv.action).toBe('fold');
    expect(foldEv.ev).toBe(0);
    expect(foldEv.precision).toBe('exact');
    expect(foldEv.assumptions.potBeforeAction).toBe(70);
    expect(foldEv.assumptions.streetCap).toBe(50);

    // H1 #7: pot 70, call 30 -> break-even at equity = 0.30
    const breakEven7 = calculateCallEv({
      potBeforeCall: snap7.potBeforeCall,
      callAmount: snap7.callAmount,
      equity: 0.3,
      heroStack: snap7.heroStack,
      heroStreetContribution: snap7.heroStreetContribution,
      streetCap: snap7.streetCap,
      assumptionsContext: assumptionsContextFromSnapshot(snap7),
    });
    expect(breakEven7.precision).toBe('exact');
    expect(breakEven7.potAfterCall).toBe(100);
    expect(breakEven7.ev).toBeCloseTo(0, 12);

    const plusEv7 = calculateCallEv({
      potBeforeCall: 70,
      callAmount: 30,
      equity: 0.45,
    });
    expect(plusEv7.ev).toBeCloseTo(15, 12); // 0.45 * 100 - 30 = +15

    // H1 #13: pot 170, call 50 -> EV = eq * 220 - 50
    const before13 = captureChipSnapshot(step13TurnC);
    const snap13 = extractDecisionSnapshot(step13TurnC, 'C');
    const call13 = calculateCallEv({
      potBeforeCall: snap13.potBeforeCall,
      callAmount: snap13.callAmount,
      equity: 0.35,
    });
    expect(call13.ev).toBeCloseTo(0.35 * 220 - 50, 12); // +27

    // H1 #16: pot 270, call 50 -> EV = eq * 320 - 50
    const before16 = captureChipSnapshot(step16RiverC);
    const snap16 = extractDecisionSnapshot(step16RiverC, 'C');
    const call16 = calculateCallEv({
      potBeforeCall: snap16.potBeforeCall,
      callAmount: snap16.callAmount,
      equity: 0.1,
    });
    expect(call16.ev).toBeCloseTo(0.1 * 320 - 50, 12); // -18

    assertHandUnchangedAndValid(step7FlopC, before7);
    assertHandUnchangedAndValid(step13TurnC, before13);
    assertHandUnchangedAndValid(step16RiverC, before16);
  });

  it('computes exact multi-pot Call EV with per-pot eligibility and excludes side pots hero cannot win', () => {
    const p1State = buildP1SidePotDecisionState();
    const before = captureChipSnapshot(p1State);
    const snapC = extractDecisionSnapshot(p1State, 'C');

    // Case 1: Big-stack hero C calls 50 across main pot (80 + 30 = 110, eq=0.30 vs {A,B})
    // and side pot (20 + 20 = 40, eq=0.60 vs {B}).
    const bigStackCall = calculateMultiPotCallEv({
      callAmount: 50,
      pots: [
        {
          potId: 'main',
          label: 'Main pot (A, B, C)',
          potBeforeCall: 80,
          heroAddedAmount: 30,
          heroEligible: true,
          heroEquity: 0.3,
        },
        {
          potId: 'side-1',
          label: 'Side pot (B, C)',
          potBeforeCall: 20,
          heroAddedAmount: 20,
          heroEligible: true,
          heroEquity: 0.6,
        },
      ],
      heroStack: snapC.heroStack,
      heroStreetContribution: snapC.heroStreetContribution,
      streetCap: snapC.streetCap,
      assumptionsContext: assumptionsContextFromSnapshot(snapC),
    });

    expect(bigStackCall.precision).toBe('exact');
    expect(bigStackCall.totalEligiblePotAfterCall).toBe(150);
    expect(bigStackCall.excludedPotTotal).toBe(0);
    expect(bigStackCall.totalExpectedReturn).toBeCloseTo(0.3 * 110 + 0.6 * 40, 12); // 33 + 24 = 57
    expect(bigStackCall.ev).toBeCloseTo(7, 12);

    // Case 2: Short-stack hero calling all-in 30 while an ineligible side pot of 40 exists.
    // Even if caller passes a dummy equity on the ineligible slice, it MUST contribute 0!
    const shortStackCall = calculateMultiPotCallEv({
      callAmount: 30,
      pots: [
        {
          potId: 'main',
          potBeforeCall: 80,
          heroAddedAmount: 30,
          heroEligible: true,
          heroEquity: 0.4,
        },
        {
          potId: 'side-ineligible',
          potBeforeCall: 40,
          heroAddedAmount: 0,
          heroEligible: false,
          heroEquity: 1.0, // must be ignored because heroEligible === false!
        },
      ],
    });
    expect(shortStackCall.totalEligiblePotAfterCall).toBe(110);
    expect(shortStackCall.excludedPotTotal).toBe(40);
    expect(shortStackCall.totalExpectedReturn).toBeCloseTo(0.4 * 110, 12); // 44 (NOT 44 + 40!)
    expect(shortStackCall.ev).toBeCloseTo(14, 12); // 44 - 30 = +14
    expect(shortStackCall.slices[1]!.expectedReturn).toBe(0);
    expect(shortStackCall.slices[1]!.heroEquity).toBeNull();

    // Rejects adding chips to an ineligible pot or mismatched sum
    expect(() =>
      calculateMultiPotCallEv({
        callAmount: 50,
        pots: [
          { potBeforeCall: 80, heroAddedAmount: 30, heroEligible: true, heroEquity: 0.5 },
          { potBeforeCall: 20, heroAddedAmount: 20, heroEligible: false },
        ],
      }),
    ).toThrowError(CalculatorError);

    expect(() =>
      calculateMultiPotCallEv({
        callAmount: 50,
        pots: [{ potBeforeCall: 80, heroAddedAmount: 30, heroEligible: true, heroEquity: 0.5 }],
      }),
    ).toThrowError(CalculatorError);

    assertHandUnchangedAndValid(p1State, before);
  });

  it('computes estimated Check/Bet/Raise EV using caller opponent response assumptions and strictly enforces Accate cap rules', () => {
    assertPureFixtureInv1(6);

    // Check EV
    const checkEv = calculateCheckEv({
      potBeforeAction: 100,
      equity: 0.55,
      currentBet: 0,
      heroStreetContribution: 0,
    });
    expect(checkEv.ev).toBeCloseTo(55, 12);
    expect(checkEv.precision).toBe('estimated');
    expect(() =>
      calculateCheckEv({
        potBeforeAction: 100,
        equity: 0.55,
        currentBet: 20,
        heroStreetContribution: 0,
      }),
    ).toThrowError(CalculatorError);

    // Legal Bet 30 into pot 100: 40% fold, 60% call (villain adds 30, hero eq=0.65)
    // EV = 0.40 * 100 + 0.60 * (0.65 * (100 + 30 + 30) - 30) = 40 + 0.60 * (104 - 30) = 40 + 44.4 = 84.4
    const betEv = calculateBetOrRaiseEv({
      action: 'bet',
      street: 'flop',
      potBeforeAction: 100,
      currentBet: 0,
      heroStreetContribution: 0,
      targetBet: 30,
      heroStack: 400,
      opponentResponse: {
        foldProbability: 0.4,
        callProbability: 0.6,
        equityWhenCalled: 0.65,
        opponentAddedOnCall: 30,
      },
    });
    expect(betEv.precision).toBe('estimated');
    expect(betEv.heroAddedAmount).toBe(30);
    expect(betEv.branches.evWhenFolded).toBe(100);
    expect(betEv.branches.evWhenCalled).toBeCloseTo(74, 12);
    expect(betEv.ev).toBeCloseTo(84.4, 12);
    expect(betEv.assumptions.method).toBe('estimated-ev');
    expect(betEv.assumptions.streetCap).toBe(50);

    // Legal Raise to 35 facing 20 (pot 80): 30% fold, 50% call (+15), 20% reraise to 50 (cap, hero folds)
    // Fold: 80; Call: 0.55*(80+35+15) - 35 = 71.5 - 35 = 36.5; Reraise->fold: -35
    // EV = 0.30*80 + 0.50*36.5 + 0.20*(-35) = 24 + 18.25 - 7 = 35.25
    const raiseEv = calculateBetOrRaiseEv({
      action: 'raise',
      street: 'turn',
      potBeforeAction: 80,
      currentBet: 20,
      heroStreetContribution: 0,
      targetBet: 35,
      heroStack: 300,
      opponentResponse: {
        foldProbability: 0.3,
        callProbability: 0.5,
        reraiseProbability: 0.2,
        equityWhenCalled: 0.55,
        opponentAddedOnCall: 15,
        reraise: {
          reraiseTo: 50,
          opponentAddedOnReraise: 30,
          heroResponse: 'fold',
        },
      },
    });
    expect(raiseEv.ev).toBeCloseTo(35.25, 12);
    expect(raiseEv.branches.evWhenReraised).toBe(-35);

    // Legal Raise to 30 facing 10 (pot 60), opponent reraises to 50 (cap) and hero calls (+20 more)
    // Fold: 60; Call (+20): 0.6*(60+30+20) - 30 = 66 - 30 = 36
    // Reraise to 50 (+40 by opp, hero adds 30+20=50): 0.45*(60+50+40) - 50 = 67.5 - 50 = 17.5
    // EV = 0.2*60 + 0.5*36 + 0.3*17.5 = 12 + 18 + 5.25 = 35.25
    const raiseCallReraiseEv = calculateBetOrRaiseEv({
      action: 'raise',
      street: 'flop',
      potBeforeAction: 60,
      currentBet: 10,
      heroStreetContribution: 0,
      targetBet: 30,
      heroStack: 400,
      opponentResponse: {
        foldProbability: 0.2,
        callProbability: 0.5,
        reraiseProbability: 0.3,
        equityWhenCalled: 0.6,
        opponentAddedOnCall: 20,
        reraise: {
          reraiseTo: 50,
          opponentAddedOnReraise: 40,
          heroResponse: 'call',
          equityWhenReraised: 0.45,
        },
      },
    });
    expect(raiseCallReraiseEv.branches.evWhenReraised).toBeCloseTo(17.5, 12);
    expect(raiseCallReraiseEv.ev).toBeCloseTo(35.25, 12);

    // Cap enforcement: bet 55 exceeds cap 50
    try {
      calculateBetOrRaiseEv({
        action: 'bet',
        street: 'flop',
        potBeforeAction: 100,
        currentBet: 0,
        heroStreetContribution: 0,
        targetBet: 55,
        heroStack: 400,
        opponentResponse: { foldProbability: 1, callProbability: 0 },
      });
      throw new Error('Expected exceeds-street-cap');
    } catch (err) {
      expect(err).toBeInstanceOf(CalculatorError);
      expect((err as CalculatorError).code).toBe('exceeds-street-cap');
    }

    // Cap enforcement: cannot raise when currentBet already equals cap 50
    try {
      calculateBetOrRaiseEv({
        action: 'raise',
        street: 'turn',
        potBeforeAction: 170,
        currentBet: 50,
        heroStreetContribution: 0,
        targetBet: 55,
        heroStack: 415,
        opponentResponse: { foldProbability: 1, callProbability: 0 },
      });
      throw new Error('Expected cap-reached');
    } catch (err) {
      expect(err).toBeInstanceOf(CalculatorError);
      expect((err as CalculatorError).code).toBe('cap-reached');
    }

    // Cap enforcement: cannot assume opponent reraises when hero already bet/raised to cap 50
    try {
      calculateBetOrRaiseEv({
        action: 'bet',
        street: 'flop',
        potBeforeAction: 100,
        currentBet: 0,
        heroStreetContribution: 0,
        targetBet: 50,
        heroStack: 400,
        opponentResponse: {
          foldProbability: 0.4,
          callProbability: 0.4,
          reraiseProbability: 0.2,
          equityWhenCalled: 0.5,
          opponentAddedOnCall: 50,
          reraise: {
            reraiseTo: 55,
            opponentAddedOnReraise: 55,
            heroResponse: 'fold',
          },
        },
      });
      throw new Error('Expected cap-reached');
    } catch (err) {
      expect(err).toBeInstanceOf(CalculatorError);
      expect((err as CalculatorError).code).toBe('cap-reached');
    }

    // Non-multiple of 5 rejected (R4)
    expect(() =>
      calculateBetOrRaiseEv({
        action: 'bet',
        street: 'flop',
        potBeforeAction: 100,
        currentBet: 0,
        heroStreetContribution: 0,
        targetBet: 22,
        heroStack: 400,
        opponentResponse: { foldProbability: 1, callProbability: 0 },
      }),
    ).toThrowError(CalculatorError);

    // Preflop custom cap (R14: cap preflop = 20 -> 20 allowed, 25 rejected)
    const preflopBet20 = calculateBetOrRaiseEv({
      action: 'bet',
      street: 'preflop',
      streetCap: 20,
      potBeforeAction: 30,
      currentBet: 0,
      heroStreetContribution: 0,
      targetBet: 20,
      heroStack: 495,
      opponentResponse: { foldProbability: 1, callProbability: 0 },
    });
    expect(preflopBet20.ev).toBe(30);

    expect(() =>
      calculateBetOrRaiseEv({
        action: 'bet',
        street: 'preflop',
        streetCap: 20,
        potBeforeAction: 30,
        currentBet: 0,
        heroStreetContribution: 0,
        targetBet: 25,
        heroStack: 495,
        opponentResponse: { foldProbability: 1, callProbability: 0 },
      }),
    ).toThrowError(CalculatorError);

    assertPureFixtureInv1(6);
  });
});
