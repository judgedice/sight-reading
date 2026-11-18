// IOS6 layout and touch specs (05 section 7). Chromium runs them now with iPhone and iPad device emulation; the
// WebKit projects are added when IOS_WEBKIT=1 (a WebKit install, CI only). No webServer: the spec builds its page.
// pnpm exec playwright test -c e2e/ios/playwright.ios.config.ts
import { defineConfig, devices } from '@playwright/test';
import { webkitProjects } from '../webkit.ts';

const executablePath = process.env['PW_CHROMIUM_PATH'] ?? '/opt/pw-browsers/chromium';
const launchOptions = { executablePath, args: ['--no-sandbox'] };

// Device descriptors default to WebKit; the Chromium projects keep the touch and screen emulation only.
const asChromium = (d: (typeof devices)[string]) => ({ ...d, defaultBrowserType: 'chromium' as const, launchOptions });

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  reporter: 'list',
  projects: [
    { name: 'chromium-iphone', use: asChromium(devices['iPhone 14']) },
    { name: 'chromium-ipad', use: asChromium(devices['iPad Pro 11']) },
    ...webkitProjects(['iphone', 'ipad']),
  ],
});
