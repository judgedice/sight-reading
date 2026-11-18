# 01 — Technical architecture

Owner: technical architect. Readers: the overseer merging the spec, and the implementers building each package in parallel.

This section fixes the stack, module boundaries and interfaces, the real-time audio and score-following design, the data model, persistence, budgets, testing, and the work breakdown. Where another role owns a decision (scoring weights, tip content, corpus sources, visual design, iOS), this section defines the interface that decision plugs into and a default that lets work start.

---

## 1. Summary of decisions

| Area | Decision | Runner-up (one sentence) |
| --- | --- | --- |
| Language | TypeScript 5.x, `strict: true`, `noUncheckedIndexedAccess: true` | Plain JS with JSDoc types, as in ear-to-staff, loses compiler-checked contracts between parallel teams. |
| UI framework | React 19 for screens and controls only; the score, overlay, and audio path never go through React state | Svelte 5 is lighter, but smaller models write React far more reliably. |
| App state | Zustand 5 store for UI state; plain TS event emitters for the real-time path | Redux Toolkit is heavier than needed. |
| Build | Vite (current major, pinned), pnpm, single app package with enforced internal module boundaries | A pnpm monorepo of many packages adds publishing overhead without benefit at this size. |
| Notation | VexFlow 5.x (SVG backend), our own layout of 2 to 3 systems, plus a separate SVG overlay layer for ghost notes and the playhead | Verovio (WASM) renders MusicXML beautifully but makes per-note live styling and time-to-x mapping harder and weighs about 7 MB. |
| Audio capture | AudioWorklet that decimates to about 16 kHz and posts blocks over a MessagePort straight to a DSP Web Worker | SharedArrayBuffer ring buffer needs COOP/COEP headers, which GitHub Pages cannot send. |
| Pitch | McLeod pitch method (ported from ear-to-staff), NSDF computed by FFT, range-limited per instrument | YIN is comparable; neural trackers (CREPE) cost too much on phones. |
| Onsets | Pitch-change and energy-retrigger state machine (adapted from ear-to-staff segmenter) plus band-limited spectral flux, with onset backtracking | Pure spectral flux misses slurred wind and voice changes. |
| Score following | Live: windowed cost-based greedy matcher on the audio clock. Final: banded dynamic-programming realignment that produces the graded result. | Full online DTW is unnecessary because the metronome fixes tempo. |
| Where the follower runs | In the DSP worker, next to pitch and onset detection, driven by audio frame time | Main thread is exposed to render jank, which would delay missed-note deadlines. |
| Persistence | IndexedDB via the `idb` library, behind repository interfaces | Dexie is fine but adds an abstraction juniors must learn. |
| Corpus runtime format | Our own canonical JSON (`ExcerptDoc`), sharded by level, with a small manifest | Shipping MusicXML and parsing it in the browser costs bundle size and parse time on every load. |
| Corpus build tooling | Offline Python 3.12 + music21 pipeline in `tools/corpus-build`, emitting JSON validated against a schema generated from the TS types | A Node MusicXML parser would be one language but would have to be written; music21 already reads kern, MusicXML, ABC, and MEI. |
| Unit tests | Vitest | Jest is slower with ESM and TS. |
| E2E tests | Playwright on Chromium with a fake audio capture device fed from WAV files | Cypress cannot inject fake microphone audio. |
| Hosting | Static, GitHub Pages, offline-capable PWA via `vite-plugin-pwa` | Netlify or Cloudflare Pages would be equally fine and could send COOP/COEP headers if ever needed. |

---

## 2. Stack and tooling

### 2.1 Why this stack for a swarm of junior implementers

- TypeScript types in `src/core/types.ts` are the contract between packages. An implementer can build `follow/` against the types and synthetic fixtures without `audio/` existing.
- Each package lives in its own folder with an `index.ts` public surface. Imports from another package's internals are a lint error.
- Real-time modules (`dsp/`, `follow/`, `grade/`, `theory/`, `corpus/`, `tips/`) are DOM-free and side-effect-free. They run in Node under Vitest, in the browser worker, and can later run in an iOS host (JavaScriptCore or a WKWebView). This is enforced by a separate `tsconfig.core.json` whose `lib` is `["ES2022"]` (plus `"WebWorker"` for `dsp/`) and excludes `"DOM"`.

### 2.2 Toolchain

- Node 22 LTS, pnpm 9, Vite (pinned), `@vitejs/plugin-react`.
- ESLint (flat config) with `typescript-eslint`, `eslint-plugin-react-hooks`, and `eslint-plugin-boundaries` encoding the dependency graph in section 3.1. `dependency-cruiser` runs in CI as a second check for cycles.
- Prettier, default config, 100 columns.
- Vitest for unit and pipeline tests, `@vitest/coverage-v8`. Coverage gate: 85% lines for `dsp/`, `follow/`, `grade/`, `theory/`, `corpus/`; no gate for `app/`.
- Playwright for E2E and visual regression.
- `ts-json-schema-generator` produces `schemas/excerpt.schema.json` from `ExcerptDoc`; the Python pipeline validates its output against it with `jsonschema`.
- GitHub Actions: lint, typecheck, unit, pipeline-accuracy suite, E2E (Chromium), build, deploy to Pages on `main`.
- Worklet and worker bundling in Vite: `import workletUrl from './capture.worklet.ts?worker&url'` then `audioContext.audioWorklet.addModule(workletUrl)`; workers via `new Worker(new URL('./dsp.worker.ts', import.meta.url), { type: 'module' })`. Implementers must not use `?url` alone on a `.ts` worklet, because Vite will not transpile it.

### 2.3 Browser support

Chrome/Edge 120+, Firefox 120+, Safari 17+ (macOS and iOS). All required APIs (AudioWorklet, module workers, IndexedDB, `getUserMedia`) exist in these. Safari quirks are listed in section 5.9.

---

## 3. Module boundaries

### 3.1 Folder layout and allowed dependencies

```
src/
  core/         types.ts, time.ts (ticks/beats/seconds), rng.ts (seeded), events.ts (typed emitter)
  theory/       spelled pitch, intervals, keys, transposition, MIDI conversion
  instruments/  instrument table (data) + helpers
  corpus/       manifest + shard loading, excerpt selection, transposition, expected-note builder
  audio/        AudioContext lifecycle, mic, capture worklet, metronome, transport clock, calibration
  dsp/          pure: fft, decimator, mpm, onset, segmenter, pipeline; dsp.worker.ts adapter
  follow/       live follower, final aligner, tolerance tables
  grade/        note and attempt scoring, points, rating, rank
  tips/         tip selection engine (content authored by lead musician)
  notation/     VexFlow rendering, layout model, overlay (note states, ghosts, playhead)
  store/        IndexedDB repositories and migrations
  session/      PracticeSession state machine that wires everything together
  app/          React screens and components
  testkit/      synthetic audio, scenario runner, fixtures (test-only, never imported by src/app)
tools/corpus-build/   Python pipeline (separate, owned with the score researcher)
public/corpus/v1/     generated manifest and shards
test/                 e2e/, scenarios/, recordings/
```

Allowed imports (arrow means "may import"):

```
core        <- everything
theory      -> core
instruments -> core, theory
corpus      -> core, theory, instruments
dsp         -> core
follow      -> core, theory
grade       -> core
tips        -> core
notation    -> core, theory, instruments        (DOM allowed)
audio       -> core, dsp (types only)           (DOM allowed)
store       -> core                             (DOM allowed: IndexedDB)
session     -> all of the above except app, testkit
app         -> session, notation, store, core, instruments (for pickers)
testkit     -> core, theory, dsp, follow, grade, corpus
```

### 3.2 Public interfaces

All types below live in `src/core/types.ts` unless noted. Package `index.ts` files export exactly the functions listed here. Signatures are binding; internal helpers are free.

#### Time and units

```ts
export const TPQ = 480;                 // ticks per quarter note; divisible by 2,3,4,5,6,8,16,32
export type Ticks = number;             // integer, from excerpt start (beat 1 of first full bar = pickupTicks)
export type Beats = number;             // float, in units of the meter's beat (see Meter.beatUnitTicks)
export type CtxSeconds = number;        // AudioContext clock
export type ScoreSeconds = number;      // seconds from bar 1 beat 1 at the attempt's tempo (negative during pickup/count-in)

// src/core/time.ts
export function ticksToScoreSeconds(t: Ticks, tempo: TempoSpec, meter: Meter): ScoreSeconds;
export function scoreSecondsToTicks(s: ScoreSeconds, tempo: TempoSpec, meter: Meter): number; // float ticks
```

