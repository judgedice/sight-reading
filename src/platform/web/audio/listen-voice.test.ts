import { describe, expect, it } from 'vitest';
import { LISTEN_BUS_GAIN, ListenVoiceCache, listenEnvelope, renderListenNote, tuneHz } from './listen-voice.ts';

const SR = 48000;

/** Amplitude of the component at `hz` over [from, from + len) seconds (Goertzel-equivalent projection). */
function amp(x: Float32Array, hz: number, from: number, len: number): number {
  const a = Math.round(from * SR);
  const n = Math.round(len * SR);
  let re = 0;
  let im = 0;
  for (let i = 0; i < n; i++) {
    const p = (2 * Math.PI * hz * (a + i)) / SR;
    re += (x[a + i] as number) * Math.cos(p);
    im += (x[a + i] as number) * Math.sin(p);
  }
  return (2 * Math.hypot(re, im)) / n;
}
const db = (r: number): number => 20 * Math.log10(r);

describe('Listen voice (05 §9.2)', () => {
  const hz = 480; // 100 samples per cycle at 48 kHz: whole cycles in every 50 ms window
  const x = renderListenNote(hz, 1, SR);

  it('is peak-normalised, mono length is the note plus the 60 ms release', () => {
    expect(Math.max(...x.map(Math.abs))).toBeCloseTo(1, 6);
    expect(x.length).toBe(Math.ceil(1.06 * SR));
    expect(Math.max(...renderListenNote(hz, 1, SR, 0.3).map(Math.abs))).toBeCloseTo(0.3, 6);
  });

  it('has the 2nd harmonic at -8 dB and the 3rd at -16 dB of the fundamental', () => {
    const w = 0.05;
    const f1 = amp(x, hz, 0.1, w);
    expect(db(amp(x, 2 * hz, 0.1, w) / f1)).toBeCloseTo(-8, 0);
    expect(db(amp(x, 3 * hz, 0.1, w) / f1)).toBeCloseTo(-16, 0);
    // Nothing at the 4th and 5th.
    expect(db(amp(x, 4 * hz, 0.1, w) / f1)).toBeLessThan(-40);
    expect(db(amp(x, 5 * hz, 0.1, w) / f1)).toBeLessThan(-40);
  });

  it('decays exponentially to -24 dB at the end of a 1 s note', () => {
    expect(db(listenEnvelope(1, 1))).toBeCloseTo(-24, 6);
    expect(db(listenEnvelope(0.5, 1))).toBeCloseTo(-12, 6);
    const w = 0.05;
    const early = amp(x, hz, 0.1, w);
    const late = amp(x, hz, 0.9, w);
    // Rendered level follows the envelope: 0.8 s of -24 dB per s.
    expect(db(late / early)).toBeCloseTo(-24 * 0.8, 0);
  });

  it('decays over at most 2 s: a 4 s note holds -24 dB after 2 s', () => {
    expect(db(listenEnvelope(2, 4))).toBeCloseTo(-24, 6);
    expect(db(listenEnvelope(3.5, 4))).toBeCloseTo(-24, 6);
  });

  it('attacks in 5 ms from silence and releases to zero in 60 ms', () => {
    expect(listenEnvelope(0, 1)).toBe(0);
    expect(listenEnvelope(0.005, 1)).toBeCloseTo(10 ** (-24 * 0.005 / 20), 3);
    expect(x[0]).toBe(0);
    expect(listenEnvelope(1.06, 1)).toBe(0);
    expect(Math.abs(x[x.length - 1] as number)).toBeLessThan(1e-3);
    expect(listenEnvelope(1.03, 1)).toBeCloseTo(0.5 * listenEnvelope(1, 1), 6);
  });

  it('drops harmonics above Nyquist', () => {
    const hi = renderListenNote(9000, 0.1, SR);
    expect(hi.every(Number.isFinite)).toBe(true);
  });

  it('tunes MIDI notes to the player a4Hz', () => {
    expect(tuneHz(69, 440)).toBe(440);
    expect(tuneHz(69, 442)).toBe(442);
    expect(tuneHz(57, 440)).toBeCloseTo(220, 9);
  });

  it('caches by pitch, length and peak, and bounds its size', () => {
    const c = new ListenVoiceCache();
    expect(c.get(440, 0.2, SR, 1)).toBe(c.get(440, 0.2, SR, 1));
    expect(c.get(440, 0.2, SR, 1)).not.toBe(c.get(440, 0.2, SR, 0.5));
    for (let i = 0; i < 300; i++) c.get(200 + i, 0.01, SR, 1);
    expect(c.size).toBeLessThanOrEqual(256);
  });

  it('the bus gain is -12 dBFS', () => {
    expect(20 * Math.log10(LISTEN_BUS_GAIN)).toBeCloseTo(-12, 9);
  });
});
