import { describe, expect, it } from 'vitest';
import { testClockRequested } from './slice-url.ts';

describe('testClockRequested', () => {
  it('reads testClock=1 from the query string or the hash query', () => {
    expect(testClockRequested('?testClock=1', '#/dev/slice')).toBe(true);
    expect(testClockRequested('', '#/dev/slice?testClock=1')).toBe(true);
    expect(testClockRequested('', '#/dev/slice?x=2&testClock=1')).toBe(true);
    expect(testClockRequested('', '#/dev/slice')).toBe(false);
    expect(testClockRequested('?testClock=0', '#/dev/slice?testClock=2')).toBe(false);
  });
});
