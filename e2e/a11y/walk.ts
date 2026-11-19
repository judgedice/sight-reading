// The walk: every screen of the app, in the order a player meets them, calling `visit(name)` on each. Onboarding,
// the Practice screen with its instrument dialog and (on phones) a setup sheet, every tab and secondary route, then one
// practice take through the fake microphone to the cover, read-through, count-in, take and results (with the setup sheet
// over results), and the attempt in History.
import { expect, type Locator, type Page } from '@playwright/test';
import { loadLoopHelpers } from '../loop/bundle.ts';
import { chooseMode, chooseOutput, LOOP_T0_SEC, pagePlan } from '../loop/flow.ts';
import { go, HASH_ROUTES_A11Y } from './routes.ts';
import { onboardWithVisits } from './onboard.ts';

/** `light`: text checks only (no axe), for the moments where a main-thread stall would disturb the take. */
export type Visit = (name: string, light?: boolean) => Promise<void>;

async function closeOverlay(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

/**
 * Opens a dialog or sheet from `trigger` with the keyboard, lets `visit` look at it, closes it with Escape, and reports
 * when focus did not move into it or did not come back to the trigger (05 section 14 item 8).
 */
async function openVisitClose(page: Page, trigger: Locator, name: string, visit: Visit, fail: (msg: string) => void): Promise<void> {
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(500);
  if (!(await dialog.evaluate((d) => d.contains(document.activeElement)))) fail(`${name}: focus did not move into the dialog`);
  await visit(name);
  await closeOverlay(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  if (!(await trigger.evaluate((b) => b === document.activeElement))) fail(`${name}: focus did not return to the control that opened it`);
}

export async function walkScreens(page: Page, wav: string, phone: boolean, visit: Visit, fail: (msg: string) => void): Promise<void> {
  await onboardWithVisits(page, visit);

  // Practice, with the instrument dialog and the phone setup sheet.
  await visit('home');
  await openVisitClose(page, page.getByRole('button', { name: /Change instrument/ }).first(), 'home-instrument-dialog', visit, fail);
  if (phone) await openVisitClose(page, page.getByRole('button', { name: /^Key:/ }), 'home-setup-sheet-key', visit, fail);

  for (const hash of HASH_ROUTES_A11Y) {
    await go(page, hash);
    await visit(hash);
  }

  // One take: cover, read-through, count-in, take, results.
  await go(page, '#/');
  await chooseOutput(page, 'Wired headphones');
  await chooseMode(page, 'practice');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('scan-cover')).toBeVisible({ timeout: 30_000 });
  await visit('scan-cover');
  await page.getByRole('button', { name: 'Show the music' }).click();
  const scan = page.getByTestId('screen-practice.scan');
  await expect(scan).toHaveAttribute('data-state', 'scanning');
  await expect(scan.locator('[data-expected-idx]').first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => document.fonts.check('30pt Bravura')), { timeout: 15_000 }).toBe(true);
  await visit('read-through');
  const h = await loadLoopHelpers();
  const plan = await pagePlan(page);
  const lateIdx = h.lateNoteIdx(plan.expected);
  const lateDurMs = plan.expected.find((e) => e.idx === lateIdx)!.durSec * 1000;
  h.writeTourWav(wav, plan, LOOP_T0_SEC, Math.round(Math.min(250, 0.45 * lateDurMs)));
  await page.getByRole('button', { name: 'Start playing' }).click();
  const play = page.getByTestId('screen-practice.play');
  await expect(play).toBeVisible({ timeout: 15_000 });
  // Whether the take runs live is the loop suite's business (e2e/loop). A busy machine can lose the count-in; the walk
  // then goes on to whatever screen the take ends on.
  const live = await expect(play).toHaveAttribute('data-state', /count-in|performing/).then(() => true, () => false);
  if (live) await visit('count-in', true);
  const performing = live && (await expect(play).toHaveAttribute('data-state', 'performing', { timeout: LOOP_T0_SEC * 1000 + 10_000 }).then(() => true, () => false));
  if (performing) await expect(play.locator(`[data-expected-idx="${h.wrongNoteIdx(plan.expected)}"]`).first()).toHaveClass(/n-error/, { timeout: (plan.endSec + 5) * 1000 }).catch(() => undefined);
  if (performing && (await play.count()) > 0) await visit('take');
  const results = page.getByTestId('results-panel');
  await expect(results).toBeVisible({ timeout: (plan.endSec + 30) * 1000 });
  // A take that arrives void (the machine was too busy to follow it) is still a results screen worth walking.
  await expect(results).toHaveAttribute('data-state', /^(graded|void)$/);
  await page.waitForTimeout(600);
  await visit('results');
  const change = page.getByRole('button', { name: 'Change setup' }).first();
  if ((await change.count()) > 0) await openVisitClose(page, change, 'results-setup-sheet', visit, fail);

  // The attempt in History.
  await go(page, '#/history');
  const link = page.locator('a[href^="#/history/"]').first();
  if ((await link.count()) > 0) {
    await link.click();
    await page.waitForTimeout(800);
    await visit('history-attempt');
  }
  await go(page, '#/progress');
  await visit('progress-with-take');

  // Calibration listening state (a pulse that must become a fill under reduced motion).
  await go(page, '#/calibrate');
  const start = page.getByRole('button', { name: 'Start', exact: true });
  if ((await start.count()) > 0) {
    await start.click();
    await page.waitForTimeout(700);
    await visit('calibrate-listening');
    await page.getByRole('button', { name: /^(Stop|Cancel|Try again)/ }).first().click({ timeout: 2000 }).catch(() => undefined);
    await go(page, '#/');
  }
}
