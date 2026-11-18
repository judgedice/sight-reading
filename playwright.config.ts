import { defineConfig, devices } from '@playwright/test';

// Chromium is preinstalled; no browser download. Override with PW_CHROMIUM_PATH.
const executablePath = process.env['PW_CHROMIUM_PATH'] ?? '/opt/pw-browsers/chromium';
const port = Number(process.env['E2E_PORT'] ?? 4173);

const chromiumLaunch = {
  executablePath,
  args: ['--no-sandbox'],
};

const audioArgs = [
  '--no-sandbox',
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  ...(process.env['E2E_FAKE_AUDIO_WAV']
    ? [`--use-file-for-fake-audio-capture=${process.env['E2E_FAKE_AUDIO_WAV']}%noloop`]
    : []),
];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}/`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `pnpm build && pnpm exec vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions: chromiumLaunch },
    },
    {
      name: 'chromium-audio',
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['microphone'],
        launchOptions: { executablePath, args: audioArgs },
      },
    },
    // WebKit projects need a WebKit install (CI only; not available in the agent sandbox).
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'webkit-iphone', use: { ...devices['iPhone 14'] } },
    { name: 'webkit-ipad', use: { ...devices['iPad Pro 11'] } },
  ],
});
