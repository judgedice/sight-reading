/**
 * The untrained-voice condition (round 2 detection): plans, renders and measures takes sung by the untrained-voice
 * performer model (`voice.ts`) through the production analysis path (`runTake`: the DSP worker core, the live
 * follower and the final alignment), on a laptop: built-in mic and speakers (click bleed at -20 dB with template
 * subtraction), low level, noise floor.
 *
 * Scenarios come from the shipped corpus at difficulties 1 to 5, mostly for the low voices (the owner is a baritone).
 * Every written note is sung once, on pitch (within 20 c), so every extra, wrong-pitch and missed verdict is false.
 *
 * Metrics per take (counts, so takes sum):
 * - `extrasFinal`: final extras; `extraGhosts`: extra ghosts drawn live (what the owner saw on the staff);
 * - `wrongFinal`: final wrong-pitch verdicts (for voice an octave is correct, R7); `wrongLive`: notes shown wrong
 *   pitch live at any time;
 * - `missedFinal`: final missed; `detected`: detected notes (segmentation: one sung note should be one note);
 * - `octaveFinal`: matched notes read an octave off (correct for voice, R7; a sign of octave errors on low notes).
 *
 * Node only (reads the shipped corpus).
 */
import { readFileSync } from 'node:fs';
import { createRng } from '../../core/rng.ts';
import type { CorpusIndex, ExcerptChunk, ExcerptDoc, Rng } from '../../core/types.ts';
import { plan as fitPlan } from '../../../fixtures/follow/gen/expected.ts';
import { buildBase, clipTempo, scenarioConfigs, scenarioSeed, scheduledClicks, tempoRange, timelineFor, type ScenarioBase, type ScenarioPlan, type ScenarioRender, type ScenarioTimeline } from '../scenarios/index.ts';
import { applyConditions, type CaptureConditions } from '../synth/conditions.ts';
import { runTake, type TakeRun } from '../gates/run-take.ts';
import { planUntrainedVoice, renderUntrainedVoice, type UntrainedVoiceTake } from './voice.ts';

export const UNTRAINED_SEED = 0x0b_a5_51_70;
/** Voice types drawn, weighted towards the low voices. */
export const UNTRAINED_VOICES: readonly string[] = ['voice-baritone', 'voice-baritone', 'voice-bass', 'voice-baritone', 'voice-tenor', 'voice-alto', 'voice-soprano', 'voice-mezzo'];
export const UNTRAINED_MAX_LEVEL = 5;
export const UNTRAINED_BLEED_DB = -20;

const CORPUS = new URL('../../../public/corpus/v1/', import.meta.url);
let allDocs: ExcerptDoc[] | null = null;
function shippedAll(): ExcerptDoc[] {
  if (allDocs) return allDocs;
  const index = JSON.parse(readFileSync(new URL('index.json', CORPUS), 'utf8')) as CorpusIndex;
  allDocs = index.chunks
    .flatMap((c) => (JSON.parse(readFileSync(new URL(c.file, CORPUS), 'utf8')) as ExcerptChunk).excerpts)
    .filter((d) => d.level <= UNTRAINED_MAX_LEVEL)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return allDocs;
}

const fitting = new Map<string, ExcerptDoc[]>();
function pool(instrumentId: string): ExcerptDoc[] {
  let xs = fitting.get(instrumentId);
  if (!xs) {
    const cfg = scenarioConfigs();
    const inst = cfg.instrumentById[instrumentId];
    xs = inst ? shippedAll().filter((d) => fitPlan(d, inst, cfg.levels) !== null) : [];
    fitting.set(instrumentId, xs);
  }
  return xs;
}

const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[rng.int(0, xs.length)] as T;

export interface UntrainedPlan {
  id: string;
  index: number;
  base: ScenarioBase;
  timeline: ScenarioTimeline;
  take: UntrainedVoiceTake;
}

/** Plan untrained take `index` (null when the drawn excerpt does not build; the caller moves on). */
export function planUntrained(index: number, seed = UNTRAINED_SEED): UntrainedPlan | null {
  const cfg = scenarioConfigs();
  const s = scenarioSeed(seed, index);
  const rng = createRng(s);
  const instrumentId = pick(rng, UNTRAINED_VOICES);
  const docs = pool(instrumentId);
  if (docs.length === 0) return null;
  const doc = pick(rng, docs);
  const [lo, hi] = tempoRange(doc, cfg);
  const drawn = rng.int(Math.round(lo), Math.round(hi) + 1);
  const at60 = buildBase(doc, instrumentId, 60, cfg);
  if (!at60) return null;
  const bpm = clipTempo(at60.expected, at60.inst, drawn, cfg);
  const base = buildBase(doc, instrumentId, bpm, cfg);
  if (!base || base.expected.length < 4) return null;
  const timeline = timelineFor(base);
  const take = planUntrainedVoice(base.expected, timeline.t0Sec, bpm, rng.int(1, 0x7fffffff), base.inst.detection.minHz);
  return { id: `untrained:${index}:${base.excerptId}:${instrumentId}@${bpm}:L${base.level}`, index, base, timeline, take };
}

/** The first `count` plans that build, from index 0 on. */
export function untrainedPlans(count: number, seed = UNTRAINED_SEED): UntrainedPlan[] {
  const out: UntrainedPlan[] = [];
  for (let i = 0; out.length < count && i < count * 20; i++) {
    const p = planUntrained(i, seed);
    if (p) out.push(p);
  }
  return out;
}

