// @vitest-environment jsdom
// D3 ScoreFrame controller against the real notation module (VexScoreView + SvgOverlay): slots, half-page turns from
// the playhead, system numbers and the wrap bar, freeze and scale with zero VexFlow renders, and re-layout that keeps
// the overlay state (04 §4.2 to §4.4, §6.7 item 4; 05 §7 items 3 and 6).
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ExcerptDoc, PreparedExcerpt } from '../../core/types.ts';
import * as notationModule from '../../notation/index.ts';
import { fixtureDoc } from '../../notation/testing/corpus-node.ts';
import { barsExcerpt, FRAME_FIXTURE_ID } from '../../../e2e/notation/score-frame-fixture.ts';
import { GUTTER_PX, ScoreFrameController, readInsets } from './controller.ts';
import { bindNotation } from './notation-binding.ts';

const notation = bindNotation(notationModule);
let doc: ExcerptDoc;
beforeAll(() => {
  doc = fixtureDoc(FRAME_FIXTURE_ID);
});

const hosts: HTMLElement[] = [];
function frame(opts: { reducedMotion?: boolean; onSlotsChange?: (s: number[], n: number) => void } = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  hosts.push(host);
  const reduced = opts.reducedMotion ?? true;
  const c = new ScoreFrameController(host, notation, {
    appearance: { reducedMotion: () => reduced, highContrast: () => false },
    ...(opts.onSlotsChange ? { onSlotsChange: opts.onSlotsChange } : {}),
  });
  return { host, c };
}
afterEach(() => {
  for (const h of hosts.splice(0)) h.remove();
  document.documentElement.removeAttribute('data-score-frozen');
});

/** 04 §4.3 table rows as layout args (4/4 at 120 bpm: 2 bars = 8 beats = 4 s per xs system). */
const PHONE_APP = { viewport: { width: 390, height: 844 }, insets: { top: 47, bottom: 34 }, widthPx: 390, bpm: 120 };
const PHONE_TAB = { viewport: { width: 390, height: 660 }, insets: { top: 0, bottom: 34 }, widthPx: 390, bpm: 120 };
const LANDSCAPE = { viewport: { width: 844, height: 340 }, insets: { top: 0, bottom: 21 }, widthPx: 750, bpm: 120 };
const IPAD = { viewport: { width: 1180, height: 760 }, insets: { top: 0, bottom: 0 }, widthPx: 1180, bpm: 120 };

function lay(c: ScoreFrameController, p: PreparedExcerpt, args: typeof PHONE_APP) {
  return c.layout(p, args, notation.tickablesPerBar(p));
}

const lines = (host: HTMLElement) => [...host.querySelectorAll('.sf-line')].map((e) => e.getAttribute('data-line'));
const wraps = (host: HTMLElement) => [...host.querySelectorAll('.sf-line')].map((e) => e.getAttribute('data-wrap') === 'true');
const domSlots = (host: HTMLElement) => [...host.querySelectorAll('.sr-slot')].map((e) => Number(e.getAttribute('data-system')));

