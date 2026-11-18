import { describe, expect, it } from 'vitest';
import {
  beatsToScoreSeconds,
  beatsToTicks,
  makeMeter,
  scoreSecondsToBeats,
  ticksPerBar,
  ticksToBeats,
  ticksToScoreSeconds,
} from './time.ts';
import { TPQ } from './types.ts';

// [beats, beatType, countUnitTicks, countsPerBar, pickup ticks (one count unit), bpm]
const cases: [number, 2 | 4 | 8, number, number][] = [
  [2, 4, 480, 2],
  [3, 4, 480, 3],
  [4, 4, 480, 4],
  [6, 8, 720, 2],
  [2, 2, 960, 2],
  [3, 8, 240, 3],
];

describe('time', () => {
  it('uses TPQ = 480', () => expect(TPQ).toBe(480));

  it.each(cases)('meter %i/%i has the 02 beat convention', (beats, beatType, unit, counts) => {
    const m = makeMeter(beats, beatType);
    expect(m.countUnitTicks).toBe(unit);
    expect(m.countsPerBar).toBe(counts);
    expect(ticksPerBar(m)).toBe(beats * ((TPQ * 4) / beatType));
  });

  it('counts 9/8, 12/8 dotted and 5/8, 7/8, 3/2 plain', () => {
    expect(makeMeter(9, 8)).toMatchObject({ countUnitTicks: 720, countsPerBar: 3 });
    expect(makeMeter(12, 8)).toMatchObject({ countsPerBar: 4 });
    expect(makeMeter(5, 8)).toMatchObject({ countUnitTicks: 240, countsPerBar: 5 });
    expect(makeMeter(7, 8)).toMatchObject({ countUnitTicks: 240, countsPerBar: 7 });
    expect(makeMeter(3, 2)).toMatchObject({ countUnitTicks: 960, countsPerBar: 3 });
  });

  describe.each(cases)('%i/%i round trips with pickups', (beats, beatType) => {
    const m = makeMeter(beats, beatType);
    // none, one count unit, a fraction of a unit, and a bar minus a unit
    const pickups = [0, m.countUnitTicks, m.countUnitTicks / 2, ticksPerBar(m) - m.countUnitTicks];
    it.each(pickups)('pickup %f ticks', (pickup) => {
      for (const bpm of [40, 60, 72, 120, 200]) {
        for (let t = 0; t <= pickup + 4 * ticksPerBar(m); t += 15) {
          const b = ticksToBeats(t, m, pickup);
          expect(beatsToTicks(b, m, pickup)).toBeCloseTo(t, 9);
          const s = beatsToScoreSeconds(b, bpm);
          expect(scoreSecondsToBeats(s, bpm)).toBeCloseTo(b, 12);
          expect(ticksToScoreSeconds(t, m, pickup, bpm)).toBe(s);
        }
      }
      // pickup start is negative beats; bar 1 beat 1 is exactly 0
      expect(ticksToBeats(0, m, pickup)).toBe(pickup === 0 ? 0 : -pickup / m.countUnitTicks);
      expect(ticksToBeats(pickup, m, pickup)).toBe(0);
      expect(ticksToBeats(pickup + ticksPerBar(m), m, pickup)).toBe(m.countsPerBar);
    });
  });

  it('gives exact values', () => {
    const m = makeMeter(6, 8);
    expect(ticksToBeats(720, m, 0)).toBe(1);
    expect(ticksToBeats(1080, m, 720)).toBeCloseTo(0.5, 12);
    expect(beatsToScoreSeconds(4, 120)).toBe(2);
    expect(beatsToScoreSeconds(-1, 60)).toBe(-1);
    // 6/8 at dotted quarter = 60: one bar (2 beats) is 2 s
    expect(beatsToScoreSeconds(ticksToBeats(1440, m, 0), 60)).toBe(2);
  });
});
