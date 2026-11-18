import { describe, expect, it } from 'vitest';
import type { TakeSchedule } from '../../../core/platform.ts';
import { clickBurst } from '../../../testkit/synth-min.ts';
import { Metronome, planTakeClicks, renderClick, takeT0 } from './metronome.ts';
import type { FakeBufferSource } from './testing/fake-web-audio.ts';
import { FakeAudioWorld } from './testing/fake-web-audio.ts';

const take = (over: Partial<TakeSchedule> = {}): TakeSchedule => ({
  leadSec: 0.5, bpm: 96, beatsPerBar: 4, countInBeats: 4, totalBeats: 32, mode: 'audible', timbre: 'tick', accentDb: 5, ...over,
});

/** Energy fraction below `hz` of a burst, by DFT over the burst. */
function lowEnergyFrac(x: Float32Array, rate: number, hz: number): number {
  const n = 4096;
  let low = 0;
  let all = 0;
  for (let k = 1; k < n / 2; k++) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < x.length; i++) {
      const a = (-2 * Math.PI * k * i) / n;
      re += (x[i] as number) * Math.cos(a);
      im += (x[i] as number) * Math.sin(a);
    }
    const p = re * re + im * im;
    all += p;
    if ((k * rate) / n < hz) low += p;
  }
  return low / all;
}

describe('renderClick', () => {
  for (const rate of [48000, 44100]) {
    for (const timbre of ['tick', 'wood'] as const) {
      for (const accent of [false, true]) {
        it(`equals the testkit clickBurst (${timbre}, accent ${accent}, ${rate} Hz)`, () => {
          expect(Array.from(renderClick(timbre, accent, rate))).toEqual(Array.from(clickBurst(timbre, accent, rate)));
        });
      }
    }
  }

  it('has the spec lengths: Tick 12 ms (accent 18 ms), Wood 8 ms', () => {
    expect(renderClick('tick', false, 48000).length).toBe(576);
    expect(renderClick('tick', true, 48000).length).toBe(864);
    expect(renderClick('wood', false, 48000).length).toBe(384);
  });

  it('has no tonal content below 1 kHz (01 §7.6)', () => {
    expect(lowEnergyFrac(renderClick('tick', false, 48000), 48000, 1000)).toBeLessThan(0.01);
    expect(lowEnergyFrac(renderClick('wood', false, 48000), 48000, 1000)).toBeLessThan(0.05);
  });

  it('drops partials above Nyquist at a 16 kHz route instead of aliasing them', () => {
    const x = renderClick('tick', false, 16000);
    expect(x.length).toBe(192);
    expect(Array.from(x).every(Number.isFinite)).toBe(true);
    expect(Math.max(...Array.from(x).map(Math.abs))).toBeCloseTo(1, 6);
    expect(lowEnergyFrac(x, 16000, 1000)).toBeLessThan(0.01);
  });
});

describe('planTakeClicks', () => {
  it('places beat i at t0 + (i - countIn) × beat with downbeat accents', () => {
    const p = take();
    const clicks = planTakeClicks(p, 20);
    expect(clicks).toHaveLength(36);
    clicks.forEach((c, i) => {
      expect(c.beatIndex).toBe(i);
      expect(c.t).toBeCloseTo(20 + ((i - 4) * 60) / 96, 12);
      expect(c.accent).toBe(i % 4 === 0);
      expect(c.countIn).toBe(i < 4);
    });
  });

  it('stops after the count-in in countInOnly mode and rounds partial beats up', () => {
    expect(planTakeClicks(take({ mode: 'countInOnly' }), 5)).toHaveLength(4);
    expect(planTakeClicks(take({ totalBeats: 30.5 }), 5)).toHaveLength(4 + 31);
  });

  it('enforces the 0.5 s minimum lead (01 §7.1)', () => {
    expect(takeT0(take({ leadSec: 0.1 }), 10)).toBeCloseTo(10 + 0.5 + 4 * 0.625, 12);
    expect(takeT0(take({ leadSec: 1 }), 10)).toBeCloseTo(10 + 1 + 4 * 0.625, 12);
  });
});

describe('Metronome', () => {
  it('schedules every click as its own buffer source at Start, with no timers, unaffected by a 200 ms stall (W9)', () => {
    const world = new FakeAudioWorld();
    const ctx = world.deps.createContext({ latencyHint: 'interactive' });
    const bus = ctx.createGain();
    const m = new Metronome(ctx, bus);
    const timersBefore = world.pendingTimers();
    const { t0, clicks } = m.scheduleTake(take({ bpm: 132, totalBeats: 12 * 12, beatsPerBar: 12, countInBeats: 24 }));
    // Worst case of W9: 2 count-in bars plus 12 bars of 12/8 subdivision clicks, 168 nodes.
    expect(clicks).toHaveLength(168);
    expect(world.pendingTimers()).toBe(timersBefore);
    const fc = world.ctx;
    const started = fc.bufferSources.filter((s) => s.startedAt !== null);
    expect(started).toHaveLength(168);
    // Stall the main thread for 200 ms after scheduling: nothing is rescheduled, every start time is fixed.
    const wallBefore = world.wallMs;
    world.wallMs += 200;
    fc.frame += Math.round(0.2 * fc.sampleRate);
    const beat = 60 / 132;
    started.forEach((s, k) => {
      expect(s.startedAt).toBeCloseTo(t0 + (k - 24) * beat, 9);
      expect(s.startCallWallMs).toBe(wallBefore);
      expect(s.outs).toContain(bus);
    });
    // Accent buffers are distinct from normal ones and louder by accentDb.
    const peak = (s: FakeBufferSource): number => Math.max(...Array.from(s.buffer!.getChannelData(0)).map(Math.abs));
    const acc = started[0] as FakeBufferSource;
    const norm = started[1] as FakeBufferSource;
    expect(acc.buffer).not.toBe(norm.buffer);
    expect(peak(acc) / peak(norm)).toBeCloseTo(10 ** (5 / 20), 3);
  });

  it('cancel stops every pending click; ended clicks free their node', () => {
    const world = new FakeAudioWorld();
    const ctx = world.deps.createContext({ latencyHint: 'interactive' });
    const m = new Metronome(ctx, ctx.createGain());
    m.scheduleTake(take({ totalBeats: 8 }));
    const srcs = world.ctx.bufferSources;
    (srcs[0] as FakeBufferSource).onended?.();
    expect(m.pending()).toHaveLength(11);
    m.cancel();
    expect(m.pending()).toHaveLength(0);
    expect(srcs.slice(1).every((s) => s.stopped)).toBe(true);
  });

  it('reuses pre-rendered buffers across takes and schedules calibration clicks as accents', () => {
    const world = new FakeAudioWorld();
    const ctx = world.deps.createContext({ latencyHint: 'interactive' });
    const m = new Metronome(ctx, ctx.createGain());
    m.scheduleTake(take({ totalBeats: 4, timbre: 'wood' }));
    m.scheduleTake(take({ totalBeats: 4, timbre: 'wood' }));
    const bufs = new Set(world.ctx.bufferSources.map((s) => s.buffer));
    expect(bufs.size).toBe(2);
    m.scheduleClicks([11, 11.5, 12.2], 'tick');
    expect(m.history.slice(-3)).toEqual([
      { t: 11, accent: true, timbre: 'tick' },
      { t: 11.5, accent: true, timbre: 'tick' },
      { t: 12.2, accent: true, timbre: 'tick' },
    ]);
  });
});
