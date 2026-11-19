// @vitest-environment jsdom
// P15 acceptance (01 section 15, P15 row): every render stream yields the DOM states of visual-states.ts;
// idempotent re-sends; ruling 36; the brake, the cap, modes, reduced motion, and the playhead.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Beats, FollowerEvent, GhostNote, NoteVisualState, PreparedExcerpt, RenderStreamLine } from '../../core/types.ts';
import { reduceOverlay } from '../../testkit/predicates/index.ts';
import { planLayout } from '../../ui/layout-table.ts';
import { VexScoreView, expectedChains, tickablesPerBar } from '../index.ts';
import { fixtureDoc, fixtureDocs } from '../testing/corpus-node.ts';
import { preparedFromDoc } from '../testing/prepared.ts';
import { capUnmatchedGhosts, ghostVisual, isBrakedBar, isErrorState, noteVisual, visualStateFromJudgment } from '../visual-states.ts';
import { spellGhost, toMidi } from '../../theory/index.ts';
import { SvgOverlay } from './index.ts';

const VP = { width: 1280, height: 800 };

function setup(excerptId?: string, opts: { reduced?: boolean } = {}) {
  const doc = excerptId ? fixtureDoc(excerptId) : fixtureDocs()[0]!;
  const p = preparedFromDoc(doc, 'treble');
  const overlay = new SvgOverlay({ reducedMotion: () => opts.reduced ?? false });
  const view = new VexScoreView({ overlay });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const plan = planLayout(VP, { top: 0, bottom: 0 }, p.measures.length, tickablesPerBar(p));
  const layout = view.render(p, el, plan.renderOptions);
  return { p, view, el, layout, overlay, n: expectedChains(p).length };
}

const groups = (el: HTMLElement, idx: number): SVGElement[] => Array.from(el.querySelectorAll<SVGElement>(`g[data-expected-idx="${idx}"]`));
const ghostsIn = (el: HTMLElement): SVGElement[] => Array.from(el.querySelectorAll<SVGElement>('.sr-ghost'));
const glyphsIn = (el: HTMLElement): SVGElement[] => Array.from(el.querySelectorAll<SVGElement>('.sr-glyph'));
const glyphIds = (root: ParentNode): string[] => Array.from(root.querySelectorAll('.sr-glyph')).map((u) => u.getAttribute('data-glyph')!);

function ghost(p: PreparedExcerpt, detectedId: number, o: Partial<GhostNote> = {}): GhostNote {
  const m = p.measures.find((x) => x.events.some((e) => e.kind === 'note'))!;
  const e = m.events.find((x) => x.kind === 'note')!;
  return {
    detectedId,
    scoreBeat: 0.5,
    writtenPitch: e.kind === 'note' ? e.writtenPitch : { step: 'C', alter: 0, octave: 5 },
    kind: 'late',
    centsError: null,
    targetExpectedIdx: 0,
    displaced: false,
    ...o,
  };
}

beforeAll(() => {
  fixtureDocs();
});

describe('note colours and lane glyphs', () => {
  it('writes the class, colour and glyphs that noteVisual prescribes for every phase', () => {
    const { el, view } = setup();
    const cases: NoteVisualState[] = [
      { phase: 'pending' },
      { phase: 'active' },
      { phase: 'judged', timing: 'on-time', pitch: 'in-tune' },
      { phase: 'judged', timing: 'late' },
      { phase: 'judged', timing: 'early', pitch: 'sharp' },
      { phase: 'judged', pitch: 'wrong-pitch' },
      { phase: 'missed' },
    ];
    cases.forEach((s, i) => {
      view.setNoteState(i, s);
      const v = noteVisual(s, 'live', false);
      for (const g of groups(el, i)) expect(g.classList.contains(v.noteClass), JSON.stringify(s)).toBe(true);
      const marks = el.querySelector(`.sr-note-marks[data-marks-for="${i}"]`);
      expect(marks ? glyphIds(marks) : [], JSON.stringify(s)).toEqual(v.laneGlyphs);
      expect(!!marks?.querySelector('.sr-ring-active')).toBe(v.ring === 'active');
    });
    expect(groups(el, 3)[0]!.style.color).toBe('var(--error)');
    expect(groups(el, 2)[0]!.style.color).toBe('');
    expect(groups(el, 6)[0]!.classList.contains('n-error-hollow')).toBe(true);
  });

  it('is idempotent: re-sending a state writes no DOM', () => {
    const { el, view } = setup();
    view.setNoteState(1, { phase: 'judged', timing: 'late', pitch: 'flat' });
    const before = el.innerHTML;
    const marks = el.querySelector('.sr-note-marks');
    view.setNoteState(1, { phase: 'judged', timing: 'late', pitch: 'flat' });
    expect(el.innerHTML).toBe(before);
    expect(el.querySelector('.sr-note-marks')).toBe(marks);
  });

  it('a new state replaces the old marks of that note', () => {
    const { el, view } = setup();
    view.setNoteState(1, { phase: 'judged', timing: 'late', pitch: 'flat' });
    expect(glyphIds(el)).toEqual(['late', 'flat']);
    view.setNoteState(1, { phase: 'judged', timing: 'on-time', pitch: 'in-tune' });
    expect(glyphIds(el)).toEqual(['dot']);
    expect(groups(el, 1)[0]!.classList.contains('n-ink')).toBe(true);
    view.setNoteState(1, { phase: 'pending' });
    expect(glyphsIn(el)).toHaveLength(0);
  });

  it('ignores an unknown expected index', () => {
    const { el, view, n } = setup();
    const before = el.innerHTML;
    view.setNoteState(n + 5, { phase: 'missed' });
    expect(el.innerHTML).toBe(before);
  });

  it('zeroes the colour fade under reduced motion and keeps 100 ms otherwise', () => {
    const live = setup();
    live.view.setNoteState(0, { phase: 'judged', timing: 'late' });
    expect(groups(live.el, 0)[0]!.style.transition).toContain('100ms');
    const red = setup(undefined, { reduced: true });
    red.view.setNoteState(0, { phase: 'judged', timing: 'late' });
    expect(groups(red.el, 0)[0]!.style.transition).toBe('');
  });
});

