import { describe, expect, it } from 'vitest';
import {
  barsPerSystem,
  breakpointFor,
  LAYOUT_ROWS,
  lineRange,
  planLayout,
  planSwaps,
  resolveSlots,
  selectRow,
  slotCount,
  systemHeightPx,
  type LayoutRowId,
} from './layout-table.ts';

const row = (id: LayoutRowId) => LAYOUT_ROWS.find((r) => r.id === id)!;

describe('row selection', () => {
  it.each([
    [1440, 900, 'xl'],
    [1280, 720, 'lg'],
    [1024, 768, 'lg'],
    [1180, 760, 'lg'],
    [900, 700, 'md-land'],
    [768, 1024, 'md-port'],
    [768, 768, 'md-port'],
    [844, 340, 'sm-short'],
    [568, 499, 'sm-short'],
    [390, 660, 'xs'],
    [390, 844, 'xs'],
    [567, 300, 'xs'],
    [1100, 400, 'sm-short'],
  ] as const)('%i x %i -> %s', (w, h, id) => {
    expect(selectRow(w, h).id).toBe(id);
  });
  it('breakpoints', () => {
    expect(['xs', 'sm', 'md', 'lg', 'xl']).toEqual([567, 568, 768, 1024, 1440].map(breakpointFor).map((b, i) => (i === 0 ? 'xs' : b)));
  });
});

describe('system height', () => {
  it('matches 4.2', () => {
    expect(systemHeightPx(10)).toBe(152);
    expect(systemHeightPx(7.5)).toBe(122);
  });
});

describe('bars per system and system counts (4.2)', () => {
  const counts: [LayoutRowId, number, number][] = [
    ['xl', 8, 2], ['xl', 10, 2], ['xl', 12, 2],
    ['lg', 8, 2], ['lg', 10, 3], ['lg', 12, 3],
    ['md-land', 8, 2], ['md-land', 10, 3], ['md-land', 12, 3],
    ['md-port', 8, 3], ['md-port', 10, 4], ['md-port', 12, 4],
    ['sm-short', 8, 2], ['sm-short', 10, 3], ['sm-short', 12, 3],
    ['xs', 8, 4], ['xs', 10, 5], ['xs', 12, 6],
  ];
  it.each(counts)('%s with %i bars gives %i systems', (id, bars, systems) => {
    const b = barsPerSystem(row(id), bars);
    expect(b).toHaveLength(systems);
    expect(b.reduce((a, c) => a + c, 0)).toBe(bars);
  });
  it('extra bars go to the earlier systems', () => {
    expect(barsPerSystem(row('lg'), 10)).toEqual([4, 3, 3]);
    expect(barsPerSystem(row('md-port'), 8)).toEqual([3, 3, 2]);
    expect(barsPerSystem(row('md-port'), 10)).toEqual([3, 3, 2, 2]);
    expect(barsPerSystem(row('xl'), 9)).toEqual([5, 4]);
  });
  it('xl: max 6 bars, ceil(N/3) when the average exceeds 9 tickables', () => {
    expect(barsPerSystem(row('xl'), 12)).toEqual([6, 6]);
    expect(barsPerSystem(row('xl'), 12, new Array(12).fill(10))).toEqual([4, 4, 4]);
    expect(barsPerSystem(row('xl'), 12, new Array(12).fill(9))).toEqual([6, 6]);
    expect(barsPerSystem(row('xl'), 14).every((n) => n <= 6)).toBe(true);
  });
  it('xs: a bar with more than 8 tickables gets a system to itself', () => {
    const t = [4, 4, 9, 4, 4, 4, 4, 4];
    expect(barsPerSystem(row('xs'), 8, t)).toEqual([2, 1, 2, 2, 1]);
    expect(barsPerSystem(row('xs'), 8, [8, 8, 8, 8, 8, 8, 8, 8])).toEqual([2, 2, 2, 2]);
    expect(barsPerSystem(row('xs'), 4, [9, 9, 9, 9])).toEqual([1, 1, 1, 1]);
  });
  it('zero bars', () => {
    expect(barsPerSystem(row('lg'), 0)).toEqual([]);
  });
});

