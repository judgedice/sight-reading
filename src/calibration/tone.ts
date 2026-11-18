/**
 * Sanity tone and AEC signature (01 §7.8, 05 W3 item 3, 05 §4 gate (c)). Pure.
 *
 * Speakers only: a 300 ms sine at concert A4 is played after the loopback clicks and read from the low band with the
 * production MPM detector. A correct capture chain reads it within ±`sanityToneCents` (8); a context that
 * mis-resamples 44.1 against 48 kHz reads it about 147 cents off.
 *
 * AEC signature: loopback failed on the built-in speaker and the tone arrives more than `AEC_MARGIN_DB` below the
 * level predicted from the clicks (echo cancellers let the first transients through while they converge, then
 * cancel steady sound).
 */
import type { AudioRouteInfo } from '../core/types.ts';
import { PitchDetector, freqToMidi } from '../dsp/pitch.ts';
import type { CaptureRecording } from './recording.ts';
import { median, powerDb } from './stats.ts';

/** Sanity tone length, seconds (01 §7.8). */
export const SANITY_TONE_SEC = 0.3;
/** Tone reading excludes this much at each end (the backend's 10 ms fades and the detector window's spread). */
const TONE_EDGE_SEC = 0.05;
/** MPM window for the tone at about 16 kHz: 1024 samples (64 ms). */
const TONE_WINDOW = 1024;
/** Minimum clarity of a tone frame. */
const TONE_MIN_CLARITY = 0.9;
/** Frames needed for a reading. */
const TONE_MIN_FRAMES = 3;
/** The AEC signature: tone captured more than this below the click-predicted level, dB (01 §7.8). */
export const AEC_MARGIN_DB = 20;

export interface SanityToneReading {
  /** Reading minus the played pitch, cents; null when no steady tone was found. */
  cents: number | null;
  /** Captured tone level, dB (low-band mean square over the steady part); null when not measurable. */
  levelDb: number | null;
  framesUsed: number;
  /** |cents| within the limit. False when there is no reading. */
  withinLimit: boolean;
}

/**
 * Reads the tone played at `at` (output clock) for `durSec`. `lagSec` is the round-trip latency when known
 * (loopback accepted); otherwise the whole span `[at, at + durSec + maxLagSec]` is searched and the steady frames
 * with the highest level are used.
 */
export function analyzeSanityTone(
  rec: CaptureRecording,
  p: { at: number; durSec: number; hz: number; lagSec: number | null; maxLagSec: number; limitCents: number },
): SanityToneReading {
  const low = rec.lowband;
  const rate = rec.analysisRate;
  const det = new PitchDetector({ analysisRate: rate, windowSamples: TONE_WINDOW, minHz: p.hz / 1.5, maxHz: p.hz * 1.5 });
  const t0 = p.lagSec !== null ? p.at + p.lagSec + TONE_EDGE_SEC : p.at;
  const t1 = p.lagSec !== null ? p.at + p.lagSec + p.durSec - TONE_EDGE_SEC : p.at + p.durSec + p.maxLagSec;
  const hop = 128;
  const frames: { midi: number; db: number }[] = [];
  // Window centres inside [t0, t1].
  const startIdx = Math.ceil(rec.lowIndex(t0) - TONE_WINDOW / 2);
  const endIdx = Math.floor(rec.lowIndex(t1) - TONE_WINDOW / 2);
  for (let i = Math.max(0, startIdx); i <= endIdx && i + TONE_WINDOW <= low.length; i += hop) {
    const r = det.detect(low, i);
    if (!(r.clarity >= TONE_MIN_CLARITY) || !Number.isFinite(r.freq)) continue;
    frames.push({ midi: r.midi, db: powerDb(r.rms * r.rms) });
  }
  let used = frames;
  if (p.lagSec === null && frames.length > 0) {
    // Unknown lag: keep the frames within 6 dB of the loudest (the steady part of the tone).
    const top = Math.max(...frames.map((f) => f.db));
    used = frames.filter((f) => f.db >= top - 6);
  }
  if (used.length < TONE_MIN_FRAMES) return { cents: null, levelDb: used.length ? median(used.map((f) => f.db)) : null, framesUsed: used.length, withinLimit: false };
  const cents = 100 * (median(used.map((f) => f.midi)) - freqToMidi(p.hz));
  return { cents, levelDb: median(used.map((f) => f.db)), framesUsed: used.length, withinLimit: Math.abs(cents) <= p.limitCents };
}

/** Mean-square level of the low band over [t0, t1), dB (used when the tone gives no pitch reading). */
export function lowLevelDb(rec: CaptureRecording, t0: number, t1: number): number {
  const low = rec.lowband;
  const a = Math.max(0, Math.ceil(rec.lowIndex(t0)));
  const b = Math.min(low.length, Math.floor(rec.lowIndex(t1)));
  let s = 0;
  for (let i = a; i < b; i++) s += (low[i] as number) * (low[i] as number);
  return b > a ? powerDb(s / (b - a)) : powerDb(0);
}

/**
 * Output levels the tone prediction needs: the power of the played tone and of the played click's loudest 1 ms in
 * the hi band, both dB relative to full scale, as rendered by the backend. The prediction is
 * `clickPeakDb(captured) - clickOutDb + toneOutDb`; it assumes a flat speaker-to-mic response between the Tick band
 * and A4, which the 20 dB margin absorbs.
 */
export interface OutputLevels {
  toneOutDb: number;
  clickOutDb: number;
}

/**
 * The backend's defaults (src/platform/web/audio): the tone is a 0.5-amplitude sine (mean square 0.125, -9 dB); the
 * calibration click is an accented Tick at 0.5 x +5 dB, a noise burst normalised to peak 1 whose loudest hi-band
 * 1 ms holds a mean square of 0.13 to 0.16 of its peak squared (measured on the rendered burst at 44.1 and 48 kHz),
 * so -9.8 to -8.9 dB; -9.4 dB is the middle.
 */
export const DEFAULT_OUTPUT_LEVELS: OutputLevels = { toneOutDb: -9.0, clickOutDb: -9.4 };

export interface AecInput {
  loopbackAccepted: boolean;
  route: Pick<AudioRouteInfo, 'inputKind' | 'outputMode'>;
  /** Captured hi-band click peak, dB; null when no click was found. */
  clickPeakDb: number | null;
  /** Captured tone level, dB; null when unmeasured (then the low-band level over the tone span is used). */
  toneLevelDb: number | null;
  levels?: OutputLevels;
}

export interface AecVerdict {
  suspected: boolean;
  /** Predicted tone level from the clicks, dB; null without a click. */
  predictedToneDb: number | null;
  /** Predicted minus captured, dB; null without both. */
  shortfallDb: number | null;
}

export function aecSignature(i: AecInput): AecVerdict {
  const lv = i.levels ?? DEFAULT_OUTPUT_LEVELS;
  const predicted = i.clickPeakDb === null ? null : i.clickPeakDb - lv.clickOutDb + lv.toneOutDb;
  const shortfall = predicted === null || i.toneLevelDb === null ? null : predicted - i.toneLevelDb;
  const builtInSpeaker = i.route.outputMode === 'speakers' && i.route.inputKind === 'built-in';
  const suspected = !i.loopbackAccepted && builtInSpeaker && shortfall !== null && shortfall > AEC_MARGIN_DB;
  return { suspected, predictedToneDb: predicted, shortfallDb: shortfall };
}
