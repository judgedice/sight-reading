// P16 acceptance (01 §15 P16 row): the full flow on the fake backend in Node; strict scan auto-start; seen at reveal;
// practise without listening; void paths; voice reference and tuning note; record reloads identically.
//
// Harness: fixture corpus through loadManifest/loadExcerpt (fs-backed assets), memory repos, the testkit
// FakeAudioBackend (production decimator and hi band), and the real DSP worker logic (DspWorkerCore) behind an
// in-process WorkerLike. Performances are scripted from the excerpt's expected notes (fixtures/follow/gen/perform) and
// rendered by the P3 synth into the fake's capture, at t0 + RTL on the backend clock.
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import attemptSchema from '../../schemas/attempt-record.schema.json';
import profileSchema from '../../schemas/player-profile.schema.json';
import type { MessagePortLike, PlatformServices, WorkerLike, WorkerMessage, WorkerReply } from '../core/platform.ts';
import type { AttemptRecord, Calibration, CorpusManifest, PracticeSettings, SessionEvent, SessionState } from '../core/types.ts';
import { configs } from '../../fixtures/follow/gen/io.ts';
import { perform, type PerformSpec } from '../../fixtures/follow/gen/perform.ts';
import { buildExpectedNotes, loadManifest } from '../corpus/index.ts';
import { createRng } from '../core/rng.ts';
import { createEmitter } from '../core/events.ts';
import { midiToFreq, toMidi, tonicOf } from '../theory/index.ts';
import { DspWorkerCore } from '../platform/web/audio/dsp-worker-core.ts';
import { FakeAudioBackend, type FakeBackendOptions } from '../testkit/fake-backend.ts';
import { renderPerformance, type SynthNoteSpec } from '../testkit/synth/index.ts';
import { MemoryKv, makeCalibration, memoryRepos } from '../store/test-data.ts';
import { PracticeSession, initialSessionView, reduceSessionView, sessionApi, voiceReferenceTones } from './index.ts';

const cfg = configs();
const RATE = 48000;
const ROUTE = 'fake-route';
const DAY = '2026-11-18';
const FIXTURE_DIR = new URL('../../fixtures/corpus/', import.meta.url);
const assets: PlatformServices['assets'] = {
  getJson: <T,>(rel: string) => Promise.resolve(JSON.parse(readFileSync(new URL(rel.slice(rel.lastIndexOf('/') + 1), FIXTURE_DIR), 'utf8')) as T),
};
let manifestP: Promise<CorpusManifest> | null = null;
const manifest = (): Promise<CorpusManifest> => (manifestP ??= loadManifest(assets));
const ajv = addFormats(new Ajv({ strict: false, allErrors: true }));
const validAttempt = ajv.compile(attemptSchema);
const validProfile = ajv.compile(profileSchema);
const expectValid = (v: ReturnType<typeof ajv.compile>, x: unknown): void => {
  expect(v(x), JSON.stringify(v.errors?.slice(0, 3))).toBe(true);
};
const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

/** The fake backend plus a capture-start clock and a scriptable capture fault (WebAudioBackend's onCaptureFault). */
class TestBackend extends FakeAudioBackend {
  captureClock = 0;
  private readonly faultCbs = new Set<(f: { kind: 'backlog' | 'capture-gap' }) => void>();
  override async startCapture(sink: MessagePortLike | ((m: WorkerMessage) => void)): Promise<void> {
    this.captureClock = this.now() as number;
    return super.startCapture(sink);
  }
  onCaptureFault(cb: (f: { kind: 'backlog' | 'capture-gap' }) => void): () => void {
    this.faultCbs.add(cb);
    return () => void this.faultCbs.delete(cb);
  }
  fault(kind: 'backlog' | 'capture-gap'): void {
    this.faultCbs.forEach((cb) => cb({ kind }));
  }
}

