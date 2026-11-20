// @vitest-environment jsdom
// Match a note: the screen (R2-13). A fake engine on a fake clock feeds frames; nothing touches audio.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformServices, WorkerLike } from '../../../core/platform.ts';
import type { Instrument } from '../../../core/types.ts';
import { createEmitter } from '../../../core/events.ts';
import { createRng } from '../../../core/rng.ts';
import { loadManifest } from '../../../corpus/index.ts';
import type { MatchNoteService } from '../../../session/index.ts';
import { defaultAppSettings } from '../../../store/defaults.ts';
import { MemoryKv, memoryRepos } from '../../../store/test-data.ts';
import { FakeAudioBackend } from '../../../testkit/fake-backend.ts';
import { act, mount, type Mounted } from '../../../ui/primitives/test-render.ts';
import { composeApp, type AppRuntime } from '../../compose/app-services.ts';
import { appConfigs } from '../../compose/configs.ts';
import { matchRoute } from '../../route-match.ts';
import { RouterProvider, type LocationSource } from '../../router.tsx';
import { createRouteTable, routeTable, type ScreenProps } from '../../routes.tsx';
import { matchScreenOverrides, MatchScreen, MatchServicesProvider } from './index.ts';
import { at, FakeEngine, flush, run } from './match-test-kit.ts';
import { HIT_HOLD_MS, NEXT_DELAY_MS, ROUND_SIZE } from './model.ts';
import type { MatchServices } from './services.ts';

const cfg = appConfigs();
const inst = (id: string): Instrument => cfg.instrumentById[id]!;
const E3 = 52;
const G3 = 55;

const nav = vi.fn();
const source: LocationSource = { getHash: () => '#/match', subscribe: () => () => undefined, navigate: (p, r) => nav(p, r) };
const props = { route: { def: routeTable.find((r) => r.id === 'match'), path: '/match', params: {} } } as unknown as ScreenProps;

let current: Mounted | null = null;
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  current?.unmount();
  current = null;
  nav.mockReset();
  vi.useRealTimers();
});

function services(o: { instrumentId?: string; mic?: boolean } = {}) {
  const engine = new FakeEngine();
  const requestMic = vi.fn(() => Promise.resolve({ ok: true as const }));
  const svc: MatchServices = {
    service: engine as unknown as MatchNoteService,
    instrument: inst(o.instrumentId ?? 'voice-baritone'),
    cfg,
    micAllowed: () => Promise.resolve(o.mic ?? true),
    requestMic,
  };
  return { svc, engine, requestMic };
}

async function render(svc: MatchServices): Promise<void> {
  current = mount(
    <RouterProvider table={routeTable} source={source}>
      <MatchServicesProvider value={svc}>
        <MatchScreen {...props} />
      </MatchServicesProvider>
    </RouterProvider>,
  );
  await flush();
  await flush();
}

const q = (id: string): HTMLElement | null => document.querySelector(`[data-testid="${id}"]`);
const text = (id: string): string => q(id)?.textContent ?? '';
const button = (name: string): HTMLButtonElement => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent === name);
  if (!b) throw new Error(`no button ${name}`);
  return b;
};
/** Taps the E3 chip: the note stays until another is chosen. */
const chooseE3 = async (): Promise<void> => {
  act(() => q(`match-chip-${E3}`)!.click());
  await flush();
  await flush();
};
const press = async (name: string): Promise<void> => {
  act(() => button(name).click());
  await flush();
  await flush();
};

describe('route', () => {
  it('#/match resolves with focused chrome and the practice tab', () => {
    const m = matchRoute(routeTable, '/match', false);
    expect(m?.def.id).toBe('match');
    expect(m?.def.chrome).toBe('loop');
    expect(m?.def.tab).toBe('practice');
    expect(m?.def.titleKey).toBe('match.title');
  });

  it('matchScreenOverrides binds the screen to its services', async () => {
    const { svc } = services();
    const table = createRouteTable(matchScreenOverrides(svc));
    const Screen = table.find((r) => r.id === 'match')!.Screen;
    current = mount(
      <RouterProvider table={table} source={source}>
        <Screen {...props} />
      </RouterProvider>,
    );
    await flush();
    expect(q('screen-match')).not.toBeNull();
  });
});

