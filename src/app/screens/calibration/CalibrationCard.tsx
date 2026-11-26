import './calibration.css';
import { useCallback, useEffect, useId, useReducer, useRef, useState, type ReactNode } from 'react';
import { Banner, Card } from '../../../ui/components/containers/index.ts';
import { Button, Select } from '../../../ui/components/form/index.ts';
import { Glyph } from '../../../ui/primitives/index.ts';
import { text, type TextKey } from '../states/text.ts';
import {
  calReducer,
  calibrationIsMandatoryPath,
  diagnosticsWithResult,
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

/** A footer button the setup wizard draws (round 3): the card hands its actions out instead of drawing them. */
export interface CalFooterAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  testId?: string;
  describedBy?: string;
}

export interface CalFooter {
  primary: CalFooterAction | null;
  skip: CalFooterAction | null;
  /** What skipping costs, beside Skip. */
  note: string | null;
}

export interface CalibrationCardProps {
  services: CalibrationServices;
  /** Called when the player leaves the card: calibrated (with the measured delay, ms), using an estimate, or skipping. */
  onDone(result: CalibrationResult, ms?: number | null): void;
  /** Shows a Skip control (onboarding, settings). Ignored where calibration is the mandatory path (R16, iOS without reported latency). */
  allowSkip?: boolean;
  /**
   * `wizard` (round 3, the setup's Timing stage; presentation only, `flow.ts` keeps its states): the output choice,
   * the marks, one result line with the numbers, the recovery panels with their "Shown because" lead, and the device
   * select, stage list, audio check and export under "Details for support". Start, Next and Skip go to `renderFooter`.
   */
  variant?: 'card' | 'wizard';
  /** The wizard's footer, drawn from the card's actions. */
  renderFooter?: (f: CalFooter) => ReactNode;
}

/**
 * The warnings to show for a run (round 3, R80): the measured number first, a cause only on positive evidence, nothing
 * when the delay is within the limit. Bluetooth (caution) replaces the neutral delay line (info) when both apply; a
 * Bluetooth route with a fair delay gets no warning. AirPods and filtering keep their caution lines.
 */
