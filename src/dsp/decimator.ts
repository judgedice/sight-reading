/**
 * Pure, phase-carrying decimator (01 sections 5.6, 7.2). Low-passes at 3 kHz (8th order) and keeps every
 * `D`-th input sample, `D = round(rate / 16000)`, where the phase is an integer input-sample counter, so
 * no sample is lost or duplicated across chunk boundaries and no floating-point drift accumulates.
 * Zero allocation after construction.
 */
import type { Decimator } from '../core/api.ts';
import { BiquadCascade, lowpassCoefficients } from './filters.ts';

export const TARGET_RATE = 16000;

export class PhaseDecimator implements Decimator {
  readonly inputRate: number;
  readonly factor: number;
  readonly analysisRate: number;
  private readonly lp: BiquadCascade;
  /** Input samples consumed since reset. */
  private consumed = 0;
  /** Absolute input index (since reset) of the next output sample. */
  private nextOut = 0;

  constructor(inputRate: number) {
    if (!(inputRate >= TARGET_RATE)) throw new RangeError(`input rate ${inputRate} Hz is below ${TARGET_RATE} Hz`);
    this.inputRate = inputRate;
    this.factor = Math.max(1, Math.round(inputRate / TARGET_RATE));
    this.analysisRate = inputRate / this.factor;
    this.lp = new BiquadCascade(lowpassCoefficients(inputRate));
  }

  get nextOutputInputPos(): number {
    return this.nextOut;
  }

  /** Total input samples consumed since reset. */
  get inputConsumed(): number {
    return this.consumed;
  }

  process(input: Float32Array, out: Float32Array, outOffset: number): number {
    const lp = this.lp;
    const n = input.length;
    const D = this.factor;
    let w = outOffset;
    let idx = this.consumed;
    let next = this.nextOut;
    for (let i = 0; i < n; i++, idx++) {
      const y = lp.process(input[i] as number);
      if (idx === next) {
        out[w++] = y;
        next += D;
      }
    }
    this.consumed = idx;
    this.nextOut = next;
    return w - outOffset;
  }

  reset(): void {
    this.lp.reset();
    this.consumed = 0;
    this.nextOut = 0;
  }
}

export const decimatorCreate = (inputRate: number): Decimator => new PhaseDecimator(inputRate);
