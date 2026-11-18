/**
 * Relabel pass of the final alignment (01 §9.6, PLAN R34): displaced segments from the DP result.
 *
 * A player who went back or skipped ahead plays score material at a constant offset δ from the metronome. The DP
 * sees those notes at δ = 0, where they land as wrong-pitch matches (when another written note is inside the band)
 * or as extras (when none is). R34 makes both kinds of run candidates. A run becomes a `DisplacedSegment` when:
 *  - it is seeded by a wrong-pitch match or an extra, and δ is taken from pairing the seed with a written note of
 *    its pitch: δ = (expected onset − played onset) in beats, negative when the player went back;
 *  - δ is beyond the band (|δ| ≥ max(W, 1 beat)) and inside the detector's range (`displacement.ts`: up to 4 bars
 *    back, 2 bars ahead), the same reading as the live detector (01 §9.5);
 *  - it grows forward over consecutive played notes that fit at δ: shifted by δ, a note lands inside the match window
 *    of a later written note of the right pitch, in order. Inside the run a note that also matches at δ = 0 is kept
 *    in it (a replayed note can equal the current one), and one note that fits nowhere is tolerated (a slip inside
 *    the replay); the run never starts or ends on such notes;
 *  - at least 3 of its notes are wrong-pitch matches or extras at δ = 0 that fit at δ (01 §9.6's "at least 3"), and
 *    its cost at δ is at most half its DP cost (01 §9.5's 2× rule).
 * Runs are chosen greedily (most notes, then lowest cost at δ, then smallest |δ|, then earliest) without sharing
 * notes. A perfect take has no wrong-pitch matches or extras and so never yields a segment.
 */
import type { DetectedNote, DisplacedSegment, ExpectedNote, FollowConfig, ResolvedTolerance } from '../core/types.ts';
import { classifyAgainst, matchCost, pitchCost, SKIP_DETECTED_COST } from './cost.ts';
import { DISPLACEMENT_COST_RATIO, DISPLACEMENT_MAX_AHEAD_BARS, DISPLACEMENT_MAX_BACK_BARS, DISPLACEMENT_MIN_MATCHES } from './displacement.ts';

/** A detected note as the final alignment sees it. */
export interface AlignNote {
  note: DetectedNote;
  /** Played onset, score seconds. */
  s: number;
  /** Sounded at least `extraMinDurMs`: unmatched, it is an extra (02 §4.1); shorter, it is ignored. */
  extraEligible: boolean;
}

/** Smallest offset, beats (01 §9.5). */
const MIN_OFFSET_BEATS = 1;
/** Notes inside a run that fit nowhere, in a row. */
const MAX_SLIPS = 1;
const SAME_OFFSET_BEATS = 1e-3;
const CENTS_PER_SEMITONE = 100;
const SEMITONES_PER_OCTAVE = 12;

const r6 = (x: number): number => Math.round(x * 1e6) / 1e6;

interface Member {
  k: number;
  /** Expected index at δ, or null for a tolerated slip. */
  idx: number | null;
  costAtDelta: number;
  bad: boolean;
}

