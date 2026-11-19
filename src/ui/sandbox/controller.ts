import {
  addChips,
  applyAction,
  BET_STEP,
  buildRivalDecisionInput,
  calculatePotOddsFromSnapshot,
  checkHandInvariants,
  checkInv1,
  checkReadyForNextHand,
  chipValue,
  computePublicLegalActionsForSeat,
  createBoundaryFromHand,
  createInitialNongTiltState,
  createRng,
  decideRivalAction,
  decideRivalOutOfTurn,
  declareOutOfTurn,
  emptyChips,
  exchangeChips,
  exchangeHandChips,
  extractDecisionSnapshot,
  getLegalActions,
  getRivalProfile,
  getRivalSeatMetadata,
  initialDistribution,
  leaveTableAtBoundary,
  MAX_PLAYERS,
  nextDealerArrayIndex,
  NONG_RIVAL_ID,
  planPotPayouts,
  rebuyAtBoundary,
  RIVAL_IDS,
  seatPlayerAtBoundary,
  selectRivalsForTable,
  selectionMatches,
  settlePendingPayout,
  startHand,
  subtractChips,
  summarizeCompletedHandForRivals,
  updateNongTiltStateAtBoundary,
  type BettingAction,
  type ChipCounts,
  type Denomination,
  type HandExchangeRequest,
  type HandFixtures,
  type HandState,
  type LedgerEvent,
  type LegalActions,
  type PublicSeatView,
  type RivalId,
  type RivalSeatMetadata,
  type TableBoundaryState,
} from '../../engine';
import {
  formatChipBreakdown,
  getPlayerName,
  translateBoundaryError,
  translateHandError,
} from './format';
import { buildHandReview } from './review';
import {
  DEFAULT_SANDBOX_SETTINGS,
  hasTableRuleChanges,
  sanitizeSettings,
} from './settings';
import {
  HERO_PLAYER_ID,
  type HeroActionValidation,
  type HeroDecisionRecord,
  type SandboxSessionState,
  type SandboxSettings,
  type SeatProfileInfo,
} from './types';

export const MAX_BOT_STEPS_PER_HAND = 500;

export function generateUiSeed(): string {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.crypto && 'getRandomValues' in globalThis.crypto) {
      const buf = new Uint32Array(2);
      globalThis.crypto.getRandomValues(buf);
      return `sb-${buf[0]!.toString(36)}-${buf[1]!.toString(36)}`;
    }
  } catch {
    // Fallback below
  }
  return `sb-${Date.now().toString(36)}`;
}

function makeHeroProfile(): SeatProfileInfo {
  return Object.freeze({
    playerId: HERO_PLAYER_ID,
    displayName: 'Bạn (Hero)',
    rivalId: null,
  });
}

function makeRivalProfileInfo(rivalId: RivalId): SeatProfileInfo {
  const profile = getRivalProfile(rivalId);
  return Object.freeze({
    playerId: rivalId,
    displayName: profile.display.name,
    rivalId,
  });
}

function buildHandConfigFromSettings(settings: SandboxSettings, dealerIndex: number) {
  return {
    enablePreflopBetting: settings.enablePreflopBetting,
    preflopCap: settings.preflopCap,
    tieBreakMode: settings.tieBreakMode,
    allowOutOfTurn: settings.allowOutOfTurn,
    dealerIndex,
  };
}

function projectPublicSeats(hand: HandState): PublicSeatView[] {
  return hand.seats.map((s) => ({
    seatIndex: s.seatIndex,
    playerId: s.playerId,
    stack: s.stack,
    status: s.status,
    streetContribution: s.streetContribution,
    totalContribution: s.totalContribution,
    hasActedThisStreet: s.hasActedThisStreet,
    declaration: s.declaration,
    cancelledDeclarationThisStreet: s.cancelledDeclarationThisStreet,
  }));
}

function hasEnoughChips(stack: ChipCounts, needed: ChipCounts): boolean {
  return (
    stack[5] >= needed[5] &&
    stack[10] >= needed[10] &&
    stack[50] >= needed[50] &&
    stack[100] >= needed[100]
  );
}

/**
 * Pure card visibility guard enforcing R8/R15 and showdown eligibility:
 * - Hero always sees own cards.
 * - On fold-win, NO rival cards are revealed.
 * - On showdown, ONLY non-folded players eligible for at least one pot are revealed.
 */
export function isSeatCardsRevealed(hand: HandState, playerId: string): boolean {
  if (playerId === HERO_PLAYER_ID) {
    return true;
  }
  if (hand.outcome === null || hand.outcome.kind === 'fold-win') {
    return false;
  }
  const seat = hand.seats.find((s) => s.playerId === playerId);
  if (seat === undefined || seat.status === 'folded') {
    return false;
  }
  return hand.outcome.resolution.potAwards.some((pot) =>
    pot.eligiblePlayerIds.includes(playerId),
  );
}

/**
 * Returns public rival metadata for rendering on every rival seat (AC B3, B5).
 */
export function getSeatRivalMetadata(
  session: SandboxSessionState,
  playerId: string,
): RivalSeatMetadata | null {
  const profile = session.seatProfiles[playerId];
  if (profile === undefined || profile.rivalId === null) {
    return null;
  }
  const tilt =
    session.phase === 'in-hand' && session.hand?.phase === 'betting'
      ? session.nongTiltStateAtHandStart
      : session.nongTiltState;
  return getRivalSeatMetadata(
    profile.rivalId,
    profile.rivalId === NONG_RIVAL_ID ? tilt : undefined,
  );
}

/**
 * Finalizes a hand when it reaches `complete` (builds review, updates Nóng tilt, and applies
 * pending T2 Hero mid-hand leave at boundary if requested).
 */
function finalizeCompletedHand(
  session: SandboxSessionState,
  completedHand: HandState,
  decisions: readonly HeroDecisionRecord[],
): SandboxSessionState {
  const sessionRng = createRng(session.sessionSeed);
  const handRng = sessionRng.fork(`hand-${session.handNumber}`);

  const review = buildHandReview({
    handNumber: session.handNumber,
    hand: completedHand,
    heroId: HERO_PLAYER_ID,
    decisions,
    seatProfiles: session.seatProfiles,
    nongTiltStateDuringHand: session.nongTiltStateAtHandStart,
    reviewRng: handRng.fork('review'),
    lang: session.appliedSettings.terminology,
  });

  const publicSummary = summarizeCompletedHandForRivals(completedHand);
  const nextTiltState = updateNongTiltStateAtBoundary(
    session.nongTiltState,
    publicSummary,
    handRng.fork('nong-tilt'),
    NONG_RIVAL_ID,
  );

  let nextSession: SandboxSessionState = {
    ...session,
    hand: completedHand,
    nongTiltState: nextTiltState,
    heroDecisionsCurrentHand: decisions,
    lastHandReview: review,
    stagedChips: emptyChips(),
    stagedHistory: [],
  };

  // T2: If hero requested leave mid-hand, transition to boundary and cash out hero now.
  if (session.pendingHeroLeave) {
    const boundaryRes = createBoundaryFromHand(completedHand);
    if (boundaryRes.ok) {
      const leaveRes = leaveTableAtBoundary(boundaryRes.state, HERO_PLAYER_ID);
      if (leaveRes.ok) {
        const returnedVal = chipValue(leaveRes.returnedChips);
        nextSession = {
          ...nextSession,
          phase: 'between-hands',
          boundary: leaveRes.state,
          ledgerEvents: [...nextSession.ledgerEvents, ...leaveRes.ledgerEvents],
          pendingHeroLeave: false,
          statusNotice: {
            tone: 'info',
            message: `Bạn đã rời bàn ở ranh giới ván #${session.handNumber} và cash out ${returnedVal} điểm về kho.`,
            guidance: 'Các chip đã góp vào pot trong ván vừa rồi được giữ đúng luật. Bạn có thể ngồi lại bàn (+500) hoặc xem Sổ phiên.',
          },
        };
      }
    }
  }

  return nextSession;
}

