// `#/dev/slice`: the S1 thin vertical slice (01 §15 S1). One fixture excerpt rendered with VexFlow and the SVG overlay,
// a 1-bar count-in and metronome, live marks from the DSP worker, then the final alignment, the grade and the attempt
// record round trip through IndexedDB. `?testClock=1` (in the query or after the hash) puts t0 at the first captured
// frame plus 4 s with RTL 0 (01 §13.4); otherwise a dev field takes a typed RTL.
//
// Loaded lazily by main.tsx (dev server, or `vite build --mode slice`), so the notation module and the audio stack stay out of
// the initial chunk. `window.__slice` exposes the state the Playwright spec (e2e/slice/) reads.
import '../../ui/tokens.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FollowerEvent } from '../../core/types.ts';
import { copy } from '../../ui/copy/copy.ts';
import { GlyphSprite } from '../../ui/primitives/index.ts';
import { planLayout } from '../../ui/layout-table.ts';
import { SvgOverlay, VexScoreView, ensureNotationFonts, tickablesPerBar } from '../../notation/index.ts';
import { visualStateFromJudgment } from '../../notation/visual-states.ts';
import { SliceRunner, type SlicePhase, type SliceResult } from '../compose/slice-runtime.ts';
import { sliceConfigs, sliceTake } from '../compose/slice-take.ts';
import { SliceProbe } from './slice-probe.ts';
import { testClockRequested } from './slice-url.ts';

export function applyFollowerEvent(view: VexScoreView, ev: FollowerEvent): void {
  if (ev.type === 'clock') view.setPlayhead(ev.scoreBeat);
  else if (ev.type === 'judgment') view.setNoteState(ev.judgment.expectedIdx, visualStateFromJudgment(ev.judgment));
  else if (ev.type === 'missed') view.setNoteState(ev.expectedIdx, { phase: 'missed' });
  else if (ev.type === 'ghost') view.showGhost(ev.ghost);
}

export default function SliceScreen() {
  const host = useRef<HTMLDivElement>(null);
  const cfg = useMemo(() => sliceConfigs(), []);
  const take = useMemo(() => sliceTake(cfg), [cfg]);
  const testClock = useMemo(() => testClockRequested(window.location.search, window.location.hash), []);
  const view = useMemo(() => new VexScoreView({ overlay: new SvgOverlay({ reducedMotion: () => false, highContrast: () => false }) }), []);
  const probe = useMemo(() => new SliceProbe(take, view), [take, view]);
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<SlicePhase>('idle');
  const [rtlMs, setRtlMs] = useState(0);
  const [result, setResult] = useState<SliceResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void ensureNotationFonts().then(() => {
      const el = host.current;
      if (!live || !el) return;
      const p = take.prepared;
      const plan = planLayout({ width: Math.max(320, el.clientWidth || window.innerWidth), height: window.innerHeight }, { top: 0, bottom: 0 }, p.measures.length, tickablesPerBar(p));
      el.style.width = `${plan.renderOptions.widthPx}px`;
      probe.setLayout(view.render(p, el, plan.renderOptions));
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, [take, view, probe]);

  useEffect(() => {
    (window as unknown as { __slice: SliceProbe }).__slice = probe;
  }, [probe]);

  const start = useCallback(() => {
    const runner = new SliceRunner(take, cfg, {
      testClock,
      rtlMs,
      outputMode: 'wired',
      onEvents: (events) => probe.enqueue(events),
      onPhase: (p) => {
        probe.phase = p;
        setPhase(p);
      },
    });
    probe.attach(runner, (events) => {
      for (const ev of events) applyFollowerEvent(view, ev);
    });
    // Synchronous unlock inside the click handler (05 W1).
    runner.start().then(
      (r) => {
        probe.finish(r);
        setResult(r);
      },
      (e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        probe.error = msg;
        setError(msg);
      },
    );
  }, [take, cfg, testClock, rtlMs, probe, view]);

  const score = result?.score ?? null;
  const roundTrip = result ? (JSON.stringify(result.reloaded) === JSON.stringify(result.record) ? 'ok' : 'mismatch') : null;
  return (
    <section data-testid="screen-dev-slice" data-ready={ready} data-phase={phase} data-test-clock={testClock}>
      <GlyphSprite />
      <div className="app-dev-row">
        <button type="button" data-testid="slice-start" disabled={!ready || phase !== 'idle'} onClick={start}>
          {copy('action.start')}
        </button>
        {testClock ? null : (
          <label>
            {copy('badge.timingOffset')}
            <input type="number" data-testid="slice-rtl" value={rtlMs} min={0} max={400} onChange={(e) => setRtlMs(Number(e.target.value) || 0)} />
          </label>
        )}
        {phase === 'count-in' ? <span data-testid="slice-count-in">{copy('a11y.countIn.announce')}</span> : null}
      </div>
      <div ref={host} data-testid="slice-score" />
      {error !== null ? <p data-testid="slice-error">{error}</p> : null}
      {score ? (
        <div data-testid="slice-results" data-grade={score.grade} data-score={score.score} data-record={roundTrip}>
          <h2 data-testid="slice-grade">{score.grade}</h2>
          <p>{copy(`grade.${score.grade}`)}</p>
          <p data-testid="slice-score-value">{score.score}</p>
          <dl>
            <dt>{copy('component.notes.label')}</dt>
            <dd data-testid="slice-p">{score.components.P === null ? '-' : Math.round(score.components.P)}</dd>
            <dt>{copy('component.inTune.label')}</dt>
            <dd data-testid="slice-i">{score.components.I === null ? '-' : Math.round(score.components.I)}</dd>
            <dt>{copy('component.rhythm.label')}</dt>
            <dd data-testid="slice-r">{score.components.R === null ? '-' : Math.round(score.components.R)}</dd>
          </dl>
          <p>{copy('results.counts.missed', { n: result?.alignment.judgments.filter((j) => j.status === 'missed').length ?? 0 })}</p>
          <p>{copy('results.counts.extra', { n: result?.alignment.extras.length ?? 0 })}</p>
        </div>
      ) : null}
    </section>
  );
}
