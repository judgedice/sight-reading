/**
 * Core data types for the sight-reading trainer.
 *
 * Owner: 01 (architect) maintains this file; field ownership per 01 §0 (03 owns the excerpt
 * fields, 02 owns the config values and the score shape, 05 owns `AudioEnv`).
 * Frozen in P0b (01 §14 item 1). After freeze, a change needs an RFC in `docs/rfc/`.
 *
 * Rules for this file:
 * - Pure data and type declarations only (one constant, `TPQ`). No DOM, no Web Audio types:
 *   it compiles under `tsconfig.core.json` (`lib: ["ES2022"]`).
 * - Every JSON document type here has a generated schema in `schemas/` (tools/generate-schemas.ts).
 *   A test fails if the committed schemas drift from these types.
 * - Units are stated on every numeric field: ms, s (seconds), cents, ticks (TPQ = 480 per quarter),
 *   beats (metronome beats, 02 conventions), MIDI (C4 = 60, may be fractional where stated).
 * - Platform seam primitives (`ClockSeconds`, `OutputMode`, ...) are declared here so that this file
 *   imports nothing; `platform.ts` re-exports them (01 §5.2) and adds the service interfaces.
 */

// =====================================================================================
// 01 §5.1 Time and units
// =====================================================================================

/** Ticks per quarter note. Every `Ticks` value in the app and the corpus uses this resolution (01 §5.1). */
export const TPQ = 480;

/** Integer ticks from the excerpt start (bar 0 beat 1 if there is a pickup), at TPQ = 480 (01 §5.1). */
export type Ticks = number;

/** Float, in metronome beats (02 conventions: quarter in x/4, half in 2/2, dotted quarter in 6/8) (01 §5.1). */
export type Beats = number;

/** Seconds from bar 1 beat 1; negative in the pickup and the count-in (01 §5.1). */
export type ScoreSeconds = number;

/**
 * Seconds on the audio backend's clock (the AudioContext clock on web). Opaque and branded so that
 * score time and clock time cannot be mixed by accident. Serialised as a plain number (01 §5.2, §7.1).
 */
export type ClockSeconds = number & { readonly __brand: 'ClockSeconds' };

// =====================================================================================
// 01 §5.2 Platform seam primitives (re-exported by platform.ts)
// =====================================================================================

/** Output route declared by the player; the web cannot detect it reliably (01 §1, §7.8). */
export type OutputMode = 'speakers' | 'wired' | 'bluetooth';

/** Metronome click sound: Tick 5.5–9 kHz noise burst (speaker default) or Wood 1.5–4 kHz (01 §7.6). */
export type ClickTimbre = 'tick' | 'wood' | MetronomeSound;

/** The metronome sounds a player can choose (06 §9). `tick` and `wood` are the legacy stored names of classic and woodblock. */
export type MetronomeSound = 'classic' | 'woodblock' | 'beep';

/** The Match a note needle's steadiness preset (round 3, 03-pitch-steadiness §3.2, §4). Display only. */
export type PitchSteadiness = 'steady' | 'balanced' | 'quick';

/** Metronome mode. `'visual'` is later (01 §7.6, 02 §5.2). */
export type MetronomeMode = 'audible' | 'countInOnly';

/** Runtime platform: the web app, or a native shell (01 §5.2, 05 §5.2; PLAN R85: 'desktop', 'ios' and 'android' are native). */
export type PlatformKind = 'web' | 'ios' | 'desktop' | 'android';

/** OS family, for labels, copy and diagnostics only; never a grading branch (05 §5.1). */
export type OsFamily = 'ios' | 'ipados' | 'macos' | 'android' | 'windows' | 'linux' | 'other';

/** Whether the app runs in a browser tab or as an installed home-screen app (05 §5.1, W13). */
export type DisplayMode = 'browser' | 'standalone';

/** Input processing flags as read back from `track.getSettings()`; null when not reported (05 W5). */
export interface AppliedProcessing {
  echoCancellation: boolean | null;
  noiseSuppression: boolean | null;
  autoGainControl: boolean | null;
}

/** Audio route identity and properties after unlock (01 §5.2, 05 W5, W7). */
export interface AudioRouteInfo {
  /** hash(inputLabel | outputMode | sampleRate | uaFamily); calibrations are stored per key (01 §7.8). */
  routeKey: string;
  /**
   * Every key a calibration for this route may have been stored under, `routeKey` first (round 2: keys made before
   * the input label was normalised). Absent where the backend has no older keys.
   */
  routeKeyAliases?: string[];
  inputKind: 'built-in' | 'wired' | 'bluetooth' | 'usb-interface' | 'unknown';
  /** Declared by the player. */
  outputMode: OutputMode;
  /** Context sample rate, Hz. */
  sampleRate: number;
  appliedProcessing: AppliedProcessing;
  /** baseLatency + outputLatency as reported by the browser, seconds; absent where not reported (iOS Safari). */
  reportedLatencySec?: number;
  /** Microphone track rate from `getSettings()`, Hz; null when not reported (diagnostics, hands-free signature). */
  trackSampleRate?: number | null;
}

// =====================================================================================
// 01 §5.3 theory
// =====================================================================================

export type Step = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';

/** Chromatic alteration in semitones. Triple accidentals do not exist (03 §7.5). */
export type Alter = -2 | -1 | 0 | 1 | 2;

/** A spelled pitch. C4 = MIDI 60 (01 §5.3). */
export interface SpelledPitch {
  step: Step;
  alter: Alter;
  /** Scientific octave number (C4 = middle C). */
  octave: number;
}

/** A spelled interval (01 §5.3, 03 §7.4). */
export interface Interval {
  /** Letter steps, signed (a rising third is +2; an octave is +7). */
  diatonic: number;
  /** Semitones, signed. */
  chromatic: number;
}

/** A key signature (01 §5.3). */
export interface KeySig {
  /** Sharps positive, flats negative, −7..7. */
  fifths: number;
  mode: 'major' | 'minor';
}

/** Mode of an excerpt. Church modes appear only when the key is random (R8, 02 §2.3). */
export type Mode = 'major' | 'minor' | 'dorian' | 'mixolydian' | 'phrygian' | 'lydian' | 'aeolian' | 'locrian';

// =====================================================================================
// 01 §5.4 instruments (config/instruments.json; 02 owns all but `detection`)
// =====================================================================================

/** Instrument family; sets tips and family rules (02 §1.1). */
export type Family =
  | 'voice'
  | 'flute'
  | 'double-reed'
  | 'clarinet'
  | 'sax'
  | 'high-brass'
  | 'low-brass'
  | 'upper-strings'
  | 'low-strings'
  | 'keyboard'
  | 'guitar';

/** Segmenter onset profile (01 §7.5). */
export type OnsetProfile = 'tongued-wind' | 'brass' | 'bowed' | 'plucked' | 'voice' | 'struck';

/** Onset class; sets the timing floors (02 §1.1, §4.2). */
export type OnsetClass = 'hard' | 'soft';

/** Vibrato class; sets cents floors and `intonationMinSteadyMs` (01 §8.4). */
export type VibratoClass = 'none' | 'vibrato';

export type Clef = 'treble' | 'bass' | 'alto' | 'tenor' | 'treble-8vb';

/** Range tier: A = L1–2, B = L3–4, C = L5–6, D = L7–8, E = L9–10 (02 §1.4). */
export type TierId = 'A' | 'B' | 'C' | 'D' | 'E';

/** MPM analysis window in samples at about 16 kHz (01 §7.3). */
export type WindowSamples = 512 | 1024 | 2048;

/** String form of `WindowSamples`, used as a JSON object key for per-window-class values (R18). */
export type WindowClassKey = '512' | '1024' | '2048';

/** Synthetic timbres the testkit renders (02 §1.1, R21). */
export type TestkitTimbre = 'flute' | 'clarinet' | 'sax' | 'trumpet' | 'violin' | 'cello' | 'voice' | 'piano' | 'tuba';

/** Detection parameters per instrument. 01 owns these values (01 §7.3). */
export interface DetectionParams {
  /** Lowest sounding fundamental to search, Hz (sounding range widened by 3 semitones). */
  minHz: number;
  /** Highest sounding fundamental to search, Hz. */
  maxHz: number;
  windowSamples: WindowSamples;
  onsetProfile: OnsetProfile;
  vibratoClass: VibratoClass;
  /** NSDF clarity threshold, 0..1 (0.85 default; 0.80 voice, low brass, piano). */
  clarityThreshold: number;
  /** Pitch change that splits a note, cents (voice 80, winds/brass/strings 60, fixed pitch 40). */
  changeCents: number;
}

/** One entry of `config/instruments.json` (01 §5.4, 02 §1). */
export interface Instrument {
  /** Stable id, for example `trumpet-bb`, `voice-tenor` (02 §1.1). */
  id: string;
  /** English display label; 04 may override through copy. */
  label: string;
  family: Family;
  /** `beta` instruments are hidden behind a setting and get universal tips only (02 §1.2). */
  status: 'launch' | 'beta';
  /** Written pitch minus concert pitch, semitones (ear-to-staff convention, 02 §1.3). */
  semis: number;
  /** Spelled form of `semis` (for example B♭ clarinet {diatonic: 1, chromatic: 2}) (03 §7.3). */
  writtenMinusSounding: Interval;
  /** Clefs and the level from which each is allowed; the first entry is the primary clef (02 §1.3). */
  clefs: { clef: Clef; fromLevel: number }[];
  /** Outer written MIDI bounds ever served, inclusive (02 §1.3). */
  fullWrittenRange: [number, number];
  /** Written MIDI band per tier, inclusive (02 §1.4). */
  tiers: Record<TierId, [number, number]>;
  /** `fixed` = piano and guitar: no intonation, no duration credit (02 §4.5). */
  pitchKind: 'continuous' | 'fixed';
  /** Voice: graded on relative pitch, octave-equivalent (R7, 02 §4.5). */
  relativePitch: boolean;
  /** Timing-floor class (02 §1.1). */
  onsetClass: OnsetClass;
  /** Testkit timbre used by the synthetic gates, or null when none exists (02 §1.1, §1.2). */
  testkitTimbre: TestkitTimbre | null;
  /**
   * True when the lowest served fundamental is under 80 Hz: the intonation weight moves to pitch
   * (02 §1.2, §4.4). A test asserts it agrees with the served range.
   */
  lowFundamental: boolean;
  /** 01 owns this block (01 §7.3). */
  detection: DetectionParams;
}

/** `data/trumpet-valves.json`: written pitch to valve combination and partial, written F♯3 to C6 (02 §4.5, §10). */
export interface TrumpetValveTable {
  _source: string;
  entries: {
    /** Written MIDI. */
    writtenMidi: number;
    /** Valve combination, for example "0", "2", "1", "12", "23", "13", "123". */
    valves: string;
    /** Harmonic partial number, 2 = second partial. */
    partial: number;
  }[];
}

// =====================================================================================
// Config files (01 §0, §14 item 5; values owned by 02 except measurement-budget.json, owned by 01)
// =====================================================================================

/**
 * Every block of a seeded config file names the spec section it transcribes,
 * for example `"02 §4.2"` (01 §14 item 5).
 */
export interface Sourced {
  _source: string;
}

/** Inclusive level range, for example [1, 3] for L1–L3. */
export type LevelRange = [number, number];

/** One timing threshold: `max(absMs, fracBeat × beatMs)` before the IOI cap and the floor (02 §4.2). */
export interface TimingTerm {
  /** Milliseconds. */
  absMs: number;
  /** Fraction of a metronome beat. */
  fracBeat: number;
}

export interface TimingLevelBand {
  levels: LevelRange;
  good: TimingTerm;
  red: TimingTerm;
  bad: TimingTerm;
}

/** Good / red / bad triple in milliseconds. */
export interface GoodRedBadMs {
  goodMs: number;
  redMs: number;
  badMs: number;
}

/** Good / red / bad triple as fractions (IOI caps, 02 §4.2). */
export interface GoodRedBadFrac {
  good: number;
  red: number;
  bad: number;
}

/** Intonation band; null cents = intonation not graded (keyboard, guitar) (02 §4.2). */
export interface IntonationBand {
  /** `voice` (relative pitch), `continuous` (winds, brass, strings), `fixed` (keyboard, guitar). */
  group: 'voice' | 'continuous' | 'fixed';
  levels: LevelRange;
  goodCents: number | null;
  redCents: number | null;
}

/** Component weights for a family group and level range; P + I + R = 1 (02 §4.4). */
export interface ComponentWeightRow {
  group: 'continuous' | 'fixed';
  levels: LevelRange;
  P: number;
  I: number;
  R: number;
}

export type LetterGrade = 'S' | 'A' | 'B' | 'C' | 'D' | 'F';

/** One row of the grade table (02 §4.7). */
export interface GradeRow {
  grade: LetterGrade;
  /** Lowest score (0..100) that earns this grade. */
  minScore: number;
  stars: 0 | 1 | 2 | 3;
  shine: boolean;
}

