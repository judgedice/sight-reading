// Practice setup regression, on the redesigned controls (05 sections 5.2, 5.4, 5.5 and 16 items 5 to 7).
//
// The bug this suite was written for: Key and Time looked dead on a fresh install, because they started on Random and
// Random disabled both controls. The key grid and the time segments replace the select and the Random chips; choosing
// a key or a time signature must work straight away, reach the excerpt that is served, and "Any" must stay random.
// The layout promises of round 2 (no scrolling, one Calibrate control, the key note) are in practice-fit.spec.ts.
// Run with -c e2e/setup/playwright.setup.config.ts.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { onboard, watchErrors } from '../loop/flow.ts';

test.skip(process.env['E2E_SETUP'] !== '1', 'run with -c e2e/setup/playwright.setup.config.ts');

interface Served {
  instrumentId: string;
  writtenKey: { fifths: number; mode: string };
  meter: { beats: number; beatType: number };
  /** As requested: `random` stays random. */
  requested: { writtenKey: unknown; meter: unknown };
}

const served = (page: Page): Promise<Served> =>
  page.evaluate(() => {
    const s = (
      window as unknown as {
        __sr: {
          session: {
            prepared: { writtenKey: { fifths: number; mode: string }; meter: { beats: number; beatType: number } } | null;
            plan: { inst: { id: string } } | null;
            current: { settings: { writtenKey: unknown; meter: unknown } } | null;
          };
        };
      }
    ).__sr.session;
    if (!s.prepared || !s.plan || !s.current) throw new Error('nothing served');
    return { instrumentId: s.plan.inst.id, writtenKey: s.prepared.writtenKey, meter: s.prepared.meter, requested: s.current.settings };
  });

/** The picker card's accessible name starts with the instrument's full name (05 section 6.3). */
const CARD: Record<string, RegExp> = {
  flute: /^Flute,/,
  'voice-bass': /^Bass voice,/,
  'voice-baritone': /^Baritone voice,/,
  'trumpet-bb': /^Trumpet \(B♭\),/,
};

const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 1280) < 1024;

/** Opens the row: on phones through its summary chip (the setup sheet), on desktop it is already on screen. */
async function openRow(page: Page, row: 'difficulty' | 'key' | 'time'): Promise<Locator> {
  if (isPhone(page)) {
    await page.locator(`[data-chip="${row}"]`).click();
    const sheet = page.getByTestId('setup-sheet');
    await expect(sheet).toBeVisible();
    // Opened at that row with focus on its control (05 section 14.8).
    await expect(sheet.locator(`[data-setup-slot="${row}"]`).locator(':focus')).toHaveCount(1);
    return sheet.locator(`[data-setup-slot="${row}"]`);
  }
  return page.getByTestId('screen-home').locator(`[data-setup-slot="${row}"]`);
}

/**
 * The key radios. On desktop above eight keys they open from the Key button in a popover (round 2, 04-design
 * section 1); everywhere else they are in the row.
 */
async function keyRadios(page: Page, row: Locator): Promise<Locator> {
  const button = row.locator('[data-key-button]');
  if ((await button.count()) === 0) return row;
  if ((await page.locator('[data-key-popover]').count()) === 0) await button.click();
  const pop = page.locator('[data-key-popover]');
  await expect(pop).toBeVisible();
  return pop;
}

/** "3 4 time" or "3/4, few pieces": the meter a time radio names. */
const meterOf = (spoken: string): string => {
  const m = /^(\d+)[ /](\d+)/.exec(spoken);
  if (!m) throw new Error(`no meter in ${spoken}`);
  return `${m[1]}/${m[2]}`;
};

async function closeRow(page: Page, row: string): Promise<void> {
  if (!isPhone(page)) return;
  await page.getByRole('dialog').getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByTestId('setup-sheet')).toHaveCount(0);
  // Closing returns focus to the chip.
  await expect(page.locator(`[data-chip="${row}"]`)).toBeFocused();
}

