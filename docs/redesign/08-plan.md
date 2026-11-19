# Build plan: the redesigned practice loop

Author role: principal UX expert, with the designer's final spec in hand.
Reads: `05-ux-spec.md` (with the designer's notes), `06-design-spec.md`, the mockups in `mockups/png/`, and the code in `src/app/screens`, `src/ui`, `src/session`, `src/platform/web/audio`, `src/calibration`, `src/core`, `src/store`, `src/testkit`, `config/instruments.json`, `src/instruments`, `src/corpus/select`.
Status: binding for the build. Behaviour and copy come from 05, visual values from 06. This plan says who builds what, in which order, and how we know it is done.

---

## 1. Ground rules for every package

1. **Hands off:** `src/dsp`, `src/follow` and `src/grade` are not edited by any package. Code may import from them.
2. **Green at the end of every package:** `pnpm typecheck`, `pnpm test`, `pnpm tokens:check`, `pnpm schemas:check`, `pnpm lint:copy`, and the e2e suites the package touches. `pnpm lint` must pass except for the four known `no-explicit-any` errors in `src/dsp/segmenter.ts`, which belong to another agent. No package adds a lint error.
3. **Ownership:** a package edits only the files it owns (section 4). In a wave, no two packages own the same file. A later wave may own a file an earlier wave owned. A package that needs a change in a file it does not own records it in its report; it does not make the change.
4. **Exports stay compatible inside a wave.** A package that changes a module other packages import keeps the old export working (as an alias or a wrapper) until the package that owns the consumer moves it. Section 5 package `qa` removes the leftovers.
5. **Screenshots:** every package with visible change saves its own screenshots at 1440 x 900 and 390 x 844, light and dark, deviceScaleFactor 1, to `docs/redesign/shots-build/<package id>/`, and compares them against the matching mockup in `docs/redesign/mockups/png/`. Use `pnpm exec vite --port <port> --strictPort` on the port the package is given, and stop the server at the end.
6. **Copy:** strings come from `src/ui/copy/en.json` through `copy()`. No package types user-facing English into a component. Package `copy` adds every key in 05 section 13 and the designer's notes up front, so later packages only consume keys.
7. **No AI model names in files. Sentence-case headings.**

---

## 2. Decisions made for the build

These close gaps between the specs and the code. Each was checked against the code.

1. **Baritone and mezzo can ship as launch voices.** I ran `countEligible` against the shipped corpus with the 05 section 6.5 ranges. Eligible excerpts per difficulty 1 to 10:
   - `voice-bass`: 3, 8, 57, 128, 199, 279, 192, 76, 59, 31
   - `voice-baritone` (proposed): 3, 16, 57, 129, 199, 278, 190, 75, 59, 31
   - `voice-alto`: 3, 8, 57, 128, 199, 279, 194, 78, 71, 32
   - `voice-mezzo` (proposed): 3, 16, 54, 118, 198, 275, 197, 83, 72, 32

   Every difficulty serves music, so both should pass the H-serve gate (PLAN ruling 24). The package still runs `pnpm corpus:check` and sets `status` from the result. Difficulty 1 is thin (3 pieces) for every voice today; the "Few pieces here" line covers it.
2. **Excerpts need no rebuild for new voices.** Eligibility is computed from each excerpt's `rangeConcert` against the instrument's tiers at runtime.
3. **`SCENARIO_INSTRUMENTS` in `src/testkit/scenarios/corpus.ts` keeps its four voices.** It seeds the synthetic gate sets that `src/dsp` tests read. Adding voices there would reshuffle seeded scenarios under tests we may not edit. The voices package adds its own detection test for the two new voices instead.
4. **Metronome type.** `ClickTimbre` in `src/core/types.ts` is widened, not renamed: `'tick' | 'wood' | 'classic' | 'woodblock' | 'beep'`. The testkit, `src/dsp` tests and calibration tests keep `tick` and `wood`. The player's setting only ever holds `classic`, `woodblock` or `beep`; the settings reader maps stored `tick` to `classic` and `wood` to `woodblock`. Default becomes `classic`.
5. **Sound recipes live in core.** A new pure module `src/core/click-sounds.ts` renders every sound (06 section 9) so the metronome, the testkit bleed and the gate test all use the same samples. `renderClick('tick' | 'wood')` stays bit-identical to today.
6. **Click ship gate without touching `src/dsp`.** The bleed gate for the new sounds (onset F1 at least 0.97, zero click-induced extras, at −20 and −10 dB) runs in a new test file outside `src/dsp`, importing the dsp public API. `src/core/click-gate.ts` and `src/dsp/click.test.ts` stay as they are.
7. **`listened-first` without touching `src/grade`.** The grader maps `mode !== 'ranked'` to `practice-mode`. When the player listens first in a ranked take, the session sets the take's mode to `practice` (so XP and rank follow the practice path exactly) and writes `listened-first` in place of `practice-mode` in the attempt's `rankedReasons`. `RankedReason` gains the value in `src/core/types.ts` and the attempt schema.
8. **One owner for app wiring.** `src/app/compose/**` and every screen's `services.ts` interface belong to the session package in wave 2. It adds every sound and availability service the screens need, as optional members, so wave 3 screens only consume them.
9. **Setup controls are shared components.** Difficulty, Key, Time, Tempo, Length and Mode controls are built once in `src/ui/components/setup/` and used by the Practice screen, the phone setup sheet, the setup sheet over results, and the onboarding difficulty step.
10. **Range data is pure and shared.** `src/instruments/range.ts` computes full, served and concert ranges, note names, transposition lines and staff layout choices (clef change or 8va). The picker, the Practice screen and the difficulty line all read it.
11. **The developer's select fix is a stepping stone.** The key `Select` and Random chips in `SetupForm.tsx` are replaced by the key grid and "Any" options in wave 3. The developer's e2e (`e2e/setup/setup-key-meter.spec.ts`) is kept and moved to the new controls, so the bug cannot come back.
12. **Removed tokens and keys stay as aliases until wave 5.** `playhead-next`, `ink-accent-soft`, `random-chip-*`, `instrument-circle` and the keys in 05 section 13.3 are still read by old code. Package `qa` deletes them once nothing uses them.
13. **The tips route redirects, it is not deleted, until results fold tips in.** Package `shell` makes `#/practice/tips` redirect to results (or Practice). Package `results` removes `TipsScreen`.

---

## 3. Waves at a glance

| Wave | Packages | Why this order |
| --- | --- | --- |
| 1 | `tokens`, `icons`, `copy`, `contracts`, `setup-model` | Foundations every later package reads: values, glyphs, words, types, the setup and range model, the selector fix. |
| 2 | `voices`, `base-components`, `domain-components`, `range-picker`, `setup-controls`, `sounds-components`, `metronome`, `playback-engine`, `session`, `score-frame` | Data, components and engines, each in its own directory. No screen is touched. |
| 3 | `onboarding`, `practice`, `read-through`, `perform`, `settings`, `calibration`, `progress-history`, `shell` | Each screen assembled from wave 2 parts. |
| 4 | `results` | Needs the setup sheet from `practice` for "Change setup". |
| 5 | `qa` | Accessibility and design QA across every screen; removes leftovers. |
| 6 | `tour` | Refreshed e2e tour and screenshots of the finished app. |

The owner's points land in this order: Difficulty wording (wave 1), baritone and the key and time controls (waves 2 and 3), range picture (waves 2 and 3), sounds and the reference explanation (waves 2 and 3), new clicks (wave 2, after the audition).

---

## 4. Packages

Difficulty: **hard** (new behaviour with timing or audio risk, or a large screen), **moderate** (clear spec, several files), **routine** (mechanical).

### Wave 1

#### `tokens`: tokens and fonts (moderate)

- **Owns:** `design/tokens.json`, `tools/generate-tokens.ts`, `tools/generate-tokens.test.ts`, `src/ui/tokens.css` (generated), `src/ui/tokens.ts`, `src/ui/tokens.contrast.test.ts`, `src/ui/fonts/**` (new), `LICENSES/**`, `index.html`, `src/main.tsx`, `src/platform/web/sw/policy.test.ts`.
- **Task:** Apply 06 section 5 exactly: version 2, new UI and paper colours, high-contrast overrides, `elevation` group, type scale with phone sizes, `space-9`, radii, motion `count`, `grade`, `ease-settle`, and the `component` and `score` group changes. Keep removed tokens as deprecated aliases (decision 12). Ship Source Serif 4, Inter and the Bravura Text music subset (U+2669, U+266A, U+266D to U+266F) from `src/ui/fonts/`, with `@font-face`, `font-display: block` with the 300 ms cap, preload links in `index.html`, the licence texts in `LICENSES/`, and service-worker precache. Inter feature settings `"cv11", "ss01"`; tabular numbers class.
- **Acceptance:**
  - `pnpm tokens:check` passes and `tokens.css` carries every value in 06 section 5.
  - The contrast test covers every pair in 06 section 3.3, including high contrast, and all pass.
  - A Playwright check on the built app finds no font request to another origin and `document.fonts.check('600 34px "Source Serif 4"')`, `'16px Inter'` and the music-text face all true.
  - `pnpm size` passes; each new font is under the 260 KB font limit.
  - Screenshots of Practice and Settings show the serif titles and the warm paper colours, light and dark.

#### `icons`: icon set (routine)

- **Owns:** `src/ui/glyphs.svg`, `src/ui/glyph-ids.ts`, `src/ui/glyph-ids.test.ts`, `src/ui/primitives/Glyph.tsx`.
- **Task:** Add the 06 section 8 set from `docs/redesign/mockups/_build/icons.mjs` (24 grid, 1.75 stroke, round caps, `currentColor`): listen, metronome, tuning fork, starting pitch, key chord, stop, slower, lightbulb, the instrument line icons and the rest. Keep every id code uses today (for example `volume-2`) resolving, mapped to the new drawing where one exists.
- **Acceptance:** `glyph-ids.test.ts` lists every id in the 06 set and every id used in `src/`; `pnpm test` passes; the dev components screen shows all icons at 16, 20 and 24 px in a screenshot.

#### `copy`: vocabulary and every new string (moderate)

- **Owns:** `src/ui/copy/en.json`, `src/ui/copy/copy.ts`, `src/ui/copy/copy.test.ts`, `src/ui/copy/instrument-names.ts` (new), `tools/lint-copy.ts`, `tools/lint-copy.test.ts`, `tools/lint-copy.baseline.json`; string literals only in existing `src/**/*.test.ts(x)` and `e2e/**/*.ts` that assert copy text, excluding files another wave 1 package owns.
- **Task:** Make every change in 05 section 13.1, add every key in 13.2 and in the designer's notes (copy section), including `instrument.name.*` and `instrument.short.*` for all six voices and `instrument.abbr.voice-mezzo` and `voice-baritone`. "Level" becomes "Difficulty" in every user-facing string (05 section 12); internal ids stay. Add `instrumentName(id)` and `instrumentShortName(id)` helpers that fall back to the config label for non-voices. Do not delete the 13.3 keys yet. Update test assertions and e2e selectors that quote changed text, and nothing else in those files.
- **Acceptance:**
  - A new test checks every key and exact text in 05 section 13 and the designer's notes against `en.json`.
  - A new test fails if any `en.json` value matches `/\blevel\b/i`, except keys on an explicit allow-list of internal or rank strings (expected empty).
  - `pnpm test` and `pnpm lint:copy` pass; existing e2e suites that ran green before still pass.

#### `contracts`: core types, settings and backend interface (moderate)

- **Owns:** `src/core/types.ts`, `src/core/platform.ts`, `schemas/app-settings.schema.json`, `schemas/attempt-record.schema.json`, `schemas/export-file.schema.json`, `src/store/**`, `src/testkit/fake-backend.ts`, `src/testkit/fake-backend.test.ts`, `src/platform/web/audio/web-audio-backend.ts` (interface stubs only).
- **Task:**
  - Widen `ClickTimbre` (decision 4) and add `MetronomeSound = 'classic' | 'woodblock' | 'beep'`.
  - Settings: `practice.accentFirstBeat` (default true), `profile.displayName` optional, `practice.showTips` if absent. Keep `practice.clickTimbre` as the stored sound.
  - `RankedReason` gains `listened-first` (decision 7).
  - `TakeSchedule` gains `accent: boolean`.
  - `AudioBackend` gains: `playNotes(notes, opts)` (sounding Hz, start, duration, peak level), `playClicks(times, sound, accents)` for previews and lead-ins, and `stopSounds()` that cancels everything scheduled except a running take. Implement them in `FakeAudioBackend` with a log. Add stubs in the web backend that compile and use the existing sine `playTone` and metronome, so the app keeps working until `playback-engine` lands.
  - Regenerate schemas.
- **Acceptance:** `pnpm typecheck`, `pnpm schemas:check` and `pnpm test` pass; the fake backend test covers the three new methods; an export file from `src/store/fixtures/export-v0.json` still imports.

#### `setup-model`: setup model, Any-meter selector fix, range model (hard)

- **Owns:** `src/app/screens/setup/model.ts`, `src/app/screens/setup/families.ts`, `src/app/screens/setup/key-names.ts`, `src/app/screens/setup/model.test.ts` (new), `src/corpus/select/**`, `src/instruments/range.ts` and `src/instruments/range.test.ts` (new).
- **Task:**
  - Pure setup model for 05 section 5: each row's options with its Any option first; difficulties with music for the instrument and the skipped list; few-pieces flags (`levelThinThreshold`, `meterChipMinExcerpts`); meters shown and meters left out; key groups Major then Minor in accidental order, sharp side first; "More keys from difficulty n"; length options or the single-length line; XP sum; fallback notes for 5.9 (key, time, length, difficulty) with the text inputs they need. Keep today's exports working (rule 4).
  - Selector: with time set to Any, draw only from meters the setup shows (at least `meterChipMinExcerpts` eligible). Selection only; grading untouched.
  - Range model (decision 10): full, served (tier from `levels.json`, never hard-coded), concert range, note names with real ♭ and ♯ (05 section 7.1 spelling), transposition text (interval, octave, compound), staff plan (first clef, up to 4 ledger lines, clef change to a higher clef in `clefs`, else 8va or 8vb), keyboard strip span.
- **Acceptance:**
  - Model tests cover difficulty 1, 2, 5 and 9 for flute, bass voice, trumpet in B♭ and cello, including the 05 examples ("At difficulty 1: Any key, C, G, F").
  - A property test: for each launch instrument and each difficulty, 200 draws with time Any never serve a meter the model hides.
  - Range tests: tenor sung range A2 to A4 with "Written an octave higher"; clarinet "Sounds a major 2nd lower"; cello A5 drawn with a treble clef change; baritone G2 to G4 with C3 to C4 at difficulty 2.
  - Existing `src/corpus/select` tests and `home.test.tsx` pass.

### Wave 2

#### `voices`: baritone and mezzo-soprano (moderate)

- **Depends on:** `copy`, `contracts`.
- **Owns:** `config/instruments.json`, `config/configs.test.ts`, `config/tips.json`, `schemas/instruments.schema.json`, `src/instruments/index.ts`, `src/instruments/instruments.test.ts`, `src/instruments/voices.test.ts` (new), `src/app/screens/onboarding/onboarding.test.tsx` (the voice-order assertion only), `docs/PLAN.md` (one line recording the voice status).
- **Task:** Add `voice-mezzo` and `voice-baritone` with the 05 section 6.5 values: family `voice`, `relativePitch: true`, `pitchKind: continuous`, `onsetClass: soft`, `testkitTimbre: voice`, mezzo clef treble, baritone clef bass, `semis` 0. Detection: copy `voice-alto` for mezzo and `voice-bass` for baritone, then set `minHz` and `maxHz` to the sounding range plus a whole tone (mezzo about 174.6 to 987.8 Hz, baritone about 87.3 to 440 Hz; check each against its neighbours). Order the voices soprano, mezzo, alto, tenor, baritone, bass. Add both ids wherever voice tips list voice ids in `tips.json`. Run `pnpm corpus:check`; set `status: launch` if H-serve passes at every difficulty, else `beta` and report it (baritone as beta is a release blocker to raise with the owner).
- **Acceptance:**
  - `configs.test.ts` expects the six voices in order in the launch list; `pnpm test` passes.
  - A test renders a testkit voice at the bottom and top of each new range and the detection settings find the pitch (no dsp edits).
  - `countEligible` is above 0 at difficulties 1 to 10 for both voices; `pnpm corpus:check` passes.
  - Existing players with `voice-bass` keep it (store test).

#### `base-components`: shared component restyle (moderate)

- **Depends on:** `tokens`, `icons`.
- **Owns:** `src/ui/components/form/**`, `src/ui/components/containers/**`, `src/ui/primitives/**`, `src/app/screens/DevComponents.tsx`.
- **Task:** Restyle to 06 section 6: buttons (primary ink, hero 56 with kbd hint, secondary, tonal, quiet, compact, loading), segmented control (second-line caption, selected style), switch with on-state check, stepper, slider with number field, cards, banners, toasts (Undo, at least 6 s), sheets (grabber, swipe down and scrim tap call the cancel action, header with Done), dialogs (fixed head and foot, body scrolls; 480 confirm, 1280 picker), popover (title line, 400 ms hover on fine pointers, press pins, Escape and outside click close, focus returns), new `InfoButton` (`aria-expanded`, `aria-controls`). Keep `RandomChip` and `Select` exported for now.
- **Acceptance:** component tests cover hover-open on fine pointer, press-only on touch, pin and Escape for the popover; swipe and scrim cancel for the sheet; switch role and state; focus ring 2 px. Every form control is at least 44 px on coarse pointers (test with `pointer: coarse` emulation). Dev components screenshots in both themes match 06 section 6.

#### `domain-components`: domain components restyle (moderate)

- **Depends on:** `tokens`, `icons`, `copy`.
- **Owns:** `src/ui/components/domain/**`.
- **Task:** Restyle and extend: `DifficultyMeter` (ten segments, filled, empty, hollow dashed for no music; `aria-hidden`), keeping `LevelMeter` as an alias; `BeatDots` with a larger downbeat and brass current; `ScanTimer` brass ring; `StarRow` brass; `ComponentBar` with a hatch on the weakest; `GradeBadge` pills (Ranked, Practice, Not graded, Incomplete); `RankEmblem` colours; `TipCard` per 06 section 6.15; `EmptyState`.
- **Acceptance:** `domain.test.tsx` covers each state; the weakest bar is marked by a pattern, not colour alone; screenshots of the dev components screen in light, dark and high contrast.

#### `range-picker`: range picture and instrument picker (hard)

- **Depends on:** `tokens`, `icons`, `copy`, `setup-model`.
- **Owns:** `src/ui/components/range/**` (new), `src/ui/components/picker/**` (new).
- **Task:**
  - `RangePicture` in three sizes (05 section 7, 06 section 6.10): ruler bar on the shared C1 to C8 sounding axis with middle C tick; large staff in the first clef with four whole notes, served band, ledger rules, clef change or 8va from the range model; note pills that are 44 px buttons ("Hear C3") calling an `onHearNote(midi)` prop; keyboard strip with full and served brackets; legend lines; `figure` and `figcaption` with `range.a11y`; served band moves in 200 ms, jumps with reduced motion. Draw notes with Bravura (VexFlow or the notation helpers already in `src/notation`).
  - `InstrumentPicker`: groups and order from 05 section 6.2 driven by config; one card skeleton per row; voice cards with clef icons and sung range; transposing cards with "bars show sounding pitch"; axis explanation line; radio group across groups (arrows, Home, End, Space, Enter); "Show more instruments (less tested)" switch; desktop dialog with the fixed 440 px right column picture; phone full-height sheet with the pinned bottom panel (no keyboard strip); Done applies, Cancel and Escape discard.
- **Acceptance:**
  - Component tests: voice group shows every voice in config order; the accessible name reads "Baritone voice, range G2 to G4"; arrow keys move across groups; Done and Cancel behave; note buttons call `onHearNote` with the sounding pitch.
  - Picker screenshots at 1440 x 900 and 390 x 844 in both themes match `picker-*.png`: the picture is in view at selection, Done's bottom is within the window.
  - Ruler served band against full band passes 3:1 (contrast test entry).

#### `setup-controls`: Difficulty, Key, Time, Tempo, Length and Mode controls (hard)

- **Depends on:** `tokens`, `icons`, `copy`, `setup-model`.
- **Owns:** `src/ui/components/setup/**` (new).
- **Task:** Controlled components fed by the setup model (05 sections 5.3 to 5.10, 06 sections 6.2 to 6.6):
  - `DifficultyControl`: "Follow my progress" switch on the label row (hides the stepper when on), stepper "2 of 10", meter, description, served-range line, skipped and few-pieces lines; a prop hides the switch for onboarding.
  - `KeyGrid`: radio group; "Any key" full row with hint and XP tag; Major and Minor groups; chips with a mini staff signature in the first clef at a 6.5 px staff space, never scaled; concert line for transposing instruments; 3 columns on phones, 3 or 4 on desktop by difficulty; check mark on the selected chip; "More keys from difficulty n."
  - `TimeSegments`: "Any" first with XP tag, meters as stacked Bravura numerals with spoken names, "few pieces" captions, the unavailable line; wraps, never scrolls sideways.
  - `TempoRow`: "Any tempo in range" switch with XP tag; off shows "♩ = 72", slider, number field and "Hear the tempo" (prop callback).
  - `LengthRow`, `ModeControl` (hints, blocked reasons with "Calibrate now" or "Turn on microphone", `aria-disabled` Ranked with `aria-describedby`), `XpLine`, `FallbackNote` (6 s, polite announcement).
- **Acceptance:**
  - Tests: choosing a key or meter calls `onChange` with the value; choosing Any sends `'random'`; mouse, touch and arrow keys all work; no control is disabled without a visible reason next to it (05 section 16 item 4).
  - The ♩ sits within 0.35 em of "=" (measured in a browser test).
  - Screenshots of every control match `home-*`, `setup-sheet-*` and `setup-states-*` mockups.

#### `sounds-components`: sounds group and the reference explanation (moderate)

- **Depends on:** `tokens`, `icons`, `copy`.
- **Owns:** `src/ui/components/sounds/**` (new).
- **Task:** `SoundButton` (icon tile, label, caption, playing state with brass edge), `SoundsGroup` (desktop card: Listen first, Hear the tempo, Hear starting pitch for voice or Hear the key for instruments, Check my tuning for winds, brass and strings; header "Nothing plays during the take"), `SoundsDock` (phone: three short-label buttons, full accessible names, "Makes this practice" second line in ranked, "What do these do?" button), `ReferenceInfo` (info button plus popover: title `reference.info.title.voice` or `.instrument`, body `reference.info.voice` or `.instrument` verbatim; native `title` with the caption as an extra), `SoundsExplainSheet` (the dock's sounds only, full names, reference row highlighted), `LiveCaption` (brass bars, static under reduced motion), `ListenConfirm` (dialog on desktop, sheet on phones; "Keep it ranked" primary and focused; Escape, swipe down and scrim tap keep it ranked; states the time left), `CoachMark` (inline, never overlays).
- **Acceptance:** tests check the reference text for voice and instrument matches 05 section 10 exactly, the popover opens by click, tap, Enter, Space and a 400 ms hover with a fine pointer, and the explain sheet lists three rows for voice and four for clarinet. Screenshots match `scan-*` mockups (components rendered in the dev screen route or a story page inside the package).

#### `metronome`: Classic, Woodblock and Beep (hard)

- **Depends on:** `contracts`. **Precondition:** the owner's audition verdict on `docs/redesign/audio/*.wav` is recorded in `docs/PLAN.md` (designer's note 19). Sounds the owner rejects are retuned within the ship gate or dropped.
- **Owns:** `src/core/click-sounds.ts` (new) and its test, `src/platform/web/audio/metronome.ts`, `src/platform/web/audio/metronome.test.ts`, `src/platform/web/audio/metronome-sounds.gate.test.ts` (new), `src/calibration/**`, `src/testkit/synth-min.ts`, `src/testkit/synth-min.test.ts`, `src/testkit/ref-wavs.ts`, `e2e/synthetic/**`, `src/store/defaults.ts`, `src/store/settings-read.ts` (new reader normaliser).
- **Task:** Implement the 06 section 9 recipes as pre-rendered buffers (no oscillators; the lint rule stays): the Tick layer first in every sound, body layers from sample 0, nothing tonal below 1 kHz, every sound 60 ms or less with a 3 ms fade, accent recipes and `accentDb`, accent off uses the offbeat recipe at 0 dB. `planTakeClicks` honours `TakeSchedule.accent`. Calibration: arrival envelope per sound, low-band template built for the selected sound, the count-in recheck uses the stored template for that sound and runs without one after a sound change; the calibration flow, counts, gates and stored result do not change. Settings reader maps `tick` to `classic` and `wood` to `woodblock`; default `classic`. Keep `tick` and `wood` renders bit-identical.
- **Acceptance:**
  - Unit: each sound is at most 60 ms, peak-normalised, no energy above −40 dB below 1 kHz after 5 ms, Tick-layer energy above 5 kHz in the first 5 ms equal to today's Tick within 1 dB.
  - Gate test: each sound with bleed at −20 and −10 dB keeps onset F1 at least 0.97 with zero click-induced extras on the launch timbres.
  - Synthetic loopback e2e: each sound calibrates with at least 7 of 10 clicks found and MAD at most 3 ms.
  - Existing calibration tests and `src/dsp` tests pass unchanged. A stored `tick` setting reads as `classic`.
  - Manual: one laptop with built-in speakers and one phone calibrate with each shipped sound; results in the package report.

#### `playback-engine`: the Listen voice and sound control in the web backend (moderate)

- **Depends on:** `contracts`.
- **Owns:** `src/platform/web/audio/web-audio-backend.ts`, `src/platform/web/audio/web-audio-backend.test.ts`, `src/platform/web/audio/listen-voice.ts` and its test (new), `src/platform/web/audio/index.ts`.
- **Task:** Real `playNotes`: the 05 section 9.2 tone (fundamental, 2nd harmonic −8 dB, 3rd −16 dB, 5 ms attack, exponential decay to −24 dB over the note or 2 s, 60 ms release) rendered into buffers per pitch and length, at the player's `a4Hz`, through its own gain bus at about −12 dBFS peak, independent of click volume. `playClicks` through the metronome for one-bar previews and lead-ins. `stopSounds` stops every source scheduled by these methods and by `playTone` at once, and never touches a running take. Refuse to start any of them while a take is scheduled.
- **Acceptance:** backend tests with the fake context: scheduled sources, gains and stop behaviour; a render test checks harmonic levels and the decay; `stopSounds` during a take leaves the take's clicks; no `OscillatorNode` (lint passes).

#### `session`: sound services, Listen first and app wiring (hard)

- **Depends on:** `contracts`, `setup-model`.
- **Owns:** `src/session/**`, `src/app/compose/**`, `src/testkit/fake-backend.ts`, `src/testkit/fake-backend.test.ts`, and the `services.ts` file of each screen: `src/app/screens/{home,scan,results,history,settings,calibration,onboarding,sheets,progress}/services.ts`.
- **Task:**
  - Pure listen plan (new `src/session/listen-plan.ts`): prepared excerpt to sounding notes at a tempo; ties joined, rests silent, pickups on their beat, notes end 10% early; one-bar click lead-in; "Click along"; "Slower" at 75%; start bar; bar timeline for the highlight.
  - Session methods: `hearTempo(bpm, beatsPerBar)` (also with no excerpt, for Practice), `hearKey()` (root, third, fifth at concert pitch, root at or below the first note's sounding pitch), existing starting pitch, `listen({ fromBar, slower, clickAlong })` for the current excerpt and for a stored attempt, `hearBar(n)` (one bar of clicks, then the bar twice), `playNote(midi)` (1 s), `previewSound(sound)` (one bar at ♩ = 90), `stopSounds()`, and `listenFirst()`: in practice it plays; in ranked it switches the take to practice and records `listened-first` (decision 7). One sound at a time. "Start playing" and the ranked auto start stop any sound first. Nothing plays from the start of the count-in to the end of the take except the metronome and the voice reference (R7, unchanged). Pass the chosen sound and accent setting into every `TakeSchedule`.
  - Availability for Practice: `rankedAvailability(route)` using the same predicate as the `calibration-unmeasured` gate, plus microphone state.
  - Wire all of it in `src/app/compose/**` and add the members, optional, to each screen's services interface.
- **Acceptance:**
  - Session tests with the fake backend: ranked listen first gives practice mode and `rankedReasons` containing `listened-first` and not `practice-mode`; countdown continues; practice listen first plays with no mode change; no `playNotes`, `playClicks` or `playTone` call between `scheduleTake` and the take's end except the voice reference.
  - Listen plan tests: ties, rests, pickups, 6/8 and 75% timing against hand-computed values.
  - `hearKey` chord for B♭ clarinet reading A major sounds G major, root at or below the first note.
  - `hearTempo` schedules one bar at the set tempo with the accent setting (05 section 16 item 8, unit level).
  - Existing `practice-session.test.ts` passes.

#### `score-frame`: score drawing, highlights and count-in band (hard)

- **Depends on:** `tokens`.
- **Owns:** `src/ui/score-frame/**`, `src/notation/overlay/**`, `src/notation/visual-states.ts`, `src/notation/visual-states.test.ts`, `src/app/screens/results/review/**`.
- **Task:** Drawing only (05 section 15): 06 section 7 palette and sizes, one playhead wash (no next-bar marker), past slips to 70% once their system is left (ink never fades), correct notes plain in review, cue-size ghosts with accidentals placed between notes, page margins and staff spaces from tokens. New APIs: bar highlight driven by a bar index (for Listen and tapped bars), key-signature highlight and first-note highlight with its name (for the reference), count-in band (number in the top margin, first system at full ink, later systems at 50%), clean-score mode with no marks (void results). Bar tap events in review.
- **Acceptance:**
  - Feedback acceptance tests (04 section 6.7) and `e2e/notation` pass unchanged.
  - A new test: no ghost accidental bounding box overlaps another glyph across the feedback acceptance fixtures.
  - Error and ghost at 70% on paper pass 3:1 in the contrast test.
  - Screenshots of take, review and count-in states match `performance-*` and `count-in-*`, including high contrast.

### Wave 3

#### `onboarding`: first launch (moderate)

- **Depends on:** `range-picker`, `setup-controls`, `base-components`, `voices`, `session`.
- **Owns:** `src/app/screens/onboarding/**` (except `services.ts`).
- **Task:** 05 section 4.1 and 8.1 to 8.5: Welcome (engraved four-bar phrase, headline, Get started, no name field); "Choose your instrument" using `InstrumentPicker` as the page with the large picture and Continue; microphone step with the "Not now" line and the denied, no-device, busy and insecure cards; calibration step as the step's card with no card inside it and the skip hint; difficulty step ("Find my difficulty", "I'll choose" with `DifficultyControl` without the switch and the large picture; placement needs the microphone). "Step n of 5" on steps 2 to 5.
- **Acceptance:** onboarding tests updated and passing; a test picks Baritone with the keyboard and finishes with `instrumentId: 'voice-baritone'`; screenshots match `welcome-*` and `picker-*` at both sizes and themes.

#### `practice`: the Practice screen and setup sheet (hard)

- **Depends on:** `setup-controls`, `range-picker`, `base-components`, `domain-components`, `session`, `setup-model`.
- **Owns:** `src/app/screens/home/**` (except `services.ts`), `src/app/screens/setup/SetupForm.tsx`, `src/app/screens/setup/setup.css`, `src/app/screens/setup/index.ts`, `src/app/screens/setup/SetupSheet.tsx` (new), `e2e/setup/**`.
- **Task:** 05 sections 5 and 8.6, designer's note 5, 06 section 10:
  - At 1024 px and wider: two columns. Left card: instrument header with "Change instrument" (opens the picker dialog), the large range picture with note buttons, rank line. Right card: Difficulty, Key, Time, Tempo, Length scroll inside; the foot holds Mode, its hint, the XP line and Start.
  - Below 1024 px: Today strip, summary card (instrument row with ruler bar, labelled chips with chevrons), first-time hint, Mode, rank card; Start and the XP line docked above the tab bar; chips open `SetupSheet` at that row with focus on its control; closing returns focus to the chip.
  - `SetupSheet` is exported for `results`.
  - Notices in priority order; loading ("Loading music…", `aria-busy`), empty (one-tap fixes), error and permission states. "Hear the tempo" and range notes play through session services. Remove the Credits footer link.
  - Move the developer's e2e to the key grid and time segments; keep its assertions on the served `writtenKey` and meter.
- **Acceptance:**
  - `home.test.tsx` and `e2e/setup` pass for flute, bass voice, baritone voice and trumpet in B♭ at both sizes: choosing a key and a meter serves them; choosing Any serves `random`.
  - At 390 x 844, Mode and Start are fully in view on load, and no row is under the docked Start at any scroll position (e2e scrolls in steps and checks).
  - At 1440 x 900 and 1280 x 800, Mode and Start are in view on load.
  - Screenshots match `home-*`, `setup-sheet-*`, `setup-sheet-key-*` and `setup-states-*`.

#### `read-through`: cover, read-through, sounds and reference (hard)

- **Depends on:** `sounds-components`, `session`, `score-frame`, `base-components`, `domain-components`.
- **Owns:** `src/app/screens/scan/**` (except `services.ts`), `e2e/loop/listen-first.spec.ts` (new).
- **Task:** 05 sections 4.2, 4.3, 8.7, 8.8, 9 and 10:
  - Cover: large engraved clef, key and time; one summary line; ranked line with "Practice instead"; "Show the music" (Space); Skip with its hint; loading and error states.
  - Read-through: toolbar (Home, summary, mode chip with ring, "0:24 left", overflow, Start playing).
  - Sounds: desktop group under Start playing; phone dock with the "Before you play" peek tab. Hear starting pitch (voice) or Hear the key (instruments) with caption and `ReferenceInfo`. Check my tuning for winds, brass and strings. Listen first: practice plays at once; ranked opens `ListenConfirm`, then switches to practice, changes the chip and announces "Now a practice take". The countdown never pauses; at 0 the confirm closes as "Keep it ranked".
  - Live caption with score highlights (key signature, first note, bar). Coach mark on the first read-through only. L shortcut. Polite announcements at 10 and 5 seconds.
- **Acceptance:**
  - `scan.test.tsx` covers 05 section 16 items 9, 10, 13 and the caption texts.
  - A loop e2e: ranked listen first, confirm, take, and results show "You listened first, so this one is practice."
  - Screenshots match `cover-*`, `scan-*`, `scan-instrument-*`, `scan-listen-*`, `scan-confirm-*`, `scan-explain-*` and `scan-coach-*`.

#### `perform`: count-in and take (moderate)

- **Depends on:** `score-frame`, `domain-components`, `base-components`, `session`.
- **Owns:** `src/app/screens/perform/**`.
- **Task:** Count-in band per 06 section 6.12 (number above the first system, downbeat larger in sound and size, "Bar 1 · ♩ = 72"); voice "Your starting pitch" band with the two steps and live caption; take status strip (Stop with its word, beat dots, "Bar 5 of 8", "Mic" meter). No sound controls. Behaviour unchanged.
- **Acceptance:** `perform.test.tsx` and `e2e/loop` pass; a test checks the count-in band does not overlap the first system's box; screenshots match `count-in-*`, `count-in-voice-*` and `performance-*`.

#### `settings`: Settings (moderate)

- **Depends on:** `base-components`, `metronome`, `session`, `copy`.
- **Owns:** `src/app/screens/settings/**` (except `services.ts`).
- **Task:** 05 sections 8.14 and 11.2, designer's notes 13 to 15: Profile, Sound, Display, Practice, Accessibility, Data, About. Metronome sound radio cards (Classic, Woodblock, Beep) with hint, picture, "Play a bar of …" preview, one at a time, Stop while playing; "Changing the sound keeps your calibration."; Accent the first beat; Click volume plays one click on release; Click during the take; calibration status with Calibrate or Recalibrate; Tuning pitch with hint; Show the Before you play checklist; Show a tip after each take; Show more instruments (less tested); Run placement again; Technical details disclosure.
- **Acceptance:** `settings.test.tsx` covers the three sounds and previews (05 section 16 item 14), accent and volume release; a stored `tick` shows Classic selected; screenshots match `settings-*`.

#### `calibration`: calibration reskin and "Hear the click" (moderate)

- **Depends on:** `base-components`, `metronome`, `session`.
- **Owns:** `src/app/screens/calibration/**` (except `services.ts`).
- **Task:** 05 section 8.4 and 06 section 6.14, flow frozen (05 section 15): bigger marks (26 px, 22 px on phones; ten on one row at 390 px), current mark brass with pulse (fills under reduced motion), heard filled, missed hollow with a stroke, text count kept. "Hear the click" before Start and on the result, absent while listening. Device selects disabled while listening with "Device choice is locked while we listen." Skip hint. Page title "Calibrate" with no second heading.
- **Acceptance:** `calibration.test.tsx` passes with copy-only changes to flow assertions; the calibration e2e passes unchanged except copy (05 section 16 item 16); screenshots match `calibration-*`.

#### `progress-history`: Progress, History and attempt detail (moderate)

- **Depends on:** `domain-components`, `score-frame`, `session`, `copy`.
- **Owns:** `src/app/screens/progress/**`, `src/app/screens/history/**` (except `services.ts`).
- **Task:** 05 section 8.12: difficulty wording, rank gate only when unmet, "Recent ranked takes at this difficulty" with "Not yet played" for screen readers, history rows "Baritone voice · Difficulty 2 · C major · 4/4 · ♩ = 71" with the served meter, attempt detail with the read-only marked score, Listen and Slower, plain title. States as listed.
- **Acceptance:** tests for each row format and the Listen control; screenshots of both screens in both themes and sizes.

#### `shell`: app shell, errors, about and credits (moderate)

- **Depends on:** `base-components`, `icons`, `copy`.
- **Owns:** `src/app/Shell.tsx`, `src/app/app.css`, `src/app/App.tsx`, `src/app/App.test.tsx`, `src/app/routes.tsx`, `src/app/router.tsx`, `src/app/route-types.ts`, `src/app/route-match.ts`, `src/app/route-match.test.ts`, `src/app/appearance.tsx`, `src/app/screens/states/**`, `src/app/screens/about/**`, `src/app/screens/Placeholder.tsx`.
- **Task:** Wordmark, tabs and the settings gear; onboarding chrome (brand and Back only); loop chrome ("Home" at left, no tabs); screen change motion; `#/practice/tips` redirects to results if one is open, else Practice (decision 13); full-screen errors with heading, cause and "Try again" plus "Back to Practice" (clock rate titled "Audio timing problem"); microphone denied screen; Page not found; Credits from Settings > About.
- **Acceptance:** route tests for the redirect and chrome; `states.test.tsx` covers each error screen's two actions; screenshots match `error-clock-*` and `not-found-*`.

### Wave 4

#### `results`: results with tips folded in (hard)

- **Depends on:** `practice` (`SetupSheet`), `session`, `score-frame`, `domain-components`, `base-components`.
- **Owns:** `src/app/screens/results/**` (except `services.ts`; `review/**` returns to this package), `src/app/screens/sheets/**` (except `services.ts`).
- **Task:** 05 section 8.11 and designer's notes 8 to 10 and 17:
  - Header state table: Ranked, Practice, Practice for a reason, Not calibrated with "Calibrate now", Not graded, Incomplete. Not graded shows the clean score and "Clean score. Nothing is marked when a take is not graded."
  - Score toolbar: My take or Clean score, Previous slip, Next slip, Slower, Listen, with "Playing bar n of m" and "From bar n".
  - "One thing to try" with "Hear bar n" or "Hear bars n to m", "Show n more tips" and "Hide tips". Turning tips off gives a toast with Undo.
  - Components with the hatched weakest bar and the sentence; drift in words, milliseconds only with the setting; XP line.
  - Actions in the header on desktop; at the page end on phones, with the pinned bar once the header scrolls away. "Change setup" opens `SetupSheet`; Done goes to a new cover with the new setup. Difficulty offer.
  - Remove `TipsScreen` and the tips step from the loop. Reskin the stop, skip, rank-up and session summary sheets.
- **Acceptance:**
  - `results.test.tsx` and `sheets.test.tsx` cover every header state, Listen from a tapped bar and Slower at 75% (05 section 16 item 12), and the void clean score (item 17).
  - `e2e/loop` passes with no visit to `#/practice/tips`.
  - Screenshots match `results-*`, `results-states-*` and `tips-*`, including high contrast and the phone scrolled state.

### Wave 5

#### `qa`: accessibility and design QA (moderate)

- **Depends on:** every wave 1 to 4 package.
- **Owns:** `e2e/design/**`, `e2e/a11y/**` (new), `src/ui/copy/en.json` (removals only), `tools/lint-copy.baseline.json`, `design/tokens.json` and `src/ui/tokens.css` (alias removals only), `src/ui/components/form/RandomChip*`, `src/ui/components/form/Select*` if unused, `src/ui/components/domain/LevelMeter.tsx`, `docs/redesign/09-qa-report.md` (new). Fixes found in screen files are allowed in this wave only, since nothing else runs in it, and each is listed in the report.
- **Task:** Walk every route at 1440 x 900, 1280 x 800 and 390 x 844, light, dark and high contrast. Delete the 05 section 13.3 keys and deprecated tokens once unused. Add the checks below. Run the 1 m legibility test and record it.
- **Acceptance:**
  - An e2e walks every route and fails on `/\blevel\b/i` in rendered text (05 section 16 item 3).
  - An e2e compares each screen's visible text with `en.json` values (designer's checks).
  - Keyboard: every radio group has one Tab stop and arrow, Home and End keys; the setup sheet, picker dialog and listen confirm move and return focus as 05 section 14 item 8 says.
  - Coarse pointer: every interactive element is at least 44 x 44 px.
  - Reduced motion: no pulse, scale or smooth scroll (checked with `prefers-reduced-motion: reduce`).
  - Every control disabled in the DOM has a visible reason next to it.
  - The contrast test covers high contrast for take and results.
  - Manual: five players read live marks on a 14-inch laptop at 1 m and name at least 90% of slips correctly; the owner walkthrough in 05 section 16 item 20 passes. Both recorded in `09-qa-report.md`.

### Wave 6

#### `tour`: refreshed e2e tour and screenshots (routine)

- **Depends on:** `qa`.
- **Owns:** `e2e/tour/**`, `docs/screenshots/**`.
- **Task:** Update the tour for the new screens and selectors: Baritone in the picker, key grid and time segments, "Show the music", Hear starting pitch with its info, Listen first in practice, results with "One thing to try", Settings > Sound previews. Capture desktop 1440 x 900 and iPhone 390 x 844, light and dark. Keep the take checks (red wrong note with its ghost, late note ghost to the right).
- **Acceptance:** `pnpm exec playwright test -c e2e/tour/playwright.tour.config.ts` passes with no raw copy keys, no horizontal overflow and no console errors; `first-user.spec.ts` passes; a fresh screenshot set is in `docs/screenshots/`.

---

## 5. Coverage of the owner's points

| # | Owner's point | Packages |
| --- | --- | --- |
| 1 | Baritone (and mezzo) | `voices`, `range-picker`, `onboarding`, `practice` |
| 2 | Graphical range on picking an instrument | `setup-model` (range model), `range-picker`, `onboarding`, `practice` |
| 3 | Level becomes Difficulty | `copy`, `domain-components`, `setup-controls`, `qa` |
| 4 | Key control | `setup-model`, `setup-controls`, `practice` |
| 5 | Time signature control | `setup-model` (selector fix), `setup-controls`, `practice` |
| 6 | Keep calibration | `metronome` (gate), `calibration` (flow frozen) |
| 7 | Metronome-like click | `metronome`, `playback-engine`, `settings`, `calibration` |
| 8 | Explain the reference | `sounds-components`, `session`, `read-through` |
| 9 | Hear the music | `playback-engine`, `session`, `read-through`, `results`, `progress-history` |
| 10 | High-end polish | `tokens`, `icons`, `base-components`, `domain-components`, `score-frame`, every screen package, `qa`, `tour` |

---

## 6. Open questions for the owner

1. The audition of `docs/redesign/audio/*.wav` must happen before `metronome` starts. If it slips, `metronome` waits and everything else proceeds.
2. If `voices` finds baritone fails the corpus gate at some difficulty, should it ship as a launch voice with the gap shown in the difficulty control, rather than as "less tested"? (The data says it will pass.)
3. `src/dsp/segmenter.ts` has four lint errors owned by another agent. Packages treat them as known; someone must clear them before release.
