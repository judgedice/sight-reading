import { describe, expect, it } from 'vitest';
import {
  amDepthDb,
  ENVELOPE_HOP_SEC,
  isReArticulationDetectable,
  onsetFromSilence,
  pitchChangeOnset,
  repeatedOnset,
  type EnvelopeSeries,
  type FluxSample,
  type OnsetPitchFrame,
} from './onset-definition.ts';
import { createRng } from './rng.ts';

const HOP = ENVELOPE_HOP_SEC;

/** Analytic pitch: prev until T0, linear glide to next over `glide` seconds, then next. */
function pitchAt(t: number, prev: number, next: number, t0: number, glide: number): number {
  if (t <= t0) return prev;
  if (t >= t0 + glide) return next;
  return prev + ((next - prev) * (t - t0)) / glide;
}

function frames(hop: number, from: number, to: number, f: (t: number) => number, clarity = 0.95): OnsetPitchFrame[] {
  const out: OnsetPitchFrame[] = [];
  for (let t = from; t <= to + 1e-12; t += hop) out.push({ t, midi: f(t), clarity });
  return out;
}

describe('pitch-change onset', () => {
  it('finds the analytic midpoint crossing within 0.1 ms for ascending and descending glides', () => {
    const rng = createRng(11);
    for (let k = 0; k < 200; k++) {
      const prev = 55 + rng.int(0, 20);
      const step = [-7, -2, -1, 1, 2, 5][rng.int(0, 6)] as number;
      const next = prev + step;
      const glide = 0.03 + rng.next() * 0.07; // 30..100 ms, at least 2 hops wide at 8 ms
      const t0 = 0.5 + rng.next() * 0.01;
      const hop = 0.008;
      const fr = frames(hop, 0.3 + rng.next() * hop, 0.8, (t) => pitchAt(t, prev, next, t0, glide));
      const got = pitchChangeOnset(fr, prev, next, 0.85);
      expect(got).not.toBeNull();
      expect(Math.abs((got as number) - (t0 + glide / 2))).toBeLessThan(0.0001);
    }
  });

  it('interpolates across low-clarity and unvoiced frames in the transition', () => {
    const prev = 60;
    const next = 64;
    const t0 = 0.5;
    const glide = 0.08;
    const fr = frames(0.008, 0.3, 0.8, (t) => pitchAt(t, prev, next, t0, glide));
    for (const f of fr) {
      if (f.t > 0.52 && f.t < 0.56) f.clarity = 0.3; // dropped frames around the midpoint 0.54
      if (f.t > 0.56 && f.t < 0.565) f.midi = null;
    }
    const got = pitchChangeOnset(fr, prev, next, 0.85) as number;
    expect(Math.abs(got - (t0 + glide / 2))).toBeLessThan(0.0001);
  });

  it('is unbiased for a step change seen through centre-stamped frames', () => {
    // A frame straddling a step at T reads the mean pitch (window mean of 2 notes). Centre-stamped,
    // the midpoint crossing then lands on T.
    const T = 0.5003;
    const hop = 0.008;
    const w = 0.032;
    const mean = (t: number): number => {
      const frac = Math.min(1, Math.max(0, (t + w / 2 - T) / w));
      return 60 + 2 * frac;
    };
    const fr = frames(hop, 0.3, 0.8, mean);
    const got = pitchChangeOnset(fr, 60, 62, 0.85) as number;
    expect(Math.abs(got - T)).toBeLessThan(0.0001);
  });

  it('returns null without a crossing', () => {
    const fr = frames(0.008, 0, 0.5, () => 60);
    expect(pitchChangeOnset(fr, 60, 62, 0.85)).toBeNull();
    expect(pitchChangeOnset([], 60, 62, 0.85)).toBeNull();
    expect(pitchChangeOnset(fr, 60, 60, 0.85)).toBeNull();
  });
});

/** Envelope in dB: level L, dip to L - depth centred at tc with piecewise-linear fall `fall` and rise `rise`. */
function dipEnvelope(opts: {
  startT: number;
  endT: number;
  level: number;
  depth: number;
  fallStart: number;
  fall: number;
  hold: number;
  rise: number;
}): { env: EnvelopeSeries; halfRiseT: number } {
  const { level, depth, fallStart, fall, hold, rise } = opts;
  const riseStart = fallStart + fall + hold;
  const f = (t: number): number => {
    if (t <= fallStart) return level;
    if (t < fallStart + fall) return level - (depth * (t - fallStart)) / fall;
    if (t <= riseStart) return level - depth;
    if (t < riseStart + rise) return level - depth + (depth * (t - riseStart)) / rise;
    return level;
  };
  const n = Math.round((opts.endT - opts.startT) / HOP) + 1;
  const values = Float64Array.from({ length: n }, (_, i) => f(opts.startT + i * HOP));
  return { env: { startT: opts.startT, hopSec: HOP, values }, halfRiseT: riseStart + rise / 2 };
}

