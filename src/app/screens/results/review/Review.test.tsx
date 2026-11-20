// @vitest-environment jsdom
// D8b <Review> against the real notation module (VexScoreView + SvgOverlay) in jsdom: review rendering of the final
// alignment, heat strip, replay bracket and tails, the note inspector (click, Enter, Esc), the roving tabindex and
// arrow keys, the slip stepper and its filters from the counts line, My marks / Clean score (C), and the session-bound
// renderer.
import type React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createStore } from 'zustand/vanilla';
import type { AppSettings } from '../../../../core/types.ts';
import * as notationModule from '../../../../notation/index.ts';
import { initialSessionView, type SessionView } from '../../../../session/index.ts';
import { defaultAppSettings } from '../../../../store/defaults.ts';
import { act, key, mount, type Mounted } from '../../../../ui/primitives/test-render.ts';
import { bindNotation, type FrameNotation } from '../../../../ui/score-frame/index.ts';
import { createReviewBus } from './bus.ts';
import { buildReview } from './model.ts';
import { Review } from './Review.tsx';
import { createReviewRenderer } from './SessionReview.tsx';
import { cfg, DISPLACED_IDS, EXTRA_ID, LATE, MISSED, reviewFixture, SHARP, spell, WRONG } from './test-fixture.ts';

const bound = bindNotation(notationModule);
const notation: FrameNotation = { ...bound, ensureNotationFonts: () => Promise.resolve() };
const loadNotation = () => Promise.resolve(notation);
const VIEWPORT = { width: 1280, height: 720 };
const INSETS = { top: 0, bottom: 0 };

