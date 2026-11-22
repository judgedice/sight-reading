// A scale try (PLAN ruling 68) on the fake backend: the same try pipeline as an excerpt (starting pitch, count-in, the
// DSP worker, live follower, final alignment, grading, the record, diagnostics, Listen from history), always practice,
// and nothing changes in the profile: no XP, rank, streak, level window or difficulty.
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import attemptSchema from '../../schemas/attempt-record.schema.json';
import scalesJson from '../../config/scales.json';
import type { PlatformServices, WorkerLike, WorkerMessage, WorkerReply } from '../core/platform.ts';
import type { AttemptRecord, CorpusManifest, PracticeSettings, SessionEvent } from '../core/types.ts';
import { configs } from '../../fixtures/follow/gen/io.ts';
import { perform } from '../../fixtures/follow/gen/perform.ts';
import { buildExpectedNotes, loadManifest, loadScales, scaleExcerptId } from '../corpus/index.ts';
import { createRng } from '../core/rng.ts';
import { createEmitter } from '../core/events.ts';
import { DspWorkerCore } from '../platform/web/audio/dsp-worker-core.ts';
import { FakeAudioBackend } from '../testkit/fake-backend.ts';
import { renderPerformance, type SynthNoteSpec } from '../testkit/synth/index.ts';
import { MemoryKv, makeCalibration, memoryRepos } from '../store/test-data.ts';
import { summarizeAttempt } from '../store/summary.ts';
import { PracticeSession, type PracticeSessionOptions } from './index.ts';

const cfg = configs();
const scales = loadScales(scalesJson, cfg);
const RATE = 48000;
const ROUTE = 'fake-route';
const DAY = '2026-11-20';
const FIXTURE_DIR = new URL('../../fixtures/corpus/', import.meta.url);
const assets: PlatformServices['assets'] = {
  getJson: <T,>(rel: string) => Promise.resolve(JSON.parse(readFileSync(new URL(rel.slice(rel.lastIndexOf('/') + 1), FIXTURE_DIR), 'utf8')) as T),
};
let manifestP: Promise<CorpusManifest> | null = null;
const manifest = (): Promise<CorpusManifest> => (manifestP ??= loadManifest(assets));
const validAttempt = addFormats(new Ajv({ strict: false, allErrors: true })).compile(attemptSchema);
const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

class TestBackend extends FakeAudioBackend {
  captureClock = 0;
  override async startCapture(sink: Parameters<FakeAudioBackend['startCapture']>[0]): Promise<void> {
    this.captureClock = this.now() as number;
    return super.startCapture(sink);
  }
}

/** The DSP worker's logic in-process (relay mode); replies arrive asynchronously like a real worker's. */
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

async function harness(options: PracticeSessionOptions = {}) {
  const be = new TestBackend({ sampleRate: RATE, route: { routeKey: ROUTE, outputMode: 'wired', reportedLatencySec: 0.02 } });
  const kv = new MemoryKv();
  const repos = memoryRepos(kv);
  await repos.calibrations.put({ ...makeCalibration(ROUTE), method: 'play-along', outputMode: 'wired', roundTripMs: 40, spreadMs: 4, clicksDetected: 8, templates: {} });
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
    lifecycle: { onVisibility: (cb) => createEmitter<boolean>().on(cb) },
  };
  const session = new PracticeSession(
    { platform, configs: cfg, manifest: await manifest(), workerFactory: () => new NodeWorker() },
    { pollMs: 'manual', rng: createRng(7), finishTimeoutMs: 2000, scales, ...options },
  );
  const events: SessionEvent[] = [];
  session.events.on((e) => events.push(e));
  return { be, session, repos, events };
}
type H = Awaited<ReturnType<typeof harness>>;

const settings = (p: Partial<PracticeSettings> = {}): PracticeSettings => ({
  instrumentId: 'voice-baritone',
  level: 4,
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
});

async function drive(h: H, sec: number, until: () => boolean): Promise<void> {
  const end = (h.be.now() as number) + sec;
  while ((h.be.now() as number) < end - 1e-9 && !until()) {
    h.be.advance(0.02);
    h.session.poll();
    await flush();
  }
  for (let i = 0; i < 50 && !until(); i++) await flush();
}

/** Sings the scale on screen with the testkit's sung "ah", at t0 + RTL. */
function sing(h: H, rtlSec: number): void {
  const prepared = h.session.prepared!;
  const bpm = prepared.selection.settings.bpm;
  const expected = buildExpectedNotes(prepared, bpm, cfg);
  const offset = (h.be.log.scheduledTakes.at(-1)!.t0 as number) - h.be.captureClock + rtlSec;
  const notes: SynthNoteSpec[] = perform(expected, prepared.meter.countsPerBar, bpm, {}).map((p, k) => {
    const midi = Math.round(p.midi);
    return { midi, cents: Math.round((p.midi - midi) * 100 * 1000) / 1000, onsetSec: offset + p.onset, durSec: Math.max(0.02, p.dur), slur: p.legato, ref: k };
  });
  const last = notes.at(-1)!;
  h.be.setSource(renderPerformance({ timbre: 'voice', notes, sampleRate: RATE, durationSec: last.onsetSec + last.durSec + 2, seed: 5 }).samples);
}

const lastRecord = (h: H): AttemptRecord => {
  const r = [...h.events].reverse().find((e) => e.type === 'record');
  if (!r || r.type !== 'record') throw new Error('no record');
  return r.record;
};

