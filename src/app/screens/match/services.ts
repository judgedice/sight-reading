/**
 * What "Match a note" needs from the composition root (round 2, 01-ux §3): the engine, the instrument and configs the
 * model reads, and the microphone gate. The screen never drives audio itself.
 */
import type { Configs, Instrument, PitchSteadiness } from '../../../core/types.ts';
import type { MatchNoteService } from '../../../session/index.ts';
import type { MicOutcome } from '../onboarding/services.ts';

export interface MatchServices {
  service: MatchNoteService;
  /** The practice instrument now (read when the screen opens). */
  readonly instrument: Instrument;
  cfg: Configs;
  /** True when the microphone is already allowed. */
  micAllowed(): Promise<boolean>;
  /** Runs the permission request. Call synchronously from the click. */
  requestMic(): Promise<MicOutcome>;
  /**
   * The player's difficulty on the practice instrument: the in-tune band follows it on Practice › Match a note
   * (03-pitch-steadiness open question 3; onboarding keeps difficulty 1). Absent: difficulty 1.
   */
  level?(): number;
  /** Settings › Display as the meter reads it: the needle preset (absent: by family) and whether cents show. */
  display?(): { pitchSteadiness?: PitchSteadiness | undefined; showCents: boolean };
  /** Stores the needle preset, for "Make it steadier" under the meter. Absent: no link. */
  setPitchSteadiness?(v: PitchSteadiness): void;
}
