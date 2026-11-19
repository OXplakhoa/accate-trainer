import { initialDistribution, MAX_PLAYERS, MIN_PLAYERS, takeExactLargeFirst } from '../bank';
import { formatCard } from '../cards';
import { checkInv1, chipValue, DENOMINATIONS, type ChipCounts, type Denomination } from '../chips';
import { defaultBreakdown } from '../exchange';
import {
  applyAction,
  declareOutOfTurn,
  exchangeHandChips,
  getLegalActions,
  settlePendingPayout,
  startHand,
} from '../hand';
import { STREET_CAP, type BettingAction, type HandErrorCode, type HandState } from '../handTypes';
import { createRng, type Rng } from '../rng';
import {
  buildRivalDecisionInput,
  createInitialNongTiltState,
  decideRivalAction,
  decideRivalOutOfTurn,
  getRivalSeatMetadata,
  isRivalId,
  RIVAL_IDS,
  selectRivalsForTable,
  type NongTiltState,
  type RivalId,
  type RivalSeatMetadata,
} from '../rivals';
import {
  assertDrillHandInvariants,
  buildFixtureDrillSpot,
  defaultFixtureForConcept,
} from './fixtures';
import { buildDrillSpotSolution } from './solver';
import type {
  ChipExchangeHelperOption,
  DrillConceptId,
  DrillPostHandFeedback,
  DrillSpot,
  GenerateDrillSpotInput,
} from './types';

const DEFAULT_MAX_SPOT_ATTEMPTS = 16;
const SEAT_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] as const;
const DEFAULT_HERO_ID = 'C';

function formatPctVi(ratio: number, decimals = 2): string {
  return `${(ratio * 100).toFixed(decimals).replace(/\.00$/, '').replace('.', ',')}%`;
}

function formatActionVi(action: BettingAction, streetContributionBefore = 0): string {
  switch (action.type) {
    case 'fold':
      return 'Fold';
    case 'check':
      return 'Check';
    case 'call':
      return `Call ${chipValue(action.chips)}`;
    case 'bet':
      return `Bet ${action.amount}`;
    case 'raise': {
      const added = Math.max(0, action.raiseTo - streetContributionBefore);
      return `Raise lên ${action.raiseTo} (+${added})`;
    }
  }
}

/**
 * Finds an exact physical chip combination from `stack` summing to `amount`.
 * Returns `null` if `stack` lacks the denominations to form `amount` without a chip exchange.
 */
export function selectPhysicalChipsForAmount(
  stack: ChipCounts,
  amount: number,
): ChipCounts | null {
  return takeExactLargeFirst(stack, amount);
}

/**
 * Finds valid equal-value chip exchanges (`exchangeHandChips`) with the pot or other seated players
 * so `heroId` can break a large chip (50 or 100 or 10) into smaller denominations (AC C3, D20, D21).
 */
export function findAvailableChipExchanges(
  state: HandState,
  heroId: string,
): readonly ChipExchangeHelperOption[] {
  const heroSeat = state.seats.find((s) => s.playerId === heroId);
  if (heroSeat === undefined) {
    return Object.freeze([]);
  }

  const options: ChipExchangeHelperOption[] = [];
  const candidateDenoms: readonly Denomination[] = [50, 100, 10];

  for (const denom of candidateDenoms) {
    if (heroSeat.stack[denom] < 1) {
      continue;
    }
    const give: ChipCounts = {
      5: denom === 5 ? 1 : 0,
      10: denom === 10 ? 1 : 0,
      50: denom === 50 ? 1 : 0,
      100: denom === 100 ? 1 : 0,
    };

    // 1. Try breaking with pot
    const potBreak = defaultBreakdown(denom, state.pot);
    if (potBreak !== null) {
      const desc = DENOMINATIONS.filter((d) => potBreak[d] > 0)
        .map((d) => `${potBreak[d]}×${d}`)
        .join(' + ');
      options.push({
        labelVi: `Đổi 1×${denom} lấy ${desc} từ Pot`,
        give,
        receive: potBreak,
        target: { kind: 'pot' },
      });
    }

    // 2. Try breaking with another seated player
    for (const other of state.seats) {
      if (other.playerId === heroId) {
        continue;
      }
      const playerBreak = defaultBreakdown(denom, other.stack);
      if (playerBreak !== null) {
        const desc = DENOMINATIONS.filter((d) => playerBreak[d] > 0)
          .map((d) => `${playerBreak[d]}×${d}`)
          .join(' + ');
        options.push({
          labelVi: `Đổi 1×${denom} lấy ${desc} từ ghế ${other.playerId}`,
          give,
          receive: playerBreak,
          target: { kind: 'player', playerId: other.playerId },
        });
        break;
      }
    }
  }

  return Object.freeze(options);
}

