import { describe, expect, it } from 'vitest';
import { makeMeter } from '../core/time.ts';
import { TickMap, beatToTick, distributeWidths, tickToBeat } from './layout.ts';

describe('distributeWidths', () => {
  it('is proportional when every share is above the minimum', () => {
    const { widths, fits } = distributeWidths(1000, [1, 3], 100);
    expect(fits).toBe(true);
    expect(widths).toEqual([250, 750]);
  });

  it('pins small bars to the minimum and shares the rest', () => {
    const { widths } = distributeWidths(1000, [1, 10, 10], 140);
    expect(widths[0]).toBe(140);
    expect(widths[1]).toBeCloseTo(430);
    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(1000);
  });

  it('squeezes evenly when the minimums do not fit', () => {
    const { widths, fits } = distributeWidths(200, [1, 5, 9], 140);
    expect(fits).toBe(false);
    expect(widths).toEqual([200 / 3, 200 / 3, 200 / 3]);
  });

  it('treats empty bars as weight 1', () => {
    expect(distributeWidths(300, [0, 0, 0], 10).widths).toEqual([100, 100, 100]);
  });
});

describe('beat and tick conversion', () => {
  it('uses the metronome beat and the pickup', () => {
    const m68 = makeMeter(6, 8);
    expect(beatToTick(0, m68, 240)).toBe(240);
    expect(beatToTick(-1 / 3, m68, 240)).toBe(0);
    expect(beatToTick(1, m68, 0)).toBe(720);
    expect(tickToBeat(1680, makeMeter(2, 2), 0)).toBeCloseTo(1.75);
  });
});

describe('TickMap', () => {
  const map = new TickMap(
    [
      { system: 0, startTick: 0, endTick: 480, startX: 50, endX: 90, points: [{ tick: 0, x: 60 }] },
      { system: 0, startTick: 480, endTick: 2400, startX: 100, endX: 300, points: [{ tick: 480, x: 110 }, { tick: 1440, x: 200 }] },
      { system: 1, startTick: 2400, endTick: 4320, startX: 80, endX: 280, points: [{ tick: 2400, x: 90 }, { tick: 3360, x: 180 }] },
    ],
    400,
  );

  it('hits the anchors exactly', () => {
    expect(map.at(0)).toEqual({ system: 0, x: 60 });
    expect(map.at(1440)).toEqual({ system: 0, x: 200 });
    expect(map.at(2400)).toEqual({ system: 1, x: 90 });
  });

  it('interpolates inside a measure, up to its end anchor', () => {
    expect(map.at(960).x).toBeCloseTo(155);
    expect(map.at(1920).x).toBeCloseTo(250);
  });

  it('is total: clamps before the start, extrapolates past the end up to maxX', () => {
    expect(map.at(-5000)).toEqual({ system: 0, x: 60 });
    expect(map.at(4320 + 960).system).toBe(1);
    expect(map.at(4320 + 960).x).toBeGreaterThan(280);
    expect(map.at(1e9).x).toBe(400);
  });

  it('is monotonic in (system, x)', () => {
    let prev = map.at(-100);
    for (let t = -100; t < 6000; t += 7) {
      const cur = map.at(t);
      expect(cur.system > prev.system || (cur.system === prev.system && cur.x >= prev.x - 1e-9), `t=${t}`).toBe(true);
      prev = cur;
    }
  });
});
