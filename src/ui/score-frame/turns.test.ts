// D3: page-turn timing from the playhead (04 §4.3), spans, wrap bar and frozen scale (04 §4.4).
import { describe, expect, it } from 'vitest';
import type { PreparedExcerpt } from '../../core/types.ts';
import { planSwaps } from '../layout-table.ts';
import { frozenScale, orientationChanged, slotsAtBeat, systemAtBeat, systemDurationsMs, systemSpans, timeSwaps, wrapSlot, type SystemSpan } from './turns.ts';

/** A bare excerpt: `bars` full bars of `countsPerBar` quarter beats, optionally with a pickup of `pickupBeats`. */
function excerpt(bars: number, countsPerBar: number, pickupBeats = 0): PreparedExcerpt {
  const unit = 480;
  const pickupTicks = pickupBeats * unit;
  const measures: PreparedExcerpt['measures'] = [];
  if (pickupTicks > 0) measures.push({ index: 0, isPickup: true, startTick: 0, displayBar: 0, events: [] });
  for (let i = 0; i < bars; i++) {
    measures.push({ index: measures.length, isPickup: false, startTick: pickupTicks + i * countsPerBar * unit, displayBar: i + 1, events: [] });
  }
  return {
    meter: { beats: countsPerBar, beatType: 4, countUnitTicks: unit, countsPerBar },
    pickupTicks,
    measures,
  } as unknown as PreparedExcerpt;
}

/** Uniform spans: N systems of `beats` beats each from beat 0. */
const uniform = (n: number, beats: number): SystemSpan[] => Array.from({ length: n }, (_, i) => ({ startBeat: i * beats, beats }));

describe('systemSpans', () => {
  it('splits bars into systems in score beats', () => {
    expect(systemSpans(excerpt(12, 4), [2, 2, 2, 2, 2, 2])).toEqual(uniform(6, 8));
    expect(systemSpans(excerpt(10, 3), [4, 3, 3])).toEqual([
      { startBeat: 0, beats: 12 },
      { startBeat: 12, beats: 9 },
      { startBeat: 21, beats: 9 },
    ]);
  });

  it('counts the pickup as a bar of its own length, starting at a negative beat', () => {
    expect(systemSpans(excerpt(8, 3, 1), [3, 3, 3])).toEqual([
      { startBeat: -1, beats: 7 },
      { startBeat: 6, beats: 9 },
      { startBeat: 15, beats: 9 },
    ]);
  });

  it('gives planSwaps its durations at the take tempo', () => {
    expect(systemDurationsMs(uniform(3, 8), 120)).toEqual([4000, 4000, 4000]);
    expect(() => systemDurationsMs(uniform(1, 8), 0)).toThrow(RangeError);
  });
});

