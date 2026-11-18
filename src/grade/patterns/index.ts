/**
 * `detectPatterns` (02 §6.1, §6.2; P12b): the 16 v1 error patterns over the final judgments, each with `lostPoints`.
 * Pure: reads the GradeInput and `config/tips.json` only.
 *
 * Global rules (02 §6.1 item 3), in this order:
 * - only enabled patterns; `instruments` restricts a pattern; beta instruments lose `selection.betaDisabledPatterns`;
 * - Δ-based timing patterns (E1, E2, E4, E9, E28, E29) are off without a measured calibration;
 * - evidence must span `selection.minEvidenceBars` bars, except `selection.evidenceBarsExempt`;
 * - incomplete attempts keep only `selection.incompleteAllowed`;
 * - poor signal (median clarity or clipping outside `selection.signal`) keeps nothing but E30;
 * - E30 (clean read) fires when the score ≥ its `minScore`, nothing else fired and no written note is red (PLAN
 *   ruling 51: missed, early or late, sharp, flat, wrong pitch or octave, as 04 §6.1 colours them).
 * Results follow the pattern order of `config/tips.json`.
 */
import type { GradeApi } from '../../core/api.ts';
import type { NoteJudgment, PatternDef, PatternResult } from '../../core/types.ts';
import { barsOf, buildContext, type Candidate, lostPoints, type PatternContext, th, uniqSorted } from './context.ts';
import { detectE22, detectE23, detectE6 } from './intonation-flow.ts';
import { detectE12, detectE13, detectE16, detectE18, detectE26, detectE31 } from './notes.ts';
import { detectDotted, detectDrift, detectE4, detectE9, detectFirstEntry } from './rhythm.ts';

type Detector = (ctx: PatternContext, def: PatternDef) => Candidate | null;

/** Dotted figures as written IOIs in quarter notes: Q.E is 3/2 + 1/2, E.S is 3/4 + 1/4. */
const DOTTED_QUARTER = 3 / 2;
const EIGHTH = 1 / 2;
const DOTTED_EIGHTH = 3 / 4;
const SIXTEENTH = 1 / 4;

export const DETECTORS: Readonly<Record<string, Detector>> = {
  E6: detectE6,
  E12: detectE12,
  E13: detectE13,
  E22: detectE22,
  E23: detectE23,
  E1: (c, d) => detectDrift(c, d, -1),
  E2: (c, d) => detectDrift(c, d, 1),
  E28: (c, d) => detectFirstEntry(c, d, true),
  E29: (c, d) => detectFirstEntry(c, d, false),
  E9: detectE9,
  E7: (c, d) => detectDotted(c, d, DOTTED_QUARTER, EIGHTH),
  E8: (c, d) => detectDotted(c, d, DOTTED_EIGHTH, SIXTEENTH),
  E4: detectE4,
  E18: detectE18,
  E26: detectE26,
  E16: detectE16,
  E31: detectE31,
};

/** Patterns that read onset offsets and so need a measured calibration (02 §6.1). */
export const TIMING_PATTERNS: ReadonlySet<string> = new Set(['E1', 'E2', 'E4', 'E9', 'E28', 'E29']);

function applies(ctx: PatternContext, def: PatternDef): boolean {
  const { instrument, calibrationMeasured, cfg } = ctx.input;
  if (!def.enabled) return false;
  if (def.instruments && !def.instruments.includes(instrument.id)) return false;
  if (instrument.status === 'beta' && cfg.tips.selection.betaDisabledPatterns.includes(def.id)) return false;
  if (!calibrationMeasured && TIMING_PATTERNS.has(def.id)) return false;
  return true;
}

/** True when a final judgment draws its note red (04 §6.1 error states; PLAN ruling 51). */
export function isRedJudgment(j: NoteJudgment): boolean {
  if (j.status === 'missed') return true;
  if (j.timing === 'early' || j.timing === 'late') return true;
  return j.pitch === 'sharp' || j.pitch === 'flat' || j.pitch === 'wrong-pitch' || j.pitch === 'octave';
}

function signalOk(ctx: PatternContext): boolean {
  const lim = ctx.input.cfg.tips.selection.signal;
  const s = ctx.input.signal;
  return s.medianClarity !== null && s.medianClarity >= lim.minMedianClarity && s.clippingFrac <= lim.maxClippingFrac;
}

export const detectPatterns: GradeApi['detectPatterns'] = (input) => {
  const ctx = buildContext(input);
  const sel = input.cfg.tips.selection;
  const cleanId = sel.cleanReadPatternId;
  const out: PatternResult[] = [];
  for (const def of input.cfg.tips.patterns) {
    if (def.id === cleanId || !applies(ctx, def)) continue;
    const detector = DETECTORS[def.id];
    if (!detector) continue;
    const c = detector(ctx, def);
    if (!c) continue;
    const notes = uniqSorted(c.notes);
    const bars = uniqSorted([...barsOf(ctx, notes), ...(c.extraBars ?? [])]);
    if (!sel.evidenceBarsExempt.includes(def.id) && bars.length < sel.minEvidenceBars) continue;
    const r: PatternResult = { id: def.id, lostPoints: lostPoints(ctx, notes, def.components), notes, bars };
    if (c.params) r.params = c.params;
    out.push(r);
  }
  const incomplete = ctx.comps.status === 'incomplete';
  const kept = out.filter((p) => !incomplete || sel.incompleteAllowed.includes(p.id));
  const good = signalOk(ctx);
  const fired = good ? kept : [];
  const clean = input.cfg.tips.patterns.find((d) => d.id === cleanId);
  const noRed = !input.alignment.judgments.some(isRedJudgment);
  if (clean && clean.enabled && out.length === 0 && noRed && ctx.comps.score >= th(clean, 'minScore') && (!incomplete || sel.incompleteAllowed.includes(cleanId))) {
    return [{ id: cleanId, lostPoints: 0, notes: [], bars: [] }];
  }
  return fired;
};
