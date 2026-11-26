// Practice screen, round 2 (01-ux section 6, 04-design section 1): one screen with no scrolling at 1440 x 900
// (difficulties 1, 5 and 10) and 390 x 844 (difficulty 1), the key note at difficulty 1, no calibration banner, one
// Calibrate control while Ranked is blocked, and phone chip labels that never meet their chevrons.
// Run with -c e2e/setup/playwright.setup.config.ts.
import { expect, test, type Page } from '@playwright/test';
import { watchErrors } from '../loop/flow.ts';

test.skip(process.env['E2E_SETUP'] !== '1', 'run with -c e2e/setup/playwright.setup.config.ts');

const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 1280) < 1024;

/**
 * Onboarding to Practice with the microphone allowed and calibration skipped, so Ranked is blocked by calibration.
 * Written step by step on what each page offers, so a step added to onboarding does not stop it.
 */
async function toPractice(page: Page): Promise<void> {
  await page.goto('./');
  await expect(page.getByTestId('screen-welcome')).toBeVisible({ timeout: 30_000 });
  const home = page.getByTestId('screen-home');
  for (let i = 0; i < 30 && !(await home.isVisible()); i++) {
    const offered = async (name: string | RegExp): Promise<boolean> => {
      const b = page.getByRole('button', { name, exact: typeof name === 'string' });
      if (!(await b.first().isVisible().catch(() => false))) return false;
      await b
        .first()
        .click({ timeout: 3_000 })
        .catch(() => undefined);
      await page.waitForTimeout(200);
      return true;
    };
    if (await offered('Get started')) continue;
    const flute = page.getByRole('radio', { name: /^Flute/ }).first();
    if ((await flute.isVisible().catch(() => false)) && !(await flute.isChecked().catch(() => true))) await flute.check().catch(() => undefined);
    if (await offered('Go to Home')) continue;
    if (await offered('Allow microphone')) continue;
    if (await offered('Skip this check')) continue;
    if (await offered('Skip for now')) continue;
    if (await offered('Next: sound check')) continue;
    await page.waitForTimeout(300);
  }
  await expect(home).toBeVisible({ timeout: 15_000 });
}

/** The value the difficulty stepper shows, from the form (desktop) or the chip (phone). */
async function difficulty(page: Page): Promise<number> {
  const text = isPhone(page)
    ? await page.locator('[data-chip="difficulty"] .home-chip-value').textContent()
    : await page.locator('[data-setup-slot="difficulty"] .ui-stepper-value').textContent();
  return Number.parseInt(text ?? '', 10);
}

/** Steps the difficulty to `level`: in the form on desktop, in the setup sheet on phones (closed again after). */
async function setDifficulty(page: Page, level: number): Promise<void> {
  const phone = isPhone(page);
  if (phone) await page.locator('[data-chip="difficulty"]').click();
  const row = page.locator('[data-setup-slot="difficulty"]');
  const value = async (): Promise<number> => Number.parseInt((await row.locator('.ui-stepper-value').textContent()) ?? '', 10);
  for (let i = 0; i < 12; i++) {
    const cur = await value();
    if (cur === level) break;
    await row.getByRole('button', { name: cur < level ? /^Increase/ : /^Decrease/ }).click();
  }
  expect(await value()).toBe(level);
  if (phone) {
    await page.getByRole('dialog').getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByTestId('setup-sheet')).toHaveCount(0);
  }
}

/** No page scrolling, and no element in the Practice screen that scrolls inside itself. */
async function expectNoScroll(page: Page, what: string): Promise<void> {
  const m = await page.evaluate(() => {
    const d = document.documentElement;
    const inner = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="screen-home"], [data-testid="screen-home"] *'))
      .filter((el) => el.scrollHeight > el.clientHeight + 1 && /(auto|scroll|hidden)/.test(getComputedStyle(el).overflowY))
      .filter((el) => !el.closest('.su-mini-key, .su-key-sig'))
      // Visually hidden text (a 1 px clipped box) is not a scroll area.
      .filter((el) => el.clientWidth > 1 && el.clientHeight > 1)
      .map((el) => el.className || el.tagName);
    return { scroll: d.scrollHeight, client: d.clientHeight, inner };
  });
  expect(m.scroll, `${what}: page scrollHeight`).toBeLessThanOrEqual(m.client);
  expect(m.inner, `${what}: inner scroll areas`).toEqual([]);
}