/**
 * Starts a fresh Sandbox session with buy-in 500 per player, 6,500 physical chip set,
 * shuffled distinct rivals, ledger buy-in records, and immediately deals Hand #1.
 */
export function createSandboxSession(options?: {
  readonly seed?: string;
  readonly settings?: Partial<SandboxSettings>;
  readonly fixtures?: HandFixtures;
}): SandboxSessionState {
  const seed = options?.seed ?? generateUiSeed();
  const mergedRaw = {
    ...DEFAULT_SANDBOX_SETTINGS,
    ...options?.settings,
    audio: {
      ...DEFAULT_SANDBOX_SETTINGS.audio,
      ...options?.settings?.audio,
    },
  };
  const { settings } = sanitizeSettings(mergedRaw);
  const sessionRng = createRng(seed);

  const dist = initialDistribution(settings.playerCount);
  const rivalSelect = selectRivalsForTable({
    rng: sessionRng.fork('table-setup'),
    totalPlayers: settings.playerCount,
    heroSeatIndex: 0,
    enabledRivalIds: settings.enabledRivalIds,
  });

  if (!rivalSelect.ok) {
    throw new Error(`Failed to initialize table rivals: ${rivalSelect.message}`);
  }

  const seatProfiles: Record<string, SeatProfileInfo> = {
    [HERO_PLAYER_ID]: makeHeroProfile(),
  };

  const initialSeats: Array<{ seatIndex: number; playerId: string; stack: ChipCounts }> = [
    { seatIndex: 0, playerId: HERO_PLAYER_ID, stack: dist.perPlayer },
  ];
  const ledgerEvents: LedgerEvent[] = [
    { type: 'buy-in', playerId: HERO_PLAYER_ID, chips: dist.perPlayer },
  ];

  for (const assignment of rivalSelect.assignments) {
    seatProfiles[assignment.rivalId] = makeRivalProfileInfo(assignment.rivalId);
    initialSeats.push({
      seatIndex: assignment.seatIndex,
      playerId: assignment.rivalId,
      stack: dist.perPlayer,
    });
    ledgerEvents.push({
      type: 'buy-in',
      playerId: assignment.rivalId,
      chips: dist.perPlayer,
    });
  }

  initialSeats.sort((a, b) => a.seatIndex - b.seatIndex);
  const initialTilt = createInitialNongTiltState();

  const handRng = sessionRng.fork('hand-1');
  const started = startHand({
    seats: initialSeats,
    bank: dist.bank,
    rng: handRng.fork('engine'),
    config: buildHandConfigFromSettings(settings, 0),
    fixtures: options?.fixtures,
  });

  if (!started.ok) {
    throw new Error(`Failed to start initial hand: ${started.message}`);
  }

  const baseSession: SandboxSessionState = {
    sessionSeed: seed,
    handNumber: 1,
    phase: 'in-hand',
    appliedSettings: settings,
    pendingSettings: null,
    hand: started.state,
    boundary: null,
    ledgerEvents,
    nongTiltState: initialTilt,
    nongTiltStateAtHandStart: initialTilt,
    seatProfiles,
    stagedChips: emptyChips(),
    stagedHistory: [],
    pendingHeroLeave: false,
    heroDecisionsCurrentHand: [],
    lastHandReview: null,
    stepCounter: 0,
    inviteCounter: 0,
    ootContextKey: null,
    ootEvaluatedPlayers: [],
    statusNotice: null,
  };

  if (started.state.phase === 'complete') {
    return finalizeCompletedHand(baseSession, started.state, []);
  }

  return baseSession;
}

export function stageChip(session: SandboxSessionState, denom: Denomination): SandboxSessionState {
  if (session.phase !== 'in-hand' || session.hand === null || session.hand.phase !== 'betting') {
    return session;
  }
  const heroSeat = session.hand.seats.find((s) => s.playerId === HERO_PLAYER_ID);
  if (heroSeat === undefined || heroSeat.status !== 'active') {
    return session;
  }
  const nextCount = session.stagedChips[denom] + 1;
  if (nextCount > heroSeat.stack[denom]) {
    return {
      ...session,
      statusNotice: {
        tone: 'warning',
        message: `Bạn không còn thêm chip mệnh giá ${denom} để chọn.`,
        guidance: 'Chọn mệnh giá khác hoặc mở "Đổi chip" để đổi chip lớn lấy chip nhỏ.',
      },
    };
  }
  return {
    ...session,
    stagedChips: {
      ...session.stagedChips,
      [denom]: nextCount,
    },
    stagedHistory: [...session.stagedHistory, denom],
    statusNotice: null,
  };
}

export function unstageChip(session: SandboxSessionState, denom: Denomination): SandboxSessionState {
  if (session.stagedChips[denom] <= 0) {
    return session;
  }
  const nextHistory = [...session.stagedHistory];
  const lastIdx = nextHistory.lastIndexOf(denom);
  if (lastIdx !== -1) {
    nextHistory.splice(lastIdx, 1);
  }
  return {
    ...session,
    stagedChips: {
      ...session.stagedChips,
      [denom]: session.stagedChips[denom] - 1,
    },
    stagedHistory: nextHistory,
    statusNotice: null,
  };
}

export function unstageLastChip(session: SandboxSessionState): SandboxSessionState {
  if (session.stagedHistory.length === 0) {
    return session;
  }
  const lastDenom = session.stagedHistory[session.stagedHistory.length - 1]!;
  return unstageChip(session, lastDenom);
}

export function clearStagedChips(session: SandboxSessionState): SandboxSessionState {
  if (chipValue(session.stagedChips) === 0 && session.stagedHistory.length === 0) {
    return session;
  }
  return {
    ...session,
    stagedChips: emptyChips(),
    stagedHistory: [],
  };
}

/**
 * Evaluates C2 physical chip validation and X4–X6 out-of-turn eligibility for Hero.
 */
