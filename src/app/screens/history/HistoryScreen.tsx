/**
 * The history route (04 section 5.8, round 2 04-design §9): tries grouped by local day, each day headed with its count
 * of tries (`compose/tries.ts`, the count Practice and the streak line show), with the instrument, ranked and "This
 * piece" filters in the URL.
 */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { AttemptQuery, AttemptRecord, AttemptSummary } from '../../../core/types.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { Button, Select, Toggle } from '../../../ui/components/form/index.ts';
import { EmptyState } from '../../../ui/components/domain/index.ts';
import { Glyph } from '../../../ui/primitives/index.ts';
import { countTries, reachedBarOne, type TryFacts } from '../../compose/tries.ts';
import { Link, useNavigate } from '../../router.tsx';
import type { ScreenProps } from '../../route-types.ts';
import { instrumentName } from '../../../ui/copy/instrument-names.ts';
import { MetaLine } from './MetaLine.tsx';
import { rowTitle } from '../scales/index.ts';
import { isScaleExcerptId } from '../../../session/index.ts';
import { PAGE_SIZE, dayBounds, dayHeading, dayLabel, localDayOf, filterQuery, groupByDay, matchesFilter, parseFilter, rowDetail, servedMeter, timeLabel, type HistoryFilter, type KindFilter, type RowDetail } from './model.ts';
import type { HistoryServices } from './services.ts';
import { text } from './text.ts';
import './history.css';

const Services = createContext<HistoryServices | null>(null);
export const HistoryServicesProvider = Services.Provider;

function useServices(): HistoryServices {
  const s = useContext(Services);
  if (!s) throw new Error('History needs HistoryServicesProvider');
  return s;
}

/** The filter query the browser shows; read once, on mount. Empty outside a browser. */
function currentQuery(): string {
  return typeof window === 'undefined' ? '' : window.location.hash;
}

interface Loaded {
  rows: AttemptSummary[];
  details: Record<string, RowDetail>;
  /** More pages may follow. */
  more: boolean;
}

/** The attempt list with the screen's filter: the service's `list` when wired, else the repository. */
export function listOf(services: HistoryServices): (q: AttemptQuery) => Promise<AttemptSummary[]> {
  return services.list ?? ((q) => services.repos.attempts.list(q));
}

/** Tries among rows: a summary does not say why a try was void, so only the voids are read in full. */
export async function triesIn(services: HistoryServices, rows: readonly AttemptSummary[]): Promise<number> {
  const facts: TryFacts[] = await Promise.all(rows.map(async (r) => (r.endReason === 'void' ? ((await services.repos.attempts.byId(r.id)) ?? r) : r)));
  return countTries(facts);
}

/** Per local day: tries on the device that day (every instrument and mode), and at the filtered piece. */
interface DayCount {
  tries: number;
  atPiece: number | null;
}

/** "Showing 2 of 4 tries: the ones at Melody in F major." */
interface PieceLine {
  n: number;
  total: number;
  title: string;
}

function HistoryRow({ row, detail, instrumentLabel }: { row: AttemptSummary; detail: RowDetail | undefined; instrumentLabel: string }) {
  const score = row.score === null ? null : Math.round(row.score);
  const graded = row.grade !== null && score !== null;
  const scale = row.kind === 'scale';
  const title = rowTitle(row);
  return (
    <li className="hist-item">
      <Link to={`/history/${encodeURIComponent(row.id)}`} className="hist-row" data-testid="history-row" data-graded={graded ? 'true' : 'false'} data-kind={scale ? 'scale' : 'excerpt'}>
        <span className="hist-grade" data-testid="history-grade">
          {graded ? (
            <>
              <span className="hist-grade-letter-sm">{row.grade}</span>
              <span className="hist-grade-score-sm">{score}</span>
            </>
          ) : (
            <span className="hist-grade-none">{copy('history.notGraded')}</span>
          )}
        </span>
        <span className="hist-main">
          <span className="hist-line hist-title" title={row.composer && !scale ? `${title}, ${row.composer}` : title}>
            {title}
          </span>
          {detail ? <MetaLine className="hist-line hist-meta" instrument={instrumentLabel} levelServed={row.levelServed} detail={detail} scale={scale} /> : null}
        </span>
        <span className="hist-side">
          <time className="hist-time" dateTime={row.createdAt}>
            {timeLabel(row.createdAt)}
          </time>
          <span aria-hidden="true">{' \u00b7 '}</span>
          <span className="hist-mode">{copy(row.ranked ? 'badge.ranked' : 'badge.practice')}</span>
        </span>
        <Glyph id="chevron-right" size={16} className="hist-chevron" />
      </Link>
    </li>
  );
}

