// P7 in real Chromium (01 §15 P7 row): the 24 fixtures in 4 clefs at every layout row; ink lands where
// ScoreLayout says (beatToPoint and staffY within 1 px of the drawn noteheads); no font or other network requests;
// setSlotSystems causes zero VexFlow renders; 12-bar render time (01 §12: ≤ 120 ms laptop).
import { expect, test, type Page } from '@playwright/test';
import type { Clef, CorpusIndex, ExcerptChunk, ExcerptDoc } from '../../src/core/types.ts';
import { openNotationPage, readJson } from './page.ts';

const VIEWPORTS: Record<string, { width: number; height: number }> = {
  xl: { width: 1500, height: 900 },
  lg: { width: 1280, height: 800 },
  'md-land': { width: 900, height: 700 },
  'md-port': { width: 800, height: 1000 },
  'sm-short': { width: 844, height: 340 },
  xs: { width: 390, height: 844 },
};
const CLEFS: Clef[] = ['treble', 'bass', 'alto', 'tenor'];

function docs(): ExcerptDoc[] {
  const idx = readJson<CorpusIndex>('fixtures/corpus/index.json');
  return idx.chunks.flatMap((c) => readJson<ExcerptChunk>(`fixtures/corpus/${c.file}`).excerpts);
}

/** Every request the page makes that is not a data: URL. */
function watchRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('data:')) urls.push(r.url());
  });
  return urls;
}

interface Check {
  systems: number;
  expectedSystems: number;
  ms: number;
  worstX: number;
  worstY: number;
  worstBeat: number;
  worstInk: number;
  notes: number;
  bravuraLoaded: boolean;
}

/** Renders one excerpt and measures the drawn noteheads against the layout, in the page. */
async function renderAndCheck(page: Page, doc: ExcerptDoc, clef: Clef, vp: { width: number; height: number }): Promise<Check> {
  return page.evaluate(
    ({ doc, clef, vp }) => {
      type Api = {
        render(d: unknown, c: string, v: unknown): {
          p: { pickupTicks: number; meter: { countUnitTicks: number }; measures: { events: { id: string; kind: string; tick: number; writtenPitch?: unknown }[] }[] };
          plan: { barsPerSystem: number[] };
          layout: {
            noteBoxes: Map<string, { system: number; x: number; y: number; w: number; h: number }>;
            beatToPoint(b: number): { system: number; x: number };
            staffY(s: number, p: unknown, c: string): number;
          };
          ms: number;
        };
      };
      const api = (window as unknown as { notation: Api }).notation;
      const { p, plan, layout, ms } = api.render(doc, clef, vp);
      const svgs = Array.from(document.querySelectorAll<SVGSVGElement>('#score svg.sr-system'));
      let worstX = 0;
      let worstY = 0;
      let worstBeat = 0;
      let worstInk = 0;
      let notes = 0;
      for (const m of p.measures) {
        for (const e of m.events) {
          if (e.kind !== 'note') continue;
          const g = document.querySelector(`#score [data-event-id="${e.id}"]:not([data-piece]), #score [data-event-id="${e.id}"][data-piece="0"]`);
          const head = g?.querySelector('.vf-notehead text');
          const box = layout.noteBoxes.get(e.id)!;
          const svg = svgs[box.system]!;
          if (!head) throw new Error(`no notehead for ${e.id}`);
          const sr = svg.getBoundingClientRect();
          // Glyph origin as the browser places it (text x/y through every transform), in px within the system SVG.
          // SMuFL noteheads sit centred on the baseline, so the origin's y is the notehead centre.
          const t = head as SVGTextElement;
          const o = svg.createSVGPoint();
          o.x = Number(t.getAttribute('x'));
          o.y = Number(t.getAttribute('y'));
          const sp = o.matrixTransform(t.getScreenCTM()!);
          const originX = sp.x - sr.left;
          const originY = sp.y - sr.top;
          // Painted ink box (Chromium rounds text boxes to whole px, hence the looser bound below).
          const hr = head.getBoundingClientRect();
          worstInk = Math.max(worstInk, Math.abs(hr.left - sr.left - box.x));
          worstX = Math.max(worstX, Math.abs(originX - box.x));
          worstY = Math.max(worstY, Math.abs(originY - layout.staffY(box.system, e.writtenPitch, clef)));
          const pt = layout.beatToPoint((e.tick - p.pickupTicks) / p.meter.countUnitTicks);
          if (pt.system !== box.system) worstBeat = Infinity;
          worstBeat = Math.max(worstBeat, Math.abs(pt.x - originX));
          notes++;
        }
      }
      return {
        systems: svgs.length,
        expectedSystems: plan.barsPerSystem.length,
        ms,
        worstX,
        worstY,
        worstBeat,
        worstInk,
        notes,
        bravuraLoaded: document.fonts.check('30pt Bravura'),
      };
    },
    { doc, clef, vp },
  );
}

