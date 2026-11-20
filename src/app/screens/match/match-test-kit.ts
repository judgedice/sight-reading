// Test helpers (not shipped): a fake match engine on a fake clock, and a driver that feeds it frames.
import { act } from 'react';
import { vi } from 'vitest';
import type { MatchFrame } from '../../../session/index.ts';
import type { MatchEngine } from './use-match.ts';

/** The engine with no audio: `playTarget` resolves at once, `listen` keeps the frame callback. */
export class FakeEngine implements MatchEngine {
  clock = 0;
  played: number[] = [];
  stops = 0;
  listens = 0;
  private sink: ((f: MatchFrame) => void) | null = null;

  nowMs(): number {
    return this.clock;
  }
  playTarget(concertMidi: number): Promise<void> {
    this.sink = null;
    this.played.push(concertMidi);
    return Promise.resolve();
  }
  listen(onFrame: (f: MatchFrame) => void): Promise<void> {
    this.listens++;
    this.sink = onFrame;
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
  emit(f: Omit<MatchFrame, 't' | 'levelDb'> & { levelDb?: number }): void {
    this.sink?.({ t: this.clock, levelDb: f.levelDb ?? -30, ...f });
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
export async function run(engine: FakeEngine, ms: number, frame?: (e: FakeEngine) => Omit<MatchFrame, 't' | 'levelDb'> | null): Promise<void> {
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
  (e: FakeEngine): Omit<MatchFrame, 't' | 'levelDb'> => ({ midi: e.target + shift, cents, steady: true });
