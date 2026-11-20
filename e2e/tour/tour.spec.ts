// Screen tour: every screen of the production build against the emitted corpus, as a user reaches it, captured into
// docs/screenshots/<project>/ (the folder is emptied first, so the set is always fresh). It covers the picker with
// Baritone, the key grid and time segments, "Show the music", the starting-pitch reference and its info, "Listen first"
// in practice, the results, "One thing to try" when a take earns a tip, and Settings > Sound previews. One take is
// played through Chromium's fake capture with one note 2 semitones sharp and one note late; the spec checks on screen
// that the wrong and the late note turn red live with no ghost (difficulty 1, PLAN ruling 61), and that the results
// score draws the ghosts.
// Run with -c e2e/tour/playwright.tour.config.ts.
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadLoopHelpers } from '../loop/bundle.ts';
import { chooseMode, chooseOutput, LOOP_T0_SEC, pagePlan, watchErrors } from '../loop/flow.ts';

test.skip(process.env['E2E_TOUR'] !== '1', 'run with -c e2e/tour/playwright.tour.config.ts');

const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 1280) < 1024;

/** Opens a setup row: on phones through its summary chip (the setup sheet), on desktop it is already on screen. */
async function openRow(page: Page, row: 'key' | 'time'): Promise<Locator> {
  if (isPhone(page)) {
    await page.locator(`[data-chip="${row}"]`).click();
    const sheet = page.getByTestId('setup-sheet');
    await expect(sheet).toBeVisible();
    return sheet.locator(`[data-setup-slot="${row}"]`);
  }
  return page.getByTestId('screen-home').locator(`[data-setup-slot="${row}"]`);
}

/** Closes the setup sheet on phones; desktop rows need no closing. */
async function closeRow(page: Page): Promise<void> {
  if (!isPhone(page)) return;
  await page.getByRole('dialog').getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByTestId('setup-sheet')).toHaveCount(0);
}

/** Copy keys look like `a.b.c` with no spaces; a rendered key means a missing string. */
const RAW_KEY = /\b(?:[a-z][a-zA-Z0-9]*\.){1,4}[a-z][a-zA-Z0-9-]*\b/;

async function rawKeys(page: Page): Promise<string[]> {
  const text = await page.evaluate(() => document.body.innerText);
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => RAW_KEY.test(l) && !/\s/.test(l) && !/^https?:|\.(?:json|com|org|net)$|^\d/.test(l));
}

/** Elements wider than the viewport (horizontal overflow) other than intentional scrollers. */
async function overflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    if (document.documentElement.scrollWidth > vw + 1) out.push(`document ${document.documentElement.scrollWidth} > ${vw}`);
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
      let p: HTMLElement | null = el.parentElement;
      let clipped = false;
      while (p) {
        const s = getComputedStyle(p);
        if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) { clipped = true; break; }
        p = p.parentElement;
      }
      if (!clipped && r.right > vw + 1) out.push(`${el.tagName.toLowerCase()}.${el.className && typeof el.className === 'string' ? el.className.split(' ')[0] : ''} right=${Math.round(r.right)}`);
    }
    return out.slice(0, 10);
  });
}

