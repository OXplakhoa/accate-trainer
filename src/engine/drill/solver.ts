import {
  analyzeHandImprovements,
  analyzeOutsAgainstRange,
  assumptionsContextFromSnapshot,
  calculateBetOrRaiseEv,
  calculateCallEv,
  calculateCheckEv,
  calculateDrawProbabilities,
  calculateFoldEv,
  calculateMultiPotCallEv,
  calculatePotOdds,
  classifyClearSpot,
  createCategoryTargetGroup,
  createPocketPairSetTargetGroup,
  extractDecisionSnapshot,
  simulateEquity,
  unseenCardCountForStreet,
  type BetOrRaiseEvResult,
  type CallEvResult,
  type CheckEvResult,
  type DecisionSnapshot,
  type EquityResult,
  type HandImprovementAnalysis,
  type MultiPotCallEvResult,
  type MultiPotEvSliceInput,
  type OpponentRangeInput,
  type RangeOutsAnalysis,
} from '../calculator';
import { formatCard, type Card } from '../cards';
import { chipValue } from '../chips';
import { BET_STEP, type BettingAction, type HandState } from '../handTypes';
import type { Rng } from '../rng';
import {
  estimateRivalRange,
  getActiveBehaviorParams,
  getRivalSeatMetadata,
  inferPublicActionFromTimeline,
  projectTimelineEventToPublic,
  type NongTiltState,
  type PublicActionDescriptor,
  type PublicTimelineEvent,
  type RivalId,
  type RivalRangeEstimate,
  type RivalSeatMetadata,
} from '../rivals';
import { analyzeBetSizing, analyzeBoardTexture } from './analysis';
import type {
  DrillActionEvOption,
  DrillActionEvSummary,
  DrillConceptId,
  DrillFixtureId,
  DrillOutsQuestionKind,
  DrillSolutionAssumptions,
  DrillSpotSolution,
  Level1StepId,
  PotSliceEquityBreakdown,
} from './types';

const DEFAULT_DRILL_EQUITY_SAMPLES = 1_500;

function formatPctVi(ratio: number, decimals = 2): string {
  return `${(ratio * 100).toFixed(decimals).replace(/\.00$/, '').replace('.', ',')}%`;
}

function describePublicActionVi(action: PublicActionDescriptor | undefined): string {
  if (action === undefined) {
    return 'Còn trong ván (chưa hành động ở street này)';
  }
  const ootSuffix = action.fromOutOfTurn ? ' (hô sớm trước lượt)' : '';
  switch (action.type) {
    case 'check':
      return `Check${ootSuffix}`;
    case 'call':
      return `Call${ootSuffix}`;
    case 'bet':
      return `Bet ${action.amount ?? ''}`.trim() + ootSuffix;
    case 'raise':
      return (
        `${action.isCheckRaise ? 'Check-raise' : 'Raise'} lên ${action.raiseTo ?? ''}`.trim() +
        ootSuffix
      );
    case 'fold':
      return 'Fold';
  }
}

export function extractPublicTimelineForState(state: HandState): readonly PublicTimelineEvent[] {
  const publicTimeline: PublicTimelineEvent[] = [];
  for (const event of state.timeline) {
    const projected = projectTimelineEventToPublic(event, state.street);
    if (projected !== null) {
      publicTimeline.push(projected);
    }
  }
  return Object.freeze(publicTimeline);
}

/**
 * Determines the primary rival driving the action at hero's turn (e.g. the last bettor/raiser
 * on the current street, or the last actor on an earlier street, or the first non-folded rival).
 */
export function findPrimaryRivalSeat(
  state: HandState,
  heroId: string,
  publicTimeline: readonly PublicTimelineEvent[],
): { readonly playerId: string; readonly seatIndex: number } {
  const contestingSeats = state.seats.filter(
    (s) => s.playerId !== heroId && s.status !== 'folded',
  );
  if (contestingSeats.length === 0) {
    const fallback = state.seats.find((s) => s.playerId !== heroId) ?? state.seats[0]!;
    return { playerId: fallback.playerId, seatIndex: fallback.seatIndex };
  }
  const contestingIds = new Set(contestingSeats.map((s) => s.playerId));

  // 1. Prefer the last player who bet or raised on the current street
  for (let i = publicTimeline.length - 1; i >= 0; i--) {
    const ev = publicTimeline[i]!;
    if (
      ev.type === 'player-action' &&
      ev.street === state.street &&
      contestingIds.has(ev.playerId) &&
      (ev.action.type === 'bet' || ev.action.type === 'raise')
    ) {
      const seat = contestingSeats.find((s) => s.playerId === ev.playerId)!;
      return { playerId: seat.playerId, seatIndex: seat.seatIndex };
    }
  }

  // 2. Otherwise prefer any non-folded opponent with a flush/active bet or last action
  for (let i = publicTimeline.length - 1; i >= 0; i--) {
    const ev = publicTimeline[i]!;
    if (ev.type === 'player-action' && contestingIds.has(ev.playerId)) {
      const seat = contestingSeats.find((s) => s.playerId === ev.playerId)!;
      return { playerId: seat.playerId, seatIndex: seat.seatIndex };
    }
  }

  return {
    playerId: contestingSeats[0]!.playerId,
    seatIndex: contestingSeats[0]!.seatIndex,
  };
}

interface RawPotLevelSlice {
  readonly potBeforeCall: number;
  readonly heroAddedAmount: number;
  readonly heroEligible: boolean;
  readonly eligiblePlayerIds: readonly string[];
}

/**
 * Decomposes total contributions into main pot and side pot slices as they will stand
 * if hero puts in `callAmount`, tracking exact `potBeforeCall`, `heroAddedAmount`,
 * and `eligiblePlayerIds` per pot slice (spec §3.6, §5, AC P1, D5).
 *
 * Side pots are created ONLY by all-in players (`status === 'all-in'`) whose total contribution
 * is smaller than the full called level. Non-all-in players who have not matched `currentBet`
 * (e.g. players who checked before a bet/raise or have not acted yet) do not cap a side pot.
 */
