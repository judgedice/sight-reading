import './calibration.css';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Banner, Card } from '../../../ui/components/containers/index.ts';
import { Button, Select } from '../../../ui/components/form/index.ts';
import { Link } from '../../router.tsx';
import { text, type TextKey } from '../states/text.ts';
import { calReducer, calibrationIsMandatoryPath, initialCalState, isIos, methodFor, offsetTick, warningsFor, type CalState, type CalWarning, type DotState } from './flow.ts';
import type { AudioPrefs, CalibrationServices } from './services.ts';
import type { OutputMode } from '../../../core/types.ts';

export type CalibrationResult = 'calibrated' | 'estimate' | 'skipped';

export interface CalibrationCardProps {
  services: CalibrationServices;
  /** Called when the player leaves the card: calibrated, using an estimate, or skipping. */
  onDone(result: CalibrationResult): void;
  /** Shows a Skip control (onboarding, settings). Ignored where calibration is the mandatory path (R16, iOS without reported latency). */
  allowSkip?: boolean;
  /** Onboarding embeds the card under its own heading, so the card drops its title. */
  embedded?: boolean;
}

/** The "Device choice is locked while we listen." line, named by both device selects while they are disabled. */
const LOCKED_ID = 'cal-devices-locked';

const OUTPUT_OPTIONS: readonly { value: OutputMode; key: TextKey }[] = [
  { value: 'speakers', key: 'output.speakers' },
  { value: 'wired', key: 'output.wiredHeadphones' },
  { value: 'bluetooth', key: 'output.bluetooth' },
];

const WARNING_KEY: Record<CalWarning, TextKey> = {
  bluetooth: 'calibrate.warn.bluetooth',
  airpods: 'calibrate.warn.airpods',
  aec: 'calibrate.warn.aec',
};

function dotLabel(state: CalState, i: number, total: number, kind: 'loopback' | 'play-along', d: DotState): string {
  const vars = { n: i + 1, total };
  if (kind === 'play-along' && d !== 'pending') {
    const off = state.offsets[i] ?? null;
    if (off === null) return text('calibrate.dot.noNote', vars);
    const delta = off - (state.rtlMs ?? 0);
    return text(delta < 0 ? 'calibrate.dot.offsetEarly' : 'calibrate.dot.offsetLate', { ...vars, ms: Math.abs(Math.round(delta)) });
  }
  return text(d === 'heard' ? 'calibrate.dot.heard' : d === 'missed' ? 'calibrate.dot.missed' : 'calibrate.dot.pending', vars);
}

/** One mark per click (06 section 6.14): the current one is brass and pulses (it only fills under reduced motion). */
function Dots({ state, total, kind, running }: { state: CalState; total: number; kind: 'loopback' | 'play-along'; running: boolean }) {
  const rtl = state.rtlMs ?? 0;
  const current = running ? state.dots.findIndex((d) => d === 'pending') : -1;
  return (
    <ol className="cal-dots" data-kind={kind}>
      {Array.from({ length: total }, (_, i) => {
        const d: DotState = state.dots[i] ?? 'pending';
        const off = kind === 'play-along' ? state.offsets[i] ?? null : null;
        const tick = off === null ? null : offsetTick(off - rtl);
        return (
          <li key={i} className="cal-dot-cell">
            <span className="cal-dot" role="img" aria-label={dotLabel(state, i, total, kind, d)} data-state={d} data-current={i === current ? 'true' : undefined} />
            {tick !== null ? <span className="cal-tick" aria-hidden="true" data-side={tick < 0 ? 'early' : 'late'} style={{ ['--cal-tick' as string]: String(tick) }} /> : null}
          </li>
        );
      })}
    </ol>
  );
}

function found(state: CalState): number {
  return state.dots.filter((d) => d === 'heard').length;
}

/**
 * Calibration card (04 section 5.9): setup row, loopback or play-along with live dots, audibility check, failures with
 * a next step, warnings. One card for onboarding, Settings > Audio, banners and results prompts.
 */
