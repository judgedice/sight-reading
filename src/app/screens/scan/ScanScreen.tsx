// Scan (04 section 5.3; D6): cover, strict timer, STARS panel with overlay highlights, helpers, toolbar. React reads the
// session's states and never drives audio; the first gesture (Start scan) unlocks audio and reveals the excerpt.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ScoreFrameController } from '../../../ui/score-frame/index.ts';
import { ScoreFrame } from '../../../ui/score-frame/index.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { takesTuningNote } from '../../../session/take-plan.ts';
import { Banner } from '../../../ui/components/containers/index.ts';
import { Button } from '../../../ui/components/form/index.ts';
import { ChecklistItem, ScanTimer } from '../../../ui/components/domain/index.ts';
import { Glyph, Modal, Popover, Sheet, openOverlayCount, useToast } from '../../../ui/primitives/index.ts';
import { useNavigate } from '../../router.tsx';
import type { ScreenProps } from '../../route-types.ts';
import type { Readable } from '../home/services.ts';
import { clearHighlights, drawHighlights } from './highlights.ts';
import { useReadable, useStoreSlice, useWindowInfo } from './hooks.ts';
import {
  HIGHLIGHTED,
  STARS_ORDER,
  activeRow,
  autoTickedCount,
  creditLine,
  extremeIds,
  OVERFLOW_LABEL,
  writtenAccidentalIds,
  formatClock,
  isTicked,
  scanSummary,
  servedBarsNote,
  signatureDetail,
  sourceLine,
  startingInSeconds,
  type StarsId,
} from './model.ts';
import { usePracticeFlowServices, type PracticeFlowServices } from './services.ts';
import { PractiseWithoutListeningNotice } from '../states/States.tsx';
import './scan.css';

const NEVER: Readable<boolean> = { get: () => false, subscribe: () => () => undefined };

const CLEF_MARK: Record<string, string> = { treble: '𝄞', 'treble-8vb': '𝄞', bass: '𝄢', alto: '𝄡', tenor: '𝄡' };

const isInteractive = (t: EventTarget | null): boolean =>
  t instanceof Element && t.closest('button, a, input, select, textarea, [role="checkbox"], [role="dialog"]') !== null;

function Helpers({ svc }: { svc: PracticeFlowServices }) {
  const prepared = useStoreSlice(svc.view, (v) => v.prepared);
  const [busy, setBusy] = useState<'tuning' | 'reference' | 'tempo' | null>(null);
  const [tuning, setTuning] = useState<number | null>(null);
  if (!prepared) return null;
  const inst = svc.configs.instrumentById[prepared.instrumentId];
  const isVoice = inst?.family === 'voice';
  const tunes = inst ? takesTuningNote(inst) : false;
  const run = (kind: 'tuning' | 'reference' | 'tempo', f: () => Promise<unknown>): void => {
    setBusy(kind);
    f().then(
      (r) => {
        if (kind === 'tuning' && typeof r === 'number') setTuning(r);
        setBusy(null);
      },
      () => setBusy(null),
    );
  };
  const cents = tuning === null ? null : Math.round(Math.abs(tuning));
  return (
    <div className="scan-helpers">
      {svc.hearTempo ? <Button label={copy('action.hearTempo')} variant="secondary" size="compact" icon="volume-2" loading={busy === 'tempo'} onClick={() => run('tempo', () => svc.hearTempo!())} /> : null}
      {isVoice ? (
        <Button label={copy('action.hearReference')} variant="secondary" size="compact" icon="volume-2" loading={busy === 'reference'} onClick={() => run('reference', () => svc.session.playVoiceReference())} />
      ) : null}
      {tunes ? <Button label={copy('action.tuningNote')} variant="secondary" size="compact" icon="mic" loading={busy === 'tuning'} onClick={() => run('tuning', () => svc.session.captureTuningNote())} /> : null}
      <p className="scan-tuning" role="status">
        {tuning !== null && cents !== null ? copy('scan.tuning.result', { cents, direction: copy(tuning < 0 ? 'direction.flat' : 'direction.sharp') }) : null}
      </p>
    </div>
  );
}

interface StarsProps {
  svc: PracticeFlowServices;
  remainingSec: number;
  totalSec: number;
  onRowFocus: (id: StarsId | null) => void;
  manual: ReadonlyMap<StarsId, boolean>;
  onToggle: (id: StarsId, checked: boolean) => void;
  showList: boolean;
}

