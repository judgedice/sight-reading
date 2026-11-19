// Sounds components browser suite: the components on their story page, served by the Vite dev server.
//   pnpm exec playwright test -c src/ui/components/sounds/playwright.sounds.config.ts
// Screenshots go to docs/redesign/shots-build/sounds-components/ (08-plan rule 5).
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const executablePath = process.env['PW_CHROMIUM_PATH'] ?? '/opt/pw-browsers/chromium';
export const SOUNDS_STORY_PORT = 5231;

export default defineConfig({
  testDir: '.',
  testMatch: /sounds\.spec\.ts$/,
  outputDir: join(process.cwd(), 'test-results', 'sounds-components-pw'),
  reporter: 'list',
  timeout: 60_000,
  workers: 1,
  webServer: {
    command: `pnpm exec vite --port ${SOUNDS_STORY_PORT} --strictPort`,
    url: `http://localhost:${SOUNDS_STORY_PORT}/src/ui/components/sounds/story/index.html`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
  use: { baseURL: `http://localhost:${SOUNDS_STORY_PORT}` },
  projects: [
    {
      name: 'chromium-sounds',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { executablePath, args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
      },
    },
  ],
});
