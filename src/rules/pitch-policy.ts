/**
 * Octave policy and pitch classification (02 §4.2, §4.3, §4.5; R7, R20; 01 §5.4).
 *
 * - Voice is octave-equivalent: target ± 12 (after the reference offset) earns pitch credit and is recorded as
 *   `octaveDisplaced`, never as an error.
 * - Every other family: an octave error is a wrong pitch with no credit (R20), judged after 01's score-informed
 *   octave correction (which happens in dsp/, not here).
 * - |dev| above `intonation.wrongPitchAboveCents` from the target means a different semitone: a wrong pitch,
 *   not an intonation error.
 */
import type { RulesApi } from '../core/api.ts';
import type { Configs, Instrument } from '../core/types.ts';

const CENTS_PER_SEMITONE = 100;
const SEMITONES_PER_OCTAVE = 12;

export const pitchCreditPolicy: RulesApi['pitchCreditPolicy'] = (inst: Instrument) => ({
  octave: inst.relativePitch ? 'equivalent' : 'wrong',
});

/**
 * - `correct`: the nearest semitone is the target (or, for voice, the target in another octave).
 * - `octave`: non-voice octave error (R20): p = 0, pitch verdict `octave`.
 * - `wrong`: any other semitone.
 */
export type PitchClass = 'correct' | 'octave' | 'wrong';

export interface PitchClassification {
  kind: PitchClass;
  /** Pitch credit p_i (02 §4.3). */
  p: 0 | 1;
  /** Voice octave displacement: credited, neutral (R7). */
  octaveDisplaced: boolean;
  /**
   * Deviation from the judged target after the tuning or reference offset, cents (+ = sharp). For a correct note
   * (including a voice octave displacement) this is the intonation deviation; otherwise it is the distance from
   * the written target (voice: from the nearest-octave target), which can exceed an octave.
   */
  devCents: number;
  /** `devCents` before the offset was removed; what `VoiceDriftReference.observe` takes. */
  rawDevCents: number;
  /** Octaves between the played note and the target (0 unless an octave displacement or octave error). */
  octaves: number;
}

/**
 * Classify a played pitch against a target, both concert MIDI. `playedMidi` is fractional (01's steady median);
 * `offsetCents` is the tuning-note offset (winds, brass, strings) or the voice reference offset.
 */
export function classifyPitch(targetConcertMidi: number, playedMidi: number, offsetCents: number, inst: Instrument, cfg: Configs): PitchClassification {
  const wrongAbove = cfg.grading.intonation.wrongPitchAboveCents;
  const rawFromTarget = (playedMidi - targetConcertMidi) * CENTS_PER_SEMITONE;
  const fromTarget = rawFromTarget - offsetCents;
  if (Math.abs(fromTarget) <= wrongAbove) {
    return { kind: 'correct', p: 1, octaveDisplaced: false, devCents: fromTarget, rawDevCents: rawFromTarget, octaves: 0 };
  }
  const octaveCents = SEMITONES_PER_OCTAVE * CENTS_PER_SEMITONE;
  const octaves = Math.round(fromTarget / octaveCents);
  const folded = fromTarget - octaves * octaveCents;
  const isOctave = octaves !== 0 && Math.abs(folded) <= wrongAbove;
  if (isOctave && pitchCreditPolicy(inst).octave === 'equivalent') {
    return { kind: 'correct', p: 1, octaveDisplaced: true, devCents: folded, rawDevCents: folded + offsetCents, octaves };
  }
  if (isOctave) {
    return { kind: 'octave', p: 0, octaveDisplaced: false, devCents: fromTarget, rawDevCents: rawFromTarget, octaves };
  }
  // Voice: report the distance from the nearest-octave target, since voice is judged octave-equivalent.
  if (pitchCreditPolicy(inst).octave === 'equivalent') {
    return { kind: 'wrong', p: 0, octaveDisplaced: false, devCents: folded, rawDevCents: folded + offsetCents, octaves: 0 };
  }
  return { kind: 'wrong', p: 0, octaveDisplaced: false, devCents: fromTarget, rawDevCents: rawFromTarget, octaves: 0 };
}
