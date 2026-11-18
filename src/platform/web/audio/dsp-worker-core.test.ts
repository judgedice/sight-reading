// DSP worker logic (S1): the capture-port protocol (CaptureReturn per block, blocks before 'config' queued), the
// 'events' / 'final' / 'done' replies, end ordering across ports, and the S1 take end to end on FakeAudioBackend
// against the reference wiring of src/testkit/e2e-pipeline.test.ts.
import { describe, expect, it } from 'vitest';
import type { CaptureBlock, CaptureReturn, MessagePortLike, WorkerMessage, WorkerReply } from '../../../core/platform.ts';
import type { ClockSeconds, DetectedNote, DspEvent, FinalAlignment, FollowerEvent, FollowStreamItem } from '../../../core/types.ts';
import { DspPipeline } from '../../../dsp/pipeline.ts';
import { LiveFollower, alignFinal, liveOutcomeOf } from '../../../follow/index.ts';
import { FakeAudioBackend } from '../../../testkit/fake-backend.ts';
import { finalDetected, liveSubject, runFollowStream } from '../../../testkit/predicates/index.ts';
import { SLICE, sliceConfigs, sliceDspConfig, sliceFollowConfig, sliceGrade, sliceTake, type SliceTake } from '../../../app/compose/slice-take.ts';
import { SLICE_EXTRA, SLICE_LATE_IDX, SLICE_OMIT_IDX, SLICE_WRONG_IDX, renderSlice } from '../../../../e2e/slice/slice-performance.ts';
import { decideRecheck, withRecheckSpec } from '../../../calibration/index.ts';
import { DspWorkerCore, copyBlock } from './dsp-worker-core.ts';

const cfg = sliceConfigs();
const RATE = 48000;
const LEAD = 1;

interface Harness {
  core: DspWorkerCore;
  replies: WorkerReply[];
  returns: CaptureReturn[];
  timers: (() => void)[];
  /** The port the backend posts blocks on (delivers into the core's capture handler). */
  port: MessagePortLike;
}

function harness(endWaitMs = 400): Harness {
  const replies: WorkerReply[] = [];
  const returns: CaptureReturn[] = [];
  const timers: (() => void)[] = [];
  let clock = 0;
  const core = new DspWorkerCore({
    post: (r) => replies.push(r),
    nowMs: () => (clock += 0.01),
    setTimer: (_ms, fn) => {
      timers.push(fn);
      return () => {
        const i = timers.indexOf(fn);
        if (i >= 0) timers.splice(i, 1);
      };
    },
    endWaitMs,
  });
  core.setCapturePort({ postMessage: (m) => returns.push(m) });
  const port: MessagePortLike = { postMessage: (m: unknown) => core.onCaptureMessage(m), close: () => undefined };
  return { core, replies, returns, timers, port };
}

const eventsOf = (replies: readonly WorkerReply[]): FollowerEvent[] => replies.flatMap((r) => (r.type === 'events' ? r.events : []));
const doneOf = (replies: readonly WorkerReply[]) => replies.find((r): r is Extract<WorkerReply, { type: 'done' }> => r.type === 'done');

function block(seq: number, startT: number, n = 85): CaptureBlock {
  const lowband = new Float32Array(n);
  for (let i = 0; i < n; i++) lowband[i] = 0.001 * Math.sin(i);
  return { v: 1, startT: startT as ClockSeconds, lowband, hiEnergy: new Float32Array(5), analysisRate: 16000, seq };
}

function configFor(take: SliceTake, analysisRate: number, t0: number): Extract<WorkerMessage, { type: 'config' }> {
  return {
    v: 1,
    type: 'config',
    cfg: sliceDspConfig(take, cfg, { analysisRate, outputMode: 'wired', clicks: [], rtlSec: 0 }),
    follow: sliceFollowConfig(take, cfg, { t0: t0 as ClockSeconds, rtlSec: 0, analysisRate }),
  };
}

