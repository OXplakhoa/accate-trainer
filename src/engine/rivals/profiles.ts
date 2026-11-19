import { MAX_PLAYERS, MIN_PLAYERS } from '../bank';
import {
  RIVAL_IDS,
  type NongTiltState,
  type RivalBehaviorParams,
  type RivalDisplayInfo,
  type RivalId,
  type RivalProfile,
  type RivalSeatAssignment,
  type RivalSeatMetadata,
  type SelectRivalsInput,
  type SelectRivalsResult,
} from './types';

const RIVAL_ID_SET: ReadonlySet<string> = new Set<string>(RIVAL_IDS);

export function isRivalId(value: unknown): value is RivalId {
  return typeof value === 'string' && RIVAL_ID_SET.has(value);
}

/**
 * Vietnamese display metadata for the 9 rival characters (spec §4.1, §4.1.1, B3).
 * Separated from behavioral parameters.
 */
export const RIVAL_DISPLAY_INFO: Readonly<Record<RivalId, RivalDisplayInfo>> = Object.freeze({
  da: Object.freeze({
    id: 'da',
    name: 'Đá',
    styleLabel: 'Tight-passive (nit)',
    styleTagVi: 'Chặt – thụ động (Nit)',
    summaryVi: 'Ít chơi tiếp sau flop; bet = bài thật',
  }),
  ca: Object.freeze({
    id: 'ca',
    name: 'Cá',
    styleLabel: 'Loose-passive (calling station)',
    styleTagVi: 'Thoáng – thụ động (Calling station)',
    summaryVi: 'Call gần như mọi thứ, hiếm raise',
  }),
  cao: Object.freeze({
    id: 'cao',
    name: 'Cáo',
    styleLabel: 'Tight-aggressive (TAG)',
    styleTagVi: 'Chặt – chủ động (TAG)',
    summaryVi: 'Chọn lọc, khi chơi thì chơi mạnh',
  }),
  soi: Object.freeze({
    id: 'soi',
    name: 'Sói',
    styleLabel: 'Loose-aggressive (LAG)',
    styleTagVi: 'Thoáng – chủ động (LAG)',
    summaryVi: 'Chơi nhiều, bet nhiều kể cả board xấu',
  }),
  dien: Object.freeze({
    id: 'dien',
    name: 'Điên',
    styleLabel: 'Maniac',
    styleTagVi: 'Cuồng nhiệt (Maniac)',
    summaryVi: 'Raise lên cap gần như mọi street; hay hô sớm',
  }),
  'dai-gia': Object.freeze({
    id: 'dai-gia',
    name: 'Đại gia',
    styleLabel: 'Whale',
    styleTagVi: 'Chịu chi (Whale)',
    summaryVi: 'Stack lớn, call lớn bằng draw yếu',
  }),
  tho: Object.freeze({
    id: 'tho',
    name: 'Thỏ',
    styleLabel: 'Weak-tight',
    styleTagVi: 'Nhát – chặt (Weak-tight)',
    summaryVi: 'Fold khi bị raise kể cả bài khá',
  }),
  bay: Object.freeze({
    id: 'bay',
    name: 'Bẫy',
    styleLabel: 'Slowplay / check-raise',
    styleTagVi: 'Gài bẫy (Slowplay / check-raise)',
    summaryVi: 'Check bài mạnh rồi check-raise',
  }),
  nong: Object.freeze({
    id: 'nong',
    name: 'Nóng',
    styleLabel: 'Tilter',
    styleTagVi: 'Dễ nóng (Tilter)',
    summaryVi: 'Chơi chắc tay, gần Cáo nhưng ít bluff hơn; dễ tilt sau khi thua pot lớn hoặc bad beat',
    normalStyleLabel: 'Tilter (Bình thường)',
    tiltStyleLabel: 'Tilter (Đang tilt)',
    tiltSummaryVi: 'Đang tilt: chơi rộng, bet/raise lên cap, hô sớm nhiều, call bằng draw yếu',
  }),
});

/**
 * Tunable numerical behavior parameters for each rival archetype (spec §4.1, §4.1.1).
 */
