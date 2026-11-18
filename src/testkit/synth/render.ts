/**
 * Full performance renderer (01 section 13.2). Renders a monophonic line in one of the nine testkit timbres and
 * reports ground truth computed with `core/onset-definition.ts` (01 section 7.4) from the renderer's own control
 * signals, so the truth is the definition applied to the ideal (noise-free, dry) signal.
 *
 * Model
 * - A line is split into voices (breaths, bow strokes, phrases). A note joins the current voice when it starts
 *   within `joinGapSec` of the previous note's end; it then connects with a glide (slurred, different pitch) or a
 *   re-articulation dip (tongue stop, bow change, glottal re-onset). Otherwise a new voice attacks from silence.
 *   Piano notes are always struck and the previous key is damped before the next strike.
 * - Every note's `onsetSec` is the time the 7.4 definition should report. The renderer places the physical event
 *   so that it does: a silence attack starts `delta` before the target, where `delta` is the definition's onset on
 *   the isolated attack; a dip reaches its minimum half its rise time before the target (half-rise in dB); a glide
 *   is centred on the target (cents-midpoint crossing).
 * - Truth is then recomputed on the full control envelope (low-band RMS, 0.25 ms hops, dB, floored at
 *   `levelDb - 60`) and the control pitch track, so overlaps, vibrato and AM move it the way the definition says.
 *   `targetOnsetSec` keeps the scripted value.
 *
 * The control envelope is the expected low-band (below 3 kHz, 01 section 7.2) RMS of the dry signal: tone
 * partials below 3 kHz plus the expected power of the breath and attack noise in that band.
 *
 * Determinism: pure function of the spec; only Math functions and the seeded mulberry32 generator.
 */
import { onsetFromSilence, pitchChangeOnset, repeatedOnset, SILENCE_ONSET_WINDOW_SEC, type EnvelopeSeries } from '../../core/onset-definition.ts';
import { createRng } from '../../core/rng.ts';
import type { TestkitTimbre } from '../../core/types.ts';
import { applyCascade, butterworth, dbToGain, gauss, midiToHz } from './dsp-util.ts';
import { harmonicAmps, LOW_BAND_HZ, lowBandFraction, MAX_PARTIAL_HZ, TIMBRES, type AttackNoiseSpec, type TimbreDef, type VibratoSpec } from './timbres.ts';

/** One note of a performance. */
export interface SynthNoteSpec {
  /** Concert MIDI; may be fractional (added to `cents`). */
  midi: number;
  cents?: number;
  /** Target onset under the 01 section 7.4 definition, seconds. */
  onsetSec: number;
  /** Sounding time from the onset, seconds (key or breath held). */
  durSec: number;
  /** Relative amplitude, default 1. */
  amp?: number;
  /** Connect to the previous note with a glide when joined and the pitch differs. */
  slur?: boolean;
  /** Attack time for a silence attack, overriding the timbre (the soft-attack condition). */
  attackSec?: number;
  /** Re-articulation dip depth for this note when it joins the previous one, dB (default: the timbre's). */
  dipDb?: number;
  /** Caller's reference, copied to the truth (for example the played-note index). */
  ref?: number;
}

export interface PerformanceSpec {
  timbre: TestkitTimbre;
  notes: readonly SynthNoteSpec[];
  /** Default 48000. Partials above 0.45 x rate or 7 kHz are not rendered. */
  sampleRate?: number;
  /** Default: last note end plus release plus 0.2 s. */
  durationSec?: number;
  /** RMS of a full-level steady tone, dBFS (default -18). */
  levelDb?: number;
  a4Hz?: number;
  /** Vibrato for every voice; undefined = the timbre default, null = none. */
  vibrato?: VibratoSpec | null;
  /** Breath noise relative to the tone, dB; undefined = timbre default, null = none. */
  breathDb?: number | null;
  /** Attack noise (chiff, bow scratch, hammer); default true. */
  attackNoise?: boolean;
  /** A note starting within this gap of the previous note's end joins its voice (default 0.025 s). */
  joinGapSec?: number;
  /** Noise seed (breath and attack noise), default 1. */
  seed?: number;
}

export type OnsetRule = 'silence' | 'dip' | 'pitch-change';

