/** Hooks shared by the scan and performance screens. */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import { breakpointFor, isShort, type Breakpoint } from '../../../ui/layout-table.ts';
import type { Readable } from '../home/services.ts';

/** Reads one slice of a vanilla store. `select` must return a value that is stable while the slice is unchanged. */
export function useStoreSlice<S, T>(store: StoreApi<S>, select: (s: S) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.getState()),
    () => select(store.getState()),
  );
}

export function useReadable<T>(r: Readable<T>): T {
  return useSyncExternalStore(r.subscribe, r.get, r.get);
}

export interface WindowInfo {
  breakpoint: Breakpoint;
  portrait: boolean;
  /** Short viewport (04 section 4.1): the status line is dropped. */
  short: boolean;
}

/** Breakpoint and orientation of the window; updates on resize. */
export function useWindowInfo(): WindowInfo {
  const read = (): WindowInfo => ({ breakpoint: breakpointFor(window.innerWidth), portrait: window.innerHeight >= window.innerWidth, short: isShort(window.innerHeight) });
  const [info, setInfo] = useState<WindowInfo>(read);
  useEffect(() => {
    const on = (): void => setInfo((prev) => {
      const next = read();
      return next.breakpoint === prev.breakpoint && next.portrait === prev.portrait && next.short === prev.short ? prev : next;
    });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return info;
}

/** The latest value in a ref, for callbacks that must not re-subscribe. */
export function useLatest<T>(value: T): { current: T } {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
