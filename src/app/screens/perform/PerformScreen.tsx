// Performance (04 section 5.4; D7): toolbar with Stop, beat dots, input meter and chip; the frozen score frame; the
// status line. The overlay is driven straight from `session.events` into the frame controller, so a take never
// re-renders React per follower event; only leaf components (beat dots, meter) update, and only when what they draw changes.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FollowerEvent, SessionEvent } from '../../../core/types.ts';
import { visualStateFromJudgment } from '../../../notation/visual-states.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { idleSoundView, type SoundView } from '../../../session/index.ts';
import { createStore } from 'zustand/vanilla';
import { BeatDots, BeatUnitText, meterZone } from '../../../ui/components/domain/index.ts';
import { Button } from '../../../ui/components/form/index.ts';
import { Glyph, Modal, openOverlayCount } from '../../../ui/primitives/index.ts';
import { CountInBand, ScoreFrame, type ScoreFrameController } from '../../../ui/score-frame/index.ts';
import { useNavigate } from '../../router.tsx';
import type { ScreenProps } from '../../route-types.ts';
import { barCount, meterString, sourceLine } from '../scan/model.ts';
import { useReadable, useStoreSlice } from '../scan/hooks.ts';
import { usePracticeFlowServices, type PracticeFlowServices } from '../scan/services.ts';
import { firstNoteLabel, firstNoteOf, highlightFor, tempoOf } from '../scan/read-model.ts';
import { keyName } from '../setup/key-names.ts';
import { MIC_BARS, barTempoText, beatGrouping, beatInBar, countInBeat, meterBars, pitchSteps, statusMessage, stopVariant, type PitchStep } from './model.ts';
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

/** The strip's beat dots: re-render once per beat. Dots in the count-in and in the take (06 section 6.13). */
function BeatIndicator({ svc, beatsPerBar, grouping, bpm }: { svc: PracticeFlowServices; beatsPerBar: number; grouping: number[] | undefined; bpm: number }) {
  const [beat, setBeat] = useState<number | null>(null);
  const last = useRef<number | null>(null);
  useSessionEvents(svc, (e) => {
    // Set state only when what the dots draw changes: a clock tick inside a beat costs nothing.
    const set = (next: number | null): void => {
      if (last.current === next) return;
      last.current = next;
      setBeat(next);
    };
    if (e.type === 'count-in') set(countInBeat(e.beat, beatsPerBar));
    else if (e.type === 'count-in-restart') set(null);
    else if (e.type === 'follower' && e.event.type === 'clock') {
      if (e.event.scoreBeat >= 0) set(beatInBar(e.event.scoreBeat, beatsPerBar));
    }
  });
  return <BeatDots beatsPerBar={beatsPerBar} currentBeat={beat} bpm={bpm} {...(grouping ? { grouping } : {})} />;
}

/** The label of the strip's meter. */
const micLabel = (): string => copy('play.mic');

const MIC_BAR_HEIGHTS = [5, 9, 13, 16, 12, 7, 4] as const; // 06 section 6.13: seven bars, 3 px wide

/** "Mic" with a 7-bar input meter: updates only when the lit bars, the zone or clipping change. */
function MicMeter({ svc }: { svc: PracticeFlowServices }) {
  const gate = svc.inputGateDb ?? -50;
  const [m, setM] = useState({ db: -80, clipping: false });
  const last = useRef(m);
  useSessionEvents(svc, (e) => {
    if (e.type !== 'follower' || e.event.type !== 'level') return;
    const { levelDb, clipping } = e.event;
    const zoneChanged = meterZone(last.current.db, gate, last.current.clipping) !== meterZone(levelDb, gate, clipping);
    if (last.current.clipping === clipping && !zoneChanged && meterBars(last.current.db) === meterBars(levelDb)) return;
    last.current = { db: levelDb, clipping };
    setM(last.current);
  });
  const lit = meterBars(m.db);
  return (
    <span className="perform-mic" data-zone={meterZone(m.db, gate, m.clipping)} aria-hidden="true">
      <span className="perform-mic-label">{micLabel()}</span>
      <span className="perform-mic-bars">
        {MIC_BAR_HEIGHTS.slice(0, MIC_BARS).map((h, i) => (
          <i key={i} data-lit={i < lit ? 'true' : undefined} style={{ blockSize: `${h / 16}rem` }} />
        ))}
      </span>
      {m.clipping ? <span className="perform-mic-bang">{copy('play.meter.clip')}</span> : null}
    </span>
  );
}

const NO_SOUNDS = createStore<SoundView>()(() => idleSoundView());

/** The count-in band's number, dots and "Bar 1 · ♩ = 72": re-renders once per click. */
function CountBand({ svc, beats, caption, frameRef }: { svc: PracticeFlowServices; beats: number; caption: string; frameRef: { current: ScoreFrameController | null } }) {
  const [beat, setBeat] = useState(0);
  // The first digit gives the band its height; the frame re-measures it, so a short window shrinks the number to fit.
  useEffect(() => frameRef.current?.refreshBand(), [beat, frameRef]);
  useSessionEvents(svc, (e) => {
    if (e.type === 'count-in') setBeat(countInBeat(e.beat, beats));
    else if (e.type === 'count-in-restart') setBeat(0);
  });
  return <CountInBand beat={beat} beats={beats} caption={caption} />;
}

