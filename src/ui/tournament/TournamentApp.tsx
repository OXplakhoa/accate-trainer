import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadSandboxSettings,
  SandboxApp,
  sanitizeSettings,
  type DealAnimationEndInfo,
  type SandboxExternalApi,
  type SandboxSettings,
} from '../sandbox';
import { TournamentClockDriver } from './coordinator';
import { TournamentTimerWidget } from './TournamentTimerWidget';
import type { TournamentAppProps, TournamentClockState } from './types';
import './tournament.css';

function resolveInitialClockSettings(
  initialSettings?: Partial<SandboxSettings>,
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null,
): { readonly durationSeconds: SandboxSettings['tournamentTimerSeconds']; readonly reducedMotion: boolean } {
  const loaded = loadSandboxSettings(storage);
  const merged = sanitizeSettings({
    ...loaded.settings,
    ...initialSettings,
    audio: {
      ...loaded.settings.audio,
      ...initialSettings?.audio,
    },
  }).settings;
  return {
    durationSeconds: merged.tournamentTimerSeconds,
    reducedMotion: merged.reducedMotion,
  };
}

export function TournamentApp({
  initialSeed,
  initialSettings,
  onPracticeSpot,
  active = true,
  storage,
}: TournamentAppProps) {
  const initialDefaultsRef = useRef<{
    readonly durationSeconds: SandboxSettings['tournamentTimerSeconds'];
    readonly reducedMotion: boolean;
  } | null>(null);
  if (initialDefaultsRef.current === null) {
    initialDefaultsRef.current = resolveInitialClockSettings(initialSettings, storage);
  }

  const driverRef = useRef<TournamentClockDriver | null>(null);
  const [clockState, setClockState] = useState<TournamentClockState>(() => {
    const driver = new TournamentClockDriver({
      initialDurationSeconds: initialDefaultsRef.current!.durationSeconds,
      initialReducedMotion: initialDefaultsRef.current!.reducedMotion,
      initialActive: active,
      onStateChange: (next) => setClockState(next),
    });
    driverRef.current = driver;
    return driver.getState();
  });

  useEffect(() => {
    const driver = driverRef.current;
    if (!driver) {
      return;
    }
    driver.setMounted(true);
    return () => {
      driver.setMounted(false);
    };
  }, []);

  useEffect(() => {
    driverRef.current?.setActive(active);
  }, [active]);

  const handleControllerReady = useCallback((api: SandboxExternalApi) => {
    driverRef.current?.setController(api);
  }, []);

  const handleHeroTurnChange = useCallback(() => {
    driverRef.current?.handleHeroTurnChange();
  }, []);

  const handleDealAnimationEnd = useCallback((info: DealAnimationEndInfo) => {
    driverRef.current?.handleDealAnimationEnd(info);
  }, []);

  return (
    <div className="accate-tournament" data-tournament-active={active ? 'true' : 'false'}>
      <SandboxApp
        initialSeed={initialSeed}
        initialSettings={initialSettings}
        onPracticeSpot={onPracticeSpot}
        mode="tournament"
        timerSlot={<TournamentTimerWidget clockState={clockState} />}
        onDealAnimationEnd={handleDealAnimationEnd}
        onHeroTurnChange={handleHeroTurnChange}
        onControllerReady={handleControllerReady}
        disableMidHandFeedback={true}
        storage={storage}
      />
    </div>
  );
}
