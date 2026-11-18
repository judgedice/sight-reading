// D3 ScoreFrame in real Chromium (04 §4.3, §4.4, §5.4 acceptance, §13.2 viewports; 05 §7): page turns follow the
// 4.3 worked cases at phone portrait and landscape; laptop and iPad sizes fit 8, 10 and 12 bars with no turns and no
// scrolling; system numbers show only while pages turn; a mid-take setViewportSize scales the frozen frame with zero
// VexFlow renders and the overlay stays aligned within 1 px.
// pnpm exec playwright test -c e2e/notation/playwright.notation.config.ts score-frame
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { CorpusIndex, ExcerptChunk, ExcerptDoc } from '../../src/core/types.ts';
import { FRAME_FIXTURE_ID } from './score-frame-fixture.ts';
import { openFramePage } from './score-frame-page.ts';

const readJson = <T>(rel: string): T => JSON.parse(readFileSync(join(process.cwd(), rel), 'utf8')) as T;
const idx = readJson<CorpusIndex>('fixtures/corpus/index.json');
const doc: ExcerptDoc = idx.chunks
  .flatMap((c) => readJson<ExcerptChunk>(`fixtures/corpus/${c.file}`).excerpts)
  .find((d) => d.id === FRAME_FIXTURE_ID)!;
const sprite = readFileSync(join(process.cwd(), 'src/ui/glyphs.svg'), 'utf8');

type Rig = {
  mount(a: unknown): Promise<{ info: Info; renders: number }>;
  setFrozen(f: boolean): void;
  setArrangement(a: 'slots' | 'all'): void;
  setPlayhead(b: number | null): number[];
  showGhost(g: unknown): void;
  firstNote(): { beat: number; pitch: unknown };
  slots(): number[];
  slotLog(): number[][];
  resizeLog(): { scale: number; orientationChanged: boolean }[];
  scale(): number;
  renders(): number;
  viewRenders(): number;
};
type Info = { systemCount: number; plan: { slots: number; row: { id: string }; systemHeightPx: number }; pages: { turns: boolean } };

async function mount(page: Page, bars: number, insets: { top: number; bottom: number }, bpm = 120): Promise<{ info: Info; renders: number }> {
  await openFramePage(page);
  return page.evaluate(
    (a) => (window as unknown as { frameRig: Rig }).frameRig.mount(a),
    { doc, bars, bpm, insets, sprite },
  );
}

const rigCall = <T>(page: Page, fn: (rig: Rig, arg: unknown) => T, arg: unknown = null): Promise<T> =>
  page.evaluate(
    ({ src, arg }) => {
      const f = new Function('rig', 'arg', `return (${src})(rig, arg);`) as (r: Rig, a: unknown) => T;
      return f((window as unknown as { frameRig: Rig }).frameRig, arg);
    },
    { src: fn.toString(), arg },
  );

