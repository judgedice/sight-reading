/**
 * Pure view models for History (04 section 5.8): filters kept in the URL query, local-day grouping, row detail.
 * No React and no store access.
 */
import type { AttemptRecord, AttemptSummary } from '../../../core/types.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { keyName } from '../setup/key-names.ts';
import { beatUnit } from '../setup/model.ts';

/** Rows loaded per page. Beyond it the list grows by "Show more" (not virtualised; see the package report). */
export const PAGE_SIZE = 100;

export interface HistoryFilter {
  instrumentId: string | null;
  rankedOnly: boolean;
  /** "This piece" (opened from results): only the tries at this excerpt. */
  excerptId?: string | null;
}

export const NO_FILTER: HistoryFilter = { instrumentId: null, rankedOnly: false, excerptId: null };

/** Reads `instrument`, `ranked=1` and `piece` from a hash or a query string. Unknown parameters are ignored. */
export function parseFilter(source: string): HistoryFilter {
  const q = source.includes('?') ? source.slice(source.indexOf('?') + 1) : source;
  const p = new URLSearchParams(q);
  const instrument = p.get('instrument');
  const piece = p.get('piece');
  return { instrumentId: instrument ? instrument : null, rankedOnly: p.get('ranked') === '1', excerptId: piece ? piece : null };
}

/** The query string for a filter: "" when nothing is set, else "?instrument=flute&ranked=1&piece=ex-1". */
export function filterQuery(f: HistoryFilter): string {
  const p = new URLSearchParams();
  if (f.instrumentId) p.set('instrument', f.instrumentId);
  if (f.rankedOnly) p.set('ranked', '1');
  if (f.excerptId) p.set('piece', f.excerptId);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function matchesFilter(row: Pick<AttemptSummary, 'instrumentId' | 'ranked'> & Partial<Pick<AttemptSummary, 'excerptId'>>, f: HistoryFilter): boolean {
  if (f.instrumentId !== null && row.instrumentId !== f.instrumentId) return false;
  if (f.excerptId && row.excerptId !== undefined && row.excerptId !== f.excerptId) return false;
  return !f.rankedOnly || row.ranked;
}

/** The ISO 8601 UTC bounds of a local calendar day (inclusive), for `AttemptQuery.from` and `to`. */
export function dayBounds(day: string): { from: string; to: string } {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const start = new Date(y, m - 1, d);
  const end = new Date(y, m - 1, d + 1);
  return { from: start.toISOString(), to: new Date(end.getTime() - 1).toISOString() };
}

/** "Today · 3 tries", or filtered to a piece "Today · 3 tries, 2 at this piece" (04-design §9). */
export function dayHeading(label: string, tries: number, atPiece: number | null): string {
  return atPiece === null ? copy('history.day', { day: label, n: tries }) : copy('history.day.piece', { day: label, n: tries, m: atPiece });
}

/** Where a try sits among the tries at its piece, oldest first: "Try 2 of 3", with its neighbours' ids. */
export interface TryPosition {
  n: number;
  total: number;
  previousId: string | null;
  nextId: string | null;
}

/**
 * The position of `id` among the tries at a piece (rows in any order). Tries are those that reached bar 1
 * (`isTry`); the try on screen always counts, so it has a place even when it stopped before the first note.
 */
export function tryPosition(rows: readonly Pick<AttemptSummary, 'id' | 'createdAt'>[], id: string, isTry: (id: string) => boolean): TryPosition | null {
  const ordered = rows.filter((r) => r.id === id || isTry(r.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const at = ordered.findIndex((r) => r.id === id);
  if (at < 0) return null;
  return { n: at + 1, total: ordered.length, previousId: ordered[at - 1]?.id ?? null, nextId: ordered[at + 1]?.id ?? null };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** The local calendar day of an ISO 8601 UTC instant, YYYY-MM-DD in the device's time zone. */
export function localDayOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `day` moved by `delta` calendar days (local arithmetic, so DST does not shift the date). */
export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

export interface DayGroup {
  day: string;
  rows: AttemptSummary[];
}

/** Consecutive rows on the same local day, in the order given (newest first from the repository). */
export function groupByDay(rows: readonly AttemptSummary[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const row of rows) {
    const day = localDayOf(row.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.rows.push(row);
    else groups.push({ day, rows: [row] });
  }
  return groups;
}

/** "Today", "Yesterday", or "Mon 16 Nov" (04 section 5.8). */
export function dayLabel(day: string, today: string): string {
  if (day === today) return copy('history.day.today');
  if (day === shiftDay(today, -1)) return copy('history.day.yesterday');
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Local HH:MM. */
export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export interface RowDetail {
  writtenKey: string;
  /** The meter the excerpt was served in, "4/4"; null when it cannot be told (never "random"). */
  meter: string | null;
  /** "♩ = 71" with the beat unit of the served meter. */
  tempo: string;
}

/** The excerpt's meter as a string, for a prepared excerpt's `{ beats, beatType }`. */
export function meterString(m: { beats: number; beatType: number }): string {
  return `${m.beats}/${m.beatType}`;
}

/**
 * The meter the take was served in (05 section 8.12: never "random"). The record keeps the settings as requested, so a
 * random meter is told from the prepared excerpt; null when neither is known.
 */
export function servedMeter(record: Pick<AttemptRecord, 'settingsResolved'>, prepared?: { meter: { beats: number; beatType: number } } | null): string | null {
  const asked = record.settingsResolved.meter;
  if (typeof asked === 'string' && asked !== 'random' && /^\d+\/\d+$/.test(asked)) return asked;
  return prepared ? meterString(prepared.meter) : null;
}

/** Written key, served meter and tempo from the full record. */
export function rowDetail(record: AttemptRecord, prepared?: { meter: { beats: number; beatType: number } } | null): RowDetail {
  const meter = servedMeter(record, prepared);
  return {
    writtenKey: keyName(record.writtenKey),
    meter,
    tempo: copy('tempo.marking', { unit: beatUnit(meter ?? '4/4'), bpm: record.bpm }),
  };
}

/** The pieces of "Baritone voice · Difficulty 2 · C major · 4/4 · ♩ = 71", in order; a meter that is not known is left out. */
export function metaParts(instrument: string, levelServed: number, detail: RowDetail): string[] {
  return [instrument, copy('progress.instrumentLevel', { level: levelServed }), detail.writtenKey, ...(detail.meter ? [detail.meter] : []), detail.tempo];
}

/** The whole meta line as text. */
export const metaLine = (parts: readonly string[]): string => parts.join(' \u00b7 ');

/** The excerpt's plain title: the work, with the movement when there is one (the same title the history row has). */
export function attemptTitle(record: Pick<AttemptRecord, 'credit'>): string {
  const c = record.credit;
  return c.movement ? `${c.work}: ${c.movement}` : c.work;
}
