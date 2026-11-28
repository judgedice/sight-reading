// T15 (docs/redesign/round3/03-pitch-steadiness.md §7): the "Pitch needle" setting and the needle's display filter
// never reach a try. The try pipeline (segmenter, live follower, live marks, final alignment, grading) must see the
// same inputs whatever the setting says.
//
// 1. Functional: the app is composed with each setting (and with none), a try is started on the fake backend, and the
//    worker's 'config' message (the take's DspConfig and FollowConfig) is identical in every case.
// 2. Structural: no module of the try pipeline names the setting or the filter, the take's config types have no field
//    for it, and inside the DSP worker only the pitch mode (Match a note) builds the filter.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PlatformServices, WorkerLike, WorkerMessage } from '../../core/platform.ts';
import type { CorpusManifest, PitchSteadiness } from '../../core/types.ts';
import { createRng } from '../../core/rng.ts';
import { createEmitter } from '../../core/events.ts';
import { loadManifest } from '../../corpus/index.ts';
import { defaultAppSettings } from '../../store/defaults.ts';
import { MemoryKv, memoryRepos } from '../../store/test-data.ts';
import { FakeAudioBackend } from '../../testkit/fake-backend.ts';
import { composeApp, type AppRuntime } from './app-services.ts';
import { appConfigs } from './configs.ts';

const ROOT = process.cwd();
const FIXTURES = join(ROOT, 'fixtures', 'corpus');
const assets: PlatformServices['assets'] = {
  getJson: <T>(rel: string) => Promise.resolve(JSON.parse(readFileSync(join(FIXTURES, rel.slice(rel.lastIndexOf('/') + 1)), 'utf8')) as T),
};
let manifestP: Promise<CorpusManifest> | null = null;
const manifest = (): Promise<CorpusManifest> => (manifestP ??= loadManifest(assets));
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Composes the app with `setting`, starts a try, and returns every message the take's worker was sent before 'ready'. */
async function takeConfig(setting: PitchSteadiness | undefined, instrumentId: string): Promise<WorkerMessage[]> {
  const kv = new MemoryKv();
  const repos = memoryRepos(kv);
  let ids = 0;
  const vis = createEmitter<boolean>();
  const sent: WorkerMessage[] = [];
  const worker: WorkerLike = { onmessage: null, postMessage: (m: WorkerMessage) => void sent.push(m), terminate: () => undefined };
  const base = defaultAppSettings();
  const settings = {
    ...base,
    onboardingDone: true,
    practice: { ...base.practice, instrumentId, level: 2, mode: 'practice' as const, listening: true, seed: 7 },
    display: { ...base.display, ...(setting ? { pitchSteadiness: setting } : {}) },
  };
  const rt: AppRuntime = {
    platform: {
      audio: new FakeAudioBackend({ sampleRate: 48000 }),
      repos,
      kv,
      keepAwake: async () => undefined,
      clockWall: () => '2026-11-18T09:00:00.000Z',
      localDay: () => '2026-11-18',
      idGen: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
      assets,
      lifecycle: { onVisibility: (cb) => vis.on(cb) },
    },
    capabilities: { platform: 'web', outputLatencyReported: true, wakeLock: false, serviceWorker: false, persistentStorage: 'best-effort', osFamily: 'linux', displayMode: 'browser' },
    configs: appConfigs(),
    manifest: await manifest(),
    workerFactory: () => worker,
    settings,
    profile: undefined,
    storageLost: false,
    acknowledgeStorageLoss: async () => undefined,
    attemptCompleted: () => undefined,
    pruneDebug: () => undefined,
    localDayOf: (iso) => iso.slice(0, 10),
    rng: createRng(5),
    timers: { setTimeout, clearTimeout: (h) => clearTimeout(h as number), setInterval, clearInterval: (h) => clearInterval(h as number) },
    idle: () => undefined,
    micBrowser: 'chrome',
    inputDevices: async () => [],
    download: () => undefined,
    keepAwake: { enterResults: () => undefined, leaveResults: () => undefined, leavePractice: () => undefined, touch: () => undefined },
    versions: { app: 'test', build: 'test', core: 'test' },
    iosBeta: false,
    testClock: false,
    dev: false,
  };
  const app = composeApp(rt);
  try {
    app.services.home.onStart?.(app.settings.get().practice);
    for (let i = 0; i < 50 && app.session.state === 'loading'; i++) await flush();
    expect(app.session.state).toBe('covered');
    void app.session.ensureAudio();
    app.session.revealScan();
    void app.session.startTake().catch(() => undefined);
    for (let i = 0; i < 100 && !sent.some((m) => m.type === 'config'); i++) await flush();
    return sent.filter((m) => m.type !== 'block');
  } finally {
    app.dispose();
  }
}

describe('T15: the pitch needle setting never reaches a try', () => {
  it.each(['voice-baritone', 'flute'])('%s: the take’s DspConfig and FollowConfig are identical for every setting', async (id) => {
    const none = await takeConfig(undefined, id);
    const config = none.find((m) => m.type === 'config');
    expect(config).toBeDefined();
    const text = JSON.stringify(none);
    expect(text).not.toMatch(/steadiness|centreMs|judgeMs|detentC/i);
    for (const k of ['steady', 'balanced', 'quick'] as const) expect(JSON.stringify(await takeConfig(k, id)), k).toBe(text);
  });
});

/** Every .ts source under `dir` (tests excluded). */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const NAMES = /pitchSteadiness|pitch-steadiness|SteadinessFilter|STEADINESS_|inTuneStep|PitchSteadiness/;

describe('T15: structure', () => {
  it('no module of the try pipeline names the setting or the filter', () => {
    const pipeline = [
      ...['follow', 'grade', 'rules', 'calibration', 'corpus', 'theory', 'tips', 'session/gates'].flatMap((d) => sources(join(ROOT, 'src', d))),
      ...sources(join(ROOT, 'src', 'dsp')).filter((p) => !p.endsWith('pitch-steadiness.ts')),
      ...['practice-session.ts', 'take-plan.ts', 'diagnostics.ts', 'heard-plan.ts', 'listen-plan.ts'].map((f) => join(ROOT, 'src', 'session', f)),
    ];
    expect(pipeline.length).toBeGreaterThan(40);
    const hits = pipeline.filter((p) => NAMES.test(readFileSync(p, 'utf8'))).map((p) => relative(ROOT, p));
    expect(hits).toEqual([]);
  });

  it('the take’s config types have no field for it', () => {
    const types = readFileSync(join(ROOT, 'src', 'core', 'types.ts'), 'utf8');
    for (const name of ['DspConfig', 'FollowConfig']) {
      const start = types.indexOf(`export interface ${name} {`);
      expect(start, name).toBeGreaterThan(0);
      const body = types.slice(start, types.indexOf('\n}\n', start));
      expect(body, name).not.toMatch(/steadiness|Steadiness/);
    }
  });

  it('inside the DSP worker only the pitch mode (Match a note) builds the filter', () => {
    const core = readFileSync(join(ROOT, 'src', 'platform', 'shared', 'audio', 'dsp-worker-core.ts'), 'utf8');
    const tracker = core.slice(core.indexOf('export class PitchModeTracker'), core.indexOf('export class DspWorkerCore'));
    const take = core.slice(core.indexOf('export class DspWorkerCore'));
    expect(tracker).toMatch(/new SteadinessFilter\(STEADINESS_PRESETS\[cfg\.steadiness\]\)/);
    expect(take).not.toMatch(/Steadiness|steadiness/);
  });
});
