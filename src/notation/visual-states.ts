// Feedback look as data (04 section 6.1, 6.4; drawing per 06 section 7). Pure functions; no DOM.
// The overlay layer reads these and draws; nothing here knows about VexFlow.

import type { GhostNote, LiveJudgment, NoteJudgment, NoteVisualState, OverlayMode } from '../core/types.ts';

/**
 * Glyph ids this module emits. They are a subset of `GlyphId` in ui/glyph-ids.ts; the lint boundaries forbid
 * notation importing ui, so the subset is spelled here and visual-states.test.ts checks it against the sprite.
 */
export type LaneGlyphId =
  | 'dot' | 'check' | 'check-marginal' | 'early' | 'late' | 'sharp' | 'flat' | 'wrong' | 'missed' | 'octave' | 'extra' | 'replay';
type GlyphId = LaneGlyphId;

export type { OverlayMode };

export interface NoteVisual {
  noteClass: 'n-ink' | 'n-correct' | 'n-error' | 'n-error-hollow';
  ring: 'none' | 'active' | 'rejudged';
  /** 0 to 2 verdict-lane glyphs, top first (timing above pitch). */
  laneGlyphs: GlyphId[];
  /** Colour change duration, ms. Reduced motion zeroes it at the drawing layer. */
  fadeMs: number;
}

export interface GhostVisual {
  style: 'ghost' | 'ghost-replay';
  arrow: 'up' | 'down' | null;
  offsetRight: boolean;
  stem: boolean;
  dashedLedgers: true;
  /** Group opacity, 0..1 (fill and stroke ratios are tokens). */
  opacity: number;
  fadeMs: number;
  laneGlyph: GlyphId | null;
}

/** Token mirrors (design/tokens.json group `ui` and `score`). */
export const NOTE_COLOUR_FADE_MS = 100;
export const REJUDGE_CROSSFADE_MS = 200;
export const GHOST_FADE_MS = 80;
export const BRAKE_ERRORS_PER_BAR = 4;
export const UNMATCHED_GHOST_CAP_PER_BAR = 3;
export const BRAKED_GHOST_OPACITY = 0.7;

type TimingError = 'early' | 'late';
type PitchError = 'sharp' | 'flat' | 'wrong-pitch' | 'octave';

function timingError(s: NoteVisualState): TimingError | null {
  return s.timing === 'early' || s.timing === 'late' ? s.timing : null;
}

function pitchError(s: NoteVisualState): PitchError | null {
  const p = s.pitch;
  return p === 'sharp' || p === 'flat' || p === 'wrong-pitch' || p === 'octave' ? p : null;
}

/** "Error" per 6.1: missed, or judged (or sounding with a verdict) with a timing or pitch error. */
export function isErrorState(s: NoteVisualState): boolean {
  if (s.phase === 'missed') return true;
  if (s.phase === 'pending') return false;
  return timingError(s) !== null || pitchError(s) !== null;
}

const PITCH_GLYPH: Record<PitchError, GlyphId> = { sharp: 'sharp', flat: 'flat', 'wrong-pitch': 'wrong', octave: 'octave' };

/** Brake (6.4 rule 9): a bar with more than 4 error states. */
export function isBrakedBar(errorCountInBar: number): boolean {
  return errorCountInBar > BRAKE_ERRORS_PER_BAR;
}

/** Cap (6.4 rule 10): live unmatched ghosts per bar; the rest collapse into a `plus-n` glyph. */
export function capUnmatchedGhosts(unmatchedInBar: number, mode: OverlayMode): { shown: number; overflow: number } {
  if (mode !== 'live') return { shown: unmatchedInBar, overflow: 0 };
  const shown = Math.min(unmatchedInBar, UNMATCHED_GHOST_CAP_PER_BAR);
  return { shown, overflow: unmatchedInBar - shown };
}