export function getHeroActionValidation(session: SandboxSessionState): HeroActionValidation {
  const emptyValidation: HeroActionValidation = {
    isHeroTurn: false,
    canDeclareOutOfTurn: false,
    hasBindingDeclaration: false,
    stagedValue: chipValue(session.stagedChips),
    legalActions: null,
    canFold: false,
    foldNeedsConfirm: false,
    canCheck: false,
    canConfirmCall: false,
    callAmount: null,
    isCallAllIn: false,
    canConfirmBet: false,
    betAmount: null,
    canConfirmRaise: false,
    raiseToAmount: null,
    raiseAddedAmount: null,
    validationHintVi: null,
  };

  if (session.phase !== 'in-hand' || session.hand === null || session.hand.phase !== 'betting') {
    return emptyValidation;
  }

  const hand = session.hand;
  const heroSeat = hand.seats.find((s) => s.playerId === HERO_PLAYER_ID);
  if (heroSeat === undefined || heroSeat.status !== 'active') {
    return emptyValidation;
  }

  const isHeroTurn = hand.activePlayerId === HERO_PLAYER_ID;
  const hasBindingDeclaration = heroSeat.declaration !== null;
  const hasUpcomingTurn =
    !heroSeat.hasActedThisStreet || heroSeat.streetContribution < hand.currentBet;
  const canDeclareOutOfTurn =
    !isHeroTurn &&
    hand.config.allowOutOfTurn &&
    !hasBindingDeclaration &&
    hasUpcomingTurn;

  if (!isHeroTurn && !canDeclareOutOfTurn) {
    return {
      ...emptyValidation,
      hasBindingDeclaration,
    };
  }

  const legalActions: LegalActions | null = isHeroTurn
    ? getLegalActions(hand)
    : computePublicLegalActionsForSeat(
        projectPublicSeats(hand),
        HERO_PLAYER_ID,
        hand.street,
        hand.streetCap,
        hand.currentBet,
      );

  if (legalActions === null) {
    return {
      ...emptyValidation,
      isHeroTurn,
      canDeclareOutOfTurn,
      hasBindingDeclaration,
    };
  }

  const staged = session.stagedChips;
  const stagedValue = chipValue(staged);
  const ownsStaged = hasEnoughChips(heroSeat.stack, staged);

  const canConfirmCall =
    legalActions.canCall &&
    legalActions.callAmount !== null &&
    ownsStaged &&
    selectionMatches(staged, legalActions.callAmount);

  const canConfirmBet =
    legalActions.canBet &&
    legalActions.betRange !== null &&
    ownsStaged &&
    stagedValue >= legalActions.betRange.min &&
    stagedValue <= legalActions.betRange.max &&
    stagedValue % BET_STEP === 0;

  const candidateRaiseTo = heroSeat.streetContribution + stagedValue;
  const canConfirmRaise =
    legalActions.canRaise &&
    legalActions.raiseRange !== null &&
    ownsStaged &&
    stagedValue > 0 &&
    candidateRaiseTo >= legalActions.raiseRange.min &&
    candidateRaiseTo <= legalActions.raiseRange.max &&
    candidateRaiseTo % BET_STEP === 0;

  let validationHintVi: string | null = null;
  if (stagedValue > 0 && !canConfirmCall && !canConfirmBet && !canConfirmRaise) {
    if (legalActions.canCall && legalActions.callAmount !== null && !legalActions.canRaise) {
      validationHintVi = `Đã chọn ${stagedValue} điểm — cần chọn đúng ${legalActions.callAmount} điểm để Call (đã chạm cap ${legalActions.streetCap} hoặc không thể raise).`;
    } else if (legalActions.canCall && legalActions.callAmount !== null && legalActions.raiseRange !== null) {
      validationHintVi = `Đã chọn ${stagedValue} điểm — chọn đúng ${legalActions.callAmount} để Call, hoặc chọn thêm để Raise lên ${legalActions.raiseRange.min}–${legalActions.raiseRange.max} (bội số 5).`;
    } else if (legalActions.canBet && legalActions.betRange !== null) {
      validationHintVi = `Đã chọn ${stagedValue} điểm — mức Bet hợp lệ là bội số 5 từ ${legalActions.betRange.min} đến ${legalActions.betRange.max}.`;
    } else {
      validationHintVi = `Tổng chip đã chọn (${stagedValue}) chưa khớp mức cược hợp lệ.`;
    }
  } else if (
    stagedValue === 0 &&
    legalActions.canCall &&
    legalActions.callAmount !== null
  ) {
    validationHintVi = `Bấm chip từ stack để chọn đúng ${legalActions.callAmount} điểm cho lệnh Call${legalActions.canRaise && legalActions.raiseRange ? `, hoặc nhiều hơn để Raise (lên ${legalActions.raiseRange.min}–${legalActions.raiseRange.max})` : ''}.`;
  }

  return {
    isHeroTurn,
    canDeclareOutOfTurn,
    hasBindingDeclaration,
    stagedValue,
    legalActions,
    canFold: isHeroTurn && legalActions.canFold,
    foldNeedsConfirm: isHeroTurn && legalActions.canCheck,
    canCheck: legalActions.canCheck,
    canConfirmCall,
    callAmount: legalActions.callAmount,
    isCallAllIn: legalActions.isCallAllIn,
    canConfirmBet,
    betAmount: canConfirmBet ? stagedValue : null,
    canConfirmRaise,
    raiseToAmount: canConfirmRaise ? candidateRaiseTo : null,
    raiseAddedAmount: canConfirmRaise ? stagedValue : null,
    validationHintVi,
  };
}

function captureHeroDecisionRecord(
  hand: HandState,
  chosenAction: BettingAction,
  decisionIndex: number,
  fromOutOfTurn: boolean,
): HeroDecisionRecord {
  const snapshot = extractDecisionSnapshot(hand, HERO_PLAYER_ID);
  const potOdds = calculatePotOddsFromSnapshot(snapshot);
  const activeOpponentIds = hand.seats
    .filter((s) => s.playerId !== HERO_PLAYER_ID && s.status !== 'folded')
    .map((s) => s.playerId);

  return Object.freeze({
    decisionIndex,
    street: hand.street,
    snapshot,
    handStateAtDecision: hand,
    chosenAction,
    fromOutOfTurn,
    potOdds,
    activeOpponentIds: Object.freeze(activeOpponentIds),
    timelineLengthAtDecision: hand.timeline.length,
  });
}

function makeActionForHero(
  validation: HeroActionValidation,
  stagedChips: ChipCounts,
  actionType: 'fold' | 'check' | 'call' | 'bet' | 'raise',
): BettingAction | null {
  switch (actionType) {
    case 'fold':
      return { type: 'fold' };
    case 'check':
      return { type: 'check' };
    case 'call':
      return { type: 'call', chips: { ...stagedChips } };
    case 'bet':
      return { type: 'bet', amount: chipValue(stagedChips), chips: { ...stagedChips } };
    case 'raise': {
      if (validation.raiseToAmount === null) {
        const heroContrib = validation.legalActions?.playerStreetContribution ?? 0;
        return {
          type: 'raise',
          raiseTo: heroContrib + chipValue(stagedChips),
          chips: { ...stagedChips },
        };
      }
      return {
        type: 'raise',
        raiseTo: validation.raiseToAmount,
        chips: { ...stagedChips },
      };
    }
  }
}

/**
 * Executes Hero's turn action (fold / check / call / bet / raise) through `applyAction`,
 * capturing the exact decision-time snapshot for end-of-hand review.
 */
