import { describe, expect, it } from 'vitest';
import {
  assertDrillHandInvariants,
  createDrillSession,
  submitLevel2Decision,
  buildFixtureDrillSpot,
  completeDrillHand,
  createDrillSpotFromHandState,
  DRILL_CONCEPT_IDS,
  DRILL_FIXTURE_IDS,
  findAvailableChipExchanges,
  generateDrillSpot,
  selectPhysicalChipsForAmount,
} from '../../../src/engine/drill';
import {
  addChips,
  subtractChips,
  initialDistribution,
  checkHandInvariants,
  checkInv1,
  chipValue,
  createRng,
  exchangeHandChips,
  formatCard,
  type ChipCounts,
  type HandState,
} from '../../../src/engine';
import { betAction, callAction, mustApply, mustStartHand } from '../handTestHelpers';
import { readAttemptClock } from '../../../src/ui/drill/clock';
import {
  buildD8TurnState,
  buildH1DecisionStates,
  buildP1SidePotDecisionState,
} from '../calculator/helpers';

function assertFullStateInvariants(state: HandState): void {
  const report = checkHandInvariants(state);
  expect(report.inv1).toEqual({ ok: true });
  expect(report.inv2.ok).toBe(true);
  expect(report.ok).toBe(true);
  const allChipLocations: ChipCounts[] = [
    state.bank,
    state.pot,
    ...state.seats.map((s) => s.stack),
    ...state.seats.flatMap((s) => (s.declaration ? [s.declaration.reservedChips] : [])),
  ];
  expect(checkInv1(allChipLocations)).toEqual({ ok: true });
}

