import { createDeck, type Card, type Suit } from '../cards';
import { STREET_CAP, type Street } from '../handTypes';
import { evaluateRivalHandProfile, type HandStrengthAssessment } from './handStrength';
import {
  getActiveBehaviorParams,
  getRivalProfile,
  getRivalSeatMetadata,
  isNongTilted,
  isRivalId,
} from './profiles';
import type {
  EstimateRivalRangeInput,
  PublicActionDescriptor,
  PublicTimelineEvent,
  RivalBehaviorParams,
  RivalId,
  RivalRangeEstimate,
  WeightedCombo,
} from './types';

const VALID_SUITS: ReadonlySet<string> = new Set<Suit>(['s', 'h', 'd', 'c']);

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function cardKey(card: Card): string {
  return `${card.rank}:${card.suit}`;
}

function validateCardList(cards: readonly Card[], label: string): void {
  const seen = new Set<string>();
  for (const card of cards) {
    if (
      typeof card !== 'object' ||
      card === null ||
      !Number.isInteger(card.rank) ||
      card.rank < 2 ||
      card.rank > 14 ||
      !VALID_SUITS.has(card.suit)
    ) {
      throw new Error(`Invalid card in ${label}`);
    }
    const key = cardKey(card);
    if (seen.has(key)) {
      throw new Error(`Duplicate card "${key}" in ${label}`);
    }
    seen.add(key);
  }
}

function inferStreetFromBoard(boardLength: number): Street {
  switch (boardLength) {
    case 0:
      return 'preflop';
    case 3:
      return 'flop';
    case 4:
      return 'turn';
    case 5:
      return 'river';
    default:
      throw new Error(
        `Board must have 0 (preflop), 3 (flop), 4 (turn), or 5 (river) cards, received ${boardLength}`,
      );
  }
}

/**
 * Extracts the most informative public action on `street` for `playerId` from `publicTimeline`
 * when no explicit `action` descriptor is provided.
 */
export function inferPublicActionFromTimeline(
  publicTimeline: readonly PublicTimelineEvent[],
  playerId: string,
  street: Street,
): PublicActionDescriptor | undefined {
  let sawCheckEarlier = false;
  let sawOutOfTurn = false;
  let lastAction: PublicActionDescriptor | undefined;

  for (const event of publicTimeline) {
    if (event.type === 'out-of-turn-declared' && event.street === street && event.playerId === playerId) {
      sawOutOfTurn = true;
      const act = event.action;
      lastAction = {
        type: act.type,
        ...(act.type === 'bet' ? { amount: act.amount } : {}),
        ...(act.type === 'raise' ? { raiseTo: act.raiseTo } : {}),
        fromOutOfTurn: true,
        isCheckRaise: act.type === 'raise' && sawCheckEarlier,
      };
    } else if (event.type === 'player-action' && event.street === street && event.playerId === playerId) {
      const act = event.action;
      if (act.type === 'check') {
        sawCheckEarlier = true;
      }
      lastAction = {
        type: act.type,
        ...(act.type === 'bet' ? { amount: act.amount } : {}),
        ...(act.type === 'raise' ? { raiseTo: act.raiseTo } : {}),
        fromOutOfTurn: event.fromOutOfTurn || sawOutOfTurn,
        isCheckRaise: act.type === 'raise' && sawCheckEarlier,
      };
    }
  }

  return lastAction;
}

function resolveIsCheckRaise(rivalId: RivalId, action: PublicActionDescriptor): boolean {
  if (action.type !== 'raise') {
    return false;
  }
  return action.isCheckRaise !== undefined ? action.isCheckRaise : rivalId === 'bay';
}

