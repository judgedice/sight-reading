/**
 * The gate suite as a list of independent jobs (one take each), so the runner can spread them over worker threads.
 * `runJob` is a pure function of the job: renders are deterministic (P3) and so is the analysis path.
 */
import { createScenarioSet, GOLDEN_CASES, planGoldenDisplacement, renderScenario, type ScenarioPlan, type ScenarioSet } from '../scenarios/index.ts';
import { conditionOverrides } from './conditions.ts';
import { measureTake } from './measure.ts';
import { planInjected, planPerfect } from './recipes.ts';
import { runTake } from './run-take.ts';
import { CONDITIONS, INJECTED_PATTERNS, LAUNCH_TIMBRES, type ConditionId, type Job, type TakeRecord } from './types.ts';

export interface SuiteScale {
  /** Scenarios per launch instrument from the 300-scenario set (it holds 33 or 34 per timbre). */
  scenariosPerInstrument: number;
  conditions: readonly ConditionId[];
  /** Randomized renders per golden displacement case. */
  goldenRenders: number;
  /** Perfect takes for the E30-only check (02 section 6.2: 300). */
  perfectTakes: number;
  /** Injected-error takes per pattern. */
  tipRuns: number;
}

/** The full suite (`pnpm gates`): every launch scenario of the set under the three conditions. */
export const FULL_SCALE: SuiteScale = { scenariosPerInstrument: 34, conditions: CONDITIONS, goldenRenders: 40, perfectTakes: 300, tipRuns: 30 };
/** The fast subset that runs inside `pnpm test`. */
export const FAST_SCALE: SuiteScale = { scenariosPerInstrument: 1, conditions: ['device'], goldenRenders: 1, perfectTakes: 8, tipRuns: 1 };

export function listJobs(s: SuiteScale): Job[] {
  const jobs: Job[] = [];
  for (const condition of s.conditions) {
    for (let k = 0; k < s.scenariosPerInstrument; k++) {
      for (let t = 0; t < LAUNCH_TIMBRES.length; t++) {
        const index = t + 9 * k;
        if (index < 300) jobs.push({ kind: 'scenario', index, condition });
      }
    }
  }
  for (const c of GOLDEN_CASES) for (let r = 0; r < s.goldenRenders; r++) jobs.push({ kind: 'golden', case: c, r });
  for (let r = 0; r < s.perfectTakes; r++) jobs.push({ kind: 'perfect', r });
  for (const pattern of INJECTED_PATTERNS) for (let r = 0; r < s.tipRuns; r++) jobs.push({ kind: 'tip', pattern, r });
  return jobs;
}

let set: ScenarioSet | null = null;
const scenarioSet = (): ScenarioSet => (set ??= createScenarioSet());

function runPlan(job: Job, plan: ScenarioPlan, condition: ConditionId, k: number): TakeRecord {
  const r = renderScenario(plan, conditionOverrides(condition, k));
  return measureTake(r, runTake(r), { job, condition });
}

export function runJob(job: Job): TakeRecord {
  switch (job.kind) {
    case 'scenario': {
      const plan = scenarioSet().plan(job.index);
      return runPlan(job, plan, job.condition, Math.floor(job.index / 9));
    }
    case 'golden': {
      const plan = planGoldenDisplacement(job.case, job.r);
      const r = renderScenario(plan);
      return measureTake(r, runTake(r), { job, condition: 'planned', expectedDisplaced: plan.perturbation.displaced });
    }
    case 'perfect':
      return runPlan(job, planPerfect(job.r), 'device', job.r);
    case 'tip': {
      const plan = planInjected(job.pattern, job.r);
      if (!plan) return skippedRecord(job, `no fixture-corpus excerpt fits the ${job.pattern} recipe`);
      return runPlan(job, plan, 'device', job.r);
    }
  }
}

function skippedRecord(job: Job, why: string): TakeRecord {
  return {
    job,
    id: `${job.kind}:skipped`,
    timbre: 'flute',
    instrumentId: '',
    family: '',
    windowSamples: 0,
    condition: 'device',
    outputMode: '',
    roomRt60: null,
    bleed: null,
    skipped: why,
    onset: { tp: 0, fp: 0, fn: 0, samples: [] },
    cents: [],
    verdict: { n: 0, agree: 0, boundary: 0, boundaryAgree: 0, examples: [] },
    truthMatched: 0,
    falseMissed: 0,
    falseExtras: 0,
    clickExtras: 0,
    judgments: 0,
    rejudged: 0,
    pitchClassN: 0,
    pitchClassOk: 0,
    octaveErrors: 0,
    falseRed: { eligible: 0, live: 0, final: 0, liveWrong: 0 },
    judgmentLatencyMs: [],
    intonationLatencyMs: [],
    ghostSpelling: { n: 0, ok: 0, examples: [] },
    patterns: [],
    displaced: [],
    expectedDisplaced: [],
    lostPlace: 0,
    score: null,
    grade: null,
    hopP95Ms: null,
  };
}
