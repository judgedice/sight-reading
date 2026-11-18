/**
 * 2 ms envelope (01 section 7.4 item 2): RMS of the decimated low band over non-overlapping hops of
 * `round(analysisRate * 0.002)` samples (32 at 16 kHz), reported in dB (re full scale, floored at
 * `ENVELOPE_FLOOR_DB`). Value i covers decimated samples [i*hop, (i+1)*hop) since reset, so its centre is
 * at `(i + 0.5) * hop / analysisRate`. Partial hops carry across calls. Zero allocation after construction.
 */
import { ENVELOPE_HOP_SEC } from '../core/onset-definition.ts';

export const ENVELOPE_FLOOR_DB = -120;

export class EnvelopeFollower {
  readonly analysisRate: number;
  /** Hop length in decimated samples. */
  readonly hop: number;
  /** Hop duration, seconds (`hop / analysisRate`). */
  readonly hopSec: number;
  private acc = 0;
  private count = 0;

  constructor(analysisRate: number) {
    this.analysisRate = analysisRate;
    this.hop = Math.max(1, Math.round(analysisRate * ENVELOPE_HOP_SEC));
    this.hopSec = this.hop / analysisRate;
  }

  maxValues(inputLength: number): number {
    return Math.ceil(inputLength / this.hop) + 1;
  }

  /** Writes completed hop levels (dB) into `out` from `outOffset`; returns how many. Only the first `length` samples of `lowband` are read
   * (so a pooled buffer needs no subarray view). */
  process(lowband: Float32Array, out: Float32Array, outOffset: number, length: number = lowband.length): number {
    let w = outOffset;
    let acc = this.acc;
    let count = this.count;
    const hop = this.hop;
    for (let i = 0; i < length; i++) {
      const x = lowband[i] as number;
      acc += x * x;
      if (++count === hop) {
        const db = acc > 0 ? 10 * Math.log10(acc / hop) : ENVELOPE_FLOOR_DB;
        out[w++] = db > ENVELOPE_FLOOR_DB ? db : ENVELOPE_FLOOR_DB;
        acc = 0;
        count = 0;
      }
    }
    this.acc = acc;
    this.count = count;
    return w - outOffset;
  }

  reset(): void {
    this.acc = 0;
    this.count = 0;
  }
}
