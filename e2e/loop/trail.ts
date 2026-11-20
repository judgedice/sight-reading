// The trailing-voice synthetic (round 2, 01-ux section 15; 06-plan R2-21), moved here from the walk that found it.
// A baritone that scoops up into each note and lets the pitch fall away at the end of it, the way a real singer's
// voice trails off. The owner's marks at the start of a try came partly from this: the app heard the tail as a new
// note and drew an extra. Node side only; the specs write the result as the fake microphone's WAV.
//
// The model, per written note (times in score seconds, from `perform()`):
// - Scoop. A short lead-in 1 semitone under the note, 70 ms, glided into the note. Left out when the note follows the
//   previous one too closely to fit it.
// - Tail. After the note ends the pitch falls 1.6 semitones over about 220 ms while the level drops: three joined
//   steps (0.5, 1.1 and 1.6 semitones under), each a glide from the one before and quieter: 6, 12 and 20 dB under the note,
//   the way a voice dies away at the end of a phrase (03-detection: ends that fall 40 to 200 cents while the level dies). Cut short to the gap
//   before the next note; left out when that gap is under 100 ms (the tail then sits inside the next note's attack).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Page } from '@playwright/test';
import type { ExpectedNote } from '../../src/core/types.ts';
import { perform } from '../../fixtures/follow/gen/perform.ts';
import { renderPerformance, type SynthNoteSpec } from '../../src/testkit/synth/index.ts';
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

/** The shape of the trail: semitones under the note, and the time each part takes. */
export const TRAIL = {
  scoopSemis: 1,
  scoopSec: 0.07,
  /** The gap a scoop needs before the note, seconds. */
  scoopGapSec: 0.12,
  /** Cumulative semitones under the note after each step of the tail, and the level of each step. */
  tailSemis: [0.5, 1.1, 1.6],
  tailAmp: [0.5, 0.25, 0.1],
  tailStepSec: 0.073,
  /** The gap a tail needs after the note, seconds. */
  tailGapSec: 0.1,
} as const;

function note(midi: number, onsetSec: number, durSec: number, ref: number, extra: Partial<SynthNoteSpec> = {}): SynthNoteSpec {
  const whole = Math.round(midi);
  return { midi: whole, cents: Math.round((midi - whole) * 100 * 1000) / 1000, onsetSec, durSec: Math.max(0.02, durSec), ref, ...extra };
}

/** Every note of the plan as written (no mistakes), with a scoop in front and a tail behind. */
export function trailingNotes(plan: TrailPlan, offsetSec: number): SynthNoteSpec[] {
  const played = perform(plan.expected, plan.beatsPerBar, plan.bpm, { mods: {} });
  const out: SynthNoteSpec[] = [];
  const plain = process.env['TRAIL_PLAIN'] === '1';
  played.forEach((p, k) => {
    if (plain) { out.push(note(p.midi, offsetSec + p.onset, p.dur, k, { slur: p.legato })); return; }
    const onset = offsetSec + p.onset;
    const prevEnd = k > 0 ? offsetSec + played[k - 1]!.onset + played[k - 1]!.dur : Number.NEGATIVE_INFINITY;
    const nextOnset = k + 1 < played.length ? offsetSec + played[k + 1]!.onset : Number.POSITIVE_INFINITY;
    const end = onset + p.dur;
    if (onset - prevEnd >= TRAIL.scoopGapSec) {
      out.push(note(p.midi - TRAIL.scoopSemis, onset - TRAIL.scoopSec, TRAIL.scoopSec, k));
      out.push(note(p.midi, onset, p.dur, k, { slur: true }));
    } else {
      out.push(note(p.midi, onset, p.dur, k, { slur: p.legato }));
    }
    const room = nextOnset - end;
    if (room >= TRAIL.tailGapSec) {
      const step = Math.min(TRAIL.tailStepSec, (room - 0.03) / TRAIL.tailSemis.length);
      TRAIL.tailSemis.forEach((semis, i) => out.push(note(p.midi - semis, end + i * step, step, k, { slur: true, amp: TRAIL.tailAmp[i]! })));
    }
  });
  return out;
}

/** Writes the trailing take as a mono WAV: silence, then bar 1 beat 1 at `offsetSec`, then a second of silence. */
export function writeTrailingWav(path: string, plan: TrailPlan, offsetSec: number): void {
  const samples = renderPerformance({
    timbre: 'voice',
    notes: trailingNotes(plan, offsetSec),
    sampleRate: TRAIL_WAV_RATE,
    durationSec: offsetSec + plan.endSec + 1.5,
    seed: 17,
  }).samples;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodeWav({ sampleRate: TRAIL_WAV_RATE, channels: [samples] }));
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
