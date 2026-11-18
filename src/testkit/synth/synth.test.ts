import { describe, expect, it } from 'vitest';
import { onsetFromSilence, repeatedOnset } from '../../core/onset-definition.ts';
import type { TestkitTimbre } from '../../core/types.ts';
import {
  audioEnvelope,
  fingerprint,
  lowBand,
  measureFrequency,
  partialLevelDb,
  renderPerformance,
  TIMBRE_IDS,
  TIMBRES,
  type SynthNoteSpec,
  type SynthRender,
} from './index.ts';

/** A phrase that exercises all three onset rules: silence attacks, repeats with dips, a slur, a staccato gap. */
function phrase(m0: number, cents = 7): SynthNoteSpec[] {
  const pat: [number, boolean, number, number][] = [
    [0, false, 0.5, 0.46], // silence attack
    [4, false, 0.5, 0.5], // silence attack after a gap
    [4, false, 0.5, 0.5], // same pitch, joined: dip
    [4, false, 0.4, 0.4], // repeat again
    [7, true, 0.4, 0.4], // slur: glide
    [7, false, 0.6, 0.55], // repeat after the slur
    [12, false, 0.6, 0.5], // silence attack
  ];
  const out: SynthNoteSpec[] = [];
  let t = 0.3;
  for (const [d, slur, ioi, dur] of pat) {
    out.push({ midi: m0 + d, cents, onsetSec: t, durSec: dur, slur, ref: out.length });
    t += ioi;
  }
  return out;
}

/** Mid-register base notes (f0 >= 250 Hz, so a one-period audio window is short enough to resolve 1 ms). */
const MID: Record<TestkitTimbre, number> = { flute: 72, clarinet: 62, sax: 61, trumpet: 64, violin: 67, cello: 60, voice: 60, piano: 60, tuba: 60 };
/** Low-register base notes near each instrument's floor. */
const LOW: Record<TestkitTimbre, number> = { flute: 60, clarinet: 52, sax: 50, trumpet: 55, violin: 55, cello: 40, voice: 48, piano: 45, tuba: 34 };

/** Re-measure a truth note's onset from the rendered audio with the 7.4 definition. */
function audioOnset(r: SynthRender, low: Float64Array, i: number): number | null {
  const tr = r.truth[i]!;
  const period = 1 / tr.freqHz;
  if (tr.onsetRule === 'silence') {
    const env = audioEnvelope(low, r.sampleRate, tr.confirmT! - 0.03, tr.confirmT! + 0.03, period, r.floorDb);
    return onsetFromSilence(env, { confirmT: tr.confirmT!, fluxThreshold: Infinity });
  }
  if (tr.onsetRule === 'dip') {
    const env = audioEnvelope(low, r.sampleRate, tr.eventSec - 0.25, tr.eventSec + 0.06, period, r.floorDb);
    return repeatedOnset(env, { searchStartT: tr.eventSec - 0.04, searchEndT: tr.eventSec + 0.04, noteStartT: tr.eventSec - 0.2 })?.t ?? null;
  }
  return null;
}

