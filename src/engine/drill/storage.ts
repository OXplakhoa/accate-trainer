import {
  evaluateClearSpotDecision,
  evaluateOutsCount,
  evaluateOutsProbabilityError,
  evaluatePotOddsError,
} from '../calculator';
import { isRivalId, RIVAL_IDS, type RivalId } from '../rivals';
import {
  DRILL_CONCEPT_IDS,
  DRILL_LEVELS,
  type ActiveDrillLevel,
  type BoardTextureClass,
  type DrillAttemptRecord,
  type DrillConceptId,
  type DrillLevel,
  type DrillPersistedState,
} from './types';

export const DRILL_STORAGE_VERSION = 1 as const;
export const DRILL_STORAGE_KEY = 'accate_trainer_drill_v1';

export interface DrillStorageProvider {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

const VALID_CONCEPTS: ReadonlySet<string> = new Set<string>(DRILL_CONCEPT_IDS);
const VALID_LEVELS: ReadonlySet<number> = new Set<number>(DRILL_LEVELS);
const VALID_STREETS: ReadonlySet<string> = new Set(['preflop', 'flop', 'turn', 'river']);
const VALID_ACTIONS: ReadonlySet<string> = new Set(['fold', 'check', 'call', 'bet', 'raise']);
const VALID_TEXTURES: ReadonlySet<string> = new Set<BoardTextureClass>([
  'dry',
  'wet',
  'draw-heavy',
]);
const VALID_CLOCKS: ReadonlySet<number> = new Set([10, 15, 20, 25]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Returns a clean initial `DrillPersistedState` with version 1.
 */
export function createInitialDrillPersistedState(): DrillPersistedState {
  return Object.freeze({
    version: DRILL_STORAGE_VERSION,
    nextSequenceIndex: 1,
    completedLessons: Object.freeze([]),
    attempts: Object.freeze([]),
    lastSelectedLevel: 1,
    lastSelectedConcept: 'outs',
    clockSeconds: 20,
  });
}

function sanitizeAttemptRecord(raw: unknown, fallbackSeq: number): DrillAttemptRecord | null {
  if (!isPlainObject(raw)) {
    return null;
  }

  const conceptId = raw['conceptId'];
  if (typeof conceptId !== 'string' || !VALID_CONCEPTS.has(conceptId)) {
    return null;
  }

  const level = raw['level'];
  if (level !== 1 && level !== 2 && level !== 3) {
    return null;
  }

  const street = raw['street'];
  if (typeof street !== 'string' || !VALID_STREETS.has(street)) {
    return null;
  }

  const primaryRivalId = raw['primaryRivalId'];
  if (!isRivalId(primaryRivalId)) {
    return null;
  }

  const actionTaken = raw['actionTaken'];
  const recommendedAction = raw['recommendedAction'];
  if (
    typeof actionTaken !== 'string' ||
    !VALID_ACTIONS.has(actionTaken) ||
    typeof recommendedAction !== 'string' ||
    !VALID_ACTIONS.has(recommendedAction)
  ) {
    return null;
  }

  const isDecisionCorrect = raw['isDecisionCorrect'];
  const evLoss = raw['evLoss'];
  const chosenActionEv = raw['chosenActionEv'];
  const bestActionEv = raw['bestActionEv'];
  if (
    typeof isDecisionCorrect !== 'boolean' ||
    typeof evLoss !== 'number' ||
    !Number.isFinite(evLoss) ||
    evLoss < 0 ||
    typeof chosenActionEv !== 'number' ||
    !Number.isFinite(chosenActionEv) ||
    typeof bestActionEv !== 'number' ||
    !Number.isFinite(bestActionEv)
  ) {
    return null;
  }

  const rawClear = raw['clearSpotMetric'];
  if (!isPlainObject(rawClear)) {
    return null;
  }
  const eq = rawClear['equity'];
  const reqEq = rawClear['requiredEquity'];
  if (
    typeof eq !== 'number' ||
    !Number.isFinite(eq) ||
    eq < 0 ||
    eq > 1 ||
    typeof reqEq !== 'number' ||
    !Number.isFinite(reqEq) ||
    reqEq < 0 ||
    reqEq > 1
  ) {
    return null;
  }
  const clearSpotMetric = evaluateClearSpotDecision({
    equity: eq,
    requiredEquity: reqEq,
    heroDecision: actionTaken === 'fold' ? 'fold' : 'call',
  });

  // Optional outsMetric
  let outsMetric = null;
  if (isPlainObject(raw['outsMetric'])) {
    const uo = raw['outsMetric']['userOuts'];
    const eo = raw['outsMetric']['expectedOuts'];
    if (
      typeof uo === 'number' &&
      Number.isInteger(uo) &&
      uo >= 0 &&
      typeof eo === 'number' &&
      Number.isInteger(eo) &&
      eo >= 0
    ) {
      outsMetric = evaluateOutsCount(uo, eo);
    }
  }

  // Optional outsPercentMetric
  let outsPercentMetric = null;
  if (isPlainObject(raw['outsPercentMetric'])) {
    const ur = raw['outsPercentMetric']['userRatio'];
    const er = raw['outsPercentMetric']['exactRatio'];
    if (
      typeof ur === 'number' &&
      Number.isFinite(ur) &&
      ur >= 0 &&
      ur <= 1 &&
      typeof er === 'number' &&
      Number.isFinite(er) &&
      er >= 0 &&
      er <= 1
    ) {
      outsPercentMetric = evaluateOutsProbabilityError(ur, er);
    }
  }

  // Optional potOddsMetric
  let potOddsMetric = null;
  if (isPlainObject(raw['potOddsMetric'])) {
    const ur = raw['potOddsMetric']['userRatio'];
    const er = raw['potOddsMetric']['exactRatio'];
    if (
      typeof ur === 'number' &&
      Number.isFinite(ur) &&
      ur >= 0 &&
      ur <= 1 &&
      typeof er === 'number' &&
      Number.isFinite(er) &&
      er >= 0 &&
      er <= 1
    ) {
      potOddsMetric = evaluatePotOddsError(ur, er);
    }
  }

  // Optional boardTextureMetric
  let boardTextureMetric = null;
  if (isPlainObject(raw['boardTextureMetric'])) {
    const uc = raw['boardTextureMetric']['userClassification'];
    const ec = raw['boardTextureMetric']['expectedClassification'];
    if (
      typeof uc === 'string' &&
      VALID_TEXTURES.has(uc) &&
      typeof ec === 'string' &&
      VALID_TEXTURES.has(ec)
    ) {
      boardTextureMetric = Object.freeze({
        userClassification: uc as BoardTextureClass,
        expectedClassification: ec as BoardTextureClass,
        isCorrect: uc === ec,
      });
    }
  }

  const rawContesting = Array.isArray(raw['contestingRivalIds'])
    ? raw['contestingRivalIds'].filter(isRivalId)
    : [];
  const contestingRivalIds: readonly RivalId[] = Object.freeze(
    rawContesting.length > 0 ? rawContesting : [primaryRivalId],
  );

  const seq =
    typeof raw['sequenceIndex'] === 'number' &&
    Number.isInteger(raw['sequenceIndex']) &&
    raw['sequenceIndex'] >= 1
      ? raw['sequenceIndex']
      : fallbackSeq;

  const responseTimeMs =
    typeof raw['responseTimeMs'] === 'number' &&
    Number.isFinite(raw['responseTimeMs']) &&
    raw['responseTimeMs'] >= 0
      ? Math.round(raw['responseTimeMs'])
      : null;

  return Object.freeze({
    attemptId:
      typeof raw['attemptId'] === 'string' && raw['attemptId'].length > 0
        ? raw['attemptId']
        : `attempt:${seq}`,
    sequenceIndex: seq,
    ...(typeof raw['recordedAtIso'] === 'string' ? { recordedAtIso: raw['recordedAtIso'] } : {}),
    spotId:
      typeof raw['spotId'] === 'string' && raw['spotId'].length > 0
        ? raw['spotId']
        : `spot:${seq}`,
    conceptId: conceptId as DrillConceptId,
    level: level as ActiveDrillLevel,
    street: street as DrillAttemptRecord['street'],
    primaryRivalId,
    contestingRivalIds,
    isNongTilted: typeof raw['isNongTilted'] === 'boolean' ? raw['isNongTilted'] : false,
    actionTaken: actionTaken as DrillAttemptRecord['actionTaken'],
    actionAmount:
      typeof raw['actionAmount'] === 'number' && Number.isFinite(raw['actionAmount'])
        ? raw['actionAmount']
        : 0,
    recommendedAction: recommendedAction as DrillAttemptRecord['recommendedAction'],
    isDecisionCorrect,
    evLoss,
    chosenActionEv,
    bestActionEv,
    responseTimeMs,
    timedOut: typeof raw['timedOut'] === 'boolean' ? raw['timedOut'] : false,
    hintUsed: typeof raw['hintUsed'] === 'boolean' ? raw['hintUsed'] : false,
    outsMetric,
    outsPercentMetric,
    potOddsMetric,
    clearSpotMetric,
    boardTextureMetric,
    handWon: typeof raw['handWon'] === 'boolean' ? raw['handWon'] : isDecisionCorrect,
    decisionVsOutcomeBadgeVi:
      typeof raw['decisionVsOutcomeBadgeVi'] === 'string'
        ? raw['decisionVsOutcomeBadgeVi']
        : 'Quyết định đã ghi nhận',
  });
}

/**
 * Serializes `DrillPersistedState` to a versioned JSON string.
 */
export function serializeDrillPersistedState(state: DrillPersistedState): string {
  return JSON.stringify(state);
}

/**
 * Parses and validates a raw JSON string into `DrillPersistedState`.
 * Safely recovers from corrupted JSON, unsupported schema versions, or malformed records.
 */
export function parseDrillPersistedState(raw: string | null | undefined): {
  readonly state: DrillPersistedState;
  readonly recoveredFromError: boolean;
  readonly errorReason: string | null;
} {
  if (raw === null || raw === undefined || raw.trim() === '') {
    return {
      state: createInitialDrillPersistedState(),
      recoveredFromError: false,
      errorReason: null,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      state: createInitialDrillPersistedState(),
      recoveredFromError: true,
      errorReason: 'invalid-json',
    };
  }

  if (!isPlainObject(parsed)) {
    return {
      state: createInitialDrillPersistedState(),
      recoveredFromError: true,
      errorReason: 'non-object-root',
    };
  }

  if (parsed['version'] !== DRILL_STORAGE_VERSION) {
    return {
      state: createInitialDrillPersistedState(),
      recoveredFromError: true,
      errorReason: `unsupported-version:${String(parsed['version'])}`,
    };
  }

  if (!Array.isArray(parsed['attempts']) || !Array.isArray(parsed['completedLessons'])) {
    return {
      state: createInitialDrillPersistedState(),
      recoveredFromError: true,
      errorReason: 'missing-collections',
    };
  }

  let hadDroppedItems = false;
  const completedLessons: DrillConceptId[] = [];
  for (const item of parsed['completedLessons']) {
    if (typeof item === 'string' && VALID_CONCEPTS.has(item)) {
      if (!completedLessons.includes(item as DrillConceptId)) {
        completedLessons.push(item as DrillConceptId);
      }
    } else {
      hadDroppedItems = true;
    }
  }

  const attempts: DrillAttemptRecord[] = [];
  for (let i = 0; i < parsed['attempts'].length; i++) {
    const sanitized = sanitizeAttemptRecord(parsed['attempts'][i], i + 1);
    if (sanitized !== null) {
      attempts.push(sanitized);
    } else {
      hadDroppedItems = true;
    }
  }

  const maxSeq = attempts.reduce((max, a) => Math.max(max, a.sequenceIndex), 0);
  const rawNextSeq = parsed['nextSequenceIndex'];
  const nextSequenceIndex =
    typeof rawNextSeq === 'number' &&
    Number.isInteger(rawNextSeq) &&
    rawNextSeq > maxSeq
      ? rawNextSeq
      : maxSeq + 1;

  const rawLevel = parsed['lastSelectedLevel'];
  const lastSelectedLevel: DrillLevel =
    typeof rawLevel === 'number' && VALID_LEVELS.has(rawLevel)
      ? (rawLevel as DrillLevel)
      : 1;

  const rawConcept = parsed['lastSelectedConcept'];
  const lastSelectedConcept: DrillConceptId =
    typeof rawConcept === 'string' && VALID_CONCEPTS.has(rawConcept)
      ? (rawConcept as DrillConceptId)
      : 'outs';

  const rawClock = parsed['clockSeconds'];
  const clockSeconds: 10 | 15 | 20 | 25 =
    typeof rawClock === 'number' && VALID_CLOCKS.has(rawClock)
      ? (rawClock as 10 | 15 | 20 | 25)
      : 20;

  return {
    state: Object.freeze({
      version: DRILL_STORAGE_VERSION,
      nextSequenceIndex,
      completedLessons: Object.freeze(completedLessons),
      attempts: Object.freeze(attempts),
      lastSelectedLevel,
      lastSelectedConcept,
      clockSeconds,
    }),
    recoveredFromError: hadDroppedItems,
    errorReason: hadDroppedItems ? 'dropped-malformed-entries' : null,
  };
}

/**
 * Loads `DrillPersistedState` from a storage provider (or provider getter),
 * safely handling blocked storage (`SecurityError`), missing storage, or corrupted data.
 */
export function loadDrillStateFromStorage(
  providerOrGetter:
    | (() => DrillStorageProvider | null | undefined)
    | DrillStorageProvider
    | null
    | undefined,
  key = DRILL_STORAGE_KEY,
): {
  readonly state: DrillPersistedState;
  readonly storageAvailable: boolean;
  readonly recoveredFromError: boolean;
  readonly errorReason: string | null;
} {
  let provider: DrillStorageProvider | null | undefined = null;
  try {
    provider =
      typeof providerOrGetter === 'function' ? providerOrGetter() : providerOrGetter;
  } catch {
    return {
      state: createInitialDrillPersistedState(),
      storageAvailable: false,
      recoveredFromError: true,
      errorReason: 'storage-access-blocked',
    };
  }

  if (provider === null || provider === undefined) {
    return {
      state: createInitialDrillPersistedState(),
      storageAvailable: false,
      recoveredFromError: false,
      errorReason: 'storage-unavailable',
    };
  }

  let raw: string | null = null;
  try {
    raw = provider.getItem(key);
  } catch {
    return {
      state: createInitialDrillPersistedState(),
      storageAvailable: false,
      recoveredFromError: true,
      errorReason: 'storage-read-blocked',
    };
  }

  const parsed = parseDrillPersistedState(raw);
  return {
    state: parsed.state,
    storageAvailable: true,
    recoveredFromError: parsed.recoveredFromError,
    errorReason: parsed.errorReason,
  };
}

/**
 * Saves `DrillPersistedState` to a storage provider (or provider getter),
 * catching quota or security exceptions so UI execution is never interrupted.
 */
export function saveDrillStateToStorage(
  providerOrGetter:
    | (() => DrillStorageProvider | null | undefined)
    | DrillStorageProvider
    | null
    | undefined,
  state: DrillPersistedState,
  key = DRILL_STORAGE_KEY,
): {
  readonly ok: boolean;
  readonly errorReason: string | null;
} {
  let provider: DrillStorageProvider | null | undefined = null;
  try {
    provider =
      typeof providerOrGetter === 'function' ? providerOrGetter() : providerOrGetter;
  } catch {
    return { ok: false, errorReason: 'storage-access-blocked' };
  }

  if (provider === null || provider === undefined) {
    return { ok: false, errorReason: 'storage-unavailable' };
  }

  try {
    provider.setItem(key, serializeDrillPersistedState(state));
    return { ok: true, errorReason: null };
  } catch {
    return { ok: false, errorReason: 'storage-write-blocked' };
  }
}

/**
 * Pure reducer that appends a valid completed attempt record to `DrillPersistedState`.
 */
export function recordCompletedAttempt(
  state: DrillPersistedState,
  attempt: DrillAttemptRecord,
): DrillPersistedState {
  const assignedSeq = state.nextSequenceIndex;
  const normalizedAttempt: DrillAttemptRecord = Object.freeze({
    ...attempt,
    sequenceIndex: assignedSeq,
    attemptId: `${attempt.spotId}:L${attempt.level}:${assignedSeq}`,
  });

  return Object.freeze({
    ...state,
    nextSequenceIndex: assignedSeq + 1,
    attempts: Object.freeze([...state.attempts, normalizedAttempt]),
    lastSelectedLevel: attempt.level,
    lastSelectedConcept: attempt.conceptId,
  });
}

/**
 * Pure reducer that marks a Level 0 lesson as completed.
 */
export function markLessonCompleted(
  state: DrillPersistedState,
  conceptId: DrillConceptId,
): DrillPersistedState {
  if (state.completedLessons.includes(conceptId)) {
    return state;
  }
  return Object.freeze({
    ...state,
    completedLessons: Object.freeze([...state.completedLessons, conceptId]),
  });
}

/**
 * Pure reducer updating selected level, concept, or Level 3 clock duration.
 */
export function updateDrillPreferences(
  state: DrillPersistedState,
  prefs: {
    readonly lastSelectedLevel?: DrillLevel;
    readonly lastSelectedConcept?: DrillConceptId;
    readonly clockSeconds?: 10 | 15 | 20 | 25;
  },
): DrillPersistedState {
  return Object.freeze({
    ...state,
    ...(prefs.lastSelectedLevel !== undefined
      ? { lastSelectedLevel: prefs.lastSelectedLevel }
      : {}),
    ...(prefs.lastSelectedConcept !== undefined
      ? { lastSelectedConcept: prefs.lastSelectedConcept }
      : {}),
    ...(prefs.clockSeconds !== undefined ? { clockSeconds: prefs.clockSeconds } : {}),
  });
}

/**
 * Returns the list of all 9 rival IDs for UI display.
 */
export function getAllDrillRivalIds(): readonly RivalId[] {
  return RIVAL_IDS;
}
