import './calibration.css';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Banner, Card } from '../../../ui/components/containers/index.ts';
import { Button, Select } from '../../../ui/components/form/index.ts';
import { Link } from '../../router.tsx';
import { text, type TextKey } from '../states/text.ts';
import {
  calReducer,
  calibrationIsMandatoryPath,
  initialCalState,
  isIos,
  isMeasuredStage,
  methodFor,
  offsetTick,
  stageStatuses,
  warningsFor,
  type CalState,
  type CalWarning,
  type DotState,
  type StageStatus,
} from './flow.ts';
import type { AudioPrefs, CalibrationServices, CalPlan, CalStageId, SelfTestItemId, SelfTestOutcome } from './services.ts';
import type { ClickTimbre, OutputMode } from '../../../core/types.ts';

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

const STAGE_NAME: Record<CalStageId, TextKey> = {
  timing: 'calibrate.stage.timing',
  template: 'calibrate.stage.template',
  pitch: 'calibrate.stage.pitch',
  'count-in': 'calibrate.stage.countIn',
  'play-along': 'calibrate.stage.playAlong',
};

const STATUS_TEXT: Partial<Record<StageStatus, TextKey>> = {
  now: 'calibrate.stage.status.now',
  passed: 'calibrate.stage.status.passed',
  failed: 'calibrate.stage.status.failed',
  done: 'calibrate.stage.status.done',
};

/** Plain names for the audio-check rows, and what a failure means (owner feedback: words a musician uses). */
export const CHECK_LABEL: Record<SelfTestItemId, { name: TextKey; fail: TextKey }> = {
  'sanity-tone': { name: 'calibrate.check.sanityTone', fail: 'calibrate.check.sanityTone.fail' },
  clicks: { name: 'calibrate.check.clicksHeard', fail: 'calibrate.check.clicksHeard.fail' },
  recheck: { name: 'calibrate.check.countInRecheck', fail: 'calibrate.check.countInRecheck.fail' },
  'clock-rate': { name: 'calibrate.check.clockRate', fail: 'calibrate.check.clockRate.fail' },
  processing: { name: 'calibrate.check.micProcessingOff', fail: 'calibrate.check.micProcessingOff.fail' },
  'frame-rate': { name: 'calibrate.check.screenRefresh', fail: 'calibrate.check.screenRefresh.fail' },
};

/** The audio-check item each stage stands for: its result shows on the stage row, not again in the check list. */
const STAGE_CHECK: Partial<Record<CalStageId, SelfTestItemId>> = { timing: 'clicks', pitch: 'sanity-tone', 'count-in': 'recheck' };

const CHECK_STATUS = { pass: 'calibrate.selfTest.pass', fail: 'calibrate.selfTest.fail', skipped: 'calibrate.selfTest.notRun' } as const;

const SKIP_REASON: Record<string, TextKey> = { headphones: 'calibrate.check.skip.headphones', 'no-probe': 'calibrate.check.skip.noProbe' };

const SOUND_NAME: Partial<Record<ClickTimbre, TextKey>> = {
  classic: 'settings.audio.click.classic',
  woodblock: 'settings.audio.click.woodblock',
  beep: 'settings.audio.click.beep',
};

const LOOPBACK_FAIL: Record<string, TextKey> = {
  'too-few-clicks': 'calibrate.fail.loopback.few',
  spread: 'calibrate.fail.loopback.spread',
  'rtl-range': 'calibrate.fail.loopback.range',
};

/** What a stage plays, in words, from the plan's counts. */
function stageDetail(st: CalPlan['stages'][number], sound: ClickTimbre): string {
  switch (st.id) {
    case 'timing':
      return text('calibrate.stage.timing.detail', { clicks: st.sounds });
    case 'template': {
      const name = SOUND_NAME[sound];
      return name ? text('calibrate.stage.template.detail', { clicks: st.sounds, sound: text(name) }) : text('calibrate.stage.template.detailPlain', { clicks: st.sounds });
    }
    case 'pitch':
      return text('calibrate.stage.pitch.detail');
    case 'count-in':
      return text('calibrate.stage.countIn.detail', { soft: st.sounds - st.accented });
    case 'play-along':
      return text('calibrate.stage.playAlong.detail', { clicks: st.sounds });
  }
}

/** "2 of 4 · Learning your click sound: 6 clicks in Classic" (one stage: no count). */
function stageLine(plan: CalPlan, id: CalStageId, sound: ClickTimbre): string {
  const i = plan.stages.findIndex((s) => s.id === id);
  const st = plan.stages[i];
  if (!st) return '';
  const vars = { name: text(STAGE_NAME[id]), detail: stageDetail(st, sound) };
  return plan.stages.length > 1 ? text('calibrate.stage.line', { n: i + 1, total: plan.stages.length, ...vars }) : text('calibrate.stage.lineOnly', vars);
}

