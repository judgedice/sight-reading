// The sampler in real Chromium (round 2, R2-02; 02-sounds.md "Checks"): every set in public/sounds/index.json renders
// its bottom, middle and top note through the app's sampler code (fetch, decodeAudioData, onset shift, nearest
// sample, rate, loop, envelope) in an OfflineAudioContext, and YIN over the render finds the note within 10 cents.
// pnpm exec playwright test -c e2e/audio/playwright.audio.config.ts sampler
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { build } from 'esbuild';
import { expect, test, type Page } from '@playwright/test';

test.skip(process.env['E2E_AUDIO'] !== '1', 'run with -c e2e/audio/playwright.audio.config.ts');

const ROOT = process.cwd();
const ORIGIN = 'http://localhost:4598';
const SOUNDS = join(ROOT, 'public', 'sounds');

/** Page-side harness: the app's sampler and a YIN pitch estimate (the demo page's self-test, ported). */
const ENTRY = `
import { Sampler, startSampleNote } from './src/platform/web/audio/sampler.ts';
import { WebAudioBackend } from './src/platform/web/audio/web-audio-backend.ts';

const caps = { platform: 'web', outputLatencyReported: true, wakeLock: true, serviceWorker: true, persistentStorage: 'best-effort', osFamily: 'linux', displayMode: 'browser' };

/** The backend path: prepare before unlock (decode-only context), then play sampled notes and stop them. */
window.backendTest = async () => {
  const url = URL.createObjectURL(new Blob([window.__workletCode], { type: 'text/javascript' }));
  const be = new WebAudioBackend({ capabilities: caps, workletUrl: url });
  const early = await be.prepareSound('voice-baritone');
  const missing = await be.prepareSound('kazoo');
  const btn = document.getElementById('unlock');
  const unlocked = new Promise((res, rej) => btn.addEventListener('click', () => be.unlock().then(res, rej), { once: true }));
  window.__ready = true;
  await unlocked;
  const states = { early, missing, baritone: be.soundState('voice-baritone') };
  await be.playNotes([{ hz: 196, startSec: 0, durSec: 0.5 }, { hz: 220, startSec: 0.5, durSec: 0.5 }], { peak: 0.5, sound: 'voice-baritone', attackSec: 0.08 });
  // Not loaded yet: the additive voice plays now and the set loads for the next call.
  await be.playNotes([{ hz: 440, startSec: 0, durSec: 0.3 }], { peak: 0.5, sound: 'flute' });
  const fluteAfterCall = be.soundState('flute');
  const flute = await be.prepareSound('flute');
  await be.playNotes([{ hz: 440, startSec: 0, durSec: 0.3 }], { peak: 0.5, sound: 'flute' });
  be.stopSounds();
  await be.close();
  return { ...states, fluteAfterCall, flute };
};

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

window.samplerTest = async () => {
  const sr = 44100;
  const manifest = await (await fetch('sounds/index.json')).json();
  const out = [];
  for (const [id, def] of Object.entries(manifest.sets)) {
    const [lo, hi] = def.range;
    const sustained = def.kind === 'sustain';
    const dur = sustained ? 3.0 : 1.2;
    for (const target of [lo, Math.round((lo + hi) / 2), hi]) {
      const ctx = new OfflineAudioContext(1, Math.ceil((dur + 0.6) * sr), sr);
      const sampler = new Sampler({ base: 'sounds/', fetch: (u) => fetch(u), decoder: () => ctx });
      const state = await sampler.prepare(id);
      const set = sampler.ready(id);
      if (state !== 'ready' || !set) { out.push({ id, target, error: 'not ready: ' + sampler.state(id) }); continue; }
      startSampleNote(ctx, ctx.destination, set, target, 0, dur, { gain: 0.8 });
      const x = (await ctx.startRendering()).getChannelData(0);
      const expectHz = 440 * 2 ** ((target - 69) / 12);
      // Median of YIN from 0.3 s to the note's end (across the loop for sustained sets).
      const frame = Math.floor(Math.max(0.06, 6 / expectHz) * sr);
      const est = [];
      for (let t = 0.3; t + frame / sr < dur - 0.05; t += 0.1) {
        const i = Math.floor(t * sr);
        est.push(yin(x.subarray(i, i + frame), sr, expectHz / 2.3, expectHz * 2.3));
      }
      est.sort((p, q) => p - q);
      const hz = est[Math.floor(est.length / 2)];
      let peak = 0;
      for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
      // Level just before the loop wraps and well after it, so a loop that falls silent shows.
      const rms = (a, b) => { let s = 0; const i0 = Math.floor(a * sr), i1 = Math.floor(b * sr); for (let i = i0; i < i1; i++) s += x[i] * x[i]; return Math.sqrt(s / (i1 - i0)); };
      out.push({
        id, target, sustained, hz, cents: 1200 * Math.log2(hz / expectHz), peak,
        early: rms(0.5, 0.8), late: sustained ? rms(2.4, 2.9) : null,
        shiftMs: Math.max(...set.samples.map((s) => s.shift)) * 1000,
      });
    }
  }
  return out;
};
`;

