import {
  assumptionsContextFromSnapshot,
  calculateBetOrRaiseEv,
  calculateCallEv,
  calculateCheckEv,
  calculateFoldEv,
  chipValue,
  classifyClearSpot,
  estimateRivalRange,
  projectTimelineEventToPublic,
  simulateEquity,
  type HandState,
  type NongTiltState,
  type OpponentRangeInput,
  type PublicTimelineEvent,
  type Rng,
} from '../../engine';
import {
  formatBettingActionShort,
  formatEvVi,
  formatPercentVi,
  formatStreetLabel,
  getPlayerName,
} from './format';
import type {
  DecisionQualityTone,
  HandReviewSummary,
  HeroDecisionRecord,
  HeroDecisionReview,
  SeatProfileInfo,
  TerminologyLanguage,
} from './types';

const REVIEW_EQUITY_SAMPLES = 450;
const REVIEW_EQUITY_MAX_ATTEMPTS = 6_000;
const MAX_SIMULATED_OPPONENTS = 3;

interface CandidateEv {
  readonly label: string;
  readonly ev: number;
  readonly precision: 'exact' | 'estimated';
}

function defaultOpponentResponseForStyle(rivalIds: readonly (string | null)[]): {
  readonly foldProb: number;
  readonly callProb: number;
  readonly noteVi: string;
} {
  // Simple explicit response assumption for estimating Bet/Raise EV in post-hand review.
  const hasLooseStation = rivalIds.some((id) => id === 'ca' || id === 'dai-gia');
  const hasTight = rivalIds.some((id) => id === 'da' || id === 'tho');

  if (hasLooseStation) {
    return {
      foldProb: 0.25,
      callProb: 0.75,
      noteVi: 'Giả định phản ứng bet/raise (đối thủ thoáng): 25% fold, 75% call.',
    };
  }
  if (hasTight) {
    return {
      foldProb: 0.45,
      callProb: 0.55,
      noteVi: 'Giả định phản ứng bet/raise (đối thủ chặt): 45% fold, 55% call.',
    };
  }
  return {
    foldProb: 0.35,
    callProb: 0.65,
    noteVi: 'Giả định phản ứng bet/raise chuẩn: 35% fold, 65% call.',
  };
}

function classifyDecisionQuality(params: {
  readonly chosenEv: number;
  readonly bestEv: number;
  readonly potReference: number;
  readonly facingBet: boolean;
  readonly equity: number | null;
  readonly requiredEquity: number;
  readonly chosenType: HeroDecisionRecord['chosenAction']['type'];
}): {
  readonly label: string;
  readonly tone: DecisionQualityTone;
} {
  const evLoss = Math.max(0, params.bestEv - params.chosenEv);

  if (params.facingBet && params.equity !== null) {
    const clear = classifyClearSpot(params.equity, params.requiredEquity);
    if (!clear.isClearSpot && evLoss <= Math.max(8, params.potReference * 0.08)) {
      return { label: 'Sát nút', tone: 'marginal' };
    }
    if (clear.isClearSpot) {
      const heroContinued = params.chosenType === 'call' || params.chosenType === 'raise';
      if (clear.recommendedAction === 'fold' && params.chosenType === 'fold') {
        return { label: 'Tốt', tone: 'good' };
      }
      if (clear.recommendedAction === 'call' && heroContinued && evLoss <= 6) {
        return { label: 'Tốt', tone: 'good' };
      }
      if (clear.recommendedAction === 'fold' && params.chosenType === 'call') {
        return evLoss >= 18
          ? { label: 'Sai lầm', tone: 'mistake' }
          : { label: 'Chưa tối ưu', tone: 'suboptimal' };
      }
      if (clear.recommendedAction === 'call' && params.chosenType === 'fold') {
        return evLoss >= 18
          ? { label: 'Sai lầm', tone: 'mistake' }
          : { label: 'Chưa tối ưu', tone: 'suboptimal' };
      }
    }
  }

  if (evLoss <= 3) {
    return { label: 'Tốt', tone: 'good' };
  }
  if (evLoss <= 10) {
    return { label: 'Sát nút', tone: 'marginal' };
  }
  if (evLoss <= 22) {
    return { label: 'Chưa tối ưu', tone: 'suboptimal' };
  }
  return { label: 'Sai lầm', tone: 'mistake' };
}

