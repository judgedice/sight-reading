// A scale try in Chromium (PLAN ruling 68): a baritone opens Scales on Practice, picks the five-note scale in C, goes
// straight to the read-through, sings it with a synthetic voice through the fake microphone (the testkit's sung "ah",
// rendered for the scale the page served), and lands on a graded result that is labelled as the scale, says it is
// practice, earns no XP and offers "Next scale" and "Same scale again". History then lists it as a scale.
// Run with -c e2e/loop/playwright.loop.config.ts (the production build and the fake microphone).
import { expect, test, type Page } from '@playwright/test';
import { loadLoopHelpers } from './bundle.ts';
import { chooseOutput, LOOP_T0_SEC, pagePlan, watchErrors } from './flow.ts';

test.skip(process.env['E2E_LOOP'] !== '1', 'run with -c e2e/loop/playwright.loop.config.ts');

/** Onboarding as a baritone, the microphone allowed, calibration and "Sing one note" skipped. */
async function onboardBaritone(page: Page): Promise<void> {
  await page.goto(`./?testClock=1&testClockSec=${LOOP_T0_SEC}`);
  await expect(page.getByTestId('screen-welcome')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByRole('radio', { name: /^Baritone voice/ }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Allow microphone' }).click();
  await expect(page.getByTestId('calibration-card')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('calibration-card').getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByTestId('ob-match')).toBeVisible();
  await page.locator('.ob-head').getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByTestId('ob-level')).toBeVisible();
  await page.getByRole('button', { name: "I'll choose" }).click();
  await page.getByRole('button', { name: 'Start practising' }).click();
  await expect(page.getByTestId('screen-home')).toBeVisible({ timeout: 15_000 });
}

interface PageRecord {
  kind?: string;
  scale?: { id: string };
  levelServed: number;
  score: { score: number; grade: string; ranked: boolean; xp: { total: number } } | null;
  judgments: { status: string }[];
}

const pageRecord = (page: Page): Promise<PageRecord | null> =>
  page.evaluate(() => (window as unknown as { __sr: { session: { record: PageRecord | null } } }).__sr.session.record);

test('scale try: Practice > Scales > five-note scale in C, sung through the fake microphone, graded and labelled, practice only', async ({ page }, info) => {
  test.setTimeout(240_000);
  const h = await loadLoopHelpers();
  const wav = process.env['E2E_LOOP_WAV']!;
  const errors = watchErrors(page);
  await onboardBaritone(page);
  await chooseOutput(page, 'Wired headphones');
  const home = page.getByTestId('screen-home');
  const profileBefore = await page.evaluate(() => (window as unknown as { __sr: { session: { currentProfile: { xp: number } | null } } }).__sr.session.currentProfile?.xp ?? 0);

  // The entry sits with "Match a note" on the instrument card, and opens the chooser.
  const entry = home.getByTestId('scales-entry');
  await expect(entry).toBeVisible();
  await entry.click();
  const chooser = page.getByRole('dialog', { name: 'Scales' });
  await expect(chooser).toBeVisible();
  await expect(chooser.getByTestId('scale-row')).toHaveCount(7);
  await expect(chooser.getByText('A scale gets a score and a grade. It is always practice')).toBeVisible();
  await chooser.getByRole('button', { name: /^Five-note scale in C major, C3 to G3/ }).click();

  // Straight to the read-through: no cover, the scale named, practice.
  const scan = page.getByTestId('screen-practice.scan');
  await expect(scan).toHaveAttribute('data-state', 'scanning', { timeout: 30_000 });
  await expect(page.getByTestId('scan-cover')).toHaveCount(0);
  await expect(scan.getByTestId('scan-scale-chip')).toHaveText('Scale: Five-note scale in C major');
  await expect(scan.getByTestId('mode-chip')).toHaveText('Practice');
  await expect(scan.locator('[data-expected-idx]').first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => document.fonts.check('30pt Bravura')), { timeout: 15_000 }).toBe(true);
  const plan = await pagePlan(page);
  expect(plan.instrumentId).toBe('voice-baritone');
  expect(plan.expected.map((e) => e.concertMidi)).toEqual([48, 50, 52, 53, 55, 53, 52, 50, 48]);
  h.writeSungWav(wav, plan, LOOP_T0_SEC);
  info.annotations.push({ type: 'take', description: `bpm ${plan.bpm}, ${plan.expected.length} notes, ends ${plan.endSec.toFixed(1)} s` });

  // The starting pitch, the count-in, the try.
  await page.getByRole('button', { name: 'Start playing' }).click();
  const play = page.getByTestId('screen-practice.play');
  await expect(play).toBeVisible({ timeout: 15_000 });
  await expect(play).toHaveAttribute('data-state', 'performing', { timeout: LOOP_T0_SEC * 1000 + 15_000 });

  // Results: graded, labelled as the scale, one line that it is practice, no XP and no rank line.
  const results = page.getByTestId('results-panel');
  await expect(results).toBeVisible({ timeout: (plan.endSec + 30) * 1000 });
  await expect(results).toHaveAttribute('data-state', 'graded');
  await expect(results.getByRole('region', { name: /^Grade [SABCDF], \d+ out of 100/ })).toBeVisible();
  await expect(page.getByTestId('res-summary')).toHaveText(/^Scale · C major · 4\/4 · ♩ = \d+ · 3 bars$/);
  await expect(page.getByTestId('res-scale-title')).toHaveText('Five-note scale in C major');
  await expect(page.getByTestId('res-scale-practice')).toHaveText('Scales are practice: no XP, and your difficulty stays the same.');
  await expect(page.getByTestId('res-rank')).toHaveCount(0);
  const record = await pageRecord(page);
  expect(record).toMatchObject({ kind: 'scale', scale: { id: 'five-note-c' }, levelServed: 1 });
  expect(record!.score).toMatchObject({ ranked: false, xp: { total: 0 } });
  expect(record!.judgments.filter((j) => j.status === 'matched').length).toBeGreaterThanOrEqual(8);
  test.info().annotations.push({ type: 'measured', description: `score ${record!.score!.score} ${record!.score!.grade}` });
  const profileAfter = await page.evaluate(() => (window as unknown as { __sr: { session: { currentProfile: { xp: number } | null } } }).__sr.session.currentProfile?.xp ?? 0);
  expect(profileAfter).toBe(profileBefore);

  // History lists it as a scale.
  await results.getByRole('button', { name: 'See all tries' }).click();
  await expect(page.getByTestId('screen-history')).toBeVisible();
  const row = page.locator('[data-testid="history-row"][data-kind="scale"]');
  await expect(row).toHaveCount(1);
  await expect(row.locator('.hist-title')).toHaveText('Five-note scale in C major');
  await page.getByRole('combobox', { name: 'Show' }).selectOption({ label: 'Pieces' });
  await expect(page.locator('[data-testid="history-row"]')).toHaveCount(0);
  await page.goBack();

  // Back on the results, Next scale opens the next scale in the list.
  await expect(results).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Next scale' }).first().click();
  await expect(scan).toHaveAttribute('data-state', 'scanning', { timeout: 30_000 });
  await expect(scan.getByTestId('scan-scale-chip')).toHaveText('Scale: Five-note scale in D major');
  expect(errors).toEqual([]);
});
