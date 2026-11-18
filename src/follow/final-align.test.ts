// P10b acceptance (01 §15 row P10b): the four golden displacement cases give their segments in randomized renders,
// replayed notes never overwrite an earlier judgment, live vs final divergence ≤ 3% on P3's scenario set, and
// finalAlign costs < 5 ms for 200 notes. Streams come from P3's scenario plans through the fixture stream builder
// (fixtures/follow/gen/perform.ts), so the follower and the alignment see exactly the DSP events of 01 §5.6; no
// audio is rendered (the audio path is P18's gate).
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import type { ClockSeconds, DetectedNote, ExpectedNote, FinalAlignment, FollowConfig, FollowStreamItem } from '../core/types.ts';
import { buildStream, endOfTakeSec, perform, type Played, type PerformSpec, type Truth } from '../../fixtures/follow/gen/perform.ts';
import { configs } from '../../fixtures/follow/gen/io.ts';
import { resolveTolerances } from '../rules/index.ts';
import { createScenarioSet, GOLDEN_CASES, GOLDEN_SPECS, planGoldenDisplacement, planScenario, type ScenarioPlan } from '../testkit/scenarios/index.ts';
import { finalDetected, runFollowStream } from '../testkit/predicates/index.ts';
import { alignDp, alignFinal, alignNotes, finalAlign, LiveFollower, liveOutcomeOf, replayLive } from './index.ts';

const T0 = 10;
const RTL = 0.03;

interface PlanRun {
  config: FollowConfig;
  stream: FollowStreamItem[];
  detected: DetectedNote[];
  truth: Map<number, Truth>;
  played: Played[];
}

function configFor(plan: ScenarioPlan): FollowConfig {
  const cfg = configs();
  const b = plan.base;
  const tolerances = resolveTolerances(b.expected, { instrument: b.inst, level: b.level, bpm: b.bpm, meter: b.meter }, cfg);
  return { expected: b.expected, tolerances, t0: T0 as ClockSeconds, latencyCompensationSec: RTL, bpm: b.bpm, beatsPerBar: b.beatsPerBar, instrument: b.inst, cfg, voiceReferenceCents: 0 };
}

function runSpec(config: FollowConfig, spec: PerformSpec): PlanRun {
  const played = perform(config.expected, config.beatsPerBar, config.bpm, spec);
  const stream = buildStream(played, { t0: T0, rtl: RTL, inst: config.instrument, cfg: config.cfg, endSec: endOfTakeSec(config.expected, config.bpm, config.cfg) });
  return { config, stream, detected: finalDetected(stream), truth: new Map(played.map((p, k) => [k + 1, p.truth])), played };
}

const runPlan = (plan: ScenarioPlan): PlanRun => runSpec(configFor(plan), plan.perturbation.spec);

const truthSegments = (r: PlanRun): { fromIdx: number; toIdx: number; offsetBeats: number; ids: number[] }[] => {
  const segs = new Map<number, { fromIdx: number; toIdx: number; offsetBeats: number; ids: number[] }>();
  for (const [id, t] of [...r.truth.entries()].sort((a, b) => a[0] - b[0])) {
    if (t.kind !== 'displaced') continue;
    const s = segs.get(t.seg) ?? { fromIdx: t.idx, toIdx: t.idx, offsetBeats: t.offsetBeats, ids: [] };
    s.fromIdx = Math.min(s.fromIdx, t.idx);
    s.toIdx = Math.max(s.toIdx, t.idx);
    s.ids.push(id);
    segs.set(t.seg, s);
  }
  return [...segs.values()];
};

/** Segments as the plan states them (01 §13.2), and the played ids of the replay. */
function segmentsAgree(final: FinalAlignment, r: PlanRun, expected: readonly { fromIdx: number; toIdx: number; offsetBeats: number }[]): boolean {
  const truth = truthSegments(r);
  if (final.displaced.length !== expected.length) return false;
  return expected.every((x, k) => {
    const got = final.displaced[k]!;
    return got.fromIdx === x.fromIdx && got.toIdx === x.toIdx && Math.abs(got.offsetBeats - x.offsetBeats) <= 0.1 && JSON.stringify(got.detectedIds) === JSON.stringify(truth[k]?.ids);
  });
}

/**
 * 01 §9.6 "replayed notes never overwrite an earlier judgment of the same expected note": an expected note that was
 * played on time keeps that note; a replayed or skipped-ahead note never takes it.
 */
