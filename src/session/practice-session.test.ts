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
import {
  PracticeSession,
  SessionError,
  VOICE_REFERENCE_LEAD_SEC,
  decodePcm16,
  initialSessionView,
  listenSourceOf,
  reduceSessionView,
  sessionApi,
  voiceReferenceTones,
  type DiagnosticsFile,
  type PracticeSessionOptions,
  type SoundCaption,
} from './index.ts';

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
/** The shipped corpus (public/corpus/v1), for flows the fixture corpus has no excerpt for. */
const SHIPPED_DIR = new URL('../../public/corpus/v1/', import.meta.url);
const shippedAssets: PlatformServices['assets'] = {
  getJson: <T,>(rel: string) => Promise.resolve(JSON.parse(readFileSync(new URL(rel.slice(rel.lastIndexOf('/') + 1), SHIPPED_DIR), 'utf8')) as T),
};
let shippedP: Promise<CorpusManifest> | null = null;
const shippedManifest = (): Promise<CorpusManifest> => (shippedP ??= loadManifest(shippedAssets));
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

/** The worker end of an in-process capture channel: buffers blocks until the worker listens, then delivers in order. */
class InProcessPort {
  private readonly queue: unknown[] = [];
  private handler: ((data: unknown) => void) | null = null;
  deliver(data: unknown): void {
    if (this.handler) this.handler(data);
    else this.queue.push(data);
  }
  listen(h: (data: unknown) => void): void {
    this.handler = h;
    for (const d of this.queue.splice(0)) h(d);
  }
}

/** `createCaptureChannel` for Node: the backend posts on port1, the worker adopts port2 (port mode, R55). */
function inProcessChannel(): { port1: MessagePortLike; port2: InProcessPort } {
  const port2 = new InProcessPort();
  return { port1: { postMessage: (m: unknown) => port2.deliver(m), close: () => undefined }, port2 };
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
  postMessage(m: WorkerMessage, transfer?: unknown[]): void {
    // Port mode: the capture port arrives as the first transferred object (dsp.worker.ts adoptPort).
    const port = transfer?.[0];
    if (port instanceof InProcessPort) {
      this.core.setCapturePort({ postMessage: () => undefined });
      port.listen((data) => !this.terminated && this.core.onCaptureMessage(data));
    }
    if (!this.terminated) this.core.onMessage(m);
  }
  terminate(): void {
    this.terminated = true;
  }
}

/** Session timers on the fake backend's clock: `drive` fires the ones due (captions follow the clock exactly). */
class ClockTimers {
  private next = 1;
  private readonly due = new Map<number, { at: number; fn: () => void }>();
  constructor(private readonly be: FakeAudioBackend) {}
  setInterval(): unknown {
    throw new Error('ClockTimers: use pollMs manual');
  }
  clearInterval(): void {}
  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.next++;
    this.due.set(id, { at: (this.be.now() as number) + ms / 1000, fn });
    return id;
  }
  clearTimeout(h: unknown): void {
    this.due.delete(h as number);
  }
  run(): void {
    for (;;) {
      const now = this.be.now() as number;
      const ready = [...this.due.entries()].filter(([, d]) => d.at <= now + 1e-9).sort((a, b) => a[1].at - b[1].at)[0];
      if (!ready) return;
      this.due.delete(ready[0]);
      ready[1].fn();
    }
  }
}