function dotLabel(state: CalState, i: number, total: number, kind: 'loopback' | 'play-along', d: DotState): string {
  const vars = { n: i + 1, total };
  if (kind === 'play-along' && (d === 'heard' || d === 'missed')) {
    const off = state.offsets[i] ?? null;
    if (off === null) return text('calibrate.dot.noNote', vars);
    const delta = off - (state.rtlMs ?? 0);
    return text(delta < 0 ? 'calibrate.dot.offsetEarly' : 'calibrate.dot.offsetLate', { ...vars, ms: Math.abs(Math.round(delta)) });
  }
  return text(d === 'heard' ? 'calibrate.dot.heard' : d === 'missed' ? 'calibrate.dot.missed' : d === 'sounding' ? 'calibrate.dot.playing' : 'calibrate.dot.pending', vars);
}

/**
 * One mark per measured click (06 section 6.14). A mark lights brass, with one pulse, at the moment its click is
 * audible, then settles to heard (filled) or missed (ring with a stroke). Under reduced motion it only fills.
 */
function Dots({ state, total, kind }: { state: CalState; total: number; kind: 'loopback' | 'play-along' }) {
  const rtl = state.rtlMs ?? 0;
  return (
    <ol className="cal-dots" data-kind={kind}>
      {Array.from({ length: total }, (_, i) => {
        const d: DotState = state.dots[i] ?? 'pending';
        const off = kind === 'play-along' ? state.offsets[i] ?? null : null;
        const tick = off === null ? null : offsetTick(off - rtl);
        return (
          <li key={i} className="cal-dot-cell">
            <span className="cal-dot" role="img" aria-label={dotLabel(state, i, total, kind, d)} data-state={d} />
            {tick !== null ? <span className="cal-tick" aria-hidden="true" data-side={tick < 0 ? 'early' : 'late'} style={{ ['--cal-tick' as string]: String(tick) }} /> : null}
          </li>
        );
      })}
    </ol>
  );
}

/** Small marks for the unmeasured stages: they light as each sound plays. The count-in's accented beat is larger. */
function SmallMarks({ marks, accented }: { marks: DotState[]; accented: number }) {
  return (
    <span className="cal-marks" aria-hidden="true">
      {marks.map((d, i) => (
        <span key={i} className="cal-mark" data-state={d} data-accent={i < accented ? 'true' : undefined} />
      ))}
    </span>
  );
}

/** Clicks heard: live from the marks while running, then the run's final count (the live verdicts are provisional). */
function found(state: CalState): number {
  const running = state.step === 'loopback-running' || state.step === 'playalong-running';
  return !running && state.clicksFound !== null ? state.clicksFound : state.dots.filter((d) => d === 'heard').length;
}

function Count({ state, total }: { state: CalState; total: number }) {
  const progress = text('calibrate.progress', { found: found(state), total });
  const foundText = String(found(state));
  return (
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
  );
}