describe('slots and page turns (04 §4.3 worked cases)', () => {
  it('390×844 app, 12 bars: 6 systems in 5 slots, one swap entering system 3', () => {
    const p = barsExcerpt(doc, 12);
    const { host, c } = frame();
    const info = lay(c, p, PHONE_APP);
    expect(info.plan.row.id).toBe('xs');
    expect(info.systemCount).toBe(6);
    expect(info.plan.slots).toBe(5);
    expect(info.pages.turns).toBe(true);
    expect(info.scoreWidthPx).toBe(390 - GUTTER_PX);
    expect(host.querySelectorAll('svg.sr-system')).toHaveLength(6);
    expect(domSlots(host)).toEqual([0, 1, 2, 3, 4]);
    expect(lines(host)).toEqual(['1', '2', '3', '4', '5']);

    const renders = c.view.renderCount;
    c.freeze({ width: 390, height: 763 });
    c.setPlayhead(0);
    c.setPlayhead(16); // enter system 3 (1-based)
    expect(c.slotSystems()).toEqual([0, 1, 2, 3, 4]);
    c.setPlayhead(16.8); // + 400 ms at 120 bpm
    expect(c.slotSystems()).toEqual([5, 1, 2, 3, 4]);
    expect(domSlots(host)).toEqual([5, 1, 2, 3, 4]);
    expect(lines(host)).toEqual(['6', '2', '3', '4', '5']);
    c.setPlayhead(47);
    expect(c.slotSystems()).toEqual([5, 1, 2, 3, 4]);
    expect(c.view.renderCount).toBe(renders);
  });

  it('390×660 tab, 12 bars: v = 4, two swaps, the wrap bar marks the slot of the next line', () => {
    const p = barsExcerpt(doc, 12);
    const changes: number[][] = [];
    const { host, c } = frame({ onSlotsChange: (s) => changes.push(s) });
    const info = lay(c, p, PHONE_TAB);
    expect(info.plan.slots).toBe(4);
    c.freeze({ width: 390, height: 626 });
    c.setPlayhead(17);
    expect(c.slotSystems()).toEqual([4, 1, 2, 3]);
    expect(wraps(host)).toEqual([false, false, false, false]); // current 3, next 4 directly below
    c.setPlayhead(24.5); // entered system 4; its swap is not due yet
    expect(c.slotSystems()).toEqual([4, 1, 2, 3]);
    expect(wraps(host)).toEqual([true, false, false, false]); // next (5) is in slot 1, not below slot 4
    c.setPlayhead(24.8);
    expect(c.slotSystems()).toEqual([4, 5, 2, 3]);
    c.setPlayhead(33); // system 5, next 6 directly below
    expect(wraps(host)).toEqual([false, false, false, false]);
    expect(changes).toEqual([
      [0, 1, 2, 3],
      [4, 1, 2, 3],
      [4, 5, 2, 3],
    ]);
  });

  it('844×340 landscape tab, 12 bars: sm-short, 3 systems in 2 slots, one swap 400 ms into system 2', () => {
    const p = barsExcerpt(doc, 12);
    const { c } = frame();
    const info = lay(c, p, LANDSCAPE);
    expect(info.plan.row.id).toBe('sm-short');
    expect(info.systemCount).toBe(3);
    expect(info.plan.slots).toBe(2);
    c.freeze({ width: 750, height: 275 });
    c.setPlayhead(16.79);
    expect(c.slotSystems()).toEqual([0, 1]);
    c.setPlayhead(16.8);
    expect(c.slotSystems()).toEqual([2, 1]);
  });

  it('1180×760 iPad, 12 bars: 3 systems in 4 slots, no turns, no numbers, full width', () => {
    const p = barsExcerpt(doc, 12);
    const { host, c } = frame();
    const info = lay(c, p, IPAD);
    expect(info.plan.row.id).toBe('lg');
    expect(info.systemCount).toBe(3);
    expect(info.plan.slots).toBe(4);
    expect(info.pages.turns).toBe(false);
    expect(info.scoreWidthPx).toBe(1180);
    expect(host.getAttribute('data-turns')).toBe('false');
    expect(lines(host)).toEqual([null, null, null]);
    c.setPlayhead(45);
    expect(c.slotSystems()).toEqual([0, 1, 2]);
  });

  it('a playhead moved back (or cleared) restores the earlier slots without a render', () => {
    const p = barsExcerpt(doc, 12);
    const { c } = frame();
    lay(c, p, PHONE_TAB);
    const renders = c.view.renderCount;
    c.setPlayhead(30);
    expect(c.slotSystems()).toEqual([4, 5, 2, 3]);
    c.setPlayhead(2);
    expect(c.slotSystems()).toEqual([0, 1, 2, 3]);
    c.setPlayhead(null);
    expect(c.slotSystems()).toEqual([0, 1, 2, 3]);
    expect(c.view.renderCount).toBe(renders);
  });

  it('system numbers add no text node to the frame (CSS draws them from data-line; 04 §6.7 item 4)', () => {
    const p = barsExcerpt(doc, 12);
    const { host, c } = frame();
    lay(c, p, PHONE_TAB);
    c.freeze({ width: 390, height: 626 });
    c.setPlayhead(25);
    const own = [...host.children, ...host.querySelectorAll('.sf-stage, .sf-gutter, .sf-gutter *, .sf-fade, .sf-fade *')];
    const textNodes = own.flatMap((e) => [...e.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE));
    expect(textNodes).toHaveLength(0);
    expect(lines(host)).toEqual(['5', '6', '3', '4']);
  });
});

