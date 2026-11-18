// IOS6 (05 section 7, 8.1 item 5) at the acceptance viewports V1 to V7 with touch emulation and injected insets:
// no score-frame overflow; the next system is visible in page-turn mode; nothing inside the insets; Stop is at least
// 44x44 and inset + 8 px from the edges; a mid-take resize renders nothing and keeps the overlay within 1 px; a
// rotation during the count-in re-lays out and restarts it once; the take's computed touch styles; no 100vh in CSS.
// pnpm exec playwright test -c e2e/ios/playwright.ios.config.ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { CorpusIndex, ExcerptChunk, ExcerptDoc } from '../../src/core/types.ts';
import { IOS_VIEWPORTS, STOP_MIN_PX, minEdgeDistance } from '../../src/platform/web/ios/viewport.ts';
import { FRAME_FIXTURE_ID } from '../notation/score-frame-fixture.ts';
import { openIosPage } from './ios-page.ts';

const readJson = <T>(rel: string): T => JSON.parse(readFileSync(join(process.cwd(), rel), 'utf8')) as T;
const idx = readJson<CorpusIndex>('fixtures/corpus/index.json');
const doc: ExcerptDoc = idx.chunks
  .flatMap((c) => readJson<ExcerptChunk>(`fixtures/corpus/${c.file}`).excerpts)
  .find((d) => d.id === FRAME_FIXTURE_ID)!;
const sprite = readFileSync(join(process.cwd(), 'src/ui/glyphs.svg'), 'utf8');

type Insets4 = { top: number; right: number; bottom: number; left: number };
type Span = { startBeat: number; beats: number };
type Info = { systemCount: number; spans: Span[]; pages: { turns: boolean }; plan: { slots: number } };
type Rig = {
  mount(a: unknown): Promise<{ info: Info; renders: number }>;
  phase(p: 'idle' | 'countIn' | 'performing'): void;
  setPlayhead(b: number | null): number[];
  showGhost(g: unknown): void;
  firstNote(): { beat: number; pitch: unknown };
  restarts(): number;
  controllerRestarts(): number;
  actions(): string[];
  scale(): number;
  renders(): number;
};

async function mount(page: Page, bars: number, insets: Insets4) {
  await openIosPage(page);
  return page.evaluate((a) => (window as unknown as { iosRig: Rig }).iosRig.mount(a), { doc, bars, bpm: 120, insets, sprite });
}

const rigCall = <T>(page: Page, fn: (rig: Rig, arg: unknown) => T, arg: unknown = null): Promise<T> =>
  page.evaluate(
    ({ src, arg }) => {
      const f = new Function('rig', 'arg', `return (${src})(rig, arg);`) as (r: Rig, a: unknown) => T;
      return f((window as unknown as { iosRig: Rig }).iosRig, arg);
    },
    { src: fn.toString(), arg },
  );

async function geometry(page: Page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
    };
    const frame = document.querySelector<HTMLElement>('.sf-frame')!;
    const slots = Array.from(frame.querySelectorAll<HTMLElement>('.sf-score .sr-slot')).map((s) => ({
      system: Number(s.getAttribute('data-system')),
      ...rect(s.querySelector('svg')!),
    }));
    const se = document.scrollingElement!;
    const cs = getComputedStyle(frame);
    const can = (o: string) => o === 'auto' || o === 'scroll' || o === 'hidden';
    return {
      vw,
      vh,
      frame: rect(frame),
      slots,
      toolbar: rect(document.getElementById('toolbar')!),
      status: rect(document.getElementById('status')!),
      stop: rect(document.getElementById('stop')!),
      docScrolls: se.scrollHeight > se.clientHeight + 1 || se.scrollWidth > se.clientWidth + 1,
      frameScrolls: (can(cs.overflowY) && frame.scrollHeight > frame.clientHeight + 1) || (can(cs.overflowX) && frame.scrollWidth > frame.clientWidth + 1),
    };
  });
}

