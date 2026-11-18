/**
 * Shared state for the v1 pattern detectors (02 §6.1, §6.2; P12b). Built once per `detectPatterns` call from the
 * final judgments. Every threshold is read from `config/tips.json` (pattern `thresholds` / `minEvidence`) or from the
 * resolved per-note tolerances; this file holds no tolerance constants.
 */
import type { ComponentId, ExpectedNote, GradeInput, NoteJudgment, PatternDef, ResolvedTolerance, Step } from '../../core/types.ts';
import { computeComponents, type ComponentResult } from '../components.ts';
import { computeDiagnostics, type Diagnostics } from '../diagnostics.ts';

const MS_PER_SEC = 1000;
const MS_PER_MIN = 60000;
const PERCENT = 100;
const EPS = 1e-9;

/** A detector's raw finding before the global rules (02 §6.1 item 3) and `lostPoints`. */
export interface Candidate {
  /** Evidence notes (expected indices). */
  notes: number[];
  /** Extra evidence bars that have no note (a stop or a restart). */
  extraBars?: number[];
  params?: Record<string, number>;
}

export interface PatternContext {
  input: GradeInput;
  expected: readonly ExpectedNote[];
  tol: readonly ResolvedTolerance[];
  /** Judgment per expected index. */
  judgment: readonly (NoteJudgment | undefined)[];
  comps: ComponentResult;
  diag: Diagnostics;
  n: number;
  beatMs: number;
  beatsPerBar: number;
  /** Median timing error over matched notes, ms; null when nothing matched (02 §6.1: timing is relative to it). */
  medianDeltaMs: number | null;
  /** Expected indices that belong to a stop or are covered by a replay / skip (E6 evidence). */
  flowNotes: ReadonlySet<number>;
  /** Key-signature alteration per letter, inferred from the notes marked `keySigAltered`. */
  keySig: ReadonlyMap<Step, number>;
}

export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export const uniqSorted = (xs: readonly number[]): number[] => [...new Set(xs)].sort((a, b) => a - b);

export function matched(ctx: PatternContext, idx: number): NoteJudgment | null {
  const j = ctx.judgment[idx];
  return j && j.status === 'matched' ? j : null;
}

/** Timing error minus the attempt's median, ms; null when the note is not matched. */
export function relDelta(ctx: PatternContext, idx: number): number | null {
  const j = matched(ctx, idx);
  if (!j || j.timingErrorMs === null || ctx.medianDeltaMs === null) return null;
  return j.timingErrorMs - ctx.medianDeltaMs;
}

/** Played onset in score milliseconds; null when not matched. */
export function playedOnsetMs(ctx: PatternContext, idx: number): number | null {
  const j = matched(ctx, idx);
  const e = ctx.expected[idx];
  if (!j || !e || j.timingErrorMs === null) return null;
  return e.onsetSec * MS_PER_SEC + j.timingErrorMs;
}

/**
 * Median timing error of up to `count` matched notes before `idx`, ms. A local reference so that a steady drift (E1,
 * E2) does not read as a hesitation or an early entry.
 */
export function localDeltaBefore(ctx: PatternContext, idx: number, count: number): number | null {
  const xs: number[] = [];
  for (let k = idx - 1; k >= 0 && xs.length < count; k--) {
    const j = matched(ctx, k);
    if (j && j.timingErrorMs !== null && !ctx.flowNotes.has(k)) xs.push(j.timingErrorMs);
  }
  return median(xs);
}

/** Written MIDI of the target (concert + written-minus-sounding). */
export const targetWritten = (ctx: PatternContext, idx: number): number => (ctx.expected[idx]?.concertMidi ?? 0) + ctx.input.instrument.semis;

/** Written MIDI of the played semitone; null when not matched. */
export function playedWritten(ctx: PatternContext, idx: number): number | null {
  const j = matched(ctx, idx);
  if (!j || j.playedConcertMidi === null) return null;
  return Math.round(j.playedConcertMidi) + ctx.input.instrument.semis;
}

/** |cents| of the played note from its nearest semitone; null when not matched. */
export function playedCentsOff(ctx: PatternContext, idx: number): number | null {
  const j = matched(ctx, idx);
  if (!j || j.playedConcertMidi === null) return null;
  return Math.abs(j.playedConcertMidi - Math.round(j.playedConcertMidi)) * PERCENT;
}

export const isWrongPitch = (ctx: PatternContext, idx: number): boolean => matched(ctx, idx)?.pitch === 'wrong-pitch';

/** Per-note credit of one component, 0..1; null when the component does not grade the note (02 §4.3, §4.4). */
export function componentCredit(ctx: PatternContext, idx: number, c: ComponentId): number | null {
  const j = ctx.judgment[idx];
  if (!j) return null;
  if (c === 'P') return j.credit.p;
  if (c === 'I') return j.credit.n;
  const r = ctx.input.cfg.grading.components.rhythm;
  return j.credit.d === null ? j.credit.o : r.onsetWeight * j.credit.o + r.durationWeight * j.credit.d;
}

