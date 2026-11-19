/**
 * Audio self-test (01 §7.9, 04 §5.9 item 7): the automated substitute for a device checklist. Runs the sanity tone,
 * loopback, a count-in recheck on a 1-bar test, the clock-rate check, the applied-constraints readback and the
 * frame rate during a 2 s overlay stress, and returns a pass/fail list plus a diagnostics export. The export holds
 * numbers, flags and labels only: never audio, templates or device labels (R9, 05 §5.2).
 */
import type { PlatformCapabilities, WorkerMessage } from '../core/platform.ts';
import type { AudioRouteInfo, Calibration, ClickTimbre, JsonValue } from '../core/types.ts';
import { runClockRateCheck, type ClockRateResult } from './clock-rate.ts';
import { CountInRecheck, type RecheckDetail } from './recheck.ts';
import { outputLagSec, playTimeline, runLoopbackCalibration, stageSteps, type CalibrationDeps, type CalibrationProgress, type LoopbackRun } from './run.ts';

export type SelfTestItemId = 'sanity-tone' | 'clicks' | 'recheck' | 'clock-rate' | 'processing' | 'frame-rate';
export type SelfTestStatus = 'pass' | 'fail' | 'skipped';

export interface SelfTestItem {
  id: SelfTestItemId;
  status: SelfTestStatus;
  /** Numbers, flags and short labels only (JSON). */
  detail: Record<string, number | string | boolean | null>;
}

/** Frame-rate probe: the app renders an overlay stress for `durSec` and reports requestAnimationFrame timing. */
export type FrameRateProbe = (durSec: number) => Promise<{ fps: number; p95FrameMs: number }>;

/** Overlay stress length, seconds (01 §7.9). */
export const FRAME_STRESS_SEC = 2;
/**
 * Frame-rate pass mark: p95 frame interval at most two 60 Hz frames. 01 names the check without a threshold; this
 * is P14's reading (one dropped frame in a row is tolerated, a stalling overlay is not).
 */
export const FRAME_P95_MAX_MS = 2 * (1000 / 60) + 0.5;
/** Tempo of the 1-bar recheck test, bpm. */
export const RECHECK_BPM = 100;
/** The 1-bar recheck: one bar of 4/4 count-in, accented first beat (as a take's count-in), after this lead. */
export const RECHECK_BEATS = 4;
export const RECHECK_LEAD_SEC = 0.5;

export interface SelfTestOptions {
  route: AudioRouteInfo;
  capabilities: PlatformCapabilities;
  timbre: ClickTimbre;
  /** The route's stored calibration, compared with the 1-bar recheck when the self-test loopback fails. */
  stored?: Calibration | null;
  /** Context recreate for the clock-rate check (05 W3). */
  recreate?: () => Promise<void>;
  frameProbe?: FrameRateProbe;
  /** Recheck agreement, ms (`grading.ranked.recheckAgreeMs`); default the budget's stale threshold. */
  recheckAgreeMs?: number;
  /** For the export header. */
  appBuild?: string;
  /**
   * The loopback run calibration has just made on this route: reused instead of playing the timing clicks, the
   * template clicks and the tone a second time (one flow, 04 §5.9). Omitted: the self-test runs its own.
   */
  loopback?: LoopbackRun;
  /** A clock-rate result measured moments ago on this context: reused instead of measuring again. */
  clock?: ClockRateResult;
  /** Stage and per-sound timing for the screen (presentation only). */
  progress?: CalibrationProgress;
}

export interface SelfTestResult {
  passed: boolean;
  items: SelfTestItem[];
  /** The loopback calibration measured by the self-test, if accepted (the caller may store it). */
  calibration: Calibration | null;
  /** JSON-safe diagnostics (`exportDiagnostics` serialises it). */
  diagnostics: SelfTestDiagnostics;
}

export interface SelfTestDiagnostics {
  kind: 'audio-self-test';
  version: 1;
  at: string;
  appBuild: string | null;
  platform: PlatformCapabilities['platform'];
  osFamily: PlatformCapabilities['osFamily'];
  displayMode: PlatformCapabilities['displayMode'];
  outputLatencyReported: boolean;
  route: Pick<AudioRouteInfo, 'inputKind' | 'outputMode' | 'sampleRate' | 'appliedProcessing'> & { reportedLatencyMs: number | null };
  audio: { contextSampleRate: number; contextRecreated: boolean; audioSessionType: string | null; clockRateError: number | null; captureRelay: boolean };
  items: SelfTestItem[];
}

