import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type AnchorHTMLAttributes,
  type ReactNode,
} from 'react';
import { hashFromPath, matchRoute, pathFromHash, type MatchedRoute } from './route-match.ts';
import type { RouteDef } from './route-types.ts';
import { notFoundRoute } from './routes.tsx';

/** Where the current hash comes from. A seam so tests need no real navigation. */
export interface LocationSource {
  getHash(): string;
  subscribe(listener: () => void): () => void;
  /** Go to a path. `replace` swaps the history entry instead of adding one. */
  navigate(path: string, replace: boolean): void;
}

export function createBrowserLocation(win: Window = window): LocationSource {
  const listeners = new Set<() => void>();
  const notify = (): void => listeners.forEach((l) => l());
  return {
    getHash: () => win.location.hash,
    subscribe(listener) {
      listeners.add(listener);
      win.addEventListener('hashchange', notify);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) win.removeEventListener('hashchange', notify);
      };
    },
    navigate(path, replace) {
      const hash = hashFromPath(path);
      if (replace) {
        win.history.replaceState(win.history.state, '', hash);
        notify();
      } else if (win.location.hash !== hash) {
        win.location.hash = hash; // fires hashchange
      }
    },
  };
}

export type ResolvedRoute = MatchedRoute<RouteDef>;

interface RouterValue {
  route: ResolvedRoute;
  navigate: (path: string, options?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

export interface RouterProviderProps {
  table: readonly RouteDef[];
  /** Dev-only routes resolve only when true. Defaults to the build's DEV flag. */
  dev?: boolean;
  source?: LocationSource;
  /** Asked when a route redirects on whether a result is open (the tips route). Defaults to none open. */
  resultOpen?: () => boolean;
  children: ReactNode;
}

let defaultSource: LocationSource | null = null;
function browserSource(): LocationSource {
  defaultSource ??= createBrowserLocation();
  return defaultSource;
}

export function RouterProvider({ table, dev = import.meta.env.DEV, source, resultOpen, children }: RouterProviderProps) {
  const src = source ?? browserSource();
  const hash = useSyncExternalStore(src.subscribe, src.getHash, () => '');
  const { route, redirectTo } = useMemo(() => {
    const path = pathFromHash(hash);
    const matched = matchRoute(table, path, dev) ?? { def: notFoundRoute, path, params: {} };
    const to = matched.def.redirect?.({ resultOpen: resultOpen?.() ?? false });
    if (to === undefined) return { route: matched as ResolvedRoute, redirectTo: null };
    // Resolve at once so the redirecting screen never renders; the effect below fixes the address bar.
    const target = matchRoute(table, to, dev) ?? { def: notFoundRoute, path: to, params: {} };
    return { route: target as ResolvedRoute, redirectTo: to };
  }, [hash, table, dev, resultOpen]);
  useEffect(() => {
    if (redirectTo !== null) src.navigate(redirectTo, true);
  }, [redirectTo, src]);
  const navigate = useCallback(
    (path: string, options?: { replace?: boolean }) => src.navigate(path, options?.replace ?? false),
    [src],
  );
  const value = useMemo(() => ({ route, navigate }), [route, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

function useRouter(): RouterValue {
  const v = useContext(RouterContext);
  if (!v) throw new Error('Router hooks must be used inside <RouterProvider>');
  return v;
}

/** The matched route; an unmatched path yields the not-found route. */
export function useRoute(): ResolvedRoute {
  return useRouter().route;
}

export function useNavigate(): RouterValue['navigate'] {
  return useRouter().navigate;
}

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string;
}

/** A plain anchor to a hash route; the browser does the navigation. */
export function Link({ to, children, ...rest }: LinkProps) {
  return (
    <a href={hashFromPath(to)} {...rest}>
      {children}
    </a>
  );
}
