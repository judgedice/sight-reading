// The untrained-voice condition (round 2 detection): the performer model is deterministic and sings every written
// note once, and a few takes through the production path stay far below the owner's "lots of feedback on the staff".
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

  it('a few takes: about one detected note per written note, few extras drawn, no false wrong pitch', () => {
    const s = summarizeUntrained(plans.map((p) => measureUntrained(p)));
    expect(s.detectedPerNote).toBeGreaterThan(0.9);
    expect(s.detectedPerNote).toBeLessThan(1.1);
    expect(s.extraGhostsPerNote).toBeLessThan(0.05);
    expect(s.falseWrongPitch).toBeLessThan(0.03);
  }, 60_000);
});
