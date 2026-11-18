// S1 thin slice in Chromium with fake audio capture (01 §13.4, §15 S1).
//   pnpm exec playwright test -c e2e/slice/playwright.slice.config.ts
// Builds the app with `--mode slice` into test-results/dist-slice/ (the production dist/ stays clean) and serves it with
// `vite preview`. The fake-capture WAV is the slice excerpt rendered by the P3 flute synth with the S1 perturbations
// (e2e/slice/slice-performance.ts), placed so that bar 1 beat 1 falls at the testClock t0.
//
// Chromium starts the fake file when getUserMedia opens the device, not when the worklet's capture starts. Measured
// here (S1, headless Chromium 44.1 kHz): the median timing error of on-time notes ranged from -9 to +42 ms over 10 runs,
// centred near 0, so the file is placed with no extra lead. E2E_SLICE_LEAD_MS shifts the music later by that much.
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { loadNodeHelpers } from './bundle.ts';

// The spec needs this config's build and WAV; the root config's e2e run skips it without this marker.
process.env['E2E_SLICE'] = '1';

export const SLICE_WAV_LEAD_MS = Number(process.env['E2E_SLICE_LEAD_MS'] ?? 0);
const executablePath = process.env['PW_CHROMIUM_PATH'] ?? '/opt/pw-browsers/chromium';
const port = Number(process.env['E2E_SLICE_PORT'] ?? 4183);
const h = await loadNodeHelpers();
const wav = h.writeWav(join(process.cwd(), 'test-results', 'slice-e2e'), h.SLICE.testClockT0AfterCaptureSec + SLICE_WAV_LEAD_MS / 1000);

export default defineConfig({
  testDir: '.',
  testMatch: /slice\.spec\.ts$/,
  outputDir: join(process.cwd(), 'test-results', 'slice-pw'),
  reporter: 'list',
  timeout: 120_000,
  workers: 1,
  use: { baseURL: `http://localhost:${port}/` },
  webServer: {
    command: `pnpm exec vite build --mode slice --outDir test-results/dist-slice --emptyOutDir && pnpm exec vite preview --outDir test-results/dist-slice --port ${port} --strictPort`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
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
            `--use-file-for-fake-audio-capture=${wav}%noloop`,
          ],
        },
      },
    },
  ],
});
