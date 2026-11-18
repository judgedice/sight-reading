/** "notes" dimension detectors (02 §6.2): E12, E13, E16, E18, E26, E31. */
import type { PatternDef, SpelledPitch, Step } from '../../core/types.ts';
import { toMidi } from '../../theory/index.ts';
import {
  type Candidate,
  componentCredit,
  ev,
  isWrongPitch,
  matched,
  type PatternContext,
  playedCentsOff,
  playedWritten,
  relDelta,
  targetWritten,
  th,
  tRedMs,
} from './context.ts';

const PERCENT = 100;
const STEPS: readonly Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTERS_PER_OCTAVE = 7;
const OCTAVE = 12;
const EPS = 1e-9;

const mod = (n: number, m: number): number => ((n % m) + m) % m;

/** A wrong pitch whose played semitone is clear (within `clearCents` of a semitone). */
function clearWrong(ctx: PatternContext, idx: number, clearCents: number): number | null {
  if (!isWrongPitch(ctx, idx)) return null;
  const off = playedCentsOff(ctx, idx);
  if (off === null || off > clearCents) return null;
  return playedWritten(ctx, idx);
}

/**
 * E12: wrong pitch where played = target with the key-signature accidental removed, or the key-signature accidental
 * applied where the note does not carry it (a carried or cancelled letter without its own written accidental).
 * Evidence ≥ 2 notes in ≥ 2 bars and ≥ 30% of the notes the rule applies to (the key-signature-altered notes, plus
 * the unaltered letters the signature would alter).
 */
export function detectE12(ctx: PatternContext, def: PatternDef): Candidate | null {
  const clear = th(def, 'clearCents');
  const notes: number[] = [];
  /** Notes the rule can apply to: key-signature-altered ones, and unaltered letters the signature would alter. */
  let eligible = 0;
  for (const e of ctx.expected) {
    const target = targetWritten(ctx, e.idx);
    const sig = ctx.keySig.get(e.writtenPitch.step);
    let slip: number | null = null;
    if (e.keySigAltered) slip = target - e.writtenPitch.alter;
    else if (!e.explicitAccidental && sig !== undefined && sig !== e.writtenPitch.alter) slip = target + sig - e.writtenPitch.alter;
    if (slip === null) continue;
    eligible++;
    if (clearWrong(ctx, e.idx, clear) === slip) notes.push(e.idx);
  }
  if (eligible === 0 || notes.length < ev(def, 'notes')) return null;
  if (new Set(notes.map((i) => ctx.expected[i]!.bar)).size < ev(def, 'bars')) return null;
  if (notes.length < th(def, 'minShareOfKeySigNotes') * eligible - EPS) return null;
  return { notes };
}

/** E13: wrong pitch where played = target without its written accidental (the key's default for the letter). */
export function detectE13(ctx: PatternContext, def: PatternDef): Candidate | null {
  const clear = th(def, 'clearCents');
  const notes: number[] = [];
  for (const e of ctx.expected) {
    if (!e.explicitAccidental) continue;
    const played = clearWrong(ctx, e.idx, clear);
    if (played === null) continue;
    const without = targetWritten(ctx, e.idx) - e.writtenPitch.alter + (ctx.keySig.get(e.writtenPitch.step) ?? 0);
    if (without !== targetWritten(ctx, e.idx) && played === without) notes.push(e.idx);
  }
  return notes.length >= ev(def, 'notes') ? { notes } : null;
}

/**
 * E16 (trumpet): played and target share the valve combination on adjacent partials, not an octave apart. Adjacent
 * means neighbours among the partials `data/trumpet-valves.json` uses for that combination (02 §4.5, §4.9 case 9).
 */
export function detectE16(ctx: PatternContext, def: PatternDef): Candidate | null {
  const table = ctx.input.cfg.trumpetValves.entries;
  const byWritten = new Map(table.map((t) => [t.writtenMidi, t] as const));
  const notes: number[] = [];
  for (const e of ctx.expected) {
    if (!isWrongPitch(ctx, e.idx)) continue;
    const played = playedWritten(ctx, e.idx);
    const target = targetWritten(ctx, e.idx);
    if (played === null || Math.abs(played - target) % OCTAVE === 0) continue;
    const t = byWritten.get(target);
    const p = byWritten.get(played);
    if (!t || !p || t.valves !== p.valves) continue;
    const partials = [...new Set(table.filter((x) => x.valves === t.valves).map((x) => x.partial))].sort((a, b) => a - b);
    if (Math.abs(partials.indexOf(t.partial) - partials.indexOf(p.partial)) === 1) notes.push(e.idx);
  }
  return notes.length >= ev(def, 'notes') ? { notes } : null;
}

/** Written MIDI of the letter `steps` diatonic steps from `p`, with the given alteration. */
function diatonicNeighbour(p: SpelledPitch, steps: number, alter: number): number {
  const pos = p.octave * LETTERS_PER_OCTAVE + STEPS.indexOf(p.step) + steps;
  const step = STEPS[mod(pos, LETTERS_PER_OCTAVE)]!;
  const octave = Math.floor(pos / LETTERS_PER_OCTAVE);
  return toMidi({ step, alter: 0, octave }) + alter;
}

