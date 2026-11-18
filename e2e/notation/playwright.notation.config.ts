// Runs only the notation specs, without the app's webServer (they build their own page with esbuild).
// pnpm exec playwright test -c e2e/notation/playwright.notation.config.ts
import { defineConfig, devices } from '@playwright/test';
import { webkitProjects } from '../webkit.ts';

const executablePath = process.env['PW_CHROMIUM_PATH'] ?? '/opt/pw-browsers/chromium';

export default defineConfig({
  testDir: '.',
  reporter: 'list',
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions: { executablePath, args: ['--no-sandbox'] } },
    },
    // Pure rendering: runs in WebKit as is (IOS_WEBKIT=1).
    ...webkitProjects(['desktop', 'iphone']),
  ],
});