/** `config/grading-config.json` (02 §4, §10; R14 to R23 applied). */
export interface GradingConfig {
  /** Optional pointer to the schema for editors. */
  $schema?: string;
  /** Stored on every graded attempt, for example "grading-2.0.0" (02 conventions). */
  configVersion: string;
  /** Timing tolerances (02 §4.2; floors R23). */
  timing: Sourced & {
    levelBands: TimingLevelBand[];
    /** IOI caps as fractions of the note's smaller neighbouring IOI: good 0.3, red 0.4, bad 0.5. */
    ioiCap: GoodRedBadFrac;
    /** Family floors by onset class: hard 40/60/90 ms, soft 55/85/120 ms (R23). The floor always wins. */
    onsetClassFloors: Record<OnsetClass, GoodRedBadMs>;
  };
  /** `W_i = max(tBad_i, min(max(minMs, minBeats × beat), ioiFrac × min(IOI_prev, IOI_next)))` (02 §4.1). */
  matchWindow: Sourced & {
    /** Milliseconds (250). */
    minMs: number;
    /** Beats (0.5). */
    minBeats: number;
    /** Fraction of the smaller neighbouring IOI (0.5). */
    ioiFrac: number;
  };
  /** Intonation (02 §4.2; R18). */
  intonation: Sourced & {
    bands: IntonationBand[];
    /** Minimum steady pitch for an intonation grade, ms: none 150, vibrato 180 (R18, 01 §8.4). */
    minSteadyMs: Record<VibratoClass, number>;
    /** Vibrato families with steady pitch below `belowSteadyMs` (360 ms) widen to at least these bands (02 §4.2). */
    vibratoWiden: { belowSteadyMs: number; minGoodCents: number; minRedCents: number };
    /** |dev| above this many cents (50) means a different semitone: wrong pitch (02 §4.2). */
    wrongPitchAboveCents: number;
    /** Attack portion excluded from the steady median, ms, per family (01 §7.5, §8.3). */
    attackExcludeMsByFamily: Record<Family, number>;
  };
  /** Live provisional verdicts (02 §4.8; R19). */
  live: Sourced & {
    /** Steady pitch after the attack before a live sharp/flat, ms (80; raise to 150 if the synthetic gate fails, R19). */
    provisionalMs: number;
    /** Added to `redCents` for a live sharp/flat, cents (10). */
    hysteresisCents: number;
    /** Wrong pitch at confirmation needs the confirming frames at least this far from the target, cents (80) (01 §9.3). */
    wrongAtConfirmMinCents: number;
  };
  /** Detection tolerances beyond the 01 §7.5 defaults (round 2, docs/redesign/round2/03-detection.md). */
  detection: Sourced & {
    /** The app's own playback heard by the mic (`FollowConfig.ownPlayback`). */
    ownPlayback: {
      /** A sound's room tail: a note starting up to this long after the sound ends is still the sound, ms (200). */
      tailMs: number;
      /** A note at a click that sounds shorter than this is the click, ms (150). */
      clickMaxMs: number;
      /** A note within this many cents of a tone's pitch class is the tone (70). */
      toneCents: number;
    };
    /**
     * One sung note stays one note: per onset profile and level band (resolved by `rules/resolveOneNote`). A profile
     * with no band keeps the 01 §7.5 segmenter and the 02 §4.1 extras rule unchanged.
     */
    oneNote: OneNoteBand[];
  };
  /** Per-note credits (02 §4.3). */
  credit: Sourced & {
    duration: {
      /** Only notes of at least this many beats are duration-graded (1). */
      minBeats: number;
      /** h ≥ this earns d = 1 (0.70). */
      fullHeldRatio: number;
      /** h ≤ this earns d = 0, linear between (0.35). */
      zeroHeldRatio: number;
      /** Notes before a rest count as fully held from this ratio (0.55). */
      beforeRestFullRatio: number;
    };
    /** Extras enter P's denominator with this weight (0.5): P = 100 × Σp / (N + w × extras). */
    extrasWeight: number;
    /** Unmatched played events shorter than this are ignored, ms (100) (02 §4.1). */
    extraMinDurMs: number;
    /** A detected note sounding more than this far inside a written rest is an extra, ms (100) (01 §9.3). */
    restIntrusionMs: number;
  };
  /** Components and weights (02 §4.4). */
  components: Sourced & {
    weights: ComponentWeightRow[];
    /** Fewer intonation-graded notes than this: I is not judged and its weight moves to P (3). */
    intonationMinNotes: number;
    /** R = 100 × (onsetWeight × mean o + durationWeight × mean d) (0.8 / 0.2). */
    rhythm: { onsetWeight: number; durationWeight: number };
    /** Beta instruments with a lowest served fundamental under this, Hz (80), use I = 0. */
    lowFundamentalHz: number;
  };
  /** Grade table (02 §4.7). */
  grades: Sourced & {
    scale: GradeRow[];
    passGrade: LetterGrade;
    /**
     * PLAN ruling 43: an S needs no wrong-pitch and no missed note in the take. When true, a take that scores in the
     * S band with either is graded A (stars and shine from the A row; the score is unchanged).
     */
    sRequiresNoWrongOrMissed: boolean;
  };
  /** Gates (02 §4.7). */
  gates: Sourced & {
    /** Matched (excluding displaced) / N below this is incomplete (0.5). */
    incompleteBelowMatchedFrac: number;
    /** Incomplete score cap (50). */
    incompleteScoreCap: number;
    /** No voiced frames for this many seconds after bar 1 voids the take (5) (01 §7.9). */
    voidNoSignalSec: number;
    /** Clipping above this fraction of frames shows a results banner, never a void (0.2) (01 §7.9). */
    clippingBannerFrac: number;
  };
  /** Player-facing thresholds (round 2). */
  ui: Sourced & {
    /** How sure the grade reads: clear and mostly bands by agreement fraction and notes changed after the try. */
    sure: { clearAgree: number; clearMaxChanged: number; mostlyAgree: number; mostlyMaxChanged: number };
    /** Live feedback stays calm up to and including this many notes (3). */
    calmLiveUpTo: number;
  };
  /** Stops and the come-in hint (02 §4.6, 01 §9.3). */
  stops: Sourced & {
    /** A stop is a silence of at least max(minBeats beats, minMs) not covered by rests (1 beat, 600 ms). */
    minBeats: number;
    minMs: number;
    /** Show "come in at bar N" after this many bars of uncovered silence (1). */
    comeInAfterBars: number;
    /** The suggested downbeat is at least this many beats ahead (1). */
    comeInMinLeadBeats: number;
  };
  /** Credit for displaced (replayed or skipped-ahead) segments (01 §9.6, 02 §4.6). */
  displacement: Sourced & {
    /** Displaced notes are excluded from P's extras term (true). */
    excludeFromExtras: boolean;
    /** Each displaced segment counts once in `diagnostics.restarts` and fires E6 (true). */
    countsAsRestart: boolean;
  };
  /** Ranked rules (02 §5.2, 05 §4; R16, R17, R31). */
  ranked: Sourced & {
    /** Tempo must be at least this fraction of the level's minimum tempo (0.9). */
    minTempoFracOfLevelMin: number;
    /** Ranked RTL ceiling, ms (120; R17). */
    maxRtlMs: number;
    /** Stored loopback spread (MAD) ceiling, ms (3). */
    loopbackMaxMadMs: number;
    /** Stored play-along spread (MAD) ceiling, ms (15). */
    playAlongMaxMadMs: number;
    /** Count-in recheck agreement, ms (10). A measured shift keeps the take ranked and uses the fresh value (R31). */
    recheckAgreeMs: number;
    /** Familiarity below this value is rankable (2). */
    familiarityBelow: number;
  };
  /** Voice drift reference (02 §4.5). */
  voice: Sourced & {
    /** Offset = median dev of the last N correctly pitched notes (4). */
    driftWindowNotes: number;
    /** Offset limited to ±this many cents from 0 (50). */
    maxOffsetCents: number;
    /** Offset changes by at most this many cents per note (15). */
    maxStepCents: number;
  };
  /** Optional tuning note for winds, brass, strings (02 §4.5). */
  tuning: Sourced & {
    /** Capture length, seconds (3). */
    captureSec: number;
    /** Offset cap, cents (25). */
    maxOffsetCents: number;
  };
  /** End of take (R14): one beat after the last expected note's written end. */
  endOfTake: Sourced & {
    /** Beats after the last note's written end (1). */
    afterLastNoteEndBeats: number;
  };
}

/** One level of `config/levels.json` (02 §2.3, §2.4). */
export interface LevelDef extends Sourced {
  level: number;
  /** Meters allowed at this level, as "beats/beatType" strings, cumulative. */
  meters: string[];
  /** Rhythm cell ids allowed at this level, cumulative (02 §2.2). */
  rhythmCells: string[];
  /** Largest free interval, semitones; null = any in range. */
  maxIntervalSemis: number | null;
  /** Larger leaps allowed on chord tones (L1–L3), or null. */
  largerLeaps: { triad: 'tonic' | 'tonic-or-dominant'; maxSemis: number } | null;
  /** Leaps (a 4th or larger) per 4 bars; null = no limit. */
  maxLeapsPer4Bars: number | null;
  /** Span limit, semitones; null = the tier band. */
  maxSpanSemis: number | null;
  /** Tonal modes allowed (major, minor kinds). */
  modes: ('major' | 'minor')[];
  /** Minor forms allowed (natural, harmonic, melodic). */
  minorForms: ('natural' | 'harmonic' | 'melodic')[];
  /** Church modes allowed, served only when the key is random (R8). */
  modal: Mode[];
  /** Chromatic notes per 4 bars; null = no limit. */
  chromaticPer4Bars: number | null;
  /** Raised 6th and 7th in minor count as diatonic at this level (02 §2.3: from L5). */
  minorAlterationsDiatonic: boolean;
  doubleAccidentals: boolean;
  /** Written-key request constraint: maximum accidentals and allowed key modes (R1). */
  writtenKeys: { maxAccidentals: number; modes: ('major' | 'minor')[] };
  tier: TierId;
  /** Tempo range, bpm of the metronome beat. */
  tempo: { minBpm: number; maxBpm: number };
  /**
   * Peak notes per second in any one-beat window, per analysis window class (R18). Effective cap is
   * `min(this, 1000 / pitchChangeFloorMs)` (02 §2.4, 01 §8.3).
   */
  npsCap: Record<WindowClassKey, number>;
  /** Articulation and dynamic marks shown at this level, cumulative (02 §2.3). */
  articulations: string[];
  /** Allowed bar counts (02 §2.3 "Bars"). */
  bars: number[];
  /** Strict scan time, seconds; ranked uses exactly this (R6). */
  scanSec: number;
  /** Count-in length, bars. */
  countInBars: number;
  /** ≤ 60 characters (02 §2.3). */
  description: string;
}

/** `config/levels.json` (02 §2, §10). */
export interface LevelsConfig {
  $schema?: string;
  configVersion: string;
  levels: LevelDef[];
  /** Count-in bars at any tempo below `slowBelowBpm` (02 §2.3; PLAN R70 makes it 1 everywhere). */
  countIn: Sourced & { slowBelowBpm: number; slowBars: number };
  /** Compound meters at these levels count dotted beats in this bpm range with subdivision clicks (02 §2.4). */
  compound: Sourced & { dottedBeatLevels: LevelRange; dottedBpm: { minBpm: number; maxBpm: number }; subdivisionClicks: boolean };
  /** Breath rule for winds, brass and voice (02 §2.4). */
  breath: Sourced & { maxGapBarsUpToLevel4: number; maxGapSecFromLevel5: number };
  /** Selection policy (02 §2.6; R22). */
  selection: Sourced & {
    /** At most this share of served excerpts from L − 1 (0.2). */
    maxFracFromLevelBelow: number;
    /** Stretch excerpts (one feature at L + 1) rate (0.2). */
    stretchRate: number;
    /** Stretch rate when fewer than `lowPoolUnseen` unseen eligible excerpts remain (0.5 below 10). */
    stretchRateLowPool: number;
    lowPoolUnseen: number;
    randomKey: {
      /** Strings weight sharp written keys by this (1.5). */
      stringsSharpWeight: number;
      /** Concert B♭, E♭ and F instruments weight written keys with ≤ `lowAccMax` accidentals by this up to `lowAccMaxLevel`. */
      transposingLowAccWeight: number;
      lowAccMax: number;
      lowAccMaxLevel: number;
      /** Never the same written key more than this many times in a row (2). */
      maxSameKeyInRow: number;
    };
  };
}

/** `config/progression.json` (02 §5, §10). */
export interface ProgressionConfig {
  $schema?: string;
  configVersion: string;
  /** XP formula (02 §5.4). XP = round(base × q × m_tempo × m_random × m_mode × m_streak × m_daily × m_below). */
  xp: Sourced & {
    /** base(L) = basePerLevel × L + baseOffset (6, 4). */
    basePerLevel: number;
    baseOffset: number;
    /** q(S) = 0 below this score (30), else S / 100. */
    qMinScore: number;
    /** m_tempo = clamp(tempo / level mid tempo, min, max) (0.75, 1.30). */
    tempoClamp: [number, number];
    /** m_random = 1 + perRandom per random key, meter, tempo; cap (0.08, 1.25). */
    randomPerSetting: number;
    randomCap: number;
    /** m_mode for count-in only, from `countInOnlyFromLevel` (1.10 from L4). */
    countInOnlyMult: number;
    countInOnlyFromLevel: number;
    /** m_streak = 1 + perDay × min(days, maxDays) (0.02, 10). */
    streakPerDay: number;
    streakMaxDays: number;
    /** A streak day needs this many ranked attempts in a local day (3). */
    streakMinRankedPerDay: number;
    /** m_daily = 1 for the first `dailyFullCount` (60) attempts per local day, then `dailyAfterMult` (0.25). */
    dailyFullCount: number;
    dailyAfterMult: number;
    /** m_below = `belowMult` (0.25) when served level ≤ player level − `belowGap` (2). */
    belowGap: number;
    belowMult: number;
    /** Practice attempts earn this share (0.25). */
    practiceMult: number;
    /** Practice repeat of an excerpt: first repeat in a day, later repeats (0.25, 0). */
    repeatFirstMult: number;
    repeatLaterMult: number;
  };
  /** Rank table (02 §5.5). Rank never goes down. */
  ranks: Sourced & { table: { rank: number; name: string; xp: number; minLevel: number }[] };
  /** Level window rules per instrument (02 §5.6). */
  levelWindow: Sourced & {
    /** Last N ranked attempts at the current level (5). */
    size: number;
    offer: {
      /** At least `minCount` of the window scored ≥ `score` (4 of 5, 85). */
      minCount: number;
      score: number;
      /** Window mean ≥ this (85). */
      meanMin: number;
      /** At least this many at or above the level's mid tempo (2). */
      minAtMidTempo: number;
      /** Declining suppresses the offer for this many ranked attempts (5). */
      declineSuppressFor: number;
    };
    auto: {
      /** Consecutive ranked attempts ≥ `score` (8, 90). */
      consecutive: number;
      score: number;
      minAtMidTempo: number;
    };
    down: {
      /** Suggest a level down when mean < `meanBelow` (60) or ≥ `countBelow` (3) attempts below `countScore` (55). */
      meanBelow: number;
      countBelow: number;
      countScore: number;
    };
  };
  /** Placement (02 §5.1). */
  placement: Sourced & {
    excerpts: number;
    startLevel: number;
    /** Next excerpt L + upBy if score ≥ upIfAtLeast (2, 85); L − downBy if < downIfBelow (1, 60). */
    upIfAtLeast: number;
    upBy: number;
    downIfBelow: number;
    downBy: number;
    /** Final level = highest level with score ≥ this (75), minimum `minLevel` (1). */
    finalMinScore: number;
    minLevel: number;
  };
  /** Post-reveal skip limit: one per this many ranked attempts (5) (02 §5.3; R33). */
  skip: Sourced & { postRevealPerRanked: number };
}

