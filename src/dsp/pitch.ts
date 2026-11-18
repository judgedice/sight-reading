/**
 * Pitch (P4b, 01 sections 5.6, 7.3, 8.4). McLeod pitch method with an FFT-computed NSDF.
 *
 * - `PitchDetector` analyses one window: NSDF over every lag below n/2, peak picking limited to the lag range of the
 *   instrument's sounding range, `peakCutoff = 0.9`, parabolic interpolation (three-point cosine interpolation for
 *   short lags, where a parabola is biased). `nsdfAtHz` reads the NSDF at any frequency for `altOctaveClarity`.
 * - `OctaveHysteresis`: a 12 +/- 0.5 semitone jump against the current note's median must persist for 4 frames,
 *   otherwise the frame is folded back an octave.
 * - `PitchAnalyzer`: streams decimated samples, hop 128, and stamps each frame at its window centre:
 *   `t = blockStart + (frameStartSample + W/2) / analysisRate`, so a step change has no W/2 late bias.
 *
 * Zero allocation per frame apart from the returned frame objects.
 */
import type { ClockSeconds, PitchFrame } from '../core/types.ts';
import { Autocorrelator } from './fft.ts';

export const PEAK_CUTOFF = 0.9;
/** Lags are limited to the instrument's sounding range widened by this many semitones (01 7.3). */
export const RANGE_WIDEN_SEMITONES = 3;
export const OCTAVE_PERSIST_FRAMES = 4;
/** Half-width in semitones of the band around 12 that counts as an octave jump. */
export const OCTAVE_TOLERANCE_SEMITONES = 0.5;
/** Below this window RMS (linear) the frame is silent. */
export const SILENCE_RMS = 1e-5;
/** Lags below this use cosine interpolation of the NSDF peak. */
const COSINE_INTERP_MAX_LAG = 24;

export const freqToMidi = (hz: number, a4 = 440): number => 69 + 12 * Math.log2(hz / a4);
export const midiToFreq = (midi: number, a4 = 440): number => a4 * Math.pow(2, (midi - 69) / 12);

/** Widens a sounding range [lowHz, highHz] by `semitones` each way (01 7.3). */
export function widenRange(lowHz: number, highHz: number, semitones = RANGE_WIDEN_SEMITONES): { minHz: number; maxHz: number } {
  const k = Math.pow(2, semitones / 12);
  return { minHz: lowHz / k, maxHz: highHz * k };
}

export interface PitchDetectorOptions {
  analysisRate: number;
  windowSamples: 512 | 1024 | 2048;
  /** Lag limits: detection range in Hz (already widened; `widenRange` does it). */
  minHz: number;
  maxHz: number;
  a4Hz?: number;
  peakCutoff?: number;
}

export interface PitchResult {
  /** Hz, NaN when no peak was found. */
  freq: number;
  /** NSDF value at the chosen peak, 0 when none. */
  clarity: number;
  /** Fractional MIDI at `a4Hz`, NaN when freq is NaN. */
  midi: number;
  /** Window RMS (linear). */
  rms: number;
}

export class PitchDetector {
  readonly analysisRate: number;
  readonly windowSamples: number;
  readonly minHz: number;
  readonly maxHz: number;
  readonly a4Hz: number;
  readonly peakCutoff: number;
  readonly minTau: number;
  readonly maxTau: number;
  private readonly half: number;
  private readonly acf: Autocorrelator;
  private readonly acfBuf: Float64Array;
  private readonly prefix: Float64Array;
  private readonly nsdf: Float64Array;
  private readonly peakIdx = new Int32Array(512);
  private readonly peakVal = new Float64Array(512);
  private readonly peakLag = new Float64Array(512);
  private readonly result: PitchResult = { freq: NaN, clarity: 0, midi: NaN, rms: 0 };
  private valid = false;

  constructor(o: PitchDetectorOptions) {
    this.analysisRate = o.analysisRate;
    this.windowSamples = o.windowSamples;
    this.minHz = o.minHz;
    this.maxHz = o.maxHz;
    this.a4Hz = o.a4Hz ?? 440;
    this.peakCutoff = o.peakCutoff ?? PEAK_CUTOFF;
    const n = o.windowSamples;
    this.half = n >> 1;
    this.minTau = Math.max(2, Math.floor(o.analysisRate / o.maxHz));
    this.maxTau = Math.min(this.half, Math.ceil(o.analysisRate / o.minHz));
    this.acf = new Autocorrelator(n);
    this.acfBuf = new Float64Array(n);
    this.prefix = new Float64Array(n + 1);
    this.nsdf = new Float64Array(this.half + 2);
  }

