import { StrictMode, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { PrototypeSound } from './audio/PrototypeSound';
import {
  DEMO_SPOTS,
  type DemoSpot,
  type DrillCue,
  type LessonHighlight,
  type ScenePhase,
} from './contract';
import { DrillLesson } from './lesson/DrillLesson';
import { DrillScene } from './scene/DrillScene';
import './prototype.css';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function subscribeToMotionPreference(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function readMotionPreference() {
  return window.matchMedia(REDUCED_MOTION).matches;
}

function Prototype() {
  const [muted, setMuted] = useState(false);
  const audio = useRef<PrototypeSound | null>(null);
  const lesson = useRef<HTMLElement | null>(null);
  const [entered, setEntered] = useState(false);
  const [phase, setPhase] = useState<ScenePhase>('arrival');
  const [highlight, setHighlight] = useState<LessonHighlight>(null);
  const [spot, setSpot] = useState<DemoSpot>(DEMO_SPOTS[0]);
  const reducedMotion = useSyncExternalStore(subscribeToMotionPreference, readMotionPreference);

  useEffect(
    () => () => {
      audio.current?.dispose();
      audio.current = null;
    },
    [],
  );

  function unlockSound() {
    audio.current ??= new PrototypeSound();
    audio.current.setMuted(false);
    audio.current.unlockFromUserGesture();
  }

  function toggleSound() {
    if (muted) {
      unlockSound();
    } else {
      audio.current?.setMuted(true);
    }
    setMuted(!muted);
  }

  const playCue = useCallback((cue: DrillCue) => audio.current?.play(cue), []);

  function enterTable() {
    if (!muted) {
      unlockSound();
      playCue('deal');
    }
    setEntered(true);
    lesson.current?.focus({ preventScroll: true });
  }

  return (
    <div className="accate-drill-3d">
      <header className="ad3-masthead">
        <h1>
          <span>Accate</span> Luyện tập 3D
        </h1>
        <button className="ad3-sound" type="button" onClick={toggleSound} aria-pressed={!muted}>
          {muted ? 'Đã tắt âm' : 'Âm thanh bật'}
        </button>
      </header>
      <main className="ad3-workspace">
        <section className="ad3-table" aria-label="Bàn Accate">
          <DrillScene
            phase={phase}
            highlight={highlight}
            spot={spot}
            reducedMotion={reducedMotion}
          />
        </section>
        <section
          className="ad3-lesson"
          aria-label="Bài luyện nhẩm phần trăm"
          ref={lesson}
          tabIndex={-1}
        >
          {entered ? (
            <DrillLesson
              spot={spot}
              onSpotChange={setSpot}
              onPhaseChange={setPhase}
              onHighlightChange={setHighlight}
              onCue={playCue}
            />
          ) : (
            <div className="ad3-welcome">
              <h2>Nhẩm phần trăm tại bàn</h2>
              <p>Đếm outs, tính giá Call và quyết định trên cùng một tình huống.</p>
              <button type="button" onClick={enterTable}>
                Vào bàn luyện tập
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

const root = document.getElementById('root');
if (root === null) {
  throw new Error('Prototype mount point is missing.');
}
createRoot(root).render(
  <StrictMode>
    <Prototype />
  </StrictMode>,
);
