import { describe, expect, it } from 'vitest';
import { configs } from '../../fixtures/follow/gen/io.ts';
import { RefVoiceDrift } from '../../fixtures/follow/gen/reference.ts';
import { createRng } from '../core/rng.ts';
import type { Configs } from '../core/types.ts';
import { classifyPitch } from './pitch-policy.ts';
import { VoiceDriftReference } from './voice-drift.ts';

const cfg = configs();

const feed = (r: VoiceDriftReference, devs: number[]): number[] =>
  devs.map((d) => {
    r.observe(d, true);
    return r.offsetCents();
  });

describe('VoiceDriftReference (02 §4.5)', () => {
  it('starts at 0', () => {
    expect(new VoiceDriftReference(cfg).offsetCents()).toBe(0);
  });

  it('acceptance case 7: a singer uniformly 30 c flat reaches −30 c after two notes (15 c per note)', () => {
    expect(feed(new VoiceDriftReference(cfg), [-30, -30, -30, -30, -30])).toEqual([-15, -30, -30, -30, -30]);
  });

  it('rate-limits the change to 15 c per note', () => {
    const r = new VoiceDriftReference(cfg);
    const seq = feed(r, [45, 45, 45, 45, 45]);
    expect(seq).toEqual([15, 30, 45, 45, 45]);
    for (let i = 1; i < seq.length; i++) expect(Math.abs(seq[i]! - seq[i - 1]!)).toBeLessThanOrEqual(15);
  });

  it('clamps the offset to ±50 c from 0', () => {
    expect(feed(new VoiceDriftReference(cfg), [80, 80, 80, 80, 80, 80]).at(-1)).toBe(50);
    expect(feed(new VoiceDriftReference(cfg), [-200, -200, -200, -200, -200, -200]).at(-1)).toBe(-50);
  });

  it('follows the median of the last 4 correct notes', () => {
    const r = new VoiceDriftReference(cfg);
    // After [0, 0, 10, 10] the median is 5; offset moves toward it.
    feed(r, [0, 0, 10, 10]);
    expect(r.offsetCents()).toBe(5);
    // Window slides: [0, 10, 10, 10] → 10.
    r.observe(10, true);
    expect(r.offsetCents()).toBe(10);
    // An outlier among 4 moves the median only part-way: [10, 10, 10, 40] → 10.
    r.observe(40, true);
    expect(r.offsetCents()).toBe(10);
  });

  it('ignores incorrectly pitched notes and non-finite deviations', () => {
    const r = new VoiceDriftReference(cfg);
    r.observe(-30, true);
    r.observe(300, false);
    r.observe(Number.NaN, true);
    r.observe(Number.POSITIVE_INFINITY, true);
    expect(r.offsetCents()).toBe(-15);
  });

  it('reads its window, clamp and step from config', () => {
    const v = { ...cfg.grading.voice, driftWindowNotes: 1, maxOffsetCents: 20, maxStepCents: 100 };
    const c = { ...cfg, grading: { ...cfg.grading, voice: v } } as Configs;
    const r = new VoiceDriftReference(c);
    expect(feed(r, [-10, 30, 5])).toEqual([-10, 20, 5]);
  });

  it('rejects a window under one note', () => {
    const c = { ...cfg, grading: { ...cfg.grading, voice: { ...cfg.grading.voice, driftWindowNotes: 0 } } } as Configs;
    expect(() => new VoiceDriftReference(c)).toThrow(RangeError);
  });

  it('matches the fixture generator reference on 2,000 random sequences', () => {
    const rng = createRng(20261118);
    for (let s = 0; s < 2000; s++) {
      const a = new VoiceDriftReference(cfg);
      const b = new RefVoiceDrift(cfg);
      for (let k = 0; k < 20; k++) {
        const dev = rng.next() * 160 - 80;
        const ok = rng.next() < 0.8;
        a.observe(dev, ok);
        b.observe(dev, ok);
        expect(a.offsetCents()).toBe(b.offsetCents());
        expect(Math.abs(a.offsetCents())).toBeLessThanOrEqual(cfg.grading.voice.maxOffsetCents);
      }
    }
  });

  it('with classifyPitch, a singer 30 c flat is in tune from the third note on (case 7 shape)', () => {
    const voice = cfg.instrumentById['voice-soprano']!;
    const r = new VoiceDriftReference(cfg);
    const devs: number[] = [];
    for (let i = 0; i < 10; i++) {
      const target = 67 + (i % 5);
      const c = classifyPitch(target, target - 0.3, r.offsetCents(), voice, cfg);
      devs.push(c.devCents);
      r.observe(c.rawDevCents, c.p === 1);
    }
    expect(devs[0]).toBeCloseTo(-30, 9);
    expect(devs[1]).toBeCloseTo(-15, 9);
    for (const d of devs.slice(2)) expect(d).toBeCloseTo(0, 9);
  });
});
