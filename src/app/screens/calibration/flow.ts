/**
 * The calibration card's state machine (04 section 5.9). Pure: the card feeds it events and renders its state.
 * Calibration never blocks a take (R16): every end state lets the player carry on; a missing measurement only
 * makes takes practice.
 */
import { delayMatters } from '../../../core/bluetooth-evidence.ts';
import type { PlatformCapabilities } from '../../../core/platform.ts';
import type { AudioRouteInfo, Calibration, OutputMode } from '../../../core/types.ts';
import type { CalPlan, CalStageId, LoopbackOutcome, PlayAlongOutcome, SelfTestOutcome } from './services.ts';

/**
 * One mark per sound. `sounding`: the sound is audible now (brass, one pulse); a timing or play-along mark then
 * settles to `heard` or `missed` when that is known; the other stages' marks settle to `done` at the next sound.
 */
export type DotState = 'pending' | 'sounding' | 'heard' | 'missed' | 'done';

/** The stages whose marks are measured (heard or missed); the others only show that their sound played. */
export const isMeasuredStage = (s: CalStageId): boolean => s === 'timing' || s === 'play-along';

export type CalStep =
  | 'idle'
  | 'loopback-running'
  | 'loopback-failed'
  | 'playalong-running'
  | 'playalong-failed'
  /** Measured; on speakers the audibility question follows. */
  | 'measured'
  | 'finished';

/** `delay`: a measured round trip above the ranked limit with no Bluetooth evidence or with it (neutral wording). */
export type CalWarning = 'bluetooth' | 'delay' | 'airpods' | 'aec';

export interface CalState {
  step: CalStep;
  /** The run's stages (from the services' plan), in order; empty before a run. */
  plan: CalPlan | null;
  /** The stage playing now; null before the first and after the last. */
  stage: CalStageId | null;
  /** Marks of the measured stage (timing or play-along). */
  dots: DotState[];
  /** Marks of the other stages (template, pitch, count-in). */
  marks: Partial<Record<CalStageId, DotState[]>>;
  /** The audio check that ran after the measurement. */
  checks: SelfTestOutcome | null;
  /** Loopback: why it failed (`LoopbackFailure`), and clicks found of scheduled. */
  failure: string | null;
  clicksFound: number | null;
  /** Play-along: offset of each note from its click, ms; null when no note. Filled when the run ends. */
  offsets: (number | null)[];
  method: 'loopback' | 'play-along' | null;
  rtlMs: number | null;
  madMs: number | null;
  warnings: CalWarning[];
  /** Play-along runs that failed since the last success. Two failures offer an estimate. */
  playAlongFailures: number;
  audibility: 'unanswered' | 'yes' | 'not-really';
  /** The stored record when measured. */
  calibration: Calibration | null;
  /** The run threw (device error), as opposed to measuring badly. */
  errored: boolean;
  estimate: boolean;
}

export const initialCalState = (): CalState => ({
  step: 'idle',
  plan: null,
  stage: null,
  dots: [],
  marks: {},
  checks: null,
  failure: null,
  clicksFound: null,
  offsets: [],
  method: null,
  rtlMs: null,
  madMs: null,
  warnings: [],
  playAlongFailures: 0,
  audibility: 'unanswered',
  calibration: null,
  errored: false,
  estimate: false,
});

export type CalEvent =
  | { type: 'start-loopback'; plan: CalPlan }
  | { type: 'start-playalong'; plan: CalPlan }
  | { type: 'stage'; stage: CalStageId }
  | { type: 'sound'; stage: CalStageId; index: number }
  | { type: 'click'; index: number; heard: boolean }
  | { type: 'note'; index: number; offsetMs: number | null }
  | { type: 'loopback-done'; outcome: LoopbackOutcome; warnings: CalWarning[] }
  | { type: 'playalong-done'; outcome: PlayAlongOutcome; warnings: CalWarning[] }
  | { type: 'run-error' }
  | { type: 'audibility'; answer: 'yes' | 'not-really' }
  | { type: 'use-estimate' }
  | { type: 'reset' };

const sized = (n: number): DotState[] => Array.from({ length: n }, () => 'pending');

/** Marks of the unmeasured stages, all pending. */
const otherMarks = (plan: CalPlan): CalState['marks'] => Object.fromEntries(plan.stages.filter((st) => !isMeasuredStage(st.id)).map((st) => [st.id, sized(st.sounds)]));

