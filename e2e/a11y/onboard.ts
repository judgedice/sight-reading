// Onboarding through the UI, visiting each step, ending on the Practice screen with Flute chosen.
import { expect, type Page } from '@playwright/test';
import { LOOP_T0_SEC } from '../loop/flow.ts';

export async function onboardWithVisits(page: Page, visit: (name: string) => Promise<void>): Promise<void> {
  await page.goto(`./?testClock=1&testClockSec=${LOOP_T0_SEC}`);
  await expect(page.getByTestId('screen-welcome')).toBeVisible({ timeout: 60_000 });
  await visit('welcome');
  await page.getByRole('button', { name: 'Get started' }).click();
  await expect(page.getByTestId('ob-instrument')).toBeVisible();
  await page.waitForTimeout(300);
  await visit('onboarding-instrument');
  await page.getByRole('radio', { name: /Flute/ }).check();
  await page.waitForTimeout(300);
  await visit('onboarding-instrument-picked');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('ob-mic')).toBeVisible();
  await visit('onboarding-mic');
  await page.getByRole('button', { name: 'Allow microphone' }).click();
  await expect(page.getByTestId('calibration-card')).toBeVisible({ timeout: 15_000 });
  await visit('onboarding-calibration');
  await page.getByTestId('calibration-card').getByRole('button', { name: 'Skip' }).click();
  // Step 5, Play one note (round 2): visited, then skipped.
  await expect(page.getByTestId('ob-match')).toBeVisible();
  await page.waitForTimeout(300);
  await visit('onboarding-note');
  await page.locator('.ob-head').getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByTestId('ob-level')).toBeVisible();
  await visit('onboarding-difficulty');
  await page.getByRole('button', { name: "I'll choose" }).click();
  await visit('onboarding-difficulty-choose');
  await page.getByRole('button', { name: 'Start practising' }).click();
  await expect(page.getByTestId('screen-home')).toBeVisible({ timeout: 15_000 });
}
