// @vitest-environment jsdom
// "Show what we heard" (round 2, 04-design §9): the pitch trace drawn behind the ink.
import { beforeAll, describe, expect, it } from 'vitest';
import type { SpelledPitch } from '../../core/types.ts';
import { planLayout } from '../../ui/layout-table.ts';
import { VexScoreView, expectedChains, tickablesPerBar } from '../index.ts';
import type { PitchTrace } from '../overlay-seam.ts';
import { fixtureDocs } from '../testing/corpus-node.ts';
import { preparedFromDoc } from '../testing/prepared.ts';
import { spellGhost } from '../../theory/index.ts';
import { SvgOverlay } from './index.ts';
import { TRACE_GAP_BEATS, drawPitchTrace, pitchTraceSegments, tracePath } from './svg-overlay.ts';

const VP = { width: 1280, height: 800 };

function setup() {
  const p = preparedFromDoc(fixtureDocs()[0]!, 'treble');
  const overlay = new SvgOverlay({ reducedMotion: () => true });
  const view = new VexScoreView({ overlay });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const plan = planLayout(VP, { top: 0, bottom: 0 }, p.measures.length, tickablesPerBar(p));
  const layout = view.render(p, el, plan.renderOptions);
  return { p, el, layout, overlay, n: expectedChains(p).length };
}

/** Written spelling of a whole MIDI number in C major (sharps above a natural). */
const spellC = (m: number): SpelledPitch => spellGhost(m, { step: 'C', alter: 0, octave: Math.floor(m / 12) + 1 }, { fifths: 0, mode: 'major' });

function trace(beats: number[], midi: (number | null)[]): PitchTrace {
  return { beats, midi, spell: spellC };
}

const frames = (from: number, to: number, step: number, midi: (b: number) => number | null): { beats: number[]; midi: (number | null)[] } => {
  const beats: number[] = [];
  const out: (number | null)[] = [];
  for (let b = from; b <= to + 1e-9; b += step) {
    beats.push(b);
    out.push(midi(b));
  }
  return { beats, midi: out };
};

beforeAll(() => {
  fixtureDocs();
});

describe('pitch trace geometry', () => {
  it('puts a held whole MIDI number exactly on its notehead line and interpolates a fraction', () => {
    const { layout, p } = setup();
    const f = frames(0, 1, 0.02, () => 72);
    const segs = pitchTraceSegments(layout, p.clef, trace(f.beats, f.midi));
    expect(segs).toHaveLength(1);
    const yC5 = layout.staffY(segs[0]!.system, { step: 'C', alter: 0, octave: 5 }, p.clef);
    for (const pt of segs[0]!.points) expect(pt.y).toBeCloseTo(yC5, 5);
    // Halfway from E5 to F5 sits halfway between their positions.
    const half = pitchTraceSegments(layout, p.clef, trace([0, 0.02], [76.5, 76.5]))[0]!;
    const yE = layout.staffY(half.system, { step: 'E', alter: 0, octave: 5 }, p.clef);
    const yF = layout.staffY(half.system, { step: 'F', alter: 0, octave: 5 }, p.clef);
    expect(half.points[0]!.y).toBeCloseTo((yE + yF) / 2, 5);
  });

  it('x follows the score beat, so the line runs left to right', () => {
    const { layout, p } = setup();
    const f = frames(0, 1.5, 0.02, () => 69);
    const pts = pitchTraceSegments(layout, p.clef, trace(f.beats, f.midi))[0]!.points;
    for (let i = 1; i < pts.length; i++) expect(pts[i]!.x).toBeGreaterThanOrEqual(pts[i - 1]!.x);
    expect(pts[0]!.x).toBeCloseTo(layout.beatToPoint(0).x, 5);
  });

  it('breaks the line at unvoiced frames, pauses and jumps of more than a semitone, and drops single frames', () => {
    const { layout, p } = setup();
    // 0..0.5 voiced, a null, 0.54..1 voiced: two segments.
    const a = frames(0, 1, 0.02, (b) => (Math.abs(b - 0.52) < 1e-6 ? null : 67));
    expect(pitchTraceSegments(layout, p.clef, trace(a.beats, a.midi))).toHaveLength(2);
    // A pause longer than the gap.
    const b = trace([0, 0.02, 0.04, 0.04 + TRACE_GAP_BEATS + 0.05, 0.1 + TRACE_GAP_BEATS], [67, 67, 67, 67, 67]);
    expect(pitchTraceSegments(layout, p.clef, b)).toHaveLength(2);
    // A jump of 2 semitones is a new note; a slide of 0.5 per frame is one line.
    expect(pitchTraceSegments(layout, p.clef, trace([0, 0.02, 0.04, 0.06], [67, 67, 69, 69]))).toHaveLength(2);
    expect(pitchTraceSegments(layout, p.clef, trace([0, 0.02, 0.04, 0.06], [67, 67.5, 68, 68.5]))).toHaveLength(1);
    // One voiced frame alone is not drawn.
    expect(pitchTraceSegments(layout, p.clef, trace([0, 0.02, 0.04], [null, 67, null]))).toHaveLength(0);
  });

  it('starts a new segment on the next system', () => {
    const { layout, p } = setup();
    expect(layout.systems.length).toBeGreaterThan(1);
    const second = layout.systems[1]!;
    // The last beat of the first system and the first of the second.
    let edge = 0;
    while (layout.beatToPoint(edge + 0.02).system === layout.systems[0]!.index) edge += 0.02;
    const f = frames(edge - 0.2, edge + 0.2, 0.02, () => 67);
    const segs = pitchTraceSegments(layout, p.clef, trace(f.beats, f.midi));
    expect(segs.map((s) => s.system)).toEqual([layout.systems[0]!.index, second.index]);
  });

  it('clamps far pitches four spaces past the staff', () => {
    const { layout, p } = setup();
    const seg = pitchTraceSegments(layout, p.clef, trace([0, 0.02], [120, 120]))[0]!;
    const sys = layout.systems.find((s) => s.index === seg.system)!;
    expect(seg.points[0]!.y).toBeCloseTo(sys.staffTopY - 4 * sys.lineSpacing, 5);
  });
});

