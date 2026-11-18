import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root element');
}
const root = createRoot(container);

// `#/dev/notation` loads the notation module as its own lazy chunk (PLAN ruling 39). Dev builds only, or a build
// made with VITE_NOTATION_DEV=1 (pnpm size). Production builds drop the import and the chunk.
const notationDev = import.meta.env.DEV || import.meta.env['VITE_NOTATION_DEV'] === '1';
if (notationDev && window.location.hash === '#/dev/notation') {
  void import('./notation/dev-screen.tsx').then(({ default: Screen }) => {
    root.render(
      <StrictMode>
        <Screen />
      </StrictMode>,
    );
  });
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