function doesHeroTurnMatchConcept(state: HandState, heroId: string, conceptId: DrillConceptId): boolean {
  if (state.phase !== 'betting' || state.activePlayerId !== heroId) {
    return false;
  }
  const legal = getLegalActions(state);
  if (legal === null) {
    return false;
  }

  const nonFoldedOpponents = state.seats.filter(
    (s) => s.playerId !== heroId && s.status !== 'folded',
  );
  if (nonFoldedOpponents.length === 0) {
    return false;
  }

  switch (conceptId) {
    case 'outs':
    case 'hit-percent':
      return (state.street === 'flop' || state.street === 'turn') && legal.toCall > 0;
    case 'pot-odds':
    case 'ev-comparison':
      return state.street !== 'preflop' && legal.toCall > 0;
    case 'rival-range':
    case 'board-texture':
      return state.street !== 'preflop' && (legal.toCall > 0 || state.timeline.length >= 5);
    case 'bet-sizing':
      return state.street !== 'preflop' && (legal.canBet || legal.canRaise);
  }
}

function inferDefaultSeatRivalIds(
  state: HandState,
  heroId: string,
  provided?: Readonly<Record<string, RivalId>>,
): Readonly<Record<string, RivalId>> {
  const defaultMapping: Record<string, RivalId> = {
    A: 'ca',
    B: 'dien',
    D: 'da',
    E: 'cao',
    F: 'tho',
    G: 'soi',
    H: 'dai-gia',
    I: 'bay',
    J: 'nong',
  };
  const map: Record<string, RivalId> = {};
  let fallbackIdx = 0;

  for (const seat of state.seats) {
    if (seat.playerId === heroId) {
      continue;
    }
    if (provided && provided[seat.playerId] !== undefined) {
      map[seat.playerId] = provided[seat.playerId]!;
    } else if (isRivalId(seat.playerId)) {
      map[seat.playerId] = seat.playerId;
    } else if (defaultMapping[seat.playerId] !== undefined) {
      map[seat.playerId] = defaultMapping[seat.playerId]!;
    } else {
      map[seat.playerId] = RIVAL_IDS[fallbackIdx % RIVAL_IDS.length]!;
      fallbackIdx += 1;
    }
  }
  return Object.freeze(map);
}

/**
 * Advances a `HandState` through rival turns using only public information (`buildRivalDecisionInput`,
 * `decideRivalOutOfTurn`, `decideRivalAction`) until it is `heroId`'s turn or the hand ends.
 * Verifies INV-1 and INV-2 after every engine step.
 */
function advanceRivalsUntilHeroTurn(
  initialState: HandState,
  heroId: string,
  seatRivalIds: Readonly<Record<string, RivalId>>,
  nongTiltState: NongTiltState,
  rng: Rng,
): HandState {
  let state = initialState;
  assertDrillHandInvariants(state, 'advanceRivals:initial');

  let guard = 0;
  while (state.phase === 'betting' && state.activePlayerId !== null && state.activePlayerId !== heroId) {
    guard += 1;
    if (guard > 80) {
      break;
    }

    // Check if one upcoming rival declares an out-of-turn action when allowed
    if (state.config.allowOutOfTurn) {
      for (const seat of state.seats) {
        if (
          seat.playerId !== heroId &&
          seat.playerId !== state.activePlayerId &&
          seat.status === 'active' &&
          seat.declaration === null &&
          (!seat.hasActedThisStreet || seat.streetContribution < state.currentBet)
        ) {
          const rivalId = seatRivalIds[seat.playerId] ?? 'dien';
          const ootDto = buildRivalDecisionInput(state, seat.playerId, {
            rivalId,
            tiltState: rivalId === 'nong' ? nongTiltState : undefined,
          });
          const ootDecision = decideRivalOutOfTurn(
            ootDto,
            rng.fork(`oot:${guard}:${seat.playerId}`),
          );
          if (ootDecision.action !== null) {
            const declRes = declareOutOfTurn(state, seat.playerId, ootDecision.action);
            if (declRes.ok) {
              state = declRes.state;
              assertDrillHandInvariants(state, `advanceRivals:oot:${seat.playerId}`);
              break;
            }
          }
        }
      }
    }

    const actorId = state.activePlayerId;
    if (actorId === null || actorId === heroId) {
      break;
    }

    const rivalId = seatRivalIds[actorId] ?? 'cao';
    const dto = buildRivalDecisionInput(state, actorId, {
      rivalId,
      tiltState: rivalId === 'nong' ? nongTiltState : undefined,
    });
    const decision = decideRivalAction(dto, rng.fork(`act:${guard}:${actorId}`));
    const stepRes = applyAction(state, actorId, decision.action);
    if (!stepRes.ok) {
      // Defensive fallback to check or fold if action rejected
      const fallbackAction: BettingAction =
        (dto.legalActions?.canCheck ?? false) ? { type: 'check' } : { type: 'fold' };
      const fbRes = applyAction(state, actorId, fallbackAction);
      if (!fbRes.ok) {
        break;
      }
      state = fbRes.state;
    } else {
      state = stepRes.state;
    }
    assertDrillHandInvariants(state, `advanceRivals:step:${guard}:${actorId}`);
  }

  return state;
}

/**
 * Generates a drill spot by playing a seeded Accate hand with M1 engine and M2 rival bots
 * up to hero's turn, with a bounded retry limit (`maxAttempts`) and automatic fallback
 * to an engine-played canonical fixture (spec §6, D43, AC D4).
 */
