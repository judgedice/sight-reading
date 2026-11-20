# Round 2: build plan

Role: technical lead.
Read: `01-ux.md` (decisions, updated after the critique), `02-sounds.md`, `03-detection.md`, `04-design.md`, `05-critique.md`, the boards in `mockups/png/`, PLAN rulings, and the code on this branch (calibration and clock-rate work still in progress).

This plan turns the owner's 15 points into 22 work packages in 4 waves. Each package is one developer's work. No two packages in the same wave own the same file. A package may read any file, but it edits only the files it owns.

## 1. Ground rules for every package

- Build on the current code. Two engineers are finishing the staged calibration screens (`src/app/screens/calibration/*`, `src/calibration/*`) and the clock-rate fix (`src/calibration/clock-rate.ts`, `src/platform/web/audio/clock-fit.ts`). No package here owns those files. Read them before you start.
- No work in `src/dsp` or `src/follow`. The detection engineer has finished there (`03-detection.md`). Importing from them is fine.
- Keep every check green at the end of each package: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:bare` (66 scenarios byte-identical), `pnpm gates` (194 of 195, the one failure is R54).
- Copy: every string comes from `src/ui/copy/en.json`. Wave 1 adds every new key. Later packages do not edit `en.json`. If a package finds a missing or wrong string, it says so in its report, and R2-22 fixes it in wave 4.
- New service fields added in wave 2 are optional (`?`) in the service types, so existing test fakes still compile. The screen package that uses a field in wave 3 makes it required and updates its own fakes.
- To look at the app: `pnpm exec vite --port <port> --strictPort` in the background, Playwright with Chromium (installed; do not install browsers), flags `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`. Look at screenshots with the Read tool. Stop the server when done. Ports: each package uses `5200 + its number` (R2-11 uses 5211).
- No git commands that change state. No AI model names in files. Plain writing.

## 2. Decisions

1. **Count-in length does not change.** `countInBars` in `config/levels.json` stays 2 bars at difficulties 1 to 3 (05 D1). The fix is the visual track and the "Come in after 4" line. No package edits `config/levels.json`.
2. **Match a note is a warm-up, not difficulty 0.** It is a standalone session service (`src/session/match-note.ts`) and a screen at `#/match`. It has no score, XP, rank or history.
3. **One sampler, one sound path.** Picker, Practice range card, the starting pitch, "Hear starting pitch", Listen, Match a note and "Hear what we heard" all play through `playNotes` with a sample set. The additive Listen voice stays as the fallback while a set loads, when a fetch fails, or when a set is missing.
4. **Voices use the formant sets** (`voice-*`). The choir set is never used for the starting pitch or Match a note (05 R5). Until the owner chooses, voices play the formant sets everywhere.
5. **The starting pitch is sampled and gets its own moment.** `VOICE_REFERENCE_LEAD_SEC` becomes 0.6 s (the card shows before the first sound). The gap between the first note and the first click becomes one beat at the try's tempo. The frames board times come from the code, so the board is rebuilt from it in wave 4.
6. **The calibration banner is deleted.** The status comes from the same predicate as Ranked availability (`calibrationForRoute` on the current route), so the two never disagree.
7. **Calmer marks at difficulties 1 to 3.** Live: green and red on written notes only, only when sure. No ghosts or "+" until results. New setting `display.ghostsLive` (`from4` default, `always`, `never`). This amends R11 for difficulties 1 to 3. R2-22 writes it into PLAN as R61, marked "proposed, owner to confirm".
8. **Support address.** "Send diagnostics" needs an address. It comes from the build variable `VITE_SUPPORT_EMAIL`. Without it, every button and title reads "Save diagnostics" and the send line is absent (05 D3).
9. **The sound opt-in waits for the owner.** `03-detection.md` built `includeAudio`. The switch is built in the dialog and Settings > Data, but shows only when `VITE_DIAG_SOUND_OPTIN=1`. It stays hidden until the owner rules on the R9 exception (05 D4).
10. **"Tries today" has one definition:** every try started today that reached bar 1, graded or not. One helper, `src/app/compose/tries.ts`, is used by the Practice header, the streak line and the History day groups.
11. **Old copy keys are removed last.** `scan.coach`, `scan.practice.timeUp`, `home.keyFootnote`, `banner.calibrateNeeded`, `stars.optional` and `stars.title` stay in `en.json` until wave 3 stops using them. R2-22 deletes them. `error.clockRate` stays, only as a detail line in the diagnostics file.

