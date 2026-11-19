import type { Denomination } from '../../engine';

export type DrillSoundEffect =
  | { readonly kind: 'chip'; readonly denomination: Denomination }
  | { readonly kind: 'card-flip' }
  | { readonly kind: 'tick' }
  | { readonly kind: 'correct' }
  | { readonly kind: 'incorrect' }
  | { readonly kind: 'payout' };

const CHIP_FREQUENCIES: Readonly<Record<Denomination, readonly [number, number]>> = Object.freeze({
  5: [1320, 1760],
  10: [1140, 1520],
  50: [920, 1380],
  100: [740, 1110],
});

/**
 * Web Audio synthesizer for Drill UI (spec §11, D32):
 * - Lazily initializes `AudioContext` only after a user gesture.
 * - Distinct chip clink pitches/timbres for denominations 5, 10, 50, 100.
 * - Deduplicates repeated event keys so action replay never triggers duplicate audio.
 */
export class DrillSoundController {
  private ctx: AudioContext | null = null;
  private muted = false;
  private lastEventKey: string | null = null;

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
  }

  private ensureContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') {
      return null;
    }
    if (this.ctx === null) {
      const AudioCtx =
        window.AudioContext ??
        (window as unknown as { readonly webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (AudioCtx === undefined) {
        return null;
      }
      try {
        this.ctx = new AudioCtx();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public play(effect: DrillSoundEffect, deduplicateKey?: string): void {
    if (this.muted) {
      return;
    }
    if (deduplicateKey !== undefined) {
      if (this.lastEventKey === deduplicateKey) {
        return;
      }
      this.lastEventKey = deduplicateKey;
    }

    const ctx = this.ensureContext();
    if (ctx === null) {
      return;
    }

    try {
      const now = ctx.currentTime;
      switch (effect.kind) {
        case 'chip': {
          const [f1, f2] = CHIP_FREQUENCIES[effect.denomination];
          this.playTone(ctx, f1, now, 0.055, 'triangle', 0.08);
          this.playTone(ctx, f2, now + 0.015, 0.065, 'sine', 0.06);
          break;
        }
        case 'card-flip': {
          this.playTone(ctx, 420, now, 0.04, 'sine', 0.05);
          this.playTone(ctx, 640, now + 0.02, 0.045, 'triangle', 0.04);
          break;
        }
        case 'tick': {
          this.playTone(ctx, 980, now, 0.035, 'square', 0.04);
          break;
        }
        case 'correct': {
          this.playTone(ctx, 523.25, now, 0.09, 'sine', 0.08);
          this.playTone(ctx, 659.25, now + 0.07, 0.12, 'sine', 0.08);
          break;
        }
        case 'incorrect': {
          this.playTone(ctx, 310, now, 0.11, 'sawtooth', 0.06);
          this.playTone(ctx, 245, now + 0.09, 0.14, 'sawtooth', 0.06);
          break;
        }
        case 'payout': {
          this.playTone(ctx, 880, now, 0.06, 'triangle', 0.06);
          this.playTone(ctx, 1174.66, now + 0.05, 0.08, 'triangle', 0.06);
          this.playTone(ctx, 1318.5, now + 0.1, 0.1, 'sine', 0.06);
          break;
        }
      }
    } catch {
      // Ignore audio errors on restricted devices
    }
  }

  private playTone(
    ctx: AudioContext,
    frequency: number,
    startTime: number,
    duration: number,
    type: OscillatorType,
    peakGain: number,
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, startTime);

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(peakGain, startTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.01);
  }
}