export function generateDrillSpot(input: GenerateDrillSpotInput): DrillSpot {
  const rng = createRng(input.seed);
  const conceptId: DrillConceptId = input.conceptId ?? 'pot-odds';

  if (input.forceFixtureId !== undefined) {
    return buildFixtureDrillSpot(
      input.forceFixtureId,
      rng.fork('forced-fixture'),
      conceptId,
      input.equitySamples,
    );
  }

  const maxAttempts =
    input.maxAttempts !== undefined && Number.isInteger(input.maxAttempts) && input.maxAttempts >= 0
      ? input.maxAttempts
      : DEFAULT_MAX_SPOT_ATTEMPTS;

  const playerCount =
    input.playerCount !== undefined &&
    Number.isInteger(input.playerCount) &&
    input.playerCount >= MIN_PLAYERS &&
    input.playerCount <= MAX_PLAYERS
      ? input.playerCount
      : 6;

  const init = initialDistribution(playerCount);
  const initialInv = checkInv1([
    init.bank,
    ...Array.from({ length: playerCount }, () => init.perPlayer),
  ]);
  if (!initialInv.ok) {
    throw new Error('Initial chip distribution failed INV-1');
  }

  const seatPlayerIds = SEAT_LETTERS.slice(0, playerCount);
  const heroSeatIdx = Math.min(2, playerCount - 1);
  const heroId = seatPlayerIds[heroSeatIdx] ?? DEFAULT_HERO_ID;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const attemptRng = rng.fork(`spot-attempt:${attempt}`);
    const nongTiltState: NongTiltState =
      input.nongTiltState ??
      (conceptId === 'rival-range' && attempt % 2 === 0
        ? {
            isTilted: true,
            handsRemaining: 3,
            totalTiltDuration: 4,
            triggerReason: 'big-pot-loss',
          }
        : createInitialNongTiltState());

    const rivalSelection = selectRivalsForTable({
      rng: attemptRng.fork('rivals'),
      totalPlayers: playerCount,
      heroSeatIndex: heroSeatIdx,
      enabledRivalIds: input.enabledRivalIds,
      nongTiltState,
    });

    if (!rivalSelection.ok) {
      continue;
    }

    const seatRivalIds: Record<string, RivalId> = {};
    const rivalSeats: Record<string, RivalSeatMetadata> = {};
    for (const assignment of rivalSelection.assignments) {
      const pid = seatPlayerIds[assignment.seatIndex]!;
      seatRivalIds[pid] = assignment.rivalId;
      rivalSeats[pid] = assignment.metadata;
    }

    const dealerIndex = attemptRng.fork('dealer').int(playerCount);
    const startRes = startHand({
      seats: seatPlayerIds.map((playerId, idx) => ({
        seatIndex: idx,
        playerId,
        stack: init.perPlayer,
      })),
      bank: init.bank,
      rng: attemptRng.fork('hand'),
      config: {
        dealerIndex,
        enablePreflopBetting: input.enablePreflopBetting ?? false,
        preflopCap: input.preflopCap ?? STREET_CAP,
        allowOutOfTurn: input.allowOutOfTurn ?? true,
        tieBreakMode: input.tieBreakMode ?? 'bai-cao',
      },
    });

    if (!startRes.ok) {
      continue;
    }

    let state = startRes.state;
    assertDrillHandInvariants(state, `generateDrillSpot:attempt:${attempt}:start`);

    // Advance up to 3 hero decision points inside this hand to find a spot matching `conceptId`
    for (let heroTurnCycle = 0; heroTurnCycle < 3; heroTurnCycle++) {
      state = advanceRivalsUntilHeroTurn(
        state,
        heroId,
        seatRivalIds,
        nongTiltState,
        attemptRng.fork(`cycle:${heroTurnCycle}`),
      );

      if (state.phase !== 'betting' || state.activePlayerId !== heroId) {
        break;
      }

      if (doesHeroTurnMatchConcept(state, heroId, conceptId)) {
        const solved = buildDrillSpotSolution({
          state,
          heroId,
          seatRivalIds: Object.freeze(seatRivalIds),
          rivalSeats: Object.freeze(rivalSeats),
          nongTiltState,
          rng: attemptRng.fork('solve'),
          conceptId,
          outsQuestionKind: 'clean-outs-vs-range',
          equitySamples: input.equitySamples,
        });

        const primaryMeta =
          rivalSeats[solved.primaryRivalPlayerId] ??
          getRivalSeatMetadata(solved.primaryRivalId, nongTiltState);
        const heroCardsLabel = solved.snapshot.heroCards.map(formatCard).join(' ');
        const boardLabel =
          solved.snapshot.board.length > 0
            ? solved.snapshot.board.map(formatCard).join(' ')
            : 'Preflop';

        return Object.freeze({
          spotId: `gen:${conceptId}:${input.seed}:${attempt}`,
          seed: input.seed,
          conceptId,
          source: 'generated',
          titleVi: `Spot ${state.street.toUpperCase()} — ${heroCardsLabel} trên [${boardLabel}] trước ${primaryMeta.name}`,
          promptVi:
            solved.snapshot.toCall > 0
              ? `Lượt của bạn (${heroId}) ở ${state.street.toUpperCase()}: Pot hiện tại ${solved.snapshot.potBeforeCall}, cần Call ${solved.snapshot.callAmount} trước ${primaryMeta.name} (${primaryMeta.styleLabel}). Hãy phân tích outs, xác suất, pot odds và chọn hành động bằng chip vật lý.`
              : `Lượt của bạn (${heroId}) ở ${state.street.toUpperCase()}: Pot hiện tại ${solved.snapshot.potBeforeCall}, chưa ai mở cược. Hãy đánh giá kết cấu board, equity trước ${primaryMeta.name} và chọn Check hoặc Bet hợp lệ dưới cap ${solved.snapshot.streetCap}.`,
          outsQuestionPromptVi:
            'Có bao nhiêu clean outs giúp bài bạn thắng sạch 100% trước range giả định của đối thủ?',
          handState: state,
          heroId,
          rivalSeats: Object.freeze(rivalSeats),
          seatRivalIds: Object.freeze(seatRivalIds),
          nongTiltState,
          primaryRivalId: solved.primaryRivalId,
          primaryRivalPlayerId: solved.primaryRivalPlayerId,
          contestingRivalIds: solved.contestingRivalIds,
          snapshot: solved.snapshot,
          publicTimeline: solved.publicTimeline,
          solution: solved.solution,
        });
      }

      // If this turn is an unopened pot (`toCall === 0`) and we need a facing-bet spot, check and continue
      const legal = getLegalActions(state);
      if (legal !== null && legal.canCheck) {
        const chk = applyAction(state, heroId, { type: 'check' });
        if (!chk.ok) {
          break;
        }
        state = chk.state;
        assertDrillHandInvariants(state, `generateDrillSpot:attempt:${attempt}:heroCheck`);
      } else {
        break;
      }
    }
  }

  // Bounded retry fallback to engine-played canonical fixture
  const fallbackFixtureId = defaultFixtureForConcept(conceptId);
  return buildFixtureDrillSpot(
    fallbackFixtureId,
    rng.fork('fixture-fallback'),
    conceptId,
    input.equitySamples,
  );
}