describe('slotCount: worked cases of 4.3', () => {
  it.each([
    ['390 x 844 home-screen app', 844, 47, 34, 'xs', 5],
    ['390 x 660 Safari tab', 660, 0, 34, 'xs', 4],
    ['844 x 340 Safari landscape', 340, 0, 21, 'sm-short', 2],
    ['1180 x 760 iPad landscape', 760, 0, 0, 'lg', 4],
    ['1024 x 1366 iPad portrait', 1366, 0, 0, 'lg', 6],
  ] as const)('%s', (_n, h, top, bottom, id, v) => {
    expect(slotCount(h, { top, bottom }, row(id))).toBe(v);
  });
  it('steps sp down to the minimum when fewer than 2 slots fit, then clamps to at least 1', () => {
    // sm-short at 7.5: 122 px; avail 200 -> 1 slot; at 7 sp: 84 + 32 = 116 -> still 1; avail 240 -> 1 at 7.5, 2 at 7.
    expect(resolveSlots(284, { top: 0, bottom: 0 }, row('sm-short'))).toEqual({ spPx: 7, slots: 2 });
    expect(resolveSlots(100, { top: 0, bottom: 0 }, row('sm-short')).slots).toBe(1);
    expect(resolveSlots(844, { top: 0, bottom: 0 }, row('xs')).spPx).toBe(7.5);
  });
  it('planLayout ties it together', () => {
    const p = planLayout({ width: 1180, height: 760 }, { top: 0, bottom: 0 }, 12);
    expect(p.row.id).toBe('lg');
    expect(p.barsPerSystem).toEqual([4, 4, 4]);
    expect(p.slots).toBe(4);
    expect(p.renderOptions).toEqual({ widthPx: 1180, barsPerSystem: [4, 4, 4], spPx: 10 });
  });
});

const dur = (n: number, ms = 8000) => new Array<number>(n).fill(ms);
// Convert a plan to 1-based "entering system s: slot i -> system j" for comparison with the spec prose.
const flat = (p: ReturnType<typeof planSwaps>) => p.swaps.map((s) => [s.trigger.system + 1, s.slot + 1, s.newSystem + 1]);

describe('planSwaps: worked cases of 4.3 (12 bars)', () => {
  it('N <= v: nothing turns', () => {
    const p = planSwaps(3, 4, dur(3));
    expect(p.turns).toBe(false);
    expect(p.swaps).toEqual([]);
    expect(p.initialSlots).toEqual([0, 1, 2]);
    expect(p.wrapMarker).toEqual([false, false, false]);
  });
  it('v = 5, 6 systems: one swap, entering system 3 slot 1 becomes system 6', () => {
    const p = planSwaps(6, 5, dur(6));
    expect(flat(p)).toEqual([[3, 1, 6]]);
  });
  it('v = 4, 6 systems: two swaps (entering 3, slot 1 -> 5; entering 4, slot 2 -> 6)', () => {
    expect(flat(planSwaps(6, 4, dur(6)))).toEqual([[3, 1, 5], [4, 2, 6]]);
  });
  it('v = 2, 3 systems: one swap 400 ms after entering system 2', () => {
    const p = planSwaps(3, 2, dur(3));
    expect(flat(p)).toEqual([[2, 1, 3]]);
    expect(p.swaps[0]!.trigger.delayMs).toBe(400);
  });
  it('v = 1: the single slot turns at 75% of the current system', () => {
    const p = planSwaps(3, 1, [4000, 8000, 2000]);
    expect(p.swaps.map((s) => [s.trigger.system, s.trigger.delayMs, s.slot, s.newSystem])).toEqual([[0, 3000, 0, 1], [1, 6000, 0, 2]]);
  });
  it('delay is min(400 ms, 50% of the system duration)', () => {
    expect(planSwaps(3, 2, [8000, 600, 8000]).swaps[0]!.trigger.delayMs).toBe(300);
    expect(planSwaps(3, 2, [8000, 8000, 8000]).swaps[0]!.trigger.delayMs).toBe(400);
  });
  it('the current system never moves and each system is shown once per slot move', () => {
    for (const N of [3, 4, 5, 6, 8])
      for (const v of [1, 2, 3, 4, 5, 6]) {
        const p = planSwaps(N, v, dur(N));
        const state = p.initialSlots.slice();
        const seen = new Set(state);
        for (const sw of p.swaps) {
          if (v > 1) expect(state[sw.slot]).toBeLessThan(sw.trigger.system);
          if (v > 1) expect(state[sw.slot]).not.toBe(sw.trigger.system);
          expect(seen.has(sw.newSystem)).toBe(false);
          state[sw.slot] = sw.newSystem;
          seen.add(sw.newSystem);
        }
        if (v > 1) expect(seen.size).toBe(N);
        // With v >= 3 the next system is in a slot by the time the current one is entered (and swaps done).
      }
  });
  it('wrap marker: set when the next system is not in the slot directly below', () => {
    const p = planSwaps(6, 5, dur(6));
    // Entering 3 swaps slot 1 to system 6; for system 2 the next system 3 is directly below (slot 3).
    expect(p.wrapMarker[1]).toBe(false);
    // System 5 (index 4, slot 5) is followed by system 6 in slot 1: wrap.
    expect(p.wrapMarker[4]).toBe(true);
    expect(p.wrapMarker[5]).toBe(false);
    const q = planSwaps(6, 4, dur(6));
    // Entering 3: slot 1 -> 5. System 4 (slot 4) is followed by 5 (slot 1): wrap.
    expect(q.wrapMarker[3]).toBe(true);
  });
  it('lineRange', () => {
    expect(lineRange([5, 1, 2, 3, 4])).toEqual({ first: 2, last: 6 });
  });
});
