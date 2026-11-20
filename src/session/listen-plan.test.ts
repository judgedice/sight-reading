// Listen plan (05 §9.2, §9.3) against hand-computed times: ties joined, rests silent, pickups on their beat, 6/8,
// "Slower" at 75%, a start bar, "Click along", "Hear bar n" and the bar timeline. Excerpts are built by hand and go
// through the real `buildExpectedNotes`, so tie chains and rests are the corpus module's.
import { describe, expect, it } from 'vitest';
import type { PreparedEvent, PreparedExcerpt, PreparedMeasure, SpelledPitch, Step } from '../core/types.ts';
import { configs } from '../../fixtures/follow/gen/io.ts';
import { midiToFreq } from '../theory/index.ts';
import { LISTEN, RANGE, barAt, keyChordTones, listenSourceOf, planBars, planClickBar, planListen, planRange } from './listen-plan.ts';

const cfg = configs();
const Q = 480;

const pitch = (name: string): SpelledPitch => {
  const m = /^([A-G])([#b]?)(\d)$/.exec(name);
  if (!m) throw new Error(name);
  return { step: m[1] as Step, alter: m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0, octave: Number(m[3]) } as SpelledPitch;
};

type Ev = { p: string | null; dur: number; tieStart?: true; tieStop?: true };

/** A prepared excerpt from bars of events (concert = written, flute). `p: null` is a rest. */
function excerpt(o: { beats: number; beatType: 2 | 4 | 8; countUnitTicks: number; pickup?: Ev[]; bars: Ev[][] }): PreparedExcerpt {
  const measures: PreparedMeasure[] = [];
  let tick = 0;
  let id = 0;
  const pickupTicks = (o.pickup ?? []).reduce((n, e) => n + e.dur, 0);
  const all = o.pickup ? [o.pickup, ...o.bars] : o.bars;
  all.forEach((evs, i) => {
    const isPickup = !!o.pickup && i === 0;
    const start = tick;
    const events: PreparedEvent[] = evs.map((e) => {
      const base = { id: `e${++id}`, tick, dur: e.dur };
      tick += e.dur;
      if (e.p === null) return { ...base, kind: 'rest' } as PreparedEvent;
      const p = pitch(e.p);
      return { ...base, kind: 'note', concertPitch: p, writtenPitch: p, ...(e.tieStart ? { tieStart: true } : {}), ...(e.tieStop ? { tieStop: true } : {}) } as PreparedEvent;
    });
    measures.push({ index: i, isPickup, startTick: start, displayBar: o.pickup ? i : i + 1, events });
  });
  return {
    instrumentId: 'flute',
    excerptId: 'hand',
    meter: { beats: o.beats, beatType: o.beatType, countUnitTicks: o.countUnitTicks, countsPerBar: (o.beats * (4 / o.beatType) * Q) / o.countUnitTicks },
    pickupTicks,
    writtenKey: { fifths: 0, mode: 'major' },
    concertKey: { fifths: 0, mode: 'major' },
    clef: 'treble',
    measures,
    selection: { settings: { bpm: 120 } },
  } as unknown as PreparedExcerpt;
}

const facts = (bpm: number, accent = true) => ({ bpm, a4Hz: 440, accent });
const near = (a: number, b: number): void => expect(a).toBeCloseTo(b, 9);

// 4/4: | C4 q, D4 q~D4 q, rest q | E4 h, F4 h |
const fourFour = excerpt({
  beats: 4,
  beatType: 4,
  countUnitTicks: Q,
  bars: [
    [{ p: 'C4', dur: Q }, { p: 'D4', dur: Q, tieStart: true }, { p: 'D4', dur: Q, tieStop: true }, { p: null, dur: Q }],
    [{ p: 'E4', dur: 2 * Q }, { p: 'F4', dur: 2 * Q }],
  ],
});

describe('planListen', () => {
  it('4/4 at 120: one bar of clicks, ties joined, rests silent, notes end 10% early', () => {
    const plan = planListen(listenSourceOf(fourFour, cfg), facts(120));
    // Beat 0.5 s; the lead-in is beats 0 to 3 (0, 0.5, 1.0, 1.5 s), the downbeat of bar 1 at 2.0 s.
    expect(plan.clicks).toEqual([
      { atSec: 0, accent: true },
      { atSec: 0.5, accent: false },
      { atSec: 1, accent: false },
      { atSec: 1.5, accent: false },
    ]);
    near(plan.leadInSec, 2);
    expect(plan.notes.map((n) => n.concertMidi)).toEqual([60, 62, 64, 65]);
    const t = plan.notes.map((n) => [n.startSec, n.durSec]);
    // C4 a quarter (0.5 s × 0.9); the tied D4 one note of two beats (1.0 s × 0.9); nothing in the rest (3.5 to 4.0 s).
    [[2, 0.45], [2.5, 0.9], [4, 0.9], [5, 0.9]].forEach(([s, d], i) => {
      near(t[i]![0]!, s!);
      near(t[i]![1]!, d!);
    });
    expect(plan.notes.some((n) => n.startSec >= 3.5 - 1e-9 && n.startSec < 4 - 1e-9)).toBe(false);
    near(plan.notes[0]!.hz, midiToFreq(60, 440));
    expect(plan.bars).toEqual([
      { bar: 1, startSec: 2, endSec: 4 },
      { bar: 2, startSec: 4, endSec: 6 },
    ]);
    expect(plan.totalBars).toBe(2);
    near(plan.endSec, 5.9);
    expect(barAt(plan, 1)).toBeNull();
    expect(barAt(plan, 3.9)).toBe(1);
    expect(barAt(plan, 4)).toBe(2);
  });

  it('Slower plays at 75%: 90 bpm, beat 2/3 s', () => {
    const plan = planListen(listenSourceOf(fourFour, cfg), facts(120), { slower: true });
    expect(plan.bpm).toBe(90);
    const beat = 2 / 3;
    plan.clicks.forEach((c, k) => near(c.atSec, k * beat));
    const lead = 4 * beat; // 8/3 s
    near(plan.leadInSec, lead);
    near(plan.notes[0]!.startSec, lead);
    near(plan.notes[0]!.durSec, beat * 0.9); // 0.6 s
    near(plan.notes[1]!.startSec, lead + beat); // 10/3 s
    near(plan.notes[1]!.durSec, 2 * beat * 0.9); // 1.2 s
    near(plan.notes[2]!.startSec, lead + 4 * beat); // 16/3 s
    near(plan.bars[1]!.startSec, 16 / 3);
  });

  it('from bar 2: the lead-in is the bar before it; earlier notes are left out', () => {
    const plan = planListen(listenSourceOf(fourFour, cfg), facts(120), { fromBar: 2 });
    expect(plan.startBar).toBe(2);
    expect(plan.notes.map((n) => [n.concertMidi, n.startSec])).toEqual([
      [64, 2],
      [65, 3],
    ]);
    expect(plan.bars).toEqual([{ bar: 2, startSec: 2, endSec: 4 }]);
    expect(plan.clicks).toHaveLength(4);
  });

  it('Click along keeps the clicks through the music, the downbeats accented', () => {
    const plan = planListen(listenSourceOf(fourFour, cfg), facts(120), { clickAlong: true });
    expect(plan.clicks.map((c) => c.atSec)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5]);
    expect(plan.clicks.filter((c) => c.accent).map((c) => c.atSec)).toEqual([0, 2, 4]);
    near(plan.endSec, 6);
  });

  it('accent off: every click is an offbeat click', () => {
    const plan = planListen(listenSourceOf(fourFour, cfg), facts(120, false), { clickAlong: true });
    expect(plan.clicks.some((c) => c.accent)).toBe(false);
  });

  it('a pickup starts on its beat inside the lead-in bar (3/4, one-beat pickup, 60 bpm)', () => {
    const p = excerpt({ beats: 3, beatType: 4, countUnitTicks: Q, pickup: [{ p: 'G4', dur: Q }], bars: [[{ p: 'C5', dur: 3 * Q }]] });
    const plan = planListen(listenSourceOf(p, cfg), facts(60));
    // Lead-in clicks at 0, 1, 2 s; bar 1 at 3 s; the pickup on beat 3 of the lead-in bar, 2 s.
    expect(plan.clicks.map((c) => c.atSec)).toEqual([0, 1, 2]);
    expect(plan.startBar).toBe(0);
    expect(plan.notes.map((n) => [n.concertMidi, n.startSec])).toEqual([
      [67, 2],
      [72, 3],
    ]);
    near(plan.notes[0]!.durSec, 0.9);
    near(plan.notes[1]!.durSec, 2.7);
    expect(plan.bars).toEqual([
      { bar: 0, startSec: 2, endSec: 3 },
      { bar: 1, startSec: 3, endSec: 6 },
    ]);
    expect(plan.totalBars).toBe(1);
  });

  it('6/8 counts dotted quarters: two clicks a bar, eighths a third of a beat (60 bpm)', () => {
    const p = excerpt({
      beats: 6,
      beatType: 8,
      countUnitTicks: 3 * (Q / 2),
      bars: [[{ p: 'A4', dur: Q / 2 }, { p: 'B4', dur: Q / 2 }, { p: 'C5', dur: Q / 2 }, { p: 'D5', dur: 3 * (Q / 2) }]],
    });
    const plan = planListen(listenSourceOf(p, cfg), facts(60));
    expect(plan.beatsPerBar).toBe(2);
    expect(plan.clicks).toEqual([
      { atSec: 0, accent: true },
      { atSec: 1, accent: false },
    ]);
    const t = plan.notes.map((n) => [n.startSec, n.durSec]);
    [[2, 0.3], [2 + 1 / 3, 0.3], [2 + 2 / 3, 0.3], [3, 0.9]].forEach(([s, d], i) => {
      near(t[i]![0]!, s!);
      near(t[i]![1]!, d!);
    });
    expect(plan.bars).toEqual([{ bar: 1, startSec: 2, endSec: 4 }]);
  });
});

describe('planBars (Hear bar n)', () => {
  it('one bar of clicks, then the bar twice', () => {
    const plan = planBars(listenSourceOf(fourFour, cfg), facts(120), 2);
    expect(plan.clicks.map((c) => c.atSec)).toEqual([0, 0.5, 1, 1.5]);
    expect(plan.notes.map((n) => [n.concertMidi, n.startSec])).toEqual([
      [64, 2],
      [65, 3],
      [64, 4],
      [65, 5],
    ]);
    expect(plan.bars.map((b) => [b.bar, b.startSec, b.endSec])).toEqual([
      [2, 2, 4],
      [2, 4, 6],
    ]);
    near(plan.endSec, 6);
  });

  it('a tie over the end of the bars is cut at the end, so the repeat starts clean', () => {
    const tied = excerpt({ beats: 2, beatType: 4, countUnitTicks: Q, bars: [[{ p: 'C4', dur: Q }, { p: 'D4', dur: Q, tieStart: true }], [{ p: 'D4', dur: 2 * Q, tieStop: true }]] });
    const plan = planBars(listenSourceOf(tied, cfg), facts(60), 1);
    // Bar 1 is two seconds: D4 sounds from 1 s to the bar end, 1 s × 0.9.
    expect(plan.notes.map((n) => [n.concertMidi, n.startSec])).toEqual([
      [60, 2],
      [62, 3],
      [60, 4],
      [62, 5],
    ]);
    near(plan.notes[1]!.durSec, 0.9);
  });

  it('bars n to m', () => {
    const plan = planBars(listenSourceOf(fourFour, cfg), facts(120), 1, 2);
    expect(plan.notes).toHaveLength(8);
    near(plan.endSec, 2 + 2 * 4);
  });
});

describe('planClickBar and keyChordTones', () => {
  it('Hear the tempo: one bar at the set tempo, downbeat accented if on', () => {
    const bar = planClickBar(72, 3, true);
    expect(bar.clicks.map((c) => c.accent)).toEqual([true, false, false]);
    bar.clicks.forEach((c, k) => near(c.atSec, (k * 60) / 72));
    near(bar.endSec, 3 * (60 / 72));
    expect(planClickBar(90, 4, false).clicks.some((c) => c.accent)).toBe(false);
  });

  it('B♭ clarinet reading A major sounds G major, root at or below the first note', () => {
    // Written A major is concert G major; a written E5 sounds D5 (MIDI 74).
    const tones = keyChordTones({ fifths: 1, mode: 'major' }, 74, 440);
    expect(tones.map((t) => t.midi)).toEqual([67, 71, 74]);
    expect(tones[0]!.midi).toBeLessThanOrEqual(74);
    near(tones[0]!.hz, midiToFreq(67, 440));
    // The first note on the root itself keeps the root there.
    expect(keyChordTones({ fifths: 1, mode: 'major' }, 67, 440)[0]!.midi).toBe(67);
    // Minor: a minor third.
    expect(keyChordTones({ fifths: 0, mode: 'minor' }, 64, 440).map((t) => t.midi)).toEqual([57, 60, 64]);
  });

  it('asks for the whole Listen bus: the bus applies the −12 dBFS ceiling once (it used to be applied twice, −24 dBFS)', () => {
    expect(LISTEN.peak).toBe(1);
  });
});

describe('planRange ("Play my range", round 2)', () => {
  it('the notes in the order given, 0.8 s each with 0.15 s between, at the tuning pitch', () => {
    expect(RANGE).toEqual({ noteSec: 0.8, gapSec: 0.15 });
    const r = planRange([40, 45, 57, 64], 442);
    expect(r.notes.map((n) => [n.index, n.midi, n.atSec, n.durSec])).toEqual([
      [0, 40, 0, 0.8],
      [1, 45, expect.closeTo(0.95, 9), 0.8],
      [2, 57, expect.closeTo(1.9, 9), 0.8],
      [3, 64, expect.closeTo(2.85, 9), 0.8],
    ]);
    expect(r.notes[3]!.hz).toBeCloseTo(midiToFreq(64, 442), 9);
    expect(r.endSec).toBeCloseTo(3.65, 9);
  });
  it('other timings, no notes, and bad timings', () => {
    expect(planRange([60, 62], 440, { noteSec: 1.5, gapSec: 0 }).notes.map((n) => n.atSec)).toEqual([0, 1.5]);
    expect(planRange([], 440)).toEqual({ notes: [], endSec: 0 });
    expect(() => planRange([60], 440, { noteSec: 0 })).toThrow(RangeError);
    expect(() => planRange([60], 440, { gapSec: -1 })).toThrow(RangeError);
  });
});
