// The round 3 setup wizard and navigation (docs/redesign/round3/01-ux-review.md §3 to §6; PLAN R74 to R80) in Chromium
// against the production build, in the default `pnpm test:e2e` (chromium project only). Chromium's fake microphone
// sings a steady G3, so "Hear you" can hear a voice; it cannot hear the timing clicks, so Timing is skipped and every
// try stays practice until calibrated, which is what the honesty checks need.
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { axeSeriousViolations } from './design/helpers.ts';
import { LOOP_T0_SEC, chooseOutput, watchErrors } from './loop/flow.ts';
import { writeToneWav } from './loop/trail.ts';

const WAV = join(process.cwd(), 'test-results', 'wizard-e2e', 'g3.wav');
// The browser reads the file when a stream opens; it must exist before the browser starts.
writeToneWav(WAV, 55, 30);

const executablePath = process.env['PW_CHROMIUM_PATH'] ?? '/opt/pw-browsers/chromium';
test.use({
  permissions: ['microphone'],
  launchOptions: {
    executablePath,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${WAV}`],
  },
});

test.beforeEach(() => {
  test.skip(test.info().project.name !== 'chromium', 'chromium project only (the file sets its own fake microphone)');
});

const footerButtons = (page: Page) => page.getByTestId('wizard-footer').last().getByRole('button');

/** The footer's primary is always the rightmost button (01-ux-review §3.1). */
async function expectPrimaryRightmost(page: Page, primary: string): Promise<void> {
  const buttons = footerButtons(page);
  const n = await buttons.count();
  const boxes = await Promise.all(Array.from({ length: n }, (_, i) => buttons.nth(i).boundingBox()));
  const rights = boxes.map((b) => (b ? b.x + b.width : 0));
  const names = await buttons.allInnerTexts();
  const best = rights.indexOf(Math.max(...rights));
  expect(names[best]?.trim()).toBe(primary);
}

async function stepperSays(page: Page, n: number, name: string): Promise<void> {
  const nav = page.locator('nav.ob-stepper').first();
  await expect(nav).toHaveAttribute('aria-label', `Setup, step ${n} of 3: ${name}`);
  await expect(nav.locator('[aria-current="step"]')).toContainText(name);
  await expect(page.getByText(`Step ${n} of 3`, { exact: true })).toBeVisible();
}

test('the wizard: three named steps, a fixed footer, Hear you hears a voice, skips, and the first piece is practice at difficulty 1', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await page.goto(`./?testClock=1&testClockSec=${LOOP_T0_SEC}`);
  await expect(page.getByTestId('screen-welcome')).toBeVisible({ timeout: 60_000 });
  // Welcome is not counted.
  await expect(page.getByText(/Step \d of 3/)).toHaveCount(0);
  await expect(page.getByText("Three short steps: your instrument, a sound check, and you're ready.")).toBeVisible();
  expect(await axeSeriousViolations(page)).toEqual([]);
  await page.getByRole('button', { name: 'Get started' }).click();

  // 1. Instrument: nothing preselected, Next waits for a card.
  await stepperSays(page, 1, 'Instrument');
  await expect(page.locator('[role="radio"][aria-checked="true"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Next: sound check' })).toHaveAttribute('aria-disabled', 'true');
  await page.getByRole('radio', { name: /^Baritone voice/ }).check();
  await expect(page.getByTestId('ob-start-line')).toHaveText("You'll start with C3 to C4. That's difficulty 1, the simplest. The range grows as you move up.");
  await expectPrimaryRightmost(page, 'Next: sound check');
  expect(await axeSeriousViolations(page)).toEqual([]);
  await page.getByRole('button', { name: 'Next: sound check' }).click();

  // 2. Sound check, Microphone.
  await stepperSays(page, 2, 'Sound check');
  await expect(page.getByTestId('ob-mic')).toBeVisible();
  await expectPrimaryRightmost(page, 'Allow microphone');
  expect(await axeSeriousViolations(page)).toEqual([]);
  await page.getByRole('button', { name: 'Allow microphone' }).click();
  // Hear you opens in the same screen; the stage list ticks the microphone.
  await expect(page.getByTestId('ob-hear')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="ob-stages"] [data-stage="mic"]')).toHaveAttribute('data-status', 'done');
  await expect(page.getByRole('button', { name: 'Skip this check' })).toBeVisible();
  // The fake microphone sings G3: the name appears, holds still, and Next opens after about a second.
  await expect(page.getByTestId('ob-heard-note')).toHaveText('G3', { timeout: 20_000 });
  await expect(page.getByText('We hear you clearly.')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Next', exact: true })).not.toHaveAttribute('aria-disabled', 'true');
  expect(await axeSeriousViolations(page)).toEqual([]);
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  // Timing: skip it. The footer says what it costs.
  await expect(page.getByTestId('calibration-card')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Skipped, your tries are practice until you run it.')).toBeVisible();
  await expectPrimaryRightmost(page, 'Start timing check');
  expect(await axeSeriousViolations(page)).toEqual([]);

  // A reload mid sound check resumes there (at the Microphone stage: the browser is asked again).
  await page.reload();
  await expect(page.getByTestId('screen-welcome')).toBeVisible({ timeout: 60_000 });
  await stepperSays(page, 2, 'Sound check');
  await expect(page.getByTestId('ob-mic')).toBeVisible();
  await page.getByRole('button', { name: 'Allow microphone' }).click();
  // Hear you was heard before the reload: Allow goes straight on to Timing.
  await expect(page.getByTestId('calibration-card')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Skip for now' }).click();

  // 3. Ready.
  await stepperSays(page, 3, 'Ready');
  const ready = page.getByTestId('ob-ready');
  await expect(ready.locator('[data-row="hear"]')).toContainText('We hear you clearly');
  await expect(ready.locator('[data-row="timing"]')).toContainText('Not measured yet');
  await expect(ready.locator('[data-row="difficulty"]')).toContainText('1 of 10, the simplest');
  await expect(ready.getByTestId('mode-pill')).toHaveAttribute('data-mode', 'practice');
  await expectPrimaryRightmost(page, 'Start my first piece');
  expect(await axeSeriousViolations(page)).toEqual([]);
  await page.getByRole('button', { name: 'Start my first piece' }).click();

  // The cover at difficulty 1, in Practice, and it says so.
  const cover = page.getByTestId('scan-cover');
  await expect(cover).toBeVisible({ timeout: 30_000 });
  await expect(cover).toContainText('Difficulty 1');
  await expect(page.getByTestId('mode-chip')).toHaveAttribute('data-mode', 'practice');
  await expect(page.getByTestId('mode-chip')).toHaveText('Practice · no time limit');
  expect(errors).toEqual([]);
});

test('skips: "Not now" leaves the microphone off and Ready says what that means', async ({ page }) => {
  await page.goto(`./?testClock=1&testClockSec=${LOOP_T0_SEC}`);
  await expect(page.getByTestId('screen-welcome')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByRole('radio', { name: /Flute/ }).check();
  await page.getByRole('button', { name: 'Next: sound check' }).click();
  await page.getByRole('button', { name: 'Not now' }).click();
  const ready = page.getByTestId('ob-ready');
  await expect(ready.locator('[data-row="microphone"]')).toContainText("Off: tries won't be graded");
  await expect(ready.locator('[data-row="hear"]')).toContainText('Needs the microphone');
  await expect(ready.locator('[data-row="timing"]')).toContainText('Needs the microphone');
  await page.getByRole('button', { name: 'Go to Home' }).click();
  await expect(page.getByTestId('screen-home')).toBeVisible({ timeout: 15_000 });
});

test('Home: the tab is Home, headphones without calibration never say Ranked, and Calibrate has Back to where it came from', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`./?testClock=1&testClockSec=${LOOP_T0_SEC}`);
  await expect(page.getByTestId('screen-welcome')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByRole('radio', { name: /Flute/ }).check();
  await page.getByRole('button', { name: 'Next: sound check' }).click();
  await page.getByRole('button', { name: 'Allow microphone' }).click();
  await page.getByRole('button', { name: 'Skip this check' }).click();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.getByRole('button', { name: 'Go to Home' }).click();
  const home = page.getByTestId('screen-home');
  await expect(home).toBeVisible({ timeout: 15_000 });

  // R78: the tab and the title are Home; Practice is a mode only.
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Home' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Practice', exact: true })).toHaveCount(0);
  await expect(home.getByRole('heading', { name: 'Warm up' })).toBeVisible();

  // The review's case: Wired headphones and no finished calibration. Home must not offer Ranked, and the cover agrees.
  await chooseOutput(page, 'Wired headphones');
  const ranked = home.locator('[data-setup-row="mode"]').getByRole('radio', { name: 'Ranked' });
  await expect(ranked).toHaveAttribute('aria-disabled', 'true');
  await ranked.click({ force: true });
  await expect(home.getByTestId('mode-pill').first()).toHaveAttribute('data-mode', 'practice');
  await expect(page.getByRole('button', { name: /^Start ranked try/ })).toHaveCount(0);
  await page.getByRole('button', { name: /^Start practice/ }).click();
  await expect(page.getByTestId('scan-cover')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('mode-chip')).toHaveAttribute('data-mode', 'practice');
  await expect(page.getByTestId('scan-cover')).not.toContainText('to read, then the count-in starts by itself');
  await page.getByRole('button', { name: 'Home' }).first().click();
  await expect(home).toBeVisible({ timeout: 15_000 });

  // #/calibrate has Back, to Home from Home and to Settings > Sound from there.
  await home.getByRole('button', { name: 'Calibrate', exact: true }).first().click();
  await expect(page.getByTestId('screen-calibrate')).toBeVisible();
  await page.getByTestId('calibrate-back').click();
  await expect(home).toBeVisible();
  await page.evaluate(() => (location.hash = '#/settings/audio'));
  await page.getByRole('button', { name: /^Calibrate$|^Recalibrate$|^Calibrate again$/ }).first().click();
  await expect(page.getByTestId('screen-calibrate')).toBeVisible();
  await expect(page.getByTestId('calibrate-back')).toHaveText('Settings');
  await page.getByTestId('calibrate-back').click();
  await expect(page).toHaveURL(/#\/settings\/audio$/);
});
