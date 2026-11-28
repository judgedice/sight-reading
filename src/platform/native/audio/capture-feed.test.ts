import { describe, expect, it } from 'vitest';
import type { CaptureBlock, WorkerMessage } from '../../../core/platform.ts';
import { CaptureCore, type CorePort } from '../../shared/audio/capture-processor.ts';
import type { FromWorklet, ToWorklet } from '../../shared/audio/protocol.ts';
import { NativeCaptureFeed, type CaptureFault } from './capture-feed.ts';
import { encodeCapturePacket, PACKET_FLAGS, PACKET_HEADER_BYTES } from './wire.ts';

/** A reproducible pseudo-random signal in [-1, 1), float32. */
function noise(n: number, seed: number): Float32Array {
  let a = seed >>> 0;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    out[i] = (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  }
  return out;
}

const bits = (x: Float32Array): Uint32Array => new Uint32Array(x.buffer, x.byteOffset, x.length);

const copyBlock = (b: CaptureBlock): CaptureBlock => ({ ...b, lowband: b.lowband.slice(), hiEnergy: b.hiEnergy.slice() });

/** The web path: `CaptureCore` fed 128-frame render quanta, `currentFrame` the context frame of each quantum. */
function webBlocks(signal: Float32Array, rate: number, origin: number): CaptureBlock[] {
  const blocks: CaptureBlock[] = [];
  const ctl: CorePort = {
    onmessage: null,
    postMessage(m) {
      const w = m as FromWorklet;
      if (w.type !== 'block') return;
      blocks.push(copyBlock(w.block));
      const back: ToWorklet = { type: 'return', lowband: w.block.lowband.buffer as ArrayBuffer, hiEnergy: w.block.hiEnergy.buffer as ArrayBuffer };
      ctl.onmessage?.({ data: back } as MessageEvent);
    },
  };
  let fed = 0;
  const core = new CaptureCore(rate, ctl, () => origin + fed, () => 0);
  const start: ToWorklet = { type: 'start', port: null, relay: true, poolSize: 32, statsEvery: 8 };
  ctl.onmessage?.({ data: start } as MessageEvent);
  for (let i = 0; i < signal.length; i += 128) {
    const q = signal.subarray(i, Math.min(signal.length, i + 128));
    core.process([q], q.length);
    fed += q.length;
  }
  return blocks;
}

interface Run {
  blocks: CaptureBlock[];
  faults: CaptureFault[];
  feed: NativeCaptureFeed;
}

/** The native path: the same samples as packets of the given sizes (cycled), through `NativeCaptureFeed`. */
function nativeRun(signal: Float32Array, rate: number, origin: number, sizes: readonly number[], o: { drop?: { at: number; frames: number }; seqJump?: boolean; now?: () => number } = {}): Run {
  const blocks: CaptureBlock[] = [];
  const faults: CaptureFault[] = [];
  const feed = new NativeCaptureFeed({
    engineRate: rate,
    sink: (m: WorkerMessage) => void (m.type === 'block' && blocks.push(m.block)),
    now: o.now ?? (() => 0),
    backlogVoidMs: 120,
    onFault: (f) => faults.push(f),
  });
  let pos = 0;
  let seq = 0;
  let k = 0;
  let dropped = false;
  while (pos < signal.length) {
    let droppedBefore = 0;
    if (o.drop && !dropped && pos === o.drop.at) {
      // The frames from here are lost (whole packets, so `at` is on a packet boundary): the next packet reports them.
      dropped = true;
      pos += o.drop.frames;
      droppedBefore = o.drop.frames;
      if (o.seqJump) seq += Math.ceil(o.drop.frames / 512);
      if (pos >= signal.length) break;
    }
    const n = Math.min(sizes[k++ % sizes.length] as number, signal.length - pos);
    feed.push(encodeCapturePacket({ seq: seq++, firstFrame: origin + pos, droppedBefore }, signal.subarray(pos, pos + n)));
    pos += n;
  }
  feed.stop();
  return { blocks, faults, feed };
}

function expectBlocksEqual(a: readonly CaptureBlock[], b: readonly CaptureBlock[]): void {
  expect(b.length).toBe(a.length);
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as CaptureBlock;
    const y = b[i] as CaptureBlock;
    expect(y.seq, `seq of block ${i}`).toBe(x.seq);
    expect(y.analysisRate, `analysisRate of block ${i}`).toBe(x.analysisRate);
    expect(Object.is(y.startT, x.startT), `startT of block ${i}: ${y.startT} vs ${x.startT}`).toBe(true);
    expect(y.v).toBe(1);
    expect(bits(y.lowband), `lowband of block ${i}`).toEqual(bits(x.lowband));
    expect(bits(y.hiEnergy), `hiEnergy of block ${i}`).toEqual(bits(x.hiEnergy));
  }
}