export interface PerformanceTruthNote {
  /** Index in onset order. */
  idx: number;
  ref: number | null;
  /** Nominal integer concert MIDI and the cents offset from it (what a perfect pitch tracker reads). */
  midi: number;
  cents: number;
  freqHz: number;
  /** Scripted onset. */
  targetOnsetSec: number;
  /** Onset by the 7.4 definition on the clean control signals. */
  onsetSec: number;
  /** End of this note's sounding (the next joined onset, or the gate end before the release). */
  offsetSec: number;
  /** Physical event: attack start (silence), dip minimum (dip) or glide centre (pitch change). */
  eventSec: number;
  onsetRule: OnsetRule;
  onsetCause: 'from-silence' | 'repeat' | 'pitch-change';
  /** 7.4 item 4 for dips; true otherwise. */
  detectable: boolean;
  dipDb: number | null;
  amDepthDb: number | null;
  /** For silence attacks: the confirming time the definition was evaluated at (attack start + 20 ms). */
  confirmT: number | null;
}

export interface SynthRender {
  samples: Float32Array;
  sampleRate: number;
  truth: PerformanceTruthNote[];
  /** Control envelope: low-band RMS in dB, floored at `floorDb`. */
  envelope: EnvelopeSeries;
  floorDb: number;
  levelDb: number;
  /** Control pitch (fractional MIDI incl. vibrato) of the voice sounding at t, or null. */
  pitchAt: (t: number) => number | null;
}

/** Resolution of the control envelope and pitch track used for truth. */
export const CONTROL_HOP_SEC = 0.00025;
/** Truth envelope floor below `levelDb`, dB. */
export const TRUTH_FLOOR_REL_DB = 60;

type Conn = 'attack' | 'legato' | 'rearticulate';

interface Seg {
  sortedIdx: number;
  midi: number;
  amp: number;
  target: number;
  dur: number;
  conn: Conn;
  /** Event window (glide or dip) for joined segments. */
  ws: number;
  we: number;
  glide: number;
  tMin: number;
  fall: number;
  rise: number;
  dipDb: number;
}

const smooth = (s: number): number => (s <= 0 ? 0 : s >= 1 ? 1 : s * s * (3 - 2 * s));

class Voice {
  readonly segs: Seg[] = [];
  start = 0;
  attackSec: number;
  gateEnd = 0;
  releaseSec: number;
  dampSec: number;
  private cur = 0;

  constructor(
    readonly t: TimbreDef,
    readonly vib: VibratoSpec | null,
    readonly a4: number,
    attackSec: number,
  ) {
    this.attackSec = attackSec;
    this.releaseSec = t.releaseSec;
    this.dampSec = t.struck?.dampSec ?? 0;
  }

  get end(): number {
    return this.t.kind === 'struck' ? this.gateEnd + 1.5 * this.dampSec : this.gateEnd + this.releaseSec;
  }

  private segAt(t: number): number {
    const s = this.segs;
    if (this.cur >= s.length || (s[this.cur] as Seg).ws > t) this.cur = 0;
    while (this.cur + 1 < s.length && (s[this.cur + 1] as Seg).ws <= t) this.cur++;
    return this.cur;
  }

  vibDepth(t: number): number {
    if (!this.vib) return 0;
    return smooth((t - this.start) / Math.max(1e-6, this.vib.delaySec));
  }

  /** Fractional MIDI including vibrato. */
  pitch(t: number): number {
    const j = this.segAt(t);
    const s = this.segs[j] as Seg;
    let m = s.midi;
    if (j > 0 && t < s.we) {
      const p = this.segs[j - 1] as Seg;
      if (s.conn === 'legato') m = p.midi + (s.midi - p.midi) * smooth((t - s.ws) / s.glide);
      else m = p.midi + (s.midi - p.midi) * smooth((t - (s.tMin - 0.002)) / 0.004);
    }
    if (this.vib) m += (this.vib.cents / 100) * this.vibDepth(t) * Math.sin(2 * Math.PI * this.vib.hz * (t - this.start));
    return m;
  }

