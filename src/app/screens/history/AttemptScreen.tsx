/**
 * Attempt detail (05 section 8.12): a plain title, the take's one-line summary, the marked score read-only with Listen
 * and Slower, the results read-only and the credit line with the source sheet.
 */
import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { AttemptRecord, AttributionsFile, PreparedExcerpt } from '../../../core/types.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { instrumentName } from '../../../ui/copy/instrument-names.ts';
import { Card } from '../../../ui/components/containers/index.ts';
import { GradeBadge } from '../../../ui/components/domain/index.ts';
import { Link } from '../../router.tsx';
import type { ScreenProps } from '../../route-types.ts';
import { SourceSheet } from '../about/SourceSheet.tsx';
import { text as aboutText } from '../about/text.ts';
import { creditLine } from '../results/model.ts';
import type { ReviewExtras } from '../results/review/index.ts';
import { Summary } from './Summary.tsx';
import { ListenControls, useAttemptSound } from './ListenControls.tsx';
import { MetaLine } from './MetaLine.tsx';
import { attemptTitle, dayLabel, localDayOf, rowDetail, timeLabel } from './model.ts';
import type { HistoryServices } from './services.ts';
import { text } from './text.ts';
import './history.css';

/**
 * What attempt detail needs beyond `HistoryServices`: the marked score. The composition root builds it the way it does
 * for results (`createReviewRenderer`), reading the excerpt `preparedFor` resolved. Without it, Listen still shows.
 */
export interface AttemptServices extends HistoryServices {
  /** The read-only review for this take: the score with the toolbar's right end and the bar wash. Called once `preparedFor` has resolved. */
  renderReview?(record: AttemptRecord, extras: ReviewExtras): ReactNode;
}

const Services = createContext<AttemptServices | null>(null);
export const AttemptServicesProvider = Services.Provider;

function useServices(): AttemptServices {
  const s = useContext(Services);
  if (!s) throw new Error('Attempt detail needs AttemptServicesProvider');
  return s;
}

const NO_PROFILE = { get: () => undefined, subscribe: () => () => undefined };

/** `undefined` while loading, `null` when the take is not on this device, `'error'` when it could not be read. */
type Found = AttemptRecord | null | 'error' | undefined;
/** `undefined` while loading, `null` when the excerpt is withdrawn or prepares differently. */
type Prepared = PreparedExcerpt | null | undefined;

function Shell({ children }: { children: ReactNode }) {
  return (
    <section className="hist-attempt" data-testid="screen-history.attempt" data-route-id="history.attempt">
      {children}
    </section>
  );
}

