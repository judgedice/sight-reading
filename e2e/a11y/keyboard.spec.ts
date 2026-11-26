// Keyboard (05 section 14 items 3 and 8): every radio group is one Tab stop and answers the arrow, Home and End keys;
// the setup sheet, the instrument dialog and the listen confirm move focus in when they open and give it back to the
// control that opened them when they close. Run on the light projects only (the keys do not depend on the theme).
//   pnpm exec playwright test -c e2e/a11y/playwright.a11y.config.ts keyboard.spec.ts
import { expect, test, type Page } from '@playwright/test';
import { isPhone } from './helpers.ts';
import { onboardWithVisits } from './onboard.ts';
import { go } from './routes.ts';

test.skip(process.env['E2E_A11Y'] !== '1', 'run with -c e2e/a11y/playwright.a11y.config.ts');
test.beforeEach(({ browserName: _b }, info) => {
  test.skip(!/-light$/.test(info.project.name), 'the light projects cover the keyboard');
});

interface GroupReport {
  label: string;
  radios: number;
  tabStops: number;
  problems: string[];
}

/**
 * Tab through the page once and count, for every radio group on it, how many of its radios take focus (must be one);
 * then drive each group with End, Home, ArrowRight and ArrowLeft. Groups are identified by their position among the
 * page's `[role="radiogroup"]` elements (React may re-create a node, so no attribute is stored on it).
 */
async function radioGroupReports(page: Page): Promise<GroupReport[]> {
  const reports: GroupReport[] = [];
  const count = await page.locator('[role="radiogroup"]').count();
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    const w = window as unknown as { __qaSeen: string[] };
    w.__qaSeen = [];
    document.addEventListener(
      'focusin',
      (e) => {
        const el = e.target as HTMLElement;
        const group = el.closest('[role="radiogroup"]');
        if (group && (el.getAttribute('role') === 'radio' || (el as HTMLInputElement).type === 'radio')) {
          const groups = Array.from(document.querySelectorAll('[role="radiogroup"]'));
          const radios = Array.from(group.querySelectorAll('[role="radio"], input[type="radio"]'));
          w.__qaSeen.push(`${groups.indexOf(group)}:${radios.indexOf(el)}`);
        }
      },
      true,
    );
  });
  for (let i = 0; i < 160; i++) {
    await page.keyboard.press('Tab');
    if (i > 3 && (await page.evaluate(() => document.activeElement === document.body))) break;
  }
  const seen = await page.evaluate(() => (window as unknown as { __qaSeen: string[] }).__qaSeen);
  const stops = new Map<number, Set<number>>();
  for (const s of seen) {
    const [g, r] = s.split(':').map(Number) as [number, number];
    if (!stops.has(g)) stops.set(g, new Set());
    stops.get(g)!.add(r);
  }
  const focusedIndex = (g: number): Promise<number> =>
    page.evaluate((idx) => {
      const grp = document.querySelectorAll('[role="radiogroup"]')[idx]!;
      const all = Array.from(grp.querySelectorAll('[role="radio"], input[type="radio"]'));
      return all.indexOf(document.activeElement as Element);
    }, g);
  for (let i = 0; i < count; i++) {
    const group = page.locator('[role="radiogroup"]').nth(i);
    // Behind an open dialog the page is out of reach: only the dialog's own groups can be tabbed to.
    const inert = await group.evaluate((e) => {
      const dialog = document.querySelector('[role="dialog"]');
      return !!e.closest('[inert], [aria-hidden="true"]') || (!!dialog && !dialog.contains(e));
    });
    if (inert || !(await group.isVisible())) continue;
    const label = (await group.getAttribute('aria-label')) ?? (await group.getAttribute('aria-labelledby')) ?? `group ${i}`;
    const radios = group.locator('[role="radio"], input[type="radio"]');
    const n = await radios.count();
    if (n === 0) continue;
    const problems: string[] = [];
    const stopSet = stops.get(i) ?? new Set<number>();
    if (stopSet.size !== 1) problems.push(`${stopSet.size} Tab stops (want 1)`);
    await radios.nth([...stopSet][0] ?? 0).focus();
    await page.keyboard.press('End');
    if ((await focusedIndex(i)) !== n - 1) problems.push(`End does not reach the last option (${await focusedIndex(i)} of ${n})`);
    await page.keyboard.press('Home');
    if ((await focusedIndex(i)) !== 0) problems.push(`Home does not reach the first option (${await focusedIndex(i)})`);
    if (n > 1) {
      await page.keyboard.press('ArrowRight');
      if ((await focusedIndex(i)) !== 1) problems.push(`ArrowRight from the first does not reach the second (${await focusedIndex(i)})`);
      const second = radios.nth(1);
      const blocked = (await second.getAttribute('aria-disabled')) === 'true' || (await second.isDisabled().catch(() => false));
      const checked = await second.evaluate((e) => (e as HTMLInputElement).checked === true || e.getAttribute('aria-checked') === 'true');
      if (!blocked && !checked) problems.push('ArrowRight moves focus but does not select');
      await page.keyboard.press('ArrowLeft');
      if ((await focusedIndex(i)) !== 0) problems.push(`ArrowLeft does not go back (${await focusedIndex(i)})`);
    }
    reports.push({ label, radios: n, tabStops: stopSet.size, problems });
  }
  return reports;
}

