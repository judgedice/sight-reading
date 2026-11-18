/**
 * Injected-error recipes for the tip-precision suite (02 section 6.2 acceptance, 01 section 13.2 "tip precision").
 *
 * Each recipe turns a clean take of a fixture-corpus scenario into a take with one kind of reading error, written as
 * the musical error a player makes (not as judgments), large enough to meet the pattern's minimum evidence with
 * margin:
 *
 * | Pattern | Error |
 * | --- | --- |
 * | E6 | a stop of 1 or 2 bars, or a restart 2 beats or a bar back (the scenario generator's structural cases) |
 * | E12 | about half of the key-signature notes played without the signature's accidental, never two in a row |
 * | E13 | up to 4 written accidentals ignored |
 * | E22 | the whole take 30 cents sharp or flat (no tuning note) |
 * | E23 | voice sinking or rising linearly to 60 cents by the last note |
 * | E1 / E2 | steady rushing or dragging: max(1.2 tRed, 0.33 beat) over the excerpt, at least 0.06 beat per bar |
 * | E28 / E29 | pickup or first note late by max(1.4 tRed, 0.35 beat) |
 * | E9 | every entry after a rest of 1 beat or more early by tRed + max(25 ms, 0.08 beat) |
 * | E7 / E8 | dotted figures played at a 1.5 (else 1.75) long:short ratio |
 * | E4 | downbeats not after a rest late by max(0.2 beat, 80 ms), at most 30% of the notes, spread over the bars |
 * | E18 | 60% of the notes with 2 or more ledger lines read one diatonic step off |
 * | E26 | every other note of each beat in the densest quarter of beats dropped |
 * | E16 | up to 3 trumpet notes on the neighbouring partial of the same valve combination |
 * | E31 | every clarinet note that crosses the break (written B♭4/B4) a whole tone off |
 *
 * Excerpts come from the shipped corpus at served levels (`shipped.ts`). Shifts stay inside 0.75 of the match window, so the note is still matched (late or early) and not missed plus
 * extra. A recipe that finds no fitting excerpt for its instrument returns null and the planner tries the next
 * scenario; patterns limited to one instrument (E16 trumpet, E31 clarinet, E23 voice) search only that instrument.
 */
import { TPQ } from '../../core/types.ts';
import type { Configs, ExpectedNote, ResolvedTolerance, SpelledPitch, Step, TestkitTimbre } from '../../core/types.ts';
import { expectedSteadyMs, resolveTolerances } from '../../rules/index.ts';
import { toMidi } from '../../theory/index.ts';
import type { NoteMod, PerformSpec } from '../../../fixtures/follow/gen/perform.ts';
import { scenarioConfigs, scenarioSeed, type PerturbationKind, type ScenarioBase, type ScenarioPlan } from '../scenarios/index.ts';
import { planShipped } from './shipped.ts';
import { INJECTED_PATTERNS, LAUNCH_TIMBRES, type InjectedPattern } from './types.ts';

export const TIP_SEED = 0x7195_e30a;
/** Scenario draws tried per instrument before a recipe is declared unfit for it. */
const MAX_TRIES = 80;
const MAX_SHIFT_OF_WINDOW = 0.75;
const EPS = 1e-9;

interface Injection {
  spec: Partial<PerformSpec>;
  /** The error kind recorded on each injected note (keeps them out of the false-red count). */
  marks: Record<number, PerturbationKind>;
}

interface Ctx {
  base: ScenarioBase;
  e: readonly ExpectedNote[];
  tol: readonly ResolvedTolerance[];
  cfg: Configs;
  r: number;
  beatMs: number;
  quarterMs: number;
  lo: number;
  hi: number;
}

const inRange = (c: Ctx, midi: number): boolean => midi >= c.lo + 1 && midi <= c.hi - 1;
const distinct = (c: Ctx, i: number, midi: number): boolean => midi !== c.e[i - 1]?.concertMidi && midi !== c.e[i + 1]?.concertMidi;
const windowMs = (c: Ctx, i: number): number => (c.tol[i] as ResolvedTolerance).matchWindowSec * 1000;
const tRedMs = (c: Ctx, i: number): number => (c.tol[i] as ResolvedTolerance).tRedSec * 1000;
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