Tempo is constant within an attempt in v1 (no rubato, no tempo changes, no swing). Compound meters count the dotted beat (6/8 at "dotted quarter = 60").

#### theory

```ts
export type Step = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
export interface SpelledPitch { step: Step; alter: -2 | -1 | 0 | 1 | 2; octave: number } // scientific, C4 = MIDI 60
export interface Interval { diatonic: number; chromatic: number }  // e.g. major sixth up = {5, 9}
export interface KeySig { fifths: number; mode: 'major' | 'minor' } // -7..7

export function toMidi(p: SpelledPitch): number;
export function transposePitch(p: SpelledPitch, iv: Interval): SpelledPitch;
export function transposeKey(k: KeySig, iv: Interval): KeySig;
export function intervalBetweenKeys(from: KeySig, to: KeySig, octaveHint: number): Interval; // smallest motion, then octave shift
export function spellMidiInKey(midi: number, key: KeySig): SpelledPitch;  // for ghost notes
export function freqToMidi(hz: number, a4: number): number;               // fractional
export function midiToFreq(midi: number, a4: number): number;
```

Ported from ear-to-staff `theory.js`, but pitch is spelled (step/alter/octave), not a MIDI number plus a sharp/flat preference, because excerpts carry real spellings that must survive transposition.

#### instruments

```ts
export type OnsetProfile = 'tongued-wind' | 'brass' | 'bowed' | 'plucked' | 'voice' | 'struck';
export type Clef = 'treble' | 'bass' | 'alto' | 'tenor' | 'treble-8vb';

export interface Instrument {
  id: string;                         // 'alto-sax'
  label: string;                      // 'E♭ alto saxophone'
  family: 'woodwind' | 'brass' | 'strings' | 'voice' | 'keyboard' | 'guitar';
  writtenMinusSounding: Interval;     // alto sax {5, 9}; guitar {7, 12}; concert {0, 0}
  clefs: Clef[];                      // preferred first; viola ['alto','treble']
  writtenRange: { min: number; max: number };        // MIDI, full
  comfortableRange: { min: number; max: number };    // MIDI, by level band; see corpus selection
  detection: {
    minHz: number; maxHz: number;     // sounding, used to bound MPM lags
    windowSamples: 512 | 1024 | 2048; // at analysis rate (~16 kHz)
    onsetProfile: OnsetProfile;
    allowOctaveEquivalence: boolean;  // true for voice by default
  };
  intonationBonusCents: number;       // added to in-tune tolerance (voice +10, strings 0)
  polyphonic: false;                  // v1 invariant
}
export const INSTRUMENTS: readonly Instrument[];
export function instrumentById(id: string): Instrument;
```

v1 instrument list: flute, oboe, B♭ clarinet, bassoon, E♭ alto sax, B♭ tenor sax, E♭ baritone sax, B♭ trumpet, F horn, trombone, euphonium (bass clef), tuba, violin, viola, cello, double bass, voice (soprano, alto, tenor, bass), guitar (single line), piano (right-hand single line). The lead musician owns ranges per level; this table owns the shape.

#### corpus

```ts
export interface PracticeSettings {
  instrumentId: string;
  meter: Meter | 'random';
  key: KeySig | 'random';             // concert or written? -> WRITTEN key, what the player reads
  level: number | 'random';           // 1..10
  bpm: number | 'random';
  bars: 8 | 10 | 12 | 'random';
  countInBars: 1 | 2;
  a4Hz: number;                       // 415..446, default 440
  metronome: 'audible' | 'countInOnly' | 'visual';
  seed?: number;
}

export function loadManifest(baseUrl: string): Promise<CorpusManifest>;
export function loadExcerpt(manifest: CorpusManifest, id: string): Promise<ExcerptDoc>;
export function selectExcerpt(
  manifest: CorpusManifest, settings: PracticeSettings, history: SelectionHistory, rng: Rng,
): SelectionResult | { error: 'no-match'; relaxed: Partial<PracticeSettings> };
export function prepareExcerpt(doc: ExcerptDoc, sel: SelectionResult, instrument: Instrument): PreparedExcerpt;
export function buildExpectedNotes(p: PreparedExcerpt): ExpectedNote[];
```

The key setting means the written key the player sees, because that is what a sight-reader chooses. The transposer converts through the instrument's interval.

#### dsp

```ts
export interface DspConfig {
  analysisRate: number;               // actual decimated rate, e.g. 16000 or 14700
  windowSamples: number; hopSamples: 128;
  minHz: number; maxHz: number; a4Hz: number;
  clarityThreshold: number;           // default 0.85
  gateDb: number;                     // adaptive; noise floor + 12 dB
  onsetProfile: OnsetProfile;
  clickArrivals: CtxSeconds[];        // expected click arrival times in the input timeline, for gating
  clickLeakDb: number;                // measured during calibration
}
export interface PitchFrame { t: CtxSeconds; midi: number | null; clarity: number; rmsDb: number; flux: number; inClickWindow: boolean }
export interface DetectedNote {
  id: number;
  onset: CtxSeconds;                  // backtracked onset, input timeline
  offset: CtxSeconds | null;          // null while sounding
  midi: number;                       // fractional concert MIDI, median of the stable region so far
  cents: number;                      // midi - round(midi), *100
  clarity: number;
  onsetCause: 'pitch-change' | 'energy' | 'flux' | 'from-silence';
}
export type DspEvent =
  | { type: 'frames'; frames: PitchFrame[] }                 // batched, ~30/s to main for meters
  | { type: 'note-on'; note: DetectedNote }
  | { type: 'note-update'; note: DetectedNote }              // every ~50 ms while sounding
  | { type: 'note-off'; note: DetectedNote };

export class DspPipeline {                                    // pure; no worker APIs inside
  constructor(cfg: DspConfig);
  push(block: Float32Array, startT: CtxSeconds): DspEvent[];
  flush(t: CtxSeconds): DspEvent[];
}
export function runOffline(samples: Float32Array, rate: number, cfg: DspConfig): DspEvent[]; // tests
```

#### follow

```ts
export interface FollowConfig {
  expected: ExpectedNote[];
  t0: CtxSeconds;                     // context time of bar 1 beat 1 as scheduled (speaker)
  roundTripLatency: number;           // seconds, from calibration
  tolerances: Tolerances;             // from tolerance table, see 6.3
  beatSeconds: number;
  instrument: Instrument;
}
export class LiveFollower {
  constructor(cfg: FollowConfig);
  onDsp(ev: DspEvent): FollowerEvent[];
  onClock(inputT: CtxSeconds): FollowerEvent[];  // called per DSP hop; fires deadlines (missed notes)
  end(inputT: CtxSeconds): FollowerEvent[];
}
export function finalAlign(expected: ExpectedNote[], detected: DetectedNote[], cfg: FollowConfig): NoteJudgment[];
```

#### grade

```ts
export function scoreAttempt(j: NoteJudgment[], extras: ExtraNote[], ctx: GradeContext): AttemptScore;
export function applyAttemptToProfile(p: PlayerProfile, a: AttemptRecord): PlayerProfile; // pure
export function rankFor(points: number): Rank;
```

Weights, rank names, and thresholds come from a `grading.config.ts` data file the lead musician and designer own. Section 7 gives defaults.

#### tips

```ts
export function selectTips(input: {
  instrument: Instrument; attempt: AttemptRecord; recent: AttemptRecord[];
  profile: PlayerProfile; catalog: TipCatalog; rng: Rng;
}): Tip[];   // 1 primary + up to 2 secondary
```

#### notation

```ts
export interface RenderOptions { width: number; barsPerSystem: number; scale: number; showFingerings: false }
export interface ScoreLayout {
  systems: { index: number; top: number; bottom: number; staffTopY: number; lineSpacing: number; firstBar: number; lastBar: number }[];
  noteBoxes: Map<string, { system: number; x: number; y: number; w: number; h: number }>; // by ScoreEvent.id
  beatToPoint(scoreBeat: Beats): { system: number; x: number } | null;   // piecewise linear over tickable x's and barlines
  staffY(system: number, pitch: SpelledPitch, clef: Clef): number;
}
export interface ScoreView {
  render(p: PreparedExcerpt, container: HTMLElement, o: RenderOptions): ScoreLayout;
  setNoteState(expectedIdx: number, s: NoteVisualState): void;
  showGhost(g: GhostNote): void;                // add or update by g.detectedId
  removeGhost(detectedId: number): void;
  setPlayhead(scoreBeat: Beats | null): void;
  clearOverlay(): void;
}
export type NoteVisualState = 'pending' | 'active' | 'correct' | 'timing-error' | 'pitch-error' | 'missed' | 'both-error';
export interface GhostNote {
  detectedId: number; scoreBeat: Beats; durationBeats: number | null;
  writtenPitch: SpelledPitch; cents: number; kind: 'early' | 'late' | 'sharp' | 'flat' | 'wrong-pitch' | 'extra' | 'octave';
}
```