## 3. Why the calibration banner keeps coming back

From the code, before any fix:

1. **Only a passing run is stored.** `CalibrationCard.tsx` saves only when `outcome.accepted`. On the owner's Mac the clock-rate check failed falsely, so nothing was stored (the clock-rate engineers' fix).
2. **Dismissing lasts one page load.** `dismissed` in `app-services.ts` is an in-memory value.
3. **The banner and Ranked use different tests.** The banner asks "any stored calibration that is not `reported`". Ranked asks "a measured, non-stale calibration for this route key".
4. **Results warn about a shift with nothing to compare.** The recheck-shift line shows for an uncalibrated try.

Still to confirm (R2-03):

5. **Route key instability.** `routeKeyOf` hashes the track label. Chrome names the default input "Default - MacBook Pro Microphone (Built-in)" and changes the prefix and name when the default device changes. A calibration made under one label does not apply under another.
6. **The dev build.** IndexedDB is per origin. A dev server on a different port is a different origin, so calibrations made on one port are missing on another. React StrictMode double effects must not double-write or drop the record.
7. **The clock-rate gate.** After the engineers' fix lands, a run that measures well must be stored even when the clock-rate measurement is uncertain.

R2-03 proves or rules out 5 to 7 with a test or a recorded probe, fixes what is ours, and writes the outcome in `docs/redesign/round2/07-calibration-cause.md`.

## 4. Contracts between packages

Packages in the same wave code against these names. Change one only through the lead.

**Sampler (R2-02)**

- `src/core/platform.ts`: `PlayNotesOptions.sound?: SoundSetId` (a set folder name from `public/sounds/index.json`), `PlayNotesOptions.attackSec?: number`. `AudioBackend.prepareSound(id: SoundSetId): Promise<'ready' | 'fallback'>`.
- `src/instruments/sound-sets.ts`: `soundSetFor(instrumentId): { set: SoundSetId; standIn: InstrumentId | null }`. A static table checked against `public/sounds/index.json` in a test. Euphonium gives `{ set: 'trombone', standIn: 'trombone' }`. Voices give `voice-<type>`, never `choir-aah`.

**Settings and config (R2-05)**

- `AppSettings.practice.autoReference: boolean` (default true).
- `AppSettings.display.ghostsLive: 'from4' | 'always' | 'never'` (default `from4`).
- `AppSettings.display.showHeard: boolean` (default false).
- `grading-config.json`: `ui.sure` `{ clearAgree: 0.9, clearMaxChanged: 2, mostlyAgree: 0.75, mostlyMaxChanged: 5 }` and `ui.calmLiveUpTo: 3`.

**Calibration status (R2-03)**

- `src/app/compose/calibration-status.ts`: `calibrationStatus(f: { calibrations; routeKey: string | null; outputMode; lastFailure: CalFailure | null; now: number; localDay }): CalStatus`. `CalStatus` is `{ state: 'ok' | 'none' | 'changed' | 'failed'; output: string | null; oldOutput: string | null; when: 'today' | 'yesterday' | { date: string } | null; ms: number | null; reason: string | null }`. Its "ok" agrees with `rankedAvailability` in every case (a test checks it).
- `kv` key `cal:lastFailure`, written by calibration services on a failed run, cleared on a stored one.

**Match a note (R2-04, R2-07)**

