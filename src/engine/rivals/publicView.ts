import type { Card, Suit } from '../cards';
import { chipValue, DENOMINATIONS, type ChipCounts } from '../chips';
import { getLegalActions } from '../hand';
import {
  BET_STEP,
  type BettingAction,
  type ExchangeTarget,
  type HandState,
  type HandTimelineEvent,
  type LegalActions,
  type OutOfTurnDeclaration,
  type Street,
} from '../handTypes';
import { isRivalId } from './profiles';
import type {
  NongTiltState,
  PublicSeatView,
  PublicTimelineEvent,
  RivalDecisionInput,
  RivalId,
  RivalValidationResult,
} from './types';

const VALID_SUITS: ReadonlySet<string> = new Set<Suit>(['s', 'h', 'd', 'c']);
const VALID_STREETS: ReadonlySet<string> = new Set<Street>(['preflop', 'flop', 'turn', 'river']);
const VALID_PLAYER_STATUSES: ReadonlySet<string> = new Set(['active', 'folded', 'all-in']);
const VALID_OOT_CANCEL_REASONS: ReadonlySet<string> = new Set([
  'bet-changed',
  'action-no-longer-legal',
  'street-ended',
  'hand-ended',
]);
const VALID_TILT_REASONS: ReadonlySet<string> = new Set(['big-pot-loss', 'turn-bad-beat']);
const STREET_ORDER: Readonly<Record<Street, number>> = Object.freeze({
  preflop: 0,
  flop: 1,
  turn: 2,
  river: 3,
});
const EXPECTED_BOARD_LENGTH: Readonly<Record<Street, number>> = Object.freeze({
  preflop: 0,
  flop: 3,
  turn: 4,
  river: 5,
});

const FORBIDDEN_HIDDEN_KEYS: ReadonlySet<string> = new Set([
  'deck',
  'deckCursor',
  'outcome',
  'seats',
  'bank',
  'pendingPayout',
  'settledTransfers',
  'rngSeed',
  'phase',
  'holeCards',
  'unsettledContribution',
  'undealt',
  'resolution',
  'evaluatedHands',
]);

const ALLOWED_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  'rivalId',
  'playerId',
  'holeCards',
  'board',
  'street',
  'streetCap',
  'currentBet',
  'pot',
  'activePlayerId',
  'openerPlayerId',
  'dealerPlayerId',
  'isMyTurn',
  'allowOutOfTurn',
  'config',
  'publicSeats',
  'publicTimeline',
  'legalActions',
  'tiltState',
]);

const ALLOWED_CONFIG_KEYS: ReadonlySet<string> = new Set([
  'enablePreflopBetting',
  'preflopCap',
  'allowOutOfTurn',
  'dealerIndex',
]);

const ALLOWED_PUBLIC_SEAT_KEYS: ReadonlySet<string> = new Set([
  'seatIndex',
  'playerId',
  'stack',
  'status',
  'streetContribution',
  'totalContribution',
  'hasActedThisStreet',
  'declaration',
  'cancelledDeclarationThisStreet',
]);

const ALLOWED_DECLARATION_KEYS: ReadonlySet<string> = new Set([
  'playerId',
  'street',
  'action',
  'declaredAtCurrentBet',
  'reservedChips',
]);

const ALLOWED_LEGAL_ACTIONS_KEYS: ReadonlySet<string> = new Set([
  'playerId',
  'street',
  'streetCap',
  'currentBet',
  'playerStreetContribution',
  'toCall',
  'canFold',
  'canCheck',
  'canBet',
  'betRange',
  'canCall',
  'callAmount',
  'isCallAllIn',
  'canRaise',
  'raiseRange',
]);

const ALLOWED_AMOUNT_RANGE_KEYS: ReadonlySet<string> = new Set(['min', 'max', 'step']);

const ALLOWED_TILT_STATE_KEYS: ReadonlySet<string> = new Set([
  'isTilted',
  'handsRemaining',
  'totalTiltDuration',
  'triggerReason',
]);

const ALLOWED_TIMELINE_EVENT_KEYS: Readonly<
  Record<PublicTimelineEvent['type'], ReadonlySet<string>>