The static score SVG is rendered once per exercise. All live changes go to the overlay SVG (absolutely positioned on top) and to CSS classes on note groups found by `id`. Nothing re-renders VexFlow during a performance.

#### store

```ts
export interface ProfileRepo { get(id: string): Promise<PlayerProfile | undefined>; put(p: PlayerProfile): Promise<void>; list(): Promise<PlayerProfile[]> }
export interface AttemptRepo { add(a: AttemptRecord): Promise<void>; recent(profileId: string, n: number): Promise<AttemptRecord[]>; byExcerpt(excerptId: string): Promise<AttemptRecord[]> }
export interface CalibrationRepo { get(deviceKey: string): Promise<Calibration | undefined>; put(c: Calibration): Promise<void> }
export interface SettingsRepo { get(): Promise<AppSettings>; put(s: AppSettings): Promise<void> }
export function openStore(): Promise<{ profiles: ProfileRepo; attempts: AttemptRepo; calibrations: CalibrationRepo; settings: SettingsRepo }>;
export function exportAll(): Promise<Blob>;  export function importAll(b: Blob): Promise<void>;
```

#### session

```ts
export type SessionState = 'idle' | 'loading' | 'ready' | 'calibrating' | 'count-in' | 'performing' | 'finishing' | 'results' | 'error';
export class PracticeSession {
  constructor(deps: SessionDeps);          // injected repos, corpus, audio, view; enables tests with fakes
  readonly events: Emitter<SessionEvent>;  // state changes + FollowerEvent passthrough + results
  prepare(settings: PracticeSettings): Promise<PreparedExcerpt>;
  start(): Promise<void>;                  // requires user gesture upstream
  stop(): Promise<AttemptRecord | null>;
  retrySameExcerpt(): Promise<void>;
}
```

`PracticeSession` is plain TS, not React. React subscribes to `events` and holds only display state. This keeps the orchestration portable to iOS.

---

## 4. Canonical data model

### 4.1 Excerpt (corpus document)

```ts
export interface ExcerptDoc {
  schemaVersion: 1;
  id: string;                          // stable, kebab: 'bach-bwv1013-allemande-m1-8'
  source: {
    composer: string; composerDates?: string; work: string; catalog?: string; movement?: string;
    sourceMeasures: [number, number];  // inclusive, in the original numbering
    corpus: string;                    // 'kernscores' | 'openscore-lieder' | 'mutopia' | ...
    sourceUrl: string; license: 'PD' | 'CC0' | 'CC-BY-4.0' | 'CC-BY-SA-4.0'; attribution: string;
    originalInstrument?: string;       // 'flute', 'voice', 'violin I'
  };
  meter: Meter;                        // single meter for the whole excerpt in v1
  keyConcert: KeySig;                  // key at excerpt start, concert pitch
  tempo: { markedBpm?: number; minBpm: number; maxBpm: number; marking?: string };
  pickupTicks: Ticks;                  // 0 if none; length of anacrusis
  measures: Measure[];                 // 8..12 full measures (+ optional pickup at index 0)
  rangeConcert: { min: number; max: number };   // MIDI
  features: DifficultyFeatures;
  level: number;                       // 1..10, computed by pipeline, reviewed by lead musician
  phraseQuality: 'complete-phrase' | 'period' | 'phrase-pair';   // researcher's musicality tag
  tags: string[];                      // 'baroque','dance','stepwise','arpeggio','minor'...
}
export interface Meter { beats: number; beatType: 2 | 4 | 8 | 16; countUnitTicks: Ticks; countsPerBar: number } // 6/8: countUnit = 720, counts = 2
export interface Measure { index: number; isPickup: boolean; startTick: Ticks; events: ScoreEvent[] }
export type ScoreEvent = NoteEvt | RestEvt;
interface EvtBase { id: string; tick: Ticks; dur: Ticks; tuplet?: { actual: number; normal: number; groupId: string } }
export interface NoteEvt extends EvtBase {
  kind: 'note'; pitch: SpelledPitch;   // concert pitch, original spelling
  tieStart?: true; tieStop?: true; slur?: 'start' | 'stop' | 'continue';
  artic?: ('staccato' | 'staccatissimo' | 'tenuto' | 'accent' | 'marcato')[];
  dynamic?: 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff'; breath?: true;
}
export interface RestEvt extends EvtBase { kind: 'rest' }
export interface DifficultyFeatures {
  noteCount: number; notesPerBeat: number; shortestDur: Ticks; maxLeapSemis: number; meanAbsInterval: number;
  accidentalsOutsideKey: number; tupletCount: number; tieCount: number; syncopationIndex: number; restRatio: number; rangeSemis: number;
}
```

Excluded from v1 excerpts by the pipeline (reject or simplify): multiple voices, chords, grace notes, trills and ornaments, fermatas, tempo or meter changes, repeats and voltas (unrolled or rejected), cue notes, clef changes mid-excerpt. Dynamics and articulations are kept for display; only staccato and tenuto affect duration grading.

### 4.2 Corpus files and loading

```
public/corpus/v1/manifest.<hash>.json      // ≤ 200 KB gzip at 3,000 excerpts
public/corpus/v1/shard-L01.<hash>.json     // one shard per level; each ≤ 150 KB gzip
public/corpus/v1/index.json                // { manifest: 'manifest.<hash>.json' } — the only un-hashed file
```

```ts
export interface CorpusManifest {
  version: string; generatedAt: string;
  entries: ManifestEntry[];
}
export interface ManifestEntry {
  id: string; shard: string; level: number; meter: string /* '6/8' */; fifths: number; mode: 'major' | 'minor';
  bars: number; rangeConcert: [number, number]; minBpm: number; maxBpm: number;
  composer: string; title: string; tags: string[]; originalFamily?: string;
}
```

Loading: at app start fetch `index.json` (no-cache), then the hashed manifest (immutable cache). Fetch the needed shard on first selection at that level and prefetch the neighbouring levels in idle time. The service worker precaches the manifest and the player's current level shard, and runtime-caches the rest. Target corpus at launch: 1,500 to 3,000 excerpts (score researcher's call), at roughly 2 to 4 KB per excerpt gzipped.

### 4.3 Selection and transposition (runtime)

Inputs: manifest, settings, last 50 excerpt ids seen by this profile, seeded RNG.

1. Resolve `'random'` settings with the RNG. Level random means "player level ±1". Key random draws from keys allowed at that level (lead musician supplies the table; default: levels 1–2 up to 2 accidentals, 3–4 up to 3, 5–6 up to 4, 7+ up to 6). Tempo random draws within the excerpt's `[minBpm, maxBpm]` intersected with the level cap.
2. Filter: exact meter; `|entry.level - level| ≤ 1`; bar count matches (or any of 8 to 12 if random).
3. For each candidate compute the interval from its concert key to the target concert key (target written key minus instrument interval), trying octave shifts of −2..+2. Keep the shift whose written range fits the instrument's comfortable range for the level, preferring the smallest absolute transposition. Reject if no shift fits. Major excerpts go to major targets and minor to minor; a minor target key uses the relative-minor reading of the chosen signature.
4. Reject if the transposed spelling needs more than 2 double accidentals or a key beyond 6 sharps or flats (re-spell enharmonically first: F♯ major ↔ G♭ major).
5. Score each survivor: `fit = 1 - |transposeSemis|/24`, `freshness = 0` if seen in last 50 else 1, `levelMatch = 1 - |Δlevel|/2`, tag variety bonus 0.2 if the composer differs from the last 3 excerpts. Weighted random pick, weights `fit*0.3 + freshness*0.4 + levelMatch*0.3 + variety`.
6. If nothing survives, relax in this order and tell the UI what was relaxed: bars, level ±2, key (nearest by fifths), meter last.

`PreparedExcerpt` carries the written-pitch events, the written key, the clef chosen from the written range and instrument clef list, the concert interval used, and the seed.

### 4.4 Expected notes (follower input)

