/**
 * Scenario plans drawn from the shipped corpus (public/corpus/v1), for the tip-precision suite. 01 section 13.2 draws
 * scenarios "from the shipped corpus (from the 24-excerpt fixture corpus until P5 delivers)"; the 300-scenario set of
 * P3 stays on the fixture corpus, so its numbers remain comparable with the wave 2 and 3 gates, while the injected-error
 * recipes need the shipped corpus's breadth (the fixture corpus has no excerpt with three dotted eighth-sixteenth
 * figures, for example). Only served levels are used (L3 to L6 in corpus c1; BUILD-NOTES wave 3). Node only.
 */
import { readFileSync } from 'node:fs';
import { createRng } from '../../core/rng.ts';
import type { CorpusIndex, ExcerptChunk, ExcerptDoc, Rng, TestkitTimbre } from '../../core/types.ts';
import { plan as fitPlan } from '../../../fixtures/follow/gen/expected.ts';
import {
  buildBase,
  clipTempo,
  drawConditions,
  drawPerturbation,
  scenarioConfigs,
  scenarioSeed,
  SCENARIO_INSTRUMENTS,
  tempoRange,
  timelineFor,
  type PerturbOptions,
  type ScenarioBase,
  type ScenarioPlan,
} from '../scenarios/index.ts';

const CORPUS = new URL('../../../public/corpus/v1/', import.meta.url);
export const SERVED_LEVELS: readonly number[] = [3, 4, 5, 6];

let docs: ExcerptDoc[] | null = null;
export function shippedDocs(): ExcerptDoc[] {
  if (docs) return docs;
  const index = JSON.parse(readFileSync(new URL('index.json', CORPUS), 'utf8')) as CorpusIndex;
  docs = index.chunks
    .flatMap((c) => (JSON.parse(readFileSync(new URL(c.file, CORPUS), 'utf8')) as ExcerptChunk).excerpts)
    .filter((d) => SERVED_LEVELS.includes(d.level))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return docs;
}

const fitting = new Map<string, ExcerptDoc[]>();
function fittingShipped(instrumentId: string): ExcerptDoc[] {
  let xs = fitting.get(instrumentId);
  if (!xs) {
    const cfg = scenarioConfigs();
    const inst = cfg.instrumentById[instrumentId];
    xs = inst ? shippedDocs().filter((d) => fitPlan(d, inst, cfg.levels) !== null) : [];
    fitting.set(instrumentId, xs);
  }
  return xs;
}

const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[rng.int(0, xs.length)] as T;

/** As `planScenario`, with the excerpt drawn from the shipped corpus. Null when the drawn excerpt does not build. */
export function planShipped(seed: number, index: number, timbre: TestkitTimbre, perturb: PerturbOptions = {}): ScenarioPlan | null {
  const cfg = scenarioConfigs();
  const s = scenarioSeed(seed, index);
  const rng = createRng(s);
  const instrumentId = pick(rng, SCENARIO_INSTRUMENTS[timbre]);
  const pool = fittingShipped(instrumentId);
  if (pool.length === 0) return null;
  const doc = pick(rng, pool);
  const [lo, hi] = tempoRange(doc, cfg);
  const drawn = rng.int(Math.round(lo), Math.round(hi) + 1);
  const at60 = buildBase(doc, instrumentId, 60, cfg);
  if (!at60) return null;
  const bpm = clipTempo(at60.expected, at60.inst, drawn, cfg);
  const base = buildBase(doc, instrumentId, bpm, cfg) as ScenarioBase | null;
  if (!base || base.expected.length < 4) return null;
  const perturbation = drawPerturbation(base.expected, base.beatsPerBar, bpm, base.inst, rng, perturb);
  const cond = drawConditions(timbre, rng);
  return { id: `${index}:${base.excerptId}:${instrumentId}@${bpm}`, index, seed: s, base, perturbation, ...cond, timeline: timelineFor(base) };
}
