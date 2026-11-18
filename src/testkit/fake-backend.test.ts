import { describe, expect, it } from 'vitest';
import type { AudioRouteInfo, CaptureBlock, WorkerMessage } from '../core/platform.ts';
import { PhaseDecimator } from '../dsp/decimator.ts';
import { HiBandEnergy } from '../dsp/hiband.ts';
import { FakeAudioBackend } from './fake-backend.ts';
import { renderMin } from './synth-min.ts';
import { encodeWav } from './wav.ts';

const collect = (): { blocks: CaptureBlock[]; sink: (m: WorkerMessage) => void } => {
  const blocks: CaptureBlock[] = [];
  return { blocks, sink: (m) => void (m.type === 'block' && blocks.push(m.block)) };
};

const tone = (hz: number, sr: number, sec: number, amp = 0.5): Float32Array =>
  Float32Array.from({ length: Math.round(sr * sec) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / sr));

const rmsOf = (x: Float32Array, from = 0): number => {
  let s = 0;
  for (let i = from; i < x.length; i++) s += (x[i] as number) ** 2;
  return Math.sqrt(s / (x.length - from));
};

describe('FakeAudioBackend capture', () => {
  for (const sr of [48000, 44100]) {
    it(`streams contiguous blocks at ${sr} Hz`, async () => {
      const be = new FakeAudioBackend({ source: tone(1000, sr, 2), sampleRate: sr });
      const { blocks, sink } = collect();
      await be.startCapture(sink);
      await be.run({ tailSec: 0 });
      expect(blocks.length).toBe(Math.floor((2 * sr) / 256));
      expect(be.analysisRate).toBe(sr === 48000 ? 16000 : 14700);
      let total = 0;
      blocks.forEach((b, i) => {
        expect(b.seq).toBe(i);
        expect(b.analysisRate).toBe(be.analysisRate);
        expect([85, 86]).toContain(b.lowband.length);
        if (i > 0) {
          const p = blocks[i - 1] as CaptureBlock;
          expect(b.startT - (p.startT + p.lowband.length / p.analysisRate)).toBeCloseTo(0, 9);
        }
        total += b.lowband.length;
      });
      expect(total).toBe(Math.ceil((blocks.length * 256) / (sr / be.analysisRate)));
      // Starts at the capture clock; 1 kHz passes the 3 kHz low-pass at full level.
      expect(blocks[0]?.startT).toBeCloseTo(10, 9);
      const mid = Float32Array.from(blocks.slice(20).flatMap((b) => Array.from(b.lowband)));
      expect(rmsOf(mid)).toBeGreaterThan(0.5 * 0.707 * 0.95);
      expect(rmsOf(mid)).toBeLessThan(0.5 * 0.707 * 1.05);
    });
  }

  for (const sr of [48000, 44100, 24000, 16000]) {
    it(`blocks equal the src/dsp capture primitives run directly (${sr} Hz)`, async () => {
      const src = tone(2637, sr, 0.5, 0.3).map((v, i) => v + 0.2 * Math.sin((2 * Math.PI * 7000 * i) / sr));
      const be = new FakeAudioBackend({ source: src, sampleRate: sr });
      const { blocks, sink } = collect();
      await be.startCapture(sink);
      await be.run({ tailSec: 0 });
      const dec = new PhaseDecimator(sr);
      const hb = new HiBandEnergy(sr);
      const lowRef = new Float32Array(src.length);
      const hiRef = new Float32Array(hb.maxSubBlocks(src.length));
      const nIn = blocks.length * 256;
      const nLow = dec.process(src.subarray(0, nIn), lowRef, 0);
      const nHi = hb.process(src.subarray(0, nIn), hiRef, 0);
      expect(Array.from(blocks.flatMap((b) => Array.from(b.lowband)))).toEqual(Array.from(lowRef.subarray(0, nLow)));
      expect(Array.from(blocks.flatMap((b) => Array.from(b.hiEnergy)))).toEqual(Array.from(hiRef.subarray(0, nHi)));
      expect(be.analysisRate).toBe(dec.analysisRate);
    });
  }

  it('rejects a 6 kHz tone in the low band but shows it in hiEnergy; ~1 ms sub-blocks', async () => {
    const be = new FakeAudioBackend({ source: tone(6500, 48000, 1) });
    const { blocks, sink } = collect();
    await be.startCapture(sink);
    await be.run();
    const low = Float32Array.from(blocks.slice(20).flatMap((b) => Array.from(b.lowband)));
    expect(rmsOf(low)).toBeLessThan(0.5 * 0.707 * 0.02);
    const hi = blocks.slice(20).flatMap((b) => Array.from(b.hiEnergy));
    const nHi = blocks.reduce((a, b) => a + b.hiEnergy.length, 0);
    expect(Math.abs(nHi - blocks.length * (256 / 48))).toBeLessThanOrEqual(1);
    const mean = hi.reduce((a, b) => a + b, 0) / hi.length;
    expect(mean).toBeGreaterThan(0.5 * 48 * 0.25 * 0.8); // 0.5^2/2 per sample * 48 samples, minus filter loss
  });

  it('accepts WAV bytes and aligns source sample 0 to sourceStartClock', async () => {
    const x = renderMin({ sampleRate: 48000, notes: [{ midi: 69, onsetSec: 0.5, durSec: 0.5 }], durationSec: 1.5 }).samples;
    const be = new FakeAudioBackend({ source: encodeWav({ sampleRate: 48000, channels: [x] }), sourceStartClock: 12 });
    const { blocks, sink } = collect();
    await be.startCapture(sink); // clock 10: two seconds of silence first
    await be.run({ untilClock: 14 });
    const idx = blocks.findIndex((b) => rmsOf(b.lowband) > 0.01);
    expect(blocks[idx]?.startT).toBeGreaterThan(12.5 - 0.01);
    expect(blocks[idx]?.startT).toBeLessThan(12.5 + 0.02);
  });

  it('reports dropped seqs as gaps and works with a port-like sink', async () => {
    const be = new FakeAudioBackend({ source: tone(500, 48000, 0.5), dropSeqs: [3, 4] });
    const seen: number[] = [];
    await be.startCapture({ postMessage: (m) => void seen.push(((m as WorkerMessage & { type: 'block' }).block).seq), close: () => undefined });
    await be.run();
    expect(seen.slice(0, 6)).toEqual([0, 1, 2, 5, 6, 7]);
  });

  it('stops delivering after stopCapture', async () => {
    const be = new FakeAudioBackend({ source: tone(500, 48000, 1) });
    const { blocks, sink } = collect();
    await be.startCapture(sink);
    be.advance(0.1);
    const n = blocks.length;
    be.stopCapture();
    be.advance(0.5);
    expect(blocks.length).toBe(n);
  });
});

