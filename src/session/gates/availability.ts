/**
 * Can the next try be ranked (05 §4.5, §5.8; round 3, R79)? One predicate for Home, the cover and the start of the
 * try: the take gate's `calibration-unmeasured` check (`calibrationForRoute`, so a stale or reported calibration does
 * not count) and its delay ceiling (gate (g)), plus the microphone: practise without listening or a denied permission
 * blocks Ranked first, since nothing can be measured.
 *
 * The route key includes the output mode, so a route opened for another output says nothing about the next try: it
 * is then treated as unknown (the review's headphones-without-calibration case, round 3 problem 1).
 */
import type { Calibration, OutputMode } from '../../core/types.ts';
import { calibrationForRoute } from './gate.ts';

/**
 * Why Ranked cannot be chosen: `mic` shows "Turn on microphone", `calibration` shows "Calibrate now", `delay` says the
 * measured delay is above the ranked ceiling.
 */
export type RankedBlockReason = 'mic' | 'calibration' | 'delay';

export interface RankedAvailability {
  available: boolean;
  block: RankedBlockReason | null;
}

export interface RankedAvailabilityFacts {
  /**
   * The route the next take would use, when known (after an unlock). Unknown: any stored calibration measured for
   * its own route and the chosen output mode counts, since the route key is only known once audio is open.
   */
  routeKey: string | null;
  /** The output mode `routeKey` was opened for. A different `outputMode` makes the route unknown. Absent: trusted. */
  routeOutputMode?: OutputMode | null | undefined;
  outputMode: OutputMode;
  /** Every stored calibration (repos.calibrations.all()). */
  calibrations: readonly Calibration[];
  /** The player's "listening" setting (false = practise without listening, R13). */
  listening: boolean;
  /** `AudioBackend.permissionState()`. */
  permission: 'granted' | 'denied' | 'prompt' | 'unknown';
  /** `grading.ranked.maxRtlMs`: a calibration measuring more is practice (gate (g)). Absent: no ceiling here. */
  maxRtlMs?: number;
}

/** The route key to judge the next try by: null when the open route was for another output mode. */
export function routeKeyForOutput(routeKey: string | null, routeOutputMode: OutputMode | null | undefined, outputMode: OutputMode): string | null {
  if (routeKey === null) return null;
  return routeOutputMode !== undefined && routeOutputMode !== null && routeOutputMode !== outputMode ? null : routeKey;
}

/** The measured calibration the next try would use, newest first, or null. */
export function measuredCalibration(f: Pick<RankedAvailabilityFacts, 'routeKey' | 'routeOutputMode' | 'outputMode' | 'calibrations'>): Calibration | null {
  const key = routeKeyForOutput(f.routeKey, f.routeOutputMode, f.outputMode);
  const hits = f.calibrations.filter((c) => (key !== null ? calibrationForRoute(c, key) !== null : c.outputMode === f.outputMode && calibrationForRoute(c, c.routeKey) !== null));
  return [...hits].sort((a, b) => b.measuredAt.localeCompare(a.measuredAt))[0] ?? null;
}

export function rankedAvailability(f: RankedAvailabilityFacts): RankedAvailability {
  if (!f.listening || f.permission === 'denied') return { available: false, block: 'mic' };
  const c = measuredCalibration(f);
  if (!c) return { available: false, block: 'calibration' };
  if (f.maxRtlMs !== undefined && c.roundTripMs > f.maxRtlMs) return { available: false, block: 'delay' };
  return { available: true, block: null };
}
