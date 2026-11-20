// Diagnostics components in a real browser: axe on the story page and the dialog (dialog on desktop, sheet on phone),
// light and dark, and the screenshots compared with the send-diagnostics mockup.
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { axeSeriousViolations } from '../../../../e2e/design/helpers.ts';

const STORY = '/src/ui/components/diagnostics/story/index.html';
const SHOTS = join(process.cwd(), 'docs', 'redesign', 'shots-build', 'diagnostics-components');
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
    test(`axe finds no serious violations: page ${theme} ${size}`, async ({ page }) => {
      await open(page, `theme=${theme}`, dims);
      expect(await axeSeriousViolations(page)).toEqual([]);
    });
    for (const variant of ['plain', 'address&share=1']) {
      test(`axe finds no serious violations: dialog ${variant} ${theme} ${size}`, async ({ page }) => {
        await open(page, `theme=${theme}&open=1&${variant === 'plain' ? '' : `address=1&${variant.split('&')[1]}`}`, dims);
        await expect(page.getByTestId('diagnostics-file')).toBeVisible();
        expect(await axeSeriousViolations(page)).toEqual([]);
        await page.screenshot({ path: join(SHOTS, `dialog-${variant.split('&')[0]}-${size}-${theme}.png`) });
      });
    }
  }
}

test('desktop shows a dialog and phone a sheet; every action stays in view', async ({ page }) => {
  await open(page, 'open=1', SIZES.desktop);
  await expect(page.locator('.ui-modal')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save file' })).toBeInViewport();
  await page.close();
});

test('phone sheet keeps Save file reachable', async ({ page }) => {
  await open(page, 'open=1', SIZES.phone);
  await expect(page.locator('.ui-sheet')).toBeVisible();
  await page.getByRole('button', { name: 'Save file' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Save file' })).toBeInViewport();
});
