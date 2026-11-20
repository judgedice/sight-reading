/**
 * The instrument sampler (round 2, 02-sounds.md "Sampler design"; the reference is `SampleSet` in
 * docs/redesign/round2/sounds-demo.html).
 *
 * 1. Load: `index.json` is fetched once, a set on its first use. Every sample is decoded and kept. The onset is
 *    measured in the decoded buffer (first sample above 3% of the peak) and compared with the manifest's: the
 *    difference (`shift`) covers decoders that keep the MP3 priming and is added to the start offset and both loop
 *    points.
 * 2. Pick: the sample nearest in semitones to the target; on a tie, the one above (shifting down sounds better).
 * 3. Rate: `(a4Hz / 440) * 2^((target - sample.midi - sample.tune / 100) / 12)`.
 * 4. Loop: sustained sets loop between the manifest points (buffer time, so the rate does not move them).
 * 5. Envelope: a linear rise over the attack, hold, a linear fall over the release; the source stops just after.
 *
 * Fetch and decode are injected, so the Vitest suite drives the same code against fakes and the e2e suite renders
 * it in an `OfflineAudioContext`. Loading never throws: a missing set, a failed fetch or a failed decode reports
 * `fallback`, and the caller plays the additive Listen voice instead.
 */
import { parseSoundManifest, type SampleDef, type SetDef, type SoundManifest } from './sample-manifest.ts';

/** Onset threshold, fraction of the buffer's peak (02-sounds.md, step 1). */
export const ONSET_THRESHOLD = 0.03;
/** The source stops this long after the release ends, seconds. */
export const STOP_PAD_SEC = 0.02;
/** Fade used when a sounding note is cut short (`stopSounds`), seconds. */
export const CUT_FADE_SEC = 0.015;
/**
 * Linear gain of a sample at `peak` 1, before the Listen bus. The sets are levelled to -20 dBFS RMS with a -1 dBFS
 * peak ceiling; +12 dB brings them near the additive voice's loudness while the loudest peak stays under full scale
 * after the bus (-12 dBFS): 0.89 x 3.98 x 0.25 = 0.89.
 */
export const SAMPLE_GAIN = 10 ** (12 / 20);

// ---- the pure parts ---------------------------------------------------------------------------------

/** A decoded mono buffer, as far as the sampler reads it. A Web Audio `AudioBuffer` satisfies it. */
export interface DecodedBuffer {
  readonly sampleRate: number;
  readonly length: number;
  readonly duration: number;
  getChannelData(channel: number): Float32Array;
}

/** Seconds from the buffer's first sample to the first one above `ONSET_THRESHOLD` of the peak. */
export function onsetSec(buf: DecodedBuffer): number {
  const x = buf.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i] as number);
    if (a > peak) peak = a;
  }
  if (peak === 0) return 0;
  const thr = peak * ONSET_THRESHOLD;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i] as number) > thr) return i / buf.sampleRate;
  return 0;
}

/** How much later the decoded sound starts than the manifest says (never negative), seconds. */
export function onsetShift(measuredOnsetSec: number, manifestOnsetSec: number): number {
  return Math.max(0, measuredOnsetSec - manifestOnsetSec);
}

/** Nearest sample in semitones to `midi`; on a tie, the one above. `samples` must not be empty. */
export function pickSample<T extends { midi: number }>(samples: readonly T[], midi: number): T {
  let best: T | null = null;
  let bestD = Infinity;
  for (const s of samples) {
    const d = Math.abs(s.midi - midi);
    if (best === null || d < bestD || (d === bestD && s.midi > best.midi)) {
      best = s;
      bestD = d;
    }
  }
  if (best === null) throw new RangeError('pickSample: no samples');
  return best;
}

/** Playback rate that sounds `targetMidi` at the player's tuning pitch from `sample`. */
export function playbackRateFor(targetMidi: number, sample: Pick<SampleDef, 'midi' | 'tune'>, a4Hz = 440): number {
  return (a4Hz / 440) * 2 ** ((targetMidi - sample.midi - sample.tune / 100) / 12);
}

