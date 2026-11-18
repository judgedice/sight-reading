// IOS7 and the IOS2 browser check. Chromium needs no microphone: the synthetic source replaces getUserMedia.
//   pnpm exec playwright test -c e2e/synthetic/playwright.synthetic.config.ts
// The WebKit project is added when IOS_WEBKIT=1 (a WebKit install; CI sets it), as in e2e/ios.
import { defineConfig, devices } from '@playwright/test';
import { webkitProjects } from '../webkit.ts';

process.env['E2E_SYNTHETIC'] = '1';

const executablePath = process.env['PW_CHROMIUM_PATH'] ?? '/opt/pw-browsers/chromium';

export default defineConfig({
  testDir: '.',
  reporter: 'list',
  timeout: 120_000,
  workers: 1,
  projects: [
    { name: 'chromium-synthetic', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] } } },
    ...webkitProjects(['desktop']),
  ],
});
