/**
 * `NativeCaptureFeed` (docs/native/AUDIO-DESIGN.md sections 3 and 4): capture packets from the engine become
 * `CaptureBlock`s through the unchanged `CaptureCore`, so a block is bit-identical to the web one for the same input
 * frames. Decimation and the filters never run in Rust.
 *
 * - Each packet is parsed (24-byte header, mono f32 at the engine rate on the engine frame grid) and its samples go
 *   through one `CaptureCore` whose `currentFrame` is the packet's `firstFrame`. The core re-blocks to 256 frames, so
 *   the packet size never changes a block.
 * - The core runs in its relay mode on an in-memory port. Its pooled buffers come back at once (the feed copies each
 *   block for the sink, as the web relay does).
 * - Gaps: a packet whose `seq` is not the previous one plus 1, or that has `droppedBefore > 0`, or whose `firstFrame`
 *   is not where the last packet ended, is a capture gap. The feed pushes the missing frames as zeros through the core
 *   (so `startT` of later blocks stays exact) and fires `capture-gap` once per capture; the session voids the take.
 *   The frame jump decides how many zeros: `droppedBefore` only flags the gap.
 * - Backlog: per delivered block, `queueMs = now() - blockEnd` on the engine clock; above `backlogVoidMs` it fires
 *   `backlog` once per capture.
 */
import type { CaptureBlock, MessagePortLike, WorkerMessage } from '../../../core/platform.ts';
import { CaptureCore, type CorePort } from '../../shared/audio/capture-processor.ts';
import { FRAMES_PER_BLOCK, type FromWorklet, type ToWorklet } from '../../shared/audio/protocol.ts';
import { parseCapturePacket } from './wire.ts';

/** Capture problems that void a take (01 §7.9): the same shape the web backend reports. */
export type CaptureFault = { kind: 'backlog'; queueMs: number } | { kind: 'capture-gap'; seq: number };

export interface CaptureStats {
  postedBlocks: number;
  droppedBlocks: number;
  maxQueueMs: number;
  relay: boolean;
}

export interface CaptureFeedOptions {
  engineRate: number;
  /** A callback, or a port (a `MessageChannel` end the session hands to the DSP worker). Blocks are `WorkerMessage`s. */
  sink: MessagePortLike | ((m: WorkerMessage) => void);
  /** The engine clock (render head), seconds. */
  now(): number;
  /** Queued audio above this voids the take, ms (`capture.backlogVoidMs`). */
  backlogVoidMs: number;
  onFault(f: CaptureFault): void;
}

/** Zero frames are pushed through the core in pieces of this many. */
const ZERO_CHUNK = 4096;

export class NativeCaptureFeed {
  private readonly o: CaptureFeedOptions;
  private readonly ctl: CorePort;
  private readonly core: CaptureCore;
  /** Engine frame of the next sample the core is given. */
  private cursor = 0;
  private nextSeq: number | null = null;
  private nextFrame: number | null = null;
  private origin: number | null = null;
  private posted = 0;
  private lostFrames = 0;
  private coreDrops = 0;
  private maxQueueMs = 0;
  private gapFired = false;
  private backlogFired = false;
  private stopped = false;
  private badPackets = 0;
  private zeros: Float32Array | null = null;

  constructor(o: CaptureFeedOptions) {
    this.o = o;
    this.ctl = { postMessage: (m) => this.fromCore(m as FromWorklet), onmessage: null };
    this.core = new CaptureCore(o.engineRate, this.ctl, () => this.cursor, () => 0);
    const start: ToWorklet = { type: 'start', port: null, relay: true, poolSize: 4, statsEvery: Number.MAX_SAFE_INTEGER };
    this.ctl.onmessage?.({ data: start } as MessageEvent);
  }

  /** Engine frame of the first captured sample, once the first packet arrived. */
  get originFrame(): number | null {
    return this.origin;
  }

  /** The decimated rate of the blocks (exact, for example 16000 or 14700). */
  get analysisRate(): number {
    return this.core.analysisRate;
  }

