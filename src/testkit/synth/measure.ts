/**
 * Audio-domain measurements used to check the synth's ground truth against what it actually rendered (P3
 * acceptance: truth within 1 ms and 1 c on clean renders), and available to the accuracy gates (P18).
 * These are reference measurements for tests, not product DSP.
 */
import type { EnvelopeSeries } from '../../core/onset-definition.ts';
import { applyCascade, butterworth } from './dsp-util.ts';
import { LOW_BAND_HZ } from './timbres.ts';

/** Zero-phase low-pass at the analysis band edge (3 kHz): 4th-order Butterworth run forward and backward. */
export function lowBand(x: ArrayLike<number>, sr: number): Float64Array {
  const y = Float64Array.from(x as ArrayLike<number>);
  const stages = butterworth('lp', LOW_BAND_HZ, 4, sr);
  applyCascade(y, stages);
  y.reverse();
  applyCascade(y, stages);
  y.reverse();
  return y;
}

/**
 * Envelope in dB from audio: RMS over a centred window of exactly one period of `periodSec` (so a steady periodic
 * tone has no ripple), every `hopSec`, floored at `floorDb`. Pass the low-band signal.
 */
export function audioEnvelope(x: Float64Array, sr: number, startT: number, endT: number, periodSec: number, floorDb: number, hopSec = 0.00025): EnvelopeSeries {
  const w = Math.max(4, Math.round(periodSec * sr));
  const csum = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) csum[i + 1] = (csum[i] as number) + (x[i] as number) ** 2;
  const hops = Math.max(1, Math.floor((endT - startT) / hopSec) + 1);
  const values = new Float64Array(hops);
  for (let h = 0; h < hops; h++) {
    const c = (startT + h * hopSec) * sr;
    const a = Math.max(0, Math.round(c - w / 2));
    const b = Math.min(x.length, a + w);
    const p = b > a ? ((csum[b] as number) - (csum[a] as number)) / (b - a) : 0;
    values[h] = Math.max(floorDb, p > 0 ? 10 * Math.log10(p) : -Infinity);
  }
  return { startT, hopSec, values };
}

/** |DTFT| of the Hann-windowed segment at `hz`. */
function dtftMag(x: ArrayLike<number>, i0: number, n: number, sr: number, hz: number): number {
  const w = (2 * Math.PI * hz) / sr;
  let re = 0;
  let im = 0;
  for (let k = 0; k < n; k++) {
    const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (n - 1));
    const v = (x[i0 + k] as number) * win;
    re += v * Math.cos(w * k);
    im -= v * Math.sin(w * k);
  }
  return Math.hypot(re, im);
}

/**
 * Frequency of the spectral peak nearest `guessHz` (within +-`searchCents`) in [t0, t1], by golden-section search
 * on the Hann-windowed DTFT. Sub-cent on steady tones of 150 ms or more.
 */
export function measureFrequency(x: ArrayLike<number>, sr: number, t0: number, t1: number, guessHz: number, searchCents = 20): number {
  const i0 = Math.max(0, Math.round(t0 * sr));
  const n = Math.min(x.length - i0, Math.round((t1 - t0) * sr));
  let a = guessHz * 2 ** (-searchCents / 1200);
  let b = guessHz * 2 ** (searchCents / 1200);
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a);
  let d = a + g * (b - a);
  let fc = dtftMag(x, i0, n, sr, c);
  let fd = dtftMag(x, i0, n, sr, d);
  for (let it = 0; it < 40; it++) {
    if (fc > fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - g * (b - a);
      fc = dtftMag(x, i0, n, sr, c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + g * (b - a);
      fd = dtftMag(x, i0, n, sr, d);
    }
  }
  return (a + b) / 2;
}

/** Relative level of the partial at `hz`, dB re the strongest of `refHz` (Hann DTFT). */
export function partialLevelDb(x: ArrayLike<number>, sr: number, t0: number, t1: number, hz: number, refHz: number): number {
  const i0 = Math.max(0, Math.round(t0 * sr));
  const n = Math.min(x.length - i0, Math.round((t1 - t0) * sr));
  return 20 * Math.log10(dtftMag(x, i0, n, sr, hz) / dtftMag(x, i0, n, sr, refHz));
}
