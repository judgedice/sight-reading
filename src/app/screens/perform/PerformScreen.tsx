// Performance (04 section 5.4; D7): toolbar with Stop, beat dots, input meter and chip; the frozen score frame; the
// status line. The overlay is driven straight from `session.events` into the frame controller, so a take never
// re-renders React per follower event; only leaf components (beat dots, meter) update, and only when what they draw changes.
// Round 2 (01-ux §10, §11, §15.1; 04-design §5, §7): the starting-pitch card and the count-in track share the cue zone
// above the first system; only brass marks before bar 1; live marks are filtered by `display.ghostsLive` and difficulty.
// Beat line (round 2): what moves with the beat (the beat line, the count-in track, the beat dots, the bar number and
// the page turns) follows the audible clock in one frame loop (`BeatDriver`), so the screen moves with the clicks the
// player hears; the follower's clock, which runs a microphone round trip late, no longer moves anything on screen.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FollowerEvent, SessionEvent } from '../../../core/types.ts';
import { visualStateFromJudgment } from '../../../notation/visual-states.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { countInBarsFor, idleSoundView, type SoundCaption, type SoundView } from '../../../session/index.ts';
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
import {
  MIC_BARS,
  beatGrouping,
  beatInBar,
  countInBarText,
  countInPosition,
  countInTitle,
  entryCount,
  ghostsLiveAt,
  liveEventAllowed,
  meterBars,
  referenceSteps,
  statusMessage,
  stopVariant,
  type LiveFilter,
  type PitchStep,
} from './model.ts';
import { PractiseWithoutListeningNotice } from '../states/States.tsx';
import { musicFacts, timingFromCountIn, timingOf, type TakeTiming } from './beat-clock.ts';
import { BeatDriver, type BeatView } from './beat-driver.ts';
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

/**
 * The strip's beat dots during the try: re-render once per beat. The count-in has its track instead (04-design §5).
 * With `beat` (the audible clock's beat in the bar) the dots show it; without, they follow the follower's clock.
 */
