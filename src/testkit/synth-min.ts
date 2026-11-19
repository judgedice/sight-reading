/**
 * Minimal deterministic synth (01 section 14 item 12). Additive renderer: harmonics, ADSR, legato glide,
 * tonguing dip, click bleed at known times, white noise. P3 extends timbres and realism conditions
 * behind the same `renderMin` signature.
 *
 * Ground truth: `truth[i].onsetSec` is the scripted onset. For the amplitude envelope the onset is where the
 * attack starts; for a legato note it is the time the pitch crosses the cents midpoint (the glide is centred on
 * it), which is exactly what the 7.4 pitch-change definition measures. P3 tightens this to the full definition.
 *
 * Determinism: only Math.sin/cos/exp/pow/sqrt and the seeded mulberry32 generator are used, and the output is
 * a pure function of the spec. Reference WAV checksums are taken over 16-bit quantised output on Node 22.
 */
import { renderClick } from '../core/click-sounds.ts';
import { createRng } from '../core/rng.ts';
import type { ClickTimbre } from '../core/types.ts';

/** Every metronome timbre: the legacy Tick and Wood and the player's sounds (06 section 9). */
export type SynthClickTimbre = ClickTimbre;

export interface SynthNote {
  /** Concert MIDI note (integer or fractional). */
  midi: number;
  onsetSec: number;
  /** Gate length (sounding time before the release). */
  durSec: number;
  /** Detune from `midi`, cents. */
  cents?: number;
  /** Relative amplitude, default 1. */
  amp?: number;
  /** Continue the previous voice with a pitch glide instead of re-attacking. The glide is centred on `onsetSec`. */
  legato?: boolean;
  /** Tonguing dip: dip depth in dB applied to the previous voice, reaching its minimum at `onsetSec`. */
  tongueDipDb?: number;
}

export interface SynthClick {
  t: number;
  accent?: boolean;
}

export interface SynthAdsr {
  attackSec: number;
  decaySec: number;
  /** Sustain level, linear 0..1. */
  sustain: number;
  releaseSec: number;
}

export interface SynthSpec {
  sampleRate: number;
  notes: readonly SynthNote[];
  /** Total length; default: last note end plus release plus 0.1 s. */
  durationSec?: number;
  a4Hz?: number;
  /** Relative harmonic amplitudes, first is the fundamental. */
  harmonics?: readonly number[];
  adsr?: Partial<SynthAdsr>;
  /** Pitch glide duration for legato notes, default 0.04 s. */
  glideSec?: number;
  /** Tonguing dip duration, default 0.03 s. */
  tongueDipSec?: number;
  vibrato?: { hz: number; cents: number };
  /** Peak level of a full-scale note, dBFS (default -12). */
  levelDb?: number;
  /** Click bleed events, rendered into the signal at their times. */
  clicks?: readonly SynthClick[];
  clickTimbre?: SynthClickTimbre;
  /** Click peak relative to `levelDb`, dB (default -20). */
  bleedDb?: number;
  /** White noise floor RMS, dBFS. Omit for none. */
  noiseDbfs?: number;
  /** Seed for the noise (default 1). */
  seed?: number;
}

export interface SynthTruthNote {
  idx: number;
  midi: number;
  cents: number;
  freqHz: number;
  onsetSec: number;
  /** End of the gate (start of the release). */
  offsetSec: number;
  legato: boolean;
  tongueDipDb: number;
}

export interface SynthResult {
  samples: Float32Array;
  sampleRate: number;
  truth: SynthTruthNote[];
  /** Click times as rendered (arrival at the capture point), seconds. */
  clickTimes: number[];
}

export const DEFAULT_HARMONICS: readonly number[] = [1, 0.5, 0.33, 0.25, 0.15];
export const DEFAULT_ADSR: SynthAdsr = { attackSec: 0.02, decaySec: 0.08, sustain: 0.8, releaseSec: 0.04 };

const midiToHz = (midi: number, a4: number): number => a4 * 2 ** ((midi - 69) / 12);
const dbToGain = (db: number): number => 10 ** (db / 20);

/**
 * One pre-rendered click burst, peak-normalised to 1 (01 section 7.6): tick is a 12 ms noise-like burst in
 * 5.5 to 9 kHz (18 ms when accented), wood an 8 ms burst in 1.5 to 4 kHz. Built from fixed-seed random partials, so
 * every call returns the same samples. Classic, Woodblock and Beep are the metronome's own renders
 * (`src/core/click-sounds.ts`, offbeat recipe, or accent recipe when `accent`), so bleed matches the speakers.
 */
