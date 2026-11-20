/**
 * Cache strategies for the service worker (P19). The Cache API and fetch are injected, so the Vitest suite drives the
 * same code the worker runs. Routing decisions live in `policy.ts`.
 */
import { relativeToScope, type Route } from './policy.ts';

/** The cache names. The precache name carries a revision, so an update writes a new cache and the old one is dropped. */
export const CACHE_NAMES = {
  precachePrefix: 'sightread-precache-',
  hashed: 'sightread-hashed-v1',
  corpusMeta: 'sightread-corpus-meta-v1',
  /**
   * Instrument sounds (`sounds/`, round 2): cached on first use, never precached (1.75 MB). Bump the version when the
   * sets are rebuilt under the same file names, so `index.json` and the samples are fetched again together.
   */
  sounds: 'sightread-sounds-v1',
} as const;

export interface CacheLike {
  match(request: string): Promise<Response | undefined>;
  put(request: string, response: Response): Promise<void>;
}

export interface CacheStorageLike {
  open(name: string): Promise<CacheLike>;
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
}

export interface StrategyDeps {
  readonly caches: CacheStorageLike;
  fetch(request: Request): Promise<Response>;
  /** The name of the precache for this build. */
  readonly precacheName: string;
  /** The precached URL for a relative path, for example 'index.html'. */
  readonly precacheUrl: (rel: string) => string;
  /** The precache key for a request URL. The scope root maps to index.html, so a navigation to it finds the shell. */
  readonly precacheKey: (url: string) => string;
}

/** Precache lookup: the install step stored the app shell under `precacheUrl(rel)`. */
async function fromPrecache(request: Request, deps: StrategyDeps): Promise<Response> {
  const cache = await deps.caches.open(deps.precacheName);
  const hit = await cache.match(deps.precacheKey(request.url));
  return hit ?? deps.fetch(request);
}

/** Cache-first for hashed files. A miss fetches once and stores the answer when it is a success. */
async function cacheFirst(request: Request, deps: StrategyDeps, cacheName: string): Promise<Response> {
  const cache = await deps.caches.open(cacheName);
  const hit = await cache.match(request.url);
  if (hit) return hit;
  const response = await deps.fetch(request);
  if (response.ok) await cache.put(request.url, response.clone());
  return response;
}

/**
 * Network first with no cache reuse on success (`no-cache`), and the last good copy only when the network fails. The
 * copy is refreshed on every successful fetch.
 */
async function revalidate(request: Request, deps: StrategyDeps): Promise<Response> {
  const cache = await deps.caches.open(CACHE_NAMES.corpusMeta);
  try {
    const response = await deps.fetch(new Request(request, { cache: 'no-cache' }));
    if (response.ok) await cache.put(request.url, response.clone());
    return response;
  } catch (error) {
    const stale = await cache.match(request.url);
    if (stale) return stale;
    throw error;
  }
}

/** Navigation: the network, then the precached shell when offline. */
async function navigate(request: Request, deps: StrategyDeps): Promise<Response> {
  try {
    return await deps.fetch(request);
  } catch (error) {
    const cache = await deps.caches.open(deps.precacheName);
    const shell = await cache.match(deps.precacheUrl('index.html'));
    if (shell) return shell;
    throw error;
  }
}

/**
 * True for a GET of a file under `sounds/` in the scope (the manifest and the samples). Checked before the policy, so
 * a sound is cache-first even though it is not in the precache list.
 */
export function isSoundRequest(request: { readonly method: string; readonly url: string }, scope: string): boolean {
  if (request.method.toUpperCase() !== 'GET') return false;
  try {
    const url = new URL(request.url);
    const base = new URL(scope);
    if (url.origin !== base.origin) return false;
    const rel = relativeToScope(url.pathname, base.pathname);
    return rel !== null && rel.startsWith('sounds/') && rel.length > 'sounds/'.length;
  } catch {
    return false;
  }
}

/**
 * Cache-first for the instrument sounds, so an instrument heard once plays offline. Only a complete answer (200) is
 * stored: a partial (206) or failed response is passed through and fetched again next time.
 */
export async function respondSound(request: Request, deps: StrategyDeps): Promise<Response> {
  const cache = await deps.caches.open(CACHE_NAMES.sounds);
  const hit = await cache.match(request.url);
  if (hit) return hit;
  const response = await deps.fetch(request);
  if (response.status === 200) await cache.put(request.url, response.clone());
  return response;
}

/** Answers one request with the strategy the policy chose. `bypass` is never passed here. */
export function respondWith(route: Exclude<Route, 'bypass'>, request: Request, deps: StrategyDeps): Promise<Response> {
  switch (route) {
    case 'revalidate':
      return revalidate(request, deps);
    case 'precache':
      return fromPrecache(request, deps);
    case 'hashed':
      return cacheFirst(request, deps, CACHE_NAMES.hashed);
    case 'navigate':
      return navigate(request, deps);
  }
}

/**
 * Install: stores every precache entry under the revision-named cache. `cache: 'reload'` bypasses the HTTP cache, so a
 * stale index.html is never stored under the new revision.
 */
export async function precacheAll(
  caches: CacheStorageLike,
  cacheName: string,
  urls: readonly string[],
  fetchFresh: (url: string) => Promise<Response>,
): Promise<void> {
  const cache = await caches.open(cacheName);
  for (const url of urls) {
    const response = await fetchFresh(url);
    if (!response.ok) throw new Error(`precache ${url} failed with ${response.status}`);
    await cache.put(url, response);
  }
}

/**
 * Activate: drops every precache revision except the current one, and sound caches of an older version. Hashed, corpus
 * and current sound caches are kept across builds.
 */
export async function pruneOldPrecaches(caches: CacheStorageLike, current: string): Promise<string[]> {
  const removed: string[] = [];
  for (const key of await caches.keys()) {
    const oldPrecache = key.startsWith(CACHE_NAMES.precachePrefix) && key !== current;
    const oldSounds = key.startsWith('sightread-sounds-') && key !== CACHE_NAMES.sounds;
    if (oldPrecache || oldSounds) {
      await caches.delete(key);
      removed.push(key);
    }
  }
  return removed;
}

/** FNV-1a over the precache entries, so the cache name changes whenever any entry's revision changes. */
export function revisionOf(entries: readonly { url: string; revision: string | null }[]): string {
  let hash = 0x811c9dc5;
  for (const entry of entries) {
    const text = `${entry.url}\u0000${entry.revision ?? ''}\u0001`;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, '0');
}
