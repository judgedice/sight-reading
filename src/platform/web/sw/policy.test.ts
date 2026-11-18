import { describe, expect, it } from 'vitest';
import { relativeToScope, routeFor } from './policy.ts';

const SCOPE = 'https://example.test/some/sub/path/';
const PRECACHED = new Set(['index.html', 'assets/main-C2tbDq1h.js', 'icons/icon-192.png', 'manifest.webmanifest']);
const get = (path: string, mode?: string) => ({ method: 'GET', url: `${SCOPE}${path}`, ...(mode ? { mode } : {}) });
const route = (req: { method: string; url: string; mode?: string }) => routeFor(req, SCOPE, PRECACHED);

describe('routeFor: corpus files marked no-cache revalidate on every load', () => {
  it.each(['corpus/v1/index.json', 'corpus/v1/withdrawn.json'])('%s is network-first with a stale fallback', (path) => {
    expect(route(get(path))).toBe('revalidate');
  });

  it('does not treat a hashed manifest as no-cache', () => {
    expect(route(get('corpus/v1/manifest.051906f6e1.json'))).toBe('hashed');
  });
});

describe('routeFor: hashed files are cache-first', () => {
  it.each([
    'corpus/v1/manifest.051906f6e1.json',
    'corpus/v1/shard-L01-01.013350c343.json',
    'corpus/v1/attributions.d200dc8b90.json',
    'assets/notation-D3B0OQk6.js',
    'assets/bravura-CBWYXOFh.woff2',
  ])('%s', (path) => {
    expect(route(get(path))).toBe('hashed');
  });

  it('a precached Vite asset is served from the precache, not the hashed cache', () => {
    expect(route(get('assets/main-C2tbDq1h.js'))).toBe('precache');
  });
});

describe('routeFor: the app shell is precached', () => {
  it('the scope root maps to index.html', () => {
    expect(route({ method: 'GET', url: SCOPE, mode: 'navigate' })).toBe('precache');
  });

  it('a precached icon and the manifest are precache hits', () => {
    expect(route(get('icons/icon-192.png'))).toBe('precache');
    expect(route(get('manifest.webmanifest'))).toBe('precache');
  });
});

describe('routeFor: navigation and bypass', () => {
  it('an uncached top-level navigation goes network-first with the shell as fallback', () => {
    expect(route(get('some/deep/page.html', 'navigate'))).toBe('navigate');
  });

  it('a non-navigation same-origin request the worker does not own is bypassed', () => {
    expect(route(get('unknown.json'))).toBe('bypass');
  });

  it('non-GET requests are bypassed', () => {
    expect(route({ method: 'POST', url: `${SCOPE}corpus/v1/index.json` })).toBe('bypass');
  });

  it('a cross-origin request is bypassed, even when its path looks like a corpus file', () => {
    expect(route({ method: 'GET', url: 'https://cdn.example.org/some/sub/path/corpus/v1/manifest.051906f6e1.json' })).toBe('bypass');
  });

  it('a same-origin request outside the scope is bypassed', () => {
    expect(route({ method: 'GET', url: 'https://example.test/assets/x-AbCdEf.js' })).toBe('bypass');
  });

  it('a malformed URL is bypassed rather than thrown', () => {
    expect(route({ method: 'GET', url: 'http://[bad' })).toBe('bypass');
  });

  it('a sibling path that shares the scope prefix is outside the scope', () => {
    expect(route({ method: 'GET', url: 'https://example.test/some/sub/pathology/assets/x-AbCdEf.js' })).toBe('bypass');
  });
});

describe('relativeToScope', () => {
  it('returns the path under the scope, and index.html for the root', () => {
    expect(relativeToScope('/some/sub/path/assets/a.js', '/some/sub/path/')).toBe('assets/a.js');
    expect(relativeToScope('/some/sub/path/', '/some/sub/path/')).toBe('index.html');
    expect(relativeToScope('/other/', '/some/sub/path/')).toBeNull();
  });
});
