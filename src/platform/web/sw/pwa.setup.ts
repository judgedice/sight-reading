// Global setup for the P19 Playwright suite: builds the app with the shipped config (`base: './'`) into test-results/,
// so the repository's dist/ is not touched. The spec then serves that build under a subpath on another origin.
import { execFileSync } from 'node:child_process';
import { PWA_DIST } from './pwa.paths.ts';

export default function globalSetup(): void {
  execFileSync('pnpm', ['exec', 'vite', 'build', '--base', './', '--outDir', PWA_DIST, '--emptyOutDir'], {
    stdio: 'inherit',
    timeout: 300_000,
  });
}