/**
 * Up to `count` candidates, never two neighbours, spread over as many bars as possible (evidence must span 2 bars,
 * 02 section 6.1): one per bar first, then the rest in note order. Returned in note order.
 */
function spread<T extends { i: number }>(c: Ctx, cands: readonly T[], count: number): T[] {
  const ok = (sel: T[], x: T): boolean => sel.every((y) => Math.abs(y.i - x.i) >= 2);
  const sel: T[] = [];
  const bars = new Set<number>();
  for (const x of cands) {
    const bar = (c.e[x.i] as ExpectedNote).bar;
    if (sel.length < count && !bars.has(bar) && ok(sel, x)) {
      sel.push(x);
      bars.add(bar);
    }
  }
  for (const x of cands) if (sel.length < count && !sel.includes(x) && ok(sel, x)) sel.push(x);
  return sel.sort((a, b) => a.i - b.i);
}

const barCount = (c: Ctx, xs: readonly { i: number }[]): number => new Set(xs.map((x) => (c.e[x.i] as ExpectedNote).bar)).size;

function wrongNotes(picks: { i: number; semis: number }[], kind: PerturbationKind = 'semitone'): Injection {
  const mods: Record<number, NoteMod> = {};
  const marks: Record<number, PerturbationKind> = {};
  for (const p of picks) {
    mods[p.i] = { semis: p.semis };
    marks[p.i] = kind;
  }
  return { spec: { mods }, marks };
}