export const RIVAL_BEHAVIOR_PARAMS: Readonly<Record<RivalId, RivalBehaviorParams>> = Object.freeze({
  da: Object.freeze({
    continueThreshold: 0.48,
    valueThreshold: 0.70,
    strongThreshold: 0.82,
    aggressionFreq: 0.18,
    raiseVsBetFreq: 0.08,
    bluffFreq: 0.01,
    drawContinueBoost: 0.35,
    foldToRaiseThreshold: 0.58,
    foldToRaiseFreq: 0.50,
    slowplayFreq: 0.0,
    checkRaiseFreq: 0.04,
    outOfTurnFreq: 0.01,
    preferredSizingCapRatio: 0.40,
  }),
  ca: Object.freeze({
    continueThreshold: 0.14,
    valueThreshold: 0.82,
    strongThreshold: 0.90,
    aggressionFreq: 0.06,
    raiseVsBetFreq: 0.02,
    bluffFreq: 0.01,
    drawContinueBoost: 0.90,
    foldToRaiseThreshold: 0.18,
    foldToRaiseFreq: 0.12,
    slowplayFreq: 0.0,
    checkRaiseFreq: 0.01,
    outOfTurnFreq: 0.02,
    preferredSizingCapRatio: 0.30,
  }),
  cao: Object.freeze({
    continueThreshold: 0.38,
    valueThreshold: 0.48,
    strongThreshold: 0.68,
    aggressionFreq: 0.62,
    raiseVsBetFreq: 0.36,
    bluffFreq: 0.12,
    drawContinueBoost: 0.65,
    foldToRaiseThreshold: 0.44,
    foldToRaiseFreq: 0.35,
    slowplayFreq: 0.05,
    checkRaiseFreq: 0.15,
    outOfTurnFreq: 0.08,
    preferredSizingCapRatio: 0.65,
  }),
  soi: Object.freeze({
    continueThreshold: 0.22,
    valueThreshold: 0.34,
    strongThreshold: 0.56,
    aggressionFreq: 0.78,
    raiseVsBetFreq: 0.58,
    bluffFreq: 0.38,
    drawContinueBoost: 0.85,
    foldToRaiseThreshold: 0.28,
    foldToRaiseFreq: 0.20,
    slowplayFreq: 0.04,
    checkRaiseFreq: 0.22,
    outOfTurnFreq: 0.28,
    preferredSizingCapRatio: 0.80,
  }),
  dien: Object.freeze({
    continueThreshold: 0.08,
    valueThreshold: 0.14,
    strongThreshold: 0.24,
    aggressionFreq: 0.95,
    raiseVsBetFreq: 0.90,
    bluffFreq: 0.82,
    drawContinueBoost: 1.0,
    foldToRaiseThreshold: 0.12,
    foldToRaiseFreq: 0.06,
    slowplayFreq: 0.0,
    checkRaiseFreq: 0.35,
    outOfTurnFreq: 0.45,
    preferredSizingCapRatio: 1.0,
  }),
  'dai-gia': Object.freeze({
    continueThreshold: 0.20,
    valueThreshold: 0.58,
    strongThreshold: 0.76,
    aggressionFreq: 0.22,
    raiseVsBetFreq: 0.12,
    bluffFreq: 0.08,
    drawContinueBoost: 1.40,
    foldToRaiseThreshold: 0.24,
    foldToRaiseFreq: 0.18,
    slowplayFreq: 0.0,
    checkRaiseFreq: 0.04,
    outOfTurnFreq: 0.08,
    preferredSizingCapRatio: 0.60,
  }),
  tho: Object.freeze({
    continueThreshold: 0.36,
    valueThreshold: 0.60,
    strongThreshold: 0.80,
    aggressionFreq: 0.18,
    raiseVsBetFreq: 0.05,
    bluffFreq: 0.01,
    drawContinueBoost: 0.25,
    foldToRaiseThreshold: 0.78,
    foldToRaiseFreq: 0.92,
    slowplayFreq: 0.0,
    checkRaiseFreq: 0.01,
    outOfTurnFreq: 0.01,
    preferredSizingCapRatio: 0.35,
  }),
  bay: Object.freeze({
    continueThreshold: 0.32,
    valueThreshold: 0.50,
    strongThreshold: 0.56,
    aggressionFreq: 0.40,
    raiseVsBetFreq: 0.32,
    bluffFreq: 0.08,
    drawContinueBoost: 0.65,
    foldToRaiseThreshold: 0.40,
    foldToRaiseFreq: 0.28,
    slowplayFreq: 0.85,
    checkRaiseFreq: 0.92,
    outOfTurnFreq: 0.04,
    preferredSizingCapRatio: 0.75,
  }),
  nong: Object.freeze({
    continueThreshold: 0.40,
    valueThreshold: 0.52,
    strongThreshold: 0.70,
    aggressionFreq: 0.46,
    raiseVsBetFreq: 0.24,
    bluffFreq: 0.04,
    drawContinueBoost: 0.55,
    foldToRaiseThreshold: 0.46,
    foldToRaiseFreq: 0.38,
    slowplayFreq: 0.04,
    checkRaiseFreq: 0.12,
    outOfTurnFreq: 0.04,
    preferredSizingCapRatio: 0.55,
  }),
});

