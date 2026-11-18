/**
 * Segmenter parameters (01 section 7.5). Every time constant is in seconds and converted to frames with the
 * pitch hop (`segmenterOptions(hopSec, ...)`), so 16 kHz (8 ms hop) and 14.7 kHz (8.7 ms hop) behave alike.
 *
 * Profile parameters (7.5): `voice` and `bowed` raise the pitch-change confirmation to 4 frames and lower flux
 * sensitivity; `struck` and `plucked` rely on flux and envelope (a dip that reaches the floor is evaluated as an
 * attack from silence); `tongued-wind` and `brass` use all cues.
 */
import type { OnsetProfile } from '../core/types.ts';

/** Default hop of the 01 section 7.3 pitch frames at 16 kHz, seconds. */
export const DEFAULT_HOP_SEC = 128 / 16000;
/** 7.5 defaults at the 8 ms hop: onset after 3 stable frames, offset after 8 silent frames. */
export const ONSET_CONFIRM_SEC = 3 * DEFAULT_HOP_SEC;
export const OFFSET_SEC = 8 * DEFAULT_HOP_SEC;
export const MIN_NOTE_SEC = 0.06;
/** Adaptive noise gate (7.5): floor + 12 dB, never below -70 dBFS. */
export const GATE_ABOVE_FLOOR_DB = 12;
export const GATE_MIN_DBFS = -70;
/** Floor-measurement window (7.5: the 400 ms before the count-in and between clicks). */
export const NOISE_WINDOW_SEC = 0.4;
/** Click window for time gating and flux exclusion (01 section 7.6 items 3 and 4). */
export const CLICK_WINDOW_BEFORE_SEC = 0.005;
export const CLICK_WINDOW_AFTER_SEC = 0.035;
/** Score-informed hint threshold (7.5): inside a hint window the dip threshold is max(2 dB, 1.0 x AM depth). */
export const HINT_MIN_DIP_DB = 2;
export const HINT_AM_FACTOR = 1;

/**
 * Attack excluded from the steady statistics, ms, per onset profile. These mirror
 * `grading.intonation.attackExcludeMsByFamily` in config/grading-config.json (dsp may import only core, and
 * DspConfig carries the profile, not the family): voice 80, brass and strings 60, winds and keyboard 50.
 */
export const ATTACK_EXCLUDE_MS: Readonly<Record<OnsetProfile, number>> = {
  'tongued-wind': 50,
  brass: 60,
  bowed: 60,
  voice: 80,
  struck: 50,
  plucked: 50,
};

export interface SegmenterOptions {
  hopSec: number;
  /** Pitch window length, seconds (W / analysisRate). */
  windowSec: number;
  clarityThreshold: number;
  changeCents: number;
  onsetProfile: OnsetProfile;
  onsetConfirmFrames: number;
  changeConfirmFrames: number;
  offsetFrames: number;
  minNoteSec: number;
  attackExcludeSec: number;
  /** k in the flux threshold median + k x MAD. */
  fluxMadK: number;
  /** Struck and plucked profiles evaluate every split as an attack. */
  struck: boolean;
  /**
   * A dip at a pitch change makes the change a re-articulation (onset at the half-rise, not the pitch crossing)
   * when at least this deep, dB. Voice and bowed slurs dip the envelope by a few dB through formants and body
   * resonances, so their minimum is higher; their real re-articulations (bow change, glottal re-onset) dip 8 dB or more.
   */
  pitchChangeDipDb: number;
  /**
   * Multiplier on the adaptive flux threshold for the flux route of 7.4 item 4 (a shallow dip is a
   * re-articulation when a flux peak passes the threshold). Infinity disables the route.
   */
  fluxRouteFactor: number;
  /**
   * Use flux peaks to refine onset times (7.4 items 2 and 3). Off by default: the synth truth is computed without
   * flux, and flux refinement raised the onset e90 against it on clean scenarios (segmenter.ts header).
   */
  fluxTiming: boolean;
}

export function segmenterOptions(
  hopSec: number,
  p: { windowSec: number; clarityThreshold: number; changeCents: number; onsetProfile: OnsetProfile },
): SegmenterOptions {
  const frames = (sec: number): number => Math.max(1, Math.round(sec / hopSec));
  const soft = p.onsetProfile === 'voice' || p.onsetProfile === 'bowed';
  return {
    hopSec,
    windowSec: p.windowSec,
    clarityThreshold: p.clarityThreshold,
    changeCents: p.changeCents,
    onsetProfile: p.onsetProfile,
    onsetConfirmFrames: frames(ONSET_CONFIRM_SEC),
    changeConfirmFrames: frames(soft ? 4 * DEFAULT_HOP_SEC : 3 * DEFAULT_HOP_SEC),
    offsetFrames: frames(OFFSET_SEC),
    minNoteSec: MIN_NOTE_SEC,
    attackExcludeSec: ATTACK_EXCLUDE_MS[p.onsetProfile] / 1000,
    fluxMadK: 3,
    pitchChangeDipDb: soft ? 5 : 3,
    struck: p.onsetProfile === 'struck' || p.onsetProfile === 'plucked',
    // Flux-only re-articulations: struck and plucked rely on flux; winds and brass need a clear flux peak; voice
    // and bowed tones (vibrato, bow noise) get the lowest flux sensitivity.
    fluxRouteFactor: p.onsetProfile === 'struck' || p.onsetProfile === 'plucked' ? 2 : soft ? 6 : 3,
    fluxTiming: false,
  };
}