const SHARP_ORDER: readonly Step[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const STEPS: readonly Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
function keySig(c: Ctx): Map<Step, number> {
  const k = c.base.writtenKey.fifths;
  const letters = k >= 0 ? SHARP_ORDER : [...SHARP_ORDER].reverse();
  return new Map(letters.slice(0, Math.min(7, Math.abs(k))).map((s) => [s, Math.sign(k)]));
}

// ---- notes ------------------------------------------------------------------------------

function e12(c: Ctx): Injection | null {
  const sig = keySig(c);
  let eligible = 0;
  const cands: { i: number; semis: number }[] = [];
  for (const n of c.e) {
    const s = sig.get(n.writtenPitch.step);
    if (n.keySigAltered) {
      eligible++;
      const semis = -n.writtenPitch.alter;
      if (n.idx >= 1 && inRange(c, n.concertMidi + semis) && distinct(c, n.idx, n.concertMidi + semis)) cands.push({ i: n.idx, semis });
    } else if (!n.explicitAccidental && s !== undefined && s !== n.writtenPitch.alter) eligible++;
  }
  const chosen = spread(c, cands, Math.max(2, Math.ceil(0.5 * eligible)));
  if (chosen.length < 2 || chosen.length < 0.3 * eligible + 0.5 || barCount(c, chosen) < 2) return null;
  return wrongNotes(chosen);
}

function e13(c: Ctx): Injection | null {
  const sig = keySig(c);
  const cands: { i: number; semis: number }[] = [];
  for (const n of c.e) {
    if (!n.explicitAccidental || n.idx < 1) continue;
    const semis = -n.writtenPitch.alter + (sig.get(n.writtenPitch.step) ?? 0);
    if (semis === 0 || !inRange(c, n.concertMidi + semis) || !distinct(c, n.idx, n.concertMidi + semis)) continue;
    cands.push({ i: n.idx, semis });
  }
  const chosen = spread(c, cands, 4);
  if (chosen.length < 2 || barCount(c, chosen) < 2) return null;
  return wrongNotes(chosen);
}

function diatonicNeighbour(p: SpelledPitch, steps: number, sig: Map<Step, number>): number {
  const pos = p.octave * 7 + STEPS.indexOf(p.step) + steps;
  const step = STEPS[((pos % 7) + 7) % 7] as Step;
  return toMidi({ step, alter: 0, octave: Math.floor(pos / 7) }) + (sig.get(step) ?? 0);
}

function e18(c: Ctx): Injection | null {
  const sig = keySig(c);
  const ledger = c.e.filter((n) => n.ledgerLines >= 2);
  if (ledger.length < 2) return null;
  const cands: { i: number; semis: number }[] = [];
  for (const n of ledger) {
    if (n.idx < 1) continue;
    const target = n.concertMidi + c.base.inst.semis;
    for (const s of [1, -1]) {
      const semis = diatonicNeighbour(n.writtenPitch, s, sig) - target;
      if (semis === 0 || Math.abs(semis) > 3 || !inRange(c, n.concertMidi + semis) || !distinct(c, n.idx, n.concertMidi + semis)) continue;
      cands.push({ i: n.idx, semis });
      break;
    }
  }
  const need = Math.max(2, Math.ceil(0.6 * ledger.length));
  const chosen = spread(c, cands, need);
  if (chosen.length < need || barCount(c, chosen) < 2) return null;
  return wrongNotes(chosen);
}

function e26(c: Ctx): Injection | null {
  const bins = new Map<number, number[]>();
  for (const n of c.e) {
    const b = Math.floor(n.onsetBeat + EPS);
    bins.set(b, [...(bins.get(b) ?? []), n.idx]);
  }
  const groups = [...bins.values()].sort((a, b) => b.length - a.length);
  const k = Math.max(1, Math.ceil(0.25 * groups.length - EPS));
  const q = (groups[k - 1] as number[]).length;
  const dense = groups.filter((g) => g.length >= q);
  const rest = groups.filter((g) => g.length < q);
  if (q < 2 || rest.length === 0 || dense.length < 5) return null;
  const mods: Record<number, NoteMod> = {};
  const marks: Record<number, PerturbationKind> = {};
  for (const g of dense) {
    g.forEach((i, pos) => {
      if (pos % 2 === 1 && i > 0) {
        mods[i] = { omit: true };
        marks[i] = 'drop';
      }
    });
  }
  return { spec: { mods }, marks };
}

function e16(c: Ctx): Injection | null {
  const table = c.cfg.trumpetValves.entries;
  const byWritten = new Map(table.map((t) => [t.writtenMidi, t] as const));
  const cands: { i: number; semis: number }[] = [];
  for (const n of c.e) {
    if (n.idx < 1) continue;
    const target = n.concertMidi + c.base.inst.semis;
    const t = byWritten.get(target);
    if (!t) continue;
    const partials = [...new Set(table.filter((x) => x.valves === t.valves).map((x) => x.partial))].sort((a, b) => a - b);
    const pi = partials.indexOf(t.partial);
    const opts = table
      .filter((x) => x.valves === t.valves && Math.abs(partials.indexOf(x.partial) - pi) === 1)
      .map((x) => x.writtenMidi - target)
      .filter((s) => s % 12 !== 0 && inRange(c, n.concertMidi + s) && distinct(c, n.idx, n.concertMidi + s))
      .sort((a, b) => Math.abs(a) - Math.abs(b));
    if (opts.length) cands.push({ i: n.idx, semis: opts[0] as number });
  }
  const chosen = spread(c, cands, 3);
  if (chosen.length < 2 || barCount(c, chosen) < 2) return null;
  return wrongNotes(chosen);
}

function e31(c: Ctx): Injection | null {
  const low = 70;
  const high = 71;
  const w = (i: number): number => (c.e[i] as ExpectedNote).concertMidi + c.base.inst.semis;
  const cands: { i: number; semis: number }[] = [];
  for (let i = 1; i < c.e.length; i++) {
    const a = w(i - 1);
    const b = w(i);
    if (!((a <= low && b >= high) || (a >= high && b <= low))) continue;
    const n = c.e[i] as ExpectedNote;
    for (const s of [2, -2]) {
      if (inRange(c, n.concertMidi + s) && distinct(c, i, n.concertMidi + s)) {
        cands.push({ i, semis: s });
        break;
      }
    }
  }
  const chosen = spread(c, cands, cands.length);
  if (chosen.length < 3 || barCount(c, chosen) < 2) return null;
  return wrongNotes(chosen);
}

// ---- intonation ----------------------------------------------------------------------------

function e22(c: Ctx): Injection | null {
  const steady = c.e.filter((n) => expectedSteadyMs(n, c.tol[n.idx] as ResolvedTolerance) >= 150);
  if (steady.length < 10) return null;
  const marks: Record<number, PerturbationKind> = {};
  for (const n of c.e) marks[n.idx] = 'cents';
  return { spec: { globalCents: c.r % 2 === 0 ? 30 : -30 }, marks };
}

function e23(c: Ctx): Injection | null {
  if (c.e.length < 12) return null;
  const sign = c.r % 2 === 0 ? -1 : 1;
  const mods: Record<number, NoteMod> = {};
  const marks: Record<number, PerturbationKind> = {};
  const n = c.e.length;
  for (const x of c.e) {
    mods[x.idx] = { cents: Math.round((sign * 60 * x.idx) / (n - 1)) };
    marks[x.idx] = 'cents';
  }
  return { spec: { mods }, marks };
}

// ---- rhythm --------------------------------------------------------------------------------

function drift(c: Ctx, sign: 1 | -1): Injection | null {
  const bpb = c.base.beatsPerBar;
  const first = c.e[0] as ExpectedNote;
  const last = c.e[c.e.length - 1] as ExpectedNote;
  const spanBars = (last.onsetBeat - first.onsetBeat) / bpb;
  if (c.e.length < 14 || spanBars < 6) return null;
  // Total drift over the excerpt: past tRed and the 0.25-beat minimum with margin, yet every note stays matched.
  const tRedBeats = median(c.e.map((n) => tRedMs(c, n.idx))) / c.beatMs;
  const total = Math.max(1.2 * tRedBeats, 0.33);
  const slope = Math.max(0.06, total / spanBars);
  for (const n of c.e) {
    const at = Math.abs(slope * ((n.onsetBeat - first.onsetBeat) / bpb) * c.beatMs);
    if (at > 0.85 * windowMs(c, n.idx)) return null;
  }
  const marks: Record<number, PerturbationKind> = {};
  for (const n of c.e) marks[n.idx] = 'timing';
  return { spec: { driftBeatsPerBar: sign * slope }, marks };
}

function firstEntry(c: Ctx, wantPickup: boolean): Injection | null {
  const hasPickup = c.e.some((n) => n.onsetBeat < -EPS);
  if (hasPickup !== wantPickup) return null;
  const n = c.e[0] as ExpectedNote;
  const s = Math.round(Math.max(1.4 * tRedMs(c, 0), 0.35 * c.beatMs));
  if (s > MAX_SHIFT_OF_WINDOW * windowMs(c, 0) || (n.ioiNextSec ?? Infinity) * 1000 - s < 120) return null;
  return { spec: { mods: { 0: { shiftMs: s } } }, marks: { 0: 'timing' } };
}

function e9(c: Ctx): Injection | null {
  const mods: Record<number, NoteMod> = {};
  const marks: Record<number, PerturbationKind> = {};
  for (let i = 1; i < c.e.length; i++) {
    const n = c.e[i] as ExpectedNote;
    const p = c.e[i - 1] as ExpectedNote;
    if (!n.precededByRest) continue;
    const restBeats = n.onsetBeat - (p.onsetBeat + p.durBeats);
    if (restBeats < 1 - EPS) continue;
    const s = Math.round(tRedMs(c, i) + Math.max(25, 0.08 * c.beatMs));
    if (s > MAX_SHIFT_OF_WINDOW * windowMs(c, i) || restBeats * c.beatMs - s < 80) continue;
    mods[i] = { shiftMs: -s };
    marks[i] = 'timing';
  }
  return Object.keys(mods).length >= 3 ? { spec: { mods }, marks } : null;
}

/**
 * Dotted figures evened out: the short note comes early by `s` ((long - s) / (short + s) = ratio). Where that would
 * leave 0.75 of the match window, the dotted note (off a downbeat) also comes late by `s` ((long - 2s) / (short + s)).
 */
function dotted(c: Ctx, longQ: number, shortQ: number, minShortMs: number): Injection | null {
  const unitQ = c.base.meter.countUnitTicks / TPQ;
  const q = (beats: number): number => beats * unitQ;
  const mods: Record<number, NoteMod> = {};
  const marks: Record<number, PerturbationKind> = {};
  let figures = 0;
  let eligible = 0;
  for (let i = 0; i + 2 < c.e.length; i++) {
    const a = c.e[i] as ExpectedNote;
    const b = c.e[i + 1] as ExpectedNote;
    const d = c.e[i + 2] as ExpectedNote;
    if (b.precededByRest || d.precededByRest || mods[b.idx] || mods[d.idx]) continue;
    if (Math.abs(q(b.onsetBeat - a.onsetBeat) - longQ) > EPS || Math.abs(q(d.onsetBeat - b.onsetBeat) - shortQ) > EPS) continue;
    if ((d.onsetSec - b.onsetSec) * 1000 < minShortMs - EPS) continue;
    eligible++;
    // The short note early (the dotted note held short); only when that leaves the match window, the dotted note
    // also comes late, never on a downbeat (that would be a barline hesitation, E4).
    const aFree = !mods[a.idx] && a.idx > 0 && Math.abs(a.beatInBar - 1) > EPS;
    for (const both of [false, true]) {
      if (both && !aFree) break;
      const ratio = [1.5, 1.75].find((x) => {
        const sMs = ((longQ - x * shortQ) / (both ? 2 + x : 1 + x)) * c.quarterMs;
        return sMs <= MAX_SHIFT_OF_WINDOW * windowMs(c, b.idx) && (!both || sMs <= MAX_SHIFT_OF_WINDOW * windowMs(c, a.idx));
      });
      if (ratio === undefined) continue;
      const sMs = Math.round(((longQ - ratio * shortQ) / (both ? 2 + ratio : 1 + ratio)) * c.quarterMs);
      if (both) {
        mods[a.idx] = { shiftMs: sMs };
        marks[a.idx] = 'timing';
      }
      mods[b.idx] = { shiftMs: -sMs };
      marks[b.idx] = 'timing';
      figures++;
      break;
    }
  }
  // The detector takes the median over every figure, so the evened figures must be a clear majority of them (where the
  // match window is too narrow for the evened short note, the error cannot be measured on that excerpt).
  return figures >= 3 && figures >= (2 * eligible) / 3 ? { spec: { mods }, marks } : null;
}

function e4(c: Ctx): Injection | null {
  const s = Math.round(Math.max(0.2 * c.beatMs, 80));
  const cands: { i: number }[] = [];
  for (const n of c.e) {
    if (n.idx === 0 || Math.abs(n.beatInBar - 1) > EPS || n.precededByRest) continue;
    if (s > MAX_SHIFT_OF_WINDOW * windowMs(c, n.idx) || (n.ioiNextSec ?? Infinity) * 1000 - s < 120) continue;
    cands.push({ i: n.idx });
  }
  // Hesitations are relative to the take's median timing, so at most 30% of the notes may carry one.
  const chosen = spread(c, cands, Math.floor(0.3 * c.e.length));
  if (chosen.length < 5) return null;
  const mods: Record<number, NoteMod> = {};
  const marks: Record<number, PerturbationKind> = {};
  for (const { i } of chosen) {
    mods[i] = { shiftMs: s };
    marks[i] = 'timing';
  }
  return { spec: { mods }, marks };
}

const RECIPES: Record<Exclude<InjectedPattern, 'E6'>, (c: Ctx) => Injection | null> = {
  E12: e12,
  E13: e13,
  E22: e22,
  E23: e23,
  E1: (c) => drift(c, -1),
  E2: (c) => drift(c, 1),
  E28: (c) => firstEntry(c, true),
  E29: (c) => firstEntry(c, false),
  E9: e9,
  E7: (c) => dotted(c, 1.5, 0.5, 150),
  E8: (c) => dotted(c, 0.75, 0.25, 120),
  E4: e4,
  E18: e18,
  E26: e26,
  E16: e16,
  E31: e31,
};

/** The instruments a pattern is measured on (E16, E31 and E23 are instrument patterns; E22 needs continuous pitch, no voice). */
export function patternTimbres(p: InjectedPattern): readonly TestkitTimbre[] {
  if (p === 'E16') return ['trumpet'];
  if (p === 'E31') return ['clarinet'];
  if (p === 'E23') return ['voice'];
  if (p === 'E22') return LAUNCH_TIMBRES.filter((t) => t !== 'voice' && t !== 'piano');
  return LAUNCH_TIMBRES;
}

function ctxOf(base: ScenarioBase, r: number): Ctx {
  const cfg = scenarioConfigs();
  const tol = resolveTolerances(base.expected, { instrument: base.inst, level: base.level, bpm: base.bpm, meter: base.meter }, cfg);
  const beatMs = 60000 / base.bpm;
  const [lo, hi] = [base.inst.detection.minHz, base.inst.detection.maxHz].map((hz) => 69 + 12 * Math.log2(hz / 440)) as [number, number];
  return { base, e: base.expected, tol, cfg, r, beatMs, quarterMs: beatMs / (base.meter.countUnitTicks / TPQ), lo, hi };
}

const patternSeed = (p: InjectedPattern): number => scenarioSeed(TIP_SEED, INJECTED_PATTERNS.indexOf(p) + 1);

/** A clean shipped-corpus plan for perfect take `r` (tip suite): launch timbre r mod 8. */
export function planPerfect(r: number): ScenarioPlan {
  const timbre = LAUNCH_TIMBRES[r % LAUNCH_TIMBRES.length] as TestkitTimbre;
  for (let a = 0; a < MAX_TRIES; a++) {
    const plan = planShipped(TIP_SEED, r * 1009 + a, timbre, { clean: true });
    if (plan) return plan;
  }
  throw new Error(`no shipped excerpt builds for ${timbre}`);
}

function applyInjection(plan: ScenarioPlan, inj: Injection): ScenarioPlan {
  const p = plan.perturbation;
  const spec: PerformSpec = { ...p.spec, ...inj.spec, mods: { ...(inj.spec.mods ?? {}) } };
  const notes = p.notes.map((n) => {
    const k = inj.marks[n.idx];
    if (!k) return n;
    const m = spec.mods?.[n.idx];
    return {
      ...n,
      errors: [...n.errors, k],
      played: !m?.omit,
      omitReason: m?.omit ? ('drop' as const) : n.omitReason,
      semis: m?.semis ?? n.semis,
      shiftMs: m?.shiftMs ?? n.shiftMs,
      cents: m?.cents ?? n.cents,
    };
  });
  const kinds = [...new Set([...p.kinds, ...Object.values(inj.marks)])];
  return { ...plan, perturbation: { ...p, spec, notes, kinds } };
}

/** E6: the generator's stop or restart, with its random note errors and extras stripped. */
function planE6(seed: number, idx: number, timbre: TestkitTimbre, r: number): ScenarioPlan | null {
  const structural = r % 2 === 0 ? 'stop' : 'restart';
  const plan = planShipped(seed, idx, timbre, { structural });
  if (!plan) return null;
  const p = plan.perturbation;
  if (p.structural !== structural) return null;
  const mods: Record<number, NoteMod> = {};
  const notes = p.notes.map((n) => {
    if (n.omitReason === structural) {
      mods[n.idx] = { omit: true };
      return { ...n, errors: [structural] as PerturbationKind[] };
    }
    return { ...n, played: true, omitReason: null, shiftMs: 0, semis: 0, octaves: 0, errors: [] as PerturbationKind[] };
  });
  const spec: PerformSpec = { jitterMs: p.spec.jitterMs ?? [], centsPattern: p.spec.centsPattern ?? [], heldFrac: p.spec.heldFrac ?? 0.92, mods, ...(p.spec.replays ? { replays: p.spec.replays } : {}) };
  return { ...plan, perturbation: { ...p, spec, notes, extras: [], kinds: ['timing', 'cents', structural] } };
}

/**
 * The plan of injected-error take `r` for a pattern: instrument `patternTimbres(p)[r mod n]`, the first scenario draw
 * (deterministic in the pattern and `r`) whose excerpt fits the recipe. Null when no draw fits on any allowed
 * instrument.
 */
export function planInjected(p: InjectedPattern, r: number): ScenarioPlan | null {
  const timbres = patternTimbres(p);
  const seed = patternSeed(p);
  for (let k = 0; k < timbres.length; k++) {
    const timbre = timbres[(r + k) % timbres.length] as TestkitTimbre;
    for (let a = 0; a < MAX_TRIES; a++) {
      const idx = r * 1009 + a;
      if (p === 'E6') {
        const plan = planE6(seed, idx, timbre, r);
        if (plan) return plan;
        continue;
      }
      const plan = planShipped(seed, idx, timbre, { clean: true });
      if (!plan) continue;
      const inj = RECIPES[p](ctxOf(plan.base, r));
      if (inj) return applyInjection({ ...plan, id: `${p}:${r}:${plan.id}` }, inj);
    }
  }
  return null;
}
