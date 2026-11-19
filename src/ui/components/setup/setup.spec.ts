// Setup controls in a real browser: the tempo marking's spacing, the never-scaled key staff, mouse, touch and keys,
// no sideways scroll on a phone, and the screenshots compared with the home, setup-sheet and setup-states mockups.
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const STORY = '/src/ui/components/setup/story/index.html';
const SHOTS = join(process.cwd(), 'docs', 'redesign', 'shots-build', 'setup-controls');

async function open(page: Page): Promise<void> {
  await page.goto(STORY);
  await page.waitForSelector('[data-story="home"]');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

test('the quarter note sits within 0.35 em of "=" (designer check, critique C9)', async ({ page }) => {
  await open(page);
  const m = await page.evaluate(() => {
    const unit = document.querySelector('[data-story="sheet"] [data-tempo-unit]')!;
    const rest = unit.nextElementSibling!.firstChild!;
    const text = rest.textContent ?? '';
    const at = text.indexOf('=');
    const range = document.createRange();
    range.setStart(rest, at);
    range.setEnd(rest, at + 1);
    const eq = range.getBoundingClientRect();
    const u = unit.getBoundingClientRect();
    const fontSize = parseFloat(getComputedStyle(unit.parentElement!).fontSize);
    return { gap: eq.left - u.right, fontSize, unitFont: getComputedStyle(unit).fontFamily, loaded: document.fonts.check('16px "Sightread Music Text"', '♩') };
  });
  expect(m.loaded).toBe(true);
  expect(m.unitFont).toContain('Sightread Music Text');
  expect(m.gap).toBeGreaterThanOrEqual(0);
  expect(m.gap).toBeLessThanOrEqual(0.35 * m.fontSize);
});

test('key chip staves keep the 6.5 px staff space at every width', async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    const sizes = await page.$$eval('.su-mini-key svg', (svgs) =>
      svgs.map((s) => ({ drawn: s.getBoundingClientRect().height, asked: Number(s.getAttribute('height')) })),
    );
    expect(sizes.length).toBeGreaterThan(0);
    for (const s of sizes) expect(Math.abs(s.drawn - s.asked)).toBeLessThan(0.5);
    const chipWidths = await page.$$eval('[data-story="key-clarinet"] .su-chip:not(.su-chip-any)', (els) => els.map((e) => e.getBoundingClientRect().width));
    expect(Math.min(...chipWidths)).toBeGreaterThanOrEqual(96);
  }
});

test('desktop key grid: 3 columns to difficulty 4, 4 from 5; phones always 3', async ({ page }) => {
  const columns = (story: string) =>
    page.$eval(`[data-story="${story}"] .su-key-group`, (g) => getComputedStyle(g).gridTemplateColumns.split(' ').length);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  expect(await columns('key-fallback')).toBe(3);
  expect(await columns('key-clarinet')).toBe(4);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await columns('key-clarinet')).toBe(3);
});

test('mouse, arrow keys and touch choose keys and meters', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  await open(page);
  const sheet = page.locator('[data-story="sheet"]');
  const checked = (name: string) => sheet.getByRole('radio', { name, exact: false }).first();

  await sheet.getByRole('radio', { name: /^F major/ }).click();
  await expect(checked('F major')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(sheet.getByRole('radio', { name: /^G major/ })).toHaveAttribute('aria-checked', 'true');
  await expect(sheet.getByRole('radio', { name: /^G major/ })).toBeFocused();
  await sheet.getByRole('radio', { name: /^E minor/ }).tap();
  await expect(sheet.getByRole('radio', { name: /^E minor/ })).toHaveAttribute('aria-checked', 'true');
  await sheet.getByRole('radio', { name: /^Any key/ }).tap();
  await expect(sheet.getByRole('radio', { name: /^Any key/ })).toHaveAttribute('aria-checked', 'true');

  await sheet.getByRole('radio', { name: '3 4 time' }).tap();
  await expect(sheet.getByRole('radio', { name: '3 4 time' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Home');
  await expect(sheet.getByRole('radio', { name: /^Any/ }).nth(1)).toBeFocused();

  // Nothing scrolls sideways on a phone.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await context.close();
});

test('a blocked Ranked takes focus, keeps its reason in view and is not chosen', async ({ page }) => {
  await open(page);
  const card = page.locator('[data-story="mode-blocked"]');
  await card.getByRole('radio', { name: 'Practice' }).focus();
  await page.keyboard.press('ArrowLeft');
  const ranked = card.getByRole('radio', { name: 'Ranked' });
  await expect(ranked).toBeFocused();
  await expect(ranked).toHaveAttribute('aria-disabled', 'true');
  await expect(card.getByRole('radio', { name: 'Practice' })).toHaveAttribute('aria-checked', 'true');
  await expect(card.getByText('Ranked needs a calibrated setup on this device.')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Calibrate now' })).toBeVisible();
});

for (const [size, viewport] of [
  ['desktop', { width: 1440, height: 900 }],
  ['phone', { width: 390, height: 844 }],
] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`screenshot ${size} ${scheme}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport, colorScheme: scheme, deviceScaleFactor: 1 });
      const page = await context.newPage();
      await open(page);
      await page.screenshot({ path: join(SHOTS, `setup-controls-${size}-${scheme}.png`), fullPage: true });
      await context.close();
    });
  }
}
