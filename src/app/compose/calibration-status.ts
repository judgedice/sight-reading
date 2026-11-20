/**
 * The calibration status line (round 2, 01-ux §4): one answer to "is this setup calibrated?" for Practice, the
 * read-through, Results and Settings. It uses the same predicate as Ranked availability: `state === 'ok'` exactly
 * when `rankedAvailability(...).block !== 'calibration'`. It is computed by calling `rankedAvailability` itself, so the
 * two cannot drift apart, and a generated table in the test checks it.
 *
 * Pure: no storage, no clock. The caller reads the stored calibrations and `cal:lastFailure` and passes them in.
 */
import type { Calibration, OutputMode } from '../../core/types.ts';
import { calibrationForRoute, rankedAvailability } from '../../session/gates/index.ts';

/** The kv key calibration services write on a failed run and clear on a stored one (06-plan §4). */
export const KV_CAL_LAST_FAILURE = 'cal:lastFailure';

/** What `cal:lastFailure` holds (JSON). `reason` is a copy key; `vars` fills its placeholders. */
export interface CalFailure {
  /** ISO 8601 UTC, when the run failed. */
  at: string;
  method: 'loopback' | 'play-along';
  reason: string;
  vars?: Record<string, number>;
}

export type CalState = 'ok' | 'none' | 'changed' | 'failed';

export interface CalStatus {
  state: CalState;
  /** The current output mode (`speakers`, `wired`, `bluetooth`) for `ok` and `changed`; the screen names it from copy. */
  output: OutputMode | null;
  /** `changed`: the output the earlier calibration was for. */
  oldOutput: OutputMode | null;
  /** `ok`: when the calibration was measured. */
  when: 'today' | 'yesterday' | { date: string } | null;
  /** `ok`: the round-trip delay the setup adds, whole ms. */
  ms: number | null;
  /** `failed`: copy key of the reason line. */
  reason: string | null;
  /** `failed`: values for the reason's placeholders. */
  reasonVars?: Record<string, number> | null;
}

export interface CalStatusFacts {
  /** Every stored calibration (`repos.calibrations.all()`). */
  calibrations: readonly Calibration[];
  /** The route the next try would use, or null before audio is open. */
  routeKey: string | null;
  outputMode: OutputMode;
  lastFailure: CalFailure | null;
  /** Epoch ms. */
  now: number;
  /** The player's local calendar day (`yyyy-mm-dd`) of an epoch ms. */
  localDay(ms: number): string;
}

const DAY_MS = 86_400_000;

function whenOf(iso: string, f: Pick<CalStatusFacts, 'now' | 'localDay'>): NonNullable<CalStatus['when']> {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return { date: iso.slice(0, 10) };
  const day = f.localDay(t);
  if (day === f.localDay(f.now)) return 'today';
  if (day === f.localDay(f.now - DAY_MS)) return 'yesterday';
  return { date: day };
}

/** The calibration the status and Ranked both rely on: same test as `rankedAvailability`, newest first. */
function applicable(f: CalStatusFacts): Calibration | null {
  const hits = f.calibrations.filter((c) =>
    f.routeKey !== null ? calibrationForRoute(c, f.routeKey) !== null : c.outputMode === f.outputMode && calibrationForRoute(c, c.routeKey) !== null,
  );
  return hits.sort((a, b) => b.measuredAt.localeCompare(a.measuredAt))[0] ?? null;
}

export function calibrationStatus(f: CalStatusFacts): CalStatus {
  const blank: CalStatus = { state: 'none', output: null, oldOutput: null, when: null, ms: null, reason: null };
  // The microphone facts do not matter here: only the calibration half of the predicate.
  const ranked = rankedAvailability({ routeKey: f.routeKey, outputMode: f.outputMode, calibrations: f.calibrations, listening: true, permission: 'granted' });
  if (ranked.block !== 'calibration') {
    const c = applicable(f);
    // `rankedAvailability` and `applicable` share one test, so `c` is set; a null would be a bug, read as none.
    if (!c) return blank;
    return { ...blank, state: 'ok', output: c.outputMode, when: whenOf(c.measuredAt, f), ms: Math.round(c.roundTripMs) };
  }
  if (f.lastFailure) return { ...blank, state: 'failed', reason: f.lastFailure.reason, reasonVars: f.lastFailure.vars ?? null };
  const earlier = [...f.calibrations].filter((c) => c.method !== 'reported').sort((a, b) => b.measuredAt.localeCompare(a.measuredAt))[0];
  if (earlier) return { ...blank, state: 'changed', output: f.outputMode, oldOutput: earlier.outputMode };
  return blank;
}

/**
 * Results shows "Your audio delay changed. Recalibrate" only when the try had a measured calibration to compare with
 * (round 2, cause 4). Before this, `promptRecalibrate` alone decided, and a try on a reported estimate or none got it.
 */
export function recheckShiftApplies(c: { method: Calibration['method'] | 'none'; recheck: { promptRecalibrate: boolean } | null }): boolean {
  return (c.method === 'loopback' || c.method === 'play-along') && c.recheck?.promptRecalibrate === true;
}
