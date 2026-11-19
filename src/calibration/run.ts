/**
 * Calibration runs (01 §7.8): the backend only plays sounds and delivers blocks (05 Q5); everything else is the
 * pure analysis in this folder. The caller supplies the clock wait, so the same code runs on `WebAudioBackend`
 * (poll `now()` on a timer) and on `FakeAudioBackend` (advance its virtual clock).
 *
 * Neither run blocks a take (R16): a failed run returns `calibration: null` and the reasons, and the app carries
 * on unranked (`calibration-unmeasured`).
 */
import type { AudioBackend, ClockSeconds, WorkerMessage } from '../core/platform.ts';
import type { AudioRouteInfo, Calibration, ClickTimbre, Rng } from '../core/types.ts';
import { clickShape, hiBandCandidates, hiNoiseFloorDb, lowNoiseFloorDb } from './arrivals.ts';
import { analyzeLoopback, randomClickTimes, type CalibrationBudget, type LoopbackResult } from './loopback.ts';
import { analyzePlayAlong, playAlongClickTimes, PlayAlongDetector, type PlayAlongDetection, type PlayAlongResult } from './play-along.ts';
import { buildCalibration, NO_CLICK_DB } from './record.ts';
import { CaptureRecording } from './recording.ts';
import { aecSignature, analyzeSanityTone, lowLevelDb, SANITY_TONE_SEC, type AecVerdict, type OutputLevels, type SanityToneReading } from './tone.ts';

export interface CalibrationDeps {
  audio: AudioBackend;
  /** Resolves once `audio.now()` has reached `t` (clock seconds). */
  waitUntil(t: number): Promise<void>;
  rng: Rng;
  budget: CalibrationBudget;
  /** ISO 8601 UTC (PlatformServices.clockWall). */
  clockWall(): string;
}

/**
 * The named, audible stages of a calibration run, in the order they sound (presentation only: nothing here changes
 * what is played or measured). `timing`: the loopback Tick clicks; `template`: the selected sound's template clicks;
 * `pitch`: the sanity tone; `count-in`: the self-test's one-bar recheck; `play-along`: the play-along clicks.
 */
export type CalibrationStageId = 'timing' | 'template' | 'pitch' | 'count-in' | 'play-along';

/**
 * What the screen shows while a run plays. Every callback is timed from the audio clock: `onSound` fires when the
 * sound is audible (its scheduled clock time plus the output latency the backend reports, `now() - audibleNow()`),
 * so a mark lights as its click is heard, not when it was scheduled or analysed.
 */
export interface CalibrationProgress {
  /** A stage begins: called before its first sound (halfway through the gap after the previous stage's last sound). */
  onStage?(stage: CalibrationStageId): void;
  /** Sound `index` of `stage` is audible now. */
  onSound?(stage: CalibrationStageId, index: number): void;
}

/** Output latency to add to a scheduled clock time to get the moment it is heard, seconds (0 when not reported). */
export function outputLagSec(audio: Pick<AudioBackend, 'now' | 'audibleNow'>): number {
  const lag = (audio.now() as number) - (audio.audibleNow() as number);
  return Number.isFinite(lag) ? Math.min(0.5, Math.max(0, lag)) : 0;
}

/** One step of a run's visual timeline: wait until clock time `t`, then act. */
export interface TimelineStep {
  t: number;
  act(): void;
}

/** Runs the steps in time order (stable for equal times), waiting on the audio clock before each. */
export async function playTimeline(waitUntil: (t: number) => Promise<void>, steps: readonly TimelineStep[]): Promise<void> {
  const sorted = steps.map((s, i) => ({ s, i })).sort((a, b) => a.s.t - b.s.t || a.i - b.i);
  for (const { s } of sorted) {
    await waitUntil(s.t);
    s.act();
  }
}

/**
 * Visual steps for one stage of scheduled sounds: the stage line halfway between `after` (the previous stage's last
 * audible sound, or null for the first stage: at once) and this stage's first sound, then one `onSound` per sound
 * at its audible time.
 */
export function stageSteps(stage: CalibrationStageId, times: readonly number[], lag: number, after: number | null, p: CalibrationProgress | undefined): TimelineStep[] {
  if (!p || !times.length) return [];
  const first = (times[0] as number) + lag;
  const out: TimelineStep[] = [{ t: after === null ? -Infinity : (after + first) / 2, act: () => p.onStage?.(stage) }];
  times.forEach((t, i) => out.push({ t: t + lag, act: () => p.onSound?.(stage, i) }));
  return out;
}