function computeComboWeight(
  rivalId: RivalId,
  params: RivalBehaviorParams,
  assessment: HandStrengthAssessment,
  action: PublicActionDescriptor | undefined,
  streetCap: number,
  isTilted: boolean,
): number {
  if (action === undefined) {
    // Baseline active range for this profile on this street
    const base =
      assessment.effectiveStrength >= params.continueThreshold
        ? 0.45 + (assessment.effectiveStrength - params.continueThreshold) * 0.9
        : params.bluffFreq * 0.4 + (1 - params.continueThreshold) * 0.25;
    return clamp(Number(base.toFixed(4)), 0, 1);
  }

  const sizingAmount =
    action.type === 'bet'
      ? (action.amount ?? streetCap * params.preferredSizingCapRatio)
      : action.type === 'raise'
        ? (action.raiseTo ?? streetCap * params.preferredSizingCapRatio)
        : 0;
  const sizingRatio = clamp(sizingAmount / Math.max(streetCap, 1), 0.1, 1.0);

  switch (action.type) {
    case 'check': {
      // Checking range: weak-to-medium hands plus slowplayed monsters (especially for Bẫy)
      if (assessment.madeStrength >= params.strongThreshold) {
        const trapWeight = Math.max(params.slowplayFreq, 1 - params.aggressionFreq);
        return clamp(Number(trapWeight.toFixed(4)), 0.05, 1);
      }
      if (assessment.effectiveStrength >= params.valueThreshold) {
        const passiveWeight = clamp(1 - params.aggressionFreq * 0.75, 0.1, 0.95);
        return Number(passiveWeight.toFixed(4));
      }
      return Number(clamp(0.85 - params.bluffFreq * 0.4, 0.15, 0.95).toFixed(4));
    }

    case 'call': {
      // Calling range: hands above continuation threshold (plus draws for Whale / Calling Station / tilted Nóng),
      // discounted at the very top when the profile frequently raises strong hands.
      const hasDrawBoost =
        (rivalId === 'dai-gia' || rivalId === 'ca' || isTilted) && assessment.drawStrength > 0;
      const effectiveFloor = Math.max(
        0.04,
        params.continueThreshold - (hasDrawBoost ? 0.14 : 0),
      );

      if (assessment.effectiveStrength < effectiveFloor) {
        if (rivalId === 'ca') {
          return 0.25;
        }
        return 0;
      }

      let weight = 0.55 + (assessment.effectiveStrength - effectiveFloor) * 0.75;
      if (assessment.drawStrength > 0) {
        weight += assessment.drawStrength * Math.min(params.drawContinueBoost, 1.2) * 0.35;
      }
      if (assessment.effectiveStrength >= params.strongThreshold) {
        // Aggressive profiles often raise their strongest hands instead of flat-calling
        weight *= clamp(1.05 - params.raiseVsBetFreq * 0.75, 0.18, 1.0);
      }
      return clamp(Number(weight.toFixed(4)), 0.05, 1);
    }

    case 'bet':
    case 'raise': {
      const isRaise = action.type === 'raise';
      const isCheckRaise = resolveIsCheckRaise(rivalId, action);

      if (isCheckRaise) {
        // Check-raise range is heavily polarized toward strong made hands and high-equity draws
        if (assessment.madeStrength >= params.strongThreshold) {
          return Number(clamp(0.75 + assessment.madeStrength * 0.25, 0.75, 1).toFixed(4));
        }
        if (assessment.hasStrongDraw) {
          return Number(clamp(params.checkRaiseFreq * 0.55, 0.15, 0.75).toFixed(4));
        }
        if (params.bluffFreq >= 0.25) {
          return Number(clamp(params.bluffFreq * 0.35, 0.05, 0.45).toFixed(4));
        }
        return 0;
      }

      const valueFloor = isRaise
        ? clamp(params.valueThreshold + 0.04 * sizingRatio, 0.10, 0.88)
        : clamp(params.valueThreshold - 0.02 * (1 - sizingRatio), 0.08, 0.85);

      // Strong / value hands
      if (assessment.effectiveStrength >= valueFloor) {
        const baseFreq = isRaise ? params.raiseVsBetFreq : params.aggressionFreq;
        const strengthBonus = (assessment.effectiveStrength - valueFloor) * 0.9;
        const raw = clamp(0.35 + baseFreq * 0.65 + strengthBonus, 0.2, 1.0);
        return Number(raw.toFixed(4));
      }

      // Semi-bluff with draws
      if (assessment.drawStrength > 0) {
        const semiWeight =
          assessment.drawStrength *
          params.drawContinueBoost *
          (isRaise ? params.raiseVsBetFreq + 0.15 : params.aggressionFreq);
        if (semiWeight >= 0.04) {
          return Number(clamp(semiWeight, 0.05, 0.9).toFixed(4));
        }
      }

      // Pure bluff component (Điên, Sói, tilted Nóng have wide bluff weights; Đá, Thỏ, Cá ~ 0)
      const bluffFactor = isRaise ? params.bluffFreq * 0.85 : params.bluffFreq;
      const ootBoost = action.fromOutOfTurn ? 1.15 : 1.0;
      const bluffWeight = bluffFactor * ootBoost;
      if (bluffWeight >= 0.05) {
        return Number(clamp(bluffWeight, 0.05, 0.85).toFixed(4));
      }

      return 0;
    }

    case 'fold':
      return 0;
  }
}

