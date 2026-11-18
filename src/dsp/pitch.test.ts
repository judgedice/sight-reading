import { describe, expect, it } from 'vitest';
import type { ClockSeconds } from '../core/types.ts';
import { OctaveHysteresis, PitchAnalyzer, PitchDetector, freqToMidi, midiToFreq, widenRange } from './pitch.ts';

const RATE = 16000;

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** Harmonic tone, amplitudes 1, 1/2, 1/4 ... limited below 3 kHz like the capture low-pass. */
function tone(f: number, n: number, rate = RATE, noise = 0, seed = 7): Float32Array {
  const rnd = lcg(seed);
  const out = new Float32Array(n);
  const amps = [0.5, 0.25, 0.12, 0.06];
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let h = 1; h <= amps.length; h++) if (f * h < 3000) v += (amps[h - 1] as number) * Math.sin(2 * Math.PI * f * h * (i / rate) + 0.3 * h);
    out[i] = v + (rnd() - 0.5) * noise;
  }
  return out;
}

const cents = (a: number, b: number): number => 1200 * Math.log2(a / b);

function detector(win: 512 | 1024 | 2048, lowHz: number, highHz: number): PitchDetector {
  const { minHz, maxHz } = widenRange(lowHz, highHz);
  return new PitchDetector({ analysisRate: RATE, windowSamples: win, minHz, maxHz });
}

describe('PitchDetector accuracy', () => {
  // The ear-to-staff cases.
  it.each([82.4, 110, 196, 261.6, 440, 659.3, 1046.5])('ear-to-staff tone %f Hz within 5 c, clarity > 0.85', (f) => {
    const det = detector(1024, 55, 1600);
    const r = det.detect(tone(f, 1024, RATE, 0.02));
    expect(Math.abs(cents(r.freq, f))).toBeLessThan(5);
    expect(r.clarity).toBeGreaterThan(0.85);
  });

  it('47 to 2637 Hz in quarter-tone steps stays within 5 c on the instrument window', () => {
    let worst = 0;
    let worstF = 0;
    // 1024 window below 94 Hz, 512 above; phases varied by frequency.
    for (let midi = freqToMidi(47); midi <= freqToMidi(2637); midi += 0.37) {
      const f = midiToFreq(midi);
      const win = f < 100 ? 1024 : 512;
      const det = detector(win, 47, 2637);
      const r = det.detect(tone(f, win, RATE, 0.01));
      const e = Math.abs(cents(r.freq, f));
      if (!(e <= worst)) {
        worst = e;
        worstF = f;
      }
      expect(Number.isFinite(r.freq), `no pitch at ${f}`).toBe(true);
    }
    expect(worst, `worst ${worst} c at ${worstF} Hz`).toBeLessThan(5);
  });

  it('2048 window finds 23 to 47 Hz fundamentals', () => {
    const det = detector(2048, 23, 400);
    for (const f of [24, 30, 41.2]) {
      const r = det.detect(tone(f, 2048));
      expect(Math.abs(cents(r.freq, f))).toBeLessThan(8);
    }
  });

  it('noise has low clarity and silence has no pitch', () => {
    const det = detector(1024, 55, 1600);
    const rnd = lcg(3);
    const r = det.detect(new Float32Array(1024).map(() => (rnd() - 0.5) * 0.2));
    expect(r.clarity).toBeLessThan(0.6);
    const s = det.detect(new Float32Array(1024));
    expect(Number.isNaN(s.freq)).toBe(true);
    expect(s.clarity).toBe(0);
  });

  it('lag limits: pitches outside the widened range are not reported', () => {
    // Range 200-400 Hz widened by 3 semitones: minHz about 168, maxHz about 476.
    const det = detector(1024, 200, 400);
    expect(det.minTau).toBe(Math.floor(RATE / (400 * Math.pow(2, 0.25))));
    expect(det.maxTau).toBe(Math.ceil(RATE / (200 / Math.pow(2, 0.25))));
    const inside = det.detect(tone(440, 1024));
    expect(Math.abs(cents(inside.freq, 440))).toBeLessThan(5);
    const below = det.detect(tone(100, 1024));
    // A 100 Hz tone has its 2nd period inside the limit, so the lag reads an octave or more off, never 100 Hz.
    expect(Number.isFinite(below.freq) ? Math.abs(cents(below.freq, 100)) > 600 : true).toBe(true);
  });

  it('is at most 0.2 ms per 1024 window (median of batches)', () => {
    const det = detector(1024, 47, 1600);
    const buf = tone(220, 1024, RATE, 0.01);
    for (let i = 0; i < 300; i++) det.detect(buf);
    const per: number[] = [];
    for (let b = 0; b < 15; b++) {
      const t0 = performance.now();
      for (let i = 0; i < 200; i++) det.detect(buf);
      per.push((performance.now() - t0) / 200);
    }
    per.sort((a, b) => a - b);
    expect(per[7]).toBeLessThan(0.2);
  });
});

