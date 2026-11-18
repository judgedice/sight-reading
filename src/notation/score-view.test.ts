// @vitest-environment jsdom
// P7 acceptance (01 §15 P7 row): 24 fixtures render in 4 clefs at every layout breakpoint; one SVG per system;
// beatToPoint total, monotonic, ±1 px; setSlotSystems triggers zero VexFlow renders; no font requests.
import { beforeAll, describe, expect, it } from 'vitest';
import type { Clef, ExcerptDoc, NoteVisualState, PreparedExcerpt, ScoreLayout } from '../core/types.ts';
import { LAYOUT_ROWS, planLayout, selectRow, systemHeightPx as uiSystemHeightPx } from '../ui/layout-table.ts';
import { ensureNotationFonts, renderHeadless, VexScoreView, expectedChains, tickablesPerBar, vexflowRenderCount, systemHeightPx } from './index.ts';
import type { NotationOverlay, OverlayHost } from './overlay-seam.ts';
import { ledgerLineCount } from './pitch-geometry.ts';
import { metricMisses, resetMetricMisses } from './text-metrics.ts';
import { fixtureDoc, fixtureDocs, golden, goldenFiles } from './testing/corpus-node.ts';
import { preparedFromDoc, preparedFromGolden, RENDER_CLEFS } from './testing/prepared.ts';

/** One viewport per row of 04 §4.2. */
const VIEWPORTS: Record<string, { width: number; height: number }> = {
  xl: { width: 1500, height: 900 },
  lg: { width: 1280, height: 800 },
  'md-land': { width: 900, height: 700 },
  'md-port': { width: 800, height: 1000 },
  'sm-short': { width: 844, height: 340 },
  xs: { width: 390, height: 844 },
};

function plan(p: PreparedExcerpt, vp: { width: number; height: number }) {
  return planLayout(vp, { top: 0, bottom: 0 }, p.measures.length, tickablesPerBar(p));
}

function eventOnsets(p: PreparedExcerpt): { id: string; beat: number; bar: number; kind: 'note' | 'rest' }[] {
  const out: { id: string; beat: number; bar: number; kind: 'note' | 'rest' }[] = [];
  for (const m of p.measures) for (const e of m.events) out.push({ id: e.id, beat: (e.tick - p.pickupTicks) / p.meter.countUnitTicks, bar: m.displayBar, kind: e.kind });
  return out;
}

/** True when b comes at or after a in reading order. */
const notBefore = (a: { system: number; x: number }, b: { system: number; x: number }): boolean =>
  b.system > a.system || (b.system === a.system && b.x >= a.x - 1e-6);

describe('fixture corpus × clefs × layout rows', () => {
  let docs: ExcerptDoc[];
  beforeAll(() => {
    docs = fixtureDocs();
  });

  it('has the 24 fixture documents', () => {
    expect(docs).toHaveLength(24);
  });

  it('every row is reachable from its viewport', () => {
    for (const row of LAYOUT_ROWS) expect(selectRow(VIEWPORTS[row.id]!.width, VIEWPORTS[row.id]!.height).id).toBe(row.id);
  });

  for (const row of LAYOUT_ROWS) {
    it(`renders all 24 excerpts in ${RENDER_CLEFS.join(', ')} at ${row.id}`, () => {
      const vp = VIEWPORTS[row.id]!;
      const view = new VexScoreView();
      const el = document.createElement('div');
      resetMetricMisses();
      let renders = 0;
      for (const d of docs) {
        for (const clef of RENDER_CLEFS) {
          const p = preparedFromDoc(d, clef);
          const pl = plan(p, vp);
          const before = view.renderCount;
          const layout = view.render(p, el, pl.renderOptions);
          const tag = `${d.id} ${clef} ${row.id}`;
          renders++;
          // One <svg> per system, each the 04 §4.2 height.
          const svgs = el.querySelectorAll('svg.sr-system');
          expect(svgs.length, tag).toBe(pl.barsPerSystem.length);
          expect(layout.systems.length, tag).toBe(pl.barsPerSystem.length);
          expect(view.renderCount - before, tag).toBe(pl.barsPerSystem.length);
          for (const s of svgs) {
            expect(Number(s.getAttribute('height')), tag).toBeCloseTo(uiSystemHeightPx(pl.spPx));
            expect(Number(s.getAttribute('width')), tag).toBe(vp.width);
            expect(s.querySelector(':scope > g.sr-underlay'), tag).not.toBeNull();
            expect(s.querySelector(':scope > g.sr-static'), tag).not.toBeNull();
            expect(s.querySelector(':scope > g.sr-overlay'), tag).not.toBeNull();
          }
          // Every event drawn and boxed; systems cover the bars in order.
          const onsets = eventOnsets(p);
          for (const ev of onsets) expect(layout.noteBoxes.has(ev.id), `${tag} ${ev.id}`).toBe(true);
          expect(layout.systems[0]!.firstBar, tag).toBe(p.measures[0]!.displayBar);
          expect(layout.systems.at(-1)!.lastBar, tag).toBe(p.measures.at(-1)!.displayBar);
          checkBeatToPoint(layout, p, tag);
          // Bars keep the 14 sp minimum width (04 §4.2).
          expect(view.fits, tag).toBe(true);
        }
      }
      expect(renders).toBe(96);
      expect(metricMisses()).toEqual([]);
    }, 60_000);
  }
});

