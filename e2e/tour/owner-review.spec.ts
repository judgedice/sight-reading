// The owner's review walk (round 2; docs/redesign/round2/06-plan.md section 7). His own path, a baritone at
// difficulty 1, through the production build with Chromium's fake capture, one assertion per point he raised:
//
//    #  point                                   where it is proven
//    1  the design looks better                 every screen is captured; none overflows, shows a copy key or old words
//    2  hear the instrument in the picker       "Play my range" schedules 4 notes from the voice-baritone sample set
//    3  sing one note                           onboarding step 5 and Practice open Match a note; the fake mic hits it
//    4  calibration status stays on screen      "Not calibrated" on Practice and the read-through; no old banner text
//    5  tries and previous tries                no noun "take"; results > See all tries > try detail > Hear what we heard
//    6  tighter right panel                     the page and the setup do not scroll (the project's own viewport)
//    7  the key note                            the difficulty 1 sentence; no "More keys from"
//    8  time signature                          the row and chip say "Time signature"
//    9  clock-rate error                        a forced clock-rate error still reaches the count-in; no "wrong speed"
//   10  tone and purple marks                   the starting-pitch card and "Marks start at bar 1"; no ghost before bar 1
//   11  when the count-in ends                  the two count-in bars read differently; the last says "Come in after N"
//                                               (or after 3, 2 or 1 when the piece starts on a pickup)
//   12  "Reading time's up"                     40 s on the read-through in Practice: no such text
//   13  no coach mark                           no [data-coach]
//   14  "Before you play" ticks                 "Look before you play", no checkbox
//   15  trailing voice, diagnostics             the trailing synthetic: no ghost during the try, no extra in results;
//                                               "Save diagnostics" downloads a valid file
//
// Part one runs with the real clock (no testClock), as the owner did: nothing is graded, the fake microphone only has
// to hear one sung note. Part two reloads the same browser profile with ?testClock=1 so one try can be graded: the
// trailing-voice take from e2e/loop/trail.ts. Every step is captured into docs/screenshots/owner-<project>/ at
// deviceScaleFactor 2 (the folder is emptied first). Every screen's text, screen-reader text included, is checked for
// the words the owner objected to (01-ux section 5.2).
// Run with -c e2e/tour/playwright.tour.config.ts owner-review.spec.ts.
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { oldWordsIn } from '../a11y/copy-match.ts';
import { chooseOutput, LOOP_T0_SEC, pagePlan, watchErrors } from '../loop/flow.ts';
import { installLiveWatch, liveMarks, planWithoutPickup, writeToneWav, writeTrailingWav } from '../loop/trail.ts';

test.skip(process.env['E2E_TOUR'] !== '1', 'run with -c e2e/tour/playwright.tour.config.ts');

const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 1280) < 1024;

// ---- vocabulary: `oldWordsIn` in e2e/a11y/copy-match.ts (01-ux section 5.1, 5.2) -------------------------------------

const RAW_KEY = /^(?:[a-z][a-zA-Z0-9]*\.){1,4}[a-z][a-zA-Z0-9-]*$/;

/** Everything a player (or a screen reader) is given on the page: its text, labels and tooltips, line by line. */
async function pageLines(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const lines = document.body.innerText.split('\n');
    for (const el of Array.from(document.querySelectorAll('[aria-label], [title], img[alt]'))) {
      for (const a of ['aria-label', 'title', 'alt']) {
        const v = el.getAttribute(a);
        if (v) lines.push(v);
      }
    }
    return lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  });
}

// ---- the walk ---------------------------------------------------------------------------------------------------

interface Row {
  n: number;
  point: string;
  ok: boolean;
  detail: string;
}

/** Runs one point's assertions; a failure is recorded and the walk goes on, so one run reports all fifteen. */
function makePoints(rows: Row[]): (n: number, point: string, body: () => Promise<void>) => Promise<void> {
  return async (n, point, body) => {
    await test.step(`#${n} ${point}`, async () => {
      try {
        await body();
        rows.push({ n, point, ok: true, detail: '' });
      } catch (e) {
        rows.push({ n, point, ok: false, detail: String((e as Error).message ?? e).split('\n').slice(0, 6).join(' / ') });
      }
    });
  };
}