describe('04 §4.3 worked cases, driven by the playhead', () => {
  // 12 bars, 2 per system (xs), 4/4 at 120 bpm: a system lasts 4 s = 8 beats; 400 ms = 0.8 beat.
  const spans = uniform(6, 8);
  const bpm = 120;
  const plan = (v: number) => planSwaps(6, v, systemDurationsMs(spans, bpm));

  it('v = 5: one swap 400 ms after entering system 3 (slot 1 becomes system 6)', () => {
    const p = plan(5);
    const t = timeSwaps(p, spans, bpm);
    expect(t).toEqual([{ slot: 0, newSystem: 5, dueBeat: 16.8 }]);
    expect(slotsAtBeat(p, t, null)).toEqual([0, 1, 2, 3, 4]);
    expect(slotsAtBeat(p, t, 16.79)).toEqual([0, 1, 2, 3, 4]);
    expect(slotsAtBeat(p, t, 16.8)).toEqual([5, 1, 2, 3, 4]);
    expect(slotsAtBeat(p, t, 47)).toEqual([5, 1, 2, 3, 4]);
  });

  it('v = 4: entering 3, slot 1 → 5; entering 4, slot 2 → 6', () => {
    const p = plan(4);
    const t = timeSwaps(p, spans, bpm);
    expect(t.map((s) => [s.slot, s.newSystem, s.dueBeat])).toEqual([
      [0, 4, 16.8],
      [1, 5, 24.8],
    ]);
    expect(slotsAtBeat(p, t, 16)).toEqual([0, 1, 2, 3]);
    expect(slotsAtBeat(p, t, 17)).toEqual([4, 1, 2, 3]);
    expect(slotsAtBeat(p, t, 25)).toEqual([4, 5, 2, 3]);
  });

  it('v = 2 with 3 systems: one swap 400 ms after entering system 2', () => {
    const s3 = uniform(3, 16);
    const p = planSwaps(3, 2, systemDurationsMs(s3, bpm));
    const t = timeSwaps(p, s3, bpm);
    expect(t).toEqual([{ slot: 0, newSystem: 2, dueBeat: 16.8 }]);
    expect(slotsAtBeat(p, t, 16.5)).toEqual([0, 1]);
    expect(slotsAtBeat(p, t, 16.8)).toEqual([2, 1]);
  });

  it('v = 1: the single slot turns at 75% of the current system', () => {
    const s3 = uniform(3, 8);
    const p = planSwaps(3, 1, systemDurationsMs(s3, bpm));
    const t = timeSwaps(p, s3, bpm);
    expect(t.map((s) => s.dueBeat)).toEqual([6, 14]);
    expect(slotsAtBeat(p, t, 5.9)).toEqual([0]);
    expect(slotsAtBeat(p, t, 6)).toEqual([1]);
    expect(slotsAtBeat(p, t, 14)).toEqual([2]);
  });

  it('no turns when the systems fit (lg, 12 bars in 3 systems, v = 4)', () => {
    const s3 = uniform(3, 16);
    const p = planSwaps(3, 4, systemDurationsMs(s3, bpm));
    expect(p.turns).toBe(false);
    expect(slotsAtBeat(p, timeSwaps(p, s3, bpm), 40)).toEqual([0, 1, 2]);
  });

  it('a short system bounds the delay at 50% of its duration', () => {
    // 1 beat per system at 240 bpm = 250 ms: the swap comes 125 ms (0.5 beat) after entry.
    const s = uniform(6, 1);
    const p = planSwaps(6, 4, systemDurationsMs(s, 240));
    expect(timeSwaps(p, s, 240)[0]).toEqual({ slot: 0, newSystem: 4, dueBeat: 2.5 });
  });

  it('the current system is always on screen and only replaced slots change', () => {
    for (const v of [2, 3, 4, 5]) {
      const p = plan(v);
      const t = timeSwaps(p, spans, bpm);
      let prev = slotsAtBeat(p, t, null);
      for (let b = 0; b < 48; b += 0.1) {
        const cur = slotsAtBeat(p, t, b);
        expect(cur).toContain(systemAtBeat(spans, b));
        const changed = cur.filter((x, i) => x !== prev[i]).length;
        expect(changed).toBeLessThanOrEqual(1);
        prev = cur;
      }
    }
  });
});

describe('systemAtBeat and wrapSlot', () => {
  it('finds the system of a beat, clamped', () => {
    const s = uniform(3, 8);
    expect(systemAtBeat(s, -2)).toBe(0);
    expect(systemAtBeat(s, 7.99)).toBe(0);
    expect(systemAtBeat(s, 8)).toBe(1);
    expect(systemAtBeat(s, 99)).toBe(2);
  });

  it('marks the slot of the next system only when it is not directly below', () => {
    expect(wrapSlot([0, 1, 2, 3], 1)).toBeNull();
    expect(wrapSlot([4, 1, 2, 3], 3)).toBe(0);
    expect(wrapSlot([4, 5, 2, 3], 3)).toBe(0);
    expect(wrapSlot([4, 5, 2, 3], 4)).toBeNull();
    expect(wrapSlot([2, 1], 1)).toBe(0);
    expect(wrapSlot([0, 1, 2], 2)).toBeNull();
  });

  it('agrees with planSwaps wrapMarker once the swaps for a system are done', () => {
    const spans = uniform(6, 8);
    for (const v of [2, 3, 4, 5]) {
      const p = planSwaps(6, v, systemDurationsMs(spans, 120));
      const t = timeSwaps(p, spans, 120);
      for (let s = 0; s < 5; s++) {
        const settled = slotsAtBeat(p, t, spans[s]!.startBeat + 7.9);
        expect(wrapSlot(settled, s) !== null).toBe(p.wrapMarker[s]);
      }
    }
  });
});

describe('frozen scale (04 §4.4)', () => {
  it('is min(newW / oldW, newH / oldH)', () => {
    expect(frozenScale({ width: 400, height: 800 }, { width: 400, height: 700 })).toBeCloseTo(0.875);
    expect(frozenScale({ width: 400, height: 800 }, { width: 300, height: 800 })).toBeCloseTo(0.75);
    expect(frozenScale({ width: 400, height: 800 }, { width: 800, height: 400 })).toBeCloseTo(0.5);
    expect(frozenScale({ width: 400, height: 800 }, { width: 500, height: 1000 })).toBeCloseTo(1.25);
    expect(frozenScale({ width: 0, height: 800 }, { width: 500, height: 1000 })).toBe(1);
  });

  it('detects a rotation', () => {
    expect(orientationChanged({ width: 390, height: 844 }, { width: 844, height: 390 })).toBe(true);
    expect(orientationChanged({ width: 390, height: 844 }, { width: 390, height: 700 })).toBe(false);
  });
});
