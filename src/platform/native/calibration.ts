/**
 * Native calibration service (docs/native/AUDIO-DESIGN.md section 5, "When calibration can be skipped or shortened";
 * PLAN R86). The `Calibration` record is still made only by `src/calibration/run.ts`; this adds, on the native path only:
 *
 * - the latency record in kv under `native:latency:<routeKey>` (`{ predictedMs, measuredMs, trust, at, profile }`);
 * - the stale guard (rule 2): on every `unlock` and route event, a stored measured calibration whose route now reports a
 *   `predictedMs` more than 2 ms from the one stored with it is marked stale, through the app's own mechanism
 *   (`Calibration.stale` in the calibrations repo, which `isMeasuredFor` and `rankedAvailability` already read);
 * - the profile of a speaker run (rule 3): the engine's `measureLoopback()` first, and the shorter click gaps when it passes;
 * - the cross-check (rule 5): the engine's measurement against the stored round trip, kept in the record when they differ.
 *
 * Reported latency never ranks: nothing here writes a calibration, changes a gate or reads `predictedMs` for anything
 * but the staleness test.
 */
import type { AudioBackend, KeyValue, StoreRepos } from '../../core/platform.ts';
import type { AudioRouteInfo, Calibration, JsonValue } from '../../core/types.ts';
import { isMeasuredFor } from '../../calibration/index.ts';
import type { LatencyReport, LoopbackEstimate } from './audio/ipc.ts';

/** Where the latency record of a route is kept (kv). */
export const KV_NATIVE_LATENCY_PREFIX = 'native:latency:';
export const nativeLatencyKey = (routeKey: string): string => `${KV_NATIVE_LATENCY_PREFIX}${routeKey}`;

export type NativeCalProfile = 'native-short' | 'standard';

/** What `native:latency:<routeKey>` holds (JSON). */
export interface NativeLatencyRecord {
  /** The engine's reported round trip (output plus input), ms; null when it could not say (trust C, or a missing part). */
  predictedMs: number | null;
  /** The calibration's own round trip, ms. */
  measuredMs: number;
  trust: 'A' | 'B' | 'C';
  /** ISO 8601 UTC: `Calibration.measuredAt`. */
  at: string;
  /** Which click schedule the run used. */
  profile: NativeCalProfile;
  /** Only when the engine's own loopback measurement differed from `measuredMs` by more than `CROSS_CHECK_MS`: engine minus calibration, ms. */
  crossCheckMs?: number;
}

/** A reported latency that moves more than this marks the stored calibration stale, ms (PLAN R86). */
export const STALE_PREDICTED_MS = 2;
/** The engine's loopback and the stored round trip may differ by this much before it is noted, ms. */
export const CROSS_CHECK_MS = 1.5;
/** The pre-check passes on at least this many found clicks, at most this MAD and under this round trip, ms. */
export const PRECHECK = { minFound: 7, maxMadMs: 0.5, maxRoundTripMs: 100 } as const;
/** Click gaps of the short profile, seconds (the standard run's are 0.4 to 0.7). */
export const NATIVE_SHORT_GAP_SEC: [number, number] = [0.2, 0.35];

/** `(outputSec + inputSec) * 1000`; null when either side is unknown. */
export function predictedMsOf(l: Pick<LatencyReport, 'outputSec' | 'inputSec'> | null | undefined): number | null {
  if (!l || l.outputSec === null || l.inputSec === null) return null;
  const ms = (l.outputSec + l.inputSec) * 1000;
  return Number.isFinite(ms) ? ms : null;
}

/** Rule 2: the reported latency moved by more than 2 ms. Either side null never counts. */
export function predictedMoved(stored: number | null, now: number | null): boolean {
  return stored !== null && now !== null && Math.abs(now - stored) > STALE_PREDICTED_MS;
}

/** Rule 3's pre-check, from the engine's loopback estimate. */
export function precheckPasses(e: Pick<LoopbackEstimate, 'found' | 'roundTripMs' | 'madMs'>): boolean {
  return e.roundTripMs !== null && e.madMs !== null && e.found >= PRECHECK.minFound && e.madMs <= PRECHECK.maxMadMs && e.roundTripMs < PRECHECK.maxRoundTripMs;
}

/** The members of `NativeAudioBackend` this module uses. */
export interface NativeLatencySource {
  latencyReport(): LatencyReport | null;
  measureLoopback(): Promise<LoopbackEstimate>;
  onLatency?(cb: (r: AudioRouteInfo) => void): () => void;
  onRouteChange?(cb: (r: AudioRouteInfo) => void): () => void;
}