/** Dimension of a tip pattern (02 §6.1). `none` is E30 (clean read). */
export type PatternDimension = 'notes' | 'in-tune' | 'rhythm' | 'flow' | 'none';

/** Component letters used by patterns for `lostPoints` (02 §6.1 item 2). */
export type ComponentId = 'P' | 'I' | 'R';

/** A pattern record in `config/tips.json` (02 §6.1, §6.2, annex L-C). */
export interface PatternDef extends Sourced {
  /** E1 .. E35. */
  id: string;
  /** ≤ 40 characters. */
  name: string;
  dimension: PatternDimension;
  enabled: boolean;
  /** Components the pattern concerns, for `lostPoints`. */
  components: ComponentId[];
  /** Overrides the default evidence template; placeholders in braces, for example "{bars}". */
  evidenceTemplate?: string;
  /** Named numeric thresholds of the detection rule (for example `slopeBeatsPerBar: 0.04`). */
  thresholds: Record<string, number>;
  /** Named minimum-evidence counts (for example `notes: 2`, `bars: 2`). */
  minEvidence: Record<string, number>;
  /** Restricts the pattern to these instrument ids (E16 trumpet, E31 clarinet, E23 voice); absent = all. */
  instruments?: string[];
}

/** A tip record in `config/tips.json` (02 §6.1, §6.3, §6.4). */
export interface TipDef extends Sourced {
  /** U01, HB01, ... */
  id: string;
  scope: 'universal' | 'family';
  /** Present when scope is family. */
  family?: Family;
  /** Restricts a family tip to these instruments. */
  instruments?: string[];
  /** Pattern ids that trigger the tip (U20: E28 and E29). */
  patterns: string[];
  /** Extra trigger condition id, for example "bflat-involved" (SX04); absent = none. */
  condition?: string;
  /** Names a physical cause: needs the pattern primary in 2 of the last 5 attempts (02 §6.1 item 5). */
  assertsCause: boolean;
  minLevel: number;
  maxLevel: number;
  enabled: boolean;
  /** ≤ 280 characters; placeholders in braces, for example "{offset}" and "{direction}" (U22). */
  text: string;
}

/** `config/tips.json` (02 §6, §10). Also the `TipCatalog` passed to `selectTips`. */
export interface TipsConfig {
  $schema?: string;
  configVersion: string;
  patterns: PatternDef[];
  tips: TipDef[];
  /** Flow and evidence rules (02 §6.1). */
  selection: Sourced & {
    /** Primary tip needs lostPoints ≥ this (3); secondary ≥ (5); at most `maxTips` (2). */
    primaryMinLostPoints: number;
    secondaryMinLostPoints: number;
    maxTips: number;
    /** `assertsCause` tips need the pattern primary in `minPrimary` of the last `ofLast` attempts (2 of 5). */
    assertsCause: { minPrimary: number; ofLast: number };
    /** Skip tips shown in the last N tips for this player (3). */
    skipRecent: number;
    /** "Seen in bars {bars}." */
    defaultEvidenceTemplate: string;
    /** E30 and U18. */
    cleanReadPatternId: string;
    cleanReadTipId: string;
    /** Signal quality: median clarity ≥ (0.9) and clipping ≤ (0.02 of frames), else only E30 or nothing. */
    signal: { minMedianClarity: number; maxClippingFrac: number };
    /** Evidence must span at least this many bars (2), except the listed patterns (E6, E28, E29). */
    minEvidenceBars: number;
    evidenceBarsExempt: string[];
    /** Incomplete attempts may fire only these (E6). */
    incompleteAllowed: string[];
    /** Patterns disabled on beta instruments (E22, E23); beta instruments get universal tips only. */
    betaDisabledPatterns: string[];
    /** Session summary every N attempts (10), top patterns (3), focus card when primary in 3 of 5. */
    summary: { every: number; topPatterns: number; focus: { minPrimary: number; ofLast: number } };
  };
}

/** The catalog passed to `selectTips` is the tips config (01 §5.9). */
export type TipCatalog = TipsConfig;

/** Timing-floor class used by the floor check: per note through `onsetKind` and family (01 §8.2). */
export type TimingFloorClass = 'articulated' | 'slurred' | 'voice';

/** Measurement path for budget totals (01 §8.1). */
export type MeasurementPath = 'laptop-loopback-recheck' | 'phone-loopback-recheck' | 'phone-play-along';

/** One row of the cents floor table (01 §8.4). Null cents = intonation not graded in that steady band. */
export interface CentsFloorRow {
  vibratoClass: VibratoClass;
  /** Steady duration band, ms, inclusive lower bound. */
  minSteadyMs: number;
  /** Exclusive upper bound, ms; null = no upper bound. */
  maxSteadyMs: number | null;
  goodCents: number | null;
  redCents: number | null;
}

/** `config/measurement-budget.json`: 01's error budgets and detectability floors (01 §8; R18, R32). */
export interface MeasurementBudget {
  $schema?: string;
  budgetVersion: string;
  /** Onset error components and totals, 1σ ms, root-sum-square (01 §8.1). */
  onsetError: Sourced & {
    components: { id: string; laptopMs: number | null; phoneMs: number | null; note?: string }[];
    totals: { floorClass: TimingFloorClass; path: MeasurementPath; sigmaMs: number; p95Ms: number }[];
    /** Repeated-note onset SD, ms (01 §8.1): tongued/brass/struck, and soft re-articulation. */
    repeatSdMs: { hard: [number, number]; soft: [number, number] };
  };
  /** Timing floors (01 §8.2): tGood ≥ goodSigmas × σ and tRed ≥ redSigmas × σ on the worst ranked path. */
  timingFloors: Sourced & {
    goodSigmas: number;
    redSigmas: number;
    worstRankedPath: MeasurementPath;
    /** Minimum tolerances, ms: articulated 30/45, slurred 35/50, voice 50/75. */
    floorsMs: Record<TimingFloorClass, { goodMs: number; redMs: number }>;
  };
  /** Minimum IOIs and durations (01 §8.3). */
  ioiFloors: Sourced & {
    /** Pitch-change IOI floor per window class, ms (70 / 90 / 150). */
    pitchChangeMs: Record<WindowClassKey, number>;
    /** Same-pitch repeat IOI floors, ms: tongued or struck 100, voice or bowed 130. */
    repeatMs: { tonguedOrStruck: number; voiceOrBowed: number };
  };
  /** Cents floors (01 §8.4; R18). */
  cents: Sourced & {
    table: CentsFloorRow[];
    /** `intonationMinSteadyMs` floors, ms: none 150, vibrato 180. */
    minSteadyMs: Record<VibratoClass, number>;
    /** Real-audio cents budget c90 (10): good ≥ 2 × c90, red ≥ 3 × c90 + 5 (02 §4.2). */
    c90Cents: number;
    /** Voice relative pitch adds this uncertainty, cents (5). */
    voiceRelativeExtraCents: number;
  };
  /** Live provisional rule floors (01 §8.4). */
  live: Sourced & {
    /** `liveProvisionalMs` ≥ this (80). */
    minProvisionalMs: number;
    /** Hysteresis ≥ `shortHysteresisCents` (10) if the window is under `shortBelowMs` (150), else ≥ `longHysteresisCents` (5). */
    shortBelowMs: number;
    shortHysteresisCents: number;
    longHysteresisCents: number;
  };
  /** Fundamental floors (01 §7.3). */
  fundamentals: Sourced & {
    /** Lowest servable fundamental per window class, Hz (3 periods: 94 / 47 / 23). */
    minHzByWindow: Record<WindowClassKey, number>;
    /** Piano LH never below this MIDI, even in beta (C2 = 36) (R18). */
    pianoLhMinMidi: number;
  };
  /** Capture pipeline limits (01 §7.2, §7.9; R32). */
  capture: Sourced & {
    /** Queued audio above this voids the take (`backlog`), ms (120; R32). */
    backlogVoidMs: number;
    /** Buffer pool size, pairs (32). */
    poolSize: number;
    /** Switch to the main-thread relay if no block arrives within this, ms (500). */
    relayFallbackMs: number;
  };
  /** Calibration acceptance (01 §7.7, §7.8). */
  calibration: Sourced & {
    loopback: { clicks: number; minFound: number; maxMadMs: number; minRtlMs: number; maxRtlMs: number; templateClicks: number };
    playAlong: { clicks: number; bpm: number; maxMadMs: number; minRtlMs: number; maxRtlMs: number };
    /** Per-take recheck: ≥ minClicks with MAD ≤ maxMadMs; use the fresh value above useFreshAboveMs; mark stale above staleAboveMs. */
    recheck: { minClicks: number; maxMadMs: number; useFreshAboveMs: number; staleAboveMs: number };
    /** Reported method adds this to baseLatency + outputLatency, ms (10). */
    reportedExtraMs: number;
    /** Sanity tone must read within ±this many cents (8). */
    sanityToneCents: number;
    /** Clock-rate error above this fraction recreates the context (0.02). */
    clockRateMaxError: number;
  };
}

/** Names of the config documents loaded by `rules/loadConfigs` (01 §5.4). */
export type ConfigFileKey = 'grading' | 'levels' | 'instruments' | 'progression' | 'tips' | 'budget' | 'trumpetValves';

/** `config/instruments.json`. */
export interface InstrumentsConfig {
  $schema?: string;
  configVersion: string;
  _source: string;
  instruments: Instrument[];
}

/** Raw parsed JSON of each config file, before schema validation (01 §5.4). */
export type RawConfigs = Record<ConfigFileKey, unknown>;

/** Validated, deep-frozen configs, the single source of every tolerance and weight (01 §0, R2). */
export interface Configs {
  readonly grading: GradingConfig;
  readonly levels: LevelsConfig;
  readonly instruments: InstrumentsConfig;
  readonly progression: ProgressionConfig;
  readonly tips: TipsConfig;
  readonly budget: MeasurementBudget;
  readonly trumpetValves: TrumpetValveTable;
  /** Index of `instruments.instruments` by id. */
  readonly instrumentById: Readonly<Record<string, Instrument>>;
  /** Index of `levels.levels` by level number. */
  readonly levelByNumber: Readonly<Record<number, LevelDef>>;
  /** Combined version string stored on attempts, for example "grading-2.0.0+levels-1.0.0+..." */
  readonly configVersion: string;
}

/** A floor check failure (01 §0, §8; `rules/checkFloors`). */
export interface FloorViolation {
  file: 'grading-config' | 'levels' | 'instruments';
  /** JSON path of the offending value, for example "timing.onsetClassFloors.hard.goodMs". */
  path: string;
  value: number;
  floor: number;
  /** Which rule, for example "timing tGood ≥ 2σ (articulated)" or "piano-lh served below C2". */
  rule: string;
}

/** Per-take inputs to tolerance resolution (01 §5.4, 02 §4.2). */
export interface ToleranceContext {
  instrument: Instrument;
  /** Served level, 1..10. */
  level: number;
  /** Metronome beats per minute. */
  bpm: number;
  meter: Meter;
}

/** One per ExpectedNote; computed once per take; read by follower, renderer and grader (01 §5.4, 02 §4.2). */
export interface ResolvedTolerance {
  /** Timing thresholds, seconds. */
  tGoodSec: number;
  tRedSec: number;
  tBadSec: number;
  /** Match window W_i, seconds (02 §4.1). */
  matchWindowSec: number;
  /** Intonation thresholds, cents; null = intonation not graded for this note. */
  goodCents: number | null;
  redCents: number | null;
  /** Attack excluded from the steady median, ms. */
  attackExcludeMs: number;
  /** `intonationMinSteadyMs` for this note, ms. */
  minSteadyMs: number;
  /** Live sharp/flat window and hysteresis (02 §4.8). */
  liveProvisionalMs: number;
  liveHysteresisCents: number;
}

// =====================================================================================
// 01 §6.1 Excerpt document (03 owns the fields; 03 §8.2 changes folded in; R8 applied)
// =====================================================================================

/** Licence allowlist (03 §1, R8: no CC BY-SA). */
export type Licence = 'PD' | 'CC0-1.0' | 'CC-BY-4.0';

/** v1 corpus sources, all fetched from GitHub (R4, R27). */
export type CorpusId = 'openscore-lieder' | 'openscore-quartets' | 'mutopia';

/**
 * Where an excerpt's notes come from: a corpus, or `generated` drill material made in the app from config (scales,
 * PLAN ruling 68). The shipped corpus never holds `generated` (the corpus loader rejects it).
 */