describe('DspWorkerCore protocol', () => {
  const take = sliceTake(cfg);

  it('returns every port block at once (both buffers), queues blocks before config, then replies ready', () => {
    const h = harness();
    const b0 = block(0, 0);
    const b1 = block(1, 85 / 16000);
    h.port.postMessage({ v: 1, type: 'block', block: b0 });
    h.port.postMessage({ v: 1, type: 'block', block: b1 });
    expect(h.returns).toHaveLength(2);
    expect(h.returns[0]!.lowband).toBe(b0.lowband.buffer);
    expect(h.returns[0]!.hiEnergy).toBe(b0.hiEnergy.buffer);
    expect(h.returns[0]).toMatchObject({ v: 1, type: 'return' });
    expect(h.replies).toEqual([]);
    h.core.onMessage(configFor(take, 16000, 1));
    expect(h.replies[0]).toEqual({ v: 1, type: 'ready' });
    // The queued blocks were analysed: the follower's clock events reach the main thread.
    expect(eventsOf(h.replies).some((e) => e.type === 'clock' || e.type === 'level')).toBe(true);
  });

  it('copies blocks: zeroing the returned buffer does not change what was analysed', () => {
    const b = block(0, 0);
    const c = copyBlock(b);
    b.lowband.fill(0);
    expect(c.lowband[1]).toBeCloseTo(0.001 * Math.sin(1), 9);
    expect(c.lowband.buffer).not.toBe(b.lowband.buffer);
  });

  it("waits for the blocks up to the end time when 'end' overtakes them, then sends final events and done", () => {
    const h = harness();
    h.core.onMessage(configFor(take, 16000, 0.5));
    const per = 85 / 16000;
    for (let i = 0; i < 10; i++) h.port.postMessage({ v: 1, type: 'block', block: block(i, i * per) });
    const tEnd = 20 * per;
    h.core.onMessage({ v: 1, type: 'end', t: tEnd as ClockSeconds, reason: { reason: 'stopped' } });
    expect(doneOf(h.replies)).toBeUndefined();
    for (let i = 10; i < 20; i++) h.port.postMessage({ v: 1, type: 'block', block: block(i, i * per) });
    const done = doneOf(h.replies);
    expect(done).toBeDefined();
    const ev = eventsOf(h.replies);
    expect(ev[ev.length - 1]!.type).toBe('final');
    expect(ev.filter((e) => e.type === 'end')).toEqual([{ type: 'end', reason: 'stopped' }]);
    expect(h.replies[h.replies.length - 1]!.type).toBe('done');
    expect(h.timers).toHaveLength(0);
    // Blocks after the end are ignored.
    h.port.postMessage({ v: 1, type: 'block', block: block(20, tEnd) });
    expect(h.replies.filter((r) => r.type === 'done')).toHaveLength(1);
  });

  it('ends on the timeout when the last blocks never come', () => {
    const h = harness();
    h.core.onMessage(configFor(take, 16000, 0.5));
    h.port.postMessage({ v: 1, type: 'block', block: block(0, 0) });
    h.core.onMessage({ v: 1, type: 'end', t: 5 as ClockSeconds, reason: { reason: 'complete' } });
    expect(doneOf(h.replies)).toBeUndefined();
    expect(h.timers).toHaveLength(1);
    h.timers[0]!();
    expect(doneOf(h.replies)).toBeDefined();
  });

  it("relay blocks ('block' on the worker port) are analysed and nothing goes back on the capture port", () => {
    const h = harness();
    h.core.onMessage(configFor(take, 16000, 0.5));
    h.core.onMessage({ v: 1, type: 'block', block: block(0, 0) });
    expect(h.returns).toHaveLength(0);
    expect(eventsOf(h.replies).length).toBeGreaterThan(0);
  });

  it("a second 'config' is an error reply", () => {
    const h = harness();
    h.core.onMessage(configFor(take, 16000, 0.5));
    h.core.onMessage(configFor(take, 16000, 0.5));
    expect(h.replies[h.replies.length - 1]).toMatchObject({ v: 1, type: 'error' });
  });

  it("'clicks' before any analysis rebuilds the pipeline; later ones are counted and ignored", () => {
    const h = harness();
    const m = configFor(take, 16000, 0.5);
    h.core.onMessage({ ...m, cfg: { ...m.cfg, outputMode: 'speakers' } });
    h.core.onMessage({ v: 1, type: 'clicks', clicks: [{ beatIndex: 0, accent: true, t: 0.1 as ClockSeconds, countIn: true }] });
    expect(h.core.lateClickMessages).toBe(0);
    h.port.postMessage({ v: 1, type: 'block', block: block(0, 0) });
    h.core.onMessage({ v: 1, type: 'clicks', clicks: [] });
    expect(h.core.lateClickMessages).toBe(1);
  });
});

