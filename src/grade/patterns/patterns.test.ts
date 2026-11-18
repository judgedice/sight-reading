// P12b acceptance (01 P12b row; 02 §6.1, §6.2): each of the 16 v1 patterns has a firing and a non-firing case, built
// as synthetic GradeInputs (score + per-note performance, no audio). Credits follow 02 §4.3 with the resolved
// tolerances, so lostPoints are checked against the 02 §6.1 formula. The global rules have their own cases.
import { describe, expect, it } from 'vitest';
import { configs } from '../../../fixtures/follow/gen/io.ts';
import { makeMeter } from '../../core/time.ts';
import type { ClockSeconds, DetectedNote, ExpectedNote, GradeInput, KeySig, Meter, NoteJudgment, PatternResult, SpelledPitch, Step } from '../../core/types.ts';
import { resolveTolerances } from '../../rules/index.ts';
import { toMidi } from '../../theory/index.ts';
import { grade } from '../grade.ts';
import { selectTips } from '../../tips/index.ts';
import { detectPatterns } from './index.ts';

const cfg = configs();
const T0 = 10.03;

interface NoteSpec {
  /** Written pitch, for example "F#5", "Bb4", "C6". */
  p: string;
  dur: number;
  /** Rest beats before this note. */
  restBefore?: number;
  keySig?: boolean;
  acc?: boolean;
  ledger?: number;
}

interface Play {
  dMs?: number;
  /** Played written MIDI (default: the target). */
  written?: number;
  cents?: number;
  missed?: boolean;
}

interface Build {
  instrumentId?: string;
  level?: number;
  bpm?: number;
  meter?: Meter;
  /** Beats of pickup before bar 1 (the first notes sum to this). */
  pickupBeats?: number;
  notes: NoteSpec[];
  play?: (i: number, e: ExpectedNote) => Play;
  /** Written key signature (default C major). */
  writtenKey?: KeySig;
  extra?: Partial<GradeInput>;
}

