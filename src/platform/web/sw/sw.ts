/**
 * Service worker entry (P19). vite-plugin-pwa (`injectManifest`) compiles this file and replaces `self.__WB_MANIFEST`
 * with the build's app-shell list. The page registers it from `register.ts`, and only when
 * `capabilities.serviceWorker` is true.
 *
 * Install stores the shell under a revision-named cache and does not skip waiting, so a new build is held back until
 * the player accepts the update prompt (`SKIP_WAITING`). Routing and the cache policy live in `policy.ts` and
 * `strategies.ts`, which the Vitest suite covers.
 */
import { relativeToScope, routeFor } from './policy.ts';
import {
  CACHE_NAMES,
  precacheAll,
  pruneOldPrecaches,
  respondWith,
  revisionOf,
  type CacheStorageLike,
  type StrategyDeps,
} from './strategies.ts';

/** One entry of the injected list. `url` is relative to the scope (for example 'index.html'). */
interface PrecacheEntry {
  url: string;
  revision: string | null;
}

declare global {
  interface Window {
    __WB_MANIFEST: PrecacheEntry[];
  }
}

interface ExtendableEventLike {
  waitUntil(promise: Promise<unknown>): void;
}
interface FetchEventLike {
  readonly request: Request;
  respondWith(response: Promise<Response>): void;
}
interface MessageEventLike {
  readonly data?: { type?: string } | null;
}
interface SwEvents {
  install: ExtendableEventLike;
  activate: ExtendableEventLike;
  fetch: FetchEventLike;
  message: MessageEventLike;
}
/** The subset of `ServiceWorkerGlobalScope` this worker uses. The DOM lib types `self` as a window, so it is cast once. */
interface SwScope {
  readonly registration: { readonly scope: string };
  readonly caches: CacheStorageLike;
  readonly clients: { claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  fetch(request: Request): Promise<Response>;
  addEventListener<K extends keyof SwEvents>(type: K, listener: (event: SwEvents[K]) => void): void;
}

const sw = self as unknown as SwScope;
const entries = self.__WB_MANIFEST;
const scope = sw.registration.scope;
const relOf = (url: string): string => url.replace(/^\.\//, '');
const precacheRels = new Set(entries.map((entry) => relOf(entry.url)));
const precacheUrl = (rel: string): string => new URL(rel, scope).href;
/** A request URL under the scope maps to its precache key: the scope root is index.html. */
const precacheKey = (url: string): string => {
  const rel = relativeToScope(new URL(url).pathname, new URL(scope).pathname);
  return rel === null ? url : precacheUrl(rel);
};
const precacheName = CACHE_NAMES.precachePrefix + revisionOf(entries);
const precacheUrls = [...precacheRels].map(precacheUrl);

const deps: StrategyDeps = {
  caches: sw.caches,
  fetch: (request) => sw.fetch(request),
  precacheName,
  precacheUrl,
  precacheKey,
};

sw.addEventListener('install', (event) => {
  // `reload` skips the HTTP cache, so a stale shell is never stored under the new revision.
  event.waitUntil(
    precacheAll(sw.caches, precacheName, precacheUrls, (url) => sw.fetch(new Request(url, { cache: 'reload' }))),
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(pruneOldPrecaches(sw.caches, precacheName).then(() => sw.clients.claim()));
});

sw.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void sw.skipWaiting();
});

sw.addEventListener('fetch', (event) => {
  const route = routeFor(
    { method: event.request.method, url: event.request.url, mode: event.request.mode },
    scope,
    precacheRels,
  );
  if (route === 'bypass') return;
  event.respondWith(respondWith(route, event.request, deps));
});
