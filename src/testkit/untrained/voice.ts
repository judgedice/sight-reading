/**
 * The "untrained voice" performer model (round 2 detection, docs/redesign/round2/03-detection.md).
 *
 * The P3 voice (src/testkit/synth) is a trained singer: every note starts on pitch, holds it with a regular 5 to 6 Hz
 * vibrato of at most 30 c, slurs with a 60 ms glide and stops cleanly. The owner, an untrained baritone on a laptop's
 * built-in mic and speakers, saw one sung note drawn as several. This model sings the written notes (right pitch,
 * nearly right time) the way an untrained singer does:
 *
 * - scoops: the note starts 60 to 250 c flat (sometimes sharp) and slides up over 60 to 200 ms;
 * - drift: a slow random walk of up to about 20 c inside the note, on top of a per-note offset of up to 20 c;
 * - wide, irregular vibrato on some notes: 4 to 7 Hz with cycle-to-cycle jitter, 25 to 70 c peak;
 * - breathy onsets (a noise burst before the voice) and consonants (a short unvoiced burst: "da", "ta");
 * - decaying ends that wobble: the last 80 to 220 ms fall (or rise) 40 to 200 c while the level dies away;
 * - breaths between some notes, and syllable dips of 4 to 14 dB between joined notes (one vowel per note);
 * - low level (-40 to -26 dBFS RMS) and level changes of a few dB from note to note;
 * - creaky onsets on low notes: period doubling (a subharmonic at f0 / 2) for the first 40 to 120 ms;
 * - a laptop mic that rolls off the fundamental (4th-order high-pass at 180 to 260 Hz), so low notes (98 to 196 Hz)
 *   reach the detector mostly through their harmonics and invite octave errors.
 *
 * Truth is simple on purpose: one played note per written note, at the written concert pitch plus the note's offset
 * (never more than 25 c, so a wrong-pitch verdict is always false), starting at the written onset plus a jitter. The
 * gate counts what a singer would call wrong: extra notes, notes judged wrong pitch, notes judged missed.
 *
 * Determinism: a pure function of the spec and seed (mulberry32 only).
 */
import { createRng } from '../../core/rng.ts';
import type { ExpectedNote, Rng } from '../../core/types.ts';
import { applyCascade, butterworth, dbToGain, gauss, midiToHz } from '../synth/dsp-util.ts';
import { harmonicAmps, TIMBRES } from '../synth/timbres.ts';

/** How one note is sung. All times seconds, pitches cents. */
export interface SungNote {
  /** Index of the written note. */
  ref: number;
  /** Written concert MIDI. */
  midi: number;
  /** Steady offset from the written pitch, cents (|offset| <= 25). */
  offsetCents: number;
  /** Voice onset (the voice starts sounding), audio seconds. */
  onsetSec: number;
  /** End of the voice (before any release), audio seconds. */
  endSec: number;
  /** Joined to the previous note (no breath): a syllable dip of `dipDb`, or a glide when the pitch differs. */
  joined: boolean;
  dipDb: number;
  /** Scoop at the start: start offset (cents, negative = from below) and its length. 0 = none. */
  scoopCents: number;
  scoopSec: number;
  /** Release wobble: pitch movement over the last `releaseSec` while the level falls. */
  releaseCents: number;
  releaseSec: number;
  /** Vibrato: rate, peak depth (0 = none), cycle jitter fraction. */
  vibHz: number;
  vibCents: number;
  vibJitter: number;
  /** Drift random-walk scale, cents. */
  driftCents: number;
  /** Breathy onset: noise before the voice, seconds (0 = none), level relative to the tone, dB. */
  breathSec: number;
  breathDb: number;
  /** Unvoiced consonant before the vowel, seconds (0 = none). */
  consonantSec: number;
  /** Creaky onset: period doubling for this long (0 = none). */
  creakSec: number;
  /** Level of the note relative to the take, dB. */
  gainDb: number;
  /** Attack time of the voice, seconds. */
  attackSec: number;
}

export interface UntrainedVoiceTake {
  notes: SungNote[];
  /** RMS of a full-level steady tone, dBFS. */
  levelDb: number;
  /** Laptop mic high-pass, Hz (4th order). */
  micHighPassHz: number;
  noiseDbfs: number;
  seed: number;
}

const uniform = (rng: Rng, a: number, b: number): number => a + (b - a) * rng.next();

/**
 * Draws how an untrained singer sings `expected` (score seconds; `t0Sec` is score time 0 in the audio). Ties are
 * already merged in `expected`; written rests become breaths.
 */
