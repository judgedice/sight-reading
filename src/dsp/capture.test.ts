import { describe, expect, it } from 'vitest';
import { decimatorCreate } from './decimator.ts';
import { EnvelopeFollower } from './envelope.ts';
import { butterworthQs, highpassCoefficients, lowpassCoefficients, magnitudeDb } from './filters.ts';
import { HiBandEnergy } from './hiband.ts';

const RATES = [16000, 24000, 44100, 48000];

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

describe('filters', () => {
  it('Butterworth Qs for order 8 and 4', () => {
    expect(butterworthQs(8).map((q) => +q.toFixed(4))).toEqual([0.5098, 0.6013, 0.9, 2.5629]);
    expect(butterworthQs(4).map((q) => +q.toFixed(4))).toEqual([0.5412, 1.3066]);
  });
  it.each(RATES)('low-pass at %i Hz: <= 1 dB at 2637 Hz, >= 35 dB at 5 kHz, >= 48 dB at 6 kHz', (fs) => {
    const c = lowpassCoefficients(fs);
    expect(magnitudeDb(c, 2637, fs)).toBeGreaterThan(-1);
    expect(magnitudeDb(c, 5000, fs)).toBeLessThan(-35);
    if (fs > 12500) expect(magnitudeDb(c, 6000, fs)).toBeLessThan(-48 + 0.5);
    expect(magnitudeDb(c, 100, fs)).toBeCloseTo(0, 3);
  });
  it('coefficients are cached per rate', () => {
    expect(lowpassCoefficients(48000)).toBe(lowpassCoefficients(48000));
    expect(highpassCoefficients(48000)).toBe(highpassCoefficients(48000));
  });
  it.each(RATES)('high-pass at %i Hz: -3 dB at 5 kHz, flat above, strong rejection at 1 kHz', (fs) => {
    const c = highpassCoefficients(fs);
    expect(magnitudeDb(c, 5000, fs)).toBeCloseTo(-3.01, 1);
    expect(magnitudeDb(c, 7000, fs)).toBeGreaterThan(-3);
    expect(magnitudeDb(c, 1000, fs)).toBeLessThan(-40);
  });
});

describe('decimator', () => {
  it.each(RATES)('shape at %i Hz', (fs) => {
    const d = decimatorCreate(fs);
    expect(d.factor).toBe(Math.round(fs / 16000));
    expect(d.analysisRate).toBe(fs / d.factor);
  });

  it.each(RATES)('10,000 random blocks at %i Hz lose no sample and drift < 1 sample', (fs) => {
    const d = decimatorCreate(fs);
    const rnd = lcg(fs);
    const out = new Float32Array(512);
    let totalIn = 0;
    let totalOut = 0;
    let blocks = 0;
    for (let b = 0; b < 10000; b++) {
      const n = 1 + Math.floor(rnd() * 256);
      const input = new Float32Array(n);
      for (let i = 0; i < n; i++) input[i] = rnd() - 0.5;
      const w = d.process(input, out, 0);
      // output samples sit at input indices k*D: count of k*D in [totalIn, totalIn+n)
      const expected = Math.ceil((totalIn + n) / d.factor) - Math.ceil(totalIn / d.factor);
      expect(w).toBe(expected);
      totalIn += n;
      totalOut += w;
      blocks++;
    }
    expect(blocks).toBe(10000);
    expect(totalOut).toBe(Math.ceil(totalIn / d.factor));
    // startT drift: time of next output sample vs ideal totalOut / analysisRate
    const driftSamples = (d.nextOutputInputPos / fs - totalOut / d.analysisRate) * d.analysisRate;
    expect(Math.abs(driftSamples)).toBeLessThan(1);
  });

  it('48 kHz 256-frame posts are 85 or 86 samples with exact contiguous startT', () => {
    const d = decimatorCreate(48000);
    const out = new Float32Array(100);
    const input = new Float32Array(256);
    let pos = 0;
    const sizes = new Set<number>();
    for (let b = 0; b < 3000; b++) {
      const startT = d.nextOutputInputPos / 48000;
      expect(startT).toBeCloseTo(pos / 16000, 9);
      const w = d.process(input, out, 0);
      sizes.add(w);
      pos += w;
    }
    expect([...sizes].sort()).toEqual([85, 86]);
  });

  it('chunking does not change the output', () => {
    const rnd = lcg(7);
    const x = new Float32Array(10007).map(() => rnd() - 0.5);
    const whole = new Float32Array(4000);
    const nWhole = decimatorCreate(44100).process(x, whole, 0);
    const d = decimatorCreate(44100);
    const parts = new Float32Array(4000);
    let w = 0;
    for (let i = 0; i < x.length; ) {
      const n = Math.min(1 + Math.floor(rnd() * 300), x.length - i);
      w += d.process(x.subarray(i, i + n), parts, w);
      i += n;
    }
    expect(w).toBe(nWhole);
    expect(Array.from(parts.subarray(0, w))).toEqual(Array.from(whole.subarray(0, nWhole)));
  });

  it('passes 2637 Hz and rejects 5 kHz in the decimated stream', () => {
    const fs = 48000;
    const gain = (hz: number): number => {
      const d = decimatorCreate(fs);
      const x = new Float32Array(fs).map((_, i) => Math.sin((2 * Math.PI * hz * i) / fs));
      const out = new Float32Array(fs / 3);
      const n = d.process(x, out, 0);
      let s = 0;
      for (let i = 2000; i < n; i++) s += (out[i] as number) ** 2;
      return 10 * Math.log10((s / (n - 2000)) / 0.5);
    };
    expect(gain(2637)).toBeGreaterThan(-1);
    expect(gain(5000)).toBeLessThan(-35);
  });

  it('reset restarts phase', () => {
    const d = decimatorCreate(48000);
    d.process(new Float32Array(100), new Float32Array(100), 0);
    d.reset();
    expect(d.nextOutputInputPos).toBe(0);
  });

  it('zero allocations after warm-up', () => {
    const fs = 48000;
    const d = decimatorCreate(fs);
    const hb = new HiBandEnergy(fs);
    const env = new EnvelopeFollower(d.analysisRate);
    const input = new Float32Array(256).map((_, i) => Math.sin(i));
    const low = new Float32Array(100);
    const hi = new Float32Array(10);
    const ev = new Float32Array(10);
    const step = (): void => {
      const n = d.process(input, low, 0);
      hb.process(input, hi, 0);
      env.process(low, ev, 0, n);
    };
    for (let i = 0; i < 20000; i++) step();
    const g = globalThis as { gc?: () => void };
    g.gc?.();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 200000; i++) step();
    const grew = process.memoryUsage().heapUsed - before;
    // 200k iterations would allocate tens of MB if each call allocated even a small object
    expect(grew).toBeLessThan(2_000_000);
  });
});