/** Silence requested before the first loopback click, seconds (01 §7.5: 400 ms of floor). */
export const SILENCE_SEC = 0.4;
/** Gap between the last template click and the sanity tone, seconds. */
export const TONE_GAP_SEC = 0.6;
/** Lead before the first play-along click, so the player is ready, seconds. */
export const PLAY_ALONG_LEAD_SEC = 1.0;
/** Concert A4 for the sanity tone, Hz (01 §7.8: the check is of the sample rate, so it is not the A4 setting). */
export const SANITY_TONE_HZ = 440;

function captureInto(rec: CaptureRecording, also?: (m: WorkerMessage) => void): (m: WorkerMessage) => void {
  return (m) => {
    if (m.type === 'block') rec.push(m.block);
    also?.(m);
  };
}

const inputRateOf = (audio: AudioBackend, route: AudioRouteInfo): number => audio.audioInfo().contextSampleRate || route.sampleRate;

export interface LoopbackRunOptions {
  route: AudioRouteInfo;
  /** The selected metronome timbre: its template is built from extra clicks. */
  timbre: ClickTimbre;
  /** Clock-rate error to store with the calibration (from `runClockRateCheck`), or null. */
  clockRateError?: number | null;
  /** Output levels for the AEC prediction (tone.ts `DEFAULT_OUTPUT_LEVELS`). */
  levels?: OutputLevels;
  /** Live progress for the UI dots: click i of the Tick clicks heard or not (provisional; the final count is in the result). */
  onClick?(index: number, heard: boolean): void;
  /** Stage and per-sound timing for the screen (presentation only). */
  progress?: CalibrationProgress;
}

export interface LoopbackRun {
  loopback: LoopbackResult;
  tone: SanityToneReading;
  aec: AecVerdict;
  /** The record to store, or null when loopback failed. */
  calibration: Calibration | null;
  /** What was played, clock seconds (diagnostics). */
  schedule: { ticks: number[]; templateClicks: number[]; toneAt: number; silence: { t0: number; t1: number } };
}

/** Loopback (speakers): silence, 10 Tick clicks, the selected timbre's template clicks, then the sanity tone. */
export async function runLoopbackCalibration(deps: CalibrationDeps, o: LoopbackRunOptions): Promise<LoopbackRun> {
  const { audio, budget } = deps;
  const lb = budget.loopback;
  const minLag = lb.minRtlMs / 1000;
  const maxLag = lb.maxRtlMs / 1000;
  const rec = new CaptureRecording(inputRateOf(audio, o.route));
  await audio.startCapture(captureInto(rec));
  try {
    const now = audio.now() as number;
    const silence = { t0: now + 0.05, t1: now + 0.05 + SILENCE_SEC };
    const rnd = (): number => deps.rng.next();
    const all = randomClickTimes(silence.t1 + 0.05, lb.clicks + lb.templateClicks, rnd);
    const ticks = all.slice(0, lb.clicks);
    const templateClicks = all.slice(lb.clicks);
    const toneAt = (all[all.length - 1] as number) + TONE_GAP_SEC;
    const end = toneAt + SANITY_TONE_SEC + maxLag + 0.1;
    await audio.playCalibrationClicks(ticks as ClockSeconds[], 'tick');
    await audio.playCalibrationClicks(templateClicks as ClockSeconds[], o.timbre);
    await audio.playTone(SANITY_TONE_HZ, SANITY_TONE_SEC, toneAt as ClockSeconds);

    // The screen's timeline (04 §5.9 item 2): each mark lights when its click is audible (scheduled time plus the
    // output latency), and settles to heard or missed once its arrival window has been captured (provisional; the
    // final count is in the result). Stage lines come between stages, so no sound is unexplained.
    const lag = outputLagSec(audio);
    const floor = (): number => hiNoiseFloorDb(rec, silence);
    const p = o.progress;
    const lastOf = (xs: readonly number[]): number => (xs[xs.length - 1] as number) + lag;
    const steps: TimelineStep[] = [
      ...stageSteps('timing', ticks, lag, null, p),
      ...ticks.map((t, i) => ({
        t: Math.max(t + maxLag + 0.03, silence.t1),
        act: () => {
          const heard = hiBandCandidates(rec, floor(), clickShape('tick', true), { t0: t + minLag, t1: t + maxLag }).length > 0;
          o.onClick?.(i, heard);
        },
      })),
      ...stageSteps('template', templateClicks, lag, lastOf(ticks), p),
      ...stageSteps('pitch', [toneAt], lag, templateClicks.length ? lastOf(templateClicks) : lastOf(ticks), p),
    ];
    await playTimeline(deps.waitUntil, steps);
    await deps.waitUntil(end);
    audio.stopCapture();

    const loopback = analyzeLoopback(rec, { ticks, templateClicks, templateTimbre: o.timbre, silence }, budget);
    const lagSec = loopback.accepted ? (loopback.rtlMs as number) / 1000 : null;
    const tone = analyzeSanityTone(rec, { at: toneAt, durSec: SANITY_TONE_SEC, hz: SANITY_TONE_HZ, lagSec, maxLagSec: maxLag, limitCents: budget.sanityToneCents });
    const toneLevel = tone.levelDb ?? lowLevelDb(rec, toneAt + minLag, toneAt + SANITY_TONE_SEC + maxLag);
    const aec = aecSignature({
      loopbackAccepted: loopback.accepted,
      route: o.route,
      clickPeakDb: loopback.clickPeakDb,
      toneLevelDb: toneLevel,
      ...(o.levels ? { levels: o.levels } : {}),
    });
    const calibration = loopback.accepted
      ? buildCalibration(
          o.route,
          audio.capabilities.platform,
          {
            method: 'loopback',
            roundTripMs: loopback.rtlMs as number,
            spreadMs: loopback.madMs as number,
            clicksDetected: loopback.clicksFound,
            clickLeakDb: loopback.clickLeakDb ?? NO_CLICK_DB,
            noiseFloorDb: loopback.noiseFloorDb,
            templates: loopback.templates,
            sanityToneCents: tone.cents,
            aecSuspected: aec.suspected,
            clockRateError: o.clockRateError ?? null,
            ...(o.route.reportedLatencySec !== undefined ? { outputLatencyMs: o.route.reportedLatencySec * 1000 } : {}),
          },
          deps.clockWall(),
        )
      : null;
    return { loopback, tone, aec, calibration, schedule: { ticks, templateClicks, toneAt, silence } };
  } finally {
    audio.stopCapture();
  }
}