export function performHeroAction(
  session: SandboxSessionState,
  actionType: 'fold' | 'check' | 'call' | 'bet' | 'raise',
): SandboxSessionState {
  if (session.phase !== 'in-hand' || session.hand === null) {
    return session;
  }

  const validation = getHeroActionValidation(session);
  const action = makeActionForHero(validation, session.stagedChips, actionType);
  if (action === null) {
    return session;
  }

  const preHand = session.hand;
  const result = applyAction(preHand, HERO_PLAYER_ID, action);
  if (!result.ok) {
    const translated = translateHandError(result.code, result.message);
    return {
      ...session,
      statusNotice: {
        tone: 'error',
        message: translated.message,
        guidance: translated.guidance,
      },
    };
  }

  const nextDecisions = [
    ...session.heroDecisionsCurrentHand,
    captureHeroDecisionRecord(
      preHand,
      action,
      session.heroDecisionsCurrentHand.length,
      false,
    ),
  ];

  const nextContextKey = `${session.handNumber}:${result.state.street}:${result.state.currentBet}`;
  const resetOot = nextContextKey !== session.ootContextKey;

  let notice = null as SandboxSessionState['statusNotice'];
  if (result.state.phase === 'awaiting-payout') {
    notice = {
      tone: 'warning',
      message: 'Showdown xong nhưng Pot đang thiếu mệnh giá chip lẻ để chia chính xác.',
      guidance: 'Mở "Đổi chip với Pot" để đổi chip lớn trong Pot lấy chip nhỏ rồi thanh toán.',
    };
  }

  const updated: SandboxSessionState = {
    ...session,
    hand: result.state,
    stagedChips: emptyChips(),
    stagedHistory: [],
    heroDecisionsCurrentHand: nextDecisions,
    stepCounter: session.stepCounter + 1,
    ootContextKey: resetOot ? nextContextKey : session.ootContextKey,
    ootEvaluatedPlayers: resetOot ? [] : session.ootEvaluatedPlayers,
    statusNotice: notice,
  };

  if (result.state.phase === 'complete') {
    return finalizeCompletedHand(updated, result.state, nextDecisions);
  }
  return updated;
}

/**
 * Declares an out-of-turn action for Hero (X4–X6, D39c).
 */
export function performHeroOutOfTurn(
  session: SandboxSessionState,
  actionType: 'check' | 'call' | 'bet' | 'raise',
): SandboxSessionState {
  if (session.phase !== 'in-hand' || session.hand === null) {
    return session;
  }

  const validation = getHeroActionValidation(session);
  const action = makeActionForHero(validation, session.stagedChips, actionType);
  if (action === null) {
    return session;
  }

  const result = declareOutOfTurn(session.hand, HERO_PLAYER_ID, action);
  if (!result.ok) {
    const translated = translateHandError(result.code, result.message);
    return {
      ...session,
      statusNotice: {
        tone: 'error',
        message: translated.message,
        guidance: translated.guidance,
      },
    };
  }

  return {
    ...session,
    hand: result.state,
    stagedChips: emptyChips(),
    stagedHistory: [],
    statusNotice: {
      tone: 'info',
      message: 'Đã hô trước lượt! Chip đã đẩy ra trước mặt (chưa vào pot) và sẽ tự thực hiện nếu mức cược không đổi.',
      guidance: 'Theo luật X6, không thể rút lời hô khi cược chưa đổi; nếu đối thủ bet/raise, lời hô tự hủy và chip trả về stack.',
    },
  };
}

/**
 * Tournament timeout helper (AC O1, O2):
 * Returns staged chips to stack, checks if legal, otherwise folds.
 */
export function performHeroAutoTimeout(session: SandboxSessionState): SandboxSessionState {
  if (
    session.phase !== 'in-hand' ||
    session.hand === null ||
    session.hand.phase !== 'betting' ||
    session.hand.activePlayerId !== HERO_PLAYER_ID
  ) {
    return session;
  }

  const cleared = clearStagedChips(session);
  const legal = getLegalActions(cleared.hand!);
  if (legal === null) {
    return cleared;
  }

  const next = performHeroAction(cleared, legal.canCheck ? 'check' : 'fold');
  return {
    ...next,
    statusNotice: {
      tone: 'warning',
      message: legal.canCheck
        ? 'Hết giờ: hệ thống tự Check (O1).'
        : 'Hết giờ: hệ thống tự Fold và trả chip chưa xác nhận về stack (O2).',
    },
  };
}

/**
 * Handles Hero requesting to leave table (T1 between hands, T2 mid-hand).
 * Mid-hand: marks `pendingHeroLeave`, folds at the first legal opportunity,
 * keeps contributed chips in pot, and cashes out Hero's remaining stack at hand boundary.
 */
export function requestHeroLeave(session: SandboxSessionState): SandboxSessionState {
  if (session.phase === 'between-hands' && session.boundary !== null) {
    return cashOutPlayerAtBoundary(session, HERO_PLAYER_ID);
  }

  if (session.phase !== 'in-hand' || session.hand === null) {
    return session;
  }

  if (session.hand.phase === 'complete') {
    const atBoundary = enterHandBoundary(session);
    return cashOutPlayerAtBoundary(atBoundary, HERO_PLAYER_ID);
  }

  const marked: SandboxSessionState = {
    ...session,
    pendingHeroLeave: true,
    stagedChips: emptyChips(),
    stagedHistory: [],
    statusNotice: {
      tone: 'info',
      message: 'Đã đăng ký rời bàn giữa ván (T2): bạn sẽ fold ở cơ hội hợp lệ sớm nhất và cash out ở ranh giới ván.',
      guidance: 'Chip bạn đã bỏ vào pot sẽ ở lại pot theo đúng luật.',
    },
  };

  if (
    marked.hand !== null &&
    marked.hand.phase === 'betting' &&
    marked.hand.activePlayerId === HERO_PLAYER_ID
  ) {
    return performHeroAction(marked, 'fold');
  }

  return marked;
}

/**
 * Advances exactly ONE automated step in the current hand:
 * - Auto-folds Hero if `pendingHeroLeave` is active and it is Hero's turn (T2).
 * - Optionally evaluates one eligible rival's out-of-turn declaration via public DTO (`buildRivalDecisionInput`).
 * - Executes the active rival's turn via `buildRivalDecisionInput` -> `decideRivalAction` -> `applyAction`.
 * Never processes a non-bot turn or loops infinitely.
 */