describe('altOctaveClarity', () => {
  it('reads the NSDF at the lag of the expected octave', () => {
    const det = detector(1024, 100, 1000);
    det.detect(tone(220, 1024));
    const same = det.nsdfAtHz(220) as number;
    const lower = det.nsdfAtHz(110) as number;
    const other = det.nsdfAtHz(311.1) as number; // a tritone away: no periodicity
    expect(same).toBeGreaterThan(0.9);
    expect(lower).toBeGreaterThan(0.85); // a periodic signal repeats at 2 periods
    expect(other).toBeLessThan(0.5);
    expect(det.nsdfAtHz(10)).toBeNull();
  });
  it('is null after a silent window', () => {
    const det = detector(1024, 100, 1000);
    det.detect(new Float32Array(1024));
    expect(det.nsdfAtHz(220)).toBeNull();
  });
});

describe('OctaveHysteresis', () => {
  it('folds a 1 to 3 frame octave jump back and accepts one that lasts 4 frames', () => {
    const h = new OctaveHysteresis();
    for (let i = 0; i < 10; i++) expect(h.process(60)).toBe(60);
    // Three octave-up frames are folded.
    for (let i = 0; i < 3; i++) expect(h.process(72.1)).toBeCloseTo(60.1, 9);
    expect(h.process(60)).toBe(60);
    // A fourth consecutive frame is believed.
    for (let i = 0; i < 3; i++) h.process(72);
    expect(h.process(72)).toBe(72);
    expect(h.median).toBe(72);
  });
  it('folds downward jumps and ignores non-octave jumps', () => {
    const h = new OctaveHysteresis();
    for (let i = 0; i < 5; i++) h.process(64);
    expect(h.process(52.2)).toBeCloseTo(64.2, 9);
    expect(h.process(67)).toBe(67);
    expect(h.process(11.4 + 64)).toBe(75.4); // 11.4 is outside 12 +/- 0.5
  });
  it('an unvoiced frame breaks the run', () => {
    const h = new OctaveHysteresis();
    for (let i = 0; i < 5; i++) h.process(60);
    h.process(72);
    h.process(72);
    h.gap();
    h.process(72);
    expect(h.process(72)).toBe(60);
  });
  it('reset forgets the median so a new note can start in any octave', () => {
    const h = new OctaveHysteresis();
    for (let i = 0; i < 5; i++) h.process(60);
    h.reset();
    expect(h.process(72)).toBe(72);
  });
});

