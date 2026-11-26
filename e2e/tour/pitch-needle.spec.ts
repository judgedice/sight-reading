// The steady pitch needle (round 3, docs/redesign/round3/03-pitch-steadiness.md): screenshots of Match a note sung
// through the fake microphone by the synthetic untrained voice (e2e/pitch-needle/voice.ts), into
// docs/screenshots/pitch-needle/<step>-<desktop|phone>-<light|dark>.png:
//   match-holding   the voice centred on G3, in tune before the hit: the calm needle and the faint wobble bar;
//   match-hit       after the hit: the settled note grey beside the target, "You sang: G3";
//   match-low       the voice centred 30 c low: "A little low", the needle and the bar left of the band;
//   match-steadier  "Make it steadier" opened under the meter;
//   settings        Settings › Display › Pitch needle.
//   pnpm exec playwright test -c e2e/tour/playwright.tour.config.ts pitch-needle
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { watchErrors } from '../loop/flow.ts';
import { G3, seedBaritone, writeVoiceWav } from '../pitch-needle/voice.ts';

test.skip(!process.env['E2E_TOUR'], 'needs e2e/tour/playwright.tour.config.ts');

async function openMatch(page: Page): Promise<void> {
  await page.evaluate(() => (location.hash = '#/match'));
  await expect(page.getByTestId('screen-match')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('match-target')).toHaveText('G3');
}

async function leave(page: Page): Promise<void> {
  await page.evaluate(() => (location.hash = '#/'));
  await expect(page.getByTestId('screen-home')).toBeVisible({ timeout: 15_000 });
  // The microphone is let go a turn after the screen goes; the next stream reads the new file.
  await page.waitForTimeout(500);
}

test('pitch needle: holding, hit, low, the steadier link and the setting', async ({ page }, info) => {
  test.setTimeout(240_000);
  const wav = process.env['E2E_TOUR_WAV']!;
  const errors = watchErrors(page);
  const dir = join(process.cwd(), 'docs', 'screenshots', 'pitch-needle');
  mkdirSync(dir, { recursive: true });
  const suffix = info.project.name.replace(/^iphone/, 'phone');
  const shot = async (name: string): Promise<void> => {
    await page.screenshot({ path: join(dir, `${name}-${suffix}.png`), animations: 'disabled' });
  };
  const body = page.locator('.mt-body');

  writeVoiceWav(wav, { midi: G3, centreCents: 6, holdSec: 12, notes: 2 });
  await seedBaritone(page);
  await openMatch(page);
  await expect(body).toHaveAttribute('data-phase', 'in-band', { timeout: 20_000 });
  await expect(page.getByTestId('match-spread')).toBeVisible();
  await shot('match-holding');
  await expect(body).toHaveAttribute('data-phase', 'hit', { timeout: 10_000 });
  await expect(page.getByTestId('match-heard')).toBeVisible();
  await shot('match-hit');
  await leave(page);

  writeVoiceWav(wav, { midi: G3, centreCents: -30, holdSec: 12, notes: 2 });
  await openMatch(page);
  await expect(page.getByTestId('match-line')).toHaveText('A little low. Go up.', { timeout: 20_000 });
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('match-spread')).toBeVisible();
  await shot('match-low');
  await page.getByRole('button', { name: 'Needle moving too much? Make it steadier' }).click();
  await expect(page.getByTestId('match-steadier')).toBeVisible();
  await page.getByTestId('match-steadier').scrollIntoViewIfNeeded();
  await shot('match-steadier');
  await leave(page);

  await page.evaluate(() => (location.hash = '#/settings/display'));
  const group = page.getByRole('radiogroup', { name: 'Pitch needle' });
  await expect(group).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => document.querySelector('[data-testid="pitch-steadiness-choice"]')?.closest('.set-row')?.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  await shot('settings');
  expect(errors).toEqual([]);
});