function StarsPanel({ svc, remainingSec, totalSec, onRowFocus, manual, onToggle, showList }: StarsProps) {
  const prepared = useStoreSlice(svc.view, (v) => v.prepared);
  if (!prepared) return null;
  const auto = autoTickedCount(remainingSec, totalSec);
  const rowAt = (el: EventTarget | null, ul: HTMLElement): StarsId | null => {
    const li = el instanceof Element ? el.closest('li') : null;
    const i = li ? Array.from(ul.children).indexOf(li) : -1;
    return i >= 0 ? (STARS_ORDER[i] ?? null) : null;
  };
  return (
    <div className="scan-stars">
      {showList ? (
        <>
          <h2 className="scan-stars-title">{copy('stars.title')}</h2>
          <ul
            className="scan-stars-list"
            onMouseOver={(e) => onRowFocus(rowAt(e.target, e.currentTarget))}
            onMouseLeave={() => onRowFocus(null)}
            onFocus={(e) => onRowFocus(rowAt(e.target, e.currentTarget))}
            onBlur={() => onRowFocus(null)}
          >
            {STARS_ORDER.map((id, i) => (
              <ChecklistItem
                key={id}
                checked={isTicked(i, auto, manual)}
                active={activeRow(auto, manual) === id}
                title={copy(`stars.${id}.title`)}
                detail={
                  id === 'signatures' ? (
                    <>
                      {copy('stars.signatures.prompt')} <span className="scan-stars-generated">{signatureDetail(prepared)}</span>
                    </>
                  ) : (
                    copy(`stars.${id}.prompt`)
                  )
                }
                onToggle={(c) => onToggle(id, c)}
              />
            ))}
          </ul>
        </>
      ) : null}
      <Helpers svc={svc} />
    </div>
  );
}

