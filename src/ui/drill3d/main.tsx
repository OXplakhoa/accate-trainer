import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Prototype } from './Prototype';

const root = document.getElementById('root');
if (root === null) {
  throw new Error('Prototype mount point is missing.');
}
createRoot(root).render(
  <StrictMode>
    <Prototype />
  </StrictMode>,
);
