/** Scenario plumbing shared by the follow, grade and render generators. */
import { finalDetected, runFollowStream, type StreamFollower } from '../../../src/testkit/predicates/index.ts';
import type { Clef, ClockSeconds, Configs, DetectedNote, ExpectedNote, FinalAlignment, FollowerEvent, FollowStreamItem, Instrument, KeySig, Meter, ResolvedTolerance } from '../../../src/core/types.ts';
import { makeMeter } from '../../../src/core/time.ts';
import { excerptExpected, goldenBpm, plan, syntheticExpected, type SynthItem } from './expected.ts';
import { configs, corpusDoc } from './io.ts';
import { OracleLiveFollower, oracleFinal, type OracleCtx } from './oracle.ts';
import { buildStream, endOfTakeSec, perform, type PerformSpec, type Played, type Truth } from './perform.ts';
import { refTolerances } from './reference.ts';

export interface Base {
  excerptId: string;
  instrumentId: string;
  inst: Instrument;
  level: number;
  bpm: number;
  writtenKey: KeySig;
  meter: Meter;
  beatsPerBar: number;
  clef: Clef;
  expected: ExpectedNote[];
  /** How the expected notes were built (for fixture descriptions). */
  provenance: string;
}

export function corpusBase(excerptId: string, instrumentId: string, bpm?: number): Base {
  const cfg = configs();
  const d = corpusDoc(excerptId);
  const inst = cfg.instrumentById[instrumentId]!;
  const pl = plan(d, inst, cfg.levels);
  if (!pl) throw new Error(`${excerptId} does not fit ${instrumentId}`);
  const b = bpm ?? goldenBpm(d, cfg.levels);
  return {
    excerptId,
    instrumentId,
    inst,
    level: d.level,
    bpm: b,
    writtenKey: pl.writtenKey,
    meter: d.meter,
    beatsPerBar: d.meter.countsPerBar,
    clef: pl.clef,
    expected: excerptExpected(d, inst, pl, b, cfg.grading),
    provenance:
      bpm === undefined || bpm === goldenBpm(d, cfg.levels)
        ? `fixture corpus ${excerptId} for ${instrumentId} at the golden tempo (P0e rules, fixtures/follow/gen/expected.ts)`
        : `fixture corpus ${excerptId} for ${instrumentId} at ${b} bpm (P0e rules with the tempo changed, fixtures/follow/gen/expected.ts)`,
  };
}

export function syntheticBase(id: string, instrumentId: string, level: number, bpm: number, writtenKey: KeySig, beats: number, items: SynthItem[]): Base {
  const cfg = configs();
  const inst = cfg.instrumentById[instrumentId]!;
  const clef = [...inst.clefs].filter((c) => c.fromLevel <= level).sort((a, b) => b.fromLevel - a.fromLevel)[0]!.clef;
  const meter = makeMeter(beats, 4);
  return {
    excerptId: id,
    instrumentId,
    inst,
    level,
    bpm,
    writtenKey,
    meter,
    beatsPerBar: meter.countsPerBar,
    clef,
    expected: syntheticExpected(items, meter.countsPerBar, inst, writtenKey, clef, bpm, cfg.grading),
    provenance: `synthetic line "${id}" (no fixture-corpus excerpt has the figure; fixtures/follow/gen/expected.ts syntheticExpected)`,
  };
}

export interface RunOpts {
  t0?: number;
  rtl?: number;
  tuningCents?: number;
  /** Score seconds of the end item; default 02 §4.6 / R14 end of take. */
  endSec?: number;
  endReason?: { reason: 'complete' } | { reason: 'stopped' };
}

export interface Run {
  base: Base;
  cfg: Configs;
  played: Played[];
  stream: FollowStreamItem[];
  truthById: Map<number, Truth>;
  tol: ResolvedTolerance[];
  live: FollowerEvent[];
  /** Live events with the input-timeline time of the stream item that produced them. */
  timed: { t: number; ev: FollowerEvent }[];
  final: FinalAlignment;
  detected: DetectedNote[];
  t0: number;
  rtl: number;
  tuningCents: number;
  endSec: number;
}

export const T0 = 10;
export const RTL = 0.03;

export function run(base: Base, spec: PerformSpec, o: RunOpts = {}): Run {
  const cfg = configs();
  const t0 = o.t0 ?? T0;
  const rtl = o.rtl ?? RTL;
  const tuningCents = o.tuningCents ?? 0;
  const played = perform(base.expected, base.beatsPerBar, base.bpm, spec);
  const endSec = o.endSec ?? endOfTakeSec(base.expected, base.bpm, cfg);
  const stream = buildStream(played, { t0, rtl, inst: base.inst, cfg, endSec, ...(o.endReason ? { endReason: o.endReason } : {}) });
  const truthById = new Map<number, Truth>(played.map((p, k) => [k + 1, p.truth]));
  const tol = refTolerances(base.expected, base.inst, base.level, base.bpm, cfg);
  const ctx: OracleCtx = { expected: base.expected, tol, inst: base.inst, cfg, bpm: base.bpm, beatsPerBar: base.beatsPerBar, t0, rtl, writtenKey: base.writtenKey, truthById, tuningCents };
  const oracle = new OracleLiveFollower(ctx);
  const timed: { t: number; ev: FollowerEvent }[] = [];
  const follower: StreamFollower = {
    onDsp: (ev) => oracle.onDsp(ev),
    onClock: (t: ClockSeconds) => oracle.onClock(t),
    end: (t, r) => oracle.end(t, r),
  };
  for (const it of stream) for (const ev of runFollowStream([it], follower)) timed.push({ t: it.t, ev });
  const live = timed.map((x) => x.ev);
  const detected = finalDetected(stream);
  const final = oracleFinal(ctx, detected, oracle.lastLive);
  return { base, cfg, played, stream, truthById, tol, live, timed, final, detected, t0, rtl, tuningCents, endSec };
}

/** Detected id of the played note that is expected note `idx` (ground truth). */
export function idOf(r: Run, idx: number): number {
  for (const [id, t] of r.truthById) if (t.kind === 'match' && t.idx === idx) return id;
  throw new Error(`expected ${idx} not played`);
}
export function idsWhere(r: Run, f: (t: Truth) => boolean): number[] {
  return [...r.truthById.entries()].filter(([, t]) => f(t)).map(([id]) => id).sort((a, b) => a - b);
}
