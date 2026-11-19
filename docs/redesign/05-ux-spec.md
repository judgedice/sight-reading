# Experience spec: the redesigned practice loop

Author role: principal UX expert.
Reads: `01-design-rating.md`, `02-ux-rating.md`, `03-designer-responds.md`, `04-ux-responds.md`, `docs/spec/04-design.md`, `config/instruments.json`, `config/levels.json`, `src/ui/copy/en.json`, the setup, scan and session code.
Status: binding for the front-end build. Where this document and `docs/spec/04-design.md` disagree, this document wins. Where it and 01 to 04 disagree, this document wins. Visual values (type, colour, sizes, motion curves) belong to the design spec that follows this one; this document says what each screen does and says.

How to read it. Section 1 settles the open arguments. Sections 2 to 4 set the structure and the flows. Sections 5 to 11 specify each part. Section 12 is the vocabulary. Section 13 lists every new or changed string with its key. Sections 14 to 16 cover accessibility, what must not change, and acceptance checks.

Words. "Difficulty" is the user-facing name of what code calls `level`. Internal names (`level`, `PracticeSettings.level`, `levels.json`, `scan` states, `RankedReason` values) do not change unless this document says so.

---

## 1. Decisions on the disagreements

The designer (03) and I (04) wrote our responses from the two ratings, so some points were argued twice. Every open point is closed here.

| # | Topic | Designer (03) | UX (04) | Decision | Why |
| --- | --- | --- | --- | --- | --- |
| 1 | Range on instrument cards | A short bar on a shared pitch ruler on every card, one large staff for the selected instrument | A small staff on every card | **Designer.** Ruler bar plus note names on cards; the staff once, large, for the selection | Cards in different clefs cannot be compared at a glance. A shared axis can. The staff is readable only at the large size. |
| 2 | Key control | Key-signature chips, select as fallback | Grid with drawn signatures, not a circle | **Grid of key chips with drawn signatures.** No circle of fifths, no "More keys" overflow, no select fallback | Both agree on drawn signatures. A grid wraps on a phone and works with arrow keys. The key name is the main label, so a beginner who cannot read signatures loses nothing (answers 03 question 1). |
| 3 | Mode names | Keep Ranked and Practice with a visible hint | Same (04 changed its mind) | **Ranked and Practice**, each with a visible one-line hint | Short, learnable, fits a phone. |
| 4 | Calibration visual | Ten 20 px marks, the current one pulses, no big circle | Large pulse circle above the dots | **Designer.** One mark per click, larger, the current mark pulses. No large circle | The owner likes calibration as it is. Counting is the feedback. A second visual competes with it. |
| 5 | Live mark size | Larger marks, settled by a 1 m legibility test | Feedback is clear | **Designer, with the test as the acceptance check** (section 16). Only the drawing changes; behaviour does not (section 15) | The owner plays at a music stand, not at screenshot distance. |
| 6 | Unavailable meters | Show them pale with a visible note | Leave them out with a visible note | **Leave them out**, with a visible note naming what is missing | A control you cannot press is the exact complaint ("doesn't seem to be working"). The row already grows with difficulty, so a changing shape is normal here. |
| 7 | Listening before a ranked take | "Listen first" makes it practice, ask once | Allowed, confirm every time, becomes practice | **Allowed. Confirm every time in ranked. The take becomes practice** with a new reason, `listened-first` | Answers the owner's request without letting a ranked player lose rank by accident. Answers 03 question 2. |
| 8 | "My take" audio playback | Yes, from the judged notes | Not in v1 | **Not in v1** | Ruling R9 defers listen-back. A synth replay of uncertain detections plays notes the player did not play. The marked score already shows the difference. The existing "My take / Clean score" view switch stays; it is visual only. |
| 9 | Listen timbre | One warm piano-like tone for every instrument | The instrument's synth voice | **Designer.** One soft piano-like tone, at sounding (concert) pitch | A synth trumpet or voice sounds wrong and invites "that's not my sound". A neutral tone carries pitch and rhythm, which is the point. |
| 10 | Reference button name | "Starting note" | "Hear starting pitch" | **"Hear starting pitch"** for voice; **"Hear the key"** for instruments | Starts with a verb like "Hear the tempo", so it reads as a button and not a label. Answers 03 question 4. |
| 11 | Difficulty band names | Optional ("Beginner", "Intermediate") | No | **No band names.** "Difficulty 2 of 10", a 10-step meter and the existing description | Rank names already form a ladder of words. A second ladder repeats the "level" collision the owner found. Answers 03 question 5. |
| 12 | Written / sounding toggle | Dropped in 03 | No toggle | **No toggle.** Written range on the staff, sounding range as one line of text | Agreed. |
| 13 | Metronome options | Metronome, Woodblock, Soft tick | Classic, Woodblock, Beep | **Classic, Woodblock, Beep** | A soft tick is the sound the owner rejected, and it is the hardest for the calibration detector. |
| 14 | Setup layout | Two columns on desktop, controls visible | Summary chips that open a sheet | **Both, by width.** At 1024 px and wider the controls are inline in two columns. Below 1024 px a summary card of chips opens the setup sheet | On a laptop a sheet costs a click per change for no gain. On a phone the inline form is what pushed Mode below the fold. Same controls, same order, same component in both. |
| 15 | Tips | Skip the screen when empty | Fold into results | **Fold into results** as "One thing to try" | One less screen in every loop. Nothing to show means nothing shown. |
| 16 | "Next excerpt" | Not discussed | "Next piece" | **Keep "Next excerpt"** | "Excerpt" is used across skip, seen-before and credits. Renaming one button makes two words for one thing. |
| 17 | Random difficulty | Not offered | "Mixed (1 to 2)" | **"Follow my progress"**, a switch | `level: 'random'` already means "use my current difficulty" (PLAN ruling 22). Named for what it does, it is useful: the setting moves up as the player does. |
| 18 | Instrumentalists and the key chord | Not discussed | Key chord only, allowed in ranked | **UX.** "Hear the key" for instruments, no first note, no effect on ranking | The key chord gives no notes away. The first note would remove part of the reading task for an instrumentalist. |
| 19 | Type and colour options | A: serif display, brass for "now" | No view | **Accept the designer's option A for both**, on two conditions: brass never carries meaning alone (always a shape or text too), and every brass mark meets 3:1 against its paper in both themes | Brand is the designer's call. The conditions are accessibility, which is mine. |
| 20 | Build order | Score frame first | Owner's points and setup first | **Owner's points and setup first** (section 17) | He reported setup and sound, and he will test those first. |

---

## 2. Principles for this round

1. Nothing looks dead. A control is either usable or absent, and when something is absent a visible line says why.
2. Nothing is explained only on hover. Every explanation is visible, or one tap or one focus away.
3. Nothing changes the take's status behind the player's back. Ranked or Practice, and why, is shown before Start. The one change made during reading (listening first) is the player's choice, confirmed, and shown at once.
4. One word per idea (section 12).
5. Sound is always one press away when it helps reading, and never plays during a take.

---

## 3. Structure

### 3.1 Tabs and routes

Routes are unchanged except where noted.

| Tab | Route | Holds |
| --- | --- | --- |
| Practice | `#/` | Setup, mode, Start, today's progress, notices |
| Progress | `#/progress` | Rank, XP, difficulty per instrument, personal bests |
| History | `#/history`, `#/history/:attemptId` | Past takes; detail shows the marked score and Listen |
| Settings (gear) | `#/settings` | Sound, display, practice, accessibility, data, about and credits |

- Onboarding (`#/welcome`) shows no tabs and no app bar links. It has the brand and Back only.
- The practice loop (`#/practice/scan`, `/play`, `/results`) shows no tabs. Its toolbar has "Home" at left.
- `#/practice/tips` is removed. A visit to it redirects to `#/practice/results` if a result is open, else to `#/`.
- Credits stay at `#/credits` and are linked from Settings > About. The "Credits" footer link on Home is removed.
- `#/calibrate` is reached from onboarding, the Practice notice, the mode control, and Settings > Sound. It is the same card everywhere.

### 3.2 Loop

```
Practice --Start--> Cover --Show the music--> Read-through --Start playing / auto at 0 (ranked)--> Count-in --> Take
                      | Skip (free)               | Skip (counts as seen)                                     |
                      v                           v                                                           v
                  new excerpt                 new excerpt                                                  Results
Results --Next excerpt--> Cover (new excerpt, same setup)
Results --Try again (practice)--> Read-through (same excerpt, practice)
Results --Change setup--> setup sheet over results --Done--> Cover (new excerpt, new setup)
Results --Home--> Practice
```

---

## 4. Flows

### 4.1 First launch

1. **Welcome.** Engraved phrase, headline, one sentence, "Get started". No name field (the name moves to Settings > Profile, optional).
2. **Choose your instrument.** Voice group first (six voices), then Woodwinds, Brass, Strings, Keyboard. Selecting a card shows the large range picture under the grid (section 7). "Continue" is enabled once a card is selected. "Show more instruments (less tested)" switch at the foot.
3. **Microphone.** As today. "Not now" carries the line "You can still practise, but takes won't be graded."
4. **Calibration.** As today (section 15 freezes the flow). Under "Skip": "Without calibration, takes on this device are practice only. You can calibrate later from Practice or Settings."
5. **Difficulty.** "Find my difficulty" (placement) or "I'll choose". "I'll choose" shows the difficulty control (section 5.3) with the range served at that difficulty for the chosen instrument. Default 2.
6. **Practice.** Tabs appear. On phones, a one-time hint under the summary card: "Tap any setting to change it." It is dismissed by any tap and never returns.

Step counter reads "Step {n} of 5" on steps 2 to 5. Welcome has no counter.

### 4.2 A ranked take, calibrated player