export type ExcerptOrigin = CorpusId | 'generated';

/** 0 = default, 2 = widely recognisable (practice only). 1 is kept for later; v1 emits 0 and 2 (03 §8.2, 02 §2.5). */
export type Familiarity = 0 | 1 | 2;

/** Difficulty feature keys of `featureLevels`; `density` added by 03 §6.8. */
export type FeatureKey = 'meter' | 'rhythm' | 'interval' | 'leaps' | 'span' | 'mode' | 'chromatic' | 'double' | 'density';

/** Feature → level, 1..10. Level = max over features (02 §2.1). */
export type FeatureLevels = Record<FeatureKey, number>;

/** Build-time modifications; the runtime adds `transposed` and `octave-displaced` to the displayed list (01 §6.1). */
export type Modification =
  | 'excerpted'
  | 'grace-removed'
  | 'ornament-removed'
  | 'fermata-removed'
  | 'lyrics-removed'
  | 'rhythm-augmented-x2'
  | 'final-bar-completed';

/** Modifications as displayed at runtime (01 §6.1, 03 §9.1 item 6). */
export type DisplayedModification = Modification | 'transposed' | 'octave-displaced';

export type ExcerptFlag = 'noBreath' | 'leapy' | 'bass-line';

/** Intrinsic, instrument-independent features of an excerpt (02 §2.5, 03 §6.8). */
export interface DifficultyFeatures {
  /** Notes (tie chains count once). */
  noteCount: number;
  /** Mean notes per beat. */
  notesPerBeat: number;
  /** Peak notes per beat in any one-beat window (NPS = this × bpm / 60). */
  peakNotesPerBeat: number;
  /** Shortest note or rest, ticks. */
  shortestDur: Ticks;
  /** Largest interval between consecutive notes, semitones (rests under 1 beat do not break adjacency). */
  maxLeapSemis: number;
  /** All leaps above the level's free interval are tonic-triad leaps (02 §2.3). */
  tonicTriadLeapsOnly: boolean;
  /** Maximum leaps (a 4th or larger) in any 4-bar window. */
  leapsPer4BarsMax: number;
  /** Maximum chromatic notes in any 4-bar window. */
  chromaticPer4BarsMax: number;
  /** Count of double sharps and flats. */
  doubleAccidentals: number;
  /** Highest minus lowest note, semitones. */
  spanSemis: number;
  /** Shortest pitch-change IOI, ticks. */
  minIoiTicks: Ticks;
  /** Shortest same-pitch repeat IOI, ticks; null when there are no repeats. */
  minRepeatIoiTicks: Ticks | null;
  /** Syncopated onsets / note count (03 §6.8). */
  syncopationIndex: number;
  /** Rest ticks / window ticks, pickup excluded (03 §6.8). */
  restRatio: number;
  /** Pitch classes outside the key scale (03 §6.8). */
  accidentalsOutsideKey: number;
  /** Raised 6th and 7th in minor (03 §6.8). */
  minorAlterations: number;
}

/**
 * One meter per excerpt (R8). `countUnitTicks` is the metronome beat (02 conventions):
 * 4/4 → 480 × 4 per bar, count unit 480; 6/8 → count unit 720, 2 counts per bar (01 §6.1).
 */
export interface Meter {
  beats: number;
  beatType: 2 | 4 | 8 | 16;
  /** Ticks per metronome beat. */
  countUnitTicks: Ticks;
  /** Metronome beats per bar. */
  countsPerBar: number;
}

/** A measure (01 §6.1). */
export interface Measure {
  /** 0-based index; with a pickup, index 0 is the pickup bar. */
  index: number;
  isPickup: boolean;
  /** Ticks from excerpt start. */
  startTick: Ticks;
  events: ScoreEvent[];
}

export type ScoreEvent = NoteEvt | RestEvt;

export interface TupletRef {
  /** Notes played in the time of `normal` (triplet: 3 in 2). */
  actual: number;
  normal: number;
  groupId: string;
}

/** Common event fields (01 §6.1). */
export interface EvtBase {
  /** Unique within the excerpt, for example "e12". */
  id: string;
  /** Onset, ticks from excerpt start. */
  tick: Ticks;
  /** Sounding duration, ticks (tuplets already scaled). */
  dur: Ticks;
  tuplet?: TupletRef;
}

export type Articulation = 'staccato' | 'tenuto' | 'accent' | 'marcato';

/** Dynamics; fp and sfz appear from L5 (02 §2.3). */
export type Dynamic = 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff' | 'fp' | 'sfz';

export interface NoteEvt extends EvtBase {
  kind: 'note';
  /** Concert pitch, original spelling. */
  pitch: SpelledPitch;
  tieStart?: true;
  tieStop?: true;
  slur?: 'start' | 'stop' | 'continue';
  artic?: Articulation[];
  dynamic?: Dynamic;
  /** Hairpin starting or ending at this note (02 §2.3 L4 "hairpins"). P0b addition, optional. */
  hairpin?: 'cresc' | 'dim' | 'end';
  breath?: true;
}

export interface RestEvt extends EvtBase {
  kind: 'rest';
}

/** Structured source and licence fields; the UI formats the credit (03 §6.11, §8.2: no `attribution` string). */
export interface ExcerptSource {
  composer: string;
  /** For example "1797–1828". */
  composerDates?: string;
  /** Year of death; null for traditional or anonymous (then `sourceEditionYear` is the PD evidence). */
  composerDeath: number | null;
  work: string;
  catalog?: string;
  movement?: string;
  partName?: string;
  /** First and last source bar numbers, inclusive (as printed in the source). */
  sourceMeasures: [number, number];
  edition?: string;
  encoder?: string;
  /** Year of the source edition; PD evidence for traditional and anonymous pieces (03 §6.2, §8.2). */
  sourceEditionYear?: number;
  corpus: ExcerptOrigin;
  /** `repo@sha:path`. */
  upstreamRef: string;
  sourceUrl: string;
  license: Licence;
  licenseUrl: string;
  originalInstrument?: string;
}

/** One agent review pass (03 §6.12). */
export interface LlmVerdictSummary {
  pass: number;
  verdict: 'accept' | 'reject';
  reasons: string[];
}

/** The excerpt document (01 §6.1 with 03 §8.2; schema `schemas/excerpt.schema.json`). */
export interface ExcerptDoc {
  schemaVersion: 1;
  id: string;
  source: ExcerptSource;
  meter: Meter;
  /** Concert key signature; one key per excerpt (R8). */
  keyConcert: KeySig;
  /** Non-null only for modal excerpts; served only with a random key (R8). */
  modal: Mode | null;
  /** Source tempo range, bpm of the metronome beat. */
  tempo: { markedBpm?: number; minBpm: number; maxBpm: number; marking?: string };
  /** Length of the pickup, ticks (0 = none). */
  pickupTicks: Ticks;
  measures: Measure[];
  /** Concert MIDI range, inclusive. */
  rangeConcert: { min: number; max: number };
  features: DifficultyFeatures;
  /** Rhythm cell ids present (02 §2.2). */
  rhythmCells: string[];
  featureLevels: FeatureLevels;
  /** Rhythm feature level per measure, for STARS "Rhythms" (03 §6.8). */
  barRhythmLevel: number[];
  /** Event ids of the first highest and first lowest notes, for STARS "Signs" (03 §6.8). */
  extremes: { highId: string; lowId: string };
  /** max(featureLevels), 1..10. */
  level: number;
  /** Number of features at the maximum (1 = stretch candidate). */
  levelConfidence: number;
  cadenceEnd: 'PAC' | 'IAC' | 'HC';
  phraseQuality: 'complete-phrase' | 'period' | 'phrase-pair';
  /** Longest stretch without a rest or phrase end, bars. */
  breathMaxGapBars: number;
  familiarity: Familiarity;
  flags: ExcerptFlag[];
  tags: string[];
  /** Same melody (strophes, augmented variants) shares a group; seen per player by group (02 §5.3). */
  dedupeGroup: string;
  /** Composer + work key, for variety weighting, for example "schubert|d257". */
  work: string;
  modifications: Modification[];
  /** Pipeline quality scores (soft score, interest). */
  quality?: Record<string, number>;
  /** Automated review (03 §6.12). Rejected or unreviewed items are never emitted. */
  review: {
    /** Rules version, for example "rules-1.0.0". */
    rules: string;
    /** Whether the item went through the agent veto (03 §8.2). */
    llm: 'accepted' | 'not-required';
    llmVerdicts: LlmVerdictSummary[];
    promptVersion: string;
  };
  /** "sha256:..." over the normalized content; keys review verdicts. */
  contentHash: string;
}

/** One agent review verdict line in the 03 pipeline's `review/verdicts.jsonl` (03 §6.12 R2). */
export interface ReviewVerdict {
  contentHash: string;
  /** For example "rubric-v1". */
  promptVersion: string;
  /** For example "rubric-v1-a" or "rubric-v1-b". */
  promptVariant: string;
  pass: number;
  completePhrase: boolean;
  conclusiveEnd: boolean;
  accompanimentLike: boolean;
  idiomaticForWinds: boolean;
  levelPlausible: boolean;
  verdict: 'accept' | 'reject';
  reasons: string[];
  /** Model tier used, for the report. */
  model?: string;
}

// =====================================================================================
// 01 §6.2 Corpus files (03 §6.13, §7.1)
// =====================================================================================

/** A hashed corpus file reference in `index.json`. */
export interface CorpusFileRef {
  /** Path relative to `corpus/v1/`, for example "shard-L05-03.ab12cd.json". */
  file: string;
  /** Content hash, for example "sha256:...". */
  hash: string;
  /** Byte size of the file. */
  bytes: number;
}

/** `public/corpus/v1/index.json` (no-cache) (03 §6.13). */
export interface CorpusIndex {
  schemaVersion: 1;
  corpusVersion: string;
  manifest: CorpusFileRef;
  attributions: CorpusFileRef;
  /** Every chunk, keyed in the manifest by `shard`. */
  chunks: (CorpusFileRef & { shard: string })[];
}

/** Decoded manifest entry (03 §7.1). */
export interface ManifestEntry {
  id: string;
  /** Chunk name, for example "shard-L05-03". */
  shard: string;
  level: number;
  /** "beats/beatType", for example "6/8". */
  meter: string;
  fifths: number;
  mode: 'major' | 'minor';
  modal: Mode | null;
  bars: number;
  pickup: boolean;
  /** Concert MIDI [min, max]. */
  rangeConcert: [number, number];
  minBpm: number;
  maxBpm: number;
  /** For runtime tempo clipping without loading a chunk, ticks. */
  minIoiTicks: Ticks;
  minRepeatIoiTicks: Ticks | null;
  composer: string;
  title: string;
  work: string;
  tags: string[];
  /** Kept for later weighting; no weight in v1. */
  originalFamily?: string;
  cadenceEnd: 'PAC' | 'IAC' | 'HC';
  familiarity: Familiarity;
  featureLevels: FeatureLevels;
  flags: ExcerptFlag[];
  dedupeGroup: string;
  corpus: ExcerptOrigin;
  license: Licence;
  /**
   * Peak notes per metronome beat in any one-beat window (`DifficultyFeatures.peakNotesPerBeat`), for the NPS clip of
   * 03 §7.5 rule 5 without loading a chunk (PLAN ruling 44).
   */
  peakNotesPerBeat: number;
  /**
   * Note events per concert spelled pitch class, keyed by letter and alteration ("C0", "F1", "B-1", "G2"); tie
   * continuations count, as every note event is spelled. Enough to decide 03 §7.5 rule 3 (double and triple
   * accidentals after a spelled transposition) for any interval without loading a chunk (PLAN ruling 44).
   */
  spelling: Record<string, number>;
}

/** Manifest stats for 04's empty states and chips (03 §7.1). */
export interface ManifestStats {
  /** Levels with at least 30 excerpts (03 §5.1, R25). */
  servedLevels: number[];
  /** instrumentId → level → meter → excerpts fitting the tier band in at least one allowed written key. */
  fit: Record<string, Record<number, Record<string, number>>>;
}

/** A cell of the column-oriented manifest: strings are dictionary indices for dictionary columns. */
export type ManifestCell = string | number | boolean | null | number[] | string[] | Record<string, number>;

/** Column name of the serialized manifest. */
export type ManifestColumn = keyof ManifestEntry;

/** Dictionary-encoded string columns (03 §7.1). */
export type ManifestDictColumn = 'composer' | 'title' | 'work' | 'tags';

/**
 * `manifest.<hash>.json` (03 §7.1). `rows[i][j]` is entry i's value for `columns[j]`. Columns in
 * `dict` hold indices into `dict[column]` (`tags` holds an index array).
 */
export interface ManifestFile {
  schemaVersion: 1;
  corpusVersion: string;
  columns: ManifestColumn[];
  rows: ManifestCell[][];
  dict: Record<ManifestDictColumn, string[]>;
  stats: ManifestStats;
}

/** `shard-*.json`: at most 64 excerpts ordered by id (03 §6.13). */
export interface ExcerptChunk {
  schemaVersion: 1;
  shard: string;
  excerpts: ExcerptDoc[];
}

/** A collection credit on the credits page (03 §9.1 item 7). */
export interface CollectionCredit {
  corpus: CorpusId;
  /** "OpenScore Lieder", "OpenScore String Quartets", "Mutopia Project". */
  name: string;
  url: string;
  licenses: Licence[];
}

/** TASL record for a CC BY item (03 §9.3). */
export interface CcByAttribution {
  /** Excerpt id. */
  id: string;
  title: string;
  creator: string;
  sourceUrl: string;
  license: 'CC-BY-4.0';
  licenseUrl: string;
  changes: Modification[];
}

/** `attributions.<hash>.json` (03 §6.13, §9.3). */
export interface AttributionsFile {
  schemaVersion: 1;
  collections: CollectionCredit[];
  items: CcByAttribution[];
}