export function clickBurst(timbre: SynthClickTimbre, accent: boolean, sampleRate: number): Float32Array {
  if (timbre !== 'tick' && timbre !== 'wood') return renderClick(timbre, accent, sampleRate);
  const band: [number, number] = timbre === 'tick' ? [5500, 9000] : [1500, 4000];
  const lenSec = timbre === 'tick' ? (accent ? 0.018 : 0.012) : 0.008;
  const attackSec = timbre === 'tick' ? 0.002 : 0.001;
  const n = Math.max(1, Math.round(lenSec * sampleRate));
  const rng = createRng(timbre === 'tick' ? 0x71c4 : 0x300d);
  const partials: { w: number; ph: number }[] = [];
  for (let k = 0; k < 40; k++) {
    const f = band[0] + rng.next() * (band[1] - band[0]);
    partials.push({ w: (2 * Math.PI * f) / sampleRate, ph: rng.next() * 2 * Math.PI });
  }
  const out = new Float32Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const env = (t < attackSec ? t / attackSec : 1) * Math.exp((-5 * t) / lenSec);
    let s = 0;
    for (const p of partials) s += Math.sin(p.w * i + p.ph);
    const v = s * env;
    out[i] = v;
    if (Math.abs(v) > peak) peak = Math.abs(v);
  }
  if (peak > 0) for (let i = 0; i < n; i++) out[i] = (out[i] as number) / peak;
  return out;
}

interface Voice {
  notes: { note: SynthNote; truthIdx: number; freq: number; midi: number }[];
  start: number;
  /** Gate end. */
  end: number;
  /** Dip applied to this voice from the following voice's onset: [onset, depthDb]. */
  dip: { onset: number; db: number } | null;
}