async function openRow(page: Page, row: 'key' | 'time' | 'difficulty'): Promise<Locator> {
  if (isPhone(page)) {
    await page.locator(`[data-chip="${row}"]`).click();
    const sheet = page.getByTestId('setup-sheet');
    await expect(sheet).toBeVisible();
    return sheet;
  }
  return page.getByTestId('screen-home');
}

async function closeRow(page: Page): Promise<void> {
  if (!isPhone(page)) return;
  await page.getByRole('dialog').getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByTestId('setup-sheet')).toHaveCount(0);
}

/** "G3", "B♭2", "F♯3" as a MIDI number (middle C is C4 = 60). */
function noteToMidi(name: string): number {
  const m = /^([A-G])([♭♯b#]?)(-?\d)$/.exec(name.trim());
  if (!m) throw new Error(`not a note name: ${name}`);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1] as 'C'];
  const alter = m[2] === '♭' || m[2] === 'b' ? -1 : m[2] === '♯' || m[2] === '#' ? 1 : 0;
  return 12 * (Number(m[3]) + 1) + base + alter;
}

/** Records the distinct texts a selector shows over time (the count-in changes faster than a poll can be sure of). */
async function installTextTrail(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen: Record<string, string[]> = {};
    (window as unknown as { __seen: typeof seen }).__seen = seen;
    const sels: Record<string, string> = {
      title: '.sf-count-title',
      detail: '.sf-count-detail',
      pitch: '.perform-pitch-title',
      marks: '.perform-marks-start',
      entry: '.sf-hl-name',
      play: '[data-testid="screen-practice.play"]',
    };
    window.setInterval(() => {
      for (const [k, sel] of Object.entries(sels)) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const v = k === 'play' ? (el.getAttribute('data-state') ?? '') : (el.textContent ?? '').replace(/\s+/g, ' ').trim();
        const list = (seen[k] ??= []);
        if (v && !list.includes(v)) list.push(v);
      }
    }, 40);
  });
}

const seenTexts = (page: Page): Promise<Record<string, string[]>> => page.evaluate(() => (window as unknown as { __seen: Record<string, string[]> }).__seen);

/** Counts the sampler's note starts and the sound files fetched, so "Play my range" can be told from the fallback voice. */
async function installSoundWatch(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __starts: number; __files: string[] };
    w.__starts = 0;
    w.__files = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...a: Parameters<AudioBufferSourceNode['start']>) {
      w.__starts++;
      return start.apply(this, a);
    };
  });
}

