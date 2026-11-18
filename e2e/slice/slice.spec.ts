// S1 thin slice (01 §15 S1) in Chromium: the fake mic plays the synth-rendered excerpt with its perturbations through
// the real WebAudioBackend, capture worklet and DSP worker; the page renders the score with the overlay, shows live
// marks and prints the grade. Asserts the DOM note states, the late ghost's x against beatToPoint at its played onset
// (±1 px), sample onset to paint (≤ 150 ms), the record round trip through IndexedDB, and that Node computes the same
// final alignment and grade from the browser's detected notes and live events.
import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { DetectedNote, FinalAlignment, FollowerEvent, AttemptScore } from '../../src/core/types.ts';
import { loadNodeHelpers } from './bundle.ts';

interface ProbeState {
  phase: string;
  error: string | null;
  timing: { captureOrigin: number; t0: number; rtlSec: number; analysisRate: number; contextSampleRate: number; captureRelay: boolean } | null;
  eventCount: number;
  events: FollowerEvent[];
  paintedAt: Record<string, number>;
  ghosts: { detectedId: number; kind: string; targetExpectedIdx: number | null; scoreBeat: number; domX: number | null; beatX: number }[];
  noteClasses: Record<string, string>;
  result: null | {
    score: AttemptScore;
    alignment: FinalAlignment;
    detected: DetectedNote[];
    signal: { medianClarity: number | null; clippingFrac: number };
    stats: { hopP95Ms: number | null; missingBlocks: number };
    recordId: string;
    recordRoundTrip: boolean;
  };
}

type Probe = { state(): ProbeState; beatX(beat: number): number };

const report = (msg: string): void => {
  test.info().annotations.push({ type: 'measured', description: msg });
  process.stdout.write(`${msg}\n`);
};

const pct = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] ?? NaN;
};

// Only meaningful with e2e/slice/playwright.slice.config.ts (the `--mode slice` build and the S1 WAV as fake mic).
test.skip(process.env['E2E_SLICE'] !== '1', 'run with -c e2e/slice/playwright.slice.config.ts');