describe('arrangement: natural-order scroll for scan and review on phones', () => {
  it("'all' shows every system in order and counts as no page turn; freeze resets to slots 1..v", () => {
    const p = barsExcerpt(doc, 12);
    const { host, c } = frame();
    lay(c, p, PHONE_TAB);
    c.setArrangement('all');
    expect(host.getAttribute('data-arrangement')).toBe('all');
    expect(domSlots(host)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(lines(host)).toEqual(['1', '2', '3', '4', '5', '6']);
    c.setPlayhead(30);
    expect(c.slotSystems()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(wraps(host).some(Boolean)).toBe(false);
    c.setPlayhead(null);
    c.freeze({ width: 390, height: 626 });
    expect(c.arrangement).toBe('slots');
    expect(domSlots(host)).toEqual([0, 1, 2, 3]);
  });

  it('scan and take share one geometry: switching arrangement never re-renders', () => {
    const p = barsExcerpt(doc, 10);
    const { c } = frame();
    const info = lay(c, p, PHONE_TAB);
    const before = c.view.renderCount;
    const boxes = [...info.layout.noteBoxes.entries()];
    c.setArrangement('all');
    c.setArrangement('slots');
    expect(c.view.renderCount).toBe(before);
    expect([...c.view.layout!.noteBoxes.entries()]).toEqual(boxes);
  });
});

describe('freeze and scale (04 §4.4, 05 §7 item 3)', () => {
  it('a resize while frozen scales the stage with one transform and renders nothing', () => {
    const p = barsExcerpt(doc, 12);
    const { host, c } = frame();
    lay(c, p, PHONE_TAB);
    c.freeze({ width: 390, height: 626 });
    expect(host.getAttribute('data-frozen')).toBe('true');
    expect(document.documentElement.getAttribute('data-score-frozen')).toBe('true');
    const renders = notationModule.vexflowRenderCount();
    const r = c.resize({ width: 390, height: 548 });
    expect(r).toEqual({ scale: 548 / 626, orientationChanged: false });
    const stage = host.querySelector<HTMLElement>('.sf-stage')!;
    expect(stage.style.transform).toBe(`scale(${Math.round((548 / 626) * 1e6) / 1e6})`);
    expect(c.resize({ width: 844, height: 340 })?.orientationChanged).toBe(true);
    expect(c.resize({ width: 390, height: 626 })).toEqual({ scale: 1, orientationChanged: false });
    expect(stage.style.transform).toBe('');
    expect(notationModule.vexflowRenderCount()).toBe(renders);
    expect(() => lay(c, p, PHONE_TAB)).toThrow(/frozen/);
    expect(() => c.relayout({ widthPx: 300 })).toThrow(/frozen/);
  });

  it('unfrozen frames do not scale on resize; unfreeze lifts the touch rules', () => {
    const p = barsExcerpt(doc, 8);
    const { host, c } = frame();
    lay(c, p, PHONE_TAB);
    expect(c.resize({ width: 300, height: 300 })).toBeNull();
    c.freeze({ width: 390, height: 626 });
    c.unfreeze();
    expect(host.hasAttribute('data-frozen')).toBe(false);
    expect(document.documentElement.hasAttribute('data-score-frozen')).toBe(false);
  });

  it('re-layout outside a take keeps mode, note states, ghosts and the playhead', () => {
    const p = barsExcerpt(doc, 12);
    const { host, c } = frame();
    lay(c, p, PHONE_TAB);
    c.setMode('review');
    c.setNoteState(0, { phase: 'judged', timing: 'late', pitch: 'in-tune' });
    const e = p.measures[0]!.events.find((x) => x.kind === 'note')!;
    if (e.kind !== 'note') throw new Error('no note');
    c.showGhost({ detectedId: 7, scoreBeat: 0.2, writtenPitch: e.writtenPitch, kind: 'late', centsError: null, targetExpectedIdx: 0, displaced: false });
    c.setPlayhead(30);
    const info = c.relayout({ viewport: { width: 844, height: 340 }, insets: { top: 0, bottom: 21 }, widthPx: 750 })!;
    expect(info.plan.row.id).toBe('sm-short');
    const snap = c.view.snapshot();
    expect(snap.mode).toBe('review');
    expect(snap.states.get(0)).toEqual({ phase: 'judged', timing: 'late', pitch: 'in-tune' });
    expect(snap.ghosts.map((g) => g.detectedId)).toEqual([7]);
    expect(snap.playhead).toBe(30);
    expect(host.querySelector('[data-expected-idx="0"]')!.getAttribute('data-timing')).toBe('late');
    expect(host.querySelector('.sr-ghost[data-detected-id="7"]')).not.toBeNull();
  });
});

describe('crossfade (04 §4.3 rule 4)', () => {
  it('fades only the replaced slot over 160 ms, and is instant with reduced motion', () => {
    const calls: { el: Element; frames: Keyframe[]; opts: KeyframeAnimationOptions }[] = [];
    const finishers: (() => void)[] = [];
    const animate = vi.fn(function (this: Element, frames: Keyframe[], opts: KeyframeAnimationOptions) {
      calls.push({ el: this, frames, opts });
      const anim = { onfinish: null as null | (() => void), cancel: vi.fn() };
      finishers.push(() => anim.onfinish?.());
      return anim as unknown as Animation;
    });
    (Element.prototype as unknown as { animate: unknown }).animate = animate;
    try {
      const p = barsExcerpt(doc, 12);
      const { host, c } = frame({ reducedMotion: false });
      lay(c, p, PHONE_TAB);
      c.setPlayhead(17);
      expect(calls).toHaveLength(2);
      expect(calls.every((x) => x.opts.duration === 160)).toBe(true);
      const outgoing = host.querySelector('.sf-fade .sf-fade-out')!;
      expect(outgoing.querySelector('svg.sr-system')!.getAttribute('data-system')).toBe('0');
      expect(calls[0]!.el).toBe(outgoing);
      expect(calls[1]!.el).toBe(host.querySelector('.sr-slot[data-slot="0"]'));
      expect(outgoing.querySelectorAll('[id]')).toHaveLength(0);
      finishers.forEach((f) => f());
      expect(host.querySelector('.sf-fade')!.childNodes).toHaveLength(0);

      const reduced = frame({ reducedMotion: true });
      lay(reduced.c, p, PHONE_TAB);
      calls.length = 0;
      reduced.c.setPlayhead(17);
      expect(calls).toHaveLength(0);
      expect(reduced.c.slotSystems()).toEqual([4, 1, 2, 3]);
    } finally {
      delete (Element.prototype as unknown as { animate?: unknown }).animate;
    }
  });
});

describe('insets', () => {
  it('reads the resolved --sai-top and --sai-bottom through a probe', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);
    const style = document.createElement('style');
    style.textContent = '.sf-inset-probe { padding-top: 47px; padding-bottom: 34px; }';
    document.head.appendChild(style);
    try {
      expect(readInsets(host)).toEqual({ top: 47, bottom: 34 });
      expect(host.querySelector('.sf-inset-probe')).toBeNull();
    } finally {
      style.remove();
    }
  });
});

describe('bar taps', () => {
  it('finds the bar from a tap on the slot: VexFlow gives its svg pointer-events none, so taps land on the slot', () => {
    const { host, c } = frame();
    lay(c, barsExcerpt(doc, 12), IPAD);
    const slot = host.querySelector<HTMLElement>('.sr-slot[data-system="0"]')!;
    const svg = slot.querySelector<SVGSVGElement>('svg.sr-system')!;
    expect(svg.getAttribute('pointer-events')).toBe('none');
    const w = Number(svg.getAttribute('width'));
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, right: w, bottom: 100, width: w, height: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const fromSvg = c.barAtClient(svg, w - 2);
    expect(fromSvg).not.toBeNull();
    expect(c.barAtClient(slot, w - 2)).toBe(fromSvg);
    expect(c.barAtClient(host, w - 2)).toBeNull();
  });
});