```ts
export interface ExpectedNote {
  idx: number;                        // 0..N-1 in time order
  eventIds: string[];                 // tied chain merged into one sounding note
  onsetBeat: Beats; durBeats: Beats;  // score beats from bar 1 beat 1 (pickup negative)
  onsetSec: ScoreSeconds; durSec: number;
  concertMidi: number;                // integer
  writtenPitch: SpelledPitch;
  ioiPrevSec: number | null; ioiNextSec: number | null;  // inter-onset intervals to neighbours
  followedByRest: boolean; precededByRest: boolean;
  repeatOfPrev: boolean;              // same pitch as previous note with no rest between
  artic: 'normal' | 'staccato' | 'tenuto' | 'accent';
  inFastRun: boolean;                 // ioi < 0.12 s on either side
}
export interface ExpectedRest { startSec: ScoreSeconds; endSec: ScoreSeconds; eventIds: string[] }
```

### 4.5 Note judgment and attempt

```ts
export type TimingVerdict = 'on-time' | 'early' | 'late';
export type PitchVerdict = 'in-tune' | 'sharp' | 'flat' | 'wrong-pitch' | 'octave';
export type DurationVerdict = 'ok' | 'short' | 'long' | 'not-graded';

export interface NoteJudgment {
  expectedIdx: number;
  status: 'matched' | 'missed';
  detectedId: number | null;
  timing: TimingVerdict | null; timingErrorMs: number | null;      // + = late
  pitch: PitchVerdict | null; playedConcertMidi: number | null; centsError: number | null; // vs expected, after octave handling
  duration: DurationVerdict; heldRatio: number | null;             // played duration / written duration
  credit: { pitch: number; timing: number; duration: number };     // 0..1 each, filled by grade/
  source: 'live' | 'final';
}
export interface ExtraNote { detectedId: number; onsetSec: ScoreSeconds; concertMidi: number; cents: number; durSec: number; duringRest: boolean }

export interface AttemptRecord {
  id: string; profileId: string; createdAt: string; appVersion: string;
  excerptId: string; corpusVersion: string;
  settingsResolved: Omit<PracticeSettings, 'seed'> & { seed: number };  // no 'random' left
  transposition: Interval; writtenKey: KeySig; instrumentId: string; bpm: number;
  calibration: { roundTripMs: number; method: Calibration['method']; deviceKey: string };
  detected: DetectedNote[];            // compact; ≤ ~300 per attempt
  judgments: NoteJudgment[];           // final
  extras: ExtraNote[];
  score: AttemptScore;
  aborted: boolean;                    // stopped before last expected note
  debug?: { liveJudgments: NoteJudgment[] };  // kept only when dev flag is on
}
export interface AttemptScore {
  total: number;                       // 0..100
  pitchPct: number; rhythmPct: number; durationPct: number;
  counts: { correct: number; early: number; late: number; sharp: number; flat: number; wrong: number; octave: number; missed: number; extra: number };
  meanTimingBiasMs: number;            // + = dragging
  timingSpreadMs: number;              // MAD of timing errors
  meanCentsBias: number;
  pointsEarned: number;
  passed: boolean;                     // total ≥ pass threshold for the level
}
```

### 4.6 Player profile

```ts
export interface PlayerProfile {
  schemaVersion: 1;
  id: string; displayName: string; createdAt: string;
  activeInstrumentId: string;
  perInstrument: Record<string, InstrumentProgress>;
  totals: { points: number; attempts: number; practiceSeconds: number };
  rank: Rank;                          // derived from points, cached
  streak: { currentDays: number; bestDays: number; lastPracticeDate: string };
  seenExcerpts: string[];              // last 200 ids, ring
}
export interface InstrumentProgress {
  level: number;                       // current suggested level 1..10
  rating: number;                      // Elo-like skill estimate, default 1000
  attempts: number; bestScoreByLevel: Record<number, number>;
  errorRates: Record<'early' | 'late' | 'sharp' | 'flat' | 'wrong' | 'octave' | 'missed' | 'extra' | 'short' | 'long', number>; // EWMA per note, α = 0.1
  timingBiasMs: number; centsBias: number;   // EWMA
  lastTipIds: string[];                // avoid repeats, last 10
}
export interface Rank { id: string; label: string; minPoints: number }
export interface Calibration {
  deviceKey: string;                   // hash(inputDeviceLabel|outputDeviceLabel|sampleRate|uaFamily)
  roundTripMs: number; method: 'loopback' | 'play-along' | 'reported';
  clickLeakDb: number; noiseFloorDb: number; measuredAt: string; spreadMs: number;
}
```

---

## 5. Real-time audio pipeline

### 5.1 Clock model

One clock: the AudioContext clock. Every timestamp in the system is either a context time or a score time derived from it.

- The transport picks `t0` (context time of bar 1 beat 1) as `ctx.currentTime + 0.25 + countIn` when the player presses Start. Clicks are scheduled at `t0 + k*beatSec` for integer `k` (negative during count-in).
- The capture worklet stamps each block with `currentFrame / sampleRate`, which is the context time of that input block.
- A player who hears a click and plays exactly on it produces sound whose captured timestamp is `clickTime + RTL`, where RTL (round-trip latency) is output latency plus input latency. That holds for speakers and headphones alike. So the follower converts a detected onset to score time with `scoreSec = onset - t0 - RTL`. RTL is the only latency number the follower needs, and calibration measures it directly.
- Visual playhead: drawn at `audibleNow = ctx.getOutputTimestamp()`-mapped context time minus `ctx.outputLatency` (0 when unreported), so the cursor matches what the player hears.

### 5.2 Graph

```
getUserMedia({ audio: { echoCancellation:false, noiseSuppression:false, autoGainControl:false,
                        channelCount:1, deviceId? } })
  -> MediaStreamSource -> CaptureWorkletNode ("capture-processor")   (not connected to destination)
        |  MessagePort (transferred to the worker at startup; main thread not in the path)
        v
     DSP worker: DspPipeline -> LiveFollower -> postMessage(FollowerEvent[]) -> main thread
Metronome: OscillatorNode-free; AudioBufferSourceNode playing a pre-rendered click buffer -> GainNode -> destination
```

- AudioContext: `new AudioContext({ latencyHint: 'interactive' })`. Do not force a sample rate; read `ctx.sampleRate`.
- Echo cancellation, noise suppression, and AGC are off. AEC treats sustained instrument tones as echo or noise and chews them; AGC changes level mid-note and breaks retrigger detection. Ear-to-staff made this a toggle; here it is forced off, with a hidden diagnostic toggle.
- Capture worklet work per 128-frame quantum: (a) 8th-order IIR low-pass at 4 kHz (two biquad sections are not enough; use four cascaded biquads), (b) decimate by `D = round(sampleRate / 16000)` (3 at 48 kHz, 3 at 44.1 kHz giving 14.7 kHz), (c) compute high-band energy above 4 kHz over 48-sample sub-blocks (about 1 ms) for click detection and calibration, (d) accumulate and post every 4 quanta: `{ startT, lowband: Float32Array, hiEnergy: Float32Array }` as transferables. Worklet code must not allocate in `process()` after warm-up.

### 5.3 Pitch detection

- Port `PitchDetector` from ear-to-staff `js/pitch.js`. Keep the NSDF, peak picking, `peakCutoff = 0.9`, and parabolic interpolation. Replace the O(n·τ) autocorrelation loop with FFT autocorrelation (zero-padded to 2n) so a 1024-sample window costs about 0.15 ms. Reuse ear-to-staff `js/fft.js` (radix-2 with tables), ported to TS.
- Window per instrument (`detection.windowSamples` at about 16 kHz): 512 (32 ms) for flute, oboe, violin, trumpet, soprano and alto voice; 1024 (64 ms) for clarinet, saxes, horn, viola, tenor voice, guitar, piano; 2048 (128 ms) for bassoon, trombone, euphonium, tuba, cello, double bass, bass voice. Hop is always 128 samples (8 ms).
- Lags are limited to the instrument's sounding range widened by 3 semitones each side. This alone removes most sub-octave errors.
- Clarity threshold 0.85 default (0.80 for voice and low brass).
- Output frame: fractional concert MIDI using `a4Hz`, or null.

### 5.4 Octave errors

1. Range restriction (5.3).
2. Frame-level octave hysteresis: a jump of 12 ± 0.5 semitones relative to the current note's median must persist for 4 consecutive frames (32 ms) before the segmenter accepts it, otherwise the frame is folded back to the current octave.
3. Score-informed correction in the follower, not the detector: when a detected note is exactly one octave from the expected note's pitch and the NSDF had a secondary peak at the expected lag with clarity ≥ 0.8 of the chosen peak (the worker includes `altOctaveClarity` on the note), treat it as the expected octave. Otherwise judge it as `pitch: 'octave'`. For voice with `allowOctaveEquivalence`, any octave displacement counts as in-tune and is reported only as an informational flag.