function SourceDetails({ prepared, onClose, mode }: { prepared: NonNullable<ReturnType<typeof usePrepared>>; onClose: () => void; mode: 'about' | 'licence' }) {
  const s = prepared.source;
  const rows: [string, string][] =
    mode === 'about'
      ? [
          [copy('credit.sheet.composer'), s.composerDates ? `${s.composer} (${s.composerDates})` : s.composer],
          [copy('credit.sheet.work'), s.catalog ? copy('credit.work', { title: s.work, catalog: s.catalog }) : copy('credit.workOnly', { title: s.work })],
          [copy('credit.sheet.bars'), `${s.sourceMeasures[0]}–${s.sourceMeasures[1]}`],
          ...(s.edition ? ([[copy('credit.sheet.edition'), s.edition]] as [string, string][]) : []),
          ...(s.encoder ? ([[copy('credit.sheet.encoder'), s.encoder]] as [string, string][]) : []),
          [copy('credit.sheet.collection'), s.corpus],
          [copy('credit.sheet.licence'), copy(`licence.${s.license}`)],
        ]
      : [
          ...(s.encoder ? ([[copy('credit.sheet.encoder'), s.encoder]] as [string, string][]) : []),
          [copy('credit.sheet.collection'), s.corpus],
          [copy('credit.sheet.licence'), copy(`licence.${s.license}`)],
        ];
  return (
    <Modal open title={mode === 'about' ? copy('scan.overflow.aboutMusic') : copy('credit.sheet.licence')} onClose={onClose}>
      <dl className="scan-source">
        {rows.map(([k, v]) => (
          <div key={k} className="scan-source-row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
        <div className="scan-source-row">
          <dt>{copy('credit.sheet.source')}</dt>
          <dd>
            <a href={s.licenseUrl} target="_blank" rel="noopener noreferrer">
              {copy(`licence.${s.license}`)}
            </a>
          </dd>
        </div>
      </dl>
    </Modal>
  );
}

function usePrepared(svc: PracticeFlowServices) {
  return useStoreSlice(svc.view, (v) => v.prepared);
}

export function ScanScreen(_props: ScreenProps) {
  const svc = usePracticeFlowServices();
  const navigate = useNavigate();
  const toast = useToast();
  const state = useStoreSlice(svc.view, (v) => v.state);
  const prepared = usePrepared(svc);
  const scan = useStoreSlice(svc.view, (v) => v.scan);
  const error = useStoreSlice(svc.view, (v) => v.error);
  const settings = useReadable(svc.settings);
  const wakeLockFailed = useReadable(svc.wakeLockFailed ?? NEVER);
  const { breakpoint, portrait } = useWindowInfo();
  const wide = breakpoint === 'lg' || breakpoint === 'xl';

  const frameRef = useRef<ScoreFrameController | null>(null);
  const frameWrap = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLElement>(null);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [manual, setManual] = useState<ReadonlyMap<StarsId, boolean>>(new Map());
  const [hovered, setHovered] = useState<StarsId | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [overflowAnchor, setOverflowAnchor] = useState<HTMLElement | null>(null);
  const [dialog, setDialog] = useState<'skip' | 'about' | 'licence' | null>(null);
  const [leaveAfterSkip, setLeaveAfterSkip] = useState(false);
  const [sheetExpanded, setSheetExpanded] = useState(false);

  const pending = svc.session.pending;
  const mode = pending?.mode ?? 'ranked';
  const scanning = state === 'scanning';
  const covered = state === 'covered';
  const totalSec = pending?.scanSec ?? 30;
  const remainingSec = scan?.remainingSec ?? totalSec;

  // The session decides when the take starts; the screens follow its state.
  useEffect(() => {
    if (state === 'count-in' || state === 'performing' || state === 'finishing') navigate('/practice/play', { replace: true });
    else if (state === 'results') navigate('/practice/results', { replace: true });
    else if (state === 'idle') navigate('/', { replace: true });
  }, [state, navigate]);

  // A new excerpt starts with clean STARS ticks.
  const excerptId = prepared?.excerptId;
  useEffect(() => {
    setManual(new Map());
    setHovered(null);
  }, [excerptId]);

  useEffect(() => {
    if (scanning) toolbarRef.current?.querySelector<HTMLButtonElement>('[data-start-playing]')?.focus();
  }, [scanning]);

  const startScan = useCallback(() => {
    // The synchronous part of ensureAudio must run inside this gesture (05 W1).
    svc.session.ensureAudio().catch(() => undefined);
    try {
      svc.session.revealScan();
    } catch {
      /* the session reports its own error */
    }
  }, [svc.session]);

  const startPlaying = useCallback(() => {
    svc.session.startTake().catch(() => undefined);
  }, [svc.session]);

  const doSkip = useCallback(
    async (leave: boolean) => {
      const source = svc.session.prepared?.source;
      const revealed = svc.session.pending?.revealed === true;
      setDialog(null);
      try {
        await svc.session.skip();
      } catch {
        return;
      }
      if (revealed && source) toast.show({ text: copy('credit.that-was', { credit: creditLine(source) }) });
      if (leave) navigate('/');
    },
    [svc.session, toast, navigate],
  );

  const leave = useCallback(() => {
    if (scanning) {
      setLeaveAfterSkip(true);
      setDialog('skip');
    } else navigate('/');
  }, [scanning, navigate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || isInteractive(e.target) || openOverlayCount() > 0) return;
      if (e.key === ' ' && covered) {
        e.preventDefault();
        startScan();
      } else if ((e.key === ' ' || e.key === 'Enter') && scanning) {
        e.preventDefault();
        startPlaying();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [covered, scanning, startScan, startPlaying]);

  // STARS highlights (04 section 5.3): the hovered or focused row, else the active one; gone when the scan ends.
  const auto = autoTickedCount(remainingSec, totalSec);
  const shown = hovered ?? activeRow(auto, manual);
  const showStars = settings.practicePrefs.showStars;
  const highlightIds = useMemo(() => {
    if (!prepared || !shown || !HIGHLIGHTED.has(shown)) return [] as string[];
    return shown === 'accidentals' ? writtenAccidentalIds(prepared) : extremeIds(prepared);
  }, [prepared, shown]);
  useEffect(() => {
    const host = frameWrap.current;
    const layout = frameRef.current?.view.layout;
    if (!host) return;
    if (!scanning || !showStars || !layout || highlightIds.length === 0) {
      clearHighlights(host);
      return;
    }
    drawHighlights(host, layout, highlightIds);
  }, [scanning, showStars, highlightIds, layoutVersion]);
  useEffect(() => {
    const host = frameWrap.current;
    return () => {
      if (host) clearHighlights(host);
    };
  }, []);

  const onToggle = useCallback((id: StarsId, checked: boolean) => setManual((m) => new Map(m).set(id, checked)), []);

  if (error) {
    const key = error.code === 'mic-denied' || error.code === 'mic-not-found' ? 'permission.denied.title' : error.code === 'corpus-load' ? 'error.corpus' : 'error.clockRate';
    return (
      <section className="scan" data-testid="screen-practice.scan" data-route-id="practice.scan" data-state="error">
        <Banner tone="danger" text={copy(key)} action={{ label: copy('action.retry'), onClick: () => navigate('/') }} />
      </section>
    );
  }

  const bpm = prepared?.selection.settings.bpm ?? 60;
  const startingIn = scanning ? startingInSeconds(mode, remainingSec) : null;
  const timeUp = scanning && mode === 'practice' && scan?.expired === true;
  const requestedBars = settings.practice.bars;
  const reasonKey = mode === 'ranked' ? null : pending?.skipLimitHit ? 'ranked.reason.skip-limit' : pending?.seenBefore ? 'ranked.reason.seen-before' : 'ranked.reason.practice-mode';
  const chipText = mode === 'ranked' ? copy('scan.chip.ranked', { time: formatClock(totalSec) }) : copy('scan.chip.practice');
  const note = prepared ? servedBarsNote(prepared, requestedBars) : null;
  const sLine = prepared ? sourceLine(prepared.source) : null;
  const doneCount = STARS_ORDER.filter((_, i) => isTicked(i, auto, manual)).length;
  const showSheetPanel = !wide && scanning;

  return (
    <section className="scan" data-testid="screen-practice.scan" data-route-id="practice.scan" data-state={state} data-mode={mode}>
      <header className="scan-toolbar" ref={toolbarRef}>
        <Button label={copy('nav.home')} variant="tertiary" icon="chevron-left" onClick={leave} className="scan-home" />
        {prepared ? (
          <div className="scan-summary-block">
            <p className="scan-summary">{scanSummary(prepared)}</p>
            {note ? <span className="scan-quiet-chip">{note}</span> : null}
            {sLine ? (
              <button type="button" className="scan-source-line" onClick={() => setDialog('licence')}>
                {sLine}
              </button>
            ) : null}
          </div>
        ) : null}
        {scanning ? (
          <>
            <span className="scan-chip" data-mode={mode} title={reasonKey ? copy(reasonKey) : undefined}>
              {chipText}
            </span>
            <ScanTimer remainingSec={remainingSec} totalSec={totalSec} mode={mode} label={chipText} />
            <p className="scan-timer-label" role="status">
              {startingIn !== null ? copy('scan.startingIn', { n: startingIn }) : timeUp ? copy('scan.practice.timeUp') : null}
            </p>
          </>
        ) : null}
        {prepared ? (
          <button type="button" className="scan-overflow" aria-label={OVERFLOW_LABEL} aria-haspopup="menu" aria-expanded={overflowOpen} ref={setOverflowAnchor} onClick={() => setOverflowOpen((o) => !o)}>
            <Glyph id="chevron-down" />
          </button>
        ) : null}
        {scanning ? <Button data-start-playing label={copy('action.startPlaying')} variant="primary" icon="play" onClick={startPlaying} /> : null}
      </header>
      <Popover open={overflowOpen} anchor={overflowAnchor} label={OVERFLOW_LABEL} onClose={() => setOverflowOpen(false)}>
        <div className="scan-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="scan-menu-item"
            onClick={() => {
              setOverflowOpen(false);
              setDialog('about');
            }}
          >
            {copy('scan.overflow.aboutMusic')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="scan-menu-item"
            onClick={() => {
              setOverflowOpen(false);
              if (scanning) {
                setLeaveAfterSkip(false);
                setDialog('skip');
              } else void doSkip(false);
            }}
          >
            {copy('scan.overflow.skip')}
          </button>
        </div>
      </Popover>
      {settings.practice.listening ? null : <PractiseWithoutListeningNotice />}
      {wakeLockFailed ? <p className="scan-hint">{copy('scan.wakeLockHint')}</p> : null}
      {scanning && breakpoint === 'xs' && portrait ? <p className="scan-hint scan-rotate">{copy('scan.rotate')}</p> : null}
      <div className="scan-body">
        <div className="scan-score" ref={frameWrap}>
          {prepared ? (
            <ScoreFrame
              ref={frameRef}
              loadNotation={svc.loadNotation}
              excerpt={scanning ? prepared : null}
              bpm={bpm}
              arrangement="all"
              {...(svc.reducedMotion ? { reducedMotion: svc.reducedMotion } : {})}
              {...(svc.highContrast ? { highContrast: svc.highContrast } : {})}
              label={copy('score.summaryLabel', {
                bars: prepared.measures.filter((m) => !m.isPickup).length,
                key: scanSummary(prepared).split(' · ')[1] ?? '',
                meter: `${prepared.meter.beats}/${prepared.meter.beatType}`,
                clef: prepared.clef,
                tempo: copy('tempo.marking', { unit: '♩', bpm }),
              })}
              onLayout={() => setLayoutVersion((v) => v + 1)}
            />
          ) : null}
          {covered && prepared ? (
            <div className="scan-cover" data-testid="scan-cover">
              <div className="scan-cover-facts" aria-label={scanSummary(prepared)} role="group">
                <span className="scan-cover-clef" aria-hidden="true">
                  {CLEF_MARK[prepared.clef] ?? ''}
                </span>
                <span className="scan-cover-fact">{scanSummary(prepared)}</span>
              </div>
              <p className="scan-cover-text">{copy('scan.cover')}</p>
              {mode === 'ranked' ? (
                <div className="scan-cover-ranked">
                  <p>{copy('scan.ranked.notice', { seconds: totalSec })}</p>
                  <Button label={copy('action.practiceInstead')} variant="secondary" onClick={() => void svc.practiceInstead()} />
                </div>
              ) : null}
              <p className="scan-cover-hint">{copy('a11y.screenReader.headphones')}</p>
              <div className="scan-cover-actions">
                <Button label={copy('action.startScan')} variant="primary" size="hero" icon="play" onClick={startScan} data-autofocus />
                <Button label={copy('action.skip')} variant="tertiary" onClick={() => void doSkip(false)} />
              </div>
            </div>
          ) : null}
        </div>
        {scanning && wide ? (
          <aside className="scan-panel" aria-label={copy('stars.title')}>
            <StarsPanel svc={svc} remainingSec={remainingSec} totalSec={totalSec} onRowFocus={setHovered} manual={manual} onToggle={onToggle} showList={showStars} />
          </aside>
        ) : null}
      </div>
      {showSheetPanel ? (
        <Sheet
          open
          title={copy('stars.title')}
          peek={
            <span className="scan-peek">
              <span>{copy('scan.peek', { n: doneCount, total: STARS_ORDER.length })}</span>
              <ScanTimer remainingSec={remainingSec} totalSec={totalSec} mode={mode} />
            </span>
          }
          expanded={sheetExpanded}
          onExpandedChange={setSheetExpanded}
        >
          <StarsPanel svc={svc} remainingSec={remainingSec} totalSec={totalSec} onRowFocus={setHovered} manual={manual} onToggle={onToggle} showList={showStars} />
        </Sheet>
      ) : null}
      {dialog === 'skip' ? (
        <Modal
          open
          title={copy('dialog.skip.title')}
          onClose={() => {
            setDialog(null);
            setLeaveAfterSkip(false);
          }}
        >
          {mode === 'ranked' && svc.skipLimitReached?.() ? <p>{copy('dialog.skip.practiceNotice', { n: svc.configs.progression.skip.postRevealPerRanked })}</p> : null}
          <div className="scan-dialog-actions">
            <Button
              label={copy('action.keepReading')}
              variant="primary"
              data-autofocus
              onClick={() => {
                setDialog(null);
                setLeaveAfterSkip(false);
              }}
            />
            <Button label={copy('action.skip')} variant="secondary" onClick={() => void doSkip(leaveAfterSkip)} />
          </div>
        </Modal>
      ) : null}
      {(dialog === 'about' || dialog === 'licence') && prepared ? <SourceDetails prepared={prepared} mode={dialog} onClose={() => setDialog(null)} /> : null}
    </section>
  );
}
