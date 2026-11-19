/**
 * Metronome click sounds (06 section 9, 01 section 7.6). Pure: the metronome, the testkit's click bleed and the
 * click gate test all render their clicks here, so what the speakers play is what the tests measure.
 *
 * Legacy timbres (`tick`, `wood`) render exactly as before the redesign: Tick is a burst of 40 seeded random-phase
 * partials over 5.5 to 9 kHz (12 ms, accent 18 ms, 2 ms attack, exponential decay), Wood the same over 1.5 to 4 kHz
 * (8 ms, 1 ms attack). The player's sounds (`classic`, `woodblock`, `beep`) follow the recipes of 06 section 9:
 * - every sound starts with layer T, the Tick burst (same partials, 2 ms attack), at sample 0;
 * - body layers also start at sample 0 with a 0.5 to 1 ms attack, so none moves the onset edge;
 * - nothing tonal below 1 kHz; partials are inharmonic and decay with tau <= 18 ms (the Beep is a 30 ms gated
 *   2 kHz tone);
 * - each layer is normalised to its own peak and weighted by its gain, the sum gets a 3 ms raised-cosine fade at
 *   the end and is peak-normalised to 1; every sound is 60 ms or shorter;
 * - partials at or above 0.475 x the sample rate are dropped (low capture rates cannot carry them).
 * These are sums of damped sinusoids written into a buffer once per sample rate; nothing here is an oscillator node.
 */
import { createRng } from './rng.ts';
import type { ClickTimbre, MetronomeSound } from './types.ts';

/** The default metronome sound (PLAN ruling 58). */
export const DEFAULT_METRONOME_SOUND: MetronomeSound = 'classic';

/** The sounds a player can choose, in the order the settings list them. */
export const METRONOME_SOUNDS: readonly MetronomeSound[] = ['classic', 'woodblock', 'beep'];

/** Seed of the Tick partials (and of layer T in every sound). */
const TICK_SEED = 0x71c4;
/** Seed of the Wood partials (and of the Classic knock band, as auditioned). */
const WOOD_SEED = 0x300d;
/** Partials at or above this fraction of the sample rate are dropped. */
const NYQUIST_GUARD = 0.475;
/** Raised-cosine fade at the end of every new sound, seconds. */
export const CLICK_FADE_SEC = 0.003;
/** Attack of layer T, seconds (the Tick burst's attack). */
export const TICK_ATTACK_SEC = 0.002;

/** One layer of a recipe (06 section 9.1 notation). */
export type ClickLayer =
  /** Layer T, the Tick burst: amplitude, decay length L (envelope exp(-5 t / L)), 2 ms linear attack. */
  | { kind: 'tick'; a: number; lengthSec: number }
  /** A noise band: 40 seeded partials uniform in [f1, f2], linear attack, exp(-t / tau). */
  | { kind: 'band'; f1: number; f2: number; a: number; attackSec: number; tauSec: number; seed: number }
  /** A damped partial: linear (or half-cosine) attack, exp(-t / tau). */
  | { kind: 'partial'; hz: number; a: number; attackSec: number; tauSec: number; halfCosine?: boolean }
  /** A gated tone with raised-cosine ramps, flat between, `lengthSec` in total. */
  | { kind: 'tone'; hz: number; a: number; rampSec: number; lengthSec: number };

export interface ClickRecipe {
  /** Total length, seconds (<= 0.06). */
  lengthSec: number;
  layers: readonly ClickLayer[];
}

