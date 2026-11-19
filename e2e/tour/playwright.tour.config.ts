// Screen tour (wave 3 review, design QA): the production build against the emitted corpus (public/corpus/v1), driven
// like a user in Chromium with fake audio capture, at desktop and iPhone sizes in light and dark themes. Every screen
// is captured into docs/screenshots/<project>/ at deviceScaleFactor 2.
//   pnpm exec playwright test -c e2e/tour/playwright.tour.config.ts
// The fake microphone reads TOUR_WAV; the spec writes each take's WAV after the scan reveals the excerpt (see
// e2e/loop/playwright.loop.config.ts for the test-clock mechanics).
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { loadLoopHelpers } from '../loop/bundle.ts';

process.env['E2E_TOUR'] = '1';

export const TOUR_WAV = join(process.cwd(), 'test-results', 'tour-e2e', 'fake-mic.wav');
process.env['E2E_TOUR_WAV'] = TOUR_WAV;
const executablePath = process.env['PW_CHROMIUM_PATH'] ?? '/opt/pw-browsers/chromium';
const port = Number(process.env['E2E_TOUR_PORT'] ?? 4196);
const h = await loadLoopHelpers();
h.writeSilentWav(TOUR_WAV);

const launchOptions = {
  executablePath,
  args: [
    '--no-sandbox',
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${TOUR_WAV}%noloop`,
  ],
};
const desktop = { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
const iphone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

export default defineConfig({
  testDir: '.',
  testMatch: /\.spec\.ts$/,
  outputDir: join(process.cwd(), 'test-results', 'tour-pw'),
  reporter: 'list',
  timeout: 300_000,
  workers: 1,
  use: { baseURL: `http://localhost:${port}/`, trace: 'retain-on-failure', permissions: ['microphone'], launchOptions },
  webServer: {
    command: `pnpm exec vite build --outDir test-results/dist-tour --emptyOutDir && pnpm exec vite preview --outDir test-results/dist-tour --port ${port} --strictPort`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    { name: 'desktop-light', use: { ...desktop, colorScheme: 'light' } },
    { name: 'desktop-dark', use: { ...desktop, colorScheme: 'dark' } },
    { name: 'iphone-light', use: { ...iphone, colorScheme: 'light' } },
    { name: 'iphone-dark', use: { ...iphone, colorScheme: 'dark' } },
  ],
});