/** `withdrawn.json` (no-cache): ids skipped at runtime even from a cached chunk (03 §6.13, §11 item 7). */
export interface WithdrawnFile {
  schemaVersion: 1;
  ids: string[];
}

/** Decoded corpus manifest used by the selector (01 §5.5, §6.2). */
export interface CorpusManifest {
  corpusVersion: string;
  entries: ManifestEntry[];
  stats: ManifestStats;
  /** Shard name → file reference. */
  chunks: Record<string, CorpusFileRef>;
  attributions: CorpusFileRef;
  /** Ids from `withdrawn.json`. */
  withdrawn: string[];
}

// =====================================================================================
// 01 §5.5, §6.3 Practice settings, selection and preparation
// =====================================================================================

/** What the player asked for; any field may be random (01 §5.5; R1, R13). */
export interface PracticeSettings {
  instrumentId: string;
  level: number | 'random';
  /** R1: the key the player reads. */
  writtenKey: KeySig | 'random';
  /** "beats/beatType", for example "6/8". */
  meter: string | 'random';
  /** Metronome beats per minute. */
  bpm: number | 'random';
  /** A preference, not a filter (04 §5.2). */
  bars: 8 | 10 | 12 | 'random';
  mode: 'ranked' | 'practice';
  /** false = practise without listening (R13). */
  listening: boolean;
  metronome: MetronomeMode;
  clickTimbre: ClickTimbre;
  /** Accent the first beat of each bar. Absent means true; `defaultAppSettings` writes true. Optional until every PracticeSettings literal sets it. */
  accentFirstBeat?: boolean;
  outputMode: OutputMode;
  /** Concert A4 reference, Hz, 415..446. */
  a4Hz: number;
  /** Selection seed; drawn from the injected RNG when absent. */
  seed?: number;
  /** Play the starting-note reference automatically before a try (default true). */
  autoReference?: boolean;
}

/** Player history the selector needs (01 §6.3, 02 §2.6). */
export interface SelectionHistory {
  /** dedupeGroup → first reveal time (ISO 8601 UTC), all instruments (02 §5.3). */
  seenGroups: Record<string, string>;
  /** Most recent first. */
  recentExcerptIds: string[];
  /** `work` keys of recent excerpts, most recent first (variety weight). */
  recentWorks: string[];
  /** Written keys of recent attempts on this instrument, most recent first (no key more than twice in a row). */
  recentWrittenKeys: KeySig[];
  /** The player's current level on this instrument. */
  playerLevel: number;
}

/** Settings with every random field resolved (01 §6.3 step 1). */
export interface ResolvedSettings {
  instrumentId: string;
  level: number;
  writtenKey: KeySig;
  meter: string;
  bpm: number;
  /** Preferred bar count; the served excerpt may differ (04 §5.2). */
  bars: 8 | 10 | 12;
  /** Which settings were random (m_random counts key, meter, tempo only, 02 §5.4). */
  randomized: ('level' | 'key' | 'meter' | 'tempo' | 'bars')[];
  seed: number;
}

/** What the selector chose and how to transpose it (01 §5.5, §6.3; 03 §7.3–7.5). */
export interface SelectionResult {
  entry: ManifestEntry;
  settings: ResolvedSettings;
  /** Level the attempt is graded and credited at. */
  levelServed: number;
  /** Exactly one feature at L + 1 (02 §2.6). */
  stretch: boolean;
  /** Intrinsic level is L − 1 (02 §2.6). */
  fromLevelBelow: boolean;
  /** Concert shift applied to the source (03 §7.4): {diatonic, chromatic = t}. */
  transposition: Interval;
  writtenKey: KeySig;
  concertKey: KeySig;
  clef: Clef;
  /** Eligible tempo range after clipping (01 §6.3 step 6), bpm. */
  bpmRange: { minBpm: number; maxBpm: number };
  /** Whole-excerpt octave displacement was part of the shift. */
  octaveDisplaced: boolean;
  /** The random written key was retried enharmonically (03 §7.5 item 3). */
  enharmonicRetry: boolean;
}

/** A note after transposition (01 §6.4, §7.10). */
export interface PreparedNoteEvt extends Omit<NoteEvt, 'pitch'> {
  /** Transposed concert pitch. */
  concertPitch: SpelledPitch;
  /** Written pitch the player reads. */
  writtenPitch: SpelledPitch;
}

export type PreparedEvent = PreparedNoteEvt | RestEvt;

export interface PreparedMeasure {
  index: number;
  isPickup: boolean;
  startTick: Ticks;
  /** Bar number as displayed: pickup = 0, first full bar = 1. */
  displayBar: number;
  events: PreparedEvent[];
}

/** The excerpt ready to render and follow (01 §5.5). */
export interface PreparedExcerpt {
  excerptId: string;
  instrumentId: string;
  source: ExcerptSource;
  meter: Meter;
  pickupTicks: Ticks;
  writtenKey: KeySig;
  concertKey: KeySig;
  modal: Mode | null;
  clef: Clef;
  transposition: Interval;
  measures: PreparedMeasure[];
  /** Written MIDI range, inclusive. */
  rangeWritten: { min: number; max: number };
  /** Build-time modifications plus `transposed` / `octave-displaced` (03 §9.1 item 6). */
  modifications: DisplayedModification[];
  barRhythmLevel: number[];
  extremes: { highId: string; lowId: string };
  dedupeGroup: string;
  levelServed: number;
  stretch: boolean;
  /** Tempo range for this excerpt and level after IOI-floor clipping, bpm. */
  bpmRange: { minBpm: number; maxBpm: number };
  selection: SelectionResult;
  /** Set when this is a generated scale, not a corpus excerpt (PLAN ruling 68). Absent for every corpus excerpt. */
  scale?: ScaleRef;
}

// =====================================================================================
// Scales (PLAN ruling 68): generated drill material, never part of the excerpt pool
// =====================================================================================

/** A scale's mode: major, or natural minor. */
export type ScaleMode = 'major' | 'minor';

/** What an attempt practised: a corpus excerpt (the default) or a generated scale. */
export type AttemptKind = 'excerpt' | 'scale';

/**
 * The scale a scale try practised, stored with the attempt (PLAN ruling 68). It holds everything needed to write the
 * same notes again (History's Listen and marked score), even if `config/scales.json` changes later.
 */
export interface ScaleRef {
  /** The scale's id in `config/scales.json`, unique per instrument, for example "five-note-c". */
  id: string;
  /** The pattern's id, for example "five-note", "octave" or "arpeggio" (it names the scale on screen). */
  pattern: string;
  /** Scale degrees in order: 1 is the tonic, 8 the tonic an octave up (pattern `degrees`). */
  degrees: number[];
  /** The written tonic the scale starts on. */
  tonic: SpelledPitch;
  mode: ScaleMode;
  /** "beats/beatType", for example "4/4". */
  meter: string;
  /** Beats of every note but the last. */
  noteBeats: number;
  /** The last note is held to the end of its bar, and for at least this many beats. */
  minLastBeats: number;
}

/** One shape of scale (`config/scales.json`). */
export interface ScalePattern {
  _source?: string;
  /** For example "five-note"; the copy key `scales.title.<id>` names it. */
  id: string;
  /** Scale degrees in order, 1 the tonic and 8 the tonic an octave up (do re mi fa sol fa mi re do is 1 2 3 4 5 4 3 2 1). */
  degrees: number[];
}

/** One scale an instrument offers. */
export interface ScaleDef {
  /** Unique within its set, for example "five-note-c". */
  id: string;
  /** A `ScalePattern` id. */
  pattern: string;
  /** The written tonic it starts on, scientific pitch with b or # for flat or sharp: "C3", "Bb2", "F#3". */
  tonic: string;
  mode: ScaleMode;
  /** Default tempo, quarter-note beats per minute; the player can change it within `tempo`. */
  bpm: number;
}

/** The scales for one instrument or voice, in order from easy to harder. */
export interface ScaleSet {
  _source: string;
  /** An id from `config/instruments.json`. */
  instrumentId: string;
  /**
   * The lowest and highest written note any scale in the set may use ("A2", "D4"): a comfortable span inside the
   * instrument's full range.
   */
  span: [string, string];
  scales: ScaleDef[];
}

/** `config/scales.json`: the scales the app generates (PLAN ruling 68). Adding an instrument is adding a set. */
export interface ScalesConfig {
  $schema?: string;
  configVersion: string;
  _source: string;
  /**
   * The difficulty a scale try is graded at (tolerances, count-in). A scale try never changes the player's
   * difficulty, XP, rank or streak.
   */
  level: number;
  rhythm: {
    _source?: string;
    /** "beats/beatType", for example "4/4". */
    meter: string;
    /** Beats of every note but the last. */
    noteBeats: number;
    /** The last note is held to the end of its bar, and for at least this many beats. */
    minLastBeats: number;
  };
  /** The tempo range the player may choose, quarter-note bpm. */
  tempo: { minBpm: number; maxBpm: number };
  patterns: ScalePattern[];
  sets: ScaleSet[];
}

// =====================================================================================
// 01 §6.4 Expected notes
// =====================================================================================

export type OnsetKind = 'articulated' | 'slurred' | 'repeat';

/** One graded score note; a tie chain is one note (01 §6.4). */
export interface ExpectedNote {
  /** 0-based index in the take. */
  idx: number;
  /** Event ids in the tie chain. */
  eventIds: string[];
  /** Displayed bar number (pickup = 0). */
  bar: number;
  /** 1-based beat position in the bar, metronome beats (1 = downbeat; may be fractional). */
  beatInBar: Beats;
  /** Onset from bar 1 beat 1, beats (negative in the pickup). */
  onsetBeat: Beats;
  durBeats: Beats;
  /** Onset, score seconds at the take's bpm. */
  onsetSec: ScoreSeconds;
  /** Written duration, seconds. */
  durSec: number;
  /** Concert MIDI (integer). */
  concertMidi: number;
  writtenPitch: SpelledPitch;
  /** IOI to the previous / next score note, seconds; null at the ends. */
  ioiPrevSec: number | null;
  ioiNextSec: number | null;
  precededByRest: boolean;
  followedByRest: boolean;
  /** From slur, tie and repeat flags; drives floors and segmenter hints. */
  onsetKind: OnsetKind;
  artic: 'normal' | 'staccato' | 'tenuto' | 'accent';
  /** 02 §4.3 duration rule, computed once. */
  durationGraded: boolean;
  /** Pattern inputs (02 §6.2). */
  keySigAltered: boolean;
  explicitAccidental: boolean;
  ledgerLines: number;
}

// =====================================================================================
// 01 §5.6 dsp
// =====================================================================================

/** DSP worker configuration for one take (01 §5.6). */
export interface DspConfig {
  /** Decimated rate, Hz (exact, for example 16000 or 14700). */
  analysisRate: number;
  windowSamples: WindowSamples;
  hopSamples: 128;
  /** Search range, Hz. */
  minHz: number;
  maxHz: number;
  a4Hz: number;
  clarityThreshold: number;
  /** Cents. */
  changeCents: number;
  onsetProfile: OnsetProfile;
  vibratoClass: VibratoClass;
  outputMode: OutputMode;
  /** Input-timeline arrival = click.t + RTL; [] in headphone modes. */
  clicks: { arrival: ClockSeconds; accent: boolean }[];
  /** Low-band click template for the selected timbre (speakers only). */
  clickTemplate: Float32Array | null;
  /** Expected same-pitch re-articulations (01 §7.5): centre and half-width, seconds. */
  repeatHints: { t: ClockSeconds; halfWidthSec: number }[];
  /**
   * Attack excluded from the steady statistics, ms: `grading.intonation.attackExcludeMsByFamily[family]` (01 §7.5;
   * PLAN ruling 44).
   */
  attackExcludeMs: number;
  /**
   * `Calibration.clickLeakDb` of the route, dBFS in the low band, or null without a calibration. Inside click windows
   * the energy-onset floor is `max(gate, clickLeakDb + 6 dB)` (01 §7.6 item 5) until a confident template fit
   * measures the click's own leak (speakers only; PLAN ruling 44).
   */
  clickLeakDb: number | null;
  /** One sung note stays one note (round 2 detection, `rules/resolveOneNote`); absent or null: the 01 §7.5 segmenter. */
  oneNote?: OneNoteTolerance | null;
  /** Keep the analysed low band for the try's diagnostics export (opt-in, off by default; round 2 detection). */
  traceAudio?: boolean;
  /**
   * Every written onset on the input timeline (t0 + RTL + onset), sorted (round 2 detection). A pitch change that
   * reaches the next written onset is a new note, never a scoop (`oneNote.scoopMs`). Absent: no scoop exception.
   */
  onsetHints?: ClockSeconds[];
}

/** One pitch frame, stamped at the window centre (01 §7.3). */
export interface PitchFrame {
  t: ClockSeconds;
  /** Fractional concert MIDI, null when unvoiced. */
  midi: number | null;
  /** NSDF clarity, 0..1. */
  clarity: number;
  /** dBFS. */
  rmsDb: number;
  /** Band-limited spectral flux, arbitrary units. */
  flux: number;
  inClickWindow: boolean;
}

/** A detected note (01 §5.6). */
export interface DetectedNote {
  /** Unique per take, increasing. */
  id: number;
  /** Per core/onset-definition.ts. */
  onset: ClockSeconds;
  offset: ClockSeconds | null;
  /** Median of the confirming frames, fractional concert MIDI. */
  provisionalMidi: number;
  /** Fractional concert MIDI, median of the steady part so far. */
  midi: number;
  /** Steady median as cents relative to the nearest semitone of `midi`, cents. */
  stableMedianCents: number;
  /** Steady duration (01 §7.5), ms. */
  steadyMs: number;
  /** Pitch SD over the steady part, cents. */
  pitchSdCents: number;
  /** Median clarity, 0..1. */
  clarity: number;
  /** NSDF value at the expected octave's lag, for score-informed octave correction (01 §7.3). */
  altOctaveClarity: number | null;
  onsetCause: 'pitch-change' | 'repeat' | 'flux' | 'from-silence';
  /**
   * The confirming frames sit on one semitone (01 §9.3 item 3: a wrong pitch at confirmation needs them to agree).
   * False when they straddle a semitone (an attack scoop) or when the note started with no frames of its own.
   */
  framesAgree: boolean;
}

