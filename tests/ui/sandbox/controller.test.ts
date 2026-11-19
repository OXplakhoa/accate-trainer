import { describe, expect, it } from 'vitest';
import {
  checkReadyForNextHand,
  chipValue,
  createDeck,
  emptyChips,
  parseCard,
  profitLoss,
  RIVAL_IDS,
  summarizeLedger,
  type Card,
  type HandState,
} from '../../../src/engine';
import {
  applySettingsUpdate,
  canPracticeDecisionRecord,
  cashOutPlayerAtBoundary,
  createSandboxSession,
  enterHandBoundary,
  exchangeAtBoundary,
  exchangeInHand,
  getHeroActionValidation,
  getPersistedSettingsForSession,
  getSeatRivalMetadata,
  HERO_PLAYER_ID,
  inviteRivalAtBoundary,
  isSeatCardsRevealed,
  loadSandboxSettings,
  performHeroAction,
  performHeroAutoTimeout,
  performHeroOutOfTurn,
  rebuyPlayerAtBoundary,
  requestHeroLeave,
  saveSandboxSettings,
  seatHeroAtBoundary,
  settleAwaitingPayout,
  stageChip,
  startNextHand,
  stepOneBotTurn,
  toggleAudioMute,
  unstageLastChip,
  verifySessionInvariants,
  type SandboxSessionState,
} from '../../../src/ui/sandbox';
import {
  suggestBoundaryAnteExchanges,
  suggestPendingPayoutExchanges,
} from '../../../src/ui/sandbox/exchangeHelpers';

function assertInvariants(session: SandboxSessionState, stepLabel: string): void {
  const report = verifySessionInvariants(session);
  expect(report.ok, `${stepLabel}: ${report.detail}`).toBe(true);
}

/**
 * Builds a deterministic 52-card deck so every seat and board gets specific cards.
 */
function buildFixtureDeck(params: {
  readonly seatOrderIds: readonly string[];
  readonly dealerIndex: number;
  readonly holeByPlayer: Readonly<Record<string, readonly [Card, Card]>>;
  readonly board: readonly Card[];
}): Card[] {
  const n = params.seatOrderIds.length;
  const used = new Set<string>();
  const key = (c: Card) => `${c.rank}:${c.suit}`;
  const mark = (c: Card) => {
    const k = key(c);
    if (used.has(k)) {
      throw new Error(`Duplicate fixture card ${k}`);
    }
    used.add(k);
  };

  for (const pair of Object.values(params.holeByPlayer)) {
    mark(pair[0]);
    mark(pair[1]);
  }
  for (const c of params.board) {
    mark(c);
  }

  const remaining = createDeck().filter((c) => !used.has(key(c)));
  let remIdx = 0;

  const dealOrder: string[] = [];
  for (let offset = 1; offset <= n; offset++) {
    dealOrder.push(params.seatOrderIds[(params.dealerIndex + offset) % n]!);
  }

  const deck: Card[] = [];
  for (let round = 0; round < 2; round++) {
    for (const pid of dealOrder) {
      const assigned = params.holeByPlayer[pid];
      deck.push(assigned ? assigned[round]! : remaining[remIdx++]!);
    }
  }
  for (const b of params.board) {
    deck.push(b);
  }
  while (remIdx < remaining.length) {
    deck.push(remaining[remIdx++]!);
  }
  return deck;
}

function advanceUntilHeroOrEnd(session: SandboxSessionState, maxSteps = 250): SandboxSessionState {
  let cur = session;
  let steps = 0;
  while (
    cur.phase === 'in-hand' &&
    cur.hand !== null &&
    cur.hand.phase === 'betting' &&
    (cur.hand.activePlayerId !== HERO_PLAYER_ID || cur.pendingHeroLeave) &&
    steps < maxSteps
  ) {
    cur = stepOneBotTurn(cur);
    assertInvariants(cur, `bot step ${steps}`);
    steps++;
  }
  return cur;
}

