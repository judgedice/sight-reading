// Calibration status in a real browser: axe on the story page in light and dark, with and without a popover, and the
// screenshots compared with the cal-status mockup.
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { axeSeriousViolations } from '../../../../e2e/design/helpers.ts';

const STORY = '/src/ui/components/calibration-status/story/index.html';
const SHOTS = join(process.cwd(), 'docs', 'redesign', 'shots-build', 'calibration-status-components');
const SIZES = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };

async function open(page: Page, query: string, size: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(size);
  await page.goto(`${STORY}?${query}`);
  await page.waitForSelector('[data-story]', { state: 'attached' });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

for (const theme of ['light', 'dark']) {
  for (const [size, dims] of Object.entries(SIZES)) {
    for (const popover of ['', 'changed', 'none']) {
      test(`axe finds no serious violations: ${theme} ${size} ${popover || 'closed'}`, async ({ page }) => {
        await open(page, `theme=${theme}${popover ? `&popover=${popover}` : ''}&readthrough=1`, dims);
        if (popover) await expect(page.locator('.ui-popover')).toBeVisible();
        expect(await axeSeriousViolations(page)).toEqual([]);
        if (!popover) await page.screenshot({ path: join(SHOTS, `board-${size}-${theme}.png`), fullPage: true });
        else await page.screenshot({ path: join(SHOTS, `popover-${popover}-${size}-${theme}.png`) });
      });
    }
  }
}

test('only the changed pill is coloured: its text differs from the others', async ({ page }) => {
  await open(page, '', SIZES.desktop);
  const colour = async (state: string): Promise<string> =>
    await page.locator(`[data-story-header="${state}"] button`).evaluate((el) => getComputedStyle(el).color);
  const changed = await colour('changed');
  for (const s of ['none', 'ok', 'failed']) expect(await colour(s)).not.toBe(changed);
  expect(await colour('none')).toBe(await colour('failed'));
});

test('Escape closes the popover and returns focus to the pill', async ({ page }) => {
  await open(page, 'popover=none', SIZES.desktop);
  await expect(page.locator('.ui-popover')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.ui-popover')).toHaveCount(0);
  await expect(page.locator('[data-story-header="none"] button')).toBeFocused();
});
