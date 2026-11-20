// The trailing-voice synthetic (round 2, 01-ux section 15; 06-plan R2-21), moved here from the walk that found it.
// A baritone that scoops up into each note and lets the pitch fall away at the end of it, the way a real singer's
// voice trails off. The owner's marks at the start of a try came partly from this: the app heard the tail as a new
// note and drew an extra. Node side only; the specs write the result as the fake microphone's WAV.
//
// The voice is its own small additive synth, because the testkit's performance renderer has no pitch contour: the
// harmonic balance is the testkit's sung "ah" (`TIMBRES.voice`), the pitch and the level follow a contour per note.
//   - Scoop. The note starts 80 cents under its pitch and rises into it over 80 ms. Left out on a note that is slurred
//     from the one before.
//   - Steady part. Vibrato of 20 cents at 5.5 Hz after 200 ms.
//   - Tail. After the written end the pitch falls 160 cents over 220 ms while the level falls 24 dB (03-detection:
//     "ends that fall or wobble 40 to 200 cents while the level dies"). Cut short to the gap before the next note; with
//     under 100 ms of gap the voice just stops.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, type Page } from '@playwright/test';
import type { ExpectedNote } from '../../src/core/types.ts';
import { perform } from '../../fixtures/follow/gen/perform.ts';
import { createRng } from '../../src/core/rng.ts';
import { harmonicAmps, midiToHz, renderPerformance, TIMBRES } from '../../src/testkit/synth/index.ts';
import { encodeWav } from '../../src/testkit/wav.ts';

/** Headless Chromium runs its AudioContext at 44.1 kHz; a file at that rate avoids a resampler in the fake device. */
export const TRAIL_WAV_RATE = 44100;

/** What the page reports about the excerpt on screen (`window.__sr.session.plan`). */
export interface TrailPlan {
  bpm: number;
  beatsPerBar: number;
  endSec: number;
  expected: ExpectedNote[];
}

/** The shape of the trail. Cents, seconds and dB. */
export const TRAIL = {
  scoopCents: 80,
  scoopSec: 0.08,
  /** The voice starts this long before the written onset (0: the scoop starts at the onset, as a singer's does). */
  leadSec: 0,
  attackSec: 0.04,
  vibratoHz: 5.5,
  vibratoCents: 20,
  vibratoAfterSec: 0.2,
  tailCents: 160,
  tailSec: 0.22,
  tailDropDb: 24,
  /** A tail needs this much room before the next voiced start, seconds. */
  tailRoomSec: 0.1,
  /** A note with no tail stops with this release, seconds. */
  releaseSec: 0.04,
  /** Level of the steady voice, dBFS, and the room's noise floor. */
  levelDb: -28,
  floorDb: -62,
} as const;

interface Voiced {
  /** Voiced start and end, seconds (the tail included). */
  start: number;
  /** Written end: where the steady part stops and the tail begins. */
  hold: number;
  end: number;
  midi: number;
  scoop: boolean;
  tail: boolean;
}

/** The voiced stretches of the plan's notes, in order, with room checks against their neighbours. */
export function trailingVoice(plan: TrailPlan, offsetSec: number): Voiced[] {
  const played = perform(plan.expected, plan.beatsPerBar, plan.bpm, { mods: {} });
  const out: Voiced[] = [];
  played.forEach((p, k) => {
    const onset = offsetSec + p.onset;
    const hold = onset + p.dur;
    const nextStart = k + 1 < played.length ? offsetSec + played[k + 1]!.onset - TRAIL.leadSec : Number.POSITIVE_INFINITY;
    const room = nextStart - hold;
    const tail = !played[k + 1]?.legato && room >= TRAIL.tailRoomSec;
    const tailSec = tail ? Math.min(TRAIL.tailSec, room - 0.02) : TRAIL.releaseSec;
    out.push({ start: onset - TRAIL.leadSec, hold, end: hold + tailSec, midi: p.midi, scoop: !p.legato, tail });
  });
  return out;
}

