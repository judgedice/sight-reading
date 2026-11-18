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