export function stepOneBotTurn(session: SandboxSessionState): SandboxSessionState {
  if (session.phase !== 'in-hand' || session.hand === null || session.hand.phase !== 'betting') {
    return session;
  }

  const hand = session.hand;
  const activeId = hand.activePlayerId;
  if (activeId === null) {
    return session;
  }

  // T2: Auto-fold hero on their turn if mid-hand leave was requested
  if (activeId === HERO_PLAYER_ID) {
    if (session.pendingHeroLeave) {
      return performHeroAction(session, 'fold');
    }
    return session;
  }

  const sessionRng = createRng(session.sessionSeed);
  const handRng = sessionRng.fork(`hand-${session.handNumber}`);
  const contextKey = `${session.handNumber}:${hand.street}:${hand.currentBet}`;
  const evaluatedThisContext =
    session.ootContextKey === contextKey ? session.ootEvaluatedPlayers : [];

  // Optional out-of-turn declaration check for one eligible waiting rival (at most once per contextKey)
  if (hand.config.allowOutOfTurn) {
    const activeIdx = hand.activePlayerIndex ?? 0;
    const seatCount = hand.seats.length;
    for (let offset = 1; offset < seatCount; offset++) {
      const candidateSeat = hand.seats[(activeIdx + offset) % seatCount]!;
      const candId = candidateSeat.playerId;
      if (
        candId === HERO_PLAYER_ID ||
        candidateSeat.status !== 'active' ||
        candidateSeat.declaration !== null ||
        evaluatedThisContext.includes(candId) ||
        (candidateSeat.hasActedThisStreet && candidateSeat.streetContribution === hand.currentBet)
      ) {
        continue;
      }

      const profile = session.seatProfiles[candId];
      if (profile === undefined || profile.rivalId === null) {
        continue;
      }

      const dto = buildRivalDecisionInput(hand, candId, {
        rivalId: profile.rivalId,
        tiltState:
          profile.rivalId === NONG_RIVAL_ID ? session.nongTiltStateAtHandStart : undefined,
      });
      const ootRng = handRng.fork(`bot-oot-${session.stepCounter}-${candId}`);
      const ootResult = decideRivalOutOfTurn(dto, ootRng);
      const nextEvaluated = [...evaluatedThisContext, candId];

      if (ootResult.action !== null) {
        const declared = declareOutOfTurn(hand, candId, ootResult.action);
        if (declared.ok) {
          return {
            ...session,
            hand: declared.state,
            stepCounter: session.stepCounter + 1,
            ootContextKey: contextKey,
            ootEvaluatedPlayers: nextEvaluated,
          };
        }
      }

      // Record that we evaluated this candidate at this context and still proceed to active bot turn
      return stepActiveRivalTurn(
        {
          ...session,
          ootContextKey: contextKey,
          ootEvaluatedPlayers: nextEvaluated,
        },
        handRng,
      );
    }
  }

  return stepActiveRivalTurn(
    {
      ...session,
      ootContextKey: contextKey,
      ootEvaluatedPlayers: evaluatedThisContext,
    },
    handRng,
  );
}

function stepActiveRivalTurn(
  session: SandboxSessionState,
  handRng: ReturnType<typeof createRng>,
): SandboxSessionState {
  const hand = session.hand!;
  const activeId = hand.activePlayerId!;
  const profile = session.seatProfiles[activeId];
  if (profile === undefined || profile.rivalId === null) {
    return session;
  }

  const dto = buildRivalDecisionInput(hand, activeId, {
    rivalId: profile.rivalId,
    tiltState:
      profile.rivalId === NONG_RIVAL_ID ? session.nongTiltStateAtHandStart : undefined,
  });
  const decisionRng = handRng.fork(`bot-turn-${session.stepCounter}-${activeId}`);
  const decision = decideRivalAction(dto, decisionRng);

  const preHand = hand;
  const applied = applyAction(preHand, activeId, decision.action);
  if (!applied.ok) {
    // Safety fallback: legal check or fold so bot can never stall the table
    const legal = getLegalActions(preHand);
    const fallbackAction: BettingAction =
      legal !== null && legal.canCheck ? { type: 'check' } : { type: 'fold' };
    const fallbackApplied = applyAction(preHand, activeId, fallbackAction);
    if (!fallbackApplied.ok) {
      return {
        ...session,
        statusNotice: {
          tone: 'error',
          message: `Bot ${profile.displayName} không thể thực hiện hành động: ${fallbackApplied.message}`,
        },
      };
    }
    return finishBotStep(session, preHand, fallbackApplied);
  }

  return finishBotStep(session, preHand, applied);
}

function finishBotStep(
  session: SandboxSessionState,
  preHand: HandState,
  applied: Extract<ReturnType<typeof applyAction>, { ok: true }>,
): SandboxSessionState {
  let nextDecisions = session.heroDecisionsCurrentHand;

  // If Hero had a binding out-of-turn declaration that auto-executed on this step, record it for review
  const heroAutoExec = applied.autoExecutedDeclarations.find(
    (d) => d.playerId === HERO_PLAYER_ID,
  );
  if (heroAutoExec !== undefined) {
    nextDecisions = [
      ...nextDecisions,
      captureHeroDecisionRecord(
        preHand,
        heroAutoExec.action,
        nextDecisions.length,
        true,
      ),
    ];
  }

  const heroCancelled = applied.cancelledDeclarations.find(
    (d) => d.playerId === HERO_PLAYER_ID,
  );

  const nextContextKey = `${session.handNumber}:${applied.state.street}:${applied.state.currentBet}`;
  const resetOot = nextContextKey !== session.ootContextKey;

  let notice = session.statusNotice;
  if (heroCancelled !== undefined) {
    notice = {
      tone: 'warning',
      message:
        'Lời hô trước của bạn đã bị hủy vì mức cược thay đổi — chip đã trả về stack, bạn được quyết định lại tự do!',
    };
  } else if (applied.state.phase === 'awaiting-payout') {
    notice = {
      tone: 'warning',
      message: 'Showdown xong nhưng Pot đang thiếu mệnh giá chip lẻ để chia chính xác.',
      guidance: 'Mở "Đổi chip với Pot" để đổi chip lớn trong Pot lấy chip nhỏ rồi bấm "Thanh toán Pot".',
    };
  }

  const updated: SandboxSessionState = {
    ...session,
    hand: applied.state,
    heroDecisionsCurrentHand: nextDecisions,
    stepCounter: session.stepCounter + 1,
    ootContextKey: resetOot ? nextContextKey : session.ootContextKey,
    ootEvaluatedPlayers: resetOot ? [] : session.ootEvaluatedPlayers,
    statusNotice: notice,
  };

  if (applied.state.phase === 'complete') {
    return finalizeCompletedHand(updated, applied.state, nextDecisions);
  }

  return updated;
}

/**
 * Performs an equal-value chip exchange during a hand (betting OR awaiting-payout) via `exchangeHandChips`.
 */
export function exchangeInHand(
  session: SandboxSessionState,
  request: HandExchangeRequest,
): SandboxSessionState {
  if (session.phase !== 'in-hand' || session.hand === null) {
    return session;
  }

  const res = exchangeHandChips(session.hand, request);
  if (!res.ok) {
    const translated = translateHandError(res.code, res.message);
    return {
      ...session,
      statusNotice: {
        tone: 'error',
        message: translated.message,
        guidance: translated.guidance,
      },
    };
  }

  const targetName =
    request.target.kind === 'pot'
      ? 'Pot'
      : getPlayerName(request.target.playerId, session.seatProfiles);
  const fromName = getPlayerName(request.fromPlayerId, session.seatProfiles);

  const nextSession: SandboxSessionState = {
    ...session,
    hand: res.state,
    stagedChips: emptyChips(),
    stagedHistory: [],
    statusNotice: {
      tone: 'success',
      message: `Đổi chip thành công: ${fromName} đưa ${formatChipBreakdown(request.give)} lấy ${formatChipBreakdown(request.receive)} từ ${targetName}.`,
    },
  };

  // If awaiting payout and pot can now be settled cleanly, indicate readiness (or settle directly if caller calls settleAwaitingPayout)
  if (
    res.state.phase === 'awaiting-payout' &&
    res.state.pendingPayout !== null &&
    planPotPayouts(res.state.pot, res.state.pendingPayout.requiredPayouts) !== null
  ) {
    return {
      ...nextSession,
      statusNotice: {
        tone: 'success',
        message: 'Pot đã đủ mệnh giá chip lẻ! Bấm "Thanh toán Pot" để hoàn tất ván.',
      },
    };
  }

  return nextSession;
}

