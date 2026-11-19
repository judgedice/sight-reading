/**
 * Dev-only story page for the cover and read-through: `/src/app/screens/scan/story/index.html` on the Vite dev server.
 * It mounts the real ScanScreen with the real notation over a fake session, so each `cover-*` and `scan-*` mockup
 * state can be shown and screenshotted. Query: kind=voice|instrument, mode=ranked|practice, state=cover|loading|scan,
 * remaining=24, playing=chord|first|key|tempo|listen, coach=1, theme=dark. Not shipped; literals are dev data.
 */
import { StrictMode, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { createStore } from 'zustand/vanilla';
import { createEmitter } from '../../../../core/events.ts';
import type { AppSettings, ExcerptChunk, ExcerptDoc, PreparedExcerpt, SelectionResult, SessionEvent, SessionState } from '../../../../core/types.ts';
import * as notation from '../../../../notation/index.ts';
import { preparedFromDoc } from '../../../../notation/testing/prepared.ts';
import { createSessionStore, idleSoundView, type SoundView } from '../../../../session/index.ts';
import { defaultAppSettings } from '../../../../store/defaults.ts';
import { GlyphSprite, ToastProvider } from '../../../../ui/primitives/index.ts';
import { bindNotation } from '../../../../ui/score-frame/index.ts';
import '../../../../ui/tokens.css';
import '../../../app.css';
import { appConfigs } from '../../../compose/configs.ts';
import shardL03 from '../../../../../fixtures/corpus/shard-L03-01.a5c80d091c.json';
import shardL04 from '../../../../../fixtures/corpus/shard-L04-01.c789282ba7.json';
import { RouterProvider, useRoute, type LocationSource } from '../../../router.tsx';
import { createRouteTable } from '../../../routes.tsx';
import { resetSoundsCoach, markSoundsCoachSeen } from '../coach.ts';
import { practiceFlowScreenOverrides } from '../index.ts';
import { midiOf } from '../read-model.ts';
import type { PracticeFlowServices, PracticeSessionPort } from '../services.ts';

const q = new URLSearchParams(location.search);
if (q.has('dark') || q.get('theme') === 'dark') document.documentElement.dataset.theme = 'dark';
const kind = q.get('kind') === 'instrument' ? 'instrument' : 'voice';
const mode = q.get('mode') === 'practice' ? 'practice' : 'ranked';
const start = q.get('state') ?? 'scan';
const remaining = Number(q.get('remaining') ?? 24);
const playing = q.get('playing');
if (q.get('coach') === '1') resetSoundsCoach();
else markSoundsCoachSeen();

const cfg = appConfigs();
const DOCS = {
  voice: { file: shardL03 as unknown as ExcerptChunk, id: 'jaell-lc6157272-voice-m20-27', instrumentId: 'voice-baritone', clef: 'bass' as const, key: { fifths: 1, mode: 'major' as const } },
  instrument: { file: shardL04 as unknown as ExcerptChunk, id: 'le-beau-lc5883655-voice-mp1-9', instrumentId: 'clarinet-bb', clef: 'treble' as const, key: { fifths: 3, mode: 'major' as const } },
};

function excerpt(): PreparedExcerpt {
  const d = DOCS[kind];
  const chunk = d.file;
  const doc = chunk.excerpts.find((x: ExcerptDoc) => x.id === d.id)!;
  const base = preparedFromDoc({ ...doc, keyConcert: d.key }, d.clef);
  const selection = { settings: { instrumentId: d.instrumentId, level: 2, writtenKey: d.key, meter: '4/4', bpm: 72, bars: 8, randomized: [], seed: 1 } } as unknown as SelectionResult;
  return { ...base, instrumentId: d.instrumentId, levelServed: 2, writtenKey: d.key, concertKey: d.key, selection };
}

function firstNote(p: PreparedExcerpt) {
  for (const m of p.measures) for (const e of m.events) if (e.kind === 'note') return e;
  throw new Error('no note');
}

async function main(): Promise<void> {
  const prepared = excerpt();
  const events = createEmitter<SessionEvent>();
  const { store: view } = createSessionStore(events);
  const sounds = createStore<SoundView>()(() => idleSoundView());
  const pending = { mode: mode as 'ranked' | 'practice', seenBefore: false, skipLimitHit: false, revealed: start === 'scan', scanSec: 30, listenedFirst: false };
  let state: SessionState = 'loading';
  const setState = (next: SessionState): void => {
    const prev = state;
    state = next;
    events.emit({ type: 'state', state: next, prev });
  };
  const play = (s: Partial<SoundView>): Promise<void> => {
    sounds.setState({ ...idleSoundView(), ...s });
    return Promise.resolve();
  };
  const chord = { kind: 'key-chord' as const, writtenKey: prepared.writtenKey, concertKey: prepared.concertKey };
  const f = firstNote(prepared);
  const session = {
    events,
    get state() {
      return state;
    },
    prepared,
    pending,
    ensureAudio: () => Promise.resolve({} as never),
    revealScan() {
      pending.revealed = true;
      setState('scanning');
      events.emit({ type: 'scan-tick', remainingSec: 30 });
    },
    startTake: () => Promise.resolve(),
    stop: () => Promise.resolve(null),
    skip: () => Promise.resolve(),
    captureTuningNote: () => new Promise<number>((r) => setTimeout(() => r(-8), 1500)),
    playVoiceReference: () => play({ playing: 'reference', caption: chord }),
  };
  const settings: AppSettings = defaultAppSettings();
  const services: PracticeFlowServices = {
    configs: cfg,
    session: session as unknown as PracticeSessionPort,
    view,
    loadNotation: () => Promise.resolve(bindNotation(notation)),
    settings: { get: () => settings, subscribe: () => () => undefined },
    practiceInstead: () => undefined,
    hearTempo: () => play({ playing: 'tempo', caption: { kind: 'tempo', bpm: 72 } }),
    hearKey: () => play({ playing: 'key', caption: chord }),
    hearStartingPitch: () => play({ playing: 'reference', caption: chord }),
    listenFirst: () => {
      if (pending.mode === 'ranked') {
        pending.mode = 'practice';
        pending.listenedFirst = true;
        view.setState({ mode: 'practice', listenedFirst: true });
      }
      return play({ playing: 'listen', caption: { kind: 'bar', bar: 3, of: 8 }, bar: 3 });
    },
    stopSounds: () => sounds.setState(idleSoundView()),
    sounds,
  };

  events.emit({ type: 'prepared', excerpt: prepared });
  view.setState({ mode: pending.mode });
  if (start !== 'loading') setState('covered');
  if (start === 'scan') {
    setState('scanning');
    events.emit({ type: 'scan-tick', remainingSec: remaining });
  }
  // After mount: StrictMode's dev double effects stop any sound playing at mount.
  setTimeout(() => {
    if (playing === 'chord') void play({ playing: kind === 'voice' ? 'reference' : 'key', caption: chord });
    if (playing === 'first') void play({ playing: 'reference', caption: { kind: 'first-note', written: f.writtenPitch, concertMidi: midiOf(f.concertPitch) } });
    if (playing === 'tempo') void services.hearTempo!();
    if (playing === 'listen') void play({ playing: 'listen', caption: { kind: 'bar', bar: 3, of: 8 }, bar: 3 });
  }, 400);
  (window as unknown as { story: unknown }).story = { events, view, sounds };

  let hash = '#/practice/scan';
  const ls = new Set<() => void>();
  const loc: LocationSource = {
    getHash: () => hash,
    subscribe: (l) => (ls.add(l), () => ls.delete(l)),
    navigate(path) {
      hash = `#${path}`;
      ls.forEach((l) => l());
    },
  };
  const table = createRouteTable(practiceFlowScreenOverrides(services));
  function Current() {
    const route = useRoute();
    useSyncExternalStore(loc.subscribe, loc.getHash);
    const { Screen } = route.def;
    return <Screen route={route} />;
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <GlyphSprite />
      <RouterProvider table={table} source={loc}>
        <ToastProvider suppressed={false}>
          <Current />
        </ToastProvider>
      </RouterProvider>
    </StrictMode>,
  );
}

void main();