1. Practice: settings visible (desktop) or as chips (phone). Mode control shows "Ranked" selected with its hint. Press "Start".
2. Cover: clef, key signature and time signature engraved large; one summary line beneath; the ranked line "You'll have 30 seconds to read, then the count-in starts by itself. Want more time? Switch to Practice." with "Practice instead"; "Show the music" (Space); "Skip".
3. Read-through: score large; countdown with text ("0:24 left"); sounds group: Listen first, Hear the tempo, Hear starting pitch (voice) or Hear the key (instruments), Check my tuning (winds, brass, strings); "Before you play" checklist (optional); "Start playing".
4. First read-through only: a coach mark on the sounds group, "New: hear the tempo, the key and the music before you play." with "Got it". It never returns.
5. Voice only: at "Start playing" (or auto start), the starting pitch plays first, as today, with its live caption ("Key chord: D major", then "First note: D3").
6. Count-in in the centre of the screen, downbeat accented in sound and size.
7. Take with live feedback (unchanged behaviour).
8. Results: grade, score, marked score, Listen, "One thing to try" if any, XP and rank line. "Next excerpt" (primary), "Try again (practice)", "Change setup".

### 4.3 Listening first in a ranked take

1. On read-through the player presses "Listen first" (second line: "Makes this practice").
2. A confirm sheet opens: "Listen first?" with the body text, "Listen, make it practice" and "Keep it ranked" (default focus). The countdown keeps running.
3. "Keep it ranked" or Escape: sheet closes, nothing plays, nothing changes.
4. "Listen, make it practice": the take becomes practice at once. The mode chip in the toolbar changes from "Ranked · 0:18 to read" to "Practice" and the polite live region says "Now a practice take". The countdown continues as a practice timer (never auto-starts). Playback begins.
5. If the countdown reaches 0 while the confirm sheet is open, the sheet closes as "Keep it ranked" and the count-in starts, as any ranked take does at 0.
6. Results show the "Practice" badge with "You listened first, so this one is practice."

### 4.4 Second and third take

- "Next excerpt" keeps the setup and goes straight to the cover of a new excerpt.
- "Change setup" opens the setup sheet over results. "Done" closes it and goes to the cover of a new excerpt with the new setup. "Cancel" closes it and changes nothing.
- If results include a difficulty offer, it appears above the actions: "You're reading difficulty 2 well. Move up to difficulty 3?" with "Go to difficulty 3" and "Stay at difficulty 2".

### 4.5 Player not calibrated, or microphone off

