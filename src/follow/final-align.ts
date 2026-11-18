/**
 * Final alignment (01 §9.6, §9.7; 02 §4.1, §4.3; PLAN R34, R35). Authoritative: results render only from it.
 *
 * 1. Monotonic DP over (expected i, detected j), detected notes in onset order. A match is allowed only inside the
 *    band |Δt| ≤ W_i and costs 01 §9.2's `4 (Δt / W)² + P` with the note's final (steady) pitch and no live K. Skipping
 *    an expected note (missed) costs 6, skipping a detected note (extra) 5, so any admissible match (≤ 9) beats
 *    missed plus extra (11). A detected note shorter than `extraMinDurMs` is not an extra (02 §4.1) and is skipped
 *    for free. Ties prefer match, then missed, then extra, deterministically.
 * 2. Relabel (`relabel.ts`, R34): runs of wrong-pitch matches and of extras that fit the score at a constant offset
 *    beyond the band become `DisplacedSegment`s. Their notes leave the DP and it runs again, so a replayed note
 *    never takes, and never overwrites, an expected note's judgment; the current notes it covered are missed.
 * 3. Judgments and credits from `rules/` (02 §4.3, §4.8): timing, intonation from the full steady median, octave
 *    policy (R7, R20), duration, voice reference replayed in score order with the same `VoiceDriftReference`.
 * 4. `rejudged` against the live outcome (01 §9.7): status, played note, timing, pitch mark or marginal differ.
 *
 * `finalAlign` (the frozen `FollowApi` member) takes the live outcome the session saw (`liveOutcomeOf` over the take's
 * follower events, PLAN ruling 44). `alignFinal` is the same with `null` allowed (no live view: nothing is rejudged).
 */
import type { FollowApi } from '../core/api.ts';
import type {
  DetectedNote,
  ExpectedNote,
  ExtraNote,
  FinalAlignment,
  FollowConfig,
  LiveNoteOutcome,
  LiveOutcome,
  NoteJudgment,
  ResolvedTolerance,
} from '../core/types.ts';
import { intonationCredit, intonationVerdict, noteVerdict, onsetCredit, VoiceDriftReference } from '../rules/index.ts';
import { classifyAgainst, matchCost, pitchCost, scoreSecondsOf, SKIP_DETECTED_COST, SKIP_EXPECTED_COST } from './cost.ts';
import { relabel, type AlignNote } from './relabel.ts';

const MS = 1000;
/** Relabel rounds: each removes at least one segment; a take rarely has more than two. */
const MAX_RELABEL_ROUNDS = 8;

const r6 = (x: number): number => Math.round(x * 1e6) / 1e6;

/** Back-pointer codes. */
const MATCH = 0;
const SKIP_E = 1;
const SKIP_D = 2;

/** Sounding duration, seconds; a note still sounding at take end counts its steady part only. */
export function soundedSec(d: DetectedNote, attackMs: number): number {
  if (d.offset !== null) return Math.max(0, d.offset - d.onset);
  return d.steadyMs > 0 ? (d.steadyMs + attackMs) / MS : 0;
}

/** DP pitch offset: the tuning offset; voice is octave-equivalent and its reference is replayed afterwards. */
function dpOffsetCents(c: FollowConfig): number {
  return c.instrument.relativePitch ? 0 : c.voiceReferenceCents;
}

/** Match cost of detected note `d` (score seconds `s`) against expected `i`, or null outside the band. */
export function finalMatchCost(c: FollowConfig, i: number, d: AlignNote): number | null {
  const e = c.expected[i] as ExpectedNote;
  const tol = c.tolerances[i] as ResolvedTolerance;
  const dt = d.s - e.onsetSec;
  if (Math.abs(dt) > tol.matchWindowSec) return null;
  const { c: pc } = classifyAgainst(e, d.note, dpOffsetCents(c), c.instrument, c.cfg);
  return matchCost(dt, tol, pitchCost(pc));
}

/**
 * The 01 §9.6 DP. Returns, per detected note (in `notes` order), the matched expected index or null, and the
 * match cost. Memory and time are O(N·M) cells; matches are only evaluated inside each note's band.
 */