/** Renders a plan as a speaker take on a laptop (click bleed, mic roll-off, noise) in the gate runner's shape. */
export function renderUntrained(p: UntrainedPlan): ScenarioRender {
  const tl = p.timeline;
  const dry = renderUntrainedVoice(p.take, tl.durationSec);
  const clicks = scheduledClicks(tl, p.base.beatsPerBar);
  const cond: CaptureConditions = { clickBleed: { clicks, timbre: 'tick', bleedDb: UNTRAINED_BLEED_DB }, phoneMic: null, room: null, agc: null, captureRateHz: 48000, noiseDbfs: null };
  const capture = applyConditions(
    { samples: dry, sampleRate: 48000, truth: [], envelope: { startT: 0, hopSec: 0.002, values: [] }, floorDb: -120, levelDb: p.take.levelDb, pitchAt: () => null },
    cond,
  );
  const plan = { id: p.id, index: p.index, seed: p.take.seed, base: p.base, timeline: tl, capture: cond } as unknown as ScenarioPlan;
  return { plan, samples: capture.samples, sampleRate: capture.sampleRate, t0Sec: tl.t0Sec, clicks, bleedClickTimes: capture.clickTimes, played: [], truth: [], capture };
}

export interface UntrainedRecord {
  id: string;
  instrumentId: string;
  level: number;
  notes: number;
  detected: number;
  extrasFinal: number;
  extraGhosts: number;
  wrongFinal: number;
  wrongLive: number;
  missedFinal: number;
  /** Matched notes read an octave off (correct for voice, R7, but a sign of the mic's fundamental roll-off). */
  octaveFinal: number;
  /** Up to 6 examples ("#idx verdict"), for the report. */
  examples: string[];
}

/** Measures one take of the untrained-voice condition. */
export function measureUntrained(p: UntrainedPlan, run: TakeRun = runTake(renderUntrained(p))): UntrainedRecord {
  const extraIds = new Set<number>();
  const wrongLive = new Set<number>();
  for (const { event } of run.live) {
    if (event.type === 'ghost' && event.ghost.kind === 'extra' && !event.ghost.displaced) extraIds.add(event.ghost.detectedId);
    if (event.type === 'judgment' && event.judgment.pitch === 'wrong-pitch') wrongLive.add(event.judgment.expectedIdx);
  }
  const js = run.alignment.judgments;
  const examples: string[] = [];
  for (const j of js) {
    if (examples.length >= 6) break;
    if (j.status === 'missed') examples.push(`#${j.expectedIdx} missed`);
    else if (j.pitch === 'wrong-pitch') examples.push(`#${j.expectedIdx} wrong pitch (${(j.centsError ?? 0).toFixed(0)} c)`);
  }
  for (const x of run.alignment.extras) if (examples.length < 6) examples.push(`extra at ${x.onsetSec.toFixed(2)} s, ${x.durSec.toFixed(2)} s long`);
  return {
    id: p.id,
    instrumentId: p.base.instrumentId,
    level: p.base.level,
    notes: p.base.expected.length,
    detected: run.detected.length,
    extrasFinal: run.alignment.extras.length,
    extraGhosts: extraIds.size,
    wrongFinal: js.filter((j) => j.status === 'matched' && j.pitch === 'wrong-pitch').length,
    wrongLive: wrongLive.size,
    missedFinal: js.filter((j) => j.status === 'missed').length,
    octaveFinal: js.filter((j) => j.status === 'matched' && j.octaveDisplaced).length,
    examples,
  };
}

export interface UntrainedSummary {
  takes: number;
  notes: number;
  /** Per written note. */
  detectedPerNote: number;
  extrasPerNote: number;
  extraGhostsPerNote: number;
  falseWrongPitch: number;
  falseWrongLive: number;
  falseMissed: number;
  octaveRate: number;
  /** Non-blocking gate: extra ghosts drawn per written note at most `UNTRAINED_GATE.extraGhostsPerNote`, etc. */
  pass: boolean;
}

/** Targets of the reported, non-blocking untrained-voice gate. */
export const UNTRAINED_GATE = { extraGhostsPerNote: 0.05, extrasPerNote: 0.05, falseWrongPitch: 0.03, falseMissed: 0.03 } as const;

export function summarizeUntrained(rs: readonly UntrainedRecord[]): UntrainedSummary {
  const sum = (f: (r: UntrainedRecord) => number): number => rs.reduce((s, r) => s + f(r), 0);
  const notes = Math.max(1, sum((r) => r.notes));
  const s = {
    takes: rs.length,
    notes: sum((r) => r.notes),
    detectedPerNote: sum((r) => r.detected) / notes,
    extrasPerNote: sum((r) => r.extrasFinal) / notes,
    extraGhostsPerNote: sum((r) => r.extraGhosts) / notes,
    falseWrongPitch: sum((r) => r.wrongFinal) / notes,
    falseWrongLive: sum((r) => r.wrongLive) / notes,
    falseMissed: sum((r) => r.missedFinal) / notes,
    octaveRate: sum((r) => r.octaveFinal) / notes,
  };
  const g = UNTRAINED_GATE;
  return { ...s, pass: s.extraGhostsPerNote <= g.extraGhostsPerNote && s.extrasPerNote <= g.extrasPerNote && s.falseWrongPitch <= g.falseWrongPitch && s.falseMissed <= g.falseMissed };
}
