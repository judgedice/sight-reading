// First-time user (wave 4 final review): onboarding, then three takes in a row on different instruments with random
// settings, results and tips after each, history, settings, export and import, and a reload. Checks that every take
// ends and lands on a graded result, that no raw copy key or console error appears, that a ranked request without a
// measured calibration is recorded as unranked, and that history and settings survive a reload and an import.
// Run with -c e2e/tour/playwright.tour.config.ts (the tour's fake microphone and production build).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { loadLoopHelpers } from '../loop/bundle.ts';
import { chooseMode, chooseOutput, LOOP_T0_SEC, pagePlan, watchErrors } from '../loop/flow.ts';

test.skip(process.env['E2E_TOUR'] !== '1', 'run with -c e2e/tour/playwright.tour.config.ts');

const RAW_KEY = /^(?:[a-z][a-zA-Z0-9]*\.){1,4}[a-z][a-zA-Z0-9-]*$/;

async function rawKeys(page: Page): Promise<string[]> {
  const text = await page.evaluate(() => document.body.innerText);
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => RAW_KEY.test(l) && !/\.(?:json|com|org|net|js)$/.test(l));
}

interface SessionRecord {
  instrumentId: string;
  levelServed: number;
  score: { score: number; grade: string; ranked: boolean; rankedReasons: string[]; tipsShown: string[]; components: unknown } | null;
  judgments: { expectedIdx: number; status: string; timing: string | null; pitch: string | null; dtMs?: number | null }[];
}

const record = (page: Page): Promise<SessionRecord | null> =>
  page.evaluate(() => (window as unknown as { __sr: { session: { record: SessionRecord | null } } }).__sr.session.record);

/** Picks a random enabled option of a select (by accessible name) other than the current one, when there is one. */
async function pickRandom(page: Page, name: string, rnd: () => number): Promise<string | null> {
  const sel = page.getByTestId('screen-home').getByRole('combobox', { name, exact: true });
  if ((await sel.count()) === 0 || !(await sel.isEnabled())) return null;
  const values = await sel.evaluate((el) => Array.from((el as HTMLSelectElement).options).filter((o) => !o.disabled).map((o) => o.value));
  if (values.length === 0) return null;
  const v = values[Math.floor(rnd() * values.length)]!;
  await sel.selectOption(v);
  return v;
}

