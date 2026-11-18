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
  const rankedReasons: RankedReason[] = [];
  for (const g of gateFailures) {
    const r = reasonForGate(g);
    if (!rankedReasons.includes(r)) rankedReasons.push(r);
  }
  return { gateFailures, rankedReasons, gatePassed: gateFailures.length === 0 };
}

/** 05 W8 label pattern. */
export const BLUETOOTH_LABEL = /airpods|bluetooth|beats|headset|hands-free/i;

export interface BluetoothBanner {
  show: boolean;
  /** iOS adds the hint that AirPods microphones reduce accuracy (04 copy). */
  iosHint: boolean;
}

/** W8: label match or measured RTL above the ranked ceiling (gate (g)). */
export function bluetoothBanner(
  f: { inputLabel: string | null | undefined; inputKind?: AudioRouteInfo['inputKind']; roundTripMs: number | null; osFamily: OsFamily },
  cfg: Configs,
): BluetoothBanner {
  const byLabel = !!f.inputLabel && BLUETOOTH_LABEL.test(f.inputLabel);
  const byKind = f.inputKind === 'bluetooth';
  const byRtl = f.roundTripMs !== null && f.roundTripMs > cfg.grading.ranked.maxRtlMs;
  const show = byLabel || byKind || byRtl;
  return { show, iosHint: show && (f.osFamily === 'ios' || f.osFamily === 'ipados') };
}
