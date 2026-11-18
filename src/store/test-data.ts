/** Builders and in-memory fakes for store tests. Not imported by production code. */
import type { AttemptRecord, AttemptScore, Calibration, JsonValue, PlayerProfile } from '../core/types.ts';
import type { KeyValue, StoreRepos } from '../core/platform.ts';
import { defaultAppSettings } from './defaults.ts';
import { KV_SETTINGS } from './keys.ts';
import { summarizeAttempt } from './summary.ts';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function makeProfile(over: Partial<PlayerProfile> = {}): PlayerProfile {
  return {
    schemaVersion: 1,
    id: '11111111-1111-4111-8111-111111111111',
    displayName: 'Player',
    createdAt: '2026-01-01T00:00:00.000Z',
    xp: 120,
    rank: 1,
    streak: { days: 2, lastDay: '2026-01-02' },
    daily: { day: '2026-01-02', rankedCount: 1, attemptCount: 2, repeats: { 'ex-1': 1 } },
    instruments: {
      flute: { level: 2, window: [], attemptsRanked: 3, bestByLevel: { 1: 88 }, patternCounts: { E1: 2 }, recentPrimaryPatterns: ['E1'], tuningOffsetCents: null, offerSuppressedUntil: null, pendingOffer: null, autoLevelUpUndo: null, autoRun: { count: 0, atMidTempo: 0 }, placement: null },
    },
    seenGroups: { 'grp-1': '2026-01-02T10:00:00.000Z' },
    recentTips: ['tip-a'],
    rankedIndex: 3,
    lastSkipRankedIndex: null,
    activeInstrumentId: 'flute',
    configVersion: 'cfg-1',
    ...over,
  };
}

export function makeAttempt(i: number, over: Partial<AttemptRecord> = {}): AttemptRecord {
  const day = String(1 + Math.floor(i / 20)).padStart(2, '0');
  const sec = String(i % 60).padStart(2, '0');
  const min = String(Math.floor(i / 60) % 60).padStart(2, '0');
  return {
    schemaVersion: 1,
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    profileId: '11111111-1111-4111-8111-111111111111',
    createdAt: `2026-02-${day}T10:${min}:${sec}.000Z`,
    appVersion: '0.0.0',
    configVersion: 'cfg-1',
    corpusVersion: 'c-1',
    coreVersion: 'core-1',
    excerptId: `ex-${i % 5}`,
    dedupeGroup: `grp-${i % 5}`,
    instrumentId: i % 2 === 0 ? 'flute' : 'violin',
    beta: false,
    levelServed: 1 + (i % 3),
    stretch: false,
    placement: false,
    settingsResolved: {
      instrumentId: 'flute', level: 1, writtenKey: { fifths: 0, mode: 'major' }, meter: '4/4', bpm: 72, bars: 8, mode: 'ranked',
      listening: true, metronome: 'audible', clickTimbre: 'tick', outputMode: 'speakers', a4Hz: 440, seed: i,
    },
    transposition: { diatonic: 0, chromatic: 0 },
    writtenKey: { fifths: 0, mode: 'major' },
    concertKey: { fifths: 0, mode: 'major' },
    clef: 'treble',
    bpm: 72,
    scanSeconds: 20,
    listening: true,
    calibration: { method: 'loopback', latencyCompensationMs: 40, outputMode: 'speakers', recheck: null },
    tuning: null,
    audioEnv: {
      platform: 'web', osFamily: 'other', displayMode: 'browser', appBuild: '0.0.0', coreVersion: 'core-1', inputPath: 'mic',
      metronomeMode: 'audible', clickTimbre: 'tick', outputMode: 'speakers',
      route: { inputKind: 'built-in', sampleRate: 48000, appliedProcessing: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } },
      contextSampleRate: 48000, contextRecreated: false, clockRateError: null, audioSessionType: null, latencyCompensationMs: 40,
      calibrationMethod: 'loopback', captureRelay: false, droppedBlocks: 0, maxQueueMs: 10, dspHopP95Ms: 1.5, gateFailures: [],
    },
    detected: [],
    judgments: [],
    extras: [],
    displaced: [],
    score: null,
    endReason: 'stopped',
    excerptBurned: true,
    countsAsSkip: false,
    credit: { composer: 'Composer', work: `Work ${i}`, sourceMeasures: [1, 8], corpus: 'openscore-lieder', license: 'CC0-1.0' },
    ...over,
  } as AttemptRecord;
}

export function makeScore(score: number, ranked = true): AttemptScore {
  return {
    status: 'ok',
    components: { P: score, I: score, R: score },
    weights: { P: 0.4, I: 0.3, R: 0.3 },
    score,
    grade: 'B',
    stars: 2,
    shine: false,
    ranked,
    rankedReasons: ranked ? [] : ['practice-mode'],
    diagnostics: {
      matched: 20, n: 20, stops: [], restarts: [], driftMsAtEnd: null,
      counts: { correct: 20, early: 0, late: 0, sharp: 0, flat: 0, wrong: 0, octave: 0, missed: 0, extra: 0 },
      signal: { medianClarity: 0.9, clippingFrac: 0 }, voiceDriftCents: null,
    },
    patterns: [],
    tipsShown: [],
    xp: { total: 10, base: 10, factors: [] },
    configVersion: 'cfg-1',
  };
}

export function makeCalibration(routeKey: string): Calibration {
  return {
    routeKey, platform: 'web', outputMode: 'speakers', method: 'loopback', roundTripMs: 80, spreadMs: 2, clicksDetected: 8,
    clickLeakDb: -40, noiseFloorDb: -70, templates: { tick: { rate: 16000, samples: [0, 0.5, -0.5, 0] } }, sanityToneCents: null,
    aecSuspected: false, clockRateError: null, measuredAt: '2026-01-01T00:00:00.000Z', stale: false,
  };
}

export class MemoryKv implements KeyValue {
  readonly map = new Map<string, JsonValue>();
  async get(k: string) { return this.map.get(k); }
  async set(k: string, v: JsonValue) { this.map.set(k, clone(v)); }
  async delete(k: string) { this.map.delete(k); }
  async keys() { return [...this.map.keys()]; }
}

/** Plain in-memory repos sharing a `MemoryKv` for settings. Mirrors the IndexedDB behaviour closely enough for pure tests. */
export function memoryRepos(kv: MemoryKv = new MemoryKv()): StoreRepos {
  let profile: PlayerProfile | undefined;
  const attempts = new Map<string, AttemptRecord>();
  const cals = new Map<string, Calibration>();
  const sorted = () => [...attempts.values()].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  return {
    profile: { get: async () => profile, put: async (p) => { profile = clone(p); } },
    attempts: {
      add: async (a) => { attempts.set(a.id, clone(a)); },
      recent: async (n) => sorted().reverse().slice(0, n),
      byId: async (id) => attempts.get(id),
      list: async (q) => sorted().reverse().filter((a) => (q.instrumentId === undefined || a.instrumentId === q.instrumentId)).slice(q.offset ?? 0, (q.offset ?? 0) + (q.limit ?? Infinity)).map(summarizeAttempt),
      all: async () => sorted(),
    },
    calibrations: { get: async (k) => cals.get(k), put: async (c) => { cals.set(c.routeKey, clone(c)); }, all: async () => [...cals.values()] },
    settings: {
      get: async () => ((await kv.get(KV_SETTINGS)) as never) ?? defaultAppSettings(),
      put: async (s) => kv.set(KV_SETTINGS, s as unknown as JsonValue),
    },
    clearAll: async () => { profile = undefined; attempts.clear(); cals.clear(); kv.map.clear(); },
  };
}