- `src/app/screens/match/model.ts`: a pure reducer `matchReducer(state, event)` with events `played`, `frame` (`MatchFrame`), `tick`, `choose-note`, `next`, `again`. State carries the target, the phase (`idle`, `listening`, `flat`, `sharp`, `in-band`, `hit`, `far-up`, `far-down`, `wrong-octave`, `octave-lower`, `octave-higher`, `not-heard`, `summary`), the round (5 notes) and the summary. `firstMatchNote(instrument, cfg)` and `matchNotes(instrument, cfg)` choose the notes.
- `src/session/match-note.ts`: `class MatchNoteService` with `playTarget(concertMidi, instrumentId): Promise<void>` (1.5 s, 80 ms attack), `listen(onFrame: (f: MatchFrame) => void): Promise<void>` (opens capture only 300 ms after the note's release), `stop()`. `MatchFrame = { t; midi: number | null; cents: number | null; levelDb: number; steady: boolean }`.

**Session (R2-06)**

- `playRange(instrumentId, concertMidis, { noteSec: 0.8, gapSec: 0.15 })`, captions `{ kind: 'range-note', index, midi }`. Works with no excerpt loaded.
- `playNote(concertMidi, instrumentId?)` in the instrument's sound. `prepareSound(instrumentId)`.
- `playHeard(attemptId)`: re-synthesises `AttemptRecord.detected` with bar captions `{ kind: 'heard-bar', bar, of }`. Rejects with `no-notes` when nothing was detected.
- `exportLastTry()`, `exportAttempt(id)` named `sightread-try-{yyyy-mm-dd}-{hhmm}.json` (local start time). `exportRecentTries()` named `sightread-tries-{yyyy-mm-dd}-{hhmm}.json`.
- Start errors carry `SessionError` kinds `audio-start` or `mic-start`. A clock-rate result never throws.

**Composition (R2-08)**, all optional in wave 2:

- `HomeServices`: `calibrationStatus: Readable<CalStatus>`, `lastTry: Readable<LastTry | null>`, `pickerSound: PickerSound`, `openMatch()`.
- `ScanServices.calibrationStatus`, `ResultsServices.triesAtPiece(excerptId)`, `HistoryServices.list({ excerptId? })`, `HistoryServices.playHeard(id)`.
- `DiagnosticsServices`: `{ supportAddress: string | null; soundOptInShown: boolean; exportTry(id); exportLast(); exportRecent(); settings(); setSettings() }`, on results, history, states and settings services.
- `MatchServices`: `{ service: MatchNoteService; instrument; cfg; micAllowed(): Promise<boolean>; requestMic() }`.
- `PickerSound = { play(instrumentId, midis); stop(); prepare(instrumentId); state: Readable<{ playing: InstrumentId | null; index: number | null; failed: boolean }> }`.

**Shared components (R2-09)**: `<CalStatusPill status variant="header" | "line" | "card-row" onCalibrate />`, `<DiagnosticsButton services tryId? />` (opens `<DiagnosticsDialog>`, a sheet on phone), `<SureLine level n steady total />`, and `sureLevel(record, cfg)` in `src/ui/components/diagnostics/sure.ts`.

## 5. Waves

| Wave | Packages | What it gives the next wave |
| --- | --- | --- |
| 1 | R2-01 to R2-05 | All copy, the sampler, the calibration cause and model, the Match model, the new settings and config |
| 2 | R2-06 to R2-10 | Session sound and diagnostics methods, the Match engine, all services wired, shared components, credits |
| 3 | R2-11 to R2-19 | Every screen |
| 4 | R2-20 to R2-22 | Design QA, the refreshed tour and owner review, README, PLAN and copy clean-up |

## 6. Packages

### Wave 1

**R2-01 Copy and vocabulary** (moderate)
Owns: `src/ui/copy/en.json`, `src/ui/copy/copy.test.ts`, `config/tips.json`, and every `*.test.ts`, `*.test.tsx` and `e2e/**/*.spec.ts` whose assertions contain a string this package changes, except files owned by R2-02 to R2-05.
Task: Apply `01-ux.md` §5.1 and §5.2 (take to try, Time to Time signature, excerpt to piece, slip to mistake, re-judged to "changed after the try", a stretch to hard, My take to My marks, Recalibrate to Calibrate again, the tips in §5.2). Add every new key in `01-ux.md` §2 to §16 and `04-design.md` §10, with `match.*`, `calStatus.*`, `countIn.*`, `look.*`, `sure.*`, `diagnostics.*`, `heard.*`, `error.audioStart.*`, `error.micStart.*`, `settings.*` and `credits.sounds.*` (from `02-sounds.md`, attribution text). `stars.heading` reads "Look before you play". Keep the keys in decision 11. Update the tests that assert changed text.
Acceptance:
- No `en.json` value matches `\btakes?\b` as a noun, `\bexcerpts?\b`, `\bslips?\b`, `\bscan\b` or "a stretch". `row.time` is "Time signature".
- Every key named in `01-ux.md` and `04-design.md` §10 exists with that text (a test lists them).
- `config/tips.json` says "read-through", not "scan", in the 16 tips listed.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` pass. `pnpm lint:copy` lists only keys added in this round.

**R2-02 Sampler engine** (hard)
Owns: `src/platform/web/audio/sampler.ts`, `sample-manifest.ts`, `sampler.test.ts`, `web-audio-backend.ts`, `web-audio-backend.test.ts`, `listen-voice.ts`, `src/platform/web/audio/index.ts`, `src/core/platform.ts`, `src/testkit/fake-backend.ts`, `src/instruments/sound-sets.ts` and its test, `src/platform/web/sw/strategies.ts`, `sw.ts`, `strategies.test.ts`, `e2e/audio/sampler.spec.ts` (new).
Task: Port the `SampleSet` design in `02-sounds.md` and `sounds-demo.html`. Fetch `index.json` once, load a set on first use, measure the onset shift, pick the nearest sample (tie: the one above), set the rate with `a4Hz` and `tune`, loop sustained sets, apply the set's attack and release, play on the Listen bus. `playNotes` with `sound` uses the set and falls back to the additive voice while loading, on failure, or when the set is missing. `prepareSound` starts loading. `stopSounds` stops samples too. Add a CacheFirst runtime rule for `/sounds/` (no precache). `FakeAudioBackend` records the sound id and, with `loopback.toneGainDb`, mixes `playNotes` into the capture as it does `playTone`.
Acceptance:
- Unit: rate, pick and loop points match `02-sounds.md` for 6 sample cases. A missing set or failed fetch falls back to the additive voice with no throw.
- `e2e/audio/sampler.spec.ts` in Chromium: every set renders bottom, middle and top within 10 cents (YIN over an `OfflineAudioContext` render).
- Nothing under `public/sounds/` is in the precache list. The initial bundle stays under 150 KB gzip (`pnpm size`).
- `soundSetFor` covers every instrument in `config/instruments.json`; a test checks it against the manifest's `instruments` map. No voice maps to `choir-aah`.

**R2-03 Calibration: find the cause, build the status model** (moderate)
Owns: `src/app/compose/calibration-status.ts` and its test, `src/platform/web/audio/route.ts`, `route.test.ts`, `src/app/compose/calibration-services.ts` and its test, `docs/redesign/round2/07-calibration-cause.md`.
Task: Confirm causes 1 to 4 in section 3 with tests. Investigate 5 to 7: label prefixes in Chrome on macOS ("Default - ", "Communications - "), the origin per dev port, StrictMode, and the clock-rate path after the engineers' fix. If the label is unstable, normalise it before hashing (strip the "Default - " and "Communications - " prefixes) and keep old keys readable. Write `cal:lastFailure` on a failed run and clear it on a stored one. Build `calibrationStatus` (section 4) with the four states of `01-ux.md` §4.
Acceptance:
- A test per cause shows the old behaviour and the fix.
- `calibrationStatus(...).state === 'ok'` exactly when `rankedAvailability(...).block !== 'calibration'`, over a generated table of calibrations, routes and output modes.
- `07-calibration-cause.md` names each cause as confirmed or ruled out, with the evidence.
- A calibration stored under "Default - MacBook Pro Microphone (Built-in)" applies under "MacBook Pro Microphone (Built-in)" (if the label cause is confirmed).

**R2-04 Match a note: model** (moderate)
Owns: `src/app/screens/match/model.ts`, `src/app/screens/match/model.test.ts`.
Task: Pure logic for `01-ux.md` §3.1. Note choice (served range at difficulty 1, tonic chord first, first note the middle rounded to a chord tone), the in-tune band from `grading-config.json` at difficulty 1, hit after 0.8 s in the band, not heard after 6 s, too far after 2 s beyond 3 semitones, octave rules (voice octave-free, octave line only inside the full range; instruments "wrong octave"), round of 5, next note 1.5 s after a hit in a round, a chosen chip stays, onboarding never moves on, summary with mean cents and direction.
Acceptance:
- Baritone: first note E3 or G3, inside C3 to C4.
- Baritone singing E2 against E3 shows no octave line (E2 is below G2). Bass singing E2 against E3 shows "octave-lower".
- Fake-clock tests for every timing above. 100% branch coverage of the reducer.

**R2-05 Settings and config types** (moderate)
Owns: `src/core/types.ts`, `src/store/defaults.ts`, the settings migration in `src/store/`, `config/grading-config.json`, `config/configs.test.ts`, `schemas/app-settings.schema.json`, `schemas/grading-config.schema.json`, the generated validators.
Task: Add the settings and config in section 4. Stored settings without the new fields load with defaults. Regenerate schemas and validators.
Acceptance:
- `pnpm schemas:check` and `pnpm validators:check` pass.
- A stored settings record from before this change loads with `autoReference: true`, `ghostsLive: 'from4'`, `showHeard: false`.
- `pnpm gates` unchanged (194 of 195).

### Wave 2

**R2-06 Session: sounds, reference, heard, diagnostics** (hard)
Depends on: R2-02, R2-05.
Owns: `src/session/practice-session.ts`, `practice-session.test.ts`, `take-plan.ts`, `sounds.ts`, `sounds.test.ts`, `listen-plan.ts`, `listen-plan.test.ts`, `diagnostics.ts`, `diagnostics.test.ts`, `src/session/index.ts`, `src/session/heard-plan.ts` (new) and its test.
Task: Every note the session plays goes through `playNotes` with `soundSetFor(instrument)`. The reference uses the voice set, `VOICE_REFERENCE_LEAD_SEC` 0.6 s, and a one-beat gap before the first click; `withOwnPlayback` still gets every reference note. Skip the automatic reference when `autoReference` is false. Add `playRange`, `prepareSound`, `playHeard`, `exportRecentTries` and the file names in section 4. Classify start failures as `audio-start` or `mic-start`. Re-run the `03-detection.md` bleed test with sampled voice notes (05 R18).
Acceptance:
- Bleed test at -10, -20 and -30 dB with sampled reference notes: no detected note, judgment or ghost before bar 1 beat 1 minus the match window.
- With `autoReference` false, no reference note is scheduled and the try can still be Ranked.
- The first count-in click is one beat after the first note ends (fake clock, ±5 ms).
- `exportLastTry().fileName` matches `^sightread-try-\d{4}-\d{2}-\d{2}-\d{4}\.json$`.
- `playHeard` plays one note per detected note at its onset and pitch, with bar captions.
- A forced clock-rate error reaches the count-in and the try is practice with reason `clock-rate`.
- `pnpm test:bare` byte-identical; `pnpm gates` unchanged.

**R2-07 Match a note: engine** (hard)
Depends on: R2-02.
Owns: `src/session/match-note.ts` and its test, `src/platform/web/audio/dsp-worker-core.ts`, `dsp-worker-core.test.ts`, `protocol.ts`, `dsp.worker.ts`, `src/core/platform.ts`.
Task: A worker "pitch" mode that posts `MatchFrame`s at about 50 Hz with no follower, using the existing `PitchAnalyzer`. `MatchNoteService` plays the target through the sampler and opens capture 300 ms after the release, so the app never hears its own note.
Acceptance:
- With fake capture at E3 +6 cents, frames report E3 within ±3 cents and `steady` after 150 ms.
- With loopback bleed at -10 dB, no frame during the target note or its release.
- `stop()` releases the microphone track and the worker.

**R2-08 Composition and services** (moderate)
Depends on: R2-03, R2-05, and the R2-06 and R2-07 contracts.
Owns: `src/app/compose/app-services.ts`, `src/app/compose/values.ts`, `src/app/compose/tries.ts` (new) and its test, `src/app/screens/{home,scan,results,history,settings,onboarding,states}/services.ts`, `src/app/screens/match/services.ts` (new).
Task: Wire every field in section 4. Stop emitting the calibrate banner and drop the in-memory dismiss for it. Build the status from the current route when known, else from the output mode. Count tries today with `tries.ts`. Read `VITE_SUPPORT_EMAIL` and `VITE_DIAG_SOUND_OPTIN`.
Acceptance:
- Seed 2 graded and 1 not-graded try today, plus 1 stopped before bar 1: `today.tries` is 3.
- No `calibrate` banner is ever emitted. After storing a measured calibration, `calibrationStatus` reads `ok` without a reload.
- With no `VITE_SUPPORT_EMAIL`, `supportAddress` is null.
- Existing screen tests pass unchanged.

**R2-09 Shared components: calibration status and diagnostics** (moderate)
Depends on: R2-01, R2-03.
Owns: `src/ui/components/calibration-status/*`, `src/ui/components/diagnostics/*` (new, with story pages and tests).
Task: The pill and popover (`04-design.md` §2, all four states, three variants), the diagnostics button and dialog (`04-design.md` §8: body, three bullets, file name and size, the opt-in only when shown, Share where `navigator.canShare({ files })`, Save file, pointer to Settings > Data), the sure line, and `sureLevel`.
Acceptance:
- Only "changed" uses the caution tone. The popover's action reads "Calibrate" or "Calibrate again".
- With no address, the button and title read "Save diagnostics" and there is no send line.
- `sureLevel` returns clear, mostly or unsure on the thresholds in config (table test).
- axe finds no violations on the story pages.

**R2-10 Credits for the sounds** (routine)
Depends on: R2-01.
Owns: `src/app/screens/about/*`.
Task: A "Sounds" group on Credits with the attribution text in `02-sounds.md`, linking the three licence files.
Acceptance: Credits shows VSCO-2 CE, Fluid R3 (Frank Wen; Benjamin Gleitzman), Salamander Grand Piano (Alexander Holm) and "Voices: synthesised for this app". The licence links resolve.

### Wave 3

**R2-11 Practice screen** (hard)
Depends on: R2-08, R2-09.
Owns: `src/app/screens/home/*`, `src/app/screens/setup/*`, `src/ui/components/setup/*`, `e2e/setup/*`.
Task: `01-ux.md` §6 and `04-design.md` §1. Remove the banner. Header line with the today line, rank and calibration pill. The right panel as a form with a label column: difficulty row and description with "Few pieces"; key chips with the key note (`setup.key.uses` and the next-change line, computed from `writtenKeys`); the key popover above eight keys; Time signature segments with "More" above seven; Tempo and Length on one row; one XP line; Mode with the inline Calibrate link and no second button; Start and the last-try line. The left card's "Match a note" row, "Simpler? Match a note first" at difficulty 1. Phone: one screen, label above value in chips, calibration as the card's last row, "Warm up: match a note". The meter's accessible name includes the meter (16.5).
Acceptance:
- `scrollHeight <= clientHeight` for the page and every element in the setup at 1440 x 900 (difficulties 1, 5, 10) and 390 x 844 (difficulty 1).
- Difficulty 1 shows "Difficulty 1 uses major keys with up to 1 sharp or flat. Minor keys start at difficulty 2." No "More keys from".
- No element with text "Calibrate once". One "Calibrate" control when Ranked is blocked.
- Phone chip labels never meet their chevrons (bounding boxes).

**R2-12 Picker and range with sound** (moderate)
Depends on: R2-08.
Owns: `src/ui/components/picker/*`, `src/ui/components/range/*`.
Task: `01-ux.md` §2, `04-design.md` §3. "Play my range" with Stop, the four chips playing in order, the brass chip, notehead and key while a note sounds, step dots next to "Playing C3", the "This is how it will sound" line, the stand-in line, the failed line. Prepare on hover or focus. Nothing plays on selection. Switching cards stops the sound.
Acceptance:
- Selecting a card schedules no sound (fake backend shows no `playNotes`).
- Switching to Bass during playback leaves no baritone source running.
- Euphonium shows "There's no euphonium sound yet. You'll hear a trombone."
- Range notes use the instrument's set id.

**R2-13 Match a note screen and onboarding step** (hard)
Depends on: R2-04, R2-07, R2-08.
Owns: `src/app/screens/match/*` except `model.ts` and `services.ts`, `src/app/routes.tsx`, `src/app/router.tsx`, `src/app/screens/onboarding/*`.
Task: The `#/match` route with focused chrome, the screen in `04-design.md` §4 (target, state line, needle, "You" line, range chips, Play it again, round summary, no microphone), and onboarding step "Sing one note" or "Play one note" after calibration (6 steps, Skip, Continue after a hit, the "other voice" offer).
Acceptance:
- A fake capture at the target shows "You hit it: E3." within 1 s, and the needle is in the band.
- Flat shows "A little low. Go up." with the chevron on the needle's side.
- Onboarding has 6 steps. The match step never moves on by itself.
- Nothing is written to attempts, profile or history after a round.

**R2-14 Read-through** (moderate)
Depends on: R2-08, R2-09.
Owns: `src/app/screens/scan/*`, `src/ui/components/sounds/*`, `src/ui/components/domain/ChecklistItem.tsx`, `StarRow.tsx`, `domain.test.tsx`, `domain/index.ts`.
Task: Delete `CoachMark`, `scan/coach.ts` and its stored flag. No reading timer in Practice and no auto-ticking (`autoTickedCount` removed). Ranked keeps its timer and the 5-second line. "Look before you play" with no boxes, under the score on desktop. The Sounds line says what plays on Start. Calibration line under Start playing; on phone under the meta line and first in the menu.
Acceptance:
- 40 s in Practice: no "time's up" text, no checked box, no `[data-coach]`.
- Desktop 1440 x 900: no page scrolling.
- Voice: "When you start: your starting pitch, then two bars of clicks."
- A row with "None in the music" has no advice line.

**R2-15 Pre-play, count-in and calmer marks** (hard)
Depends on: R2-05, R2-06.
Owns: `src/app/screens/perform/*`, `src/ui/score-frame/*`, `e2e/design/perform.spec.ts`.
Task: The starting-pitch card in the cue zone (`04-design.md` §5), the status strip "Marks start at bar 1", only brass marks before bar 1. The count-in track: one cell per beat and a "Sing" or "Play" word that is not a control, bar 1 grey with "Count-in: listen to the beat", the last bar brass with "Come in after 4", "Count-in bar n of 2". Full ink from the first click. On the downbeat the track goes and the ring pulses once. Live marks filtered by `ghostsLive` and difficulty: at 1 to 3 no ghost and no extra live. The bar highlight follows the current bar unless look-ahead is on (16.4).
Acceptance:
- The count-in label text differs between bar 1 and bar 2. The last bar shows "Come in after 4".
- No focusable element and no `button` role in the track.
- Every system at opacity 1 from the first click.
- At difficulty 1 with `from4`, the overlay gets no ghost or extra during the try. At difficulty 4 it does.
- The card's step changes within 50 ms of each reference note's `atSec`.

**R2-16 Results** (moderate)
Depends on: R2-08, R2-09.
Owns: `src/app/screens/results/*` except `review/`.
Task: The tries link line, the sure line and the diagnostics button under it, the calibration line only when uncalibrated, the recheck-shift line only for a calibrated try, the sticky phone action bar, the summary from the stored record (16.3), "Notes is the one to work on" only below 90, the drift line only at 20 ms or more.
Acceptance:
- First try: "See all tries". Third try at a piece: "2 tries at this piece · See all tries", and it opens History filtered.
- Uncalibrated try: no "audio delay changed" line.
- Save file downloads `sightread-try-*.json` that parses and holds detected notes, follower events and the frame track.
- Phone 390 x 844: "Next piece" is visible without scrolling.

**R2-17 History, try detail, hear and show what we heard** (hard)
Depends on: R2-06, R2-08, R2-09.
Owns: `src/app/screens/history/*`, `src/app/screens/results/review/*`, `src/notation/overlay/svg-overlay.ts`, `src/notation/overlay-seam.ts`, and the notation tests for the trace.
Task: History rows with grade and score or "Not graded", the "This piece" filter and its line, day groups counted with `tries.ts`. Try detail: "Try n of m at this piece" with previous and next, the marked score, Listen, "Hear what we heard" (playback glyph, reserved caption line), the sure line and diagnostics button. "Show what we heard" in the review toolbar draws the frame track as a thin grey line. Extras and ghosts at 50% on an Unsure try at difficulties 1 to 3.
Acceptance:
- Day group, Practice header and streak line show the same count for a seeded day.
- Starting "Hear what we heard" does not move any toolbar button (bounding boxes before and after).
- The trace is drawn only when the try has a stored track; otherwise the toggle is disabled and `diagnostics.noTrack` explains why.

**R2-18 Error screens** (moderate)
Depends on: R2-06, R2-09.
Owns: `src/app/screens/states/*`.
Task: "The sound didn't start" and "The microphone didn't open" (`04-design.md` §9a) with Try again, Back to Practice, `error.kept` and the diagnostics button. No full-screen clock-rate error.
Acceptance:
- A forced `audio-start` failure shows the sound screen; Try again retries the start.
- No screen shows "running at the wrong speed".

**R2-19 Settings** (routine)
Depends on: R2-05, R2-08, R2-09.
Owns: `src/app/screens/settings/*`.
Task: Practice: "Play my starting pitch before the count-in" (voice). Display: "Show played notes live", "Show what the app hears". Data: "Export diagnostics for recent tries", the opt-in when shown. Sound: the calibration line uses the shared status.
Acceptance: Each setting persists across a reload. The export saves one `sightread-tries-*.json` with every stored trace.

### Wave 4

**R2-20 Design QA** (moderate)
Depends on: wave 3.
Owns: every `*.css` under `src/app/screens` and `src/ui`, `docs/redesign/round2/08-qa.md`, `docs/screenshots/round2/`.
Task: Screenshot every round 2 board's screen at 1440 x 900 and 390 x 844, light and dark. Compare with `mockups/png/`, fix spacing and colour in CSS only, and list anything else for its owner. Rebuild the mockups from the code (`round2.mjs`) so the frames board shows the new reference times.
Acceptance: `08-qa.md` has one row per board with match or fixed or handed off. Contrast and grayscale tests pass.

**R2-21 Tour and owner review** (moderate)
Depends on: wave 3.
Owns: `e2e/tour/*`, `e2e/loop/trail.ts` (moved from `test-results/round2/trail.ts`), `e2e/loop/trailing.spec.ts` (new), `e2e/a11y/copy-match.ts`.
Task: Rewrite `owner-review.spec.ts` to walk the owner's path at difficulty 1 without `testClock`, and assert one check per owner point (table below). Refresh `tour.spec.ts` and `first-user.spec.ts` for the new steps.
Acceptance: Every row in section 7 has a passing assertion in Chromium desktop and phone projects.

**R2-22 README, PLAN and copy clean-up** (routine)
Depends on: wave 3.
Owns: `README.md`, `docs/PLAN.md`, `src/ui/copy/en.json`, `tools/lint-copy.baseline.json`.
Task: Remove the keys in decision 11. Fix strings reported by wave 2 and 3 packages. PLAN: R61 (calmer live marks at difficulties 1 to 3, amends R11, proposed), R62 (sampled sounds; the voice timbre waits for the owner's listening), R63 (Match a note is outside the difficulty scale), R64 (sound opt-in proposed as an R9 exception, hidden until ruled). README: sounds and credits, Match a note, calibration status, diagnostics and the replay tool, the two build variables.
Acceptance: `pnpm lint:copy` passes. README and PLAN name no AI model.

## 7. The owner's 15 points, and where each is proven

| # | Point | Packages | Owner-review assertion |
| --- | --- | --- | --- |
| 1 | The design looks better | R2-20 | Screenshots of every screen; no visible restyle beyond the boards |
| 2 | Hear the instrument in the picker | R2-02, R2-06, R2-12 | "Play my range" schedules 4 notes with the `voice-baritone` set |
| 3 | Sing one note | R2-04, R2-07, R2-13, R2-11 | `#/match` reaches "You hit it" with the fake mic; entries on Practice and in onboarding |
| 4 | Calibration status stays on screen | R2-03, R2-08, R2-09, R2-11, R2-14 | No "Calibrate once" text; the pill reads "Not calibrated" on Practice and the read-through |
| 5 | Tries, and previous tries | R2-01, R2-16, R2-17 | No noun "take" on any screen; results to "See all tries" to the try detail with marks and "Hear what we heard" |
| 6 | Tighter right panel | R2-11 | `scrollHeight <= clientHeight` at 1440 x 900 and 390 x 844 |
| 7 | The key note | R2-11 | The difficulty 1 sentence; no "More keys from" |
| 8 | Time signature | R2-01, R2-11 | Row label "Time signature" |
| 9 | Clock-rate error | R2-06, R2-18 | A forced clock-rate error reaches the count-in; no "wrong speed" text |
| 10 | Tone and purple marks | R2-06, R2-15 | The card and "Marks start at bar 1" show; no ghost element before bar 1 |
| 11 | When the count-in ends | R2-15 | Bar labels differ; "Come in after 4" on the last bar |
| 12 | "Reading time's up" | R2-14 | 40 s in Practice: no such text |
| 13 | No coach mark | R2-14 | No `[data-coach]` |
| 14 | Before you play ticks | R2-14 | "Look before you play", no checkbox |
| 15 | Trailing voice marks, diagnostics | R2-15, R2-16, R2-17, R2-21 | Trailing synthetic at difficulty 1: no ghost during the try, no extra in results; "Save diagnostics" downloads a valid file |

## 8. Left with others

- Clock-rate measurement fix and the staged calibration screens: the two engineers already on them. R2-06 and R2-18 depend on their work landing.
- Detection, left open in `03-detection.md`: same-pitch repeats merged at low level, and a fixed case from the owner's first real recording. They stay with the detection engineer. Nothing here changes `src/dsp` or `src/follow`.
- The owner's ear: he should hear `sounds-demo.html` (formant baritone beside the choir) on his Mac before release. His choice goes into PLAN R62.