/** Writes the trailing take as a mono WAV: silence, then bar 1 beat 1 at `offsetSec`, then a second of silence. */
export function writeTrailingWav(path: string, plan: TrailPlan, offsetSec: number): void {
  const sr = TRAIL_WAV_RATE;
  const n = Math.round((offsetSec + plan.endSec + 1.5) * sr);
  const out = new Float64Array(n);
  const rng = createRng(17);
  const gain = 10 ** (TRAIL.levelDb / 20) / Math.SQRT2;
  const voiced = trailingVoice(plan, offsetSec);
  for (const v of voiced) {
    const f0 = midiToHz(v.midi);
    const amps = harmonicAmps(TIMBRES.voice, f0);
    const from = Math.max(0, Math.floor(v.start * sr));
    const to = Math.min(n, Math.ceil(v.end * sr));
    const tailLen = v.end - v.hold;
    const phase = rng.next() * 2 * Math.PI;
    let acc = 0;
    for (let i = from; i < to; i++) {
      const t = i / sr;
      const age = t - v.start;
      let cents = 0;
      let level = 1;
      if (v.scoop && age < TRAIL.scoopSec) cents -= TRAIL.scoopCents * (1 - 0.5 * (1 - Math.cos((Math.PI * age) / TRAIL.scoopSec)));
      if (age > TRAIL.vibratoAfterSec && t < v.hold) cents += TRAIL.vibratoCents * Math.sin(2 * Math.PI * TRAIL.vibratoHz * (age - TRAIL.vibratoAfterSec));
      if (age < TRAIL.attackSec) level *= age / TRAIL.attackSec;
      if (t >= v.hold) {
        const u = Math.min(1, (t - v.hold) / tailLen);
        if (v.tail) cents -= TRAIL.tailCents * (0.5 * (1 - Math.cos(Math.PI * u)));
        level *= 10 ** ((-(v.tail ? TRAIL.tailDropDb : 40) * u) / 20);
      }
      acc += (2 * Math.PI * f0 * 2 ** (cents / 1200)) / sr;
      let s = 0;
      for (let h = 1; h <= amps.length; h++) s += (amps[h - 1] as number) * Math.sin(h * (acc + phase));
      out[i] = (out[i] as number) + s * gain * level;
    }
  }
  const floor = 10 ** (TRAIL.floorDb / 20);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = (out[i] as number) + floor * (rng.next() * 2 - 1);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodeWav({ sampleRate: sr, channels: [samples] }));
}

/** One steady sung note from the start of the file (Match a note: the microphone opens after the target has sounded). */
export function writeToneWav(path: string, midi: number, durSec = 20): void {
  const samples = renderPerformance({
    timbre: 'voice',
    notes: [{ midi, onsetSec: 0.05, durSec: durSec - 0.5 }],
    sampleRate: TRAIL_WAV_RATE,
    durationSec: durSec,
    vibrato: null,
    seed: 3,
  }).samples;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodeWav({ sampleRate: TRAIL_WAV_RATE, channels: [samples] }));
}

/** A purple mark seen on a screen while a try was running (see `installLiveWatch`). */
export interface LiveMark {
  /** The element's classes. */
  cls: string;
  /** `data-kind` of a ghost (`extra`, `wrong-pitch`, ...). */
  kind: string;
  /** The Practice screen's `data-state` when it appeared: `starting-pitch`, `count-in`, `performing`, ... */
  state: string;
  /** True when it sits inside the Practice play screen (not the results). */
  inPlay: boolean;
}

/**
 * Records every ghost note or extra ("+") that is ever added to the page, and every element whose class says "unsure",
 * as it appears (a mutation observer, so a mark that is drawn and removed between two polls is still caught). Call
 * before `page.goto`. Read with `liveMarks`.
 */
export async function installLiveWatch(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const marks: LiveMark[] = [];
    (window as unknown as { __liveMarks: LiveMark[] }).__liveMarks = marks;
    const seen = new WeakSet<Element>();
    const note = (el: Element): void => {
      if (seen.has(el)) return;
      const cls = typeof el.getAttribute('class') === 'string' ? (el.getAttribute('class') as string) : '';
      if (!/\bsr-ghost\b|unsure/.test(cls)) return;
      seen.add(el);
      const play = el.closest('[data-testid="screen-practice.play"]') ?? document.querySelector('[data-testid="screen-practice.play"]');
      marks.push({ cls, kind: el.getAttribute('data-kind') ?? '', state: play?.getAttribute('data-state') ?? '', inPlay: el.closest('[data-testid="screen-practice.play"]') !== null });
    };
    const scan = (n: Node): void => {
      if (!(n instanceof Element)) return;
      note(n);
      n.querySelectorAll('.sr-ghost, [class*="unsure"]').forEach(note);
    };
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'childList') m.addedNodes.forEach(scan);
        else if (m.target instanceof Element) note(m.target);
      }
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  });
}

/** The marks `installLiveWatch` has seen so far, optionally only those inside the Practice play screen. */
export async function liveMarks(page: Page, onlyInPlay = true): Promise<LiveMark[]> {
  const all = await page.evaluate(() => (window as unknown as { __liveMarks?: LiveMark[] }).__liveMarks ?? []);
  return onlyInPlay ? all.filter((m) => m.inPlay) : all;
}

/**
 * The plan of the piece on the read-through, re-rolling the piece (back to Practice, Start, Show the music) while it
 * begins on a pickup. A sung pickup lands on the last count-in click, where the own-playback rules of the follower
 * (03-detection section 1) are in play; the trailing checks are about tails inside the music, so they use a piece that
 * starts on beat 1. At difficulty 1 most pieces do.
 */
export async function planWithoutPickup<P extends TrailPlan>(page: Page, read: (page: Page) => Promise<P>, attempts = 8): Promise<P> {
  for (let i = 0; i < attempts; i++) {
    const plan = await read(page);
    if (plan.expected.every((e) => e.onsetBeat >= 0)) return plan;
    await page.evaluate(() => { window.location.hash = '#/'; });
    await expect(page.getByTestId('screen-home')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(page.getByTestId('scan-cover')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Show the music' }).click();
    await expect(page.getByTestId('screen-practice.scan').locator('[data-expected-idx]').first()).toBeVisible({ timeout: 30_000 });
  }
  throw new Error(`no piece without a pickup in ${attempts} tries`);
}
