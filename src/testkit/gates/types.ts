/** Shared types of the synthetic accuracy gates (P18, 01 section 13.2). Everything here is plain JSON. */
import type { TestkitTimbre } from '../../core/types.ts';
import type { GoldenCase } from '../scenarios/index.ts';

/**
 * Capture conditions a take is measured under.
 * - `clean`: dry capture at 48 kHz (no phone mic, room, AGC, noise or click bleed), headphones.
 * - `device`: the 13.2 gate condition, "under click bleed and the phone-mic condition": phone-mic EQ (100 or 150 Hz
 *   high-pass, 7 kHz low-pass), click bleed cycling Tick and Wood at -20 and -10 dB on speakers, a -50 or -45 dBFS
 *   noise floor; no room and no AGC.
 * - `planned`: each scenario's own drawn conditions (room RT60 0.2 to 0.8 s, phone mic, AGC, 24 and 16 kHz capture,
 *   noise, click bleed), the "planned room conditions" of PLAN ruling 45.
 */
export type ConditionId = 'clean' | 'device' | 'planned';
export const CONDITIONS: readonly ConditionId[] = ['clean', 'device', 'planned'];

/** The eight launch instruments (PLAN v1 scope), one testkit timbre each. Voice scenarios use every voice type. */
export const LAUNCH_TIMBRES: readonly TestkitTimbre[] = ['flute', 'clarinet', 'sax', 'trumpet', 'violin', 'cello', 'voice', 'piano'];
export const LAUNCH_NAMES: Readonly<Record<string, string>> = {
  flute: 'Flute',
  clarinet: 'B♭ clarinet',
  sax: 'Alto sax',
  trumpet: 'B♭ trumpet',
  violin: 'Violin',
  cello: 'Cello',
  voice: 'Voice',
  piano: 'Piano (single line)',
};

/** Patterns with an injected-error recipe (02 section 6.2; E30 is measured on the perfect takes). */
export const INJECTED_PATTERNS = ['E6', 'E12', 'E13', 'E22', 'E23', 'E1', 'E2', 'E28', 'E29', 'E9', 'E7', 'E8', 'E4', 'E18', 'E26', 'E16', 'E31'] as const;
export type InjectedPattern = (typeof INJECTED_PATTERNS)[number];

export type Job =
  /** Scenario `index` of the default 300-scenario set under a condition. */
  | { kind: 'scenario'; index: number; condition: ConditionId }
  /** Randomized render `r` of a golden displacement case (always click bleed and phone mic, as planned). */
  | { kind: 'golden'; case: GoldenCase; r: number }
  /** Perfect take `r` for the tip-precision suite (device condition). */
  | { kind: 'perfect'; r: number }
  /** Injected-error take `r` for one pattern (device condition). */
  | { kind: 'tip'; pattern: InjectedPattern; r: number };

/** One onset error sample: detected minus 7.4 truth onset, ms. */
export interface OnsetSample {
  rule: 'silence' | 'dip' | 'pitch-change';
  floorClass: 'articulated' | 'slurred' | 'voice';
  errMs: number;
}

export interface CentsSample {
  /** Detected steady median minus the truth pitch, cents. */
  errCents: number;
  steadyMs: number;
  vibrato: boolean;
}

/** Per-take measurements. Counts, never ratios, so takes aggregate by summing. */
export interface TakeRecord {
  job: Job;
  id: string;
  /** Testkit timbre (the launch-instrument group). */
  timbre: TestkitTimbre;
  instrumentId: string;
  family: string;
  windowSamples: number;
  condition: ConditionId;
  outputMode: string;
  /** Capture conditions actually applied (for the report). */
  roomRt60: number | null;
  bleed: string | null;
  /** Skipped (a recipe found no fitting excerpt): every count is zero. */
  skipped: string | null;
  onset: { tp: number; fp: number; fn: number; samples: OnsetSample[] };
  cents: CentsSample[];
  verdict: {
    /** Expected notes compared (ground truth away from every threshold). */
    n: number;
    agree: number;
    /** Notes within the measurement guard band of a threshold (compared, reported, not gated). */
    boundary: number;
    boundaryAgree: number;
    /** Up to 5 disagreements, for the report. */
    examples: string[];
  };
  truthMatched: number;
  falseMissed: number;
  falseExtras: number;
  clickExtras: number;
  judgments: number;
  rejudged: number;
  pitchClassN: number;
  pitchClassOk: number;
  octaveErrors: number;
  /** In-tune notes eligible for a live sharp/flat mark, and how many turned red (PLAN ruling 19). */
  falseRed: { eligible: number; live: number; final: number; liveWrong: number };
  /** Sound to first live judgment, ms (input latency excluded). */
  judgmentLatencyMs: number[];
  /** Sound to live sharp/flat mark on notes with an injected intonation error, ms. */
  intonationLatencyMs: number[];
  /** Ghost spelling of wrong notes (PLAN ruling 50): ±1 semitone keeps the letter, beyond it the played pitch's own. */
  ghostSpelling: { n: number; ok: number; examples: string[] };
  patterns: string[];
  displaced: { fromIdx: number; toIdx: number; offsetBeats: number }[];
  expectedDisplaced: { fromIdx: number; toIdx: number; offsetBeats: number }[];
  lostPlace: number;
  score: number | null;
  grade: string | null;
  hopP95Ms: number | null;
}
