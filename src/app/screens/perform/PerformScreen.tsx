// Performance (04 section 5.4; D7): toolbar with Stop, beat dots, input meter and chip; the frozen score frame; the
// status line. The overlay is driven straight from `session.events` into the frame controller, so a take never
// re-renders React per follower event; only leaf components (beat dots, meter) update, and only when what they draw changes.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FollowerEvent, SessionEvent } from '../../../core/types.ts';
import { visualStateFromJudgment } from '../../../notation/visual-states.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { BeatDots, BeatUnitText, LevelMeter } from '../../../ui/components/domain/index.ts';
import { Button } from '../../../ui/components/form/index.ts';
import { Modal, openOverlayCount } from '../../../ui/primitives/index.ts';
import { ScoreFrame, type ScoreFrameController } from '../../../ui/score-frame/index.ts';
import { lineRange } from '../../../ui/layout-table.ts';
import { useNavigate } from '../../router.tsx';
import type { ScreenProps } from '../../route-types.ts';
import { barCount, meterString, sourceLine } from '../scan/model.ts';
import { useReadable, useStoreSlice, useWindowInfo } from '../scan/hooks.ts';
import { usePracticeFlowServices, type PracticeFlowServices } from '../scan/services.ts';
import { barTempoText, beatGrouping, beatInBar, countInBeat, meterStep, statusMessage, stopVariant } from './model.ts';
import { PractiseWithoutListeningNotice } from '../states/States.tsx';
import './perform.css';

/** Applies one follower event to the overlay (the S1 reference wiring). */
export function applyToFrame(frame: ScoreFrameController, ev: FollowerEvent): void {
  if (ev.type === 'clock') frame.setPlayhead(ev.scoreBeat);
  else if (ev.type === 'judgment') frame.setNoteState(ev.judgment.expectedIdx, visualStateFromJudgment(ev.judgment));
  else if (ev.type === 'missed') frame.setNoteState(ev.expectedIdx, { phase: 'missed' });
  else if (ev.type === 'ghost') frame.showGhost(ev.ghost);
}

function useSessionEvents(svc: PracticeFlowServices, on: (e: SessionEvent) => void): void {
  const latest = useRef(on);
  latest.current = on;
  useEffect(() => svc.session.events.on((e) => latest.current(e)), [svc.session]);
}

/** Beat dots, or the large count-in numbers: re-renders once per beat. */
function BeatIndicator({ svc, beatsPerBar, grouping, bpm }: { svc: PracticeFlowServices; beatsPerBar: number; grouping: number[] | undefined; bpm: number }) {
  const [shown, setShown] = useState<{ beat: number | null; countIn: boolean }>({ beat: null, countIn: svc.session.state === 'count-in' });
  const last = useRef(shown);
  useSessionEvents(svc, (e) => {
    // Set state only when what the dots draw changes: a clock tick inside a beat costs nothing.
    const set = (beat: number | null, countIn: boolean): void => {
      if (last.current.beat === beat && last.current.countIn === countIn) return;
      last.current = { beat, countIn };
      setShown(last.current);
    };
    if (e.type === 'count-in') set(countInBeat(e.beat, beatsPerBar), true);
    else if (e.type === 'count-in-restart') set(null, true);
    else if (e.type === 'follower' && e.event.type === 'clock') {
      if (e.event.scoreBeat >= 0) set(beatInBar(e.event.scoreBeat, beatsPerBar), false);
    } else if (e.type === 'state' && e.state === 'performing') set(last.current.beat, false);
  });
  return <BeatDots beatsPerBar={beatsPerBar} currentBeat={shown.beat} countIn={shown.countIn} bpm={bpm} {...(grouping ? { grouping } : {})} />;
}

