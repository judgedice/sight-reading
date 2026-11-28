// The web path's result for the same excerpt and performance as the native end-to-end try (tools/native/e2e-linux.mjs),
// for comparison with `tools/native/artifacts/e2e/main-try-record.json`.
//
// It runs the web loop of e2e/loop (Chromium, fake capture file, `?testClock=1`: RTL 0, wired headphones, practice) with
// the excerpt choice seeded the same way (`?seed=<n>` in the test clock, `SR_E2E_SEED` natively) and the performance the
// same (e2e/loop/node-helpers.ts `writeTakeWav`: one note two semitones sharp), then writes the record's judgments and
// score to the given file. Run: pnpm exec tsx tools/native/web-reference.ts <seed> <out.json>
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { loadLoopHelpers } from '../../e2e/loop/bundle.ts';
import { LOOP_T0_SEC, pagePlan, setupAndStart, walkWizard } from '../../e2e/loop/flow.ts';

const [seed = '5', out = 'web-reference.json'] = process.argv.slice(2);
const root = process.cwd();
const port = 4197;
const dist = 'test-results/dist-native-ref';
const run = (cmd: string, args: string[]): Promise<void> =>
  new Promise((res, rej) => spawn(cmd, args, { cwd: root, stdio: 'inherit' }).on('exit', (c) => (c === 0 ? res() : rej(new Error(`${cmd} ${args.join(' ')} exited ${c}`)))));

await run('pnpm', ['exec', 'vite', 'build', '--outDir', dist, '--emptyOutDir']);
const server = spawn('pnpm', ['exec', 'vite', 'preview', '--outDir', dist, '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
try {
  for (let i = 0; i < 60; i++) {
    if (await fetch(`http://localhost:${port}/`).then((r) => r.ok, () => false)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const h = await loadLoopHelpers();
  const wav = join(root, 'test-results', 'loop-e2e', 'native-ref-mic.wav');
  h.writeSilentWav(wav);
  const browser = await chromium.launch({
    executablePath: process.env['PW_CHROMIUM_PATH'] ?? '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`],
  });
  const ctx = await browser.newContext({ baseURL: `http://localhost:${port}/`, permissions: ['microphone'], viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(`./?testClock=1&testClockSec=${LOOP_T0_SEC}&seed=${seed}`);
  await walkWizard(page, { mic: 'allow' });
  await setupAndStart(page);
  await page.getByRole('button', { name: 'Show the music' }).click();
  await page.waitForSelector('[data-expected-idx]', { timeout: 30000 });
  await page.waitForFunction(() => document.fonts.check('30pt Bravura'));
  const plan = await pagePlan(page);
  const excerptId = await page.evaluate(() => (window as unknown as { __sr: { session: { prepared: { excerptId: string } } } }).__sr.session.prepared.excerptId);
  h.writeTakeWav(wav, plan, LOOP_T0_SEC);
  await page.getByRole('button', { name: 'Start playing' }).click();
  await page.getByTestId('results-panel').waitFor({ timeout: (plan.endSec + LOOP_T0_SEC + 60) * 1000 });
  await page.waitForFunction(() => (window as unknown as { __sr: { session: { record: unknown } } }).__sr.session.record !== null);
  const rec = await page.evaluate(() => {
    const r = (window as unknown as { __sr: { session: { record: { score: unknown; judgments: unknown[]; extras: unknown[]; bpm: number } } } }).__sr.session.record;
    return { score: r.score, judgments: r.judgments, extras: r.extras, bpm: r.bpm };
  });
  writeFileSync(out, JSON.stringify({ excerptId, plan: { bpm: plan.bpm, notes: plan.expected.length, endSec: plan.endSec }, ...rec }, null, 2));
  process.stdout.write(`web reference: ${excerptId} at ${plan.bpm} bpm\n`);
  await browser.close();
} finally {
  server.kill();
}
