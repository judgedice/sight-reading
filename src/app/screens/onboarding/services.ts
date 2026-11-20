/**
 * What onboarding needs from the app. The composition root builds this from the store, the platform and the
 * calibration package (`app` may not import `calibration` or `platform/web`).
 */
import { createContext, useContext } from 'react';
import type { PlatformCapabilities } from '../../../core/platform.ts';
import type { Configs, Instrument } from '../../../core/types.ts';
import type { CalibrationServices } from '../calibration/services.ts';
import type { MicBrowser, MicProblem } from '../states/mic.ts';
import type { CalibrationResult } from '../calibration/CalibrationCard.tsx';
import type { MatchNoteService } from '../../../session/index.ts';

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
  /** Eligible excerpts at a level (corpus `countEligible`, as Home): the difficulty step marks empty and thin levels. */
  countEligible?(instrumentId: string, level: number, meter: string | null): number;
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
  /**
   * The engine for the step "Sing one note" or "Play one note" (01-ux §3.2). It runs on the instrument chosen in
   * onboarding, so the stored instrument is not part of it. Omitted: the step is left out.
   */
  match?: {
    service: MatchNoteService;
    cfg: Configs;
    /** True when the microphone is already allowed. */
    micAllowed(): Promise<boolean>;
    /** Runs the permission request. Call synchronously from the click. */
    requestMic(): Promise<MicOutcome>;
  };
  /** Opens "Match a note" inside onboarding. Omitted: the row is not shown. */
  openMatch?(): void;
  /** Stops any sound at once (leaving the step). */
  stopSounds?(): void;
}

const Ctx = createContext<OnboardingServices | null>(null);
export const OnboardingServicesProvider = Ctx.Provider;

export function useOnboardingServices(): OnboardingServices | null {
  return useContext(Ctx);
}
