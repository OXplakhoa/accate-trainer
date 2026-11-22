import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LiveSandbox3d } from './liveSandbox3d/LiveSandbox3d';
import './sandbox3dEntry.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Sandbox 3D mount point is missing.');
}

const initialSeed = new URLSearchParams(window.location.search).get('seed') ?? undefined;
createRoot(root).render(
  <StrictMode>
    <div className="accate-sandbox-3d-preview">
      <nav className="as3-nav" aria-label="Chế độ Accate">
        <strong>Accate</strong>
        <a href="/prototype-3d.html">Luyện tập 3D</a>
        <span aria-current="page">Sandbox 3D</span>
      </nav>
      <LiveSandbox3d initialSeed={initialSeed} />
    </div>
  </StrictMode>,
);
