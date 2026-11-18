/**
 * Band-limited spectral flux (01 section 7.5): 512-point Hann-windowed FFT at hop 128 on the decimated low band,
 * log-compressed magnitudes in 100 Hz to 3 kHz, half-wave rectified frame-to-frame difference (mean over the band).
 * Each value is stamped at its window centre, like the pitch frames (01 section 7.3).
 *
 * `AdaptiveThreshold` is the 7.5 threshold: median of the last 0.5 s of flux plus k x MAD (k = 3 by default; the
 * voice and bowed profiles use a larger k, "lower flux sensitivity"), with a small absolute minimum so that digital
 * silence (median and MAD zero) does not turn every rounding wiggle into a peak.
 *
 * Works in absolute decimated-sample indices; the caller maps indices to clock seconds. Zero allocation per frame.
 */
import { FFT, hannWindow } from './fft.ts';

export const FLUX_FFT_SIZE = 512;
export const FLUX_HOP = 128;
export const FLUX_LO_HZ = 100;
export const FLUX_HI_HZ = 3000;
/** Log compression: log(1 + FLUX_GAMMA * |X|), magnitudes normalised so a full-scale sine peaks near 1. */
export const FLUX_GAMMA = 1000;
export const FLUX_THRESHOLD_WINDOW_SEC = 0.5;
export const FLUX_THRESHOLD_MAD_K = 3;
/** Absolute minimum threshold (mean log-magnitude increase per bin). */
export const FLUX_THRESHOLD_MIN = 0.05;

export class SpectralFlux {
  readonly analysisRate: number;
  readonly size: number;
  readonly hop: number;
  readonly kLo: number;
  readonly kHi: number;
  private readonly fft: FFT;
  private readonly win: Float64Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly prevLog: Float64Array;
  private readonly curLog: Float64Array;
  private hasPrev = false;
  private buf: Float32Array;
  private bufStart = 0;
  private bufLen = 0;
  private total = 0;
  private nextFrameStart = 0;
  private readonly norm: number;

  constructor(analysisRate: number, size = FLUX_FFT_SIZE, hop = FLUX_HOP) {
    this.analysisRate = analysisRate;
    this.size = size;
    this.hop = hop;
    this.fft = new FFT(size);
    this.win = hannWindow(size);
    this.re = new Float64Array(size);
    this.im = new Float64Array(size);
    this.kLo = Math.max(1, Math.ceil((FLUX_LO_HZ * size) / analysisRate));
    this.kHi = Math.min(size / 2 - 1, Math.floor((FLUX_HI_HZ * size) / analysisRate));
    this.prevLog = new Float64Array(this.kHi + 1);
    this.curLog = new Float64Array(this.kHi + 1);
    this.buf = new Float32Array(size * 4);
    let wsum = 0;
    for (let i = 0; i < size; i++) wsum += this.win[i] as number;
    // A full-scale sine at a bin centre gives |X| = wsum / 2.
    this.norm = 2 / wsum;
  }

  /**
   * Appends `n` samples and calls `emit(centreSampleIndex, flux)` for each completed frame. The centre index is the
   * absolute index (since the first pushed sample) of the window centre, `start + size / 2`.
   */
  push(samples: ArrayLike<number>, n: number, emit: (centreIndex: number, value: number) => void): void {
    if (this.bufLen + n > this.buf.length) {
      const nb = new Float32Array(Math.max(this.buf.length * 2, this.bufLen + n));
      nb.set(this.buf.subarray(0, this.bufLen));
      this.buf = nb;
    }
    for (let i = 0; i < n; i++) this.buf[this.bufLen + i] = samples[i] as number;
    this.bufLen += n;
    this.total += n;
    while (this.nextFrameStart + this.size <= this.total) {
      emit(this.nextFrameStart + this.size / 2, this.frame(this.nextFrameStart - this.bufStart));
      this.nextFrameStart += this.hop;
    }
    const drop = this.nextFrameStart - this.bufStart;
    if (drop > this.buf.length / 2) {
      this.buf.copyWithin(0, drop, this.bufLen);
      this.bufLen -= drop;
      this.bufStart = this.nextFrameStart;
    }
  }

  private frame(off: number): number {
    const { re, im, win, size } = this;
    for (let i = 0; i < size; i++) {
      re[i] = (this.buf[off + i] as number) * (win[i] as number);
      im[i] = 0;
    }
    this.fft.transform(re, im);
    const cur = this.curLog;
    const prev = this.prevLog;
    let acc = 0;
    for (let k = this.kLo; k <= this.kHi; k++) {
      const a = re[k] as number;
      const b = im[k] as number;
      const l = Math.log(1 + FLUX_GAMMA * this.norm * Math.sqrt(a * a + b * b));
      cur[k] = l;
      if (this.hasPrev) {
        const d = l - (prev[k] as number);
        if (d > 0) acc += d;
      }
    }
    prev.set(cur);
    const first = !this.hasPrev;
    this.hasPrev = true;
    return first ? 0 : acc / (this.kHi - this.kLo + 1);
  }

  reset(): void {
    this.hasPrev = false;
    this.bufStart = 0;
    this.bufLen = 0;
    this.total = 0;
    this.nextFrameStart = 0;
  }
}

/** Median + k x MAD over a sliding window of the previous values (the value being tested is not included). */
export class AdaptiveThreshold {
  readonly capacity: number;
  readonly k: number;
  readonly minimum: number;
  private readonly ring: Float64Array;
  private readonly scratch: Float64Array;
  private count = 0;
  private head = 0;

  constructor(capacity: number, k = FLUX_THRESHOLD_MAD_K, minimum = FLUX_THRESHOLD_MIN) {
    this.capacity = Math.max(3, Math.round(capacity));
    this.k = k;
    this.minimum = minimum;
    this.ring = new Float64Array(this.capacity);
    this.scratch = new Float64Array(this.capacity);
  }

  /** Threshold for the next value, from the values pushed so far. */
  current(): number {
    const n = this.count;
    if (n === 0) return Infinity;
    const s = this.scratch;
    for (let i = 0; i < n; i++) s[i] = this.ring[i] as number;
    const med = medianInPlace(s, n);
    for (let i = 0; i < n; i++) s[i] = Math.abs((this.ring[i] as number) - med);
    const mad = medianInPlace(s, n);
    return Math.max(this.minimum, med + this.k * mad);
  }

  push(v: number): void {
    this.ring[this.head] = v;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }
}

/** Median of the first n values of `a` (sorts that prefix in place). */
export function medianInPlace(a: Float64Array, n: number): number {
  if (n === 0) return NaN;
  const s = a.subarray(0, n);
  s.sort();
  return n & 1 ? (s[n >> 1] as number) : ((s[(n >> 1) - 1] as number) + (s[n >> 1] as number)) / 2;
}