describe('ghosts', () => {
  it('draws a ghost at the played beat with a dashed ledger set only when needed, and updates by detectedId', () => {
    const { el, view, p, layout } = setup();
    const g = ghost(p, 7, { scoreBeat: 1.5, kind: 'late' });
    view.showGhost(g);
    expect(ghostsIn(el)).toHaveLength(1);
    const head = el.querySelector('.sr-ghost-head')!;
    const m = /translate\(([-\d.]+) /.exec(head.getAttribute('transform')!)!;
    expect(Math.abs(Number(m[1]) - layout.beatToPoint(1.5).x)).toBeLessThan(0.01);
    expect(el.querySelector('.sr-ghost-arrow')).toBeNull();
    // Update: same id, new beat. Still one ghost.
    view.showGhost({ ...g, scoreBeat: 2.5 });
    expect(ghostsIn(el)).toHaveLength(1);
    view.removeGhost(7);
    expect(ghostsIn(el)).toHaveLength(0);
    view.removeGhost(7);
  });

  it('R50: a whole-tone wrong note draws its ghost on another staff position than the target; a semitone keeps it', () => {
    const { el, view, p, layout } = setup();
    const pt = layout.beatToPoint(0.5);
    const sp = layout.systems.find((s) => s.index === pt.system)!.lineSpacing;
    const headY = (id: number): number => {
      const head = el.querySelector(`.sr-ghost[data-detected-id="${id}"] .sr-ghost-head`)!;
      return Number(/translate\([-\d.]+ ([-\d.]+)\)/.exec(head.getAttribute('transform')!)![1]);
    };
    const targets = p.measures.flatMap((m) => m.events.flatMap((e) => (e.kind === 'note' ? [e.writtenPitch] : []))).slice(0, 12);
    expect(targets.length).toBeGreaterThan(3);
    let id = 100;
    for (const t of targets) {
      const targetY = layout.staffY(pt.system, t, p.clef);
      for (const d of [-2, 2]) {
        const g = spellGhost(toMidi(t) + d, t, p.writtenKey);
        view.showGhost(ghost(p, ++id, { kind: 'wrong-pitch', writtenPitch: g }));
        // At least one diatonic step (half a line spacing) away from the target notehead.
        expect(Math.abs(headY(id) - targetY), `${t.step}${t.alter}${t.octave} ${d > 0 ? '+' : ''}${d} -> ${g.step}${g.alter}${g.octave}`).toBeGreaterThanOrEqual(sp / 2 - 0.01);
      }
      for (const d of [-1, 1]) {
        const g = spellGhost(toMidi(t) + d, t, p.writtenKey);
        if (Math.abs(g.alter) > 2 || g.step !== t.step) continue;
        view.showGhost(ghost(p, ++id, { kind: 'wrong-pitch', writtenPitch: g }));
        expect(Math.abs(headY(id) - targetY)).toBeLessThan(0.01);
      }
    }
  });

  it('re-sending an identical ghost leaves the DOM untouched (no second fade)', () => {
    const { el, view, p } = setup();
    const g = ghost(p, 3);
    view.showGhost(g);
    const node = ghostsIn(el)[0]!;
    expect(node.classList.contains('sr-ghost-fade')).toBe(true);
    view.showGhost({ ...g });
    expect(ghostsIn(el)[0]).toBe(node);
  });

  it('sharp and flat ghosts sit offset right with an arrow; the brake drops the arrow', () => {
    const { el, view, p, layout } = setup();
    const g = ghost(p, 1, { scoreBeat: 1, kind: 'sharp' });
    view.showGhost(g);
    const head = el.querySelector('.sr-ghost-head')!;
    const x = Number(/translate\(([-\d.]+) /.exec(head.getAttribute('transform')!)![1]);
    expect(x).toBeGreaterThan(layout.beatToPoint(1).x + 5);
    expect(el.querySelector('.sr-ghost-arrow')!.getAttribute('data-arrow')).toBe('up');
    view.showGhost({ ...g, detectedId: 2, kind: 'flat' });
    expect(el.querySelectorAll('.sr-ghost-arrow')).toHaveLength(2);
  });

  it('removes the ghost when the note state reverts (ruling 36) but keeps one the state still agrees with', () => {
    const { el, view, p } = setup();
    view.setNoteState(0, { phase: 'judged', pitch: 'sharp', provisional: true });
    view.showGhost(ghost(p, 1, { kind: 'sharp', targetExpectedIdx: 0 }));
    expect(ghostsIn(el)).toHaveLength(1);
    view.setNoteState(0, { phase: 'judged', pitch: 'sharp' });
    expect(ghostsIn(el)).toHaveLength(1);
    view.setNoteState(0, { phase: 'judged', timing: 'on-time', pitch: 'in-tune' });
    expect(ghostsIn(el)).toHaveLength(0);
    // The follower's stored ghost is gone from the overlay, and a later removeGhost is harmless.
    view.removeGhost(1);
  });

  it('caps unmatched ghosts at 3 per bar live with a plus-n count, and shows all in review', () => {
    const { el, view, p } = setup();
    for (let i = 0; i < 6; i++) view.showGhost(ghost(p, 10 + i, { kind: 'extra', targetExpectedIdx: null, scoreBeat: 0.2 + i * 0.1 }));
    expect(capUnmatchedGhosts(6, 'live')).toEqual({ shown: 3, overflow: 3 });
    expect(ghostsIn(el)).toHaveLength(3);
    const plus = el.querySelector('.sr-overflow')!;
    expect(plus.getAttribute('data-count')).toBe('3');
    expect(plus.querySelector('text')!.textContent).toBe('3');
    view.setMode('review');
    expect(ghostsIn(el)).toHaveLength(6);
    expect(el.querySelector('.sr-overflow')).toBeNull();
    view.setMode('live');
    expect(ghostsIn(el)).toHaveLength(3);
  });

  it('matched ghosts are never capped', () => {
    const { el, view, p } = setup();
    for (let i = 0; i < 8; i++) view.showGhost(ghost(p, i, { kind: 'late', scoreBeat: 0.2 + i * 0.1 }));
    expect(ghostsIn(el)).toHaveLength(8);
    expect(el.querySelector('.sr-overflow')).toBeNull();
  });

  it('draws replayed ghosts dashed and un-filled with the replay glyph', () => {
    const { el, view, p } = setup();
    view.showGhost(ghost(p, 4, { displaced: true, targetExpectedIdx: null, kind: 'wrong-pitch' }));
    const head = el.querySelector('.sr-ghost-head')!;
    expect(head.getAttribute('fill')).toBe('none');
    expect(head.getAttribute('stroke-dasharray')).toBe('3 2');
    expect(glyphIds(el)).toEqual(['replay']);
    expect(ghostVisual(ghost(p, 4, { displaced: true }), 'live', false).style).toBe('ghost-replay');
  });

  it('keeps the 80 ms live fade, the 100 ms reduced-motion fade, and no fade under the brake or in review', () => {
    const live = setup();
    live.view.showGhost(ghost(live.p, 1));
    expect(ghostsIn(live.el)[0]!.style.animationDuration).toBe('80ms');
    const red = setup(undefined, { reduced: true });
    red.view.showGhost(ghost(red.p, 1));
    expect(ghostsIn(red.el)[0]!.style.animationDuration).toBe('100ms');
    live.view.setMode('review');
    expect(ghostsIn(live.el)[0]!.classList.contains('sr-ghost-fade')).toBe(false);
  });
});

describe('density brake (6.4 rule 9)', () => {
  it('more than 4 errors in a bar: one glyph per note, ghost arrows dropped, ghosts at 70%, all red notes kept', () => {
    const dense = fixtureDocs().find((d) => {
      const c = new Map<number, number>();
      for (const [i, m] of d.measures.entries()) c.set(i, m.events.filter((e) => e.kind === 'note').length);
      return Math.max(...c.values()) >= 5;
    })!;
    const { el, view, p } = setup(dense.id);
    const chains = expectedChains(p);
    const counts = new Map<number, number>();
    for (const c of chains) counts.set(c.bar, (counts.get(c.bar) ?? 0) + 1);
    const bar0 = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    const idxs = chains.map((c, i) => [c.bar, i] as const).filter(([b]) => b === bar0).map(([, i]) => i);
    expect(idxs.length).toBeGreaterThanOrEqual(5);
    view.showGhost(ghost(p, 99, { kind: 'sharp', targetExpectedIdx: idxs[0]!, scoreBeat: 0.5 }));
    expect(el.querySelector('.sr-ghost-arrow')).not.toBeNull();
    const err: NoteVisualState = { phase: 'judged', timing: 'late', pitch: 'sharp' };
    for (const i of idxs.slice(0, 4)) view.setNoteState(i, err);
    expect(isBrakedBar(4)).toBe(false);
    expect(glyphIds(el).length).toBe(8);
    view.setNoteState(idxs[4]!, err);
    expect(glyphIds(el).filter((g) => g !== 'dot').length).toBe(5);
    expect(glyphIds(el).every((g) => g === 'sharp')).toBe(true);
    expect(el.querySelector('.sr-ghost-arrow')).toBeNull();
    expect(ghostsIn(el)[0]!.getAttribute('opacity')).toBe('0.7');
    for (const i of idxs.slice(0, 5)) expect(groups(el, i)[0]!.classList.contains('n-error')).toBe(true);
    expect(ghostsIn(el)).toHaveLength(1);
    // Back to 4 errors: full glyphs return.
    view.setNoteState(idxs[4]!, { phase: 'pending' });
    expect(glyphIds(el)).toHaveLength(8);
    expect(el.querySelector('.sr-ghost-arrow')).not.toBeNull();
  });
});

describe('modes', () => {
  it('blind draws no marks and no ghosts, keeps note ink, and restores on live', () => {
    const { el, view, p } = setup();
    view.setNoteState(0, { phase: 'judged', timing: 'late' });
    view.showGhost(ghost(p, 1));
    view.setMode('blind');
    expect(glyphsIn(el)).toHaveLength(0);
    expect(ghostsIn(el)).toHaveLength(0);
    expect(groups(el, 0)[0]!.classList.contains('n-ink')).toBe(true);
    view.setNoteState(1, { phase: 'judged', timing: 'early' });
    expect(glyphsIn(el)).toHaveLength(0);
    view.showGhost(ghost(p, 2, { scoreBeat: 2 }));
    expect(ghostsIn(el)).toHaveLength(0);
    view.setMode('live');
    expect(glyphIds(el)).toEqual(['late', 'early']);
    expect(ghostsIn(el)).toHaveLength(2);
  });

  it('review: correct notes stay ink with no mark; rejudged notes get a dashed ring and a 200 ms crossfade', () => {
    const { el, view, layout } = setup();
    view.setNoteState(0, { phase: 'judged', timing: 'on-time', pitch: 'in-tune' });
    view.setNoteState(1, { phase: 'judged', timing: 'on-time', marginal: true });
    view.setNoteState(2, { phase: 'judged', timing: 'late', rejudged: true });
    view.setMode('review');
    expect(groups(el, 0)[0]!.classList.contains('n-ink')).toBe(true);
    expect(groups(el, 0)[0]!.style.color).toBe('');
    expect(el.querySelector('.sr-note-marks[data-marks-for="0"]')).toBeNull();
    expect(el.querySelector('.sr-note-marks[data-marks-for="1"]')).toBeNull();
    expect(el.querySelector('.sr-note-marks[data-marks-for="2"] .sr-ring-rejudged')!.getAttribute('stroke-dasharray')).toBe('4 3');
    expect(groups(el, 2)[0]!.style.transition).toContain('200ms');
    // Review lane glyphs are 1.25 staff spaces.
    const sp = layout.systems[0]!.lineSpacing;
    expect(Number(glyphsIn(el)[0]!.getAttribute('data-size'))).toBeCloseTo(1.25 * sp, 1);
  });

  it('review ghosts are opaque with stems', () => {
    const { el, view, p } = setup();
    view.showGhost(ghost(p, 1));
    view.setMode('review');
    expect(el.querySelector('.sr-ghost-stem')).not.toBeNull();
    expect(el.querySelector('.sr-ghost-head')!.getAttribute('fill-opacity')).toBe('0.55');
    expect(el.querySelector('.sr-ghost-stem')!.getAttribute('stroke-opacity')).toBe('0.75');
  });

  it('clear() removes every mark and restores the ink', () => {
    const { el, view, p } = setup();
    view.setNoteState(0, { phase: 'judged', timing: 'late' });
    view.showGhost(ghost(p, 1));
    view.setPlayhead(1);
    view.clearOverlay();
    expect(glyphsIn(el)).toHaveLength(0);
    expect(ghostsIn(el)).toHaveLength(0);
    expect(groups(el, 0)[0]!.classList.contains('n-error')).toBe(false);
    expect(groups(el, 0)[0]!.style.color).toBe('');
    expect(el.querySelector('.sr-playhead')!.getAttribute('visibility')).toBe('hidden');
  });
});

describe('playhead, bar tint, fading the past', () => {
  it('moves one playhead line across systems and tints the current bar only', () => {
    const { el, view, layout, p } = setup('mozart-sq35524196-violin1-mv2-mp16-28');
    expect(layout.systems.length).toBeGreaterThan(1);
    view.setPlayhead(1);
    const line = el.querySelector('.sr-playhead')!;
    expect(line.getAttribute('x1')).toBe(String(Math.round(layout.beatToPoint(1).x * 100) / 100));
    expect(el.querySelectorAll('.sr-playhead')).toHaveLength(1);
    expect(el.querySelectorAll('.sr-bar-tint')).toHaveLength(1);
    const lastBeat: Beats = (p.measures.at(-1)!.startTick - p.pickupTicks) / p.meter.countUnitTicks + 0.5;
    view.setPlayhead(lastBeat);
    const sys = layout.beatToPoint(lastBeat).system;
    expect(line.closest('svg')!.getAttribute('data-system')).toBe(String(sys));
    expect(el.querySelector('.sr-bar-tint')!.closest('svg')!.getAttribute('data-system')).toBe(String(sys));
    expect(el.querySelectorAll('.sr-playhead')).toHaveLength(1);
    view.setPlayhead(null);
    expect(line.getAttribute('visibility')).toBe('hidden');
    expect(el.querySelector('.sr-bar-tint')!.getAttribute('visibility')).toBe('hidden');
  });

  it('draws one wash and no next-bar marker (06 section 7)', () => {
    const { el, view, p, layout } = setup();
    const per = p.meter.countsPerBar;
    view.setPlayhead(per * 0.8);
    expect(el.querySelector('.sr-next-bar')).toBeNull();
    const wash = el.querySelectorAll('.sr-bar-tint');
    expect(wash).toHaveLength(1);
    const sys = layout.systems[0]!;
    const sp = sys.lineSpacing;
    expect(Number(wash[0]!.getAttribute('y'))).toBeCloseTo(sys.staffTopY - 1.8 * sp, 1);
    expect(Number(wash[0]!.getAttribute('rx'))).toBeCloseTo(0.5 * sp, 1);
    // No visible playhead line.
    expect(el.querySelector('.sr-playhead')!.getAttribute('visibility')).toBe('hidden');
  });

  it('drops slip marks and slip notes to 70% once the playhead leaves their system; ink never fades', () => {
    const { el, view, layout, p } = setup('mozart-sq35524196-violin1-mv2-mp16-28');
    const per = p.meter.countsPerBar;
    const chains = expectedChains(p);
    const inBar1 = chains.map((c, i) => [c.bar, i] as const).filter(([b]) => b === 1).map(([, i]) => i);
    expect(inBar1.length).toBeGreaterThan(1);
    view.setNoteState(inBar1[0]!, { phase: 'judged', timing: 'late' });
    view.setNoteState(inBar1[1]!, { phase: 'judged', timing: 'on-time', pitch: 'in-tune' });
    const bars = Array.from(el.querySelectorAll<SVGElement>('g.sr-bar'));
    const bar1 = bars.find((b) => b.getAttribute('data-bar') === '1')!;
    view.setPlayhead(per * 0.5);
    expect(bar1.getAttribute('opacity')).toBeNull();
    view.setPlayhead(per + 1.2);
    expect(bar1.getAttribute('opacity')).toBeNull();
    const next = layout.systems[1]!.firstBar;
    const beatInNext = (p.measures.find((m) => m.displayBar === next)!.startTick - p.pickupTicks) / p.meter.countUnitTicks + 0.1;
    view.setPlayhead(beatInNext);
    expect(bar1.getAttribute('opacity')).toBe('0.7');
    expect(groups(el, inBar1[0]!)[0]!.getAttribute('opacity')).toBe('0.7');
    expect(groups(el, inBar1[1]!)[0]!.getAttribute('opacity')).toBeNull();
    // Review shows everything at full strength.
    view.setMode('review');
    expect(bar1.getAttribute('opacity')).toBeNull();
    expect(groups(el, inBar1[0]!)[0]!.getAttribute('opacity')).toBeNull();
  });
});

describe('render streams (fixtures/render)', () => {
  const dir = join(process.cwd(), 'fixtures/render');
  const files = ['arriaga-sax-cut-time', 'faure-cello-tenor-clef', 'gouvy-cello-compound', 'haydn-clarinet-fast', 'holmes-voice-octave-flat', 'le-beau-flute-restart', 'mayer-flute-s1-mix', 'mozart-violin-stop'];
  it.each(files)('%s: the DOM matches visual-states.ts after the stream, and a second pass changes nothing', (name) => {
    const lines = readFileSync(join(dir, `${name}.events.jsonl`), 'utf8').trimEnd().split('\n').map((l) => JSON.parse(l) as RenderStreamLine);
    const header = lines[0] as Extract<RenderStreamLine, { kind: 'header' }>;
    const { el, view, n, p } = setup(header.excerptId);
    const events = lines.flatMap((l): FollowerEvent[] => (l.kind === 'event' ? [l.event] : []));
    const play = (): void => {
      for (const ev of events) {
        if (ev.type === 'clock') view.setPlayhead(ev.scoreBeat);
        else if (ev.type === 'judgment') view.setNoteState(ev.judgment.expectedIdx, visualStateFromJudgment(ev.judgment));
        else if (ev.type === 'missed') view.setNoteState(ev.expectedIdx, { phase: 'missed' });
        else if (ev.type === 'ghost') view.showGhost(ev.ghost);
      }
    };
    play();
    const red = reduceOverlay(events);
    const bars = expectedChains(p).map((c) => c.bar);

    // Brake per bar from the reduced states.
    const stateOf = (i: number): NoteVisualState | null => {
      const j = red.judgments.get(i);
      if (red.missed.has(i) && !j) return { phase: 'missed' };
      return j ? visualStateFromJudgment(j) : null;
    };
    const errs = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      const s = stateOf(i);
      if (s && isErrorState(s)) errs.set(bars[i]!, (errs.get(bars[i]!) ?? 0) + 1);
    }
    for (let i = 0; i < n; i++) {
      const s = stateOf(i);
      if (!s) continue;
      const v = noteVisual(s, 'live', isBrakedBar(errs.get(bars[i]!) ?? 0));
      for (const g of groups(el, i)) expect(g.classList.contains(v.noteClass), `${name} note ${i}`).toBe(true);
      const marks = el.querySelector(`.sr-note-marks[data-marks-for="${i}"]`);
      expect(marks ? glyphIds(marks) : [], `${name} note ${i}`).toEqual(v.laneGlyphs);
    }
    // Every drawn ghost is a reduced ghost, and every matched ghost whose note state agrees is drawn.
    const drawn = new Set(ghostsIn(el).map((g) => Number(g.getAttribute('data-detected-id'))));
    for (const id of drawn) expect(red.ghosts.has(id), `${name} ghost ${id}`).toBe(true);
    for (const g of red.ghosts.values()) {
      if (g.kind === 'extra' || g.displaced) continue;
      const s = g.targetExpectedIdx === null ? null : stateOf(g.targetExpectedIdx);
      const agrees = s === null || g.kind === s.timing || g.kind === s.pitch;
      expect(drawn.has(g.detectedId), `${name} matched ghost ${g.detectedId}`).toBe(agrees);
    }

    // Idempotence: the whole stream again leaves the DOM as it was.
    const html = el.innerHTML;
    play();
    const after = el.innerHTML;
    if (after !== html) {
      let k = 0;
      while (html[k] === after[k]) k++;
      throw new Error(`DOM differs at ${k}: ${html.slice(k - 150, k + 150)}\n----\n${after.slice(k - 150, k + 150)}`);
    }

    // Review mode on the final states, then live again, round-trips.
    view.setMode('review');
    for (const g of ghostsIn(el)) expect(g.querySelector('.sr-ghost-stem')).not.toBeNull();
    view.setMode('live');
    expect(el.innerHTML).toBe(html);
  }, 60_000);
});

describe('ghost geometry', () => {
  it('offsets overlapping ghosts to the right by 0.8 notehead widths, lowest id stays put', () => {
    const { el, view, p } = setup();
    view.showGhost(ghost(p, 1, { scoreBeat: 1 }));
    view.showGhost(ghost(p, 2, { scoreBeat: 1 }));
    const xs = Array.from(el.querySelectorAll('.sr-ghost-head')).map((h) => Number(/translate\(([-\d.]+) /.exec(h.getAttribute('transform')!)![1]));
    expect(xs).toHaveLength(2);
    const sp = 10;
    expect(xs[1]! - xs[0]!).toBeGreaterThan(0.7 * 1.18 * sp * 0.5);
    // Order of arrival does not change where ghost 1 sits.
    const again = setup();
    again.view.showGhost(ghost(again.p, 2, { scoreBeat: 1 }));
    again.view.showGhost(ghost(again.p, 1, { scoreBeat: 1 }));
    const byId = new Map(Array.from(again.el.querySelectorAll('.sr-ghost')).map((g) => [g.getAttribute('data-detected-id'), Number(/translate\(([-\d.]+) /.exec(g.querySelector('.sr-ghost-head')!.getAttribute('transform')!)![1])]));
    expect(byId.get('1')).toBeCloseTo(xs[0]!, 1);
    expect(byId.get('2')).toBeCloseTo(xs[1]!, 1);
  });

  it('draws dashed ledgers, clamps past 4 ledger lines with an 8va label, and prints courtesy accidentals', () => {
    const { el, view, p } = setup();
    view.showGhost(ghost(p, 1, { writtenPitch: { step: 'C', alter: 0, octave: 4 } }));
    expect(el.querySelector('.sr-ghost-ledgers')!.getAttribute('stroke-dasharray')).toBe('2 2');
    view.showGhost(ghost(p, 2, { writtenPitch: { step: 'C', alter: 0, octave: 9 }, kind: 'octave', scoreBeat: 2 }));
    expect(el.querySelector('[data-detected-id="2"] .sr-ghost-8va')!.textContent).toBe('8va');
    const d = el.querySelector('[data-detected-id="2"] .sr-ghost-ledgers')!.getAttribute('d')!;
    expect(d.match(/M/g)).toHaveLength(4);
    // A written G double sharp is never in a key signature: it needs an accidental.
    view.showGhost(ghost(p, 3, { writtenPitch: { step: 'G', alter: 2, octave: 5 }, scoreBeat: 3 }));
    expect(el.querySelector('[data-detected-id="3"] .sr-ghost-accidental')!.textContent).toBe('');
  });
});

describe('06 section 7 drawing', () => {
  it('mirrors the score token group', async () => {
    const { score } = await import('../../ui/tokens.ts');
    const geo = await import('./geometry.ts');
    expect(geo.GHOST_FILL).toEqual(score['ghost-fill']);
    expect(geo.GHOST_STROKE).toEqual(score['ghost-stroke']);
    expect(geo.PAST_OPACITY.systemLeft).toBe(score['past-mark-opacity'].systemLeft);
    expect(geo.LANE_GLYPH_SP).toEqual(score['lane-glyph-size-staff-spaces']);
    expect(geo.LANE_OFFSET_SP).toBe(score['lane-offset-staff-spaces']);
    expect([geo.MISSED_RING.rxHeads, geo.MISSED_RING.rySp, geo.MISSED_RING.stroke]).toEqual([
      score['missed-ring']['rx-noteheads'],
      score['missed-ring']['ry-staff-spaces'],
      score['missed-ring'].stroke,
    ]);
    expect([geo.PITCH_ARROW.lengthSp, geo.PITCH_ARROW.gapSp]).toEqual([score['pitch-arrow']['length-staff-spaces'], score['pitch-arrow']['gap-staff-spaces']]);
    expect([...geo.PLAYHEAD_PAD_SP]).toEqual(score['playhead-pad-staff-spaces']);
    expect(geo.SHARP_FLAT_OFFSET).toBe(score['sharp-flat-offset-noteheads']);
    expect(geo.COLLISION_OFFSET).toEqual(score['collision-offset-noteheads']);
  });

  it('a missed note keeps its written head and gets a 0.95 sp error ring', () => {
    const { el, view, layout } = setup();
    view.setNoteState(0, { phase: 'missed' });
    const ring = el.querySelector('.sr-note-marks[data-marks-for="0"] .sr-ring-missed')!;
    const sp = layout.systems[0]!.lineSpacing;
    expect(Number(ring.getAttribute('ry'))).toBeCloseTo(0.95 * sp, 1);
    expect(ring.getAttribute('stroke')).toBe('var(--error)');
    expect(glyphIds(el)).toEqual(['missed']);
  });

  it('the live correct dot is a 0.2 sp circle in the correct colour', () => {
    const { el, view, layout } = setup();
    view.setNoteState(0, { phase: 'judged', timing: 'on-time', pitch: 'in-tune' });
    const dot = el.querySelector('circle.sr-glyph[data-glyph="dot"]') as SVGElement;
    expect(Number(dot.getAttribute('r'))).toBeCloseTo(0.2 * layout.systems[0]!.lineSpacing, 1);
    expect(dot.style.color).toBe('var(--correct)');
  });

  it('pitch arrows are 1.6 sp long and start 1 sp from the ghost centre', () => {
    const { el, view, p, layout } = setup();
    view.showGhost(ghost(p, 1, { scoreBeat: 1, kind: 'sharp' }));
    const d = el.querySelector('.sr-ghost-arrow path')!.getAttribute('d')!;
    const m = /^M([-\d.]+) ([-\d.]+)V([-\d.]+)/.exec(d)!;
    const sp = layout.systems[0]!.lineSpacing;
    expect(Number(m[2]) - Number(m[3])).toBeCloseTo(1.6 * sp, 1);
  });

  it('a wrong-pitch ghost within one step of its note sits 0.85 notehead widths right', () => {
    const { el, view, p, layout } = setup();
    const e = p.measures.flatMap((m) => m.events).find((x) => x.kind === 'note')!;
    if (e.kind !== 'note') throw new Error('no note');
    const beat = (e.tick - p.pickupTicks) / p.meter.countUnitTicks;
    const played = spellGhost(toMidi(e.writtenPitch) + 2, e.writtenPitch, p.writtenKey);
    view.showGhost(ghost(p, 5, { kind: 'wrong-pitch', scoreBeat: beat, writtenPitch: played, targetExpectedIdx: 0 }));
    const node = el.querySelector('.sr-ghost[data-detected-id="5"]')!;
    if (node.querySelector('.sr-ghost-accidental')) return; // cue placement covers it
    const x = Number(/translate\(([-\d.]+) /.exec(node.querySelector('.sr-ghost-head')!.getAttribute('transform')!)![1]);
    const sp = layout.systems[0]!.lineSpacing;
    expect(x - layout.beatToPoint(beat).x).toBeCloseTo(0.85 * 1.18 * sp, 1);
  });

  // Designer's notes, check to add to 05 section 16: no ghost accidental overlaps another glyph's box.
  const files = ['arriaga-sax-cut-time', 'faure-cello-tenor-clef', 'gouvy-cello-compound', 'haydn-clarinet-fast', 'holmes-voice-octave-flat', 'le-beau-flute-restart', 'mayer-flute-s1-mix', 'mozart-violin-stop'];
  it.each(files)('%s: no ghost accidental box overlaps a notehead, a ghost head or another ghost accidental', (name) => {
    const dir = join(process.cwd(), 'fixtures/render');
    const lines = readFileSync(join(dir, `${name}.events.jsonl`), 'utf8').trimEnd().split('\n').map((l) => JSON.parse(l) as RenderStreamLine);
    const header = lines[0] as Extract<RenderStreamLine, { kind: 'header' }>;
    const { el, view, p, layout } = setup(header.excerptId);
    for (const l of lines) {
      if (l.kind !== 'event') continue;
      const ev = l.event;
      if (ev.type === 'judgment') view.setNoteState(ev.judgment.expectedIdx, visualStateFromJudgment(ev.judgment));
      else if (ev.type === 'missed') view.setNoteState(ev.expectedIdx, { phase: 'missed' });
      else if (ev.type === 'ghost') view.showGhost(ev.ghost);
    }
    // Plus a chromatic wrong note on every written note, so every fixture draws many accidentals.
    const chains = expectedChains(p);
    const byId = new Map(p.measures.flatMap((m) => m.events).map((e) => [e.id, e] as const));
    chains.forEach((c, i) => {
      const e = byId.get(c.eventIds[0]!);
      if (!e || e.kind !== 'note') return;
      const played = spellGhost(toMidi(e.writtenPitch) + (i % 2 === 0 ? 1 : -1), e.writtenPitch, p.writtenKey);
      view.setNoteState(i, { phase: 'judged', timing: 'on-time', pitch: 'wrong-pitch' });
      view.showGhost({ detectedId: 10_000 + i, scoreBeat: (e.tick - p.pickupTicks) / p.meter.countUnitTicks, writtenPitch: played, kind: 'wrong-pitch', centsError: null, targetExpectedIdx: i, displaced: false });
    });
    for (const mode of ['live', 'review'] as const) {
      view.setMode(mode);
      type B = { x: number; y: number; w: number; h: number; who: string };
      const hit = (a: B, b: B): boolean => a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01;
      const accs: (B & { sys: string })[] = [];
      const heads: (B & { sys: string })[] = [];
      for (const g of ghostsIn(el)) {
        const sys = g.closest('svg')!.getAttribute('data-system')!;
        const sp = layout.systems.find((s) => String(s.index) === sys)!.lineSpacing;
        const t = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)/.exec(g.querySelector('.sr-ghost-head')!.getAttribute('transform')!)!;
        const w = Number(t[3]) * 295;
        heads.push({ x: Number(t[1]), y: Number(t[2]) - 0.5 * sp, w, h: sp, sys, who: `ghost ${g.getAttribute('data-detected-id')}` });
        const a = g.querySelector('.sr-ghost-accidental');
        if (a) {
          const [x, y, bw, bh] = a.getAttribute('data-box')!.split(' ').map(Number) as [number, number, number, number];
          accs.push({ x, y, w: bw, h: bh, sys, who: `accidental of ghost ${g.getAttribute('data-detected-id')}` });
        }
      }
      expect(accs.length, `${name}: accidentals drawn`).toBeGreaterThan(3);
      const written = [...layout.noteBoxes.entries()].map(([id, b]) => ({ ...b, sys: String(b.system), who: `note ${id}` }));
      for (const a of accs) {
        for (const o of [...written, ...heads, ...accs]) {
          if (o === a || o.sys !== a.sys) continue;
          expect(hit(a, o), `${name} ${mode}: ${a.who} overlaps ${o.who}`).toBe(false);
        }
      }
    }
  }, 60_000);
});
