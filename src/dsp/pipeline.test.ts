import { describe, expect, it } from 'vitest';
import type { DspApi } from '../core/api.ts';
import type { CaptureBlock, WorkerMessage } from '../core/platform.ts';
import { createRng } from '../core/rng.ts';
import type { ClockSeconds, DetectedNote, DspConfig, DspEvent } from '../core/types.ts';
import { FakeAudioBackend } from '../testkit/fake-backend.ts';
import { renderPerformance } from '../testkit/synth/index.ts';
import { PhaseDecimator } from './decimator.ts';
import { DspPipeline, SIGNAL_EVERY_HOPS, decimatorCreate, runOffline } from './pipeline.ts';

const CFG: DspConfig = {
  analysisRate: 16000,
  windowSamples: 1024,
  hopSamples: 128,
  minHz: 123.47,
  maxHz: 1661.22,
  a4Hz: 440,
  clarityThreshold: 0.85,
  changeCents: 60,
  onsetProfile: 'tongued-wind',
  vibratoClass: 'none',
  outputMode: 'wired',
  clicks: [],
  clickTemplate: null,
  repeatHints: [],
};

const line = (sampleRate = 48000) =>
  renderPerformance({
    timbre: 'clarinet',
    sampleRate,
    notes: [
      { midi: 64, onsetSec: 0.3, durSec: 0.4 },
      { midi: 64, onsetSec: 0.7, durSec: 0.4, dipDb: 12 },
      { midi: 67, onsetSec: 1.1, durSec: 0.4, slur: true },
      { midi: 60, onsetSec: 1.9, durSec: 0.5 },
    ],
  });

const ofType = <T extends DspEvent['type']>(ev: DspEvent[], type: T): Extract<DspEvent, { type: T }>[] =>
  ev.filter((e): e is Extract<DspEvent, { type: T }> => e.type === type);

function blocksOf(samples: Float32Array, rate: number, frames: number): CaptureBlock[] {
  const dec = new PhaseDecimator(rate);
  const out: CaptureBlock[] = [];
  const low = new Float32Array(frames);
  for (let i = 0, seq = 0; i < samples.length; i += frames) {
    const chunk = samples.subarray(i, Math.min(samples.length, i + frames));
    const startT = dec.nextOutputInputPos / rate;
    const n = dec.process(chunk, low, 0);
    if (n === 0) continue;
    out.push({ v: 1, startT: startT as ClockSeconds, lowband: low.slice(0, n), hiEnergy: new Float32Array(0), analysisRate: dec.analysisRate, seq: seq++ });
  }
  return out;
}