export function shownWarnings(warnings: readonly CalWarning[]): { id: CalWarning; tone: 'info' | 'caution' }[] {
  const out: { id: CalWarning; tone: 'info' | 'caution' }[] = [];
  if (warnings.includes('delay')) out.push(warnings.includes('bluetooth') ? { id: 'bluetooth', tone: 'caution' } : { id: 'delay', tone: 'info' });
  for (const w of warnings) if (w === 'airpods' || w === 'aec') out.push({ id: w, tone: 'caution' });
  return out;
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
  delay: 'calibrate.warn.delay',
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

const SKIP_REASON: Record<string, TextKey> = {
  headphones: 'calibrate.check.notRun.headphones',
  'no-probe': 'calibrate.check.notRun.noProbe',
  unmeasured: 'calibrate.check.notRun.unmeasured',
};

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
          const why = i.status === 'fail' ? text(CHECK_LABEL[i.id].fail) : i.status === 'skipped' ? text(SKIP_REASON[i.reason ?? ''] ?? 'calibrate.check.notRun.other') : null;
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
export function CalibrationCard({ services, onDone, allowSkip = false, variant = 'card', renderFooter }: CalibrationCardProps) {
  const wizard = variant === 'wizard';
  const titleId = useId();
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
            const warnings = warningsFor({ outputMode: prefs.outputMode, rtlMs: outcome.rtlMs, maxRtlMs: services.maxRtlMs, accepted: outcome.accepted, route, caps, aecSuspected: outcome.aecSuspected });
            if (alive.current) dispatch({ type: 'loopback-done', outcome, warnings });
          } else {
            const outcome = await services.runPlayAlong({ ...progress, onNote: (index, offsetMs) => alive.current && dispatch({ type: 'note', index, offsetMs }) });
            if (outcome.accepted && outcome.calibration) await services.save(outcome.calibration);
            const warnings = warningsFor({ outputMode: prefs.outputMode, rtlMs: outcome.rtlMs, maxRtlMs: services.maxRtlMs, accepted: outcome.accepted, route, caps, aecSuspected: false });
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
  // Inside the result, under the measured number (R80); never stacked above the card.
  const warningBanners = shownWarnings(state.warnings).map((w) => (
    <Banner
      key={w.id}
      tone={w.tone}
      text={w.id === 'delay' ? text(WARNING_KEY[w.id], { ms: Math.round(state.rtlMs ?? 0) }) : text(WARNING_KEY[w.id])}
      {...(w.id === 'delay' && !running ? { action: { label: text('action.runCheckAgain'), onClick: () => run(kind) } } : {})}
    />
  ));
  const doneLabel = text(wizard ? 'action.next' : 'action.continue');
  const heard = found(state);
  const total = state.dots.length || plan.stages.find((st) => isMeasuredStage(st.id))?.sounds || 0;
  const playAlongStage = services.plan('wired').stages[0];
  const footer: CalFooter = {
    primary:
      state.step === 'idle'
        ? { label: text('onboarding.timing.start'), onClick: start }
        : running
          ? { label: text('calibrate.listening'), onClick: () => undefined, loading: true }
          : state.step === 'loopback-failed'
            ? { label: text('onboarding.timing.retry'), onClick: () => run('loopback') }
            : state.step === 'playalong-failed'
              ? { label: text('action.tryAgain'), onClick: () => run('play-along') }
              : canFinish || (state.step === 'finished' && state.estimate)
                ? { label: doneLabel, onClick: () => onDone(state.estimate ? 'estimate' : 'calibrated', state.rtlMs === null ? null : Math.round(state.rtlMs)) }
                : { label: doneLabel, onClick: () => undefined, disabled: true, describedBy: `${titleId}-ask` },
    skip: showSkip ? { label: text('onboarding.timing.skip'), onClick: () => onDone('skipped') } : null,
    note: showSkip ? text('onboarding.timing.skipNote') : null,
  };
  const section = (
    <section className="cal cal-wizard" data-testid="calibration-card" data-variant={variant} data-step={state.step} aria-labelledby={titleId}>
      <h2 id={titleId} className="ob-stage-title" tabIndex={-1}>
        {text('onboarding.timing.title')}
        {ios ? <span className="cal-beta">{` ${text('app.beta')}`}</span> : null}
      </h2>
      <p className="ob-text">{text('onboarding.timing.body')}</p>
      {mandatory ? <p className="ob-hint">{text('onboarding.calibration.iosNote')}</p> : null}
      <label className="cal-field cal-field-inline">
        <span className="cal-label">{text('onboarding.timing.output')}</span>
        <Select ariaLabel={text('onboarding.timing.output')} options={outputOptions} value={prefs.outputMode} disabled={running} onChange={(v) => changePrefs({ outputMode: v as OutputMode })} />
      </label>
      {running ? <p id={LOCKED_ID} className="cal-locked">{text('calibrate.devicesLocked')}</p> : null}
      {state.step === 'idle' ? (
        <p className="cal-step-text" data-testid="cal-instruction">
          {preview}
        </p>
      ) : null}
      <p className="cal-now ui-visually-hidden" role="status" aria-live="polite" data-testid="cal-now">
        {live}
      </p>
      {running ? (
        <p className="cal-wizard-progress">
          <b>{text('calibrate.listening')}</b> {text('onboarding.timing.progress', { found: heard, total })}
        </p>
      ) : null}
      {state.step === 'loopback-failed' ? (
        <p className="cal-wizard-fail" role="alert" data-testid="cal-fail">
          {state.errored ? text('calibrate.fail.error') : state.failure === 'too-few-clicks' || !state.failure ? text('onboarding.timing.failFew', { found: state.clicksFound ?? heard, total }) : text(loopbackFail, { found: state.clicksFound ?? 0, total })}
        </p>
      ) : null}
      {running || state.step === 'loopback-failed' || state.step === 'playalong-failed' || showMeasured ? <Dots state={state} total={total} kind={kind} /> : null}
      {state.step === 'playalong-running' && state.stage === 'play-along' ? <p className="cal-pulse">{text('calibrate.playAlong.playNow')}</p> : null}
      {showMeasured && state.rtlMs !== null ? (
        <div className="cal-result" data-testid="cal-result">
          <p className="cal-wizard-pass">
            <Glyph id="check" size={16} />
            <span>{text('onboarding.timing.pass', { ms: Math.round(state.rtlMs) })}</span>
          </p>
          {warningBanners}
          {!running && !state.estimate ? <Button label={text('action.recalibrate')} variant="quiet" size="compact" onClick={() => run(kind)} /> : null}
        </div>
      ) : null}
      {state.step === 'loopback-failed' && !state.errored ? (
        <>
          <p className="ob-because">
            <b>{text('onboarding.timing.becauseClicks.lead')}</b> {text('onboarding.timing.becauseClicks')}
          </p>
          <div className="ob-alt" data-testid="cal-play-along">
            <div className="ob-alt-text">
              <p className="ob-alt-title">{text('action.playAlongInstead')}</p>
              <p className="ob-hint">{text('onboarding.timing.playAlong.body', { clicks: playAlongStage?.sounds ?? 8, seconds: services.plan('wired').seconds })}</p>
            </div>
            <Button label={text('calibrate.stage.playAlong')} variant="secondary" onClick={() => run('play-along')} />
          </div>
        </>
      ) : null}
      {state.step === 'playalong-failed' ? (
        <div className="cal-wizard-fail-block" role="alert" data-testid="cal-fail">
          <p className="cal-wizard-fail">{state.errored ? text('calibrate.fail.error') : text('calibrate.fail.playAlong')}</p>
          {state.playAlongFailures >= 2 ? (
            <>
              <p className="ob-because">
                <b>{text('onboarding.timing.becausePlayAlong.lead')}</b> {text('onboarding.timing.becausePlayAlong')}
              </p>
              <Button label={text('action.useEstimate')} onClick={() => dispatch({ type: 'use-estimate' })} />
            </>
          ) : null}
        </div>
      ) : null}
      {state.step === 'measured' && state.method === 'loopback' && state.audibility === 'unanswered' ? (
        <div className="cal-audibility" role="group" aria-label={text('calibrate.audibility.question')}>
          <p className="cal-step-text" id={`${titleId}-ask`}>
            {text('calibrate.audibility.question')}
          </p>
          <div className="cal-actions">
            <Button label={text('action.yes')} variant="secondary" onClick={() => dispatch({ type: 'audibility', answer: 'yes' })} />
            <Button label={text('action.notReally')} onClick={() => dispatch({ type: 'audibility', answer: 'not-really' })} />
          </div>
        </div>
      ) : null}
      {state.audibility === 'not-really' ? (
        <p className="cal-step-text" data-testid="cal-audibility-hint">
          {text('calibrate.audibility.hint')}
        </p>
      ) : null}
      {state.estimate ? <p className="cal-step-text">{text('calibrate.estimateUsed')}</p> : null}
      {mayHear ? (
        <div className="cal-actions">
          <Button label={text('action.hearClick')} variant="tonal" size="compact" icon="metronome" loading={hearing} onClick={hear} />
        </div>
      ) : null}
      <details className="ob-details" data-testid="cal-details">
        <summary>{text('onboarding.details')}</summary>
        <div className="ob-details-body">
          <label className="cal-field">
            <span className="cal-label">{text('calibrate.inputDevice')}</span>
            <Select ariaLabel={text('calibrate.inputDevice')} options={inputOptions} value={prefs.inputDeviceId ?? ''} disabled={running} onChange={(v) => changePrefs({ inputDeviceId: v === '' ? null : v })} />
          </label>
          <Stages state={state} plan={plan} sound={sound} kind={kind} />
          {failStage ? <p className="cal-fail-stage">{failStage}</p> : null}
          {!running && state.checks ? <Checks checks={state.checks} plan={plan} /> : null}
          {!running && state.checks ? (
            <Button label={text('action.exportDiagnostics')} variant="tertiary" size="compact" onClick={() => services.exportDiagnostics(diagnosticsWithResult((state.checks as SelfTestOutcome).diagnosticsJson, state))} />
          ) : null}
        </div>
      </details>
      {wizard ? (
        renderFooter?.(footer)
      ) : (
        <div className="cal-footer">
          {footer.skip ? <Button label={footer.skip.label} variant="quiet" onClick={footer.skip.onClick} /> : null}
          {footer.primary ? (
            <Button
              label={footer.primary.label}
              variant="primary"
              onClick={footer.primary.onClick}
              disabled={footer.primary.disabled ?? false}
              loading={footer.primary.loading ?? false}
            />
          ) : null}
        </div>
      )}
      {!wizard && footer.note ? <p className="cal-skip-hint">{text('calibrate.skipHint')}</p> : null}
    </section>
  );
  // The setup wizard draws the card's actions in its footer; #/calibrate shows the same card in a card of its own.
  return wizard ? section : <Card className="cal-card">{section}</Card>;
}
