import { initialDistribution, takeExactLargeFirst } from '../bank';
import { createDeck, formatCard, parseCards, type Card } from '../cards';
import {
  addChips,
  checkInv1,
  CHIP_SET,
  emptyChips,
  subtractChips,
  type ChipCounts,
} from '../chips';
import { applyAction, checkHandInvariants, startHand } from '../hand';
import type { BettingAction, HandConfig, HandState } from '../handTypes';
import { createRng, type Rng } from '../rng';
import {
  createInitialNongTiltState,
  getRivalSeatMetadata,
  type NongTiltState,
  type RivalId,
  type RivalSeatMetadata,
} from '../rivals';
import { buildDrillSpotSolution } from './solver';
import type {
  DrillConceptId,
  DrillFixtureId,
  DrillOutsQuestionKind,
  DrillSpot,
} from './types';

export interface FixtureDeckLayout {
  readonly playerIds: readonly string[];
  readonly dealerIndex: number;
  readonly holeCardsByPlayer: Readonly<Record<string, string>>;
  readonly board: string;
  readonly undealtPrefix?: string;
}

/**
 * Builds a deterministic 52-card deck arranged in the exact dealing order of `startHand`:
 * 2 rounds of 1 card clockwise from left of dealer, then flop (3), turn (1), river (1),
 * then any `undealtPrefix`, then remaining cards in canonical deck order.
 */
export function buildDrillFixtureDeck(spec: FixtureDeckLayout): Card[] {
  const n = spec.playerIds.length;
  const used = new Set<string>();
  const deck: Card[] = [];

  const pushCard = (card: Card): void => {
    const key = formatCard(card);
    if (used.has(key)) {
      throw new Error(`Duplicate card in drill fixture deck: ${key}`);
    }
    used.add(key);
    deck.push(card);
  };

  const holeByIndex = spec.playerIds.map((playerId) => {
    const raw = spec.holeCardsByPlayer[playerId];
    if (raw === undefined) {
      return null;
    }
    const parsed = parseCards(raw);
    if (parsed.length !== 2) {
      throw new Error(`Expected 2 hole cards for "${playerId}", got ${parsed.length}`);
    }
    return parsed as [Card, Card];
  });

  const reserved = new Set<string>();
  for (const pair of holeByIndex) {
    if (pair !== null) {
      reserved.add(formatCard(pair[0]));
      reserved.add(formatCard(pair[1]));
    }
  }

  const boardCards = parseCards(spec.board);
  if (boardCards.length !== 5) {
    throw new Error(`Expected 5 board cards in fixture deck, got ${boardCards.length}`);
  }
  for (const card of boardCards) {
    reserved.add(formatCard(card));
  }

  const undealtPrefixCards = spec.undealtPrefix ? parseCards(spec.undealtPrefix) : [];
  for (const card of undealtPrefixCards) {
    reserved.add(formatCard(card));
  }

  const filler = createDeck().filter((c) => !reserved.has(formatCard(c)));
  let fillerIdx = 0;
  const nextFiller = (): Card => {
    const card = filler[fillerIdx++];
    if (card === undefined) {
      throw new Error('Ran out of filler cards while building drill fixture deck');
    }
    return card;
  };

  for (let round = 0; round < 2; round++) {
    for (let offset = 1; offset <= n; offset++) {
      const seatIdx = (spec.dealerIndex + offset) % n;
      const explicit = holeByIndex[seatIdx] ?? null;
      pushCard(explicit !== null ? explicit[round]! : nextFiller());
    }
  }

  for (const card of boardCards) {
    pushCard(card);
  }
  for (const card of undealtPrefixCards) {
    pushCard(card);
  }
  while (deck.length < 52) {
    pushCard(nextFiller());
  }

  return deck;
}

export function assertDrillHandInvariants(state: HandState, context: string): void {
  const report = checkHandInvariants(state);
  if (!report.ok) {
    throw new Error(
      `Hand invariant violation at ${context}: inv1=${JSON.stringify(report.inv1)}, inv2=${JSON.stringify(report.inv2)}`,
    );
  }
}

function pickChipsFromSeat(state: HandState, playerId: string, amount: number): ChipCounts {
  const seat = state.seats.find((s) => s.playerId === playerId);
  if (seat === undefined) {
    throw new Error(`Seat "${playerId}" not found in state`);
  }
  const chips = takeExactLargeFirst(seat.stack, amount);
  if (chips === null) {
    throw new Error(`Seat "${playerId}" stack ${JSON.stringify(seat.stack)} cannot form ${amount}`);
  }
  return chips;
}

function applyCheckedAction(
  state: HandState,
  playerId: string,
  action: BettingAction,
  context: string,
): HandState {
  const res = applyAction(state, playerId, action);
  if (!res.ok) {
    throw new Error(`Fixture applyAction failed at ${context} (${res.code}): ${res.message}`);
  }
  assertDrillHandInvariants(res.state, context);
  return res.state;
}

function buildSeatRivalMetadataMap(
  seatRivalIds: Readonly<Record<string, RivalId>>,
  nongTiltState: NongTiltState,
): Readonly<Record<string, RivalSeatMetadata>> {
  const map: Record<string, RivalSeatMetadata> = {};
  for (const [playerId, rivalId] of Object.entries(seatRivalIds)) {
    map[playerId] = getRivalSeatMetadata(
      rivalId,
      rivalId === 'nong' ? nongTiltState : undefined,
    );
  }
  return Object.freeze(map);
}

