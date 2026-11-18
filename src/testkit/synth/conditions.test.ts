import { describe, expect, it } from 'vitest';
import { createRng } from '../../core/rng.ts';
import {
  applyAgc,
  applyConditions,
  cascadeGainAt,
  decimate,
  fingerprint,
  measureFrequency,
  partialLevelDb,
  phoneMicEq,
  renderPerformance,
  roomImpulseResponse,
  smallSpeakerEq,
  softAttackApplies,
  TIMBRE_IDS,
  vibratoCondition,
  type SynthRender,
} from './index.ts';

const SR = 48000;
const db = (g: number): number => 20 * Math.log10(g);
const rmsDb = (x: ArrayLike<number>, a = 0, b = x.length): number => {
  let s = 0;
  for (let i = a; i < b; i++) s += (x[i] as number) ** 2;
  return 10 * Math.log10(s / (b - a));
};

function silence(sec: number, sr = SR): SynthRender {
  const r = renderPerformance({ timbre: 'flute', notes: [], durationSec: sec, sampleRate: sr });
  return r;
}

function tone(hz: number, sec: number, sr = SR): SynthRender {
  const r = silence(sec, sr);
  for (let i = 0; i < r.samples.length; i++) r.samples[i] = 0.25 * Math.sin((2 * Math.PI * hz * i) / sr);
  return r;
}

describe('phone-mic EQ (2nd-order high-pass at 100 or 150 Hz, low-pass at 7 kHz)', () => {
  it.each([[100], [150]])('high-pass at %d Hz', (hp) => {
    const eq = phoneMicEq(hp, SR);
    expect(db(cascadeGainAt(eq, hp, SR))).toBeCloseTo(-3, 0);
    expect(db(cascadeGainAt(eq, hp / 2, SR))).toBeLessThan(-11);
    expect(db(cascadeGainAt(eq, 1000, SR))).toBeGreaterThan(-0.5);
    expect(db(cascadeGainAt(eq, 7000, SR))).toBeCloseTo(-3, 0);
    expect(db(cascadeGainAt(eq, 14000, SR))).toBeLessThan(-11);
  });
});

describe('small-speaker click EQ', () => {
  it('has no bass and a presence peak', () => {
    const eq = smallSpeakerEq(SR);
    expect(db(cascadeGainAt(eq, 150, SR))).toBeLessThan(-18);
    expect(db(cascadeGainAt(eq, 3000, SR))).toBeGreaterThan(4);
  });
});

describe('room impulse responses (RT60 0.2 to 0.8 s)', () => {
  it.each([[0.2], [0.5], [0.8]])('RT60 %s s measured by Schroeder integration within 15%%', (rt60) => {
    const h = roomImpulseResponse({ rt60Sec: rt60, drrDb: 0 }, SR, createRng(3));
    expect(h[0]).toBeGreaterThan(0.9);
    // Backward integration of the reverberant part, slope between -5 and -25 dB (T20 x 3).
    const e = new Float64Array(h.length);
    let acc = 0;
    for (let i = h.length - 1; i >= 1; i--) {
      acc += h[i]! ** 2;
      e[i] = acc;
    }
    const start = e[1]!;
    const at = (dB: number): number => {
      for (let i = 1; i < h.length; i++) if (10 * Math.log10(e[i]! / start) <= dB) return i / SR;
      return NaN;
    };
    const t20 = at(-25) - at(-5);
    expect(3 * t20).toBeGreaterThan(0.85 * rt60);
    expect(3 * t20).toBeLessThan(1.15 * rt60);
  });

  it('keeps the direct path at lag 0 (truth times stay valid)', () => {
    const r = silence(0.5);
    r.samples[2400] = 0.5;
    const out = applyConditions(r, { room: { rt60Sec: 0.5 } });
    let peak = 0;
    for (let i = 0; i < out.samples.length; i++) if (Math.abs(out.samples[i]!) > Math.abs(out.samples[peak]!)) peak = i;
    expect(peak).toBe(2400);
  });
});

