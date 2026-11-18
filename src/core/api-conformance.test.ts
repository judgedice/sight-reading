// Compile-time and runtime check that the P0c modules satisfy the frozen signatures in api.ts (01 §14 item 3).
import { describe, expect, it } from 'vitest';
import type { CoreTimeApi, CoreUtilApi } from './api.ts';
import * as events from './events.ts';
import * as rng from './rng.ts';
import * as time from './time.ts';

const timeApi: CoreTimeApi = time;
const utilApi: CoreUtilApi = { createRng: rng.createRng, createEmitter: events.createEmitter };

describe('core api conformance', () => {
  it('time.ts implements CoreTimeApi', () => {
    for (const k of ['ticksToBeats', 'beatsToScoreSeconds', 'beatsToTicks', 'scoreSecondsToBeats', 'ticksToScoreSeconds', 'ticksPerBar', 'makeMeter'] as const) {
      expect(typeof timeApi[k]).toBe('function');
    }
  });
  it('rng.ts and events.ts implement CoreUtilApi', () => {
    expect(utilApi.createRng(1).next()).toBe(rng.createRng(1).next());
    const e = utilApi.createEmitter<number>();
    const got: number[] = [];
    e.on((v) => got.push(v));
    e.emit(3);
    expect(got).toEqual([3]);
  });
});