  /** Linear amplitude of the tone (attack, decay, dips, release, AM, note amp) and attack progress r. */
  env(t: number): { e: number; r: number } {
    if (t < this.start) return { e: 0, r: 0 };
    const rel = t - this.start;
    const T = this.t;
    let r = 1;
    let base: number;
    if (rel < this.attackSec) {
      r = 0.5 * (1 - Math.cos((Math.PI * rel) / this.attackSec));
      base = r;
    } else if (T.kind === 'struck' || T.decaySec <= 0) {
      base = 1;
    } else {
      base = T.sustain + (1 - T.sustain) * Math.exp((-5 * (rel - this.attackSec)) / T.decaySec);
    }
    const j = this.segAt(t);
    const s = this.segs[j] as Seg;
    let amp = s.amp;
    let dipDb = 0;
    if (j > 0 && t < s.we) {
      const p = this.segs[j - 1] as Seg;
      if (s.conn === 'legato') {
        amp = p.amp + (s.amp - p.amp) * smooth((t - s.ws) / s.glide);
      } else {
        amp = p.amp + (s.amp - p.amp) * smooth((t - s.ws) / s.fall);
        if (t <= s.tMin) dipDb = s.dipDb * 0.5 * (1 - Math.cos((Math.PI * (t - s.ws)) / s.fall));
        else dipDb = s.dipDb * 0.5 * (1 + Math.cos((Math.PI * (t - s.tMin)) / s.rise));
      }
    }
    let e = base * amp * (dipDb > 0 ? dbToGain(-dipDb) : 1);
    if (T.kind === 'sustained' && t > this.gateEnd) {
      const u = (t - this.gateEnd) / this.releaseSec;
      e *= u >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * u));
    }
    if (this.vib && this.vib.amDb > 0) {
      e *= dbToGain((this.vib.amDb / 2) * this.vibDepth(t) * Math.sin(2 * Math.PI * this.vib.hz * (t - this.start)));
    }
    return { e, r };
  }

  /** Struck-voice damper factor. */
  damp(t: number): number {
    return t <= this.gateEnd ? 1 : Math.exp((-6.907755 * (t - this.gateEnd)) / this.dampSec);
  }

  /** Attack-noise envelope (sin^2 bump), linear. */
  noiseEnv(t: number, n: AttackNoiseSpec): number {
    const u = (t - this.start) / n.sec;
    if (u <= 0 || u >= 1) return 0;
    const s = Math.sin(Math.PI * u);
    return s * s;
  }
}

interface StruckPartials {
  f: Float64Array;
  a: Float64Array;
  tau: Float64Array;
}

function struckPartials(t: TimbreDef, f0: number, sr: number): StruckPartials {
  const st = t.struck as NonNullable<TimbreDef['struck']>;
  const amps = harmonicAmps(t, f0);
  const B = st.inharmonicityB * Math.sqrt(f0 / 261.6);
  const t60 = st.t60AtC4Sec * (261.6 / f0) ** 0.6;
  const fs: number[] = [];
  const as: number[] = [];
  const taus: number[] = [];
  for (let k = 1; k <= amps.length; k++) {
    const f = k * f0 * Math.sqrt((1 + B * k * k) / (1 + B));
    if (f >= Math.min(MAX_PARTIAL_HZ, 0.45 * sr)) break;
    fs.push(f);
    as.push(amps[k - 1] as number);
    taus.push(t60 / (1 + st.highDecay * (k - 1)) / 6.907755);
  }
  return { f: Float64Array.from(fs), a: Float64Array.from(as), tau: Float64Array.from(taus) };
}

class AmpCache {
  private readonly m = new Map<number, Float64Array>();
  constructor(private readonly t: TimbreDef) {}
  /** Harmonic amplitudes at f0 quantised to 1 cent. */
  get(f0: number): Float64Array {
    const key = Math.round(1200 * Math.log2(f0 / 440));
    let a = this.m.get(key);
    if (!a) {
      a = harmonicAmps(this.t, 440 * 2 ** (key / 1200));
      this.m.set(key, a);
    }
    return a;
  }
}

/** Band-passed Gaussian noise track at unit RMS. */
function noiseTrack(n: number, sr: number, lo: number, hi: number, seed: number): Float64Array {
  const rng = createRng(seed);
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = gauss(rng);
  applyCascade(x, [...butterworth('hp', lo, 4, sr), ...butterworth('lp', Math.min(hi, 0.45 * sr), 4, sr)]);
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (x[i] as number) ** 2;
  const g = ss > 0 ? 1 / Math.sqrt(ss / n) : 0;
  for (let i = 0; i < n; i++) x[i] = (x[i] as number) * g;
  return x;
}

