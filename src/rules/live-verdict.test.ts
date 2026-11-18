import { describe, expect, it } from 'vitest';
import { configs } from '../../fixtures/follow/gen/io.ts';
import { judgeMatched } from '../../fixtures/follow/gen/reference.ts';
import { createRng } from '../core/rng.ts';
import { makeMeter } from '../core/time.ts';
import type { ExpectedNote, Instrument, ResolvedTolerance } from '../core/types.ts';
import {
  intonationCredit,
  intonationVerdict,
  liveIntonationAsVerdict,
  liveIntonationEligible,
  liveIntonationStep,
  noteVerdict,
  onsetCredit,
  timingVerdict,
  wrongPitchAtConfirm,
  type LiveIntonation,
  type MatchedFacts,
} from './live-verdict.ts';
import { classifyPitch } from './pitch-policy.ts';
import { resolveTolerances } from './resolve-tolerances.ts';

const cfg = configs();
const inst = (id: string): Instrument => cfg.instrumentById[id]!;

function note(durSec: number, ioiSec: number, concertMidi = 72): ExpectedNote {
  return {
    idx: 1,
    eventIds: ['e1'],
    bar: 1,
    beatInBar: 2,
    onsetBeat: 1,
    durBeats: 1,
    onsetSec: 1,
    durSec,
    concertMidi,
    writtenPitch: { step: 'C', alter: 0, octave: 5 },
    ioiPrevSec: ioiSec,
    ioiNextSec: ioiSec,
    precededByRest: false,
    followedByRest: false,
    onsetKind: 'articulated',
    artic: 'normal',
    durationGraded: true,
    keySigAltered: false,
    explicitAccidental: false,
    ledgerLines: 0,
  };
}
const tolFor = (n: ExpectedNote, id: string, level: number, bpm: number): ResolvedTolerance =>
  resolveTolerances([n], { instrument: inst(id), level, bpm, meter: makeMeter(4, 4) }, cfg)[0]!;

// Flute L4 at 60 bpm, quarter: tGood 100, tRed 170, tBad 250 ms; intonation 20 / 35 c.
const fluteQ = note(1, 1);
const fluteTol = tolFor(fluteQ, 'flute', 4, 60);
const facts = (deltaMs: number, playedMidi: number, steadyMs = 500, target = 72, id = 'flute', tol = fluteTol): MatchedFacts => {
  const pitch = classifyPitch(target, playedMidi, 0, inst(id), cfg);
  return { deltaMs, pitch, intonation: pitch.p === 1 ? intonationVerdict(pitch.devCents, steadyMs, tol) : 'not-graded' };
};

describe('timing (02 §4.3, §4.8)', () => {
  it('on time within tRed, early or late beyond; credit 1 within tGood, linear to 0 at tBad', () => {
    expect(fluteTol.tGoodSec).toBeCloseTo(0.1, 12);
    expect(timingVerdict(170, fluteTol)).toBe('on-time');
    expect(timingVerdict(171, fluteTol)).toBe('late');
    expect(timingVerdict(-171, fluteTol)).toBe('early');
    expect(onsetCredit(100, fluteTol)).toBe(1);
    expect(onsetCredit(-175, fluteTol)).toBeCloseTo(0.5, 12);
    expect(onsetCredit(250, fluteTol)).toBe(0);
    expect(onsetCredit(400, fluteTol)).toBe(0);
  });
});

describe('intonation (02 §4.3)', () => {
  it('final verdict and credit from the full steady median', () => {
    expect(intonationVerdict(35, 500, fluteTol)).toBe('in-tune');
    expect(intonationVerdict(36, 500, fluteTol)).toBe('sharp');
    expect(intonationVerdict(-36, 500, fluteTol)).toBe('flat');
    expect(intonationCredit(20, 500, fluteTol)).toBe(1);
    expect(intonationCredit(-27.5, 500, fluteTol)).toBeCloseTo(0.5, 12);
    expect(intonationCredit(35, 500, fluteTol)).toBe(0);
  });

  it('acceptance case 13: 140 ms of steady pitch on flute gets no intonation grade and no sharp state', () => {
    expect(intonationVerdict(44, 140, fluteTol)).toBe('not-graded');
    expect(intonationCredit(44, 140, fluteTol)).toBeNull();
    expect(noteVerdict(facts(0, 72.44, 140), fluteTol)).toMatchObject({ state: 'correct', pitch: 'not-graded', red: false, ghost: null });
  });

  it('fixed pitch is never intonation-graded', () => {
    const pt = tolFor(fluteQ, 'piano-rh', 4, 60);
    expect(intonationVerdict(45, 900, pt)).toBe('not-graded');
    expect(intonationCredit(45, 900, pt)).toBeNull();
  });
});

