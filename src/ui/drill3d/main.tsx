import { StrictMode, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { DEMO_SPOTS, type DemoSpot, type LessonHighlight, type ScenePhase } from './contract';
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
  const [phase, setPhase] = useState<ScenePhase>('arrival');
  const [highlight, setHighlight] = useState<LessonHighlight>(null);
  const [spot, setSpot] = useState<DemoSpot>(DEMO_SPOTS[0]);
  const reducedMotion = useSyncExternalStore(subscribeToMotionPreference, readMotionPreference);

  return (
    <div className="accate-drill-3d">
      <header className="ad3-masthead">
        <h1><span>Accate</span> Luyện tập 3D</h1>
      </header>
      <main className="ad3-workspace">
        <section className="ad3-table" aria-label="Bàn Accate">
          <DrillScene phase={phase} highlight={highlight} spot={spot} reducedMotion={reducedMotion} />
        </section>
        <section className="ad3-lesson" aria-label="Bài luyện nhẩm phần trăm">
          <DrillLesson
            spot={spot}
            onSpotChange={setSpot}
            onPhaseChange={setPhase}
            onHighlightChange={setHighlight}
          />
        </section>
      </main>
    </div>
  );
}

const root = document.getElementById('root');
if (root === null) {
  throw new Error('Prototype mount point is missing.');
}
createRoot(root).render(<StrictMode><Prototype /></StrictMode>);
