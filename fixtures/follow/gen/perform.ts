/**
 * Scripted performances and their DSP event streams (01 §5.6, §9.3, §14 item 9).
 *
 * A scenario starts from the expected notes and applies perturbations (timing, cents, wrong semitones, octaves,
 * omissions, merges, splits, extras, blips, displaced replays, drift). The result is a list of played notes with
 * ground truth (which expected note each one is, or extra, or displaced), and a `FollowStreamItem[]` the follower
 * consumes exactly as it would consume the DSP worker's output:
 *
 * - Times are input-timeline `ClockSeconds`: T(s) = t0 + latencyCompensationSec + s, for score seconds s.
 * - `note-on` arrives `confirmSec` after the onset: the 01 §10 p95 pitch confirmation per window class
 *   (512 → 40 ms, 1024 → 56 ms, 2048 → 88 ms). `DetectedNote.onset` is always the true onset (backtracked, 01 §10).
 * - `note-update` every 8 hops (64 ms) while sounding. 01 §5.6 says every 4 hops; the fixtures halve the cadence to
 *   keep files small, and the follower must not depend on the cadence.
 * - `note-off` 3 hops (24 ms) after the offset.
 * - `signal` every 16 hops (128 ms); `clock` every 4 hops (32 ms), one hop = 128 samples at 16 kHz = 8 ms.
 * - `steadyMs` grows as (t − onset) − attackExcludeMs (the family value in grading-config), capped at the note end;
 *   `midi` is the provisional median at note-on and the steady median once steadyMs > 0.
 */
import type {
  ClockSeconds,
  Configs,
  DetectedNote,
  DspEvent,
  EndReason,
  ExpectedNote,
  FollowStreamItem,
  Instrument,
} from '../../../src/core/types.ts';

export type Truth = { kind: 'match'; idx: number } | { kind: 'extra'; duringRest: boolean } | { kind: 'displaced'; seg: number; idx: number; offsetBeats: number };

export interface Played {
  /** Onset, score seconds. */
  onset: number;
  dur: number;
  /** Fractional concert MIDI of the steady median (what `DetectedNote.midi` settles on). */
  midi: number;
  provisionalMidi: number;
  clarity: number;
  altOctaveClarity: number | null;
  /** Re-attacked without silence (slurred / legato): onsetCause 'pitch-change' or 'repeat'. */
  legato: boolean;
  truth: Truth;
}

export interface NoteMod {
  shiftMs?: number;
  cents?: number;
  /** Played semitones away from the target (wrong note). */
  semis?: number;
  /** Provisional (confirming frames) semitone offset, default = semis. */
  provisionalSemis?: number;
  /** Played whole octaves away. */
  octaves?: number;
  altOctaveClarity?: number;
  omit?: boolean;
  /** Sounding time as a fraction of the written duration (overrides the default). */
  heldFrac?: number;
  /** Sounding time in ms (overrides heldFrac). */
  durMs?: number;
}

export interface ExtraSpec {
  /** Onset in beats from bar 1 beat 1. */
  atBeat: number;
  durBeats: number;
  midi: number;
  duringRest: boolean;
}

export interface BlipSpec {
  /** Onset, ms relative to the expected onset of `idx`. */
  idx: number;
  atMs: number;
  durMs: number;
  semis: number;
}

export interface ReplaySpec {
  from: number;
  to: number;
  /** Player's offset from the metronome, beats; negative = went back (01 §9.5, DisplacedSegment). */
  offsetBeats: number;
}

export interface PerformSpec {
  /** Timing jitter pattern (ms), applied cyclically by expected index. */
  jitterMs?: number[];
  /** Cents pattern, applied cyclically. */
  centsPattern?: number[];
  /** Default sounding fraction of the written duration for articulated notes. */
  heldFrac?: number;
  mods?: Record<number, NoteMod>;
  /** Linear drift, beats per bar (02 §4.9 case 4). */
  driftBeatsPerBar?: number;
  globalShiftMs?: number;
  globalCents?: number;
  globalOctaves?: number;
  extras?: ExtraSpec[];
  blips?: BlipSpec[];
  replays?: ReplaySpec[];
  /** idx and idx+1 (a repeated pitch) sounded as one note (01 §14 item 9 "repeated merge"). */
  merges?: number[];
  /** Re-articulate idx at this fraction of its written duration (one written note heard as two). */
  splits?: { idx: number; atFrac: number }[];
}

export const DEFAULT_JITTER = [0, 4, -3, 2, -4, 1, -2, 3];
export const DEFAULT_CENTS = [1, -2, 2, -1, 0, -3, 3, -1];
const GAP = 0.02;