describe('hi-band energy', () => {
  it.each(RATES)('sub-block count is exact at %i Hz and carries across chunks', (fs) => {
    const hb = new HiBandEnergy(fs);
    const out = new Float32Array(20);
    let total = 0;
    let n = 0;
    const rnd = lcg(3);
    for (let b = 0; b < 2000; b++) {
      const len = 1 + Math.floor(rnd() * 256);
      n += len;
      total += hb.process(new Float32Array(len), out, 0);
    }
    expect(total).toBe(Math.floor(n / (fs / 1000) + 1e-9));
  });

  it('detects a 6 kHz tone, ignores 1 kHz', () => {
    const fs = 48000;
    const energy = (hz: number): number => {
      const hb = new HiBandEnergy(fs);
      const x = new Float32Array(4800).map((_, i) => Math.sin((2 * Math.PI * hz * i) / fs));
      const out = new Float32Array(100);
      const w = hb.process(x, out, 0);
      return out[w - 1] as number;
    };
    expect(energy(6000)).toBeGreaterThan(10); // 48 samples, amplitude near 1: about 24
    expect(energy(1000)).toBeLessThan(0.01);
  });
});

describe('envelope', () => {
  it('hop is 32 samples at 16 kHz and tracks level in dB', () => {
    const env = new EnvelopeFollower(16000);
    expect(env.hop).toBe(32);
    const x = new Float32Array(3200).map((_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / 16000));
    const out = new Float32Array(200);
    const n = env.process(x, out, 0);
    expect(n).toBe(100);
    // RMS of 0.5 sine is 0.3536 -> -9.03 dB (power mean in 10 log10 terms)
    expect(out[50]).toBeCloseTo(-9.03, 0);
  });

  it('carries partial hops across calls and floors silence', () => {
    const env = new EnvelopeFollower(14700);
    expect(env.hop).toBe(29);
    const out = new Float32Array(10);
    expect(env.process(new Float32Array(20), out, 0)).toBe(0);
    expect(env.process(new Float32Array(20), out, 0)).toBe(1);
    expect(out[0]).toBe(-120);
  });

  it('resolves a 30 dB dip with 2 ms resolution', () => {
    const env = new EnvelopeFollower(16000);
    const x = new Float32Array(1600).fill(0.5);
    x.fill(0.5 * 10 ** (-30 / 20), 640, 800);
    const out = new Float32Array(60);
    const n = env.process(x, out, 0);
    const vals = Array.from(out.subarray(0, n));
    expect(Math.max(...vals) - Math.min(...vals)).toBeCloseTo(30, 0);
  });
});
