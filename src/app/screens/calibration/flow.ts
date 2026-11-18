/**
 * The calibration card's state machine (04 section 5.9). Pure: the card feeds it events and renders its state.
 * Calibration never blocks a take (R16): every end state lets the player carry on; a missing measurement only
 * makes takes practice.
 */
import type { PlatformCapabilities } from '../../../core/platform.ts';
import type { AudioRouteInfo, Calibration, OutputMode } from '../../../core/types.ts';
import type { LoopbackOutcome, PlayAlongOutcome } from './services.ts';

export type DotState = 'pending' | 'heard' | 'missed';

export type CalStep =
  | 'idle'
  | 'loopback-running'
  | 'loopback-failed'
  | 'playalong-running'
  | 'playalong-failed'
  /** Measured; on speakers the audibility question follows. */
  | 'measured'
  | 'finished';

export type CalWarning = 'bluetooth' | 'airpods' | 'aec';

export interface CalState {
  step: CalStep;
  dots: DotState[];
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
  dots: [],
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
  | { type: 'start-loopback'; clicks: number }
  | { type: 'start-playalong'; clicks: number }
  | { type: 'click'; index: number; heard: boolean }
  | { type: 'note'; index: number; offsetMs: number | null }
  | { type: 'loopback-done'; outcome: LoopbackOutcome; warnings: CalWarning[] }
  | { type: 'playalong-done'; outcome: PlayAlongOutcome; warnings: CalWarning[] }
  | { type: 'run-error' }
  | { type: 'audibility'; answer: 'yes' | 'not-really' }
  | { type: 'use-estimate' }
  | { type: 'reset' };

const sized = (n: number): DotState[] => Array.from({ length: n }, () => 'pending');

export function calReducer(s: CalState, e: CalEvent): CalState {
  switch (e.type) {
    case 'start-loopback':
      return { ...initialCalState(), step: 'loopback-running', dots: sized(e.clicks), playAlongFailures: s.playAlongFailures };
    case 'start-playalong':
      return { ...initialCalState(), step: 'playalong-running', dots: sized(e.clicks), offsets: e.clicks > 0 ? Array.from({ length: e.clicks }, () => null) : [], playAlongFailures: s.playAlongFailures };
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
      if (!o.accepted) return { ...s, step: 'loopback-failed', rtlMs: o.rtlMs, madMs: o.madMs, warnings: e.warnings, errored: false };
      return { ...s, step: 'measured', method: 'loopback', rtlMs: o.rtlMs, madMs: o.madMs, warnings: e.warnings, calibration: o.calibration, audibility: 'unanswered', errored: false };
    }
    case 'playalong-done': {
      const o = e.outcome;
      const dots: DotState[] = o.offsetsMs.map((v) => (v === null ? 'missed' : 'heard'));
      if (!o.accepted) {
        return { ...s, step: 'playalong-failed', dots, offsets: o.offsetsMs, rtlMs: o.rtlMs, madMs: o.madMs, warnings: e.warnings, playAlongFailures: s.playAlongFailures + 1, errored: false };
      }
      return { ...s, step: 'measured', method: 'play-along', dots, offsets: o.offsetsMs, rtlMs: o.rtlMs, madMs: o.madMs, warnings: e.warnings, calibration: o.calibration, playAlongFailures: 0, errored: false };
    }
    case 'run-error':
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
 * Warnings for a result (04 section 5.9 item 6): Bluetooth when declared or when the RTL is above the ranked limit,
 * AirPods on iOS with a Bluetooth input, AEC when the loopback run suspects it.
 */
export function warningsFor(i: {
  outputMode: OutputMode;
  rtlMs: number | null;
  maxRtlMs: number;
  route: Pick<AudioRouteInfo, 'inputKind'> | null;
  caps: Pick<PlatformCapabilities, 'osFamily'>;
  aecSuspected: boolean;
}): CalWarning[] {
  const out: CalWarning[] = [];
  const bt = i.outputMode === 'bluetooth' || (i.rtlMs !== null && i.rtlMs > i.maxRtlMs);
  if (bt) out.push('bluetooth');
  if (isIos(i.caps) && (i.route?.inputKind === 'bluetooth' || bt)) out.push('airpods');
  if (i.aecSuspected) out.push('aec');
  return out;
}

/** R16: iOS where output latency is unreported has no Skip control in onboarding; calibration is the default path. */
export const calibrationIsMandatoryPath = (c: Pick<PlatformCapabilities, 'osFamily' | 'outputLatencyReported'>): boolean => isIos(c) && !c.outputLatencyReported;

/** Offset tick position: -1 (far left, early) to 1 (far right, late), clamped at 100 ms either way. */
export const offsetTick = (offsetMs: number | null, rangeMs = 100): number | null =>
  offsetMs === null ? null : Math.max(-1, Math.min(1, offsetMs / rangeMs));
