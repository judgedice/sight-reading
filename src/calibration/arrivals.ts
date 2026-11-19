/**
 * Click arrival finding (01 §7.7, §7.8). Pure.
 *
 * Tick (5.5 to 9 kHz), and every metronome sound through its Tick layer (06 section 9.1), is found in the hi band: a click's arrival is the first 1 ms sub-block above the noise floor
 * plus 20 dB, refined below the sub-block by a least-squares fit of the click's designed power envelope (01 §7.6:
 * 2 ms attack, exponential decay over the click length) to the sub-block energies around it, which places the
 * steepest part of the energy rise (the energy-derivative peak) at sub-millisecond precision.
 * Wood (1.5 to 4 kHz) is found in the low band, by its 1 ms low-band energy and, when a calibration template
 * exists, by cross-correlation with it (template sample 0 = arrival - CLICK_TEMPLATE_PRE_SEC, src/dsp/click.ts).
 *
 * Arrivals are matched to the scheduled clicks through a consensus lag: the lag that most clicks agree on within
 * `LAG_CLUSTER_SEC`, so a player's noise or a cough between clicks cannot pull the result.
 */
import { clickArrivalShape } from '../core/click-sounds.ts';
import type { ClickTimbre } from '../core/types.ts';
import { CLICK_TEMPLATE_PRE_SEC } from '../dsp/click.ts';
import type { CaptureRecording } from './recording.ts';
import { median, powerDb, quantile } from './stats.ts';

/** Detection threshold over the noise floor, dB (01 §7.8). */
export const ARRIVAL_THRESHOLD_DB = 20;
/** Sub-blocks before an onset that must be below threshold (a rise out of quiet, not a tail). */
const QUIET_BEFORE_SUBBLOCKS = 3;
/** Candidate onsets closer than this to the previous one are part of it, seconds. */
const REFRACTORY_SEC = 0.03;
/** Arrivals agreeing with the consensus lag within this are counted for it, seconds. */
export const LAG_CLUSTER_SEC = 0.006;
/** A click's arrival is accepted within this of the consensus lag, seconds. */
export const LAG_ACCEPT_SEC = 0.015;
/** Lowest noise floor assumed, dB (per-sample power), so digital silence still has a finite threshold. */
export const NOISE_FLOOR_MIN_DB = -110;

/** Designed click envelopes (01 §7.6, 06 §9; src/core/click-sounds.ts renders them). */
export interface ClickShape {
  attackSec: number;
  lengthSec: number;
}

/**
 * The arrival envelope of a click: Tick's burst, the Tick layer of Classic, Woodblock and Beep (per recipe: accent or
 * offbeat), or Wood's burst.
 */
export function clickShape(timbre: ClickTimbre, accent: boolean): ClickShape {
  return clickArrivalShape(timbre, accent);
}

/**
 * The arrival envelope of a calibration click (`Metronome.scheduleClicks`): Tick and Wood play their accent burst,
 * the new sounds their offbeat recipe (at the accent gain).
 */
export function calibrationClickShape(timbre: ClickTimbre): ClickShape {
  return clickShape(timbre, timbre === 'tick' || timbre === 'wood');
}

/** Power envelope of the designed click at time t after its start (amplitude ramp then exp(-5 t / length)). */
function shapePower(s: ClickShape, t: number): number {
  if (t <= 0 || t >= s.lengthSec) return 0;
  const a = (t < s.attackSec ? t / s.attackSec : 1) * Math.exp((-5 * t) / s.lengthSec);
  return a * a;
}

/** Integral of the power envelope over [a, b] seconds after the click start (Simpson, 0.02 ms steps). */
function shapeEnergy(s: ClickShape, a: number, b: number): number {
  const lo = Math.max(0, a);
  const hi = Math.min(s.lengthSec, b);
  if (hi <= lo) return 0;
  const n = Math.max(2, 2 * Math.ceil((hi - lo) / 4e-5));
  const h = (hi - lo) / n;
  let acc = shapePower(s, lo) + shapePower(s, hi);
  for (let i = 1; i < n; i++) acc += (i % 2 ? 4 : 2) * shapePower(s, lo + i * h);
  return (acc * h) / 3;
}

export interface NoiseFloor {
  /** Per-sample power, dB, in the band analysed. */
  db: number;
}