function buildContestedPotSlicesForCall(
  state: HandState,
  heroId: string,
  callAmount: number,
  primaryRivalPlayerId: string,
): readonly RawPotLevelSlice[] {
  const heroSeat = state.seats.find((s) => s.playerId === heroId)!;
  const heroBefore = heroSeat.totalContribution;
  const heroAfter = heroBefore + callAmount;

  const entries = state.seats.map((s) => ({
    playerId: s.playerId,
    status: s.status,
    streetContribution: s.streetContribution,
    before: s.totalContribution,
    after: s.playerId === heroId ? heroAfter : s.totalContribution,
    folded: s.status === 'folded',
  }));

  const maxAfterLevel = entries.reduce((max, e) => Math.max(max, e.after), 0);

  // Side-pot boundary levels come only from all-in seats plus hero's called level and maxAfterLevel
  const levelSet = new Set<number>();
  for (const e of entries) {
    if (!e.folded && e.status === 'all-in' && e.after > 0) {
      levelSet.add(e.after);
    }
  }
  if (heroAfter > 0) {
    levelSet.add(heroAfter);
  }
  if (maxAfterLevel > 0) {
    levelSet.add(maxAfterLevel);
  }

  const positiveLevels = Array.from(levelSet).sort((a, b) => a - b);

  // Determine which non-folded opponents are actively contesting at the current bet
  const isOpponentContestingAtLevel = (
    e: (typeof entries)[number],
    level: number,
  ): boolean => {
    if (e.folded || e.playerId === heroId) {
      return false;
    }
    if (e.after < level) {
      return false;
    }
    if (e.status === 'all-in') {
      return true;
    }
    if (state.currentBet > 0) {
      return (
        e.streetContribution >= state.currentBet || e.playerId === primaryRivalPlayerId
      );
    }
    return true;
  };

  const merged: Array<{
    potBeforeCall: number;
    heroAddedAmount: number;
    heroEligible: boolean;
    eligiblePlayerIds: readonly string[];
  }> = [];

  let prevLevel = 0;
  for (let idx = 0; idx < positiveLevels.length; idx++) {
    const level = positiveLevels[idx]!;

    // How much existed in this [prevLevel, level] band across ALL seats (including dead/ante chips) BEFORE hero added callAmount:
    let sliceBeforeCall = 0;
    for (const entry of entries) {
      const beforeInBand = Math.max(0, Math.min(entry.before, level) - prevLevel);
      sliceBeforeCall += beforeInBand;
    }

    const heroAddedInBand = Math.max(
      0,
      Math.min(heroAfter, level) - Math.max(heroBefore, prevLevel),
    );

    if (sliceBeforeCall === 0 && heroAddedInBand === 0) {
      prevLevel = level;
      continue;
    }

    const heroEligible = heroAfter >= level;
    const contestingOpponents = entries
      .filter((e) => isOpponentContestingAtLevel(e, level))
      .map((e) => e.playerId);

    if (contestingOpponents.length === 0 && ! entries.some((e) => e.playerId !== heroId && !e.folded && e.after >= level)) {
      prevLevel = level;
      continue;
    }

    const fallbackOpponents =
      contestingOpponents.length > 0
        ? contestingOpponents
        : [primaryRivalPlayerId];

    const eligiblePlayerIds = heroEligible
      ? [...fallbackOpponents, heroId]
      : [...fallbackOpponents];

    const last = merged[merged.length - 1];
    const sameEligible =
      last !== undefined &&
      last.heroEligible === heroEligible &&
      last.eligiblePlayerIds.length === eligiblePlayerIds.length &&
      last.eligiblePlayerIds.every((id, i) => id === eligiblePlayerIds[i]);

    if (sameEligible && last !== undefined) {
      last.potBeforeCall += sliceBeforeCall;
      last.heroAddedAmount += heroAddedInBand;
    } else {
      merged.push({
        potBeforeCall: sliceBeforeCall,
        heroAddedAmount: heroAddedInBand,
        heroEligible,
        eligiblePlayerIds,
      });
    }

    prevLevel = level;
  }

  if (merged.length === 0) {
    return Object.freeze([
      {
        potBeforeCall: chipValue(state.pot),
        heroAddedAmount: callAmount,
        heroEligible: true,
        eligiblePlayerIds: [primaryRivalPlayerId, heroId],
      },
    ]);
  }

  return Object.freeze(merged);
}

function lectureRefForConcept(conceptId: DrillConceptId, fixtureId?: DrillFixtureId): string {
  if (fixtureId === 'd8-chase-draw') {
    return 'Hopkins L2 slide 18–20; L8 slide 18–23';
  }
  if (fixtureId === 'h1-step7') {
    return 'Hopkins L2 slide 24–27; L7 slide 6';
  }
  switch (conceptId) {
    case 'outs':
      return 'Hopkins L2 slide 24–27';
    case 'hit-percent':
      return 'Hopkins L7 slide 6–9';
    case 'pot-odds':
      return 'Hopkins L2 slide 12–15; L7 slide 7–9';
    case 'ev-comparison':
      return 'Hopkins L2 slide 7–8, 10–11, 28–32';
    case 'rival-range':
      return 'Hopkins L5 slide 25, 41, 65; L8 slide 6, 8';
    case 'board-texture':
      return 'Hopkins L5 slide 5, 6–12, 23–25; L8 slide 18';
    case 'bet-sizing':
      return 'Hopkins L2 slide 18–20; L9 slide 13–22, 29–36';
  }
}

export interface BuildDrillSpotSolutionInput {
  readonly state: HandState;
  readonly heroId: string;
  readonly seatRivalIds: Readonly<Record<string, RivalId>>;
  readonly rivalSeats: Readonly<Record<string, RivalSeatMetadata>>;
  readonly nongTiltState?: NongTiltState;
  readonly rng: Rng;
  readonly conceptId: DrillConceptId;
  readonly outsQuestionKind?: DrillOutsQuestionKind;
  readonly fixtureId?: DrillFixtureId;
  readonly equitySamples?: number;
}

