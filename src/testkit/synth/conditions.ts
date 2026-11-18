/**
 * Realism conditions (01 section 13.2): the automated stand-in for real devices. Applied to a dry render, in the
 * order sound travels:
 *
 *   instrument + click bleed (through a small-speaker EQ)
 *     -> room impulse response (RT60 0.2 to 0.8 s)
 *     -> phone-mic EQ (2nd-order high-pass at 100 or 150 Hz, 2nd-order low-pass at 7 kHz)
 *     -> AGC pumping (level-following gain with fast attack and slow release)
 *     -> capture band limit (resample to 24 or 16 kHz, zero phase)
 *     -> noise floor (-45 or -50 dBFS, at the output rate)
 *
 * Soft attacks, vibrato and breath noise are performance-level conditions and live in the renderer's spec
 * (`PerformanceSpec.vibrato`, `breathDb`, `SynthNoteSpec.attackSec`); `performanceConditionSpec` maps them.
 *
 * Ground truth is unchanged by these conditions: it is defined on the dry signal. Every stage is zero-delay on
 * the direct path (the IR's direct impulse is at lag 0, resampling is zero-phase), so truth times stay valid; the
 * biquads add only their small low-frequency group delay.
 */
import { createRng } from '../../core/rng.ts';
import type { Rng, TestkitTimbre } from '../../core/types.ts';
import { clickBurst, type SynthClickTimbre } from '../synth-min.ts';
import { applyCascade, biquad, butterworth, convolve, dbToGain, decimate, gauss } from './dsp-util.ts';
import type { SynthRender, PerformanceTruthNote } from './render.ts';
import { TIMBRES, type VibratoSpec } from './timbres.ts';

export interface ClickBleedCondition {
  /** Arrival times at the mic (render seconds). */
  clicks: readonly { t: number; accent?: boolean }[];
  timbre: SynthClickTimbre;
  /** Click peak relative to the peak of a full-level sine at the render's `levelDb`, dB (-20 or -10). */
  bleedDb: number;
  /** Small-speaker EQ on the click (default true). */
  smallSpeaker?: boolean;
}

export interface RoomCondition {
  rt60Sec: number;
  /** Direct-to-reverberant energy ratio, dB (default 6). */
  drrDb?: number;
}

export interface AgcCondition {
  /** Level the AGC steers toward, dBFS RMS (default -20). */
  targetDbfs?: number;
  /** Gain limits, dB (default -12 and +12). */
  minGainDb?: number;
  maxGainDb?: number;
  /** Gain-reduction time constant (default 0.005 s) and recovery time constant (default 0.6 s). */
  attackSec?: number;
  releaseSec?: number;
  /** Level detector time constant (default 0.01 s). */
  detectorSec?: number;
  /** Look-ahead peak limiter ceiling, linear (default 0.89, -1 dBFS): phone AGCs do not clip on attacks. */
  limiterCeiling?: number;
}

export interface CaptureConditions {
  clickBleed?: ClickBleedCondition | null;
  room?: RoomCondition | null;
  phoneMic?: { highPassHz: number } | null;
  agc?: AgcCondition | null;
  /** Output (capture) rate: 48000 keeps the render rate, 24000 or 16000 band-limit and resample. */
  captureRateHz?: number;
  noiseDbfs?: number | null;
  /** Seed for the room IR and the noise floor (default 1). */
  seed?: number;
}

export interface CaptureRender {
  samples: Float32Array;
  sampleRate: number;
  /** Dry ground truth (render seconds). */
  truth: PerformanceTruthNote[];
  /** Rendered click arrivals (render seconds); empty without click bleed. */
  clickTimes: number[];
  conditions: CaptureConditions;
}

