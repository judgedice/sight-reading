// Round 2 wiring (R2-08): tries today, no calibrate banner, the calibration status, the diagnostics environment.
// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PlatformServices, WorkerLike } from '../../core/platform.ts';
import type { CorpusManifest } from '../../core/types.ts';
import { createRng } from '../../core/rng.ts';
import { createEmitter } from '../../core/events.ts';
import { loadManifest } from '../../corpus/index.ts';
import { defaultAppSettings } from '../../store/defaults.ts';
import { makeAttempt, makeCalibration, MemoryKv, memoryRepos } from '../../store/test-data.ts';
import { FakeAudioBackend } from '../../testkit/fake-backend.ts';
import { composeApp, readDiagnosticsEnv, type AppRuntime } from './app-services.ts';
import { appConfigs } from './configs.ts';

const FIXTURES = join(process.cwd(), 'fixtures', 'corpus');
const assets: PlatformServices['assets'] = {
  getJson: <T>(rel: string) => Promise.resolve(JSON.parse(readFileSync(join(FIXTURES, rel.slice(rel.lastIndexOf('/') + 1)), 'utf8')) as T),
};
let manifestP: Promise<CorpusManifest> | null = null;
const manifest = (): Promise<CorpusManifest> => (manifestP ??= loadManifest(assets));
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function runtime(over: Partial<AppRuntime> = {}): Promise<AppRuntime & { repos: ReturnType<typeof memoryRepos> }> {
  const kv = new MemoryKv();
  const repos = memoryRepos(kv);
  let ids = 0;
  const vis = createEmitter<boolean>();
  const platform: PlatformServices = {
    audio: new FakeAudioBackend({ sampleRate: 48000 }),
    repos,
    kv,
    keepAwake: async () => undefined,
    clockWall: () => '2026-11-18T09:00:00.000Z',
    localDay: () => '2026-11-18',
    idGen: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
    assets,
    lifecycle: { onVisibility: (cb) => vis.on(cb) },
  };
  const worker: WorkerLike = { onmessage: null, postMessage: () => undefined, terminate: () => undefined };
  return {
    platform,
    repos,
    capabilities: { platform: 'web', outputLatencyReported: true, wakeLock: false, serviceWorker: false, persistentStorage: 'best-effort', osFamily: 'linux', displayMode: 'browser' },
    configs: appConfigs(),
    manifest: await manifest(),
    workerFactory: () => worker,
    settings: defaultAppSettings(),
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
    ...over,
  };
}


const at = (i: number, over: Parameters<typeof makeAttempt>[1] = {}) => makeAttempt(i, { createdAt: `2026-11-18T0${i}:00:00.000Z`, ...over });

describe('composeApp round 2', () => {
  it('counts 2 graded, 1 not graded and 1 stopped before bar 1 as 3 tries today', async () => {
    const rt = await runtime();
    await rt.repos.attempts.add(at(1));
    await rt.repos.attempts.add(at(2));
    await rt.repos.attempts.add(at(3, { endReason: 'void', voidReason: 'no-signal', score: null }));
    await rt.repos.attempts.add(at(4, { endReason: 'void', voidReason: 'stopped-before-first-note', score: null }));
    const app = composeApp(rt);
    await flush();
    await flush();
    expect(app.services.home.today.get().tries).toBe(3);
    expect(app.services.home.lastTry?.get()?.id).toBe(at(3).id);
    app.dispose();
  });

  it('emits no calibrate banner, and a stored measured calibration reads ok without a reload', async () => {
    const rt = await runtime({ settings: { ...defaultAppSettings(), onboardingDone: true } });
    const app = composeApp(rt);
    await flush();
    expect(app.services.home.banners.get().some((b) => b.kind === 'calibrate')).toBe(false);
    expect(app.services.home.calibrationStatus?.get().state).toBe('none');
    const c = { ...makeCalibration('r1'), method: 'loopback' as const, outputMode: defaultAppSettings().practice.outputMode, measuredAt: '2026-11-18T08:00:00.000Z' };
    await rt.repos.calibrations.put(c);
    // The composition root re-reads the store when calibration saves; the services' own save does the same.
    await app.services.calibration.save(c);
    await flush();
    expect(app.services.home.banners.get().some((b) => b.kind === 'calibrate')).toBe(false);
    expect(app.services.home.calibrationStatus?.get().state).toBe('ok');
    app.dispose();
  });

  it('reads the support address and the opt-in from the build variables', () => {
    expect(readDiagnosticsEnv({})).toEqual({ supportAddress: null, soundOptInShown: false });
    expect(readDiagnosticsEnv({ VITE_SUPPORT_EMAIL: '  ', VITE_DIAG_SOUND_OPTIN: '0' })).toEqual({ supportAddress: null, soundOptInShown: false });
    expect(readDiagnosticsEnv({ VITE_SUPPORT_EMAIL: 'help@example.org', VITE_DIAG_SOUND_OPTIN: '1' })).toEqual({ supportAddress: 'help@example.org', soundOptInShown: true });
  });

  it('wires diagnostics, the picker sound and the match services', async () => {
    const app = composeApp(await runtime({ env: {} }));
    expect(app.services.results.diagnostics?.supportAddress).toBeNull();
    expect(app.services.history.diagnostics).toBeDefined();
    expect(app.services.home.pickerSound?.state.get()).toEqual({ playing: null, index: null, failed: false });
    expect(app.services.match.instrument.id).toBeTruthy();
    expect(await app.services.results.triesAtPiece?.('none')).toBe(0);
    app.dispose();
  });
});
