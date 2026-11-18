// Screen tour (wave 3 review): every screen of the production build against the emitted corpus, as a user reaches
// it, captured into docs/screenshots/<project>/. One take is played through Chromium's fake capture with one note
// 2 semitones sharp and one note late; the spec checks on screen that the wrong note turns red with a ghost at the
// played pitch and that the late note turns red with a 'late' ghost displaced to the right of its notehead.
// Run with -c e2e/tour/playwright.tour.config.ts.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { loadLoopHelpers } from '../loop/bundle.ts';
import { LOOP_T0_SEC, pagePlan, watchErrors } from '../loop/flow.ts';

test.skip(process.env['E2E_TOUR'] !== '1', 'run with -c e2e/tour/playwright.tour.config.ts');

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
  const h = await loadLoopHelpers();
  const wav = process.env['E2E_TOUR_WAV']!;
  const errors = watchErrors(page);
  const dir = join(process.cwd(), 'docs', 'screenshots', info.project.name);
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
  await page.getByRole('radio', { name: /Flute/ }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('ob-mic')).toBeVisible();
  await shot('onboarding-mic');
  await page.getByRole('button', { name: 'Allow microphone' }).click();
  await expect(page.getByTestId('calibration-card')).toBeVisible({ timeout: 15_000 });
  await shot('onboarding-calibration');
  await page.getByTestId('calibration-card').getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByTestId('ob-level')).toBeVisible();
  await shot('onboarding-level');
  await page.getByRole('button', { name: "I'll choose" }).click();
  await shot('onboarding-level-choose');
  await page.getByRole('button', { name: 'Start practising' }).click();

  // Home and setup.
  const home = page.getByTestId('screen-home');
  await expect(home).toBeVisible({ timeout: 15_000 });
  await shot('home');
  await home.getByRole('combobox', { name: 'Output' }).selectOption({ label: 'Wired headphones' });
  await home.getByRole('radiogroup', { name: 'Mode' }).getByText('Practice', { exact: true }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('scan-cover')).toBeVisible({ timeout: 30_000 });
  await shot('scan-cover');

  // Scan.
  await page.getByRole('button', { name: 'Start scan' }).click();
  const scan = page.getByTestId('screen-practice.scan');
  await expect(scan).toHaveAttribute('data-state', 'scanning');
  await expect(scan.locator('[data-expected-idx]').first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => document.fonts.check('30pt Bravura')), { timeout: 15_000 }).toBe(true);
  await shot('scan');
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
  // The wrong-pitch ghost: drawn in the wrong note's bar, at a different height from the notehead.
  const wrongGhost = play.locator(`.sr-note-marks[data-marks-for="${wrongIdx}"] ~ .sr-ghost, .sr-ghost`).first();
  await expect(wrongGhost).toBeAttached();
  await shot('performing-wrong-note', false);
  const lateNote = play.locator(`[data-expected-idx="${lateIdx}"]`).first();
  await expect(lateNote).toHaveClass(/n-error/, { timeout: (plan.endSec + 5) * 1000 });
  await shot('performing-late-note', false);

  // Geometry on screen: the wrong ghost sits off the notehead's line; the late ghost sits to the right of its note.
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

  // Results.
  const results = page.getByTestId('results-panel');
  await expect(results).toBeVisible({ timeout: (plan.endSec + 30) * 1000 });
  await expect(results).toHaveAttribute('data-state', 'graded');
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

  // Tips.
  await page.getByRole('button', { name: 'Next excerpt' }).click();
  const tips = page.getByTestId('screen-practice.tips');
  await expect(tips).toBeVisible({ timeout: 10_000 });
  await shot('tips');

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
  await visit('#/calibrate', 'calibrate');
  await visit('#/credits', 'credits');
  await visit('#/no-such-page', 'not-found');

  info.annotations.push({ type: 'issues', description: issues.join('\n') || 'none' });
  process.stdout.write(`[${info.project.name}] issues:\n${issues.join('\n') || 'none'}\n`);
  process.stdout.write(`[${info.project.name}] errors:\n${errors.join('\n') || 'none'}\n`);
  expect(errors).toEqual([]);
});
