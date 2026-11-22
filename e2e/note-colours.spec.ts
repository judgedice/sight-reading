// Note colours (PLAN R69) in Chromium against the production build: with Settings > Display > Note colours on, every
// written notehead on the read-through is filled in its letter's colour (the `--head-*` token for the theme) while its
// stem stays ink; with it off, no head is coloured. Runs in the default `pnpm test:e2e` (chromium project only).
import { expect, test, type Page } from '@playwright/test';
import { onboard, setupAndStart, watchErrors } from './loop/flow.ts';

/** The bold values from design/tokens.json (`head-*`, PLAN R73, the same in every theme), as computed rgb(). */
const LIGHT: Record<string, string> = {
  c: 'rgb(255, 0, 0)',
  d: 'rgb(255, 128, 0)',
  e: 'rgb(255, 213, 0)',
  f: 'rgb(0, 170, 0)',
  g: 'rgb(0, 102, 255)',
  a: 'rgb(136, 0, 204)',
  b: 'rgb(255, 20, 147)',
};

interface Head {
  letter: string;
  fill: string;
  /** The head's outline (PLAN R73: ink when coloured, none when not). */
  stroke: string;
  stem: string | null;
}

/** Each drawn note's letter, its head's computed fill and its stem's computed stroke, plus the ink colour. */
function heads(page: Page): Promise<{ ink: string; heads: Head[] }> {
  return page.evaluate(() => {
    const probe = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    probe.style.color = 'var(--ink)';
    document.querySelector('.sf-score')!.appendChild(probe);
    const ink = getComputedStyle(probe).color;
    probe.remove();
    const out: { letter: string; fill: string; stroke: string; stem: string | null }[] = [];
    for (const g of Array.from(document.querySelectorAll('.sf-score .sr-note[data-letter]'))) {
      const head = g.querySelector('.vf-notehead > text:first-child');
      if (!head) continue;
      const stem = g.querySelector('.vf-stem path, .vf-stem');
      out.push({ letter: g.getAttribute('data-letter')!, fill: getComputedStyle(head).fill, stroke: getComputedStyle(head).stroke, stem: stem ? getComputedStyle(stem).stroke : null });
    }
    return { ink, heads: out };
  });
}

async function setNoteColours(page: Page, on: boolean): Promise<void> {
  await page.evaluate(() => (location.hash = '#/settings/display'));
  const sw = page.getByRole('switch', { name: 'Note colours' });
  await expect(sw).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('note-colour-key')).toHaveAttribute('aria-label', 'Colour key: C red, D orange, E yellow, F green, G blue, A purple, B pink');
  // The drawn track sits over the native checkbox, as for every switch: set it through the input.
  await sw.setChecked(on, { force: true });
  await expect(sw).toBeChecked({ checked: on });
  if (on) await expect(page.locator('html')).toHaveAttribute('data-note-colours', 'on');
  else await expect(page.locator('html')).not.toHaveAttribute('data-note-colours', 'on');
  await page.evaluate(() => (location.hash = '#/'));
  await expect(page.getByTestId('screen-home')).toBeVisible({ timeout: 15_000 });
}

async function readThrough(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Show the music' }).click();
  const scan = page.getByTestId('screen-practice.scan');
  await expect(scan).toHaveAttribute('data-state', 'scanning', { timeout: 30_000 });
  await expect(scan.locator('.sr-note[data-letter]').first()).toBeVisible({ timeout: 30_000 });
}

test('note colours: heads coloured by letter on the read-through when on, none when off', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium', 'Chromium, once');
  test.setTimeout(180_000);
  await page.emulateMedia({ colorScheme: 'light' });
  const errors = watchErrors(page);
  await onboard(page, 'decline');

  // Off by default: no head is coloured.
  await expect(page.locator('html')).not.toHaveAttribute('data-note-colours', 'on');
  await setupAndStart(page);
  await readThrough(page);
  const off = await heads(page);
  expect(off.heads.length).toBeGreaterThan(4);
  for (const h of off.heads) expect(h.fill, `off: ${h.letter}`).toBe(off.ink);

  // On: every head takes its letter's colour, and the stems stay ink.
  await setNoteColours(page, true);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('scan-cover')).toBeVisible({ timeout: 30_000 });
  await readThrough(page);
  const on = await heads(page);
  expect(on.heads.length).toBeGreaterThan(4);
  const letters = new Set<string>();
  for (const h of on.heads) {
    expect(h.fill, `on: ${h.letter}`).toBe(LIGHT[h.letter]);
    expect(h.stroke, `outline of ${h.letter}`).toBe(on.ink);
    if (h.stem !== null) expect(h.stem, `stem of ${h.letter}`).toBe(on.ink);
    letters.add(h.letter);
  }
  expect(letters.size, 'several letters in the excerpt').toBeGreaterThan(2);

  // Off again: back to ink, exactly as before.
  await setNoteColours(page, false);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('scan-cover')).toBeVisible({ timeout: 30_000 });
  await readThrough(page);
  const again = await heads(page);
  for (const h of again.heads) expect(h.fill, `off again: ${h.letter}`).toBe(again.ink);
  expect(errors).toEqual([]);
});