export function AttemptScreen({ route }: ScreenProps) {
  const services = useServices();
  const id = route.params['attemptId'] ?? '';
  const profileStore = services.profile ?? NO_PROFILE;
  const profile = useSyncExternalStore(profileStore.subscribe, profileStore.get, profileStore.get);
  const [record, setRecord] = useState<Found>(undefined);
  const [prepared, setPrepared] = useState<Prepared>(undefined);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [attributions, setAttributions] = useState<AttributionsFile | null>(null);
  const [slower, setSlower] = useState(false);
  const [startBar, setStartBar] = useState<number | null>(null);
  const sound = useAttemptSound(services.sounds, id);

  useEffect(() => {
    let live = true;
    setRecord(undefined);
    setPrepared(undefined);
    setStartBar(null);
    setSlower(false);
    services.repos.attempts.byId(id).then(
      (r) => live && setRecord(r ?? null),
      () => live && setRecord('error'),
    );
    return () => {
      live = false;
    };
  }, [id, services]);

  // The excerpt as it was served: for the marked score, the served meter and Listen.
  useEffect(() => {
    if (!record || record === 'error') return undefined;
    let live = true;
    if (!services.preparedFor) {
      setPrepared(null);
      return undefined;
    }
    services.preparedFor(record).then(
      (p) => live && setPrepared(p),
      () => live && setPrepared(null),
    );
    return () => {
      live = false;
    };
  }, [record, services]);

  // The attributions file loads the first time the sheet opens.
  useEffect(() => {
    if (!sheetOpen || attributions || !services.loadAttributions) return undefined;
    let live = true;
    services.loadAttributions().then(
      (a) => live && setAttributions(a),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [sheetOpen, attributions, services]);

  // Leaving the screen stops the sound (05 section 9.3).
  const stopSounds = services.stopSounds;
  useEffect(() => () => stopSounds?.(), [stopSounds, id]);

  const listen = useCallback(
    (rec: AttemptRecord, o: { slower: boolean; fromBar: number | null }) => {
      const run = services.listen;
      if (!run) return;
      run(rec, { slower: o.slower, ...(o.fromBar !== null ? { fromBar: o.fromBar } : {}) }).catch(() => undefined);
    },
    [services],
  );

  if (record === undefined) {
    return (
      <Shell>
        <p role="status">{text('history.loading')}</p>
      </Shell>
    );
  }
  if (record === 'error') {
    return (
      <Shell>
        <p role="alert">{text('history.error')}</p>
        <Link to="/history">{text('history.backToList')}</Link>
      </Shell>
    );
  }
  if (record === null) {
    return (
      <Shell>
        <p>{text('history.notFound')}</p>
        <Link to="/history">{text('history.backToList')}</Link>
      </Shell>
    );
  }

  const inst = services.configs.instrumentById[record.instrumentId];
  const detail = rowDetail(record, prepared);
  const playing = sound.playing === 'listen' || sound.playing === 'bar';
  const measures = prepared?.measures ?? [];
  const indexOfBar = (bar: number | null): number | null => {
    if (bar === null) return null;
    const i = measures.findIndex((m) => m.displayBar === bar);
    return i >= 0 ? i : null;
  };
  const highlight = indexOfBar(playing ? sound.bar : startBar);
  const onBarTap = (index: number): void => {
    // A tap sets where Listen starts, only while nothing plays.
    if (playing) return;
    const bar = measures[index]?.displayBar;
    if (bar !== undefined) setStartBar(bar);
  };
  const canListen = prepared !== undefined && prepared !== null && services.listen !== undefined;
  const controls = canListen ? (
    <ListenControls
      sound={sound}
      slower={slower}
      fromBar={startBar}
      meter={detail.meter}
      onSlower={(v) => {
        setSlower(v);
        if (playing) listen(record, { slower: v, fromBar: sound.fromBar ?? startBar });
      }}
      onListen={() => listen(record, { slower, fromBar: startBar })}
      onStop={() => services.stopSounds?.()}
    />
  ) : null;
  const review = prepared && services.renderReview ? services.renderReview(record, { highlightBar: highlight, onBarTap, ...(controls ? { toolbarEnd: controls } : {}) }) : null;

  const day = localDayOf(record.createdAt);
  const when = `${dayLabel(day, services.localDay())}, ${timeLabel(record.createdAt)}`;
  const status = record.score === null ? 'not-graded' : record.score.ranked ? 'ranked' : 'practice';
  const playAgain = services.playAgain;
  const credit = creditLine(record.credit);

  return (
    <Shell>
      <header className="hist-attempt-head">
        <Link to="/history" className="hist-back">
          {copy('common.back')}
        </Link>
      </header>
      <div className="hist-attempt-titles">
        <h1 className="hist-attempt-title" data-testid="attempt-title">
          {attemptTitle(record)}
        </h1>
        <p className="hist-attempt-composer">{record.credit.composerDates ? `${record.credit.composer} (${record.credit.composerDates})` : record.credit.composer}</p>
        <p className="hist-attempt-meta">
          <MetaLine instrument={inst ? instrumentName(inst) : record.instrumentId} levelServed={record.levelServed} detail={detail} />
        </p>
        <p className="hist-attempt-when">
          <GradeBadge kind={status} />
          <time dateTime={record.createdAt}>{when}</time>
        </p>
      </div>

      {review ? (
        <Card className="hist-score-card">{review}</Card>
      ) : controls ? (
        <Card className="hist-score-card hist-score-bare">{controls}</Card>
      ) : null}

      <Summary record={record} configs={services.configs} profile={profile} {...(playAgain ? { onPlayAgain: () => playAgain(record) } : {})} />

      <button type="button" className="hist-credit" aria-label={`${credit}. ${aboutText('source.open')}`} onClick={() => setSheetOpen(true)}>
        {credit}
      </button>
      <SourceSheet open={sheetOpen} record={record} configs={services.configs} attributions={attributions} onClose={() => setSheetOpen(false)} />
    </Shell>
  );
}
