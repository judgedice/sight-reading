// D8b review model (04 §6.1, §6.2, §6.5, §6.6, §8.3): final states, review ghosts at the played position, heat strip,
// replay brackets, slip order and filters, and the note inspector text in both number modes.
import { describe, expect, it } from 'vitest';
import { makeScore } from '../../../../store/test-data.ts';
import { createReviewBus, reviewPanelHandlers } from './bus.ts';
import { buildReview, inspectorFor, pitchText, slipsFor, speakPitch, stepSlip, timingValuePhrase, type ReviewInput } from './model.ts';
import { BPM, cfg, DISPLACED_IDS, EXTRA_ID, LATE, MISSED, REJUDGED, reviewFixture, SHARP, spell, WRONG } from './test-fixture.ts';

function model(over: Partial<ReviewInput> = {}, rec: Parameters<typeof reviewFixture>[0] = {}) {
  const fx = reviewFixture(rec);
  const m = buildReview({
    record: fx.record,
    prepared: fx.prepared,
    expected: fx.expected,
    instrument: cfg.instrumentById.flute!,
    spell,
    tolerances: fx.tolerances,
    patternName: (id) => cfg.tips.patterns.find((p) => p.id === id)?.name,
    ...over,
  });
  return { fx, m };
}

const note = (m: ReturnType<typeof model>['m'], idx: number) => m.notes.find((n) => n.idx === idx)!;

describe('review states and ghosts', () => {
  it('maps every final judgment to its review state, re-judged flag included', () => {
    const { m, fx } = model();
    expect(m.notes).toHaveLength(fx.expected.length);
    expect(note(m, MISSED).state).toEqual({ phase: 'missed', rejudged: false });
    expect(note(m, LATE).state).toMatchObject({ phase: 'judged', timing: 'late', pitch: 'in-tune' });
    expect(note(m, SHARP).state).toMatchObject({ phase: 'judged', timing: 'on-time', pitch: 'sharp' });
    expect(note(m, REJUDGED).state).toMatchObject({ phase: 'judged', marginal: true, rejudged: true });
    expect(note(m, REJUDGED).error).toBe(false);
    expect(note(m, 0).kinds).toEqual(['correct']);
    expect(note(m, REJUDGED).kinds).toEqual(['correct', 'rejudged']);
  });

  it('draws a ghost at the played onset for timing errors and at the written spot for sharp and flat', () => {
    const { m, fx } = model();
    const late = note(m, LATE).ghost!;
    expect(late.kind).toBe('late');
    expect(late.scoreBeat).toBeCloseTo(fx.expected[LATE]!.onsetBeat + (0.12 * BPM) / 60, 9);
    expect(late.writtenPitch).toEqual(fx.expected[LATE]!.writtenPitch);
    const sharp = note(m, SHARP).ghost!;
    expect(sharp).toMatchObject({ kind: 'sharp', centsError: 38, targetExpectedIdx: SHARP, displaced: false });
    expect(sharp.writtenPitch).toEqual(fx.expected[SHARP]!.writtenPitch);
    expect(note(m, 0).ghost).toBeNull();
    expect(note(m, MISSED).ghost).toBeNull();
  });

  it('spells a wrong note against the target and the key (B♭ written, B natural played)', () => {
    const { m } = model();
    const g = note(m, WRONG).ghost!;
    expect(g.kind).toBe('wrong-pitch');
    expect(g.writtenPitch).toEqual({ step: 'B', alter: 0, octave: 4 });
  });

  it('extras are extra ghosts; a replayed run becomes replay ghosts placed from the take clock', () => {
    const { m } = model();
    const extra = m.extras.find((x) => x.detectedId === EXTRA_ID)!;
    expect(extra.displaced).toBe(false);
    expect(extra.beat).toBeCloseTo(15, 6);
    expect(extra.bar).toBe(4);
    expect(extra.ghost).toMatchObject({ kind: 'extra', targetExpectedIdx: null, displaced: false });
    const replay = m.extras.filter((x) => x.displaced);
    expect(replay.map((x) => x.detectedId)).toEqual(DISPLACED_IDS);
    expect(replay.map((x) => Math.round(x.beat * 100) / 100)).toEqual([20, 21, 21.5, 22, 23]);
    expect(replay.every((x) => x.ghost.displaced && x.ghost.kind === 'extra')).toBe(true);
    // Every ghost is unique by detected note.
    expect(new Set(m.ghosts.map((g) => g.detectedId)).size).toBe(m.ghosts.length);
  });

  it('without a matched note or extra to anchor the clock, replay ghosts sit at the run offset', () => {
    const fx = reviewFixture();
    const judgments = fx.record.judgments.map((j) => ({ ...j, status: 'missed' as const, detectedId: null, timing: null, timingErrorMs: null, pitch: null }));
    const { m } = model({}, { judgments, extras: [] });
    expect(m.extras.filter((x) => x.displaced).map((x) => x.beat)).toEqual([20, 21, 21.5, 22, 23]);
  });

  it('a replay bracket names the replayed bars and spans the ghosts', () => {
    const { m } = model();
    expect(m.brackets).toHaveLength(1);
    const b = m.brackets[0]!;
    expect(b).toMatchObject({ fromBar: 1, toBar: 1, label: 'bars 1–1 replayed', detectedIds: DISPLACED_IDS });
    expect(b.startBeat).toBeCloseTo(20, 6);
    expect(b.endBeat).toBeGreaterThan(23);
  });

  it('every played ghost with a known length gets a duration tail', () => {
    const { m } = model();
    const ids = m.tails.map((t) => t.detectedId).sort((a, b) => a - b);
    expect(ids).toEqual([...m.ghosts.map((g) => g.detectedId)].sort((a, b) => a - b));
    expect(m.tails.find((t) => t.detectedId === EXTRA_ID)!.durBeats).toBeCloseTo((0.25 * BPM) / 60, 6);
    expect(m.tails.filter((t) => t.replay)).toHaveLength(DISPLACED_IDS.length);
  });
});

