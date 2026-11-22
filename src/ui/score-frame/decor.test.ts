// @vitest-environment jsdom
// Score frame drawing additions (06 sections 6.12 and 7): staff space and page margins from the score tokens, the bar
// wash by index, the key-signature and first-note highlights, the count-in band (full ink), the starting-pitch dim, the downbeat pulse, clean-score
// mode and the bar under a point.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ExcerptDoc } from '../../core/types.ts';
import * as notationModule from '../../notation/index.ts';
import { fixtureDoc } from '../../notation/testing/corpus-node.ts';
import { barsExcerpt, FRAME_FIXTURE_ID } from '../../../e2e/notation/score-frame-fixture.ts';
import { score } from '../tokens.ts';
import { ScoreFrameController, purposeGeometry } from './controller.ts';
import { bindNotation } from './notation-binding.ts';

const notation = bindNotation(notationModule);
let doc: ExcerptDoc;
beforeAll(() => {
  doc = fixtureDoc(FRAME_FIXTURE_ID);
});

const hosts: HTMLElement[] = [];
function frame() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  hosts.push(host);
  const c = new ScoreFrameController(host, notation, { appearance: { reducedMotion: () => true, highContrast: () => false } });
  return { host, c };
}
afterEach(() => {
  for (const h of hosts.splice(0)) h.remove();
});

const DESKTOP = { viewport: { width: 1440, height: 900 }, insets: { top: 0, bottom: 0 }, widthPx: 1440 - 2 * 72, bpm: 72, heightPx: 700 };
const PHONE = { viewport: { width: 390, height: 844 }, insets: { top: 0, bottom: 0 }, widthPx: 390 - 2 * 12, bpm: 72, heightPx: 700 };

describe('staff space and margins from tokens', () => {
  it('take, read and review use the score staff-space tokens at desktop and phone widths', () => {
    const p = barsExcerpt(doc, 8);
    for (const [purpose, d, ph] of [
      ['take', score['staff-space'].takeDesktop, score['staff-space'].takePhone],
      ['read', score['staff-space'].readDesktop, score['staff-space'].readPhone],
      ['review', score['staff-space'].reviewDesktop, score['staff-space'].reviewPhone],
    ] as const) {
      const { c } = frame();
      expect(c.layout(p, { ...DESKTOP, purpose }, notation.tickablesPerBar(p)).plan.spPx).toBe(d);
      const { c: c2 } = frame();
      expect(c2.layout(p, { ...PHONE, purpose }, notation.tickablesPerBar(p)).plan.spPx).toBe(ph);
    }
  });

  it('a take at desktop draws 4 bars a system, on the phone 2 (06 section 10)', () => {
    const p = barsExcerpt(doc, 8);
    const { c } = frame();
    expect(c.layout(p, { ...DESKTOP, purpose: 'take' }, notation.tickablesPerBar(p)).plan.barsPerSystem).toEqual([4, 4]);
    const { c: c2 } = frame();
    expect(c2.layout(p, { ...PHONE, purpose: 'take' }, notation.tickablesPerBar(p)).plan.barsPerSystem).toEqual([2, 2, 2, 2]);
  });

  it('the read-through drops the verdict lane: 4 phone systems fit where the take keeps its lane', () => {
    const p = barsExcerpt(doc, 8);
    const sp = score['staff-space'].readPhone;
    const { host, c } = frame();
    const read = c.layout(p, { ...PHONE, purpose: 'read', heightPx: 4 * (12 * sp + 12) }, notation.tickablesPerBar(p));
    // 12 staff spaces and the 12 px gap; no 20 px lane (9.5 sp: 126 px a system, not 146).
    expect(read.plan.systemHeightPx).toBe(12 * sp + 12);
    expect(read.plan.slots).toBe(4);
    expect(host.querySelector<HTMLElement>('.sf-stage')!.style.getPropertyValue('--sf-system-h')).toBe(`${12 * sp + 12}px`);
    const { c: c2 } = frame();
    const take = c2.layout(p, { ...PHONE, purpose: 'take' }, notation.tickablesPerBar(p));
    expect(take.plan.systemHeightPx).toBe(12 * take.plan.spPx + 20 + 12);
    const { c: c3 } = frame();
    expect(c3.layout(p, { ...PHONE, purpose: 'review' }, notation.tickablesPerBar(p)).plan.systemHeightPx).toBe(12 * score['staff-space'].reviewPhone + 20 + 12);
  });

  it('page margins come from the score tokens', () => {
    expect(purposeGeometry('take', 1440)).toMatchObject({ marginBlock: score['page-margin'].desktop[0], marginInline: score['page-margin'].desktop[1] });
    expect(purposeGeometry('take', 390)).toMatchObject({ marginBlock: score['page-margin'].phone[0], marginInline: score['page-margin'].phone[1] });
    const { host, c } = frame();
    c.setMargins('take', 1440);
    expect(host.getAttribute('data-purpose')).toBe('take');
    expect(host.style.getPropertyValue('--sf-margin-inline')).toBe('72px');
    c.setMargins(null, 1440);
    expect(host.hasAttribute('data-purpose')).toBe(false);
  });

  it('without a purpose the 04 layout table is unchanged', () => {
    const p = barsExcerpt(doc, 8);
    const { c } = frame();
    const { heightPx: _h, ...args } = DESKTOP;
    void _h;
    expect(c.layout(p, args, notation.tickablesPerBar(p)).plan.spPx).toBe(11);
  });
});

