// Tokens package acceptance: on the production build no font is requested from another origin, the preload links match
// the files the page uses, and document.fonts reports Source Serif 4, Inter and the music-text face as loaded.
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { expect, test } from '@playwright/test';
import { FONTS_DIST } from './fonts.setup.ts';

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
    let rel = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '');
    if (rel === '' || rel.startsWith('..')) rel = 'index.html';
    let file = join(FONTS_DIST, rel);
    if (!existsSync(file) || !statSync(file).isFile()) file = join(FONTS_DIST, 'index.html');
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('no font request leaves the origin, and the three faces load', async ({ page }) => {
  const requests: { url: string; type: string }[] = [];
  page.on('request', (r) => requests.push({ url: r.url(), type: r.resourceType() }));
  await page.goto(`${origin}/#/practice`);
  await page.evaluate(() => document.fonts.ready);
  // Source Serif 4 is used by the titles on every screen; load all three explicitly so the check does not depend on a screen.
  await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load('600 34px "Source Serif 4"'),
      document.fonts.load('400 16px "Inter"'),
      document.fonts.load('16px "Sightread Music Text"', '♩♪♭♮♯'),
    ]);
  });

  const fontRequests = requests.filter((r) => r.type === 'font' || /\.woff2?(\?|$)/.test(r.url));
  expect(fontRequests.length).toBeGreaterThanOrEqual(3);
  for (const r of requests) expect(new URL(r.url).origin, `request to another origin: ${r.url}`).toBe(origin);

  const check = await page.evaluate(() => ({
    display: document.fonts.check('600 34px "Source Serif 4"'),
    ui: document.fonts.check('16px Inter'),
    music: document.fonts.check('16px "Sightread Music Text"', '♩♪♭♮♯'),
    loaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replaceAll('"', '')),
    attr: document.documentElement.getAttribute('data-fonts'),
  }));
  expect(check.display).toBe(true);
  expect(check.ui).toBe(true);
  expect(check.music).toBe(true);
  // check() is also true for a family that was never declared, so require the declared faces to be loaded.
  expect(check.loaded).toEqual(expect.arrayContaining(['Source Serif 4', 'Inter', 'Sightread Music Text']));
  expect(check.attr).toBeNull();
});

test('the preload links point at the files the stylesheet declares, with crossorigin', async ({ page }) => {
  const fetched: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('.woff2')) fetched.push(r.url());
  });
  await page.goto(`${origin}/`);
  await page.evaluate(() => document.fonts.ready);
  const links = await page.evaluate(() =>
    [...document.querySelectorAll('link[rel="preload"][as="font"]')].map((l) => ({ href: (l as HTMLLinkElement).href, cross: l.hasAttribute('crossorigin'), type: l.getAttribute('type') })),
  );
  expect(links).toHaveLength(3);
  for (const l of links) {
    expect(l.cross).toBe(true);
    expect(l.type).toBe('font/woff2');
    expect(new URL(l.href).origin).toBe(origin);
  }
  for (const l of links) expect(fetched).toContain(l.href);
});

test('serif titles, warm paper and phone type sizes come from the tokens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/`);
  const v = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return { h1: cs.getPropertyValue('--type-h1-size').trim(), bg: cs.getPropertyValue('--bg').trim().toUpperCase(), family: cs.fontFamily, tnum: getComputedStyle(document.documentElement).getPropertyValue('--font-features').trim() };
  });
  expect(v.h1).toBe('30px');
  expect(v.bg).toBe('#F4F1EA');
  expect(v.family).toContain('Inter');
  expect(v.tnum).toBe('"cv11", "ss01"');
  await page.setViewportSize({ width: 1440, height: 900 });
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--type-h1-size').trim())).toBe('34px');
});