/** What is on screen: visible slots (system per slot, rect), numbers, wrap bars, and whether anything scrolls. */
async function screen(page: Page) {
  return page.evaluate(() => {
    const frame = document.querySelector<HTMLElement>('.sf-frame')!;
    const fr = frame.getBoundingClientRect();
    const slots = Array.from(frame.querySelectorAll<HTMLElement>('.sf-score .sr-slot')).map((s) => {
      const r = s.querySelector('svg')!.getBoundingClientRect();
      return { system: Number(s.getAttribute('data-system')), top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    });
    const lines = Array.from(frame.querySelectorAll<HTMLElement>('.sf-line')).map((l) => {
      const before = getComputedStyle(l, '::before');
      const after = getComputedStyle(l, '::after');
      return {
        number: before.content === 'none' ? null : before.content.replace(/"/g, ''),
        wrap: after.content !== 'none' && after.backgroundColor !== 'rgba(0, 0, 0, 0)',
        wrapWidth: after.content !== 'none' ? parseFloat(after.width) : 0,
      };
    });
    const se = document.scrollingElement!;
    return {
      frame: { top: fr.top, bottom: fr.bottom, left: fr.left, right: fr.right },
      slots,
      lines,
      docScrolls: se.scrollHeight > se.clientHeight + 1 || se.scrollWidth > se.clientWidth + 1,
      // A box scrolls only if it is a scroll container with overflow (a frozen frame is overflow: clip; a scaled-down
      // stage still reports its unscaled layout size in scrollWidth/Height, which nothing can scroll to).
      frameScrolls: (() => {
        const cs = getComputedStyle(frame);
        const can = (o: string) => o === 'auto' || o === 'scroll' || o === 'hidden';
        return (can(cs.overflowY) && frame.scrollHeight > frame.clientHeight + 1) || (can(cs.overflowX) && frame.scrollWidth > frame.clientWidth + 1);
      })(),
      frameOverflow: getComputedStyle(frame).overflow,
      frameDims: [frame.scrollWidth, frame.clientWidth, frame.scrollHeight, frame.clientHeight],
      viewport: { w: window.innerWidth, h: window.innerHeight },
    };
  });
}

function expectInside(s: Awaited<ReturnType<typeof screen>>, insets: { top: number; bottom: number }): void {
  for (const sl of s.slots) {
    expect(sl.top).toBeGreaterThanOrEqual(insets.top - 0.5);
    expect(sl.bottom).toBeLessThanOrEqual(s.viewport.h - insets.bottom + 0.5);
    expect(sl.bottom).toBeLessThanOrEqual(s.frame.bottom + 0.5);
    expect(sl.right).toBeLessThanOrEqual(s.viewport.w + 0.5);
    expect(sl.left).toBeGreaterThanOrEqual(-0.5);
  }
  expect(s.docScrolls).toBe(false);
  expect(s.frameScrolls).toBe(false);
}

// 4/4 at 120 bpm with 2 bars per xs system: a system is 8 beats (4 s); 400 ms is 0.8 beat.
const PHONE_CASES = [
  {
    name: '390×844 home-screen app, insets 47/34: v = 5, one swap',
    viewport: { width: 390, height: 844 },
    insets: { top: 47, bottom: 34 },
    slots: 5,
    systems: 6,
    steps: [
      { beat: 0, slots: [0, 1, 2, 3, 4] },
      { beat: 16.5, slots: [0, 1, 2, 3, 4] },
      { beat: 16.9, slots: [5, 1, 2, 3, 4] },
      { beat: 47, slots: [5, 1, 2, 3, 4] },
    ],
  },
  {
    name: '390×660 Safari tab, insets 0/34: v = 4, two swaps',
    viewport: { width: 390, height: 660 },
    insets: { top: 0, bottom: 34 },
    slots: 4,
    systems: 6,
    steps: [
      { beat: 0, slots: [0, 1, 2, 3] },
      { beat: 16.9, slots: [4, 1, 2, 3] },
      { beat: 24.5, slots: [4, 1, 2, 3], wrap: 0 },
      { beat: 24.9, slots: [4, 5, 2, 3] },
      { beat: 47, slots: [4, 5, 2, 3] },
    ],
  },
  {
    name: '844×340 landscape tab, insets 0/21: v = 2, 3 systems, one swap 400 ms into system 2',
    viewport: { width: 844, height: 340 },
    insets: { top: 0, bottom: 21 },
    slots: 2,
    systems: 3,
    steps: [
      { beat: 0, slots: [0, 1] },
      { beat: 16.5, slots: [0, 1] },
      { beat: 16.9, slots: [2, 1] },
    ],
  },
];

for (const c of PHONE_CASES) {
  test(`page turns, 12 bars: ${c.name}`, async ({ page }) => {
    await page.setViewportSize(c.viewport);
    const { info, renders } = await mount(page, 12, c.insets);
    expect(info.systemCount).toBe(c.systems);
    expect(info.plan.slots).toBe(c.slots);
    expect(info.pages.turns).toBe(true);
    await rigCall(page, (rig) => rig.setFrozen(true));

    for (const st of c.steps) {
      const slots = await rigCall(page, (rig, b) => rig.setPlayhead(b as number), st.beat);
      expect(slots, `beat ${st.beat}`).toEqual(st.slots);
      await page.waitForTimeout(220); // let the 160 ms crossfade finish before measuring
      const s = await screen(page);
      expect(s.slots.map((x) => x.system)).toEqual(st.slots);
      // System numbers whenever pages turn (1-based, one per slot, in the left margin).
      expect(s.lines.map((l) => l.number)).toEqual(st.slots.map((x) => String(x + 1)));
      if ('wrap' in st) {
        expect(s.lines.map((l) => l.wrap)).toEqual(st.slots.map((_, i) => i === st.wrap));
        expect(s.lines[st.wrap!]!.wrapWidth).toBeCloseTo(3, 1);
      }
      // Slots are fixed: each is one system height below the last; nothing scrolls or leaves the safe area.
      s.slots.forEach((sl, i) => expect(sl.top - s.slots[0]!.top).toBeCloseTo(i * info.plan.systemHeightPx, 0));
      expectInside(s, c.insets);
    }
    expect(await rigCall(page, (rig) => rig.renders())).toBe(renders);
  });
}

test('the outgoing system crossfades over about 160 ms and only its slot changes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 660 });
  await mount(page, 12, { top: 0, bottom: 34 });
  await rigCall(page, (rig) => rig.setFrozen(true));
  await rigCall(page, (rig) => rig.setPlayhead(10));
  const before = await screen(page);
  const during = await page.evaluate(() => {
    const rig = (window as unknown as { frameRig: { setPlayhead(b: number): void } }).frameRig;
    rig.setPlayhead(17);
    const fade = document.querySelector('.sf-fade')!;
    return { clones: fade.children.length, system: fade.querySelector('svg')?.getAttribute('data-system') ?? null };
  });
  expect(during).toEqual({ clones: 1, system: '0' });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.querySelector('.sf-fade')!.children.length)).toBe(0);
  const after = await screen(page);
  after.slots.slice(1).forEach((sl, i) => expect(sl).toEqual(before.slots[i + 1]));
});

