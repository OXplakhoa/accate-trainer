import {
  BET_STEP,
  BUY_IN,
  initialDistribution,
  isRivalId,
  MAX_PLAYERS,
  MAX_PREFLOP_CAP,
  MIN_PLAYERS,
  MIN_PREFLOP_CAP,
  RIVAL_IDS,
  STREET_CAP,
  type ChipCounts,
  type RivalId,
  type TieBreakMode,
} from '../../engine';
import type {
  AudioSettings,
  SandboxSettings,
  TerminologyLanguage,
  TournamentTimerSeconds,
} from './types';

export const SETTINGS_STORAGE_KEY = 'accate-trainer:sandbox-settings:v1';

export const VALID_TOURNAMENT_TIMERS: readonly TournamentTimerSeconds[] = Object.freeze([
  10, 15, 20, 25,
]);

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = Object.freeze({
  muted: false,
  music: 0,
  chips: 75,
  cards: 75,
  timer: 80,
});

export const DEFAULT_SANDBOX_SETTINGS: SandboxSettings = Object.freeze({
  playerCount: 6,
  enabledRivalIds: Object.freeze([...RIVAL_IDS]),
  enablePreflopBetting: false,
  preflopCap: STREET_CAP,
  tieBreakMode: 'bai-cao',
  allowOutOfTurn: true,
  tournamentTimerSeconds: 20,
  reducedMotion: false,
  audio: DEFAULT_AUDIO_SETTINGS,
  terminology: 'en-standard',
  pauseOnImportantSpot: false,
  botSpeedMs: 700,
});

export interface ChipDistributionRow {
  readonly playerCount: number;
  readonly buyIn: number;
  readonly perPlayer: ChipCounts;
  readonly bank: ChipCounts;
}

export function getChipDistributionRows(): readonly ChipDistributionRow[] {
  const rows: ChipDistributionRow[] = [];
  for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
    const dist = initialDistribution(n);
    rows.push(
      Object.freeze({
        playerCount: n,
        buyIn: BUY_IN,
        perPlayer: dist.perPlayer,
        bank: dist.bank,
      }),
    );
  }
  return Object.freeze(rows);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampVolume(value: unknown, fallback: number): { value: number; valid: boolean } {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { value: fallback, valid: false };
  }
  const rounded = Math.round(value);
  if (rounded < 0 || rounded > 100) {
    return { value: Math.max(0, Math.min(100, rounded)), valid: false };
  }
  return { value: rounded, valid: true };
}

