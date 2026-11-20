/**
 * Try detail (05 section 8.12; round 2 01-ux §5.3, 04-design §9): a plain title, the try's one-line summary, "Try n of
 * m at this piece" with previous and next, the marked score read-only with "Show what we heard", Slower, Listen and
 * "Hear what we heard" (its caption on a reserved line under the toolbar), the results read-only with the sure line and
 * diagnostics, and the credit line with the source sheet.
 */
import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { AttemptRecord, AttributionsFile, PreparedExcerpt } from '../../../core/types.ts';
import { Glyph } from '../../../ui/primitives/index.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { instrumentName } from '../../../ui/copy/instrument-names.ts';
import { Card } from '../../../ui/components/containers/index.ts';
import { GradeBadge } from '../../../ui/components/domain/index.ts';
import { Link, useNavigate } from '../../router.tsx';
import type { ScreenProps } from '../../route-types.ts';
import { SourceSheet } from '../about/SourceSheet.tsx';
import { text as aboutText } from '../about/text.ts';
import { creditLine } from '../results/model.ts';
import type { HeardTraceSource, ReviewExtras } from '../results/review/index.ts';
import { reachedBarOne } from '../../compose/tries.ts';
import { Summary } from './Summary.tsx';
import { ListenControls, SoundCaptionLine, isHearing, isListening, soundAnnouncement, useAttemptSound } from './ListenControls.tsx';
import { patternLine, tryTitle } from '../scales/index.ts';
import { MetaLine } from './MetaLine.tsx';
import { dayLabel, localDayOf, rowDetail, timeLabel, tryPosition, type TryPosition } from './model.ts';
import { listOf } from './HistoryScreen.tsx';
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
  const [position, setPosition] = useState<TryPosition | null>(null);
  const [heardNone, setHeardNone] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let live = true;
    setRecord(undefined);
    setPrepared(undefined);
    setStartBar(null);
    setSlower(false);
    setHeardNone(false);
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

  // "Try n of m at this piece": the tries at this piece, oldest first (a void is read in full to tell a try).
  useEffect(() => {
    if (!record || record === 'error') return undefined;
    let live = true;
    const excerptId = record.excerptId;
    listOf(services)({ excerptId })
      .then(async (all) => {
        const rows = all.filter((r) => r.excerptId === excerptId);
        const voids = await Promise.all(rows.filter((r) => r.endReason === 'void').map((r) => services.repos.attempts.byId(r.id)));
        const notTries = new Set(voids.filter((v): v is AttemptRecord => !!v && !reachedBarOne(v)).map((v) => v.id));
        if (live) setPosition(tryPosition(rows, record.id, (rid) => !notTries.has(rid)));
      })
      .catch(() => live && setPosition(null));
    return () => {
      live = false;
    };
  }, [record, services]);

  // "Show what we heard": the try's stored trace, from its diagnostics file (the last 20 tries keep one).
  const diagnostics = services.diagnostics;
  const loadTrace = useCallback(
    async (attemptId: string): Promise<HeardTraceSource | null> => {
      const out = await diagnostics?.exportTry(attemptId);
      return out?.file.tries.find((t) => t.attemptId === attemptId) ?? out?.file.tries[0] ?? null;
    },
    [diagnostics],
  );

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

  const hear = useCallback(
    (rec: AttemptRecord) => {
      const run = services.playHeard;
      if (!run) return;
      setHeardNone(false);
      run(rec.id).catch((e: unknown) => {
        if (e instanceof Error && e.message.includes('no-notes')) setHeardNone(true);
      });
    },
    [services],
  );

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
  const playing = isListening(sound);
  const sounding = playing || isHearing(sound);
  const measures = prepared?.measures ?? [];
  const indexOfBar = (bar: number | null): number | null => {
    if (bar === null) return null;
    const i = measures.findIndex((m) => m.displayBar === bar);
    return i >= 0 ? i : null;
  };
  const highlight = indexOfBar(sounding ? sound.bar : startBar);
  const onBarTap = (index: number): void => {
    // A tap sets where Listen starts, only while nothing plays.
    if (sounding) return;
    const bar = measures[index]?.displayBar;
    if (bar !== undefined) setStartBar(bar);
  };
  const canListen = prepared !== undefined && prepared !== null && services.listen !== undefined;
  const controls = canListen ? (
    <ListenControls
      sound={sound}
      slower={slower}
      onSlower={(v) => {
        setSlower(v);
        if (playing) listen(record, { slower: v, fromBar: sound.fromBar ?? startBar });
      }}
      onListen={() => listen(record, { slower, fromBar: startBar })}
      onStop={() => services.stopSounds?.()}
      onHear={services.playHeard ? () => hear(record) : undefined}
    />
  ) : null;
  // The reserved line under the toolbar says what is sounding; when quiet it is left to the review (the trace's key).
  const announce = soundAnnouncement(sound, startBar, detail.meter, heardNone);
  const captionActive = sound.playing !== null || sound.failed || announce !== '';
  const caption = canListen && captionActive ? <SoundCaptionLine sound={sound} fromBar={startBar} meter={detail.meter} heardNone={heardNone} /> : null;
  const review =
    prepared && services.renderReview
      ? services.renderReview(record, {
          highlightBar: highlight,
          onBarTap,
          // The note sounding glows during Listen, Hear bars and Hear what we heard of this try.
          sounding: sound.notes ?? null,
          ...(controls ? { toolbarEnd: controls } : {}),
          ...(caption ? { caption } : {}),
          reserveCaption: true,
          ...(diagnostics ? { loadTrace } : {}),
        })
      : null;

  const day = localDayOf(record.createdAt);
  const when = `${dayLabel(day, services.localDay())}, ${timeLabel(record.createdAt)}`;
  const status = record.score === null ? 'not-graded' : record.score.ranked ? 'ranked' : 'practice';
  const playAgain = services.playAgain;
  const scale = record.kind === 'scale';
  const credit = creditLine(record.credit);
  const measured = record.calibration.method === 'loopback' || record.calibration.method === 'play-along';
  const go = (to: string | null): void => {
    if (to) navigate(`/history/${encodeURIComponent(to)}`);
  };

  return (
    <Shell>
      <header className="hist-attempt-head">
        <Link to="/history" className="hist-back">
          <Glyph id="chevron-left" size={16} />
          <span>{copy('nav.history')}</span>
        </Link>
      </header>
      <div className="hist-attempt-top">
      <div className="hist-attempt-titles">
        <h1 className="hist-attempt-title" data-testid="attempt-title">
          {tryTitle(record)}
        </h1>
        {/* A scale has no composer: its pattern stands there ("Do re mi fa sol, and back down", PLAN ruling 68). */}
        <p className="hist-attempt-composer">
          {scale ? (patternLine(record.scale?.pattern ?? '') ?? '') : record.credit.composerDates ? `${record.credit.composer} (${record.credit.composerDates})` : record.credit.composer}
        </p>
        <p className="hist-attempt-meta">
          <MetaLine instrument={inst ? instrumentName(inst) : record.instrumentId} levelServed={record.levelServed} detail={detail} scale={scale} />
        </p>
        <p className="hist-attempt-when">
          <GradeBadge kind={status} />
          <time dateTime={record.createdAt}>{when}</time>
          {record.score && !measured ? <span className="hist-timing-note">{copy('badge.timingOffset')}</span> : null}
        </p>
      </div>
      {position && position.total > 1 ? (
        <nav className="hist-try-nav" data-testid="try-nav" aria-label={copy('history.tryOf', { n: position.n, total: position.total })}>
          <button
            type="button"
            className="ui-button ui-button-secondary ui-button-compact hist-try-step"
            aria-label={copy('history.previousTry')}
            aria-disabled={position.previousId ? undefined : 'true'}
            data-testid="previous-try"
            onClick={() => go(position.previousId)}
          >
            <Glyph id="chevron-left" size={16} />
          </button>
          <span className="hist-try-of" data-testid="try-of">
            {copy('history.tryOf', { n: position.n, total: position.total })}
          </span>
          <button
            type="button"
            className="ui-button ui-button-secondary ui-button-compact hist-try-step"
            aria-label={copy('history.nextTry')}
            aria-disabled={position.nextId ? undefined : 'true'}
            data-testid="next-try"
            onClick={() => go(position.nextId)}
          >
            <Glyph id="chevron-right" size={16} />
          </button>
        </nav>
      ) : null}
      </div>

      {review ? (
        <Card className="hist-score-card">{review}</Card>
      ) : controls ? (
        <Card className="hist-score-card hist-score-bare">
          {controls}
          <div className="hist-caption-line">{caption}</div>
        </Card>
      ) : null}

      {canListen ? (
        <p className="ui-visually-hidden" role="status" aria-live="polite">
          {announce}
        </p>
      ) : null}

      <Summary
        record={record}
        configs={services.configs}
        profile={profile}
        {...(diagnostics ? { diagnostics } : {})}
        {...(playAgain ? { onPlayAgain: () => playAgain(record) } : {})}
      />

      {scale ? null : (
        <>
          <button type="button" className="hist-credit" aria-label={`${credit}. ${aboutText('source.open')}`} onClick={() => setSheetOpen(true)}>
            {credit}
          </button>
          <SourceSheet open={sheetOpen} record={record} configs={services.configs} attributions={attributions} onClose={() => setSheetOpen(false)} />
        </>
      )}
    </Shell>
  );
}
