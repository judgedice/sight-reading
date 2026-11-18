// Node-side helpers for the S1 Playwright run. Playwright's ESM loader cannot import the src modules that import JSON
// without import attributes (configs, schemas), so bundle.ts compiles this entry with esbuild (JSON inlined) and the
// config and the spec load the bundle.
import type { AttemptScore, ClockSeconds, DetectedNote, FinalAlignment, FollowerEvent } from '../../src/core/types.ts';
import { alignFinal, liveOutcomeOf } from '../../src/follow/index.ts';
import { sliceConfigs, sliceFollowConfig, sliceGrade, sliceTake } from '../../src/app/compose/slice-take.ts';
import { writeSliceWav } from './slice-performance.ts';

export { SLICE } from '../../src/app/compose/slice-take.ts';
export { SLICE_EXTRA, SLICE_LATE_IDX, SLICE_OMIT_IDX, SLICE_WRONG_IDX } from './slice-performance.ts';

export function takeFacts(): { bpm: number; noteCount: number } {
  const take = sliceTake(sliceConfigs());
  return { bpm: take.bpm, noteCount: take.expected.length };
}

export function writeWav(dir: string, offsetSec: number): string {
  return writeSliceWav(sliceTake(sliceConfigs()), dir, offsetSec);
}

/** Final alignment and grade recomputed in Node from what the browser's worker saw. */
export function nodeRegrade(i: {
  t0: number;
  rtlSec: number;
  analysisRate: number;
  detected: DetectedNote[];
  events: FollowerEvent[];
  signal: { medianClarity: number | null; clippingFrac: number };
}): { alignment: FinalAlignment; score: AttemptScore } {
  const cfg = sliceConfigs();
  const take = sliceTake(cfg);
  const follow = sliceFollowConfig(take, cfg, { t0: i.t0 as ClockSeconds, rtlSec: i.rtlSec, analysisRate: i.analysisRate });
  const alignment = alignFinal(follow, i.detected, liveOutcomeOf(i.events));
  const score = sliceGrade(take, cfg, { alignment, detected: i.detected, signal: i.signal, calibrationMeasured: false });
  return { alignment, score };
}
