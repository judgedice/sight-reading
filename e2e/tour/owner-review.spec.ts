// Final design review walk (docs/redesign/09-final-review.md): the owner's own path, a baritone in Ranked mode, through
// the production build with Chromium's fake capture. Unlike tour.spec.ts it keeps Ranked so "Listen first" asks first
// and turns the take into practice, sets a specific difficulty, key and time signature and checks the served excerpt has
// them, plays "Hear the tempo", "Hear starting pitch" with its explanation, a take, the results, "Listen" after the
// results, and every metronome sound's preview in Settings. Each step is captured into
// docs/screenshots/owner-<project>/ at deviceScaleFactor 2 (the folder is emptied first).
// Run with -c e2e/tour/playwright.tour.config.ts owner-review.spec.ts.
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadLoopHelpers } from '../loop/bundle.ts';
import { chooseOutput, LOOP_T0_SEC, pagePlan, watchErrors } from '../loop/flow.ts';

test.skip(process.env['E2E_TOUR'] !== '1', 'run with -c e2e/tour/playwright.tour.config.ts');

const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 1280) < 1024;

/** A visible "level" in the interface is a wrong term (05 section 12). */
const LEVEL = /\blevels?\b/i;
const RAW_KEY = /^(?:[a-z][a-zA-Z0-9]*\.){1,4}[a-z][a-zA-Z0-9-]*$/;

async function openRow(page: Page, row: 'key' | 'time' | 'difficulty'): Promise<Locator> {
  if (isPhone(page)) {
    await page.locator(`[data-chip="${row}"]`).click();
    const sheet = page.getByTestId('setup-sheet');
    await expect(sheet).toBeVisible();
    return sheet;
  }
  return page.getByTestId('screen-home');
}

/**
 * The key radios. On desktop above eight keys they open from the Key button in a popover (round 2, 04-design
 * section 1); everywhere else they are in the row (as e2e/setup/setup-key-meter.spec.ts).
 */
async function keyRadios(page: Page, row: Locator): Promise<Locator> {
  const button = row.locator('[data-key-button]');
  if ((await button.count()) === 0) return row;
  if ((await page.locator('[data-key-popover]').count()) === 0) await button.click();
  const pop = page.locator('[data-key-popover]');
  await expect(pop).toBeVisible();
  return pop;
}

async function closeRow(page: Page): Promise<void> {
  if (!isPhone(page)) return;
  await page.getByRole('dialog').getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByTestId('setup-sheet')).toHaveCount(0);
}

