// The practice loop in Chromium (PLAN definition of done item 3): first run, onboarding, setup, scan, count-in, a take
// fed by a synth-rendered WAV through Chromium's fake audio capture, a live red note, results with a grade, tips,
// and the next excerpt. Run with -c e2e/loop/playwright.loop.config.ts (the production build and the fake mic).
//
// The WAV is rendered after the scan reveals the excerpt: the page reports the take plan (window.__sr.session.plan),
// Node renders it with the P3 flute synth (one note 2 semitones sharp), and the app reopens the microphone when the
// take starts, so Chromium plays the new file from its start at the capture origin (see the config).
import { expect, test } from '@playwright/test';
import { loadLoopHelpers } from './bundle.ts';
import { LOOP_T0_SEC, onboard, pagePlan, setupAndStart, watchErrors } from './flow.ts';

test.skip(process.env['E2E_LOOP'] !== '1', 'run with -c e2e/loop/playwright.loop.config.ts');

test('practice loop: onboarding, setup, scan, count-in, live red note, graded results, tips, next excerpt', async ({ page }) => {
  const h = await loadLoopHelpers();
  const wav = process.env['E2E_LOOP_WAV']!;
  const errors = watchErrors(page);

  // First run lands on onboarding; complete it with the microphone allowed and calibration skipped.
  await onboard(page, 'allow');
  await setupAndStart(page);

  // Scan: reveal, then render this excerpt's take into the fake microphone's file.
  await page.getByRole('button', { name: 'Show the music' }).click();
  const scan = page.getByTestId('screen-practice.scan');
  await expect(scan).toHaveAttribute('data-state', 'scanning');
  await expect(scan.locator('.sr-note, [data-expected-idx], svg').first()).toBeVisible({ timeout: 30_000 });
  // The notation font is a woff2 asset next to the bundle (not base64 in the chunk); it must load from there.
  await expect.poll(() => page.evaluate(() => document.fonts.check('30pt Bravura')), { timeout: 15_000 }).toBe(true);
  const plan = await pagePlan(page);
  expect(plan.instrumentId).toBe('flute');
  h.writeTakeWav(wav, plan, LOOP_T0_SEC);
  const wrongIdx = h.wrongNoteIdx(plan.expected);
  const firstExcerpt = await page.evaluate(() => (window as unknown as { __sr: { session: { prepared: { excerptId: string } | null } } }).__sr.session.prepared?.excerptId);

  // Count-in, then the take: the wrong note turns red live.
  await page.getByRole('button', { name: 'Start playing' }).click();
  const play = page.getByTestId('screen-practice.play');
  await expect(play).toBeVisible({ timeout: 15_000 });
  await expect(play).toHaveAttribute('data-state', /count-in|performing/);
  await expect(play).toHaveAttribute('data-state', 'performing', { timeout: LOOP_T0_SEC * 1000 + 10_000 });
  const wrongNote = play.locator(`[data-expected-idx="${wrongIdx}"]`).first();
  await expect(wrongNote).toHaveClass(/n-error/, { timeout: (plan.endSec + 5) * 1000 });
  // PLAN ruling 61: at difficulties 1 to 3 (onboarding's default starts at 1) no ghost is drawn live; the
  // wrong-pitch judgment is checked in the record below.
  const served = await page.evaluate(() => (window as unknown as { __sr: { session: { prepared: { levelServed: number } | null } } }).__sr.session.prepared?.levelServed);
  expect(served).toBeLessThanOrEqual(3);
  // Ruling 71: the heard note of a wrong-pitch note is always drawn; nothing else is (extras and timing ghosts wait).
  await expect(play.locator('.sr-ghost:not([data-kind="wrong-pitch"])')).toHaveCount(0);

  // Results with a grade.
  const results = page.getByTestId('results-panel');
  await expect(results).toBeVisible({ timeout: (plan.endSec + 30) * 1000 });
  await expect(results).toHaveAttribute('data-state', 'graded');
  await expect(results.getByRole('region', { name: /^Grade [SABCDF], \d+ out of 100/ })).toBeVisible();
  const record = await page.evaluate(() => (window as unknown as { __sr: { session: { record: { score: { score: number; grade: string } | null; judgments: { expectedIdx: number; status: string; pitch: string | null }[] } | null } } }).__sr.session.record);
  expect(record?.score).not.toBeNull();
  test.info().annotations.push({ type: 'measured', description: `score ${record?.score?.score} ${record?.score?.grade}` });
  const wrong = record!.judgments.find((j) => j.expectedIdx === wrongIdx);
  expect(wrong).toMatchObject({ status: 'matched', pitch: 'wrong-pitch' });

  // Tips, then the next excerpt. One wrong note fires no pattern, and since PLAN ruling 51 a take with a red note gets
  // no clean-read tip either. The tips interstitial is gone (decision 13: `#/practice/tips` redirects), so Next always
  // goes straight on to the scan.
  const tipsShown = await page.evaluate(() => (window as unknown as { __sr: { session: { record: { score: { tipsShown: string[] } | null } | null } } }).__sr.session.record?.score?.tipsShown ?? []);
  expect(tipsShown).not.toContain('U18');
  await page.getByRole('button', { name: 'Next piece' }).click();
  await expect(page.getByTestId('screen-practice.tips')).toHaveCount(0);
  await expect(page.getByTestId('scan-cover')).toBeVisible({ timeout: 30_000 });
  const nextExcerpt = await page.evaluate(() => (window as unknown as { __sr: { session: { prepared: { excerptId: string } | null } } }).__sr.session.prepared?.excerptId);
  expect(nextExcerpt).toBeTruthy();
  expect(nextExcerpt).not.toBe(firstExcerpt);
  expect(errors).toEqual([]);
});
