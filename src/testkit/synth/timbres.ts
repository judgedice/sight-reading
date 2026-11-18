/**
 * The nine testkit timbres (01 section 13.2, PLAN R21): flute, B-flat clarinet, alto sax, B-flat trumpet, violin,
 * cello, voice, piano (single line) and tuba (the beta low timbre).
 *
 * Each timbre is a parametric additive model: a source slope over the harmonic number, optional odd/even shaping
 * (clarinet), fixed spectral resonances in Hz (body, bore and vowel formants, so the spectrum changes with pitch
 * the way a real instrument's does), brightness that grows through the attack (brass), an articulation model
 * (tongue, bow change, glottal re-onset, glide), default vibrato and AM, breath and attack noise, and for the piano
 * inharmonic partials with per-partial decay and a damper.
 *
 * The values are plausible acoustic approximations chosen for detector testing, not measurements of instruments.
 * What matters for the gates is that the families differ the way the real ones do: strong or weak fundamentals,
 * missing even harmonics, formants that move the strongest partial away from f0, soft and hard attacks, vibrato
 * and amplitude modulation, and a struck decaying tone.
 */
import type { TestkitTimbre } from '../../core/types.ts';

export interface Resonance {
  hz: number;
  /** Gain at the centre, dB (negative for an anti-resonance). */
  gainDb: number;
  /** Gaussian width in octaves (1 sigma). */
  widthOct: number;
}

export interface VibratoSpec {
  hz: number;
  /** Peak deviation, cents (the "±30 c" of 01 section 13.2). */
  cents: number;
  /** Peak-to-peak amplitude modulation that goes with it, dB. */
  amDb: number;
  /** Depth ramps in over this time from the start of a voice. */
  delaySec: number;
}

export interface NoiseSpec {
  /** RMS relative to the tone's RMS, dB. */
  db: number;
  loHz: number;
  hiHz: number;
}

export interface AttackNoiseSpec extends NoiseSpec {
  /** Burst length; the burst has a raised-cosine envelope over this time from the attack start. */
  sec: number;
}

export interface StruckSpec {
  /** Inharmonicity coefficient B at C4; scaled by (f0 / 261.6)^0.5. */
  inharmonicityB: number;
  /** T60 of the fundamental at C4, seconds; scaled by (261.6 / f0)^0.6. */
  t60AtC4Sec: number;
  /** Partial k decays (1 + highDecay * (k - 1)) times faster than the fundamental. */
  highDecay: number;
  /** Damper: time for 60 dB of decay after the key is released. */
  dampSec: number;
}

export interface TimbreDef {
  id: TestkitTimbre;
  kind: 'sustained' | 'struck';
  /** Source slope, dB per octave of harmonic number. */
  slopeDbPerOct: number;
  /** Even harmonics below `evenCutHz` are attenuated by this many dB (cylindrical bore). */
  evenAttenDb: number;
  evenCutHz: number;
  resonances: readonly Resonance[];
  /** Harmonic k rises as r^(1 + attackBrightness * (k - 1)) through the attack, r = attack progress 0..1. */
  attackBrightness: number;
  attackSec: number;
  decaySec: number;
  /** Sustain level after the attack overshoot, linear. */
  sustain: number;
  releaseSec: number;
  /** The "soft attack" realism condition (30 to 80 ms rise) applies to this timbre (voice and bowed). */
  softAttack: boolean;
  /** Re-articulation inside a breath or bow: dip depth and shape (tongue stop, bow change, glottal re-onset). */
  rearticulation: { dipDb: number; fallSec: number; riseSec: number };
  /** Slur glide, seconds (smoothstep, centred on the onset). */
  glideSec: number;
  /** Default vibrato, or null. */
  vibrato: VibratoSpec | null;
  breath: NoiseSpec | null;
  attackNoise: AttackNoiseSpec | null;
  struck: StruckSpec | null;
}

/** Harmonics above this frequency are never rendered, so a timbre sounds the same at every rate from 16 kHz up. */
export const MAX_PARTIAL_HZ = 7000;
/** The analysis low band (01 section 7.2): the envelope and the truth use partials below it. */
export const LOW_BAND_HZ = 3000;
/** Upper bound on partials per voice (render cost). */
export const MAX_PARTIALS = 40;

