/**
 * One synthetic take through the production analysis path (P18, 01 section 13.2).
 *
 * A rendered scenario (P3) is cut into capture blocks with the production decimator and high-band primitives (as the
 * worklet and FakeAudioBackend do), and the blocks go to the real DSP worker core (`DspWorkerCore`: DspPipeline with
 * click handling, LiveFollower, `alignFinalWithReference`), exactly as the app's worker receives them in relay mode.
 * The worker's replies are then graded with `gradeWithPatterns`, as the session does.
 *
 * Time line: audio seconds of the render (0 = first sample). The follower's `t0` is the render's score origin and the
 * round-trip latency is 0 (the render has no output path), as in the wave 2 end-to-end test.
 *
 * Output mode: a scenario with click bleed is a speaker take (template subtraction and the time gate on, with a click
 * template from a simulated loopback calibration in the same capture conditions); without bleed it is a headphone take.
 */
import type { CaptureBlock, WorkerMessage, WorkerReply } from '../../core/platform.ts';
import type { AttemptScore, ClockSeconds, Configs, DetectedNote, DspConfig, FinalAlignment, FollowConfig, FollowerEvent, GradeInput, ResolvedTolerance } from '../../core/types.ts';
import { PhaseDecimator } from '../../dsp/decimator.ts';
import { HiBandEnergy } from '../../dsp/hiband.ts';
import { buildClickTemplate } from '../../dsp/click.ts';
import { gradeWithPatterns } from '../../grade/index.ts';
import { DspWorkerCore } from '../../platform/web/audio/dsp-worker-core.ts';
import { resolveTolerances } from '../../rules/index.ts';
import { scenarioConfigs, type ScenarioBase, type ScenarioRender } from '../scenarios/index.ts';
import { applyConditions, type CaptureConditions, type SynthRender } from '../synth/index.ts';
import type { SynthClickTimbre } from '../synth-min.ts';

/** Capture block size in input frames (the worklet posts 2 render quanta; the offline runner uses the same). */
export const GATE_BLOCK_FRAMES = 256;

/** A follower event with the input time of the block whose analysis produced it. */
export interface TimedEvent {
  t: number;
  event: FollowerEvent;
}

export interface TakeRun {
  base: ScenarioBase;
  config: FollowConfig;
  tolerances: ResolvedTolerance[];
  outputMode: DspConfig['outputMode'];
  /** Every follower event in order, stamped with the analysed block's end time (input seconds). */
  live: TimedEvent[];
  detected: DetectedNote[];
  alignment: FinalAlignment;
  voiceReference: GradeInput['voiceReference'];
  signal: GradeInput['signal'];
  score: AttemptScore;
  /** Per-block analysis cost, ms (worker telemetry). */
  hopP95Ms: number | null;
}

const silence = (sec: number, levelDb: number): SynthRender => {
  const sr = 48000;
  return { samples: new Float32Array(Math.round(sec * sr)), sampleRate: sr, truth: [], envelope: { startT: 0, hopSec: 0.002, values: [] }, floorDb: -120, levelDb, pitchAt: () => null };
};

function decimate(samples: Float32Array, inputRate: number): { low: Float32Array; rate: number } {
  const dec = new PhaseDecimator(inputRate);
  const low = new Float32Array(Math.ceil(samples.length / dec.factor) + 4);
  const n = dec.process(samples, low, 0);
  return { low: low.slice(0, n), rate: dec.analysisRate };
}

/**
 * The click template a loopback calibration would store for this route (P14: 8 clicks, every other one accented,
 * averaged with buildClickTemplate), measured in the take's capture conditions without the instrument. Noise and AGC
 * are left out, as the calibration averages them away (the P4d acceptance suite does the same).
 */
export function calibrationTemplate(cond: CaptureConditions, timbre: SynthClickTimbre, bleedDb: number): Float32Array {
  const clicks = Array.from({ length: 8 }, (_, k) => ({ t: 0.5 + 0.5 * k, accent: k % 2 === 0 }));
  const cap = applyConditions(silence(5, -18), { ...cond, noiseDbfs: null, agc: null, clickBleed: { clicks, timbre, bleedDb } });
  const { low, rate } = decimate(cap.samples, cap.sampleRate);
  return buildClickTemplate(low, 0, rate, clicks.map((c) => ({ arrival: c.t, accent: c.accent })));
}

/** DspConfig as the session builds it (src/session/take-plan.ts dspConfigFor), with RTL 0. */
export function gateDspConfig(r: ScenarioRender, tolerances: readonly ResolvedTolerance[], analysisRate: number, cfg: Configs): DspConfig {
  const { base } = r.plan;
  const d = base.inst.detection;
  const cond = r.capture.conditions;
  const bleed = cond.clickBleed ?? null;
  const speakers = bleed !== null;
  const repeatHints: DspConfig['repeatHints'] = [];
  base.expected.forEach((e, i) => {
    if (e.onsetKind !== 'repeat') return;
    repeatHints.push({ t: (r.t0Sec + e.onsetSec) as ClockSeconds, halfWidthSec: (tolerances[i] as ResolvedTolerance).matchWindowSec });
  });
  let clickTemplate: Float32Array | null = null;
  if (bleed) {
    const tpl = calibrationTemplate(cond, bleed.timbre, bleed.bleedDb);
    // The calibration runs at the device rate, so its template has the take's analysis rate.
    clickTemplate = tpl;
  }
  return {
    analysisRate,
    windowSamples: d.windowSamples,
    hopSamples: 128,
    minHz: d.minHz,
    maxHz: d.maxHz,
    a4Hz: 440,
    clarityThreshold: d.clarityThreshold,
    changeCents: d.changeCents,
    onsetProfile: d.onsetProfile,
    vibratoClass: d.vibratoClass,
    outputMode: speakers ? 'speakers' : 'wired',
    clicks: speakers ? r.clicks.map((c) => ({ arrival: c.t as ClockSeconds, accent: c.accent })) : [],
    clickTemplate,
    repeatHints,
    attackExcludeMs: cfg.grading.intonation.attackExcludeMsByFamily[base.inst.family],
    clickLeakDb: null,
  };
}