/**
 * Settles a pending showdown payout after pot denominations have been exchanged.
 */
export function settleAwaitingPayout(session: SandboxSessionState): SandboxSessionState {
  if (session.phase !== 'in-hand' || session.hand === null) {
    return session;
  }

  const res = settlePendingPayout(session.hand);
  if (!res.ok) {
    const translated = translateHandError(res.code, res.message);
    return {
      ...session,
      statusNotice: {
        tone: 'error',
        message: translated.message,
        guidance: translated.guidance,
      },
    };
  }

  return finalizeCompletedHand(
    {
      ...session,
      statusNotice: {
        tone: 'success',
        message: 'Đã thanh toán pot thành công.',
      },
    },
    res.state,
    session.heroDecisionsCurrentHand,
  );
}

/**
 * Transitions from a completed hand into the between-hands table boundary state,
 * applying any queued table settings changes at the boundary.
 */
export function enterHandBoundary(session: SandboxSessionState): SandboxSessionState {
  if (session.phase === 'between-hands' && session.boundary !== null) {
    return reconcilePendingSettingsAtBoundary(session);
  }
  if (session.hand === null) {
    return session;
  }

  const boundaryRes = createBoundaryFromHand(session.hand);
  if (!boundaryRes.ok) {
    const translated = translateBoundaryError(boundaryRes.code, boundaryRes.message);
    return {
      ...session,
      statusNotice: {
        tone: 'error',
        message: translated.message,
        guidance: translated.guidance,
      },
    };
  }

  const atBoundary: SandboxSessionState = {
    ...session,
    phase: 'between-hands',
    boundary: boundaryRes.state,
    stagedChips: emptyChips(),
    stagedHistory: [],
  };

  return reconcilePendingSettingsAtBoundary(atBoundary);
}

function findNextFreeSeatIndex(boundary: TableBoundaryState): number | null {
  const occupied = new Set(boundary.seats.map((s) => s.seatIndex));
  for (let i = 0; i < MAX_PLAYERS; i++) {
    if (!occupied.has(i)) {
      return i;
    }
  }
  return null;
}

function reconcilePendingSettingsAtBoundary(session: SandboxSessionState): SandboxSessionState {
  if (session.pendingSettings === null || session.boundary === null) {
    return session;
  }

  const nextSettings = session.pendingSettings;
  let current: SandboxSessionState = {
    ...session,
    appliedSettings: nextSettings,
    pendingSettings: null,
  };

  // Remove any seated rival that was disabled in the new settings
  const enabledSet = new Set<RivalId>(nextSettings.enabledRivalIds);
  for (const seat of [...current.boundary!.seats]) {
    if (seat.playerId === HERO_PLAYER_ID) {
      continue;
    }
    const profile = current.seatProfiles[seat.playerId];
    if (profile?.rivalId !== null && profile?.rivalId !== undefined && !enabledSet.has(profile.rivalId)) {
      current = cashOutPlayerAtBoundary(current, seat.playerId);
    }
  }

  // Trim excess rivals if target playerCount decreased
  while (current.boundary!.seats.length > nextSettings.playerCount) {
    const removable = [...current.boundary!.seats]
      .reverse()
      .find((s) => s.playerId !== HERO_PLAYER_ID);
    if (removable === undefined) {
      break;
    }
    current = cashOutPlayerAtBoundary(current, removable.playerId);
  }

  // Invite additional enabled rivals if target playerCount increased
  while (current.boundary!.seats.length < nextSettings.playerCount) {
    const beforeLen = current.boundary!.seats.length;
    current = inviteRivalAtBoundary(current);
    if (current.boundary!.seats.length === beforeLen) {
      break;
    }
  }

  return {
    ...current,
    statusNotice: {
      tone: 'info',
      message: 'Đã áp dụng thay đổi cài đặt bàn ở ranh giới ván.',
    },
  };
}

/**
 * Exchanges chips between two seated players at the between-hands boundary (e.g., to obtain a 5-chip for ante).
 */
export function exchangeAtBoundary(
  session: SandboxSessionState,
  fromPlayerId: string,
  toPlayerId: string,
  give: ChipCounts,
  receive: ChipCounts,
): SandboxSessionState {
  if (session.phase !== 'between-hands' || session.boundary === null) {
    return session;
  }
  if (fromPlayerId === toPlayerId) {
    return {
      ...session,
      statusNotice: {
        tone: 'error',
        message: 'Không thể tự đổi chip với chính mình.',
      },
    };
  }

  const boundary = session.boundary;
  const fromSeat = boundary.seats.find((s) => s.playerId === fromPlayerId);
  const toSeat = boundary.seats.find((s) => s.playerId === toPlayerId);
  if (fromSeat === undefined || toSeat === undefined) {
    return {
      ...session,
      statusNotice: {
        tone: 'error',
        message: 'Không tìm thấy ghế hợp lệ để đổi chip ở ranh giới ván.',
      },
    };
  }

  if (chipValue(give) === 0 || chipValue(give) !== chipValue(receive)) {
    return {
      ...session,
      statusNotice: {
        tone: 'error',
        message: 'Tổng giá trị chip đưa và chip nhận phải dương và bằng nhau.',
      },
    };
  }

  try {
    const swapped = exchangeChips(fromSeat.stack, toSeat.stack, give, receive);
    const nextSeats = boundary.seats.map((s) => {
      if (s.playerId === fromPlayerId) {
        return { ...s, stack: swapped.a };
      }
      if (s.playerId === toPlayerId) {
        return { ...s, stack: swapped.b };
      }
      return s;
    });

    const inv1 = checkInv1([boundary.bank, ...nextSeats.map((s) => s.stack)]);
    if (!inv1.ok) {
      return {
        ...session,
        statusNotice: {
          tone: 'error',
          message: `Phép đổi chip vi phạm bất biến bộ chip (INV-1): ${JSON.stringify(inv1.diff)}`,
        },
      };
    }

    return {
      ...session,
      boundary: {
        ...boundary,
        seats: nextSeats,
      },
      statusNotice: {
        tone: 'success',
        message: `Đã đổi chip ở ranh giới: ${getPlayerName(fromPlayerId, session.seatProfiles)} nhận ${formatChipBreakdown(receive)} từ ${getPlayerName(toPlayerId, session.seatProfiles)}.`,
      },
    };
  } catch (err) {
    return {
      ...session,
      statusNotice: {
        tone: 'error',
        message: err instanceof Error ? err.message : 'Không thể đổi chip ở ranh giới.',
        guidance: 'Kiểm tra lại số lượng từng mệnh giá chip hai bên đang sở hữu.',
      },
    };
  }
}

/**
 * Rebuys 500 for a 0-chip seated player at boundary (T3, C4–C6).
 */