  /** Packets that did not parse (counted as lost frames of unknown size, and a gap). */
  get malformedPackets(): number {
    return this.badPackets;
  }

  stats(): CaptureStats {
    return {
      postedBlocks: this.posted,
      droppedBlocks: this.coreDrops + Math.ceil(this.lostFrames / FRAMES_PER_BLOCK),
      maxQueueMs: this.maxQueueMs,
      relay: true,
    };
  }

  /** One packet from the engine's channel. */
  push(buf: ArrayBuffer): void {
    if (this.stopped) return;
    let p;
    try {
      p = parseCapturePacket(buf);
    } catch {
      this.badPackets++;
      this.noteGap(this.nextSeq ?? 0);
      return;
    }
    let samples = p.samples;
    let first = p.firstFrame;
    if (this.nextFrame === null) {
      this.origin = first;
      if (p.droppedBefore > 0) this.noteGap(p.seq);
    } else {
      const jump = first - this.nextFrame;
      if (p.seq !== this.nextSeq || p.droppedBefore > 0 || jump !== 0) this.noteGap(p.seq);
      if (jump > 0) this.pushZeros(this.nextFrame, jump);
      else if (jump < 0) {
        // Overlap (the engine never sends one): the frames already processed are skipped.
        samples = samples.subarray(Math.min(samples.length, -jump));
        first = this.nextFrame;
      }
    }
    this.nextSeq = p.seq + 1;
    this.nextFrame = first + samples.length;
    this.process(first, samples);
  }

  /** Ends the capture. The partial block of fewer than 256 frames is dropped, as in the worklet. */
  stop(): CaptureStats {
    if (!this.stopped) {
      this.stopped = true;
      this.ctl.onmessage?.({ data: { type: 'stop' } satisfies ToWorklet } as MessageEvent);
    }
    return this.stats();
  }

  private pushZeros(from: number, n: number): void {
    this.lostFrames += n;
    this.zeros ??= new Float32Array(ZERO_CHUNK);
    for (let done = 0; done < n; ) {
      const k = Math.min(ZERO_CHUNK, n - done);
      this.process(from + done, k === ZERO_CHUNK ? this.zeros : this.zeros.subarray(0, k));
      done += k;
    }
  }

  private process(firstFrame: number, samples: Float32Array): void {
    this.cursor = firstFrame;
    this.core.process([samples], samples.length);
  }

  private fromCore(m: FromWorklet): void {
    if (m.type === 'started') {
      this.origin ??= m.originFrame;
    } else if (m.type === 'drop') {
      this.coreDrops++;
      this.noteGap(m.seq);
    } else if (m.type === 'block') this.deliver(m.block);
  }

  private deliver(b: CaptureBlock): void {
    // Give the pooled buffers straight back, deliver copies (the sink may keep or transfer them).
    const lowband = b.lowband.slice();
    const hiEnergy = b.hiEnergy.slice();
    const back: ToWorklet = { type: 'return', lowband: b.lowband.buffer as ArrayBuffer, hiEnergy: b.hiEnergy.buffer as ArrayBuffer };
    this.ctl.onmessage?.({ data: back } as MessageEvent);
    this.posted++;
    const endT = b.startT + lowband.length / b.analysisRate;
    const queueMs = Math.max(0, (this.o.now() - endT) * 1000);
    if (queueMs > this.maxQueueMs) this.maxQueueMs = queueMs;
    if (queueMs > this.o.backlogVoidMs && !this.backlogFired) {
      this.backlogFired = true;
      this.o.onFault({ kind: 'backlog', queueMs });
    }
    const msg: WorkerMessage = { v: 1, type: 'block', block: { v: 1, startT: b.startT, lowband, hiEnergy, analysisRate: b.analysisRate, seq: b.seq } };
    const sink = this.o.sink;
    if (typeof sink === 'function') sink(msg);
    else sink.postMessage(msg, [lowband.buffer, hiEnergy.buffer]);
  }

  private noteGap(seq: number): void {
    if (this.gapFired) return;
    this.gapFired = true;
    this.o.onFault({ kind: 'capture-gap', seq });
  }
}
