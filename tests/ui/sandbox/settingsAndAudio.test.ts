import { describe, expect, it } from 'vitest';
import { checkInv1, chipValue, RIVAL_IDS } from '../../../src/engine';
import {
  DEFAULT_SANDBOX_SETTINGS,
  getChipDistributionRows,
  hasTableRuleChanges,
  loadSandboxSettings,
  SandboxAudioEngine,
  sanitizeSettings,
  saveSandboxSettings,
  SETTINGS_STORAGE_KEY,
} from '../../../src/ui/sandbox';

function makeMemoryStorage(initial?: Record<string, string>) {
  const data = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getItem(key: string): string | null {
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      data.set(key, value);
    },
  };
}

describe('P4 Settings, Chip Distribution & Audio Deduplication', () => {
  it('C1 / C1b: getChipDistributionRows covers N=4..10 exactly matching spec §3.5.1 and INV-1', () => {
    const rows = getChipDistributionRows();
    expect(rows.map((r) => r.playerCount)).toEqual([4, 5, 6, 7, 8, 9, 10]);

    for (const row of rows) {
      expect(row.buyIn).toBe(500);
      expect(chipValue(row.perPlayer)).toBe(500);
      const allLocations = [
        row.bank,
        ...Array.from({ length: row.playerCount }, () => row.perPlayer),
      ];
      expect(checkInv1(allLocations)).toEqual({ ok: true });
    }

    // C1b: Reject N = 3 and N = 11 back to default
    expect(sanitizeSettings({ playerCount: 3 }).settings.playerCount).toBe(
      DEFAULT_SANDBOX_SETTINGS.playerCount,
    );
    expect(sanitizeSettings({ playerCount: 3 }).recoveredFromCorrupt).toBe(true);
    expect(sanitizeSettings({ playerCount: 11 }).settings.playerCount).toBe(
      DEFAULT_SANDBOX_SETTINGS.playerCount,
    );
    expect(sanitizeSettings({ playerCount: 11 }).recoveredFromCorrupt).toBe(true);
  });

  it('persists valid settings to storage and recovers cleanly from corrupted JSON or invalid fields', () => {
    const store = makeMemoryStorage();
    const custom = sanitizeSettings({
      playerCount: 7,
      enabledRivalIds: RIVAL_IDS.slice(0, 7),
      enablePreflopBetting: true,
      preflopCap: 25,
      tieBreakMode: 'split',
      allowOutOfTurn: false,
      tournamentTimerSeconds: 15,
      reducedMotion: true,
      terminology: 'vi-bilingual',
      audio: { muted: true, music: 10, chips: 60, cards: 50, timer: 90 },
    });

    expect(custom.recoveredFromCorrupt).toBe(false);
    expect(saveSandboxSettings(custom.settings, store)).toBe(true);

    const loaded = loadSandboxSettings(store);
    expect(loaded.recoveredFromCorrupt).toBe(false);
    expect(loaded.settings).toEqual(custom.settings);

    // Corrupt JSON
    const brokenStore = makeMemoryStorage({ [SETTINGS_STORAGE_KEY]: '{not-valid-json' });
    const recovered = loadSandboxSettings(brokenStore);
    expect(recovered.recoveredFromCorrupt).toBe(true);
    expect(recovered.settings).toEqual(DEFAULT_SANDBOX_SETTINGS);

    // Partial corrupt values (too few rivals, bad cap, bad timer)
    const partial = sanitizeSettings({
      playerCount: 8,
      enabledRivalIds: ['da', 'ca', 'unknown-id'],
      preflopCap: 22,
      tournamentTimerSeconds: 99,
      audio: { muted: 'yes', chips: 999 },
    });
    expect(partial.recoveredFromCorrupt).toBe(true);
    expect(partial.settings.playerCount).toBe(8);
    expect(partial.settings.enabledRivalIds.length).toBeGreaterThanOrEqual(7);
    expect(partial.settings.preflopCap).toBe(50);
    expect(partial.settings.tournamentTimerSeconds).toBe(20);
    expect(partial.settings.audio.chips).toBe(100);
  });

  it('distinguishes table-rule changes (boundary) from immediate UI preference changes', () => {
    const uiOnly = {
      ...DEFAULT_SANDBOX_SETTINGS,
      reducedMotion: true,
      terminology: 'vi-bilingual' as const,
      audio: { ...DEFAULT_SANDBOX_SETTINGS.audio, muted: true },
    };
    expect(hasTableRuleChanges(DEFAULT_SANDBOX_SETTINGS, uiOnly)).toBe(false);

    const ruleChanged = {
      ...DEFAULT_SANDBOX_SETTINGS,
      enablePreflopBetting: true,
      preflopCap: 20,
    };
    expect(hasTableRuleChanges(DEFAULT_SANDBOX_SETTINGS, ruleChanged)).toBe(true);
  });

  it('audio engine stays locked before user gesture and deduplicates repeated timeline events', () => {
    const audio = new SandboxAudioEngine(DEFAULT_SANDBOX_SETTINGS.audio);
    expect(audio.isUnlocked()).toBe(false);

    const event = {
      type: 'ante-collected' as const,
      antePerPlayer: 5,
      playerIds: ['hero', 'da', 'ca', 'cao'],
      allInPlayerIds: [],
    };
    expect(audio.playTimelineEventOnce('1:0', event)).toBe(true);
    expect(audio.hasPlayed('1:0')).toBe(true);
    // Replaying same event key must be deduplicated
    expect(audio.playTimelineEventOnce('1:0', event)).toBe(false);
    // Resetting dedup on new session allows Hand #1 events ('1:0') to play again
    audio.clearPlayedHistory();
    expect(audio.hasPlayed('1:0')).toBe(false);
    expect(audio.playTimelineEventOnce('1:0', event)).toBe(true);
    audio.dispose();
  });
});
