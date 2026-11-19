import { describe, expect, it } from 'vitest';
import { initialDistribution } from '../../../src/engine/bank';
import { parseCards } from '../../../src/engine/cards';
import { chipValue } from '../../../src/engine/chips';
import { createRng } from '../../../src/engine/rng';
import {
  buildRivalDecisionInput,
  createInitialNongTiltState,
  evaluateNongTiltTrigger,
  getRivalSeatMetadata,
  NONG_MAX_TILT_HANDS,
  NONG_MIN_TILT_HANDS,
  NONG_TILT_POT_THRESHOLD,
  sampleNongTiltDuration,
  summarizeCompletedHandForRivals,
  updateNongTiltStateAtBoundary,
  validatePublicHandResultSummary,
  type PublicHandResultSummary,
} from '../../../src/engine/rivals';
import type { TieBreakMode } from '../../../src/engine/showdown';
import { createBoundaryFromHand, nextDealerArrayIndex } from '../../../src/engine/tableBoundary';
import {
  assertBoundaryInv1,
  assertHandInvariants,
  betAction,
  buildFixtureDeck,
  callAction,
  mustApply,
  mustStartHand,
} from '../handTestHelpers';

/**
 * Plays a 4-player hand ('nong', 'cao', 'soi', 'da') to showdown or fold-win with exact total pot size,
 * checking INV-1 and INV-2 after every engine step.
 */
function playFourPlayerShowdownHand(opts: {
  readonly seed: string;
  readonly nongCards: string;
  readonly caoCards: string;
  readonly soiCards?: string;
  readonly daCards?: string;
  readonly board: string;
  readonly flopBet: number;
  readonly turnBet: number;
  readonly riverBet: number;
  readonly tieBreakMode?: TieBreakMode;
}) {
  const init = initialDistribution(4);
  const playerIds = ['nong', 'cao', 'soi', 'da'] as const;
  const deck = buildFixtureDeck({
    playerIds,
    dealerIndex: 3,
    holeCardsByPlayer: {
      nong: opts.nongCards,
      cao: opts.caoCards,
      ...(opts.soiCards !== undefined ? { soi: opts.soiCards } : {}),
      ...(opts.daCards !== undefined ? { da: opts.daCards } : {}),
    },
    board: opts.board,
  });

  let state = mustStartHand({
    seats: playerIds.map((playerId) => ({ playerId, stack: init.perPlayer })),
    bank: init.bank,
    rng: createRng(opts.seed),
    config: {
      dealerIndex: 3,
      tieBreakMode: opts.tieBreakMode ?? 'bai-cao',
    },
    fixtures: { deck, openerId: 'nong' },
  }).state;

  // Flop (initial pot = 20 from 4 antes): nong and cao stay in; soi and da fold
  if (opts.flopBet > 0) {
    state = mustApply(state, 'nong', betAction(state, 'nong', opts.flopBet)).state;
    state = mustApply(state, 'cao', callAction(state, 'cao')).state;
    state = mustApply(state, 'soi', { type: 'fold' }).state;
    state = mustApply(state, 'da', { type: 'fold' }).state;
  } else {
    state = mustApply(state, 'nong', { type: 'check' }).state;
    state = mustApply(state, 'cao', { type: 'check' }).state;
    state = mustApply(state, 'soi', { type: 'fold' }).state;
    state = mustApply(state, 'da', { type: 'fold' }).state;
  }

  // Turn (only nong and cao active)
  if (opts.turnBet > 0) {
    state = mustApply(state, 'nong', betAction(state, 'nong', opts.turnBet)).state;
    state = mustApply(state, 'cao', callAction(state, 'cao')).state;
  } else {
    state = mustApply(state, 'nong', { type: 'check' }).state;
    state = mustApply(state, 'cao', { type: 'check' }).state;
  }

  // River (only nong and cao active)
  if (opts.riverBet > 0) {
    state = mustApply(state, 'nong', betAction(state, 'nong', opts.riverBet)).state;
    state = mustApply(state, 'cao', callAction(state, 'cao')).state;
  } else {
    state = mustApply(state, 'nong', { type: 'check' }).state;
    state = mustApply(state, 'cao', { type: 'check' }).state;
  }

  expect(state.phase).toBe('complete');
  assertHandInvariants(state);
  return state;
}