/** Synthetic room impulse response: direct path, sparse early reflections, exponentially decaying diffuse tail. */
export function roomImpulseResponse(room: RoomCondition, sr: number, rng: Rng): Float64Array {
  const rt60 = Math.max(0.05, room.rt60Sec);
  const len = Math.max(16, Math.round(Math.min(1.2, 1.1 * rt60) * sr));
  const h = new Float64Array(len);
  const tail = new Float64Array(len);
  const decay = 6.907755 / rt60;
  // Early reflections 3 to 25 ms, then a diffuse tail from 5 ms with a 10 ms fade-in.
  for (let k = 0; k < 6; k++) {
    const t = 0.003 + rng.next() * 0.022;
    const i = Math.round(t * sr);
    if (i < len) tail[i] = (tail[i] as number) + (rng.next() < 0.5 ? -1 : 1) * (0.4 + 0.4 * rng.next()) * Math.exp(-decay * t);
  }
  for (let i = Math.round(0.005 * sr); i < len; i++) {
    const t = i / sr;
    const fade = Math.min(1, (t - 0.005) / 0.01);
    tail[i] = (tail[i] as number) + 0.5 * gauss(rng) * Math.exp(-decay * t) * fade;
  }
  // Air and wall absorption: gentle low-pass on the reverberant part.
  applyCascade(tail, [biquad('lp', 6000, 0.707, sr)]);
  let e = 0;
  for (let i = 0; i < len; i++) e += (tail[i] as number) ** 2;
  // Tail energy relative to the unit direct impulse.
  const want = dbToGain(-(room.drrDb ?? 6)) ** 2;
  const g = e > 0 ? Math.sqrt(want / e) : 0;
  for (let i = 0; i < len; i++) h[i] = (tail[i] as number) * g;
  h[0] = (h[0] as number) + 1;
  return h;
}

/** Phone-mic EQ: 2nd-order high-pass at `highPassHz` and 2nd-order low-pass at 7 kHz. */
export const phoneMicEq = (highPassHz: number, sr: number): ReturnType<typeof butterworth> => [
  ...butterworth('hp', highPassHz, 2, sr),
  ...butterworth('lp', 7000, 2, sr),
];

/** Small-speaker click EQ: no bass (2nd-order high-pass at 500 Hz), a 3 kHz cone resonance, roll-off above 10 kHz. */
export const smallSpeakerEq = (sr: number): ReturnType<typeof butterworth> => [
  ...butterworth('hp', 500, 2, sr),
  biquad('peak', 3000, 1.5, sr, 6),
  ...butterworth('lp', 10000, 2, sr),
];

/** Feed-forward AGC: returns the per-sample gain applied (for tests) and modifies `x` in place. */
export function applyAgc(x: Float64Array, sr: number, c: AgcCondition): Float64Array {
  const target = c.targetDbfs ?? -20;
  const minG = c.minGainDb ?? -12;
  const maxG = c.maxGainDb ?? 12;
  const aDet = Math.exp(-1 / ((c.detectorSec ?? 0.01) * sr));
  const aAtt = Math.exp(-1 / ((c.attackSec ?? 0.005) * sr));
  const aRel = Math.exp(-1 / ((c.releaseSec ?? 0.6) * sr));
  // The gain law runs every BLOCK samples (0.33 ms at 48 kHz) and is interpolated linearly in between.
  const BLOCK = 16;
  const aAttB = aAtt ** BLOCK;
  const aRelB = aRel ** BLOCK;
  const ceiling = c.limiterCeiling ?? 0.89;
  const ahead = Math.round(0.002 * sr);
  const gains = new Float64Array(x.length);
  let pw = 0;
  let gDb = 0;
  let gPrev = 1;
  for (let i0 = 0; i0 < x.length; i0 += BLOCK) {
    const i1 = Math.min(x.length, i0 + BLOCK);
    for (let i = i0; i < i1; i++) {
      const v = x[i] as number;
      pw = aDet * pw + (1 - aDet) * v * v;
    }
    const lvl = 10 * Math.log10(pw + 1e-12);
    const want = Math.max(minG, Math.min(maxG, target - lvl));
    gDb = want < gDb ? aAttB * gDb + (1 - aAttB) * want : aRelB * gDb + (1 - aRelB) * want;
    let peak = 0;
    for (let i = i0; i < Math.min(x.length, i1 + ahead); i++) peak = Math.max(peak, Math.abs(x[i] as number));
    const g = Math.min(dbToGain(gDb), peak > 0 ? ceiling / peak : Infinity);
    if (g < gPrev) gPrev = g;
    for (let i = i0; i < i1; i++) {
      const gi = gPrev + ((g - gPrev) * (i - i0 + 1)) / (i1 - i0);
      gains[i] = gi;
      x[i] = (x[i] as number) * gi;
    }
    gPrev = g;
  }
  return gains;
}