describe('timbres (R21: all eight launch instruments plus tuba)', () => {
  it('defines nine distinct timbres matching TestkitTimbre', () => {
    expect([...TIMBRE_IDS].sort()).toEqual(['cello', 'clarinet', 'flute', 'piano', 'sax', 'trumpet', 'tuba', 'violin', 'voice']);
    for (const id of TIMBRE_IDS) expect(TIMBRES[id].id).toBe(id);
  });

  it.each(TIMBRE_IDS.map((t) => [t]))('%s renders a finite, unclipped, audible tone', (timbre) => {
    const r = renderPerformance({ timbre, notes: phrase(MID[timbre]) });
    let peak = 0;
    let ss = 0;
    for (const v of r.samples) {
      expect(Number.isFinite(v)).toBe(true);
      peak = Math.max(peak, Math.abs(v));
      ss += v * v;
    }
    expect(peak).toBeLessThan(0.9);
    const rmsDb = 10 * Math.log10(ss / r.samples.length);
    expect(rmsDb).toBeGreaterThan(-35);
    expect(r.truth).toHaveLength(7);
  });

  it('timbres differ the way the families do', () => {
    const steady = (timbre: TestkitTimbre, midi: number): { x: Float32Array; f0: number } => {
      const r = renderPerformance({ timbre, notes: [{ midi, onsetSec: 0.1, durSec: 1.2 }], vibrato: null, breathDb: null, attackNoise: false });
      return { x: r.samples, f0: r.truth[0]!.freqHz };
    };
    // Clarinet (cylindrical bore): weak 2nd harmonic in the chalumeau, strong 3rd.
    const cl = steady('clarinet', 55);
    expect(partialLevelDb(cl.x, 48000, 0.4, 1.0, 2 * cl.f0, cl.f0)).toBeLessThan(-15);
    expect(partialLevelDb(cl.x, 48000, 0.4, 1.0, 3 * cl.f0, cl.f0)).toBeGreaterThan(-15);
    // Sax (conical): 2nd harmonic present.
    const sx = steady('sax', 55);
    expect(partialLevelDb(sx.x, 48000, 0.4, 1.0, 2 * sx.f0, sx.f0)).toBeGreaterThan(-10);
    // Flute: nearly sinusoidal.
    const fl = steady('flute', 72);
    expect(partialLevelDb(fl.x, 48000, 0.4, 1.0, 3 * fl.f0, fl.f0)).toBeLessThan(-15);
    // Voice "ah" on a low pitch: the partials peak again near F1 (750 Hz), close to the fundamental's level.
    const vo = steady('voice', 45);
    const k = Math.round(750 / vo.f0);
    expect(partialLevelDb(vo.x, 48000, 0.4, 1.0, k * vo.f0, vo.f0)).toBeGreaterThan(-8);
    expect(partialLevelDb(vo.x, 48000, 0.4, 1.0, k * vo.f0, 4 * vo.f0)).toBeGreaterThan(6);
    // Trumpet: brightest partial well above f0 (bell formant near 1.2 kHz).
    const tp = steady('trumpet', 58);
    expect(partialLevelDb(tp.x, 48000, 0.4, 1.0, 5 * tp.f0, tp.f0)).toBeGreaterThan(0);
    // Piano: struck tone decays (-6 dB or more over 1 s at C4 without the damper).
    const pr = renderPerformance({ timbre: 'piano', notes: [{ midi: 60, onsetSec: 0.05, durSec: 1.6 }], attackNoise: false });
    const rms = (a: number, b: number): number => {
      let s = 0;
      for (let i = Math.round(a * 48000); i < Math.round(b * 48000); i++) s += pr.samples[i]! ** 2;
      return 10 * Math.log10(s / ((b - a) * 48000));
    };
    expect(rms(0.1, 0.2) - rms(1.3, 1.4)).toBeGreaterThan(6);
  });
});