const H1_SEAT_RIVAL_IDS: Readonly<Record<string, RivalId>> = Object.freeze({
  A: 'ca',
  B: 'dien',
  D: 'da',
  E: 'cao',
  F: 'tho',
});

/**
 * Replays AC H1 through the real hand engine up to step #7 (flop), #13 (turn), or #16 (river),
 * checking INV-1 per denomination and INV-2 after every single transition.
 */
export function playH1ToDecisionPoint(
  targetStep: 7 | 13 | 16,
  seed = 'drill-fixture-h1',
): {
  readonly state: HandState;
  readonly heroId: string;
  readonly seatRivalIds: Readonly<Record<string, RivalId>>;
  readonly rivalSeats: Readonly<Record<string, RivalSeatMetadata>>;
  readonly nongTiltState: NongTiltState;
} {
  const playerIds = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
  const init = initialDistribution(6);
  const initialInv1 = checkInv1([init.bank, ...playerIds.map(() => init.perPlayer)]);
  if (!initialInv1.ok) {
    throw new Error('H1 initial distribution failed INV-1');
  }

  const deck = buildDrillFixtureDeck({
    playerIds,
    dealerIndex: 5,
    holeCardsByPlayer: {
      A: 'Kd 4c',
      B: '8h 6h',
      C: 'Js Jd',
      D: 'Qc 3d',
      E: 'Ac Ts',
      F: '4d 3c',
    },
    board: '9h 7h 2c 5s Kc',
  });

  const startRes = startHand({
    seats: playerIds.map((playerId) => ({ playerId, stack: init.perPlayer })),
    bank: init.bank,
    rng: createRng(seed),
    config: {
      dealerIndex: 5,
      enablePreflopBetting: false,
      allowOutOfTurn: false,
    },
    fixtures: {
      deck,
      openerId: 'D',
    },
  });
  if (!startRes.ok) {
    throw new Error(`H1 startHand failed: ${startRes.message}`);
  }
  let state = startRes.state;
  assertDrillHandInvariants(state, 'H1:startHand');

  // Flop: D check, E check, F check, A bet 10, B raise to 30 -> C's turn (#7)
  state = applyCheckedAction(state, 'D', { type: 'check' }, 'H1:D-check');
  state = applyCheckedAction(state, 'E', { type: 'check' }, 'H1:E-check');
  state = applyCheckedAction(state, 'F', { type: 'check' }, 'H1:F-check');
  state = applyCheckedAction(
    state,
    'A',
    { type: 'bet', amount: 10, chips: pickChipsFromSeat(state, 'A', 10) },
    'H1:A-bet-10',
  );
  state = applyCheckedAction(
    state,
    'B',
    { type: 'raise', raiseTo: 30, chips: pickChipsFromSeat(state, 'B', 30) },
    'H1:B-raise-30',
  );

  const nongTiltState = createInitialNongTiltState();
  const rivalSeats = buildSeatRivalMetadataMap(H1_SEAT_RIVAL_IDS, nongTiltState);

  if (targetStep === 7) {
    return {
      state,
      heroId: 'C',
      seatRivalIds: H1_SEAT_RIVAL_IDS,
      rivalSeats,
      nongTiltState,
    };
  }

  // Step 8-12: C calls 30 (3x10), D/E/F fold, A calls +20 -> Turn 5s -> A check, B bet 50 -> C's turn (#13)
  state = applyCheckedAction(
    state,
    'C',
    { type: 'call', chips: { 5: 0, 10: 3, 50: 0, 100: 0 } },
    'H1:C-call-30',
  );
  state = applyCheckedAction(state, 'D', { type: 'fold' }, 'H1:D-fold');
  state = applyCheckedAction(state, 'E', { type: 'fold' }, 'H1:E-fold');
  state = applyCheckedAction(state, 'F', { type: 'fold' }, 'H1:F-fold');
  state = applyCheckedAction(
    state,
    'A',
    { type: 'call', chips: pickChipsFromSeat(state, 'A', 20) },
    'H1:A-call-20',
  );
  state = applyCheckedAction(state, 'A', { type: 'check' }, 'H1:A-turn-check');
  state = applyCheckedAction(
    state,
    'B',
    { type: 'bet', amount: 50, chips: pickChipsFromSeat(state, 'B', 50) },
    'H1:B-turn-bet-50',
  );

  if (targetStep === 13) {
    return {
      state,
      heroId: 'C',
      seatRivalIds: H1_SEAT_RIVAL_IDS,
      rivalSeats,
      nongTiltState,
    };
  }

  // Step 14-16: C calls 50, A folds -> River Kc -> B bet 50 -> C's turn (#16)
  state = applyCheckedAction(
    state,
    'C',
    { type: 'call', chips: pickChipsFromSeat(state, 'C', 50) },
    'H1:C-turn-call-50',
  );
  state = applyCheckedAction(state, 'A', { type: 'fold' }, 'H1:A-turn-fold');
  state = applyCheckedAction(
    state,
    'B',
    { type: 'bet', amount: 50, chips: pickChipsFromSeat(state, 'B', 50) },
    'H1:B-river-bet-50',
  );

  return {
    state,
    heroId: 'C',
    seatRivalIds: H1_SEAT_RIVAL_IDS,
    rivalSeats,
    nongTiltState,
  };
}