/**
 * E18: wrong pitch on notes with ≥ 2 ledger lines, played on a line or space 1 or 2 diatonic steps away (spelled with
 * the key's alteration for that letter, or the target's own alteration). Evidence ≥ 2 notes and ≥ 40% of those notes.
 */
export function detectE18(ctx: PatternContext, def: PatternDef): Candidate | null {
  const minLedger = th(def, 'minLedgerLines');
  const maxSteps = th(def, 'maxDiatonicSteps');
  const ledger = ctx.expected.filter((e) => e.ledgerLines >= minLedger);
  if (ledger.length === 0) return null;
  const notes: number[] = [];
  for (const e of ledger) {
    if (!isWrongPitch(ctx, e.idx)) continue;
    const played = playedWritten(ctx, e.idx);
    if (played === null) continue;
    const wp = e.writtenPitch;
    let hit = false;
    for (let k = 1; k <= maxSteps && !hit; k++) {
      for (const s of [k, -k]) {
        const step = STEPS[mod(STEPS.indexOf(wp.step) + s, LETTERS_PER_OCTAVE)]!;
        const alters = new Set([ctx.keySig.get(step) ?? 0, wp.alter]);
        for (const a of alters) if (diatonicNeighbour(wp, s, a) === played) hit = true;
      }
    }
    if (hit) notes.push(e.idx);
  }
  if (notes.length < ev(def, 'notes')) return null;
  return notes.length >= th(def, 'minShareOfLedgerNotes') * ledger.length - EPS ? { notes } : null;
}

/** Per-note credit over P and R, 0..100, weighted by the attempt's component weights. */
function noteCreditPoints(ctx: PatternContext, idx: number): number {
  const w = ctx.comps.weights;
  const p = componentCredit(ctx, idx, 'P') ?? 0;
  const r = componentCredit(ctx, idx, 'R') ?? 0;
  const sum = w.P + w.R;
  return sum > 0 ? (PERCENT * (w.P * p + w.R * r)) / sum : 0;
}

/**
 * E26: mean per-note credit in the densest 25% of beats at least 25 points below the rest. Beats are whole metronome
 * beats; density is notes per beat. Notes inside a stop or replay are left out (E6 covers them). The dense set needs
 * a strictly higher density than the rest, so an excerpt of even note values never fires.
 */
export function detectE26(ctx: PatternContext, def: PatternDef): Candidate | null {
  const bins = new Map<number, number[]>();
  for (const e of ctx.expected) {
    if (ctx.flowNotes.has(e.idx)) continue;
    const b = Math.floor(e.onsetBeat + EPS);
    const list = bins.get(b) ?? [];
    list.push(e.idx);
    bins.set(b, list);
  }
  const groups = [...bins.values()].sort((a, b) => b.length - a.length);
  if (groups.length === 0) return null;
  const k = Math.max(1, Math.ceil(th(def, 'densestFraction') * groups.length - EPS));
  const q = groups[k - 1]!.length;
  const dense = groups.filter((g) => g.length >= q);
  const rest = groups.filter((g) => g.length < q);
  if (rest.length === 0 || dense.length < ev(def, 'denseBeats')) return null;
  const mean = (gs: number[][]): number => {
    const xs = gs.flat().map((i) => noteCreditPoints(ctx, i));
    return xs.reduce((s, x) => s + x, 0) / xs.length;
  };
  if (mean(rest) - mean(dense) < th(def, 'minCreditGapPoints')) return null;
  const notes = dense.flat().filter((i) => noteCreditPoints(ctx, i) < PERCENT - EPS);
  return { notes: notes.sort((a, b) => a - b) };
}

/**
 * E31 (clarinet): wrong pitch or late onset on notes crossing written B♭4/B4 (70/71), at ≥ 2× the error rate
 * elsewhere. A crossing is a move from ≤ 70 to ≥ 71 or back. "Late" is relative to the attempt median by more than
 * tRed, and is only used with a measured calibration (02 §6.1). Missed notes and stop or replay notes are left out.
 */
export function detectE31(ctx: PatternContext, def: PatternDef): Candidate | null {
  const low = th(def, 'breakLowMidi');
  const high = th(def, 'breakHighMidi');
  const isError = (i: number): boolean => {
    if (isWrongPitch(ctx, i)) return true;
    const rd = relDelta(ctx, i);
    return ctx.input.calibrationMeasured && rd !== null && rd > tRedMs(ctx, i);
  };
  let nCross = 0;
  let nElse = 0;
  let eElse = 0;
  const crossErr: number[] = [];
  for (let i = 1; i < ctx.expected.length; i++) {
    if (!matched(ctx, i) || ctx.flowNotes.has(i)) continue;
    const a = targetWritten(ctx, i - 1);
    const b = targetWritten(ctx, i);
    const crossing = (a <= low && b >= high) || (a >= high && b <= low);
    if (crossing) {
      nCross++;
      if (isError(i)) crossErr.push(i);
    } else {
      nElse++;
      if (isError(i)) eElse++;
    }
  }
  if (crossErr.length < ev(def, 'crossingsWithErrors')) return null;
  const rateElse = nElse === 0 ? 0 : eElse / nElse;
  return crossErr.length / nCross >= th(def, 'errorRateRatio') * rateElse ? { notes: crossErr } : null;
}
