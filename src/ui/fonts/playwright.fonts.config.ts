// Font suite (tokens package): the production build, served from its own origin, makes no font request elsewhere and
// the three faces load.
//   pnpm exec playwright test -c src/ui/fonts/playwright.fonts.config.ts
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const executablePath = process.env['PW_CHROMIUM_PATH'] ?? '/opt/pw-browsers/chromium';

export default defineConfig({
  testDir: '.',
  testMatch: /fonts\.spec\.ts$/,
  globalSetup: './fonts.setup.ts',
  outputDir: join(process.cwd(), 'test-results', 'fonts-pw'),
  reporter: 'list',
  timeout: 60_000,
  workers: 1,
  projects: [
    {
      name: 'chromium-fonts',
      use: { ...devices['Desktop Chrome'], launchOptions: { executablePath, args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } },
    },
  ],
});
