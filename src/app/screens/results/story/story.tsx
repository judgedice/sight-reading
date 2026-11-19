/**
 * Dev-only story page for results: `/src/app/screens/results/story/index.html` on the Vite dev server. It mounts the
 * real ResultsScreen with the real review (notation, ghosts, bar wash) over a fake session, so each `results-*`,
 * `results-states-*` and `tips-*` mockup state can be shown and screenshotted. Not shipped; literals are dev data.
 *
 * Query: state=ranked|practice|listened|uncal|void|incomplete|notlistening, playing=<bar>, tapped=<bar>, tips=open,
 * toast=1, setup=1, dark, hc.
 */
import { StrictMode, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { createStore } from 'zustand/vanilla';
import { createEmitter } from '../../../../core/events.ts';
import type { AppSettings, ClockSeconds, DetectedNote, ExcerptChunk, ExcerptDoc, NoteJudgment, PlayerProfile, PreparedExcerpt, SelectionResult, SessionEvent, Tip } from '../../../../core/types.ts';
// eslint-disable-next-line boundaries/dependencies -- dev story only (not shipped): ghost spelling as the composition root binds it
import { ghostPitch } from '../../../../follow/index.ts';
import * as notation from '../../../../notation/index.ts';
import { preparedFromDoc } from '../../../../notation/testing/prepared.ts';
import { createSessionStore, idleSoundView, planTake, type SoundView } from '../../../../session/index.ts';
import { defaultAppSettings } from '../../../../store/defaults.ts';
import { makeAttempt, makeProfile, makeScore } from '../../../../store/test-data.ts';
import { GlyphSprite, ToastProvider } from '../../../../ui/primitives/index.ts';
import { bindNotation } from '../../../../ui/score-frame/index.ts';
import '../../../../ui/tokens.css';
import '../../../app.css';
import { appConfigs } from '../../../compose/configs.ts';
import shardL03 from '../../../../../fixtures/corpus/shard-L03-01.a5c80d091c.json';
import { RouterProvider, useRoute, type LocationSource } from '../../../router.tsx';
import { createRouteTable } from '../../../routes.tsx';
import { createReviewRenderer, type ReviewExtras } from '../review/index.ts';
import { resultsScreenOverrides } from '../index.ts';
import type { ResultsSetupServices } from '../ResultsScreen.tsx';
import type { ResultsServices } from '../services.ts';

const q = new URLSearchParams(location.search);
if (q.has('dark')) document.documentElement.dataset.theme = 'dark';
if (q.has('hc')) document.documentElement.setAttribute('data-contrast', 'high');
const state = q.get('state') ?? 'ranked';
const playingBar = q.get('playing');
const tappedBar = q.get('tapped');

const cfg = appConfigs();
const BPM = 72;

function excerpt(): PreparedExcerpt {
  const chunk = shardL03 as unknown as ExcerptChunk;
  const doc = chunk.excerpts.find((x: ExcerptDoc) => x.id === 'jaell-lc6157272-voice-m20-27')!;
  const key = { fifths: 1, mode: 'major' as const };
  const base = preparedFromDoc({ ...doc, keyConcert: key }, 'bass');
  const selection = { settings: { instrumentId: 'voice-baritone', level: 2, writtenKey: key, meter: '4/4', bpm: BPM, bars: 8, randomized: [], seed: 1 } } as unknown as SelectionResult;
  return { ...base, instrumentId: 'voice-baritone', levelServed: 2, writtenKey: key, concertKey: key, selection };
}

function detected(id: number, onset: number, durSec: number, midi: number): DetectedNote {
  return {
    id,
    onset: onset as ClockSeconds,
    offset: (onset + durSec) as ClockSeconds,
    provisionalMidi: midi,
    midi,
    stableMedianCents: (midi - Math.round(midi)) * 100,
    steadyMs: durSec * 1000,
    pitchSdCents: 4,
    clarity: 0.95,
    altOctaveClarity: null,
    onsetCause: 'from-silence',
    framesAgree: true,
  };
}

function main(): void {
  const prepared = excerpt();
  const plan = planTake(prepared, cfg);
  const expected = plan.expected;
  // Slips like the mockup's: a sharp note, wrong notes, a late note and a missed one.
  const pick = (bar: number, k: number): number => {
    const inBar = expected.filter((e) => e.bar === bar);
    return (inBar[Math.min(k, inBar.length - 1)] ?? expected[0]!).idx;
  };
  const SHARP = pick(1, 2);
  const WRONG = [pick(2, 2), pick(6, 2)];
  const LATE = pick(3, 2);
  const MISSED = pick(4, 2);
  const dets: DetectedNote[] = [];
  const T0 = 5;
  const judgments: NoteJudgment[] = expected.map((e) => {
    if (e.idx === MISSED) {
      return {
        expectedIdx: e.idx, status: 'missed', detectedId: null, timing: null, timingErrorMs: null, pitch: null, playedConcertMidi: null,
        centsError: null, octaveDisplaced: false, duration: 'not-graded', heldRatio: null, credit: { p: 0, n: null, o: 0, d: null }, marginal: false, rejudged: false,
      };
    }
    let midi = e.concertMidi;
    let pitch: NoteJudgment['pitch'] = 'in-tune';
    let timing: NoteJudgment['timing'] = 'on-time';
    let errMs = 0;
    let cents = 2;
    if (e.idx === SHARP) {
      midi += 0.4;
      cents = 40;
      pitch = 'sharp';
    }
    if (WRONG.includes(e.idx)) {
      midi = e.concertMidi - 1;
      cents = 0;
      pitch = 'wrong-pitch';
    }
    if (e.idx === LATE) {
      errMs = 140;
      timing = 'late';
    }
    const id = 100 + e.idx;
    dets.push(detected(id, T0 + e.onsetSec + errMs / 1000, e.durSec * 0.9, midi));
    return {
      expectedIdx: e.idx, status: 'matched', detectedId: id, timing, timingErrorMs: errMs, pitch, playedConcertMidi: midi, centsError: cents,
      octaveDisplaced: false, duration: 'ok', heldRatio: 0.9, credit: { p: pitch === 'wrong-pitch' ? 0 : 1, n: 1, o: timing === 'late' ? 0.5 : 1, d: 1 }, marginal: false, rejudged: false,
    };
  });

  const score = makeScore(84);
  score.components = { P: 76, I: 93, R: 85 };
  score.weights = { P: 0.5, I: 0.2, R: 0.3 };
  score.diagnostics = {
    ...score.diagnostics,
    n: 29,
    matched: 28,
    driftMsAtEnd: 24,
    counts: { correct: 24, early: 0, late: 1, sharp: 1, flat: 0, wrong: 2, octave: 0, missed: 1, extra: 0 },
  };
  score.xp = { total: 12, base: 12, factors: [] };
  if (state === 'practice') Object.assign(score, { ranked: false, rankedReasons: ['practice-mode'], xp: { total: 3, base: 12, factors: [{ id: 'practice', value: 0.25 }] } });
  if (state === 'listened') Object.assign(score, { ranked: false, rankedReasons: ['listened-first'], xp: { total: 3, base: 12, factors: [{ id: 'practice', value: 0.25 }] } });
  if (state === 'uncal') Object.assign(score, { ranked: false, rankedReasons: ['practice-mode', 'calibration'], xp: { total: 3, base: 12, factors: [{ id: 'practice', value: 0.25 }] } });
  if (state === 'incomplete') Object.assign(score, { status: 'incomplete', score: 41, grade: 'D', stars: 0, xp: { total: 0, base: 12, factors: [] } });

  const voided = state === 'void';
  const notListening = state === 'notlistening';
  const record = makeAttempt(3, {
    id: 'attempt-story',
    excerptId: prepared.excerptId,
    instrumentId: 'voice-baritone',
    levelServed: 2,
    bpm: BPM,
    clef: 'bass',
    writtenKey: prepared.writtenKey,
    concertKey: prepared.concertKey,
    detected: voided || notListening ? [] : dets,
    judgments: voided || notListening ? [] : judgments,
    score: voided || notListening ? null : score,
    listening: !notListening,
    endReason: voided ? 'void' : 'complete',
    ...(voided ? { voidReason: 'no-signal' as const } : {}),
    credit: { composer: 'Melody in G major', work: 'composed for Sightread practice', sourceMeasures: [1, 8], corpus: 'openscore-lieder', license: 'CC0-1.0' },
  });

  const tips: Tip[] = voided || notListening
    ? []
    : [
        {
          id: 'U12a',
          patternId: 'E12',
          text: 'Notes from the key signature were missed (for example F instead of F♯). Before you start, name the key and its altered notes out loud: “G major: F♯.”',
          evidence: 'Seen in bars 2 and 6.',
          bars: [2, 6],
          primary: true,
        },
        {
          id: 'U2a',
          patternId: 'E2',
          text: 'You fell behind the click. Keep your eyes at least one beat ahead, and keep moving when a note goes wrong: a wrong note on time beats a right note late.',
          evidence: 'Seen in bars 3 to 8.',
          bars: [3, 4, 5, 6, 7, 8],
          primary: false,
        },
      ];

  const events = createEmitter<SessionEvent>();
  const { store: view } = createSessionStore(events);
  events.emit({ type: 'prepared', excerpt: prepared });
  view.setState({ state: 'results', record, tips, progress: [], prepared });

  const sounds = createStore<SoundView>()(() => idleSoundView());
  const play = (s: Partial<SoundView>): Promise<void> => {
    sounds.setState({ ...idleSoundView(), ...s });
    return Promise.resolve();
  };
  let settings: AppSettings = defaultAppSettings();
  settings = { ...settings, practice: { ...settings.practice, instrumentId: 'voice-baritone', level: 2 } };
  const sl = new Set<() => void>();
  const profileValue: PlayerProfile = makeProfile({ xp: 2215, rank: 3 });
  const notationBound = bindNotation(notation);
  const baseRender = createReviewRenderer({
    configs: cfg,
    session: view,
    settings: { get: () => settings, subscribe: (l) => (sl.add(l), () => sl.delete(l)) },
    loadNotation: () => Promise.resolve(notationBound),
    spell: ghostPitch,
  });
  let tapped = false;
  const services: ResultsServices & ResultsSetupServices = {
    configs: cfg,
    session: view,
    profile: { get: () => profileValue, subscribe: () => () => undefined },
    settings: {
      get: () => settings,
      set(next) {
        settings = next;
        sl.forEach((l) => l());
      },
      subscribe: (l) => (sl.add(l), () => sl.delete(l)),
    },
    actions: {
      next: () => false,
      tryAgain: () => false,
      moveUp: () => undefined,
      stayAt: () => undefined,
      undoLevelUp: () => undefined,
      goToLevel: () => undefined,
    },
    renderReview: ((r: typeof record, extras?: ReviewExtras) => {
      if (tappedBar && !tapped && extras?.onBarTap) {
        tapped = true;
        const index = prepared.measures.findIndex((m) => m.displayBar === Number(tappedBar));
        setTimeout(() => extras.onBarTap?.(index), 300);
      }
      return baseRender(r, extras);
    }) as ResultsServices['renderReview'] & object,
    listen: (o) => play({ playing: 'listen', caption: { kind: 'bar', bar: o.fromBar ?? 1, of: 8 }, bar: o.fromBar ?? 1 }),
    hearBar: (from) => play({ playing: 'bar', caption: { kind: 'bar', bar: from, of: 8 }, bar: from }),
    stopSounds: () => sounds.setState(idleSoundView()),
    sounds,
    countEligible: () => 40,
    hearTempo: () => Promise.resolve(),
    playNote: () => Promise.resolve(),
    settleMs: 60_000,
  };

  let hash = '#/practice/results';
  const ls = new Set<() => void>();
  const loc: LocationSource = {
    getHash: () => hash,
    subscribe: (l) => (ls.add(l), () => ls.delete(l)),
    navigate(path) {
      hash = `#${path}`;
      ls.forEach((l) => l());
    },
  };
  const table = createRouteTable(resultsScreenOverrides(services));
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
        <ToastProvider suppressed={false} durationMs={600_000}>
          <Current />
        </ToastProvider>
      </RouterProvider>
    </StrictMode>,
  );
  (window as unknown as { story: unknown }).story = { view, sounds };

  setTimeout(() => {
    if (playingBar) void play({ playing: 'listen', caption: { kind: 'bar', bar: Number(playingBar), of: 8 }, bar: Number(playingBar) });
    if (q.get('tips') === 'open') document.querySelector<HTMLButtonElement>('.res-tip-more')?.click();
    if (q.get('setup') === '1') [...document.querySelectorAll('button')].find((b) => b.textContent === 'Change setup')?.click();
    if (q.get('toast') === '1') {
      document.querySelector<HTMLButtonElement>('.res-tip-more')?.click();
      setTimeout(() => document.querySelector<HTMLInputElement>('.res-tip-setting input')?.click(), 50);
    }
  }, 600);
}

main();
