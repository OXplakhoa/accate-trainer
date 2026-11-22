import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrototypeSound } from '../../../../src/ui/drill3d/audio/PrototypeSound';
import type { DrillCue } from '../../../../src/ui/drill3d/contract';
import { audioEnvironment } from '../../audio/fakeAudio';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PrototypeSound', () => {
  it('creates audio only on unlock, handles unavailable audio, and renders every cue', () => {
    const env = audioEnvironment();
    const sound = new PrototypeSound();
    sound.play('deal');
    expect(env.AudioContextMock).not.toHaveBeenCalled();
    sound.unlockFromUserGesture();
    for (const cue of [
      'deal',
      'chip',
      'fold',
      'correct',
      'incorrect',
      'tick',
      'expired',
    ] satisfies DrillCue[]) {
      const count = env.voices.length;
      sound.play(cue);
      expect(env.voices.length).toBeGreaterThan(count);
    }
    expect(
      env.voices.every(
        (voice) => voice.start.mock.calls.length === 1 && voice.stop.mock.calls.length === 1,
      ),
    ).toBe(true);
    sound.dispose();
    vi.stubGlobal('window', {});
    expect(() => new PrototypeSound().unlockFromUserGesture()).not.toThrow();
  });

  it('stops active and scheduled voices on mute, hidden and dispose, and suppresses playback', () => {
    const env = audioEnvironment();
    const sound = new PrototypeSound();
    sound.unlockFromUserGesture();
    sound.play('deal');
    const initial = [...env.voices];
    sound.setMuted(true);
    expect(
      initial.every(
        (voice) => voice.stop.mock.calls.length === 2 && voice.disconnect.mock.calls.length === 1,
      ),
    ).toBe(true);
    sound.play('chip');
    expect(env.voices).toHaveLength(2);
    sound.setMuted(false);
    sound.play('chip');
    env.setHidden(true);
    expect(env.voices[2]!.stop).toHaveBeenCalledTimes(2);
    const count = env.voices.length;
    sound.play('tick');
    expect(env.voices).toHaveLength(count);
    env.setHidden(false);
    sound.play('expired');
    const pending = env.voices.at(-1)!;
    sound.dispose();
    expect(pending.stop).toHaveBeenCalledTimes(2);
    expect(env.context.close).toHaveBeenCalledTimes(1);
    expect(env.listeners.get('visibilitychange')?.size).toBe(0);
    sound.unlockFromUserGesture();
    sound.play('deal');
    expect(env.AudioContextMock).toHaveBeenCalledTimes(1);
  });

  it('plays a gesture cue after resume, unless it was muted while waiting', async () => {
    const env = audioEnvironment();
    env.context.state = 'suspended';
    let finishResume!: () => void;
    env.context.resume.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishResume = () => {
            env.context.state = 'running';
            resolve();
          };
        }),
    );
    const sound = new PrototypeSound();
    sound.unlockFromUserGesture();
    sound.play('deal');
    expect(env.voices).toHaveLength(0);
    finishResume();
    await vi.waitFor(() => expect(env.voices).toHaveLength(2));
    sound.dispose();

    const second = audioEnvironment();
    second.context.state = 'suspended';
    let finishSecond!: () => void;
    second.context.resume.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishSecond = () => {
            second.context.state = 'running';
            resolve();
          };
        }),
    );
    const mutedSound = new PrototypeSound();
    mutedSound.unlockFromUserGesture();
    mutedSound.play('deal');
    mutedSound.setMuted(true);
    mutedSound.setMuted(false);
    finishSecond();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(second.voices).toHaveLength(0);
    mutedSound.dispose();
  });

  it('releases finished voices without stopping them again', () => {
    const env = audioEnvironment();
    const sound = new PrototypeSound();
    sound.unlockFromUserGesture();
    sound.play('tick');
    const voice = env.voices[0]!;
    voice.onended?.();
    sound.dispose();
    expect(voice.stop).toHaveBeenCalledTimes(1);
    expect(voice.disconnect).toHaveBeenCalledTimes(1);
  });
});