/** Render a performance. Pure function of the spec. */
export function renderPerformance(spec: PerformanceSpec): SynthRender {
  const T = TIMBRES[spec.timbre];
  const sr = spec.sampleRate ?? 48000;
  if (!(sr >= 8000)) throw new RangeError('renderPerformance: sampleRate must be at least 8000');
  const a4 = spec.a4Hz ?? 440;
  const levelDb = spec.levelDb ?? -18;
  const gain = dbToGain(levelDb);
  const floorDb = levelDb - TRUTH_FLOOR_REL_DB;
  const vib = spec.vibrato === undefined ? T.vibrato : spec.vibrato;
  const breath = spec.breathDb === null ? null : T.breath ? { ...T.breath, db: spec.breathDb ?? T.breath.db } : null;
  const attackNoise = spec.attackNoise === false ? null : T.attackNoise;
  const joinGap = spec.joinGapSec ?? 0.025;
  const seed = spec.seed ?? 1;
  const cache = new AmpCache(T);
  const struckCache = new Map<number, StruckPartials>();

  const sorted = spec.notes.map((note, i) => ({ note, i })).sort((a, b) => a.note.onsetSec - b.note.onsetSec || a.i - b.i);

  // ---------------------------------------------------------------- plan voices
  const voices: Voice[] = [];
  const segOf: { v: Voice; j: number }[] = [];
  for (let n = 0; n < sorted.length; n++) {
    const note = (sorted[n] as (typeof sorted)[number]).note;
    const midi = note.midi + (note.cents ?? 0) / 100;
    const target = note.onsetSec;
    const amp = note.amp ?? 1;
    const prevV = voices[voices.length - 1];
    const last = prevV ? (prevV.segs[prevV.segs.length - 1] as Seg) : null;
    const seg: Seg = { sortedIdx: n, midi, amp, target, dur: note.durSec, conn: 'attack', ws: -Infinity, we: -Infinity, glide: 0, tMin: 0, fall: 0, rise: 0, dipDb: 0 };
    const joinable =
      T.kind === 'sustained' && prevV && last && target - (last.target + last.dur) <= joinGap && target - last.target >= 0.03;
    if (joinable && prevV && last) {
      const ioi = target - last.target;
      if (note.slur && Math.round(midi) !== Math.round(last.midi)) {
        seg.conn = 'legato';
        seg.glide = Math.min(T.glideSec, 0.5 * ioi, 0.5 * Math.max(0.01, note.durSec));
        seg.ws = target - seg.glide / 2;
        seg.we = target + seg.glide / 2;
      } else {
        seg.conn = 'rearticulate';
        const k = Math.min(1, (0.5 * ioi) / (T.rearticulation.fallSec + T.rearticulation.riseSec));
        seg.fall = T.rearticulation.fallSec * k;
        seg.rise = T.rearticulation.riseSec * k;
        seg.dipDb = note.dipDb ?? T.rearticulation.dipDb;
        seg.tMin = target - seg.rise / 2;
        seg.ws = seg.tMin - seg.fall;
        seg.we = seg.tMin + seg.rise;
      }
      prevV.segs.push(seg);
      prevV.gateEnd = Math.max(prevV.gateEnd, target + note.durSec);
      segOf.push({ v: prevV, j: prevV.segs.length - 1 });
      continue;
    }
    const v = new Voice(T, T.kind === 'struck' ? null : vib, a4, note.attackSec ?? T.attackSec);
    v.segs.push(seg);
    v.gateEnd = target + note.durSec;
    // Place the attack start so the isolated attack's 7.4 onset lands on the target.
    // (Fixed-point steps on the absolute 0.25 ms grid the truth uses.)
    v.start = target;
    for (let it = 0; it < 3; it++) {
      const err = isolatedSilenceOnset(v, T, gain, floorDb, cache, attackNoise, breath, sr, struckCache) - target;
      if (Math.abs(err) < 1e-6) break;
      v.start -= err;
    }
    if (prevV) {
      // The previous voice must be silent before this attack starts (a tongue or damper stop).
      if (T.kind === 'struck') {
        if (prevV.gateEnd > v.start - 0.003) prevV.gateEnd = Math.max(prevV.start + 0.01, v.start - 0.003);
        prevV.dampSec = Math.min(prevV.dampSec, Math.max(0.002, (v.start - prevV.gateEnd) / 1.5));
      } else {
        if (prevV.gateEnd > v.start - 0.006) prevV.gateEnd = Math.max(prevV.start + 0.01, v.start - 0.006);
        prevV.releaseSec = Math.min(prevV.releaseSec, Math.max(0.005, v.start - prevV.gateEnd - 0.001));
      }
    }
    voices.push(v);
    segOf.push({ v, j: 0 });
  }

  // Vibrato and AM move a glide's midpoint crossing and a dip's half-rise off the event. Shift each joined event
  // until the definition, evaluated on that voice, reports the target (a few fixed-point steps; the error is a
  // smooth function of the event time).
  if (vib) {
    for (const v of voices) {
      for (let j = 1; j < v.segs.length; j++) {
        const s = v.segs[j] as Seg;
        for (let it = 0; it < 4; it++) {
          const err = joinedOnset(v, j, T, gain, floorDb, cache, attackNoise, breath, sr, struckCache) - s.target;
          if (!Number.isFinite(err) || Math.abs(err) < 2e-5) break;
          const shift = Math.max(-0.008, Math.min(0.008, err));
          s.ws -= shift;
          s.we -= shift;
          if (s.conn === 'rearticulate') s.tMin -= shift;
        }
      }
    }
  }

  const lastEnd = voices.reduce((m, v) => Math.max(m, v.end), 0);
  const durationSec = spec.durationSec ?? lastEnd + 0.2;
  const n = Math.max(1, Math.round(durationSec * sr));
  const buf = new Float64Array(n);

  // ---------------------------------------------------------------- tone
  const nyq = 0.45 * sr;
  for (const v of voices) {
    const i0 = Math.max(0, Math.floor(v.start * sr));
    const i1 = Math.min(n, Math.ceil(v.end * sr) + 1);
    if (T.kind === 'struck') renderStruck(v, T, buf, i0, i1, sr, gain, struckCache);
    else renderSustained(v, T, buf, i0, i1, sr, gain, cache, nyq);
  }

  // ---------------------------------------------------------------- breath and attack noise
  if (breath && T.kind === 'sustained') {
    const track = noiseTrack(n, sr, breath.loHz, breath.hiHz, (seed * 7919 + 13) >>> 0);
    const g = gain * dbToGain(breath.db);
    for (const v of voices) {
      const i0 = Math.max(0, Math.floor(v.start * sr));
      const i1 = Math.min(n, Math.ceil(v.end * sr) + 1);
      for (let i = i0; i < i1; i++) buf[i] = (buf[i] as number) + g * v.env(i / sr).e * (track[i] as number);
    }
  }
  if (attackNoise) {
    // One short band-passed burst per attack (its own seed), with 20 ms of filter pre-roll.
    const g = gain * dbToGain(attackNoise.db);
    const pre = Math.round(0.02 * sr);
    voices.forEach((v, vi) => {
      const i0 = Math.max(0, Math.floor(v.start * sr));
      const i1 = Math.min(n, Math.ceil((v.start + attackNoise.sec) * sr) + 1);
      if (i1 <= i0) return;
      const track = noiseTrack(i1 - i0 + pre, sr, attackNoise.loHz, attackNoise.hiHz, (seed * 104729 + 7 + vi * 7919) >>> 0);
      for (let i = i0; i < i1; i++) buf[i] = (buf[i] as number) + g * v.noiseEnv(i / sr, attackNoise) * (track[i - i0 + pre] as number);
    });
  }

  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = Math.max(-1, Math.min(1, buf[i] as number));

  // ---------------------------------------------------------------- control envelope and truth
  const hops = Math.ceil(durationSec / CONTROL_HOP_SEC) + 1;
  const values = new Float64Array(hops);
  for (let h = 0; h < hops; h++) {
    const t = h * CONTROL_HOP_SEC;
    let p = 0;
    for (const v of voices) if (t >= v.start && t <= v.end) p += voicePower(v, T, t, gain, cache, attackNoise, breath, sr, struckCache);
    values[h] = Math.max(floorDb, p > 0 ? 10 * Math.log10(p) : -Infinity);
  }
  const envelope: EnvelopeSeries = { startT: 0, hopSec: CONTROL_HOP_SEC, values };

  const truth: PerformanceTruthNote[] = sorted.map(({ note }, k) => {
    const { v, j } = segOf[k] as { v: Voice; j: number };
    const s = v.segs[j] as Seg;
    const next = v.segs[j + 1];
    const intMidi = Math.round(s.midi);
    const base = {
      idx: k,
      ref: note.ref ?? null,
      midi: intMidi,
      cents: Math.round((s.midi - intMidi) * 100 * 1e6) / 1e6,
      freqHz: midiToHz(s.midi, a4),
      targetOnsetSec: s.target,
      offsetSec: next ? next.target : v.gateEnd,
    };
    if (s.conn === 'attack') {
      const confirmT = v.start + SILENCE_ONSET_WINDOW_SEC;
      const t = onsetFromSilence(envelope, { confirmT, fluxThreshold: Infinity }) ?? s.target;
      return { ...base, onsetSec: t, eventSec: v.start, onsetRule: 'silence', onsetCause: 'from-silence', detectable: true, dipDb: null, amDepthDb: null, confirmT };
    }
    const p = v.segs[j - 1] as Seg;
    if (s.conn === 'legato') {
      const frames: { t: number; midi: number; clarity: number }[] = [];
      for (let t = s.ws - 0.02; t <= s.we + 0.02; t += CONTROL_HOP_SEC) frames.push({ t, midi: v.pitch(t), clarity: 1 });
      const t = pitchChangeOnset(frames, p.midi, s.midi, 0.5) ?? s.target;
      return { ...base, onsetSec: t, eventSec: (s.ws + s.we) / 2, onsetRule: 'pitch-change', onsetCause: 'pitch-change', detectable: true, dipDb: null, amDepthDb: null, confirmT: null };
    }
    // Start of the previous note's steady part, which bounds the AM look-back (7.4 item 4).
    const prevSteady = j - 1 === 0 ? v.start + v.attackSec : p.we;
    const r = repeatedOnset(envelope, { searchStartT: s.ws - 0.003, searchEndT: s.we + 0.003, noteStartT: Math.min(prevSteady, s.ws - 0.004) });
    const cause = Math.round(p.midi) === intMidi ? 'repeat' : 'pitch-change';
    return {
      ...base,
      onsetSec: r?.t ?? s.target,
      eventSec: s.tMin,
      onsetRule: 'dip',
      onsetCause: cause,
      detectable: r?.detectable ?? false,
      dipDb: r?.dipDb ?? null,
      amDepthDb: r?.amDepthDb ?? null,
      confirmT: null,
    };
  });

  const pitchAt = (t: number): number | null => {
    for (const v of voices) if (t >= v.start && t <= v.gateEnd) return T.kind === 'struck' ? (v.segs[0] as Seg).midi : v.pitch(t);
    return null;
  };

  return { samples, sampleRate: sr, truth, envelope, floorDb, levelDb, pitchAt };
}