export interface NativeCalibrationDeps {
  audio: NativeLatencySource;
  kv: KeyValue;
  repos: Pick<StoreRepos, 'calibrations'>;
}

export interface ChosenProfile {
  profile: NativeCalProfile;
  /** Click gaps for `runLoopbackCalibration`; absent for the standard run. */
  gapSec?: [number, number];
}

/** What a run leaves for `save` to write once the calibration is stored. */
export interface PendingLatency {
  routeKey: string;
  measuredAt: string;
  record: NativeLatencyRecord;
}

/**
 * The native calibration hooks the composition root hands to `createCalibrationServices` and `composeApp`. Built by
 * `bootNative`; absent on the web.
 */
export class NativeCalibration {
  /**
   * End-to-end test hook (`window.__sr.native`, exposed only with `SR_E2E_HOOKS=1`): treats the pre-check as failed, so
   * the standard profile runs on a device whose pre-check would pass.
   */
  precheckDisabled = false;

  constructor(private readonly d: NativeCalibrationDeps) {}

  /** Rule 3: on speakers, the engine's loopback first; the short profile only when it passes. Never throws. */
  async chooseProfile(): Promise<ChosenProfile> {
    if (this.precheckDisabled) return { profile: 'standard' };
    try {
      return precheckPasses(await this.d.audio.measureLoopback()) ? { profile: 'native-short', gapSec: NATIVE_SHORT_GAP_SEC } : { profile: 'standard' };
    } catch {
      return { profile: 'standard' };
    }
  }

  /**
   * The record for an accepted calibration. Loopback runs are cross-checked against the engine's own measurement
   * (the calibration stays whatever it says); a failing cross-check measurement is ignored. Never throws.
   */
  async describe(c: Calibration, profile: NativeCalProfile): Promise<PendingLatency> {
    const report = this.d.audio.latencyReport();
    const record: NativeLatencyRecord = { predictedMs: predictedMsOf(report), measuredMs: c.roundTripMs, trust: report?.trust ?? 'C', at: c.measuredAt, profile };
    if (c.method === 'loopback') {
      try {
        const e = await this.d.audio.measureLoopback();
        if (e.roundTripMs !== null && Math.abs(e.roundTripMs - c.roundTripMs) > CROSS_CHECK_MS) record.crossCheckMs = e.roundTripMs - c.roundTripMs;
      } catch {
        /* the cross-check is advice; the calibration stands */
      }
    }
    return { routeKey: c.routeKey, measuredAt: c.measuredAt, record };
  }

  /** Writes the latency record. Never throws: a store that fails must not undo a stored calibration. */
  async write(p: PendingLatency): Promise<void> {
    try {
      await this.d.kv.set(nativeLatencyKey(p.routeKey), p.record as unknown as JsonValue);
    } catch {
      /* the next run writes it again */
    }
  }

  /**
   * Rule 2: marks the route's stored calibration stale when the reported `predictedMs` moved more than 2 ms from the one
   * stored with it. Does nothing without a stored measured (non-stale) calibration, a stored non-null `predictedMs`, or
   * a current non-null one (trust C). Returns whether it marked one. Never throws.
   */
  async guard(routeKey: string): Promise<boolean> {
    try {
      const rec = (await this.d.kv.get(nativeLatencyKey(routeKey))) as unknown as NativeLatencyRecord | undefined;
      if (!rec || !predictedMoved(rec.predictedMs ?? null, predictedMsOf(this.d.audio.latencyReport()))) return false;
      const c = await this.d.repos.calibrations.get(routeKey);
      if (!c || !isMeasuredFor(c, routeKey)) return false;
      await this.d.repos.calibrations.put({ ...c, stale: true });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * The backend as before, except that every `unlock()` result and every engine route event first runs the stale guard.
   * `unlock()` itself is still called synchronously (05 W1); only its promise waits for the guard. `onStale` runs after a
   * calibration was marked.
   */
  guarded<A extends AudioBackend>(audio: A, onStale: () => void): A {
    const run = async (r: AudioRouteInfo): Promise<void> => {
      if (await this.guard(r.routeKey)) onStale();
    };
    this.d.audio.onLatency?.((r) => void run(r));
    this.d.audio.onRouteChange?.((r) => void run(r));
    const unlock: AudioBackend['unlock'] = () => audio.unlock().then(async (r) => (await run(r), r));
    return new Proxy(audio, {
      get(target, prop) {
        if (prop === 'unlock') return unlock;
        const v: unknown = Reflect.get(target, prop, target);
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
  }
}