/** Render a performance. Pure function of the spec. */
export function renderMin(spec: SynthSpec): SynthResult {
  const sr = spec.sampleRate;
  if (!(sr > 0)) throw new RangeError('renderMin: sampleRate must be positive');
  const a4 = spec.a4Hz ?? 440;
  const harmonics = spec.harmonics ?? DEFAULT_HARMONICS;
  const adsr: SynthAdsr = { ...DEFAULT_ADSR, ...spec.adsr };
  const glide = spec.glideSec ?? 0.04;
  const dipSec = spec.tongueDipSec ?? 0.03;
  const peak = dbToGain(spec.levelDb ?? -12);
  const hsum = harmonics.reduce((a, b) => a + b, 0) || 1;
  const sorted = spec.notes.map((note, i) => ({ note, i })).sort((a, b) => a.note.onsetSec - b.note.onsetSec || a.i - b.i);

  const truth: SynthTruthNote[] = [];
  const voices: Voice[] = [];
  for (const { note } of sorted) {
    const cents = note.cents ?? 0;
    const midi = note.midi + cents / 100;
    const freq = midiToHz(midi, a4);
    const idx = truth.length;
    const end = note.onsetSec + note.durSec;
    truth.push({
      idx, midi: note.midi, cents, freqHz: freq, onsetSec: note.onsetSec, offsetSec: end,
      legato: false, tongueDipDb: note.tongueDipDb ?? 0,
    });
    const prev = voices[voices.length - 1];
    if (note.legato && prev && prev.end >= note.onsetSec - 1e-6) {
      prev.notes.push({ note, truthIdx: idx, freq, midi });
      prev.end = Math.max(prev.end, end);
      (truth[idx] as SynthTruthNote).legato = true;
    } else {
      if (prev && note.tongueDipDb && note.tongueDipDb > 0) {
        prev.dip = { onset: note.onsetSec, db: note.tongueDipDb };
        prev.end = Math.max(prev.end, note.onsetSec);
      }
      voices.push({ notes: [{ note, truthIdx: idx, freq, midi }], start: note.onsetSec, end, dip: null });
    }
  }

  const lastEnd = voices.reduce((m, v) => Math.max(m, v.end + adsr.releaseSec), 0);
  const clicks = spec.clicks ?? [];
  const legacyClick = (spec.clickTimbre ?? 'tick') === 'tick' || spec.clickTimbre === 'wood';
  // The new sounds run up to 60 ms; the legacy tail stays 20 ms so the reference WAVs keep their checksums.
  const clickTail = clicks.reduce((m, c) => Math.max(m, c.t + (legacyClick ? 0.02 : 0.065)), 0);
  const durationSec = spec.durationSec ?? Math.max(lastEnd + 0.1, clickTail);
  const n = Math.max(1, Math.round(durationSec * sr));
  const buf = new Float64Array(n);

  for (const v of voices) {
    const i0 = Math.max(0, Math.floor(v.start * sr));
    const i1 = Math.min(n, Math.ceil((v.end + adsr.releaseSec) * sr));
    const bounds = v.notes.slice(1).map((nn, k) => {
      const prevMidi = (v.notes[k] as Voice['notes'][number]).midi;
      return { start: nn.note.onsetSec - glide / 2, end: nn.note.onsetSec + glide / 2, from: prevMidi, to: nn.midi };
    });
    let phase = 0;
    let bi = 0;
    let ni = 0;
    for (let i = i0; i < i1; i++) {
      const t = i / sr;
      while (bi < bounds.length && t >= (bounds[bi] as (typeof bounds)[number]).end) bi++;
      let midi: number;
      const b = bounds[bi];
      if (b && t > b.start) {
        const s = (t - b.start) / glide;
        midi = b.from + (b.to - b.from) * (s * s * (3 - 2 * s));
      } else {
        midi = (v.notes[bi] as Voice['notes'][number]).midi;
      }
      while (ni + 1 < v.notes.length && t >= (v.notes[ni + 1] as Voice['notes'][number]).note.onsetSec) ni++;
      if (spec.vibrato) midi += (spec.vibrato.cents / 100) * Math.sin(2 * Math.PI * spec.vibrato.hz * (t - v.start));
      const f = midiToHz(midi, a4);
      phase += (2 * Math.PI * f) / sr;
      // Envelope
      const rel = t - v.start;
      let e: number;
      if (t >= v.end) {
        const sustainAtEnd = adsrLevel(v.end - v.start, adsr);
        e = sustainAtEnd * Math.max(0, 1 - (t - v.end) / adsr.releaseSec);
      } else {
        e = adsrLevel(rel, adsr);
      }
      if (v.dip && t > v.dip.onset - dipSec) {
        const u = Math.min(1, (t - (v.dip.onset - dipSec)) / dipSec);
        const depth = 1 - dbToGain(-v.dip.db);
        e *= 1 - depth * 0.5 * (1 - Math.cos(Math.PI * u));
      }
      let s = 0;
      const nyquistLimit = 0.45 * sr;
      for (let h = 0; h < harmonics.length; h++) {
        if ((h + 1) * f > nyquistLimit) break;
        s += (harmonics[h] as number) * Math.sin((h + 1) * phase);
      }
      const amp = (v.notes[ni] as Voice['notes'][number]).note.amp ?? 1;
      buf[i] = (buf[i] as number) + (s / hsum) * e * amp * peak;
    }
  }

  const clickTimes: number[] = [];
  if (clicks.length > 0) {
    const timbre = spec.clickTimbre ?? 'tick';
    const gain = peak * dbToGain(spec.bleedDb ?? -20);
    for (const c of clicks) {
      const burst = clickBurst(timbre, !!c.accent, sr);
      const g = gain * (c.accent ? dbToGain(5) : 1);
      const s0 = Math.round(c.t * sr);
      for (let k = 0; k < burst.length; k++) {
        const i = s0 + k;
        if (i >= 0 && i < n) buf[i] = (buf[i] as number) + (burst[k] as number) * g;
      }
      clickTimes.push(c.t);
    }
  }

  if (spec.noiseDbfs !== undefined) {
    const rng = createRng(spec.seed ?? 1);
    const rms = dbToGain(spec.noiseDbfs);
    for (let i = 0; i < n; i++) {
      // Six uniforms sum to variance 0.5; scale to unit variance, then to the requested RMS.
      const g = (rng.next() + rng.next() + rng.next() + rng.next() + rng.next() + rng.next() - 3) * Math.SQRT2;
      buf[i] = (buf[i] as number) + g * rms;
    }
  }

  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = Math.max(-1, Math.min(1, buf[i] as number));
  return { samples, sampleRate: sr, truth, clickTimes };
}

/** Attack (raised cosine), exponential decay to the sustain level. */
function adsrLevel(rel: number, a: SynthAdsr): number {
  if (rel <= 0) return 0;
  if (rel < a.attackSec) return 0.5 * (1 - Math.cos((Math.PI * rel) / a.attackSec));
  const d = rel - a.attackSec;
  if (a.decaySec <= 0) return a.sustain;
  return a.sustain + (1 - a.sustain) * Math.exp((-5 * d) / a.decaySec);
}
