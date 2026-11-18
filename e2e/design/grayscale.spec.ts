// Grayscale distinctness (04 13.1 item 4): on #/dev/components every pair of verdict states is rendered with a
// grayscale(1) filter, and the notehead-plus-lane box of one must differ from the other's by at least 8% of its pixels.
// Pairs are the states drawn in different colours (ink, correct, error, hollow error): colour is the only thing grayscale
// removes there. Two error states share a colour and differ by their lane glyph in every theme, so grayscale changes
// nothing about them and they are not compared.
import { expect, test } from '@playwright/test';
import { go, onboard } from './helpers.ts';

test.skip(process.env['E2E_DESIGN'] !== '1', 'run with -c e2e/design/playwright.design.config.ts');

const IDS = ['pending', 'correct', 'marginal', 'early', 'late', 'sharp', 'flat', 'wrong-pitch', 'octave', 'missed'];
const MIN_DIFF = 0.08;

test('verdict states differ pairwise by at least 8% of pixels in grayscale', async ({ page }, info) => {
  await onboard(page);
  await go(page, '#/dev/components');
  await expect(page.getByTestId('screen-dev-components')).toBeVisible({ timeout: 60_000 });
  await page.addStyleTag({ content: '[data-testid^="verdict-"] { filter: grayscale(1); }' });
  await page.waitForTimeout(300);
  const classes: Record<string, string> = {};
  for (const id of IDS) classes[id] = (await page.getByTestId(`verdict-${id}`).getAttribute('data-note-class')) ?? '';
  const shots: Record<string, string> = {};
  for (const id of IDS) shots[id] = (await page.getByTestId(`verdict-${id}`).screenshot({ animations: 'disabled' })).toString('base64');
  // No PNG decoder in the repo: decode and compare inside the page with a canvas.
  const result = await page.evaluate(
    async ({ shots: s, ids, min, classes: cl }) => {
      const px = async (b64: string): Promise<{ w: number; h: number; g: Float32Array }> => {
        const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
        const c = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d')!;
        c.drawImage(bmp, 0, 0);
        const d = c.getImageData(0, 0, bmp.width, bmp.height).data;
        const g = new Float32Array(bmp.width * bmp.height);
        for (let i = 0; i < g.length; i++) g[i] = 0.299 * d[i * 4]! + 0.587 * d[i * 4 + 1]! + 0.114 * d[i * 4 + 2]!;
        return { w: bmp.width, h: bmp.height, g };
      };
      const imgs = new Map<string, { w: number; h: number; g: Float32Array }>();
      for (const id of ids) imgs.set(id, await px(s[id]!));
      const all: string[] = [];
      const bad: string[] = [];
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          if (cl[ids[i]!] === cl[ids[j]!]) continue;
          const a = imgs.get(ids[i]!)!;
          const b = imgs.get(ids[j]!)!;
          if (a.w !== b.w || a.h !== b.h) { bad.push(`${ids[i]} vs ${ids[j]}: box sizes differ`); continue; }
          let diff = 0;
          for (let p = 0; p < a.g.length; p++) if (Math.abs(a.g[p]! - b.g[p]!) > 24) diff++;
          const line = `${ids[i]} vs ${ids[j]}: ${((100 * diff) / a.g.length).toFixed(1)}%`;
          all.push(line);
          if (diff / a.g.length < min) bad.push(line);
        }
      }
      return { all, bad };
    },
    { shots, ids: IDS, min: MIN_DIFF, classes },
  );
  const lowest = result.all;
  const bad = result.bad;
  info.annotations.push({ type: 'pairs', description: lowest.join('\n') });
  expect(bad).toEqual([]);
});
