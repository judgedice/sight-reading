// Pure layout arithmetic for the static render: bar widths and the beat-to-x map (01 §5.8, 04 §4.2).
// No VexFlow and no DOM, so it is unit-tested directly.

import type { Beats, Meter, Ticks } from '../core/types.ts';

/**
 * Split `total` into widths proportional to `weights`, none below `min` (water filling: bars that would fall below
 * the minimum are pinned to it and the rest share what is left). If even the minimums do not fit, every bar gets
 * `total / n` and `fits` is false.
 */
export function distributeWidths(total: number, weights: readonly number[], min: number): { widths: number[]; fits: boolean } {
  const n = weights.length;
  if (n === 0) return { widths: [], fits: true };
  if (total < n * min) return { widths: new Array<number>(n).fill(total / n), fits: false };
  const w = weights.map((x) => (x > 0 ? x : 1));
  const pinned = new Array<boolean>(n).fill(false);
  const out = new Array<number>(n).fill(min);
  for (;;) {
    let free = total;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      if (pinned[i]) free -= min;
      else sum += w[i]!;
    }
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (pinned[i]) continue;
      const share = sum > 0 ? (free * w[i]!) / sum : free;
      if (share < min) {
        pinned[i] = true;
        changed = true;
      } else {
        out[i] = share;
      }
    }
    if (!changed) break;
  }
  for (let i = 0; i < n; i++) if (pinned[i]) out[i] = min;
  return { widths: out, fits: true };
}

/** One measure's horizontal anchors, in px within its system SVG. */
export interface MeasureAnchors {
  system: number;
  startTick: Ticks;
  /** Exclusive end tick (the next measure's start). */
  endTick: Ticks;
  /** x for the measure's start when no event sits exactly on it (the stave's first note position). */
  startX: number;
  /** x a note would take just before the closing barline. */
  endX: number;
  /** Event onsets in tick order with the x of their notehead (or rest) left edge. */
  points: { tick: Ticks; x: number }[];
}

/** Ticks from excerpt start for a score beat (beats from bar 1 beat 1; pickup beats are negative). */
export function beatToTick(scoreBeat: Beats, meter: Meter, pickupTicks: Ticks): number {
  return pickupTicks + scoreBeat * meter.countUnitTicks;
}

/** Score beat of an excerpt tick. */
export function tickToBeat(tick: Ticks, meter: Meter, pickupTicks: Ticks): Beats {
  return (tick - pickupTicks) / meter.countUnitTicks;
}

/**
 * Piecewise-linear, monotonic map from ticks to (system, x). Within a measure it interpolates between event onsets
 * (and the measure's start and end anchors); it is total: before the first measure it clamps to the first anchor,
 * past the last barline it extrapolates at the last measure's rate up to `maxX` of the last system.
 */
export class TickMap {
  private readonly measures: MeasureAnchors[];
  private readonly maxX: number;

  constructor(measures: readonly MeasureAnchors[], maxX: number) {
    if (measures.length === 0) throw new RangeError('TickMap needs at least one measure');
    this.maxX = maxX;
    this.measures = measures.map((m) => {
      // Normalise: strictly increasing ticks, non-decreasing x, start and end anchors included.
      const pts: { tick: number; x: number }[] = [];
      const add = (tick: number, x: number): void => {
        const last = pts[pts.length - 1];
        if (last && tick <= last.tick) return;
        pts.push({ tick, x: last ? Math.max(x, last.x) : x });
      };
      const sorted = m.points.slice().sort((a, b) => a.tick - b.tick);
      const first = sorted[0];
      if (!first || first.tick > m.startTick) add(m.startTick, Math.min(m.startX, first?.x ?? m.startX));
      for (const p of sorted) if (p.tick >= m.startTick && p.tick < m.endTick) add(p.tick, p.x);
      add(m.endTick, m.endX);
      return { ...m, points: pts };
    });
  }

  at(tick: number): { system: number; x: number } {
    const ms = this.measures;
    const first = ms[0]!;
    if (tick <= first.startTick) return { system: first.system, x: first.points[0]!.x };
    let m = ms[ms.length - 1]!;
    for (const cand of ms) {
      if (tick < cand.endTick) {
        m = cand;
        break;
      }
    }
    const pts = m.points;
    const lastPt = pts[pts.length - 1]!;
    if (tick >= lastPt.tick) {
      // Only reachable in the last measure: extrapolate at the final segment's rate.
      const prev = pts[pts.length - 2] ?? lastPt;
      const dt = lastPt.tick - prev.tick;
      const slope = dt > 0 ? (lastPt.x - prev.x) / dt : 0;
      return { system: m.system, x: Math.min(this.maxX, lastPt.x + (tick - lastPt.tick) * slope) };
    }
    for (let i = 1; i < pts.length; i++) {
      const b = pts[i]!;
      if (tick < b.tick) {
        const a = pts[i - 1]!;
        const f = (tick - a.tick) / (b.tick - a.tick);
        return { system: m.system, x: a.x + f * (b.x - a.x) };
      }
    }
    return { system: m.system, x: lastPt.x };
  }
}