/** Packet sizes that are not a multiple of the 256-frame block or of each other. */
const IRREGULAR = [1, 7, 255, 257, 1000, 128, 333, 1500, 64, 2, 480, 511, 513, 100];

const CASES: { rate: number; origin: number; analysisRate: number }[] = [
  { rate: 48000, origin: 0, analysisRate: 16000 },
  { rate: 48000, origin: 123_456_789, analysisRate: 16000 },
  { rate: 44100, origin: 1_000_003, analysisRate: 14700 },
];

describe('NativeCaptureFeed equals the web capture path bit for bit (design section 8, test 1)', () => {
  for (const c of CASES) {
    const signal = noise(c.rate * 3 + 77, c.rate ^ c.origin);
    const web = webBlocks(signal, c.rate, c.origin);

    it(`${c.rate} Hz from frame ${c.origin}: the web path yields blocks at ${c.analysisRate} Hz`, () => {
      expect(web.length).toBe(Math.floor(signal.length / 256));
      expect(web.every((b) => b.analysisRate === c.analysisRate)).toBe(true);
      // startT is an exact integer input frame over the rate.
      for (const b of web) expect(Math.abs(b.startT * c.rate - Math.round(b.startT * c.rate))).toBeLessThan(1e-3);
    });

    for (const [name, sizes] of [
      ['256', [256]],
      ['512', [512]],
      ['480', [480]],
      ['128 (one render quantum)', [128]],
      ['irregular', IRREGULAR],
    ] as const) {
      it(`${c.rate} Hz from frame ${c.origin}: packets of ${name}`, () => {
        const run = nativeRun(signal, c.rate, c.origin, sizes);
        expect(run.faults).toEqual([]);
        expectBlocksEqual(web, run.blocks);
        expect(run.feed.originFrame).toBe(c.origin);
        expect(run.feed.analysisRate).toBe(c.analysisRate);
        expect(run.feed.stats()).toMatchObject({ postedBlocks: web.length, droppedBlocks: 0, relay: true });
      });
    }
  }

  it('the block timeline does not depend on the packet size: a packet of one frame gives the same blocks', () => {
    const signal = noise(48000, 7);
    expectBlocksEqual(webBlocks(signal, 48000, 99), nativeRun(signal, 48000, 99, [1]).blocks);
  });

  it('a block handed to the sink is a copy: the feed reuses nothing the sink may keep', () => {
    const signal = noise(48000, 11);
    const run = nativeRun(signal, 48000, 0, [512]);
    expect(new Set(run.blocks.map((b) => b.lowband.buffer)).size).toBe(run.blocks.length);
    expect(run.blocks.every((b) => b.lowband.buffer.byteLength >= b.lowband.byteLength)).toBe(true);
  });

  it('delivers through a port with the buffers transferred', () => {
    const posted: { msg: WorkerMessage; transfer: unknown[] }[] = [];
    const feed = new NativeCaptureFeed({
      engineRate: 48000,
      sink: { postMessage: (msg, transfer) => void posted.push({ msg: msg as WorkerMessage, transfer: transfer ?? [] }), close: () => undefined },
      now: () => 0,
      backlogVoidMs: 120,
      onFault: () => undefined,
    });
    feed.push(encodeCapturePacket({ seq: 0, firstFrame: 0 }, noise(512, 3)));
    expect(posted).toHaveLength(2);
    const b = (posted[0] as { msg: WorkerMessage }).msg as Extract<WorkerMessage, { type: 'block' }>;
    expect((posted[0] as { transfer: unknown[] }).transfer).toEqual([b.block.lowband.buffer, b.block.hiEnergy.buffer]);
  });
});