export function HistoryScreen(_props: ScreenProps) {
  const services = useServices();
  const navigate = useNavigate();
  const today = services.localDay();
  const [filter, setFilter] = useState<HistoryFilter>(() => parseFilter(currentQuery()));
  const [pages, setPages] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [dayCounts, setDayCounts] = useState<Record<string, DayCount>>({});
  const [pieceLine, setPieceLine] = useState<PieceLine | null>(null);
  const piece = filter.excerptId ?? null;

  // Each filter change starts from page one; "Show more" appends the next page. A stale result is dropped.
  useEffect(() => {
    let live = true;
    const { instrumentId, rankedOnly } = filter;
    listOf(services)({
      ...(instrumentId !== null ? { instrumentId } : {}),
      ...(rankedOnly ? { rankedOnly: true } : {}),
      ...(piece !== null ? { excerptId: piece } : {}),
      ...(filter.kind === 'scale' || filter.kind === 'excerpt' ? { kind: filter.kind } : {}),
      limit: PAGE_SIZE,
      offset: pages * PAGE_SIZE,
    })
      .then(async (page) => {
        const records = await Promise.all(page.map((r) => services.repos.attempts.byId(r.id)));
        // Only tries are listed: one stopped before bar 1 is not a try, and the day heading would not count it.
        const rows = page.filter((r, i) => matchesFilter(r, filter) && reachedBarOne(records[i] ?? r));
        // A take asked for a random meter keeps that request; the meter served comes from its excerpt.
        const served = await Promise.all(
          records.map((rec) =>
            rec && servedMeter(rec) === null && services.preparedFor ? services.preparedFor(rec).catch(() => null) : Promise.resolve(null),
          ),
        );
        if (!live) return;
        const details: Record<string, RowDetail> = {};
        records.forEach((rec: AttemptRecord | undefined, i) => {
          if (rec && page[i]) details[page[i].id] = rowDetail(rec, served[i]);
        });
        setLoaded((prev) => {
          const base = pages === 0 || !prev ? [] : prev.rows;
          const prevDetails = pages === 0 || !prev ? {} : prev.details;
          return { rows: [...base, ...rows], details: { ...prevDetails, ...details }, more: page.length === PAGE_SIZE };
        });
        setFailed(false);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [filter, pages, services, piece]);

  const groups = useMemo(() => groupByDay(loaded?.rows ?? []), [loaded]);
  const days = useMemo(() => groups.map((g) => g.day).join(','), [groups]);

  // Each day heading counts the tries on the device that day, whatever the filters (the Practice header's count).
  useEffect(() => {
    if (days === '') return undefined;
    let live = true;
    const list = listOf(services);
    Promise.all(
      days.split(',').map(async (day): Promise<[string, DayCount]> => {
        // Filtered here too: a store may answer with more than the bounds asked for.
        const rows = (await list(dayBounds(day))).filter((r) => localDayOf(r.createdAt) === day);
        const tries = await triesIn(services, rows);
        const atPiece = piece === null ? null : await triesIn(services, rows.filter((r) => r.excerptId === piece));
        return [day, { tries, atPiece }];
      }),
    ).then(
      (entries) => live && setDayCounts(Object.fromEntries(entries)),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [days, piece, services]);

  // "Showing 2 of 4 tries: the ones at {title}." under the "This piece" chip.
  useEffect(() => {
    if (piece === null) {
      setPieceLine(null);
      return undefined;
    }
    let live = true;
    const list = listOf(services);
    Promise.all([list({}), list({ excerptId: piece })])
      .then(async ([all, maybe]) => {
        const at = maybe.filter((r) => r.excerptId === piece);
        const [total, n] = await Promise.all([triesIn(services, all), triesIn(services, at)]);
        if (live) setPieceLine({ n, total, title: at[0] ? rowTitle(at[0]) : '' });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [piece, services]);

  const update = (next: HistoryFilter): void => {
    setFilter(next);
    setPages(0);
    setLoaded(null);
    navigate(`/history${filterQuery(next)}`, { replace: true });
  };
  const allTries = (): void => update({ ...filter, excerptId: null });

  const instrumentLabel = (id: string): string => {
    const inst = services.configs.instrumentById[id];
    return inst ? instrumentName(inst) : id;
  };
  const kind: KindFilter = filter.kind ?? 'all';
  const filtered = filter.instrumentId !== null || filter.rankedOnly || piece !== null || kind !== 'all';
  const pieceIsScale = piece !== null && isScaleExcerptId(piece);
  const kindOptions = useMemo(
    () => [
      { value: 'all', label: copy('history.filter.kind.all') },
      { value: 'excerpt', label: copy('history.filter.kind.pieces') },
      { value: 'scale', label: copy('history.filter.kind.scales') },
    ],
    [],
  );
  const instrumentOptions = useMemo(
    () => [
      { value: '', label: text('history.filter.all') },
      ...Object.values(services.configs.instrumentById).map((i) => ({ value: i.id, label: i.label })),
    ],
    [services.configs],
  );

  return (
    <section className="hist-screen" data-testid="screen-history" data-route-id="history">
      <h1 className="hist-title-page">{copy('nav.history')}</h1>

      <div className="hist-filters" role="group" aria-label={copy('nav.history')}>
        <Select
          options={instrumentOptions}
          value={filter.instrumentId ?? ''}
          ariaLabel={copy('history.filter.instrument')}
          onChange={(v) => update({ ...filter, instrumentId: v === '' ? null : v })}
        />
        {/* Pieces or scales (PLAN ruling 68): scale tries are drill, kept apart from the music on request. */}
        <Select
          options={kindOptions}
          value={kind}
          ariaLabel={copy('history.filter.kind')}
          onChange={(v) => update({ ...filter, kind: v === 'scale' || v === 'excerpt' ? v : 'all' })}
        />
        <Toggle checked={filter.rankedOnly} label={copy('history.filter.rankedOnly')} onChange={(v) => update({ ...filter, rankedOnly: v })} />
        {piece !== null ? (
          <button type="button" className="hist-chip" data-testid="history-piece-chip" aria-pressed="true" onClick={allTries}>
            <span>{copy(pieceIsScale ? 'history.filter.scale' : 'history.filter.piece')}</span>
            <Glyph id="x" size={14} />
            <span className="ui-visually-hidden">{text('history.filter.clear')}</span>
          </button>
        ) : null}
      </div>

      {piece !== null && pieceLine ? (
        <p className="hist-piece-line" data-testid="history-piece-line">
          {copy('history.filter.pieceLine', { n: pieceLine.n, total: pieceLine.total, title: pieceLine.title })}{' '}
          <button type="button" className="hist-link" onClick={allTries}>
            {text('history.filter.clear')}
          </button>
        </p>
      ) : null}

      {failed ? <p role="alert">{text('history.error')}</p> : null}
      {!loaded && !failed ? <p role="status">{text('history.loading')}</p> : null}

      {loaded && loaded.rows.length === 0 ? (
        filtered ? (
          <EmptyState
            icon="info"
            title={copy('empty.historyFiltered.title')}
            body={copy('empty.historyFiltered.body')}
            action={<Button label={text('history.filter.clear')} variant="tertiary" onClick={() => update({ instrumentId: null, rankedOnly: false, excerptId: null, kind: 'all' })} />}
          />
        ) : (
          <EmptyState icon="mic" title={copy('empty.history.title')} body={copy('empty.history.body')} />
        )
      ) : null}

      {groups.map((g) => {
        const label = dayLabel(g.day, today);
        const count = dayCounts[g.day];
        const heading = count ? dayHeading(label, count.tries, count.atPiece, pieceIsScale) : label;
        return (
          <section key={g.day} className="hist-day" aria-label={heading}>
            <h2 className="hist-day-heading" data-testid="history-day-heading">
              {heading}
            </h2>
            <ol className="hist-list">
              {g.rows.map((r) => (
                <HistoryRow key={r.id} row={r} detail={loaded?.details[r.id]} instrumentLabel={instrumentLabel(r.instrumentId)} />
              ))}
            </ol>
          </section>
        );
      })}

      {loaded?.more ? (
        <div className="hist-more">
          <Button label={text('history.more')} variant="secondary" onClick={() => setPages((p) => p + 1)} />
        </div>
      ) : null}
    </section>
  );
}