describe('DspPipeline assembly', () => {
  it('satisfies DspApi', () => {
    const api: DspApi = { DspPipeline, runOffline, decimatorCreate };
    expect(api.decimatorCreate(48000).analysisRate).toBe(16000);
    expect(new api.DspPipeline(CFG).frames()).toEqual([]);
  });

  it('turns a line into note-on, note-update and note-off events in order', () => {
    const r = line();
    const { events, frames } = runOffline(r.samples, r.sampleRate, CFG);
    const on = ofType(events, 'note-on').map((e) => e.note);
    const off = ofType(events, 'note-off').map((e) => e.note);
    expect(on.map((n) => n.onsetCause)).toEqual(['from-silence', 'repeat', 'pitch-change', 'from-silence']);
    expect(on.map((n) => Math.round(n.midi))).toEqual([64, 64, 67, 60]);
    on.forEach((n, k) => expect(Math.abs(n.onset - (r.truth[k]?.onsetSec as number))).toBeLessThan(0.005));
    expect(off.map((n) => n.id)).toEqual(on.map((n) => n.id));
    expect(on.map((n) => n.id)).toEqual([1, 2, 3, 4]);
    // Every note-off carries an offset not before its onset; a split note ends where the next begins.
    off.forEach((n) => expect(n.offset as number).toBeGreaterThanOrEqual(n.onset));
    expect(off[0]?.offset).toBe(on[1]?.onset);
    // Per note: note-on, then updates, then note-off; updates only while sounding.
    const live = new Set<number>();
    for (const e of events) {
      if (e.type === 'note-on') live.add(e.note.id);
      else if (e.type === 'note-update') expect(live.has(e.note.id)).toBe(true);
      else if (e.type === 'note-off') {
        expect(live.has(e.note.id)).toBe(true);
        live.delete(e.note.id);
      }
    }
    expect(live.size).toBe(0);
    // A signal event every 4 hops.
    expect(ofType(events, 'signal')).toHaveLength(Math.floor(frames.length / SIGNAL_EVERY_HOPS));
    expect(ofType(events, 'signal').some((s) => s.voiced)).toBe(true);
    expect(ofType(events, 'signal').some((s) => !s.voiced)).toBe(true);
  });

  it('sends note-update about every 4 hops while a note sounds', () => {
    const r = renderPerformance({ timbre: 'flute', notes: [{ midi: 72, onsetSec: 0.2, durSec: 1.0 }] });
    const { events } = runOffline(r.samples, r.sampleRate, { ...CFG, windowSamples: 512, minHz: 220, maxHz: 2489 });
    const ups = ofType(events, 'note-update');
    // About 1.0 s of note at 8 ms hops / 4.
    expect(ups.length).toBeGreaterThan(25);
    expect(ups.length).toBeLessThan(36);
    expect(ups.every((u) => u.note.offset === null)).toBe(true);
  });

  it('stamps pitch frames at window centres every hop, with flux and click-window flags', () => {
    const r = line();
    const clicks = [{ arrival: 1.0 as ClockSeconds, accent: true }];
    const { frames } = runOffline(r.samples, r.sampleRate, { ...CFG, clicks });
    expect(frames[0]?.t).toBeCloseTo(512 / 16000, 9);
    for (let i = 1; i < frames.length; i++) expect((frames[i]?.t as number) - (frames[i - 1]?.t as number)).toBeCloseTo(0.008, 9);
    const inWin = frames.filter((f) => f.inClickWindow).map((f) => f.t);
    expect(inWin.length).toBeGreaterThan(0);
    expect(Math.min(...inWin)).toBeGreaterThanOrEqual(1.0 - 0.005);
    expect(Math.max(...inWin)).toBeLessThanOrEqual(1.0 + 0.035);
    expect(Math.max(...frames.map((f) => f.flux))).toBeGreaterThan(0.1);
  });

  it('does not depend on the block size', () => {
    const r = line();
    const run = (frames: number): DspEvent[] => {
      const p = new DspPipeline(CFG);
      const ev: DspEvent[] = [];
      for (const b of blocksOf(r.samples, r.sampleRate, frames)) ev.push(...p.push(b));
      ev.push(...p.flush((r.samples.length / r.sampleRate) as ClockSeconds));
      return ev;
    };
    const a = ofType(run(128), 'note-off').map((e) => e.note);
    const b = ofType(run(512), 'note-off').map((e) => e.note);
    expect(b.length).toBe(a.length);
    a.forEach((n, i) => {
      expect(b[i]?.onset).toBeCloseTo(n.onset, 9);
      expect(b[i]?.midi).toBeCloseTo(n.midi, 9);
    });
  });

  it('works at 44.1 kHz input (14.7 kHz analysis rate)', () => {
    const r = line(44100);
    const { events } = runOffline(r.samples, 44100, CFG);
    const on = ofType(events, 'note-on').map((e) => e.note);
    expect(on).toHaveLength(4);
    on.forEach((n, k) => expect(Math.abs(n.onset - (r.truth[k]?.onsetSec as number))).toBeLessThan(0.006));
  });

  it('reports sequence gaps and rejects a block at another analysis rate', () => {
    const r = line();
    const blocks = blocksOf(r.samples.subarray(0, 48000), 48000, 256);
    const p = new DspPipeline(CFG);
    p.push(blocks[0] as CaptureBlock);
    const ev = p.push({ ...(blocks[3] as CaptureBlock), seq: 3 });
    expect(ev[0]).toEqual({ type: 'gap', missingBlocks: 2 });
    expect(() => p.push({ ...(blocks[4] as CaptureBlock), analysisRate: 14700 })).toThrow(RangeError);
  });

  it('flush ends a sounding note at the flush time', () => {
    const r = renderPerformance({ timbre: 'sax', notes: [{ midi: 62, onsetSec: 0.2, durSec: 2 }] });
    const cut = r.samples.subarray(0, Math.round(1.0 * r.sampleRate));
    const { events } = runOffline(cut, r.sampleRate, { ...CFG, minHz: 116.54, maxHz: 1046.5 });
    const off = ofType(events, 'note-off');
    expect(off).toHaveLength(1);
    expect(off[0]?.note.offset).toBeLessThanOrEqual(1.0);
    expect(off[0]?.note.offset).toBeGreaterThan(0.9);
  });

  it('adapts the noise gate to the floor and still finds the notes in noise', () => {
    const r = line();
    const rng = createRng(7);
    const noisy = new Float32Array(r.samples.length);
    const g = Math.pow(10, -45 / 20) * Math.sqrt(3);
    for (let i = 0; i < noisy.length; i++) noisy[i] = (r.samples[i] as number) + g * (2 * rng.next() - 1);
    const p = new DspPipeline(CFG);
    const ev: DspEvent[] = [];
    for (const b of blocksOf(noisy, 48000, 256)) ev.push(...p.push(b));
    ev.push(...p.flush(3 as ClockSeconds));
    // White noise at -45 dBFS keeps about 3/24 of its power below 3 kHz: about -54 dB in the low band.
    expect(p.gateDb).toBeGreaterThan(-48);
    expect(p.gateDb).toBeLessThan(-36);
    const on = ofType(ev, 'note-on').map((e) => e.note);
    expect(on).toHaveLength(4);
    on.forEach((n, k) => expect(Math.abs(n.onset - (r.truth[k]?.onsetSec as number))).toBeLessThan(0.012));
  });

  it('runs on FakeAudioBackend blocks with the clock origin of the capture', async () => {
    const r = line();
    const be = new FakeAudioBackend({ source: r.samples, sampleRate: 48000 });
    const p = new DspPipeline(CFG);
    const ev: DspEvent[] = [];
    await be.startCapture((m: WorkerMessage) => {
      if (m.type === 'block') ev.push(...p.push(m.block));
    });
    const origin = be.now() as number;
    await be.run({ tailSec: 0.2 });
    ev.push(...p.flush(be.now()));
    const on = ofType(ev, 'note-on').map((e) => e.note as DetectedNote);
    expect(on).toHaveLength(4);
    on.forEach((n, k) => expect(Math.abs(n.onset - origin - (r.truth[k]?.onsetSec as number))).toBeLessThan(0.005));
  });
});