for (const v of IOS_VIEWPORTS) {
  test.describe(`${v.id} ${v.name} ${v.width}x${v.height}`, () => {
    test.use({ viewport: { width: v.width, height: v.height }, isMobile: true, hasTouch: true });
    const ins = v.insets;

    test('layout: no overflow, next system visible, nothing inside the insets, Stop target', async ({ page }) => {
      const { info, renders } = await mount(page, 12, ins);
      await rigCall(page, (rig) => rig.phase('countIn'));
      await rigCall(page, (rig) => rig.phase('performing'));
      // A turn swaps the finished slot 400 ms (at most half a system) into a system, so the next system is checked
      // past the swap point; right at a system start only the current system is required.
      const beats = info.spans.flatMap((s, k) => [{ k, beat: s.startBeat + 0.1, late: false }, { k, beat: s.startBeat + s.beats * 0.6, late: true }]);
      for (const { k, beat, late } of beats) {
        const slots = await rigCall(page, (rig, b) => rig.setPlayhead(b as number), beat);
        expect(slots, `beat ${beat} (system ${k}) slots ${slots}`).toContain(k);
        if (late && k + 1 < info.systemCount) expect(slots, `next system visible at beat ${beat} (system ${k})`).toContain(k + 1);
        await page.waitForTimeout(200); // let a 160 ms crossfade finish
        const g = await geometry(page);
        expect(g.docScrolls).toBe(false);
        expect(g.frameScrolls).toBe(false);
        for (const s of g.slots) {
          expect(s.left).toBeGreaterThanOrEqual(ins.left - 0.5);
          expect(s.right).toBeLessThanOrEqual(g.vw - ins.right + 0.5);
          expect(s.top).toBeGreaterThanOrEqual(ins.top - 0.5);
          expect(s.bottom).toBeLessThanOrEqual(g.vh - ins.bottom + 0.5);
          expect(s.bottom).toBeLessThanOrEqual(g.frame.bottom + 0.5);
        }
      }
      const g = await geometry(page);
      for (const [name, r] of [['toolbar', g.toolbar], ['status', g.status], ['frame', g.frame]] as const) {
        expect(r.top, `${name} top`).toBeGreaterThanOrEqual(ins.top - 0.5);
        expect(r.bottom, `${name} bottom`).toBeLessThanOrEqual(g.vh - ins.bottom + 0.5);
        expect(r.left, `${name} left`).toBeGreaterThanOrEqual(-0.5);
        expect(r.right, `${name} right`).toBeLessThanOrEqual(g.vw + 0.5);
      }
      // Stop: the only take control on a phone.
      expect(g.stop.width).toBeGreaterThanOrEqual(STOP_MIN_PX - 0.01);
      expect(g.stop.height).toBeGreaterThanOrEqual(STOP_MIN_PX - 0.01);
      expect(g.stop.bottom).toBeLessThanOrEqual(g.vh - minEdgeDistance(ins.bottom) + 0.5);
      expect(g.stop.right).toBeLessThanOrEqual(g.vw - minEdgeDistance(ins.right) + 0.5);
      expect(g.stop.top).toBeGreaterThanOrEqual(ins.top + 8 - 0.5);
      expect(g.stop.left).toBeGreaterThanOrEqual(ins.left + 8 - 0.5);
      expect(await rigCall(page, (rig) => rig.renders())).toBe(renders);
    });

    test('a mid-take viewport resize scales the frozen layout: zero renders, overlay within 1 px', async ({ page }) => {
      await mount(page, 12, ins);
      await rigCall(page, (rig) => rig.phase('countIn'));
      await rigCall(page, (rig) => rig.phase('performing'));
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
      // Safari bars expanding: the height shrinks, the width stays (same orientation).
      await page.setViewportSize({ width: v.width, height: Math.round(v.height * 0.85) });
      await expect.poll(() => rigCall(page, (rig) => rig.scale())).toBeLessThan(1);
      const scale = await rigCall(page, (rig) => rig.scale());
      const after = await measure();
      expect(await rigCall(page, (rig) => rig.renders())).toBe(renders);
      expect(after.svgW).toBeCloseTo(before.svgW * scale, 0);
      for (const k of ['note', 'ghost'] as const) {
        expect(Math.abs(after[k].x - before[k].x * scale)).toBeLessThanOrEqual(1);
        expect(Math.abs(after[k].y - before[k].y * scale)).toBeLessThanOrEqual(1);
      }
      expect(await rigCall(page, (rig) => rig.restarts())).toBe(0);
      const g = await geometry(page);
      expect(g.docScrolls).toBe(false);
      expect(g.frameScrolls).toBe(false);
    });

    test('computed styles: the take rules apply during a take and lift after it', async ({ page }) => {
      await mount(page, 12, ins);
      const styles = () =>
        page.evaluate(() => {
          const frame = document.querySelector('.sf-frame')!;
          const f = getComputedStyle(frame) as CSSStyleDeclaration & Record<string, string>;
          const h = getComputedStyle(document.documentElement);
          const b = getComputedStyle(document.body);
          const stop = getComputedStyle(document.getElementById('stop')!);
          return {
            htmlOverscroll: h.overscrollBehaviorX + ' ' + h.overscrollBehaviorY,
            bodyOverscroll: b.overscrollBehaviorX + ' ' + b.overscrollBehaviorY,
            frameTouch: f.touchAction,
            frameSelect: f.userSelect || f.webkitUserSelect,
            frameCallout: f.webkitTouchCallout ?? '',
            frameOverflow: f.overflow,
            stopTouch: stop.touchAction,
          };
        });
      const idle = await styles();
      expect(idle.frameTouch).not.toBe('none');
      expect(idle.htmlOverscroll).not.toBe('none none');
      expect(idle.stopTouch).toBe('manipulation');
      await rigCall(page, (rig) => rig.phase('countIn'));
      const take = await styles();
      expect(take.htmlOverscroll).toBe('none none');
      expect(take.bodyOverscroll).toBe('none none');
      expect(take.frameTouch).toBe('none');
      expect(take.frameSelect).toBe('none');
      // -webkit-touch-callout is a WebKit-only property: Chromium reports an empty string.
      expect(['none', '']).toContain(take.frameCallout);
      expect(take.frameOverflow).toBe('clip');
      expect(take.stopTouch).toBe('manipulation');
      // Taps on the score do nothing during a take.
      expect(await page.evaluate(() => getComputedStyle(document.querySelector('.sf-stage')!).pointerEvents)).toBe('none');
      await rigCall(page, (rig) => rig.phase('idle'));
      expect((await styles()).htmlOverscroll).not.toBe('none none');
    });
  });
}