interface Run {
  live: FollowerEvent[];
  alignment: FinalAlignment;
  detected: DetectedNote[];
  done: Extract<WorkerReply, { type: 'done' }>;
  reference: { live: FollowerEvent[]; alignment: FinalAlignment; detected: DetectedNote[] };
}

/** The S1 take through the worker core and, from the same blocks, through the reference wiring (e2e-pipeline). */
async function runSlice(take: SliceTake): Promise<Run> {
  const samples = renderSlice(take, { offsetSec: LEAD, sampleRate: RATE });
  const be = new FakeAudioBackend({ source: samples, sampleRate: RATE });
  const h = harness();
  const blocks: CaptureBlock[] = [];
  const tee: MessagePortLike = {
    postMessage: (m: unknown) => {
      const b = (m as Extract<WorkerMessage, { type: 'block' }>).block;
      blocks.push(copyBlock(b));
      h.port.postMessage(m);
    },
    close: () => undefined,
  };
  await be.startCapture(tee);
  const origin = be.now() as number;
  const t0 = origin + LEAD;
  h.core.onMessage(configFor(take, be.analysisRate, t0));
  const endT = (t0 + take.endSec) as ClockSeconds;
  await be.run({ untilClock: endT + 0.05 });
  h.core.onMessage({ v: 1, type: 'end', t: endT, reason: { reason: 'complete' } });
  const done = doneOf(h.replies);
  if (!done) throw new Error('no done reply');
  const all = eventsOf(h.replies);
  const fin = all[all.length - 1] as Extract<FollowerEvent, { type: 'final' }>;

  // Reference wiring on the same blocks (src/testkit/e2e-pipeline.test.ts).
  const msg = configFor(take, be.analysisRate, t0);
  const dsp = new DspPipeline(msg.cfg);
  const stream: FollowStreamItem[] = [];
  // Every block that reached the worker before 'end' is analysed (the worker cannot know the end time earlier).
  for (const b of blocks) {
    const blockEnd = ((b.startT as number) + b.lowband.length / b.analysisRate) as ClockSeconds;
    for (const ev of dsp.push(b)) stream.push({ kind: 'dsp', t: blockEnd, event: ev });
    stream.push({ kind: 'clock', t: blockEnd });
  }
  for (const ev of dsp.flush(endT) as DspEvent[]) stream.push({ kind: 'dsp', t: endT, event: ev });
  stream.push({ kind: 'end', t: endT, end: { reason: 'complete' } });
  const refLive = runFollowStream(stream, new LiveFollower(msg.follow));
  const refDetected = finalDetected(stream);
  const refAlignment = alignFinal(msg.follow, refDetected, liveOutcomeOf(refLive));
  return {
    live: all.filter((e) => e.type !== 'final'),
    alignment: fin.alignment,
    detected: done.detected,
    done,
    reference: { live: refLive, alignment: refAlignment, detected: refDetected },
  };
}

