// Practise without listening (R13, 04 §9.2) in Chromium: the microphone is declined in onboarding, so the take runs
// scan, metronome, count-in and bar highlight with no capture; the microphone is never opened, and the results say
// "Not graded · no XP". Run with -c e2e/loop/playwright.loop.config.ts.
import { expect, test } from '@playwright/test';
import { onboard, setupAndStart, watchErrors } from './flow.ts';

test.skip(process.env['E2E_LOOP'] !== '1', 'run with -c e2e/loop/playwright.loop.config.ts');

test('practise without listening: no microphone, a full take, results not graded', async ({ page }) => {
  // Count getUserMedia calls: none may happen on this path.
  await page.addInitScript(() => {
    const w = window as unknown as { __gum: number };
    w.__gum = 0;
    const md = navigator.mediaDevices;
    const orig = md.getUserMedia.bind(md);
    md.getUserMedia = (c?: MediaStreamConstraints) => {
      w.__gum++;
      return orig(c);
    };
  });
  const errors = watchErrors(page);
  await onboard(page, 'decline');
  await expect(page.getByTestId('screen-home').getByText('Microphone off', { exact: false })).toBeVisible();
  await setupAndStart(page);
  await expect(page.getByTestId('practise-notice')).toBeVisible();

  await page.getByRole('button', { name: 'Show the music' }).click();
  const scan = page.getByTestId('screen-practice.scan');
  await expect(scan).toHaveAttribute('data-state', 'scanning');
  await expect(scan).toHaveAttribute('data-mode', 'practice');
  const endSec = await page.evaluate(() => (window as unknown as { __sr: { session: { plan: { endSec: number } | null } } }).__sr.session.plan?.endSec ?? 60);
  await page.getByRole('button', { name: 'Start playing' }).click();

  const play = page.getByTestId('screen-practice.play');
  await expect(play).toBeVisible({ timeout: 15_000 });
  await expect(play.getByTestId('practise-notice')).toBeVisible();
  await expect(play).toHaveAttribute('data-state', 'performing', { timeout: 20_000 });

  const results = page.getByTestId('results-panel');
  await expect(results).toBeVisible({ timeout: (endSec + 30) * 1000 });
  await expect(results).toHaveAttribute('data-state', 'not-graded');
  await expect(page.getByTestId('not-graded')).toContainText('Not graded · no XP');
  const rec = await page.evaluate(() => (window as unknown as { __sr: { session: { record: { listening: boolean; score: unknown; endReason: string } | null } } }).__sr.session.record);
  expect(rec).toMatchObject({ listening: false, score: null, endReason: 'complete' });
  expect(await page.evaluate(() => (window as unknown as { __gum: number }).__gum)).toBe(0);
  expect(errors).toEqual([]);
});
