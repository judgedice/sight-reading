import { describe, expect, it } from 'vitest';
import { AdaptiveThreshold, FLUX_THRESHOLD_MIN, SpectralFlux, medianInPlace } from './flux.ts';

const RATE = 16000;

function tone(f: number, startSec: number, totalSec: number, amp = 0.2): Float32Array {
  const n = Math.round(totalSec * RATE);
  const s0 = Math.round(startSec * RATE);
  const out = new Float32Array(n);
  for (let i = s0; i < n; i++) {
    const t = (i - s0) / RATE;
    const env = Math.min(1, t / 0.005);
    out[i] = env * amp * (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(2 * Math.PI * 2 * f * t));
  }
  return out;
}

function run(x: Float32Array, chunk = 85): { t: number; v: number }[] {
  const sf = new SpectralFlux(RATE);
  const out: { t: number; v: number }[] = [];
  for (let i = 0; i < x.length; i += chunk) {
    const part = x.subarray(i, Math.min(x.length, i + chunk));
    sf.push(part, part.length, (c, v) => out.push({ t: c / RATE, v }));
  }
  return out;
}

describe('SpectralFlux', () => {
  it('uses the 100 Hz to 3 kHz band of a 512-point transform', () => {
    const sf = new SpectralFlux(RATE);
    expect(sf.kLo).toBe(Math.ceil((100 * 512) / RATE));
    expect(sf.kHi).toBe(Math.floor((3000 * 512) / RATE));
  });

  it('stamps frames at the window centre, one per 128 samples once 512 are buffered', () => {
    const out = run(new Float32Array(RATE));
    expect(out[0]?.t).toBeCloseTo(256 / RATE, 12);
    expect((out[1]?.t ?? 0) - (out[0]?.t ?? 0)).toBeCloseTo(128 / RATE, 12);
    expect(out.length).toBe(Math.floor((RATE - 512) / 128) + 1);
  });

  it('is zero in silence and on a steady tone, and peaks near an onset', () => {
    const onset = 0.5;
    const out = run(tone(440, onset, 1.2));
    const before = out.filter((s) => s.t < onset - 0.02);
    expect(Math.max(...before.map((s) => s.v))).toBe(0);
    const steady = out.filter((s) => s.t > onset + 0.08);
    const peak = out.reduce((a, b) => (b.v > a.v ? b : a));
    expect(peak.v).toBeGreaterThan(0.5);
    expect(Math.abs(peak.t - onset)).toBeLessThan(0.02);
    expect(Math.max(...steady.map((s) => s.v))).toBeLessThan(0.05 * peak.v);
  });

  it('is independent of the push chunking', () => {
    const x = tone(330, 0.3, 0.8);
    const a = run(x, 85);
    const b = run(x, 1000);
    expect(b.length).toBe(a.length);
    for (let i = 0; i < a.length; i++) expect(b[i]?.v).toBeCloseTo(a[i]?.v as number, 12);
  });
});

describe('AdaptiveThreshold', () => {
  it('is Infinity before any value and median + k MAD after', () => {
    const th = new AdaptiveThreshold(10, 3, 0);
    expect(th.current()).toBe(Infinity);
    for (const v of [1, 2, 3, 4, 100]) th.push(v);
    // median 3, deviations 2 1 0 1 97 -> MAD 1
    expect(th.current()).toBeCloseTo(3 + 3 * 1, 12);
  });

  it('only remembers its window and never drops below the minimum', () => {
    const th = new AdaptiveThreshold(4);
    for (let i = 0; i < 4; i++) th.push(10);
    for (let i = 0; i < 4; i++) th.push(0);
    expect(th.current()).toBe(FLUX_THRESHOLD_MIN);
  });

  it('medianInPlace handles odd and even lengths', () => {
    expect(medianInPlace(Float64Array.from([3, 1, 2]), 3)).toBe(2);
    expect(medianInPlace(Float64Array.from([4, 1, 3, 2]), 4)).toBe(2.5);
    expect(Number.isNaN(medianInPlace(new Float64Array(0), 0))).toBe(true);
  });
});