/** Hi-band noise floor: the median sub-block power over [t0, t1), or the 20th percentile of the whole recording. */
export function hiNoiseFloorDb(rec: CaptureRecording, window?: { t0: number; t1: number }): number {
  const n = rec.hiEnergy.length;
  const ps: number[] = [];
  if (window) {
    const a = Math.max(0, rec.hiIndexAt(window.t0) + 1);
    const b = Math.min(n, rec.hiIndexAt(window.t1));
    for (let k = a; k < b; k++) ps.push(powerDb(rec.hiPower(k)));
  }
  if (ps.length < 20) {
    ps.length = 0;
    for (let k = 0; k < n; k++) ps.push(powerDb(rec.hiPower(k)));
    return Math.max(NOISE_FLOOR_MIN_DB, quantile(ps, 0.2));
  }
  return Math.max(NOISE_FLOOR_MIN_DB, median(ps));
}

/** Low-band power per 1 ms window starting at low-band index i (per-sample power). */
function lowWindowPower(low: Float32Array, i: number, n: number): number {
  let s = 0;
  const a = Math.max(0, i);
  const b = Math.min(low.length, i + n);
  for (let j = a; j < b; j++) s += (low[j] as number) * (low[j] as number);
  return b > a ? s / n : 0;
}

/** Low-band noise floor over [t0, t1) in 1 ms windows (median), or the 20th percentile of the recording. */
export function lowNoiseFloorDb(rec: CaptureRecording, window?: { t0: number; t1: number }): number {
  const low = rec.lowband;
  const w = Math.max(1, Math.round(rec.analysisRate / 1000));
  const ps: number[] = [];
  const push = (a: number, b: number): void => {
    for (let i = Math.max(0, a); i + w <= Math.min(low.length, b); i += w) ps.push(powerDb(lowWindowPower(low, i, w)));
  };
  if (window) push(Math.ceil(rec.lowIndex(window.t0)), Math.floor(rec.lowIndex(window.t1)));
  if (ps.length < 20) {
    ps.length = 0;
    push(0, low.length);
    return Math.max(NOISE_FLOOR_MIN_DB, quantile(ps, 0.2));
  }
  return Math.max(NOISE_FLOOR_MIN_DB, median(ps));
}

/** A rising edge found in the recording. */
export interface ArrivalCandidate {
  /** Refined arrival, clock seconds. */
  t: number;
  /** Coarse arrival: start of the first 1 ms window above threshold. */
  coarseT: number;
  /** Peak 1 ms power of the click, dB (per-sample power in the band analysed). */
  peakDb: number;
}

/**
 * Hi-band rising edges in [t0, t1): sub-blocks above floor + threshold after QUIET_BEFORE_SUBBLOCKS quiet ones,
 * each refined by the click-shape fit.
 */
export function hiBandCandidates(
  rec: CaptureRecording,
  floorDb: number,
  shape: ClickShape,
  range: { t0: number; t1: number } = { t0: -Infinity, t1: Infinity },
): ArrivalCandidate[] {
  const n = rec.hiEnergy.length;
  const thr = 10 ** ((floorDb + ARRIVAL_THRESHOLD_DB) / 10);
  const out: ArrivalCandidate[] = [];
  const a = Math.max(QUIET_BEFORE_SUBBLOCKS, Number.isFinite(range.t0) ? rec.hiIndexAt(range.t0) : 0);
  const b = Math.min(n, Number.isFinite(range.t1) ? rec.hiIndexAt(range.t1) + 1 : n);
  let lastT = -Infinity;
  for (let k = a; k < b; k++) {
    if (rec.hiPower(k) < thr) continue;
    let quiet = true;
    for (let j = k - QUIET_BEFORE_SUBBLOCKS; j < k; j++) if (rec.hiPower(j) >= thr) quiet = false;
    if (!quiet) continue;
    const coarseT = rec.hiStart(k);
    if (coarseT - lastT < REFRACTORY_SEC) continue;
    lastT = coarseT;
    let peak = 0;
    const span = Math.ceil(shape.lengthSec * 1000) + 1;
    for (let j = k; j < Math.min(n, k + span); j++) peak = Math.max(peak, rec.hiPower(j));
    out.push({ t: refineHi(rec, k, shape), coarseT, peakDb: powerDb(peak) });
  }
  return out;
}