describe('Match a note', () => {
  it('a fake capture at E3 shows "You hit it: E3." within 1 s, with the needle in the band', async () => {
    const { svc, engine } = services();
    await render(svc);
    await chooseE3();
    expect(engine.played.at(-1)).toBe(E3);
    expect(text('match-target')).toBe('E3');
    expect(engine.listening).toBe(true);
    expect(text('match-line')).toBe('Sing E3 and hold it.');
    await run(engine, 1000, at(6));
    expect(text('match-line')).toBe('You hit it: E3.');
    expect(q('match-line')?.dataset.tone).toBe('hit');
    expect(text('match-you')).toBe('You: E3, 6 cents high');
    expect(q('match-needle')?.dataset.tone).toBe('in');
    expect(q('match-staff')?.dataset.ring).toBe('hit');
  });

  it('opens on the middle of the range (baritone G3) and, in a round, says the next note is coming', async () => {
    const { svc, engine } = services();
    await render(svc);
    expect(engine.played).toEqual([G3]);
    expect(text('match-target')).toBe('G3');
    expect(q('match-staff')?.dataset.ring).toBe('none');
    await run(engine, 1000, at(0));
    expect(text('match-line')).toBe('You hit it: G3.');
    expect(text('match-hint')).toBe('Next note in 1.5 seconds.');
    await run(engine, NEXT_DELAY_MS);
    expect(engine.played).toHaveLength(2);
    expect(text('match-target')).not.toBe('G3');
  });

  it('reaches the hit in the hold time, not before', async () => {
    const { svc, engine } = services();
    await render(svc);
    await run(engine, HIT_HOLD_MS - 100, at(0));
    expect(text('match-line')).toBe('Hold it…');
    await run(engine, 200, at(0));
    expect(text('match-line')).toBe('You hit it: G3.');
  });

  it('flat says "A little low. Go up." with the chevron on the needle side (left)', async () => {
    const { svc, engine } = services();
    await render(svc);
    await chooseE3();
    await run(engine, 200, at(-34));
    const line = q('match-line')!;
    expect(line.textContent).toBe('A little low. Go up.');
    expect(line.dataset.chevron).toBe('left-up');
    // The chevron comes before the words, on the left, where the needle is.
    expect(line.firstElementChild?.classList.contains('mt-chevron')).toBe(true);
    expect(line.lastElementChild?.classList.contains('mt-chevron')).toBe(false);
    expect(Number(q('match-needle')?.dataset.at)).toBeLessThan(0.5 - 30 / 100);
    expect(q('match-needle')?.dataset.tone).toBe('ink');
    expect(text('match-you')).toBe('You: E3, 34 cents low');
    expect(text('match-hint')).toBe('Lift it a little until the needle sits in the middle.');
  });

  it('sharp says "A little high. Go down." with the chevron on the right', async () => {
    const { svc, engine } = services();
    await render(svc);
    await run(engine, 200, at(40));
    const line = q('match-line')!;
    expect(line.textContent).toBe('A little high. Go down.');
    expect(line.dataset.chevron).toBe('right-down');
    expect(line.lastElementChild?.classList.contains('mt-chevron')).toBe(true);
    expect(Number(q('match-needle')?.dataset.at)).toBeGreaterThan(0.5 + 30 / 100);
  });

  it('too far low for 2 s says "Higher. Try E3." with the needle held at the left edge', async () => {
    const { svc, engine } = services();
    await render(svc);
    await chooseE3();
    await run(engine, 2200, (e) => ({ midi: e.target - 5, cents: 0, steady: true }));
    expect(text('match-line')).toBe('Higher. Try E3.');
    expect(q('match-needle')?.dataset.at).toBe('0.000');
    expect(q('match-needle')?.dataset.tone).toBe('edge');
    expect(text('match-you')).toBe('You: B2');
  });

  it('a baritone singing E2 against E3 hits it with no octave line (E2 is below the full range)', async () => {
    const { svc, engine } = services();
    await render(svc);
    await chooseE3();
    await run(engine, 1000, at(0, -12));
    expect(text('match-line')).toBe('You hit it: E3.');
  });

  it('a bass singing an octave lower hears "An octave lower. That counts."', async () => {
    const { svc, engine } = services({ instrumentId: 'voice-bass' });
    await render(svc);
    await run(engine, 300, at(0, -12));
    expect(text('match-line')).toBe('An octave lower. That counts.');
  });

  it('an instrument an octave off says "Right note, wrong octave."', async () => {
    const { svc, engine } = services({ instrumentId: 'cello' });
    await render(svc);
    expect(text('match-line')).toBe('Listen, then play the note. Hold it until the needle sits in the middle.');
    await run(engine, 200, at(0, 12));
    expect(text('match-line')).toBe('Right note, wrong octave.');
    expect(text('match-hint')).toBe('Instruments match the octave. Voices do not need to.');
  });

  it('no steady pitch for 6 s says the not-heard line', async () => {
    const { svc, engine } = services();
    await render(svc);
    await run(engine, 6100);
    expect(text('match-line')).toBe("We can't hear a steady note yet. Move a little closer to the mic and hold one note.");
    expect(q('match-meter')?.dataset.dim).toBe('true');
  });

  it('Play it again plays the same note again', async () => {
    const { svc, engine } = services();
    await render(svc);
    await run(engine, 200, at(-20));
    await press('Play it again');
    expect(engine.played).toEqual([G3, G3]);
    expect(text('match-you')).toBe('');
  });

  it('a chosen chip plays that note and stays after a hit', async () => {
    const { svc, engine } = services();
    await render(svc);
    const chips = [...document.querySelectorAll<HTMLButtonElement>('.mt-chip')].map((b) => b.textContent);
    expect(chips).toEqual(['C3', 'E3', 'G3', 'C4']);
    await chooseE3();
    expect(engine.played).toEqual([G3, E3]);
    expect(q(`match-chip-${E3}`)?.getAttribute('aria-pressed')).toBe('true');
    await run(engine, 1000, at(0));
    expect(text('match-line')).toBe('You hit it: E3.');
    expect(text('match-hint')).toBe('');
    await run(engine, NEXT_DELAY_MS + 1000);
    expect(text('match-target')).toBe('E3');
    expect(engine.played).toEqual([G3, E3]);
  });

  it('a round of five ends in the summary; Five more starts again and Done goes back to Practice', async () => {
    const { svc, engine, requestMic } = services();
    await render(svc);
    for (let i = 0; i < ROUND_SIZE; i++) {
      await run(engine, 1000, at(-8));
      expect(text('match-line')).toBe(`You hit it: ${text('match-target')}.`);
      await run(engine, NEXT_DELAY_MS);
    }
    expect(engine.played).toHaveLength(ROUND_SIZE);
    expect(text('match-summary')).toContain('5 of 5 hit. On average you were 8 cents low.');
    expect(text('match-summary')).toContain('Nothing is graded or saved. Practice and History are unchanged.');
    // The microphone is let go at the summary.
    expect(engine.stops).toBeGreaterThan(0);
    expect(engine.listening).toBe(false);
    const unlocks = requestMic.mock.calls.length;
    await press('Five more');
    // The stop let go of the audio, so Five more unlocks it again from the click.
    expect(requestMic.mock.calls.length).toBe(unlocks + 1);
    expect(q('match-summary')).toBeNull();
    expect(engine.played).toHaveLength(ROUND_SIZE + 1);
    await run(engine, 20);
    for (let i = 0; i < ROUND_SIZE; i++) {
      await run(engine, 1000, at(0));
      await run(engine, NEXT_DELAY_MS);
    }
    await press('Done');
    expect(nav).toHaveBeenCalledWith('/', false);
  });

  it('the back button goes to Practice', async () => {
    const { svc } = services();
    await render(svc);
    act(() => document.querySelector<HTMLButtonElement>('.mt-back')!.click());
    expect(nav).toHaveBeenCalledWith('/', false);
  });

  it('without the microphone it says so, offers Allow microphone, and plays once allowed', async () => {
    const { svc, engine, requestMic } = services({ mic: false });
    await render(svc);
    expect(text('match-line')).toBe('Matching a note needs the microphone.');
    expect(engine.played).toEqual([]);
    await press('Allow microphone');
    expect(requestMic).toHaveBeenCalledOnce();
    expect(engine.played).toEqual([G3]);
    expect(engine.listening).toBe(true);
  });

  it('leaving the screen stops the engine', async () => {
    const { svc, engine } = services();
    await render(svc);
    const before = engine.stops;
    current?.unmount();
    current = null;
    vi.advanceTimersByTime(1);
    expect(engine.stops).toBeGreaterThan(before);
  });
});

