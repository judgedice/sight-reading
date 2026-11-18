/**
 * Calibration records and the method rules (01 §6.6, §7.8; 05 W6, W7, W8; R16, R17). Pure.
 */
import type { PlatformCapabilities } from '../core/platform.ts';
import type { AudioRouteInfo, Calibration, OutputMode, PlatformKind } from '../core/types.ts';
import type { CalibrationBudget } from './loopback.ts';

export type CalibrationMethod = Calibration['method'];

/** Fields of a calibration record not taken from the route. */
export interface CalibrationMeasurement {
  method: CalibrationMethod;
  roundTripMs: number;
  spreadMs: number;
  clicksDetected: number;
  clickLeakDb: number;
  noiseFloorDb: number;
  templates: Calibration['templates'];
  sanityToneCents: number | null;
  aecSuspected: boolean;
  clockRateError: number | null;
  outputLatencyMs?: number;
}

export function buildCalibration(route: Pick<AudioRouteInfo, 'routeKey' | 'outputMode'>, platform: PlatformKind, m: CalibrationMeasurement, measuredAt: string): Calibration {
  const c: Calibration = {
    routeKey: route.routeKey,
    platform,
    outputMode: route.outputMode,
    method: m.method,
    roundTripMs: m.roundTripMs,
    spreadMs: m.spreadMs,
    clicksDetected: m.clicksDetected,
    clickLeakDb: m.clickLeakDb,
    noiseFloorDb: m.noiseFloorDb,
    templates: m.templates,
    sanityToneCents: m.sanityToneCents,
    aecSuspected: m.aecSuspected,
    clockRateError: m.clockRateError,
    measuredAt,
    stale: false,
  };
  if (m.outputLatencyMs !== undefined) c.outputLatencyMs = m.outputLatencyMs;
  return c;
}

/**
 * Estimate used by "Use an estimate" when the browser reports no latency (iOS Safari): the middle of 05 §2.2's
 * 40 to 120 ms built-in speaker range. P14's choice; the result is always unranked (`calibration-unmeasured`).
 */
export const UNREPORTED_ESTIMATE_MS = 80;

/** Low-band level standing in for "no click" in headphone modes (the mic cannot hear the click), dBFS. */
export const NO_CLICK_DB = -120;

/** The `reported` method (01 §7.8): baseLatency + outputLatency + `reportedExtraMs`. Always unranked. */
export function reportedCalibration(
  route: Pick<AudioRouteInfo, 'routeKey' | 'outputMode' | 'reportedLatencySec'>,
  platform: PlatformKind,
  budget: CalibrationBudget,
  measuredAt: string,
  clockRateError: number | null = null,
): Calibration {
  const reported = route.reportedLatencySec;
  const rtl = reported !== undefined && reported > 0 ? reported * 1000 + budget.reportedExtraMs : UNREPORTED_ESTIMATE_MS;
  return buildCalibration(
    route,
    platform,
    {
      method: 'reported',
      roundTripMs: rtl,
      spreadMs: 0,
      clicksDetected: 0,
      clickLeakDb: NO_CLICK_DB,
      noiseFloorDb: NO_CLICK_DB,
      templates: {},
      sanityToneCents: null,
      aecSuspected: false,
      clockRateError,
      ...(reported !== undefined && reported > 0 ? { outputLatencyMs: reported * 1000 } : {}),
    },
    measuredAt,
  );
}

/** A measured (loopback or play-along), non-stale calibration for this route: gate (b) passes (05 W6). */
export function isMeasuredFor(c: Calibration | undefined | null, routeKey: string): boolean {
  return !!c && c.routeKey === routeKey && !c.stale && (c.method === 'loopback' || c.method === 'play-along');
}

/** Gate (b) quality (05 §4): MAD and click count within 01 §7.8's acceptance for the method. */
export function calibrationQualityOk(c: Calibration, budget: CalibrationBudget): boolean {
  if (c.method === 'loopback') {
    const lb = budget.loopback;
    return c.clicksDetected >= lb.minFound && c.spreadMs <= lb.maxMadMs && c.roundTripMs >= lb.minRtlMs && c.roundTripMs <= lb.maxRtlMs;
  }
  if (c.method === 'play-along') {
    const pa = budget.playAlong;
    return c.spreadMs <= pa.maxMadMs && c.roundTripMs >= pa.minRtlMs && c.roundTripMs <= pa.maxRtlMs;
  }
  return false;
}

/** W8 / gate (g): the measured RTL is above the ranked ceiling (`grading.ranked.maxRtlMs`, 120 ms). */
export const rtlHigh = (c: Pick<Calibration, 'roundTripMs'>, maxRtlMs: number): boolean => c.roundTripMs > maxRtlMs;

/** W7: a route change marks the stored calibration of the old key stale. Returns the record to store, or null. */
export function staleOnRouteChange(c: Calibration | undefined, oldKey: string, newKey: string): Calibration | null {
  if (!c || oldKey === newKey || c.routeKey !== oldKey || c.stale) return null;
  return { ...c, stale: true };
}

/** Where calibration starts for an output mode (01 §7.8): loopback on speakers, play-along in headphone modes. */
export const firstMethod = (mode: OutputMode): 'loopback' | 'play-along' => (mode === 'speakers' ? 'loopback' : 'play-along');

export interface CalibrationFlowState {
  outputMode: OutputMode;
  loopbackFailures: number;
  playAlongFailures: number;
}

export interface CalibrationFlowOptions {
  /** Show a Skip control (05 W6: none where the output latency is unreported). */
  showSkip: boolean;
  /** Offer loopback ([Try again] on speakers). */
  offerLoopback: boolean;
  /** Offer play-along ([Play along instead] after a loopback failure, or the headphone path). */
  offerPlayAlong: boolean;
  /** Offer "Use an estimate" (`reported`). */
  offerEstimate: boolean;
}

/**
 * The calibration step's exits (04 §5.9 item 5, 05 W6). Calibration never blocks a take (R16); this only decides the
 * controls. Without a reported output latency the step has no Skip; its exits are success or, after loopback and
 * play-along have each failed twice (play-along alone in headphone modes, where loopback cannot hear the click),
 * "Use an estimate". With a reported latency the estimate is offered after play-along fails twice (04).
 */
export function calibrationFlow(s: CalibrationFlowState, caps: Pick<PlatformCapabilities, 'outputLatencyReported'>): CalibrationFlowOptions {
  const speakers = s.outputMode === 'speakers';
  const playAlongTwice = s.playAlongFailures >= 2;
  const offerEstimate = caps.outputLatencyReported || !speakers ? playAlongTwice : playAlongTwice && s.loopbackFailures >= 2;
  return {
    showSkip: caps.outputLatencyReported,
    offerLoopback: speakers,
    offerPlayAlong: !speakers || s.loopbackFailures >= 1,
    offerEstimate,
  };
}
