/**
 * Small observable values for the composition root: the `Readable` and `Writable` shapes the screens read
 * (src/app/screens/home/services.ts). `get` returns the same object until `set` replaces it, as
 * `useSyncExternalStore` requires.
 */
import type { Readable, Writable } from '../screens/home/services.ts';

export interface Value<T> extends Writable<T> {
  /** Replace the value without the persist hook (a reload from the store). */
  replace(next: T): void;
}

export function createValue<T>(initial: T, persist?: (next: T) => void): Value<T> {
  let current = initial;
  const listeners = new Set<() => void>();
  const notify = (): void => listeners.forEach((l) => l());
  return {
    get: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    set(next) {
      if (Object.is(next, current)) return;
      current = next;
      notify();
      persist?.(next);
    },
    replace(next) {
      if (Object.is(next, current)) return;
      current = next;
      notify();
    },
  };
}

/** A read-only value derived from others, recomputed when any source changes (memoised by `equal`). */
export function derived<T>(sources: readonly Readable<unknown>[], compute: () => T, equal: (a: T, b: T) => boolean = Object.is): Readable<T> {
  let current = compute();
  const listeners = new Set<() => void>();
  let unsubs: (() => void)[] = [];
  const recompute = (): void => {
    const next = compute();
    if (equal(next, current)) return;
    current = next;
    listeners.forEach((l) => l());
  };
  return {
    get: () => {
      if (listeners.size === 0) current = ((next) => (equal(next, current) ? current : next))(compute());
      return current;
    },
    subscribe(listener) {
      if (listeners.size === 0) unsubs = sources.map((s) => s.subscribe(recompute));
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          unsubs.forEach((u) => u());
          unsubs = [];
        }
      };
    },
  };
}

export const jsonEqual = <T>(a: T, b: T): boolean => JSON.stringify(a) === JSON.stringify(b);
