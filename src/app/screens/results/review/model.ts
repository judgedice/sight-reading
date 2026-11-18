/**
 * Review model (04 sections 6.1, 6.5, 6.6, 8.3): final note states, review ghosts, heat strip, replay brackets, the slip
 * list and the note inspector text, all from the AttemptRecord's final alignment. Pure; no DOM, no React.
 */
import { TPQ } from '../../../../core/types.ts';
import type {
  AttemptRecord,
  ExpectedNote,
  GhostNote,
  Instrument,
  KeySig,
  LiveJudgment,
  NoteJudgment,
  NoteVisualState,
  PatternResult,
  PreparedExcerpt,
  ResolvedTolerance,
  SpelledPitch,
  Step,
} from '../../../../core/types.ts';
import { heatLevel, type HeatLevel } from '../../../../ui/components/domain/HeatStrip.tsx';
import { rtext, sentence, type ReviewTextKey } from './text.ts';

/** Written spelling of a played concert pitch (02 §4.8). The composition root passes follow's `ghostPitch`. */
export type GhostSpeller = (playedConcertMidi: number, target: ExpectedNote | null, key: KeySig, inst: Instrument) => SpelledPitch;

/** A slip-stepper restriction (04 §6.5): a count in the counts line, the re-judged button, or every slip. */
export type SlipFilter = 'all' | 'rejudged' | 'correct' | 'timing' | 'pitch' | 'wrong' | 'missed' | 'extra';

export type SlipTarget = { kind: 'note'; idx: number; beat: number } | { kind: 'extra'; detectedId: number; beat: number };

export interface ReviewNote {
  idx: number;
  bar: number;
  beatInBar: number;
  /** Written onset, score beats. */
  beat: number;
  state: NoteVisualState;
  /** 04 §6.1 "error": missed, early, late, sharp, flat, wrong pitch or octave. */
  error: boolean;
  /** Filters this note belongs to (a late wrong note is in both 'timing' and 'wrong'). */
  kinds: SlipFilter[];
  rejudged: boolean;
  ghost: GhostNote | null;
  /** Inspector lines, top first. */
  inspector: string[];
  ariaLabel: string;
}

export interface ReviewExtra {
  detectedId: number;
  /** Played onset, score beats. */
  beat: number;
  bar: number;
  beatInBar: number;
  /** Part of a replayed (displaced) run. */
  displaced: boolean;
  ghost: GhostNote;
  inspector: string[];
  ariaLabel: string;
}

/** A ghost's duration tail (04 §6.2, review only). */
export interface GhostTail {
  detectedId: number;
  beat: number;
  durBeats: number;
  pitch: SpelledPitch;
  replay: boolean;
}

export interface HeatCell {
  bar: number;
  /** Measure start and end, score beats. */
  startBeat: number;
  endBeat: number;
  total: number;
  off: number;
  share: number;
  level: HeatLevel;
  /** "Bar 6: 2 of 5 notes off (1 late, 1 flat)"; null when nothing is off. */
  label: string | null;
}

export interface ReplayBracket {
  /** Bars of the written material that was replayed. */
  fromBar: number;
  toBar: number;
  /** Where the replay was played, score beats (first and last ghost onsets; end includes the last note's length). */
  startBeat: number;
  endBeat: number;
  label: string;
  detectedIds: number[];
}

export interface ReviewModel {
  notes: ReviewNote[];
  extras: ReviewExtra[];
  ghosts: GhostNote[];
  tails: GhostTail[];
  heat: HeatCell[];
  brackets: ReplayBracket[];
}

export interface ReviewInput {
  record: AttemptRecord;
  prepared: PreparedExcerpt;
  expected: readonly ExpectedNote[];
  instrument: Instrument;
  spell: GhostSpeller;
  /** Per expected note (from session's planTake); lets the inspector tell partial credit and marginal timing apart. */
  tolerances?: readonly ResolvedTolerance[] | null;
  /** Pattern display names by id (config/tips.json). */
  patternName?: (id: string) => string | undefined;
  /** Settings: "Show cents and milliseconds in review" (04 §5.11). Default on. */
  showNumbers?: boolean;
}

// ---- pitch text ---------------------------------------------------------------------------------

