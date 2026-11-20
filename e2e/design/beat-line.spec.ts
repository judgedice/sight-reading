// Beat line (round 2): in Chromium, the try screen's beat line is where the music is when each click is heard. A frame
// loop in the page records, every animation frame, the audible clock (`AudioBackend.audibleNow`, exposed with
// ?testClock=1) and the line's client x; at each click's time (t0 + k beats) the line, interpolated between the two
// frames around it, must cross the notehead that starts on that beat. The take is practised without listening, so
// nothing depends on the fake microphone, and it is the path where nothing moved on the staff before the beat line.
// Under reduced motion the line also has to stand still between beats.
import { expect, test } from '@playwright/test';
import { onboard, setupAndStart, watchErrors } from '../loop/flow.ts';

test.skip(process.env['E2E_DESIGN'] !== '1', 'run with -c e2e/design/playwright.design.config.ts');

interface Sample {
  /** Audible clock, s. */
  a: number;
  /** Context clock, s. */
  now: number;
  /** Line centre, px from its system SVG's left edge; null when hidden. */
  x: number | null;
  system: number | null;
  /** The line is drawn on a system a page turn has taken off screen. */
  off: boolean;
}

interface Onset {
  beat: number;
  x: number;
  system: number;
}

test('the beat line crosses each note when its click is heard', async ({ page }, info) => {
  test.skip(!['desktop-light', 'iphone-light', 'iphone-reduced-motion'].includes(info.project.name), 'one desktop, one phone, and reduced motion');
  const errors = watchErrors(page);
  await onboard(page, 'decline');
  await setupAndStart(page);
  await page.getByRole('button', { name: 'Show the music' }).click();
  await expect(page.getByTestId('screen-practice.scan')).toHaveAttribute('data-state', 'scanning');
  await page.getByRole('button', { name: 'Start playing' }).click();
  const play = page.getByTestId('screen-practice.play');
  await expect(play).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Beat line' })).toHaveAttribute('aria-pressed', 'true');
  await expect(play.locator('.sf-host[data-frozen="true"] svg.sr-system').first()).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));

  // The written notes' centres, relative to their system SVG, for the systems on screen now. Read during the count-in
  // and again after the recording (a page turn may have brought later systems in), then merged by beat.
  const readOnsets = (): Promise<Onset[]> =>
    page.evaluate(() => {
      type Sr = { session: { plan: { expected: { onsetBeat: number; eventIds: string[] }[] } | null } };
      const w = window as unknown as { __sr: Sr };
      const out: Onset[] = [];
      for (const e of w.__sr.session.plan?.expected ?? []) {
        const heads = Array.from(document.querySelectorAll(`.sf-score [data-event-id="${e.eventIds[0]}"] .vf-notehead text`));
        const head = heads.find((h) => h.getBoundingClientRect().width > 0);
        const svg = head?.closest('svg');
        if (!head || !svg) continue;
        const r = head.getBoundingClientRect();
        out.push({ beat: e.onsetBeat, x: r.left + r.width / 2 - svg.getBoundingClientRect().left, system: Number(svg.getAttribute('data-system')) });
      }
      return out;
    });
  const onsets = await readOnsets();
  expect(onsets.length).toBeGreaterThan(4);

  // Record every frame from the count-in until 7 bars into the music.
  await page.evaluate(() => {
    type Sr = { audio: { audibleNow(): number; now(): number }; session: { takeClock: { t0: number; bpm: number; countInBeats: number } | null; plan: { beatsPerBar: number } | null } };
    const w = window as unknown as { __sr: Sr; __beatLine: { samples: unknown[]; clock: unknown; done: boolean } };
    const rec = { samples: [] as unknown[], clock: null as unknown, done: false };
    w.__beatLine = rec;
    const frame = (): void => {
      const sr = w.__sr;
      const c = sr.session.takeClock;
      if (c && !rec.clock) rec.clock = c;
      const el = document.querySelector('line.sf-beat-line');
      const visible = el !== null && el.getAttribute('visibility') === 'visible';
      // On a short desktop window there is one slot, and its page turn comes before the system ends: for the rest of
      // that system the line is drawn on a system that is not on screen (no box). Those frames are marked off-page.
      const off = el !== null && visible && el.getBoundingClientRect().height === 0;
      const shown = el !== null && visible && !off;
      const r = shown ? el.getBoundingClientRect() : null;
      const svgLeft = shown ? (el.closest('svg')?.getBoundingClientRect().left ?? 0) : 0;
      // x relative to the line's own system SVG: a page turn moves a system between slots, never sideways.
      rec.samples.push({
        a: sr.audio.audibleNow(),
        now: sr.audio.now(),
        x: r ? r.left + r.width / 2 - svgLeft : null,
        off,
        system: shown ? Number(el.closest('svg')?.getAttribute('data-system')) : null,
      });
      const bpb = sr.session.plan?.beatsPerBar ?? 4;
      if (c && sr.audio.audibleNow() > c.t0 + (7 * bpb * 60) / c.bpm) rec.done = true;
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  await page.waitForFunction(() => (window as unknown as { __beatLine: { done: boolean } }).__beatLine.done, null, { timeout: 60_000, polling: 200 });

  await page.screenshot({ path: `test-results/design-e2e/beat-line-${info.project.name}.png` });
  for (const o of await readOnsets()) if (!onsets.some((k) => k.beat === o.beat)) onsets.push(o);
  const { samples, clock } = await page.evaluate(() => {
    const w = window as unknown as { __beatLine: { samples: Sample[]; clock: { t0: number; bpm: number; countInBeats: number } } };
    return { samples: w.__beatLine.samples, clock: w.__beatLine.clock };
  });
  expect(clock, 'the session exposes the try clock').toBeTruthy();
  const beatSec = 60 / clock.bpm;
  const lagMs = (samples.at(-1)!.now - samples.at(-1)!.a) * 1000;

  // The audible clock runs behind the context clock by the output latency, never ahead.
  expect(lagMs).toBeGreaterThanOrEqual(0);

  const reduced = info.project.name.includes('reduced-motion');
  const checked: string[] = [];
  const offPage: number[] = [];
  const problems: string[] = [];
  const lastBeat = (samples.at(-1)!.a - clock.t0) / beatSec;
  for (const o of onsets) {
    if (!Number.isInteger(o.beat) || o.beat < 0 || o.beat > lastBeat - 0.5) continue;
    const t = clock.t0 + o.beat * beatSec;
    const i = samples.findIndex((s) => s.a >= t);
    if (i <= 0) continue;
    const a = samples[i - 1]!;
    const b = samples[i]!;
    if (a.off || b.off) {
      offPage.push(o.beat);
      continue;
    }
    if (a.x === null || b.x === null) {
      problems.push(`beat ${o.beat}: line hidden`);
      continue;
    }
    // The line is straight from a note to the next one, and jumps at barlines and system breaks: extend the motion
    // of the first two frames after the click back to the click's time. Under reduced motion it steps on the click.
    const c = samples[i + 1];
    if (!c || c.x === null) continue;
    const x = reduced || c.system !== b.system || c.a <= b.a ? b.x : b.x - ((b.a - t) / (c.a - b.a)) * (c.x - b.x);
    const off = Math.abs(x - o.x);
    checked.push(`beat ${o.beat}: line ${x.toFixed(1)} note ${o.x.toFixed(1)} (${off.toFixed(2)} px); frames ${[a, b, c].map((f) => `${((f.a - t) * 1000).toFixed(1)}ms@${f.x?.toFixed(1)}/${f.system}`).join(' ')}`);
    if (b.system !== o.system || off > 1.5) problems.push(`beat ${o.beat}: line ${x.toFixed(1)} (system ${b.system}), note ${o.x.toFixed(1)} (system ${o.system})`);
  }

  // Through the count-in the line waits at the first note.
  const first = onsets.reduce((m, o) => (o.beat < m.beat ? o : m), onsets[0]!);
  const waitBeat = Math.min(first.beat, 0);
  const waiting = samples.filter((s) => s.x !== null && (s.a - clock.t0) / beatSec < waitBeat - 0.05);
  expect(waiting.length).toBeGreaterThan(10);
  for (const s of waiting) if (Math.abs(s.x! - first.x) > 1.5) problems.push(`count-in: line at ${s.x!.toFixed(1)}, first note at ${first.x.toFixed(1)}`);

  if (info.project.name.includes('reduced-motion')) {
    // Stepping: within a beat the line does not move. The recorder and the app's frame loop are two callbacks of the
    // same frame and may run in either order, so the step may show one frame after the beat's first sample.
    const beatOf = (f: Sample): number => Math.floor((f.a - clock.t0) / beatSec + 1e-6);
    for (let i = 2; i < samples.length; i++) {
      const o = samples[i - 2]!;
      const p = samples[i - 1]!;
      const s = samples[i]!;
      if (p.x === null || s.x === null || p.system !== s.system) continue;
      const sb = beatOf(s);
      if (beatOf(p) === sb && beatOf(o) === sb && Math.abs(s.x - p.x) > 0.5) problems.push(`reduced motion: moved ${(s.x - p.x).toFixed(1)} px inside beat ${sb}`);
    }
  }

  process.stdout.write(`[${info.project.name}] audible lag ${lagMs.toFixed(1)} ms, ${samples.length} frames, off-page beats [${offPage.join(', ')}]\n${checked.join('\n')}\n`);
  expect(checked.length).toBeGreaterThan(3);
  expect(problems).toEqual([]);

  // The switch turns it off: nothing on the staff moves.
  await page.getByRole('button', { name: 'Beat line' }).click();
  await expect(page.getByRole('button', { name: 'Beat line' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('line.sf-beat-line')).toHaveAttribute('visibility', 'hidden');
  expect(errors).toEqual([]);
});
