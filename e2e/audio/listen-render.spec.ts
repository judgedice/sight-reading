// Listen as heard (Listen playback review): the session's Listen plan for real corpus excerpts, rendered in Chromium
// through the sampler's run of notes (`playSampledNotes`, what WebAudioBackend.playNotes calls) into an
// OfflineAudioContext, with the real MP3 files decoded by Chromium and the Listen bus gain. Each note is then found in
// the render: its pitch (YIN over its steady part) within 15 cents of the written note's concert pitch, its onset (the
// level reaching half of the note's early peak) within 30 ms of its written time, and the level of the run at the
// Listen ceiling. So a wrong octave, a transposition slip, a wrong sample or rate, a late or smeared start, a note
// that never stops, or a run at the wrong level cannot come back without a red test.
// pnpm exec playwright test -c e2e/audio/playwright.audio.config.ts listen-render
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { expect, test, type Page } from '@playwright/test';
import type * as Plans from './listen-plans.ts';

test.skip(process.env['E2E_AUDIO'] !== '1', 'run with -c e2e/audio/playwright.audio.config.ts');

const ROOT = process.cwd();
const ORIGIN = 'http://localhost:4597';
const SOUNDS = join(ROOT, 'public', 'sounds');

/** Onset within this of the written time, seconds. */
const ONSET_TOL_SEC = 0.03;
/** Pitch within this of the written note, cents. */
const PITCH_TOL_CENTS = 15;

const CASES: Plans.CaseSpec[] = [
  // The owner's report: baritone, difficulty 1, C major, 3/4, at both tempos he used.
  { name: 'baritone, owner excerpt, 64 bpm', instrumentId: 'voice-baritone', excerptId: 'arne-lc8871933-voice-m37-44', meter: '3/4', bpm: 64 },
  { name: 'baritone, owner excerpt, 72 bpm', instrumentId: 'voice-baritone', excerptId: 'arne-lc8871933-voice-m37-44', meter: '3/4', bpm: 72 },
  { name: 'baritone, Hear bars 2 to 3', instrumentId: 'voice-baritone', excerptId: 'arne-lc8871933-voice-m37-44', meter: '3/4', bpm: 72, bars: [2, 3] },
  // A transposing instrument: written C5 sounds B-flat 4.
  { name: 'trumpet in B-flat, 72 bpm', instrumentId: 'trumpet-bb', excerptId: 'arne-lc8871933-voice-m37-44', meter: '3/4', bpm: 72 },
  // A bowed instrument with a slow attack, and a pickup.
  { name: 'cello, pickup, 72 bpm', instrumentId: 'cello', bpm: 72 },
  { name: 'soprano, difficulty 3, 96 bpm', instrumentId: 'voice-soprano', level: 3, bpm: 96, seed: 4 },
  { name: 'flute, difficulty 2, 88 bpm', instrumentId: 'flute', level: 2, bpm: 88, seed: 2 },
];

