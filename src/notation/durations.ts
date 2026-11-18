// Tick durations to VexFlow duration strings (01 §5.1: TPQ = 480). Pure; no VexFlow import.

import { TPQ } from '../core/types.ts';

/** One drawable duration: VexFlow base code plus dot count, and its written length in ticks. */
export interface DurationPiece {
  /** VexFlow duration code without dots or rest suffix: '1/2' (breve), 'w', 'h', 'q', '8', '16', '32', '64'. */
  code: string;
  dots: 0 | 1 | 2;
  ticks: number;
}

const BASES: readonly { code: string; ticks: number }[] = [
  { code: '1/2', ticks: TPQ * 8 },
  { code: 'w', ticks: TPQ * 4 },
  { code: 'h', ticks: TPQ * 2 },
  { code: 'q', ticks: TPQ },
  { code: '8', ticks: TPQ / 2 },
  { code: '16', ticks: TPQ / 4 },
  { code: '32', ticks: TPQ / 8 },
  { code: '64', ticks: TPQ / 16 },
];

/** Every single-glyph written duration, longest first. */
const SINGLE: readonly DurationPiece[] = BASES.flatMap((b) => [
  { code: b.code, dots: 2 as const, ticks: b.ticks * 1.75 },
  { code: b.code, dots: 1 as const, ticks: b.ticks * 1.5 },
  { code: b.code, dots: 0 as const, ticks: b.ticks },
])
  .filter((p) => Number.isInteger(p.ticks))
  .sort((a, b) => b.ticks - a.ticks || a.dots - b.dots);

const SMALLEST = TPQ / 16;

/** The single glyph for exactly `ticks`, or null when it needs a tie (or is not on the 64th grid). */
export function singleDuration(ticks: number): DurationPiece | null {
  // Prefer fewer dots for the same length (a dotted half over a double-dotted something is impossible to tie anyway).
  let best: DurationPiece | null = null;
  for (const p of SINGLE) if (p.ticks === ticks && (best === null || p.dots < best.dots)) best = p;
  return best;
}

/**
 * Split a written length into drawable pieces, longest first, so that every piece is a single glyph and the pieces
 * sum to `ticks`. Notes are tied between pieces; rests are simply repeated. Lengths off the 64th-note grid are
 * rounded to it (the corpus is on a 32nd grid; tuplets are passed in written, not sounding, ticks).
 */
export function splitDuration(ticks: number): DurationPiece[] {
  if (!(ticks > 0)) throw new RangeError(`duration must be positive, got ${ticks}`);
  let rest = Math.max(SMALLEST, Math.round(ticks / SMALLEST) * SMALLEST);
  const exact = singleDuration(rest);
  if (exact) return [exact];
  const out: DurationPiece[] = [];
  while (rest > 0) {
    // Largest undotted-or-dotted glyph that fits; single dots only inside a split, which reads better than double dots.
    const p = SINGLE.find((x) => x.ticks <= rest && x.dots < 2);
    if (!p) throw new RangeError(`cannot split ${ticks} ticks`);
    out.push(p);
    rest -= p.ticks;
  }
  return out;
}

/** VexFlow duration string for a piece ('qd', '8dd', 'hr' for a rest). */
export function vexDuration(p: DurationPiece, rest: boolean): string {
  return `${p.code}${'d'.repeat(p.dots)}${rest ? 'r' : ''}`;
}

/** Written ticks of an event: tuplets scale the sounding duration back to the notated value. */
export function writtenTicks(dur: number, tuplet?: { actual: number; normal: number }): number {
  return tuplet ? (dur * tuplet.actual) / tuplet.normal : dur;
}

/** True when the written length is beamable (shorter than a quarter). */
export function isBeamable(p: DurationPiece): boolean {
  return p.code === '8' || p.code === '16' || p.code === '32' || p.code === '64';
}
