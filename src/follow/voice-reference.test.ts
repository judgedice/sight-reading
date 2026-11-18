// R55: the final alignment's voice drift replay exposes the reference values E23 reads (02 §4.5, §6.2): the offset
// after the last note and the offset in force at one third of the excerpt. Streams come from the fixture performer.
import { describe, expect, it } from 'vitest';
import type { ClockSeconds, FollowConfig } from '../core/types.ts';
import { buildStream, endOfTakeSec, perform, type PerformSpec } from '../../fixtures/follow/gen/perform.ts';
import { configs } from '../../fixtures/follow/gen/io.ts';
import { corpusBase } from '../../fixtures/follow/gen/scenario.ts';
import { resolveTolerances, VoiceDriftReference } from '../rules/index.ts';
import { FIXTURE_ANALYSIS_RATE, finalDetected } from '../testkit/predicates/index.ts';
import { alignFinal, alignFinalWithReference, oneThirdSec } from './index.ts';

const T0 = 10;
const RTL = 0.03;
const cfg = configs();

function configFor(instrumentId: string): FollowConfig {
  const b = corpusBase('le-beau-lc5883655-voice-mp1-9', instrumentId);
  return {
    expected: b.expected,
    tolerances: resolveTolerances(b.expected, { instrument: b.inst, level: b.level, bpm: b.bpm, meter: b.meter }, cfg),
    t0: T0 as ClockSeconds,
    latencyCompensationSec: RTL,
    bpm: b.bpm,
    beatsPerBar: b.beatsPerBar,
    instrument: b.inst,
    cfg,
    voiceReferenceCents: 0,
    analysisRate: FIXTURE_ANALYSIS_RATE,
    writtenKey: b.writtenKey,
  };
}

function detectedFor(c: FollowConfig, spec: PerformSpec) {
  const played = perform(c.expected, c.beatsPerBar, c.bpm, spec);
  return finalDetected(buildStream(played, { t0: T0, rtl: RTL, inst: c.instrument, cfg, endSec: endOfTakeSec(c.expected, c.bpm, cfg) }));
}

describe('alignFinalWithReference (R55, E23)', () => {
  it('a singer drifting flat: the final and one-third offsets follow the drift replay, same sign', () => {
    const c = configFor('voice-alto');
    const n = c.expected.length;
    // 0 c at the start to -80 c at the end, linear in note index.
    const centsPattern = c.expected.map((e) => Math.round((-80 * e.idx) / Math.max(1, n - 1)));
    const detected = detectedFor(c, { centsPattern, jitterMs: [0] });
    const r = alignFinalWithReference(c, detected, null);
    expect(r.alignment).toEqual(alignFinal(c, detected, null));
    const vr = r.voiceReference!;
    expect(vr).not.toBeNull();
    // Independent replay of the same rule on the final judgments' order.
    const drift = new VoiceDriftReference(cfg);
    const third = oneThirdSec(c.expected);
    let atThird: number | null = null;
    for (const e of c.expected) {
      if (atThird === null && (e.onsetSec as number) >= third - 1e-9) atThird = drift.offsetCents();
      const cents = centsPattern[e.idx]!;
      drift.observe(cents + 0, true);
    }
    expect(vr.finalOffsetCents).toBeLessThan(-40);
    expect(vr.offsetAtThirdCents).toBeLessThan(0);
    expect(Math.abs(vr.finalOffsetCents - drift.offsetCents())).toBeLessThanOrEqual(6);
    expect(Math.abs(vr.offsetAtThirdCents - atThird!)).toBeLessThanOrEqual(6);
    expect(Math.abs(vr.offsetAtThirdCents)).toBeLessThan(Math.abs(vr.finalOffsetCents));
  });

  it('in tune: both offsets stay near zero', () => {
    const c = configFor('voice-alto');
    const r = alignFinalWithReference(c, detectedFor(c, {}), null);
    expect(Math.abs(r.voiceReference!.finalOffsetCents)).toBeLessThanOrEqual(5);
    expect(Math.abs(r.voiceReference!.offsetAtThirdCents)).toBeLessThanOrEqual(5);
  });

  it('null for instruments without relative pitch', () => {
    const c = configFor('flute');
    expect(alignFinalWithReference(c, detectedFor(c, {}), null).voiceReference).toBeNull();
  });

  it('one third of the excerpt is a third of the way from the first onset to the last written end', () => {
    const c = configFor('voice-alto');
    const first = c.expected[0]!.onsetSec as number;
    const end = Math.max(...c.expected.map((e) => (e.onsetSec as number) + e.durSec));
    expect(oneThirdSec(c.expected)).toBeCloseTo(first + (end - first) / 3, 9);
    expect(oneThirdSec([])).toBe(0);
  });
});
