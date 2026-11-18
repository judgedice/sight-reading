// Bare-runtime scenarios (01 §13.3, 05 §5 item 2). Pure code only: this file and everything it imports must run in
// a Node `vm` context that has nothing but the ES2022 globals. Wave 0 covers the pure core (time, rng, events,
// onset definition). P12 adds grade() over fixtures/grade and P10b adds finalAlign over fixtures/follow, by
// appending scenarios to SCENARIOS below; the harness and the byte-identity check stay the same.
import { createEmitter } from '../../src/core/events.ts';
import { pitchChangeOnset, repeatedOnset, type OnsetPitchFrame } from '../../src/core/onset-definition.ts';
import { createRng } from '../../src/core/rng.ts';
import { beatsToScoreSeconds, beatsToTicks, makeMeter, ticksToBeats, ticksToScoreSeconds } from '../../src/core/time.ts';
import type { Meter } from '../../src/core/types.ts';
import { GRADE_SCENARIOS } from './grade-scenarios.ts';

export interface ScenarioResult {
  id: string;
  out: unknown;
}

const METERS: [number, Meter['beatType']][] = [[2, 4], [3, 4], [4, 4], [6, 8], [2, 2], [3, 8]];

function timeScenario(seed: number): unknown {
  const rng = createRng(seed);
  const [beats, beatType] = METERS[rng.int(0, METERS.length)] as [number, Meter['beatType']];
  const meter = makeMeter(beats, beatType);
  const pickup = rng.int(0, 4) * 120;
  const bpm = 40 + rng.int(0, 160);
  const rows: number[][] = [];
  for (let i = 0; i < 16; i++) {
    const t = rng.int(0, 480 * 48);
    const b = ticksToBeats(t, meter, pickup);
    rows.push([t, b, beatsToTicks(b, meter, pickup), beatsToScoreSeconds(b, bpm), ticksToScoreSeconds(t, meter, pickup, bpm)]);
  }
  return { meter, pickup, bpm, rows };
}

function onsetScenario(seed: number): unknown {
  const rng = createRng(seed);
  const prev = 60 + rng.int(0, 24);
  const next = prev + (rng.int(0, 2) === 0 ? -1 : 1) * (1 + rng.int(0, 7));
  const glideStart = 0.1 + rng.next() * 0.05;
  const glideSec = 0.005 + rng.next() * 0.04;
  const frames: OnsetPitchFrame[] = [];
  for (let i = 0; i < 200; i++) {
    const t = i * 0.002;
    const x = Math.min(1, Math.max(0, (t - glideStart) / glideSec));
    frames.push({ t, midi: prev + (next - prev) * x, clarity: rng.next() < 0.05 ? 0.2 : 0.95 });
  }
  const values: number[] = [];
  const dipT = 0.2 + rng.next() * 0.05;
  for (let i = 0; i < 250; i++) {
    const t = i * 0.002;
    values.push(-20 - Math.max(0, 12 - Math.abs(t - dipT) * 400) + 1.5 * Math.sin(2 * Math.PI * 5 * t));
  }
  const rep = repeatedOnset({ startT: 0, hopSec: 0.002, values }, { searchStartT: dipT - 0.04, searchEndT: dipT + 0.04, noteStartT: 0.02 });
  return { pitchOnset: pitchChangeOnset(frames, prev, next, 0.5), repeat: rep };
}

function emitterScenario(seed: number): unknown {
  const rng = createRng(seed);
  const e = createEmitter<number>();
  const seen: string[] = [];
  const offs = [0, 1, 2].map((k) => e.on((v) => seen.push(`${k}:${v}`)));
  for (let i = 0; i < 8; i++) {
    e.emit(rng.int(0, 1000));
    if (i === 3) offs[1]?.();
  }
  return seen;
}

export const SCENARIOS: { id: string; run: () => unknown }[] = [];
for (let s = 1; s <= 8; s++) SCENARIOS.push({ id: `time-${s}`, run: () => timeScenario(s) });
for (let s = 1; s <= 8; s++) SCENARIOS.push({ id: `onset-${s}`, run: () => onsetScenario(1000 + s) });
for (let s = 1; s <= 4; s++) SCENARIOS.push({ id: `emitter-${s}`, run: () => emitterScenario(2000 + s) });
// P12: grade() over fixtures/grade (02 §4.9 case 15).
SCENARIOS.push(...GRADE_SCENARIOS);

/** Runs every scenario and returns the canonical JSON the byte-identity check compares. */
export function runAll(): string {
  const results: ScenarioResult[] = SCENARIOS.map((s) => ({ id: s.id, out: s.run() }));
  return JSON.stringify(results);
}
