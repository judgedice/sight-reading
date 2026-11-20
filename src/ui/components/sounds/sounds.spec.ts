// Sounds components in a real browser: the popover's five routes, the confirm's focus and its three ways out, the
// explain sheet's rows, still bars under reduced motion, and the screenshots compared with
// the scan-* mockups.
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const STORY = '/src/ui/components/sounds/story/index.html';
const SHOTS = join(process.cwd(), 'docs', 'redesign', 'shots-build', 'sounds-components');
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

async function open(page: Page, query = '', size = DESKTOP): Promise<void> {
  await page.setViewportSize(size);
  await page.goto(`${STORY}?${query}`);
  await page.waitForSelector('[data-story]', { state: 'attached' });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

const info = (page: Page) => page.locator('[data-story="desktop"] .ui-info-button');
const popover = (page: Page) => page.locator('.ui-popover');

test('the popover opens by click, Enter, Space and a 400 ms hover, and Escape returns focus', async ({ page }) => {
  await open(page, 'kind=voice');
  await info(page).click();
  await expect(popover(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(popover(page)).toHaveCount(0);
  await expect(info(page)).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(popover(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(popover(page)).toHaveCount(0);

  await page.keyboard.press('Space');
  await expect(popover(page)).toBeVisible();
  await page.keyboard.press('Escape');

  await page.mouse.move(5, 5);
  await info(page).hover();
  await page.waitForTimeout(150);
  await expect(popover(page)).toHaveCount(0);
  await page.waitForTimeout(350);
  await expect(popover(page)).toBeVisible();
  await page.mouse.move(5, 5);
  await expect(popover(page)).toHaveCount(0);
});

test('a tap opens the popover on a touch device', async ({ browser }) => {
  const context = await browser.newContext({ viewport: DESKTOP, hasTouch: true });
  const page = await context.newPage();
  await open(page, 'kind=voice');
  await info(page).tap();
  await expect(popover(page)).toBeVisible();
  await context.close();
});

test('the popover text is the catalogue text, and the button has a native title', async ({ page }) => {
  await open(page, 'kind=instrument');
  await expect(info(page)).toHaveAttribute('title', 'Plays the key chord, so you hear the key.');
  await info(page).click();
  await expect(page.locator('.ui-popover-title')).toHaveText('What is the key chord?');
  await expect(page.locator('.ui-popover-body')).toHaveText(
    'The key chord is the home chord of this piece, at concert pitch. It gives away no notes, so you can use it in ranked tries too.',
  );
});

test('the listen confirm focuses Keep it ranked; Escape and a scrim tap keep it ranked', async ({ page }) => {
  await open(page, 'kind=voice&confirm=1');
  const dialog = page.getByRole('dialog', { name: 'Listen first?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Keep it ranked' })).toBeFocused();
  await expect(dialog).toContainText('0:18 left');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-story="desktop"] [data-sound=listen] .sd-sound-label')).toHaveText('Listen first');
});

test('on a phone the confirm is a sheet: a scrim tap and a swipe down keep it ranked', async ({ browser }) => {
  const context = await browser.newContext({ viewport: PHONE, hasTouch: true });
  const page = await context.newPage();
  await open(page, 'kind=voice&confirm=1', PHONE);
  const sheet = page.getByRole('dialog', { name: 'Listen first?' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Keep it ranked' })).toBeFocused();
  await expect(sheet.locator('.ui-icon-button')).toBeHidden();
  await page.waitForTimeout(600); // the sheet slides in
  const box = (await page.locator('[data-testid=sheet-grabber]').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 160, { steps: 6 });
  await page.mouse.up();
  await expect(sheet).toHaveCount(0);
  await open(page, 'kind=voice&confirm=1', PHONE);
  await page.locator('[data-testid=sheet-scrim]').click({ position: { x: 190, y: 40 } });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await context.close();
});

test('the explain sheet lists three rows for a voice and four for a clarinet', async ({ page }) => {
  await open(page, 'kind=voice&explain=1', PHONE);
  await expect(page.locator('.sd-explain-row')).toHaveCount(3);
  await open(page, 'kind=instrument&explain=1', PHONE);
  await expect(page.locator('.sd-explain-row')).toHaveCount(4);
});

test('the dock button names are the full names and nothing scrolls sideways on a phone', async ({ page }) => {
  await open(page, 'kind=instrument', PHONE);
  const names = await page.locator('[data-story="phone"] .sd-dock-button').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  expect(names).toEqual(['Listen first', 'Hear the tempo', 'Hear the key']);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const targets = await page.locator('[data-story="phone"] .sd-dock-button, [data-story="phone"] .ui-info-button').evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return Math.min(r.width, r.height);
    }),
  );
  for (const t of targets) expect(t).toBeGreaterThanOrEqual(44);
});

test('the live caption bars move, and stand still under reduced motion', async ({ page }) => {
  await open(page, 'kind=voice&playing=reference');
  const bar = page.locator('[data-story="desktop"] .sd-eq i').first();
  await expect.poll(() => bar.evaluate((e) => getComputedStyle(e).animationName)).toBe('sd-eq-bounce');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => bar.evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
});

const SCREENS: readonly [string, string, typeof DESKTOP, string?][] = [
  ['scan-voice-ranked', 'kind=voice&playing=reference', DESKTOP, 'popover'],
  ['scan-instrument', 'kind=instrument&playing=reference', DESKTOP],
  ['scan-listen', 'kind=voice&ranked=0&playing=listen&caption=bar', DESKTOP],
  ['scan-confirm', 'kind=voice&confirm=1', DESKTOP],
  ['scan-voice-ranked', 'kind=voice&playing=reference', PHONE],
  ['scan-instrument', 'kind=instrument&playing=reference', PHONE],
  ['scan-listen', 'kind=voice&ranked=0&playing=listen&caption=bar', PHONE],
  ['scan-confirm', 'kind=voice&confirm=1', PHONE],
  ['scan-explain', 'kind=voice&explain=1', PHONE],
  ['scan-explain-clarinet', 'kind=instrument&explain=1', PHONE],
];

test('screenshots, light and dark, desktop and phone', async ({ page }) => {
  for (const [name, query, size, extra] of SCREENS) {
    for (const theme of ['light', 'dark']) {
      await open(page, `${query}&theme=${theme}`, size);
      if (extra === 'popover') await info(page).click();
      await page.waitForTimeout(600); // overlays finish sliding in
      await page.screenshot({ path: join(SHOTS, `${name}-${size === PHONE ? 'phone' : 'desktop'}-${theme}.png`) });
    }
  }
});
