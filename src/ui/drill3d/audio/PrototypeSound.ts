import type { DrillCue } from '../contract';

type Voice = { source: AudioScheduledSourceNode; nodes: AudioNode[] };

/** Created without touching Web Audio; unlock must be called in a user gesture. */
export class PrototypeSound {
  private context: AudioContext | null = null;
  private muted = false;
  private disposed = false;
  private resumePending: Promise<void> | null = null;
  private generation = 0;
  private voices = new Set<Voice>();

  private readonly visibilityChanged = () => {
    if (document.hidden) {
      this.generation++;
      this.stopVoices();
    }
  };

  unlockFromUserGesture(): void {
    if (this.disposed || typeof window === 'undefined') return;
    try {
      if (!this.context) {
        const AudioContextClass =
          window.AudioContext ??
          (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextClass) return;
        this.context = new AudioContextClass();
        document.addEventListener('visibilitychange', this.visibilityChanged);
      }
      if (this.context.state === 'suspended' && !this.resumePending) {
        this.resumePending = this.context
          .resume()
          .catch(() => {})
          .finally(() => {
            this.resumePending = null;
          });
      }
    } catch {
      // Audio is optional, including on browsers which deny context creation.
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) {
      this.generation++;
      this.stopVoices();
    }
  }

  play(cue: DrillCue): void {
    const ctx = this.context;
    if (!ctx || this.disposed || this.muted || document.hidden) return;
    if (ctx.state !== 'running') {
      const generation = this.generation;
      if (this.resumePending)
        void this.resumePending.then(() => {
          if (this.generation === generation && ctx.state === 'running') this.play(cue);
        });
      return;
    }
    const now = ctx.currentTime;
    switch (cue) {
      case 'deal':
        this.noise(ctx, now, 0.105, 2100, 0.045);
        this.noise(ctx, now + 0.075, 0.08, 3000, 0.035);
        break;
      case 'chip':
        this.tone(ctx, now, 710, 0.095, 0.055, 'sine', 390);
        this.tone(ctx, now + 0.018, 1350, 0.045, 0.018, 'sine');
        break;
      case 'fold':
        this.noise(ctx, now, 0.12, 850, 0.026);
        this.tone(ctx, now, 240, 0.09, 0.018, 'sine', 150);
        break;
      case 'correct':
        this.tone(ctx, now, 523.25, 0.16, 0.035, 'sine');
        this.tone(ctx, now + 0.075, 659.25, 0.19, 0.03, 'sine');
        break;
      case 'incorrect':
        this.tone(ctx, now, 392, 0.14, 0.028, 'sine');
        this.tone(ctx, now + 0.085, 329.63, 0.19, 0.025, 'sine');
        break;
      case 'tick':
        this.tone(ctx, now, 880, 0.055, 0.023, 'sine', 720);
        break;
      case 'expired':
        this.tone(ctx, now, 440, 0.14, 0.029, 'sine', 360);
        this.tone(ctx, now + 0.12, 330, 0.21, 0.025, 'sine', 260);
        break;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.stopVoices();
    if (this.context) {
      document.removeEventListener('visibilitychange', this.visibilityChanged);
      void this.context.close().catch(() => {});
      this.context = null;
    }
  }

  private stopVoices(): void {
    for (const voice of this.voices) {
      voice.source.onended = null;
      try {
        voice.source.stop();
      } catch {
        /* Already stopped. */
      }
      for (const node of voice.nodes) node.disconnect();
    }
    this.voices.clear();
  }

  private start(
    source: AudioScheduledSourceNode,
    nodes: AudioNode[],
    at: number,
    duration: number,
  ) {
    const voice = { source, nodes };
    this.voices.add(voice);
    source.onended = () => {
      for (const node of nodes) node.disconnect();
      this.voices.delete(voice);
    };
    source.start(at);
    source.stop(at + duration);
  }

  private envelope(ctx: AudioContext, at: number, duration: number, volume: number): GainNode {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    gain.connect(ctx.destination);
    return gain;
  }

  private tone(
    ctx: AudioContext,
    at: number,
    frequency: number,
    duration: number,
    volume: number,
    type: OscillatorType,
    endFrequency = frequency,
  ): void {
    const oscillator = ctx.createOscillator();
    const gain = this.envelope(ctx, at, duration, volume);
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, at);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, at + duration);
    oscillator.connect(gain);
    this.start(oscillator, [oscillator, gain], at, duration);
  }

  private noise(
    ctx: AudioContext,
    at: number,
    duration: number,
    frequency: number,
    volume: number,
  ): void {
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = this.envelope(ctx, at, duration, volume);
    source.buffer = buffer;
    filter.type = 'lowpass';
    filter.frequency.value = frequency;
    source.connect(filter);
    filter.connect(gain);
    this.start(source, [source, filter, gain], at, duration);
  }
}
