/**
 * Corpus-driven scenario generator (01 section 13.2): 300 scenarios drawn with a fixed seed from the fixture corpus,
 * covering its real rhythms and ranges, with random perturbations and random realism conditions.
 *
 * Lazy and deterministic: a set holds only its seed. `plan(i)` draws scenario i from its own generator seeded by
 * hash(seed, i), so any scenario can be built alone, in any order, and is the same every time; plans are cached
 * (they are small). Audio is rendered only by `render`, never cached.
 *
 * Coverage: scenario i uses timbre i mod 9 (flute, clarinet, sax, trumpet, violin, cello, voice, piano, tuba), so
 * every launch timbre gets 33 or 34 of 300 and tuba the rest. The excerpt is any fixture-corpus excerpt that fits
 * the instrument, the tempo is drawn from the level's range met with the excerpt's and clipped to the 01 section 8.3
 * IOI floors.
 *
 * Time line of a render (seconds of audio): `leadInSec` of silence, the count-in (levels.json countInBars), then
 * score time 0 (bar 1 beat 1) at `t0Sec`; clicks every beat to the end of the take (R14: one beat after the last
 * note's written end). Truth onsets are in audio seconds; `scoreOnsetSec = onsetSec - t0Sec`.
 */
import { createRng } from '../../core/rng.ts';
import type { Rng, TestkitTimbre } from '../../core/types.ts';
import { endOfTakeSec, perform, type Played, type Truth } from '../../../fixtures/follow/gen/perform.ts';
import { applyConditions, vibratoCondition, type CaptureConditions, type CaptureRender, type PerformanceConditions } from '../synth/conditions.ts';
import { renderPerformance, type OnsetRule, type SynthNoteSpec } from '../synth/render.ts';
import { TIMBRE_IDS, TIMBRES } from '../synth/timbres.ts';
import type { SynthClickTimbre } from '../synth-min.ts';
import { buildBase, clipTempo, fittingDocs, scenarioConfigs, SCENARIO_INSTRUMENTS, tempoRange, type ScenarioBase } from './corpus.ts';
import { drawPerturbation, type PerturbationPlan, type PerturbOptions } from './perturb.ts';

export const DEFAULT_SCENARIO_SEED = 0x5c3a_7e01;
export const DEFAULT_SCENARIO_COUNT = 300;
export const RENDER_RATE = 48000;

export interface ClickPlan {
  timbre: SynthClickTimbre;
  /** Bleed into the mic, dB (-20 or -10); null = headphones (no bleed). */
  bleedDb: number | null;
}

export interface ScenarioTimeline {
  leadInSec: number;
  countInBeats: number;
  beatSec: number;
  /** Audio time of score time 0 (bar 1 beat 1). */
  t0Sec: number;
  /** Score seconds of the end of take (R14). */
  endScoreSec: number;
  durationSec: number;
}

export interface ScenarioPlan {
  id: string;
  index: number;
  /** Seed of this scenario's own generator. */
  seed: number;
  base: ScenarioBase;
  perturbation: PerturbationPlan;
  performance: PerformanceConditions & { ampJitter: number };
  click: ClickPlan;
  /** Capture conditions without the click list (filled in at render time from the timeline). */
  capture: Omit<CaptureConditions, 'clickBleed'>;
  timeline: ScenarioTimeline;
}

export interface ScenarioTruthNote {
  playedIdx: number;
  truth: Truth;
  /** 7.4 onset, audio seconds. */
  onsetSec: number;
  scoreOnsetSec: number;
  offsetSec: number;
  midi: number;
  cents: number;
  freqHz: number;
  onsetRule: OnsetRule;
  onsetCause: 'from-silence' | 'repeat' | 'pitch-change';
  detectable: boolean;
}

export interface ScenarioRender {
  plan: ScenarioPlan;
  samples: Float32Array;
  sampleRate: number;
  t0Sec: number;
  /** Every scheduled click (count-in and take), audio seconds, with accents. */
  clicks: { t: number; accent: boolean }[];
  /** Clicks actually mixed in as bleed (empty with headphones). */
  bleedClickTimes: number[];
  played: Played[];
  truth: ScenarioTruthNote[];
  capture: CaptureRender;
}

export interface RenderOverrides {
  /**
   * Rate of the dry render, Hz (default `RENDER_RATE`). The gates on the resampled path
   * (tools/native/gates-resampled.ts) render at the capture device's own rate and set `capture.captureRateHz` to it.
   */
  renderRateHz?: number;
  capture?: Partial<CaptureConditions>;
  performance?: Partial<PerformanceConditions>;
  click?: Partial<ClickPlan>;
}

