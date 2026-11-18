// Shared paths for the P19 Playwright suite. The build output lives under test-results/ (gitignored).
import { join } from 'node:path';

/** Where the setup step writes the production build. */
export const PWA_DIST = join(process.cwd(), 'test-results', 'pwa-dist');
/** The subpath the build is served under. Any subpath works: the build uses relative URLs. */
export const PWA_PREFIX = '/some/sub/path/';