/**
 * Builds a `DrillSpot` directly from an external `HandState` (e.g., `initialSpot` passed from Sandbox).
 * Uses the exact snapshot of that hand without importing any Sandbox modules.
 */
export function createDrillSpotFromHandState(input: {
  readonly hand: HandState;
  readonly heroId: string;
  readonly seed?: string;
  readonly conceptId?: DrillConceptId;
  readonly seatRivalIds?: Readonly<Record<string, RivalId>>;
  readonly nongTiltState?: NongTiltState;
  readonly equitySamples?: number;
}): DrillSpot {
  const seed = input.seed ?? `sandbox:${input.hand.rngSeed}:${input.hand.timeline.length}`;
  const rng = createRng(seed);
  const nongTiltState = input.nongTiltState ?? createInitialNongTiltState();
  const seatRivalIds = inferDefaultSeatRivalIds(input.hand, input.heroId, input.seatRivalIds);

  const rivalSeats: Record<string, RivalSeatMetadata> = {};
  for (const [pid, rivalId] of Object.entries(seatRivalIds)) {
    rivalSeats[pid] = getRivalSeatMetadata(
      rivalId,
      rivalId === 'nong' ? nongTiltState : undefined,
    );
  }

  assertDrillHandInvariants(input.hand, 'createDrillSpotFromHandState:input');

  let state = input.hand;
  if (state.phase === 'betting' && state.activePlayerId !== input.heroId) {
    state = advanceRivalsUntilHeroTurn(
      state,
      input.heroId,
      seatRivalIds,
      nongTiltState,
      rng.fork('advance-to-hero'),
    );
  }

  const conceptId: DrillConceptId = input.conceptId ?? 'ev-comparison';
  const solved = buildDrillSpotSolution({
    state,
    heroId: input.heroId,
    seatRivalIds,
    rivalSeats: Object.freeze(rivalSeats),
    nongTiltState,
    rng: rng.fork('solve'),
    conceptId,
    outsQuestionKind: 'clean-outs-vs-range',
    equitySamples: input.equitySamples,
  });

  const heroCardsLabel = solved.snapshot.heroCards.map(formatCard).join(' ');
  const boardLabel =
    solved.snapshot.board.length > 0
      ? solved.snapshot.board.map(formatCard).join(' ')
      : 'Preflop';

  return Object.freeze({
    spotId: `sandbox:${seed}`,
    seed,
    conceptId,
    source: 'sandbox',
    titleVi: `Spot từ Bàn chơi — ${heroCardsLabel} trên [${boardLabel}]`,
    promptVi: `Phân tích spot thực tế từ bàn tại ${state.street.toUpperCase()} (Pot ${solved.snapshot.potBeforeCall}, cần Call ${solved.snapshot.callAmount}).`,
    outsQuestionPromptVi:
      'Có bao nhiêu clean outs giúp bạn lật thế thắng sạch trước range đối thủ?',
    handState: state,
    heroId: input.heroId,
    rivalSeats: Object.freeze(rivalSeats),
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

function autoSettlePendingPayoutIfNeeded(state: HandState): HandState {
  if (state.phase !== 'awaiting-payout' || state.pendingPayout === null) {
    return state;
  }

  let current = state;
  for (const denom of [100, 50, 10] as const) {
    if (current.pot[denom] < 1) {
      continue;
    }
    const giveFromPot: ChipCounts = {
      5: 0,
      10: denom === 10 ? 1 : 0,
      50: denom === 50 ? 1 : 0,
      100: denom === 100 ? 1 : 0,
    };

    for (const seat of current.seats) {
      const smallFromPlayer = defaultBreakdown(denom, seat.stack);
      if (smallFromPlayer !== null) {
        const exRes = exchangeHandChips(current, {
          fromPlayerId: seat.playerId,
          target: { kind: 'pot' },
          give: smallFromPlayer,
          receive: giveFromPot,
        });
        if (exRes.ok) {
          current = exRes.state;
          assertDrillHandInvariants(current, 'autoSettle:exchange');
          const settleRes = settlePendingPayout(current);
          if (settleRes.ok) {
            assertDrillHandInvariants(settleRes.state, 'autoSettle:settled');
            return settleRes.state;
          }
        }
      }
    }
  }
  return current;
}

/**
 * Continues a hand from the exact captured `spot.handState` using `heroAction`,
 * plays remaining turns/streets to completion via M1 engine & M2 rival bots
 * (or exact H1 continuation for `'h1-step7'`/`'h1-step13'`), verifies INV-1 and INV-2
 * at every step, and builds the post-hand feedback comparing decision quality vs hand outcome (AC D6).
 */
export function completeDrillHand(
  spot: DrillSpot,
  heroAction: BettingAction,
  rng: Rng = createRng(`complete:${spot.spotId}`),
):
  | {
      readonly ok: true;
      readonly stateAfterHeroAction: HandState;
      readonly completedState: HandState;
      readonly postHandFeedback: DrillPostHandFeedback;
    }
  | {
      readonly ok: false;
      readonly code: HandErrorCode;
      readonly message: string;
    } {
  const step0 = applyAction(spot.handState, spot.heroId, heroAction);
  if (!step0.ok) {
    return {
      ok: false,
      code: step0.code,
      message: step0.message,
    };
  }
  assertDrillHandInvariants(step0.state, 'completeDrillHand:heroAction');
  const stateAfterHeroAction = step0.state;
  let state = stateAfterHeroAction;

  // For H1 fixtures when hero chooses Call, replay the exact H1 steps so H1 #7 -> #18 reproduces identically
  if (spot.fixtureId === 'h1-step7' && heroAction.type === 'call') {
    for (const foldId of ['D', 'E', 'F'] as const) {
      if (state.phase === 'betting' && state.activePlayerId === foldId) {
        const res = applyAction(state, foldId, { type: 'fold' });
        if (res.ok) {
          state = res.state;
          assertDrillHandInvariants(state, `H1-finish:${foldId}-fold`);
        }
      }
    }
    if (state.phase === 'betting' && state.activePlayerId === 'A') {
      const aStack = state.seats.find((s) => s.playerId === 'A')!.stack;
      const aChips = takeExactLargeFirst(aStack, 20);
      if (aChips !== null) {
        const res = applyAction(state, 'A', { type: 'call', chips: aChips });
        if (res.ok) {
          state = res.state;
          assertDrillHandInvariants(state, 'H1-finish:A-call-20');
        }
      }
    }
    // Turn: A check, B bet 50, C call 50, A fold
    if (state.phase === 'betting' && state.street === 'turn' && state.activePlayerId === 'A') {
      const r1 = applyAction(state, 'A', { type: 'check' });
      if (r1.ok) {
        state = r1.state;
        assertDrillHandInvariants(state, 'H1-finish:A-turn-check');
      }
      const bChips = takeExactLargeFirst(state.seats.find((s) => s.playerId === 'B')!.stack, 50);
      if (bChips !== null) {
        const r2 = applyAction(state, 'B', { type: 'bet', amount: 50, chips: bChips });
        if (r2.ok) {
          state = r2.state;
          assertDrillHandInvariants(state, 'H1-finish:B-turn-bet-50');
        }
      }
      const cChips = takeExactLargeFirst(state.seats.find((s) => s.playerId === 'C')!.stack, 50);
      if (cChips !== null) {
        const r3 = applyAction(state, 'C', { type: 'call', chips: cChips });
        if (r3.ok) {
          state = r3.state;
          assertDrillHandInvariants(state, 'H1-finish:C-turn-call-50');
        }
      }
      const r4 = applyAction(state, 'A', { type: 'fold' });
      if (r4.ok) {
        state = r4.state;
        assertDrillHandInvariants(state, 'H1-finish:A-turn-fold');
      }
    }
    // River: B bet 50, C call 50
    if (state.phase === 'betting' && state.street === 'river' && state.activePlayerId === 'B') {
      const bChips = takeExactLargeFirst(state.seats.find((s) => s.playerId === 'B')!.stack, 50);
      if (bChips !== null) {
        const r5 = applyAction(state, 'B', { type: 'bet', amount: 50, chips: bChips });
        if (r5.ok) {
          state = r5.state;
          assertDrillHandInvariants(state, 'H1-finish:B-river-bet-50');
        }
      }
      const cChips = takeExactLargeFirst(state.seats.find((s) => s.playerId === 'C')!.stack, 50);
      if (cChips !== null) {
        const r6 = applyAction(state, 'C', { type: 'call', chips: cChips });
        if (r6.ok) {
          state = r6.state;
          assertDrillHandInvariants(state, 'H1-finish:C-river-call-50');
        }
      }
    }
  } else if (spot.fixtureId === 'h1-step13' && heroAction.type === 'call') {
    if (state.phase === 'betting' && state.activePlayerId === 'A') {
      const r4 = applyAction(state, 'A', { type: 'fold' });
      if (r4.ok) {
        state = r4.state;
        assertDrillHandInvariants(state, 'H1-13-finish:A-turn-fold');
      }
    }
    if (state.phase === 'betting' && state.street === 'river' && state.activePlayerId === 'B') {
      const bChips = takeExactLargeFirst(state.seats.find((s) => s.playerId === 'B')!.stack, 50);
      if (bChips !== null) {
        const r5 = applyAction(state, 'B', { type: 'bet', amount: 50, chips: bChips });
        if (r5.ok) {
          state = r5.state;
          assertDrillHandInvariants(state, 'H1-13-finish:B-river-bet-50');
        }
      }
      const cChips = takeExactLargeFirst(state.seats.find((s) => s.playerId === 'C')!.stack, 50);
      if (cChips !== null) {
        const r6 = applyAction(state, 'C', { type: 'call', chips: cChips });
        if (r6.ok) {
          state = r6.state;
          assertDrillHandInvariants(state, 'H1-13-finish:C-river-call-50');
        }
      }
    }
  }

  // General engine loop to finish any remaining betting streets
  let stepGuard = 0;
  while (state.phase === 'betting' && state.activePlayerId !== null) {
    stepGuard += 1;
    if (stepGuard > 100) {
      break;
    }

    const actorId = state.activePlayerId;
    if (actorId === spot.heroId) {
      const legal = getLegalActions(state);
      if (legal === null) {
        break;
      }
      let nextHeroAction: BettingAction = { type: 'fold' };
      if (legal.canCheck) {
        nextHeroAction = { type: 'check' };
      } else if (legal.canCall && legal.callAmount !== null && legal.callAmount > 0) {
        const heroSeat = state.seats.find((s) => s.playerId === spot.heroId)!;
        let callChips = takeExactLargeFirst(heroSeat.stack, legal.callAmount);
        if (callChips === null) {
          const exOptions = findAvailableChipExchanges(state, spot.heroId);
          if (exOptions.length > 0) {
            const exRes = exchangeHandChips(state, {
              fromPlayerId: spot.heroId,
              target: exOptions[0]!.target,
              give: exOptions[0]!.give,
              receive: exOptions[0]!.receive,
            });
            if (exRes.ok) {
              state = exRes.state;
              assertDrillHandInvariants(state, `finish:heroExchange:${stepGuard}`);
              const updatedHeroSeat = state.seats.find((s) => s.playerId === spot.heroId)!;
              callChips = takeExactLargeFirst(updatedHeroSeat.stack, legal.callAmount);
            }
          }
        }
        if (callChips !== null && spot.solution.effectiveEquity >= 0.22) {
          nextHeroAction = { type: 'call', chips: callChips };
        }
      }
      const hRes = applyAction(state, spot.heroId, nextHeroAction);
      if (!hRes.ok) {
        const fb = applyAction(state, spot.heroId, legal.canCheck ? { type: 'check' } : { type: 'fold' });
        if (!fb.ok) {
          break;
        }
        state = fb.state;
      } else {
        state = hRes.state;
      }
      assertDrillHandInvariants(state, `finish:heroAuto:${stepGuard}`);
    } else {
      const rivalId = spot.seatRivalIds[actorId] ?? 'cao';
      const dto = buildRivalDecisionInput(state, actorId, {
        rivalId,
        tiltState: rivalId === 'nong' ? spot.nongTiltState : undefined,
      });
      const decision = decideRivalAction(dto, rng.fork(`finish-rival:${stepGuard}:${actorId}`));
      const rRes = applyAction(state, actorId, decision.action);
      if (!rRes.ok) {
        const fb = applyAction(
          state,
          actorId,
          (dto.legalActions?.canCheck ?? false) ? { type: 'check' } : { type: 'fold' },
        );
        if (!fb.ok) {
          break;
        }
        state = fb.state;
      } else {
        state = rRes.state;
      }
      assertDrillHandInvariants(state, `finish:rival:${stepGuard}:${actorId}`);
    }
  }

  state = autoSettlePendingPayoutIfNeeded(state);
  assertDrillHandInvariants(state, 'completeDrillHand:final');

  // Evaluate hero's chosen action against frozen decision-time solution
  const { solution, snapshot } = spot;
  const heroActionLabelVi = formatActionVi(heroAction, snapshot.heroStreetContribution);

  const matchingOption =
    solution.actionEvs.options.find(
      (o) =>
        o.actionType === heroAction.type &&
        (heroAction.type === 'bet'
          ? o.amount === heroAction.amount
          : heroAction.type === 'raise'
            ? o.amount === heroAction.raiseTo
            : true),
    ) ??
    solution.actionEvs.options.find((o) => o.actionType === heroAction.type);

  let chosenActionEv = matchingOption?.ev ?? 0;
  if (matchingOption === undefined) {
    if (heroAction.type === 'bet' || heroAction.type === 'raise') {
      const sameType = solution.actionEvs.options.filter((o) => o.actionType === heroAction.type);
      if (sameType.length > 0) {
        chosenActionEv = sameType[0]!.ev;
      }
    }
  }

  const bestActionEv = solution.actionEvs.bestOption.ev;
  const rawEvLoss = Math.max(0, bestActionEv - chosenActionEv);
  const isRecommendedType = solution.actionEvs.recommendedActions.includes(heroAction.type);
  const evLoss = isRecommendedType && rawEvLoss < 2.5 ? 0 : Number(rawEvLoss.toFixed(2));
  const isDecisionCorrect = isRecommendedType || evLoss <= 0.5;
  const isGoodDecision = isDecisionCorrect;

  // Compare with hand outcome
  const heroFinalSeat = state.seats.find((s) => s.playerId === spot.heroId)!;
  const heroFinalContribution = heroFinalSeat.totalContribution;
  let heroPayout = 0;
  const winnerIdSet = new Set<string>();

  for (const transfer of state.settledTransfers) {
    if (transfer.amount > 0) {
      winnerIdSet.add(transfer.playerId);
    }
    if (transfer.playerId === spot.heroId) {
      heroPayout += transfer.amount;
    }
  }
  if (state.outcome?.kind === 'fold-win') {
    winnerIdSet.add(state.outcome.winnerId);
  } else if (state.outcome?.kind === 'showdown') {
    for (const potAward of state.outcome.resolution.potAwards) {
      for (const award of potAward.awards) {
        if (award.amount > 0) {
          winnerIdSet.add(award.playerId);
        }
      }
    }
  }

  const heroNetChipDelta = heroPayout - heroFinalContribution;
  const heroWonHand = heroPayout > heroFinalContribution || (heroPayout > 0 && winnerIdSet.has(spot.heroId));
  const winnerIds = Object.freeze(Array.from(winnerIdSet));

  // Build D6 decision-vs-outcome badges
  let decisionVsOutcomeBadgeVi: string;
  let streetDecisionBadgeVi: string;

  if (isGoodDecision && !heroWonHand) {
    decisionVsOutcomeBadgeVi = 'Quyết định: Tốt — thua do river';
    streetDecisionBadgeVi = `Quyết định ${snapshot.street}: Tốt — thua vì river`;
  } else if (isGoodDecision && heroWonHand) {
    decisionVsOutcomeBadgeVi = 'Quyết định: Tốt — thắng pot';
    streetDecisionBadgeVi = `Quyết định ${snapshot.street}: Tốt — thắng pot`;
  } else if (!isGoodDecision && heroWonHand) {
    decisionVsOutcomeBadgeVi = 'Quyết định: Sai (-EV) — thắng nhờ river';
    streetDecisionBadgeVi = `Quyết định ${snapshot.street}: Chưa tối ưu — thắng nhờ may mắn ở river`;
  } else {
    decisionVsOutcomeBadgeVi = 'Quyết định: Chưa tối ưu (-EV) — thua pot';
    streetDecisionBadgeVi = `Quyết định ${snapshot.street}: Chưa tối ưu — cần đối chiếu lại pot odds & equity`;
  }

  const independenceReminderVi = `Kết quả ván: ${heroWonHand ? 'thắng' : 'thua'} — không ảnh hưởng điểm quyết định`;

  const oneLineSummaryVi = `${isDecisionCorrect ? 'Đúng hướng (+EV)' : 'Chưa tối ưu'}: Bạn chọn ${heroActionLabelVi} (EV ${chosenActionEv >= 0 ? '+' : ''}${chosenActionEv.toFixed(1)} chip; khuyến nghị ${solution.actionEvs.bestOption.labelVi} với Equity ${formatPctVi(solution.effectiveEquity, 1)} vs Pot odds ${formatPctVi(solution.potOdds.requiredEquity, 1)}).`;

  const improvingCount = solution.improvementAnalysis?.categoryImprovingCards.length ?? 0;
  const improvingCardsLineVi =
    solution.outsQuestionKind === 'improvement-outs'
      ? `Lá cải thiện bài: ${solution.expectedOutsLabelVi} — có ${solution.expectedOuts} lá (${solution.expectedOutsCards.map(formatCard).join(', ')}) giúp cải thiện trực tiếp mục tiêu; tổng số lá nâng hạng bài 5 lá là ${improvingCount} lá.`
      : `Lá cải thiện bài: Có ${improvingCount} lá nâng cấp hạng bài 5 lá của bạn (tách biệt với số outs thật sự giúp thắng đối thủ).`;

  const outsLineVi =
    solution.outsQuestionKind === 'improvement-outs'
      ? `Outs & phân loại theo range: ${solution.expectedOutsExplanationVi} Trước range của ${spot.rivalSeats[spot.primaryRivalPlayerId]?.name ?? spot.primaryRivalId}: Clean outs = ${solution.cleanOutCards.length} lá (${solution.cleanOutCards.map(formatCard).join(', ') || '0'}), Mixed/Dirty outs = ${solution.mixedOutCards.length} lá (${solution.mixedOutCards.map(formatCard).join(', ') || '0'}), Chop outs = ${solution.chopOutCards.length} lá.`
      : `Outs thắng trước range: Clean outs = ${solution.expectedOuts} lá (${solution.cleanOutCards.map(formatCard).join(', ') || 'không có'}) · Mixed/Dirty outs = ${solution.mixedOutCards.length} lá (${solution.mixedOutCards.map(formatCard).join(', ') || 'không có'}) · Chop outs = ${solution.chopOutCards.length} lá (${solution.chopOutCards.map(formatCard).join(', ') || 'không có'}) · Chỉ cải thiện hạng bài = ${solution.improvementOnlyCards.length} lá.`;

  const hitProbabilitiesLineVi =
    snapshot.street === 'flop'
      ? `% trúng: 1 lá ở Turn = ${solution.expectedOuts}/${solution.unseenCards} = ${formatPctVi(solution.nextCardExactProbability)} (Rule of 2: ${solution.ruleOf2Percent ?? 0}%) · Tới River (2 lá) = 1 − C(${solution.unseenCards}−${solution.expectedOuts},2)/C(${solution.unseenCards},2) = ${formatPctVi(solution.toRiverExactProbability)} (Rule of 4: ${solution.ruleOf4Percent ?? 0}%${solution.expectedOuts > 8 ? `, bản chỉnh >8 outs: ${solution.ruleOf4AdjustedPercent ?? 0}%` : ''}). ${solution.improvementVsWinEquityNoteVi}`
      : snapshot.street === 'turn'
        ? `% trúng tới River (1 lá): ${solution.expectedOuts}/${solution.unseenCards} = ${formatPctVi(solution.nextCardExactProbability)} (Rule of 2: ${solution.ruleOf2Percent ?? 0}%). ${solution.improvementVsWinEquityNoteVi}`
        : `% trúng: Đã ở ${snapshot.street.toUpperCase()} (${solution.unseenCards} lá chưa biết, 0 lá sắp lật).`;

  const equityVsRangeLineVi = `Equity trước range đối thủ: ${formatPctVi(solution.effectiveEquity, 1)} (Thắng ${formatPctVi(solution.equityResult.winRate, 1)} · Chia hòa ${formatPctVi(solution.equityResult.tieEquityShare, 1)}). ${solution.contestingRanges.map((r) => r.descriptionVi).join(' ')}`;

  const potOddsLineVi = solution.potOdds.hasCall
    ? `Pot odds (Equity cần): ${snapshot.callAmount} / (${snapshot.potBeforeCall} + ${snapshot.callAmount}) = ${snapshot.callAmount}/${solution.potOdds.potAfterCall} = ${formatPctVi(solution.potOdds.requiredEquity, 1)} (tỷ lệ pot-to-call ${snapshot.potBeforeCall}/${snapshot.callAmount} = ${solution.potOdds.potToCallLabel}).`
    : `Pot odds: Không phải call (0 / ${snapshot.potBeforeCall} = 0%).`;

  const evAndClearSpotLineVi = `${solution.actionEvs.explanationVi} Chênh lệch |Equity − Equity cần| = ${solution.clearSpot.marginPp.toFixed(1).replace('.', ',')} điểm % (${solution.clearSpot.isClearSpot ? 'Spot rõ ràng > 5 điểm %' : 'Spot sát nút ≤ 5 điểm %, không tính phạt vào chỉ số spot rõ'}).`;

  const boardTextureLineVi = `${solution.boardTexture.explanationVi} ${solution.boardTexture.rivalRepresentationVi[spot.primaryRivalId]}`;

  const sizingLineVi = `${solution.sizingAnalysis.legalSizingVi} ${solution.sizingAnalysis.tacticalSizingVi} ${solution.sizingAnalysis.drawChaseAnalysis.explanationVi}`;

  const outcomeLineVi = `${decisionVsOutcomeBadgeVi} (${streetDecisionBadgeVi}). Người thắng pot: ${winnerIds.join(', ') || '—'} · Biến động chip của bạn: ${heroNetChipDelta >= 0 ? '+' : ''}${heroNetChipDelta} điểm. ${independenceReminderVi}.`;

  const postHandFeedback: DrillPostHandFeedback = Object.freeze({
    completedHandState: state,
    heroAction,
    heroActionLabelVi,
    chosenActionEv,
    bestActionEv,
    evLoss,
    isDecisionCorrect,
    isGoodDecision,
    heroWonHand,
    heroPayout,
    heroFinalContribution,
    heroNetChipDelta,
    winnerIds,
    decisionVsOutcomeBadgeVi,
    streetDecisionBadgeVi,
    independenceReminderVi,
    oneLineSummaryVi,
    breakdownVi: Object.freeze({
      improvingCardsLineVi,
      outsLineVi,
      hitProbabilitiesLineVi,
      equityVsRangeLineVi,
      potOddsLineVi,
      evAndClearSpotLineVi,
      boardTextureLineVi,
      sizingLineVi,
      assumptionsLinesVi: solution.assumptions.notesVi,
      outcomeLineVi,
    }),
  });

  return {
    ok: true,
    stateAfterHeroAction,
    completedState: state,
    postHandFeedback,
  };
}
