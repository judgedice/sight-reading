/**
 * Dev-only story page for the calibration status: `/src/ui/components/calibration-status/story/index.html` on the
 * Vite dev server. Lays out the header pill, the line and the phone card row in all four states as `cal-status`
 * does. Query: theme=dark, popover=none|changed (opens that state's header pill), readthrough=1.
 * Its literals are dev labels, not product copy.
 */
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../tokens.css';
import { GlyphSprite } from '../../../primitives/Glyph.tsx';
import { CalStatusPill, type CalStatusView } from '../index.ts';
import './story.css';

const params = new URLSearchParams(location.search);
if (params.get('theme')) document.documentElement.dataset.theme = params.get('theme') ?? 'light';

const blank: CalStatusView = { state: 'none', output: null, oldOutput: null, when: null, ms: null, reason: null };
const STATES: { id: string; status: CalStatusView }[] = [
  { id: 'none', status: blank },
  { id: 'ok', status: { ...blank, state: 'ok', output: 'speakers', when: 'today', ms: 142 } },
  { id: 'changed', status: { ...blank, state: 'changed', output: 'bluetooth', oldOutput: 'speakers' } },
  { id: 'failed', status: { ...blank, state: 'failed', reason: 'error.clockRate' } },
];
const noop = (): void => undefined;

/** StrictMode runs effects twice; the click must happen once. */
let opened = false;

function Story() {
  const open = params.get('popover');
  useEffect(() => {
    if (!open || opened) return;
    opened = true;
    const b = document.querySelector<HTMLButtonElement>(`[data-story-header="${open}"] button`);
    b?.click();
  }, [open]);
  return (
    <>
      <GlyphSprite />
      <main className="story" data-story="board">
        {STATES.map((s) => (
          <section key={`h-${s.id}`}>
            <h2>{`Header, ${s.id}`}</h2>
            <div className="story-box" data-story-header={s.id}>
              <CalStatusPill status={s.status} variant="header" onCalibrate={noop} onSettings={noop} readThrough={params.get('readthrough') === '1'} />
            </div>
          </section>
        ))}
        {STATES.map((s) => (
          <section key={`l-${s.id}`}>
            <h2>{`Line, ${s.id}`}</h2>
            <div className="story-card">
              <CalStatusPill status={s.status} variant="line" onCalibrate={noop} />
            </div>
          </section>
        ))}
        {STATES.map((s) => (
          <section key={`r-${s.id}`}>
            <h2>{`Card row, ${s.id}`}</h2>
            <CalStatusPill status={s.status} variant="card-row" onCalibrate={noop} />
          </section>
        ))}
        <div className="story-gap" />
      </main>
    </>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Story />
  </StrictMode>,
);
