// Setup-screen regression (Key select, Time segments, Random chips). Builds the production app and serves it with
// `vite preview`; no microphone is needed (onboarding declines it and the takes are never played).
//   pnpm exec playwright test -c e2e/setup/playwright.setup.config.ts
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

process.env['E2E_SETUP'] = '1';

const executablePath = process.env['PW_CHROMIUM_PATH'] ?? '/opt/pw-browsers/chromium';
const port = Number(process.env['E2E_SETUP_PORT'] ?? 4197);
const launchOptions = { executablePath, args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] };

export default defineConfig({
  testDir: '.',
  testMatch: /\.spec\.ts$/,
  outputDir: join(process.cwd(), 'test-results', 'setup-pw'),
  reporter: 'list',
  timeout: 120_000,
  workers: 1,
  use: { baseURL: `http://localhost:${port}/`, trace: 'retain-on-failure' },
  webServer: {
    command: `pnpm exec vite build --outDir test-results/dist-setup --emptyOutDir && pnpm exec vite preview --outDir test-results/dist-setup --port ${port} --strictPort`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, launchOptions } },
    { name: 'iphone', use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, launchOptions } },
  ],
});