describe('highlights', () => {
  it('washes one bar by index behind the ink, and moves or clears it', () => {
    const p = barsExcerpt(doc, 8);
    const { host, c } = frame();
    const info = c.layout(p, { ...DESKTOP, purpose: 'take' }, notation.tickablesPerBar(p));
    c.highlightBar(2);
    let bars = host.querySelectorAll('.sf-hl-bar');
    expect(bars).toHaveLength(1);
    expect(bars[0]!.closest('.sr-underlay')).not.toBeNull();
    expect(bars[0]!.getAttribute('data-bar-index')).toBe('2');
    expect(bars[0]!.getAttribute('fill')).toBe('var(--playhead-bar)');
    const sp = info.plan.spPx;
    expect(Number(bars[0]!.getAttribute('rx'))).toBeCloseTo(0.5 * sp, 1);
    c.highlightBar(5);
    bars = host.querySelectorAll('.sf-hl-bar');
    expect(bars).toHaveLength(1);
    expect(bars[0]!.closest('svg')!.getAttribute('data-system')).toBe('1');
    c.highlightBar(null);
    expect(host.querySelectorAll('.sf-hl-bar')).toHaveLength(0);
  });

  it('a re-layout keeps the highlights', () => {
    const p = barsExcerpt(doc, 8);
    const { host, c } = frame();
    c.layout(p, { ...DESKTOP, purpose: 'review' }, notation.tickablesPerBar(p));
    c.highlightBar(1);
    c.highlightFirstNote('G3');
    c.relayout({ widthPx: 900 });
    expect(host.querySelectorAll('.sf-hl-bar')).toHaveLength(1);
    expect(host.querySelector('.sf-hl-name')!.textContent).toBe('G3');
  });

  it('first note: a brass disc, the head in brass-ink and its name above; clearing restores the ink', () => {
    const p = barsExcerpt(doc, 8);
    const { host, c } = frame();
    c.layout(p, { ...DESKTOP, purpose: 'read' }, notation.tickablesPerBar(p));
    const first = p.measures.flatMap((m) => m.events).find((e) => e.kind === 'note')!;
    c.highlightFirstNote('F4');
    expect(host.querySelector('.sf-hl-disc')!.getAttribute('fill')).toBe('var(--brass-wash)');
    const name = host.querySelector('.sf-hl-name')!;
    expect(name.textContent).toBe('F4');
    const g = host.querySelector<SVGElement>(`[data-event-id="${first.id}"]`)!;
    expect(g.style.color).toBe('var(--brass-ink)');
    // The name sits above the disc.
    expect(Number(name.getAttribute('y'))).toBeLessThan(Number(host.querySelector('.sf-hl-disc')!.getAttribute('cy')));
    c.highlightFirstNote(null);
    expect(host.querySelector('.sf-hl-name')).toBeNull();
    expect(g.style.color).toBe('');
  });

  it('key signature: drawn from the rendered key signature box (nothing without layout boxes)', () => {
    const p = barsExcerpt(doc, 8);
    const { host, c } = frame();
    c.layout(p, { ...DESKTOP, purpose: 'read' }, notation.tickablesPerBar(p));
    // jsdom has no layout boxes: the highlight needs the browser (covered by the screenshots).
    c.highlightKeySignature(true);
    expect(host.querySelectorAll('.sf-hl-key').length).toBeLessThanOrEqual(1);
    c.highlightKeySignature(false);
    expect(host.querySelectorAll('.sf-hl-key')).toHaveLength(0);
  });
});

