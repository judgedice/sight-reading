// The untrained-voice condition (round 2 detection): the performer model is deterministic and sings every written
// note once, and a few takes through the production path stay far below the owner's "lots of feedback on the staff".
// Since the first real traces (docs/redesign/round2/08-real-voice.md) it also sings long scoops, overshoots, glitches
// an octave or more down, dips under the next note and steep tails.
import { describe, expect, it } from 'vitest';
import { fingerprint } from '../synth/dsp-util.ts';
import { measureUntrained, renderUntrained, summarizeUntrained, untrainedPlans } from './index.ts';

describe('untrained voice model', () => {
  const plans = untrainedPlans(3);
  it('plans one sung note per written note, mostly low voices, and renders deterministically', () => {
    for (const p of plans) {
      expect(p.take.notes).toHaveLength(p.base.expected.length);
      for (const n of p.take.notes) expect(Math.abs(n.offsetCents)).toBeLessThanOrEqual(20);
    }
    expect(fingerprint(renderUntrained(plans[0]!).samples)).toBe(fingerprint(renderUntrained(untrainedPlans(1)[0]!).samples));
  });

  it('draws what the first real voice did: long scoops, overshoots, glitches an octave or more down, dips, steep tails', () => {
    const notes = untrainedPlans(40).flatMap((p) => p.take.notes);
    const count = (f: (n: (typeof notes)[number]) => boolean): number => notes.filter(f).length;
    expect(count((n) => n.scoopSec >= 0.22)).toBeGreaterThan(50);
    expect(count((n) => n.overshootSec > 0)).toBeGreaterThan(25);
    expect(count((n) => n.glitchSec > 0 && n.glitchKind === 'subharmonic')).toBeGreaterThan(10);
    expect(count((n) => n.glitchSec > 0 && n.glitchKind === 'creak')).toBeGreaterThan(10);
    expect(count((n) => n.dipUnderSec > 0)).toBeGreaterThan(50);
    expect(count((n) => n.releaseDropDb < 25)).toBeGreaterThan(15);
    for (const n of notes) {
      if (n.glitchSec > 0) expect(n.glitchSemitones).toBeGreaterThanOrEqual(11);
      if (n.glitchSec > 0) expect(n.glitchSec).toBeLessThanOrEqual(0.18);
    }
    // The first take has a long scoop, both kinds of glitch and dips under the next note.
    const first = plans[0]!.take.notes;
    expect(first.some((n) => n.glitchKind === 'subharmonic' && n.glitchSec > 0) && first.some((n) => n.glitchKind === 'creak' && n.glitchSec > 0)).toBe(true);
  });

  it('a take with scoops and glitches: one note per written note, no extras', () => {
    const r = measureUntrained(plans[0]!);
    expect(r.detected).toBeLessThanOrEqual(r.notes + 1);
    expect(r.extrasFinal).toBe(0);
    expect(r.extraGhosts).toBe(0);
    expect(r.wrongFinal).toBe(0);
  }, 60_000);

  it('a few takes: about one detected note per written note, few extras drawn, no false wrong pitch', () => {
    const s = summarizeUntrained(plans.map((p) => measureUntrained(p)));
    expect(s.detectedPerNote).toBeGreaterThan(0.9);
    expect(s.detectedPerNote).toBeLessThan(1.1);
    expect(s.extraGhostsPerNote).toBeLessThan(0.05);
    expect(s.falseWrongPitch).toBeLessThan(0.03);
  }, 60_000);
});