> = Object.freeze({
  'ante-collected': new Set(['type', 'antePerPlayer', 'playerIds', 'allInPlayerIds']),
  'cards-dealt': new Set(['type', 'dealerPlayerId', 'openerPlayerId', 'playerIds']),
  'street-dealt': new Set(['type', 'street', 'cards']),
  'out-of-turn-declared': new Set([
    'type',
    'street',
    'playerId',
    'action',
    'declaredAtCurrentBet',
    'reservedChips',
  ]),
  'out-of-turn-cancelled': new Set([
    'type',
    'street',
    'playerId',
    'action',
    'reason',
    'triggeredByPlayerId',
    'returnedChips',
  ]),
  'player-action': new Set([
    'type',
    'street',
    'playerId',
    'action',
    'addedAmount',
    'newStreetContribution',
    'newCurrentBet',
    'isAllIn',
    'fromOutOfTurn',
  ]),
  'chip-exchange': new Set(['type', 'street', 'fromPlayerId', 'target', 'give', 'receive']),
  'uncalled-refund': new Set(['type', 'street', 'playerId', 'amount', 'chips']),
});

function cloneCard(card: Card): Card {
  return Object.freeze({ rank: card.rank, suit: card.suit });
}

function cloneChips(chips: ChipCounts): ChipCounts {
  return Object.freeze({
    5: chips[5],
    10: chips[10],
    50: chips[50],
    100: chips[100],
  });
}

function cloneBettingAction(action: BettingAction): BettingAction {
  switch (action.type) {
    case 'fold':
      return Object.freeze({ type: 'fold' });
    case 'check':
      return Object.freeze({ type: 'check' });
    case 'bet':
      return Object.freeze({
        type: 'bet',
        amount: action.amount,
        chips: cloneChips(action.chips),
      });
    case 'call':
      return Object.freeze({
        type: 'call',
        chips: cloneChips(action.chips),
      });
    case 'raise':
      return Object.freeze({
        type: 'raise',
        raiseTo: action.raiseTo,
        chips: cloneChips(action.chips),
      });
  }
}

function cloneDeclaration(decl: OutOfTurnDeclaration | null): OutOfTurnDeclaration | null {
  if (decl === null) {
    return null;
  }
  return Object.freeze({
    playerId: decl.playerId,
    street: decl.street,
    action: cloneBettingAction(decl.action),
    declaredAtCurrentBet: decl.declaredAtCurrentBet,
    reservedChips: cloneChips(decl.reservedChips),
  });
}

function cloneExchangeTarget(target: ExchangeTarget): ExchangeTarget {
  if (target.kind === 'pot') {
    return Object.freeze({ kind: 'pot' });
  }
  return Object.freeze({ kind: 'player', playerId: target.playerId });
}

/**
 * Projects a single engine `HandTimelineEvent` into a `PublicTimelineEvent`, or returns `null`
 * if the event belongs to post-betting resolution (`showdown`, `fold-win`, `payout-*`) or a future street.
 */
export function projectTimelineEventToPublic(
  event: HandTimelineEvent,
  currentStreet: Street,
): PublicTimelineEvent | null {
  switch (event.type) {
    case 'ante-collected':
      return Object.freeze({
        type: 'ante-collected',
        antePerPlayer: event.antePerPlayer,
        playerIds: Object.freeze([...event.playerIds]),
        allInPlayerIds: Object.freeze([...event.allInPlayerIds]),
      });

    case 'cards-dealt':
      return Object.freeze({
        type: 'cards-dealt',
        dealerPlayerId: event.dealerPlayerId,
        openerPlayerId: event.openerPlayerId,
        playerIds: Object.freeze([...event.playerIds]),
      });

    case 'street-dealt':
      if (STREET_ORDER[event.street] > STREET_ORDER[currentStreet]) {
        return null;
      }
      return Object.freeze({
        type: 'street-dealt',
        street: event.street,
        cards: Object.freeze(event.cards.map(cloneCard)),
      });

    case 'out-of-turn-declared':
      if (STREET_ORDER[event.street] > STREET_ORDER[currentStreet]) {
        return null;
      }
      return Object.freeze({
        type: 'out-of-turn-declared',
        street: event.street,
        playerId: event.playerId,
        action: cloneBettingAction(event.action),
        declaredAtCurrentBet: event.declaredAtCurrentBet,
        reservedChips: cloneChips(event.reservedChips),
      });

    case 'out-of-turn-cancelled':
      if (STREET_ORDER[event.street] > STREET_ORDER[currentStreet]) {
        return null;
      }
      return Object.freeze({
        type: 'out-of-turn-cancelled',
        street: event.street,
        playerId: event.playerId,
        action: cloneBettingAction(event.action),
        reason: event.reason,
        ...(event.triggeredByPlayerId !== undefined
          ? { triggeredByPlayerId: event.triggeredByPlayerId }
          : {}),
        returnedChips: cloneChips(event.returnedChips),
      });

    case 'player-action':
      if (STREET_ORDER[event.street] > STREET_ORDER[currentStreet]) {
        return null;
      }
      return Object.freeze({
        type: 'player-action',
        street: event.street,
        playerId: event.playerId,
        action: cloneBettingAction(event.action),
        addedAmount: event.addedAmount,
        newStreetContribution: event.newStreetContribution,
        newCurrentBet: event.newCurrentBet,
        isAllIn: event.isAllIn,
        fromOutOfTurn: event.fromOutOfTurn,
      });

    case 'chip-exchange':
      if (
        event.street !== null &&
        STREET_ORDER[event.street] > STREET_ORDER[currentStreet]
      ) {
        return null;
      }
      return Object.freeze({
        type: 'chip-exchange',
        street: event.street,
        fromPlayerId: event.fromPlayerId,
        target: cloneExchangeTarget(event.target),
        give: cloneChips(event.give),
        receive: cloneChips(event.receive),
      });

    case 'uncalled-refund':
      if (STREET_ORDER[event.street] > STREET_ORDER[currentStreet]) {
        return null;
      }
      return Object.freeze({
        type: 'uncalled-refund',
        street: event.street,
        playerId: event.playerId,
        amount: event.amount,
        chips: cloneChips(event.chips),
      });

    case 'fold-win':
    case 'showdown':
    case 'payout-pending':
    case 'payout-settled':
      return null;
  }
}

