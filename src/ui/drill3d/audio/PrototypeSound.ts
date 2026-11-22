import { AudioCore, DRILL_AUDIO_SETTINGS } from '../../audio/AudioCore';
import { TableSounds } from '../../audio/TableSounds';
import type { DrillCue } from '../contract';

/** Created without touching Web Audio; unlock must be called in a user gesture. */
export class PrototypeSound {
  private readonly audio = new AudioCore(DRILL_AUDIO_SETTINGS);
  private readonly sounds = new TableSounds(this.audio);
  private disposed = false;

  unlockFromUserGesture(): void {
    if (!this.disposed) this.audio.unlockFromUserGesture();
  }

  setMuted(muted: boolean): void {
    this.audio.updateSettings({ ...DRILL_AUDIO_SETTINGS, muted });
  }

  play(cue: DrillCue): void {
    switch (cue) {
      case 'deal':
        this.sounds.playCardDeal();
        break;
      case 'chip':
        this.sounds.playChip(10);
        break;
      case 'fold':
        this.sounds.playMuck();
        break;
      case 'correct':
      case 'incorrect':
        this.sounds.playFeedback(cue === 'correct');
        break;
      case 'tick':
        this.sounds.playTimerTick(true);
        break;
      case 'expired':
        this.sounds.playExpired();
        break;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.audio.dispose();
  }
}