test('screen tour: onboarding, home, scan, take with a wrong and a late note, results, tips, every tab', async ({ page }, info) => {
  test.setTimeout(600_000);
  const h = await loadLoopHelpers();
  const wav = process.env['E2E_TOUR_WAV']!;
  const errors = watchErrors(page);
  const dir = join(process.cwd(), 'docs', 'screenshots', info.project.name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let n = 0;
  const issues: string[] = [];
  const shot = async (name: string, fullPage = true): Promise<void> => {
    await page.waitForTimeout(250);
    n++;
    await page.screenshot({ path: join(dir, `${String(n).padStart(2, '0')}-${name}.png`), fullPage, animations: 'disabled' });
    for (const k of await rawKeys(page)) issues.push(`${name}: raw copy key? ${k}`);
    for (const o of await overflow(page)) issues.push(`${name}: overflow ${o}`);
  };

  // Onboarding.
  await page.goto(`./?testClock=1&testClockSec=${LOOP_T0_SEC}`);
  await expect(page.getByTestId('screen-welcome')).toBeVisible({ timeout: 30_000 });
  await shot('welcome');
  await page.getByRole('button', { name: 'Get started' }).click();
  await shot('onboarding-instrument');
  // Baritone: a voice, so the take has the starting-pitch reference (its info and the sound) rather than the key chord.
  await page.getByRole('radio', { name: /Baritone/ }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('ob-mic')).toBeVisible();
  await shot('onboarding-mic');
  await page.getByRole('button', { name: 'Allow microphone' }).click();
  await expect(page.getByTestId('calibration-card')).toBeVisible({ timeout: 15_000 });
  await shot('onboarding-calibration');
  await page.getByTestId('calibration-card').getByRole('button', { name: 'Skip' }).click();
  // Step 5, Sing or Play one note (round 2): skipped here.
  await expect(page.getByTestId('ob-match')).toBeVisible();
  await page.locator('.ob-head').getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByTestId('ob-level')).toBeVisible();
  await shot('onboarding-level');
  await page.getByRole('button', { name: "I'll choose" }).click();
  await shot('onboarding-level-choose');
  await page.getByRole('button', { name: 'Start practising' }).click();

  // Home and setup.
  const home = page.getByTestId('screen-home');
  await expect(home).toBeVisible({ timeout: 15_000 });
  await shot('home');
  await chooseOutput(page, 'Wired headphones');

  // The picker lists Baritone among the launch voices.
  await (isPhone(page) ? home.locator('.home-summary-inst') : home.getByRole('button', { name: /Change instrument/ }).first()).click();
  await expect(page.locator('[role="radio"][data-instrument="voice-baritone"]')).toHaveCount(1);
  await shot('picker');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('[role="radio"][data-instrument="voice-baritone"]')).toHaveCount(0);

  // Key grid and time segments: choose a key and a time signature other than Any, then close the rows.
  const key = await openRow(page, 'key');
  await expect(key.locator('[role="radio"][data-key]').first()).toBeVisible();
  await shot('key-grid', false);
  await key.locator('[role="radio"][data-key]').nth(1).click();
  await closeRow(page);
  const time = await openRow(page, 'time');
  await shot('time-segments', false);
  await time.getByRole('radio').nth(1).click();
  await closeRow(page);

  await chooseMode(page, 'practice');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('scan-cover')).toBeVisible({ timeout: 30_000 });
  await shot('scan-cover');

  // Scan.
  await page.getByRole('button', { name: 'Show the music' }).click();
  const scan = page.getByTestId('screen-practice.scan');
  await expect(scan).toHaveAttribute('data-state', 'scanning');
  await expect(scan.locator('[data-expected-idx]').first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => document.fonts.check('30pt Bravura')), { timeout: 15_000 }).toBe(true);
  await shot('scan');
  // The starting pitch: its info, then the sound. Listen first makes this take practice (the take stays unranked).
  // Desktop: the info button beside the reference. Phones: the dock's "What do these do?" sheet, which carries the
  // same reference explanation (05 section 8, 14 item 2).
  if (isPhone(page)) {
    await page.getByRole('button', { name: 'What do these do?' }).click();
    const explain = page.getByTestId('explain-list');
    await expect(explain).toBeVisible();
    await expect(explain.locator('[data-sound="reference"]')).toBeVisible();
    await shot('scan-reference-info', false);
    await page.keyboard.press('Escape');
    await expect(explain).toHaveCount(0);
  } else {
    await page.getByRole('button', { name: 'About Hear starting pitch' }).click();
    await shot('scan-reference-info', false);
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: /^Hear starting pitch/ }).click();
  await shot('scan-starting-pitch', false);
  await page.getByRole('button', { name: /^Listen first/ }).click();
  await shot('scan-listen-first', false);
  await page.getByRole('button', { name: /^Stop/ }).first().click();
  const plan = await pagePlan(page);
  const wrongIdx = h.wrongNoteIdx(plan.expected);
  const lateIdx = h.lateNoteIdx(plan.expected);
  const lateDurMs = plan.expected.find((e) => e.idx === lateIdx)!.durSec * 1000;
  // Late by halfway between tRed and the match window W (as src/testkit/e2e-pipeline.test.ts), and by less than half
  // the note, so the played note stays nearer its own onset than the next one.
  const tol = await page.evaluate((i) => {
    const t = (window as unknown as { __sr: { session: { plan: { tolerances: { tRedSec: number; matchWindowSec: number }[] } | null } } }).__sr.session.plan?.tolerances[i];
    return t ? { tRed: t.tRedSec * 1000, w: t.matchWindowSec * 1000 } : null;
  }, lateIdx);
  const lateMs = Math.round(Math.min(tol ? (tol.tRed + tol.w) / 2 : 300, 0.45 * lateDurMs));
  h.writeTourWav(wav, plan, LOOP_T0_SEC, lateMs);
  info.annotations.push({ type: 'take', description: `bpm ${plan.bpm}, wrong #${wrongIdx}, late #${lateIdx} +${lateMs} ms (tRed ${tol?.tRed.toFixed(0)}, W ${tol?.w.toFixed(0)})` });

  // Count-in and the take.
  await page.getByRole('button', { name: 'Start playing' }).click();
  const play = page.getByTestId('screen-practice.play');
  await expect(play).toBeVisible({ timeout: 15_000 });
  await expect(play).toHaveAttribute('data-state', /count-in|performing/);
  await shot('count-in', false);
  await expect(play).toHaveAttribute('data-state', 'performing', { timeout: LOOP_T0_SEC * 1000 + 10_000 });
  const wrongNote = play.locator(`[data-expected-idx="${wrongIdx}"]`).first();
  await expect(wrongNote).toHaveClass(/n-error/, { timeout: (plan.endSec + 5) * 1000 });
  // PLAN ruling 61 (01-ux §14): at difficulties 1 to 3 no ghost is drawn live; the ghosts wait for the results.
  const served = await page.evaluate(() => (window as unknown as { __sr: { session: { prepared: { levelServed: number } | null } } }).__sr.session.prepared?.levelServed);
  expect(served).toBeLessThanOrEqual(3);
  await expect(play.locator('.sr-ghost')).toHaveCount(0);
  await shot('performing-wrong-note', false);
  const lateNote = play.locator(`[data-expected-idx="${lateIdx}"]`).first();
  await expect(lateNote).toHaveClass(/n-error/, { timeout: (plan.endSec + 5) * 1000 });
  await shot('performing-late-note', false);

  // Results.
  const results = page.getByTestId('results-panel');
  await expect(results).toBeVisible({ timeout: (plan.endSec + 30) * 1000 });
  await expect(results).toHaveAttribute('data-state', 'graded');
  // The wrong-pitch ghost is drawn on the results score.
  await expect(page.locator('.sr-ghost').first()).toBeAttached();

  // Geometry on the results score: the wrong ghost sits off the notehead's line; the late ghost sits to the right of its note.
  const geo = await page.evaluate(
    ({ wrongIdx: w, lateIdx: l }) => {
      const box = (el: Element | null) => (el ? el.getBoundingClientRect() : null);
      const note = (i: number) => box(document.querySelector(`[data-expected-idx="${i}"]`));
      const ghosts = Array.from(document.querySelectorAll('.sr-ghost')).map((g) => ({ r: g.getBoundingClientRect(), kind: g.getAttribute('data-kind') ?? '', cls: g.getAttribute('class') ?? '' }));
      return { wrong: note(w), late: note(l), ghosts: ghosts.map((g) => ({ x: g.r.x, y: g.r.y, w: g.r.width, h: g.r.height, kind: g.kind, cls: g.cls })) };
    },
    { wrongIdx, lateIdx },
  );
  info.annotations.push({ type: 'geometry', description: JSON.stringify(geo) });
  expect(geo.ghosts.length).toBeGreaterThanOrEqual(1);
  await shot('results');
  const record = await page.evaluate(() => (window as unknown as { __sr: { session: { record: { score: { score: number; grade: string } | null; judgments: { expectedIdx: number; status: string; timing: string | null; pitch: string | null }[] } | null } } }).__sr.session.record);
  const wrong = record!.judgments.find((j) => j.expectedIdx === wrongIdx);
  const late = record!.judgments.find((j) => j.expectedIdx === lateIdx);
  info.annotations.push({ type: 'verdicts', description: `score ${record?.score?.score} ${record?.score?.grade}; wrong ${JSON.stringify(wrong)}; late ${JSON.stringify(late)}` });
  expect(wrong).toMatchObject({ status: 'matched', pitch: 'wrong-pitch' });
  expect(late).toMatchObject({ status: 'matched', timing: 'late' });
  // The results review keeps the red notes and draws the ghosts in review mode.
  await expect(page.locator(`[data-expected-idx="${wrongIdx}"]`).first()).toHaveClass(/n-error/);
  await expect(page.locator(`[data-expected-idx="${lateIdx}"]`).first()).toHaveClass(/n-error/);

  // Tips. A wrong and a late note in different bars fire no pattern, and since PLAN ruling 51 red notes rule out the
  // clean-read tip. The tips interstitial is gone: `#/practice/tips` goes back to the open result (decision 13).
  const tipsShown = await page.evaluate(() => (window as unknown as { __sr: { session: { record: { score: { tipsShown: string[] } | null } | null } } }).__sr.session.record?.score?.tipsShown ?? []);
  expect(tipsShown).not.toContain('U18');
  if (tipsShown.length > 0) {
    // The tip sits under the results as "One thing to try".
    await expect(page.getByText('One thing to try', { exact: true }).first()).toBeVisible();
    await shot('results-one-thing-to-try', false);
  } else {
    info.annotations.push({ type: 'tip', description: 'this take earned no tip, so One thing to try is not on screen' });
  }
  await page.evaluate(() => { window.location.hash = '#/practice/tips'; });
  await expect(page).toHaveURL(/#\/practice\/results$/);
  await expect(page.getByTestId('results-panel')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('screen-practice.tips')).toHaveCount(0);

  // Tabs and secondary screens.
  const visit = async (hash: string, name: string): Promise<void> => {
    await page.evaluate((hh) => { window.location.hash = hh; }, hash);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(400);
    await shot(name);
  };
  await visit('#/progress', 'progress');
  await visit('#/history', 'history');
  const attemptLink = page.locator('a[href^="#/history/"]').first();
  if ((await attemptLink.count()) > 0) {
    await attemptLink.click();
    await page.waitForTimeout(800);
    await shot('history-attempt');
  } else {
    issues.push('history: no attempt link after a graded take');
  }
  await visit('#/settings', 'settings');
  for (const s of ['audio', 'display', 'practice', 'accessibility', 'data', 'about']) await visit(`#/settings/${s}`, `settings-${s}`);
  // Sound previews: each metronome sound plays a bar from its own button.
  await page.evaluate(() => { window.location.hash = '#/settings/audio'; });
  await page.getByRole('button', { name: /^Play a bar of/ }).nth(1).click();
  await shot('settings-sound-previews', false);
  // The bar may have finished (its Stop button gone) by the time the screenshot is taken: bound the wait.
  await page.getByRole('button', { name: /^Stop/ }).first().click({ timeout: 2_000 }).catch(() => undefined);
  await visit('#/calibrate', 'calibrate');
  await visit('#/credits', 'credits');
  await visit('#/no-such-page', 'not-found');

  info.annotations.push({ type: 'issues', description: issues.join('\n') || 'none' });
  process.stdout.write(`[${info.project.name}] issues:\n${issues.join('\n') || 'none'}\n`);
  process.stdout.write(`[${info.project.name}] errors:\n${errors.join('\n') || 'none'}\n`);
  expect(errors).toEqual([]);
});
