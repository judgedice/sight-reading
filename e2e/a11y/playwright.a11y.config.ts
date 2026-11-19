// Accessibility and design QA (08-plan package qa): every screen walked at 1440 x 900, 1280 x 800 and 390 x 844 in
// light, dark and high contrast, plus reduced motion, with a fake microphone per project so one take can be played.
//   pnpm exec playwright test -c e2e/a11y/playwright.a11y.config.ts
//   pnpm exec playwright test -c e2e/a11y/playwright.a11y.config.ts --project=p390-light      (one project)
// Served by the Vite dev server (#/dev/components exists only there). High contrast projects force
// data-contrast="high" on <html> from the first paint (an init script), so onboarding is covered too; the settings switch
// itself is covered by the settings tests.
import { join } from 'node:path';
import { defineConfig, type Project } from '@playwright/test';
import { loadLoopHelpers } from '../loop/bundle.ts';

process.env['E2E_A11Y'] = '1';

const executablePath = process.env['PW_CHROMIUM_PATH'] ?? '/opt/pw-browsers/chromium';
const port = Number(process.env['E2E_A11Y_PORT'] ?? 4198);
const dir = join(process.cwd(), 'test-results', 'a11y-e2e');
const h = await loadLoopHelpers();

type Size = { name: string; width: number; height: number; phone: boolean };
const SIZES: Size[] = [
  { name: 'd1440', width: 1440, height: 900, phone: false },
  { name: 'd1280', width: 1280, height: 800, phone: false },
  { name: 'p390', width: 390, height: 844, phone: true },
];
type Look = { name: string; scheme: 'light' | 'dark'; reduced: boolean };
const LOOKS: Look[] = [
  { name: 'light', scheme: 'light', reduced: false },
  { name: 'dark', scheme: 'dark', reduced: false },
  { name: 'hc', scheme: 'light', reduced: false },
  { name: 'hcdark', scheme: 'dark', reduced: false },
  { name: 'reduced', scheme: 'light', reduced: true },
];

const projects: Project[] = [];
for (const s of SIZES) {
  for (const l of LOOKS) {
    // High contrast in dark only on the two extremes; reduced motion on desktop 1440 and the phone.
    if (l.name === 'hcdark' && s.name === 'd1280') continue;
    if (l.name === 'reduced' && s.name === 'd1280') continue;
    const name = `${s.name}-${l.name}`;
    const wav = join(dir, `${name}.wav`);
    h.writeSilentWav(wav);
    projects.push({
      name,
      use: {
        viewport: { width: s.width, height: s.height },
        deviceScaleFactor: 1,
        isMobile: s.phone,
        hasTouch: s.phone,
        colorScheme: l.scheme,
        reducedMotion: l.reduced ? 'reduce' : 'no-preference',
        permissions: ['microphone'],
        launchOptions: {
          executablePath,
          args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`],
        },
      },
    });
  }
}

export default defineConfig({
  testDir: '.',
  testMatch: /\.spec\.ts$/,
  outputDir: join(process.cwd(), 'test-results', 'a11y-pw'),
  reporter: 'list',
  timeout: 300_000,
  workers: Number(process.env['E2E_A11Y_WORKERS'] ?? 3),
  use: { baseURL: `http://localhost:${port}/`, trace: 'retain-on-failure' },
  webServer: {
    command: `pnpm exec vite --port ${port} --strictPort`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects,
});
