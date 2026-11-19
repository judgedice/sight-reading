/**
 * `resolveOneNote` (round 2 detection, docs/redesign/round2/03-detection.md): the `grading.detection.oneNote` row for
 * an instrument's onset profile and the take's difficulty, or null when the profile has none (the 01 §7.5 segmenter
 * and the 02 §4.1 extras rule apply unchanged). The session and the gate runner put the result on both `DspConfig`
 * and `FollowConfig`.
 */
import type { Configs, Instrument, OneNoteTolerance } from '../core/types.ts';

export function resolveOneNote(cfg: Configs, inst: Instrument, level: number): OneNoteTolerance | null {
  const row = cfg.grading.detection.oneNote.find((b) => b.profile === inst.detection.onsetProfile && level >= b.levels[0] && level <= b.levels[1]);
  if (!row) return null;
  const { profile: _p, levels: _l, ...tol } = row;
  return tol;
}
