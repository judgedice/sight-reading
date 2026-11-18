/**
 * Pure view models for History (04 section 5.8): filters kept in the URL query, local-day grouping, row detail.
 * No React and no store access.
 */
import type { AttemptRecord, AttemptSummary } from '../../../core/types.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { keyName } from '../setup/key-names.ts';
import { text } from './text.ts';

/** Rows loaded per page. Beyond it the list grows by "Show more" (not virtualised; see the package report). */
export const PAGE_SIZE = 100;

export interface HistoryFilter {
  instrumentId: string | null;
  rankedOnly: boolean;
}

export const NO_FILTER: HistoryFilter = { instrumentId: null, rankedOnly: false };

/** Reads `instrument` and `ranked=1` from a hash or a query string. Unknown parameters are ignored. */
export function parseFilter(source: string): HistoryFilter {
  const q = source.includes('?') ? source.slice(source.indexOf('?') + 1) : source;
  const p = new URLSearchParams(q);
  const instrument = p.get('instrument');
  return { instrumentId: instrument ? instrument : null, rankedOnly: p.get('ranked') === '1' };
}

/** The query string for a filter: "" when nothing is set, else "?instrument=flute&ranked=1". */
export function filterQuery(f: HistoryFilter): string {
  const p = new URLSearchParams();
  if (f.instrumentId) p.set('instrument', f.instrumentId);
  if (f.rankedOnly) p.set('ranked', '1');
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function matchesFilter(row: Pick<AttemptSummary, 'instrumentId' | 'ranked'>, f: HistoryFilter): boolean {
  if (f.instrumentId !== null && row.instrumentId !== f.instrumentId) return false;
  return !f.rankedOnly || row.ranked;
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
  meter: string;
  tempo: string;
}

/** Written key, meter and tempo from the full record. */
export function rowDetail(record: AttemptRecord): RowDetail {
  return {
    writtenKey: keyName(record.writtenKey),
    meter: record.settingsResolved.meter,
    tempo: text('history.tempo', { bpm: record.bpm }),
  };
}