describe('FakeAudioBackend schedule and scripts', () => {
  it('schedules every click with count-in flags and t0', async () => {
    const be = new FakeAudioBackend({ startClockSec: 5 });
    const { t0, clicks } = await be.scheduleTake({
      leadSec: 0.5, bpm: 120, beatsPerBar: 4, countInBeats: 4, totalBeats: 8, mode: 'audible', timbre: 'tick', accentDb: 5,
    });
    expect(clicks).toHaveLength(12);
    expect(clicks[0]?.t).toBeCloseTo(5.5, 9);
    expect(t0).toBeCloseTo(7.5, 9);
    expect(clicks.filter((c) => c.countIn)).toHaveLength(4);
    expect(clicks.filter((c) => c.accent).map((c) => c.beatIndex)).toEqual([0, 4, 8]);
    const only = await be.scheduleTake({
      leadSec: 0.5, bpm: 120, beatsPerBar: 4, countInBeats: 4, totalBeats: 8, mode: 'countInOnly', timbre: 'wood', accentDb: 5,
    });
    expect(only.clicks).toHaveLength(4);
  });

  it('testClock mode puts t0 at capture origin + offset', async () => {
    const be = new FakeAudioBackend({ sourceStartClock: 20, t0AfterCaptureSec: 2 });
    const { t0, clicks } = await be.scheduleTake({
      leadSec: 0.5, bpm: 120, beatsPerBar: 4, countInBeats: 4, totalBeats: 4, mode: 'audible', timbre: 'tick', accentDb: 5,
    });
    expect(t0).toBe(22);
    expect(clicks[0]?.t).toBeCloseTo(20, 9);
  });

  it('fires scripted interruptions and route changes in clock order, interleaved with blocks', async () => {
    const be = new FakeAudioBackend({ source: tone(500, 48000, 2) });
    const order: string[] = [];
    be.onInterruption((r) => order.push(`int:${r}`));
    be.onRouteChange((r: AudioRouteInfo) => order.push(`route:${r.outputMode}`));
    be.scriptRouteChange(10.5, { outputMode: 'bluetooth' });
    be.scriptInterruption(10.25, 'hidden');
    let lastBlockT = 0;
    await be.startCapture((m) => {
      if (m.type === 'block') {
        order.push('block');
        lastBlockT = m.block.startT;
      }
    });
    await be.run({ untilClock: 11 });
    expect(order.filter((s) => s !== 'block')).toEqual(['int:hidden', 'route:bluetooth']);
    const iInt = order.indexOf('int:hidden');
    expect(order.slice(0, iInt).filter((s) => s === 'block').length).toBe(Math.floor(0.25 / (256 / 48000)));
    expect(lastBlockT).toBeGreaterThan(10.9);
    const un = be.onInterruption(() => undefined);
    un();
  });

  it('loopback mixes scheduled clicks into the capture at the round-trip delay', async () => {
    const be = new FakeAudioBackend({ source: new Float32Array(48000), loopback: { rtlSec: 0.05, gainDb: -6, timbre: 'tick' } });
    const { blocks, sink } = collect();
    await be.startCapture(sink);
    await be.playCalibrationClicks([10.3 as never], 'tick');
    await be.run({ untilClock: 10.9 });
    const hot = blocks.filter((b) => b.hiEnergy.some((e) => e > 1e-4));
    expect(hot.length).toBeGreaterThan(0);
    expect(hot[0]?.startT).toBeGreaterThan(10.35 - 0.01);
    expect(hot[0]?.startT).toBeLessThan(10.35 + 0.01);
    expect(be.log.calibrationClicks).toHaveLength(1);
  });

  it('records tones, unlocks, clock-rate and close', async () => {
    const be = new FakeAudioBackend({ clockRateError: 0.088 });
    expect((await be.unlock()).routeKey).toBe('fake-route');
    await be.playTone(440, 0.3, be.now());
    const r = await be.measureClockRate(1.5);
    expect(r.framesPerSec / r.expected).toBeCloseTo(1.088, 6);
    expect(be.now()).toBeCloseTo(11.5, 9);
    expect(await be.permissionState()).toBe('granted');
    await be.close();
    expect(be.log).toMatchObject({ unlocks: 1, closed: true });
    expect(be.log.tones).toHaveLength(1);
  });
});
