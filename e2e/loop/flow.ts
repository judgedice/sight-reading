// Shared steps of the practice-loop specs (onboarding, setup, the page's take plan).
import { expect, type Page } from '@playwright/test';
import type { PagePlan } from './node-helpers.ts';

/** Seconds from the capture origin to bar 1 beat 1 (`?testClockSec=`): room for a 2-bar count-in at slow tempos. */
export const LOOP_T0_SEC = 10;

export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text());
  });
  page.on('response', (res) => {
    if (res.status() >= 400 && !/favicon\.ico$/.test(res.url())) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

/** Onboarding up to the level step. `mic`: allow it (fake device) or decline with Not now. */
export async function onboard(page: Page, mic: 'allow' | 'decline'): Promise<void> {
  await page.goto(`./?testClock=1&testClockSec=${LOOP_T0_SEC}`);
  const welcome = page.getByTestId('screen-welcome');
  await expect(welcome).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/#\/welcome$/);
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByRole('radio', { name: /Flute/ }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('ob-mic')).toBeVisible();
  if (mic === 'allow') {
    await page.getByRole('button', { name: 'Allow microphone' }).click();
    // Calibration: skipped (the fake microphone hears no clicks). The test clock runs with RTL 0.
    await expect(page.getByTestId('calibration-card')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('calibration-card').getByRole('button', { name: 'Skip' }).click();
    // Step 5, Sing or Play one note (round 2): skipped here.
    await expect(page.getByTestId('ob-match')).toBeVisible();
    await page.locator('.ob-head').getByRole('button', { name: 'Skip' }).click();
  } else {
    await page.getByRole('button', { name: 'Not now' }).click();
  }
  await expect(page.getByTestId('ob-level')).toBeVisible();
  await page.getByRole('button', { name: "I'll choose" }).click();
  await page.getByRole('button', { name: 'Start practising' }).click();
  await expect(page.getByTestId('screen-home')).toBeVisible({ timeout: 15_000 });
}

/** Output lives in Settings > Sound (05 section 5.1): open it, pick `label`, and come back to Practice. */
export async function chooseOutput(page: Page, label: string): Promise<void> {
  await page.evaluate(() => (location.hash = '#/settings/audio'));
  await page.getByRole('combobox', { name: 'Output' }).selectOption({ label });
  await page.evaluate(() => (location.hash = '#/'));
  await expect(page.getByTestId('screen-home')).toBeVisible({ timeout: 15_000 });
}

/** Picks Ranked or Practice in the Practice screen's Mode control. */
export async function chooseMode(page: Page, mode: 'ranked' | 'practice'): Promise<void> {
  await page
    .getByTestId('screen-home')
    .locator('[data-setup-row="mode"]')
    .getByRole('radio', { name: mode === 'ranked' ? 'Ranked' : 'Practice' })
    .click();
}

/** Home setup: practice mode, wired headphones (no count-in recheck on speakers), then Start. */
export async function setupAndStart(page: Page): Promise<void> {
  await chooseOutput(page, 'Wired headphones');
  await chooseMode(page, 'practice');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('scan-cover')).toBeVisible({ timeout: 30_000 });
}

export async function pagePlan(page: Page): Promise<PagePlan> {
  return page.evaluate(() => {
    const s = (window as unknown as { __sr: { session: { plan: { inst: { id: string }; bpm: number; beatsPerBar: number; endSec: number; expected: unknown[] } | null } } }).__sr.session;
    const p = s.plan;
    if (!p) throw new Error('no plan');
    return { instrumentId: p.inst.id, bpm: p.bpm, beatsPerBar: p.beatsPerBar, endSec: p.endSec, expected: p.expected } as PagePlan;
  });
}
