/**
 * "Tries" (round 2, decision 10): one definition of what counts as a try, used by the Practice header, the streak
 * line, the History day groups and "N tries at this piece". A try counts when it reached bar 1, graded or not. A try
 * stopped before the first note does not count; every other end (complete, stopped later, void for another reason)
 * does.
 */
import type { AttemptRecord } from '../../core/types.ts';

/** The part of an attempt the count reads. */
export type TryFacts = Pick<AttemptRecord, 'endReason' | 'voidReason'>;

/** True when the try reached bar 1. */
export function reachedBarOne(r: TryFacts): boolean {
  return !(r.endReason === 'void' && r.voidReason === 'stopped-before-first-note');
}

/** How many of these attempts are tries. */
export function countTries(records: readonly TryFacts[]): number {
  let n = 0;
  for (const r of records) if (reachedBarOne(r)) n++;
  return n;
}

/** Tries started on a local day (`yyyy-mm-dd`); `dayOf` maps an attempt's ISO time to its local day. */
export function triesOnDay(records: readonly (TryFacts & Pick<AttemptRecord, 'createdAt'>)[], day: string, dayOf: (iso: string) => string): number {
  return countTries(records.filter((r) => dayOf(r.createdAt) === day));
}