/** 02 §6.1 item 2: Σ over the notes of component weight × (1 − credit) × 100 / N, for the pattern's components. */
export function lostPoints(ctx: PatternContext, notes: readonly number[], components: readonly ComponentId[]): number {
  if (ctx.n === 0) return 0;
  let sum = 0;
  for (const idx of notes) {
    for (const c of components) {
      const credit = componentCredit(ctx, idx, c);
      if (credit !== null) sum += ctx.comps.weights[c] * (1 - credit);
    }
  }
  return (sum * PERCENT) / ctx.n;
}

export const barsOf = (ctx: PatternContext, notes: readonly number[]): number[] =>
  uniqSorted(notes.map((i) => ctx.expected[i]?.bar).filter((b): b is number => b !== undefined));

export const tRedMs = (ctx: PatternContext, idx: number): number => (ctx.tol[idx]?.tRedSec ?? 0) * MS_PER_SEC;
export const tGoodMs = (ctx: PatternContext, idx: number): number => (ctx.tol[idx]?.tGoodSec ?? 0) * MS_PER_SEC;

/** Reads a named threshold; a missing key is a config error, not a silent default. */
export function th(def: PatternDef, key: string): number {
  const v = def.thresholds[key];
  if (v === undefined) throw new Error(`patterns: ${def.id} has no threshold '${key}' in config/tips.json`);
  return v;
}

export function ev(def: PatternDef, key: string): number {
  const v = def.minEvidence[key];
  if (v === undefined) throw new Error(`patterns: ${def.id} has no minEvidence '${key}' in config/tips.json`);
  return v;
}

/** Input-clock seconds minus score seconds, from the matched notes (as in grade/diagnostics). */
function clockOffset(input: GradeInput): number | null {
  const byId = new Map(input.detected.map((d) => [d.id, d] as const));
  let sum = 0;
  let count = 0;
  for (const j of input.alignment.judgments) {
    const e = input.expected[j.expectedIdx];
    const d = j.detectedId === null ? undefined : byId.get(j.detectedId);
    if (j.status === 'matched' && e && d && j.timingErrorMs !== null) {
      sum += d.onset - (e.onsetSec + j.timingErrorMs / MS_PER_SEC);
      count++;
    }
  }
  return count === 0 ? null : sum / count;
}

/**
 * E6 evidence notes: the run of missed notes inside each stop (02 §4.6), and the missed current notes a replay or
 * skip-ahead covers ("the current notes they cover are missed", 02 §4.3).
 */
function flowNotesOf(input: GradeInput, judgment: readonly (NoteJudgment | undefined)[], diag: Diagnostics, beatMs: number): Set<number> {
  const out = new Set<number>();
  const { expected } = input;
  const isMissed = (i: number): boolean => judgment[i]?.status === 'missed';
  for (const s of diag.stops) {
    let i = expected.findIndex((e) => e.onsetBeat >= s.startBeat - EPS && isMissed(e.idx));
    while (i >= 0 && i < expected.length && isMissed(i)) out.add(i++);
  }
  const offset = clockOffset(input);
  if (offset !== null) {
    const byId = new Map(input.detected.map((d) => [d.id, d] as const));
    for (const seg of input.alignment.displaced) {
      const ds = seg.detectedIds.map((id) => byId.get(id)).filter((d) => d !== undefined);
      if (ds.length === 0) continue;
      const on = Math.min(...ds.map((d) => d.onset)) - offset;
      const off = Math.max(...ds.map((d) => d.offset ?? d.onset + d.steadyMs / MS_PER_SEC)) - offset;
      for (const e of expected) {
        const w = input.tolerances[e.idx]?.matchWindowSec ?? beatMs / MS_PER_SEC;
        if (isMissed(e.idx) && e.onsetSec >= on - w && e.onsetSec <= off + w) out.add(e.idx);
      }
    }
  }
  return out;
}

function keySigOf(expected: readonly ExpectedNote[]): Map<Step, number> {
  const m = new Map<Step, number>();
  for (const e of expected) if (e.keySigAltered && !e.explicitAccidental) m.set(e.writtenPitch.step, e.writtenPitch.alter);
  return m;
}

export function buildContext(input: GradeInput): PatternContext {
  const judgment: (NoteJudgment | undefined)[] = [];
  for (const j of input.alignment.judgments) judgment[j.expectedIdx] = j;
  const comps = computeComponents(input.alignment, input.instrument, input.level, input.cfg);
  const diag = computeDiagnostics(input);
  const beatMs = MS_PER_MIN / input.bpm;
  const deltas = input.alignment.judgments.filter((j) => j.status === 'matched' && j.timingErrorMs !== null).map((j) => j.timingErrorMs!);
  return {
    input,
    expected: input.expected,
    tol: input.tolerances,
    judgment,
    comps,
    diag,
    n: input.expected.length,
    beatMs,
    beatsPerBar: input.meter.countsPerBar,
    medianDeltaMs: median(deltas),
    flowNotes: flowNotesOf(input, judgment, diag, beatMs),
    keySig: keySigOf(input.expected),
  };
}
