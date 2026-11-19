/**
 * Range model for the range picture, the instrument cards and the difficulty line (redesign 05 section 7, 06 sections
 * 6.10 and 6.11, build decision 10). Pure: reads only `Configs` and the instrument. Text is returned as copy-key ids and
 * their variables, because this package may not import the copy catalogue; the UI formats them with `copy()`.
 *
 * Pitch frames: `written` is what the staff shows; `concert` is what sounds (written minus
 * `writtenMinusSounding.chromatic`). Voices are named in sung (concert) pitch: a tenor reads treble-8vb, sings A2 to A4
 * and the card adds "Written an octave higher".
 */
import type { Clef, Configs, Instrument, SpelledPitch, Step, TierId } from '../core/types.ts';

/** Pitch-class spelling in C major (05 section 7.1): C, C♯, D, E♭, E, F, F♯, G, A♭, A, B♭, B. */
const FLAT_SPELLING: readonly [Step, -1 | 0 | 1][] = [
  ['C', 0], ['C', 1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0],
];
/** Sharp-side spelling, for notes written on the sharp side of an instrument's default key. */
const SHARP_SPELLING: readonly [Step, -1 | 0 | 1][] = [
  ['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0],
];
const STEPS: readonly Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const mod = (n: number, m: number): number => ((n % m) + m) % m;

/** Spelled pitch for a MIDI number. `sharps` picks the sharp-side spelling; the default is the C major one. */
export function spellMidi(midi: number, sharps = false): SpelledPitch {
  const [step, alter] = (sharps ? SHARP_SPELLING : FLAT_SPELLING)[mod(midi, 12)]!;
  return { step, alter, octave: Math.floor(midi / 12) - 1 };
}

/** "B♭3", "F♯5", "C4": scientific pitch with real accidental glyphs. */
export function noteName(midi: number, sharps = false): string {
  const p = spellMidi(midi, sharps);
  return `${p.step}${p.alter > 0 ? '♯' : p.alter < 0 ? '♭' : ''}${p.octave}`;
}

/** The served tier at a difficulty, from levels.json `tier` (never computed from the number). */
export function tierAt(cfg: Configs, level: number): TierId {
  const def = cfg.levelByNumber[level];
  if (!def) throw new RangeError(`no level ${level}`);
  return def.tier;
}

/** Written MIDI range served at a difficulty. */
export function servedWrittenRange(cfg: Configs, inst: Instrument, level: number): [number, number] {
  const [lo, hi] = inst.tiers[tierAt(cfg, level)];
  return [lo, hi];
}

export const isVoiceInstrument = (inst: Instrument): boolean => inst.family === 'voice';
const chromaticOf = (inst: Instrument): number => inst.writtenMinusSounding.chromatic;
const toConcert = (inst: Instrument, r: readonly [number, number]): [number, number] => [r[0] - chromaticOf(inst), r[1] - chromaticOf(inst)];

/** How the instrument sounds against its written part, as copy-key ids and the interval key. */
export type TranspositionKind =
  | { kind: 'none' }
  /** A voice written an octave above where it is sung (tenor). Card: "Written an octave higher". */
  | { kind: 'voice-octave' }
  /** Sounds an octave (or several) lower: "Sounds an octave lower: A2 to A4". */
  | { kind: 'octave'; direction: 'lower' | 'higher'; octaves: number }
  /** "Sounds a major 2nd lower: concert D3 to F6". `interval` is the `interval.*` copy suffix. */
  | { kind: 'simple'; direction: 'lower' | 'higher'; interval: IntervalId }
  /** "Sounds an octave and a major 2nd lower: concert A♭2 to E5". */
  | { kind: 'compound'; direction: 'lower' | 'higher'; interval: IntervalId; octaves: number };

export type IntervalId =
  | 'minor2' | 'major2' | 'minor3' | 'major3' | 'perfect4' | 'tritone' | 'perfect5' | 'minor6' | 'major6' | 'minor7' | 'major7';

/** Interval quality from the diatonic and chromatic size (both reduced to one octave). */
function intervalId(diatonic: number, chromatic: number): IntervalId {
  const d = mod(diatonic, 7);
  const c = mod(chromatic, 12);
  const table: Record<number, Partial<Record<number, IntervalId>>> = {
    1: { 1: 'minor2', 2: 'major2' },
    2: { 3: 'minor3', 4: 'major3' },
    3: { 5: 'perfect4', 6: 'tritone' },
    4: { 6: 'tritone', 7: 'perfect5' },
    5: { 8: 'minor6', 9: 'major6' },
    6: { 10: 'minor7', 11: 'major7' },
  };
  const hit = table[d]?.[c];
  if (hit) return hit;
  const byChromatic: IntervalId[] = ['major2', 'minor2', 'major2', 'minor3', 'major3', 'perfect4', 'tritone', 'perfect5', 'minor6', 'major6', 'minor7', 'major7'];
  return byChromatic[c]!;
}

export function transpositionKind(inst: Instrument): TranspositionKind {
  const c = chromaticOf(inst);
  if (c === 0) return { kind: 'none' };
  const direction = c > 0 ? 'lower' : 'higher';
  const abs = Math.abs(c);
  const octaves = Math.floor(abs / 12);
  if (isVoiceInstrument(inst) && abs === 12) return { kind: 'voice-octave' };
  if (abs % 12 === 0) return { kind: 'octave', direction, octaves };
  const interval = intervalId(Math.abs(inst.writtenMinusSounding.diatonic), abs);
  return octaves === 0 ? { kind: 'simple', direction, interval } : { kind: 'compound', direction, interval, octaves };
}

/** A line of text as a copy-key id and its variables (formatted by the UI). */
export interface RangeText {
  key: string;
  vars: Record<string, string | number>;
  /** Variables whose value is itself a copy key (for example `interval: 'interval.major2'`), formatted first. */
  keyVars?: Record<string, string>;
}

export interface RangeModel {
  instrumentId: string;
  level: number;
  tier: TierId;
  voice: boolean;
  /** `chromatic` is not 0. */
  transposing: boolean;
  firstClef: Clef;
  written: { full: [number, number]; served: [number, number] };
  concert: { full: [number, number]; served: [number, number] };
  /** The range the player names: sung (concert) for voices, written for everyone else. */
  display: { full: [number, number]; served: [number, number] };
  names: { full: [string, string]; served: [string, string]; concertFull: [string, string] };
  transposition: TranspositionKind;
  /** Lines under the large picture, in order (05 section 7.5). */
  lines: RangeText[];
  /** Card second line (06 section 6.11): tenor "Written an octave higher"; transposing "Sounds a major 2nd lower". */
  cardNote: RangeText | null;
  /** The difficulty line, "At difficulty 2: C3 to C4". */
  servedLine: RangeText;
  /** Accessible name of the whole picture. `instrument` is left for the UI to fill with the full name. */
  a11y: RangeText;
}

function nameRange(r: readonly [number, number]): [string, string] {
  return [noteName(r[0]), noteName(r[1])];
}

/** The transposition line under the picture, or the card's short form (no range). */
function transpositionText(t: TranspositionKind, concertNames: [string, string]): RangeText | null {
  const [low, high] = concertNames;
  switch (t.kind) {
    case 'none':
      return null;
    case 'voice-octave':
      return { key: 'range.writtenOctave', vars: {} };
    case 'octave':
      return { key: 'range.soundsOctave', vars: { low, high } };
    case 'simple':
      return { key: 'range.sounds', vars: { low, high }, keyVars: { interval: `interval.${t.interval}` } };
    case 'compound':
      return { key: 'range.soundsCompound', vars: { low, high }, keyVars: { interval: `interval.${t.interval}` } };
  }
}

/** Full, served and concert ranges with their text at one difficulty. */
export function rangeModel(cfg: Configs, inst: Instrument, level: number): RangeModel {
  const tier = tierAt(cfg, level);
  const wFull: [number, number] = [inst.fullWrittenRange[0], inst.fullWrittenRange[1]];
  const wServed = servedWrittenRange(cfg, inst, level);
  const cFull = toConcert(inst, wFull);
  const cServed = toConcert(inst, wServed);
  const voice = isVoiceInstrument(inst);
  const dFull = voice ? cFull : wFull;
  const dServed = voice ? cServed : wServed;
  const names = { full: nameRange(dFull), served: nameRange(dServed), concertFull: nameRange(cFull) };
  const t = transpositionKind(inst);
  const lines: RangeText[] = [
    { key: 'range.full', vars: { low: names.full[0], high: names.full[1] } },
    { key: 'range.atDifficulty', vars: { level, low: names.served[0], high: names.served[1] } },
  ];
  const tLine = transpositionText(t, names.concertFull);
  if (tLine) lines.push(tLine);
  if (voice) lines.push({ key: 'range.voiceNote', vars: {} });
  let cardNote: RangeText | null = null;
  if (t.kind === 'voice-octave') cardNote = { key: 'range.writtenOctave', vars: {} };
  else if (t.kind !== 'none') cardNote = tLine;
  return {
    instrumentId: inst.id,
    level,
    tier,
    voice,
    transposing: chromaticOf(inst) !== 0,
    firstClef: firstClef(inst),
    written: { full: wFull, served: wServed },
    concert: { full: cFull, served: cServed },
    display: { full: dFull, served: dServed },
    names,
    transposition: t,
    lines,
    cardNote,
    servedLine: lines[1]!,
    a11y: {
      key: 'range.a11y',
      vars: { low: names.full[0], high: names.full[1], level, servedLow: names.served[0], servedHigh: names.served[1] },
    },
  };
}

// ---- staff plan (05 section 7.4) --------------------------------------------------------

/** Most ledger lines drawn plainly before a clef change or an octave mark. */
export const MAX_LEDGER_LINES = 4;

/** Diatonic index (octave * 7 + step) of each clef's middle line, in written pitch. */
const MIDDLE_LINE: Record<Clef, number> = {
  treble: 4 * 7 + 6, // B4
  'treble-8vb': 4 * 7 + 6, // B4 written (sounds B3)
  alto: 4 * 7 + 0, // C4
  tenor: 3 * 7 + 5, // A3
  bass: 3 * 7 + 1, // D3
};

/** First clef: the one with the lowest `fromLevel` (05 section 7.4). */
export function firstClef(inst: Instrument): Clef {
  const sorted = [...inst.clefs].sort((a, b) => a.fromLevel - b.fromLevel);
  return sorted[0]?.clef ?? 'treble';
}

export interface StaffNote {
  /** Written MIDI. */
  midi: number;
  pitch: SpelledPitch;
  /** Name shown under the note: sung pitch for voices, written pitch otherwise. */
  label: string;
  /** Clef the note is drawn in. */
  clef: Clef;
  /** A clef change to `clef` is drawn before this note. */
  clefChange: boolean;
  /** Octave mark over (8va) or under (8vb) the note; the label keeps the written name. */
  octaveMark: '8va' | '8vb' | null;
  /** Staff steps from the middle line after any octave mark: +1 is one line or space up. */
  position: number;
  /** Ledger lines drawn (above when position > 0, below when < 0). */
  ledgerLines: number;
}

export interface StaffPlan {
  firstClef: Clef;
  notes: StaffNote[];
}

/** Ledger lines a note at staff position `p` needs (staff lines at -4, -2, 0, 2, 4). */
export function ledgerLinesAt(p: number): number {
  if (p >= 6) return Math.floor((p - 4) / 2);
  if (p <= -6) return Math.floor((-p - 4) / 2);
  return 0;
}

const diatonicIndex = (p: SpelledPitch): number => p.octave * 7 + STEPS.indexOf(p.step);
const positionIn = (p: SpelledPitch, clef: Clef): number => diatonicIndex(p) - MIDDLE_LINE[clef];

/** Clefs above `clef` in the instrument's list, highest first. */
function higherClefs(inst: Instrument, clef: Clef): Clef[] {
  const base = MIDDLE_LINE[clef];
  return inst.clefs.map((c) => c.clef).filter((c) => MIDDLE_LINE[c] > base).sort((a, b) => MIDDLE_LINE[b] - MIDDLE_LINE[a]);
}

/**
 * How each note of the large picture is drawn: in the first clef with up to four ledger lines; above that, in the
 * highest higher clef the instrument reads (cello A5 in treble clef) when the note fits there, else with 8va; below
 * the staff, with 8vb.
 */
export function staffPlan(inst: Instrument, writtenMidis: readonly number[]): StaffPlan {
  const clef0 = firstClef(inst);
  const voice = isVoiceInstrument(inst);
  const c = chromaticOf(inst);
  const notes = writtenMidis.map((midi): StaffNote => {
    const pitch = spellMidi(midi);
    const label = noteName(voice ? midi - c : midi);
    const base = positionIn(pitch, clef0);
    const plain: StaffNote = { midi, pitch, label, clef: clef0, clefChange: false, octaveMark: null, position: base, ledgerLines: ledgerLinesAt(base) };
    if (plain.ledgerLines <= MAX_LEDGER_LINES) return plain;
    if (base > 0) {
      const higher = higherClefs(inst, clef0)[0];
      if (higher) {
        const p = positionIn(pitch, higher);
        if (ledgerLinesAt(p) <= MAX_LEDGER_LINES) return { ...plain, clef: higher, clefChange: true, position: p, ledgerLines: ledgerLinesAt(p) };
      }
      return { ...plain, octaveMark: '8va', position: base - 7, ledgerLines: ledgerLinesAt(base - 7) };
    }
    return { ...plain, octaveMark: '8vb', position: base + 7, ledgerLines: ledgerLinesAt(base + 7) };
  });
  return { firstClef: clef0, notes };
}

/** The four notes of the large picture in drawing order: full low, served low, served high, full high. */
export function pictureNotes(model: RangeModel): number[] {
  return [model.written.full[0], model.written.served[0], model.written.served[1], model.written.full[1]];
}

// ---- keyboard strip and ruler (06 sections 6.10, 6.11) ----------------------------------

/** Keyboard strip span for voices (06 D5): C2 to C5, widened to C's when a voice's range goes past it. */
export const VOICE_KEYBOARD: readonly [number, number] = [36, 72];

export interface KeyboardSpan {
  /** Concert MIDI of the first and last key; both are C's. */
  low: number;
  high: number;
  full: [number, number];
  served: [number, number];
  /** Middle C, when inside the span. */
  middleC: number | null;
  /** The C's to label under the keys. */
  cs: number[];
}

/** Keys from C at or below `lo` to C at or above `hi`. */
function roundOutToCs(lo: number, hi: number): [number, number] {
  return [lo - mod(lo, 12), hi + mod(12 - mod(hi, 12), 12)];
}

/** The keyboard strip span in sounding pitch, with the full and served bands. */
export function keyboardSpan(model: RangeModel, inst: Instrument): KeyboardSpan {
  const [cLo, cHi] = model.concert.full;
  let [low, high] = roundOutToCs(cLo, cHi);
  if (isVoiceInstrument(inst)) {
    low = Math.min(low, VOICE_KEYBOARD[0]);
    high = Math.max(high, VOICE_KEYBOARD[1]);
  }
  const cs: number[] = [];
  for (let m = low; m <= high; m += 12) cs.push(m);
  return { low, high, full: model.concert.full, served: model.concert.served, middleC: low <= 60 && high >= 60 ? 60 : null, cs };
}

/** The shared ruler axis of the instrument cards, C1 to C8 in sounding pitch (06 D3). */
export const RULER_AXIS: readonly [number, number] = [24, 108];

/** Position of a sounding MIDI number on the ruler axis, 0 to 1. */
export function rulerFraction(midi: number): number {
  const [a, b] = RULER_AXIS;
  return Math.min(1, Math.max(0, (midi - a) / (b - a)));
}
