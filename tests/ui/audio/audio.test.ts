import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyChips } from '../../../src/engine/chips';
import type { HandTimelineEvent } from '../../../src/engine/handTypes';
import { createRng } from '../../../src/engine/rng';
import { AudioCore, MAX_AUDIO_VOICES } from '../../../src/ui/audio/AudioCore';
import { TableSounds } from '../../../src/ui/audio/TableSounds';
import { DrillSoundController } from '../../../src/ui/drill/sound';
import { SandboxAudioEngine } from '../../../src/ui/sandbox/audio';
import type { AudioSettings } from '../../../src/ui/sandbox/types';
import { audioEnvironment, mockBrowserTimer } from './fakeAudio';

const settings: AudioSettings = { muted: false, chips: 75, cards: 60, timer: 50, music: 0 };
const empty = emptyChips();
const seed = createRng('audio-regression');

function action(
  action: Extract<HandTimelineEvent, { type: 'player-action' }>['action'],
  isAllIn = false,
): HandTimelineEvent {
  return {
    type: 'player-action',
    street: 'flop',
    playerId: 'ca',
    action,
    isAllIn,
    addedAmount: action.type === 'bet' ? action.amount : 0,
    newStreetContribution: 0,
    newCurrentBet: 0,
    fromOutOfTurn: false,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('shared audio graph', () => {
  it('unlocks lazily, tolerates unsupported or blocked Web Audio, and closes the graph', () => {
    const env = audioEnvironment();
    const audio = new AudioCore(settings, seed);
    const sounds = new TableSounds(audio, seed);
    sounds.playChip(50);
    audio.updateSettings(settings);
    expect(env.AudioContextMock).not.toHaveBeenCalled();
    expect(env.nodes).toHaveLength(0);

    vi.stubGlobal('window', {});
    expect(audio.unlockFromUserGesture()).toBe(false);
    vi.stubGlobal('window', {
      AudioContext: class {
        constructor() {
          throw new Error('denied');
        }
      },
    });
    expect(audio.unlockFromUserGesture()).toBe(false);
    vi.stubGlobal('window', { webkitAudioContext: env.AudioContextMock });
    expect(audio.unlockFromUserGesture()).toBe(true);
    const compressor = env.context.createDynamicsCompressor.mock.results[0]!.value;
    expect(compressor.connect).toHaveBeenCalledWith(env.gains[0]);
    expect(compressor.ratio.value).toBeGreaterThan(1);
    expect(env.gains[0]!.connect).toHaveBeenCalledWith(env.context.destination);
    expect(
      env.gains.slice(1).every(({ connect }) => connect.mock.calls[0]?.[0] === compressor),
    ).toBe(true);

    sounds.playChip(50);
    audio.dispose();
    expect(env.liveVoices()).toHaveLength(0);
    expect(env.context.close).toHaveBeenCalledTimes(1);
    expect(env.nodes.every((node) => node.disconnect.mock.calls.length === 1)).toBe(true);
    expect(env.listeners.get('visibilitychange')?.size).toBe(0);
  });

  it('maps channel sliders, immediately clears scheduled audio on mute or hide, and disables zero channels', () => {
    const env = audioEnvironment();
    const audio = new AudioCore(settings, seed);
    const sounds = new TableSounds(audio, seed);
    audio.unlockFromUserGesture();
    const [master, music, chips, cards, timer, ui] = env.gains.map(({ gain }) => gain);
    expect([
      master!.value,
      music!.value,
      chips!.value,
      cards!.value,
      timer!.value,
      ui!.value,
    ]).toEqual([1, 0, 0.165, 0.132, 0.11, 0.165]);
    sounds.playCardDeal(3);
    expect(env.liveVoices()).toHaveLength(6);
    expect(env.panners[0]!.connect).toHaveBeenCalledWith(env.gains[3]);
    audio.updateSettings({ ...settings, muted: true });
    expect(master!.value).toBe(0);
    expect(env.liveVoices()).toHaveLength(0);
    expect(env.voices.every((voice) => voice.stop.mock.lastCall?.length === 0)).toBe(true);
    sounds.playChip(5);
    expect(env.voices).toHaveLength(6);

    audio.updateSettings({ ...settings, cards: 0 });
    expect(cards!.value).toBe(0);
    sounds.playCardDeal();
    expect(env.voices).toHaveLength(6);
    sounds.playCheck();
    sounds.playTimerTick(true);
    expect(env.liveVoices()).toHaveLength(5);
    env.setHidden(true);
    expect(master!.value).toBe(0);
    expect(env.liveVoices()).toHaveLength(0);
    sounds.playChip(100);
    expect(env.voices).toHaveLength(11);
    env.setHidden(false);
    sounds.playChip(100);
    expect(master!.value).toBe(1);
    expect(env.liveVoices()).toHaveLength(4);
    audio.dispose();
  });

  it('reuses a single noise buffer and plays when stereo panning is unavailable', () => {
    const env = audioEnvironment({ stereo: false });
    const audio = new AudioCore(settings, seed);
    const sounds = new TableSounds(audio, seed);
    audio.unlockFromUserGesture();
    sounds.playChip(5);
    sounds.playCardDeal(2);
    expect(env.panners).toHaveLength(0);
    expect(env.context.createBuffer).toHaveBeenCalledTimes(1);
    expect(env.bufferSources).toHaveLength(5);
    expect(env.bufferSources.every(({ buffer }) => buffer === env.bufferSources[0]!.buffer)).toBe(
      true,
    );
    expect(env.liveVoices()).toHaveLength(8);
    audio.dispose();
  });

  it('schedules distinct soft chords ahead and clears their timer and voices on mute, hide, zero and dispose', () => {
    const timer = mockBrowserTimer('interval');
    const env = audioEnvironment();
    const audio = new AudioCore({ ...settings, music: 40 }, seed);
    expect(timer.count()).toBe(0);
    audio.unlockFromUserGesture();
    expect(timer.count()).toBe(1);
    expect(env.gains[1]!.gain.value).toBeCloseTo(0.088);
    expect(env.oscillators).toHaveLength(4);
    const first = env.oscillators[0]!.frequency.setValueAtTime.mock.calls[0]!;
    expect(first[1]).toBeGreaterThan(env.context.currentTime);
    expect(env.filters.every(({ type }) => type === 'lowpass')).toBe(true);
    env.advanceTo(4.9);
    expect(timer.setTimer).toHaveBeenCalledWith(expect.any(Function), 125);
    timer.fire();
    expect(env.oscillators).toHaveLength(8);
    const second = env.oscillators[4]!.frequency.setValueAtTime.mock.calls[0]!;
    expect(second[0]).not.toBe(first[0]);
    expect(second[1]).toBeCloseTo(first[1] + 5.2);
    expect(env.liveVoices()).toHaveLength(8);

    audio.updateSettings({ ...settings, muted: true, music: 40 });
    expect(timer.count()).toBe(0);
    expect(env.liveVoices()).toHaveLength(0);
    timer.fire();
    expect(env.oscillators).toHaveLength(8);
    audio.updateSettings({ ...settings, music: 40 });
    expect(env.liveVoices()).toHaveLength(4);
    env.setHidden(true);
    expect(timer.count()).toBe(0);
    expect(env.liveVoices()).toHaveLength(0);
    env.setHidden(false);
    expect(env.liveVoices()).toHaveLength(4);
    audio.updateSettings(settings);
    expect(timer.count()).toBe(0);
    expect(env.liveVoices()).toHaveLength(0);
    audio.updateSettings({ ...settings, music: 40 });
    audio.dispose();
    expect(env.liveVoices()).toHaveLength(0);
    expect(timer.count()).toBe(0);
    expect(env.context.close).toHaveBeenCalledOnce();
  });
});

describe('table sound recipes', () => {
  it('varies noise brightness, resonances and decay by denomination', () => {
    const env = audioEnvironment();
    const audio = new AudioCore(settings, seed);
    const sounds = new TableSounds(audio, seed);
    audio.unlockFromUserGesture();
    for (const denomination of [5, 10, 50, 100] as const) sounds.playChip(denomination);
    expect(env.filters.map((filter) => filter.frequency.setValueAtTime.mock.calls[0]![0])).toEqual([
      4800, 3900, 2950, 2250,
    ]);
    const fundamentals = env.oscillators.filter((_, i) => i % 3 === 0);
    expect(fundamentals.map((osc) => osc.frequency.setValueAtTime.mock.calls[0]![0])).toEqual([
      1950, 1580, 1110, 790,
    ]);
    const lengths = fundamentals.map(
      (osc) => osc.stop.mock.calls[0]![0]! - osc.start.mock.calls[0]![0]!,
    );
    expect(lengths).toEqual([...lengths].sort((a, b) => a - b));
    expect(new Set(lengths).size).toBe(4);
    audio.dispose();
  });

  it('uses every real chip in a small cascade and scales larger piles within the voice budget', () => {
    const env = audioEnvironment();
    const audio = new AudioCore(settings, seed);
    const sounds = new TableSounds(audio, seed);
    audio.unlockFromUserGesture();
    const startTimes = () => env.bufferSources.map((source) => source.start.mock.calls[0]![0]!);
    const duration = (times: number[]) => times.at(-1)! - times[0]!;
    sounds.playChips({ ...empty, 50: 1 });
    expect(startTimes()).toHaveLength(1);
    env.advanceTo(1);
    sounds.playChips({ ...empty, 5: 1, 10: 3 });
    const small = startTimes().slice(1);
    expect(small).toHaveLength(4);
    expect(duration(small)).toBeGreaterThan(0.09);
    expect(
      env.filters
        .slice(1)
        .map((filter) => filter.frequency.setValueAtTime.mock.calls[0]![0])
        .sort(),
    ).toEqual([3900, 3900, 3900, 4800]);

    env.advanceTo(2);
    sounds.playChips({ ...empty, 10: 14 });
    const medium = startTimes().slice(5);
    expect(medium).toHaveLength(12);
    env.advanceTo(3);
    sounds.playChips({ ...empty, 5: 97, 10: 1, 50: 1, 100: 1 });
    const large = startTimes().slice(17);
    expect(large).toHaveLength(12);
    expect(duration(large)).toBeGreaterThan(duration(medium));
    expect(duration(medium)).toBeGreaterThan(duration(small));
    expect(
      new Set(
        env.filters.slice(-12).map((filter) => filter.frequency.setValueAtTime.mock.calls[0]![0]),
      ).size,
    ).toBe(4);
    for (let i = 0; i < 6; i++) sounds.playPotPush([{ chips: { ...empty, 5: 100 }, pan: 0 }]);
    expect(env.liveVoices().length).toBeLessThanOrEqual(MAX_AUDIO_VOICES);
    sounds.playTimerTick(true);
    expect(env.oscillators.at(-1)!.frequency.setValueAtTime.mock.calls[0]![0]).toBe(1050);
    audio.dispose();
  });
});

describe('shared audio adapters', () => {
  it('maps check, exact bet chips, all-in, card deal and split payouts, with dedup and seat pan', async () => {
    const env = audioEnvironment();
    const audio = new SandboxAudioEngine(settings);
    audio.setSeatPan({ ca: -0.7, nong: 0.8 });
    audio.unlockFromUserGesture();
    const frequencies = () =>
      env.oscillators.map((osc) => osc.frequency.setValueAtTime.mock.calls[0]![0]);
    const shipment = { ...empty, 100: 1 };

    const check = action({ type: 'check' });
    expect(audio.playTimelineEventOnce('check', check)).toBe(true);
    expect(frequencies()).toEqual([191, 168]);
    expect(env.bufferSources).toHaveLength(2);
    expect(new Set(env.panners.map(({ pan }) => pan.value))).toEqual(new Set([-0.7]));
    expect(audio.playTimelineEventOnce('check', check)).toBe(false);
    expect(env.voices).toHaveLength(4);

    audio.playTimelineEventOnce('bet', action({ type: 'bet', amount: 100, chips: shipment }));
    expect(frequencies().slice(2)).toEqual([790, 1270, 2110]);
    audio.playTimelineEventOnce('all-in', action({ type: 'call', chips: shipment }, true));
    expect(frequencies().slice(-4)).toEqual([142, 790, 1270, 2110]);

    const beforeCards = env.bufferSources.length;
    audio.playTimelineEventOnce('flop', {
      type: 'street-dealt',
      street: 'flop',
      cards: [
        { rank: 14, suit: 's' },
        { rank: 13, suit: 'c' },
        { rank: 2, suit: 'd' },
      ],
    });
    const cards = env.bufferSources.slice(beforeCards);
    expect(cards).toHaveLength(6);
    const starts = cards.map((source) => source.start.mock.calls[0]![0]!);
    expect(starts[4]! - starts[0]!).toBeCloseTo(0.18);

    const beforePayout = env.voices.length;
    audio.playTimelineEventOnce('fold-win', { type: 'fold-win', winnerId: 'ca', amount: 110 });
    audio.playTimelineEventOnce('paid', {
      type: 'payout-settled',
      transfers: [
        { playerId: 'ca', chips: shipment, amount: 100 },
        { playerId: 'nong', chips: { ...empty, 10: 1 }, amount: 10 },
      ],
    });
    await Promise.resolve();
    expect(env.voices.slice(beforePayout)).toHaveLength(10);
    expect(
      frequencies()
        .slice(-6)
        .sort((a, b) => a - b),
    ).toEqual([790, 1270, 1580, 2110, 2460, 3890]);
    expect(
      env.panners
        .slice(-8)
        .map(({ pan }) => pan.value)
        .sort(),
    ).toEqual([-0.7, -0.7, -0.7, -0.7, 0.8, 0.8, 0.8, 0.8]);
    audio.playHeroTurnCue();
    expect(frequencies().slice(-2)).toEqual([392, 523.25]);
    audio.dispose();
  });

  it('plays an isolated fold win as an amount-scaled slide without inventing chip denominations', async () => {
    const env = audioEnvironment();
    const audio = new SandboxAudioEngine(settings);
    audio.setSeatPan({ ca: -0.7 });
    audio.unlockFromUserGesture();
    audio.playTimelineEventOnce('fold-win', { type: 'fold-win', winnerId: 'ca', amount: 500 });
    await Promise.resolve();
    expect(env.oscillators).toHaveLength(0);
    expect(env.bufferSources).toHaveLength(2);
    expect(env.bufferSources[0]!.stop.mock.calls[0]![0]).toBeGreaterThan(0.45);
    expect(env.panners.map(({ pan }) => pan.value)).toEqual([-0.7, -0.7]);
    audio.dispose();
  });

  it('unlocks Drill 2D only in its native gesture, keeps cue dedup, and releases the idle graph', () => {
    const timer = mockBrowserTimer('timeout');
    const env = audioEnvironment();
    const audio = new DrillSoundController();
    audio.play({ kind: 'tick' });
    env.click(false);
    env.click(true, false);
    expect(env.AudioContextMock).not.toHaveBeenCalled();
    env.click(true);
    expect(env.AudioContextMock).toHaveBeenCalledOnce();
    audio.play({ kind: 'correct' }, 'attempt');
    audio.play({ kind: 'correct' }, 'attempt');
    expect(env.oscillators).toHaveLength(2);
    audio.setMuted(true);
    expect(env.liveVoices()).toHaveLength(0);
    audio.setMuted(false);
    audio.play({ kind: 'tick' });
    expect(env.liveVoices()).toHaveLength(1);
    expect(timer.setTimer).toHaveBeenLastCalledWith(expect.any(Function), 60_000);
    timer.fire();
    expect(env.context.close).toHaveBeenCalledOnce();
    expect(env.liveVoices()).toHaveLength(0);
  });
});
