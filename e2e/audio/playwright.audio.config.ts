// Chromium audio specs for the web audio backend (P11), with fake media capture from a testkit WAV.
// pnpm exec playwright test -c e2e/audio/playwright.audio.config.ts
// E2E_AUDIO_LONG=1 runs the 5 minute contiguity check instead of the 30 s one.
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { writeFakeCaptureWav } from './fake-capture-wav.ts';

const executablePath = process.env['PW_CHROMIUM_PATH'] ?? '/opt/pw-browsers/chromium';
const wav = writeFakeCaptureWav(join(process.cwd(), 'test-results', 'audio-e2e'));
const long = process.env['E2E_AUDIO_LONG'] === '1';

export default defineConfig({
  testDir: '.',
  reporter: 'list',
  timeout: long ? 420_000 : 90_000,
  workers: 1,
  projects: [
    {
      name: 'chromium-audio',
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['microphone'],
        launchOptions: {
          executablePath,
          args: [
            '--no-sandbox',
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            `--use-file-for-fake-audio-capture=${wav}`,
          ],
        },
      },
    },
  ],
});
