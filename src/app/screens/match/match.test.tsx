// @vitest-environment jsdom
// Match a note: the screen (R2-13). A fake engine on a fake clock feeds frames; nothing touches audio.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformServices, WorkerLike } from '../../../core/platform.ts';
import type { Instrument, PitchSteadiness } from '../../../core/types.ts';
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

function services(o: { instrumentId?: string; mic?: boolean; steadiness?: PitchSteadiness; showCents?: boolean; level?: number; setter?: boolean } = {}) {
  const engine = new FakeEngine();
  const requestMic = vi.fn(() => Promise.resolve({ ok: true as const }));
  const stored: { steadiness: PitchSteadiness | undefined } = { steadiness: o.steadiness };
  if (o.steadiness) engine.steadiness = o.steadiness;
  const setPitchSteadiness = vi.fn((v: PitchSteadiness) => {
    stored.steadiness = v;
    // The real engine reads the setting when it starts listening; the fake one is told here.
    engine.steadiness = v;
  });
  const svc: MatchServices = {
    service: engine as unknown as MatchNoteService,
    instrument: inst(o.instrumentId ?? 'voice-baritone'),
    cfg,
    micAllowed: () => Promise.resolve(o.mic ?? true),
    requestMic,
    ...(o.level !== undefined ? { level: () => o.level! } : {}),
    ...(o.steadiness !== undefined || o.showCents !== undefined ? { display: () => ({ pitchSteadiness: stored.steadiness, showCents: o.showCents ?? false }) } : {}),
    ...(o.setter ? { setPitchSteadiness } : {}),
  };
  return { svc, engine, requestMic, setPitchSteadiness, stored };
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
  it('a fake capture at E3 shows "You hit it: E3." within 1.5 s, with the needle in the band', async () => {
    const { svc, engine } = services();
    await render(svc);
    await chooseE3();
    expect(engine.played.at(-1)).toBe(E3);
    expect(text('match-target')).toBe('E3');
    expect(engine.listening).toBe(true);
    expect(text('match-line')).toBe('Sing E3 and hold it.');
    await run(engine, 1500, at(6));
    expect(text('match-line')).toBe('You hit it: E3.');
    expect(q('match-line')?.dataset.tone).toBe('hit');
    expect(text('match-you')).toBe('You: E3');
    expect(q('match-needle')?.dataset.tone).toBe('in');
    expect(q('match-staff')?.dataset.ring).toBe('hit');
  });

  it('opens on the middle of the range (baritone G3) and, in a round, says the next note is coming', async () => {
    const { svc, engine } = services();
    await render(svc);
    expect(engine.played).toEqual([G3]);
    expect(text('match-target')).toBe('G3');
    expect(q('match-staff')?.dataset.ring).toBe('none');
    await run(engine, 1500, at(0));
    expect(text('match-line')).toBe('You hit it: G3.');
    expect(text('match-hint')).toBe('Next note in 1.5 seconds.');
    await run(engine, NEXT_DELAY_MS);
    expect(engine.played).toHaveLength(2);
    expect(text('match-target')).not.toBe('G3');
  });

  it('reaches the hit in the hold time, not before', async () => {
    const { svc, engine } = services();
    await render(svc);
    // Steady: in tune once the 400 ms judge window holds the note for 100 ms, a hit 800 ms after that.
    await run(engine, 400 + 100 + HIT_HOLD_MS - 100, at(0));
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
    expect(text('match-you')).toBe('You: E3, a little low');
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
    expect(text('match-you')).toBe('You: B2, much too low');
  });

  it('a baritone singing E2 against E3 hits it with no octave line (E2 is below the full range)', async () => {
    const { svc, engine } = services();
    await render(svc);
    await chooseE3();
    await run(engine, 1500, at(0, -12));
    expect(text('match-line')).toBe('You hit it: E3.');
  });

  it('a bass singing an octave lower hears "An octave lower. That counts."', async () => {
    const { svc, engine } = services({ instrumentId: 'voice-bass' });
    await render(svc);
    await run(engine, 700, at(0, -12));
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
    await run(engine, 1500, at(0));
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
      await run(engine, 1500, at(-8));
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
      await run(engine, 1500, at(0));
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

  it('opening with the microphone allowed runs the unlock once, before the first note plays', async () => {
    // Another screen may have let the microphone go; playing before the unlock fails in the browser.
    let unlock!: (r: { ok: true }) => void;
    const { svc, engine, requestMic } = services();
    requestMic.mockImplementation(() => new Promise((res) => (unlock = res)));
    await render(svc);
    expect(requestMic).toHaveBeenCalledOnce();
    expect(engine.played).toEqual([]);
    unlock({ ok: true });
    await flush();
    await flush();
    expect(engine.played).toEqual([G3]);
    expect(engine.listening).toBe(true);
    expect(requestMic).toHaveBeenCalledOnce();
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

// ---- the steady needle (round 3, 03-pitch-steadiness) -----------------------------------------------------------------

/** A wobbling voice at the engine's target: ±22 c at 3.3 Hz around `centre` cents. */
const wobble =
  (centre = 0) =>
  (e: FakeEngine) => {
    const c = centre + 22 * Math.sin((2 * Math.PI * 3.3 * e.clock) / 1000);
    return { midi: e.target, cents: c, steady: true };
  };

describe('the steady needle', () => {
  it('a wobbling voice centred on the note: the needle sits still near the middle and the line says "Hold it…", then a hit', async () => {
    const { svc, engine } = services({ steadiness: 'steady' });
    await render(svc);
    await chooseE3();
    await run(engine, 700, wobble());
    const seen: number[] = [];
    for (let i = 0; i < 20; i++) {
      await run(engine, 20, wobble());
      if (text('match-line') === 'You hit it: E3.') break;
      expect(text('match-line')).toBe('Hold it…');
      seen.push(Number(q('match-needle')?.dataset.at));
    }
    // ±22 c of wobble, the needle moves less than ±5 c (0.05 of the track).
    expect(Math.max(...seen) - Math.min(...seen)).toBeLessThan(0.1);
    expect(q('match-needle')?.dataset.tone).toBe('in');
    await run(engine, 600, wobble());
    expect(text('match-line')).toBe('You hit it: E3.');
  });

  it('centred 45 c low: never a hit, and the line says low', async () => {
    const { svc, engine } = services({ steadiness: 'steady' });
    await render(svc);
    await chooseE3();
    await run(engine, 3000, wobble(-45));
    expect(text('match-line')).toBe('A little low. Go up.');
    expect(text('match-you')).toBe('You: E3, a little low');
  });

  it('shows cents, rounded to 5, only with show cents on', async () => {
    const { svc, engine } = services({ showCents: true, steadiness: 'steady' });
    await render(svc);
    await chooseE3();
    await run(engine, 600, at(-33));
    expect(text('match-you')).toBe('You: E3, a little low (35 cents)');
  });

  it('draws the wobble width behind the needle on Steady and Balanced, not on Quick', async () => {
    for (const k of ['steady', 'balanced', 'quick'] as const) {
      const { svc, engine } = services({ steadiness: k });
      await render(svc);
      await chooseE3();
      await run(engine, 900, wobble(-10));
      const bar = q('match-spread');
      if (k === 'quick') expect(bar, k).toBeNull();
      else {
        expect(bar, k).not.toBeNull();
        const from = Number(bar!.dataset.from);
        const to = Number(bar!.dataset.to);
        // About -30 to +10 c: 0.2 to 0.6 of the track.
        expect(from, k).toBeLessThan(0.35);
        expect(to, k).toBeGreaterThan(0.45);
        expect(to - from, k).toBeGreaterThan(0.25);
      }
      current?.unmount();
      current = null;
    }
  });

  it('hides a dead needle: dimmed at its place in a short silence, gone after 600 ms', async () => {
    const { svc, engine } = services();
    await render(svc);
    await chooseE3();
    await run(engine, 600, at(-20));
    expect(q('match-needle')?.dataset.stale).toBe('false');
    const place = q('match-needle')?.dataset.at;
    await run(engine, 300, () => ({ midi: null, cents: null, steady: false }));
    expect(q('match-needle')?.dataset.stale).toBe('true');
    expect(q('match-needle')?.dataset.at).toBe(place);
    await run(engine, 400, () => ({ midi: null, cents: null, steady: false }));
    expect(q('match-needle')).toBeNull();
    expect(text('match-you')).toBe('');
  });

  it('after a hit the settled note is drawn grey beside the target, with "You sang"', async () => {
    const { svc, engine } = services();
    await render(svc);
    await chooseE3();
    await run(engine, 1500, at(14));
    expect(text('match-line')).toBe('You hit it: E3.');
    expect(text('match-sang')).toBe('You sang: E3, a little high');
    expect(q('match-heard')?.getAttribute('data-letter')).toBe('e');
  });

  it('a stop after a long hold off the note draws the note sung', async () => {
    const { svc, engine } = services();
    await render(svc);
    await chooseE3();
    await run(engine, 1200, at(-60));
    await run(engine, 200, () => ({ midi: null, cents: null, steady: false }));
    expect(text('match-sang')).toBe('You sang: E♭3, a little high');
    expect(q('match-heard')).not.toBeNull();
  });

  it('"Make it steadier" opens the three choices; a choice is stored and the note plays again with it', async () => {
    const { svc, engine, setPitchSteadiness } = services({ steadiness: 'quick', setter: true });
    await render(svc);
    expect(q('match-steadier')).toBeNull();
    await press('Needle moving too much? Make it steadier');
    const group = q('match-steadier')!.querySelector<HTMLElement>('[role="radiogroup"]')!;
    expect(group.getAttribute('aria-label')).toBe('Pitch needle');
    expect(group.querySelector<HTMLInputElement>('input:checked')?.value).toBe('quick');
    expect(text('match-steadier')).toContain('Shows every wobble as it happens.');
    const played = engine.played.length;
    act(() => group.querySelector<HTMLInputElement>('input[value="steady"]')!.click());
    await flush();
    await flush();
    expect(setPitchSteadiness).toHaveBeenCalledWith('steady');
    expect(engine.played.length).toBe(played + 1);
    expect(engine.steadiness).toBe('steady');
    expect(q('match-steadier')!.querySelector<HTMLInputElement>('input:checked')?.value).toBe('steady');
    expect(text('match-steadier')).toContain('The needle shows the middle of your note and moves calmly.');
    await press('Done');
    expect(q('match-steadier')).toBeNull();
  });

  it('no setter, no link (onboarding before the wizard)', async () => {
    const { svc } = services();
    await render(svc);
    expect([...document.querySelectorAll('button')].some((b) => b.textContent === 'Needle moving too much? Make it steadier')).toBe(false);
  });

  it('the band follows the player’s difficulty on Practice: 22 c low hits at difficulty 1, not at 7 (20 c)', async () => {
    for (const [level, hit] of [
      [1, true],
      [7, false],
    ] as const) {
      const { svc, engine } = services({ level });
      await render(svc);
      await chooseE3();
      await run(engine, 1500, at(-22));
      expect(text('match-line') === 'You hit it: E3.', `difficulty ${level}`).toBe(hit);
      current?.unmount();
      current = null;
    }
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
      await run(engine, 1500, at(i % 2 ? 12 : -12));
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