/**
 * Maps a `DrillConceptId` to its default canonical fixture ID.
 */
export function defaultFixtureForConcept(conceptId: DrillConceptId): DrillFixtureId {
  switch (conceptId) {
    case 'outs':
      return 'dirty-outs-flop-oesd';
    case 'hit-percent':
      return 'h1-step7';
    case 'pot-odds':
      return 'h1-step13';
    case 'ev-comparison':
      return 'clean-outs-turn-flush-draw';
    case 'rival-range':
      return 'nong-tilt-spot';
    case 'board-texture':
      return 'board-texture-wet-checkraise';
    case 'bet-sizing':
      return 'd8-chase-draw';
  }
}

/**
 * Plays a canonical fixture through the real hand engine (`startHand` + `applyAction`),
 * verifies INV-1 and INV-2 at every transition, and builds a complete `DrillSpot`
 * with a frozen decision-time solution.
 */
export function buildFixtureDrillSpot(
  fixtureId: DrillFixtureId,
  rng: Rng = createRng(`fixture:${fixtureId}`),
  overrideConceptId?: DrillConceptId,
  equitySamples?: number,
): DrillSpot {
  switch (fixtureId) {
    case 'h1-step7':
    case 'h1-step13':
    case 'h1-step16': {
      const stepNum = fixtureId === 'h1-step7' ? 7 : fixtureId === 'h1-step13' ? 13 : 16;
      const h1 = playH1ToDecisionPoint(stepNum, rng.seed);
      const conceptId: DrillConceptId =
        overrideConceptId ??
        (fixtureId === 'h1-step7'
          ? 'hit-percent'
          : fixtureId === 'h1-step13'
            ? 'pot-odds'
            : 'ev-comparison');
      const outsQuestionKind: DrillOutsQuestionKind =
        fixtureId === 'h1-step7' ? 'improvement-outs' : 'clean-outs-vs-range';

      const solved = buildDrillSpotSolution({
        state: h1.state,
        heroId: h1.heroId,
        seatRivalIds: h1.seatRivalIds,
        rivalSeats: h1.rivalSeats,
        nongTiltState: h1.nongTiltState,
        rng: rng.fork('solve'),
        conceptId,
        outsQuestionKind,
        fixtureId,
        equitySamples,
      });

      const titleVi =
        fixtureId === 'h1-step7'
          ? 'H1 #7 — Đôi J♠J♦ trên Flop 9♥7♥2♣ trước Điên raise lên 30'
          : fixtureId === 'h1-step13'
            ? 'H1 #13 — Turn 5♠: Đối mặt Điên bet kịch cap 50 vào pot 170'
            : 'H1 #16 — River K♣: Đối mặt Điên bet kịch cap 50 vào pot 270';

      const outsQuestionPromptVi =
        fixtureId === 'h1-step7'
          ? 'Có bao nhiêu lá giúp đôi J♠J♦ của bạn cải thiện lên bộ ba (set J) trong số lá chưa biết?'
          : 'Có bao nhiêu clean outs giúp bạn lật thế thắng sạch 100% trước range đối thủ?';

      return Object.freeze({
        spotId: `fixture:${fixtureId}:${rng.seed}`,
        seed: rng.seed,
        conceptId,
        source: 'fixture',
        fixtureId,
        titleVi,
        promptVi:
          fixtureId === 'h1-step7'
            ? 'Ván H1 bước #7: Sau khi A (Cá) bet 10 và B (Điên) raise lên 30 (+20), pot hiện là 70. Hãy tính số lá giúp J♠J♦ lên set, xác suất trúng ở turn & tới river (so với Rule of 4), pot odds cần thiết và chọn hành động bằng chip vật lý.'
            : fixtureId === 'h1-step13'
              ? 'Ván H1 bước #13: Turn lật 5♠, A (Cá) check, B (Điên) bet kịch cap 50 đưa pot lên 170. Hãy tính pot odds (50/220) và chọn hành động.'
              : 'Ván H1 bước #16: River lật K♣, B (Điên) tiếp tục bet kịch cap 50 đưa pot lên 270. Hãy tính pot odds (50/320) và quyết định.',
        outsQuestionPromptVi,
        handState: h1.state,
        heroId: h1.heroId,
        rivalSeats: h1.rivalSeats,
        seatRivalIds: h1.seatRivalIds,
        nongTiltState: h1.nongTiltState,
        primaryRivalId: solved.primaryRivalId,
        primaryRivalPlayerId: solved.primaryRivalPlayerId,
        contestingRivalIds: solved.contestingRivalIds,
        snapshot: solved.snapshot,
        publicTimeline: solved.publicTimeline,
        solution: solved.solution,
      });
    }

    case 'd8-chase-draw': {
      // AC D8: 6 players, ante 5x6=30. Flop all 6 contribute 45 -> pot = 300 entering turn.
      // Turn: Hero C (As Kd) acts first with pot 300, max legal bet = cap 50.
      // Opponent B (Đại gia, Qh Th flush draw 9/46 ≈ 19,57%) sees 350/50 and needs 50/400 = 12,5%.
      const playerIds = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
      const init = initialDistribution(6);
      const seatRivalIds: Readonly<Record<string, RivalId>> = Object.freeze({
        A: 'ca',
        B: 'dai-gia',
        D: 'soi',
        E: 'cao',
        F: 'da',
      });
      const nongTiltState = createInitialNongTiltState();
      const rivalSeats = buildSeatRivalMetadataMap(seatRivalIds, nongTiltState);

      const deck = buildDrillFixtureDeck({
        playerIds,
        dealerIndex: 5,
        holeCardsByPlayer: {
          A: '8c 8d',
          B: 'Qh Th',
          C: 'As Kd',
          D: '7s 6s',
          E: '5c 4c',
          F: '3d 2d',
        },
        board: 'Ah 9h 2c 4d Ks',
      });

      const startRes = startHand({
        seats: playerIds.map((playerId) => ({ playerId, stack: init.perPlayer })),
        bank: init.bank,
        rng: rng.fork('hand'),
        config: {
          dealerIndex: 5,
          enablePreflopBetting: false,
          allowOutOfTurn: false,
        },
        fixtures: {
          deck,
          openerId: 'C',
        },
      });
      if (!startRes.ok) {
        throw new Error(`D8 startHand failed: ${startRes.message}`);
      }
      let state = startRes.state;
      assertDrillHandInvariants(state, 'D8:startHand');

      // Flop: C bets 45, D/E/F/A/B all call 45 -> pot = 30 + 6*45 = 300 -> Turn 4d dealt, C opens!
      state = applyCheckedAction(
        state,
        'C',
        { type: 'bet', amount: 45, chips: pickChipsFromSeat(state, 'C', 45) },
        'D8:C-flop-bet-45',
      );
      for (const pid of ['D', 'E', 'F', 'A', 'B'] as const) {
        state = applyCheckedAction(
          state,
          pid,
          { type: 'call', chips: pickChipsFromSeat(state, pid, 45) },
          `D8:${pid}-flop-call-45`,
        );
      }

      const conceptId: DrillConceptId = overrideConceptId ?? 'bet-sizing';
      const solved = buildDrillSpotSolution({
        state,
        heroId: 'C',
        seatRivalIds,
        rivalSeats,
        nongTiltState,
        rng: rng.fork('solve'),
        conceptId,
        outsQuestionKind: 'clean-outs-vs-range',
        fixtureId,
        equitySamples,
      });

      return Object.freeze({
        spotId: `fixture:d8-chase-draw:${rng.seed}`,
        seed: rng.seed,
        conceptId,
        source: 'fixture',
        fixtureId: 'd8-chase-draw',
        titleVi: 'Mốc D8 — "Giá để đuổi Draw" trên Turn: Pot 300 và giới hạn Cap 50',
        promptVi:
          'Turn lật 4♦ trên board A♥ 9♥ 2♣ 4♦, pot hiện tại đã là 300 điểm. Bạn cầm A♠ K♦ (Top Pair Top Kicker) và nói đầu tiên. Nếu bạn bet tối đa 50 (chạm cap street), đối thủ cầm Flush Draw (9 outs / 46 lá ≈ 19,57%) sẽ thấy pot 350/50 và cần 50/400 = 12,5% equity. Hãy chọn mức cược hợp lệ và xem phân tích vì sao cap 50 không thể đuổi được flush draw (khác Hopkins L2 slide 18–20).',
        outsQuestionPromptVi:
          'Có bao nhiêu clean outs giúp bạn lật thế thắng sạch trước range đối thủ trên street này?',
        handState: state,
        heroId: 'C',
        rivalSeats,
        seatRivalIds,
        nongTiltState,
        primaryRivalId: 'dai-gia',
        primaryRivalPlayerId: 'B',
        contestingRivalIds: solved.contestingRivalIds,
        snapshot: solved.snapshot,
        publicTimeline: solved.publicTimeline,
        solution: solved.solution,
      });
    }

    case 'dirty-outs-flop-oesd': {
      // Hero C holds Ah 9h on flop Kh 7h Qc against tight rival D (Đá) who bets 30.
      // Out of 9 remaining hearts, Qh pairs the Qc on the board (giving full houses to KK/77/KQ/Q7 -> mixed/dirty out!),
      // leaving EXACTLY 8 clean heart outs (Jh, Th, 8h, 6h, 5h, 4h, 3h, 2h).
      // Directly tests AC M1 (entering 9 outs when expected clean outs is 8 -> error +1) & Hopkins L2 s24-27!
      const playerIds = ['A', 'B', 'C', 'D'] as const;
      const init = initialDistribution(4);
      const seatRivalIds: Readonly<Record<string, RivalId>> = Object.freeze({
        A: 'tho',
        B: 'ca',
        D: 'da',
      });
      const nongTiltState = createInitialNongTiltState();
      const rivalSeats = buildSeatRivalMetadataMap(seatRivalIds, nongTiltState);

      const deck = buildDrillFixtureDeck({
        playerIds,
        dealerIndex: 0,
        holeCardsByPlayer: {
          A: '5d 2c',
          B: '6s 3d',
          C: 'Ah 9h',
          D: 'Kd Qd',
        },
        board: 'Kh 7h Qc 2s 8h',
      });

      const startRes = startHand({
        seats: playerIds.map((playerId) => ({ playerId, stack: init.perPlayer })),
        bank: init.bank,
        rng: rng.fork('hand'),
        config: {
          dealerIndex: 0,
          enablePreflopBetting: false,
          allowOutOfTurn: false,
        },
        fixtures: {
          deck,
          openerId: 'D',
        },
      });
      if (!startRes.ok) {
        throw new Error(`dirty-outs-flop-oesd startHand failed: ${startRes.message}`);
      }
      let state = startRes.state;
      assertDrillHandInvariants(state, 'dirty-outs:startHand');

      // Flop: D (Đá) bets 30, A folds, B folds -> Hero C's turn facing 30 into pot 50
      state = applyCheckedAction(
        state,
        'D',
        { type: 'bet', amount: 30, chips: pickChipsFromSeat(state, 'D', 30) },
        'dirty-outs:D-bet-30',
      );
      state = applyCheckedAction(state, 'A', { type: 'fold' }, 'dirty-outs:A-fold');
      state = applyCheckedAction(state, 'B', { type: 'fold' }, 'dirty-outs:B-fold');

      const conceptId: DrillConceptId = overrideConceptId ?? 'outs';
      const solved = buildDrillSpotSolution({
        state,
        heroId: 'C',
        seatRivalIds,
        rivalSeats,
        nongTiltState,
        rng: rng.fork('solve'),
        conceptId,
        outsQuestionKind: 'clean-outs-vs-range',
        fixtureId,
        equitySamples,
      });

      return Object.freeze({
        spotId: `fixture:dirty-outs-flop-oesd:${rng.seed}`,
        seed: rng.seed,
        conceptId,
        source: 'fixture',
        fixtureId: 'dirty-outs-flop-oesd',
        titleVi: 'Đếm Clean Outs & Trừ Outs Bẩn — Mua Thùng trên Flop K♥ 7♥ Q♣ trước Đá',
        promptVi:
          'Bạn cầm A♥ 9♥ trên flop K♥ 7♥ Q♣. Đá (Tight-passive) bet 30, hai người khác đã fold. Hãy đếm số clean outs thắng sạch trước range của Đá (Hopkins L2 slide 24–27).',
        outsQuestionPromptVi:
          'Bạn có bao nhiêu clean outs thắng sạch trước range của Đá?',
        handState: state,
        heroId: 'C',
        rivalSeats,
        seatRivalIds,
        nongTiltState,
        primaryRivalId: solved.primaryRivalId,
        primaryRivalPlayerId: solved.primaryRivalPlayerId,
        contestingRivalIds: solved.contestingRivalIds,
        snapshot: solved.snapshot,
        publicTimeline: solved.publicTimeline,
        solution: solved.solution,
      });
    }

    case 'clean-outs-turn-flush-draw': {
      // Hero C holds Ah 4h on turn Kh 7h 4c Ac facing D (Đá) betting 30.
      // Because Ah and 4h are in Hero's hand and Kh and 7h are on the board, NONE of the 9 remaining hearts
      // (Qh, Jh, Th, 9h, 8h, 6h, 5h, 3h, 2h) can pair the board, and no straight flush is possible ->
      // EXACTLY 9 clean outs in 46 unseen cards (9/46 ≈ 19,57%).
      const playerIds = ['A', 'B', 'C', 'D'] as const;
      const init = initialDistribution(4);
      const seatRivalIds: Readonly<Record<string, RivalId>> = Object.freeze({
        A: 'tho',
        B: 'ca',
        D: 'da',
      });
      const nongTiltState = createInitialNongTiltState();
      const rivalSeats = buildSeatRivalMetadataMap(seatRivalIds, nongTiltState);

      const deck = buildDrillFixtureDeck({
        playerIds,
        dealerIndex: 0,
        holeCardsByPlayer: {
          A: '6d 2c',
          B: '8s 3d',
          C: 'Ah 4h',
          D: 'Ad Ks',
        },
        board: 'Kh 7h 4c Ac Qh',
      });

      const startRes = startHand({
        seats: playerIds.map((playerId) => ({ playerId, stack: init.perPlayer })),
        bank: init.bank,
        rng: rng.fork('hand'),
        config: {
          dealerIndex: 0,
          enablePreflopBetting: false,
          allowOutOfTurn: false,
        },
        fixtures: {
          deck,
          openerId: 'D',
        },
      });
      if (!startRes.ok) {
        throw new Error(`clean-outs-turn-flush-draw startHand failed: ${startRes.message}`);
      }
      let state = startRes.state;
      assertDrillHandInvariants(state, 'turn-fd:startHand');

      // Flop: D bets 25, A folds, B folds, C calls 25 -> Turn Ac dealt (pot = 20 + 50 = 70)
      state = applyCheckedAction(
        state,
        'D',
        { type: 'bet', amount: 25, chips: pickChipsFromSeat(state, 'D', 25) },
        'turn-fd:D-flop-bet-25',
      );
      state = applyCheckedAction(state, 'A', { type: 'fold' }, 'turn-fd:A-fold');
      state = applyCheckedAction(state, 'B', { type: 'fold' }, 'turn-fd:B-fold');
      state = applyCheckedAction(
        state,
        'C',
        { type: 'call', chips: pickChipsFromSeat(state, 'C', 25) },
        'turn-fd:C-flop-call-25',
      );

      // Turn: D bets 20 into pot 70 -> potBeforeCall = 90, Hero C faces call 20 (needs 20/110 = 18.18%)
      state = applyCheckedAction(
        state,
        'D',
        { type: 'bet', amount: 20, chips: pickChipsFromSeat(state, 'D', 20) },
        'turn-fd:D-turn-bet-20',
      );

      const conceptId: DrillConceptId = overrideConceptId ?? 'ev-comparison';
      const solved = buildDrillSpotSolution({
        state,
        heroId: 'C',
        seatRivalIds,
        rivalSeats,
        nongTiltState,
        rng: rng.fork('solve'),
        conceptId,
        outsQuestionKind: 'clean-outs-vs-range',
        fixtureId,
        equitySamples,
      });

      return Object.freeze({
        spotId: `fixture:clean-outs-turn-flush-draw:${rng.seed}`,
        seed: rng.seed,
        conceptId,
        source: 'fixture',
        fixtureId: 'clean-outs-turn-flush-draw',
        titleVi: 'EV với Nut Flush Draw ở Turn (9 Clean Outs / 46 lá ≈ 19,57%)',
        promptVi:
          'Turn lật A♣ trên board K♥ 7♥ 4♣ A♣. Bạn cầm A♥ 4♥ (Hai đôi A-4 kèm Nut Flush Draw 9 lá cơ sạch). Đá bet 20 vào pot 70 (pot hiện tại 90, cần call 20 → equity cần 18,18%). Hãy đếm 9 clean outs, tính xác suất 9/46 ≈ 19,57% và so sánh EV để chọn hành động (Hopkins L2 slide 10–11).',
        outsQuestionPromptVi:
          'Có bao nhiêu clean outs giúp bạn lên Thùng A (Nut Flush) thắng sạch 100% mọi bài trong range của Đá ở river?',
        handState: state,
        heroId: 'C',
        rivalSeats,
        seatRivalIds,
        nongTiltState,
        primaryRivalId: solved.primaryRivalId,
        primaryRivalPlayerId: solved.primaryRivalPlayerId,
        contestingRivalIds: solved.contestingRivalIds,
        snapshot: solved.snapshot,
        publicTimeline: solved.publicTimeline,
        solution: solved.solution,
      });
    }

    case 'side-pot-multiway': {
      // AC P1 / Hopkins L2 s14-15: 4 players (B, A, C, D). A starts with 35 (30 after ante 5).
      // Flop: B (Sói) bets 50, A (Cá) calls all-in 30 -> Hero C's turn facing 50 with Main Pot + Side Pot!
      const init = initialDistribution(4);
      const shortStackA: ChipCounts = { 5: 1, 10: 3, 50: 0, 100: 0 };
      const replenishedBank = addChips(init.bank, subtractChips(init.perPlayer, shortStackA));
      const inv1Check = checkInv1([
        replenishedBank,
        init.perPlayer,
        shortStackA,
        init.perPlayer,
        init.perPlayer,
      ]);
      if (!inv1Check.ok) {
        throw new Error('side-pot-multiway initial stacks failed INV-1');
      }

      const playerIds = ['B', 'A', 'C', 'D'] as const;
      const seatRivalIds: Readonly<Record<string, RivalId>> = Object.freeze({
        B: 'soi',
        A: 'ca',
        D: 'tho',
      });
      const nongTiltState = createInitialNongTiltState();
      const rivalSeats = buildSeatRivalMetadataMap(seatRivalIds, nongTiltState);

      const deck = buildDrillFixtureDeck({
        playerIds,
        dealerIndex: 3,
        holeCardsByPlayer: {
          B: 'Kh Qh',
          A: '9s 8s',
          C: 'Ad Kd',
          D: '4c 3c',
        },
        board: 'Kc 9d 2h 7c 5s',
      });

      const startRes = startHand({
        seats: [
          { playerId: 'B', stack: init.perPlayer },
          { playerId: 'A', stack: shortStackA },
          { playerId: 'C', stack: init.perPlayer },
          { playerId: 'D', stack: init.perPlayer },
        ],
        bank: replenishedBank,
        rng: rng.fork('hand'),
        config: {
          dealerIndex: 3,
          enablePreflopBetting: false,
          allowOutOfTurn: false,
        },
        fixtures: {
          deck,
          openerId: 'B',
        },
      });
      if (!startRes.ok) {
        throw new Error(`side-pot-multiway startHand failed: ${startRes.message}`);
      }
      let state = startRes.state;
      assertDrillHandInvariants(state, 'side-pot:startHand');

      // Flop: B bets 50, A calls all-in 30 -> Hero C's turn!
      state = applyCheckedAction(
        state,
        'B',
        { type: 'bet', amount: 50, chips: pickChipsFromSeat(state, 'B', 50) },
        'side-pot:B-bet-50',
      );
      state = applyCheckedAction(
        state,
        'A',
        { type: 'call', chips: pickChipsFromSeat(state, 'A', 30) },
        'side-pot:A-allin-30',
      );

      const conceptId: DrillConceptId = overrideConceptId ?? 'pot-odds';
      const solved = buildDrillSpotSolution({
        state,
        heroId: 'C',
        seatRivalIds,
        rivalSeats,
        nongTiltState,
        rng: rng.fork('solve'),
        conceptId,
        outsQuestionKind: 'clean-outs-vs-range',
        fixtureId,
        equitySamples,
      });

      return Object.freeze({
        spotId: `fixture:side-pot-multiway:${rng.seed}`,
        seed: rng.seed,
        conceptId,
        source: 'fixture',
        fixtureId: 'side-pot-multiway',
        titleVi: 'Side Pot & Chia Equity theo Pot Đủ Điều Kiện (Hopkins L2 slide 14–15)',
        promptVi:
          'Trên flop K♣ 9♦ 2♥, B (Sói) bet 50 và A (Cá, short stack) call all-in 30. Nếu bạn (Hero C, cầm A♦ K♦) call 50, tiền cược tách thành Main Pot 110 (tranh giữa A, B, C) và Side Pot 40 (tranh riêng giữa B và C). Hãy tính pot odds và xem cách chia equity theo từng pot đủ điều kiện.',
        outsQuestionPromptVi:
          'Có bao nhiêu clean outs giúp bạn cải thiện và thắng sạch toàn bộ range đối thủ?',
        handState: state,
        heroId: 'C',
        rivalSeats,
        seatRivalIds,
        nongTiltState,
        primaryRivalId: solved.primaryRivalId,
        primaryRivalPlayerId: solved.primaryRivalPlayerId,
        contestingRivalIds: solved.contestingRivalIds,
        snapshot: solved.snapshot,
        publicTimeline: solved.publicTimeline,
        solution: solved.solution,
      });
    }

    case 'nong-tilt-spot': {
      // Hopkins L8 s6 / D45: Nóng is currently tilted (handsRemaining: 3, big-pot-loss) and bets cap 50 on flop.
      const playerIds = ['A', 'B', 'C', 'D'] as const;
      const init = initialDistribution(4);
      const nongTiltState: NongTiltState = Object.freeze({
        isTilted: true,
        handsRemaining: 3,
        totalTiltDuration: 4,
        triggerReason: 'big-pot-loss',
      });
      const seatRivalIds: Readonly<Record<string, RivalId>> = Object.freeze({
        A: 'nong',
        B: 'tho',
        D: 'cao',
      });
      const rivalSeats = buildSeatRivalMetadataMap(seatRivalIds, nongTiltState);

      const deck = buildDrillFixtureDeck({
        playerIds,
        dealerIndex: 3,
        holeCardsByPlayer: {
          A: 'Jc 8d',
          B: '4d 3c',
          C: 'As Qd',
          D: '6c 5c',
        },
        board: 'Qh 8c 3s 2d Ks',
      });

      const startRes = startHand({
        seats: playerIds.map((playerId) => ({ playerId, stack: init.perPlayer })),
        bank: init.bank,
        rng: rng.fork('hand'),
        config: {
          dealerIndex: 3,
          enablePreflopBetting: false,
          allowOutOfTurn: true,
        },
        fixtures: {
          deck,
          openerId: 'A',
        },
      });
      if (!startRes.ok) {
        throw new Error(`nong-tilt-spot startHand failed: ${startRes.message}`);
      }
      let state = startRes.state;
      assertDrillHandInvariants(state, 'nong-tilt:startHand');

      // Flop: A (Nóng, tilted) bets cap 50, B (Thỏ) folds -> Hero C's turn!
      state = applyCheckedAction(
        state,
        'A',
        { type: 'bet', amount: 50, chips: pickChipsFromSeat(state, 'A', 50) },
        'nong-tilt:A-bet-50',
      );
      state = applyCheckedAction(state, 'B', { type: 'fold' }, 'nong-tilt:B-fold');

      const conceptId: DrillConceptId = overrideConceptId ?? 'rival-range';
      const solved = buildDrillSpotSolution({
        state,
        heroId: 'C',
        seatRivalIds,
        rivalSeats,
        nongTiltState,
        rng: rng.fork('solve'),
        conceptId,
        outsQuestionKind: 'clean-outs-vs-range',
        fixtureId,
        equitySamples,
      });

      return Object.freeze({
        spotId: `fixture:nong-tilt-spot:${rng.seed}`,
        seed: rng.seed,
        conceptId,
        source: 'fixture',
        fixtureId: 'nong-tilt-spot',
        titleVi: 'Đọc Range theo Trạng thái Tilt — Đối mặt Nóng đang Tilt Bet Kịch Cap 50',
        promptVi:
          'Nóng vừa thua pot lớn ở ván trước nên đang Tilt (còn 3 ván). Trên flop Q♥ 8♣ 3♠, Nóng lập tức đẩy bet 50 (chạm cap). Vì Nóng đang tilt, range bet 50 mở rộng gồm cả bài trung bình, draw yếu và bluff. Hãy tính pot odds và tận dụng lợi thế equity trước Nóng (Hopkins L8 slide 6).',
        outsQuestionPromptVi:
          'Có bao nhiêu clean outs giúp bài bạn thắng sạch 100% trước toàn bộ range của Nóng?',
        handState: state,
        heroId: 'C',
        rivalSeats,
        seatRivalIds,
        nongTiltState,
        primaryRivalId: solved.primaryRivalId,
        primaryRivalPlayerId: solved.primaryRivalPlayerId,
        contestingRivalIds: solved.contestingRivalIds,
        snapshot: solved.snapshot,
        publicTimeline: solved.publicTimeline,
        solution: solved.solution,
      });
    }

    case 'board-texture-wet-checkraise': {
      // Hopkins L5 s6-12, s23-25: Draw-heavy board Th 9h 8c where Bẫy (bay) checks then check-raises to 40.
      const playerIds = ['A', 'B', 'C', 'D'] as const;
      const init = initialDistribution(4);
      const seatRivalIds: Readonly<Record<string, RivalId>> = Object.freeze({
        A: 'bay',
        B: 'soi',
        D: 'tho',
      });
      const nongTiltState = createInitialNongTiltState();
      const rivalSeats = buildSeatRivalMetadataMap(seatRivalIds, nongTiltState);

      const deck = buildDrillFixtureDeck({
        playerIds,
        dealerIndex: 3,
        holeCardsByPlayer: {
          A: 'Jh 7h',
          B: 'Ad Td',
          C: 'Ah Qh',
          D: '4c 3d',
        },
        board: 'Th 9h 8c 2h Ks',
      });

      const startRes = startHand({
        seats: playerIds.map((playerId) => ({ playerId, stack: init.perPlayer })),
        bank: init.bank,
        rng: rng.fork('hand'),
        config: {
          dealerIndex: 3,
          enablePreflopBetting: false,
          allowOutOfTurn: false,
        },
        fixtures: {
          deck,
          openerId: 'A',
        },
      });
      if (!startRes.ok) {
        throw new Error(`board-texture-wet-checkraise startHand failed: ${startRes.message}`);
      }
      let state = startRes.state;
      assertDrillHandInvariants(state, 'wet-cr:startHand');

      // Flop Th 9h 8c: A (Bẫy) checks, B (Sói) bets 15, C calls 15, D folds, A check-raises to 45, B folds -> Hero C's turn (+30 to call)!
      state = applyCheckedAction(state, 'A', { type: 'check' }, 'wet-cr:A-check');
      state = applyCheckedAction(
        state,
        'B',
        { type: 'bet', amount: 15, chips: pickChipsFromSeat(state, 'B', 15) },
        'wet-cr:B-bet-15',
      );
      state = applyCheckedAction(
        state,
        'C',
        { type: 'call', chips: pickChipsFromSeat(state, 'C', 15) },
        'wet-cr:C-call-15',
      );
      state = applyCheckedAction(state, 'D', { type: 'fold' }, 'wet-cr:D-fold');
      state = applyCheckedAction(
        state,
        'A',
        { type: 'raise', raiseTo: 45, chips: pickChipsFromSeat(state, 'A', 45) },
        'wet-cr:A-checkraise-45',
      );
      state = applyCheckedAction(state, 'B', { type: 'fold' }, 'wet-cr:B-fold');

      const conceptId: DrillConceptId = overrideConceptId ?? 'board-texture';
      const solved = buildDrillSpotSolution({
        state,
        heroId: 'C',
        seatRivalIds,
        rivalSeats,
        nongTiltState,
        rng: rng.fork('solve'),
        conceptId,
        outsQuestionKind: 'clean-outs-vs-range',
        fixtureId,
        equitySamples,
      });

      return Object.freeze({
        spotId: `fixture:board-texture-wet-checkraise:${rng.seed}`,
        seed: rng.seed,
        conceptId,
        source: 'fixture',
        fixtureId: 'board-texture-wet-checkraise',
        titleVi: 'Đọc Board Texture & Check-Raise của Bẫy trên Mặt Bài Nhiều Draw (T♥ 9♥ 8♣)',
        promptVi:
          'Trên flop T♥ 9♥ 8♣ (3 lá liên tiếp có 2 lá cơ — mặt bài Nhiều draw), A (Bẫy) check rồi check-raise lên 45 sau khi B (Sói) bet 15 và bạn đã góp 15. Bạn cầm A♥ Q♥ (Nut Flush Draw + Gutshot sảnh J) và cần bỏ thêm 30 vào pot 95. Hãy phân loại kết cấu board, đọc range check-raise của Bẫy và quyết định (Hopkins L5 slide 6–12, 23–25).',
        outsQuestionPromptVi:
          'Có bao nhiêu clean outs giúp bạn lật thế thắng sạch 100% trước range check-raise của Bẫy?',
        handState: state,
        heroId: 'C',
        rivalSeats,
        seatRivalIds,
        nongTiltState,
        primaryRivalId: solved.primaryRivalId,
        primaryRivalPlayerId: solved.primaryRivalPlayerId,
        contestingRivalIds: solved.contestingRivalIds,
        snapshot: solved.snapshot,
        publicTimeline: solved.publicTimeline,
        solution: solved.solution,
      });
    }
  }
}

export function createCustomConfigFixtureValidation(
  playerCount: number,
  config?: Partial<HandConfig>,
): boolean {
  const dist = initialDistribution(playerCount);
  const used = Array.from({ length: playerCount }, () => dist.perPlayer).reduce(
    (acc, s) => addChips(acc, s),
    emptyChips(),
  );
  const expectedBank = subtractChips(CHIP_SET, used);
  const inv1 = checkInv1([expectedBank, ...Array.from({ length: playerCount }, () => dist.perPlayer)]);
  return inv1.ok && (config?.preflopCap ?? 50) <= 50;
}
