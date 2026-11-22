import { createRng, type Rng } from '../../engine/rng';
import type { AudioSettings } from '../sandbox/types';
import { LoungePad } from './LoungePad';

const CHANNELS = ['music', 'chips', 'cards', 'timer', 'ui'] as const;
export type AudioChannel = (typeof CHANNELS)[number];

export const MAX_AUDIO_VOICES = 64;
const MAX_PENDING_CUES = 8;
const VOLUME_SCALE = 0.22;
const SILENCE = 0.0001;

export interface SoundLayer {
  readonly wave: 'noise' | 'sine' | 'triangle';
  readonly frequency: number;
  readonly endFrequency?: number;
  readonly filter?: BiquadFilterType;
  readonly filterFrequency?: number;
  readonly q?: number;
  readonly duration: number;
  readonly attack: number;
  readonly volume: number;
  readonly delay?: number;
  readonly release?: number;
  readonly pan?: number;
}

interface Voice {
  readonly channel: AudioChannel;
  readonly source: AudioScheduledSourceNode;
  readonly nodes: readonly AudioNode[];
}

interface Cue {
  readonly channel: AudioChannel;
  readonly layers: readonly SoundLayer[];
  readonly pan: number;
}

export const DRILL_AUDIO_SETTINGS: AudioSettings = Object.freeze({
  muted: false,
  music: 0,
  chips: 65,
  cards: 55,
  timer: 42,
});

/** Owns the Web Audio graph and the lifetime of every scheduled source. */
export class AudioCore {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buses = new Map<AudioChannel, GainNode>();
  private readonly graph: AudioNode[] = [];
  private readonly voices = new Set<Voice>();
  private noiseBuffer: AudioBuffer | null = null;
  private pending: Cue[] = [];
  private resumePending: Promise<void> | null = null;
  private observedDocument: Document | null = null;
  private readonly noiseRng: Rng;
  private readonly pad = new LoungePad((layers, at) => {
    this.schedule({ channel: 'music', layers, pan: 0 }, at);
  });

  constructor(
    private settings: AudioSettings,
    rng: Rng = createRng('accate-audio'),
  ) {
    this.noiseRng = rng.fork('noise');
  }

  isUnlocked(): boolean {
    return this.context !== null;
  }

