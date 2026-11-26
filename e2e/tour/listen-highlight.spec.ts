// The sounding-note highlight during Listen (Listen playback review): the owner's excerpt (arne-lc8871933-voice-m37-44,
// baritone, difficulty 1, C major, 3/4, ♩ = 64) on the read-through, through the production build. A frame loop in the
// page samples which written note the score lights (`data-sounding-note` on the frame) against the clock as heard, and
// every sample away from a note boundary must name the note the playback's own timeline says is sounding (nothing
// during the lead-in, a rest or after the end). Stop clears it at once. One screenshot per project goes to
// docs/screenshots/listen-highlight/.
// Run with -c e2e/tour/playwright.tour.config.ts listen-highlight.spec.ts.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { onboard, watchErrors } from '../loop/flow.ts';

test.skip(process.env['E2E_TOUR'] !== '1', 'run with -c e2e/tour/playwright.tour.config.ts');

const EXCERPT = 'arne-lc8871933-voice-m37-44';
const OUT = join(process.cwd(), 'docs', 'screenshots', 'listen-highlight');

type Span = { idx: number; startsAt: number; endsAt: number };
type Sample = { t: number; shown: number | null };
type Win = {
  __sr: {
    session: {
      current: { settings: Record<string, unknown> } | null;
      prepare(s: Record<string, unknown>): Promise<{ excerptId: string }>;
      plan: { expected: unknown[] } | null;
      sounds: { getState(): { playing: string | null; notes?: { spans: Span[]; clock(): number } | null } };
    };
  };
  __hl?: { samples: Sample[]; changes: Sample[]; spans: Span[] | null; on: boolean };
};

/** The owner's excerpt for the baritone at difficulty 1 in 3/4, at `bpm` (the session's own prepare, seed 1). */
async function ownersExcerpt(page: Page, bpm: number): Promise<void> {
  await page.getByRole('button', { name: /^Start (practice|ranked try)/ }).click();
  await expect(page.getByTestId('scan-cover')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__sr.session.current !== null), { timeout: 30_000 }).toBe(true);
  const id = await page.evaluate(
    async ({ bpm }) => {
      const s = (window as unknown as Win).__sr.session;
      const p = await s.prepare({ ...s.current!.settings, instrumentId: 'voice-baritone', level: 1, mode: 'practice', meter: '3/4', writtenKey: 'random', bpm, seed: 1 });
      return p.excerptId;
    },
    { bpm },
  );
  expect(id).toBe(EXCERPT);
  await page.getByRole('button', { name: 'Show the music' }).click();
  await expect(page.getByTestId('screen-practice.scan')).toHaveAttribute('data-state', 'scanning');
  await expect.poll(() => page.evaluate(() => document.fonts.check('30pt Bravura')), { timeout: 15_000 }).toBe(true);
}

/**
 * Records each change of the lit note (a MutationObserver on the frame's `data-sounding-note`) with the playback's
 * heard clock at that moment, plus a frame-by-frame sample of what is lit.
 */
