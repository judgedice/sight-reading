/**
 * Metronome click bleed rejection on speakers (01 section 7.6, P4d). All of it is off in headphone modes (`wired`,
 * `bluetooth`), where there is no bleed and gating could only suppress real on-beat onsets.
 *
 * 1. Spectral separation (Tick above the 3 kHz analysis low-pass) needs no code: the capture filters do it.
 * 2. Template subtraction (`ClickSubtractor`): at each known arrival the low-band click template is aligned within
 *    +-1 ms by cross-correlation (integer lag, then a parabolic fractional refinement), resampled at that fractional
 *    shift with a windowed sinc, its gain fitted by least squares (clamped to [0, 2 x nominal]), and subtracted from
 *    the low band before the envelope, flux and pitch analysis see it. Lag and gain are fitted on whitened signals.
 *    When the music dominates the window (the fit is not `confident`), the lag and level come from the recent clicks
 *    that stood out (the count-in, rests), since a least-squares fit there would mostly fit the music. The
 *    subtractor holds back only the samples around a click until the whole template span (plus the search margin)
 *    has arrived, so it adds at most about 24 ms of latency, and only to audio near a click; everything else passes
 *    straight through.
 * 3-5. Time gating, flux exclusion and the leak floor are applied by the segmenter (segmenter.ts) inside the click
 *    windows `[arrival - 5 ms, arrival + 35 ms]`, using the per-click leak levels measured here (`ClickFit`).
 *
 * Template convention (shared with calibration, which builds templates with `buildClickTemplate`): a template is
 * the low-band (decimated, analysis-rate) plain click as received at the take's metronome level, sample 0 at
 * `arrival - CLICK_TEMPLATE_PRE_SEC`. Whoever builds the DspConfig scales the calibration template by the ratio of
 * the take's click gain to the calibration's. Accented clicks use the same template with a nominal gain of +5 dB;
 * the least-squares gain is free within [0, CLICK_GAIN_MAX x nominal].
 */
import type { OutputMode } from '../core/types.ts';

/** Template sample 0 sits this long before the nominal arrival (the decimator's filters spread the onset). */
export const CLICK_TEMPLATE_PRE_SEC = 0.002;
/** Default template length (pre-roll included). Wood's low-band click holds 99.9% of its energy in 6 ms dry. */
export const CLICK_TEMPLATE_SEC = 0.02;
/** Alignment search, +- seconds around the nominal arrival (7.6 item 2). */
export const CLICK_ALIGN_SEC = 0.001;
/**
 * The fitted gain is limited to [0, CLICK_GAIN_MAX x nominal] (nominal 1 for a plain click, the accent gain for an
 * accented one). Without the limit, a template far below the music (Tick, 35 to 48 dB down in the low band) would
 * be scaled up to fit the instrument and subtract part of the note.
 */
export const CLICK_GAIN_MAX = 2;
/** Accent level over a plain click (01 section 7.6: +5 dB). */
export const CLICK_ACCENT_GAIN = Math.pow(10, 5 / 20);
/** A fit is the click's own when its whitened normalised correlation squared reaches this. */
export const CLICK_CONFIDENT_RHO2 = 0.5;
/** Confident fits remembered for the lag and level of the others. */
const TRACK_LEN = 8;
/** Whitening FIR for the fit (a second difference: +12 dB per octave, about -17 dB at 300 Hz against 2.5 kHz). */
const WHITEN = [1, -2, 1] as const;
/** Windowed-sinc half-width for fractional shifts, samples. */
const SINC_HALF = 8;

/** Bleed rejection runs only on speakers (01 section 7.6). */
export const clickHandlingActive = (mode: OutputMode): boolean => mode === 'speakers';

