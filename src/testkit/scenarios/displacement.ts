/**
 * Randomized renders of the four golden displacement cases (01 section 13.2: "stop at bar 5, back 2 beats, skip a
 * bar ahead, rejoin on the next downbeat produce the expected segments in >= 95% of randomized renders").
 *
 * Each case is the exact perturbation of its follow fixture (fixtures/follow/gen/follow-scenarios.ts: Le Beau,
 * flute, 90 bpm) with a fresh jitter and cents pattern, held fraction, amplitude jitter and realism conditions per
 * render. Click bleed and the phone mic are always on, since the 13.2 gates are stated under both.
 */
import { createRng } from '../../core/rng.ts';
import type { ExpectedNote } from '../../core/types.ts';
import type { NoteMod, PerformSpec, ReplaySpec } from '../../../fixtures/follow/gen/perform.ts';
import { gauss } from '../synth/dsp-util.ts';
import { buildBase, fixtureDocs, scenarioConfigs, type ScenarioBase } from './corpus.ts';
import { drawConditions, scenarioSeed, timelineFor, type ScenarioPlan } from './generator.ts';
import type { ExpectedNoteTruth, ExpectedSegment, PerturbationPlan, StructuralKind } from './perturb.ts';

export const GOLDEN_EXCERPT = 'le-beau-lc5883655-voice-mp1-9';
export type GoldenCase = 'stop-bar-5' | 'back-2-beats' | 'skip-bar-ahead' | 'rejoin-next-downbeat';
export const GOLDEN_CASES: readonly GoldenCase[] = ['stop-bar-5', 'back-2-beats', 'skip-bar-ahead', 'rejoin-next-downbeat'];

const range = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** The fixtures' omissions and replays, and the segments the final alignment must produce. */
export const GOLDEN_SPECS: Readonly<Record<GoldenCase, { omit: number[]; replays: ReplaySpec[]; displaced: ExpectedSegment[]; kind: StructuralKind }>> = {
  'stop-bar-5': { omit: range(17, 25), replays: [], displaced: [], kind: 'stop' },
  'back-2-beats': { omit: range(24, 31), replays: [{ from: 22, to: 27, offsetBeats: -2 }], displaced: [{ fromIdx: 22, toIdx: 27, offsetBeats: -2 }], kind: 'restart' },
  'skip-bar-ahead': { omit: range(3, 7), replays: [{ from: 8, to: 12, offsetBeats: 4 }], displaced: [{ fromIdx: 8, toIdx: 12, offsetBeats: 4 }], kind: 'skip' },
  'rejoin-next-downbeat': { omit: range(11, 14), replays: [], displaced: [], kind: 'rejoin' },
};

let baseCache: ScenarioBase | null = null;
function goldenBase(): ScenarioBase {
  if (baseCache) return baseCache;
  const d = fixtureDocs().find((x) => x.id === GOLDEN_EXCERPT);
  if (!d) throw new Error(`fixture corpus has no ${GOLDEN_EXCERPT}`);
  const b = buildBase(d, 'flute', 90, scenarioConfigs());
  if (!b) throw new Error(`${GOLDEN_EXCERPT} does not fit flute`);
  baseCache = b;
  return b;
}

/** Plan randomized render `r` of a golden case. Deterministic in (seed, case, r). */
export function planGoldenDisplacement(c: GoldenCase, r: number, seed = 0x601d): ScenarioPlan {
  const base = goldenBase();
  const g = GOLDEN_SPECS[c];
  const s = scenarioSeed(seed ^ (GOLDEN_CASES.indexOf(c) * 0x1000193), r);
  const rng = createRng(s);
  const n = base.expected.length;
  const jitterMs = Array.from({ length: n }, () => Math.round(Math.max(-20, Math.min(20, 6 * gauss(rng))) * 10) / 10);
  const centsPattern = Array.from({ length: n }, () => Math.round(Math.max(-7, Math.min(7, 3 * gauss(rng))) * 10) / 10);
  const heldFrac = Math.round((0.82 + 0.18 * rng.next()) * 100) / 100;
  const mods: Record<number, NoteMod> = Object.fromEntries(g.omit.map((i) => [i, { omit: true }]));
  const spec: PerformSpec = { jitterMs, centsPattern, heldFrac, mods, ...(g.replays.length ? { replays: g.replays } : {}) };
  const notes: ExpectedNoteTruth[] = base.expected.map((x: ExpectedNote) => {
    const omitted = g.omit.includes(x.idx);
    return {
      idx: x.idx,
      played: !omitted,
      omitReason: omitted ? g.kind : null,
      shiftMs: 0,
      jitterMs: jitterMs[x.idx] as number,
      cents: centsPattern[x.idx] as number,
      semis: 0,
      octaves: 0,
      errors: omitted ? [g.kind] : [],
    };
  });
  const perturbation: PerturbationPlan = { spec, kinds: ['timing', 'cents', g.kind], structural: g.kind, notes, displaced: g.displaced, extras: [] };
  const cond = drawConditions('flute', rng);
  if (cond.click.bleedDb === null) cond.click.bleedDb = -20;
  if (!cond.capture.phoneMic) cond.capture.phoneMic = { highPassHz: 100 };
  return { id: `golden:${c}:${r}`, index: r, seed: s, base, perturbation, ...cond, timeline: timelineFor(base) };
}
