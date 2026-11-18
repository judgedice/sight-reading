/**
 * The slip filter shared by the results panel's counts line and the review stepper (04 §6.5, §6.6): pressing a count
 * restricts the stepper to that set, the re-judged button to the re-judged notes, "All slips" resets it. A tiny store
 * so the panel and the review can live in different subtrees.
 */
import type { CountKind } from '../model.ts';
import type { SlipFilter } from './model.ts';

export interface ReviewBus {
  get(): SlipFilter;
  set(f: SlipFilter): void;
  subscribe(l: () => void): () => void;
}

export function createReviewBus(initial: SlipFilter = 'all'): ReviewBus {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(f) {
      if (f === value) return;
      value = f;
      for (const l of [...listeners]) l();
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

/** A counts-line kind as a slip filter ('total' means every slip). */
export function filterOfCount(kind: CountKind): SlipFilter {
  return kind === 'total' ? 'all' : kind;
}

/** Handlers for `ResultsPanel` (`onSelectVerdict`, `onShowRejudged`) that drive the review stepper through a bus. */
export function reviewPanelHandlers(bus: ReviewBus): { onSelectVerdict: (k: CountKind) => void; onShowRejudged: () => void } {
  return {
    onSelectVerdict: (k) => bus.set(filterOfCount(k)),
    onShowRejudged: () => bus.set('rejudged'),
  };
}
