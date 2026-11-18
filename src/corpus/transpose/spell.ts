/**
 * Spelled transposition (03 §7.4 steps 2 to 4) and the spelling rejection rule (03 §7.5 rule 3).
 *
 * The written pitches are built straight from the source by the interval `Ks -> Kw` (chromatic `t + c_I`), so the
 * written spelling is exactly the requested key (R1) even when the concert key would need more than 7 accidentals.
 * The concert pitches use `Ks -> Kc`; when `Kc` is not a valid key (for example alto sax reading in G flat, whose
 * concert key is B double-flat) the concert side is re-spelled in the enharmonic key. Concert spelling is internal
 * (everything after `corpus/` works in concert MIDI, 01 §7.10), so this never changes what the player reads.
 */
import type { ExcerptDoc, Instrument, Interval, KeySig, NoteEvt, SpelledPitch } from '../../core/types.ts';
import { enharmonicKey, intervalBetweenKeys, isValidKey, toMidi, tryTransposePitch } from '../../theory/index.ts';
import { concertKeyFor, negateInterval } from './fit.ts';

/** 03 §7.5 rule 3: "more than 2 at any level". The spec gives the number; config has no field for it. */
export const MAX_DOUBLE_ACCIDENTALS = 2;

/** How one excerpt is spelled in one written key. */
export interface TranspositionPlan {
  sourceKey: KeySig;
  writtenKey: KeySig;
  /** Valid concert key (enharmonic of `transposeKey(Kw, -I)` when that needs more than 7 accidentals). */
  concertKey: KeySig;
  /** Source -> concert, `{diatonic, chromatic: t}` (03 §7.4 step 2), spelled towards `concertKey`. */
  concertInterval: Interval;
  /** Source -> written, `{diatonic, chromatic: t + c_I}`. */
  writtenInterval: Interval;
  t: number;
}

/** 03 §7.4 steps 2 and 4. `t` must agree with the keys modulo 12 (as returned by `fitsInKey`). */
export function planTransposition(sourceKey: KeySig, writtenKey: KeySig, t: number, inst: Instrument): TranspositionPlan {
  const rawConcert = concertKeyFor(writtenKey, inst);
  const concertKey = isValidKey(rawConcert) ? rawConcert : enharmonicKey(rawConcert);
  return {
    sourceKey,
    writtenKey,
    concertKey,
    concertInterval: intervalBetweenKeys(sourceKey, concertKey, t),
    writtenInterval: intervalBetweenKeys(sourceKey, writtenKey, t + inst.writtenMinusSounding.chromatic),
    t,
  };
}

export type SpellingVerdict = 'ok' | 'triple-accidental' | 'double-accidental' | 'too-many-doubles';

/** Written and concert spelling of every note event, by event id. */
export interface SpelledExcerpt {
  written: Map<string, SpelledPitch>;
  concert: Map<string, SpelledPitch>;
  verdict: SpellingVerdict;
  doubles: number;
}

/** `ManifestEntry.spelling` key of a spelled pitch class: letter and alteration, for example "F1" or "B-1". */
export function spellingKey(p: Pick<SpelledPitch, 'step' | 'alter'>): string {
  return `${p.step}${p.alter}`;
}

/** `ManifestEntry.spelling` of a doc: note events per concert spelled pitch class, tie continuations included. */
export function spellingOf(doc: Pick<ExcerptDoc, 'measures'>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of noteEvents(doc)) {
    const k = spellingKey(n.pitch);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

const SPELLING_KEY = /^([A-G])(-?[0-2])$/;

/**
 * 03 §7.5 rule 3 from the manifest alone (PLAN ruling 44): the same verdict `spellExcerpt` gives the doc, because
 * the written alteration of a transposed note depends only on its letter and alteration, never its octave.
 */
export function judgeSpelling(spelling: Readonly<Record<string, number>>, writtenInterval: Interval, doublesAllowed: boolean): { verdict: SpellingVerdict; doubles: number } {
  let doubles = 0;
  for (const [key, count] of Object.entries(spelling)) {
    const m = SPELLING_KEY.exec(key);
    if (!m) throw new RangeError(`invalid spelling key ${JSON.stringify(key)}`);
    const pitch: SpelledPitch = { step: m[1] as SpelledPitch['step'], alter: Number(m[2]) as SpelledPitch['alter'], octave: 4 };
    const w = tryTransposePitch(pitch, writtenInterval);
    if (!w) return { verdict: 'triple-accidental', doubles };
    if (Math.abs(w.alter) === 2) doubles += count;
  }
  if (doubles > MAX_DOUBLE_ACCIDENTALS) return { verdict: 'too-many-doubles', doubles };
  if (doubles > 0 && !doublesAllowed) return { verdict: 'double-accidental', doubles };
  return { verdict: 'ok', doubles };
}

export function noteEvents(doc: Pick<ExcerptDoc, 'measures'>): NoteEvt[] {
  const out: NoteEvt[] = [];
  for (const m of doc.measures) for (const e of m.events) if (e.kind === 'note') out.push(e);
  return out;
}

const SHARP_LETTERS: readonly [SpelledPitch['step'], SpelledPitch['alter']][] = [
  ['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0],
];

/** Last-resort concert spelling by MIDI (only reached if both concert spellings need a triple accidental). */
function plainSpelling(midi: number): SpelledPitch {
  const [step, alter] = SHARP_LETTERS[((midi % 12) + 12) % 12]!;
  return { step, alter, octave: Math.floor(midi / 12) - 1 };
}

/**
 * Spell every note (03 §7.4 step 3) and judge the written spelling (03 §7.5 rule 3): any triple accidental rejects;
 * a double sharp or flat rejects when the level does not allow them (02 §2.3: from L8); more than 2 reject at any
 * level. Stops at the first triple accidental.
 */
export function spellExcerpt(doc: Pick<ExcerptDoc, 'measures'>, plan: TranspositionPlan, inst: Instrument, doublesAllowed: boolean): SpelledExcerpt {
  const written = new Map<string, SpelledPitch>();
  const concert = new Map<string, SpelledPitch>();
  const back = negateInterval(inst.writtenMinusSounding);
  let doubles = 0;
  for (const n of noteEvents(doc)) {
    const w = tryTransposePitch(n.pitch, plan.writtenInterval);
    if (!w) return { written, concert, verdict: 'triple-accidental', doubles };
    if (Math.abs(w.alter) === 2) doubles++;
    written.set(n.id, w);
    const c = tryTransposePitch(n.pitch, plan.concertInterval) ?? tryTransposePitch(w, back) ?? plainSpelling(toMidi(w) + back.chromatic);
    concert.set(n.id, c);
  }
  let verdict: SpellingVerdict = 'ok';
  if (doubles > MAX_DOUBLE_ACCIDENTALS) verdict = 'too-many-doubles';
  else if (doubles > 0 && !doublesAllowed) verdict = 'double-accidental';
  return { written, concert, verdict, doubles };
}
