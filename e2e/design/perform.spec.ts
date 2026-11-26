// Performance screen (04 5.4, 13.1 items 3 and 8): the toolbar on the narrowest phones shows the bar and tempo without
// an ellipsis, interactive elements meet 44 px under a coarse pointer, and nothing moves under reduced motion. Axe skips
// the performance screen by spec.
import { expect, test, type Page } from '@playwright/test';
import { movingAnimations, onboard, smallTargets } from './helpers.ts';
import { walkWizard } from '../loop/flow.ts';

test.skip(process.env['E2E_DESIGN'] !== '1', 'run with -c e2e/design/playwright.design.config.ts');

test('performance toolbar: no ellipsis, 44 px targets, no motion when reduced', async ({ page, hasTouch }, info) => {
  await onboard(page);
  await page.getByRole('button', { name: /^Start (practice|ranked try)/ }).click();
  await expect(page.getByTestId('scan-cover')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Show the music' }).click();
  await expect(page.getByTestId('screen-practice.scan')).toHaveAttribute('data-state', 'scanning');
  await page.getByRole('button', { name: 'Start playing' }).click();
  const play = page.getByTestId('screen-practice.play');
  await expect(play).toBeVisible({ timeout: 15_000 });
  await expect(play).toHaveAttribute('data-state', /count-in|performing/);
  await page.waitForTimeout(600);

  await page.screenshot({ path: `test-results/design-e2e/perform-${info.project.name}.png` });
  const problems: string[] = [];
  const clipped = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.perform-toolbar *'))
      .filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).textOverflow === 'ellipsis')
      .map((e) => `${e.className}: ${e.scrollWidth} > ${e.clientWidth} "${e.textContent}"`),
  );
  for (const c of clipped) problems.push(`toolbar text clipped: ${c}`);
  const bar = await page.evaluate(() => {
    const t = document.querySelector<HTMLElement>('.perform-toolbar');
    return t ? t.scrollWidth - t.clientWidth : 0;
  });
  if (bar > 1) problems.push(`toolbar overflows by ${bar}px`);
  if (hasTouch) for (const t of await smallTargets(page)) problems.push(`tap target ${t.w}x${t.h} ${t.desc}`);
  if (info.project.name.includes('reduced-motion')) for (const m of await movingAnimations(page)) problems.push(`moving animation ${m}`);
  info.annotations.push({ type: 'problems', description: problems.join('\n') || 'none' });
  process.stdout.write(`[${info.project.name}] perform: ${problems.join('\n') || 'none'}\n`);
  expect(problems).toEqual([]);
});

/** The onboarding of `onboard`, with a voice: the starting pitch plays before the count-in (01-ux section 10). */
async function onboardVoice(page: Page): Promise<void> {
  await page.goto('./');
  await walkWizard(page, { mic: 'allow', instrument: /Baritone/ });
}

interface CountInSample {
  click: number;
  bar: number;
  title: string;
  detail: string;
  entryOn: boolean;
  minOpacity: number;
  focusable: number;
  buttons: number;
}