/** Every unmeasured mark that was sounding is done (a new sound, a new stage, or the end). */
const settleOthers = (m: CalState['marks']): CalState['marks'] =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [k, (v ?? []).map((d) => (d === 'sounding' ? 'done' : d))]));

const measuredSize = (plan: CalPlan): number => plan.stages.find((st) => isMeasuredStage(st.id))?.sounds ?? 0;

export function calReducer(s: CalState, e: CalEvent): CalState {
  switch (e.type) {
    case 'start-loopback':
      return { ...initialCalState(), step: 'loopback-running', plan: e.plan, dots: sized(measuredSize(e.plan)), marks: otherMarks(e.plan), playAlongFailures: s.playAlongFailures };
    case 'start-playalong': {
      const n = measuredSize(e.plan);
      return { ...initialCalState(), step: 'playalong-running', plan: e.plan, dots: sized(n), marks: otherMarks(e.plan), offsets: Array.from({ length: n }, () => null), playAlongFailures: s.playAlongFailures };
    }
    case 'stage':
      return { ...s, stage: e.stage, marks: settleOthers(s.marks) };
    case 'sound': {
      if (isMeasuredStage(e.stage)) return { ...s, stage: e.stage, dots: s.dots.map((d, i) => (i === e.index && d === 'pending' ? 'sounding' : d)) };
      const marks = settleOthers(s.marks);
      const own = marks[e.stage];
      return { ...s, stage: e.stage, marks: own ? { ...marks, [e.stage]: own.map((d, i) => (i === e.index ? 'sounding' : d)) } : marks };
    }
    case 'click':
      return { ...s, dots: s.dots.map((d, i) => (i === e.index ? (e.heard ? 'heard' : 'missed') : d)) };
    case 'note':
      return {
        ...s,
        dots: s.dots.map((d, i) => (i === e.index ? (e.offsetMs === null ? 'missed' : 'heard') : d)),
        offsets: s.offsets.map((o, i) => (i === e.index ? e.offsetMs : o)),
      };
    case 'loopback-done': {
      const o = e.outcome;
      const end = { stage: null, marks: settleOthers(s.marks), checks: o.checks, failure: o.failure, clicksFound: o.clicksFound, method: 'loopback' as const, errored: false };
      if (!o.accepted) return { ...s, ...end, step: 'loopback-failed', rtlMs: o.rtlMs, madMs: o.madMs, warnings: e.warnings };
      return { ...s, ...end, step: 'measured', rtlMs: o.rtlMs, madMs: o.madMs, warnings: e.warnings, calibration: o.calibration, audibility: 'unanswered' };
    }
    case 'playalong-done': {
      const o = e.outcome;
      const dots: DotState[] = o.offsetsMs.map((v) => (v === null ? 'missed' : 'heard'));
      const end = { stage: null, marks: settleOthers(s.marks), checks: o.checks, failure: o.failure, clicksFound: o.notesFound, method: 'play-along' as const, errored: false };
      if (!o.accepted) {
        return { ...s, ...end, step: 'playalong-failed', dots, offsets: o.offsetsMs, rtlMs: o.rtlMs, madMs: o.madMs, warnings: e.warnings, playAlongFailures: s.playAlongFailures + 1 };
      }
      return { ...s, ...end, step: 'measured', dots, offsets: o.offsetsMs, rtlMs: o.rtlMs, madMs: o.madMs, warnings: e.warnings, calibration: o.calibration, playAlongFailures: 0 };
    }
    case 'run-error':
      // `stage` stays set: the failure names the stage it stopped in.
      return { ...s, step: s.step === 'playalong-running' ? 'playalong-failed' : 'loopback-failed', errored: true };
    case 'audibility':
      return { ...s, audibility: e.answer, step: e.answer === 'yes' ? 'finished' : s.step };
    case 'use-estimate':
      return { ...s, step: 'finished', estimate: true, calibration: null };
    case 'reset':
      return { ...initialCalState(), playAlongFailures: s.playAlongFailures };
  }
}

/** Speakers use loopback; headphone modes use play-along (01 section 7.8). */
export const methodFor = (o: OutputMode): 'loopback' | 'play-along' => (o === 'speakers' ? 'loopback' : 'play-along');

export const isIos = (c: Pick<PlatformCapabilities, 'osFamily'>): boolean => c.osFamily === 'ios' || c.osFamily === 'ipados';

