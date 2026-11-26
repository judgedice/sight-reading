// Setup through the UI (round 3 wizard), visiting each step and stage, ending on Home with Flute chosen.
import { type Page } from '@playwright/test';
import { LOOP_T0_SEC, walkWizard } from '../loop/flow.ts';

export async function onboardWithVisits(page: Page, visit: (name: string) => Promise<void>): Promise<void> {
  await page.goto(`./?testClock=1&testClockSec=${LOOP_T0_SEC}`);
  await walkWizard(page, {
    mic: 'allow',
    visit: async (name) => {
      // Let the step settle (fonts, the stepper's bar) before a visit looks at it.
      await page.waitForTimeout(300);
      await visit(name);
    },
  });
}