describe('AGC pumping', () => {
  it('pulls the gain down after a loud onset and lets it recover in silence', () => {
    const x = new Float64Array(2 * SR);
    for (let i = 0; i < SR; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / SR);
    const g = applyAgc(x, SR, { releaseSec: 0.5 });
    const gDb = (t: number): number => db(g[Math.round(t * SR)]!);
    // A -9 dBFS RMS tone against a -20 dBFS target: about -11 dB within 50 ms.
    expect(gDb(0.05)).toBeLessThan(-9);
    expect(gDb(0.9)).toBeCloseTo(-11, 0);
    // After the tone stops the gain climbs back toward +12 dB: pumping.
    expect(gDb(1.3)).toBeGreaterThan(gDb(1.05) + 5);
    expect(gDb(1.99)).toBeLessThanOrEqual(12 + 1e-9);
  });
});

describe('AGC limiter', () => {
  it('does not clip an attack after silence at full AGC gain', () => {
    const x = new Float64Array(2 * SR);
    for (let i = SR; i < 2 * SR; i++) x[i] = 0.4 * Math.sin((2 * Math.PI * 300 * i) / SR);
    applyAgc(x, SR, {});
    let peak = 0;
    for (const v of x) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThanOrEqual(0.89 + 1e-9);
  });
});

describe('capture band limits (24 and 16 kHz)', () => {
  it.each([
    [24000, 8000, 14000],
    [16000, 5000, 9000],
  ])('resamples to %d Hz: %d Hz passes, %d Hz is removed', (rate, pass, stop) => {
    const p = applyConditions(tone(pass, 1), { captureRateHz: rate });
    expect(p.sampleRate).toBe(rate);
    expect(p.samples.length).toBe(Math.floor((SR - 1) / (SR / rate)) + 1);
    expect(Math.abs(rmsDb(p.samples, rate * 0.2, rate * 0.8) - db(0.25 / Math.SQRT2))).toBeLessThan(0.1);
    expect(measureFrequency(p.samples, rate, 0.2, 0.8, pass, 5)).toBeCloseTo(pass, 1);
    const s = applyConditions(tone(stop, 1), { captureRateHz: rate });
    expect(rmsDb(s.samples, rate * 0.2, rate * 0.8) - db(0.25 / Math.SQRT2)).toBeLessThan(-60);
  });

  it('is zero-phase (no delay)', () => {
    const d = decimate(Float64Array.from({ length: 4800 }, (_, i) => (i === 2400 ? 1 : 0)), 3, SR);
    let peak = 0;
    for (let i = 0; i < d.length; i++) if (Math.abs(d[i]!) > Math.abs(d[peak]!)) peak = i;
    expect(peak).toBe(800);
  });
});

describe('noise floors (-45 and -50 dBFS)', () => {
  it.each([[-45], [-50]])('%d dBFS at every capture rate', (noiseDbfs) => {
    for (const captureRateHz of [48000, 24000, 16000]) {
      const out = applyConditions(silence(2), { noiseDbfs, captureRateHz, seed: 5 });
      expect(Math.abs(rmsDb(out.samples) - noiseDbfs)).toBeLessThan(0.1);
    }
  });
});

describe('click bleed (-20 and -10 dB, tick and wood)', () => {
  it.each([
    ['tick', -20],
    ['tick', -10],
    ['wood', -20],
    ['wood', -10],
  ] as const)('%s at %d dB: placed at the click times, level relative to the instrument', (timbre, bleedDb) => {
    const dry = silence(1.5);
    const clicks = [0.25, 0.75, 1.25].map((t, i) => ({ t, accent: i === 0 }));
    const out = applyConditions(dry, { clickBleed: { clicks, timbre, bleedDb, smallSpeaker: false } });
    expect(out.clickTimes).toEqual([0.25, 0.75, 1.25]);
    const peakNear = (t: number): number => {
      let p = 0;
      for (let i = Math.round(t * SR); i < Math.round((t + 0.03) * SR); i++) p = Math.max(p, Math.abs(out.samples[i]!));
      return p;
    };
    const ref = 10 ** (dry.levelDb / 20) * Math.SQRT2;
    expect(db(peakNear(0.75) / ref)).toBeCloseTo(bleedDb, 1);
    expect(db(peakNear(0.25) / peakNear(0.75))).toBeCloseTo(5, 1);
    expect(Math.abs(out.samples[Math.round(0.5 * SR)]!)).toBe(0);
  });

  it('the tick sits above the 3 kHz analysis band; the wood does not', () => {
    const lowFrac = (timbre: 'tick' | 'wood'): number => {
      const out = applyConditions(silence(0.5), { clickBleed: { clicks: [{ t: 0.1 }], timbre, bleedDb: -10 } });
      const f = measureFrequency(out.samples, SR, 0.1, 0.13, timbre === 'tick' ? 7000 : 2500, 1500);
      return f;
    };
    expect(lowFrac('tick')).toBeGreaterThan(5000);
    expect(lowFrac('wood')).toBeLessThan(4200);
  });
});

