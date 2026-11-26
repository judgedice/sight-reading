// Scales on the tour (PLAN ruling 68): a baritone opens Scales on Practice, picks the five-note scale in C, reads it
// through, sings it through Chromium's fake capture (the testkit's sung "ah"), and reaches the results, History and
// the try detail. Each step is captured into docs/screenshots/scales/<step>-<desktop|phone>-<light|dark>.png and
// checked like the rest of the tour: no overflow, no copy key on screen, none of the words round 2 replaced.
// Run with -c e2e/tour/playwright.tour.config.ts.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { loadLoopHelpers } from '../loop/bundle.ts';
import { oldWordsIn } from '../a11y/copy-match.ts';
import { chooseOutput, LOOP_T0_SEC, pagePlan, walkWizard, watchErrors } from '../loop/flow.ts';

test.skip(process.env['E2E_TOUR'] !== '1', 'run with -c e2e/tour/playwright.tour.config.ts');

const RAW_KEY = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9-]+){1,}$/;

async function pageLines(page: Page): Promise<string[]> {
  const text = await page.evaluate(() => document.body.innerText);
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}

test('scales: Practice entry, chooser, read-through, a sung scale, results, History and the try', async ({ page }, info) => {
  test.setTimeout(300_000);
  const h = await loadLoopHelpers();
  const wav = process.env['E2E_TOUR_WAV']!;
  const errors = watchErrors(page);
  const dir = join(process.cwd(), 'docs', 'screenshots', 'scales');
  mkdirSync(dir, { recursive: true });
  const suffix = info.project.name.replace(/^iphone/, 'phone');
  const issues: string[] = [];
  const shot = async (name: string, fullPage = false): Promise<void> => {
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(dir, `${name}-${suffix}.png`), fullPage, animations: 'disabled' });
    for (const line of await pageLines(page)) {
      for (const what of oldWordsIn(line)) issues.push(`${name}: ${what} on screen: ${line}`);
      if (RAW_KEY.test(line) && !/\.(?:json|com|org|net|js|png)$/.test(line)) issues.push(`${name}: raw copy key? ${line}`);
    }
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 1) issues.push(`${name}: page overflows by ${over}px`);
  };

  await page.goto(`./?testClock=1&testClockSec=${LOOP_T0_SEC}`);
  await walkWizard(page, { mic: 'allow', instrument: /^Baritone voice/ });
  const home = page.getByTestId('screen-home');
  await expect(home).toBeVisible({ timeout: 15_000 });
  await chooseOutput(page, 'Wired headphones');

  // Home: the entry in the Warm up group with "Match a note". The desktop does not scroll; the phone may (round 3: the
  // Mode row, the mode pill and the Warm up label sit above and below Start, as the round 3 phone mockup does).
  await expect(home.getByTestId('scales-entry')).toBeVisible();
  const scroll = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  if ((page.viewportSize()?.width ?? 1280) >= 1024) expect(scroll, 'Home scrolls').toBeLessThanOrEqual(1);
  await shot('practice', true);

  await home.getByTestId('scales-entry').click();
  const chooser = page.getByTestId('scales-chooser');
  await expect(chooser).toBeVisible();
  await shot('chooser');
  await chooser.getByRole('button', { name: /^Five-note scale in C major, C3 to G3/ }).click();

  const scan = page.getByTestId('screen-practice.scan');
  await expect(scan).toHaveAttribute('data-state', 'scanning', { timeout: 30_000 });
  await expect(scan.locator('[data-expected-idx]').first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => document.fonts.check('30pt Bravura')), { timeout: 15_000 }).toBe(true);
  await shot('read-through');
  const plan = await pagePlan(page);
  h.writeSungWav(wav, plan, LOOP_T0_SEC);

  await page.getByRole('button', { name: 'Start playing' }).click();
  await expect(page.getByTestId('screen-practice.play')).toHaveAttribute('data-state', 'performing', { timeout: LOOP_T0_SEC * 1000 + 15_000 });
  const results = page.getByTestId('results-panel');
  await expect(results).toBeVisible({ timeout: (plan.endSec + 30) * 1000 });
  await expect(results).toHaveAttribute('data-state', 'graded');
  await expect(page.getByTestId('res-scale-practice')).toBeVisible();
  await shot('results', true);

  await results.getByRole('button', { name: 'See all tries' }).click();
  await page.evaluate(() => (location.hash = '#/history'));
  const row = page.locator('[data-testid="history-row"][data-kind="scale"]');
  await expect(row).toHaveCount(1);
  await shot('history', true);
  await row.click();
  await expect(page.getByTestId('attempt-title')).toHaveText('Five-note scale in C major');
  await expect(page.locator('[data-expected-idx]').first()).toBeVisible({ timeout: 15_000 });
  await shot('try', true);

  expect(issues).toEqual([]);
  expect(errors).toEqual([]);
});