describe('drawing the trace', () => {
  it('draws thin grey paths behind the ink, replaces them on redraw and removes them with null', () => {
    const { el, layout, p, overlay } = setup();
    const f = frames(0, 2, 0.02, (b) => (b < 1 ? 67 : 67 - (b - 1)));
    overlay.showTrace(trace(f.beats, f.midi));
    const lines = el.querySelectorAll('.sr-underlay .sr-trace .sr-trace-line');
    expect(lines.length).toBeGreaterThan(0);
    const line = lines[0]!;
    expect(line.getAttribute('fill')).toBe('none');
    expect(line.getAttribute('stroke')).toBe('var(--text-muted)');
    expect(Number(line.getAttribute('stroke-width'))).toBeLessThan(2);
    expect(line.closest('.sr-trace')!.getAttribute('aria-hidden')).toBe('true');
    // Behind the ink: inside the underlay, never in the overlay.
    expect(el.querySelector('.sr-overlay .sr-trace')).toBeNull();
    overlay.showTrace(trace(f.beats, f.midi));
    const count = el.querySelectorAll('.sr-trace-line').length;
    overlay.showTrace(trace(f.beats, f.midi));
    expect(el.querySelectorAll('.sr-trace-line')).toHaveLength(count);
    overlay.showTrace(null);
    expect(el.querySelector('.sr-trace')).toBeNull();
    // The standalone drawer does the same on the system SVGs.
    const svgs = new Map(Array.from(el.querySelectorAll<SVGSVGElement>('svg.sr-system[data-system]')).map((s) => [Number(s.getAttribute('data-system')), s]));
    drawPitchTrace(svgs, layout, p.clef, trace(f.beats, f.midi));
    expect(el.querySelectorAll('.sr-trace-line')).toHaveLength(count);
    const d = tracePath(pitchTraceSegments(layout, p.clef, trace(f.beats, f.midi))[0]!);
    expect(d.startsWith('M')).toBe(true);
    expect(el.querySelector('.sr-trace-line')!.getAttribute('d')).toBe(d);
  });

  it('draws nothing for a trace with no voiced frames', () => {
    const { el, overlay } = setup();
    overlay.showTrace(trace([0, 0.02, 0.04], [null, null, null]));
    expect(el.querySelector('.sr-trace')).toBeNull();
  });
});
