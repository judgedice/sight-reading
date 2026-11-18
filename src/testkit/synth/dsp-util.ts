/**
 * Signal helpers for the full synth (01 section 13.2): biquads, a radix-2 FFT, FFT convolution, a zero-phase
 * FIR decimator and Gaussian noise. Everything is deterministic: only Math.sin/cos/exp/pow/sqrt/log and the seeded
 * mulberry32 generator are used, and every function is a pure function of its inputs.
 *
 * These are testkit-local on purpose. They model devices (phone mics, small speakers, rooms), not the product
 * filters in dsp/filters.ts, so they need not match those coefficients.
 */
import type { Rng } from '../../core/types.ts';

export const dbToGain = (db: number): number => 10 ** (db / 20);
export const gainToDb = (g: number): number => 20 * Math.log10(g);
export const midiToHz = (midi: number, a4 = 440): number => a4 * 2 ** ((midi - 69) / 12);

export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export type BiquadKind = 'lp' | 'hp' | 'bp' | 'peak';

/** RBJ cookbook biquad. `gainDb` is used by 'peak' only. */
export function biquad(kind: BiquadKind, fc: number, q: number, fs: number, gainDb = 0): Biquad {
  const w0 = (2 * Math.PI * Math.min(fc, 0.49 * fs)) / fs;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * q);
  let b0: number;
  let b1: number;
  let b2: number;
  let a0: number;
  let a1: number;
  let a2: number;
  if (kind === 'lp') {
    b0 = (1 - cos) / 2;
    b1 = 1 - cos;
    b2 = (1 - cos) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
  } else if (kind === 'hp') {
    b0 = (1 + cos) / 2;
    b1 = -(1 + cos);
    b2 = (1 + cos) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
  } else if (kind === 'bp') {
    // Constant 0 dB peak gain.
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
  } else {
    const A = 10 ** (gainDb / 40);
    b0 = 1 + alpha * A;
    b1 = -2 * cos;
    b2 = 1 - alpha * A;
    a0 = 1 + alpha / A;
    a1 = -2 * cos;
    a2 = 1 - alpha / A;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Butterworth Q values for a cascade of `order / 2` biquads. */
export function butterworthQs(order: number): number[] {
  const n = order / 2;
  const qs: number[] = [];
  for (let k = 0; k < n; k++) qs.push(1 / (2 * Math.cos((Math.PI * (2 * k + 1)) / (2 * order))));
  return qs;
}

/** Butterworth low- or high-pass of even order as a biquad cascade. */
export function butterworth(kind: 'lp' | 'hp', fc: number, order: number, fs: number): Biquad[] {
  return butterworthQs(order).map((q) => biquad(kind, fc, q, fs));
}

/** Apply a biquad cascade in place (transposed direct form II, zero initial state). */
export function applyCascade(x: Float64Array, stages: readonly Biquad[]): Float64Array {
  for (const f of stages) {
    let z1 = 0;
    let z2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = x[i] as number;
      const y = f.b0 * v + z1;
      z1 = f.b1 * v - f.a1 * y + z2;
      z2 = f.b2 * v - f.a2 * y;
      // Flush the state before it decays into subnormals (which are very slow on x86).
      if (Math.abs(z1) < 1e-30) z1 = 0;
      if (Math.abs(z2) < 1e-30) z2 = 0;
      x[i] = Math.abs(y) < 1e-30 ? 0 : y;
    }
  }
  return x;
}

/** Magnitude response of a cascade at `hz`, linear. */
export function cascadeGainAt(stages: readonly Biquad[], hz: number, fs: number): number {
  const w = (2 * Math.PI * hz) / fs;
  let g = 1;
  for (const f of stages) {
    // H(e^jw) = (b0 + b1 z^-1 + b2 z^-2) / (1 + a1 z^-1 + a2 z^-2)
    const c1 = Math.cos(w);
    const s1 = -Math.sin(w);
    const c2 = Math.cos(2 * w);
    const s2 = -Math.sin(2 * w);
    const nr = f.b0 + f.b1 * c1 + f.b2 * c2;
    const ni = f.b1 * s1 + f.b2 * s2;
    const dr = 1 + f.a1 * c1 + f.a2 * c2;
    const di = f.a1 * s1 + f.a2 * s2;
    g *= Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
  }
  return g;
}