describe('S1 take through the DSP worker core (FakeAudioBackend, port path)', () => {
  const take = sliceTake(cfg);

  it('gives the S1 verdicts live and final, identical to the reference wiring', async () => {
    const r = await runSlice(take);
    expect(take.expected).toHaveLength(23);
    expect(take.bpm).toBe(SLICE.bpm);

    // Same as the reference wiring, event for event.
    expect(r.live).toEqual(r.reference.live);
    expect(r.alignment).toEqual(r.reference.alignment);
    expect(r.detected).toEqual(r.reference.detected);

    const fin = new Map(r.alignment.judgments.map((j) => [j.expectedIdx, j]));
    const msg = r.alignment.judgments.map((j) => `#${j.expectedIdx} ${j.status} ${j.timing} ${j.pitch} ${j.timingErrorMs?.toFixed(0)}ms`).join('; ');
    expect(fin.get(SLICE_LATE_IDX), msg).toMatchObject({ status: 'matched', timing: 'late' });
    expect(fin.get(SLICE_WRONG_IDX), msg).toMatchObject({ status: 'matched', pitch: 'wrong-pitch', timing: 'on-time' });
    expect(fin.get(SLICE_OMIT_IDX), msg).toMatchObject({ status: 'missed' });
    const others = r.alignment.judgments.filter((j) => ![SLICE_LATE_IDX, SLICE_WRONG_IDX, SLICE_OMIT_IDX].includes(j.expectedIdx));
    const bad = others.filter((j) => j.status !== 'matched' || j.timing !== 'on-time' || !['in-tune', 'not-graded'].includes(j.pitch ?? ''));
    expect(bad, msg).toEqual([]);
    // One extra, in bar 5's rest.
    expect(r.alignment.extras).toHaveLength(1);
    const extra = r.detected.find((d) => d.id === r.alignment.extras[0]!.detectedId)!;
    expect(Math.round(extra.midi)).toBe(SLICE_EXTRA.midi);

    // Live: the same verdicts reach the overlay during the take.
    const lv = liveSubject(r.live, take.expected.length);
    expect(lv.judgments[SLICE_LATE_IDX]).toMatchObject({ timing: 'late' });
    expect(lv.judgments[SLICE_WRONG_IDX]).toMatchObject({ pitch: 'wrong-pitch' });
    expect(lv.missed).toContain(SLICE_OMIT_IDX);
    expect(lv.ghosts.some((g) => g.kind === 'extra')).toBe(true);
    expect(lv.ghosts.some((g) => g.kind === 'late' && g.targetExpectedIdx === SLICE_LATE_IDX)).toBe(true);
    expect(lv.ghosts.some((g) => g.kind === 'wrong-pitch' && g.targetExpectedIdx === SLICE_WRONG_IDX)).toBe(true);

    // done: live judgments are the last per note; telemetry is filled.
    expect(r.done.live.map((j) => j.expectedIdx)).toEqual([...new Set(r.done.live.map((j) => j.expectedIdx))].sort((a, b) => a - b));
    expect(r.done.stats.missingBlocks).toBe(0);
    expect(r.done.stats.hopP95Ms).not.toBeNull();
    expect(r.done.signal.medianClarity).toBeGreaterThan(0.85);
    expect(r.done.voiceReference).toBeNull();

    // Grade (P and R; practice take without calibration) is below a clean take's and never S (R43).
    const score = sliceGrade(take, cfg, { alignment: r.alignment, detected: r.detected, signal: r.done.signal, calibrationMeasured: false });
    expect(score.grade).not.toBe('S');
    expect(score.components.P as number).toBeLessThan(100);
    expect(score.components.R as number).toBeLessThan(100);
    console.warn(`[S1 node] score ${score.score} ${score.grade} P/I/R ${JSON.stringify(score.components)}; ${msg}`);
  }, 60_000);
});

