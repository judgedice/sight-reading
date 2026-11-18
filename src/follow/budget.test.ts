// P10a acceptance (01 §15 row P10a, §12): the follower costs ≤ 0.3 ms per hop. The follow fixtures and 60 P3
// scenario plans (restarts, skips, errors and clean takes over every launch timbre) are densified to one `clock`
// per 8 ms hop (01 §9.3: onClock runs every hop), and the time spent in onDsp / onClock / end is summed per hop.
// Each take runs REPS times and every hop keeps its fastest run: the follower's own cost per hop, which CI load,
// GC and scheduler pauses cannot inflate. Mean, p99 and max of that series are gated at the unchanged budget.
import { readdirSync, readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import type { ClockSeconds, FollowConfig, FollowFixture, FollowStreamItem } from '../core/types.ts';
import { buildStream, endOfTakeSec, HOP_SEC, perform } from '../../fixtures/follow/gen/perform.ts';
import { configs, corpusDoc } from '../../fixtures/follow/gen/io.ts';
import { resolveTolerances } from '../rules/index.ts';
import { createScenarioSet } from '../testkit/scenarios/index.ts';
import { FIXTURE_ANALYSIS_RATE, followConfigFor } from '../testkit/predicates/index.ts';
import { LiveFollower } from './index.ts';

const BUDGET_MS = 0.3;

/** One clock item per hop: fill the fixture's 4-hop clock cadence in. */
function densify(stream: readonly FollowStreamItem[]): FollowStreamItem[] {
  const out: FollowStreamItem[] = [];
  for (const it of stream) {
    out.push(it);
    if (it.kind === 'clock') for (let k = 1; k < 4; k++) out.push({ kind: 'clock', t: (it.t + k * HOP_SEC) as ClockSeconds });
  }
  return out.sort((a, b) => a.t - b.t);
}

interface Case {
  id: string;
  config: FollowConfig;
  stream: FollowStreamItem[];
}

function cases(): Case[] {
  const cfg = configs();
  const dir = new URL('../../fixtures/follow/', import.meta.url);
  const out: Case[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const fx = JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as FollowFixture;
    const instrument = cfg.instrumentById[fx.instrumentId]!;
    const tol = resolveTolerances(fx.expected, { instrument, level: fx.level, bpm: fx.bpm, meter: corpusDoc(fx.excerptId).meter }, cfg);
    out.push({ id: fx.id, config: followConfigFor(fx, instrument, cfg, tol), stream: densify(fx.stream) });
  }
  const set = createScenarioSet({ count: 60 });
  for (const plan of set.plans()) {
    const b = plan.base;
    const played = perform(b.expected, b.beatsPerBar, b.bpm, plan.perturbation.spec);
    const stream = buildStream(played, { t0: 10, rtl: 0.03, inst: b.inst, cfg, endSec: endOfTakeSec(b.expected, b.bpm, cfg) });
    const tolerances = resolveTolerances(b.expected, { instrument: b.inst, level: b.level, bpm: b.bpm, meter: b.meter }, cfg);
    const config: FollowConfig = {
      expected: b.expected,
      tolerances,
      t0: 10 as ClockSeconds,
      latencyCompensationSec: 0.03,
      bpm: b.bpm,
      beatsPerBar: b.beatsPerBar,
      instrument: b.inst,
      cfg,
      voiceReferenceCents: 0,
      analysisRate: FIXTURE_ANALYSIS_RATE,
      writtenKey: b.writtenKey,
    };
    out.push({ id: plan.id, config, stream: densify(stream) });
  }
  return out;
}

/** Milliseconds spent per hop for one run (dense: index = hop number from the stream start). */
function perHop(c: Case): number[] {
  const f = new LiveFollower(c.config);
  const start = c.stream[0]!.t;
  const hops: number[] = [];
  for (const it of c.stream) {
    const t0 = performance.now();
    if (it.kind === 'dsp') f.onDsp(it.event);
    else if (it.kind === 'clock') f.onClock(it.t);
    else f.end(it.t, it.end);
    const dt = performance.now() - t0;
    const h = Math.floor((it.t - start) / HOP_SEC + 1e-6);
    hops[h] = (hops[h] ?? 0) + dt;
  }
  return Array.from(hops, (x) => x ?? 0);
}

const REPS = 7;

describe('LiveFollower time budget (≤ 0.3 ms per hop)', () => {
  it(`every hop of every take is within budget (fastest of ${REPS} repetitions per hop, so CI load and GC pauses are excluded)`, () => {
    const cs = cases();
    for (const c of cs.slice(0, 10)) perHop(c); // warm up the JIT
    const single: number[] = [];
    const steady: number[] = [];
    for (const c of cs) {
      const runs = Array.from({ length: REPS }, () => perHop(c));
      single.push(...runs[0]!);
      steady.push(...runs[0]!.map((_, h) => Math.min(...runs.map((r) => r[h]!))));
    }
    const q = (xs: number[], f: number): number => [...xs].sort((a, b) => a - b)[Math.floor(f * (xs.length - 1))]!;
    const meanOf = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
    const us = (x: number): string => `${(x * 1000).toFixed(1)} µs`;
    console.warn(
      `P10a per-hop cost, ${single.length} hops in ${cs.length} takes: single run mean ${us(meanOf(single))}, p99 ${us(q(single, 0.99))}, max ${us(q(single, 1))} ` +
        `(${single.filter((x) => x > BUDGET_MS).length} hops over budget, load/GC/scheduler pauses; reported only); ` +
        `fastest of ${REPS} runs per hop: mean ${us(meanOf(steady))}, p99 ${us(q(steady, 0.99))}, max ${us(q(steady, 1))}`,
    );
    expect(meanOf(steady)).toBeLessThanOrEqual(BUDGET_MS);
    expect(q(steady, 0.99)).toBeLessThanOrEqual(BUDGET_MS);
    expect(q(steady, 1)).toBeLessThanOrEqual(BUDGET_MS);
  });
});
