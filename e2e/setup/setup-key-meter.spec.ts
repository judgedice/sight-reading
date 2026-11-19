// Regression: the Key select and the Time segments looked dead on a fresh install, because Key and Time start on
// Random and Random disabled both controls (only the small Random chip turned them back on). Choosing a key or a time
// signature must work straight away, turn Random off for that row, and reach the excerpt that is served.
// Run with -c e2e/setup/playwright.setup.config.ts.
import { expect, test, type Page } from '@playwright/test';
import { onboard, watchErrors } from '../loop/flow.ts';

test.skip(process.env['E2E_SETUP'] !== '1', 'run with -c e2e/setup/playwright.setup.config.ts');

interface Served {
  instrumentId: string;
  writtenKey: { fifths: number; mode: string };
  meter: { beats: number; beatType: number };
}

const served = (page: Page): Promise<Served> =>
  page.evaluate(() => {
    const s = (window as unknown as { __sr: { session: { prepared: { writtenKey: { fifths: number; mode: string }; meter: { beats: number; beatType: number } } | null; plan: { inst: { id: string } } | null } } }).__sr.session;
    if (!s.prepared || !s.plan) throw new Error('nothing served');
    return { instrumentId: s.plan.inst.id, writtenKey: s.prepared.writtenKey, meter: s.prepared.meter };
  });

async function startAndReveal(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('scan-cover')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Show the music' }).click();
  await expect(page.getByTestId('screen-practice.scan').locator('[data-expected-idx]').first()).toBeVisible({ timeout: 30_000 });
}

for (const instrument of ['flute', 'voice-bass', 'trumpet-bb']) {
  test(`key and time can be chosen while Random is on, and are served (${instrument})`, async ({ page }) => {
    const errors = watchErrors(page);
    await onboard(page, 'decline');
    const home = page.getByTestId('screen-home');
    await home.getByRole('combobox', { name: 'Instrument', exact: true }).selectOption(instrument);
    await home.getByRole('combobox', { name: 'Output' }).selectOption({ label: 'Wired headphones' });
    await home.getByRole('radiogroup', { name: 'Mode' }).getByText('Practice', { exact: true }).click();
    // A few levels up so more than one time signature and key have music.
    for (let i = 0; i < 3; i++) await home.getByRole('button', { name: /^Increase/ }).click();

    // Fresh settings: Key and Time are on Random, and their controls must still be usable.
    const key = home.getByRole('combobox', { name: 'Key', exact: true });
    const keyChip = home.locator('fieldset', { hasText: 'Key' }).getByRole('button', { name: 'Random' });
    const timeChip = home.locator('fieldset', { has: page.getByRole('radiogroup', { name: 'Time' }) }).getByRole('button', { name: 'Random' });
    await expect(keyChip).toHaveAttribute('aria-pressed', 'true');
    await expect(timeChip).toHaveAttribute('aria-pressed', 'true');
    await expect(key).toBeEnabled();

    const options = await key.evaluate((el) =>
      Array.from((el as HTMLSelectElement).options)
        .filter((o) => o.value !== 'random' && !o.disabled)
        .map((o) => o.value),
    );
    expect(options.length).toBeGreaterThan(1);
    const chosenKey = options[options.length - 1]!;
    await key.selectOption(chosenKey);
    await expect(key).toHaveValue(chosenKey);
    await expect(keyChip).toHaveAttribute('aria-pressed', 'false');

    const time = home.getByRole('radiogroup', { name: 'Time' });
    const enabled = await time.locator('input:not(:disabled)').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    expect(enabled.length).toBeGreaterThan(0);
    const chosenMeter = enabled[enabled.length - 1]!;
    await time.locator('label', { has: page.locator(`input[value="${chosenMeter}"]`) }).click();
    await expect(time.locator(`input[value="${chosenMeter}"]`)).toBeChecked();
    await expect(timeChip).toHaveAttribute('aria-pressed', 'false');

    await startAndReveal(page);
    const s = await served(page);
    expect(s.instrumentId).toBe(instrument);
    expect(`${s.writtenKey.fifths}:${s.writtenKey.mode}`).toBe(chosenKey);
    expect(`${s.meter.beats}/${s.meter.beatType}`).toBe(chosenMeter);
    expect(errors).toEqual([]);
  });
}

test('every Random-backed row (level, tempo) can be moved directly and turns Random off', async ({ page }) => {
  await onboard(page, 'decline');
  const home = page.getByTestId('screen-home');
  const levelChip = home.locator('fieldset', { has: page.getByRole('group', { name: 'Difficulty', exact: true }) }).getByRole('button', { name: 'Random' });
  const tempoChip = home.locator('fieldset', { has: page.getByRole('slider', { name: 'Tempo' }) }).getByRole('button', { name: 'Random' });
  await levelChip.click();
  await expect(levelChip).toHaveAttribute('aria-pressed', 'true');
  await home.getByRole('button', { name: /^Increase/ }).click();
  await expect(levelChip).toHaveAttribute('aria-pressed', 'false');
  await expect(tempoChip).toHaveAttribute('aria-pressed', 'true');
  const slider = home.getByRole('slider', { name: 'Tempo' });
  await expect(slider).toBeEnabled();
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(tempoChip).toHaveAttribute('aria-pressed', 'false');
});