function buildRangeDescriptionVi(
  rivalId: RivalId,
  action: PublicActionDescriptor | undefined,
  street: Street,
  streetCap: number,
  isTilted: boolean,
): string {
  const profile = getRivalProfile(rivalId);
  const name = profile.display.name;

  if (rivalId === 'nong') {
    if (isTilted) {
      return `Nóng đang tilt ở ${street}, range rộng hơn hẳn lúc bình thường (gồm bài mạnh, bài trung bình, draw yếu và nhiều bluff ở mức gần cap ${streetCap}).`;
    }
    return `Nóng đang bình thường ở ${street}, chơi chắc tay gần Cáo với range chọn lọc và ít bluff hơn.`;
  }

  const actionLabel =
    action === undefined
      ? 'tiếp tục trong ván'
      : action.type === 'bet'
        ? `bet ${action.amount ?? ''}`.trim()
        : action.type === 'raise'
          ? resolveIsCheckRaise(rivalId, action)
            ? `check-raise lên ${action.raiseTo ?? ''}`.trim()
            : `raise lên ${action.raiseTo ?? ''}`.trim()
          : action.type;

  switch (rivalId) {
    case 'da':
      return `${name} (${profile.display.styleLabel}) ${actionLabel} ở ${street} với range rất hẹp, thiên hẳn về bài thật mạnh, hầu như không có bluff.`;
    case 'ca':
      return `${name} (${profile.display.styleLabel}) ${actionLabel} ở ${street} với range call rất rộng nhưng chỉ raise khi có bài cực mạnh.`;
    case 'cao':
      return `${name} (${profile.display.styleLabel}) ${actionLabel} ở ${street} với range chọn lọc gồm bài value chất lượng và các draw/semi-bluff mạnh.`;
    case 'soi':
      return `${name} (${profile.display.styleLabel}) ${actionLabel} ở ${street} với range rộng, chủ động gây áp lực bằng cả bài value, draw và bluff.`;
    case 'dien':
      return `${name} (${profile.display.styleLabel}) ${actionLabel} ở ${street} với range rất rộng gồm bài mạnh, draw và nhiều bluff (thường đẩy lên cap ${streetCap}).`;
    case 'dai-gia':
      return `${name} (${profile.display.styleLabel}) ${actionLabel} ở ${street} với range rộng, giữ lại hầu hết các bài mua (kể cả draw yếu).`;
    case 'tho':
      return `${name} (${profile.display.styleLabel}) ${actionLabel} ở ${street} với range thận trọng; khi đối mặt raise chỉ giữ lại nhóm bài thật mạnh.`;
    case 'bay':
      return `${name} (${profile.display.styleLabel}) ${actionLabel} ở ${street}: khi check vẫn có thể gài bài mạnh, còn khi check-raise thì range thiên hẳn về bài rất mạnh.`;
  }
}

function buildAssumptionsVi(
  input: EstimateRivalRangeInput,
  street: Street,
  streetCap: number,
  effectiveAction: PublicActionDescriptor | undefined,
  isTilted: boolean,
): readonly string[] {
  const metadata = getRivalSeatMetadata(input.rivalId, input.tiltState);
  const notes: string[] = [
    `Hồ sơ đối thủ: ${metadata.name} — ${metadata.styleLabel} (${metadata.publicStatusLabelVi}).`,
    `Street: ${street}, cap street: ${streetCap}.`,
  ];

  if (effectiveAction !== undefined) {
    const actDetail =
      effectiveAction.type === 'bet'
        ? `bet ${effectiveAction.amount ?? ''}`.trim()
        : effectiveAction.type === 'raise'
          ? `${resolveIsCheckRaise(input.rivalId, effectiveAction) ? 'check-raise' : 'raise'} lên ${effectiveAction.raiseTo ?? ''}`.trim()
          : effectiveAction.type;
    const ootNote = effectiveAction.fromOutOfTurn ? ' (có hô sớm trước lượt)' : '';
    notes.push(`Hành động công khai: ${actDetail}${ootNote}.`);
  } else {
    notes.push('Hành động công khai: mặc định theo kiểu chơi của rival trên street hiện tại.');
  }

  if (input.rivalId === 'nong') {
    notes.push(
      isTilted
        ? 'Trạng thái Nóng: Đang tilt → nới rộng range (thêm draw yếu và bluff ở mức cap).'
        : 'Trạng thái Nóng: Bình thường → range chắc tay gần TAG, ít bluff.',
    );
  }

  if (input.context !== undefined) {
    if (input.context.opponentCount !== undefined) {
      notes.push(`Số đối thủ trong pot: ${input.context.opponentCount}.`);
    }
    if (input.context.stackValue !== undefined) {
      notes.push(`Stack đối thủ: ${input.context.stackValue}.`);
    }
    if (input.context.potValue !== undefined) {
      notes.push(`Pot hiện tại: ${input.context.potValue}.`);
    }
    if (input.context.positionLabelVi !== undefined) {
      notes.push(`Vị trí: ${input.context.positionLabelVi}.`);
    }
  }

  return Object.freeze(notes);
}

