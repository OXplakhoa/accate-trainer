import { Activity, lazy, Suspense, useCallback, useState } from 'react';
import type { HandState } from '../engine';
import './app.css';

const DrillApp = lazy(async () => ({ default: (await import('./drill')).DrillApp }));
const SandboxApp = lazy(async () => ({ default: (await import('./sandbox')).SandboxApp }));
const TournamentApp = lazy(async () => ({
  default: (await import('./tournament')).TournamentApp,
}));

type PracticeSource = 'sandbox' | 'tournament';
type PracticeSpot = { hand: HandState; heroId: string; source: PracticeSource };
type Mode = 'drill' | 'sandbox' | 'tournament';

export function App() {
  const [mode, setMode] = useState<Mode>('drill');
  const [openedSandbox, setOpenedSandbox] = useState(false);
  const [openedTournament, setOpenedTournament] = useState(false);
  const [practiceSpot, setPracticeSpot] = useState<PracticeSpot>();

  const openPracticeFromSandbox = useCallback((hand: HandState, heroId: string) => {
    setPracticeSpot({ hand, heroId, source: 'sandbox' });
    setMode('drill');
  }, []);

  const openPracticeFromTournament = useCallback((hand: HandState, heroId: string) => {
    setPracticeSpot({ hand, heroId, source: 'tournament' });
    setMode('drill');
  }, []);

  const openSandbox = useCallback(() => {
    setOpenedSandbox(true);
    setMode('sandbox');
  }, []);

  const openTournament = useCallback(() => {
    setOpenedTournament(true);
    setMode('tournament');
  }, []);

  const backToTable =
    practiceSpot === undefined
      ? undefined
      : practiceSpot.source === 'tournament'
        ? openTournament
        : openSandbox;

  return (
    <>
      <nav className="accate-mode-nav" aria-label="Chế độ chơi">
        <button type="button" aria-pressed={mode === 'drill'} onClick={() => setMode('drill')}>
          Luyện tập
        </button>
        <button type="button" aria-pressed={mode === 'sandbox'} onClick={openSandbox}>
          Bàn Sandbox
        </button>
        <button type="button" aria-pressed={mode === 'tournament'} onClick={openTournament}>
          Tournament
        </button>
      </nav>

      <Suspense fallback={<p className="accate-app-status" role="status">Đang mở chế độ chơi…</p>}>
        <Activity mode={mode === 'drill' ? 'visible' : 'hidden'}>
          <DrillApp initialSpot={practiceSpot} onBackToSandbox={backToTable} />
        </Activity>
        {openedSandbox && (
          <Activity mode={mode === 'sandbox' ? 'visible' : 'hidden'}>
            <SandboxApp onPracticeSpot={openPracticeFromSandbox} />
          </Activity>
        )}
        {openedTournament && (
          <Activity mode={mode === 'tournament' ? 'visible' : 'hidden'}>
            <TournamentApp
              active={mode === 'tournament'}
              onPracticeSpot={openPracticeFromTournament}
            />
          </Activity>
        )}
      </Suspense>
    </>
  );
}

export default App;