/** Result of one template fit. */
export interface ClickFit {
  /** Nominal arrival, seconds (input timeline). */
  arrival: number;
  /** Fitted shift of the template against the nominal arrival, seconds (within +-CLICK_ALIGN_SEC). */
  shiftSec: number;
  /** Gain of the subtracted template, limited to [0, CLICK_GAIN_MAX x nominal]. */
  gain: number;
  /**
   * The click stood out of the window (whitened normalised correlation^2 >= CLICK_CONFIDENT_RHO2): lag and gain are
   * this click's own least-squares fit. Otherwise (music dominates) they are the medians of the recent confident
   * fits (the count-in clicks before the music), or the nominal arrival with its least-squares gain before any.
   */
  confident: boolean;
  /** Peak 2 ms RMS of the fitted click, dBFS: what the click alone adds to the envelope. */
  leakEnvDb: number;
  /** Power of the fitted click averaged over `leakWindowSec` (one pitch window), dBFS: what it adds to a frame's rmsDb. */
  leakFrameDb: number;
  /** Low-band energy in the fit span before and after subtraction, dB (relative, sum of squares). */
  beforeDb: number;
  afterDb: number;
}

const db = (p: number): number => (p > 0 ? 10 * Math.log10(p) : -120);

/** sin(pi x)/(pi x) with a Blackman window of half-width SINC_HALF. */
function wsinc(x: number): number {
  if (Math.abs(x) >= SINC_HALF) return 0;
  const w = 0.42 + 0.5 * Math.cos((Math.PI * x) / SINC_HALF) + 0.08 * Math.cos((2 * Math.PI * x) / SINC_HALF);
  if (Math.abs(x) < 1e-9) return w;
  const px = Math.PI * x;
  return (w * Math.sin(px)) / px;
}

/** Value of `src` (zero outside) at fractional index `p`, by windowed-sinc interpolation. */
function interp(src: ArrayLike<number>, p: number): number {
  const i0 = Math.floor(p);
  const f = p - i0;
  if (f < 1e-9) return i0 >= 0 && i0 < src.length ? (src[i0] as number) : 0;
  let s = 0;
  for (let k = -SINC_HALF + 1; k <= SINC_HALF; k++) {
    const j = i0 + k;
    if (j < 0 || j >= src.length) continue;
    s += (src[j] as number) * wsinc(k - f);
  }
  return s;
}

/** Peak power over `hop`-sample RMS windows (non-overlapping, like EnvelopeFollower). */
function peakHopPower(x: ArrayLike<number>, hop: number, gain: number): number {
  let best = 0;
  for (let a = 0; a < x.length; a += hop) {
    let s = 0;
    const b = Math.min(x.length, a + hop);
    for (let i = a; i < b; i++) s += (x[i] as number) * (x[i] as number);
    best = Math.max(best, s / hop);
  }
  return best * gain * gain;
}

export interface ClickSubtractorOptions {
  /** Analysis-window length for `leakFrameDb`, seconds (the pitch window). */
  leakWindowSec: number;
  /** Envelope hop for `leakEnvDb`, seconds (default 2 ms). */
  envHopSec?: number;
  alignSec?: number;
}

/**
 * Streaming template subtraction on the low band. Samples are indexed from the first pushed sample (time
 * `startT`); `push` returns the samples released so far, in order, with no gaps or repeats, so the released stream
 * is the input stream with the clicks removed, delayed only near clicks.
 */
export class ClickSubtractor {
  readonly rate: number;
  readonly fits: ClickFit[] = [];
  private readonly tpl: Float32Array;
  private readonly tplEnergy: number;
  /** Template start indices (fractional, in stream samples) of the clicks, sorted. */
  private readonly starts: Float64Array;
  private readonly arrivals: Float64Array;
  private readonly accents: Uint8Array;
  private readonly search: number;
  private readonly leakWindow: number;
  private readonly envHop: number;
  private next = 0;
  // buffer of not-yet-released samples: buf[0] is stream index `bufStart`
  private buf: Float64Array;
  private bufStart = 0;
  private bufLen = 0;
  private out: Float32Array;
  private shifted: Float64Array;
  private readonly corr: Float64Array;
  private readonly tplW: Float64Array;
  private readonly trackOffset: number[] = [];
  private readonly trackGain: number[] = [];

