import { takeExactLargeFirst } from '../bank';
import { chipValue, type ChipCounts } from '../chips';
import { BET_STEP, type AmountRange, type BettingAction, type LegalActions } from '../handTypes';
import type { Rng } from '../rng';
import { evaluateRivalHandProfile, type HandStrengthAssessment } from './handStrength';
import {
  getActiveBehaviorParams,
  getRivalProfile,
  getRivalSeatMetadata,
  isNongTilted,
} from './profiles';
import { computePublicLegalActionsForSeat, validateRivalDecisionInput } from './publicView';
import type {
  PublicSeatView,
  RivalBehaviorParams,
  RivalDecisionInput,
  RivalDecisionResult,
  RivalOutOfTurnDecisionResult,
} from './types';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundToStep(value: number, range: AmountRange): number {
  const stepped = Math.round(value / BET_STEP) * BET_STEP;
  return clamp(stepped, range.min, range.max);
}

/**
 * Enumerates candidate target amounts in `range` (multiples of 5) ordered by distance from
 * `preferredTarget`, breaking ties toward larger amounts.
 */
function candidateAmountsByProximity(range: AmountRange, preferredTarget: number): number[] {
  const candidates: number[] = [];
  for (let amt = range.min; amt <= range.max; amt += range.step) {
    candidates.push(amt);
  }
  candidates.sort((a, b) => {
    const distDiff = Math.abs(a - preferredTarget) - Math.abs(b - preferredTarget);
    return distDiff !== 0 ? distDiff : b - a;
  });
  return candidates;
}

/**
 * Selects real physical chips from `stack` for a bet using `takeExactLargeFirst`,
 * searching nearby valid amounts in `betRange` if `stack` lacks a specific denomination.
 */
function selectBetActionWithChips(
  stack: ChipCounts,
  betRange: AmountRange,
  preferredAmount: number,
): { readonly action: BettingAction; readonly usedFallback: boolean } | null {
  const target = roundToStep(preferredAmount, betRange);
  const candidates = candidateAmountsByProximity(betRange, target);

  for (const amount of candidates) {
    const chips = takeExactLargeFirst(stack, amount);
    if (chips !== null) {
      return {
        action: Object.freeze({ type: 'bet', amount, chips }),
        usedFallback: amount !== target,
      };
    }
  }
  return null;
}

/**
 * Selects real physical chips from `stack` for a raise using `takeExactLargeFirst`,
 * searching nearby valid `raiseTo` targets in `raiseRange` if `stack` lacks a denomination.
 */
function selectRaiseActionWithChips(
  stack: ChipCounts,
  raiseRange: AmountRange,
  playerStreetContribution: number,
  preferredRaiseTo: number,
): { readonly action: BettingAction; readonly usedFallback: boolean } | null {
  const target = roundToStep(preferredRaiseTo, raiseRange);
  const candidates = candidateAmountsByProximity(raiseRange, target);

  for (const raiseTo of candidates) {
    const addedAmount = raiseTo - playerStreetContribution;
    if (addedAmount <= 0 || addedAmount > chipValue(stack)) {
      continue;
    }
    const chips = takeExactLargeFirst(stack, addedAmount);
    if (chips !== null) {
      return {
        action: Object.freeze({ type: 'raise', raiseTo, chips }),
        usedFallback: raiseTo !== target,
      };
    }
  }
  return null;
}

/**
 * Selects real physical chips from `stack` for a call (including all-in call when `stack <= toCall`).
 */
function selectCallActionWithChips(
  stack: ChipCounts,
  legalActions: LegalActions,
): { readonly action: BettingAction; readonly usedFallback: boolean } | null {
  if (!legalActions.canCall || legalActions.callAmount === null || legalActions.callAmount <= 0) {
    return null;
  }
  const chips = takeExactLargeFirst(stack, legalActions.callAmount);
  if (chips === null) {
    return null;
  }
  return {
    action: Object.freeze({ type: 'call', chips }),
    usedFallback: false,
  };
}