async function expectRadioGroups(page: Page, where: string, minGroups: number): Promise<void> {
  const reports = await radioGroupReports(page);
  process.stdout.write(`[radio] ${where}: ${reports.map((r) => `${r.label} (${r.radios})`).join(', ') || 'none'}\n`);
  const problems = reports.flatMap((r) => r.problems.map((p) => `${where}: radio group "${r.label}" (${r.radios} options): ${p}`));
  expect(reports.length, `${where}: radio groups found`).toBeGreaterThanOrEqual(minGroups);
  expect(problems).toEqual([]);
}

test('radio groups: one Tab stop, arrows, Home and End (onboarding, Practice, settings)', async ({ page }, info) => {
  await page.goto('./?testClock=1&testClockSec=10');
  await page.getByRole('button', { name: 'Get started' }).click();
  await expect(page.getByTestId('ob-instrument')).toBeVisible();
  await expectRadioGroups(page, 'onboarding instrument', 1);
  await page.getByRole('radio', { name: /Flute/ }).check();
  await page.getByRole('button', { name: 'Next: sound check' }).click();
  await page.getByRole('button', { name: 'Allow microphone' }).click();
  await page.getByRole('button', { name: 'Skip this check' }).click();
  await expect(page.getByTestId('calibration-card')).toBeVisible({ timeout: 15_000 });
  // The Timing stage's one radio-free control set: the output select and the footer.
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.getByTestId('ob-ready')).toBeVisible();
  await expectRadioGroups(page, 'onboarding ready', 0);
  await page.getByRole('button', { name: 'Go to Home' }).click();
  await expect(page.getByTestId('screen-home')).toBeVisible({ timeout: 15_000 });

  if (!isPhone(info.project.name)) {
    // Phones show the rows as chips; the groups live in the sheet (below). Desktop shows Key, Time, Length and Mode inline.
    await expectRadioGroups(page, 'Practice', 3);
  }
  await go(page, '#/settings/audio');
  await expectRadioGroups(page, 'Settings > Sound', 1);
  for (const section of ['display', 'practice', 'accessibility']) {
    await go(page, `#/settings/${section}`);
    await expectRadioGroups(page, `Settings > ${section}`, 0);
  }
});

test('radio groups in the phone setup sheet', async ({ page }, info) => {
  test.skip(!isPhone(info.project.name), 'the sheet is the phone layout');
  await onboardWithVisits(page, async () => undefined);
  for (const row of [/^Key:/, /^Time signature:/, /^Length:/]) {
    await page.getByRole('button', { name: row }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.waitForTimeout(500);
    await expectRadioGroups(page, `setup sheet ${String(row)}`, 1);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
});

/** The element that has focus: its tag, role and accessible name. */
async function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    const e = document.activeElement as HTMLElement | null;
    if (!e) return 'none';
    return `${e.tagName.toLowerCase()}[${e.getAttribute('role') ?? ''}] ${e.getAttribute('aria-label') ?? e.textContent?.trim().slice(0, 40) ?? ''}`;
  });
}