interface Harness {
  timers: ClockTimers | null;
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

async function harness(
  o: { backend?: FakeBackendOptions; calibration?: Calibration | null; portMode?: boolean; options?: PracticeSessionOptions; shippedCorpus?: boolean; clockTimers?: boolean } = {},
): Promise<Harness> {
  const be = new TestBackend({ sampleRate: RATE, route: { routeKey: ROUTE, outputMode: 'wired', reportedLatencySec: 0.02 }, ...o.backend });
  const timers = o.clockTimers ? new ClockTimers(be) : null;
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
    assets: o.shippedCorpus ? shippedAssets : assets,
    lifecycle: { onVisibility: (cb) => vis.on(cb) },
  };
  const workers: NodeWorker[] = [];
  const session = new PracticeSession(
    { platform, configs: cfg, manifest: await (o.shippedCorpus ? shippedManifest() : manifest()), workerFactory: () => {
      const w = new NodeWorker();
      workers.push(w);
      return w;
    } },
    { pollMs: 'manual', rng: createRng(7), finishTimeoutMs: 2000, ...(timers ? { timers } : {}), ...(o.portMode ? { createCaptureChannel: inProcessChannel } : {}), ...o.options },
  );
  const events: SessionEvent[] = [];
  const stateAt = new Map<SessionState, number>();
  session.events.on((e) => {
    events.push(e);
    if (e.type === 'state' && !stateAt.has(e.state)) stateAt.set(e.state, be.now() as number);
  });
  return { timers, be, session, repos, workers, events, hide: () => vis.emit(false), stateAt };
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
    h.timers?.run();
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

describe('audio that is not open at Start playing (05 W1, W2)', () => {
  it('Start playing right after the reveal waits for the unlock still in flight', async () => {
    const h = await harness({ calibration: playAlong(40) });
    await h.session.prepare(settings({ mode: 'practice' }));
    // The read-through's gesture: ensureAudio starts the unlock; the take starts before it settles.
    void h.session.ensureAudio();
    h.session.revealScan();
    await h.session.startTake();
    expect(h.session.state).toBe('count-in');
    expect(h.be.log.scheduledTakes).toHaveLength(1);
    expect(h.session.view.getState().error).toBeNull();
  });

  it('audio closed between takes (page hidden): a take with no gesture fails as audio-setup, not unknown; Try again and a tap recover', async () => {
    const h = await harness({ calibration: playAlong(40) });
    await h.session.prepare(settings({ mode: 'practice' }));
    await h.session.ensureAudio();
    h.session.revealScan();
    // The interruption controller closed the audio while the page was hidden (05 W2).
    h.session.audioClosed();
    await expect(h.session.startTake()).rejects.toMatchObject({ code: 'audio-setup' });
    expect(h.session.state).toBe('error');
    expect(h.session.view.getState().error).toMatchObject({ code: 'audio-setup' });
    expect(h.session.view.getState().error?.detail).toMatch(/not open/);
    expect(h.session.lastError?.code).toBe('audio-setup');
    // Try again: back to the read-through with the same excerpt; Start playing reopens audio from its tap.
    const excerpt = h.session.prepared!.excerptId;
    expect(h.session.retry()).toBe(true);
    expect(h.session.state).toBe('scanning');
    expect(h.session.view.getState().error).toBeNull();
    expect(h.session.prepared!.excerptId).toBe(excerpt);
    void h.session.ensureAudio();
    await h.session.startTake();
    expect(h.session.state).toBe('count-in');
    expect(h.be.log.scheduledTakes).toHaveLength(1);
  });

  it('a reopened context (clock back at 0) keeps the reading time spent: the ranked countdown runs on and auto-starts', async () => {
    const h = await harness({ calibration: playAlong(40) });
    const prepared = await h.session.prepare(settings());
    await h.session.ensureAudio();
    h.session.revealScan();
    const scanSec = cfg.levelByNumber[prepared.levelServed]!.scanSec;
    await drive(h, 10);
    const ticks = (): number[] => h.events.filter((e) => e.type === 'scan-tick').map((e) => (e as { remainingSec: number }).remainingSec);
    expect(ticks().at(-1)).toBe(scanSec - 10);
    // The page was hidden: the context closed and a new one starts its clock at 0.
    const before = ticks().length;
    h.session.audioClosed();
    (h.be as unknown as { clockSec: number }).clockSec = 0;
    void h.session.ensureAudio();
    await drive(h, 1.5);
    const after = ticks().slice(before);
    expect(after.length).toBeGreaterThan(0);
    expect(Math.max(...after)).toBeLessThanOrEqual(scanSec - 10);
    await driveTo(h, 'count-in', scanSec);
    expect(h.session.view.getState().error).toBeNull();
  });

  it('a new read-through on a reopened context starts its countdown from the full time (no stale clock)', async () => {
    const h = await harness({ calibration: playAlong(40) });
    await h.session.prepare(settings());
    await h.session.ensureAudio();
    h.session.revealScan();
    await drive(h, 5);
    await h.session.skip();
    // Practice was left and the audio closed: the next context's clock starts again at 0.
    h.session.audioClosed();
    (h.be as unknown as { clockSec: number }).clockSec = 0;
    const next = await h.session.prepare(settings());
    void h.session.ensureAudio();
    h.session.revealScan();
    await drive(h, 0.5);
    expect(h.session.state).toBe('scanning');
    const last = [...h.events].reverse().find((e) => e.type === 'scan-tick') as { remainingSec: number };
    expect(last.remainingSec).toBe(cfg.levelByNumber[next.levelServed]!.scanSec);
  });

  it('Try again after a failed prepare prepares the same settings again', async () => {
    const h = await harness({ calibration: playAlong(40) });
    expect(h.session.retry()).toBe(false);
    await expect(h.session.prepare(settings({ level: 10, meter: '7/8' }))).rejects.toMatchObject({ code: 'empty-pool' });
    expect(h.session.state).toBe('error');
    expect(h.session.retry()).toBe(true);
    await drive(h, 0.2, () => h.session.state === 'error');
    expect(h.session.view.getState().error).toMatchObject({ code: 'empty-pool' });
  });
});

describe('compound meters on the dotted-beat difficulties (02 §2.4)', () => {
  it('a calibrated ranked 6/8 take at difficulty 4, served in dotted beats, stays ranked and earns full tempo XP', async () => {
    const h = await harness({ calibration: playAlong(40), shippedCorpus: true });
    const level = cfg.levels.compound.dottedBeatLevels[0];
    const dotted = cfg.levels.compound.dottedBpm;
    // Below the difficulty's quarter-note minimum (66 x 0.9), inside the dotted-beat range the app serves 6/8 in.
    const bpm = 50;
    expect(bpm).toBeLessThan(cfg.levelByNumber[level]!.tempo.minBpm * cfg.grading.ranked.minTempoFracOfLevelMin);
    expect(bpm).toBeGreaterThanOrEqual(dotted.minBpm);
    const prepared = await h.session.prepare(settings({ level, meter: '6/8', bpm }));
    expect(prepared.levelServed).toBe(level);
    expect(prepared.meter).toMatchObject({ beats: 6, beatType: 8, countsPerBar: 2 });
    expect(prepared.selection.settings.bpm).toBe(bpm);

    await h.session.ensureAudio();
    h.session.revealScan();
    await driveTo(h, 'count-in', cfg.levelByNumber[level]!.scanSec + 1);
    for (let i = 0; i < 20 && h.be.log.scheduledTakes.length === 0; i++) await flush();
    play(h, 0.04);
    await driveTo(h, 'results', 120);
    const rec = lastRecord(h);
    const score = rec.score!;
    expect(score.rankedReasons).not.toContain('tempo-below-90pct');
    expect(score.rankedReasons, `score ${score.score} reasons ${score.rankedReasons}`).toEqual([]);
    expect(score.ranked).toBe(true);
    // m_tempo is the take's tempo over the dotted mid tempo, not the quarter-note mid (which would clamp it to 0.75).
    const mTempo = score.xp.factors.find((f) => f.id === 'm_tempo')!.value;
    expect(mTempo).toBeCloseTo(bpm / ((dotted.minBpm + dotted.maxBpm) / 2), 9);
  }, 120_000);
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
    // Round 2: the reference plays through the sampler in the voice's own set (never the choir), not as sine tones.
    expect(h.be.log.tones).toHaveLength(0);
    expect(h.be.log.noteSounds).toEqual(['voice-alto']);
    const tones = h.be.log.notePlays[0]!.notes;
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

    // Before the count-in in every mode: four more notes in the voice set; the first click one beat after they end.
    await h.session.startTake();
    expect(h.be.log.noteSounds).toEqual(['voice-alto', 'voice-alto']);
    const ref = h.be.log.notePlays[1]!;
    const firstClick = h.be.log.scheduledTakes[0]!.clicks[0]!.t as number;
    const refEnd = Math.max(...ref.notes.map((t) => (ref.opts.at as number) + t.startSec + t.durSec));
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

describe('speakers in port mode: the worker runs the recheck (R55)', () => {
  it('a ranked speaker take: recheck measured by the worker, no gate failure, ranked', async () => {
    const cal: Calibration = { ...makeCalibration(ROUTE), roundTripMs: 50, spreadMs: 1, clicksDetected: 10, templates: {} };
    const h = await harness({ backend: { route: { routeKey: ROUTE, outputMode: 'speakers' }, loopback: { rtlSec: 0.05, gainDb: -30 } }, calibration: cal, portMode: true });
    await h.session.prepare(settings({ outputMode: 'speakers' }));
    await h.session.ensureAudio();
    h.session.revealScan();
    await h.session.startTake();
    for (let i = 0; i < 20 && h.be.log.scheduledTakes.length === 0; i++) await flush();
    play(h, 0.05);
    await driveTo(h, 'results', 90);
    const rec = lastRecord(h);
    const rc = rec.calibration.recheck!;
    expect(rc.status).toBe('measured');
    expect(Math.abs(rc.measuredMs! - 50)).toBeLessThanOrEqual(2);
    expect(rc.usedFresh).toBe(false);
    // Port mode: no main-thread relay, so the recheck came from the worker's 'recheck' reply.
    expect(rec.audioEnv.captureRelay).toBe(false);
    expect(h.workers[0]!.core.returned).toBeGreaterThan(0);
    expect(rec.audioEnv.gateFailures).toEqual([]);
    const score = rec.score!;
    const msg = `score ${score.score} ${score.grade} reasons ${score.rankedReasons} ` +
      rec.judgments.filter((j) => j.status !== 'matched' || j.timing !== 'on-time').map((j) => `#${j.expectedIdx} ${j.status} ${j.timing}`).join('; ');
    expect(score.rankedReasons, msg).toEqual([]);
    expect(score.ranked, msg).toBe(true);
    expect(score.score, msg).toBeGreaterThanOrEqual(80);
  }, 90_000);

  it('a stored latency 15 ms off: the worker measures the shift, the take uses the fresh value and stays ranked (R31)', async () => {
    const cal: Calibration = { ...makeCalibration(ROUTE), roundTripMs: 35, spreadMs: 1, clicksDetected: 10, templates: {} };
    const h = await harness({ backend: { route: { routeKey: ROUTE, outputMode: 'speakers' }, loopback: { rtlSec: 0.05, gainDb: -30 } }, calibration: cal, portMode: true });
    await h.session.prepare(settings({ outputMode: 'speakers' }));
    await h.session.ensureAudio();
    h.session.revealScan();
    await h.session.startTake();
    for (let i = 0; i < 20 && h.be.log.scheduledTakes.length === 0; i++) await flush();
    play(h, 0.05);
    await driveTo(h, 'results', 90);
    const rec = lastRecord(h);
    const rc = rec.calibration.recheck!;
    expect(rc.status).toBe('measured');
    expect(rc.usedFresh).toBe(true);
    expect(rc.promptRecalibrate).toBe(true);
    expect(Math.abs(rec.calibration.latencyCompensationMs - 50)).toBeLessThanOrEqual(2);
    expect(rec.audioEnv.gateFailures).toEqual([]);
    expect(rec.score!.rankedReasons).toEqual([]);
    expect(h.events.some((e) => e.type === 'recalibrate-prompt')).toBe(true);
  }, 90_000);
});

describe('Hear it (05 §9, 08 session package)', () => {
  const SOUND_CALLS = new Set(['playNotes', 'playClicks', 'playTone']);

  it('ranked Listen first: practice now, the countdown runs on without auto start, the attempt records listened-first', async () => {
    const h = await harness({ calibration: playAlong(40) });
    const prepared = await h.session.prepare(settings());
    expect(h.session.view.getState().mode).toBe('ranked');
    await h.session.ensureAudio();
    h.session.revealScan();
    await drive(h, 2);
    const before = h.events.filter((e) => e.type === 'scan-tick').length;
    await h.session.listenFirst();
    // The take is practice at once; the chip reads the view.
    expect(h.session.pending!.mode).toBe('practice');
    expect(h.session.pending!.listenedFirst).toBe(true);
    expect(h.session.view.getState()).toMatchObject({ mode: 'practice', listenedFirst: true });
    // It plays: one bar of clicks, then the excerpt.
    expect(h.be.log.clickPlays).toHaveLength(1);
    expect(h.be.log.clickPlays[0]!.times).toHaveLength(prepared.meter.countsPerBar);
    expect(h.be.log.notePlays).toHaveLength(1);
    expect(h.session.sounds.getState().playing).toBe('listen');
    // The countdown never pauses, and at 0 a practice take does not start by itself.
    const scanSec = cfg.levelByNumber[prepared.levelServed]!.scanSec;
    await drive(h, scanSec);
    const ticks = h.events.filter((e) => e.type === 'scan-tick');
    expect(ticks.length).toBeGreaterThan(before + 5);
    expect(h.session.view.getState().scan).toEqual({ remainingSec: 0, expired: true });
    expect(h.session.state).toBe('scanning');
    expect(h.be.log.scheduledTakes).toHaveLength(0);

    await h.session.startTake();
    play(h, 0.04);
    await driveTo(h, 'results', 60);
    const rec = lastRecord(h);
    expect(rec.settingsResolved.mode).toBe('practice');
    expect(rec.score!.rankedReasons).toContain('listened-first');
    expect(rec.score!.rankedReasons).not.toContain('practice-mode');
    expect(rec.score!.ranked).toBe(false);
  }, 60_000);

  it('practice Listen first plays with no mode change', async () => {
    const h = await harness();
    await h.session.prepare(settings({ mode: 'practice' }));
    await h.session.ensureAudio();
    h.session.revealScan();
    await h.session.listenFirst();
    expect(h.session.pending).toMatchObject({ mode: 'practice', listenedFirst: false });
    expect(h.session.view.getState()).toMatchObject({ mode: 'practice', listenedFirst: false });
    expect(h.be.log.notePlays).toHaveLength(1);
    expect(h.be.log.clickPlays).toHaveLength(1);
  }, 30_000);

  it('nothing but the metronome and the voice reference plays from scheduleTake to the end of the take', async () => {
    const h = await harness({ options: { soundPrefs: () => ({ sound: 'woodblock', accent: false, a4Hz: 440, listening: false }) } });
    await h.session.prepare(settings({ instrumentId: 'voice-alto', mode: 'practice', listening: false, accentFirstBeat: false }));
    await h.session.ensureAudio();
    h.session.revealScan();
    await h.session.listen();
    const listenAt = h.be.log.calls.length;
    await h.session.startTake();
    const calls = h.be.log.calls.map((c) => c.method);
    // "Start playing" stops the sound first, then the voice reference plays (R7), then the take is scheduled.
    const stopAt = calls.indexOf('stopSounds', listenAt);
    const toneAt = calls.indexOf('playNotes', listenAt);
    const schedAt = calls.indexOf('scheduleTake');
    expect(stopAt).toBeGreaterThan(-1);
    expect(stopAt).toBeLessThan(toneAt);
    expect(toneAt).toBeLessThan(schedAt);
    expect(h.session.sounds.getState().playing).toBe('reference');
    // The sound and accent settings reach the take's schedule.
    expect(h.be.log.scheduledTakes[0]!.params).toMatchObject({ timbre: 'tick', accent: false });

    // Every sound control is refused during the count-in and the take.
    await drive(h, 0.2);
    expect(['count-in', 'performing']).toContain(h.session.state);
    await expect(h.session.listen()).rejects.toThrow(/during a take/);
    await expect(h.session.hearTempo()).rejects.toThrow(/during a take/);
    await expect(h.session.hearKey()).rejects.toThrow(/during a take/);
    await expect(h.session.playNote(60)).rejects.toThrow(/during a take/);
    await expect(h.session.previewSound('beep')).rejects.toThrow(/during a take/);
    await expect(h.session.hearBar(1)).rejects.toThrow(/during a take/);
    await expect(h.session.playVoiceReference()).rejects.toThrow(/during a take/);
    await expect(h.session.listenFirst()).rejects.toThrow(/listenFirst/);
    h.session.stopSounds();
    await driveTo(h, 'performing', 10);
    await expect(h.session.listen()).rejects.toThrow(/during a take/);
    await driveTo(h, 'results', 60);
    const end = h.be.log.calls.length;
    const during = h.be.log.calls.slice(schedAt, end).map((c) => c.method);
    expect(during.filter((m) => SOUND_CALLS.has(m))).toEqual([]);
    // Listening after results is free.
    await h.session.listen({ slower: true });
    // Listen, the starting pitch (sampled notes since round 2), then Listen again.
    expect(h.be.log.notePlays).toHaveLength(3);
  }, 60_000);

  it('the ranked auto start stops a sound first, and Hear the tempo keeps the take ranked', async () => {
    const h = await harness();
    const prepared = await h.session.prepare(settings());
    await h.session.ensureAudio();
    h.session.revealScan();
    await h.session.hearTempo();
    expect(h.session.pending!.mode).toBe('ranked');
    expect(h.be.log.clickPlays[0]!.times).toHaveLength(prepared.meter.countsPerBar);
    const afterTempo = h.be.log.calls.length;
    const scanSec = cfg.levelByNumber[prepared.levelServed]!.scanSec;
    await driveTo(h, 'count-in', scanSec + 1);
    for (let i = 0; i < 20 && h.be.log.scheduledTakes.length === 0; i++) await flush();
    const calls = h.be.log.calls.slice(afterTempo).map((c) => c.method);
    expect(calls.indexOf('stopSounds')).toBeGreaterThan(-1);
    expect(calls.indexOf('stopSounds')).toBeLessThan(calls.indexOf('scheduleTake'));
    expect(h.session.view.getState().mode).toBe('ranked');
    h.session.dispose();
  }, 30_000);

  it('hearTempo with no excerpt: one bar at the set tempo with the chosen sound and accent setting', async () => {
    let accent = true;
    const h = await harness({ options: { soundPrefs: () => ({ sound: 'beep', accent, a4Hz: 440, listening: true }) } });
    await h.session.hearTempo(72, 3);
    const p = h.be.log.clickPlays[0]!;
    expect(p.sound).toBe('beep');
    expect(p.accents).toEqual([true, false, false]);
    const t = p.times.map((x) => x as number);
    expect(t[1]! - t[0]!).toBeCloseTo(60 / 72, 9);
    expect(t[2]! - t[1]!).toBeCloseTo(60 / 72, 9);
    expect(t[0]!).toBeGreaterThan(h.be.now() as number);
    expect(h.session.sounds.getState()).toMatchObject({ playing: 'tempo', caption: { kind: 'tempo', bpm: 72 } });
    accent = false;
    await h.session.hearTempo(120, 4);
    expect(h.be.log.clickPlays[1]!.accents).toEqual([false, false, false, false]);
    // One sound at a time: each start stops the one before.
    expect(h.be.log.stopSounds).toBe(2);
    await expect(h.session.hearTempo()).rejects.toThrow(/needs a tempo/);
  });

  it('hearKey: a B♭ clarinet reading A major sounds G major, root at or below the first note', async () => {
    const h = await harness();
    let prepared;
    for (const level of [3, 4, 2, 5, 6, 1]) {
      try {
        prepared = await h.session.prepare(settings({ instrumentId: 'clarinet-bb', level, mode: 'practice', writtenKey: { fifths: 3, mode: 'major' } }));
        break;
      } catch {
        // No A major clarinet excerpt at this level in the fixture corpus; try the next.
      }
    }
    expect(prepared, 'an A major clarinet excerpt in the fixture corpus').toBeDefined();
    expect(prepared!.writtenKey).toEqual({ fifths: 3, mode: 'major' });
    expect(prepared!.concertKey).toEqual({ fifths: 1, mode: 'major' });
    await h.session.hearKey();
    const first = h.session.plan!.expected[0]!.concertMidi;
    const notes = h.be.log.notePlays[0]!.notes;
    const midis = notes.map((n) => Math.round(69 + 12 * Math.log2(n.hz / 440)));
    expect(((midis[0]! % 12) + 12) % 12).toBe(7); // G
    expect(midis[1]! - midis[0]!).toBe(4);
    expect(midis[2]! - midis[0]!).toBe(7);
    expect(midis[0]!).toBeLessThanOrEqual(first);
    expect(first - midis[0]!).toBeLessThan(12);
    // The caption names the written key (designer's note 4).
    expect(h.session.sounds.getState().caption).toEqual({ kind: 'key-chord', writtenKey: { fifths: 3, mode: 'major' }, concertKey: { fifths: 1, mode: 'major' } });
  }, 30_000);

  it('playNote, previewSound, hearBar and stopSounds', async () => {
    const h = await harness();
    await h.session.playNote(60);
    expect(h.be.log.notePlays[0]!.notes).toEqual([{ hz: midiToFreq(60, 440), startSec: 0, durSec: 1 }]);
    await h.session.previewSound('woodblock');
    const pv = h.be.log.clickPlays[0]!;
    expect(pv.sound).toBe('woodblock');
    expect(pv.accents).toEqual([true, false, false, false]);
    expect((pv.times[1]! as number) - (pv.times[0]! as number)).toBeCloseTo(60 / 90, 9);
    expect(h.session.sounds.getState().playing).toBe('preview');
    h.session.stopSounds();
    expect(h.session.sounds.getState().playing).toBeNull();

    const prepared = await h.session.prepare(settings({ mode: 'practice' }));
    await h.session.hearBar(1);
    const bar = h.be.log.notePlays.at(-1)!.notes;
    const inBar1 = h.session.plan!.expected.filter((e) => e.bar === (prepared.pickupTicks > 0 ? 0 : 1) || e.bar === 1).length;
    expect(bar.length).toBeGreaterThan(0);
    expect(bar.length % 2).toBe(0);
    expect(bar.length).toBeLessThanOrEqual(2 * inBar1);
    expect(h.session.sounds.getState().playing).toBe('bar');
  }, 30_000);

  it('Listen for a stored attempt rebuilds its excerpt at the take tempo', async () => {
    const h = await harness();
    const prepared = await h.session.prepare(settings({ mode: 'practice', listening: false }));
    await h.session.ensureAudio();
    h.session.revealScan();
    await h.session.startTake();
    await driveTo(h, 'results', 60);
    const rec = lastRecord(h);
    const again = await h.session.preparedForRecord({ ...rec, id: 'another-attempt' });
    expect(again).not.toBeNull();
    expect(again!.measures).toEqual(prepared.measures);
    expect(again!.writtenKey).toEqual(prepared.writtenKey);
    await h.session.listen({ record: { ...rec, id: 'another-attempt' }, fromBar: 2, slower: true });
    expect(h.session.sounds.getState()).toMatchObject({ playing: 'listen', fromBar: 2, slower: true, attemptId: 'another-attempt' });
    const clicks = h.be.log.clickPlays.at(-1)!.times.map((t) => t as number);
    expect(clicks[1]! - clicks[0]!).toBeCloseTo(60 / (rec.bpm * 0.75), 9);
    // A withdrawn or unknown excerpt gives null, and Listen refuses.
    expect(await h.session.preparedForRecord({ ...rec, id: 'x', excerptId: 'nope' })).toBeNull();
    await expect(h.session.listen({ record: { ...rec, id: 'x', excerptId: 'nope' } })).rejects.toThrow(/not available/);
  }, 60_000);

  it('rankedAvailability: the calibration-unmeasured predicate plus the microphone', async () => {
    const h = await harness({ calibration: playAlong(40) });
    expect(await h.session.rankedAvailability({ routeKey: ROUTE, listening: true, outputMode: 'wired' })).toEqual({ available: true, block: null });
    expect(await h.session.rankedAvailability({ routeKey: 'other', listening: true, outputMode: 'wired' })).toEqual({ available: false, block: 'calibration' });
    expect(await h.session.rankedAvailability({ routeKey: ROUTE, listening: false, outputMode: 'wired' })).toEqual({ available: false, block: 'mic' });
    // Before any unlock the route is unknown: a measured calibration for the chosen output mode counts.
    expect(await h.session.rankedAvailability({ listening: true, outputMode: 'wired' })).toEqual({ available: true, block: null });
    expect(await h.session.rankedAvailability({ listening: true, outputMode: 'speakers' })).toEqual({ available: false, block: 'calibration' });
    await h.repos.calibrations.put({ ...playAlong(40), stale: true });
    expect(await h.session.rankedAvailability({ routeKey: ROUTE, listening: true, outputMode: 'wired' })).toEqual({ available: false, block: 'calibration' });
    const denied = await harness({ backend: { permission: 'denied' } });
    expect(await denied.session.rankedAvailability({ routeKey: ROUTE, listening: true, outputMode: 'wired' })).toEqual({ available: false, block: 'mic' });
  });
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

describe('own playback in the capture (round 2 detection: reference tone and clicks through the speakers)', () => {
  // The owner (voice, built-in speakers and mic) saw purple marks at the start of the staff as the take began: the
  // starting-pitch reference played through the speakers, the mic heard it, and the session analysed it as sung notes
  // drawn as extra ghosts before bar 1. Nothing heard before the first written note's window may be judged or drawn.
  const cal = (): Calibration => ({ ...makeCalibration(ROUTE), roundTripMs: 50, spreadMs: 1, clicksDetected: 10, templates: {} });
  /** Note starts and ghosts more than a beat before the first written note (its match window is at most a beat). */
  const early = (h: Harness): SessionEvent[] => {
    const prepared = h.session.prepared!;
    const bpm = prepared.selection.settings.bpm;
    const firstBeat = (buildExpectedNotes(prepared, bpm, cfg)[0]!.onsetSec * bpm) / 60;
    return h.events.filter((e) => e.type === 'follower' && (e.event.type === 'note-start' || e.event.type === 'ghost') && (e.event.type === 'note-start' ? e.event.scoreBeat : e.event.ghost.scoreBeat) < firstBeat - 1);
  };

  for (const bleedDb of [-10, -20, -30]) {
    it(`voice on speakers, reference and clicks bleeding at ${bleedDb} dB: no note before bar 1 is drawn or judged`, async () => {
      const h = await harness({ backend: { route: { routeKey: ROUTE, outputMode: 'speakers' }, loopback: { rtlSec: 0.05, gainDb: bleedDb, toneGainDb: bleedDb } }, calibration: cal(), shippedCorpus: true });
      await h.session.prepare(settings({ instrumentId: 'voice-baritone', mode: 'practice', outputMode: 'speakers', level: 1 }));
      await h.session.ensureAudio();
      h.session.revealScan();
      await h.session.startTake();
      for (let i = 0; i < 20 && h.be.log.scheduledTakes.length === 0; i++) await flush();
      play(h, 0.05);
      await driveTo(h, 'results', 90);
      const rec = lastRecord(h);
      // Round 2 (05 R18): the reference is sampled notes in the voice's set, mixed into the capture by the fake.
      expect(h.be.log.tones).toEqual([]);
      expect(h.be.log.noteSounds).toEqual(['voice-baritone']);
      expect(h.be.log.notePlays[0]!.notes).toHaveLength(4);
      expect(early(h)).toEqual([]);
      expect(rec.extras.filter((x) => x.onsetSec < 0)).toEqual([]);
      // The first note is the singer's, not the reference tone's.
      const j0 = rec.judgments[0]!;
      expect(j0.status).toBe('matched');
      expect(Math.abs(j0.timingErrorMs ?? 0)).toBeLessThan(80);
    }, 90_000);
  }

  it('a silent voice take with the reference bleeding at -10 dB: nothing is detected as played', async () => {
    const h = await harness({ backend: { route: { routeKey: ROUTE, outputMode: 'speakers' }, loopback: { rtlSec: 0.05, gainDb: -10, toneGainDb: -10 } }, calibration: cal(), shippedCorpus: true });
    await h.session.prepare(settings({ instrumentId: 'voice-baritone', mode: 'practice', outputMode: 'speakers', level: 1 }));
    await h.session.ensureAudio();
    h.session.revealScan();
    await h.session.startTake();
    await driveTo(h, 'performing', 30);
    await drive(h, 2);
    expect(h.events.filter((e) => e.type === 'follower' && (e.event.type === 'note-start' || e.event.type === 'ghost'))).toEqual([]);
  }, 60_000);
});

describe('diagnostics per try (round 2 detection)', () => {
  const cal = (): Calibration => ({ ...makeCalibration(ROUTE), roundTripMs: 50, spreadMs: 1, clicksDetected: 10, templates: {} });
  async function voiceTry(includeAudio: boolean): Promise<{ h: Harness; rec: AttemptRecord }> {
    const h = await harness({ backend: { route: { routeKey: ROUTE, outputMode: 'speakers' }, loopback: { rtlSec: 0.05, gainDb: -20, toneGainDb: -20 } }, calibration: cal(), shippedCorpus: true });
    await h.session.setDiagnosticsSettings({ includeAudio });
    await h.session.prepare(settings({ instrumentId: 'voice-baritone', mode: 'practice', outputMode: 'speakers', level: 1 }));
    await h.session.ensureAudio();
    h.session.revealScan();
    await h.session.startTake();
    for (let i = 0; i < 20 && h.be.log.scheduledTakes.length === 0; i++) await flush();
    play(h, 0.05);
    await driveTo(h, 'results', 90);
    return { h, rec: lastRecord(h) };
  }

  it('keeps a compact trace of every try, without audio by default, exportable as one JSON file', async () => {
    const { h, rec } = await voiceTry(false);
    expect(await h.session.diagnosticsSettings()).toEqual({ includeAudio: false });
    const out = (await h.session.exportLastTry())!;
    expect(out.fileName).toMatch(/^sightread-try-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
    expect(out.text.length).toBeLessThan(200_000);
    const t = (JSON.parse(out.text) as DiagnosticsFile).tries[0]!;
    expect(t.attemptId).toBe(rec.id);
    expect(t.audio).toBeUndefined();
    expect(t.configs.dsp?.oneNote).not.toBeNull();
    expect(t.configs.follow?.instrumentId).toBe('voice-baritone');
    // About 50 Hz of frames over the whole capture.
    const f = t.frames!;
    expect(f.t.length).toBeGreaterThan(100);
    expect((f.t.at(-1)! - f.t[0]!) / (f.t.length - 1)).toBeCloseTo(0.024, 1);
    // The reference tones heard through the speakers are traced as ignored notes; the sung notes are not.
    expect(t.playback.reference).toHaveLength(4);
    expect(t.playback.countIn.length).toBeGreaterThan(0);
    expect(t.detected.filter((d) => d.ignored).length).toBeGreaterThanOrEqual(4);
    expect(t.detected.filter((d) => !d.ignored).length).toBe(rec.detected.length);
    expect(t.events.some((e) => e.event.type === 'final')).toBe(true);
    expect(t.events.some((e) => e.event.type === 'clock')).toBe(false);
    expect(t.verdicts.judgments).toEqual(rec.judgments);
    expect(await h.session.exportAttempt(rec.id)).not.toBeNull();
    expect(await h.session.exportAttempt('not-an-attempt')).toBeNull();
    // Device-local: diagnostics never go into the backup file.
    expect((await h.repos.attempts.all()).length).toBe(1);
    expect(await h.session.diagnosticsAttemptIds()).toEqual([rec.id]);
  }, 90_000);

  it('with the opt-in setting the export carries the try audio as 16 kHz mono PCM', async () => {
    const { h } = await voiceTry(true);
    const t = (await h.session.exportLastTry())!.file.tries[0]!;
    expect(t.audio?.rate).toBe(16000);
    const samples = decodePcm16(t.audio!.data, t.audio!.samples);
    expect(samples.length / 16000).toBeGreaterThan(5);
    let peak = 0;
    for (const v of samples) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeGreaterThan(0.01);
  }, 90_000);
});

describe('round 2: sampled sounds, the starting pitch, what we heard, start errors (R2-06)', () => {
  /** Every caption the sound store showed, in order. */
  const captionsOf = (h: Harness): SoundCaption[] => {
    const out: SoundCaption[] = [];
    h.session.sounds.subscribe((v) => {
      if (v.caption && out.at(-1) !== v.caption) out.push(v.caption);
    });
    return out;
  };

  it('the starting pitch: 0.6 s of the card, the voice set, then one beat of silence before the first click (fake clock, 5 ms)', async () => {
    const h = await harness({ clockTimers: true });
    await h.session.prepare(settings({ instrumentId: 'voice-baritone', mode: 'practice' }));
    await h.session.ensureAudio();
    h.session.revealScan();
    const captions = captionsOf(h);
    const pressedAt = h.be.now() as number;
    await h.session.startTake();
    for (let i = 0; i < 20 && h.be.log.scheduledTakes.length === 0; i++) await flush();
    const ref = h.be.log.notePlays[0]!;
    expect(h.be.log.noteSounds).toEqual(['voice-baritone']);
    expect((ref.opts.at as number) - pressedAt).toBeCloseTo(VOICE_REFERENCE_LEAD_SEC, 6);
    const firstNoteEnd = Math.max(...ref.notes.map((n) => (ref.opts.at as number) + n.startSec + n.durSec));
    const firstClick = h.be.log.scheduledTakes[0]!.clicks[0]!.t as number;
    const beat = 60 / h.session.plan!.bpm;
    expect(Math.abs(firstClick - firstNoteEnd - beat)).toBeLessThanOrEqual(0.005);
    // The captions: key chord, first note, then "Count-in next" during the gap.
    await drive(h, firstNoteEnd - (h.be.now() as number) + beat / 2);
    expect(captions.map((c) => c.kind)).toEqual(['key-chord', 'first-note', 'count-in-next']);
    // The follower ignores each reference note through its release.
    const trace = await (async () => {
      await driveTo(h, 'results', 90);
      return (await h.session.exportLastTry())!.file.tries[0]!;
    })();
    expect(trace.playback.reference).toHaveLength(4);
    expect(trace.playback.reference[3]!.durSec).toBeCloseTo(ref.notes[3]!.durSec + 0.3, 6);
  }, 90_000);

  it('autoReference off: no starting pitch is scheduled and the try can still be ranked', async () => {
    const h = await harness({ calibration: playAlong(40), shippedCorpus: true });
    await h.session.prepare(settings({ instrumentId: 'voice-baritone', level: 1, autoReference: false }));
    await h.session.ensureAudio();
    h.session.revealScan();
    await h.session.startTake();
    for (let i = 0; i < 20 && h.be.log.scheduledTakes.length === 0; i++) await flush();
    expect(h.be.log.notePlays).toEqual([]);
    expect(h.be.log.tones).toEqual([]);
    expect(h.be.log.scheduledTakes[0]!.params.leadSec).toBeCloseTo(0.6, 9);
    play(h, 0.04);
    await driveTo(h, 'results', 90);
    const rec = lastRecord(h);
    expect(h.be.log.notePlays).toEqual([]);
    expect(rec.score!.rankedReasons).toEqual([]);
    expect(rec.score!.ranked).toBe(true);
  }, 90_000);

  it('a forced clock-rate error never throws: the try reaches the count-in and is practice, with the clock-rate gate failure', async () => {
    const h = await harness({ calibration: playAlong(40), backend: { clockRateError: 0.088 } });
    await h.session.prepare(settings());
    await h.session.ensureAudio();
    h.session.revealScan();
    await h.session.startTake();
    expect(h.session.state).toBe('count-in');
    expect(h.session.lastError).toBeNull();
    play(h, 0.04);
    await driveTo(h, 'results', 60);
    const rec = lastRecord(h);
    expect(rec.audioEnv.clockRateError).toBe(0.088);
    expect(rec.audioEnv.gateFailures).toContain('sample-rate');
    expect(rec.score!.ranked).toBe(false);
    // RankedReason has no 'clock-rate' value yet (core/types.ts): the gate maps it to 'measurement' until it does.
    expect(rec.score!.rankedReasons).toContain('measurement');
  }, 60_000);

  it('start errors carry their kind: the sound (audio-start) or the microphone (mic-start)', async () => {
    const named = (name: string): Error => Object.assign(new Error(name), { name });
    for (const [err, code, kind] of [
      [named('NotAllowedError'), 'mic-denied', 'mic-start'],
      [named('NotReadableError'), 'audio-setup', 'mic-start'],
      [new Error('context would not resume'), 'audio-setup', 'audio-start'],
    ] as const) {
      const h = await harness();
      await h.session.prepare(settings({ mode: 'practice' }));
      h.be.unlock = () => Promise.reject(err);
      await expect(h.session.ensureAudio()).rejects.toMatchObject({ code, kind });
      expect(h.session.lastError).toBeInstanceOf(SessionError);
    }
    // The microphone fails to open at the start of the take.
    const h = await harness();
    await h.session.prepare(settings({ mode: 'practice' }));
    await h.session.ensureAudio();
    h.session.revealScan();
    h.be.startCapture = () => Promise.reject(named('NotReadableError'));
    await expect(h.session.startTake()).rejects.toMatchObject({ kind: 'mic-start' });
    expect(h.session.state).toBe('error');
    // Audio closed between tries: the sound did not start.
    const g = await harness();
    await g.session.prepare(settings({ mode: 'practice' }));
    g.session.revealScan();
    await expect(g.session.startTake()).rejects.toMatchObject({ code: 'audio-setup', kind: 'audio-start' });
  }, 30_000);

  it('every note plays in the instrument\'s sampled sound: range note, key chord, Listen, Hear bar', async () => {
    const h = await harness();
    await h.session.playNote(48, 'euphonium-bc');
    await h.session.playNote(60);
    expect(h.be.log.noteSounds).toEqual(['trombone', null]);
    expect(h.session.sounds.getState().instrumentId).toBeNull();
    await h.session.prepare(settings({ instrumentId: 'clarinet-bb', mode: 'practice' }));
    await h.session.playNote(60);
    await h.session.hearKey();
    await h.session.listen();
    await h.session.hearBar(1);
    expect(h.be.log.noteSounds.slice(2)).toEqual(['clarinet', 'clarinet', 'clarinet', 'clarinet']);
  }, 30_000);

  it('playRange: four notes rising, 0.8 s each with 0.15 s between, in the voice set, with the note index as caption; no excerpt needed', async () => {
    const h = await harness({ clockTimers: true });
    const captions = captionsOf(h);
    await h.session.playRange('voice-baritone', [43, 48, 60, 64]);
    const p = h.be.log.notePlays[0]!;
    expect(p.opts.sound).toBe('voice-baritone');
    expect(p.notes.map((n) => [n.startSec, n.durSec])).toEqual([0, 0.95, 1.9, 2.85].map((t) => [expect.closeTo(t, 9), 0.8]));
    expect(p.notes.map((n) => Math.round(69 + 12 * Math.log2(n.hz / 440)))).toEqual([43, 48, 60, 64]);
    expect(h.session.sounds.getState()).toMatchObject({ playing: 'range', instrumentId: 'voice-baritone' });
    await drive(h, 3.3);
    expect(captions).toEqual([0, 1, 2, 3].map((index) => ({ kind: 'range-note', index, midi: [43, 48, 60, 64][index] })));
    await drive(h, 1);
    expect(h.session.sounds.getState().playing).toBeNull();
    await expect(h.session.playRange('voice-baritone', [])).rejects.toThrow(/at least one note/);
  });

  it('prepareSound loads the instrument\'s set and never rejects', async () => {
    const h = await harness({ backend: { readySounds: ['flute'] } });
    expect(await h.session.prepareSound('flute')).toBe('ready');
    expect(await h.session.prepareSound('tuba')).toBe('fallback');
    expect(await h.session.prepareSound('kazoo')).toBe('fallback');
    expect(h.be.log.soundPrepares).toEqual(['flute', 'tuba']);
    expect(h.be.log.unlocks).toBe(0);
  });

  it('playHeard: one note per detected note at its onset and pitch, in the instrument\'s sound, with bar captions', async () => {
    const h = await harness({ calibration: playAlong(40), clockTimers: true });
    const prepared = await h.session.prepare(settings({ mode: 'practice' }));
    await h.session.ensureAudio();
    h.session.revealScan();
    await h.session.startTake();
    play(h, 0.04);
    await driveTo(h, 'results', 60);
    const rec = lastRecord(h);
    const t0 = (await h.session.exportLastTry())!.file.tries[0]!.playback.t0;
    const src = listenSourceOf(prepared, cfg);
    const beat = 60 / rec.bpm;
    const zero = t0 + rec.calibration.latencyCompensationMs / 1000;
    const heard = rec.detected.filter((d) => (d.onset as number) >= zero - (src.pickupBeats + 1) * beat).sort((a, b) => (a.onset as number) - (b.onset as number));
    expect(heard.length).toBeGreaterThan(3);
    const captions = captionsOf(h);
    const before = h.be.log.notePlays.length;
    await h.session.playHeard(rec.id);
    const p = h.be.log.notePlays[before]!;
    expect(p.opts.sound).toBe('flute');
    expect(p.notes).toHaveLength(heard.length);
    p.notes.forEach((n, i) => {
      const d = heard[i]!;
      expect(n.startSec).toBeCloseTo((d.onset as number) - (heard[0]!.onset as number), 3);
      expect(n.hz).toBeCloseTo(midiToFreq(d.midi, 440), 6);
    });
    expect(h.session.sounds.getState()).toMatchObject({ playing: 'heard', attemptId: rec.id });
    await drive(h, Math.max(...p.notes.map((n) => n.startSec + n.durSec)) + 0.2);
    expect(captions.length).toBeGreaterThan(1);
    for (const c of captions) expect(c).toMatchObject({ kind: 'heard-bar', of: src.totalBars });
    const bars = captions.map((c) => (c as { bar: number }).bar);
    expect(bars).toEqual([...bars].sort((a, b) => a - b));

    // A try with nothing detected rejects with no-notes.
    await h.repos.attempts.add({ ...rec, id: 'silent-try', detected: [], judgments: [], extras: [] });
    await expect(h.session.playHeard('silent-try')).rejects.toThrow('no-notes');
  }, 60_000);

  it('diagnostics files: sightread-try-{local start}.json and sightread-tries-{local now}.json', async () => {
    const h = await harness();
    await h.session.prepare(settings({ mode: 'practice' }));
    expect(await h.session.exportRecentTries()).toBeNull();
    await h.session.ensureAudio();
    h.session.revealScan();
    await h.session.startTake();
    play(h, 0.04);
    await driveTo(h, 'results', 60);
    const one = (await h.session.exportLastTry())!;
    expect(one.fileName).toMatch(/^sightread-try-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
    expect(one.file.tries[0]!.startedAt).toBeDefined();
    const all = (await h.session.exportRecentTries())!;
    expect(all.fileName).toMatch(/^sightread-tries-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
    expect(all.file.tries.map((t) => t.attemptId)).toEqual([lastRecord(h).id]);
  }, 60_000);
});