export function alignDp(c: FollowConfig, notes: readonly AlignNote[]): { idx: (number | null)[]; cost: number[] } {
  const nE = c.expected.length;
  const nD = notes.length;
  const W = nD + 1;
  const D = new Float64Array((nE + 1) * W).fill(Infinity);
  const B = new Uint8Array((nE + 1) * W);
  const skipD = notes.map((n) => (n.extraEligible ? SKIP_DETECTED_COST : 0));
  // Band: for expected i, the detected notes whose onsets lie within W_i (notes are in onset order).
  const lo = new Int32Array(nE);
  const hi = new Int32Array(nE);
  for (let i = 0; i < nE; i++) {
    const e = c.expected[i] as ExpectedNote;
    const w = (c.tolerances[i] as ResolvedTolerance).matchWindowSec;
    lo[i] = firstAtOrAfter(notes, e.onsetSec - w);
    hi[i] = firstAfter(notes, e.onsetSec + w);
  }
  // Match costs inside the band, computed once (NaN: not admissible).
  const band: Float64Array[] = [];
  for (let i = 0; i < nE; i++) {
    const a = lo[i] as number;
    const row = new Float64Array(Math.max(0, (hi[i] as number) - a));
    for (let j = 0; j < row.length; j++) row[j] = finalMatchCost(c, i, notes[a + j] as AlignNote) ?? NaN;
    band.push(row);
  }
  const mc = (i: number, j: number): number | null => {
    const a = lo[i] as number;
    if (j < a || j >= (hi[i] as number)) return null;
    const v = (band[i] as Float64Array)[j - a] as number;
    return Number.isNaN(v) ? null : v;
  };
  D[0] = 0;
  for (let i = 0; i <= nE; i++) {
    for (let j = 0; j <= nD; j++) {
      if (i === 0 && j === 0) continue;
      let best = Infinity;
      let how = MATCH;
      if (i > 0 && j > 0) {
        const m = mc(i - 1, j - 1);
        if (m !== null) {
          const v = (D[(i - 1) * W + j - 1] as number) + m;
          if (v < best) {
            best = v;
            how = MATCH;
          }
        }
      }
      if (i > 0) {
        const v = (D[(i - 1) * W + j] as number) + SKIP_EXPECTED_COST;
        if (v < best) {
          best = v;
          how = SKIP_E;
        }
      }
      if (j > 0) {
        const v = (D[i * W + j - 1] as number) + (skipD[j - 1] as number);
        if (v < best) {
          best = v;
          how = SKIP_D;
        }
      }
      D[i * W + j] = best;
      B[i * W + j] = how;
    }
  }
  const idx: (number | null)[] = new Array<number | null>(nD).fill(null);
  const cost: number[] = skipD.slice();
  for (let i = nE, j = nD; i > 0 || j > 0; ) {
    const how = B[i * W + j] as number;
    if (how === MATCH && i > 0 && j > 0) {
      idx[j - 1] = i - 1;
      cost[j - 1] = mc(i - 1, j - 1) as number;
      i--;
      j--;
    } else if (how === SKIP_E && i > 0) i--;
    else j--;
  }
  return { idx, cost };
}

/** First note with s ≥ t. */
function firstAtOrAfter(notes: readonly AlignNote[], t: number): number {
  let a = 0;
  let b = notes.length;
  while (a < b) {
    const m = (a + b) >> 1;
    if ((notes[m] as AlignNote).s < t) a = m + 1;
    else b = m;
  }
  return a;
}

/** First note with s > t. */
function firstAfter(notes: readonly AlignNote[], t: number): number {
  let a = 0;
  let b = notes.length;
  while (a < b) {
    const m = (a + b) >> 1;
    if ((notes[m] as AlignNote).s <= t) a = m + 1;
    else b = m;
  }
  return a;
}

function durationCredit(c: FollowConfig, e: ExpectedNote, heldRatio: number | null): { duration: NoteJudgment['duration']; d: number | null } {
  if (!e.durationGraded || c.instrument.pitchKind === 'fixed') return { duration: 'not-graded', d: null };
  if (heldRatio === null) return { duration: 'short', d: 0 };
  const k = c.cfg.grading.credit.duration;
  const full = e.followedByRest ? k.beforeRestFullRatio : k.fullHeldRatio;
  let d: number;
  if (heldRatio >= full) d = 1;
  else if (heldRatio <= k.zeroHeldRatio) d = 0;
  else d = (heldRatio - k.zeroHeldRatio) / (full - k.zeroHeldRatio);
  return { duration: d === 1 ? 'ok' : 'short', d };
}