/** Expected low-band power of one voice at t (linear, squared full-scale units). */
function voicePower(
  v: Voice,
  T: TimbreDef,
  t: number,
  gain: number,
  cache: AmpCache,
  attackNoise: AttackNoiseSpec | null,
  breath: TimbreDef['breath'],
  sr: number,
  struckCache: Map<number, StruckPartials>,
): number {
  let p = 0;
  if (T.kind === 'struck') {
    const sp = struckOf(v, T, sr, struckCache);
    const rel = t - v.start;
    if (rel <= 0) return 0;
    const r = rel < v.attackSec ? 0.5 * (1 - Math.cos((Math.PI * rel) / v.attackSec)) : 1;
    const amp = (v.segs[0] as Seg).amp * r * v.damp(t);
    for (let k = 0; k < sp.f.length; k++) {
      if ((sp.f[k] as number) >= LOW_BAND_HZ) break;
      const a = amp * (sp.a[k] as number) * Math.exp(-rel / (sp.tau[k] as number));
      p += (a * a) / 2;
    }
  } else {
    const { e, r } = v.env(t);
    if (e > 0) {
      const f0 = midiToHz(v.pitch(t), v.a4);
      const a = cache.get(f0);
      const lim = Math.min(a.length, Math.floor((Math.min(LOW_BAND_HZ, 0.45 * sr) - 1e-9) / f0));
      for (let k = 0; k < lim; k++) {
        const w = (a[k] as number) * (r < 1 ? r ** (T.attackBrightness * k) : 1);
        p += (w * w) / 2;
      }
      p *= e * e;
      if (breath) p += (e * dbToGain(breath.db)) ** 2 * lowBandFraction(breath.loHz, Math.min(breath.hiHz, 0.45 * sr));
    }
  }
  if (attackNoise) {
    const ne = v.noiseEnv(t, attackNoise) * dbToGain(attackNoise.db);
    p += ne * ne * lowBandFraction(attackNoise.loHz, Math.min(attackNoise.hiHz, 0.45 * sr));
  }
  return p * gain * gain;
}

