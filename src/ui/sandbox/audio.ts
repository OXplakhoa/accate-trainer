import { emptyChips, type Denomination, type HandTimelineEvent } from '../../engine';
import { AudioCore } from '../audio/AudioCore';
import { TableSounds } from '../audio/TableSounds';
import type { AudioSettings } from './types';

export class SandboxAudioEngine {
  private readonly audio: AudioCore;
  private readonly sounds: TableSounds;
  private readonly playedKeys = new Set<string>();
  private seatPan = new Map<string, number>();
  private pendingFoldWin: { winnerId: string; amount: number } | null = null;

  constructor(initialSettings: AudioSettings) {
    this.audio = new AudioCore(initialSettings);
    this.sounds = new TableSounds(this.audio);
  }

  public updateSettings(next: AudioSettings): void {
    if (next.muted || next.chips <= 0) this.pendingFoldWin = null;
    this.audio.updateSettings(next);
  }

  public isUnlocked(): boolean {
    return this.audio.isUnlocked();
  }

  public hasPlayed(eventKey: string): boolean {
    return this.playedKeys.has(eventKey);
  }

  public clearPlayedHistory(): void {
    this.playedKeys.clear();
    this.pendingFoldWin = null;
  }

  /** Called inside the existing click, pointer or key handler. */
  public unlockFromUserGesture(): boolean {
    return this.audio.unlockFromUserGesture();
  }

  public playChip(denom: Denomination): void {
    this.sounds.playChip(denom);
  }

  public playCardDeal(cardCount = 1): void {
    this.sounds.playCardDeal(Math.min(3, Math.max(1, cardCount)));
  }

  public playOutOfTurnAlert(): void {
    this.sounds.playOutOfTurn();
  }

  public playPayoutFanfare(): void {
    this.sounds.playPayoutFanfare();
  }

  public playTimerTick(urgent = false): void {
    this.sounds.playTimerTick(urgent);
  }

  public setSeatPan(map: Record<string, number>): void {
    this.seatPan = new Map(
      Object.entries(map)
        .filter(([, pan]) => Number.isFinite(pan))
        .map(([playerId, pan]) => [playerId, Math.max(-1, Math.min(1, pan))]),
    );
  }

  public playHeroTurnCue(): void {
    this.sounds.playHeroTurn();
  }

  /** Returns true on the first observation, even when sound is unavailable. */
  public playTimelineEventOnce(eventKey: string, event: HandTimelineEvent): boolean {
    if (this.playedKeys.has(eventKey)) return false;
    this.playedKeys.add(eventKey);

    switch (event.type) {
      case 'ante-collected':
        event.playerIds.forEach((id, i) => {
          this.sounds.playChips({ ...emptyChips(), 5: 1 }, { pan: this.pan(id), delay: i * 0.027 });
        });
        break;
      case 'cards-dealt':
        this.sounds.playCardDeal(2, this.pan(event.dealerPlayerId));
        break;
      case 'street-dealt':
        this.sounds.playCardDeal(event.cards.length);
        break;
      case 'out-of-turn-declared':
        this.sounds.playOutOfTurn(this.pan(event.playerId));
        break;
      case 'out-of-turn-cancelled':
        this.sounds.playChips(event.returnedChips, { pan: this.pan(event.playerId) });
        break;
      case 'player-action': {
        const pan = this.pan(event.playerId);
        if (event.action.type === 'check') this.sounds.playCheck(pan);
        else if (event.action.type === 'fold') this.sounds.playMuck(pan);
        else if (event.isAllIn) this.sounds.playAllIn(event.action.chips, pan);
        else this.sounds.playChips(event.action.chips, { pan });
        break;
      }
      case 'chip-exchange':
        this.sounds.playChips(event.give, { pan: this.pan(event.fromPlayerId) });
        this.sounds.playChips(event.receive, {
          pan: event.target.kind === 'player' ? this.pan(event.target.playerId) : 0,
          delay: 0.085,
        });
        break;
      case 'uncalled-refund':
        this.sounds.playChips(event.chips, { pan: this.pan(event.playerId) });
        break;
      case 'fold-win':
        this.queueFoldWin(event);
        break;
      case 'payout-settled':
        if (event.transfers.some(({ playerId }) => playerId === this.pendingFoldWin?.winnerId)) {
          this.pendingFoldWin = null;
        }
        this.sounds.playPotPush(
          event.transfers.map(({ playerId, chips }) => ({ chips, pan: this.pan(playerId) })),
        );
        break;
      case 'showdown':
        this.sounds.playShowdown();
        break;
    }
    return true;
  }

  public dispose(): void {
    this.pendingFoldWin = null;
    this.audio.dispose();
  }

  private pan(playerId: string): number {
    return this.seatPan.get(playerId) ?? 0;
  }

  private queueFoldWin(win: { winnerId: string; amount: number }): void {
    if (!this.isUnlocked()) return;
    // A normal fold win and its settlement arrive in the same timeline pass.
    this.pendingFoldWin = win;
    queueMicrotask(() => {
      if (this.pendingFoldWin !== win) return;
      this.pendingFoldWin = null;
      this.sounds.playPotPush([], { amount: win.amount, pan: this.pan(win.winnerId) });
    });
  }
}
