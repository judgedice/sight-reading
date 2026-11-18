// P11 in real Chromium with fake media capture from a testkit WAV (01 §15 P11 row, 05 W1, W9):
// unlock from a click; blocks reach the worker contiguously over the transferred port (30 s here, 5 min with
// E2E_AUDIO_LONG=1); the forced and fallback relays deliver contiguously; every click plays on schedule under a
// 200 ms main-thread stall; the clock-rate check passes.
import { expect, test, type Page } from '@playwright/test';
import { FAKE_WAV_HZ } from './fake-capture-wav.ts';
import { openAudioPage } from './page.ts';

type Api = {
  make(o?: { forceRelay?: boolean }): void;
  waitUnlocked(): Promise<{ ok: boolean; error?: string; route?: { sampleRate: number; appliedProcessing: unknown } }>;
  capture(sec: number, mode: 'port' | 'port-no-return' | 'callback'): Promise<{
    stats: { blocks: number; seqGaps: number; maxStartErr: number; firstSeq: number; lastSeq: number; sumSq: number; samples: number; crossings: number; analysisRate: number; firstT: number; lastEnd: number; lens: Record<string, number> };
    relay: boolean;
    backend: { postedBlocks: number; droppedBlocks: number; maxQueueMs: number; relay: boolean };
    contextRate: number;
    wallSec: number;
    ctxSec: number;
  }>;
  clicksUnderStall(): Promise<{ scheduled: number[]; heard: number[]; t0: number; rate: number; stalledMs: number }>;
  clockRate(): Promise<{ ok: boolean; error: number; recreated: boolean }>;
};

/** Measured numbers go to stdout and the test's annotations. */
const report = (msg: string): void => {
  test.info().annotations.push({ type: 'measured', description: msg });
  process.stdout.write(`${msg}\n`);
};

test.skip(process.env['E2E_AUDIO'] !== '1', 'run with -c e2e/audio/playwright.audio.config.ts');

const CONTIGUITY_SEC = process.env['E2E_AUDIO_LONG'] === '1' ? 300 : 30;

async function unlocked(page: Page, o: { forceRelay?: boolean } = {}): Promise<void> {
  await openAudioPage(page);
  await page.evaluate((o) => (window as unknown as { audioTest: Api }).audioTest.make(o), o);
  await page.click('#unlock');
  const r = await page.evaluate(() => (window as unknown as { audioTest: Api }).audioTest.waitUnlocked());
  expect(r.ok, r.error).toBe(true);
}

const run = <T>(page: Page, fn: (api: Api, arg: number) => Promise<T>, arg = 0): Promise<T> =>
  page.evaluate(
    ([src, a]) => {
      const f = new Function('api', 'arg', `return (${src})(api, arg);`) as (api: Api, arg: number) => Promise<T>;
      return f((window as unknown as { audioTest: Api }).audioTest, a);
    },
    [fn.toString(), arg] as const,
  );

test(`port path: blocks reach the worker contiguously for ${CONTIGUITY_SEC} s`, async ({ page }) => {
  test.setTimeout((CONTIGUITY_SEC + 60) * 1000);
  await unlocked(page);
  const r = await run(page, (api, sec) => api.capture(sec, 'port'), CONTIGUITY_SEC);
  const s = r.stats;
  report(`[audio] port ${CONTIGUITY_SEC}s: blocks=${s.blocks} seqGaps=${s.seqGaps} maxStartErr=${s.maxStartErr} relay=${r.relay} ` +
    `dropped=${r.backend.droppedBlocks} maxQueueMs=${r.backend.maxQueueMs.toFixed(1)} ctxRate=${r.contextRate} ctxSec=${r.ctxSec.toFixed(3)} wallSec=${r.wallSec.toFixed(3)}`);
  expect(r.relay).toBe(false);
  expect(s.firstSeq).toBe(0);
  expect(s.seqGaps).toBe(0);
  expect(r.backend.droppedBlocks).toBe(0);
  // startT continues exactly from the previous block (01 §7.2, less than one sample of drift).
  expect(s.maxStartErr).toBeLessThan(1e-9);
  // Every block of the capture arrived: the count matches the audio-clock span.
  const expectedBlocks = ((s.lastEnd - s.firstT) * r.contextRate) / 256;
  expect(Math.abs(s.blocks - expectedBlocks)).toBeLessThan(1.01);
  expect(s.blocks * 256).toBeGreaterThan(0.97 * CONTIGUITY_SEC * r.contextRate);
  // The fake capture really carries the WAV: an A4 sine at -12 dBFS (rms 0.177) through the 3 kHz low-pass.
  const rms = Math.sqrt(s.sumSq / s.samples);
  expect(rms).toBeGreaterThan(0.08);
  const hz = s.crossings / 2 / (s.samples / s.analysisRate);
  expect(Math.abs(hz - FAKE_WAV_HZ)).toBeLessThan(FAKE_WAV_HZ * 0.03);
  expect(r.backend.maxQueueMs).toBeLessThan(120);
});

test('forced relay delivers contiguous blocks from the main thread', async ({ page }) => {
  await unlocked(page, { forceRelay: true });
  const r = await run(page, (api) => api.capture(5, 'port'));
  expect(r.relay).toBe(true);
  expect(r.stats.seqGaps).toBe(0);
  expect(r.stats.firstSeq).toBe(0);
  expect(r.stats.maxStartErr).toBeLessThan(1e-9);
  expect(r.stats.blocks * 256).toBeGreaterThan(0.95 * 5 * r.contextRate);
  expect(r.backend.droppedBlocks).toBe(0);
});

test('a worker that never returns buffers triggers the 500 ms relay fallback without a gap', async ({ page }) => {
  await unlocked(page);
  const r = await run(page, (api) => api.capture(3, 'port-no-return'));
  expect(r.relay).toBe(true);
  expect(r.stats.seqGaps).toBe(0);
  expect(r.stats.firstSeq).toBe(0);
  expect(r.backend.droppedBlocks).toBe(0);
  expect(r.stats.blocks * 256).toBeGreaterThan(0.95 * 3 * r.contextRate);
});

test('a callback sink is relayed contiguously', async ({ page }) => {
  await unlocked(page);
  const r = await run(page, (api) => api.capture(3, 'callback'));
  expect(r.relay).toBe(true);
  expect(r.stats.seqGaps).toBe(0);
  expect(r.stats.maxStartErr).toBeLessThan(1e-9);
});

test('every click plays at its scheduled time under a 200 ms main-thread stall (W9)', async ({ page }) => {
  await unlocked(page);
  const r = await run(page, (api) => api.clicksUnderStall());
  expect(r.stalledMs).toBeGreaterThanOrEqual(200);
  expect(r.scheduled).toHaveLength(12);
  expect(r.heard).toHaveLength(12);
  const errs = r.scheduled.map((t, i) => (r.heard[i] as number) - t);
  report(`[audio] click onset error ms: ${errs.map((e) => (e * 1000).toFixed(3)).join(' ')}`);
  for (const e of errs) expect(Math.abs(e)).toBeLessThan(0.001);
  r.scheduled.forEach((t, k) => expect(t).toBeCloseTo(r.t0 + (k - 4) * 0.25, 9));
});

test('clock-rate check passes on a healthy context (01 §7.8)', async ({ page }) => {
  await unlocked(page);
  const r = await run(page, (api) => api.clockRate());
  report(`[audio] clock-rate error ${(r.error * 100).toFixed(3)}%`);
  expect(r.ok).toBe(true);
  expect(r.recreated).toBe(false);
  expect(Math.abs(r.error)).toBeLessThan(0.02);
});
