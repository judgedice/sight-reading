import { describe, expect, it } from 'vitest';
import { cleanSamples, fitClockWindow, type ClockSample } from './clock-fit.ts';

/** Samples every `everyMs` over `spanMs` of a clock running at `1 + err`, with uniform jitter of ±`jitterMs` on the context side. */
function line(err: number, o: { spanMs?: number; everyMs?: number; jitterMs?: number; seed?: number } = {}): ClockSample[] {
  let seed = o.seed ?? 1;
  const rnd = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
  const out: ClockSample[] = [];
  for (let t = 0; t <= (o.spanMs ?? 2000); t += o.everyMs ?? 20) out.push({ wallMs: 1e6 + t, ctxSec: 3 + ((t / 1000) * (1 + err)) + ((o.jitterMs ?? 0) * rnd()) / 1000 });
  return out;
}

describe('fitClockWindow (01 §7.8)', () => {
  it('measures an exact clock with millisecond scatter to a few hundredths of a percent', () => {
    const f = fitClockWindow(line(0, { jitterMs: 1 }), { windowMs: 2000 });
    expect(f.consistent).toBe(true);
    expect(Math.abs(f.error)).toBeLessThan(0.0005);
    expect(f.subErrors).toHaveLength(4);
  });

  it('measures a wrong clock as wrong, consistently', () => {
    for (const err of [0.088, -0.0812, -0.037]) {
      const f = fitClockWindow(line(err, { jitterMs: 1 }), { windowMs: 2000 });
      expect(f.consistent).toBe(true);
      expect(Math.abs(f.error - err)).toBeLessThan(0.0005);
    }
  });

  it('rejects a window with a step (a render stall) as inconsistent', () => {
    const s = line(0).map((p) => (p.wallMs - 1e6 > 1200 ? { ...p, ctxSec: p.ctxSec - 0.056 } : p));
    const f = fitClockWindow(s, { windowMs: 2000 });
    expect(f.consistent).toBe(false);
    expect(f.reason).toBe('disagree');
    // The whole-window slope alone would have read about -3.5%.
    expect(f.error).toBeLessThan(-0.02);
  });

  it('needs enough samples spread over the window', () => {
    expect(fitClockWindow(line(0).slice(0, 10), { windowMs: 2000 }).reason).toBe('too-few-samples');
    expect(fitClockWindow(line(0, { spanMs: 1000 }), { windowMs: 2000 }).reason).toBe('short-span');
    // A gap that empties one stretch.
    const gap = line(0).filter((p) => p.wallMs - 1e6 < 520 || p.wallMs - 1e6 >= 1000);
    expect(fitClockWindow(gap, { windowMs: 2000 }).reason).toBe('too-few-samples');
  });

  it('drops unchanged snapshots and out-of-order samples', () => {
    const s: ClockSample[] = [
      { wallMs: 10, ctxSec: 1 },
      { wallMs: 10, ctxSec: 1 },
      { wallMs: 30, ctxSec: 1.02 },
      { wallMs: 20, ctxSec: 1.01 },
      { wallMs: 40, ctxSec: 1.02 },
      { wallMs: NaN, ctxSec: 2 },
    ];
    expect(cleanSamples(s)).toEqual([
      { wallMs: 10, ctxSec: 1 },
      { wallMs: 20, ctxSec: 1.01 },
      { wallMs: 30, ctxSec: 1.02 },
    ]);
  });
});
