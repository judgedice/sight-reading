// Design QA over every route (04 13.1 items 3, 5 and 8). One pass per project walks the onboarding steps, home, the scan
// cover, every tab and secondary route, and the dev gallery, and on each screen checks
//   - axe: zero serious or critical violations (projects differ in colour scheme, so both themes are covered);
//   - tap targets: every interactive element is at least 44 x 44 CSS px under a coarse pointer (touch projects);
//   - reduced motion: no running animation moves anything (the reduced-motion project).
// Failures are collected over the whole walk and reported together, so one run lists every violation.
import { expect, test } from '@playwright/test';
import { axeSeriousViolations, go, HASH_ROUTES, movingAnimations, onboard, smallTargets } from './helpers.ts';

test.skip(process.env['E2E_DESIGN'] !== '1', 'run with -c e2e/design/playwright.design.config.ts');

test('every route: axe, tap targets and reduced motion', async ({ page, hasTouch }, info) => {
  const reduced = info.project.name.includes('reduced-motion');
  const problems: string[] = [];
  const check = async (name: string): Promise<void> => {
    await page.waitForTimeout(250);
    for (const v of await axeSeriousViolations(page)) problems.push(`${name}: axe ${v.impact} ${v.id}: ${v.nodes.join(' ;; ')}`);
    if (hasTouch) for (const t of await smallTargets(page)) problems.push(`${name}: tap target ${t.w}x${t.h} ${t.desc}`);
    if (reduced) for (const m of await movingAnimations(page)) problems.push(`${name}: moving animation ${m}`);
  };

  await onboard(page, check);
  for (const hash of HASH_ROUTES) {
    await go(page, hash);
    await check(hash);
  }

  // The scan cover: from home, Start.
  await go(page, '#/');
  await page.getByRole('combobox', { name: 'Output' }).selectOption({ label: 'Wired headphones' });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('scan-cover')).toBeVisible({ timeout: 30_000 });
  await check('scan-cover');

  info.annotations.push({ type: 'problems', description: problems.join('\n') || 'none' });
  process.stdout.write(`[${info.project.name}] ${problems.length} problems\n${problems.join('\n')}\n`);
  expect(problems).toEqual([]);
});