/**
 * Behavioral parameters for Nóng when tilted (spec §4.1.1, D45, B5–B6).
 * Plays wide, bets/raises to cap, declares out-of-turn frequently, and continues with weak draws.
 */
export const NONG_TILT_BEHAVIOR_PARAMS: RivalBehaviorParams = Object.freeze({
  continueThreshold: 0.12,
  valueThreshold: 0.18,
  strongThreshold: 0.30,
  aggressionFreq: 0.88,
  raiseVsBetFreq: 0.80,
  bluffFreq: 0.68,
  drawContinueBoost: 1.30,
  foldToRaiseThreshold: 0.16,
  foldToRaiseFreq: 0.10,
  slowplayFreq: 0.0,
  checkRaiseFreq: 0.30,
  outOfTurnFreq: 0.40,
  preferredSizingCapRatio: 1.0,
});

export const RIVAL_PROFILES: Readonly<Record<RivalId, RivalProfile>> = Object.freeze({
  da: Object.freeze({
    id: 'da',
    display: RIVAL_DISPLAY_INFO.da,
    behavior: RIVAL_BEHAVIOR_PARAMS.da,
  }),
  ca: Object.freeze({
    id: 'ca',
    display: RIVAL_DISPLAY_INFO.ca,
    behavior: RIVAL_BEHAVIOR_PARAMS.ca,
  }),
  cao: Object.freeze({
    id: 'cao',
    display: RIVAL_DISPLAY_INFO.cao,
    behavior: RIVAL_BEHAVIOR_PARAMS.cao,
  }),
  soi: Object.freeze({
    id: 'soi',
    display: RIVAL_DISPLAY_INFO.soi,
    behavior: RIVAL_BEHAVIOR_PARAMS.soi,
  }),
  dien: Object.freeze({
    id: 'dien',
    display: RIVAL_DISPLAY_INFO.dien,
    behavior: RIVAL_BEHAVIOR_PARAMS.dien,
  }),
  'dai-gia': Object.freeze({
    id: 'dai-gia',
    display: RIVAL_DISPLAY_INFO['dai-gia'],
    behavior: RIVAL_BEHAVIOR_PARAMS['dai-gia'],
  }),
  tho: Object.freeze({
    id: 'tho',
    display: RIVAL_DISPLAY_INFO.tho,
    behavior: RIVAL_BEHAVIOR_PARAMS.tho,
  }),
  bay: Object.freeze({
    id: 'bay',
    display: RIVAL_DISPLAY_INFO.bay,
    behavior: RIVAL_BEHAVIOR_PARAMS.bay,
  }),
  nong: Object.freeze({
    id: 'nong',
    display: RIVAL_DISPLAY_INFO.nong,
    behavior: RIVAL_BEHAVIOR_PARAMS.nong,
    tiltBehavior: NONG_TILT_BEHAVIOR_PARAMS,
  }),
});

