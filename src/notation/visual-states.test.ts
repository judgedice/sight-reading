import { describe, expect, it } from 'vitest';
import type { GhostNote, NoteVisualState, PitchVerdict, TimingVerdict } from '../core/types.ts';
import { GLYPH_IDS, type GlyphId } from '../ui/glyph-ids.ts';
import {
  capUnmatchedGhosts,
  ghostVisual,
  isBrakedBar,
  isErrorState,
  noteVisual,
  visualStateFromJudgment,
  type LaneGlyphId,
  type OverlayMode,
} from './visual-states.ts';

// Compile-time: every lane glyph is a real sprite id.
const _laneIsGlyph = (g: LaneGlyphId): GlyphId => g;
void _laneIsGlyph;

const MODES: OverlayMode[] = ['live', 'review', 'blind'];
const PHASES: NoteVisualState['phase'][] = ['pending', 'active', 'judged', 'missed'];
const TIMINGS: (TimingVerdict | undefined)[] = [undefined, 'on-time', 'early', 'late'];
const PITCHES: (PitchVerdict | undefined)[] = [undefined, 'in-tune', 'sharp', 'flat', 'wrong-pitch', 'octave', 'not-graded'];
const BOOLS = [false, true] as const;

function* allStates(): Generator<NoteVisualState> {
  for (const phase of PHASES)
    for (const timing of TIMINGS)
      for (const pitch of PITCHES)
        for (const provisional of BOOLS)
          for (const marginal of BOOLS)
            for (const rejudged of BOOLS) {
              const s: NoteVisualState = { phase };
              if (timing) s.timing = timing;
              if (pitch) s.pitch = pitch;
              if (provisional) s.provisional = true;
              if (marginal) s.marginal = true;
              if (rejudged) s.rejudged = true;
              yield s;
            }
}

const st = (s: NoteVisualState): NoteVisualState => s;

describe('noteVisual: exhaustive invariants', () => {
  it('covers every state x mode x braked with valid output', () => {
    let n = 0;
    for (const s of allStates())
      for (const mode of MODES)
        for (const braked of BOOLS) {
          n++;
          const v = noteVisual(s, mode, braked);
          expect(v.laneGlyphs.length).toBeLessThanOrEqual(2);
          for (const g of v.laneGlyphs) expect(GLYPH_IDS).toContain(g);
          expect(v.fadeMs).toBeGreaterThanOrEqual(0);
          // Idempotent: same input, same output.
          expect(noteVisual(s, mode, braked)).toEqual(v);
          if (mode === 'blind') {
            expect(v).toEqual({ noteClass: 'n-ink', ring: 'none', laneGlyphs: [], fadeMs: 0 });
            continue;
          }
          // Red never applies to a correct or pending note; every error is red or hollow.
          const red = v.noteClass === 'n-error' || v.noteClass === 'n-error-hollow';
          expect(red).toBe(isErrorState(s));
          if (s.phase === 'missed') expect(v.noteClass).toBe('n-error-hollow');
          // Ring rules.
          if (v.ring === 'rejudged') expect(mode === 'review' && s.rejudged === true).toBe(true);
          if (mode === 'review' && s.rejudged === true) expect(v.ring).toBe('rejudged');
          if (v.ring === 'active') expect(mode === 'live' && s.phase === 'active' && !isErrorState(s)).toBe(true);
          // Brake never hides red and never leaves an error without a glyph.
          if (red) expect(v.laneGlyphs.length).toBeGreaterThanOrEqual(1);
          if (red && braked && mode === 'live') expect(v.laneGlyphs).toHaveLength(1);
          // Live never uses the teal class.
          if (mode === 'live') expect(v.noteClass).not.toBe('n-correct');
        }
    expect(n).toBe(4 * 4 * 7 * 8 * 3 * 2);
  });
});

