// P19 acceptance (definition of done item 5; 01 section 13.4 "Portability"; 05 W14).
// The build (base './') is served under a subpath on a different origin. Every request off that origin is aborted.
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { expect, test, type BrowserContext } from '@playwright/test';
import { PWA_DIST, PWA_PREFIX } from './pwa.paths.ts';

const types: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

let server: Server;
let origin = '';

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (!url.pathname.startsWith(PWA_PREFIX)) {
      res.writeHead(404).end();
      return;
    }
    let rel = url.pathname.slice(PWA_PREFIX.length);
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const file = join(PWA_DIST, normalize(rel));
    if (!file.startsWith(PWA_DIST) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  origin = `http://127.0.0.1:${addr.port}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

/** Only the build's own origin may answer; anything else is aborted and recorded. */
async function blockThirdParty(context: BrowserContext): Promise<string[]> {
  const blocked: string[] = [];
  await context.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(origin) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
    blocked.push(u);
    return route.abort();
  });
  return blocked;
}

test('the build has relative URLs, a manifest link, the apple-touch-icon and a relative precache list', () => {
  const html = readFileSync(join(PWA_DIST, 'index.html'), 'utf8');
  expect(html).not.toMatch(/(?:src|href)="\/(?!\/)/);
  expect(html).toMatch(/src="\.\/assets\//);
  expect(html).toMatch(/<link rel="manifest" href="\.\/manifest\.webmanifest">/);
  expect(html).toMatch(/<link rel="apple-touch-icon" href="\.\/icons\/apple-touch-icon\.png">/);
  expect(html).toMatch(/apple-mobile-web-app-status-bar-style/);

  const sw = readFileSync(join(PWA_DIST, 'sw.js'), 'utf8');
  const urls = [...sw.matchAll(/"url":"([^"]+)"/g)].map((m) => m[1]!);
  expect(urls).toContain('index.html');
  expect(urls.filter((u) => u.startsWith('/') || u.startsWith('http'))).toEqual([]);
  expect(urls.filter((u) => u.startsWith('corpus/'))).toEqual([]);
});

test('the worker registers under the subpath, controls the page, and the app reloads offline', async ({ context, page }) => {
  const blocked = await blockThirdParty(context);
  const failed: string[] = [];
  page.on('response', (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });

  await page.goto(`${origin}${PWA_PREFIX}`);
  await expect(page.getByTestId('screen-welcome')).toBeVisible({ timeout: 30_000 });

  // The composition root does not register the worker in this wave; the test registers it the way
  // src/platform/web/sw/register.ts does (relative script and scope).
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    await navigator.serviceWorker.ready;
    return registration.scope;
  });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 30_000 });
  await expect(page.getByTestId('screen-welcome')).toBeVisible({ timeout: 30_000 });

  // The no-cache corpus index and the precached shell are both in the caches the worker wrote.
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const meta = await caches.open('sightread-corpus-meta-v1');
    const metaUrls = (await meta.keys()).map((r) => new URL(r.url).pathname);
    const shell = names.find((n) => n.startsWith('sightread-precache-'));
    const shellUrls = shell ? (await (await caches.open(shell)).keys()).map((r) => new URL(r.url).pathname) : [];
    return { names, metaUrls, shellUrls };
  });
  expect(cached.names.some((n) => n.startsWith('sightread-precache-'))).toBe(true);
  expect(cached.shellUrls.some((p) => p.endsWith('/index.html'))).toBe(true);
  expect(cached.metaUrls.some((p) => p.endsWith('/corpus/v1/index.json'))).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('screen-welcome')).toBeVisible({ timeout: 30_000 });
  await context.setOffline(false);

  expect(blocked).toEqual([]);
  expect(failed.filter((f) => !f.startsWith('0 '))).toEqual([]);
});
