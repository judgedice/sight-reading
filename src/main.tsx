import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root element');
}
const root = createRoot(container);

// `#/dev/notation` loads the notation module as its own lazy chunk (PLAN ruling 39). Dev builds only, or a build
// made with VITE_NOTATION_DEV=1 (pnpm size). Production builds drop the import and the chunk.
const notationDev = import.meta.env.DEV || import.meta.env['VITE_NOTATION_DEV'] === '1';
// `#/dev/slice` (S1 thin slice, 01 §15): its own lazy chunk with notation, the audio stack and the DSP worker. Dev
// server, or a build made with `vite build --mode slice` (e2e/slice). MODE is replaced by a string literal, so other
// builds (production, pnpm size) drop the import and its chunks.
const sliceDev = import.meta.env.DEV || import.meta.env.MODE === 'slice';
if (sliceDev && /^#\/dev\/slice(?:[?/]|$)/.test(window.location.hash)) {
  void import('./app/dev/slice-screen.tsx').then(({ default: Screen }) => {
    root.render(
      <StrictMode>
        <Screen />
      </StrictMode>,
    );
  });
} else if (notationDev && window.location.hash === '#/dev/notation') {
  void import('./notation/dev-screen.tsx').then(({ default: Screen }) => {
    root.render(
      <StrictMode>
        <Screen />
      </StrictMode>,
    );
  });
} else {
  // The composition root and every screen load as one lazy chunk, so the initial chunk is React and this file
  // (PLAN ruling 39: 150 KB gzip initial).
  void import('./app/main.tsx').then(({ boot }) => boot(root));
}
