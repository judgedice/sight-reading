/**
 * The capture worklet's logic (01 §7.2), kept free of AudioWorkletGlobalScope so Node tests can run it.
 * `capture.worklet.ts` wraps it in an AudioWorkletProcessor.
 *
 * Per render quantum: downmix to mono and append to a 256-frame block buffer. Every 256 frames (2 quanta) the
 * block runs through the production primitives exactly as `FakeAudioBackend.emitBlock` does: `PhaseDecimator`
 * (3 kHz 8th-order low-pass, decimation by round(rate / 16000), phase carried across blocks) and `HiBandEnergy`
 * (5 kHz 4th-order high-pass, energy per 1 ms sub-block). `startT` is the context time of the block's first
 * decimated sample: `(originFrame + decimator.nextOutputInputPos) / rate`, an exact integer frame position.
 *
 * Buffers come from a pool of `poolSize` lowband/hiEnergy pairs that are transferred to the DSP worker and
 * returned (`CaptureReturn`). If the pool is empty the block is dropped and counted (`capture-gap`), but the
 * filters still run so the phase and `startT` of later blocks stay exact. Until the first buffer comes back on
 * the port (probe phase), blocks are posted as fresh copies so a slow or non-returning worker cannot drain the
 * pool before the backend decides to fall back to the relay.
 */
import type { CaptureBlock, ClockSeconds, WorkerMessage } from '../../../core/platform.ts';
import { PhaseDecimator } from '../../../dsp/decimator.ts';
import { HiBandEnergy } from '../../../dsp/hiband.ts';
import { FRAMES_PER_BLOCK, isCaptureReturn, type FromWorklet, type ToWorklet } from './protocol.ts';

/** The part of a `MessagePort` the core uses. */
export interface CorePort {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent) => void) | null;
  close?(): void;
}

type Mode = 'idle' | 'probe' | 'pool' | 'relay';

interface BufferPair {
  low: Float32Array;
  hi: Float32Array;
}

export class CaptureCore {
  readonly sampleRate: number;
  readonly analysisRate: number;
  /** Input frames processed since construction (clock-rate check, 01 §7.8). */
  framesProcessed = 0;

  private readonly ctl: CorePort;
  private readonly currentFrame: () => number;
  private readonly decimator: PhaseDecimator;
  private readonly hiBand: HiBandEnergy;
  private readonly inBuf = new Float32Array(FRAMES_PER_BLOCK);
  private readonly lowLen: number;
  private readonly hiLen: number;
  /** Scratch outputs for dropped blocks (the filters must still run). */
  private readonly scratch: BufferPair;

  private mode: Mode = 'idle';
  private workerPort: CorePort | null = null;
  private poolSize = 0;
  private readonly free: BufferPair[] = [];
  private fill = 0;
  private originFrame = -1;
  /** `framesProcessed` at the capture's first quantum; -1 when not capturing. */
  private startFp = -1;
  /** `currentFrame() − framesProcessed` read in the latest quantum. */
  private frameBase = 0;
  private seq = 0;
  private posted = 0;
  private dropped = 0;
  private maxOutstanding = 0;
  private statsEvery = 8;

  constructor(sampleRate: number, ctl: CorePort, currentFrame: () => number) {
    this.sampleRate = sampleRate;
    this.ctl = ctl;
    this.currentFrame = currentFrame;
    this.decimator = new PhaseDecimator(sampleRate);
    this.hiBand = new HiBandEnergy(sampleRate);
    this.analysisRate = this.decimator.analysisRate;
    this.lowLen = Math.ceil(FRAMES_PER_BLOCK / this.decimator.factor) + 1;
    this.hiLen = this.hiBand.maxSubBlocks(FRAMES_PER_BLOCK);
    this.scratch = this.allocPair();
    ctl.onmessage = (ev: MessageEvent) => this.onControl(ev.data as ToWorklet);
  }

  /** Buffer pairs currently with the consumer (port or relay mode). */
  get outstanding(): number {
    return this.mode === 'pool' || this.mode === 'relay' ? this.poolSize - this.free.length : 0;
  }

  get capturing(): boolean {
    return this.mode !== 'idle';
  }

  /**
   * One render quantum. `channels` is the node's first input (absent or empty when nothing is connected, which
   * counts as silence so the block timeline stays contiguous). Always returns true (keep the node alive).
   */
  process(channels: readonly Float32Array[] | undefined, quantumFrames = 128): boolean {
    const first = channels?.[0];
    const n = first ? first.length : quantumFrames;
    // The context frame of this quantum's first sample, as an offset from our own frame count. Chromium reports a
    // `currentFrame` one render callback (512 frames) stale in a new node's first quantum, so the origin is fixed
    // from the base read when the first block is emitted (2 quanta in), not from the first quantum's reading.
    this.frameBase = this.currentFrame() - this.framesProcessed;
    if (this.mode !== 'idle') {
      if (this.startFp < 0) this.startFp = this.framesProcessed;
      const nch = channels ? channels.length : 0;
      let i = 0;
      while (i < n) {
        const take = Math.min(n - i, FRAMES_PER_BLOCK - this.fill);
        const buf = this.inBuf;
        if (nch === 0) {
          buf.fill(0, this.fill, this.fill + take);
        } else if (nch === 1) {
          buf.set((channels as readonly Float32Array[])[0]!.subarray(i, i + take), this.fill);
        } else {
          const chs = channels as readonly Float32Array[];
          const g = 1 / nch;
          for (let k = 0; k < take; k++) {
            let s = 0;
            for (let c = 0; c < nch; c++) s += chs[c]![i + k] as number;
            buf[this.fill + k] = s * g;
          }
        }
        this.fill += take;
        i += take;
        if (this.fill === FRAMES_PER_BLOCK) {
          this.emitBlock();
          this.fill = 0;
        }
      }
    }
    this.framesProcessed += n;
    return true;
  }

