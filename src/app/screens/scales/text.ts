/**
 * Scale names and facts on screen (PLAN ruling 68). Every word comes from the copy catalogue: a scale is named by its
 * pattern and key ("Five-note scale in B♭ major"), never by a composer or a work.
 */
import type { AttemptRecord, AttemptSummary, ScaleRef, ScaleSet, ScalesConfig, SpelledPitch } from '../../../core/types.ts';
import { scaleKey, scalePitches, scaleRefOf, scaleRhythm } from '../../../session/index.ts';
import { copy, isCopyKey } from '../../../ui/copy/copy.ts';
import { keyName } from '../setup/key-names.ts';

const SIGN: Readonly<Record<number, string>> = { [-2]: '𝄫', [-1]: '♭', 0: '', 1: '♯', 2: '𝄪' };
const NATURAL: Readonly<Record<SpelledPitch['step'], number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "B♭2". */
export const noteName = (p: SpelledPitch): string => `${p.step}${SIGN[p.alter] ?? ''}${p.octave}`;
const midiOf = (p: SpelledPitch): number => 12 * (p.octave + 1) + NATURAL[p.step] + p.alter;

/** "Five-note scale in C major", "B♭ major scale", "A minor scale (natural)", "C major arpeggio". */
export function scaleTitle(ref: Pick<ScaleRef, 'pattern' | 'tonic' | 'mode'>): string {
  const key = keyName(scaleKey(ref));
  const byMode = `scales.title.${ref.pattern}.${ref.mode}`;
  const byPattern = `scales.title.${ref.pattern}`;
  if (isCopyKey(byMode)) return copy(byMode, { key });
  if (isCopyKey(byPattern)) return copy(byPattern, { key });
  return copy('scales.scan.chip', { title: key });
}

/** "Do re mi fa sol, and back down", or null for a pattern the catalogue has no line for. */
export function patternLine(pattern: string): string | null {
  const k = `scales.pattern.${pattern}`;
  return isCopyKey(k) ? copy(k) : null;
}

/** The lowest and highest notes, by name. */
export function scaleSpan(ref: Pick<ScaleRef, 'tonic' | 'mode' | 'degrees'>): { low: string; high: string } {
  const pitches = scalePitches(ref);
  let lo = pitches[0] as SpelledPitch;
  let hi = lo;
  for (const p of pitches) {
    if (midiOf(p) < midiOf(lo)) lo = p;
    if (midiOf(p) > midiOf(hi)) hi = p;
  }
  return { low: noteName(lo), high: noteName(hi) };
}

/** One row of the chooser. */
export interface ScaleRow {
  id: string;
  title: string;
  pattern: string | null;
  low: string;
  high: string;
  bars: number;
  bpm: number;
}

/** The chooser's rows, in the set's order (easy to harder). */
export function scaleRows(config: ScalesConfig, set: ScaleSet): ScaleRow[] {
  return set.scales.map((def) => {
    const ref = scaleRefOf(config, def);
    return { id: def.id, title: scaleTitle(ref), pattern: patternLine(ref.pattern), ...scaleSpan(ref), bars: scaleRhythm(ref.degrees.length, ref).bars, bpm: def.bpm };
  });
}

/** True for a scale try (an attempt or its history row). */
export const isScaleTry = (a: Pick<AttemptRecord, 'kind'> | Pick<AttemptSummary, 'kind'>): boolean => a.kind === 'scale';

/** What a try is called on screen: the scale's name for a scale try, else the work (and movement). */
export function tryTitle(a: Pick<AttemptRecord, 'kind' | 'scale' | 'credit'>): string {
  if (a.kind === 'scale' && a.scale) return scaleTitle(a.scale);
  const c = a.credit;
  return c.movement ? `${c.work}: ${c.movement}` : c.work;
}

/** A history row's title: the scale's name for a scale try, else the stored title. */
export function rowTitle(row: Pick<AttemptSummary, 'kind' | 'scale' | 'title'>): string {
  return row.kind === 'scale' && row.scale ? scaleTitle(row.scale) : row.title;
}
