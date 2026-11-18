// P10a acceptance (01 §15 row P10a): "displacement entered within 4 notes on the back and skip cases and never on
// 300 perfect takes". Streams are built from P3's scenario plans with the fixture stream builder
// (fixtures/follow/gen/perform.ts), so no audio is rendered: the follower sees exactly the DSP events of 01 §5.6.
import { describe, expect, it } from 'vitest';
import type { ClockSeconds, FollowConfig, FollowerEvent, FollowStreamItem } from '../core/types.ts';
import { buildStream, endOfTakeSec, perform, type Truth } from '../../fixtures/follow/gen/perform.ts';
import { configs } from '../../fixtures/follow/gen/io.ts';
import { resolveTolerances } from '../rules/index.ts';
import { createScenarioSet, GOLDEN_CASES, planGoldenDisplacement, planScenario, type ScenarioPlan } from '../testkit/scenarios/index.ts';
import { runFollowStream } from '../testkit/predicates/index.ts';
import { classifyAgainst, DisplacementDetector, LiveFollower, type WindowNote } from './index.ts';

const T0 = 10;
const RTL = 0.03;

interface PlanRun {
  events: FollowerEvent[];
  truth: Map<number, Truth>;
  stream: FollowStreamItem[];
  config: FollowConfig;
}

function runPlan(plan: ScenarioPlan): PlanRun {
  const cfg = configs();
  const b = plan.base;
  const played = perform(b.expected, b.beatsPerBar, b.bpm, plan.perturbation.spec);
  const stream = buildStream(played, { t0: T0, rtl: RTL, inst: b.inst, cfg, endSec: endOfTakeSec(b.expected, b.bpm, cfg) });
  const tolerances = resolveTolerances(b.expected, { instrument: b.inst, level: b.level, bpm: b.bpm, meter: b.meter }, cfg);
  const config: FollowConfig = {
    expected: b.expected,
    tolerances,
    t0: T0 as ClockSeconds,
    latencyCompensationSec: RTL,
    bpm: b.bpm,
    beatsPerBar: b.beatsPerBar,
    instrument: b.inst,
    cfg,
    voiceReferenceCents: 0,
  };
  const events = runFollowStream(stream, new LiveFollower(config));
  return { events, truth: new Map(played.map((p, k) => [k + 1, p.truth])), stream, config };
}

const lostPlace = (ev: FollowerEvent[]): number => ev.filter((e) => e.type === 'status' && e.kind === 'lost-place').length;
const displacedIds = (r: PlanRun): number[] => [...r.truth.entries()].filter(([, t]) => t.kind === 'displaced').map(([id]) => id).sort((a, b) => a - b);

/** Position (0-based) in the displaced run of the first note the follower drew as displaced, or null. */
function enteredAt(r: PlanRun): number | null {
  const ids = displacedIds(r);
  const starts = new Map(r.events.flatMap((e) => (e.type === 'note-start' ? [[e.detectedId, e.displaced] as const] : [])));
  const k = ids.findIndex((id) => starts.get(id) === true);
  return k < 0 ? null : k;
}

/** Every displaced note from the 4th on is drawn displaced, and none of them is matched to a current note. */
function heldFromFourth(r: PlanRun): boolean {
  const ids = displacedIds(r).slice(3);
  const starts = new Map(r.events.flatMap((e) => (e.type === 'note-start' ? [[e.detectedId, e] as const] : [])));
  return ids.every((id) => starts.get(id)?.displaced === true && starts.get(id)?.matchedExpected === null);
}

describe('displacement detector: golden back and skip cases, randomized (01 §9.5, §13.2)', () => {
  const RENDERS = 100;
  for (const c of ['back-2-beats', 'skip-bar-ahead'] as const) {
    it(`${c}: entered within 4 notes and held for the rest of the run in ${RENDERS}/${RENDERS} renders`, () => {
      const entered: (number | null)[] = [];
      let held = 0;
      let once = 0;
      let rejoined = 0;
      for (let r = 0; r < RENDERS; r++) {
        const run = runPlan(planGoldenDisplacement(c, r));
        entered.push(enteredAt(run));
        if (heldFromFourth(run)) held++;
        if (lostPlace(run.events) === 1) once++;
        if (run.events.some((e) => e.type === 'status' && e.kind === 'rejoined')) rejoined++;
      }
      const late = entered.filter((k) => k === null || k > 3);
      expect(late, `entered at positions ${JSON.stringify(entered)}`).toEqual([]);
      expect(held).toBe(RENDERS);
      expect(once).toBe(RENDERS);
      expect(rejoined).toBe(RENDERS);
    });
  }
  for (const c of GOLDEN_CASES.filter((x) => x === 'stop-bar-5' || x === 'rejoin-next-downbeat')) {
    it(`${c}: dropping notes and rejoining on time never enters displaced (${RENDERS} renders)`, () => {
      for (let r = 0; r < RENDERS; r++) expect(lostPlace(runPlan(planGoldenDisplacement(c, r)).events), `render ${r}`).toBe(0);
    });
  }
});

/**
 * A displaced note the score cannot tell from a current one: some expected note within its tRed has the played
 * pitch at δ = 0 (the replayed passage repeats the current one). No detector can be asked to label those.
 */