### 5.5 Onset detection and segmentation

Adapt ear-to-staff `NoteSegmenter` (`js/segmenter.js`): keep its state machine (onset after stable frames, offset after silence frames, split on pitch change beyond `changeCents`, level-jump retrigger). Changes:

- Frame rate goes from about 60/s (16 ms `setInterval` polling of an AnalyserNode) to 125/s (8 ms hop) on sample-accurate timestamps. Parameter defaults in frames are rescaled: `onsetFrames 3` (24 ms), `offsetFrames 8` (64 ms), `changeFrames 3`, `minNoteMs 60`.
- Add band-limited spectral flux (100 Hz to 4 kHz, half-wave rectified log-magnitude difference, 512-point FFT at hop 128) as a third onset cue. A flux peak above an adaptive threshold (median of last 0.5 s plus 3 MAD) while a note is sounding at the same pitch triggers a re-articulation split. This is what catches tongued repeated notes and bow changes that do not dip enough in RMS.
- Onset backtracking: the reported onset time is the earlier of (a) the start of the confirming candidate, and (b) the flux peak or RMS minimum within the 40 ms before confirmation. Target accuracy ±10 ms against ground truth on synthetic audio, ±20 ms on real recordings.
- Profile-specific parameters (`OnsetProfile`): `struck` and `plucked` rely mainly on flux and energy; `voice` and `bowed` raise `changeFrames` to 4 and lower flux sensitivity because of vibrato and bow noise; `tongued-wind` and `brass` use all three cues.
- Adaptive noise gate: noise floor measured in the 400 ms before the count-in starts and between count-in clicks (outside click windows); gate = floor + 12 dB, never below −70 dBFS.
- Detection latency (sound in, `note-on` out, excluding RTL): p50 ≤ 40 ms, p95 ≤ 60 ms for the 512 and 1024 windows; ≤ 90 ms for the 2048 window. The onset timestamp is backtracked, so this latency affects only how soon the UI reacts, not the timing grade.

### 5.6 Metronome and bleed rejection (same-device click and mic)

The click must be audible to the player yet invisible to the detector. Four layers:

1. Click design: 12 ms white-noise burst, 4th-order high-pass at 5 kHz, 2 ms attack, exponential decay. Accent: +5 dB and 18 ms. No tonal content in instrument bands. This replaces ear-to-staff's square-wave click at 1.2/1.8 kHz, whose fundamentals and harmonics sit squarely in instrument range. Pre-render both clicks into AudioBuffers once.
2. Spectral separation: the analysis path is low-passed at 4 kHz before decimation (5.2), so the click is attenuated by more than 40 dB in what MPM and flux see. The worklet's separate high-band channel sees the click clearly, which is what calibration uses.
3. Time gating: the follower knows every click's arrival time in the input timeline (`clickTime + RTL`). Within the window `[arrival − 5 ms, arrival + 35 ms]`, energy-only and flux-only onsets are suppressed unless pitch evidence (clarity above threshold for 3 frames) supports a new note. Pitch tracking of an already-sounding note continues through the window.
4. Leak floor: calibration measures the click's residual low-band level (laptop speakers distort and rattle). Inside click windows the energy-onset threshold is raised to `max(gate, clickLeakDb + 6 dB)`.

Metronome modes (setting): `audible` (default), `countInOnly` (count-in audible, then visual pulse only), `visual`. Recommend headphones in the setup screen, never require them. Scheduling uses the lookahead pattern from ear-to-staff `startMetronome` (timer every 25 ms, schedule 150 ms ahead), but the timer runs in the main thread only for scheduling, and the click times are also sent to the DSP worker at session start (they are fully determined by `t0` and tempo).

### 5.7 Latency measurement and calibration

Run on first use per device, when the device key changes, or on request. Takes about 8 seconds.

- Loopback (default, speakers): ask for silence. Play 10 accent clicks at randomized gaps of 400 to 700 ms. In the high-band energy channel find each click's arrival as the first 1 ms sub-block above noise + 20 dB, refined to the sample by the energy derivative peak. `RTL_i = arrival − scheduled`. Accept if at least 7 of 10 are detected and MAD ≤ 3 ms; `RTL = median`. Also record `clickLeakDb` (low-band level during arrivals) and `noiseFloorDb`.
- Play-along (fallback, and default when the output is headphones or loopback fails): play 8 clicks at 80 bpm; the player plays a short staccato note on each. `RTL = median(onset − click)` with MAD ≤ 25 ms required, clamped to 0..400 ms. Includes the player's own anticipation bias, which is acceptable and documented in the UI.
- Reported (last resort): `ctx.baseLatency + ctx.outputLatency + 0.010`. Mark attempts graded with this method; timing grades show a "timing may be offset" note.
- Sanity checks: RTL above 120 ms suggests Bluetooth output; show a warning and recommend wired or built-in output. If the player's mean timing bias across the last 5 attempts is consistently above +40 or below −40 ms with spread under 30 ms, suggest recalibrating rather than telling them they drag or rush.
- Typical expected values: built-in laptop 20 to 60 ms, phones 30 to 90 ms, Bluetooth 150 to 300 ms.

### 5.8 Transposing instruments and A4

Everything inside `dsp/`, `follow/`, and `grade/` is concert pitch. Written pitch exists only in `PreparedExcerpt`, `ExpectedNote.writtenPitch`, ghost notes, and the UI. Ghost notes convert played concert MIDI to written with the instrument interval, then spell it with `spellMidiInKey` in the written key, preferring the expected note's spelling when the pitch class matches. A4 is a setting (default 440 Hz) applied in `freqToMidi`.

### 5.9 Platform quirks to handle

- `AudioContext` must be created or resumed inside a user gesture (Start button). iOS Safari also suspends it on interruptions; listen to `statechange` and abort the attempt with a clear message.
- iOS Safari routes output to the receiver in some record configurations, making the click quiet. Detect low `clickLeakDb` plus failed loopback and fall back to play-along; the native iOS fork can fix routing properly.
- Safari reports `outputLatency` as 0; calibration covers it.
- Firefox may ignore `channelCount: 1`; the worklet downmixes.
- Some Android devices force AGC; detect with a level-stability check during calibration and warn.

### 5.10 Polyphonic instruments

v1 is monophonic. Piano and guitar are offered in single-line mode only: piano reads the right-hand melody in treble clef; guitar reads a single line in treble-8vb. Piano's sustain overlap is tolerated because flux onsets are strong for struck strings and the segmenter splits on the new attack; overlapping decay can lower clarity, so piano uses clarity 0.80. True polyphony (chords, two staves) is deferred to v2 and will use score-informed verification, not blind transcription: for each expected chord, compare a harmonic template of the expected notes against the observed spectrum (chroma plus per-partial energy) in a window around the expected onset. That is far more robust and cheaper than general polyphonic transcription. A neural transcriber such as Basic Pitch is the runner-up for v2 if templates prove insufficient.

---

## 6. Score following

### 6.1 Why not DTW

The metronome fixes tempo, so the mapping from score time to performance time is known up to latency (calibrated) and the player's local error, which is what we grade. A time-anchored matcher is simpler, deterministic, and gives immediate feedback. DTW would "forgive" rushing by warping time, which is the opposite of what a sight-reading grader wants.

### 6.2 Live matcher (runs in the DSP worker)

State per expected note: `pending → provisional → judged`, or `pending → missed`.

On `note-on(d)`:

1. `s = d.onset − t0 − RTL` (score seconds).
2. Candidates: expected notes that are `pending`, with `|s − e.onsetSec| ≤ W(e)`, limited to all pending notes before `s` plus the next 4 pending notes after it. `W(e) = clamp(2.5 × tolOnTime, 0.15 s, min(0.6 s, 1 beat))`.
3. Cost for each candidate: `c = (Δt / tolOnTime)² + P + K` where `Δt = s − e.onsetSec`, `P` is the pitch cost from the provisional pitch (0 if the nearest semitone equals expected, 1.5 if octave-related, 4 otherwise), and `K = 1.0 × (number of pending notes skipped over)`.
4. Take the lowest cost. If `c ≤ 9`, mark it `provisional`, emit `note-start` with `matchedExpected`. Otherwise the detected note is an extra: emit `extra`.
5. Timing verdict is final at match time and is emitted immediately in a `judgment` event with `pitch: null`, so the renderer can turn the note red and place the ghost at once if the player is early or late.

