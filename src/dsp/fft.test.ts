import { describe, expect, it } from 'vitest';
import { Autocorrelator, FFT } from './fft.ts';

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

describe('FFT', () => {
  it('rejects non power-of-two sizes', () => {
    expect(() => new FFT(1000)).toThrow();
  });
  it('matches a naive DFT', () => {
    const n = 64;
    const rnd = lcg(1);
    const re = new Float64Array(n).map(() => rnd() - 0.5);
    const im = new Float64Array(n).map(() => rnd() - 0.5);
    const er = new Float64Array(n);
    const ei = new Float64Array(n);
    for (let k = 0; k < n; k++)
      for (let j = 0; j < n; j++) {
        const a = (-2 * Math.PI * k * j) / n;
        er[k] = (er[k] as number) + (re[j] as number) * Math.cos(a) - (im[j] as number) * Math.sin(a);
        ei[k] = (ei[k] as number) + (re[j] as number) * Math.sin(a) + (im[j] as number) * Math.cos(a);
      }
    new FFT(n).transform(re, im);
    for (let k = 0; k < n; k++) {
      expect(re[k]).toBeCloseTo(er[k] as number, 9);
      expect(im[k]).toBeCloseTo(ei[k] as number, 9);
    }
  });
  it('autocorrelation equals the direct sum', () => {
    const n = 256;
    const rnd = lcg(2);
    const x = new Float32Array(n).map(() => rnd() - 0.5);
    const out = new Float64Array(n);
    new Autocorrelator(n).compute(x, 0, out);
    for (const tau of [0, 1, 7, 100, 255]) {
      let s = 0;
      for (let i = 0; i + tau < n; i++) s += (x[i] as number) * (x[i + tau] as number);
      expect(out[tau]).toBeCloseTo(s, 8);
    }
  });
});