function missedJudgment(c: FollowConfig, e: ExpectedNote): NoteJudgment {
  const { duration, d } = durationCredit(c, e, null);
  return {
    expectedIdx: e.idx,
    status: 'missed',
    detectedId: null,
    timing: null,
    timingErrorMs: null,
    pitch: null,
    playedConcertMidi: null,
    centsError: null,
    octaveDisplaced: false,
    duration,
    heldRatio: null,
    credit: { p: 0, n: null, o: 0, d },
    marginal: false,
    rejudged: false,
  };
}

function matchedJudgment(c: FollowConfig, e: ExpectedNote, n: AlignNote, offsetCents: number, attackMs: number): { j: NoteJudgment; rawDevCents: number; p: 0 | 1 } {
  const tol = c.tolerances[e.idx] as ResolvedTolerance;
  const d = n.note;
  const deltaMs = (n.s - e.onsetSec) * MS;
  const { midi, c: pc } = classifyAgainst(e, d, offsetCents, c.instrument, c.cfg);
  const intonation = pc.kind === 'correct' ? intonationVerdict(pc.devCents, d.steadyMs, tol) : 'not-graded';
  const v = noteVerdict({ deltaMs, pitch: pc, intonation }, tol);
  const sounded = soundedSec(d, attackMs);
  const heldRatio = e.durSec > 0 ? sounded / e.durSec : null;
  const dur = durationCredit(c, e, heldRatio);
  const nCredit = pc.p === 1 ? intonationCredit(pc.devCents, d.steadyMs, tol) : null;
  const j: NoteJudgment = {
    expectedIdx: e.idx,
    status: 'matched',
    detectedId: d.id,
    timing: v.timing,
    timingErrorMs: r6(deltaMs),
    pitch: v.pitch,
    playedConcertMidi: r6(midi),
    centsError: r6(pc.devCents),
    octaveDisplaced: pc.octaveDisplaced,
    duration: dur.duration,
    heldRatio: heldRatio === null ? null : r6(heldRatio),
    credit: { p: pc.p, n: nCredit === null ? null : r6(nCredit), o: r6(onsetCredit(deltaMs, tol)), d: dur.d === null ? null : r6(dur.d) },
    marginal: v.marginal,
    rejudged: false,
  };
  return { j, rawDevCents: pc.rawDevCents, p: pc.p };
}

/** A pitch mark the overlay draws (02 §4.8); in-tune, not-graded and not-yet-known draw none. */
const pitchMark = (p: NoteJudgment['pitch']): string => (p === 'wrong-pitch' || p === 'octave' || p === 'sharp' || p === 'flat' ? p : 'none');

/** 01 §9.7: the final state or ghost differs from what live showed. */
export function differsFromLive(j: NoteJudgment, l: LiveNoteOutcome | undefined): boolean {
  if (!l || l.status === 'missed') return j.status === 'matched';
  if (j.status === 'missed') return true;
  return l.detectedId !== j.detectedId || l.timing !== j.timing || pitchMark(l.pitch) !== pitchMark(j.pitch) || l.marginal !== j.marginal;
}

/** Intervals of written rest (between a note's written end and the next onset), score seconds. */
function restIntervals(expected: readonly ExpectedNote[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 1; i < expected.length; i++) {
    const b = expected[i] as ExpectedNote;
    const a = expected[i - 1] as ExpectedNote;
    if (b.precededByRest) out.push([a.onsetSec + a.durSec, b.onsetSec]);
  }
  return out;
}

/** Detected notes as the DP sees them, in onset order. */
export function alignNotes(c: FollowConfig, detected: readonly DetectedNote[]): AlignNote[] {
  const attackMs = c.cfg.grading.intonation.attackExcludeMsByFamily[c.instrument.family];
  const minSec = c.cfg.grading.credit.extraMinDurMs / MS;
  return detected
    .map((note) => ({ note, s: scoreSecondsOf(note.onset, c.t0, c.latencyCompensationSec), extraEligible: soundedSec(note, attackMs) >= minSec }))
    .sort((a, b) => a.s - b.s || a.note.id - b.note.id);
}

/** Voice drift reference values of a take (02 §4.5, E23; `WorkerReply` 'done'.voiceReference). */
export interface VoiceReferenceValues {
  finalOffsetCents: number;
  offsetAtThirdCents: number;
}