describe('count-in recheck in the worker (01 §7.7, R31, R55)', () => {
  const take = sliceTake(cfg);
  const RTL_SEC = 0.06;

  /** A speakers take on the fake backend: count-in clicks loop back into the capture `RTL_SEC` after scheduling. */
  async function speakersRun(o: { spec: boolean; endAfterCountIn: boolean; rtlSec?: number }) {
    const be = new FakeAudioBackend({ sampleRate: RATE, route: { outputMode: 'speakers' }, loopback: { rtlSec: o.rtlSec ?? RTL_SEC, gainDb: -20 } });
    const h = harness();
    await be.startCapture(h.port);
    const sched = await be.scheduleTake({ leadSec: 0.6, bpm: take.bpm, beatsPerBar: 4, countInBeats: 4, totalBeats: 8, mode: 'audible', timbre: 'tick', accentDb: 5 });
    const countIn = sched.clicks.filter((k) => k.countIn);
    const first = countIn[0]!.t as number;
    const base = configFor(take, be.analysisRate, sched.t0 as number);
    const dspCfg = { ...base.cfg, outputMode: 'speakers' as const };
    const spec = { inputRate: RATE, countIn: countIn.map((k) => ({ t: k.t as number, accent: k.accent })), timbre: 'tick' as const, template: null, silence: { t0: first - 0.4, t1: first } };
    h.core.onMessage({ ...base, cfg: o.spec ? withRecheckSpec(dspCfg, spec) : dspCfg });
    const lastClick = countIn.at(-1)!.t as number;
    const endT = o.endAfterCountIn ? lastClick + 0.6 : first + 0.05;
    await be.run({ untilClock: endT + 0.05 });
    const beforeEnd = h.replies.filter((r) => r.type === 'recheck').length;
    h.core.onMessage({ v: 1, type: 'end', t: endT as ClockSeconds, reason: { reason: 'stopped' } });
    return { h, beforeEnd };
  }

  it("posts 'recheck' once the count-in is recorded, measuring the loopback RTL, then 'done'", async () => {
    const { h, beforeEnd } = await speakersRun({ spec: true, endAfterCountIn: true });
    expect(beforeEnd).toBe(1);
    const rechecks = h.replies.filter((r): r is Extract<WorkerReply, { type: 'recheck' }> => r.type === 'recheck');
    expect(rechecks).toHaveLength(1);
    const r = rechecks[0]!.result;
    expect(Object.keys(r).sort()).toEqual(['accepted', 'clicksFound', 'firstClickFound', 'madMs', 'rtlMs']);
    expect(r.accepted).toBe(true);
    expect(r.firstClickFound).toBe(true);
    expect(r.clicksFound).toBe(4);
    expect(Math.abs(r.rtlMs! - RTL_SEC * 1000)).toBeLessThanOrEqual(1.5);
    // The session's decision on it: stored 50 ms vs measured 60 ms uses the fresh value and keeps the take ranked.
    const d = decideRecheck(r, 50, cfg.budget.calibration);
    expect(d.recheck.status).toBe('measured');
    expect(d.recheck.usedFresh).toBe(true);
    const iRecheck = h.replies.indexOf(rechecks[0]!);
    expect(iRecheck).toBeLessThan(h.replies.findIndex((x) => x.type === 'done'));
  }, 30_000);

  it('a take that ends during the count-in still posts its recheck before done (unmeasured)', async () => {
    const { h, beforeEnd } = await speakersRun({ spec: true, endAfterCountIn: false });
    expect(beforeEnd).toBe(0);
    const types = h.replies.map((r) => r.type);
    expect(types.filter((t) => t === 'recheck')).toHaveLength(1);
    expect(types.indexOf('recheck')).toBeLessThan(types.indexOf('done'));
    const r = (h.replies.find((x) => x.type === 'recheck') as Extract<WorkerReply, { type: 'recheck' }>).result;
    expect(r.accepted).toBe(false);
    expect(decideRecheck(r, 50, cfg.budget.calibration).recheck.status).toBe('unmeasured');
  }, 30_000);

  it('no spec (relay mode, headphones): no recheck reply', async () => {
    const { h } = await speakersRun({ spec: false, endAfterCountIn: true });
    expect(h.replies.some((r) => r.type === 'recheck')).toBe(false);
    expect(h.replies.some((r) => r.type === 'done')).toBe(true);
  }, 30_000);
});