/**
 * Computes legal actions for any active seat from public seat state, matching `getLegalActions`
 * so out-of-turn candidates know their valid options without accessing raw `HandState`.
 */
export function computePublicLegalActionsForSeat(
  publicSeats: readonly PublicSeatView[],
  playerId: string,
  street: Street,
  streetCap: number,
  currentBet: number,
): LegalActions | null {
  const seat = publicSeats.find((s) => s.playerId === playerId);
  if (seat === undefined || seat.status !== 'active') {
    return null;
  }

  const availableStack = chipValue(seat.stack);
  const toCall = currentBet - seat.streetContribution;
  const hasOtherActive = publicSeats.some(
    (s) => s.status === 'active' && s.playerId !== playerId,
  );

  const canCheck = toCall === 0;
  const canBet =
    hasOtherActive &&
    currentBet === 0 &&
    availableStack >= BET_STEP &&
    streetCap >= BET_STEP;
  const maxBet = Math.min(streetCap, availableStack);
  const betRange = canBet ? Object.freeze({ min: BET_STEP, max: maxBet, step: BET_STEP }) : null;

  const canCall = toCall > 0 && availableStack > 0;
  const callAmount = canCall ? Math.min(toCall, availableStack) : null;
  const isCallAllIn = canCall && availableStack <= toCall;

  const minRaiseTo = currentBet + BET_STEP;
  const maxRaiseTo = Math.min(streetCap, seat.streetContribution + availableStack);
  const canRaise =
    hasOtherActive &&
    currentBet > 0 &&
    currentBet < streetCap &&
    maxRaiseTo >= minRaiseTo;
  const raiseRange = canRaise
    ? Object.freeze({ min: minRaiseTo, max: maxRaiseTo, step: BET_STEP })
    : null;

  return Object.freeze({
    playerId: seat.playerId,
    street,
    streetCap,
    currentBet,
    playerStreetContribution: seat.streetContribution,
    toCall,
    canFold: true,
    canCheck,
    canBet,
    betRange,
    canCall,
    callAmount,
    isCallAllIn,
    canRaise,
    raiseRange,
  });
}

/**
 * Boundary adapter that constructs `RivalDecisionInput` from `HandState` by picking field-by-field.
 * Never passes `HandState`, `SeatState`, `deck`, other players' `holeCards`, or unrevealed showdown results (B1).
 */