test('before the music: the starting-pitch card, then a count-in track that says which bar is last, at full ink', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-light' && info.project.name !== 'desktop-dark' && info.project.name !== 'iphone-light' && info.project.name !== 'iphone-dark', 'four looks are enough');
  await onboardVoice(page);
  await page.getByRole('button', { name: /^Start (practice|ranked try)/ }).click();
  await expect(page.getByTestId('scan-cover')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Show the music' }).click();
  await expect(page.getByTestId('screen-practice.scan')).toHaveAttribute('data-state', 'scanning');
  // Records the track at each click, in the page, so no click is missed between two polls.
  await page.evaluate(() => {
    const w = window as unknown as { __countIn: unknown[] };
    w.__countIn = [];
    const opacityOf = (e: Element | null): number => {
      let o = 1;
      for (let x = e; x; x = x.parentElement) o *= Number(getComputedStyle(x).opacity);
      return o;
    };
    let last = -1;
    const sample = (): void => {
      const c = document.querySelector('.sf-count');
      const click = Number(c?.getAttribute('data-click') ?? -1);
      if (!c || click === last || click <= 0) return;
      last = click;
      const band = document.querySelector('.sf-band');
      w.__countIn.push({
        click,
        bar: Number(c.getAttribute('data-bar')),
        title: c.querySelector('.sf-count-title')?.textContent ?? '',
        detail: c.querySelector('.sf-count-detail')?.textContent ?? '',
        entryOn: c.querySelector('.sf-count-entry')?.hasAttribute('data-on') ?? false,
        minOpacity: Math.min(...Array.from(document.querySelectorAll('.sr-slot')).map(opacityOf)),
        focusable: band?.querySelectorAll('a, button, input, select, textarea, [tabindex]').length ?? 0,
        buttons: band?.querySelectorAll('button, [role="button"]').length ?? 0,
      });
    };
    new MutationObserver(sample).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-click'] });
  });
  await page.getByRole('button', { name: 'Start playing' }).click();
  const play = page.getByTestId('screen-practice.play');
  await expect(play).toBeVisible({ timeout: 15_000 });

  // The starting pitch: the card, the strip line, the score dimmed.
  const card = page.getByTestId('perform-pitch');
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.perform-marks-start')).toHaveText('Marks start at bar 1');
  await expect(page.locator('.sf-host')).toHaveAttribute('data-dim', '');
  await expect(card.locator('.perform-pitch-step[data-step="live"]')).toHaveCount(1, { timeout: 5_000 });
  await page.screenshot({ path: `test-results/design-e2e/perform-reference-${info.project.name}.png` });

  // The count-in: one bar (PLAN R70), a plain count; the entry word only on the music's first beat.
  await expect(page.locator('.sf-count-cell[data-state="current"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.sf-host')).not.toHaveAttribute('data-dim', '');
  // From the first click the strip says "Count-in" with the mic meter; "Marks start at bar 1" was the card's.
  await expect(page.locator('.perform-marks-start')).toHaveCount(0);
  await page.screenshot({ path: `test-results/design-e2e/perform-countin-last-${info.project.name}.png` });
  await expect(play).toHaveAttribute('data-state', 'performing', { timeout: 30_000 });
  // The track stays for the go beat (with the entry word), then goes.
  await expect(page.locator('.sf-count')).toHaveCount(0, { timeout: 10_000 });
  await page.waitForTimeout(150);
  await page.screenshot({ path: `test-results/design-e2e/perform-music-${info.project.name}.png` });

  const samples = (await page.evaluate(() => (window as unknown as { __countIn: unknown[] }).__countIn)) as CountInSample[];
  const bars = [...new Set(samples.map((s) => s.bar))];
  expect(bars).toEqual([1]);
  // One plain bar; a piece that starts with a pickup says when to come in ("Come in after 3").
  expect(new Set(samples.map((s) => s.title)).size).toBe(1);
  expect(samples[0]!.title).toMatch(/^(Count-in: listen to the beat|Come in after \d+)$/);
  expect(samples[0]!.detail).not.toContain('Count-in bar');
  // The entry word shows only once the music starts (the go beat: the track then shows every count as counted).
  const max = Math.max(...samples.map((s) => s.click));
  for (const s of samples) if (s.entryOn) expect(s.click, 'entry word before the go beat').toBe(max);
  expect(samples.filter((s) => s.click < max).some((s) => s.entryOn)).toBe(false);
  // Never a control, and every system at full ink from the first click.
  for (const s of samples) {
    expect(s.focusable).toBe(0);
    expect(s.buttons).toBe(0);
    expect(s.minOpacity).toBe(1);
  }
  await page.getByRole('button', { name: 'Stop' }).click();
});

test('the count-in track fits the paper on every width', async ({ page }, info) => {
  await onboard(page);
  await page.getByRole('button', { name: /^Start (practice|ranked try)/ }).click();
  await expect(page.getByTestId('scan-cover')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Show the music' }).click();
  await expect(page.getByTestId('screen-practice.scan')).toHaveAttribute('data-state', 'scanning');
  await page.getByRole('button', { name: 'Start playing' }).click();
  await expect(page.locator('.sf-count-cell[data-state="current"]')).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: `test-results/design-e2e/perform-track-${info.project.name}.png` });
  const out = await page.evaluate(() => {
    const paper = document.querySelector('.perform-score')!.getBoundingClientRect();
    return Array.from(document.querySelectorAll('.sf-count-cell, .sf-count-word'))
      .map((e) => e.getBoundingClientRect())
      .filter((r) => r.left < paper.left - 0.5 || r.right > paper.right + 0.5 || r.top < paper.top - 0.5).length;
  });
  expect(out).toBe(0);
});
