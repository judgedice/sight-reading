// Node-side helpers for the practice-loop Playwright specs: render the fake-capture WAV for the excerpt the page
// served, with the P3 synth. Compiled by bundle.ts with esbuild (JSON imports inlined), like e2e/slice.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ExpectedNote } from '../../src/core/types.ts';
import { perform, type PerformSpec } from '../../fixtures/follow/gen/perform.ts';
import { renderPerformance, type SynthNoteSpec } from '../../src/testkit/synth/index.ts';
import { encodeWav } from '../../src/testkit/wav.ts';

// Headless Chromium runs its AudioContext at 44.1 kHz; a file at that rate avoids a resampler in the fake device.
export const LOOP_WAV_RATE = 44100;

/** What the page reports about the excerpt on screen (window.__sr.session.plan). */
export interface PagePlan {
  instrumentId: string;
  bpm: number;
  beatsPerBar: number;
  endSec: number;
  expected: ExpectedNote[];
}

/** The note to play wrong: the first note from the third on that lasts at least 300 ms, so the pitch is confirmed. */
export function wrongNoteIdx(expected: readonly ExpectedNote[]): number {
  const pick = expected.find((e) => e.idx >= 2 && e.durSec >= 0.3 && e.onsetBeat >= 0);
  return (pick ?? expected[Math.min(2, expected.length - 1)]!).idx;
}

/** One note 2 semitones sharp, every other note as written. */
export function loopPerformSpec(plan: PagePlan): PerformSpec {
  return { mods: { [wrongNoteIdx(plan.expected)]: { semis: 2 } } };
}

export function loopNotes(plan: PagePlan, offsetSec: number): SynthNoteSpec[] {
  return perform(plan.expected, plan.beatsPerBar, plan.bpm, loopPerformSpec(plan)).map((p, k) => {
    const midi = Math.round(p.midi);
    return { midi, cents: Math.round((p.midi - midi) * 100 * 1000) / 1000, onsetSec: offsetSec + p.onset, durSec: Math.max(0.02, p.dur), slur: p.legato, ref: k };
  });
}

/** Writes the take as a mono WAV: silence, then bar 1 beat 1 at `offsetSec`, then a second of silence. */
export function writeTakeWav(path: string, plan: PagePlan, offsetSec: number): void {
  const notes = loopNotes(plan, offsetSec);
  const samples = renderPerformance({ timbre: 'flute', notes, sampleRate: LOOP_WAV_RATE, durationSec: offsetSec + plan.endSec + 1.5, seed: 11 }).samples;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodeWav({ sampleRate: LOOP_WAV_RATE, channels: [samples] }));
}

/** A short silent WAV: what the fake microphone plays until a take's WAV is written. */
export function writeSilentWav(path: string, sec = 1): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodeWav({ sampleRate: LOOP_WAV_RATE, channels: [new Float32Array(Math.round(sec * LOOP_WAV_RATE))] }));
}

/** The note to play late (e2e/tour): the first note after the wrong one that lasts at least 600 ms (else 300 ms). */
export function lateNoteIdx(expected: readonly ExpectedNote[]): number {
  const wrong = wrongNoteIdx(expected);
  // A long note, so a late onset stays nearer its own onset than the next note's (an unambiguous 'late' match).
  const pick = expected.find((e) => e.idx >= wrong + 2 && e.durSec >= 0.6 && e.onsetBeat >= 0) ?? expected.find((e) => e.idx >= wrong + 2 && e.durSec >= 0.3 && e.onsetBeat >= 0);
  return (pick ?? expected[expected.length - 1]!).idx;
}

/** The tour take: one note 2 semitones sharp and one note `lateMs` late, every other note as written. */
export function writeTourWav(path: string, plan: PagePlan, offsetSec: number, lateMs: number): void {
  const spec: PerformSpec = { mods: { [wrongNoteIdx(plan.expected)]: { semis: 2 }, [lateNoteIdx(plan.expected)]: { shiftMs: lateMs } } };
  const notes: SynthNoteSpec[] = perform(plan.expected, plan.beatsPerBar, plan.bpm, spec).map((p, k) => {
    const midi = Math.round(p.midi);
    return { midi, cents: Math.round((p.midi - midi) * 100 * 1000) / 1000, onsetSec: offsetSec + p.onset, durSec: Math.max(0.02, p.dur), slur: p.legato, ref: k };
  });
  const samples = renderPerformance({ timbre: 'flute', notes, sampleRate: LOOP_WAV_RATE, durationSec: offsetSec + plan.endSec + 1.5, seed: 11 }).samples;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodeWav({ sampleRate: LOOP_WAV_RATE, channels: [samples] }));
}
