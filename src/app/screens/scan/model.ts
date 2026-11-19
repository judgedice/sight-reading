/** Pure helpers for the scan screen (04 section 5.3): summary text, STARS rows and ticks, accidentals, credits. */
import type { ExcerptSource, KeySig, PreparedExcerpt } from '../../../core/types.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { beatUnit } from '../setup/model.ts';
import { keyName } from '../setup/key-names.ts';

export type StarsId = 'signatures' | 'tempo' | 'accidentals' | 'rhythms' | 'signs';

/** The five STARS rows in order (02 section 7). */
export const STARS_ORDER: readonly StarsId[] = ['signatures', 'tempo', 'accidentals', 'rhythms', 'signs'];

/** Rows that draw a highlight in the overlay while hovered, focused or active (04 section 5.3). */
export const HIGHLIGHTED: ReadonlySet<StarsId> = new Set<StarsId>(['accidentals', 'signs']);

export const meterString = (p: PreparedExcerpt): string => `${p.meter.beats}/${p.meter.beatType}`;

export const barCount = (p: PreparedExcerpt): number => p.measures.filter((m) => !m.isPickup).length;

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "Level 5 · E major · 6/8 · ♩. = 60 · 10 bars" */
export function scanSummary(p: PreparedExcerpt): string {
  return copy('scan.summary', {
    level: p.levelServed,
    key: keyName(p.writtenKey),
    meter: meterString(p),
    tempo: copy('tempo.marking', { unit: beatUnit(meterString(p)), bpm: p.selection.settings.bpm }),
    bars: barCount(p),
  });
}

/** "10 bars instead of 12" when the selector served another length than the request; else null. */
export function servedBarsNote(p: PreparedExcerpt, requested: number | 'random'): string | null {
  const served = barCount(p);
  if (requested === 'random' || requested === served) return null;
  return copy('scan.served.bars', { served, requested });
}

const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'] as const;

/** Letters altered by a key signature, in order of appearance: "F♯ C♯ G♯ D♯" or "B♭ E♭". */
export function signatureNotes(k: KeySig): string[] {
  const n = Math.abs(k.fifths);
  const order = k.fifths >= 0 ? [...SHARP_ORDER] : [...SHARP_ORDER].reverse();
  const mark = k.fifths >= 0 ? '♯' : '♭';
  return order.slice(0, n).map((l) => `${l}${mark}`);
}

/** The Signatures row detail: "E major, 4 sharps: F♯ C♯ G♯ D♯. 6/8, felt in 2." */
export function signatureDetail(p: PreparedExcerpt): string {
  const k = p.writtenKey;
  const accidentals = k.fifths < 0 ? copy('accidentals.flats', { n: -k.fifths }) : copy('accidentals.sharps', { n: k.fifths });
  const text = copy('stars.signatures.detail', {
    key: keyName(k),
    accidentals,
    notes: signatureNotes(k).join(' '),
    meter: meterString(p),
    beats: p.meter.countsPerBar,
  });
  return k.fifths === 0 ? text.replace(': .', '.') : text;
}

/** Alteration the key signature gives a letter. */
function keyAlter(k: KeySig, step: string): number {
  const sharps: readonly string[] = SHARP_ORDER;
  if (k.fifths >= 0) return sharps.indexOf(step) < k.fifths && sharps.indexOf(step) >= 0 ? 1 : 0;
  const flats = [...SHARP_ORDER].reverse() as string[];
  const i = flats.indexOf(step);
  return i >= 0 && i < -k.fifths ? -1 : 0;
}

/**
 * Event ids of notes that carry a written accidental sign: the alteration differs from what the key signature (or an
 * earlier accidental on the same line or space in the same bar) already gives. Tie continuations never repeat the sign.
 */
export function writtenAccidentalIds(p: PreparedExcerpt): string[] {
  const out: string[] = [];
  for (const m of p.measures) {
    const memory = new Map<string, number>();
    for (const e of m.events) {
      if (e.kind !== 'note') continue;
      const w = e.writtenPitch;
      const pos = `${w.step}${w.octave}`;
      const current = memory.get(pos) ?? keyAlter(p.writtenKey, w.step);
      if (w.alter !== current && e.tieStop !== true) out.push(e.id);
      memory.set(pos, w.alter);
    }
  }
  return out;
}

/** The "Signs" highlight: the highest and lowest notes (03 `extremes`). */
export const extremeIds = (p: PreparedExcerpt): string[] => (p.extremes.highId === p.extremes.lowId ? [p.extremes.highId] : [p.extremes.highId, p.extremes.lowId]);

/** Rows ticked by the clock: row i ticks after (i + 1) / 5 of the scan time (30 s: every 6 s). */
export function autoTickedCount(remainingSec: number, totalSec: number): number {
  if (!(totalSec > 0)) return 0;
  const elapsed = Math.max(0, totalSec - remainingSec);
  const step = totalSec / STARS_ORDER.length;
  return Math.min(STARS_ORDER.length, Math.floor(elapsed / step + 1e-9));
}

/** A row is ticked by the player (a manual choice stands) or, failing that, by the clock. */
export function isTicked(index: number, auto: number, manual: ReadonlyMap<StarsId, boolean>): boolean {
  const id = STARS_ORDER[index] as StarsId;
  return manual.has(id) ? (manual.get(id) as boolean) : index < auto;
}

/** The row being worked on: the first one not ticked, or null. */
export function activeRow(auto: number, manual: ReadonlyMap<StarsId, boolean>): StarsId | null {
  for (let i = 0; i < STARS_ORDER.length; i++) if (!isTicked(i, auto, manual)) return STARS_ORDER[i] as StarsId;
  return null;
}

/** Seconds left shown as "Starting in N": only in the last 5 s of a ranked scan. */
export function startingInSeconds(mode: 'ranked' | 'practice', remainingSec: number): number | null {
  if (mode !== 'ranked') return null;
  const n = Math.ceil(remainingSec - 1e-9);
  return n >= 1 && n <= 5 ? n : null;
}

/** "Schubert (1797–1828) · Heidenröslein, D 257 · bars 1–8 · CC0" (04 section 5.5.1). */
export function creditLine(s: ExcerptSource): string {
  const title = s.catalog ? copy('credit.work', { title: s.work, catalog: s.catalog }) : copy('credit.workOnly', { title: s.work });
  const line = copy('credit.line', {
    composer: s.composer,
    dates: s.composerDates ?? '',
    work: title,
    a: s.sourceMeasures[0],
    b: s.sourceMeasures[1],
    licenceShort: copy(`licence.${s.license}`),
  });
  return s.composerDates ? line : line.replace(' ()', '');
}

/** The non-identifying source line of CC BY items (04 section 5.3), or null. */
export function sourceLine(s: ExcerptSource): string | null {
  return s.license === 'CC-BY-4.0' ? copy('credit.source', { encoder: s.encoder ?? s.corpus, corpus: s.corpus }) : null;
}

/** Accessible name of the toolbar overflow button. */
export const OVERFLOW_LABEL = copy('action.moreOptions');
