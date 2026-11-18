// The practice loop in Chromium with fake audio capture (PLAN definition of done item 3; 01 §13.4).
//   pnpm exec playwright test -c e2e/loop/playwright.loop.config.ts
// Builds the production app into test-results/dist-loop/ and serves it with `vite preview`. The fake microphone reads
// LOOP_WAV (test-results/loop-e2e/fake-mic.wav). Chromium reads that file afresh each time a stream opens, and with
// `?testClock=1` the app reopens the microphone right before each take's capture starts, so the spec writes the take's
// WAV (rendered by the P3 synth for the excerpt the page served) after the scan reveals the excerpt and before it
// presses Start playing. Bar 1 beat 1 sits LOOP_T0_SEC after the capture origin, and the RTL is 0.
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { loadLoopHelpers } from './bundle.ts';
import { webkitProjects } from '../webkit.ts';

// The specs need this config's build and fake microphone; the root config's e2e run skips them without this marker.
process.env['E2E_LOOP'] = '1';

export const LOOP_WAV = join(process.cwd(), 'test-results', 'loop-e2e', 'fake-mic.wav');
process.env['E2E_LOOP_WAV'] = LOOP_WAV;
const executablePath = process.env['PW_CHROMIUM_PATH'] ?? '/opt/pw-browsers/chromium';
const port = Number(process.env['E2E_LOOP_PORT'] ?? 4193);
const h = await loadLoopHelpers();
h.writeSilentWav(LOOP_WAV);

export default defineConfig({
  testDir: '.',
  testMatch: /\.spec\.ts$/,
  outputDir: join(process.cwd(), 'test-results', 'loop-pw'),
  reporter: 'list',
  timeout: 180_000,
  workers: 1,
  use: { baseURL: `http://localhost:${port}/`, trace: 'retain-on-failure' },
  webServer: {
    command: `pnpm exec vite build --outDir test-results/dist-loop --emptyOutDir && pnpm exec vite preview --outDir test-results/dist-loop --port ${port} --strictPort`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    // WebKit has no fake microphone: it runs the practise-without-listening flow only (IOS_WEBKIT=1).
    ...webkitProjects(['desktop', 'iphone'], { testMatch: /without-listening\.spec\.ts$/ }),
    {
      name: 'chromium-audio',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        permissions: ['microphone'],
        launchOptions: {
          executablePath,
          args: [
            '--no-sandbox',
            '--autoplay-policy=no-user-gesture-required',
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            `--use-file-for-fake-audio-capture=${LOOP_WAV}%noloop`,
          ],
        },
      },
    },
  ],
});