export function getRivalProfile(rivalId: RivalId): RivalProfile {
  if (!isRivalId(rivalId)) {
    throw new Error(`Invalid rivalId: ${String(rivalId)}`);
  }
  return RIVAL_PROFILES[rivalId];
}

export function isNongTilted(rivalId: RivalId, tiltState?: NongTiltState): boolean {
  return (
    rivalId === 'nong' &&
    tiltState !== undefined &&
    tiltState.isTilted &&
    tiltState.handsRemaining > 0
  );
}

export function getActiveBehaviorParams(
  rivalId: RivalId,
  tiltState?: NongTiltState,
): RivalBehaviorParams {
  const profile = getRivalProfile(rivalId);
  if (isNongTilted(rivalId, tiltState) && profile.tiltBehavior !== undefined) {
    return profile.tiltBehavior;
  }
  return profile.behavior;
}

/**
 * Pure read-only accessor for seat metadata so UI can always render the rival's playing style
 * and Nóng's public tilt status without mutating or consuming tilt hand countdown (B3, B5).
 */
export function getRivalSeatMetadata(
  rivalId: RivalId,
  tiltState?: NongTiltState,
): RivalSeatMetadata {
  const profile = getRivalProfile(rivalId);
  const tilted = isNongTilted(rivalId, tiltState);
  const remaining = tilted && tiltState !== undefined ? tiltState.handsRemaining : 0;

  if (rivalId === 'nong') {
    const styleLabel = tilted
      ? (profile.display.tiltStyleLabel ?? 'Tilter (Đang tilt)')
      : (profile.display.normalStyleLabel ?? 'Tilter (Bình thường)');
    const styleSummaryVi = tilted
      ? (profile.display.tiltSummaryVi ?? profile.display.summaryVi)
      : profile.display.summaryVi;
    const publicStatusLabelVi = tilted
      ? `Đang tilt (còn ${remaining} ván)`
      : 'Bình thường';

    return Object.freeze({
      rivalId,
      name: profile.display.name,
      styleLabel,
      styleTagVi: profile.display.styleTagVi,
      styleSummaryVi,
      isTilted: tilted,
      publicMood: tilted ? 'tilted' : 'normal',
      tiltHandsRemaining: remaining,
      publicStatusLabelVi,
    });
  }

  return Object.freeze({
    rivalId,
    name: profile.display.name,
    styleLabel: profile.display.styleLabel,
    styleTagVi: profile.display.styleTagVi,
    styleSummaryVi: profile.display.summaryVi,
    isTilted: false,
    publicMood: 'normal',
    tiltHandsRemaining: 0,
    publicStatusLabelVi: 'Bình thường',
  });
}

/**
 * Selects distinct rivals from the enabled pool and shuffles seat assignments deterministically
 * using `Rng.fork(label)` (spec §4.1, D33, D45, AC B3, B4).
 */
