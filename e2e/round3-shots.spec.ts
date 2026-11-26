// Round 3 screenshots (docs/screenshots/round3/): every wizard step and stage, the timing fallback, Home in Practice
// and in Ranked, the cover, the try strip and results, at 1440 x 900 and 390 x 844, light and dark. Not part of the
// default run: E2E_ROUND3_SHOTS=1 pnpm exec playwright test e2e/round3-shots.spec.ts --project=chromium --trace off
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { LOOP_T0_SEC } from './loop/flow.ts';
import { writeToneWav } from './loop/trail.ts';

test.skip(process.env['E2E_ROUND3_SHOTS'] !== '1', 'set E2E_ROUND3_SHOTS=1');

const WAV = join(process.cwd(), 'test-results', 'round3-shots', 'g3.wav');
writeToneWav(WAV, 55, 60);
const OUT = join(process.cwd(), 'docs', 'screenshots', 'round3');
mkdirSync(OUT, { recursive: true });

const executablePath = process.env['PW_CHROMIUM_PATH'] ?? '/opt/pw-browsers/chromium';
test.use({
  launchOptions: {
    executablePath,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${WAV}`],
  },
});
test.describe.configure({ mode: 'serial' });

const LOOKS = [
  { name: 'desktop-light', width: 1440, height: 900, scheme: 'light' as const, mobile: false },
  { name: 'desktop-dark', width: 1440, height: 900, scheme: 'dark' as const, mobile: false },
  { name: 'phone-light', width: 390, height: 844, scheme: 'light' as const, mobile: true },
  { name: 'phone-dark', width: 390, height: 844, scheme: 'dark' as const, mobile: true },
];

async function open(browser: Browser, look: (typeof LOOKS)[number]): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: look.width, height: look.height },
    deviceScaleFactor: 1,
    isMobile: look.mobile,
    hasTouch: look.mobile,
    colorScheme: look.scheme,
    permissions: ['microphone'],
    baseURL: test.info().project.use.baseURL,
  });
  return context.newPage();
}

for (const look of LOOKS) {
  test(`round 3 screens, ${look.name}`, async ({ browser }) => {
    test.setTimeout(300_000);
    const page = await open(browser, look);
    const shot = async (name: string): Promise<void> => {
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(OUT, `${name}-${look.name}.png`), fullPage: false });
    };
    await page.goto(`./?testClock=1&testClockSec=${LOOP_T0_SEC}`);
    await expect(page.getByTestId('screen-welcome')).toBeVisible({ timeout: 60_000 });
    await shot('wizard-0-welcome');
    await page.getByRole('button', { name: 'Get started' }).click();
    await shot('wizard-1-instrument');
    await page.getByRole('radio', { name: /^Baritone voice/ }).check();
    await shot('wizard-1-instrument-picked');
    await page.getByRole('button', { name: 'Next: sound check' }).click();
    await expect(page.getByTestId('ob-mic')).toBeVisible();
    await shot('wizard-2a-sound-mic');
    await page.getByRole('button', { name: 'Allow microphone' }).click();
    await expect(page.getByTestId('ob-hear')).toBeVisible({ timeout: 15_000 });
    await shot('wizard-2b-sound-hear-listening');
    await expect(page.getByText('We hear you clearly.')).toBeVisible({ timeout: 20_000 });
    await shot('wizard-2b-sound-hear');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByTestId('calibration-card')).toBeVisible({ timeout: 15_000 });
    await shot('wizard-2c-sound-timing');
    // The fake microphone sings, so it never hears the clicks: the fallback shows, with why.
    await page.getByRole('button', { name: 'Start timing check' }).click();
    await expect(page.getByTestId('cal-fail')).toBeVisible({ timeout: 60_000 });
    await shot('wizard-2d-sound-timing-fallback');
    await page.getByRole('button', { name: 'Skip for now' }).click();
    await expect(page.getByTestId('ob-ready')).toBeVisible();
    await shot('wizard-3-ready');
    await page.getByRole('button', { name: 'Go to Home' }).click();
    const home = page.getByTestId('screen-home');
    await expect(home).toBeVisible({ timeout: 15_000 });
    await shot('home-practice');

    // Ranked needs a measured timing check on this route: store one the way a passed check would, then reload.
    await page.evaluate(async () => {
      const sr = (window as unknown as { __sr: { session: { ensureAudio(): Promise<{ routeKey: string; outputMode: string }> } } }).__sr;
      const route = await sr.session.ensureAudio();
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('srt');
        req.onsuccess = () => {
          const tx = req.result.transaction('calibrations', 'readwrite');
          tx.objectStore('calibrations').put({
            routeKey: route.routeKey, platform: 'web', outputMode: route.outputMode, method: 'loopback', roundTripMs: 95, spreadMs: 1, clicksDetected: 10,
            clickLeakDb: -30, noiseFloorDb: -70, templates: {}, sanityToneCents: 1, aecSuspected: false, clockRateError: null, measuredAt: new Date().toISOString(), stale: false,
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
    });
    await page.reload();
    await expect(home).toBeVisible({ timeout: 30_000 });
    const ranked = home.locator('[data-setup-row="mode"]').getByRole('radio', { name: 'Ranked' });
    await expect(ranked).not.toHaveAttribute('aria-disabled', 'true', { timeout: 15_000 });
    await ranked.click();
    await expect(page.getByRole('button', { name: /^Start ranked try/ })).toBeVisible();
    await shot('home-ranked');
    await page.getByRole('button', { name: /^Start ranked try/ }).click();
    await expect(page.getByTestId('scan-cover')).toBeVisible({ timeout: 30_000 });
    await shot('cover-ranked');
    await page.getByRole('button', { name: 'Show the music' }).click();
    await expect(page.getByTestId('screen-practice.scan').locator('[data-expected-idx]').first()).toBeVisible({ timeout: 30_000 });
    await shot('read-through');
    await page.getByRole('button', { name: 'Start playing' }).click();
    await expect(page.getByTestId('try-mode')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1500);
    await shot('try-strip');
    const results = page.getByTestId('results-panel');
    await expect(results).toBeVisible({ timeout: 120_000 });
    await page.waitForTimeout(800);
    await shot('results');
    await page.context().close();
  });
}