function struckOf(v: Voice, T: TimbreDef, sr: number, c: Map<number, StruckPartials>): StruckPartials {
  const midi = (v.segs[0] as Seg).midi;
  const key = Math.round(midi * 1000);
  let sp = c.get(key);
  if (!sp) {
    sp = struckPartials(T, midiToHz(midi, v.a4), sr);
    c.set(key, sp);
  }
  return sp;
}

/** The 7.4 onset of joined segment j (glide or dip), evaluated on its voice alone. */
function joinedOnset(
  v: Voice,
  j: number,
  T: TimbreDef,
  gain: number,
  floorDb: number,
  cache: AmpCache,
  attackNoise: AttackNoiseSpec | null,
  breath: TimbreDef['breath'],
  sr: number,
  struckCache: Map<number, StruckPartials>,
): number {
  const s = v.segs[j] as Seg;
  const p = v.segs[j - 1] as Seg;
  if (s.conn === 'legato') {
    const frames: { t: number; midi: number; clarity: number }[] = [];
    for (let t = s.ws - 0.02; t <= s.we + 0.02; t += CONTROL_HOP_SEC) frames.push({ t, midi: v.pitch(t), clarity: 1 });
    return pitchChangeOnset(frames, p.midi, s.midi, 0.5) ?? NaN;
  }
  const prevSteady = j - 1 === 0 ? v.start + v.attackSec : p.we;
  const t0 = Math.min(prevSteady, s.ws - 0.004) - 0.21;
  const hops = Math.ceil((s.we + 0.01 - t0) / CONTROL_HOP_SEC);
  const values = new Float64Array(hops);
  for (let h = 0; h < hops; h++) {
    const t = t0 + h * CONTROL_HOP_SEC;
    const pw = t >= v.start ? voicePower(v, T, t, gain, cache, attackNoise, breath, sr, struckCache) : 0;
    values[h] = Math.max(floorDb, pw > 0 ? 10 * Math.log10(pw) : -Infinity);
  }
  const r = repeatedOnset({ startT: t0, hopSec: CONTROL_HOP_SEC, values }, { searchStartT: s.ws - 0.003, searchEndT: s.we + 0.003, noteStartT: Math.min(prevSteady, s.ws - 0.004) });
  return r?.t ?? NaN;
}

