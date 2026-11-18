/**
 * Service worker routing policy (01 section 6.2, 13.4; work package P19). Pure: no globals, so Vitest runs it in Node
 * and the service worker imports the same table.
 *
 * - `revalidate`: `corpus/v1/index.json` and `corpus/v1/withdrawn.json` are `no-cache` on the server. The worker always
 *   asks the network first and keeps the last good copy only as the offline fallback. A stale index would point at a
 *   manifest that was replaced, and a stale withdrawn list would serve a withdrawn excerpt.
 * - `precache`: the app shell (index.html, the build's JS, CSS, fonts, icons and manifest), cache-first.
 * - `hashed`: content-hashed corpus files (`manifest.<hash>.json`, `shard-*.<hash>.json`, `attributions.<hash>.json`)
 *   and everything Vite emits under `assets/`. Cache-first, because the name changes when the content does.
 * - `navigate`: a top-level navigation the precache did not answer. Network first, with the precached shell as the
 *   offline fallback. The app uses hash routes, so this is rare.
 * - `bypass`: anything else (cross-origin, outside the scope, non-GET, or an unknown same-origin request). The worker
 *   does not intercept it.
 */
export type Route = 'bypass' | 'revalidate' | 'precache' | 'hashed' | 'navigate';

/** Corpus files the server marks `no-cache` (01 section 6.2). Paths are relative to the service worker scope. */
const NO_CACHE_CORPUS = /^corpus\/v1\/(?:index|withdrawn)\.json$/;
/** Content-hashed corpus files: `<name>.<hex hash>.json`. */
const HASHED_CORPUS = /^corpus\/v1\/[^/]+\.[0-9a-f]{6,}\.json$/;

export interface RouteRequest {
  readonly method: string;
  readonly url: string;
  /** The request's fetch mode, for example 'navigate'. */
  readonly mode?: string;
}

/** Relative path of `pathname` under `scopePath`, or null when it is outside the scope. `''` means the scope root. */
export function relativeToScope(pathname: string, scopePath: string): string | null {
  if (!pathname.startsWith(scopePath)) return null;
  const rel = pathname.slice(scopePath.length);
  return rel === '' ? 'index.html' : rel;
}

/**
 * Chooses the strategy for one request.
 * @param scope the service worker scope URL (ends with '/'), for example `https://host/sub/path/`.
 * @param precached the relative paths the install step stored (for example 'index.html', 'assets/index-AbC.js').
 */
export function routeFor(request: RouteRequest, scope: string, precached: ReadonlySet<string>): Route {
  if (request.method.toUpperCase() !== 'GET') return 'bypass';
  let url: URL;
  let base: URL;
  try {
    url = new URL(request.url);
    base = new URL(scope);
  } catch {
    return 'bypass';
  }
  if (url.origin !== base.origin) return 'bypass';
  const rel = relativeToScope(url.pathname, base.pathname);
  if (rel === null) return 'bypass';
  if (NO_CACHE_CORPUS.test(rel)) return 'revalidate';
  if (precached.has(rel)) return 'precache';
  if (HASHED_CORPUS.test(rel) || rel.startsWith('assets/')) return 'hashed';
  if (request.mode === 'navigate') return 'navigate';
  return 'bypass';
}