async function chooseInstrument(page: Page, instrument: string): Promise<void> {
  const home = page.getByTestId('screen-home');
  if (isPhone(page)) await home.locator('.home-summary-inst').click();
  else await home.getByRole('button', { name: 'Change instrument' }).click();
  const dialog = page.getByRole('dialog');
  const name = CARD[instrument];
  if (!name) throw new Error(`no picker card name for ${instrument}`);
  await dialog.getByRole('radio', { name }).click();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function startAndReveal(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('scan-cover')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Show the music' }).click();
  await expect(page.getByTestId('screen-practice.scan').locator('[data-expected-idx]').first()).toBeVisible({ timeout: 30_000 });
}

/** Back to Practice from the read-through, keeping the test clock (a reload would drop the debug hook). */
async function backToPractice(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = '#/';
  });
  await expect(page.getByTestId('screen-home')).toBeVisible({ timeout: 15_000 });
}

for (const instrument of ['flute', 'voice-bass', 'voice-baritone', 'trumpet-bb']) {
  test(`a chosen key and time are served, and Any serves random (${instrument})`, async ({ page }) => {
    const errors = watchErrors(page);
    await onboard(page, 'allow');
    await chooseInstrument(page, instrument);
    const home = page.getByTestId('screen-home');
    await home.locator('[data-setup-row="mode"]').getByRole('radio', { name: 'Practice', exact: true }).click();

    // A few difficulties up, so more than one time signature and key have music.
    const diff = await openRow(page, 'difficulty');
    for (let i = 0; i < 3; i++) await diff.getByRole('button', { name: /^Increase/ }).click();
    await closeRow(page, 'difficulty');

    // Fresh settings: Key and Time are on Any, and the other options are usable straight away.
    let key = await openRow(page, 'key');
    let keys = await keyRadios(page, key);
    const keyChips = keys.locator('[role="radio"][data-key]');
    const anyKey = keys.locator('[role="radio"]:not([data-key])');
    await expect(anyKey).toHaveAttribute('aria-checked', 'true');
    expect(await keyChips.count()).toBeGreaterThan(1);
    const chosenKey = (await keyChips.last().getAttribute('data-key'))!;
    await keyChips.last().click();
    keys = await keyRadios(page, key);
    await expect(keys.locator(`[data-key="${chosenKey}"]`)).toHaveAttribute('aria-checked', 'true');
    await expect(keys.locator('[role="radio"]:not([data-key])')).toHaveAttribute('aria-checked', 'false');
    if (!isPhone(page)) await page.keyboard.press('Escape');
    await closeRow(page, 'key');

    let time = await openRow(page, 'time');
    const meters = time.getByRole('radio');
    await expect(meters.first()).toHaveAttribute('aria-checked', 'true');
    const n = await meters.count();
    expect(n).toBeGreaterThan(1);
    const lastMeter = meters.nth(n - 1);
    const spoken = (await lastMeter.getAttribute('aria-label'))!; // "3 4 time" or "3/4, few pieces"
    const chosenMeter = meterOf(spoken);
    await lastMeter.click();
    await expect(lastMeter).toHaveAttribute('aria-checked', 'true');
    await closeRow(page, 'time');

    await startAndReveal(page);
    const s = await served(page);
    expect(s.instrumentId).toBe(instrument);
    expect(`${s.writtenKey.fifths}:${s.writtenKey.mode}`).toBe(chosenKey);
    expect(`${s.meter.beats}/${s.meter.beatType}`).toBe(chosenMeter);

    // Back on Practice: choose Any key and Any time again; the request stays random and a shown meter is served.
    await backToPractice(page);
    key = await openRow(page, 'key');
    await (await keyRadios(page, key)).locator('[role="radio"]:not([data-key])').click();
    await closeRow(page, 'key');
    time = await openRow(page, 'time');
    const shown = (await time.getByRole('radio').evaluateAll((els) => els.slice(1).map((e) => e.getAttribute('aria-label') ?? ''))).map(meterOf);
    await time.getByRole('radio').first().click();
    await closeRow(page, 'time');
    await startAndReveal(page);
    const r = await served(page);
    expect(r.instrumentId).toBe(instrument);
    expect(r.requested.writtenKey).toBe('random');
    expect(r.requested.meter).toBe('random');
    expect(shown).toContain(`${r.meter.beats}/${r.meter.beatType}`);
    expect(errors).toEqual([]);
  });
}