  unlockFromUserGesture(): boolean {
    if (typeof window === 'undefined') return false;
    try {
      if (!this.context) {
        const AudioContextClass =
          window.AudioContext ??
          (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (typeof AudioContextClass !== 'function') return false;
        this.context = new AudioContextClass();
        this.buildGraph(this.context);
        this.context.onstatechange = this.syncMusic;
        if (typeof document !== 'undefined') {
          this.observedDocument = document;
          document.addEventListener('visibilitychange', this.syncSettings);
        }
      }
      const context = this.context;
      if (context.state === 'suspended' && !this.resumePending) {
        const resume = context.resume();
        this.resumePending = resume;
        void resume.then(
          () => this.finishResume(resume, context),
          () => this.finishResume(resume, context),
        );
      }
      this.syncSettings();
      return true;
    } catch {
      this.dispose();
      return false;
    }
  }

  updateSettings(settings: AudioSettings): void {
    this.settings = settings;
    this.syncSettings();
  }

  play(channel: AudioChannel, layers: readonly SoundLayer[], pan = 0): void {
    const context = this.context;
    if (!context || !this.canPlay(channel) || layers.length === 0) return;
    const cue = { channel, layers, pan };
    if (context.state === 'running') {
      this.schedule(cue, context.currentTime + 0.008);
    } else if (this.resumePending && this.pending.length < MAX_PENDING_CUES) {
      this.pending.push(cue);
    }
  }

  dispose(): void {
    this.pad.stop();
    this.pending = [];
    this.resumePending = null;
    for (const voice of this.voices) this.release(voice, true);
    this.observedDocument?.removeEventListener('visibilitychange', this.syncSettings);
    this.observedDocument = null;
    for (const node of this.graph) node.disconnect();
    this.graph.length = 0;
    this.buses.clear();
    this.master = null;
    this.noiseBuffer = null;

    const context = this.context;
    this.context = null;
    if (context) {
      context.onstatechange = null;
      if (context.state !== 'closed') void context.close().catch(() => {});
    }
  }

  private buildGraph(context: AudioContext): void {
    const master = context.createGain();
    this.graph.push(master);
    this.master = master;
    const limiter = context.createDynamicsCompressor();
    this.graph.push(limiter);
    limiter.threshold.value = -14;
    limiter.knee.value = 14;
    limiter.ratio.value = 5;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.14;
    limiter.connect(master);
    master.connect(context.destination);
    for (const channel of CHANNELS) {
      const bus = context.createGain();
      this.graph.push(bus);
      this.buses.set(channel, bus);
      bus.connect(limiter);
    }
  }

  private volume(channel: AudioChannel): number {
    // The existing chip slider also controls table UI cues such as the out-of-turn alert.
    const level = this.settings[channel === 'ui' ? 'chips' : channel];
    return (Math.max(0, Math.min(level, 100)) / 100) * VOLUME_SCALE;
  }

  private isAudible(): boolean {
    return !this.settings.muted && (typeof document === 'undefined' || !document.hidden);
  }

  private canPlay(channel: AudioChannel): boolean {
    return this.isAudible() && this.volume(channel) > 0;
  }

  private readonly syncSettings = (): void => {
    if (!this.master) return;
    this.master.gain.value = this.isAudible() ? 1 : 0;
    for (const [channel, bus] of this.buses) bus.gain.value = this.volume(channel);
    this.pending = this.pending.filter(({ channel }) => this.canPlay(channel));
    for (const voice of this.voices) {
      if (!this.canPlay(voice.channel)) this.release(voice, true);
    }
    this.syncMusic();
  };

  private readonly syncMusic = (): void => {
    const context = this.context;
    if (context?.state === 'running' && this.canPlay('music')) {
      this.pad.start(context);
    } else {
      this.pad.stop();
      for (const voice of this.voices) {
        if (voice.channel === 'music') this.release(voice, true);
      }
    }
  };

  private finishResume(resume: Promise<void>, context: AudioContext): void {
    if (this.resumePending !== resume) return;
    this.resumePending = null;
    const pending = this.pending;
    this.pending = [];
    if (context.state === 'running') {
      this.syncSettings();
      for (const cue of pending) this.play(cue.channel, cue.layers, cue.pan);
    }
  }

  private schedule(cue: Cue, at: number): void {
    const context = this.context;
    const bus = this.buses.get(cue.channel);
    if (!context || context.state !== 'running' || !bus || !this.canPlay(cue.channel)) return;
    // Keep a few slots for the clock and brief UI cues when chip piles overlap.
    const limit = cue.channel === 'chips' ? MAX_AUDIO_VOICES - 8 : MAX_AUDIO_VOICES;
    for (const layer of cue.layers) {
      if (this.voices.size >= limit) break;
      this.startLayer(context, bus, cue, layer, at + (layer.delay ?? 0));
    }
  }

  private startLayer(
    context: AudioContext,
    bus: GainNode,
    cue: Cue,
    layer: SoundLayer,
    at: number,
  ): void {
    const nodes: AudioNode[] = [];
    let voice: Voice | undefined;
    try {
      const end = at + layer.duration;
      const source = this.createSource(context, layer, nodes, at, end);
      let output: AudioNode = source;
      if (layer.filter) {
        const filter = context.createBiquadFilter();
        nodes.push(filter);
        filter.type = layer.filter;
        filter.frequency.setValueAtTime(layer.filterFrequency ?? layer.frequency, at);
        if (layer.endFrequency !== undefined) {
          filter.frequency.exponentialRampToValueAtTime(layer.endFrequency, end);
        }
        filter.Q.value = layer.q ?? 0.7;
        output.connect(filter);
        output = filter;
      }
      const envelope = context.createGain();
      nodes.push(envelope);
      envelope.gain.setValueAtTime(SILENCE, at);
      envelope.gain.linearRampToValueAtTime(layer.volume, at + layer.attack);
      if (layer.release !== undefined) {
        envelope.gain.setValueAtTime(layer.volume, end - layer.release);
      }
      envelope.gain.exponentialRampToValueAtTime(SILENCE, end);
      output.connect(envelope);
      output = envelope;

      const panner = this.createPanner(context, layer.pan ?? cue.pan);
      if (panner) {
        nodes.push(panner);
        output.connect(panner);
        output = panner;
      }
      output.connect(bus);

      const playing: Voice = { channel: cue.channel, source, nodes };
      voice = playing;
      this.voices.add(playing);
      source.onended = () => this.release(playing, false);
      if (layer.wave === 'noise') {
        (source as AudioBufferSourceNode).start(at, this.noiseRng.next() * 0.6);
      } else {
        source.start(at);
      }
      source.stop(end + 0.004);
    } catch {
      if (voice) this.release(voice, true);
      else for (const node of nodes) node.disconnect();
    }
  }

  private createSource(
    context: AudioContext,
    layer: SoundLayer,
    nodes: AudioNode[],
    at: number,
    end: number,
  ): AudioScheduledSourceNode {
    if (layer.wave === 'noise') {
      const source = context.createBufferSource();
      nodes.push(source);
      source.buffer = this.noiseBuffer ??= this.buildNoise(context);
      source.loop = true;
      return source;
    }
    const oscillator = context.createOscillator();
    nodes.push(oscillator);
    oscillator.type = layer.wave;
    oscillator.frequency.setValueAtTime(layer.frequency, at);
    if (!layer.filter && layer.endFrequency !== undefined) {
      oscillator.frequency.exponentialRampToValueAtTime(layer.endFrequency, end);
    }
    return oscillator;
  }

  private buildNoise(context: AudioContext): AudioBuffer {
    const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = this.noiseRng.next() * 2 - 1;
    return buffer;
  }

  private createPanner(context: AudioContext, pan: number): StereoPannerNode | null {
    if (typeof context.createStereoPanner !== 'function') return null;
    try {
      const panner = context.createStereoPanner();
      panner.pan.value = Number.isFinite(pan) ? Math.max(-1, Math.min(1, pan)) : 0;
      return panner;
    } catch {
      return null;
    }
  }

  private release(voice: Voice, stop: boolean): void {
    if (!this.voices.delete(voice)) return;
    voice.source.onended = null;
    if (stop) {
      try {
        voice.source.stop();
      } catch {
        // The browser may already have stopped this source.
      }
    }
    for (const node of voice.nodes) node.disconnect();
  }
}