/** Fractional MIDI note of a sounding frequency against A4 = 440 Hz. */
export function midiOfHz(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

/**
 * Loop points in buffer time, or null for a one-shot. The decoded onset shift moves both points; a loop that would
 * run past the buffer's end is dropped (the note then plays through once rather than wrapping into silence).
 */
export function loopPoints(kind: SetDef['kind'], sample: SampleDef, shiftSec: number, bufferSec: number): { loopStart: number; loopEnd: number } | null {
  if (kind !== 'sustain' || sample.loopStart === undefined || sample.loopEnd === undefined) return null;
  const loopStart = sample.loopStart + shiftSec;
  const loopEnd = sample.loopEnd + shiftSec;
  if (loopEnd > bufferSec + 1e-6 || loopEnd <= loopStart) return null;
  return { loopStart, loopEnd };
}

/** Gain automation of one note: 0 at `when`, `gain` after `attack`, held to the note's end, 0 after `release`. */
export function envelopePoints(when: number, durSec: number, attack: number, release: number, gain: number): { at: number; value: number; ramp: boolean }[] {
  const holdEnd = when + Math.max(attack, durSec);
  return [
    { at: when, value: 0, ramp: false },
    { at: when + attack, value: gain, ramp: true },
    { at: holdEnd, value: gain, ramp: false },
    { at: holdEnd + release, value: 0, ramp: true },
  ];
}

/** When the note's source stops, context seconds. */
export function stopTimeFor(when: number, durSec: number, attack: number, release: number): number {
  return when + Math.max(attack, durSec) + release + STOP_PAD_SEC;
}

// ---- Web Audio shapes the sampler uses ------------------------------------------------------------------

export interface SamplerParam {
  value: number;
  setValueAtTime(v: number, t: number): unknown;
  linearRampToValueAtTime(v: number, t: number): unknown;
  cancelScheduledValues(t: number): unknown;
}

export interface SamplerNode {
  connect(dest: SamplerNode): unknown;
  disconnect(): void;
}

export interface SamplerGain extends SamplerNode {
  readonly gain: SamplerParam;
}

export interface SamplerSource extends SamplerNode {
  buffer: DecodedBuffer | null;
  readonly playbackRate: { value: number };
  loop: boolean;
  loopStart: number;
  loopEnd: number;
  onended: (() => void) | null;
  start(when: number, offset?: number): void;
  stop(when?: number): void;
}

/** What a note needs of its context. `AudioContext` and `OfflineAudioContext` satisfy it. */
export interface SamplerContext {
  readonly currentTime: number;
  createBufferSource(): SamplerSource;
  createGain(): SamplerGain;
}

export interface Decoder {
  decodeAudioData(data: ArrayBuffer): Promise<DecodedBuffer>;
}

/** The part of a `fetch` response the sampler reads. */
export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type FetchLike = (url: string) => Promise<FetchResponseLike>;

/** True when `ctx` can play samples: it decodes and its nodes take automation (the real Web Audio API). */
export function isSamplerContext(ctx: unknown): ctx is SamplerContext & Decoder {
  if (typeof ctx !== 'object' || ctx === null) return false;
  const c = ctx as Record<string, unknown>;
  return typeof c.decodeAudioData === 'function' && typeof c.createBufferSource === 'function' && typeof c.createGain === 'function';
}

// ---- loading ------------------------------------------------------------------------------------------

export interface LoadedSample {
  def: SampleDef;
  buffer: DecodedBuffer;
  /** Onset correction, seconds. */
  shift: number;
}

export interface LoadedSet {
  id: string;
  def: SetDef;
  samples: LoadedSample[];
}

export type SoundLoadState = 'idle' | 'loading' | 'ready' | 'failed' | 'missing';

export interface SamplerOptions {
  /** URL of the sounds folder, ending in '/'. Relative URLs resolve against the page (the build uses `base: './'`). */
  base: string;
  fetch: FetchLike;
  /** The decoder to use now; null when none is available yet (the load then reports `fallback` and may be retried). */
  decoder: () => Decoder | null;
}

/** One playing note. `stop()` fades out over `CUT_FADE_SEC` and stops the source. */
export interface SampleVoice {
  stop(): void;
  disconnect(): void;
  onended: (() => void) | null;
}

export interface SampleNoteOptions {
  /** Linear gain at the top of the envelope. */
  gain: number;
  /** Overrides the set's attack, seconds (Match a note uses about 80 ms). */
  attackSec?: number;
  /** Tuning pitch the target is given against (default 440: the target is then an A440 MIDI value). */
  a4Hz?: number;
}

export class Sampler {
  private readonly o: SamplerOptions;
  private manifestP: Promise<SoundManifest | null> | null = null;
  private readonly states = new Map<string, SoundLoadState>();
  private readonly loading = new Map<string, Promise<'ready' | 'fallback'>>();
  private readonly loaded = new Map<string, LoadedSet>();
  private readonly bytes = new Map<string, Promise<ArrayBuffer>>();

  constructor(o: SamplerOptions) {
    this.o = o;
  }

  /** The manifest, fetched once. Null when it cannot be read; a later call tries again. */
  manifest(): Promise<SoundManifest | null> {
    if (!this.manifestP) {
      const p = this.o
        .fetch(`${this.o.base}index.json`)
        .then(async (r) => {
          if (!r.ok) throw new Error(`sounds/index.json: ${r.status}`);
          return parseSoundManifest(await r.json());
        })
        .catch(() => {
          if (this.manifestP === p) this.manifestP = null;
          return null;
        });
      this.manifestP = p;
    }
    return this.manifestP;
  }

  state(id: string): SoundLoadState {
    return this.states.get(id) ?? 'idle';
  }

  /** The set, when it is decoded and ready to play now. */
  ready(id: string): LoadedSet | null {
    return this.loaded.get(id) ?? null;
  }

  /**
   * Loads the set once. `ready` when it can play; `fallback` when the set is missing from the manifest, or a fetch
   * or decode failed (a failed load is tried again on the next call; a missing set is not). Never rejects.
   */
  prepare(id: string): Promise<'ready' | 'fallback'> {
    if (this.loaded.has(id)) return Promise.resolve('ready');
    if (this.states.get(id) === 'missing') return Promise.resolve('fallback');
    const inflight = this.loading.get(id);
    if (inflight) return inflight;
    this.states.set(id, 'loading');
    const p = this.load(id)
      .then((set): 'ready' | 'fallback' => {
        if (set === 'missing') {
          this.states.set(id, 'missing');
          return 'fallback';
        }
        this.loaded.set(id, set);
        this.states.set(id, 'ready');
        return 'ready';
      })
      .catch((): 'fallback' => {
        this.states.set(id, 'failed');
        return 'fallback';
      })
      .finally(() => this.loading.delete(id));
    this.loading.set(id, p);
    return p;
  }

  private async load(id: string): Promise<LoadedSet | 'missing'> {
    const manifest = await this.manifest();
    if (!manifest) throw new Error('sounds/index.json unavailable');
    const def = manifest.sets[id];
    if (!def) return 'missing';
    const samples = await Promise.all(
      def.samples.map(async (s): Promise<LoadedSample> => {
        const data = await this.fileBytes(`${this.o.base}${id}/${s.file}`);
        const decoder = this.o.decoder();
        if (!decoder) throw new Error('no decoder');
        // decodeAudioData detaches its argument; keep the fetched bytes for a later retry or another decoder.
        const buffer = await decoder.decodeAudioData(data.slice(0));
        return { def: s, buffer, shift: onsetShift(onsetSec(buffer), s.onset) };
      }),
    );
    return { id, def, samples };
  }

  private fileBytes(url: string): Promise<ArrayBuffer> {
    let p = this.bytes.get(url);
    if (!p) {
      p = this.o.fetch(url).then((r) => {
        if (!r.ok) throw new Error(`${url}: ${r.status}`);
        return r.arrayBuffer();
      });
      p.catch(() => this.bytes.delete(url));
      this.bytes.set(url, p);
    }
    return p;
  }

  /**
   * Plays `targetMidi` (sounding, fractional) from `set` at `when` for `durSec` into `out`. The note sustains for any
   * length on a looped set; a one-shot plays through and ends.
   */
  play(ctx: SamplerContext, out: SamplerNode, set: LoadedSet, targetMidi: number, when: number, durSec: number, opts: SampleNoteOptions): SampleVoice {
    return startSampleNote(ctx, out, set, targetMidi, when, durSec, opts);
  }
}

/** Schedules one sampled note (also used directly by the e2e render). */
export function startSampleNote(ctx: SamplerContext, out: SamplerNode, set: LoadedSet, targetMidi: number, when: number, durSec: number, opts: SampleNoteOptions): SampleVoice {
  const a4 = opts.a4Hz ?? 440;
  // Pick against the whole note asked for: a target given as an A440 value from a slightly sharp or flat tuning pitch
  // (438 to 442 Hz) rounds back to that note, so an exact tie still goes to the sample above.
  const nominal = Math.round(targetMidi);
  const pick = pickSample(set.samples.map((s) => ({ midi: s.def.midi, s })), nominal).s;
  const src = ctx.createBufferSource();
  src.buffer = pick.buffer;
  src.playbackRate.value = playbackRateFor(targetMidi, pick.def, a4);
  const loop = loopPoints(set.def.kind, pick.def, pick.shift, pick.buffer.duration);
  if (loop) {
    src.loop = true;
    src.loopStart = loop.loopStart;
    src.loopEnd = loop.loopEnd;
  }
  const attack = Math.max(0, opts.attackSec ?? set.def.attack);
  const release = set.def.release;
  const g = ctx.createGain();
  for (const p of envelopePoints(when, durSec, attack, release, opts.gain)) {
    if (p.ramp) g.gain.linearRampToValueAtTime(p.value, p.at);
    else g.gain.setValueAtTime(p.value, p.at);
  }
  src.connect(g);
  g.connect(out);
  const stopAt = stopTimeFor(when, durSec, attack, release);
  src.start(when, pick.shift);
  src.stop(stopAt);
  let done = false;
  const voice: SampleVoice = {
    onended: null,
    stop(): void {
      if (done) return;
      const now = ctx.currentTime;
      try {
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(now < when ? 0 : g.gain.value, now);
        g.gain.linearRampToValueAtTime(0, now + CUT_FADE_SEC);
        src.stop(now + CUT_FADE_SEC);
      } catch {
        // Already stopped.
      }
    },
    disconnect(): void {
      // The source and its gain are freed when the source ends (after the cut fade), so a cut never clicks.
    },
  };
  src.onended = () => {
    done = true;
    src.disconnect();
    g.disconnect();
    voice.onended?.();
  };
  return voice;
}
