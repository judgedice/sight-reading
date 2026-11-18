// Test support for the scan and performance screens (not shipped): a fake session over the real emitter and session
// store, services with the real notation module, and a router fixture.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { vi, type Mock } from 'vitest';
import { createEmitter } from '../../../core/events.ts';
import type { AppSettings, Configs, PreparedExcerpt, SelectionResult, SessionEvent, SessionState } from '../../../core/types.ts';
import * as notationModule from '../../../notation/index.ts';
import { fixtureDoc } from '../../../notation/testing/corpus-node.ts';
// eslint-disable-next-line boundaries/dependencies -- test data only (not shipped)
import { loadConfigs } from '../../../rules/index.ts';
import { createSessionStore, type SessionView } from '../../../session/index.ts';
import { defaultAppSettings } from '../../../store/defaults.ts';
import { bindNotation, type FrameNotation } from '../../../ui/score-frame/index.ts';
import { ToastProvider } from '../../../ui/primitives/index.ts';
import type { StoreApi } from 'zustand/vanilla';
import { barsExcerpt, FRAME_FIXTURE_ID } from '../../../../e2e/notation/score-frame-fixture.ts';
import { RouterProvider, useRoute, type LocationSource } from '../../router.tsx';
import { createRouteTable } from '../../routes.tsx';
import type { Readable } from '../home/services.ts';
import { practiceFlowScreenOverrides } from './index.ts';
import type { PracticeFlowServices, PracticeSessionPort } from './services.ts';

const read = (rel: string): unknown => JSON.parse(readFileSync(join(process.cwd(), rel), 'utf8')) as unknown;
export const cfg: Configs = loadConfigs({
  grading: read('config/grading-config.json'),
  levels: read('config/levels.json'),
  instruments: read('config/instruments.json'),
  progression: read('config/progression.json'),
  tips: read('config/tips.json'),
  budget: read('config/measurement-budget.json'),
  trumpetValves: read('data/trumpet-valves.json'),
} as never);

export function readable<T>(init: T): Readable<T> & { set(v: T): void } {
  let v = init;
  const ls = new Set<() => void>();
  return {
    get: () => v,
    set(n) {
      v = n;
      ls.forEach((l) => l());
    },
    subscribe(l) {
      ls.add(l);
      return () => ls.delete(l);
    },
  };
}

export function testExcerpt(over: Partial<PreparedExcerpt> = {}): PreparedExcerpt {
  const base = barsExcerpt(fixtureDoc(FRAME_FIXTURE_ID), 8);
  const selection = { settings: { instrumentId: 'flute', level: 3, writtenKey: base.writtenKey, meter: '4/4', bpm: 100, bars: 8, randomized: [], seed: 1 } } as unknown as SelectionResult;
  const ids: string[] = [];
  for (const mm of base.measures) for (const e of mm.events) if (e.kind === 'note') ids.push(e.id);
  return { ...base, instrumentId: 'flute', levelServed: 3, selection, extremes: { highId: ids[2]!, lowId: ids[ids.length - 1]! }, ...over };
}

type Fn<K extends keyof PracticeSessionPort> = PracticeSessionPort[K] extends (...a: infer A) => infer R ? Mock<(...a: A) => R> : never;

export interface FakeSession {
  events: ReturnType<typeof createEmitter<SessionEvent>>;
  state: SessionState;
  prepared: PreparedExcerpt;
  pending: NonNullable<PracticeSessionPort['pending']>;
  emitState(next: SessionState): void;
  ensureAudio: Fn<'ensureAudio'>;
  revealScan: Fn<'revealScan'>;
  startTake: Fn<'startTake'>;
  stop: Fn<'stop'>;
  skip: Fn<'skip'>;
  captureTuningNote: Fn<'captureTuningNote'>;
  playVoiceReference: Fn<'playVoiceReference'>;
}

export function fakeSession(prepared: PreparedExcerpt, mode: 'ranked' | 'practice' = 'ranked'): FakeSession {
  const events = createEmitter<SessionEvent>();
  const s = {
    events,
    state: 'covered' as SessionState,
    prepared,
    pending: { mode, seenBefore: false, skipLimitHit: false, revealed: false, scanSec: 30 },
    emitState(next: SessionState) {
      const prev = s.state;
      s.state = next;
      events.emit({ type: 'state', state: next, prev });
    },
    ensureAudio: vi.fn(() => Promise.resolve({} as never)),
    revealScan: vi.fn(() => {
      s.pending.revealed = true;
      s.emitState('scanning');
    }),
    startTake: vi.fn(() => Promise.resolve()),
    stop: vi.fn(() => Promise.resolve(null)),
    skip: vi.fn(() => Promise.resolve()),
    captureTuningNote: vi.fn(() => Promise.resolve(-8)),
    playVoiceReference: vi.fn(() => Promise.resolve()),
  };
  return s as unknown as FakeSession;
}

export interface Harness {
  services: PracticeFlowServices;
  session: FakeSession;
  view: StoreApi<SessionView>;
  settings: ReturnType<typeof readable<AppSettings>>;
  location: LocationSource & { hash: string };
  practiceInstead: ReturnType<typeof vi.fn>;
  notation: { fonts: ReturnType<typeof vi.fn> };
}

export function harness(over: { mode?: 'ranked' | 'practice'; prepared?: PreparedExcerpt; settings?: AppSettings } = {}): Harness {
  const prepared = over.prepared ?? testExcerpt();
  const session = fakeSession(prepared, over.mode ?? 'ranked');
  // The store listens to the fake's emitter, as the real store listens to the session's.
  const { store } = createSessionStore(session.events);
  session.events.emit({ type: 'prepared', excerpt: prepared });
  session.events.emit({ type: 'state', state: 'covered', prev: 'loading' });
  const settings = readable<AppSettings>(over.settings ?? defaultAppSettings());
  const fonts = vi.fn(() => Promise.resolve());
  const bound = bindNotation(notationModule);
  const notation: FrameNotation = { ...bound, ensureNotationFonts: fonts };
  const practiceInstead = vi.fn();
  const listeners = new Set<() => void>();
  const location = {
    hash: '#/practice/scan',
    getHash: () => location.hash,
    subscribe: (l: () => void) => (listeners.add(l), () => listeners.delete(l)),
    navigate(path: string, _replace?: boolean) {
      location.hash = `#${path}`;
      listeners.forEach((l) => l());
    },
  };
  const services: PracticeFlowServices = {
    configs: cfg,
    session: session as unknown as PracticeSessionPort,
    view: store,
    loadNotation: () => Promise.resolve(notation),
    settings,
    practiceInstead,
    hearTempo: vi.fn(() => Promise.resolve()),
  };
  return { services, session, view: store, settings, location, practiceInstead, notation: { fonts } };
}

function Current() {
  const route = useRoute();
  const { Screen } = route.def;
  return <Screen route={route} />;
}

export function PracticeApp({ h }: { h: Harness }) {
  const table = createRouteTable(practiceFlowScreenOverrides(h.services));
  return (
    <RouterProvider table={table} source={h.location}>
      <ToastProvider suppressed={false}>
        <Current />
      </ToastProvider>
    </RouterProvider>
  );
}