export function CalibrationCard({ services, onDone, allowSkip = false, embedded = false }: CalibrationCardProps) {
  const [state, dispatch] = useReducer(calReducer, undefined, initialCalState);
  const [prefs, setPrefsState] = useState<AudioPrefs>(() => services.prefs());
  const [devices, setDevices] = useState<{ id: string; label: string }[]>([]);
  const alive = useRef(true);
  const [hearing, setHearing] = useState(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      services.stopSounds?.();
    };
  }, [services]);
  useEffect(() => {
    let live = true;
    void services.inputDevices().then((d) => live && setDevices(d), () => undefined);
    return () => {
      live = false;
    };
  }, [services]);

  const caps = services.capabilities;
  const mandatory = calibrationIsMandatoryPath(caps);
  const method = methodFor(prefs.outputMode);
  const running = state.step === 'loopback-running' || state.step === 'playalong-running';
  const total = state.step.startsWith('playalong') || (state.step === 'idle' && method === 'play-along') || state.method === 'play-along' ? services.playAlongClicks : services.loopbackClicks;

  const changePrefs = (p: Partial<AudioPrefs>): void => {
    setPrefsState((cur) => ({ ...cur, ...p }));
    void services.setPrefs(p);
    dispatch({ type: 'reset' });
  };

  const run = useCallback(
    (kind: 'loopback' | 'play-along') => {
      // The unlock must start inside this click's call stack (05 W1); the rest is async.
      const unlocked = services.unlock();
      dispatch(kind === 'loopback' ? { type: 'start-loopback', clicks: services.loopbackClicks } : { type: 'start-playalong', clicks: services.playAlongClicks });
      void (async () => {
        try {
          const route = await unlocked;
          if (kind === 'loopback') {
            const outcome = await services.runLoopback({ onClick: (index, heard) => alive.current && dispatch({ type: 'click', index, heard }) });
            if (outcome.accepted && outcome.calibration) await services.save(outcome.calibration);
            const warnings = warningsFor({ outputMode: prefs.outputMode, rtlMs: outcome.rtlMs, maxRtlMs: services.maxRtlMs, route, caps, aecSuspected: outcome.aecSuspected });
            if (alive.current) dispatch({ type: 'loopback-done', outcome, warnings });
          } else {
            const outcome = await services.runPlayAlong({ onNote: (index, offsetMs) => alive.current && dispatch({ type: 'note', index, offsetMs }) });
            if (outcome.accepted && outcome.calibration) await services.save(outcome.calibration);
            const warnings = warningsFor({ outputMode: prefs.outputMode, rtlMs: outcome.rtlMs, maxRtlMs: services.maxRtlMs, route, caps, aecSuspected: false });
            if (alive.current) dispatch({ type: 'playalong-done', outcome, warnings });
          }
        } catch {
          if (alive.current) dispatch({ type: 'run-error' });
        }
      })();
    },
    [services, prefs.outputMode, caps],
  );

  const start = (): void => {
    run(method);
    services.stopSounds?.();
    setHearing(false);
  };
  const hear = (): void => {
    if (!services.hearClick) return;
    setHearing(true);
    void services.hearClick().then(
      () => alive.current && setHearing(false),
      () => alive.current && setHearing(false),
    );
  };
  const ios = isIos(caps);
  const showMeasured = state.step === 'measured' || state.step === 'finished';
  const canFinish = state.step === 'finished' || (state.step === 'measured' && (state.method === 'play-along' || state.audibility === 'not-really'));
  const outputOptions = OUTPUT_OPTIONS.map((o) => ({ value: o.value, label: text(o.key) }));
  const inputOptions = [{ value: '', label: text('settings.audio.defaultDevice') }, ...devices.map((d) => ({ value: d.id, label: d.label }))];

  const mayHear = services.hearClick !== undefined && (state.step === 'idle' || state.step === 'measured' || state.step === 'finished');
  const showSkip = allowSkip && !mandatory && !running && state.step !== 'finished';
  const progress = text('calibrate.progress', { found: found(state), total });
  const foundText = String(found(state));
  const body = (
    <section className="cal" data-testid="calibration-card" aria-label={text('action.calibrate')}>
      {ios ? <span className="cal-beta">{text('app.beta')}</span> : null}
      <p className="cal-intro">{text('calibrate.intro')}</p>
      {mandatory ? <p className="cal-intro cal-ios-note">{text('onboarding.calibration.iosNote')}</p> : null}

      <div className="cal-setup">
        <label className="cal-field">
          <span className="cal-label">{text('calibrate.inputDevice')}</span>
          <Select ariaLabel={text('calibrate.inputDevice')} options={inputOptions} value={prefs.inputDeviceId ?? ''} disabled={running} describedBy={LOCKED_ID} onChange={(v) => changePrefs({ inputDeviceId: v === '' ? null : v })} />
        </label>
        <label className="cal-field">
          <span className="cal-label">{text('calibrate.output')}</span>
          <Select ariaLabel={text('calibrate.output')} options={outputOptions} value={prefs.outputMode} disabled={running} describedBy={LOCKED_ID} onChange={(v) => changePrefs({ outputMode: v as OutputMode })} />
        </label>
      </div>
      {running ? <p id={LOCKED_ID} className="cal-locked">{text('calibrate.devicesLocked')}</p> : null}

      <div className="cal-stage">
        {running ? (
          <p className="cal-listening" role="status">
            {text('calibrate.listening')}
          </p>
        ) : null}
        <p className="cal-step-text" data-testid="cal-instruction">
          {method === 'loopback' ? text('calibrate.loopback.intro', { seconds: services.loopbackSeconds }) : text('calibrate.playAlong.intro', { clicks: services.playAlongClicks })}
        </p>
        <Dots state={state} total={total} kind={state.method ?? (state.step.startsWith('playalong') ? 'play-along' : method)} running={running} />
        {state.step === 'playalong-running' ? <p className="cal-pulse">{text('calibrate.playAlong.playNow')}</p> : null}
        {state.step !== 'idle' ? (
          <p className="cal-count">
            {progress.startsWith(foundText) ? (
              <>
                <b>{foundText}</b>
                {progress.slice(foundText.length)}
              </>
            ) : (
              progress
            )}
          </p>
        ) : null}
        {showMeasured && state.rtlMs !== null ? (
          <div className="cal-result" data-testid="cal-result">
            <p className="cal-result-main">{text('calibrate.loopback.success', { ms: Math.round(state.rtlMs) })}</p>
            {state.madMs !== null ? <p className="cal-result-spread">{text('calibrate.loopback.spread', { ms: Math.round(state.madMs) })}</p> : null}
          </div>
        ) : null}
      </div>

      {state.warnings.map((w) => (
        <Banner key={w} tone="caution" text={text(WARNING_KEY[w])} />
      ))}

      {state.step === 'measured' && state.method === 'loopback' && state.audibility === 'unanswered' ? (
        <div className="cal-audibility" role="group" aria-label={text('calibrate.audibility.question')}>
          <p className="cal-step-text">{text('calibrate.audibility.question')}</p>
          <div className="cal-actions">
            <Button label={text('action.yes')} variant="primary" onClick={() => dispatch({ type: 'audibility', answer: 'yes' })} />
            <Button label={text('action.notReally')} onClick={() => dispatch({ type: 'audibility', answer: 'not-really' })} />
          </div>
        </div>
      ) : null}
      {state.audibility === 'not-really' ? (
        <p className="cal-step-text" data-testid="cal-audibility-hint">
          {text('calibrate.audibility.hint')} <Link to="/settings/audio">{text('settings.audio.clickSound')}</Link>
        </p>
      ) : null}

      {state.step === 'loopback-failed' ? (
        <div className="cal-fail" role="alert" data-testid="cal-fail">
          <p>{state.errored ? text('calibrate.fail.error') : text('calibrate.fail.loopback')}</p>
          <div className="cal-actions">
            <Button label={text('action.tryAgain')} variant="primary" onClick={() => run('loopback')} />
            <Button label={text('action.playAlongInstead')} onClick={() => run('play-along')} />
          </div>
        </div>
      ) : null}
      {state.step === 'playalong-failed' ? (
        <div className="cal-fail" role="alert" data-testid="cal-fail">
          <p>{state.errored ? text('calibrate.fail.error') : text('calibrate.fail.playAlong')}</p>
          {state.playAlongFailures >= 2 ? <p>{text('calibrate.fail.estimate')}</p> : null}
          <div className="cal-actions">
            <Button label={text('action.tryAgain')} variant="primary" onClick={() => run('play-along')} />
            {state.playAlongFailures >= 2 ? <Button label={text('action.useEstimate')} onClick={() => dispatch({ type: 'use-estimate' })} /> : null}
          </div>
        </div>
      ) : null}

      <div className="cal-footer">
        {mayHear ? <Button label={text('action.hearClick')} variant="tonal" icon="metronome" loading={hearing} onClick={hear} /> : null}
        <span className="cal-spacer" />
        {state.step === 'idle' ? <Button label={text('action.start')} variant="primary" onClick={start} /> : null}
        {canFinish || (state.step === 'finished' && state.estimate) ? (
          <Button label={text('action.continue')} variant="primary" onClick={() => onDone(state.estimate ? 'estimate' : 'calibrated')} />
        ) : null}
        {showSkip ? <Button label={text('action.skip')} variant="quiet" onClick={() => onDone('skipped')} /> : null}
      </div>
      {showSkip && !embedded ? <p className="cal-skip-hint">{text('calibrate.skipHint')}</p> : null}
      {state.estimate ? <p className="cal-step-text">{text('calibrate.estimateUsed')}</p> : null}
    </section>
  );
  // Embedded (onboarding), this card is the step's own card and the step prints the skip hint under it.
  return <Card className="cal-card">{body}</Card>;
}
