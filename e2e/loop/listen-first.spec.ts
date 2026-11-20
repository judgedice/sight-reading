// Listen first in a ranked read-through (05 sections 4.3, 9.4 and 16 item 9; PLAN ruling 59): the confirm, the take
// becoming practice at once, a take through Chromium's fake capture, and results that say why it is practice.
// Run with -c e2e/loop/playwright.loop.config.ts (the production build and the fake mic).
import { expect, test, type Page } from '@playwright/test';
import { loadLoopHelpers } from './bundle.ts';
import { LOOP_T0_SEC, onboard, pagePlan, watchErrors } from './flow.ts';

test.skip(process.env['E2E_LOOP'] !== '1', 'run with -c e2e/loop/playwright.loop.config.ts');

type Sr = {
  __sr: {
    session: {
      prepared: { excerptId: string } | null;
      current: { settings: Record<string, unknown> } | null;
      prepare(s: Record<string, unknown>): Promise<unknown>;
      record: { score: { ranked: boolean; rankedReasons: string[] } | null } | null;
    };
  };
};

/**
 * The excerpt on the cover as a ranked take on wired headphones. Ranked needs a calibrated route on Practice, and the
 * fake microphone hears no clicks, so the spec asks the session for the ranked excerpt directly (the same call
 * Practice's Start makes) instead of going through calibration.
 */
async function rankedCover(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('scan-cover')).toBeVisible({ timeout: 30_000 });
  // The cover shows while the excerpt still loads; wait for the session's current excerpt before asking again.
  await expect.poll(() => page.evaluate(() => (window as unknown as Sr).__sr.session.current !== null), { timeout: 30_000 }).toBe(true);
  await page.evaluate(async () => {
    const s = (window as unknown as Sr).__sr.session;
    await s.prepare({ ...s.current!.settings, mode: 'ranked', outputMode: 'wired', listening: true });
  });
  const scan = page.getByTestId('screen-practice.scan');
  await expect(scan).toHaveAttribute('data-state', 'covered');
  await expect(scan).toHaveAttribute('data-mode', 'ranked');
}

test('ranked read-through: Listen first asks, makes the take practice, and results say why', async ({ page }) => {
  const h = await loadLoopHelpers();
  const wav = process.env['E2E_LOOP_WAV']!;
  const errors = watchErrors(page);

  await onboard(page, 'allow');
  await rankedCover(page);

  await page.getByRole('button', { name: 'Show the music' }).click();
  const scan = page.getByTestId('screen-practice.scan');
  await expect(scan).toHaveAttribute('data-state', 'scanning');
  const chip = page.getByTestId('mode-chip');
  await expect(chip).toContainText('Ranked');
  await expect(chip).toContainText('to read');

  // The confirm: Keep it ranked changes nothing.
  const listen = page.getByRole('button', { name: /^Listen first/ });
  await listen.click();
  const confirm = page.getByRole('dialog', { name: 'Listen first?' });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('left');
  await expect(confirm.getByRole('button', { name: 'Keep it ranked' })).toBeFocused();
  await confirm.getByRole('button', { name: 'Keep it ranked' }).click();
  await expect(confirm).toBeHidden();
  await expect(scan).toHaveAttribute('data-mode', 'ranked');

  // Listen, make it practice: the chip says Practice at once and the music plays.
  await listen.click();
  await page.getByRole('dialog', { name: 'Listen first?' }).getByRole('button', { name: 'Listen, make it practice' }).click();
  await expect(scan).toHaveAttribute('data-mode', 'practice');
  await expect(chip).toHaveText('Practice');
  await expect(page.getByTestId('scan-announce')).toHaveText('Now a practice try');
  await expect(page.getByRole('button', { name: /^Stop/ })).toBeVisible();

  // The take: render this excerpt into the fake microphone's file, then Start playing (it stops the music first).
  await expect.poll(() => page.evaluate(() => document.fonts.check('30pt Bravura')), { timeout: 15_000 }).toBe(true);
  const plan = await pagePlan(page);
  h.writeTakeWav(wav, plan, LOOP_T0_SEC);
  await page.getByRole('button', { name: 'Start playing' }).click();
  const play = page.getByTestId('screen-practice.play');
  await expect(play).toBeVisible({ timeout: 15_000 });
  await expect(play).toHaveAttribute('data-state', 'performing', { timeout: LOOP_T0_SEC * 1000 + 10_000 });

  const results = page.getByTestId('results-panel');
  await expect(results).toBeVisible({ timeout: (plan.endSec + 30) * 1000 });
  await expect(results).toContainText('You listened first, so this one is practice.');
  const record = await page.evaluate(() => (window as unknown as Sr).__sr.session.record);
  expect(record?.score?.ranked).toBe(false);
  expect(record?.score?.rankedReasons[0]).toBe('listened-first');
  expect(record?.score?.rankedReasons).not.toContain('practice-mode');
  expect(errors).toEqual([]);
});
