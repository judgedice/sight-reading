# QA report: accessibility and design (package `qa`)

Scope: 08-plan wave 5. Every route walked at 1440 x 900, 1280 x 800 and 390 x 844 in light, dark and high contrast, plus reduced motion; the leftovers of the redesign deleted; the automated checks added; the two manual checks recorded.

Status in one line: every automated acceptance item passes; the two manual checks (five-player 1 m test, the owner's own walkthrough) have **not** been run by a person and are recorded below as open, with the protocol and a scripted stand-in for the walkthrough.

## 1. How to run it

```sh
pnpm exec playwright test -c e2e/a11y/playwright.a11y.config.ts                   # all projects, the walk, keyboard, owner walkthrough
pnpm exec playwright test -c e2e/a11y/playwright.a11y.config.ts --project=p390-hc  # one project
A11Y_SHOTS=1 pnpm exec playwright test -c e2e/a11y/playwright.a11y.config.ts walk.spec.ts --project=d1440-hc   # save screenshots
pnpm exec playwright test -c e2e/design/playwright.design.config.ts               # the earlier design suite (axe, targets, motion, grayscale, perform)
pnpm exec vitest run src/ui/tokens.contrast.test.ts                               # token contrast, light, dark and high contrast
```

Use `E2E_A11Y_WORKERS=2` (the default is 3). A take that arrives while three browsers share a small machine can come back void; the walk accepts a void result as a screen to walk and carries on, but graded results are the common case at 2 workers.

Projects (`e2e/a11y/playwright.a11y.config.ts`): `d1440`, `d1280` and `p390` (390 x 844, touch, coarse pointer) crossed with `light`, `dark`, `hc` (high contrast, light), `hcdark` (1440 and 390 only) and `reduced` (reduced motion, 1440 and 390 only): 13 projects. High contrast is forced by an init script that sets `data-contrast="high"` on `<html>` from the first paint, so onboarding is covered as well; the real switch is covered by the settings tests.

Last full run: 13 of 13 walks with 0 problems, the keyboard cases on both light projects, owner walkthrough 2 of 2 (26 passed, the other 52 skipped by design in the full run before the owner walkthrough was added); `e2e/design` 18 of 18; `e2e/loop` 3 of 3; `e2e/setup` 10 of 10; `pnpm exec vitest run` 3723 of 3723; `pnpm typecheck`, `eslint src e2e tools`, `lint:css`, `lint:cycles`, `tokens:check`, `schemas:check` and `lint:copy` clean. Screenshots (desktop and phone, light, dark and high contrast; take, results, sheets, picker, calibration, settings, history) are in `docs/redesign/shots-build/qa/<project>/`.

## 2. The walk

`e2e/a11y/walk.ts` visits, in the order a player meets them: welcome, instrument step (before and after a pick), microphone, calibration, difficulty (both states); Practice; the instrument dialog; on phones the setup sheet; every tab and secondary route (including `#/practice/tips` and `#/practice/results` with no result, not-found and the dev gallery); then one practice take through the fake microphone: cover, read-through, count-in, take, results, the setup sheet over results; the attempt in History; Progress with a take; and the calibration listening state. `e2e/a11y/walk.spec.ts` runs these checks on every screen:

| Check | Acceptance item | Where |
| --- | --- | --- |
| Rendered text and accessible names never match `/\blevel\b/i` | 05 s16 item 3 | `walk.spec.ts` (`LEVEL`) |
| Every visible text block is a value from `en.json` (placeholders and plural forms matched; pieces split on " · ", ": " and ", ") or a named kind of data (numbers, note names, ranges, keys, tempo, key caps, dates, instrument and rank names from config, a piece's title and credit) | designer's check | `copy-match.ts`, `dynamic-text.ts`, `helpers.ts` |
| axe: no serious or critical violation, which includes colour contrast, in every theme, **take and results in high contrast included** | contrast test covers high contrast | axe in `walk.spec.ts` on the `hc` and `hcdark` projects |
| Coarse pointer: every interactive element at least 44 x 44 px | 05 s14 item 9 | `smallTargets` on the `p390-*` projects |
| Reduced motion: no running animation that repeats or moves (pulse, scale, translate, rotate), no `scroll-behavior: smooth`, no scroll call asking for `behavior: "smooth"` | 05 s14 item 12 | `reduced` projects; the detector was checked to see a pulse on the calibration screen with motion allowed and none with it reduced |
| Every control disabled in the DOM (`disabled` or `aria-disabled="true"`) has a visible reason named by `aria-describedby` on it or on its group | 05 s16 item 4 | `disabledWithoutReason` (the dev gallery is exempt) |
| No horizontal overflow on a phone | 05 s16 item 7 area | `horizontalOverflow` |
| Focus moves into the instrument dialog, the phone setup sheet and the setup sheet over results, and returns to the control that opened it on Escape | 05 s14 item 8 | `openVisitClose` in `walk.ts` |

`src/ui/tokens.contrast.test.ts` gained a block that recomputes every take and results pair (ink, staff line, error, ghost, correct, text, muted text, brass, borders, danger, focus ring) **with the high contrast overrides applied**, not only the pairs the table marks as high contrast: 94 more cases (47 pairs in two themes), all pass.

## 3. Keyboard

`e2e/a11y/keyboard.spec.ts` (light projects): it Tabs through the whole page and counts how many radios of each `role="radiogroup"` take focus (must be one), then drives each group with End, Home, ArrowRight and ArrowLeft and checks that the arrow selects. Groups covered: onboarding instruments (13 cards), the instrument dialog, Practice (Key, Time, Mode), the phone setup sheet from the Key, Time and Length chips, Settings > Sound (click sounds, "Click during the take"), Settings > Display (Theme, Live feedback), Settings > Accessibility (Reduce motion). It also checks that the instrument dialog traps focus (40 Tabs stay inside) and gives focus back to "Change instrument"; that the phone setup sheet focuses the chosen row's control from each chip and returns focus to that chip; and that the listen confirm focuses "Keep it ranked", traps Tab, and returns focus to "Listen first" on Escape.

## 4. Fixes found by QA

Each is in a file outside the package's own list, allowed for this wave only.

| # | Found | Fix | Files |
| --- | --- | --- | --- |
| 1 | Home and End did nothing in the two groups built from native radios ("Click sound" and "Click during the take"; every `SegmentedControl`, so Theme, Live feedback, Reduce motion and the setup Mode and Time controls too). Browsers move native radios with the arrows only. | New `radioGroupHomeEnd` forwards Home and End to the first and last enabled radio; used by `SegmentedControl` and the sound list. | `src/ui/components/form/radio-keys.ts` (new), `SegmentedControl.tsx`, `index.ts`, `src/app/screens/settings/SoundSection.tsx` |
| 2 | While calibration listens, both device selects are disabled and the reason ("Device choice is locked while we listen.") sat beside them but was not tied to them. | `Select` takes `describedBy`; the calibration card names the reason on both selects. | `src/ui/components/form/Select.tsx`, `src/app/screens/calibration/CalibrationCard.tsx` |
| 3 | The take's Stop button is disabled while the take finishes, with "Scoring..." beside it, not tied to it. | `aria-describedby` on Stop while finishing. | `src/app/screens/perform/PerformScreen.tsx` |
| 4 | axe `label-content-name-mismatch` on the credit button in History detail: the visible text (title, composer) was not in the accessible name "About this music". | The name is now "{credit}. About this music". | `src/app/screens/history/AttemptScreen.tsx` |
| 5 | History detail: "Back" was 38 x 24 and the credit button 42 high on a coarse pointer. | `min-block-size` and `min-inline-size` of `--target-min`. | `src/app/screens/history/history.css` |
| 6 | Onboarding difficulty step, 390 px: the primary label "Find my difficulty (3 short excerpts, about 5 minutes)" did not wrap and pushed the page 10 px wide. | The stacked actions let the label wrap inside the button. | `src/app/screens/onboarding/onboarding.css` |
| 7 | `results.show` was still the name of the My take / Clean score switch. | The switch is named by the existing `review.toolbar` ("Review"). | `src/app/screens/results/review/Review.tsx` |

## 5. What was deleted

- `en.json`: `chip.random`, `tips.header`, `tips.count`, `tips.noTips`, `results.show`, and the leftovers of the old tips screen that the baseline listed for this wave: `tips.incomplete`, `results.xp.details`, `action.doneForNow`. The rest of 05 section 13.3 (`settings.audio.click.tick`, `.wood`, `home.meterTooltip`, `results.prevSlip`, `results.nextSlip`, `action.reload`, `onboarding.name.hint`) was already gone; `settings.profile.hint` is in use. `tools/lint-copy.baseline.json` lost those five and `review.toolbar` (now used); `lint:copy`: 785 keys, 0 unused, 0 stale.
- Tokens (`design/tokens.json`, regenerated `src/ui/tokens.css` and `tokens.ts`): `elevation-overlay`, `playhead-next`, `ink-accent-soft`, `random-chip-height`, `random-chip-x-padding`, `instrument-circle`, `verdict-glyph-sizes`, `stepper-value-width`, the version 1 score keys `lane-glyph-size` (px), `lane-height`, `system-gap` and `past-mark-opacity.oneBeatPast`, and `level-meter-width` and `level-meter-height`. Nothing read any of them (checked by search across `src`, `e2e` and `tools`).
- Components: `RandomChip` (and its test, its `.ui-random-chip` rules in `form.css`); the `LevelMeter` component (unused by any screen; it, its CSS and its token pair are gone). Its pure scale functions, which the performance screen's mic meter does use, moved to `src/ui/components/domain/meter.ts` with their test. `TipCard` lost its unused "(1 of 2)" caption props.
- Kept: `Select` (the calibration card, Settings > Sound and the History filter use it).
- Comments that named removed tokens (`layout-table.ts`, `highlights.ts`) were reworded.

Tests changed because the redesign legitimately changes their assertions: `tools/generate-tokens.test.ts` (the "keeps the removed tokens as aliases" test now asserts they are gone), `src/ui/components/form/form-css.test.ts` and `form-targets.test.ts` (no random chip), `src/ui/components/domain/domain.test.tsx` (no `tips.count`; the `LevelMeter` rendering tests replaced by tests of the zone and scale functions). No test was skipped or weakened.

## 6. Manual check 1: five players read live marks at 1 m (05 s16 item 19)

**Not run.** It needs five people, a 14-inch laptop and a metre of table, and this package was built without them. Status: open. Do not call the legibility item met until the table below is filled in.

Protocol:

1. A 14-inch laptop at 100% browser zoom, brightness at the usual indoor setting, light theme first, then dark and high contrast if time allows. The player sits 1 m from the screen (mark it with tape).
2. Load a take with known slips: run `e2e/tour` (or the loop e2e) so the take plays a scripted WAV, or use `#/dev/replay` with a render stream. Use at least one of each verdict the live feedback draws: early, late, wrong note (red note with its ghost), sharp, flat, missed. Write down the order in advance.
3. The player watches the live marks only and says aloud, for each slip, what it is ("late", "wrong note", "sharp"...). Do not point at the slip.
4. Tally per player and overall.

| Player | Slips shown | Named correctly | Notes (which verdicts were confused) |
| --- | --- | --- | --- |
| 1 | | | |
| 2 | | | |
| 3 | | | |
| 4 | | | |
| 5 | | | |
| **All** | | | **Pass at 90% or more of all slips named correctly** |

A desk estimate, to say where to look first, not a result: a 14.2-inch panel at 1512 CSS px across is about 0.20 mm per CSS px, which is 0.69 arcminutes at 1 m. The live lane marks are 1.25 staff spaces (20.6 px at the take's 16.5 px staff space) and so about 14 arcminutes; in high contrast 1.5 staff spaces (24.8 px) is about 17; the notehead is about 13. Common ergonomic guidance for symbols read at a distance is 16 to 22 arcminutes. So the default size is below that range and the high contrast size is at its bottom edge. If the live test misses 90%, the mark size is the first knob (06 section 5 leaves only the drawing free to change, 05 section 15).

## 7. Manual check 2: the owner walkthrough (05 s16 item 20)

**The owner's own run is open.** What was done in its place: `e2e/a11y/owner-walkthrough.spec.ts` plays the same steps through the UI at 1440 x 900 and at 390 x 844 using only roles and visible names, and passes on both:

1. Picked "Baritone voice" in the picker (a card in the Voice group).
2. Saw the range picture as a figure named "Baritone voice range: G2 to G4. At difficulty 2: C3 to C4."
3. Set the key to G major (on the phone through the Key chip's sheet).
4. Set a time signature (raised the difficulty so a second meter was offered; chose 6/8).
5. Heard each click sound's preview in Settings > Sound and played Beep (it shows "Playing: Beep").
6. On the read-through pressed "Hear starting pitch": the visible line "Plays the key chord, then your first note.", the info button "About Hear starting pitch" opens "What is the reference?" and closes on Escape (on the phone the same text is in "What do these do?"), and the live caption "Key chord: G major" shows while it plays.
7. Pressed "Listen first" (practice: plays at once) and saw "Playing bar n of m".

This proves each step exists and works for a script. It does not prove the owner finds it without help; that is the manual run, to be recorded here with the date and what he hesitated at.

| Date | Who | Step he hesitated at or asked about | Result |
| --- | --- | --- | --- |
| | | | |

## 8. Open items

1. **Review notes on a phone are narrower than 44 px.** In results and History detail each note is a focusable button (04 section 8.3) drawn at the music's own spacing, 11 to 17 px wide on a phone, 144 px tall. No hit area can be 44 px wide without covering its neighbours. The tap-target check holds them to the height only (`e2e/design/helpers.ts`). Decision for the owner and the designer: accept (the notes are positional content, and the verdict is also in the "How it went" counts and the slip stepper), or give each note a hit zone cut halfway to its neighbours.
2. **Click sound gate.** `pnpm test` prints "sound gate verdict: classic true, woodblock false, beep false" (Woodblock and Beep miss the onset F1 or click-extras floor in a few clean and phone cases at -10 dB; Classic passes everywhere). It is a report, not a failing test, and it belongs to the `metronome` package. Acceptance item 15 of 05 section 16 depends on it; check it before release.
3. **Mic meter.** The unused `LevelMeter` component is gone; the performance screen draws its own meter, unchanged.
4. **High contrast is forced by an init script in these projects** (the settings switch is covered elsewhere); a project that wants the switch itself can toggle Settings > Accessibility after onboarding.
5. **README.** It lists the design config; add `pnpm exec playwright test -c e2e/a11y/playwright.a11y.config.ts` beside it (the README is not a QA file).
6. `dist-size/` (untracked build output) makes a bare `eslint .` fail with thousands of errors on minified files; `eslint src e2e tools` is clean. Not touched.
