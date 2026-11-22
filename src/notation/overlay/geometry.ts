// Pure geometry and colour tables for the overlay (04 sections 6.1, 6.2, 6.4). No DOM.

import type { Alter, Clef, Meter, PreparedExcerpt, SpelledPitch, Ticks } from '../../core/types.ts';
import { BRAVURA_METRICS, BRAVURA_METRICS_EM_PX } from '../bravura-metrics.ts';
import { tickToBeat } from '../layout.ts';
import { keyAlterations, ledgerLineCount, stepsBelowTopLine } from '../pitch-geometry.ts';
import type { LaneGlyphId } from '../visual-states.ts';

/** Verdict lane height and the gap under it (04 section 4.2; mirrors the 'score' token group). */
export const LANE_PX = 20;
export const SYSTEM_GAP_PX = 12;
/**
 * Mirrors of design/tokens.json group `score` (06 section 7). notation/ may not import ui/, so the values are spelled
 * here and svg-overlay.test.ts checks them against tokens.ts.
 */
/** Lane glyph size in staff spaces; the lane sits LANE_OFFSET_SP under the bottom staff line. */
export const LANE_GLYPH_SP = { live: 1.25, review: 1.25, highContrast: 1.5 } as const;
export const LANE_OFFSET_SP = 2.2;
/** Radius of the live correct dot, staff spaces. */
export const CORRECT_DOT_SP = 0.2;
/**
 * The right-note halo (PLAN R72): padding around the head, the ring's stroke and the dark edge outside it, staff
 * spaces; the fill's opacity. Colours `--glow` and `--glow-edge`.
 */
export const GLOW = { padSp: 0.42, ringSp: 0.22, edgeSp: 0.08, fillOpacity: 0.45 } as const;
export const GHOST_STROKE = { live: 1.5, highContrast: 2.25 } as const;
export const GHOST_FILL = { live: 0.4, review: 0.55, highContrast: 0.55 } as const;
export const REPLAY_DASH = '3 2';
/** Every slip mark of a system drops to this once the playhead has left it; ink never fades (06 D6). */
export const PAST_OPACITY = { systemLeft: 0.7 } as const;
export const SHARP_FLAT_OFFSET = 1.1;
/** A sharp (flat) heard note on the written letter sits this many staff spaces above (below) it (PLAN R71). */
export const SHARP_FLAT_RISE_SP = 0.25;
/** A wrong-pitch ghost within one staff step of its written note sits this many notehead widths right. */
export const WRONG_NEAR_OFFSET = 0.85;
export const COLLISION_OFFSET = { preferred: 0.8, minimum: 0.5 } as const;
export const RING = { active: 1.5, rejudgedDashed: 2 } as const;
/** Ring around a missed note: rx in notehead widths, ry in staff spaces, stroke px. */
export const MISSED_RING = { rxHeads: 0.95, rySp: 0.95, stroke: 1.5 } as const;
/** Ghost pitch arrow: length and gap from the ghost centre, staff spaces. */
export const PITCH_ARROW = { lengthSp: 1.6, gapSp: 1.0 } as const;
/** Playhead wash: from this many staff spaces above the staff, inset this many staff spaces; radius 0.5 sp. */
export const PLAYHEAD_PAD_SP = [1.8, 0.15] as const;
export const PLAYHEAD_RADIUS_SP = 0.5;
/** Cue-size ghost with an accidental (06 section 7): 75%, accidental 0.2 sp right of the written head, head 0.95 sp on. */
export const CUE_SCALE = 0.75;
export const CUE_ACCIDENTAL_GAP_SP = 0.2;
export const CUE_HEAD_GAP_SP = 0.95;
/** Smallest clear space between a ghost accidental and the head it belongs to, staff spaces. */
export const ACCIDENTAL_HEAD_GAP_SP = 0.15;
/** Review ghost stem opacity. */
export const REVIEW_STEM_OPACITY = 0.75;
/** Bravura noteheadBlack width in staff spaces. */
export const HEAD_W_SP = 1.18;
/** Most ledger lines a ghost draws before it is clamped and labelled 8va / 8vb. */
export const MAX_GHOST_LEDGERS = 4;
/** The sprite's `ghost-head` path (24-unit viewBox) is this Bravura path in 295 x 250 font units. */
export const HEAD_PATH =
  'M97 -125Q168 -123 229 -73Q291 -24 295 42Q294 81 268 103Q241 125 198 125Q113 123 58 74Q2 25 0 -42Q1 -81 28 -103Q56 -125 97 -125Z';
