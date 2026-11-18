/**
 * Loopback analysis (01 §7.8, P14): speakers only. Ten accented Tick clicks at random 400 to 700 ms gaps after a
 * silence request; arrival per click from the hi band (arrivals.ts); then clicks of the selected timbre whose
 * received low band is averaged into its template. Accept: at least `minFound` of `clicks` found, MAD at most
 * `maxMadMs`, RTL in [minRtlMs, maxRtlMs]; RTL = median lag. Every threshold comes from
 * `config/measurement-budget.json` `calibration.loopback`. Pure.
 */
import type { Calibration, ClickTimbre, MeasurementBudget } from '../core/types.ts';
import { buildClickTemplate } from '../dsp/click.ts';
import {
  clickShape,
  hiBandCandidates,
  hiNoiseFloorDb,
  lowNoiseFloorDb,
  matchArrivals,
  refineHi,
  type ClickArrival,
} from './arrivals.ts';
import type { CaptureRecording } from './recording.ts';
import { mad, median, powerDb } from './stats.ts';

export type CalibrationBudget = MeasurementBudget['calibration'];

export interface LoopbackSchedule {
  /** Scheduled times of the accented Tick clicks (`loopback.clicks` of them), clock seconds. */
  ticks: readonly number[];
  /** Scheduled times of the accented clicks of the selected timbre, for its template. */
  templateClicks: readonly number[];
  templateTimbre: ClickTimbre;
  /** The quiet window before the first click, for the noise floors. */
  silence?: { t0: number; t1: number };
}

export type LoopbackFailure = 'too-few-clicks' | 'spread' | 'rtl-range';

export interface LoopbackResult {
  accepted: boolean;
  failure: LoopbackFailure | null;
  /** Median lag of the found clicks, ms; null when none was found. Reported even when not accepted (diagnostics). */
  rtlMs: number | null;
  madMs: number | null;
  clicksFound: number;
  clicksScheduled: number;
  arrivals: ClickArrival[];
  /** Hi-band noise floor, dB per-sample power. */
  hiNoiseFloorDb: number;
  /** Low-band noise floor, dBFS (1 ms mean-square). */
  noiseFloorDb: number;
  /** Median hi-band 1 ms peak power of the found Tick clicks, dB; null when none. */
  clickPeakDb: number | null;
  /** Templates built when accepted (plain-click level), keyed by timbre. */
  templates: Calibration['templates'];
  /** Peak 2 ms low-band power of the selected timbre's template, dBFS; null when not accepted. */
  clickLeakDb: number | null;
}

/** Peak 2 ms mean-square of a template, dB (the convention of `ClickFit.leakEnvDb`, src/dsp/click.ts). */
export function templateLeakDb(samples: ArrayLike<number>, rate: number): number {
  const hop = Math.max(1, Math.round(0.002 * rate));
  let best = 0;
  for (let a = 0; a < samples.length; a += hop) {
    let s = 0;
    const b = Math.min(samples.length, a + hop);
    for (let i = a; i < b; i++) s += (samples[i] as number) * (samples[i] as number);
    best = Math.max(best, s / hop);
  }
  return powerDb(best);
}

export function analyzeLoopback(rec: CaptureRecording, sched: LoopbackSchedule, budget: CalibrationBudget): LoopbackResult {
  const lb = budget.loopback;
  const minLag = lb.minRtlMs / 1000;
  const maxLag = lb.maxRtlMs / 1000;
  const hiFloor = hiNoiseFloorDb(rec, sched.silence);
  const lowFloor = lowNoiseFloorDb(rec, sched.silence);
  const shape = clickShape('tick', true);
  const lastTick = sched.ticks.length ? Math.max(...sched.ticks) : 0;
  const firstTick = sched.ticks.length ? Math.min(...sched.ticks) : 0;
  // Only the tick section: the template clicks (possibly also Tick) must not count as found ticks.
  const range = { t0: firstTick, t1: lastTick + maxLag + 0.03 };
  const cands = hiBandCandidates(rec, hiFloor, shape, range);
  const { arrivals } = matchArrivals(sched.ticks, cands, minLag, maxLag);
  // Re-refine each found click with its own shape (all calibration clicks are accents; kept for clarity).
  for (const a of arrivals) {
    if (a.arrival === null) continue;
    const k = rec.hiIndexAt(a.arrival);
    a.arrival = refineHi(rec, Math.max(0, k), shape);
    a.lagSec = a.arrival - a.scheduled;
  }
  const lagsMs = arrivals.filter((a) => a.lagSec !== null).map((a) => (a.lagSec as number) * 1000);
  const found = lagsMs.length;
  const rtlMs = found ? median(lagsMs) : null;
  const madMs = found ? mad(lagsMs) : null;
  let failure: LoopbackFailure | null = null;
  if (found < lb.minFound) failure = 'too-few-clicks';
  else if ((madMs as number) > lb.maxMadMs) failure = 'spread';
  else if ((rtlMs as number) < lb.minRtlMs || (rtlMs as number) > lb.maxRtlMs) failure = 'rtl-range';
  const accepted = failure === null;
  const peaks = arrivals.filter((a) => a.peakDb !== null).map((a) => a.peakDb as number);

  const templates: Calibration['templates'] = {};
  let clickLeakDb: number | null = null;
  if (accepted) {
    const rtl = (rtlMs as number) / 1000;
    const rate = rec.analysisRate;
    const tickClicks = arrivals.filter((a) => a.arrival !== null).map((a) => ({ arrival: a.arrival as number, accent: true }));
    const extra = sched.templateClicks.map((t) => ({ arrival: t + rtl, accent: true }));
    const tickSet = sched.templateTimbre === 'tick' ? [...tickClicks, ...extra] : tickClicks;
    const tick = buildClickTemplate(rec.lowband, rec.lowStartT, rate, tickSet);
    templates.tick = { rate, samples: Array.from(tick) };
    if (sched.templateTimbre === 'wood' && extra.length) {
      const wood = buildClickTemplate(rec.lowband, rec.lowStartT, rate, extra);
      templates.wood = { rate, samples: Array.from(wood) };
    }
    const sel = templates[sched.templateTimbre];
    clickLeakDb = sel ? templateLeakDb(sel.samples, rate) : null;
  }
  return {
    accepted,
    failure,
    rtlMs,
    madMs,
    clicksFound: found,
    clicksScheduled: sched.ticks.length,
    arrivals,
    hiNoiseFloorDb: hiFloor,
    noiseFloorDb: lowFloor,
    clickPeakDb: peaks.length ? median(peaks) : null,
    templates,
    clickLeakDb,
  };
}

/**
 * Loopback click times: `n` clicks starting at `start`, gaps uniform in [400, 700] ms (01 §7.8), from the
 * injected RNG.
 */
export function randomClickTimes(start: number, n: number, next: () => number, gapSec: [number, number] = [0.4, 0.7]): number[] {
  const out: number[] = [];
  let t = start;
  for (let i = 0; i < n; i++) {
    out.push(t);
    t += gapSec[0] + (gapSec[1] - gapSec[0]) * next();
  }
  return out;
}
