import { describe, expect, it } from 'vitest';
import { countTries, reachedBarOne, triesOnDay } from './tries.ts';

const graded = { endReason: 'complete' as const, createdAt: '2026-03-02T10:00:00.000Z' };
const notGraded = { endReason: 'void' as const, voidReason: 'no-signal' as const, createdAt: '2026-03-02T11:00:00.000Z' };
const early = { endReason: 'void' as const, voidReason: 'stopped-before-first-note' as const, createdAt: '2026-03-02T12:00:00.000Z' };
const yesterday = { endReason: 'complete' as const, createdAt: '2026-03-01T10:00:00.000Z' };
const dayOf = (iso: string): string => iso.slice(0, 10);

describe('tries', () => {
  it('counts a try that reached bar 1, graded or not', () => {
    expect(reachedBarOne(graded)).toBe(true);
    expect(reachedBarOne(notGraded)).toBe(true);
    expect(reachedBarOne({ endReason: 'stopped' })).toBe(true);
  });
  it('does not count a try stopped before the first note', () => {
    expect(reachedBarOne(early)).toBe(false);
  });
  it('2 graded + 1 not graded + 1 stopped before bar 1 today is 3', () => {
    expect(triesOnDay([graded, graded, notGraded, early, yesterday], '2026-03-02', dayOf)).toBe(3);
  });
  it('is zero for no attempts', () => {
    expect(countTries([])).toBe(0);
  });
});
