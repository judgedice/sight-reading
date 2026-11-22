// The scale try as the owner meets it (PLAN R70 to R73), in Chromium against the production build, in the default
// `pnpm test:e2e` (chromium project; practised without listening, so nothing depends on a microphone). A baritone
// picks Practice > Scales > five-note scale in C (♩ = 66, 4/4) and starts. A frame loop in the page records, every
// animation frame from Start to the end of bar 3: the audible clock, the beat line's x, whether anything says "Sing",
// whether the first note carries a mark, and every DOM change inside the try screen. It then checks:
//   - the count-in is one bar (four clicks), nothing says "Sing" before bar 1 and it does say it on bar 1's first beat;
//   - no first-note mark (brass disc, name, pulse, brass ink) during the count-in or the try;
//   - nothing but the beat line changes per beat: the only DOM changes after the downbeat are the line itself, the
//     band leaving after the go beat and "Bar n of 3" at each barline; and the computed style of every element of the
//     screen (the line excepted) is the same at the middle of every beat;
//   - the line goes head to head at a steady speed: it crosses each head at its beat within 1.5 px, it never jumps
//     inside the system, each beat's speed is what the two heads' spacing gives, and beat 4 is not slow.
// Each run writes its per-beat speeds to test-results/scale-try/<name>.json (BUILD-NOTES "Scale try experience").
// A second run sets Settings > Practice > "Beat line timing" to 100 ms later and checks the line follows it.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { watchErrors } from './loop/flow.ts';

interface Sample {
  /** Audible clock, s (`AudioBackend.audibleNow`, before the player's timing offset). */
  a: number;
  /** The same clock (kept apart so the timing run reads it by name). */
  raw: number;
  x: number | null;
  system: number | null;
  /** The screen shows "Sing" (innerText, so hidden text does not count). */
  sing: boolean;
  /** Something marks the first note (disc, name, pulse, brass ink). */
  firstMark: boolean;
}

interface Change {
  a: number;
  what: string;
}

interface Recording {
  clock: { t0: number; bpm: number; countInBeats: number };
  samples: Sample[];
  changes: Change[];
  styles: { beat: number; sig: string }[];
  heads: { beat: number; x: number; system: number }[];
}

/** Onboarding as a baritone without a microphone ("Not now"): the try is practised without listening. */
async function onboardBaritone(page: Page): Promise<void> {
  // ?testClock=1 exposes window.__sr (the audio clock and the session) to the recorder.
  await page.goto('./?testClock=1');
  await expect(page.getByTestId('screen-welcome')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByRole('radio', { name: /^Baritone voice/ }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('ob-mic')).toBeVisible();
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByTestId('ob-level')).toBeVisible();
  await page.getByRole('button', { name: "I'll choose" }).click();
  await page.getByRole('button', { name: 'Start practising' }).click();
  await expect(page.getByTestId('screen-home')).toBeVisible({ timeout: 15_000 });
}

async function openScale(page: Page): Promise<void> {
  await page.getByTestId('scales-entry').click();
  await page.getByTestId('scales-chooser').getByRole('button', { name: /^Five-note scale in C major, C3 to G3/ }).click();
  const scan = page.getByTestId('screen-practice.scan');
  await expect(scan).toHaveAttribute('data-state', 'scanning', { timeout: 30_000 });
  await expect(scan.locator('[data-expected-idx]').first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => document.fonts.check('30pt Bravura')), { timeout: 15_000 }).toBe(true);
}