export function selectRivalsForTable(input: SelectRivalsInput): SelectRivalsResult {
  const pool = input.enabledRivalIds ?? RIVAL_IDS;
  const seenPool = new Set<RivalId>();

  for (const id of pool) {
    if (!isRivalId(id)) {
      return {
        ok: false,
        code: 'invalid-rival-id',
        message: `Unknown rival ID in enabled pool: "${String(id)}"`,
      };
    }
    if (seenPool.has(id)) {
      return {
        ok: false,
        code: 'duplicate-rival-id-in-pool',
        message: `Duplicate rival ID in enabled pool: "${id}"`,
      };
    }
    seenPool.add(id);
  }

  if (input.totalPlayers !== undefined) {
    if (
      !Number.isInteger(input.totalPlayers) ||
      input.totalPlayers < MIN_PLAYERS ||
      input.totalPlayers > MAX_PLAYERS
    ) {
      return {
        ok: false,
        code: 'invalid-seat-count',
        message: `totalPlayers must be an integer in [${MIN_PLAYERS}, ${MAX_PLAYERS}], received ${String(input.totalPlayers)}`,
      };
    }
  }

  let targetCount: number;
  if (input.rivalCount !== undefined) {
    targetCount = input.rivalCount;
  } else if (input.seatIndices !== undefined) {
    targetCount = input.seatIndices.length;
  } else if (input.totalPlayers !== undefined) {
    targetCount = input.totalPlayers - 1;
  } else {
    return {
      ok: false,
      code: 'invalid-seat-count',
      message: 'Must specify rivalCount, totalPlayers, or seatIndices',
    };
  }

  const maxRivals = RIVAL_IDS.length;
  if (!Number.isInteger(targetCount) || targetCount < 1 || targetCount > maxRivals) {
    return {
      ok: false,
      code: 'invalid-seat-count',
      message: `rivalCount must be an integer in [1, ${maxRivals}], received ${String(targetCount)}`,
    };
  }

  if (input.totalPlayers !== undefined && targetCount > input.totalPlayers - 1) {
    return {
      ok: false,
      code: 'invalid-seat-count',
      message: `Requested rival count (${targetCount}) exceeds available rival seats (${input.totalPlayers - 1}) for totalPlayers (${input.totalPlayers})`,
    };
  }

  let seatIndices: number[];
  if (input.seatIndices !== undefined) {
    if (input.seatIndices.length !== targetCount) {
      return {
        ok: false,
        code: 'invalid-seat-indices',
        message: `seatIndices length (${input.seatIndices.length}) does not match rivalCount (${targetCount})`,
      };
    }
    if (
      input.heroSeatIndex !== undefined &&
      (!Number.isInteger(input.heroSeatIndex) || input.heroSeatIndex < 0)
    ) {
      return {
        ok: false,
        code: 'invalid-seat-indices',
        message: `Invalid heroSeatIndex: ${String(input.heroSeatIndex)}`,
      };
    }
    const seenSeats = new Set<number>();
    for (const seatIdx of input.seatIndices) {
      if (
        !Number.isInteger(seatIdx) ||
        seatIdx < 0 ||
        seenSeats.has(seatIdx) ||
        (input.heroSeatIndex !== undefined && seatIdx === input.heroSeatIndex)
      ) {
        return {
          ok: false,
          code: 'invalid-seat-indices',
          message: `Invalid or duplicate physical seatIndex: ${String(seatIdx)}`,
        };
      }
      seenSeats.add(seatIdx);
    }
    seatIndices = [...input.seatIndices].sort((a, b) => a - b);
  } else {
    const totalSeats = input.totalPlayers ?? targetCount + 1;
    const heroSeat = input.heroSeatIndex ?? 0;
    if (!Number.isInteger(heroSeat) || heroSeat < 0 || heroSeat >= totalSeats) {
      return {
        ok: false,
        code: 'invalid-seat-indices',
        message: `heroSeatIndex must be an integer in [0, ${totalSeats - 1}], received ${String(heroSeat)}`,
      };
    }
    seatIndices = [];
    for (let s = 0; s < totalSeats; s++) {
      if (s !== heroSeat && seatIndices.length < targetCount) {
        seatIndices.push(s);
      }
    }
    if (seatIndices.length !== targetCount) {
      return {
        ok: false,
        code: 'invalid-seat-count',
        message: `Could only assign ${seatIndices.length} seats for ${targetCount} requested rivals`,
      };
    }
  }

  if (pool.length < targetCount) {
    return {
      ok: false,
      code: 'insufficient-rival-pool',
      message: `Enabled rival pool has ${pool.length} rivals, but ${targetCount} distinct rivals are required`,
    };
  }

  const selectRng = input.rng.fork('rival-select');
  const seatOrderRng = input.rng.fork('rival-seat-order');

  const chosenSubset = selectRng.shuffle(pool).slice(0, targetCount);
  const shuffledRivals = seatOrderRng.shuffle(chosenSubset);

  const assignments: RivalSeatAssignment[] = seatIndices.map((seatIndex, idx) => {
    const rivalId = shuffledRivals[idx]!;
    return Object.freeze({
      seatIndex,
      rivalId,
      metadata: getRivalSeatMetadata(rivalId, input.nongTiltState),
    });
  });

  return {
    ok: true,
    rivalIds: Object.freeze(shuffledRivals),
    assignments: Object.freeze(assignments),
  };
}