/** Page side: the sampler, the Listen bus gain and the analysis, bundled from src. */
const ENTRY = `
import { Sampler, playSampledNotes, midiOfHz, SAMPLE_GAIN } from './src/platform/shared/audio/sampler.ts';
import { LISTEN_BUS_GAIN } from './src/platform/shared/audio/listen-voice.ts';
import { LISTEN } from './src/session/listen-plan.ts';

function yin(x, sr, fmin, fmax) {
  const tauMax = Math.min(Math.floor(sr / fmin), Math.floor(x.length / 2));
  const tauMin = Math.max(2, Math.floor(sr / fmax));
  const w = x.length - tauMax;
  const d = new Float64Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let s = 0;
    for (let i = 0; i < w; i++) { const v = x[i] - x[i + tau]; s += v * v; }
    d[tau] = s;
  }
  let run = 0;
  const cm = new Float64Array(tauMax + 1).fill(1);
  for (let tau = 1; tau <= tauMax; tau++) { run += d[tau]; cm[tau] = run > 0 ? (d[tau] * tau) / run : 1; }
  let tau = -1;
  for (let t = tauMin; t < tauMax; t++) {
    if (cm[t] < 0.12) { while (t + 1 < tauMax && cm[t + 1] < cm[t]) t++; tau = t; break; }
  }
  if (tau < 0) { let m = Infinity; for (let t = tauMin; t < tauMax; t++) if (cm[t] < m) { m = cm[t]; tau = t; } }
  const a = cm[tau - 1], b = cm[tau], c = cm[tau + 1];
  const den = a - 2 * b + c;
  return sr / (tau + (Math.abs(den) > 1e-12 ? (0.5 * (a - c)) / den : 0));
}

const sampler = new Sampler({ base: 'sounds/', fetch: (u) => fetch(u), decoder: () => new OfflineAudioContext(1, 1, 44100) });

window.renderListen = async (c) => {
  const sr = 44100;
  // The run starts 0.3 s in, so a note brought forward by its rise is never clipped.
  const pre = 0.3;
  const ctx = new OfflineAudioContext(1, Math.ceil((c.endSec + pre + 0.8) * sr), sr);
  if ((await sampler.prepare(c.set)) !== 'ready') return { error: 'set not ready: ' + sampler.state(c.set) };
  const set = sampler.ready(c.set);
  const bus = ctx.createGain();
  bus.gain.value = LISTEN_BUS_GAIN;
  bus.connect(ctx.destination);
  playSampledNotes(ctx, bus, set, c.notes.map((n) => ({ midi: midiOfHz(n.hz), when: pre + n.startSec, durSec: n.durSec })), { gain: LISTEN.peak * SAMPLE_GAIN });
  const x = (await ctx.startRendering()).getChannelData(0);
  const hop = Math.round(0.001 * sr), win = Math.round(0.005 * sr);
  const rmsAt = (t) => { const i0 = Math.max(0, Math.round(t * sr) - (win >> 1)); let s = 0; for (let i = i0; i < i0 + win; i++) s += (x[i] || 0) ** 2; return Math.sqrt(s / win); };
  const rows = [];
  c.notes.forEach((n, k) => {
    const wt = pre + n.startSec;
    const prevEnd = k > 0 ? pre + c.notes[k - 1].startSec + c.notes[k - 1].durSec : 0;
    // The note's early peak: the loudest 5 ms within its first 250 ms (or its length).
    let peak = 0;
    for (let t = wt; t < wt + Math.min(0.25, n.durSec); t += 0.001) peak = Math.max(peak, rmsAt(t));
    // From the quietest point between the previous note's end and just after the written time, the first time the
    // level reaches half of that peak.
    const lo0 = Math.max(prevEnd, wt - 0.1);
    let lo = lo0, loV = Infinity;
    for (let t = lo0; t <= wt + 0.01; t += 0.001) { const v = rmsAt(t); if (v < loV) { loV = v; lo = t; } }
    let onset = null;
    for (let t = lo; t < wt + 0.2; t += 0.001) if (rmsAt(t) >= 0.5 * peak) { onset = t; break; }
    // Pitch: median YIN over the steady part.
    const f0 = 440 * 2 ** ((n.concertMidi - 69) / 12);
    const frame = Math.floor(Math.max(0.04, 5 / f0) * sr);
    const a = wt + Math.min(0.12, n.durSec * 0.4), b = wt + n.durSec - 0.03;
    const est = [];
    for (let t = a; t + frame / sr <= b + 1e-9; t += 0.02) { const i = Math.floor(t * sr); est.push(yin(x.subarray(i, i + frame), sr, f0 / 2.2, f0 * 2.2)); }
    if (est.length === 0) { const i = Math.floor(a * sr); est.push(yin(x.subarray(i, i + frame), sr, f0 / 2.2, f0 * 2.2)); }
    est.sort((p, q) => p - q);
    const hz = est[est.length >> 1];
    // The level at the start of the next note's written time from this note alone: what is left of its release.
    rows.push({ idx: n.idx, written: n.written, midi: n.concertMidi, startMs: n.startSec * 1000, onsetErrMs: onset === null ? null : (onset - wt) * 1000, cents: 1200 * Math.log2(hz / f0), peakDb: 20 * Math.log10(peak + 1e-12) });
  });
  let max = 0;
  for (let i = 0; i < x.length; i++) max = Math.max(max, Math.abs(x[i]));
  // Silence after the last note's release: nothing piles up or rings on.
  const last = c.notes[c.notes.length - 1];
  const tail = rmsAt(pre + last.startSec + last.durSec + 0.4);
  return { rows, peakDb: 20 * Math.log10(max), tailDb: 20 * Math.log10(tail + 1e-12), samples: c.dump ? Array.from(x) : null };
};
`;