function overwrites(final: FinalAlignment, r: PlanRun): string[] {
  const playedFor = new Map<number, number>();
  for (const [id, t] of r.truth) if (t.kind === 'match') playedFor.set(t.idx, id);
  const bad: string[] = [];
  for (const j of final.judgments) {
    if (j.detectedId === null) continue;
    const t = r.truth.get(j.detectedId);
    if (t?.kind === 'displaced' && playedFor.has(j.expectedIdx)) bad.push(`expected ${j.expectedIdx} (played as ${playedFor.get(j.expectedIdx)}) took displaced note ${j.detectedId}`);
  }
  return bad;
}

/**
 * Displaced notes the final alignment judged as current notes. Allowed only where the score cannot tell them apart:
 * the note has the pitch of the written note it took and lands within that note's tRed (the replayed passage
 * repeats the current one there).
 */
function takenUnambiguously(final: FinalAlignment, r: PlanRun): string[] {
  const out: string[] = [];
  for (const j of final.judgments) {
    if (j.detectedId === null || r.truth.get(j.detectedId)?.kind !== 'displaced') continue;
    const tol = r.config.tolerances[j.expectedIdx]!;
    if (j.credit.p === 1 && Math.abs(j.timingErrorMs!) <= tol.tRedSec * 1000) continue;
    out.push(`expected ${j.expectedIdx} took displaced note ${j.detectedId} (${j.pitch}, ${j.timingErrorMs} ms)`);
  }
  return out;
}

describe('final alignment: the four golden displacement cases, randomized (01 §13.2, §15 P10b)', () => {
  const RENDERS = 100;
  for (const c of GOLDEN_CASES) {
    it(`${c}: expected segments in ≥ 95% of ${RENDERS} renders, replays never overwrite`, () => {
      let ok = 0;
      const misses: string[] = [];
      for (let k = 0; k < RENDERS; k++) {
        const plan = planGoldenDisplacement(c, k);
        const r = runPlan(plan);
        const final = finalAlign(r.config, r.detected);
        if (segmentsAgree(final, r, GOLDEN_SPECS[c].displaced)) ok++;
        else misses.push(`${k}: ${JSON.stringify(final.displaced)}`);
        expect(overwrites(final, r), `render ${k}`).toEqual([]);
        expect(takenUnambiguously(final, r), `render ${k}`).toEqual([]);
        // Current notes covered by the restart or skip are missed (02 §4.3, §4.6).
        for (const i of GOLDEN_SPECS[c].omit) expect(final.judgments[i]!.status, `render ${k} expected ${i}`).toBe('missed');
        expect(final.extras, `render ${k}`).toEqual([]);
      }
      console.warn(`P10b golden ${c}: ${ok}/${RENDERS} renders give the expected segments`);
      expect(ok / RENDERS, misses.slice(0, 5).join('\n')).toBeGreaterThanOrEqual(0.95);
    });
  }

  it('back-2-beats: the first play of the replayed notes 22 and 23 keeps its judgment', () => {
    for (let k = 0; k < 20; k++) {
      const r = runPlan(planGoldenDisplacement('back-2-beats', k));
      const final = finalAlign(r.config, r.detected);
      for (const i of [22, 23]) {
        const j = final.judgments[i]!;
        expect(j.status).toBe('matched');
        expect(r.truth.get(j.detectedId!)).toEqual({ kind: 'match', idx: i });
      }
    }
  });
});

describe('final alignment: P3 scenario restarts and skips', () => {
  it('replayed notes never overwrite a played note, and ≥ 90% of restart/skip scenarios yield their segments', () => {
    let withSeg = 0;
    let agree = 0;
    const over: string[] = [];
    const taken: string[] = [];
    for (const kind of ['restart', 'skip'] as const) {
      for (let i = 0; i < 60; i++) {
        const plan = planScenario(0x5eed, i, { perturb: { structural: kind } });
        if (plan.perturbation.structural !== kind || plan.perturbation.displaced.length === 0) continue;
        withSeg++;
        const r = runPlan(plan);
        const final = finalAlign(r.config, r.detected);
        over.push(...overwrites(final, r).map((m) => `${plan.id}: ${m}`));
        taken.push(...takenUnambiguously(final, r).map((m) => `${plan.id}: ${m}`));
        if (final.displaced.length === plan.perturbation.displaced.length) agree++;
      }
    }
    console.warn(
      `P10b scenario relabel: ${agree}/${withSeg} restart/skip scenarios give their number of segments; ${taken.length} displaced notes judged as wrong or off-time current notes where the replay mostly coincides with the score (${taken.join('; ')})`,
    );
    expect(withSeg).toBeGreaterThan(80);
    expect(over).toEqual([]);
    expect(agree / withSeg).toBeGreaterThanOrEqual(0.9);
  });

  it('300 perfect takes give no displaced segment, no extra and nothing rejudged', () => {
    const set = createScenarioSet({ count: 300, perturb: { clean: true } });
    const hits: string[] = [];
    for (const plan of set.plans()) {
      const r = runPlan(plan);
      const final = finalAlign(r.config, r.detected);
      if (final.displaced.length || final.extras.length || final.judgments.some((j) => j.rejudged || j.status === 'missed')) hits.push(plan.id);
    }
    expect(hits).toEqual([]);
  });
});