interface Run {
  members: Member[];
  delta: number;
  costAtDelta: number;
  costAtZero: number;
  first: number;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

/**
 * Displaced segments in the DP result `idx` (matched expected index per note, null = unmatched) with per-note DP
 * cost `cost`. `notes` are in onset order; `offsetCents` is the DP's pitch offset.
 */
export function relabel(c: FollowConfig, notes: readonly AlignNote[], idx: readonly (number | null)[], cost: readonly number[], offsetCents: number): DisplacedSegment[] {
  const E = c.expected;
  const beatSec = 60 / c.bpm;
  const lo = -DISPLACEMENT_MAX_BACK_BARS * c.beatsPerBar;
  const hi = DISPLACEMENT_MAX_AHEAD_BARS * c.beatsPerBar;
  const maxW = c.tolerances.reduce((m, t) => Math.max(m, t.matchWindowSec), 0);
  const onsets = E.map((e) => e.onsetSec);
  const tol = (i: number): ResolvedTolerance => c.tolerances[i] as ResolvedTolerance;

  /** Cheap reject before the full classification: more than a semitone from every octave of the target. */
  const near = (i: number, n: AlignNote): boolean => {
    const off = n.note.midi - offsetCents / CENTS_PER_SEMITONE - (E[i] as ExpectedNote).concertMidi;
    return Math.abs(off - SEMITONES_PER_OCTAVE * Math.round(off / SEMITONES_PER_OCTAVE)) <= 1;
  };
  const correctAt = (i: number, n: AlignNote): boolean => near(i, n) && classifyAgainst(E[i] as ExpectedNote, n.note, offsetCents, c.instrument, c.cfg).c.kind === 'correct';

  // The sequence the runs grow over: every note the DP matched or would count as an extra (blips are transparent).
  const seq: number[] = [];
  const bad: boolean[] = [];
  notes.forEach((n, k) => {
    const i = idx[k];
    if (i === null || i === undefined) {
      if (!n.extraEligible) return;
      seq.push(k);
      bad.push(true);
      return;
    }
    seq.push(k);
    bad.push(!correctAt(i, n));
  });

  const lowerBound = (t: number): number => {
    let a = 0;
    let b = onsets.length;
    while (a < b) {
      const m = (a + b) >> 1;
      if ((onsets[m] as number) < t) a = m + 1;
      else b = m;
    }
    return a;
  };

  /** Cheapest written note of the right pitch after `after` within the band of the shifted onset. */
  const fit = (n: AlignNote, delta: number, after: number): { idx: number; cost: number } | null => {
    const target = n.s + delta * beatSec;
    let best: { idx: number; cost: number } | null = null;
    for (let i = Math.max(after + 1, lowerBound(target - maxW)); i < E.length; i++) {
      const e = E[i] as ExpectedNote;
      if (e.onsetSec > target + maxW) break;
      const dt = target - e.onsetSec;
      if (Math.abs(dt) > tol(i).matchWindowSec || !near(i, n)) continue;
      const { c: pc } = classifyAgainst(e, n.note, offsetCents, c.instrument, c.cfg);
      if (pc.kind !== 'correct') continue;
      const k = matchCost(dt, tol(i), pitchCost(pc));
      if (k !== null && (!best || k < best.cost)) best = { idx: i, cost: k };
    }
    return best;
  };

  const grow = (p: number, delta: number): Run | null => {
    const members: Member[] = [];
    let tentative: Member[] = [];
    let last = -1;
    let tentativeLast = -1;
    let slips = 0;
    for (let q = p; q < seq.length; q++) {
      const k = seq[q] as number;
      const n = notes[k] as AlignNote;
      const isBad = bad[q] as boolean;
      const f = fit(n, delta, tentative.length ? tentativeLast : last);
      if (f && isBad) {
        members.push(...tentative, { k, idx: f.idx, costAtDelta: f.cost, bad: true });
        tentative = [];
        last = f.idx;
        tentativeLast = f.idx;
        slips = 0;
      } else if (q === p) {
        return null;
      } else if (f) {
        tentative.push({ k, idx: f.idx, costAtDelta: f.cost, bad: false });
        tentativeLast = f.idx;
        slips = 0;
      } else if (isBad && slips < MAX_SLIPS) {
        tentative.push({ k, idx: null, costAtDelta: SKIP_DETECTED_COST, bad: true });
        slips++;
      } else break;
    }
    const fittingBad = members.filter((m) => m.bad && m.idx !== null).length;
    if (fittingBad < DISPLACEMENT_MIN_MATCHES) return null;
    const costAtDelta = members.reduce((a, m) => a + m.costAtDelta, 0);
    const costAtZero = members.reduce((a, m) => a + (cost[m.k] as number), 0);
    if (costAtZero < DISPLACEMENT_COST_RATIO * costAtDelta) return null;
    return { members, delta, costAtDelta, costAtZero, first: p };
  };

  const runs: Run[] = [];
  for (let p = 0; p < seq.length; p++) {
    if (!bad[p]) continue;
    const n = notes[seq[p] as number] as AlignNote;
    if (idx[seq[p] as number] === null && !n.extraEligible) continue;
    const tried: number[] = [];
    for (let i = 0; i < E.length; i++) {
      const e = E[i] as ExpectedNote;
      const delta = (e.onsetSec - n.s) / beatSec;
      if (delta < lo || delta > hi) continue;
      if (Math.abs(delta) < MIN_OFFSET_BEATS || Math.abs(delta) * beatSec < tol(i).matchWindowSec) continue;
      if (!correctAt(i, n)) continue;
      if (tried.some((x) => Math.abs(x - delta) < SAME_OFFSET_BEATS)) continue;
      tried.push(delta);
      const r = grow(p, delta);
      if (r) runs.push(r);
    }
  }

  runs.sort(
    (a, b) =>
      b.members.length - a.members.length || a.costAtDelta - b.costAtDelta || Math.abs(a.delta) - Math.abs(b.delta) || a.first - b.first || a.delta - b.delta,
  );
  const used = new Set<number>();
  const out: DisplacedSegment[] = [];
  for (const r of runs) {
    if (r.members.some((m) => used.has(m.k))) continue;
    for (const m of r.members) used.add(m.k);
    const fitted = r.members.filter((m): m is Member & { idx: number } => m.idx !== null);
    const offsets = fitted.map((m) => ((E[m.idx] as ExpectedNote).onsetSec - (notes[m.k] as AlignNote).s) / beatSec);
    out.push({
      fromIdx: Math.min(...fitted.map((m) => m.idx)),
      toIdx: Math.max(...fitted.map((m) => m.idx)),
      offsetBeats: r6(median(offsets)),
      detectedIds: r.members.map((m) => (notes[m.k] as AlignNote).note.id).sort((a, b) => a - b),
    });
  }
  return out;
}
