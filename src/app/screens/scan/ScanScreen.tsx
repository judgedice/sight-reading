// Cover and read-through (05 sections 4.2, 4.3, 8.7, 8.8, 9 and 10; 06 sections 6.8, 6.9 and 10). React reads the
// session's states and never drives audio itself: "Show the music" is the first gesture (it unlocks audio and
// reveals the excerpt), and every sound goes through the session's sound services, one at a time.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ScoreFrameController } from '../../../ui/score-frame/index.ts';
import { ScoreFrame } from '../../../ui/score-frame/index.ts';
import { copy, type CopyKey } from '../../../ui/copy/copy.ts';
import type { SessionErrorCode } from '../../../core/types.ts';
import { CalStatusPill, calTexts } from '../../../ui/components/calibration-status/index.ts';
import { Button, Toggle } from '../../../ui/components/form/index.ts';
import { BeatUnitText, ChecklistItem, ScanTimer } from '../../../ui/components/domain/index.ts';
import { ModePill } from '../../../ui/components/setup/index.ts';
import type { PracticeReason } from '../../../session/index.ts';
import { DOCK_QUERY, ListenConfirm, SoundButton, SoundsDock, SoundsGroup, useMediaQuery, type SoundsModel } from '../../../ui/components/sounds/index.ts';
import { Glyph, Modal, Popover, Sheet, openOverlayCount, useToast } from '../../../ui/primitives/index.ts';
import { useNavigate } from '../../router.tsx';
import type { ScreenProps } from '../../route-types.ts';
import type { Readable } from '../home/services.ts';
import type { CalStatus } from '../../compose/calibration-status.ts';
import { ErrorKindScreen } from '../states/index.ts';
import { CoverSignature } from './CoverSignature.tsx';
import { clearHighlights, drawHighlights } from './highlights.ts';
import { useReadable, useStoreSlice } from './hooks.ts';
import {
  HIGHLIGHTED,
  creditLine,
  extremeIds,
  OVERFLOW_LABEL,
  writtenAccidentalIds,
  formatClock,
  lookRows,
  onStartLine,
  scanSummary,
  servedBarsNote,
  sourceLine,
  startingInSeconds,
  type StarsId,
} from './model.ts';
import { countdownCrossing } from './read-model.ts';
import { useReadSounds, type ReadSounds } from './read-sounds.tsx';
import { usePracticeFlowServices, type PracticeFlowServices } from './services.ts';
import { PractiseWithoutListeningNotice } from '../states/States.tsx';
import { scaleTitle } from '../scales/index.ts';
import './scan.css';

const NEVER: Readable<boolean> = { get: () => false, subscribe: () => () => undefined };
const NO_CAL: Readable<CalStatus | null> = { get: () => null, subscribe: () => () => undefined };

/**
 * What each session error says on the read-through. Honest per cause: a clock-rate problem never stops a take (it is
 * a measurement gate that makes the take practice), so no session error claims one.
 */
export const SESSION_ERROR_TEXT: Record<SessionErrorCode, CopyKey> = {
  'mic-denied': 'permission.denied.title',
  'mic-not-found': 'permission.denied.title',
  'corpus-load': 'error.corpus',
  'audio-setup': 'error.audioSetup',
  storage: 'error.storage',
  'empty-pool': 'error.emptyPool',
  unknown: 'error.unknown',
};

const isInteractive = (t: EventTarget | null): boolean =>
  t instanceof Element && t.closest('button, a, input, select, textarea, [role="checkbox"], [role="dialog"]') !== null;

type Prepared = NonNullable<PracticeFlowServices['session']['prepared']>;

// ---- "Look before you play" ------------------------------------------------------------------------------------

interface LookProps {
  prepared: Prepared;
  /** The row under the pointer: the score shows what it names (accidentals, highest and lowest notes). */
  onRowFocus: (id: StarsId | null) => void;
  /** Card heading (desktop); the phone sheet has its own title. */
  heading: boolean;
}