/** beatToPoint: total, monotonic, and within ±1 px of every drawn event's box. */
function checkBeatToPoint(layout: ScoreLayout, p: PreparedExcerpt, tag: string): void {
  const onsets = eventOnsets(p);
  for (const ev of onsets) {
    const box = layout.noteBoxes.get(ev.id)!;
    const pt = layout.beatToPoint(ev.beat);
    expect(pt.system, `${tag} ${ev.id}`).toBe(box.system);
    // Centred whole-bar rests have no anchor; every note does.
    if (ev.kind === 'note') expect(Math.abs(pt.x - box.x), `${tag} ${ev.id} x`).toBeLessThanOrEqual(1);
  }
  const first = onsets[0]!.beat;
  const last = onsets.at(-1)!.beat;
  const bad: string[] = [];
  let prev = layout.beatToPoint(first - 8);
  for (let b = first - 8; b <= last + 12; b += 1 / 24) {
    const pt = layout.beatToPoint(b);
    const ok = Number.isFinite(pt.x) && pt.system >= 0 && pt.system < layout.systems.length && notBefore(prev, pt);
    if (!ok) bad.push(`beat ${b}: ${JSON.stringify(prev)} -> ${JSON.stringify(pt)}`);
    prev = pt;
  }
  expect(bad, tag).toEqual([]);
}

describe('written pitches from the expected-note goldens', () => {
  it('beatToPoint at each golden onsetBeat lands on the note, staffY on its notehead, ledgers agree', () => {
    const files = goldenFiles();
    expect(files.length).toBe(18);
    for (const f of files) {
      const g = golden(f);
      const p = preparedFromGolden(fixtureDoc(g.excerptId), g);
      for (const [rowId, vp] of Object.entries(VIEWPORTS)) {
        const view = new VexScoreView();
        const el = document.createElement('div');
        const layout = view.render(p, el, plan(p, vp).renderOptions);
        const tag = `${f} ${rowId}`;
        // The chain derivation matches the golden expected notes (setNoteState addresses notes by this index).
        expect(expectedChains(p).map((c) => c.eventIds), tag).toEqual(g.notes.map((n) => n.eventIds));
        for (const n of g.notes) {
          const box = layout.noteBoxes.get(n.eventIds[0]!)!;
          const pt = layout.beatToPoint(n.onsetBeat);
          expect(pt.system, `${tag} #${n.idx}`).toBe(box.system);
          expect(Math.abs(pt.x - box.x), `${tag} #${n.idx}`).toBeLessThanOrEqual(1);
          const y = layout.staffY(box.system, n.writtenPitch, g.clef);
          expect(Math.abs(y - (box.y + box.h / 2)), `${tag} #${n.idx} y`).toBeLessThanOrEqual(1);
          expect(ledgerLineCount(n.writtenPitch, g.clef), `${tag} #${n.idx} ledgers`).toBe(n.ledgerLines);
        }
      }
    }
  }, 60_000);
});