On `note-update` / `note-off` for a matched note: pitch is judged from the median of frames in `[onset + 30 ms, onset + min(0.8 × written duration, 300 ms)]` (skips the attack transient). Once that window has elapsed or the note ends, emit an updated `judgment` with the pitch verdict. Duration verdict is emitted on `note-off`.

On `onClock(t)` (every hop): any `pending` expected note with `t − t0 − RTL > e.onsetSec + W(e)` becomes `missed`; emit `missed`. Any detected note sounding for more than 100 ms inside an expected rest (and not the release tail of a matched note within `tolOnTime` of its written end) produces an `extra` with `duringRest: true`.

Session end: last expected note's end plus one bar, or the Stop button, or 2 bars of silence after the last activity (player gave up; remaining notes are `missed`, `aborted: true` if more than 25% remain).

### 6.3 Tolerances

Timing tolerance is the tighter of the level value and 25% of the note's shorter adjacent IOI, but never below 35 ms (our measurement noise is about ±15 ms).

| Level | On-time ±ms | Partial credit to ±ms | In-tune ±cents | Partial credit to ±cents |
| --- | --- | --- | --- | --- |
| 1–2 | 120 | 240 | 30 | 45 |
| 3–4 | 90 | 180 | 25 | 40 |
| 5–6 | 70 | 140 | 20 | 35 |
| 7–8 | 55 | 110 | 15 | 30 |
| 9–10 | 45 | 90 | 12 | 25 |

- Instrument `intonationBonusCents` adds to both cents columns (voice +10).
- Pitch verdict: nearest semitone of `playedMidi` ≠ expected → `wrong-pitch` (or `octave`); otherwise `|cents| ≤ inTune` → `in-tune`, else `sharp` or `flat`. Cents are measured against equal temperament at A4. The lead musician may revise numbers; the table is data in `follow/tolerances.ts`.
- Duration (graded only for notes ≥ 1 beat, or followed by a rest, and not staccato): `heldRatio < 0.6` → `short`; held more than `tolOnTime + 150 ms` into a following rest → `long`. Staccato notes are `short`-exempt and only `long` if `heldRatio > 1.0`.

### 6.4 Special cases

- Ties: merged into one `ExpectedNote` (one onset). A re-articulation inside a tie is an `extra`.
- Repeated notes (`repeatOfPrev`): need a detected re-articulation (energy or flux split). If the player holds through, the second note is `missed` and the tips engine gets an "articulate repeated notes" signal.
- Rests: silence expected; sound only becomes an extra after 100 ms, so normal release tails are not punished.
- Fast passages (`inFastRun`, IOI under 120 ms): tolerance becomes `max(tolOnTime, 0.4 × IOI)`, `changeFrames` drops to 2 for pitch-change onsets, and the pitch window shrinks to `[onset + 15 ms, onset + 0.7 × IOI]`. Detection limits that the difficulty system must respect: minimum reliably resolvable IOI is about 70 ms for pitch changes and 90 ms for same-pitch repeats. The corpus selector caps tempo so the shortest note at that level is not below these (for example 16ths at 150 bpm are 100 ms, allowed; at 200 bpm they are 75 ms, only allowed for slurred stepwise runs at level 9 and up).
- Pickups: count-in includes the beats before the pickup; pickup notes have negative `onsetSec`.
- Player starts late or skips a bar: handled naturally; notes whose windows pass are missed, and later notes still match by time.
- Grace notes, trills, fermatas: not present in v1 excerpts.

### 6.5 Final realignment (graded result)

At session end, run `finalAlign` on all expected and detected notes. Monotonic alignment by dynamic programming over `(i expected, j detected)` with moves: match (cost from 6.2 step 3 with final pitch, without `K`), skip expected (cost 6, "missed"), skip detected (cost 4, "extra"). Band constraint: only consider pairs within `W(e)`. Complexity is O(N × band), trivially fast for 100 to 200 notes. The final judgments are authoritative for grading and storage. When they differ from live judgments (expected under 3% of notes on the test suite), the results screen animates the correction. The live judgments are kept only in debug mode.

### 6.6 Follower output event stream

```ts
export type FollowerEvent =
  | { type: 'clock'; scoreBeat: Beats }                               // ≤ 60 Hz, playhead hint from the audio side
  | { type: 'live-pitch'; concertMidi: number | null; cents: number; clarity: number; levelDb: number } // ≤ 30 Hz, tuner/meter
  | { type: 'note-start'; detectedId: number; scoreBeat: Beats; concertMidi: number; matchedExpected: number | null }
  | { type: 'note-update'; detectedId: number; concertMidi: number; cents: number; durationBeats: number }
  | { type: 'note-end'; detectedId: number; durationBeats: number }
  | { type: 'judgment'; judgment: NoteJudgment }                       // may be sent up to 3 times per note: timing, pitch, duration
  | { type: 'extra'; extra: ExtraNote }
  | { type: 'missed'; expectedIdx: number }
  | { type: 'end'; reason: 'complete' | 'stopped' | 'silence' }
  | { type: 'final'; judgments: NoteJudgment[]; extras: ExtraNote[] };
```

Renderer mapping (the designer owns the look; this is the binding behaviour):

| Event | Renderer action |
| --- | --- |
| `note-start` matched, on time, pitch unknown | `setNoteState(idx, 'active')` |
| `judgment` timing early or late | `setNoteState(idx, 'timing-error')` (red); `showGhost` at the played beat with kind `early`/`late` |
| `judgment` pitch sharp, flat, wrong, octave | `setNoteState(idx, 'pitch-error' or 'both-error')` (red); `showGhost` at the played pitch and beat |
| `judgment` all ok | `setNoteState(idx, 'correct')` |
| `note-update` | extend the ghost's duration bar; update its cents |
| `extra` | `showGhost` kind `extra` |
| `missed` | `setNoteState(idx, 'missed')` (red, distinct treatment) |

---

## 7. Grading, points, rank (interfaces and defaults)

Owned with the lead musician and designer; these defaults let `grade/` be built and tested now.

- Per note credit: pitch 1.0 in-tune, 0.5 within the partial band, 0 wrong or missed, octave 0.5 (1.0 for voice with octave equivalence). Timing 1.0 on-time, linear down to 0 at the partial limit, 0 missed. Duration 1.0 ok, 0.5 short or long.
- Attempt total = `100 × (0.5 × mean pitch credit + 0.35 × mean timing credit + 0.15 × mean duration credit) − 2 × extras` (extras penalty capped at 15), floored at 0.
- Points = `round(total × levelMultiplier[level] × (aborted ? 0.5 : 1))`, `levelMultiplier = 1 + 0.25 × (level − 1)`. Only the best of repeated attempts on the same excerpt in one day counts fully; others earn 25%.
- Rating: Elo-like update per attempt with the excerpt's level as the opponent rating (`1000 + 100 × (level − 1)`), expected score from the logistic curve, K = 24. Level suggestion moves up after 3 passing attempts above 85 and down after 3 below 50.
- Rank: from cumulative points via a threshold table in `grading.config.ts`.

---

## 8. Tips engine

```ts
export interface Tip {
  id: string;
  instruments: string[] | ['*']; families?: Instrument['family'][];
  levels: [number, number];
  triggers: { signal: TipSignal; minRate: number }[];  // any satisfied
  text: string;                                         // ≤ 280 chars, plain text
  exercise?: { description: string; bpm?: number };
}
export type TipSignal = 'early' | 'late' | 'rushing-trend' | 'dragging-trend' | 'sharp' | 'flat' | 'wrong'
  | 'octave' | 'missed' | 'extra' | 'short' | 'long' | 'repeated-note-merge' | 'fast-run-errors' | 'rest-noise' | 'general';
```

Signals are computed from the last attempt (rates per note) and the profile EWMAs. Pick the signal with the highest `rate / baseline` (baseline per level, from config), choose a matching tip not in `lastTipIds`, most specific instrument match first, then family, then `*`. Always return one tip; fall back to `general`. Content lives in `src/tips/catalog.json`, authored by the lead musician; target at least 8 tips per family per major signal at launch.

---

## 9. Persistence