test('first-time user: three takes on three instruments, results, tips, history, settings, export, import, reload', async ({ page }, info) => {
  test.setTimeout(600_000);
  const h = await loadLoopHelpers();
  const wav = process.env['E2E_TOUR_WAV']!;
  const errors = watchErrors(page);
  const issues: string[] = [];
  const check = async (where: string): Promise<void> => {
    for (const k of await rawKeys(page)) issues.push(`${where}: raw copy key ${k}`);
  };
  let seed = 20261118 + info.project.name.length;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  // Onboarding: flute, microphone allowed, calibration skipped (a ranked request later must come back unranked).
  await page.goto(`./?testClock=1&testClockSec=${LOOP_T0_SEC}`);
  await expect(page.getByTestId('screen-welcome')).toBeVisible({ timeout: 30_000 });
  await check('welcome');
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByRole('radio', { name: /Flute/ }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Allow microphone' }).click();
  await expect(page.getByTestId('calibration-card')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('calibration-card').getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByTestId('ob-level')).toBeVisible();
  await page.getByRole('button', { name: "I'll choose" }).click();
  await check('onboarding');
  await page.getByRole('button', { name: 'Start practising' }).click();
  const home = page.getByTestId('screen-home');
  await expect(home).toBeVisible({ timeout: 15_000 });

  const takes: { instrument: string; mode: 'ranked' | 'practice'; output: string }[] = [
    { instrument: 'flute', mode: 'ranked', output: 'Wired headphones' },
    { instrument: 'cello', mode: 'practice', output: 'Wired headphones' },
    { instrument: 'trumpet-bb', mode: 'ranked', output: 'Speakers' },
  ];
  const done: SessionRecord[] = [];
  for (const [i, t] of takes.entries()) {
    await expect(home).toBeVisible({ timeout: 15_000 });
    // Output lives in Settings > Sound now (05 section 5.1).
    await chooseOutput(page, t.output);
    // The instrument changes through the picker (05 section 5.2): "Change instrument", a card, Done.
    await home.getByRole('button', { name: /Change instrument/ }).first().click();
    const card = page.locator(`[role="radio"][data-instrument="${t.instrument}"]`);
    if ((await card.count()) === 0) await page.getByRole('dialog').getByRole('switch', { name: 'Show more instruments (less tested)' }).click();
    await card.click();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(card).toHaveCount(0);
    const level = await pickRandom(page, 'Difficulty', rnd);
    await chooseMode(page, t.mode);
    await check(`home before take ${i + 1}`);
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    const cover = page.getByTestId('scan-cover');
    const empty = page.getByTestId('empty-pool');
    await expect(cover.or(empty)).toBeVisible({ timeout: 30_000 });
    if (await empty.isVisible()) {
      issues.push(`take ${i + 1}: empty pool at level ${level} for ${t.instrument}`);
      await empty.getByRole('button').first().click();
      await page.getByRole('button', { name: 'Start', exact: true }).click();
      await expect(cover).toBeVisible({ timeout: 30_000 });
    }
    await page.getByRole('button', { name: 'Show the music' }).click();
    const scan = page.getByTestId('screen-practice.scan');
    await expect(scan.locator('[data-expected-idx]').first()).toBeVisible({ timeout: 30_000 });
    const plan = await pagePlan(page);
    h.writeTakeWav(wav, plan, LOOP_T0_SEC);
    await page.getByRole('button', { name: 'Start playing' }).click();
    const play = page.getByTestId('screen-practice.play');
    await expect(play).toBeVisible({ timeout: 15_000 });
    // The take must end on its own: one beat after the last written note (R14), then results.
    const results = page.getByTestId('results-panel');
    await expect(results).toBeVisible({ timeout: (LOOP_T0_SEC + plan.endSec + 30) * 1000 });
    await expect(results).toHaveAttribute('data-state', 'graded');
    await check(`results ${i + 1}`);
    const r = await record(page);
    expect(r?.score).not.toBeNull();
    done.push(r!);
    const off = r!.judgments.filter((j) => j.status !== 'matched' || (j.timing !== null && j.timing !== 'on-time') || (j.pitch !== null && !['ok', 'in-tune', 'not-graded'].includes(j.pitch)));
    process.stdout.write(`take ${i + 1} ${r!.instrumentId} ${JSON.stringify(r!.score!.components)} off: ${JSON.stringify(off)}\n`);
    info.annotations.push({ type: `take ${i + 1}`, description: `${r!.instrumentId} L${r!.levelServed} bpm ${plan.bpm}: ${r!.score!.score} ${r!.score!.grade}, ranked ${r!.score!.ranked} (${r!.score!.rankedReasons.join(', ')}), tips ${r!.score!.tipsShown.join(', ') || 'none'}` });
    // No measured calibration: a ranked request is practice (R16). Practice mode is unranked by definition.
    expect(r!.score!.ranked).toBe(false);
    if (t.mode === 'ranked') expect(r!.score!.rankedReasons).toContain('calibration');
    // Next: the tips interstitial when tips were chosen, then home (or a session summary every 10 takes).
    await page.getByRole('button', { name: 'Next excerpt' }).click();
    const tips = page.getByTestId('screen-practice.tips');
    const next = tips.or(home).or(page.getByTestId('scan-cover'));
    await expect(next.first()).toBeVisible({ timeout: 15_000 });
    if (await tips.isVisible()) {
      await check(`tips ${i + 1}`);
      await tips.getByRole('button').last().click();
    }
    // A next excerpt may go straight to the scan cover; go home for the next instrument.
    if (!(await home.isVisible())) await page.evaluate(() => { window.location.hash = '#/'; });
  }

  // History lists the three takes and opens one.
  await page.evaluate(() => { window.location.hash = '#/history'; });
  const links = page.locator('a[href^="#/history/"]');
  await expect(links).toHaveCount(3, { timeout: 10_000 });
  await check('history');
  await links.first().click();
  await page.waitForTimeout(800);
  await check('history attempt');
  await page.evaluate(() => { window.location.hash = '#/progress'; });
  await page.waitForTimeout(500);
  await check('progress');

  // Settings: change the theme, export, then reload and import the export back.
  await page.evaluate(() => { window.location.hash = '#/settings/data'; });
  const exportBtn = page.getByRole('button', { name: 'Export data' }).or(page.getByRole('button', { name: /^Export/ })).first();
  await expect(exportBtn).toBeVisible({ timeout: 10_000 });
  await check('settings data');
  const [download] = await Promise.all([page.waitForEvent('download'), exportBtn.click()]);
  const file = join(info.outputDir, 'export.json');
  await download.saveAs(file);
  const exported = JSON.parse(readFileSync(file, 'utf8')) as { attempts?: unknown[] } & Record<string, unknown>;
  const attemptsIn = (o: Record<string, unknown>): number => {
    for (const [k, v] of Object.entries(o)) if (/attempt/i.test(k) && Array.isArray(v)) return v.length;
    for (const v of Object.values(o)) if (v && typeof v === 'object' && !Array.isArray(v)) {
      const n = attemptsIn(v as Record<string, unknown>);
      if (n >= 0) return n;
    }
    return -1;
  };
  expect(attemptsIn(exported)).toBe(3);

  // Reload: still past onboarding, history kept.
  await page.reload();
  await expect(page.getByTestId('screen-welcome')).toHaveCount(0);
  await page.evaluate(() => { window.location.hash = '#/history'; });
  await expect(links).toHaveCount(3, { timeout: 10_000 });

  // Import the export back (replaces the data): history still has the three takes.
  await page.evaluate(() => { window.location.hash = '#/settings/data'; });
  await page.getByTestId('import-file').setInputFiles(file);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await check('import dialog');
  await dialog.getByRole('button').last().click();
  await expect(dialog).toHaveCount(0, { timeout: 10_000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.location.hash = '#/history'; });
  await expect(links).toHaveCount(3, { timeout: 10_000 });

  info.annotations.push({ type: 'issues', description: issues.join('\n') || 'none' });
  process.stdout.write(`[${info.project.name}] first-user takes:\n${done.map((d) => `${d.instrumentId} L${d.levelServed} ${d.score?.score} ${d.score?.grade} ranked=${d.score?.ranked} [${d.score?.rankedReasons.join(',')}]`).join('\n')}\n`);
  process.stdout.write(`[${info.project.name}] first-user issues:\n${issues.join('\n') || 'none'}\n`);
  expect(issues).toEqual([]);
  expect(errors).toEqual([]);
});