export const TIMBRES: Readonly<Record<TestkitTimbre, TimbreDef>> = {
  flute: {
    id: 'flute',
    kind: 'sustained',
    slopeDbPerOct: -11,
    evenAttenDb: 0,
    evenCutHz: 0,
    resonances: [{ hz: 2200, gainDb: -4, widthOct: 0.8 }],
    attackBrightness: 0.3,
    attackSec: 0.035,
    decaySec: 0.05,
    sustain: 0.88,
    releaseSec: 0.05,
    softAttack: false,
    rearticulation: { dipDb: 16, fallSec: 0.012, riseSec: 0.018 },
    glideSec: 0.018,
    vibrato: null,
    breath: { db: -26, loHz: 1500, hiHz: 7000 },
    attackNoise: { db: -18, sec: 0.025, loHz: 2000, hiHz: 6000 },
    struck: null,
  },
  clarinet: {
    id: 'clarinet',
    kind: 'sustained',
    slopeDbPerOct: -4,
    evenAttenDb: -22,
    evenCutHz: 1800,
    resonances: [
      { hz: 1500, gainDb: 3, widthOct: 0.6 },
      { hz: 4000, gainDb: -8, widthOct: 0.7 },
    ],
    attackBrightness: 0.4,
    attackSec: 0.025,
    decaySec: 0.04,
    sustain: 0.9,
    releaseSec: 0.04,
    softAttack: false,
    rearticulation: { dipDb: 18, fallSec: 0.01, riseSec: 0.016 },
    glideSec: 0.015,
    vibrato: null,
    breath: { db: -34, loHz: 1000, hiHz: 6000 },
    attackNoise: { db: -26, sec: 0.015, loHz: 1000, hiHz: 4000 },
    struck: null,
  },
  sax: {
    id: 'sax',
    kind: 'sustained',
    slopeDbPerOct: -3,
    evenAttenDb: 0,
    evenCutHz: 0,
    resonances: [
      { hz: 500, gainDb: 8, widthOct: 0.6 },
      { hz: 1500, gainDb: 4, widthOct: 0.5 },
      { hz: 3500, gainDb: -6, widthOct: 0.6 },
    ],
    attackBrightness: 0.5,
    attackSec: 0.025,
    decaySec: 0.05,
    sustain: 0.85,
    releaseSec: 0.04,
    softAttack: false,
    rearticulation: { dipDb: 16, fallSec: 0.01, riseSec: 0.016 },
    glideSec: 0.018,
    vibrato: null,
    breath: { db: -30, loHz: 1500, hiHz: 7000 },
    attackNoise: { db: -24, sec: 0.015, loHz: 1000, hiHz: 5000 },
    struck: null,
  },
  trumpet: {
    id: 'trumpet',
    kind: 'sustained',
    slopeDbPerOct: -2,
    evenAttenDb: 0,
    evenCutHz: 0,
    resonances: [
      { hz: 1200, gainDb: 10, widthOct: 0.9 },
      { hz: 2600, gainDb: 2, widthOct: 0.4 },
      { hz: 5000, gainDb: -10, widthOct: 0.6 },
    ],
    attackBrightness: 1.0,
    attackSec: 0.02,
    decaySec: 0.06,
    sustain: 0.8,
    releaseSec: 0.035,
    softAttack: false,
    rearticulation: { dipDb: 22, fallSec: 0.01, riseSec: 0.014 },
    glideSec: 0.015,
    vibrato: null,
    breath: null,
    attackNoise: { db: -28, sec: 0.012, loHz: 800, hiHz: 4000 },
    struck: null,
  },
  violin: {
    id: 'violin',
    kind: 'sustained',
    slopeDbPerOct: -5,
    evenAttenDb: 0,
    evenCutHz: 0,
    resonances: [
      { hz: 280, gainDb: 6, widthOct: 0.25 },
      { hz: 460, gainDb: 4, widthOct: 0.3 },
      { hz: 2800, gainDb: 8, widthOct: 0.45 },
      { hz: 5500, gainDb: -8, widthOct: 0.5 },
    ],
    attackBrightness: 0.3,
    attackSec: 0.045,
    decaySec: 0.08,
    sustain: 0.92,
    releaseSec: 0.06,
    softAttack: true,
    rearticulation: { dipDb: 9, fallSec: 0.02, riseSec: 0.028 },
    glideSec: 0.03,
    vibrato: { hz: 5.5, cents: 20, amDb: 2, delaySec: 0.15 },
    breath: null,
    attackNoise: { db: -22, sec: 0.03, loHz: 1000, hiHz: 5000 },
    struck: null,
  },
  cello: {
    id: 'cello',
    kind: 'sustained',
    slopeDbPerOct: -5,
    evenAttenDb: 0,
    evenCutHz: 0,
    resonances: [
      { hz: 200, gainDb: 6, widthOct: 0.35 },
      { hz: 420, gainDb: 3, widthOct: 0.3 },
      { hz: 1200, gainDb: 2, widthOct: 0.4 },
      { hz: 2500, gainDb: 4, widthOct: 0.4 },
    ],
    attackBrightness: 0.3,
    attackSec: 0.055,
    decaySec: 0.08,
    sustain: 0.92,
    releaseSec: 0.07,
    softAttack: true,
    rearticulation: { dipDb: 9, fallSec: 0.02, riseSec: 0.03 },
    glideSec: 0.035,
    vibrato: { hz: 5.2, cents: 20, amDb: 2, delaySec: 0.15 },
    breath: null,
    attackNoise: { db: -22, sec: 0.035, loHz: 600, hiHz: 4000 },
    struck: null,
  },
  voice: {
    id: 'voice',
    kind: 'sustained',
    slopeDbPerOct: -8,
    evenAttenDb: 0,
    evenCutHz: 0,
    // Vowel "ah": F1, F2, F3 and the singer's formant.
    resonances: [
      { hz: 750, gainDb: 22, widthOct: 0.3 },
      { hz: 1200, gainDb: 16, widthOct: 0.2 },
      { hz: 2600, gainDb: 10, widthOct: 0.18 },
      { hz: 3100, gainDb: 10, widthOct: 0.15 },
    ],
    attackBrightness: 0.2,
    attackSec: 0.05,
    decaySec: 0.08,
    sustain: 0.95,
    releaseSec: 0.07,
    softAttack: true,
    rearticulation: { dipDb: 8, fallSec: 0.025, riseSec: 0.035 },
    glideSec: 0.06,
    vibrato: { hz: 5.5, cents: 25, amDb: 3, delaySec: 0.2 },
    breath: { db: -32, loHz: 1000, hiHz: 6000 },
    attackNoise: null,
    struck: null,
  },
  piano: {
    id: 'piano',
    kind: 'struck',
    slopeDbPerOct: -6,
    evenAttenDb: 0,
    evenCutHz: 0,
    resonances: [{ hz: 4000, gainDb: -6, widthOct: 0.8 }],
    attackBrightness: 0,
    attackSec: 0.003,
    decaySec: 0,
    sustain: 1,
    releaseSec: 0.08,
    softAttack: false,
    rearticulation: { dipDb: 0, fallSec: 0, riseSec: 0 },
    glideSec: 0,
    vibrato: null,
    breath: null,
    attackNoise: { db: -16, sec: 0.012, loHz: 300, hiHz: 3000 },
    struck: { inharmonicityB: 0.0004, t60AtC4Sec: 3.5, highDecay: 0.25, dampSec: 0.08 },
  },
  tuba: {
    id: 'tuba',
    kind: 'sustained',
    slopeDbPerOct: -6,
    evenAttenDb: 0,
    evenCutHz: 0,
    resonances: [
      { hz: 300, gainDb: 8, widthOct: 0.6 },
      { hz: 1500, gainDb: -6, widthOct: 0.6 },
    ],
    attackBrightness: 0.6,
    attackSec: 0.045,
    decaySec: 0.08,
    sustain: 0.85,
    releaseSec: 0.06,
    softAttack: false,
    rearticulation: { dipDb: 16, fallSec: 0.018, riseSec: 0.022 },
    glideSec: 0.03,
    vibrato: null,
    breath: { db: -36, loHz: 500, hiHz: 4000 },
    attackNoise: { db: -28, sec: 0.02, loHz: 300, hiHz: 2000 },
    struck: null,
  },
};

