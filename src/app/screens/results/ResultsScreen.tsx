/**
 * The results route (05 sections 3.2, 4.4, 8.11 and 9.3): the loop toolbar (Home and the excerpt summary), the results
 * page with the marked score, Listen and "One thing to try", "Change setup" over results, then the rank-up, install
 * or session summary sheet. Tips live here; there is no tips step in the loop (05 section 3.1, decision 13).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { AttemptRecord, PracticeSettings } from '../../../core/types.ts';
import { BeatUnitText } from '../../../ui/components/domain/index.ts';
import { Button } from '../../../ui/components/form/index.ts';
import { openOverlayCount, useToast } from '../../../ui/primitives/index.ts';
import { useNavigate } from '../../router.tsx';
import type { ScreenProps } from '../../route-types.ts';
import { scanSummary } from '../scan/model.ts';
import { normalize, type SetupContext } from '../setup/model.ts';
import { SetupSheet } from '../setup/SetupSheet.tsx';
import { InstallCoach, installCoachDue } from '../sheets/InstallCoach.tsx';
import { RankUpCard } from '../sheets/RankUpCard.tsx';
import { SessionSummary } from '../sheets/SessionSummary.tsx';
import { summarizeSession, summaryDue } from '../sheets/summary.ts';
import { creditLine, rankUpEvent, type HearSpan } from './model.ts';
import { ResultsListen, isListening, useResultsSound } from './ResultsListen.tsx';
import { ResultsPanel } from './ResultsPanel.tsx';
import type { ResultsServices } from './services.ts';
import { text } from './text.ts';
import './results.css';

/**
 * What "Change setup" needs beyond `ResultsServices` to draw the setup sheet over results: the corpus counts and the
 * sounds the sheet's rows play. Optional until the composition root passes them; without `countEligible`, "Change
 * setup" goes to Practice instead.
 */
export interface ResultsSetupServices {
  countEligible?(instrumentId: string, level: number, meter: string | null): number;
  hearTempo?(bpm: number, beatsPerBar: number): Promise<void>;
  playNote?(concertMidi: number): Promise<void>;
}

const Services = createContext<ResultsServices | null>(null);
export const ResultsServicesProvider = Services.Provider;

function useServices(): ResultsServices & ResultsSetupServices {
  const s = useContext(Services);
  if (!s) throw new Error('Results needs ResultsServicesProvider');
  return s;
}

function useReadable<T>(r: { get(): T; subscribe(l: () => void): () => void }): T {
  return useSyncExternalStore(r.subscribe, r.get, r.get);
}

/** Desktop layout (actions in the header) from this width; phones get the page-end actions and the pinned bar. */
export const RESULTS_WIDE_QUERY = '(min-width: 43.75rem)';

