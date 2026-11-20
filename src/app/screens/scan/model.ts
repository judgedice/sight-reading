/** Pure helpers for the scan screen (04 section 5.3): summary text, "Look before you play" rows, accidentals, credits. */
import type { Configs, ExcerptSource, KeySig, PreparedExcerpt } from '../../../core/types.ts';
import { countInBarsFor } from '../../../session/index.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { beatUnit } from '../setup/model.ts';
import { keyName } from '../setup/key-names.ts';

export type StarsId = 'signatures' | 'tempo' | 'accidentals' | 'rhythms' | 'signs';

/** The five "Look before you play" rows in order (02 section 7). */
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
  const accidentals = k.fifths === 0 ? copy('accidentals.none') : k.fifths < 0 ? copy('accidentals.flats', { n: -k.fifths }) : copy('accidentals.sharps', { n: k.fifths });
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

export interface LookRow {
  id: StarsId;
  label: string;
  fact: string;
  /** One short line of advice; null when there is nothing to do (no accidentals). */
  advice: string | null;
}

const ADVICE_KEY = {
  signatures: 'look.advice.signatures',
  tempo: 'look.advice.tempo',
  accidentals: 'look.advice.accidentals',
  rhythms: 'look.advice.rhythm',
  signs: 'look.advice.signs',
} as const;

const SIGN: Record<number, string> = { [-2]: '𝄫', [-1]: '♭', 0: '', 1: '♯', 2: '𝄪' };
const noteName = (w: { step: string; alter: number; octave: number }): string => `${w.step}${SIGN[w.alter] ?? ''}${w.octave}`;

/** The bar with the most notes (the first one on a tie), for the Rhythm row. */
export function busiestBar(p: PreparedExcerpt): { bar: number; notes: number } {
  let best = { bar: 1, notes: -1 };
  for (const m of p.measures) {
    const notes = m.events.filter((e) => e.kind === 'note').length;
    if (notes > best.notes) best = { bar: m.displayBar, notes };
  }
  return { bar: best.bar, notes: Math.max(0, best.notes) };
}

/**
 * The five rows of "Look before you play" for this piece (04 section 6): label, this piece's fact, one line of advice.
 * Accidentals with none in the music have no advice line.
 */
export function lookRows(p: PreparedExcerpt): LookRow[] {
  const notes = p.measures.flatMap((m) => m.events).filter((e): e is Extract<typeof e, { kind: 'note' }> => e.kind === 'note');
  const byId = new Map(notes.map((n) => [n.id, n] as const));
  const high = byId.get(p.extremes.highId);
  const low = byId.get(p.extremes.lowId);
  const last = notes[notes.length - 1];
  const accidentals = writtenAccidentalIds(p).length;
  const rhythm = busiestBar(p);
  const tempo = copy('tempo.marking', { unit: beatUnit(meterString(p)), bpm: p.selection.settings.bpm });
  const row = (id: StarsId, fact: string, advice: boolean = true): LookRow => ({
    id,
    label: copy(`look.label.${id === 'rhythms' ? 'rhythm' : id}` as 'look.label.tempo'),
    fact,
    advice: advice ? copy(ADVICE_KEY[id]) : null,
  });
  return [
    row('signatures', signatureDetail(p)),
    row('tempo', copy('look.fact.tempo', { tempo })),
    row('accidentals', accidentals === 0 ? copy('look.fact.accidentals.none') : copy('look.fact.accidentals.some', { n: accidentals }), accidentals > 0),
    row('rhythms', copy('look.fact.rhythm', { bar: rhythm.bar, n: rhythm.notes })),
    row('signs', high && low && last ? copy('look.fact.shape', { low: noteName(low.writtenPitch), high: noteName(high.writtenPitch), last: noteName(last.writtenPitch) }) : '', Boolean(high && low && last)),
  ];
}

/**
 * What plays on Start, for the Sounds line (04 section 12): a voice hears its starting pitch (when the setting is on),
 * then the count-in clicks; an instrument hears the clicks.
 */
export function onStartLine(p: PreparedExcerpt, cfg: Configs, voice: boolean, startingPitch: boolean): string {
  const bars = countInBarsFor(cfg, p.levelServed, p.selection.settings.bpm);
  const withPitch = voice && startingPitch;
  // Two bars is what difficulties 1 to 3 count in; its sentence is written out ("two bars of clicks").
  if (bars === 2) return copy(withPitch ? 'scan.sounds.whenStart.voice' : 'scan.sounds.whenStart.instrument');
  return copy(withPitch ? 'scan.sounds.onStart.voice' : 'scan.sounds.onStart.instrument', { bars });
}