describe('heat strip', () => {
  it('one cell per bar with the error share, level and label (04 §6.5)', () => {
    const { m } = model();
    expect(m.heat.map((h) => h.bar)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const b1 = m.heat[0]!;
    expect(b1).toMatchObject({ total: 5, off: 2, level: 2, label: 'Bar 1: 2 of 5 notes off (1 late, 1 sharp)' });
    expect(m.heat[1]).toMatchObject({ off: 0, level: 0, label: null });
    expect(m.heat[2]).toMatchObject({ off: 1, total: 5, level: 1, label: 'Bar 3: 1 of 5 notes off (1 missed)' });
    expect(m.heat[3]).toMatchObject({ off: 1, total: 2, level: 2, label: 'Bar 4: 1 of 2 notes off (1 wrong note)' });
    expect(m.heat[5]).toMatchObject({ off: 5, total: 5, level: 3 });
    expect(m.heat[0]!.startBeat).toBe(0);
    expect(m.heat[0]!.endBeat).toBe(4);
  });
});

describe('slips', () => {
  it('lists error notes and extras in time order; filters restrict to one count', () => {
    const { m } = model();
    const all = slipsFor(m, 'all');
    const beats = all.map((s) => s.beat);
    expect([...beats].sort((a, b) => a - b)).toEqual(beats);
    expect(all.map((s) => (s.kind === 'note' ? s.idx : `x${s.detectedId}`))).toEqual([LATE, SHARP, MISSED, WRONG, `x${EXTRA_ID}`, 22, 23, 24, 25, 26]);
    expect(slipsFor(m, 'missed').map((s) => (s.kind === 'note' ? s.idx : -1))).toEqual([MISSED, 22, 23, 24, 25, 26]);
    expect(slipsFor(m, 'rejudged')).toEqual([{ kind: 'note', idx: REJUDGED, beat: 9.5 }]);
    expect(slipsFor(m, 'extra')).toEqual([{ kind: 'extra', detectedId: EXTRA_ID, beat: expect.closeTo(15, 6) as number }]);
    expect(slipsFor(m, 'pitch').map((s) => (s.kind === 'note' ? s.idx : -1))).toEqual([SHARP]);
    expect(slipsFor(m, 'wrong').map((s) => (s.kind === 'note' ? s.idx : -1))).toEqual([WRONG]);
    expect(slipsFor(m, 'timing').map((s) => (s.kind === 'note' ? s.idx : -1))).toEqual([LATE]);
  });

  it('steps forward and back, clamps at the ends, and starts from the nearest slip off a plain note', () => {
    const { m } = model();
    const all = slipsFor(m, 'all');
    expect(stepSlip(all, null, 1)).toBe(all[0]);
    expect(stepSlip(all, null, -1)).toBe(all[all.length - 1]);
    expect(stepSlip(all, all[0]!, 1)).toBe(all[1]);
    expect(stepSlip(all, all[0]!, -1)).toBe(all[0]);
    expect(stepSlip(all, all[all.length - 1]!, 1)).toBe(all[all.length - 1]);
    const plain = { kind: 'note' as const, idx: 5, beat: 4 };
    expect(stepSlip(all, plain, 1)).toEqual({ kind: 'note', idx: MISSED, beat: 8 });
    expect(stepSlip(all, plain, -1)).toEqual({ kind: 'note', idx: SHARP, beat: 2 });
    expect(stepSlip([], plain, 1)).toBeNull();
  });
});

describe('note inspector (04 §6.5)', () => {
  it('late with partial credit: both units and the note-value phrase', () => {
    const { m, fx } = model();
    expect(0.12).toBeLessThanOrEqual(fx.tolerances[LATE]!.tBadSec);
    expect(0.12).toBeGreaterThan(fx.tolerances[LATE]!.tRedSec);
    expect(inspectorFor(m, { kind: 'note', idx: LATE, beat: 1 })).toEqual([
      'Bar 1, beat 2',
      'Written C5 (eighth)',
      'Played C5, 120 ms late (about a sixteenth)',
      'Late (partial credit)',
    ]);
  });

  it('sharp: cents; wrong note: the played natural against the key', () => {
    const { m } = model();
    expect(note(m, SHARP).inspector).toEqual(['Bar 1, beat 3', 'Written G4 (quarter)', 'Played G4, on time', '38 cents sharp']);
    expect(note(m, WRONG).inspector).toEqual(['Bar 4, beat 1', 'Written B♭4 (half)', 'Played B♮4, on time', 'Wrong note']);
  });

  it('missed, marginal and re-judged notes', () => {
    const { m } = model();
    expect(note(m, MISSED).inspector).toEqual(['Bar 3, beat 1', 'Written D4 (quarter)', 'Not played']);
    expect(note(m, REJUDGED).inspector).toEqual([
      'Bar 3, beat 2.5',
      'Written F4 (eighth)',
      'Played F4, on time',
      'On time, 90 ms late (a little credit lost)',
      'Listening live has a fraction of a second to decide. After the take we look at the whole performance.',
    ]);
  });

  it('a re-judged note names what live showed when the live judgments were kept', () => {
    const fx = reviewFixture();
    const j = fx.record.judgments[REJUDGED]!;
    const live = [{ ...j, timing: 'late' as const, provisional: false }];
    const { m } = model({}, { debug: { live } });
    expect(note(m, REJUDGED).inspector.at(-1)).toBe('During the take this showed as late. Looking at the whole take, it was on time.');
  });

  it('with "Show cents and milliseconds" off the verdicts carry no numbers', () => {
    const { m } = model({ showNumbers: false });
    expect(note(m, LATE).inspector[2]).toBe('Played C5, late');
    expect(note(m, SHARP).inspector[3]).toBe('Sharp');
    expect(note(m, REJUDGED).inspector[3]).toBe('On time (a little credit lost)');
    expect(note(m, LATE).ariaLabel).toContain('you played C 5, late, late');
  });

  it('the pattern line comes from the pattern the note belongs to', () => {
    const pattern = cfg.tips.patterns[0]!;
    const score = { ...makeScore(80), patterns: [{ id: pattern.id, lostPoints: 3, notes: [LATE], bars: [1] }] };
    const { m } = model({}, { score });
    expect(note(m, LATE).inspector.at(-1)).toBe(`Pattern: ${pattern.name}`);
    expect(note(m, SHARP).inspector.some((l) => l.startsWith('Pattern:'))).toBe(false);
  });

  it('extras and replayed notes say where they were played', () => {
    const { m } = model();
    expect(inspectorFor(m, { kind: 'extra', detectedId: EXTRA_ID, beat: 15 })).toEqual(['Played at bar 4, beat 4', 'Played D5, extra note']);
    const r = m.extras.find((x) => x.detectedId === DISPLACED_IDS[0])!;
    expect(r.inspector).toEqual(['Played at bar 6, beat 1', 'Played A4, replayed']);
  });

  it('screen-reader labels follow a11y.note with speakPitch', () => {
    const { m } = model();
    expect(note(m, WRONG).ariaLabel).toBe('Bar 4, beat 1, written B flat 4 half note, you played B natural 4, on time, wrong note');
    expect(note(m, LATE).ariaLabel).toBe('Bar 1, beat 2, written C 5 eighth note, you played C 5, 120 milliseconds late, late');
    expect(note(m, MISSED).ariaLabel).toBe('Bar 3, beat 1, written D 4 quarter note, missed');
    expect(note(m, 0).ariaLabel).toBe('Bar 1, beat 1, written A 4 quarter note, you played A 4, on time, right');
  });
});

describe('text helpers', () => {
  it('pitchText and speakPitch name a natural only against the key or the compared note', () => {
    const fMajor = { fifths: -1, mode: 'major' as const };
    expect(pitchText({ step: 'B', alter: -1, octave: 4 }, fMajor)).toBe('B♭4');
    expect(pitchText({ step: 'B', alter: 0, octave: 4 }, fMajor)).toBe('B♮4');
    expect(pitchText({ step: 'F', alter: 0, octave: 5 }, { fifths: 0, mode: 'major' }, { step: 'F', alter: 1, octave: 5 })).toBe('F♮5');
    expect(pitchText({ step: 'C', alter: 0, octave: 4 }, fMajor)).toBe('C4');
    expect(speakPitch({ step: 'F', alter: 1, octave: 5 }, fMajor)).toBe('F sharp 5');
  });

  it('timing phrase: nearest value at the take tempo, or less than a sixteenth', () => {
    const { fx } = model();
    const p = fx.prepared;
    // 90 bpm: quarter 667 ms, eighth 333, triplet eighth 222, sixteenth 167, 32nd 83.
    expect(timingValuePhrase(160, 90, p)).toBe('a sixteenth');
    expect(timingValuePhrase(90, 90, p)).toBe('a 32nd');
    expect(timingValuePhrase(30, 90, p)).toBe('less than a sixteenth');
    expect(timingValuePhrase(230, 90, p)).toBe('a triplet eighth');
    expect(timingValuePhrase(-340, 90, p)).toBe('an eighth');
    expect(timingValuePhrase(700, 90, p)).toBe('a quarter');
  });
});

describe('review bus', () => {
  it('the counts line and the re-judged button set the stepper filter', () => {
    const bus = createReviewBus();
    const seen: string[] = [];
    bus.subscribe(() => seen.push(bus.get()));
    const h = reviewPanelHandlers(bus);
    h.onSelectVerdict('missed');
    h.onShowRejudged();
    h.onSelectVerdict('total');
    h.onSelectVerdict('total');
    expect(seen).toEqual(['missed', 'rejudged', 'all']);
  });
});