/**
 * Sub-millisecond refinement: the click start u that best fits the sub-block energies E[k-2 .. k+span] with
 * g * energy(shape, sub-block - u) in the least-squares sense (gain g free), searched on a 0.02 ms grid within
 * [start(k) - 1.2 ms, start(k) + 1 ms]: the first above-threshold sub-block holds the start or directly follows the
 * one that does (a start late in a sub-block leaves too little energy there to cross the threshold).
 * Measured on FakeAudioBackend loopback (no room): bias -0.2 to -0.4 ms, per-click MAD under 0.2 ms.
 */
export function refineHi(rec: CaptureRecording, k: number, shape: ClickShape): number {
  const n = rec.hiEnergy.length;
  const first = Math.max(0, k - 2);
  const last = Math.min(n - 1, k + Math.ceil(shape.lengthSec * 1000) + 1);
  const ks: number[] = [];
  const es: number[] = [];
  for (let j = first; j <= last; j++) {
    ks.push(j);
    es.push(rec.hiEnergy[j] as number);
  }
  const t0 = rec.hiStart(k);
  let bestU = t0;
  let bestCost = Infinity;
  for (let du = -0.0012; du <= 0.001 + 1e-12; du += 0.00002) {
    const u = t0 + du;
    let mm = 0;
    let me = 0;
    const model: number[] = [];
    for (let i = 0; i < ks.length; i++) {
      const j = ks[i] as number;
      const m = shapeEnergy(shape, rec.hiStart(j) - u, rec.hiStart(j + 1) - u);
      model.push(m);
      mm += m * m;
      me += m * (es[i] as number);
    }
    if (mm <= 0) continue;
    const g = Math.max(0, me / mm);
    let cost = 0;
    for (let i = 0; i < ks.length; i++) {
      const r = (es[i] as number) - g * (model[i] as number);
      cost += r * r;
    }
    if (cost < bestCost) {
      bestCost = cost;
      bestU = u;
    }
  }
  return bestU;
}

/**
 * Low-band rising edges in [t0, t1) (Wood): 1 ms windows above floor + threshold after quiet ones. With a template,
 * the arrival is refined by cross-correlation within +-2 ms of the coarse edge (template sample 0 at arrival -
 * CLICK_TEMPLATE_PRE_SEC), with a parabolic fractional step.
 */
export function lowBandCandidates(
  rec: CaptureRecording,
  floorDb: number,
  template: ArrayLike<number> | null,
  range: { t0: number; t1: number } = { t0: -Infinity, t1: Infinity },
): ArrivalCandidate[] {
  const low = rec.lowband;
  const w = Math.max(1, Math.round(rec.analysisRate / 1000));
  const thr = 10 ** ((floorDb + ARRIVAL_THRESHOLD_DB) / 10);
  const a = Math.max(QUIET_BEFORE_SUBBLOCKS * w, Number.isFinite(range.t0) ? Math.ceil(rec.lowIndex(range.t0)) : 0);
  const b = Math.min(low.length - w, Number.isFinite(range.t1) ? Math.floor(rec.lowIndex(range.t1)) : low.length - w);
  const out: ArrivalCandidate[] = [];
  let lastT = -Infinity;
  // Step by quarter windows for a finer coarse edge.
  const step = Math.max(1, w >> 2);
  for (let i = a; i < b; i += step) {
    if (lowWindowPower(low, i, w) < thr) continue;
    let quiet = true;
    for (let j = 1; j <= QUIET_BEFORE_SUBBLOCKS; j++) if (lowWindowPower(low, i - j * w, w) >= thr) quiet = false;
    if (!quiet) continue;
    const coarseT = rec.lowTime(i);
    if (coarseT - lastT < REFRACTORY_SEC) continue;
    lastT = coarseT;
    let peak = 0;
    for (let j = i; j < Math.min(low.length - w, i + 10 * w); j += step) peak = Math.max(peak, lowWindowPower(low, j, w));
    // Without a template the edge is the window's end: the energy crosses inside the window.
    const t = template && template.length > 0 ? refineLow(rec, coarseT, template) : coarseT + 0.5 / 1000;
    out.push({ t, coarseT, peakDb: powerDb(peak) });
  }
  return out;
}

