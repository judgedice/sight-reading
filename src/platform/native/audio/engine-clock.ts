/**
 * The engine clock in JavaScript (docs/native/AUDIO-DESIGN.md section 2). Engine time is the output frame counter
 * divided by the engine rate. The engine reports anchors `(engineSec, hostMs, rate)` on its own monotonic host clock;
 * `performance.now()` is mapped onto that clock once per `audio_clock_sync` round trip (midpoint of the call, the
 * sample with the shortest round trip of a few kept), then `now()` follows the anchors. Its error is about 1 ms,
 * which is harmless: nothing graded is derived from JavaScript `now()` (clicks are placed by the engine in frames,
 * capture blocks carry engine frame stamps).
 */
import type { ClockAnchor } from './ipc.ts';

/** `performance.now()` in ms, injected so tests drive the clock by hand. */
export type PerfNow = () => number;

export class EngineClock {
  private readonly perfNow: PerfNow;
  private anchor: ClockAnchor | null = null;
  /** `performance.now()` minus the engine host clock, ms. */
  private offsetMs: number | null = null;
  private last = 0;

  constructor(perfNow: PerfNow) {
    this.perfNow = perfNow;
  }

  /** Forgets everything: engine time restarts at 0 after `audio_open`. */
  reset(): void {
    this.anchor = null;
    this.offsetMs = null;
    this.last = 0;
  }

  get ready(): boolean {
    return this.anchor !== null && this.offsetMs !== null;
  }

  setHostOffset(offsetMs: number): void {
    this.offsetMs = offsetMs;
  }

  setAnchor(a: ClockAnchor): void {
    this.anchor = a;
  }

  /** The render head, engine seconds: never moves backwards while the stream runs; 0 before the first anchor. */
  now(): number {
    const a = this.anchor;
    if (!a || this.offsetMs === null) return this.last;
    const hostNow = this.perfNow() - this.offsetMs;
    const t = a.engineSec + ((hostNow - a.hostMs) / 1000) * a.rate;
    if (t > this.last) this.last = t;
    return this.last;
  }

  /** The anchor's rate (engine seconds per host second), 1 before the first anchor. */
  get rate(): number {
    return this.anchor?.rate ?? 1;
  }
}

/** One `audio_clock_sync` round trip: the engine's host ms is read somewhere between the two `performance.now()` reads. */
export interface SyncSample {
  rttMs: number;
  /** `performance.now()` minus the engine host clock, ms. */
  offsetMs: number;
  engineSec: number;
  hostMs: number;
}

/**
 * Maps `performance.now()` onto the engine's host clock: `rounds` round trips, the shortest one wins. Calls are
 * sequential, so the winning sample's midpoint assumption is as good as the transport's symmetry.
 */
export async function syncHostClock(
  clockSync: () => Promise<{ engineSec: number; hostMs: number }>,
  perfNow: PerfNow,
  rounds = 5,
): Promise<SyncSample> {
  let best: SyncSample | null = null;
  for (let i = 0; i < rounds; i++) {
    const before = perfNow();
    const r = await clockSync();
    const after = perfNow();
    const s: SyncSample = { rttMs: after - before, offsetMs: (before + after) / 2 - r.hostMs, engineSec: r.engineSec, hostMs: r.hostMs };
    if (!best || s.rttMs < best.rttMs) best = s;
  }
  return best as SyncSample;
}
