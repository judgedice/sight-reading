import { describe, expect, it, vi } from 'vitest';
import {
  CACHE_NAMES,
  precacheAll,
  pruneOldPrecaches,
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
    for (const name of [`${CACHE_NAMES.precachePrefix}old`, PRECACHE, CACHE_NAMES.hashed, CACHE_NAMES.corpusMeta, 'unrelated']) {
      await storage.open(name);
    }
    const removed = await pruneOldPrecaches(storage, PRECACHE);
    expect(removed).toEqual([`${CACHE_NAMES.precachePrefix}old`]);
    expect(await storage.keys()).toEqual([PRECACHE, CACHE_NAMES.hashed, CACHE_NAMES.corpusMeta, 'unrelated']);
  });

  it('revisionOf changes when any entry changes and is stable otherwise', () => {
    const a = [{ url: 'index.html', revision: 'r1' }, { url: 'assets/a.js', revision: 'r2' }];
    expect(revisionOf(a)).toBe(revisionOf([...a]));
    expect(revisionOf(a)).not.toBe(revisionOf([{ url: 'index.html', revision: 'r1' }, { url: 'assets/a.js', revision: 'r3' }]));
    expect(revisionOf(a)).toMatch(/^[0-9a-f]{8}$/);
  });
});
