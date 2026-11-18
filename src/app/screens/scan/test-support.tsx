// Test support for the scan and performance screens (not shipped): a fake session over the real emitter and session
// store, services with the real notation module, and a router fixture.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { vi } from 'vitest';
import { createEmitter } from '../../../core/events.ts';
import type { AppSettings, Configs, PreparedExcerpt, SelectionResult, SessionEvent, SessionState } from '../../../core/types.ts';
import * as notationModule from '../../../notation/index.ts';
import { fixtureDoc } from '../../../notation/testing/corpus-node.ts';
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
  return { ...base, instrumentId: 'flute', levelServed: 3, selection, ...over };
}

export interface FakeSession extends PracticeSessionPort {
  events: ReturnType<typeof createEmitter<SessionEvent>>;
  state: SessionState;
  pending: NonNullable<PracticeSessionPort['pending']>;
  emitState(next: SessionState): void;
  ensureAudio: ReturnType<typeof vi.fn> & PracticeSessionPort['ensureAudio'];
  revealScan: ReturnType<typeof vi.fn>;
  startTake: ReturnType<typeof vi.fn> & PracticeSessionPort['startTake'];
  stop: ReturnType<typeof vi.fn> & PracticeSessionPort['stop'];
  skip: ReturnType<typeof vi.fn> & PracticeSessionPort['skip'];
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
  events.emit({ type: 'prepared', excerpt: prepared });
  events.emit({ type: 'state', state: 'covered', prev: 'loading' });
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
  const events = createEmitter<SessionEvent>();
  const session = fakeSession(prepared, over.mode ?? 'ranked');
  // The store listens to the fake's emitter, as the real store listens to the session's.
  const { store } = createSessionStore(session.events);
  void events;
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
    navigate(path: string) {
      location.hash = `#${path}`;
      listeners.forEach((l) => l());
    },
  };
  const services: PracticeFlowServices = {
    configs: cfg,
    session,
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
