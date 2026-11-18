// Design QA (04 section 13.1, D13): axe on every route in both themes, tap targets at a coarse pointer, reduced motion,
// grayscale distinctness and the performance toolbar on the narrowest phones. Served by the Vite dev server because
// #/dev/components exists only there. Chromium with a fake microphone (silence): the checks need the screens, not takes.
//   pnpm exec playwright test -c e2e/design/playwright.design.config.ts
// axe-core comes from node_modules (needs the dependency, see docs/BUILD-NOTES.md) or AXE_CORE_PATH.
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { loadLoopHelpers } from '../loop/bundle.ts';

process.env['E2E_DESIGN'] = '1';

const WAV = join(process.cwd(), 'test-results', 'design-e2e', 'fake-mic.wav');
const executablePath = process.env['PW_CHROMIUM_PATH'] ?? '/opt/pw-browsers/chromium';
const port = Number(process.env['E2E_DESIGN_PORT'] ?? 4197);
const h = await loadLoopHelpers();
h.writeSilentWav(WAV);

const launchOptions = {
  executablePath,
  args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${WAV}%noloop`],
};
const desktop = { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } };
const phone = (width: number, height: number) => ({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

export default defineConfig({
  testDir: '.',
  testMatch: /\.spec\.ts$/,
  outputDir: join(process.cwd(), 'test-results', 'design-pw'),
  reporter: 'list',
  timeout: 240_000,
  workers: 1,
  use: { baseURL: `http://localhost:${port}/`, trace: 'retain-on-failure', permissions: ['microphone'], launchOptions },
  webServer: {
    command: `pnpm exec vite --port ${port} --strictPort`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: 'desktop-light', use: { ...desktop, colorScheme: 'light' } },
    { name: 'desktop-dark', use: { ...desktop, colorScheme: 'dark' } },
    { name: 'iphone-light', use: { ...phone(390, 844), colorScheme: 'light' } },
    { name: 'iphone-dark', use: { ...phone(390, 844), colorScheme: 'dark' } },
    { name: 'phone-narrow', use: { ...phone(320, 568), colorScheme: 'light' } },
    { name: 'iphone-reduced-motion', use: { ...phone(390, 844), colorScheme: 'light', reducedMotion: 'reduce' } },
  ],
});
