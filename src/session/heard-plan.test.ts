// "Hear what we heard" (round 2, 01-ux.md §5.3): the pure re-synthesis plan and the score clock of a stored try.
import { describe, expect, it } from 'vitest';
import type { ClockSeconds } from '../core/types.ts';
import { midiToFreq } from '../theory/index.ts';
import { HEARD, planHeard, scoreZeroOf, type HeardNoteIn } from './heard-plan.ts';

const note = (onset: number, offset: number | null, midi: number, steadyMs = 300): HeardNoteIn => ({ onset: onset as ClockSeconds, offset: offset as ClockSeconds | null, midi, steadyMs });
// 4/4 at 60 bpm: a beat is a second, bar n starts at score second 4(n - 1). Score second 0 is clock 100.
const facts = { scoreZeroClock: 100, bpm: 60, beatsPerBar: 4, pickupBeats: 0, totalBars: 4, a4Hz: 440 };

describe('planHeard', () => {
  it('one note per detected note at its onset and pitch, from the first one; bars from the first to the last note', () => {
    const p = planHeard({ ...facts, detected: [note(105.2, 106, 62.3), note(100.02, 100.9, 60), note(108, null, 64, 450)] });
    expect(p.notes.map((n) => [n.startSec, n.durSec, n.bar])).toEqual([
      [0, expect.closeTo(0.88, 9), 1],
      [expect.closeTo(5.18, 9), expect.closeTo(0.8, 9), 2],
      [expect.closeTo(7.98, 9), 0.45, 3],
    ]);
    expect(p.notes[1]!.hz).toBeCloseTo(midiToFreq(62.3, 440), 9);
    expect(p.bars.map((b) => [b.bar, b.startSec])).toEqual([
      [1, expect.closeTo(-0.02, 9)],
      [2, expect.closeTo(3.98, 9)],
      [3, expect.closeTo(7.98, 9)],
    ]);
    expect(p.totalBars).toBe(4);
    expect(p.endSec).toBeCloseTo(8.43, 9);
  });

  it('leaves out notes before the music (the starting pitch, the count-in) and keeps note lengths in limits', () => {
    const p = planHeard({ ...facts, detected: [note(95, 96, 55), note(99.5, 99.52, 60), note(101, 120, 62)] });
    expect(p.notes).toHaveLength(2);
    expect(p.notes[0]!.durSec).toBe(HEARD.minNoteSec);
    expect(p.notes[1]!.durSec).toBe(HEARD.maxNoteSec);
    expect(p.notes[0]!.bar).toBe(1);
  });

  it('a pickup is bar 0, and a note past the end is in the last bar', () => {
    const p = planHeard({ ...facts, pickupBeats: 1, detected: [note(99, 99.8, 60), note(130, 131, 60)] });
    expect(p.notes.map((n) => n.bar)).toEqual([0, 4]);
    expect(p.bars.map((b) => b.bar)).toEqual([0, 1, 2, 3, 4]);
    expect(p.bars.at(-1)!.endSec).toBeGreaterThanOrEqual(p.endSec);
  });

  it('nothing heard: an empty plan; a bad tempo throws', () => {
    expect(planHeard({ ...facts, detected: [] })).toEqual({ notes: [], bars: [], totalBars: 4, endSec: 0 });
    expect(() => planHeard({ ...facts, bpm: 0, detected: [] })).toThrow(RangeError);
  });
});

describe('scoreZeroOf', () => {
  const detected = [
    { id: 1, onset: 100.05 as ClockSeconds },
    { id: 2, onset: 101.02 as ClockSeconds },
    { id: 3, onset: 102.5 as ClockSeconds },
  ];
  it('the median of the matched notes and the extras', () => {
    const z = scoreZeroOf({
      detected,
      judgments: [
        { expectedIdx: 0, detectedId: 1, timingErrorMs: 50 },
        { expectedIdx: 1, detectedId: 2, timingErrorMs: 20 },
        { expectedIdx: 2, detectedId: null, timingErrorMs: null },
      ],
      extras: [{ detectedId: 3, onsetSec: 2.5 as never }],
      expectedOnsetSec: [0, 1, 2],
    });
    expect(z).toBeCloseTo(100, 9);
  });
  it('without matches, the first detected note is the first written note; without notes, null', () => {
    expect(scoreZeroOf({ detected, judgments: [], extras: [], expectedOnsetSec: [0.5] })).toBeCloseTo(99.55, 9);
    expect(scoreZeroOf({ detected: [], judgments: [], extras: [], expectedOnsetSec: [0] })).toBeNull();
  });
});
