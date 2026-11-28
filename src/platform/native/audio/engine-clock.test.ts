import { describe, expect, it } from 'vitest';
import { EngineClock, syncHostClock } from './engine-clock.ts';

describe('EngineClock', () => {
  it('is 0 until it has an anchor and an offset, then follows the anchor at its rate', () => {
    let perf = 5000;
    const c = new EngineClock(() => perf);
    expect(c.now()).toBe(0);
    c.setAnchor({ engineSec: 10, hostMs: 1000, rate: 1 });
    expect(c.ready).toBe(false);
    expect(c.now()).toBe(0);
    c.setHostOffset(4000); // perf = host + 4000
    expect(c.ready).toBe(true);
    expect(c.now()).toBeCloseTo(10, 12);
    perf += 2500;
    expect(c.now()).toBeCloseTo(12.5, 12);
    c.setAnchor({ engineSec: 12.5, hostMs: 3500, rate: 0.5 });
    perf += 2000;
    expect(c.now()).toBeCloseTo(13.5, 12);
    expect(c.rate).toBe(0.5);
  });

  it('never goes backwards when a new anchor is behind, and starts again after reset', () => {
    let perf = 0;
    const c = new EngineClock(() => perf);
    c.setHostOffset(0);
    c.setAnchor({ engineSec: 0, hostMs: 0, rate: 1 });
    perf = 1000;
    expect(c.now()).toBeCloseTo(1, 12);
    c.setAnchor({ engineSec: 0.9, hostMs: 1000, rate: 1 });
    expect(c.now()).toBeCloseTo(1, 12);
    perf = 1200;
    expect(c.now()).toBeCloseTo(1.1, 12);
    c.reset();
    expect(c.now()).toBe(0);
    expect(c.rate).toBe(1);
  });
});

describe('syncHostClock', () => {
  it('keeps the sample with the shortest round trip, offset at the midpoint of the call', async () => {
    let perf = 100;
    const rtts = [10, 4, 2, 8];
    let i = 0;
    const s = await syncHostClock(
      async () => {
        const rtt = rtts[i++] as number;
        perf += rtt / 2;
        const r = { engineSec: i, hostMs: perf - 50 };
        perf += rtt / 2;
        return r;
      },
      () => perf,
      4,
    );
    expect(s.rttMs).toBe(2);
    expect(s.engineSec).toBe(3);
    expect(s.offsetMs).toBeCloseTo(50, 9);
  });
});
