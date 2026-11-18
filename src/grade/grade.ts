/** `grade()` (02 §4 and §5.4; P12): the score part of an attempt for one take. Pure: no clock, no I/O, Configs only. */
import type { GradeApi } from '../core/api.ts';
import { computeComponents } from './components.ts';
import { computeDiagnostics } from './diagnostics.ts';
import { rankedReasons } from './ranked.ts';
import { computeXp } from './xp.ts';

export const grade: GradeApi['grade'] = (input) => {
  const c = computeComponents(input.alignment, input.instrument, input.level, input.cfg);
  const diag = computeDiagnostics(input);
  const reasons = rankedReasons(input);
  const ranked = reasons.length === 0;
  return {
    status: c.status,
    components: { P: c.P, I: c.I, R: c.R },
    weights: c.weights,
    score: c.score,
    grade: c.grade,
    stars: c.stars,
    shine: c.shine,
    ranked,
    rankedReasons: reasons,
    diagnostics: {
      matched: c.matched,
      n: c.n,
      stops: diag.stops,
      restarts: diag.restarts,
      driftMsAtEnd: diag.driftMsAtEnd,
      counts: c.counts,
      signal: { medianClarity: input.signal.medianClarity, clippingFrac: input.signal.clippingFrac },
      voiceDriftCents: input.voiceReference ? input.voiceReference.finalOffsetCents : null,
    },
    // Patterns come from `detectPatterns` (P12b) and tips from `selectTips` (P13); the session fills both.
    patterns: [],
    tipsShown: [],
    xp: computeXp(input, c.score, c.status, ranked),
    configVersion: input.cfg.configVersion,
  };
};