function BeatIndicator({ svc, beatsPerBar, grouping, bpm, beat: driven }: { svc: PracticeFlowServices; beatsPerBar: number; grouping: number[] | undefined; bpm: number; beat?: number | null }) {
  const [heard, setBeat] = useState<number | null>(null);
  const last = useRef<number | null>(null);
  const beat = driven === undefined ? heard : driven;
  useSessionEvents(svc, (e) => {
    if (driven !== undefined) return;
    // Set state only when what the dots draw changes: a clock tick inside a beat costs nothing.
    const set = (next: number | null): void => {
      if (last.current === next) return;
      last.current = next;
      setBeat(next);
    };
    if (e.type === 'follower' && e.event.type === 'clock') {
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
  return <span className="perform-pitch-pending" aria-hidden="true" />;
}

/** Voice, before the count-in (01-ux §10; 04-design §5 R0 to R3): the starting-pitch card in the cue zone. */
function StartingPitchCard({ chord, note, steps }: { chord: string; note: string; steps: { chord: PitchStep; note: PitchStep; next: boolean } }) {
  return (
    <div className="perform-pitch" data-testid="perform-pitch">
      <span className="perform-pitch-icon" aria-hidden="true">
        <Glyph id="pitch" size={24} />
      </span>
      <div className="perform-pitch-body">
        <p className="perform-pitch-title">{copy('countIn.reference')}</p>
        <p className="perform-pitch-why">{copy('countIn.reference.why')}</p>
        <p className="perform-pitch-steps">
          <span className="perform-pitch-step" data-step={steps.chord}>
            <StepMark step={steps.chord} />
            {chord}
          </span>
          <span className="perform-pitch-step" data-step={steps.note}>
            <StepMark step={steps.note} />
            {note}
          </span>
          {steps.next ? <span className="perform-pitch-next">{copy('countIn.reference.next')}</span> : null}
        </p>
      </div>
    </div>
  );
}

const REFERENCE_CAPTIONS = new Set<SoundCaption['kind']>(['key-chord', 'first-note', 'count-in-next']);

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
  const countIn = useStoreSlice(svc.view, (v) => v.countIn);

  const frameRef = useRef<ScoreFrameController | null>(null);
  // The audible clock (production): the beat line, track, dots, bar number and turns follow it, not session events.
  const audibleNow = svc.audibleNow;
  const driven = audibleNow !== undefined;
  const [beatView, setBeatView] = useState<BeatView | null>(null);
  const countInTiming = useRef<TakeTiming | null>(null);
  const queue = useRef<FollowerEvent[]>([]);
  const stopRef = useRef<HTMLDivElement>(null);
  const [frozen, setFrozen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [bars, setBars] = useState<{ first: number; last: number; total: number } | null>(null);
  // The starting pitch played (its caption was seen) and the count-in started (a click was heard): the card never
  // comes back after the first click, even when the count-in restarts.
  const [heardReference, setHeardReference] = useState(false);
  const [clicked, setClicked] = useState(false);
  // Count-in clicks heard so far: from the audible clock when it drives the screen, else from the session's events.
  const heardClick = driven ? (beatView?.click ?? 0) : (countIn?.beat ?? 0);
  if (referencing && !heardReference) setHeardReference(true);
  if (heardClick > 0 && !clicked) setClicked(true);
  const beatLineOn = settings.display.beatLine !== false;
  const beatLineRef = useRef(beatLineOn);
  beatLineRef.current = beatLineOn;

  const liveMode = settings.display.liveFeedback === 'full' ? 'live' : 'blind';
  const mode = svc.session.pending?.mode ?? 'ranked';
  const listening = settings.practice.listening;

  // What may reach the overlay live (PLAN R61; 01-ux §15.1): ghosts and extras only when `display.ghostsLive` allows
  // them at this difficulty; at the calm difficulties a note is marked only once the follower is sure.
  const level = prepared?.levelServed ?? 1;
  const calmUpTo = svc.configs.grading.ui.calmLiveUpTo;
  const marks = useMemo(
    () => ({ ghosts: ghostsLiveAt(settings.display.ghostsLive, level, calmUpTo), calm: level <= calmUpTo }),
    [settings.display.ghostsLive, level, calmUpTo],
  );
  const marksRef = useRef(marks);
  marksRef.current = marks;
  const filterNow = (): LiveFilter => ({ ...marksRef.current, beforeMusic: svc.session.state === 'count-in' });

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

  // Straight to the overlay; events that arrive before the frame is laid out wait in a queue. Only brass marks before
  // bar 1 (01-ux §10): no ghost of any kind while the count-in (or the starting pitch) runs.
  useSessionEvents(svc, (e) => {
    // A restarted count-in starts the music again: the page goes back to the start until the clock is in the music.
    if (e.type === 'count-in-restart') {
      countInTiming.current = null;
      frameRef.current?.setPlayhead(null);
    }
    if (e.type === 'count-in' && prepared) countInTiming.current = timingFromCountIn({ beat: e.beat, of: e.of, t: e.t as number }, prepared.selection.settings.bpm);
    if (e.type !== 'follower' || !liveEventAllowed(e.event, filterNow())) return;
    // With the audible clock driving the screen, the follower's clock (a round trip late) moves nothing.
    if (driven && e.event.type === 'clock') return;
    const f = frameRef.current;
    if (f) applyToFrame(f, e.event);
    else if (e.event.type !== 'clock' && e.event.type !== 'level') queue.current.push(e.event);
  });

  // The downbeat (04-design §5, M1): the track goes and the first note's ring pulses once, when the player hears it.
  const musicHeard = state === 'performing' && (!driven || beatView?.music === true);
  useEffect(() => {
    if (musicHeard && frozen) frameRef.current?.pulseFirstNote();
  }, [musicHeard, frozen]);

  // The frame loop: from the layout to the end of the try, every frame reads the audible clock and moves the beat
  // line and the playhead in the frame; React hears only when the click, the beat or the bar changes.
  useEffect(() => {
    const frame = frameRef.current;
    const win = typeof window === 'undefined' ? null : window;
    if (!audibleNow || !frozen || !frame || !prepared || !win || typeof win.requestAnimationFrame !== 'function') return;
    const facts = musicFacts(prepared, Infinity);
    const driver = new BeatDriver({
      audibleNow,
      timing: () => (svc.session.takeClock !== undefined ? timingOf(svc.session.takeClock) : countInTiming.current),
      facts,
      frame,
      lineOn: () => beatLineRef.current,
      reducedMotion: () => svc.reducedMotion?.() ?? false,
      onView: setBeatView,
      requestFrame: (cb) => win.requestAnimationFrame(cb),
      cancelFrame: (id) => win.cancelAnimationFrame(id),
    });
    driver.start();
    return () => driver.stop();
  }, [audibleNow, frozen, prepared, svc]);

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
  // The count-in lasts until the player hears the music start (a pickup starts in the count-in's last bar).
  const counting = state === 'count-in' || (driven && state === 'performing' && beatView?.music !== true);
  const shownBar = driven ? (beatView?.bar ?? null) : bar;
  const message = statusMessage({ state: counting ? 'count-in' : state, status, bar: shownBar, totalBars });
  const source = sourceLine(prepared.source);
  const inst = svc.configs.instrumentById[prepared.instrumentId];
  const voice = inst?.family === 'voice';
  const bpb = prepared.meter.countsPerBar;
  const tempo = tempoOf(prepared);
  const tempoText = tempo.unit === '♩' ? copy('countIn.tempo', { bpm }) : copy('tempo.marking', { unit: tempo.unit, bpm });

  // Voice: the starting pitch plays first, in every mode (R7), unless the player turned it off. Its card holds the cue
  // zone from Start until the first click; the score is dimmed only then (01-ux §10).
  const referenceFirst = voice && settings.practice.autoReference !== false;
  const pitchPhase = counting && referenceFirst && !clicked && status?.kind !== 'restarting-count-in';
  const refCaption = referencing && caption && REFERENCE_CAPTIONS.has(caption.kind) ? caption : null;
  const steps = referenceSteps(refCaption ? (refCaption.kind as 'key-chord' | 'first-note' | 'count-in-next') : null, heardReference);

  // The count-in track (01-ux §11): bars from the session's clicks once they start, from the level before.
  const ciBars = countIn && countIn.of > 0 ? Math.max(1, Math.round(countIn.of / bpb)) : countInBarsFor(svc.configs, prepared.levelServed, bpm);
  const pos = countInPosition(heardClick, bpb, ciBars);
  const entry = copy(voice ? 'countIn.entry.voice' : 'countIn.entry.instrument');
  const entryAfter = entryCount(prepared);

  const centreText = finishing ? copy('results.scoring') : pitchPhase ? copy('action.hearReference.short') : message;
  const announce = counting ? copy('a11y.countIn.announce.bars', { total: ciBars, beats: bpb }) : finishing ? copy('a11y.take.finished') : '';
  const first = firstNoteOf(prepared);
  // Brass marks only before bar 1: the key-signature band during the chord, the ring and the note's name during the
  // first note, the ring alone in the beat after, then the ring with the entry word from the last bar's first click.
  const refHighlight = highlightFor(prepared, pitchPhase ? refCaption : null, null);
  const firstNoteName = pitchPhase ? (refHighlight.firstNote ?? (steps.next ? '' : null)) : counting && clicked && pos.last && heardClick > 0 ? entry : null;
  const band = !counting ? null : pitchPhase ? (
    <StartingPitchCard
      chord={copy('reference.playing.chord', { key: keyName(prepared.writtenKey) })}
      note={copy('reference.playing.first', { note: first ? firstNoteLabel(first.written, first.concertMidi) : '' })}
      steps={steps}
    />
  ) : (
    <CountInBand
      click={heardClick}
      beatsPerBar={bpb}
      bars={ciBars}
      title={countInTitle(pos, entryAfter)}
      detail={<BeatUnitText text={`${countInBarText(pos)} · ${tempoText}`} />}
      entry={entry}
      entryAfter={entryAfter}
    />
  );
  // The strip says "Marks start at bar 1" during the starting pitch, in place of the mic meter (05 D7; 04-design §5 R0).
  // From the first click it says "Count-in" with the mic meter, and the track is the only beat display.
  const marksStart = pitchPhase;

  return (
    <section className="perform" data-testid="screen-practice.play" data-route-id="practice.play" data-state={state} data-mode={mode}>
      <header className="perform-toolbar">
        <div ref={stopRef} className="perform-stop">
          <Button label={copy('play.stop')} variant="secondary" size="compact" icon="stop" onClick={() => setConfirm(true)} disabled={finishing} aria-describedby={finishing ? 'perform-centre-text' : undefined} />
        </div>
        <div className="perform-centre">
          {counting ? null : (
            <BeatIndicator svc={svc} beatsPerBar={bpb} grouping={beatGrouping(prepared.meter.beats, prepared.meter.beatType, bpb)} bpm={bpm} {...(driven ? { beat: beatView?.beatInBar ?? null } : {})} />
          )}
          <span id="perform-centre-text" className="perform-centre-text">{centreText}</span>
          <span className="perform-tempo"><BeatUnitText text={copy('tempo.marking', { unit: tempo.unit, bpm })} /></span>
          {finishing ? <span className="perform-indeterminate" aria-hidden="true" /> : null}
        </div>
        <div className="perform-right">
          {driven && svc.setBeatLine ? (
            <Button
              label={copy('play.beatLine')}
              variant="quiet"
              size="compact"
              className="perform-beatline"
              aria-pressed={beatLineOn}
              onClick={() => svc.setBeatLine?.(!beatLineOn)}
            />
          ) : null}
          {bars ? <span className="perform-lines">{copy('score.bars', { from: bars.first, to: bars.last, total: bars.total })}</span> : null}
          {marksStart ? <span className="perform-marks-start">{copy('countIn.marksStart')}</span> : listening ? <MicMeter svc={svc} /> : null}
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
          dim={pitchPhase}
          highlightKey={refHighlight.key}
          firstNoteName={firstNoteName}
          {...(svc.reducedMotion ? { reducedMotion: svc.reducedMotion } : {})}
          {...(svc.highContrast ? { highContrast: svc.highContrast } : {})}
          label={copy('score.summaryLabel', { bars: totalBars, key: '', meter, clef: prepared.clef, tempo: copy('tempo.marking', { unit: tempo.unit, bpm }) })}
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