function computePreferredBetAmount(
  betRange: AmountRange,
  params: RivalBehaviorParams,
  assessment: HandStrengthAssessment,
  rng: Rng,
): number {
  if (params.preferredSizingCapRatio >= 0.99) {
    return betRange.max;
  }
  const strengthFactor = clamp(0.75 + assessment.effectiveStrength * 0.4, 0.5, 1.15);
  const jitter = (rng.next() - 0.5) * 0.16;
  const ratio = clamp(params.preferredSizingCapRatio * strengthFactor + jitter, 0.15, 1.0);
  const raw = betRange.min + (betRange.max - betRange.min) * ratio;
  return roundToStep(raw, betRange);
}

function computePreferredRaiseTo(
  raiseRange: AmountRange,
  params: RivalBehaviorParams,
  assessment: HandStrengthAssessment,
  rng: Rng,
): number {
  if (params.preferredSizingCapRatio >= 0.99) {
    return raiseRange.max;
  }
  const strengthFactor = clamp(0.75 + assessment.effectiveStrength * 0.4, 0.5, 1.15);
  const jitter = (rng.next() - 0.5) * 0.16;
  const ratio = clamp(params.preferredSizingCapRatio * strengthFactor + jitter, 0.15, 1.0);
  const raw = raiseRange.min + (raiseRange.max - raiseRange.min) * ratio;
  return roundToStep(raw, raiseRange);
}

function findActorSeat(input: RivalDecisionInput): PublicSeatView {
  const seat = input.publicSeats.find((s) => s.playerId === input.playerId);
  if (seat === undefined) {
    throw new Error(`Actor "${input.playerId}" not found in publicSeats`);
  }
  return seat;
}

function inspectStreetHistory(input: RivalDecisionInput): {
  readonly hasRaiseOnStreet: boolean;
  readonly hasActorCheckedThisStreet: boolean;
  readonly hasOtherActiveOpponents: boolean;
} {
  let hasRaiseOnStreet = false;
  let hasActorCheckedThisStreet = false;

  for (const event of input.publicTimeline) {
    if (event.type === 'player-action' && event.street === input.street) {
      if (event.action.type === 'raise') {
        hasRaiseOnStreet = true;
      }
      if (event.playerId === input.playerId && event.action.type === 'check') {
        hasActorCheckedThisStreet = true;
      }
    }
  }

  const hasOtherActiveOpponents = input.publicSeats.some(
    (s) => s.status === 'active' && s.playerId !== input.playerId,
  );

  return {
    hasRaiseOnStreet,
    hasActorCheckedThisStreet,
    hasOtherActiveOpponents,
  };
}

function buildReasoningVi(
  input: RivalDecisionInput,
  action: BettingAction,
  assessment: HandStrengthAssessment,
  isTilted: boolean,
  note: string,
): string {
  const profile = getRivalProfile(input.rivalId);
  const stateTag =
    input.rivalId === 'nong'
      ? isTilted
        ? ' [Đang tilt]'
        : ' [Bình thường]'
      : '';
  const actionText =
    action.type === 'fold'
      ? 'fold'
      : action.type === 'check'
        ? 'check'
        : action.type === 'call'
          ? 'call'
          : action.type === 'bet'
            ? `bet ${action.amount}`
            : `raise lên ${action.raiseTo}`;
  const strengthPct = Math.round(assessment.effectiveStrength * 100);
  return `${profile.display.name} (${profile.display.styleLabel}${stateTag}) chọn ${actionText} ở ${input.street} (sức mạnh ước lượng ${strengthPct}%): ${note} — đánh giá theo thông tin tại thời điểm quyết định, độc lập với kết quả ván.`;
}

/**
 * Pure deterministic decision function for a rival's turn (spec §4.1–4.3, D28, D42, D45, AC B1, B2, B5–B7).
 * Validates `input` structure at runtime to guarantee no hidden state is present.
 */