export interface PlayAlongRunOptions {
  route: AudioRouteInfo;
  /** Click sound the player hears. */
  timbre: ClickTimbre;
  /** The player's instrument detection parameters; GENERIC_DETECTION when omitted. */
  detection?: PlayAlongDetection;
  clockRateError?: number | null;
  /** Stage and per-click timing for the screen (presentation only). */
  progress?: CalibrationProgress;
}

export interface PlayAlongRun {
  playAlong: PlayAlongResult;
  calibration: Calibration | null;
  clicks: number[];
}

/** Play-along (headphones, or after loopback failed): 8 clicks at 80 bpm, one short note on each. */
export async function runPlayAlongCalibration(deps: CalibrationDeps, o: PlayAlongRunOptions): Promise<PlayAlongRun> {
  const { audio, budget } = deps;
  const rec = new CaptureRecording(inputRateOf(audio, o.route));
  const det = new PlayAlongDetector(o.detection);
  await audio.startCapture(captureInto(rec, (m) => m.type === 'block' && det.push(m.block)));
  try {
    const start = audio.now() as number;
    const clicks = playAlongClickTimes(start + PLAY_ALONG_LEAD_SEC, budget);
    await audio.playCalibrationClicks(clicks as ClockSeconds[], o.timbre);
    const end = (clicks[clicks.length - 1] as number) + budget.playAlong.maxRtlMs / 1000 + 0.4;
    await playTimeline(deps.waitUntil, stageSteps('play-along', clicks, outputLagSec(audio), null, o.progress));
    await deps.waitUntil(end);
    audio.stopCapture();
    const onsets = det.flush(rec.endT);
    const playAlong = analyzePlayAlong(onsets, clicks, budget);
    const calibration = playAlong.accepted
      ? buildCalibration(
          o.route,
          audio.capabilities.platform,
          {
            method: 'play-along',
            roundTripMs: playAlong.rtlMs as number,
            spreadMs: playAlong.madMs as number,
            clicksDetected: playAlong.notesFound,
            clickLeakDb: NO_CLICK_DB,
            noiseFloorDb: lowNoiseFloorDb(rec, { t0: start, t1: start + PLAY_ALONG_LEAD_SEC }),
            templates: {},
            sanityToneCents: null,
            aecSuspected: false,
            clockRateError: o.clockRateError ?? null,
          },
          deps.clockWall(),
        )
      : null;
    return { playAlong, calibration, clicks };
  } finally {
    audio.stopCapture();
  }
}
