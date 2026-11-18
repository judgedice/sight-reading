// P15 in real Chromium (01 section 15, P15 row): 200 ghosts plus 200 glyphs hold 60 fps while the follower keeps
// re-sending marks and the playhead moves; no VexFlow render happens; the overlay stays inside its node budget.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { CorpusIndex, ExcerptChunk, ExcerptDoc } from '../../src/core/types.ts';
import { openOverlayPage } from './overlay-page.ts';

const readJson = <T>(rel: string): T => JSON.parse(readFileSync(join(process.cwd(), rel), 'utf8')) as T;
const pct = (xs: number[], q: number): number => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * q))]!;

test('200 ghosts and 200 glyphs at 60 fps with no VexFlow re-render', async ({ page }) => {
  const idx = readJson<CorpusIndex>('fixtures/corpus/index.json');
  const doc: ExcerptDoc = readJson<ExcerptChunk>(`fixtures/corpus/${idx.chunks[0]!.file}`).excerpts[0]!;
  const sprite = readFileSync(join(process.cwd(), 'src/ui/glyphs.svg'), 'utf8');
  await openOverlayPage(page);

  const result = await page.evaluate(
    async ({ doc, sprite }) => {
      type Rig = {
        mount(d: unknown, c: string, v: unknown, n: number, s: string): { p: unknown; notes: number };
        populate(p: unknown, n: number): { ghosts: unknown[] };
        counts(): { ghosts: number; glyphs: number; overlayNodes: number };
        view: { renderCount: number; setPlayhead(b: number | null): void };
        frames(p: unknown, g: unknown[], ms: number): Promise<{ frameMs: number[]; jsMs: number[] }>;
      };
      const rig = (window as unknown as { overlayRig: Rig }).overlayRig;
      const { p, notes } = rig.mount(doc, 'treble', { width: 1280, height: 800 }, 230, sprite);
      const { ghosts } = rig.populate(p, 200);
      rig.view.setPlayhead(0);
      const renders = rig.view.renderCount;
      const counts = rig.counts();
      const before = counts.overlayNodes;
      const t = await rig.frames(p, ghosts, 3000);
      const after = rig.counts();
      return { notes, counts, after, ...t, before, extraRenders: rig.view.renderCount - renders };
    },
    { doc, sprite },
  );

  test.info().annotations.push({
    type: 'frame-stats',
    description: JSON.stringify({
      notes: result.notes,
      counts: result.counts,
      frames: result.frameMs.length,
      frameP50: pct(result.frameMs, 0.5),
      frameP95: pct(result.frameMs, 0.95),
      frameMax: Math.max(...result.frameMs),
      jsP95: pct(result.jsMs, 0.95),
      jsMax: Math.max(...result.jsMs),
    }),
  });
  expect(result.extraRenders).toBe(0);
  expect(result.counts.ghosts).toBeGreaterThanOrEqual(200);
  expect(result.counts.glyphs).toBeGreaterThanOrEqual(200);
  // Re-sent marks change nothing: the node count is the same after 3 s of traffic.
  expect(result.after.overlayNodes).toBe(result.before);
  // 60 fps: the median frame is one vsync and the 95th percentile does not miss two.
  expect(pct(result.frameMs, 0.5)).toBeLessThan(18);
  expect(pct(result.frameMs, 0.95)).toBeLessThan(34);
  // The overlay's own work per frame stays a small slice of the 16.7 ms budget.
  expect(pct(result.jsMs, 0.95)).toBeLessThan(4);
});
