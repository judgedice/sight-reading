// IOS7 and the IOS2 browser check. Chromium needs no microphone: the synthetic source replaces getUserMedia.
//   pnpm exec playwright test -c e2e/synthetic/playwright.synthetic.config.ts
// WebKit (CI; not installed in the agent sandbox): add --project=webkit.
import { defineConfig, devices } from '@playwright/test';

const executablePath = process.env['PW_CHROMIUM_PATH'] ?? '/opt/pw-browsers/chromium';

export default defineConfig({
  testDir: '.',
  reporter: 'list',
  timeout: 120_000,
  workers: 1,
  projects: [
    { name: 'chromium-synthetic', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