describe('gaps (design section 8, test 3)', () => {
  const rate = 48000;
  const origin = 9_000_000;
  const signal = noise(rate * 2, 5);
  const gapAt = 20_480;
  const gap = 1536;
  const free = nativeRun(signal, rate, origin, [512]);

  it('the gap-free run has no fault', () => {
    expect(free.faults).toEqual([]);
  });

  for (const [name, seqJump] of [['the sequence continues', false], ['the sequence skips the lost packets', true]] as const) {
    it(`droppedBefore = ${gap} (${name}) is exactly one capture-gap and the next block's startT is the gap-free run's`, () => {
      const run = nativeRun(signal, rate, origin, [512], { drop: { at: gapAt, frames: gap }, seqJump });
      expect(run.faults).toHaveLength(1);
      expect(run.faults[0]).toMatchObject({ kind: 'capture-gap' });
      expect(run.blocks).toHaveLength(free.blocks.length);
      run.blocks.forEach((b, i) => {
        const f = free.blocks[i] as CaptureBlock;
        expect(b.seq).toBe(f.seq);
        expect(Object.is(b.startT, f.startT), `startT of block ${i}`).toBe(true);
      });
      // Before the gap the blocks are the gap-free run's, bit for bit.
      const before = Math.floor(gapAt / 256) - 1;
      expectBlocksEqual(free.blocks.slice(0, before), run.blocks.slice(0, before));
      expect(run.feed.stats().droppedBlocks).toBe(gap / 256);
    });

    it(`and every block equals the web path fed zeros for the lost frames (${name})`, () => {
      const run = nativeRun(signal, rate, origin, [512], { drop: { at: gapAt, frames: gap }, seqJump });
      const zeroed = signal.slice();
      zeroed.fill(0, gapAt, gapAt + gap);
      expectBlocksEqual(webBlocks(zeroed, rate, origin), run.blocks);
    });
  }

  it('the fault carries the sequence number of the packet after the gap, and fires once however many gaps follow', () => {
    const faults: CaptureFault[] = [];
    const feed = new NativeCaptureFeed({ engineRate: rate, sink: () => undefined, now: () => 0, backlogVoidMs: 120, onFault: (f) => faults.push(f) });
    feed.push(encodeCapturePacket({ seq: 0, firstFrame: 0 }, noise(512, 1)));
    feed.push(encodeCapturePacket({ seq: 1, firstFrame: 512 }, noise(512, 2)));
    feed.push(encodeCapturePacket({ seq: 2, firstFrame: 2048, droppedBefore: 512 }, noise(512, 3)));
    feed.push(encodeCapturePacket({ seq: 3, firstFrame: 4096, droppedBefore: 1536 }, noise(512, 4)));
    expect(faults).toEqual([{ kind: 'capture-gap', seq: 2 }]);
  });

  it('the drift flag (bit 1) and clock-step flag (bit 4) void the capture: one capture-gap fault; other flags do not', () => {
    for (const [flags, voids] of [[PACKET_FLAGS.drift, true], [PACKET_FLAGS.clockStep, true], [PACKET_FLAGS.clockStep | PACKET_FLAGS.last, true], [PACKET_FLAGS.resampled | PACKET_FLAGS.inputZero | PACKET_FLAGS.last, false]] as const) {
      const faults: CaptureFault[] = [];
      const feed = new NativeCaptureFeed({ engineRate: rate, sink: () => undefined, now: () => 0, backlogVoidMs: 120, onFault: (f) => faults.push(f) });
      feed.push(encodeCapturePacket({ seq: 0, firstFrame: 0 }, noise(512, 1)));
      expect(feed.voided).toBe(false);
      feed.push(encodeCapturePacket({ flags, seq: 1, firstFrame: 512 }, noise(512, 2)));
      feed.push(encodeCapturePacket({ flags, seq: 2, firstFrame: 1024 }, noise(512, 3)));
      expect(faults).toEqual(voids ? [{ kind: 'capture-gap', seq: 1 }] : []);
      expect(feed.voided).toBe(voids);
    }
    expect(PACKET_FLAGS.clockStep).toBe(16);
  });

  it('voidCapture (an xrun, a late take click) is the same single fault', () => {
    const faults: CaptureFault[] = [];
    const feed = new NativeCaptureFeed({ engineRate: rate, sink: () => undefined, now: () => 0, backlogVoidMs: 120, onFault: (f) => faults.push(f) });
    feed.push(encodeCapturePacket({ seq: 0, firstFrame: 0 }, noise(512, 1)));
    feed.voidCapture();
    feed.voidCapture();
    expect(faults).toEqual([{ kind: 'capture-gap', seq: 1 }]);
  });

  it('a skipped sequence number alone is a gap; contiguous frames then add no zeros', () => {
    const faults: CaptureFault[] = [];
    const blocks: CaptureBlock[] = [];
    const feed = new NativeCaptureFeed({ engineRate: rate, sink: (m) => void (m.type === 'block' && blocks.push(m.block)), now: () => 0, backlogVoidMs: 120, onFault: (f) => faults.push(f) });
    feed.push(encodeCapturePacket({ seq: 0, firstFrame: 0 }, noise(512, 1)));
    feed.push(encodeCapturePacket({ seq: 5, firstFrame: 512 }, noise(512, 2)));
    expect(faults).toEqual([{ kind: 'capture-gap', seq: 5 }]);
    expect(blocks).toHaveLength(4);
    expect(feed.stats().droppedBlocks).toBe(0);
  });

  it('a gap before the first packet reaching the feed (droppedBefore on packet 0) is a fault', () => {
    const faults: CaptureFault[] = [];
    const feed = new NativeCaptureFeed({ engineRate: rate, sink: () => undefined, now: () => 0, backlogVoidMs: 120, onFault: (f) => faults.push(f) });
    feed.push(encodeCapturePacket({ seq: 0, firstFrame: 1000, droppedBefore: 64 }, noise(512, 1)));
    expect(faults).toEqual([{ kind: 'capture-gap', seq: 0 }]);
  });

  it('a malformed packet is a lost packet: a gap, counted, and the stream goes on', () => {
    const faults: CaptureFault[] = [];
    const blocks: CaptureBlock[] = [];
    const feed = new NativeCaptureFeed({ engineRate: rate, sink: (m) => void (m.type === 'block' && blocks.push(m.block)), now: () => 0, backlogVoidMs: 120, onFault: (f) => faults.push(f) });
    feed.push(encodeCapturePacket({ seq: 0, firstFrame: 0 }, noise(512, 1)));
    feed.push(new ArrayBuffer(10));
    feed.push(encodeCapturePacket({ seq: 1, firstFrame: 512 }, noise(512, 2)));
    expect(feed.malformedPackets).toBe(1);
    expect(faults).toHaveLength(1);
    expect(blocks).toHaveLength(4);
  });

  it('an overlapping packet (never sent by the engine) is trimmed, not processed twice', () => {
    const blocks: CaptureBlock[] = [];
    const sig = noise(2048, 9);
    const feed = new NativeCaptureFeed({ engineRate: rate, sink: (m) => void (m.type === 'block' && blocks.push(m.block)), now: () => 0, backlogVoidMs: 120, onFault: () => undefined });
    feed.push(encodeCapturePacket({ seq: 0, firstFrame: 0 }, sig.subarray(0, 1024)));
    feed.push(encodeCapturePacket({ seq: 1, firstFrame: 512 }, sig.subarray(512, 2048)));
    expectBlocksEqual(webBlocks(sig, rate, 0), blocks);
  });

  it('a last packet of zero frames (24 bytes, header only) makes no block and no fault, and the stream before it is unchanged', () => {
    const signal = noise(256 * 6 + 100, 21);
    const base = nativeRun(signal, 48000, 5000, [512]);
    const blocks: CaptureBlock[] = [];
    const faults: CaptureFault[] = [];
    const feed = new NativeCaptureFeed({ engineRate: 48000, sink: (m) => void (m.type === 'block' && blocks.push(m.block)), now: () => 0, backlogVoidMs: 120, onFault: (f) => faults.push(f) });
    let seq = 0;
    for (let at = 0; at < signal.length; at += 512) {
      const part = signal.subarray(at, Math.min(signal.length, at + 512));
      feed.push(encodeCapturePacket({ seq: seq++, firstFrame: 5000 + at }, part));
    }
    const last = encodeCapturePacket({ flags: PACKET_FLAGS.last, seq: seq++, firstFrame: 5000 + signal.length }, new Float32Array(0));
    expect(last.byteLength).toBe(PACKET_HEADER_BYTES);
    feed.push(last);
    expect(faults).toEqual([]);
    expect(blocks).toHaveLength(base.blocks.length);
    expect(feed.malformedPackets).toBe(0);
  });

  it('packets after stop are ignored', () => {
    const blocks: CaptureBlock[] = [];
    const feed = new NativeCaptureFeed({ engineRate: rate, sink: (m) => void (m.type === 'block' && blocks.push(m.block)), now: () => 0, backlogVoidMs: 120, onFault: () => undefined });
    feed.push(encodeCapturePacket({ seq: 0, firstFrame: 0 }, noise(512, 1)));
    feed.stop();
    feed.push(encodeCapturePacket({ seq: 1, firstFrame: 512 }, noise(512, 2)));
    expect(blocks).toHaveLength(2);
  });
});

