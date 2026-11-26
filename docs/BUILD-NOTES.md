# Build notes

Notes handed from one wave to the next. Read the parts for the modules you touch. `docs/PLAN.md` rulings override these.

## From wave 0

### P0a

- Lint fixtures and element classification use the glob prefix **/src/..., so new fixtures go under test/lint-fixtures/src/<area>/ and need a first-line `// expect: <ruleId>|none`. Imports in fixtures need real stub files in the mirrored tree. Use explicit .ts extensions.
- Per-file pure-package typechecking: tsconfig.core.json (ES2022, no DOM, no node types, test files excluded) covers the pure folders. tsconfig.dsp.json adds the WebWorker lib for src/dsp and src/core. A node-using test in a pure folder must be named *.test.ts so it is typechecked only by tsconfig.json.
- The import-boundary policy lives in eslint.config.js (allowedImports). The composition-root category (src/main.tsx and src/app/main.tsx) may import everything, including platform/web. Restricted globals are off in src/platform/web, src/app/main.tsx, src/main.tsx and src/testkit. notation may use performance. Test files are exempt from the boundaries and globals rules, because the rule block ignores *.test.*.
- The metronome rule matches files named metronome.ts, metronome-*.ts or under a metronome/ folder, so P11 must use one of those names.
- Vitest picks up src/**/*.test.ts, test/**, tools/**, fixtures/** and config/**. E2E specs go in e2e/. Set E2E_FAKE_AUDIO_WAV to feed the chromium-audio project.
- The pre-existing `pnpm lint` runs `stylelint ... --allow-empty-input`, so it passes with no CSS files.

Known gaps:

- pnpm 10 is installed and the spec says pnpm 9, so package.json sets packageManager pnpm@10.28.0. Versions differ from the spec's text: Vite 7.3.8, vitest 4.1.12, ESLint 9.39.5, TypeScript 5.9.3, stylelint 16. The newest majors (Vite 8, TS 7, ESLint 10) have peer-dependency problems with plugins.
- scripts.schemas points to tools/generate-schemas.ts, which does not exist yet. P0b owns it. ts-json-schema-generator, ajv, ajv-formats and tsx are already installed for it.
- Stylelint enforces tokens-only colours, no px, no 100vh, and motion tokens on transition and animation. It does not check that animations sit behind a reduced-motion rule (04 13.1 item 1). D0a must add a custom rule or plugin for that. The motion token prefix I assumed is --motion-, which D0a should confirm.
- The spec's contract-test, dependency-cruiser-beyond-cycles, scenario (P18) and bare-runtime (13.3) CI jobs are not added, because their suites do not exist yet. Coverage thresholds (85% lines) are configured but only run with pnpm test:coverage.
- WebKit Playwright projects are defined but cannot run in this sandbox. The CI e2e job installs WebKit and unsets PW_CHROMIUM_PATH. The workflow was not run here.
- src/core/_sentinel.ts is a placeholder so tsconfig.core.json and tsconfig.dsp.json have an input. P0b should delete it once src/core has real files.
- vite-plugin-pwa, workbox-build and workbox-window are installed but not wired into vite.config.ts, which is P19's job.
- The boundaries rule leaves files outside the classified folders unchecked, such as src/main.tsx. I did not enable boundaries/no-unknown-files.

### P0b

- File layout: all data types live in src/core/types.ts, which imports nothing. platform.ts holds the services (PlatformCapabilities, CaptureBlock, ClickSpec, WorkerMessage, WorkerReply, TakeSchedule, AudioBackend, MessagePortLike, WorkerLike, KeyValue, StoreRepos, PlatformServices) and re-exports the seam primitives (ClockSeconds, OutputMode, ClickTimbre, MetronomeMode, OsFamily, DisplayMode, PlatformKind, AudioRouteInfo, AppliedProcessing) from types.ts. Without this split there would be an import cycle, which dependency-cruiser counts even for type-only imports.
- Module signatures are in src/core/api.ts: CoreTimeApi, CoreUtilApi, TheoryApi, InstrumentsApi, RulesApi, CorpusApi, DspApi, FollowApi, ScoreView<Container>, GradeApi, TipsApi, StoreApi, SessionApi, and instance interfaces for the classes (VoiceDriftReferenceInstance, DspPipelineInstance, LiveFollowerInstance, PracticeSessionInstance, Decimator). Implement with `export const f: XApi['f'] = ...` or `class X implements XInstance`. ScoreView is generic so core needs no DOM; notation implements ScoreView<HTMLElement>.
- P0c: TPQ is exported from types.ts, so re-export it from time.ts rather than redefining it. Implement the Rng (next, int) and Emitter (on returns an unsubscribe, emit, clear) interfaces from types.ts in rng.ts and events.ts; I did not create events.ts.
- P0b additions beyond 01 §5 (all needed by more than one package):
  - WorkerMessage 'end' now carries `reason: EndReason`.
  - New WorkerReply union for worker → main messages (ready, events, recheck, done, error).
  - AudioBackend.captureRelay and audioInfo(), for AudioEnv.
  - StoreRepos: attempts.all(), calibrations.all(), clearAll().
  - PlatformServices.localDay(), because streaks and daily caps use local days.
  - StoreApi export and import take a `kv` argument.
  - CorpusApi.countEligible (04 §5.2).
  - GradeApi: createProfile, respondToLevelOffer, setInstrumentLevel.
  - InstrumentsApi.
  - NoteEvt.hairpin (optional).
  - Dynamic adds fp and sfz.
  - MessagePortLike replaces MessagePort, since core has no DOM.
- Name and shape choices where the specs disagree and PLAN does not rule (owner table applied):
  - VoidReason drops 'clipping': 01 §7.9 says clipping is a results banner, so it lives in AttemptScore.diagnostics.signal.clippingFrac and grading.gates.clippingBannerFrac. It adds 'stopped-before-first-note' (02 §5.3).
  - 01's 'not-listening' and 'voice-absolute-pitch' ranked reasons are gone under R30; a not-listening take has score null.
  - PlayerProfile merges 01 §6.6 with 02 §5.7. It adds daily.attemptCount and daily.repeats, rankedIndex and lastSkipRankedIndex (in place of skipLedger), and per instrument: window entries {attemptId, score, atMidTempo}, recentPrimaryPatterns, offerSuppressedUntil, pendingOffer, autoLevelUpUndo, autoRun and placement. Streak freezes are dropped because 02 has none in v1.
  - Diagnostics stops and restarts are arrays of {bar, startBeat, beats} and {bar, notesReplayed, offsetBeats}, not counts.
  - TipDef.patterns is an array (U20 and VO04 have several triggers), where 02's example shows a single `pattern`.
  - DifficultyFeatures uses 03's maxLeapSemis (not 02's maxIntervalSemis), and doubleAccidentals is a count.
  - The tolerance resolver is rules/resolveTolerances (01) rather than grade/resolve-tolerance.ts (02), because 01 owns module boundaries.
- AttemptRecord additions:
  - placement
  - clef
  - tuning
  - excerptBurned
  - countsAsSkip
  - credit (ExcerptCreditSnapshot, for history rows)
  - calibration.method can be 'none'
  - recheck is AttemptRecheck {status: measured or unmeasured, measuredMs, clicks, madMs, usedFresh, promptRecalibrate}, null in headphone modes.
  
  GradeInput carries everything grade() needs: ranking (RankingInput), xp (XpInput), tuning, voiceReference, signal and calibrationMeasured. grade() returns tipsShown empty; the session fills it after selectTips.
- Fixture formats are frozen:
  - FollowFixture: embedded golden ExpectedNote[] and a stream of {kind dsp, clock or end, t in ClockSeconds}, with predicate lists expectLive and expectFinal.
  - GradeFixture: GradeInput without cfg, instrument and tolerances, plus a predicate list.
  - RenderStreamLine: a header line, then event lines {kind 'event', atMs, event}.
  - ExpectedGolden.
  - LevelTaggerGolden (fixtures/levels/feature-vectors.json).
  
  Predicate paths support [n], [*] (every element) and [?] (at least one); the ops are listed in the doc comment.
- Config files: the levels.json NPS cap is per window class (npsCap {'512','1024','2048'}, R18). Each LevelDef, PatternDef, TipDef and config block needs `_source`. Each config file needs a configVersion (budgetVersion for the measurement budget) and may carry `$schema`. The trumpet valve table type is TrumpetValveTable under the RawConfigs key 'trumpetValves'; P0d picks its path (02 says data/trumpet-valves.json).
- After any change to src/core/types.ts, run `pnpm schemas`; otherwise tools/generate-schemas.test.ts fails. Every root type is listed in SCHEMA_TARGETS in tools/generate-schemas.ts.

Known gaps:

- No signatures for calibration/ (P14) or core/onset-definition.ts (P0c): 01 §5 does not specify them. Only the types that cross module boundaries are frozen (RecheckResult, DspStats, Calibration).
- 03's pipeline-internal candidate schema (tools/corpus-build/schemas/candidate.schema.json) is not generated: it is Python-internal and outside my paths. The verdict format is frozen as ReviewVerdict → schemas/review-verdict.schema.json; 03 wanted it at review/verdict.schema.json, so C8 should reference the generated file or copy it there.
- The config shapes (GradingConfig, LevelsConfig, ProgressionConfig, TipsConfig, MeasurementBudget, TrumpetValveTable) are my reading of 02 §2 to §6 and 01 §8. No seeded values exist yet, so P0d may find a value with no field. That needs an overseer change, since these files are frozen.
- No `schemas:check` script was added to package.json (P0a owns it). The drift check runs inside `pnpm test` through tools/generate-schemas.test.ts.

### P0c

- time.ts: ticks run from the excerpt start, so pickup ticks are subtracted and pickup beats are negative. Beat length follows the 02 convention through Meter.countUnitTicks, so the dotted quarter in 6/8, 9/8 and 12/8 is 720 ticks. makeMeter(beats, beatType) builds the Meter for a time signature and is useful in fixtures.
- rng.ts: createRng(seed) is standard mulberry32 and truncates the seed to an unsigned 32-bit value. int(min, max) throws RangeError unless both are integers with min < max.
- events.ts: createEmitter delivers to a snapshot of listeners. A listener that throws does not stop the others, and the first error is rethrown after all have run.
- onset-definition.ts exports: pitchChangeOnset, repeatedOnset (returns t, halfRiseT, minT, dipDb, amDepthDb and detectable), onsetFromSilence, isReArticulationDetectable, amDepthDb, fluxPeakNear, and the constants ENVELOPE_HOP_SEC, MIN_DIP_DB, AM_DEPTH_FACTOR, AM_WINDOW_SEC, FLUX_REFINE_SEC and SILENCE_ONSET_WINDOW_SEC. All take plain arrays and seconds, so the synth and the DSP can share them on any timeline.

Known gaps:

- The onset-definition test accuracy is measured on analytic piecewise-linear signals. The spec does not say how the synth and DSP will feed the envelope and pitch series, so the function inputs (EnvelopeSeries, OnsetPitchFrame, FluxSample) are my design. P3, P4c and P0g must adopt them or report a mismatch.
- onsetFromSilence reads 'within 20 ms of the confirming frames' as a symmetric window of plus or minus 20 ms around confirmT. The spec is ambiguous here.
- The AM depth is defined as the peak-to-peak envelope in dB over the 200 ms ending at the pre-dip peak, clamped to the note's start (noteStartT). The caller must pass a noteStartT after the attack, or the attack rise counts as AM. The spec gives no exact definition.

### P0d+G0

- P2 (rules): resolveTolerances reads grading.timing.levelBands, ioiCap, onsetClassFloors and matchWindow. Intonation bands are in grading.intonation.bands, selected by group (voice/continuous/fixed). Vibrato families (voice, strings) widen to vibratoWiden below 360 ms steady. All tolerance values are in config; none are needed in code.
- VoiceDriftReference should read grading.voice (driftWindowNotes 4, maxOffsetCents 50, maxStepCents 15).
- checkFloors lives in src/rules/floor-check.ts. P2 should re-export it and loadConfigs from src/rules/index.ts. Both match the RulesApi signatures.
- P9b/P9c: levels.json holds the rules, instruments.json holds tiers, clefs and detection. Effective NPS cap is min(levelCap, 1000/pitchChangeFloor) and is already applied for the 2048 class.
- P12b/P13: tips.json patterns carry components (for lostPoints), thresholds and minEvidence. enabled tips only reference launch instruments. Tip ids with condition 'bflat-involved' (SX04) need a detector-side condition.
- E16 adjacency: in data/trumpet-valves.json, adjacent partials are neighbours among the partials used for that valve combination, so open G5 (p6) and C6 (p8) are adjacent (02 §4.9 case 9). Partial 7 is never used.
- fixtures/levels/feature-vectors.test.ts contains a reference tagger the TS tagger can be compared against. The Python tagger can read feature-vectors.json directly. Density uses level minBpm, most permissive window class (512), and the smallest IOI floors (70/100 ms).

Known gaps:

- Spec error: 02 §1.3 gives horn lowest sounding fundamental as 87 Hz. Written 42 minus semis 7 is concert MIDI 35, which is 61.7 Hz. instruments.json derives lowFundamental from the numbers, so horn-f is lowFundamental:true. Horn is beta, so the effect is intonation weight moving to pitch. 02 should correct the table.
- L10 meters: 02 says 'any single meter'. levels.json lists the L9 set plus 4/2, 4/8, 6/16, 9/16, 12/16. These extras are my enumeration, not from the spec.
- L5 max interval: 02 says 'm7 (P8 allowed)'. Encoded as maxIntervalSemis 12, which makes it monotone with L4 (P8 = 12). Stated here because the wording is ambiguous.
- attackExcludeMsByFamily: 01 only gives 'winds 50 ms'. The other values are my choices: voice 80, brass 60, strings 60, keyboard and guitar 50 (unused since not intonation-graded). 01 should confirm.
- npsCap per window class: 512 and 1024 hold the 02 level cap. 2048 holds min(cap, 6.5), using the 'about 6.5' figure from 02 §2.4 and 01 §8.3 (1000/150 is 6.67).
- Disabled family-tip metadata (patterns, instruments, condition ids like 'flat', 'sharp', 'sharp-throat-tones-g4-bb4') was inferred from the revision-1 trigger text. Text is copied verbatim by script from 02 and from revision 1 (commit a2454fe). No tip exceeds 280 characters.
- Some enabled patterns that apply to every instrument except voice (E22) cannot be expressed in the schema's `instruments` field and are left unrestricted. Beta exclusion for E22/E23 is in selection.betaDisabledPatterns.
- Pattern thresholds and minEvidence keys are my naming of the numbers in 02 §6.2 (the schema allows free named numbers). P12b should use these keys or change config via RFC.
- The 'configVersion' per file (levels-1.0.0 etc.) is mine; only grading-2.0.0 comes from 02.
- The loader uses a small in-repo JSON Schema interpreter, not Ajv, so it works under CSP and in the bare runtime. Ajv (devDependency) is used only in tests.

### P0g

- Import from src/testkit/index.ts. Main API: renderMin(spec) returns { samples, sampleRate, truth, clickTimes }. SynthSpec has notes (midi, onsetSec, durSec, cents, legato, tongueDipDb), clicks, clickTimbre, bleedDb, noiseDbfs, seed, vibrato, adsr, harmonics and levelDb. clickBurst(timbre, accent, sr) returns a fixed click template. encodeWav and decodeWav give WAV I/O. REF_SPECS and renderRef give the reference renders.
- FakeAudioBackend options: source (Float32Array, WavData or WAV bytes), sourceStartClock, t0AfterCaptureSec, loopback, dropSeqs, clockRateError, route, capabilities, captureRelay. Drive it with advance(sec), advanceTo(clock) or await run({ realtime?, untilClock?, tailSec? }). Script events with scriptInterruption(atClock, reason) and scriptRouteChange(atClock, patch). Assert on its public log, and use setSource between captures. The virtual clock starts at 10 s by default.
- The backend never advances its clock by itself. Anything that waits for a time to pass (for example a session scan timer) must be driven by run() or advance().
- To regenerate the reference WAVs after an intentional synth change: pnpm tsx src/testkit/ref/generate-refs.ts, then commit the new checksums. Any change to renderMin changes them by design, so P3 should extend through new options and keep existing outputs byte-identical, or regenerate on purpose.

Known gaps:

- The repo has no top-level testkit/ directory. The spec layout (01 section 4.1) and eslint.config.js both use src/testkit/, so I put everything there. The 'testkit/' path in section 14 should be read as src/testkit/.
- Ground truth in synth-min is the scripted onset (the attack start, or the glide midpoint for legato notes). It is not computed with core/onset-definition.ts, so it is not the 'within 1 ms' truth that P3 acceptance asks for. P3 owns that.
- synth-min has one generic additive timbre (a harmonics array). The 9 named timbres, the room impulse responses, phone-mic EQ, AGC pumping, capture band limits and the scenario generator are P3.
- The fake backend has its own small biquad low-pass (3 kHz, 8th order), decimator and 1 ms high-pass energy, because dsp/ does not exist yet. The coefficients are standard Butterworth RBJ, not the fixed per-rate tables in dsp/filters.ts. P4a's real worklet code may differ slightly in absolute filter phase and gain. The block shape, phase carry and contiguity match the spec.
- The fake backend's click mixing (loopback option) only mixes clicks scheduled after startCapture or while capturing. Clicks scheduled before startCapture are queued and mixed at startCapture, but buffers are cleared on cancelTake. Mixing is in the input domain and does not model speaker EQ.
- pnpm typecheck fails on another package's file (src/rules/load-configs.ts uses structuredClone, which is not in the type libs). This is not caused by testkit.

### D0a+D0c

- Import the generated module as `import { tokens, ui, score, component, zIndex, motion, breakpoints, contrastPairs } from '../ui/tokens.ts'`. Import the CSS once from the app entry (src/main.tsx or src/app/App.tsx). Do not hand-edit tokens.css or tokens.ts; change design/tokens.json and run `./node_modules/.bin/tsx tools/generate-tokens.ts`.
- Theme and paper: the root element carries data-theme (light or dark) and optionally data-paper (light or dark, which overrides paper only), and data-contrast="high". With no data-theme the system preference applies. Forced colours are handled entirely in CSS.
- Copy: `import { copy, type CopyKey } from '../ui/copy/copy.ts'`. Call `copy('play.status.bar', { n, total })`. Plurals take a number under the same name and only one/other forms are allowed. formatMessage throws on a missing variable, which is deliberate, so unfilled placeholders fail in tests rather than rendering as undefined.
- The ratio helpers `contrastRatio` and `relativeLuminance` are exported from src/ui/tokens.contrast.test.ts and can be reused by the grayscale and high-contrast checks in D13.
- The copy formatter does not do locale-aware number formatting. Callers pass pre-formatted strings for numbers such as 2,180 XP. Dates and day headings are formatted in code (history.day.* only covers Today and Yesterday).

Known gaps:

- STYLELINT CONFLICT: the spec's motion token names (--dur-*, --ease-*) fail the existing .stylelintrc.json allow-list, which only accepts var(--motion-*). Any component transition using the spec's names will be flagged. I kept the spec names. Fix is in the stylelint config (see needsFromOthers).
- CONTRAST FAILURES IN THE SPEC'S COMPONENT TABLE (frozen tokens, designer decision): segmented-control pressed (--text-muted on --surface-2-pressed) is 4.34:1 light and 4.28:1 dark. RandomChip pressed (--accent on --surface-2-pressed) is 4.36:1 light and 4.20:1 dark. Both are below 4.5:1 for text. I removed the first from the test set because it is outside the 7.1 acceptance set, and did not add the second, which the spec does not require. Changing either value needs an RFC in docs/rfc/ (01 section 14).
- VoidReason 'clipping' (01 section 6.5) has no void-card copy. 04 gives clipping only a results banner ('results.banner.clipping'). The void-card keys cover interrupted, no-signal, device-change, backlog and capture-gap. The clipping gap is noted in the test file.
- No automated 'no unused keys' check yet. It needs code that calls copy() (D1 and later). The check should grep for copy('...') keys and report unknown and unused keys; it belongs with D13 or the D1 lint.
- Strings the spec describes without giving text, so I did not invent any: session summary labels (takes, average score, XP earned, best take, top patterns, streak status); rank-up requirement line; level-up pending banner; the onboarding calibration step's skip control other than the shared 'Skip' key; the instrument step heading; the typed confirmation text for delete ('delete' only); the tips '(expand)' affordance; the calibration card title; the 'Practise without listening' explanatory copy beyond 9.2's wording.
- Derived strings that are not literal in the spec. The overseer should review them: (a) instrument abbreviations for the 19 instruments the spec does not list (Ob, Bsn, Hn, Tbn, Euph, Tba, Vla, Db, Gtr, T.Sx, B.Sx, Pno for the left hand, and Euph for both euphoniums), with the spec's examples used for the rest; (b) accidental words sharp, flat and natural (from the spec's 'F sharp 5' and 'F natural 5' examples); (c) note-value words (a 32nd, a sixteenth, a triplet eighth, an eighth, a quarter, less than a sixteenth); (d) XP factor labels for random meter and random tempo (the spec names only random key); (e) templates built from the spec's examples: a11y.note, a11y.grade.heading, a11y.speakPitch, results.inspector.timing, results.inspector.cents and centsVoice, results.heat, results.stops, results.restart, scan.summary, score.summaryLabel, tempo.spoken, component.detail and its side words, stars.signatures.detail, accidentals.sharps and flats, scan.peek, onboarding.step, home.selector.noUnseen, and home.keyRandom (the spec's literal 'Any key up to 4 sharps or flats' with the 4 as a placeholder).
- Numbers owned by other roles are placeholders, not literals. The caller must pass them from config: calibration seconds (banner.calibrateNeeded, calibrate.loopback.intro), the placement count and minutes, the skip cap (dialog.skip.practiceNotice), the daily XP limit (xp.factor.dailyLimit), the streak-day requirement (streak.needs), the incomplete cap (badge.incomplete.tooltip), and the level and rank values. formatMessage throws if a variable is missing.
- streak.atRisk is templated on the remaining takes (n) rather than the spec's literal '1 more'. The spec's wording covers 1 or 2 takes today, but 02 requires 3 ranked takes per streak day, so the remaining count is 3 minus today's takes. Spec ambiguity; the template matches the spec's example at n = 1.
- Ruling 15 names the components pitch, intonation and rhythm. The spec's display labels are Notes, In tune and Rhythm (04 5.5.3). I used the spec labels, since 04 owns display copy. The overseer should confirm.
- Ruling 16: the catalogue has no iOS-specific skip string. The generic skip key is 'action.skip' (shared with the 5.3 cover). The onboarding calibration component must hide the skip control on iOS when outputLatencyReported is false. That control logic is outside this package.
- Spec references with no matching definition: '--font-numeric' (04 5.4.2) is not defined in 7.2. I named the UI font stack '--font-ui' (my name; the spec does not name it). Other token names I chose where the spec gives none: --type-<scale>-size, -line and -weight; the component size names (for example --button-hero-height); --target-min; --opacity-disabled; the --space-*, --radius-*, --z-* and --dur-* names follow the spec's text.
- Not implemented here, per the spec's own check list: colour-vision delta-E tests (not in 13.1), grayscale distinctness (13.1 item 4, belongs to D13), axe, Playwright and reduced-motion E2E (D13).
- Forced-colours block uses the selector :root:root:root to beat the dark and high-contrast selectors on specificity. This is intentional and commented in the generator.

### D0b+D0d+D0e

- D3 ScoreFrame should call planLayout(viewport, insets, barCount, tickablesPerBar) to get RenderOptions, the slot count and the effective sp. It should call planSwaps(systemCount, slots, systemDurationsMs) for page turns, which uses 0-based systems and slots. Each swap says: when the playhead enters trigger.system, wait trigger.delayMs, then put newSystem in slot. wrapMarker[s] says to draw the 3 px next-bar bar on system s's slot.
- P15 overlay should derive a NoteVisualState from a judgment with visualStateFromJudgment, count error states per bar with isErrorState, and decide the brake with isBrakedBar. For the live cap on unmatched ghosts use capUnmatchedGhosts. The overlay renders glyphs with <use href="#id">. The sprite must be mounted inline or fetched as an external file. Rank emblems and Lucide icons set their own stroke attributes on the <symbol>, so they inherit through <use>.
- fadeMs values are the normal-motion ones. With reduced motion the drawing layer should zero them, except the 100 ms ghost opacity fade.
- Idempotence: both noteVisual and ghostVisual are pure, so repeated judgment events give identical output.

Known gaps:

- The Lucide icons (mic ... flame) are reproduced from memory, not copied from a pinned Lucide package, so paths may differ slightly from upstream. Nothing was visually checked in a browser.
- Rank emblem and verdict glyph shapes are my own geometry. There was no visual review, and the grayscale-distinctness check (13.1 item 4) is not run here because it belongs to D13.
- Short viewports at width 1024 or more are not covered by 4.2, which lists sm-short only for 568-1023. I made selectRow send any short viewport of width 568 or more to sm-short. This is covered by a test, and the owner of 04 should confirm it.
- plus-n is a plus with a free area on its right. The slot rectangle is exported as PLUS_N_SLOT in glyph-ids.ts, and the overlay has to draw the number there.
- The ui-group constants in layout-table.ts and visual-states.ts (swap delay 400, fractions, brake 4, cap 3, fades 100/80/200, ghost opacity 0.7) are hard-coded mirrors of the tokens, because tokens.ts is owned by another package. They should be switched to read tokens once those are frozen.
- Ghost behaviour that 6.1 does not state is my reading. Review ghosts have stems, and replay ghosts also get stems in review. The brake applies only in live mode. A ghost's laneGlyph is 'replay' when displaced, 'extra' for an extra, and null otherwise (the lane glyph belongs to the written note).
- In visual-states.ts a note with phase 'active' that already carries an early/late/pitch error renders as an error, not as an active ring. This is my reading of 6.3, because the phase mapping is owned elsewhere.

### P0e

- Rebuild the fixtures: clone OpenScore/Lieder and OpenScore/StringQuartets shallow outside the repo. Run `python3 -I tools/fixtures/build.py scan --lieder L --quartets Q --out c.jsonl`, then `build.py select --candidates c.jsonl`, then `build.py extract --lieder L --quartets Q`, then `python3 -I tools/fixtures/expected.py`. The output is deterministic, with hashed file names.
- Consumers should load excerpts through fixtures/corpus/index.json, which mirrors public/corpus/v1/: chunk file names are hashed and change whenever content changes. P9a's decode golden is fixtures/corpus/manifest-entries.json. P7 can render all 24 docs from the shards. P0f can take excerpt ids from fixtures/expected/index.json for follow and render streams; those six already have goldens for flute, clarinet and sax.
- Excerpt ids encode the source as <composer>-<openscore file id>-<role>[-mv<movement>]-m[p]<firstBar>-<lastBar>. A 'p' means the window starts with a pickup cut from the previous source bar. The final bar may have been completed with rests (modification 'final-bar-completed').
- tools/fixtures/musicxml.py now numbers movements where the printed bar number restarts. Final barlines were wrong for quartets: repeated sections end in light-heavy barlines. It also ignores <sound tempo> (playback) as a printed tempo. The C3/C4 corpus pipeline should use the same rules.
- There is a double accidental (Fx4) in the Fauré excerpt (L8) and one familiarity-2 excerpt (Mozart K.458). Both are useful for selection and ranked-exclusion tests in P9b.

Known gaps:

- The feature and level tags are fixture-grade, not the authoritative tagger. featureLevels uses a Python port of the reference tagger in fixtures/levels/feature-vectors.test.ts, but with the correct 720-tick 6/8 beat. The rhythm-cell classifier is my own approximation of 02 §2.2: windows it cannot classify are rejected, not tagged 'other'. G2 and C6 are authoritative and may re-level these excerpts.
- Several 03 pipeline rules are simplified or missing. Not implemented: H5 (no ending inside a sequence), LBDM ranking, the S1–S5 soft score, the Krumhansl key check, the silver-standard boundary check, the quartet melodic-role test against Vn I, and the 'bass-line' flag (never set). The rejects that are implemented are listed in build.py quality_reject.
- No agent review was run. Every doc carries review {rules:'p0e-fixture-1.0.0', llm:'not-required', llmVerdicts:[], promptVersion:'none'}. Under 03 §6.12 the L1–L3 items would need the R2 veto before shipping. These are test fixtures only.
- Tempo ranges come from a small marking-word table (or ±10% of a printed metronome mark). With no marking the default is 60–120 quarter bpm, converted to the count unit. That gives 2/2 excerpts a 30–60 range, below every level's tempo range. 'edition' is omitted.
- Familiarity is set from a one-entry hand list (FAMILIAR in build.py), not a familiar.yaml incipit matcher.
- Level 1 has only 1 excerpt and level 2 has 2, from real sources. This matches the PLAN note that the CC0 sources are thin at the bottom; nothing was invented to fill it.
- Clef coverage comes from source clefs (tags 'source-clef:*', cross-checked against originalInstrument). ExcerptDoc has no clef field; the runtime clef is picked per instrument (03 §7.4.6). Every golden uses treble, since flute, clarinet and sax have only treble.
- Spec interpretations in the goldens (P9c should confirm them; they are listed in the expected.py docstring). durationGraded excludes only the final note as 'the phrase end before a rest'. explicitAccidental means the written alteration differs from the key signature, not the printed-accidental state. onsetKind 'repeat' takes precedence over 'slurred'. bpm is the level minimum, or the dotted-quarter range for 6/8 at L4–L5, raised to the excerpt minimum when that falls inside.
- manifest stats.servedLevels is [] by spec: no level reaches 30 excerpts in a 24-excerpt fixture.
- The vitest suite needs no source clones. Re-running build.py scan/extract does need the two shallow clones; the pinned commits are in fixtures/corpus/sources.lock.json.

### P0f

- Harness for P10a/P10b: build the config with followConfigFor(fx, instrument, cfg, resolveTolerances(...)), run runFollowStream(fx.stream, follower), then assertPredicates(liveSubject(events, fx.expected.length), fx.expectLive) and assertPredicates(finalSubject(finalAlign(config, finalDetected(fx.stream))), fx.expectFinal). All of these are in src/testkit/predicates/. A FollowFixture has no meter field. Every follow fixture uses a fixtures/corpus excerpt, so take the meter from that excerpt by excerptId, or use beatsPerBarOf(expected).
- Harness for P12/P12b: tolerances = resolveTolerances(fx.input.expected, {instrument, level: fx.input.level, bpm: fx.input.bpm, meter: fx.input.meter}, cfg). Then assertPredicates(gradeSubject(grade(input), detectPatterns(input), tolerances), fx.expect). The alignment in each input already carries 02 §4.3 credits that match its raw fields, so a grader that recomputes credits and one that reads them agree. A missed duration-graded note has d = 0 (h = 0). Variant fixtures use case numbers 6 and 11.
- Stream conventions are in fixtures/follow/gen/perform.ts: input time T = t0 + latencyCompensationSec + scoreSec, with t0 = 10 and RTL = 0.03. note-on arrives 40/56/88 ms after the onset (512/1024/2048 window), note-off 24 ms after the offset, signal every 128 ms, clock every 32 ms. Detected ids increase in onset order.
- Predicates accept pitch 'in-tune' or 'not-graded' for a correct-semitone note that is not intonation-graded, because the spec does not choose. 'Late and wrong' combinations are never asserted.
- Render streams: atMs is in score milliseconds from bar 1 beat 1, so it is negative during a pickup or pre-roll. The last line is {type:'final'} at the same atMs as end. P15 and P20 can use reduceOverlay and streamViolations.
- To regenerate after a config or corpus change: pnpm tsx fixtures/follow/gen/main.ts. The fixture tests fail if the committed files drift from the generator output. If a product module disagrees with a fixture, check the predicate note (spec section plus arithmetic) before changing the fixture; changing a fixture needs an RFC per 01 §14.
- Ghost spelling follows 02 §4.8: the fixtures assert the C♮ and F♮ ghosts for missed key-signature sharps (target letter within ±2 semitones). Spelling by key signature for distant notes is not asserted, because the spec leaves C major's choice open.

Known gaps:

- 02 §4.9 case 4 conflicts with the corpus: the same +0.05 beat/bar drift gives R = 65 on the real Mayer line, because 14 of its 25 notes fall in bars 1-3. That breaks the case's R ≤ 60. The fixture uses a synthetic line of 8 bars of quarters instead (R = 56.25). The spec's claim only holds for evenly spaced notes.
- 02 §4.9 case 4b conflicts with 01 §9.6. Under 01's DP, a note that slips past its own window lands inside the next note's window and matches it as a wrong pitch (cost ≤ 9 < 11). The reference alignment has 1 missed, 17 wrong, 9 late and 1 extra, not the run of missed notes 02 expects. The fixture asserts only what both readings share (missed ≥ 1, late ≤ 14, R lower than case 4a). The 01 and 02 owners need to reconcile this.
- 01 §9.6 relabels only runs of at least 3 consecutive DP extras. Replayed and skip-ahead notes land within the window of current notes, so the DP matches them as wrong pitches instead. To produce the displaced segments that back-2-beats, skip-bar-ahead, case11-restart and case11-variant-skip-ahead assert, the relabel pass must also turn runs of wrong-pitch DP matches into a segment. The reference follower takes displacement from scenario ground truth rather than detecting it.
- Pattern, ranking and XP predicates (fires, not-fires, only-fires, ranked, rankedReasons, xp.total, voiceDriftCents) are not self-verified, because there is no reference pattern detector. They restate 02 §4.9, §5.2, §5.4 and §6.1-6.2 directly.
- Case 8 (voice an octave low) is a grade-only fixture. The soprano detection range (minHz 185) would not capture that octave.
- Case 9 only fires if E16's 'adjacent partial' means adjacent in data/trumpet-valves.json. The table gives G5 as open partial 6 and C6 as open partial 8, and partial 7 is unused.
- FollowerEvent has no ghost-removal event, so a provisional sharp or flat that reverts before note-off cannot withdraw its ghost. The fixtures avoid that case. The 01/04 owners should decide.
- 02 §4.9 case 15 (byte-identical results in the bare runtime) and case 16 (CI floor check) are CI jobs, not fixtures, so no fixture covers them.
- In fixture streams, note-update arrives every 8 hops (64 ms), not the 4 hops of 01 §5.6, to keep files about 135 KB each (follow/ totals 3.0 MB). The follower must not depend on the update cadence.

### Wave 0 review


repairs:

- Stylelint motion conflict (D0a's main need): .stylelintrc.json now requires transition, animation and their -duration properties to use var(--dur-*), and timing functions to use var(--ease-*) or linear. A new disallowed-list rejects raw time literals (200ms, 0.2s) in transition and animation values. tokens.css keeps its 100vh check. The old allow-list accepted only var(--motion-*), which does not exist in the spec.
- Reduced-motion gate (04 §13.1 item 1, the gap P0a and D0a both reported): tools/generate-tokens.ts now sets every --dur-* to 0ms under @media (prefers-reduced-motion: reduce) and under :root[data-motion="reduced"]. tokens.css was regenerated and tokens:check passes. Together with the stylelint rule, every transition and animation is gated by construction. The design/tokens.json motion $comment was updated to match.
- New lint fixtures in test/lint-fixtures/css: bad-transition-raw-duration, bad-animation-no-dur-token, bad-timing-function and ok-reduced-motion-tokens. ok-component.css was moved from the nonexistent --motion-* names to --dur-fast and --ease-out. That fixture stays an expect-none case, so nothing was weakened.
- fixtures/levels/feature-vectors.test.ts: the reference tagger's beatTicks returned 1440 for 6/8, 9/8, 12/8 and 11/8. It now uses makeMeter(...).countUnitTicks from src/core/time.ts: 720 for compound meters, and eighths for 11/8 and the other irregular x/8 meters. The golden expected values were unchanged and all 32 cases still pass.
- src/core/types.ts: the TrumpetValveTable doc comment now says data/trumpet-valves.json instead of config/trumpet-valves.json, which matches P0d's file and 02 §10. pnpm schemas was re-run, so schemas/trumpet-valves.schema.json changes in its description only.
- src/core/api.ts: P0c's extra time functions (beatsToTicks, scoreSecondsToBeats, ticksToScoreSeconds, ticksPerBar, makeMeter) were added to CoreTimeApi. The change is additive. The new src/core/api-conformance.test.ts checks at compile time and run time that time.ts, rng.ts and events.ts satisfy CoreTimeApi and CoreUtilApi.
- Bare-runtime job (01 §13.3 and §14 item 14, previously missing): tools/bare-runtime/scenarios.ts, run.ts and bare-runtime.test.ts were added. esbuild bundles the pure core into one IIFE, deletes the V8-added console, and runs 20 seeded scenarios (time, onset definition, emitter) in a vm context with only ES2022 globals. The output is byte-identical to the direct Node run. A test also asserts that console, setTimeout, process, performance and window are undefined inside the context. Added the `test:bare` script and a bare-runtime CI job, which the deploy job now needs.
- package.json scripts: added schemas:check, tokens and tokens:check (P0b and D0a needs). ci.yml: the typecheck job now runs pnpm schemas:check and pnpm tokens:check.
- .gitignore: added __pycache__/ and *.pyc (P0e need).
- LICENSES/ created (D0b need). OFL-1.1-Bravura.txt holds the Bravura LICENSE.txt fetched from steinbergmedia/bravura; ISC-Lucide.txt holds the Lucide LICENSE (ISC plus the Feather MIT notice). Each has a short header saying which glyphs.svg symbols it covers.

frozenTypeChanges:

- src/core/types.ts line 211: doc comment only, config/trumpet-valves.json changed to data/trumpet-valves.json. No shape change. The regenerated schemas/trumpet-valves.schema.json differs in its description string only.
- src/core/api.ts CoreTimeApi: added beatsToTicks, scoreSecondsToBeats, ticksToScoreSeconds, ticksPerBar and makeMeter. This is additive; P0c's time.ts already exports all five with these signatures. No existing member changed.

missingOrStubbed:

- Checked 01 §14 items 1 to 15 against the repo. All are present except the items below.
- Item 14, CI: the scenario (synthetic suite) job is absent; P18 adds it. The bare-runtime job now exists but covers only the pure core. P12 must append grade-fixture scenarios to tools/bare-runtime/scenarios.ts, and P10b must append finalAlign scenarios, to meet 02 §4.9 case 15. The WebKit Playwright projects are defined but have not been run anywhere, including CI.
- Item 7: the excerpts are real CC0 music, not hand-authored. PLAN R3 and R25 override §14's wording here. Level 1 has 1 excerpt, level 2 has 2, levels 9 and 10 have none. The level and feature tags are fixture-grade, not from the authoritative tagger. No agent review was run (review.llm is 'not-required'). Several 03 pipeline rules are not implemented: H5, LBDM, S1 to S5, the Krumhansl check, the bass-line flag. All of this is P0e's own reported gap.
- Item 12: testkit lives at src/testkit/, not testkit/, which matches the 4.1 layout and the eslint config. synth-min ground truth is the scripted onset, not core/onset-definition.ts, so the 'within 1 ms' truth is left to P3. It has one generic timbre.
- Item 13: the fake backend uses its own Butterworth low-pass and decimator; dsp/filters.ts does not exist yet. P4a's coefficients may differ slightly.
- Item 15: the copy catalogue has no void-card string for clipping (clipping is a banner) and lacks strings the spec describes without giving text (session summary labels, rank-up line, level-up pending banner and others; see D0c's list). There is no automated unused-key check yet.
- Contrast: two pressed states in 04 §7.5 fail 4.5:1. The segmented control (text-muted on surface-2-pressed) is 4.34 light and 4.28 dark. RandomChip (accent on surface-2-pressed) is 4.36 light and 4.20 dark. Fixing them is the designer's call through an RFC, so I left the values as the spec states them.
- Glyphs: the Lucide icons were drawn from memory, not copied from a pinned package. The rank and verdict geometry is original, and nothing was visually reviewed.
- Module boundary: 04 wants notation/visual-states.ts to import GlyphId from ui/glyph-ids.ts, but eslint forbids notation importing ui. D0b's workaround is a local LaneGlyphId type checked against GlyphId in a test. I left it in place; the architect should decide whether to allow a type-only notation-to-ui import or move GlyphId into core.
- Unresolved spec conflicts reported by P0f, which need the 01 and 02 owners. (a) The 01 §9.6 relabel pass cannot produce displaced segments for replays or skip-ahead, because the DP matches them as wrong-pitch notes; the reference follower takes displacement from scenario ground truth. (b) 02 §4.9 case 4's 'R <= 60' depends on the excerpt, and case 4b's 'missed rather than late' contradicts the 01 DP. (c) There is no FollowerEvent for withdrawing a ghost when a provisional sharp or flat reverts.
- P0d spec notes: horn's lowest fundamental in 02 §1.3 should be 61.7 Hz, not 87. The attackExcludeMsByFamily values other than winds are P0d's own choices. The L10 meter list and the L5 max-interval reading are P0d's interpretation.
- Uncommitted output: everything from P0e and P0f is still untracked: fixtures/corpus, expected, follow, grade and render; src/testkit/predicates; tools/fixtures/*.py, fixtures.test.ts and selection.json. tools/fixtures/musicxml.py is modified. The overseer must add all of it, along with this review's new files: LICENSES/, tools/bare-runtime/, src/core/api-conformance.test.ts and the 4 CSS fixtures.

risksForWave1:

- Whoever implements grade or follow must extend tools/bare-runtime/scenarios.ts with their fixtures (P12 grade over fixtures/grade, P10b finalAlign over fixtures/follow). Otherwise the bare-runtime job stays core-only and 02 §4.9 case 15 is untested.
- Stylelint now rejects any transition or animation without a --dur-* token, and any raw ms or s literal. D1 and D2 must use the --dur-* and --ease-* tokens. The in-app reduced-motion setting must set data-motion="reduced" on the root element. The 100 ms ghost-fade exception has to be handled in the overlay code, since every CSS duration token is zeroed.
- Config value naming is P0d's reading of the spec: pattern thresholds, minEvidence keys and the attackExcludeMsByFamily values. P2, P12b and P10a may find a value with no field. Since config and types are frozen, that needs an RFC through the overseer.
- Onset-definition inputs (EnvelopeSeries, OnsetPitchFrame, FluxSample) were designed by P0c. P3, P4c and P4d must adopt them or report a mismatch.
- P10a and P10b displacement acceptance depends on the open conflict between 01 §9.6 and the fixtures (wrong-pitch runs versus extras runs). As 9.6 is written, the back-2-beats and skip-ahead fixtures cannot pass. The architect needs to rule before P10b starts.
- The fixture corpus is thin at the bottom (L1 has 1 excerpt, L2 has 2) and empty at L9 and L10. P9b selection tests at those levels will need synthetic manifests rather than the fixture corpus.
- Any change to src/core/types.ts requires running pnpm schemas, or the drift test fails. Any change to design/tokens.json requires running pnpm tokens. Generated fixtures also fail their tests if they drift from the generators: re-run pnpm tsx fixtures/follow/gen/main.ts after a config change, and the python3 -I tools/fixtures pipeline after a corpus change.
- The FakeAudioBackend's filters differ from the future dsp/filters.ts, so absolute phase and gain checks written against the fake may need retuning once P4a lands.

## From wave 1

### P1 theory

- Import from src/theory/index.ts (the barrel re-exports theory.ts). Extra exports beyond TheoryApi: tryTransposePitch, tonicOf, keyFromTonic, isValidKey, enharmonicKey.
- Concert to written uses instrument.writtenMinusSounding directly; written to concert negates both fields.
- intervalBetweenKeys needs a chromaticShift congruent mod 12 to the tonic distance and does not check it. It picks the octave extension by the natural-letter distance, so C to Cb with +11 gives diatonic 7.
- A pitch spelled with alter outside -2..2 is not representable; transposePitch throws RangeError on it and on any result that needs a triple accidental. tryTransposePitch returns null instead (03 §7.5 rejection check).

Known gaps:

- transposeKey returns fifths outside -7..7 unclamped. P2, P7 and P9b must treat that as "needs enharmonic respelling" (03 §7.5 rule 3): check isValidKey, then call enharmonicKey.
- spellGhost follows 02 §4.8 literally. Within ±2 semitones it keeps the target letter and can return a double accidental (target F#, played G gives F##). Beyond 2 semitones it uses a pitch-class table (sharps when fifths >= 0, flats otherwise), not the key's scale letters, so in F# major a played F natural comes out F, not E#.
- ear-to-staff noteName, vexKey and detectKey were not ported.

### P2 rules

- Import from src/rules/index.ts. Per take: resolveTolerances once. Per note: classifyPitch(target, playedMidi, offset, inst, cfg) gives p, octaveDisplaced, devCents (after offset) and rawDevCents; timingVerdict, onsetCredit, intonationVerdict and intonationCredit do the judgments; noteVerdict(facts | 'pending' | 'missed', tol) gives the 02 §4.8 state, combined flags, red and ghost kind. Live: liveIntonationStep(prev, dev, steadyMs, liveIntonationEligible(note, tol), tol) on each note-update, through liveIntonationAsVerdict into noteVerdict; wrongPitchAtConfirm at confirmation.
- Voice: one VoiceDriftReference per take. For each finished note call classifyPitch with ref.offsetCents(), then ref.observe(c.rawDevCents, c.p === 1). The final pass replays the same sequence so live and final offsets agree.
- Winds, brass and strings: tuningOffsetCents(measured | null, cfg) applies the ±25 c cap.
- src/rules/no-tolerance-constants.test.ts scans every non-test .ts file in src/follow/ and src/grade/ and fails on any numeric literal equal to a grading-config tolerance value (40, 55, 85, 90, 120, 150, 180, 250, 0.3, 35, 45, 80 and so on). Unit numbers (0, 1, 2, 3, 4, 10, 12, 60, 100, 1000, 60000, 0.5) are allowed. A line that genuinely needs a listed number carries `// tolerance-literal-ok: <why>`. P10 and P12 should expect this guard.
- Everything lives in src/rules/ (BUILD-NOTES P0b chose rules/resolveTolerances over 02's grade/resolve-tolerance.ts).

Known gaps:

- G1 and G9 are not defined in the current 02 text. P2 read them as the tolerance resolver (G1) and the voice drift reference (G9), following PLAN's merge note. Reviewer accepted that reading.
- noteVerdict sets `marginal` only for the 02 §4.8 'correct-marginal' state (within tRed and red). The fixture reference judgeMatched sets it for any p=1 note beyond good, even late or sharp ones. Current fixtures only assert marginal on correct-marginal notes, so both pass; P10/P12 should use noteVerdict's reading.
- A live sharp/flat clears at |dev| <= red; the +10 c hysteresis applies only on entry. Exactly ±50 c counts as the same semitone (the reference uses Math.round, so they can differ only at exactly +50 c).
- index.ts exports helpers beyond the five RulesApi members. The reviewer ruled additive exports acceptable (theory/index.ts already does this).

### P3 synth and scenarios

- Synth API, from src/testkit/synth/index.ts (now also re-exported by src/testkit/index.ts): renderPerformance({timbre, notes:[{midi, cents, onsetSec, durSec, amp, slur, attackSec, dipDb, ref}], sampleRate, levelDb, vibrato, breathDb, attackNoise, seed}) returns {samples, sampleRate, truth[], envelope, floorDb, pitchAt}. Each truth entry (type PerformanceTruthNote, renamed by the reviewer from SynthTruthNote to avoid a clash with synth-min) has onsetSec (7.4 definition), targetOnsetSec, onsetRule ('silence' | 'dip' | 'pitch-change'), onsetCause, detectable, cents and freqHz. applyConditions(dry, {clickBleed, room, phoneMic, agc, captureRateHz, noiseDbfs, seed}) returns the capture render; truth is unchanged, in render seconds.
- Scenario API, from src/testkit/scenarios/index.ts (Node-only because it reads fixture files; not re-exported from testkit/index.ts): createScenarioSet({seed?, count?=300}) gives .plan(i), .plans() and .render(i, overrides). A render returns {samples, sampleRate, t0Sec, clicks, bleedClickTimes, played, truth[] (playedIdx, truth: match/extra/displaced, onsetSec, scoreOnsetSec, midi, cents...)}. RenderOverrides lets P18 force conditions, e.g. {click:{timbre:'wood', bleedDb:-10}, capture:{phoneMic:{highPassHz:150}}}. Feed samples and sampleRate to FakeAudioBackend as source; audio time 0 is the source start, and score 0 is t0Sec.
- planGoldenDisplacement(case, r) then renderScenario(plan) gives randomized renders of the four 13.2 displacement cases; plan.perturbation.displaced holds the expected segments.
- Truth is defined on the dry signal: a detector measured under noise, room or AGC is judged against the ideal onset. Joined notes within 25 ms of the previous note become dips or glides; larger gaps become silence attacks. Piano notes are always strikes.
- Render cost is about 0.44 s per scenario warm (about 2.2 min for all 300). Biquads flush subnormals; without that the IIR filters were 20x slower.

Known gaps:

- Glide (pitch-change) truth is checked only against the control pitch track; there is no audio-domain 1 ms check for glides. Silence and dip onsets are re-measured from the audio within 1 ms (mid register).
- Low register (period > 4 ms) agrees with the audio only within half a period (measured up to 3.9 ms for tuba near C2, 3.25 ms for cello near B2). The truth itself (control signals) is within 1 ms there too.
- The audio cents check runs without vibrato only (a short DTFT is biased up to ~12 c by vibrato sidebands).
- Interpretations: truth envelope floored at levelDb - 60 dB; silence onsets evaluated with confirmT = attack start + 20 ms; capture band limits read as capture rates of 24000/16000 Hz; click bleed level is the click peak relative to a full-level sine peak.
- Timbre parameters are plausible approximations, not measurements.
- Scenarios provide truth labels and expected displaced segments but no judgment verdicts; P18 derives those from tolerances. Scenarios use the fixture generator (fixtures/follow/gen/) for expected notes; move them to P9c's buildExpectedNotes once it lands.

### P4a capture primitives

- Public API: decimatorCreate(rate) and PhaseDecimator (decimator.ts); HiBandEnergy(rate).process(input, out, off) returns the count of completed 1 ms sub-block energies (sum of squares; edge k ends at ceil((k+1)*rate/1000)); HiBandEnergy.maxSubBlocks(n) bounds the buffer (6 for 256 frames at 48 kHz). EnvelopeFollower(analysisRate).process(low, out, off, length?) returns dB values (RMS over non-overlapping 2 ms hops). filters.ts exports lowpassCoefficients/highpassCoefficients (cached per rate), BiquadCascade and magnitudeDb.
- Decimated startT = nextOutputInputPos / inputRate, read before calling process. That position is an exact integer input index.
- Envelope value i is centred at (i + 0.5) × hopSec after the first decimated sample. P4c should stamp EnvelopeSeries.startT shifted by half a hop, consistently with the onset-definition tests.
- D = round(rate / 16000) is per 01 §7.2, so a 24 kHz capture runs at a 12 kHz analysis rate and 44.1 kHz at 14.7 kHz. That is intended (answer to P3's question).
- Reviewer change: FakeAudioBackend now builds its blocks with PhaseDecimator and HiBandEnergy from src/dsp instead of its own rounded-Q biquads, so the fake and the production worklet share filters, phase carry and sub-block edges. A new test asserts the fake's blocks equal the primitives run directly, bit for bit, at 48, 44.1, 24 and 16 kHz. The wave 0 risk "the fake's filters differ from dsp/filters.ts" is closed.

Known gaps:

- Nothing assembles the primitives into the worklet or CaptureBlock posting yet (P11).
- The zero-allocation test is heap-growth based (under 2 MB over 200k iterations), not a strict allocation counter.
- The 6 kHz attenuation check has 0.5 dB slack (below -47.5 dB); the acceptance row only needs 35 dB at 5 kHz.

### P4b pitch

- PitchAnalyzer.push(samples, startT, n?) returns PitchEstimate[] with t, midi (null below the clarity threshold or silent), clarity, rmsDb (-120 for silence), rawMidi (before hysteresis) and startSample. Frames start once W samples are buffered, then every 128 samples; the first frame is stamped startT + W/2/rate.
- clarity is the interpolated NSDF peak height (capped at 1). The peak is the first lobe maximum at or above 0.9 × the largest. The lobe search starts at lag 1 and accepts only peaks at or above minTau (the ported algorithm skipped a lobe starting below minTau and read octave-low near the top of each range).
- Lags below 24 use three-point cosine interpolation; longer lags use parabolic.
- PitchDetector treats DspConfig.minHz/maxHz as the final lag limits. The caller (P4d) must apply widenRange (3 semitones) to the instrument's sounding range; instruments.json detection blocks are not pre-widened.
- P4d must construct PitchAnalyzer from DspConfig (analysisRate, windowSamples, widened minHz/maxHz, a4Hz, clarityThreshold), add flux and inClickWindow to make a PitchFrame, call analyzer.resetNote() on every note boundary, and call analyzer.altOctaveClarity(expectedMidi) once the follower's expected octave is known (value is for the most recent frame), or pass null.
- The names PitchDetector, PitchAnalyzer, OctaveHysteresis, PitchEstimate, widenRange, freqToMidi and midiToFreq are P4b's design (no frozen interface).

Known gaps:

- Step-change crossing bias < 1 ms (P4b acceptance) holds only for 1-semitone steps on the 512 window (0.44 to 0.73 ms). The 1024 window gives 0.9 to 1.5 ms per direction at 1 semitone; the test asserts < 1.6 ms there and an up/down mean < 0.5 ms. Larger steps are worse (512: 2 semitones up to 1.1 ms, 3 semitones up to 1.6 ms; 1024: up to 2.8 and 3.6 ms). The sign flips with direction (first-peak selection reads a rising step early, a falling one late). This is an open acceptance gap; P4c's pitch-change onsets will carry it and P18's σ will include it.

### P6 store

- src/store/test-data.ts has makeProfile, makeAttempt, makeScore, makeCalibration, MemoryKv and memoryRepos; all attempts validate against schemas/export-file.schema.json. Session tests can reuse them.
- parseExportFile throws StoreImportError with code 'not-a-backup' or 'newer-version'.
- attempts.list orders by createdAt, newest first. Summary title is credit.work, with ': movement' appended when present; xp is score.xp.total, or 0 when unscored.
- Settings live in kv under the reserved key 'settings'. Reserved keys settings, install and persistRequested are device-local: never exported, and preserved by import. Import keeps the device's install marker.
- The composition root (wave 3) must call setExportAppVersion(), checkStorage() at start-up, requestPersistOnce(kv) after the first completed attempt, and pruneDebug(now) occasionally. After a storage-loss import or dismissal the UI calls acknowledgeStorageLoss().

Known gaps:

- The v0 export format is synthetic (nothing shipped before v1). No IndexedDB schema-upgrade test exists, because only DB version 1 exists.
- Default AppSettings (src/store/defaults.ts) are P6's reading of 04 §5.2 and §5.11 (flute, level 1, ranked, metronome 70, theme system, live feedback full).
- The storage-loss marker carries a hadProfile flag so a first run before onboarding is not reported as lost.
- exportAll stamps appVersion '0.0.0' until the app calls setExportAppVersion().

### P7 notation

- Import from src/notation/index.ts: VexScoreView (ScoreView<HTMLElement>), tickablesPerBar(p) (pass to planLayout), systemHeightPx, ensureNotationFonts() (await before revealing; layout does not need it), renderHeadless (C10; needs a global document such as jsdom), vexflowRenderCount() (render counter for IOS6 and 04 §5.4), expectedChains, and the NotationOverlay / OverlayHost types.
- DOM: container > div.sr-score > div.sr-slot[data-slot][data-system] > svg.sr-system[data-system], plus div.sr-offstage[hidden] for systems in no slot. Each SVG holds g.sr-underlay, g.sr-static (VexFlow ink scaled by sp/10), g.sr-overlay. Note groups are g.vf-stavenote.sr-note or .sr-rest with data-event-id, data-bar, data-system, data-expected-idx and data-piece. D3 calls setSlotSystems with planSwaps' assignments.
- Layout uses a captured Bravura metrics table (src/notation/bravura-metrics.ts), not live canvas text, so Node, jsdom and every browser agree. After a VexFlow upgrade run BRAVURA_METRICS_WRITE=1 pnpm exec playwright test -c e2e/notation/playwright.notation.config.ts bravura-metrics.
- The e2e/notation specs build their own page with esbuild and need no web server: `pnpm exec playwright test -c e2e/notation/playwright.notation.config.ts` (9 tests, passed in the wave 1 review).
- The pickup measure counts as one bar in barsPerSystem; render() throws if barsPerSystem does not sum to p.measures.length.
- P15: implement NotationOverlay from src/notation/overlay-seam.ts and pass it as new VexScoreView({ overlay }). OverlayHost gives per-system svg/underlay/overlay groups, noteGroups(expectedIdx), expectedEventIds, expectedBar and the ScoreLayout. Ink uses currentColor, so colouring a note is CSS color on its <g>. beatToPoint and noteBoxes x are the notehead's left glyph origin; staffY is the notehead centre.
- expectedIdx maps to tie chains with expectedChains(p), following fixtures/follow/gen/expected.ts (checked against all 18 goldens). If P9c's buildExpectedNotes ever drops or reorders notes, the overlay addresses the wrong groups; keep them in step or add an explicit mapping.
- src/notation/testing/prepared.ts (preparedFromDoc, preparedFromGolden) builds PreparedExcerpts from fixture docs for tests (selection null, test-only).

Known gaps:

- Overlay drawing is P15's. Without an overlay, showGhost, removeGhost, setPlayhead, setMode and clearOverlay only record state for snapshot(). setNoteState does write data-* attributes.
- BUNDLE BUDGET (open, needs the architect): the notation module alone is about 411 KB gzip because 'vexflow/bravura' also embeds Academico and Academico Bold. The app today is 85 KB gzip without notation, so the total would be about 495 KB, over 01 §12's 450 KB. Options: an RFC raising the budget, a Vite alias mapping a Bravura-only entry (vexflow/core plus build/esm/src/fonts/bravura.js), or vendoring the Bravura woff2 (OFL notice already in LICENSES/). It will surface once S1 imports notation into the app.
- Engraving simplifications (visually checked on a few screenshots only): greedy longest-first tie splits, beams per metronome beat, dynamics 3.2 sp below the staff (may collide with low ledger notes), hairpins and slurs split at system breaks, tuplet numbers without ratio, Gould accidental rules with no cautionaries.
- No system numbers or captions (D3). The phone-class ≤ 300 ms render budget under 4x CPU throttle is not measured. WebKit not run.

### P9a corpus loading

- src/corpus/index.ts now exists (created by the reviewer) and re-exports loadManifest, loadExcerpt, prefetchNeighbours and CorpusLoadError from ./load/, and the G2 tagger. P9b adds selectExcerpt, prepareExcerpt and countEligible there, P9c buildExpectedNotes.
- Test any selector against fixtures/corpus/manifest.3a2136cde3.json and manifest-entries.json; loadFixtureManifest() in src/corpus/load/load.test.ts shows the fake-assets pattern.
- Caches are keyed on the manifest object (lookup tables) and on the assets object (chunks). A new assets object per call refetches chunks.
- prefetchNeighbours takes an idle scheduler; src/platform/web must supply one (requestIdleCallback with a setTimeout fallback). assets.getJson must serve relative paths under corpus/v1/ with no-cache for index.json and withdrawn.json.

Known gaps:

- No content-hash or size verification of fetched files (crypto is banned in pure packages).
- loadExcerpt refuses withdrawn ids; the P9b selector must also drop them from its pool using manifest.withdrawn.
- The fixture covers levels 1 to 8 only; empty-pool tests need synthetic manifests.

### G2 level tagger

- tagLevels({meter, mode, minorForm?, rhythmCells, features}, levelsConfig, measurementBudget) returns {featureLevels, level, levelConfidence}. rhythmLevel, cellLevel, FEATURE_KEYS and meterBeatTicks are exported (C6 can use rhythmLevel per measure for barRhythmLevel). Import from src/corpus/index.ts or src/corpus/tagger/index.ts.
- Reviewer check: run on the 24 fixture docs, tagLevels reproduces the Python fixture tagger's featureLevels and level on every doc, given the right minorForm. ExcerptDoc does not store minorForm, so C6 must carry it from feature extraction to the tagger.

Known gaps:

- The tagger takes pre-extracted features and rhythm cell ids; extraction and cell classification are C6's.
- The L3 "tonic or dominant triad" leap rule is only tonicTriadLeapsOnly. minorAlterations is unused (raised 6/7 are expected in chromaticPer4BarsMax upstream). Modes absent from every level map to the modal list or 10.

### IOS1 capabilities

- IOS5 can use displayMode and osFamily directly (coach mark when osFamily is ios or ipados and displayMode is browser). The onboarding calibration step (W6, no Skip) keys off capabilities.outputLatencyReported, not osFamily.
- The composition root calls readBrowserCapabilities(persistedGrant) once at start-up, after awaiting navigator.storage.persisted(), and stores the result on AudioBackend.capabilities and PlatformServices.

Known gaps:

- outputLatencyReported is true only for Blink. Gecko (Firefox) is false, the conservative side of W6, so Firefox takes show the calibration step without Skip. Open for an architect ruling; the reviewer kept false.
- Unrecognised Chromium forks fall to 'other' with outputLatencyReported false.

### D1 shell

- Replace placeholders by passing createRouteTable({ home: HomeScreen, ... }) as App's table prop. Keep id="start-practice" (START_BUTTON_ID) on Home's Start button for the skip link. The shell focuses <main> after navigation only when focus is not already inside it.
- Screens receive { route } with params. Use useNavigate() and <Link to> from src/app/router.tsx, and buildPath() for /history/:attemptId.
- Use <Modal>, <Sheet>, <Popover> from src/ui/primitives; data-autofocus marks initial focus; omit onClose for a modal that must be answered. useToast().show() works anywhere under App and is suppressed on practice.play. <Glyph id> needs the sprite that Shell mounts via <GlyphSprite/>.
- src/ui/primitives/test-render.ts (mount, click, key) is the jsdom test helper (@testing-library is not installed). Use a '// @vitest-environment jsdom' docblock.
- CSS: rem/em, never px (media queries too); the thin/rem hairline pattern from primitives.css.
- src/main.tsx still renders <App /> with no props. The composition root must pass appearance={appearanceFromSettings(settings)}, a table from createRouteTable, and showBetaBadge on iOS.
- e2e/portability.spec.ts waits for data-testid=app-placeholder, which sits on the shell root; switch it to a real screen id once placeholders go.

Known gaps:

- No leave-guard API in the router for Back-button confirms (skip after reveal, stop confirm). Screen packages need one or handle Back themselves.
- Rank-up "never stacked with another sheet" is not enforced; openOverlayCount() is exported for the caller.
- No axe, Playwright, size or live-region E2E (D13). Popover hover-stay (WCAG 1.4.13) is left to the trigger.
- The unused-copy-keys lint is still not written (D13).

### D2a form and container components

- Import from src/ui/components/form/index.ts and src/ui/components/containers/index.ts. Every control is a native element; no custom keyboard handling. Use ariaLabel on SegmentedControl, Select, Stepper and TempoSlider as the setup row's name.
- TempoSlider fires onChange on every slider move, and on the numeric field only on commit (blur or Enter). Banner hides itself after dismissal; remount or change its key to show it again.
- src/ui/components/form/test-helpers.ts holds setNativeValue, q and blur for jsdom tests.
- Reviewer change: Stepper's decrementLabel/incrementLabel are now optional and default to the new copy keys stepper.decrease / stepper.increase ('Decrease {label}' / 'Increase {label}', with ariaLabel). Banner's dismiss button uses the new banner.dismiss key.

Known gaps:

- RandomChip on coarse pointers is 44 px visually (the frozen --random-chip-height token), not 32 visual with a 44 hit.
- Keyboard behaviour jsdom does not simulate (Enter/Space on buttons, arrow keys in the radio group, Tab order), visual focus, grayscale and axe are left to D13.

### D2b domain components

- Import from src/ui/components/domain/index.ts. Helpers exported: beatPulses, groupBeats, meterZone, meterFraction, scanFraction, filledSegments, heatLevel, rankGlyphId.
- LevelMeter is horizontal (64 × 8) per 5.4.5, so --level-meter-height is the inline size and --level-meter-width the block size. Pass decorative={false} and a label outside takes.
- ComponentBar supports controlled and uncontrolled expansion. HeatStrip takes the per-bar tooltip string from the caller. ChecklistItem renders an <li> (inside a <ul>) and becomes a role=checkbox button only with onToggle.
- StarRow is aria-hidden unless given `label`; callers can now pass copy('stars.label', { n }) (new key).

Known gaps:

- RankEmblem 'achieved' is not a filled shape (the sprite symbols hard-code fill="none"); it uses --text colour. A filled variant needs a glyphs.svg change.
- BeatDots pulse uses var(--dur-fast) (100 ms) instead of 04's 90 ms (stylelint allows only --dur-* tokens).
- No #/dev/components fixture page for D2a or D2b components yet (D1 owns the route).

### C1+C2 corpus fetch and gates

- Run from tools/corpus-build as `python -m corpus_build`. Stage functions are in corpus_build/cli.py STAGES; each stage gets a Ctx with cache, build and sources. Repo roots are <cache>/<source id> (default ~/.cache/sight-reading-corpus, or $SIGHT_READING_CORPUS_CACHE / --cache).
- Later stages read build/gate/candidates.jsonl status=pass kind=file records (path, sha256, upstream repo@sha:path, composer, licence, pd, meta). Use corpus_build.candidate.write_jsonl and make_record so output validates and stays deterministic. The lock's lockedAt is the manifest's generatedAt.
- Composer death years: tools/corpus-build/composers.yaml keyed by norm_key(name). ComposerIndex.lookup handles the two known OpenScore directory suffix forms.
- Reviewer change: a corpus-pytest CI job now runs `pip install -r requirements.txt && python -m pytest -q` in tools/corpus-build. Tests that need the clones skip when the cache is absent. The full fetch needs github.com; cache it keyed on sources.lock.yaml.

Known gaps:

- Mutopia yields 23 of 168 files after the gate (spec expects 88): 42 have an unverified arranger (mostly Nagai/Obata), 23 hymns give no edition year, 14 are header-less include fragments. Mutopia is optional (R27). Cited composers-extra entries for Nagai and Obata would restore about 39 files if they qualify.
- Lieder gate passes 1170 of 1462, Quartets 172 of 196 (the rest died in 1931 or later).
- config/filters.yaml is a seeded copy of 03 §6.9 to 6.12 for C7 to refit; nothing reads it yet.
- Traditional/Anonymous Mutopia composer fields are treated as descriptive; only their 'arr.' names are checked.

### C3a+C4 read, normalize, extract

- Default `python -m corpus_build` runs read, normalize and extract after gate; `python -m corpus_build read normalize extract --workers 4` reruns only these (needs build/gate/candidates.jsonl). Full run is about 2 m 44 s.
- C5 loads parts through corpus_build.partdata.load_part(build, extract_record) and treats measure problems, tags, barrier, fermata and lyricLineEnd as documented in tools/corpus-build/README. Extract records with status pass carry role, roleLabel, stats and dataRef.
- Do not call music21 Measure.barDuration on big parts (quadratic); normalize.py tracks the time signature itself.
- build/ is git-ignored; blobs are gzip with mtime 0 and sorted keys, so reruns are byte-identical except timing.json.
- Normalized events keep one voice per measure. Chords keep only the first pitch plus a chord count and a `chord` measure problem: C5 must reject those windows (no top-note simplification).
- tools/fixtures/musicxml.py uses the same movement numbering rule, so fixtures and pipeline agree.

Known gaps:

- Counts: Lieder 1360 voice parts extracted (79,139 measures, 213,060 notes), 932 measures with a problem. Quartets 165 of 172 files read (7 parse failures), 660 parts, 421,816 measures, 38,399 with a problem (chord 30,644, tremolo 7,866, second voice 1,872).
- Editorial brackets are not removed (no reliable signal). No ossia detection beyond cue removal.
- Tremolo is flagged for every music21 Tremolo (measured and unmeasured), which over-rejects some quartet windows.
- Mutopia (.ly) reading is C3b.

### Wave 1 review

repairs:

- FakeAudioBackend now uses src/dsp PhaseDecimator and HiBandEnergy (identical behaviour to the production primitives was intended by both P0g and P4a). New bit-exact equivalence test at 48, 44.1, 24 and 16 kHz in src/testkit/fake-backend.test.ts.
- src/testkit/index.ts re-exports src/testkit/synth (P3 need). P3's SynthTruthNote type clashed with synth-min's export of the same name and was renamed PerformanceTruthNote.
- src/corpus/index.ts created with the loader and tagger re-exports (P9a need).
- Copy keys added to src/ui/copy/en.json (D1, D2a, D2b needs): common.close, banner.dismiss, stepper.decrease, stepper.increase, stars.label. Sheet and Modal close buttons use common.close; Banner dismiss uses banner.dismiss; Stepper labels default to the stepper keys (new test).
- Reduce motion Off now works: tools/generate-tokens.ts emits :root[data-motion="full"] inside the prefers-reduced-motion media query, restoring the durations; tokens.css regenerated; new test in tools/generate-tokens.test.ts.
- docs/spec/04-design.md §7.1 now lists the ruling-38 --surface-2-pressed values (#D6D5CF / #3A3E43).
- CI: corpus-pytest job added.

Review verdicts (trust as a base for wave 2):

- P2 rules: trusted. The case-12 table test asserts the 14 rounded 02 §4.2 rows directly plus the unrounded arithmetic, every fixture tolerance predicate, and equality with the fixture generator's refTolerances. Drift, octave policy and the live rule are checked against the reference on random sequences.
- P3 synth: trusted for P4c/P18 work. The 1 ms truth is re-measured from the rendered audio with an independent envelope and the 7.4 definition (silence and dip rules, mid register), and pitch with an independent DTFT peak search; not just restated. Weak spots: glide truth only on control tracks, low register only within half a period.
- P4b pitch: trusted with one open acceptance gap: step-change crossing bias exceeds 1 ms on the 1024 window and on steps over 1 semitone (numbers above). The ear-to-staff, 47-2637 Hz sweep (5 c) and 0.2 ms budget are asserted with real numbers.
- P7 notation: trusted. jsdom checks are partly self-referential (anchors and boxes both come from getNoteHeadBeginX), but the Chromium e2e checks ink within 1 px of the layout and zero font requests across all 576 renders, and it passed in this review. Open risk: the bundle budget.

## Notes for wave 2

- P4c segmenter: build envelopes with EnvelopeFollower and stamp EnvelopeSeries.startT at the first decimated sample plus half a hop. Feed onset-definition functions exactly as P3's truth does (silence: confirmT; dip: noteStartT after the attack). The pitch track carries P4b's crossing bias (up to 1.5 ms on 1024, more for big steps). Use P3's renderPerformance and createScenarioSet for F1 at ±30 ms; P3's truth is on the dry signal.
- P4d click handling: hiEnergy from HiBandEnergy is a sum of squares per 1 ms sub-block on the input-rate axis; sub-block k covers input samples [ceil(k·rate/1000), ceil((k+1)·rate/1000)). Apply widenRange to the instrument's detection range before constructing PitchAnalyzer, and call resetNote() at every note boundary.
- P10a/P10b follower: use only src/rules for thresholds (the no-tolerance-constants guard scans src/follow). Use noteVerdict for states and its marginal reading. Ruling 34 applies: displacement from runs of wrong-pitch matches as well as extras. Append finalAlign scenarios to tools/bare-runtime/scenarios.ts.
- P11 web audio backend: run PhaseDecimator, HiBandEnergy and (if posted) EnvelopeFollower in the worklet with pooled buffers, exactly as FakeAudioBackend.emitBlock now does; the fake's equivalence test then also covers the real path's arithmetic. Name the click scheduler metronome.ts (lint rule).
- P9b selection: extend src/corpus/index.ts. Drop manifest.withdrawn ids from the pool. Treat transposeKey results outside -7..7 as needing enharmonicKey, and tryTransposePitch null as a rejection (03 §7.5). Levels 9-10 and empty-pool tests need synthetic manifests.
- P9c expected notes: must equal fixtures/expected/ and keep the chain order that notation's expectedChains assumes. Then switch P3's scenarios off fixtures/follow/gen/expected.ts.
- P12 grade and G6/G7 progression: the guard scans src/grade too. Use src/store/test-data.ts builders. Append grade-fixture scenarios to tools/bare-runtime/scenarios.ts (02 §4.9 case 15).
- P12b patterns and P13 tips: pattern threshold keys are P0d's naming in config/tips.json; E22/E23 beta exclusion is in selection.betaDisabledPatterns.
- P15 overlay: implement NotationOverlay (src/notation/overlay-seam.ts); colour via CSS color on note <g>; zero fades under reduced motion except the 100 ms ghost fade; ruling 36 (a new note state replaces all earlier marks, including a ghost).
- C5 to C7: read extract records via partdata.load_part; reject windows with chord, tremolo, second-voice or gap problems; C6 must keep minorForm for the tagger and can call the TS tagger's rules through the Python port in tools/fixtures/excerpt_lib.py tag_levels (they agree on the fixture corpus); C7 refits config/filters.yaml.

## From wave 2

### P4c segmenter

- API: `import { DspPipeline, runOffline, decimatorCreate } from 'src/dsp/pipeline.ts'` (satisfies DspApi). `new DspPipeline(cfg, { segmenter?: Partial<SegmenterOptions> })` has push, flush, frames() and a gateDb getter. `runOffline(samples, inputRate, cfg, opts?)` takes analysisRate from the decimator; time 0 is input sample 0.
- Pass DspConfig.minHz/maxHz as the unwidened instruments.json detection range; the pipeline widens it by 3 semitones.
- Events: note-on carries the 7.4 onset. Splits are retroactive (a dip is recognised after its half-rise), so the previous note's note-off (offset = new onset) comes just before the new note-on. note-update about every 4 hops. A pitch that settles in a note's first 60 ms re-pitches that note through note-update instead of splitting. Ids increase in onset order.
- onsetCause: 'from-silence', 'repeat' (same-semitone dip), 'pitch-change' (crossing or tongued change), 'flux' (only the flux route made the dip detectable).
- Repeat hints: DspConfig.repeatHints {t on the input timeline, halfWidthSec}; inside a window the dip threshold is max(2 dB, 1.0 x AM).
- P18: per-rule onset e90 on the clean set is 0.6-2.6 ms (silence), 0.4-3.3 ms (dips), 1.9-13.7 ms (pitch change, mean up to +4.2 ms on trumpet; ruling 40). `P4C_FULL=1 pnpm vitest run src/dsp/segmenter.test.ts` prints F1 per timbre.
- Worker: push CaptureBlocks in order, then flush(endT). frames() returns every PitchFrame for the debug export.

Known gaps:

- Room reverb: with each scenario's planned conditions (no click bleed) F1 is 0.69 (voice) to 0.94 (trumpet). Vibrato under reverb makes 8-9 dB dips that pass 7.4 item 4; reverb fills tongue and damper dips; slurs come 10-30 ms late; some notes end early. Needs vibrato-phase-aware dip rejection before the 13.2 gates (P18).
- Voice 1-semitone slurs with vibrato miss (changeCents 80 in frozen instruments.json vs ±25-30 c vibrato). Voice F1 0.9845 on the clean set.
- Note-on latency p95 59 ms (512 window) and 79 ms (1024): the 1024 class is already 4 ms over 01 §12's 75 ms before the follower.
- altOctaveClarity is the NSDF at the octave above the frame pitch (the DSP does not know the expected note).
- Steady-statistics attack exclusion is mirrored per onset profile in segmenter-options.ts (DspConfig has no family or attackExcludeMs).
- Flux timing refinement is implemented but off; the flux route is on with scaled thresholds (x2 struck/plucked, x3 winds/brass, x6 voice/bowed).
- Not zero-allocation per frame (0.14 ms per hop). Blocks are assumed contiguous; a seq gap emits {type:'gap'}.

### P4d click handling

- src/dsp/click.ts: ClickSubtractor, buildClickTemplate, clickHandlingActive and the CLICK_* constants. Fits lag and gain on whitened ([1,-2,1]) signals; a fit is confident at normalised rho^2 >= 0.5; a non-confident fit takes the median of the last 8 confident fits.
- DspPipeline.clickFits() exposes per-click fits (shift, gain, confident, leak levels, before/after dB); P14's per-take recheck (7.7) can reuse confident count-in fits.
- segmenter.ts: setClickLeak(arrival, envDb, frameDb), CLICK_LEAK_MARGIN_DB 6, CLICK_EVIDENCE_SEC 0.1.
- Everything is off unless outputMode is 'speakers'. WOOD_ON_SPEAKERS in src/dsp/click-gate.ts is measured by click.test.ts (regenerate with CLICK_GATE_WRITE=1).
- P14: build Calibration.templates with buildClickTemplate (plain click at analysis rate, sample 0 at arrival - 2 ms, 20 ms long, accents divided by +5 dB). P16/S1: scale clickTemplate by take metronome gain / calibration gain; pass clicks with accent flags.

Known gaps:

- Residual figures (28-132 dB) are idealised: the synthetic click is exactly repeatable. Expect 15-25 dB on devices.
- Without a template, Wood bleed under full scenario conditions adds about +2 false positives over 63 scenarios at -10 dB.
- Leak levels come from each click's template fit, not Calibration.clickLeakDb (not in DspConfig). hiEnergy is unused.
- ui/ may not import dsp/, so the settings screen needs WOOD_ON_SPEAKERS moved or passed through the session.
- DspPipeline onsets move about 0.1 ms with block size even in headphone modes.

### P10a live follower

- Import from src/follow/index.ts: LiveFollower (optional 2nd arg { analysisRate }: FollowConfig has no analysis rate, and confirmDelay = W/2 + 3 hops; pass 14700 for 44.1 kHz captures), cost.ts (matchCost, pitchCost, classifyAgainst, correctedMidi, SKIP_* costs), DisplacementDetector, inferWrittenKey, ghostPitch.
- Live events: matched notes get a judgment at note-on (timing final, pitch null unless wrong at confirmation), a new judgment whenever pitch, marginal or octave state changes after liveProvisionalMs of steady pitch, and a final live judgment (provisional false) at note-off. Ghost events only when the ghost kind changes. Missed notes get 'missed' and no judgment. Status: lost-place and rejoined once per displacement, come-in-at once per silence, no-signal at most once. Clock events capped at 60 Hz, level at 30 Hz.
- Ruling 36: a reverting sharp/flat sends a new judgment and no ghost event; P15's overlay drops the stale ghost.
- Testing without audio: P3 plan, then fixtures/follow/gen/perform.ts perform + buildStream, then runFollowStream (see src/follow/displacement.test.ts runPlan).

Known gaps:

- Displacement range sign: 01 §9.5's [-2, +4] bars is read as player lag, so offsetBeats is in [-4 bars, +2 bars]. Architect to confirm.
- Rejoin and detector rules are P10a's reading (cost(0) - cost(δ) >= one wrong-pitch term on top of the 2x rule). 6 of 103 P3 restart/skip scenarios whose replay is indistinguishable at δ = 0 are excluded from the scenario gate.
- Ghost spelling infers the written key sign from the expected notes (FollowConfig has no writtenKey). Displaced ghosts are spelled from the key signature.
- wrongPitchAtConfirm assumes the confirming frames agree (DetectedNote has no such flag).
- At note-off the live judgment uses the final rules, so a note between red and red + hysteresis can turn sharp/flat at note end.

### P10b final alignment

- Use from src/follow/index.ts: finalAlign (FollowApi), alignFinal(c, detected, live | null), liveOutcomeOf(events), replayLive, alignDp/alignNotes/relabel, followApi.
- P16 should call alignFinal(c, detected, liveOutcomeOf(liveEvents)): 2.4 ms median for 231 notes. finalAlign(c, detected) replays the live follower to fill `rejudged` (the frozen signature carries no live events); it was 8.2 ms before the review indexed DisplacementDetector candidates by onset (see repairs).
- DP per 01 §9.6 with cost.ts; notes shorter than extraMinDurMs are skipped at no cost and never extras; ties go match, missed, extra. Relabel seeds are wrong-pitch matches and extras; a segment needs >= 3 bad notes that fit at δ and the 2x rule; up to 8 DP rounds.
- Bare follow scenarios rebuild the meter as makeMeter(beatsPerBarOf(expected), 4); a non-x/4 follow fixture would need its meter in tools/bare-runtime/follow-scenarios.ts.

Known gaps:

- No segment when fewer than 3 replayed notes are bad at offset 0 (repeated material): 4/103 P3 restart/skip scenarios; their displaced notes are judged as wrong or off-time current notes but never overwrite an on-time note.
- The randomized golden displacement cases are symbolic streams; the audio-path gate is P18's.

### P11 web audio backend

- Import from src/platform/web/audio/index.ts. Construct `new WebAudioBackend({ capabilities, workletUrl: CAPTURE_WORKLET_URL })` (worklet-url.ts). Call checkClockRate() in calibration or self-test, setOutputMode() when the output is declared, and subscribe onCaptureFault (backlog and capture-gap voids are not AudioBackend.onInterruption reasons).
- The DSP worker must post `CaptureReturn` ({v:1, type:'return', lowband, hiEnergy}, both buffers transferred) on the capture port after copying a block. The type now lives in src/core/platform.ts. Without it the backend falls back to the main-thread relay after 500 ms (captureRelay true).
- startT = (originFrame + decimator.nextOutputInputPos) / ctx.sampleRate on the AudioContext clock: same timeline as now() and ClickSpec times.
- Node tests: FakeAudioWorld in src/platform/web/audio/testing/fake-web-audio.ts runs the real CaptureCore behind a MessageChannel. E2E: `pnpm exec playwright test -c e2e/audio/playwright.audio.config.ts` (add to CI). e2e/audio/page.ts and entry.ts can be reused for the WebKit smoke test.

Known gaps:

- WebKit not run; headless Chromium runs at 44.1 kHz, so the 48 kHz path is Node-tested only. resume() after a W3 recreate runs outside a gesture (unverified on iOS).
- The backend does not close itself on page hide or idle (IOS2/session policy). ?testClock=1 is not wired in the page yet.

### P9b selection and transposition

- Entry points (src/corpus/index.ts): selectExcerpt, countEligible, prepareExcerpt (frozen), selectExcerptWith(m, s, h, cfg, rng, {doc, excludeIds}), selectAndPrepare(m, s, h, cfg, rng, load, cache?), TranspositionError (codes triple-accidental, double-accidental, too-many-doubles, mismatch, range, tempo). Helpers in src/corpus/transpose/ and src/corpus/select/. Test helper src/corpus/select/testing/synthetic.ts (synthDoc, manifestOf).
- P16 must call selectAndPrepare with a loader built on loadExcerpt: the manifest has no spelling data, so plain selectExcerpt + prepareExcerpt can throw for a minor or chromatic excerpt in a key that needs double accidentals.
- SelectionResult.transposition is the concert interval; written pitches use t + c_I. A random key is resolved after the excerpt is picked.

Known gaps:

- ManifestEntry lacks pitch-spelling data and peakNotesPerBeat (03 §7.1 change needed via the overseer); without the doc, NPS clipping uses a conservative bound.
- bandFor, clefsAt and getInstrument are local in src/corpus/select/levels.ts (src/instruments/ is empty).
- Many fixture excerpts are tempo-ineligible at their own level under 03 §7.5 rule 5 (source tempo ranges miss the level range).
- Interpretations (a) to (j) in the P9b report (random level, key and meter draws, bars as a preference, L-1 never alone, variety weights) are P9b's.

### P9c expected notes

- buildExpectedNotes equals all 18 fixtures/expected goldens and matches notation's expectedChains order (tested). src/testkit/scenarios/corpus.ts now uses it.
- Ledger-line counting is duplicated in src/corpus/expected (corpus may not import notation); a shared helper in theory would remove it. bpm is taken as given (tempo clipping is in select/prepare).

### P12 grade

- `import { grade, gradeWithPatterns, gradeApi } from 'src/grade/index.ts'` (barrel added in the review). grade() is pure and returns patterns [] and tipsShown []; gradeWithPatterns fills patterns from detectPatterns.
- XP factors are {id, value}[] in the order q, m_tempo, m_random, m_mode, m_streak, m_daily, m_below, plus practice or repeat. Stops use the same arithmetic as fixtures/follow/gen/reference.ts; drift is the least-squares slope times the last bar number.

Known gaps:

- 'visual-metronome' ranked reason is never emitted (MetronomeMode has no visual mode in v1).
- Stops recover the input-to-score offset from matched notes or extras; a take with neither reports no stops.
- Practice repeat XP reading (25% on the first repeat of the day, 0 after, replacing the practice factor) is P12's.

### G6+G7 progression and eligibility

- src/grade/progression (re-exported by src/grade/index.ts). P16 must call applyAttemptOnDay(p, a, cfg, platform.localDay()) (applyAttempt uses the UTC date), build XpInput with xpInputFor, check postRevealSkipAllowed before serving a replacement, and fill AttemptRecord.score.patterns and tipsShown before applying the attempt.
- startPlacement begins placement (first excerpt at progression.placement.startLevel); setInstrumentLevel(from) is the auto level-up Undo. Declining an offer suppresses it for the next 5 ranked attempts.
- evaluateGate takes plain inputs (calibration is P14); only an 'unmeasured' recheck fails it (R31).

Known gaps:

- The auto level-up run keeps {count, atMidTempo}; past 8 straight scores >= 90 the mid-tempo count covers the whole run.
- Unranked placement attempts earn XP but do not consume a placement step.

### P12b patterns

- `detectPatterns` from src/grade/patterns/index.ts (and the grade barrel); DETECTORS and TIMING_PATTERNS for P18's cross-fire matrix. Results follow config/tips.json order, not lostPoints.
- params: E22/E23 {offset, direction}, E6 {stops, restarts}, E1/E2 {slopeBeatsPerBar, driftBeats}, E7/E8 {medianRatio}, E28/E29 {lateMs}. The synthetic builder in patterns.test.ts (build) is reusable for event-level injection.

Known gaps:

- 02 §6.2 statistical acceptance (300 takes, >= 90% hit, <= 5% cross-fire) needs P18's suite.
- GradeInput has no key signature: E12/E13/E18 infer it from keySigAltered notes. ExpectedNote has no phrase-end flag (E4).
- SX04's 'bflat-involved' param is not emitted, so SX04 never fires.
- Choices (a) to (h) in the P12b report are P12b's readings.

### P13 tips

- selectTips (src/tips); fillTipText, evidenceLine, formatBars in src/tips/text.ts. The direction words and bar-list join now have copy keys (tips.direction.sharp, tips.direction.flat, tips.bars.join); tips/ may import only core, so text.ts mirrors them and src/tips/copy-sync.test.ts checks they match.
- P16: pass recentTipIds and recentPrimaries most recent first, excluding the current attempt; never call selectTips for void attempts. 'Incomplete' shows E6 plus the tips.incomplete card.

Known gaps:

- Session summary (02 §6.1 item 8) is not in TipsApi.
- skipRecent also applies to the clean-read tip U18.

### P15 overlay

- `new VexScoreView({ overlay: new SvgOverlay({ reducedMotion, highContrast }) })`; SvgOverlay is now exported from src/notation/index.ts. The #glyph sprite must be mounted inline. The app must pass a highContrast getter.
- DOM: per system svg, underlay holds a <style>, .sr-bar-tint and .sr-next-bar; overlay holds g.sr-bar[data-bar] with .sr-note-marks[data-marks-for] and .sr-ghost[data-detected-id], .sr-overflow, and line.sr-playhead, in canonical order. Note colour is inline style.color plus n-* classes (tests read classes).
- e2e/notation/overlay.spec.ts: 200 ghosts + 468 glyphs, frame p95 16.8 ms, overlay JS p95 0.5 ms.

Known gaps:

- Review-only extras (heat strip, replay bracket, ghost duration tails, note inspector) belong to D3/D8b.
- Ghost accidentals ignore in-bar accidental memory. The 200-ghost stress case has 1347 nodes (over the 600-node live budget; deliberate overload).
- glyphs.svg ghost-head cannot be outlined through <use>; the overlay draws an inline path.

### P7b bundle

- Import VexFlow only from src/notation/font/vexflow-bravura.ts, never 'vexflow/bravura'. After a VexFlow upgrade regenerate src/notation/font/bravura-data.ts.
- pnpm size: initial 89.2 KB, total 463.5 KB gzip (limits 150/500). Only 36 KB headroom; the notation chunk is 374 KB, mostly the base64 woff2.
- main.tsx short-circuits #/dev/notation when DEV or VITE_NOTATION_DEV=1; remove it and the dev screen when the practice screen lazy-imports notation, and keep that import lazy.

### C5 windowing, C6 features, C7 filters

- Run: `cd tools/corpus-build && python -m corpus_build` (default run now includes windows, augment, features, filters, dedupe). `calibrate` and `familiar` are developer stages; re-run calibrate after features, windows or filter changes and update config/filters.yaml if the fitted values move.
- Window id: <part id>@[p]<first full bar>-<last bar>[-aug2], 0-based normalized measure indices.
- C6 output (build/features/candidates.jsonl): level, effectiveLevel (half cadence needs L3), featureLevels, minorForm, replaces. C7 output (build/dedupe/candidates.jsonl): flags, familiarity, dedupeGroup, work, quality {soft, interest, interestMargin}.
- Survivors after filters and dedupe: 2263 (L1 16, L2 32, L3 264, L4 192, L5 460, L6 537, L7 234, L8 264, L9 48, L10 216). On rules alone (before C8r): 1499, with L1-L3 at 0 (ruling 29 needs the agent veto for all L1-L3 items, x2 variants, quartet inner/cello windows and interest margin < 0.10).
- Filter calibration: 95.2% negatives rejected, 76.5% positives accepted (26/34 positives: about ±7 points). repeated_note_ratio_max refitted 0.35 -> 0.48, pedal_alternation_share_max 0.25 -> 0.26.

Known gaps:

- Ruling 25: L1 ships unserved (16 < 30). L2 and L3 are unserved until C8r runs. v1.0 gates fail at L2 (32 < 40) and G2-launch at L1-L2 for winds and voice and at L9 for voices.
- Rhythm cells are read per metronome beat (2/2 half note, 3/8 eighth), so two 2/2 fixture excerpts get different cell ids from the fixture builder. 'other' beat groups (reverse dotted, some compound figures, duplets) tag L10 (496 windows). Overseer decision on both.
- Mode-unknown rejects 1750 Lieder and 4923 quartet proposals (mid-movement key sections); tempo-change keyword regex may over-reject.
- Three Lieder voice parts named 'Clarinet in C' (Erlkönig D328, Der Musensohn D764, Dichterliebe 1) are never extracted (C3/C4 role matching).
- Fingerprints are augmentation-invariant, so the C10 'no shared fingerprint' gate must exempt pairs within one dedupeGroup (64 pairs).
- Mutopia yields nothing (C3b not built). H12 beam groups are not checked (no beam data).

### Wave 2 review

repairs:

- src/grade/index.ts created: re-exports grade, detectPatterns, DETECTORS, TIMING_PATTERNS, the progression exports and computeXp; adds gradeWithPatterns and the GradeApi conformance object (P12, P12b, G6+G7 needs).
- src/notation/index.ts exports SvgOverlay and OverlayOptions (P15 need).
- Copy keys tips.direction.sharp, tips.direction.flat and tips.bars.join added to src/ui/copy/en.json (P13 need). src/tips/text.ts mirrors them (tips may import only core) and src/tips/copy-sync.test.ts fails if they drift.
- DisplacementDetector.candidates scans only the expected notes inside the allowed offset range by binary search on onset beat, instead of every expected note per window note (P10b need). Output is unchanged (same iteration order); all follow tests pass.
- CaptureReturn moved into src/core/platform.ts (P11 need, additive); protocol.ts re-exports it.
- New src/testkit/e2e-pipeline.test.ts (see below).

frozenChanges:

- src/core/platform.ts: added the CaptureReturn interface (additive; the same shape P11 defined in protocol.ts). No existing type changed. No schema is generated from platform.ts.

End-to-end pipeline test (src/testkit/e2e-pipeline.test.ts):

- Three fixture excerpts (jaell L3 4/4, mayer cello L3 3/4 with pickup, gouvy L5 6/8 at 40 dotted-quarter bpm) x flute, trumpet and violin. Each runs P3 synth (default vibrato and breath) -> FakeAudioBackend (production decimator and high band) -> DspPipeline -> LiveFollower -> alignFinal -> grade.
- Injected notes are chosen by rule: late by halfway between tRed and the match window (+318 ms at 66 bpm, +502 ms at 40), wrong by ±2 semitones, flat by halfway between redCents and 50 c (-43 to -45 c). All 9 cases give late / wrong-pitch / flat both live and final, every other note matched, on time and right in pitch, and no extras. Clean takes score 100 (S) with P/I/R 100/100/100.
- Error takes score 96 to 97 (A or S) with three red notes out of 13 to 29. This follows 02's weights; the lead musician may want to check that three visible errors can still earn an S.
- E2E_PIPELINE_INSTRUMENTS=clarinet-bb,sax-alto,cello also passes all 9 cases. Capture is clean (headphones, no room, no clicks); room and click conditions are P18's gates.
- Held-out check of P4c: a fresh scenario seed (48879, 72 clean scenarios, not the set P4c tuned on) gives F1 flute, clarinet, sax, trumpet, violin, piano 1.0000, cello 0.9975, voice 0.9794.

Trust as a base for wave 3:

- P4c: trusted on clean capture (gates reproduce on a held-out seed and in the e2e test). Not yet robust to room reverb (F1 0.69-0.94), and note-on latency on the 1024 window is over budget.
- P4d: trusted for headphone and clean speaker use; residual numbers are idealised.
- P10a: trusted. Fixture predicates, golden displacement in 100 randomized renders, 300 clean takes with no false lost-place, and the e2e live verdicts all hold.
- P10b: trusted. Use alignFinal with the streamed live outcome.
- P11: trusted for Chromium; WebKit and real iOS are unverified, and the DSP worker's CaptureReturn is still to be written.
- P12: trusted (all non-pattern grade predicates, bare runtime byte-identical, e2e grades consistent).
- P9b: trusted with the selectAndPrepare caveat (manifest lacks spelling data).

### Notes for wave 3

- S1 thin slice: the e2e test is the reference wiring. The DSP worker builds DspPipeline + LiveFollower(config, { analysisRate: block.analysisRate }) from the 'config' message, posts CaptureReturn after copying each block, batches follower events per block into WorkerReply 'events', and on 'end' flushes the pipeline, calls follower.end, then alignFinal(c, detected, liveOutcomeOf(events)). FollowConfig.t0 is bar 1 beat 1 on the output timeline and latencyCompensationSec the RTL; the e2e test uses t0 = capture origin + lead-in and latency 0 because the fake has no output path.
- P14 calibration: build click templates with buildClickTemplate; call WebAudioBackend.checkClockRate(); the recheck (7.7) can reuse DspPipeline.clickFits() confident count-in fits. Only an unmeasured recheck on speakers fails the gate (R31); evaluateGate takes plain inputs.
- P16 session: selectAndPrepare (not selectExcerpt + prepareExcerpt), buildExpectedNotes, resolveTolerances, alignFinal with the live outcome, gradeWithPatterns (or grade + detectPatterns), selectTips (never for void attempts), applyAttemptOnDay with platform.localDay(), xpInputFor, postRevealSkipAllowed. Subscribe onCaptureFault for backlog and capture-gap voids. End the take on void (the follower only reports no-signal). Session summary (02 §6.1 item 8) has no API yet.
- D3 score frame: VexScoreView with SvgOverlay; mount the glyph sprite inline; pass highContrast and reducedMotion getters; keep notation behind a lazy import (size headroom is 36 KB). Review extras (heat strip, replay bracket, inspector) sit above the overlay and read FinalAlignment.
- D4 to D12: tip text words come from tips.direction.* and tips.bars.join; WOOD_ON_SPEAKERS cannot be imported from ui/ (route it through the session or move it). The 'S with three red notes' result above may need copy or grading attention.
- iOS: WebKit has never run; the W3 recreate calls resume() outside a gesture; the close-on-hide and idle policies are IOS2's; ?testClock=1 must be wired in the page.
- C8 review layer and C8r: L1-L3 are empty on rules alone, so C8r decides whether L2 and L3 ship. Use quality.interestMargin, role, augmentOf and effectiveLevel from build/dedupe/candidates.jsonl.
- C9 emitter: emit `level` as effectiveLevel; event ids e<n> from 1 in window order (C6 extremes); carry flags, familiarity, dedupeGroup, work and quality; minorForm is not in ExcerptDoc. Consider adding pitch-spelling data and peakNotesPerBeat to ManifestEntry (P9b need, frozen-type change).
- Open architect decisions: 01 §9.5 displacement range sign; FollowConfig analysisRate and writtenKey; DspConfig attackExcludeMs and clickLeakDb; DetectedNote frames-agree flag; GradeInput key signature; FollowApi.finalAlign without live events.

## From wave 3

### Wave 3 review (integration)

Status at review start: typecheck, lint, 2851 unit tests, build, size (70.1 KB initial / 457.9 KB total gzip), bare runtime (66 scenarios byte-identical), corpus pytest (351) and the notation (22), audio (6), slice (1), loop (2) and ios (48, Chromium) e2e suites were green. Failures were harness-only: the root `pnpm test:e2e` ran e2e/audio/backend.spec.ts without its fake microphone (7 failures), and e2e/synthetic always listed a WebKit project that the sandbox cannot run (7 failures), and its ±1 ms loopback case failed once under the root config's parallel workers.

Repairs:

- Engraving (dark theme): VexFlow's metrics give Stem a fixed `strokeStyle: 'black'`, so every stem was black on dark paper (measured 0,0,0 on 27,30,35). src/notation/render-excerpt.ts now sets the context default style to currentColor, which makes Element.applyStyle drop the metric colours. Staff lines also follow the ink colour now (they were '#999999').
- The scan screen showed the iOS-only "Set Auto-Lock to Never" hint on desktop Chromium whenever the Wake Lock request failed. src/app/main.tsx raises it only for osFamily ios/ipados.
- Settings at 390 px: the Output segmented control (Speakers / Wired headphones / Bluetooth) overflowed and clipped "Bluetooth". `.ui-segment` labels may now wrap when the group is narrower than its content. Each switch row printed its label twice (row label plus the Toggle's own label); the Toggle label is visually hidden inside settings rows and stays the accessible name.
- Performance toolbar at 390 px: the Stop label squeezed the centre text to "B…". Below 30rem the Stop button shows its icon only (the label stays the accessible name). The centre still ellipsises the tempo part on the narrowest phones.
- Unknown routes rendered the dev placeholder ("Home" plus the raw path). New NotFoundScreen with copy keys notFound.title, notFound.body and notFound.action (added to src/ui/copy/en.json).
- eslint.config.js: src/app/compose/**, src/platform/web/audio/dsp-worker-core.ts and dsp.worker.ts are in the composition-root category (S1 need); the 16 `eslint-disable-next-line boundaries/dependencies` comments are removed.
- e2e harness: e2e/audio and e2e/synthetic are gated on E2E_AUDIO and E2E_SYNTHETIC (set by their configs), like slice and loop. e2e/synthetic adds its WebKit project only with IOS_WEBKIT=1, as e2e/ios does. .github/workflows/ci.yml runs every suite config (notation, audio, slice, loop, ios and synthetic with IOS_WEBKIT=1).
- New screen tour: e2e/tour/ (`pnpm exec playwright test -c e2e/tour/playwright.tour.config.ts`). Production build against public/corpus/v1, Chromium fake capture, projects desktop-light, desktop-dark (1280x800) and iphone-light, iphone-dark (390x844, touch), deviceScaleFactor 2. It writes 27 screens per project to docs/screenshots/<project>/, flags raw copy keys and horizontal overflow, and plays one take with a note 2 semitones sharp and a note late by (tRed + W)/2. All four projects pass: the wrong note is red live and final (wrong-pitch) with a ghost; the late note is red with a 'late' ghost to the right of its notehead and final timing 'late' (+238 to +310 ms). e2e/loop/node-helpers.ts gained lateNoteIdx and writeTourWav.

Visual findings not fixed (need design or lead-musician input):

- Ghost spelling of a 2-semitone wrong note: 02 §4.8 spells anything within ±2 semitones with the target's letter, so A played as B draws an A𝄪 ghost on the target's own staff position, overlapping the red notehead. The rule is followed as written; consider ±1 semitone.
- The ♩ in "♩ = 84" falls back to a system font: it renders small, with a wide gap before "=", on every screen that shows tempo.
- Results can say "Tip: Clean read" next to visible red notes: E30 fires when the score is at least its minScore and no pattern fired, and one wrong plus one late note fire no pattern. Copy or rule review.
- Onboarding and the calibration screen show the select's label ("Input device") as its value; settings shows "System default".
- Welcome: the headline gets a visible focus outline on load (route focus management on a heading).
- Full-page screenshots show the fixed tab bar part-way down long pages and settings section routes scrolled; these are capture artefacts, not layout faults.

Trust:

- P16 session: trusted in relay mode (the app's mode; it passes no createCaptureChannel). The loop e2e and the four tour takes reach graded results with the right verdicts. Port mode stays unranked on speakers until the DSP worker posts 'recheck'. voiceReference is always null (E23 cannot fire). Session summary and wake-lock idle release are not implemented.
- P14 calibration: trusted on synthetic loopback and play-along (unit gates hold; decideRecheck matches budget.recheck 5/10 ms). Not exercised end-to-end in the browser (the tour and loop skip calibration because the fake microphone hears no clicks); no real device or WebKit run.
- INT (composition root): trusted for the Chromium flows the tour covers (onboarding, home, scan, take, results, tips, progress, history, attempt review, settings, calibrate, credits). Fixed the defects above.
- P4c-r: trusted on clean capture and as an improvement in rooms; ruling 45's target is missed for voice (0.81-0.89), cello and violin in strong rooms, flute on one held-out seed. Reverberant rooms (DRR ≤ 4 dB, RT60 ≥ 0.6 s) and voice in any room are known limits.

Corpus (tools/corpus-build/build/report.md, version c1-ef30a17bf7): 946 excerpts, 5.76 MB. L1 9, L2 12, L3 128, L4 133, L5 274, L6 364, L7 6, L8 10, L9 2, L10 8. Served: L3-L6 only. Review (L1-L3): 293 windows reached the agent veto, 149 accepted by both variants (50.9%), 144 rejected, 0 control failures. Controls: negatives rejected 72/72 (100%), positives accepted 69/72 (95.8%; packet-06 A and B and packet-08 B accepted 3/4). Ruling 24 gate pass; v1.0 launch gates fail (total < 1000; L2, L7, L8, L9 < 40).

Final status (this review): typecheck, lint (eslint, stylelint, depcruise), 2851 unit tests, build, size (70.1 / 458.2 KB gzip), bare runtime (66 byte-identical), corpus pytest (351), e2e notation 22, audio 6, slice 1, loop 2, ios 48, root `pnpm test:e2e` 96 passed / 34 skipped, tour 4/4. e2e/synthetic passed 7/7 in two of three runs on its own config; one run failed one case (most likely 'loopback measures d = 110 ms within 1 ms', which also failed once under the root config's parallel workers). Treat it as flaky until P21 looks at it. WebKit has not run anywhere.

### Notes for wave 4

- P18 accuracy gates: run the 13.2 gates under room and click conditions (P4c-r numbers above are synthetic). Include voice and strings in rooms, the 1024-window latency (79 ms p95 before the follower), the ±2 semitone ghost spelling case, and 02 §6.2's 300-take pattern acceptance. The tour shows final verdicts can depend on the excerpt (a +300 ms late note at 80 bpm was missed + extra on one excerpt where W was smaller): assert relative to tRed and W, as e2e/tour does.
- C10 corpus validation: H-render (VexFlow in headless Chromium) and the TS selector for every launch instrument x served level (L3-L6); exempt same-dedupeGroup pairs from the shared-fingerprint gate; decide the KS 'disagrees' reading and the level-confidence cut at L7+ (C8 gaps), which leave L7-L10 nearly empty.
- P19 PWA: production build has no service worker or manifest yet; keep pnpm size within budget (457.9 KB of 500 total; the DSP worker is 24.2 KB and the fonts chunk 124.5 KB).
- P20 replay route: #/dev/replay is still a placeholder; the attempt review (history attempt) works and can host it.
- P21 WebKit projects: no WebKit run exists for any suite. CI now sets IOS_WEBKIT=1 for e2e/ios and e2e/synthetic; the root config lists webkit, webkit-iphone and webkit-ipad. Add WebKit to the tour config when available; check resume() after the W3 recreate and real env(safe-area-inset-*).
- D13 design QA: start from docs/screenshots/ and the unfixed findings above (ghost overlap, ♩ fallback glyph, clean-read tip with red notes, select placeholder, headline focus ring, toolbar ellipsis at 390 px). The tour's raw-key and overflow checks report none after the repairs.

## From wave 4

### Packages

- C-FIX: the level-confidence rejection above L6 is report-only (R49, `level_confidence_1_report_only` in config/filters.yaml), which brought L7, L8 and L10 into service. A manifest-budget level cap was added to emit.py; after the final review's servability filter the manifest fits its budget without it.
- FIX-A: R50 ghost spelling, R51 clean-read rule, R52 octave errors cap S, R55 worker recheck in port mode and the voice drift reference in 'done', the session summary, and the e2e/synthetic 110 ms flake (stale `currentFrame` in a worklet node's first quantum). The recheck spec rides on the DspConfig object under `srRecheck` because the frozen WorkerMessage has no field for it.
- C10: tools/corpus-check (`pnpm corpus:check`): headless render through the runtime selector, H-fit, H-viable, stats.fit cross-check, source and credit checks, H-dedupe with same-group exemption, and the new H-serve check (every excerpt can be served to some launch instrument).
- P19: manifest, icons, service worker with network-first index and cache-first hashed files, and the PWA Playwright suite (offline reload, other origin under a subpath).
- P20: the dev replay screen (render streams and attempt exports, diagnostics export without audio).
- P21: WebKit projects behind `IOS_WEBKIT=1` in every config that can use them; CI installs WebKit.
- D13: axe on every route in both themes, tap targets, reduced motion, grayscale distinctness, the copy-key lint and the font size budget; the wave 3 visual findings were fixed.
- P18: the full synthetic accuracy gates (`pnpm gates`, tools/gates/run.ts) and a fast subset in `pnpm test`; report in docs/accuracy-report.md.

### Final review

Repairs:

- Corpus servability. C10's H-serve check failed 384 of 1003 excerpts, and about 67 of those were false positives: the check served each excerpt from a single-entry manifest, so an excerpt reachable only through the L - 1 pool (never served alone, its share is capped at 20%) always failed. tools/corpus-check/check.ts now serves such an excerpt next to the real level-L + 1 excerpts and draws until the selector picks it (after a `countEligible` test that it is eligible at all).
- The emitter now drops excerpts that no launch instrument could be served (`servable` in tools/corpus-build/corpus_build/emit.py, the same checks as `viability`: pools, key fit, bars, flags, IOI and NPS clipping, the excerpt's own tempo range) and excerpt ids on denylist.yaml, before the size trims. That frees the manifest budget, so L5 and L6 are no longer capped. The TypeScript check is still the final word: the residual disagreements (38 excerpts the Python model calls servable, mostly spelling and combined tempo clipping) are on denylist.yaml with gate and reason, with the two Holmes strophe repeats (H-dedupe). The denylist had held C10's 385 ids, including the false positives; it was rebuilt.
- Result (corpus c1-42a07a738c): 970 excerpts, 6.13 MB. L1 7, L2 7, L3 104, L4 96, L5 214, L6 301, L7 94, L8 80, L9 18, L10 49. Served: L3 to L8 and L10. 1341 review survivors, 40 denylisted, 331 unservable. `pnpm corpus:check` passes with every excerpt rendered; ruling 24 passes. v1.0 launch gates: total under 1000, L2 and L9 under 40, G3 variety not met (L6 Schubert, L9 Mozart, L10 Haydn).
- package.json: scripts `gates`, `corpus:check` and `lint:copy`; `test:e2e:webkit` sets `IOS_WEBKIT=1`; axe-core 4.14.1 is a devDependency (D13 no longer needs AXE_CORE_PATH).
- CI: `lint:copy` in the lint job; new `gates` job (uploads the accuracy report) and `corpus-check` job; the design and tour suites in the e2e job; deploy waits for every job including corpus pytest, gates and corpus check. The gates job is red until the P4c issues below are fixed.
- src/app/main.tsx registers the service worker in production builds (it was built but never registered). A new build takes over on the next launch; there is no update prompt, so a take is never reloaded.
- src/app/compose/app-services.ts mounts the P20 replay screen at #/dev/replay in dev builds, behind `import.meta.env.DEV` so production drops the chunk.
- Copy: `home.keyRandom` pluralises ("up to 1 sharp or flat").
- New e2e/tour/first-user.spec.ts: onboarding, three takes in a row (flute ranked on headphones, cello practice, trumpet ranked on speakers), results and tips after each, history, progress, export, reload, import. Every take ends on its own and is graded with the injected wrong note found; ranked requests without calibration are recorded unranked with reason `calibration` (and `measurement` on speakers, where the fake microphone hears no count-in); history survives reload and import; no raw copy keys or console errors. Passes on all four tour projects.

Reviewed for correctness (no defect found): the wave 4 diffs in src/session (port-mode recheck spec, fresh voice reference after a recheck shift), src/follow (`alignFinalWithReference`, `oneThirdSec`), src/grade (R52 cap, R51 red check), src/platform/web/audio (worker recheck runs on the copied block, after the buffers go back to the worklet; capture origin fix), src/calibration/recheck.ts. src/grade/progression did not change in wave 4.

Not fixed (need the P4c owner or the architect):

- `pnpm gates`: 188 of 195 gates pass, 6 blocking failures, unchanged from P18: voice false missed 1.9 % clean and 2.0 % device (gate 1 %), voice pitch class 98.7 % and 99.0 % (99 %), voice live-vs-final divergence 3.2 % on device (3 %), piano device onset F1 0.963 (0.97). Plus voice room F1 0.876 against R45, the accepted R54 limit. Causes are in src/dsp/segmenter.ts (voice semitone steps on short notes merged, tied to the frozen voice changeCents 80; piano damper gaps under a noise floor split at the crossing midpoint). Definition of done item 2 is not met.
- WebKit has never run: the sandbox cannot download it (playwright install webkit fails). Definition of done item 3 is met for Chromium only.
- iOS and real devices, real instruments, Lighthouse installability: not run.
- C10's denylist remains the mechanism for TS-only rejections; a future pipeline change that alters ids needs `pnpm corpus:check --write-denylist` and a re-emit.
- The axe contrast hit seen once by D13 on /settings/about did not recur in this review (design suite 18/18).
- docs/screenshots/ was refreshed by the tour before the `home.keyRandom` plural fix, so the home screenshots still read "up to 1 sharps or flats".

Final status (this review, Chromium only):

- `pnpm install --frozen-lockfile` up to date; `pnpm typecheck` pass; `pnpm lint` pass (eslint, stylelint, depcruise 405 modules); `pnpm lint:copy` 648 keys, 0 unused; `pnpm lint:fixtures` 45 passed; `pnpm schemas:check` and `pnpm tokens:check` pass.
- `pnpm test`: 140 files, 3007 tests passed (run before and after the corpus re-emit).
- `pnpm build` pass; `pnpm size` 70.1 KB initial, 466.3 KB total gzip, font 247.2 KB; `pnpm test:bare` 66 scenarios byte-identical.
- `pnpm gates`: exit 1, 188/195, 6 blocking failures (above). Run with `--no-write`, so docs/accuracy-report.md is P18's (same numbers).
- `pnpm corpus:check`: pass, 970 excerpts, 970 rendered, 77 selector cells, 0 stats.fit mismatches. Corpus pytest: 352 passed.
- Playwright: root 96 passed / 42 skipped (WebKit and gated suites); notation 22; audio 6; slice 1; loop 2; ios 48; synthetic 7; pwa 2; design 18; tour 8 (tour.spec and first-user.spec on desktop and iPhone, light and dark).
- Not run: any WebKit project, CI itself, Lighthouse, real devices.

## Gate repair

Running log (P4c gate repair: piano device onset F1, voice false missed / pitch class / divergence). Newest last.

- Start: HEAD carries a partial change in src/dsp/segmenter.ts (`riseStart` uses the measured noise band, `noiseSpreadDb`, when the trough is at the noise floor) plus TEMPDBG env hooks (`VOICE_TOL`, `REF_LAG`, `__segTrace`), inert by default. Baseline before it: 188/195 (docs/accuracy-report.md at be3ce7d).
- Measured the partial work (full `pnpm gates`, report-only): 189/195. Piano device onset F1 0.9631 -> 0.9983 (passes); piano room 0.963 -> 0.974; flute/clarinet/sax device F1 up. No gate that passed fails. Remaining blocking: voice false missed 1.89% clean / 1.89% device, pitch class 98.71% / 98.97%, device divergence 3.20%. Keeping the `riseStart` noise-band change.
- Voice diagnosis (scenario 114 clean, notes 7-8, 64 -> 65): the slur is a glide of about 80 ms; each glide frame lands within 80 c of the note median and is appended to the note, so the median creeps after the pitch and no frame is ever 80 c from it. The note median used as the change reference is contaminated by the change itself.
- Fix tried through the TEMPDBG hook `REF_LAG` (change reference = median of the note's frames older than the lag), voice only, clean+device+planned, default seed: lag 0.04 s false missed 1.77%; 0.06 s 1.01%; 0.08 s 0.63%; 0.10 s 0.38% (pitch class 99.75 / 99.87%, divergence 2.29 / 2.29%); 0.12 s 0.38%. Voice changeCents 80 unchanged. Lag 0.10 on every instrument: violin and cello better, small mixed shifts on winds and piano (flute device extras 0 -> 0.03/take), all gates still pass. Adopted for the soft profiles (voice, bowed) only: `changeRef`, CHANGE_REF_LAG_SEC 0.1; TEMPDBG hooks removed. src/dsp tests pass (153).
- Full `pnpm gates` (report-only) with the final segmenter: 194/195, 0 blocking. Voice clean false missed 0.38%, pitch class 99.75%; device false missed 0.38%, pitch class 99.87%, divergence 2.29%; piano device F1 0.9983. Only voice room F1 0.887 fails (R54, non-blocking). Latency p95 on the 512 window 59.48 ms (limit 60; 58.99 before). Copy of the final file: scratch only, the tree holds it.
- Held-out seed 305419896 (0x12345678; never used for tuning), 34 scenarios per launch instrument, clean/device/planned. Before (segmenter at de1bbb7~1) -> after: voice clean false missed 1.69% -> 0.56%, pitch class 98.74% -> 99.89%; voice device false missed 1.80% -> 0.79%, pitch class 98.85% -> 100.00%, divergence 1.18% -> 1.28%; piano device F1 0.9866 -> 0.9994; voice room 0.854 -> 0.861. Every clean and device gate passes after; the only failures are room F1 for flute 0.928, violin 0.905, cello 0.901, voice 0.861 (all R54 instruments, the same failures before). No pass/fail status changed for any other gate.
- Final checks (this working tree; src/app, src/ui, docs/redesign and schemas were being edited by other work at the same time): `pnpm test:bare` pass (66 scenarios byte-identical). `pnpm test` 3135 passed, 15 failed in 6 files (src/app/screens/results, src/app/screens/history, src/ui/components/domain, tools/generate-schemas, tools/lint-copy, tools/corpus-check H-serve); the same files fail with the pre-repair segmenter swapped in, none imports src/dsp. `pnpm typecheck` fails only on src/app/screens/settings/sections.tsx (`ClickTimbre`); tsconfig.dsp and tsconfig.core pass. `pnpm lint` fails only on docs/redesign/mockups/_build/*; eslint on src/dsp and config passes, depcruise clean. src/dsp tests 153 passed.
- `pnpm gates` (writes docs/accuracy-report.md): exit 0, 194/195, 0 blocking; the one failure is voice room F1 0.887 (R54). Voice changeCents stays 80; config/instruments.json untouched.

## Post-redesign fixes

The four shortfalls left by `docs/redesign/09-final-review.md` section 5 (items 1 to 4), and an error the owner met on a Mac (item 5). Each has a test that fails without its fix.

1. **Compound-meter tempo units.** Selection serves 6/8, 9/8 and 12/8 at difficulties 4 and 5 in dotted-quarter beats at 40 to 66 bpm (`levels.compound`, 02 §2.4), but the ranked check (`src/grade/ranked.ts`), the XP tempo factor (`src/grade/xp.ts`) and the level window's mid-tempo test (`src/grade/progression/apply.ts`) compared that number with the level's quarter-note range, so every such take was practice ("tempo below this difficulty's range"), m_tempo was clamped to 0.75 and no take counted as mid tempo. The rule (`isCompound`, `levelTempo`) moved from `src/corpus/select/levels.ts` to `src/rules/level-tempo.ts` (corpus re-exports it) and all four readers use it, so the served tempo and the range it is judged against are always in the same unit at every difficulty. The record keeps the requested meter, so the session passes the served meter to `applyAttemptOnDay` (a requested meter is used otherwise; a random one falls back to the level range). `src/grade/diagnostics.ts` already works in metronome beats throughout (no change); selection already used `levelTempo`. Not changed: the corpus tagger's density level (`src/corpus/tagger`) still reads `tempo.minBpm` for compound windows, which only errs towards a higher level. Tests: `grade.test.ts` (compound ranked and m_tempo at 4 and 5, unchanged outside), `progression.test.ts` (mid tempo), and a session test that plays a calibrated ranked 6/8 take at difficulty 4, 50 dotted bpm, from the shipped corpus and gets no ranked reason. `pnpm test:bare` output is identical before and after (sha256 of the scenario output compared).
2. **Phone read-through.** `purposePlan` gives the `read` purpose a slot height without the 20 px verdict lane (`purposeSystemHeightPx`): 126 px a system at 9.5 px, so four systems fit above the dock at 390 x 844. Take and review keep the lane. Test in `decor.test.ts`.
3. **Bar numbers in the gutter.** With page turns each line is numbered with its first bar, from the second line on (the first line has none, as in the mockups). `onSlotsChange` now also passes the displayed bar range, and the take toolbar reads "Bars 3–10 of 12" (`score.bars` replaces `score.lines`; the old "Lines" text also added 1 twice). `lineRange` is gone. Tests: `controller.test.ts`, `e2e/notation/score-frame.spec.ts`.
4. **Mockup mismatches.** The button key hint is a keycap (hairline box, caption type); Start on desktop Practice shows it and Space now starts there (not from a focused control or an open sheet); the text comes from `shortcuts.spaceKey`. The Practice instrument card reads "{family} · {clef}" ("Voice · bass clef", the clef of the range picture) with "Your range" and "Tap a note to hear it" above the picture. The onboarding difficulty step hides the picker's name and "Difficulty N" head (`PickedRange head={false}`). Tests in `home.test.tsx` and `onboarding.test.tsx`; screens compared with the mockups in Chromium at 1440 x 900 and 390 x 844.
5. **"Audio clock is running at the wrong speed" on the read-through (owner, Chrome on a Mac).** That text was a catch-all: `ScanScreen` showed `error.clockRate` for every session error except mic and corpus ones, yet no session path ever fails on the clock rate (the clock-rate check is a calibration self-test and a ranked measurement gate, never a stop). Now `SESSION_ERROR_TEXT` maps each `SessionErrorCode` to its own text (`error.audioSetup`, `error.storage`, `error.emptyPool`, `error.unknown`; mic and corpus as before), a small "Details: …" line shows the session's message, and the composition root `console.error`s the error with its cause (`session.lastError`). Try again retries the failed step (`PracticeSession.retry()`: back to the read-through with the same excerpt, or the same settings prepared again; from the tap it reopens audio first); an empty pool offers only Back to Practice. A take that fails on the performance screen now returns to the read-through, which shows the error (before, the screen sat in `error` with nothing on it). Home shows only the corpus error (honest), calibration has its own "audio check couldn't run", results shows no session error: no other catch-all found.
   Why a first take could fail: walked with `pnpm dev` in Chromium (fake media), onboarding with calibration skipped and attempted (the fake device hears no clicks, so ranked stays blocked without `?testClock=1`), practice and ranked, speakers and wired, with a slow `getUserMedia`, and with the track reporting 44.1 and 16 kHz. The dev server loads the DSP worker and the worklet without errors, and every take reached results, except one: **hiding the page during the read-through** (switching tab, minimising, the display sleeping). Between takes the interruption controller closes the audio on hide (05 W2), but the session kept the old route, so Start playing scheduled the take on a closed context and failed with `unknown` ("WebAudioBackend: call unlock() first"), shown as the clock message. Fixes: Start playing calls `ensureAudio` inside its tap and the take waits for an unlock in flight (it also covers a tap before a permission prompt or a reopened context settles); the controller's `onAudioClosed` calls `session.audioClosed()`, so a ranked auto start without a tap fails honestly as `audio-setup` and Try again recovers; the scan countdown keeps the reading time already spent when the reopened context's clock starts again at 0 during a read-through (before, it jumped up by the time read and a ranked take never auto-started); only clocks read during the same read-through count, so a new read-through on a new context starts from the full time (a first version that kept the clock across read-throughs auto-started the next ranked take at once; the tour caught it, and a session test now covers it). Also: the backend now checks the track's sample rate before building the capture graph, so the MediaStreamSource is only made on a context at the microphone's rate (some browsers refuse a source at another rate; a Mac microphone at 44.1 kHz under 48 kHz output, Bluetooth at 16 or 24 kHz); in Chromium the mismatch did not reproduce, so this is defensive. Tests: `scan.test.tsx` (texts, details, Try again, Start playing reopens audio), `perform.test.tsx`, `practice-session.test.ts` (unlock in flight, audio closed and retry, retry of a failed prepare, clock reset during the read-through), `web-audio-backend.test.ts` (44.1 and 16 kHz microphones with a strict fake). Not reproduced here and still open: anything specific to real Mac hardware; under `?testClock=1` without `testClockSec` a voice take can schedule clicks before 0 (test-clock only).

## Clock-rate check

The owner's Mac (Chrome, built-in speakers and mic, `pnpm dev`, relay capture) failed the self-test clock rate at −3.715% twice, once after the context had been recreated. Everything else on the machine was healthy, so the measurement was wrong, not the clock.

- **Cause.** `measureClockRate` read the worklet's processed-frame count twice, 1.5 s apart, and divided by the wall time between the two replies, stamped on the main thread when each reply arrived. Any delay in delivering a reply moves an end of the window. Reproduced in Chromium with fake media: idle 0.02%; random 20 to 80 ms long tasks gave +1.8% to +7.9%; one 80 ms task over the first reply gave +5.4%; **one 56 ms task right after the second request gave −3.63, −3.59, −3.59, −3.57%**, the owner's number. A dev build rendering while the check runs is enough. A real render stall in the window (a device start, 56 ms) gave −2.7%: that is a step in the clock, not a rate. Ruled out: (b) empty-input quanta were already counted as 128 frames, so they could not undercount; (d) relay mode only adds traffic on the same port, which makes (a) a little worse. (c) is real for a context that has only just been created (the old check measured straight after `recreateContext`; +0.76% in Chromium, which pre-fills; plausibly negative on a Mac device that starts late), so the new check waits for a steady clock.
- **Method** (`src/platform/web/audio/clock-fit.ts`, `WebAudioBackend.measureClock`). Pairs of (wall time, context time) taken at one instant by one party, sampled every 20 ms over a 2 s window. The first choice is `getOutputTimestamp()` (the browser's coherent `contextTime`/`performanceTime` pair; a late read only slides the pair along the line). Where it is missing or not advancing, the worklet's own stamp is used: `currentFrame` with `Date.now()` taken in the first quantum of each render burst (AudioWorkletGlobalScope has no `performance`; `Date.now()` there has 1 ms resolution), sent on request, so delivery time does not matter. Each window is fitted by least squares and also in 4 stretches. It counts only if every stretch agrees with the median within 0.4%, so a stall makes the window inconsistent and it is thrown away. The check starts only after the context has been `running` for 500 ms and its clock is advancing. A pass needs one consistent window within 2%. A failure needs two consistent windows that agree. Anything else after 3 windows is "could not measure" (`error: null`), which never fails the gate and never recreates. The 2% limit and the gate are unchanged.
- **Stability measured in Chromium** (6 runs per row, error in %): `getOutputTimestamp` idle −0.0024 to +0.0013; busy (77 to 80% of the main thread) with relay −0.0022 to +0.0127; right after a recreate, busy, relay −0.0020 to +0.0115. Worklet stamps (with `getOutputTimestamp` removed) idle −0.009 to +0.006; busy with relay −0.020 to +0.014; after a recreate, busy, relay −0.048 to +0.026. A 60 ms stall injected in the first window: that window was rejected and the second passed (ots +0.0043% at worst, worklet −0.017%).
- **Separate diagnostic.** Missing input is a capture problem, not a clock problem. The worklet counts render quanta that have no input channels or all-zero input, and `ClockDiagnostics.inputDropFraction` reports their share over the sampled windows (null without a microphone). `checkClockRate` returns it in `diagnostics`, `runClockRateCheck` in `ClockRateResult.inputDropFraction`, and `WebAudioBackend.clockDiagnostics()` keeps the whole last measurement for an export. It fails nothing.
- **Interface.** `ClockRateResult.error` and `ClockRateCheck.error` are `number | null`, and `ClockRateResult.state` gains `'unmeasured'` (`ok: true`). `measureClockRate` (frozen seam) returns `framesPerSec: NaN` when it could not measure. The worklet protocol's `frames` message is replaced by `clock`. `CLOCK_RATE_SEC` is 2. Two minimal type changes outside this package: `src/calibration/self-test.ts` (`errorPct` is null when unmeasured) and `CalibrationBackendExtras.checkClockRate` in `src/app/compose/calibration-services.ts`. The self-test item still reads "pass" for an unmeasured clock; showing it as skipped belongs to the calibration screen work.
- **Fake fixed.** `FakeAudioWorld.advance` lost the unfinished render period at the end of every call (0.8% per 500 ms chunk). That was the "quantised to about 0.7%" in the old test. Render time now carries across calls.
- **Tests.** `clock-fit.test.ts` (exact and wrong clocks, a step rejected, too few samples, short span, cleaning). `web-audio-backend.test.ts`: worklet and output-timestamp sources, jittery replies on a starved main thread, a 300 ms start-up stall, empty-input quanta (drop fraction about 0.5, clock exact), 8.8% fast and a steady 3.7% slow still fail (recreate once), recovery after recreate, one stall in one window, a stall in every window (null, nothing recreated), a suspended context and a silent worklet (could not measure). Also `capture-processor.test.ts` (burst stamp, counters) and `calibration.test.ts` (unmeasured). `e2e/audio`: under 0.5% with the main thread about 78% busy, idle, relayed, and right after a recreate.
- **Not verified without a Mac.** Whether Chrome on macOS gives a `getOutputTimestamp` that advances smoothly with the built-in output (the worklet fallback covers it if not), the size of a real device start-up stall, and whether the owner's −3.7% was the long-task case or a stall. Both are now handled, but neither was seen on the hardware.

## Calibration: what you see matches what you hear

Owner report from a real Mac: dots and clicks did not line up, more clicks and a tone came after the dots filled, the separate "Audio check" card felt like a second calibration, and the clicks seemed to fade.

- **What the mismatch was.** Each timing mark changed only when its click's analysis window closed: `waitUntil(t + maxRtlMs + 30 ms)`, that is 430 ms after the click was scheduled (plus up to 100 ms of polling), against gaps of 400 to 700 ms, so marks ran about one click behind the sound. The "current" mark was the next pending one, pulsing on its own 1.28 s loop before its click. After the tenth mark, six template clicks (no marks) and the sanity tone played with nothing on screen. "Check audio" then ran a second full loopback (ten ticks, six clicks, tone) and a one-bar count-in.
- **Why the clicks seemed to fade.** The count-in check is a take's count-in: the first beat is accented (+5 dB) and the other three are plain, as the recheck needs. The template clicks are the selected sound at the calibration level. The ten timing clicks are Tick at the same level. Nothing ramps. The stage lines now say this: "10 ticks", "6 clicks in Classic", "one loud click, then 3 softer, like a count-in".
- **Now.** The run reports a visual timeline on the audio clock (`CalibrationProgress` in `src/calibration/run.ts`). `onSound` fires when a sound is audible (scheduled time plus `now() - audibleNow()`, the output latency where the browser reports it). `onStage` fires halfway through the gap before a stage's first sound. Timing verdicts come when their window closes, as before. Marks light brass with one 320 ms ring (a fill only under reduced motion) and then settle to heard or missed. After the run, the count comes from the final result. `calibrationPlan` (`src/calibration/plan.ts`) gives the stages, their counts from `measurement-budget.json` and the duration (15 s on speakers, 10 s for play-along).
- **One flow.** Start runs the clock-rate check (silent), then the stages, then the self-test on the same route. `runSelfTest` takes `loopback` and `clock` to reuse, so nothing plays or is measured twice. The self-test adds only its count-in. On speakers there are four stages: Timing, Learning your click sound, Pitch check, Count-in check. On headphones there is one, Play along, and a line says the tone and count-in need the speakers. The standalone `SelfTestPanel` is gone. The result shows the delay and what it means. Pitch, clicks and count-in results sit on their stage rows; a failed row says what to do. The other checks are listed below in plain words (Audio speed, Mic effects off, Screen speed), each failure with one line and each skip with its reason. Recalibrate and Export diagnostics are secondary actions. A failure names its stage ("Stage 1, Timing, didn't pass."), and a run that threw names the stage it stopped in. One polite live region announces the stage line, which changes per stage only. An unmeasured clock now reads as Skipped with a reason, not Passed.
- **Chosen: the audio check runs inside calibration.** A separate button made the player run calibration twice without knowing it. Inside the flow it adds only about 2.5 s of count-in, which is a named stage, and the result is a single list.
- **Unchanged.** What is measured, the thresholds, the click counts, the random gaps, and config/. Tick stays selectable as a legacy value; its template clicks still play (they add to Tick's own template), so the template stage is never skipped and reads "6 more clicks". The home banner's "It takes {seconds} seconds" now comes from the plan.
- **Tests.** `calibration.test.ts`, on FakeAudioBackend:
  - each mark lights exactly at its audible time for timing, template and tone, before its verdict;
  - stage lines come in order, each between stages;
  - with no reported latency, a mark lights at the scheduled time;
  - the self-test reuses the run, with no second set of clicks or tone, and shows the count-in as its own stage;
  - the plan's counts match the config for speakers, headphones and zero template clicks;
  - play-along marks light when audible;
  - an unmeasured clock reads as skipped.

  `calibration.test.tsx` covers the reducer's sounding and settle states, stage statuses, the live region text per stage and that there is only one, the stage named on a thrown run, the result with stage-row failures and the check list, headphone skip reasons, Recalibrate and Export diagnostics. Updated: the existing card tests for the new copy and button order. The SelfTestPanel test was replaced, since the panel was removed.
- **Screenshots.** `docs/screenshots/calibration-stages/`: before Start, timing, template, count-in, result, a failed check, a failed timing stage, and headphones before and after. Desktop and phone, light and dark, reduced motion. The card was driven with the test services, because the fake microphone hears no clicks.

## Beat line

Owner report (baritone, Mac, Chrome, built-in speakers): the bar-to-bar highlight did not help, and he was not sure the metronome followed the tempo. His recording (72 bpm, 3/4, 30 clicks) had every click 102 ms after its scheduled time with no jitter, so the clicks were steady and on tempo; what moved on screen was not on the same clock.

- **What was out of sync.** Three clocks drove the try screen. The count-in track and the hand-over to the music (track gone, first-note pulse, beat dots on) followed the session's `count-in` events and `performing` state, which fire when the context clock (`currentTime`) passes a click's time, polled every 20 ms: that is up to the output latency *before* the click is heard (about 35 to 40 ms in headless Chromium; unknown on the owner's Mac). The bar tint, "Bar n of 8", the beat dots and the page turns followed the follower's `clock` events: capture time minus the latency compensation (100.86 ms in his trace), delivered after the block reaches the worker. That is about `compensation + delivery - output latency` *behind* the click, roughly 60 to 90 ms on his setup, refreshed at most 60 times a second. A click was therefore lit early in the count-in and late in the music. Practising without listening has no follower, so nothing moved at all: no bar number, no dots, no page turns. The "highlight one bar ahead of the text" in 01-ux §16.4 was not a clock bug: both read the same beat; in a pickup the text said "Bar 1" over the pickup bar.
- **Now.** One frame loop (`src/app/screens/perform/beat-driver.ts`, pure maths in `beat-clock.ts`) reads `AudioBackend.audibleNow()` every animation frame. A click at time t is drawn when `audibleNow() >= t`. It moves the beat line and the playhead (page turns, fading of systems already played) straight in the score frame, with no React render, and tells React only when the count-in click, the beat in the bar or the bar number changes (once per beat). The follower's clock moves nothing on screen any more. The timing comes from a new read-only getter, `PracticeSession.takeClock` (t0, bpm, count-in beats; additive), with a fallback from the `count-in` event's click time for sessions without it. The composition root passes `audibleNow` and `setBeatLine` to the practice screens.
- **The beat line.** The bar tint is removed from the overlay (`SvgOverlay.setPlayhead` keeps only the invisible marker and the fading). `ScoreFrameController.setBeatLine(beat)` draws one thin vertical line (`--metro-active`, 0.14 sp, one staff space past each outer line) behind the ink. It follows `layout.beatToPoint` plus half the notehead width (interpolated between onsets), so it crosses each notehead's centre at its written time, jumps across barlines and to the next system at a break. During the count-in it waits at the first note (the pickup, or bar 1 beat 1 when a rest comes first) while the track counts. Under reduced motion it steps on each beat. "Use the system setting" for Reduce motion now also follows the operating system's preference (it read only the app's own attribute).
- **Switch.** "Beat line" in the try's status strip (a line before the label; the line alone on phones, 44 px target) and in Settings > Practice, stored as `display.beatLine`, default on. Off: nothing moves on the staff. `play.status.barAhead` is removed (the highlight it described is gone).
- **Audio audit.** For every meter in `config/levels.json`, at 40, 72 and 132 bpm, the production metronome's buffer starts and the fake backend's clicks are `t0 + k * 60 / bpm`, accented on each bar's first beat. 6/8, 9/8 and 12/8 click the dotted quarter (2, 3, 4 per bar); 3/8 and the odd eighth meters click eighths; x/2 click halves. The shown tempo is the scheduled tempo in the clicking unit. Found and fixed: the half-note unit for 2/2 and 3/2 (written decomposed by `beatUnit`) was not drawn by `BeatUnitText`; the score's accessible label always said "♩". Found, not fixed: `levels.compound.subdivisionClicks` (02 §2.4: compound meters at difficulties 4 and 5 "with subdivision clicks") is not implemented anywhere; adding clicks would change click-bleed removal in `src/dsp`, so it needs a decision. The x/16 meters in `levels.json` count sixteenths but would show "♪"; no x/16 excerpt ships.
- **Same commit.** The count-in track can now re-render from an animation frame rather than an event, so `ScoreFrame` applies the starting-pitch dimming and the first note's ring in layout effects: the first count-in cell and full ink appear in the same frame.
- **Not changed.** A short desktop window with one system slot (1280 x 720) turns the page a bar before the system ends (04 §4.3); for that bar the line is on the system that has just left the screen. The e2e reports those beats as off-page.
- **Tests.** `beat-line.test.ts`: with the fake backend at output latency 0, 30 and 100 ms, at each click's audible time the line is within 1 px of that beat's x (the notehead centre where a note starts) for 2/4, 3/4, 4/4, 6/8, and pickups in 3/4, 4/4 and 6/8 (eighth-note pickup included); bar and beat numbers match the click; at a click's scheduled time with 100 ms latency the line is still 100 ms short; count-in clicks light only when heard; reduced motion steps; system break; hidden when off. `meter-clicks.test.ts`: the audio audit above. `perform.test.tsx`: the track waits for the sound even when the session event is early, the band stays until the downbeat is heard, the line moves every frame with no React commit, the strip changes once per beat, the follower clock no longer moves the strip, the switch and the setting, reduced motion. `e2e/design/beat-line.spec.ts`: Chromium (desktop, phone, phone with reduced motion), practising without listening, every frame recorded for 7 bars; at each click the line is within 1.5 px of the rendered notehead (measured 0.0 to 0.3 px), it waits at the first note through the count-in, steps under reduced motion, and the switch hides it. Headless Chromium's `audibleNow` ran 31 to 42 ms behind `currentTime`. Updated: `svg-overlay.test.ts` (no tint), `perform.test.tsx` (the bar-wash test now checks no wash), `store.test.ts`, `settings.test.tsx`, `BeatUnitText.test.tsx`.
- **Screenshots.** `docs/screenshots/beat-line/`: count-in, try, try with the line off; desktop and phone, light and dark.
- **Not verified without the owner's Mac.** That Chrome on macOS reports `getOutputTimestamp` (or `outputLatency`) close to the real speaker delay, so that `audibleNow` lines up with what he hears; the e2e proves the screen follows `audibleNow`, not that `audibleNow` is right on his hardware. The calibration's measured round trip is not split into input and output, so it cannot correct the output part.

## Listen playback

Owner report (baritone, Mac, Chrome, built-in speakers; `arne-lc8871933-voice-m37-44`, difficulty 1, C major, 3/4, 64 and 72 bpm): "The Listen playback didn't match the written notes at all", and he asked for the notes to light up. Until now Listen had only been checked by inspecting scheduled nodes. This time the app's real output was recorded in Chromium (a tap on every node feeding the destination), from the production build before and after, and each of the 16 notes was measured: when the new pitch is heard (YIN in 25 ms frames), the level onset, and the pitch over the steady part.

- **What was wrong.** The pitches were right: no octave or transposition slip, right sample, right rate and tune sign, MP3 priming handled, loop points clean, tempo and clicks on time, pickups and rests right. What he heard was wrong in four ways.
  1. *Level.* Listen ran at −24 dBFS peak (notes about −33 dBFS RMS), 23 dB under the clicks it plays with and 12 dB under the starting pitch: `LISTEN.peak` applied −12 dB and the Listen bus applied it again. Low baritone notes at that level on laptop speakers are mostly lost; the clicks were what he heard. `LISTEN.peak` is now 1 (the bus's −12 dBFS ceiling, once). Match a note used the same constant and is louder by the same 12 dB.
  2. *The first Listen was not his voice.* The instrument's set was loaded only on hovering a picker row, so the first press on the read-through played the additive fallback tone. The session now loads the set when an excerpt is prepared, and each sound control waits (up to 3 s) for it before it plays; Stop during the wait cancels.
  3. *Late, smeared starts.* The baritone's new pitch was heard 40 to 90 ms after its click (mean +50 ms), the cello's 75 to 230 ms (mean +111 ms): slow sample attacks (the voice's 70 ms rise times the sampler's 70 ms ramp; bowed starts up to 300 ms) plus a 250 to 350 ms release that covered the next note's first 150 ms. The sampler now skips a sample's start below −15 dB of its attack level and starts each source early (at most 80 ms) so it reaches −6 dB at the written time, and in a run of notes (`playSampledNotes`, which `playNotes` calls) each release ends before the next note sounds (at least 30 ms).
  4. *Unclear voice pitch.* The formant voice scooped 20 cents into each note and swung ±25 cents of vibrato (50 cents peak to peak) with audible breath. The six voice sets are regenerated (`build.py voices`): no scoop, ±8 cents of vibrato from 0.4 s, 20 ms rise, breath −38 dB, loops on whole periods and vibrato cycles. Same sizes (1,787,422 bytes in all). Every voice sample now holds within 1 cent of its note from 20 ms on; `build.py check` worst voice error 1.1 cents.
- **Measured, before → after.** Recorded app output (production build, Chromium): the first Listen first played the fallback tone at −24 dBFS, now the baritone voice at −11 dBFS (clicks −1 dBFS); with the voice, the new pitch was heard a mean +48 ms after its written time at 64 bpm (+52 ms at 72, max +88), and the cello's +111 ms (max +195). The live recording drifts about 0.2% against the context clock (a capture artefact, the clicks drift with it), so the after values are taken from the exact offline render of the same plans through the same files (`listen-render.spec.ts`; old code and files from HEAD through the same harness): baritone 64 bpm onset max +55 → +1.3 ms (mean +37 → +0.3), 72 bpm +54 → +1.0, Hear bars +53 → +1.0, trumpet +21 → +1.7, cello +72 → +19, soprano +53 → −2.5, flute +42 → −1.0; peaks −24 → −11 dBFS (trumpet and cello −20 → −8); pitch within 0.1 cents for the voices, 5 cents for trumpet, before and after (the pitches were never wrong). Starting pitch (C4 E4 G4 chord then C4), Play my range and Hear the key: right pitches, now at the Listen level.
- **Sample tunes.** Skipping a sample's quiet start moves which part of it a held note plays, which pushed two marginal renders in `e2e/audio/sampler.spec.ts` over 10 cents (tuba D1 10.4, violin E7 −11.0). Their `tune` values had been measured over 0.25 to 1.5 s, mostly attack; re-measured from 0.3 s to the loop end (what a held note plays): tuba F1 −16.7 → −8.2, violin B6 +0.7 → −5.3, choir C3 −24.7 → −20.6. No other sustained sample moves by more than 4 cents.
- **Test.** `e2e/audio/listen-render.spec.ts` (audio suite) prepares real corpus excerpts as the session does, takes the session's Listen (and Hear bars) plan, renders it through `playSampledNotes` with the real MP3s in an `OfflineAudioContext`, and asserts every note within 15 cents and 30 ms (level reaching half the note's early peak), a peak between −16 and −0.5 dBFS, and silence after the end: baritone at 64 and 72 bpm and Hear bars, trumpet, cello with a pickup, soprano, flute. Measured: worst onset +19 ms (cello), worst pitch 5 cents.
- **The sounding note.** While Listen, Listen first, Hear bars and Hear what we heard play, the written note sounding glows: a brass-wash disc with a brass outline behind the notehead (and, on the clean read-through, the head in brass ink). It is driven from the backend's clock as heard (`audibleNow`), one animation frame loop per playback, with no React render per note. The session puts the playback's notes on the sound view once (`SoundView.notes`: expected index, event ids, clock start and written end, and the heard clock); a rest shows nothing; Hear what we heard lights the written note each heard note was matched to. In the scrolling arrangement (phones) the line that sounds is scrolled into view at a system change. Reduced motion steps without the fade. Stop clears it. The SoundPlayer's caption timers (the starting pitch's first-note ring, the bar wash) now also fire when their time is heard, not when it is scheduled.
- **What was added for the merge with the beat line.** Additive only, nothing in the playhead, bar tint, `controller.ts` or `svg-overlay.ts`: a new file `src/ui/score-frame/sounding-note.ts` (+ `sounding-note.css`) with `SoundingNoteLayer` (draws `.sf-sounding` circles in the system underlays and sets `data-sounding` on the noteheads it inks; reads only the controller's public `info` and `arrangement`), `SoundingNoteDriver` and `spanAt`; one new `ScoreFrame` prop, `sounding`, with its own effect; exports in `src/ui/score-frame/index.ts`; the prop passed from `ScanScreen` (via `useReadSounds().sounding`), `Review`/`SessionReview` (`ReviewExtras.sounding`), `ResultsScreen` and `AttemptScreen`.
- **Tests added.** `sampler.test.ts` (onset alignment, runs of notes and their releases), `sounds.test.ts` (captions as heard, the notes on the view), `practice-session.test.ts` (the set loads at prepare, Listen waits for it, Stop while loading, peak 1, the spans against the expected notes and rests), `src/ui/score-frame/sounding-note.test.ts` (fake clock with 150 ms latency: each note on at its audible time and off at its written end, a pickup in the lead-in bar, a rest; the layer in a real frame across a system break, reduced motion, phone follow), `e2e/tour/listen-highlight.spec.ts` (the owner's excerpt in the production build at four sizes and themes: each of the 16 notes lights in order 0 to 2 frames after it is heard, nothing in the lead-in, Stop clears). Updated: `listen-plan.test.ts` (the old test asserted the double −12 dB), two sampler and one backend test for the earlier start.
- **Screenshots.** `docs/screenshots/listen-highlight/`: the read-through during Listen, desktop and phone, light and dark.
- **Needs a human ear.** The new voice timbre (is it a clearer "ah", is ±8 cents of vibrato natural enough), the Listen level against the clicks on the owner's MacBook speakers, the cello and trumpet starting slightly before the click by the pitch measure, and whether `audibleNow` on his Mac matches what he hears (the highlight follows it).

## Note colours

PLAN R69. The owner chose option A of `docs/redesign/note-colours/04-proposal.md` (coloured noteheads), with the setting off by default. Option B's chip band, the fade by difficulty and scale-degree mode were not built.

- **How it works.** `src/notation/note-colours.ts` maps a written pitch to its letter (`noteLetter`: the step, whatever the alteration or octave). The renderer tags each note's `<g>` with `data-letter` (from `writtenPitch`, so a B♭ clarinet colours the note on its page, not the concert note); rests get none. `src/app/appearance.tsx` sets `data-note-colours="on"` on `<html>` while the setting is on, and `src/ui/note-colours.css` (imported by `App.tsx`) fills `.sr-note .vf-notehead > text:first-child` with `var(--head-<letter>)`. VexFlow draws a note's dots and articulations inside its notehead group after the head glyph, so only the group's first text is coloured; stems, beams, flags and accidentals are outside it. Half and whole heads are outline glyphs, so the outline takes the colour. A note with a slip class (`n-error`, `n-error-hollow`), `n-correct`, `data-sounding` (Listen's sounding note) or `data-brass` (the starting pitch's first note, set in `controller.ts`) keeps its own colour. Match a note tags its whole note the same way (`.mt-head[data-letter]`); once hit it is green as before. Off, no rule matches and nothing changes: the e2e spec checks every head's computed fill is ink.
- **Setting.** `display.noteColours` (types, generated schemas and the export validator, `defaults.ts`, `settings-read.ts` reads a missing or non-boolean value as off). Settings › Display › "Note colours" with the hint "Fills each notehead with its letter's colour on every score. Sharps and flats keep their letter's colour." and a colour key under the hint: seven small heads (filled with the same tokens) and their letters, `role="img"` with the label "Colour key: C red, D orange, E yellow, F green, G blue, A purple, B pink". Ranked rules are unchanged.
- **Notehead colours.** Light values are the proposal's chip edges (each at least 3:1 on light paper); E is a golden yellow (`#A08600` instead of the olive `#9C8E11`) and B one step deeper (`#C8507C` instead of `#CC5A82`, 4.22:1 instead of 3.86:1) so they read as a filled head. Dark values are the proposal's dark fills. High contrast darkens the light values (and lightens dark C and A) to at least 4.5:1. Ratios against the paper (`#FFFDF8` light, `#24221F` dark):

  | Letter | Light | Dark | High contrast light | High contrast dark |
  | --- | --- | --- | --- | --- |
  | C red | `#C5193D` 5.77 | `#D96272` 4.49 | `#A8102F` 7.43 | `#E8808E` 5.98 |
  | D orange | `#C96805` 3.78 | `#FABC86` 9.52 | `#A35300` 5.44 | `#FABC86` 9.52 |
  | E yellow | `#A08600` 3.50 | `#FBEB75` 13.03 | `#766A00` 5.39 | `#FBEB75` 13.03 |
  | F green | `#528918` 4.17 | `#96D35F` 8.90 | `#3F6E0F` 5.99 | `#96D35F` 8.90 |
  | G blue | `#0470A5` 5.34 | `#71BAE9` 7.48 | `#04608F` 6.72 | `#71BAE9` 7.48 |
  | A purple | `#9A389F` 6.00 | `#B46CB2` 4.33 | `#86308B` 7.35 | `#C78AC5` 5.95 |
  | B pink | `#C8507C` 4.22 | `#FBC2D6` 10.42 | `#A83F66` 5.79 | `#FBC2D6` 10.42 |
  | greyed (wrong note, colours on) | `#8C877D` 3.52 | `#8E8981` 4.57 | `#6B6863` 5.46 | `#A09B93` 5.75 |

- **Grey heard notes.** `ghost` was violet (`#6C3FC4` / `#BBA4FF`, high contrast `#5523B0` / `#CDBBFF`); it is now a neutral grey in every theme: `#5F5B55` light (6.63:1; 3.30:1 at the 70% past opacity), `#B5B0A7` dark (7.35:1; 4.33:1 at 70%), high contrast `#4A4743` / `#CFCAC1`. It applies always, colours on or off: the ghost heads, their accidentals, arrows and tails, the "+" extras and the overflow count. `ghost-replay` was already grey (`#6B6863` / `#A09B93`) and keeps its dashed outline. Forced-colours mode still maps `ghost` to `LinkText` (a system colour the user chose, not a theme). The contrast test now also checks that `ghost`, `ghost-replay` and `head-greyed` are neutral (largest minus smallest channel at most 16) in every theme. The claimed ratios of `ghost-on-paper` and `ghost-70-on-paper` and the two `generate-tokens` assertions of the violet values were updated; no threshold changed.
- **Wrong notes on a coloured score (decision).** With note colours on, a written note marked as a slip turns `head-greyed`, head and stem together (the overlay now writes `var(--note-slip, var(--error))`, and `note-colours.css` sets `--note-slip` to `--head-greyed`), so it loses its letter colour and reads "greyed out". Its lane mark (✕, early, late, sharp, flat, the missed ring) stays error red: that is the "wrong" cue by shape and colour, and a red C head never looks like a mistake. The heard ghost is the same family of grey but stays distinct: a translucent head (40% live, 55% review) with a darker outline, cue-sized with its accidental when it needs one, offset right with its arrow and (in review) a stem and tail; the written note is a solid lighter grey in its own place. With note colours off, a slip's written note stays red as before. The sounding-note brass (Listen) and the first-note brass win over a note colour; the beat line is a 1.5 px brass line and reads over any head; the green dot and the red marks sit in the lane under the staff, never on a head.
- **Point 4: no green marks on a perfect try's marked score.** Reproduced in `visual-states.ts`: `noteVisual` returned no lane glyph for a correct note in review, by design (06-design-spec D7, "correct notes stay ink in review and get no lane mark"). It was intended at the time, but it made "My marks" of a perfect try identical to "Clean score", while the try itself shows a green dot under each right note and the counts line offers "Showing: right notes". Treated as a bug for the owner and fixed (R69 amends D7): review now draws the same green dot under each right note (the head stays ink, or its note colour). Tests: `visual-states.test.ts`, `svg-overlay.test.ts`, `Review.test.tsx`, and the tour spec counts one dot per right note on the results.
- **Point 5: the orphaned last bar.** A 3-bar scale was split [2, 1] on desktop (the xl row puts `ceil(N / 2)` bars a system) and on the phone (2 bars a system). `balanceSystems` (`src/ui/layout-table.ts`), applied by `balancedPlan` in `controller.ts` before the purpose's staff space is chosen: a piece of up to four bars goes on one system when the staff space stays at or above 80% of the purpose's token (never below the row's minimum) and the joined bars leave every drawn note about 2.2 staff spaces; otherwise a lone last bar joins the system before it when that costs no staff space. When a system is narrower than 14 staff spaces a bar, `squeezeWidths` (`src/notation/layout.ts`) now shares the width by what each bar holds (a bar of four or more notes a full share, a lone whole note half) instead of evenly; a squeeze of busy bars is unchanged. The five-note scale is now one system everywhere: desktop at the full staff space; phone read-through at about 8.6 px (token 9.5) and phone try at about 9.9 px (token 11), at the widths in `short-pieces.test.ts`. Longer pieces are unchanged (8 bars still [4, 4] and [2, 2, 2, 2]; 4 bars on a phone read-through still [2, 2]). Tests: `src/ui/score-frame/short-pieces.test.ts`.
- **Tests.** `src/notation/note-colours.test.ts` (all letters, every alteration and octave, a B♭ clarinet part tagged with written letters that differ from the concert ones, the head is the notehead group's first text), `src/store/store.test.ts` (default off, older records, export round trip), `src/app/screens/settings/settings.test.tsx` (the row, the key, storing it), `src/app/App.test.tsx` (the root attribute), `src/ui/tokens.contrast.test.ts` (every head and the greyed head at 3:1 and 4.5:1 high contrast, seven distinct letter colours, grey marks neutral), `src/ui/score-frame/short-pieces.test.ts`, `e2e/note-colours.spec.ts` (default `pnpm test:e2e`, Chromium: off by default with every head ink, on with every head's computed fill equal to its letter's light value and stems ink, off again), `e2e/tour/note-colours.spec.ts` (tour config: the scale on one system, heads coloured, the wrong note greyed mid-try and on results, the ghost grey, one green dot per right note).
- **Screenshots.** `docs/screenshots/note-colours/`: `settings`, `read-through`, `try-wrong` (the five-note scale with E3 sung as F♯3, "Show played notes live: Always"), `results`; desktop and phone, light and dark. `docs/screenshots/scales/` was re-captured (the scale is now one system).
- **Not verified.** Colour vision: the head colours were only checked by contrast; the CVD simulations in `03-design.md` apply (dark D and F are close under red-green deficiency and need the staff position). The light values were not seen on a real phone screen in daylight. On the phone try, the cue-size ghost of a wrong note can touch the next written note when bars are tight; this predates R69 (the old 2-bar phone systems were as tight per note). The trademark and patent check of the rainbow-from-C order (`01-research.md`) is still open before any public release.

## Scale try experience

PLAN R70 to R73. Owner report (baritone, Chrome on a Mac, built-in speakers and mic; Practice › Scales › five-note scale in C, ♩ = 66, 4/4): the count-in seemed to go twice and the screen said "Sing" in its second bar; an orange mark on the first note was weird; a highlight window was not aligned; the line should be an obvious switch; the line seemed miscalibrated and slowed down in beat 4; a right note should glow; a wrong note should show the note sung, not just an ✕; the note colours were too pastel.

- **Reproduced.** The production build in Chromium with the fake microphone (tour config, Speakers and Wired headphones), a screenshot about every 150 ms from Start to the end of bar 1 at 1440 x 900 and 390 x 844, each frame looked at, plus a frame recorder (the audible clock and the beat line's x every animation frame). His own try trace was read where it sits (not copied): 8 count-in clicks at 66 bpm (2 bars), his first sung note 0.1 s after the first click, the per-try recheck measured 96.7 ms (calibration 95.5 ms).
- **1. Count-in.** At HEAD: 2 bars at difficulties 1 to 3 (and at any tempo below 66 bpm, `countIn.slowBars`). The track always showed "— Sing" at its end from the first click (`CountInBand` rendered the entry word, only its underline waited), and from the second bar's first click the first note got a brass disc with "Sing" over it (`firstNoteName = entry` in `PerformScreen`), with "Come in after 4" in brass. So "Sing" was on screen for the whole count-in and on the staff for its second bar. With a speaker route and a microphone that does not hear the first click (the fake device here) the session also restarts the count-in once ("first click missing"), so the count-in really did run twice, and "Restarting the count-in" stayed in the strip until bar 1; his trace shows no restart (8 clicks, recheck measured). Now: `countInBars` 1 at every level and `slowBars` 1 (`levels-1.1.0`); the track is a plain 1 2 3 4 in one grey tone, titled "Count-in: listen to the beat" with the tempo ("Come in after 3" only before a pickup); the entry word is out of the flow (the count stays centred) and hidden until the go beat, the music's first beat on the heard clock (`VisualBeat.go`), when "— Sing" shows and the track then leaves; "Restarting the count-in" clears at the new count-in's second click. The recheck needs 3 clicks now (`measurement-budget.json` `recheck.minClicks` 4 → 3), so a one-bar 3/4 count-in still measures; 2/4 and compound meters click twice in a bar and cannot recheck (as above difficulty 3 before). The calibration's own count-in stage was already one bar. Other 2-bar assumptions updated: the read-through's "When you start" line, the scale and session tests, the design and owner-review e2e specs.
- **2. First-note mark.** Removed during the count-in and the try: no brass disc or name (`highlightFirstNote` only while the starting pitch plays the note) and no downbeat pulse (`pulseFirstNote` and `FIRST_NOTE_PULSE_MS` deleted). The starting pitch still marks the note it is playing, before the first click.
- **3. The highlight.** No bar tint was left. What changed with the beat on the scale path at HEAD, found by the new e2e's mutation and style recorder: (a) the downbeat pulse, a brass-wash disc 1.6 staff spaces wide drawn around the first head for 300 ms from bar 1 beat 1 while the line was already moving right of it (the "window" that was not aligned); (b) the brass disc with "Sing" on the first note through the second count-in bar; (c) the strip's beat dots (`dom-beat-dot`, one brass dot per beat), which changed computed style every beat; (d) the brass second count-in bar. Not involved: dimming (starting pitch only, never in the count-in), the sounding-note disc (Listen only), the playhead marker (invisible). Now the beat dots are gone from the try strip ("Bar n of 3" stays, text at the barline), (a), (b) and (d) are gone, and the e2e fails if anything else changes per beat.
- **Also found in the frames.** For the first 0.4 s after Start the starting-pitch card already said "Count-in next" with every step ticked and the brass ring on the first note, then went back to "Key chord" (the reference was scheduled but not yet heard, and the screen read that as "already played"); it is pending now until it is heard.
- **4. Switch.** "Beat line" is a switch (role switch, the Toggle) in the try strip (the track alone on phones, the label its name), on the read-through under Start (desktop) or above it in the dock (phone), and in Settings › Practice, all one setting, `display.beatLine`.
- **5. Line motion.** The line was `beatToPoint(beat).x` plus half a head: inside a bar it went from note to note, and in a bar's last beat it went from the last head to the bar's closing barline anchor, then jumped across the barline at the downbeat. Measured from recorded frames (Chromium, default e2e, 1280 x 720, desktop practised without listening): HEAD px/s per beat 101.4 101.2 101.1 **49.3** 101.1 101.1 101.1 **53.9** 48.2 48.2 48.2, a 48.6 px jump at each barline; now 101.2 101.1 101.1 101.6 101.1 101.1 101.1 106.2 44.3 44.3 44.4, largest frame step 1.8 px (one frame at 101 px/s is 1.7 px), and the line crosses each head within 1.5 px at its beat. The head-to-head spacing gives 101.1 101.1 101.1 101.5 101.1 101.1 101.1 105.4: the engraving's spacing is near-uniform here, so the line is steady through bars 1 and 2; the whole note in bar 3 is spaced narrower (it goes to the end of the staff over four beats, 44 px/s), which is the speed the engraving forces. The tour layout, sung through the fake microphone (production build, screenshots taken every 150 ms, which stall some frames): at 1440 x 900, HEAD 104.8 104.7 104.9 126.4 104.7 104.8 104.7 131.2 65.3 with a 49.5 px jump at the barline, now 103.6 104.7 104.7 178.2 104.7 104.7 104.7 183.3 45.7 with no jump (largest step 12.1 px, a stalled frame during a screenshot); at 390 x 844 (phone), HEAD 25.4 25.3 25.3 **21.7** 25.3 25.3 25.3 24.3 7.1 with a 27.6 px jump (a whole beat of travel at once), now 25.3 25.3 25.3 51.6 25.3 25.3 25.3 54.3 4.9, largest step 1.5 px. So the slow fourth beat and the jump are gone everywhere; at these two widths the engraving puts the barline's padding inside the fourth beat (the gap from beat 4's head to the next bar's first head is 1.7 beats wide at 1440 and 2 beats on the phone), and the line crosses that gap at 1.7x and 2x its speed in the rest of the bar. That is what the engraving forces; evening it out would mean changing VexFlow's bar spacing for every score, which was not done. Now the line's path (`src/ui/score-frame/beat-line-path.ts`) is the head centres at their beats and each system's end at its last beat, linear in time between them, so it goes from each head to the next across barlines and jumps only at a system break. Time-proportional spacing for the line inside a bar was considered and not used: it would stop the line passing heads at their beats wherever the engraving is not even, and on this scale the head spacing is already even within 0.5%. **Beat line timing**: Settings › Practice, a slider from −150 ms (Earlier) to +150 ms (Later) in 10 ms steps, default 0 ("0 ms, as your device reports"; "40 ms earlier"; Reset), stored as `display.beatLineOffsetMs` (normalised: clamped, rounded, missing reads 0; exported). It shifts the clock every heard-clock visual reads: the composition root's `audibleNow` for the try screen (line, count-in track, go beat, bar number, page turns) and `SoundPlayer.visualOffsetSec` for the sounding note and the sound captions. Audio scheduling and judging do not use it.
- **6. Right-note glow.** The colour: cyan `#00E5FF` (`--glow`), with a thin edge `--glow-edge` (`#00707C` on light paper, 5.72:1; `#B8F7FF` on dark, 13.44:1) and the dot `--correct` in the edge's teal (`#00707C` light, 5.72:1; `#4FE3F2` dark, 10.28:1; high contrast `#005A63` / `#8FF0FA`). Why cyan: it is the one bright hue none of the seven note colours, the error red, brass or the greys is near (at least 94 CIELAB units from every note colour), it reads as "lit" on both papers, and the edge carries the contrast on light paper where a bright cyan alone is 1.5:1. A white-gold halo was rejected because gold is close to brass (the beat line and the count-in). The halo sits behind the head (in the system's underlay), so the head keeps its ink or note colour; it is drawn the moment the note is judged right, live, and on "My marks" in review; the dot stays as the shape cue. It pops in over 260 ms; under reduced motion it is static.
- **7. Heard note.** At difficulty 1 with the default "From difficulty 4", R61's filter dropped every ghost live, so a wrong note showed only the red head and ✕. Now the heard note of a wrong-pitch, sharp, flat or octave note always draws live (extras and timing ghosts still follow the setting) and in review. A wrong note whose pitch is in the key is drawn on its own letter (`heardOnItsLetter`, `theory.spellInKey`): E3 sung as F3 in C major was drawn as E♯3 on the E line (ruling 50 spells a slip within a semitone on the written letter); now it is F3, a step above, beside the written E. A sharp or flat note on the right letter is drawn a quarter of a staff space above or below, offset right, with an up or down arrow (kept under the density brake). The ✕ and the ▲/▼ stay in the lane: they name the slip under the written note, and the heard note shows by how much. A missed note keeps its ring.
- **8. Colours.** C `#FF0000`, D `#FF8000`, E `#FFD500`, F `#00AA00`, G `#0066FF`, A `#8800CC`, B `#FF1493` in every theme (the high-contrast overrides of the heads are gone). Each coloured head has an ink outline (`--head-outline` = ink, 17.3:1 light, 13.1:1 dark; `stroke-width: 0.045em`, painted under the fill), also on the Settings key and on Match a note. Fill contrast alone on light paper: C 3.93, D 2.48, E 1.40, F 3.06, G 4.75, A 7.08, B 3.58; on dark: 3.97, 6.30, 11.16, 5.10, 3.28, 2.21, 4.36. Smallest CIELAB distance between two fills 40 (C–D); to the error red 29 (dark error `#FF7A52` vs D), to brass 38, to the glow 94. `tokens.contrast.test.ts`: the head-on-paper pairs were replaced by the outline pairs (3:1, 4.5:1 high contrast) plus tests that the outline is ink, that the CSS draws it, that the seven fills are at least 35 apart and bold (a channel ≥ 0xAA, the lowest ≤ 0x20), and that each is at least 25 from glow, glow-edge, correct, error, brass, the beat line and the greys.
- **Woodblock clicks (report only).** In his trace every Woodblock click was detected as a note (MIDI about 68.05, 50 to 60 ms, `steadyMs` 0): the four count-in clicks and three during the try (bar 2 beat 1, bar 3 beats 1 and 3). The one on bar 2 beat 1 (detected note 28, onset 25 ms before the beat) was matched to the expected G3, live and in the final alignment, where it was judged a wrong pitch from the pitch that followed it; none became an extra. `src/dsp` and `src/follow` were not changed.
- **Tests.** Unit: `beat-line-path.test.ts` (head to head, no jump at the barline, per-beat speeds, held notes, system break), `beat-line.test.ts` (on the real layout: forward every 0.01 beat, never faster than the widest head gap; mid-beat between the last head and the next bar's first; the go beat), `count-in-band.test.tsx`, `perform.test.tsx` (one bar, nothing says Play/Sing or marks the first note before bar 1, the go word on the downbeat only, no beat dots, the switch, ghosts at difficulty 1, sharp/flat arrows, restart status), `model.test.ts`, `scan.test.tsx` (the switch on the read-through), `settings.test.tsx` (the slider), `store.test.ts` (offset normalising and export), `sounds.test.ts` and `compose-round2.test.ts` (the offset moves the visuals and not the audio), `svg-overlay.test.ts` (glow live and review, reduced motion, cleared; sharp above and flat below with arrows; R50/R71 spelling), `heard-spelling.test.ts`, `Review.test.tsx` (glow under every right note in My marks), `tokens.contrast.test.ts`, `configs.test.ts`, `calibration.test.ts` (three clicks measure, two do not). E2E, default `pnpm test:e2e`: `e2e/scale-try.spec.ts` (the scale path in Chromium: 4 count-in clicks, "Sing" only on the go beat, no first-note mark, a mutation and computed-style recorder that fails on any change per beat but the line, per-beat speed from recorded frames, and a run at +100 ms timing), `e2e/note-colours.spec.ts` (bold values and the ink outline). Tour: `e2e/tour/scale-try.spec.ts` (sung with E3 as F3 and F3 47 cents sharp; glow live and in review, both heard notes at difficulty 1, screenshots). Updated honestly: the 2-bar count-in, first-note ring, pulse, beat dots, colour values and brake-arrow assertions.
- **Screenshots.** `docs/screenshots/scale-try/`: `count-in-beat-3`, `bar1-glow`, `heard-notes`, `results-my-marks`, `read-through`, `settings-practice`, `settings-display`; each with `colours-off` and `colours-on`, desktop and phone, light and dark.
- **Not verified.** Anything on the owner's Mac: whether Chrome there reports an output latency that matches his speakers (the timing slider is the remedy, so it was not tuned), and how the bold colours and the cyan glow look on his screen. Colour vision: under red-green deficiency C/D/B and F are told apart by staff position and the outline only. On a phone try the scale is one system at about 9.9 px a staff space, and a heard note beside a written note can touch the next written head (as before R69).

## Bluetooth false positive

Owner report: Chrome on a Mac, built-in microphone and built-in speakers, no Bluetooth device; first-run setup said "This looks like Bluetooth audio".

- **Every place that decided or said Bluetooth (at HEAD).** (1) `warningsFor` (`src/app/screens/calibration/flow.ts`), the only one wired into a screen: the calibration card in onboarding and Settings › Audio showed `calibrate.warn.bluetooth` when the declared output was Bluetooth **or the run's round trip was above `grading.ranked.maxRtlMs` (120 ms)**, for accepted and rejected runs alike, and the iOS AirPods hint on the same condition. (2) `bluetoothBanner` in `src/session/gates/gate.ts`: label `/airpods|bluetooth|beats|headset|hands-free/i`, `inputKind === 'bluetooth'`, or round trip above 120 ms. (3) `bluetoothBanner` in `src/platform/web/ios/hints.ts`: the same label pattern or `rtlIsBluetoothClass` (above 120 ms). (2) and (3) are not called by any screen; the Home `bluetooth` banner kind and `States.BluetoothBanner` exist but nothing produces them. (4) `inputKindOf` (`src/platform/web/audio/route.ts`): label `/airpods|bluetooth|beats|headset|hands-free|hfp/i` makes `inputKind` `bluetooth`. Nothing read the sample rate, `outputLatency`, AEC suspicion or an empty label as Bluetooth.
- **His numbers against the rules.** Output declared Speakers in every export; `inputKind` `unknown` (2026-11-20 tries) and `built-in` (2026-11-22); a MacBook label matches no Bluetooth word. Loopback 95.5 ms, spread 0.11 ms, 10 of 10 clicks (2026-11-21); count-in rechecks 86.1, 96.7 and 100.9 ms; the 2026-11-19 self-test export 42.8 ms (spread 0.24 ms); reported latency 30.3 ms; context 48 kHz. So the label and declaration rules cannot fire on his Mac, and the only rule that can is the latency one, `rtlMs > 120` in `warningsFor`. None of the exported runs is above 120, so the run that showed the message is not in the exports: the self-test export does not say which warnings the card showed, nor the outcome of the run that raised them. The candidates, from the code: a rejected loopback (the warning was raised for failed runs too, and a rejected run's median lag can be anything from 15 to 400 ms), a play-along run after a failed loopback ("Play along instead"; its round trip includes how late the sung notes land, so 95 ms of audio plus a sung onset 25 ms late is over 120), or an accepted loopback in a session whose output buffering was 20 to 25 ms larger (his round trip moved from 43 to 95 ms between sessions). In every case the cause is the same rule: latency alone was read as Bluetooth, 20 to 25 ms above a clean MacBook measurement.
- **Added to the diagnostics export** (numbers and enum names only; no label, no device id): `shown` (the card's run: method, end step, accepted, failure, round trip, spread, and the warnings it raised) and `route.trackSampleRate` (the microphone track's own rate). Try traces' `device.route` now carries `trackSampleRate` too.
- **New rules** (`src/core/bluetooth-evidence.ts`, shared by the card, the session gate, the iOS hints and the web backend). "Bluetooth" only on positive evidence: the player chose Bluetooth output; or the input label matches `/airpods|bluetooth|beats|hands[- ]?free|\bhfp\b/i` or the upper-case word `BT` ("headset" alone no longer counts: wired and USB headsets use it); or the hands-free signature, an 8 or 16 kHz microphone track when the input label has changed from the first one this session (a low rate alone is not enough, some USB microphones run at 16 kHz). Never from latency. A round trip above 120 ms (`grading.ranked.maxRtlMs`, unchanged) from an **accepted** measurement shows the neutral `calibrate.warn.delay` instead, because above it tries are unranked (gate (g)) and the player should know why; at or below 120 ms the measured delay is subtracted from every note and nothing is shown, so his stable 95 to 101 ms with a 0.1 ms spread gets no warning. A rejected run shows no Bluetooth or delay warning from its round trip (its failure message says what went wrong). The iOS AirPods hint needs Bluetooth evidence. `src/grade` and the grading thresholds were not changed.
- **Copy.** `calibrate.warn.bluetooth` and `banner.bluetooth`: "This looks like Bluetooth audio, which can add a lot of delay. Wired headphones or built-in speakers usually work better." (was "... which adds a lot of delay. Tries won't earn XP. ..."; with a Bluetooth label and a measured delay under 120 ms tries do earn XP). New `calibrate.warn.delay`: "Your audio has a long delay ({ms} ms), so tries won't earn XP for now. Practice works as usual. If you use wireless headphones, wired ones usually help." `round2-spec.json` `changed` follows the new Bluetooth text.
- **Tests.** `src/core/bluetooth-evidence.test.ts` (labels, hands-free signature, the 120 ms boundary, his numbers from `src/core/bluetooth-evidence.fixtures.ts`), `calibration.test.tsx` (his numbers raise no warning, accepted or not, with `built-in`, `unknown` or no route; 180 ms with no evidence shows the delay message and not Bluetooth; a Bluetooth input still shows the Bluetooth message; the export's `shown`), `route.test.ts` and `web-audio-backend.test.ts` (hands-free route change), `gates.test.ts` and `hints.test.ts` (latency is a delay flag, not Bluetooth). No e2e asserted the old behaviour.
- **Not verified.** On his Mac: which run showed the message (the new `shown` field will say next time), the exact input label Chrome reports there, and the microphone track rate. Real Bluetooth routes (AirPods on a Mac, a Windows hands-free headset) were not tried on hardware.

## Pitch needle (PLAN R81)

Round 3 spec `docs/redesign/round3/03-pitch-steadiness.md`. Owner report: on the first-run pitch step the needle "is bouncing all around because of my voice".

- **Filter** (`src/dsp/pitch-steadiness.ts`, pure, a port of the spec's reference simulation). `SteadinessFilter` runs once per analyser frame (8 ms) in the worker's pitch mode (`PitchModeTracker`) and every posted frame (20 ms) carries its `reading`: gate −65 dBFS; tail gate (12 dB below the loudest of the last 500 ms is a dropout); dropouts bridged up to 120 ms, dimmed to 600 ms, then hidden; no needle until 60 ms voiced; glitch guard on the **unfolded** pitch (more than 300 c from the recent median is held up to 220 ms, then a new run), so an 11.6-semitone glitch never reads as +40 c after folding; a running median over `clamp(age/2, 40 ms, centreMs)`; an exponential smoother `tau = clamp(age/3, 10 ms, tauMs)` from the real frame interval; snap after 80 c for 100 ms; a detent. Two deliberate differences from the reference: the reading is unfolded MIDI (the screen folds it to the target), so at a new run the smoother starts afresh instead of gliding from the old place (an octave jump would otherwise sweep the folded needle); and a held glitch frame reads as a bridged gap. Presets (`STEADINESS_PRESETS`): Steady 300/150/400 ms, 4 c; Balanced 200/80/300 ms, 3 c; Quick 60/30/200 ms, 1 c (centre, smoother, judge, detent).
- **Decision** (`inTuneStep`, same file, run by the Match a note reducer per posted frame): enter when the judge median is within band − 5 c for 100 ms, leave beyond band + 5 c for 150 ms, or at once when the short centre is beyond 2 × band for 60 ms; bridged gaps keep everything; a dim/hidden needle or a new run resets. **Hit**: in tune 800 ms without a break **and** the median of those 800 ms within the band (PLAN R81). The band is the grading good band: difficulty 1 in onboarding, the player's difficulty on Practice › Match a note (the chosen difficulty, else the profile level; open question 3). The summary's mean is now the mean of the hold medians.
- **Screen.** Needle from the settled value, green only in tune; words: "Hold it…" in tune, otherwise low/high from the drawn needle's side with a 5 c dead band (and "Sing E3 and hold it." while the judge window is not yet full and the needle is inside the band); CSS ease 40 ms linear (0 under reduced motion). "You" line names the target within 50 c ("You: E3, a little low"), "much too low/high" past it with the nearest note, cents rounded to 5 appended only with Settings › Display › show cents (which defaults on, so most players see "(15 cents)"), refreshed at most 4 times a second. Wobble bar (10th to 90th percentile of the last 400 ms) on Steady and Balanced. After a hit, or a stop after a hold of 800 ms or more, the settled note is a grey head beside the target with "You sang: E♭3, a little high"; it goes when the player sings again. A dead needle dims at 120 ms and is hidden at 600 ms. The scoop tip (§6.4) was not built.
- **Setting.** `display.pitchSteadiness?: 'steady' | 'balanced' | 'quick'`, absent = by family (Steady for voices, Balanced otherwise); type, schemas, validator, normaliser (unknown values read as absent), export round trip, Settings › Display row with the chosen preset's sentence, and "Needle moving too much? Make it steadier" under the meter (Match a note screen only: the new onboarding "Hear you" stage does not use `MatchPanel`). A choice there is stored and the note plays again, since the worker reads the preset when it starts listening. `MatchNoteService` reads it through `deps.steadiness`.
- **T15.** `src/app/compose/pitch-steadiness-guard.test.ts`: the app composed with each setting (and none) sends the identical take `config` (DspConfig + FollowConfig) for a voice and a flute; no module of the try pipeline names the setting or filter; `DspConfig`/`FollowConfig` have no field for it; inside the worker only `PitchModeTracker` builds the filter. `src/follow`, `src/grade`, the segmenter, the pitch tracker and grading thresholds are unchanged; `pnpm gates` gives the same result.
- **Measured on the synthetic voice** (±22 c at 3.3 Hz after a 250 ms scoop from −200 c, through the real `PitchAnalyzer` and pitch-mode tracker at 16 kHz, 0.8 to 3.0 s, hits held off for movement): round 2 needle SD 14.1 c (fast movement 13.1 c RMS), range −20..+20 c; now Steady 0 c (needle still at −3 c), Balanced 3.9 c, Quick 12.1 c. Hits: centred, round 2 1072 ms, now S 1376 / B 1336 / Q 1256 ms; centred −10 c, round 2 1096, now ~1.3 s; centred +15 c and −25 c, round 2 **no hit** (words changing 6.4 times a second, shown in tune 78% and 57%), now a hit on every preset with 0 word changes; centred −45 c, no hit before or after, shown in tune 22% before and 0% now. In Chromium (e2e, fake microphone): Steady hit 1.23 s after the needle first showed, needle range 0 c while in tune; Balanced 1.17 s, SD 4.0 c, range 11.4 c; −45 c, no hit in 8 s.
- **Tests.** `src/dsp/pitch-steadiness.test.ts` (T1 to T14 filter side, presets, properties: nothing during silence, a held glitch never moves the output, a hit always has its 800 ms median in the band, ordering by responsiveness and calm, determinism); `src/dsp/pitch-steadiness.real-voice.test.ts` (T16 on `fixtures/real-voice/`: 3 s holds built from his 16 notes of 0.8 s or more; Balanced hits ≥ 90% at his own median; at ±45 c a hit only where an 800 ms stretch really was within 30 c; words change at most once a second on 15 of 16 holds, median 0); `model.test.ts` (reducer side with a real filter), `view.test.ts`, `match.test.tsx` (needle, words, cents, wobble bar, dead needle, grey head, link, difficulty band), `match-note.test.ts`, `dsp-worker-core.test.ts`, `store.test.ts`, `settings.test.tsx`, the T15 guard. E2E: `e2e/pitch-needle.spec.ts` (default `pnpm test:e2e`, chromium project, its own fake microphone file). Screenshots: `e2e/tour/pitch-needle.spec.ts` → `docs/screenshots/pitch-needle/` (holding, hit, low, the steadier link, settings; desktop and phone, light and dark).
- **Spec deviations.** T10: the fast exit reads the short centre, a median over `centreMs`, so a +100 c step leaves in tune at Q 1.09, B 1.16, S 1.21 s (the reference implementation agrees); the spec's "1.06 to 1.10 s" holds for Quick only. Every preset still leaves before its hit would land. T2: Balanced's drawn needle peaks at 3.8 c (spec ±3 c). T9: Balanced within 8.5 c.
- **Not done.** Diagnostics export of a Match a note session (spec open question 5): not small (the export is built around try traces and attempt records; a Match a note trace needs its own record, capture of frames and opt-in audio in the pitch mode, and an export entry point), so it was left for a separate task. Real long holds on the owner's voice were therefore not checked; the drift figures and the Steady windows rest on his 0.8 s melody notes.