export const nextPow2 = (n: number): number => {
  let p = 1;
  while (p < n) p *= 2;
  return p;
};

/** In-place iterative radix-2 complex FFT. `inverse` scales by 1/n. */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i] as number;
      re[i] = re[j] as number;
      re[j] = tr;
      const ti = im[i] as number;
      im[i] = im[j] as number;
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const xr = (re[b] as number) * cr - (im[b] as number) * ci;
        const xi = (re[b] as number) * ci + (im[b] as number) * cr;
        re[b] = (re[a] as number) - xr;
        im[b] = (im[a] as number) - xi;
        re[a] = (re[a] as number) + xr;
        im[a] = (im[a] as number) + xi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] = (re[i] as number) / n;
      im[i] = (im[i] as number) / n;
    }
  }
}

/** Linear convolution of `x` with `h` by FFT overlap-add; output has x.length samples (the tail is cut). */
export function convolve(x: Float64Array, h: Float64Array): Float64Array {
  const out = new Float64Array(x.length);
  if (h.length === 0 || x.length === 0) return out;
  // A large transform relative to the IR keeps the block count (and the total cost) low.
  const size = nextPow2(Math.max(4 * h.length, 4096));
  const block = size - h.length + 1;
  const hr = new Float64Array(size);
  const hi = new Float64Array(size);
  hr.set(h);
  fft(hr, hi);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let start = 0; start < x.length; start += block) {
    re.fill(0);
    im.fill(0);
    const end = Math.min(x.length, start + block);
    for (let i = start; i < end; i++) re[i - start] = x[i] as number;
    fft(re, im);
    for (let k = 0; k < size; k++) {
      const ar = re[k] as number;
      const ai = im[k] as number;
      const br = hr[k] as number;
      const bi = hi[k] as number;
      re[k] = ar * br - ai * bi;
      im[k] = ar * bi + ai * br;
    }
    fft(re, im, true);
    const lim = Math.min(size, x.length - start);
    for (let k = 0; k < lim; k++) out[start + k] = (out[start + k] as number) + (re[k] as number);
  }
  return out;
}

/** Standard normal sample (Box-Muller, one value per call; uses two uniforms). */
export function gauss(rng: Rng): number {
  const u = Math.max(1e-12, rng.next());
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Windowed-sinc (Blackman) low-pass FIR, odd length, unity DC gain. `fc` in Hz. */
export function firLowpass(fc: number, fs: number, taps: number): Float64Array {
  const n = taps | 1;
  const m = (n - 1) / 2;
  const h = new Float64Array(n);
  const wc = (2 * Math.PI * fc) / fs;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const k = i - m;
    const sinc = k === 0 ? wc / Math.PI : Math.sin(wc * k) / (Math.PI * k);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (n - 1));
    h[i] = sinc * w;
    sum += h[i] as number;
  }
  for (let i = 0; i < n; i++) h[i] = (h[i] as number) / sum;
  return h;
}

/**
 * Zero-phase decimation by an integer factor: a Blackman windowed-sinc low-pass with its edge at 0.42 of the new
 * rate (stopband from about 0.47), applied by FFT and centred so no delay is introduced, then every `factor`-th
 * sample. Output sample j is input sample j * factor.
 */
export function decimate(x: Float64Array, factor: number, fs: number): Float64Array {
  if (!Number.isInteger(factor) || factor < 1) throw new RangeError('decimate: factor must be a positive integer');
  if (factor === 1) return Float64Array.from(x);
  const h = firLowpass((0.445 * fs) / factor, fs, 96 * factor + 1);
  const m = (h.length - 1) / 2;
  const padded = new Float64Array(x.length + m);
  padded.set(x);
  const y = convolve(padded, h);
  const n = Math.floor((x.length - 1) / factor) + 1;
  const out = new Float64Array(n);
  for (let j = 0; j < n; j++) out[j] = y[j * factor + m] as number;
  return out;
}

/** FNV-1a over the 16-bit quantised samples: a cheap determinism fingerprint. */
export function fingerprint(samples: ArrayLike<number>): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < samples.length; i++) {
    const q = Math.max(-32768, Math.min(32767, Math.round((samples[i] as number) * 32767))) & 0xffff;
    h ^= q & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
    h ^= q >> 8;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
