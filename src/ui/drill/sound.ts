/// <reference types="vite/client" />

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
  private static readonly controllers = new Map<Document, Set<WeakRef<DrillSoundController>>>();

  static {
    import.meta.hot?.dispose(() => {
      for (const [owner, controllers] of this.controllers) {
        for (const reference of controllers) reference.deref()?.dispose();
        this.unregisterDocument(owner);
      }
    });
  }

  private readonly audio = new AudioCore(DRILL_AUDIO_SETTINGS);
  private readonly sounds = new TableSounds(this.audio);
  private registration: { owner: Document; reference: WeakRef<DrillSoundController> } | null = null;
  private muted = false;
  private lastEventKey: string | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly shell?: Element) {
    const owner = shell?.ownerDocument ?? (typeof document === 'undefined' ? null : document);
    if (!owner) return;
    let controllers = DrillSoundController.controllers.get(owner);
    if (!controllers) {
      controllers = new Set();
      DrillSoundController.controllers.set(owner, controllers);
      owner.addEventListener('click', DrillSoundController.unlockFromDrillGesture, true);
      owner.addEventListener('keydown', DrillSoundController.unlockFromDrillGesture, true);
    }
    const reference = new WeakRef(this);
    controllers.add(reference);
    this.registration = { owner, reference };
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

  public dispose(): void {
    if (this.registration) {
      const { owner, reference } = this.registration;
      const controllers = DrillSoundController.controllers.get(owner);
      controllers?.delete(reference);
      if (controllers?.size === 0) DrillSoundController.unregisterDocument(owner);
      this.registration = null;
    }
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.audio.dispose();
  }

  private static unregisterDocument(owner: Document): void {
    if (!this.controllers.delete(owner)) return;
    owner.removeEventListener('click', this.unlockFromDrillGesture, true);
    owner.removeEventListener('keydown', this.unlockFromDrillGesture, true);
  }

  // Drill 2D starts its clock from controls that do not call play().
  private static unlockFromDrillGesture(event: Event): void {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const shell = event.target.closest('.drill-shell');
    if (!shell) return;
    if (
      event instanceof KeyboardEvent &&
      (event.key === 'Escape' || event.repeat || event.altKey || event.ctrlKey || event.metaKey)
    )
      return;
    const owner = event.currentTarget as Document;
    const controllers = DrillSoundController.controllers.get(owner);
    if (!controllers) return;

    const unbound: DrillSoundController[] = [];
    let matchedShell = false;
    for (const reference of controllers) {
      const controller = reference.deref();
      if (!controller) controllers.delete(reference);
      else if (controller.shell === shell) {
        matchedShell = true;
        controller.unlockFromUserGesture();
      } else if (!controller.shell) unbound.push(controller);
    }
    // Keep existing callers working until DrillApp supplies its shell on mount.
    if (!matchedShell) for (const controller of unbound) controller.unlockFromUserGesture();
    if (controllers.size === 0) DrillSoundController.unregisterDocument(owner);
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
