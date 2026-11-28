import { describe, expect, it } from 'vitest';
import type { CaptureBlock, WorkerMessage } from '../../../core/platform.ts';
import { FakeAudioBackend } from '../../../testkit/fake-backend.ts';
import { renderMin } from '../../../testkit/synth-min.ts';
import { createRng } from '../../../core/rng.ts';
import { CaptureCore, type CorePort } from './capture-processor.ts';
import type { FromWorklet, ToWorklet } from './protocol.ts';

/** A control port that records worklet posts and lets the test send control messages synchronously. */
class Ctl implements CorePort {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  readonly out: FromWorklet[] = [];
  /** Relay mode: hand buffers straight back, like the backend's relay. */
  autoReturn = true;
  postMessage(m: unknown): void {
    const msg = m as FromWorklet;
    if (msg.type === 'block' && this.autoReturn) {
      const b = msg.block;
      this.out.push({ type: 'block', block: { ...b, lowband: b.lowband.slice(), hiEnergy: b.hiEnergy.slice() } });
      this.send({ type: 'return', lowband: b.lowband.buffer as ArrayBuffer, hiEnergy: b.hiEnergy.buffer as ArrayBuffer });
      return;
    }
    this.out.push(msg);
  }
  send(m: ToWorklet): void {
    this.onmessage?.({ data: m } as MessageEvent);
  }
  blocks(): CaptureBlock[] {
    return this.out.flatMap((m) => (m.type === 'block' ? [m.block] : []));
  }
}

const start = (ctl: Ctl, poolSize = 32): void =>
  ctl.send({ type: 'start', port: null, relay: true, poolSize, statsEvery: 8 });

function runCore(rate: number, samples: Float32Array, originFrame: number, quantum = 128, channels = 1): CaptureBlock[] {
  const ctl = new Ctl();
  let frame = originFrame;
  const core = new CaptureCore(rate, ctl, () => frame);
  start(ctl);
  for (let i = 0; i < samples.length; i += quantum) {
    const n = Math.min(quantum, samples.length - i);
    const chans: Float32Array[] = [];
    for (let c = 0; c < channels; c++) {
      const ch = new Float32Array(quantum);
      ch.set(samples.subarray(i, i + n));
      chans.push(ch);
    }
    core.process(chans);
    frame += quantum;
  }
  return ctl.blocks();
}

async function runFake(rate: number, samples: Float32Array): Promise<CaptureBlock[]> {
  const be = new FakeAudioBackend({ source: samples, sampleRate: rate });
  const blocks: CaptureBlock[] = [];
  await be.startCapture((m: WorkerMessage) => void (m.type === 'block' && blocks.push(m.block)));
  await be.run({ tailSec: 0 });
  return blocks;
}

const signal = (rate: number, sec: number): Float32Array => {
  const r = renderMin({
    sampleRate: rate,
    notes: [64, 67, 71, 76].map((midi, i) => ({ midi, onsetSec: 0.05 + i * 0.12, durSec: 0.1 })),
    clicks: [{ t: 0.1, accent: true }, { t: 0.35, accent: false }],
    noiseDbfs: -50,
    durationSec: sec,
  });
  return r.samples;
};

