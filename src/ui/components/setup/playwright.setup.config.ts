// Setup controls browser suite: the controls on their story page, served by the Vite dev server.
//   pnpm exec playwright test -c src/ui/components/setup/playwright.setup.config.ts
// Screenshots go to docs/redesign/shots-build/setup-controls/ (08-plan rule 5).
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const executablePath = process.env['PW_CHROMIUM_PATH'] ?? '/opt/pw-browsers/chromium';
export const SETUP_STORY_PORT = 5247;

export default defineConfig({
  testDir: '.',
  testMatch: /setup\.spec\.ts$/,
  outputDir: join(process.cwd(), 'test-results', 'setup-controls-pw'),
  reporter: 'list',
  timeout: 60_000,
  workers: 1,
  webServer: {
    command: `pnpm exec vite --port ${SETUP_STORY_PORT} --strictPort`,
    url: `http://localhost:${SETUP_STORY_PORT}/src/ui/components/setup/story/index.html`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
  use: { baseURL: `http://localhost:${SETUP_STORY_PORT}` },
  projects: [
    {
      name: 'chromium-setup',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { executablePath, args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
      },
    },
  ],
});