  constructor(
    template: Float32Array,
    clicks: readonly { arrival: number; accent: boolean }[],
    rate: number,
    startT: number,
    opts: ClickSubtractorOptions,
  ) {
    this.rate = rate;
    this.tpl = template;
    let e = 0;
    for (let i = 0; i < template.length; i++) e += (template[i] as number) ** 2;
    this.tplEnergy = e;
    const sorted = [...clicks].sort((a, b) => a.arrival - b.arrival);
    const arr = sorted.map((c) => c.arrival);
    this.arrivals = Float64Array.from(arr);
    this.accents = Uint8Array.from(sorted.map((c) => (c.accent ? 1 : 0)));
    this.starts = Float64Array.from(arr.map((a) => (a - CLICK_TEMPLATE_PRE_SEC - startT) * rate));
    this.search = Math.max(1, Math.round((opts.alignSec ?? CLICK_ALIGN_SEC) * rate));
    this.leakWindow = Math.max(1, Math.round(opts.leakWindowSec * rate));
    this.envHop = Math.max(1, Math.round((opts.envHopSec ?? 0.002) * rate));
    const span = template.length + 2 * (this.search + SINC_HALF) + 4;
    this.buf = new Float64Array(Math.max(4096, 4 * span));
    this.out = new Float32Array(4096);
    this.shifted = new Float64Array(span);
    this.corr = new Float64Array(2 * this.search + 1);
    const L = template.length;
    const tAt = (i: number): number => (i >= 0 && i < L ? (template[i] as number) : 0);
    this.tplW = new Float64Array(L + 2);
    for (let i = -1; i <= L; i++) this.tplW[i + 1] = tAt(i - 1) * WHITEN[0] + tAt(i) * WHITEN[1] + tAt(i + 1) * WHITEN[2];
    // Clicks whose template would start before the stream cannot be fitted; skip them.
    while (this.next < this.starts.length && (this.starts[this.next] as number) - this.search - SINC_HALF < 0) this.next++;
  }

  /** Stream index of the next sample to be released. */
  get released(): number {
    return this.bufStart;
  }

  /** Appends `n` samples and returns the released ones (a view valid until the next call). */
  push(x: ArrayLike<number>, n: number = x.length): Float32Array {
    this.append(x, n);
    return this.release(false);
  }

  /** Releases everything still held (fitting any click whose span is only partly present). */
  flush(): Float32Array {
    return this.release(true);
  }

  private append(x: ArrayLike<number>, n: number): void {
    if (this.bufLen + n > this.buf.length) {
      const b = new Float64Array(Math.max(this.buf.length * 2, this.bufLen + n));
      b.set(this.buf.subarray(0, this.bufLen));
      this.buf = b;
    }
    for (let i = 0; i < n; i++) this.buf[this.bufLen + i] = x[i] as number;
    this.bufLen += n;
  }

  private release(final: boolean): Float32Array {
    const end = this.bufStart + this.bufLen;
    // Fit every click whose whole span (template + search + sinc margin) is in the buffer.
    for (;;) {
      if (this.next >= this.starts.length) break;
      const s = this.starts[this.next] as number;
      const spanEnd = Math.ceil(s + this.tpl.length + this.search + SINC_HALF) + 3;
      if (spanEnd > end && !final) break;
      this.fit(this.next);
      this.next++;
    }
    // Release up to the start of the next unfitted click's span.
    let upTo = end;
    if (this.next < this.starts.length && !final) {
      const s = this.starts[this.next] as number;
      upTo = Math.min(end, Math.max(this.bufStart, Math.floor(s - this.search - SINC_HALF) - 3));
    }
    const k = upTo - this.bufStart;
    if (this.out.length < k) this.out = new Float32Array(Math.max(k, this.out.length * 2));
    for (let i = 0; i < k; i++) this.out[i] = this.buf[i] as number;
    this.buf.copyWithin(0, k, this.bufLen);
    this.bufLen -= k;
    this.bufStart += k;
    return this.out.subarray(0, k);
  }