/** Serves the page and public/sounds from a routed localhost origin (a secure context). */
async function routeSounds(page: Page, fetched: string[]): Promise<void> {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/sounds/')) {
      const file = normalize(join(SOUNDS, path.slice('/sounds/'.length)));
      if (!file.startsWith(SOUNDS)) return route.fulfill({ status: 403 });
      fetched.push(path);
      const body = await readFile(file).catch(() => null);
      if (!body) return route.fulfill({ status: 404 });
      return route.fulfill({ status: 200, contentType: path.endsWith('.json') ? 'application/json' : 'audio/mpeg', body });
    }
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"></head><body><button id="unlock">Start</button></body></html>' });
  });
}

async function bundleEntry(): Promise<string> {
  const bundle = await build({
    stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'sampler-entry.ts', loader: 'ts' },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    logLevel: 'silent',
  });
  return bundle.outputFiles[0]!.text;
}

test('every sample set renders its bottom, middle and top note within 10 cents', async ({ page }) => {
  test.setTimeout(180_000);
  const code = await bundleEntry();
  const fetched: string[] = [];
  await routeSounds(page, fetched);
  await page.goto(`${ORIGIN}/`);
  await page.addScriptTag({ content: code });
  const results = await page.evaluate(() => (window as unknown as { samplerTest(): Promise<Record<string, unknown>[]> }).samplerTest());

  const manifest = JSON.parse(await readFile(join(SOUNDS, 'index.json'), 'utf8')) as { sets: Record<string, unknown> };
  expect(results).toHaveLength(Object.keys(manifest.sets).length * 3);
  const lines: string[] = [];
  let worst = 0;
  for (const r of results) {
    expect(r['error'], `${String(r['id'])} ${String(r['target'])}`).toBeUndefined();
    const c = r['cents'] as number;
    worst = Math.max(worst, Math.abs(c));
    lines.push(`${String(r['id']).padEnd(15)} ${String(r['target']).padStart(3)} ${(r['hz'] as number).toFixed(1).padStart(8)} Hz ${c.toFixed(1).padStart(6)} cents shift ${(r['shiftMs'] as number).toFixed(1)} ms`);
    expect(Math.abs(c), `${String(r['id'])} MIDI ${String(r['target'])}: ${c.toFixed(1)} cents`).toBeLessThanOrEqual(10);
    expect(r['peak'] as number, `${String(r['id'])} ${String(r['target'])} is silent`).toBeGreaterThan(0.05);
    expect(r['peak'] as number).toBeLessThan(1);
    if (r['sustained']) expect(r['late'] as number, `${String(r['id'])} ${String(r['target'])} loop holds`).toBeGreaterThan((r['early'] as number) * 0.3);
  }
  // index.json once per set's sampler (each render builds its own), the samples only from their own folders.
  expect(fetched.every((p) => /^\/sounds\/(index\.json|[a-z0-9-]+\/[A-G]s?-?\d\.mp3)$/.test(p))).toBe(true);
  test.info().annotations.push({ type: 'measured', description: `worst ${worst.toFixed(1)} cents` });
  process.stdout.write(`${lines.join('\n')}\nworst ${worst.toFixed(1)} cents\n`);
});

test('the backend prepares a set before unlock, plays it after, and falls back while a set loads', async ({ page }) => {
  const code = await bundleEntry();
  const worklet = await build({ entryPoints: [join(ROOT, 'src/platform/web/audio/capture.worklet.ts')], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', logLevel: 'silent' });
  const fetched: string[] = [];
  await routeSounds(page, fetched);
  await page.goto(`${ORIGIN}/`);
  await page.evaluate((w) => {
    (window as unknown as { __workletCode: string }).__workletCode = w;
  }, worklet.outputFiles[0]!.text);
  await page.addScriptTag({ content: code });
  const result = page.evaluate(() => (window as unknown as { backendTest(): Promise<Record<string, string>> }).backendTest());
  await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true);
  await page.click('#unlock');
  expect(await result).toEqual({ early: 'ready', missing: 'fallback', baritone: 'ready', fluteAfterCall: 'loading', flute: 'ready' });
  expect(fetched.filter((p) => p === '/sounds/index.json')).toHaveLength(1);
  expect(fetched.filter((p) => p.startsWith('/sounds/voice-baritone/'))).toHaveLength(7);
});