  /** Last computed NSDF, lags 0..n/2 (valid after a non-silent `detect`). */
  get nsdfValues(): Float64Array {
    return this.nsdf;
  }

  /** The returned object is reused by the next call. */
  detect(buf: ArrayLike<number>, offset = 0): PitchResult {
    const n = this.windowSamples;
    const prefix = this.prefix;
    let acc = 0;
    prefix[0] = 0;
    for (let i = 0; i < n; i++) {
      const v = buf[offset + i] as number;
      acc += v * v;
      prefix[i + 1] = acc;
    }
    const rms = Math.sqrt(acc / n);
    const r = this.result;
    r.rms = rms;
    r.freq = NaN;
    r.midi = NaN;
    r.clarity = 0;
    this.valid = false;
    if (rms < SILENCE_RMS) return r;

    this.acf.compute(buf, offset, this.acfBuf);
    const nsdf = this.nsdf;
    const acfBuf = this.acfBuf;
    const total = acc;
    const hi = this.half;
    nsdf[0] = 1;
    for (let tau = 1; tau <= hi; tau++) {
      const m = (prefix[n - tau] as number) + (total - (prefix[tau] as number));
      nsdf[tau] = m > 0 ? (2 * (acfBuf[tau] as number)) / m : 0;
    }
    nsdf[hi + 1] = 0;
    this.valid = true;

    const minTau = this.minTau;
    const maxTau = this.maxTau;
    // Key maxima: the highest point of each positive lobe (lobes start after the lag-0 lobe has died away, so a
    // lobe that begins below minTau still counts when its peak lies inside the limits).
    let nPeaks = 0;
    let maxVal = 0;
    const peakIdx = this.peakIdx;
    const peakVal = this.peakVal;
    const peakLag = this.peakLag;
    let p = 1;
    while (p <= maxTau && (nsdf[p] as number) > 0) p++;
    while (p <= maxTau && nPeaks < peakIdx.length) {
      while (p <= maxTau && (nsdf[p] as number) <= 0) p++;
      if (p > maxTau) break;
      let bi = -1;
      let bv = 0;
      while (p <= maxTau && (nsdf[p] as number) > 0) {
        const v = nsdf[p] as number;
        if (p >= minTau && v > bv) {
          bv = v;
          bi = p;
        }
        p++;
      }
      if (bi >= 0) {
        this.refine(bi);
        peakIdx[nPeaks] = bi;
        peakVal[nPeaks] = this.refHeight;
        peakLag[nPeaks] = this.refLag;
        nPeaks++;
        if (this.refHeight > maxVal) maxVal = this.refHeight;
      }
    }
    if (nPeaks === 0) return r;
    const limit = maxVal * this.peakCutoff;
    let chosen = 0;
    for (let k = 0; k < nPeaks; k++) {
      if ((peakVal[k] as number) >= limit) {
        chosen = k;
        break;
      }
    }
    const refined = peakLag[chosen] as number;
    const chosenVal = peakVal[chosen] as number;

    r.freq = this.analysisRate / refined;
    r.clarity = chosenVal;
    r.midi = freqToMidi(r.freq, this.a4Hz);
    return r;
  }

  private refLag = 0;
  private refHeight = 0;

  /** Interpolates the NSDF peak at lag `t`: sets `refLag` (fractional lag) and `refHeight` (peak height, <= 1). */
  private refine(t: number): void {
    const nsdf = this.nsdf;
    const b = nsdf[t] as number;
    this.refLag = t;
    this.refHeight = b;
    if (t < 2 || t >= this.half) return;
    const a = nsdf[t - 1] as number;
    const c = nsdf[t + 1] as number;
    if (t <= COSINE_INTERP_MAX_LAG && b > 1e-9) {
      // Exact for a sinusoidal NSDF: y(x) = A cos(theta (x - d)) sampled at -1, 0, 1.
      const cosT = (a + c) / (2 * b);
      if (cosT > -1 && cosT < 1) {
        const theta = Math.acos(cosT);
        const sinT = Math.sin(theta);
        if (sinT > 1e-6) {
          const phi = Math.atan2((c - a) / (2 * sinT), b);
          const d = phi / theta;
          if (Math.abs(d) <= 1) {
            this.refLag = t + d;
            this.refHeight = Math.min(1, b / Math.cos(phi));
            return;
          }
        }
      }
    }
    const denom = a - 2 * b + c;
    if (Math.abs(denom) > 1e-12) {
      const d = (0.5 * (a - c)) / denom;
      if (Math.abs(d) <= 1) {
        this.refLag = t + d;
        this.refHeight = Math.min(1, b - 0.25 * (a - c) * d);
      }
    }
  }