describe('P3 Drill — Spot generation, canonical fixtures, H1 #7, D5, D6, D8, and invariants (D4)', () => {
  it('D4: every canonical fixture is played through the engine with valid INV-1 per denomination and INV-2', () => {
    for (const fixtureId of DRILL_FIXTURE_IDS) {
      const spot = buildFixtureDrillSpot(fixtureId, createRng(`test-fixture-${fixtureId}`), undefined, 400);
      expect(spot.source).toBe('fixture');
      expect(spot.fixtureId).toBe(fixtureId);
      expect(spot.handState.phase).toBe('betting');
      expect(spot.handState.activePlayerId).toBe(spot.heroId);
      assertFullStateInvariants(spot.handState);
      assertDrillHandInvariants(spot.handState, fixtureId);

      // Snapshot contains ONLY hero's 2 cards and revealed board cards
      const heroSeat = spot.handState.seats.find((s) => s.playerId === spot.heroId)!;
      expect(spot.snapshot.heroCards).toEqual(heroSeat.holeCards);
      expect(spot.snapshot.board).toEqual(spot.handState.board);
      expect(spot.snapshot.potBeforeCall).toBe(chipValue(spot.handState.pot));

      // D5: Solution preserves range, opponentCount, stacks, pot, cap, and position
      const { assumptions } = spot.solution;
      expect(assumptions.opponentCount).toBe(spot.snapshot.activeOpponentCount);
      expect(assumptions.potBeforeAction).toBe(spot.snapshot.potBeforeCall);
      expect(assumptions.heroStack).toBe(spot.snapshot.heroStack);
      expect(assumptions.streetCap).toBe(spot.snapshot.streetCap);
      expect(assumptions.positionLabelVi.length).toBeGreaterThan(0);
      expect(assumptions.openerPlayerId).toBe(spot.handState.openerPlayerId);
      expect(assumptions.rivalRanges.length).toBeGreaterThan(0);
      for (const rr of assumptions.rivalRanges) {
        expect(rr.comboCount).toBeGreaterThan(0);
        expect(rr.descriptionVi.length).toBeGreaterThan(0);
      }
    }
  });

  it('H1 #7 & D6: locks exact H1 #7 math (2 J set outs in 47 cards, 4.26% turn, 8.42% to river, Rule of 4 = 8%, pot odds 30.0%) and D6 post-hand label after losing on river', () => {
    const spot = buildFixtureDrillSpot('h1-step7', createRng('h1-step7-seed'), undefined, 600);
    assertFullStateInvariants(spot.handState);

    expect(spot.heroId).toBe('C');
    expect(spot.snapshot.heroCards.map(formatCard)).toEqual(['Js', 'Jd']);
    expect(spot.snapshot.board.map(formatCard)).toEqual(['9h', '7h', '2c']);
    expect(spot.snapshot.potBeforeCall).toBe(70);
    expect(spot.snapshot.callAmount).toBe(30);

    const { solution } = spot;
    expect(solution.outsQuestionKind).toBe('improvement-outs');
    expect(solution.expectedOuts).toBe(2);
    expect(solution.expectedOutsCards.map(formatCard).sort()).toEqual(['Jc', 'Jh']);
    expect(solution.unseenCards).toBe(47);
    expect(solution.nextCardExactProbability).toBeCloseTo(2 / 47, 10);
    expect(solution.nextCardExactPercent).toBeCloseTo(4.2553, 3);
    expect(solution.toRiverExactProbability).toBeCloseTo(1 - (45 * 44) / (47 * 46), 10);
    expect(solution.toRiverExactPercent).toBeCloseTo(8.4181, 3);
    expect(solution.ruleOf4Percent).toBe(8);
    expect(solution.ruleOf2Percent).toBe(4);
    expect(solution.potOdds.requiredEquity).toBeCloseTo(0.3, 10);
    expect(solution.potOdds.requiredEquityPercent).toBeCloseTo(30.0, 10);
    expect(solution.potOdds.potToCallLabel).toBe('2.33-to-1');

    // Explicitly separates 8.42% set improvement probability from showdown win equity
    expect(solution.improvementVsWinEquityNoteVi).toContain('8,42%');
    expect(solution.improvementVsWinEquityNoteVi).toContain('KHÔNG phải xác suất thắng');
    expect(solution.effectiveEquity).toBeGreaterThan(0.5);

    // Continue hand from exact captured state with physical chips 3x10 -> Call 30
    const completion = completeDrillHand(
      spot,
      {
        type: 'call',
        chips: { 5: 0, 10: 3, 50: 0, 100: 0 },
      },
      createRng('h1-complete-seed'),
    );
    expect(completion.ok).toBe(true);
    if (!completion.ok) {
      throw new Error('Expected H1 completion to succeed');
    }

    assertFullStateInvariants(completion.stateAfterHeroAction);
    assertFullStateInvariants(completion.completedState);
    expect(completion.completedState.phase).toBe('complete');

    // Verify exact H1 step 18 final stacks: A=465, B=685, C=365, D/E/F=495
    const finalStacks = completion.completedState.seats.map((s) => chipValue(s.stack));
    expect(finalStacks).toEqual([465, 685, 365, 495, 495, 495]);

    // Verify AC D6: good decision on flop, lost hand on river
    const fb = completion.postHandFeedback;
    expect(fb.isGoodDecision).toBe(true);
    expect(fb.isDecisionCorrect).toBe(true);
    expect(fb.heroWonHand).toBe(false);
    expect(fb.decisionVsOutcomeBadgeVi).toBe('Quyết định: Tốt — thua do river');
    expect(fb.streetDecisionBadgeVi).toBe('Quyết định flop: Tốt — thua vì river');
    expect(fb.independenceReminderVi).toBe('Kết quả ván: thua — không ảnh hưởng điểm quyết định');
  });

  it('D8: verifies turn pot 300 before hero bet 50 -> opponent sees 350/50 (12.5%) vs flush draw 9/46 (19.57%) and separates legal vs tactical sizing', () => {
    const spot = buildFixtureDrillSpot('d8-chase-draw', createRng('d8-seed'), undefined, 500);
    assertFullStateInvariants(spot.handState);

    expect(spot.snapshot.street).toBe('turn');
    expect(spot.snapshot.potBeforeCall).toBe(300);
    expect(spot.snapshot.currentBet).toBe(0);
    expect(spot.snapshot.streetCap).toBe(50);

    const { sizingAnalysis } = spot.solution;
    const { drawChaseAnalysis } = sizingAnalysis;

    expect(drawChaseAnalysis.potBeforeHeroBet).toBe(300);
    expect(drawChaseAnalysis.maxHeroBetOrRaiseTo).toBe(50);
    expect(drawChaseAnalysis.potSeenByOpponent).toBe(350);
    expect(drawChaseAnalysis.opponentCallAmount).toBe(50);
    expect(drawChaseAnalysis.opponentPotAfterCall).toBe(400);
    expect(drawChaseAnalysis.opponentPotToCallLabel).toBe('350/50');
    expect(drawChaseAnalysis.opponentRequiredEquity).toBeCloseTo(50 / 400, 12);
    expect(drawChaseAnalysis.opponentRequiredEquityPercent).toBeCloseTo(12.5, 10);
    expect(drawChaseAnalysis.flushDrawOuts).toBe(9);
    expect(drawChaseAnalysis.flushDrawUnseenCards).toBe(46);
    expect(drawChaseAnalysis.flushDrawExactEquity).toBeCloseTo(9 / 46, 12);
    expect(drawChaseAnalysis.flushDrawExactEquityPercent).toBeCloseTo(19.5652, 3);
    expect(drawChaseAnalysis.canPriceOutFlushDrawWithCap).toBe(false);
    expect(drawChaseAnalysis.explanationVi).toContain('350/50');
    expect(drawChaseAnalysis.explanationVi).toContain('50/400');
    expect(drawChaseAnalysis.explanationVi).toContain('12,5%');
    expect(drawChaseAnalysis.explanationVi).toContain('19,57%');
    expect(drawChaseAnalysis.explanationVi).toContain('không thể đuổi draw bằng cap');
    expect(drawChaseAnalysis.explanationVi).toContain('Hopkins L2 slide 18–20');

    // Legal vs Tactical sizing separated
    expect(sizingAnalysis.legalSizingVi).toContain('Kích thước hợp lệ theo luật');
    expect(sizingAnalysis.legalSizingVi).toContain('bội số của 5');
    expect(sizingAnalysis.tacticalSizingVi).toContain('Ý nghĩa chiến thuật');

    // Also verify buildD8TurnState helper from calculator tests integrates via createDrillSpotFromHandState
    const d8Helper = buildD8TurnState();
    const fromD8Helper = createDrillSpotFromHandState({
      hand: d8Helper.beforeHeroBet,
      heroId: 'A',
      conceptId: 'bet-sizing',
      equitySamples: 400,
    });
    assertFullStateInvariants(fromD8Helper.handState);
    expect(fromD8Helper.solution.sizingAnalysis.drawChaseAnalysis.potSeenByOpponent).toBe(350);
    expect(fromD8Helper.solution.sizingAnalysis.drawChaseAnalysis.opponentRequiredEquityPercent).toBeCloseTo(
      12.5,
      10,
    );
  });

  it('splits equity and EV across eligible main pot and side pot when an all-in short stack exists (side-pot-multiway & P1 helper)', () => {
    const spot = buildFixtureDrillSpot('side-pot-multiway', createRng('side-pot-seed'), undefined, 500);
    assertFullStateInvariants(spot.handState);

    expect(spot.solution.perPotEquity).toHaveLength(2);
    const [mainSlice, sideSlice] = spot.solution.perPotEquity;
    expect(mainSlice!.potId).toBe('main');
    expect(mainSlice!.potBeforeCall).toBe(80);
    expect(mainSlice!.heroAddedAmount).toBe(30);
    expect(mainSlice!.potAfterCall).toBe(110);
    expect(mainSlice!.heroEligible).toBe(true);
    expect([...mainSlice!.eligibleOpponentIds].sort()).toEqual(['A', 'B']);

    expect(sideSlice!.potId).toBe('side-1');
    expect(sideSlice!.potBeforeCall).toBe(20);
    expect(sideSlice!.heroAddedAmount).toBe(20);
    expect(sideSlice!.potAfterCall).toBe(40);
    expect(sideSlice!.heroEligible).toBe(true);
    expect(sideSlice!.eligibleOpponentIds).toEqual(['B']);

    expect(spot.solution.actionEvs.multiPotCallEv).not.toBeNull();
    expect(spot.solution.actionEvs.multiPotCallEv!.totalEligiblePotAfterCall).toBe(150);

    // Also test with buildP1SidePotDecisionState from calculator helpers
    const p1Hand = buildP1SidePotDecisionState();
    const p1Spot = createDrillSpotFromHandState({
      hand: p1Hand,
      heroId: 'C',
      conceptId: 'pot-odds',
      equitySamples: 400,
    });
    assertFullStateInvariants(p1Spot.handState);
    expect(p1Spot.solution.perPotEquity).toHaveLength(2);
    expect(p1Spot.solution.perPotEquity[0]!.potAfterCall).toBe(110);
    expect(p1Spot.solution.perPotEquity[1]!.potAfterCall).toBe(40);
  });

  it('preserves all live opponents in the unopened D8 pot and legal sizing at the cap', () => {
    const d8 = buildFixtureDrillSpot('d8-chase-draw', createRng('d8-live-players'), undefined, 200);
    assertFullStateInvariants(d8.handState);
    expect(d8.solution.perPotEquity[0]!.eligibleOpponentIds).toHaveLength(5);
    const h1 = buildFixtureDrillSpot('h1-step13', createRng('h1-cap-sizing'), undefined, 200);
    assertFullStateInvariants(h1.handState);
    expect(h1.solution.sizingAnalysis.drawChaseAnalysis.opponentCallAmount).toBe(0);
    expect(h1.solution.sizingAnalysis.drawChaseAnalysis.explanationVi).toContain('Không có Bet hoặc Raise');
  });

  it('uses only eligible pot slices for a short all-in call', () => {
    const init = initialDistribution(4);
    const short: ChipCounts = { 5: 1, 10: 2, 50: 0, 100: 0 };
    let hand = mustStartHand({
      seats: ['A', 'B', 'C', 'D'].map(playerId => ({ playerId, stack: playerId === 'C' ? short : init.perPlayer })),
      bank: addChips(init.bank, subtractChips(init.perPlayer, short)),
      rng: createRng('eligible-short-call'), config: { dealerIndex: 3 }, fixtures: { openerId: 'D' },
    }).state;
    assertFullStateInvariants(hand);
    hand = mustApply(hand, 'D', { type: 'fold' }).state; assertFullStateInvariants(hand);
    hand = mustApply(hand, 'A', betAction(hand, 'A', 50)).state; assertFullStateInvariants(hand);
    hand = mustApply(hand, 'B', callAction(hand, 'B')).state; assertFullStateInvariants(hand);
    const spot = createDrillSpotFromHandState({ hand, heroId: 'C', conceptId: 'pot-odds', equitySamples: 200 });
    expect(spot.snapshot.potBeforeCall).toBe(120);
    expect(spot.snapshot.callAmount).toBe(20);
    expect(spot.solution.potOdds.potAfterCall).toBe(80);
    expect(spot.solution.potOdds.requiredEquity).toBeCloseTo(0.25);
    expect(spot.solution.actionEvs.multiPotCallEv!.totalEligiblePotAfterCall).toBe(80);
    const eligible = spot.solution.perPotEquity.filter(p => p.heroEligible);
    const weighted = eligible.reduce((sum, p) => sum + p.expectedReturn, 0) / 80;
    expect(spot.solution.effectiveEquity).toBeCloseTo(weighted);
    const result = submitLevel2Decision(createDrillSession(spot, 2), { potOddsPercent: 25, action: callAction(hand, 'C') });
    expect(result.ok).toBe(true);
    if (result.ok) { assertFullStateInvariants(result.session.stateAfterHeroAction!); expect(result.session.inputs.outs).toBeUndefined(); }
  });

  it('reads the same fixed deadline after unrelated state changes', () => {
    const start = 1000;
    expect(readAttemptClock(start, 10, 4500)).toEqual({ elapsedMs: 3500, remainingSeconds: 7 });
    // Choosing a texture or exchanging chips does not alter either clock input.
    expect(readAttemptClock(start, 10, 7000)).toEqual({ elapsedMs: 6000, remainingSeconds: 4 });
    expect(readAttemptClock(start, 10, 11250)).toEqual({ elapsedMs: 10250, remainingSeconds: 0 });
  });

  it('generates valid live spots via M1 + M2 for every concept, falls back cleanly when maxAttempts is 0, and supports Sandbox initialSpot & chip exchange', () => {
    for (const conceptId of DRILL_CONCEPT_IDS) {
      const generated = generateDrillSpot({
        seed: `gen-seed-${conceptId}`,
        conceptId,
        maxAttempts: 12,
        equitySamples: 300,
      });
      assertFullStateInvariants(generated.handState);
      expect(generated.handState.activePlayerId).toBe(generated.heroId);

      // Complete the generated spot with a valid legal action and check invariants at completion
      const heroSeat = generated.handState.seats.find((s) => s.playerId === generated.heroId)!;
      const callAmt = generated.snapshot.callAmount;
      const callChips =
        callAmt > 0 ? selectPhysicalChipsForAmount(heroSeat.stack, callAmt) : null;
      const action =
        callAmt > 0 && callChips !== null
          ? ({ type: 'call', chips: callChips } as const)
          : generated.snapshot.legalActions?.canCheck
            ? ({ type: 'check' } as const)
            : ({ type: 'fold' } as const);

      const done = completeDrillHand(generated, action, createRng(`done-${conceptId}`));
      expect(done.ok).toBe(true);
      if (done.ok) {
        assertFullStateInvariants(done.completedState);
        expect(done.completedState.phase).toBe('complete');
      }

      // Bounded retry fallback (maxAttempts: 0 forces fallback to engine-played fixture)
      const fallback = generateDrillSpot({
        seed: `fallback-seed-${conceptId}`,
        conceptId,
        maxAttempts: 0,
        equitySamples: 300,
      });
      expect(fallback.source).toBe('fixture');
      assertFullStateInvariants(fallback.handState);
    }

    // Verify Sandbox initialSpot integration using buildH1DecisionStates
    const { step13TurnC, step16RiverC } = buildH1DecisionStates();
    const sandboxSpot13 = createDrillSpotFromHandState({
      hand: step13TurnC,
      heroId: 'C',
      equitySamples: 300,
    });
    expect(sandboxSpot13.source).toBe('sandbox');
    expect(sandboxSpot13.snapshot.potBeforeCall).toBe(170);
    expect(sandboxSpot13.snapshot.callAmount).toBe(50);
    expect(sandboxSpot13.solution.potOdds.requiredEquity).toBeCloseTo(50 / 220, 10);
    assertFullStateInvariants(sandboxSpot13.handState);

    const sandboxSpot16 = createDrillSpotFromHandState({
      hand: step16RiverC,
      heroId: 'C',
      equitySamples: 300,
    });
    expect(sandboxSpot16.snapshot.potBeforeCall).toBe(270);
    expect(sandboxSpot16.snapshot.callAmount).toBe(50);
    expect(sandboxSpot16.solution.potOdds.requiredEquity).toBeCloseTo(50 / 320, 10);
    assertFullStateInvariants(sandboxSpot16.handState);

    // Verify equal-value chip exchange helper preserves INV-1 and INV-2 (AC C3)
    const exchanges = findAvailableChipExchanges(sandboxSpot13.handState, 'C');
    expect(exchanges.length).toBeGreaterThan(0);
    const exStep = exchangeHandChips(sandboxSpot13.handState, {
      fromPlayerId: 'C',
      target: exchanges[0]!.target,
      give: exchanges[0]!.give,
      receive: exchanges[0]!.receive,
    });
    expect(exStep.ok).toBe(true);
    if (exStep.ok) {
      assertFullStateInvariants(exStep.state);
    }
  });
});