- IndexedDB database `srt`, version 1, via `idb`. Object stores: `profiles` (key `id`), `attempts` (key `id`, indexes `byProfileTime [profileId, createdAt]`, `byExcerpt excerptId`), `calibrations` (key `deviceKey`), `kv` (settings, flags).
- Migrations: one function per version bump in `store/migrations.ts`, with a test that opens a v(n−1) fixture and upgrades it.
- Audio is never stored or uploaded. An attempt stores detected notes (about 5 KB per attempt); 10,000 attempts is about 50 MB, within quota. Prune `debug` payloads older than 7 days.
- `navigator.storage.persist()` is requested after the first completed attempt.
- Backup: export and import of all stores as one JSON file.
- Multiple local profiles are supported (shared family laptop).

Where a backend becomes necessary (not in v1): cross-device sync, global or class leaderboards, teacher accounts and assignments, a corpus too large to ship statically (above about 50 MB), and crash or quality telemetry. The repository interfaces in 3.2 are the seam; a v2 sync service (for example a hosted Postgres with auth) implements the same interfaces plus a sync queue. Nothing else changes.

---

## 10. Performance budgets

| Metric | Budget | Measured how |
| --- | --- | --- |
| Capture worklet `process()` | ≤ 0.3 ms per 128-frame quantum on a 2020 MacBook Air; zero allocations after warm-up | Chrome performance panel; unit benchmark of the pure decimator |
| DSP worker per 8 ms hop (pitch + flux + segmenter + follower) | ≤ 1.5 ms on a 2020 laptop, ≤ 3 ms on iPhone 12 / Pixel 6 | Vitest benchmark plus in-app `performance.now()` telemetry in dev |
| Sound-in to `note-on` (excluding RTL) | p95 ≤ 60 ms (≤ 90 ms for 2048 windows) | Synthetic suite timestamps |
| `note-on` to ghost visible | ≤ 32 ms (two frames) | Playwright trace |
| Main thread per animation frame during performance | ≤ 6 ms; no React renders triggered by FollowerEvents except a throttled status line (≤ 4 Hz) | Performance panel |
| Score render (VexFlow, 12 bars) | ≤ 120 ms on laptop, ≤ 300 ms on phone | Vitest + jsdom-free Playwright timing |
| JS bundle | ≤ 450 KB gzip total initial (VexFlow included); app code alone ≤ 200 KB | `vite build` report gate in CI |
| First exercise ready on cold load over fast 4G | ≤ 2.5 s | Lighthouse in CI |
| Memory during performance | ≤ 150 MB | Performance panel |
| Onset timing accuracy | ±10 ms synthetic, ±20 ms real (p90) | Accuracy suite |
| Pitch accuracy on matched notes | ±5 cents synthetic, ±10 cents real (p90) | Accuracy suite |

---

## 11. Testing strategy

### 11.1 Unit (Vitest, Node)

- `theory`: spelling round-trips, transposition of every key by every instrument interval, enharmonic re-spelling, no more than 6 accidentals.
- `corpus`: selection determinism with a fixed seed, range fit, relaxation order, tie merging, IOI computation, pickup handling.
- `dsp`: carry over ear-to-staff `test/run.mjs` pitch cases (82 Hz to 1046 Hz with harmonics and noise, within 5 cents, clarity > 0.85; noise clarity < 0.6) and segmenter cases; add decimator frequency response, flux onset on synthetic attacks, octave hysteresis.
- `follow`: table-driven tests on hand-written `DetectedNote` streams, no audio: on-time, early 150 ms, late 150 ms, sharp 30 c, wrong pitch, octave, missed, extra in rest, repeated-note merge, tie, pickup, fast run, player stops at bar 5, live vs final divergence.
- `grade`, `tips`, `store` (with `fake-indexeddb`).

### 11.2 Synthetic-audio pipeline tests (the core quality gate)

`testkit/synth.ts` renders a performance to a Float32Array from an `ExpectedNote[]` plus perturbations:

```ts
export interface Perturbation { idx: number; dtMs?: number; cents?: number; semis?: number; drop?: true; holdRatio?: number }
export interface SynthOptions {
  timbre: 'flute' | 'clarinet' | 'sax' | 'trumpet' | 'violin' | 'cello' | 'voice' | 'piano' | 'tuba';
  sampleRate: 48000 | 44100; noiseDb: number; reverbRt60: number; vibrato?: { rateHz: number; cents: number };
  clickBleed?: { rtlMs: number; levelDb: number };  // injects the real click buffer through a laptop-speaker EQ
  extras?: { atSec: number; midi: number; durSec: number }[];
  legatoGlideMs?: number; tonguingDipDb?: number;
}
export function renderPerformance(expected: ExpectedNote[], bpm: number, p: Perturbation[], o: SynthOptions): Float32Array;
export function runScenario(s: Scenario): { events: FollowerEvent[]; final: NoteJudgment[]; score: AttemptScore };
```

Timbres: additive partial recipes (clarinet odd-heavy, sax and trumpet bright with formant shaping, violin sawtooth-like with bow noise and 5.5 Hz vibrato, voice as a pulse train through 3 formant filters with vibrato, piano with inharmonic decaying partials, tuba with strong 2nd harmonic to provoke octave errors).

Scenarios are JSON in `test/scenarios/` (`{ excerptId, instrumentId, bpm, perturbations, synth, expect: { judgments: [{ idx, timing?, pitch?, status? }], scoreRange } }`). A generator produces 300 randomized scenarios from the corpus with a fixed seed. The same `runOffline` pipeline code runs in the worker and in Node, so these tests exercise production code end-to-end minus the browser audio APIs.

CI gates on the generated suite, with click bleed on at −20 dB relative to the instrument:
- Onset F1 ≥ 0.97 at ±30 ms.
- Pitch-class accuracy ≥ 0.99 on matched notes; octave error rate ≤ 0.5%.
- Judgment agreement with ground truth ≥ 0.95 (timing and pitch verdicts); false `missed` ≤ 1%; false `extra` ≤ 1 per attempt on average; zero click-induced extras.
- Live vs final judgment divergence ≤ 3%.

### 11.3 Real-recording regression set

`test/recordings/`: at least 30 short takes (6+ instruments, laptop and phone mics, with and without speaker click) recorded by the team, CC0, with hand-labelled ground truth JSON. Gate: judgment agreement ≥ 0.90. Stored with Git LFS.

### 11.4 Browser E2E (Playwright)

