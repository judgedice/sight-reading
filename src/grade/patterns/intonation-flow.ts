/** "in-tune" (E22, E23) and "flow" (E6) detectors (02 §6.2). */
import type { PatternDef } from '../../core/types.ts';
import { type Candidate, ev, matched, median, type PatternContext, th } from './context.ts';

/**
 * E22: median deviation over correctly pitched notes with ≥ 150 ms steady pitch has |median| ≥ 20 cents, no tuning
 * note was used, not voice and not fixed pitch. Evidence ≥ 8 notes. Params for U22: `offset` (cents, rounded) and
 * `direction` (+1 sharp, −1 flat).
 */
export function detectE22(ctx: PatternContext, def: PatternDef): Candidate | null {
  const { instrument, tuning, detected } = ctx.input;
  if (instrument.relativePitch || instrument.pitchKind === 'fixed' || tuning === null || tuning.used) return null;
  const minSteady = th(def, 'minSteadyMs');
  const byId = new Map(detected.map((d) => [d.id, d] as const));
  const notes: number[] = [];
  const devs: number[] = [];
  for (const e of ctx.expected) {
    const j = matched(ctx, e.idx);
    if (!j || j.credit.p !== 1 || j.centsError === null || j.detectedId === null) continue;
    const d = byId.get(j.detectedId);
    if (!d || d.steadyMs < minSteady) continue;
    notes.push(e.idx);
    devs.push(j.centsError);
  }
  if (notes.length < ev(def, 'notes')) return null;
  const med = median(devs)!;
  if (Math.abs(med) < th(def, 'medianAbsCents')) return null;
  return { notes, params: { offset: Math.round(Math.abs(med)), direction: Math.sign(med) } };
}

/**
 * E23 (voice): |final reference offset| ≥ 40 cents with the same sign as the offset at one third of the excerpt.
 * Evidence ≥ 8 correctly pitched notes; the intonation-graded ones are reported.
 */
export function detectE23(ctx: PatternContext, def: PatternDef): Candidate | null {
  const vr = ctx.input.voiceReference;
  if (!vr) return null;
  const fin = vr.finalOffsetCents;
  if (Math.abs(fin) < th(def, 'finalOffsetCents') || Math.sign(fin) !== Math.sign(vr.offsetAtThirdCents)) return null;
  const correct = ctx.expected.filter((e) => matched(ctx, e.idx)?.credit.p === 1).map((e) => e.idx);
  if (correct.length < ev(def, 'notes')) return null;
  const notes = correct.filter((i) => ctx.judgment[i]?.credit.n !== null);
  return { notes, params: { offset: Math.round(Math.abs(fin)), direction: Math.sign(fin) } };
}

/** E6: a stop (02 §4.6) or a displaced segment. Evidence: the missed notes of the stops and the covered notes. */
export function detectE6(ctx: PatternContext, def: PatternDef): Candidate | null {
  const { stops, restarts } = ctx.diag;
  if (stops.length + restarts.length < ev(def, 'stopsOrRestarts')) return null;
  const notes = [...ctx.flowNotes].sort((a, b) => a - b);
  return {
    notes,
    // The diagnostics' bars locate a stop or restart that covered no missed note (a restart of a replayed bar).
    extraBars: notes.length > 0 ? [] : [...stops.map((s) => s.bar), ...restarts.map((r) => r.bar)],
    params: { stops: stops.length, restarts: restarts.length },
  };
}