export type DspEvent =
  | { type: 'note-on'; note: DetectedNote }
  /** Every 4 hops while sounding. */
  | { type: 'note-update'; note: DetectedNote }
  | { type: 'note-off'; note: DetectedNote }
  /** Every 4 hops; levelDb in dBFS. */
  | { type: 'signal'; levelDb: number; clipping: boolean; voiced: boolean }
  | { type: 'gap'; missingBlocks: number };

// =====================================================================================
// 01 §5.7, §6.5, §9.9 follow, judgments
// =====================================================================================

export type TimingVerdict = 'on-time' | 'early' | 'late';

/** `octave` earns no pitch credit on non-voice instruments (R20). */
export type PitchVerdict = 'in-tune' | 'sharp' | 'flat' | 'wrong-pitch' | 'octave' | 'not-graded';

/** Final judgment of one expected note (01 §6.5, 02 §4.3). */
export interface NoteJudgment {
  expectedIdx: number;
  status: 'matched' | 'missed';
  detectedId: number | null;
  timing: TimingVerdict | null;
  /** Played minus expected onset, ms; + = late. */
  timingErrorMs: number | null;
  pitch: PitchVerdict | null;
  /** Fractional concert MIDI of the played note. */
  playedConcertMidi: number | null;
  /** Deviation from the target after tuning or voice reference offset, cents. */
  centsError: number | null;
  /** Voice: true but credited as correct (R7). */
  octaveDisplaced: boolean;
  duration: 'ok' | 'short' | 'not-graded';
  /** Played duration / written duration. */
  heldRatio: number | null;
  /** Per-note credits 0..1 (02 §4.3); null n or d = not graded. */
  credit: { p: number; n: number | null; o: number; d: number | null };
  /** Beyond good but within red on timing or intonation (02 §4.8 `correct-marginal`). */
  marginal: boolean;
  /** Final state or ghost kind differs from live (01 §9.7). */
  rejudged: boolean;
}

export type LiveJudgment = Omit<NoteJudgment, 'credit' | 'rejudged'> & { provisional: boolean };

/** An unmatched played note (02 §4.1). */
export interface ExtraNote {
  detectedId: number;
  onsetSec: ScoreSeconds;
  /** Fractional concert MIDI. */
  concertMidi: number;
  /** Cents from the nearest semitone. */
  cents: number;
  /** Seconds. */
  durSec: number;
  duringRest: boolean;
}

/** A replayed or skipped-ahead run at a constant offset (01 §9.5, §9.6). */
export interface DisplacedSegment {
  /** Expected-note index range the played notes matched, inclusive. */
  fromIdx: number;
  toIdx: number;
  /** Offset of the player from the metronome, beats (negative = went back). */
  offsetBeats: Beats;
  detectedIds: number[];
}

export interface FinalAlignment {
  judgments: NoteJudgment[];
  extras: ExtraNote[];
  displaced: DisplacedSegment[];
}

/** Why a take ended (01 §5.7, §9.4). */
export type EndReason = { reason: 'complete' } | { reason: 'stopped' } | { reason: 'void'; voidReason: VoidReason };

/** Ghost note drawn on the overlay (01 §5.8). */
export interface GhostNote {
  detectedId: number;
  /** Played onset in score beats (x position never moves, 01 §9.7). */
  scoreBeat: Beats;
  /** Spelled with `theory.spellGhost` (02 §4.8). */
  writtenPitch: SpelledPitch;
  kind: 'early' | 'late' | 'sharp' | 'flat' | 'wrong-pitch' | 'octave' | 'extra';
  centsError: number | null;
  targetExpectedIdx: number | null;
  /** Part of a displaced segment (drawn as a replay ghost). */
  displaced: boolean;
}

/** Follower event stream (01 §9.9). Order per note and idempotence are guaranteed by 01. */
export type FollowerEvent =
  /** ≤ 60 Hz. */
  | { type: 'clock'; scoreBeat: Beats }
  /** ≤ 30 Hz, input meter, dBFS. */
  | { type: 'level'; levelDb: number; clipping: boolean }
  | {
      type: 'note-start';
      detectedId: number;
      scoreBeat: Beats;
      provisionalConcertMidi: number;
      matchedExpected: number | null;
      displaced: boolean;
    }
  | { type: 'note-end'; detectedId: number; durationBeats: Beats }
  /** Idempotent update per expectedIdx. */
  | { type: 'judgment'; judgment: LiveJudgment }
  /** Add or update by detectedId. */
  | { type: 'ghost'; ghost: GhostNote }
  | { type: 'missed'; expectedIdx: number }
  /** Displayed bar number of the next downbeat at least 1 beat ahead. */
  | { type: 'status'; kind: 'come-in-at'; bar: number }
  | { type: 'status'; kind: 'lost-place' | 'rejoined' | 'no-signal' }
  | { type: 'end'; reason: 'complete' | 'stopped' | 'void'; voidReason?: VoidReason }
  | { type: 'final'; alignment: FinalAlignment };

/** Live matcher configuration (01 §5.7). */
export interface FollowConfig {
  expected: ExpectedNote[];
  tolerances: ResolvedTolerance[];
  /** Bar 1 beat 1 on the output timeline. */
  t0: ClockSeconds;
  /** Round-trip latency for mic input, seconds: scoreSec = onset − t0 − this (01 §7.1). */
  latencyCompensationSec: number;
  bpm: number;
  beatsPerBar: number;
  instrument: Instrument;
  cfg: Configs;
  /** Tuning-note offset (winds/brass/strings) or 0, cents. */
  voiceReferenceCents: number;
  /**
   * Decimated analysis rate of the DSP pipeline, Hz (`CaptureBlock.analysisRate`: 16000, 14700 at 44.1 kHz). Sets
   * confirmDelay = W/2 + 3 hops (01 §9.3) (PLAN ruling 44).
   */
  analysisRate: number;
  /** The written key signature the player reads (R1), for ghost spelling (02 §4.8) (PLAN ruling 44). */
  writtenKey: KeySig;
  /**
   * Score seconds from which a detected note may be judged or drawn (round 2 detection): the first written note's
   * onset minus its match window. A note that starts earlier (the voice starting-pitch reference or a count-in click
   * heard through the speakers, a breath before the count-in ends) is not the player's attempt at the music: it gets
   * no event, is not an extra and is left out of the final alignment. Absent: no limit.
   */
  judgeFromScoreSec?: number;
  /**
   * The app's own playback around the take, at its scheduled (output) times: metronome clicks (`hz` null) and tones
   * (`hz` set). The mic hears each one RTL later, which is the same score time. A note that starts inside one (plus
   * `grading.detection.ownPlayback.tailMs`) and, for a tone, at its pitch, is the speakers: never drawn and never an
   * extra; at a click it is ignored unless it sounds longer than `clickMaxMs`. Absent: none known.
   */
  ownPlayback?: OwnSound[];
  /** One sung note stays one note (round 2 detection, `rules/resolveOneNote`); absent or null: the 02 §4.1 rules. */
  oneNote?: OneNoteTolerance | null;
}

/** `grading.detection.oneNote` row: how far one note may wander before it counts as two (round 2 detection). */
export interface OneNoteBand {
  profile: OnsetProfile;
  /** Inclusive difficulty range. */
  levels: [number, number];
  /**
   * Scoop: a pitch change within this long of a note's onset re-pitches the note instead of splitting it, when the
   * note so far glided towards the new pitch without holding a pitch of its own (ms).
   */
  scoopMs: number;
  /** "Holding a pitch": at least this long (ms) with every frame within `plateauCents` of the run's median. */
  plateauMs: number;
  plateauCents: number;
  /**
   * Release: frames this far below the note's loudest frame (dB) that read another pitch are the note dying away
   * (a falling or wobbling end), not a new note: they count towards the offset and never start a split.
   */
  tailDropDb: number;
  /** A wrong pitch may be shown at confirmation (01 §9.3 item 3); false waits for the steady pitch (a scoop). */
  wrongAtConfirm: boolean;
  /** An unmatched note is drawn and counted as an extra once it has sounded this long, ms (02 §4.1 uses 100). */
  extraMinMs: number;
  /**
   * Absorbed: an unmatched note that starts within `absorbGapMs` of the end of a matched note of the same pitch class
   * (or inside it) and sounds less than `absorbMs` is that note's re-articulation: not drawn, not an extra.
   */
  absorbMs: number;
  absorbGapMs: number;
  /**
   * Real voice (docs/redesign/round2/08-real-voice.md; `follow/consolidate.ts`). Detected notes that meet at a pitch
   * change are joined again when they are one sung note. Written onsets keep two written notes sung legato apart.
   *
   * Glitch: a note shorter than `glitchMs` that lies `glitchSemitones` or more from every neighbour it meets (a
   * subharmonic or creak reading) is not a note; its time goes to the neighbour.
   */
  glitchMs: number;
  glitchSemitones: number;
  /** Fragment: a note shorter than this that meets a neighbour is part of the neighbour nearer in pitch, ms. */
  fragmentMs: number;
  /**
   * Long scoop: a note shorter than `longScoopMs`, within `scoopMaxCents` of the longer note it runs into, is that
   * note's scoop (onset where the sound starts, pitch the settled pitch).
   */
  longScoopMs: number;
  scoopMaxCents: number;
  /** Two notes that meet at a pitch change and lie within this of each other are one note, cents. */
  mergeCents: number;
  /**
   * The written rhythm caps those lengths: a fragment is shorter than `fragmentIoiFrac`, a glitch than `glitchIoiFrac`
   * and a scoop than `scoopIoiFrac` times the shortest inter-onset interval around the nearest written note, so a fast
   * written note is never taken for one.
   */
  fragmentIoiFrac: number;
  glitchIoiFrac: number;
  scoopIoiFrac: number;
}

/** A resolved `OneNoteBand` for one take (instrument profile and difficulty). */
export type OneNoteTolerance = Omit<OneNoteBand, 'profile' | 'levels'>;

/** One sound the app plays (output timeline, the clock the take is scheduled on). */
export interface OwnSound {
  t: ClockSeconds;
  durSec: number;
  /** Tone frequency, Hz; null for a click. */
  hz: number | null;
}

/** What the live follower last showed for one expected note at take end (01 §9.7 `rejudged`). */
export interface LiveNoteOutcome {
  status: 'matched' | 'missed';
  detectedId: number | null;
  timing: TimingVerdict | null;
  pitch: PitchVerdict | null;
  marginal: boolean;
}

/**
 * Live outcome per expectedIdx, from the take's follower event stream; an expected note the follower never resolved
 * (still pending) is absent. `FollowApi.finalAlign` compares against it for `NoteJudgment.rejudged` (PLAN ruling 44).
 */
export type LiveOutcome = Map<number, LiveNoteOutcome>;

// =====================================================================================
// 01 §5.8 notation data (04 owns the look)
// =====================================================================================

/** From 04's layout-table.ts (01 §5.8). */
export interface RenderOptions {
  widthPx: number;
  /** Bars per system, in order. */
  barsPerSystem: number[];
  /** Staff space, px. */
  spPx: number;
}

