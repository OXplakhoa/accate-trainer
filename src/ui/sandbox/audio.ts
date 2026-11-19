import type { Denomination, HandTimelineEvent } from '../../engine';
import type { AudioSettings } from './types';

interface WebAudioLikeContext {
  readonly state: string;
  readonly currentTime: number;
  readonly destination: AudioNode;
  resume(): Promise<void>;
  close(): Promise<void>;
  createOscillator(): OscillatorNode;
  createGain(): GainNode;
  createBiquadFilter(): BiquadFilterNode;
}

const CHIP_TONES: Readonly<
  Record<Denomination, { readonly freq: number; readonly harmonic: number; readonly decay: number }>
> = Object.freeze({
  5: { freq: 1760, harmonic: 3520, decay: 0.065 },
  10: { freq: 1396, harmonic: 2792, decay: 0.075 },
  50: { freq: 1046, harmonic: 2093, decay: 0.095 },
  100: { freq: 784, harmonic: 1568, decay: 0.12 },
});

/**
 * Web Audio sound engine for Sandbox & Tournament:
 * - Lazy-initializes `AudioContext` strictly after a user gesture (`unlockFromUserGesture`).
 * - Distinct ceramic/clay chip sounds per denomination (5 / 10 / 50 / 100), card flip/deal,
 *   out-of-turn chime, payout/bài cào fanfare, and timer tick.
 * - Independent channel gains (`music`, `chips`, `cards`, `timer`) + master mute.
 * - Deduplicates timeline event playback by unique key so replays/re-renders never double-fire.
 */
export class SandboxAudioEngine {
  private ctx: WebAudioLikeContext | null = null;
  private unlocked = false;
  private settings: AudioSettings;
  private readonly playedKeys = new Set<string>();
  private musicOsc: OscillatorNode | null = null;
  private musicGain: GainNode | null = null;

  constructor(initialSettings: AudioSettings) {
    this.settings = initialSettings;
  }

  public updateSettings(next: AudioSettings): void {
    this.settings = next;
    this.syncAmbientMusic();
  }

  public isUnlocked(): boolean {
    return this.unlocked;
  }

  public hasPlayed(eventKey: string): boolean {
    return this.playedKeys.has(eventKey);
  }

  public clearPlayedHistory(): void {
    this.playedKeys.clear();
  }

  /**
   * Must ONLY be called inside a user gesture handler (`click`, `pointerdown`, `keydown`).
   */
  public unlockFromUserGesture(): boolean {
    if (typeof globalThis === 'undefined' || typeof globalThis.window === 'undefined') {
      return false;
    }

    if (this.ctx === null) {
      const AudioCtor =
        globalThis.window.AudioContext ??
        (globalThis.window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (typeof AudioCtor !== 'function') {
        return false;
      }
      try {
        this.ctx = new AudioCtor() as unknown as WebAudioLikeContext;
      } catch {
        return false;
      }
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {
        // Ignore browser autoplay rejection
      });
    }

    this.unlocked = true;
    this.syncAmbientMusic();
    return true;
  }

  private effectiveGain(channel: 'music' | 'chips' | 'cards' | 'timer'): number {
    if (this.settings.muted) {
      return 0;
    }
    const raw = this.settings[channel];
    if (raw <= 0) {
      return 0;
    }
    return Math.min(1, raw / 100) * 0.22;
  }

  private syncAmbientMusic(): void {
    if (!this.unlocked || this.ctx === null) {
      return;
    }
    const gainValue = this.effectiveGain('music') * 0.14;

    if (gainValue <= 0) {
      if (this.musicOsc !== null) {
        try {
          this.musicOsc.stop();
          this.musicOsc.disconnect();
        } catch {
          // Ignore stop errors
        }
        this.musicOsc = null;
      }
      if (this.musicGain !== null) {
        try {
          this.musicGain.disconnect();
        } catch {
          // Ignore disconnect errors
        }
        this.musicGain = null;
      }
      return;
    }

    if (this.musicOsc === null || this.musicGain === null) {
      try {
        const osc = this.ctx.createOscillator();
        const filter = this.ctx.createBiquadFilter();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 146.83; // Soft warm D3 lounge drone
        filter.type = 'lowpass';
        filter.frequency.value = 320;
        gain.gain.value = gainValue;
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        this.musicOsc = osc;
        this.musicGain = gain;
      } catch {
        // Ignore audio node errors
      }
    } else {
      this.musicGain.gain.setTargetAtTime(gainValue, this.ctx.currentTime, 0.08);
    }
  }

