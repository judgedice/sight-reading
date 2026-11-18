/**
 * `rules/` public surface (01 §5.4). The five `RulesApi` members, plus the shared verdict helpers that follow/,
 * grade/ and the overlay use so that no tolerance arithmetic is duplicated outside this module.
 */
import type { RulesApi } from '../core/api.ts';
import { checkFloors } from './floor-check.ts';
import { loadConfigs } from './load-configs.ts';
import { pitchCreditPolicy } from './pitch-policy.ts';
import { resolveTolerances } from './resolve-tolerances.ts';
import { VoiceDriftReference } from './voice-drift.ts';

export { checkFloors } from './floor-check.ts';
export { ConfigError, loadConfigs } from './load-configs.ts';
export { classifyPitch, pitchCreditPolicy, type PitchClass, type PitchClassification } from './pitch-policy.ts';
export {
  expectedSteadyMs,
  intonationBandFor,
  intonationGroup,
  isIntonationGraded,
  minIoiMs,
  resolveTolerances,
  timingBandFor,
  tuningOffsetCents,
} from './resolve-tolerances.ts';
export { VoiceDriftReference } from './voice-drift.ts';
export {
  intonationCredit,
  intonationVerdict,
  liveIntonationAsVerdict,
  liveIntonationEligible,
  liveIntonationStep,
  noteVerdict,
  onsetCredit,
  timingMarginal,
  timingVerdict,
  wrongPitchAtConfirm,
  type IntonationVerdict,
  type LiveIntonation,
  type LiveNoteState,
  type MatchedFacts,
  type NoteVerdict,
} from './live-verdict.ts';

/** Compile-time conformance with the frozen `RulesApi`. */
export const rulesApi: RulesApi = { loadConfigs, resolveTolerances, VoiceDriftReference, pitchCreditPolicy, checkFloors };
