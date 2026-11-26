# Round 3 build plan

This plan implements `01-ux-review.md`. Mockups are in `mockups/` (sources), and their captures in `mockups/png/` at 2x. Work in the order below. Each item lists the files it touches, what to change, and the tests it affects.

**Coordinate before you start.** Another engineer has uncommitted changes in `src/app/screens/calibration/{CalibrationCard.tsx,flow.ts}`, `src/platform/web/audio/*`, `src/session/gates/gate.ts`, `src/core/types.ts` and `src/ui/copy/en.json`. That work adds the `delay` warning and is the Bluetooth fix. Items 2, 3 and 8 touch the same files, so land them after it. The sound designer's pitch-steadiness spec owns the smoothing used in item 5 ("Hear you" shows a fixed note name). Use whatever steadiness detector that spec provides, and do not tune DSP here.

---

## 0. Rulings first

Add R74 to R80 to `docs/PLAN.md` under a new "Round 3 (R74 to R80)" heading, using the wording in 01 section 9, once the owner has answered Q1 and Q2 in 01 section 10. Items 6 and 7 depend on Q1. Item 9 depends on Q2.

## 1. Mode honesty (S1, problem 1) — do first, independent

- `src/session/gates/availability.ts`, `src/session/practice-session.ts` (`rankedAvailability`), `src/app/compose/app-services.ts` (the `rankedAvailability` value and the place it is recomputed):
  - Make Home's availability use exactly the calibration lookup that the start-of-try gate uses (`calibrationForRoute` with the route key the try will use). Recompute it when the output mode changes and when calibration is saved.
  - Reproduce first: with Output set to Wired headphones and no accepted calibration, Home offers Ranked today (screens `d-28`, `d-39`).
- `src/app/screens/scan/ScanScreen.tsx`: when the prepared try already carries a practice reason (calibration, seen before, after a skip), show the Practice pill with the reason. Never show the ranked chip and timer in that case.
- Tests:
  - A unit test in `src/session/gates/availability.test.ts` for wired with no calibration.
  - `src/app/compose/app-services.test.ts`, around line 184.
  - A new e2e assertion in `e2e/tour/first-user.spec.ts`: when Home says Practice, the cover says Practice.

## 2. Mode pill component

- New `src/ui/components/setup/ModePill.tsx`, plus CSS in `setup.css`. Use tokens only (`--brass`, `--surface-2`, `--border-strong`, `--mode-chip-height`).
  - Props: `mode`, `reason?`, `countdown?` (the reading ring).
  - Its accessible name is its visible text.
- Use it in:
  - `src/app/screens/home/HomeScreen.tsx`: beside Start. Start's label comes from `action.startPractice` / `action.startRanked`.
  - `src/app/screens/scan/ScanScreen.tsx`: replaces `scan.chip.*`, keeping the ring countdown.
  - `src/app/screens/perform/PerformScreen.tsx`: the try strip, right of Stop. This is new.
  - `src/app/screens/results/ResultsPanel.tsx`: under the score, with `results.xp.practice` / `results.xp.ranked.window`.
  - History rows and the attempt view (`src/app/screens/history/MetaLine.tsx`).
- Mode changes mid-try (listen first, reading extended): update the pill in place and announce `mode.nowPractice` in the existing polite live region.
- Tests: `home.test.tsx`, `scan.test.tsx`, `perform.test.tsx`, `results.test.tsx`, `history.test.tsx`. Also add a pill story to `src/ui/components/setup/story`.

## 3. Names: Home, Warm up

- `src/app/routes.tsx`: `TABS[0].labelKey` becomes `nav.home`, and the `home` route's `titleKey` becomes `nav.home`. Keep the internal `TabId` `'practice'` to avoid churn.
- `src/app/screens/match/MatchScreen.tsx`: the back link says Home.
- `src/ui/copy/en.json`: section 8.2 keys. Make `match.entry.phone` and `scales.entry.phone` equal to the desktop strings, or delete them and use one key.
- `src/app/screens/home/HomeScreen.tsx`: one "Warm up" group (`home.warmup`) on both layouts.
- `action.tryAgainPractice`: "Try again as practice", the same on both sizes in `ResultsPanel.tsx`.
- Copy tooling:
  - Add "Practice" as a tab name to the old-words list (`e2e/a11y/copy-match.ts` `oldWordsIn`): only where it is a nav label.
  - Update `src/ui/copy/round2-spec.json` where its keys change, and add a `round3-spec.json` if `tools/lint-copy.ts` expects a spec file per round.