  private fit(idx: number): void {
    const s0 = this.starts[idx] as number;
    const T = this.tpl;
    const L = T.length;
    const S = this.search;
    const buf = this.buf;
    const base = this.bufStart;
    const end = base + this.bufLen;
    const at = (j: number): number => (j >= base && j < end ? (buf[j - base] as number) : 0);
    // The fit runs on whitened signals (WHITEN, a second difference): the click lives at 1.5 to 3 kHz, the music's
    // low-band energy mostly below, so the music biases the lag and the gain far less there. The unwhitened
    // template is then subtracted with the fitted lag and gain (whitening is linear and time-invariant).
    const xw = (j: number): number => at(j - 1) * WHITEN[0] + at(j) * WHITEN[1] + at(j + 1) * WHITEN[2];
    const Tw = this.tplW; // Tw[i + 1] is the whitened template at i, i in [-1, L]
    // Integer lags around the nominal start: template sample i sits at stream index round(s0) + lag + i.
    const r0 = Math.round(s0);
    const corr = this.corr;
    let bestL = 0;
    let best = -Infinity;
    for (let l = -S; l <= S; l++) {
      let c = 0;
      for (let i = -1; i <= L; i++) c += xw(r0 + l + i) * (Tw[i + 1] as number);
      corr[l + S] = c;
      if (c > best) {
        best = c;
        bestL = l;
      }
    }
    let frac = 0;
    if (bestL > -S && bestL < S) {
      const a = corr[bestL + S - 1] as number;
      const b = corr[bestL + S] as number;
      const c = corr[bestL + S + 1] as number;
      const den = a - 2 * b + c;
      if (den < 0) frac = Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den));
    }
    const searched = r0 + bestL + frac; // stream index of template sample 0
    let fitted = this.place(searched, xw);
    const rho2 = fitted.xx > 0 && fitted.tt > 0 ? (fitted.xt * fitted.xt) / (fitted.tt * fitted.xx) : 0;
    const nominal = this.accents[idx] ? CLICK_ACCENT_GAIN : 1;
    const confident = best > 0 && rho2 >= CLICK_CONFIDENT_RHO2;
    let shift = searched;
    let gain: number;
    if (confident) {
      gain = Math.min(CLICK_GAIN_MAX * nominal, Math.max(0, fitted.xt / fitted.tt));
      this.trackOffset.push(searched - s0);
      this.trackGain.push(gain / nominal);
      if (this.trackOffset.length > TRACK_LEN) {
        this.trackOffset.shift();
        this.trackGain.shift();
      }
    } else if (this.trackOffset.length > 0) {
      // Music dominates the window: the clicks that stood out (count-in, rests) fix the lag and the level.
      shift = s0 + medianOf(this.trackOffset);
      fitted = this.place(shift, xw);
      gain = Math.min(CLICK_GAIN_MAX * nominal, medianOf(this.trackGain) * nominal);
    } else {
      shift = s0;
      fitted = this.place(shift, xw);
      gain = fitted.tt > 0 ? Math.min(CLICK_GAIN_MAX * nominal, Math.max(0, fitted.xt / fitted.tt)) : 0;
    }
    const { j0, n } = fitted;
    const ts = this.shifted;
    let xx = 0;
    let after = 0;
    for (let k = 0; k < n; k++) {
      const j = j0 + k;
      if (j < base || j >= end) continue;
      const x = buf[j - base] as number;
      xx += x * x;
      const v = x - gain * (ts[k] as number);
      buf[j - base] = v;
      after += v * v;
    }
    const arrival = this.arrivals[idx] as number;
    this.fits.push({
      arrival,
      shiftSec: (shift - s0) / this.rate,
      gain,
      confident,
      leakEnvDb: db(peakHopPower(T, this.envHop, gain)),
      leakFrameDb: db((gain * gain * this.tplEnergy) / this.leakWindow),
      beforeDb: db(xx),
      afterDb: db(after),
    });
  }

  /**
   * Resamples the template with sample 0 at stream index `shift` into `shifted` (span j0 .. j0 + n - 1) and returns
   * the whitened dot products: tt = |Tw|^2, xt = <xw, Tw>, xx = |xw|^2 over the span.
   */
  private place(shift: number, xw: (j: number) => number): { j0: number; n: number; tt: number; xt: number; xx: number } {
    const T = this.tpl;
    const j0 = Math.floor(shift) - SINC_HALF;
    const j1 = Math.ceil(shift + T.length) + SINC_HALF;
    const n = j1 - j0 + 1;
    if (this.shifted.length < n) this.shifted = new Float64Array(n);
    const ts = this.shifted;
    for (let k = 0; k < n; k++) ts[k] = interp(T, j0 + k - shift);
    const tsAt = (k: number): number => (k >= 0 && k < n ? (ts[k] as number) : 0);
    let tt = 0;
    let xt = 0;
    let xx = 0;
    for (let k = -1; k <= n; k++) {
      const v = tsAt(k - 1) * WHITEN[0] + tsAt(k) * WHITEN[1] + tsAt(k + 1) * WHITEN[2];
      const x = xw(j0 + k);
      tt += v * v;
      xt += x * v;
      xx += x * x;
    }
    return { j0, n, tt, xt, xx };
  }
}

