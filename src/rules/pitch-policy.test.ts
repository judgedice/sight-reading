import { describe, expect, it } from 'vitest';
import { configs } from '../../fixtures/follow/gen/io.ts';
import { pitchFacts } from '../../fixtures/follow/gen/reference.ts';
import { createRng } from '../core/rng.ts';
import type { ExpectedNote, Instrument } from '../core/types.ts';
import { classifyPitch, pitchCreditPolicy } from './pitch-policy.ts';

const cfg = configs();
const inst = (id: string): Instrument => cfg.instrumentById[id]!;

describe('pitchCreditPolicy (R7, R20)', () => {
  it('voice is octave-equivalent; every other instrument treats an octave as wrong', () => {
    for (const i of cfg.instruments.instruments) {
      expect(pitchCreditPolicy(i).octave, i.id).toBe(i.family === 'voice' ? 'equivalent' : 'wrong');
    }
  });
});

describe('classifyPitch (02 §4.2, §4.3)', () => {
  it('correct semitone within ±50 c; beyond is a different semitone', () => {
    const fl = inst('flute');
    expect(classifyPitch(72, 72.2, 0, fl, cfg)).toMatchObject({ kind: 'correct', p: 1, octaveDisplaced: false });
    expect(classifyPitch(72, 72.2, 0, fl, cfg).devCents).toBeCloseTo(20, 9);
    expect(classifyPitch(72, 71.5, 0, fl, cfg).kind).toBe('correct'); // exactly 50 c: same semitone
    expect(classifyPitch(72, 72.51, 0, fl, cfg)).toMatchObject({ kind: 'wrong', p: 0 });
    expect(classifyPitch(72, 71, 0, fl, cfg).devCents).toBeCloseTo(-100, 9);
  });

  it('applies the tuning offset before judging', () => {
    const tp = inst('trumpet-bb');
    const c = classifyPitch(70, 70.45, 20, tp, cfg);
    expect(c.kind).toBe('correct');
    expect(c.devCents).toBeCloseTo(25, 9);
    expect(c.rawDevCents).toBeCloseTo(45, 9);
    // 70 c sharp with a +25 c offset: 45 c, still correct; without the offset it is a wrong semitone.
    expect(classifyPitch(70, 70.7, 25, tp, cfg).kind).toBe('correct');
    expect(classifyPitch(70, 70.7, 0, tp, cfg).kind).toBe('wrong');
  });

  it('acceptance case 8: voice an octave low earns pitch credit, recorded as octaveDisplaced', () => {
    const v = inst('voice-soprano');
    const c = classifyPitch(72, 60.1, 0, v, cfg);
    expect(c).toMatchObject({ kind: 'correct', p: 1, octaveDisplaced: true, octaves: -1 });
    expect(c.devCents).toBeCloseTo(10, 9);
    expect(classifyPitch(60, 84, 0, v, cfg)).toMatchObject({ kind: 'correct', octaveDisplaced: true, octaves: 2 });
  });

  it('R20: an octave error on any other instrument is a wrong pitch (p = 0, kind octave)', () => {
    for (const id of ['flute', 'clarinet-bb', 'sax-alto', 'trumpet-bb', 'violin', 'cello', 'piano-rh']) {
      const c = classifyPitch(72, 60, 0, inst(id), cfg);
      expect(c, id).toMatchObject({ kind: 'octave', p: 0, octaveDisplaced: false, octaves: -1 });
      expect(c.devCents).toBeCloseTo(-1200, 9);
    }
  });

  it('voice: a wrong semitone reports its distance from the nearest-octave target', () => {
    // 11 semitones low: the nearest-octave target is 60, so the singer is a semitone above it.
    const c = classifyPitch(72, 61, 0, inst('voice-alto'), cfg);
    expect(c.kind).toBe('wrong');
    expect(c.devCents).toBeCloseTo(100, 9);
    expect(classifyPitch(72, 59, 0, inst('voice-alto'), cfg).devCents).toBeCloseTo(-100, 9);
    expect(classifyPitch(72, 61, 0, inst('flute'), cfg).devCents).toBeCloseTo(-1100, 9);
  });

  it('agrees with the fixture generator reference on 20,000 random cases away from the ±50 c boundary', () => {
    const rng = createRng(7);
    const ids = ['voice-tenor', 'flute', 'trumpet-bb', 'cello'];
    for (let k = 0; k < 20000; k++) {
      const i = inst(ids[k % ids.length]!);
      const target = 50 + rng.int(0, 30);
      const played = target + rng.next() * 30 - 15;
      const offset = rng.next() * 60 - 30;
      const adj = played - offset / 100;
      if (Math.abs(adj - Math.round(adj)) > 0.499) continue;
      const c = classifyPitch(target, played, offset, i, cfg);
      const r = pitchFacts({ concertMidi: target } as ExpectedNote, played, { inst: i, cfg, offsetCents: offset });
      expect(c.p).toBe(r.p);
      expect(c.octaveDisplaced).toBe(r.octaveDisplaced);
      expect(c.kind === 'octave').toBe(r.verdictBase === 'octave');
      if (c.p === 1) expect(c.devCents).toBeCloseTo(r.devCents, 9);
    }
  });
});
