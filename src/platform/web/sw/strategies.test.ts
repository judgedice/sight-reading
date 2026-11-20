import { readdirSync, readFileSync } from 'node:fs';
import { matchesGlob } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  CACHE_NAMES,
  isSoundRequest,
  precacheAll,
  pruneOldPrecaches,
  respondSound,
  respondWith,
  revisionOf,
  type CacheLike,
  type CacheStorageLike,
  type StrategyDeps,
} from './strategies.ts';

/** An in-memory Cache API: keys are absolute URLs, values are responses cloned on read. */
class MemoryCache implements CacheLike {
  readonly entries = new Map<string, Response>();
  async match(request: string): Promise<Response | undefined> {
    return this.entries.get(request)?.clone();
  }
  async put(request: string, response: Response): Promise<void> {
    this.entries.set(request, response.clone());
  }
}

class MemoryStorage implements CacheStorageLike {
  readonly caches = new Map<string, MemoryCache>();
  async open(name: string): Promise<CacheLike> {
    let cache = this.caches.get(name);
    if (!cache) {
      cache = new MemoryCache();
      this.caches.set(name, cache);
    }
    return cache;
  }
  async keys(): Promise<string[]> {
    return [...this.caches.keys()];
  }
  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name);
  }
}

const SCOPE = 'https://example.test/some/sub/path/';
const PRECACHE = `${CACHE_NAMES.precachePrefix}abc`;
const url = (rel: string) => `${SCOPE}${rel}`;

function setup(network: (request: Request) => Promise<Response>) {
  const storage = new MemoryStorage();
  const fetchSpy = vi.fn(network);
  const deps: StrategyDeps = {
    caches: storage,
    fetch: fetchSpy,
    precacheName: PRECACHE,
    precacheUrl: (rel) => url(rel),
    precacheKey: (u) => (u === SCOPE ? url('index.html') : u),
  };
  return { storage, fetchSpy, deps };
}

const ok = (body: string) => new Response(body, { status: 200 });

describe('revalidate (corpus index.json, withdrawn.json)', () => {
  it('asks the network with no-cache and stores the answer', async () => {
    const { storage, fetchSpy, deps } = setup(async () => ok('v2'));
    const res = await respondWith('revalidate', new Request(url('corpus/v1/index.json')), deps);
    expect(await res.text()).toBe('v2');
    expect(fetchSpy.mock.calls[0]![0].cache).toBe('no-cache');
    expect(await (await storage.open(CACHE_NAMES.corpusMeta)).match(url('corpus/v1/index.json'))).toBeDefined();
  });

  it('serves the last good copy only when the network fails', async () => {
    const { storage, deps } = setup(async () => {
      throw new TypeError('offline');
    });
    await (await storage.open(CACHE_NAMES.corpusMeta)).put(url('corpus/v1/withdrawn.json'), ok('{"ids":[]}'));
    const res = await respondWith('revalidate', new Request(url('corpus/v1/withdrawn.json')), deps);
    expect(await res.text()).toBe('{"ids":[]}');
  });

  it('rethrows when offline with nothing cached', async () => {
    const { deps } = setup(async () => {
      throw new TypeError('offline');
    });
    await expect(respondWith('revalidate', new Request(url('corpus/v1/index.json')), deps)).rejects.toThrow('offline');
  });

  it('does not overwrite the stored copy with an error response', async () => {
    const { storage, deps } = setup(async () => new Response('gone', { status: 404 }));
    const res = await respondWith('revalidate', new Request(url('corpus/v1/index.json')), deps);
    expect(res.status).toBe(404);
    const meta = await storage.open(CACHE_NAMES.corpusMeta);
    expect(await meta.match(url('corpus/v1/index.json'))).toBeUndefined();
  });
});

describe('hashed (cache-first)', () => {
  it('a hit never reaches the network', async () => {
    const { storage, fetchSpy, deps } = setup(async () => ok('network'));
    await (await storage.open(CACHE_NAMES.hashed)).put(url('assets/x-AbCdEf.js'), ok('cached'));
    const res = await respondWith('hashed', new Request(url('assets/x-AbCdEf.js')), deps);
    expect(await res.text()).toBe('cached');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a miss fetches once and stores the success', async () => {
    const { storage, fetchSpy, deps } = setup(async () => ok('network'));
    await respondWith('hashed', new Request(url('corpus/v1/shard-L03-01.7c465221e3.json')), deps);
    await respondWith('hashed', new Request(url('corpus/v1/shard-L03-01.7c465221e3.json')), deps);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(storage.caches.has(CACHE_NAMES.hashed)).toBe(true);
  });
});

describe('precache and navigation', () => {
  it('a precached shell file is served from the precache', async () => {
    const { storage, fetchSpy, deps } = setup(async () => ok('network'));
    await (await storage.open(PRECACHE)).put(url('index.html'), ok('shell'));
    const res = await respondWith('precache', new Request(url('index.html')), deps);
    expect(await res.text()).toBe('shell');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a request for the scope root is answered from the precached index.html', async () => {
    const { storage, fetchSpy, deps } = setup(async () => ok('network'));
    await (await storage.open(PRECACHE)).put(url('index.html'), ok('shell'));
    const res = await respondWith('precache', new Request(SCOPE), deps);
    expect(await res.text()).toBe('shell');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a navigation goes to the network first', async () => {
    const { storage, deps } = setup(async () => ok('fresh'));
    await (await storage.open(PRECACHE)).put(url('index.html'), ok('shell'));
    const res = await respondWith('navigate', new Request(url('page')), deps);
    expect(await res.text()).toBe('fresh');
  });

  it('a navigation falls back to the precached shell when offline', async () => {
    const { storage, deps } = setup(async () => {
      throw new TypeError('offline');
    });
    await (await storage.open(PRECACHE)).put(url('index.html'), ok('shell'));
    const res = await respondWith('navigate', new Request(url('page')), deps);
    expect(await res.text()).toBe('shell');
  });
});