1. Practice shows the mode control with Ranked unavailable and a visible reason under it: "Ranked needs a calibrated setup on this device." with "Calibrate now". Practice is selected.
2. "Calibrate now" opens `#/calibrate`. On success it returns to Practice with Ranked available and selected if the player had chosen Ranked before.
3. Microphone denied or off: the reason reads "Ranked needs the microphone." with "Turn on microphone", which runs the permission request (or shows the browser's denied card, section 8.13). Start begins a practice take without listening (`practise.notice` on the cover).

---

## 5. The setup model

### 5.1 Settings and their "Any" options

Every setting that can be random offers it as the first option inside its own control. There are no separate Random chips anywhere. `chip.random` is no longer shown.

| Setting | Control | Options | "Any" option | Default | Stored as |
| --- | --- | --- | --- | --- | --- |
| Instrument | Picker (section 6) | Launch instruments; less-tested ones when the setting is on | None | Onboarding choice | `instrumentId` |
| Difficulty | Stepper plus switch (5.3) | 1 to 10 with music for this instrument | Switch "Follow my progress" | Player's current difficulty, switch off | `level` number, or `'random'` when the switch is on |
| Key | Key grid (5.4) | Written keys allowed at the effective difficulty | "Any key", first chip | Any key | `writtenKey` |
| Time | Segmented (5.5) | Meters with enough music at this difficulty for this instrument | "Any", first segment | Any | `meter` |
| Tempo | Switch plus slider (5.6) | The difficulty's tempo range | Switch "Any tempo in range" | On | `bpm` |
| Length | Segmented or text (5.7) | Bar counts allowed at this difficulty | "Any", first segment, only when 2 or more lengths exist | Any | `bars` |
| Mode | Segmented (5.8) | Ranked, Practice | None | Ranked when available | `mode` |

Choosing a value turns Any off for that row. Choosing Any turns it on. Nothing else changes another row, except difficulty re-filtering (5.9).

Output (speakers, wired headphones, Bluetooth) leaves Practice and lives in Settings > Sound and on the calibration card, where it already is.

### 5.2 Layout

**At 1024 px and wider (inline).**

- Left column (about 40%): instrument card (icon, name, "Change instrument" button) and the large range picture (section 7). Under it the Today card (streak, takes, XP today, rank line).
- Right column: Difficulty, Key, Time, Tempo, Length, in that order, each with its label above the control and its hint below. Then Mode. Then the XP line ("Choosing Any: +24% XP", only when greater than 0). Then Start (full column width, 56 px tall).
- All rows share one left edge. Labels sit above controls, not beside them.

**Below 1024 px (summary and sheet).**

- Top: Today strip (one line plus the rank line).
- Summary card: instrument name with the small range bar, then chips in this order: Difficulty, Key, Time, Tempo, Length. Example: "Baritone voice", "Difficulty 2", "Any key", "Any time", "Any tempo", "8 bars".
- Mode control, full width, under the summary card.
- XP line.
- Start, sticky at the bottom above the tab bar. The scroll container gets bottom padding equal to the sticky bar's height plus 16 px, so no row is ever under it.
- Tapping any chip opens the setup sheet scrolled to that row with focus on its control. The sheet holds the same controls as the inline layout, in the same order, and a "Done" button. Changes apply as they are made; "Done" closes the sheet.
- Tapping the instrument row opens the instrument picker (section 6) as a full-height sheet.
- At 390 x 844, Mode and Start are visible without scrolling. This is an acceptance check.

### 5.3 Difficulty

- Label "Difficulty". Stepper with minus and plus (equal stroke weight), value written "2 of 10".
- Beside the stepper, a 10-segment meter. Segments up to the value are filled. Segments for difficulties with no music for this instrument are drawn hollow. The meter is decoration (`aria-hidden`); the stepper carries the value.
- Under it, the description from `levels.json` ("Adds eighths, minor keys and one-beat pickups").
- Under that, the served range line for the current instrument: "At difficulty 2: A2 to A3" (from the instrument's tier for this difficulty, section 7.2).
- Stepping skips difficulties with zero eligible music for this instrument. When any are skipped, a visible line names them: "No music yet for Baritone voice at difficulty 7 to 8."
- A difficulty with fewer than `tokens.ui.levelThinThreshold` (10) eligible excerpts is selectable and shows "Few pieces here: some may repeat."
- Switch above the stepper: "Follow my progress". When on, the stepper is hidden (not greyed) and the row reads "Difficulty 2 of 10 (follows your progress)" with the hint "Uses your current difficulty and moves up as you do." The description and served range lines stay.
- "Any" is not offered. Random difficulty adds no XP and is not counted in the XP line.

### 5.4 Key

- Label "Key". A grid of chips, a radio group.
- First chip: "Any key", with the hint beneath it "Any key up to 1 sharp or flat" and a tag "+8% XP" (value from `progression.xp.randomPerSetting`).
- Then the allowed written keys, in two labelled groups, "Major" then "Minor" (minor only at difficulties that allow it). Within a group, order by number of accidentals, sharp side before flat side: C, G, F, D, B♭, A, E♭, and so on. At difficulty 1: Any key, C, G, F. At difficulty 2: Any key; Major C, G, F; Minor A, E, D.
- Each chip shows the key name as its text ("G major") and a small staff with the key signature drawn in the music font beneath or beside it. The signature is decorative; the name is the label.
- Transposing instruments: a third line "concert F major" under each key chip. The "Any key" hint is about written keys.
- Keys are never disabled. Every allowed key can be served, because excerpts are transposed into the chosen key. Keys allowed only at a higher difficulty are absent, with the line "More keys from difficulty 3." under the grid.
- Grid columns: 4 on desktop (inline), 3 at 390 px. At high difficulty the grid is long; in the sheet it scrolls with the sheet. No overflow menu.
- Selected chip: filled selection style plus a check mark (not colour alone).
- This replaces the native select. The parallel bug fix may ship a working select first; it is replaced by this grid in the same release as the rest of this spec.

### 5.5 Time

- Label "Time". Segmented control, a radio group.
- First segment "Any", tag "+8% XP".
- Then each meter with at least `tokens.ui.meterChipMinExcerpts` (5) eligible excerpts for this instrument at the effective difficulty, in `levels.json` order, drawn as stacked numerals in the music font. The accessible name is spoken form ("3 4 time", from `setup.time.a11y`).
- A meter with 5 to 9 excerpts shows "few pieces" beneath it, still selectable. On selection the row hint reads "Few pieces here: some may repeat."
- Meters allowed at this difficulty but under 5 excerpts are left out. A visible line under the control names them: "No 3/4 or 2/4 music for Baritone voice at difficulty 2 yet."
- When "Any" is selected the selector draws only from the meters shown. This is a required selector change (today Any can serve a meter the screen said had no music). It changes selection, not grading.
- When the row wraps (difficulty 7 and up), it wraps to a second line; it does not scroll sideways.

### 5.6 Tempo

- Label "Tempo". Switch "Any tempo in range", on by default, tag "+8% XP".
- Switch on: the slider is hidden. The row reads "Any tempo from 60 to 84" (the difficulty's range; dotted range for compound meters as today).
- Switch off: beat unit and number ("♩ = 72"), a slider over the difficulty's range, a number field, and "Hear the tempo" (plays one bar at that tempo with the chosen click, section 9).
- Changing difficulty clamps a set tempo into the new range (as `normalize` does today).

### 5.7 Length

- One length allowed: plain text, "8 bars (the only length at difficulty 2)". No control.
- Two or more: segmented "Any", 8, 10, 12 (only allowed values). No XP tag (length is not counted).
- Length stays a preference; when the selector serves another length, the read-through shows "10 bars instead of 12" as today.

### 5.8 Mode

- Label "Mode". Segmented control: "Ranked", "Practice". Each segment has a visible hint line beneath the control for the selected option:
  - Ranked: "Full XP. Fresh music and timed reading."
  - Practice: "Less XP. No time limit. Listen first if you like."
- Ranked unavailable: the Ranked segment is not selectable and the hint area shows the reason and a fix, visible, not in a tooltip:
  - Not calibrated on this route: "Ranked needs a calibrated setup on this device." with "Calibrate now".
  - Microphone denied or off: "Ranked needs the microphone." with "Turn on microphone".
- The "not calibrated" check before Start uses the same predicate the take gate uses for `calibration-unmeasured`, run for the current route. Other gate failures (Bluetooth, recheck) are not predicted here; they keep their existing banners and results reasons.
- The Ranked segment, when unavailable, stays focusable and announces its reason (`aria-disabled="true"` plus `aria-describedby` on the reason).

### 5.9 Re-filtering when difficulty or instrument changes

Keep today's `normalize` rules, with these visible results:

- A chosen key, meter or length no longer allowed falls back to Any. When this happens, a polite announcement and a one-line note under that row for 6 seconds: "Key set to Any: E minor isn't used at difficulty 1."
- A chosen difficulty with no music for a new instrument moves to the nearest with music, with the note "Difficulty set to 3: no music yet for Baritone voice at difficulty 2."
- A set tempo is clamped into the new range silently (the number shows the new value).

### 5.10 XP line

- Each Any option carries its own "+8% XP" tag.
- The line above Start: "Choosing Any: +24% XP", the sum from `randomBonusPercent`. Hidden when 0.
- It never mentions difficulty or length.

### 5.11 Start

- Label "Start". Enabled when an excerpt can be served.
- While the music library loads: label "Loading music…", disabled, `aria-busy`.
- No excerpt fits: the empty-selector card replaces the XP line (section 8.6 states).

---

## 6. Instrument picker and voice types

### 6.1 Where it appears

- Onboarding step 2, as the page.
- Practice: "Change instrument" (desktop) or the instrument row (phone) opens it as a dialog (desktop, max 880 px wide) or a full-height sheet (phone).
- Settings > Practice "Show more instruments (less tested)" adds the less-tested cards.

### 6.2 Groups and order

| Group heading | Cards, in order |
| --- | --- |
| Voice | Soprano, Mezzo, Alto, Tenor, Baritone, Bass |
| Woodwinds | Flute, Clarinet in B♭, Alto saxophone; less tested: Oboe, Bassoon, Tenor saxophone, Baritone saxophone |
| Brass | Trumpet in B♭; less tested: Horn in F, Trombone, Euphonium (bass clef), Euphonium (treble clef), Tuba |
| Strings | Violin, Cello; less tested: Viola, Double bass, Guitar |
| Keyboard | Piano (right hand); less tested: Piano (left hand) |

- Voice cards show the voice alone ("Baritone"). Everywhere outside the picker the full name is used ("Baritone voice"), from `instrument.name.<id>`.
- Less-tested cards carry the "less tested" badge.
- Grid: Voice is 3 x 2 on every width. Other groups: 4 per row at 1024 px and up, 3 at 568 to 1023, 2 below 568. All cards in a row are the same height.

### 6.3 Card content

Top to bottom: line icon (from the designer's icon set; no letter abbreviations), name, range in text ("G2 to G4", full written range), the range ruler bar (section 7.3), and for transposing instruments one line "Sounds a major 2nd lower". Selected card: filled selection style and a check mark.

The picker is a radio group: arrow keys move between cards in reading order across groups, Space or Enter selects, and the selection is announced with the card's full accessible name: "Baritone voice, range G2 to G4".

### 6.4 Below the grid

The large range picture (section 7.4) for the selected card, at the player's current difficulty for that instrument (difficulty 2 during onboarding). It updates as the selection changes. Then "Continue" (onboarding) or "Done" (dialog). In the dialog, "Done" applies the change; Escape or "Cancel" discards it.

### 6.5 New voices: data

Baritone and mezzo-soprano need entries in `config/instruments.json`. Proposed values, for the music lead to confirm against the corpus gate (R24) before shipping:

| id | Label | Clef | semis | Full written range | A (diff 1 to 2) | B (3 to 4) | C (5 to 6) | D (7 to 8) | E (9 to 10) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `voice-mezzo` | Voice (mezzo-soprano) | treble | 0 | G3 to A5 (55 to 81) | C4 to C5 (60 to 72) | B3 to D5 (59 to 74) | A3 to F5 (57 to 77) | G3 to G5 (55 to 79) | G3 to A5 (55 to 81) |
| `voice-baritone` | Voice (baritone) | bass | 0 | G2 to G4 (43 to 67) | C3 to C4 (48 to 60) | A2 to D4 (45 to 62) | G2 to E4 (43 to 64) | G2 to F4 (43 to 65) | G2 to G4 (43 to 67) |

- Detection blocks: copy `voice-alto` for mezzo and `voice-bass` for baritone, with `minHz` and `maxHz` widened to cover the sounding range plus a whole tone. The audio lead confirms.
- Both are `family: "voice"`, `relativePitch: true`, `status: "launch"` if the gate passes at every difficulty 1 to 10, otherwise `"beta"` (shown as less tested).
- A voice with no music at some difficulty still shows; the difficulty control says so (5.3).
- Existing players keep their stored `voice-bass` choice. Nothing is migrated.
- The owner is a baritone. Baritone is a release blocker for this round; mezzo is not.

---

## 7. The range picture

One component, `RangePicture`, in three sizes. It answers "what notes will I see?"

### 7.1 Data

- **Full range:** `fullWrittenRange` of the instrument.
- **Served range:** the tier for the effective difficulty: difficulty 1 to 2 tier A, 3 to 4 B, 5 to 6 C, 7 to 8 D, 9 to 10 E (from `levels.json` `tier`, never hard-coded).
- **Concert range:** written minus `writtenMinusSounding.chromatic` semitones, for transposing instruments only (any instrument where `chromatic` is not 0).
- Note names in scientific pitch with real glyphs: "B♭3", "F♯5". Spelling: sharps for written notes on the sharp side of the instrument's default key, else the spelling `key-names.ts` gives the pitch class in C major (C, C♯, D, E♭, E, F, F♯, G, A♭, A, B♭, B).

### 7.2 What is shown at each size

| Size | Where | Content |
| --- | --- | --- |
| Bar (small) | Instrument cards; summary chip row on phones | A horizontal ruler bar on a shared pitch axis, C1 to C8, with faint ticks at every C. The full range drawn light, the served range drawn dark. No staff. Cards: note names of the full range in text beside or under it. Summary: no text, 64 px wide. |
| Picture (large) | Under the picker grid; left column of Practice on desktop; top of the setup sheet on phones | A staff in the instrument's first clef (the clef with `fromLevel` 1). Four whole notes: lowest and highest of the full range in light ink, lowest and highest of the served range in dark ink, with a soft dark band behind the staff between the served notes. Note names under each note. Lines of text beneath (7.5). |
| Line (text) | Difficulty control | "At difficulty 2: A2 to A3" |

### 7.3 Ruler bar rules

- Same axis on every card, so a glance compares instruments. Width of the axis is the card's content width.
- Full range: light fill. Served range at the player's current difficulty for that instrument: dark fill. On onboarding cards, difficulty 2.
- Accessible: the bar is `aria-hidden`; the card's text range carries the meaning.

### 7.4 Large picture rules

- Clef: the instrument's first clef. For treble-8vb (tenor voice, guitar) draw the treble clef with the 8 below.
- Ledger lines: up to 4 drawn plainly. A note that would need more:
  - If the instrument has a higher clef in its `clefs` list, draw a clef change before that note and draw it in the highest such clef (cello's A5 in treble clef).
  - Otherwise draw it with an "8va" bracket (above) or "8vb" (below) and keep the written name ("C7").
- When difficulty changes, the dark notes and band move to the new served range (200 ms; instant with reduced motion).
- Tapping or clicking a whole note plays it (sounding pitch, the Listen tone, 1 s). Each note is a button with the name "Hear {note}". This does not affect anything else.
- Size: about 320 px wide on desktop, full content width on phones, minimum staff space 8 px.

### 7.5 Text lines beneath the large picture

Shown in this order, each only when it applies:

1. "Full range: G2 to G4" (always).
2. "At difficulty 2: C3 to C4" (always).
3. Transposing instruments: "Sounds a major 2nd lower: concert E3 to B♭5" (full range in concert pitch). Octave transposers: "Sounds an octave lower: A2 to A4". More than an octave: "Sounds an octave and a major 2nd lower: concert A♭2 to E5".
4. Voices: "Sing in any octave that suits you. Pitch is marked relative to your starting note."

Accessible name of the whole picture (on a `figure` with `figcaption`): "Baritone voice range: G2 to G4. At difficulty 2: C3 to C4."

---

## 8. Screens

Each screen lists purpose, content, controls and states. "States" always covers loading, empty, error and permission denied; "n/a" means the state cannot occur there.

### 8.1 Welcome

- **Purpose:** promise and one action.
- **Content:** an engraved phrase of real music (static SVG, 4 bars, public domain), headline "Read it. Play it. See how it went.", body `welcome.body`.
- **Controls:** "Get started" (primary, focus on load).
- **States:** loading n/a (static); error n/a; permission n/a.

### 8.2 Choose your instrument

- **Purpose:** pick what you read, and see its range.
- **Content and controls:** section 6. Title "Choose your instrument". Body "We choose music in your range. Pick the card that fits you best."
- **States:** empty n/a (config is bundled). If the eligible-count index has not loaded, cards render without served-range shading and the large picture shows the full range only; shading appears when it loads. No spinner.

### 8.3 Microphone

- **Purpose:** explain before the browser asks.
- **Content:** as today, plus under "Not now": "You can still practise, but takes won't be graded."
- **Controls:** "Allow microphone" (primary), "Not now".
- **States:** granted: "Microphone is on." then step 4 after 600 ms. Denied: the denied card for this browser (`permission.denied.*`) with "Try again" and "Continue without the microphone". No device: `permission.noDevice` with the same two actions. Busy: `permission.busy`. Insecure: `permission.insecure`, "Continue without the microphone" only.

### 8.4 Calibration

- **Purpose:** measure delay so timing is fair. The flow is frozen (section 15).
- **Content:** `calibrate.intro`; Input device and Output selects; one mark per click (10 for timing the clicks, 8 for play-along, as configured); progress text "4 of 10 heard"; the result in plain words (`calibrate.loopback.success`).
- **Changes in this round:**
  - Marks are larger (designer sets size, minimum 16 px). The current mark pulses with each click. Heard: filled. Missed: hollow with a diagonal stroke. Pending: hollow. The text count stays.
  - "Hear the click" button on the card plays one bar of the chosen metronome sound (section 11).
  - In onboarding the calibration content is the step's card. No card inside a card. On `#/calibrate` the page title is "Calibrate" and the card has no second "Calibrate" heading.
  - Under "Skip": `calibrate.skipHint`.
  - `calibrate.audibility.hint` names the new sounds.
- **States:** as today: listening, success, fail (loopback, play-along, error), estimate, warnings (Bluetooth, AirPods, filtering). Permission denied: the denied card with "Try again" and "Skip". Unchanged.

### 8.5 Difficulty (onboarding)

- **Purpose:** choose how hard to start.
- **Content:** title "Choose a starting difficulty". Two choices: "Find my difficulty (3 short excerpts, about 3 minutes)" (primary) and "I'll choose".
- **"I'll choose":** the difficulty control (5.3) without the "Follow my progress" switch, plus the large range picture for the chosen instrument, which updates with the stepper. "Continue".
- **States:** placement needs the microphone; if it is off, the placement option is shown with the line "Needs the microphone." and is not selectable; "I'll choose" is preselected.

### 8.6 Practice (home and setup)

- **Purpose:** see and change the setup, know whether the take will count, start.
- **Content and controls:** section 5. Notices above the setup, one at a time, in this priority: storage loss, microphone off, calibration missing or stale, Bluetooth, difficulty offer.
- **Today:** "Streak 6 days · 9 takes · 214 XP today" and the rank line. Lines never break inside a phrase: each "·"-separated part is a non-breaking unit and the line wraps between parts.
- **Rank line:** "Student · 79% to Section player". The difficulty gate ("Reach difficulty 3 on any instrument to unlock") shows only when it is not yet met.
- **States:**
  - Loading (music library): setup controls render from config; counts-dependent parts (few-pieces notes, hidden meters, hollow segments) show once loaded; Start reads "Loading music…" and is disabled.
  - Empty (no excerpt fits): a card "No excerpt fits these settings" with up to two one-tap fixes from `localSuggestions` ("Set time to Any", "Go to difficulty 3") and, where the session reports only seen music, "Practise a seen excerpt".
  - Error (library failed): `error.corpus` card with "Try again". Setup stays visible.
  - Permission denied: Ranked unavailable with reason (5.8); notice with the browser's steps.

### 8.7 Cover

- **Purpose:** a breath before reading; what you are about to read.
- **Content:** the clef, key signature and time signature engraved at about three times staff size; beneath, one summary line ("Difficulty 2 · C major · 4/4 · ♩ = 71 · 8 bars"), printed once; `scan.cover`; ranked line `scan.ranked.notice` with "Practice instead"; practice without listening: `practise.notice`.
- **Controls:** "Show the music" (primary, Space), "Skip" (free, with the hint "Skip is free before you see the music."), "Practice instead" (ranked only).
- **States:** loading the excerpt: the cover shows its frame with "Getting the music…" and the primary disabled. Error: `error.corpus` with "Try again" and "Back to Practice".

### 8.8 Read-through

- **Purpose:** read the music, check the key and tempo by ear, start when ready.
- **Toolbar (all sizes):** "Home"; summary line; mode chip ("Ranked · 0:24 to read" or "Practice"); countdown (ring plus text "0:24 left"); overflow (About this music, Skip this excerpt); "Start playing" (primary).
- **Sounds group, desktop:** right column, directly under "Start playing", above the checklist. Stacked buttons, each with a visible caption and an info button (i) where listed:

| Button | Who | Caption (always visible) | Info (i) |
| --- | --- | --- | --- |
| Listen first | Everyone | Ranked: "Makes this practice". Practice: "Hear how it goes before you play." | No |
| Hear the tempo | Everyone | "One bar of clicks at ♩ = 72." | No |
| Hear starting pitch | Voice | "Plays the key chord, then your first note." | Yes, `reference.info.voice` |
| Hear the key | Instruments | "Plays the key chord, so you hear the key." | Yes, `reference.info.instrument` |
| Check my tuning | Winds, brass, strings | "Hold any note for 3 seconds. We'll allow for your tuning." | No |

- **Sounds group, below 1024 px:** a dock above "Start playing" at the bottom of the screen with three buttons using short labels: "Listen first", "Tempo", "Starting pitch" (voice) or "Key" (instruments). Each button's accessible name is the full label. "Listen first" in ranked carries the second line "Makes this practice" inside the button. At the end of the dock row, an info button "What do these do?" opens a sheet with every caption and the reference explanation (section 10). "Check my tuning" sits at the top of the "Before you play" sheet.
- **Live sound caption:** while any sound plays, one line above the sounds group (desktop) or above the dock (phone) shows what is sounding, and the matching part of the score is highlighted:
  - Starting pitch: "Key chord: D major" (key signature highlighted), then "First note: D3" (first notehead highlighted).
  - Key: "Key chord: D major".
  - Tempo: "Tempo: ♩ = 72".
  - Listen: "Playing bar 3 of 8" (the bar highlight follows).
- **Checklist:** heading "Before you play", small label "STARS", line "Optional. Tick as you check." The five items as today. On phones: a sheet with the peek label "Before you play: 0 of 5".
- **States:**
  - Loading n/a (the cover loads the excerpt).
  - Audio failed to start for a sound: the live caption reads "That sound didn't play. Check your volume and try again." for 6 seconds. Nothing else changes.
  - Tuning not heard: "We couldn't hear a steady note. Hold one note and try again."
  - Permission denied: "Check my tuning" is absent; the sounds that only play still work.

### 8.9 Count-in

- **Purpose:** the beat, in the centre, before playing.
- **Content:** a large beat number in the centre of the screen on each click (1 2 3 4), the downbeat larger; "Bar 1 · ♩ = 72" beneath; the score dimmed slightly behind.
- **Voice:** before the count-in, the starting pitch plays automatically (unchanged, R7) and the centre shows "Your starting pitch" with the live caption ("Key chord: D major", "First note: D3"). No replay button here.
- **Controls:** "Stop" (with the word, at every size), Escape.
- **States:** first click missing: "Restarting the count-in" as today. Rotation: restart as today.

### 8.10 Take

- **Purpose:** play; see slips as they happen.
- **Behaviour:** unchanged (section 15). Drawing per the design spec: marks on or beside the notehead at notehead size, one soft bar highlight, real margins.
- **Status strip:** "Bar 5 of 8", input meter labelled "Mic", "Stop" with the word. Minimum 16 px text.
- **No sound controls.** Nothing plays during a take except the metronome.
- **States:** no signal ("We can't hear you. Move closer to the mic?"), lost place, come in at bar n: as today.

### 8.11 Results

- **Purpose:** how it went, what to work on, how it should sound.
- **Order (all sizes):** header (grade, score, stars, badge and reason), the marked score with its toolbar, "One thing to try", components, counts, XP and rank line, actions. On phones the score comes before the components.
- **Header states:**

| State | Badge | Reason line | Score area |
| --- | --- | --- | --- |
| Ranked, graded | Ranked | none | Marked score |
| Practice by choice | Practice | none (the badge says it) | Marked score |
| Practice for a reason | Practice | The reason, from `ranked.reason.*` | Marked score |
| Not calibrated | Practice | `ranked.reason.calibration` plus "Calibrate now" | Marked score; timing note `badge.timingOffset` |
| Void | Not graded | The void reason (`void.*`) | **Clean score in ink, no marks**, actions "Check microphone" and "Try again" |
| Incomplete | Incomplete | `badge.incomplete.tooltip` as visible text | Marked score |

- **Score toolbar:** "My take / Clean score" switch (visual), "Previous slip", "Next slip", "Listen" (section 9), "Slower" switch (75%).
- **One thing to try:** heading "One thing to try", the primary tip text, its evidence line ("Seen in bars 3 and 5."), and "Hear bar 3" when the tip names bars (plays that bar twice). If more tips exist: "2 more tips" expands them in place. Nothing at all when there are no tips. The setting "Show a tip after each take" hides this section.
- **Components:** Notes, In tune, Rhythm as bars with numbers. The weakest is named in a sentence, "Rhythm is the one to work on." The word "focus" is removed.
- **Drift:** "You sped up slightly by the end" or "You slowed down slightly by the end". Milliseconds only when "Show cents and milliseconds in review" is on: "(24 ms)".
- **XP:** "+12 XP" for ranked; practice: "+3 XP (practice earns 25% of the XP)".
- **Actions:** "Next excerpt" (primary), "Try again (practice)", "Change setup", and the difficulty offer when present (4.4).
- **States:** scoring: "Scoring…" with the score visible and unmarked. Error saving the take: banner "This take couldn't be saved on this device." with "Try again"; results stay on screen.

### 8.12 Progress, History, attempt detail

- Replace "level" with "difficulty" in every string (section 13).
- Rank gate line shows only when unmet.
- Per-instrument card: the boxes get a visible label, "Recent ranked takes at this difficulty", and empty boxes read "Not yet played" to screen readers.
- History rows: "Baritone voice · Difficulty 2 · C major · 4/4 · ♩ = 71". The meter is always the meter served, never "random".
- Attempt detail: shows the marked score (same component as results, read-only), Listen and Slower. Title is plain text, not a link.
- States: loading "Loading takes…"; empty `empty.history.*` and `empty.progress.*`; filtered empty `empty.historyFiltered.*`; error `history.error`; not found `history.notFound` with "Back to history".

### 8.13 Errors and permission (full screens)

- Every error that stops the loop is a full screen with a heading, the cause in one or two sentences, and two actions: "Try again" and "Back to Practice". No "reload the page" next to a Retry button.
- Clock rate: heading "Audio timing problem", body `error.clockRate`. "Try again" re-runs the audio check; if it passes, return to where the player was.
- Microphone denied (from Start or Calibrate): heading `permission.denied.title`, the browser's steps, "Try again" and "Practise without listening".
- Not found: "Page not found", "There's nothing at this address.", "Go to Practice".

### 8.14 Settings

- Sections: Profile, Sound, Display, Practice, Accessibility, Data, About.
- **Profile:** "Your name" (optional), full-height input matching other controls.
- **Sound:** Input device; Output; calibration status with "Calibrate" or "Recalibrate"; Metronome sound (section 11); Accent the first beat; Click volume; Click during the take (On / Count-in only); Tuning pitch.
- **Practice:** "Show the Before you play checklist", "Show a tip after each take", "Show more instruments (less tested)", "Run placement again".
- **About:** app, music library, privacy line, "Credits". The build string moves into a "Technical details" disclosure.
- States: as today.

---

## 9. "Hear it": playback rules

### 9.1 What plays, where, and what it costs

| Where | Control | What it plays | Effect on the take |
| --- | --- | --- | --- |
| Range picture | Tap a whole note | That note, 1 s | None |
| Practice, tempo row | Hear the tempo | One bar of clicks at the set tempo, chosen sound, downbeat accented if on | None |
| Read-through | Hear the tempo | One bar of clicks at the excerpt's tempo | None, any mode |
| Read-through, voice | Hear starting pitch | Key chord (root, third, fifth), then the first note: `voiceReferenceTones` as today | None, any mode |
| Read-through, instruments | Hear the key | Key chord only (root, third, fifth), concert pitch, in the octave whose root is at or below the first note's sounding pitch | None, any mode |
| Read-through | Listen first | One bar of clicks, then the excerpt | Practice: none. Ranked: confirm, then the take becomes practice (`listened-first`) |
| Count-in, voice | Automatic | Starting pitch, as today (R7) | None |
| Take | Nothing | No playback during a take; the microphone would hear it | |
| Results | Listen | The excerpt at the take's tempo | None |
| Results | Hear bar n | That bar, twice, with one bar of clicks first | None |
| Attempt detail | Listen | As results | None |
| Settings, calibration | Play a sound / Hear the click | One bar of that metronome sound | None |

The key chord and starting pitch never change the take's status. They give no melody, and a given key chord and starting note is how sight-singing is examined.

### 9.2 Listen: the sound

- One timbre for all instruments: a soft piano-like tone. Additive synth: fundamental, 2nd harmonic at −8 dB, 3rd at −16 dB; 5 ms attack; exponential decay to −24 dB over the note or 2 s, whichever is shorter; 60 ms release.
- Sounding (concert) pitch, tuned to the player's tuning pitch (`a4Hz`). Tenor voice and guitar sound an octave below written; transposing instruments sound at concert pitch.
- Durations: written value at the tempo, each note ending 10% early for articulation. Tied notes are one note. Rests are silent. Pickups start on their beat.
- Lead-in: one bar of metronome clicks (chosen sound), then the music without clicks. Switch "Click along" (results and attempt detail only) keeps clicks through the music.
- Peak level about −12 dBFS, independent of click volume.

### 9.3 Listen: behaviour

- The button reads "Listen" (results, history) or "Listen first" (read-through). While playing it reads "Stop" and pressing it stops at once.
- Tempo: read-through uses the excerpt's tempo (the served tempo when tempo is Any). Results and history use the take's tempo. "Slower" plays at 75% of that tempo.
- Results and history: tapping a bar in the score while Listen is idle sets the start bar (the bar highlight moves there); Listen then starts from it. Default start is bar 1.
- The bar highlight follows the music (the same highlight used during the take). On phones, the system being played scrolls into view unless the player scrolled in the last 3 seconds. Reduced motion: jump, no smooth scroll.
- One sound at a time. Starting any sound stops the one playing.
- "Start playing" (or the ranked auto start at 0) stops any sound at once, then the count-in begins (after the voice reference, as today).
- Leaving the screen stops playback.
- The first press of any sound control unlocks audio (it is a user gesture).
- Keyboard: L plays or stops Listen on read-through (in ranked it opens the confirm) and on results.

### 9.4 Ranked confirm

As 4.3. Text in section 13 (`listen.confirm.*`). No "Don't ask again". The confirm is a sheet on phones and a dialog on desktop; focus goes to "Keep it ranked"; Escape is "Keep it ranked". Record `RankedReason` `listened-first` on the attempt. The ranked countdown does not pause.

### 9.5 "Hear the tempo" wiring

The button exists in code but nothing sets `hearTempo`. It must be wired to play one bar of the chosen metronome sound at the excerpt's tempo, accented downbeat if on.

---

## 10. The reference, explained

The owner asked: "Explain the reference for me. Maybe the reference is the key." The answer the screen gives itself: the reference is the key of the piece, heard as its home chord, followed (for singers) by the first note.

- **Voice button:** "Hear starting pitch". Caption, always visible: "Plays the key chord, then your first note."
- **Voice info (i), opens on tap, click, Enter or Space; not on hover alone):**
  > This is your reference. It's the key of the piece: you hear its home chord, then the first note you'll sing. Find your pitch from there. We mark your pitch relative to this start, in any octave that suits your voice. It also plays by itself just before the count-in.
- **Instrument button:** "Hear the key". Caption: "Plays the key chord, so you hear the key."
- **Instrument info (i):**
  > The key chord is the home chord of this piece, at concert pitch. It gives away no notes, so you can use it in ranked takes too.
- **While it plays:** live caption and highlight as in 8.8.
- **Tuning is separate:** "Check my tuning" listens; it does not play. Caption: "Hold any note for 3 seconds. We'll allow for your tuning." (seconds from `grading.tuning.captureSec`). Result as today: "You're 8 cents flat. We'll allow for that."
- **A4:** "A4 reference" in Settings becomes "Tuning pitch", so "reference" means one thing only.
- The info button also has a native `title` with the caption, for mouse users. The `title` is never the only route.

---

## 11. Metronome sound

### 11.1 Options

| Option (stored id) | Label | Hint | Sound target |
| --- | --- | --- | --- |
| `classic` (default) | Classic | "A mechanical metronome: a firm, woody click." | Short pitched click with low body. A band-passed noise transient centred near 2.5 kHz (1 ms attack, 25 ms decay) over a 1.2 kHz sine decaying in 15 ms and a 350 Hz body at −12 dB decaying in 20 ms. Downbeat: tonal parts a perfect fourth higher, +3 dB. |
| `woodblock` | Woodblock | "Rounder and softer." | Two-mode resonator: 800 Hz with a partial at 2.4x (−10 dB), 60 ms decay. Downbeat at 1070 Hz. |
| `beep` | Beep | "A short electronic beep. Cuts through in a loud room." | Sine 1 kHz, 40 ms, 3 ms ramps. Downbeat 1.5 kHz. |

- Every sound is 60 ms or shorter, so clicks never overlap at the fastest tempo.
- **Ship gate:** each option must pass the existing calibration detector at the configured gates (clicks found and spread within `measurement-budget.json`) in the synthetic loopback e2e test and on two real devices (one laptop with built-in speakers, one phone). The low-band click template for each sound is regenerated. An option that fails does not ship; the others do. The sound designer may tune the targets above within this gate.
- **Migration:** stored `tick` becomes `classic`; `wood` becomes `woodblock`. `ClickTimbre` becomes `'classic' | 'woodblock' | 'beep'`.

### 11.2 Controls

- Settings > Sound > "Metronome sound": a radio group of the three options, each with its hint and a play button ("Play a bar of Classic") that plays one bar at ♩ = 90 with the downbeat accented if on.
- "Accent the first beat": switch, on by default. Off: every beat uses the offbeat sound. Stored as a new setting; default on for existing players.
- "Click volume": slider, as today.
- "Click during the take": On / Count-in only (was "Metronome: Audible / Count-in only").
- Calibration uses the chosen sound. The calibration card has "Hear the click".
- Count-in and take beat dots: the downbeat dot is larger, so eye and ear agree.

---

## 12. Vocabulary

Internal names stay. This is what the player sees.

| Old | New | Notes |
| --- | --- | --- |
| Level (music difficulty) | Difficulty | "Difficulty 2 of 10" where space allows, "Difficulty 2" in chips and lines |
| Starting level | Starting difficulty | Onboarding |
| Find my level | Find my difficulty | Placement |
| needs level 2 | Reach difficulty 2 to unlock | Shown only when unmet |
| Go to level 3 / Stay at 2 | Go to difficulty 3 / Stay at difficulty 2 | Offer |
| New best at level 2 | New best at difficulty 2 | Results |
| Rank | Rank | Unchanged; XP progress only |
| Voice (soprano) and so on | Soprano, Mezzo, Alto, Tenor, Baritone, Bass (picker); Soprano voice, Mezzo-soprano voice, … (elsewhere) | |
| Random (chip) | Any key / Any / Any tempo in range / Any (length) | Inside each control |
| Random level | Follow my progress | Switch |
| Random key, meter and tempo: +24% XP | Choosing Any: +24% XP | |
| Scan | Read-through (stage); reading time | "Scan" never appears in the UI |
| Start scan | Show the music | Cover button |
| Scan · 0 of 5 | Before you play: 0 of 5 | Phone sheet peek |
| STARS | Before you play (STARS as a small label) | |
| Hear the reference | Hear starting pitch (voice) / Hear the key (instruments) | With caption and info |
| Tuning note | Check my tuning | With caption |
| (none) | Listen / Listen first | Read-through, results, history |
| Ranked / Practice | Ranked / Practice | With visible hints |
| Practice / Practice mode. | Practice | Badge once; no reason line for a chosen mode |
| focus | (removed) | "{Component} is the one to work on." |
| Timing may be offset | Not calibrated: timing marks may be a little off | |
| Drifted 24 ms ahead | You sped up slightly by the end | ms only with the setting |
| +5 XP (practice, 25%) | +5 XP (practice earns 25% of the XP) | |
| Tick / Wood | Classic / Woodblock / Beep | |
| Click sound | Metronome sound | |
| Metronome: Audible / Count-in only | Click during the take: On / Count-in only | |
| Metronome volume | Click volume | |
| A4 reference | Tuning pitch | |
| Show beta instruments / beta | Show more instruments (less tested) / less tested | |
| Not much music here yet | Few pieces here: some may repeat | |
| More music coming | No music yet for {instrument} at difficulty {n} | |
| Show tips between exercises | Show a tip after each take | |
| Audio | Sound | Settings section |
| Audio setup problem. Please reload the page. | Audio timing problem (heading) plus cause and two actions | |

---

## 13. Copy

All strings go in `src/ui/copy/en.json`. Placeholders and plurals follow the existing formatter (`{name}`, `{n, plural, one {...} other {...}}`). Numbers owned by config are passed in, never typed into copy. When a string tested in `copy.test.ts` changes, update the test in the same change.

### 13.1 Changed keys

| Key | New text |
| --- | --- |
| `action.startScan` | Show the music |
| `action.hearReference` | Hear starting pitch |
| `action.tuningNote` | Check my tuning |
| `action.stayAt` | Stay at difficulty {level} |
| `action.goToLevel` | Go to difficulty {level} |
| `onboarding.level.placement` | Find my difficulty ({count} short excerpts, about {minutes} minutes) |
| `onboarding.level.title` | Choose a starting difficulty |
| `onboarding.level.stepper` | Starting difficulty |
| `onboarding.instrument.body` | We choose music in your range. Pick the card that fits you best. |
| `scan.practice.timeUp` | Reading time's up. Start when ready. |
| `scan.chip.ranked` | Ranked · {time} to read |
| `scan.summary` | Difficulty {level} · {key} · {meter} · {tempo} · {bars} bars |
| `scan.peek` | Before you play: {n} of {total} |
| `grade.D` | Rough one. Stay at this difficulty for now. |
| `grade.F` | This one was a stretch. Try an easier difficulty? |
| `ranked.reason.practice-mode` | You chose Practice. |
| `ranked.reason.scan-extended` | The reading time ran past this difficulty's limit. |
| `ranked.reason.tempo-below-90pct` | The tempo was below this difficulty's range. |
| `badge.timingOffset` | Not calibrated: timing marks may be a little off |
| `results.personalBest` | New best at difficulty {level} |
| `results.drift.behind` | You slowed down slightly by the end |
| `results.drift.ahead` | You sped up slightly by the end |
| `component.focus` | {component} is the one to work on. |
| `xp.factor.levelBase` | Difficulty {level} base {value} |
| `xp.factor.randomKey` | Any key ×{value} |
| `xp.factor.randomMeter` | Any time signature ×{value} |
| `xp.factor.randomTempo` | Any tempo ×{value} |
| `xp.factor.belowLevel` | Below your difficulty ×{value} |
| `xp.practice` | +{xp} XP (practice earns {percent}% of the XP) |
| `xp.randomHint` | Choosing Any: +{percent}% XP |
| `results.xp.factor.random` | Any settings ×{value} |
| `rank.bar` | {rank} · Rank {n} of {total} · {xp} of {next} XP to {nextRank} |
| `rank.bar.needsLevel` | Reach difficulty {level} on any instrument to unlock |
| `rankup.next` | Next: {rank}, at {xp} XP and difficulty {level} on any instrument. |
| `level.offer` | You're reading difficulty {level} well. Move up to difficulty {next}? |
| `level.autoUp` | Moved up to difficulty {level}: {n} takes in a row at {score} or more. |
| `level.down` | Difficulty {level} has been a stretch lately. A few takes at difficulty {lower} can build the reading back up. |
| `home.levelNoMusic` | No music yet for {instrument} at difficulty {levels}. |
| `home.levelFewMusic` | Few pieces here: some may repeat. |
| `home.keyFootnote` | More keys from difficulty {n}. |
| `home.selector.noUnseen` | Difficulty {level} has no unseen music in {meter} for {instrument} yet. |
| `home.selector.setTimeRandom` | Set time to Any |
| `row.level` | Difficulty |
| `progress.instrumentLevel` | Difficulty {level} |
| `progress.ladder.future` | {xp} XP, difficulty {level} |
| `progress.best` | Best at difficulty {level}: {score} |
| `progress.window.label` | Recent ranked takes at this difficulty |
| `empty.progress.body` | Play an excerpt and your score, difficulty and rank show up here. |
| `settings.placement.hint` | Plays three short excerpts to find your difficulty again. |
| `settings.section.audio` | Sound |
| `settings.audio.clickSound` | Metronome sound |
| `settings.audio.metronomeVolume` | Click volume |
| `settings.audio.metronome` | Click during the take |
| `settings.audio.metronome.audible` | On |
| `settings.audio.metronome.countInOnly` | Count-in only |
| `settings.audio.a4` | Tuning pitch |
| `settings.practice.stars` | Show the Before you play checklist |
| `settings.practice.tips` | Show a tip after each take |
| `settings.practice.beta` | Show more instruments (less tested) |
| `tips.showBetween` | Show a tip after each take |
| `badge.beta` | less tested |
| `calibrate.audibility.hint` | Try the Woodblock or Beep sound, or wired headphones. |
| `calibrate.audibility.link` | Open metronome sound settings |
| `error.clockRate` | Your device's audio clock is running at the wrong speed, so timing can't be measured. Close other apps that play sound, then try again. |
| `shortcuts.space` | Show the music, then Start playing |
| `shortcuts.n` | Next excerpt |

### 13.2 New keys

**Instrument names**

| Key | Text |
| --- | --- |
| `instrument.name.voice-soprano` | Soprano voice |
| `instrument.name.voice-mezzo` | Mezzo-soprano voice |
| `instrument.name.voice-alto` | Alto voice |
| `instrument.name.voice-tenor` | Tenor voice |
| `instrument.name.voice-baritone` | Baritone voice |
| `instrument.name.voice-bass` | Bass voice |
| `instrument.short.voice-soprano` | Soprano |
| `instrument.short.voice-mezzo` | Mezzo |
| `instrument.short.voice-alto` | Alto |
| `instrument.short.voice-tenor` | Tenor |
| `instrument.short.voice-baritone` | Baritone |
| `instrument.short.voice-bass` | Bass |
| `instrument.abbr.voice-mezzo` | Mz |
| `instrument.abbr.voice-baritone` | Bar |

Non-voice instruments keep their config labels. `instrument.abbr.*` keys stay for the catalogue test but are no longer displayed.

**Range picture**

| Key | Text |
| --- | --- |
| `range.full` | Full range: {low} to {high} |
| `range.atDifficulty` | At difficulty {level}: {low} to {high} |
| `range.cardText` | {low} to {high} |
| `range.sounds` | Sounds a {interval} lower: concert {low} to {high} |
| `range.soundsOctave` | Sounds an octave lower: {low} to {high} |
| `range.soundsCompound` | Sounds an octave and a {interval} lower: concert {low} to {high} |
| `range.voiceNote` | Sing in any octave that suits you. Pitch is marked relative to your starting note. |
| `range.a11y` | {instrument} range: {low} to {high}. At difficulty {level}: {servedLow} to {servedHigh}. |
| `range.hearNote` | Hear {note} |
| `instrument.card.a11y` | {instrument}, range {low} to {high} |

**Setup**

| Key | Text |
| --- | --- |
| `setup.title` | Practice |
| `setup.changeInstrument` | Change instrument |
| `setup.done` | Done |
| `setup.firstTimeHint` | Tap any setting to change it. |
| `setup.chip.a11y` | {row}: {value}. Change |
| `setup.difficulty.value` | {level} of {max} |
| `setup.difficulty.chip` | Difficulty {level} |
| `setup.difficulty.follow` | Follow my progress |
| `setup.difficulty.followValue` | Difficulty {level} of {max} (follows your progress) |
| `setup.difficulty.followHint` | Uses your current difficulty and moves up as you do. |
| `setup.key.any` | Any key |
| `setup.key.major` | Major |
| `setup.key.minor` | Minor |
| `setup.key.concert` | concert {key} |
| `setup.key.a11y` | {key}, {accidentals} |
| `setup.key.a11yConcert` | {key}, {accidentals}, sounds {concert} |
| `accidentals.none` | no sharps or flats |
| `setup.time.any` | Any |
| `setup.time.anyChip` | Any time |
| `setup.time.a11y` | {beats} {unit} time |
| `setup.time.few` | few pieces |
| `setup.time.unavailable` | No {meters} music for {instrument} at difficulty {level} yet. |
| `setup.tempo.any` | Any tempo in range |
| `setup.tempo.anyChip` | Any tempo |
| `setup.tempo.anyValue` | Any tempo from {min} to {max} |
| `setup.length.any` | Any |
| `setup.length.only` | {bars} bars (the only length at difficulty {level}) |
| `setup.length.chip` | {bars} bars |
| `setup.xpTag` | +{percent}% XP |
| `setup.fallback.key` | Key set to Any: {key} isn't used at difficulty {level}. |
| `setup.fallback.time` | Time set to Any: {meter} isn't available at difficulty {level}. |
| `setup.fallback.length` | Length set to Any: {bars} bars isn't used at difficulty {level}. |
| `setup.fallback.difficulty` | Difficulty set to {level}: no music yet for {instrument} at difficulty {from}. |
| `setup.mode.ranked.hint` | Full XP. Fresh music and timed reading. |
| `setup.mode.practice.hint` | Less XP. No time limit. Listen first if you like. |
| `setup.mode.blocked.calibration` | Ranked needs a calibrated setup on this device. |
| `setup.mode.blocked.mic` | Ranked needs the microphone. |
| `action.calibrateNow` | Calibrate now |
| `action.turnOnMic` | Turn on microphone |
| `home.loadingMusic` | Loading music… |
| `home.rankLine` | {rank} · {percent}% to {nextRank} |

**Onboarding and calibration**

| Key | Text |
| --- | --- |
| `onboarding.mic.notNowHint` | You can still practise, but takes won't be graded. |
| `onboarding.mic.continueWithout` | Continue without the microphone |
| `onboarding.level.needsMic` | Needs the microphone. |
| `calibrate.skipHint` | Without calibration, takes on this device are practice only. You can calibrate later from Practice or Settings. |
| `action.hearClick` | Hear the click |

**Cover and read-through**

| Key | Text |
| --- | --- |
| `scan.cover.loading` | Getting the music… |
| `scan.skipFreeHint` | Skip is free before you see the music. |
| `scan.timeLeft` | {time} left |
| `stars.heading` | Before you play |
| `stars.optional` | Optional. Tick as you check. |
| `scan.coach` | New: hear the tempo, the key and the music before you play. |
| `scan.sounds.whatAreThese` | What do these do? |
| `scan.sounds.title` | Sounds |
| `action.hearTempo.short` | Tempo |
| `action.hearReference.short` | Starting pitch |
| `action.hearKey` | Hear the key |
| `action.hearKey.short` | Key |
| `hearTempo.caption` | One bar of clicks at {tempo}. |
| `reference.caption.voice` | Plays the key chord, then your first note. |
| `reference.caption.instrument` | Plays the key chord, so you hear the key. |
| `reference.info.voice` | This is your reference. It's the key of the piece: you hear its home chord, then the first note you'll sing. Find your pitch from there. We mark your pitch relative to this start, in any octave that suits your voice. It also plays by itself just before the count-in. |
| `reference.info.instrument` | The key chord is the home chord of this piece, at concert pitch. It gives away no notes, so you can use it in ranked takes too. |
| `reference.info.button` | About {control} |
| `reference.playing.chord` | Key chord: {key} |
| `reference.playing.first` | First note: {note} |
| `tuning.caption` | Hold any note for {seconds} seconds. We'll allow for your tuning. |
| `tuning.listening` | Listening… hold your note. |
| `tuning.fail` | We couldn't hear a steady note. Hold one note and try again. |
| `sound.failed` | That sound didn't play. Check your volume and try again. |
| `sound.playing.tempo` | Tempo: {tempo} |

**Listen**

| Key | Text |
| --- | --- |
| `action.listen` | Listen |
| `action.listenFirst` | Listen first |
| `listen.rankedLine` | Makes this practice |
| `listen.practiceCaption` | Hear how it goes before you play. |
| `listen.slower` | Slower |
| `listen.clickAlong` | Click along |
| `listen.playing` | Playing bar {n} of {total} |
| `listen.stopped` | Stopped |
| `listen.confirm.title` | Listen first? |
| `listen.confirm.body` | Hearing the music before you play makes this a practice take. It earns less XP and doesn't count toward your rank. |
| `listen.confirm.yes` | Listen, make it practice |
| `listen.confirm.no` | Keep it ranked |
| `listen.nowPractice` | Now a practice take |
| `ranked.reason.listened-first` | You listened first, so this one is practice. |
| `action.hearBar` | Hear bar {bar} |
| `shortcuts.l` | Listen or stop |

**Count-in**

| Key | Text |
| --- | --- |
| `countIn.reference` | Your starting pitch |

**Results**

| Key | Text |
| --- | --- |
| `results.tip.title` | One thing to try |
| `results.tip.more` | {n, plural, one {# more tip} other {# more tips}} |
| `results.badge.notGraded` | Not graded |
| `results.drift.ms` | ({ms} ms) |
| `results.saveFailed` | This take couldn't be saved on this device. |
| `action.changeSetup` | Change setup |
| `action.previousSlip` | Previous slip |
| `action.nextSlip` | Next slip |

`results.prevSlip` and `results.nextSlip` ("prev slip", "next slip") are replaced by `action.previousSlip` and `action.nextSlip`.

**Metronome settings**

| Key | Text |
| --- | --- |
| `settings.audio.click.classic` | Classic |
| `settings.audio.click.classic.hint` | A mechanical metronome: a firm, woody click. |
| `settings.audio.click.woodblock` | Woodblock |
| `settings.audio.click.woodblock.hint` | Rounder and softer. |
| `settings.audio.click.beep` | Beep |
| `settings.audio.click.beep.hint` | A short electronic beep. Cuts through in a loud room. |
| `settings.audio.click.play` | Play a bar of {sound} |
| `settings.audio.accent` | Accent the first beat |
| `settings.audio.a4.hint` | The A above middle C. Most groups tune to 440 Hz. |
| `settings.about.technical` | Technical details |

**Errors**

| Key | Text |
| --- | --- |
| `error.clockRate.title` | Audio timing problem |
| `action.backToPractice` | Back to Practice |

The denied screen reuses the existing `action.practiseWithoutListening` ("Practise without listening").

### 13.3 Removed or no longer shown

`chip.random`, `settings.audio.click.tick`, `settings.audio.click.wood`, `home.meterTooltip`, `tips.header`, `tips.count`, `tips.noTips`, `results.show` (the switch has its own label), `results.prevSlip`, `results.nextSlip`, `action.reload` (on the clock-rate screen), `onboarding.name.hint` (moves to Settings as `settings.profile.hint`). Delete them from `en.json` once no code uses them.

---

## 14. Accessibility

1. **No hover-only content.** Every explanation is visible text, or behind a button that opens on click, tap, Enter or Space. Native `title` may be added, never relied on.
2. **Info buttons:** `<button aria-expanded aria-controls>` with the accessible name "About Hear starting pitch". The popover is non-modal, closes on Escape, outside click, or a second press, and returns focus to the button. Its text is also reachable as part of the "What do these do?" sheet on phones.
3. **Radio groups:** instrument cards, key chips, time segments, length segments, mode, metronome options. One Tab stop per group, arrow keys move and select, Home and End jump. Each option's accessible name is its full meaning ("G major, 1 sharp, sounds F major"; "3 4 time, few pieces").
4. **Absent options are named in text.** Hidden meters, skipped difficulties and later keys each have a visible line that screen readers read with the group (`aria-describedby`).
5. **Ranked unavailable:** the Ranked option stays focusable with `aria-disabled="true"` and its reason in `aria-describedby`. The fix button follows it in tab order.
6. **Switches** ("Follow my progress", "Any tempo in range", "Accent the first beat", "Click along", "Slower") are `role="switch"` with visible on and off states not shown by colour alone.
7. **Live regions:** one polite region per screen. Announce: setup fallbacks (5.9), "Now a practice take", sound start ("Playing: key chord, D major", "First note: D3"), "Stopped", ranked countdown at 10 and 5 seconds ("Count-in starts in 10 seconds"). Do not announce each Listen bar.
8. **Focus:** opening the setup sheet focuses the chosen row's control; closing returns focus to the chip. The listen confirm focuses "Keep it ranked". The instrument dialog traps focus and returns it to "Change instrument".
9. **Targets:** 44 x 44 px minimum on coarse pointers, including key chips, time segments, range notes and info buttons.
10. **Contrast:** text 4.5:1; marks, control edges, the range bar's served band against the full band, and brass highlights 3:1, in light, dark and high-contrast themes.
11. **Not colour alone:** selected chips have a check mark; served versus full range differ in fill and in the text lines; the downbeat dot is larger, not only brighter.
12. **Reduced motion:** no pulse in calibration (the mark fills instead), range band jumps, count-in numbers appear without scaling, bar highlight jumps, no smooth scroll.
13. **Range picture:** `figure` with `figcaption` carrying `range.a11y`. The staff SVG is `aria-hidden`; the note buttons are real buttons.
14. **Sound has a visual:** every sound shows its live caption and highlight. Nothing is conveyed by sound alone.
15. **Screen readers during a take:** unchanged (04-design 8.4).
16. **Keyboard map additions:** L for Listen. Existing shortcuts unchanged.

---

## 15. What must not change

These were judged good by the owner or underpin trust. Changes to them are out of scope; a pull request that changes them is rejected.

**Calibration flow.**
- The steps, order and choices: device selects, start, the click sequence, the count of clicks, the three ways out (Try again, Play along instead, Skip), the estimate path, the warnings, the audio self-test.
- The measurement, its gates and its stored result.
- Allowed: the mark visuals (8.4), the card nesting fix, the skip hint, "Hear the click", and the new click sounds subject to the ship gate (11.1).

**Live feedback behaviour.**
- Which states a note can show, when each appears, the order of verdicts and their latency (04-design 6.1, 6.3), ghost semantics (6.2), live-to-final changes (6.6), page turns and slot rules (4.3), and the freeze during a take (4.4).
- The "Full" and "After the take" settings and what each shows.
- Allowed: the drawing of marks, ghosts and the playhead per the design spec, if feedback acceptance (6.7) still passes and the 1 m test (16) passes.

**Grading.**
- Scoring, components, grade bands, stars, tolerances, voice relative-pitch and octave rules, XP formulas and multipliers, rank thresholds, streak rules, seen-before and skip rules, ranked-eligibility rules, void rules.
- One addition: `RankedReason` gains `listened-first`, which makes a take practice through the same path as `practice-mode`. It adds no new scoring logic.

**Also unchanged.**
- The voice reference plays automatically before every voice count-in, in every mode (R7), with the same tones and timing.
- Ranked reading times per difficulty, and auto start at 0.
- Excerpt selection, except that "Any" time draws only from meters shown as available (5.5).
- Cover never shows title or composer; "About this music" stays the only way before results.
- Nothing is recorded or uploaded.

---

## 16. Acceptance checks

Each is a test (unit, component or e2e) unless marked "manual".

1. Voice group shows six cards in the order Soprano, Mezzo, Alto, Tenor, Baritone, Bass (Mezzo only if shipped). Baritone is selectable and served at difficulty 1 and 2.
2. Selecting any instrument shows its large range picture with full and served ranges; changing difficulty moves the served band; transposing instruments show the concert line.
3. The string "Level" or "level" (as difficulty) appears nowhere in rendered UI text. A test walks every route and fails on `/\blevel\b/i` outside "rank".
4. No control in setup is disabled without a visible reason in the DOM next to it.
5. Key: choosing "G major" sets `writtenKey` to G major; choosing "Any key" sets `'random'`. Works with mouse, touch and arrow keys, on every instrument.
6. Time: every shown meter can be chosen. With "Any", 200 draws for an instrument and difficulty never serve a meter that is not shown.
7. At 390 x 844, Mode and Start are visible without scrolling on Practice, and no row is ever under the sticky Start (checked at every scroll position).
8. "Hear the tempo" plays one bar at the set tempo on Practice and read-through.
9. Ranked read-through: "Listen first" opens the confirm; "Keep it ranked" changes nothing; "Listen, make it practice" changes the chip to Practice, plays, and the attempt records `listened-first`. The countdown never pauses.
10. Practice read-through: "Listen first" plays at once with no confirm.
11. No sound plays between count-in start and the end of the take, except the metronome and the voice reference before the count-in.
12. Results and attempt detail: Listen plays from bar 1 or the tapped bar; Slower plays at 75%.
13. "Hear starting pitch" and "Hear the key" each show a visible caption and an info button whose text matches section 10; the popover opens with keyboard and touch.
14. Settings shows Classic, Woodblock, Beep, each with a working preview. Stored `tick` reads as Classic after upgrade.
15. Each shipped click sound passes the calibration detector gates in the synthetic loopback e2e.
16. Calibration screens match the current flow step for step (existing calibration e2e passes unchanged except for copy).
17. Void results show the clean score with no slip marks.
18. Every new and changed key in section 13 exists in `en.json` with the exact text.
19. Manual: five players read live marks on a 14-inch laptop at 1 m and name each slip correctly at least 90% of the time.
20. Manual: the owner, as a baritone, picks his voice, sees his range, sets a key and a time signature, hears the starting pitch with its explanation, listens to an excerpt, and hears the new click, without help.

---

## 17. Build order

1. **Owner's points and setup:** baritone (and mezzo if the gate passes); range picture; Difficulty rename; key grid; time segments with the selector fix; tempo switch; mode with reasons before Start; phone layout fix.
2. **Sound:** Hear the tempo wiring; Hear starting pitch and Hear the key with captions, info and live highlight; Listen on results and history; Listen first with the ranked confirm; metronome sounds with the ship gate.
3. **Score frame and feedback marks** (design spec), with the 1 m test.
4. **Results moment:** state model, void calm, tips folded in, plain components and drift.
5. **Brand and small screens:** type, colour, icons, welcome, settings, errors, credits, not found.

Each step ships behind no flag and must leave the app working.

---

## Designer's notes

Author role: principal product designer. A review of this spec from the visual side, after the critique pass (`07-ux-critique.md`, `06-design-spec.md` "Changes after critique"). Each note is a behaviour or copy change the design needs. Where a note changes a section above, that section should be edited to match before build; until then, this list wins.

### Behaviour

1. **Info popover on hover (10, 14.1).** The owner asked for "a rollover". Keep the press, and add: on fine pointers, a 400 ms hover on the info button opens the same popover; pointer leave closes it unless a press pinned it. Touch is press only. Hover is an extra route, never the only one, so 14.1 still holds. Change 10 "not on hover alone" to "also on a 400 ms hover with a fine pointer".
2. **Count-in (8.9).** Replace "the score dimmed slightly behind" with: the first system is never covered and never dimmed; later systems render at 50%; the number sits in the paper's top margin above the first system. The score does not move between read-through layout, count-in and take.
3. **Voice before the count-in (8.9).** The band shows "Your starting pitch" with two steps, the key chord (marked done) and the live "First note: {note}". The note is the excerpt's real first note; the spec's example "D3" is only an example (the mockup excerpt starts on G3).
4. **Key chord name for transposing instruments (9.1, 10).** `reference.playing.chord` shows the written key ("Key chord: A major" for a clarinet reading A major). The chord sounds at concert pitch, which is what a clarinettist hears as A major, so the name matches the page. The popover already says "at concert pitch".
5. **Practice layout on desktop (5.2, 5.11, 16 item 7).** Mode and Start are pinned in the setup card's foot; Difficulty, Key, Time, Tempo and Length scroll inside the card. Add a desktop version of check 7: at 1440 by 900 and 1280 by 800, Start and Mode are in view on load.
6. **Instrument picker (6.1, 7.2).** Desktop: the large picture lives in a fixed right column of the dialog and updates on every pick. Phones: a panel pinned to the bottom of the sheet shows the selection's staff, note buttons and legend. The phone panel drops the keyboard strip to keep the list usable; the keyboard stays on Practice and in the setup sheet. Dialog head and foot are fixed; only the grid scrolls.
7. **Card range text (6.3, `range.cardText`).** Voices show the sung range ("Tenor A2 to A4") with "Written an octave higher" for tenor; transposing instruments keep the written range and add "bars show sounding pitch". `instrument.card.a11y` uses the same frame as the visible text.
8. **Results order (8.11).** "Next excerpt", "Try again (practice)" and "Change setup" move into the header on desktop, under the XP line. On phones they stay at the end of the page, and a bar pinned to the bottom with "Next excerpt" and "Try again (practice)" appears once the header has scrolled out of view. Change the order line in 8.11 to match.
9. **Void results (8.11).** The header reads "Not graded" as its heading, with no grade letter and no stars. The score card adds the line "Clean score. Nothing is marked when a take is not graded."
10. **Listen states (9.3).** On results, while Listen plays, the live caption "Playing bar {n} of {total}" shows next to the toolbar; a tapped bar shows "From bar {n}" there until Listen starts. Visual only: the live region still does not announce each bar (14.7). On read-through in Practice, "Listen first" keeps its caption while it reads "Stop".
11. **Ranked confirm on phones (9.4).** The sheet has a grabber, so it must behave like one: swipe down or a tap on the scrim is "Keep it ranked", with nothing played.
12. **Calibration controls (8.4, 15).** While listening, "Hear the click" is removed (a click would be heard by the measurement) and both device selects are disabled with "Device choice is locked while we listen." It shows again before Start and on the result. These are control states, not flow changes, so section 15 is kept.
13. **Metronome sound and calibration (11.2).** Changing the sound keeps the stored calibration: the gate (`isMeasuredFor`) depends on route, staleness and method, not on the sound. The count-in recheck template is stored per sound; until the next calibration with the new sound, the recheck runs without a template. Engineering to confirm the recheck still meets its gates that way; if not, mark the calibration stale on a sound change and show "Recalibrate for the new sound" instead of the line below.
14. **Click volume (11.2).** Releasing the slider plays one click at the new level.
15. **Sound previews (11.2).** One preview at a time; the playing option shows "Stop" and the brass playing state.
16. **First-time coach mark (4.2 step 4).** Inline under "Start playing" (above the dock row on phones), not an overlay. It never covers "Start playing" or the music.
17. **Tips off from results (8.11).** Turning off "Show a tip after each take" in the results card removes the card and shows a toast for at least 6 seconds with "Undo", which restores it.
18. **Keys on phones (5.4).** The key grid is 3 columns on phones at every difficulty, so no chip is narrower than 96 px; 4 columns from difficulty 5 on desktop only.
19. **Owner audition before build (11.1, 17 step 2).** The owner listens to `docs/redesign/audio/*.wav` (Classic, Woodblock, Beep, today's Tick) and accepts or rejects each before the metronome work starts. Record the verdict in `docs/PLAN.md`.

### Checks to add to section 16

- The ♩ in "♩ = 72" sits no more than 0.35 em from "=" wherever the tempo appears (setup, toolbar summary, captions, count-in, status strip).
- No ghost accidental overlaps another glyph's bounding box in the feedback acceptance suite. The design draws a ghost that needs an accidental at cue size (75%), accidental between the written note and the ghost.
- A test compares each screen's rendered text with `en.json`, so mockup and app copy cannot drift.
- The contrast test covers the high-contrast theme for the take and results screens, and the new pairs in design spec 3.3 (full band against track and selected wash, keyboard keys in dark mode).

### Copy

New keys:

| Key | Text |
| --- | --- |
| `reference.info.title.voice` | What is the reference? |
| `reference.info.title.instrument` | What is the key chord? |
| `picker.axis` | Bars show the sounding range on one scale, C1 to C8. The tall tick is middle C (C4). The bold part is what you get at your difficulty. |
| `range.writtenOctave` | Written an octave higher |
| `range.barsSounding` | bars show sounding pitch |
| `results.tip.less` | Hide {n, plural, one {tip} other {tips}} |
| `action.hearBars` | Hear bars {from} to {to} |
| `listen.fromBar` | From bar {n} |
| `results.void.cleanScore` | Clean score. Nothing is marked when a take is not graded. |
| `tips.offToast` | Tips turned off. Turn them on in Settings > Practice. |
| `calibrate.devicesLocked` | Device choice is locked while we listen. |
| `settings.audio.click.keepsCalibration` | Changing the sound keeps your calibration. |
| `settings.audio.click.playing` | Playing: {sound} |
| `settings.audio.metronomeVolume.hint` | Plays one click when you let go. |
| `scan.practice.readHint` | Read it through. Start when you are ready. |
| `setup.empty.title` | No excerpt fits these settings |
| `scan.sounds.listenRanked` | In a ranked take, this makes it practice. We ask first. |

Changed keys:

| Key | New text |
| --- | --- |
| `results.tip.more` | Show {n, plural, one {# more tip} other {# more tips}} |

The "Undo" on the toast reuses `action.undo`.