  private allocPair(): BufferPair {
    return { low: new Float32Array(this.lowLen), hi: new Float32Array(this.hiLen) };
  }

  private post(m: FromWorklet, transfer?: Transferable[]): void {
    this.ctl.postMessage(m, transfer);
  }

  private emitBlock(): void {
    if (this.originFrame < 0) {
      this.originFrame = this.frameBase + this.startFp;
      this.post({ type: 'started', originFrame: this.originFrame, analysisRate: this.analysisRate });
    }
    const dec = this.decimator;
    // Exact integer input position of the first decimated sample of this block, read before process().
    const startT = (this.originFrame + dec.nextOutputInputPos) / this.sampleRate;
    let pair: BufferPair | undefined;
    let pooled = false;
    if (this.mode === 'probe') pair = this.allocPair();
    else {
      pair = this.free.pop();
      pooled = true;
    }
    const drop = pair === undefined;
    const out = pair ?? this.scratch;
    const nLow = dec.process(this.inBuf, out.low, 0);
    const nHi = this.hiBand.process(this.inBuf, out.hi, 0);
    const seq = this.seq++;
    if (drop) {
      this.dropped++;
      this.post({ type: 'drop', seq, dropped: this.dropped });
      return;
    }
    const block: CaptureBlock = {
      v: 1,
      startT: startT as ClockSeconds,
      lowband: new Float32Array(out.low.buffer, 0, nLow),
      hiEnergy: new Float32Array(out.hi.buffer, 0, nHi),
      analysisRate: this.analysisRate,
      seq,
    };
    const transfer = [out.low.buffer, out.hi.buffer];
    if (this.mode === 'relay' || !this.workerPort) this.post({ type: 'block', block }, transfer);
    else {
      const msg: WorkerMessage = { v: 1, type: 'block', block };
      this.workerPort.postMessage(msg, transfer);
    }
    this.posted++;
    if (pooled) {
      const o = this.outstanding;
      if (o > this.maxOutstanding) this.maxOutstanding = o;
    }
    if (this.posted % this.statsEvery === 0) this.postStats();
  }

  private postStats(): void {
    this.post({ type: 'stats', posted: this.posted, dropped: this.dropped, outstanding: this.outstanding, maxOutstanding: this.maxOutstanding });
  }

  private accept(low: ArrayBuffer, hi: ArrayBuffer): void {
    if (low.byteLength !== this.lowLen * 4 || hi.byteLength !== this.hiLen * 4) return;
    if (this.free.length >= this.poolSize) return;
    this.free.push({ low: new Float32Array(low), hi: new Float32Array(hi) });
  }

  private onWorkerMessage(data: unknown): void {
    if (!isCaptureReturn(data)) return;
    if (this.mode === 'probe') {
      this.mode = 'pool';
      this.post({ type: 'port-ok' });
    }
    this.accept(data.lowband, data.hiEnergy);
  }

  private onControl(m: ToWorklet): void {
    switch (m.type) {
      case 'start': {
        this.poolSize = m.poolSize;
        this.statsEvery = Math.max(1, m.statsEvery);
        // Warm-up: top the pool up to its size (buffers lost with an earlier consumer are replaced here).
        while (this.free.length < this.poolSize) this.free.push(this.allocPair());
        this.free.length = Math.min(this.free.length, this.poolSize);
        this.decimator.reset();
        this.hiBand.reset();
        this.fill = 0;
        this.seq = 0;
        this.posted = 0;
        this.dropped = 0;
        this.maxOutstanding = 0;
        this.originFrame = -1;
        this.startFp = -1;
        this.detachWorkerPort();
        if (m.relay || !m.port) {
          this.mode = 'relay';
        } else {
          const port = m.port as unknown as CorePort;
          this.workerPort = port;
          port.onmessage = (ev: MessageEvent) => this.onWorkerMessage(ev.data);
          this.mode = 'probe';
        }
        break;
      }
      case 'stop':
        if (this.mode !== 'idle') this.postStats();
        this.mode = 'idle';
        this.detachWorkerPort();
        break;
      case 'relay': {
        const port = this.workerPort;
        if (this.mode === 'pool') {
          // Buffers held by the worker will not come back to us; replace them (rare: forced switch after the probe).
          while (this.free.length < this.poolSize) this.free.push(this.allocPair());
        }
        if (port) port.onmessage = null;
        this.workerPort = null;
        if (this.mode !== 'idle') this.mode = 'relay';
        this.post({ type: 'port-back', port: port as unknown as MessagePort | null }, port ? [port as unknown as Transferable] : []);
        break;
      }
      case 'return':
        this.accept(m.lowband, m.hiEnergy);
        break;
      case 'frames':
        this.post({ type: 'frames', id: m.id, frames: this.framesProcessed });
        break;
    }
  }

  private detachWorkerPort(): void {
    if (this.workerPort) {
      this.workerPort.onmessage = null;
      this.workerPort.close?.();
      this.workerPort = null;
    }
  }
}