export interface NoteBox {
  system: number;
  /** px within the system SVG. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Frozen layout of a rendered excerpt (01 §5.8). Not a JSON document (holds a Map and functions). */
export interface ScoreLayout {
  systems: { index: number; firstBar: number; lastBar: number; heightPx: number; staffTopY: number; lineSpacing: number }[];
  /** Event id → note box. */
  noteBoxes: Map<string, NoteBox>;
  /** Total: covers pickups (negative) and beats past the last barline; x in px within the system. */
  beatToPoint(scoreBeat: Beats): { system: number; x: number };
  /** y in px within the system for a written pitch on a clef. */
  staffY(system: number, pitch: SpelledPitch, clef: Clef): number;
}

/** Visual state of a written note; mapped to drawing rules by 04's visual-states.ts (01 §5.8). */
export interface NoteVisualState {
  phase: 'pending' | 'active' | 'judged' | 'missed';
  timing?: TimingVerdict;
  pitch?: PitchVerdict;
  provisional?: boolean;
  marginal?: boolean;
  rejudged?: boolean;
}

/** Overlay modes (01 §5.8, 04 §6.1). */
export type OverlayMode = 'live' | 'review' | 'blind';

// =====================================================================================
// 05 §4, §5.2 Measurement gate and AudioEnv
// =====================================================================================

/** Per-take measurement gate checks (05 §4). Each failure makes the take unranked (`calibration` or `measurement`). */
export type GateId =
  | 'sample-rate'
  | 'calibration-unmeasured'
  | 'calibration-quality'
  | 'aec-suspected'
  | 'processing-on'
  | 'recheck'
  | 'capture-gap'
  | 'rtl-high';

/** Audio environment of an attempt; platform-neutral, JSON only, never identifies the person or device (05 §5.2). */
export interface AudioEnv {
  /** 'ios', 'desktop' and 'android' are the native shell (PLAN R85); the web build reports 'web'. */
  platform: PlatformKind;
  osFamily: OsFamily;
  displayMode: DisplayMode;
  appBuild: string;
  /** Version of the shared pure core. */
  coreVersion: string;
  /** 'midi' later. */
  inputPath: 'mic';
  metronomeMode: MetronomeMode;
  clickTimbre: ClickTimbre;
  outputMode: OutputMode;
  route: Pick<AudioRouteInfo, 'inputKind' | 'sampleRate' | 'appliedProcessing'>;
  /** Hz. */
  contextSampleRate: number;
  contextRecreated: boolean;
  /** Fractional clock-rate error (0.088 = 8.8% fast), null when not measured. */
  clockRateError: number | null;
  /** `navigator.audioSession.type` as set, or null. */
  audioSessionType: string | null;
  /** What follow/ subtracted, ms. */
  latencyCompensationMs: number;
  calibrationMethod: 'loopback' | 'play-along' | 'reported' | 'none';
  /** Main-thread relay used (01 §7.2). */
  captureRelay: boolean;
  droppedBlocks: number;
  /** Largest DSP queue during the take, ms of audio. */
  maxQueueMs: number;
  /** DSP worker per-hop time p95, ms (diagnostics only). */
  dspHopP95Ms: number | null;
  gateFailures: GateId[];
}

// =====================================================================================
// 01 §6.5 Attempts and scores (02 §9 shapes; R15, R30)
// =====================================================================================

/** Why an attempt is unranked: 02's enum (R30). Per-check detail is in `AudioEnv.gateFailures`. */
export type RankedReason =
  | 'practice-mode'
  | 'seen-before'
  | 'scan-extended'
  | 'tempo-below-90pct'
  | 'visual-metronome'
  | 'calibration'
  | 'measurement'
  | 'familiar'
  | 'skip-limit'
  /** The player listened to the reference before playing (decision 7). */
  | 'listened-first'
  /** The audio clock ran outside the config limit (round 2: a clock-rate result never blocks a try, it makes it practice). */
  | 'clock-rate';

/**
 * Why a take was voided (01 §7.9, 05 W4, 02 §5.3). Clipping is a results banner, not a void (01 §7.9).
 * `stopped-before-first-note`: a second Stop before the first note in a ranked take (02 §5.3).
 */
export type VoidReason = 'interrupted' | 'no-signal' | 'device-change' | 'backlog' | 'capture-gap' | 'stopped-before-first-note';

/** A fired tip pattern (02 §6.1). */
export interface PatternResult {
  /** E1 .. E31. */
  id: string;
  /** Σ over its notes of component weight × (1 − credit) × 100 / N. */
  lostPoints: number;
  /** Expected-note indices that are the evidence. */
  notes: number[];
  /** Displayed bar numbers of the evidence (for "Seen in bars {bars}."). */
  bars: number[];
  /** Template parameters, for example U22's `offset` (cents) and `direction` (+1 sharp, −1 flat). */
  params?: Record<string, number>;
}

/** A stop: uncovered silence ≥ max(1 beat, 600 ms) with at least one missed note (02 §4.6). */
export interface StopDiagnostic {
  /** Displayed bar where the silence starts. */
  bar: number;
  /** Start, score beats. */
  startBeat: Beats;
  /** Length, beats. */
  beats: Beats;
}

/** A restart or skip (one displaced segment) (02 §4.6). */
export interface RestartDiagnostic {
  /** Displayed bar where the player restarted (the first replayed note's bar). */
  bar: number;
  notesReplayed: number;
  offsetBeats: Beats;
}

/** Verdict counts on results (01 §6.5). */
export type VerdictCounts = Record<'correct' | 'early' | 'late' | 'sharp' | 'flat' | 'wrong' | 'octave' | 'missed' | 'extra', number>;

/** XP breakdown; the UI shows every factor that is not 1.00 (02 §5.4). */
export interface XpBreakdown {
  total: number;
  /** base(L) before factors. */
  base: number;
  /** Factor ids: q, m_tempo, m_random, m_mode, m_streak, m_daily, m_below, practice, repeat. */
  factors: { id: string; value: number }[];
}

/** The score part of an attempt (02 §4, §9; R15: three components plus diagnostics). */
export interface AttemptScore {
  status: 'ok' | 'incomplete';
  /** 0..100 each; I null = "not enough notes to judge" (weight moved to P). */
  components: { P: number; I: number | null; R: number };
  /** Weights actually used (after moving I's weight where applicable). */
  weights: { P: number; I: number; R: number };
  /** 0..100, rounded; capped at 50 when incomplete. */
  score: number;
  grade: LetterGrade;
  stars: 0 | 1 | 2 | 3;
  shine: boolean;
  ranked: boolean;
  rankedReasons: RankedReason[];
  diagnostics: {
    /** Matched notes excluding displaced, and N. */
    matched: number;
    n: number;
    stops: StopDiagnostic[];
    restarts: RestartDiagnostic[];
    /** Least-squares drift at the end, ms; + = behind; null when too few notes. */
    driftMsAtEnd: number | null;
    counts: VerdictCounts;
    /** Signal quality for the clipping banner and tip gating (02 §6.1). */
    signal: { medianClarity: number | null; clippingFrac: number };
    /** Final voice reference offset, cents (voice only). */
    voiceDriftCents: number | null;
  };
  patterns: PatternResult[];
  /** Filled by the session after `selectTips`; `grade()` returns []. */
  tipsShown: string[];
  xp: XpBreakdown;
  configVersion: string;
}

/** Recheck result on the attempt (01 §7.7; R31). */
export interface AttemptRecheck {
  /** `measured`: ≥ min clicks with acceptable MAD. `unmeasured`: on speakers but could not measure (fails gate `recheck`). */
  status: 'measured' | 'unmeasured';
  /** Measured RTL, ms; null when unmeasured. */
  measuredMs: number | null;
  clicks: number;
  /** ms; null when unmeasured. */
  madMs: number | null;
  /** The take used the fresh value (differs from stored by more than the threshold). */
  usedFresh: boolean;
  /** Calibration marked stale; results prompt recalibration (R31). */
  promptRecalibrate: boolean;
}

/** Excerpt credit snapshot stored with the attempt, for history rows and the results header (03 §9.1 item 5). */
export interface ExcerptCreditSnapshot {
  composer: string;
  composerDates?: string;
  work: string;
  catalog?: string;
  movement?: string;
  sourceMeasures: [number, number];
  corpus: ExcerptOrigin;
  license: Licence;
}

/** One attempt; about 5 KB; never audio (01 §6.5, R9). */
export interface AttemptRecord {
  schemaVersion: 1;
  /** UUID. */
  id: string;
  profileId: string;
  /** ISO 8601 UTC. */
  createdAt: string;
  appVersion: string;
  configVersion: string;
  corpusVersion: string;
  coreVersion: string;
  excerptId: string;
  dedupeGroup: string;
  instrumentId: string;
  beta: boolean;
  levelServed: number;
  stretch: boolean;
  /** Placement attempt (02 §5.1): earns XP, not in the level window. */
  placement: boolean;
  /** The settings as requested, with the seed resolved. */
  settingsResolved: Omit<PracticeSettings, 'seed'> & { seed: number };
  transposition: Interval;
  writtenKey: KeySig;
  concertKey: KeySig;
  clef: Clef;
  bpm: number;
  /** Scan time actually used, seconds. */
  scanSeconds: number;
  listening: boolean;
  calibration: {
    method: Calibration['method'] | 'none';
    latencyCompensationMs: number;
    outputMode: OutputMode;
    /** null in headphone modes or when not listening. */
    recheck: AttemptRecheck | null;
  };
  /** Tuning note used and its offset, cents; null for voice and fixed pitch. */
  tuning: { used: boolean; offsetCents: number } | null;
  /** 05 §5.2, with gateFailures[]. */
  audioEnv: AudioEnv;
  detected: DetectedNote[];
  judgments: NoteJudgment[];
  extras: ExtraNote[];
  displaced: DisplacedSegment[];
  /** null when void or not listening. */
  score: AttemptScore | null;
  endReason: 'complete' | 'stopped' | 'void';
  voidReason?: VoidReason;
  /** The excerpt is burned for ranked play (seen at reveal; a void after the first note still burns, 02 §4.7). */
  excerptBurned: boolean;
  /** Counts against the post-reveal skip limit (skip after reveal; interruption void after the first note, R33). */
  countsAsSkip: boolean;
  credit: ExcerptCreditSnapshot;
  /** What was practised. Absent on every attempt stored before scales existed, and it means `excerpt` (PLAN ruling 68). */
  kind?: AttemptKind;
  /** The scale, when `kind` is `scale`. */
  scale?: ScaleRef;
  /** Dev flag only; pruned after 7 days; never audio. */
  debug?: { live: LiveJudgment[]; frames?: PitchFrame[] };
}

/** Filter for `attempts.list` (01 §5.9). */
export interface AttemptQuery {
  instrumentId?: string;
  excerptId?: string;
  rankedOnly?: boolean;
  /** Only excerpts or only scales (an attempt without `kind` is an excerpt). */
  kind?: AttemptKind;
  /** ISO 8601 UTC bounds, inclusive. */
  from?: string;
  to?: string;
  /** Newest first. */
  limit?: number;
  offset?: number;
}

/** A history row (04 history; 01 §5.9). */
export interface AttemptSummary {
  id: string;
  createdAt: string;
  excerptId: string;
  instrumentId: string;
  levelServed: number;
  ranked: boolean;
  endReason: AttemptRecord['endReason'];
  score: number | null;
  grade: LetterGrade | null;
  xp: number;
  title: string;
  composer: string;
  /** Set to `scale` for a scale try (PLAN ruling 68); absent for an excerpt. */
  kind?: AttemptKind;
  scale?: ScaleRef;
}

// =====================================================================================
// 01 §6.6 Profile and calibration (R5; 02 §5.7 fields merged)
// =====================================================================================

/** One entry of an instrument's level window (02 §5.6, §5.7). */
export interface LevelWindowEntry {
  attemptId: string;
  /** Score as entered (incomplete at its capped score). */
  score: number;
  /** Played at or above the level's mid tempo. */
  atMidTempo: boolean;
}

/** Per-instrument progress; level is per instrument (R5, 02 §5.6, §5.7). */
export interface InstrumentProgress {
  level: number;
  /** Last ranked attempts at the current level, oldest first, at most the window size. */
  window: LevelWindowEntry[];
  attemptsRanked: number;
  /** Level → best score. */
  bestByLevel: Record<number, number>;
  /** Pattern id → times fired. */
  patternCounts: Record<string, number>;
  /** Primary pattern per recent attempt on this instrument, most recent first (02 §6.1 item 5). */
  recentPrimaryPatterns: string[];
  /** Tuning-note offset, cents. */
  tuningOffsetCents: number | null;
  /** Level-up offer suppressed until `attemptsRanked` reaches this; null = not suppressed (02 §5.6). */
  offerSuppressedUntil: number | null;
  /** A level-up offer waiting for the player's answer (02 §5.6), or null. */
  pendingOffer: { to: number } | null;
  /** Level before the last auto level-up, for Undo on results (02 §5.6), or null. */
  autoLevelUpUndo: { from: number } | null;
  /** Consecutive ranked attempts ≥ the auto level-up score, and how many were at mid tempo (02 §5.6). */
  autoRun: { count: number; atMidTempo: number };
  /** Placement in progress (02 §5.1), or null. */
  placement: { step: number; results: { level: number; score: number }[] } | null;
}

/** One local player (R5; 02 §5.7). */
export interface PlayerProfile {
  schemaVersion: 1;
  /** UUID. */
  id: string;
  displayName: string;
  /** ISO 8601 UTC. */
  createdAt: string;
  /** Per player; never decreases. */
  xp: number;
  /** Per player, 1..10; never goes down. */
  rank: number;
  /** Local calendar days (YYYY-MM-DD) with ≥ 3 ranked attempts. No freezes in v1 (02 §5.4). */
  streak: { days: number; lastDay: string | null };
  /** Per local day (YYYY-MM-DD): ranked and all attempts (practice counts toward the cap), per-excerpt repeats. */
  daily: { day: string; rankedCount: number; attemptCount: number; repeats: Record<string, number> };
  /** Level is per instrument. */
  instruments: Record<string, InstrumentProgress>;
  /** dedupeGroup → first reveal time (ISO 8601 UTC), all instruments (02 §5.3). */
  seenGroups: Record<string, string>;
  /** Most recent first. */
  recentTips: string[];
  /** Ranked attempts so far, and the ranked index of the last post-reveal skip (02 §5.3; R33). */
  rankedIndex: number;
  lastSkipRankedIndex: number | null;
  activeInstrumentId: string;
  configVersion: string;
}

/** Calibration per route (01 §6.6, §7.8). */
export interface Calibration {
  routeKey: string;
  platform: PlatformKind;
  outputMode: OutputMode;
  method: 'loopback' | 'play-along' | 'reported';
  /** Round-trip latency, ms. */
  roundTripMs: number;
  outputLatencyMs?: number;
  /** MAD of the arrivals, ms. */
  spreadMs: number;
  clicksDetected: number;
  /** Click level in the low band, dBFS. */
  clickLeakDb: number;
  noiseFloorDb: number;
  /** Low-band click templates per timbre: rate in Hz and samples. */
  templates: Partial<Record<ClickTimbre, { rate: number; samples: number[] }>>;
  /** Sanity tone reading, cents; null when not run (headphones). */
  sanityToneCents: number | null;
  aecSuspected: boolean;
  clockRateError: number | null;
  /** ISO 8601 UTC. */
  measuredAt: string;
  stale: boolean;
}

// =====================================================================================
// Calibration analysis results crossing the worker boundary (01 §7.7, §7.8)
// =====================================================================================

/** Per-take count-in recheck as measured by the worker (01 §7.7). */
export interface RecheckResult {
  firstClickFound: boolean;
  clicksFound: number;
  /** RTL from the count-in clicks, ms; null when not measurable. */
  rtlMs: number | null;
  madMs: number | null;
  /** ≥ min clicks with MAD ≤ the threshold (measurement-budget.json calibration.recheck). */
  accepted: boolean;
}

/** DSP worker telemetry for AudioEnv (05 W15). */
export interface DspStats {
  droppedBlocks: number;
  /** ms of audio. */
  maxQueueMs: number;
  hopP95Ms: number | null;
  /** Largest gap in CaptureBlock.seq. */
  missingBlocks: number;
}

// =====================================================================================
// 01 §5.9 grade, tips, store, session data
// =====================================================================================

/** Ranked eligibility inputs (02 §5.2). The grader maps them to `RankedReason`s. */
export interface RankingInput {
  mode: 'ranked' | 'practice';
  seenBefore: boolean;
  /** Scan used exactly the strict level default (R6). */
  scanStrict: boolean;
  familiarity: Familiarity;
  /** A replacement served after the post-reveal skip limit. */
  skipLimitHit: boolean;
  metronome: MetronomeMode;
  /** From the measurement gate (05 §4): calibration-unmeasured → `calibration`, others → `measurement`. */
  gateFailures: GateId[];
  /** The `sample-rate` failure comes only from the clock-rate check: it maps to `clock-rate` instead of `measurement`. */
  clockRateOff?: boolean;
}

/** XP inputs (02 §5.4). */
export interface XpInput {
  /** The player's current level on this instrument (for m_below). */
  playerLevel: number;
  randomized: { key: boolean; meter: boolean; tempo: boolean };
  streakDays: number;
  /** Attempts already counted today before this one (m_daily). */
  dailyCountBefore: number;
  /** 0 = first play of this excerpt today; 1 = first repeat; 2+ = later repeats (practice XP). */
  repeatIndexToday: number;
  placement: boolean;
}

/** Everything `grade()` and `detectPatterns()` read (01 §5.9). */
export interface GradeInput {
  expected: ExpectedNote[];
  tolerances: ResolvedTolerance[];
  alignment: FinalAlignment;
  detected: DetectedNote[];
  instrument: Instrument;
  level: number;
  bpm: number;
  meter: Meter;
  cfg: Configs;
  /** Winds, brass, strings; null for voice and fixed pitch. */
  tuning: { used: boolean; offsetCents: number } | null;
  /** Voice drift reference: final offset and offset at one third of the excerpt, cents (E23). */
  voiceReference: { finalOffsetCents: number; offsetAtThirdCents: number } | null;
  /** The written key signature the player read (R1), for E12, E13 and E18 (PLAN ruling 44). */
  writtenKey: KeySig;
  signal: { medianClarity: number | null; clippingFrac: number };
  /** Timing patterns are off without a measured calibration (02 §6.1). */
  calibrationMeasured: boolean;
  ranking: RankingInput;
  xp: XpInput;
}

/** Rank state (02 §5.5). */
export interface Rank {
  rank: number;
  name: string;
  /** Next rank requirements, or null at the top. */
  next: { rank: number; name: string; xp: number; minLevel: number } | null;
  /** 0..1 towards the next rank by XP. */
  progress: number;
}

/** Progression events after an attempt (02 §5). */
export type ProgressEvent =
  | { type: 'xp'; amount: number; total: number }
  | { type: 'rank-up'; from: number; to: number; name: string }
  | { type: 'level-up-offer'; instrumentId: string; from: number; to: number }
  | { type: 'level-up-auto'; instrumentId: string; from: number; to: number }
  | { type: 'level-down-suggestion'; instrumentId: string; level: number }
  | { type: 'placement-step'; instrumentId: string; nextLevel: number }
  | { type: 'placement-done'; instrumentId: string; level: number }
  | { type: 'streak'; days: number }
  | { type: 'streak-broken'; previousDays: number }
  | { type: 'best'; instrumentId: string; level: number; score: number };

/** A tip chosen for results (02 §6). */
export interface Tip {
  id: string;
  patternId: string;
  /** Text with placeholders filled. */
  text: string;
  /** Evidence line, for example "Seen in bars 3, 5 and 7." */
  evidence: string;
  bars: number[];
  primary: boolean;
}

/** Input of `selectTips` (01 §5.9). */
export interface TipSelectionInput {
  patterns: PatternResult[];
  instrument: Instrument;
  level: number;
  /** Most recent first. */
  recentTipIds: string[];
  /** Primary pattern per recent attempt on this instrument, most recent first. */
  recentPrimaries: string[];
  catalog: TipCatalog;
}

/** App settings (04 §5.11; last practice settings kept, 04 §5.2). */
export interface AppSettings {
  schemaVersion: 1;
  practice: PracticeSettings;
  audio: {
    inputDeviceId: string | null;
    /** 0..100. */
    metronomeVolume: number;
  };
  display: {
    theme: 'system' | 'light' | 'dark';
    /** "After the take" hides the overlay during the take (R11). */
    liveFeedback: 'full' | 'after-take';
    showCentsMs: boolean;
    /** When ghost notes show during a try: from the fourth note, always, or never (default `from4`). */
    ghostsLive?: 'from4' | 'always' | 'never';
    /** Show the notes the app heard under the staff on results (default false). */
    showHeard?: boolean;
    /** The try's beat line: a thin line that moves through the staff with the beat (default true). */
    beatLine?: boolean;
    /**
     * Beat line timing, ms (PLAN R70): moves the beat line and the other visuals on the heard clock (count-in track,
     * sounding note, captions) earlier (negative) or later (positive) than the reported output latency places them.
     * -150 to 150 in steps of 10, default 0. Visual only: audio judging is unchanged.
     */
    beatLineOffsetMs?: number;
    /** Note colours: each notehead filled in its letter name's colour on every score (default false, PLAN R69). */
    noteColours?: boolean;
    /**
     * How the Match a note needle moves (round 3, 03-pitch-steadiness §4). Display only: never an input to a try.
     * Absent: by instrument family (Steady for voices, Balanced for instruments).
     */
    pitchSteadiness?: PitchSteadiness;
  };
  practicePrefs: { showStars: boolean; showTips: boolean; showBeta: boolean };
  /** Optional name shown on the home screen; absent until the player sets one. */
  profile?: { displayName?: string };
  accessibility: {
    reduceMotion: 'system' | 'on' | 'off';
    highContrast: boolean;
    keyboardShortcuts: boolean;
    announceResults: boolean;
  };
  onboardingDone: boolean;
  /**
   * Where first-run setup stands (round 3, R74), so a reload resumes at the same step; cleared when setup finishes.
   * Untyped on purpose: `restoreProgress` (app/screens/onboarding/flow.ts) reads it, the round 2 step ids included,
   * and anything it cannot read starts setup at Welcome. Never trusted, so the stored schema need not check it.
   */
  onboardingProgress?: unknown;
  /** One-time hints and sheets already shown (05 W11, W13). */
  shown: { installCoach: boolean; autoLockHint: boolean };
}

/** JSON value (for kv documents and predicates). */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Versioned, platform-neutral export file (01 §11, 05 §5.3 item 6). */
export interface ExportFileV1 {
  format: 'sightread-export';
  version: 1;
  /** ISO 8601 UTC. */
  exportedAt: string;
  appVersion: string;
  profile: PlayerProfile | null;
  attempts: AttemptRecord[];
  calibrations: Calibration[];
  settings: AppSettings;
  kv: Record<string, JsonValue>;
}

/** Practice session states (01 §5.9). */
export type SessionState = 'idle' | 'loading' | 'covered' | 'scanning' | 'count-in' | 'performing' | 'finishing' | 'results' | 'error';

/** Error codes the session surfaces (04 §9 copy keys). */
export type SessionErrorCode =
  | 'empty-pool'
  | 'mic-denied'
  | 'mic-not-found'
  | 'audio-setup'
  | 'corpus-load'
  | 'storage'
  | 'unknown';

/** Session events for the UI (01 §5.9). */
export type SessionEvent =
  | { type: 'state'; state: SessionState; prev: SessionState }
  | { type: 'prepared'; excerpt: PreparedExcerpt }
  | { type: 'empty-pool'; suggestions: Partial<PracticeSettings>[] }
  /** Remaining strict scan time, seconds. */
  | { type: 'scan-tick'; remainingSec: number }
  /** Count-in beat k of n (1-based). */
  | { type: 'count-in'; beat: number; of: number; t: ClockSeconds }
  | { type: 'count-in-restart'; reason: 'first-click-missing' | 'stop-before-first-note' | 'rotation' }
  | { type: 'follower'; event: FollowerEvent }
  | { type: 'void'; reason: VoidReason }
  | { type: 'record'; record: AttemptRecord }
  | { type: 'progress'; events: ProgressEvent[] }
  | { type: 'tips'; tips: Tip[] }
  | { type: 'recalibrate-prompt'; routeKey: string }
  /** `kind`: a try that could not start because the sound did not start or the microphone did not open (round 2, 01-ux §9). */
  | { type: 'error'; code: SessionErrorCode; detail?: string; kind?: 'audio-start' | 'mic-start' };

// =====================================================================================
// Small injected utilities (01 §4.3; implemented in P0c)
// =====================================================================================

/** Seeded RNG (mulberry32, `core/rng.ts`). Core packages get randomness only through this (01 §4.3). */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [minInclusive, maxExclusive). */
  int(minInclusive: number, maxExclusive: number): number;
}

