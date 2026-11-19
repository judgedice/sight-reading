/**
 * The Listen voice (05 §9.2): one soft piano-like tone for every instrument, rendered into buffers.
 *
 * Additive: fundamental, 2nd harmonic at -8 dB, 3rd at -16 dB; 5 ms attack; exponential decay to -24 dB over the
 * note or 2 s, whichever is shorter (then held at -24 dB); 60 ms release after the note's written end. Buffers are
 * peak-normalised, so every pitch and length plays at the same level. No oscillator is used (lint rule, W10): the
 * partials are summed sample by sample, once per pitch and length, and cached.
 *
 * The caller passes sounding (concert) frequencies; `tuneHz` turns a MIDI note into one at the player's `a4Hz`.
 */

export const ATTACK_SEC = 0.005;
export const RELEASE_SEC = 0.06;
export const DECAY_DB = -24;
export const DECAY_MAX_SEC = 2;
/** Harmonic levels relative to the fundamental, dB. */
export const HARMONIC_DB: readonly number[] = [0, -8, -16];
/** Peak level of the Listen bus, dBFS (05 §9.2: about -12, independent of click volume). */
export const LISTEN_BUS_DBFS = -12;
/** Linear gain of the Listen bus. */
export const LISTEN_BUS_GAIN = 10 ** (LISTEN_BUS_DBFS / 20);

const MAX_CACHE = 256;

/** Sounding frequency of a MIDI note at the player's tuning pitch. */
export function tuneHz(midi: number, a4Hz: number): number {
  return a4Hz * 2 ** ((midi - 69) / 12);
}

/** Envelope at `t` seconds into a note of `durSec`: attack, exponential decay, then the release after `durSec`. */
export function listenEnvelope(t: number, durSec: number): number {
  if (t < 0) return 0;
  const decaySec = Math.max(1e-3, Math.min(durSec, DECAY_MAX_SEC));
  const held = (u: number): number => 10 ** ((DECAY_DB / 20) * Math.min(u, decaySec) / decaySec);
  const attack = t < ATTACK_SEC ? 0.5 - 0.5 * Math.cos((Math.PI * t) / ATTACK_SEC) : 1;
  if (t < durSec) return attack * held(t);
  const r = (t - durSec) / RELEASE_SEC;
  if (r >= 1) return 0;
  return attack * held(durSec) * (0.5 + 0.5 * Math.cos(Math.PI * r));
}

/** One note, mono, peak-normalised to `peak` (0..1). Length is the note plus its release. */
export function renderListenNote(hz: number, durSec: number, sampleRate: number, peak = 1): Float32Array {
  const dur = Math.max(0.01, durSec);
  const n = Math.max(1, Math.ceil((dur + RELEASE_SEC) * sampleRate));
  const out = new Float32Array(n);
  const amps = HARMONIC_DB.map((db) => 10 ** (db / 20));
  const nyquist = sampleRate / 2;
  let max = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    let s = 0;
    for (let h = 0; h < amps.length; h++) {
      const f = hz * (h + 1);
      if (f < nyquist) s += (amps[h] as number) * Math.sin(2 * Math.PI * f * t);
    }
    s *= listenEnvelope(t, dur);
    out[i] = s;
    const a = Math.abs(s);
    if (a > max) max = a;
  }
  const scale = max > 0 ? Math.min(1, Math.max(0, peak)) / max : 0;
  for (let i = 0; i < n; i++) out[i] = (out[i] as number) * scale;
  return out;
}

/** Rendered notes, keyed by pitch (to 0.01 Hz), length (to 1 ms), peak and rate. Oldest entries leave first. */
export class ListenVoiceCache {
  private readonly map = new Map<string, Float32Array>();

  get(hz: number, durSec: number, sampleRate: number, peak: number): Float32Array {
    const key = `${Math.round(hz * 100)}|${Math.round(durSec * 1000)}|${Math.round(peak * 100)}|${sampleRate}`;
    let b = this.map.get(key);
    if (b) {
      this.map.delete(key);
    } else {
      b = renderListenNote(hz, durSec, sampleRate, peak);
      if (this.map.size >= MAX_CACHE) this.map.delete(this.map.keys().next().value as string);
    }
    this.map.set(key, b);
    return b;
  }

  get size(): number {
    return this.map.size;
  }
}