export function buildRivalDecisionInput(
  state: HandState,
  playerId: string,
  options?: {
    readonly rivalId?: RivalId;
    readonly tiltState?: NongTiltState;
  },
): RivalDecisionInput {
  const actorSeat = state.seats.find((s) => s.playerId === playerId);
  if (actorSeat === undefined) {
    throw new Error(`Player "${playerId}" is not seated in hand`);
  }

  const resolvedRivalId = options?.rivalId ?? (isRivalId(playerId) ? playerId : undefined);
  if (resolvedRivalId === undefined || !isRivalId(resolvedRivalId)) {
    throw new Error(
      `Cannot determine valid RivalId for player "${playerId}"; pass options.rivalId explicitly`,
    );
  }

  const expectedBoardCount = EXPECTED_BOARD_LENGTH[state.street];
  const visibleBoard = state.board.slice(0, expectedBoardCount).map(cloneCard);

  const publicSeats: PublicSeatView[] = state.seats.map((seat) =>
    Object.freeze({
      seatIndex: seat.seatIndex,
      playerId: seat.playerId,
      stack: cloneChips(seat.stack),
      status: seat.status,
      streetContribution: seat.streetContribution,
      totalContribution: seat.totalContribution,
      hasActedThisStreet: seat.hasActedThisStreet,
      declaration: cloneDeclaration(seat.declaration),
      cancelledDeclarationThisStreet: seat.cancelledDeclarationThisStreet,
    }),
  );

  const publicTimeline: PublicTimelineEvent[] = [];
  for (const event of state.timeline) {
    const projected = projectTimelineEventToPublic(event, state.street);
    if (projected !== null) {
      publicTimeline.push(projected);
    }
  }

  const isMyTurn = state.phase === 'betting' && state.activePlayerId === playerId;
  const legalActions =
    state.phase !== 'betting'
      ? null
      : isMyTurn
        ? getLegalActions(state)
        : computePublicLegalActionsForSeat(
            publicSeats,
            playerId,
            state.street,
            state.streetCap,
            state.currentBet,
          );

  const dealerSeat = state.seats[state.dealerIndex];
  const dealerPlayerId = dealerSeat !== undefined ? dealerSeat.playerId : state.openerPlayerId;

  return Object.freeze({
    rivalId: resolvedRivalId,
    playerId,
    holeCards: Object.freeze([
      cloneCard(actorSeat.holeCards[0]),
      cloneCard(actorSeat.holeCards[1]),
    ] as const),
    board: Object.freeze(visibleBoard),
    street: state.street,
    streetCap: state.streetCap,
    currentBet: state.currentBet,
    pot: cloneChips(state.pot),
    activePlayerId: state.activePlayerId,
    openerPlayerId: state.openerPlayerId,
    dealerPlayerId,
    isMyTurn,
    allowOutOfTurn: state.config.allowOutOfTurn,
    config: Object.freeze({
      enablePreflopBetting: state.config.enablePreflopBetting,
      preflopCap: state.config.preflopCap,
      allowOutOfTurn: state.config.allowOutOfTurn,
      dealerIndex: state.config.dealerIndex,
    }),
    publicSeats: Object.freeze(publicSeats),
    publicTimeline: Object.freeze(publicTimeline),
    legalActions,
    ...(options?.tiltState !== undefined
      ? {
          tiltState: Object.freeze({
            isTilted: options.tiltState.isTilted,
            handsRemaining: options.tiltState.handsRemaining,
            totalTiltDuration: options.tiltState.totalTiltDuration,
            triggerReason: options.tiltState.triggerReason,
          }),
        }
      : {}),
  });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function countOwnKeys(obj: Record<string, unknown>): number {
  let count = 0;
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      count += 1;
    }
  }
  return count;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isNonEmptyStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

function findDisallowedKeyReason(
  obj: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  context: string,
): string | null {
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.has(key)) {
      if (FORBIDDEN_HIDDEN_KEYS.has(key)) {
        return `Forbidden hidden field "${key}" present on ${context}`;
      }
      return `Unexpected field "${key}" present on ${context}`;
    }
  }
  return null;
}

function isValidCardObject(value: unknown): value is Card {
  if (!isPlainRecord(value)) {
    return false;
  }
  if (countOwnKeys(value) !== 2) {
    return false;
  }
  const rank = value['rank'];
  const suit = value['suit'];
  return (
    typeof rank === 'number' &&
    Number.isInteger(rank) &&
    rank >= 2 &&
    rank <= 14 &&
    typeof suit === 'string' &&
    VALID_SUITS.has(suit)
  );
}

function isValidChipsObject(value: unknown): value is ChipCounts {
  if (!isPlainRecord(value)) {
    return false;
  }
  if (countOwnKeys(value) !== DENOMINATIONS.length) {
    return false;
  }
  const c5 = value['5'];
  const c10 = value['10'];
  const c50 = value['50'];
  const c100 = value['100'];
  return (
    isNonNegativeInt(c5) &&
    isNonNegativeInt(c10) &&
    isNonNegativeInt(c50) &&
    isNonNegativeInt(c100)
  );
}

function isValidBettingActionObject(value: unknown): value is BettingAction {
  if (!isPlainRecord(value)) {
    return false;
  }
  const type = value['type'];
  const keyCount = countOwnKeys(value);
  switch (type) {
    case 'fold':
    case 'check':
      return keyCount === 1;
    case 'call':
      return keyCount === 2 && isValidChipsObject(value['chips']);
    case 'bet':
      return (
        keyCount === 3 &&
        isPositiveInt(value['amount']) &&
        isValidChipsObject(value['chips'])
      );
    case 'raise':
      return (
        keyCount === 3 &&
        isPositiveInt(value['raiseTo']) &&
        isValidChipsObject(value['chips'])
      );
    default:
      return false;
  }
}