- Tests:
  - e2e that click the tab or read the title "Practice": `e2e/a11y/keyboard.spec.ts`, `e2e/a11y/owner-walkthrough.spec.ts`, `e2e/tour/tour.spec.ts`, `e2e/tour/owner-review.spec.ts`, `e2e/design/helpers.ts`.
  - Unit: `App.test.tsx` and `home.test.tsx` (heading).

## 4. Onboarding state machine

- `src/app/screens/onboarding/flow.ts`, rewritten:
  - `OnboardingStep = 'welcome' | 'instrument' | 'sound' | 'ready'`.
  - `SoundStage = 'mic' | 'hear' | 'timing'`.
  - `STEP_COUNT = 3` (Welcome is not counted).
  - State: `{ step, stage, trail, mic, hear: 'pending'|'heard'|'skipped'|'n/a', timing: CalibrationResult|null|'n/a', match: boolean }`.
  - Events:
    - `next`, `back` (stage first, then step)
    - `mic-*` as today, but `mic-granted` moves the stage to `hear`, not to a new screen
    - `hear-done`, `hear-skip`
    - `calibration-done(result)`
    - `goto-step` (done steps only)
  - Without the match engine, the `hear` stage is `n/a` and skipped.
  - When R16 makes calibration mandatory, there is no `timing` skip.
- Persistence:
  - Add `onboardingProgress?: { step: 'instrument'|'sound'|'ready'; stage?: 'mic'|'hear'|'timing'; instrumentId: string; showBeta: boolean }` to `AppSettings` in `src/core/types.ts`.
  - It is optional, so no migration is needed.
  - Regenerate the schemas and validators (`pnpm schemas`, `pnpm validators`). The export validator lives in `src/store/export-file-validator.js`.
  - Write it on every step change, and clear it in `finish`.
  - `OnboardingScreen` reads it on mount. The mic stage is re-asked if permission is no longer granted.
- Tests: rewrite `src/app/screens/onboarding/onboarding.test.tsx` around the new events, including resume after reload, mic declined (hear and timing become `n/a`), and the mandatory iOS path.

## 5. Onboarding screens

- `src/app/screens/onboarding/OnboardingScreen.tsx`:
  - New `WizardStepper` (three named segments, part-filled current step, eyebrow "Step n of 3", `aria-label` from `onboarding.steps.label`, done steps are buttons).
  - New `WizardFooter`: sticky, with Back on the left and Skip plus primary on the right. On the phone the primary is full width on its own row.
  - Remove the header counter and the header Skip.
- Instrument step:
  - Nothing preselected on a first run (`services.initial.instrumentId` becomes `null` unless resuming).
  - Continue is disabled until a card is picked.
  - The side card says `onboarding.instrument.start` for difficulty 1 (`rangeData(cfg, inst, 1)`; `START_DIFFICULTY` in `ranges.ts` becomes 1).
- Sound check:
  - New `SoundCheckStep.tsx` holding the stage list (desktop) or chips (phone) and the stage panels.
  - Mic panel: today's mic content and problem cards, with the "Shown because…" lead line on the denied card.
  - Hear panel: new `HearStep.tsx`, replacing `MatchStep.tsx` in onboarding.
    - It uses the match engine (`useMatch`) in a new mode with no target note and no needle.
    - It shows the input level from the engine's level reading.
    - It marks "heard" once a voiced pitch is steady for 0.5 s, using the steadiness detector from the sound designer's spec. It then freezes the note name.
    - The voice-type offer (`otherVoiceOffer`) is kept.
    - `MatchStep.tsx` is deleted once nothing imports it.
  - Timing panel: `CalibrationCard` with a new prop `variant="wizard"` that:
    - hides the title and intro and the Input device select (moved into a "Details" disclosure);
    - moves Start, Continue and Skip out to the wizard footer, through callbacks (`onPrimaryChange` or a render prop);
    - shows the failure lead lines (`onboarding.timing.because*`);
    - puts the audio-check list and Export under "Details for support".
    - Coordinate with the calibration engineer. This is a presentation-only prop; `flow.ts` keeps its states.
  - Remove the 600 ms `MIC_GRANTED_HOLD_MS` jump to a new screen. The stage list ticks and the hear panel replaces the mic panel in the same card. A 600 ms hold on "Microphone is on." in the stage row is fine.
- Ready step: new `ReadyStep.tsx`.
  - The summary list, with "Change" (goes to step 1) and "Run it now" (goes back to the timing stage).
  - The mode note.
  - "Start my first piece" and "Go to Home".
- `onboarding.css`: stepper, footer, stage list. Tokens only; follow the stylelint rules.
- `src/app/screens/onboarding/services.ts`:
  - `LevelChoice` is removed; `OnboardingResult.level` becomes the fixed value 1.
  - Add `start: 'first-piece' | 'home'` and `hear: 'heard'|'skipped'|'n/a'`.