const medianOf = (xs: readonly number[]): number => {
  const a = [...xs].sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? (a[m] as number) : 0.5 * ((a[m - 1] as number) + (a[m] as number));
};

/**
 * Builds a low-band click template from a recording of clicks alone (calibration, P14): every received click is
 * cut at its arrival (windowed-sinc, so fractional arrivals are exact), aligned to the first-pass mean within
 * +-`alignSec` by cross-correlation, and averaged, with accented clicks divided by `accentGain` (default +5 dB), so
 * the result is the plain click at the calibration's metronome level.
 */
export function buildClickTemplate(
  low: ArrayLike<number>,
  startT: number,
  rate: number,
  clicks: readonly { arrival: number; accent?: boolean }[],
  opts: { lengthSec?: number; alignSec?: number; accentGain?: number } = {},
): Float32Array {
  const L = Math.max(8, Math.round((opts.lengthSec ?? CLICK_TEMPLATE_SEC) * rate));
  const S = Math.max(1, Math.round((opts.alignSec ?? CLICK_ALIGN_SEC) * rate));
  const accentGain = opts.accentGain ?? CLICK_ACCENT_GAIN;
  const cut = (startIdx: number): Float64Array => {
    const seg = new Float64Array(L);
    for (let i = 0; i < L; i++) seg[i] = interp(low, startIdx + i);
    return seg;
  };
  const usable = clicks.filter((c) => {
    const s = (c.arrival - CLICK_TEMPLATE_PRE_SEC - startT) * rate;
    return s - S - SINC_HALF >= 0 && s + L + S + SINC_HALF < low.length;
  });
  const mean = new Float64Array(L);
  if (usable.length === 0) return new Float32Array(L);
  const startOf = (c: { arrival: number }): number => (c.arrival - CLICK_TEMPLATE_PRE_SEC - startT) * rate;
  for (const c of usable) {
    const g = c.accent ? accentGain : 1;
    const seg = cut(startOf(c));
    for (let i = 0; i < L; i++) mean[i] = (mean[i] as number) + (seg[i] as number) / g / usable.length;
  }
  // One refinement pass: align each click to the first-pass mean.
  const refined = new Float64Array(L);
  for (const c of usable) {
    const s = startOf(c);
    let bestL = 0;
    let best = -Infinity;
    const corr: number[] = [];
    for (let l = -S; l <= S; l++) {
      let v = 0;
      for (let i = 0; i < L; i++) v += interp(low, s + l + i) * (mean[i] as number);
      corr.push(v);
      if (v > best) {
        best = v;
        bestL = l;
      }
    }
    let frac = 0;
    if (bestL > -S && bestL < S) {
      const a = corr[bestL + S - 1] as number;
      const b = corr[bestL + S] as number;
      const d = corr[bestL + S + 1] as number;
      const den = a - 2 * b + d;
      if (den < 0) frac = Math.max(-0.5, Math.min(0.5, (0.5 * (a - d)) / den));
    }
    const g = c.accent ? accentGain : 1;
    const seg = cut(s + bestL + frac);
    for (let i = 0; i < L; i++) refined[i] = (refined[i] as number) + (seg[i] as number) / g / usable.length;
  }
  return Float32Array.from(refined);
}