  /**
   * NSDF at the lag of `hz` for the last detected window: the largest of the lags within one sample of the
   * (fractional) lag, linearly interpolated. Null when the lag is outside 2..n/2 or the window was silent.
   * Used for `altOctaveClarity` (01 7.3).
   */
  nsdfAtHz(hz: number): number | null {
    if (!this.valid || !(hz > 0)) return null;
    const lag = this.analysisRate / hz;
    if (lag < 2 || lag > this.half) return null;
    const nsdf = this.nsdf;
    const lo = Math.floor(lag);
    const f = lag - lo;
    const interp = (nsdf[lo] as number) * (1 - f) + (nsdf[lo + 1] as number) * f;
    // Allow for the peak sitting a fraction of a sample off: take the best of the neighbours' span.
    let best = interp;
    for (let k = Math.max(2, lo - 1); k <= Math.min(this.half, lo + 2); k++) {
      if (Math.abs(k - lag) <= 1 && (nsdf[k] as number) > best) best = nsdf[k] as number;
    }
    return best;
  }
}

/**
 * Octave hysteresis (01 7.3). Tracks the median of the frames accepted for the current note. A frame whose pitch
 * differs from that median by 12 +/- 0.5 semitones must persist (same direction, consecutive voiced frames) for
 * `persistFrames` frames before it is believed; until then it is folded back by an octave.
 */
export class OctaveHysteresis {
  private readonly persistFrames: number;
  private readonly ring: Float64Array;
  private readonly sorted: Float64Array;
  private count = 0;
  private head = 0;
  private pendingDir = 0;
  private pendingRun = 0;

  constructor(persistFrames = OCTAVE_PERSIST_FRAMES, medianFrames = 32) {
    this.persistFrames = persistFrames;
    this.ring = new Float64Array(medianFrames);
    this.sorted = new Float64Array(medianFrames);
  }

  /** New note: forget the median. */
  reset(): void {
    this.count = 0;
    this.head = 0;
    this.pendingDir = 0;
    this.pendingRun = 0;
  }

  /** Median of the accepted frames of the current note, NaN before any. */
  get median(): number {
    const n = this.count;
    if (n === 0) return NaN;
    const s = this.sorted;
    for (let i = 0; i < n; i++) s[i] = this.ring[i] as number;
    for (let i = 1; i < n; i++) {
      const v = s[i] as number;
      let j = i - 1;
      while (j >= 0 && (s[j] as number) > v) {
        s[j + 1] = s[j] as number;
        j--;
      }
      s[j + 1] = v;
    }
    return n & 1 ? (s[n >> 1] as number) : ((s[(n >> 1) - 1] as number) + (s[n >> 1] as number)) / 2;
  }

  /** Call for an unvoiced frame: breaks a pending jump. */
  gap(): void {
    this.pendingDir = 0;
    this.pendingRun = 0;
  }

  /** Returns the (possibly folded) fractional MIDI for a voiced frame. */
  process(midi: number): number {
    if (this.count === 0) {
      this.accept(midi);
      return midi;
    }
    const d = midi - this.median;
    const ad = Math.abs(d);
    if (Math.abs(ad - 12) <= OCTAVE_TOLERANCE_SEMITONES) {
      const dir = d > 0 ? 1 : -1;
      this.pendingRun = dir === this.pendingDir ? this.pendingRun + 1 : 1;
      this.pendingDir = dir;
      if (this.pendingRun >= this.persistFrames) {
        // Believed: the note really moved an octave. Restart the median at the new octave.
        this.count = 0;
        this.head = 0;
        this.pendingRun = 0;
        this.pendingDir = 0;
        this.accept(midi);
        return midi;
      }
      return midi - 12 * dir;
    }
    this.pendingDir = 0;
    this.pendingRun = 0;
    this.accept(midi);
    return midi;
  }

  private accept(midi: number): void {
    const cap = this.ring.length;
    this.ring[this.head] = midi;
    this.head = (this.head + 1) % cap;
    if (this.count < cap) this.count++;
  }
}

export interface PitchAnalyzerOptions extends PitchDetectorOptions {
  clarityThreshold: number;
  hopSamples?: number;
  hysteresis?: boolean;
}

