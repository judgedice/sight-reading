/**
 * What the calibration card needs from the rest of the app (01 section 4.2). `app` may not import `calibration`, so
 * the composition root adapts `runLoopbackCalibration`, `runPlayAlongCalibration`, `runSelfTest` and
 * `calibrationPlan` to these shapes: each is a structural subset of the matching type in `src/calibration`.
 *
 * One flow (owner feedback on a real Mac): a run is calibration and the audio check together, as named stages with
 * one result. The check reuses the run's own loopback, so the timing clicks play once.
 */
import { createContext, useContext } from 'react';
import type { PlatformCapabilities } from '../../../core/platform.ts';
import type { AudioRouteInfo, Calibration, ClickTimbre, OutputMode } from '../../../core/types.ts';

/** `CalibrationStageId`: the audible stages, in the order they can play. */
export type CalStageId = 'timing' | 'template' | 'pitch' | 'count-in' | 'play-along';

/** `CalibrationPlan`: what a run on an output will play, from config. */
export interface CalPlan {
  stages: { id: CalStageId; sounds: number; accented: number }[];
  skipped: CalStageId[];
  seconds: number;
}

/**
 * Live progress, timed from the audio clock: `onStage` before a stage's first sound, `onSound` when a sound is
 * audible (scheduled time plus output latency), `onClick` when a timing click's arrival window has been analysed.
 */
export interface CalProgress {
  onStage(stage: CalStageId): void;
  onSound(stage: CalStageId, index: number): void;
}

export interface LoopbackOutcome {
  accepted: boolean;
  /** `LoopbackFailure` or null. */
  failure: string | null;
  rtlMs: number | null;
  madMs: number | null;
  clicksFound: number;
  clicksScheduled: number;
  /** `LoopbackRun.aec.suspected`. */
  aecSuspected: boolean;
  /** The record to store, or null when loopback failed. */
  calibration: Calibration | null;
  /** The audio check run straight after, on the same loopback; null when it could not run. */
  checks: SelfTestOutcome | null;
}

export interface PlayAlongOutcome {
  accepted: boolean;
  failure: string | null;
  rtlMs: number | null;
  madMs: number | null;
  notesFound: number;
  clicks: number;
  /** Per click: onset minus click, ms; null when no note matched. */
  offsetsMs: (number | null)[];
  calibration: Calibration | null;
  /** The audio check run straight after (silent on headphones); null when it could not run. */
  checks: SelfTestOutcome | null;
}

export type SelfTestItemId = 'sanity-tone' | 'clicks' | 'recheck' | 'clock-rate' | 'processing' | 'frame-rate';

export interface SelfTestOutcome {
  passed: boolean;
  /** `reason`: why an item was skipped (`headphones`, `no-probe`), else null. */
  items: { id: SelfTestItemId; status: 'pass' | 'fail' | 'skipped'; reason: string | null }[];
  /** JSON text of the diagnostics export: numbers and flags only, no audio (01 section 7.9). */
  diagnosticsJson: string;
}

export interface AudioPrefs {
  outputMode: OutputMode;
  inputDeviceId: string | null;
}

export interface CalibrationServices {
  capabilities: PlatformCapabilities;
  /** Round-trip latency above which takes are unranked and the card shows the neutral delay warning (`grading.ranked.maxRtlMs`). Never read as Bluetooth. */
  maxRtlMs: number;
  /** The stages a run on this output plays, their counts (from `measurement-budget.json`) and about how long. */
  plan(outputMode: OutputMode): CalPlan;
  /** The selected metronome sound: the template and count-in clicks play in it (the timing clicks are always Tick). */
  clickSound(): ClickTimbre;
  prefs(): AudioPrefs;
  setPrefs(p: Partial<AudioPrefs>): Promise<void>;
  /** Input devices to list; may be empty before the microphone is allowed. */
  inputDevices(): Promise<{ id: string; label: string }[]>;
  /** Call synchronously from the Start click (01 section 7.1, 05 W1). Resolves with the route after the permission prompt. */
  unlock(): Promise<AudioRouteInfo>;
  /** Speakers: timing clicks, template clicks, tone, then the audio check's one-bar count-in. */
  runLoopback(o: CalProgress & { onClick(index: number, heard: boolean): void }): Promise<LoopbackOutcome>;
  /** Headphones (or after loopback failed): play-along clicks, then the audio check's silent items. */
  runPlayAlong(o: CalProgress & { onNote(index: number, offsetMs: number | null): void }): Promise<PlayAlongOutcome>;
  save(c: Calibration): Promise<void>;
  /** Offers the diagnostics text as a download. */
  exportDiagnostics(json: string): void;
  /**
   * "Hear the click" (05 §8.4, designer's note 12): one bar of the chosen metronome sound at ♩ = 90. Before Start and
   * on the result only, never while listening. Call from the click.
   */
  hearClick?(): Promise<void>;
  /** Stops the click preview at once (Start, leaving the screen). */
  stopSounds?(): void;
}

const Ctx = createContext<CalibrationServices | null>(null);
export const CalibrationServicesProvider = Ctx.Provider;

/** The services for the calibrate route; null until the composition root provides them. */
export function useCalibrationServices(): CalibrationServices | null {
  return useContext(Ctx);
}
