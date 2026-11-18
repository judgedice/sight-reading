// P19 PWA suite: the production build served from another origin under a subpath, with third-party network blocked.
//   pnpm exec playwright test -c src/platform/web/sw/playwright.pwa.config.ts
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { webkitProjects } from '../../../../e2e/webkit.ts';

const executablePath = process.env['PW_CHROMIUM_PATH'] ?? '/opt/pw-browsers/chromium';

export default defineConfig({
  testDir: '.',
  testMatch: /pwa\.spec\.ts$/,
  globalSetup: './pwa.setup.ts',
  outputDir: join(process.cwd(), 'test-results', 'pwa-pw'),
  reporter: 'list',
  timeout: 120_000,
  workers: 1,
  use: { trace: 'retain-on-failure' },
  projects: [
    {
      name: 'chromium-pwa',
      use: { ...devices['Desktop Chrome'], launchOptions: { executablePath, args: ['--no-sandbox'] } },
    },
    // Service worker and cache behaviour on WebKit (IOS_WEBKIT=1).
    ...webkitProjects(['desktop']),
  ],
});