export const TIMBRE_IDS: readonly TestkitTimbre[] = ['flute', 'clarinet', 'sax', 'trumpet', 'violin', 'cello', 'voice', 'piano', 'tuba'];

const resonanceDb = (t: TimbreDef, hz: number): number => {
  let db = 0;
  for (const r of t.resonances) {
    const d = Math.log2(hz / r.hz) / r.widthOct;
    db += r.gainDb * Math.exp(-0.5 * d * d);
  }
  return db;
};

/**
 * Harmonic amplitudes for fundamental `f0`, normalised so that the sum of squares is 2 (a full-level tone has RMS
 * 1 before the level gain). Partial k is at k * f0 (the piano's stretch is applied by the renderer). Partials at or
 * above MAX_PARTIAL_HZ are zero.
 */
export function harmonicAmps(t: TimbreDef, f0: number): Float64Array {
  const n = Math.max(1, Math.min(MAX_PARTIALS, Math.floor((MAX_PARTIAL_HZ - 1e-9) / f0)));
  const a = new Float64Array(n);
  let ss = 0;
  for (let k = 1; k <= n; k++) {
    const hz = k * f0;
    let db = t.slopeDbPerOct * Math.log2(k) + resonanceDb(t, hz);
    if (t.evenAttenDb !== 0 && k % 2 === 0 && hz < t.evenCutHz) db += t.evenAttenDb;
    const v = 10 ** (db / 20);
    a[k - 1] = v;
    ss += v * v;
  }
  const g = Math.sqrt(2 / ss);
  for (let i = 0; i < n; i++) a[i] = (a[i] as number) * g;
  return a;
}

/** Fraction of a white-noise band's power that lies below LOW_BAND_HZ. */
export const lowBandFraction = (lo: number, hi: number): number =>
  hi <= lo ? 0 : Math.max(0, Math.min(1, (Math.min(hi, LOW_BAND_HZ) - lo) / (hi - lo)));