export function planUntrainedVoice(expected: readonly ExpectedNote[], t0Sec: number, bpm: number, seed: number): UntrainedVoiceTake {
  const rng = createRng(seed);
  const beat = 60 / bpm;
  const notes: SungNote[] = [];
  expected.forEach((e, i) => {
    const next = expected[i + 1];
    const on = t0Sec + (e.onsetSec as number) + Math.max(-0.05, Math.min(0.05, 0.022 * gauss(rng)));
    const writtenEnd = t0Sec + (e.onsetSec as number) + e.durSec;
    const nextOn = next ? t0Sec + (next.onsetSec as number) : Infinity;
    const breath = !next || next.precededByRest || rng.next() < 0.15;
    // A breath ends the note 80 to 220 ms before the next one (or before its written end when that is earlier);
    // a joined note runs into the next onset.
    let end = breath ? Math.min(writtenEnd - uniform(rng, 0, 0.25) * e.durSec, nextOn - uniform(rng, 0.08, 0.22)) : nextOn;
    end = Math.max(on + Math.min(0.12, 0.6 * e.durSec), end);
    const prev = notes[notes.length - 1];
    const joined = !!prev && prev.endSec >= on - 1e-6;
    const samePitch = !!prev && prev.midi === e.concertMidi;
    const scoop = rng.next() < 0.55;
    const release = breath && rng.next() < 0.75;
    const vib = e.durSec >= 0.35 && rng.next() < 0.5;
    const low = e.concertMidi <= 55;
    notes.push({
      ref: i,
      midi: e.concertMidi,
      offsetCents: Math.max(-20, Math.min(20, 9 * gauss(rng))),
      onsetSec: on,
      endSec: end,
      joined,
      dipDb: joined ? (samePitch ? uniform(rng, 8, 16) : uniform(rng, 3, 12)) : 0,
      scoopCents: scoop ? (rng.next() < 0.85 ? -uniform(rng, 60, 250) : uniform(rng, 40, 120)) : 0,
      scoopSec: scoop ? Math.min(uniform(rng, 0.06, 0.2), 0.5 * (end - on)) : 0,
      releaseCents: release ? (rng.next() < 0.8 ? -uniform(rng, 40, 200) : uniform(rng, 30, 100)) : 0,
      releaseSec: release ? Math.min(uniform(rng, 0.08, 0.22), 0.45 * (end - on)) : 0,
      vibHz: uniform(rng, 4, 7),
      vibCents: vib ? uniform(rng, 25, 70) : 0,
      vibJitter: uniform(rng, 0.05, 0.2),
      driftCents: uniform(rng, 4, 12),
      breathSec: !joined && rng.next() < 0.4 ? uniform(rng, 0.04, 0.1) : 0,
      breathDb: uniform(rng, -18, -8),
      consonantSec: rng.next() < 0.3 ? uniform(rng, 0.015, 0.04) : 0,
      creakSec: low && !joined && rng.next() < 0.35 ? uniform(rng, 0.04, 0.12) : 0,
      gainDb: uniform(rng, -4, 2),
      attackSec: uniform(rng, 0.03, 0.09),
    });
    void beat;
  });
  return {
    notes,
    levelDb: uniform(rng, -40, -26),
    micHighPassHz: uniform(rng, 180, 260),
    noiseDbfs: uniform(rng, -62, -50),
    seed,
  };
}

const smooth = (u: number): number => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

/** Control track of one note: cents from its written pitch, and linear amplitude, at time t (audio seconds). */
function noteControl(n: SungNote, t: number, drift: (t: number) => number, vibPhase: (t: number) => number): { cents: number; amp: number } {
  const rel = t - n.onsetSec;
  const left = n.endSec - t;
  let cents = n.offsetCents + drift(t);
  if (n.scoopSec > 0 && rel < n.scoopSec) cents += n.scoopCents * (1 - smooth(rel / n.scoopSec));
  if (n.releaseSec > 0 && left < n.releaseSec) cents += n.releaseCents * smooth(1 - left / n.releaseSec);
  if (n.vibCents > 0) cents += n.vibCents * smooth((rel - 0.15) / 0.3) * Math.sin(vibPhase(t));
  let amp = dbToGain(n.gainDb) * (rel < n.attackSec ? 0.5 * (1 - Math.cos((Math.PI * Math.max(0, rel)) / n.attackSec)) : 1);
  // A long note sags a little; a released end dies away by about 25 dB.
  amp *= dbToGain(-3 * Math.min(1, rel / 2));
  if (n.releaseSec > 0 && left < n.releaseSec) amp *= dbToGain(-25 * smooth(1 - left / n.releaseSec));
  else if (left < 0.03) amp *= 0.5 * (1 + Math.cos(Math.PI * (1 - Math.max(0, left) / 0.03)));
  return { cents, amp };
}