function ambiguousAtZero(r: PlanRun, id: number): boolean {
  const on = r.stream.find((it) => it.kind === 'dsp' && it.event.type === 'note-on' && it.event.note.id === id);
  if (!on || on.kind !== 'dsp' || on.event.type !== 'note-on') throw new Error(`no note-on for ${id}`);
  const d = on.event.note;
  const s = d.onset - T0 - RTL;
  return r.config.expected.some((e, i) => {
    const t = r.config.tolerances[i]!;
    if (Math.abs(s - e.onsetSec) > t.tRedSec) return false;
    return classifyAgainst(e, { midi: d.provisionalMidi, clarity: d.clarity, altOctaveClarity: d.altOctaveClarity }, 0, r.config.instrument, r.config.cfg).c.kind === 'correct';
  });
}

describe('displacement detector: P3 scenario restarts and skips across the fixture corpus', () => {
  it('enters within 4 notes and holds on every distinguishable restart and skip scenario', () => {
    const results: { id: string; at: number | null; held: boolean }[] = [];
    const excluded: string[] = [];
    for (const kind of ['restart', 'skip'] as const) {
      for (let i = 0; i < 60; i++) {
        const plan = planScenario(0x5eed, i, { perturb: { structural: kind } });
        if (plan.perturbation.structural !== kind || plan.perturbation.displaced.length === 0) continue;
        const run = runPlan(plan);
        const ids = displacedIds(run);
        const amb = new Set(ids.filter((id) => ambiguousAtZero(run, id)));
        if (ids.slice(0, 4).filter((id) => amb.has(id)).length >= 2) {
          excluded.push(plan.id);
          continue;
        }
        const starts = new Map(run.events.flatMap((e) => (e.type === 'note-start' ? [[e.detectedId, e] as const] : [])));
        const held = ids.slice(3).every((id) => amb.has(id) || (starts.get(id)?.displaced === true && starts.get(id)?.matchedExpected === null));
        results.push({ id: plan.id, at: enteredAt(run), held });
      }
    }
    const bad = results.filter((x) => x.at === null || x.at > 3 || !x.held);
    console.warn(`P10a scenario displacement: ${results.length - bad.length}/${results.length} distinguishable restart/skip scenarios entered within 4 notes and held; ${excluded.length} excluded as ambiguous (${excluded.join(', ')})`);
    expect(results.length).toBeGreaterThan(80);
    expect(bad, JSON.stringify(bad.slice(0, 10))).toEqual([]);
  });
});

describe('displacement detector: never on perfect takes', () => {
  it('300 perfect takes (P3 clean scenarios, every launch timbre) never enter displaced', () => {
    const set = createScenarioSet({ count: 300, perturb: { clean: true } });
    const hits: string[] = [];
    let n = 0;
    for (const plan of set.plans()) {
      n++;
      const r = runPlan(plan);
      if (lostPlace(r.events) > 0 || r.events.some((e) => e.type === 'note-start' && e.displaced)) hits.push(plan.id);
    }
    expect(n).toBe(300);
    expect(hits).toEqual([]);
  });
});

describe('DisplacementDetector unit behaviour', () => {
  const plan = planGoldenDisplacement('back-2-beats', 0);
  const run = runPlan(plan);
  const det = new DisplacementDetector(run.config.expected, run.config.tolerances, run.config.bpm, run.config.beatsPerBar, run.config.instrument, run.config.cfg);
  const beatSec = 60 / run.config.bpm;
  const at = (idx: number, shiftBeats: number): WindowNote => {
    const e = run.config.expected[idx]!;
    return { s: e.onsetSec + shiftBeats * beatSec, midi: e.concertMidi, clarity: 0.95, altOctaveClarity: null };
  };

  it('finds the offset of four replayed notes (expected − played beat, negative = went back)', () => {
    const hit = det.detect([22, 23, 24, 25].map((i) => at(i, 2)), 0);
    expect(hit).not.toBeNull();
    expect(hit!.offsetBeats).toBeCloseTo(-2, 6);
    expect(hit!.matches).toBe(4);
  });

  it('finds a skip ahead', () => {
    const hit = det.detect([8, 9, 10, 11].map((i) => at(i, -4)), 0);
    expect(hit?.offsetBeats).toBeCloseTo(4, 6);
  });

  it('does not fire on notes played where they are written', () => {
    expect(det.detect([20, 21, 22, 23].map((i) => at(i, 0)), 0)).toBeNull();
  });

  it('needs a full window of 4 notes', () => {
    expect(det.detect([22, 23, 24].map((i) => at(i, 2)), 0)).toBeNull();
  });

  it('still fires with one wrong note in the window (3 of 4)', () => {
    const w = [22, 23, 24, 25].map((i) => at(i, 2));
    w[1] = { ...w[1]!, midi: w[1]!.midi + 5 };
    expect(det.detect(w, 0)?.offsetBeats).toBeCloseTo(-2, 6);
  });

  it('never proposes an offset under one beat', () => {
    for (const shift of [0.25, 0.5, 0.75, -0.5]) {
      const hit = det.detect([22, 23, 24, 25].map((i) => at(i, shift)), 0);
      if (hit) expect(Math.abs(hit.offsetBeats)).toBeGreaterThanOrEqual(1);
    }
  });
});