describe('P2b rivals — Nóng tilt triggers, public state, and 3–5 hand countdown (B5, B7)', () => {
  it('B5: losing a 160-point pot at showdown triggers tilt starting on the NEXT hand for 3–5 hands, then returns to normal', () => {
    expect(NONG_TILT_POT_THRESHOLD).toBe(150);

    // Total pot = 20 (ante) + 2*30 (flop) + 2*20 (turn) + 2*20 (river) = 160
    // Board: Ks Qh 8c 4d 2s. cao has Kh Kd (top set from flop), nong has Qs Qc (middle set, behind on turn & loses at showdown)
    const hand1 = playFourPlayerShowdownHand({
      seed: 'b5-pot-160',
      nongCards: 'Qs Qc',
      caoCards: 'Kh Kd',
      board: 'Ks Qh 8c 4d 2s',
      flopBet: 30,
      turnBet: 20,
      riverBet: 20,
    });

    const summary1 = summarizeCompletedHandForRivals(hand1);
    expect(validatePublicHandResultSummary(summary1)).toEqual({ ok: true });
    expect(summary1.potAwards).toHaveLength(1);
    expect(summary1.potAwards[0]!.potAmount).toBe(160);
    // Folded players ('soi', 'da') must NOT have hole cards in revealedShowdownCards
    expect(Object.keys(summary1.revealedShowdownCards).sort()).toEqual(['cao', 'nong']);

    const triggerEval = evaluateNongTiltTrigger(summary1);
    expect(triggerEval).toEqual({
      triggered: true,
      reason: 'big-pot-loss',
      triggeringPotIndex: 0,
      triggeringPotAmount: 160,
    });

    // During Hand 1 itself, Nóng was normal; tilt transitions at the boundary for Hand 2
    let tiltState = createInitialNongTiltState();
    expect(getRivalSeatMetadata('nong', tiltState).isTilted).toBe(false);

    const boundaryRng = createRng('b5-tilt-duration-seed');
    const expectedDuration = sampleNongTiltDuration(boundaryRng);
    expect(expectedDuration).toBeGreaterThanOrEqual(NONG_MIN_TILT_HANDS);
    expect(expectedDuration).toBeLessThanOrEqual(NONG_MAX_TILT_HANDS);

    tiltState = updateNongTiltStateAtBoundary(tiltState, summary1, boundaryRng);
    expect(tiltState).toEqual({
      isTilted: true,
      handsRemaining: expectedDuration,
      totalTiltDuration: expectedDuration,
      triggerReason: 'big-pot-loss',
    });

    // Reading public seat metadata does not consume handsRemaining
    const metaBeforeNextHand = getRivalSeatMetadata('nong', tiltState);
    expect(metaBeforeNextHand.isTilted).toBe(true);
    expect(metaBeforeNextHand.publicMood).toBe('tilted');
    expect(metaBeforeNextHand.tiltHandsRemaining).toBe(expectedDuration);
    expect(tiltState.handsRemaining).toBe(expectedDuration);

    // Play through `expectedDuration` subsequent hands via real engine + boundary and verify countdown back to normal
    let boundaryRes = createBoundaryFromHand(hand1);
    expect(boundaryRes.ok).toBe(true);
    if (!boundaryRes.ok) throw new Error('Expected boundary');
    let currentBoundary = boundaryRes.state;
    assertBoundaryInv1(
      currentBoundary.bank,
      currentBoundary.seats.map((s) => s.stack),
    );

    for (let handOffset = 1; handOffset <= expectedDuration; handOffset++) {
      expect(tiltState.isTilted).toBe(true);
      expect(tiltState.handsRemaining).toBe(expectedDuration - handOffset + 1);

      let nextHand = mustStartHand({
        seats: currentBoundary.seats,
        bank: currentBoundary.bank,
        rng: createRng(`b5-followup-hand-${handOffset}`),
        config: { dealerIndex: nextDealerArrayIndex(currentBoundary) },
      }).state;

      // Verify in-hand decision DTO reflects public tilt state without decrementing handsRemaining
      const inHandDto = buildRivalDecisionInput(nextHand, 'nong', { tiltState });
      expect(inHandDto.tiltState?.isTilted).toBe(true);
      expect(inHandDto.tiltState?.handsRemaining).toBe(expectedDuration - handOffset + 1);

      // Everyone checks down to showdown (or folds)
      while (nextHand.phase === 'betting' && nextHand.activePlayerId !== null) {
        nextHand = mustApply(nextHand, nextHand.activePlayerId, { type: 'check' }).state;
      }
      expect(nextHand.phase).toBe('complete');

      const handSummary = summarizeCompletedHandForRivals(nextHand);
      tiltState = updateNongTiltStateAtBoundary(
        tiltState,
        handSummary,
        createRng(`b5-boundary-${handOffset}`),
      );

      boundaryRes = createBoundaryFromHand(nextHand);
      expect(boundaryRes.ok).toBe(true);
      if (!boundaryRes.ok) throw new Error('Expected boundary');
      currentBoundary = boundaryRes.state;
      assertBoundaryInv1(
        currentBoundary.bank,
        currentBoundary.seats.map((s) => s.stack),
      );
    }

    // After playing all `expectedDuration` tilt hands, Nóng returns to normal!
    expect(tiltState).toEqual({
      isTilted: false,
      handsRemaining: 0,
      totalTiltDuration: 0,
      triggerReason: null,
    });
    expect(getRivalSeatMetadata('nong', tiltState).isTilted).toBe(false);
    expect(getRivalSeatMetadata('nong', tiltState).publicMood).toBe('normal');
  });

  it('B5 & B7: checks exact threshold 150 and pot 100 with vs without turn bad beat (6-card turn evaluation on revealed cards only)', () => {
    // 1. Exact threshold 150: 20 (ante) + 2*25 (flop) + 2*20 (turn) + 2*20 (river) = 150
    // Nóng is behind from flop (no bad beat), loses pot 150 -> triggers 'big-pot-loss'
    const hand150 = playFourPlayerShowdownHand({
      seed: 'threshold-150',
      nongCards: 'Qs Qc',
      caoCards: 'Kh Kd',
      board: 'Ks Qh 8c 4d 2s',
      flopBet: 25,
      turnBet: 20,
      riverBet: 20,
    });
    const summary150 = summarizeCompletedHandForRivals(hand150);
    expect(summary150.potAwards[0]!.potAmount).toBe(150);
    expect(evaluateNongTiltTrigger(summary150)).toEqual({
      triggered: true,
      reason: 'big-pot-loss',
      triggeringPotIndex: 0,
      triggeringPotAmount: 150,
    });

    // 2. Just below threshold (140): 20 (ante) + 2*20 (flop) + 2*20 (turn) + 2*20 (river) = 140, no bad beat -> does NOT trigger
    const hand140 = playFourPlayerShowdownHand({
      seed: 'below-threshold-140',
      nongCards: 'Qs Qc',
      caoCards: 'Kh Kd',
      board: 'Ks Qh 8c 4d 2s',
      flopBet: 20,
      turnBet: 20,
      riverBet: 20,
    });
    const summary140 = summarizeCompletedHandForRivals(hand140);
    expect(summary140.potAwards[0]!.potAmount).toBe(140);
    expect(evaluateNongTiltTrigger(summary140).triggered).toBe(false);

    // 3. AC B7 — Pot 100 WITHOUT turn bad beat: 20 (ante) + 2*20 (flop) + 2*10 (turn) + 2*10 (river) = 100
    // cao leads on flop & turn with top pair As Ks on Ah 9c 4d 2s; river 7h -> Nóng loses pot 100 without leading on turn -> NO tilt
    const hand100NoBadBeat = playFourPlayerShowdownHand({
      seed: 'b7-pot-100-no-bad-beat',
      nongCards: 'Ac Qd', // top pair Q kicker (behind As Ks on turn)
      caoCards: 'As Ks', // top pair K kicker (leads on turn and wins river)
      board: 'Ah 9c 4d 2s 7h',
      flopBet: 20,
      turnBet: 10,
      riverBet: 10,
    });
    const summary100NoBadBeat = summarizeCompletedHandForRivals(hand100NoBadBeat);
    expect(summary100NoBadBeat.potAwards[0]!.potAmount).toBe(100);
    expect(evaluateNongTiltTrigger(summary100NoBadBeat)).toEqual({
      triggered: false,
      reason: null,
      triggeringPotIndex: null,
      triggeringPotAmount: null,
    });

    // 4. AC B7 — Pot 100 WITH turn bad beat:
    // Board: Ah 9c 4d 2s Kh.
    // On turn (Ah 9c 4d 2s): Nóng has As 9s (two pair Aces and Nines) > cao's Ac Kc (pair of Aces, K kicker).
    // On river (Kh): cao hits Aces and Kings two pair and beats Nóng!
    // Even if folded player 'soi' had 4h 4c (set of 4s on turn!), 'soi' folded on flop so 'soi's cards were never revealed!
    const hand100BadBeat = playFourPlayerShowdownHand({
      seed: 'b7-pot-100-turn-bad-beat',
      nongCards: 'As 9s', // leads on turn (Aces & 9s) among revealed players
      caoCards: 'Ac Kc', // behind on turn (pair of Aces), rivers Aces & Kings!
      soiCards: '4h 4c', // folded on flop (unrevealed set of 4s must NOT be read!)
      board: 'Ah 9c 4d 2s Kh',
      flopBet: 20,
      turnBet: 10,
      riverBet: 10,
    });
    const summary100BadBeat = summarizeCompletedHandForRivals(hand100BadBeat);
    expect(summary100BadBeat.potAwards[0]!.potAmount).toBe(100);
    expect(summary100BadBeat.revealedShowdownCards['soi']).toBeUndefined();
    expect(evaluateNongTiltTrigger(summary100BadBeat)).toEqual({
      triggered: true,
      reason: 'turn-bad-beat',
      triggeringPotIndex: 0,
      triggeringPotAmount: 100,
    });
  });

  it('distinguishes an outright lost pot from a split pot share, ignores pots where Nóng is ineligible, and rejects unrevealed hole cards', () => {
    // 1. Split pot of 160 in 'split' mode: both Nóng and cao play the board straight 5-6-7-8-9 -> each receives 80
    const splitHand160 = playFourPlayerShowdownHand({
      seed: 'split-pot-160',
      nongCards: '2c 2d',
      caoCards: '3c 3d',
      board: '5s 6h 7c 8d 9s',
      flopBet: 30,
      turnBet: 20,
      riverBet: 20,
      tieBreakMode: 'split',
    });
    const splitSummary = summarizeCompletedHandForRivals(splitHand160);
    expect(splitSummary.potAwards[0]!.potAmount).toBe(160);
    expect(splitSummary.potAwards[0]!.awards).toEqual([
      { playerId: 'nong', amount: 80 },
      { playerId: 'cao', amount: 80 },
    ]);
    // Split pot share > 0 must NOT trigger tilt
    expect(evaluateNongTiltTrigger(splitSummary).triggered).toBe(false);

    // 2. Hand where Nóng folded on flop, while cao and soi build a 180-point pot at showdown
    const init = initialDistribution(4);
    const playerIds = ['nong', 'cao', 'soi', 'da'] as const;
    const deck = buildFixtureDeck({
      playerIds,
      dealerIndex: 3,
      holeCardsByPlayer: {
        nong: 'As Ah',
        cao: 'Kh Kd',
        soi: 'Qh Qd',
        da: '2c 7d',
      },
      board: 'Ks Qc 8d 4s 2h',
    });
    let state = mustStartHand({
      seats: playerIds.map((playerId) => ({ playerId, stack: init.perPlayer })),
      bank: init.bank,
      rng: createRng('nong-folded-before-showdown'),
      config: { dealerIndex: 3 },
      fixtures: { deck, openerId: 'nong' },
    }).state;

    // Nóng folds on flop; cao and soi bet 50 on flop, 30 on turn -> pot = 20 + 100 + 60 = 180 at showdown
    state = mustApply(state, 'nong', { type: 'fold' }).state;
    state = mustApply(state, 'cao', betAction(state, 'cao', 50)).state;
    state = mustApply(state, 'soi', callAction(state, 'soi')).state;
    state = mustApply(state, 'da', { type: 'fold' }).state;
    state = mustApply(state, 'cao', betAction(state, 'cao', 30)).state;
    state = mustApply(state, 'soi', callAction(state, 'soi')).state;
    state = mustApply(state, 'cao', { type: 'check' }).state;
    state = mustApply(state, 'soi', { type: 'check' }).state;

    expect(state.phase).toBe('complete');
    const foldedSummary = summarizeCompletedHandForRivals(state);
    expect(foldedSummary.potAwards[0]!.potAmount).toBe(180);
    expect(foldedSummary.potAwards[0]!.eligiblePlayerIds).toEqual(['cao', 'soi']);
    expect(foldedSummary.revealedShowdownCards['nong']).toBeUndefined();
    expect(evaluateNongTiltTrigger(foldedSummary).triggered).toBe(false);

    // 3. Reject contaminated summary containing a folded player's hole cards
    const contaminatedSummary: PublicHandResultSummary = {
      ...foldedSummary,
      revealedShowdownCards: {
        ...foldedSummary.revealedShowdownCards,
        da: parseCards('2c 7d') as unknown as readonly [
          (typeof foldedSummary.board)[number],
          (typeof foldedSummary.board)[number],
        ],
      },
    };
    expect(validatePublicHandResultSummary(contaminatedSummary)).toEqual({
      ok: false,
      reason: expect.stringContaining('Unrevealed/folded player "da"'),
    });
    expect(() => evaluateNongTiltTrigger(contaminatedSummary)).toThrow(/Unrevealed\/folded player/);
    expect(chipValue(state.pot)).toBe(0);
  });

  it('QUESTIONS.md M2 #2: keeps active tilt within the drawn 3–5 hand window when a new trigger occurs while already tilted', () => {
    const hand160 = playFourPlayerShowdownHand({
      seed: 'retrigger-while-tilted',
      nongCards: 'Qs Qc',
      caoCards: 'Kh Kd',
      board: 'Ks Qh 8c 4d 2s',
      flopBet: 30,
      turnBet: 20,
      riverBet: 20,
    });
    const triggeringSummary = summarizeCompletedHandForRivals(hand160);
    expect(evaluateNongTiltTrigger(triggeringSummary).triggered).toBe(true);

    // Trigger initial tilt
    const initialTilt = updateNongTiltStateAtBoundary(
      createInitialNongTiltState(),
      triggeringSummary,
      createRng('initial-tilt-seed'),
    );
    expect(initialTilt.isTilted).toBe(true);
    const drawnDuration = initialTilt.handsRemaining;
    expect(drawnDuration).toBeGreaterThanOrEqual(3);
    expect(drawnDuration).toBeLessThanOrEqual(5);

    // During the 1st tilted hand, Nóng again loses a 160-point pot at showdown
    const afterFirstTiltedHand = updateNongTiltStateAtBoundary(
      initialTilt,
      triggeringSummary,
      createRng('retrigger-attempt-seed'),
    );

    // Must decrement by 1 (not extend or reset to a new 3–5 window)
    expect(afterFirstTiltedHand.isTilted).toBe(true);
    expect(afterFirstTiltedHand.handsRemaining).toBe(drawnDuration - 1);
    expect(afterFirstTiltedHand.totalTiltDuration).toBe(drawnDuration);
  });

  it('treats prototype property names (__proto__, constructor, toString) as ordinary player IDs in full-engine showdown summaries while preserving public-card isolation and chip invariants', () => {
    const init = initialDistribution(4);

    // 1. Exact reproduction: 4-player full-engine showdown with ['nong', '__proto__', 'cao', 'soi'],
    // createRng('control-player-id'), dealerIndex 3, and checks until complete.
    const controlSeatIds = ['nong', '__proto__', 'cao', 'soi'] as const;
    let controlHand = mustStartHand({
      seats: controlSeatIds.map((playerId) => ({ playerId, stack: init.perPlayer })),
      bank: init.bank,
      rng: createRng('control-player-id'),
      config: { dealerIndex: 3 },
    }).state;

    while (controlHand.phase === 'betting' && controlHand.activePlayerId !== null) {
      controlHand = mustApply(controlHand, controlHand.activePlayerId, { type: 'check' }).state;
    }

    expect(controlHand.phase).toBe('complete');
    assertHandInvariants(controlHand);

    const controlSummary = summarizeCompletedHandForRivals(controlHand);
    expect(validatePublicHandResultSummary(controlSummary)).toEqual({ ok: true });
    expect(Object.getPrototypeOf(controlSummary.revealedShowdownCards)).toBeNull();
    expect(
      Object.prototype.hasOwnProperty.call(controlSummary.revealedShowdownCards, '__proto__'),
    ).toBe(true);
    expect(Object.keys(controlSummary.revealedShowdownCards).sort()).toEqual([
      '__proto__',
      'cao',
      'nong',
      'soi',
    ]);

    const protoSeat = controlHand.seats.find((s) => s.playerId === '__proto__')!;
    expect(controlSummary.revealedShowdownCards['__proto__']).toEqual(protoSeat.holeCards);
    expect(() => evaluateNongTiltTrigger(controlSummary)).not.toThrow();

    // 2. Full-engine showdown with prototype-named seats where '__proto__' rivers a turn bad beat
    // against 'nong' in a 100-point pot while 'constructor' and 'toString' fold on the flop.
    const protoBattleIds = ['nong', '__proto__', 'constructor', 'toString'] as const;
    const holeCardsByPlayer = Object.create(null) as Record<string, string>;
    holeCardsByPlayer['nong'] = 'As 9s';
    holeCardsByPlayer['__proto__'] = 'Ac Kc';
    holeCardsByPlayer['constructor'] = '4h 4c';
    holeCardsByPlayer['toString'] = '2h 7c';

    const deck = buildFixtureDeck({
      playerIds: protoBattleIds,
      dealerIndex: 3,
      holeCardsByPlayer,
      board: 'Ah 9c 4d 2s Kh',
    });

    let battleHand = mustStartHand({
      seats: protoBattleIds.map((playerId) => ({ playerId, stack: init.perPlayer })),
      bank: init.bank,
      rng: createRng('proto-bad-beat-hand'),
      config: { dealerIndex: 3 },
      fixtures: { deck, openerId: 'nong' },
    }).state;

    // Flop: nong bets 20, __proto__ calls, constructor and toString fold
    battleHand = mustApply(battleHand, 'nong', betAction(battleHand, 'nong', 20)).state;
    battleHand = mustApply(battleHand, '__proto__', callAction(battleHand, '__proto__')).state;
    battleHand = mustApply(battleHand, 'constructor', { type: 'fold' }).state;
    battleHand = mustApply(battleHand, 'toString', { type: 'fold' }).state;

    // Turn: nong bets 10, __proto__ calls
    battleHand = mustApply(battleHand, 'nong', betAction(battleHand, 'nong', 10)).state;
    battleHand = mustApply(battleHand, '__proto__', callAction(battleHand, '__proto__')).state;

    // River: nong bets 10, __proto__ calls -> 100-point pot at showdown
    battleHand = mustApply(battleHand, 'nong', betAction(battleHand, 'nong', 10)).state;
    battleHand = mustApply(battleHand, '__proto__', callAction(battleHand, '__proto__')).state;

    expect(battleHand.phase).toBe('complete');
    assertHandInvariants(battleHand);

    const battleSummary = summarizeCompletedHandForRivals(battleHand);
    expect(validatePublicHandResultSummary(battleSummary)).toEqual({ ok: true });
    expect(Object.keys(battleSummary.revealedShowdownCards).sort()).toEqual(['__proto__', 'nong']);
    // Public-card isolation: folded 'constructor' and 'toString' must not be present or inherited
    expect(
      Object.prototype.hasOwnProperty.call(battleSummary.revealedShowdownCards, 'constructor'),
    ).toBe(false);
    expect(
      Object.prototype.hasOwnProperty.call(battleSummary.revealedShowdownCards, 'toString'),
    ).toBe(false);
    expect(battleSummary.revealedShowdownCards['constructor']).toBeUndefined();
    expect(battleSummary.revealedShowdownCards['toString']).toBeUndefined();

    expect(evaluateNongTiltTrigger(battleSummary)).toEqual({
      triggered: true,
      reason: 'turn-bad-beat',
      triggeringPotIndex: 0,
      triggeringPotAmount: 100,
    });

    // Own-key lookup on a caller-supplied plain `{}` summary must not treat inherited Object.prototype
    // properties as revealed hole cards when a prototype-named seat folded.
    const plainObjectSummary: PublicHandResultSummary = {
      ...battleSummary,
      revealedShowdownCards: {
        nong: battleSummary.revealedShowdownCards['nong']!,
      },
    };
    expect(evaluateNongTiltTrigger(plainObjectSummary, 'constructor').triggered).toBe(false);
    expect(evaluateNongTiltTrigger(plainObjectSummary, '__proto__').triggered).toBe(false);
    expect(evaluateNongTiltTrigger(plainObjectSummary, 'nong').triggered).toBe(false);

    // Reject extra hidden keys (e.g. deck, seats, or extra potAward fields) on PublicHandResultSummary
    const summaryWithDeck = { ...battleSummary, deck: battleHand.deck };
    expect(validatePublicHandResultSummary(summaryWithDeck)).toEqual({
      ok: false,
      reason: expect.stringContaining('deck'),
    });
    expect(() =>
      evaluateNongTiltTrigger(summaryWithDeck as unknown as PublicHandResultSummary),
    ).toThrow(/deck/);
    expect(() =>
      updateNongTiltStateAtBoundary(
        createInitialNongTiltState(),
        summaryWithDeck as unknown as PublicHandResultSummary,
        createRng('reject-summary-deck'),
      ),
    ).toThrow(/deck/);

    const summaryWithPotExtra = {
      ...battleSummary,
      potAwards: battleSummary.potAwards.map((p) => ({ ...p, deck: battleHand.deck })),
    };
    expect(validatePublicHandResultSummary(summaryWithPotExtra).ok).toBe(false);
  });
});