test('owner review: baritone, ranked, key and time, tempo, starting pitch, listen first, take, listen after, sounds', async ({ page }, info) => {
  test.setTimeout(600_000);
  const h = await loadLoopHelpers();
  const wav = process.env['E2E_TOUR_WAV']!;
  const errors = watchErrors(page);
  const dir = join(process.cwd(), 'docs', 'screenshots', `owner-${info.project.name}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const issues: string[] = [];
  const notes: string[] = [];
  let n = 0;
  const shot = async (name: string, fullPage = true): Promise<void> => {
    await page.waitForTimeout(250);
    n++;
    await page.screenshot({ path: join(dir, `${String(n).padStart(2, '0')}-${name}.png`), fullPage, animations: 'disabled' });
    const text = await page.evaluate(() => document.body.innerText);
    for (const line of text.split('\n').map((l) => l.trim()).filter(Boolean)) {
      if (LEVEL.test(line)) issues.push(`${name}: "level" on screen: ${line}`);
      if (RAW_KEY.test(line) && !/\.(?:json|com|org|net)$/.test(line)) issues.push(`${name}: raw copy key? ${line}`);
    }
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 1) issues.push(`${name}: page overflows by ${over}px`);
  };

  // Onboarding as a baritone.
  await page.goto(`./?testClock=1&testClockSec=${LOOP_T0_SEC}`);
  await expect(page.getByTestId('screen-welcome')).toBeVisible({ timeout: 30_000 });
  await shot('welcome');
  await page.getByRole('button', { name: 'Get started' }).click();
  const baritone = page.getByRole('radio', { name: /^Baritone voice/ });
  await baritone.check();
  const figure = page.getByRole('figure', { name: /Baritone voice range: G2 to G4\./ });
  await expect(figure).toBeVisible();
  notes.push(`range figure: ${(await figure.innerText()).replace(/\s+/g, ' ').slice(0, 120)}`);
  await shot('onboarding-baritone-range');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Allow microphone' }).click();
  await expect(page.getByTestId('calibration-card')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('calibration-card').getByRole('button', { name: 'Skip' }).click();
  // Step 5, Sing or Play one note (round 2): skipped here.
  await expect(page.getByTestId('ob-match')).toBeVisible();
  await page.locator('.ob-head').getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByTestId('ob-level')).toBeVisible();
  await page.getByRole('button', { name: "I'll choose" }).click();
  await shot('onboarding-difficulty');
  await page.getByRole('button', { name: 'Start practising' }).click();
  const home = page.getByTestId('screen-home');
  await expect(home).toBeVisible({ timeout: 15_000 });
  await chooseOutput(page, 'Wired headphones');
  await shot('home');

  // Difficulty: raise to 4 so more than one meter is offered.
  let row = await openRow(page, 'difficulty');
  for (let i = 0; i < 2; i++) await row.getByRole('button', { name: /Increase Difficulty/ }).click();
  await expect(row.getByText(/4\s*of 10/).first()).toBeVisible();
  await closeRow(page);
  // Key: G major.
  row = await openRow(page, 'key');
  await (await keyRadios(page, row)).getByRole('radio', { name: /^G major/ }).click();
  await expect((await keyRadios(page, row)).getByRole('radio', { name: /^G major/ })).toBeChecked();
  await shot('home-key-chosen', !isPhone(page));
  if (!isPhone(page)) await page.keyboard.press('Escape');
  await closeRow(page);
  // Time: the last meter offered, which is not "Any".
  row = await openRow(page, 'time');
  const times = row.locator('[data-setup-row="time"]').getByRole('radio');
  const count = await times.count();
  expect(count).toBeGreaterThanOrEqual(3);
  const meter = times.nth(count - 1);
  await meter.click();
  await expect(meter).toBeChecked();
  const meterLabel = ((await meter.getAttribute('aria-label')) ?? (await meter.innerText())).trim();
  notes.push(`time chosen: ${meterLabel}`);
  await shot('home-time-chosen', !isPhone(page));
  await closeRow(page);

  // Ranked (the default) stays chosen.
  await expect(home.locator('[data-setup-row="mode"]').getByRole('radio', { name: 'Ranked' })).toBeChecked();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('scan-cover')).toBeVisible({ timeout: 30_000 });
  await shot('scan-cover');
  const coverText = await page.getByTestId('scan-cover').innerText();
  expect(coverText).toContain('G major');
  expect(coverText).toContain('Difficulty 4');
  const meterDigits = meterLabel.match(/(\d+)\D+(\d+)/);
  if (meterDigits) expect(coverText.replace(/\s/g, '')).toContain(`${meterDigits[1]}/${meterDigits[2]}`);

  await page.getByRole('button', { name: 'Show the music' }).click();
  const scan = page.getByTestId('screen-practice.scan');
  await expect(scan).toHaveAttribute('data-state', 'scanning');
  await expect(scan.locator('[data-expected-idx]').first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => document.fonts.check('30pt Bravura'))).toBe(true);
  const planMeta = await page.evaluate(() => {
    const p = (window as unknown as { __sr: { session: { plan: { beatsPerBar: number; bpm: number } | null } } }).__sr.session.plan;
    return p ? { beatsPerBar: p.beatsPerBar, bpm: p.bpm } : null;
  });
  notes.push(`served plan: ${JSON.stringify(planMeta)}`);
  await shot('scan');

  // Hear the tempo.
  await page.getByRole('button', { name: /^(Hear the tempo|Tempo)/ }).first().click();
  await expect(page.getByText(/^Tempo: /).filter({ visible: true }).first()).toBeVisible({ timeout: 5_000 });
  await shot('scan-hear-tempo', false);
  // The screen's visually hidden announcer keeps its last line; only the visible caption must go.
  await expect(page.getByText(/^Tempo: /).and(page.locator(':not(.ui-visually-hidden)')).filter({ visible: true })).toHaveCount(0, { timeout: 15_000 });

  // Hear starting pitch with its explanation.
  if (isPhone(page)) {
    await page.getByRole('button', { name: 'What do these do?' }).click();
    await expect(page.getByRole('dialog')).toContainText('Plays the key chord, then your first note.');
    await shot('scan-explain', false);
    await page.keyboard.press('Escape');
  } else {
    await page.getByRole('button', { name: 'About Hear starting pitch' }).click();
    await expect(page.getByText('What is the reference?').filter({ visible: true }).first()).toBeVisible();
    await shot('scan-reference-info', false);
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: /^Hear starting pitch|^Starting pitch/ }).first().click();
  await expect(page.getByText(/^Key chord: G major/).filter({ visible: true }).first()).toBeVisible({ timeout: 10_000 });
  await shot('scan-starting-pitch', false);
  await expect(page.getByText(/^Key chord: G major/).filter({ visible: true })).toHaveCount(0, { timeout: 15_000 });

  // Listen first in Ranked: it asks, then the take is practice and the screen says so.
  await page.getByRole('button', { name: /^Listen first|^Listen/ }).first().click();
  const confirm = page.getByRole('dialog');
  const asked = await confirm.getByText('Listen first?').isVisible().catch(() => false);
  if (asked) {
    await shot('scan-listen-confirm', false);
    await confirm.getByRole('button', { name: 'Listen, make it practice' }).click();
  } else {
    issues.push('listen first: no confirmation in Ranked');
  }
  await expect(page.getByText(/^Playing bar \d+ of \d+/).filter({ visible: true }).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Now a practice try|practice/i).filter({ visible: true }).first()).toBeVisible();
  await shot('scan-listening', false);
  await page.getByRole('button', { name: /^Stop/ }).first().click();
  await shot('scan-after-listen', false);

  // The take.
  const plan = await pagePlan(page);
  const lateIdx = h.lateNoteIdx(plan.expected);
  h.writeTourWav(wav, plan, LOOP_T0_SEC, 200);
  notes.push(`late note #${lateIdx}`);
  await page.getByRole('button', { name: 'Start playing' }).click();
  const play = page.getByTestId('screen-practice.play');
  await expect(play).toBeVisible({ timeout: 15_000 });
  await shot('count-in', false);
  await expect(play).toHaveAttribute('data-state', 'performing', { timeout: LOOP_T0_SEC * 1000 + 10_000 });
  await page.waitForTimeout(Math.min(plan.endSec * 500, 6000));
  await shot('performing', false);

  const results = page.getByTestId('results-panel');
  await expect(results).toBeVisible({ timeout: (plan.endSec + 30) * 1000 });
  await shot('results');
  const resultsText = await results.innerText();
  if (!/You listened first, so this one is practice\./.test(resultsText) && !/practice/i.test(resultsText)) issues.push('results: does not say the take was practice');
  notes.push(`results says listened-first: ${/You listened first/.test(resultsText)}`);
  const record = await page.evaluate(() => (window as unknown as { __sr: { session: { record: { ranked?: boolean; rankedReason?: string | null; score?: { score: number; grade: string } | null } | null } } }).__sr.session.record);
  notes.push(`record: ${JSON.stringify({ ranked: record?.ranked, reason: record?.rankedReason, score: record?.score?.score, grade: record?.score?.grade })}`);

  // Listen after the results.
  const listenAfter = page.getByRole('button', { name: /^Listen/ }).first();
  await expect(listenAfter).toBeVisible();
  await listenAfter.click();
  await expect(page.getByText(/^Playing bar \d+ of \d+/).filter({ visible: true }).first()).toBeVisible({ timeout: 10_000 });
  await shot('results-listening', false);
  await page.getByRole('button', { name: /^Stop/ }).first().click();

  // Settings: preview every metronome sound.
  await page.evaluate(() => { window.location.hash = '#/settings/audio'; });
  for (const s of ['classic', 'woodblock', 'beep']) {
    const b = page.locator(`[data-sound="${s}"]`);
    await expect(b).toBeVisible();
    await b.click();
    const ok = await page.getByText(/^Playing: /).filter({ visible: true }).first().waitFor({ timeout: 5_000 }).then(() => true, () => false);
    if (!ok) issues.push(`settings: ${s} preview showed no "Playing:" line (button now "${await b.getAttribute('aria-label')}")`);
    expect(ok, `${s} preview plays after a take`).toBe(true);
    await shot(`settings-sound-${s}`, s === 'classic');
    if (ok) await b.click().catch(() => undefined);
    await page.waitForTimeout(300);
  }

  for (const [hash, name] of [['#/progress', 'progress'], ['#/history', 'history'], ['#/settings', 'settings']] as const) {
    await page.evaluate((hh) => { window.location.hash = hh; }, hash);
    await page.waitForTimeout(500);
    await shot(name);
  }

  info.annotations.push({ type: 'notes', description: notes.join('\n') });
  info.annotations.push({ type: 'issues', description: issues.join('\n') || 'none' });
  process.stdout.write(`[${info.project.name}] notes:\n${notes.join('\n')}\n[${info.project.name}] issues:\n${issues.join('\n') || 'none'}\n[${info.project.name}] errors:\n${errors.join('\n') || 'none'}\n`);
  expect(errors).toEqual([]);
});