/** The DSP worker's logic in-process; replies are delivered asynchronously like a real worker's. */
class NodeWorker implements WorkerLike {
  onmessage: ((ev: { data: WorkerReply }) => void) | null = null;
  terminated = false;
  readonly core = new DspWorkerCore({
    post: (reply) => queueMicrotask(() => !this.terminated && this.onmessage?.({ data: reply })),
    nowMs: () => performance.now(),
    setTimer: (ms, fn) => {
      const h = setTimeout(fn, ms);
      return () => clearTimeout(h);
    },
    endWaitMs: 50,
  });
  postMessage(m: WorkerMessage): void {
    if (!this.terminated) this.core.onMessage(m);
  }
  terminate(): void {
    this.terminated = true;
  }
}

interface Harness {
  be: TestBackend;
  session: PracticeSession;
  repos: ReturnType<typeof memoryRepos>;
  workers: NodeWorker[];
  events: SessionEvent[];
  hide(): void;
  /** Clock time of each state entry. */
  stateAt: Map<SessionState, number>;
}

const playAlong = (rtlMs: number): Calibration => ({ ...makeCalibration(ROUTE), method: 'play-along', outputMode: 'wired', roundTripMs: rtlMs, spreadMs: 4, clicksDetected: 8, templates: {} });

async function harness(o: { backend?: FakeBackendOptions; calibration?: Calibration | null } = {}): Promise<Harness> {
  const be = new TestBackend({ sampleRate: RATE, route: { routeKey: ROUTE, outputMode: 'wired', reportedLatencySec: 0.02 }, ...o.backend });
  const kv = new MemoryKv();
  const repos = memoryRepos(kv);
  if (o.calibration !== null) await repos.calibrations.put(o.calibration ?? playAlong(40));
  const vis = createEmitter<boolean>();
  let ids = 0;
  let wall = Date.parse(`${DAY}T09:00:00.000Z`);
  const platform: PlatformServices = {
    audio: be,
    repos,
    kv,
    keepAwake: async () => undefined,
    clockWall: () => new Date((wall += 1000)).toISOString(),
    localDay: () => DAY,
    idGen: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
    assets,
    lifecycle: { onVisibility: (cb) => vis.on(cb) },
  };
  const workers: NodeWorker[] = [];
  const session = new PracticeSession(
    { platform, configs: cfg, manifest: await manifest(), workerFactory: () => {
      const w = new NodeWorker();
      workers.push(w);
      return w;
    } },
    { pollMs: 'manual', rng: createRng(7), finishTimeoutMs: 2000 },
  );
  const events: SessionEvent[] = [];
  const stateAt = new Map<SessionState, number>();
  session.events.on((e) => {
    events.push(e);
    if (e.type === 'state' && !stateAt.has(e.state)) stateAt.set(e.state, be.now() as number);
  });
  return { be, session, repos, workers, events, hide: () => vis.emit(false), stateAt };
}

function settings(p: Partial<PracticeSettings> = {}): PracticeSettings {
  return {
    instrumentId: 'flute',
    level: 3,
    writtenKey: 'random',
    meter: 'random',
    bpm: 'random',
    bars: 'random',
    mode: 'ranked',
    listening: true,
    metronome: 'audible',
    clickTimbre: 'tick',
    outputMode: 'wired',
    a4Hz: 440,
    ...p,
  };
}

/** Advances the fake clock in small steps, polling the session and letting async work run. */
async function drive(h: Harness, sec: number, until?: () => boolean): Promise<void> {
  const end = (h.be.now() as number) + sec;
  while ((h.be.now() as number) < end - 1e-9) {
    if (until?.()) return;
    h.be.advance(Math.min(0.02, end - (h.be.now() as number)));
    h.session.poll();
    await flush();
  }
}

async function driveTo(h: Harness, state: SessionState, maxSec: number): Promise<void> {
  await drive(h, maxSec, () => h.session.state === state);
  for (let i = 0; i < 50 && h.session.state !== state; i++) await flush();
  expect(h.session.state).toBe(state);
}

