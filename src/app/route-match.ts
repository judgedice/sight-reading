// Hash route matching (04 section 3.1). Pure: no React, no window.

export type TabId = 'practice' | 'progress' | 'history';

export type RouteId =
  | 'welcome'
  | 'home'
  | 'practice.scan'
  | 'practice.play'
  | 'practice.results'
  | 'practice.tips'
  | 'progress'
  | 'history'
  | 'history.attempt'
  | 'settings'
  | 'calibrate'
  | 'match'
  | 'credits'
  | 'dev.components'
  | 'dev.replay'
  | 'not-found';

/** The anchors of #/settings/:section (04 section 3.1). */
export const SETTINGS_SECTIONS = ['audio', 'display', 'practice', 'accessibility', 'data', 'about'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export interface PatternRoute {
  id: RouteId;
  /** `/history/:attemptId`; a segment starting with ":" captures one path segment. */
  pattern: string;
  devOnly: boolean;
  validate?: ((params: Readonly<Record<string, string>>) => boolean) | undefined;
}

export interface MatchedRoute<R extends PatternRoute> {
  def: R;
  /** Normalised path, always starting with "/". */
  path: string;
  params: Readonly<Record<string, string>>;
}

/** `#/history/x?y=1` becomes `/history/x`. Empty and bare "#" become "/". Trailing slashes are dropped. */
export function pathFromHash(hash: string): string {
  let h = hash.startsWith('#') ? hash.slice(1) : hash;
  const q = h.search(/[?#]/);
  if (q >= 0) h = h.slice(0, q);
  if (!h.startsWith('/')) h = `/${h}`;
  if (h.length > 1) h = h.replace(/\/+$/, '');
  return h === '' ? '/' : h;
}

export function hashFromPath(path: string): string {
  return `#${path.startsWith('/') ? path : `/${path}`}`;
}

function safeDecode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

function matchPattern(pattern: string, path: string): Record<string, string> | null {
  const want = pattern.split('/').filter(Boolean);
  const have = path.split('/').filter(Boolean);
  if (want.length !== have.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    const w = want[i] as string;
    const h = have[i] as string;
    if (w.startsWith(':')) {
      const v = safeDecode(h);
      if (v === null || v === '') return null;
      params[w.slice(1)] = v;
    } else if (w !== h) {
      return null;
    }
  }
  return params;
}

/** First matching available route, or null. Dev-only routes match only when `dev` is true. */
export function matchRoute<R extends PatternRoute>(
  table: readonly R[],
  path: string,
  dev: boolean,
): MatchedRoute<R> | null {
  for (const def of table) {
    if (def.devOnly && !dev) continue;
    const params = matchPattern(def.pattern, path);
    if (!params) continue;
    if (def.validate && !def.validate(params)) continue;
    return { def, path, params };
  }
  return null;
}

/** Fills a pattern: buildPath('/history/:attemptId', { attemptId: 'a b' }) is '/history/a%20b'. */
export function buildPath(pattern: string, params: Readonly<Record<string, string>> = {}): string {
  return (
    '/' +
    pattern
      .split('/')
      .filter(Boolean)
      .map((seg) => {
        if (!seg.startsWith(':')) return seg;
        const v = params[seg.slice(1)];
        if (v === undefined) throw new Error(`buildPath: missing "${seg.slice(1)}" for ${pattern}`);
        return encodeURIComponent(v);
      })
      .join('/')
  );
}
