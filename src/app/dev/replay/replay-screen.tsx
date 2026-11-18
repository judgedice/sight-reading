// `#/dev/replay` (01 §13.6): loads an attempt export, a single attempt or a render stream, replays its follower events
// into the overlay state, scrubs through them, checks an attempt's replay against its stored results, and exports the
// attempt's diagnostics (never audio). Dev-only page: its text is not product copy, so it lives here, not in the catalogue.
import { useMemo, useState, type ChangeEvent } from 'react';
import { buildDiagnosticsExport } from './diagnostics.ts';
import { checkAttemptReplay, replayTimeline } from './reduce.ts';
import { parseReplaySource, pitchPoints, type ReplaySource } from './source.ts';

const LOG_LIMIT = 200;
const PITCH_W = 600;
const PITCH_H = 160;

/** Dev-page text, rendered by expression (react/jsx-no-literals). */
const T = {
  title: 'Replay',
  pick: 'Attempt export, attempt record or render stream (.json, .jsonl):',
  source: 'Source',
  empty: 'Load a file to replay it.',
  identityOk: 'Replay matches the stored results.',
  identityBad: 'Replay differs from the stored results:',
  problems: 'Stream problems:',
  none: 'none.',
  applied: 'Events applied:',
  of: 'of',
  judged: 'Judged',
  missed: 'Missed',
  ghosts: 'Ghosts',
  ended: 'Ended',
  finalAlign: 'Final alignment',
  notReached: 'not reached',
  notes: 'Expected notes',
  colExpected: 'Expected',
  colStatus: 'Status',
  colTiming: 'Timing (ms)',
  colPitch: 'Pitch',
  statusMissed: 'missed',
  log: 'Event log',
  logTail: 'Showing the last',
  logOf: 'of',
  logApplied: 'applied events.',
  download: 'Download diagnostics',
  noScore: 'no score',
  endedWord: 'ended',
  dot: '·',
  level: 'level',
  bpm: 'bpm',
  dash: '—',
  noFinalYet: '-',
} as const;

async function readText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error(`could not read ${file.name}`));
    reader.readAsText(file);
  });
}

