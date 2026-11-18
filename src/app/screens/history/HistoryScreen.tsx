/** The history route (04 section 5.8): takes grouped by local day, with the instrument and ranked filters in the URL. */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { AttemptRecord, AttemptSummary } from '../../../core/types.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { Button, Select, Toggle } from '../../../ui/components/form/index.ts';
import { EmptyState, GradeBadge } from '../../../ui/components/domain/index.ts';
import { Link, useNavigate } from '../../router.tsx';
import type { ScreenProps } from '../../route-types.ts';
import { PAGE_SIZE, dayLabel, filterQuery, groupByDay, matchesFilter, parseFilter, rowDetail, timeLabel, type HistoryFilter, type RowDetail } from './model.ts';
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

function HistoryRow({ row, detail, instrumentName }: { row: AttemptSummary; detail: RowDetail | undefined; instrumentName: string }) {
  const score = row.score === null ? null : Math.round(row.score);
  return (
    <li className="hist-item">
      <Link to={`/history/${encodeURIComponent(row.id)}`} className="hist-row" data-testid="history-row">
        <span className="hist-grade">
          {row.grade && score !== null ? (
            <GradeBadge grade={row.grade} score={score} size={32} />
          ) : (
            <span className="hist-grade-none" aria-label={copy('history.notGraded')}>
              {'–'}
            </span>
          )}
        </span>
        <span className="hist-main">
          <span className="hist-line hist-line-top">
            <span className="hist-score">{score === null ? '–' : score}</span>
            <span className="hist-title" title={row.title}>
              {row.title}
            </span>
          </span>
          <span className="hist-line hist-composer" title={row.composer}>
            {row.composer}
          </span>
          <span className="hist-line hist-meta">
            <span>{instrumentName}</span>
            <span>{copy('progress.instrumentLevel', { level: row.levelServed })}</span>
            {detail ? <span>{detail.writtenKey}</span> : null}
            {detail ? <span>{detail.meter}</span> : null}
            {detail ? <span>{detail.tempo}</span> : null}
          </span>
        </span>
        <span className="hist-side">
          <span className="hist-chip" data-ranked={row.ranked ? 'true' : 'false'}>
            {row.ranked ? copy('badge.ranked') : copy('badge.practice')}
          </span>
          <time className="hist-time" dateTime={row.createdAt}>
            {timeLabel(row.createdAt)}
          </time>
        </span>
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

  // Each filter change starts from page one; "Show more" appends the next page. A stale result is dropped.
  useEffect(() => {
    let live = true;
    const { instrumentId, rankedOnly } = filter;
    services.repos.attempts
      .list({
        ...(instrumentId !== null ? { instrumentId } : {}),
        ...(rankedOnly ? { rankedOnly: true } : {}),
        limit: PAGE_SIZE,
        offset: pages * PAGE_SIZE,
      })
      .then(async (page) => {
        const rows = page.filter((r) => matchesFilter(r, filter));
        const records = await Promise.all(page.map((r) => services.repos.attempts.byId(r.id)));
        if (!live) return;
        const details: Record<string, RowDetail> = {};
        records.forEach((rec: AttemptRecord | undefined, i) => {
          if (rec && page[i]) details[page[i].id] = rowDetail(rec);
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
  }, [filter, pages, services]);

  const update = (next: HistoryFilter): void => {
    setFilter(next);
    setPages(0);
    setLoaded(null);
    navigate(`/history${filterQuery(next)}`, { replace: true });
  };

  const instrumentLabel = (id: string): string => services.configs.instrumentById[id]?.label ?? id;
  const groups = useMemo(() => groupByDay(loaded?.rows ?? []), [loaded]);
  const filtered = filter.instrumentId !== null || filter.rankedOnly;
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
        <Toggle checked={filter.rankedOnly} label={copy('history.filter.rankedOnly')} onChange={(v) => update({ ...filter, rankedOnly: v })} />
      </div>

      {failed ? <p role="alert">{text('history.error')}</p> : null}
      {!loaded && !failed ? <p role="status">{text('history.loading')}</p> : null}

      {loaded && loaded.rows.length === 0 ? (
        filtered ? (
          <EmptyState
            icon="info"
            title={copy('empty.historyFiltered.title')}
            body={copy('empty.historyFiltered.body')}
            action={<Button label={text('history.filter.clear')} variant="tertiary" onClick={() => update({ instrumentId: null, rankedOnly: false })} />}
          />
        ) : (
          <EmptyState icon="mic" title={copy('empty.history.title')} body={copy('empty.history.body')} />
        )
      ) : null}

      {groups.map((g) => (
        <section key={g.day} className="hist-day" aria-label={dayLabel(g.day, today)}>
          <h2 className="hist-day-heading">{dayLabel(g.day, today)}</h2>
          <ol className="hist-list">
            {g.rows.map((r) => (
              <HistoryRow key={r.id} row={r} detail={loaded?.details[r.id]} instrumentName={instrumentLabel(r.instrumentId)} />
            ))}
          </ol>
        </section>
      ))}

      {loaded?.more ? (
        <div className="hist-more">
          <Button label={text('history.more')} variant="secondary" onClick={() => setPages((p) => p + 1)} />
        </div>
      ) : null}
    </section>
  );
}

