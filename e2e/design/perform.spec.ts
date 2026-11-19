// Performance screen (04 5.4, 13.1 items 3 and 8): the toolbar on the narrowest phones shows the bar and tempo without
// an ellipsis, interactive elements meet 44 px under a coarse pointer, and nothing moves under reduced motion. Axe skips
// the performance screen by spec.
import { expect, test } from '@playwright/test';
import { movingAnimations, onboard, smallTargets } from './helpers.ts';

test.skip(process.env['E2E_DESIGN'] !== '1', 'run with -c e2e/design/playwright.design.config.ts');

test('performance toolbar: no ellipsis, 44 px targets, no motion when reduced', async ({ page, hasTouch }, info) => {
  await onboard(page);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
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
