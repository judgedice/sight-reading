/**
 * The calibrate route's services (src/app/screens/calibration/services.ts) built on the calibration package (01 §7.8,
 * P14). `app/` may not import `calibration/`; this composition helper adapts `runLoopbackCalibration`,
 * `runPlayAlongCalibration`, `runSelfTest` and `calibrationPlan` to the screen's shapes (01 §4.2 composition root).
 *
 * A run is one flow: the clock-rate check (silent), the calibration, then the audio self-test on the same route,
 * reusing the calibration's loopback and clock-rate result so nothing is played or measured twice.
 */
import type { AudioBackend, KeyValue, PlatformCapabilities, StoreRepos } from '../../core/platform.ts';
import type { AppSettings, Calibration, Configs, JsonValue, Rng } from '../../core/types.ts';
import {
  calibrationPlan,
  exportDiagnostics,
  runClockRateCheck,
  runLoopbackCalibration,
  runPlayAlongCalibration,
  runSelfTest,
  type CalibrationDeps,
  type CalibrationProgress,
  type ClockRateResult,
  type LoopbackRun,
  type SelfTestResult,
} from '../../calibration/index.ts';
import type { NativeCalibration, PendingLatency } from '../../platform/native/calibration.ts';
import type { CalibrationServices, SelfTestItemId, SelfTestOutcome } from '../screens/calibration/services.ts';
import type { Readable } from '../screens/home/services.ts';
import { KV_CAL_LAST_FAILURE, type CalFailure } from './calibration-status.ts';

/** Backend members beyond the frozen seam that calibration uses when present (WebAudioBackend has them). */
export interface CalibrationBackendExtras {
  setOutputMode?(mode: AppSettings['practice']['outputMode']): void;
  /** Calibration listens: an earlier output-only unlock (a sound preview) or practise without listening turned input off. */
  setInputEnabled?(on: boolean): void;
  checkClockRate?(): Promise<{ ok: boolean; error: number | null; recreated: boolean }>;
}

export interface CalibrationServicesDeps {
  audio: AudioBackend & CalibrationBackendExtras;
  capabilities: PlatformCapabilities;
  configs: Configs;
  rng: Rng;
  settings: Readable<AppSettings>;
  saveSettings(next: AppSettings): void;
  saveCalibration(c: Calibration): Promise<void>;
  clockWall(): string;
  timers: { setTimeout(fn: () => void, ms: number): unknown };
  inputDevices(): Promise<{ id: string; label: string }[]>;
  download(name: string, text: string): void;
  appBuild: string;
  /** Where `cal:lastFailure` is kept (write on a failed run, clear on a stored one). Absent: nothing is recorded. */
  kv?: KeyValue;
  /**
   * The native calibration service (AUDIO-DESIGN section 5), on the native path only: a speaker run picks its profile from
   * the engine's loopback pre-check, and a stored run leaves the `native:latency:<routeKey>` record. Absent on the web,
   * where nothing here changes.
   */
  native?: NativeCalibration | null;
}

/** Copy key (and its placeholder values) that explains a failed run; the status popover shows it. */
function failureReason(method: CalFailure['method'], failure: string | null, found: number, total: number): Pick<CalFailure, 'reason' | 'vars'> {
  if (method === 'play-along') return { reason: failure === null ? 'calibrate.fail.error' : 'calibrate.fail.playAlong' };
  if (failure === 'too-few-clicks') return { reason: 'calibrate.fail.loopback.few', vars: { found, total } };
  if (failure === 'spread') return { reason: 'calibrate.fail.loopback.spread' };
  if (failure === 'rtl-range') return { reason: 'calibrate.fail.loopback.range' };
  return { reason: 'calibrate.fail.error' };
}

/**
 * A calibration stored before round 2 under a key made from a prefixed label ("Default - MacBook Pro Microphone
 * (Built-in)") is this route's too (`routeKeyAliasesOf`, current key first). Copies the newest one to the current key
 * when the current key has none; the old record stays. Returns what was copied, or null.
 */
export async function adoptLegacyCalibrations(repos: Pick<StoreRepos, 'calibrations'>, aliases: readonly string[]): Promise<Calibration | null> {
  const [current, ...legacy] = aliases;
  if (current === undefined || (await repos.calibrations.get(current))) return null;
  const found = (await Promise.all(legacy.map((k) => repos.calibrations.get(k)))).filter((c): c is Calibration => c !== undefined);
  const newest = found.sort((a, b) => b.measuredAt.localeCompare(a.measuredAt))[0];
  if (!newest) return null;
  const adopted: Calibration = { ...newest, routeKey: current };
  await repos.calibrations.put(adopted);
  return adopted;
}

