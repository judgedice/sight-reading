/**
 * "rhythm" dimension detectors (02 §6.2): E1/E2, E4, E7, E8, E9, E28/E29. Timing is always relative to the
 * attempt's own median Δ (02 §6.1); the index turns the Δ-based ones off without a measured calibration.
 */
import { TPQ } from '../../core/types.ts';
import type { PatternDef } from '../../core/types.ts';
import {
  type Candidate,
  ev,
  localDeltaBefore,
  matched,
  median,
  type PatternContext,
  playedOnsetMs,
  relDelta,
  tGoodMs,
  th,
  tRedMs,
} from './context.ts';

const MS_PER_SEC = 1000;
const EPS = 1e-9;
/** Matched notes before a downbeat or an entry used as the local timing reference. */
const LOCAL_REF_NOTES = 4;

export interface DriftFit {
  slopeBeatsPerBar: number;
  rSquared: number;
  spanBars: number;
  notes: number[];
}

/** Least-squares fit of relative Δ (beats) against bar position over matched notes outside stops and replays. */
export function fitDrift(ctx: PatternContext): DriftFit | null {
  const pts: { x: number; y: number; i: number }[] = [];
  for (const e of ctx.expected) {
    const rd = relDelta(ctx, e.idx);
    if (rd === null || ctx.flowNotes.has(e.idx)) continue;
    pts.push({ x: e.onsetBeat / ctx.beatsPerBar, y: rd / ctx.beatMs, i: e.idx });
  }
  if (pts.length < 2) return null;
  const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  const syy = pts.reduce((s, p) => s + (p.y - my) ** 2, 0);
  const sxy = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
  if (sxx <= 0) return null;
  const b = sxy / sxx;
  const rSquared = syy > 0 ? (sxy * sxy) / (sxx * syy) : 0;
  const xs = pts.map((p) => p.x);
  return { slopeBeatsPerBar: b, rSquared, spanBars: Math.max(...xs) - Math.min(...xs), notes: pts.map((p) => p.i) };
}

/**
 * E1 (sign −1, rushed) and E2 (sign +1, behind): slope of relative Δ against bar ≤ −0.04 / ≥ +0.04 beat per bar,
 * total drift (|slope| × span) ≥ max(tRed, 0.25 beat), r² ≥ 0.5, over ≥ 12 matched notes in ≥ 6 bars. tRed is the
 * median over the fitted notes. Evidence: fitted notes displaced in the drift direction by more than their tGood.
 */
export function detectDrift(ctx: PatternContext, def: PatternDef, sign: 1 | -1): Candidate | null {
  const fit = fitDrift(ctx);
  if (!fit) return null;
  if (fit.notes.length < ev(def, 'notes')) return null;
  if (new Set(fit.notes.map((i) => ctx.expected[i]!.bar)).size < ev(def, 'bars')) return null;
  if (sign * fit.slopeBeatsPerBar < th(def, 'slopeBeatsPerBar') - EPS) return null;
  if (fit.rSquared < th(def, 'minRSquared')) return null;
  const tRedBeats = (median(fit.notes.map((i) => tRedMs(ctx, i))) ?? 0) / ctx.beatMs;
  const total = Math.abs(fit.slopeBeatsPerBar) * fit.spanBars;
  if (total < Math.max(tRedBeats, th(def, 'minTotalDriftBeats')) - EPS) return null;
  const notes = fit.notes.filter((i) => sign * (relDelta(ctx, i) ?? 0) > tGoodMs(ctx, i));
  return { notes, params: { slopeBeatsPerBar: fit.slopeBeatsPerBar, driftBeats: sign * total } };
}

/**
 * E4: downbeats not after a rest with relative Δ ≥ max(0.12 beat, 50 ms). The downbeat must also be that much later
 * than the median of the notes just before it, so a steady drift (E2) is not read as barline hesitation. The first
 * note of the take is not a barline crossing. Evidence ≥ 4 downbeats.
 */
export function detectE4(ctx: PatternContext, def: PatternDef): Candidate | null {
  const min = Math.max(th(def, 'minRelativeDeltaBeats') * ctx.beatMs, th(def, 'minRelativeDeltaMs'));
  const notes: number[] = [];
  for (const e of ctx.expected) {
    if (e.idx === 0 || Math.abs(e.beatInBar - 1) > EPS || e.precededByRest || ctx.flowNotes.has(e.idx)) continue;
    const prev = ctx.expected[e.idx - 1];
    if (prev && ctx.flowNotes.has(prev.idx)) continue;
    const rd = relDelta(ctx, e.idx);
    const j = matched(ctx, e.idx);
    const local = localDeltaBefore(ctx, e.idx, LOCAL_REF_NOTES);
    if (rd === null || !j || j.timingErrorMs === null || local === null) continue;
    if (rd >= min && j.timingErrorMs - local >= min) notes.push(e.idx);
  }
  return notes.length >= ev(def, 'downbeats') ? { notes } : null;
}

