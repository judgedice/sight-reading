import { describe, expect, it } from 'vitest';
import { createRng } from './rng.ts';

// Reference mulberry32 (Tommy Ettinger's public-domain snippet), written independently of rng.ts.
function ref(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hard-coded from the reference implementation, seed 1.
const KNOWN_SEED_1 = [
  0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741, 0.9683778982143849,
];

describe('mulberry32', () => {
  it('matches the known sequence for seed 1', () => {
    const r = createRng(1);
    const got = [r.next(), r.next(), r.next(), r.next(), r.next()];
    expect(got).toEqual(KNOWN_SEED_1);
  });

  it('matches the reference implementation over many seeds', () => {
    for (const seed of [0, 1, 42, 12345, 0xdeadbeef, 2 ** 32 - 1]) {
      const a = createRng(seed);
      const b = ref(seed);
      for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b());
    }
  });

  it('is deterministic and independent per instance', () => {
    const a = createRng(7);
    const b = createRng(7);
    a.next();
    expect(b.next()).not.toBe(a.next());
    const c = createRng(7);
    const d = createRng(7);
    expect([c.next(), c.next()]).toEqual([d.next(), d.next()]);
  });

  it('next is in [0, 1)', () => {
    const r = createRng(99);
    for (let i = 0; i < 10000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int covers [min, max) uniformly enough and never reaches max', () => {
    const r = createRng(5);
    const counts = new Array<number>(6).fill(0);
    for (let i = 0; i < 6000; i++) {
      const v = r.int(-2, 4);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThan(4);
      counts[v + 2] = (counts[v + 2] ?? 0) + 1;
    }
    for (const c of counts) expect(c).toBeGreaterThan(800);
    expect(r.int(3, 4)).toBe(3);
  });

  it('int rejects bad ranges', () => {
    const r = createRng(1);
    expect(() => r.int(2, 2)).toThrow(RangeError);
    expect(() => r.int(0.5, 3)).toThrow(RangeError);
  });
});
