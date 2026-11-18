/**
 * Random perturbations for the scenario generator (01 section 13.2): timing, cents, semitones, octaves, drops,
 * extras, stops, restarts, skips. The output is a `PerformSpec` for the fixture generator's `perform()`
 * (fixtures/follow/gen/perform.ts), so the played notes carry the same ground-truth labels (match, extra,
 * displaced) the follow fixtures use, plus a per-expected-note record of what was done and the displaced segments
 * the final alignment should find.
 *
 * Structural cases follow the golden follow fixtures (fixtures/follow/gen/follow-scenarios.ts):
 * - stop: silence from a downbeat for 1 or 2 bars, then on time (no displacement; the notes are missed);
 * - rejoin: drop from mid-bar to the next downbeat, then on time (no displacement);
 * - restart: go back k beats and replay 4 to 6 notes k beats late (segment offset -k), drop the current notes the
 *   replay covers, rejoin on time at the next downbeat (as back-2-beats);
 * - skip: jump a bar ahead and play 4 to 6 notes a bar early (offset +bar), drop the current notes covered, rejoin
 *   on time where the early run started (as skip-bar-ahead).
 */
import type { ExpectedNote, Instrument, Rng } from '../../core/types.ts';
import type { ExtraSpec, NoteMod, PerformSpec, ReplaySpec } from '../../../fixtures/follow/gen/perform.ts';
import { gauss } from '../synth/dsp-util.ts';

export type PerturbationKind = 'timing' | 'cents' | 'semitone' | 'octave' | 'drop' | 'extra' | 'stop' | 'restart' | 'skip' | 'rejoin';
export type StructuralKind = 'stop' | 'restart' | 'skip' | 'rejoin';

export interface ExpectedSegment {
  fromIdx: number;
  toIdx: number;
  offsetBeats: number;
}

/** What the performance did to one expected note (the judgment ground truth). */
export interface ExpectedNoteTruth {
  idx: number;
  /** False when the note was never played on time (dropped, or covered by a stop, restart or skip). */
  played: boolean;
  omitReason: 'drop' | StructuralKind | null;
  /** Deliberate timing error, ms (0 when only jitter). */
  shiftMs: number;
  /** Jitter applied, ms. */
  jitterMs: number;
  cents: number;
  semis: number;
  octaves: number;
  /** The kinds of error injected on this note. */
  errors: PerturbationKind[];
}

export interface PerturbationPlan {
  spec: PerformSpec;
  kinds: PerturbationKind[];
  structural: StructuralKind | null;
  notes: ExpectedNoteTruth[];
  displaced: ExpectedSegment[];
  extras: ExtraSpec[];
}

export interface PerturbOptions {
  /** Probability of a clean take (jitter and in-tune cents only). Default 0.25. */
  cleanProb?: number;
  /** Probability of one structural case in a non-clean take. Default 0.4. */
  structuralProb?: number;
  /** Force a structural case. */
  structural?: StructuralKind;
  /** Force a clean take. */
  clean?: boolean;
}

const EPS = 1e-9;
const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[rng.int(0, xs.length)] as T;
const uniform = (rng: Rng, a: number, b: number): number => a + (b - a) * rng.next();

interface Structural {
  omit: Map<number, StructuralKind>;
  replays: ReplaySpec[];
  displaced: ExpectedSegment[];
}

function stop(e: readonly ExpectedNote[], bpb: number, rng: Rng): Structural | null {
  const lastBeat = (e[e.length - 1] as ExpectedNote).onsetBeat;
  const bars = rng.next() < 0.5 ? 1 : 2;
  const L = bars * bpb;
  const candidates: number[] = [];
  for (let B = bpb; B + L < lastBeat - EPS; B += bpb) {
    if (e.some((n) => n.onsetBeat >= B - EPS && n.onsetBeat < B + L - EPS)) candidates.push(B);
  }
  if (candidates.length === 0) return null;
  const B = pick(rng, candidates);
  const omit = new Map<number, StructuralKind>();
  for (const n of e) if (n.onsetBeat >= B - EPS && n.onsetBeat < B + L - EPS) omit.set(n.idx, 'stop');
  return { omit, replays: [], displaced: [] };
}

function rejoin(e: readonly ExpectedNote[], bpb: number, rng: Rng): Structural | null {
  const cands = e.filter((n) => n.idx >= 2 && Math.abs(n.onsetBeat / bpb - Math.round(n.onsetBeat / bpb)) > EPS);
  const ok = cands.filter((n) => {
    const D = Math.ceil(n.onsetBeat / bpb) * bpb;
    return e.some((m) => m.onsetBeat >= D - EPS);
  });
  if (ok.length === 0) return null;
  const s = pick(rng, ok);
  const D = Math.ceil(s.onsetBeat / bpb) * bpb;
  const omit = new Map<number, StructuralKind>();
  for (const n of e) if (n.idx >= s.idx && n.onsetBeat < D - EPS) omit.set(n.idx, 'rejoin');
  return { omit, replays: [], displaced: [] };
}