async function startSampling(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as Win;
    const hl = { samples: [] as Sample[], changes: [] as Sample[], spans: null as Span[] | null, on: true };
    w.__hl = hl;
    const lit = (): number | null => {
      const v = document.querySelector('[data-sounding-note]')?.getAttribute('data-sounding-note');
      return v === undefined || v === null ? null : Number(v);
    };
    let last: number | null = null;
    new MutationObserver(() => {
      const notes = w.__sr.session.sounds.getState().notes;
      const now = lit();
      if (!hl.on || !notes || now === last) return;
      last = now;
      hl.changes.push({ t: notes.clock(), shown: now });
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-sounding-note'] });
    const step = (): void => {
      if (!hl.on) return;
      const notes = w.__sr.session.sounds.getState().notes;
      if (notes) {
        hl.spans ??= notes.spans.map((x) => ({ idx: x.idx, startsAt: x.startsAt, endsAt: x.endsAt }));
        hl.samples.push({ t: notes.clock(), shown: lit() });
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

test('Listen lights each written note as it sounds, nothing in the rests, and Stop clears it', async ({ page }, info) => {
  test.setTimeout(240_000);
  const errors = watchErrors(page);
  mkdirSync(OUT, { recursive: true });
  await onboard(page, 'decline');
  await ownersExcerpt(page, 64);
  const expectedCount = await page.evaluate(() => (window as unknown as Win).__sr.session.plan!.expected.length);
  expect(expectedCount).toBe(16);

  await startSampling(page);
  await page.getByRole('button', { name: /^Listen first/ }).click();
  await expect(page.getByRole('button', { name: /^Stop/ }).first()).toBeVisible();
  // A screenshot while the fifth note (C4, bar 3) sounds.
  await expect.poll(() => page.evaluate(() => document.querySelector('[data-sounding-note]')?.getAttribute('data-sounding-note') ?? ''), { timeout: 20_000, intervals: [20] }).toBe('4');
  const disc = page.locator('.sf-sounding').first();
  await expect(disc).toBeVisible();
  // On every size the lit note is on screen (the line follows on phones).
  const box = await disc.boundingBox();
  const vp = page.viewportSize()!;
  expect(box && box.y >= 0 && box.y + box.height <= vp.height, `the sounding note is on screen: ${JSON.stringify(box)}`).toBe(true);
  await page.screenshot({ path: join(OUT, `${info.project.name}.png`), animations: 'disabled' });

  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__sr.session.sounds.getState().playing), { timeout: 40_000 }).toBeNull();
  const { samples, changes, spans } = await page.evaluate(() => {
    const hl = (window as unknown as Win).__hl!;
    hl.on = false;
    return { samples: hl.samples, changes: hl.changes, spans: hl.spans! };
  });
  expect(spans.map((s) => s.idx)).toEqual([...Array(16).keys()]);
  const want = (t: number): number | null => spans.find((s) => s.startsAt <= t && t < s.endsAt)?.idx ?? null;
  // Each note lights once, in order, at its heard start (never before it; within a frame or two after it), and the
  // highlight goes off only where nothing sounds (the rests, the end).
  const ons = changes.filter((c) => c.shown !== null);
  expect(ons.map((c) => c.shown)).toEqual([...Array(16).keys()]);
  const late = ons.map((c) => c.t - spans[c.shown as number]!.startsAt);
  test.info().annotations.push({ type: 'lit after its start (ms)', description: late.map((d) => (d * 1000).toFixed(0)).join(' ') });
  for (const d of late) {
    expect(d).toBeGreaterThanOrEqual(-0.001);
    expect(d).toBeLessThan(0.1);
  }
  const edges = spans.flatMap((s) => [s.startsAt, s.endsAt]);
  for (const c of changes.filter((x) => x.shown === null)) expect(want(c.t) === null || edges.some((e) => Math.abs(c.t - e) < 0.1), `off at ${c.t} while a note sounds`).toBe(true);
  // Frame by frame, away from a change, the lit note is the one sounding.
  const wrong = samples.filter((s) => !edges.some((e) => Math.abs(s.t - e) < 0.1) && s.shown !== want(s.t));
  test.info().annotations.push({ type: 'samples', description: `${samples.length} frames, ${wrong.length} wrong` });
  expect(samples.length).toBeGreaterThan(200);
  expect(wrong.length, JSON.stringify(wrong.slice(0, 5))).toBeLessThanOrEqual(Math.ceil(samples.length * 0.01));
  // The lead-in bar shows nothing.
  expect(samples.filter((s) => s.t < spans[0]!.startsAt - 0.1).every((s) => s.shown === null)).toBe(true);
  await expect(page.locator('.sf-sounding')).toHaveCount(0);

  // Stop in the middle: the highlight goes with the sound.
  await page.getByRole('button', { name: /^Listen first/ }).click();
  await expect.poll(() => page.evaluate(() => document.querySelector('[data-sounding-note]')?.getAttribute('data-sounding-note') ?? ''), { timeout: 20_000, intervals: [20] }).toBe('2');
  await page.getByRole('button', { name: /^Stop/ }).first().click();
  await expect(page.locator('.sf-sounding')).toHaveCount(0);
  await expect(page.locator('[data-sounding-note]')).toHaveCount(0);
  await expect(page.locator('[data-sounding]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
