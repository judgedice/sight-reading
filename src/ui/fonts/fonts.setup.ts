// Builds the app with the shipped config into test-results/, so the repository's dist/ is not touched.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

export const FONTS_DIST = join(process.cwd(), 'test-results', 'fonts-dist');

export default function globalSetup(): void {
  execFileSync('pnpm', ['exec', 'vite', 'build', '--base', './', '--outDir', FONTS_DIST, '--emptyOutDir'], { stdio: 'inherit', timeout: 300_000 });
}
