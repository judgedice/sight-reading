/** The results route (04 section 5.5): header, review slot, results panel, then the rank-up or install sheet. */
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { AttemptRecord } from '../../../core/types.ts';
import { Glyph, openOverlayCount } from '../../../ui/primitives/index.ts';
import { Link, useNavigate } from '../../router.tsx';
import type { ScreenProps } from '../../route-types.ts';
import { InstallCoach, installCoachDue } from '../sheets/InstallCoach.tsx';
import { RankUpCard } from '../sheets/RankUpCard.tsx';
import { creditLine, rankUpEvent } from './model.ts';
import { ResultsPanel } from './ResultsPanel.tsx';
import type { ResultsServices } from './services.ts';
import { text } from './text.ts';
import './results.css';

const Services = createContext<ResultsServices | null>(null);
export const ResultsServicesProvider = Services.Provider;

function useServices(): ResultsServices {
  const s = useContext(Services);
  if (!s) throw new Error('Results needs ResultsServicesProvider');
  return s;
}

function useReadable<T>(r: { get(): T; subscribe(l: () => void): () => void }): T {
  return useSyncExternalStore(r.subscribe, r.get, r.get);
}

export const DEFAULT_SETTLE_MS = 600;
/** Session states after Next or Try again: the practice routes follow the session from here. */
const MOVING_ON: ReadonlySet<string> = new Set(['loading', 'covered', 'scanning', 'count-in', 'performing']);
const POLL_MS = 100;

type Pending = 'rankup' | 'install' | null;

/**
 * One sheet per results visit: the rank-up card wins, the install coach never shares a visit with it, and either
 * waits until every other overlay has closed (04 section 5.10).
 */
function usePendingSheet(candidate: Pending, settleMs: number): Pending {
  const [open, setOpen] = useState<Pending>(null);
  useEffect(() => {
    if (!candidate) {
      setOpen(null);
      return undefined;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tryOpen = (): void => {
      if (openOverlayCount() === 0) {
        setOpen(candidate);
        return;
      }
      timer = setTimeout(tryOpen, POLL_MS);
    };
    timer = setTimeout(tryOpen, settleMs);
    return () => {
      if (timer !== null) clearTimeout(timer);
    };
  }, [candidate, settleMs]);
  return open === candidate ? open : null;
}

const isEditable = (t: EventTarget | null): boolean => {
  if (!(t instanceof HTMLElement)) return false;
  return /^(INPUT|SELECT|TEXTAREA|BUTTON|A)$/.test(t.tagName) || t.isContentEditable;
};

export function ResultsScreen(_props: ScreenProps) {
  const services = useServices();
  const navigate = useNavigate();
  const view = useSyncExternalStore(services.session.subscribe, services.session.getState, services.session.getState);
  const profile = useReadable(services.profile);
  const settings = useReadable(services.settings);
  const record: AttemptRecord | null = view.record;
  const cfg = services.configs;
  const actions = services.actions;
  const [rankSeen, setRankSeen] = useState<ReadonlySet<number>>(new Set());

  const rankUp = rankUpEvent(view.progress);
  const rankUpDue = rankUp !== null && !rankSeen.has(rankUp.to) && !(services.rankUps?.seen(rankUp.to) ?? false);
  const installDue = rankUp === null && installCoachDue(record, settings);
  const candidate: Pending = rankUpDue ? 'rankup' : installDue ? 'install' : null;
  const pending = usePendingSheet(candidate, services.settleMs ?? DEFAULT_SETTLE_MS);

  const next = (): void => {
    if (actions.next?.() === true) return;
    if (settings.practicePrefs.showTips && view.tips.length > 0 && record?.score) navigate('/practice/tips');
    else navigate('/practice/scan');
  };
  const tryAgain = (): void => {
    if (actions.tryAgain?.() !== true) navigate('/practice/scan');
  };
  const recalibrate = (): void => {
    if (actions.recalibrate) actions.recalibrate();
    else navigate('/calibrate');
  };

  useEffect(() => {
    // No take to show: Home. Next and Try again clear the record while the session moves on to the next excerpt or
    // the scan, which the scan route follows, so those states stay.
    if (!record && view.state !== 'finishing' && !MOVING_ON.has(view.state)) navigate('/', { replace: true });
  }, [record, view.state, navigate]);

  useEffect(() => {
    if (!settings.accessibility.keyboardShortcuts || !record) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || openOverlayCount() > 0) return;
      if (isEditable(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === 'n' || k === 'enter') {
        e.preventDefault();
        next();
      } else if (k === 'r') {
        e.preventDefault();
        tryAgain();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  if (!record) {
    return view.state === 'finishing' ? (
      <section className="res-screen" data-testid="screen-practice.results">
        <p className="res-scoring" role="status">
          {text('results.scoring')}
        </p>
      </section>
    ) : null;
  }

  const closeRankUp = (): void => {
    if (rankUp) {
      services.rankUps?.mark(rankUp.to);
      setRankSeen((prev) => new Set(prev).add(rankUp.to));
    }
  };
  const closeInstall = (): void => services.settings.set({ ...settings, shown: { ...settings.shown, installCoach: true } });

  const credit = creditLine(record.credit);
  return (
    <section className="res-screen" data-testid="screen-practice.results" data-route-id="practice.results">
      <header className="res-header">
        <Link to="/" className="res-back">
          <Glyph id="chevron-left" size={16} />
          <span>{text('nav.home')}</span>
        </Link>
        {actions.openSource ? (
          <button type="button" className="res-credit-button" onClick={() => actions.openSource?.(record)}>
            {credit}
          </button>
        ) : (
          <p className="res-credit">{credit}</p>
        )}
      </header>
      <div className="res-layout">
        <div className="res-review">{services.renderReview?.(record) ?? null}</div>
        <ResultsPanel
          record={record}
          configs={cfg}
          profile={profile}
          progress={view.progress}
          tips={view.tips}
          recalibrate={view.recalibrateRouteKey !== null}
          onNext={next}
          onTryAgain={tryAgain}
          onMoveUp={actions.moveUp}
          onStayAt={actions.stayAt}
          onUndoLevelUp={actions.undoLevelUp}
          onGoToLevel={actions.goToLevel}
          onRecalibrate={recalibrate}
          onCheckMicrophone={recalibrate}
        />
      </div>
      {rankUp ? <RankUpCard open={pending === 'rankup'} configs={cfg} rank={rankUp.to} name={rankUp.name} onContinue={closeRankUp} /> : null}
      <InstallCoach open={pending === 'install'} onGotIt={closeInstall} />
    </section>
  );
}