/**
 * Builds the frozen decision-time solution for a drill spot using ONLY hero's hole cards
 * and public table information (spec §5, §6, AC D1–D8).
 */
export function buildDrillSpotSolution(input: BuildDrillSpotSolutionInput): {
  readonly snapshot: DecisionSnapshot;
  readonly publicTimeline: readonly PublicTimelineEvent[];
  readonly primaryRivalId: RivalId;
  readonly primaryRivalPlayerId: string;
  readonly contestingRivalIds: readonly RivalId[];
  readonly solution: DrillSpotSolution;
} {
  const {
    state,
    heroId,
    seatRivalIds,
    rivalSeats,
    nongTiltState,
    rng,
    conceptId,
    fixtureId,
    equitySamples = DEFAULT_DRILL_EQUITY_SAMPLES,
  } = input;

  const snapshot = extractDecisionSnapshot(state, heroId);
  const publicTimeline = extractPublicTimelineForState(state);
  const assumptionsCtx = assumptionsContextFromSnapshot(snapshot);


  const contestingSeats = state.seats.filter(
    (s) => s.playerId !== heroId && s.status !== 'folded',
  );
  const primarySeatInfo = findPrimaryRivalSeat(state, heroId, publicTimeline);
  const primaryRivalPlayerId = primarySeatInfo.playerId;
  const primaryRivalId: RivalId = seatRivalIds[primaryRivalPlayerId] ?? 'dien';

  // Estimate ranges for all non-folded rivals from their public actions
  const rangeByPlayerId = new Map<string, RivalRangeEstimate>();
  const publicActionByPlayerId = new Map<string, PublicActionDescriptor | undefined>();
  const contestingRanges: RivalRangeEstimate[] = [];
  const contestingRivalIds: RivalId[] = [];

  for (const seat of contestingSeats) {
    const rivalId = seatRivalIds[seat.playerId] ?? 'cao';
    if (!contestingRivalIds.includes(rivalId)) {
      contestingRivalIds.push(rivalId);
    }
    const inferredAction = inferPublicActionFromTimeline(
      publicTimeline,
      seat.playerId,
      state.street,
    );
    publicActionByPlayerId.set(seat.playerId, inferredAction);

    const estimate = estimateRivalRange({
      rivalId,
      playerId: seat.playerId,
      board: snapshot.board,
      street: snapshot.street,
      streetCap: snapshot.streetCap,
      action: inferredAction,
      publicTimeline,
      tiltState: rivalId === 'nong' ? nongTiltState : undefined,
      blockers: [...snapshot.heroCards, ...snapshot.board],
      context: {
        opponentCount: snapshot.activeOpponentCount,
        stackValue: chipValue(seat.stack),
        potValue: snapshot.potBeforeCall,
        positionLabelVi: snapshot.position.label,
        streetCap: snapshot.streetCap,
      },
    });

    rangeByPlayerId.set(seat.playerId, estimate);
    contestingRanges.push(estimate);
  }

  // Build OpponentRangeInput for each contesting seat
  const toOpponentRangeInput = (playerId: string): OpponentRangeInput => {
    const est = rangeByPlayerId.get(playerId)!;
    return {
      opponentId: playerId,
      label: `${est.name} (${est.styleLabel})`,
      combos: est.combos,
    };
  };

  // Compute multi-pot equity split across eligible pots
  const rawSlices = buildContestedPotSlicesForCall(
    state,
    heroId,
    snapshot.callAmount,
    primaryRivalPlayerId,
  );
  const eligibleBeforeCall = rawSlices.filter((slice) => slice.heroEligible).reduce((sum, slice) => sum + slice.potBeforeCall, 0);
  const potOdds = calculatePotOdds({ potBeforeCall: eligibleBeforeCall, callAmount: snapshot.callAmount });
  const perPotEquity: PotSliceEquityBreakdown[] = [];
  const multiPotEvInputs: MultiPotEvSliceInput[] = [];
  let mainEquityResult: EquityResult | null = null;
  let weightedEquityNumerator = 0;
  let weightedEquityDenominator = 0;

  for (let i = 0; i < rawSlices.length; i++) {
    const raw = rawSlices[i]!;
    const potId = i === 0 ? 'main' : `side-${i}`;
    const eligibleOpponentIds = raw.eligiblePlayerIds.filter((id) => id !== heroId);
    const labelVi =
      i === 0
        ? `Main pot (${raw.eligiblePlayerIds.join(', ')})`
        : `Side pot ${i} (${raw.eligiblePlayerIds.join(', ')})`;
    const potAfterCall = raw.potBeforeCall + raw.heroAddedAmount;

    if (!raw.heroEligible || eligibleOpponentIds.length === 0) {
      perPotEquity.push(
        Object.freeze({
          potId,
          labelVi,
          potBeforeCall: raw.potBeforeCall,
          heroAddedAmount: 0,
          potAfterCall: raw.potBeforeCall,
          heroEligible: false,
          eligibleOpponentIds: Object.freeze(eligibleOpponentIds),
          heroEquity: null,
          expectedReturn: 0,
        }),
      );
      multiPotEvInputs.push({
        potId,
        label: labelVi,
        potBeforeCall: raw.potBeforeCall,
        heroAddedAmount: 0,
        heroEligible: false,
      });
      continue;
    }

    const sliceOpponentRanges = eligibleOpponentIds
      .filter((id) => rangeByPlayerId.has(id))
      .map(toOpponentRangeInput);

    const eqRes = simulateEquity({
      heroCards: snapshot.heroCards,
      board: snapshot.board,
      opponentRanges:
        sliceOpponentRanges.length > 0
          ? sliceOpponentRanges
          : [toOpponentRangeInput(primaryRivalPlayerId)],
      rng: rng.fork(`pot-equity:${i}`),
      samples: equitySamples,
      assumptionsContext: assumptionsCtx,
    });

    if (mainEquityResult === null) {
      mainEquityResult = eqRes;
    }

    const sliceEquity = eqRes.equity;
    const expectedReturn = sliceEquity * potAfterCall;
    weightedEquityNumerator += expectedReturn;
    weightedEquityDenominator += potAfterCall;

    perPotEquity.push(
      Object.freeze({
        potId,
        labelVi,
        potBeforeCall: raw.potBeforeCall,
        heroAddedAmount: raw.heroAddedAmount,
        potAfterCall,
        heroEligible: true,
        eligibleOpponentIds: Object.freeze(eligibleOpponentIds),
        heroEquity: sliceEquity,
        expectedReturn,
      }),
    );

    multiPotEvInputs.push({
      potId,
      label: labelVi,
      potBeforeCall: raw.potBeforeCall,
      heroAddedAmount: raw.heroAddedAmount,
      heroEligible: true,
      heroEquity: sliceEquity,
    });
  }

  // Fallback equity result if no eligible slice had opponents
  if (mainEquityResult === null) {
    const allOppRanges = contestingSeats.map((s) => toOpponentRangeInput(s.playerId));
    mainEquityResult = simulateEquity({
      heroCards: snapshot.heroCards,
      board: snapshot.board,
      opponentRanges: allOppRanges,
      rng: rng.fork('pot-equity:fallback'),
      samples: equitySamples,
      assumptionsContext: assumptionsCtx,
    });
  }

  const effectiveEquity =
    weightedEquityDenominator > 0
      ? weightedEquityNumerator / weightedEquityDenominator
      : mainEquityResult.equity;
  const effectiveEquityPercent = effectiveEquity * 100;

  // Outs & hand improvement analysis (postflop: flop and turn)
  const isPocketPair = snapshot.heroCards[0].rank === snapshot.heroCards[1].rank;
  const defaultOutsQuestionKind: DrillOutsQuestionKind =
    input.outsQuestionKind ??
    (fixtureId === 'h1-step7'
      ? 'improvement-outs'
      : 'clean-outs-vs-range');

  let improvementAnalysis: HandImprovementAnalysis | null = null;
  let rangeOutsAnalysis: RangeOutsAnalysis | null = null;

  if (snapshot.street !== 'preflop') {
    const targetGroups = isPocketPair
      ? [
          createPocketPairSetTargetGroup(
            snapshot.heroCards,
            'pocket-pair-set',
            `Lên set ${formatCard(snapshot.heroCards[0])[0]}`,
          ),
          createCategoryTargetGroup('two-pair', 'Lên hai đôi', 'two-pair'),
        ]
      : [
          createCategoryTargetGroup('flush', 'Lên thùng (Flush)', 'flush'),
          createCategoryTargetGroup('straight', 'Lên sảnh (Straight)', 'straight'),
        ];

    improvementAnalysis = analyzeHandImprovements({
      heroCards: snapshot.heroCards,
      board: snapshot.board,
      targetGroups,
    });

    const primaryRange = rangeByPlayerId.get(primaryRivalPlayerId) ?? contestingRanges[0]!;
    rangeOutsAnalysis = analyzeOutsAgainstRange({
      heroCards: snapshot.heroCards,
      board: snapshot.board,
      opponentRange: {
        opponentId: primaryRivalPlayerId,
        label: `${primaryRange.name} (${primaryRange.styleLabel})`,
        combos: primaryRange.combos,
      },
      assumptionsContext: assumptionsCtx,
    });
  }

  const unseenCards =
    improvementAnalysis?.unseenCardCount ?? unseenCardCountForStreet(snapshot.street);
  const cardsRemainingToRiver: 0 | 1 | 2 =
    snapshot.street === 'flop' ? 2 : snapshot.street === 'turn' ? 1 : 0;

  let expectedOuts = 0;
  let expectedOutsCards: readonly Card[] = Object.freeze([]);
  let expectedOutsLabelVi = 'Không còn lá cần rút';
  let expectedOutsExplanationVi = '';

  const cleanOutCards = Object.freeze(
    rangeOutsAnalysis !== null ? rangeOutsAnalysis.cleanOuts.map((c) => c.card) : [],
  );
  const mixedOutCards = Object.freeze(
    rangeOutsAnalysis !== null ? rangeOutsAnalysis.mixedOuts.map((c) => c.card) : [],
  );
  const chopOutCards = Object.freeze(
    rangeOutsAnalysis !== null ? rangeOutsAnalysis.chopOuts.map((c) => c.card) : [],
  );
  const improvementOnlyCards = Object.freeze(
    rangeOutsAnalysis !== null ? rangeOutsAnalysis.improvementOnlyCards.map((c) => c.card) : [],
  );

  if (snapshot.street === 'flop' || snapshot.street === 'turn') {
    if (defaultOutsQuestionKind === 'improvement-outs' && isPocketPair && improvementAnalysis !== null) {
      const setGroup = improvementAnalysis.targetGroups.find((g) => g.id === 'pocket-pair-set');
      expectedOuts = setGroup?.count ?? 2;
      expectedOutsCards = setGroup?.cards ?? Object.freeze([]);
      const rankChar = formatCard(snapshot.heroCards[0])[0]!;
      const cardsList = expectedOutsCards.map(formatCard).join(', ');
      expectedOutsLabelVi = `Lá giúp đôi ${rankChar}-${rankChar} lên set (${expectedOuts} lá: ${cardsList})`;
      expectedOutsExplanationVi = `Đôi tay ${formatCard(snapshot.heroCards[0])} ${formatCard(snapshot.heroCards[1])} có ${expectedOuts} lá giúp lên set là ${cardsList} trong ${unseenCards} lá chưa biết. Lưu ý: nếu mặt bài có 2 lá đồng chất (như 9♥ 7♥), lá ${rankChar}♥ giúp lên set nhưng là mixed/dirty out trước các combo mua thùng cơ của đối thủ.`;
    } else if (rangeOutsAnalysis !== null) {
      expectedOuts = rangeOutsAnalysis.cleanOuts.length;
      expectedOutsCards = cleanOutCards;
      const cleanList =
        cleanOutCards.length > 0 ? cleanOutCards.map(formatCard).join(', ') : 'không có';
      const mixedList =
        mixedOutCards.length > 0 ? mixedOutCards.map(formatCard).join(', ') : 'không có';
      const chopList =
        chopOutCards.length > 0 ? chopOutCards.map(formatCard).join(', ') : 'không có';
      expectedOutsLabelVi = `Clean outs thắng sạch trước range giả định (${expectedOuts} lá)`;
      expectedOutsExplanationVi = `Đếm clean outs trước range đã nêu của ${rangeByPlayerId.get(primaryRivalPlayerId)?.name ?? primaryRivalId}: có ${expectedOuts} clean outs (${cleanList}). Tách riêng: ${mixedOutCards.length} mixed/dirty outs (${mixedList}), ${chopOutCards.length} chop outs (${chopList}) và ${improvementOnlyCards.length} lá chỉ cải thiện hạng bài nhưng chưa lật thế thắng sạch.`;
    }
  } else {
    expectedOutsExplanationVi =
      snapshot.street === 'river'
        ? 'Ở river cả 5 lá chung đã lật đủ (0 lá sắp ra), nên số outs cần đếm = 0; quyết định dựa trực tiếp vào equity hiện tại trước range đối thủ.'
        : 'Ở preflop chưa có lá chung nên tính trực tiếp equity bằng mô phỏng Monte Carlo.';
  }

  const drawProbs =
    snapshot.street === 'preflop'
      ? {
          nextCardExact: 0,
          toRiverExact: 0,
          ruleOf2: null,
          ruleOf4: null,
          ruleOf4Adjusted: null,
        }
      : calculateDrawProbabilities({
          outs: expectedOuts,
          street: snapshot.street,
          unseenCards,
        });

  const nextCardExactProbability = drawProbs.nextCardExact;
  const nextCardExactPercent = nextCardExactProbability * 100;
  const toRiverExactProbability =
    snapshot.street === 'turn' ? drawProbs.nextCardExact : drawProbs.toRiverExact;
  const toRiverExactPercent = toRiverExactProbability * 100;
  const ruleOf2Percent = drawProbs.ruleOf2 !== null ? drawProbs.ruleOf2.probability * 100 : null;
  const ruleOf4Percent =
    snapshot.street === 'flop' && drawProbs.ruleOf4 !== null
      ? drawProbs.ruleOf4.probability * 100
      : ruleOf2Percent;
  const ruleOf4AdjustedPercent =
    snapshot.street === 'flop' && drawProbs.ruleOf4Adjusted !== null
      ? drawProbs.ruleOf4Adjusted.probability * 100
      : ruleOf4Percent;

  const improvementVsWinEquityNoteVi =
    defaultOutsQuestionKind === 'improvement-outs'
      ? `Con số ${formatPctVi(toRiverExactProbability)} (turn ${formatPctVi(nextCardExactProbability)}, Rule of 4: ${ruleOf4Percent ?? 0}%) là xác suất gặp thêm lá cải thiện (${expectedOutsLabelVi}), KHÔNG phải xác suất thắng. Equity thực tế của bạn trước range của ${rangeByPlayerId.get(primaryRivalPlayerId)?.name ?? 'đối thủ'} là ${formatPctVi(effectiveEquity, 1)} (tính riêng kèm giả định range).`
      : `Xác suất trúng clean outs tới river là ${formatPctVi(toRiverExactProbability)} (1 lá tiếp theo: ${formatPctVi(nextCardExactProbability)}), khác với tổng equity showdown ${formatPctVi(effectiveEquity, 1)} trước toàn bộ range đối thủ (vì bạn còn có thể thắng bằng bài hiện tại hoặc chia/thắng một phần range khi ra mixed outs).`;

  // Board texture and sizing analysis
  const boardTexture = analyzeBoardTexture(snapshot.board);
  const sizingAnalysis = analyzeBetSizing(snapshot, effectiveEquity, potOdds);

  // Clear spot classification (strict > 5 percentage points threshold)
  const classification = classifyClearSpot(effectiveEquity, potOdds.requiredEquity);
  const clearSpot = potOdds.hasCall ? classification : Object.freeze({
    ...classification, isClearSpot: false, countsTowardClearSpotMetric: false, recommendedAction: 'marginal' as const,
  });

  // Action EV calculations
  const foldEv = calculateFoldEv(assumptionsCtx);
  let callEv: CallEvResult | null = null;
  let multiPotCallEv: MultiPotCallEvResult | null = null;
  let checkEv: CheckEvResult | null = null;
  const aggressiveEvs: BetOrRaiseEvResult[] = [];
  const options: DrillActionEvOption[] = [];

  if (snapshot.legalActions?.canFold) {
    options.push({
      actionType: 'fold',
      amount: 0,
      labelVi: 'Fold',
      ev: foldEv.ev,
      precision: 'exact',
      detailVi: 'EV(Fold) = 0 chip (khoản đã bỏ trước đó là chi phí chìm).',
    });
  }

  if (snapshot.legalActions?.canCheck && snapshot.toCall === 0) {
    checkEv = calculateCheckEv({
      potBeforeAction: snapshot.potBeforeCall,
      equity: effectiveEquity,
      currentBet: snapshot.currentBet,
      heroStreetContribution: snapshot.heroStreetContribution,
      assumptionsContext: assumptionsCtx,
    });
    options.push({
      actionType: 'check',
      amount: 0,
      labelVi: 'Check',
      ev: checkEv.ev,
      precision: 'estimated',
      detailVi: `EV(Check) ≈ ${formatPctVi(effectiveEquity, 1)} × ${snapshot.potBeforeCall} = +${checkEv.ev.toFixed(1)} chip.`,
    });
  }

  if (snapshot.legalActions?.canCall && snapshot.callAmount > 0) {
    multiPotCallEv = calculateMultiPotCallEv({
      callAmount: snapshot.callAmount,
      pots: multiPotEvInputs,
      heroStack: snapshot.heroStack,
      heroStreetContribution: snapshot.heroStreetContribution,
      streetCap: snapshot.streetCap,
      assumptionsContext: assumptionsCtx,
    });

    callEv = calculateCallEv({
      potBeforeCall: multiPotCallEv.totalEligiblePotAfterCall - snapshot.callAmount,
      callAmount: snapshot.callAmount,
      equity: effectiveEquity,
      heroStack: snapshot.heroStack,
      heroStreetContribution: snapshot.heroStreetContribution,
      streetCap: snapshot.streetCap,
      assumptionsContext: assumptionsCtx,
    });

    const sign = multiPotCallEv.ev >= 0 ? '+' : '';
    options.push({
      actionType: 'call',
      amount: snapshot.callAmount,
      labelVi: `Call ${snapshot.callAmount}`,
      ev: multiPotCallEv.ev,
      precision: 'exact',
      detailVi: `EV(Call ${snapshot.callAmount}) = ${formatPctVi(effectiveEquity, 1)} × ${multiPotCallEv.totalEligiblePotAfterCall} − ${snapshot.callAmount} = ${sign}${multiPotCallEv.ev.toFixed(1)} chip.`,
    });
  }

  // Evaluate candidate bet or raise options when legal
  const primaryParams = getActiveBehaviorParams(
    primaryRivalId,
    primaryRivalId === 'nong' ? nongTiltState : undefined,
  );

  if (snapshot.legalActions?.canBet && snapshot.legalActions.betRange !== null) {
    const range = snapshot.legalActions.betRange;
    const candidateTargets = Array.from(
      new Set([
        range.min,
        Math.round(((range.min + range.max) / 2) / BET_STEP) * BET_STEP,
        range.max,
      ]),
    )
      .filter((t) => t >= range.min && t <= range.max)
      .sort((a, b) => a - b);

    for (const targetBet of candidateTargets) {
      const sizeRatio = targetBet / Math.max(snapshot.streetCap, 1);
      const foldProb = Math.min(
        0.75,
        Math.max(0.05, primaryParams.continueThreshold * 0.75 + sizeRatio * 0.18),
      );
      const canOppReraise = targetBet < snapshot.streetCap;
      const reraiseProb = canOppReraise
        ? Math.min(0.25, primaryParams.raiseVsBetFreq * 0.25)
        : 0;
      const callProb = Math.max(0, 1 - foldProb - reraiseProb);
      const equityWhenCalled = Math.max(0.05, Math.min(0.95, effectiveEquity * 0.96));

      const betEvRes = calculateBetOrRaiseEv({
        action: 'bet',
        street: snapshot.street,
        potBeforeAction: snapshot.potBeforeCall,
        currentBet: snapshot.currentBet,
        heroStreetContribution: snapshot.heroStreetContribution,
        targetBet,
        heroStack: snapshot.heroStack,
        streetCap: snapshot.streetCap,
        opponentResponse: {
          foldProbability: foldProb,
          callProbability: callProb,
          reraiseProbability: reraiseProb,
          equityWhenCalled,
          opponentAddedOnCall: targetBet * Math.max(1, snapshot.actingOpponentCount),
          ...(reraiseProb > 0
            ? {
                reraise: {
                  reraiseTo: snapshot.streetCap,
                  opponentAddedOnReraise: snapshot.streetCap,
                  heroResponse: effectiveEquity >= 0.45 ? 'call' : 'fold',
                  equityWhenReraised: Math.max(0.05, effectiveEquity * 0.85),
                },
              }
            : {}),
        },
        assumptionsContext: assumptionsCtx,
      });

      aggressiveEvs.push(betEvRes);
      const sign = betEvRes.ev >= 0 ? '+' : '';
      options.push({
        actionType: 'bet',
        amount: targetBet,
        labelVi: `Bet ${targetBet}`,
        ev: betEvRes.ev,
        precision: 'estimated',
        detailVi: `EV(Bet ${targetBet}) ≈ ${sign}${betEvRes.ev.toFixed(1)} chip (ước lượng với giả định fold ${(foldProb * 100).toFixed(0)}%, call ${(callProb * 100).toFixed(0)}%).`,
      });
    }
  }

  if (snapshot.legalActions?.canRaise && snapshot.legalActions.raiseRange !== null) {
    const range = snapshot.legalActions.raiseRange;
    const candidateTargets = Array.from(new Set([range.min, range.max])).sort((a, b) => a - b);

    for (const raiseTo of candidateTargets) {
      const foldProb = Math.min(0.85, Math.max(0.04, primaryParams.foldToRaiseFreq * 0.45));
      const callProb = 1 - foldProb;
      // When opponent calls a raise, their continuing range is tighter so hero's equity adjusts
      const equityWhenCalled = Math.max(0.05, Math.min(0.95, effectiveEquity * 0.88));
      const oppAdditional = Math.max(BET_STEP, raiseTo - snapshot.currentBet);

      const raiseEvRes = calculateBetOrRaiseEv({
        action: 'raise',
        street: snapshot.street,
        potBeforeAction: snapshot.potBeforeCall,
        currentBet: snapshot.currentBet,
        heroStreetContribution: snapshot.heroStreetContribution,
        targetBet: raiseTo,
        heroStack: snapshot.heroStack,
        streetCap: snapshot.streetCap,
        opponentResponse: {
          foldProbability: foldProb,
          callProbability: callProb,
          equityWhenCalled,
          opponentAddedOnCall: oppAdditional,
        },
        assumptionsContext: assumptionsCtx,
      });

      aggressiveEvs.push(raiseEvRes);
      const added = raiseTo - snapshot.heroStreetContribution;
      const sign = raiseEvRes.ev >= 0 ? '+' : '';
      options.push({
        actionType: 'raise',
        amount: raiseTo,
        labelVi: `Raise lên ${raiseTo} (+${added})`,
        ev: raiseEvRes.ev,
        precision: 'estimated',
        detailVi: `EV(Raise lên ${raiseTo}) ≈ ${sign}${raiseEvRes.ev.toFixed(1)} chip (ước lượng với giả định đối thủ fold ${(foldProb * 100).toFixed(0)}%, call ${(callProb * 100).toFixed(0)}%).`,
      });
    }
  }

  // Pick best option and recommended action types
  let bestOption: DrillActionEvOption = options[0]!;
  for (const opt of options) {
    if (opt.ev > bestOption.ev) {
      bestOption = opt;
    }
  }

  // When facing a bet (toCall > 0), ensure recommendedActions aligns with Call vs Fold EV and clearSpot
  const recommendedSet = new Set<BettingAction['type']>();
  if (snapshot.toCall > 0) {
    const callOpt = options.find((o) => o.actionType === 'call');
    if (callOpt !== undefined && callOpt.ev >= 0) {
      recommendedSet.add('call');
      // If equity is strong and raise EV is also positive and close/better, allow raise too
      const bestRaise = options
        .filter((o) => o.actionType === 'raise')
        .sort((a, b) => b.ev - a.ev)[0];
      if (bestRaise !== undefined && (bestRaise.ev >= callOpt.ev - 2 || effectiveEquity >= 0.58)) {
        recommendedSet.add('raise');
      }
      // For H1 #7 / clear positive call spots, prefer Call as the primary benchmark if Call EV > 0 and Raise is only an estimate
      if (fixtureId === 'h1-step7' || (effectiveEquity < 0.65 && callOpt.ev > 0)) {
        bestOption = callOpt;
      }
    } else {
      recommendedSet.add('fold');
      bestOption = options.find((o) => o.actionType === 'fold') ?? bestOption;
    }
    if (!clearSpot.isClearSpot && callOpt !== undefined) {
      // Marginal spot (|equity - requiredEquity| <= 5 pp): both call and fold are close
      recommendedSet.add('call');
      recommendedSet.add('fold');
    }
  } else {
    recommendedSet.add(bestOption.actionType);
    for (const opt of options) {
      if (Math.abs(opt.ev - bestOption.ev) <= 2.5) {
        recommendedSet.add(opt.actionType);
      }
    }
  }

  const recommendedActions = Object.freeze(Array.from(recommendedSet));
  const actionEvExplanationVi =
    snapshot.toCall > 0
      ? `So sánh EV tại điểm quyết định: ${options.map((o) => `${o.labelVi}: ${o.ev >= 0 ? '+' : ''}${o.ev.toFixed(1)} chip`).join(' · ')}. Equity của bạn (${formatPctVi(effectiveEquity, 1)}) ${effectiveEquity >= potOdds.requiredEquity ? 'lớn hơn' : 'nhỏ hơn'} pot odds cần thiết (${formatPctVi(potOdds.requiredEquity, 1)}) → khuyến nghị: ${recommendedActions.map((a) => a.toUpperCase()).join(' / ')}.`
      : `Không có lệnh bet trước mặt: ${options.map((o) => `${o.labelVi}: ${o.ev >= 0 ? '+' : ''}${o.ev.toFixed(1)} chip`).join(' · ')} → khuyến nghị: ${bestOption.labelVi}.`;

  const actionEvs: DrillActionEvSummary = Object.freeze({
    foldEv,
    callEv,
    multiPotCallEv,
    checkEv,
    aggressiveEvs: Object.freeze(aggressiveEvs),
    options: Object.freeze(options),
    bestOption,
    recommendedActions,
    explanationVi: actionEvExplanationVi,
  });

  // Build explicit structured assumptions (AC D5)
  const opponentStacks: Record<string, number> = {};
  for (const seat of state.seats) {
    if (seat.playerId !== heroId) {
      opponentStacks[seat.playerId] = chipValue(seat.stack);
    }
  }

  const rivalRangeSummaries = contestingSeats.map((seat) => {
    const est = rangeByPlayerId.get(seat.playerId)!;
    const totalWeight = est.combos.reduce((acc, c) => acc + c.weight, 0);
    return Object.freeze({
      playerId: seat.playerId,
      rivalId: est.rivalId,
      name: est.name,
      styleLabel: est.styleLabel,
      isTilted: est.isTilted,
      publicActionVi: describePublicActionVi(publicActionByPlayerId.get(seat.playerId)),
      comboCount: est.combos.length,
      totalWeight: Number(totalWeight.toFixed(2)),
      descriptionVi: est.descriptionVi,
    });
  });

  const notesVi: string[] = [
    `Street: ${snapshot.street.toUpperCase()} · Pot trước quyết định: ${snapshot.potBeforeCall} điểm · Cap street: ${snapshot.streetCap} điểm.`,
    `Stack Hero (${heroId}): ${snapshot.heroStack} điểm (đã góp trong street: ${snapshot.heroStreetContribution}, tổng góp cả ván: ${snapshot.heroTotalContribution}).`,
    `Số đối thủ còn tranh pot: ${snapshot.activeOpponentCount} (${contestingSeats.map((s) => `${s.playerId}=${rivalSeats[s.playerId]?.name ?? s.playerId}: stack ${chipValue(s.stack)}`).join(', ')}).`,
    ...(snapshot.currentBet > 0 ? ['Khi đối mặt cược, giả định những người chưa theo mức cược hiện tại sẽ không tiếp tục; người all-in vẫn tranh các phần pot đủ điều kiện. Không cộng thêm chip từ hành động tương lai.'] : ['Pot hiển thị gồm toàn bộ chip đã góp; equity xét những người còn tranh từng phần pot.']),
    `Vị trí & thứ tự lượt (người mở lời ván: ${snapshot.position.openerPlayerId}): ${snapshot.position.label ?? ''}.`,
    ...rivalRangeSummaries.map((r) => `Range ${r.name} (${r.playerId} — ${r.publicActionVi}): ${r.comboCount} combo hợp lệ — ${r.descriptionVi}`),
  ];

  if (perPotEquity.length > 1) {
    notesVi.push(
      `Chia equity theo ${perPotEquity.length} pot: ${perPotEquity.map((p) => `${p.labelVi} = ${p.potAfterCall} điểm (${p.heroEligible && p.heroEquity !== null ? `equity ${formatPctVi(p.heroEquity, 1)}` : 'không đủ điều kiện'})`).join('; ')}.`,
    );
  }

  const assumptions: DrillSolutionAssumptions = Object.freeze({
    street: snapshot.street,
    streetCap: snapshot.streetCap,
    potBeforeAction: snapshot.potBeforeCall,
    callAmount: snapshot.callAmount,
    heroStack: snapshot.heroStack,
    opponentStacks: Object.freeze(opponentStacks),
    opponentCount: snapshot.activeOpponentCount,
    contestingRivalIds: Object.freeze(contestingRivalIds),
    positionLabelVi: snapshot.position.label ?? 'Nói trong vòng',
    openerPlayerId: snapshot.position.openerPlayerId ?? state.openerPlayerId,
    playersToActBeforeHero: snapshot.position.playersToActBeforeHero ?? Object.freeze([]),
    playersToActAfterHero: snapshot.position.playersToActAfterHero ?? Object.freeze([]),
    rivalRanges: Object.freeze(rivalRangeSummaries),
    notesVi: Object.freeze(notesVi),
  });

  const primaryMeta =
    rivalSeats[primaryRivalPlayerId] ??
    getRivalSeatMetadata(primaryRivalId, primaryRivalId === 'nong' ? nongTiltState : undefined);

  const stepHintsVi: Readonly<Record<Level1StepId, string>> = Object.freeze({
    outs:
      defaultOutsQuestionKind === 'improvement-outs'
        ? `Gợi ý Bước 1 (Outs): Đếm số lá còn lại trong bộ bài giúp đôi ${formatCard(snapshot.heroCards[0])[0]} của bạn lên set (bộ bài có 4 lá mỗi hạng, bạn đang giữ 2 lá).`
        : `Gợi ý Bước 1 (Outs): Đếm các lá clean outs giúp bạn lật thế thắng sạch 100% trước range của ${primaryMeta.name} (${primaryMeta.styleLabel}), đã loại bỏ outs bẩn làm đối thủ mạnh hơn.`,
    'unseen-cards': `Gợi ý Bước 2 (Số lá chưa biết): Bộ bài 52 lá trừ 2 lá riêng của bạn và ${snapshot.board.length} lá chung đã lật trên bàn (52 − 2 − ${snapshot.board.length} = ${unseenCards}).`,
    'turn-percent': `Gợi ý Bước 3 (% trúng 1 lá tiếp theo): Lấy số outs chia cho ${unseenCards} lá chưa biết (${expectedOuts}/${unseenCards}), hoặc nhẩm nhanh bằng Rule of 2 (${expectedOuts} × 2% = ${expectedOuts * 2}%).`,
    'river-percent':
      snapshot.street === 'flop'
        ? `Gợi ý Bước 4 (% trúng tới river từ flop): Chính xác 1 − C(${unseenCards}−${expectedOuts}, 2)/C(${unseenCards}, 2), hoặc nhẩm bằng Rule of 4 (${expectedOuts} × 4%${expectedOuts > 8 ? ` − (${expectedOuts} − 8)%` : ''} = ${ruleOf4AdjustedPercent ?? expectedOuts * 4}%).`
        : `Gợi ý Bước 4 (% trúng tới river): Ở turn chỉ còn 1 lá river nên % tới river chính bằng % trúng 1 lá (${expectedOuts}/${unseenCards} ≈ ${ruleOf2Percent ?? 0}%).`,
    'pot-odds':
      snapshot.callAmount > 0
        ? `Gợi ý Bước 5 (Pot odds / Equity cần): Khoản phải call / (Pot hiện tại + Khoản phải call) = ${snapshot.callAmount} / (${potOdds.potBeforeCall} + ${snapshot.callAmount}) = ${snapshot.callAmount}/${potOdds.potAfterCall} (${potOdds.potToCallLabel}).`
        : 'Gợi ý Bước 5 (Pot odds): Chưa ai bet (khoản cần call = 0), nên equity cần để xem tiếp = 0%.',
    action: `Gợi ý Bước 6 (Hành động & Chip vật lý): Equity của bạn trước range ${primaryMeta.name} là ~${formatPctVi(effectiveEquity, 1)} so với pot odds ${formatPctVi(potOdds.requiredEquity, 1)}. Hãy bấm đúng mệnh giá chip vật lý (5/10/50/100) khớp khoản cược và xác nhận hành động.`,
  });

  const solution: DrillSpotSolution = Object.freeze({
    conceptId,
    outsQuestionKind: defaultOutsQuestionKind,
    expectedOuts,
    expectedOutsCards,
    expectedOutsLabelVi,
    expectedOutsExplanationVi,
    cleanOutCards,
    mixedOutCards,
    chopOutCards,
    improvementOnlyCards,
    unseenCards,
    cardsRemainingToRiver,
    nextCardExactProbability,
    nextCardExactPercent,
    toRiverExactProbability,
    toRiverExactPercent,
    ruleOf2Percent,
    ruleOf4Percent,
    ruleOf4AdjustedPercent,
    improvementVsWinEquityNoteVi,
    improvementAnalysis,
    rangeOutsAnalysis,
    potOdds,
    contestingRanges: Object.freeze(contestingRanges),
    perPotEquity: Object.freeze(perPotEquity),
    effectiveEquity,
    effectiveEquityPercent,
    equityResult: mainEquityResult,
    clearSpot,
    actionEvs,
    boardTexture,
    sizingAnalysis,
    assumptions,
    lectureRef: lectureRefForConcept(conceptId, fixtureId),
    stepHintsVi,
  });

  return {
    snapshot,
    publicTimeline,
    primaryRivalId,
    primaryRivalPlayerId,
    contestingRivalIds: Object.freeze(contestingRivalIds),
    solution,
  };
}