describe('CaptureCore', () => {
  for (const rate of [48000, 44100, 24000, 16000]) {
    it(`matches FakeAudioBackend.emitBlock bit for bit at ${rate} Hz`, async () => {
      const x = signal(rate, 0.6);
      const fake = await runFake(rate, x);
      // FakeAudioBackend's clock starts at 10 s; the same origin as a context frame index.
      const real = runCore(rate, x, 10 * rate);
      expect(real.length).toBeGreaterThanOrEqual(fake.length);
      expect(fake.length).toBeGreaterThan(30);
      for (let i = 0; i < fake.length; i++) {
        const a = fake[i] as CaptureBlock;
        const b = real[i] as CaptureBlock;
        expect(b.seq).toBe(a.seq);
        expect(b.analysisRate).toBe(a.analysisRate);
        expect(b.startT).toBeCloseTo(a.startT, 11);
        expect(Array.from(b.lowband)).toEqual(Array.from(a.lowband));
        expect(Array.from(b.hiEnergy)).toEqual(Array.from(a.hiEnergy));
      }
    });
  }

  for (const rate of [48000, 44100, 24000, 16000]) {
    it(`streams 10,000 contiguous blocks at ${rate} Hz with odd quanta and stereo input`, () => {
      const ctl = new Ctl();
      let frame = 123_456;
      const core = new CaptureCore(rate, ctl, () => frame);
      start(ctl);
      const rng = createRng(rate);
      let fed = 0;
      while (fed < 10_000 * 256) {
        // Quantum sizes other than 128 must not matter (future render-size hints).
        const q = [128, 128, 64, 192, 256][rng.int(0, 5)] as number;
        const l = new Float32Array(q).map(() => rng.next() - 0.5);
        const r = new Float32Array(q).map(() => rng.next() - 0.5);
        core.process([l, r]);
        frame += q;
        fed += q;
      }
      const blocks = ctl.blocks();
      expect(blocks.length).toBe(Math.floor(fed / 256));
      const ar = (blocks[0] as CaptureBlock).analysisRate;
      expect((blocks[0] as CaptureBlock).startT).toBe(123_456 / rate);
      let samples = 0;
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i] as CaptureBlock;
        expect(b.seq).toBe(i);
        // startT of block i is the exact position of decimated sample `samples`.
        const expectT = (123_456 + samples * (rate / ar)) / rate;
        if (Math.abs(b.startT - expectT) > 1e-9) throw new Error(`block ${i}: startT ${b.startT} != ${expectT}`);
        samples += b.lowband.length;
      }
      expect(samples).toBe(Math.ceil((blocks.length * 256) / (rate / ar)));
      expect(core.framesProcessed).toBe(fed);
    });
  }

  it("a stale currentFrame in a new node's first quantum does not move the origin (Chromium, e2e/synthetic d = 110 flake)", () => {
    // Measured in headless Chromium at 44.1 kHz: a capture started with the node's first quantum read currentFrame
    // 896 there and 1536 in the second (frame base 896, then 1408 for good), so the origin came out 512 frames early
    // and every loopback lag read 11.6 ms short (98.1 instead of 109.7 ms at d = 110), about one take in seven.
    const rate = 44100;
    const ctl = new Ctl();
    let q = 0;
    const core = new CaptureCore(rate, ctl, () => (q === 0 ? 896 : 1408 + 128 * q));
    start(ctl);
    for (; q < 8; q++) core.process([new Float32Array(128)]);
    const started = ctl.out.find((m) => m.type === 'started') as Extract<FromWorklet, { type: 'started' }>;
    expect(started.originFrame).toBe(1408);
    expect(ctl.blocks()[0]!.startT).toBe(1408 / rate);
  });

  it('downmixes stereo to the mean of the channels', () => {
    const rate = 48000;
    const x = signal(rate, 0.2);
    const mono = runCore(rate, x, 0);
    const ctl = new Ctl();
    let frame = 0;
    const core = new CaptureCore(rate, ctl, () => frame);
    start(ctl);
    for (let i = 0; i + 128 <= x.length; i += 128) {
      const a = x.slice(i, i + 128);
      // L = 2x, R = 0 averages to x.
      core.process([a.map((v) => 2 * v), new Float32Array(128)]);
      frame += 128;
    }
    const st = ctl.blocks();
    expect(st.length).toBe(Math.floor(x.length / 256));
    for (let i = 0; i < st.length; i++) {
      const s = st[i] as CaptureBlock;
      const m = mono[i] as CaptureBlock;
      for (let k = 0; k < s.lowband.length; k++) expect(s.lowband[k]).toBeCloseTo(m.lowband[k] as number, 6);
    }
  });

  it('counts input frames when idle and treats a missing input as silence', () => {
    const ctl = new Ctl();
    let frame = 0;
    const core = new CaptureCore(48000, ctl, () => frame);
    for (let i = 0; i < 10; i++) {
      core.process(undefined);
      frame += 128;
    }
    expect(core.framesProcessed).toBe(1280);
    expect(ctl.blocks()).toHaveLength(0);
    start(ctl);
    for (let i = 0; i < 4; i++) {
      core.process([]);
      frame += 128;
    }
    const b = ctl.blocks();
    expect(b).toHaveLength(2);
    expect(Array.from((b[0] as CaptureBlock).lowband).every((v) => v === 0)).toBe(true);
    expect(ctl.out[0]).toEqual({ type: 'started', originFrame: 1280, analysisRate: 16000 });
    expect(core.framesProcessed).toBe(1792);
  });

  it("answers clock requests with the stamp of the latest burst's first quantum and the input-presence counters", () => {
    const ctl = new Ctl();
    let frame = 0;
    let wall = 5000;
    const core = new CaptureCore(48000, ctl, () => frame, () => wall);
    ctl.send({ type: 'clock', id: 1 });
    expect(ctl.out.at(-1)).toEqual({ type: 'clock', id: 1, frame: -1, wallMs: -1, quanta: 0, missingInput: 0, silentInput: 0 });
    const live = (): Float32Array[] => [Float32Array.from({ length: 128 }, (_, i) => 0.1 * Math.sin(i))];
    // Three bursts of 4 quanta, 10 ms apart; inside a burst the quanta run back to back (same ms or the next one).
    const kinds: (Float32Array[] | undefined)[] = [live(), [], [new Float32Array(128)], live()];
    for (let burst = 0; burst < 3; burst++) {
      for (let q = 0; q < 4; q++) {
        wall = 5000 + burst * 10 + (q === 3 ? 1 : 0);
        core.process(kinds[q]);
        frame += 128;
      }
    }
    // A reply that arrives late still carries the exact pair: frame 1024 rendered at 5020 ms.
    wall = 9999;
    ctl.send({ type: 'clock', id: 2 });
    expect(ctl.out.at(-1)).toEqual({ type: 'clock', id: 2, frame: 1024, wallMs: 5020, quanta: 12, missingInput: 3, silentInput: 3 });
  });

  it('drops and counts blocks when the pool is empty, keeping later startT exact', () => {
    const ctl = new Ctl();
    ctl.autoReturn = false;
    let frame = 0;
    const core = new CaptureCore(48000, ctl, () => frame);
    start(ctl, 4);
    for (let i = 0; i < 20; i++) {
      core.process([new Float32Array(128)]);
      frame += 128;
    }
    const blocks = ctl.blocks();
    const drops = ctl.out.filter((m) => m.type === 'drop');
    expect(blocks.map((b) => b.seq)).toEqual([0, 1, 2, 3]);
    expect(drops.map((d) => (d.type === 'drop' ? d.seq : -1))).toEqual([4, 5, 6, 7, 8, 9]);
    expect(core.outstanding).toBe(4);
    // Return one pair: the next block uses it and its startT continues the timeline.
    const b0 = blocks[0] as CaptureBlock;
    ctl.send({ type: 'return', lowband: b0.lowband.buffer as ArrayBuffer, hiEnergy: b0.hiEnergy.buffer as ArrayBuffer });
    core.process([new Float32Array(128)]);
    frame += 128;
    core.process([new Float32Array(128)]);
    const next = ctl.blocks().at(-1) as CaptureBlock;
    expect(next.seq).toBe(10);
    // First decimated sample of block 10 sits at input frame ceil(2560 / 3) × 3 = 2562.
    expect(next.startT).toBe(2562 / 48000);
  });

  it('posts copies to the worker port until a buffer comes back, then uses the pool', async () => {
    const ctl = new Ctl();
    let frame = 0;
    const core = new CaptureCore(48000, ctl, () => frame);
    const ch = new MessageChannel();
    const got: CaptureBlock[] = [];
    let giveBack = false;
    ch.port2.onmessage = (ev: MessageEvent) => {
      const m = ev.data as WorkerMessage;
      if (m.type !== 'block') return;
      got.push(m.block);
      if (giveBack) ch.port2.postMessage({ v: 1, type: 'return', lowband: m.block.lowband.buffer, hiEnergy: m.block.hiEnergy.buffer }, [m.block.lowband.buffer, m.block.hiEnergy.buffer]);
    };
    ctl.send({ type: 'start', port: ch.port1 as unknown as MessagePort, relay: false, poolSize: 4, statsEvery: 1 });
    const tick = async (blocks: number): Promise<void> => {
      for (let i = 0; i < blocks * 2; i++) {
        core.process([new Float32Array(128)]);
        frame += 128;
      }
      for (let i = 0; i < 4; i++) await new Promise<void>((r) => setImmediate(r));
    };
    await tick(10);
    // Probe phase: 10 blocks, no drops even though nothing came back and the pool holds 4.
    expect(got.map((b) => b.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(ctl.out.some((m) => m.type === 'drop')).toBe(false);
    expect(ctl.out.some((m) => m.type === 'port-ok')).toBe(false);
    giveBack = true;
    await tick(10);
    expect(ctl.out.some((m) => m.type === 'port-ok')).toBe(true);
    expect(got.map((b) => b.seq)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(ctl.out.some((m) => m.type === 'drop')).toBe(false);
    ch.port1.close();
    ch.port2.close();
  });
});