test('owner review: baritone at difficulty 1, the fifteen points, then a graded try with a trailing voice', async ({ page, context }, info) => {
  test.setTimeout(900_000);
  const wav = process.env['E2E_TOUR_WAV']!;
  const errors = watchErrors(page);
  const dir = join(process.cwd(), 'docs', 'screenshots', `owner-${info.project.name}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const rows: Row[] = [];
  const point = makePoints(rows);
  const issues: string[] = [];
  const notes: string[] = [];
  const shots: string[] = [];
  let firstNote = '';
  const sounds: string[] = [];
  page.on('request', (r) => {
    const m = /\/sounds\/([^/]+)\//.exec(r.url());
    if (m) sounds.push(m[1]!);
  });
  await installLiveWatch(page);
  await installTextTrail(page);
  await installSoundWatch(page);

  /** Screenshot plus the checks every screen gets: no overflow, no copy key on screen, none of the old words. */
  const shot = async (name: string, fullPage = true): Promise<void> => {
    await page.waitForTimeout(250);
    const file = `${String(shots.length + 1).padStart(2, '0')}-${name}.png`;
    shots.push(file);
    await page.screenshot({ path: join(dir, file), fullPage, animations: 'disabled' });
    for (const line of await pageLines(page)) {
      for (const what of oldWordsIn(line)) issues.push(`${name}: ${what} on screen: ${line}`);
      if (RAW_KEY.test(line) && !/\.(?:json|com|org|net|js|png)$/.test(line)) issues.push(`${name}: raw copy key? ${line}`);
    }
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 1) issues.push(`${name}: page overflows by ${over}px`);
  };

  // ---- Part one: the real clock -----------------------------------------------------------------------------
  await page.goto('./');
  await expect(page.getByTestId('screen-welcome')).toBeVisible({ timeout: 30_000 });
  await shot('welcome');
  await page.getByRole('button', { name: 'Get started' }).click();
  await shot('onboarding-instrument');
  await page.getByRole('radio', { name: /^Baritone voice/ }).check();
  const figure = page.getByRole('figure', { name: /Baritone voice range: G2 to G4\./ });
  await expect(figure).toBeVisible();
  await shot('onboarding-baritone-range');
  await page.getByRole('button', { name: 'Continue' }).click();
  await shot('onboarding-mic');
  await page.getByRole('button', { name: 'Allow microphone' }).click();
  await expect(page.getByTestId('calibration-card')).toBeVisible({ timeout: 15_000 });
  await shot('onboarding-calibration');
  // The fake microphone cannot hear clicks, so calibration is skipped: the player stays "Not calibrated".
  await page.getByTestId('calibration-card').getByRole('button', { name: 'Skip' }).click();

  await point(3, 'sing one note: onboarding offers it as step 5', async () => {
    const step = page.getByTestId('ob-match');
    await expect(step).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sing one note' })).toBeVisible();
    await expect(step).toContainText('Not graded.');
    // The first note is the same on Practice (the middle of the range), so the fake microphone can sing it later.
    await expect(step.getByTestId('match-target')).toHaveText(/^[A-G][♭♯b#]?\d$/);
    firstNote = ((await step.getByTestId('match-target').innerText()) ?? '').trim();
    await shot('onboarding-sing-one-note');
  });
  await page.locator('.ob-head').getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByTestId('ob-level')).toBeVisible();
  await shot('onboarding-difficulty');
  await page.getByRole('button', { name: "I'll choose" }).click();
  await page.getByRole('button', { name: 'Start practising' }).click();
  const home = page.getByTestId('screen-home');
  await expect(home).toBeVisible({ timeout: 15_000 });
  await shot('practice', false);

  await point(4, 'calibration status stays on screen, with no banner', async () => {
    const status = home.getByTestId('cal-status');
    await expect(status).toBeVisible();
    await expect(status).toContainText('Not calibrated');
    const text = await page.evaluate(() => document.body.innerText);
    expect(text).not.toMatch(/Calibrate once/i);
    expect(text).not.toMatch(/Ranked needs a calibrated setup/i);
    // One calibration prompt on Practice, not two: the status and the link inside the Ranked hint.
    await expect(page.getByRole('button', { name: /^Calibrate now$/ })).toHaveCount(0);
  });

  await point(2, 'hear the instrument in the picker: Play my range plays 4 notes from the voice-baritone set', async () => {
    if (isPhone(page)) {
      await home.locator('.home-summary-inst').click();
    } else {
      await expect(home.getByTestId('play-range')).toBeVisible();
    }
    const rangeBtn = page.getByTestId('play-range').first();
    await expect(rangeBtn).toBeVisible();
    await shot('picker-play-range', false);
    const before = await page.evaluate(() => (window as unknown as { __starts: number }).__starts);
    await expect(rangeBtn).toContainText('Play my range');
    await rangeBtn.click();
    await expect(rangeBtn).toContainText('Stop');
    // In the picker each note is named while it sounds ("Playing G2"); on Practice the range picture lights it.
    const heard = new Set<string>();
    for (let i = 0; i < 200; i++) {
      for (const t of await page.getByText(/^Playing [A-G][♭♯b#]?\d$/).allInnerTexts()) heard.add(t.trim());
      if (!(await rangeBtn.innerText()).includes('Stop')) break;
      await page.waitForTimeout(100);
    }
    await expect(rangeBtn).toContainText('Play my range');
    const starts = (await page.evaluate(() => (window as unknown as { __starts: number }).__starts)) - before;
    notes.push(`range notes named: ${[...heard].join(', ') || 'none (range picture)'}; sampler note starts ${starts}`);
    expect(starts, 'sampler note starts in one Play my range').toBe(4);
    if (heard.size > 0) expect(heard.size, 'notes named while playing').toBe(4);
    expect(sounds, 'sample sets fetched').toContain('voice-baritone');
    expect(sounds, 'the choir set is not used for a voice').not.toContain('choir-aah');
    await expect(page.getByText("There's no Baritone voice sound yet")).toHaveCount(0);
    if (isPhone(page)) {
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      await expect(home).toBeVisible();
    }
  });

  // Difficulty 1 (Practice starts at 2 after "I'll choose").
  let row = await openRow(page, 'difficulty');
  await row.getByRole('button', { name: /Decrease Difficulty/ }).click();
  await expect(row.getByText(/1\s*of 10/).first()).toBeVisible();
  await closeRow(page);

  await point(7, 'the key note says what difficulty 1 uses', async () => {
    row = await openRow(page, 'key');
    const text = await row.innerText();
    expect(text).toContain('Difficulty 1 uses major keys with up to 1 sharp or flat.');
    expect(text).toContain('Minor keys start at difficulty 2.');
    expect(text).not.toMatch(/More keys from/i);
    await shot('practice-key', !isPhone(page));
    await closeRow(page);
  });

  await point(8, 'the row and the chip say "Time signature"', async () => {
    if (isPhone(page)) {
      await expect(page.locator('[data-chip="time"]')).toContainText('Time signature');
      expect(await page.locator('[data-chip="time"]').innerText()).not.toMatch(/^Time\b(?!\s+signature)/);
    }
    row = await openRow(page, 'time');
    await expect(row.getByText('Time signature', { exact: true }).first()).toBeVisible();
    await shot('practice-time', !isPhone(page));
    await closeRow(page);
  });

  await point(6, 'the setup panel does not scroll inside the page or inside itself', async () => {
    await expect(home).toBeVisible();
    const m = await page.evaluate(() => {
      const doc = document.documentElement;
      const scrollers = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="screen-home"] *'))
        .filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 1)
        .map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} ${e.scrollHeight}>${e.clientHeight}`);
      return { scroll: doc.scrollHeight, client: doc.clientHeight, scrollers };
    });
    notes.push(`practice ${page.viewportSize()?.width}x${page.viewportSize()?.height}: document ${m.scroll} of ${m.client}`);
    expect(m.scrollers, 'elements that scroll inside the setup').toEqual([]);
    expect(m.scroll).toBeLessThanOrEqual(m.client);
  });

  await point(3, 'sing one note: Practice opens it and the fake microphone hits the note', async () => {
    const entry = home.getByTestId('match-entry');
    await expect(entry).toBeVisible();
    // The microphone opens again after the target sounds, so Chromium plays the file from its start: write it first.
    writeToneWav(wav, noteToMidi(firstNote));
    await entry.click();
    const screen = page.getByTestId('screen-match');
    await expect(screen).toBeVisible();
    await expect(page).toHaveURL(/#\/match$/);
    await expect(screen.getByTestId('match-target')).toHaveText(firstNote, { timeout: 10_000 });
    await expect(screen.getByTestId('match-line')).toContainText(/You hit it/, { timeout: 30_000 });
    await shot('match-hit', false);
    // Not graded: nothing was saved (Practice shows no last try).
    await page.goBack();
    await expect(home).toBeVisible();
    await expect(home.getByTestId('last-try')).toHaveCount(0);
  });

  // Practice mode (Ranked needs calibration), then the read-through.
  await chooseOutput(page, 'Wired headphones');
  await home.locator('[data-setup-row="mode"]').getByRole('radio', { name: 'Practice' }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('scan-cover')).toBeVisible({ timeout: 30_000 });
  await shot('cover');
  await page.getByRole('button', { name: 'Show the music' }).click();
  const scan = page.getByTestId('screen-practice.scan');
  await expect(scan).toHaveAttribute('data-state', 'scanning');
  await expect(scan.locator('[data-expected-idx]').first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => document.fonts.check('30pt Bravura')), { timeout: 15_000 }).toBe(true);
  await shot('read-through');

  await point(4, 'the read-through says "Not calibrated" too', async () => {
    await expect(scan.getByTestId('cal-status').first()).toContainText('Not calibrated');
  });

  await point(13, 'no coach mark', async () => {
    await expect(page.locator('[data-coach]')).toHaveCount(0);
    expect(await page.evaluate(() => document.body.innerText)).not.toMatch(/New: hear the tempo/i);
  });

  await point(14, 'Look before you play, with no boxes to tick', async () => {
    if (isPhone(page)) await page.getByRole('button', { name: /Look before you play/ }).first().click();
    const look = page.getByText('Look before you play').filter({ visible: true }).first();
    await expect(look).toBeVisible();
    await expect(page.getByText('Five things to spot before you start.').filter({ visible: true }).first()).toBeVisible();
    await expect(page.locator('input[type="checkbox"]:visible, [role="checkbox"]:visible')).toHaveCount(0);
    expect(await page.evaluate(() => document.body.innerText)).not.toMatch(/Before you play\b(?!\s*,)|Optional\. Tick|Tick as you check|\d of 5/);
    await shot('read-through-look', false);
    if (isPhone(page)) await page.keyboard.press('Escape');
  });

  await point(12, 'forty seconds of reading in Practice: no "time\'s up"', async () => {
    await page.waitForTimeout(40_000);
    await expect(scan).toHaveAttribute('data-state', 'scanning');
    const text = await page.evaluate(() => document.body.innerText);
    expect(text).not.toMatch(/time'?s up/i);
    expect(text).not.toMatch(/Start when ready/i);
    await expect(page.getByTestId('scan-read-hint')).toHaveText('Read it through. Start when you are ready.');
    await shot('read-through-40s', false);
  });

  // The count-in, with the real clock: starting pitch, then two bars of clicks. Stopped before the first note.
  await page.getByRole('button', { name: 'Start playing' }).click();
  const play = page.getByTestId('screen-practice.play');
  await expect(play).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await seenTexts(page))['detail']?.some((d) => /bar 2 of 2/.test(d)) ?? false, { timeout: 60_000 }).toBe(true);
  await expect.poll(async () => (await seenTexts(page))['title']?.some((t) => /^Come in after \d$/.test(t)) ?? false, { timeout: 15_000 }).toBe(true);
  await shot('count-in-last-bar', false);
  const seen = await seenTexts(page);
  notes.push(`count-in seen: ${JSON.stringify(seen)}`);

  await point(10, 'the starting pitch is its own card, marks start at bar 1, nothing purple before the music', async () => {
    expect(seen['pitch'], 'starting-pitch card title').toContain('Your starting pitch');
    expect(seen['marks'], 'status strip during the starting pitch').toContain('Marks start at bar 1');
    expect(await liveMarks(page, false), 'ghost or unsure marks on the page before bar 1').toEqual([]);
  });

  await point(11, 'the count-in bars read differently and the last one says "Come in after N"', async () => {
    const details = (seen['detail'] ?? []).filter((d) => /Count-in bar/.test(d));
    expect(details.some((d) => /Count-in bar 1 of 2/.test(d))).toBe(true);
    expect(details.some((d) => /Count-in bar 2 of 2/.test(d))).toBe(true);
    const titles = seen['title'] ?? [];
    expect(titles).toContain('Count-in: listen to the beat');
    // "Come in after 4": the last count before the entry, or an earlier one when the piece starts on a pickup.
    const last = titles.find((t) => /^Come in after \d$/.test(t));
    expect(last, 'the last count-in bar names the count to come in after').toBeDefined();
    expect(titles.indexOf('Count-in: listen to the beat')).toBeLessThan(titles.indexOf(last!));
    // Bar 1 of the music is not a count-in bar: the old "Bar 1" label never appears while counting.
    expect(details.every((d) => !/^Bar 1\b/.test(d))).toBe(true);
    await expect(page.locator('[data-testid="screen-practice.play"] .sf-count-track button, [data-testid="screen-practice.play"] .sf-count-track [tabindex]')).toHaveCount(0);
  });

  // Stop before the first note. The stop is confirmed in a sheet; a try stopped before bar 1 is not graded.
  await page.getByRole('button', { name: /^Stop/ }).first().click();
  const stopDialog = page.getByRole('dialog');
  if (await stopDialog.isVisible().catch(() => false)) await stopDialog.getByRole('button', { name: /^(Stop|Yes)/ }).first().click();
  await expect(page.getByTestId('results-panel').or(home).or(page.getByTestId('scan-cover'))).toBeVisible({ timeout: 20_000 });
  await shot('after-stop', false);

  // ---- Part two: a graded try (the test clock puts bar 1 at a known time in the fake capture) --------------------
  await page.goto(`./?testClock=1&testClockSec=${LOOP_T0_SEC}#/`);
  await expect(home).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('scan-cover')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Show the music' }).click();
  await expect(scan.locator('[data-expected-idx]').first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => document.fonts.check('30pt Bravura')), { timeout: 15_000 }).toBe(true);
  const plan = await planWithoutPickup(page, pagePlan);
  const served = await page.evaluate(() => (window as unknown as { __sr: { session: { prepared: { levelServed: number } | null } } }).__sr.session.prepared?.levelServed);
  expect(served, 'the walk stays at difficulty 1').toBe(1);
  writeTrailingWav(wav, plan, LOOP_T0_SEC);
  notes.push(`trailing take: bpm ${plan.bpm}, ${plan.expected.length} notes`);

  // The clock-rate result is forced to a large error: it must not stop the try (01-ux section 9).
  await page.evaluate(() => {
    const audio = (window as unknown as { __sr: { session: { audio: { audioInfo: () => Record<string, unknown> } } } }).__sr.session.audio;
    const real = audio.audioInfo.bind(audio);
    audio.audioInfo = () => ({ ...real(), clockRateError: 0.05 });
  });
  await page.getByRole('button', { name: 'Start playing' }).click();
  await expect(play).toBeVisible({ timeout: 15_000 });

  await point(9, 'a forced clock-rate error still reaches the count-in, with no "wrong speed" text', async () => {
    await expect(play).toHaveAttribute('data-state', /count-in|performing|starting/, { timeout: 15_000 });
    await expect.poll(async () => (await seenTexts(page))['play']?.some((s) => /count-in|performing/.test(s)) ?? false, { timeout: 30_000 }).toBe(true);
    const text = (await pageLines(page)).join('\n');
    expect(text).not.toMatch(/wrong speed|audio clock|Audio timing problem/i);
    await expect(page.locator('[data-testid^="error-screen"]')).toHaveCount(0);
  });

  await expect(play).toHaveAttribute('data-state', 'performing', { timeout: LOOP_T0_SEC * 1000 + 15_000 });
  const results = page.getByTestId('results-panel');
  await expect(results).toBeVisible({ timeout: (plan.endSec + 30) * 1000 });
  await expect(results).toHaveAttribute('data-state', 'graded');
  await shot('results');

  await point(15, 'trailing voice at difficulty 1: no ghost during the try, no extra in the results', async () => {
    expect(await liveMarks(page), 'ghost or unsure marks drawn on the play screen').toEqual([]);
    const record = await page.evaluate(() => (window as unknown as { __sr: { session: { record: { extras: unknown[]; judgments: { status: string }[] } | null } } }).__sr.session.record);
    expect(record!.extras, 'extra notes in the record').toEqual([]);
    expect(await results.getByTestId('res-counts').innerText()).not.toMatch(/extra/i);
    await expect(results.locator('.sr-ghost[data-kind="extra"]')).toHaveCount(0);
    expect(record!.judgments.filter((j) => j.status === 'matched').length).toBeGreaterThanOrEqual(Math.ceil(0.8 * plan.expected.length));
  });

  await point(15, '"Save diagnostics" downloads a valid file', async () => {
    await results.getByRole('button', { name: /^(Save|Send) diagnostics$/ }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await shot('diagnostics-dialog', false);
    const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Save file' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^sightread-try-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
    const file = join(info.outputDir, download.suggestedFilename());
    await download.saveAs(file);
    const diag = JSON.parse(readFileSync(file, 'utf8')) as { format: string; tries: { detected: unknown[]; events: unknown[]; frames: unknown }[] };
    expect(diag.format).toBe('sightread-diagnostics');
    expect(diag.tries).toHaveLength(1);
    expect(diag.tries[0]!.detected.length).toBeGreaterThan(0);
    expect(diag.tries[0]!.events.length).toBeGreaterThan(0);
    expect(diag.tries[0]!.frames).not.toBeNull();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  await point(5, 'tries: results > See all tries > the try, with its marks and "Hear what we heard"', async () => {
    const tries = results.getByTestId('res-tries');
    await expect(tries).toBeVisible();
    await tries.getByRole('button', { name: 'See all tries' }).click();
    await expect(page).toHaveURL(/#\/history/);
    await expect(page.getByTestId('screen-history')).toBeVisible();
    await shot('history');
    const link = page.locator('a[href^="#/history/"]').first();
    await expect(link).toBeVisible();
    await link.click();
    const attempt = page.getByTestId('screen-history.attempt');
    await expect(attempt).toBeVisible();
    await expect(attempt.locator('[data-expected-idx]').first()).toBeVisible({ timeout: 15_000 });
    const hear = attempt.getByRole('button', { name: 'Hear what we heard' });
    await expect(hear).toBeVisible();
    await hear.click();
    await expect(page.getByText(/^What we heard, bar \d+ of \d+/).filter({ visible: true }).first()).toBeVisible({ timeout: 10_000 });
    await shot('try-detail-hear-what-we-heard', false);
    await page.getByRole('button', { name: /^Stop/ }).first().click().catch(() => undefined);
    // The vocabulary: results, history and the try detail were all read for the noun "take" by `shot`.
    expect(issues.filter((i) => /noun "take"/.test(i)), 'the noun "take" anywhere on screen').toEqual([]);
  });

  // Tabs and settings, for the vocabulary and the overflow checks.
  for (const [hash, name] of [['#/progress', 'progress'], ['#/settings', 'settings'], ['#/settings/audio', 'settings-sound'], ['#/settings/display', 'settings-display'], ['#/settings/practice', 'settings-practice'], ['#/settings/data', 'settings-data']] as const) {
    await page.evaluate((h) => { window.location.hash = h; }, hash);
    await page.waitForTimeout(500);
    await shot(name);
  }
  await page.evaluate(() => { window.location.hash = '#/'; });
  await expect(home).toBeVisible();
  await shot('practice-after', false);

  await point(1, 'the design looks better: every screen captured, none overflows, no copy keys, none of the old words', async () => {
    notes.push(`screens captured: ${shots.length}`);
    expect(shots.length).toBeGreaterThanOrEqual(25);
    expect(issues, 'checks run on every captured screen').toEqual([]);
  });

  rows.sort((a, b) => a.n - b.n);
  const table = rows.map((r) => `${String(r.n).padStart(2)} ${r.ok ? 'pass' : 'FAIL'}  ${r.point}${r.ok ? '' : `\n      ${r.detail}`}`).join('\n');
  info.annotations.push({ type: 'points', description: table });
  info.annotations.push({ type: 'notes', description: notes.join('\n') });
  process.stdout.write(`[${info.project.name}] owner points:\n${table}\n[${info.project.name}] notes:\n${notes.join('\n')}\n[${info.project.name}] issues:\n${issues.join('\n') || 'none'}\n[${info.project.name}] errors:\n${errors.join('\n') || 'none'}\n`);
  void context;
  const wanted = Array.from({ length: 15 }, (_, i) => i + 1);
  expect(wanted.filter((n) => !rows.some((r) => r.n === n && r.ok)), 'owner points without a passing assertion').toEqual([]);
  expect(rows.filter((r) => !r.ok).map((r) => `#${r.n}`)).toEqual([]);
  expect(errors).toEqual([]);
});