describe('a scale try on the fake backend (PLAN ruling 68)', () => {
  it('goes straight to the read-through, sings to a graded, persisted, unranked result labelled as the scale', async () => {
    const h = await harness();
    const pending = h.session.prepareScale('five-note-c', settings(), 72);
    // Synchronous up to the read-through, so the chooser's click can open audio in the same gesture.
    expect(h.session.state).toBe('scanning');
    const prepared = await pending;
    // The new player's profile, as the read-through left it.
    const before = await h.repos.profile.get();
    expect(before).toBeDefined();
    // Straight to the read-through: no cover, practice whatever the setting asked.
    expect(h.session.state).toBe('scanning');
    expect(h.session.pending).toMatchObject({ mode: 'practice', revealed: true });
    expect(h.session.scale).toEqual({ scaleId: 'five-note-c', bpm: 72 });
    expect(prepared.excerptId).toBe(scaleExcerptId('voice-baritone', 'five-note-c'));
    expect(h.session.plan!.bpm).toBe(72);
    expect(h.session.plan!.countInBeats).toBe(4); // one bar (PLAN R70)

    await h.session.ensureAudio();
    await h.session.startTake();
    for (let i = 0; i < 20 && h.be.log.scheduledTakes.length === 0; i++) await flush();
    // The starting pitch played first (voice: the key chord, then the first note), in the baritone's own sound.
    expect(h.be.log.noteSounds).toEqual(['voice-baritone']);
    sing(h, 0.04);
    await drive(h, 60, () => h.session.state === 'results');
    expect(h.session.state).toBe('results');

    const rec = lastRecord(h);
    expect(validAttempt(rec), JSON.stringify(validAttempt.errors?.slice(0, 3))).toBe(true);
    // Graded with the same pipeline: every note heard, a score and a grade.
    expect(rec.score).not.toBeNull();
    expect(rec.score!.status).toBe('ok');
    expect(rec.score!.score).toBeGreaterThanOrEqual(80);
    expect(rec.judgments.filter((j) => j.status === 'matched')).toHaveLength(9);
    // Labelled as the scale and always practice: never ranked, no XP.
    expect(rec).toMatchObject({ kind: 'scale', scale: { id: 'five-note-c', pattern: 'five-note', mode: 'major' }, excerptId: 'scale:voice-baritone:five-note-c', levelServed: 1, bpm: 72, placement: false, excerptBurned: false });
    expect(rec.settingsResolved.mode).toBe('practice');
    expect(rec.score!.ranked).toBe(false);
    expect(rec.score!.rankedReasons).toContain('practice-mode');
    expect(rec.score!.xp).toEqual({ total: 0, base: 0, factors: [] });
    expect(rec.credit).toMatchObject({ composer: '', corpus: 'generated' });
    // Persisted, and the history row says it is a scale.
    expect(await h.repos.attempts.byId(rec.id)).toEqual(rec);
    expect(summarizeAttempt(rec)).toMatchObject({ kind: 'scale', ranked: false, xp: 0 });
    // The profile did not move: no XP, rank, streak, window, seen group or difficulty change.
    const after = await h.repos.profile.get();
    expect(after).toEqual(before);
    expect(after?.xp ?? 0).toBe(0);
    expect(after?.instruments['voice-baritone']?.window ?? []).toEqual([]);
    expect(Object.keys(after?.seenGroups ?? {})).toEqual([]);
    const progress = [...h.events].reverse().find((e) => e.type === 'progress');
    expect(progress?.type === 'progress' ? progress.events : null).toEqual([]);
    // Diagnostics are kept as for any try.
    const diag = await h.session.exportAttempt(rec.id);
    expect(diag?.file.tries[0]?.attemptId).toBe(rec.id);
    // History's Listen and marked score: the scale is written again from the record.
    const again = await h.session.preparedForRecord({ ...rec, id: 'other' });
    expect(again?.excerptId).toBe(prepared.excerptId);
    expect(again?.measures).toEqual(prepared.measures);
  }, 90_000);

  it('Same scale again and Next scale; a skip moves to the next scale; a failed prepare retries the scale', async () => {
    const h = await harness();
    await h.session.prepareScale('arpeggio-c', settings({ listening: false }));
    expect(h.session.plan!.bpm).toBe(60);
    await h.session.ensureAudio();
    await h.session.startTake();
    await drive(h, 40, () => h.session.state === 'results');
    expect(lastRecord(h)).toMatchObject({ kind: 'scale', score: null, listening: false });
    h.session.tryAgain();
    expect(h.session.state).toBe('scanning');
    expect(h.session.scale?.scaleId).toBe('arpeggio-c');
    await h.session.nextScale();
    expect(h.session.scale).toEqual({ scaleId: 'octave-a-minor', bpm: 60 });
    await h.session.skip();
    // The last scale wraps round to the first.
    expect(h.session.scale?.scaleId).toBe('five-note-c');
    expect(h.session.prepared?.scale?.id).toBe('five-note-c');
    await expect(h.session.prepareScale('no-such-scale', settings())).rejects.toThrow(/no scale/);
    expect(h.session.state).toBe('error');
    expect(h.session.retry()).toBe(true);
  }, 60_000);

  it('refuses without a scales config, and an excerpt try after a scale is a normal excerpt', async () => {
    const h = await harness({ scales: null });
    await expect(h.session.prepareScale('five-note-c', settings())).rejects.toThrow(/no scales/);
    const h2 = await harness();
    await h2.session.prepareScale('five-note-c', settings());
    const p = await h2.session.prepare(settings({ instrumentId: 'flute', level: 3 }));
    expect(p.scale).toBeUndefined();
    expect(h2.session.scale).toBeNull();
    expect(h2.session.state).toBe('covered');
  });
});