- `src/app/compose/app-services.ts` `finish`:
  - `setInstrumentLevel(p, id, 1, cfg)`, `practice.level = 1`.
  - The mode is `ranked` only when the mic is allowed and a calibration was accepted, otherwise `practice`.
  - Clear `onboardingProgress`.
  - On `first-piece`, `prepareNext` and return `/practice/scan`; otherwise return `/`.
  - Remove the placement branch from `finish`; placement is still started from Home and Settings.
- Copy: section 8.1 keys in `en.json`. Remove `onboarding.level.*`, `match.onboarding.*` and `onboarding.calibration.title`.
- Tests:
  - `onboarding.test.tsx`
  - `app-services.test.ts` (lines 119 and 135 use `level: {kind…}`)
  - `states.test.tsx` (onboarding mic states)
  - `calibration.test.tsx` (wizard variant)
  - e2e onboarding helpers, which all walk "Allow microphone, Skip, Skip, I'll choose, Start practising":
    - `e2e/loop/flow.ts` `onboard()`
    - `e2e/a11y/onboard.ts`
    - `e2e/design/helpers.ts`
  - e2e specs that repeat the walk inline:
    - `e2e/tour/first-user.spec.ts`
    - `e2e/tour/owner-review.spec.ts` (point 3, "sing one note in onboarding", is retired; its Match a note half stays on Home)
    - `e2e/tour/tour.spec.ts`, `note-colours.spec.ts`, `scales.spec.ts`, `scale-try.spec.ts`
    - `e2e/a11y/keyboard.spec.ts`, `e2e/a11y/owner-walkthrough.spec.ts`
    - `e2e/design/perform.spec.ts`
    - `e2e/loop/scale.spec.ts`, `e2e/loop/trailing.spec.ts`
    - `e2e/scale-try.spec.ts`
    - `e2e/setup/practice-fit.spec.ts`
  - Update the shared helpers first so most specs change in one place. Several specs pick difficulty 1 by pressing "Decrease Difficulty" once from 2; after this change that press does nothing (it is already at 1).
  - Add a new e2e test, `e2e/tour/wizard.spec.ts`:
    - the stepper says "Step n of 3" with names;
    - the footer primary is always the rightmost button;
    - skip hear and timing, then Ready says Skipped and Not measured;
    - reload mid sound check resumes there;
    - "Start my first piece" opens the cover at difficulty 1 in Practice.

## 6. Difficulty on Home (depends on Q1)

- `src/ui/components/setup/DifficultyControl.tsx`:
  - Remove the "Follow my progress" switch (`hideFollow` and `follow` go).
  - Add `yourLevel` (the brass mark under the meter, and the above or below note).
  - Add a `locked` variant for Ranked (a read-only row).
  - Add the `onFindLevel` link.
- `src/app/screens/setup/model.ts`:
  - `normalize` reads a stored `'random'` as the player's level (no stored-data migration).
  - In ranked mode the effective level is always `ctx.playerLevel(id)`.
  - `setupModel` drops `follow`, `followValue` and `followHint`, and adds `yourLevel`, `relation: 'same'|'above'|'below'` and `locked`.
- `src/app/screens/home/HomeScreen.tsx`:
  - Move the Mode row to the top of the setup card (desktop) and above the summary chips (phone).
  - Wire placement to "Find my difficulty". It reuses `startPlacement` from the services, exposed to Home (today it is only in Settings > Practice).
- `src/app/screens/setup/SetupSheet.tsx` (phone): the same control.
- Placement: rename the Settings > Practice row to `settings.practice.placement` ("Find my difficulty").
- Tests:
  - `setup.test.tsx`, `model.test.ts` (setup), `home.test.tsx`
  - `src/ui/components/setup/setup.spec.ts` (visual story)
  - `e2e/setup/practice-fit.spec.ts`
  - The `pickDifficulty` helper in `first-user.spec.ts`. It uses "Increase Difficulty"; in Ranked mode it must switch to Practice first, or the test must choose Practice.

## 7. Progression wiring check (depends on Q1)

- No change to `src/grade` or `config/progression.json`. Do confirm with a unit test that:
  - every ranked try served from Home is at `profile.instruments[id].level` (or a stretch one above), so it enters the window (`src/grade/progression/apply.ts` `updateWindow`);
  - `belowGap` is no longer reachable for a ranked try.
- `src/session/practice-session.ts`, `prepare`: when `mode === 'ranked'`, request the player's level whatever `settings.practice.level` says.