describe('install and activate', () => {
  it('precacheAll stores every entry and refuses a failed one', async () => {
    const storage = new MemoryStorage();
    await precacheAll(storage, PRECACHE, [url('index.html'), url('assets/a.js')], async (u) => ok(`body ${u}`));
    expect(storage.caches.get(PRECACHE)!.entries.size).toBe(2);

    await expect(
      precacheAll(storage, `${PRECACHE}-b`, [url('index.html')], async () => new Response('x', { status: 500 })),
    ).rejects.toThrow('precache');
  });

  it('pruneOldPrecaches drops old revisions and keeps the hashed and corpus caches', async () => {
    const storage = new MemoryStorage();
    for (const name of [`${CACHE_NAMES.precachePrefix}old`, PRECACHE, CACHE_NAMES.hashed, CACHE_NAMES.corpusMeta, CACHE_NAMES.sounds, 'sightread-sounds-v0', 'unrelated']) {
      await storage.open(name);
    }
    const removed = await pruneOldPrecaches(storage, PRECACHE);
    expect(removed).toEqual([`${CACHE_NAMES.precachePrefix}old`, 'sightread-sounds-v0']);
    expect(await storage.keys()).toEqual([PRECACHE, CACHE_NAMES.hashed, CACHE_NAMES.corpusMeta, CACHE_NAMES.sounds, 'unrelated']);
  });

  it('revisionOf changes when any entry changes and is stable otherwise', () => {
    const a = [{ url: 'index.html', revision: 'r1' }, { url: 'assets/a.js', revision: 'r2' }];
    expect(revisionOf(a)).toBe(revisionOf([...a]));
    expect(revisionOf(a)).not.toBe(revisionOf([{ url: 'index.html', revision: 'r1' }, { url: 'assets/a.js', revision: 'r3' }]));
    expect(revisionOf(a)).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('instrument sounds (round 2: cache-first at run time, never precached)', () => {
  it('isSoundRequest takes GETs of files under sounds/ in the scope, and nothing else', () => {
    expect(isSoundRequest({ method: 'GET', url: url('sounds/index.json') }, SCOPE)).toBe(true);
    expect(isSoundRequest({ method: 'get', url: url('sounds/voice-bass/Gs2.mp3') }, SCOPE)).toBe(true);
    expect(isSoundRequest({ method: 'POST', url: url('sounds/index.json') }, SCOPE)).toBe(false);
    expect(isSoundRequest({ method: 'GET', url: url('sounds/') }, SCOPE)).toBe(false);
    expect(isSoundRequest({ method: 'GET', url: url('assets/sounds/x.mp3') }, SCOPE)).toBe(false);
    expect(isSoundRequest({ method: 'GET', url: 'https://example.test/sounds/index.json' }, SCOPE)).toBe(false);
    expect(isSoundRequest({ method: 'GET', url: 'https://other.test/some/sub/path/sounds/index.json' }, SCOPE)).toBe(false);
    expect(isSoundRequest({ method: 'GET', url: 'not a url' }, SCOPE)).toBe(false);
  });

  it('a miss fetches once and stores a complete answer; a hit never reaches the network', async () => {
    const { deps, fetchSpy, storage } = setup(async () => ok('mp3'));
    const req = new Request(url('sounds/flute/C4.mp3'));
    expect(await (await respondSound(req, deps)).text()).toBe('mp3');
    expect(await (await respondSound(req, deps)).text()).toBe('mp3');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(storage.caches.get(CACHE_NAMES.sounds)?.entries.has(req.url)).toBe(true);
  });

  it('does not store a partial or failed answer, and rethrows offline with nothing cached', async () => {
    const partial = setup(async () => new Response('mp', { status: 206 }));
    await respondSound(new Request(url('sounds/flute/C4.mp3')), partial.deps);
    expect(partial.storage.caches.get(CACHE_NAMES.sounds)?.entries.size).toBe(0);
    const missing = setup(async () => new Response('', { status: 404 }));
    expect((await respondSound(new Request(url('sounds/kazoo/C4.mp3')), missing.deps)).status).toBe(404);
    expect(missing.storage.caches.get(CACHE_NAMES.sounds)?.entries.size).toBe(0);
    const offline = setup(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(respondSound(new Request(url('sounds/index.json')), offline.deps)).rejects.toThrow(TypeError);
  });

  it('no file in public/sounds matches the precache globs in vite.config.ts', () => {
    const root = fileURLToPath(new URL('../../../../', import.meta.url));
    const config = readFileSync(`${root}vite.config.ts`, 'utf8');
    const m = /globPatterns:\s*\[([^\]]*)\]/.exec(config);
    const globs = [...(m?.[1] ?? '').matchAll(/'([^']+)'/g)].map((g) => g[1] as string);
    expect(globs.length).toBeGreaterThan(0);
    const files = readdirSync(`${root}public/sounds`, { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => `${d.parentPath.slice(`${root}public/`.length).replace(/\\/g, '/')}/${d.name}`);
    expect(files.length).toBeGreaterThan(140);
    expect(files).toContain('sounds/index.json');
    for (const f of files) for (const g of globs) expect(matchesGlob(f, g), `${f} ~ ${g}`).toBe(false);
    // The globs do match the shell, so the check above is not vacuous.
    expect(globs.some((g) => matchesGlob('assets/index-abc.js', g))).toBe(true);
  });
});
