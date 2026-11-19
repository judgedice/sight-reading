/**
 * What onboarding needs from the app. The composition root builds this from the store, the platform and the
 * calibration package (`app` may not import `calibration` or `platform/web`).
 */
import { createContext, useContext } from 'react';
import type { PlatformCapabilities } from '../../../core/platform.ts';
import type { Instrument } from '../../../core/types.ts';
import type { CalibrationServices } from '../calibration/services.ts';
import type { MicBrowser, MicProblem } from '../states/mic.ts';
import type { CalibrationResult } from '../calibration/CalibrationCard.tsx';

export type MicOutcome = { ok: true } | { ok: false; problem: MicProblem };

export type LevelChoice = { kind: 'placement' } | { kind: 'level'; level: number };

export interface OnboardingResult {
  displayName: string;
  instrumentId: string;
  showBeta: boolean;
  /** true when the microphone was allowed; false shows the "Microphone off" banner on Home. */
  micAllowed: boolean;
  /** null when the step was never reached (microphone declined). */
  calibration: CalibrationResult | null;
  level: LevelChoice;
}

export interface OnboardingServices {
  capabilities: PlatformCapabilities;
  /** `configs.instruments.instruments`. */
  instruments: readonly Instrument[];
  initial: { instrumentId: string; showBeta: boolean };
  /** Placement length (`progression.placement.excerpts`) and the minutes copy says it takes. */
  placement: { excerpts: number; minutes: number };
  levelCount: number;
  /** The `levels.json` description of a level. */
  levelDescription(level: number): string;
  /** Which unblock steps the denied card shows. */
  micBrowser: MicBrowser;
  /** Runs unlock and `getUserMedia`. Call synchronously from the click (01 section 7.1). */
  requestMic(): Promise<MicOutcome>;
  calibration: CalibrationServices;
  /** Saves profile and settings (onboardingDone) and returns where to go: Scan with the placement chip, or Home. */
  finish(r: OnboardingResult): Promise<string>;
  /** A range-picture note button in the picker: that sounding MIDI note for 1 s. Call from the click. */
  playNote?(concertMidi: number): Promise<void>;
  /** Stops any sound at once (leaving the step). */
  stopSounds?(): void;
}

const Ctx = createContext<OnboardingServices | null>(null);
export const OnboardingServicesProvider = Ctx.Provider;

export function useOnboardingServices(): OnboardingServices | null {
  return useContext(Ctx);
}
