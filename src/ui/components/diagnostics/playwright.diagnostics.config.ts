// diagnostics components browser suite: the components on their story page, served by the Vite dev server.
//   pnpm exec playwright test -c src/ui/components/diagnostics/playwright.diagnostics.config.ts
// Screenshots go to docs/redesign/shots-build/diagnostics-components/.
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const executablePath = process.env['PW_CHROMIUM_PATH'] ?? '/opt/pw-browsers/chromium';
export const DIAGNOSTICS_STORY_PORT = 5312;

export default defineConfig({
  testDir: '.',
  testMatch: /diagnostics\.spec\.ts$/,
  outputDir: join(process.cwd(), 'test-results', 'diagnostics-components-pw'),
  reporter: 'list',
  timeout: 60_000,
  workers: 1,
  webServer: {
    command: `pnpm exec vite --port ${DIAGNOSTICS_STORY_PORT} --strictPort`,
    url: `http://localhost:${DIAGNOSTICS_STORY_PORT}/src/ui/components/diagnostics/story/index.html`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
  use: { baseURL: `http://localhost:${DIAGNOSTICS_STORY_PORT}` },
  projects: [
    {
      name: 'chromium-diagnostics',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { executablePath, args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
      },
    },
  ],
});