const SHARP_ORDER: Step[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER: Step[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

/** Key-signature alteration of each step. */
export function keyAlter(key: KeySig, step: Step): number {
  const n = Math.min(7, Math.abs(key.fifths));
  if (key.fifths > 0) return SHARP_ORDER.slice(0, n).includes(step) ? 1 : 0;
  if (key.fifths < 0) return FLAT_ORDER.slice(0, n).includes(step) ? -1 : 0;
  return 0;
}

const SYMBOL: Record<number, string> = { [-2]: '𝄫', [-1]: '♭', [0]: '♮', [1]: '♯', [2]: '𝄪' };

/** A natural is named when the key or the compared note alters the same step (target F♯, played F: "F♮5"). */
function showsNatural(p: SpelledPitch, key: KeySig, other: SpelledPitch | null): boolean {
  if (p.alter !== 0) return false;
  return keyAlter(key, p.step) !== 0 || (other !== null && other.step === p.step && other.alter !== 0);
}

/** "F♯5", "F♮5", "B♭3", "C4". */
export function pitchText(p: SpelledPitch, key: KeySig, other: SpelledPitch | null = null): string {
  const acc = p.alter !== 0 || showsNatural(p, key, other) ? (SYMBOL[p.alter] ?? '') : '';
  return `${p.step}${acc}${p.octave}`;
}

const ACC_WORD: Record<number, ReviewTextKey> = {
  [-2]: 'review.accidental.doubleFlat',
  [-1]: 'accidental.flat',
  [0]: 'accidental.natural',
  [1]: 'accidental.sharp',
  [2]: 'review.accidental.doubleSharp',
};

/** speakPitch (04 §8.3): "F sharp 5"; a natural is spoken only where `pitchText` shows ♮. */
export function speakPitch(p: SpelledPitch, key: KeySig, other: SpelledPitch | null = null): string {
  const accidental = p.alter !== 0 || showsNatural(p, key, other) ? rtext(ACC_WORD[p.alter] ?? 'accidental.natural') : '';
  return rtext('a11y.speakPitch', { letter: p.step, accidental, octave: p.octave }).replace(/\s+/g, ' ').trim();
}

// ---- note values ---------------------------------------------------------------------------------

const VALUE_BY_TICKS: [number, ReviewTextKey][] = [
  [TPQ * 4, 'review.value.whole'],
  [TPQ * 3, 'review.value.dottedHalf'],
  [TPQ * 2, 'review.value.half'],
  [(TPQ * 3) / 2, 'review.value.dottedQuarter'],
  [TPQ, 'review.value.quarter'],
  [(TPQ * 2) / 3, 'review.value.tripletQuarter'],
  [(TPQ * 3) / 4, 'review.value.dottedEighth'],
  [TPQ / 2, 'review.value.eighth'],
  [TPQ / 3, 'review.value.tripletEighth'],
  [(TPQ * 3) / 8, 'review.value.dottedSixteenth'],
  [TPQ / 4, 'review.value.sixteenth'],
  [TPQ / 6, 'review.value.tripletSixteenth'],
  [TPQ / 8, 'review.value.thirtySecond'],
];

/** Written value of a note (tie chains that are no single value read "tied"). */
export function writtenValue(e: ExpectedNote, p: PreparedExcerpt): string {
  const ticks = Math.round(e.durBeats * p.meter.countUnitTicks);
  const hit = VALUE_BY_TICKS.find(([t]) => Math.abs(t - ticks) <= 1);
  return rtext(hit ? hit[1] : 'review.value.tied');
}

/**
 * "about a sixteenth" (04 §6.5): the nearest of a 32nd, sixteenth, triplet eighth, eighth and quarter at the take tempo
 * (nearest by ratio). Errors under three quarters of a 32nd read "less than a sixteenth".
 */
export function timingValuePhrase(ms: number, bpm: number, p: PreparedExcerpt): string {
  const quarterMs = ((60000 / bpm) * TPQ) / p.meter.countUnitTicks;
  const options: [number, ReviewTextKey][] = [
    [quarterMs / 8, 'value.32nd'],
    [quarterMs / 4, 'value.sixteenth'],
    [quarterMs / 3, 'value.tripletEighth'],
    [quarterMs / 2, 'value.eighth'],
    [quarterMs, 'value.quarter'],
  ];
  const a = Math.abs(ms);
  if (a < options[0]![0] * 0.75) return rtext('value.lessThanSixteenth');
  let best = options[0]!;
  for (const o of options) if (Math.abs(Math.log(a / o[0])) < Math.abs(Math.log(a / best[0]))) best = o;
  return rtext(best[1]);
}

// ---- bars and beats ------------------------------------------------------------------------------

interface BarTable {
  bars: number[];
  start: number[];
  end: number[];
}

function barTable(p: PreparedExcerpt): BarTable {
  const bars: number[] = [];
  const start: number[] = [];
  for (const m of p.measures) {
    bars.push(m.displayBar);
    start.push((m.startTick - p.pickupTicks) / p.meter.countUnitTicks);
  }
  const end = start.map((s, i) => (i + 1 < start.length ? start[i + 1]! : s + p.meter.countsPerBar));
  return { bars, start, end };
}

function barOfBeat(t: BarTable, beat: number): { bar: number; beatInBar: number } {
  let i = 0;
  while (i + 1 < t.start.length && t.start[i + 1]! <= beat + 1e-9) i++;
  if (t.start.length === 0) return { bar: 1, beatInBar: beat + 1 };
  return { bar: t.bars[i]!, beatInBar: beat - t.start[i]! + 1 };
}

/** "2", "2.5", "2.33". */
export const beatText = (b: number): string => String(Math.round(b * 100) / 100);

// ---- judgments to states and ghosts --------------------------------------------------------------

const PITCH_ERRORS = new Set(['sharp', 'flat', 'wrong-pitch', 'octave']);

export function noteStateOf(j: NoteJudgment): NoteVisualState {
  if (j.status === 'missed') return { phase: 'missed', rejudged: j.rejudged };
  const s: NoteVisualState = { phase: 'judged', marginal: j.marginal, rejudged: j.rejudged };
  if (j.timing) s.timing = j.timing;
  if (j.pitch) s.pitch = j.pitch;
  return s;
}

export function isError(j: NoteJudgment): boolean {
  if (j.status === 'missed') return true;
  return j.timing === 'early' || j.timing === 'late' || (j.pitch !== null && PITCH_ERRORS.has(j.pitch));
}

function kindsOf(j: NoteJudgment): SlipFilter[] {
  const k: SlipFilter[] = [];
  if (j.status === 'missed') k.push('missed');
  else {
    if (j.timing === 'early' || j.timing === 'late') k.push('timing');
    if (j.pitch === 'sharp' || j.pitch === 'flat') k.push('pitch');
    if (j.pitch === 'wrong-pitch' || j.pitch === 'octave') k.push('wrong');
    if (k.length === 0) k.push('correct');
  }
  if (j.rejudged) k.push('rejudged');
  return k;
}

/** Ghost kind: a pitch error wins, else the timing error (rules/live-verdict.ts, 04 §6.1 "one ghost with both"). */
function ghostKind(j: NoteJudgment): GhostNote['kind'] | null {
  if (j.status !== 'matched') return null;
  if (j.pitch !== null && PITCH_ERRORS.has(j.pitch)) return j.pitch as GhostNote['kind'];
  if (j.timing === 'early' || j.timing === 'late') return j.timing;
  return null;
}

const beatsOfSec = (sec: number, bpm: number): number => (sec * bpm) / 60;

/** Input-clock seconds minus score seconds, from any matched note or extra (the take's constant offset). */
function clockOffset(record: AttemptRecord, expected: readonly ExpectedNote[]): number | null {
  const det = new Map(record.detected.map((d) => [d.id, d]));
  for (const j of record.judgments) {
    if (j.status !== 'matched' || j.detectedId === null || j.timingErrorMs === null) continue;
    const d = det.get(j.detectedId);
    const e = expected[j.expectedIdx];
    if (d && e) return d.onset - (e.onsetSec + j.timingErrorMs / 1000);
  }
  for (const x of record.extras) {
    const d = det.get(x.detectedId);
    if (d) return d.onset - x.onsetSec;
  }
  return null;
}

// ---- inspector text ------------------------------------------------------------------------------

const VERDICT_WORD: Record<string, ReviewTextKey> = {
  early: 'verdict.early',
  late: 'verdict.late',
  sharp: 'verdict.sharp',
  flat: 'verdict.flat',
  'wrong-pitch': 'verdict.wrongNote',
  octave: 'verdict.wrongOctave',
  missed: 'verdict.missed',
};

function liveWas(live: LiveJudgment | undefined): string | null {
  if (!live) return null;
  if (live.status === 'missed') return rtext('verdict.missed');
  const words: string[] = [];
  if (live.timing === 'early' || live.timing === 'late') words.push(rtext(VERDICT_WORD[live.timing]!));
  if (live.pitch && PITCH_ERRORS.has(live.pitch)) words.push(rtext(VERDICT_WORD[live.pitch]!));
  return words.length ? words.join(', ') : rtext('verdict.right');
}

interface Ctx {
  record: AttemptRecord;
  prepared: PreparedExcerpt;
  instrument: Instrument;
  tolerances: readonly ResolvedTolerance[] | null;
  patternName: (id: string) => string | undefined;
  showNumbers: boolean;
  patterns: PatternResult[];
  live: Map<number, LiveJudgment>;
}

function timingPhrase(c: Ctx, j: NoteJudgment): string {
  const ms = Math.round(Math.abs(j.timingErrorMs ?? 0));
  if (j.timing !== 'early' && j.timing !== 'late') return rtext('review.onTime');
  const verdict = rtext(VERDICT_WORD[j.timing]!);
  if (!c.showNumbers) return verdict;
  return rtext('results.inspector.timing', { ms, verdict, value: timingValuePhrase(ms, c.record.bpm, c.prepared) });
}

function a11yTiming(c: Ctx, j: NoteJudgment): string {
  if (j.timing !== 'early' && j.timing !== 'late') return rtext('review.onTime');
  const verdict = rtext(VERDICT_WORD[j.timing]!);
  if (!c.showNumbers) return verdict;
  return rtext('review.a11y.ms', { ms: Math.round(Math.abs(j.timingErrorMs ?? 0)), verdict });
}

/** The verdict lines under "Played": timing credit, intonation, wrong note, octave, held short. */
function verdictLines(c: Ctx, e: ExpectedNote, j: NoteJudgment): string[] {
  const out: string[] = [];
  const tol = c.tolerances?.[e.idx] ?? null;
  const err = j.timingErrorMs ?? 0;
  const ms = Math.round(Math.abs(err));
  if (j.timing === 'late' || j.timing === 'early') {
    const partial = tol ? Math.abs(err) / 1000 <= tol.tBadSec : j.credit.o > 0;
    if (partial) out.push(rtext(j.timing === 'late' ? 'results.inspector.partialLate' : 'results.inspector.partialEarly'));
    else out.push(rtext(j.timing === 'late' ? 'review.verdict.late' : 'review.verdict.early'));
  } else if (j.timing === 'on-time' && j.marginal) {
    const timingMarginal = tol ? Math.abs(err) / 1000 > tol.tGoodSec : j.credit.o < 1;
    if (timingMarginal) {
      if (!c.showNumbers) out.push(rtext('review.marginalPlain'));
      else out.push(err >= 0 ? rtext('results.inspector.marginal', { ms }) : rtext('review.marginalEarly', { ms }));
    }
  }
  const cents = j.centsError;
  const intonationShown = j.pitch === 'sharp' || j.pitch === 'flat' || (j.marginal && j.pitch === 'in-tune' && cents !== null && Math.abs(cents) >= 1);
  if (intonationShown && cents !== null) {
    const dir = j.pitch === 'flat' || (j.pitch !== 'sharp' && cents < 0) ? 'flat' : 'sharp';
    const direction = rtext(dir === 'flat' ? 'verdict.flat' : 'verdict.sharp');
    if (!c.showNumbers) out.push(sentence(direction));
    else out.push(rtext(c.instrument.relativePitch ? 'results.inspector.centsVoice' : 'results.inspector.cents', { cents: Math.round(Math.abs(cents)), direction }));
  }
  if (j.pitch === 'wrong-pitch') out.push(sentence(rtext('verdict.wrongNote')));
  if (j.pitch === 'octave') out.push(sentence(rtext('verdict.wrongOctave')));
  if (j.octaveDisplaced) {
    const higher = j.playedConcertMidi !== null && j.playedConcertMidi > e.concertMidi;
    out.push(rtext(higher ? 'review.voiceOctaveHigher' : 'results.inspector.voiceOctave'));
  }
  if (j.duration === 'short') out.push(sentence(rtext('verdict.heldTooShort')));
  return out;
}

function rejudgedLine(c: Ctx, j: NoteJudgment): string | null {
  if (!j.rejudged) return null;
  const was = liveWas(c.live.get(j.expectedIdx));
  // The catalogue line ends "it was on time", so it is used only when that is what the final judgment says.
  const finalOnTimeRight = j.status === 'matched' && j.timing === 'on-time' && !(j.pitch !== null && PITCH_ERRORS.has(j.pitch));
  if (was !== null && finalOnTimeRight) return rtext('results.inspector.reJudged', { was });
  return rtext('results.rejudged.why');
}

function patternLine(c: Ctx, idx: number): string | null {
  for (const p of c.patterns) {
    if (!p.notes.includes(idx)) continue;
    const name = c.patternName(p.id);
    if (name) return rtext('results.inspector.pattern', { pattern: name });
  }
  return null;
}

// ---- build ---------------------------------------------------------------------------------------

export function buildReview(input: ReviewInput): ReviewModel {
  const { record, prepared, expected, instrument, spell } = input;
  const bpm = record.bpm;
  const key = prepared.writtenKey;
  const live = new Map<number, LiveJudgment>();
  for (const l of record.debug?.live ?? []) live.set(l.expectedIdx, l);
  const c: Ctx = {
    record,
    prepared,
    instrument,
    tolerances: input.tolerances ?? null,
    patternName: input.patternName ?? (() => undefined),
    showNumbers: input.showNumbers ?? true,
    patterns: record.score?.patterns ?? [],
    live,
  };
  const det = new Map(record.detected.map((d) => [d.id, d]));
  const table = barTable(prepared);
  const ghosts: GhostNote[] = [];
  const tails: GhostTail[] = [];
  const displacedIds = new Set(record.displaced.flatMap((s) => s.detectedIds));

  const judgmentByIdx = new Map(record.judgments.map((j) => [j.expectedIdx, j]));
  const notes: ReviewNote[] = [];
  for (const e of expected) {
    const j = judgmentByIdx.get(e.idx);
    if (!j) continue;
    const value = writtenValue(e, prepared);
    const location = rtext('results.inspector.location', { bar: e.bar, beat: beatText(e.beatInBar) });
    const kind = ghostKind(j);
    let ghost: GhostNote | null = null;
    let played: SpelledPitch | null = null;
    if (j.status === 'matched') {
      const scoreBeat = e.onsetBeat + beatsOfSec((j.timingErrorMs ?? 0) / 1000, bpm);
      const sameSpot = j.pitch === 'sharp' || j.pitch === 'flat' || !(j.pitch === 'wrong-pitch' || j.pitch === 'octave');
      played = sameSpot || j.playedConcertMidi === null ? { ...e.writtenPitch } : spell(j.playedConcertMidi, e, key, instrument);
      if (kind !== null && j.detectedId !== null) {
        ghost = {
          detectedId: j.detectedId,
          scoreBeat,
          writtenPitch: { ...played },
          kind,
          centsError: kind === 'sharp' || kind === 'flat' ? j.centsError : null,
          targetExpectedIdx: e.idx,
          displaced: false,
        };
        ghosts.push(ghost);
        const d = det.get(j.detectedId);
        if (d && d.offset !== null) tails.push({ detectedId: d.id, beat: scoreBeat, durBeats: beatsOfSec(d.offset - d.onset, bpm), pitch: ghost.writtenPitch, replay: false });
      }
    }
    const inspector: string[] = [location, rtext('results.inspector.written', { note: pitchText(e.writtenPitch, key, played), value })];
    let ariaLabel: string;
    const written = speakPitch(e.writtenPitch, key, played);
    if (j.status === 'missed') {
      inspector.push(rtext('review.notPlayed'));
      ariaLabel = rtext('review.a11y.missed', { bar: e.bar, beat: beatText(e.beatInBar), written, value });
    } else {
      const p = played ?? e.writtenPitch;
      inspector.push(rtext('results.inspector.played', { note: pitchText(p, key, e.writtenPitch), timing: timingPhrase(c, j) }));
      inspector.push(...verdictLines(c, e, j));
      const words: string[] = [];
      if (j.pitch === 'sharp' || j.pitch === 'flat' || j.pitch === 'wrong-pitch' || j.pitch === 'octave') words.push(rtext(VERDICT_WORD[j.pitch]!));
      if (j.duration === 'short') words.push(rtext('verdict.heldTooShort'));
      if (words.length === 0) words.push(rtext(isError(j) ? VERDICT_WORD[j.timing ?? 'late']! : 'verdict.right'));
      ariaLabel = rtext('a11y.note', { bar: e.bar, beat: beatText(e.beatInBar), written, value, played: speakPitch(p, key, e.writtenPitch), timing: a11yTiming(c, j), verdict: words.join(', ') });
    }
    const rj = rejudgedLine(c, j);
    if (rj) inspector.push(rj);
    const pl = patternLine(c, e.idx);
    if (pl) inspector.push(pl);
    notes.push({ idx: e.idx, bar: e.bar, beatInBar: e.beatInBar, beat: e.onsetBeat, state: noteStateOf(j), error: isError(j), kinds: kindsOf(j), rejudged: j.rejudged, ghost, inspector, ariaLabel });
  }

  // Extras (02 §4.1) and replayed runs (01 §9.5): unmatched played notes, ghosts at the played pitch.
  const extras: ReviewExtra[] = [];
  const offset = clockOffset(record, expected);
  const extraOf = (detectedId: number, beat: number, midi: number, durBeats: number | null, displaced: boolean): void => {
    const pitch = spell(midi, null, key, instrument);
    const g: GhostNote = { detectedId, scoreBeat: beat, writtenPitch: pitch, kind: 'extra', centsError: null, targetExpectedIdx: null, displaced };
    ghosts.push(g);
    if (durBeats !== null && durBeats > 0) tails.push({ detectedId, beat, durBeats, pitch, replay: displaced });
    const where = barOfBeat(table, beat);
    const verdict = rtext(displaced ? 'verdict.replayed' : 'verdict.extraNote');
    extras.push({
      detectedId,
      beat,
      bar: where.bar,
      beatInBar: where.beatInBar,
      displaced,
      ghost: g,
      inspector: [
        rtext('review.extraLocation', { bar: where.bar, beat: beatText(where.beatInBar) }),
        rtext('results.inspector.played', { note: pitchText(pitch, key), timing: verdict }),
      ],
      ariaLabel: rtext('review.a11y.extra', { bar: where.bar, beat: beatText(where.beatInBar), played: speakPitch(pitch, key), verdict }),
    });
  };
  for (const x of record.extras) {
    if (displacedIds.has(x.detectedId)) continue;
    extraOf(x.detectedId, beatsOfSec(x.onsetSec, bpm), x.concertMidi, beatsOfSec(x.durSec, bpm), false);
  }

  const brackets: ReplayBracket[] = [];
  for (const seg of record.displaced) {
    const from = expected[seg.fromIdx];
    const to = expected[seg.toIdx];
    if (!from || !to) continue;
    const beats: number[] = [];
    let endBeat = -Infinity;
    const ordered = seg.detectedIds.map((id) => det.get(id)).filter((d): d is NonNullable<typeof d> => d !== undefined);
    ordered.sort((a, b) => a.onset - b.onset);
    ordered.forEach((d, k) => {
      let beat: number;
      if (offset !== null) beat = beatsOfSec(d.onset - offset, bpm);
      else {
        // No matched note or extra to anchor the clock: the run's own offset from the material it replays.
        const e = expected[Math.min(seg.fromIdx + k, seg.toIdx)]!;
        beat = e.onsetBeat - seg.offsetBeats;
      }
      const dur = d.offset !== null ? beatsOfSec(d.offset - d.onset, bpm) : null;
      extraOf(d.id, beat, d.midi, dur, true);
      beats.push(beat);
      endBeat = Math.max(endBeat, beat + (dur ?? 0));
    });
    if (beats.length === 0) continue;
    brackets.push({
      fromBar: from.bar,
      toBar: to.bar,
      startBeat: Math.min(...beats),
      endBeat: Math.max(endBeat, Math.max(...beats)),
      label: rtext('results.bracketReplayed', { from: from.bar, to: to.bar }),
      detectedIds: ordered.map((d) => d.id),
    });
  }

  extras.sort((a, b) => a.beat - b.beat || a.detectedId - b.detectedId);
  return { notes, extras, ghosts, tails, heat: heatCells(table, notes, judgmentByIdx), brackets };
}

const HEAT_DETAIL: [string, ReviewTextKey][] = [
  ['late', 'verdict.late'],
  ['early', 'verdict.early'],
  ['sharp', 'verdict.sharp'],
  ['flat', 'verdict.flat'],
  ['wrong-pitch', 'verdict.wrongNote'],
  ['octave', 'verdict.wrongOctave'],
  ['missed', 'verdict.missed'],
];

function heatCells(t: BarTable, notes: readonly ReviewNote[], judgments: Map<number, NoteJudgment>): HeatCell[] {
  return t.bars.map((bar, i) => {
    const inBar = notes.filter((n) => n.bar === bar);
    const off = inBar.filter((n) => n.error);
    const tally = new Map<string, number>();
    for (const n of off) {
      const j = judgments.get(n.idx)!;
      const ks: string[] = j.status === 'missed' ? ['missed'] : [];
      if (j.timing === 'early' || j.timing === 'late') ks.push(j.timing);
      if (j.pitch !== null && PITCH_ERRORS.has(j.pitch)) ks.push(j.pitch);
      for (const k of ks) tally.set(k, (tally.get(k) ?? 0) + 1);
    }
    const detail = HEAT_DETAIL.filter(([k]) => tally.has(k))
      .map(([k, word]) => `${tally.get(k)} ${rtext(word)}`)
      .join(', ');
    const share = inBar.length ? off.length / inBar.length : 0;
    return {
      bar,
      startBeat: t.start[i]!,
      endBeat: t.end[i]!,
      total: inBar.length,
      off: off.length,
      share,
      level: heatLevel(share),
      label: off.length ? rtext('results.heat', { bar, off: off.length, total: inBar.length, detail }) : null,
    };
  });
}

// ---- slips ---------------------------------------------------------------------------------------

/** Slips in time order for a filter: error notes (and extras) for 'all'; the notes of one count otherwise. */
export function slipsFor(m: ReviewModel, filter: SlipFilter): SlipTarget[] {
  const out: SlipTarget[] = [];
  for (const n of m.notes) {
    const keep = filter === 'all' ? n.error : n.kinds.includes(filter);
    if (keep) out.push({ kind: 'note', idx: n.idx, beat: n.beat });
  }
  if (filter === 'all' || filter === 'extra') for (const x of m.extras) if (!x.displaced) out.push({ kind: 'extra', detectedId: x.detectedId, beat: x.beat });
  return out.sort((a, b) => a.beat - b.beat || (a.kind === b.kind ? 0 : a.kind === 'note' ? -1 : 1));
}

export const sameTarget = (a: SlipTarget | null, b: SlipTarget | null): boolean =>
  a !== null && b !== null && a.kind === b.kind && (a.kind === 'note' ? a.idx === (b as { idx: number }).idx : a.detectedId === (b as { detectedId: number }).detectedId);

/** Previous or next slip from the current selection; from a non-slip, the nearest slip in that direction. Clamps at the ends. */
export function stepSlip(slips: readonly SlipTarget[], current: SlipTarget | null, dir: 1 | -1): SlipTarget | null {
  if (slips.length === 0) return null;
  if (current === null) return dir > 0 ? slips[0]! : slips[slips.length - 1]!;
  const at = slips.findIndex((s) => sameTarget(s, current));
  if (at >= 0) return slips[Math.max(0, Math.min(slips.length - 1, at + dir))]!;
  if (dir > 0) return slips.find((s) => s.beat > current.beat) ?? slips[slips.length - 1]!;
  for (let i = slips.length - 1; i >= 0; i--) if (slips[i]!.beat < current.beat) return slips[i]!;
  return slips[0]!;
}

export function inspectorFor(m: ReviewModel, t: SlipTarget): string[] {
  if (t.kind === 'note') return m.notes.find((n) => n.idx === t.idx)?.inspector ?? [];
  return m.extras.find((x) => x.detectedId === t.detectedId)?.inspector ?? [];
}
