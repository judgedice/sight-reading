/**
 * A capture recording for calibration analysis (01 §7.8): `CaptureBlock`s laid out on contiguous low-band and
 * hi-band arrays with exact clock times. Pure; no audio leaves this object (01 §7.9 "exports no audio").
 *
 * Timing (01 §7.2, P4a, P11): a capture posts one block per 256 input frames (two render quanta). Block `seq` n
 * covers input frames [256 n, 256 (n + 1)) counted from the capture origin; its first decimated sample is input
 * frame `ceil(256 n / D) * D` and `startT` is that frame's clock time. Hi-band sub-block k (1 ms) covers input
 * frames [ceil(k rate / 1000), ceil((k + 1) rate / 1000)) (src/dsp/hiband.ts), so block n's first hi-band value is
 * sub-block `floor(256 n * 1000 / rate)`. Missing seqs are left as zeros and counted.
 */
import type { CaptureBlock } from '../core/platform.ts';

/** Input frames per capture block (01 §7.2: a post every 2 quanta of 128 frames). */
export const CAPTURE_BLOCK_FRAMES = 256;

class Growable {
  data = new Float32Array(1 << 14);
  length = 0;
  ensure(n: number): void {
    if (n <= this.data.length) return;
    let cap = this.data.length;
    while (cap < n) cap *= 2;
    const d = new Float32Array(cap);
    d.set(this.data.subarray(0, this.length));
    this.data = d;
  }
  write(at: number, src: Float32Array): void {
    this.ensure(at + src.length);
    this.data.set(src, at);
    this.length = Math.max(this.length, at + src.length);
  }
  view(): Float32Array {
    return this.data.subarray(0, this.length);
  }
}

export class CaptureRecording {
  /** Context (input) sample rate, Hz. */
  readonly inputRate: number;
  /** Decimation factor D = round(rate / 16000) (01 §7.2). */
  readonly factor: number;
  readonly analysisRate: number;
  /** Clock time of input frame 0 of the capture; null before the first block. */
  origin: number | null = null;
  /** Blocks missing from the seq sequence. */
  missingBlocks = 0;
  blocks = 0;
  private seq0 = 0;
  private lastSeq: number | null = null;
  private lowBase = 0;
  private hiBase = 0;
  private readonly low = new Growable();
  private readonly hi = new Growable();

  constructor(inputRate: number) {
    if (!(inputRate >= 16000)) throw new RangeError(`CaptureRecording: input rate ${inputRate} Hz is below 16 kHz`);
    this.inputRate = inputRate;
    this.factor = Math.max(1, Math.round(inputRate / 16000));
    this.analysisRate = inputRate / this.factor;
  }

  push(b: CaptureBlock): void {
    if (Math.abs(b.analysisRate - this.analysisRate) > 1e-6) {
      throw new RangeError(`CaptureRecording: block analysisRate ${b.analysisRate} does not match ${this.inputRate} Hz / ${this.factor}`);
    }
    const D = this.factor;
    if (this.origin === null) {
      this.seq0 = b.seq;
      this.origin = (b.startT as number) - (Math.ceil((CAPTURE_BLOCK_FRAMES * b.seq) / D) * D) / this.inputRate;
      this.lowBase = Math.ceil((CAPTURE_BLOCK_FRAMES * b.seq) / D);
      this.hiBase = Math.floor((CAPTURE_BLOCK_FRAMES * b.seq * 1000) / this.inputRate);
    } else if (this.lastSeq !== null && b.seq !== this.lastSeq + 1) {
      this.missingBlocks += Math.max(0, b.seq - this.lastSeq - 1);
    }
    if (b.seq < this.seq0) return;
    this.lastSeq = b.seq;
    this.blocks++;
    const lowAt = Math.ceil((CAPTURE_BLOCK_FRAMES * b.seq) / D) - this.lowBase;
    const hiAt = Math.floor((CAPTURE_BLOCK_FRAMES * b.seq * 1000) / this.inputRate) - this.hiBase;
    this.low.write(lowAt, b.lowband);
    this.hi.write(hiAt, b.hiEnergy);
  }

  /** Low band (decimated, analysis rate). */
  get lowband(): Float32Array {
    return this.low.view();
  }

  /** Hi-band energy per 1 ms sub-block (sum of squares of the 5 kHz high-pass). */
  get hiEnergy(): Float32Array {
    return this.hi.view();
  }

  /** Clock time of low-band sample 0. */
  get lowStartT(): number {
    return (this.origin ?? 0) + (this.lowBase * this.factor) / this.inputRate;
  }

  /** Clock time of low-band sample j. */
  lowTime(j: number): number {
    return this.lowStartT + (j * this.factor) / this.inputRate;
  }

  /** Fractional low-band index of a clock time. */
  lowIndex(t: number): number {
    return ((t - this.lowStartT) * this.inputRate) / this.factor;
  }

  /** Input frame (from the capture origin) where hi-band sub-block k starts. */
  private hiFrame(k: number): number {
    return Math.ceil(((this.hiBase + k) * this.inputRate) / 1000);
  }

  /** Clock time where hi-band sub-block k starts. */
  hiStart(k: number): number {
    return (this.origin ?? 0) + this.hiFrame(k) / this.inputRate;
  }

  /** Number of input samples in hi-band sub-block k. */
  hiSamples(k: number): number {
    return this.hiFrame(k + 1) - this.hiFrame(k);
  }

  /** Mean power (per input sample) of hi-band sub-block k. */
  hiPower(k: number): number {
    return (this.hi.data[k] ?? 0) / this.hiSamples(k);
  }

  /** Index of the hi-band sub-block containing clock time t (may be out of range). */
  hiIndexAt(t: number): number {
    const frame = Math.floor((t - (this.origin ?? 0)) * this.inputRate + 1e-6);
    return Math.floor((frame * 1000) / this.inputRate + 1e-9) - this.hiBase;
  }

  /** Clock time just after the last recorded sample. */
  get endT(): number {
    return this.lowTime(this.lowband.length);
  }
}