/**
 * Warnings for a result (04 section 5.9 item 6; round 3, Bluetooth false positive). Bluetooth only on positive
 * evidence: the player chose Bluetooth, or the route's input is Bluetooth (label or hands-free signature, see
 * core/bluetooth-evidence.ts). Never from latency: a MacBook's built-in audio measures about 95 ms in Chrome. A
 * round trip above the ranked limit (`grading.ranked.maxRtlMs`, 120 ms) gets the neutral `delay` warning, and only
 * when the run was accepted (a rejected run's delay is not trusted; its failure message says what went wrong).
 * AirPods on iOS with Bluetooth evidence, AEC when the loopback run suspects it.
 */
export function warningsFor(i: {
  outputMode: OutputMode;
  rtlMs: number | null;
  maxRtlMs: number;
  /** The run's measurement was accepted. */
  accepted: boolean;
  route: Pick<AudioRouteInfo, 'inputKind'> | null;
  caps: Pick<PlatformCapabilities, 'osFamily'>;
  aecSuspected: boolean;
}): CalWarning[] {
  const out: CalWarning[] = [];
  const bt = i.outputMode === 'bluetooth' || i.route?.inputKind === 'bluetooth';
  if (bt) out.push('bluetooth');
  if (i.accepted && delayMatters(i.rtlMs, i.maxRtlMs)) out.push('delay');
  if (isIos(i.caps) && bt) out.push('airpods');
  if (i.aecSuspected) out.push('aec');
  return out;
}

const round2dp = (x: number | null): number | null => (x === null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);

/**
 * The diagnostics export with what the card showed added as `shown` (round 3, Bluetooth false positive): the run's
 * method and end step, whether it was accepted, its failure, round trip and spread, and the warnings it raised. The
 * self-test export alone could not say which warning a player saw or why. Numbers and enum names only. A JSON that
 * does not parse to an object is exported unchanged.
 */
export function diagnosticsWithResult(json: string, s: CalState): string {
  let d: unknown;
  try {
    d = JSON.parse(json);
  } catch {
    return json;
  }
  if (d === null || typeof d !== 'object' || Array.isArray(d)) return json;
  const shown = {
    method: s.method,
    step: s.step,
    accepted: (s.step === 'measured' || s.step === 'finished') && !s.estimate,
    failure: s.failure,
    rtlMs: round2dp(s.rtlMs),
    madMs: round2dp(s.madMs),
    warnings: [...s.warnings],
  };
  return JSON.stringify({ ...(d as Record<string, unknown>), shown }, null, 2);
}

/** R16: iOS where output latency is unreported has no Skip control in onboarding; calibration is the default path. */
export const calibrationIsMandatoryPath = (c: Pick<PlatformCapabilities, 'osFamily' | 'outputLatencyReported'>): boolean => isIos(c) && !c.outputLatencyReported;

/** Offset tick position: -1 (far left, early) to 1 (far right, late), clamped at 100 ms either way. */
export const offsetTick = (offsetMs: number | null, rangeMs = 100): number | null =>
  offsetMs === null ? null : Math.max(-1, Math.min(1, offsetMs / rangeMs));

export type StageStatus = 'upcoming' | 'now' | 'passed' | 'failed' | 'done';

/**
 * The status of each planned stage. Running: done before the current one, `now`, upcoming after. At the end, the
 * measured stage passes or fails with the measurement; the tone and count-in pass or fail with their audio-check
 * items; the template stage is done once played. A run that threw fails the stage it was in.
 */
export function stageStatuses(s: CalState): StageStatus[] {
  const plan = s.plan;
  if (!plan) return [];
  const ids = plan.stages.map((st) => st.id);
  const running = s.step === 'loopback-running' || s.step === 'playalong-running';
  const cur = s.stage === null ? -1 : ids.indexOf(s.stage);
  if (running) return ids.map((_, i) => (i < cur ? 'done' : i === cur ? 'now' : 'upcoming'));
  if (s.errored) return ids.map((_, i) => (i < cur ? 'done' : i === cur ? 'failed' : 'upcoming'));
  const item = (id: 'sanity-tone' | 'recheck'): StageStatus => {
    const st = s.checks?.items.find((x) => x.id === id)?.status;
    return st === 'pass' ? 'passed' : st === 'fail' ? 'failed' : 'done';
  };
  const measuredOk = (s.step === 'measured' || s.step === 'finished') && !s.estimate;
  return ids.map((id) => (isMeasuredStage(id) ? (measuredOk ? 'passed' : 'failed') : id === 'pitch' ? item('sanity-tone') : id === 'count-in' ? item('recheck') : 'done'));
}