export function rebuyPlayerAtBoundary(
  session: SandboxSessionState,
  playerId: string,
): SandboxSessionState {
  if (session.phase !== 'between-hands' || session.boundary === null) {
    return session;
  }

  const res = rebuyAtBoundary(session.boundary, playerId);
  if (!res.ok) {
    const translated = translateBoundaryError(res.code, res.message);
    return {
      ...session,
      statusNotice: {
        tone: 'error',
        message: translated.message,
        guidance: translated.guidance,
      },
    };
  }

  const buyerName = getPlayerName(playerId, session.seatProfiles);
  const forcedCashOutNote =
    res.plan.kind === 'cash-out-then-bank'
      ? ` (Kho thiếu chip: ${getPlayerName(res.plan.cashOutPlayerId, session.seatProfiles)} đã tự động cash out 500 về kho theo luật C5/C6.)`
      : '';

  return {
    ...session,
    boundary: res.state,
    ledgerEvents: [...session.ledgerEvents, ...res.ledgerEvents],
    statusNotice: {
      tone: 'success',
      message: `${buyerName} đã Rebuy 500 (${formatChipBreakdown(res.plan.chips)}).${forcedCashOutNote}`,
    },
  };
}

/**
 * Cashes out a seated player at boundary and returns their full stack to the bank (T1, T3).
 */
export function cashOutPlayerAtBoundary(
  session: SandboxSessionState,
  playerId: string,
): SandboxSessionState {
  if (session.phase !== 'between-hands' || session.boundary === null) {
    return session;
  }

  const res = leaveTableAtBoundary(session.boundary, playerId);
  if (!res.ok) {
    const translated = translateBoundaryError(res.code, res.message);
    return {
      ...session,
      statusNotice: {
        tone: 'error',
        message: translated.message,
        guidance: translated.guidance,
      },
    };
  }

  const playerName = getPlayerName(playerId, session.seatProfiles);
  const returnedValue = chipValue(res.returnedChips);

  return {
    ...session,
    boundary: res.state,
    ledgerEvents: [...session.ledgerEvents, ...res.ledgerEvents],
    statusNotice: {
      tone: 'info',
      message: `${playerName} đã cash out ${returnedValue} điểm và rời bàn (chip đã trả về kho).`,
    },
  };
}

/**
 * Invites an unseated rival at boundary using `seatPlayerAtBoundary` (T4).
 */
export function inviteRivalAtBoundary(
  session: SandboxSessionState,
  preferredRivalId?: RivalId,
): SandboxSessionState {
  if (session.phase !== 'between-hands' || session.boundary === null) {
    return session;
  }

  const boundary = session.boundary;
  const freeSeatIndex = findNextFreeSeatIndex(boundary);
  if (freeSeatIndex === null) {
    return {
      ...session,
      statusNotice: {
        tone: 'warning',
        message: 'Bàn đã kín 10 ghế, không thể mời thêm rival.',
      },
    };
  }

  const seatedIds = new Set(boundary.seats.map((s) => s.playerId));
  let chosenRivalId: RivalId | undefined;

  if (preferredRivalId !== undefined && !seatedIds.has(preferredRivalId)) {
    chosenRivalId = preferredRivalId;
  } else {
    const enabledCandidates = session.appliedSettings.enabledRivalIds.filter(
      (id) => !seatedIds.has(id),
    );
    const fallbackCandidates = RIVAL_IDS.filter((id) => !seatedIds.has(id));
    const pool = enabledCandidates.length > 0 ? enabledCandidates : fallbackCandidates;

    if (pool.length === 0) {
      return {
        ...session,
        statusNotice: {
          tone: 'warning',
          message: 'Tất cả 9 nhân vật rival đều đã ngồi bàn.',
        },
      };
    }

    const inviteRng = createRng(session.sessionSeed).fork(
      `invite-${session.handNumber}-${session.inviteCounter}`,
    );
    chosenRivalId = inviteRng.pick(pool);
  }

  const res = seatPlayerAtBoundary(boundary, freeSeatIndex, chosenRivalId);
  if (!res.ok) {
    const translated = translateBoundaryError(res.code, res.message);
    return {
      ...session,
      statusNotice: {
        tone: 'error',
        message: translated.message,
        guidance: translated.guidance,
      },
    };
  }

  const nextProfiles: Record<string, SeatProfileInfo> = {
    ...session.seatProfiles,
    [chosenRivalId]: makeRivalProfileInfo(chosenRivalId),
  };

  return {
    ...session,
    boundary: res.state,
    ledgerEvents: [...session.ledgerEvents, ...res.ledgerEvents],
    seatProfiles: nextProfiles,
    inviteCounter: session.inviteCounter + 1,
    statusNotice: {
      tone: 'success',
      message: `Đã mời ${nextProfiles[chosenRivalId]!.displayName} vào ghế #${freeSeatIndex + 1} (+500 điểm).`,
    },
  };
}

/**
 * Re-seats Hero at boundary after Hero previously cashed out / left the table.
 */
export function seatHeroAtBoundary(session: SandboxSessionState): SandboxSessionState {
  if (session.phase !== 'between-hands' || session.boundary === null) {
    return session;
  }
  const boundary = session.boundary;
  if (boundary.seats.some((s) => s.playerId === HERO_PLAYER_ID)) {
    return session;
  }

  const seatIndex = boundary.seats.some((s) => s.seatIndex === 0)
    ? findNextFreeSeatIndex(boundary)
    : 0;
  if (seatIndex === null) {
    return {
      ...session,
      statusNotice: {
        tone: 'warning',
        message: 'Bàn đang kín 10 ghế — hãy cash out một rival trước khi ngồi lại.',
      },
    };
  }

  const res = seatPlayerAtBoundary(boundary, seatIndex, HERO_PLAYER_ID);
  if (!res.ok) {
    const translated = translateBoundaryError(res.code, res.message);
    return {
      ...session,
      statusNotice: {
        tone: 'error',
        message: translated.message,
        guidance: translated.guidance,
      },
    };
  }

  return {
    ...session,
    boundary: res.state,
    ledgerEvents: [...session.ledgerEvents, ...res.ledgerEvents],
    seatProfiles: {
      ...session.seatProfiles,
      [HERO_PLAYER_ID]: makeHeroProfile(),
    },
    statusNotice: {
      tone: 'success',
      message: `Bạn đã ngồi lại bàn tại ghế #${seatIndex + 1} với 500 điểm.`,
    },
  };
}

/**
 * Applies settings changes:
 * - UI preferences (motion, audio, terminology, bot pacing, pauseOnImportantSpot) apply immediately.
 * - Table/rule settings apply at hand boundary (queued in `pendingSettings` if mid-hand),
 *   or start a fresh session if `mode === 'new-session'`.
 */
export function applySettingsUpdate(
  session: SandboxSessionState,
  draftSettings: SandboxSettings,
  mode: 'apply-boundary' | 'new-session' = 'apply-boundary',
): SandboxSessionState {
  const { settings } = sanitizeSettings(draftSettings);

  if (mode === 'new-session') {
    return createSandboxSession({
      seed: generateUiSeed(),
      settings,
    });
  }

  const withLiveUiPrefs: SandboxSettings = Object.freeze({
    ...session.appliedSettings,
    reducedMotion: settings.reducedMotion,
    audio: settings.audio,
    terminology: settings.terminology,
    pauseOnImportantSpot: settings.pauseOnImportantSpot,
    botSpeedMs: settings.botSpeedMs,
  });

  const tableChanged = hasTableRuleChanges(session.appliedSettings, settings);
  if (!tableChanged) {
    return {
      ...session,
      appliedSettings: withLiveUiPrefs,
      pendingSettings: null,
      statusNotice: {
        tone: 'success',
        message: 'Đã lưu tùy chọn giao diện & âm thanh.',
      },
    };
  }

  if (session.phase === 'in-hand') {
    return {
      ...session,
      appliedSettings: withLiveUiPrefs,
      pendingSettings: settings,
      statusNotice: {
        tone: 'info',
        message: 'Thay đổi luật/bàn đã được lưu và sẽ áp dụng ở ranh giới ván tiếp theo.',
      },
    };
  }

  return reconcilePendingSettingsAtBoundary({
    ...session,
    appliedSettings: withLiveUiPrefs,
    pendingSettings: settings,
  });
}

