// Note colours on the tour (PLAN R69): a baritone turns on Settings > Display > Note colours (and "Show played notes
// live: Always", so the heard note shows during the try), opens the five-note scale in C, reads it through, sings it
// through Chromium's fake capture with the third note a tone sharp (E3 sung as F♯3), and reaches the results. Captured
// into docs/screenshots/note-colours/<step>-<desktop|phone>-<light|dark>.png: the Settings row with its colour key, the
// read-through, the try with the wrong note marked, and the results' marked score.
// Checked on the way: heads take their letter colours, the wrong written note is greyed (not red, not its letter
// colour), the heard note is grey, and the results' marked score has a green dot under every right note (PLAN R69).
// Run with -c e2e/tour/playwright.tour.config.ts.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { loadLoopHelpers } from '../loop/bundle.ts';
import { chooseOutput, LOOP_T0_SEC, pagePlan, walkWizard, watchErrors } from '../loop/flow.ts';

test.skip(process.env['E2E_TOUR'] !== '1', 'run with -c e2e/tour/playwright.tour.config.ts');

/** The note sung wrong: the third note of the scale (E3), a tone sharp. */
const WRONG_IDX = 2;

/** The computed colour of a CSS colour expression on the page (resolves custom properties for the current theme). */
function resolve(page: Page, css: string): Promise<string> {
  return page.evaluate((c) => {
    const probe = document.createElement('span');
    probe.style.color = c;
    document.body.appendChild(probe);
    const v = getComputedStyle(probe).color;
    probe.remove();
    return v;
  }, css);
}

/** Letter and head fill of each written note in a container, in score order. */
function headFills(page: Page, within: string): Promise<{ letter: string; fill: string; cls: string }[]> {
  return page.evaluate((sel) => {
    const out: { letter: string; fill: string; cls: string }[] = [];
    for (const g of Array.from(document.querySelectorAll(`${sel} .sr-note[data-letter]`))) {
      const head = g.querySelector('.vf-notehead > text:first-child');
      if (head) out.push({ letter: g.getAttribute('data-letter')!, fill: getComputedStyle(head).fill, cls: g.getAttribute('class') ?? '' });
    }
    return out;
  }, within);
}

test('note colours: settings row, read-through, a try with a wrong note, the marked results', async ({ page }, info) => {
  test.setTimeout(300_000);
  const h = await loadLoopHelpers();
  const wav = process.env['E2E_TOUR_WAV']!;
  const errors = watchErrors(page);
  const dir = join(process.cwd(), 'docs', 'screenshots', 'note-colours');
  mkdirSync(dir, { recursive: true });
  const suffix = info.project.name.replace(/^iphone/, 'phone');
  const shot = async (name: string, fullPage = false): Promise<void> => {
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(dir, `${name}-${suffix}.png`), fullPage, animations: 'disabled' });
  };

  await page.goto(`./?testClock=1&testClockSec=${LOOP_T0_SEC}`);
  await walkWizard(page, { mic: 'allow', instrument: /^Baritone voice/ });
  await chooseOutput(page, 'Wired headphones');

  // Settings > Display: Note colours on (off by default), played notes live always.
  await page.evaluate(() => (location.hash = '#/settings/display'));
  const sw = page.getByRole('switch', { name: 'Note colours' });
  await expect(sw).not.toBeChecked();
  // The fixed tab bar can cover the switch on a phone, so a forced tap would land on it: click the input itself.
  await sw.evaluate((e) => (e as HTMLInputElement).click());
  await expect(sw).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-note-colours', 'on');
  await page.getByRole('radio', { name: 'Always' }).check({ force: true });
  await sw.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.querySelector('[data-testid="note-colour-key"]')?.closest('.set-row')?.scrollIntoView({ block: 'center' }));
  await shot('settings');

  // The five-note scale in C: read-through.
  await page.evaluate(() => (location.hash = '#/'));
  const home = page.getByTestId('screen-home');
  await expect(home).toBeVisible({ timeout: 15_000 });
  await home.getByTestId('scales-entry').click();
  await page.getByTestId('scales-chooser').getByRole('button', { name: /^Five-note scale in C major, C3 to G3/ }).click();
  const scan = page.getByTestId('screen-practice.scan');
  await expect(scan).toHaveAttribute('data-state', 'scanning', { timeout: 30_000 });
  await expect(scan.locator('[data-expected-idx]').first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => document.fonts.check('30pt Bravura')), { timeout: 15_000 }).toBe(true);
  // Point 5: the three bars sit on one system.
  await expect(scan.locator('svg.sr-system')).toHaveCount(1);
  const read = await headFills(page, '[data-testid="screen-practice.scan"]');
  expect(read.map((x) => x.letter).join('')).toBe('cdefgfedc');
  for (const x of read) expect(x.fill, x.letter).toBe(await resolve(page, `var(--head-${x.letter})`));
  await shot('read-through');

  // Sing it with the third note a tone sharp.
  const plan = await pagePlan(page);
  const sung = { ...plan, expected: plan.expected.map((e, i) => (i === WRONG_IDX ? { ...e, concertMidi: e.concertMidi + 2 } : e)) };
  h.writeSungWav(wav, sung, LOOP_T0_SEC);
  await page.getByRole('button', { name: 'Start playing' }).click();
  const play = page.getByTestId('screen-practice.play');
  await expect(play).toHaveAttribute('data-state', 'performing', { timeout: LOOP_T0_SEC * 1000 + 15_000 });

  // Mid-try: the wrong written note is greyed and the heard note is drawn, grey.
  const wrong = play.locator('.sr-note.n-error, .sr-note.n-error-hollow').first();
  await expect(wrong).toBeVisible({ timeout: 30_000 });
  await expect(play.locator('.sr-ghost').first()).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(400);
  const greyed = await resolve(page, 'var(--head-greyed)');
  const mid = await headFills(page, '[data-testid="screen-practice.play"]');
  const midWrong = mid.filter((x) => /\bn-error/.test(x.cls));
  expect(midWrong.length).toBeGreaterThan(0);
  for (const x of midWrong) expect(x.fill, `wrong ${x.letter}`).toBe(greyed);
  const ghostColour = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="screen-practice.play"] .sr-ghost')!).color);
  expect(ghostColour).toBe(await resolve(page, 'var(--ghost)'));
  await shot('try-wrong');

  // Results: the marked score, a green dot under every right note, the wrong note greyed, the heard note grey.
  const results = page.getByTestId('results-panel');
  await expect(results).toBeVisible({ timeout: (plan.endSec + 30) * 1000 });
  await expect(results).toHaveAttribute('data-state', 'graded');
  const review = page.getByTestId('review');
  await expect(review.locator('.sr-note[data-letter]').first()).toBeVisible({ timeout: 15_000 });
  await expect(review.locator('svg.sr-system')).toHaveCount(1);
  const marked = await headFills(page, '[data-testid="review"]');
  const right = marked.filter((x) => !/\bn-error/.test(x.cls));
  for (const x of right) expect(x.fill, `right ${x.letter}`).toBe(await resolve(page, `var(--head-${x.letter})`));
  for (const x of marked.filter((m) => /\bn-error/.test(m.cls))) expect(x.fill, `wrong ${x.letter}`).toBe(greyed);
  expect(await review.locator('[data-glyph="dot"]').count()).toBe(right.length);
  await review.scrollIntoViewIfNeeded();
  await shot('results', true);

  expect(errors).toEqual([]);
});
