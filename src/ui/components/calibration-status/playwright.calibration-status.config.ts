// calibration-status components browser suite: the components on their story page, served by the Vite dev server.
//   pnpm exec playwright test -c src/ui/components/calibration-status/playwright.calibration-status.config.ts
// Screenshots go to docs/redesign/shots-build/calibration-status-components/.
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const executablePath = process.env['PW_CHROMIUM_PATH'] ?? '/opt/pw-browsers/chromium';
export const CAL_STATUS_STORY_PORT = 5311;

export default defineConfig({
  testDir: '.',
  testMatch: /calibration-status\.spec\.ts$/,
  outputDir: join(process.cwd(), 'test-results', 'calibration-status-components-pw'),
  reporter: 'list',
  timeout: 60_000,
  workers: 1,
  webServer: {
    command: `pnpm exec vite --port ${CAL_STATUS_STORY_PORT} --strictPort`,
    url: `http://localhost:${CAL_STATUS_STORY_PORT}/src/ui/components/calibration-status/story/index.html`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
  use: { baseURL: `http://localhost:${CAL_STATUS_STORY_PORT}` },
  projects: [
    {
      name: 'chromium-calibration-status',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { executablePath, args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
      },
    },
  ],
});