- Chromium launched with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<wav>%noloop`. Because the fake device starts playing when `getUserMedia` resolves, the app supports a `?testClock=1` URL flag that sets `t0` to the first captured frame plus a fixed 2.0 s and skips calibration with `RTL = 0`; test WAVs are rendered by `testkit` with that offset. Assert DOM note states (`data-state` attributes on note groups) and the results screen score range.
- Flows: first-run onboarding and calibration (with a loopback WAV), settings with random values, perform and get results, retry, profile and rank updates persisted across reload, offline reload via service worker.
- Visual regression: screenshots of rendered excerpts at three widths for 20 fixed excerpts and of overlay states.
- WebKit and Firefox run the non-audio flows only (fake capture flags are Chromium-only).

### 11.5 Corpus validation (runs on every corpus build)

Every excerpt: schema-valid; measures sum to meter length; renders in VexFlow without exceptions (headless Playwright page); transposes to at least 3 instruments within range; features recomputed in TS match the pipeline within tolerance.

### 11.6 Developer replay tool

A dev-only route `/dev/replay` loads a WAV plus attempt settings, runs the pipeline in the browser, and shows the score, overlay, pitch trace (ported from ear-to-staff's trace view), and event log. In-app "Report a grading problem" exports the attempt plus the last attempt's frames (not audio) for debugging.

---

## 12. Reuse from ear-to-staff

| ear-to-staff module | Verdict | Notes |
| --- | --- | --- |
| `js/pitch.js` (MPM) | Adapt | Port to TS; FFT-based NSDF; lag range from instrument; expose alternate-octave clarity. Keep its tests. |
| `js/segmenter.js` | Adapt | Keep the state machine; rescale for 8 ms hops; add spectral flux, onset backtracking, click-window gating, per-profile params. |
| `js/fft.js` | Reuse | Port to TS as is. |
| `js/whistle.js` | Defer | Whistle is not a v1 instrument. Its harmonic-sibling test is a candidate for v2 octave checking. |
| `js/analysis.js` | Adapt the pattern | Separation of frame detection from segmentation becomes `runOffline` for tests and replay. |
| `js/theory.js` | Adapt | Keep `KEYS`, `transposeKey` idea, instrument interval data (alto +9, tenor +14, bari +21, B♭ +2, F horn +7). Replace MIDI-plus-preference spelling with `SpelledPitch` and interval transposition. Krumhansl key detection is not needed. |
| `js/notation.js` | Replace, keep as reference | Quantization is unnecessary (the score is given). Its VexFlow code is a working reference for ties across system breaks, beaming groups by meter, `Accidental.applyAccidentals`, and dotted notes. Note it loads VexFlow 4.2.3 from a CDN as a global; we import VexFlow 5 as an ES module. |
| `js/musicxml.js` | Not used at runtime | Import happens offline in Python. An optional "export my attempt as MusicXML" can reuse it later. |
| `js/app.js` metronome | Adapt the pattern | Keep the lookahead scheduler. Replace the square-wave click (in-band) and the `setInterval` AnalyserNode polling (16 ms jitter, no sample timestamps, no latency compensation, count-in handled by gating rather than by a shared clock). |
| `js/history.js`, GitHub Contents API | Not used | Local IndexedDB instead; no tokens in the browser. |
| `test/*.mjs` | Adapt | Move to Vitest; the synthetic-record end-to-end test is the model for 11.2. |

---

## 13. Work breakdown

Each package has an owner directory, inputs (what it depends on), and acceptance criteria. "Size" suggests the model tier for the overseer's swarm: L = Opus (algorithmic, cross-cutting), M = Sonnet, S = Haiku (well-specified, mostly data or UI). Packages in the same wave can run in parallel.

### Wave 0 (blocks everything; one implementer, L)

**P0 Foundation.** Scaffold Vite + React + TS, ESLint boundaries config from 3.1, `tsconfig.core.json`, Vitest, Playwright, CI workflow, Pages deploy, `src/core/types.ts` with every type in this document, `core/time.ts`, `core/rng.ts` (mulberry32), `core/events.ts`.
Accept: `pnpm lint typecheck test build` pass on an empty app; an import from `app/` into `dsp/` fails lint; types compile; Pages URL serves a placeholder.

### Wave 1 (parallel, all depend only on P0)

- **P1 theory** (M). Accept: unit tests in 11.1 pass; 100% of keys × instruments transpose without exceeding 6 accidentals after re-spelling.
- **P2 instruments data** (S, with lead musician's ranges). Accept: table typed; every instrument has detection params; snapshot test.
- **P3 testkit synth** (L). `renderPerformance`, timbres, click bleed, reverb, scenario JSON loader. Accept: rendered notes measured by a reference offline analyzer land within 1 ms and 1 cent of intent; deterministic output with seed.
- **P4 dsp core** (L). Port MPM and FFT, decimator, flux, segmenter, `DspPipeline`, `runOffline`. Accept: carried-over pitch tests; onset F1 ≥ 0.97 on P3 output without click bleed; per-hop benchmark within budget.
- **P5 corpus build pipeline** (M, with score researcher). Python music21 tool that ingests sources, cuts phrase excerpts, rejects unsupported features, computes features and level, writes shards and manifest, validates schema. Accept: 200 excerpts produced from at least 2 sources; corpus validation (11.5) passes.
- **P6 store** (M). Repos, migrations, export and import. Accept: tests with `fake-indexeddb`; upgrade test.
- **P7 notation static render** (M). VexFlow render of a `PreparedExcerpt`, layout model, `beatToPoint`, `staffY`, note group ids. Accept: 20 fixture excerpts render with no VexFlow errors in all 4 clefs; `beatToPoint` is monotonic and hits each note's x within 1 px; visual snapshots approved by the designer.
- **P8 UI shell and design system** (M for shell, S for components). Routes, layout, settings form with random options, design tokens from the designer. Accept: screens render with fake data; keyboard accessible; Lighthouse accessibility ≥ 95.

### Wave 2

- **P9 corpus runtime** (M; needs P1, P2, P5 sample output). Manifest and shard loader, `selectExcerpt`, `prepareExcerpt`, `buildExpectedNotes`. Accept: 11.1 corpus tests; 1,000 random settings with fixed seeds always return an excerpt or a documented relaxation.
- **P10 follower** (L; needs P1, P3 for fixtures, P4 types). `LiveFollower`, `finalAlign`, tolerances. Accept: table-driven tests in 11.1; with P4, the synthetic gates in 11.2.
- **P11 audio IO** (L; needs P4). AudioContext lifecycle, mic with constraints, capture worklet, worklet-to-worker MessagePort, metronome with pre-rendered clicks, transport `t0`. Accept: in Chromium E2E the worker receives contiguous blocks with no gaps over 5 minutes; click scheduling jitter under 1 ms; no allocations in `process()`.
- **P12 grade** (M; needs P0 types). Accept: unit tests on fixed judgment sets; config-driven weights.
- **P13 tips engine** (M) and **P13b tip catalog content** (S, from lead musician's material). Accept: deterministic selection with seed; never repeats within `lastTipIds`; every family has a fallback.

### Wave 3

- **P14 calibration** (L; needs P11, P4). Loopback and play-along flows plus UI hooks. Accept: on a synthetic loopback WAV with known 37 ms RTL, measures 37 ± 2 ms; play-along on synthetic notes within ± 5 ms of ground truth.
- **P15 notation overlay** (M; needs P7). `setNoteState`, ghosts, duration bars, playhead, driven by FollowerEvents through rAF. Accept: 60 fps with 200 overlay updates per second in a stress page; visual states match the designer's spec.
- **P16 PracticeSession** (L; needs P9 to P15). State machine wiring, worker hosting of follower, result persistence, profile update. Accept: full flow with fakes in Node; E2E perform-and-results test passes.
- **P17 screens** (M/S; needs P8, P16). Setup, calibration wizard, practice, results with tips, profile and rank history. Accept: designer review; E2E flows in 11.4.

### Wave 4

- **P18 accuracy and performance hardening** (L). Real-recording set, threshold tuning, budget verification on real phones. Accept: all gates in 10 and 11 met.
- **P19 PWA and release** (S). Service worker, offline corpus caching, versioning, about and licences page listing every excerpt source and attribution. Accept: offline reload works; every excerpt's attribution reachable from the UI.

Critical path: P0 → P4 → P11 → P14 → P16 → P18. P3 and P10 should start on day one of wave 1 and 2 respectively because they carry the most risk.

---

## Open questions

1. Key setting semantics: this section assumes "key" means the written key the player reads. Confirm with the lead musician and designer.
2. Grading weights, tolerance numbers, level-to-tempo caps, and rank thresholds are defaults here; the lead musician should confirm or replace them before P12 and P10 are tuned.
3. Should the timing grade measure against the metronome (current design) or against the player's own steady pulse when they are consistently offset? Current design reports bias separately and suggests recalibration; a "tempo-relative" mode is possible later.
4. Voice: default octave equivalence on. Should singers instead pick a voice type and be held to its octave?
5. Is a stored short audio clip of the last attempt (in memory only, for "listen back") wanted? It is cheap to add and stays on-device.
6. Corpus size target and whether any openly licensed (CC-BY-SA) sources impose share-alike obligations on the app's corpus files; the score researcher must confirm license compatibility for redistribution in a static bundle.
7. Do we want swing or compound "feel" options (jazz etudes) in v1? Current design excludes swing.
8. iOS fork approach: wrap the web app (WKWebView/Capacitor) reusing the DOM-free core, or native Swift with a port of `dsp/` and `follow/`. Haptic metronome on iOS removes bleed entirely and is a strong reason to go native for audio.

## Dependencies on other roles

- Lead musician: instrument ranges per level band and comfortable ranges; clef choices; tolerance table sign-off; difficulty-level definition and the mapping from `DifficultyFeatures` to level; key sets per level; tempo caps per level; grading weights and pass thresholds; tip catalog content keyed to the `TipSignal` list; whether voice uses octave equivalence.
- Music score researcher: source corpora and licences; the excerpt cutting rules (phrase boundaries, 8 to 12 bars); conforming to `ExcerptDoc` schema version 1 and the exclusion list in 4.1; attribution text per excerpt; ownership of `tools/corpus-build` with an implementer; at least 200 validated excerpts before wave 2 starts.
- Senior designer: visual treatment for each `NoteVisualState` and `GhostNote.kind` (including how to show sharp or flat when the ghost sits on the same staff position as the original); bars per system and responsive layout for laptop and phone landscape; calibration and setup flows; results, rank, and tips screens; design tokens for P8. The binding behaviour is the event-to-renderer table in 6.6.
- Senior iOS engineer: choose wrap versus native; if native, conform to the same data model (section 4), event stream (6.6), and synthetic scenario suite (11.2) so both platforms grade identically; own iOS audio session routing and a haptic metronome.
- Overseer: confirm the stack decisions, the wave plan, and the model-tier sizing; reconcile any conflicts between this section's defaults and the lead musician's numbers.
