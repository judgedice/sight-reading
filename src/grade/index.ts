/**
 * `grade/` public surface (01 §5.9, 02 §4 to §6). Assembled by the wave 2 reviewer from P12 (grade), P12b
 * (detectPatterns) and G6/G7 (progression and ranked eligibility).
 *
 * `grade()` returns `patterns: []` and `tipsShown: []`. The session fills `patterns` from `detectPatterns(input)`
 * (or calls `gradeWithPatterns`) and `tipsShown` from `selectTips`.
 */
import type { GradeApi } from '../core/api.ts';
import type { AttemptScore, GradeInput } from '../core/types.ts';
import { grade } from './grade.ts';
import { detectPatterns } from './patterns/index.ts';
import { applyAttempt, createProfile, rankFor, respondToLevelOffer, setInstrumentLevel } from './progression/index.ts';

export { grade } from './grade.ts';
export { detectPatterns, DETECTORS, TIMING_PATTERNS } from './patterns/index.ts';
export * from './progression/index.ts';
export { computeXp } from './xp.ts';

/** `grade()` with `patterns` filled from `detectPatterns()`. `tipsShown` stays empty. */
export function gradeWithPatterns(input: GradeInput): AttemptScore {
  return { ...grade(input), patterns: detectPatterns(input) };
}

/** Compile-time conformance with the frozen `GradeApi`. */
export const gradeApi: GradeApi = {
  grade,
  detectPatterns,
  applyAttempt,
  rankFor,
  createProfile,
  respondToLevelOffer,
  setInstrumentLevel,
};