/**
 * Starts the next hand from boundary (or transitions from a completed hand to boundary first).
 * Enforces T3 (no 0-chip seats), T4 (auto-invites rivals from waiting list via `inviteRivalAtBoundary`
 * to reach 4 seated players before collecting ante), and ante 5-chip availability.
 */
export function startNextHand(
  session: SandboxSessionState,
  fixtures?: HandFixtures,
): SandboxSessionState {
  const atBoundary =
    session.phase === 'between-hands' && session.boundary !== null
      ? reconcilePendingSettingsAtBoundary(session)
      : enterHandBoundary(session);

  if (atBoundary.phase !== 'between-hands' || atBoundary.boundary === null) {
    return atBoundary;
  }

  let current = atBoundary;
  const autoInvitedNames: string[] = [];
  let autoInviteFailureNotice: SandboxSessionState['statusNotice'] = null;

  // T4: Attempt to fill to 4 seated players via inviteRivalAtBoundary before collecting ante.
  let readiness = checkReadyForNextHand(current.boundary!);
  while (readiness.needsPlayers > 0) {
    const beforeSeats = current.boundary!.seats;
    const beforeIds = new Set(beforeSeats.map((s) => s.playerId));
    const invited = inviteRivalAtBoundary(current);
    if (invited.boundary === null || invited.boundary.seats.length <= beforeSeats.length) {
      autoInviteFailureNotice = invited.statusNotice;
      break;
    }
    const newlySeated = invited.boundary.seats.find((s) => !beforeIds.has(s.playerId));
    if (newlySeated !== undefined) {
      autoInvitedNames.push(getPlayerName(newlySeated.playerId, invited.seatProfiles));
    }
    current = invited;
    readiness = checkReadyForNextHand(current.boundary!);
  }

  const boundary = current.boundary!;
  if (!readiness.ready) {
    const issues: string[] = [];
    if (readiness.needsPlayers > 0) {
      const failureDetail = autoInviteFailureNotice
        ? ` (${autoInviteFailureNotice.message}${autoInviteFailureNotice.guidance ? ` ${autoInviteFailureNotice.guidance}` : ''})`
        : '';
      issues.push(
        `Bàn chỉ còn ${readiness.playerCount} người — cần mời thêm ${readiness.needsPlayers} rival cho đủ 4 (T4)${failureDetail}.`,
      );
    }
    if (readiness.zeroStackPlayerIds.length > 0) {
      const names = readiness.zeroStackPlayerIds
        .map((id) => getPlayerName(id, current.seatProfiles))
        .join(', ');
      issues.push(`Ghế hết chip (0 điểm): ${names} — phải Rebuy 500 hoặc Rời bàn trước khi thu ante (T3).`);
    }
    if (readiness.missingAnteDenominationPlayerIds.length > 0) {
      const names = readiness.missingAnteDenominationPlayerIds
        .map((id) => getPlayerName(id, current.seatProfiles))
        .join(', ');
      issues.push(`Ghế thiếu chip mệnh giá 5 để đóng ante: ${names} — hãy Đổi chip trước khi chia ván mới.`);
    }

    return {
      ...current,
      statusNotice: {
        tone: 'warning',
        message: 'Chưa thể chia ván mới — cần xử lý ranh giới bàn trước.',
        guidance: issues.join(' '),
      },
    };
  }

  const nextHandNumber = current.handNumber + 1;
  const dealerIndex = nextDealerArrayIndex(boundary);
  const handRng = createRng(current.sessionSeed).fork(`hand-${nextHandNumber}`);

  const started = startHand({
    seats: boundary.seats.map((s) => ({
      seatIndex: s.seatIndex,
      playerId: s.playerId,
      stack: s.stack,
    })),
    bank: boundary.bank,
    rng: handRng.fork('engine'),
    config: buildHandConfigFromSettings(current.appliedSettings, dealerIndex),
    fixtures,
  });

  if (!started.ok) {
    const translated = translateHandError(started.code, started.message);
    return {
      ...current,
      statusNotice: {
        tone: 'error',
        message: translated.message,
        guidance: translated.guidance,
      },
    };
  }

  const nextSession: SandboxSessionState = {
    ...current,
    handNumber: nextHandNumber,
    phase: 'in-hand',
    hand: started.state,
    boundary: null,
    nongTiltStateAtHandStart: current.nongTiltState,
    stagedChips: emptyChips(),
    stagedHistory: [],
    heroDecisionsCurrentHand: [],
    ootContextKey: null,
    ootEvaluatedPlayers: [],
    statusNotice:
      autoInvitedNames.length > 0
        ? {
            tone: 'info',
            message: `Đã tự động mời ${autoInvitedNames.join(', ')} từ ghế chờ cho đủ 4 người (+500 từ kho, T4) trước khi chia ván #${nextHandNumber}.`,
          }
        : null,
  };

  if (started.state.phase === 'complete') {
    return finalizeCompletedHand(nextSession, started.state, []);
  }

  return nextSession;
}

/**
 * Helper to verify INV-1 and INV-2 on any `SandboxSessionState` (useful for tests & runtime diagnostics).
 */
export function verifySessionInvariants(session: SandboxSessionState): {
  readonly ok: boolean;
  readonly detail: string;
} {
  if (session.phase === 'in-hand' && session.hand !== null) {
    const report = checkHandInvariants(session.hand);
    if (!report.ok) {
      return {
        ok: false,
        detail: `Hand invariant failed: inv1=${JSON.stringify(report.inv1)}, inv2=${JSON.stringify(report.inv2)}`,
      };
    }
    return { ok: true, detail: 'INV-1 & INV-2 passed (in-hand)' };
  }

  if (session.phase === 'between-hands' && session.boundary !== null) {
    const inv1 = checkInv1([
      session.boundary.bank,
      ...session.boundary.seats.map((s) => s.stack),
    ]);
    if (!inv1.ok) {
      return {
        ok: false,
        detail: `Boundary INV-1 failed: ${JSON.stringify(inv1.diff)}`,
      };
    }
    return { ok: true, detail: 'INV-1 passed (between-hands)' };
  }

  return { ok: false, detail: 'Session has neither active hand nor boundary state' };
}

/**
 * Utility for checking chip availability cleanly in UI.
 */
export function getAvailableHeroStackAfterStaged(session: SandboxSessionState): ChipCounts {
  const heroSeat = session.hand?.seats.find((s) => s.playerId === HERO_PLAYER_ID);
  if (!heroSeat) {
    return emptyChips();
  }
  try {
    return subtractChips(heroSeat.stack, session.stagedChips);
  } catch {
    return heroSeat.stack;
  }
}

export function sumChipStacks(stacks: readonly ChipCounts[]): ChipCounts {
  return stacks.reduce((acc, cur) => addChips(acc, cur), emptyChips());
}
