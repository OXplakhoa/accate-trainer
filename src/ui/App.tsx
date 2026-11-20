import { Activity, lazy, Suspense, useCallback, useState } from 'react';
import type { HandState } from '../engine';
import './app.css';

const DrillApp = lazy(async () => ({ default: (await import('./drill')).DrillApp }));
const SandboxApp = lazy(async () => ({ default: (await import('./sandbox')).SandboxApp }));

type PracticeSpot = { hand: HandState; heroId: string };
type Mode = 'drill' | 'sandbox';

export function App() {
  const [mode, setMode] = useState<Mode>('drill');
  const [openedSandbox, setOpenedSandbox] = useState(false);
  const [practiceSpot, setPracticeSpot] = useState<PracticeSpot>();

  const openPracticeSpot = useCallback((hand: HandState, heroId: string) => {
    setPracticeSpot({ hand, heroId });
    setMode('drill');
  }, []);

  function openSandbox() {
    setOpenedSandbox(true);
    setMode('sandbox');
  }

  return (
    <>
      <nav className="accate-mode-nav" aria-label="Chế độ chơi">
        <button type="button" aria-pressed={mode === 'drill'} onClick={() => setMode('drill')}>
          Luyện tập
        </button>
        <button type="button" aria-pressed={mode === 'sandbox'} onClick={openSandbox}>
          Bàn Sandbox
        </button>
      </nav>

      <Suspense fallback={<p className="accate-app-status" role="status">Đang mở chế độ chơi…</p>}>
        <Activity mode={mode === 'drill' ? 'visible' : 'hidden'}>
          <DrillApp
            initialSpot={practiceSpot}
            onBackToSandbox={practiceSpot ? openSandbox : undefined}
          />
        </Activity>
        {openedSandbox && (
          <Activity mode={mode === 'sandbox' ? 'visible' : 'hidden'}>
            <SandboxApp onPracticeSpot={openPracticeSpot} />
          </Activity>
        )}
      </Suspense>
    </>
  );
}

export default App;
