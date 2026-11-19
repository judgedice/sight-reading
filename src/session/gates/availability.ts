/**
 * Can the player choose Ranked on Practice (05 §4.5, §5.8)? The same predicate as the take gate's
 * `calibration-unmeasured` check (`calibrationForRoute`, so a stale or reported calibration does not count), plus the
 * microphone: practise without listening or a denied permission blocks Ranked first, since nothing can be measured.
 */
import type { Calibration, OutputMode } from '../../core/types.ts';
import { calibrationForRoute } from './gate.ts';

/** Why Ranked cannot be chosen: `mic` shows "Turn on microphone", `calibration` shows "Calibrate now". */
export type RankedBlockReason = 'mic' | 'calibration';

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
  outputMode: OutputMode;
  /** Every stored calibration (repos.calibrations.all()). */
  calibrations: readonly Calibration[];
  /** The player's "listening" setting (false = practise without listening, R13). */
  listening: boolean;
  /** `AudioBackend.permissionState()`. */
  permission: 'granted' | 'denied' | 'prompt' | 'unknown';
}

export function rankedAvailability(f: RankedAvailabilityFacts): RankedAvailability {
  if (!f.listening || f.permission === 'denied') return { available: false, block: 'mic' };
  const measured =
    f.routeKey !== null
      ? f.calibrations.some((c) => calibrationForRoute(c, f.routeKey as string) !== null)
      : f.calibrations.some((c) => c.outputMode === f.outputMode && calibrationForRoute(c, c.routeKey) !== null);
  return measured ? { available: true, block: null } : { available: false, block: 'calibration' };
}