describe('noteVisual: table rows (6.1)', () => {
  it('pending', () => {
    for (const mode of ['live', 'review'] as const)
      expect(noteVisual(st({ phase: 'pending' }), mode, false)).toMatchObject({ noteClass: 'n-ink', ring: 'none', laneGlyphs: [] });
  });
  it('active live: ring only, ink', () => {
    expect(noteVisual(st({ phase: 'active' }), 'live', false)).toMatchObject({ noteClass: 'n-ink', ring: 'active', laneGlyphs: [] });
    expect(noteVisual(st({ phase: 'active', timing: 'on-time' }), 'live', false).noteClass).toBe('n-ink');
  });
  it('correct: dot live, check review', () => {
    const s = st({ phase: 'judged', timing: 'on-time', pitch: 'in-tune' });
    expect(noteVisual(s, 'live', false)).toMatchObject({ noteClass: 'n-ink', laneGlyphs: ['dot'] });
    expect(noteVisual(s, 'review', false)).toMatchObject({ noteClass: 'n-correct', laneGlyphs: ['check'] });
    const ng = st({ phase: 'judged', timing: 'on-time', pitch: 'not-graded' });
    expect(noteVisual(ng, 'review', false).laneGlyphs).toEqual(['check']);
  });
  it('correct-marginal is never red', () => {
    const s = st({ phase: 'judged', timing: 'on-time', pitch: 'in-tune', marginal: true });
    expect(noteVisual(s, 'live', false)).toMatchObject({ noteClass: 'n-ink', laneGlyphs: ['dot'] });
    expect(noteVisual(s, 'review', false)).toMatchObject({ noteClass: 'n-correct', laneGlyphs: ['check-marginal'] });
  });
  it('timing and pitch glyphs', () => {
    const g = (timing?: TimingVerdict, pitch?: PitchVerdict) => {
      const s: NoteVisualState = { phase: 'judged' };
      if (timing) s.timing = timing;
      if (pitch) s.pitch = pitch;
      return noteVisual(s, 'live', false);
    };
    expect(g('early').laneGlyphs).toEqual(['early']);
    expect(g('late').laneGlyphs).toEqual(['late']);
    expect(g('on-time', 'sharp').laneGlyphs).toEqual(['sharp']);
    expect(g('on-time', 'flat').laneGlyphs).toEqual(['flat']);
    expect(g('on-time', 'wrong-pitch').laneGlyphs).toEqual(['wrong']);
    expect(g('on-time', 'octave').laneGlyphs).toEqual(['octave']);
    expect(g('late', 'flat')).toMatchObject({ noteClass: 'n-error', laneGlyphs: ['late', 'flat'] });
    expect(g('early', 'sharp').laneGlyphs).toEqual(['early', 'sharp']);
  });
  it('missed is hollow with the missed glyph', () => {
    for (const mode of ['live', 'review'] as const)
      expect(noteVisual(st({ phase: 'missed' }), mode, false)).toMatchObject({ noteClass: 'n-error-hollow', laneGlyphs: ['missed'] });
  });
  it('brake keeps one glyph per note, pitch before timing', () => {
    expect(noteVisual(st({ phase: 'judged', timing: 'late', pitch: 'flat' }), 'live', true)).toMatchObject({ noteClass: 'n-error', laneGlyphs: ['flat'] });
    expect(noteVisual(st({ phase: 'judged', timing: 'late' }), 'live', true).laneGlyphs).toEqual(['late']);
    // Review is not braked.
    expect(noteVisual(st({ phase: 'judged', timing: 'late', pitch: 'flat' }), 'review', true).laneGlyphs).toEqual(['late', 'flat']);
  });
  it('re-judged: dashed ring and 200 ms crossfade in review only', () => {
    const s = st({ phase: 'judged', timing: 'on-time', pitch: 'in-tune', rejudged: true });
    expect(noteVisual(s, 'review', false)).toMatchObject({ ring: 'rejudged', fadeMs: 200 });
    expect(noteVisual(s, 'live', false).ring).toBe('none');
  });
  it('provisional pitch error is red with a 100 ms fade (it may revert)', () => {
    const v = noteVisual(st({ phase: 'judged', timing: 'on-time', pitch: 'sharp', provisional: true }), 'live', false);
    expect(v).toMatchObject({ noteClass: 'n-error', fadeMs: 100 });
  });
  it('blind draws nothing', () => {
    expect(noteVisual(st({ phase: 'judged', timing: 'late' }), 'blind', false).laneGlyphs).toEqual([]);
  });
});

const ghost = (kind: GhostNote['kind'], displaced = false): GhostNote => ({
  detectedId: 1,
  scoreBeat: 1,
  writtenPitch: { step: 'F', alter: 0, octave: 4 } as unknown as GhostNote['writtenPitch'],
  kind,
  centsError: null,
  targetExpectedIdx: kind === 'extra' ? null : 0,
  displaced,
});
const KINDS: GhostNote['kind'][] = ['early', 'late', 'sharp', 'flat', 'wrong-pitch', 'octave', 'extra'];