function restart(e: readonly ExpectedNote[], bpb: number, rng: Rng): Structural | null {
  const n = e.length;
  const k = rng.next() < 0.6 ? 2 : bpb;
  const options: Structural[] = [];
  for (let b = 3; b < n - 6; b++) {
    const B = (e[b] as ExpectedNote).onsetBeat;
    const r0 = e.findIndex((x) => x.onsetBeat >= B - k - EPS);
    if (r0 < 0 || r0 >= b) continue;
    for (const c of [6, 5, 4]) {
      const r1 = r0 + c - 1;
      if (r1 >= n - 1) continue;
      const last = e[r1] as ExpectedNote;
      const E = last.onsetBeat + last.durBeats + k;
      const D = Math.ceil(E / bpb - EPS) * bpb;
      if (!e.some((x) => x.onsetBeat >= D - EPS)) continue;
      const omit = new Map<number, StructuralKind>();
      for (const x of e) if (x.idx >= b && x.onsetBeat < D - EPS) omit.set(x.idx, 'restart');
      options.push({ omit, replays: [{ from: r0, to: r1, offsetBeats: -k }], displaced: [{ fromIdx: r0, toIdx: r1, offsetBeats: -k }] });
      break;
    }
  }
  return options.length ? pick(rng, options) : null;
}

function skip(e: readonly ExpectedNote[], bpb: number, rng: Rng): Structural | null {
  const n = e.length;
  const k = bpb;
  const options: Structural[] = [];
  for (let b = 2; b < n - 6; b++) {
    const B = (e[b] as ExpectedNote).onsetBeat;
    const s0 = e.findIndex((x) => x.onsetBeat >= B + k - EPS);
    if (s0 < 0 || s0 <= b) continue;
    let s1 = s0 - 1;
    while (s1 + 1 < n && s1 + 1 - s0 < 6) {
      const x = e[s1 + 1] as ExpectedNote;
      if (x.onsetBeat + x.durBeats - k > B + k + EPS) break;
      s1++;
    }
    if (s1 - s0 + 1 < 4) continue;
    const omit = new Map<number, StructuralKind>();
    for (let i = b; i < s0; i++) omit.set(i, 'skip');
    options.push({ omit, replays: [{ from: s0, to: s1, offsetBeats: k }], displaced: [{ fromIdx: s0, toIdx: s1, offsetBeats: k }] });
  }
  return options.length ? pick(rng, options) : null;
}

const STRUCTURAL: Record<StructuralKind, (e: readonly ExpectedNote[], bpb: number, rng: Rng) => Structural | null> = { stop, rejoin, restart, skip };

/** Concert MIDI range the instrument's detector searches (01 section 7.3). */
const midiRange = (inst: Instrument): [number, number] => [
  69 + 12 * Math.log2(inst.detection.minHz / 440),
  69 + 12 * Math.log2(inst.detection.maxHz / 440),
];