describe('performance conditions', () => {
  it('soft attacks apply to voice and bowed timbres only', () => {
    expect(TIMBRE_IDS.filter(softAttackApplies).sort()).toEqual(['cello', 'violin', 'voice']);
  });

  it('a 30 to 80 ms soft attack lengthens the rise, and the truth follows the definition', () => {
    const rise = (attackSec: number): number => {
      const r = renderPerformance({ timbre: 'violin', notes: [{ midi: 67, onsetSec: 0.3, durSec: 0.6, attackSec }], vibrato: null });
      const env = r.envelope;
      const hopAt = (t: number): number => env.values[Math.round(t / env.hopSec)] as number;
      expect(Math.abs(r.truth[0]!.onsetSec - 0.3)).toBeLessThan(0.001);
      // Time from the onset to within 1 dB of the level at +200 ms.
      const top = hopAt(0.5);
      for (let t = 0.3; t < 0.5; t += env.hopSec) if (hopAt(t) >= top - 1) return t - 0.3;
      return NaN;
    };
    expect(rise(0.08)).toBeGreaterThan(rise(0.03) + 0.03);
  });

  it('vibrato condition: 5 to 6 Hz at +-30 c', () => {
    const v = vibratoCondition(5.5, 30, 'voice');
    const r = renderPerformance({ timbre: 'voice', notes: [{ midi: 62, onsetSec: 0.1, durSec: 1.4 }], vibrato: v });
    let lo = Infinity;
    let hi = -Infinity;
    for (let t = 0.5; t < 1.4; t += 0.001) {
      const m = r.pitchAt(t) as number;
      lo = Math.min(lo, m);
      hi = Math.max(hi, m);
    }
    expect((hi - 62) * 100).toBeCloseTo(30, 0);
    expect((62 - lo) * 100).toBeCloseTo(30, 0);
  });

  it('breath noise raises the noise between harmonics and can be switched off', () => {
    const between = (breathDb: number | null): number => {
      const r = renderPerformance({ timbre: 'flute', notes: [{ midi: 72, onsetSec: 0.1, durSec: 1 }], breathDb, attackNoise: false });
      const f0 = r.truth[0]!.freqHz;
      // Hann-windowed level halfway between partials 4 and 5 (inside the breath band), re the fundamental.
      return partialLevelDb(r.samples, SR, 0.4, 0.9, 4.5 * f0, f0);
    };
    expect(between(-20)).toBeGreaterThan(between(null) + 20);
  });
});

describe('applyConditions', () => {
  it('leaves the truth unchanged and is deterministic', () => {
    const dry = renderPerformance({ timbre: 'clarinet', notes: [{ midi: 60, onsetSec: 0.2, durSec: 0.5 }, { midi: 64, onsetSec: 0.8, durSec: 0.5 }] });
    const c = {
      clickBleed: { clicks: [{ t: 0.2, accent: true }, { t: 0.8 }], timbre: 'wood', bleedDb: -10 },
      room: { rt60Sec: 0.6 },
      phoneMic: { highPassHz: 150 },
      agc: {},
      captureRateHz: 16000,
      noiseDbfs: -45,
      seed: 11,
    } as const;
    const a = applyConditions(dry, c);
    const b = applyConditions(dry, c);
    expect(a.truth).toBe(dry.truth);
    expect(fingerprint(a.samples)).toBe(fingerprint(b.samples));
    expect(fingerprint(applyConditions(dry, { ...c, seed: 12 }).samples)).not.toBe(fingerprint(a.samples));
    expect(a.sampleRate).toBe(16000);
  });
});
