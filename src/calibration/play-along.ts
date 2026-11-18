/**
 * Play-along calibration (01 §7.8, 05 Q2): wired or Bluetooth headphones, or after loopback failed. Eight clicks at
 * 80 bpm; the player plays a short note on each; RTL = median(onset - click). Accept: MAD at most
 * `playAlong.maxMadMs` (15) and RTL in [minRtlMs, maxRtlMs] (0 to 400). Onsets come from the production
 * segmenter (DspPipeline, 01 §7.4 onset definition), so the RTL is measured the way take onsets are. Pure.
 */
import type { CaptureBlock } from '../core/platform.ts';
import type { ClockSeconds, DspConfig, OnsetProfile, VibratoClass, WindowSamples } from '../core/types.ts';
import { DspPipeline } from '../dsp/pipeline.ts';
import { matchArrivals, type ArrivalCandidate } from './arrivals.ts';
import type { CalibrationBudget } from './loopback.ts';
import { mad, median } from './stats.ts';

/**
 * Notes needed: the loopback's found ratio (7 of 10) applied to the play-along clicks, rounded up (6 of 8). 01 gives
 * no play-along count; this is P14's reading.
 */
export function playAlongMinNotes(budget: CalibrationBudget): number {
  return Math.ceil((budget.loopback.minFound / budget.loopback.clicks) * budget.playAlong.clicks);
}

/** Players anticipate clicks by 10 to 40 ms (01 §8.1); notes are searched from this long before the click (clicks are 750 ms apart). */
const EARLY_SEC = 0.15;
/** Onsets agreeing within this are one cluster when finding the consensus lag, seconds. */
const CLUSTER_SEC = 0.04;
/** A note is matched within this of the consensus lag, seconds. */
const ACCEPT_SEC = 0.2;

export type PlayAlongFailure = 'too-few-notes' | 'spread' | 'rtl-range';

export interface PlayAlongResult {
  accepted: boolean;
  failure: PlayAlongFailure | null;
  rtlMs: number | null;
  madMs: number | null;
  notesFound: number;
  clicks: number;
  /** Per click: onset - click, ms (null when no note matched); the UI's left/right ticks. */
  offsetsMs: (number | null)[];
}

/** Matches note onsets (clock seconds) to click times and applies 01 §7.8's acceptance. */
export function analyzePlayAlong(onsets: readonly number[], clicks: readonly number[], budget: CalibrationBudget): PlayAlongResult {
  const pa = budget.playAlong;
  const cands: ArrivalCandidate[] = onsets.map((t) => ({ t, coarseT: t, peakDb: 0 }));
  const { arrivals } = matchArrivals(clicks, cands, pa.minRtlMs / 1000 - EARLY_SEC, pa.maxRtlMs / 1000, {
    clusterSec: CLUSTER_SEC,
    acceptSec: ACCEPT_SEC,
  });
  const offsetsMs = arrivals.map((a) => (a.lagSec === null ? null : a.lagSec * 1000));
  const lags = offsetsMs.filter((x): x is number => x !== null);
  const n = lags.length;
  const rtlMs = n ? median(lags) : null;
  const madMs = n ? mad(lags) : null;
  let failure: PlayAlongFailure | null = null;
  if (n < playAlongMinNotes(budget)) failure = 'too-few-notes';
  else if ((madMs as number) > pa.maxMadMs) failure = 'spread';
  else if ((rtlMs as number) < pa.minRtlMs || (rtlMs as number) > pa.maxRtlMs) failure = 'rtl-range';
  return { accepted: failure === null, failure, rtlMs, madMs, notesFound: n, clicks: clicks.length, offsetsMs };
}

/** Play-along click times: `n` clicks at `bpm` from `start`. */
export function playAlongClickTimes(start: number, budget: CalibrationBudget): number[] {
  const beat = 60 / budget.playAlong.bpm;
  return Array.from({ length: budget.playAlong.clicks }, (_, i) => start + i * beat);
}

/** Detection parameters of the player's instrument (from `instruments.json` `detection`), or a generic default. */
export interface PlayAlongDetection {
  windowSamples: WindowSamples;
  minHz: number;
  maxHz: number;
  clarityThreshold: number;
  changeCents: number;
  onsetProfile: OnsetProfile;
  vibratoClass: VibratoClass;
  attackExcludeMs: number;
  a4Hz: number;
}

/**
 * Used when the caller passes no instrument: the 1024 window class over 55 Hz to 2.1 kHz (most launch
 * instruments' sounding ranges), the default clarity 0.85 and the wind change threshold (01 §7.3).
 */
export const GENERIC_DETECTION: PlayAlongDetection = {
  windowSamples: 1024,
  minHz: 55,
  maxHz: 2100,
  clarityThreshold: 0.85,
  changeCents: 60,
  onsetProfile: 'tongued-wind',
  vibratoClass: 'none',
  attackExcludeMs: 50,
  a4Hz: 440,
};

/** Runs the production DspPipeline over the play-along capture (headphone mode: no click handling). */
export class PlayAlongDetector {
  private pipe: DspPipeline | null = null;
  private readonly det: PlayAlongDetection;
  readonly onsets: number[] = [];

  constructor(det: PlayAlongDetection = GENERIC_DETECTION) {
    this.det = det;
  }

  push(b: CaptureBlock): void {
    if (!this.pipe) this.pipe = new DspPipeline(this.config(b.analysisRate));
    for (const ev of this.pipe.push(b)) if (ev.type === 'note-on') this.onsets.push(ev.note.onset as number);
  }

  flush(endT: number): number[] {
    if (this.pipe) for (const ev of this.pipe.flush(endT as ClockSeconds)) if (ev.type === 'note-on') this.onsets.push(ev.note.onset as number);
    return [...this.onsets].sort((a, b) => a - b);
  }

  private config(analysisRate: number): DspConfig {
    const d = this.det;
    return {
      analysisRate,
      windowSamples: d.windowSamples,
      hopSamples: 128,
      minHz: d.minHz,
      maxHz: d.maxHz,
      a4Hz: d.a4Hz,
      clarityThreshold: d.clarityThreshold,
      changeCents: d.changeCents,
      onsetProfile: d.onsetProfile,
      vibratoClass: d.vibratoClass,
      outputMode: 'wired',
      clicks: [],
      clickTemplate: null,
      repeatHints: [],
      attackExcludeMs: d.attackExcludeMs,
      clickLeakDb: null,
    };
  }
}
