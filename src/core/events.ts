/**
 * Typed emitter for the real-time path (01 §1, §14 item 3). Type declarations live in `types.ts`;
 * this file holds the implementations only.
 */
import type { Emitter } from './types.ts';

/**
 * Synchronous emitter. `emit` delivers to a snapshot of the listeners, so a listener that
 * subscribes or unsubscribes during delivery affects the next emit only. A throwing listener
 * does not stop the others; the first error is rethrown after all have run.
 */
export function createEmitter<T>(): Emitter<T> {
  let listeners: ((event: T) => void)[] = [];
  return {
    on(listener) {
      // A fresh wrapper per subscription, so subscribing the same function twice gives two independent handles.
      const entry = (event: T): void => listener(event);
      listeners = [...listeners, entry];
      return () => {
        listeners = listeners.filter((l) => l !== entry);
      };
    },
    emit(event) {
      const snapshot = listeners;
      let failed = false;
      let firstError: unknown;
      for (const l of snapshot) {
        try {
          l(event);
        } catch (e) {
          if (!failed) {
            failed = true;
            firstError = e;
          }
        }
      }
      if (failed) throw firstError;
    },
    clear() {
      listeners = [];
    },
  };
}
