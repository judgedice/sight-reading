// The owner walkthrough (05 section 16 item 20), scripted: as a baritone, pick the voice, see the range, set a key and a
// time signature, hear the starting pitch with its explanation, listen to the excerpt and hear the new click. The script
// uses only what a player sees (roles and visible names, no test ids for the steps) and fails when a step needs anything
// the screen does not offer. It checks that each step is there and works; whether the owner finds each step without help
// is the manual run recorded in docs/redesign/09-qa-report.md.
//   pnpm exec playwright test -c e2e/a11y/playwright.a11y.config.ts owner-walkthrough.spec.ts --project=d1440-light
import { expect, test } from '@playwright/test';
import { LOOP_T0_SEC } from '../loop/flow.ts';

test.skip(process.env['E2E_A11Y'] !== '1', 'run with -c e2e/a11y/playwright.a11y.config.ts');
test.beforeEach(({ browserName: _b }, info) => {
  test.skip(!/^(d1440|p390)-light$/.test(info.project.name), 'one desktop and one phone run');
});

test('a baritone picks a voice, sees the range, sets key and time, hears the pitch, listens and hears the click', async ({ page }) => {
  const steps: string[] = [];
  const done = (s: string): void => {
    steps.push(s);
  };

  // 1. Pick the voice. The card is named in full; the range picture appears at once.
  await page.goto(`./?testClock=1&testClockSec=${LOOP_T0_SEC}`);
  await page.getByRole('button', { name: 'Get started' }).click();
  const baritone = page.getByRole('radio', { name: /^Baritone voice/ });
  await expect(baritone).toBeVisible();
  await baritone.check();
  await expect(baritone).toBeChecked();
  done('picked Baritone');

  // 2. The range: a figure that names the full range and the range at this difficulty.
  const figure = page.getByRole('figure', { name: /Baritone voice range: G2 to G4\. At difficulty \d+: / });
  await expect(figure).toBeVisible();
  done('saw the range picture and its text');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Allow microphone' }).click();
  await expect(page.getByTestId('calibration-card')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('calibration-card').getByRole('button', { name: 'Skip' }).click();
  await page.getByRole('button', { name: "I'll choose" }).click();
  await page.getByRole('button', { name: 'Start practising' }).click();
  await expect(page.getByTestId('screen-home')).toBeVisible({ timeout: 15_000 });

  // 3. Set a key: G major.
  const phone = /^p\d+/.test(test.info().project.name);
  if (phone) await page.getByRole('button', { name: /^Key:/ }).click();
  const gMajor = page.getByRole('radio', { name: /^G major/ });
  await gMajor.click();
  await expect(gMajor).toBeChecked();
  done('set the key to G major');
  if (phone) await page.getByRole('button', { name: 'Done' }).click();

  // 4. Set a time signature: raise the difficulty until a second meter is offered, then choose one that is not 4/4 if it
  //    is available, else the one shown.
  if (phone) await page.getByRole('button', { name: /^Difficulty:/ }).click();
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: /Increase Difficulty/ }).click();
  if (phone) await page.getByRole('button', { name: 'Done' }).click();
  if (phone) await page.getByRole('button', { name: /^Time:/ }).click();
  const time = page.locator('[data-setup-row="time"]').getByRole('radio');
  const timeCount = await time.count();
  expect(timeCount).toBeGreaterThanOrEqual(2);
  const target = time.nth(timeCount - 1);
  await target.click();
  await expect(target).toBeChecked();
  const timeName = (await target.getAttribute('aria-label')) ?? '';
  done(`set the time to "${timeName}"`);
  if (phone) await page.getByRole('button', { name: 'Done' }).click();

  // The output route (Settings > Sound), then Start in practice.
  await page.evaluate(() => (location.hash = '#/settings/audio'));
  await page.getByRole('combobox', { name: 'Output' }).selectOption({ label: 'Wired headphones' });

  // 7 (shown here while in Settings). The new click: three sounds with a preview each; one plays and shows its state.
  const beep = page.locator('[data-sound="beep"]');
  await expect(page.locator('[data-sound="classic"]')).toBeVisible();
  await expect(page.locator('[data-sound="woodblock"]')).toBeVisible();
  await beep.click();
  await expect(page.getByText('Playing: Beep')).toBeVisible();
  await beep.click(); // Stop
  done('heard the Beep click preview (Classic and Woodblock are beside it)');

  await page.evaluate(() => (location.hash = '#/'));
  await expect(page.getByTestId('screen-home')).toBeVisible();
  await page.getByRole('radio', { name: 'Practice' }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('scan-cover')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Show the music' }).click();
  await expect(page.getByTestId('screen-practice.scan')).toHaveAttribute('data-state', 'scanning');
  await expect(page.getByRole('paragraph').filter({ hasText: 'Difficulty' }).first()).toContainText('G major');

  // 5. Hear the starting pitch: the button, a visible line saying what it does, an info button, and a live caption.
  const pitch = page.getByRole('button', { name: /^Hear starting pitch/ });
  await expect(pitch).toBeVisible();
  if (phone) {
    // The dock is icons and short names; the explanation is one tap away in "What do these do?".
    await page.getByRole('button', { name: 'What do these do?' }).click();
    await expect(page.getByRole('dialog')).toContainText('Plays the key chord, then your first note.');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  } else {
    await expect(pitch).toContainText('Plays the key chord, then your first note.');
  }
  const info = page.getByRole('button', { name: 'About Hear starting pitch' });
  if (!phone) {
    await info.click();
    await expect(info).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('What is the reference?').filter({ visible: true }).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(info).toHaveAttribute('aria-expanded', 'false');
  }
  await pitch.click();
  await expect(page.getByText(/^Key chord: G major/).filter({ visible: true }).first()).toBeVisible({ timeout: 10_000 });
  done('heard the starting pitch, read what it is (info button), saw its caption');
  // The pitch ends by itself after the key chord and the first note.
  await expect(page.getByText(/^Key chord: G major/).filter({ visible: true })).toHaveCount(0, { timeout: 15_000 });

  // 6. Listen to the excerpt: in practice it plays at once and says where it is.
  const listen = page.getByRole('button', { name: /^Listen first/ });
  await listen.click();
  await expect(page.getByRole('button', { name: /^Stop/ }).first()).toBeVisible();
  await expect(page.getByText(/^Playing bar \d+ of \d+/).filter({ visible: true }).first()).toBeVisible({ timeout: 10_000 });
  done('listened to the excerpt with a live bar caption');
  await page.getByRole('button', { name: /^Stop/ }).first().click();

  test.info().annotations.push({ type: 'walkthrough', description: steps.join(' | ') });
  process.stdout.write(`[${test.info().project.name}] owner walkthrough: ${steps.join(' | ')}\n`);
  expect(steps).toHaveLength(7);
});