export function decideRivalAction(
  input: RivalDecisionInput,
  rng: Rng,
): RivalDecisionResult {
  const validation = validateRivalDecisionInput(input);
  if (!validation.ok) {
    throw new Error(`Invalid RivalDecisionInput: ${validation.reason ?? 'unknown validation error'}`);
  }

  if (input.activePlayerId === null) {
    throw new Error('Cannot decide rival action outside betting phase (activePlayerId is null)');
  }

  const seat = findActorSeat(input);
  const legal =
    input.legalActions ??
    computePublicLegalActionsForSeat(
      input.publicSeats,
      input.playerId,
      input.street,
      input.streetCap,
      input.currentBet,
    );

  if (legal === null) {
    throw new Error(`No legal actions available for player "${input.playerId}"`);
  }

  const tilted = isNongTilted(input.rivalId, input.tiltState);
  const params = getActiveBehaviorParams(input.rivalId, input.tiltState);
  const metadata = getRivalSeatMetadata(input.rivalId, input.tiltState);
  const assessment = evaluateRivalHandProfile(
    input.holeCards,
    input.board,
    params.drawContinueBoost,
  );
  const history = inspectStreetHistory(input);
  const decisionRng = rng.fork(`decide:${input.rivalId}:${input.street}:${input.publicTimeline.length}`);

  const finalize = (
    action: BettingAction,
    note: string,
    usedFallback = false,
  ): RivalDecisionResult =>
    Object.freeze({
      action,
      rivalId: input.rivalId,
      styleLabel: metadata.styleLabel,
      personalityTagVi: metadata.styleTagVi,
      reasoningVi: buildReasoningVi(input, action, assessment, tilted, note),
      isTilted: tilted,
      madeStrength: assessment.madeStrength,
      drawStrength: assessment.drawStrength,
      effectiveStrength: assessment.effectiveStrength,
      usedFallbackForMissingDenominations: usedFallback,
    });

  // Case 1: Unopened pot (toCall === 0)
  if (legal.toCall === 0) {
    if (!legal.canBet || legal.betRange === null) {
      return finalize(Object.freeze({ type: 'check' }), 'không thể bet thêm, chọn check');
    }

    // Slowplay check (Bẫy checks strong hands to set a check-raise trap)
    if (
      params.slowplayFreq > 0 &&
      assessment.madeStrength >= params.strongThreshold &&
      history.hasOtherActiveOpponents
    ) {
      const slowplayRoll = decisionRng.fork('slowplay').next();
      if (slowplayRoll < params.slowplayFreq) {
        return finalize(
          Object.freeze({ type: 'check' }),
          'slowplay bài mạnh để gài check-raise',
        );
      }
    }

    let shouldBet = false;
    let betReason = '';

    if (assessment.effectiveStrength >= params.valueThreshold) {
      const valueBetProb = clamp(
        params.aggressionFreq + (assessment.effectiveStrength - params.valueThreshold) * 0.55,
        0.05,
        0.99,
      );
      if (decisionRng.fork('value-bet').next() < valueBetProb) {
        shouldBet = true;
        betReason = 'bet chủ động theo sức mạnh bài';
      }
    } else if (
      assessment.drawStrength > 0 &&
      assessment.effectiveStrength >= params.continueThreshold
    ) {
      const semiBluffProb = clamp(
        params.aggressionFreq * 0.65 * Math.min(params.drawContinueBoost, 1.15),
        0.02,
        0.95,
      );
      if (decisionRng.fork('semi-bluff-bet').next() < semiBluffProb) {
        shouldBet = true;
        betReason = 'semi-bluff với bài mua (draw)';
      }
    } else {
      if (decisionRng.fork('bluff-bet').next() < params.bluffFreq) {
        shouldBet = true;
        betReason = 'bluff chủ động theo phong cách';
      }
    }

    if (shouldBet) {
      const preferredAmount = computePreferredBetAmount(
        legal.betRange,
        params,
        assessment,
        decisionRng.fork('bet-size'),
      );
      const selected = selectBetActionWithChips(seat.stack, legal.betRange, preferredAmount);
      if (selected !== null) {
        return finalize(selected.action, betReason, selected.usedFallback);
      }
      // Stack lacks denominations to form any bet in betRange -> fallback to legal check
      return finalize(
        Object.freeze({ type: 'check' }),
        'thiếu mệnh giá chip để tạo khoản bet, chuyển sang check hợp lệ',
        true,
      );
    }

    return finalize(Object.freeze({ type: 'check' }), 'kiểm soát pot bằng check');
  }

  // Case 2: Facing a bet or raise (toCall > 0)
  const facingRaise = history.hasRaiseOnStreet || legal.playerStreetContribution > 0;

  // 2a. Check-raise check (Bẫy checked earlier on this street with a strong hand and now faces a bet)
  if (
    history.hasActorCheckedThisStreet &&
    legal.canRaise &&
    legal.raiseRange !== null &&
    assessment.madeStrength >= params.strongThreshold
  ) {
    if (decisionRng.fork('check-raise').next() < params.checkRaiseFreq) {
      const preferredRaiseTo = computePreferredRaiseTo(
        legal.raiseRange,
        params,
        assessment,
        decisionRng.fork('cr-size'),
      );
      const selected = selectRaiseActionWithChips(
        seat.stack,
        legal.raiseRange,
        legal.playerStreetContribution,
        preferredRaiseTo,
      );
      if (selected !== null) {
        return finalize(
          selected.action,
          'check-raise sau khi đã gài bẫy với bài mạnh',
          selected.usedFallback,
        );
      }
    }
  }

  // 2b. Facing a raise: evaluate fold-to-raise behavior (Thỏ folds decent hands when raised)
  if (facingRaise) {
    const whaleHasDraw =
      (input.rivalId === 'dai-gia' || tilted) && assessment.drawStrength >= 0.06;
    if (!whaleHasDraw && assessment.effectiveStrength < params.foldToRaiseThreshold) {
      const foldRoll = decisionRng.fork('fold-to-raise').next();
      if (
        foldRoll < params.foldToRaiseFreq ||
        assessment.effectiveStrength < params.continueThreshold * 0.85
      ) {
        return finalize(
          Object.freeze({ type: 'fold' }),
          'đối mặt lệnh raise, chọn fold để bảo toàn stack',
        );
      }
    }
  }

  // 2c. Evaluate general continuation threshold vs bet pressure
  const betPressure = (legal.toCall / Math.max(legal.streetCap, 1)) * 0.10;
  const drawProtection =
    (input.rivalId === 'dai-gia' || tilted) && assessment.drawStrength >= 0.06 ? 0.14 : 0;
  const requiredStrength = Math.max(0.05, params.continueThreshold + betPressure - drawProtection);

  if (assessment.effectiveStrength < requiredStrength) {
    // Weak hand below continuation threshold: check if profile bluff-raises
    if (
      legal.canRaise &&
      legal.raiseRange !== null &&
      decisionRng.fork('bluff-raise').next() < params.bluffFreq * 0.75
    ) {
      const preferredRaiseTo = computePreferredRaiseTo(
        legal.raiseRange,
        params,
        assessment,
        decisionRng.fork('bluff-raise-size'),
      );
      const selected = selectRaiseActionWithChips(
        seat.stack,
        legal.raiseRange,
        legal.playerStreetContribution,
        preferredRaiseTo,
      );
      if (selected !== null) {
        return finalize(
          selected.action,
          'raise bluff gây áp lực theo phong cách',
          selected.usedFallback,
        );
      }
    }

    return finalize(
      Object.freeze({ type: 'fold' }),
      'bài dưới ngưỡng tiếp tục trước mức cược hiện hành',
    );
  }

  // 2d. Player continues: choose between raise and call
  if (legal.canRaise && legal.raiseRange !== null) {
    let raiseProb: number;
    if (assessment.effectiveStrength >= params.strongThreshold) {
      raiseProb = clamp(params.raiseVsBetFreq * 1.25, 0.02, 0.98);
    } else if (assessment.effectiveStrength >= params.valueThreshold) {
      raiseProb = params.raiseVsBetFreq;
    } else {
      raiseProb = params.raiseVsBetFreq * 0.45 + params.bluffFreq * 0.40;
    }

    if (decisionRng.fork('raise-vs-bet').next() < raiseProb) {
      const preferredRaiseTo = computePreferredRaiseTo(
        legal.raiseRange,
        params,
        assessment,
        decisionRng.fork('raise-size'),
      );
      const selected = selectRaiseActionWithChips(
        seat.stack,
        legal.raiseRange,
        legal.playerStreetContribution,
        preferredRaiseTo,
      );
      if (selected !== null) {
        return finalize(
          selected.action,
          'raise chủ động để tối đa giá trị / gây áp lực',
          selected.usedFallback,
        );
      }
    }
  }

  // Default continuation: Call
  const callSelected = selectCallActionWithChips(seat.stack, legal);
  if (callSelected !== null) {
    const callNote = legal.isCallAllIn
      ? 'call all-in với phần stack còn lại'
      : 'call theo mức cược hiện hành';
    return finalize(callSelected.action, callNote, callSelected.usedFallback);
  }

  // Missing denomination fallback for Call: if stack cannot form exact callAmount, try formable raise if strong enough, else fold
  if (legal.canRaise && legal.raiseRange !== null) {
    const fallbackRaise = selectRaiseActionWithChips(
      seat.stack,
      legal.raiseRange,
      legal.playerStreetContribution,
      legal.raiseRange.min,
    );
    if (fallbackRaise !== null) {
      return finalize(
        fallbackRaise.action,
        'thiếu mệnh giá lẻ để call, dùng chip mệnh giá lớn để raise hợp lệ',
        true,
      );
    }
  }

  return finalize(
    Object.freeze({ type: 'fold' }),
    'stack thiếu mệnh giá chip phù hợp để tạo khoản call, chuyển sang fold hợp lệ',
    true,
  );
}