function LookList({ prepared, onRowFocus, heading }: LookProps) {
  const rows = lookRows(prepared);
  const rowAt = (el: EventTarget | null, ul: HTMLElement): StarsId | null => {
    const li = el instanceof Element ? el.closest('li') : null;
    const i = li ? Array.from(ul.children).indexOf(li) : -1;
    return i >= 0 ? (rows[i]?.id ?? null) : null;
  };
  return (
    <div className="scan-stars">
      {heading ? <h2 className="scan-stars-title">{copy('stars.heading')}</h2> : null}
      <p className="scan-stars-lead">{copy('look.lead')}</p>
      <ul className="scan-stars-list" onMouseOver={(e) => onRowFocus(rowAt(e.target, e.currentTarget))} onMouseLeave={() => onRowFocus(null)}>
        {rows.map((r) => (
          <ChecklistItem key={r.id} title={r.label} detail={r.fact} advice={r.advice} />
        ))}
      </ul>
    </div>
  );
}

// ---- About this music ------------------------------------------------------------------------------------------

function SourceDetails({ prepared, onClose, mode }: { prepared: Prepared; onClose: () => void; mode: 'about' | 'licence' }) {
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

// ---- Toolbar ---------------------------------------------------------------------------------------------------

interface ToolbarProps {
  prepared: Prepared | null;
  reason: PracticeReason | null;
  /** The overflow menu has items (a scale's read-through on desktop has none). */
  menu: boolean;
  mode: 'ranked' | 'practice';
  scanning: boolean;
  remainingSec: number;
  totalSec: number;
  onHome: () => void;
  overflowOpen: boolean;
  setOverflowOpen: (f: (o: boolean) => boolean) => void;
  setOverflowAnchor: (el: HTMLElement | null) => void;
}

/**
 * The mode pill on the cover and the read-through bar (round 3, R79): "Ranked · 0:24 to read" with the countdown ring
 * while reading; "Practice · no time limit", or the reason a ranked request is practice ("Practice · seen before").
 */
function ModeChip({ mode, reason, scanning, remainingSec, totalSec }: { mode: 'ranked' | 'practice'; reason: PracticeReason | null; scanning: boolean; remainingSec: number; totalSec: number }) {
  if (mode === 'practice') {
    return <ModePill mode="practice" detail={copy(reason ? (`mode.reason.${reason}` as CopyKey) : 'mode.pill.free')} testId="mode-chip" />;
  }
  if (!scanning) return <ModePill mode="ranked" testId="mode-chip" />;
  const time = formatClock(remainingSec);
  return (
    <ModePill
      mode="ranked"
      detail={copy('scan.chip.ranked.detail', { time })}
      ring={<ScanTimer remainingSec={remainingSec} totalSec={totalSec} mode="ranked" label={copy('scan.timeLeft', { time })} />}
      testId="mode-chip"
      className="scan-pill-ring"
    />
  );
}

function Toolbar({ prepared, reason, menu, mode, scanning, remainingSec, totalSec, onHome, overflowOpen, setOverflowOpen, setOverflowAnchor }: ToolbarProps) {
  return (
    <header className="scan-toolbar">
      <Button label={copy('nav.home')} variant="quiet" size="compact" icon="chevron-left" onClick={onHome} className="scan-home" />
      {scanning && prepared ? (
        <p className="scan-summary scan-summary-bar">
          <BeatUnitText text={scanSummary(prepared)} />
        </p>
      ) : (
        <span className="scan-toolbar-gap" />
      )}
      {prepared ? <ModeChip mode={mode} reason={reason} scanning={scanning} remainingSec={remainingSec} totalSec={totalSec} /> : null}
      {scanning && prepared && menu ? (
        <button type="button" className="scan-overflow" aria-label={OVERFLOW_LABEL} aria-haspopup="menu" aria-expanded={overflowOpen} ref={setOverflowAnchor} onClick={() => setOverflowOpen((o) => !o)}>
          <Glyph id="more" />
        </button>
      ) : null}
    </header>
  );
}

// ---- Cover -----------------------------------------------------------------------------------------------------

interface CoverProps {
  prepared: Prepared | null;
  mode: 'ranked' | 'practice';
  totalSec: number;
  listening: boolean;
  onShow: () => void;
  onSkip: () => void;
  onPracticeInstead: () => void;
}

function Cover({ prepared, mode, totalSec, listening, onShow, onSkip, onPracticeInstead }: CoverProps) {
  const loading = prepared === null;
  return (
    <div className="scan-cover" data-testid="scan-cover" aria-busy={loading ? 'true' : undefined}>
      <div className="scan-cover-staff">{prepared ? <CoverSignature clef={prepared.clef} keySig={prepared.writtenKey} meter={prepared.meter} /> : <span className="scan-cover-sig-blank" />}</div>
      {prepared ? (
        <p className="scan-cover-summary">
          <BeatUnitText text={scanSummary(prepared)} />
        </p>
      ) : (
        <p className="scan-cover-summary scan-cover-loading" role="status">
          {copy('scan.cover.loading')}
        </p>
      )}
      <p className="scan-cover-text">{copy('scan.cover')}</p>
      {!listening ? <PractiseWithoutListeningNotice /> : null}
      {prepared && mode === 'ranked' ? (
        <div className="scan-cover-ranked">
          <p>{copy('scan.ranked.notice', { seconds: totalSec })}</p>
          <Button label={copy('action.practiceInstead')} variant="secondary" size="compact" onClick={onPracticeInstead} />
        </div>
      ) : null}
      <Button className="scan-cover-show" label={copy('action.startScan')} variant="primary" size="hero" kbd={copy('shortcuts.spaceKey')} disabled={loading} onClick={onShow} data-autofocus />
      <Button className="scan-cover-skip" label={copy('action.skip')} variant="quiet" disabled={loading} onClick={onSkip} />
      <p className="scan-cover-hint">{copy('scan.skipFreeHint')}</p>
      <p className="ui-visually-hidden">{copy('a11y.screenReader.headphones')}</p>
    </div>
  );
}

// ---- Read-through: the right column (desktop) and the dock (phones) --------------------------------------------

interface SideProps {
  sounds: ReadSounds;
  onStart: () => void;
  /** The beat line switch (PLAN R70): the same setting as the try's strip and Settings > Practice. */
  beatLine: ReactNode;
}

/** "Beat line" before the try (PLAN R70), so the player chooses it before the count-in starts. */
function BeatLineSwitch({ on, set }: { on: boolean; set: (on: boolean) => void }) {
  return (
    <div className="scan-beatline" data-testid="scan-beat-line">
      <Toggle label={copy('play.beatLine')} checked={on} onChange={set} />
    </div>
  );
}

function DesktopSide({ sounds, onStart, startLine, calibration, beatLine }: SideProps & { startLine: string; calibration: ReactNode }) {
  return (
    <aside className="scan-side" aria-label={copy('scan.sounds.title')}>
      <Button data-start-playing className="scan-start" label={copy('action.startPlaying')} variant="primary" size="hero" kbd={copy('shortcuts.spaceKey')} onClick={onStart} />
      {beatLine}
      {calibration}
      <SoundsGroup model={sounds.model} onPress={sounds.press} caption={sounds.caption} captionFailed={sounds.captionFailed} lead={startLine} />
    </aside>
  );
}

function PhoneDock({ sounds, onStart, peek, onPeek, beatLine }: SideProps & { peek: string; onPeek: () => void }) {
  return (
    <div className="scan-dock" data-testid="scan-dock">
      <button type="button" className="scan-peek" aria-haspopup="dialog" onClick={onPeek}>
        <span>{peek}</span>
        <Glyph id="chevron-down" className="scan-peek-chevron" />
      </button>
      <div className="scan-dock-inner">
        <SoundsDock model={sounds.model} onPress={sounds.press} caption={sounds.caption} captionFailed={sounds.captionFailed} />
        {beatLine}
        <Button data-start-playing className="scan-start" label={copy('action.startPlaying')} variant="primary" size="hero" onClick={onStart} />
      </div>
    </div>
  );
}

/** Check my tuning at the top of the phone's "Before you play" sheet (05 section 8.8). */
function TuningRow({ model, onPress }: { model: SoundsModel; onPress: ReadSounds['press'] }) {
  if (!model.tuning) return null;
  const playing = model.playing === 'tuning';
  return (
    <div className="scan-sheet-tuning">
      <SoundButton
        soundId="tuning"
        icon="tuning-fork"
        label={copy('action.tuningNote')}
        caption={playing ? copy('tuning.listening') : copy('tuning.caption', { seconds: model.tuningSeconds })}
        playing={playing}
        disabled={false}
        onPress={() => onPress('tuning')}
      />
    </div>
  );
}

// ---- Screen ----------------------------------------------------------------------------------------------------

export function ScanScreen(_props: ScreenProps) {
  const svc = usePracticeFlowServices();
  const navigate = useNavigate();
  const toast = useToast();
  const state = useStoreSlice(svc.view, (v) => v.state);
  const prepared = useStoreSlice(svc.view, (v) => v.prepared);
  const scan = useStoreSlice(svc.view, (v) => v.scan);
  const error = useStoreSlice(svc.view, (v) => v.error);
  const viewMode = useStoreSlice(svc.view, (v) => v.mode);
  const practiceReason = useStoreSlice(svc.view, (v) => v.practiceReason ?? null);
  const settings = useReadable(svc.settings);
  const beatLineSwitch = svc.setBeatLine ? <BeatLineSwitch on={settings.display.beatLine !== false} set={(on) => svc.setBeatLine?.(on)} /> : null;
  const wakeLockFailed = useReadable(svc.wakeLockFailed ?? NEVER);
  const docked = useMediaQuery(DOCK_QUERY);

  const frameRef = useRef<ScoreFrameController | null>(null);
  const frameWrap = useRef<HTMLDivElement>(null);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [hovered, setHovered] = useState<StarsId | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [overflowAnchor, setOverflowAnchor] = useState<HTMLElement | null>(null);
  const [dialog, setDialog] = useState<'skip' | 'about' | 'licence' | null>(null);
  const [leaveAfterSkip, setLeaveAfterSkip] = useState(false);
  const [starsOpen, setStarsOpen] = useState(false);
  const [said, setSaid] = useState<{ text: string; n: number }>({ text: '', n: 0 });

  const pending = svc.session.pending;
  const mode: 'ranked' | 'practice' = viewMode ?? pending?.mode ?? 'ranked';
  const scanning = state === 'scanning';
  const covered = state === 'covered' || state === 'loading';
  const totalSec = pending?.scanSec ?? 30;
  const remainingSec = scan?.remainingSec ?? totalSec;

  const announce = useCallback((text: string) => setSaid((s) => ({ text, n: s.n + 1 })), []);
  const sounds = useReadSounds({ svc, prepared, mode, active: scanning, announce });
  // A ranked try that becomes practice says so at that moment (R79); Listen first announces its own line.
  const lastReason = useRef<PracticeReason | null>(practiceReason);
  useEffect(() => {
    const was = lastReason.current;
    lastReason.current = practiceReason;
    if (practiceReason && practiceReason !== was && practiceReason !== 'listened-first' && prepared) announce(copy('mode.nowPractice', { reason: copy(`mode.reason.${practiceReason}` as CopyKey) }));
  }, [practiceReason, prepared, announce]);

  // The session decides when the take starts; the screens follow its state.
  useEffect(() => {
    if (state === 'count-in' || state === 'performing' || state === 'finishing') navigate('/practice/play', { replace: true });
    else if (state === 'results') navigate('/practice/results', { replace: true });
    else if (state === 'idle') navigate('/', { replace: true });
  }, [state, navigate]);

  // A new piece starts with no row highlighted.
  const excerptId = prepared?.excerptId;
  useEffect(() => {
    setHovered(null);
  }, [excerptId]);

  // Focus "Start playing" when the music shows.
  const sideRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scanning) sideRef.current?.querySelector<HTMLButtonElement>('[data-start-playing]')?.focus();
  }, [scanning, docked]);

  // Leaving the screen stops any sound (05 section 9.3).
  const stopAll = sounds.stopAll;
  useEffect(() => () => stopAll(), [stopAll]);

  // Ranked countdown announcements at 10 and 5 seconds (05 section 14 item 7).
  const lastRemaining = useRef<number | null>(null);
  useEffect(() => {
    if (!scanning || !scan) {
      lastRemaining.current = null;
      return;
    }
    const crossed = mode === 'ranked' ? countdownCrossing(lastRemaining.current, scan.remainingSec) : null;
    lastRemaining.current = scan.remainingSec;
    if (crossed !== null) announce(copy('scan.startingIn', { n: crossed }));
  }, [scan, scanning, mode, announce]);

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
    // Audio may have closed since the reveal (the page was hidden, 05 W2): reopen it inside this gesture; a live
    // context is reused at once. The take waits for the unlock.
    svc.session.ensureAudio().catch(() => undefined);
    svc.session.startTake().catch(() => undefined);
  }, [svc.session]);

  const doSkip = useCallback(
    async (leave: boolean) => {
      // A scale is not a piece: no "That was" credit after it (PLAN ruling 68).
      const source = svc.session.prepared?.scale ? undefined : svc.session.prepared?.source;
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

  const isScale = prepared?.scale !== undefined;
  const leave = useCallback(() => {
    // A scale is free to leave: nothing is seen or burned, so there is no skip to confirm.
    if (scanning && !isScale) {
      setLeaveAfterSkip(true);
      setDialog('skip');
    } else navigate('/');
  }, [scanning, isScale, navigate]);

  const shortcuts = settings.accessibility.keyboardShortcuts;
  const press = sounds.press;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isInteractive(e.target) || openOverlayCount() > 0) return;
      if (e.key === ' ' && covered && prepared) {
        e.preventDefault();
        startScan();
      } else if ((e.key === ' ' || e.key === 'Enter') && scanning) {
        e.preventDefault();
        startPlaying();
      } else if ((e.key === 'l' || e.key === 'L') && scanning && shortcuts) {
        e.preventDefault();
        press('listen');
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [covered, scanning, prepared, startScan, startPlaying, press, shortcuts]);

  // Highlights (04 section 5.3): the row under the pointer; gone when the read-through ends.
  const shown = hovered;
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

  const calStatus = useReadable(svc.calibrationStatus ?? NO_CAL);
  const calibrate = useCallback(() => navigate('/calibrate'), [navigate]);

  const routeAttrs = { 'data-testid': 'screen-practice.scan', 'data-route-id': 'practice.scan' } as const;

  if (error) {
    const retryable = error.code !== 'empty-pool';
    const tryAgain = (): void => {
      // The failed step runs again. A take that could not start reopens audio from this tap first (05 W1, W4).
      if (svc.session.prepared && error.code !== 'corpus-load') svc.session.ensureAudio().catch(() => undefined);
      if (svc.session.retry?.() !== true) navigate('/');
    };
    // A try that could not start (01-ux §9, 04-design §9a): the sound or the microphone screen. A blocked microphone
    // keeps its own line, which says what to change.
    if (error.kind && error.code !== 'mic-denied') {
      return (
        <section className="scan" {...routeAttrs} data-state="error" data-error={error.code} data-error-kind={error.kind}>
          <ErrorKindScreen kind={error.kind} onTryAgain={tryAgain} onBackToPractice={() => navigate('/')} {...(svc.diagnostics ? { diagnostics: svc.diagnostics } : {})} />
        </section>
      );
    }
    return (
      <section className="scan" {...routeAttrs} data-state="error" data-error={error.code}>
        <div className="scan-error" role="alert">
          <p className="scan-error-text">{copy(SESSION_ERROR_TEXT[error.code])}</p>
          {error.detail ? <p className="scan-error-detail">{copy('error.details', { detail: error.detail })}</p> : null}
          <div className="scan-error-actions">
            {retryable ? <Button label={copy('action.tryAgain')} variant="primary" onClick={tryAgain} /> : null}
            <Button label={copy('action.backToPractice')} variant={retryable ? 'secondary' : 'primary'} onClick={() => navigate('/')} />
          </div>
        </div>
      </section>
    );
  }

  const bpm = prepared?.selection.settings.bpm ?? 60;
  const requestedBars = settings.practice.bars;
  const note = prepared && !prepared.scale ? servedBarsNote(prepared, requestedBars) : null;
  const sLine = prepared && !prepared.scale ? sourceLine(prepared.source) : null;
  const scaleChip = prepared?.scale ? copy('scales.scan.chip', { title: scaleTitle(prepared.scale) }) : null;
  // Practice has no reading timer: the same line for the whole read-through. Ranked says when the count-in is near.
  const soon = startingInSeconds(mode, remainingSec);
  const readHint = mode === 'practice' ? copy('scan.practice.readHint') : soon !== null ? copy('scan.ranked.soon', { seconds: soon }) : null;
  const look = prepared && showStars ? <LookList prepared={prepared} onRowFocus={setHovered} heading /> : null;
  const startLine = prepared
    ? onStartLine(prepared, svc.configs, svc.configs.instrumentById[prepared.instrumentId]?.family === 'voice', settings.practice.autoReference !== false)
    : '';
  const calibration = calStatus ? <CalStatusPill status={calStatus} variant="line" readThrough onCalibrate={calibrate} className="scan-cal" /> : null;

  return (
    <section className="scan" {...routeAttrs} data-state={state} data-mode={mode} data-layout={docked ? 'dock' : 'side'}>
      <Toolbar
        prepared={prepared}
        reason={practiceReason}
        menu={!isScale || (docked && calStatus !== null)}
        mode={mode}
        scanning={scanning}
        remainingSec={remainingSec}
        totalSec={totalSec}
        onHome={leave}
        overflowOpen={overflowOpen}
        setOverflowOpen={setOverflowOpen}
        setOverflowAnchor={setOverflowAnchor}
      />
      <p className="ui-visually-hidden" role="status" aria-live="polite" data-testid="scan-announce" key={said.n}>
        {said.text}
      </p>
      <Popover open={overflowOpen} anchor={overflowAnchor} label={OVERFLOW_LABEL} onClose={() => setOverflowOpen(false)}>
        <div className="scan-menu" role="menu">
          {docked && calStatus ? (
            <button
              type="button"
              role="menuitem"
              className="scan-menu-item scan-menu-cal"
              data-testid="scan-menu-cal"
              onClick={() => {
                setOverflowOpen(false);
                calibrate();
              }}
            >
              <span className="scan-menu-cal-lead">{calTexts(calStatus).lead}</span>
              <span className="scan-menu-cal-note">{`${calTexts(calStatus).action}. ${copy('calStatus.readthrough.note')}`}</span>
            </button>
          ) : null}
          {isScale ? null : (
            <>
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
                  setLeaveAfterSkip(false);
                  setDialog('skip');
                }}
              >
                {copy('scan.overflow.skip')}
              </button>
            </>
          )}
        </div>
      </Popover>
      {covered ? (
        <Cover
          prepared={prepared}
          mode={mode}
          totalSec={totalSec}
          listening={settings.practice.listening}
          onShow={startScan}
          onSkip={() => void doSkip(false)}
          onPracticeInstead={() => void svc.practiceInstead()}
        />
      ) : null}
      {scanning && prepared ? (
        <div className="scan-body" ref={sideRef}>
          <div className="scan-main">
            {docked ? (
              <p className="scan-summary scan-summary-line">
                <BeatUnitText text={scanSummary(prepared)} />
              </p>
            ) : null}
            {docked && calibration ? <div className="scan-cal-phone">{calibration}</div> : null}
            {note || sLine || scaleChip ? (
              <div className="scan-notes">
                {scaleChip ? (
                  <span className="scan-quiet-chip" data-testid="scan-scale-chip">
                    {scaleChip}
                  </span>
                ) : null}
                {note ? <span className="scan-quiet-chip">{note}</span> : null}
                {sLine ? (
                  <button type="button" className="scan-source-line" onClick={() => setDialog('licence')}>
                    {sLine}
                  </button>
                ) : null}
              </div>
            ) : null}
            {!settings.practice.listening ? <PractiseWithoutListeningNotice /> : null}
            {wakeLockFailed ? <p className="scan-hint">{copy('scan.wakeLockHint')}</p> : null}
            <div className="scan-paper" ref={frameWrap}>
              <ScoreFrame
                ref={frameRef}
                loadNotation={svc.loadNotation}
                excerpt={prepared}
                bpm={bpm}
                arrangement="all"
                purpose="read"
                highlightKey={sounds.highlight.key}
                firstNoteName={sounds.highlight.firstNote}
                highlightBar={sounds.highlight.bar}
                sounding={sounds.sounding}
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
            </div>
            {readHint ? (
              <p className="scan-read-hint" data-testid="scan-read-hint">
                {readHint}
              </p>
            ) : null}
            {!docked && look ? <section className="scan-stars-card">{look}</section> : null}
          </div>
          {docked ? (
            <PhoneDock sounds={sounds} onStart={startPlaying} peek={copy('scan.peek')} onPeek={() => setStarsOpen(true)} beatLine={beatLineSwitch} />
          ) : (
            <DesktopSide sounds={sounds} onStart={startPlaying} startLine={startLine} calibration={calibration} beatLine={beatLineSwitch} />
          )}
        </div>
      ) : null}
      {scanning && docked ? (
        <Sheet open={starsOpen} title={copy('stars.heading')} onClose={() => setStarsOpen(false)}>
          <TuningRow model={sounds.model} onPress={sounds.press} />
          {prepared && showStars ? <LookList prepared={prepared} onRowFocus={setHovered} heading={false} /> : null}
        </Sheet>
      ) : null}
      <ListenConfirm open={sounds.confirmOpen && scanning && mode === 'ranked'} secondsLeft={Math.ceil(remainingSec - 1e-9)} onKeepRanked={sounds.keepRanked} onListen={sounds.listenMakePractice} />
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