/**
 * Computes a quantitative rival hand range (`{ cards: [Card, Card], weight }[]`) and Vietnamese
 * feedback explanation from the rival's profile, public action, and public board blockers
 * (spec §4.1, §4.3, §5, §6.1, AC D5).
 */
export function estimateRivalRange(input: EstimateRivalRangeInput): RivalRangeEstimate {
  if (!isRivalId(input.rivalId)) {
    throw new Error(`Invalid rivalId: ${String(input.rivalId)}`);
  }

  validateCardList(input.board, 'board');
  const inferredStreet = inferStreetFromBoard(input.board.length);
  const street = input.street ?? inferredStreet;
  if (street !== inferredStreet) {
    throw new Error(
      `Street "${street}" does not match board length ${input.board.length} (expected "${inferredStreet}")`,
    );
  }

  const extraBlockers = input.blockers ?? [];
  validateCardList(extraBlockers, 'blockers');

  const blockedKeys = new Set<string>();
  for (const card of input.board) {
    blockedKeys.add(cardKey(card));
  }
  for (const card of extraBlockers) {
    blockedKeys.add(cardKey(card));
  }

  const streetCap = input.streetCap ?? input.context?.streetCap ?? STREET_CAP;
  const tilted = isNongTilted(input.rivalId, input.tiltState);
  const params = getActiveBehaviorParams(input.rivalId, input.tiltState);
  const metadata = getRivalSeatMetadata(input.rivalId, input.tiltState);

  const effectiveAction =
    input.action ??
    (input.publicTimeline !== undefined
      ? inferPublicActionFromTimeline(
          input.publicTimeline,
          input.playerId ?? input.rivalId,
          street,
        )
      : undefined);

  const availableCards = createDeck().filter((c) => !blockedKeys.has(cardKey(c)));
  const combos: WeightedCombo[] = [];
  const fallbackCombos: Array<{ readonly cards: readonly [Card, Card]; readonly score: number }> =
    [];

  for (let i = 0; i < availableCards.length; i++) {
    const c1 = availableCards[i]!;
    for (let j = i + 1; j < availableCards.length; j++) {
      const c2 = availableCards[j]!;
      const pair = Object.freeze([c1, c2] as const);
      const assessment = evaluateRivalHandProfile(pair, input.board, params.drawContinueBoost);
      const weight = computeComboWeight(
        input.rivalId,
        params,
        assessment,
        effectiveAction,
        streetCap,
        tilted,
      );

      if (Number.isFinite(weight) && weight > 0) {
        combos.push(Object.freeze({ cards: pair, weight }));
      } else {
        fallbackCombos.push({ cards: pair, score: assessment.effectiveStrength });
      }
    }
  }

  // Ensure non-empty range for live actions; a folded opponent has an empty live range.
  if (effectiveAction?.type !== 'fold' && combos.length === 0 && fallbackCombos.length > 0) {
    fallbackCombos.sort((a, b) => b.score - a.score);
    const topSlice = fallbackCombos.slice(0, Math.min(12, fallbackCombos.length));
    for (const item of topSlice) {
      combos.push(
        Object.freeze({
          cards: item.cards,
          weight: Number(clamp(item.score, 0.05, 1).toFixed(4)),
        }),
      );
    }
  }

  return Object.freeze({
    rivalId: input.rivalId,
    name: metadata.name,
    styleLabel: metadata.styleLabel,
    isTilted: tilted,
    street,
    combos: Object.freeze(combos),
    descriptionVi: buildRangeDescriptionVi(
      input.rivalId,
      effectiveAction,
      street,
      streetCap,
      tilted,
    ),
    assumptionsVi: buildAssumptionsVi(input, street, streetCap, effectiveAction, tilted),
  });
}

/**
 * Convenience helper returning only the quantitative weighted combos for Calculator (P2a).
 */
export function getRivalRangeCombos(
  input: EstimateRivalRangeInput,
): readonly WeightedCombo[] {
  return estimateRivalRange(input).combos;
}