/** Draw a perturbation plan. Deterministic in the rng state. */
export function drawPerturbation(e: readonly ExpectedNote[], bpb: number, bpm: number, inst: Instrument, rng: Rng, o: PerturbOptions = {}): PerturbationPlan {
  const n = e.length;
  const beatSec = 60 / bpm;
  const jitSd = uniform(rng, 3, 9);
  const centsSd = uniform(rng, 1.5, 4);
  const jitterMs = Array.from({ length: n }, () => Math.round(Math.max(-20, Math.min(20, jitSd * gauss(rng))) * 10) / 10);
  const centsPattern = Array.from({ length: n }, () => Math.round(Math.max(-7, Math.min(7, centsSd * gauss(rng))) * 10) / 10);
  const heldFrac = Math.round(uniform(rng, 0.82, 1) * 100) / 100;
  const spec: PerformSpec = { jitterMs, centsPattern, heldFrac };
  const notes: ExpectedNoteTruth[] = e.map((x) => ({
    idx: x.idx,
    played: true,
    omitReason: null,
    shiftMs: 0,
    jitterMs: jitterMs[x.idx] as number,
    cents: centsPattern[x.idx] as number,
    semis: 0,
    octaves: 0,
    errors: [],
  }));
  const kinds = new Set<PerturbationKind>(['timing', 'cents']);
  const plan: PerturbationPlan = { spec, kinds: [], structural: null, notes, displaced: [], extras: [] };

  const clean = o.clean ?? (o.structural ? false : rng.next() < (o.cleanProb ?? 0.25));
  if (clean) {
    plan.kinds = [...kinds];
    return plan;
  }

  const mods: Record<number, NoteMod> = {};
  // Structural first, so note errors avoid the notes it removes.
  const sk: StructuralKind | null = o.structural ?? (rng.next() < (o.structuralProb ?? 0.4) ? pick(rng, ['stop', 'restart', 'skip', 'rejoin'] as const) : null);
  if (sk) {
    const s = STRUCTURAL[sk](e, bpb, rng);
    if (s) {
      plan.structural = sk;
      kinds.add(sk);
      for (const [i, why] of s.omit) {
        mods[i] = { omit: true };
        const t = notes[i] as ExpectedNoteTruth;
        t.played = false;
        t.omitReason = why;
        t.errors.push(why);
      }
      spec.replays = s.replays;
      plan.displaced = s.displaced;
    }
  }
  const replayed = new Set<number>();
  for (const r of spec.replays ?? []) for (let i = r.from; i <= r.to; i++) replayed.add(i);
  const [lo, hi] = midiRange(inst);

  const free = e.filter((x) => !mods[x.idx] && !replayed.has(x.idx) && x.idx > 0);
  const count = Math.min(free.length, rng.int(1, 5));
  const used = new Set<number>();
  for (let c = 0; c < count * 3 && used.size < count; c++) {
    const x = pick(rng, free);
    if (used.has(x.idx)) continue;
    const t = notes[x.idx] as ExpectedNoteTruth;
    const kind = pick(rng, ['timing', 'timing', 'cents', 'semitone', 'octave', 'drop'] as const);
    const ioiLimit = 0.4 * Math.min(x.ioiPrevSec ?? Infinity, x.ioiNextSec ?? Infinity) * 1000;
    if (kind === 'timing') {
      const mag = uniform(rng, 60, 200);
      if (Math.min(mag, ioiLimit) < 60) continue;
      const shift = Math.round((rng.next() < 0.5 ? -1 : 1) * Math.min(mag, ioiLimit));
      mods[x.idx] = { shiftMs: shift };
      t.shiftMs = shift;
      t.jitterMs = 0;
    } else if (kind === 'cents') {
      if (x.durSec < 0.25) continue;
      const cents = Math.round((rng.next() < 0.5 ? -1 : 1) * uniform(rng, 15, 40));
      mods[x.idx] = { cents };
      t.cents = cents;
    } else if (kind === 'semitone') {
      const semis = pick(rng, [-2, -1, 1, 2]);
      if (x.concertMidi + semis < lo || x.concertMidi + semis > hi) continue;
      mods[x.idx] = { semis };
      t.semis = semis;
    } else if (kind === 'octave') {
      const octaves = rng.next() < 0.5 ? -1 : 1;
      if (x.concertMidi + 12 * octaves < lo || x.concertMidi + 12 * octaves > hi) continue;
      mods[x.idx] = { octaves };
      t.octaves = octaves;
    } else {
      mods[x.idx] = { omit: true };
      t.played = false;
      t.omitReason = 'drop';
    }
    t.errors.push(kind);
    kinds.add(kind);
    used.add(x.idx);
  }

  // Extras in rests of at least 3/4 beat, outside any omitted or replayed stretch.
  if (rng.next() < 0.5) {
    const gaps: { atBeat: number; len: number; near: number }[] = [];
    for (let i = 0; i + 1 < n; i++) {
      const a = e[i] as ExpectedNote;
      const b = e[i + 1] as ExpectedNote;
      const end = a.onsetBeat + a.durBeats;
      const len = b.onsetBeat - end;
      if (len >= 0.75 - EPS && !mods[i]?.omit && !mods[i + 1]?.omit && !replayed.has(i) && !replayed.has(i + 1)) gaps.push({ atBeat: end, len, near: a.concertMidi });
    }
    const m = Math.min(gaps.length, rng.int(1, 3));
    for (let k = 0; k < m; k++) {
      const g = gaps.splice(rng.int(0, gaps.length), 1)[0] as (typeof gaps)[number];
      const durBeats = Math.min(0.5, g.len * 0.4);
      if (durBeats * beatSec < 0.12) continue;
      const midi = Math.max(Math.ceil(lo), Math.min(Math.floor(hi), g.near + pick(rng, [-5, -3, -2, 2, 3, 4, 5])));
      plan.extras.push({ atBeat: g.atBeat + g.len * 0.3, durBeats, midi, duringRest: true });
    }
    if (plan.extras.length) {
      spec.extras = plan.extras;
      kinds.add('extra');
    }
  }

  spec.mods = mods;
  plan.kinds = [...kinds];
  return plan;
}
