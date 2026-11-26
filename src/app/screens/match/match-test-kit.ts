// Test helpers (not shipped): a fake match engine on a fake clock, and a driver that feeds it frames.
import { act } from 'react';
import { vi } from 'vitest';
import type { PitchSteadiness } from '../../../core/types.ts';
import { STEADINESS_PRESETS, SteadinessFilter, type MatchFrame } from '../../../session/index.ts';
import type { MatchEngine } from './use-match.ts';

/** A frame as a test writes it: the reading is optional (the engine's own filter makes one from `midi` and `cents`). */
export type TestFrame = Omit<MatchFrame, 't' | 'levelDb' | 'reading'> & { levelDb?: number; reading?: MatchFrame['reading'] };

/**
 * The engine with no audio: `playTarget` resolves at once, `listen` keeps the frame callback. A frame without a
 * reading gets one from a real display filter (`steadiness`, default Steady), fed at the frame's own time.
 */
export class FakeEngine implements MatchEngine {
  clock = 0;
  played: number[] = [];
  stops = 0;
  listens = 0;
  steadiness: PitchSteadiness = 'steady';
  private sink: ((f: MatchFrame) => void) | null = null;
  private filter = new SteadinessFilter(STEADINESS_PRESETS.steady);

  nowMs(): number {
    return this.clock;
  }
  playTarget(concertMidi: number): Promise<void> {
    this.sink = null;
    this.filter = new SteadinessFilter(STEADINESS_PRESETS[this.steadiness]);
    this.played.push(concertMidi);
    return Promise.resolve();
  }
  listen(onFrame: (f: MatchFrame) => void): Promise<void> {
    this.listens++;
    this.sink = onFrame;
    this.filter = new SteadinessFilter(STEADINESS_PRESETS[this.steadiness]);
    return Promise.resolve();
  }
  stop(): void {
    this.stops++;
    this.sink = null;
  }
  get listening(): boolean {
    return this.sink !== null;
  }
  get target(): number {
    return this.played[this.played.length - 1]!;
  }
  emit(f: TestFrame): void {
    const levelDb = f.levelDb ?? -30;
    let reading = f.reading;
    if (!reading) {
      this.filter.push(this.clock, f.midi === null ? null : f.midi + (f.cents ?? 0) / 100, levelDb);
      reading = this.filter.reading;
    }
    this.sink?.({ ...f, t: this.clock, levelDb, reading });
  }
}

/** Lets pending promises and effects run. */
export async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * Runs `ms` of fake time in 20 ms steps (the engine's frame rate), sending `frame(engine)` each step when given.
 * Needs `vi.useFakeTimers()`.
 */
export async function run(engine: FakeEngine, ms: number, frame?: (e: FakeEngine) => TestFrame | null): Promise<void> {
  for (let left = ms; left > 0; left -= 20) {
    await act(async () => {
      engine.clock += 20;
      const f = frame?.(engine);
      if (f) engine.emit(f);
      vi.advanceTimersByTime(20);
      await Promise.resolve();
    });
  }
}

/** A steady frame at the engine's current target, offset by `cents`. */
export const at =
  (cents: number, shift = 0) =>
  (e: FakeEngine): TestFrame => ({ midi: e.target + shift, cents, steady: true });
