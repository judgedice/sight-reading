// The scale try on the tour (PLAN R70 to R73): a baritone sings the five-note scale in C through Chromium's fake
// capture with two slips, the third note (E3) sung as F3 (a wrong letter) and the fourth (F3) 47 cents sharp, the rest
// as written. Captured into docs/screenshots/scale-try/<shot>-<colours>-<desktop|phone>-<light|dark>.png, with note
// colours off and on: the count-in on its third beat, bar 1 with a right note glowing, the two slips with the heard
// note drawn (the wrong letter at the pitch sung, the sharp one a little above with its up arrow), the results'
// "My marks", and the Settings rows (Beat line, Beat line timing, Note colours). Checked on the way: the count-in is
// one bar and says nothing about singing, the right notes glow live and in review, both slips show the heard note
// live at difficulty 1 with the direction, and nothing overflows. Run with -c e2e/tour/playwright.tour.config.ts.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { loadLoopHelpers } from '../loop/bundle.ts';
import { chooseOutput, LOOP_T0_SEC, pagePlan, walkWizard, watchErrors } from '../loop/flow.ts';

test.skip(process.env['E2E_TOUR'] !== '1', 'run with -c e2e/tour/playwright.tour.config.ts');

/** The sung slips: E3 as F3 (one semitone up, a wrong letter) and F3 47 cents sharp (difficulty 1 marks a voice sharp from 45 cents; from 50 it is the next note). */
const MODS = { 2: { semis: 1 }, 3: { cents: 47 } };

async function onboardBaritone(page: Page): Promise<void> {
  await page.goto(`./?testClock=1&testClockSec=${LOOP_T0_SEC}`);
  await walkWizard(page, { mic: 'allow', instrument: /^Baritone voice/ });
}

/** Score beat on the heard clock, or null before the try's clock exists. */
const beatNow = (page: Page): Promise<number | null> =>
  page.evaluate(() => {
    const w = window as unknown as { __sr: { audio: { audibleNow(): number }; session: { takeClock: { t0: number; bpm: number } | null } } };
    const c = w.__sr.session.takeClock;
    return c ? (w.__sr.audio.audibleNow() - c.t0) / (60 / c.bpm) : null;
  });

async function waitForBeat(page: Page, beat: number): Promise<void> {
  await expect.poll(async () => (await beatNow(page)) ?? -Infinity, { timeout: 60_000, intervals: [20] }).toBeGreaterThanOrEqual(beat);
}