/** Renders a performance of the current excerpt into the capture at t0 + RTL (call right after the take is scheduled). */
function play(h: Harness, rtlSec: number, spec: PerformSpec = {}): void {
  const prepared = h.session.prepared!;
  const bpm = prepared.selection.settings.bpm;
  const expected = buildExpectedNotes(prepared, bpm, cfg);
  const inst = cfg.instrumentById[prepared.instrumentId]!;
  const t0 = h.be.log.scheduledTakes.at(-1)!.t0 as number;
  const offset = t0 - h.be.captureClock + rtlSec;
  const notes: SynthNoteSpec[] = perform(expected, prepared.meter.countsPerBar, bpm, spec).map((p, k) => {
    const midi = Math.round(p.midi);
    return { midi, cents: Math.round((p.midi - midi) * 100 * 1000) / 1000, onsetSec: offset + p.onset, durSec: Math.max(0.02, p.dur), slur: p.legato, ref: k };
  });
  const last = notes.at(-1)!;
  h.be.setSource(renderPerformance({ timbre: inst.testkitTimbre!, notes, sampleRate: RATE, durationSec: last.onsetSec + last.durSec + 2, seed: 3 }).samples);
}

/** The last attempt record the session emitted; every record must validate against the frozen schema. */
const lastRecord = (h: Harness): AttemptRecord => {
  const r = [...h.events].reverse().find((e) => e.type === 'record');
  if (!r || r.type !== 'record') throw new Error('no record');
  expectValid(validAttempt, r.record);
  return r.record;
};

describe('PracticeSession conformance', () => {
  it('implements the frozen SessionApi', () => {
    expect(sessionApi.PracticeSession).toBe(PracticeSession);
  });
});

describe('full ranked flow on the fake backend', () => {
  it('seen at reveal, strict scan auto-start, graded take, progression, tips, record reloads identically', async () => {
    const h = await harness({ calibration: playAlong(40) });
    const prepared = await h.session.prepare(settings());
    expect(h.session.state).toBe('covered');
    expect((await h.repos.profile.get())!.seenGroups[prepared.dedupeGroup]).toBeUndefined();

    await h.session.ensureAudio();
    expect(h.be.log.unlocks).toBe(1);
    h.session.revealScan();
    const revealAt = h.be.now() as number;
    await flush();
    // Seen at reveal (02 §5.3), persisted before any take.
    expect((await h.repos.profile.get())!.seenGroups[prepared.dedupeGroup]).toBeDefined();
    expect(h.session.pending!.seenBefore).toBe(false);

    const scanSec = cfg.levelByNumber[prepared.levelServed]!.scanSec;
    await driveTo(h, 'count-in', scanSec + 1);
    // R6: the count-in starts by itself at the strict time (04 §5.3 acceptance: ± 50 ms).
    expect(Math.abs(h.stateAt.get('count-in')! - revealAt - scanSec)).toBeLessThanOrEqual(0.05);
    for (let i = 0; i < 20 && h.be.log.scheduledTakes.length === 0; i++) await flush();
    expect(h.be.log.scheduledTakes).toHaveLength(1);
    play(h, 0.04);
    const scanTicks = h.events.filter((e) => e.type === 'scan-tick').map((e) => (e as { remainingSec: number }).remainingSec);
    expect(scanTicks[0]).toBe(scanSec);
    expect(scanTicks.at(-1)).toBe(0);

    await driveTo(h, 'results', 60);
    const rec = lastRecord(h);
    const countIns = h.events.filter((e) => e.type === 'count-in');
    expect(countIns.length).toBe(h.be.log.scheduledTakes[0]!.params.countInBeats);
    expect(h.events.some((e) => e.type === 'follower' && e.event.type === 'judgment')).toBe(true);

    expect(rec.endReason).toBe('complete');
    expect(rec.listening).toBe(true);
    expect(rec.excerptBurned).toBe(true);
    expect(rec.countsAsSkip).toBe(false);
    expect(rec.calibration).toEqual({ method: 'play-along', latencyCompensationMs: 40, outputMode: 'wired', recheck: null });
    expect(rec.audioEnv.gateFailures).toEqual([]);
    const score = rec.score!;
    const msg = `score ${score.score} ${score.grade} ${JSON.stringify(score.components)} reasons ${score.rankedReasons} extras ${rec.extras.length} ` +
      rec.judgments.filter((j) => j.status !== 'matched' || j.timing !== 'on-time').map((j) => `#${j.expectedIdx} ${j.status} ${j.timing} ${j.timingErrorMs}`).join('; ');
    expect(score.ranked, msg).toBe(true);
    expect(score.score, msg).toBeGreaterThanOrEqual(90);
    expect(rec.judgments.every((j) => j.status === 'matched'), msg).toBe(true);

    // Record reloads identically (01 §5.9; 04 §5.5 acceptance).
    const reloaded = await h.repos.attempts.byId(rec.id);
    expect(reloaded).toEqual(rec);
    expect(JSON.parse(JSON.stringify(rec))).toEqual(rec);

    // Progression on the local day, tips filled before applying (G6+G7 notes).
    const profile = (await h.repos.profile.get())!;
    expectValid(validProfile, profile);
    expect(profile.xp).toBe(score.xp.total);
    expect(profile.rankedIndex).toBe(1);
    expect(profile.daily.day).toBe(DAY);
    const tipsEv = h.events.find((e) => e.type === 'tips');
    expect(tipsEv && tipsEv.type === 'tips' ? tipsEv.tips.map((t) => t.id) : null).toEqual(score.tipsShown);
    expect(h.events.some((e) => e.type === 'progress')).toBe(true);

    // The view store screens read.
    const v = h.session.view.getState();
    expect(v.state).toBe('results');
    expect(v.record).toEqual(rec);
    expect(v.prepared).toBe(prepared);
    expect(h.workers).toHaveLength(1);
    expect(h.workers[0]!.terminated).toBe(true);
  }, 60_000);
});

