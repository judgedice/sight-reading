// The steady pitch needle on Match a note (round 3, docs/redesign/round3/03-pitch-steadiness.md) in Chromium against
// the production build, in the default `pnpm test:e2e` (chromium project only). Chromium's fake microphone sings a
// synthetic untrained held note (e2e/pitch-needle/voice.ts): a scoop from 200 c below, then about ±22 c of wobble at
// 3.3 Hz. Centred on the target it is a hit on Steady (the voice default) and on Balanced (chosen with "Make it
// steadier" under the meter); centred 45 c low it is never a hit. The run also measures how much the needle moves
// during the hold and writes it to test-results/pitch-needle/<name>.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { watchErrors } from './loop/flow.ts';
import { G3, phases, recordPhases, seedBaritone, writeVoiceWav } from './pitch-needle/voice.ts';

const WAV = join(process.cwd(), 'test-results', 'pitch-needle-e2e', 'voice.wav');
// The browser reads the file when a stream opens; it must exist before the browser starts.
writeVoiceWav(WAV, { midi: G3, centreCents: 0 });

const executablePath = process.env['PW_CHROMIUM_PATH'] ?? '/opt/pw-browsers/chromium';
test.use({
  permissions: ['microphone'],
  launchOptions: {
    executablePath,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${WAV}`],
  },
});
// One fake microphone file for the whole file: one test at a time.
test.describe.configure({ mode: 'serial' });

test.beforeEach(() => {
  test.skip(test.info().project.name !== 'chromium', 'chromium project only (the file sets its own fake microphone)');
});

/** Opens Match a note and waits until it listens (the target has played). */
async function openMatch(page: Page): Promise<void> {
  await page.evaluate(() => (location.hash = '#/match'));
  await expect(page.getByTestId('screen-match')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('match-target')).toHaveText('G3');
  await recordPhases(page);
}

interface Hold {
  hitAfterMs: number | null;
  /** The needle's movement while in tune before the hit: standard deviation and range, cents. */
  needleSdCents: number | null;
  needleRangeCents: number | null;
  phasesSeen: string[];
}

/** Waits up to `ms` for a hit and summarises the needle from the first heard frame. */
async function watch(page: Page, ms: number): Promise<Hold> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if ((await phases(page)).some((p) => p.phase === 'hit')) break;
    await page.waitForTimeout(100);
  }
  const ps = await phases(page);
  const firstHeard = ps.find((p) => p.at !== null);
  const hit = ps.find((p) => p.phase === 'hit');
  const held = ps.filter((p) => p.phase === 'in-band' && p.at !== null).map((p) => (p.at! - 0.5) * 100);
  const mean = held.reduce((a, b) => a + b, 0) / Math.max(1, held.length);
  return {
    hitAfterMs: hit && firstHeard ? Math.round(hit.t - firstHeard.t) : null,
    needleSdCents: held.length ? Math.sqrt(held.reduce((a, b) => a + (b - mean) ** 2, 0) / held.length) : null,
    needleRangeCents: held.length ? Math.max(...held) - Math.min(...held) : null,
    phasesSeen: [...new Set(ps.map((p) => p.phase))],
  };
}

function report(name: string, data: unknown): void {
  const dir = join(process.cwd(), 'test-results', 'pitch-needle');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(data, null, 2));
}

test('Steady (the voice default): the wobbling voice centred on G3 is a hit, with a calm needle', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  writeVoiceWav(WAV, { midi: G3, centreCents: 0 });
  await seedBaritone(page);
  await openMatch(page);
  const r = await watch(page, 15_000);
  report('steady-centred', r);
  expect(r.hitAfterMs, JSON.stringify(r)).not.toBeNull();
  await expect(page.getByTestId('match-line')).toHaveText('You hit it: G3.');
  // ±22 c of wobble; the drawn needle moves a few cents at most.
  expect(r.needleRangeCents!).toBeLessThan(12);
  // The settled note is drawn grey beside the target.
  await expect(page.getByTestId('match-heard')).toBeVisible();
  await expect(page.getByTestId('match-sang')).toHaveText(/^You sang: G3/);
  expect(errors).toEqual([]);
});

test('Balanced, chosen with "Make it steadier": a hit, and the setting is stored', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  writeVoiceWav(WAV, { midi: G3, centreCents: 0 });
  await seedBaritone(page);
  await page.evaluate(() => (location.hash = '#/match'));
  await expect(page.getByTestId('screen-match')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Needle moving too much? Make it steadier' }).click();
  const choices = page.getByTestId('match-steadier').getByRole('radiogroup', { name: 'Pitch needle' });
  await expect(choices.getByRole('radio', { name: 'Steady' })).toBeChecked();
  await choices.getByRole('radio', { name: 'Balanced' }).check({ force: true });
  await expect(choices.getByRole('radio', { name: 'Balanced' })).toBeChecked();
  await recordPhases(page);
  const r = await watch(page, 15_000);
  report('balanced-centred', r);
  expect(r.hitAfterMs, JSON.stringify(r)).not.toBeNull();
  await expect(page.getByTestId('match-line')).toHaveText('You hit it: G3.');
  // Settings › Display shows the stored choice.
  await page.evaluate(() => (location.hash = '#/settings/display'));
  await expect(page.getByRole('radiogroup', { name: 'Pitch needle' }).getByRole('radio', { name: 'Balanced' })).toBeChecked({ timeout: 15_000 });
  expect(errors).toEqual([]);
});

test('centred 45 c low: never a hit, and the screen says low', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  writeVoiceWav(WAV, { midi: G3, centreCents: -45 });
  await seedBaritone(page, { steadiness: 'balanced' });
  await openMatch(page);
  await expect.poll(async () => (await phases(page)).some((p) => p.at !== null), { timeout: 15_000 }).toBe(true);
  // 8 s of singing: about six times what a hit needs.
  const r = await watch(page, 8_000);
  report('balanced-45-low', r);
  expect(r.hitAfterMs, JSON.stringify(r)).toBeNull();
  expect(r.phasesSeen).not.toContain('hit');
  expect(r.phasesSeen).not.toContain('in-band');
  await expect(page.getByTestId('match-line')).toHaveText('A little low. Go up.');
  await expect(page.getByTestId('match-you')).toHaveText(/^You: G3, a little low/);
  expect(errors).toEqual([]);
});