function parsePitch(s: string): SpelledPitch {
  const m = /^([A-G])(#{1,2}|b{1,2})?(-?\d)$/.exec(s);
  if (!m) throw new Error(`bad pitch ${s}`);
  const acc = m[2] ?? '';
  const alter = (acc.startsWith('#') ? acc.length : -acc.length) as SpelledPitch['alter'];
  return { step: m[1] as Step, alter, octave: Number(m[3]) };
}

const lin = (x: number, good: number, bad: number): number => (x <= good ? 1 : x >= bad ? 0 : (bad - x) / (bad - good));

function build(b: Build): GradeInput {
  const instrument = cfg.instrumentById[b.instrumentId ?? 'flute']!;
  const level = b.level ?? 4;
  const bpm = b.bpm ?? 80;
  const meter = b.meter ?? makeMeter(4, 4);
  const bpb = meter.countsPerBar;
  const beatSec = 60 / bpm;
  let beat = -(b.pickupBeats ?? 0);
  const expected: ExpectedNote[] = b.notes.map((n, idx) => {
    beat += n.restBefore ?? 0;
    const onsetBeat = beat;
    beat += n.dur;
    const bar = Math.floor(onsetBeat / bpb + 1e-9) + 1;
    const wp = parsePitch(n.p);
    return {
      idx,
      eventIds: [`e${idx}`],
      bar: onsetBeat < 0 ? 0 : bar,
      beatInBar: onsetBeat < 0 ? onsetBeat + bpb + 1 : onsetBeat - (bar - 1) * bpb + 1,
      onsetBeat,
      durBeats: n.dur,
      onsetSec: onsetBeat * beatSec,
      durSec: n.dur * beatSec,
      concertMidi: toMidi(wp) - instrument.semis,
      writtenPitch: wp,
      ioiPrevSec: null,
      ioiNextSec: null,
      precededByRest: (n.restBefore ?? 0) > 0,
      followedByRest: false,
      onsetKind: 'articulated',
      artic: 'normal',
      durationGraded: false,
      keySigAltered: n.keySig ?? false,
      explicitAccidental: n.acc ?? false,
      ledgerLines: n.ledger ?? 0,
    };
  });
  expected.forEach((e, i) => {
    const prev = expected[i - 1];
    const next = expected[i + 1];
    e.ioiPrevSec = prev ? e.onsetSec - prev.onsetSec : null;
    e.ioiNextSec = next ? next.onsetSec - e.onsetSec : null;
    e.followedByRest = next ? next.precededByRest : true;
  });
  const tolerances = resolveTolerances(expected, { instrument, level, bpm, meter }, cfg);
  const judgments: NoteJudgment[] = [];
  const detected: DetectedNote[] = [];
  expected.forEach((e, i) => {
    const pl = b.play?.(i, e) ?? {};
    const t = tolerances[i]!;
    if (pl.missed) {
      judgments.push({
        expectedIdx: i, status: 'missed', detectedId: null, timing: null, timingErrorMs: null, pitch: null, playedConcertMidi: null,
        centsError: null, octaveDisplaced: false, duration: 'not-graded', heldRatio: null, credit: { p: 0, n: null, o: 0, d: null }, marginal: false, rejudged: false,
      });
      return;
    }
    const dMs = pl.dMs ?? 0;
    const cents = pl.cents ?? 0;
    const playedConcert = (pl.written ?? toMidi(e.writtenPitch)) - instrument.semis;
    const p = playedConcert === e.concertMidi ? 1 : 0;
    const o = lin(Math.abs(dMs), t.tGoodSec * 1000, t.tBadSec * 1000);
    const steadyMs = e.durSec * 800;
    const graded = p === 1 && t.goodCents !== null && t.redCents !== null && steadyMs >= t.minSteadyMs;
    const n = graded ? lin(Math.abs(cents), t.goodCents!, t.redCents!) : null;
    const id = i + 1;
    const onset = T0 + e.onsetSec + dMs / 1000;
    detected.push({
      id, onset: onset as ClockSeconds, offset: (onset + e.durSec * 0.95) as ClockSeconds, provisionalMidi: playedConcert, midi: playedConcert + cents / 100, stableMedianCents: cents,
      steadyMs, pitchSdCents: 3, clarity: 0.95, altOctaveClarity: null, onsetCause: 'from-silence', framesAgree: true,
    });
    judgments.push({
      expectedIdx: i,
      status: 'matched',
      detectedId: id,
      timing: Math.abs(dMs) > t.tRedSec * 1000 ? (dMs < 0 ? 'early' : 'late') : 'on-time',
      timingErrorMs: dMs,
      pitch: p === 0 ? 'wrong-pitch' : !graded ? 'not-graded' : cents > t.redCents! ? 'sharp' : cents < -t.redCents! ? 'flat' : 'in-tune',
      playedConcertMidi: playedConcert + cents / 100,
      centsError: p === 1 ? cents : null,
      octaveDisplaced: false,
      duration: 'not-graded',
      heldRatio: 0.95,
      credit: { p, n, o, d: null },
      marginal: false,
      rejudged: false,
    });
  });
  const continuous = instrument.pitchKind === 'continuous' && !instrument.relativePitch;
  return {
    expected,
    tolerances,
    alignment: { judgments, extras: [], displaced: [] },
    detected,
    instrument,
    level,
    bpm,
    meter,
    writtenKey: b.writtenKey ?? { fifths: 0, mode: 'major' },
    cfg,
    tuning: continuous ? { used: false, offsetCents: 0 } : null,
    voiceReference: instrument.relativePitch ? { finalOffsetCents: 0, offsetAtThirdCents: 0 } : null,
    signal: { medianClarity: 0.95, clippingFrac: 0 },
    calibrationMeasured: true,
    ranking: { mode: 'ranked', seenBefore: false, scanStrict: true, familiarity: 0, skipLimitHit: false, metronome: 'audible', gateFailures: [] },
    xp: { playerLevel: level, randomized: { key: false, meter: false, tempo: false }, streakDays: 0, dailyCountBefore: 0, repeatIndexToday: 0, placement: false },
    ...b.extra,
  };
}

const ids = (ps: PatternResult[]): string[] => ps.map((p) => p.id);
const find = (ps: PatternResult[], id: string): PatternResult => {
  const p = ps.find((x) => x.id === id);
  if (!p) throw new Error(`${id} did not fire; fired ${ids(ps).join(', ')}`);
  return p;
};

/** n bars of 4/4 quarters cycling through a C-major line around C5. */
const LINE = ['C5', 'D5', 'E5', 'F5', 'G5', 'F5', 'E5', 'D5'];
const quarters = (bars: number, line = LINE): NoteSpec[] => Array.from({ length: bars * 4 }, (_, i) => ({ p: line[i % line.length]!, dur: 1 }));

describe('E30 clean read', () => {
  it('fires alone on a perfect take', () => {
    const ps = detectPatterns(build({ notes: quarters(8) }));
    expect(ps).toEqual([{ id: 'E30', lostPoints: 0, notes: [], bars: [] }]);
  });
  it('does not fire when another pattern fires', () => {
    const ps = detectPatterns(build({ notes: quarters(8), play: (i) => (i === 0 ? { dMs: 250 } : {}) }));
    expect(ids(ps)).toEqual(['E29']);
  });
  it('does not fire below score 90 even when nothing else fires', () => {
    // every note 140 ms late: a constant offset is no timing pattern, but the score drops well below 90
    const input = build({ notes: quarters(8), play: () => ({ dMs: 140 }) });
    expect(grade(input).score).toBeLessThan(90);
    expect(detectPatterns(input)).toEqual([]);
  });
});

describe('perfect takes fire only E30 (02 §6.2 acceptance, synthetic form)', () => {
  const all = cfg.instruments.instruments.map((i) => i.id);
  it.each(all)('%s', (id) => {
    for (const bpm of [60, 100, 140]) {
      for (const level of [1, 5, 9]) expect(ids(detectPatterns(build({ instrumentId: id, bpm, level, notes: quarters(8) })))).toEqual(['E30']);
    }
  });
});

describe('E6 stopped or restarted', () => {
  it('fires on a stop (bar 5 silent) with the missed notes as evidence', () => {
    const input = build({ notes: quarters(8), play: (_i, e) => (e.bar === 5 ? { missed: true } : {}) });
    const ps = detectPatterns(input);
    const e6 = find(ps, 'E6');
    expect(e6.notes).toEqual([16, 17, 18, 19]);
    expect(e6.bars).toEqual([5]);
    expect(e6.params).toEqual({ stops: 1, restarts: 0 });
    // components P and R: each missed note loses w_P + w_R
    const w = grade(input).weights;
    expect(e6.lostPoints).toBeCloseTo(((w.P + w.R) * 4 * 100) / 32, 9);
  });
  it('fires on a displaced segment (restart) even without a stop', () => {
    const input = build({ notes: quarters(8) });
    input.alignment.displaced.push({ fromIdx: 4, toIdx: 7, offsetBeats: -4, detectedIds: [] });
    expect(ids(detectPatterns(input))).toContain('E6');
  });
  it('does not fire on one dropped quarter at 120 bpm (the silence is under 600 ms)', () => {
    const ps = detectPatterns(build({ bpm: 120, notes: quarters(8), play: (i) => (i === 9 ? { missed: true } : {}) }));
    expect(ids(ps)).not.toContain('E6');
  });
});

describe('E12 missed key-signature notes', () => {
  // D major: F# and C# from the key signature in every bar
  const D_MAJOR: KeySig = { fifths: 2, mode: 'major' };
  const dMajor = (bars: number): NoteSpec[] =>
    Array.from({ length: bars }, () => [
      { p: 'D5', dur: 1 },
      { p: 'E5', dur: 1 },
      { p: 'F#5', dur: 1, keySig: true },
      { p: 'C#5', dur: 1, keySig: true },
    ]).flat();
  it('fires when F# is played as F in several bars', () => {
    const notes = dMajor(4);
    const ps = detectPatterns(build({ writtenKey: D_MAJOR, notes, play: (_i, e) => (e.writtenPitch.step === 'F' && e.bar <= 3 ? { written: 77 } : {}) }));
    const e12 = find(ps, 'E12');
    expect(e12.notes).toEqual([2, 6, 10]);
    expect(e12.bars).toEqual([1, 2, 3]);
    expect(ids(ps)).not.toContain('E13');
  });
  it('fires when a key-signature sharp is applied to a carried natural', () => {
    const notes = dMajor(4);
    // bars 5 and 6: F naturals (carried from a cancelled bar, no own accidental) played as F#
    for (let bar = 0; bar < 2; bar++) notes.push({ p: 'F5', dur: 1 }, { p: 'E5', dur: 1 }, { p: 'F5', dur: 1 }, { p: 'E5', dur: 1 });
    const ps = detectPatterns(build({ writtenKey: D_MAJOR, notes, play: (i, e) => (i >= 16 && e.writtenPitch.step === 'F' ? { written: 78 } : {}) }));
    expect(find(ps, 'E12').notes).toEqual([16, 18, 20, 22]);
  });
  it('does not fire under 30% of the key-signature notes (2 of 8)', () => {
    const ps = detectPatterns(build({ writtenKey: D_MAJOR, notes: dMajor(4), play: (i) => (i === 2 || i === 6 ? { written: 77 } : {}) }));
    expect(ids(ps)).not.toContain('E12');
    const ps2 = detectPatterns(build({ writtenKey: D_MAJOR, notes: dMajor(2), play: (i) => (i === 2 || i === 6 ? { written: 77 } : {}) }));
    expect(ids(ps2)).toContain('E12');
  });
  it('does not fire when the played semitone is unclear (more than 30 cents off)', () => {
    const ps = detectPatterns(build({ writtenKey: D_MAJOR, notes: dMajor(2), play: (i) => (i === 2 || i === 6 ? { written: 77, cents: 40 } : {}) }));
    expect(ids(ps)).not.toContain('E12');
  });
  it('reads the key signature from GradeInput.writtenKey, not from the notes (PLAN ruling 44)', () => {
    // The same F naturals under a C major signature carry no sharp to forget or apply: nothing to slip.
    const notes: NoteSpec[] = [];
    for (let bar = 0; bar < 4; bar++) notes.push({ p: 'F5', dur: 1 }, { p: 'E5', dur: 1 }, { p: 'F5', dur: 1 }, { p: 'E5', dur: 1 });
    const play = (_i: number, e: ExpectedNote): Play => (e.writtenPitch.step === 'F' ? { written: 78 } : {});
    expect(ids(detectPatterns(build({ notes, play })))).not.toContain('E12');
    expect(find(detectPatterns(build({ writtenKey: D_MAJOR, notes, play })), 'E12').notes).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
  });
  it('does not fire for a wrong pitch that is not the key-signature slip', () => {
    const ps = detectPatterns(build({ writtenKey: D_MAJOR, notes: dMajor(2), play: (i) => (i === 2 || i === 6 ? { written: 76 } : {}) }));
    expect(ids(ps)).not.toContain('E12');
  });
});

describe('E13 missed written accidentals', () => {
  const withAcc = (): NoteSpec[] => {
    const n = quarters(4);
    n[1] = { p: 'G#5', dur: 1, acc: true };
    n[5] = { p: 'Bb4', dur: 1, acc: true };
    n[9] = { p: 'G#5', dur: 1, acc: true };
    return n;
  };
  it('fires when the accidental is dropped on two notes in two bars', () => {
    const ps = detectPatterns(build({ notes: withAcc(), play: (i) => (i === 1 ? { written: 79 } : i === 5 ? { written: 71 } : {}) }));
    expect(find(ps, 'E13').notes).toEqual([1, 5]);
    expect(ids(ps)).not.toContain('E12');
  });
  it('does not fire when the wrong note is not the unaltered letter', () => {
    const ps = detectPatterns(build({ notes: withAcc(), play: (i) => (i === 1 || i === 9 ? { written: 81 } : {}) }));
    expect(ids(ps)).not.toContain('E13');
  });
  it('does not fire on one dropped accidental', () => {
    const ps = detectPatterns(build({ notes: withAcc(), play: (i) => (i === 1 ? { written: 79 } : {}) }));
    expect(ids(ps)).not.toContain('E13');
  });
  it('does not fire when the two slips are in one bar (evidence spans < 2 bars)', () => {
    const n = quarters(4);
    n[1] = { p: 'G#5', dur: 1, acc: true };
    n[2] = { p: 'G#5', dur: 1, acc: true };
    const ps = detectPatterns(build({ notes: n, play: (i) => (i === 1 || i === 2 ? { written: 79 } : {}) }));
    expect(ids(ps)).not.toContain('E13');
  });
});

describe('SX04: E12 and E13 report the bflat-involved condition (02 §6.4)', () => {
  // Alto sax line with written B-flats carrying their own accidental, dropped to B natural in two bars.
  const sax = (): NoteSpec[] => {
    const n = quarters(4);
    n[1] = { p: 'Bb4', dur: 1, acc: true };
    n[9] = { p: 'Bb4', dur: 1, acc: true };
    n[5] = { p: 'G#5', dur: 1, acc: true };
    n[13] = { p: 'G#5', dur: 1, acc: true };
    return n;
  };
  const tipsFor = (patterns: PatternResult[]): string[] =>
    selectTips({ patterns, instrument: cfg.instrumentById['sax-alto']!, level: 4, recentTipIds: [], recentPrimaries: ['E13', 'E13'], catalog: cfg.tips }).map((t) => t.id);

  it('a dropped B-flat accidental sets bflat-involved, and the tip selector then serves SX04', () => {
    const ps = detectPatterns(build({ instrumentId: 'sax-alto', notes: sax(), play: (i) => (i === 1 || i === 9 ? { written: 71 } : {}) }));
    const e13 = find(ps, 'E13');
    expect(e13.notes).toEqual([1, 9]);
    expect(e13.params).toEqual({ 'bflat-involved': 2 });
    expect(tipsFor(ps)).toContain('SX04');
  });

  it('a dropped G-sharp sets bflat-involved to 0, and SX04 stays out', () => {
    const ps = detectPatterns(build({ instrumentId: 'sax-alto', notes: sax(), play: (i) => (i === 5 || i === 13 ? { written: 79 } : {}) }));
    expect(find(ps, 'E13').params).toEqual({ 'bflat-involved': 0 });
    expect(tipsFor(ps)).not.toContain('SX04');
  });

  it('E12 counts a B-flat from the key signature played as B natural', () => {
    const notes: NoteSpec[] = [];
    for (let bar = 0; bar < 3; bar++) notes.push({ p: 'C5', dur: 1 }, { p: 'Bb4', dur: 1, keySig: true }, { p: 'A4', dur: 1 }, { p: 'G4', dur: 1 });
    const ps = detectPatterns(build({ instrumentId: 'sax-alto', writtenKey: { fifths: -1, mode: 'major' }, notes, play: (_i, e) => (e.writtenPitch.step === 'B' ? { written: 71 } : {}) }));
    expect(find(ps, 'E12').params).toEqual({ 'bflat-involved': 3 });
  });
});

describe('E16 wrong partial (trumpet)', () => {
  const tpt = (): NoteSpec[] => quarters(4, ['C5', 'E5', 'G5', 'D5', 'C5', 'E5', 'D5', 'C5']);
  it('fires on E5 played as G5 (open, partials 5 and 6) twice', () => {
    const ps = detectPatterns(build({ instrumentId: 'trumpet-bb', notes: tpt(), play: (i) => (i === 1 || i === 9 ? { written: 79 } : {}) }));
    expect(find(ps, 'E16').notes).toEqual([1, 9]);
  });
  it('does not fire for a different valve combination (D5 is 1, played E5 open)', () => {
    const ps = detectPatterns(build({ instrumentId: 'trumpet-bb', notes: tpt(), play: (i) => (i === 3 || i === 11 ? { written: 76 } : {}) }));
    expect(ids(ps)).not.toContain('E16');
  });
  it('does not fire for non-adjacent partials or an octave (C5 played C6 or G5)', () => {
    const ps = detectPatterns(build({ instrumentId: 'trumpet-bb', notes: tpt(), play: (i) => (i === 0 ? { written: 84 } : i === 8 ? { written: 79 } : {}) }));
    expect(ids(ps)).not.toContain('E16');
  });
  it('is trumpet only', () => {
    const ps = detectPatterns(build({ notes: tpt(), play: (i) => (i === 1 || i === 9 ? { written: 79 } : {}) }));
    expect(ids(ps)).not.toContain('E16');
  });
});

describe('E18 misread ledger-line notes', () => {
  const ledgerLine = (): NoteSpec[] => {
    const n = quarters(4);
    for (const i of [2, 6, 10, 14]) n[i] = { p: 'A6', dur: 1, ledger: 2 };
    return n;
  };
  it('fires when 2 of 4 ledger notes are read a step off', () => {
    const ps = detectPatterns(build({ notes: ledgerLine(), play: (i) => (i === 2 ? { written: 91 } : i === 6 ? { written: 96 } : {}) }));
    expect(find(ps, 'E18').notes).toEqual([2, 6]);
  });
  it('does not fire on a semitone slip (A6 played G#6 is not a line or space away)', () => {
    const ps = detectPatterns(build({ notes: ledgerLine(), play: (i) => (i === 2 || i === 6 ? { written: 92 } : {}) }));
    expect(ids(ps)).not.toContain('E18');
  });
  it('does not fire under 40% of the ledger notes', () => {
    const n = ledgerLine();
    // 4 more bars with one ledger note each: 2 misreads of 8 ledger notes is 25%
    for (let bar = 0; bar < 4; bar++) n.push({ p: 'A6', dur: 1, ledger: 2 }, { p: 'C5', dur: 1 }, { p: 'D5', dur: 1 }, { p: 'E5', dur: 1 });
    const ps = detectPatterns(build({ notes: n, play: (i) => (i === 2 || i === 6 ? { written: 91 } : {}) }));
    expect(ids(ps)).not.toContain('E18');
  });
});

describe('E22 out of tune overall', () => {
  it('fires 25 c sharp throughout with no tuning note, and gives U22 its params', () => {
    const ps = detectPatterns(build({ notes: quarters(8), play: () => ({ cents: 25 }) }));
    const e22 = find(ps, 'E22');
    expect(e22.params).toEqual({ offset: 25, direction: 1 });
    expect(e22.notes).toHaveLength(32);
    expect(e22.lostPoints).toBeGreaterThan(0);
  });
  it('reports flat as direction -1', () => {
    expect(find(detectPatterns(build({ notes: quarters(8), play: () => ({ cents: -22 }) })), 'E22').params).toEqual({ offset: 22, direction: -1 });
  });
  it('does not fire under 20 c, with a tuning note, for voice, or on a beta instrument', () => {
    expect(ids(detectPatterns(build({ notes: quarters(8), play: () => ({ cents: 12 }) })))).not.toContain('E22');
    expect(ids(detectPatterns(build({ notes: quarters(8), play: () => ({ cents: 25 }), extra: { tuning: { used: true, offsetCents: 0 } } })))).not.toContain('E22');
    expect(ids(detectPatterns(build({ instrumentId: 'voice-soprano', notes: quarters(8), play: () => ({ cents: 25 }) })))).not.toContain('E22');
    expect(cfg.instrumentById['oboe']!.status).toBe('beta');
    expect(ids(detectPatterns(build({ instrumentId: 'oboe', notes: quarters(8), play: () => ({ cents: 25 }) })))).not.toContain('E22');
  });
  it('does not fire with fewer than 8 qualifying notes', () => {
    expect(ids(detectPatterns(build({ notes: quarters(1).concat(quarters(1)).slice(0, 7), play: () => ({ cents: 25 }) })))).not.toContain('E22');
  });
});

describe('E23 pitch drifted (voice)', () => {
  const v = (finalOffsetCents: number, offsetAtThirdCents: number): GradeInput =>
    build({ instrumentId: 'voice-soprano', level: 7, notes: quarters(8), extra: { voiceReference: { finalOffsetCents, offsetAtThirdCents }, tuning: null } });
  it('fires when the reference sank 45 c and was already flat at one third', () => {
    const e23 = find(detectPatterns(v(-45, -15)), 'E23');
    expect(e23.params).toEqual({ offset: 45, direction: -1 });
  });
  it('does not fire under 40 c, or when the sign at one third differs', () => {
    expect(ids(detectPatterns(v(-30, -30)))).not.toContain('E23');
    expect(ids(detectPatterns(v(-45, 5)))).not.toContain('E23');
  });
  it('is voice only', () => {
    const input = build({ notes: quarters(8), extra: { voiceReference: { finalOffsetCents: -45, offsetAtThirdCents: -20 } } });
    expect(ids(detectPatterns(input))).not.toContain('E23');
  });
});

describe('E1 rushed / E2 fell behind', () => {
  const drift = (beatsPerBar: number): ((i: number, e: ExpectedNote) => Play) => (_i, e) => ({ dMs: (e.onsetBeat / 4) * beatsPerBar * 750 });
  it('E1 fires at -0.05 beat per bar over 8 bars; E2 does not', () => {
    const ps = detectPatterns(build({ notes: quarters(8), play: drift(-0.05) }));
    const e1 = find(ps, 'E1');
    expect(e1.params?.['slopeBeatsPerBar']).toBeCloseTo(-0.05, 9);
    expect(ids(ps)).not.toContain('E2');
    expect(ids(ps)).not.toContain('E9');
  });
  it('E2 fires at +0.05 beat per bar; E1 and E4 do not', () => {
    const ps = detectPatterns(build({ notes: quarters(8), play: drift(0.05) }));
    expect(ids(ps)).toContain('E2');
    expect(ids(ps)).not.toContain('E1');
    expect(ids(ps)).not.toContain('E4');
  });
  it('do not fire for a slope under 0.04 beat per bar or a constant offset', () => {
    expect(ids(detectPatterns(build({ notes: quarters(8), play: drift(0.03) })))).not.toContain('E2');
    expect(ids(detectPatterns(build({ notes: quarters(8), play: drift(-0.03) })))).not.toContain('E1');
    expect(ids(detectPatterns(build({ notes: quarters(8), play: () => ({ dMs: -60 }) })))).toEqual(['E30']);
  });
  it('do not fire over fewer than 6 bars', () => {
    expect(ids(detectPatterns(build({ notes: quarters(5), play: drift(0.1) })))).not.toContain('E2');
  });
  it('do not fire when the scatter is too large (r² < 0.5)', () => {
    const noisy = (i: number, e: ExpectedNote): Play => ({ dMs: (e.onsetBeat / 4) * 0.05 * 750 + (i % 2 === 0 ? 90 : -90) });
    expect(ids(detectPatterns(build({ notes: quarters(8), play: noisy })))).not.toContain('E2');
  });
});

describe('E4 hesitated at barlines', () => {
  it('fires when 4 downbeats are 120 ms late against the rest of the bar', () => {
    const ps = detectPatterns(build({ notes: quarters(8), play: (_i, e) => (e.beatInBar === 1 && [2, 3, 5, 7].includes(e.bar) ? { dMs: 120 } : {}) }));
    expect(find(ps, 'E4').notes).toEqual([4, 8, 16, 24]);
  });
  it('does not fire on 3 downbeats or on 40 ms hesitations', () => {
    expect(ids(detectPatterns(build({ notes: quarters(8), play: (_i, e) => (e.beatInBar === 1 && [2, 3, 5].includes(e.bar) ? { dMs: 120 } : {}) })))).not.toContain('E4');
    expect(ids(detectPatterns(build({ notes: quarters(8), play: (_i, e) => (e.beatInBar === 1 && e.bar > 1 ? { dMs: 40 } : {}) })))).not.toContain('E4');
  });
  it('does not count downbeats after a rest', () => {
    const notes = quarters(8).map((n, i) => (i % 4 === 3 ? { ...n, dur: 0.5 } : i % 4 === 0 && i > 0 ? { ...n, restBefore: 0.5 } : n));
    expect(ids(detectPatterns(build({ notes, play: (_i, e) => (e.beatInBar === 1 && e.bar > 1 ? { dMs: 120 } : {}) })))).not.toContain('E4');
  });
});

describe('E7 dotted quarter-eighth evened out', () => {
  const qe = (bars: number): NoteSpec[] =>
    Array.from({ length: bars }, () => [
      { p: 'C5', dur: 1.5 },
      { p: 'D5', dur: 0.5 },
      { p: 'E5', dur: 1 },
      { p: 'F5', dur: 1 },
    ]).flat();
  it('fires when the eighth comes early (ratio 2:1)', () => {
    const ps = detectPatterns(build({ notes: qe(4), play: (i) => (i % 4 === 1 ? { dMs: -125 } : {}) }));
    const e7 = find(ps, 'E7');
    expect(e7.params?.['medianRatio']).toBeCloseTo(2, 6);
    expect(e7.notes).toEqual([0, 1, 4, 5, 8, 9, 12, 13]);
  });
  it('does not fire when played 3:1', () => {
    expect(ids(detectPatterns(build({ notes: qe(4) })))).toEqual(['E30']);
  });
  it('does not fire where the short IOI is under 150 ms (fast tempo)', () => {
    expect(ids(detectPatterns(build({ bpm: 220, level: 9, notes: qe(4), play: (i) => (i % 4 === 1 ? { dMs: -45 } : {}) })))).not.toContain('E7');
  });
  it('does not fire with fewer than 3 figures', () => {
    expect(ids(detectPatterns(build({ notes: [...qe(2), ...quarters(2)], play: (i) => (i % 4 === 1 && i < 8 ? { dMs: -125 } : {}) })))).not.toContain('E7');
  });
});

describe('E8 dotted eighth-sixteenth evened out', () => {
  const es = (bars: number): NoteSpec[] =>
    Array.from({ length: bars }, () => [
      { p: 'C5', dur: 0.75 },
      { p: 'D5', dur: 0.25 },
      { p: 'E5', dur: 1 },
      { p: 'F5', dur: 0.75 },
      { p: 'E5', dur: 0.25 },
      { p: 'D5', dur: 1 },
    ]).flat();
  it('fires when played as a triplet (ratio 2:1)', () => {
    const ps = detectPatterns(build({ notes: es(3), play: (i) => (i % 3 === 1 ? { dMs: -62.5 } : {}) }));
    expect(find(ps, 'E8').params?.['medianRatio']).toBeCloseTo(2, 6);
    expect(ids(ps)).not.toContain('E7');
  });
  it('does not fire when played 3:1, or at a ratio above 2.2', () => {
    expect(ids(detectPatterns(build({ notes: es(3) })))).toEqual(['E30']);
    // sixteenth 30 ms early: long 592.5 / short 217.5 = 2.72
    expect(ids(detectPatterns(build({ notes: es(3), play: (i) => (i % 3 === 1 ? { dMs: -30 } : {}) })))).not.toContain('E8');
  });
});

describe('E9 early after rests', () => {
  const rests = (bars: number): NoteSpec[] =>
    Array.from({ length: bars }, () => [
      { p: 'C5', dur: 1 },
      { p: 'E5', dur: 1, restBefore: 1 },
      { p: 'D5', dur: 1 },
    ]).flat();
  it('fires when 4 entries after rests are 150 ms early', () => {
    const ps = detectPatterns(build({ notes: rests(4), play: (i) => (i % 3 === 1 ? { dMs: -150 } : {}) }));
    expect(find(ps, 'E9').notes).toEqual([1, 4, 7, 10]);
  });
  it('does not fire for entries 60 ms early, or only 2 early entries', () => {
    expect(ids(detectPatterns(build({ notes: rests(4), play: (i) => (i % 3 === 1 ? { dMs: -60 } : {}) })))).not.toContain('E9');
    expect(ids(detectPatterns(build({ notes: rests(4), play: (i) => (i === 1 || i === 4 ? { dMs: -150 } : {}) })))).not.toContain('E9');
  });
  it('does not count rests shorter than 1 beat', () => {
    const notes = rests(4).map((n) => (n.restBefore ? { ...n, restBefore: 0.5 } : n));
    expect(ids(detectPatterns(build({ notes, play: (i) => (i % 3 === 1 ? { dMs: -150 } : {}) })))).not.toContain('E9');
  });
});

describe('E28 late pickup / E29 late first entry', () => {
  const withPickup = (): NoteSpec[] => [{ p: 'G4', dur: 1 }, ...quarters(4)];
  it('E28 fires when the pickup is 250 ms late against the next notes', () => {
    const ps = detectPatterns(build({ pickupBeats: 1, notes: withPickup(), play: (i) => (i === 0 ? { dMs: 250 } : {}) }));
    const e28 = find(ps, 'E28');
    expect(e28.notes).toEqual([0]);
    expect(e28.bars).toEqual([0]);
    expect(ids(ps)).not.toContain('E29');
  });
  it('E28 fires when the pickup is missed', () => {
    expect(ids(detectPatterns(build({ pickupBeats: 1, notes: withPickup(), play: (i) => (i === 0 ? { missed: true } : {}) })))).toContain('E28');
  });
  it('E29 fires for a late first note without a pickup', () => {
    const ps = detectPatterns(build({ notes: quarters(4), play: (i) => (i === 0 ? { dMs: 250 } : {}) }));
    expect(ids(ps)).toEqual(['E29']);
  });
  it('do not fire under max(tRed, 0.25 beat), or when the whole take is late by the same amount', () => {
    expect(ids(detectPatterns(build({ pickupBeats: 1, notes: withPickup(), play: (i) => (i === 0 ? { dMs: 150 } : {}) })))).not.toContain('E28');
    expect(ids(detectPatterns(build({ notes: quarters(4), play: () => ({ dMs: 120 }) })))).not.toContain('E29');
  });
});

describe('E26 busy passages broke down', () => {
  // 8 bars at 60 bpm: odd bars quarters, even bars two beats of sixteenths and two quarters (8 dense beats of 32)
  const busy = (): NoteSpec[] => {
    const out: NoteSpec[] = [];
    for (let bar = 1; bar <= 8; bar++) {
      if (bar % 2 === 1) out.push(...quarters(1));
      else out.push(...['C5', 'D5', 'E5', 'F5', 'G5', 'F5', 'E5', 'D5'].map((p) => ({ p, dur: 0.25 })), { p: 'C5', dur: 1 }, { p: 'E5', dur: 1 });
    }
    return out;
  };
  it('fires when half the sixteenths are wrong and the rest is clean', () => {
    const input = build({ bpm: 60, notes: busy() });
    const play = (i: number, e: ExpectedNote): Play => (e.durBeats < 1 && i % 2 === 0 ? { written: toMidi(e.writtenPitch) + 2 } : {});
    const ps = detectPatterns(build({ bpm: 60, notes: busy(), play }));
    const e26 = find(ps, 'E26');
    expect(e26.notes.every((i) => input.expected[i]!.durBeats < 1)).toBe(true);
    expect(e26.notes).toHaveLength(16);
  });
  it('does not fire when the same error rate is spread evenly', () => {
    const play = (i: number, e: ExpectedNote): Play => (i % 2 === 0 ? { written: toMidi(e.writtenPitch) + 2 } : {});
    expect(ids(detectPatterns(build({ bpm: 60, notes: busy(), play })))).not.toContain('E26');
  });
  it('does not fire on an excerpt of even note values', () => {
    const play = (i: number, e: ExpectedNote): Play => (i < 12 ? { written: toMidi(e.writtenPitch) + 2 } : {});
    expect(ids(detectPatterns(build({ notes: quarters(8), play })))).not.toContain('E26');
  });
});

describe('E31 clarinet break crossings', () => {
  // written A4 (69) and C5 (72) alternate across the break; E4-F4-G4 runs below it
  const clar = (): NoteSpec[] => quarters(8, ['E4', 'F4', 'A4', 'C5', 'A4', 'G4', 'F4', 'E4']);
  it('fires when crossing notes fail and the rest is clean', () => {
    const play = (i: number): Play => (i % 8 === 3 && i < 24 ? { written: 71 } : {});
    const ps = detectPatterns(build({ instrumentId: 'clarinet-bb', notes: clar(), play }));
    expect(find(ps, 'E31').notes).toEqual([3, 11, 19]);
  });
  it('fires on late crossings with a measured calibration', () => {
    const play = (i: number): Play => (i % 8 === 3 || i % 8 === 4 ? { dMs: 150 } : {});
    expect(ids(detectPatterns(build({ instrumentId: 'clarinet-bb', notes: clar(), play })))).toContain('E31');
  });
  it('does not fire when errors elsewhere are as frequent', () => {
    const play = (i: number): Play => ((i % 8 === 3 && i < 24) || [1, 6, 9, 14, 17, 22].includes(i) ? { written: toMidi({ step: 'B', alter: 0, octave: 4 }) - 9 } : {});
    expect(ids(detectPatterns(build({ instrumentId: 'clarinet-bb', notes: clar(), play })))).not.toContain('E31');
  });
  it('is clarinet only', () => {
    const play = (i: number): Play => (i % 8 === 3 && i < 24 ? { written: 71 } : {});
    expect(ids(detectPatterns(build({ notes: clar(), play })))).not.toContain('E31');
  });
});

describe('global rules (02 §6.1 item 3)', () => {
  const lateFirst = (i: number): Play => (i === 0 ? { dMs: 250 } : {});
  it('timing patterns are off without a measured calibration', () => {
    // the late first note fires E29 when calibrated; without calibration nothing else fires, so the take reads clean
    expect(ids(detectPatterns(build({ notes: quarters(8), play: lateFirst })))).toEqual(['E29']);
    expect(ids(detectPatterns(build({ notes: quarters(8), play: lateFirst, extra: { calibrationMeasured: false } })))).toEqual(['E30']);
    const drift = (_i: number, e: ExpectedNote): Play => ({ dMs: (e.onsetBeat / 4) * 0.05 * 750 });
    expect(ids(detectPatterns(build({ notes: quarters(8), play: drift, extra: { calibrationMeasured: false } })))).not.toContain('E2');
  });
  it('incomplete attempts fire only E6', () => {
    const input = build({ notes: quarters(8), play: (i, e) => (e.bar >= 4 ? { missed: true } : i === 0 ? { dMs: 250 } : i === 1 || i === 5 ? { written: 70 } : {}) });
    expect(grade(input).status).toBe('incomplete');
    expect(ids(detectPatterns(input))).toEqual(['E6']);
  });
  it('poor signal (clarity or clipping) keeps nothing but E30', () => {
    expect(detectPatterns(build({ notes: quarters(8), play: lateFirst, extra: { signal: { medianClarity: 0.8, clippingFrac: 0 } } }))).toEqual([]);
    expect(detectPatterns(build({ notes: quarters(8), play: lateFirst, extra: { signal: { medianClarity: 0.95, clippingFrac: 0.05 } } }))).toEqual([]);
    expect(ids(detectPatterns(build({ notes: quarters(8), extra: { signal: { medianClarity: null, clippingFrac: 0 } } })))).toEqual(['E30']);
  });
  it('E6, E28 and E29 are exempt from the 2-bar evidence rule', () => {
    const p = find(detectPatterns(build({ notes: quarters(4), play: lateFirst })), 'E29');
    expect(p.bars).toEqual([1]);
  });
  it('lostPoints follows Σ weight × (1 − credit) × 100 / N over the pattern components', () => {
    const input = build({ notes: quarters(4), play: (i) => (i === 1 || i === 5 ? { written: 70 } : {}) });
    input.expected[1]!.explicitAccidental = true;
    input.expected[5]!.explicitAccidental = true;
    input.expected[1]!.writtenPitch = { step: 'D', alter: 1, octave: 5 };
    input.expected[5]!.writtenPitch = { step: 'D', alter: 1, octave: 5 };
    // target D#5 (75) played D5 (74): wrong pitch, the accidental dropped
    for (const i of [1, 5]) {
      input.expected[i]!.concertMidi = 75;
      input.alignment.judgments[i]!.playedConcertMidi = 74;
    }
    const e13 = find(detectPatterns(input), 'E13');
    expect(e13.lostPoints).toBeCloseTo((grade(input).weights.P * 2 * 100) / 16, 9);
  });
  it('is deterministic, follows config order and does not mutate its input', () => {
    const input = build({ notes: quarters(8), play: (i, e) => (i === 0 ? { dMs: 250 } : e.bar === 5 ? { missed: true } : {}) });
    const before = JSON.stringify(input);
    const a = detectPatterns(input);
    expect(JSON.stringify(detectPatterns(input))).toBe(JSON.stringify(a));
    expect(JSON.stringify(input)).toBe(before);
    const order = cfg.tips.patterns.map((p) => p.id);
    expect(ids(a)).toEqual(['E6', 'E29'].sort((x, y) => order.indexOf(x) - order.indexOf(y)));
  });
  it('there is a detector for each of the 16 v1 patterns (18 enabled ids)', async () => {
    const { DETECTORS } = await import('./index.ts');
    const enabled = cfg.tips.patterns.filter((p) => p.enabled).map((p) => p.id).sort();
    expect(enabled).toHaveLength(18);
    expect([...Object.keys(DETECTORS), cfg.tips.selection.cleanReadPatternId].sort()).toEqual(enabled);
  });
});
