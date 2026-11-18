// dist/ must boot from another origin under a subpath, with no absolute /assets URLs
// and no third-party requests (01 section 13.4 "Portability", P0a acceptance).
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { expect, test } from '@playwright/test';

const dist = join(process.cwd(), 'dist');
const prefix = '/some/sub/path/';
const types: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
};

let server: Server;
let origin = '';

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (!url.pathname.startsWith(prefix)) {
      res.writeHead(404).end();
      return;
    }
    let rel = url.pathname.slice(prefix.length);
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    rel = normalize(rel);
    const file = join(dist, rel);
    if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) {
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

test('built index.html has no absolute asset URLs', () => {
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  expect(html).not.toMatch(/(?:src|href)="\/(?!\/)/);
  expect(html).toMatch(/src="\.\/assets\//);
});

test('dist boots from another origin under a subpath, same-origin requests only', async ({ page }) => {
  const foreign: string[] = [];
  page.on('request', (req) => {
    const u = req.url();
    if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')) foreign.push(u);
  });
  const failed: string[] = [];
  page.on('response', (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });
  await page.goto(`${origin}${prefix}`);
  await expect(page.getByTestId('app-placeholder')).toBeVisible();
  expect(foreign).toEqual([]);
  expect(failed).toEqual([]);
});
