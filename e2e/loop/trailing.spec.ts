// The trailing voice (round 2, owner point 15; 01-ux sections 15 and 17): a baritone who scoops into every note and lets
// the pitch fall away at the end of it, at difficulty 1. The owner's marks came partly from that: the app heard a tail as
// a new note and drew a ghost (then purple, grey since R69) and a "+" in the rest. The checks:
//   - during the try, no ghost or extra is drawn at all (PLAN ruling 61), and nothing says "unsure";
//   - the results score has no extra: no "extra" count, no ghost of kind extra, no extra in the record;
//   - "Save diagnostics" downloads a file that parses and holds the notes, the follower events and the frame track.
// The WAV is written after the read-through shows the excerpt (see playwright.loop.config.ts); the generator is
// e2e/loop/trail.ts. Run with -c e2e/loop/playwright.loop.config.ts trailing.spec.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { chooseMode, chooseOutput, LOOP_T0_SEC, pagePlan, walkWizard, watchErrors } from './flow.ts';
import { installLiveWatch, liveMarks, trailingVoice, writeTrailingWav, planWithoutPickup } from './trail.ts';

test.skip(process.env['E2E_LOOP'] !== '1', 'run with -c e2e/loop/playwright.loop.config.ts');

/** Onboarding as a baritone, the microphone allowed, calibration and "Sing one note" skipped. */
async function onboardBaritone(page: Page): Promise<void> {
  await page.goto(`./?testClock=1&testClockSec=${LOOP_T0_SEC}`);
  await walkWizard(page, { mic: 'allow', instrument: /^Baritone voice/ });
}

test('trailing voice at difficulty 1: no ghost or extra mark during the try, no extra in the results, diagnostics saved', async ({ page }, info) => {
  test.setTimeout(240_000);
  const wav = process.env['E2E_LOOP_WAV']!;
  const errors = watchErrors(page);
  await installLiveWatch(page);
  await onboardBaritone(page);
  await chooseOutput(page, 'Wired headphones');

  // Difficulty 1: the setup starts above it.
  const home = page.getByTestId('screen-home');
  const phone = (page.viewportSize()?.width ?? 1280) < 1024;
  expect(phone).toBe(false);
  // Difficulty 1: everyone starts there (round 3, R75).
  await chooseMode(page, 'practice');
  await expect(home.getByText(/1\s*of 10/).first()).toBeVisible();
  await page.getByRole('button', { name: /^Start (practice|ranked try)/ }).click();
  await expect(page.getByTestId('scan-cover')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Show the music' }).click();
  const scan = page.getByTestId('screen-practice.scan');
  await expect(scan.locator('[data-expected-idx]').first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => document.fonts.check('30pt Bravura')), { timeout: 15_000 }).toBe(true);

  const plan = await planWithoutPickup(page, pagePlan);
  const served = await page.evaluate(() => (window as unknown as { __sr: { session: { prepared: { levelServed: number } | null } } }).__sr.session.prepared?.levelServed);
  expect(served).toBe(1);
  expect(plan.instrumentId).toBe('voice-baritone');
  writeTrailingWav(wav, plan, LOOP_T0_SEC);
  info.annotations.push({ type: 'take', description: `bpm ${plan.bpm}, ${plan.expected.length} notes, ends ${plan.endSec.toFixed(1)} s` });

  await page.getByRole('button', { name: 'Start playing' }).click();
  const play = page.getByTestId('screen-practice.play');
  await expect(play).toBeVisible({ timeout: 15_000 });
  await expect(play).toHaveAttribute('data-state', 'performing', { timeout: LOOP_T0_SEC * 1000 + 15_000 });

  // Results. By now the whole take, with all its tails, has been heard.
  const results = page.getByTestId('results-panel');
  await expect(results).toBeVisible({ timeout: (plan.endSec + 30) * 1000 });
  await expect(results).toHaveAttribute('data-state', 'graded');

  // 1. No ghost or extra during the try, and none before bar 1: not a ghost, not a "+", not an unsure ring.
  const live = await liveMarks(page);
  expect(live, 'ghost, extra or unsure marks drawn on the play screen').toEqual([]);

  // 2. No extra in the results: the record, the counts line and the drawn score.
  const record = await page.evaluate(() => (window as unknown as { __sr: { session: { record: { extras: unknown[]; score: { score: number } | null; judgments: { status: string }[] } | null } } }).__sr.session.record);
  expect(record?.score).not.toBeNull();
  if (record!.extras.length > 0) {
    const t = (record!.extras[0] as { onsetSec: number }).onsetSec;
    const near = plan.expected.filter((e) => Math.abs(e.onsetSec - t) < 2).map((e) => `#${e.idx} m${e.concertMidi} ${e.onsetSec.toFixed(2)}+${e.durSec.toFixed(2)} ${e.onsetKind}`).join('\n    ');
    const voiced = trailingVoice(plan, 0).filter((v) => Math.abs(v.start - t) < 2).map((v) => `m${v.midi.toFixed(1)} ${v.start.toFixed(2)}-${v.hold.toFixed(2)}-${v.end.toFixed(2)} scoop${v.scoop} tail${v.tail}`).join('\n    ');
    process.stdout.write(`EXTRAS ${JSON.stringify(record!.extras)}\nNEAR\n    ${near}\nVOICED\n    ${voiced}\nBPM ${plan.bpm}\n`);
  }
  expect(record!.extras, 'extra notes in the record').toEqual([]);
  expect(await results.getByTestId('res-counts').innerText()).not.toMatch(/extra/i);
  await expect(results.locator('.sr-ghost[data-kind="extra"]')).toHaveCount(0);
  // The microphone really heard the singer: most written notes are matched, so a silent take cannot pass.
  const matched = record!.judgments.filter((j) => j.status === 'matched').length;
  expect(matched).toBeGreaterThanOrEqual(Math.ceil(0.8 * plan.expected.length));
  info.annotations.push({ type: 'measured', description: `score ${record?.score?.score}, matched ${matched} of ${record?.judgments.length}` });

  // 3. "Save diagnostics" downloads a valid file with the notes, the follower events and the frame track.
  await results.getByRole('button', { name: /^(Save|Send) diagnostics$/ }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Save file' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^sightread-try-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
  const file = join(info.outputDir, download.suggestedFilename());
  await download.saveAs(file);
  const diag = JSON.parse(readFileSync(file, 'utf8')) as { format: string; version: number; tries: { attemptId: string; detected: unknown[]; events: unknown[]; frames: unknown; verdicts: { extras: unknown[] }; audio?: unknown }[] };
  expect(diag.format).toBe('sightread-diagnostics');
  expect(diag.tries).toHaveLength(1);
  const trace = diag.tries[0]!;
  expect(trace.detected.length, 'detected notes in the file').toBeGreaterThan(0);
  expect(trace.events.length, 'follower events in the file').toBeGreaterThan(0);
  expect(trace.frames, 'frame track in the file').not.toBeNull();
  expect(trace.verdicts.extras).toEqual([]);
  info.annotations.push({ type: 'trace', description: `${trace.detected.length} detected notes for ${plan.expected.length} written, ${trace.events.length} follower events` });
  expect(trace.audio, 'no sound unless the player turned it on').toBeUndefined();
  process.stdout.write(`[trailing] ${info.annotations.map((a) => `${a.type}: ${a.description}`).join(' | ')}\n`);
  expect(errors).toEqual([]);
});