for (const colours of ['off', 'on'] as const) {
  test(`scale try with note colours ${colours}: count-in, glow, heard notes, My marks, Settings`, async ({ page }, info) => {
    test.setTimeout(300_000);
    const h = await loadLoopHelpers();
    const wav = process.env['E2E_TOUR_WAV']!;
    const errors = watchErrors(page);
    const dir = join(process.cwd(), 'docs', 'screenshots', 'scale-try');
    mkdirSync(dir, { recursive: true });
    const suffix = info.project.name.replace(/^iphone/, 'phone');
    const issues: string[] = [];
    const shot = async (name: string, fullPage = false): Promise<void> => {
      await page.screenshot({ path: join(dir, `${name}-colours-${colours}-${suffix}.png`), fullPage, animations: 'disabled' });
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (over > 1) issues.push(`${name}: page overflows by ${over}px`);
    };

    await onboardBaritone(page);
    // Wired headphones: no count-in recheck (the fake microphone hears no clicks, which would restart the count-in).
    await chooseOutput(page, 'Wired headphones');
    if (colours === 'on') {
      await page.evaluate(() => (location.hash = '#/settings/display'));
      const sw = page.getByRole('switch', { name: 'Note colours' });
      await expect(sw).toBeVisible({ timeout: 15_000 });
      // The drawn track sits over the native checkbox (and a touch tap on it at phone size misses): click the input.
      await sw.evaluate((e) => (e as HTMLInputElement).click());
      await expect(sw).toBeChecked();
      await page.evaluate(() => (location.hash = '#/'));
      await expect(page.getByTestId('screen-home')).toBeVisible({ timeout: 15_000 });
    }

    // Settings rows: Beat line and its timing (Practice), Note colours with its key (Display).
    await page.evaluate(() => (location.hash = '#/settings/practice'));
    const timing = page.getByTestId('beat-line-timing');
    await expect(timing).toBeVisible({ timeout: 15_000 });
    await timing.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await shot('settings-practice');
    await page.evaluate(() => (location.hash = '#/settings/display'));
    const key = page.getByTestId('note-colour-key');
    await expect(key).toBeVisible({ timeout: 15_000 });
    await key.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await shot('settings-display');
    await page.evaluate(() => (location.hash = '#/'));
    await expect(page.getByTestId('screen-home')).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('scales-entry').click();
    await page.getByTestId('scales-chooser').getByRole('button', { name: /^Five-note scale in C major, C3 to G3/ }).click();
    const scan = page.getByTestId('screen-practice.scan');
    await expect(scan).toHaveAttribute('data-state', 'scanning', { timeout: 30_000 });
    await expect(scan.locator('[data-expected-idx]').first()).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => page.evaluate(() => document.fonts.check('30pt Bravura')), { timeout: 15_000 }).toBe(true);
    await expect(page.getByTestId('scan-beat-line').getByRole('switch', { name: 'Beat line' })).toBeChecked();
    await page.waitForTimeout(300);
    await shot('read-through');
    const plan = await pagePlan(page);
    h.writeSungWav(wav, plan, LOOP_T0_SEC, MODS);

    await page.getByRole('button', { name: 'Start playing' }).click();
    const play = page.getByTestId('screen-practice.play');
    await expect(play).toBeVisible({ timeout: 15_000 });

    // The count-in on its third beat: one bar, a plain count, no word about singing.
    await waitForBeat(page, -1.85);
    await shot('count-in-beat-3');
    await expect(play.locator('.sf-count-cell')).toHaveCount(4);
    await expect(play.locator('.sf-count-cell[data-state="current"]')).toHaveText('3');
    expect(await play.evaluate((e) => (e as HTMLElement).innerText)).not.toMatch(/\bSing\b/);
    await expect(play.locator('.sf-hl-disc, .sf-hl-name, [data-brass]')).toHaveCount(0);

    // Bar 1: the first right note glows (the glow behind its head, the dot under it).
    await waitForBeat(page, 1.7);
    await expect(play.locator('.sr-glow[data-glow-for="0"]')).toHaveCount(1);
    await shot('bar1-glow');

    // The slips: E3 sung as F3 (the heard F3 drawn in grey beside the written E3) and F3 sung sharp (a little above,
    // with an up arrow), both live at difficulty 1.
    await waitForBeat(page, 3.85);
    await expect(play.locator('.sr-ghost[data-kind="wrong-pitch"]')).toHaveCount(1);
    await expect(play.locator('.sr-ghost[data-kind="sharp"][data-direction="up"] .sr-ghost-arrow[data-arrow="up"]')).toHaveCount(1);
    await shot('heard-notes');

    const results = page.getByTestId('results-panel');
    await expect(results).toBeVisible({ timeout: (plan.endSec + 30) * 1000 });
    await expect(results).toHaveAttribute('data-state', 'graded');
    const marks = page.getByRole('region', { name: 'My marks' });
    await expect(marks.locator('.sr-glow').first()).toBeVisible({ timeout: 15_000 });
    const judged = await page.evaluate(() => (window as unknown as { __sr: { session: { record: { judgments: { expectedIdx: number; pitch: string | null; timing: string | null; status: string }[] } | null } } }).__sr.session.record!.judgments);
    const right = judged.filter((j) => j.status === 'matched' && (j.pitch === 'in-tune' || j.pitch === null) && (j.timing === 'on-time' || j.timing === null)).length;
    expect(right).toBeGreaterThanOrEqual(5);
    expect(judged.find((j) => j.expectedIdx === 2)?.pitch).toBe('wrong-pitch');
    expect(judged.find((j) => j.expectedIdx === 3)?.pitch).toBe('sharp');
    await expect(marks.locator('.sr-glow')).toHaveCount(right);
    await expect(marks.locator('.sr-ghost[data-kind="wrong-pitch"]')).toHaveCount(1);
    await expect(marks.locator('.sr-ghost[data-kind="sharp"][data-direction="up"]')).toHaveCount(1);
    await marks.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot('results-my-marks');

    expect(issues).toEqual([]);
    expect(errors).toEqual([]);
  });
}