describe('repeated same-pitch onset (half-rise)', () => {
  it('matches the analytic half-rise within 0.5 ms across offsets, depths and rise times', () => {
    const rng = createRng(3);
    for (let k = 0; k < 200; k++) {
      const fallStart = 0.4 + rng.next() * 0.01;
      const fall = 0.005 + rng.next() * 0.02;
      const hold = 0.004 + rng.next() * 0.02; // at least two hops, so a sample lands on the floor
      const rise = 0.004 + rng.next() * 0.03;
      const depth = 4 + rng.next() * 14;
      const { env, halfRiseT } = dipEnvelope({ startT: 0.1 + rng.next() * HOP, endT: 0.8, level: -20, depth, fallStart, fall, hold, rise });
      const r = repeatedOnset(env, { searchStartT: 0.3, searchEndT: 0.7, noteStartT: 0.1 });
      expect(r).not.toBeNull();
      expect(Math.abs((r as { halfRiseT: number }).halfRiseT - halfRiseT)).toBeLessThan(0.0005);
      expect((r as { dipDb: number }).dipDb).toBeCloseTo(depth, 6);
      expect((r as { detectable: boolean }).detectable).toBe(true);
    }
  });

  it('refines to a flux peak within +-10 ms and ignores one farther away', () => {
    const { env, halfRiseT } = dipEnvelope({ startT: 0, endT: 1, level: -20, depth: 12, fallStart: 0.4, fall: 0.01, hold: 0.01, rise: 0.02 });
    const near: FluxSample[] = [{ t: halfRiseT - 0.006, value: 5 }];
    const far: FluxSample[] = [{ t: halfRiseT + 0.03, value: 9 }];
    const a = repeatedOnset(env, { searchStartT: 0.3, searchEndT: 0.7, noteStartT: 0, flux: near, fluxThreshold: 3 });
    expect(a?.t).toBeCloseTo(halfRiseT - 0.006, 9);
    const b = repeatedOnset(env, { searchStartT: 0.3, searchEndT: 0.7, noteStartT: 0, flux: far, fluxThreshold: 3 });
    expect(Math.abs((b?.t as number) - halfRiseT)).toBeLessThan(0.0005);
  });

  it('a dip under 3 dB is not detectable unless a flux peak passes its threshold', () => {
    const { env } = dipEnvelope({ startT: 0, endT: 1, level: -20, depth: 2.5, fallStart: 0.4, fall: 0.01, hold: 0.01, rise: 0.01 });
    const o = { searchStartT: 0.3, searchEndT: 0.7, noteStartT: 0 };
    expect(repeatedOnset(env, o)?.detectable).toBe(false);
    const flux = [{ t: 0.43, value: 8 }];
    expect(repeatedOnset(env, { ...o, flux, fluxThreshold: 5 })?.detectable).toBe(true);
    expect(repeatedOnset(env, { ...o, flux, fluxThreshold: 10 })?.detectable).toBe(false);
  });

  it('returns null for a flat envelope', () => {
    const env: EnvelopeSeries = { startT: 0, hopSec: HOP, values: new Float64Array(500).fill(-20) };
    expect(repeatedOnset(env, { searchStartT: 0.1, searchEndT: 0.9, noteStartT: 0 })).toBeNull();
  });

  it('applies max(3 dB, 1.5 x AM depth)', () => {
    expect(isReArticulationDetectable(3, 0)).toBe(true);
    expect(isReArticulationDetectable(2.9, 0)).toBe(false);
    expect(isReArticulationDetectable(5, 4)).toBe(false);
    expect(isReArticulationDetectable(6, 4)).toBe(true);
    expect(isReArticulationDetectable(5, 4, 10, 8)).toBe(true);
  });

  it('measures AM depth over the previous 200 ms only', () => {
    const n = 500;
    const values = Float64Array.from({ length: n }, (_, i) => (i * HOP < 0.3 ? -10 + 6 * Math.sin(i) : -20));
    const env: EnvelopeSeries = { startT: 0, hopSec: HOP, values };
    expect(amDepthDb(env, 0.9, 0)).toBe(0);
    expect(amDepthDb(env, 0.3, 0)).toBeGreaterThan(10);
    expect(amDepthDb(env, 0.9, 0.85)).toBe(0);
  });
});

