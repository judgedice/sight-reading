// QA walk (08-plan package qa): every screen of the app at the project's size and look, checking on each
//   - the word "level" never appears in rendered text or assistive names (05 section 16 item 3);
//   - every visible text run is catalogue copy from en.json or a known kind of dynamic text (designer's check);
//   - axe: no serious or critical violation, which includes colour contrast in light, dark and high contrast, take and results included;
//   - coarse pointer (phone projects): every interactive element is at least 44 x 44 px (05 section 14 item 9);
//   - reduced motion (reduced projects): no pulse, scale or smooth scroll (05 section 14 item 12);
//   - every control disabled in the DOM shows a reason (05 section 16 item 4);
//   - no horizontal overflow on a phone.
// Failures are collected over the whole walk and reported together.
//   pnpm exec playwright test -c e2e/a11y/playwright.a11y.config.ts walk.spec.ts
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { createCopyMatcher, loadCatalogue, loadInstrumentData } from './copy-match.ts';
import { isDynamicText } from './dynamic-text.ts';
import {
  accessibleLabels, axeSeriousViolations, disabledWithoutReason, forceHighContrast, horizontalOverflow, isHighContrast, isPhone, isReduced,
  movingAnimations, pulsingOrScaling, smallTargets, smoothScrollCalls, smoothScrollers, visibleTextRuns, wavFor, watchSmoothScroll,
} from './helpers.ts';
import { walkScreens } from './walk.ts';

test.skip(process.env['E2E_A11Y'] !== '1', 'run with -c e2e/a11y/playwright.a11y.config.ts');

const LEVEL = /\blevel\b/i;

/** With A11Y_SHOTS=1 these screens are saved to docs/redesign/shots-build/qa/<project>/ (08-plan rule 5). */
const SHOT_SCREENS = new Set(['welcome', 'onboarding-instrument-picked', 'home', 'home-instrument-dialog', 'home-setup-sheet-key', '#/settings/audio', '#/progress', 'scan-cover', 'read-through', 'count-in', 'take', 'results', 'results-setup-sheet', 'history-attempt', '#/calibrate', 'calibrate-listening']);

test('every screen: no "level", catalogue copy, axe, targets, motion, disabled reasons', async ({ page, hasTouch }, info) => {
  const name = info.project.name;
  const matcher = createCopyMatcher(loadCatalogue(), loadInstrumentData(), isDynamicText);
  const problems: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  if (isHighContrast(name)) await forceHighContrast(page);
  if (isReduced(name)) await watchSmoothScroll(page);

  const visit = async (screen: string, light = false): Promise<void> => {
    await page.waitForTimeout(250);
    if (process.env['A11Y_SHOTS'] === '1' && SHOT_SCREENS.has(screen)) {
      const dir = join(process.cwd(), 'docs', 'redesign', 'shots-build', 'qa', name);
      mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: join(dir, `${screen.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}.png`), animations: 'disabled' });
    }
    const at = (s: string): string => `${screen}: ${s}`;
    const runs = await visibleTextRuns(page);
    for (const t of [...runs.map((r) => r.text), ...(await accessibleLabels(page))]) if (LEVEL.test(t)) problems.push(at(`the word "level" in "${t}"`));
    // Dev gallery and replay are developer tools: their text is not player copy.
    if (!screen.startsWith('#/dev/')) {
      const seen = new Set<string>();
      for (const { text: t, where } of runs) {
        if (seen.has(t)) continue;
        seen.add(t);
        if (!matcher.matches(t)) problems.push(at(`text not in en.json: "${t}" (${where})`));
      }
    }
    if (!light) for (const v of await axeSeriousViolations(page)) problems.push(at(`axe ${v.impact} ${v.id}: ${v.nodes.join(' ;; ')}`));
    if (hasTouch && !light) for (const t of await smallTargets(page)) problems.push(at(`tap target ${t.w}x${t.h} ${t.desc}`));
    if (!screen.startsWith('#/dev/')) for (const d of await disabledWithoutReason(page)) problems.push(at(`disabled without a visible reason: ${d}`));
    if (isReduced(name)) {
      for (const m of await movingAnimations(page)) problems.push(at(`moving animation ${m}`));
      for (const m of await pulsingOrScaling(page)) problems.push(at(`pulse or scale ${m}`));
      for (const m of await smoothScrollers(page)) problems.push(at(`smooth scroll ${m}`));
      for (const m of await smoothScrollCalls(page)) problems.push(at(`smooth scroll call ${m}`));
    }
    if (isPhone(name)) {
      const over = await horizontalOverflow(page);
      if (over > 0) problems.push(at(`horizontal overflow ${over}px`));
    }
  };

  await walkScreens(page, wavFor(name), isPhone(name), visit, (m) => problems.push(m));

  for (const e of errors) problems.push(`page error: ${e}`);
  info.annotations.push({ type: 'problems', description: problems.join('\n') || 'none' });
  process.stdout.write(`[${name}] ${problems.length} problems\n${[...new Set(problems)].join('\n')}\n`);
  expect(problems).toEqual([]);
});