describe('ghostVisual', () => {
  it('every kind x mode x braked x displaced is valid and never dropped', () => {
    for (const kind of KINDS)
      for (const mode of MODES)
        for (const braked of BOOLS)
          for (const displaced of BOOLS) {
            const v = ghostVisual(ghost(kind, displaced), mode, braked);
            expect(v.dashedLedgers).toBe(true);
            expect(v.style).toBe(displaced ? 'ghost-replay' : 'ghost');
            if (mode === 'blind') {
              expect(v.opacity).toBe(0);
              continue;
            }
            expect(v.opacity).toBeGreaterThan(0);
            if (v.laneGlyph) expect(GLYPH_IDS).toContain(v.laneGlyph);
            // Live ghosts have no stem; review ghosts do.
            expect(v.stem).toBe(mode === 'review');
            // Offset (and so the accidental position) survives the brake.
            expect(v.offsetRight).toBe(kind === 'sharp' || kind === 'flat');
            if (kind !== 'sharp' && kind !== 'flat') expect(v.arrow).toBeNull();
          }
  });
  it('sharp and flat: offset right with the arrow, dropped under the brake', () => {
    expect(ghostVisual(ghost('sharp'), 'live', false)).toMatchObject({ arrow: 'up', offsetRight: true, fadeMs: 80, opacity: 1, laneGlyph: null });
    expect(ghostVisual(ghost('flat'), 'live', false)).toMatchObject({ arrow: 'down', offsetRight: true });
    expect(ghostVisual(ghost('sharp'), 'live', true)).toMatchObject({ arrow: null, offsetRight: true, fadeMs: 0, opacity: 0.7 });
    expect(ghostVisual(ghost('flat'), 'review', true).arrow).toBe('down');
  });
  it('early, late, wrong, octave: ghost at played position, no arrow, no ghost lane glyph', () => {
    for (const k of ['early', 'late', 'wrong-pitch', 'octave'] as const)
      expect(ghostVisual(ghost(k), 'live', false)).toMatchObject({ arrow: null, offsetRight: false, laneGlyph: null });
  });
  it('extra and replay lane glyphs', () => {
    expect(ghostVisual(ghost('extra'), 'live', false).laneGlyph).toBe('extra');
    expect(ghostVisual(ghost('extra', true), 'live', false).laneGlyph).toBe('replay');
    expect(ghostVisual(ghost('late', true), 'review', false)).toMatchObject({ style: 'ghost-replay', laneGlyph: 'replay' });
  });
  it('review ghosts are opaque with stems and no fade', () => {
    expect(ghostVisual(ghost('late'), 'review', false)).toMatchObject({ stem: true, opacity: 1, fadeMs: 0 });
  });
});

describe('brake and cap rules', () => {
  it('brake triggers above 4 error states per bar', () => {
    expect(isBrakedBar(4)).toBe(false);
    expect(isBrakedBar(5)).toBe(true);
  });
  it('unmatched ghosts cap at 3 per bar live only', () => {
    expect(capUnmatchedGhosts(2, 'live')).toEqual({ shown: 2, overflow: 0 });
    expect(capUnmatchedGhosts(7, 'live')).toEqual({ shown: 3, overflow: 4 });
    expect(capUnmatchedGhosts(7, 'review')).toEqual({ shown: 7, overflow: 0 });
  });
});

describe('visualStateFromJudgment', () => {
  const base = {
    expectedIdx: 0, status: 'matched' as const, detectedId: 1, timing: 'late' as const, timingErrorMs: 90,
    pitch: 'flat' as const, playedConcertMidi: 60, centsError: -20, octaveDisplaced: false,
    duration: 'ok' as const, heldRatio: 1, marginal: false,
  };
  it('maps live and final judgments', () => {
    expect(visualStateFromJudgment({ ...base, provisional: true })).toEqual({ phase: 'judged', timing: 'late', pitch: 'flat', provisional: true });
    expect(
      visualStateFromJudgment({ ...base, credit: { p: 1, n: 1, o: 1, d: 1 }, rejudged: true, marginal: true }),
    ).toEqual({ phase: 'judged', timing: 'late', pitch: 'flat', marginal: true, rejudged: true });
  });
  it('maps missed', () => {
    expect(visualStateFromJudgment({ ...base, status: 'missed', timing: null, pitch: null, provisional: false })).toEqual({ phase: 'missed' });
  });
});