const round = (x: number | null | undefined, dp = 2): number | null => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10 ** dp) / 10 ** dp);

export async function runSelfTest(deps: CalibrationDeps, o: SelfTestOptions): Promise<SelfTestResult> {
  const { audio, budget } = deps;
  const items: SelfTestItem[] = [];
  const speakers = o.route.outputMode === 'speakers';

  // Clock rate (any output mode).
  const clock: ClockRateResult = o.clock ?? (await runClockRateCheck(audio, budget, o.recreate ? { recreate: o.recreate } : {}));
  items.push({
    id: 'clock-rate',
    // A clock that could not be measured fails nothing (clock-rate.ts), so it reads as not run, with its reason.
    status: clock.state === 'unmeasured' ? 'skipped' : clock.ok ? 'pass' : 'fail',
    detail: {
      errorPct: clock.error === null ? null : round(clock.error * 100, 3),
      recreated: clock.recreated,
      state: clock.state,
      ...(clock.state === 'unmeasured' ? { reason: 'unmeasured' } : {}),
    },
  });

  // Loopback and sanity tone (speakers).
  let run: LoopbackRun | null = null;
  if (speakers) {
    run = o.loopback ?? (await runLoopbackCalibration(deps, { route: o.route, timbre: o.timbre, clockRateError: clock.error, ...(o.progress ? { progress: o.progress } : {}) }));
    const lb = run.loopback;
    items.push({
      id: 'sanity-tone',
      status: run.tone.withinLimit ? 'pass' : 'fail',
      detail: { cents: round(run.tone.cents), limitCents: budget.sanityToneCents, levelDb: round(run.tone.levelDb, 1), aecSuspected: run.aec.suspected },
    });
    items.push({
      id: 'clicks',
      status: lb.accepted ? 'pass' : 'fail',
      detail: {
        found: lb.clicksFound,
        of: lb.clicksScheduled,
        rtlMs: round(lb.rtlMs),
        madMs: round(lb.madMs),
        failure: lb.failure,
        noiseFloorDb: round(lb.noiseFloorDb, 1),
      },
    });
  } else {
    items.push({ id: 'sanity-tone', status: 'skipped', detail: { reason: 'headphones' } });
    items.push({ id: 'clicks', status: 'skipped', detail: { reason: 'headphones' } });
  }

  // Count-in recheck on a 1-bar test (speakers): compared with this run's loopback, else the stored calibration.
  if (speakers) {
    const refMs = run?.calibration?.roundTripMs ?? (o.stored && o.stored.routeKey === o.route.routeKey ? o.stored.roundTripMs : null);
    const template = run?.calibration?.templates[o.timbre]?.samples ?? o.stored?.templates[o.timbre]?.samples ?? null;
    const r = await oneBarRecheck(deps, o.route, o.timbre, template, o.progress);
    const agree = o.recheckAgreeMs ?? budget.recheck.staleAboveMs;
    const diff = r.rtlMs !== null && refMs !== null ? r.rtlMs - refMs : null;
    const pass = r.accepted && (diff === null ? refMs === null : Math.abs(diff) <= agree);
    items.push({
      id: 'recheck',
      status: pass ? 'pass' : 'fail',
      detail: { found: r.clicksFound, rtlMs: round(r.rtlMs), madMs: round(r.madMs), referenceMs: round(refMs), diffMs: round(diff), agreeMs: agree },
    });
  } else {
    items.push({ id: 'recheck', status: 'skipped', detail: { reason: 'headphones' } });
  }

  // Applied constraints readback (05 W5, gate (d)): none of the three may read true.
  const ap = o.route.appliedProcessing;
  const on = [ap.echoCancellation, ap.noiseSuppression, ap.autoGainControl].some((v) => v === true);
  items.push({
    id: 'processing',
    status: on ? 'fail' : 'pass',
    detail: { echoCancellation: ap.echoCancellation, noiseSuppression: ap.noiseSuppression, autoGainControl: ap.autoGainControl },
  });

  // Frame rate during the overlay stress.
  if (o.frameProbe) {
    const f = await o.frameProbe(FRAME_STRESS_SEC);
    items.push({
      id: 'frame-rate',
      status: f.p95FrameMs <= FRAME_P95_MAX_MS ? 'pass' : 'fail',
      detail: { fps: round(f.fps, 1), p95FrameMs: round(f.p95FrameMs, 1), maxP95Ms: round(FRAME_P95_MAX_MS, 1) },
    });
  } else {
    items.push({ id: 'frame-rate', status: 'skipped', detail: { reason: 'no-probe' } });
  }

  const order: SelfTestItemId[] = ['sanity-tone', 'clicks', 'recheck', 'clock-rate', 'processing', 'frame-rate'];
  items.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const info = audio.audioInfo();
  const diagnostics: SelfTestDiagnostics = {
    kind: 'audio-self-test',
    version: 1,
    at: deps.clockWall(),
    appBuild: o.appBuild ?? null,
    platform: o.capabilities.platform,
    osFamily: o.capabilities.osFamily,
    displayMode: o.capabilities.displayMode,
    outputLatencyReported: o.capabilities.outputLatencyReported,
    route: {
      inputKind: o.route.inputKind,
      outputMode: o.route.outputMode,
      sampleRate: o.route.sampleRate,
      appliedProcessing: { ...o.route.appliedProcessing },
      reportedLatencyMs: o.route.reportedLatencySec === undefined ? null : round(o.route.reportedLatencySec * 1000),
    },
    audio: {
      contextSampleRate: info.contextSampleRate,
      contextRecreated: info.contextRecreated,
      audioSessionType: info.audioSessionType,
      clockRateError: round(info.clockRateError ?? clock.error, 5),
      captureRelay: audio.captureRelay,
    },
    items: items.map((i) => ({ ...i, detail: { ...i.detail } })),
  };
  return { passed: items.every((i) => i.status !== 'fail'), items, calibration: run?.calibration ?? null, diagnostics };
}

