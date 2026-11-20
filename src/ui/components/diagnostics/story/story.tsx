/**
 * Dev-only story page for the diagnostics components: `/src/ui/components/diagnostics/story/index.html` on the Vite
 * dev server. Query: theme=dark, address=1 (a support address is configured), optin=0 (opt-in hidden), share=1
 * (the browser can share files), open=1 (the dialog open), layout=dialog|sheet.
 * Its literals are dev labels, not product copy.
 */
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../tokens.css';
import { GlyphSprite } from '../../../primitives/Glyph.tsx';
import { diagnosticsPrompt, DiagnosticsButton, SureLine, type DiagnosticsButtonServices } from '../index.ts';
import './story.css';

const params = new URLSearchParams(location.search);
if (params.get('theme')) document.documentElement.dataset.theme = params.get('theme') ?? 'light';
if (params.get('share') === '1') {
  Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
  Object.defineProperty(navigator, 'share', { value: async () => undefined, configurable: true });
}

const text = JSON.stringify({ format: 'story', pad: 'x'.repeat(64 * 1024) });
const file = { fileName: 'sightread-try-2026-11-19-1432.json', text, file: { tries: [{}] } };
let includeAudio = false;
const services: DiagnosticsButtonServices = {
  supportAddress: params.get('address') === '1' ? 'help@example.test' : null,
  soundOptInShown: params.get('optin') !== '0',
  exportTry: async () => file,
  exportLast: async () => file,
  settings: async () => ({ includeAudio }),
  setSettings: async (s) => {
    includeAudio = s.includeAudio;
  },
  download: () => undefined,
};
const layout = params.get('layout') === 'sheet' ? 'sheet' : params.get('layout') === 'dialog' ? 'dialog' : 'auto';

/** StrictMode runs effects twice; the click must happen once. */
let opened = false;

function Story() {
  useEffect(() => {
    if (params.get('open') !== '1' || opened) return;
    opened = true;
    document.querySelector<HTMLButtonElement>('[data-story="button"] button')?.click();
  }, []);
  return (
    <>
      <GlyphSprite />
      <main className="story" data-story="board">
        <section>
          <h2>{'How sure, clear'}</h2>
          <SureLine level="clear" steady={27} total={28} />
        </section>
        <section>
          <h2>{'How sure, mostly'}</h2>
          <SureLine level="mostly" n={3} />
        </section>
        <section>
          <h2>{'How sure, unsure'}</h2>
          <SureLine level="unsure" />
        </section>
        <section data-story="button">
          <h2>{'Button'}</h2>
          <div className="story-stack">
            <p>{diagnosticsPrompt(services)}</p>
            <DiagnosticsButton services={services} layout={layout} />
          </div>
        </section>
      </main>
    </>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Story />
  </StrictMode>,
);