export const HEAD_UNITS_W = 295;

/** CSS colour (a custom property from tokens.css) of each lane glyph. */
export const GLYPH_COLOUR: Record<LaneGlyphId | 'plus-n', string> = {
  dot: 'var(--correct)',
  check: 'var(--correct)',
  'check-marginal': 'var(--text-muted)',
  early: 'var(--error)',
  late: 'var(--error)',
  sharp: 'var(--error)',
  flat: 'var(--error)',
  wrong: 'var(--error)',
  missed: 'var(--error)',
  octave: 'var(--error)',
  extra: 'var(--ghost)',
  replay: 'var(--ghost-replay)',
  'plus-n': 'var(--ghost)',
};

/** Bravura accidental advance width and extents above / below the baseline, staff spaces (1 em = 4 sp). */
export function accidentalSp(alter: Alter): { w: number; up: number; down: number } {
  const cp = SMUFL_ACCIDENTAL[alter].codePointAt(0)!.toString(16);
  const m = BRAVURA_METRICS[cp] ?? [250, 0, 250, 360, 360];
  const k = 4 / BRAVURA_METRICS_EM_PX;
  return { w: m[0] * k, up: m[3] * k, down: m[4] * k };
}

/** SMuFL codepoints for ghost accidentals, by alter. */
export const SMUFL_ACCIDENTAL: Record<Alter, string> = {
  [-2]: '',
  [-1]: '',
  [0]: '',
  [1]: '',
  [2]: '',
} as Record<Alter, string>;

/** Start beat of every measure and the bar it displays, in excerpt order. */
export interface BarTable {
  bars: number[];
  startBeat: number[];
  endBeat: number[];
}

export function barTable(p: PreparedExcerpt): BarTable {
  const bars: number[] = [];
  const startBeat: number[] = [];
  const endBeat: number[] = [];
  const meter: Meter = p.meter;
  p.measures.forEach((m) => {
    bars.push(m.displayBar);
    startBeat.push(tickToBeat(m.startTick as Ticks, meter, p.pickupTicks));
  });
  for (let i = 0; i < startBeat.length; i++) {
    endBeat.push(i + 1 < startBeat.length ? startBeat[i + 1]! : startBeat[i]! + meter.countsPerBar);
  }
  return { bars, startBeat, endBeat };
}

/** Index into the table of the bar a beat falls in; clamps before the first and after the last bar. */
export function barIndexOfBeat(t: BarTable, beat: number): number {
  let lo = 0;
  let hi = t.startBeat.length - 1;
  if (hi < 0) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (t.startBeat[mid]! <= beat) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The accidental a ghost needs against the key signature, or null (courtesy naturals included). */
export function ghostAccidental(p: PreparedExcerpt, pitch: SpelledPitch): Alter | null {
  const keyAlter = keyAlterations(p.writtenKey)[pitch.step];
  return keyAlter === pitch.alter ? null : pitch.alter;
}

export interface LedgerPlan {
  /** Ledger line count actually drawn (clamped). */
  count: number;
  side: 'above' | 'below' | 'none';
  /** True when the pitch needed more than MAX_GHOST_LEDGERS and was clamped. */
  clamped: boolean;
}

export function ledgerPlan(pitch: SpelledPitch, clef: Clef): LedgerPlan {
  const n = ledgerLineCount(pitch, clef);
  if (n === 0) return { count: 0, side: 'none', clamped: false };
  const side = stepsBelowTopLine(pitch, clef) < 0 ? 'above' : 'below';
  return { count: Math.min(n, MAX_GHOST_LEDGERS), side, clamped: n > MAX_GHOST_LEDGERS };
}

/** y of the k-th ledger line (1-based) on a side. */
export function ledgerY(side: 'above' | 'below', k: number, staffTopY: number, sp: number): number {
  return side === 'above' ? staffTopY - k * sp : staffTopY + 4 * sp + k * sp;
}

/** Stem direction of a ghost (below the middle line = up). */
export function stemUp(pitch: SpelledPitch, clef: Clef): boolean {
  return stepsBelowTopLine(pitch, clef) > 4;
}