/** A 1-bar count-in on the take path (`scheduleTake`, count-in only), analysed by the per-take recheck. */
async function oneBarRecheck(deps: CalibrationDeps, route: AudioRouteInfo, timbre: ClickTimbre, template: ArrayLike<number> | null, progress?: CalibrationProgress): Promise<RecheckDetail> {
  const { audio, budget } = deps;
  const rate = audio.audioInfo().contextSampleRate || route.sampleRate;
  let recheck: CountInRecheck | null = null;
  const pending: WorkerMessage[] = [];
  await audio.startCapture((m: WorkerMessage) => {
    if (m.type !== 'block') return;
    if (recheck) recheck.push(m.block);
    else pending.push(m);
  });
  try {
    const silenceStart = audio.now() as number;
    const { clicks } = await audio.scheduleTake({
      leadSec: RECHECK_LEAD_SEC,
      bpm: RECHECK_BPM,
      beatsPerBar: RECHECK_BEATS,
      countInBeats: RECHECK_BEATS,
      totalBeats: 0,
      mode: 'countInOnly',
      timbre,
      accentDb: 5,
    });
    const countIn = clicks.filter((c) => c.countIn).map((c) => ({ t: c.t as number, accent: c.accent }));
    const first = Math.min(...countIn.map((c) => c.t));
    recheck = new CountInRecheck(rate, countIn, { timbre, template, budget, silence: { t0: silenceStart, t1: first } });
    for (const m of pending) if (m.type === 'block') recheck.push(m.block);
    const last = Math.max(...countIn.map((c) => c.t));
    await playTimeline(deps.waitUntil, stageSteps('count-in', countIn.map((c) => c.t), outputLagSec(audio), null, progress));
    await deps.waitUntil(last + budget.loopback.maxRtlMs / 1000 + 0.1);
    return recheck.finish();
  } finally {
    audio.cancelTake();
    audio.stopCapture();
  }
}

/** Serialises the diagnostics export (Settings > Audio > [Export diagnostics]). */
export function exportDiagnostics(d: SelfTestDiagnostics): string {
  return JSON.stringify(d as unknown as JsonValue, null, 2);
}