/**
 * Evaluates whether a rival declares an out-of-turn action before their turn (spec §3.4, D39, AC X1–X2).
 * Only returns a non-null action when an out-of-turn declaration is strictly legal at this moment;
 * the engine at execution time remains the source of truth for whether the declaration binds or is cancelled.
 */
export function decideRivalOutOfTurn(
  input: RivalDecisionInput,
  rng: Rng,
): RivalOutOfTurnDecisionResult {
  const validation = validateRivalDecisionInput(input);
  if (!validation.ok) {
    throw new Error(`Invalid RivalDecisionInput: ${validation.reason ?? 'unknown validation error'}`);
  }

  const tilted = isNongTilted(input.rivalId, input.tiltState);
  const metadata = getRivalSeatMetadata(input.rivalId, input.tiltState);
  const params = getActiveBehaviorParams(input.rivalId, input.tiltState);

  const noDeclaration = (reason: string): RivalOutOfTurnDecisionResult =>
    Object.freeze({
      action: null,
      rivalId: input.rivalId,
      styleLabel: metadata.styleLabel,
      personalityTagVi: metadata.styleTagVi,
      reasoningVi: reason,
      isTilted: tilted,
    });

  if (!input.allowOutOfTurn || !input.config.allowOutOfTurn) {
    return noDeclaration('Hô sớm đang tắt trong cấu hình bàn.');
  }
  if (input.activePlayerId === null || input.isMyTurn || input.activePlayerId === input.playerId) {
    return noDeclaration('Đang ở lượt của chính mình hoặc ngoài pha cược.');
  }

  const seat = findActorSeat(input);
  if (seat.status !== 'active') {
    return noDeclaration('Ghế không còn ở trạng thái active.');
  }
  if (seat.declaration !== null) {
    return noDeclaration('Đã có lời hô sớm đang chờ hiệu lực.');
  }
  if (seat.hasActedThisStreet && seat.streetContribution === input.currentBet) {
    return noDeclaration('Đã hành động và khớp mức cược hiện hành ở street này.');
  }

  const seatLegal = computePublicLegalActionsForSeat(
    input.publicSeats,
    input.playerId,
    input.street,
    input.streetCap,
    input.currentBet,
  );
  if (seatLegal === null) {
    return noDeclaration('Không có hành động hợp lệ để hô sớm.');
  }

  const ootRng = rng.fork(`oot:${input.rivalId}:${input.street}:${input.publicTimeline.length}`);
  if (ootRng.fork('gate').next() >= params.outOfTurnFreq) {
    return noDeclaration('Không kích hoạt hô sớm ở lượt này.');
  }

  const candidateInput: RivalDecisionInput = Object.freeze({
    ...input,
    legalActions: seatLegal,
  });
  const candidate = decideRivalAction(candidateInput, ootRng.fork('intent'));

  // Avoid declaring out-of-turn fold (players declare bets, raises, calls, or checks out of turn)
  if (candidate.action.type === 'fold') {
    return noDeclaration('Bỏ qua hô sớm khi ý định là fold.');
  }

  return Object.freeze({
    action: candidate.action,
    rivalId: input.rivalId,
    styleLabel: metadata.styleLabel,
    personalityTagVi: metadata.styleTagVi,
    reasoningVi: `Hô sớm trước lượt: ${candidate.reasoningVi}`,
    isTilted: tilted,
  });
}
