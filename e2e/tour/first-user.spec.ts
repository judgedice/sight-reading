// First-time user (wave 4 final review): onboarding, then three takes in a row on different instruments with random
// settings, results and tips after each, history, settings, export and import, and a reload. Checks that every take
// ends and lands on a graded result, that no raw copy key or console error appears, that a ranked request without a
// measured calibration is recorded as unranked, and that history and settings survive a reload and an import.
// Round 2 additions: the difficulty stepper, "tries today" counted the same on Practice and in History, the words round 2
// replaced (e2e/a11y/copy-match.ts `oldWordsIn`) on every screen, and the diagnostics for the recent tries saved from
// Settings > Data.
// Run with -c e2e/tour/playwright.tour.config.ts (the tour's fake microphone and production build).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadLoopHelpers } from '../loop/bundle.ts';
import { oldWordsIn } from '../a11y/copy-match.ts';
import { chooseMode, chooseOutput, LOOP_T0_SEC, pagePlan, walkWizard, watchErrors } from '../loop/flow.ts';

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

/** Moves the Difficulty stepper by a random 0 to 3 steps up (the phone's stepper is in the setup sheet). */
async function pickDifficulty(page: Page, rnd: () => number): Promise<number> {
  const phone = (page.viewportSize()?.width ?? 1280) < 1024;
  const home = page.getByTestId('screen-home');
  let scope: Locator = home;
  if (phone) {
    await page.locator('[data-chip="difficulty"]').click();
    scope = page.getByTestId('setup-sheet');
  }
  const steps = Math.floor(rnd() * 4);
  for (let i = 0; i < steps; i++) {
    const up = scope.getByRole('button', { name: /Increase Difficulty/ });
    if (!(await up.isEnabled())) break;
    await up.click();
  }
  const shown = await scope.getByText(/^\d+\s*of 10$|^\d+$/).first().innerText().catch(() => '');
  if (phone) {
    await page.getByRole('dialog').getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByTestId('setup-sheet')).toHaveCount(0);
  }
  return Number.parseInt(shown, 10) || steps;
}

test('first-time user: three takes on three instruments, results, tips, history, settings, export, import, reload', async ({ page }, info) => {
  test.setTimeout(600_000);
  const h = await loadLoopHelpers();
  const wav = process.env['E2E_TOUR_WAV']!;
  const errors = watchErrors(page);
  const issues: string[] = [];
  const check = async (where: string): Promise<void> => {
    for (const k of await rawKeys(page)) issues.push(`${where}: raw copy key ${k}`);
    const lines = await page.evaluate(() => {
      const out = document.body.innerText.split('\n');
      for (const el of Array.from(document.querySelectorAll('[aria-label], [title]'))) for (const a of ['aria-label', 'title']) if (el.getAttribute(a)) out.push(el.getAttribute(a)!);
      return out.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    });
    for (const line of lines) for (const what of oldWordsIn(line)) issues.push(`${where}: ${what} on screen: ${line}`);
  };
  let seed = 20261118 + info.project.name.length;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  // Setup: flute, microphone allowed, Hear you and Timing skipped (so Ranked cannot be offered later).
  await page.goto(`./?testClock=1&testClockSec=${LOOP_T0_SEC}`);
  await walkWizard(page, { mic: 'allow', visit: async (name) => check(name) });
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
    // No measured calibration (R79): Ranked is blocked, so Home says Practice; the cover must say the same.
    const ranked = home.locator('[data-setup-row="mode"]').getByRole('radio', { name: 'Ranked' });
    await expect(ranked).toHaveAttribute('aria-disabled', 'true');
    await chooseMode(page, t.mode);
    const level = await pickDifficulty(page, rnd);
    await expect(home.getByTestId('mode-pill').first()).toHaveAttribute('data-mode', 'practice');
    await expect(page.getByRole('button', { name: /^Start practice/ })).toBeVisible();
    await check(`home before take ${i + 1}`);
    await page.getByRole('button', { name: /^Start (practice|ranked try)/ }).click();
    const cover = page.getByTestId('scan-cover');
    const empty = page.getByTestId('empty-pool');
    await expect(cover.or(empty)).toBeVisible({ timeout: 30_000 });
    if (await empty.isVisible()) {
      issues.push(`take ${i + 1}: empty pool at level ${level} for ${t.instrument}`);
      await empty.getByRole('button').first().click();
      await page.getByRole('button', { name: /^Start (practice|ranked try)/ }).click();
      await expect(cover).toBeVisible({ timeout: 30_000 });
    }
    // When Home says Practice, the cover says Practice (R79), and the try strip after it.
    await expect(page.getByTestId('mode-chip')).toHaveAttribute('data-mode', 'practice');
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
    // No measured calibration: Ranked was never offered, so every take was practice, as shown (R16, R79).
    expect(r!.score!.ranked).toBe(false);
    expect(r!.score!.rankedReasons).toContain('practice-mode');
    await expect(results.getByTestId('results-mode')).toHaveAttribute('data-mode', 'practice');
    // Next: the tips interstitial when tips were chosen, then home (or a session summary every 10 takes).
    await page.getByRole('button', { name: 'Next piece' }).click();
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
  // The data export, not round 2's "Export diagnostics" button above it.
  const exportBtn = page.getByRole('button', { name: 'Export all data (JSON)', exact: true });
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

  // "Tries today" is one number everywhere: Practice's line and History's day group both count the three tries.
  await page.evaluate(() => { window.location.hash = '#/'; });
  await expect(page.getByTestId('today-line')).toContainText('3 tries', { timeout: 10_000 });
  await page.evaluate(() => { window.location.hash = '#/history'; });
  await expect(page.getByTestId('screen-history')).toContainText(/3 tries/, { timeout: 10_000 });

  // The diagnostics for the recent tries: one file, all three tries, no sound.
  await page.evaluate(() => { window.location.hash = '#/settings/data'; });
  const diagBtn = page.getByRole('button', { name: 'Export diagnostics', exact: true });
  await expect(diagBtn).toBeVisible({ timeout: 10_000 });
  const [diagDownload] = await Promise.all([page.waitForEvent('download'), diagBtn.click()]);
  const diagFile = join(info.outputDir, 'diagnostics.json');
  await diagDownload.saveAs(diagFile);
  const diag = JSON.parse(readFileSync(diagFile, 'utf8')) as { format: string; tries: { audio?: unknown }[] };
  expect(diag.format).toBe('sightread-diagnostics');
  expect(diag.tries).toHaveLength(3);
  expect(diag.tries.every((t) => t.audio === undefined)).toBe(true);

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