/**
 * Score time of "one third of the excerpt" for E23 (02 §6.2): a third of the way from the first written onset to the
 * last written end, in score seconds. The reference offset read there is the one in force for the first expected note
 * at or after that time (the drift replay updates it per note in score order).
 */
export function oneThirdSec(expected: readonly ExpectedNote[]): number {
  if (expected.length === 0) return 0;
  const first = (expected[0] as ExpectedNote).onsetSec as number;
  const end = Math.max(...expected.map((e) => (e.onsetSec as number) + e.durSec));
  return first + (end - first) / 3;
}

/** Final alignment with a given live outcome (null: no live view, nothing is rejudged against it). */
export function alignFinal(c: FollowConfig, detected: readonly DetectedNote[], live: LiveOutcome | null): FinalAlignment {
  return alignFinalWithReference(c, detected, live).alignment;
}

/**
 * `alignFinal` plus the voice drift reference values of its replay (R55): the final offset after the last note and the
 * offset in force at one third of the excerpt (`oneThirdSec`). Null for instruments without relative pitch.
 */
export function alignFinalWithReference(
  c: FollowConfig,
  detected: readonly DetectedNote[],
  live: LiveOutcome | null,
): { alignment: FinalAlignment; voiceReference: VoiceReferenceValues | null } {
  const all = alignNotes(c, detected);
  const attackMs = c.cfg.grading.intonation.attackExcludeMsByFamily[c.instrument.family];
  const displaced: FinalAlignment['displaced'] = [];
  const gone = new Set<number>();
  let notes = all;
  let dp = alignDp(c, notes);
  for (let round = 0; round < MAX_RELABEL_ROUNDS; round++) {
    const segs = relabel(c, notes, dp.idx, dp.cost, dpOffsetCents(c));
    if (segs.length === 0) break;
    for (const s of segs) {
      displaced.push(s);
      for (const id of s.detectedIds) gone.add(id);
    }
    notes = all.filter((n) => !gone.has(n.note.id));
    dp = alignDp(c, notes);
  }

  const byExpected = new Map<number, AlignNote>();
  const unmatched: AlignNote[] = [];
  notes.forEach((n, k) => {
    const i = dp.idx[k];
    if (i === null || i === undefined) unmatched.push(n);
    else byExpected.set(i, n);
  });

  const drift = new VoiceDriftReference(c.cfg);
  const third = oneThirdSec(c.expected);
  let atThird: number | null = null;
  const judgments = c.expected.map((e) => {
    if (atThird === null && (e.onsetSec as number) >= third - 1e-9) atThird = drift.offsetCents();
    const n = byExpected.get(e.idx);
    if (!n) return missedJudgment(c, e);
    const offset = c.instrument.relativePitch ? drift.offsetCents() : c.voiceReferenceCents;
    const m = matchedJudgment(c, e, n, offset, attackMs);
    if (c.instrument.relativePitch) drift.observe(m.rawDevCents, m.p === 1);
    return m.j;
  });
  if (live) for (const j of judgments) j.rejudged = differsFromLive(j, live.get(j.expectedIdx));

  const rests = restIntervals(c.expected);
  const need = c.cfg.grading.credit.restIntrusionMs / MS;
  const extras: ExtraNote[] = unmatched
    .filter((n) => n.extraEligible)
    .sort((a, b) => a.note.id - b.note.id)
    .map((n) => {
      const dur = soundedSec(n.note, attackMs);
      const midi = n.note.midi;
      return {
        detectedId: n.note.id,
        onsetSec: r6(n.s),
        concertMidi: r6(midi),
        cents: r6((midi - Math.round(midi)) * 100),
        durSec: r6(dur),
        duringRest: rests.some(([a, b]) => Math.min(b, n.s + dur) - Math.max(a, n.s) > need),
      };
    });

  displaced.sort((a, b) => (a.detectedIds[0] as number) - (b.detectedIds[0] as number));
  const voiceReference = c.instrument.relativePitch
    ? { finalOffsetCents: r6(drift.offsetCents()), offsetAtThirdCents: r6(atThird ?? drift.offsetCents()) }
    : null;
  return { alignment: { judgments, extras, displaced }, voiceReference };
}

/** `FollowApi.finalAlign` (01 §5.7, §9.6, PLAN ruling 44): `rejudged` against the live outcome the session streamed. */
export const finalAlign: FollowApi['finalAlign'] = (c, detected, live) => alignFinal(c, detected, live);