const DESKTOP = [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 1180, height: 760 },
  { width: 1024, height: 1366 },
];
for (const vp of DESKTOP) {
  test(`${vp.width}×${vp.height}: 8, 10 and 12 bars fit with no turns, no numbers and no scrolling`, async ({ page }) => {
    await page.setViewportSize(vp);
    for (const bars of [8, 10, 12]) {
      const { info } = await mount(page, bars, { top: 0, bottom: 0 });
      expect(info.pages.turns, `${bars} bars`).toBe(false);
      await rigCall(page, (rig) => rig.setFrozen(true));
      await rigCall(page, (rig, b) => rig.setPlayhead((b as number) * 4 - 1), bars);
      const s = await screen(page);
      expect(s.slots.map((x) => x.system)).toEqual(Array.from({ length: info.systemCount }, (_, i) => i));
      expect(s.lines.every((l) => l.number === null)).toBe(true);
      expectInside(s, { top: 0, bottom: 0 });
    }
  });
}

for (const c of [
  { name: 'phone portrait', from: { width: 390, height: 844 }, to: { width: 390, height: 700 }, insets: { top: 47, bottom: 34 } },
  { name: 'desktop', from: { width: 1280, height: 720 }, to: { width: 1100, height: 720 }, insets: { top: 0, bottom: 0 } },
]) {
  test(`${c.name}: a mid-take resize scales the frozen frame, renders nothing, keeps the overlay aligned`, async ({ page }) => {
    await page.setViewportSize(c.from);
    await mount(page, 12, c.insets);
    await rigCall(page, (rig) => rig.setFrozen(true));
    await rigCall(page, (rig) => {
      const n = rig.firstNote();
      rig.showGhost({ detectedId: 1, scoreBeat: n.beat + 0.25, writtenPitch: n.pitch, kind: 'late', centsError: null, targetExpectedIdx: 0, displaced: false });
      rig.setPlayhead(n.beat + 0.5);
    });
    const measure = () =>
      page.evaluate(() => {
        const note = document.querySelector('[data-expected-idx="0"]')!.getBoundingClientRect();
        const ghost = document.querySelector('.sr-ghost[data-detected-id="1"]')!.getBoundingClientRect();
        const svg = document.querySelector('.sr-slot[data-slot="0"] svg')!.getBoundingClientRect();
        return { note: { x: note.left - svg.left, y: note.top - svg.top }, ghost: { x: ghost.left - svg.left, y: ghost.top - svg.top }, svgW: svg.width };
      });
    const before = await measure();
    const renders = await rigCall(page, (rig) => rig.renders());
    await page.setViewportSize(c.to);
    await expect.poll(() => rigCall(page, (rig) => rig.scale())).toBeLessThan(1);
    const scale = await rigCall(page, (rig) => rig.scale());
    const after = await measure();
    expect(await rigCall(page, (rig) => rig.renders())).toBe(renders);
    expect(after.svgW).toBeCloseTo(before.svgW * scale, 0);
    // Every overlay mark scales with its system: positions relative to the SVG are the old ones times the scale.
    for (const k of ['note', 'ghost'] as const) {
      expect(Math.abs(after[k].x - before[k].x * scale)).toBeLessThanOrEqual(1);
      expect(Math.abs(after[k].y - before[k].y * scale)).toBeLessThanOrEqual(1);
    }
    expect(Math.abs(after.ghost.x - after.note.x - (before.ghost.x - before.note.x) * scale)).toBeLessThanOrEqual(1);
    const log = await rigCall(page, (rig) => rig.resizeLog());
    expect(log.at(-1)!.orientationChanged).toBe(false);
    const s = await screen(page);
    expect(s.docScrolls).toBe(false);
    expect(s.frameScrolls, JSON.stringify(s.frameDims)).toBe(false);
    expect(s.frameOverflow).toBe('clip');
    await page.mouse.move(c.to.width / 2, c.to.height / 2);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => [document.scrollingElement!.scrollTop, document.querySelector('.sf-frame')!.scrollTop])).toEqual([0, 0]);
  });
}

test('phone portrait scan: natural-order scroll of every system; count-in resets to slots 1..v; rotation is reported', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 660 });
  await mount(page, 12, { top: 0, bottom: 34 });
  await rigCall(page, (rig) => rig.setArrangement('all'));
  let s = await screen(page);
  expect(s.slots.map((x) => x.system)).toEqual([0, 1, 2, 3, 4, 5]);
  expect(s.lines.map((l) => l.number)).toEqual(['1', '2', '3', '4', '5', '6']);
  expect(s.docScrolls).toBe(false); // the frame scrolls, not the page
  const renders = await rigCall(page, (rig) => rig.renders());
  await rigCall(page, (rig) => {
    rig.setArrangement('slots');
    rig.setFrozen(true);
  });
  s = await screen(page);
  expect(s.slots.map((x) => x.system)).toEqual([0, 1, 2, 3]);
  expect(await rigCall(page, (rig) => rig.renders())).toBe(renders);
  await page.setViewportSize({ width: 660, height: 390 });
  await expect.poll(async () => (await rigCall(page, (rig) => rig.resizeLog())).some((r) => r.orientationChanged)).toBe(true);
  expect(await rigCall(page, (rig) => rig.renders())).toBe(renders);
});