/**
 * The backend as before, except that every route it reports (from `unlock()` or a route change) first adopts a
 * calibration stored under one of the route's older keys (`AudioRouteInfo.routeKeyAliases`), so the Ranked gate and
 * the calibration status, which read `calibrations.get(routeKey)`, find it. `unlock()` itself is still called
 * synchronously (05 W1); only its promise waits for the adoption. A failed adoption is ignored. `onAdopted` runs
 * after a calibration was copied.
 */
export function adoptingLegacyCalibrations<A extends AudioBackend>(audio: A, repos: Pick<StoreRepos, 'calibrations'>, onAdopted: () => void): A {
  const adopt = async (r: Awaited<ReturnType<AudioBackend['unlock']>>): Promise<void> => {
    const aliases = r.routeKeyAliases;
    if (!aliases || aliases.length < 2) return;
    try {
      if (await adoptLegacyCalibrations(repos, aliases)) onAdopted();
    } catch {
      /* the route then reads as not calibrated */
    }
  };
  const unlock: AudioBackend['unlock'] = () => audio.unlock().then(async (r) => (await adopt(r), r));
  const onRouteChange: AudioBackend['onRouteChange'] = (cb) =>
    audio.onRouteChange((r) => {
      cb(r);
      void adopt(r);
    });
  return new Proxy(audio, {
    get(target, prop) {
      if (prop === 'unlock') return unlock;
      if (prop === 'onRouteChange') return onRouteChange;
      const v: unknown = Reflect.get(target, prop, target);
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

export function createCalibrationServices(d: CalibrationServicesDeps): CalibrationServices {
  const budget = d.configs.budget.calibration;
  const sleep = (ms: number): Promise<void> => new Promise((r) => d.timers.setTimeout(r, ms));
  const deps: CalibrationDeps = {
    audio: d.audio,
    rng: d.rng,
    budget,
    clockWall: d.clockWall,
    async waitUntil(t) {
      while ((d.audio.now() as number) < t) await sleep(Math.min(100, Math.max(5, ((t - (d.audio.now() as number)) * 1000) / 2)));
    },
  };
  let unlocked: ReturnType<AudioBackend['unlock']> | null = null;
  const route = async () => (unlocked ? unlocked : (unlocked = d.audio.unlock()));
  /** The backend's own clock-rate check (WebAudioBackend), once per run; null where the backend has none or it threw. */
  const clockRate = async (): Promise<ClockRateResult | null> => {
    if (typeof d.audio.checkClockRate !== 'function') return null;
    try {
      return await runClockRateCheck(d.audio, budget);
    } catch {
      return null;
    }
  };
  /** Never throws into the run: a store that fails must not turn a finished measurement into an error. */
  const recordFailure = async (f: CalFailure | null): Promise<void> => {
    try {
      if (!d.kv) return;
      if (f) await d.kv.set(KV_CAL_LAST_FAILURE, f as unknown as JsonValue);
      else await d.kv.delete(KV_CAL_LAST_FAILURE);
    } catch {
      /* the status falls back to "not calibrated" */
    }
  };
  const failed = (method: CalFailure['method'], failure: string | null, found: number, total: number): Promise<void> =>
    recordFailure({ at: d.clockWall(), method, ...failureReason(method, failure, found, total) });
  const outcome = (res: SelfTestResult): SelfTestOutcome => ({
    passed: res.passed,
    items: res.items.map((i) => ({ id: i.id as SelfTestItemId, status: i.status, reason: typeof i.detail['reason'] === 'string' ? i.detail['reason'] : null })),
    diagnosticsJson: exportDiagnostics(res.diagnostics),
  });
  /** The audio check after a run, on the same route; it never fails the calibration (R16). */
  const checks = async (r: Awaited<ReturnType<AudioBackend['unlock']>>, clock: ClockRateResult | null, loopback: LoopbackRun | null, progress: CalibrationProgress): Promise<SelfTestOutcome | null> => {
    try {
      const res = await runSelfTest(deps, {
        route: r,
        capabilities: d.capabilities,
        timbre: d.settings.get().practice.clickTimbre,
        recheckAgreeMs: d.configs.grading.ranked.recheckAgreeMs,
        appBuild: d.appBuild,
        progress,
        ...(clock ? { clock } : {}),
        ...(loopback ? { loopback } : {}),
      });
      return outcome(res);
    } catch {
      return null;
    }
  };
  /** The latency record of the last accepted native run, written by `save` once that calibration is stored. */
  let pendingLatency: PendingLatency | null = null;
  const runLoopbackInner = async (o: Parameters<CalibrationServices['runLoopback']>[0]) => {
    const r = await route();
    // The clock-rate check is the engine's own running check on native (`audio_clock_check` answers at once from the clock
    // points it already holds), so the short profile needs nothing else here.
    const clock = await clockRate();
    pendingLatency = null;
    const progress: CalibrationProgress = { onStage: o.onStage, onSound: o.onSound };
    const profile = d.native ? await d.native.chooseProfile() : null;
    const run = await runLoopbackCalibration(deps, {
      route: r,
      timbre: d.settings.get().practice.clickTimbre,
      clockRateError: clock?.error ?? null,
      onClick: o.onClick,
      progress,
      ...(profile?.gapSec ? { gapSec: profile.gapSec } : {}),
    });
    const lb = run.loopback;
    if (!lb.accepted || !run.calibration) await failed('loopback', lb.failure, lb.clicksFound, lb.clicksScheduled);
    const checked = await checks(r, clock, run, progress);
    if (d.native && run.calibration) pendingLatency = await d.native.describe(run.calibration, profile?.profile ?? 'standard');
    return {
      accepted: lb.accepted,
      failure: lb.failure,
      rtlMs: lb.rtlMs,
      madMs: lb.madMs,
      clicksFound: lb.clicksFound,
      clicksScheduled: lb.clicksScheduled,
      aecSuspected: run.aec.suspected,
      calibration: run.calibration,
      checks: checked,
    };
  };
  const runPlayAlongInner = async (o: Parameters<CalibrationServices['runPlayAlong']>[0]) => {
    const r = await route();
    const clock = await clockRate();
    const progress: CalibrationProgress = { onStage: o.onStage, onSound: o.onSound };
    const run = await runPlayAlongCalibration(deps, { route: r, timbre: d.settings.get().practice.clickTimbre, clockRateError: clock?.error ?? null, progress });
    run.playAlong.offsetsMs.forEach((ms, i) => o.onNote(i, ms));
    const pa = run.playAlong;
    if (!pa.accepted || !run.calibration) await failed('play-along', pa.failure, pa.notesFound, pa.clicks);
    pendingLatency = null;
    const checked = await checks(r, clock, null, progress);
    if (d.native && run.calibration) pendingLatency = await d.native.describe(run.calibration, 'standard');
    return {
      accepted: pa.accepted,
      failure: pa.failure,
      rtlMs: pa.rtlMs,
      madMs: pa.madMs,
      notesFound: pa.notesFound,
      clicks: pa.clicks,
      offsetsMs: pa.offsetsMs,
      calibration: run.calibration,
      checks: checked,
    };
  };
  return {
    capabilities: d.capabilities,
    maxRtlMs: d.configs.grading.ranked.maxRtlMs,
    plan: (mode) => calibrationPlan(budget, mode),
    clickSound: () => d.settings.get().practice.clickTimbre,
    prefs: () => ({ outputMode: d.settings.get().practice.outputMode, inputDeviceId: d.settings.get().audio.inputDeviceId }),
    async setPrefs(p) {
      const s = d.settings.get();
      const next: AppSettings = {
        ...s,
        practice: p.outputMode !== undefined ? { ...s.practice, outputMode: p.outputMode } : s.practice,
        audio: p.inputDeviceId !== undefined ? { ...s.audio, inputDeviceId: p.inputDeviceId } : s.audio,
      };
      if (p.outputMode !== undefined) d.audio.setOutputMode?.(p.outputMode);
      d.saveSettings(next);
    },
    inputDevices: () => d.inputDevices(),
    unlock() {
      d.audio.setOutputMode?.(d.settings.get().practice.outputMode);
      d.audio.setInputEnabled?.(true);
      unlocked = d.audio.unlock();
      return unlocked;
    },
    async runLoopback(o) {
      try {
        return await runLoopbackInner(o);
      } catch (e) {
        await failed('loopback', null, 0, 0);
        throw e;
      }
    },
    async runPlayAlong(o) {
      try {
        return await runPlayAlongInner(o);
      } catch (e) {
        await failed('play-along', null, 0, 0);
        throw e;
      }
    },
    async save(c) {
      await d.saveCalibration(c);
      await recordFailure(null);
      // Only the run's own calibration leaves a latency record ("Use an estimate" stores `reported`, which does not).
      const p = pendingLatency;
      if (d.native && p && p.routeKey === c.routeKey && p.measuredAt === c.measuredAt) {
        pendingLatency = null;
        await d.native.write(p);
      }
    },
    exportDiagnostics: (json) => d.download('sightread-diagnostics.json', json),
  };
}