/** Starts the try and records every frame until the end of bar 3 (12 beats). */
async function recordTry(page: Page): Promise<Recording> {
  await page.evaluate(() => {
    type Sr = { audio: { audibleNow(): number }; session: { takeClock: { t0: number; bpm: number; countInBeats: number } | null } };
    const w = window as unknown as { __sr: Sr; __scaleTry: unknown };
    const rec = { clock: null as unknown, samples: [] as unknown[], changes: [] as unknown[], styles: [] as unknown[], done: false, styleBeat: 0, error: null as string | null, heads: null as unknown };
    w.__scaleTry = rec;
    const visual = (): number => w.__sr.audio.audibleNow();
    const describe = (n: Node): string => {
      const e = n.nodeType === 1 ? (n as Element) : n.parentElement;
      if (!e) return '?';
      const cls = typeof e.className === 'string' ? e.className : (e.getAttribute('class') ?? '');
      return `${e.tagName.toLowerCase()}${cls ? '.' + cls.trim().split(/\s+/).join('.') : ''}`;
    };
    // The line moves (that is the point); the playhead marker is invisible; the live region is for screen readers only.
    const IGNORED = 'line.sf-beat-line, line.sr-playhead, .ui-visually-hidden, .ui-visually-hidden *';
    let observer: MutationObserver | null = null;
    const observe = (root: Element): void => {
      observer = new MutationObserver((list) => {
        const a = visual();
        // Net change per element and attribute over the batch: React may clear and restore an input's name.
        const firstOld = new Map<string, string | null>();
        const keyOf = (m: MutationRecord): string => `${list.indexOf(list.find((x) => x.target === m.target)!)}|${m.attributeName}`;
        for (const m of list) if (m.type === 'attributes' && !firstOld.has(keyOf(m))) firstOld.set(keyOf(m), m.oldValue);
        const reported = new Set<string>();
        for (const m of list) {
          if (m.type === 'attributes') {
            const k = keyOf(m);
            if (reported.has(k) || (m.target as Element).getAttribute(m.attributeName!) === firstOld.get(k)) continue;
            reported.add(k);
          }
          const t = m.target.nodeType === 1 ? (m.target as Element) : m.target.parentElement;
          if (t?.matches(IGNORED)) continue;
          if (m.type === 'childList' && [...Array.from(m.addedNodes), ...Array.from(m.removedNodes)].every((n) => n.nodeType === 1 && (n as Element).matches(IGNORED))) continue;
          if (m.type === 'characterData' && m.target.textContent === m.oldValue) continue;
          const what = m.type === 'attributes' ? `${describe(m.target)}[${m.attributeName}]` : m.type === 'characterData' ? `text in ${describe(m.target)}` : `children of ${describe(m.target)}`;
          rec.changes.push({ a, what });
        }
      });
      observer.observe(root, { subtree: true, attributes: true, attributeOldValue: true, childList: true, characterData: true, characterDataOldValue: true });
    };
    const STYLE_PROPS = ['color', 'fill', 'stroke', 'opacity', 'visibility', 'display', 'transform', 'background-color', 'box-shadow', 'outline-color', 'filter'] as const;
    const styleSig = (root: Element): string => {
      const parts: string[] = [];
      for (const e of [root, ...Array.from(root.querySelectorAll('*'))]) {
        if (e.matches(IGNORED) || e.closest('.sf-band')) continue;
        const cs = getComputedStyle(e);
        parts.push(STYLE_PROPS.map((p) => cs.getPropertyValue(p)).join(','));
      }
      return parts.join('|');
    };
    // Each frame, read after the app's own frame callback has drawn (the recorder's callback was registered first, so
    // in the frame itself it would see the line one frame old): a task queued from the callback runs after them all.
    const frame = (): void => {
      setTimeout(() => {
        try {
          step();
        } catch (e) {
          rec.error = String(e);
          rec.done = true;
        }
      }, 0);
    };
    const step = (): void => {
      const sr = w.__sr;
      if (sr.session.takeClock && !rec.clock) rec.clock = sr.session.takeClock;
      const c = rec.clock as { t0: number; bpm: number; countInBeats: number } | null;
      const root = document.querySelector('.perform');
      if (root && !observer) observe(root);
      const a = visual();
      const el = document.querySelector('line.sf-beat-line');
      const shown = el !== null && el.getAttribute('visibility') === 'visible' && el.getBoundingClientRect().height > 0;
      const r = shown ? el.getBoundingClientRect() : null;
      const svg = shown ? el.closest('svg') : null;
      const beat = c ? (a - c.t0) / (60 / c.bpm) : -Infinity;
      rec.samples.push({
        a,
        raw: sr.audio.audibleNow(),
        x: r && svg ? r.left + r.width / 2 - svg.getBoundingClientRect().left : null,
        system: svg ? Number(svg.getAttribute('data-system')) : null,
        sing: root ? /\bSing\b/.test((root as HTMLElement).innerText) : false,
        firstMark: document.querySelector('.sf-score .sf-hl-disc, .sf-score .sf-hl-name, .sf-score .sf-hl-pulse, .sf-score [data-brass]') !== null,
      });
      // The written heads' centres, read on the try screen once the music runs.
      if (c && beat >= 0.5 && rec.heads === null) {
        const plan = (w.__sr.session as unknown as { plan: { expected: { onsetBeat: number; eventIds: string[] }[] } | null }).plan;
        const heads: { beat: number; x: number; system: number }[] = [];
        for (const e of plan?.expected ?? []) {
          const head = Array.from(document.querySelectorAll(`.sf-score [data-event-id="${e.eventIds[0]}"] .vf-notehead text`)).find((h) => h.getBoundingClientRect().width > 0);
          const hs = head?.closest('svg');
          if (!head || !hs) continue;
          const hr = head.getBoundingClientRect();
          heads.push({ beat: e.onsetBeat, x: hr.left + hr.width / 2 - hs.getBoundingClientRect().left, system: Number(hs.getAttribute('data-system')) });
        }
        rec.heads = heads;
      }
      // A style snapshot near the middle of each beat of the music after the go beat (beats 1 to 11).
      const k = Math.floor(beat);
      if (root && c && k >= 1 && k <= 11 && k > rec.styleBeat && beat - k >= 0.4) {
        rec.styleBeat = k;
        rec.styles.push({ beat, sig: styleSig(root) });
      }
      if (c && beat > 12) {
        rec.done = true;
        observer?.disconnect();
      } else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  await page.getByRole('button', { name: 'Start playing' }).click();
  await expect(page.getByTestId('screen-practice.play')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => (window as unknown as { __scaleTry: { done: boolean } }).__scaleTry.done, null, { timeout: 90_000, polling: 250 });
  return page.evaluate(() => {
    const r = (window as unknown as { __scaleTry: Recording & { error: string | null } }).__scaleTry;
    if (r.error) throw new Error(`recorder: ${r.error}`);
    return { clock: r.clock, samples: r.samples, changes: r.changes, styles: r.styles, heads: r.heads ?? [] };
  });
}

/** The line's x at an audible time, from the two frames around it (null when hidden or off the system). */
function xAt(samples: readonly Sample[], t: number): { x: number; system: number } | null {
  const i = samples.findIndex((s) => s.a >= t);
  if (i <= 0) return null;
  const p = samples[i - 1]!;
  const q = samples[i]!;
  if (p.x === null || q.x === null || p.system !== q.system || q.a <= p.a) return null;
  return { x: p.x + ((t - p.a) / (q.a - p.a)) * (q.x - p.x), system: p.system! };
}

interface Speeds {
  /** Measured px/s in each beat of the music. */
  measured: number[];
  /** px/s the heads' spacing gives in each beat. */
  heads: number[];
  /** Largest frame-to-frame move inside a system, px, and the frame's expected move. */
  maxStep: { px: number; expected: number; beat: number };
}

function speeds(r: Recording): Speeds {
  const beatSec = 60 / r.clock.bpm;
  const time = (b: number): number => r.clock.t0 + b * beatSec;
  const measured: number[] = [];
  const heads: number[] = [];
  for (let b = 0; b < 11; b++) {
    const p = xAt(r.samples, time(b + 0.02));
    const q = xAt(r.samples, time(b + 0.98));
    measured.push(p && q && p.system === q.system ? (q.x - p.x) / (0.96 * beatSec) : NaN);
    const h0 = r.heads.find((h) => h.beat === b);
    const h1 = r.heads.find((h) => h.beat === b + 1);
    const prev = r.heads.filter((h) => h.beat <= b).at(-1);
    const next = r.heads.find((h) => h.beat > b);
    // Inside a held note the line spreads its head-to-head distance over the note's beats.
    if (h0 && h1) heads.push((h1.x - h0.x) / beatSec);
    else if (prev && next) heads.push((next.x - prev.x) / ((next.beat - prev.beat) * beatSec));
    else heads.push(NaN);
  }
  let maxStep = { px: 0, expected: 0, beat: 0 };
  for (let i = 1; i < r.samples.length; i++) {
    const p = r.samples[i - 1]!;
    const q = r.samples[i]!;
    const b = (p.a - r.clock.t0) / beatSec;
    if (b < 0 || b > 8 || p.x === null || q.x === null || p.system !== q.system) continue;
    const step = Math.abs(q.x - p.x);
    const k = Math.min(10, Math.max(0, Math.floor(b)));
    if (step > maxStep.px) maxStep = { px: step, expected: (heads[k] ?? 0) * (q.a - p.a), beat: b };
  }
  return { measured, heads, maxStep };
}

async function setTiming(page: Page, ms: number): Promise<void> {
  await page.evaluate(() => (location.hash = '#/settings/practice'));
  const slider = page.getByRole('slider', { name: 'Beat line timing' });
  await expect(slider).toBeVisible({ timeout: 15_000 });
  await slider.fill(String(ms));
  await expect(page.getByTestId('beat-line-timing').locator('output')).toHaveText(ms === 0 ? '0 ms, as your device reports' : `${Math.abs(ms)} ms ${ms < 0 ? 'earlier' : 'later'}`);
  await page.evaluate(() => (location.hash = '#/'));
  await expect(page.getByTestId('screen-home')).toBeVisible({ timeout: 15_000 });
}

test('scale try: one bar of count-in, no "Sing" before bar 1, no first-note mark, only the line moves, steadily', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium', 'Chromium, once (practised without listening)');
  test.setTimeout(240_000);
  const errors = watchErrors(page);
  await onboardBaritone(page);
  await openScale(page);

  // The beat line switch is on the read-through, on, before the try starts.
  const scanSwitch = page.getByTestId('scan-beat-line').getByRole('switch', { name: 'Beat line' });
  await expect(scanSwitch).toBeVisible();
  await expect(scanSwitch).toBeChecked();

  const r = await recordTry(page);
  const beatSec = 60 / r.clock.bpm;
  const beatOf = (a: number): number => (a - r.clock.t0) / beatSec;
  const problems: string[] = [];

  // 1. One bar of count-in, and "Sing" only on bar 1's first beat.
  expect(r.clock.countInBeats, 'count-in clicks').toBe(4);
  const singBefore = r.samples.filter((s) => s.sing && beatOf(s.a) < -0.02);
  if (singBefore.length) problems.push(`"Sing" on screen before bar 1 at beat ${beatOf(singBefore[0]!.a).toFixed(2)}`);
  expect(r.samples.some((s) => s.sing && beatOf(s.a) >= 0 && beatOf(s.a) < 1), '"Sing" on the go beat').toBe(true);
  const singLate = r.samples.filter((s) => s.sing && beatOf(s.a) > 1.1);
  if (singLate.length) problems.push(`"Sing" still on screen at beat ${beatOf(singLate[0]!.a).toFixed(2)}`);

  // 2. No first-note mark from the first click on.
  // (The starting pitch marks it until the first click; React commits that change within a frame of the click.)
  const marked = r.samples.filter((s) => s.firstMark && beatOf(s.a) >= -r.clock.countInBeats + 0.1);
  if (marked.length) problems.push(`first-note mark at beat ${beatOf(marked[0]!.a).toFixed(2)}`);

  // 3. Nothing but the line changes per beat once the music runs (the band leaves after the go beat; the bar text
  // changes at a barline).
  for (const c of r.changes) {
    const b = beatOf(c.a);
    if (b < 0) continue;
    if (b <= 1.1 && /sf-band|sf-count|sf-host\[data-band\]|section\.perform\[data-state\]|sf-host/.test(c.what)) continue;
    if (/perform-centre-text/.test(c.what) && Math.abs(b / 4 - Math.round(b / 4)) * 4 < 0.15) continue;
    problems.push(`beat ${b.toFixed(2)}: ${c.what} changed`);
  }
  expect(r.styles.length, 'style snapshots').toBeGreaterThanOrEqual(8);
  for (const s of r.styles) if (s.sig !== r.styles[0]!.sig) problems.push(`computed styles differ at beat ${s.beat.toFixed(2)} from beat ${r.styles[0]!.beat.toFixed(2)}`);

  // 4. The line: through each head at its beat, no jump inside the system, steady between heads, beat 4 not slow.
  for (const h of r.heads) {
    if (h.beat < 0 || h.beat > 11) continue;
    const at = xAt(r.samples, r.clock.t0 + h.beat * beatSec + 1e-4);
    if (!at) continue;
    if (Math.abs(at.x - h.x) > 1.5 || at.system !== h.system) problems.push(`beat ${h.beat}: line at ${at.x.toFixed(1)}, head at ${h.x.toFixed(1)}`);
  }
  const sp = speeds(r);
  sp.measured.forEach((v, b) => {
    const want = sp.heads[b]!;
    if (!Number.isFinite(v) || !Number.isFinite(want)) return;
    if (Math.abs(v - want) > Math.max(3, 0.04 * want)) problems.push(`beat ${b}: ${v.toFixed(1)} px/s, heads give ${want.toFixed(1)}`);
  });
  const bar1 = sp.measured.slice(0, 4);
  const median = [...bar1].sort((x, y) => x - y)[1]!;
  if (!(bar1[3]! >= 0.9 * median)) problems.push(`beat 4 slow: ${bar1[3]!.toFixed(1)} px/s against ${median.toFixed(1)}`);
  // A frame never moves the line more than twice what that beat's speed gives (no jump inside the system).
  if (sp.maxStep.px > Math.max(3, 2 * sp.maxStep.expected)) problems.push(`jump of ${sp.maxStep.px.toFixed(1)} px at beat ${sp.maxStep.beat.toFixed(2)} (expected ${sp.maxStep.expected.toFixed(1)})`);

  const out = join(process.cwd(), 'test-results', 'scale-try');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `${info.project.name}.json`), JSON.stringify({ bpm: r.clock.bpm, measured: sp.measured, heads: sp.heads, maxStep: sp.maxStep, frames: r.samples.length }, null, 1));
  process.stdout.write(`[scale-try] px/s per beat ${sp.measured.map((v) => v.toFixed(1)).join(' ')}; heads ${sp.heads.map((v) => v.toFixed(1)).join(' ')}; max step ${sp.maxStep.px.toFixed(2)} px\n`);
  expect(problems).toEqual([]);
  expect(errors).toEqual([]);
});

test('Beat line timing: 100 ms later moves the line 100 ms later on the heard clock', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium', 'Chromium, once');
  test.setTimeout(240_000);
  const errors = watchErrors(page);
  await onboardBaritone(page);
  await setTiming(page, 100);
  await openScale(page);
  const r = await recordTry(page);
  const beatSec = 60 / r.clock.bpm;
  const problems: string[] = [];
  // At each head's beat on the raw heard clock the line has not reached the head yet; 100 ms later it is there.
  for (const h of r.heads) {
    if (h.beat < 1 || h.beat > 10) continue;
    const t = r.clock.t0 + h.beat * beatSec;
    const i = r.samples.findIndex((s) => s.raw >= t + 0.1);
    const p = r.samples[i - 1];
    const q = r.samples[i];
    if (!p || !q || p.x === null || q.x === null || p.system !== q.system) continue;
    const x = p.x + ((t + 0.1 - p.raw) / (q.raw - p.raw)) * (q.x - p.x);
    if (Math.abs(x - h.x) > 1.5) problems.push(`beat ${h.beat}: line ${x.toFixed(1)} at +100 ms, head ${h.x.toFixed(1)}`);
  }
  expect(problems).toEqual([]);
  expect(errors).toEqual([]);
});