function evaluateHeroDecision(
  record: HeroDecisionRecord,
  seatProfiles: Readonly<Record<string, SeatProfileInfo>>,
  nongTiltStateDuringHand: NongTiltState,
  decisionRng: Rng,
  lang: TerminologyLanguage,
): HeroDecisionReview {
  const { snapshot, chosenAction, potOdds, handStateAtDecision } = record;
  const publicTimelineAtDecision: PublicTimelineEvent[] = [];
  for (let i = 0; i < Math.min(record.timelineLengthAtDecision, handStateAtDecision.timeline.length); i++) {
    const projected = projectTimelineEventToPublic(handStateAtDecision.timeline[i]!, snapshot.street);
    if (projected !== null) {
      publicTimelineAtDecision.push(projected);
    }
  }

  // Prioritize active opponents who contributed most or are still contesting the pot
  const prioritizedOppIds = [...record.activeOpponentIds]
    .sort((a, b) => {
      const seatA = handStateAtDecision.seats.find((s) => s.playerId === a);
      const seatB = handStateAtDecision.seats.find((s) => s.playerId === b);
      return (seatB?.streetContribution ?? 0) - (seatA?.streetContribution ?? 0);
    })
    .slice(0, MAX_SIMULATED_OPPONENTS);

  const rangeSummariesVi: string[] = [];
  const opponentRanges: OpponentRangeInput[] = [];
  const rivalIdsForAssumptions: (string | null)[] = [];

  for (const oppId of prioritizedOppIds) {
    const profile = seatProfiles[oppId];
    const rivalId = profile?.rivalId ?? null;
    rivalIdsForAssumptions.push(rivalId);
    if (rivalId === null) {
      continue;
    }

    const oppSeat = handStateAtDecision.seats.find((s) => s.playerId === oppId);
    const est = estimateRivalRange({
      rivalId,
      board: snapshot.board,
      street: snapshot.street,
      streetCap: snapshot.streetCap,
      publicTimeline: publicTimelineAtDecision,
      playerId: oppId,
      tiltState: rivalId === 'nong' ? nongTiltStateDuringHand : undefined,
      blockers: snapshot.heroCards,
      context: {
        opponentCount: snapshot.activeOpponentCount,
        stackValue: oppSeat ? chipValue(oppSeat.stack) : undefined,
        potValue: snapshot.potBeforeCall,
        positionLabelVi: snapshot.position.label,
        streetCap: snapshot.streetCap,
      },
    });

    if (est.combos.length > 0) {
      opponentRanges.push({
        opponentId: oppId,
        label: `${est.name} (${est.styleLabel})`,
        combos: est.combos,
      });
      rangeSummariesVi.push(est.descriptionVi);
    }
  }

  let estimatedEquity: number | null = null;
  let equitySamples = 0;
  const equityRng = decisionRng.fork('equity');
  const assumptionsContext = assumptionsContextFromSnapshot(snapshot);

  if (opponentRanges.length > 0) {
    try {
      const eqRes = simulateEquity({
        heroCards: snapshot.heroCards,
        board: snapshot.board,
        opponentRanges,
        rng: equityRng,
        samples: REVIEW_EQUITY_SAMPLES,
        maxAttempts: REVIEW_EQUITY_MAX_ATTEMPTS,
        assumptionsContext,
      });
      estimatedEquity = eqRes.equity;
      equitySamples = eqRes.completedSamples;
    } catch {
      // Fallback if multiway ranges conflict: simulate against primary opponent alone
      try {
        const primary = opponentRanges[0]!;
        const eqRes = simulateEquity({
          heroCards: snapshot.heroCards,
          board: snapshot.board,
          opponentRanges: [primary],
          rng: equityRng.fork('fallback-hu'),
          samples: REVIEW_EQUITY_SAMPLES,
          maxAttempts: REVIEW_EQUITY_MAX_ATTEMPTS,
          assumptionsContext,
        });
        estimatedEquity = eqRes.equity;
        equitySamples = eqRes.completedSamples;
      } catch {
        estimatedEquity = null;
      }
    }
  }

  const effectiveEquity = estimatedEquity ?? 0.5;
  const candidates: CandidateEv[] = [];
  const turnLabelVi = record.fromOutOfTurn ? 'Hô trước lượt' : 'Đúng lượt';
  const assumptionsVi: string[] = [
    `Street: ${formatStreetLabel(snapshot.street, lang)} · Cap street: ${snapshot.streetCap} điểm.`,
    record.fromOutOfTurn
      ? 'Thời điểm quyết định: Hô trước lượt (được tự động thực hiện khi tới lượt; chấm theo thông tin công khai lúc hô trước khi reserve chip).'
      : 'Thời điểm quyết định: Đúng lượt.',
    record.fromOutOfTurn
      ? `Pot lúc hô trước: ${snapshot.potBeforeCall} · Stack Hero (trước reserve): ${snapshot.heroStack} · Vị trí: ${snapshot.position.label ?? '—'}.`
      : `Pot trước lượt: ${snapshot.potBeforeCall} · Stack Hero: ${snapshot.heroStack} · Vị trí: ${snapshot.position.label ?? '—'}.`,
    `Số đối thủ còn trong ván: ${snapshot.activeOpponentCount}${record.activeOpponentIds.length > MAX_SIMULATED_OPPONENTS ? ` (mô phỏng ${prioritizedOppIds.length} đối thủ chính để giữ tốc độ)` : ''}.`,
  ];

  if (estimatedEquity !== null) {
    assumptionsVi.push(
      `Equity ước lượng qua Monte Carlo (${equitySamples} mẫu, seed "${equityRng.seed}") theo range đối thủ tại thời điểm quyết định.`,
    );
  } else {
    assumptionsVi.push('Không đủ range đối thủ hợp lệ sau blockers; dùng equity tham chiếu 50%.');
  }

  // Always compute Fold EV = 0
  const foldEv = calculateFoldEv(assumptionsContext);
  candidates.push({ label: 'Fold', ev: foldEv.ev, precision: 'exact' });

  // Call EV if facing bet
  let callEvVal: number | null = null;
  if (snapshot.toCall > 0 && snapshot.callAmount > 0) {
    const callRes = calculateCallEv({
      potBeforeCall: snapshot.potBeforeCall,
      callAmount: snapshot.callAmount,
      equity: effectiveEquity,
      heroStack: snapshot.heroStack,
      heroStreetContribution: snapshot.heroStreetContribution,
      streetCap: snapshot.streetCap,
      assumptionsContext,
    });
    callEvVal = callRes.ev;
    candidates.push({
      label: `Call ${snapshot.callAmount}`,
      ev: callRes.ev,
      precision: 'exact',
    });
  }

  // Check EV if no bet
  let checkEvVal: number | null = null;
  if (snapshot.toCall === 0) {
    const checkRes = calculateCheckEv({
      potBeforeAction: snapshot.potBeforeCall,
      equity: effectiveEquity,
      currentBet: snapshot.currentBet,
      heroStreetContribution: snapshot.heroStreetContribution,
      assumptionsContext,
    });
    checkEvVal = checkRes.ev;
    candidates.push({
      label: 'Check',
      ev: checkRes.ev,
      precision: 'estimated',
    });
  }

  const oppResponse = defaultOpponentResponseForStyle(rivalIdsForAssumptions);
  let chosenEv = 0;
  let chosenEvPrecision: 'exact' | 'estimated' = 'exact';
  let usedBetRaiseEstimate = false;

  const addedFromChosen =
    chosenAction.type === 'fold' || chosenAction.type === 'check'
      ? 0
      : chipValue(chosenAction.chips);
  const baseActionLabel = formatBettingActionShort(chosenAction, lang, addedFromChosen);
  const chosenActionLabel = record.fromOutOfTurn
    ? `${baseActionLabel} (Hô trước lượt)`
    : baseActionLabel;

  if (chosenAction.type === 'fold') {
    chosenEv = foldEv.ev;
    chosenEvPrecision = 'exact';
  } else if (chosenAction.type === 'call') {
    chosenEv = callEvVal ?? 0;
    chosenEvPrecision = 'exact';
  } else if (chosenAction.type === 'check') {
    chosenEv = checkEvVal ?? effectiveEquity * snapshot.potBeforeCall;
    chosenEvPrecision = 'estimated';
  } else if (chosenAction.type === 'bet' || chosenAction.type === 'raise') {
    usedBetRaiseEstimate = true;
    const targetBet = chosenAction.type === 'bet' ? chosenAction.amount : chosenAction.raiseTo;
    const oppAddedOnCall = Math.max(0, targetBet - snapshot.currentBet);
    try {
      const brRes = calculateBetOrRaiseEv({
        action: chosenAction.type,
        street: snapshot.street,
        potBeforeAction: snapshot.potBeforeCall,
        currentBet: snapshot.currentBet,
        heroStreetContribution: snapshot.heroStreetContribution,
        targetBet,
        heroStack: snapshot.heroStack,
        streetCap: snapshot.streetCap,
        opponentResponse: {
          foldProbability: oppResponse.foldProb,
          callProbability: oppResponse.callProb,
          equityWhenCalled: Math.max(0.05, effectiveEquity * 0.94),
          opponentAddedOnCall: oppAddedOnCall,
        },
        assumptionsContext,
      });
      chosenEv = brRes.ev;
      chosenEvPrecision = 'estimated';
      candidates.push({
        label: baseActionLabel,
        ev: brRes.ev,
        precision: 'estimated',
      });
    } catch {
      chosenEv = effectiveEquity * (snapshot.potBeforeCall + addedFromChosen) - addedFromChosen;
      chosenEvPrecision = 'estimated';
    }
  }

  if (usedBetRaiseEstimate) {
    assumptionsVi.push(oppResponse.noteVi);
  }

  // Determine best candidate action
  let best = candidates[0]!;
  for (const cand of candidates) {
    if (cand.ev > best.ev) {
      best = cand;
    }
  }

  const quality = classifyDecisionQuality({
    chosenEv,
    bestEv: best.ev,
    potReference: Math.max(snapshot.potBeforeCall, 20),
    facingBet: snapshot.toCall > 0,
    equity: estimatedEquity,
    requiredEquity: potOdds.requiredEquity,
    chosenType: chosenAction.type,
  });

  const evDiff = chosenEv - best.ev;
  let explanationVi: string;
  const actionVerb = record.fromOutOfTurn
    ? `Bạn đã hô trước ${baseActionLabel}`
    : `Bạn chọn ${baseActionLabel}`;
  const timingContext = record.fromOutOfTurn ? ' tại lúc hô trước' : '';
  if (potOdds.hasCall && estimatedEquity !== null) {
    const eqText = formatPercentVi(estimatedEquity);
    const reqText = formatPercentVi(potOdds.requiredEquity);
    explanationVi =
      `Cần ${reqText} (${potOdds.potToCallLabel}) để hòa vốn call${timingContext}; equity ước lượng trước range đối thủ là ${eqText}. ` +
      `${actionVerb} (${formatEvVi(chosenEv)}), lựa chọn cao nhất tham chiếu: ${best.label} (${formatEvVi(best.ev)}).`;
  } else if (estimatedEquity !== null) {
    explanationVi =
      `Không bị bet${timingContext} (equity ước lượng ${formatPercentVi(estimatedEquity)}). ` +
      `${actionVerb} (${formatEvVi(chosenEv)}); phương án tham chiếu cao nhất: ${best.label} (${formatEvVi(best.ev)}).`;
  } else {
    explanationVi = `${actionVerb} với EV ước lượng ${formatEvVi(chosenEv)}.`;
  }

  return Object.freeze({
    record,
    estimatedEquity,
    equitySamples,
    equitySeed: equityRng.seed,
    chosenActionLabel,
    turnLabelVi,
    chosenEv,
    chosenEvPrecision,
    bestAlternativeLabel: best.label,
    bestAlternativeEv: best.ev,
    evDiff,
    qualityLabel: quality.label,
    qualityTone: quality.tone,
    explanationVi,
    assumptionsVi: Object.freeze(assumptionsVi),
    rangeSummariesVi: Object.freeze(rangeSummariesVi),
  });
}