function isValidExchangeTargetObject(value: unknown): value is ExchangeTarget {
  if (!isPlainRecord(value)) {
    return false;
  }
  const kind = value['kind'];
  const keyCount = countOwnKeys(value);
  if (kind === 'pot') {
    return keyCount === 1;
  }
  if (kind === 'player') {
    return keyCount === 2 && isNonEmptyString(value['playerId']);
  }
  return false;
}

function validateAmountRangeObject(value: unknown, label: string): string | null {
  if (!isPlainRecord(value)) {
    return `${label} must be a plain object`;
  }
  const keyErr = findDisallowedKeyReason(value, ALLOWED_AMOUNT_RANGE_KEYS, label);
  if (keyErr !== null) {
    return keyErr;
  }
  const min = value['min'];
  const max = value['max'];
  const step = value['step'];
  if (!isPositiveInt(min) || !isPositiveInt(max) || max < min || step !== BET_STEP) {
    return `Invalid ${label} bounds or step`;
  }
  return null;
}

function validateLegalActionsObject(
  value: unknown,
  expectedStreet: Street,
): string | null {
  if (value === null) {
    return null;
  }
  if (!isPlainRecord(value)) {
    return 'legalActions must be null or a plain object';
  }
  const keyErr = findDisallowedKeyReason(value, ALLOWED_LEGAL_ACTIONS_KEYS, 'legalActions');
  if (keyErr !== null) {
    return keyErr;
  }
  if (
    !isNonEmptyString(value['playerId']) ||
    value['street'] !== expectedStreet ||
    !isPositiveInt(value['streetCap']) ||
    !isNonNegativeInt(value['currentBet']) ||
    !isNonNegativeInt(value['playerStreetContribution']) ||
    !isNonNegativeInt(value['toCall']) ||
    typeof value['canFold'] !== 'boolean' ||
    typeof value['canCheck'] !== 'boolean' ||
    typeof value['canBet'] !== 'boolean' ||
    typeof value['canCall'] !== 'boolean' ||
    typeof value['isCallAllIn'] !== 'boolean' ||
    typeof value['canRaise'] !== 'boolean'
  ) {
    return 'Invalid primitive field in legalActions';
  }

  if (value['canBet']) {
    const betRangeErr = validateAmountRangeObject(value['betRange'], 'legalActions.betRange');
    if (betRangeErr !== null) {
      return betRangeErr;
    }
  } else if (value['betRange'] !== null) {
    return 'legalActions.betRange must be null when canBet is false';
  }

  if (value['canCall']) {
    if (!isPositiveInt(value['callAmount'])) {
      return 'legalActions.callAmount must be a positive integer when canCall is true';
    }
  } else if (value['callAmount'] !== null) {
    return 'legalActions.callAmount must be null when canCall is false';
  }

  if (value['canRaise']) {
    const raiseRangeErr = validateAmountRangeObject(
      value['raiseRange'],
      'legalActions.raiseRange',
    );
    if (raiseRangeErr !== null) {
      return raiseRangeErr;
    }
  } else if (value['raiseRange'] !== null) {
    return 'legalActions.raiseRange must be null when canRaise is false';
  }

  return null;
}

function validateTiltStateObject(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }
  if (!isPlainRecord(value)) {
    return 'tiltState must be a plain object when provided';
  }
  const keyErr = findDisallowedKeyReason(value, ALLOWED_TILT_STATE_KEYS, 'tiltState');
  if (keyErr !== null) {
    return keyErr;
  }
  const triggerReason = value['triggerReason'];
  if (
    typeof value['isTilted'] !== 'boolean' ||
    !isNonNegativeInt(value['handsRemaining']) ||
    !isNonNegativeInt(value['totalTiltDuration']) ||
    (triggerReason !== null &&
      (typeof triggerReason !== 'string' || !VALID_TILT_REASONS.has(triggerReason)))
  ) {
    return 'Invalid field in tiltState';
  }
  return null;
}

function cardKey(card: Card): string {
  return `${card.rank}:${card.suit}`;
}

/**
 * Runtime structural validator for `RivalDecisionInput` (AC B1).
 * Rejects any input contaminated with hidden state (`HandState`, `SeatState.holeCards`,
 * `deck`, `outcome`, `showdown` events, or unrevealed future board cards in `publicTimeline`).
 */
