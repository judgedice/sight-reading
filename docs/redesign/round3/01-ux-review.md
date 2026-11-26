# Round 3: navigation review and a setup wizard

Principal UX review after the owner went through first-run setup again. He sings baritone and reads at beginner level. He uses Chrome on a Mac with the built-in mic and speakers. Scope: every screen, the onboarding flow, practice versus ranked, and where difficulty lives. Pitch-readout smoothing is covered in the sound designer's spec, and the false Bluetooth detection is being fixed by an engineer. This document covers only the screens and the words for both.

Sources read: `docs/redesign/05-ux-spec.md` (the brief's `03-ux-spec.md` does not exist; 05 is the UX spec, and 03 is the designer's response), `docs/redesign/round2/01-ux.md`, `docs/PLAN.md` R56 to R73, `config/progression.json`, the corpus manifest, and the code under `src/app/screens/onboarding`, `calibration`, `home`, `src/app/routes.tsx`, `Shell.tsx`, `src/session/gates/availability.ts`, `src/grade/progression/`.

Evidence: a walk of the production build (HEAD plus the audio engineer's uncommitted work in progress) at 1440x900 (`d-*`) and 390x844 (`p-*`). Screenshots are in `docs/redesign/round3/current/`. The walk script is `test-results/round3-walk/walk.spec.ts` (git-ignored; run it with `pnpm exec playwright test -c test-results/round3-walk/walk.config.ts`).

---

## 1. The app as it is

### 1.1 Navigation map

```
#/welcome  (onboarding chrome: brand only)
   └─ 6 steps ──► #/ (Home)  or  #/practice/scan (if "Find my difficulty")

App bar (full chrome): brand · [Practice] [Progress] [History] · gear (Settings)
Phone: brand + gear on top, bottom tab bar Practice / Progress / History

#/            "Practice" tab. Setup, Mode, Start, "Match a note", "Scales" (sheet)
  ├─ Start ──► #/practice/scan  cover ──Show the music──► read-through ──Start playing──► #/practice/play (count-in, try)
  │                                                                                        └─► #/practice/results
  │             loop chrome: no tabs; top-left link says "Home"
  ├─ Match a note ──► #/match (loop chrome; top-left link says "Practice")
  ├─ Scales ──► sheet ──► #/practice/scan (a scale try, always practice)
  └─ Calibrate (status pill / mode hint) ──► #/calibrate (full chrome, no tab highlighted, no Back)
#/progress     rank, streak, common mistakes, difficulty per instrument
#/history      list ──► #/history/:id (marked score, Listen, "Hear what we heard")
#/settings     Profile · Sound · Display · Practice · Accessibility · Data · About (Credits ► #/credits)
```

The words "practice" and "practise" are used for five different things: the tab ("Practice"), the Home screen title ("Practice"), the unranked mode ("Practice"), the verb ("Practise a piece you've seen"), and the button "Practice instead". The loop's back link calls the same screen "Home", but Match a note's back link calls it "Practice" (d-11, d-29, d-16).

### 1.2 Onboarding today: 6 steps

`src/app/screens/onboarding/flow.ts` holds `STEP_COUNT = 6`. Welcome is step 1 and shows no counter, so the first counter the player sees reads "Step 2 of 6". The counter is 14 px grey text at the top right (d-02).

| # | Screen (shot) | What it asks | Branches | Skippable | Needed? |
|---|---|---|---|---|---|
| 1 | Welcome (d-01) | "Get started" | none | no | Yes, as an intro. It should not count as a step. |
| 2 | Choose your instrument (d-02, d-03) | Pick a card. Flute is preselected. The selected card already says "Difficulty 2". | none | no | Yes |
| 3 | Let the app hear you play (d-04) | Allow microphone / Not now | Granted shows "Microphone is on." and jumps to step 4 after 600 ms on its own. Denied, no device, busy or insecure shows a problem card with "Continue without the microphone". "Not now" goes straight to step 6. | "Not now" | Yes, but it is one third of a single job |
| 4 | Check your setup (d-05 to d-07): calibration | Input device, Output, 15 s of clicks, tone, count-in, then an audio check list | A loopback failure shows "Try again" or "Play along instead". Two play-along failures add "Use an estimate". Warnings show as caution banners (Bluetooth, AirPods, filtering). iOS without reported latency gets no Skip (R16). | "Skip", and on failure only "Skip" at the bottom | Yes, but it repeats the device choice and listening from step 3 |
| 5 | Sing one note / Play one note (d-08): Match a note | A target note (G3), a live needle from Low to In tune to High, "Play it again". Continue appears only after a hit. | Offers another voice type if the notes sat outside the range. Left out when the match engine is missing. Reached only with the mic on. | Yes, but only through a quiet 14 px "Skip" in the header beside the counter | Not as a gate. It is a third mic check, and it is the step he called "the tuning step". |
| 6 | Choose a starting difficulty (d-09, d-10) | Primary: "Find my difficulty (3 short pieces, about 5 minutes)". Secondary: "I'll choose" opens a stepper defaulting to 2, a range picture and "Start practising". | Placement needs the mic. Placement goes straight to a ranked scan at difficulty 2. | No | No. The same stepper is on the Practice screen (d-11). |

There is no persisted progress. The reducer lives only in React state and `onboardingDone` is written only by `finish`, so a reload during setup starts again at Welcome.

### 1.3 Practice versus ranked today

- **Ranked**: full XP, the reading timer for the level, fresh music, and it counts for the level window (`progression.levelWindow`), streaks and bests. It is blocked when the mic is off or the route has no measured calibration (`session/gates/availability.ts`). Even when allowed, the per-try gate (`grade/progression/eligibility.ts`) can still turn it into practice with a reason.
- **Practice**: no time limit, listen first, 25% XP (`xp.practiceMult`), no window entry. Scales are always practice (R68).
- Where it shows: the Mode segmented control on Home (d-11); a chip on the cover and read-through, "Ranked · 0:30 to read" or "Practice" (d-29, d-30); a small grey "Practice" badge on results (d-34); and "Practice" in History rows. **The try screen shows nothing** (d-33, p-34).

### 1.4 Difficulty and progression today (what must not break)

- The player's difficulty is per instrument (`profile.instruments[id].level`). Onboarding sets it, either through placement (start 2, ±, R25) or from the stepper.
- The difficulty of the next piece is `settings.practice.level`: a number, or `'random'` when "Follow my progress" is on.
- The level window counts only **ranked** tries served **at the player's level**, or one above as a stretch (`apply.ts` `updateWindow`). An offer needs 4 of the last 5 at 85 or more with 2 at mid tempo. The automatic move needs 8 in a row. A ranked try 2 or more below the player's level earns 25% XP (`belowGap`).
- Corpus: there are **6 baritone pieces at difficulty 1 and 5 at difficulty 2** (manifest `stats.fit.voice-baritone`), against 104 at difficulty 3. A piece already seen is no longer ranked (`seen-before`).

---

## 2. Problems, by severity

Severity: **S1** misleads the player or blocks the task. **S2** is confusing, or costs time on every visit. **S3** is polish.

| # | Sev | Problem | Evidence | Fix |
|---|---|---|---|---|
| 1 | S1 | **The mode shown is not the mode delivered.** After choosing Wired headphones with no finished calibration, Home offers and selects Ranked. The cover and read-through then say "Ranked · 0:30 to read" and run the ranked timer. Results say "Practice", "Calibrate to earn XP on this device". The header said "Calibration didn't finish" the whole time. | d-28, d-29, d-30, p-31, d-34, d-39 | One predicate decides availability and the gate (05 §5.8 already required this; it has drifted, possibly through route keys, the other engineer's area). Nothing may say "Ranked" unless the try can be ranked when it starts. A ranked try that turns into practice says so at that moment, with the reason (§5). |
| 2 | S1 | **Setup is six steps, and three of them are the same job.** Mic permission, "Check your setup" (which shows Input device again and listens again) and "A quick check that we hear you" follow each other. The mic step jumps to the next screen by itself after 600 ms, so step 4 looks like a retry of step 3. This is the owner's "step 4 seems redundant to step 3". | d-04, d-05, d-08 | One "Sound check" step with three visible stages: Microphone, Hear you, Timing (§3). |
| 3 | S1 | **A failed calibration on a normal Mac looks like a broken setup.** Three "Didn't pass" in caution brown, "Some checks failed", diagnostics, and a Bluetooth banner raised on delay alone (now being fixed). The way forward is a lone "Skip" at the bottom, and nothing says what skipping costs. | d-07, p-07 | Timing is the last stage. Its failure is one sentence with the numbers. The alternative is labelled "Shown because the clicks weren't heard". Audio-check details go behind "Details for support". The consequence of skipping is shown in the footer (§3.4, §7). |
| 4 | S1 | **Beginners run out of fresh music.** Difficulty 1 has 6 baritone pieces and difficulty 2 has 5. After about six tries every piece is "seen before", so it is practice, and the 8-in-a-row automatic move can never happen. Starting everyone at difficulty 1 (requested) makes this worse. | manifest `stats.fit` | New ruling (§4.3): when the player's difficulty has no unseen pieces left, results and Home offer the next difficulty, and a ranked try on seen music still counts toward the move. Scales stay the warm-up at difficulty 1. |
| 5 | S2 | **The step indicator is easy to miss.** "Step 2 of 6" is grey 14 px text at the top right. Back sits top left, and the primary action moves around (side column, card, card footer, under the panel). | d-02, d-04, d-05, d-08, d-10 | A named three-step stepper across the top, and a footer fixed to the bottom with Back on the left, primary on the right, Skip beside it (§3.1). |
| 6 | S2 | **The tuning step cannot obviously be skipped, and its readout moves all the time.** Skip is a quiet header link beside the counter. The needle follows every wobble of the voice. | d-08, p-08 | Replace it with "Hear you": any note, a level meter, and a note name that appears once it is steady and then stays put. Skip is in the footer. Tuning practice stays in Match a note on Home (§3.3). |
| 7 | S2 | **Difficulty is asked twice.** The onboarding step duplicates the Home stepper. Its primary button sends a beginner into three ranked pieces at difficulty 2 before they have seen Home. | d-09, d-10, d-11 | Remove the step. Start at difficulty 1. "Find my difficulty" moves to a link under the Home stepper (§4). |
| 8 | S2 | **"Practice" names a tab, a screen and a mode.** The loop calls the same screen "Home", Match a note calls it "Practice", and the owner's own sentence mixes the two. | d-11, d-16, d-29 | Rename the tab and screen "Home". Keep "Practice" and "Ranked" as the two modes (§6). |
| 9 | S2 | **No mode during the try, and a faint one on results.** The strip has Stop, bar, beat line, Mic. Results has a small grey tag. | d-33, p-34, d-34 | One mode pill, solid brass ring for Ranked and dashed neutral for Practice, in the same place on the cover, read-through, try strip and results. Start says "Start practice" or "Start ranked try" (§5). |
| 10 | S2 | **#/calibrate is a dead end.** No Back, no Cancel, no tab highlighted. Continue always goes to Practice, even when the player came from Settings > Sound. | d-25 | Give it a Back link to where the player came from, with Cancel while idle. On finish, return to the referrer. |
| 11 | S2 | **The difficulty control hides how progression works.** "Follow my progress" switches between your level and a fixed number. Neither says that ranked tries away from your difficulty do not count toward moving up. | d-11 | Ranked is always at your difficulty (locked, labelled). Practice lets you choose any difficulty. Remove the switch (§4.2). |
| 12 | S3 | **The same entries have different names by device.** "Match a note" and "Scales" on desktop are "Warm up: match a note" and "Warm up: sing a scale" on the phone. | d-11, p-11 | One "Warm up" group on both: "Match a note", "Sing a scale". |
| 13 | S3 | **The instrument step assumes things.** Flute is preselected, and the card says "Difficulty 2" before any difficulty has been chosen. | d-02 | Preselect nothing, or the last choice. Say "You'll start with C3 to C4 (difficulty 1)". |
| 14 | S3 | **Results "Try again" differs between desktop and phone.** Desktop says "Try again (practice)", the phone says "Try again". | d-34, p-35 | "Try again as practice" on both. |
| 15 | S3 | **Placement is findable only in Settings > Practice ("Run placement again").** | p-21 | A "Not sure? Find my difficulty" link under the Home stepper. Settings keeps it as "Find my difficulty". |
| 16 | S3 | **A reload mid-setup starts again at Welcome.** | code | Persist the wizard position (§3.6). |
| 17 | S3 | **The calibration card in onboarding repeats the device choice from the mic step and shows "Export diagnostics" to a first-time user.** | d-07 | In the wizard, put the Microphone select under "Details". Export only in Details for support. |

---

## 3. The new first-run wizard

### 3.1 Shape

Welcome (an intro, not counted) followed by **three named steps**:

1. **Instrument**
2. **Sound check**, with three stages: Microphone, Hear you, Timing
3. **Ready**

Mockups: `mockups/png/wizard-0-welcome-*`, `wizard-1-instrument-*`, `wizard-2a…2d-*`, `wizard-3-ready-*`.

- **Stepper.** A full-width bar of three segments across the top of the content, each with a numbered dot and a name. Done steps are ink with a tick, the current step is brass with a part-filled bar showing stage progress, and later steps are grey. Under it, an eyebrow reads "Step 2 of 3". The screen-reader name is "Setup, step 2 of 3: Sound check". Done steps can be clicked to go back. Later steps cannot. On the phone the three names still fit at 390 px.
- **Footer.** A sticky bar at the bottom of the viewport on every step, in the same layout: **Back** at the left, then on the right a tertiary **Skip** control (when the stage can be skipped) and the **primary** button. The primary is always the rightmost button. On the phone the primary takes the full width below Back and Skip.
- Welcome has no footer. Its one action, "Get started", sits under a preview of the stepper with the line "Three short steps: your instrument, a sound check, and you're ready."

### 3.2 Step 1, Instrument

As today (cards, range picture, "Play my range", less-tested switch), with these changes:

- The title becomes "Choose your voice or instrument".
- Nothing is preselected on a first run.
- The side card says what the player will start with at difficulty 1.
- Primary: "Next: sound check". Back returns to Welcome.

### 3.3 Step 2, Sound check (merges old steps 3, 4 and 5)

One screen. Desktop shows the stages as a list on the left and the current stage as a card on the right. The phone shows them as three chips above the card. Each stage shows Done, Now, Skipped or "Needs the microphone". Moving from one stage to the next keeps the same screen, so it never looks like starting over.

| Stage | Content | Primary | Skip | If skipped |
|---|---|---|---|---|
| **Microphone** | The current pre-prompt copy plus "Your browser will ask next. Choose Allow." | "Allow microphone" | "Not now" | Hear you and Timing show "Needs the microphone". The player goes to Ready, which says tries won't be graded. Ruling 13 stands. |
| **Hear you** (replaces "Sing one note") | "Sing any note" (instruments: "Play any note"). An input level meter. Once a voiced pitch holds for 0.5 s: a tick, "We hear you clearly", and the note name in large type, fixed. It does not follow the voice after that. The voice-type offer stays. | "Next", enabled once heard | "Skip this check" | Nothing changes. Ready shows "Hear you: Skipped". Match a note on Home is the place for tuning. |
| **Timing** (calibration) | "Sound comes from" (Speakers, Wired headphones, Bluetooth). The marks. A one-line preview. While running: "Listening… 4 of 10 clicks heard". Pass: "Measured: 95 ms. Timing marks will be fair." | "Start timing check", then "Listening…" (disabled), then "Next" | "Skip for now" (not offered where R16 makes it mandatory) | Tries are practice until it runs. Footer note: "Skipped, your tries are practice until you run it." |

**The tuning step he asked to skip is the old step 5, "Sing one note"** (`MatchStep`, `data-testid="ob-match"`). It was already skippable, but only through the header link. In this design it stops being a tuning exercise altogether.

**Steps that appear after a failure say so.** Each recovery panel starts with a bold line naming its cause:

- Loopback fails: "We heard 2 of 10 clicks, not enough to time them." Then "Shown because the clicks weren't heard. Turning the volume up usually fixes it. Or measure another way:" with a "Play along instead" card. The footer primary becomes "Try the clicks again" (mockup 2d).
- Play along fails twice: "Shown because play-along didn't work twice." "Use an estimate" (tries stay practice).
- Mic denied: "Shown because the browser blocked the microphone." Then the browser's steps, "Try again", "Continue without the microphone".

The order is Hear you before Timing. Hearing a voice proves the mic works in 3 seconds, before 15 seconds of clicks that would otherwise fail without saying why.

### 3.4 Step 3, Ready

A summary with one row per item and a fix link where a fix exists:

- Instrument (Change)
- Microphone: On or Off
- Hear you: We hear you clearly, or Skipped
- Timing: Measured, n ms; or Not measured yet, with "Run it now"
- Difficulty: "1 of 10, the simplest. Change it on Home whenever you like."

An info note gives the mode the first tries will use.

- Primary: "Start my first piece". It opens the cover at difficulty 1 in the best available mode.
- Tertiary: "Go to Home".

### 3.5 What is gone

- The difficulty step and its placement button.
- The 600 ms jump from the mic screen to a new screen.
- "Export diagnostics" and the audio-check list in the first-run path (moved under "Details for support").
- The Input device select at the top level (moved under Details).

### 3.6 Persistence

The position (`step`, `stage`, instrument chosen) is saved so that a reload resumes at the same step. Permission, of course, is asked of the browser again.

---

## 4. Difficulty after setup

### 4.1 Start

A new player's difficulty is **1** for the chosen instrument (`setInstrumentLevel(p, id, 1)`), and `settings.practice.level` is 1. No question is asked.

### 4.2 The control on Home (mockups `home-practice-*`, `home-ranked-*`)

The Mode row moves to the top of the setup card, because what difficulty means depends on the mode.

- **Practice mode.** Label "Difficulty". A stepper reading "1 of 10", which can go from 1 to 10 (skipping difficulties with no music, as today), and the 10-segment meter. A small brass mark under the meter shows **your difficulty**. Under it: the level description; then, when the chosen difficulty differs from yours, "One above your difficulty (1)." or "Below your difficulty (3)."; then "Not sure? Find my difficulty · 3 short pieces" (runs placement). The default is your difficulty.
- **Ranked mode.** The stepper is replaced by a read-only row: "Difficulty 1 of 10 · Your difficulty", the meter, and "Ranked tries are at your difficulty. It moves up as you do. To choose another, switch to Practice."
- "Follow my progress" is removed. A stored `'random'` reads as your difficulty.

**Relation to progression.** Nothing in `config/progression.json` changes. Ranked tries are always at the player's level, so every ranked try is eligible for the level window. Today a ranked try at another difficulty earns XP but never moves you. That trap is removed. `belowGap` no longer has a ranked case, but it stays for exported records. Practice is unchanged: 25% XP, no window entry, and "your difficulty stays the same" is now stated.

**Rulings this touches** (§9):

- 05-ux §5.3, the "Follow my progress" switch, is withdrawn.
- R25: placement no longer opens the app.
- 02 §5.6 gains the exhaustion offer (§4.3).

### 4.3 When the pieces run out

When the player's difficulty has no unseen pieces for this instrument:

- Home's Ranked hint reads "You've read every piece at difficulty 1. Move up to difficulty 2, or practise pieces you've seen."
- Results show the move-up offer (the existing offer UI) whatever the window says.

This needs a ruling, because the window rule alone cannot fire at difficulties 1 and 2 for most voices.

---

## 5. "You are in practice mode"

### 5.1 The indicator (mockups `mode-everywhere-*`, `try-strip-*`)

One component, the **mode pill**:

- **Ranked**: a surface fill, a 1.5 px solid brass border and a solid brass ring icon. While reading, the ring becomes the countdown: "Ranked · 0:24 to read".
- **Practice**: a `surface-2` fill, a 1.5 px dashed `border-strong` border, a dashed ring icon, and an optional reason after a dot: "Practice · no time limit", "Practice · you listened first".

Shape (solid versus dashed), colour (brass versus neutral) and the word all differ, so neither colour nor shape alone carries the meaning.

| Place | Practice | Ranked |
|---|---|---|
| Home, above Start | pill + "Start practice" | pill + "Start ranked try" |
| Cover, read-through bar (right) | "Practice · no time limit" | "Ranked · 0:24 to read" (ring countdown) |
| Try strip, right of Stop (new) | "Practice" | "Ranked" |
| Results, under the score | pill + "+4 XP. Practice earns a quarter of the XP, and your difficulty stays the same." | pill + "+16 XP. Counts toward moving up: 3 of the 4 good tries needed." |
| History row and attempt | the existing "Practice" text, as the small pill | "Ranked" |

### 5.2 Honesty rules

1. Nothing says "Ranked" before a try unless `rankedAvailability` and the start-of-try gate agree (problem 1).
2. When a try becomes practice partway through (listen first, reading time extended, the recheck failed), the pill changes in place, adds the reason, and the polite live region says "Now a practice try: {reason}."
3. A known reason before the start (not calibrated, seen before, after a skip) shows on the cover as the pill's reason, not only on results.

---

## 6. Navigation

- **Tabs: Home, Progress, History**, plus the gear for Settings (unchanged on both sizes). "Practice" stops being a tab or a screen title and becomes only a mode. The loop's back link already says "Home". Match a note's back link changes to "Home".
- **After setup:** "Start my first piece" opens the cover. "Go to Home" opens Home with the setup visible. There is no coach mark.
- **Back behaviour:**
  - Wizard Back goes one stage back within Sound check, then one step back.
  - The loop's "Home" link asks before throwing away a try in progress (unchanged).
  - `#/calibrate` gets a Back link and returns to its referrer (Home or Settings > Sound) on Continue.
  - Settings subpages keep "‹ Settings".
- **Dead ends removed:** `#/calibrate` (problem 10), the empty pool at low difficulties (§4.3).
- **Reachable only by accident:**
  - Placement ("Run placement again", buried in Settings > Practice).
  - The calibration pill's dropdown chevron on the desktop header. It should open the same popover as the phone row.
  - "Export diagnostics" inside the calibration card.
- **Warm up group:** "Match a note" and "Sing a scale", named the same on desktop and phone, under a "Warm up" label on Home.

---

## 7. Audio warnings (the Bluetooth message)

Mockup `audio-warning-*`. The engineer's in-progress change already separates `bluetooth` (on evidence) from `delay` (measured). These are the words and placement to ship with it.

- **Say what was measured, then what it changes.** Give the number in ms. Say "practice", never "won't earn XP": practice does earn XP.
- **Name a cause only on positive evidence**: the player chose Bluetooth, or the device name says Bluetooth. Delay alone never names a device.
- **No warning when the delay is within the limit**, whatever the route looks like.
- **Tone.** Info (neutral `surface-2`, an "i" icon) when the cause is unknown. Caution only when the cause is known. Never danger.
- **Placement.** Inside the Timing stage under the measured number, not stacked above the card. On Home it lives in the timing status pill ("Timing: long delay · Why?"), which opens a popover. There is no Home banner for it.

---

## 8. Copy

Sentence case, plain words, no exclamation marks. Keys are suggestions; existing keys are kept where the meaning holds.

### 8.1 Wizard

| Key | Text |
|---|---|
| `onboarding.steps.label` | Setup, step {n} of {total}: {name} |
| `onboarding.step` (changed) | Step {n} of {total} |
| `onboarding.step.instrument` | Instrument |
| `onboarding.step.sound` | Sound check |
| `onboarding.step.ready` | Ready |
| `welcome.steps` | Three short steps: your instrument, a sound check, and you're ready. |
| `onboarding.instrument.title` (changed) | Choose your voice or instrument |
| `onboarding.instrument.body` (changed) | We pick music in your range. Choose the card that fits you best. |
| `onboarding.instrument.start` | You'll start with {low} to {high}. That's difficulty 1, the simplest. The range grows as you move up. |
| `onboarding.next.sound` | Next: sound check |
| `action.next` | Next |
| `onboarding.sound.title` | Sound check |
| `onboarding.sound.body` | Three quick checks so we can hear you and time your notes fairly. About a minute. |
| `onboarding.stage.mic` / `.sub` | Microphone / Let the app listen |
| `onboarding.stage.hear` / `.sub.voice` / `.sub.instrument` | Hear you / Sing any note / Play any note |
| `onboarding.stage.timing` / `.sub` | Timing / Measure the delay |
| `onboarding.stage.status.done` / `.now` / `.skipped` / `.needsMic` | Done / Now / Skipped / Needs the microphone |
| `onboarding.mic.title` (changed) | Let the app hear you |
| `onboarding.mic.body.voice` | We listen while you sing so we can mark each note. Sound is analysed on this device. Nothing is recorded or uploaded. |
| `onboarding.mic.browser` | Your browser will ask next. Choose Allow. |
| `onboarding.mic.notNowHint` (changed) | Not now? You can still read and sing along, but tries won't be graded. You can turn the microphone on later from Home. |
| `onboarding.hear.title.voice` / `.instrument` | Sing any note / Play any note |
| `onboarding.hear.body.voice` | Sing a comfortable note and hold it for a moment. Any note is fine: this only checks that we hear you clearly. It isn't graded. |
| `onboarding.hear.body.instrument` | Play a comfortable note and hold it for a moment. Any note is fine: this only checks that we hear you clearly. It isn't graded. |
| `onboarding.hear.level` | Input level |
| `onboarding.hear.heard` | We hear you clearly. |
| `onboarding.hear.where` | You sang about {note}, which sits well in the {voice} range. (instruments: "You played about {note}.") |
| `onboarding.hear.quiet` | We can't hear you yet. Sing a little louder, or move closer to the mic. |
| `onboarding.hear.tuning` | The note name stays put once we're sure of it. To work on tuning, use Match a note on Home. |
| `onboarding.hear.skip` | Skip this check |
| `onboarding.timing.title` | Timing check |
| `onboarding.timing.body` | Sound takes a moment to travel from the speakers to the mic. We measure it so "late" really means late. |
| `onboarding.timing.output` | Sound comes from |
| `onboarding.timing.start` | Start timing check |
| `onboarding.timing.listening` | Listening… |
| `onboarding.timing.progress` | {found} of {total} clicks heard |
| `onboarding.timing.pass` | Measured: {ms} ms. Timing marks will be fair. |
| `onboarding.timing.failFew` | We heard {found} of {total} clicks, not enough to time them. |
| `onboarding.timing.becauseClicks` | Shown because the clicks weren't heard. Turning the volume up usually fixes it. Or measure another way: |
| `onboarding.timing.playAlong.title` / `.body` | Play along instead / Sing one short note on each of {clicks} steady clicks. About {seconds} seconds. |
| `onboarding.timing.retry` | Try the clicks again |
| `onboarding.timing.becausePlayAlong` | Shown because play-along didn't work twice. An estimate keeps you going, but tries stay practice. |
| `onboarding.mic.becauseDenied` | Shown because the browser blocked the microphone. |
| `onboarding.timing.skip` | Skip for now |
| `onboarding.timing.skipNote` | Skipped, your tries are practice until you run it. |
| `onboarding.details` | Details for support |
| `onboarding.ready.title` | You're ready |
| `onboarding.ready.body` | Here's how we set things up. You can change any of it later. |
| `onboarding.ready.row.*` | Instrument · Microphone · Hear you · Timing · Difficulty |
| `onboarding.ready.mic.on` / `.off` | On / Off: tries won't be graded |
| `onboarding.ready.hear.ok` / `.skipped` | We hear you clearly / Skipped |
| `onboarding.ready.timing.ok` | Measured, {ms} ms |
| `onboarding.ready.timing.none` | Not measured yet. Your tries are practice until you run it. It takes 15 seconds. |
| `onboarding.ready.difficulty` | 1 of 10, the simplest. Change it on Home whenever you like. |
| `onboarding.ready.mode.practice` | Your first tries will be in Practice mode: no time limit, and you can listen first. |
| `onboarding.ready.mode.ranked` | Your tries will be ranked: timed reading, full XP. |
| `action.change` / `action.runItNow` | Change / Run it now |
| `onboarding.ready.start` | Start my first piece |
| `onboarding.ready.home` | Go to Home |

Removed: `onboarding.level.*`, `match.onboarding.*`, `onboarding.calibration.title`, `calibrate.skipHint` in onboarding (kept for `#/calibrate`, changed to "Skipped, your tries are practice until you run it. You can run it later from Home or Settings.").

### 8.2 Home, mode and difficulty

| Key | Text |
|---|---|
| `nav.practice` → `nav.home` | Home (tab and screen title) |
| `nav.skipToStart` | Skip to Start |
| `setup.mode.practice.hint` (changed) | Any difficulty, no time limit, listen first if you like. A quarter of the XP, and your difficulty stays the same. |
| `setup.mode.ranked.hint` (changed) | At your difficulty, with timed reading and fresh music. Full XP, and good tries move you up. |
| `setup.difficulty.yours` | Your difficulty |
| `setup.difficulty.above` | One above your difficulty ({level}). / {n} above your difficulty ({level}). |
| `setup.difficulty.below` | Below your difficulty ({level}). |
| `setup.difficulty.rankedLocked` | Ranked tries are at your difficulty. It moves up as you do. To choose another, switch to Practice. |
| `setup.difficulty.find` | Not sure? Find my difficulty · {count} short pieces |
| `setup.difficulty.exhausted` | You've read every piece at difficulty {level}. Move up to difficulty {next}, or practise pieces you've seen. |
| `action.startPractice` | Start practice |
| `action.startRanked` | Start ranked try |
| `home.warmup` | Warm up |
| `match.entry` / `match.entry.phone` | Match a note (both) |
| `scales.entry` / `scales.entry.phone` | Sing a scale (both) |
| `scales.entry.body` | Up and down, scored, always practice. |
| `settings.practice.placement` (changed) | Find my difficulty |

### 8.3 Mode pill and results

| Key | Text |
|---|---|
| `mode.pill.practice` | Practice |
| `mode.pill.practice.free` | Practice · no time limit |
| `mode.pill.practice.reason` | Practice · {reason} (short reasons: "you listened first", "seen before", "after a skip", "timing not measured", "reading ran long") |
| `scan.chip.ranked` | Ranked · {time} to read (unchanged) |
| `mode.nowPractice` (live region) | Now a practice try: {reason}. |
| `results.xp.practice` | +{xp} XP. Practice earns a quarter of the XP, and your difficulty stays the same. |
| `results.xp.ranked.window` | +{xp} XP. Counts toward moving up: {n} of the {need} good tries needed. |
| `action.tryAgainPractice` (changed) | Try again as practice |

### 8.4 Audio warnings

| Key | Text |
|---|---|
| `calibrate.warn.delay` (replaces the engineer's draft) | Measured: {ms} ms. That's longer than we can time fairly, so tries will be practice for now. Wired headphones often help. |
| `calibrate.warn.bluetooth` (positive evidence and delay over the limit) | Bluetooth adds a delay we can't time fairly, so tries will be practice. Wired headphones or the built-in speakers work better. |
| `banner.bluetooth` | Not shown as a Home banner any more; see `calstatus.delay.*` |
| `calstatus.delay` | Timing: long delay |
| `calstatus.delay.why` | Why? |
| `calstatus.delay.body` | We measured {ms} ms on this setup. Tries are practice until it's under {max} ms. Wired headphones often help. |
| `action.runCheckAgain` | Run the check again |

---

## 9. Rulings PLAN.md will need

- **R74 Setup wizard.** Welcome followed by three steps: Instrument, Sound check (Microphone, Hear you, Timing) and Ready, with a named stepper and a fixed footer. This supersedes 05-ux §4.1 and §8.1 to §8.5, and the onboarding part of R67 (Match a note leaves onboarding; "Hear you" replaces it). R16 holds inside the Timing stage.
- **R75 Start at difficulty 1.** No difficulty question. Placement leaves onboarding and stays reachable from Home and Settings. The note in R25 (difficulty 1 ships unserved below 30 pieces) is already overtaken by the shipped corpus and should be restated as "difficulty 1 is served".
- **R76 Ranked is at your difficulty; Practice chooses.** Withdraw "Follow my progress" (05-ux §5.3). Progression config is unchanged.
- **R77 Exhaustion offer.** When no unseen pieces remain at the player's difficulty for the instrument, offer the next difficulty. (Owner to confirm; see Q2.)
- **R78 Names.** The tab and screen are "Home". The modes are "Ranked" and "Practice".
- **R79 Mode honesty.** One predicate for availability and the start-of-try gate. The mode pill everywhere. A change of mode is announced in place.
- **R80 Audio warnings.** Measured number first. A cause only on positive evidence. No warning within the limit. Info or caution tone only. Warnings sit inside the timing result and the status pill, not in a banner.

## 10. Open questions for the owner

1. **Ranked locked to your difficulty, free choice only in Practice?** Recommendation: yes. It is the simplest honest model, and it reads his "make difficulty an option in the practice mode" literally. The cost: a ranked try above your difficulty is no longer possible. Moving up comes through offers instead.
2. **When the beginner pieces run out, offer difficulty 2 early (R77)?** Recommendation: yes. With 6 baritone pieces at difficulty 1, the normal rule cannot fire. The alternative is waiting for more level 1 repertoire, which ruling 25 forbids composing.
3. **Tab name "Home", or "Read"?** Recommendation: "Home". The loop already uses it, and it ends the clash with the mode at no cost. "Read" is more distinctive but new.
