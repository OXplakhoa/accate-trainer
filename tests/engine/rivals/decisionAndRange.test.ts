import { describe, expect, it } from 'vitest';
import { initialDistribution } from '../../../src/engine/bank';
import { formatCard, parseCard, parseCards } from '../../../src/engine/cards';
import {
  addChips,
  CHIP_SET,
  chipValue,
  emptyChips,
  subtractChips,
  type ChipCounts,
} from '../../../src/engine/chips';
import { createRng } from '../../../src/engine/rng';
import {
  buildRivalDecisionInput,
  createInitialNongTiltState,
  decideRivalAction,
  decideRivalOutOfTurn,
  estimateRivalRange,
  getRivalRangeCombos,
  RIVAL_IDS,
  validateRivalDecisionInput,
  type NongTiltState,
  type RivalDecisionInput,
} from '../../../src/engine/rivals';
import {
  assertHandInvariants,
  betAction,
  buildFixtureDeck,
  mustApply,
  mustDeclare,
  mustStartHand,
} from '../handTestHelpers';

describe('P2b rivals — information isolation, decision execution, out-of-turn, and range estimation (B1)', () => {
  it('B1: changing opponents hidden hole cards and undealt deck cards with same public snapshot and seed yields identical decisions', () => {
    const init = initialDistribution(4);
    const playerIds = ['cao', 'soi', 'dien', 'tho'] as const;

    const deck1 = buildFixtureDeck({
      playerIds,
      dealerIndex: 3,
      holeCardsByPlayer: {
        cao: 'As Ks', // acting rival's cards (fixed)
        soi: '2c 7d', // opponent hidden cards (variant 1)
        dien: '3h 8c',
        tho: '4d 9s',
      },
      board: 'Ah Tc 5d 2s 9h', // flop: Ah Tc 5d; turn/river undealt on flop
      undealtPrefix: 'Qd Jc',
    });

    const deck2 = buildFixtureDeck({
      playerIds,
      dealerIndex: 3,
      holeCardsByPlayer: {
        cao: 'As Ks', // acting rival's cards (identical!)
        soi: 'Qh Qd', // opponent hidden cards completely changed!
        dien: 'Jh Jd',
        tho: '9c 8s',
      },
      board: 'Ah Tc 5d Kc Qc', // flop is identical (Ah Tc 5d), unrevealed turn/river changed!
      undealtPrefix: '4c 3d',
    });

    const hand1 = mustStartHand({
      seats: playerIds.map((playerId) => ({ playerId, stack: init.perPlayer })),
      bank: init.bank,
      rng: createRng('b1-hand-1'),
      config: { dealerIndex: 3 },
      fixtures: { deck: deck1, openerId: 'cao' },
    }).state;

    const hand2 = mustStartHand({
      seats: playerIds.map((playerId) => ({ playerId, stack: init.perPlayer })),
      bank: init.bank,
      rng: createRng('b1-hand-2'),
      config: { dealerIndex: 3 },
      fixtures: { deck: deck2, openerId: 'cao' },
    }).state;

    const dto1 = buildRivalDecisionInput(hand1, 'cao');
    const dto2 = buildRivalDecisionInput(hand2, 'cao');

    // Public DTOs must be deep-equal despite completely different opponent cards & undealt deck
    expect(dto1).toEqual(dto2);
    expect(validateRivalDecisionInput(dto1)).toEqual({ ok: true });
    expect(dto1.board).toHaveLength(3);

    for (const rivalId of RIVAL_IDS) {
      const input1: RivalDecisionInput = { ...dto1, rivalId };
      const input2: RivalDecisionInput = { ...dto2, rivalId };
      const res1 = decideRivalAction(input1, createRng(`b1-decide-${rivalId}`));
      const res2 = decideRivalAction(input2, createRng(`b1-decide-${rivalId}`));
      expect(res1).toEqual(res2);

      // Out-of-turn decision for another rival ('dien') with identical own cards & public view
      if (rivalId !== 'cao') {
        const ootDto1 = buildRivalDecisionInput(hand1, 'cao', { rivalId });
        const ootDto2 = buildRivalDecisionInput(hand2, 'cao', { rivalId });
        const oot1 = decideRivalOutOfTurn(
          { ...ootDto1, isMyTurn: false, activePlayerId: 'soi' },
          createRng(`b1-oot-${rivalId}`),
        );
        const oot2 = decideRivalOutOfTurn(
          { ...ootDto2, isMyTurn: false, activePlayerId: 'soi' },
          createRng(`b1-oot-${rivalId}`),
        );
        expect(oot1).toEqual(oot2);
      }
    }

    assertHandInvariants(hand1);
    assertHandInvariants(hand2);
  });

  it('B1: validates decision input at runtime and rejects raw HandState, SeatState.holeCards, deck, outcome, or unrevealed timeline events', () => {
    const init = initialDistribution(4);
    const playerIds = ['cao', 'soi', 'dien', 'tho'] as const;
    const hand = mustStartHand({
      seats: playerIds.map((playerId) => ({ playerId, stack: init.perPlayer })),
      bank: init.bank,
      rng: createRng('b1-runtime-guard'),
      fixtures: { openerId: 'cao' },
    }).state;

    const cleanDto = buildRivalDecisionInput(hand, 'cao');
    expect(validateRivalDecisionInput(cleanDto)).toEqual({ ok: true });

    // 1. Reject passing raw HandState directly
    expect(validateRivalDecisionInput(hand).ok).toBe(false);
    expect(() =>
      decideRivalAction(hand as unknown as RivalDecisionInput, createRng('reject-raw')),
    ).toThrow(/Forbidden hidden field/);

    // 2. Reject top-level deck or outcome leakage
    const withDeck = { ...cleanDto, deck: hand.deck };
    expect(validateRivalDecisionInput(withDeck)).toEqual({
      ok: false,
      reason: expect.stringContaining('deck'),
    });

    const withOutcome = { ...cleanDto, outcome: null };
    expect(validateRivalDecisionInput(withOutcome)).toEqual({
      ok: false,
      reason: expect.stringContaining('outcome'),
    });

    // 3. Reject holeCards inside any publicSeats entry
    const contaminatedSeats = cleanDto.publicSeats.map((s, idx) =>
      idx === 1 ? { ...s, holeCards: hand.seats[1]!.holeCards } : s,
    );
    const withSeatHoleCards = { ...cleanDto, publicSeats: contaminatedSeats };
    expect(validateRivalDecisionInput(withSeatHoleCards)).toEqual({
      ok: false,
      reason: expect.stringContaining('holeCards'),
    });
    expect(() =>
      decideRivalAction(
        withSeatHoleCards as unknown as RivalDecisionInput,
        createRng('reject-seat-cards'),
      ),
    ).toThrow(/holeCards/);

    // 4. Reject showdown event in publicTimeline
    const withShowdownEvent = {
      ...cleanDto,
      publicTimeline: [
        ...cleanDto.publicTimeline,
        {
          type: 'showdown',
          resolution: { uncalledRefund: null, potAwards: [], totalPayouts: [], finalBaiCaoDeck: null },
        },
      ],
    };
    expect(validateRivalDecisionInput(withShowdownEvent).ok).toBe(false);

    // 5. Reject future street-dealt event in publicTimeline while still on flop
    const withFutureTurnEvent = {
      ...cleanDto,
      publicTimeline: [
        ...cleanDto.publicTimeline,
        {
          type: 'street-dealt',
          street: 'turn',
          cards: [parseCard('2s')],
        },
      ],
    };
    expect(validateRivalDecisionInput(withFutureTurnEvent)).toEqual({
      ok: false,
      reason: expect.stringContaining('future street-dealt'),
    });
  });

  it('handles real chip selection including call all-in, cap reached, and missing denominations while preserving INV-1 and INV-2', () => {
    const init = initialDistribution(4);

    // Case A: Call all-in (short stack has 20 points left after ante, faces a bet of 50)
    const shortStack: ChipCounts = { 5: 1, 10: 2, 50: 0, 100: 0 }; // 25 -> 20 after 5 ante
    const bankA = addChips(init.bank, subtractChips(init.perPlayer, shortStack));
    const deckA = buildFixtureDeck({
      playerIds: ['dien', 'ca', 'cao', 'da'],
      dealerIndex: 3,
      holeCardsByPlayer: {
        dien: 'As Ks',
        ca: 'Ah Ad', // strong hand -> calls all-in
        cao: '2c 7d',
        da: '3c 8d',
      },
      board: 'Ac Kd 9s 4h 2d',
    });

    let stateA = mustStartHand({
      seats: [
        { playerId: 'dien', stack: init.perPlayer },
        { playerId: 'ca', stack: shortStack },
        { playerId: 'cao', stack: init.perPlayer },
        { playerId: 'da', stack: init.perPlayer },
      ],
      bank: bankA,
      rng: createRng('case-all-in-call'),
      config: { dealerIndex: 3 },
      fixtures: { deck: deckA, openerId: 'dien' },
    }).state;

    // dien bets 50 (cap)
    const dienDto = buildRivalDecisionInput(stateA, 'dien');
    const dienDecision = decideRivalAction(dienDto, createRng('dien-bet-50'));
    expect(dienDecision.action.type).toBe('bet');
    if (dienDecision.action.type === 'bet') {
      expect(dienDecision.action.amount).toBe(50);
    }
    stateA = mustApply(stateA, 'dien', dienDecision.action).state;

    // ca has 20 left (2x10), faces 50 -> isCallAllIn = true, callAmount = 20
    const caDto = buildRivalDecisionInput(stateA, 'ca');
    expect(caDto.legalActions?.isCallAllIn).toBe(true);
    expect(caDto.legalActions?.callAmount).toBe(20);
    const caDecision = decideRivalAction(caDto, createRng('ca-call-allin'));
    expect(caDecision.action).toEqual({
      type: 'call',
      chips: { 5: 0, 10: 2, 50: 0, 100: 0 },
    });
    stateA = mustApply(stateA, 'ca', caDecision.action).state;
    expect(stateA.seats.find((s) => s.playerId === 'ca')?.status).toBe('all-in');

    // Case B: Cap reached (currentBet === 50) -> even Maniac ('dien') cannot raise past cap, must call or fold
    const caoDtoAtCap = buildRivalDecisionInput(stateA, 'cao', { rivalId: 'dien' });
    expect(caoDtoAtCap.legalActions?.canRaise).toBe(false);
    const atCapDecision = decideRivalAction(caoDtoAtCap, createRng('dien-at-cap'));
    expect(['call', 'fold']).toContain(atCapDecision.action.type);
    stateA = mustApply(stateA, 'cao', atCapDecision.action).state;

    // Case C: Missing small denominations ("mệnh giá thiếu")
    // Seat 'cao' has 1x5 + 9x50 = 455 -> after 5 ante, stack is { 5: 0, 10: 0, 50: 9, 100: 0 } (only 50-point chips!).
    const fiftyOnlyAfterAnte: ChipCounts = { 5: 1, 10: 0, 50: 9, 100: 0 };
    const seatsC = [
      { playerId: 'cao', stack: fiftyOnlyAfterAnte },
      { playerId: 'soi', stack: init.perPlayer },
      { playerId: 'ca', stack: init.perPlayer },
      { playerId: 'da', stack: init.perPlayer },
    ];
    const usedC = seatsC.reduce((acc, s) => addChips(acc, s.stack), emptyChips());
    const bankC = subtractChips(CHIP_SET, usedC);

    let stateC = mustStartHand({
      seats: seatsC,
      bank: bankC,
      rng: createRng('case-missing-denom-bet'),
      config: { dealerIndex: 3 },
      fixtures: {
        deck: deckA, // cao gets As Ks on Ac Kd 9s -> top two pair, wants to bet ~30-35, but only has 50-chips!
        openerId: 'cao',
      },
    }).state;

    const caoMissingDto = buildRivalDecisionInput(stateC, 'cao');
    const caoMissingDecision = decideRivalAction(caoMissingDto, createRng('cao-only-50s'));
    expect(caoMissingDecision.action.type).toBe('bet');
    if (caoMissingDecision.action.type === 'bet') {
      expect(caoMissingDecision.action.amount).toBe(50);
      expect(caoMissingDecision.action.chips).toEqual({ 5: 0, 10: 0, 50: 1, 100: 0 });
      expect(caoMissingDecision.usedFallbackForMissingDenominations).toBe(true);
    }
    stateC = mustApply(stateC, 'cao', caoMissingDecision.action).state;
    assertHandInvariants(stateC);

    // Subcase C2: Facing a bet of 20 with only 50-chips in stack -> cannot form 20 to call, so raises to 50 or folds legally
    let stateC2 = mustStartHand({
      seats: [
        { playerId: 'soi', stack: init.perPlayer },
        { playerId: 'ca', stack: fiftyOnlyAfterAnte },
        { playerId: 'cao', stack: init.perPlayer },
        { playerId: 'da', stack: init.perPlayer },
      ],
      bank: bankC,
      rng: createRng('case-missing-denom-call'),
      config: { dealerIndex: 3 },
      fixtures: { deck: deckA, openerId: 'soi' },
    }).state;

    stateC2 = mustApply(stateC2, 'soi', betAction(stateC2, 'soi', 20)).state;
    const caMissingCallDto = buildRivalDecisionInput(stateC2, 'ca');
    const caMissingCallDecision = decideRivalAction(
      caMissingCallDto,
      createRng('ca-missing-denom-call'),
    );
    expect(caMissingCallDecision.usedFallbackForMissingDenominations).toBe(true);
    stateC2 = mustApply(stateC2, 'ca', caMissingCallDecision.action).state;
    assertHandInvariants(stateC2);
  });

  it('only emits out-of-turn declarations when strictly legal, and leaves execution authority to the engine (X1, X2, D39)', () => {
    const init = initialDistribution(4);
    const playerIds = ['da', 'ca', 'dien', 'tho'] as const;
    let state = mustStartHand({
      seats: playerIds.map((playerId) => ({ playerId, stack: init.perPlayer })),
      bank: init.bank,
      rng: createRng('oot-hand'),
      config: { dealerIndex: 3, allowOutOfTurn: true },
      fixtures: { openerId: 'da' },
    }).state;

    // 1. Not legal for current actor ('da') to declare out-of-turn
    const daDto = buildRivalDecisionInput(state, 'da');
    expect(decideRivalOutOfTurn(daDto, createRng('oot-current-actor')).action).toBeNull();

    // 2. Not legal when allowOutOfTurn is disabled
    const disabledDto: RivalDecisionInput = {
      ...buildRivalDecisionInput(state, 'dien'),
      allowOutOfTurn: false,
    };
    expect(decideRivalOutOfTurn(disabledDto, createRng('oot-disabled')).action).toBeNull();

    // 3. Legal out-of-turn candidate ('dien') declares before turn
    const dienDto = buildRivalDecisionInput(state, 'dien');
    let declaredAction = null;
    for (let i = 0; i < 20 && declaredAction === null; i++) {
      const attempt = decideRivalOutOfTurn(dienDto, createRng(`oot-dien-${i}`));
      if (attempt.action !== null) {
        declaredAction = attempt.action;
      }
    }
    expect(declaredAction).not.toBeNull();
    if (declaredAction === null) throw new Error('Expected dien to declare out of turn');

    // Declare in engine
    state = mustDeclare(state, 'dien', declaredAction).state;

    // 4. Once declared, cannot declare again while active declaration exists
    const dienAfterDeclDto = buildRivalDecisionInput(state, 'dien');
    expect(decideRivalOutOfTurn(dienAfterDeclDto, createRng('oot-already-active')).action).toBeNull();

    // 5. Engine authority at turn time:
    // Path A (X1): da and ca check -> when turn reaches dien, engine auto-executes dien's declaration
    const branchA = mustApply(
      mustApply(state, 'da', { type: 'check' }).state,
      'ca',
      { type: 'check' },
    );
    expect(branchA.autoExecutedDeclarations).toHaveLength(1);
    expect(branchA.autoExecutedDeclarations[0]!.playerId).toBe('dien');

    // Path B (X2): da bets 10 -> engine cancels dien's declaration and returns chips; dien decides freely
    const branchB = mustApply(state, 'da', betAction(state, 'da', 10));
    expect(branchB.cancelledDeclarations).toHaveLength(1);
    expect(branchB.cancelledDeclarations[0]!.playerId).toBe('dien');
  });

  it('produces quantitative weighted ranges with finite non-negative weights, public blocker filtering, and no chip mutation', () => {
    const init = initialDistribution(6);
    const hand = mustStartHand({
      seats: ['da', 'ca', 'cao', 'soi', 'dien', 'bay'].map((playerId) => ({
        playerId,
        stack: init.perPlayer,
      })),
      bank: init.bank,
      rng: createRng('range-test-hand'),
    }).state;

    const bankBefore = { ...hand.bank };
    const potBefore = { ...hand.pot };
    const stacksBefore = hand.seats.map((s) => ({ ...s.stack }));

    const board = parseCards('9h 7h 2c');
    const heroHoleBlockers = parseCards('Js Jd');
    const blockedKeys = new Set([...board, ...heroHoleBlockers].map(formatCard));

    // 47 remaining cards after 3 flop + 2 hero cards => C(47, 2) = 1081 max possible combos
    for (const rivalId of RIVAL_IDS) {
      const estimate = estimateRivalRange({
        rivalId,
        board,
        action: { type: 'bet', amount: 30 },
        blockers: heroHoleBlockers,
        context: {
          opponentCount: 2,
          stackValue: 465,
          potValue: 100,
          positionLabelVi: 'Nói trước hero',
          streetCap: 50,
        },
      });

      expect(estimate.rivalId).toBe(rivalId);
      expect(estimate.street).toBe('flop');
      expect(estimate.combos.length).toBeGreaterThan(0);
      expect(estimate.combos.length).toBeLessThanOrEqual(1081);
      expect(estimate.descriptionVi.length).toBeGreaterThan(0);
      expect(estimate.assumptionsVi.length).toBeGreaterThanOrEqual(4);

      const seenComboPairs = new Set<string>();
      for (const combo of estimate.combos) {
        expect(combo.cards).toHaveLength(2);
        expect(Number.isFinite(combo.weight)).toBe(true);
        expect(combo.weight).toBeGreaterThanOrEqual(0);
        expect(combo.weight).toBeLessThanOrEqual(1);

        const k0 = formatCard(combo.cards[0]);
        const k1 = formatCard(combo.cards[1]);
        expect(k0).not.toBe(k1);
        // Must strictly exclude all public board cards and passed blockers
        expect(blockedKeys.has(k0)).toBe(false);
        expect(blockedKeys.has(k1)).toBe(false);

        const pairKey = k0 < k1 ? `${k0}-${k1}` : `${k1}-${k0}`;
        expect(seenComboPairs.has(pairKey)).toBe(false);
        seenComboPairs.add(pairKey);
      }
    }

    // Compare profile range widths on a cap bet of 50: Điên has a much wider weighted range than Đá
    const daBetRange = getRivalRangeCombos({
      rivalId: 'da',
      board,
      action: { type: 'bet', amount: 50 },
    });
    const dienBetRange = getRivalRangeCombos({
      rivalId: 'dien',
      board,
      action: { type: 'bet', amount: 50 },
    });
    const sumWeight = (combos: readonly { readonly weight: number }[]) =>
      combos.reduce((acc, c) => acc + c.weight, 0);

    expect(sumWeight(dienBetRange)).toBeGreaterThan(sumWeight(daBetRange) * 2);

    // Compare Nóng normal vs Nóng tilted range width
    const nongNormalRange = estimateRivalRange({
      rivalId: 'nong',
      board,
      action: { type: 'raise', raiseTo: 50 },
      tiltState: createInitialNongTiltState(),
    });
    const tiltedState: NongTiltState = {
      isTilted: true,
      handsRemaining: 3,
      totalTiltDuration: 3,
      triggerReason: 'big-pot-loss',
    };
    const nongTiltedRange = estimateRivalRange({
      rivalId: 'nong',
      board,
      action: { type: 'raise', raiseTo: 50 },
      tiltState: tiltedState,
    });
    expect(nongNormalRange.isTilted).toBe(false);
    expect(nongTiltedRange.isTilted).toBe(true);
    expect(sumWeight(nongTiltedRange.combos)).toBeGreaterThan(
      sumWeight(nongNormalRange.combos) * 1.5,
    );
    expect(nongTiltedRange.descriptionVi).toContain('tilt');

    // Confirm chip state and invariants were never mutated by range calculations
    expect(hand.bank).toEqual(bankBefore);
    expect(hand.pot).toEqual(potBefore);
    expect(hand.seats.map((s) => s.stack)).toEqual(stacksBefore);
    expect(chipValue(hand.pot)).toBe(30);
    assertHandInvariants(hand);
  });
});