/** The 7.4 silence onset of a voice's attack, evaluated on that voice alone. */
function isolatedSilenceOnset(
  v: Voice,
  T: TimbreDef,
  gain: number,
  floorDb: number,
  cache: AmpCache,
  attackNoise: AttackNoiseSpec | null,
  breath: TimbreDef['breath'],
  sr: number,
  struckCache: Map<number, StruckPartials>,
): number {
  const t0 = Math.floor((v.start - 0.005) / CONTROL_HOP_SEC) * CONTROL_HOP_SEC;
  const hops = Math.ceil(0.06 / CONTROL_HOP_SEC);
  const values = new Float64Array(hops);
  for (let h = 0; h < hops; h++) {
    const t = t0 + h * CONTROL_HOP_SEC;
    const p = t >= v.start ? voicePower(v, T, t, gain, cache, attackNoise, breath, sr, struckCache) : 0;
    values[h] = Math.max(floorDb, p > 0 ? 10 * Math.log10(p) : -Infinity);
  }
  return onsetFromSilence({ startT: t0, hopSec: CONTROL_HOP_SEC, values }, { confirmT: v.start + SILENCE_ONSET_WINDOW_SEC, fluxThreshold: Infinity }) ?? v.start;
}

function renderSustained(v: Voice, T: TimbreDef, buf: Float64Array, i0: number, i1: number, sr: number, gain: number, cache: AmpCache, nyq: number): void {
  // Control (frequency, amplitude, partial weights) runs every BLOCK samples (1/6 ms at 48 kHz); frequency and
  // amplitude are interpolated linearly inside a block. The truth uses the exact control functions.
  const BLOCK = 8;
  let phase = 0;
  let w = new Float64Array(0);
  let K = 0;
  let fA = midiToHz(v.pitch(i0 / sr), v.a4);
  let eA = v.env(i0 / sr).e;
  for (let b0 = i0; b0 < i1; b0 += BLOCK) {
    const b1 = Math.min(i1, b0 + BLOCK);
    const tB = b1 / sr;
    const fB = midiToHz(v.pitch(tB), v.a4);
    const { e: eB, r } = v.env(tB);
    const a = cache.get(fA);
    K = Math.min(a.length, Math.floor((nyq - 1e-9) / Math.max(fA, fB)));
    if (w.length < K) w = new Float64Array(K);
    for (let k = 0; k < K; k++) w[k] = (a[k] as number) * (r < 1 ? r ** (T.attackBrightness * k) : 1);
    const span = b1 - b0;
    for (let i = b0; i < b1; i++) {
      const u = (i - b0) / span;
      const f = fA + (fB - fA) * u;
      const e = eA + (eB - eA) * u;
      phase += (2 * Math.PI * f) / sr;
      if (phase > 2 * Math.PI) phase -= 2 * Math.PI;
      if (e <= 0 || K === 0) continue;
      const s1 = Math.sin(phase);
      const c2 = 2 * Math.cos(phase);
      let sPrev = 0;
      let sCur = s1;
      let sum = (w[0] as number) * s1;
      for (let k = 1; k < K; k++) {
        const sNext = c2 * sCur - sPrev;
        sPrev = sCur;
        sCur = sNext;
        sum += (w[k] as number) * sNext;
      }
      buf[i] = (buf[i] as number) + gain * e * sum;
    }
    fA = fB;
    eA = eB;
  }
}