function downloadDiagnostics(src: Extract<ReplaySource, { kind: 'attempt' }>): void {
  const json = JSON.stringify(buildDiagnosticsExport(src.record, src.timeline), null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `diagnostics-${src.record.id}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function eventSummary(type: string, ev: Record<string, unknown>): string {
  switch (type) {
    case 'judgment': {
      const j = ev['judgment'] as { expectedIdx: number; status: string; timing: string | null; pitch: string | null };
      return `expected ${j.expectedIdx}: ${j.status}${j.timing ? `, ${j.timing}` : ''}${j.pitch ? `, ${j.pitch}` : ''}`;
    }
    case 'missed':
      return `expected ${String(ev['expectedIdx'])}`;
    case 'ghost': {
      const g = ev['ghost'] as { detectedId: number; kind: string };
      return `detected ${g.detectedId}: ${g.kind}`;
    }
    case 'note-start':
      return `detected ${String(ev['detectedId'])} at beat ${String(ev['scoreBeat'])}`;
    case 'end':
      return String(ev['reason']);
    case 'final':
      return 'final alignment';
    default:
      return '';
  }
}

export function DevReplayScreen() {
  const [sources, setSources] = useState<ReplaySource[]>([]);
  const [selected, setSelected] = useState(0);
  const [cursor, setCursor] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const src = sources[selected] ?? null;
  const total = src?.timeline.length ?? 0;
  const shown = cursor === null ? total : Math.min(cursor, total);
  const state = useMemo(() => (src ? replayTimeline(src.timeline.slice(0, shown)) : null), [src, shown]);
  const identity = useMemo(() => (src?.kind === 'attempt' ? checkAttemptReplay(src.record) : null), [src]);
  const pitch = useMemo(() => (src ? pitchPoints(src) : null), [src]);

  async function onFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    const loaded: ReplaySource[] = [];
    const errors: string[] = [];
    for (const f of files) {
      try {
        loaded.push(...parseReplaySource(f.name, await readText(f)));
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
    setSources(loaded);
    setSelected(0);
    setCursor(null);
    setError(errors.length > 0 ? errors.join(' ') : null);
  }

  const fullyShown = src !== null && shown === total;
  const problems = state && fullyShown ? state.problems : [];
  const logStart = Math.max(0, shown - LOG_LIMIT);
  const pts = pitch?.points ?? [];
  const xs = pts.map((p) => p.x);
  const ms = pts.map((p) => p.midi);
  const xMin = Math.min(...xs, 0);
  const xMax = Math.max(...xs, 1);
  const mMin = Math.min(...ms, 60) - 1;
  const mMax = Math.max(...ms, 72) + 1;
  const px = (x: number) => ((x - xMin) / (xMax - xMin || 1)) * PITCH_W;
  const py = (m: number) => PITCH_H - ((m - mMin) / (mMax - mMin || 1)) * PITCH_H;

  return (
    <section data-testid="screen-dev-replay" data-route-id="dev.replay" data-loaded={src !== null}>
      <h1>{T.title}</h1>
      <p>
        <label>
          {T.pick}{' '}
          <input type="file" accept=".json,.jsonl,application/json" multiple data-testid="replay-file" onChange={(e) => void onFiles(e)} />
        </label>
      </p>
      {error !== null ? <p role="alert" data-testid="replay-error">{error}</p> : null}
      {sources.length > 1 ? (
        <p>
          <label>
            {T.source}{' '}
            <select
              data-testid="replay-select"
              value={selected}
              onChange={(e) => {
                setSelected(Number(e.target.value));
                setCursor(null);
              }}
            >
              {sources.map((s, i) => (
                <option key={`${s.label}-${i}`} value={i}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </p>
      ) : null}
      {src === null || state === null ? (
        <p>{T.empty}</p>
      ) : (
        <>
          <h2 data-testid="replay-label">{src.label}</h2>
          {src.kind === 'render' ? (
            <p data-testid="replay-header">
              {[src.header.excerptId, src.header.instrumentId, `${T.level} ${src.header.level}`, `${src.header.bpm} ${T.bpm}`].join(` ${T.dot} `)}{' '}
              {T.dash} {src.header.description}
            </p>
          ) : (
            <p data-testid="replay-header">
              {[src.record.excerptId, src.record.instrumentId, `${src.record.bpm} ${T.bpm}`, `${T.endedWord} ${src.record.endReason}`].join(` ${T.dot} `)}
              {' '}
              {T.dot} {src.record.score ? `score ${src.record.score.score} (${src.record.score.grade})` : T.noScore}
            </p>
          )}
          {identity !== null ? (
            <p data-testid="replay-identity" data-ok={identity.length === 0 && fullyShown}>
              {identity.length === 0 ? T.identityOk : `${T.identityBad} ${identity.join('; ')}`}
            </p>
          ) : null}
          {fullyShown && src.kind === 'render' ? (
            <p data-testid="replay-problems">
              {T.problems} {problems.length > 0 ? problems.join('; ') : T.none}
            </p>
          ) : null}

          <p>
            <label>
              {T.applied} {shown} {T.of} {total}{' '}
              <input type="range" data-testid="replay-cursor" min={0} max={total} value={shown} onChange={(e) => setCursor(Number(e.target.value))} />
            </label>
          </p>

          <dl data-testid="replay-state">
            <dt>{T.judged}</dt>
            <dd data-testid="replay-judged">{state.judgments.size}</dd>
            <dt>{T.missed}</dt>
            <dd data-testid="replay-missed">{state.missed.size}</dd>
            <dt>{T.ghosts}</dt>
            <dd data-testid="replay-ghosts">{state.ghosts.size}</dd>
            <dt>{T.ended}</dt>
            <dd data-testid="replay-end">{state.end ? state.end.reason : T.noFinalYet}</dd>
            <dt>{T.finalAlign}</dt>
            <dd data-testid="replay-final">
              {state.final ? `${state.final.judgments.length} judgments, ${state.final.extras.length} extras` : T.notReached}
            </dd>
          </dl>

          <svg data-testid="replay-pitch" viewBox={`0 0 ${PITCH_W} ${PITCH_H}`} role="img" aria-label={pitch?.xLabel ?? ''}>
            {pts.map((p) => (
              <circle key={p.id} cx={px(p.x)} cy={py(p.midi)} r={3} />
            ))}
          </svg>

          <h3>{T.notes}</h3>
          <table data-testid="replay-notes">
            <thead>
              <tr>
                <th>{T.colExpected}</th>
                <th>{T.colStatus}</th>
                <th>{T.colTiming}</th>
                <th>{T.colPitch}</th>
              </tr>
            </thead>
            <tbody>
              {[...state.judgments.values()]
                .sort((a, b) => a.expectedIdx - b.expectedIdx)
                .map((j) => (
                  <tr key={`j${j.expectedIdx}`}>
                    <td>{j.expectedIdx}</td>
                    <td>{j.status}</td>
                    <td>{j.timingErrorMs === null ? T.noFinalYet : j.timingErrorMs.toFixed(1)}</td>
                    <td>{j.pitch ?? T.noFinalYet}</td>
                  </tr>
                ))}
              {[...state.missed]
                .sort((a, b) => a - b)
                .map((idx) => (
                  <tr key={`m${idx}`}>
                    <td>{idx}</td>
                    <td>{T.statusMissed}</td>
                    <td>{T.noFinalYet}</td>
                    <td>{T.noFinalYet}</td>
                  </tr>
                ))}
            </tbody>
          </table>

          <h3>{T.log}</h3>
          {logStart > 0 ? (
            <p>
              {T.logTail} {LOG_LIMIT} {T.logOf} {shown} {T.logApplied}
            </p>
          ) : null}
          <ol data-testid="replay-events" start={logStart + 1}>
            {src.timeline.slice(logStart, shown).map((t, i) => (
              <li key={logStart + i}>
                {t.atMs === null ? '' : `${t.atMs.toFixed(1)} ms `}
                {t.event.type} {eventSummary(t.event.type, t.event as unknown as Record<string, unknown>)}
              </li>
            ))}
          </ol>

          {src.kind === 'attempt' ? (
            <p>
              <button type="button" data-testid="replay-export" onClick={() => downloadDiagnostics(src)}>
                {T.download}
              </button>
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
