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

export interface WizardWalk {
  /** Allow the microphone (fake device) or decline it with Not now. */
  mic: 'allow' | 'decline';
  /** The instrument card's accessible name. Default Flute. */
  instrument?: RegExp;
  /** Called on every step and stage, by name (screenshots, axe). */
  visit?: (name: string) => Promise<void>;
  /** Ready's main button opens the first piece; the default, "Go to Home", opens Home. */
  finish?: 'home' | 'first-piece';
}

/**
 * The setup wizard (round 3, R74): Welcome, Instrument, Sound check (Microphone, Hear you skipped, Timing skipped:
 * the fake microphone hears no clicks) and Ready. Leaves the app on Home, or on the first piece's cover.
 */
export async function walkWizard(page: Page, o: WizardWalk): Promise<void> {
  const visit = async (name: string): Promise<void> => o.visit?.(name);
  const welcome = page.getByTestId('screen-welcome');
  await expect(welcome).toBeVisible({ timeout: 60_000 });
  await expect(page).toHaveURL(/#\/welcome$/);
  await visit('welcome');
  await page.getByRole('button', { name: 'Get started' }).click();
  await expect(page.getByTestId('ob-instrument')).toBeVisible();
  await visit('onboarding-instrument');
  await page.getByRole('radio', { name: o.instrument ?? /Flute/ }).check();
  await visit('onboarding-instrument-picked');
  await page.getByRole('button', { name: 'Next: sound check' }).click();
  await expect(page.getByTestId('ob-mic')).toBeVisible();
  await visit('onboarding-mic');
  if (o.mic === 'allow') {
    await page.getByRole('button', { name: 'Allow microphone' }).click();
    // Hear you opens in the same screen: skipped here (Match a note is the place for tuning).
    await expect(page.getByTestId('ob-hear')).toBeVisible({ timeout: 15_000 });
    await visit('onboarding-hear');
    await page.getByRole('button', { name: 'Skip this check' }).click();
    // Timing: skipped (the fake microphone hears no clicks). The test clock runs with RTL 0.
    await expect(page.getByTestId('calibration-card')).toBeVisible({ timeout: 15_000 });
    await visit('onboarding-timing');
    await page.getByRole('button', { name: 'Skip for now' }).click();
  } else {
    await page.getByRole('button', { name: 'Not now' }).click();
  }
  await expect(page.getByTestId('ob-ready')).toBeVisible();
  await visit('onboarding-ready');
  if (o.finish === 'first-piece') {
    await page.getByRole('button', { name: 'Start my first piece' }).click();
    await expect(page.getByTestId('scan-cover')).toBeVisible({ timeout: 30_000 });
  } else {
    await page.getByRole('button', { name: 'Go to Home' }).click();
    await expect(page.getByTestId('screen-home')).toBeVisible({ timeout: 15_000 });
  }
}

/** Setup with the test clock, ending on Home at difficulty 1. `mic`: allow it (fake device) or decline with Not now. */
export async function onboard(page: Page, mic: 'allow' | 'decline'): Promise<void> {
  await page.goto(`./?testClock=1&testClockSec=${LOOP_T0_SEC}`);
  await walkWizard(page, { mic });
}

/** Home's Start: "Start practice" or "Start ranked try" (round 3, R79). */
export const START_NAME = /^Start (practice|ranked try)/;

/** Output lives in Settings > Sound (05 section 5.1): open it, pick `label`, and come back to Home. */
export async function chooseOutput(page: Page, label: string): Promise<void> {
  await page.evaluate(() => (location.hash = '#/settings/audio'));
  await page.getByRole('combobox', { name: 'Output' }).selectOption({ label });
  await page.evaluate(() => (location.hash = '#/'));
  await expect(page.getByTestId('screen-home')).toBeVisible({ timeout: 15_000 });
}

/** Picks Ranked or Practice in Home's Mode control. */
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
  await page.getByRole('button', { name: START_NAME }).click();
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