/** 06 section 9.2 to 9.4: the offbeat and accent (beat one) recipe of each sound. */
export const CLICK_RECIPES: Readonly<Record<MetronomeSound, { offbeat: ClickRecipe; accent: ClickRecipe }>> = {
  classic: {
    offbeat: {
      lengthSec: 0.045,
      layers: [
        { kind: 'tick', a: 0.5, lengthSec: 0.012 },
        { kind: 'band', f1: 1800, f2: 3200, a: 1, attackSec: 0.0005, tauSec: 0.006, seed: WOOD_SEED },
        { kind: 'partial', hz: 1180, a: 0.45, attackSec: 0.0005, tauSec: 0.008 },
        { kind: 'partial', hz: 3050, a: 0.2, attackSec: 0.0005, tauSec: 0.004 },
      ],
    },
    accent: {
      lengthSec: 0.06,
      layers: [
        { kind: 'tick', a: 0.55, lengthSec: 0.014 },
        { kind: 'band', f1: 2200, f2: 3800, a: 1, attackSec: 0.0005, tauSec: 0.006, seed: WOOD_SEED },
        { kind: 'partial', hz: 1575, a: 0.5, attackSec: 0.0005, tauSec: 0.009 },
        { kind: 'partial', hz: 4065, a: 0.22, attackSec: 0.0005, tauSec: 0.004 },
        { kind: 'partial', hz: 2362, a: 0.22, attackSec: 0.001, tauSec: 0.018 },
      ],
    },
  },
  woodblock: {
    offbeat: {
      lengthSec: 0.055,
      layers: [
        { kind: 'tick', a: 0.35, lengthSec: 0.01 },
        { kind: 'partial', hz: 1250, a: 1, attackSec: 0.001, tauSec: 0.014, halfCosine: true },
        { kind: 'partial', hz: 3150, a: 0.32, attackSec: 0.001, tauSec: 0.006, halfCosine: true },
        { kind: 'partial', hz: 5800, a: 0.15, attackSec: 0.001, tauSec: 0.0025, halfCosine: true },
      ],
    },
    accent: {
      lengthSec: 0.06,
      layers: [
        { kind: 'tick', a: 0.4, lengthSec: 0.012 },
        { kind: 'partial', hz: 1670, a: 1, attackSec: 0.001, tauSec: 0.014, halfCosine: true },
        { kind: 'partial', hz: 4205, a: 0.32, attackSec: 0.001, tauSec: 0.006, halfCosine: true },
        { kind: 'partial', hz: 7740, a: 0.15, attackSec: 0.001, tauSec: 0.0025, halfCosine: true },
      ],
    },
  },
  beep: {
    offbeat: {
      lengthSec: 0.03,
      layers: [
        { kind: 'tick', a: 0.3, lengthSec: 0.008 },
        { kind: 'tone', hz: 2000, a: 0.8, rampSec: 0.002, lengthSec: 0.03 },
      ],
    },
    accent: {
      lengthSec: 0.03,
      layers: [
        { kind: 'tick', a: 0.3, lengthSec: 0.008 },
        { kind: 'tone', hz: 3000, a: 0.8, rampSec: 0.002, lengthSec: 0.03 },
      ],
    },
  },
};

/** Legacy names: stored `tick` reads as Classic and `wood` as Woodblock (06 section 9.5, 08 decision 4). */
export function metronomeSoundOf(t: ClickTimbre | string | null | undefined): MetronomeSound {
  if (t === 'woodblock' || t === 'wood') return 'woodblock';
  if (t === 'beep') return 'beep';
  return DEFAULT_METRONOME_SOUND;
}

const isLegacy = (t: ClickTimbre): t is 'tick' | 'wood' => t === 'tick' || t === 'wood';

/** The recipe a click uses. `accent` false is the offbeat recipe (also every beat with "Accent the first beat" off). */
export function clickRecipe(sound: MetronomeSound, accent: boolean): ClickRecipe {
  const r = CLICK_RECIPES[sound];
  return accent ? r.accent : r.offbeat;
}

/** Length of a rendered click, seconds. */
export function clickLengthSec(timbre: ClickTimbre, accent: boolean): number {
  if (timbre === 'tick') return accent ? 0.018 : 0.012;
  if (timbre === 'wood') return 0.008;
  return clickRecipe(timbre, accent).lengthSec;
}

/**
 * The designed envelope of a click's energy above 5 kHz, where calibration and the count-in recheck find arrivals
 * (`HiBandEnergy`; src/calibration/arrivals.ts fits it): a linear attack, then exp(-5 t / length), cut at length.
 * For the new sounds this is layer T, which carries their energy above 5 kHz. Wood has no hi band; its shape is its
 * own burst (it is found in the low band).
 */
export function clickArrivalShape(timbre: ClickTimbre, accent: boolean): { attackSec: number; lengthSec: number } {
  if (timbre === 'tick') return { attackSec: TICK_ATTACK_SEC, lengthSec: accent ? 0.018 : 0.012 };
  if (timbre === 'wood') return { attackSec: 0.001, lengthSec: 0.008 };
  const t = clickRecipe(timbre, accent).layers.find((l) => l.kind === 'tick');
  return { attackSec: TICK_ATTACK_SEC, lengthSec: t && t.kind === 'tick' ? t.lengthSec : 0.012 };
}

/** Whether arrivals of a timbre are found in the hi band (every sound with the Tick layer) or the low band (Wood). */
export const clickFoundInHiBand = (timbre: ClickTimbre): boolean => timbre !== 'wood';

/** Unscaled click, peak-normalised to 1, at `sampleRate`. `tick` and `wood` are bit-identical to the pre-redesign render. */
export function renderClick(timbre: ClickTimbre, accent: boolean, sampleRate: number): Float32Array {
  if (isLegacy(timbre)) return renderLegacy(timbre, accent, sampleRate);
  return renderRecipe(clickRecipe(timbre, accent), sampleRate);
}