/** One analysed frame: a `PitchFrame` without the segmenter-owned flux and click flags. */
export type PitchEstimate = Pick<PitchFrame, 't' | 'midi' | 'clarity' | 'rmsDb'> & {
  /** Detector output before octave hysteresis, null when unvoiced. */
  rawMidi: number | null;
  /** Absolute index (since the first pushed sample) of the window's first sample. */
  startSample: number;
};

interface BlockRecord {
  start: number;
  t: number;
}

/** Streams analysis-rate samples into centre-stamped pitch frames. */
export class PitchAnalyzer {
  readonly detector: PitchDetector;
  readonly hysteresis: OctaveHysteresis | null;
  readonly hop: number;
  readonly window: number;
  readonly rate: number;
  private readonly clarityThreshold: number;
  private buf: Float32Array;
  private bufStart = 0; // absolute index of buf[0]
  private bufLen = 0;
  private nextFrameStart = 0;
  private total = 0;
  private blocks: BlockRecord[] = [];

  constructor(o: PitchAnalyzerOptions) {
    this.detector = new PitchDetector(o);
    this.window = o.windowSamples;
    this.hop = o.hopSamples ?? 128;
    this.rate = o.analysisRate;
    this.clarityThreshold = o.clarityThreshold;
    this.hysteresis = o.hysteresis === false ? null : new OctaveHysteresis();
    this.buf = new Float32Array(this.window * 4);
  }

  /** The detector's NSDF at `hz` for the most recent frame, for `altOctaveClarity`. */
  altOctaveClarity(expectedMidi: number): number | null {
    return this.detector.nsdfAtHz(midiToFreq(expectedMidi, this.detector.a4Hz));
  }

  /** New note boundary from the segmenter: octave median restarts. */
  resetNote(): void {
    this.hysteresis?.reset();
  }

  /**
   * Appends `n` samples of `samples` (from index 0) whose first sample is at `startT` and returns the frames that
   * completed. Blocks are expected to be contiguous; each block's `startT` anchors the stamps of frames centred in it.
   */
  push(samples: ArrayLike<number>, startT: ClockSeconds | number, n = samples.length): PitchEstimate[] {
    this.blocks.push({ start: this.total, t: startT as number });
    if (this.blocks.length > 256) this.blocks.splice(0, this.blocks.length - 128);
    this.append(samples, n);
    this.total += n;
    const out: PitchEstimate[] = [];
    const W = this.window;
    while (this.nextFrameStart + W <= this.total) {
      out.push(this.frame(this.nextFrameStart));
      this.nextFrameStart += this.hop;
    }
    this.compact();
    return out;
  }

  private append(samples: ArrayLike<number>, n: number): void {
    if (this.bufLen + n > this.buf.length) {
      const nb = new Float32Array(Math.max(this.buf.length * 2, this.bufLen + n));
      nb.set(this.buf.subarray(0, this.bufLen));
      this.buf = nb;
    }
    const b = this.buf;
    const base = this.bufLen;
    for (let i = 0; i < n; i++) b[base + i] = samples[i] as number;
    this.bufLen += n;
  }

  private compact(): void {
    const keepFrom = this.nextFrameStart;
    const drop = keepFrom - this.bufStart;
    if (drop > this.buf.length / 2) {
      this.buf.copyWithin(0, drop, this.bufLen);
      this.bufLen -= drop;
      this.bufStart = keepFrom;
    }
  }

  private stamp(absSample: number): number {
    const blocks = this.blocks;
    let k = blocks.length - 1;
    while (k > 0 && (blocks[k] as BlockRecord).start > absSample) k--;
    const b = blocks[k] as BlockRecord;
    return b.t + (absSample - b.start) / this.rate;
  }

  private frame(start: number): PitchEstimate {
    const r = this.detector.detect(this.buf, start - this.bufStart);
    const t = this.stamp(start + this.window / 2);
    const rmsDb = r.rms > 1e-6 ? 20 * Math.log10(r.rms) : -120;
    let midi: number | null = null;
    let raw: number | null = null;
    if (Number.isFinite(r.midi)) raw = r.midi;
    if (raw !== null && r.clarity >= this.clarityThreshold) {
      midi = this.hysteresis ? this.hysteresis.process(raw) : raw;
    } else {
      this.hysteresis?.gap();
    }
    return { t: t as ClockSeconds, midi, clarity: r.clarity, rmsDb, rawMidi: raw, startSample: start };
  }
}