test('the instrument dialog and the phone setup sheet move focus in and give it back', async ({ page }, info) => {
  await onboardWithVisits(page, async () => undefined);
  const phone = isPhone(info.project.name);

  // The instrument dialog.
  const change = page.getByRole('button', { name: /Change instrument/ }).first();
  await change.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(400);
  expect(await dialog.evaluate((d) => d.contains(document.activeElement)), `focus is inside the instrument dialog: ${await focused(page)}`).toBe(true);
  // The dialog traps focus: Tab through more stops than it has and stay inside.
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((d) => d.contains(document.activeElement)), `Tab ${i} left the dialog for ${await focused(page)}`).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await change.evaluate((b) => b === document.activeElement), `focus returns to "Change instrument", not ${await focused(page)}`).toBe(true);

  if (!phone) return;

  // The setup sheet, from each chip: focus lands on the chosen row's control, and Escape returns it to the chip.
  for (const [name, row] of [[/^Key:/, 'key'], [/^Time signature:/, 'time'], [/^Difficulty:/, 'difficulty'], [/^Length:/, 'length']] as const) {
    const chip = page.getByRole('button', { name });
    await chip.focus();
    await page.keyboard.press('Enter');
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(500);
    const inRow = await page.evaluate((r) => {
      const a = document.activeElement;
      const rowEl = document.querySelector(`[role="dialog"] [data-setup-row="${r}"]`);
      // A row with nothing to choose (a single available length) has no control: the sheet's own button takes focus.
      const hasControl = !!rowEl?.querySelector('button, input, select, [role="radio"], [tabindex]');
      return !!a && !!rowEl && (hasControl ? rowEl.contains(a) : document.querySelector('[role="dialog"]')!.contains(a));
    }, row);
    expect(inRow, `opening the sheet from ${row} focuses that row's control, not ${await focused(page)}`).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await chip.evaluate((b) => b === document.activeElement), `closing the sheet returns focus to the ${row} chip, not ${await focused(page)}`).toBe(true);
  }
});

test('the instrument dialog\'s radio group is one Tab stop with arrows, Home and End', async ({ page }) => {
  await onboardWithVisits(page, async () => undefined);
  await page.getByRole('button', { name: /Change instrument/ }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.waitForTimeout(500);
  await expectRadioGroups(page, 'instrument dialog', 1);
});

type Sr = { __sr: { session: { current: { settings: Record<string, unknown> } | null; prepare(s: Record<string, unknown>): Promise<unknown> } } };

test('the listen confirm focuses Keep it ranked and gives focus back to Listen first', async ({ page }) => {
  await onboardWithVisits(page, async () => undefined);
  await page.getByRole('button', { name: /^Start (practice|ranked try)/ }).click();
  await expect(page.getByTestId('scan-cover')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => (window as unknown as Sr).__sr.session.current !== null), { timeout: 30_000 }).toBe(true);
  // Ranked needs a calibrated route and the fake microphone hears no clicks: ask the session for the ranked excerpt the way Start does.
  await page.evaluate(async () => {
    const s = (window as unknown as Sr).__sr.session;
    await s.prepare({ ...s.current!.settings, mode: 'ranked', outputMode: 'wired', listening: true });
  });
  const scan = page.getByTestId('screen-practice.scan');
  await expect(scan).toHaveAttribute('data-mode', 'ranked');
  await page.getByRole('button', { name: 'Show the music' }).click();
  await expect(scan).toHaveAttribute('data-state', 'scanning');

  const listen = page.getByRole('button', { name: /^Listen first/ });
  await listen.focus();
  await page.keyboard.press('Enter');
  const confirm = page.getByRole('dialog', { name: 'Listen first?' });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole('button', { name: 'Keep it ranked' })).toBeFocused();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    expect(await confirm.evaluate((d) => d.contains(document.activeElement)), `Tab ${i} left the confirm for ${await focused(page)}`).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(confirm).toHaveCount(0);
  expect(await listen.evaluate((b) => b === document.activeElement), `focus returns to Listen first, not ${await focused(page)}`).toBe(true);
  await expect(scan).toHaveAttribute('data-mode', 'ranked');
});