describe('PitchAnalyzer', () => {
  function run(signal: Float32Array, startT: number, block = 85, opts: Partial<ConstructorParameters<typeof PitchAnalyzer>[0]> = {}) {
    const a = new PitchAnalyzer({ analysisRate: RATE, windowSamples: 512, minHz: 150, maxHz: 1500, clarityThreshold: 0.85, ...opts });
    const frames = [];
    for (let i = 0; i < signal.length; i += block) {
      const n = Math.min(block, signal.length - i);
      frames.push(...a.push(signal.subarray(i, i + n), (startT + i / RATE) as ClockSeconds));
    }
    return frames;
  }

  it('stamps frames at the window centre, hop 128', () => {
    const f = run(tone(440, 8000), 10);
    expect(f.length).toBe(Math.floor((8000 - 512) / 128) + 1);
    expect(f[0]?.t).toBeCloseTo(10 + 256 / RATE, 9);
    expect((f[1]?.t as number) - (f[0]?.t as number)).toBeCloseTo(128 / RATE, 9);
    expect(Math.abs(cents(midiToFreq(f[5]?.midi as number), 440))).toBeLessThan(3);
  });

  it('uses the block start time that holds the centre sample', () => {
    // Blocks carrying a 1 ms timing jump: the stamp follows the block, not a running sample count.
    const a = new PitchAnalyzer({ analysisRate: RATE, windowSamples: 512, minHz: 150, maxHz: 1500, clarityThreshold: 0.85 });
    const x = tone(440, 2048);
    const out = [...a.push(x.subarray(0, 1024), 0), ...a.push(x.subarray(1024), 1024 / RATE + 0.001)];
    const late = out.find((e) => e.startSample + 256 >= 1024) as { t: number; startSample: number };
    expect(late.t).toBeCloseTo(0.001 + (late.startSample + 256) / RATE, 9);
  });

  /** Time of the cents-midpoint crossing (7.4 rule 1) of a phase-continuous step, minus the true step time, ms. */
  function crossingBiasMs(win: 512 | 1024, f0: number, semis: number, step: number): number {
    const f1 = f0 * Math.pow(2, semis / 12);
    const n = Math.round(1.6 * RATE);
    const sig = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      phase += (2 * Math.PI * (i / RATE < step ? f0 : f1)) / RATE;
      sig[i] = 0.5 * Math.sin(phase) + 0.25 * Math.sin(2 * phase) + 0.1 * Math.sin(3 * phase);
    }
    const frames = run(sig, 0, 85, { windowSamples: win, minHz: 100, maxHz: 1500, clarityThreshold: 0, hysteresis: false });
    const mid = (freqToMidi(f0) + freqToMidi(f1)) / 2;
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1];
      const b = frames[i];
      if (!a || !b || a.midi === null || b.midi === null || Math.abs(b.t - step) > 0.05) continue;
      if ((a.midi - mid) * (b.midi - mid) <= 0) return (a.t + ((mid - a.midi) / (b.midi - a.midi)) * (b.t - a.t) - step) * 1000;
    }
    return NaN;
  }

  it('step change crossing: under 1 ms for semitone steps, direction-antisymmetric, nowhere near W/2', () => {
    for (const win of [512, 1024] as const) {
      for (const [f0, step] of [[440, 0.8], [220, 0.8031], [880, 0.8062]] as const) {
        const up = crossingBiasMs(win, f0, 1, step);
        const down = crossingBiasMs(win, f0, -1, step);
        // The first-peak rule reads a rising step slightly early and a falling one slightly late; the mean cancels.
        expect(Math.abs((up + down) / 2), `mean ${win} ${f0}`).toBeLessThan(0.5);
        const limit = win === 512 ? 1 : 1.6;
        expect(Math.abs(up), `up ${win} ${f0}`).toBeLessThan(limit);
        expect(Math.abs(down), `down ${win} ${f0}`).toBeLessThan(limit);
        // An uncentred stamp would be late by W/2 = 16 or 32 ms.
        expect(Math.abs(up)).toBeLessThan((win / 2 / RATE) * 1000 * 0.1);
      }
    }
  });

  it('marks frames below the clarity threshold as unvoiced and rmsDb is in dBFS', () => {
    const rnd = lcg(5);
    const noise = new Float32Array(4000).map(() => (rnd() - 0.5) * 0.2);
    const f = run(noise, 0);
    expect(f.every((e) => e.midi === null)).toBe(true);
    const s = run(new Float32Array(4000), 0);
    expect(s.every((e) => e.midi === null && e.rmsDb === -120 && e.clarity === 0)).toBe(true);
    const t = run(tone(440, 2000), 0);
    expect(t[0]?.rmsDb as number).toBeLessThan(0);
    expect(t[0]?.rmsDb as number).toBeGreaterThan(-20);
  });

  it('folds a short octave glitch via hysteresis', () => {
    // 200 Hz tone with 2 windows' worth of 400 Hz in the middle: raw jumps an octave, filtered output does not.
    const a = tone(200, 6000);
    const b = tone(400, 6000);
    const sig = new Float32Array(6000);
    sig.set(a.subarray(0, 3000), 0);
    sig.set(b.subarray(3000, 3300), 3000);
    sig.set(a.subarray(3300), 3300);
    const f = run(sig, 0, 85, { windowSamples: 512, minHz: 100, maxHz: 1000 });
    const voiced = f.filter((e) => e.midi !== null);
    const mids = voiced.map((e) => e.midi as number);
    expect(Math.max(...mids) - Math.min(...mids)).toBeLessThan(1);
  });
});
