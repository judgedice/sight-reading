// Pure geometry and colour tables for the overlay (04 sections 6.1, 6.2, 6.4). No DOM.

import type { Alter, Clef, Meter, PreparedExcerpt, SpelledPitch, Ticks } from '../../core/types.ts';
import { tickToBeat } from '../layout.ts';
import { keyAlterations, ledgerLineCount, stepsBelowTopLine } from '../pitch-geometry.ts';
import type { LaneGlyphId } from '../visual-states.ts';

/** Verdict lane height and the gap under it (04 section 4.2; mirrors the 'score' token group). */
export const LANE_PX = 20;
export const SYSTEM_GAP_PX = 12;
export const GLYPH_SIZE = { live: 9, review: 12, highContrast: 14 } as const;
export const GHOST_STROKE = { live: 1.5, highContrast: 2.25 } as const;
export const GHOST_FILL = { live: 0.15, review: 0.2, highContrast: 0.3 } as const;
export const REPLAY_DASH = '3 2';
export const PAST_OPACITY = { oneBeatPast: 0.6, systemLeft: 0.4 } as const;
export const SHARP_FLAT_OFFSET = 1.1;
export const COLLISION_OFFSET = { preferred: 0.8, minimum: 0.5 } as const;
export const RING = { active: 1.5, rejudgedDashed: 2 } as const;
export const NEXT_BAR_MARKER_FROM = 0.75;
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