/** Apply capture conditions to a dry render. Pure function of its inputs. */
export function applyConditions(dry: SynthRender, c: CaptureConditions): CaptureRender {
  const sr = dry.sampleRate;
  const rng = createRng(c.seed ?? 1);
  const x = Float64Array.from(dry.samples);
  const clickTimes: number[] = [];

  if (c.clickBleed && c.clickBleed.clicks.length > 0) {
    const cb = c.clickBleed;
    const click = new Float64Array(x.length);
    const peak = dbToGain(dry.levelDb) * Math.SQRT2 * dbToGain(cb.bleedDb);
    const bursts = { plain: clickBurst(cb.timbre, false, sr), accent: clickBurst(cb.timbre, true, sr) };
    for (const k of cb.clicks) {
      const b = k.accent ? bursts.accent : bursts.plain;
      const g = peak * (k.accent ? dbToGain(5) : 1);
      const s0 = Math.round(k.t * sr);
      for (let j = 0; j < b.length; j++) {
        const i = s0 + j;
        if (i >= 0 && i < x.length) click[i] = (click[i] as number) + (b[j] as number) * g;
      }
      clickTimes.push(k.t);
    }
    if (cb.smallSpeaker !== false) applyCascade(click, smallSpeakerEq(sr));
    for (let i = 0; i < x.length; i++) x[i] = (x[i] as number) + (click[i] as number);
  }

  let y: Float64Array = x;
  if (c.room) y = convolve(y, roomImpulseResponse(c.room, sr, rng));
  if (c.phoneMic) applyCascade(y, phoneMicEq(c.phoneMic.highPassHz, sr));
  if (c.agc) applyAgc(y, sr, c.agc);

  let outRate = sr;
  const capture = c.captureRateHz ?? sr;
  if (capture !== sr) {
    const factor = sr / capture;
    if (!Number.isInteger(factor)) throw new RangeError(`applyConditions: ${sr} Hz is not an integer multiple of ${capture} Hz`);
    y = decimate(y, factor, sr);
    outRate = capture;
  }

  if (c.noiseDbfs !== undefined && c.noiseDbfs !== null) {
    const nr = createRng(((c.seed ?? 1) * 2654435761 + 97) >>> 0);
    const g = dbToGain(c.noiseDbfs);
    for (let i = 0; i < y.length; i++) y[i] = (y[i] as number) + g * gauss(nr);
  }

  const samples = new Float32Array(y.length);
  for (let i = 0; i < y.length; i++) samples[i] = Math.max(-1, Math.min(1, y[i] as number));
  return { samples, sampleRate: outRate, truth: dry.truth, clickTimes, conditions: c };
}

/** Performance-level realism conditions (01 section 13.2). */
export interface PerformanceConditions {
  /** Soft attacks with this rise for voice and bowed timbres (30 to 80 ms). */
  softAttackSec?: number | null;
  /** Vibrato (5 to 6 Hz at up to +-30 c); undefined = timbre default, null = none. */
  vibrato?: VibratoSpec | null;
  /** Breath noise relative to the tone, dB; undefined = timbre default, null = none. */
  breathDb?: number | null;
}

/** Whether the soft-attack condition applies to a timbre (voice and bowed only). */
export const softAttackApplies = (timbre: TestkitTimbre): boolean => TIMBRES[timbre].softAttack;

/** A 5 to 6 Hz, +-`cents` vibrato with the AM that goes with it (flute and voice AM is 3 to 6 dB, 01 7.4). */
export function vibratoCondition(hz: number, cents: number, timbre: TestkitTimbre): VibratoSpec {
  const am = timbre === 'flute' ? 4 : timbre === 'voice' ? 3 : 2;
  return { hz, cents, amDb: am, delaySec: 0.15 };
}
