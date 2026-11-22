import type { SoundLayer } from './AudioCore';

const CHORD_SECONDS = 5.2;
const LOOKAHEAD_SECONDS = 0.4;
const SCHEDULER_INTERVAL_MS = 125;

// Dm9, G13, Cmaj7, Cmaj9. Voicing stays in the lower midrange with no lead line.
const VOICINGS = [
  [50, 53, 60, 64],
  [43, 53, 59, 64],
  [48, 52, 55, 59],
  [48, 52, 59, 62],
] as const;

export class LoungePad {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly schedule: (layers: readonly SoundLayer[], at: number) => void) {}

  start(context: AudioContext): void {
    if (this.timer !== null) return;
    let nextChordAt = context.currentTime + 0.035;
    let chord = 0;
    const lookAhead = () => {
      if (context.state !== 'running') return;
      const now = context.currentTime;
      // After timer throttling, resume ahead of the clock without replaying missed chords.
      if (nextChordAt < now) nextChordAt = now + 0.035;
      if (nextChordAt > now + LOOKAHEAD_SECONDS) return;
      const layers = VOICINGS[chord]!.map((note, index): SoundLayer => ({
        wave: 'triangle',
        frequency: 440 * 2 ** ((note - 69) / 12),
        filter: 'lowpass',
        filterFrequency: 440,
        q: 0.45,
        attack: 1.15,
        release: 2.2,
        duration: CHORD_SECONDS + 1.3,
        delay: index * 0.045,
        volume: index === 0 ? 0.032 : 0.023,
      }));
      this.schedule(layers, nextChordAt);
      chord = (chord + 1) % VOICINGS.length;
      nextChordAt += CHORD_SECONDS;
    };
    this.timer = setInterval(lookAhead, SCHEDULER_INTERVAL_MS);
    lookAhead();
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}