function renderStruck(v: Voice, T: TimbreDef, buf: Float64Array, i0: number, i1: number, sr: number, gain: number, c: Map<number, StruckPartials>): void {
  const sp = struckOf(v, T, sr, c);
  const K = sp.f.length;
  const re = new Float64Array(K);
  const im = new Float64Array(K);
  const cr = new Float64Array(K);
  const ci = new Float64Array(K);
  const dec = new Float64Array(K);
  const amp = new Float64Array(K);
  const t0 = i0 / sr;
  for (let k = 0; k < K; k++) {
    const w = (2 * Math.PI * (sp.f[k] as number)) / sr;
    // Phase zero at the attack start.
    const ph = w * (t0 - v.start) * sr;
    re[k] = Math.cos(ph);
    im[k] = Math.sin(ph);
    cr[k] = Math.cos(w);
    ci[k] = Math.sin(w);
    dec[k] = Math.exp(-1 / ((sp.tau[k] as number) * sr));
    amp[k] = (sp.a[k] as number) * Math.exp(-Math.max(0, t0 - v.start) / (sp.tau[k] as number));
  }
  const noteAmp = (v.segs[0] as Seg).amp;
  for (let i = i0; i < i1; i++) {
    const t = i / sr;
    const rel = t - v.start;
    let s = 0;
    for (let k = 0; k < K; k++) {
      const x = (re[k] as number) * (cr[k] as number) - (im[k] as number) * (ci[k] as number);
      const y = (re[k] as number) * (ci[k] as number) + (im[k] as number) * (cr[k] as number);
      re[k] = x;
      im[k] = y;
      if (rel > 0) {
        s += (amp[k] as number) * y;
        amp[k] = (amp[k] as number) * (dec[k] as number);
      }
    }
    if ((i - i0) % 1024 === 1023) {
      for (let k = 0; k < K; k++) {
        const m = Math.hypot(re[k] as number, im[k] as number);
        re[k] = (re[k] as number) / m;
        im[k] = (im[k] as number) / m;
      }
    }
    if (rel <= 0) continue;
    const r = rel < v.attackSec ? 0.5 * (1 - Math.cos((Math.PI * rel) / v.attackSec)) : 1;
    buf[i] = (buf[i] as number) + gain * noteAmp * r * v.damp(t) * s;
  }
}
