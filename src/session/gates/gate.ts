/**
 * Per-take measurement gate (05 §4, W6, W8) from raw facts. Thresholds come from `Configs`
 * (`grading.ranked`, `budget.calibration`); this module holds none. The per-check rules are `evaluateGate`
 * (grade/progression); this layer derives its plain inputs (sample-rate agreement, route-matched calibration,
 * capture continuity) and adds the ranked-reason mapping and the Bluetooth banner flag.
 */
import { evaluateGate, reasonForGate } from '../../grade/index.ts';
import type {
  AppliedProcessing,
  AttemptRecheck,
  AudioRouteInfo,
  Calibration,
  Configs,
  DspStats,
  GateId,
  OsFamily,
  RankedReason,
} from '../../core/types.ts';
import { isMeasuredFor } from '../../calibration/index.ts';
import { BLUETOOTH_LABEL_RE, bluetoothLabelMatches, delayMatters } from '../../core/bluetooth-evidence.ts';

export interface GateFacts {
  /** Route of this take (routeKey decides whether the stored calibration applies). */
  route: Pick<AudioRouteInfo, 'routeKey' | 'appliedProcessing'>;
  /** Stored calibration for this route key, or null/undefined. */
  calibration: Calibration | null | undefined;
  /** `ctx.sampleRate`, Hz. */
  contextSampleRate: number;
  /** `track.getSettings().sampleRate` when reported. */
  trackSampleRate: number | null;
  /** Fractional clock-rate error from 01 §7.8; null when not measured. */
  clockRateError: number | null;
  /** Speakers only; null in headphone modes. */
  recheck: AttemptRecheck | null;
  /** Worker telemetry; `missingBlocks` and `droppedBlocks` both count as capture gaps. */
  dsp: Pick<DspStats, 'droppedBlocks' | 'missingBlocks'>;
  /** What follow/ subtracted this take, ms. */
  latencyCompensationMs: number;
}

export interface GateResult {
  gateFailures: GateId[];
  /** Ranked reasons the gate contributes (05 §4 mapping), deduplicated, in gate order. */
  rankedReasons: RankedReason[];
  /** No gate failure. Other ranked rules (mode, tempo, familiarity) are the grader's. */
  gatePassed: boolean;
  /** The `sample-rate` failure comes only from the clock-rate check (the track rate matched): reason `clock-rate`. */
  clockRateOff: boolean;
}

/** True when the stored calibration is a measured, non-stale one for this route (W6). */
export function calibrationForRoute(c: Calibration | null | undefined, routeKey: string): Calibration | null {
  return c && isMeasuredFor(c, routeKey) ? c : null;
}

export function evaluateTakeGate(f: GateFacts, cfg: Configs): GateResult {
  const trackOk = f.trackSampleRate === null || f.trackSampleRate === f.contextSampleRate;
  const clockOk = f.clockRateError === null || Math.abs(f.clockRateError) <= cfg.budget.calibration.clockRateMaxError;
  const applied: AppliedProcessing = f.route.appliedProcessing;
  const gateFailures = evaluateGate(
    {
      calibration: calibrationForRoute(f.calibration, f.route.routeKey),
      applied,
      sampleRateOk: trackOk && clockOk,
      recheck: f.recheck,
      captureGaps: f.dsp.missingBlocks + f.dsp.droppedBlocks,
      latencyCompensationMs: f.latencyCompensationMs,
    },
    cfg,
  );
  const clockRateOff = trackOk && !clockOk;
  const rankedReasons: RankedReason[] = [];
  for (const g of gateFailures) {
    const r = g === 'sample-rate' && clockRateOff ? 'clock-rate' : reasonForGate(g);
    if (!rankedReasons.includes(r)) rankedReasons.push(r);
  }
  return { gateFailures, rankedReasons, gatePassed: gateFailures.length === 0, clockRateOff };
}

/** 05 W8 label pattern (core/bluetooth-evidence.ts). */
export const BLUETOOTH_LABEL = BLUETOOTH_LABEL_RE;

export interface BluetoothBanner {
  show: boolean;
  /** iOS adds the hint that AirPods microphones reduce accuracy (04 copy). */
  iosHint: boolean;
  /**
   * The measured round trip is above the ranked ceiling (gate (g)). Not Bluetooth evidence: it gets the neutral delay
   * message, whatever the route (round 3, Bluetooth false positive).
   */
  delayHigh: boolean;
}

/** W8: Bluetooth only on positive evidence (a Bluetooth label or input kind), never from the round trip alone. */
export function bluetoothBanner(
  f: { inputLabel: string | null | undefined; inputKind?: AudioRouteInfo['inputKind']; roundTripMs: number | null; osFamily: OsFamily },
  cfg: Configs,
): BluetoothBanner {
  const show = bluetoothLabelMatches(f.inputLabel) || f.inputKind === 'bluetooth';
  return { show, iosHint: show && (f.osFamily === 'ios' || f.osFamily === 'ipados'), delayHigh: delayMatters(f.roundTripMs, cfg.grading.ranked.maxRtlMs) };
}