describe('live provisional sharp / flat (02 §4.8, 01 §8.4)', () => {
  const step = (seq: [number, number][], tol = fluteTol, eligible = true): LiveIntonation[] => {
    let s: LiveIntonation = 'none';
    return seq.map(([dev, steady]) => (s = liveIntonationStep(s, dev, steady, eligible, tol)));
  };

  it('waits for 80 ms of steady pitch', () => {
    expect(step([[60, 40], [60, 79], [60, 80]])).toEqual(['none', 'none', 'sharp']);
  });

  it('enters only beyond red + 10 c hysteresis (35 + 10 = 45 c)', () => {
    expect(step([[45, 100]])).toEqual(['none']);
    expect(step([[45.1, 100]])).toEqual(['sharp']);
    expect(step([[-45.1, 100]])).toEqual(['flat']);
    expect(step([[40, 100], [44, 120]])).toEqual(['none', 'none']);
  });

  it('stays while beyond red, reverts at or inside red, and switches sides past the other threshold', () => {
    expect(step([[50, 100], [40, 120], [36, 140], [35, 160], [40, 180]])).toEqual(['sharp', 'sharp', 'sharp', 'none', 'none']);
    expect(step([[-50, 100], [-36, 120], [-20, 140]])).toEqual(['flat', 'flat', 'none']);
    expect(step([[50, 100], [-46, 120]])).toEqual(['sharp', 'flat']);
  });

  it('never fires for an ineligible note, and reverts if eligibility drops', () => {
    expect(step([[80, 300]], fluteTol, false)).toEqual(['none']);
    expect(liveIntonationStep('sharp', 80, 300, false, fluteTol)).toBe('none');
    expect(step([[80, 300]], tolFor(fluteQ, 'piano-rh', 4, 60))).toEqual(['none']);
  });

  it('eligibility uses the expected steady duration against intonationMinSteadyMs', () => {
    // Flute: 50 ms attack, 150 ms minimum. A 200 ms note qualifies, a 199 ms note does not.
    const ok = note(0.2, 0.25);
    const short = note(0.199, 0.25);
    expect(liveIntonationEligible(ok, tolFor(ok, 'flute', 9, 60))).toBe(true);
    expect(liveIntonationEligible(short, tolFor(short, 'flute', 9, 60))).toBe(false);
    // Violin: 60 ms attack, 180 ms minimum (vibrato family).
    const v = note(0.239, 0.25);
    expect(liveIntonationEligible(v, tolFor(v, 'violin', 9, 60))).toBe(false);
    const v2 = note(0.24, 0.25);
    expect(liveIntonationEligible(v2, tolFor(v2, 'violin', 9, 60))).toBe(true);
  });

  it('maps to an intonation fact for noteVerdict', () => {
    expect(liveIntonationAsVerdict('sharp', true)).toBe('sharp');
    expect(liveIntonationAsVerdict('none', true)).toBe('in-tune');
    expect(liveIntonationAsVerdict('none', false)).toBe('not-graded');
  });
});

describe('wrong pitch at confirmation (02 §4.8, 01 §9.3)', () => {
  it('needs agreeing frames at least 80 c from the target', () => {
    const fl = inst('flute');
    expect(wrongPitchAtConfirm(classifyPitch(72, 71, 0, fl, cfg), true, cfg)).toBe(true);
    expect(wrongPitchAtConfirm(classifyPitch(72, 71.25, 0, fl, cfg), true, cfg)).toBe(false); // 75 c: wait for steady
    expect(wrongPitchAtConfirm(classifyPitch(72, 71, 0, fl, cfg), false, cfg)).toBe(false);
    expect(wrongPitchAtConfirm(classifyPitch(72, 72.3, 0, fl, cfg), true, cfg)).toBe(false);
    expect(wrongPitchAtConfirm(classifyPitch(72, 60, 0, fl, cfg), true, cfg)).toBe(true); // octave, non-voice
    expect(wrongPitchAtConfirm(classifyPitch(72, 60, 0, inst('voice-alto'), cfg), true, cfg)).toBe(false);
  });
});

