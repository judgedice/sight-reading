// The S1 performance (01 §15 S1): the slice excerpt played by the P3 flute synth with the four perturbations, and the
// fake-capture WAV rendered from it. Used by the Playwright spec (through its config) and by the Node worker test, so
// both judge the same audio.
//
// Perturbations (expected indices are 0-based; the spec counts notes from 1):
// - note 3 (idx 2) late. 01 says 150 ms, which is exactly this excerpt's tRed at level 3 and 80 bpm (150 ms), so the
//   verdict would sit on the boundary. The slice uses the e2e pipeline rule instead: halfway between tRed and the
//   match window (+262 ms), clearly late and still matched.
// - note 6 (idx 5) a semitone sharp (B4 played as C5).
// - note 9 (idx 8) omitted.
// - an extra (D4) in a rest. The excerpt has no rest in bar 4; the extra goes in bar 5's opening rest (beat 16.25).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExpectedNote, ResolvedTolerance } from '../../src/core/types.ts';
import { perform, type PerformSpec } from '../../fixtures/follow/gen/perform.ts';
import { renderPerformance, type SynthNoteSpec } from '../../src/testkit/synth/index.ts';
import { encodeWav } from '../../src/testkit/wav.ts';
import type { SliceTake } from '../../src/app/compose/slice-take.ts';

export const SLICE_LATE_IDX = 2;
export const SLICE_WRONG_IDX = 5;
export const SLICE_OMIT_IDX = 8;
export const SLICE_EXTRA = { atBeat: 16.25, durBeats: 0.35, midi: 62 } as const;
// Headless Chromium runs its AudioContext at 44.1 kHz; a file at that rate avoids a resampler in the fake device.
export const SLICE_WAV_RATE = 44100;

export function lateShiftMs(tol: readonly ResolvedTolerance[], idx = SLICE_LATE_IDX): number {
  const t = tol[idx] as ResolvedTolerance;
  return Math.round(1000 * (t.tRedSec + (t.matchWindowSec - t.tRedSec) / 2));
}

export function slicePerformSpec(take: SliceTake): PerformSpec {
  const shift = lateShiftMs(take.tolerances);
  const late = take.expected[SLICE_LATE_IDX] as ExpectedNote;
  return {
    mods: {
      [SLICE_LATE_IDX]: { shiftMs: shift, durMs: Math.max(150, late.durSec * 0.92 * 1000 - shift) },
      [SLICE_WRONG_IDX]: { semis: 1 },
      [SLICE_OMIT_IDX]: { omit: true },
    },
    extras: [{ atBeat: SLICE_EXTRA.atBeat, durBeats: SLICE_EXTRA.durBeats, midi: SLICE_EXTRA.midi, duringRest: true }],
  };
}

/** Synth notes on the score timeline (score second 0 = bar 1 beat 1), shifted by `offsetSec`. */
export function sliceNotes(take: SliceTake, offsetSec: number, spec: PerformSpec = slicePerformSpec(take)): SynthNoteSpec[] {
  return perform(take.expected, take.beatsPerBar, take.bpm, spec).map((p, k) => {
    const midi = Math.round(p.midi);
    return { midi, cents: Math.round((p.midi - midi) * 100 * 1000) / 1000, onsetSec: offsetSec + p.onset, durSec: Math.max(0.02, p.dur), slur: p.legato, ref: k };
  });
}

/** Mono samples: silence, then the take starting at `offsetSec` (bar 1 beat 1), then `tailSec` of silence. */
export function renderSlice(take: SliceTake, o: { offsetSec: number; sampleRate?: number; tailSec?: number; spec?: PerformSpec }): Float32Array {
  const sr = o.sampleRate ?? SLICE_WAV_RATE;
  const notes = sliceNotes(take, o.offsetSec, o.spec);
  return renderPerformance({ timbre: 'flute', notes, sampleRate: sr, durationSec: o.offsetSec + take.endSec + (o.tailSec ?? 1), seed: 7 }).samples;
}

export function writeSliceWav(take: SliceTake, dir: string, offsetSec: number): string {
  const samples = renderSlice(take, { offsetSec });
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `slice-flute-${Math.round(offsetSec * 1000)}ms.wav`);
  writeFileSync(path, encodeWav({ sampleRate: SLICE_WAV_RATE, channels: [samples] }));
  return path;
}
