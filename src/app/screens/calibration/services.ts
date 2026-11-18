/**
 * What the calibration card needs from the rest of the app (01 section 4.2). `app` may not import `calibration`, so
 * the composition root adapts `runLoopbackCalibration`, `runPlayAlongCalibration` and `runSelfTest` to these shapes:
 * each outcome is a structural subset of the matching result in `src/calibration`.
 */
import { createContext, useContext } from 'react';
import type { PlatformCapabilities } from '../../../core/platform.ts';
import type { AudioRouteInfo, Calibration, OutputMode } from '../../../core/types.ts';

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
}

export type SelfTestItemId = 'sanity-tone' | 'clicks' | 'recheck' | 'clock-rate' | 'processing' | 'frame-rate';

export interface SelfTestOutcome {
  passed: boolean;
  items: { id: SelfTestItemId; status: 'pass' | 'fail' | 'skipped' }[];
  /** A calibration measured by the self-test loopback, if any. */
  calibration: Calibration | null;
  /** JSON text of the diagnostics export: numbers and flags only, no audio (01 section 7.9). */
  diagnosticsJson: string;
}

export interface AudioPrefs {
  outputMode: OutputMode;
  inputDeviceId: string | null;
}

export interface CalibrationServices {
  capabilities: PlatformCapabilities;
  /** Round-trip latency above which the setup reads as Bluetooth and is unranked (`grading.ranked.maxRtlMs`). */
  maxRtlMs: number;
  /** Seconds the loopback run takes, for the intro line (04 section 5.9: about 8). */
  loopbackSeconds: number;
  /** Click count of each run (`measurement-budget.json` `calibration.loopback.clicks`, `playAlong.clicks`). */
  loopbackClicks: number;
  playAlongClicks: number;
  prefs(): AudioPrefs;
  setPrefs(p: Partial<AudioPrefs>): Promise<void>;
  /** Input devices to list; may be empty before the microphone is allowed. */
  inputDevices(): Promise<{ id: string; label: string }[]>;
  /** Call synchronously from the Start click (01 section 7.1, 05 W1). Resolves with the route after the permission prompt. */
  unlock(): Promise<AudioRouteInfo>;
  runLoopback(o: { onClick(index: number, heard: boolean): void }): Promise<LoopbackOutcome>;
  runPlayAlong(o: { onNote(index: number, offsetMs: number | null): void }): Promise<PlayAlongOutcome>;
  runSelfTest(): Promise<SelfTestOutcome>;
  save(c: Calibration): Promise<void>;
  /** Offers the diagnostics text as a download. */
  exportDiagnostics(json: string): void;
}

const Ctx = createContext<CalibrationServices | null>(null);
export const CalibrationServicesProvider = Ctx.Provider;

/** The services for the calibrate route; null until the composition root provides them. */
export function useCalibrationServices(): CalibrationServices | null {
  return useContext(Ctx);
}