export interface ScenarioSet {
  readonly seed: number;
  readonly count: number;
  plan(i: number): ScenarioPlan;
  plans(): IterableIterator<ScenarioPlan>;
  render(i: number, o?: RenderOverrides): ScenarioRender;
}

/** 32-bit mix of (seed, index) (murmur3 finaliser). */
export function scenarioSeed(seed: number, index: number): number {
  let h = (Math.trunc(seed) ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[rng.int(0, xs.length)] as T;
const uniform = (rng: Rng, a: number, b: number): number => a + (b - a) * rng.next();
const r3 = (x: number): number => Math.round(x * 1000) / 1000;

export function drawConditions(timbre: TestkitTimbre, rng: Rng): Pick<ScenarioPlan, 'performance' | 'click' | 'capture'> {
  const T = TIMBRES[timbre];
  const click: ClickPlan = { timbre: rng.next() < 0.5 ? 'tick' : 'wood', bleedDb: pick(rng, [null, -20, -20, -10, -10]) };
  const capture: ScenarioPlan['capture'] = {
    phoneMic: rng.next() < 0.3 ? null : { highPassHz: rng.next() < 0.5 ? 100 : 150 },
    room: rng.next() < 0.3 ? null : { rt60Sec: r3(uniform(rng, 0.2, 0.8)), drrDb: r3(uniform(rng, 3, 10)) },
    agc: rng.next() < 0.3 ? { releaseSec: r3(uniform(rng, 0.3, 1.2)) } : null,
    captureRateHz: pick(rng, [48000, 48000, 24000, 16000]),
    noiseDbfs: pick(rng, [null, -50, -50, -45, -45]),
    seed: rng.int(1, 0x7fffffff),
  };
  const performance: ScenarioPlan['performance'] = { ampJitter: r3(uniform(rng, 0, 0.2)) };
  if (T.softAttack) performance.softAttackSec = rng.next() < 0.5 ? r3(uniform(rng, 0.03, 0.08)) : null;
  // Absent keys mean the timbre default (vibrato for strings and voice, breath for winds and voice).
  if (T.vibrato) {
    if (rng.next() < 0.6) performance.vibrato = vibratoCondition(r3(uniform(rng, 5, 6)), r3(uniform(rng, 15, 30)), timbre);
  } else if (timbre === 'flute') {
    performance.vibrato = rng.next() < 0.3 ? vibratoCondition(r3(uniform(rng, 4.8, 5.8)), r3(uniform(rng, 8, 15)), timbre) : null;
  }
  if (T.breath) {
    const b = rng.int(0, 4);
    if (b === 2) performance.breathDb = null;
    else if (b === 3) performance.breathDb = T.breath.db + 6;
  }
  return { performance, click, capture };
}

/** Plan scenario `index` of the set with `seed`. */
export function planScenario(seed: number, index: number, opts: { perturb?: PerturbOptions; timbre?: TestkitTimbre } = {}): ScenarioPlan {
  const cfg = scenarioConfigs();
  const s = scenarioSeed(seed, index);
  const rng = createRng(s);
  const timbre = opts.timbre ?? (TIMBRE_IDS[index % TIMBRE_IDS.length] as TestkitTimbre);
  const instrumentId = pick(rng, SCENARIO_INSTRUMENTS[timbre]);
  const docs = fittingDocs(instrumentId, cfg);
  if (docs.length === 0) throw new Error(`no fixture excerpt fits ${instrumentId}`);
  const doc = pick(rng, docs);
  const [lo, hi] = tempoRange(doc, cfg);
  const drawn = rng.int(Math.round(lo), Math.round(hi) + 1);
  const at60 = buildBase(doc, instrumentId, 60, cfg) as ScenarioBase;
  const bpm = clipTempo(at60.expected, at60.inst, drawn, cfg);
  const base = buildBase(doc, instrumentId, bpm, cfg) as ScenarioBase;
  const perturbation = drawPerturbation(base.expected, base.beatsPerBar, bpm, base.inst, rng, opts.perturb);
  const cond = drawConditions(timbre, rng);
  return { id: `${index}:${base.excerptId}:${instrumentId}@${bpm}`, index, seed: s, base, perturbation, ...cond, timeline: timelineFor(base) };
}

export function timelineFor(base: ScenarioBase): ScenarioTimeline {
  const cfg = scenarioConfigs();
  const beatSec = 60 / base.bpm;
  const bars = cfg.levelByNumber[base.level]?.countInBars ?? 1;
  const countInBeats = bars * base.beatsPerBar;
  const leadInSec = 0.5;
  const t0Sec = leadInSec + countInBeats * beatSec;
  const endScoreSec = endOfTakeSec(base.expected, base.bpm, cfg);
  return { leadInSec, countInBeats, beatSec, t0Sec, endScoreSec, durationSec: t0Sec + endScoreSec + 0.6 };
}

/** Every scheduled click: count-in and take, one per beat, accents on downbeats. */
export function scheduledClicks(tl: ScenarioTimeline, beatsPerBar: number): { t: number; accent: boolean }[] {
  const out: { t: number; accent: boolean }[] = [];
  const lastBeat = Math.floor(tl.endScoreSec / tl.beatSec + 1e-9);
  for (let b = -tl.countInBeats; b <= lastBeat; b++) {
    out.push({ t: tl.t0Sec + b * tl.beatSec, accent: ((b % beatsPerBar) + beatsPerBar) % beatsPerBar === 0 });
  }
  return out;
}

/** Render a planned scenario. Pure function of the plan and overrides. */
export function renderScenario(plan: ScenarioPlan, o: RenderOverrides = {}): ScenarioRender {
  const { base, timeline: tl } = plan;
  const perf: PerformanceConditions & { ampJitter: number } = { ...plan.performance, ...o.performance };
  const click: ClickPlan = { ...plan.click, ...o.click };
  const played = perform(base.expected, base.beatsPerBar, base.bpm, plan.perturbation.spec);
  const rng = createRng(plan.seed ^ 0x2545f491);
  const timbre = base.timbre;
  const softAttack = TIMBRES[timbre].softAttack && perf.softAttackSec ? perf.softAttackSec : null;
  const notes: SynthNoteSpec[] = played.map((p, k) => {
    const midi = Math.round(p.midi);
    const n: SynthNoteSpec = {
      midi,
      cents: Math.round((p.midi - midi) * 100 * 1000) / 1000,
      onsetSec: tl.t0Sec + p.onset,
      durSec: Math.max(0.02, p.dur),
      amp: 1 - perf.ampJitter * rng.next(),
      slur: p.legato,
      ref: k,
    };
    if (softAttack) n.attackSec = Math.max(0.03, Math.min(0.08, softAttack + (rng.next() - 0.5) * 0.02));
    return n;
  });
  const dry = renderPerformance({
    timbre,
    notes,
    sampleRate: o.renderRateHz ?? RENDER_RATE,
    durationSec: tl.durationSec + (plan.capture.room ? Math.min(1.2, plan.capture.room.rt60Sec) : 0),
    ...(perf.vibrato !== undefined ? { vibrato: perf.vibrato } : {}),
    ...(perf.breathDb !== undefined ? { breathDb: perf.breathDb } : {}),
    seed: plan.seed,
  });
  const clicks = scheduledClicks(tl, base.beatsPerBar);
  const cond: CaptureConditions = {
    ...plan.capture,
    clickBleed: click.bleedDb === null ? null : { clicks, timbre: click.timbre, bleedDb: click.bleedDb },
    ...o.capture,
  };
  const capture = applyConditions(dry, cond);
  const byRef = new Map(dry.truth.map((t) => [t.ref, t]));
  const truth: ScenarioTruthNote[] = played.map((p, k) => {
    const t = byRef.get(k);
    if (!t) throw new Error(`renderScenario: no truth for played note ${k}`);
    return {
      playedIdx: k,
      truth: p.truth,
      onsetSec: t.onsetSec,
      scoreOnsetSec: t.onsetSec - tl.t0Sec,
      offsetSec: t.offsetSec,
      midi: t.midi,
      cents: t.cents,
      freqHz: t.freqHz,
      onsetRule: t.onsetRule,
      onsetCause: t.onsetCause,
      detectable: t.detectable,
    };
  });
  return {
    plan,
    samples: capture.samples,
    sampleRate: capture.sampleRate,
    t0Sec: tl.t0Sec,
    clicks,
    bleedClickTimes: capture.clickTimes,
    played,
    truth,
    capture,
  };
}

/** A lazily generated, seed-deterministic scenario set (default: 300 scenarios, fixed seed). */
export function createScenarioSet(opts: { seed?: number; count?: number; perturb?: PerturbOptions } = {}): ScenarioSet {
  const seed = opts.seed ?? DEFAULT_SCENARIO_SEED;
  const count = opts.count ?? DEFAULT_SCENARIO_COUNT;
  const cache = new Map<number, ScenarioPlan>();
  const plan = (i: number): ScenarioPlan => {
    if (!Number.isInteger(i) || i < 0 || i >= count) throw new RangeError(`scenario index ${i} outside 0..${count - 1}`);
    let p = cache.get(i);
    if (!p) {
      p = planScenario(seed, i, opts.perturb ? { perturb: opts.perturb } : {});
      cache.set(i, p);
    }
    return p;
  };
  return {
    seed,
    count,
    plan,
    *plans() {
      for (let i = 0; i < count; i++) yield plan(i);
    },
    render: (i, o) => renderScenario(plan(i), o),
  };
}