export function validateRivalDecisionInput(input: unknown): RivalValidationResult {
  if (!isPlainRecord(input)) {
    return { ok: false, reason: 'Decision input must be a non-null plain object' };
  }

  const topKeyErr = findDisallowedKeyReason(input, ALLOWED_TOP_LEVEL_KEYS, 'RivalDecisionInput');
  if (topKeyErr !== null) {
    return { ok: false, reason: topKeyErr };
  }

  if (!isRivalId(input['rivalId'])) {
    return { ok: false, reason: `Invalid rivalId: ${String(input['rivalId'])}` };
  }

  if (!isNonEmptyString(input['playerId'])) {
    return { ok: false, reason: 'playerId must be a non-empty string' };
  }

  const street = input['street'];
  if (typeof street !== 'string' || !VALID_STREETS.has(street)) {
    return { ok: false, reason: `Invalid street: ${String(street)}` };
  }
  const typedStreet = street as Street;

  const holeCards = input['holeCards'];
  if (
    !Array.isArray(holeCards) ||
    holeCards.length !== 2 ||
    !isValidCardObject(holeCards[0]) ||
    !isValidCardObject(holeCards[1])
  ) {
    return { ok: false, reason: 'holeCards must be a 2-tuple of valid Card objects' };
  }

  const seenCards = new Set<string>();
  const h0Key = cardKey(holeCards[0]);
  const h1Key = cardKey(holeCards[1]);
  if (h0Key === h1Key) {
    return { ok: false, reason: 'Duplicate card in holeCards' };
  }
  seenCards.add(h0Key);
  seenCards.add(h1Key);

  const board = input['board'];
  const expectedBoardLen = EXPECTED_BOARD_LENGTH[typedStreet];
  if (!Array.isArray(board) || board.length !== expectedBoardLen) {
    return {
      ok: false,
      reason: `board length (${Array.isArray(board) ? board.length : 'non-array'}) does not match street "${typedStreet}" (expected ${expectedBoardLen})`,
    };
  }
  for (const card of board) {
    if (!isValidCardObject(card)) {
      return { ok: false, reason: 'Invalid card in board' };
    }
    const key = cardKey(card);
    if (seenCards.has(key)) {
      return { ok: false, reason: `Duplicate or colliding card between holeCards and board: ${key}` };
    }
    seenCards.add(key);
  }

  if (!isPositiveInt(input['streetCap'])) {
    return { ok: false, reason: 'streetCap must be a positive integer' };
  }

  if (!isNonNegativeInt(input['currentBet'])) {
    return { ok: false, reason: 'currentBet must be a non-negative integer' };
  }

  if (!isValidChipsObject(input['pot'])) {
    return { ok: false, reason: 'pot must be a valid ChipCounts object' };
  }

  if (input['activePlayerId'] !== null && !isNonEmptyString(input['activePlayerId'])) {
    return { ok: false, reason: 'activePlayerId must be null or a non-empty string' };
  }

  if (!isNonEmptyString(input['openerPlayerId'])) {
    return { ok: false, reason: 'openerPlayerId must be a non-empty string' };
  }

  if (!isNonEmptyString(input['dealerPlayerId'])) {
    return { ok: false, reason: 'dealerPlayerId must be a non-empty string' };
  }

  if (typeof input['isMyTurn'] !== 'boolean') {
    return { ok: false, reason: 'isMyTurn must be a boolean' };
  }

  if (typeof input['allowOutOfTurn'] !== 'boolean') {
    return { ok: false, reason: 'allowOutOfTurn must be a boolean' };
  }

  const config = input['config'];
  if (!isPlainRecord(config)) {
    return { ok: false, reason: 'config must be a non-null plain object' };
  }
  const configKeyErr = findDisallowedKeyReason(config, ALLOWED_CONFIG_KEYS, 'config');
  if (configKeyErr !== null) {
    return { ok: false, reason: configKeyErr };
  }
  if (
    typeof config['enablePreflopBetting'] !== 'boolean' ||
    !isPositiveInt(config['preflopCap']) ||
    typeof config['allowOutOfTurn'] !== 'boolean' ||
    !isNonNegativeInt(config['dealerIndex'])
  ) {
    return { ok: false, reason: 'Invalid field in config' };
  }

  const publicSeats = input['publicSeats'];
  if (!Array.isArray(publicSeats) || publicSeats.length === 0) {
    return { ok: false, reason: 'publicSeats must be a non-empty array' };
  }

  let foundActorSeat = false;
  for (const seat of publicSeats) {
    if (!isPlainRecord(seat)) {
      return { ok: false, reason: 'Each publicSeat must be an object' };
    }
    const seatKeyErr = findDisallowedKeyReason(seat, ALLOWED_PUBLIC_SEAT_KEYS, 'publicSeats entry');
    if (seatKeyErr !== null) {
      return { ok: false, reason: seatKeyErr };
    }
    if (
      !isNonNegativeInt(seat['seatIndex']) ||
      !isNonEmptyString(seat['playerId']) ||
      !isValidChipsObject(seat['stack']) ||
      typeof seat['status'] !== 'string' ||
      !VALID_PLAYER_STATUSES.has(seat['status']) ||
      !isNonNegativeInt(seat['streetContribution']) ||
      !isNonNegativeInt(seat['totalContribution']) ||
      typeof seat['hasActedThisStreet'] !== 'boolean' ||
      typeof seat['cancelledDeclarationThisStreet'] !== 'boolean'
    ) {
      return { ok: false, reason: 'Invalid field in publicSeats entry' };
    }
    if (seat['playerId'] === input['playerId']) {
      foundActorSeat = true;
    }
    const decl = seat['declaration'];
    if (decl !== null) {
      if (!isPlainRecord(decl)) {
        return { ok: false, reason: 'Invalid out-of-turn declaration on publicSeat' };
      }
      const declKeyErr = findDisallowedKeyReason(
        decl,
        ALLOWED_DECLARATION_KEYS,
        'publicSeats.declaration',
      );
      if (declKeyErr !== null) {
        return { ok: false, reason: declKeyErr };
      }
      if (
        !isNonEmptyString(decl['playerId']) ||
        typeof decl['street'] !== 'string' ||
        !VALID_STREETS.has(decl['street']) ||
        decl['street'] !== typedStreet ||
        !isValidBettingActionObject(decl['action']) ||
        !isNonNegativeInt(decl['declaredAtCurrentBet']) ||
        !isValidChipsObject(decl['reservedChips'])
      ) {
        return { ok: false, reason: 'Invalid out-of-turn declaration on publicSeat' };
      }
    }
  }

  if (!foundActorSeat) {
    return { ok: false, reason: `Acting playerId "${input['playerId']}" not found in publicSeats` };
  }

  const publicTimeline = input['publicTimeline'];
  if (!Array.isArray(publicTimeline)) {
    return { ok: false, reason: 'publicTimeline must be an array' };
  }

  for (const event of publicTimeline) {
    if (!isPlainRecord(event)) {
      return { ok: false, reason: 'Timeline event must be an object' };
    }
    const eventType = event['type'];
    if (
      typeof eventType !== 'string' ||
      !Object.prototype.hasOwnProperty.call(ALLOWED_TIMELINE_EVENT_KEYS, eventType)
    ) {
      return {
        ok: false,
        reason: `Forbidden or unknown timeline event type "${String(eventType)}" in publicTimeline`,
      };
    }
    const allowedEventKeys =
      ALLOWED_TIMELINE_EVENT_KEYS[eventType as PublicTimelineEvent['type']];
    const eventKeyErr = findDisallowedKeyReason(
      event,
      allowedEventKeys,
      `publicTimeline ${eventType} event`,
    );
    if (eventKeyErr !== null) {
      return { ok: false, reason: eventKeyErr };
    }

    switch (eventType) {
      case 'ante-collected':
        if (
          !isPositiveInt(event['antePerPlayer']) ||
          !isNonEmptyStringArray(event['playerIds']) ||
          !isStringArray(event['allInPlayerIds'])
        ) {
          return { ok: false, reason: 'Invalid ante-collected timeline event' };
        }
        break;

      case 'cards-dealt':
        if (
          !isNonEmptyString(event['dealerPlayerId']) ||
          !isNonEmptyString(event['openerPlayerId']) ||
          !isNonEmptyStringArray(event['playerIds'])
        ) {
          return { ok: false, reason: 'Invalid cards-dealt timeline event' };
        }
        break;

      case 'street-dealt': {
        const dealtStreet = event['street'];
        const cards = event['cards'];
        if (
          (dealtStreet !== 'flop' && dealtStreet !== 'turn' && dealtStreet !== 'river') ||
          !Array.isArray(cards)
        ) {
          return { ok: false, reason: 'Invalid street-dealt timeline event' };
        }
        if (STREET_ORDER[dealtStreet] > STREET_ORDER[typedStreet]) {
          return {
            ok: false,
            reason: `publicTimeline contains future street-dealt "${dealtStreet}" while on "${typedStreet}"`,
          };
        }
        const expectedSlice =
          dealtStreet === 'flop'
            ? (board as Card[]).slice(0, 3)
            : dealtStreet === 'turn'
              ? (board as Card[]).slice(3, 4)
              : (board as Card[]).slice(4, 5);
        if (cards.length !== expectedSlice.length) {
          return {
            ok: false,
            reason: `street-dealt "${dealtStreet}" card count does not match revealed board`,
          };
        }
        for (let i = 0; i < cards.length; i++) {
          const c = cards[i];
          if (!isValidCardObject(c) || cardKey(c) !== cardKey(expectedSlice[i]!)) {
            return {
              ok: false,
              reason: `street-dealt "${dealtStreet}" cards do not match revealed board`,
            };
          }
        }
        break;
      }

      case 'out-of-turn-declared':
        if (
          typeof event['street'] !== 'string' ||
          !VALID_STREETS.has(event['street']) ||
          STREET_ORDER[event['street'] as Street] > STREET_ORDER[typedStreet] ||
          !isNonEmptyString(event['playerId']) ||
          !isValidBettingActionObject(event['action']) ||
          !isNonNegativeInt(event['declaredAtCurrentBet']) ||
          !isValidChipsObject(event['reservedChips'])
        ) {
          return { ok: false, reason: 'Invalid out-of-turn-declared timeline event' };
        }
        break;

      case 'out-of-turn-cancelled':
        if (
          typeof event['street'] !== 'string' ||
          !VALID_STREETS.has(event['street']) ||
          STREET_ORDER[event['street'] as Street] > STREET_ORDER[typedStreet] ||
          !isNonEmptyString(event['playerId']) ||
          !isValidBettingActionObject(event['action']) ||
          typeof event['reason'] !== 'string' ||
          !VALID_OOT_CANCEL_REASONS.has(event['reason']) ||
          (event['triggeredByPlayerId'] !== undefined &&
            !isNonEmptyString(event['triggeredByPlayerId'])) ||
          !isValidChipsObject(event['returnedChips'])
        ) {
          return { ok: false, reason: 'Invalid out-of-turn-cancelled timeline event' };
        }
        break;

      case 'player-action':
        if (
          typeof event['street'] !== 'string' ||
          !VALID_STREETS.has(event['street']) ||
          STREET_ORDER[event['street'] as Street] > STREET_ORDER[typedStreet] ||
          !isNonEmptyString(event['playerId']) ||
          !isValidBettingActionObject(event['action']) ||
          !isNonNegativeInt(event['addedAmount']) ||
          !isNonNegativeInt(event['newStreetContribution']) ||
          !isNonNegativeInt(event['newCurrentBet']) ||
          typeof event['isAllIn'] !== 'boolean' ||
          typeof event['fromOutOfTurn'] !== 'boolean'
        ) {
          return { ok: false, reason: 'Invalid player-action timeline event' };
        }
        break;

      case 'chip-exchange':
        if (
          (event['street'] !== null &&
            (typeof event['street'] !== 'string' || !VALID_STREETS.has(event['street']))) ||
          !isNonEmptyString(event['fromPlayerId']) ||
          !isValidExchangeTargetObject(event['target']) ||
          !isValidChipsObject(event['give']) ||
          !isValidChipsObject(event['receive'])
        ) {
          return { ok: false, reason: 'Invalid chip-exchange timeline event' };
        }
        if (
          event['street'] !== null &&
          STREET_ORDER[event['street'] as Street] > STREET_ORDER[typedStreet]
        ) {
          return {
            ok: false,
            reason: `publicTimeline contains future chip-exchange "${event['street']}" while on "${typedStreet}"`,
          };
        }
        break;

      case 'uncalled-refund':
        if (
          typeof event['street'] !== 'string' ||
          !VALID_STREETS.has(event['street']) ||
          !isNonEmptyString(event['playerId']) ||
          !isPositiveInt(event['amount']) ||
          !isValidChipsObject(event['chips'])
        ) {
          return { ok: false, reason: 'Invalid uncalled-refund timeline event' };
        }
        if (STREET_ORDER[event['street'] as Street] > STREET_ORDER[typedStreet]) {
          return {
            ok: false,
            reason: `publicTimeline contains future uncalled-refund "${event['street']}" while on "${typedStreet}"`,
          };
        }
        break;
    }
  }

  const legalActionsErr = validateLegalActionsObject(input['legalActions'], typedStreet);
  if (legalActionsErr !== null) {
    return { ok: false, reason: legalActionsErr };
  }

  const tiltStateErr = validateTiltStateObject(input['tiltState']);
  if (tiltStateErr !== null) {
    return { ok: false, reason: tiltStateErr };
  }

  return { ok: true };
}