function useWide(): boolean {
  const subscribe = useCallback((l: () => void) => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
    const mq = window.matchMedia(RESULTS_WIDE_QUERY);
    mq.addEventListener('change', l);
    return () => mq.removeEventListener('change', l);
  }, []);
  const get = (): boolean => (typeof window === 'undefined' || typeof window.matchMedia !== 'function' ? true : window.matchMedia(RESULTS_WIDE_QUERY).matches);
  return useSyncExternalStore(subscribe, get, get);
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
  const toast = useToast();
  const wide = useWide();
  const view = useSyncExternalStore(services.session.subscribe, services.session.getState, services.session.getState);
  const profile = useReadable(services.profile);
  const settings = useReadable(services.settings);
  const record: AttemptRecord | null = view.record;
  const cfg = services.configs;
  const actions = services.actions;
  const [rankSeen, setRankSeen] = useState<ReadonlySet<number>>(new Set());
  const sound = useResultsSound(services.sounds);
  const [slower, setSlower] = useState(false);
  const [startBar, setStartBar] = useState<number | null>(null);
  const [announce, setAnnounce] = useState('');
  const [setupOpen, setSetupOpen] = useState(false);
  const setupAtOpen = useRef<string>('');
  /** The settings as they were when "Change setup" opened, so Cancel can put them back (05 section 3.1). */
  const setupRestore = useRef<{ practice: PracticeSettings; showBeta: boolean } | null>(null);

  const rankUp = rankUpEvent(view.progress);
  const rankUpDue = rankUp !== null && !rankSeen.has(rankUp.to) && !(services.rankUps?.seen(rankUp.to) ?? false);
  const installDue = rankUp === null && installCoachDue(record, settings);
  const candidate: Pending = rankUpDue ? 'rankup' : installDue ? 'install' : null;
  const pending = usePendingSheet(candidate, services.settleMs ?? DEFAULT_SETTLE_MS);

  // 02 section 6.1 item 8: every 10 attempts the session summary comes before the next excerpt (once per visit).
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryShownFor, setSummaryShownFor] = useState<string | null>(null);
  const attemptsNow = services.sessionAttempts?.() ?? null;
  const summaryNow = record !== null && attemptsNow !== null && summaryShownFor !== record.id && summaryDue(attemptsNow.length, cfg);

  // A new take starts Listen from bar 1 at full speed.
  const recordId = record?.id ?? null;
  useEffect(() => {
    setStartBar(null);
    setSlower(false);
  }, [recordId]);

  // Leaving the screen stops playback (05 section 9.3).
  const stopSounds = services.stopSounds;
  useEffect(() => () => stopSounds?.(), [stopSounds]);

  const proceed = (): void => {
    services.stopSounds?.();
    if (actions.next?.() === true) return;
    navigate('/practice/scan');
  };
  const next = (): void => {
    if (summaryNow && record) {
      setSummaryShownFor(record.id);
      setSummaryOpen(true);
      return;
    }
    proceed();
  };
  const finishSession = (): void => {
    setSummaryOpen(false);
    services.onFinish?.();
    navigate('/');
  };
  const tryAgain = (): void => {
    services.stopSounds?.();
    if (actions.tryAgain?.() !== true) navigate('/practice/scan');
  };
  const recalibrate = (): void => {
    services.stopSounds?.();
    if (actions.recalibrate) actions.recalibrate();
    else navigate('/calibrate');
  };

  // ---- Listen (05 section 9.3) -----------------------------------------------------------------------------------
  const measures = view.prepared && record && view.prepared.excerptId === record.excerptId ? view.prepared.measures : [];
  const playing = isListening(sound);
  const listen = (o: { slower: boolean; fromBar: number | null }): void => {
    const run = services.listen;
    if (!run) return;
    setAnnounce('');
    run({ slower: o.slower, ...(o.fromBar !== null && o.fromBar > 1 ? { fromBar: o.fromBar } : {}) }).catch(() => undefined);
  };
  const stop = (): void => {
    services.stopSounds?.();
    setAnnounce(text('listen.stopped'));
  };
  const toggleListen = (): void => (playing ? stop() : listen({ slower, fromBar: startBar }));
  const hear = (span: HearSpan): void => {
    const run = services.hearBar;
    if (!run) return;
    setAnnounce('');
    run(span.from, span.to === span.from ? undefined : span.to, { slower }).catch(() => undefined);
  };
  const indexOfBar = (bar: number | null): number | null => {
    if (bar === null) return null;
    const i = measures.findIndex((m) => m.displayBar === bar);
    return i >= 0 ? i : null;
  };
  const onBarTap = (index: number): void => {
    // A tap sets where Listen starts, only while nothing plays.
    if (playing) return;
    const bar = measures[index]?.displayBar;
    if (bar !== undefined) setStartBar(bar);
  };

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
      } else if (k === 'l' && services.listen) {
        e.preventDefault();
        toggleListen();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    // No take to show: Home. Next and Try again clear the record while the session moves on to the next excerpt or
    // the scan, which the scan route follows, so those states stay.
    if (!record && view.state !== 'finishing' && !MOVING_ON.has(view.state)) navigate('/', { replace: true });
  }, [record, view.state, navigate]);

  // ---- Change setup (05 sections 3.2 and 4.4) ----------------------------------------------------------------------
  const countEligible = services.countEligible;
  const ctx = useMemo<SetupContext | null>(
    () =>
      countEligible
        ? {
            cfg,
            eligible: (id, level, meter) => countEligible(id, level, meter),
            showBeta: settings.practicePrefs.showBeta,
            playerLevel: (id) => profile?.instruments[id]?.level ?? (typeof settings.practice.level === 'number' && id === settings.practice.instrumentId ? settings.practice.level : 1),
          }
        : null,
    [countEligible, cfg, settings.practicePrefs.showBeta, settings.practice.level, settings.practice.instrumentId, profile],
  );
  const practice = useMemo(() => (ctx ? normalize(settings.practice, ctx) : settings.practice), [ctx, settings.practice]);
  const openSetup = (): void => {
    services.stopSounds?.();
    if (!ctx) {
      navigate('/');
      return;
    }
    setupAtOpen.current = JSON.stringify(practice);
    const now = services.settings.get();
    setupRestore.current = { practice: now.practice, showBeta: now.practicePrefs.showBeta };
    setSetupOpen(true);
  };
  const saveSetup = (nextSettings: PracticeSettings): void => {
    services.settings.set({ ...services.settings.get(), practice: nextSettings });
  };
  const closeSetup = (): void => {
    setSetupOpen(false);
    // Done with a new setup: the cover of a new excerpt with it. Done with nothing changed stays on results.
    if (JSON.stringify(normalize(services.settings.get().practice, ctx!)) !== setupAtOpen.current) proceed();
  };
  const cancelSetup = (): void => {
    setSetupOpen(false);
    // Cancel changes nothing: the changes the sheet applied as they were made are put back, and results stays.
    const was = setupRestore.current;
    if (!was) return;
    const now = services.settings.get();
    services.settings.set({ ...now, practice: was.practice, practicePrefs: { ...now.practicePrefs, showBeta: was.showBeta } });
  };

  // ---- tips off from results (designer's note 17) ------------------------------------------------------------------
  const setShowTips = (on: boolean): void => {
    const now = services.settings.get();
    services.settings.set({ ...now, practicePrefs: { ...now.practicePrefs, showTips: on } });
    if (!on) {
      toast.show({
        text: text('tips.offToast'),
        action: {
          label: text('action.undo'),
          onAction: () => {
            const again = services.settings.get();
            services.settings.set({ ...again, practicePrefs: { ...again.practicePrefs, showTips: true } });
          },
        },
      });
    }
  };

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

  const voided = record.endReason === 'void';
  const canListen = services.listen !== undefined && measures.length > 0;
  const controls = canListen ? (
    <ResultsListen
      sound={sound}
      slower={slower}
      fromBar={startBar}
      onSlower={(v) => {
        setSlower(v);
        if (playing && sound.playing === 'listen') listen({ slower: v, fromBar: sound.fromBar ?? startBar });
      }}
      onListen={() => listen({ slower, fromBar: startBar })}
      onStop={stop}
    />
  ) : null;
  const renderReview = services.renderReview;
  const highlight = indexOfBar(playing ? sound.bar : startBar);
  const review = renderReview ? renderReview(record, { highlightBar: highlight, onBarTap, ...(controls ? { toolbarEnd: controls } : {}) }) : null;

  const credit = creditLine(record.credit);
  const creditNode = actions.openSource ? (
    <button type="button" className="res-credit-button" onClick={() => actions.openSource?.(record)}>
      {credit}
    </button>
  ) : (
    <p className="res-credit">{credit}</p>
  );
  const prepared = view.prepared && view.prepared.excerptId === record.excerptId ? view.prepared : null;

  return (
    <section className="res-screen" data-testid="screen-practice.results" data-route-id="practice.results">
      <header className="res-toolbar">
        <Button label={text('nav.home')} variant="quiet" size="compact" icon="chevron-left" onClick={() => navigate('/')} className="res-home" />
        {prepared ? (
          <p className="res-summary">
            <BeatUnitText text={scanSummary(prepared)} />
          </p>
        ) : (
          <span className="res-summary" />
        )}
        <span className="res-toolbar-end" />
      </header>
      <ResultsPanel
        record={record}
        configs={cfg}
        profile={profile}
        progress={view.progress}
        tips={view.tips}
        review={review}
        wide={wide}
        showTips={settings.practicePrefs.showTips}
        showNumbers={settings.display.showCentsMs}
        recalibrate={view.recalibrateRouteKey !== null}
        credit={creditNode}
        onNext={next}
        onTryAgain={tryAgain}
        {...(voided ? {} : { onChangeSetup: openSetup })}
        onMoveUp={actions.moveUp}
        onStayAt={actions.stayAt}
        onUndoLevelUp={actions.undoLevelUp}
        onGoToLevel={actions.goToLevel}
        onRecalibrate={recalibrate}
        onCalibrateNow={recalibrate}
        onCheckMicrophone={recalibrate}
        {...(services.hearBar ? { onHearBars: hear } : {})}
        onShowTipsChange={setShowTips}
      />
      <p className="ui-visually-hidden" role="status" aria-live="polite">
        {announce}
      </p>
      {ctx ? (
        <SetupSheet
          open={setupOpen}
          value={practice}
          ctx={ctx}
          onChange={saveSetup}
          onClose={closeSetup}
          onCancel={cancelSetup}
          onShowLessTested={(on) => {
            const now = services.settings.get();
            services.settings.set({ ...now, practicePrefs: { ...now.practicePrefs, showBeta: on } });
          }}
          onHearNote={services.playNote ? (midi) => void services.playNote?.(midi).catch(() => undefined) : undefined}
          onHearTempo={services.hearTempo ? (bpm, beats) => void services.hearTempo?.(bpm, beats).catch(() => undefined) : undefined}
        />
      ) : null}
      {rankUp ? <RankUpCard open={pending === 'rankup'} configs={cfg} rank={rankUp.to} name={rankUp.name} onContinue={closeRankUp} /> : null}
      <InstallCoach open={pending === 'install'} onGotIt={closeInstall} />
      {attemptsNow !== null && summaryShownFor === record.id ? (
        <SessionSummary
          open={summaryOpen}
          data={summarizeSession(attemptsNow, cfg, profile)}
          onKeepGoing={() => {
            setSummaryOpen(false);
            proceed();
          }}
          onFinish={finishSession}
        />
      ) : null}
    </section>
  );
}