describe('ScoreView behaviour', () => {
  const doc = (): ExcerptDoc => fixtureDoc('mozart-sq35524196-violin1-mv2-mp16-28');

  it('system geometry mirrors the layout table', () => {
    for (const sp of [7, 7.5, 9, 10, 11]) expect(systemHeightPx(sp)).toBe(uiSystemHeightPx(sp));
    const p = preparedFromDoc(doc(), 'treble');
    const pl = plan(p, VIEWPORTS['lg']!);
    const layout = new VexScoreView().render(p, document.createElement('div'), pl.renderOptions);
    for (const s of layout.systems) {
      expect(s.lineSpacing).toBe(pl.spPx);
      expect(s.staffTopY).toBe(4 * pl.spPx);
      expect(s.heightPx).toBe(uiSystemHeightPx(pl.spPx));
    }
  });

  it('staffY is the same on every system and rejects unknown systems', () => {
    const p = preparedFromDoc(doc(), 'alto');
    const layout = new VexScoreView().render(p, document.createElement('div'), plan(p, VIEWPORTS['xs']!).renderOptions);
    const c4 = { step: 'C', alter: 0, octave: 4 } as const;
    expect(layout.staffY(0, c4, 'alto')).toBe(layout.staffY(layout.systems.length - 1, c4, 'alto'));
    expect(layout.staffY(0, c4, 'alto')).toBe(layout.systems[0]!.staffTopY + 2 * layout.systems[0]!.lineSpacing);
    expect(() => layout.staffY(layout.systems.length, c4, 'alto')).toThrow(RangeError);
    expect(() => layout.beatToPoint(Number.NaN)).toThrow(RangeError);
  });

  it('setSlotSystems moves the existing SVGs and triggers zero VexFlow renders', () => {
    const p = preparedFromDoc(doc(), 'treble');
    const pl = plan(p, VIEWPORTS['xs']!);
    const view = new VexScoreView();
    const el = document.createElement('div');
    view.render(p, el, pl.renderOptions);
    const n = pl.barsPerSystem.length;
    expect(n).toBeGreaterThan(4);
    const svgs = [...el.querySelectorAll('svg.sr-system')];
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    svgs[0]!.querySelector('g.sr-overlay')!.appendChild(marker);
    const local = view.renderCount;
    const global = vexflowRenderCount();

    view.setSlotSystems([0, 1, 2, 3]);
    expect(el.querySelectorAll('.sr-slot').length).toBe(4);
    expect([...el.querySelectorAll('.sr-slot')].map((s) => s.getAttribute('data-system'))).toEqual(['0', '1', '2', '3']);
    expect(el.querySelector('.sr-offstage')!.querySelectorAll('svg').length).toBe(n - 4);
    // 04 §4.3 worked case v = 4: entering line 3, slot 1 gets line 5; entering line 4, slot 2 gets line 6.
    view.setSlotSystems([4, 1, 2, 3]);
    view.setSlotSystems([4, 5, 2, 3]);
    const slots = [...el.querySelectorAll('.sr-slot')];
    expect(slots.map((s) => s.querySelector('svg')!.getAttribute('data-system'))).toEqual(['4', '5', '2', '3']);
    expect(view.getSlotSystems()).toEqual([4, 5, 2, 3]);
    // Same nodes, overlay content intact, no renders.
    const now = [...el.querySelectorAll('svg.sr-system')];
    expect(now.length).toBe(n);
    expect(now.every((s) => svgs.includes(s))).toBe(true);
    expect(svgs[0]!.contains(marker)).toBe(true);
    expect(view.renderCount).toBe(local);
    expect(vexflowRenderCount()).toBe(global);

    expect(() => view.setSlotSystems([0, 0])).toThrow(RangeError);
    expect(() => view.setSlotSystems([n])).toThrow(RangeError);
    expect(() => new VexScoreView().setSlotSystems([0])).toThrow(/before render/);
  });

  it('setNoteState writes idempotent data-* on every group of the tie chain', () => {
    const d = fixtureDocs().find((x) => x.measures.some((m) => m.events.some((e) => e.kind === 'note' && e.tieStart)))!;
    const p = preparedFromDoc(d, 'treble');
    const view = new VexScoreView();
    const el = document.createElement('div');
    view.render(p, el, plan(p, VIEWPORTS['lg']!).renderOptions);
    const chains = expectedChains(p);
    const tied = chains.findIndex((c) => c.eventIds.length > 1);
    expect(tied).toBeGreaterThanOrEqual(0);
    const groups = el.querySelectorAll(`[data-expected-idx="${tied}"]`);
    expect(groups.length).toBeGreaterThanOrEqual(2);
    const s: NoteVisualState = { phase: 'judged', timing: 'late', pitch: 'sharp', provisional: true };
    view.setNoteState(tied, s);
    const html = el.innerHTML;
    view.setNoteState(tied, s);
    expect(el.innerHTML).toBe(html);
    for (const g of groups) {
      expect(g.getAttribute('data-phase')).toBe('judged');
      expect(g.getAttribute('data-timing')).toBe('late');
      expect(g.getAttribute('data-pitch')).toBe('sharp');
      expect(g.getAttribute('data-provisional')).toBe('true');
      expect(g.hasAttribute('data-marginal')).toBe(false);
    }
    // A later state replaces the earlier one (R36), clearing absent fields.
    view.setNoteState(tied, { phase: 'judged', timing: 'on-time', pitch: 'in-tune' });
    for (const g of groups) {
      expect(g.getAttribute('data-pitch')).toBe('in-tune');
      expect(g.hasAttribute('data-provisional')).toBe(false);
    }
    view.setNoteState(9999, s); // unknown index: ignored
    view.clearOverlay();
    for (const g of groups) expect(g.hasAttribute('data-phase')).toBe(false);
  });

  it('forwards to an attached overlay and gives it the host', () => {
    const calls: string[] = [];
    let host: OverlayHost | null = null;
    const overlay: NotationOverlay = {
      attach: (h) => {
        host = h;
        calls.push('attach');
      },
      noteState: (i) => calls.push(`state ${i}`),
      showGhost: (g) => calls.push(`ghost ${g.detectedId}`),
      removeGhost: (id) => calls.push(`remove ${id}`),
      setPlayhead: (b) => calls.push(`playhead ${b}`),
      setMode: (m) => calls.push(`mode ${m}`),
      clear: () => calls.push('clear'),
      detach: () => calls.push('detach'),
    };
    const p = preparedFromDoc(doc(), 'treble');
    const view = new VexScoreView({ overlay });
    const el = document.createElement('div');
    view.render(p, el, plan(p, VIEWPORTS['lg']!).renderOptions);
    expect(host).not.toBeNull();
    const h = host as unknown as OverlayHost;
    expect(h.systems.length).toBe(el.querySelectorAll('svg.sr-system').length);
    expect(h.noteGroups(0).length).toBeGreaterThan(0);
    expect(h.expectedEventIds.length).toBe(expectedChains(p).length);
    const ghost = { detectedId: 7, scoreBeat: 1.5, writtenPitch: { step: 'C', alter: 0, octave: 5 }, kind: 'late', centsError: null, targetExpectedIdx: 1, displaced: false } as const;
    view.setMode('review');
    view.setNoteState(0, { phase: 'active' });
    view.showGhost(ghost);
    view.setPlayhead(2);
    view.removeGhost(7);
    view.clearOverlay();
    view.render(p, el, plan(p, VIEWPORTS['lg']!).renderOptions);
    expect(calls).toEqual(['attach', 'mode live', 'mode review', 'state 0', 'ghost 7', 'playhead 2', 'remove 7', 'clear', 'detach', 'attach', 'mode review']);
    expect(view.snapshot().ghosts).toEqual([]);
  });

  it('rejects options that do not match the excerpt', () => {
    const p = preparedFromDoc(doc(), 'treble');
    const el = document.createElement('div');
    expect(() => new VexScoreView().render(p, el, { widthPx: 800, barsPerSystem: [4, 4], spPx: 10 })).toThrow(/measures/);
    expect(() => new VexScoreView().render(p, el, { widthPx: 0, barsPerSystem: [p.measures.length], spPx: 10 })).toThrow(RangeError);
  });

  it('draws no text-font or font-file references (fonts come from VexFlow-embedded data URLs only)', async () => {
    await ensureNotationFonts();
    const p = preparedFromDoc(doc(), 'treble');
    const el = document.createElement('div');
    new VexScoreView().render(p, el, plan(p, VIEWPORTS['lg']!).renderOptions);
    const html = el.innerHTML;
    expect(html).not.toMatch(/url\(|@font-face|<link|<style|https?:/);
    // Every drawn glyph is Bravura text (VexFlow's default text font is never used for ink).
    const texts = [...el.querySelectorAll('text')];
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) expect(t.closest('[font-family]')?.getAttribute('font-family') ?? '').toMatch(/^Bravura/);
  });

  it('renderHeadless returns serialised systems and a layout (03 C10 entry point)', () => {
    const p = preparedFromDoc(doc(), 'bass');
    const pl = plan(p, VIEWPORTS['md-port']!);
    const r = renderHeadless(p, pl.renderOptions);
    expect(r.svgs).toHaveLength(pl.barsPerSystem.length);
    expect(r.svgs[0]).toMatch(/^<svg/);
    expect(r.metricMisses).toEqual([]);
    expect(r.fits).toBe(true);
    expect(r.layout.noteBoxes.size).toBeGreaterThan(0);
  });

  it('renders a treble-8vb part with the octave clef', () => {
    const p = preparedFromDoc(doc(), 'treble-8vb' as Clef);
    const el = document.createElement('div');
    new VexScoreView().render(p, el, plan(p, VIEWPORTS['lg']!).renderOptions);
    // gClef8vb (U+E052) in every system.
    const clefs = [...el.querySelectorAll('.vf-clef text')].map((t) => t.textContent);
    expect(clefs.length).toBe(el.querySelectorAll('svg.sr-system').length);
    for (const c of clefs) expect(c).toBe('');
  });
});