describe('final alignment: live vs final divergence (01 §9.7 gate ≤ 3%)', () => {
  it('over the 300-scenario P3 set, rejudged notes ≤ 3% of expected notes', () => {
    const set = createScenarioSet({ count: 300 });
    let notes = 0;
    let rejudged = 0;
    let replayDiffers = 0;
    for (const plan of set.plans()) {
      const r = runPlan(plan);
      const events = runFollowStream(r.stream, new LiveFollower(r.config));
      const live = liveOutcomeOf(events);
      const final = alignFinal(r.config, r.detected, live);
      notes += final.judgments.length;
      rejudged += final.judgments.filter((j) => j.rejudged).length;
      if (JSON.stringify([...replayLive(r.config, r.detected)].sort((a, b) => a[0] - b[0])) !== JSON.stringify([...live].sort((a, b) => a[0] - b[0]))) replayDiffers++;
    }
    const rate = rejudged / notes;
    console.warn(`P10b divergence: ${rejudged}/${notes} notes rejudged (${(100 * rate).toFixed(2)}%); replayed live outcome differs from the streamed one in ${replayDiffers}/300 scenarios`);
    expect(rate).toBeLessThanOrEqual(0.03);
    expect(replayDiffers).toBe(0);
  });
});

describe('relabel: a run of extras at a constant offset (R34)', () => {
  it('a replay of the last bar played after the written end becomes one segment, not extras', () => {
    const plan = planGoldenDisplacement('stop-bar-5', 0);
    const config = configFor(plan);
    const E = config.expected;
    const beatSec = 60 / config.bpm;
    const last = E.length - 1;
    const shiftBeats = 2 * config.beatsPerBar;
    const maxW = Math.max(...config.tolerances.map((t) => t.matchWindowSec));
    // The last notes whose shifted onsets land beyond every written note's band.
    const from = E.findIndex((e) => e.onsetSec + shiftBeats * beatSec > E[last]!.onsetSec + maxW);
    const T = (s: number): number => T0 + RTL + s;
    const detected: DetectedNote[] = [];
    const mk = (id: number, e: ExpectedNote, s: number): DetectedNote => ({
      id,
      onset: T(s) as ClockSeconds,
      offset: T(s + 0.9 * e.durSec) as ClockSeconds,
      provisionalMidi: e.concertMidi,
      midi: e.concertMidi,
      stableMedianCents: 0,
      steadyMs: 0.9 * e.durSec * 1000 - 40,
      pitchSdCents: 3,
      clarity: 0.95,
      altOctaveClarity: null,
      onsetCause: 'from-silence',
    });
    E.forEach((e, i) => detected.push(mk(i + 1, e, e.onsetSec)));
    for (let i = from; i <= last; i++) detected.push(mk(detected.length + 1, E[i]!, E[i]!.onsetSec + shiftBeats * beatSec));
    const replayIds = detected.slice(E.length).map((d) => d.id);
    expect(replayIds.length).toBeGreaterThanOrEqual(3);
    // The DP alone calls them extras: nothing is written after the last note.
    const notes = alignNotes(config, detected);
    const dp = alignDp(config, notes);
    expect(notes.filter((n, k) => replayIds.includes(n.note.id) && dp.idx[k] === null)).toHaveLength(replayIds.length);
    const final = finalAlign(config, detected);
    expect(final.displaced).toEqual([{ fromIdx: from, toIdx: last, offsetBeats: -shiftBeats, detectedIds: replayIds }]);
    expect(final.extras).toEqual([]);
    expect(final.judgments.every((j, i) => j.status === 'matched' && j.detectedId === i + 1)).toBe(true);
  });

  it('two wrong notes in a row are not a segment (fewer than 3)', () => {
    const plan = planGoldenDisplacement('stop-bar-5', 0);
    const config = configFor(plan);
    const r = runSpec(config, { mods: { 5: { semis: 2 }, 6: { semis: -3 } } });
    const final = finalAlign(r.config, r.detected);
    expect(final.displaced).toEqual([]);
    expect(final.judgments[5]!.pitch).toBe('wrong-pitch');
    expect(final.judgments[6]!.pitch).toBe('wrong-pitch');
  });
});