/** The input meter: updates only when the drawn bar or zone changes. */
function LiveMeter({ svc }: { svc: PracticeFlowServices }) {
  const gate = svc.inputGateDb ?? -50;
  const [m, setM] = useState({ db: -80, clipping: false });
  const last = useRef(m);
  useSessionEvents(svc, (e) => {
    if (e.type !== 'follower' || e.event.type !== 'level') return;
    const { levelDb, clipping } = e.event;
    if (last.current.clipping === clipping && meterStep(last.current.db) === meterStep(levelDb)) return;
    last.current = { db: levelDb, clipping };
    setM(last.current);
  });
  return <LevelMeter levelDb={m.db} gateDb={gate} clipping={m.clipping} />;
}

export function PerformScreen(_props: ScreenProps) {
  const svc = usePracticeFlowServices();
  const navigate = useNavigate();
  const state = useStoreSlice(svc.view, (v) => v.state);
  const prepared = useStoreSlice(svc.view, (v) => v.prepared);
  const bar = useStoreSlice(svc.view, (v) => v.bar);
  const status = useStoreSlice(svc.view, (v) => v.status);
  const firstNoteHeard = useStoreSlice(svc.view, (v) => v.firstNoteHeard);
  const settings = useReadable(svc.settings);
  const { short } = useWindowInfo();

  const frameRef = useRef<ScoreFrameController | null>(null);
  const queue = useRef<FollowerEvent[]>([]);
  const stopRef = useRef<HTMLDivElement>(null);
  const [frozen, setFrozen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [lines, setLines] = useState<{ first: number; last: number; total: number } | null>(null);

  const liveMode = settings.display.liveFeedback === 'full' ? 'live' : 'blind';
  const mode = svc.session.pending?.mode ?? 'ranked';
  const listening = settings.practice.listening;

  // The take is the session's: follow its state.
  useEffect(() => {
    if (state === 'results') navigate('/practice/results', { replace: true });
    else if (state === 'covered' || state === 'scanning') navigate('/practice/scan', { replace: true });
    else if (state === 'idle') navigate('/', { replace: true });
  }, [state, navigate]);

  useEffect(() => {
    stopRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, []);

  // Straight to the overlay; events that arrive before the frame is laid out wait in a queue.
  useSessionEvents(svc, (e) => {
    const f = frameRef.current;
    if (e.type === 'follower') {
      if (f) applyToFrame(f, e.event);
      else if (e.event.type !== 'clock' && e.event.type !== 'level') queue.current.push(e.event);
    } else if (e.type === 'count-in' && f && e.beat === e.of) f.setNoteState(0, { phase: 'active' });
  });

  useEffect(() => {
    frameRef.current?.setMode(liveMode);
  }, [liveMode]);

  const onLayout = useCallback(
    (_info: unknown, frame: ScoreFrameController) => {
      frameRef.current = frame;
      frame.setMode(liveMode);
      for (const ev of queue.current.splice(0)) applyToFrame(frame, ev);
      setFrozen(true); // the layout is final for this take (04 section 4.4)
    },
    [liveMode],
  );

  const stopNow = useCallback(() => {
    setConfirm(false);
    svc.session.stop().catch(() => undefined);
  }, [svc.session]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented || openOverlayCount() > 0) return;
      e.preventDefault();
      stopNow(); // Esc stops at once, with no sheet (04 section 8.5)
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [stopNow]);

  const stopFully = useCallback(async () => {
    setConfirm(false);
    try {
      await svc.session.stop();
      // A ranked stop before the first note restarts the count-in once; the player's Stop means stop, so ask again.
      const s = svc.session.state;
      if (s === 'count-in' || s === 'performing') await svc.session.stop();
    } catch {
      /* the session reports its own error */
    }
  }, [svc.session]);

  if (!prepared) return <section className="perform" data-testid="screen-practice.play" data-route-id="practice.play" aria-busy="true" />;

  const meter = meterString(prepared);
  const bpm = prepared.selection.settings.bpm;
  const totalBars = barCount(prepared);
  const variant = stopVariant(mode, listening, firstNoteHeard);
  const finishing = state === 'finishing';
  const message = statusMessage({ state, status, bar, totalBars });
  const quiet = status === null && state !== 'count-in';
  const source = sourceLine(prepared.source);
  const centreText = finishing ? copy('results.scoring') : quiet || !short ? barTempoText(bar, meter, bpm) : message;
  const announce = state === 'count-in' ? copy('a11y.countIn.announce') : finishing ? copy('a11y.take.finished') : '';

  return (
    <section className="perform" data-testid="screen-practice.play" data-route-id="practice.play" data-state={state} data-mode={mode}>
      <header className="perform-toolbar">
        <div ref={stopRef} className="perform-stop">
          <Button label={copy('play.stop')} variant="secondary" icon="stop" onClick={() => setConfirm(true)} disabled={finishing} />
        </div>
        <div className="perform-centre">
          <BeatIndicator svc={svc} beatsPerBar={prepared.meter.countsPerBar} grouping={beatGrouping(prepared.meter.beats, prepared.meter.beatType, prepared.meter.countsPerBar)} bpm={bpm} />
          <span className="perform-centre-text"><BeatUnitText text={centreText} /></span>
          {finishing ? <span className="perform-indeterminate" aria-hidden="true" /> : null}
        </div>
        <div className="perform-right">
          {listening ? <LiveMeter svc={svc} /> : null}
          {lines ? <span className="perform-lines">{copy('score.lines', { from: lines.first + 1, to: lines.last + 1, total: lines.total })}</span> : null}
          <span className="perform-chip" data-mode={mode}>
            {copy(mode === 'ranked' ? 'badge.ranked' : 'badge.practice')}
          </span>
        </div>
      </header>
      {listening ? null : <PractiseWithoutListeningNotice />}
      <div className="perform-score" data-testid="perform-score">
        <ScoreFrame
          ref={frameRef}
          loadNotation={svc.loadNotation}
          excerpt={prepared}
          bpm={bpm}
          frozen={frozen}
          {...(svc.reducedMotion ? { reducedMotion: svc.reducedMotion } : {})}
          {...(svc.highContrast ? { highContrast: svc.highContrast } : {})}
          label={copy('score.summaryLabel', { bars: totalBars, key: '', meter, clef: prepared.clef, tempo: copy('tempo.marking', { unit: '♩', bpm }) })}
          onLayout={onLayout}
          onSlotsChange={(slots, total) => setLines(total > slots.length ? { ...lineRange(slots), total } : null)}
          onFrozenResize={(r) => {
            if (r.orientationChanged && svc.session.state === 'count-in') svc.session.restartCountIn?.('rotation');
          }}
        />
      </div>
      {short ? (
        source ? <p className="perform-source">{source}</p> : null
      ) : (
        <footer className="perform-status">
          <span>{message}</span>
          {source ? <span className="perform-source">{source}</span> : null}
          <span><BeatUnitText text={copy('tempo.marking', { unit: '♩', bpm })} /></span>
        </footer>
      )}
      <p className="ui-visually-hidden" role="status" aria-live="polite">
        {announce}
      </p>
      {confirm ? (
        <Modal open title={variant === 'practice' ? copy('play.stopConfirm.practice') : variant === 'ranked-before-note' ? copy('play.stopConfirm.ranked.beforeNote') : copy('play.stopConfirm.ranked.afterNote')} onClose={() => setConfirm(false)}>
          <div className="perform-dialog-actions">
            {variant === 'ranked-before-note' ? (
              <>
                <Button label={copy('action.restart')} variant="primary" data-autofocus onClick={stopNow} />
                <Button label={copy('action.stop')} variant="secondary" onClick={() => void stopFully()} />
              </>
            ) : (
              <>
                <Button label={copy('action.keepPlaying')} variant="primary" data-autofocus onClick={() => setConfirm(false)} />
                <Button label={copy('action.stop')} variant="secondary" onClick={stopNow} />
              </>
            )}
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