## 8. Audio warnings (after the calibration engineer lands)

- `src/ui/copy/en.json`: set `calibrate.warn.delay` and `calibrate.warn.bluetooth` to the section 8.4 text.
- `src/app/screens/calibration/CalibrationCard.tsx`:
  - Render warnings inside `cal-result`, under the measured number, using a new `Banner` tone `info` for `delay` and `caution` for `bluetooth`.
  - Never show `bluetooth` and `delay` together: Bluetooth wins when both apply.
  - Show nothing when the delay is within the limit.
- `src/ui/components/calibration-status/CalStatusPill.tsx` and `text.ts`: add a `delay` status ("Timing: long delay", "Why?" popover with `calstatus.delay.body`).
- Remove the Home `bluetooth` notice from the `HomeBanner` priority list in `src/app/screens/home/HomeScreen.tsx` / `services.ts`; the pill carries it.
- Tests: `calibration.test.tsx` (the engineer's new cases plus placement), `calibration-status.test.tsx`, `home.test.tsx`.

## 9. Exhaustion offer (depends on Q2)

- `src/session/practice-session.ts` (selection) and `src/app/screens/home/HomeScreen.tsx`: when `countEligible` for unseen pieces at the player's level is 0:
  - the Ranked hint shows `setup.difficulty.exhausted` with "Go to difficulty n+1";
  - results show the offer UI (`ResultsPanel` level-up block) with the same action.
- Accepting calls `setInstrumentLevel` (the same path as `acceptOffer`).
- A grade-side change is not needed if this is treated as a UI offer. If the owner wants it automatic, it belongs in `src/grade/progression/apply.ts`, which needs its own ruling.
- Tests: `home.test.tsx`, `results.test.tsx`, and a session test with a 6-piece pool.

## 10. #/calibrate exits

- `src/app/screens/calibration/CalibrationScreen.tsx`: a Back link (`common.back`). Return to the referrer: read `history.state` or a `?from=settings` query that callers add (`HomeScreen` and the Settings > Sound link). Continue goes to the referrer.
- `src/app/routes.tsx`: `calibrate.tab` becomes `'practice'` when coming from Home, or stays null; highlight nothing, but the Back link is enough.
- Tests: `calibration.test.tsx`, `App.test.tsx`.

## 11. Small fixes

- The desktop calibration pill's chevron opens the same popover as the phone row (`CalStatusPill`).
- `e2e/tour` screenshots: refresh `docs/screenshots/*` with the tour config after items 1 to 6.

## 12. Gates

Run these, then the tour config with all four projects:

- `pnpm typecheck`
- `pnpm lint` (stylelint: no hex or px outside `tokens.css`)
- `pnpm test`
- `pnpm lint:copy`
- `pnpm schemas:check`, `pnpm validators:check`
- `pnpm size` (the onboarding chunk grows a little; the limit in R66 still applies)
- `pnpm test:e2e`

Check the new screens with `e2e/a11y` axe: the stepper is a list, and the current step has `aria-current="step"`.

## Files at a glance

| Area | Files |
|---|---|
| Wizard | `src/app/screens/onboarding/{flow.ts, OnboardingScreen.tsx, SoundCheckStep.tsx (new), HearStep.tsx (new), ReadyStep.tsx (new), WizardStepper.tsx (new), WizardFooter.tsx (new), services.ts, ranges.ts, onboarding.css}`; `MatchStep.tsx` deleted |
| Calibration | `src/app/screens/calibration/{CalibrationCard.tsx (wizard variant, warnings), CalibrationScreen.tsx}` |
| Home and setup | `src/app/screens/home/HomeScreen.tsx`, `src/app/screens/setup/{model.ts, SetupSheet.tsx}`, `src/ui/components/setup/{DifficultyControl.tsx, ModeControl.tsx, ModePill.tsx (new)}` |
| Loop | `src/app/screens/scan/ScanScreen.tsx`, `src/app/screens/perform/PerformScreen.tsx`, `src/app/screens/results/ResultsPanel.tsx`, `src/app/screens/history/MetaLine.tsx` |
| Shell | `src/app/routes.tsx`, `src/app/screens/match/MatchScreen.tsx` |
| Session and store | `src/session/gates/availability.ts`, `src/session/practice-session.ts`, `src/app/compose/app-services.ts`, `src/core/types.ts` (`AppSettings.onboardingProgress`), `schemas/`, `src/store/*-validator.js` (generated) |
| Copy | `src/ui/copy/en.json`, `src/ui/copy/round2-spec.json`, `e2e/a11y/copy-match.ts` |
| Docs | `docs/PLAN.md` (R74 to R80) |