describe('ground truth from core/onset-definition.ts (P3: within 1 ms and 1 c on clean renders)', () => {
  it.each(TIMBRE_IDS.map((t) => [t]))('%s: truth onsets land on the scripted onsets within 1 ms (control signals)', (timbre) => {
    for (const vibrato of [null, undefined]) {
      for (const m0 of [MID[timbre], LOW[timbre]]) {
        const r = renderPerformance({ timbre, notes: phrase(m0), ...(vibrato === null ? { vibrato } : {}) });
        for (const t of r.truth) expect(Math.abs(t.onsetSec - t.targetOnsetSec), `${timbre} ${m0} note ${t.idx} ${t.onsetRule}`).toBeLessThanOrEqual(0.001);
      }
    }
  });

  it('uses all three 7.4 rules where the music calls for them', () => {
    const wind = renderPerformance({ timbre: 'flute', notes: phrase(72) });
    expect(wind.truth.map((t) => t.onsetRule)).toEqual(['silence', 'silence', 'dip', 'dip', 'pitch-change', 'dip', 'silence']);
    expect(wind.truth.map((t) => t.onsetCause)).toEqual(['from-silence', 'from-silence', 'repeat', 'repeat', 'pitch-change', 'repeat', 'from-silence']);
    const piano = renderPerformance({ timbre: 'piano', notes: phrase(60) });
    expect(new Set(piano.truth.map((t) => t.onsetRule))).toEqual(new Set(['silence']));
  });

  it.each(TIMBRE_IDS.map((t) => [t]))('%s: the rendered audio gives the same 7.4 onsets (1 ms mid register)', (timbre) => {
    const r = renderPerformance({ timbre, notes: phrase(MID[timbre]), vibrato: null, attackNoise: false, breathDb: null });
    const low = lowBand(r.samples, r.sampleRate);
    let checked = 0;
    r.truth.forEach((t, i) => {
      const a = audioOnset(r, low, i);
      if (t.onsetRule === 'pitch-change') return;
      expect(a, `${timbre} note ${i}`).not.toBeNull();
      expect(Math.abs((a as number) - t.onsetSec), `${timbre} note ${i} ${t.onsetRule}`).toBeLessThanOrEqual(0.001);
      checked++;
    });
    expect(checked).toBeGreaterThanOrEqual(5);
  });

  it.each(TIMBRE_IDS.map((t) => [t]))('%s: low register agrees within half a period (the audio window limit)', (timbre) => {
    const r = renderPerformance({ timbre, notes: phrase(LOW[timbre]), vibrato: null, attackNoise: false, breathDb: null });
    const low = lowBand(r.samples, r.sampleRate);
    r.truth.forEach((t, i) => {
      if (t.onsetRule === 'pitch-change') return;
      const a = audioOnset(r, low, i);
      expect(Math.abs((a as number) - t.onsetSec), `${timbre} note ${i}`).toBeLessThanOrEqual(Math.max(0.001, 0.5 / t.freqHz));
    });
  });

  it.each(TIMBRE_IDS.map((t) => [t]))('%s: steady pitch matches the truth within 1 c', (timbre) => {
    for (const m0 of [MID[timbre], LOW[timbre]]) {
      const notes = phrase(m0, 13).map((n, i) => ({ ...n, cents: [13, -21, 0, 4, -9, 33, -40][i]! }));
      const r = renderPerformance({ timbre, notes, vibrato: null });
      for (const t of r.truth) {
        if (t.offsetSec - t.onsetSec < 0.3) continue;
        const f = measureFrequency(r.samples, r.sampleRate, t.onsetSec + 0.1, t.offsetSec - 0.05, t.freqHz);
        expect(Math.abs(1200 * Math.log2(f / t.freqHz)), `${timbre} ${m0} note ${t.idx}`).toBeLessThanOrEqual(1);
        expect(t.midi + t.cents / 100).toBeCloseTo(notes[t.idx]!.midi + notes[t.idx]!.cents! / 100, 9);
      }
    }
  });

  it('vibrato is centred on the truth pitch (control track median within 1 c)', () => {
    for (const timbre of ['violin', 'cello', 'voice'] as const) {
      const r = renderPerformance({ timbre, notes: [{ midi: 64, cents: -12, onsetSec: 0.1, durSec: 1.5 }], vibrato: { hz: 5.5, cents: 30, amDb: 3, delaySec: 0.15 } });
      // Five whole vibrato cycles after the depth has ramped in.
      const xs: number[] = [];
      for (let t = 0.4; t < 0.4 + 5 / 5.5; t += 0.0005) xs.push(r.pitchAt(t) as number);
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
      xs.sort((a, b) => a - b);
      expect(Math.abs((mean - 63.88) * 100)).toBeLessThanOrEqual(1);
      expect(Math.abs((xs[Math.floor(xs.length / 2)]! - 63.88) * 100)).toBeLessThanOrEqual(1);
      expect((xs[xs.length - 1]! - xs[0]!) * 100).toBeGreaterThan(55);
    }
  });

  it('flags re-articulations below the 7.4 item 4 threshold as undetectable', () => {
    // Flute with 5 dB AM vibrato: a 3 dB dip is one held note; the default 16 dB tongue dip is a new note.
    const vibrato = { hz: 5.5, cents: 15, amDb: 5, delaySec: 0.05 };
    const notes = (dipDb?: number): SynthNoteSpec[] => [
      { midi: 72, onsetSec: 0.2, durSec: 0.8 },
      { midi: 72, onsetSec: 1.0, durSec: 0.6, ...(dipDb !== undefined ? { dipDb } : {}) },
    ];
    const deep = renderPerformance({ timbre: 'flute', notes: notes(), vibrato }).truth[1]!;
    expect(deep.onsetRule).toBe('dip');
    expect(deep.detectable).toBe(true);
    const shallow = renderPerformance({ timbre: 'flute', notes: notes(3), vibrato }).truth[1]!;
    expect(shallow.onsetRule).toBe('dip');
    expect(shallow.detectable).toBe(false);
    // Either no dip stands out of the AM at all, or it is below max(3 dB, 1.5 x AM depth).
    if (shallow.dipDb !== null) expect(shallow.dipDb).toBeLessThan(Math.max(3, 1.5 * shallow.amDepthDb!));
  });
});

describe('determinism', () => {
  it('is a pure function of the spec', () => {
    for (const timbre of TIMBRE_IDS) {
      const spec = { timbre, notes: phrase(MID[timbre]), seed: 9 } as const;
      expect(fingerprint(renderPerformance(spec).samples)).toBe(fingerprint(renderPerformance(spec).samples));
    }
    const a = renderPerformance({ timbre: 'flute', notes: phrase(72), seed: 1 });
    const b = renderPerformance({ timbre: 'flute', notes: phrase(72), seed: 2 });
    expect(fingerprint(a.samples)).not.toBe(fingerprint(b.samples));
    expect(a.truth).toEqual(b.truth);
  });

  it('renders the same timbre at 16, 24 and 48 kHz with the same truth', () => {
    const t48 = renderPerformance({ timbre: 'sax', notes: phrase(61), sampleRate: 48000 }).truth;
    for (const sampleRate of [24000, 16000]) {
      const t = renderPerformance({ timbre: 'sax', notes: phrase(61), sampleRate }).truth;
      t.forEach((x, i) => expect(Math.abs(x.onsetSec - t48[i]!.onsetSec)).toBeLessThan(1e-4));
    }
  });
});
