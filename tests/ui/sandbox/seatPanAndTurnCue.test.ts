import { describe, expect, it } from 'vitest';
import { resolveHeroTurnCue, SANDBOX_SEAT_PAN } from '../../../src/ui/sandbox/audio';

describe('Sandbox seat pan and Hero turn cue', () => {
  it('pans each rival to the side where the 3D table seats them', () => {
    // buildCharacters.ts: Cá at x = -1.82 (left), Cáo at x = 0 (across), Nóng at x = +1.82 (right).
    expect(SANDBOX_SEAT_PAN.ca).toBeLessThan(0);
    expect(SANDBOX_SEAT_PAN.nong).toBeGreaterThan(0);
    expect(SANDBOX_SEAT_PAN.ca).toBe(-SANDBOX_SEAT_PAN.nong!);
    expect(SANDBOX_SEAT_PAN.cao).toBe(0);
    expect(SANDBOX_SEAT_PAN.hero).toBe(0);
    expect(Object.isFrozen(SANDBOX_SEAT_PAN)).toBe(true);
  });

  it('plays the cue once per Hero turn identity and never between turns', () => {
    let key: string | null = null;
    const step = (isHeroTurn: boolean, turnKey: string): boolean => {
      const decision = resolveHeroTurnCue(key, isHeroTurn, turnKey);
      key = decision.nextKey;
      return decision.play;
    };

    expect(step(false, 's:1:betting:ca:4:0')).toBe(false);
    expect(step(true, 's:1:betting:hero:5:0')).toBe(true);
    // Re-render or settings change with the same identity: silent.
    expect(step(true, 's:1:betting:hero:5:0')).toBe(false);
    // Rival acts, then Hero again on a later street: a new identity plays once.
    expect(step(false, 's:1:betting:nong:6:0')).toBe(false);
    expect(step(true, 's:1:betting:hero:9:0')).toBe(true);
    expect(step(true, 's:1:betting:hero:9:0')).toBe(false);
    // Between hands never plays, and does not forget the last identity.
    expect(step(false, 'between')).toBe(false);
    expect(step(true, 's:1:betting:hero:9:0')).toBe(false);
    // New hand.
    expect(step(true, 's:2:betting:hero:3:0')).toBe(true);
  });
});