/** The run's stages as a list: name, what it plays, its marks, and its status. */
function Stages({ state, plan, sound, kind }: { state: CalState; plan: CalPlan; sound: ClickTimbre; kind: 'loopback' | 'play-along' }) {
  const statuses = state.plan ? stageStatuses(state) : plan.stages.map((): StageStatus => 'upcoming');
  const total = plan.stages.length;
  return (
    <ol className="cal-stages" data-testid="cal-stages">
      {plan.stages.map((st, i) => {
        const status = statuses[i] ?? 'upcoming';
        const statusKey = STATUS_TEXT[status];
        const name = text(STAGE_NAME[st.id]);
        const measured = isMeasuredStage(st.id);
        // A failed tone or count-in says what it means here (the timing failure has its own block with the ways out).
        const item = STAGE_CHECK[st.id];
        const why = status === 'failed' && item && !measured ? text(CHECK_LABEL[item].fail) : null;
        return (
          <li key={st.id} className="cal-stage-row" data-stage={st.id} data-status={status} aria-current={status === 'now' ? 'step' : undefined}>
            <span className="cal-stage-num" aria-hidden="true">
              {status === 'passed' || status === 'done' ? '✓' : status === 'failed' ? '!' : i + 1}
            </span>
            <div className="cal-stage-head">
              <p className="cal-stage-name">
                <span className="ui-visually-hidden">{text('calibrate.stage.a11y', { n: i + 1, total, name, status: statusKey ? text(statusKey) : '' })}</span>
                <span aria-hidden="true">
                  <b>{name}</b> <span className="cal-stage-detail">{stageDetail(st, sound)}</span>
                </span>
              </p>
              {statusKey ? (
                <span className="cal-stage-status" aria-hidden="true">
                  {text(statusKey)}
                </span>
              ) : null}
            </div>
            <div className="cal-stage-marks">
              {measured ? (
                <>
                  <Dots state={state} total={st.sounds} kind={kind} />
                  {state.plan && state.dots.some((d) => d === 'heard' || d === 'missed') ? <Count state={state} total={st.sounds} /> : null}
                </>
              ) : (
                <SmallMarks marks={state.marks[st.id] ?? Array.from({ length: st.sounds }, () => 'pending')} accented={st.accented} />
              )}
              {why ? <p className="cal-stage-why">{why}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The audio check that ran with the calibration: plain names, a line for each failure, a reason for each skip. Items
 * a stage on screen already stands for (clicks, tone, count-in) show there instead; the others are listed here.
 */
function Checks({ checks, plan }: { checks: SelfTestOutcome; plan: CalPlan }) {
  const shown = new Set(plan.stages.map((st) => STAGE_CHECK[st.id]).filter((x) => x !== undefined));
  return (
    <div className="cal-check-block" data-testid="cal-checks">
      <h2 className="cal-subtitle">{text('calibrate.selfTest.title')}</h2>
      <ul className="cal-checks">
        {checks.items.filter((i) => !shown.has(i.id)).map((i) => {
          const why = i.status === 'fail' ? text(CHECK_LABEL[i.id].fail) : i.status === 'skipped' ? text(SKIP_REASON[i.reason ?? ''] ?? 'calibrate.check.skip.other') : null;
          return (
            <li key={i.id} className="cal-check" data-status={i.status}>
              <span className="cal-check-head">
                <span className="cal-check-name">{text(CHECK_LABEL[i.id].name)}</span>
                <span className="cal-check-status">{text(CHECK_STATUS[i.status])}</span>
              </span>
              {why ? <span className="cal-check-why">{why}</span> : null}
            </li>
          );
        })}
      </ul>
      <p className="cal-check-summary">{text(checks.passed ? 'calibrate.selfTest.summaryPass' : 'calibrate.selfTest.summaryFail')}</p>
    </div>
  );
}

/** "Stage 1, Timing, didn't pass." for the failed stage, or where a run that threw stopped. */
function failedStageText(state: CalState): string | null {
  const plan = state.plan;
  if (!plan) return null;
  const id: CalStageId | null = state.errored ? state.stage : state.method === 'play-along' ? 'play-along' : 'timing';
  if (!id) return null;
  const n = plan.stages.findIndex((s) => s.id === id) + 1;
  if (n < 1) return null;
  return text(state.errored ? 'calibrate.fail.stoppedAt' : 'calibrate.fail.stage', { n, name: text(STAGE_NAME[id]) });
}

/**
 * Calibration card (04 section 5.9): setup row, then one run in named stages (timing, the click sound's template,
 * pitch, a count-in check; or play-along on headphones), each sound shown as it is heard, then one result with the
 * audio check. One card for onboarding, Settings > Audio, banners and results prompts.
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
  const kind: 'loopback' | 'play-along' = state.method ?? (state.step.startsWith('playalong') ? 'play-along' : method);
  // Idle, the plan for the chosen output; after Start, the plan of the run on screen (play along may follow a loopback failure).
  const plan: CalPlan = state.plan ?? services.plan(kind === 'play-along' && method === 'loopback' ? 'wired' : prefs.outputMode);
  const sound = services.clickSound();

  const changePrefs = (p: Partial<AudioPrefs>): void => {
    setPrefsState((cur) => ({ ...cur, ...p }));
    void services.setPrefs(p);
    dispatch({ type: 'reset' });
  };

  const run = useCallback(
    (k: 'loopback' | 'play-along') => {
      // The unlock must start inside this click's call stack (05 W1); the rest is async.
      const unlocked = services.unlock();
      const runPlan = services.plan(k === 'loopback' ? 'speakers' : prefs.outputMode === 'speakers' ? 'wired' : prefs.outputMode);
      dispatch(k === 'loopback' ? { type: 'start-loopback', plan: runPlan } : { type: 'start-playalong', plan: runPlan });
      const progress = {
        onStage: (stage: CalStageId) => alive.current && dispatch({ type: 'stage', stage }),
        onSound: (stage: CalStageId, index: number) => alive.current && dispatch({ type: 'sound', stage, index }),
      };
      void (async () => {
        try {
          const route = await unlocked;
          if (k === 'loopback') {
            const outcome = await services.runLoopback({ ...progress, onClick: (index, heard) => alive.current && dispatch({ type: 'click', index, heard }) });
            if (outcome.accepted && outcome.calibration) await services.save(outcome.calibration);
            const warnings = warningsFor({ outputMode: prefs.outputMode, rtlMs: outcome.rtlMs, maxRtlMs: services.maxRtlMs, route, caps, aecSuspected: outcome.aecSuspected });
            if (alive.current) dispatch({ type: 'loopback-done', outcome, warnings });
          } else {
            const outcome = await services.runPlayAlong({ ...progress, onNote: (index, offsetMs) => alive.current && dispatch({ type: 'note', index, offsetMs }) });
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
  const failed = state.step === 'loopback-failed' || state.step === 'playalong-failed';
  // The one polite live region: the stage line, which changes only when a stage starts (never per click).
  const live = running ? (state.stage ? stageLine(plan, state.stage, sound) : text('calibrate.getReady')) : '';
  const preview = kind === 'loopback' ? text('calibrate.preview.loopback', { seconds: plan.seconds }) : text('calibrate.preview.playAlong', { seconds: plan.seconds, clicks: plan.stages[0]?.sounds ?? 0 });
  const failStage = failed ? failedStageText(state) : null;
  const loopbackFail = state.failure && LOOPBACK_FAIL[state.failure] ? (LOOPBACK_FAIL[state.failure] as TextKey) : 'calibrate.fail.loopback.few';
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

      <div className="cal-stage" data-running={running ? 'true' : undefined}>
        {running ? <p className="cal-listening">{text('calibrate.listening')}</p> : null}
        {state.step === 'idle' ? (
          <>
            <p className="cal-step-text" data-testid="cal-instruction">
              {preview}
            </p>
            {plan.skipped.length ? <p className="cal-step-text">{text('calibrate.preview.headphones')}</p> : null}
          </>
        ) : null}
        <p className="cal-now" role="status" aria-live="polite" data-testid="cal-now" hidden={!running}>
          {live}
        </p>
        <Stages state={state} plan={plan} sound={sound} kind={kind} />
        {state.step === 'playalong-running' && state.stage === 'play-along' ? <p className="cal-pulse">{text('calibrate.playAlong.playNow')}</p> : null}
        {showMeasured && state.rtlMs !== null ? (
          <div className="cal-result" data-testid="cal-result">
            <p className="cal-result-main">
              {text('calibrate.loopback.success', { ms: Math.round(state.rtlMs) })}
              {state.madMs !== null ? <span className="cal-result-spread"> {text('calibrate.loopback.spread', { ms: Math.round(state.madMs) })}</span> : null}
            </p>
            <p className="cal-result-meaning">{text(state.method === 'play-along' ? 'calibrate.result.meaning.playAlong' : 'calibrate.result.meaning.loopback')}</p>
          </div>
        ) : null}
      </div>

      {state.warnings.map((w) => (
        <Banner key={w} tone="caution" text={text(WARNING_KEY[w])} />
      ))}

      {state.step === 'loopback-failed' ? (
        <div className="cal-fail" role="alert" data-testid="cal-fail">
          {failStage ? <p className="cal-fail-stage">{failStage}</p> : null}
          <p>{state.errored ? text('calibrate.fail.error') : text(loopbackFail, { found: state.clicksFound ?? 0, total: state.dots.length })}</p>
          <div className="cal-actions">
            <Button label={text('action.tryAgain')} variant="primary" onClick={() => run('loopback')} />
            <Button label={text('action.playAlongInstead')} onClick={() => run('play-along')} />
          </div>
        </div>
      ) : null}
      {state.step === 'playalong-failed' ? (
        <div className="cal-fail" role="alert" data-testid="cal-fail">
          {failStage ? <p className="cal-fail-stage">{failStage}</p> : null}
          <p>{state.errored ? text('calibrate.fail.error') : text('calibrate.fail.playAlong')}</p>
          {state.playAlongFailures >= 2 ? <p>{text('calibrate.fail.estimate')}</p> : null}
          <div className="cal-actions">
            <Button label={text('action.tryAgain')} variant="primary" onClick={() => run('play-along')} />
            {state.playAlongFailures >= 2 ? <Button label={text('action.useEstimate')} onClick={() => dispatch({ type: 'use-estimate' })} /> : null}
          </div>
        </div>
      ) : null}

      {!running && state.checks ? <Checks checks={state.checks} plan={plan} /> : null}
      {!running && (showMeasured || state.checks) ? (
        <div className="cal-secondary">
          {showMeasured && !state.estimate ? <Button label={text('action.recalibrate')} variant="tertiary" onClick={() => run(kind)} /> : null}
          {state.checks ? <Button label={text('action.exportDiagnostics')} variant="tertiary" onClick={() => services.exportDiagnostics((state.checks as SelfTestOutcome).diagnosticsJson)} /> : null}
        </div>
      ) : null}

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