/** The pre-redesign Tick and Wood bursts, unchanged (do not edit: the testkit and dsp tests depend on these samples). */
function renderLegacy(timbre: 'tick' | 'wood', accent: boolean, sampleRate: number): Float32Array {
  const band: [number, number] = timbre === 'tick' ? [5500, 9000] : [1500, 4000];
  const lenSec = timbre === 'tick' ? (accent ? 0.018 : 0.012) : 0.008;
  const attackSec = timbre === 'tick' ? 0.002 : 0.001;
  const n = Math.max(1, Math.round(lenSec * sampleRate));
  const rng = createRng(timbre === 'tick' ? TICK_SEED : WOOD_SEED);
  const nyquistGuard = NYQUIST_GUARD * sampleRate;
  const partials: { w: number; ph: number }[] = [];
  for (let k = 0; k < 40; k++) {
    const f = band[0] + rng.next() * (band[1] - band[0]);
    const ph = rng.next() * 2 * Math.PI;
    // Low capture rates (16 kHz HFP routes) cannot carry the top of the Tick band; drop what would alias.
    if (f < nyquistGuard) partials.push({ w: (2 * Math.PI * f) / sampleRate, ph });
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

/** 40 seeded random-phase partials uniform in [f1, f2] (the Tick method), those at or above the guard dropped. */
function bandPartials(f1: number, f2: number, seed: number, sampleRate: number): { w: number; ph: number }[] {
  const rng = createRng(seed);
  const out: { w: number; ph: number }[] = [];
  for (let k = 0; k < 40; k++) {
    const f = f1 + rng.next() * (f2 - f1);
    const ph = rng.next() * 2 * Math.PI;
    if (f < NYQUIST_GUARD * sampleRate) out.push({ w: (2 * Math.PI * f) / sampleRate, ph });
  }
  return out;
}

/** One layer's samples before its own normalisation, or null when the layer cannot be carried at this rate. */
function renderLayer(l: ClickLayer, n: number, sampleRate: number): Float64Array | null {
  const out = new Float64Array(n);
  if (l.kind === 'tick' || l.kind === 'band') {
    const ps = l.kind === 'tick' ? bandPartials(5500, 9000, TICK_SEED, sampleRate) : bandPartials(l.f1, l.f2, l.seed, sampleRate);
    if (ps.length === 0) return null;
    const att = l.kind === 'tick' ? TICK_ATTACK_SEC : l.attackSec;
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate;
      const env = Math.min(1, t / att) * (l.kind === 'tick' ? Math.exp((-5 * t) / l.lengthSec) : Math.exp(-t / l.tauSec));
      let s = 0;
      for (const p of ps) s += Math.sin(p.w * i + p.ph);
      out[i] = s * env;
    }
    return out;
  }
  if (l.hz >= NYQUIST_GUARD * sampleRate) return null;
  const w = (2 * Math.PI * l.hz) / sampleRate;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    let env: number;
    if (l.kind === 'tone') {
      if (t > l.lengthSec) env = 0;
      else if (t < l.rampSec) env = 0.5 - 0.5 * Math.cos((Math.PI * t) / l.rampSec);
      else if (t > l.lengthSec - l.rampSec) env = 0.5 - 0.5 * Math.cos((Math.PI * (l.lengthSec - t)) / l.rampSec);
      else env = 1;
    } else {
      const a = l.halfCosine ? (t < l.attackSec ? 0.5 - 0.5 * Math.cos((Math.PI * t) / l.attackSec) : 1) : Math.min(1, t / l.attackSec);
      env = a * Math.exp(-t / l.tauSec);
    }
    out[i] = Math.sin(w * i) * env;
  }
  return out;
}

/** Renders a recipe: layers normalised to their own peak and weighted, a 3 ms end fade, then peak-normalised to 1. */
export function renderRecipe(r: ClickRecipe, sampleRate: number): Float32Array {
  const n = Math.max(1, Math.round(r.lengthSec * sampleRate));
  const sum = new Float64Array(n);
  for (const l of r.layers) {
    const x = renderLayer(l, n, sampleRate);
    if (!x) continue;
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(x[i] as number));
    if (peak <= 0) continue;
    const g = l.a / peak;
    for (let i = 0; i < n; i++) sum[i] = (sum[i] as number) + (x[i] as number) * g;
  }
  const fade = Math.min(n, Math.round(CLICK_FADE_SEC * sampleRate));
  for (let i = 0; i < fade; i++) sum[n - 1 - i] = (sum[n - 1 - i] as number) * (0.5 - 0.5 * Math.cos((Math.PI * i) / fade));
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(sum[i] as number));
  const out = new Float32Array(n);
  if (peak > 0) for (let i = 0; i < n; i++) out[i] = (sum[i] as number) / peak;
  return out;
}