describe('practice', () => {
  it('never auto-starts; a stopped practice take is not graded', async () => {
    const h = await harness();
    const prepared = await h.session.prepare(settings({ mode: 'practice', level: 2 }));
    await h.session.ensureAudio();
    h.session.revealScan();
    const scanSec = cfg.levelByNumber[prepared.levelServed]!.scanSec;
    await drive(h, scanSec + 2);
    expect(h.session.state).toBe('scanning');
    expect(h.be.log.scheduledTakes).toHaveLength(0);
    expect(h.session.view.getState().scan).toEqual({ remainingSec: 0, expired: true });

    await h.session.startTake();
    play(h, 0.04);
    await driveTo(h, 'performing', 10);
    await drive(h, 2);
    const rec = await h.session.stop();
    expect(h.session.state).toBe('results');
    expect(rec).toEqual(lastRecord(h));
    expect(rec!.endReason).toBe('stopped');
    expect(rec!.score).toBeNull();
    expect(rec!.settingsResolved.mode).toBe('practice');
    expect((await h.repos.profile.get())!.xp).toBe(0);
  }, 60_000);

  it('practise without listening: no worker, no capture, no score, still seen (R13, 01 §9.8)', async () => {
    const h = await harness();
    const prepared = await h.session.prepare(settings({ listening: false }));
    await h.session.ensureAudio();
    h.session.revealScan();
    await h.session.startTake();
    expect(h.be.log.scheduledTakes).toHaveLength(1);
    await driveTo(h, 'results', 60);
    const rec = lastRecord(h);
    expect(h.workers).toHaveLength(0);
    expect(h.be.log.captureStarts).toBe(0);
    expect(rec.listening).toBe(false);
    expect(rec.score).toBeNull();
    expect(rec.endReason).toBe('complete');
    expect(rec.calibration).toEqual({ method: 'none', latencyCompensationMs: 0, outputMode: 'wired', recheck: null });
    const profile = (await h.repos.profile.get())!;
    expect(profile.seenGroups[prepared.dedupeGroup]).toBeDefined();
    expect(profile.xp).toBe(0);
    expect(h.events.some((e) => e.type === 'tips')).toBe(false);
  }, 30_000);
});