// ---- nothing is stored -------------------------------------------------------------------------------------------

const FIXTURES = join(process.cwd(), 'fixtures', 'corpus');
const assets: PlatformServices['assets'] = {
  getJson: <T,>(rel: string) => Promise.resolve(JSON.parse(readFileSync(join(FIXTURES, rel.slice(rel.lastIndexOf('/') + 1)), 'utf8')) as T),
};

describe('Match a note stores nothing', () => {
  it('a full round writes no attempt, profile, history, settings or key-value entry', async () => {
    vi.useRealTimers();
    const kv = new MemoryKv();
    const repos = memoryRepos(kv);
    const writes: string[] = [];
    const spy = <T extends object>(name: string, o: T, keys: (keyof T)[]): void => {
      for (const k of keys) {
        const f = o[k] as unknown as (...a: unknown[]) => unknown;
        (o as Record<keyof T, unknown>)[k] = (...a: unknown[]) => {
          writes.push(`${name}.${String(k)}`);
          return f.apply(o, a);
        };
      }
    };
    spy('attempts', repos.attempts, ['add']);
    spy('profile', repos.profile, ['put']);
    spy('settings', repos.settings, ['put']);
    spy('calibrations', repos.calibrations, ['put']);
    spy('kv', kv, ['set']);
    const worker: WorkerLike = { onmessage: null, postMessage: () => undefined, terminate: () => undefined };
    const vis = createEmitter<boolean>();
    const rt: AppRuntime = {
      platform: {
        audio: new FakeAudioBackend({ sampleRate: 48000 }),
        repos,
        kv,
        keepAwake: async () => undefined,
        clockWall: () => '2026-11-18T09:00:00.000Z',
        localDay: () => '2026-11-18',
        idGen: () => 'id',
        assets,
        lifecycle: { onVisibility: (cb) => vis.on(cb) },
      },
      capabilities: { platform: 'web', outputLatencyReported: true, wakeLock: false, serviceWorker: false, persistentStorage: 'best-effort', osFamily: 'linux', displayMode: 'browser' },
      configs: cfg,
      manifest: await loadManifest(assets),
      workerFactory: () => worker,
      settings: { ...defaultAppSettings(), practice: { ...defaultAppSettings().practice, instrumentId: 'voice-baritone' } },
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
    await new Promise((r) => setTimeout(r, 0));
    const attemptsBefore = (await repos.attempts.all()).length;
    const profileBefore = JSON.stringify(await repos.profile.get());
    writes.length = 0;

    vi.useFakeTimers();
    const engine = new FakeEngine();
    const base = app.services.match;
    const svc: MatchServices = { service: engine as unknown as MatchNoteService, instrument: base.instrument, cfg: base.cfg, micAllowed: () => Promise.resolve(true), requestMic: base.requestMic };
    await render(svc);
    for (let i = 0; i < ROUND_SIZE; i++) {
      await run(engine, 1000, at(i % 2 ? 12 : -12));
      await run(engine, NEXT_DELAY_MS);
    }
    expect(text('match-summary')).toContain('5 of 5 hit.');
    await press('Done');
    vi.useRealTimers();
    await new Promise((r) => setTimeout(r, 0));

    expect(writes).toEqual([]);
    expect(await repos.attempts.all()).toHaveLength(attemptsBefore);
    expect(JSON.stringify(await repos.profile.get())).toBe(profileBefore);
  });
});