function StepMark({ step }: { step: PitchStep }) {
  if (step === 'done') return <Glyph id="check-ui" size={16} />;
  if (step === 'live')
    return (
      <span className="perform-eq" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    );
  return null;
}

/** Voice, before the count-in (06 section 6.12): "Your starting pitch" over the key chord (done) and the live first note. */
function StartingPitchBand({ chord, note, steps }: { chord: string; note: string; steps: { chord: PitchStep; note: PitchStep } }) {
  return (
    <div className="perform-pitch">
      <p className="perform-pitch-title">{copy('countIn.reference')}</p>
      <p className="perform-pitch-steps">
        <span className="perform-pitch-step" data-step={steps.chord}>
          <StepMark step={steps.chord} />
          {chord}
        </span>
        <span className="perform-pitch-step" data-step={steps.note}>
          <StepMark step={steps.note} />
          {note}
        </span>
      </p>
    </div>
  );
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
  const sounds = svc.sounds ?? NO_SOUNDS;
  const referencing = useStoreSlice(sounds, (v) => v.playing === 'reference');
  const caption = useStoreSlice(sounds, (v) => v.caption);

  const frameRef = useRef<ScoreFrameController | null>(null);
  const queue = useRef<FollowerEvent[]>([]);
  const stopRef = useRef<HTMLDivElement>(null);
  const [frozen, setFrozen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [bars, setBars] = useState<{ first: number; last: number; total: number } | null>(null);

  const liveMode = settings.display.liveFeedback === 'full' ? 'live' : 'blind';
  const mode = svc.session.pending?.mode ?? 'ranked';
  const listening = settings.practice.listening;

  // The take is the session's: follow its state.
  useEffect(() => {
    if (state === 'results') navigate('/practice/results', { replace: true });
    // A take that fails to start (or fails mid-way) shows its error, with Try again, on the read-through.
    else if (state === 'covered' || state === 'scanning' || state === 'error') navigate('/practice/scan', { replace: true });
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
  const counting = state === 'count-in';
  const message = statusMessage({ state, status, bar, totalBars });
  const source = sourceLine(prepared.source);
  // Voice: the starting pitch plays first, in every mode (R7); its band and the strip say so until the clicks begin.
  const pitchLive = counting && referencing && (caption?.kind === 'key-chord' || caption?.kind === 'first-note') && status === null;
  const centreText = finishing ? copy('results.scoring') : pitchLive ? copy('action.hearReference.short') : message;
  const announce = counting ? copy('a11y.countIn.announce') : finishing ? copy('a11y.take.finished') : '';
  const first = firstNoteOf(prepared);
  const highlight = highlightFor(prepared, pitchLive ? caption : null, null);
  const tempo = tempoOf(prepared);
  const band = !counting ? null : pitchLive ? (
    <StartingPitchBand
      chord={copy('reference.playing.chord', { key: keyName(prepared.writtenKey) })}
      note={copy('reference.playing.first', { note: first ? firstNoteLabel(first.written, first.concertMidi) : '' })}
      steps={pitchSteps(caption?.kind === 'first-note' ? 'first-note' : 'key-chord')}
    />
  ) : (
    <CountBand svc={svc} beats={prepared.meter.countsPerBar} caption={barTempoText(1, meter, bpm)} frameRef={frameRef} />
  );

  return (
    <section className="perform" data-testid="screen-practice.play" data-route-id="practice.play" data-state={state} data-mode={mode}>
      <header className="perform-toolbar">
        <div ref={stopRef} className="perform-stop">
          <Button label={copy('play.stop')} variant="secondary" size="compact" icon="stop" onClick={() => setConfirm(true)} disabled={finishing} aria-describedby={finishing ? 'perform-centre-text' : undefined} />
        </div>
        <div className="perform-centre">
          <BeatIndicator svc={svc} beatsPerBar={prepared.meter.countsPerBar} grouping={beatGrouping(prepared.meter.beats, prepared.meter.beatType, prepared.meter.countsPerBar)} bpm={bpm} />
          <span id="perform-centre-text" className="perform-centre-text">{centreText}</span>
          <span className="perform-tempo"><BeatUnitText text={copy('tempo.marking', { unit: tempo.unit, bpm })} /></span>
          {finishing ? <span className="perform-indeterminate" aria-hidden="true" /> : null}
        </div>
        <div className="perform-right">
          {bars ? <span className="perform-lines">{copy('score.bars', { from: bars.first, to: bars.last, total: bars.total })}</span> : null}
          {listening ? <MicMeter svc={svc} /> : null}
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
          purpose="take"
          band={band}
          highlightKey={highlight.key}
          firstNoteName={highlight.firstNote}
          {...(svc.reducedMotion ? { reducedMotion: svc.reducedMotion } : {})}
          {...(svc.highContrast ? { highContrast: svc.highContrast } : {})}
          label={copy('score.summaryLabel', { bars: totalBars, key: '', meter, clef: prepared.clef, tempo: copy('tempo.marking', { unit: '♩', bpm }) })}
          onLayout={onLayout}
          onSlotsChange={(slots, total, range) => setBars(total > slots.length ? range : null)}
          onFrozenResize={(r) => {
            if (r.orientationChanged && svc.session.state === 'count-in') svc.session.restartCountIn?.('rotation');
          }}
        />
      </div>
      {source ? <p className="perform-source">{source}</p> : null}
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