async function routeSounds(page: Page): Promise<void> {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/sounds/')) {
      const file = normalize(join(SOUNDS, path.slice('/sounds/'.length)));
      if (!file.startsWith(SOUNDS)) return route.fulfill({ status: 403 });
      const body = await readFile(file).catch(() => null);
      if (!body) return route.fulfill({ status: 404 });
      return route.fulfill({ status: 200, contentType: path.endsWith('.json') ? 'application/json' : 'audio/mpeg', body });
    }
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>' });
  });
}

async function nodePlans(): Promise<typeof Plans> {
  const out = await build({ entryPoints: [join(ROOT, 'e2e/audio/listen-plans.ts')], bundle: true, write: false, format: 'esm', platform: 'node', target: 'node22', logLevel: 'silent' });
  const dir = join(ROOT, 'test-results', 'audio-e2e');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `listen-plans-${process.pid}.mjs`);
  writeFileSync(file, out.outputFiles[0]!.text);
  return (await import(pathToFileURL(file).href)) as typeof Plans;
}

test('Listen renders every written note at its pitch (15 cents) and its time (30 ms), at the Listen level', async ({ page }) => {
  test.setTimeout(240_000);
  const plans = await nodePlans();
  const cases = await plans.listenCases(CASES);
  const bundle = await build({ stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'listen-render-entry.ts', loader: 'ts' }, bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', logLevel: 'silent' });
  await routeSounds(page);
  await page.goto(`${ORIGIN}/`);
  await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
  const dump = process.env['LISTEN_RENDER_DUMP'];
  const lines: string[] = [];
  for (const c of cases) {
    const r = (await page.evaluate((arg) => (window as unknown as { renderListen(c: unknown): Promise<unknown> }).renderListen(arg), { ...c, dump: !!dump })) as {
      error?: string;
      rows: { idx: number; written: string; midi: number; startMs: number; onsetErrMs: number | null; cents: number; peakDb: number }[];
      peakDb: number;
      tailDb: number;
      samples: number[] | null;
    };
    expect(r.error, c.name).toBeUndefined();
    if (dump && r.samples) writeFileSync(join(dump, `${c.name.replace(/[^a-z0-9]+/gi, '_')}.f32`), Buffer.from(new Float32Array(r.samples).buffer));
    lines.push(`${c.name} (${c.excerptId}, set ${c.set}): peak ${r.peakDb.toFixed(1)} dBFS, tail ${r.tailDb.toFixed(1)} dB`);
    for (const row of r.rows) {
      lines.push(`  ${String(row.idx + 1).padStart(2)} ${row.written.padEnd(4)} MIDI ${row.midi} at ${row.startMs.toFixed(0).padStart(6)} ms: onset ${row.onsetErrMs === null ? 'none' : row.onsetErrMs.toFixed(1)} ms, pitch ${row.cents.toFixed(1)} cents`);
    }
    expect(r.rows).toHaveLength(c.notes.length);
    for (const row of r.rows) {
      const what = `${c.name}: note ${row.idx + 1} (${row.written}, MIDI ${row.midi})`;
      expect(Math.abs(row.cents), `${what} pitch ${row.cents.toFixed(1)} cents`).toBeLessThanOrEqual(PITCH_TOL_CENTS);
      expect(row.onsetErrMs, `${what} has no onset`).not.toBeNull();
      expect(Math.abs(row.onsetErrMs as number), `${what} onset ${(row.onsetErrMs as number).toFixed(1)} ms`).toBeLessThanOrEqual(ONSET_TOL_SEC * 1000);
    }
    // The Listen bus ceiling (about -12 dBFS) applied once: never the old -24 dBFS, never clipping.
    expect(r.peakDb, `${c.name} peak`).toBeGreaterThan(-16);
    expect(r.peakDb, `${c.name} peak`).toBeLessThan(-0.5);
    expect(r.tailDb, `${c.name} rings on after the last note`).toBeLessThan(-60);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
});