/**
 * Builds the end-of-hand review from the exact timeline and hero decision-time snapshots (Spec §7, H1 #19, X3).
 */
export function buildHandReview(params: {
  readonly handNumber: number;
  readonly hand: HandState;
  readonly heroId: string;
  readonly decisions: readonly HeroDecisionRecord[];
  readonly seatProfiles: Readonly<Record<string, SeatProfileInfo>>;
  readonly nongTiltStateDuringHand: NongTiltState;
  readonly reviewRng: Rng;
  readonly lang: TerminologyLanguage;
}): HandReviewSummary {
  const { hand, heroId, seatProfiles, lang } = params;
  const heroSeat = hand.seats.find((s) => s.playerId === heroId);
  const heroInvested = heroSeat?.totalContribution ?? 0;

  let heroPayout = 0;
  for (const transfer of hand.settledTransfers) {
    if (transfer.playerId === heroId) {
      heroPayout += transfer.amount;
    }
  }
  // If payout is still pending, read expected payout from pendingPayout
  if (hand.phase === 'awaiting-payout' && hand.pendingPayout !== null) {
    for (const req of hand.pendingPayout.requiredPayouts) {
      if (req.playerId === heroId) {
        heroPayout += req.amount;
      }
    }
  }

  // Also account for any uncalled refund returned to hero mid-hand
  let heroRefunded = 0;
  for (const ev of hand.timeline) {
    if (ev.type === 'uncalled-refund' && ev.playerId === heroId) {
      heroRefunded += ev.amount;
    }
  }

  const heroNetDelta = heroPayout + heroRefunded - heroInvested;
  const outcomeKind = hand.outcome?.kind ?? 'fold-win';
  const showdownResolution =
    hand.outcome?.kind === 'showdown' ? hand.outcome.resolution : null;
  const foldWinnerId = hand.outcome?.kind === 'fold-win' ? hand.outcome.winnerId : null;
  const foldWinPotAmount = hand.outcome?.kind === 'fold-win' ? hand.outcome.potAmount : 0;

  const reviewedDecisions = params.decisions.map((rec, idx) =>
    evaluateHeroDecision(
      rec,
      seatProfiles,
      params.nongTiltStateDuringHand,
      params.reviewRng.fork(`decision-${idx}`),
      lang,
    ),
  );

  let outcomeBannerVi: string;
  if (heroSeat === undefined) {
    outcomeBannerVi = 'Bạn không ngồi trong ván này.';
  } else if (heroNetDelta > 0) {
    outcomeBannerVi = `Kết quả ván: Thắng (+${heroNetDelta} điểm) — chất lượng từng quyết định được chấm độc lập với kết quả ván.`;
  } else if (heroNetDelta < 0) {
    outcomeBannerVi = `Kết quả ván: Thua (${heroNetDelta} điểm) — không ảnh hưởng điểm quyết định (chấm theo thông tin tại thời điểm quyết định).`;
  } else {
    outcomeBannerVi = `Kết quả ván: Hòa vốn (0 điểm) — chất lượng quyết định chấm độc lập với kết quả ván.`;
  }

  if (outcomeKind === 'fold-win' && foldWinnerId !== null) {
    const winnerName = getPlayerName(foldWinnerId, seatProfiles);
    outcomeBannerVi += ` (${winnerName} thắng pot ${foldWinPotAmount} vì mọi người fold.)`;
  }

  return Object.freeze({
    handNumber: params.handNumber,
    outcomeKind,
    heroNetDelta,
    heroPayout,
    heroInvested,
    outcomeBannerVi,
    decisions: Object.freeze(reviewedDecisions),
    timeline: hand.timeline,
    showdownResolution,
    foldWinnerId,
    foldWinPotAmount,
  });
}