describe('noteVerdict: the 02 §4.8 state table', () => {
  it('pending and missed', () => {
    expect(noteVerdict('pending', fluteTol)).toMatchObject({ state: 'pending', red: false, ghost: null });
    expect(noteVerdict('missed', fluteTol)).toMatchObject({ state: 'missed', red: true, ghost: null, timing: null, pitch: null });
  });

  it('correct: p = 1, |Δ| ≤ tGood, |dev| ≤ good', () => {
    expect(noteVerdict(facts(50, 72.1), fluteTol)).toMatchObject({ state: 'correct', states: ['correct'], timing: 'on-time', pitch: 'in-tune', marginal: false, red: false, ghost: null });
  });

  it('correct-marginal: within tRed and red, beyond good on one of them; never red', () => {
    expect(noteVerdict(facts(150, 72.1), fluteTol)).toMatchObject({ state: 'correct-marginal', marginal: true, red: false, ghost: null });
    expect(noteVerdict(facts(0, 72.3), fluteTol)).toMatchObject({ state: 'correct-marginal', marginal: true, red: false });
    expect(noteVerdict(facts(-170, 71.65), fluteTol)).toMatchObject({ state: 'correct-marginal', marginal: true });
  });

  it('early / late beyond tRed: red, ghost at the played onset; partial credit between tRed and tBad', () => {
    const v = noteVerdict(facts(200, 72), fluteTol);
    expect(v).toMatchObject({ state: 'late', timing: 'late', red: true, ghost: 'late', marginal: false });
    expect(onsetCredit(200, fluteTol)).toBeGreaterThan(0);
    expect(noteVerdict(facts(-300, 72), fluteTol)).toMatchObject({ state: 'early', ghost: 'early' });
  });

  it('sharp / flat beyond red (intonation-graded)', () => {
    expect(noteVerdict(facts(0, 72.4), fluteTol)).toMatchObject({ state: 'sharp', pitch: 'sharp', red: true, ghost: 'sharp' });
    expect(noteVerdict(facts(0, 71.6), fluteTol)).toMatchObject({ state: 'flat', pitch: 'flat', ghost: 'flat' });
  });

  it('wrong pitch, and a non-voice octave error as wrong pitch with an octave ghost', () => {
    expect(noteVerdict(facts(0, 73), fluteTol)).toMatchObject({ state: 'wrong-pitch', pitch: 'wrong-pitch', red: true, ghost: 'wrong-pitch' });
    expect(noteVerdict(facts(0, 60), fluteTol)).toMatchObject({ state: 'wrong-pitch', pitch: 'octave', red: true, ghost: 'octave' });
  });

  it('states combine: late + wrong pitch is one ghost with both flags', () => {
    const v = noteVerdict(facts(260, 74), fluteTol);
    expect(v.states).toEqual(['late', 'wrong-pitch']);
    expect(v).toMatchObject({ state: 'wrong-pitch', timing: 'late', pitch: 'wrong-pitch', red: true, ghost: 'wrong-pitch' });
    expect(noteVerdict(facts(-200, 72.45), fluteTol).states).toEqual(['early', 'sharp']);
  });

  it('a late note with marginal intonation is late, not correct-marginal', () => {
    expect(noteVerdict(facts(200, 72.3), fluteTol)).toMatchObject({ state: 'late', marginal: false });
  });

  it('voice octave displacement is correct (no ghost, not red)', () => {
    const vt = tolFor(fluteQ, 'voice-soprano', 2, 60);
    expect(noteVerdict(facts(0, 60.05, 500, 72, 'voice-soprano', vt), vt)).toMatchObject({ state: 'correct', red: false, ghost: null, pitch: 'in-tune' });
  });

  it('agrees with the fixture generator on timing, pitch verdict and correct-marginal for 20,000 random notes', () => {
    const rng = createRng(4242);
    const ids = ['flute', 'violin', 'voice-tenor', 'piano-rh', 'trumpet-bb'];
    for (let k = 0; k < 20000; k++) {
      const id = ids[k % ids.length]!;
      const i = inst(id);
      const level = rng.int(1, 11);
      const bpm = 50 + rng.int(0, 90);
      const n = note(0.2 + rng.next(), 0.2 + rng.next());
      const tol = tolFor(n, id, level, bpm);
      const deltaMs = rng.next() * 600 - 300;
      const midi = 72 + (rng.next() < 0.2 ? rng.int(-13, 14) : 0) + rng.next() * 0.9 - 0.45;
      const steadyMs = rng.next() * 500;
      const pitch = classifyPitch(72, midi, 0, i, cfg);
      const v = noteVerdict({ deltaMs, pitch, intonation: pitch.p === 1 ? intonationVerdict(pitch.devCents, steadyMs, tol) : 'not-graded' }, tol);
      const ref = judgeMatched(n, tol, { detectedId: 1, onsetSec: n.onsetSec + deltaMs / 1000, durSec: n.durSec, midi, steadyMs }, { inst: i, cfg, offsetCents: 0 });
      expect(v.timing).toBe(ref.timing);
      expect(v.pitch).toBe(ref.pitch);
      // The reference flags marginal on any p = 1 note beyond good; the 02 §4.8 state needs the note otherwise correct.
      expect(v.marginal).toBe(ref.marginal && !v.red);
      expect(onsetCredit(deltaMs, tol)).toBeCloseTo(ref.credit.o, 5);
      const n2 = pitch.p === 1 ? intonationCredit(pitch.devCents, steadyMs, tol) : null;
      if (ref.credit.n === null) expect(n2).toBeNull();
      else expect(n2).toBeCloseTo(ref.credit.n, 5);
    }
  });
});