test('S1: fake mic -> worklet -> DSP worker -> live marks -> final alignment -> grade -> IndexedDB', async ({ page }) => {
  const h = await loadNodeHelpers();
  const { SLICE_LATE_IDX, SLICE_OMIT_IDX, SLICE_WRONG_IDX } = h;
  const facts = h.takeFacts();
  const beatSec = 60 / facts.bpm;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // Resource errors are checked by URL below (the preview server has no favicon).
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text());
  });
  page.on('response', (res) => {
    if (res.status() >= 400 && !/favicon\.ico$/.test(res.url())) errors.push(`${res.status()} ${res.url()}`);
  });

  await page.goto('./#/dev/slice?testClock=1');
  const screen = page.getByTestId('screen-dev-slice');
  await expect(screen).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await expect(screen).toHaveAttribute('data-test-clock', 'true');
  await page.getByTestId('slice-start').click();
  await expect(screen).toHaveAttribute('data-phase', /count-in|listening/, { timeout: 15_000 });
  await expect(page.getByTestId('slice-results')).toBeVisible({ timeout: 90_000 });

  const s = await page.evaluate(() => (window as unknown as { __slice: Probe }).__slice.state());
  writeFileSync(test.info().outputPath('slice-state.json'), JSON.stringify(s, null, 1));
  expect(s.error, errors.join('\n')).toBeNull();
  expect(s.result).not.toBeNull();
  const r = s.result!;
  const tm = s.timing!;
  const describe = r.alignment.judgments.map((j) => `#${j.expectedIdx} ${j.status} ${j.timing} ${j.pitch} ${j.timingErrorMs?.toFixed(0)}ms`).join('; ');
  report(`[slice] ctxRate ${tm.contextSampleRate} analysisRate ${tm.analysisRate} relay ${tm.captureRelay} t0-origin ${(tm.t0 - tm.captureOrigin).toFixed(3)} s; ` +
    `score ${r.score.score} ${r.score.grade} P/I/R ${JSON.stringify(r.score.components)}; extras ${r.alignment.extras.length}; ` +
    `hopP95 ${r.stats.hopP95Ms?.toFixed(3)} ms; missing ${r.stats.missingBlocks}; ${describe}`);
  const timingErrs = r.alignment.judgments.filter((j) => j.status === 'matched' && j.expectedIdx !== SLICE_LATE_IDX && j.timingErrorMs !== null).map((j) => j.timingErrorMs as number);
  report(`[slice] on-time notes timing error ms: median ${pct(timingErrs, 0.5).toFixed(1)} min ${Math.min(...timingErrs).toFixed(1)} max ${Math.max(...timingErrs).toFixed(1)}`);

  // DOM states: late, wrong and missed notes are red; every other note keeps its ink.
  const cls = (i: number): string => s.noteClasses[String(i)] ?? '';
  expect(cls(SLICE_WRONG_IDX), describe).toContain('n-error');
  expect(cls(SLICE_LATE_IDX), describe).toContain('n-error');
  expect(cls(SLICE_OMIT_IDX), describe).toContain('n-error-hollow');
  const others = Array.from({ length: facts.noteCount }, (_, i) => i).filter((i) => ![SLICE_WRONG_IDX, SLICE_LATE_IDX, SLICE_OMIT_IDX].includes(i));
  expect(others.filter((i) => cls(i).includes('n-error')).map((i) => `${i}:${cls(i)}`), describe).toEqual([]);
  // The wrong note's ghost and the extra in bar 5's rest are drawn. (Chromium's fake device can drop a few ms of
  // audio under load, which may split a long note into a second, spurious extra; so the rest's extra is found by
  // position rather than by counting extras.)
  await expect(page.locator(`[data-testid="slice-score"] .sr-ghost[data-kind="wrong-pitch"]`)).toHaveCount(1);
  const restExtra = s.ghosts.find((g) => g.kind === 'extra' && Math.abs(g.scoreBeat - h.SLICE_EXTRA.atBeat) < 0.25);
  expect(restExtra, JSON.stringify(s.ghosts)).toBeDefined();
  await expect(page.locator(`[data-testid="slice-score"] .sr-ghost[data-kind="extra"][data-detected-id="${restExtra!.detectedId}"]`)).toHaveCount(1);

  // Final verdicts.
  const fin = new Map(r.alignment.judgments.map((j) => [j.expectedIdx, j]));
  expect(fin.get(SLICE_WRONG_IDX), describe).toMatchObject({ status: 'matched', pitch: 'wrong-pitch' });
  expect(fin.get(SLICE_LATE_IDX), describe).toMatchObject({ status: 'matched', timing: 'late' });
  expect(fin.get(SLICE_OMIT_IDX), describe).toMatchObject({ status: 'missed' });
  const extra = r.alignment.extras.find((x) => x.detectedId === restExtra!.detectedId);
  expect(extra, JSON.stringify(r.alignment.extras)).toMatchObject({ duringRest: true });
  expect(Math.round(extra!.concertMidi)).toBe(h.SLICE_EXTRA.midi);
  if (r.alignment.extras.length !== 1) report(`[slice] note: ${r.alignment.extras.length - 1} spurious extra(s) (capture glitch): ${JSON.stringify(r.alignment.extras)}`);

  // A grade appears.
  await expect(page.getByTestId('slice-grade')).toHaveText(/^[SABCDF]$/);
  expect(r.score.grade).not.toBe('S');

  // The late note's ghost sits at beatToPoint of its played onset, within 1 px.
  const lateGhost = s.ghosts.find((g) => g.kind === 'late' && g.targetExpectedIdx === SLICE_LATE_IDX);
  expect(lateGhost, JSON.stringify(s.ghosts)).toBeDefined();
  const lateDet = r.detected.find((d) => d.id === fin.get(SLICE_LATE_IDX)!.detectedId)!;
  const playedBeat = ((lateDet.onset as number) - tm.t0 - tm.rtlSec) / beatSec;
  const playedX = await page.evaluate((b) => (window as unknown as { __slice: Probe }).__slice.beatX(b), playedBeat);
  report(`[slice] late ghost: scoreBeat ${lateGhost!.scoreBeat.toFixed(4)} played beat ${playedBeat.toFixed(4)} domX ${lateGhost!.domX} beatToPoint ${playedX.toFixed(2)}`);
  expect(lateGhost!.domX).not.toBeNull();
  expect(Math.abs((lateGhost!.domX as number) - playedX)).toBeLessThanOrEqual(1);

  // Sample onset to paint (01 §12): audio-clock time of the first frame that showed the note, minus its onset.
  const lat = r.detected.filter((d) => s.paintedAt[String(d.id)] !== undefined).map((d) => 1000 * (s.paintedAt[String(d.id)]! - (d.onset as number)));
  report(`[slice] onset to paint ms over ${lat.length} notes: p50 ${pct(lat, 0.5).toFixed(1)} p95 ${pct(lat, 0.95).toFixed(1)} max ${Math.max(...lat).toFixed(1)}`);
  expect(lat.length).toBeGreaterThanOrEqual(r.detected.length - 1);
  expect(Math.max(...lat)).toBeLessThanOrEqual(150);

  // AttemptRecord to IndexedDB and back.
  expect(r.recordRoundTrip).toBe(true);
  await expect(page.getByTestId('slice-results')).toHaveAttribute('data-record', 'ok');

  // The same alignment and grade in Node from the browser's detected notes and live events.
  const node = h.nodeRegrade({ t0: tm.t0, rtlSec: tm.rtlSec, analysisRate: tm.analysisRate, detected: r.detected, events: s.events, signal: r.signal });
  expect(node.alignment).toEqual(r.alignment);
  expect(node.score).toEqual(r.score);
  expect(errors).toEqual([]);
});