// jsdom has no layout: give the frame host a laptop-sized content box so the systems are drawn at real widths.
const realWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('sf-host') ? 900 : 0;
    },
  });
});
afterAll(() => {
  if (realWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', realWidth);
});

/** Click that works on SVG groups too (jsdom's SVGElement has no click()). */
function click(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

const mounted: Mounted[] = [];
afterEach(() => {
  for (const m of mounted.splice(0)) m.unmount();
  document.body.replaceChildren();
});

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

async function render(opts: { showNumbers?: boolean; bus?: ReturnType<typeof createReviewBus>; keyboardShortcuts?: boolean; clean?: boolean; highlightBar?: number | null; onBarTap?: (i: number) => void; toolbarEnd?: React.ReactNode } = {}) {
  const fx = reviewFixture();
  const m = mount(
    <Review
      record={fx.record}
      prepared={fx.prepared}
      expected={fx.expected}
      tolerances={fx.tolerances}
      configs={cfg}
      loadNotation={loadNotation}
      spell={spell}
      viewport={VIEWPORT}
      insets={INSETS}
      reducedMotion={() => true}
      highContrast={() => false}
      {...opts}
    />,
  );
  mounted.push(m);
  await flush();
  const model = buildReview({ record: fx.record, prepared: fx.prepared, expected: fx.expected, instrument: cfg.instrumentById.flute!, spell, tolerances: fx.tolerances });
  return { m, fx, model, root: m.container.querySelector<HTMLElement>('[data-testid="review"]')! };
}

const noteEl = (root: HTMLElement, idx: number) => root.querySelector<SVGGElement>(`.sr-note[data-expected-idx="${idx}"]`)!;
const inspector = () => document.body.querySelector<HTMLElement>('[data-testid="note-inspector"]');
const inspectorLines = () => [...(inspector()?.querySelectorAll('p') ?? [])].map((p) => p.textContent);

describe('<Review> rendering', () => {
  it('draws the final alignment in review mode: note states, every ghost, heat strip, bracket and tails', async () => {
    const { root, model } = await render();
    expect(noteEl(root, MISSED).getAttribute('data-phase')).toBe('missed');
    expect(noteEl(root, LATE).getAttribute('data-timing')).toBe('late');
    expect(noteEl(root, SHARP).getAttribute('data-pitch')).toBe('sharp');
    expect(noteEl(root, WRONG).getAttribute('data-pitch')).toBe('wrong-pitch');
    const ghostIds = [...root.querySelectorAll('.sr-ghost[data-detected-id]')].map((g) => Number(g.getAttribute('data-detected-id')));
    expect(new Set(ghostIds)).toEqual(new Set(model.ghosts.map((g) => g.detectedId)));
    expect(ghostIds).toContain(EXTRA_ID);
    for (const id of DISPLACED_IDS) expect(ghostIds).toContain(id);

    const cells = [...root.querySelectorAll('g.rv-heat-cell')];
    expect(cells.map((c) => Number(c.getAttribute('data-bar')))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const bar1 = cells[0]!;
    expect(bar1.getAttribute('data-level')).toBe('2');
    expect(bar1.getAttribute('aria-label')).toBe('Bar 1: 2 of 5 notes off (1 late, 1 sharp)');
    expect(bar1.getAttribute('tabindex')).toBe('0');
    expect(bar1.querySelector('.rv-heat-hatch')?.getAttribute('fill')).toMatch(/^url\(#rv[a-zA-Z0-9]*-hatch-2-\d+\)$/);
    expect(cells[1]!.getAttribute('aria-hidden')).toBe('true');
    expect(cells[5]!.querySelector('.rv-heat-solid')).not.toBeNull();
    // Each heat cell sits above its own bar: increasing x within a system.
    const xs = cells.slice(0, 2).map((c) => Number(c.querySelector('.rv-heat-track')!.getAttribute('x')));
    expect(xs[1]).toBeGreaterThan(xs[0]!);

    const brackets = root.querySelectorAll('g.rv-bracket');
    expect(brackets.length).toBeGreaterThanOrEqual(1);
    expect(root.querySelector('.rv-bracket-label')?.textContent).toBe('bars 1–1 replayed');
    // A tail is drawn wherever the played note outlasts its own notehead; every quarter or longer does.
    const tailIds = new Set([...root.querySelectorAll('rect.rv-tail')].map((t) => Number(t.getAttribute('data-detected-id'))));
    for (const t of model.tails) if (t.durBeats >= 0.9) expect(tailIds.has(t.detectedId)).toBe(true);
    for (const id of tailIds) expect(model.tails.some((t) => t.detectedId === id)).toBe(true);
    expect(root.querySelectorAll('rect.rv-tail-replay').length).toBeGreaterThanOrEqual(1);
  });

  it('notes are one tab stop with a roving tabindex and spoken labels (04 §8.3)', async () => {
    const { root, model } = await render();
    const buttons = [...root.querySelectorAll('[role="button"][data-rv-idx]')];
    expect(buttons).toHaveLength(model.notes.length);
    expect(buttons.filter((b) => b.getAttribute('tabindex') === '0')).toHaveLength(1);
    expect(noteEl(root, WRONG).getAttribute('aria-label')).toBe('Bar 4, beat 1, written B flat 4 half note, you played B natural 4, on time, wrong note');
  });
});

describe('<Review> interactions', () => {
  it('click opens the inspector for what was played versus written; Esc closes it', async () => {
    const { root } = await render();
    click(noteEl(root, LATE));
    expect(inspectorLines()).toEqual(['Bar 1, beat 2', 'Written C5 (eighth)', 'Played C5, 120 ms late (about a sixteenth)', 'Late (partial credit)']);
    expect(root.querySelector('rect.rv-select-ring')).not.toBeNull();
    key(document, 'Escape');
    expect(inspector()).toBeNull();
  });

  it('a click on an extra ghost inspects the extra', async () => {
    const { root } = await render();
    click(root.querySelector(`.sr-ghost[data-detected-id="${EXTRA_ID}"]`)!);
    expect(inspectorLines()).toEqual(['Played at bar 4, beat 4', 'Played D5, extra note']);
  });

  it('Enter on a focused note opens the inspector; ← / → move between notes, ↓ to the next system', async () => {
    const { root } = await render();
    const first = noteEl(root, 0);
    act(() => (first as unknown as HTMLElement).focus());
    key(first, 'ArrowRight');
    expect(document.activeElement).toBe(noteEl(root, 1));
    expect(noteEl(root, 1).getAttribute('tabindex')).toBe('0');
    expect(noteEl(root, 0).getAttribute('tabindex')).toBe('-1');
    key(noteEl(root, 1), 'Enter');
    expect(inspectorLines()[0]).toBe('Bar 1, beat 2');
    key(noteEl(root, 1), 'ArrowLeft');
    expect(document.activeElement).toBe(noteEl(root, 0));
    // Inspector follows the focus while open.
    expect(inspectorLines()[0]).toBe('Bar 1, beat 1');
    const sys0 = noteEl(root, 0).getAttribute('data-system');
    key(noteEl(root, 0), 'ArrowDown');
    const now = document.activeElement as Element;
    expect(now.getAttribute('data-system')).not.toBe(sys0);
    key(now, 'ArrowUp');
    expect(document.activeElement).toBe(noteEl(root, 0));
  });

  it('the slip stepper walks error notes in time order (buttons and Shift+→ / Shift+←)', async () => {
    const { root } = await render();
    const next = root.querySelector<HTMLButtonElement>('[data-testid="next-slip"]')!;
    const prev = root.querySelector<HTMLButtonElement>('[data-testid="prev-slip"]')!;
    click(next);
    expect(inspectorLines()[0]).toBe('Bar 1, beat 2');
    expect(document.activeElement).toBe(noteEl(root, LATE));
    expect(root.querySelector('.rv-slip-count')?.textContent).toBe('1 of 10');
    click(next);
    expect(inspectorLines()[0]).toBe('Bar 1, beat 3');
    key(noteEl(root, SHARP), 'ArrowRight', { shiftKey: true });
    expect(inspectorLines()[0]).toBe('Bar 3, beat 1');
    expect(document.activeElement).toBe(noteEl(root, MISSED));
    key(noteEl(root, MISSED), 'ArrowLeft', { shiftKey: true });
    expect(document.activeElement).toBe(noteEl(root, SHARP));
    click(prev);
    click(prev);
    expect(inspectorLines()[0]).toBe('Bar 1, beat 2');
  });

  it('a count from the results panel restricts the stepper; "All slips" resets it', async () => {
    const bus = createReviewBus();
    const { root } = await render({ bus });
    act(() => bus.set('missed'));
    expect(root.getAttribute('data-filter')).toBe('missed');
    expect(root.querySelector('[data-testid="review-filter"]')?.textContent).toContain('Showing mistakes: missed');
    // The first slip of the set is shown at once.
    expect(inspectorLines()[0]).toBe('Bar 3, beat 1');
    expect(root.querySelector('.rv-slip-count')?.textContent).toBe('1 of 6');
    click(root.querySelector('[data-testid="next-slip"]')!);
    expect(inspectorLines()[0]).toBe('Bar 6, beat 1');
    click(root.querySelector('.rv-all-slips')!);
    expect(bus.get()).toBe('all');
    expect(root.querySelector('[data-testid="review-filter"]')).toBeNull();
    act(() => bus.set('rejudged'));
    expect(inspectorLines()[0]).toBe('Bar 3, beat 2.5');
  });

  it('C and the toggle switch between My take and Clean score', async () => {
    const { root, model } = await render();
    expect(root.querySelectorAll('.sr-ghost').length).toBe(model.ghosts.length);
    key(document, 'c');
    expect(root.getAttribute('data-show')).toBe('clean');
    expect(root.querySelectorAll('.sr-ghost').length).toBe(0);
    expect(root.querySelectorAll('g.rv-heat-cell').length).toBe(0);
    expect(noteEl(root, MISSED).getAttribute('data-phase')).toBeNull();
    // Notes stay navigable on the clean score.
    expect(root.querySelectorAll('[role="button"][data-rv-idx]').length).toBe(model.notes.length);
    const take = [...root.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((i) => i.value === 'take')!;
    click(take);
    expect(root.getAttribute('data-show')).toBe('take');
    expect(root.querySelectorAll('.sr-ghost').length).toBe(model.ghosts.length);
    expect(noteEl(root, MISSED).getAttribute('data-phase')).toBe('missed');
  });

  it('C does nothing with single-key shortcuts off', async () => {
    const { root } = await render({ keyboardShortcuts: false });
    key(document, 'c');
    expect(root.getAttribute('data-show')).toBe('take');
  });

  it('with numbers off the inspector drops cents and milliseconds', async () => {
    const { root } = await render({ showNumbers: false });
    click(noteEl(root, SHARP));
    expect(inspectorLines()).toEqual(['Bar 1, beat 3', 'Written G4 (quarter)', 'Played G4, on time', 'Sharp']);
  });
});

describe('createReviewRenderer', () => {
  function settingsStore(over: Partial<AppSettings['display']> = {}) {
    const base = defaultAppSettings();
    const s: AppSettings = { ...base, display: { ...base.display, ...over } };
    return { get: () => s, subscribe: () => () => {} };
  }

  it('renders the review for the session’s current excerpt, nothing for another attempt', async () => {
    const fx = reviewFixture();
    const session = createStore<SessionView>()(() => ({ ...initialSessionView(), state: 'results', prepared: fx.prepared, record: fx.record }));
    const render = createReviewRenderer({ configs: cfg, session, settings: settingsStore({ showCentsMs: false }), loadNotation, spell });
    const m = mount(<>{render(fx.record)}</>);
    mounted.push(m);
    await flush();
    const root = m.container.querySelector<HTMLElement>('[data-testid="review"]')!;
    expect(root).not.toBeNull();
    click(noteEl(root, LATE));
    expect(inspectorLines()[2]).toBe('Played C5, late');

    const other = mount(<>{render({ ...fx.record, id: 'other', excerptId: 'not-this-one' })}</>);
    mounted.push(other);
    await flush();
    expect(other.container.querySelector('[data-testid="review"]')).toBeNull();
  });
});

describe('<Review> redesign (06 sections 6.15, 7)', () => {
  it('correct notes stay plain ink with no lane mark; only slips are coloured', async () => {
    const { root, model } = await render();
    const correct = model.notes.filter((n) => n.state.phase === 'judged' && !n.state.timing?.match(/early|late/) && !n.state.pitch?.match(/sharp|flat|wrong|octave/));
    expect(correct.length).toBeGreaterThan(0);
    for (const n of correct) {
      expect(root.querySelector(`.sr-note-marks[data-marks-for="${n.idx}"] .sr-glyph`)).toBeNull();
      expect(noteEl(root, n.idx).classList.contains('n-correct')).toBe(false);
    }
    expect(root.querySelector('[data-glyph="check"]')).toBeNull();
    expect(noteEl(root, LATE).classList.contains('n-error')).toBe(true);
  });

  it('draws the review at the review staff space with the paper toolbar order', async () => {
    const { root } = await render({ toolbarEnd: <button type="button">Listen</button> });
    expect(root.querySelector('.sf-host')!.getAttribute('data-purpose')).toBe('review');
    const end = root.querySelector('.rv-toolbar-end')!;
    // "Show what we heard" (round 2), then the screen's own end.
    expect(end.textContent).toBe('Show what we heardListen');
    expect(root.querySelector('[data-testid="prev-slip"]')!.textContent).toBe('Previous mistake');
    expect(root.querySelector('[data-testid="next-slip"]')!.textContent).toBe('Next mistake');
  });

  it('not graded: the clean score with no marks, the void line, no switch and no stepper', async () => {
    const { root } = await render({ clean: true });
    expect(root.getAttribute('data-void')).toBe('true');
    expect(root.querySelector('[data-testid="review-void-line"]')!.textContent).toBe('Clean score. Nothing is marked when a try is not graded.');
    expect(root.querySelectorAll('.sr-ghost')).toHaveLength(0);
    expect(root.querySelectorAll('.n-error, .n-error-hollow')).toHaveLength(0);
    expect(root.querySelector('[data-testid="prev-slip"]')).toBeNull();
    expect(root.querySelector('[role="radiogroup"]')).toBeNull();
    expect(root.querySelector('.sf-host')!.hasAttribute('data-clean')).toBe(true);
  });

  it('washes the Listen bar by index', async () => {
    const { root } = await render({ highlightBar: 2 });
    const hl = root.querySelectorAll('.sf-hl-bar');
    expect(hl).toHaveLength(1);
    expect(hl[0]!.getAttribute('data-bar-index')).toBe('2');
  });

  it('a tap on a bar away from the notes reports its index; a tap on a note opens the inspector instead', async () => {
    const taps: number[] = [];
    const real = SVGElement.prototype.getBoundingClientRect;
    SVGElement.prototype.getBoundingClientRect = function (this: SVGElement) {
      const w = Number(this.getAttribute('width') ?? 0);
      return { left: 0, top: 0, right: w, bottom: 100, width: w, height: 100, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    };
    try {
      const { root, fx } = await render({ onBarTap: (i) => taps.push(i) });
      const svg = root.querySelector<SVGSVGElement>('svg.sr-system[data-system="0"]')!;
      const firstNote = noteEl(root, 0);
      const bar1Start = fx.prepared.measures[1]!;
      // A point just right of bar 2's first note: past every bar-1 note.
      const id = bar1Start.events.find((e) => e.kind === 'note')!.id;
      const notes = svg.querySelectorAll(`[data-event-id="${id}"]`);
      expect(notes.length).toBeGreaterThan(0);
      act(() => {
        svg.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: Number(svg.getAttribute('width')) - 2 }));
      });
      expect(taps.length).toBe(1);
      expect(taps[0]).toBeGreaterThan(0);
      click(firstNote);
      expect(taps.length).toBe(1);
      expect(inspector()).not.toBeNull();
    } finally {
      SVGElement.prototype.getBoundingClientRect = real;
    }
  });

  it('the session renderer shows a void take as the clean score', async () => {
    const fx = reviewFixture();
    const record = { ...fx.record, endReason: 'void' as const, judgments: [] };
    const session = createStore<SessionView>()(() => ({ ...initialSessionView(), state: 'results', prepared: fx.prepared, record }));
    const base = defaultAppSettings();
    const renderer = createReviewRenderer({ configs: cfg, session, settings: { get: () => base, subscribe: () => () => {} }, loadNotation, spell });
    const m = mount(<>{renderer(record)}</>);
    mounted.push(m);
    await flush();
    const root = m.container.querySelector<HTMLElement>('[data-testid="review"]')!;
    expect(root.getAttribute('data-void')).toBe('true');
    expect(root.querySelectorAll('.sr-ghost')).toHaveLength(0);
  });
});
