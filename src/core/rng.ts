/** Seeded RNG, mulberry32 (01 §14 item 3). Core packages get randomness only through this. */
import type { Rng } from './types.ts';

/** Create a deterministic generator from a 32-bit seed (non-integers are truncated, then taken mod 2^32). */
export function createRng(seed: number): Rng {
  let a = Math.trunc(seed) >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int(minInclusive: number, maxExclusive: number): number {
      if (!Number.isInteger(minInclusive) || !Number.isInteger(maxExclusive) || maxExclusive <= minInclusive) {
        throw new RangeError(`Rng.int: need integers with min < max, got [${minInclusive}, ${maxExclusive})`);
      }
      return minInclusive + Math.floor(next() * (maxExclusive - minInclusive));
    },
  };
}