/** Renders the take at `sampleRate` (default 48 kHz), mic and noise applied; `durationSec` total length. */
export function renderUntrainedVoice(take: UntrainedVoiceTake, durationSec: number, sampleRate = 48000): Float32Array {
  const sr = sampleRate;
  const n = Math.max(1, Math.round(durationSec * sr));
  const out = new Float64Array(n);
  const voice = TIMBRES.voice;
  const gain = dbToGain(take.levelDb);
  const rng = createRng((take.seed * 2654435761 + 11) >>> 0);
  const noiseRng = createRng((take.seed * 40503 + 7) >>> 0);

  // Per note: drift as a smoothed random walk at 20 Hz control points; vibrato phase with cycle jitter.
  for (const note of take.notes) {
    const i0 = Math.max(0, Math.floor((note.onsetSec - note.breathSec - note.consonantSec - 0.01) * sr));
    const i1 = Math.min(n, Math.ceil(note.endSec * sr) + 1);
    const steps = Math.max(2, Math.ceil((note.endSec - note.onsetSec) * 20) + 2);
    const walk = new Float64Array(steps);
    for (let k = 1; k < steps; k++) walk[k] = 0.85 * (walk[k - 1] as number) + note.driftCents * 0.5 * gauss(rng);
    const drift = (t: number): number => {
      const x = Math.max(0, (t - note.onsetSec) * 20);
      const k = Math.min(steps - 2, Math.floor(x));
      const u = Math.min(1, x - k);
      return (walk[k] as number) * (1 - u) + (walk[k + 1] as number) * u;
    };
    const jit = Array.from({ length: 64 }, () => 1 + note.vibJitter * (rng.next() * 2 - 1));
    const vibPhase = (t: number): number => {
      const rel = Math.max(0, t - note.onsetSec);
      const cyc = rel * note.vibHz;
      const k = Math.floor(cyc);
      return 2 * Math.PI * (k + (cyc - k) * (jit[k % 64] as number));
    };
    // Tone: additive voice ("ah" formants), phase-continuous; a joined note starts from the previous pitch (the glide
    // is the previous note's end meeting this note's scoop).
    let phase = 0;
    let amps = harmonicAmps(voice, midiToHz(note.midi));
    let ampsAt = note.midi;
    for (let i = Math.max(i0, Math.floor(note.onsetSec * sr)); i < i1; i++) {
      const t = i / sr;
      const c = noteControl(note, t, drift, vibPhase);
      let amp = c.amp;
      if (note.joined && note.dipDb > 0) {
        // Syllable dip at the join: the level falls by dipDb around the onset and recovers in 30 to 40 ms.
        const d = t - note.onsetSec;
        if (d < 0.04) amp *= dbToGain(-note.dipDb * (1 - smooth(d / 0.04)));
      }
      const midi = note.midi + c.cents / 100;
      const f0 = midiToHz(midi);
      if (Math.abs(midi - ampsAt) > 0.5) {
        amps = harmonicAmps(voice, f0);
        ampsAt = midi;
      }
      phase += (2 * Math.PI * f0) / sr;
      if (phase > 4 * Math.PI) phase -= 4 * Math.PI;
      let s = 0;
      const K = Math.min(amps.length, Math.floor((0.45 * sr) / f0));
      for (let k = 0; k < K; k++) s += (amps[k] as number) * Math.sin((k + 1) * phase);
      // Creak: period doubling, every other period louder (a subharmonic at f0 / 2).
      const rel = t - note.onsetSec;
      if (note.creakSec > 0 && rel < note.creakSec) s *= 1 + 0.6 * (1 - rel / note.creakSec) * Math.sin(phase / 2);
      out[i] = (out[i] as number) + gain * amp * s;
    }
    // Breath before the voice and a consonant burst just before the vowel: unvoiced noise, 1 to 6 kHz.
    const bursts: { from: number; to: number; db: number }[] = [];
    if (note.breathSec > 0) bursts.push({ from: note.onsetSec - note.breathSec, to: note.onsetSec + 0.02, db: note.breathDb });
    if (note.consonantSec > 0) bursts.push({ from: note.onsetSec - note.consonantSec, to: note.onsetSec + 0.005, db: -6 });
    for (const b of bursts) {
      const j0 = Math.max(0, Math.floor(b.from * sr));
      const j1 = Math.min(n, Math.ceil(b.to * sr));
      if (j1 <= j0) continue;
      const x = new Float64Array(j1 - j0);
      for (let j = 0; j < x.length; j++) x[j] = gauss(noiseRng);
      applyCascade(x, [...butterworth('hp', 1000, 2, sr), ...butterworth('lp', 6000, 2, sr)]);
      const g = gain * dbToGain(note.gainDb + b.db);
      for (let j = 0; j < x.length; j++) {
        const u = j / x.length;
        out[j0 + j] = (out[j0 + j] as number) + g * Math.sin(Math.PI * u) * (x[j] as number);
      }
    }
  }
  // Breath noise under the voice (as the P3 voice), then the laptop mic and its noise floor.
  applyCascade(out, butterworth('hp', take.micHighPassHz, 4, sr));
  const ng = dbToGain(take.noiseDbfs);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = Math.max(-1, Math.min(1, (out[i] as number) + ng * gauss(noiseRng)));
  return samples;
}
