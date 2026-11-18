import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REF_NAMES, REF_SPECS, renderRefWavBytes } from './ref-wavs.ts';
import { clickBurst, renderMin } from './synth-min.ts';
import { decodeWav } from './wav.ts';

const SR = 48000;
const refDir = fileURLToPath(new URL('./ref/', import.meta.url));
const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

/** Goertzel magnitude at f over [i0, i1). */
function goertzel(x: Float32Array, f: number, i0: number, i1: number): number {
  const w = (2 * Math.PI * f) / SR;
  const c = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = i0; i < i1; i++) {
    const s = (x[i] as number) + c * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return Math.sqrt(s1 * s1 + s2 * s2 - c * s1 * s2) / ((i1 - i0) / 2);
}

const rms = (x: Float32Array, t0: number, t1: number): number => {
  let s = 0;
  const a = Math.round(t0 * SR);
  const b = Math.round(t1 * SR);
  for (let i = a; i < b; i++) s += (x[i] as number) ** 2;
  return Math.sqrt(s / (b - a));
};

describe('renderMin', () => {
  it('is deterministic for the same spec and differs with the noise seed', () => {
    const spec = { sampleRate: SR, notes: [{ midi: 60, onsetSec: 0.1, durSec: 0.3 }], noiseDbfs: -50, seed: 3 };
    const a = renderMin(spec).samples;
    const b = renderMin(spec).samples;
    expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(true);
    const c = renderMin({ ...spec, seed: 4 }).samples;
    expect(Buffer.from(a.buffer).equals(Buffer.from(c.buffer))).toBe(false);
  });

  it('puts the fundamental where the cents say', () => {
    const r = renderMin({ sampleRate: SR, notes: [{ midi: 69, onsetSec: 0.05, durSec: 0.6, cents: 30 }] });
    const f30 = 440 * 2 ** (30 / 1200);
    const x = r.samples;
    const at = (f: number): number => goertzel(x, f, Math.round(0.2 * SR), Math.round(0.6 * SR));
    expect(at(f30)).toBeGreaterThan(5 * at(440));
    expect(at(f30)).toBeGreaterThan(5 * at(f30 * 1.01));
    expect(r.truth[0]?.freqHz).toBeCloseTo(f30, 9);
    expect(r.truth[0]?.onsetSec).toBe(0.05);
  });

  it('has silence outside the note and honours the level', () => {
    const r = renderMin({ sampleRate: SR, notes: [{ midi: 60, onsetSec: 0.2, durSec: 0.3 }], levelDb: -6, durationSec: 1 });
    expect(rms(r.samples, 0, 0.19)).toBe(0);
    expect(Math.max(...r.samples)).toBeLessThanOrEqual(10 ** (-6 / 20) + 1e-6);
    expect(Math.max(...r.samples)).toBeGreaterThan(0.3);
  });

  it('legato glides through the cents midpoint at the scripted onset', () => {
    const r = renderMin({
      sampleRate: SR, glideSec: 0.04,
      notes: [{ midi: 60, onsetSec: 0.1, durSec: 0.4 }, { midi: 64, onsetSec: 0.5, durSec: 0.4, legato: true }],
    });
    expect(r.truth[1]?.legato).toBe(true);
    // Before the glide: old pitch. After: new pitch. No amplitude dip at the boundary.
    const f60 = 440 * 2 ** (-9 / 12);
    const f64 = 440 * 2 ** (-5 / 12);
    const win = (f: number, a: number, b: number): number => goertzel(r.samples, f, Math.round(a * SR), Math.round(b * SR));
    expect(win(f60, 0.3, 0.45)).toBeGreaterThan(5 * win(f64, 0.3, 0.45));
    expect(win(f64, 0.6, 0.85)).toBeGreaterThan(5 * win(f60, 0.6, 0.85));
    const before = rms(r.samples, 0.46, 0.48);
    const across = rms(r.samples, 0.49, 0.51);
    expect(across / before).toBeGreaterThan(0.85);
  });

  it('tonguing dip is about the requested depth and rises again', () => {
    const r = renderMin({
      sampleRate: SR, tongueDipSec: 0.03,
      notes: [{ midi: 64, onsetSec: 0.1, durSec: 0.4 }, { midi: 64, onsetSec: 0.5, durSec: 0.4, tongueDipDb: 6 }],
    });
    const steady = rms(r.samples, 0.4, 0.45);
    const dip = rms(r.samples, 0.495, 0.505);
    const dipDb = 20 * Math.log10(dip / steady);
    expect(dipDb).toBeLessThan(-3);
    expect(dipDb).toBeGreaterThan(-12);
    expect(rms(r.samples, 0.6, 0.7)).toBeGreaterThan(0.8 * steady);
  });

  it('click bleed adds high-band energy at the click times only', () => {
    const r = renderMin({
      sampleRate: SR, notes: [{ midi: 60, onsetSec: 0.05, durSec: 0.9 }], clicks: [{ t: 0.5, accent: true }],
      clickTimbre: 'tick', bleedDb: -10, durationSec: 1,
    });
    expect(r.clickTimes).toEqual([0.5]);
    const burst = clickBurst('tick', true, SR);
    expect(Math.max(...burst)).toBeCloseTo(1, 6);
    expect(burst.length).toBe(Math.round(0.018 * SR));
    const clean = renderMin({ sampleRate: SR, notes: [{ midi: 60, onsetSec: 0.05, durSec: 0.9 }], durationSec: 1 });
    const diff = (a: number, b: number): number => {
      let e = 0;
      for (let i = Math.round(a * SR); i < Math.round(b * SR); i++) e += ((r.samples[i] as number) - (clean.samples[i] as number)) ** 2;
      return e;
    };
    expect(diff(0.5, 0.52)).toBeGreaterThan(0);
    expect(diff(0.1, 0.49)).toBe(0);
    expect(diff(0.53, 0.95)).toBe(0);
  });

  it('noise floor matches the requested RMS', () => {
    const r = renderMin({ sampleRate: SR, notes: [], noiseDbfs: -45, durationSec: 2 });
    const db = 20 * Math.log10(rms(r.samples, 0, 2));
    expect(db).toBeGreaterThan(-45.5);
    expect(db).toBeLessThan(-44.5);
  });
});

describe('reference WAVs', () => {
  const sums = (JSON.parse(readFileSync(`${refDir}checksums.json`, 'utf8')) as { sha256: Record<string, string> }).sha256;

  it('there are exactly 6', () => {
    expect(REF_NAMES).toHaveLength(6);
    expect(Object.keys(sums).sort()).toEqual([...REF_NAMES].sort());
    expect(Object.keys(REF_SPECS)).toHaveLength(6);
  });

  for (const name of REF_NAMES) {
    it(`${name}: a fresh render matches the committed checksum and file`, () => {
      const fresh = renderRefWavBytes(name);
      expect(sha(fresh)).toBe(sums[name]);
      const disk = new Uint8Array(readFileSync(`${refDir}${name}.wav`));
      expect(sha(disk)).toBe(sums[name]);
      const w = decodeWav(disk);
      expect(w.sampleRate).toBe(48000);
      expect(w.channels[0]?.length).toBeGreaterThan(48000);
    });
  }
});
