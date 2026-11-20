import { chromium } from '@playwright/test';
const base = 'http://127.0.0.1:5300/#/credits';
const out = process.argv[2];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const cases = [
  ['desktop', { width: 1440, height: 900 }, 'light'],
  ['desktop', { width: 1440, height: 900 }, 'dark'],
  ['phone', { width: 390, height: 844 }, 'light'],
  ['phone', { width: 390, height: 844 }, 'dark'],
];
for (const [name, viewport, scheme] of cases) {
  const ctx = await browser.newContext({ viewport, colorScheme: scheme, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="screen-credits"]', { timeout: 15000 }).catch(() => errors.push('no credits screen'));
  const card = page.locator('.cred-card', { hasText: 'Voices: synthesised' });
  await card.scrollIntoViewIfNeeded().catch(() => {});
  await page.screenshot({ path: `${out}/credits-${name}-${scheme}.png`, fullPage: true });
  const links = await page.$$eval('.cred-card a[href^="./LICENSES/"]', (as) => as.map((a) => a.getAttribute('href')));
  console.log(name, scheme, JSON.stringify(links), errors.join(' | ') || 'no page errors');
  await ctx.close();
}
await browser.close();