describe('vibrato AM is never detected as a re-articulation', () => {
  it('over rates, depths, phases and seeds', () => {
    const rng = createRng(2024);
    let checked = 0;
    for (let k = 0; k < 400; k++) {
      const rate = 4 + rng.next() * 3; // 4..7 Hz
      const pkpk = 3 + rng.next() * 3; // 3..6 dB peak to peak
      const phase = rng.next() * 2 * Math.PI;
      const dc = -25 + rng.next() * 10;
      const n = 600; // 1.2 s
      const values = Float64Array.from({ length: n }, (_, i) => dc + (pkpk / 2) * Math.sin(2 * Math.PI * rate * i * HOP + phase));
      const env: EnvelopeSeries = { startT: 0, hopSec: HOP, values };
      // The note started 0.3 s before the search window, as 7.4 item 4 assumes (AM is judged over the previous 200 ms).
      const r = repeatedOnset(env, { searchStartT: 0.3, searchEndT: 0.5 + rng.next() * 0.5, noteStartT: 0 });
      if (r) {
        checked++;
        expect(r.detectable).toBe(false);
      }
    }
    expect(checked).toBeGreaterThan(300);
  });

  it('a real dip riding on vibrato is detected only when deep enough', () => {
    const mk = (dip: number): EnvelopeSeries => {
      const values = Float64Array.from({ length: 600 }, (_, i) => {
        const t = i * HOP;
        const vib = 2 * Math.sin(2 * Math.PI * 5.5 * t); // 4 dB pk-pk
        const d = t > 0.6 && t < 0.62 ? dip : 0;
        return -20 + vib - d;
      });
      return { startT: 0, hopSec: HOP, values };
    };
    const o = { searchStartT: 0.45, searchEndT: 0.75, noteStartT: 0 };
    expect(repeatedOnset(mk(3), o)?.detectable).toBe(false); // under 1.5 x 4 dB
    expect(repeatedOnset(mk(12), o)?.detectable).toBe(true);
  });
});

describe('onset from silence or a hard attack', () => {
  function attack(startT: number, level: number, rise: number, onsetT: number): EnvelopeSeries {
    const n = 300;
    const values = Float64Array.from({ length: n }, (_, i) => {
      const t = startT + i * HOP;
      if (t <= onsetT) return -80;
      if (t >= onsetT + rise) return level;
      return -80 + ((level + 80) * (t - onsetT)) / rise;
    });
    return { startT, hopSec: HOP, values };
  }

  it('takes the envelope half-rise when there is no flux', () => {
    const env = attack(0, -20, 0.01, 0.2);
    const t = onsetFromSilence(env, { confirmT: 0.21, fluxThreshold: 1 });
    expect(Math.abs((t as number) - 0.205)).toBeLessThan(0.0005);
  });

  it('takes the flux peak when it comes first, and the half-rise when that comes first', () => {
    const env = attack(0, -20, 0.01, 0.2);
    expect(onsetFromSilence(env, { confirmT: 0.21, flux: [{ t: 0.198, value: 4 }], fluxThreshold: 1 })).toBeCloseTo(0.198, 9);
    const t = onsetFromSilence(env, { confirmT: 0.21, flux: [{ t: 0.209, value: 4 }], fluxThreshold: 1 });
    expect(Math.abs((t as number) - 0.205)).toBeLessThan(0.0005);
  });

  it('ignores flux below threshold or outside 20 ms of the confirming frames', () => {
    const env = attack(0, -20, 0.01, 0.2);
    const a = onsetFromSilence(env, { confirmT: 0.21, flux: [{ t: 0.19, value: 0.5 }], fluxThreshold: 1 });
    expect(Math.abs((a as number) - 0.205)).toBeLessThan(0.0005);
    const b = onsetFromSilence(env, { confirmT: 0.21, flux: [{ t: 0.1, value: 9 }], fluxThreshold: 1 });
    expect(Math.abs((b as number) - 0.205)).toBeLessThan(0.0005);
  });

  it('returns null with nothing to go on', () => {
    const env: EnvelopeSeries = { startT: 0, hopSec: HOP, values: new Float64Array(300).fill(-80) };
    expect(onsetFromSilence(env, { confirmT: 0.2, fluxThreshold: 1 })).toBeNull();
  });
});