export function perform(expected: ExpectedNote[], beatsPerBar: number, bpm: number, spec: PerformSpec): Played[] {
  const beatSec = 60 / bpm;
  const jit = spec.jitterMs ?? DEFAULT_JITTER;
  const cp = spec.centsPattern ?? DEFAULT_CENTS;
  const held = spec.heldFrac ?? 0.92;
  const out: Played[] = [];
  const merged = new Set((spec.merges ?? []).map((i) => i + 1));
  for (const e of expected) {
    const m = spec.mods?.[e.idx] ?? {};
    if (m.omit || merged.has(e.idx)) continue;
    const drift = (spec.driftBeatsPerBar ?? 0) * (e.onsetBeat / beatsPerBar) * beatSec;
    const onset = e.onsetSec + ((m.shiftMs ?? 0) + (spec.globalShiftMs ?? 0) + (m.shiftMs !== undefined ? 0 : (jit[e.idx % jit.length] ?? 0))) / 1000 + drift;
    let dur = m.durMs !== undefined ? m.durMs / 1000 : e.durSec * (m.heldFrac ?? (e.onsetKind === 'slurred' ? 1 : held));
    if ((spec.merges ?? []).includes(e.idx)) {
      const nxt = expected[e.idx + 1]!;
      dur = nxt.onsetSec + nxt.durSec * held - e.onsetSec;
    }
    const semis = (m.semis ?? 0) + 12 * ((m.octaves ?? 0) + (spec.globalOctaves ?? 0));
    const cents = (m.cents ?? cp[e.idx % cp.length] ?? 0) + (spec.globalCents ?? 0);
    const midi = e.concertMidi + semis + cents / 100;
    const provSemis = m.provisionalSemis ?? semis;
    out.push({
      onset,
      dur,
      midi,
      provisionalMidi: e.concertMidi + provSemis + cents / 100,
      clarity: 0.95,
      altOctaveClarity: m.altOctaveClarity ?? null,
      legato: e.onsetKind === 'slurred',
      truth: { kind: 'match', idx: e.idx },
    });
  }
  for (const s of spec.splits ?? []) {
    const p = out.find((x) => x.truth.kind === 'match' && x.truth.idx === s.idx)!;
    const e = expected[s.idx]!;
    const cut = e.durSec * s.atFrac;
    const second = { ...p, onset: p.onset + cut, dur: p.dur - cut, legato: false, truth: { kind: 'extra', duringRest: false } as Truth };
    p.dur = cut - GAP;
    out.push(second);
  }
  for (const x of spec.extras ?? []) {
    out.push({ onset: x.atBeat * beatSec, dur: x.durBeats * beatSec, midi: x.midi + 0.02, provisionalMidi: x.midi + 0.02, clarity: 0.93, altOctaveClarity: null, legato: false, truth: { kind: 'extra', duringRest: x.duringRest } });
  }
  for (const b of spec.blips ?? []) {
    const e = expected[b.idx]!;
    out.push({ onset: e.onsetSec + b.atMs / 1000, dur: b.durMs / 1000, midi: e.concertMidi + b.semis, provisionalMidi: e.concertMidi + b.semis, clarity: 0.9, altOctaveClarity: null, legato: false, truth: { kind: 'extra', duringRest: false } });
  }
  (spec.replays ?? []).forEach((r, seg) => {
    for (let i = r.from; i <= r.to; i++) {
      const e = expected[i]!;
      const cents = cp[i % cp.length] ?? 0;
      out.push({
        onset: e.onsetSec - r.offsetBeats * beatSec + (jit[(i + 3) % jit.length] ?? 0) / 1000,
        dur: e.durSec * (e.onsetKind === 'slurred' ? 1 : held),
        midi: e.concertMidi + cents / 100,
        provisionalMidi: e.concertMidi + cents / 100,
        clarity: 0.95,
        altOctaveClarity: null,
        legato: e.onsetKind === 'slurred',
        truth: { kind: 'displaced', seg, idx: i, offsetBeats: r.offsetBeats },
      });
    }
  });
  out.sort((a, b) => a.onset - b.onset);
  // No overlaps: a legato note touches its successor, an articulated one leaves a 20 ms gap.
  for (let k = 0; k + 1 < out.length; k++) {
    const a = out[k]!;
    const b = out[k + 1]!;
    const limit = b.onset - a.onset - (b.legato ? 0 : GAP);
    if (a.dur > limit) a.dur = limit;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// Stream
// ------------------------------------------------------------------------------------------------

export const HOP_SEC = 128 / 16000;
export const confirmSec = (inst: Instrument): number => ({ 512: 0.04, 1024: 0.056, 2048: 0.088 })[inst.detection.windowSamples];
/** 01 §9.3 confirmDelay = W/2 + 3 hops at the 16 kHz analysis rate. */
export const confirmDelaySec = (inst: Instrument): number => inst.detection.windowSamples / 2 / 16000 + 3 * HOP_SEC;
const UPDATE_SEC = 8 * HOP_SEC;
const OFF_LAG_SEC = 3 * HOP_SEC;
const CLOCK_SEC = 4 * HOP_SEC;
const SIGNAL_SEC = 16 * HOP_SEC;

export const r6 = (x: number): number => Math.round(x * 1e6) / 1e6;
export const asClock = (x: number): ClockSeconds => r6(x) as ClockSeconds;

export interface StreamOpts {
  t0: number;
  rtl: number;
  inst: Instrument;
  cfg: Configs;
  /** Score seconds of the end-of-take item (02 §4.6, R14). */
  endSec: number;
  endReason?: EndReason;
}

/** Detected-note state at clock time t (input timeline). */
export function detectedAt(p: Played, id: number, t: number, o: StreamOpts, final: boolean): DetectedNote {
  const T = (s: number): number => o.t0 + o.rtl + s;
  const attack = o.cfg.grading.intonation.attackExcludeMsByFamily[o.inst.family];
  const maxSteady = Math.max(0, p.dur * 1000 - attack);
  const steadyMs = final ? maxSteady : Math.max(0, Math.min(maxSteady, (t - T(p.onset)) * 1000 - attack));
  const midi = steadyMs > 0 ? p.midi : p.provisionalMidi;
  const vib = o.inst.detection.vibratoClass === 'vibrato';
  return {
    id,
    onset: asClock(T(p.onset)),
    offset: final ? asClock(T(p.onset + p.dur)) : null,
    provisionalMidi: r6(p.provisionalMidi),
    midi: r6(midi),
    stableMedianCents: r6((midi - Math.round(midi)) * 100),
    steadyMs: r6(steadyMs),
    pitchSdCents: vib ? 12 : 3,
    clarity: p.clarity,
    altOctaveClarity: p.altOctaveClarity,
    onsetCause: 'from-silence',
    // Synthetic confirming frames sit on the played semitone (01 §9.3 item 3).
    framesAgree: true,
  };
}

function onsetCause(prev: Played | undefined, p: Played): DetectedNote['onsetCause'] {
  if (!prev || p.onset - (prev.onset + prev.dur) > 0.015) return 'from-silence';
  if (Math.round(prev.midi) === Math.round(p.midi)) return 'repeat';
  return 'pitch-change';
}

export function buildStream(played: Played[], o: StreamOpts): FollowStreamItem[] {
  const T = (s: number): number => o.t0 + o.rtl + s;
  type Item = { t: number; pri: number; seq: number; item: FollowStreamItem };
  const items: Item[] = [];
  let seq = 0;
  const push = (t: number, pri: number, item: FollowStreamItem): void => {
    items.push({ t: r6(t), pri, seq: seq++, item });
  };
  played.forEach((p, k) => {
    const id = k + 1;
    const cause = onsetCause(played[k - 1], p);
    const on = T(p.onset) + confirmSec(o.inst);
    const end = T(p.onset + p.dur);
    const withCause = (d: DetectedNote): DetectedNote => ({ ...d, onsetCause: cause });
    push(on, 0, { kind: 'dsp', t: asClock(on), event: { type: 'note-on', note: withCause(detectedAt(p, id, on, o, false)) } });
    for (let t = on + UPDATE_SEC; t < end; t += UPDATE_SEC) {
      push(t, 0, { kind: 'dsp', t: asClock(t), event: { type: 'note-update', note: withCause(detectedAt(p, id, t, o, false)) } });
    }
    const off = Math.max(end + OFF_LAG_SEC, on + HOP_SEC);
    push(off, 0, { kind: 'dsp', t: asClock(off), event: { type: 'note-off', note: withCause(detectedAt(p, id, off, o, true)) } });
  });
  const first = Math.min(played[0]?.onset ?? 0, 0) - 0.5;
  const startT = T(first);
  const endT = T(o.endSec);
  const sounding = (t: number): boolean => played.some((p) => t >= T(p.onset) && t <= T(p.onset + p.dur));
  for (let k = 0; startT + k * SIGNAL_SEC < endT; k++) {
    const t = startT + k * SIGNAL_SEC;
    const v = sounding(t);
    const ev: DspEvent = { type: 'signal', levelDb: v ? -18 : -62, clipping: false, voiced: v };
    push(t, 1, { kind: 'dsp', t: asClock(t), event: ev });
  }
  for (let k = 0; startT + k * CLOCK_SEC < endT; k++) {
    const t = startT + k * CLOCK_SEC;
    push(t, 2, { kind: 'clock', t: asClock(t) });
  }
  push(endT, 3, { kind: 'end', t: asClock(endT), end: o.endReason ?? { reason: 'complete' } });
  items.sort((a, b) => a.t - b.t || a.pri - b.pri || a.seq - b.seq);
  return items.map((x) => x.item);
}

/** End of take (R14, `endOfTake`): one beat after the last expected note's written end, score seconds. */
export function endOfTakeSec(expected: ExpectedNote[], bpm: number, cfg: Configs): number {
  const last = expected[expected.length - 1]!;
  return last.onsetSec + last.durSec + (cfg.grading.endOfTake.afterLastNoteEndBeats * 60) / bpm;
}