function refineLow(rec: CaptureRecording, coarseT: number, tpl: ArrayLike<number>): number {
  const low = rec.lowband;
  const rate = rec.analysisRate;
  const S = Math.round(0.002 * rate);
  const s0 = Math.round(rec.lowIndex(coarseT - CLICK_TEMPLATE_PRE_SEC));
  const corr: number[] = [];
  let best = -Infinity;
  let bestL = 0;
  for (let l = -S; l <= S; l++) {
    let v = 0;
    let xx = 0;
    for (let i = 0; i < tpl.length; i++) {
      const x = low[s0 + l + i] ?? 0;
      v += x * (tpl[i] as number);
      xx += x * x;
    }
    const nv = xx > 0 ? v / Math.sqrt(xx) : 0;
    corr.push(nv);
    if (nv > best) {
      best = nv;
      bestL = l;
    }
  }
  let frac = 0;
  if (bestL > -S && bestL < S) {
    const p = corr[bestL + S - 1] as number;
    const q = corr[bestL + S] as number;
    const r = corr[bestL + S + 1] as number;
    const den = p - 2 * q + r;
    if (den < 0) frac = Math.max(-0.5, Math.min(0.5, (0.5 * (p - r)) / den));
  }
  return rec.lowTime(s0 + bestL + frac) + CLICK_TEMPLATE_PRE_SEC;
}

/** One scheduled click and what was found for it. */
export interface ClickArrival {
  /** Scheduled output time, clock seconds. */
  scheduled: number;
  /** Arrival, clock seconds; null when not found. */
  arrival: number | null;
  /** Arrival - scheduled, seconds; null when not found. */
  lagSec: number | null;
  peakDb: number | null;
}

/**
 * Matches candidates to scheduled clicks. The consensus lag is the lag (in [minLag, maxLag]) that the most clicks
 * have a candidate within LAG_CLUSTER_SEC of; ties go to the smaller spread. Each click then takes its candidate
 * nearest the consensus lag within LAG_ACCEPT_SEC.
 */
export function matchArrivals(
  scheduled: readonly number[],
  cands: readonly ArrivalCandidate[],
  minLagSec: number,
  maxLagSec: number,
  tol: { clusterSec?: number; acceptSec?: number } = {},
): { arrivals: ClickArrival[]; consensusLagSec: number | null } {
  const LAG_CLUSTER = tol.clusterSec ?? LAG_CLUSTER_SEC;
  const LAG_ACCEPT = tol.acceptSec ?? LAG_ACCEPT_SEC;
  const lags: { click: number; lag: number; c: ArrivalCandidate }[] = [];
  scheduled.forEach((s, i) => {
    for (const c of cands) {
      const lag = c.t - s;
      if (lag >= minLagSec - LAG_ACCEPT && lag <= maxLagSec + LAG_ACCEPT) lags.push({ click: i, lag, c });
    }
  });
  let best: { lag: number; count: number; spread: number } | null = null;
  for (const l of lags) {
    if (l.lag < minLagSec || l.lag > maxLagSec) continue;
    const near = new Map<number, number>();
    for (const m of lags) {
      const d = Math.abs(m.lag - l.lag);
      if (d <= LAG_CLUSTER && (!near.has(m.click) || d < (near.get(m.click) as number))) near.set(m.click, d);
    }
    const count = near.size;
    const spread = [...near.values()].reduce((a, b) => a + b, 0);
    if (!best || count > best.count || (count === best.count && spread < best.spread)) best = { lag: l.lag, count, spread };
  }
  if (!best) return { arrivals: scheduled.map((s) => ({ scheduled: s, arrival: null, lagSec: null, peakDb: null })), consensusLagSec: null };
  // Re-centre on the median lag of the cluster.
  const clusterLags: number[] = [];
  const pick = new Map<number, { lag: number; c: ArrivalCandidate }>();
  for (const m of lags) {
    if (Math.abs(m.lag - best.lag) > LAG_CLUSTER) continue;
    const prev = pick.get(m.click);
    if (!prev || Math.abs(m.lag - best.lag) < Math.abs(prev.lag - best.lag)) pick.set(m.click, m);
  }
  for (const v of pick.values()) clusterLags.push(v.lag);
  const centre = median(clusterLags);
  const arrivals = scheduled.map((s, i): ClickArrival => {
    let bestM: { lag: number; c: ArrivalCandidate } | null = null;
    for (const m of lags) {
      if (m.click !== i || Math.abs(m.lag - centre) > LAG_ACCEPT) continue;
      if (!bestM || Math.abs(m.lag - centre) < Math.abs(bestM.lag - centre)) bestM = m;
    }
    return bestM
      ? { scheduled: s, arrival: bestM.c.t, lagSec: bestM.lag, peakDb: bestM.c.peakDb }
      : { scheduled: s, arrival: null, lagSec: null, peakDb: null };
  });
  return { arrivals, consensusLagSec: centre };
}