test.describe('rotation', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('a rotation during the count-in re-lays out once and restarts the count-in once', async ({ page }) => {
    await mount(page, 12, { top: 47, right: 0, bottom: 34, left: 0 });
    await rigCall(page, (rig) => rig.phase('countIn'));
    const before = await rigCall(page, (rig) => rig.renders());
    await page.setViewportSize({ width: 844, height: 390 });
    await expect.poll(() => rigCall(page, (rig) => rig.restarts())).toBe(1);
    await page.waitForTimeout(200);
    // Further events at the new size (Safari settling its bars) do not restart again.
    await page.setViewportSize({ width: 844, height: 380 });
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(200);
    expect(await rigCall(page, (rig) => rig.restarts())).toBe(1);
    expect(await rigCall(page, (rig) => rig.controllerRestarts())).toBe(1);
    expect(await rigCall(page, (rig) => rig.renders())).toBeGreaterThan(before);
    const rotated = await rigCall(page, (rig) => rig.actions().filter((a) => a === 'rotate-restart').length);
    expect(rotated).toBe(1);
    const g = await geometry(page);
    expect(g.docScrolls).toBe(false);
    expect(g.frameScrolls).toBe(false);
  });

  test('a rotation while performing scales only: no re-render, no restart', async ({ page }) => {
    await mount(page, 12, { top: 47, right: 0, bottom: 34, left: 0 });
    await rigCall(page, (rig) => rig.phase('countIn'));
    await rigCall(page, (rig) => rig.phase('performing'));
    const before = await rigCall(page, (rig) => rig.renders());
    await page.setViewportSize({ width: 844, height: 390 });
    await expect.poll(() => rigCall(page, (rig) => rig.scale())).toBeLessThan(1);
    expect(await rigCall(page, (rig) => rig.renders())).toBe(before);
    expect(await rigCall(page, (rig) => rig.restarts())).toBe(0);
  });
});

test('the app CSS has no 100vh (dvh or svh only)', () => {
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n.endsWith('.css') && /(^|[^0-9.])100vh/.test(readFileSync(p, 'utf8'))) hits.push(p);
    }
  };
  walk(join(process.cwd(), 'src'));
  expect(hits).toEqual([]);
});
