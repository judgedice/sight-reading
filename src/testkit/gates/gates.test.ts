/**
 * P18 fast subset of the synthetic accuracy gates (01 section 13.2). The full suite is `pnpm gates`
 * (tools/gates/run.ts: about 1,800 takes, results in docs/accuracy-report.md); this file runs a deterministic slice of
 * it in `pnpm test` through the same code path:
 *
 * - one device-condition take (click bleed, phone mic, noise) per launch instrument, with the 13.2 rate gates pooled
 *   over the eight takes (one take per instrument is too few for per-instrument rates; those are the full run's);
 * - render 0 of each golden displacement case;
 * - eight perfect takes (only E30 may fire) and take 0 of every injected-error recipe (its pattern must fire).
 *
 * Thresholds are the spec's. Set GATES_FAST_LOG=1 to print the measurements.
 */
import { describe, expect, it } from 'vitest';
import { GOLDEN_CASES } from '../scenarios/index.ts';
import { instrumentStats, quantile, segmentsMatch } from './aggregate.ts';
import { runJob } from './jobs.ts';
import { INJECTED_PATTERNS, LAUNCH_TIMBRES, type TakeRecord } from './types.ts';

const log = (s: string): void => {
  if (process.env.GATES_FAST_LOG) process.stdout.write(`${s}\n`);
};

describe('gate arithmetic', () => {
  it('quantile is the nearest-rank quantile', () => {
    expect(quantile([], 0.9)).toBeNull();
    expect(quantile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(quantile(Array.from({ length: 10 }, (_, i) => i + 1), 0.9)).toBe(9);
    expect(quantile([1, 2, 3], 1)).toBe(3);
  });

  it('segments match on offset and ends within one note, and only when nothing else is displaced', () => {
    const want = [{ fromIdx: 22, toIdx: 27, offsetBeats: -2 }];
    expect(segmentsMatch([{ fromIdx: 22, toIdx: 27, offsetBeats: -2.01 }], want)).toBe(true);
    expect(segmentsMatch([{ fromIdx: 23, toIdx: 26, offsetBeats: -2 }], want)).toBe(true);
    expect(segmentsMatch([{ fromIdx: 22, toIdx: 25, offsetBeats: -2 }], want)).toBe(false);
    expect(segmentsMatch([{ fromIdx: 22, toIdx: 27, offsetBeats: -4 }], want)).toBe(false);
    expect(segmentsMatch([], [])).toBe(true);
    expect(segmentsMatch([{ fromIdx: 3, toIdx: 6, offsetBeats: 4 }], [])).toBe(false);
  });
});

describe('synthetic gates, fast subset (device condition)', () => {
  const records: TakeRecord[] = [];

  it('one take per launch instrument: pooled 13.2 rates hold', () => {
    for (let t = 0; t < LAUNCH_TIMBRES.length; t++) records.push(runJob({ kind: 'scenario', index: t, condition: 'device' }));
    expect(records.map((r) => r.timbre)).toEqual([...LAUNCH_TIMBRES]);
    for (const r of records) {
      log(`${r.id} (${r.bleed}): F1 tp ${r.onset.tp} fp ${r.onset.fp} fn ${r.onset.fn}, agree ${r.verdict.agree}/${r.verdict.n}, extras ${r.falseExtras}, click extras ${r.clickExtras}, rejudged ${r.rejudged}/${r.judgments}`);
      expect(r.outputMode, r.id).toBe('speakers');
      expect(r.clickExtras, `${r.id}: click-induced extras`).toBe(0);
    }
    const s = instrumentStats(records);
    log(`pooled: F1 ${s.f1}, agreement ${s.verdictAgree}, false missed ${s.falseMissedRate}, extras/take ${s.falseExtrasPerTake}, divergence ${s.divergence}, pitch class ${s.pitchClassAcc}, octave ${s.octaveRate}, false red ${s.falseRedLive}`);
    expect(s.f1 as number).toBeGreaterThanOrEqual(0.97);
    expect(s.verdictAgree as number).toBeGreaterThanOrEqual(0.95);
    expect(s.falseMissedRate as number).toBeLessThanOrEqual(0.01);
    expect(s.falseExtrasPerTake as number).toBeLessThanOrEqual(1);
    expect(s.divergence as number).toBeLessThanOrEqual(0.03);
    expect(s.pitchClassAcc as number).toBeGreaterThanOrEqual(0.99);
    expect(s.octaveRate as number).toBeLessThanOrEqual(0.005);
    // PLAN ruling 19: live sharp/flat on in-tune notes at most 1%.
    expect(s.falseRedEligible).toBeGreaterThan(50);
    expect(s.falseRedLive as number).toBeLessThanOrEqual(0.01);
    // 01 section 12 by window class (1024: 79 ms accepted by PLAN ruling 47).
    for (const [w, limit] of [
      [512, 60],
      [1024, 79],
    ] as const) {
      const xs = records.filter((r) => r.windowSamples === w).flatMap((r) => r.judgmentLatencyMs);
      log(`latency ${w}: n ${xs.length}, p95 ${quantile(xs, 0.95)}`);
      expect(xs.length).toBeGreaterThan(20);
      expect(quantile(xs, 0.95) as number).toBeLessThanOrEqual(limit);
    }
  }, 240_000);

  it.each(GOLDEN_CASES)('golden displacement %s, render 0: the expected segments', (c) => {
    const r = runJob({ kind: 'golden', case: c, r: 0 });
    log(`${r.id}: displaced ${JSON.stringify(r.displaced)}, expected ${JSON.stringify(r.expectedDisplaced)}`);
    expect(segmentsMatch(r.displaced, r.expectedDisplaced), JSON.stringify(r.displaced)).toBe(true);
  }, 60_000);

  it('perfect takes fire nothing but E30 (02 section 6.2)', () => {
    for (let k = 0; k < 8; k++) {
      const r = runJob({ kind: 'perfect', r: k });
      log(`${r.id}: ${r.score} ${r.grade}, patterns ${r.patterns.join(',') || 'none'}`);
      expect(r.patterns.filter((p) => p !== 'E30'), r.id).toEqual([]);
    }
  }, 240_000);

  it.each([...INJECTED_PATTERNS])('injected %s, take 0: the pattern fires', (p) => {
    const r = runJob({ kind: 'tip', pattern: p, r: 0 });
    log(`${p}: ${r.id}: ${r.patterns.join(',') || 'none'}`);
    expect(r.skipped).toBeNull();
    expect(r.patterns, r.id).toContain(p);
  }, 60_000);
});
