/**
 * What "Match a note" needs from the composition root (round 2, 01-ux §3): the engine, the instrument and configs the
 * model reads, and the microphone gate. The screen never drives audio itself.
 */
import type { Configs, Instrument } from '../../../core/types.ts';
import type { MatchNoteService } from '../../../session/match-note.ts';
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
}