test('no scrolling at 1440 x 900 (difficulties 1, 5, 10) and 390 x 844 (difficulty 1)', async ({ page }) => {
  const errors = watchErrors(page);
  await toPractice(page);
  if (isPhone(page)) {
    await page.setViewportSize({ width: 390, height: 844 });
    await setDifficulty(page, 1);
    expect(await difficulty(page)).toBe(1);
    await expectNoScroll(page, 'phone difficulty 1');
  } else {
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const level of [1, 5, 10]) {
      await setDifficulty(page, level);
      await expectNoScroll(page, `desktop difficulty ${level}`);
    }
  }
  expect(errors).toEqual([]);
});

test('difficulty 1 says which keys it uses and when minor keys start; never "More keys from"', async ({ page }) => {
  await toPractice(page);
  await setDifficulty(page, 1);
  if (isPhone(page)) await page.locator('[data-chip="key"]').click();
  const key = page.locator('[data-setup-slot="key"]');
  await expect(key).toContainText('Difficulty 1 uses major keys with up to 1 sharp or flat. Minor keys start at difficulty 2.');
  await expect(page.getByText('More keys from', { exact: false })).toHaveCount(0);
  // The row label is "Time signature" (owner point 8).
  await expect(page.locator('[data-setup-slot="time"] .su-label')).toHaveText('Time signature');
});

test('no calibration banner; one Calibrate control while Ranked is blocked; the pill reads Not calibrated', async ({ page }) => {
  await toPractice(page);
  const home = page.getByTestId('screen-home');
  await expect(home.getByText('Calibrate once', { exact: false })).toHaveCount(0);
  await expect(home.locator('[data-setup-row="mode"]').getByRole('radio', { name: 'Ranked' })).toHaveAttribute('aria-disabled', 'true');
  await expect(home.getByTestId('cal-status')).toContainText('Not calibrated');
  // Exactly one control offers "Calibrate" (case-sensitive: the pill's "Not calibrated" is not one). Desktop: the
  // link in the Mode line. Phone: the summary card's calibration row; the Mode line names the reason without a link.
  await expect(home.getByRole('button', { name: /Calibrate\b/ })).toHaveCount(1);
  const fix = home.locator('[data-setup-row="mode"]').getByRole('button', { name: 'Calibrate', exact: true });
  await expect(fix).toHaveCount(isPhone(page) ? 0 : 1);
  await expect(home.getByRole('button', { name: 'Calibrate now' })).toHaveCount(0);
});

test('phone: chip labels never meet their chevrons; "Time signature" is never shortened', async ({ page }) => {
  test.skip(!isPhone(page), 'phone only');
  await toPractice(page);
  const chips = page.locator('[data-chip]');
  await expect(chips).toHaveCount(5);
  for (let i = 0; i < 5; i++) {
    const chip = chips.nth(i);
    const label = (await chip.locator('.home-chip-label').boundingBox())!;
    const chevron = (await chip.locator('.home-chip-chevron').boundingBox())!;
    const value = (await chip.locator('.home-chip-value').boundingBox())!;
    const box = (await chip.boundingBox())!;
    // The chevron sits below the label's last line and right of the value; all inside the chip.
    expect(chevron.y, `chip ${i}: chevron under the label`).toBeGreaterThanOrEqual(label.y + label.height - 0.5);
    expect(chevron.x, `chip ${i}: chevron right of the value`).toBeGreaterThanOrEqual(value.x + value.width - 0.5);
    expect(label.x + label.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
    expect(chevron.x + chevron.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
  }
  await expect(page.locator('[data-chip="time"] .home-chip-label')).toHaveText('Time signature');
  // One Warm up group, named the same as on the desktop (round 3, 01-ux-review problem 12).
  await expect(page.getByTestId('match-entry')).toContainText('Match a note');
  await expect(page.getByRole('heading', { name: 'Warm up' })).toBeVisible();
});