/** Typed emitter for the real-time path (01 §1; `core/events.ts`, P0c). */
export interface Emitter<T> {
  /** Subscribe; returns the unsubscribe function. */
  on(listener: (event: T) => void): () => void;
  emit(event: T): void;
  /** Removes every listener. */
  clear(): void;
}

// =====================================================================================
// Fixtures (01 §14 items 7–11): file formats, validated against the generated schemas
// =====================================================================================

/** Assertion predicate used by follow and grade fixtures instead of hand-computed totals (01 §14 items 9, 10). */
export interface Predicate {
  /**
   * Dotted path into the subject, with `[n]` indices, `[*]` (every element must satisfy) and
   * `[?]` (at least one element satisfies), for example "judgments[*].timing" or "score.components.R".
   * For `fires` / `not-fires` the path is a pattern id.
   */
  path: string;
  op: 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge' | 'approx' | 'in' | 'includes' | 'excludes' | 'length' | 'exists' | 'absent' | 'fires' | 'not-fires' | 'only-fires';
  /**
   * Comparison value. `approx`: number, with `tolerance`. `in`: array of allowed values. `includes` /
   * `excludes`: an element the array at `path` must or must not contain. `length`: the array length.
   * `exists` / `absent`: no value. `fires` / `not-fires`: no value. `only-fires`: array of pattern ids.
   */
  value?: JsonValue;
  tolerance?: number;
  /** Why the predicate holds (cites the spec). */
  note?: string;
}

/** Item of a follow fixture input stream, in clock seconds (01 §14 item 9). */
export type FollowStreamItem =
  | { kind: 'dsp'; t: ClockSeconds; event: DspEvent }
  | { kind: 'clock'; t: ClockSeconds }
  | { kind: 'end'; t: ClockSeconds; end: EndReason };

/** `fixtures/follow/*.json` (01 §14 item 9). */
export interface FollowFixture {
  schemaVersion: 1;
  id: string;
  description: string;
  /** Fixture-corpus excerpt the expected notes came from. */
  excerptId: string;
  instrumentId: string;
  level: number;
  bpm: number;
  writtenKey: KeySig;
  /** Golden expected notes (copied from fixtures/expected/ or built by the same function). */
  expected: ExpectedNote[];
  t0: ClockSeconds;
  latencyCompensationSec: number;
  voiceReferenceCents: number;
  stream: FollowStreamItem[];
  /** Predicates over the live event list (subject: `{ events: FollowerEvent[]; judgments: LiveJudgment[] }`). */
  expectLive: Predicate[];
  /** Predicates over `FinalAlignment`. */
  expectFinal: Predicate[];
}

/** `fixtures/grade/*.json` (01 §14 item 10; 02 §4.9 acceptance cases). */
export interface GradeFixture {
  schemaVersion: 1;
  id: string;
  /** 02 §4.9 case number. */
  case: number;
  description: string;
  excerptId: string;
  instrumentId: string;
  /** `GradeInput` without the runtime objects; tolerances are resolved by the test from configs. */
  input: Omit<GradeInput, 'cfg' | 'instrument' | 'tolerances'>;
  /** Predicates over `{ score: AttemptScore; patterns: PatternResult[]; tolerances: ResolvedTolerance[] }`. */
  expect: Predicate[];
}

/** One line of `fixtures/render/*.events.jsonl` (01 §14 item 11). The first line is the header. */
export type RenderStreamLine =
  | {
      kind: 'header';
      schemaVersion: 1;
      excerptId: string;
      instrumentId: string;
      writtenKey: KeySig;
      bpm: number;
      level: number;
      description: string;
    }
  /** atMs: time since the stream start (bar 1 beat 1 = count-in end), ms of wall time for playback. */
  | { kind: 'event'; atMs: number; event: FollowerEvent };

/** `fixtures/expected/*.json`: golden expected notes for an excerpt × instrument × key (01 §14 item 8). */
export interface ExpectedGolden {
  schemaVersion: 1;
  excerptId: string;
  instrumentId: string;
  level: number;
  writtenKey: KeySig;
  bpm: number;
  transposition: Interval;
  clef: Clef;
  notes: ExpectedNote[];
}

/**
 * `fixtures/levels/feature-vectors.json`: golden feature-to-level cases shared by the TypeScript
 * and Python level taggers (02 §10, G2).
 */
export interface LevelTaggerGolden {
  schemaVersion: 1;
  _source: string;
  cases: {
    id: string;
    /** "beats/beatType". */
    meter: string;
    mode: Mode;
    minorForm?: 'natural' | 'harmonic' | 'melodic';
    rhythmCells: string[];
    features: DifficultyFeatures;
    expected: { featureLevels: FeatureLevels; level: number };
  }[];
}
