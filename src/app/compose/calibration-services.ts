/**
 * The calibrate route's services (src/app/screens/calibration/services.ts) built on the calibration package (01 §7.8,
 * P14). `app/` may not import `calibration/`; this composition helper adapts `runLoopbackCalibration`,
 * `runPlayAlongCalibration`, `runSelfTest` and `calibrationPlan` to the screen's shapes (01 §4.2 composition root).
 *
 * A run is one flow: the clock-rate check (silent), the calibration, then the audio self-test on the same route,
 * reusing the calibration's loopback and clock-rate result so nothing is played or measured twice.
 */
import type { AudioBackend, PlatformCapabilities } from '../../core/platform.ts';
import type { AppSettings, Calibration, Configs, Rng } from '../../core/types.ts';
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
import type { CalibrationServices, SelfTestItemId, SelfTestOutcome } from '../screens/calibration/services.ts';
import type { Readable } from '../screens/home/services.ts';

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
      const r = await route();
      const clock = await clockRate();
      const progress: CalibrationProgress = { onStage: o.onStage, onSound: o.onSound };
      const run = await runLoopbackCalibration(deps, { route: r, timbre: d.settings.get().practice.clickTimbre, clockRateError: clock?.error ?? null, onClick: o.onClick, progress });
      const lb = run.loopback;
      return {
        accepted: lb.accepted,
        failure: lb.failure,
        rtlMs: lb.rtlMs,
        madMs: lb.madMs,
        clicksFound: lb.clicksFound,
        clicksScheduled: lb.clicksScheduled,
        aecSuspected: run.aec.suspected,
        calibration: run.calibration,
        checks: await checks(r, clock, run, progress),
      };
    },
    async runPlayAlong(o) {
      const r = await route();
      const clock = await clockRate();
      const progress: CalibrationProgress = { onStage: o.onStage, onSound: o.onSound };
      const run = await runPlayAlongCalibration(deps, { route: r, timbre: d.settings.get().practice.clickTimbre, clockRateError: clock?.error ?? null, progress });
      run.playAlong.offsetsMs.forEach((ms, i) => o.onNote(i, ms));
      const pa = run.playAlong;
      return {
        accepted: pa.accepted,
        failure: pa.failure,
        rtlMs: pa.rtlMs,
        madMs: pa.madMs,
        notesFound: pa.notesFound,
        clicks: pa.clicks,
        offsetsMs: pa.offsetsMs,
        calibration: run.calibration,
        checks: await checks(r, clock, null, progress),
      };
    },
    save: (c) => d.saveCalibration(c),
    exportDiagnostics: (json) => d.download('sightread-diagnostics.json', json),
  };
}
