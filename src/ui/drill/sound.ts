import type { Denomination } from '../../engine';
import { AudioCore, DRILL_AUDIO_SETTINGS } from '../audio/AudioCore';
import { TableSounds } from '../audio/TableSounds';

export type DrillSoundEffect =
  | { readonly kind: 'chip'; readonly denomination: Denomination }
  | { readonly kind: 'card-flip' }
  | { readonly kind: 'tick' }
  | { readonly kind: 'correct' }
  | { readonly kind: 'incorrect' }
  | { readonly kind: 'payout' };

const IDLE_RELEASE_MS = 60_000;

/** Adapts the existing Drill 2D cues and consecutive-key deduplication. */
export class DrillSoundController {
  private static readonly controllers = new WeakMap<Document, WeakRef<DrillSoundController>>();
  private readonly audio = new AudioCore(DRILL_AUDIO_SETTINGS);
  private readonly sounds = new TableSounds(this.audio);
  private muted = false;
  private lastEventKey: string | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    if (typeof document === 'undefined') return;
    if (!DrillSoundController.controllers.has(document)) {
      document.addEventListener('click', DrillSoundController.unlockFromDrillGesture, true);
      document.addEventListener('keydown', DrillSoundController.unlockFromDrillGesture, true);
    }
    DrillSoundController.controllers.set(document, new WeakRef(this));
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    this.audio.updateSettings({ ...DRILL_AUDIO_SETTINGS, muted });
  }

  public play(effect: DrillSoundEffect, deduplicateKey?: string): void {
    if (this.muted) return;
    if (deduplicateKey !== undefined) {
      if (this.lastEventKey === deduplicateKey) return;
      this.lastEventKey = deduplicateKey;
    }
    if (!this.audio.isUnlocked()) return;
    this.resetIdleTimer();

    switch (effect.kind) {
      case 'chip':
        this.sounds.playChip(effect.denomination);
        break;
      case 'card-flip':
        this.sounds.playCardFlip();
        break;
      case 'tick':
        this.sounds.playTimerTick(true);
        break;
      case 'correct':
      case 'incorrect':
        this.sounds.playFeedback(effect.kind === 'correct');
        break;
      case 'payout':
        this.sounds.playPayoutFanfare();
        break;
    }
  }

  // Drill 2D starts its clock from controls that do not call play().
  private static unlockFromDrillGesture(event: Event): void {
    if (
      !event.isTrusted ||
      !(event.target instanceof Element) ||
      !event.target.closest('.drill-shell')
    )
      return;
    if (
      event instanceof KeyboardEvent &&
      (event.key === 'Escape' || event.repeat || event.altKey || event.ctrlKey || event.metaKey)
    )
      return;
    const owner = event.currentTarget as Document;
    DrillSoundController.controllers.get(owner)?.deref()?.unlockFromUserGesture();
  }

  private unlockFromUserGesture(): void {
    if (this.audio.unlockFromUserGesture()) this.resetIdleTimer();
  }

  private resetIdleTimer(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.audio.dispose();
    }, IDLE_RELEASE_MS);
  }
}