test.describe('notation static render in Chromium', () => {
  test.describe.configure({ timeout: 300_000 });

  for (const [row, vp] of Object.entries(VIEWPORTS)) {
    test(`24 fixtures × 4 clefs at ${row}: ink within 1 px of the layout, no requests`, async ({ page }) => {
      await page.setViewportSize(vp);
      const requests = watchRequests(page);
      await openNotationPage(page);
      let count = 0;
      for (const d of docs()) {
        for (const clef of CLEFS) {
          const r = await renderAndCheck(page, d, clef, vp);
          const tag = `${d.id} ${clef} ${row}`;
          expect(r.systems, tag).toBe(r.expectedSystems);
          expect(r.bravuraLoaded, tag).toBe(true);
          expect(r.notes, tag).toBeGreaterThan(0);
          expect(r.worstX, `${tag} notehead origin vs noteBoxes`).toBeLessThanOrEqual(1);
          expect(r.worstBeat, `${tag} beatToPoint vs notehead origin`).toBeLessThanOrEqual(1);
          expect(r.worstY, `${tag} staffY vs notehead centre`).toBeLessThanOrEqual(1);
          expect(r.worstInk, `${tag} painted notehead vs noteBoxes`).toBeLessThanOrEqual(1.5);
          count++;
        }
      }
      expect(count).toBe(96);
      // No font requests, and no network at all: Bravura comes from the data: URL inside the VexFlow bundle.
      expect(requests).toEqual([]);
    });
  }

  test('setSlotSystems and a viewport resize cause zero VexFlow renders', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS['xs']!);
    await openNotationPage(page);
    const d = docs().find((x) => x.id === 'mozart-sq35524196-violin1-mv2-mp16-28')!;
    const result = await page.evaluate((doc) => {
      type Api = { render(d: unknown, c: string, v: unknown): unknown; renderCount(): number; view: { setSlotSystems(s: number[]): void } };
      const api = (window as unknown as { notation: Api }).notation;
      api.render(doc, 'treble', { width: 390, height: 844 });
      const before = api.renderCount();
      const first = document.querySelector('#score svg.sr-system');
      api.view.setSlotSystems([0, 1, 2, 3]);
      api.view.setSlotSystems([4, 1, 2, 3]);
      api.view.setSlotSystems([4, 5, 2, 3]);
      return { before, after: api.renderCount(), sameNode: document.querySelector('#score svg.sr-system[data-system="0"]') === first };
    }, d);
    await page.setViewportSize({ width: 660, height: 390 });
    const after = await page.evaluate(() => (window as unknown as { notation: { renderCount(): number } }).notation.renderCount());
    expect(result.after).toBe(result.before);
    expect(after).toBe(result.before);
    expect(result.sameNode).toBe(true);
  });

  test('12-bar render time (01 §12: ≤ 120 ms laptop)', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS['lg']!);
    await openNotationPage(page);
    // The longest fixtures: 11 to 13 measures (pickup included).
    const long = docs().filter((d) => d.measures.length >= 11);
    expect(long.length).toBeGreaterThan(0);
    const times: number[] = [];
    for (let rep = 0; rep < 3; rep++) {
      for (const d of long) times.push((await renderAndCheck(page, d, 'treble', VIEWPORTS['lg']!)).ms);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)]!;
    const p95 = times[Math.floor(times.length * 0.95)]!;
    test.info().annotations.push({ type: 'render-ms', description: `median ${median.toFixed(1)}, p95 ${p95.toFixed(1)}, max ${times.at(-1)!.toFixed(1)}` });
    expect(median).toBeLessThanOrEqual(120);
  });
});
