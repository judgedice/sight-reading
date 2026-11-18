// Shared helpers for the design QA specs: onboarding through the UI, axe injection, tap-target and motion probes.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';

/** Source of axe-core: the installed package, or the file named by AXE_CORE_PATH. Throws when neither exists. */
export function axeSource(): string {
  const p = process.env['AXE_CORE_PATH'];
  if (p) return readFileSync(p, 'utf8');
  try {
    return readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
  } catch {
    throw new Error('axe-core is not installed: add it as a devDependency (pnpm add -D axe-core) or set AXE_CORE_PATH to axe.min.js');
  }
}

export interface AxeViolation {
  id: string;
  impact: string | null;
  nodes: string[];
}

/** Runs axe on the current page and returns serious and critical violations. */
export async function axeSeriousViolations(page: Page): Promise<AxeViolation[]> {
  await page.evaluate(axeSource());
  const raw = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run(ctx: unknown, opts: unknown): Promise<{ violations: { id: string; impact: string | null; nodes: { target: unknown[]; failureSummary?: string }[] }[] }> } }).axe;
    const r = await axe.run(document, { resultTypes: ['violations'] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 4).map((n) => `${String(n.target.join(' '))} | ${(n.failureSummary ?? '').split('\n').slice(1, 2).join('').trim()}`) }));
  });
  return raw.filter((v) => v.impact === 'serious' || v.impact === 'critical');
}

/** Welcome, instrument, microphone, calibration (skipped), level (chosen) and home: leaves the app on the home screen. */
export async function onboard(page: Page, visit?: (name: string) => Promise<void>): Promise<void> {
  const step = async (name: string): Promise<void> => visit?.(name);
  await page.goto('./');
  await expect(page.getByTestId('screen-welcome')).toBeVisible({ timeout: 60_000 });
  await step('welcome');
  await page.getByRole('button', { name: 'Get started' }).click();
  await step('onboarding-instrument');
  await page.getByRole('radio', { name: /Flute/ }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('ob-mic')).toBeVisible();
  await step('onboarding-mic');
  await page.getByRole('button', { name: 'Allow microphone' }).click();
  await expect(page.getByTestId('calibration-card')).toBeVisible({ timeout: 15_000 });
  await step('onboarding-calibration');
  await page.getByTestId('calibration-card').getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByTestId('ob-level')).toBeVisible();
  await step('onboarding-level');
  await page.getByRole('button', { name: "I'll choose" }).click();
  await step('onboarding-level-choose');
  await page.getByRole('button', { name: 'Start practising' }).click();
  await expect(page.getByTestId('screen-home')).toBeVisible({ timeout: 15_000 });
}

/** Hash routes that need no take, in tour order. `#/dev/components` is last (dev server only). */
export const HASH_ROUTES: readonly string[] = [
  '#/', '#/progress', '#/history', '#/settings', '#/settings/audio', '#/settings/display', '#/settings/practice',
  '#/settings/accessibility', '#/settings/data', '#/settings/about', '#/calibrate', '#/credits', '#/practice/tips', '#/practice/results',
  '#/no-such-page', '#/dev/components',
];

export async function go(page: Page, hash: string): Promise<void> {
  await page.evaluate((h) => { window.location.hash = h; }, hash);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(400);
}

export interface SmallTarget {
  desc: string;
  w: number;
  h: number;
}

/** Visible interactive elements whose box (or, for a visually hidden native input, its label's box) is under 44 x 44. */
export async function smallTargets(page: Page, min = 44): Promise<SmallTarget[]> {
  return page.evaluate((m) => {
    const sel = 'a[href], button, input, select, textarea, summary, [role="button"], [role="tab"], [role="radio"], [role="checkbox"], [role="switch"], [role="slider"], [role="link"], [role="menuitem"]';
    const out: { desc: string; w: number; h: number }[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      if (el.closest('[inert], [hidden], [aria-hidden="true"]')) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      if (el.classList.contains('app-skip-link')) continue;
      let r = el.getBoundingClientRect();
      if ((r.width < m || r.height < m) && el instanceof HTMLInputElement) {
        // A native input drawn by a sibling (switch, radio, segment): the target is its label box. A hidden file input
        // opened by a button has no label; the button is the target.
        const label = el.labels?.[0] ?? el.closest('label');
        if (label) r = label.getBoundingClientRect();
        else if (el.type === 'file') continue;
      }
      if (r.width === 0 && r.height === 0) continue;
      if (r.width < m - 0.5 || r.height < m - 0.5) {
        const name = el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30) ?? '';
        out.push({ desc: `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className).split(' ')[0] ?? ''} "${name}"`, w: Math.round(r.width), h: Math.round(r.height) });
      }
    }
    return out;
  }, min);
}

/** Running animations and transitions that move something (transform, translate, rotate, scale) right now. */
export async function movingAnimations(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.playState === 'running')
      .filter((a) => {
        const frames = (a.effect as KeyframeEffect | null)?.getKeyframes?.() ?? [];
        const props = new Set(frames.flatMap((f) => Object.keys(f)));
        const name = (a as CSSTransition).transitionProperty ?? '';
        return ['transform', 'translate', 'rotate', 'scale', 'inset-inline-start', 'left'].some((p) => props.has(p) || name === p);
      })
      .map((a) => `${(a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? 'animation'} on ${(a.effect as KeyframeEffect | null)?.target?.tagName ?? '?'}`),
  );
}