/** Note value of a span in quarter notes. */
const quarters = (ctx: PatternContext, beats: number): number => (beats * ctx.input.meter.countUnitTicks) / TPQ;

/**
 * E7 (`Q.E`, long 3/2 and short 1/2 quarter) and E8 (`E.S`, 3/4 and 1/4): figures whose played long:short IOI ratio
 * has median ≤ maxRatio, counted only where the written short IOI ≥ minShortIoiMs. A figure is a long note, a short
 * note and the next onset, all matched, with no rest inside. Evidence ≥ 3 figures; the evened ones are reported.
 */
export function detectDotted(ctx: PatternContext, def: PatternDef, longQ: number, shortQ: number): Candidate | null {
  const maxRatio = th(def, 'maxRatio');
  const minShortMs = th(def, 'minShortIoiMs');
  const ratios: { ratio: number; a: number; b: number }[] = [];
  for (let i = 0; i + 2 < ctx.expected.length; i++) {
    const a = ctx.expected[i]!;
    const b = ctx.expected[i + 1]!;
    const c = ctx.expected[i + 2]!;
    if (b.precededByRest || c.precededByRest) continue;
    if (Math.abs(quarters(ctx, b.onsetBeat - a.onsetBeat) - longQ) > EPS) continue;
    if (Math.abs(quarters(ctx, c.onsetBeat - b.onsetBeat) - shortQ) > EPS) continue;
    if ((c.onsetSec - b.onsetSec) * MS_PER_SEC < minShortMs - EPS) continue;
    if ([a, b, c].some((x) => ctx.flowNotes.has(x.idx))) continue;
    const pa = playedOnsetMs(ctx, a.idx);
    const pb = playedOnsetMs(ctx, b.idx);
    const pc = playedOnsetMs(ctx, c.idx);
    if (pa === null || pb === null || pc === null || pc - pb <= 0) continue;
    ratios.push({ ratio: (pb - pa) / (pc - pb), a: a.idx, b: b.idx });
  }
  if (ratios.length < ev(def, 'figures')) return null;
  const med = median(ratios.map((r) => r.ratio))!;
  if (med > maxRatio + EPS) return null;
  const notes = [...new Set(ratios.filter((r) => r.ratio <= maxRatio + EPS).flatMap((r) => [r.a, r.b]))].sort((x, y) => x - y);
  return { notes, params: { medianRatio: med } };
}

/**
 * E9: entries after rests of at least 1 beat, each ≥ tRed earlier than the attempt median Δ and than the notes just
 * before the rest (so rushing, E1, is not read as early entries). Evidence ≥ 3 entries.
 */
export function detectE9(ctx: PatternContext, def: PatternDef): Candidate | null {
  const minRest = th(def, 'minRestBeats');
  const notes: number[] = [];
  for (let i = 1; i < ctx.expected.length; i++) {
    const e = ctx.expected[i]!;
    const prev = ctx.expected[i - 1]!;
    if (!e.precededByRest || ctx.flowNotes.has(i)) continue;
    if (e.onsetBeat - (prev.onsetBeat + prev.durBeats) < minRest - EPS) continue;
    const rd = relDelta(ctx, i);
    const j = matched(ctx, i);
    if (rd === null || !j || j.timingErrorMs === null) continue;
    const red = tRedMs(ctx, i);
    const local = localDeltaBefore(ctx, i, LOCAL_REF_NOTES);
    if (rd <= -red && (local === null || j.timingErrorMs - local <= -red)) notes.push(i);
  }
  return notes.length >= ev(def, 'entries') ? { notes } : null;
}

/**
 * E28 (pickup present) and E29 (no pickup): the first note is missed, or its Δ minus the median Δ of the next 8
 * notes (matched ones) ≥ max(tRed, 0.25 beat). `wantPickup` selects which of the pair this call evaluates.
 */
export function detectFirstEntry(ctx: PatternContext, def: PatternDef, wantPickup: boolean): Candidate | null {
  const first = ctx.expected[0];
  if (!first) return null;
  const hasPickup = ctx.expected.some((e) => e.onsetBeat < -EPS);
  if (hasPickup !== wantPickup) return null;
  const j = ctx.judgment[0];
  if (!j) return null;
  if (j.status === 'missed') return { notes: [0] };
  if (j.timingErrorMs === null) return null;
  const next: number[] = [];
  for (let i = 1; i < ctx.expected.length && i <= th(def, 'nextNotes'); i++) {
    const m = matched(ctx, i);
    if (m && m.timingErrorMs !== null) next.push(m.timingErrorMs);
  }
  const ref = median(next);
  if (ref === null) return null;
  const min = Math.max(tRedMs(ctx, 0), th(def, 'minLateBeats') * ctx.beatMs);
  return j.timingErrorMs - ref >= min - EPS ? { notes: [0], params: { lateMs: j.timingErrorMs - ref } } : null;
}
