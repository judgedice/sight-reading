// The composition root's wiring (01 §4.2) on Node fakes: first-run routing, onboarding's saved profile and
// settings, Start preparing an excerpt, level changes reaching the session, and every route bound to a real screen.
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
import { MemoryKv, memoryRepos } from '../../store/test-data.ts';
import { FakeAudioBackend } from '../../testkit/fake-backend.ts';
import { PlaceholderScreen } from '../screens/Placeholder.tsx';
import { composeApp, type AppRuntime } from './app-services.ts';
import { appConfigs } from './configs.ts';
import { createValue, derived } from './values.ts';

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

describe('values', () => {
  it('createValue keeps one object until set, and persists only on set', () => {
    const saved: number[] = [];
    const v = createValue(1, (n) => saved.push(n));
    let calls = 0;
    v.subscribe(() => calls++);
    v.set(2);
    v.replace(3);
    expect(v.get()).toBe(3);
    expect(saved).toEqual([2]);
    expect(calls).toBe(2);
  });
  it('derived recomputes from its sources', () => {
    const a = createValue(2);
    const d = derived([a], () => a.get() * 10);
    const seen: number[] = [];
    d.subscribe(() => seen.push(d.get()));
    a.set(3);
    expect(d.get()).toBe(30);
    expect(seen).toEqual([30]);
  });
});