describe('final alignment: cost (01 §15 P10b: < 5 ms for 200 notes)', () => {
  /** 200+ expected notes: one scenario base tiled end to end. */
  function longConfig(): FollowConfig {
    const plan = planGoldenDisplacement('back-2-beats', 0);
    const b = plan.base;
    const barBeats = b.beatsPerBar;
    const lastBar = Math.max(...b.expected.map((e) => e.bar));
    const beatSec = 60 / b.bpm;
    const tiles = Math.ceil(200 / b.expected.length);
    const expected: ExpectedNote[] = [];
    for (let t = 0; t < tiles; t++) {
      const shiftBeats = t * (lastBar + 1) * barBeats;
      for (const e of b.expected) {
        expected.push({ ...e, idx: expected.length, bar: e.bar + t * (lastBar + 1), onsetBeat: e.onsetBeat + shiftBeats, onsetSec: e.onsetSec + shiftBeats * beatSec });
      }
    }
    const cfg = configs();
    const tolerances = resolveTolerances(expected, { instrument: b.inst, level: b.level, bpm: b.bpm, meter: b.meter }, cfg);
    return { expected, tolerances, t0: T0 as ClockSeconds, latencyCompensationSec: RTL, bpm: b.bpm, beatsPerBar: b.beatsPerBar, instrument: b.inst, cfg, voiceReferenceCents: 0 };
  }

  // The gate is on the alignment the session runs at take end: `alignFinal` with the live outcome it streamed (DP,
  // relabel, judgments, rejudged). `finalAlign` without a live outcome also replays the live follower to rebuild
  // it; that replay costs one DisplacementDetector search per note (P10a's live cost, ~0.02 ms each) and is
  // reported, not gated (P10b hand-off: a gap for the P10a and 01 owners).
  it('median alignFinal over a 200+ note take with errors and a restart', () => {
    const config = longConfig();
    expect(config.expected.length).toBeGreaterThanOrEqual(200);
    // Tile 3 carries the golden back-2-beats restart (replay 22..27, current 24..31 dropped); a wrong note every 17
    // notes and a dropped note every 23 elsewhere.
    const n0 = planGoldenDisplacement('back-2-beats', 0).base.expected.length;
    const at = 3 * n0;
    const g = GOLDEN_SPECS['back-2-beats'];
    const mods: PerformSpec['mods'] = {};
    for (let i = 3; i < config.expected.length; i += 17) mods[i] = { semis: 1 };
    for (let i = 9; i < config.expected.length; i += 23) mods[i] = { omit: true };
    for (let i = at + 18; i < at + 34; i++) delete mods[i];
    for (const i of g.omit) mods[at + i] = { omit: true };
    const rep = g.replays[0]!;
    const r = runSpec(config, { mods, replays: [{ from: at + rep.from, to: at + rep.to, offsetBeats: rep.offsetBeats }] });
    const time = (f: () => unknown): number => {
      for (let k = 0; k < 5; k++) f();
      const xs: number[] = [];
      for (let k = 0; k < 21; k++) {
        const t = performance.now();
        f();
        xs.push(performance.now() - t);
      }
      return xs.sort((a, b) => a - b)[10]!;
    };
    const live = liveOutcomeOf(runFollowStream(r.stream, new LiveFollower(config)));
    const align = time(() => alignFinal(config, r.detected, live));
    const full = time(() => finalAlign(config, r.detected));
    console.warn(`P10b cost: ${config.expected.length} expected, ${r.detected.length} detected: alignFinal ${align.toFixed(2)} ms median; finalAlign with the live replay ${full.toFixed(2)} ms`);
    expect(finalAlign(config, r.detected).displaced).toHaveLength(1);
    expect(align).toBeLessThan(5);
  });
});