/** Cut a capture into contiguous capture blocks (production decimator phase carry and high-band sub-blocks). */
export function* captureBlocks(samples: Float32Array, inputRate: number, frames = GATE_BLOCK_FRAMES): Generator<CaptureBlock> {
  const dec = new PhaseDecimator(inputRate);
  const hi = new HiBandEnergy(inputRate);
  const low = new Float32Array(Math.ceil(frames / dec.factor) + 2);
  const hiBuf = new Float32Array(hi.maxSubBlocks(frames));
  let seq = 0;
  for (let i = 0; i < samples.length; i += frames) {
    const chunk = samples.subarray(i, Math.min(samples.length, i + frames));
    const startT = dec.nextOutputInputPos / inputRate;
    const nLow = dec.process(chunk, low, 0);
    const nHi = hi.process(chunk, hiBuf, 0);
    if (nLow === 0) continue;
    yield { v: 1, startT: startT as ClockSeconds, lowband: low.slice(0, nLow), hiEnergy: hiBuf.slice(0, nHi), analysisRate: dec.analysisRate, seq: seq++ };
  }
}

export interface RunTakeOptions {
  /** Tuning-note offset for winds, brass and strings (default: no tuning note). */
  tuningCents?: number | null;
}

/** Run one rendered scenario through the DSP worker core, the final alignment and the grader. */
export function runTake(r: ScenarioRender, o: RunTakeOptions = {}): TakeRun {
  const cfg = scenarioConfigs();
  const base = r.plan.base;
  const analysisRate = new PhaseDecimator(r.sampleRate).analysisRate;
  const tolerances = resolveTolerances(base.expected, { instrument: base.inst, level: base.level, bpm: base.bpm, meter: base.meter }, cfg);
  const dspCfg = gateDspConfig(r, tolerances, analysisRate, cfg);
  const tuning = base.inst.family !== 'voice' && base.inst.pitchKind === 'continuous' ? { used: o.tuningCents != null, offsetCents: o.tuningCents ?? 0 } : null;
  const config: FollowConfig = {
    expected: base.expected,
    tolerances,
    t0: r.t0Sec as ClockSeconds,
    latencyCompensationSec: 0,
    bpm: base.bpm,
    beatsPerBar: base.beatsPerBar,
    instrument: base.inst,
    cfg,
    voiceReferenceCents: tuning?.offsetCents ?? 0,
    analysisRate,
    writtenKey: base.writtenKey,
  };

  const live: TimedEvent[] = [];
  let done: Extract<WorkerReply, { type: 'done' }> | null = null;
  let error: string | null = null;
  let now = 0;
  const core = new DspWorkerCore({
    post: (reply) => {
      if (reply.type === 'events') for (const event of reply.events) live.push({ t: now, event });
      else if (reply.type === 'done') done = reply;
      else if (reply.type === 'error') error = reply.message;
    },
    nowMs: () => performance.now(),
    setTimer: () => () => {},
  });
  const send = (m: WorkerMessage): void => core.onMessage(m);
  send({ v: 1, type: 'config', cfg: dspCfg, follow: config });
  // R14: the take ends one beat after the last note's written end.
  const endT = r.t0Sec + r.plan.timeline.endScoreSec;
  for (const block of captureBlocks(r.samples, r.sampleRate)) {
    if ((block.startT as number) >= endT) break;
    now = (block.startT as number) + block.lowband.length / block.analysisRate;
    send({ v: 1, type: 'block', block });
  }
  now = endT;
  send({ v: 1, type: 'end', t: endT as ClockSeconds, reason: 'complete' });
  if (error) throw new Error(`DSP worker error: ${error}`);
  const d = done as Extract<WorkerReply, { type: 'done' }> | null;
  if (!d || !core.alignment) throw new Error('DSP worker did not finish the take');
  const alignment = core.alignment;

  const input: GradeInput = {
    expected: base.expected,
    tolerances,
    alignment,
    detected: d.detected,
    instrument: base.inst,
    level: base.level,
    bpm: base.bpm,
    meter: base.meter,
    writtenKey: base.writtenKey,
    cfg,
    tuning,
    voiceReference: d.voiceReference,
    signal: d.signal,
    calibrationMeasured: true,
    ranking: { mode: 'ranked', seenBefore: false, scanStrict: true, familiarity: 0, skipLimitHit: false, metronome: 'audible', gateFailures: [] },
    xp: { playerLevel: base.level, randomized: { key: false, meter: false, tempo: false }, streakDays: 0, dailyCountBefore: 0, repeatIndexToday: 0, placement: false },
  };
  return {
    base,
    config,
    tolerances,
    outputMode: dspCfg.outputMode,
    live,
    detected: d.detected,
    alignment,
    voiceReference: d.voiceReference,
    signal: d.signal,
    score: gradeWithPatterns(input),
    hopP95Ms: d.stats.hopP95Ms,
  };
}