describe('composeApp', () => {
  it('binds a real screen to every non-dev route', async () => {
    const app = composeApp(await runtime());
    const placeholders = app.table.filter((r) => !r.devOnly && r.Screen === PlaceholderScreen).map((r) => r.id);
    expect(placeholders).toEqual([]);
    app.dispose();
  });

  it('first run opens onboarding; afterwards a reload outside a take lands on Home', async () => {
    const first = composeApp(await runtime());
    expect(first.initialPath('/')).toBe('/welcome');
    expect(first.initialPath('/welcome')).toBeNull();
    first.dispose();
    const done = composeApp(await runtime({ settings: { ...defaultAppSettings(), onboardingDone: true } }));
    expect(done.initialPath('/')).toBeNull();
    expect(done.initialPath('/practice/results')).toBe('/');
    done.dispose();
  });

  it('onboarding saves the profile at the chosen level and the settings, mic off means practise without listening', async () => {
    const rt = await runtime();
    const app = composeApp(rt);
    const to = await app.services.onboarding.finish({ displayName: 'Ada', instrumentId: 'clarinet-bb', showBeta: true, micAllowed: false, calibration: null, level: { kind: 'level', level: 3 } });
    expect(to).toBe('/');
    const p = await rt.repos.profile.get();
    expect(p?.displayName).toBe('Ada');
    expect(p?.instruments['clarinet-bb']?.level).toBe(3);
    const s = await rt.repos.settings.get();
    expect(s.onboardingDone).toBe(true);
    expect(s.practice).toMatchObject({ instrumentId: 'clarinet-bb', level: 3, listening: false, mode: 'practice' });
    expect(s.practicePrefs.showBeta).toBe(true);
    expect(app.services.home.banners.get().map((b) => b.kind)).toEqual(['mic-off']);
    app.dispose();
  });

  it('placement goes straight to the scan with an excerpt loading at the start level', async () => {
    const rt = await runtime();
    const app = composeApp(rt);
    const to = await app.services.onboarding.finish({ displayName: 'B', instrumentId: 'flute', showBeta: false, micAllowed: true, calibration: 'skipped', level: { kind: 'placement' } });
    expect(to).toBe('/practice/scan');
    expect(app.session.state).toBe('loading');
    const p = await rt.repos.profile.get();
    expect(p?.instruments['flute']?.placement).not.toBeNull();
    app.dispose();
  });

  it('Start prepares an excerpt for the saved settings; a level change reaches the next prepare', async () => {
    const rt = await runtime({ settings: { ...defaultAppSettings(), onboardingDone: true, practice: { ...defaultAppSettings().practice, level: 3, mode: 'practice' } } });
    const app = composeApp(rt);
    expect(app.services.home.onStart?.(app.settings.get().practice)).toBe(false);
    for (let i = 0; i < 50 && app.session.state === 'loading'; i++) await flush();
    expect(app.session.state).toBe('covered');
    expect(app.session.prepared?.levelServed).toBeLessThanOrEqual(3);
    app.services.home.moveUp('flute', 4);
    for (let i = 0; i < 10; i++) await flush();
    expect(app.settings.get().practice.level).toBe(4);
    expect((await rt.repos.profile.get())?.instruments['flute']?.level).toBe(4);
    app.dispose();
  });

  it('wires the sound services: the chosen sound and accent, Practice availability, and one sound at a time', async () => {
    const base = defaultAppSettings();
    const rt = await runtime({ settings: { ...base, onboardingDone: true, practice: { ...base.practice, clickTimbre: 'beep', accentFirstBeat: false, mode: 'practice' } } });
    const app = composeApp(rt);
    const be = rt.platform.audio as FakeAudioBackend;
    const s = app.services;
    // Practice's tempo row, with no excerpt: one bar of Beep, no accent.
    await s.home.hearTempo!(72, 4);
    expect(be.log.clickPlays.at(-1)).toMatchObject({ sound: 'beep', accents: [false, false, false, false] });
    expect(s.home.sounds!.getState().playing).toBe('tempo');
    // A range note and a settings preview; each stops the one before.
    await s.home.playNote!(48);
    expect(be.log.notePlays.at(-1)!.notes[0]!.durSec).toBe(1);
    await s.settings.previewSound!('woodblock');
    expect(be.log.clickPlays.at(-1)!.sound).toBe('woodblock');
    await s.calibration.hearClick!();
    expect(be.log.clickPlays.at(-1)!.sound).toBe('beep');
    expect(be.log.stopSounds).toBe(4);
    s.settings.stopSounds!();
    expect(s.settings.sounds!.getState().playing).toBeNull();
    // A sound change in Settings reaches the next sound without a new session.
    s.home.settings.set({ ...app.settings.get(), practice: { ...app.settings.get().practice, clickTimbre: 'woodblock', accentFirstBeat: true } });
    await s.home.hearTempo!(60, 3);
    expect(be.log.clickPlays.at(-1)).toMatchObject({ sound: 'woodblock', accents: [true, false, false] });

    // No calibration yet: Ranked is blocked with "Calibrate now"; practise without listening blocks it for the microphone.
    for (let i = 0; i < 10; i++) await flush();
    expect(s.home.rankedAvailability!.get()).toEqual({ available: false, block: 'calibration' });
    s.home.settings.set({ ...app.settings.get(), practice: { ...app.settings.get().practice, listening: false } });
    for (let i = 0; i < 10; i++) await flush();
    expect(s.home.rankedAvailability!.get()).toEqual({ available: false, block: 'mic' });
    const r = await s.home.turnOnMic!();
    expect(r.ok).toBe(true);
    expect(app.settings.get().practice.listening).toBe(true);
    for (let i = 0; i < 10; i++) await flush();
    expect(s.home.rankedAvailability!.get().block).toBe('calibration');
    app.dispose();
  });

  it('the read-through services play through the session: practice Listen first keeps the mode', async () => {
    const base = defaultAppSettings();
    const rt = await runtime({ settings: { ...base, onboardingDone: true, practice: { ...base.practice, level: 3, mode: 'practice' } } });
    const app = composeApp(rt);
    const be = rt.platform.audio as FakeAudioBackend;
    app.services.home.onStart?.(app.settings.get().practice);
    for (let i = 0; i < 50 && app.session.state !== 'covered'; i++) await flush();
    await app.session.ensureAudio();
    app.session.revealScan();
    await app.services.flow.listenFirst!();
    expect(be.log.notePlays).toHaveLength(1);
    expect(app.services.flow.sounds!.getState().playing).toBe('listen');
    expect(app.session.view.getState().mode).toBe('practice');
    await app.services.flow.hearKey!();
    expect(app.services.flow.sounds!.getState().playing).toBe('key');
    app.services.flow.stopSounds!();
    expect(app.services.flow.sounds!.getState().playing).toBeNull();
    app.dispose();
  });
});
