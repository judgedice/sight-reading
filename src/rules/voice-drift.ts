/**
 * Voice drift reference (02 §4.5, R7; 01 §5.4). The singer is graded on relative pitch: the offset follows the
 * median deviation of the last N correctly pitched notes, limited to ±maxOffsetCents from 0 and to a change of at
 * most maxStepCents per note. The follower calls it per note live and the grader replays it in the final pass, so
 * both use the same offset at every note. All numbers come from `cfg.grading.voice`.
 */
import type { VoiceDriftReferenceInstance } from '../core/api.ts';
import type { Configs } from '../core/types.ts';

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

export class VoiceDriftReference implements VoiceDriftReferenceInstance {
  private readonly windowNotes: number;
  private readonly maxOffset: number;
  private readonly maxStep: number;
  private readonly devs: number[] = [];
  private offset = 0;

  constructor(cfg: Configs) {
    const v = cfg.grading.voice;
    if (!(v.driftWindowNotes >= 1) || !(v.maxOffsetCents >= 0) || !(v.maxStepCents >= 0)) {
      throw new RangeError('grading.voice drift parameters must be non-negative with a window of at least 1 note');
    }
    this.windowNotes = Math.floor(v.driftWindowNotes);
    this.maxOffset = v.maxOffsetCents;
    this.maxStep = v.maxStepCents;
  }

  /** Current reference offset, cents (+ = the singer is sharp of the written pitch). Applied to the next note. */
  offsetCents(): number {
    return this.offset;
  }

  /**
   * Feed one finished note. `devCents` is the note's steady median minus its octave-folded written target,
   * before any reference offset (`PitchClassification.rawDevCents`). Only correctly pitched notes move the
   * reference; others are ignored. Non-finite deviations are ignored.
   */
  observe(devCents: number, correct: boolean): void {
    if (!correct || !Number.isFinite(devCents)) return;
    this.devs.push(devCents);
    if (this.devs.length > this.windowNotes) this.devs.shift();
    const target = median(this.devs);
    const step = clamp(target - this.offset, -this.maxStep, this.maxStep);
    this.offset = clamp(this.offset + step, -this.maxOffset, this.maxOffset);
  }
}