describe('count-in band', () => {
  it('shows the band slot in the top margin and hides it again; the band dims nothing (full ink from the first click)', () => {
    const p = barsExcerpt(doc, 8);
    const { host, c } = frame();
    c.layout(p, { ...DESKTOP, purpose: 'take' }, notation.tickablesPerBar(p));
    const slot = c.showBand(true)!;
    expect(slot.classList.contains('sf-band')).toBe(true);
    expect(slot.parentElement).toBe(host);
    expect(host.hasAttribute('data-band')).toBe(true);
    // The band's bottom is above the first system's ink by the count-band gap.
    const bottom = parseFloat(slot.style.getPropertyValue('--sf-band-bottom'));
    const sys0 = c.info!.layout.systems[0]!;
    expect(bottom).toBeLessThanOrEqual(sys0.staffTopY - 36 + 0.01);
    expect(host.hasAttribute('data-dim')).toBe(false);
    expect(c.showBand(false)).toBeNull();
    expect(host.hasAttribute('data-band')).toBe(false);
  });

  it('dims the score only on request (the starting pitch)', () => {
    const p = barsExcerpt(doc, 8);
    const { host, c } = frame();
    c.layout(p, { ...DESKTOP, purpose: 'take' }, notation.tickablesPerBar(p));
    c.dim(true);
    expect(host.hasAttribute('data-dim')).toBe(true);
    c.dim(false);
    expect(host.hasAttribute('data-dim')).toBe(false);
  });

  it('the first-note highlight clears to nothing (PLAN R70: no pulse at the downbeat)', () => {
    const p = barsExcerpt(doc, 8);
    const { host, c } = frame();
    c.layout(p, { ...DESKTOP, purpose: 'take' }, notation.tickablesPerBar(p));
    c.highlightFirstNote('C3');
    expect(host.querySelector('.sf-hl-disc')!.getAttribute('stroke')).toBe('var(--brass)');
    c.highlightFirstNote(null);
    expect(host.querySelector('.sf-hl-name')).toBeNull();
    expect(host.querySelector('.sf-hl-disc')).toBeNull();
    expect(host.querySelector('[data-brass]')).toBeNull();
    expect('pulseFirstNote' in c).toBe(false);
  });

  it('an empty first-note name keeps the ring without a name', () => {
    const p = barsExcerpt(doc, 8);
    const { host, c } = frame();
    c.layout(p, { ...DESKTOP, purpose: 'take' }, notation.tickablesPerBar(p));
    c.highlightFirstNote('');
    expect(host.querySelector('.sf-hl-disc')).toBeTruthy();
    expect(host.querySelector('.sf-hl-name')).toBeNull();
  });
});

describe('clean score and bar lookup', () => {
  it('clean mode drops every mark and ignores overlay calls until it is turned off', () => {
    const p = barsExcerpt(doc, 8);
    const { host, c } = frame();
    c.layout(p, { ...DESKTOP, purpose: 'review' }, notation.tickablesPerBar(p));
    c.setMode('review');
    c.setNoteState(0, { phase: 'judged', timing: 'late' });
    expect(host.querySelectorAll('.n-error')).not.toHaveLength(0);
    c.setClean(true);
    expect(host.querySelectorAll('.n-error')).toHaveLength(0);
    c.setNoteState(0, { phase: 'judged', timing: 'late' });
    c.setPlayhead(1);
    expect(host.querySelectorAll('.n-error')).toHaveLength(0);
    expect(host.querySelector('.sr-bar-tint')?.getAttribute('visibility') ?? 'hidden').toBe('hidden');
    c.setClean(false);
    c.setNoteState(0, { phase: 'judged', timing: 'late' });
    expect(host.querySelectorAll('.n-error')).not.toHaveLength(0);
  });

  it('maps an x in a system to the bar under it', () => {
    const p = barsExcerpt(doc, 8);
    const { c } = frame();
    const info = c.layout(p, { ...DESKTOP, purpose: 'review' }, notation.tickablesPerBar(p));
    const unit = p.meter.countUnitTicks;
    for (let i = 0; i < p.measures.length; i++) {
      const beat = (p.measures[i]!.startTick - p.pickupTicks) / unit + 0.5;
      const pt = info.layout.beatToPoint(beat);
      expect(c.barAt(pt.system, pt.x)).toBe(i);
    }
    expect(c.barAt(99, 10)).toBeNull();
  });
});