describe('void paths (01 §7.9, 05 W4, W7, R32, R33)', () => {
  async function startRanked(h: Harness): Promise<void> {
    await h.session.prepare(settings());
    await h.session.ensureAudio();
    h.session.revealScan();
    await h.session.startTake();
  }
  async function expectVoid(h: Harness, reason: string): Promise<AttemptRecord> {
    for (let i = 0; i < 300 && h.session.state !== 'results'; i++) await new Promise((r) => setTimeout(r, 2));
    expect(h.session.state).toBe('results');
    const rec = lastRecord(h);
    expect(rec.endReason).toBe('void');
    expect(rec.voidReason).toBe(reason);
    expect(rec.score).toBeNull();
    expect(rec.excerptBurned).toBe(true);
    expect(h.events.some((e) => e.type === 'void' && e.reason === reason)).toBe(true);
    expect(h.events.some((e) => e.type === 'tips')).toBe(false);
    expect(h.session.view.getState().voidReason).toBe(reason);
    return rec;
  }

  it('interruption after the first note: void, burned, counts against the skip limit', async () => {
    const h = await harness();
    await startRanked(h);
    play(h, 0.04);
    await drive(h, 30, () => h.session.view.getState().firstNoteHeard);
    await drive(h, 0.5);
    h.be.scriptInterruption((h.be.now() as number) + 0.01, 'interrupted');
    await drive(h, 0.05);
    const rec = await expectVoid(h, 'interrupted');
    expect(rec.countsAsSkip).toBe(true);
    const p = (await h.repos.profile.get())!;
    expect(p.lastSkipRankedIndex).toBe(p.rankedIndex);
    expect(p.xp).toBe(0);
    // 05 W4: the next take needs a gesture: startTake without ensureAudio is refused.
    h.session.tryAgain();
    await expect(h.session.startTake()).rejects.toThrow(/ensureAudio/);
  }, 60_000);

  it('page hidden during the count-in: void interrupted, not a skip (no note yet)', async () => {
    const h = await harness();
    await startRanked(h);
    await drive(h, 0.3);
    expect(h.session.state).toBe('count-in');
    h.hide();
    const rec = await expectVoid(h, 'interrupted');
    expect(rec.countsAsSkip).toBe(false);
    expect(h.be.log.cancelledTakes).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it('device change: void and the old route calibration goes stale', async () => {
    const h = await harness();
    await startRanked(h);
    h.be.scriptRouteChange((h.be.now() as number) + 1, { routeKey: 'other-route' });
    await drive(h, 1.1);
    await expectVoid(h, 'device-change');
    await flush();
    expect((await h.repos.calibrations.get(ROUTE))!.stale).toBe(true);
  }, 30_000);

  it('capture backlog fault: void backlog', async () => {
    const h = await harness();
    await startRanked(h);
    await drive(h, 0.5);
    h.be.fault('backlog');
    await expectVoid(h, 'backlog');
  }, 30_000);

  it('a dropped capture block: void capture-gap', async () => {
    const h = await harness({ backend: { dropSeqs: [40] } });
    await startRanked(h);
    await drive(h, 1);
    await expectVoid(h, 'capture-gap');
  }, 30_000);

  it('no voiced frames for 5 s after the first written onset: void no-signal', async () => {
    const h = await harness();
    await startRanked(h);
    await drive(h, 30, () => h.session.state === 'finishing' || h.session.state === 'results');
    await expectVoid(h, 'no-signal');
  }, 60_000);

  it('ranked Stop before the first note: the first re-runs the count-in, the second voids (02 §5.3)', async () => {
    const h = await harness();
    await startRanked(h);
    await drive(h, 0.5);
    expect(await h.session.stop()).toBeNull();
    for (let i = 0; i < 20 && h.be.log.scheduledTakes.length < 2; i++) await flush();
    expect(h.events.some((e) => e.type === 'count-in-restart' && e.reason === 'stop-before-first-note')).toBe(true);
    expect(h.be.log.scheduledTakes).toHaveLength(2);
    expect(h.be.log.cancelledTakes).toBe(1);
    expect(h.session.state).toBe('count-in');
    await drive(h, 0.5);
    const rec = await h.session.stop();
    expect(rec!.voidReason).toBe('stopped-before-first-note');
    await expectVoid(h, 'stopped-before-first-note');
  }, 30_000);
});

describe('voice reference and tuning note (02 §4.5, R7)', () => {
  it('voice: tonic triad then the first note, and it plays before every voice count-in', async () => {
    const h = await harness();
    const prepared = await h.session.prepare(settings({ instrumentId: 'voice-alto', mode: 'practice' }));
    await h.session.ensureAudio();
    h.session.revealScan();
    const expected = buildExpectedNotes(prepared, prepared.selection.settings.bpm, cfg);
    const first = expected[0]!.concertMidi;
    await h.session.playVoiceReference();
    const tones = h.be.log.tones;
    expect(tones).toHaveLength(4);
    const toMidiHz = (hz: number) => Math.round(69 + 12 * Math.log2(hz / 440));
    const midis = tones.map((t) => toMidiHz(t.hz));
    const tonicPc = toMidi(tonicOf(prepared.concertKey)) % 12;
    expect(((midis[0]! % 12) + 12) % 12).toBe(tonicPc);
    expect(midis[0]!).toBeLessThanOrEqual(first);
    expect(first - midis[0]!).toBeLessThan(12);
    expect(midis[2]! - midis[0]!).toBe(7);
    expect(tones[3]!.hz).toBeCloseTo(midiToFreq(first, 440), 6);
    expect(voiceReferenceTones(prepared, first, 440).map((t) => t.midi)).toEqual(midis);

    // Mandatory before the count-in in every mode: four more tones, all ending before the first click.
    await h.session.startTake();
    expect(h.be.log.tones).toHaveLength(8);
    const firstClick = h.be.log.scheduledTakes[0]!.clicks[0]!.t as number;
    const refEnd = Math.max(...h.be.log.tones.slice(4).map((t) => (t.at as number) + t.durSec));
    expect(refEnd).toBeLessThan(firstClick);
    await expect(h.session.captureTuningNote()).rejects.toThrow(/winds, brass and strings/);
  }, 30_000);

  it('tuning note: 3 s capture reads the offset, caps it, and the take uses it', async () => {
    const h = await harness();
    await h.session.prepare(settings({ mode: 'practice' }));
    await h.session.ensureAudio();
    h.session.revealScan();
    const tone = (cents: number) =>
      renderPerformance({ timbre: 'flute', notes: [{ midi: 70, cents, onsetSec: 0.2, durSec: 3.5 }], sampleRate: RATE, durationSec: 4, vibrato: null, seed: 5 }).samples;
    h.be.setSource(tone(-12));
    const p = h.session.captureTuningNote();
    await drive(h, 3.3);
    const cents = await p;
    expect(Math.abs(cents - -12)).toBeLessThanOrEqual(3);
    expect((await h.repos.profile.get())!.instruments['flute']!.tuningOffsetCents).toBe(cents);

    h.be.setSource(tone(40));
    const p2 = h.session.captureTuningNote();
    await drive(h, 3.3);
    expect(await p2).toBe(cfg.grading.tuning.maxOffsetCents);

    await h.session.startTake();
    play(h, 0.03);
    await driveTo(h, 'performing', 10);
    await drive(h, 1);
    const rec = await h.session.stop();
    expect(rec!.tuning).toEqual({ used: true, offsetCents: cfg.grading.tuning.maxOffsetCents });
  }, 60_000);
});

describe('skip rules (02 §5.3, R33)', () => {
  it('free before reveal; after reveal it burns, and beyond one per 5 ranked attempts the replacement is practice', async () => {
    const h = await harness();
    const a = await h.session.prepare(settings({ instrumentId: 'violin', level: 5 }));
    await h.session.skip();
    let p = (await h.repos.profile.get())!;
    expect(p.seenGroups[a.dedupeGroup]).toBeUndefined();
    expect(p.lastSkipRankedIndex).toBeNull();
    expect(h.session.state).toBe('covered');
    const b = h.session.prepared!;
    expect(b.dedupeGroup).not.toBe(a.dedupeGroup);

    await h.session.ensureAudio();
    h.session.revealScan();
    await h.session.skip();
    await flush();
    p = (await h.repos.profile.get())!;
    expect(p.seenGroups[b.dedupeGroup]).toBeDefined();
    expect(p.lastSkipRankedIndex).toBe(0);
    expect(h.session.pending!.skipLimitHit).toBe(false);

    h.session.revealScan();
    await h.session.skip();
    expect(h.session.pending!.skipLimitHit).toBe(true);
  }, 30_000);
});

describe('speakers: count-in recheck (01 §7.7, R31)', () => {
  it('measures the RTL from the count-in clicks and stores it on the attempt', async () => {
    const cal: Calibration = { ...makeCalibration(ROUTE), roundTripMs: 50, spreadMs: 1, clicksDetected: 10 };
    const h = await harness({ backend: { route: { routeKey: ROUTE, outputMode: 'speakers' }, loopback: { rtlSec: 0.05, gainDb: -20 } }, calibration: cal });
    await h.session.prepare(settings({ mode: 'practice', outputMode: 'speakers' }));
    await h.session.ensureAudio();
    h.session.revealScan();
    await h.session.startTake();
    await driveTo(h, 'performing', 10);
    await drive(h, 1);
    const rec = await h.session.stop();
    const rc = rec!.calibration.recheck!;
    expect(rc.status).toBe('measured');
    expect(Math.abs(rc.measuredMs! - 50)).toBeLessThanOrEqual(2);
    expect(rc.usedFresh).toBe(false);
  }, 30_000);
});

describe('view store reducer', () => {
  it('tracks state, count-in, bar and the status priority', () => {
    let v = initialSessionView();
    v = reduceSessionView(v, { type: 'state', state: 'count-in', prev: 'scanning' });
    v = reduceSessionView(v, { type: 'count-in', beat: 2, of: 4, t: 1 as never });
    expect(v.countIn).toEqual({ beat: 2, of: 4 });
    v = reduceSessionView(v, { type: 'follower', event: { type: 'status', kind: 'come-in-at', bar: 3 } });
    v = reduceSessionView(v, { type: 'follower', event: { type: 'status', kind: 'lost-place' } });
    expect(v.status).toEqual({ kind: 'lost-place' });
    v = reduceSessionView(v, { type: 'follower', event: { type: 'status', kind: 'come-in-at', bar: 4 } });
    expect(v.status).toEqual({ kind: 'lost-place' });
    v = reduceSessionView(v, { type: 'follower', event: { type: 'status', kind: 'rejoined' } });
    expect(v.status).toBeNull();
    v = reduceSessionView(v, { type: 'follower', event: { type: 'note-start', detectedId: 1, scoreBeat: 0, provisionalConcertMidi: 60, matchedExpected: 0, displaced: false } });
    expect(v.firstNoteHeard).toBe(true);
    v = reduceSessionView(v, { type: 'state', state: 'results', prev: 'finishing' });
    expect(v.countIn).toBeNull();
  });
});