  private playTone(params: {
    readonly channel: 'chips' | 'cards' | 'timer';
    readonly freq: number;
    readonly endFreq?: number;
    readonly type: OscillatorType;
    readonly duration: number;
    readonly delay?: number;
    readonly gainScale?: number;
  }): void {
    if (!this.unlocked || this.ctx === null) {
      return;
    }
    const baseGain = this.effectiveGain(params.channel);
    if (baseGain <= 0) {
      return;
    }

    try {
      const startTime = this.ctx.currentTime + (params.delay ?? 0);
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = params.type;
      osc.frequency.setValueAtTime(params.freq, startTime);
      if (params.endFreq !== undefined) {
        osc.frequency.exponentialRampToValueAtTime(
          Math.max(40, params.endFreq),
          startTime + params.duration,
        );
      }

      const peak = baseGain * (params.gainScale ?? 1);
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.linearRampToValueAtTime(peak, startTime + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + params.duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + params.duration + 0.01);
    } catch {
      // Non-fatal in restricted audio environments
    }
  }

  public playChip(denom: Denomination): void {
    const tone = CHIP_TONES[denom];
    this.playTone({
      channel: 'chips',
      freq: tone.freq,
      endFreq: tone.freq * 0.92,
      type: 'triangle',
      duration: tone.decay,
      gainScale: 0.9,
    });
    this.playTone({
      channel: 'chips',
      freq: tone.harmonic,
      endFreq: tone.harmonic * 0.88,
      type: 'sine',
      duration: tone.decay * 0.55,
      gainScale: 0.35,
    });
  }

  public playCardDeal(cardCount = 1): void {
    const count = Math.min(3, Math.max(1, cardCount));
    for (let i = 0; i < count; i++) {
      this.playTone({
        channel: 'cards',
        freq: 520 + i * 70,
        endFreq: 190,
        type: 'triangle',
        duration: 0.06,
        delay: i * 0.075,
        gainScale: 0.75,
      });
    }
  }

  public playOutOfTurnAlert(): void {
    this.playTone({
      channel: 'chips',
      freq: 660,
      endFreq: 880,
      type: 'sine',
      duration: 0.11,
      gainScale: 0.75,
    });
  }

  public playPayoutFanfare(): void {
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((freq, idx) => {
      this.playTone({
        channel: 'chips',
        freq,
        type: 'triangle',
        duration: 0.16,
        delay: idx * 0.07,
        gainScale: 0.85,
      });
    });
  }

  public playTimerTick(urgent = false): void {
    this.playTone({
      channel: 'timer',
      freq: urgent ? 1180 : 880,
      endFreq: urgent ? 920 : 700,
      type: 'square',
      duration: 0.045,
      gainScale: urgent ? 0.8 : 0.55,
    });
  }

  /**
   * Plays an appropriate sound for a timeline event ONCE per unique `eventKey`.
   * Returns `true` if the event was newly processed (false if already played / deduplicated).
   */
  public playTimelineEventOnce(eventKey: string, event: HandTimelineEvent): boolean {
    if (this.playedKeys.has(eventKey)) {
      return false;
    }
    this.playedKeys.add(eventKey);

    switch (event.type) {
      case 'ante-collected':
        this.playChip(5);
        break;
      case 'cards-dealt':
        this.playCardDeal(2);
        break;
      case 'street-dealt':
        this.playCardDeal(event.cards.length);
        break;
      case 'out-of-turn-declared':
        this.playOutOfTurnAlert();
        break;
      case 'player-action':
        if (event.addedAmount >= 50) {
          this.playChip(50);
        } else if (event.addedAmount >= 10) {
          this.playChip(10);
        } else if (event.addedAmount > 0) {
          this.playChip(5);
        } else if (event.action.type === 'fold') {
          this.playCardDeal(1);
        }
        break;
      case 'chip-exchange':
        this.playChip(10);
        break;
      case 'payout-settled':
      case 'fold-win':
        this.playPayoutFanfare();
        break;
      case 'showdown':
        this.playCardDeal(2);
        break;
      default:
        break;
    }
    return true;
  }

  public dispose(): void {
    if (this.musicOsc !== null) {
      try {
        this.musicOsc.stop();
        this.musicOsc.disconnect();
      } catch {
        // Ignore
      }
      this.musicOsc = null;
    }
    if (this.ctx !== null) {
      void this.ctx.close().catch(() => {
        // Ignore
      });
      this.ctx = null;
    }
    this.unlocked = false;
  }
}
