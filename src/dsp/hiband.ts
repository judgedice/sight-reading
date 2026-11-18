/**
 * Hi-band energy (01 section 7.2 step d): a 5 kHz 4th-order high-pass on a copy of the input, with the
 * squared output summed per 1 ms sub-block (48 input samples at 48 kHz). Sub-block k ends at input index
 * `ceil((k + 1) * rate / 1000)`, so non-integer sample counts per millisecond (44.1 kHz) stay exact.
 * The partial sub-block carries across calls. Zero allocation after construction.
 */
import { BiquadCascade, highpassCoefficients } from './filters.ts';

export class HiBandEnergy {
  readonly inputRate: number;
  private readonly hp: BiquadCascade;
  private acc = 0;
  private consumed = 0;
  private subIndex = 0;
  private nextEdge: number;

  constructor(inputRate: number) {
    this.inputRate = inputRate;
    this.hp = new BiquadCascade(highpassCoefficients(inputRate));
    this.nextEdge = Math.ceil(inputRate / 1000);
  }

  /** Upper bound on completed sub-blocks for `inputLength` samples. */
  maxSubBlocks(inputLength: number): number {
    return Math.ceil(inputLength / (this.inputRate / 1000)) + 1;
  }

  /** Writes completed 1 ms energies into `out` from `outOffset`; returns how many. */
  process(input: Float32Array, out: Float32Array, outOffset: number): number {
    const hp = this.hp;
    let w = outOffset;
    let idx = this.consumed;
    let acc = this.acc;
    for (let i = 0; i < input.length; i++, idx++) {
      const h = hp.process(input[i] as number);
      acc += h * h;
      if (idx + 1 >= this.nextEdge) {
        out[w++] = acc;
        acc = 0;
        this.subIndex++;
        this.nextEdge = Math.ceil(((this.subIndex + 1) * this.inputRate) / 1000);
      }
    }
    this.consumed = idx;
    this.acc = acc;
    return w - outOffset;
  }

  reset(): void {
    this.hp.reset();
    this.acc = 0;
    this.consumed = 0;
    this.subIndex = 0;
    this.nextEdge = Math.ceil(this.inputRate / 1000);
  }
}