describe('backlog (R32)', () => {
  it('queued audio above 120 ms on the engine clock is one backlog fault; below it is none', () => {
    const rate = 48000;
    let now = 0;
    const faults: CaptureFault[] = [];
    const feed = new NativeCaptureFeed({ engineRate: rate, sink: () => undefined, now: () => now, backlogVoidMs: 120, onFault: (f) => faults.push(f) });
    const sig = noise(94 * 512, 4);
    for (let p = 0; p < 94; p++) {
      now = (p * 512 + 512) / rate + 0.05;
      feed.push(encodeCapturePacket({ seq: p, firstFrame: p * 512 }, sig.subarray(p * 512, p * 512 + 512)));
    }
    expect(faults).toEqual([]);
    expect(feed.stats().maxQueueMs).toBeLessThan(120);
    now += 0.5;
    feed.push(encodeCapturePacket({ seq: 94, firstFrame: 94 * 512 }, noise(512, 8)));
    feed.push(encodeCapturePacket({ seq: 95, firstFrame: 95 * 512 }, noise(512, 9)));
    expect(faults).toHaveLength(1);
    expect(faults[0]).toMatchObject({ kind: 'backlog' });
    expect((faults[0] as { queueMs: number }).queueMs).toBeGreaterThan(120);
  });
});