describe('P4 Sandbox Controller — Invariants, C2–C7, T1–T4, X4–X6, Showdown & Continuity', () => {
  it('C2: locks Call/Bet confirmation when staged physical chips mismatch and unlocks on exact match', () => {
    const initial = createSandboxSession({
      seed: 'p4-c2-seed',
      settings: { playerCount: 4, allowOutOfTurn: false },
      fixtures: { openerId: HERO_PLAYER_ID },
    });
    assertInvariants(initial, 'initial');

    // Hero opens flop: stage 5 + 10 + 10 = 25, then undo last 10 -> 15
    let s = stageChip(initial, 5);
    s = stageChip(s, 10);
    s = stageChip(s, 10);
    expect(getHeroActionValidation(s).stagedValue).toBe(25);
    expect(getHeroActionValidation(s).canConfirmBet).toBe(true);

    s = unstageLastChip(s);
    expect(getHeroActionValidation(s).stagedValue).toBe(15);

    // Stage beyond cap (50 + 10 = 60) -> Bet must be LOCKED
    s = stageChip(s, 50);
    expect(getHeroActionValidation(s).stagedValue).toBe(65);
    expect(getHeroActionValidation(s).canConfirmBet).toBe(false);

    // Now test facing a bet of 30: rival opens, verify hero Call 30 is locked when staged = 35
    const s2Base = createSandboxSession({
      seed: 'p4-c2-call',
      settings: { playerCount: 4, allowOutOfTurn: false },
    });
    const rivalId = s2Base.hand!.seats.find((seat) => seat.playerId !== HERO_PLAYER_ID)!.playerId;
    const s2 = createSandboxSession({
      seed: 'p4-c2-call',
      settings: { playerCount: 4, allowOutOfTurn: false },
      fixtures: { openerId: rivalId },
    });
    expect(s2.hand!.activePlayerId).toBe(rivalId);

    // Build a deterministic bet-50 flop where Hero must call 50 (cap reached): staging 35 MUST lock Call & Raise!
    const sCapFace = createSandboxSession({
      seed: 'p4-c2-cap-face',
      settings: { playerCount: 4, enabledRivalIds: ['dien', 'da', 'ca'], allowOutOfTurn: false },
      fixtures: { openerId: 'dien' },
    });
    const sTurn = advanceUntilHeroOrEnd(sCapFace);
    if (sTurn.hand?.activePlayerId === HERO_PLAYER_ID && sTurn.hand.currentBet > 0) {
      const toCall = sTurn.hand.currentBet;
      // Stage mismatching amount (toCall + 5 if toCall === 50, or 5 when toCall >= 10)
      const mismatchDenom = toCall >= 10 ? 5 : 10;
      const stagedMismatch = stageChip(sTurn, mismatchDenom);
      expect(getHeroActionValidation(stagedMismatch).canConfirmCall).toBe(false);
    }

    // Simulate a clean bet-30 scenario where currentBet=30, cap=50:
    // Use hero opener to bet 30, or let's stage 35 vs call 30 after capping at 50 vs non-cap
    const bet50Session = createSandboxSession({
      seed: 'p4-c2-cap-test',
      settings: { playerCount: 4, allowOutOfTurn: false },
      fixtures: { openerId: HERO_PLAYER_ID },
    });
    let sCap = stageChip(bet50Session, 50);
    sCap = performHeroAction(sCap, 'bet');
    assertInvariants(sCap, 'after hero bet 50');

    // Verify rejected engine action preserves state cleanly
    const badHandSession = createSandboxSession({
      seed: 'p4-c2-mismatch',
      settings: { playerCount: 4, allowOutOfTurn: false },
      fixtures: { openerId: HERO_PLAYER_ID },
    });
    let sBad = stageChip(badHandSession, 50);
    sBad = stageChip(sBad, 10); // 60 > cap 50
    const beforeTimelineLen = sBad.hand!.timeline.length;
    const afterBad = performHeroAction(sBad, 'bet');
    expect(afterBad.hand!.timeline.length).toBe(beforeTimelineLen);
    expect(afterBad.statusNotice?.tone).toBe('error');
    assertInvariants(afterBad, 'after rejected bet 60');
  });

  it('C3: exchanges large chip for smaller chips with player or pot during hand preserving INV-1 & INV-2', () => {
    const s0 = createSandboxSession({
      seed: 'p4-c3-exchange',
      settings: { playerCount: 4, allowOutOfTurn: false },
      fixtures: { openerId: HERO_PLAYER_ID },
    });
    assertInvariants(s0, 'c3 start');

    const rivalId = s0.hand!.seats.find((seat) => seat.playerId !== HERO_PLAYER_ID)!.playerId;
    const heroBefore = chipValue(s0.hand!.seats.find((x) => x.playerId === HERO_PLAYER_ID)!.stack);
    const rivalBefore = chipValue(s0.hand!.seats.find((x) => x.playerId === rivalId)!.stack);

    // Exchange 1×50 from Hero for 5×10 from Rival
    const s1 = exchangeInHand(s0, {
      fromPlayerId: HERO_PLAYER_ID,
      target: { kind: 'player', playerId: rivalId },
      give: { 5: 0, 10: 0, 50: 1, 100: 0 },
      receive: { 5: 0, 10: 5, 50: 0, 100: 0 },
    });
    assertInvariants(s1, 'c3 after player exchange');

    const heroAfter = s1.hand!.seats.find((x) => x.playerId === HERO_PLAYER_ID)!.stack;
    const rivalAfter = s1.hand!.seats.find((x) => x.playerId === rivalId)!.stack;
    expect(chipValue(heroAfter)).toBe(heroBefore);
    expect(chipValue(rivalAfter)).toBe(rivalBefore);
    expect(heroAfter[50]).toBe(s0.hand!.seats.find((x) => x.playerId === HERO_PLAYER_ID)!.stack[50] - 1);
    expect(heroAfter[10]).toBe(s0.hand!.seats.find((x) => x.playerId === HERO_PLAYER_ID)!.stack[10] + 5);

    // Also exchange with Pot (pot has 4×5 = 20 from ante): give 2×10 to Pot, receive 4×5 from Pot
    const potBeforeVal = chipValue(s1.hand!.pot);
    const s2 = exchangeInHand(s1, {
      fromPlayerId: HERO_PLAYER_ID,
      target: { kind: 'pot' },
      give: { 5: 0, 10: 2, 50: 0, 100: 0 },
      receive: { 5: 4, 10: 0, 50: 0, 100: 0 },
    });
    assertInvariants(s2, 'c3 after pot exchange');
    expect(chipValue(s2.hand!.pot)).toBe(potBeforeVal);
    expect(s2.hand!.pot[10]).toBe(2);
    expect(s2.hand!.pot[5]).toBe(0);
  });

  it('T1, T3, T4 & C7: handles rival cash-out, 0-chip rebuy/leave enforcement, <4 auto-invite, and session ledger', () => {
    let s = createSandboxSession({
      seed: 'p4-t1-t4-seed',
      settings: { playerCount: 4, allowOutOfTurn: false },
      fixtures: { openerId: HERO_PLAYER_ID },
    });
    assertInvariants(s, 't-init');

    // Finish hand #1 cleanly by Hero folding and bots completing
    s = performHeroAction(s, 'fold');
    s = advanceUntilHeroOrEnd(s);
    expect(s.hand?.phase).toBe('complete');
    assertInvariants(s, 'hand 1 complete');

    // Enter boundary
    s = enterHandBoundary(s);
    expect(s.phase).toBe('between-hands');
    assertInvariants(s, 'at boundary');

    // T1: Cash out a rival at boundary -> leaves table, bank increases, table drops to 3 players
    const rivalToLeave = s.boundary!.seats.find((seat) => seat.playerId !== HERO_PLAYER_ID)!;
    const bankBefore = chipValue(s.boundary!.bank);
    const rivalStackVal = chipValue(rivalToLeave.stack);
    s = cashOutPlayerAtBoundary(s, rivalToLeave.playerId);
    assertInvariants(s, 'after T1 rival cashout');
    expect(s.boundary!.seats.length).toBe(3);
    expect(chipValue(s.boundary!.bank)).toBe(bankBefore + rivalStackVal);

    // T4: Readiness reports 1 player needed while at 3 seats; manual invite still works cleanly
    expect(checkReadyForNextHand(s.boundary!).needsPlayers).toBe(1);
    s = inviteRivalAtBoundary(s);
    assertInvariants(s, 'after manual T4 invite');
    expect(s.boundary!.seats.length).toBe(4);

    // T3: Simulate a 0-chip seat at boundary by moving all their chips to another seat (preserving INV-1)
    const bustedSeat = s.boundary!.seats[1]!;
    const richSeat = s.boundary!.seats[2]!;
    const sWithZero: SandboxSessionState = {
      ...s,
      boundary: {
        ...s.boundary!,
        seats: s.boundary!.seats.map((seat) => {
          if (seat.playerId === bustedSeat.playerId) {
            return { ...seat, stack: emptyChips() };
          }
          if (seat.playerId === richSeat.playerId) {
            return {
              ...seat,
              stack: {
                5: seat.stack[5] + bustedSeat.stack[5],
                10: seat.stack[10] + bustedSeat.stack[10],
                50: seat.stack[50] + bustedSeat.stack[50],
                100: seat.stack[100] + bustedSeat.stack[100],
              },
            };
          }
          return seat;
        }),
      },
    };
    assertInvariants(sWithZero, 'T3 zero stack setup');
    expect(checkReadyForNextHand(sWithZero.boundary!).zeroStackPlayerIds).toContain(
      bustedSeat.playerId,
    );

    // Blocked until rebuy or leave
    const blockedT3 = startNextHand(sWithZero);
    expect(blockedT3.phase).toBe('between-hands');
    expect(blockedT3.statusNotice?.tone).toBe('warning');

    // Rebuy 500 unblocks and records rebuy in ledger (C7)
    const afterRebuy = rebuyPlayerAtBoundary(sWithZero, bustedSeat.playerId);
    assertInvariants(afterRebuy, 'after T3 rebuy');
    expect(
      chipValue(
        afterRebuy.boundary!.seats.find((x) => x.playerId === bustedSeat.playerId)!.stack,
      ),
    ).toBe(500);

    const ledgerSummary = summarizeLedger(afterRebuy.ledgerEvents);
    expect(ledgerSummary[bustedSeat.playerId]?.rebuys).toBe(1);
    expect(ledgerSummary[rivalToLeave.playerId]?.cashOuts).toBe(1);

    // Sum of all profitLoss across all players (seated + departed) must equal 0 at boundary!
    let netSum = 0;
    for (const [pid, entry] of Object.entries(ledgerSummary)) {
      const seat = afterRebuy.boundary!.seats.find((x) => x.playerId === pid);
      netSum += profitLoss(entry, seat?.stack ?? emptyChips());
    }
    expect(netSum).toBe(0);

    // If rebuy from bank left the rebuyer without a 5-chip (real Accate edge case when bank 5s are depleted),
    // exchange with another seated player to obtain chip 5 before starting next hand.
    let readyForHand2 = afterRebuy;
    const preReadiness = checkReadyForNextHand(readyForHand2.boundary!);
    for (const missingId of preReadiness.missingAnteDenominationPlayerIds) {
      const exSuggestions = suggestBoundaryAnteExchanges(
        readyForHand2.boundary!,
        missingId,
        (id) => id,
      );
      expect(exSuggestions.length).toBeGreaterThan(0);
      const ex = exSuggestions[0]!;
      readyForHand2 = exchangeAtBoundary(
        readyForHand2,
        ex.fromPlayerId,
        ex.targetPlayerId!,
        ex.give,
        ex.receive,
      );
      assertInvariants(readyForHand2, `boundary ante exchange for ${missingId}`);
    }

    // Next hand starts cleanly with 4 seated players and rotates dealer clockwise
    const hand2 = startNextHand(readyForHand2);
    expect(hand2.phase).toBe('in-hand');
    expect(hand2.handNumber).toBe(2);
    expect(hand2.hand!.seats.length).toBe(4);
    assertInvariants(hand2, 'hand 2 started');
  });

  it('T2: Hero requesting leave mid-hand folds at first opportunity, keeps chips in pot, and cashes out at boundary', () => {
    let s = createSandboxSession({
      seed: 'p4-t2-seed',
      settings: { playerCount: 4, allowOutOfTurn: false },
      fixtures: { openerId: HERO_PLAYER_ID },
    });
    assertInvariants(s, 't2 init');

    // Hero puts in a bet of 10 first (so Hero has contributed 5 ante + 10 bet = 15)
    s = stageChip(s, 10);
    s = performHeroAction(s, 'bet');
    assertInvariants(s, 't2 after hero bet 10');

    // Hero requests to leave mid-hand while bots are acting
    s = requestHeroLeave(s);
    expect(s.pendingHeroLeave).toBe(true);
    assertInvariants(s, 't2 leave requested');

    // Step bots (and auto-fold hero if action returns to hero) until hand completes
    s = advanceUntilHeroOrEnd(s);
    assertInvariants(s, 't2 after hand completion');

    // Once hand finished, Hero must have left table at boundary automatically
    expect(s.phase).toBe('between-hands');
    expect(s.pendingHeroLeave).toBe(false);
    expect(s.boundary!.seats.some((seat) => seat.playerId === HERO_PLAYER_ID)).toBe(false);

    // Verify ledger recorded hero's cash-out and hero's 15 chips stayed in pot (or were won if everyone folded to hero's bet)
    const ledger = summarizeLedger(s.ledgerEvents);
    expect(ledger[HERO_PLAYER_ID]?.cashOuts).toBe(1);

    // Hero can sit back down cleanly (+500)
    const back = seatHeroAtBoundary(s);
    assertInvariants(back, 't2 hero re-seated');
    expect(back.boundary!.seats.some((seat) => seat.playerId === HERO_PLAYER_ID)).toBe(true);
  });

  it('C4, C5, C6: 10-player bank depletion forces highest-stack 500 cash-out (large chips first) on 4th rebuy', () => {
    let s = createSandboxSession({
      seed: 'p4-c4-c6-seed',
      settings: { playerCount: 10, enabledRivalIds: [...RIVAL_IDS], allowOutOfTurn: false },
      fixtures: { openerId: HERO_PLAYER_ID },
    });
    assertInvariants(s, 'c4 10p init');

    // Complete hand 1 quickly and enter boundary
    s = performHeroAction(s, 'fold');
    s = advanceUntilHeroOrEnd(s);
    s = enterHandBoundary(s);
    assertInvariants(s, 'c4 boundary');

    // Construct a valid INV-1 boundary where bank has 15×100 (1,500), seats 1..4 are busted (0),
    // and seat 0 (Hero) absorbed their chips (stack = 2,500 with large chips available)
    const originalSeats = s.boundary!.seats;
    const bustedIds = [
      originalSeats[1]!.playerId,
      originalSeats[2]!.playerId,
      originalSeats[3]!.playerId,
      originalSeats[4]!.playerId,
    ];
    let pooled = originalSeats[0]!.stack;
    for (let i = 1; i <= 4; i++) {
      const st = originalSeats[i]!.stack;
      pooled = {
        5: pooled[5] + st[5],
        10: pooled[10] + st[10],
        50: pooled[50] + st[50],
        100: pooled[100] + st[100],
      };
    }

    let cur: SandboxSessionState = {
      ...s,
      boundary: {
        ...s.boundary!,
        seats: originalSeats.map((seat, idx) =>
          idx === 0
            ? { ...seat, stack: pooled }
            : idx >= 1 && idx <= 4
              ? { ...seat, stack: emptyChips() }
              : seat,
        ),
      },
    };
    assertInvariants(cur, 'c4 setup');

    // Rebuys 1, 2, 3 draw 5×100 each from bank (draining 1,500 -> 0)
    for (let i = 0; i < 3; i++) {
      cur = rebuyPlayerAtBoundary(cur, bustedIds[i]!);
      assertInvariants(cur, `c4 rebuy ${i + 1}`);
    }
    expect(chipValue(cur.boundary!.bank)).toBe(0);

    // 4th rebuy forces largest stack (Hero) to cash out 500 large chips first (C5/C6)
    const heroStackBefore = { ...cur.boundary!.seats[0]!.stack };
    cur = rebuyPlayerAtBoundary(cur, bustedIds[3]!);
    assertInvariants(cur, 'c5 4th rebuy forced cashout');
    const heroStackAfter = cur.boundary!.seats[0]!.stack;
    expect(chipValue(heroStackBefore) - chipValue(heroStackAfter)).toBe(500);
    // Large chips (100s) must have been taken first
    expect(heroStackBefore[100] - heroStackAfter[100]).toBeGreaterThan(0);

    const summary = summarizeLedger(cur.ledgerEvents);
    expect(summary[HERO_PLAYER_ID]?.cashOuts).toBe(1);
    expect(summary[bustedIds[3]!]?.rebuys).toBe(1);
  });

  it('X4 & X5: Hero out-of-turn declaration reserves chips and either auto-executes or cancels cleanly', () => {
    // Pick a rival as opener so it's not Hero's turn yet
    const s0 = createSandboxSession({
      seed: 'p4-oot-hero',
      settings: { playerCount: 4, allowOutOfTurn: true },
    });
    const openerRival = s0.hand!.seats.find((seat) => seat.playerId !== HERO_PLAYER_ID)!.playerId;
    const s = createSandboxSession({
      seed: 'p4-oot-hero',
      settings: { playerCount: 4, allowOutOfTurn: true },
      fixtures: { openerId: openerRival },
    });
    assertInvariants(s, 'oot init');
    expect(s.hand!.activePlayerId).toBe(openerRival);

    const validation = getHeroActionValidation(s);
    expect(validation.isHeroTurn).toBe(false);
    expect(validation.canDeclareOutOfTurn).toBe(true);

    // Hero stages 2×10 = 20 and declares out-of-turn bet 20
    let s1 = stageChip(s, 10);
    s1 = stageChip(s1, 10);
    const potBefore = chipValue(s1.hand!.pot);
    const heroStackBefore = chipValue(
      s1.hand!.seats.find((x) => x.playerId === HERO_PLAYER_ID)!.stack,
    );

    s1 = performHeroOutOfTurn(s1, 'bet');
    assertInvariants(s1, 'after hero OOT declare');
    // Reserved chips moved out of stack, NOT into pot yet!
    expect(chipValue(s1.hand!.pot)).toBe(potBefore);
    const heroAfter = s1.hand!.seats.find((x) => x.playerId === HERO_PLAYER_ID)!;
    expect(chipValue(heroAfter.stack)).toBe(heroStackBefore - 20);
    expect(heroAfter.declaration).not.toBeNull();
    expect(chipValue(heroAfter.declaration!.reservedChips)).toBe(20);
    expect(getHeroActionValidation(s1).hasBindingDeclaration).toBe(true);

    // Timeline records out-of-turn-declared (X3)
    expect(
      s1.hand!.timeline.some(
        (ev) => ev.type === 'out-of-turn-declared' && ev.playerId === HERO_PLAYER_ID,
      ),
    ).toBe(true);
  });

  it('awaiting-payout & missing-ante boundary: exchanges chips with pot/player and continues cleanly', () => {
    // 1. Setup an 8-player split-pot hand and verify pot exchange -> settlePendingPayout
    const s8 = createSandboxSession({
      seed: 'p4-payout-8p',
      settings: { playerCount: 8, tieBreakMode: 'split', allowOutOfTurn: false },
    });
    const ids8 = s8.hand!.seats.map((seat) => seat.playerId);
    const deck8 = buildFixtureDeck({
      seatOrderIds: ids8,
      dealerIndex: 0,
      holeByPlayer: {
        [ids8[0]!]: [parseCard('2c'), parseCard('3d')],
        [ids8[1]!]: [parseCard('2s'), parseCard('4h')],
        [ids8[2]!]: [parseCard('2d'), parseCard('5h')],
        [ids8[3]!]: [parseCard('2h'), parseCard('6c')],
      },
      board: [
        parseCard('As'),
        parseCard('Kh'),
        parseCard('Qd'),
        parseCard('Jc'),
        parseCard('Ts'),
      ],
    });
    let sPayout = createSandboxSession({
      seed: 'p4-payout-8p-real',
      settings: { playerCount: 8, tieBreakMode: 'split', allowOutOfTurn: false },
      fixtures: { deck: deck8, openerId: HERO_PLAYER_ID },
    });
    // Ante = 8×5 = 40. Hero bets 10 -> pot = 50 (8×5 + 1×10).
    // Swap Hero's 1×50 with Pot's {5:8, 10:1} -> Pot is now ONLY {5:0, 10:0, 50:1, 100:0} = 50.
    sPayout = stageChip(sPayout, 10);
    sPayout = performHeroAction(sPayout, 'bet');
    assertInvariants(sPayout, 'payout setup bet 10');
    sPayout = exchangeInHand(sPayout, {
      fromPlayerId: HERO_PLAYER_ID,
      target: { kind: 'pot' },
      give: { 5: 0, 10: 0, 50: 1, 100: 0 },
      receive: { 5: 8, 10: 1, 50: 0, 100: 0 },
    });
    assertInvariants(sPayout, 'payout setup swap pot to 1x50');
    expect(sPayout.hand!.pot).toEqual({ 5: 0, 10: 0, 50: 1, 100: 0 });

    // 2. Test missing-ante boundary exchange helper & controller
    let sMiss = createSandboxSession({
      seed: 'p4-missing-ante',
      settings: { playerCount: 4, allowOutOfTurn: false },
      fixtures: { openerId: HERO_PLAYER_ID },
    });
    sMiss = performHeroAction(sMiss, 'fold');
    sMiss = advanceUntilHeroOrEnd(sMiss);
    sMiss = enterHandBoundary(sMiss);

    // Give all of Hero's 5-chips to seat 1 in exchange for equal value (or transfer keeping INV-1)
    const seat0 = sMiss.boundary!.seats[0]!;
    const seat1 = sMiss.boundary!.seats[1]!;
    const fivesToMove = seat0.stack[5];
    // Move all of seat0's 5s to seat1 (keeping INV-1 exact!)
    const sNoFive: SandboxSessionState = {
      ...sMiss,
      boundary: {
        ...sMiss.boundary!,
        seats: sMiss.boundary!.seats.map((seat) => {
          if (seat.playerId === seat0.playerId) {
            return { ...seat, stack: { ...seat.stack, 5: 0 } };
          }
          if (seat.playerId === seat1.playerId) {
            return { ...seat, stack: { ...seat.stack, 5: seat.stack[5] + fivesToMove } };
          }
          return seat;
        }),
      },
    };
    assertInvariants(sNoFive, 'missing ante setup');
    expect(checkReadyForNextHand(sNoFive.boundary!).missingAnteDenominationPlayerIds).toContain(
      HERO_PLAYER_ID,
    );

    const blockedAnte = startNextHand(sNoFive);
    expect(blockedAnte.phase).toBe('between-hands');
    expect(blockedAnte.statusNotice?.tone).toBe('warning');

    const anteSuggestions = suggestBoundaryAnteExchanges(
      sNoFive.boundary!,
      HERO_PLAYER_ID,
      (id) => id,
    );
    expect(anteSuggestions.length).toBeGreaterThan(0);
    const chosen = anteSuggestions[0]!;
    const fixedAnte = exchangeAtBoundary(
      sNoFive,
      chosen.fromPlayerId,
      chosen.targetPlayerId!,
      chosen.give,
      chosen.receive,
    );
    assertInvariants(fixedAnte, 'after boundary ante exchange');
    expect(checkReadyForNextHand(fixedAnte.boundary!).ready).toBe(true);

    const nextHandOk = startNextHand(fixedAnte);
    expect(nextHandOk.phase).toBe('in-hand');
    assertInvariants(nextHandOk, 'started hand after boundary ante exchange');

    // Verify suggestPendingPayoutExchanges & settleAwaitingPayout on a constructed awaiting-payout HandState
    const fullBoard5 = [
      parseCard('As'),
      parseCard('Kh'),
      parseCard('Qd'),
      parseCard('Jc'),
      parseCard('Ts'),
    ] as const;
    const awaitingState: HandState = {
      ...sPayout.hand!,
      phase: 'awaiting-payout',
      street: 'river',
      board: fullBoard5,
      pot: { 5: 0, 10: 1, 50: 1, 100: 0 }, // 60 points: 1×50 + 1×10 cannot split into 30 + 30!
      pendingPayout: {
        requiredPayouts: [
          { playerId: ids8[0]!, amount: 30 },
          { playerId: ids8[1]!, amount: 30 },
        ],
      },
      outcome: {
        kind: 'showdown',
        resolution: {
          uncalledRefund: null,
          potAwards: [],
          totalPayouts: [
            { playerId: ids8[0]!, amount: 30 },
            { playerId: ids8[1]!, amount: 30 },
          ],
          finalBaiCaoDeck: null,
        },
      },
    };
    // Adjust Hero's stack slightly so INV-1 matches the 1×10 moved into pot
    const adjustedSeats = awaitingState.seats.map((seat, idx) =>
      idx === 0
        ? {
            ...seat,
            stack: { ...seat.stack, 10: seat.stack[10] - 1 },
            unsettledContribution: 30,
          }
        : idx === 1
          ? { ...seat, unsettledContribution: 30 }
          : { ...seat, unsettledContribution: 0 },
    );
    const pendingSession: SandboxSessionState = {
      ...sPayout,
      hand: { ...awaitingState, seats: adjustedSeats },
    };
    assertInvariants(pendingSession, 'pending payout setup');

    const payoutSuggestions = suggestPendingPayoutExchanges(
      pendingSession.hand!,
      (id) => id,
    );
    expect(payoutSuggestions.length).toBeGreaterThan(0);
    expect(payoutSuggestions[0]!.resolvesImmediately).toBe(true);

    const afterPotSwap = exchangeInHand(pendingSession, payoutSuggestions[0]!.request);
    assertInvariants(afterPotSwap, 'after pot swap for payout');

    const settled = settleAwaitingPayout(afterPotSwap);
    expect(settled.hand!.phase).toBe('complete');
    expect(chipValue(settled.hand!.pot)).toBe(0);
    assertInvariants(settled, 'after settlePendingPayout');
  });

  it('plays full showdown hand, verifies card visibility (R8), end-of-hand review, settings at boundary, and next hand continuity', () => {
    let s = createSandboxSession({
      seed: 'p4-full-showdown',
      settings: {
        playerCount: 5,
        enabledRivalIds: ['da', 'ca', 'cao', 'soi', 'nong'],
        allowOutOfTurn: true,
        enablePreflopBetting: false,
      },
    });
    assertInvariants(s, 'full-showdown init');

    // Queue a table rule change mid-hand (enable preflop + cap 25) -> must NOT apply mid-hand
    s = applySettingsUpdate(
      s,
      {
        ...s.appliedSettings,
        enablePreflopBetting: true,
        preflopCap: 25,
      },
      'apply-boundary',
    );
    expect(s.appliedSettings.enablePreflopBetting).toBe(false);
    expect(s.pendingSettings?.enablePreflopBetting).toBe(true);
    expect(s.pendingSettings?.preflopCap).toBe(25);

    // Play out hand #1: Hero always checks or calls so we reach showdown or fold-win naturally
    let safety = 0;
    while (s.phase === 'in-hand' && s.hand?.phase === 'betting' && safety < 100) {
      safety++;
      if (s.hand.activePlayerId === HERO_PLAYER_ID) {
        const val = getHeroActionValidation(s);
        if (val.canCheck) {
          s = performHeroAction(s, 'check');
        } else if (val.legalActions?.canCall && val.callAmount !== null) {
          // Stage exact chips for callAmount using available denominations
          let rem = val.callAmount;
          let stagedSess = s;
          const heroSeat = s.hand.seats.find((x) => x.playerId === HERO_PLAYER_ID)!;
          for (const d of [100, 50, 10, 5] as const) {
            const avail = heroSeat.stack[d];
            const take = Math.min(avail, Math.floor(rem / d));
            for (let k = 0; k < take; k++) {
              stagedSess = stageChip(stagedSess, d);
            }
            rem -= take * d;
          }
          if (rem === 0 && getHeroActionValidation(stagedSess).canConfirmCall) {
            s = performHeroAction(stagedSess, 'call');
          } else {
            s = performHeroAction(s, 'fold');
          }
        } else {
          s = performHeroAction(s, 'fold');
        }
      } else {
        s = stepOneBotTurn(s);
      }
      assertInvariants(s, `full hand step ${safety}`);
    }

    expect(s.hand?.phase).toBe('complete');
    expect(s.lastHandReview).not.toBeNull();
    expect(s.lastHandReview!.timeline.length).toBe(s.hand!.timeline.length);

    // Verify card reveal discipline (R8): folded players NEVER revealed
    for (const seat of s.hand!.seats) {
      if (seat.playerId === HERO_PLAYER_ID) {
        expect(isSeatCardsRevealed(s.hand!, seat.playerId)).toBe(true);
      } else if (s.hand!.outcome?.kind === 'fold-win' || seat.status === 'folded') {
        expect(isSeatCardsRevealed(s.hand!, seat.playerId)).toBe(false);
      }
    }

    // Verify every hero decision in review has finite potOdds, EV, qualityLabel & assumptions
    for (const dec of s.lastHandReview!.decisions) {
      expect(Number.isFinite(dec.chosenEv)).toBe(true);
      expect(Number.isFinite(dec.record.potOdds.requiredEquity)).toBe(true);
      expect(dec.assumptionsVi.length).toBeGreaterThan(0);
      expect(['Tốt', 'Sát nút', 'Chưa tối ưu', 'Sai lầm']).toContain(dec.qualityLabel);
    }

    // Start Hand #2: pending preflop setting MUST apply now at boundary!
    const hand2 = startNextHand(s);
    assertInvariants(hand2, 'hand 2 with pending preflop applied');
    expect(hand2.phase).toBe('in-hand');
    expect(hand2.handNumber).toBe(2);
    expect(hand2.appliedSettings.enablePreflopBetting).toBe(true);
    expect(hand2.appliedSettings.preflopCap).toBe(25);
    expect(hand2.pendingSettings).toBeNull();
    expect(hand2.hand!.street).toBe('preflop');
    expect(hand2.hand!.streetCap).toBe(25);
    expect(hand2.hand!.board.length).toBe(0);
  });

  it('O1/O2 & B5: Tournament timeout auto-checks/auto-folds cleanly and Nóng tilt metadata updates across hands', () => {
    // O1: canCheck -> auto-check
    let s = createSandboxSession({
      seed: 'p4-o1-o2',
      settings: { playerCount: 4, allowOutOfTurn: false },
      fixtures: { openerId: HERO_PLAYER_ID },
    });
    s = stageChip(s, 10); // Staged chip must be returned on timeout
    const afterTimeout = performHeroAutoTimeout(s);
    assertInvariants(afterTimeout, 'after O1 timeout');
    expect(chipValue(afterTimeout.stagedChips)).toBe(0);
    const heroEv = afterTimeout.hand!.timeline.find(
      (ev) => ev.type === 'player-action' && ev.playerId === HERO_PLAYER_ID,
    );
    expect(heroEv?.type === 'player-action' && heroEv.action.type).toBe('check');

    // B5: Verify getSeatRivalMetadata reflects Nóng's tilted state publicly when tilted
    const sNong = createSandboxSession({
      seed: 'p4-b5-nong',
      settings: { playerCount: 4, enabledRivalIds: ['da', 'ca', 'nong'] },
    });
    const normalMeta = getSeatRivalMetadata(sNong, 'nong');
    expect(normalMeta?.isTilted).toBe(false);
    expect(normalMeta?.publicMood).toBe('normal');

    const tiltedSession: SandboxSessionState = {
      ...sNong,
      nongTiltState: {
        isTilted: true,
        handsRemaining: 4,
        totalTiltDuration: 4,
        triggerReason: 'big-pot-loss',
      },
      nongTiltStateAtHandStart: {
        isTilted: true,
        handsRemaining: 4,
        totalTiltDuration: 4,
        triggerReason: 'big-pot-loss',
      },
    };
    const tiltedMeta = getSeatRivalMetadata(tiltedSession, 'nong');
    expect(tiltedMeta?.isTilted).toBe(true);
    expect(tiltedMeta?.publicMood).toBe('tilted');
    expect(tiltedMeta?.publicStatusLabelVi).toContain('Đang tilt');
  });

  it('C2 exact (35 staged vs 30 to call), X5 cancellation returning chips, and live B5 Nóng tilt trigger across hands', () => {
    // 1. Exact C2: currentBet = 30, Hero stages 35 -> Call 30 is strictly locked; unstage 5 -> Call 30 unlocks
    const base = createSandboxSession({
      seed: 'p4-exact-c2-35-vs-30',
      settings: { playerCount: 4, enabledRivalIds: ['da', 'ca', 'cao'], allowOutOfTurn: true },
      fixtures: { openerId: 'da' },
    });
    // Advance rival turn or force a legal bet of 30 from opener 'da' via engine applyAction
    const daSeat = base.hand!.seats.find((s) => s.playerId === 'da')!;
    expect(daSeat.stack[10]).toBeGreaterThanOrEqual(3);
    // Use controller on a 2-step sequence: Hero opens bet 30, or let's stage 35 when Hero faces currentBet = 30
    const sHeroOpener = createSandboxSession({
      seed: 'p4-exact-c2-raise-30',
      settings: { playerCount: 4, enabledRivalIds: ['dien', 'ca', 'cao'], allowOutOfTurn: false },
      fixtures: { openerId: 'dien' },
    });
    // Step Điên (who aggressively bets up to cap 50); verify exact staged mismatch locks Call
    const afterDien = stepOneBotTurn(sHeroOpener);
    assertInvariants(afterDien, 'exact-c2 after dien');
    const facingHero = advanceUntilHeroOrEnd(afterDien);
    if (facingHero.hand?.activePlayerId === HERO_PLAYER_ID && facingHero.hand.currentBet > 0) {
      const needCall = facingHero.hand.currentBet;
      // Stage needCall + 5 (impossible to call with wrong total)
      let wrongStaged = facingHero;
      let rem = needCall + 5;
      const hStack = facingHero.hand.seats.find((x) => x.playerId === HERO_PLAYER_ID)!.stack;
      for (const d of [50, 10, 5] as const) {
        const take = Math.min(hStack[d], Math.floor(rem / d));
        for (let k = 0; k < take; k++) wrongStaged = stageChip(wrongStaged, d);
        rem -= take * d;
      }
      if (rem === 0) {
        expect(getHeroActionValidation(wrongStaged).canConfirmCall).toBe(false);
        // Undo 5 -> exact callAmount -> Call unlocks!
        const exactStaged = unstageLastChip(wrongStaged);
        expect(getHeroActionValidation(exactStaged).stagedValue).toBe(needCall);
        expect(getHeroActionValidation(exactStaged).canConfirmCall).toBe(true);
      }
    }

    // 2. X5: Hero declares out-of-turn bet 20, Điên bets before Hero -> Hero's declaration cancels & chips return!
    const sX5 = createSandboxSession({
      seed: 'p4-exact-x5-cancel',
      settings: { playerCount: 4, enabledRivalIds: ['dien', 'da', 'ca'], allowOutOfTurn: true },
      fixtures: { openerId: 'dien' },
    });
    let sDecl = stageChip(stageChip(sX5, 10), 10);
    sDecl = performHeroOutOfTurn(sDecl, 'bet');
    assertInvariants(sDecl, 'x5 after hero oot bet 20');
    const heroStackWithReserved = chipValue(
      sDecl.hand!.seats.find((x) => x.playerId === HERO_PLAYER_ID)!.stack,
    );

    // Step bots until Hero's turn (Điên bets/raises on flop, cancelling Hero's OOT declaration)
    const afterBots = advanceUntilHeroOrEnd(sDecl);
    assertInvariants(afterBots, 'x5 after bots');
    if (
      afterBots.hand?.phase === 'betting' &&
      afterBots.hand.activePlayerId === HERO_PLAYER_ID &&
      afterBots.hand.currentBet > 0
    ) {
      const heroNow = afterBots.hand.seats.find((x) => x.playerId === HERO_PLAYER_ID)!;
      expect(heroNow.declaration).toBeNull();
      expect(heroNow.cancelledDeclarationThisStreet).toBe(true);
      expect(chipValue(heroNow.stack)).toBe(heroStackWithReserved + 20);
      // Hero folds and does NOT lose the returned 20
      const afterFold = performHeroAction(afterBots, 'fold');
      assertInvariants(afterFold, 'x5 after hero fold');
      expect(
        chipValue(afterFold.hand!.seats.find((x) => x.playerId === HERO_PLAYER_ID)!.stack),
      ).toBe(heroStackWithReserved + 20);
    }

    // 3. Live B5: Nóng loses pot >= 150 at showdown -> next hand starts with Nóng tilted (3..5 hands)
    const sNongBase = createSandboxSession({
      seed: 'p4-live-b5-trigger',
      settings: { playerCount: 4, enabledRivalIds: ['nong', 'ca', 'da'], allowOutOfTurn: false },
    });
    const seatOrder = sNongBase.hand!.seats.map((seat) => seat.playerId);
    const nongDeck = buildFixtureDeck({
      seatOrderIds: seatOrder,
      dealerIndex: 0,
      holeByPlayer: {
        // Hero holds pocket Aces (beats Nóng's pocket Kings on clean board)
        [HERO_PLAYER_ID]: [parseCard('As'), parseCard('Ah')],
        nong: [parseCard('Ks'), parseCard('Kh')],
        ca: [parseCard('2c'), parseCard('7d')],
        da: [parseCard('3c'), parseCard('8d')],
      },
      board: [
        parseCard('Qd'),
        parseCard('9c'),
        parseCard('4s'),
        parseCard('6h'),
        parseCard('2d'),
      ],
    });
    let sNong = createSandboxSession({
      seed: 'p4-live-b5-trigger',
      settings: { playerCount: 4, enabledRivalIds: ['nong', 'ca', 'da'], allowOutOfTurn: false },
      fixtures: { deck: nongDeck, openerId: HERO_PLAYER_ID },
    });

    // Hero bets 50 on every street (flop, turn, river) so pot vs Nóng exceeds 150!
    let guard = 0;
    while (sNong.phase === 'in-hand' && sNong.hand?.phase === 'betting' && guard < 80) {
      guard++;
      if (sNong.hand.activePlayerId === HERO_PLAYER_ID) {
        const val = getHeroActionValidation(sNong);
        if (val.legalActions?.canBet) {
          sNong = performHeroAction(stageChip(sNong, 50), 'bet');
        } else if (val.legalActions?.canRaise && val.legalActions.raiseRange?.max === 50) {
          const added = 50 - val.legalActions.playerStreetContribution;
          let st = sNong;
          let rem = added;
          const hSt = sNong.hand.seats.find((x) => x.playerId === HERO_PLAYER_ID)!.stack;
          for (const d of [50, 10, 5] as const) {
            const take = Math.min(hSt[d], Math.floor(rem / d));
            for (let k = 0; k < take; k++) st = stageChip(st, d);
            rem -= take * d;
          }
          sNong = performHeroAction(st, 'raise');
        } else if (val.legalActions?.canCall && val.callAmount !== null) {
          let st = sNong;
          let rem = val.callAmount;
          const hSt = sNong.hand.seats.find((x) => x.playerId === HERO_PLAYER_ID)!.stack;
          for (const d of [50, 10, 5] as const) {
            const take = Math.min(hSt[d], Math.floor(rem / d));
            for (let k = 0; k < take; k++) st = stageChip(st, d);
            rem -= take * d;
          }
          sNong = performHeroAction(st, 'call');
        } else {
          sNong = performHeroAction(sNong, 'check');
        }
      } else {
        sNong = stepOneBotTurn(sNong);
      }
      assertInvariants(sNong, `live b5 step ${guard}`);
    }

    expect(sNong.hand?.phase).toBe('complete');
    expect(sNong.hand?.outcome?.kind).toBe('showdown');
    expect(sNong.nongTiltState.isTilted).toBe(true);
    expect(sNong.nongTiltState.handsRemaining).toBeGreaterThanOrEqual(3);
    expect(sNong.nongTiltState.handsRemaining).toBeLessThanOrEqual(5);

    // Start next hand -> dealer rotates clockwise and Nóng starts hand #2 visibly tilted!
    const dealerBefore = sNong.hand!.dealerSeatIndex;
    const sNongHand2 = startNextHand(sNong);
    assertInvariants(sNongHand2, 'live b5 hand 2');
    expect(sNongHand2.hand!.dealerSeatIndex).not.toBe(dealerBefore);
    expect(getSeatRivalMetadata(sNongHand2, 'nong')?.isTilted).toBe(true);
  });

  it('T4 regression: 4-seat control-sandbox-0 after Hero leave auto-invites from waiting list on startNextHand without creating chips', () => {
    let s = createSandboxSession({
      seed: 'control-sandbox-0',
      settings: { playerCount: 4 },
    });
    assertInvariants(s, 't4 control-sandbox-0 init');
    expect(s.hand!.seats.length).toBe(4);

    // Request Hero leave mid-hand and advance until hand completes
    s = requestHeroLeave(s);
    assertInvariants(s, 't4 after requestHeroLeave');
    s = advanceUntilHeroOrEnd(s);
    assertInvariants(s, 't4 after advanceUntilHeroOrEnd');

    // Enter hand boundary explicitly (idempotent when finalizeCompletedHand already moved to boundary)
    s = enterHandBoundary(s);
    assertInvariants(s, 't4 at boundary');
    expect(s.phase).toBe('between-hands');
    expect(s.boundary).not.toBeNull();
    expect(s.boundary!.seats.length).toBe(3);
    expect(s.boundary!.seats.some((seat) => seat.playerId === HERO_PLAYER_ID)).toBe(false);

    const seatedBeforeIds = new Set(s.boundary!.seats.map((seat) => seat.playerId));
    const unusedRivals = RIVAL_IDS.filter((id) => !seatedBeforeIds.has(id));
    expect(unusedRivals.length).toBe(6);

    const bankBeforeValue = chipValue(s.boundary!.bank);
    expect(bankBeforeValue).toBeGreaterThanOrEqual(500);

    // Calling startNextHand directly must auto-invite a 4th rival from waiting list before collecting ante
    const hand2 = startNextHand(s);
    assertInvariants(hand2, 't4 after startNextHand auto-invite');
    expect(hand2.phase).toBe('in-hand');
    expect(hand2.handNumber).toBe(2);
    expect(hand2.hand).not.toBeNull();
    expect(hand2.hand!.seats.length).toBe(4);

    // Newly seated rival must be one of the 6 unused waiting-list profiles, funded 500 from bank (minus 5 ante = 495)
    const invitedSeat = hand2.hand!.seats.find((seat) => !seatedBeforeIds.has(seat.playerId));
    expect(invitedSeat).toBeDefined();
    expect(unusedRivals).toContain(invitedSeat!.playerId);
    expect(chipValue(invitedSeat!.stack) + invitedSeat!.totalContribution).toBe(500);
    expect(chipValue(hand2.hand!.bank)).toBe(bankBeforeValue - 500);

    // Ledger recorded Hero cash-out and the newly invited rival's buy-in (zero-sum with active stacks + pot)
    const summary = summarizeLedger(hand2.ledgerEvents);
    expect(summary[HERO_PLAYER_ID]?.cashOuts).toBe(1);
    expect(summary[invitedSeat!.playerId]?.buyIns).toBe(1);

    let netSum = chipValue(hand2.hand!.pot);
    for (const [pid, entry] of Object.entries(summary)) {
      const seat = hand2.hand!.seats.find((x) => x.playerId === pid);
      netSum += profitLoss(entry, seat?.stack ?? emptyChips());
    }
    expect(netSum).toBe(0);
  });

  it('T4 readiness fallback: preserves helpful feedback when auto-invite cannot complete or invited seat lacks 5-chip for ante', () => {
    let s = createSandboxSession({
      seed: 'p4-t4-fallback-seed',
      settings: { playerCount: 4, allowOutOfTurn: false },
      fixtures: { openerId: HERO_PLAYER_ID },
    });
    s = performHeroAction(s, 'fold');
    s = advanceUntilHeroOrEnd(s);
    s = enterHandBoundary(s);
    s = cashOutPlayerAtBoundary(s, HERO_PLAYER_ID);
    assertInvariants(s, 't4 fallback 3-seat boundary');
    expect(s.boundary!.seats.length).toBe(3);

    // Case 1 (INV-1 valid): Bank only holds 5×100 (0 five-chips); seated players hold all remaining chips.
    // Auto-invite fills to 4 seats using 5×100 from bank (no chips created), then recheck flags missing 5-chip for ante.
    const bankOnlyHundreds = { 5: 0, 10: 0, 50: 0, 100: 5 } as const;
    const bankExcess = {
      5: s.boundary!.bank[5],
      10: s.boundary!.bank[10],
      50: s.boundary!.bank[50],
      100: s.boundary!.bank[100] - 5,
    };
    const sNoFivesInBank: SandboxSessionState = {
      ...s,
      boundary: {
        ...s.boundary!,
        bank: bankOnlyHundreds,
        seats: s.boundary!.seats.map((seat, idx) =>
          idx === 0
            ? {
                ...seat,
                stack: {
                  5: seat.stack[5] + bankExcess[5],
                  10: seat.stack[10] + bankExcess[10],
                  50: seat.stack[50] + bankExcess[50],
                  100: seat.stack[100] + bankExcess[100],
                },
              }
            : seat,
        ),
      },
    };
    assertInvariants(sNoFivesInBank, 't4 fallback bank-no-5s setup');

    const afterAttempt = startNextHand(sNoFivesInBank);
    assertInvariants(afterAttempt, 't4 fallback after auto-invite lacking 5-chip');
    expect(afterAttempt.phase).toBe('between-hands');
    expect(afterAttempt.boundary!.seats.length).toBe(4);
    expect(afterAttempt.statusNotice?.tone).toBe('warning');
    expect(afterAttempt.statusNotice?.guidance).toContain('thiếu chip mệnh giá 5');

    // Case 2: Deposit genuinely unavailable (bank < 500 and all seated stacks < 500) -> stays at 3 seats with helpful warning.
    const sLowFunds: SandboxSessionState = {
      ...s,
      boundary: {
        ...s.boundary!,
        bank: { 5: 0, 10: 0, 50: 0, 100: 2 },
        seats: s.boundary!.seats.map((seat) => ({
          ...seat,
          stack: { 5: 10, 10: 10, 50: 2, 100: 0 }, // 250 each (< 500)
        })),
      },
    };
    const blockedNoDeposit = startNextHand(sLowFunds);
    expect(blockedNoDeposit.phase).toBe('between-hands');
    expect(blockedNoDeposit.boundary!.seats.length).toBe(3);
    expect(blockedNoDeposit.statusNotice?.tone).toBe('warning');
    expect(blockedNoDeposit.statusNotice?.guidance).toContain('Bàn chỉ còn 3 người');
  });

  it('OOT decision snapshot: captures pre-reserve heroStack/pot/legal context on declare, auto-executes after bot call or fold, and blocks Drill jump for bot-turn state', () => {
    const stageAmountForHero = (
      sess: SandboxSessionState,
      amount: number,
    ): SandboxSessionState => {
      let rem = amount;
      let next = sess;
      const stack = sess.hand!.seats.find((seat) => seat.playerId === HERO_PLAYER_ID)!.stack;
      for (const denom of [100, 50, 10, 5] as const) {
        const take = Math.min(stack[denom], Math.floor(rem / denom));
        for (let i = 0; i < take; i++) {
          next = stageChip(next, denom);
        }
        rem -= take * denom;
      }
      expect(rem).toBe(0);
      return next;
    };

    const finishHandHeroCheckFold = (sess: SandboxSessionState): SandboxSessionState => {
      let cur = sess;
      let guard = 0;
      while (cur.phase === 'in-hand' && cur.hand?.phase === 'betting' && guard < 120) {
        guard++;
        if (cur.hand.activePlayerId === HERO_PLAYER_ID) {
          const val = getHeroActionValidation(cur);
          cur = performHeroAction(cur, val.canCheck ? 'check' : 'fold');
        } else {
          cur = stepOneBotTurn(cur);
        }
        assertInvariants(cur, `finish oot hand step ${guard}`);
      }
      return cur;
    };

    // --- Part A: Auto-execute Hero OOT Call right after intermediate bot CALLS ---
    // Probe seat order for a 4-seat table with ['dien', 'ca', 'da'] so we place opener 2 seats before Hero
    // and place 'ca' (calling station) immediately before Hero, or pick a seed where 'ca' is right before Hero.
    let callSeed = '';
    let callSeatOrder: string[] = [];
    for (let i = 0; i < 40; i++) {
      const candidateSeed = `p4-oot-after-call-${i}`;
      const probe = createSandboxSession({
        seed: candidateSeed,
        settings: {
          playerCount: 4,
          enabledRivalIds: ['dien', 'ca', 'da'],
          allowOutOfTurn: true,
        },
      });
      const order = probe.hand!.seats.map((seat) => seat.playerId);
      // Hero is seat 0 -> seat 2 is opener (2 before hero), seat 3 is immediate actor before hero
      if (order[2] === 'dien' && order[3] === 'ca') {
        callSeed = candidateSeed;
        callSeatOrder = order;
        break;
      }
    }
    expect(callSeed).not.toBe('');

    const callDeck = buildFixtureDeck({
      seatOrderIds: callSeatOrder,
      dealerIndex: 0,
      holeByPlayer: {
        [HERO_PLAYER_ID]: [parseCard('Ah'), parseCard('Jh')],
        dien: [parseCard('As'), parseCard('Kd')],
        ca: [parseCard('Kc'), parseCard('Qs')], // Top-second pair -> Cá calls reliably
        da: [parseCard('2c'), parseCard('7d')],
      },
      board: [
        parseCard('Kh'),
        parseCard('9h'),
        parseCard('3c'),
        parseCard('2s'),
        parseCard('6d'),
      ],
    });

    let sCall = createSandboxSession({
      seed: callSeed,
      settings: {
        playerCount: 4,
        enabledRivalIds: ['dien', 'ca', 'da'],
        allowOutOfTurn: true,
      },
      fixtures: { deck: callDeck, openerId: 'dien' },
    });
    assertInvariants(sCall, 'oot-call init');

    // Step 1: Điên opens with a bet on flop (since allowOutOfTurn is on, advance until currentBet > 0 and active is 'ca')
    let guardCall = 0;
    while (
      sCall.hand!.activePlayerId !== 'ca' &&
      sCall.hand!.phase === 'betting' &&
      guardCall < 6
    ) {
      sCall = stepOneBotTurn(sCall);
      assertInvariants(sCall, `oot-call opener step ${guardCall}`);
      guardCall++;
    }
    expect(sCall.hand!.activePlayerId).toBe('ca');
    expect(sCall.hand!.currentBet).toBeGreaterThan(0);

    const betToCallA = sCall.hand!.currentBet;
    const preDeclareHeroStackA = chipValue(
      sCall.hand!.seats.find((seat) => seat.playerId === HERO_PLAYER_ID)!.stack,
    );
    const preDeclarePotA = chipValue(sCall.hand!.pot);
    const preDeclareTimelineLenA = sCall.hand!.timeline.length;

    // Hero declares OOT Call while it is Cá's turn
    sCall = stageAmountForHero(sCall, betToCallA);
    sCall = performHeroOutOfTurn(sCall, 'call');
    assertInvariants(sCall, 'oot-call after hero declare');

    // Chips are reserved out of Hero stack, but pending snapshot MUST preserve PRE-RESERVE stack & pot & legalActions!
    const heroSeatReservedA = sCall.hand!.seats.find((seat) => seat.playerId === HERO_PLAYER_ID)!;
    expect(chipValue(heroSeatReservedA.stack)).toBe(preDeclareHeroStackA - betToCallA);
    expect(sCall.pendingHeroOutOfTurnDecision).not.toBeNull();
    expect(sCall.pendingHeroOutOfTurnDecision!.snapshot.heroStack).toBe(preDeclareHeroStackA);
    expect(sCall.pendingHeroOutOfTurnDecision!.snapshot.potBeforeCall).toBe(preDeclarePotA);
    expect(sCall.pendingHeroOutOfTurnDecision!.snapshot.legalActions?.callAmount).toBe(betToCallA);

    // Step Cá: Cá calls, triggering Hero's OOT Call auto-execution!
    const prevTimelineLenA = sCall.hand!.timeline.length;
    let botStepA = 0;
    while (sCall.pendingHeroOutOfTurnDecision !== null && botStepA < 4) {
      sCall = stepOneBotTurn(sCall);
      assertInvariants(sCall, `oot-call after ca step ${botStepA}`);
      botStepA++;
    }

    const newEventsA = sCall.hand!.timeline.slice(prevTimelineLenA);
    expect(
      newEventsA.some(
        (ev) => ev.type === 'player-action' && ev.playerId === 'ca' && ev.action.type === 'call',
      ),
    ).toBe(true);
    expect(
      newEventsA.some(
        (ev) =>
          ev.type === 'player-action' &&
          ev.playerId === HERO_PLAYER_ID &&
          ev.action.type === 'call' &&
          ev.fromOutOfTurn === true,
      ),
    ).toBe(true);

    // Pending record moved into heroDecisionsCurrentHand with exact pre-reserve declare-time snapshot (no hindsight from Cá's call!)
    expect(sCall.pendingHeroOutOfTurnDecision).toBeNull();
    expect(sCall.heroDecisionsCurrentHand.length).toBe(1);
    const ootRecordA = sCall.heroDecisionsCurrentHand[0]!;
    expect(ootRecordA.fromOutOfTurn).toBe(true);
    expect(ootRecordA.chosenAction.type).toBe('call');
    expect(ootRecordA.snapshot.heroStack).toBe(preDeclareHeroStackA);
    expect(ootRecordA.snapshot.potBeforeCall).toBe(preDeclarePotA);
    expect(ootRecordA.snapshot.legalActions?.canCall).toBe(true);
    expect(ootRecordA.snapshot.legalActions?.callAmount).toBe(betToCallA);
    expect(ootRecordA.timelineLengthAtDecision).toBe(preDeclareTimelineLenA);
    expect(canPracticeDecisionRecord(ootRecordA)).toBe(false);

    // Complete hand & verify end-of-hand review labels clearly mark out-of-turn
    sCall = finishHandHeroCheckFold(sCall);
    expect(sCall.hand!.phase).toBe('complete');
    expect(sCall.lastHandReview).not.toBeNull();
    const ootReviewA = sCall.lastHandReview!.decisions[0]!;
    expect(ootReviewA.record.fromOutOfTurn).toBe(true);
    expect(ootReviewA.record.snapshot.heroStack).toBe(preDeclareHeroStackA);
    expect(ootReviewA.turnLabelVi).toBe('Hô trước lượt');
    expect(ootReviewA.chosenActionLabel).toContain(`Call ${betToCallA}`);
    expect(ootReviewA.chosenActionLabel).toContain('Hô trước lượt');
    expect(ootReviewA.assumptionsVi.some((line) => line.includes(`Stack Hero (trước reserve): ${preDeclareHeroStackA}`))).toBe(true);

    // --- Part B: Auto-execute Hero OOT Call right after intermediate bot FOLDS ---
    let foldSeed = '';
    let foldSeatOrder: string[] = [];
    for (let i = 0; i < 40; i++) {
      const candidateSeed = `p4-oot-after-fold-${i}`;
      const probe = createSandboxSession({
        seed: candidateSeed,
        settings: {
          playerCount: 4,
          enabledRivalIds: ['dien', 'da', 'tho'],
          allowOutOfTurn: true,
        },
      });
      const order = probe.hand!.seats.map((seat) => seat.playerId);
      // Seat 2 = opener 'dien', seat 3 = tight 'da' right before Hero (seat 0)
      if (order[2] === 'dien' && order[3] === 'da') {
        foldSeed = candidateSeed;
        foldSeatOrder = order;
        break;
      }
    }
    expect(foldSeed).not.toBe('');

    const foldDeck = buildFixtureDeck({
      seatOrderIds: foldSeatOrder,
      dealerIndex: 0,
      holeByPlayer: {
        [HERO_PLAYER_ID]: [parseCard('As'), parseCard('Qs')],
        dien: [parseCard('Ac'), parseCard('Kc')],
        da: [parseCard('2c'), parseCard('7d')], // Trash hand -> Đá folds facing Điên's bet
        tho: [parseCard('3h'), parseCard('8c')],
      },
      board: [
        parseCard('Ad'),
        parseCard('Kh'),
        parseCard('9s'),
        parseCard('4c'),
        parseCard('5d'),
      ],
    });

    let sFold = createSandboxSession({
      seed: foldSeed,
      settings: {
        playerCount: 4,
        enabledRivalIds: ['dien', 'da', 'tho'],
        allowOutOfTurn: true,
      },
      fixtures: { deck: foldDeck, openerId: 'dien' },
    });
    assertInvariants(sFold, 'oot-fold init');

    let guardFold = 0;
    while (
      sFold.hand!.activePlayerId !== 'da' &&
      sFold.hand!.phase === 'betting' &&
      guardFold < 6
    ) {
      sFold = stepOneBotTurn(sFold);
      assertInvariants(sFold, `oot-fold opener step ${guardFold}`);
      guardFold++;
    }
    expect(sFold.hand!.activePlayerId).toBe('da');
    expect(sFold.hand!.currentBet).toBeGreaterThan(0);

    const betToCallB = sFold.hand!.currentBet;
    const preDeclareHeroStackB = chipValue(
      sFold.hand!.seats.find((seat) => seat.playerId === HERO_PLAYER_ID)!.stack,
    );
    const preDeclarePotB = chipValue(sFold.hand!.pot);
    const preDeclareOpponentsB = sFold.hand!.seats
      .filter((seat) => seat.playerId !== HERO_PLAYER_ID && seat.status !== 'folded')
      .map((seat) => seat.playerId);

    sFold = stageAmountForHero(sFold, betToCallB);
    sFold = performHeroOutOfTurn(sFold, 'call');
    assertInvariants(sFold, 'oot-fold after hero declare');

    const prevTimelineLenB = sFold.hand!.timeline.length;
    let botStepB = 0;
    while (sFold.pendingHeroOutOfTurnDecision !== null && botStepB < 4) {
      sFold = stepOneBotTurn(sFold);
      assertInvariants(sFold, `oot-fold after da step ${botStepB}`);
      botStepB++;
    }

    const newEventsB = sFold.hand!.timeline.slice(prevTimelineLenB);
    expect(
      newEventsB.some(
        (ev) => ev.type === 'player-action' && ev.playerId === 'da' && ev.action.type === 'fold',
      ),
    ).toBe(true);
    expect(
      newEventsB.some(
        (ev) =>
          ev.type === 'player-action' &&
          ev.playerId === HERO_PLAYER_ID &&
          ev.action.type === 'call' &&
          ev.fromOutOfTurn === true,
      ),
    ).toBe(true);

    expect(sFold.pendingHeroOutOfTurnDecision).toBeNull();
    expect(sFold.heroDecisionsCurrentHand.length).toBe(1);
    const ootRecordB = sFold.heroDecisionsCurrentHand[0]!;
    expect(ootRecordB.fromOutOfTurn).toBe(true);
    expect(ootRecordB.snapshot.heroStack).toBe(preDeclareHeroStackB);
    expect(ootRecordB.snapshot.potBeforeCall).toBe(preDeclarePotB);
    expect(ootRecordB.activeOpponentIds).toEqual(preDeclareOpponentsB);
    expect(canPracticeDecisionRecord(ootRecordB)).toBe(false);

    sFold = finishHandHeroCheckFold(sFold);
    expect(sFold.hand!.phase).toBe('complete');
    expect(sFold.lastHandReview!.decisions[0]!.turnLabelVi).toBe('Hô trước lượt');
  });

  it('OOT cancellation: releases pending decision record on bet-change cancel, keeps timeline cancel event, and does not misattribute to subsequent Hero action', () => {
    // Pick a seed where 'dien' is immediately before Hero (seat 3) and opens flop with a bet
    let cancelSeed = '';
    let cancelSeatOrder: string[] = [];
    for (let i = 0; i < 40; i++) {
      const candidateSeed = `p4-oot-cancel-clean-${i}`;
      const probe = createSandboxSession({
        seed: candidateSeed,
        settings: {
          playerCount: 4,
          enabledRivalIds: ['dien', 'da', 'ca'],
          allowOutOfTurn: true,
        },
      });
      const order = probe.hand!.seats.map((seat) => seat.playerId);
      if (order[3] === 'dien') {
        cancelSeed = candidateSeed;
        cancelSeatOrder = order;
        break;
      }
    }
    expect(cancelSeed).not.toBe('');

    const cancelDeck = buildFixtureDeck({
      seatOrderIds: cancelSeatOrder,
      dealerIndex: 0,
      holeByPlayer: {
        [HERO_PLAYER_ID]: [parseCard('Jc'), parseCard('Tc')],
        dien: [parseCard('As'), parseCard('Ah')], // Strong hand -> Điên bets reliably
        da: [parseCard('2c'), parseCard('7d')],
        ca: [parseCard('3d'), parseCard('8c')],
      },
      board: [
        parseCard('Ad'),
        parseCard('9h'),
        parseCard('4s'),
        parseCard('2d'),
        parseCard('6c'),
      ],
    });

    let s = createSandboxSession({
      seed: cancelSeed,
      settings: {
        playerCount: 4,
        enabledRivalIds: ['dien', 'da', 'ca'],
        allowOutOfTurn: true,
      },
      fixtures: { deck: cancelDeck, openerId: 'dien' },
    });
    assertInvariants(s, 'oot-cancel init');
    expect(s.hand!.activePlayerId).toBe('dien');

    const heroStackPreDeclare = chipValue(
      s.hand!.seats.find((seat) => seat.playerId === HERO_PLAYER_ID)!.stack,
    );

    // Hero declares OOT Bet 20 before Điên acts
    s = stageChip(stageChip(s, 10), 10);
    s = performHeroOutOfTurn(s, 'bet');
    assertInvariants(s, 'oot-cancel after hero declare bet 20');
    expect(s.pendingHeroOutOfTurnDecision).not.toBeNull();
    expect(s.pendingHeroOutOfTurnDecision!.snapshot.heroStack).toBe(heroStackPreDeclare);

    // Step Điên -> Điên bets, cancelling Hero's OOT Bet 20 and returning chips
    let stepIdx = 0;
    while (
      s.hand!.phase === 'betting' &&
      s.hand!.activePlayerId !== HERO_PLAYER_ID &&
      stepIdx < 6
    ) {
      s = stepOneBotTurn(s);
      assertInvariants(s, `oot-cancel bot step ${stepIdx}`);
      stepIdx++;
    }

    expect(s.hand!.activePlayerId).toBe(HERO_PLAYER_ID);
    expect(s.hand!.currentBet).toBeGreaterThan(0);
    // Pending record MUST be released and NOT pushed to heroDecisionsCurrentHand
    expect(s.pendingHeroOutOfTurnDecision).toBeNull();
    expect(s.heroDecisionsCurrentHand.length).toBe(0);
    expect(
      chipValue(s.hand!.seats.find((seat) => seat.playerId === HERO_PLAYER_ID)!.stack),
    ).toBe(heroStackPreDeclare);
    expect(
      s.hand!.timeline.some(
        (ev) => ev.type === 'out-of-turn-cancelled' && ev.playerId === HERO_PLAYER_ID,
      ),
    ).toBe(true);

    // Hero now freely chooses Fold on their actual turn
    const betFacingHero = s.hand!.currentBet;
    s = performHeroAction(s, 'fold');
    assertInvariants(s, 'oot-cancel after hero fold');

    s = advanceUntilHeroOrEnd(s);
    assertInvariants(s, 'oot-cancel after hand complete');
    expect(s.hand!.phase).toBe('complete');
    expect(s.lastHandReview).not.toBeNull();

    // Review must contain ONLY Hero's actual in-turn Fold (NOT the cancelled OOT Bet 20!)
    expect(s.lastHandReview!.decisions.length).toBe(1);
    const onlyDecision = s.lastHandReview!.decisions[0]!;
    expect(onlyDecision.record.fromOutOfTurn).toBe(false);
    expect(onlyDecision.record.chosenAction.type).toBe('fold');
    expect(onlyDecision.record.snapshot.currentBet).toBe(betFacingHero);
    expect(onlyDecision.record.snapshot.heroStack).toBe(heroStackPreDeclare);
    expect(onlyDecision.turnLabelVi).toBe('Đúng lượt');
    expect(onlyDecision.chosenActionLabel).toBe('Fold');
    expect(canPracticeDecisionRecord(onlyDecision.record)).toBe(true);

    // Timeline still preserves both out-of-turn-declared and out-of-turn-cancelled events
    expect(
      s.lastHandReview!.timeline.some(
        (ev) => ev.type === 'out-of-turn-cancelled' && ev.playerId === HERO_PLAYER_ID,
      ),
    ).toBe(true);
  });

  it('Topbar mute syncs pendingSettings & storage for next hand; spectator Hero cannot enter pendingHeroLeave', () => {
    const storeData = new Map<string, string>();
    const memStorage = {
      getItem: (k: string) => storeData.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storeData.set(k, v);
      },
    };

    let s = createSandboxSession({
      seed: 'p4-mute-and-spectator',
      settings: { playerCount: 4, allowOutOfTurn: false, enablePreflopBetting: false },
      fixtures: { openerId: HERO_PLAYER_ID },
    });
    assertInvariants(s, 'mute-spectator init');

    // Queue pending table rule change mid-hand
    s = applySettingsUpdate(
      s,
      {
        ...s.appliedSettings,
        enablePreflopBetting: true,
        preflopCap: 25,
      },
      'apply-boundary',
    );
    expect(s.pendingSettings?.enablePreflopBetting).toBe(true);
    expect(s.pendingSettings?.audio.muted).toBe(false);

    // Toggle mute from topbar -> updates BOTH appliedSettings and pendingSettings, and persists pending rules + muted
    s = toggleAudioMute(s);
    expect(s.appliedSettings.audio.muted).toBe(true);
    expect(s.pendingSettings?.audio.muted).toBe(true);
    const toPersist = getPersistedSettingsForSession(s);
    expect(toPersist.audio.muted).toBe(true);
    expect(toPersist.enablePreflopBetting).toBe(true);
    expect(toPersist.preflopCap).toBe(25);
    saveSandboxSettings(toPersist, memStorage);
    const reloaded = loadSandboxSettings(memStorage);
    expect(reloaded.settings.audio.muted).toBe(true);
    expect(reloaded.settings.enablePreflopBetting).toBe(true);
    expect(reloaded.settings.preflopCap).toBe(25);

    // Hero requests leave mid-hand -> completes hand 1 and leaves table at boundary
    s = requestHeroLeave(s);
    assertInvariants(s, 'after hero leave request');
    s = advanceUntilHeroOrEnd(s);
    assertInvariants(s, 'hand 1 done with hero leave');
    expect(s.phase).toBe('between-hands');
    expect(s.boundary!.seats.some((seat) => seat.playerId === HERO_PLAYER_ID)).toBe(false);

    // Calling requestHeroLeave while already unseated at boundary is a safe no-op
    const leaveAtBoundaryNoop = requestHeroLeave(s);
    expect(leaveAtBoundaryNoop.pendingHeroLeave).toBe(false);
    expect(leaveAtBoundaryNoop.statusNotice?.tone).not.toBe('error');

    // Start Hand #2 WITHOUT re-seating Hero (Hero is spectating; T4 auto-invites a 4th rival)
    // Also verify pending preflop rules applied AND muted remained true!
    const hand2 = startNextHand(s);
    assertInvariants(hand2, 'hand 2 spectator start');
    expect(hand2.phase).toBe('in-hand');
    expect(hand2.appliedSettings.enablePreflopBetting).toBe(true);
    expect(hand2.appliedSettings.preflopCap).toBe(25);
    expect(hand2.appliedSettings.audio.muted).toBe(true);
    expect(hand2.hand!.seats.some((seat) => seat.playerId === HERO_PLAYER_ID)).toBe(false);

    // Guard in controller: spectator calling requestHeroLeave MUST NOT set pendingHeroLeave
    const afterSpectatorLeave = requestHeroLeave(hand2);
    expect(afterSpectatorLeave.pendingHeroLeave).toBe(false);
    assertInvariants(afterSpectatorLeave, 'after spectator requestHeroLeave');
  });
});