/** Map a follower or final judgment to the state `ScoreView.setNoteState` takes. */
export function visualStateFromJudgment(j: LiveJudgment | NoteJudgment): NoteVisualState {
  const s: NoteVisualState = { phase: j.status === 'missed' ? 'missed' : 'judged' };
  if (j.status === 'missed') return s;
  if (j.timing !== null) s.timing = j.timing;
  if (j.pitch !== null) s.pitch = j.pitch;
  if ('provisional' in j && j.provisional) s.provisional = true;
  if (j.marginal) s.marginal = true;
  if ('rejudged' in j && j.rejudged) s.rejudged = true;
  return s;
}

const INK: NoteVisual = { noteClass: 'n-ink', ring: 'none', laneGlyphs: [], fadeMs: 0 };

export function noteVisual(s: NoteVisualState, mode: OverlayMode, braked: boolean): NoteVisual {
  // "After the take" draws nothing during the take.
  if (mode === 'blind') return { ...INK, laneGlyphs: [] };

  const review = mode === 'review';
  const ring: NoteVisual['ring'] = review && s.rejudged === true ? 'rejudged' : 'none';
  // 6.6: a re-judged note crossfades from its live look to its final look.
  const fadeMs = review && s.rejudged === true ? REJUDGE_CROSSFADE_MS : NOTE_COLOUR_FADE_MS;

  if (s.phase === 'pending') return { noteClass: 'n-ink', ring, laneGlyphs: [], fadeMs: ring === 'none' ? 0 : fadeMs };

  if (s.phase === 'missed') {
    return { noteClass: 'n-error-hollow', ring, laneGlyphs: ['missed'], fadeMs };
  }

  const t = timingError(s);
  const p = pitchError(s);
  if (t !== null || p !== null) {
    const glyphs: GlyphId[] = [];
    if (braked && !review) {
      // One glyph per note, pitch before timing.
      glyphs.push(p !== null ? PITCH_GLYPH[p] : (t as TimingError));
    } else {
      if (t !== null) glyphs.push(t);
      if (p !== null) glyphs.push(PITCH_GLYPH[p]);
    }
    return { noteClass: 'n-error', ring, laneGlyphs: glyphs, fadeMs };
  }

  if (s.phase === 'active') {
    // Note started, no verdict yet: ring only in live; a correct note never flickers.
    return { noteClass: 'n-ink', ring: review ? ring : 'active', laneGlyphs: [], fadeMs: 0 };
  }

  // Judged and correct (on time, in tune or not graded). Marginal is never red.
  // Review keeps correct notes in plain ink with no lane mark: only slips are coloured (06 section 0, D7).
  if (review) return { noteClass: 'n-ink', ring, laneGlyphs: [], fadeMs };
  return { noteClass: 'n-ink', ring, laneGlyphs: ['dot'], fadeMs };
}

export function ghostVisual(g: GhostNote, mode: OverlayMode, braked: boolean): GhostVisual {
  if (mode === 'blind') {
    return {
      style: g.displaced ? 'ghost-replay' : 'ghost',
      arrow: null,
      offsetRight: false,
      stem: false,
      dashedLedgers: true,
      opacity: 0,
      fadeMs: 0,
      laneGlyph: null,
    };
  }
  const review = mode === 'review';
  const brake = braked && !review;
  const offset = g.kind === 'sharp' || g.kind === 'flat';
  let laneGlyph: GlyphId | null = null;
  if (g.displaced) laneGlyph = 'replay';
  else if (g.kind === 'extra') laneGlyph = 'extra';
  return {
    style: g.displaced ? 'ghost-replay' : 'ghost',
    // Ghost arrows are dropped under the brake; offset and accidentals stay.
    arrow: offset && !brake ? (g.kind === 'sharp' ? 'up' : 'down') : null,
    offsetRight: offset,
    stem: review,
    dashedLedgers: true,
    opacity: brake ? BRAKED_GHOST_OPACITY : 1,
    fadeMs: review || brake ? 0 : GHOST_FADE_MS,
    laneGlyph,
  };
}
