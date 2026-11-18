/**
 * Capture filters (01 section 7.2): a 3 kHz 8th-order low-pass (four cascaded biquads) ahead of the
 * decimator, and a 5 kHz 4th-order high-pass for the hi-band energy. Butterworth sections via the RBJ
 * cookbook with the Q of each pole pair; coefficients are computed once per input rate and cached, so
 * they are fixed per rate. Pure, no DOM, no allocation in `process`.
 */

export const LOWPASS_HZ = 3000;
export const LOWPASS_ORDER = 8;
export const HIGHPASS_HZ = 5000;
export const HIGHPASS_ORDER = 4;

/** Q of each second-order section of an even-order Butterworth filter. */
export function butterworthQs(order: number): number[] {
  if (order < 2 || order % 2 !== 0) throw new RangeError('order must be an even number >= 2');
  const qs: number[] = [];
  for (let k = 0; k < order / 2; k++) qs.push(1 / (2 * Math.cos(((2 * k + 1) * Math.PI) / (2 * order))));
  return qs;
}

/** Flat coefficients, 5 per section: b0, b1, b2, a1, a2 (a0 normalised to 1). */
export type BiquadCoefficients = Float64Array;

/** RBJ biquad section. */
export function designBiquad(kind: 'lp' | 'hp', fc: number, q: number, fs: number): [number, number, number, number, number] {
  if (!(fc > 0 && fc < fs / 2)) throw new RangeError(`cutoff ${fc} Hz must lie below Nyquist for rate ${fs}`);
  const w0 = (2 * Math.PI * fc) / fs;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = kind === 'lp' ? (1 - cos) / 2 : (1 + cos) / 2;
  const b1 = kind === 'lp' ? 1 - cos : -(1 + cos);
  return [b0 / a0, b1 / a0, b0 / a0, (-2 * cos) / a0, (1 - alpha) / a0];
}

function design(kind: 'lp' | 'hp', fc: number, order: number, fs: number): BiquadCoefficients {
  const qs = butterworthQs(order);
  const out = new Float64Array(qs.length * 5);
  qs.forEach((q, i) => out.set(designBiquad(kind, fc, q, fs), i * 5));
  return out;
}

const lpCache = new Map<number, BiquadCoefficients>();
const hpCache = new Map<number, BiquadCoefficients>();

/** 3 kHz 8th-order low-pass coefficients for an input rate (cached; treat as read-only). */
export function lowpassCoefficients(inputRate: number): BiquadCoefficients {
  let c = lpCache.get(inputRate);
  if (!c) {
    c = design('lp', LOWPASS_HZ, LOWPASS_ORDER, inputRate);
    lpCache.set(inputRate, c);
  }
  return c;
}

/** 5 kHz 4th-order high-pass coefficients for an input rate (cached; treat as read-only). */
export function highpassCoefficients(inputRate: number): BiquadCoefficients {
  let c = hpCache.get(inputRate);
  if (!c) {
    c = design('hp', HIGHPASS_HZ, HIGHPASS_ORDER, inputRate);
    hpCache.set(inputRate, c);
  }
  return c;
}

/** Cascade of biquads in transposed direct form II, float64 state. */
export class BiquadCascade {
  private readonly c: BiquadCoefficients;
  private readonly z: Float64Array;
  readonly sections: number;

  constructor(coefficients: BiquadCoefficients) {
    this.c = coefficients;
    this.sections = coefficients.length / 5;
    this.z = new Float64Array(this.sections * 2);
  }

  reset(): void {
    this.z.fill(0);
  }

  process(x: number): number {
    const c = this.c;
    const z = this.z;
    let v = x;
    for (let s = 0, ci = 0, zi = 0; s < this.sections; s++, ci += 5, zi += 2) {
      const y = (c[ci] as number) * v + (z[zi] as number);
      z[zi] = (c[ci + 1] as number) * v - (c[ci + 3] as number) * y + (z[zi + 1] as number);
      z[zi + 1] = (c[ci + 2] as number) * v - (c[ci + 4] as number) * y;
      v = y;
    }
    return v;
  }
}

/** Magnitude response in dB of a coefficient set at `hz` for sample rate `fs` (analysis helper). */
export function magnitudeDb(coefficients: BiquadCoefficients, hz: number, fs: number): number {
  const w = (2 * Math.PI * hz) / fs;
  const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  let db = 0;
  for (let i = 0; i < coefficients.length; i += 5) {
    const b0 = coefficients[i] as number, b1 = coefficients[i + 1] as number, b2 = coefficients[i + 2] as number;
    const a1 = coefficients[i + 3] as number, a2 = coefficients[i + 4] as number;
    const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2);
    const dr = 1 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
    db += 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
  }
  return db;
}