export function sanitizeSettings(raw: unknown): {
  readonly settings: SandboxSettings;
  readonly recoveredFromCorrupt: boolean;
} {
  if (!isPlainObject(raw)) {
    return { settings: DEFAULT_SANDBOX_SETTINGS, recoveredFromCorrupt: raw !== undefined && raw !== null };
  }

  let recovered = false;

  // playerCount: strict integer in [4, 10] (AC C1b, D44)
  let playerCount = DEFAULT_SANDBOX_SETTINGS.playerCount;
  if (raw['playerCount'] !== undefined) {
    const candidate = raw['playerCount'];
    if (
      typeof candidate === 'number' &&
      Number.isInteger(candidate) &&
      candidate >= MIN_PLAYERS &&
      candidate <= MAX_PLAYERS
    ) {
      playerCount = candidate;
    } else {
      recovered = true;
    }
  }

  // enabledRivalIds: unique valid rival IDs, at least playerCount - 1 rivals
  let enabledRivalIds: RivalId[] = [...DEFAULT_SANDBOX_SETTINGS.enabledRivalIds];
  if (raw['enabledRivalIds'] !== undefined) {
    if (Array.isArray(raw['enabledRivalIds'])) {
      const seen = new Set<RivalId>();
      const validIds: RivalId[] = [];
      for (const item of raw['enabledRivalIds']) {
        if (isRivalId(item) && !seen.has(item)) {
          seen.add(item);
          validIds.push(item);
        } else {
          recovered = true;
        }
      }
      if (validIds.length >= playerCount - 1) {
        enabledRivalIds = validIds;
      } else {
        recovered = true;
        // Top up from default rival order so table always remains playable
        for (const id of RIVAL_IDS) {
          if (!seen.has(id)) {
            seen.add(id);
            validIds.push(id);
            if (validIds.length >= playerCount - 1) {
              break;
            }
          }
        }
        enabledRivalIds = validIds;
      }
    } else {
      recovered = true;
    }
  }

  // enablePreflopBetting
  let enablePreflopBetting = DEFAULT_SANDBOX_SETTINGS.enablePreflopBetting;
  if (raw['enablePreflopBetting'] !== undefined) {
    if (typeof raw['enablePreflopBetting'] === 'boolean') {
      enablePreflopBetting = raw['enablePreflopBetting'];
    } else {
      recovered = true;
    }
  }

  // preflopCap: multiple of 5 in [5, 50]
  let preflopCap = DEFAULT_SANDBOX_SETTINGS.preflopCap;
  if (raw['preflopCap'] !== undefined) {
    const candidate = raw['preflopCap'];
    if (
      typeof candidate === 'number' &&
      Number.isInteger(candidate) &&
      candidate >= MIN_PREFLOP_CAP &&
      candidate <= MAX_PREFLOP_CAP &&
      candidate % BET_STEP === 0
    ) {
      preflopCap = candidate;
    } else {
      recovered = true;
    }
  }

  // tieBreakMode
  let tieBreakMode: TieBreakMode = DEFAULT_SANDBOX_SETTINGS.tieBreakMode;
  if (raw['tieBreakMode'] !== undefined) {
    if (raw['tieBreakMode'] === 'bai-cao' || raw['tieBreakMode'] === 'split') {
      tieBreakMode = raw['tieBreakMode'];
    } else {
      recovered = true;
    }
  }

  // allowOutOfTurn
  let allowOutOfTurn = DEFAULT_SANDBOX_SETTINGS.allowOutOfTurn;
  if (raw['allowOutOfTurn'] !== undefined) {
    if (typeof raw['allowOutOfTurn'] === 'boolean') {
      allowOutOfTurn = raw['allowOutOfTurn'];
    } else {
      recovered = true;
    }
  }

  // tournamentTimerSeconds: 10 | 15 | 20 | 25
  let tournamentTimerSeconds: TournamentTimerSeconds = DEFAULT_SANDBOX_SETTINGS.tournamentTimerSeconds;
  if (raw['tournamentTimerSeconds'] !== undefined) {
    const candidate = raw['tournamentTimerSeconds'];
    if (candidate === 10 || candidate === 15 || candidate === 20 || candidate === 25) {
      tournamentTimerSeconds = candidate;
    } else {
      recovered = true;
    }
  }

  // reducedMotion
  let reducedMotion = DEFAULT_SANDBOX_SETTINGS.reducedMotion;
  if (raw['reducedMotion'] !== undefined) {
    if (typeof raw['reducedMotion'] === 'boolean') {
      reducedMotion = raw['reducedMotion'];
    } else {
      recovered = true;
    }
  }

  // audio
  let audio: AudioSettings = DEFAULT_AUDIO_SETTINGS;
  if (raw['audio'] !== undefined) {
    if (isPlainObject(raw['audio'])) {
      const muted =
        typeof raw['audio']['muted'] === 'boolean'
          ? raw['audio']['muted']
          : ((recovered = true), DEFAULT_AUDIO_SETTINGS.muted);
      const music = clampVolume(raw['audio']['music'], DEFAULT_AUDIO_SETTINGS.music);
      const chips = clampVolume(raw['audio']['chips'], DEFAULT_AUDIO_SETTINGS.chips);
      const cards = clampVolume(raw['audio']['cards'], DEFAULT_AUDIO_SETTINGS.cards);
      const timer = clampVolume(raw['audio']['timer'], DEFAULT_AUDIO_SETTINGS.timer);
      if (!music.valid || !chips.valid || !cards.valid || !timer.valid) {
        recovered = true;
      }
      audio = Object.freeze({
        muted,
        music: music.value,
        chips: chips.value,
        cards: cards.value,
        timer: timer.value,
      });
    } else {
      recovered = true;
    }
  }

  // terminology
  let terminology: TerminologyLanguage = DEFAULT_SANDBOX_SETTINGS.terminology;
  if (raw['terminology'] !== undefined) {
    if (raw['terminology'] === 'en-standard' || raw['terminology'] === 'vi-bilingual') {
      terminology = raw['terminology'];
    } else {
      recovered = true;
    }
  }

  // pauseOnImportantSpot
  let pauseOnImportantSpot = DEFAULT_SANDBOX_SETTINGS.pauseOnImportantSpot;
  if (raw['pauseOnImportantSpot'] !== undefined) {
    if (typeof raw['pauseOnImportantSpot'] === 'boolean') {
      pauseOnImportantSpot = raw['pauseOnImportantSpot'];
    } else {
      recovered = true;
    }
  }

  // botSpeedMs
  let botSpeedMs = DEFAULT_SANDBOX_SETTINGS.botSpeedMs;
  if (raw['botSpeedMs'] !== undefined) {
    const candidate = raw['botSpeedMs'];
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0 && candidate <= 3000) {
      botSpeedMs = Math.round(candidate);
    } else {
      recovered = true;
    }
  }

  return {
    settings: Object.freeze({
      playerCount,
      enabledRivalIds: Object.freeze(enabledRivalIds),
      enablePreflopBetting,
      preflopCap,
      tieBreakMode,
      allowOutOfTurn,
      tournamentTimerSeconds,
      reducedMotion,
      audio,
      terminology,
      pauseOnImportantSpot,
      botSpeedMs,
    }),
    recoveredFromCorrupt: recovered,
  };
}

function resolveDefaultStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    // Storage access blocked (e.g. private browsing)
  }
  return null;
}

export function loadSandboxSettings(
  storage?: Pick<Storage, 'getItem'> | null,
): {
  readonly settings: SandboxSettings;
  readonly recoveredFromCorrupt: boolean;
} {
  const store = storage === undefined ? resolveDefaultStorage() : storage;
  if (!store) {
    return { settings: DEFAULT_SANDBOX_SETTINGS, recoveredFromCorrupt: false };
  }

  try {
    const rawText = store.getItem(SETTINGS_STORAGE_KEY);
    if (rawText === null || rawText.trim() === '') {
      return { settings: DEFAULT_SANDBOX_SETTINGS, recoveredFromCorrupt: false };
    }
    const parsed: unknown = JSON.parse(rawText);
    return sanitizeSettings(parsed);
  } catch {
    return { settings: DEFAULT_SANDBOX_SETTINGS, recoveredFromCorrupt: true };
  }
}

export function saveSandboxSettings(
  settings: SandboxSettings,
  storage?: Pick<Storage, 'setItem'> | null,
): boolean {
  const store = storage === undefined ? resolveDefaultStorage() : storage;
  if (!store) {
    return false;
  }

  try {
    store.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

function sameRivalList(a: readonly RivalId[], b: readonly RivalId[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const setA = new Set(a);
  return b.every((id) => setA.has(id));
}

export function hasTableRuleChanges(a: SandboxSettings, b: SandboxSettings): boolean {
  return (
    a.playerCount !== b.playerCount ||
    !sameRivalList(a.enabledRivalIds, b.enabledRivalIds) ||
    a.enablePreflopBetting !== b.enablePreflopBetting ||
    a.preflopCap !== b.preflopCap ||
    a.tieBreakMode !== b.tieBreakMode ||
    a.allowOutOfTurn !== b.allowOutOfTurn ||
    a.tournamentTimerSeconds !== b.tournamentTimerSeconds
  );
}
