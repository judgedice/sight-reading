/**
 * Radix-2 FFT with precomputed tables (port of ear-to-staff js/fft.js, 01 section 7.3).
 * Double precision tables and no allocation in `transform`. `autocorrelate` computes the linear
 * autocorrelation of a real signal through a zero-padded transform (the NSDF numerator).
 */

export class FFT {
  readonly n: number;
  private readonly rev: Uint32Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;

  constructor(n: number) {
    if (!Number.isInteger(n) || n < 2 || (n & (n - 1)) !== 0) throw new RangeError('FFT size must be a power of two >= 2');
    this.n = n;
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((-2 * Math.PI * i) / n);
    }
  }

  /** In-place forward complex FFT (e^{-i...}). */
  transform(re: Float64Array, im: Float64Array): void {
    const n = this.n;
    const rev = this.rev;
    for (let i = 0; i < n; i++) {
      const j = rev[i] as number;
      if (j > i) {
        let t = re[i] as number;
        re[i] = re[j] as number;
        re[j] = t;
        t = im[i] as number;
        im[i] = im[j] as number;
        im[j] = t;
      }
    }
    const cos = this.cos;
    const sin = this.sin;
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = cos[k * step] as number;
          const wi = sin[k * step] as number;
          const a = start + k;
          const b = a + half;
          const br = re[b] as number;
          const bi = im[b] as number;
          const tr = br * wr - bi * wi;
          const ti = br * wi + bi * wr;
          const ar = re[a] as number;
          const ai = im[a] as number;
          re[b] = ar - tr;
          im[b] = ai - ti;
          re[a] = ar + tr;
          im[a] = ai + ti;
        }
      }
    }
  }
}

/**
 * Linear autocorrelation of a real signal through a 2n-point transform.
 * `out[tau] = sum_i x[i] * x[i + tau]` for tau in [0, n).
 */
export class Autocorrelator {
  readonly n: number;
  private readonly fft: FFT;
  private readonly re: Float64Array;
  private readonly im: Float64Array;

  /** @param n signal length (power of two); the transform size is 2n. */
  constructor(n: number) {
    this.n = n;
    this.fft = new FFT(2 * n);
    this.re = new Float64Array(2 * n);
    this.im = new Float64Array(2 * n);
  }

  /** Reads `n` samples of `x` from `offset`; writes `n` lags to `out`. */
  compute(x: ArrayLike<number>, offset: number, out: Float64Array): void {
    const n = this.n;
    const m = 2 * n;
    const re = this.re;
    const im = this.im;
    for (let i = 0; i < n; i++) re[i] = x[offset + i] as number;
    re.fill(0, n);
    im.fill(0);
    this.fft.transform(re, im);
    for (let i = 0; i < m; i++) {
      const a = re[i] as number;
      const b = im[i] as number;
      re[i] = a * a + b * b;
      im[i] = 0;
    }
    // The power spectrum is real and even, so the forward transform equals m times the inverse.
    this.fft.transform(re, im);
    const inv = 1 / m;
    for (let i = 0; i < n; i++) out[i] = (re[i] as number) * inv;
  }
}

export function hannWindow(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}
