# 04 Product design: screens, feedback rendering, design system, accessibility

Owner: senior product designer. Readers: the overseer, and the AI implementers who build every screen and the overlay without mockups and without a human design review.

Status: revision 2 (after the overseer's rulings R1 to R13 and the cross-examination round). Part A is web v1 and is built now. Part B ("Later") at the end is brief and must not be built in this build. The review log at the end lists what changed.

This section owns how the product looks, reads, moves and speaks: screens, the visual treatment of every verdict, layout slots, tokens, glyphs, copy and accessibility. It owns no grading value. Where a number belongs to another role, this section names the file and the key:

| Value | Owner and file |
| --- | --- |
| Tolerances, match window, live provisional window and hysteresis, credits, weights, gates, end-of-take rule, ranked rules and the `rankedReason` enum | 02, `config/grading-config.json` (02 §4, §5.2) |
| Levels, allowed keys and meters, tempo ranges, bars, strict scan time, count-in, level descriptions | 02, `config/levels.json` (02 §2.3) |
| XP formula and factors, rank table, level-up and level-down rules, placement, practice XP | 02, `config/progression.json` (02 §5) |
| Pattern names, dimensions, evidence templates, tip text | 02, `config/tips.json` (02 §6) |
| Detection latency budgets, `NoteVisualState`, `GhostNote`, `FollowerEvent`, `ScoreView`, `AttemptRecord` | 01 (§5.8, §6.5, §9.9, §10, §12) |
| Attribution fields, licence allowlist, modification vocabulary | 03 (§8, §9) and 01 §6.1 |
| Platform capabilities, per-take measurement gate, iOS rules | 05 and 01 §5.2, §7 |

This section owns, and freezes in wave 0 (section 12): `design/tokens.json` (generated into `src/ui/tokens.css` and `src/ui/tokens.ts`), `src/ui/glyphs.svg` with `src/ui/glyph-ids.ts`, `src/ui/copy/en.json`, `src/notation/visual-states.ts`, `src/ui/layout-table.ts`.

Conventions: px are CSS pixels. "sp" is the staff space after scaling. Tokens are written `--token-name`. Every hex value here is final for v1; implementers must not invent colours, sizes or strings. "Key" always means the written key the player reads; concert key is secondary text (R1).

---

# Part A — Web v1

## 0. v1 scope at a glance

| Feature | Scope | Section |
| --- | --- | --- |
| Onboarding: welcome, instrument, mic pre-prompt, calibration, level (stepper or 3-excerpt placement) | v1 | 5.1 |
| Home and setup with written key, level-gated options, Random chips, Ranked/Practice, Output, Today strip, banners | v1 | 5.2 |
| Scan: covered, scanning, ready; strict ranked timer that auto-starts the count-in (R6); STARS with three highlights; Hear tempo; voice reference (R7); numeric tuning note | v1 | 5.3 |
| Performance: count-in, beat dots, bar-highlight playhead with next-bar marker, input meter, status line, wake lock, frozen layout | v1 | 5.4 |
| Live feedback "Full" as the default (R11), with the readability rules | v1 | 6 |
| Optional "After the take" (blind) feedback mode | v1 | 6.4 |
| Half-page-turn slot layout for phones and short viewports; review as a natural-order scroll | v1 | 4.3 |
| Results: grade, stars, three components, diagnostics lines, counts, XP factors, rank bar, level cards (offer, auto level-up with Undo, level-down suggestion), badges, attribution header | v1 | 5.5 |
| Review: heat strip, My take / Clean score, prev/next slip, note inspector, re-judged rings and filter | v1 | 6.5, 6.6 |
| Tips interstitial (primary plus optional secondary, evidence line, Clean read) | v1 | 5.6 |
| Progress (rank header, ladder, per-instrument level cards, streak numbers, common slips list) | v1 | 5.7 |
| History list (instrument and ranked-only filters) and attempt detail | v1 | 5.8 |
| Calibration (loopback, play-along, reported fallback), audibility check, audio self-test | v1 | 5.9 |
| Sheets: stop and skip confirms, rank-up card, session summary with text-only focus card, iOS install coach mark, storage-loss card | v1 | 5.10 |
| Settings (reduced set), Data, About, Credits page | v1 | 5.11, 5.12 |
| Permission, empty and error states; Practise without listening (no grade, no XP) (R13) | v1 | 9 |
| Design system frozen in wave 0, automated design checks | v1 | 7, 12, 13 |
| Accessibility: WCAG 2.2 AA outside the take, muted live regions during takes, keyboard, reduced motion, high contrast, forced colours | v1 | 8 |
| Playback of the score or the take, listen-back, MusicXML export, report-a-problem, drills, Show me, remedial bias, trend chart, streak calendar, review filter chips, history search and delete, multiple profiles, line playhead, playhead off, notation size, light paper in dark theme, live pitch dot, note names, Errors only and Calm modes, visual-only metronome, custom scan time, count-in and subdivision overrides, custom instrument icons, celebratory motion, self-assessment buttons, manual screen-reader passes, haptics | later | Part B |

## 1. Why this product, in one table

The comparison with Sight Reading Factory is design intent, not marketing copy. Any public claim about SRF needs a fresh check first (later).

| Common weakness in sight-reading apps | This design |
| --- | --- |
| Generated exercises with no phrases or cadences | Every exercise is a real 8 to 12 bar excerpt (03). Title and composer appear after the take. |
| The practice flow does not listen | The app listens and marks every note live, then grades the take. |
| No picture of how the performance lined up with the page | Ghost notes show what was played, where and at what pitch (R11). Review steps through every slip. |
| Settings form first, music second | One setup screen with defaults and Random chips; Start is one click from Home. |
| Nothing structured before or after playing | A scan step (STARS and a strict timer) before, one or two specific tips after. |
| Weak sense of progress | Score, grade, XP, a 10-step rank ladder, per-instrument level, streaks. |
| Cramped on phones | Slot-based page turns that never move the music under the eye; landscape recommended (R13). |

## 2. Design principles

1. **The music is the interface.** During a take the score frame takes at least 75% of the viewport. Nothing moves except the bar highlight, the beat dots and page-turn slot swaps.
2. **Feedback lands where the note was played.** Every mark is drawn at the played position. Marks appear at or left of the playhead, with one exception R11 forces: an early note may change the state of the single next unplayed note, and only within its match window `W_i` (6.4 rule 1).
3. **Show, then explain.** Live view shows that something was wrong. Review explains what (cents, milliseconds, the written and played note).
4. **Never colour alone.** Every verdict has a lane glyph and a notehead treatment as well as a colour; review adds text.
5. **Silence while playing.** No sound but the metronome and the voice reference; no screen-reader speech during a take.
6. **Musician's language.** "Late, about a sixteenth", not "timing error 92 ms". Numbers are available in review, never forced.
7. **No number is ever taken back.** The live view never shows a number; grades and XP come only from final judgments.

---

## 3. Information architecture

### 3.1 Route map (hash routes)

```
#/welcome            Onboarding (first run only; steps are sub-states)
#/                   Home = Setup
#/practice/scan      Scan                 } one practice flow; Back from any of these
#/practice/play      Performance          } returns to Home (with the confirms in 5.10)
#/practice/results   Results and review   }
#/practice/tips      Tips interstitial    }
#/progress           Progress and rank
#/history            History list
#/history/:attemptId Attempt detail (results, read-only)
#/settings           Settings (anchors #/settings/audio, /display, /practice, /accessibility, /data, /about)
#/calibrate          Calibration and audio self-test
#/credits            Credits
#/dev/components     Component fixtures (dev builds only)
#/dev/replay         Event-log replay (dev builds only; 01 §13.6)
```

### 3.2 Navigation

- App bar on every screen except `play`: brand at left; Practice, Progress, History as centre tabs (`lg`/`xl`) or a bottom tab bar (`xs`, `sm` portrait); settings gear at right. No profile avatar (one player per device in v1).
- During `play` the app bar is replaced by the performance toolbar (5.4.1). No navigation chrome during a take.
- Leaving `scan` after reveal: the excerpt is already seen (02 §5.3), so Back shows the skip-after-reveal confirm (5.10). Leaving `play` shows the stop confirm (5.10).

### 3.3 Practice loop

```
Home --Start--> Scan(covered) --Start scan--> Scan(scanning) --Start / auto at 0 (ranked)--> Count-in --> Take
  ^                 | Skip (free)                    | Skip (burns, 5.10)                              |
  |                 +--> new excerpt                 +--> new excerpt                    end event --+
  |                                                                                          v
  +-------- Done for now <-------- Tips interstitial <---- Next excerpt ---- Results (finishing ≤ 1.5 s first)
                                        | Next excerpt --> Scan(covered), new excerpt
                                        | Try again ----> Scan(scanning), same excerpt, practice
```

- Tips come after results. Results preview the primary tip in one line.
- After "Done for now", or every 10 attempts, the session summary sheet opens over Home (5.10).
- `PracticeSession` states (01 §5.9: `idle`, `loading`, `covered`, `scanning`, `count-in`, `performing`, `finishing`, `results`, `error`) select the sub-view. React reads them; it never drives audio.

---

## 4. Layout system

### 4.1 Breakpoints

| Breakpoint | Width | Typical device | Columns | Page margin | Gutter |
| --- | --- | --- | --- | --- | --- |
| `xs` | < 568 | phone portrait | 4 | 16 | 12 |
| `sm` | 568–767 | phone landscape, small tablet | 8 | 16 plus safe-area insets | 12 |
| `md` | 768–1023 | tablet portrait | 8 | 24 | 16 |
| `lg` | 1024–1439 | laptop, tablet landscape | 12 | 32 | 24 |
| `xl` | ≥ 1440 | desktop | 12, content max 1360 | auto | 24 |

- **Short** modifier: viewport height < 500. Toolbar 44 px, no status line, non-score panels in sheets.
- Heights use `100dvh` (layout) and `100svh` (minimums), never `100vh`.
- Safe areas are read through variables so tests can inject them: `--sai-top: var(--test-sai-top, env(safe-area-inset-top))`, and the same for right, bottom, left. Page padding is `max(margin, var(--sai-*))`.
- Pointer rule: on `(pointer: coarse)` every interactive target is at least 44 × 44 px. With a fine pointer, compact controls may be 36 px tall (WCAG 2.5.8 needs 24).
- Non-performance screens use a centred column of max 1120 px on `lg`/`xl`.

### 4.2 Score layout (`src/ui/layout-table.ts`)

The notation module lays out an excerpt once per exercise (01 `RenderOptions`). `layout-table.ts` exports the rows below as data plus two pure functions, `barsPerSystem` and `slotCount`.

| Row id | Applies when | Bars per system | Systems for 8 / 10 / 12 bars | sp (min) | Toolbar / status line |
| --- | --- | --- | --- | --- | --- |
| `xl` | width ≥ 1440 | `ceil(N / 2)`, max 6; use `ceil(N / 3)` per system if the average exceeds 9 tickables per bar | 2 / 2 / 2 | 11 | 56 / 28 |
| `lg` | 1024–1439 | 4 | 2 / 3 / 3 | 10 | 56 / 28 |
| `md-land` | 768–1023, width > height | 4 | 2 / 3 / 3 | 9 | 56 / 28 |
| `md-port` | 768–1023, width ≤ height | 3 | 3 / 4 / 4 | 9 | 56 / 28 |
| `sm-short` | 568–1023 and height < 500 | 4 | 2 / 3 / 3 | 7.5 (7) | 44 / 0 |
| `xs` | width < 568 | 2; a bar with more than 8 tickables gets a system to itself | 4 / 5 / 6 | 7.5 (7) | 44 / 0 |

- Uneven splits put the extra bars in the earlier systems.
- System height = 12 sp (4 sp staff, 4 sp above and below for ledgers and ghosts) + 20 px verdict lane + 12 px gap. At 10 sp: 152 px. At 7.5 sp: 122 px.
- Bar widths are proportional to tickables per bar, minimum 14 sp. Clef and key signature start every system; the time signature appears in system 1 only.
- One `<svg>` per system, each with its own overlay `<g>` (01 §5.8). The frame places systems in slots.

### 4.3 Slots and half-page turns (phones and short viewports)

`slotCount(viewportH, insets, row) = floor((viewportH − toolbar − statusLine − sai-top − sai-bottom) / systemHeight)`, clamped to 1..6. If `v < 2` at the row's sp, sp steps down to its minimum and the count is recomputed.

| Viewport (CSS px) and insets | Row | Available height | Slots `v` |
| --- | --- | --- | --- |
| 390 × 844 home-screen app, insets 47 / 34 | `xs` | 719 | 5 |
| 390 × 660 Safari tab, insets 0 / 34 | `xs` | 582 | 4 |
| 844 × 340 Safari tab landscape, insets 0 / 21 | `sm-short` | 275 | 2 |
| 1180 × 760 iPad landscape | `lg` | 676 | 4 (12 bars need 3: no turns) |
| 1024 × 1366 iPad portrait | `lg` | 1282 | 6 (no turns) |

Algorithm (`N` systems, `v` slots, current system `s`):

1. If `N ≤ v`, slot i shows system i and nothing ever turns.
2. Otherwise slots 1..v start with systems 1..v. Keep-behind `k = 1` if `v ≥ 4`, else 0.
3. When the playhead enters system `s`, wait `min(400 ms, 50% of system s's duration)`. Then every slot holding a system `x < s − k` receives, in slot order top to bottom, the lowest-numbered system not yet shown.
4. The current system never moves. Only the replaced slot changes: a 160 ms crossfade, instant with reduced motion. Nothing scrolls.
5. When the next system is not in the slot directly below the current one (the reading order wraps), that slot gets a 3 px `--playhead-next` bar on its left edge. Every system shows its number in the left margin (12 px caption) whenever page turns are active.
6. The toolbar shows "Lines 2–6 of 6" (4 px dots on short viewports).

Why 400 ms: pitch verdicts for the last notes of the previous system arrive up to 01's sharp/flat p95 (01 §12: ≤ 300 ms winds/brass/strings, ≤ 350 ms voice), so that system stays on screen until they land. Verdicts that arrive for a system already swapped out are applied to the model silently and shown in review.

Worked cases, 12 bars: `v = 5`, 6 systems: one swap (entering system 3, slot 1 becomes system 6). `v = 4`: two swaps (entering 3, slot 1 → 5; entering 4, slot 2 → 6). `v = 2`, 3 systems: one swap, 400 ms after entering system 2. With `v ≥ 3` the next system is always visible; with `v = 2` it appears at most 400 ms after the current system starts. With `v = 1` (very small windows) the scan shows "Make the window taller to see the next line", and the swap happens at 75% of the current system.

- Scan on phones shows all systems as a natural-order vertical scroll with the same system geometry. At count-in start the frame resets to slots 1..v.
- Review on phones is a natural-order vertical scroll. Prev/next slip scrolls the target system into view.
- "Rotate for a bigger page" appears on `xs` during scan only, never during the take. Landscape gives about 175 px per bar against 134 px in portrait and half the return sweeps (R13).

### 4.4 Freeze and resize during a take

- The layout is computed at reveal and frozen when the count-in starts.
- A resize while performing (Safari bars, Stage Manager, rotation) scales the whole frame with one CSS transform, `scale(min(newW / oldW, newH / oldH))`, origin top left. Overlay groups live inside each system's `<svg>`, so they scale with it. VexFlow is never re-rendered during a take.
- A rotation during the count-in cancels the take, re-lays out, and restarts the count-in. No penalty and no change to ranked status (needs 01 `PracticeSession` to support cancel and restart of an unstarted take).
- During `count-in` and `performing`: `overscroll-behavior: none` on `html` and `body`, `touch-action: none` and `user-select: none` on the score frame, long-press callout disabled. Controls use `touch-action: manipulation`.
- Results re-lay out freely.

---

## 5. Screens (v1)

Each screen lists layout, states and acceptance. Wireframes: `[ ]` button, `( )` chip, `< >` select, `[x]` checkbox, `###` score. Every string comes from `en.json` (section 10).

### 5.1 Onboarding

Five steps in one route, a centred card (max 560 wide), "Step 2 of 5", Back. Every step except instrument is skippable.

1. **Welcome.** Headline, one sentence, a name field (optional, default "Player"), [Get started].
2. **Instrument.** Cards grouped by family (Voice, Woodwinds, Brass, Strings, Keyboard). Card: a 40 px circle with the instrument abbreviation from `en.json` (`Fl`, `Cl`, `A.Sx`, `Tpt`, `Vn`, `Vc`, `Pno`, `S` `A` `T` `B`), name, transposition line ("B♭: sounds a major 2nd lower"). Launch instruments only, from 02 §1.1; a "Show beta instruments" toggle under the grid reveals beta cards with a "beta" badge. Voice opens a row of Soprano, Alto, Tenor, Baritone/Bass. Cards are a radio group (arrow keys move). 4 per row on desktop, 2 on phones.
3. **Microphone pre-prompt.** Explains why before the browser prompt:

```
+------------------------------------------------------+
|  Step 3 of 5              (mic glyph, 48 px)          |
|  Let the app hear you play                            |
|  We listen while you play so we can mark each note.   |
|  Sound is analysed on this device. Nothing is         |
|  recorded or uploaded.                                |
|  [ Allow microphone ]        Not now                  |
+------------------------------------------------------+
```

   [Allow microphone] runs 01 §7.1's unlock and `getUserMedia` from the click. Granted: step 4. Denied: the denied card (9.2) inline. "Not now": step 5, with the "Microphone off" banner on Home.
4. **Calibration.** The 5.9 component, embedded. Skippable everywhere. Where `capabilities.outputLatencyReported` is false (iOS Safari), it is the default path and the intro adds: "On iPhone and iPad, takes earn XP only after this check." Skipping it never blocks a take (5.9).
5. **Level.** "Find my level (3 short excerpts, about 3 minutes)" (primary; placement per 02 §5.1, starts at L2) or "I'll choose" with a 1–10 stepper and the level description from `levels.json`. Placement goes to Scan with a "Placement 1 of 3" chip.

Acceptance: onboarding completes in ≤ 6 clicks with defaults; the browser mic prompt never appears before the pre-prompt; Home, Settings, History and Practise without listening work without mic permission; a returning player never sees onboarding unless data is deleted.

### 5.2 Home and setup

Home is setup. Last settings are kept, so Start is one click. Each row is a `<fieldset>` with a trailing Random chip; when Random is on, the control is disabled and reads "Random" in italic.

| Row | Control | Options (all from config) | Default |
| --- | --- | --- | --- |
| Instrument | `<select>` grouped by family | launch instruments, plus beta when the setting is on | last used |
| Level | Stepper with the `levels.json` description below it | 1–10. A level with 0 eligible excerpts for this instrument is disabled and captioned "More music coming". A level with fewer than 10 eligible excerpts is captioned "Not much music here yet". | current level |
| Key | `<select>` of written keys allowed at the level (L1: major keys with ≤ 1 accidental). Each option reads "E major (concert D major)" for transposing instruments. Disallowed keys are hidden, with the footnote "More keys from level {n}". | Random |
| Time | SegmentedControl of meters allowed at the level. A meter with fewer than 5 eligible excerpts for this instrument and level is disabled, with the tooltip "Not enough music in {meter} at this level yet". | Random |
| Tempo | TempoSlider plus numeric field, the level's range, beat unit shown ("♩ = 72", "♩. = 54") | level mid tempo |
| Length | SegmentedControl Random / 8 / 10 / 12. 10 from L3, 12 from L6. A preference, not a filter: the selector may serve another length and the scan toolbar says so. | Random |
| Output | `<select>` Speakers / Wired headphones / Bluetooth (01 §7.6) | last used |
| Mode | SegmentedControl Ranked / Practice | Ranked |

- Eligible counts come from a selector function over the manifest (dependency on 01 P9b: `countEligible(instrument, level, meter?)`). Thresholds 10 and 5 live in `tokens.json` under `ui`.
- XP hint under the rows: "Random key, meter and tempo: +24% XP", built from 02's `m_random` (+8% per random key, meter, tempo, cap +25%). Random level and length add nothing and are not counted.
- **Today strip**: "Streak 6 days · 9 takes · 214 XP today", plus a compact rank bar. When today has 1 or 2 ranked takes: "1 more ranked take today keeps your streak" (02: a streak day is ≥ 3 ranked takes).
- **Banners** above the rows, one at a time in this priority: storage loss (9.3), microphone off, calibration missing or stale, Bluetooth, level-up offer pending.
- A footer link "Credits" (5.12).

```
lg
+--------------------------------------------------------------------------------------+
| Sightread   Practice  Progress  History                                       (gear) |
+--------------------------------------------------------------------------------------+
| [i] Calibrate once so timing grades are fair. It takes 8 seconds. [Calibrate]   [x] |
|  Practice                                                  +-----------------------+ |
|  Instrument   <B♭ trumpet            v>                    | Today                 | |
|  Level        [-]  5  [+]                       (Random)   | Streak 6 days         | |
|               Syncopation, mixed sixteenths, 4 accidentals | 9 takes · 214 XP      | |
|  Key          <E major (concert D major) v>     (Random*)  | Student               | |
|  Time         (2/4)(3/4)(4/4)(6/8)(2/2)         (Random*)  | [===========---] 79%  | |
|  Tempo        ♩ = [ 92 ]  |-----o--------|      (Random)   | to Section player     | |
|  Length       (Random*)( 8 )( 10 )                          +-----------------------+ |
|  Output       <Speakers v>                                                           |
|  Mode         ( Ranked* )( Practice )                                                |
|  Random key and meter: +16% XP                                                       |
|  [        Start        ]   (56 px tall, 320 wide)                          Credits   |
+--------------------------------------------------------------------------------------+
```

On `xs` the rows stack, the Today strip sits at the top as one line plus the rank bar, and Start is sticky above the tab bar, clear of `--sai-bottom` by 8 px.

Acceptance: Start is reachable in ≤ 2 Tab stops (a "Start practice" skip link is first); changing Level re-filters Key, Time and Length without dropping a still-valid choice; with every row on Random the screen still says what Random means ("Any key up to 4 sharps or flats"); a disabled meter chip has its tooltip and is not focusable as a choice.

### 5.3 Scan

States: `covered`, `scanning`, `ready`.

- **covered**: a paper cover over the score showing the key signature, time signature, tempo, bar count and clef drawn large, plus [Start scan] (Space). Title and composer are hidden until results. For a ranked take the cover also says: "You'll have {seconds} seconds to read, then the count-in starts by itself. Want more time? Switch to Practice." with a [Practice instead] button. [Skip] here is free (02 §5.3).
- **scanning**: the full score in its frozen performance geometry. [Start scan] is the first gesture: it unlocks audio, requests the wake lock, and reveals (marks the excerpt seen).
  - **Ranked**: the ScanTimer counts down the level's strict scan time from `levels.json` (R6). From 5 s left the toolbar label reads "Starting in 5", "4", ... At 0 the count-in starts automatically with the music still visible. [Start playing] (Space, Enter) is allowed at any time.
  - **Practice**: the timer counts down the same time but never starts the take. At 0 it shows a check and "Scan time's up. Start when ready."
  - The toolbar chip reads "Ranked · scan 0:30" or "Practice" (with the reason tooltip from 5.5.2).
- **ready**: practice only, after the timer ends.

STARS panel (hidden if "Show STARS checklist" is off): five ChecklistItems with one-line prompts from 02 §7. Rows auto-tick at even intervals across the scan (30 s: every 6 s) unless the player ticks first. Ticking has no score effect. Highlights, drawn in the overlay and removed at count-in, appear while a row is hovered, focused or active:

- Signatures: the key and time signatures pulse once (opacity 0.4 → 1, 300 ms; static with reduced motion). The row detail is generated: "E major, 4 sharps: F♯ C♯ G♯ D♯. 6/8, felt in 2."
- Accidentals: every written accidental outlined in `--ink-accent-soft`.
- Signs: the highest and lowest notes outlined (needs 03's `extremes: { highId, lowId }`).
- Tempo and Rhythms: no highlight in v1 (Rhythms needs per-bar rhythm difficulty; later).

Helpers below the checklist:

- [Hear the tempo]: one bar of clicks.
- Voice: [Hear the reference] (tonic triad, then the starting note, 02 §4.5). The reference also plays automatically before every voice count-in, in every mode (R7); the button only repeats it.
- Winds, brass, strings: [Tuning note] opens a 3 s capture and shows a number only, no needle: "You're 8 cents flat. We'll allow for that." Capped per 02 §4.5.

Toolbar: [< Home] · "Level 5 · E major · 6/8 · ♩. = 60 · 10 bars" · chip · ScanTimer · overflow menu · [Start playing ▶]. When the selector served something other than a preference, a quiet chip follows the summary: "10 bars instead of 12". The overflow menu holds "About this music (shows title and composer)" and "Skip this excerpt".

CC BY items (licence `CC-BY-4.0`) also show a non-identifying source line under the toolbar summary: "Typeset by {encoder} · {corpus} · CC BY 4.0". Tapping it opens a licence sheet with the encoder, corpus, licence name and licence link, and no title or composer.

Layout: the STARS panel is 280 px wide on `lg`/`xl`, right of the score; the score keeps its performance geometry and is scaled down by CSS transform. On `md` and below the panel is a bottom sheet with a 56 px peek ("Scan · 3 of 5", timer).

On iOS, if the wake lock request fails: a one-time hint under the toolbar, "Set Auto-Lock to Never while you practise (Settings > Display & Brightness)."

Acceptance: scan geometry (systems, bar breaks, note x) equals the performance geometry; in a ranked take with no input the count-in starts at the strict time ± 50 ms; practice never auto-starts; no highlight remains at count-in; the cover never shows title or composer; "About this music" is the only way to see them before results.

### 5.4 Performance

#### 5.4.1 Regions

1. **Toolbar** (56 px, 44 short): [■ Stop] at left; centre the beat dots and "Bar 4 · ♩ = 92"; right the input meter, the line indicator (page turns only) and the Ranked/Practice chip. On short viewports the status messages below replace "Bar 4" in the centre.
2. **Score frame**: paper surface with slots. No scrolling, no buttons, no tooltips, no text inside it during a take.
3. **Status line** (28 px, not on short viewports): "Bar 4 of 10" at left, tempo at right. For CC BY items it also shows "Typeset by {encoder} · {corpus} · CC BY 4.0" at right in `--text-muted`.

Status messages (status line or toolbar centre), one at a time, highest first:

1. "We can't hear you. Move closer to the mic?" (no voiced frames for 3 s after bar 1; 02 voids at 5 s).
2. "Lost your place? Rejoin at the next bar line." (01 `status: lost-place`).
3. "Keep going: come in at bar {n}" (01 `status: come-in-at`).
4. "Restarting the count-in" (01 §7.7, first click not heard).
5. "Count-in", then "Bar {n} of {total}".

#### 5.4.2 Count-in

- Length from `levels.json`. Pickups count the full bar and start on the pickup beat.
- Beat dots show large numbers (32 px, `--font-numeric`). A 4 px rail under bar 1 fills over the count-in and ends exactly on the first note, so the eye is already there.
- The first note gets the `active` ring on the last count-in beat.

#### 5.4.3 Beat dots

- One dot per beat; compound meters one dot per dotted beat; 5/8 and 7/8 grouped by beaming with a 16 px gap. Downbeat 12 px, others 8 px, outline 1.5 px `--text-muted`; the current beat fills `--metro-active`.
- The fill shows for 90 ms, then eases to 60% fill until the next beat. Above 180 bpm only every second beat pulses (no flash above 3 per second, WCAG 2.3.1).
- Driven by 01's audible clock, so the dot changes when the click is heard.

#### 5.4.4 Playhead (bar highlight only in v1)

- The current bar gets `--playhead-bar` behind the ink, spanning the staff plus 2 sp above and below.
- From 75% of the current bar, the next bar gets a 3 px top-edge marker in `--playhead-next`.

#### 5.4.5 Input meter

64 × 8 px, three zones: below gate, good, clipping (top 3 dB). The clipping zone shows "!" when hit. `aria-hidden` during takes.

#### 5.4.6 End of take

- The take ends only on 01's `end` event (Stop, the `endOfTake` rule in `grading-config.json`, or a void). Silence never ends a take mid-excerpt. The UI does not compute the end itself.
- `finishing` (≤ 1.5 s): the toolbar centre shows "Scoring…" with an indeterminate bar; the live overlay stays.
- Then Results appear in place: the score does not move, the toolbar becomes the results header, the overlay switches to review rendering with the crossfades of 6.6. On `lg`/`xl` the results panel slides in from the right over 240 ms (instant with reduced motion) and the score reflows only after it arrives.
- The wake lock, requested at Start scan, is held through scan, take and results, and released on leaving the practice flow or after 5 minutes idle on results; it is re-requested when the page becomes visible (05 W11).

#### 5.4.7 Wireframes

```
lg, 10 bars, 3 systems
+--------------------------------------------------------------------------------------+
| [■ Stop]        ○ ● ○ ○   Bar 6 · ♩ = 92                 [|||||||   ] (Ranked)       |
+--------------------------------------------------------------------------------------+
|  &  ####  4/4 | ♩ ♩ ♪♪ ♩ | ♩. ♪ ♩ ♩ | ♩ ♩ ♩ ♩ | 𝅗𝅥   ♩ ♩ |   (marks at 60% / 40%)    |
|                 · · ·· ·   ·  ▸ · ·   · ▲ · ·   ·    · ·    <- verdict lane          |
|  &  ####      |[♩ ♪♪ ♩ ♩]| ♩ ♩ 𝅗𝅥   | ♩ ♩ ♩ ♩ |              bar 6 tinted          |
|                 ·                                            bar 7 next marker      |
|  &  ####      | ♩ ♩ ♩ ♩ | ♩. ♪ ♩ ♩ | 𝅝          ||                                    |
+--------------------------------------------------------------------------------------+
| Bar 6 of 10                                                                ♩ = 92    |
+--------------------------------------------------------------------------------------+

xs portrait, 12 bars, v = 4 (after the first swap: slot 1 holds line 5)
+--------------------------------------+
|[■]  ○ ● ○ ○  Bar 6   [|||  ]  ••••   |
+--------------------------------------+
|5▌& #### | ♩ ♩ ♩ ♩ | ♩. ♪ ♩ ♩ |      |  <- next line, left bar marks the wrap
|2 & #### | ♩ ♩ ♩ ♩ | 𝅗𝅥  ♩ ♩ |        |  (played, 40%)
|3 & #### |[♩ ♪♪ ♩ ♩]| ♩ ♩ 𝅗𝅥 |         |  current
|4 & #### | ♩ ♩ ♩ ♩ | ♩ ♩ ♩ ♩ |        |
+--------------------------------------+
```

Acceptance (performance):

- No scrolling during a take at any acceptance viewport (13.2).
- Page turns follow 4.3 exactly (unit test on `planSwaps`, E2E on the 4 worked cases).
- A mid-take `setViewportSize` causes zero VexFlow renders (render counter) and the overlay stays aligned within 1 px.
- Ranked: the count-in auto-starts at the strict scan time.
- Only Stop (and Esc) are live during a take; taps on the score do nothing.

### 5.5 Results

#### 5.5.1 Layout and header

`lg`/`xl`: score left (8 columns) in review rendering; results panel right (4 columns, min 340). Phones: results panel first, then the score as a natural-order scroll.

Header credit line (all structured fields, formatted by `en.json`, written key first per R1):

`{composer} ({dates}) · {work}, {catalog} · bars {a}–{b} · {licenceShort}`, for example "Schubert (1797–1828) · Heidenröslein, D 257 · bars 1–8 · CC0". For CC BY items the line also ends "· {corpus} · Adapted". Tapping the line opens the source sheet (5.12).

```
+--------------------------------------------------------------------------------------+
| < Home    Schubert (1797–1828) · Heidenröslein, D 257 · bars 1–8 · CC0                |
+--------------------------------------------------------------------------------------+
| +--------------------------------------------------+ +-----------------------------+ |
| | heat: ▁ ▁ ▃ ▁ | ▁ ▆ ▁ ▁ | ...                     | |   B        85 / 100         | |
| |  ###### annotated score, review style ######     | |   ★ ★ ☆    Ranked           | |
| |  ✓ ✓ ◂ ✓ ...                                     | |  Notes    ████████░░  86    | |
| |                                                  | |  In tune  █████████░  91    | |
| |  (Show: My take* / Clean score)                  | |  Rhythm   ████████░░  82    | |
| |  [◀ prev slip]  [next slip ▶]                    | |  Stops: 1 (bar 5, 2 beats)  | |
| +--------------------------------------------------+ |  Drifted 60 ms behind       | |
|                                                      |  42 notes · 35 right · ...  | |
|                                                      |  Tip: Missed key-signature  | |
|                                                      |  notes (bars 1, 3, 4)       | |
|                                                      |  +35 XP          (details)  | |
|                                                      |  Student [=========--] 79%  | |
|                                                      |  [    Next excerpt     ]    | |
|                                                      |  [ Try again (practice) ]   | |
|                                                      +-----------------------------+ |
+--------------------------------------------------------------------------------------+
```

#### 5.5.2 Grade block

- Letter (S to F) at 72 px, score at 32 px tabular, stars (3 + shine ring for S). Grade, stars and cutoffs are 02 §4.7's. Accessible name: "Grade B, 85 out of 100, 2 stars".
- The letter uses `--text`, stars `--star`. A low grade is information, not an error state.
- Badges:
  - "Ranked", or "Practice" with the reason from `rankedReasons` (one copy key per 02 §5.2 enum value; 10.2 lists them). Several reasons show the first, with the rest in the tooltip.
  - "Incomplete": "Fewer than half the notes came through, so this one's capped at 50."
  - "Timing may be offset" when the calibration method was `reported`.
  - "beta" when the instrument is beta.
- Void (01 `endReason: 'void'`): no grade; the void card for its `voidReason` (9.3) with [Check microphone] and [Try again].
- Practise without listening: "Not graded · no XP" and no grade block.
- A one-line ribbon above the grade for a personal best at this level on this instrument: "New best at level 5".

#### 5.5.3 Components and diagnostics

Three ComponentBars, in this order (02 §4.4):

| Label | Component | Explainer (on expand) | Rule |
| --- | --- | --- | --- |
| Notes | P | Right notes, and no extra ones. | always |
| In tune | I | How close your right notes were to the centre of the pitch. | Hidden for keyboard and guitar. "Not enough notes to judge" (no bar, no number) when fewer than 3 notes qualify. |
| Rhythm | R | Notes starting on time, and long notes held for their value. | Keyboard and guitar: "Notes starting on time." (no duration credit) |

- Each bar: label, 10 segments, value in tabular numerals, chevron that reveals the explainer and the counts behind it ("6 late, 2 early, typically 40 ms behind").
- The "focus" tag goes to the component with the most lost points, `w × (100 − value)` using the attempt's weights, never simply the lowest value.
- Diagnostics, as plain text lines under the bars and never as bars (02 §4.6): "Stops: 1 (bar 5, 2 beats)", "Drifted 60 ms behind by the end" (or "ahead"), "Restarted at bar 4 (6 notes replayed)". Omitted when empty.
- Counts line: "42 notes · 35 right · 3 early or late · 2 out of tune · 1 wrong note · 1 missed · 1 extra", from `diagnostics.counts`. Each count is a button that sets the slip stepper (6.5) to that verdict and jumps to its first instance. When notes were re-judged, the line ends with the button "2 notes re-judged after the take" (6.6).

#### 5.5.4 XP, rank and level

- Headline "+35 XP", expandable to the factor list returned by `grade/`: one line per factor whose value is not 1.00, labelled from `en.json` ("Level 5 base 34", "Score ×0.85", "Random key ×1.08", "Streak 6 days ×1.12", "Below your level ×0.25", "Over 60 takes today ×0.25"). No example totals are hand-written anywhere in copy.
- Practice attempt: "+8 XP (practice, 25%)". Repeat beyond the first of the day: "No XP: you've repeated this excerpt today." Incomplete: "No XP: fewer than half the notes came through." Void or not listening: no XP line.
- Rank bar: "Student · Rank 3 of 10 · 2,180 / 2,500 XP to Section player · needs level 4". Fill = `(xp − currentThreshold) / (nextThreshold − currentThreshold)` (79% in this example). When XP is reached but the minimum level is not, the bar is full and reads "Needs level 4 on any instrument". Values come from `progression.json`.
- Level cards (in the panel, never a modal), from `applyAttempt` progress events:
  - Offer: "You're reading level 5 well. Move up to level 6?" [Move up] [Stay at 5]. Declining suppresses it for 5 ranked attempts; the copy never re-offers sooner.
  - Auto level-up: "Moved up to level 6: 8 takes in a row at 90 or more." [Undo].
  - Level-down suggestion: "Level 6 has been a stretch lately. A few takes at level 5 can build the reading back up." [Go to level 5] [Stay at 6]. Never automatic.
- Rank-up: the rank-up card (5.10) after the panel settles.

#### 5.5.5 Actions

- Primary [Next excerpt] (Enter, N): tips interstitial, then scan.
- Secondary [Try again (practice)] (R): scan of the same excerpt, cover skipped. Tooltip: "Practice. Repeats earn a little XP the first time each day, then none."

Acceptance: every value, count and verdict on results comes from the final judgments in the `AttemptRecord`; reopening from History renders identically (pixel snapshot equal); the results screen is fully keyboard operable (8.3); the rank fill reproduces the formula for 5 fixture profiles.

### 5.6 Tips interstitial

Full-screen card on phones, centred 640 px card on desktop over a dimmed Home.

```
+--------------------------------------------------------------+
|  Before the next one                                (1 of 2) |
|  Tpt  Trumpet · Notes                                        |
|  Missed key-signature notes                                  |
|  Key-signature notes were missed (for example F instead of   |
|  F♯). Before you start, name the key and its altered notes   |
|  out loud ("D major: F♯ and C♯").                            |
|  Seen in bars 1, 3, 4.                                       |
|  ----------------------------------------------------------  |
|  Also: Fell behind the click                      (expand)   |
|  [   Next excerpt   ]          Done for now                  |
|  [x] Show tips between exercises                             |
+--------------------------------------------------------------+
```

- Content is 02 §6.1's choice: a primary tip and at most one secondary (never more than 2). Header: instrument abbreviation, name, and the pattern's dimension from `tips.json` (Notes, In tune, Rhythm, Flow). Headline: the pattern name from `tips.json`. Body: the tip text.
- Evidence line: the pattern's `evidenceTemplate` if present, else "Seen in bars {bars}." from the pattern's bars.
- Only E30 fired: one "Clean read" card with tip U18.
- Incomplete attempt: only E6 may fire, plus "That one got away. Keep the beat going next time, even through slips."
- No auto-advance. Enter = Next excerpt. With "Show tips between exercises" off, the interstitial is skipped and the tip stays as the one-line preview on results.

Acceptance: never more than 2 tips; the evidence line always has at least one bar number; text comes only from `tips.json`.

### 5.7 Progress

Route `#/progress`. Two columns on `lg`/`xl`, one column on phones in this order.

1. **Rank header**: emblem 64 px, rank name, "Rank 3 of 10", XP total, the rank bar from 5.5.4.
2. **Ladder**: 10 emblems, horizontal on desktop and vertical on phones. Achieved: filled, with date. Current: ringed in `--accent`. Future: outlined, with XP and minimum level from `progression.json`. Rank never goes down, so there is no "at risk" UI.
3. **Instruments**: one card per played instrument: name, "Level 5", the level window as 5 squares with the last 5 ranked scores (a check glyph when ≥ 85, a small tempo tick when played at or above the level's mid tempo, per 02 §5.6), best score per level, ranked attempts.
4. **Streak**: "Streak 6 days (best 21)" and "A streak day needs 3 ranked takes." No freezes in v1.
5. **Common slips**: up to 5 rows from `patternCounts` over this instrument: pattern name from `tips.json` and "9 times". Fewer than 3 attempts: the empty state in 9.1.

### 5.8 History

- List grouped by local day ("Today", "Yesterday", "Mon 16 Nov"), newest first, virtualised beyond 100 rows. Row (56 px desktop, 72 px phone): grade letter in a 32 px square (or "–" for void and not graded), score, title and composer (ellipsis, full on hover/focus), instrument, level, written key and meter, tempo, Ranked/Practice chip, time.
- Filters: instrument select and a "Ranked only" toggle, kept in the URL query. On phones they sit in a [Filter] sheet.
- `#/history/:attemptId` is the results screen read-only, with the full header and source sheet, and one action: [Play this excerpt again (practice)].

### 5.9 Calibration and audio self-test

One card, max 560 wide, used in onboarding, Settings > Audio, banners, and results prompts.

1. **Setup row**: input device select; Output (Speakers, Wired headphones, Bluetooth). Speakers use loopback; headphone modes use play-along (01 §7.8).
2. **Loopback**: "Stay quiet for about 8 seconds while we time the clicks." [Start]. Ten dots fill as clicks are found; a missed click shows a hollow dot with a slash. Success: "Your setup adds 42 ms. We'll correct for it." with "± 2 ms" in small text.
3. **Play-along**: "Play a short note on each click. 8 clicks." Dots plus a "Play now" pulse; each detected note fills a dot and shows a tick left or right of centre for its offset.
4. **Audibility check** (after success on speakers): "Can you hear the click clearly while you play a note?" [Yes] [Not really]. "Not really" suggests "Try the Wood click, or wired headphones." and links to Click sound.
5. **Failures**: loopback failed → "We couldn't hear the clicks. Turn up the volume, or play along instead." [Try again] [Play along instead]. Play-along failed twice → [Use an estimate] with "Timing can't be trusted with an estimate, so takes won't earn XP until you calibrate."
6. **Warnings**: RTL above 120 ms → "This looks like Bluetooth audio, which adds a lot of delay. Takes won't earn XP. Wired headphones or built-in speakers work better." On iOS add: "AirPods microphones reduce accuracy. Use the iPhone mic." AEC suspected → "Your device seems to be filtering the microphone, which can hide quiet notes and blur timing."
7. **Audio self-test** ([Check audio]): runs 01 §7.9's steps and shows a pass/fail list (Sanity tone, Clicks heard, Count-in recheck, Clock rate, Mic processing off, Screen refresh) and [Export diagnostics] (no audio).
8. On iOS the card shows "iOS: beta" under the title.

Rule: calibration never blocks a take on any platform. A take without a measured calibration is graded as practice with the reason badge "Calibrate to earn XP on this device" (02 `calibration`); 01's count-in recheck results that mark calibration stale show the results banner "Your audio delay changed. Recalibrate for fair timing." [Recalibrate].

Acceptance: results are stored per `routeKey`; a missing or stale calibration never disables Start; every failure string names a next step.

### 5.10 Sheets and modals

- **Stop confirm** (the Stop button; Esc stops at once without it):
  - Ranked, before the first detected note: "Restart the count-in?" [Restart] (default) [Stop]. The first restart stays ranked; a second Stop before the first note voids the take (02 §5.3).
  - Ranked, after the first note: "Stop now? This take will be scored as it stands." [Keep playing] (default focus) [Stop].
  - Practice: "Stop this take? Stopped practice takes aren't scored." [Keep playing] [Stop].
  - All variants end with "That was: {credit}" once the excerpt has been shown.
- **Skip after reveal** (scan overflow or Back): "Skip this one? It counts as seen." plus, when the skip limit would be exceeded, "Your next excerpt will be practice: one skip per 5 ranked takes." [Skip] [Keep reading]. The skip toast ends with "That was: {credit}".
- **Rank-up card**: centred 400 px card, emblem 96 px, "New rank: Section player!" (`rankup.headline`), the next rank's requirement from `progression.json`, [Continue]. Once per rank. Never stacked with another sheet: it waits until any other sheet closes.
- **Session summary** (after "Done for now" or every 10 attempts): takes, average score, XP earned, best take (link), top 3 patterns with their tip headlines, streak status. If one pattern was primary in 3 of the last 5 attempts, a text-only focus card: "This week's focus: Missed key-signature notes." Actions [Keep going] [Finish].
- **iOS install coach mark** (once, in iOS Safari tab mode only, after the first graded attempt, never in the same results visit as the rank-up card): "Add Sightread to your Home Screen: tap Share, then Add to Home Screen. It keeps your progress safe and the screen awake." [Got it].
- Sheets and modals trap focus and restore it on close (8.3). No sheet opens during a take except the stop confirm, which the player opens.

### 5.11 Settings

Changes apply at once; a 2 s "Saved" toast only for data actions. Left section list (sticky) on `lg`/`xl`, one scrolling page on phones.

| Section | Settings (default first) |
| --- | --- |
| Profile | Your name |
| Audio | Input device; Output (Speakers, Wired headphones, Bluetooth); [Calibrate] with method, result and date; [Check audio]; Click sound (Tick, Wood; Wood only in headphone modes if 01's CI flag says so); metronome volume 0–100 (70); metronome (Audible, Count-in only); A4 reference 440 (415–446) |
| Display | Theme (System, Light, Dark); Live feedback (Full, After the take); Show cents and milliseconds in review (on) |
| Practice | Show STARS checklist (on); Show tips between exercises (on); Show beta instruments (off); [Run placement again] |
| Accessibility | Reduce motion (System, On, Off); High contrast (off); Keyboard shortcuts (on); Announce results automatically (on); [Keyboard shortcuts list] |
| Data | Export all data (JSON); Import; Delete all data (typed confirmation "delete"); Storage used; [Download all music for offline] |
| About | App, corpus and config versions; Credits; "Audio never leaves this device. Nothing is recorded."; on iOS "iOS: beta" |

- "Live feedback: After the take" hides the overlay during the take and reveals everything in review. Full is the default and cannot be weakened (R11).
- "Count-in only" earns 02's `m_mode` from L4; the setup XP hint says so.
- Theme changes are disabled during a take.

### 5.12 Attribution and credits

Placement (03 §9.1, adjusted so the title never cues familiarity before the take; CC0 and PD need no attribution, and CC BY 4.0 is met by a non-identifying source line while the work is shown plus full TASL after the take):

| Where | What |
| --- | --- |
| Scan cover and scanning | No title or composer. CC BY items: the source line (5.3). Overflow "About this music (shows title and composer)" opens the source sheet; opening it changes nothing about ranked status. |
| Performance | CC BY items: the source line in the status line (or the toolbar right edge on short viewports). Nothing else. |
| Stop and skip | "That was: {credit}". |
| Results header, attempt detail | The credit line (5.5.1); tap opens the source sheet. |
| History rows | Title and composer. |
| Credits page `#/credits` | From `attributions.json`: every collection with licence and link ("OpenScore Lieder", "OpenScore String Quartets", "Mutopia Project"); a TASL entry with modification notice for every CC BY item; licence texts linked; "Report a rights problem" mailto; no logos and no endorsement wording. Reachable from Settings > About and the Home footer. |

Source sheet rows: Composer, Work, Bars, Edition, Encoder, Collection (corpus), Licence (name linked to `licenseUrl`), Source (link to `sourceUrl`), and the Adapted line built at runtime from `modifications` plus the transposition, written key first: "Adapted: excerpted, note values doubled, transposed. Written for E♭ alto saxophone in G major (concert B♭ major)."

The UI builds all credit text from 03's structured `source` fields (01 §6.1) through `en.json` templates; it does not display the pipeline's prebuilt `attribution` string. There is no lyricist line (R8) and no share-alike notice (no BY-SA, R8). Any later export must embed the attribution.

---

## 6. Real-time feedback rendering

01 §9.9 defines the events and their order; 02 §4.8 defines the verdict rules and thresholds; this section defines the look, frozen as data in `src/notation/visual-states.ts`. All marks live in the per-system overlay groups; the static VexFlow SVG is never re-rendered during a take. `ScoreView.setNoteState` writes the state as `data-phase`, `data-timing`, `data-pitch`, `data-provisional`, `data-marginal`, `data-rejudged` on the note `<g>`; repeated calls for the same note are idempotent updates (01 sends up to 3 `judgment` events per note).

### 6.1 Note visual states (`visual-states.ts`)

```ts
export type OverlayMode = 'live' | 'review' | 'blind';
export interface NoteVisual {
  noteClass: 'n-ink' | 'n-correct' | 'n-error' | 'n-error-hollow';
  ring: 'none' | 'active' | 'rejudged';
  laneGlyphs: GlyphId[];      // 0 to 2, top first
  fadeMs: number;             // colour change duration
}
export interface GhostVisual {
  style: 'ghost' | 'ghost-replay';
  arrow: 'up' | 'down' | null; offsetRight: boolean; stem: boolean; dashedLedgers: true;
  opacity: number; fadeMs: number; laneGlyph: GlyphId | null;
}
export function noteVisual(s: NoteVisualState, mode: OverlayMode, braked: boolean): NoteVisual;
export function ghostVisual(g: GhostNote, mode: OverlayMode, braked: boolean): GhostVisual;
```

"Error" means `phase: 'missed'`, or `phase: 'judged'` with `timing` in {early, late} or `pitch` in {sharp, flat, wrong-pitch, octave}.

| State (from `NoteVisualState`) | Live (Full) | Review | Ghost |
| --- | --- | --- | --- |
| `pending` | `n-ink`, no glyph | `n-ink` | none |
| `active` (note started, no verdict yet) | `n-ink` + 1.5 px `--active` ring | n/a | none, so a correct note never flickers |
| correct (judged, on-time, in-tune or not-graded, not marginal) | `n-ink` kept; lane `dot` (3 px, `--correct`) | `n-correct`; lane `check` | none |
| correct-marginal (`marginal: true`) | as correct, never red | `n-correct`; lane `check-marginal` in `--text-muted`; inspector gives the numbers | none |
| early / late | `n-error`; lane `early` ◂ / `late` ▸ | same | at the played x, written pitch |
| sharp / flat | `n-error`; lane `sharp` ▲ / `flat` ▼ | same; cents in the inspector | same staff position, offset right 1.1 notehead widths, 6 px `arrow-up` / `arrow-down` |
| wrong-pitch | `n-error`; lane `wrong` ✕ | same | at the played pitch, spelled per 02 §4.8 |
| octave (non-voice families only) | `n-error`; lane `octave` "8" | same | at the played pitch; beyond 4 ledger lines it is clamped with a 10 px "8va"/"8vb" label |
| voice octave displacement | correct (R7) | correct; inspector "Sung an octave lower (counts as right)" | none |
| missed | `n-error-hollow` (fill removed, 1.5 px stroke); lane `missed` ○ | same | none |
| combined timing + pitch | `n-error`; two glyphs, timing on top | same | one ghost with both |
| `rejudged: true` | n/a | final state + 2 px dashed `--text-muted` ring for the whole review | per 6.6 |

| Ghost kind (from `GhostNote`) | Style | Lane |
| --- | --- | --- |
| early, late, sharp, flat, wrong-pitch, octave | `ghost` | from the expected note's state |
| extra | `ghost` | `extra` + under the ghost; the expected notes do not change |
| `displaced: true` (replayed notes) | `ghost-replay`: 1.5 px dashed outline in `--ghost-replay`, no fill | `replay` ↺ under the ghost; never red on current notes; review groups them under a bracket "bars 5–6 replayed" |

Timings: note colour changes 100 ms linear; ghosts appear with an 80 ms opacity fade; reduced motion makes both instant. A provisional pitch error (`provisional: true`) may revert to correct before note-off with a 100 ms fade back; this is the only live reversal. Timing verdicts never revert during a take.

### 6.2 Ghost geometry

- Notehead: the Bravura black notehead path from the glyph sprite, outline only: 1.5 px `--ghost` stroke, `--ghost` fill at 15% (high contrast: 2.25 px, 30%).
- Live: no stem, no flag, no duration tail, no leader line. Review: stem in `--ghost` at 70%, duration tail (3 px bar at 35%), and a 1 px dotted leader with a 4 px arrowhead to the expected note when the gap is ≥ 1.5 notehead widths.
- Ledger lines for ghosts are dashed (2 on, 2 off) in `--ghost`.
- Accidental in `--ghost` left of the ghost whenever the spelling rule needs one, including courtesy naturals (target F♯, played F: ♮). Ghost accidentals are never dropped, even under the brake.
- x = `beatToPoint(ghost.scoreBeat)` for the played onset, so horizontal displacement is the timing error. A ghost in the next system is drawn there; a ghost before bar 1 is clamped to the left margin of system 1.
- Collisions: a ghost within 0.8 notehead widths and 1 staff step of another is offset right by 0.8 widths, down to 0.5 widths when space runs out. Overlap is allowed; omission is not.

### 6.3 Sequence and latency per note

| Event (01) | What appears | When (01 §10, §12) |
| --- | --- | --- |
| `note-start`, on time | active ring only | with the timing judgment |
| `judgment` with early or late | original red and the ghost at once | sound to visible p95 ≤ 150 ms (non-beta) |
| wrong pitch at confirmation | original red and the ghost at the played pitch | same budget in about 90% of notes, else after the steady window |
| sharp or flat (provisional, after 02's live window and hysteresis in `grading-config.json`) | original red, offset ghost with arrow | p95 ≤ 300 ms winds/brass/strings, ≤ 350 ms voice |
| `missed` | hollow red | expected onset + `W_i` + 01's confirm delay |
| extra | ghost and "+" | about onset + 100 ms rule + pipeline |

Marks are drawn at the played position whatever their arrival time. At L7 and 132 bpm a 300 ms pitch mark lands about 0.66 beat behind the playhead, still in the current bar or the one just left. The owner should be told that out-of-tune marks arrive about a third of a second after the note starts (01 §10).

### 6.4 Keeping the default ("Full") readable

Full is the default and shows every error (R11). These rules may simplify drawing; none may hide an early, late, wrong or out-of-tune note's red original or its ghost.

1. **Forward marks.** An overlay mark may sit right of the playhead only on the single next unplayed note that an early note matched, and only within that note's `W_i`. Its ghost is at the played position (the playhead). Static score, bar tint and the next-bar marker are not marks.
2. **Nothing moves.** Marks only appear (80 ms ghost fade, 100 ms fill). No tails, leaders or growing elements live.
3. **No text in the score frame.** No cents chip; out-of-tune shows as the offset ghost with an arrow; numbers are in review only. Status text lives outside the frame (5.4.1).
4. **Correct is quiet.** Live correct notes stay `--ink` with a 3 px lane dot. Teal fill and ✓ come in review. So the only colour events in peripheral vision are errors.
5. **Fade the past.** Marks drop to 60% opacity once the playhead is one beat past their bar, and to 40% once their system is left. The current bar stays at 100%.
6. **Lead the eye.** Bar tint 8% (light) / 10% (dark) behind the ink; the next-bar marker from 75% of the bar.
7. **Ghosts are not printed notes**: violet outline, 15% fill, no stem, dashed ledgers.
8. **Verdict lane**: glyphs in a 20 px lane under each staff at 9 px live (12 px review, 14 px high contrast).
9. **Density brake** (a bar with more than 4 error states): in that bar ghosts appear without fade, ghost arrows are dropped, the lane shows one glyph per note (pitch before timing), and the bar's ghosts sit at 70% opacity. Every red original and every ghost and ghost accidental stays.
10. **Unmatched ghosts cap**: extra and replayed ghosts (no matched written note) are capped at 3 per bar live; beyond that the lane shows a `plus-n` glyph with the count. Review shows all. Matched-note ghosts are never capped.
11. **Budget**: up to 600 overlay nodes live, using `<use>` from the glyph sprite and one `<path>` per ledger set; opacity changes are applied per bar group.
12. **Coaching instead of hiding**: the scan cover says "Keep your eyes ahead. Every mark waits for you after the take."

"After the take" (blind) draws nothing in the overlay during the take: only the bar tint and beat dots.

### 6.5 Review rendering

Computed from the final judgments only.

- Notes take their final review classes (6.1). Ghosts are opaque (100% stroke, 20% fill) with stems, tails and leaders. Replayed runs get a bracket above the staff: "bars 5–6 replayed".
- Heat strip, 6 px above each bar, from the bar's error share: 0: track only; ≤ 25%: hatch spacing 8 px; ≤ 50%: hatch spacing 4 px; > 50%: solid `--error` at 60%. Hatch lines are 1.5 px at 45° in `--error`. Hover or focus: "Bar 6: 2 of 5 notes off (1 late, 1 flat)".
- Toggle "Show: My take / Clean score" (C). Clean score hides the overlay and restores ink.
- Slip stepper: [◀ prev slip] [next slip ▶] step through error notes in time order (Shift+← / Shift+→). A count button or the re-judged button restricts the stepper to that set; "All slips" resets it.
- Note inspector (click or Enter on a focused note), a popover anchored to the note:

```
 +-------------------------------------+
 | Bar 6, beat 2                       |
 | Written  F♯5 (eighth)               |
 | Played   F♮5, 90 ms late            |
 | Late (partial credit)               |
 | Pattern: Missed key-signature notes |
 +-------------------------------------+
```

  - Timing in both units: "90 ms late (about a sixteenth)". The phrase uses the nearest of a 32nd, sixteenth, triplet eighth, eighth, quarter at the take tempo, or "less than a sixteenth".
  - Notes between tRed and tBad say "Late (partial credit)" or "Early (partial credit)" so a red note with credit does not look like a bug.
  - Marginal notes: "On time, 55 ms late (a little credit lost)".
  - Cents: "22 cents sharp" (voice: "relative to where you'd drifted"). With "Show cents and milliseconds" off, "sharp" or "late" without numbers.
  - Re-judged notes: "During the take this showed as late. Looking at the whole take, it was on time."
  - The pattern line comes from the pattern this note belongs to (`patterns[].notes`); omitted when none.

### 6.6 Live-to-final changes

01 gates divergence at ≤ 3% of notes on the synthetic suite.

- After "Scoring…", each note whose final state or ghost kind differs from live crossfades from its live look to its final look over 200 ms (instant with reduced motion). Ghost positions never move.
- Each such note keeps the 2 px dashed ring for the whole review.
- The counts line ends with the button "{n} notes re-judged after the take", which restricts the slip stepper to them.
- If more than 10% of the attempt's notes were re-judged, a results banner: "Several marks changed after the take. Check your mic position." and the attempt gets the diagnostic flag `manyRejudged`.
- Grade, components, XP and history use final judgments only.

### 6.7 Feedback acceptance

All automated (Playwright against 01's `fixtures/render/*.events.jsonl`, plus the trace budgets of 01 §12):

1. For every event in each render stream, the note's `data-*` attributes and drawn classes equal `noteVisual()` / `ghostVisual()` for that state; re-sending the same `judgment` changes nothing.
2. Ghost x within ±1 px of `beatToPoint` at the played onset.
3. Every overlay element's x ≤ playhead x + 1 px, except elements of the one note allowed by rule 1, which are ≤ playhead x + px(`W_i`).
4. Sharp by 38 cents: original red, ghost at the same staff position offset 1.1 widths with ▲, lane ▲, no text node in the score frame.
5. Target F♯ in E major played F: ghost shows ♮.
6. Missed: hollow red notehead, ○, no ghost. Extra in a rest: ghost and "+", the rest stays ink.
7. Voice an octave low: no red, no ghost, no "8".
8. Brake fixture (6 errors in one bar): every error note is red, every matched ghost is present.
9. Stress fixture: 200 ghosts + 200 lane glyphs hold 60 fps for 10 s (rAF trace, ≤ 6 ms main thread per frame).
10. End to end (Chromium fake capture): early/late and wrong-note red plus ghost visible ≤ 150 ms p95 after the sample-time onset; sharp/flat within 01 §12's budget.
11. No `aria-live` update between count-in start and the `end` event.

---

## 7. Design system (frozen in `design/tokens.json`)

`tokens.json` is the source; a generator writes `src/ui/tokens.css` (custom properties on `:root[data-theme]`, `[data-paper]`, `[data-contrast="high"]`) and `src/ui/tokens.ts` (typed constants for the overlay and tests). Stylelint bans hex, `rgb()`, `hsl()` and raw px values outside `tokens.css` (layout px in `layout-table.ts` are exempt).

### 7.1 Colour

Contrast ratios are WCAG relative-luminance ratios against the listed surface; a Vitest test recomputes every ratio from `tokens.json` and fails below the stated minimum.

UI tokens:

| Token | Light | Dark | Use / minimum |
| --- | --- | --- | --- |
| `--bg` | `#F6F5F1` | `#121418` | App background |
| `--surface` | `#FFFFFF` | `#1A1D22` | Cards, panels |
| `--surface-2` | `#EFEDE6` | `#22262C` | Inputs, segmented controls |
| `--surface-2-hover` | `#DEDCD6` | `#32363B` | surface-2 mixed 8% toward `--text` |
| `--surface-2-pressed` | `#D1D0CA` | `#3E4247` | mixed 14% |
| `--border` | `#D6D3CA` | `#323840` | Decorative hairlines |
| `--border-strong` | `#8E8A80` | `#6B727C` | Control boundaries, ≥ 3:1 |
| `--text` | `#1B1D21` | `#E9EBEE` | Body, ≥ 4.5:1 (16.9 / 14.2) |
| `--text-muted` | `#575C66` | `#A3A9B3` | Secondary, ≥ 4.5:1 (6.7 / 7.2) |
| `--accent` | `#2F4BD8` | `#8FA1FF` | Primary buttons, links (6.7 / 7.0) |
| `--accent-hover` | `#2D45C2` | `#9AAAFD` | mixed 12% toward `--text` |
| `--accent-pressed` | `#2B42B3` | `#A1B0FC` | mixed 20% |
| `--on-accent` | `#FFFFFF` | `#121418` | Text on accent, ≥ 4.5:1 in every accent state |
| `--focus-ring` | `#2F4BD8` | `#8FA1FF` | 2 px outline, 2 px offset |
| `--track` | `#E4E1D8` | `#2C3138` | Progress tracks |
| `--star` | `#8A6400` | `#E0B341` | Stars, streak (5.4 / 8.6) |
| `--caution` | `#8A6400` | `#E0B341` | Caution banners, always with an icon |
| `--danger` | `#C5300A` | `#FF7B52` | Destructive buttons, error banners |
| `--danger-hover` | `#B12E0D` | `#FC8865` | mixed 12% |
| `--danger-pressed` | `#A32C0F` | `#FB9171` | mixed 20% |
| `--on-danger` | `#FFFFFF` | `#121418` | 5.5 / 7.2 |
| `--toast-bg` / `--toast-text` | `#1B1D21` / `#FFFFFF` | `#E9EBEE` / `#121418` | Toasts |
| `--scrim` | `rgba(0,0,0,0.32)` | `rgba(0,0,0,0.56)` | Behind sheets and modals |

Disabled controls use 40% opacity on the whole control (WCAG exempts disabled controls from contrast).

Score tokens (dark theme always uses dark paper in v1):

| Token | Light paper | Dark paper | Ratio on paper (L / D) | Use |
| --- | --- | --- | --- | --- |
| `--paper` | `#FFFDF8` | `#1B1E23` | | Score background |
| `--ink` | `#1A1A1A` | `#ECE9E2` | 17.1 / 13.8 | Notation |
| `--staff-line` | `#7A7A7A` | `#8C9098` | 4.2 / 5.2 | Staff lines, barlines |
| `--correct` | `#00756A` | `#3FC7B4` | 5.5 / 8.0 | Correct notes, ✓, live dot |
| `--error` | `#C5300A` | `#FF7B52` | 5.4 / 6.5 | Any error ("red") |
| `--ghost` | `#7A3EC8` | `#BFA2FF` | 6.2 / 7.8 | Played notes |
| `--ghost-replay` | `#6B6B6B` | `#9AA0A8` | 5.2 / 6.3 | Replayed (displaced) ghosts |
| `--active` | `#1A1A1A` | `#ECE9E2` | | Active ring (shape, not hue) |
| `--playhead-bar` | `rgba(47,75,216,0.08)` | `rgba(143,161,255,0.10)` | | Current-bar tint |
| `--playhead-next` | `rgba(47,75,216,0.60)` | `rgba(143,161,255,0.60)` | | Next-bar marker, wrap bar |
| `--ink-accent-soft` | `rgba(47,75,216,0.18)` | `rgba(143,161,255,0.22)` | | Scan highlights |
| `--metro-active` | `#1A1A1A` | `#ECE9E2` | | Active beat dot |

Colour vision (CIE Lab ΔE between Machado 2009 simulated colours, light paper): correct vs error 104 normal, 43 protanopia, 60 deuteranopia, 111 tritanopia; ghost vs error ≥ 85 in every simulation; ghost vs correct ≥ 41; dark paper correct vs error ≥ 37. Correct and error have near-equal luminance, so in grayscale they are separated only by glyph and notehead shape, which 6.1 guarantees and 13.1 tests. The playhead is neutral because accent blue and ghost violet collapse under protanopia (ΔE 7).

High contrast (`[data-contrast="high"]`): `--error` `#A32100` / `#FF9A78`, `--correct` `#005A52` / `#6FE0D0`, ghost stroke 2.25 px, fill 30%, lane glyphs 14 px, error notes gain a 2 px bar under the notehead in `--error`.

Forced colours: `--ink` → `CanvasText`, `--paper` → `Canvas`, `--error` → `Mark`, `--ghost` → `LinkText`, `--correct` → `CanvasText`; glyphs carry the meaning.

### 7.2 Typography

- UI font: `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`. No web font. `font-variant-numeric: tabular-nums` on every updating number.
- Music: Bravura bundled with VexFlow 5 (01). Lane glyphs and ghost noteheads come from the sprite (7.4), never from fonts or emoji.

| Token | Size / line / weight | Use |
| --- | --- | --- |
| `--type-grade` | 72 / 1.0 / 700 | Grade letter |
| `--type-display` | 48 / 1.1 / 700 | Rank-up headline |
| `--type-count` | 32 / 1.0 / 700 | Count-in numbers |
| `--type-h1` | 32 / 1.2 / 650 | Screen titles, numeric score |
| `--type-h2` | 24 / 1.25 / 600 | Section titles, tip headline |
| `--type-h3` | 20 / 1.3 / 600 | Card titles |
| `--type-body` | 16 / 1.5 / 400 (600 for buttons) | Body, controls |
| `--type-small` | 14 / 1.45 / 400 | Secondary text, table cells |
| `--type-caption` | 12 / 1.35 / 500 | Badges, chips, system numbers |

Minimum text size is 12 px. Text scales with browser zoom to 200% (8.1).

### 7.3 Space, radius, elevation, z-index, motion, score geometry

- Space (4 px base): `--space-1` 4, `-2` 8, `-3` 12, `-4` 16, `-5` 24, `-6` 32, `-7` 48, `-8` 64.
- Radius: `--radius-s` 4 (chips), `-m` 8 (buttons, inputs, banners), `-l` 12 (cards, modals), `-xl` 20 (sheet top corners).
- Elevation: cards flat with `--border`; sheets, modals, popovers `0 8px 24px rgba(0,0,0,0.16)` light / `0 8px 24px rgba(0,0,0,0.5)` dark. The score frame has no shadow.
- z-index: base 0, sticky 10, sheet 40, popover 45, modal 50, toast 60.
- Motion: `--dur-instant` 0, `--dur-fast` 100, `--dur-base` 200, `--dur-slow` 320; `--ease-out` `cubic-bezier(0.2, 0, 0, 1)`, `--ease-in-out` `cubic-bezier(0.4, 0, 0.2, 1)`. During a take only colour and opacity change, except slot crossfades. Outside takes: screen transitions 200 ms fade plus 8 px slide; sheets and the results panel 240 ms slide.
- Reduced motion (`prefers-reduced-motion` or the setting): all durations 0 except 100 ms opacity fades on ghosts; slot swaps instant; beat dots change instantly with no ease-back; the 6.6 crossfade instant.
- Score geometry (group `score`): sp per layout row (4.2); lane 20 px; system gap 12 px; lane glyphs 9 / 12 / 14 px; ghost stroke 1.5 / 2.25 px; ghost fill 0.15 live, 0.20 review, 0.30 high contrast; replay ghost dash 3 on 2 off; past-mark opacity 0.6 / 0.4; braked ghost opacity 0.7; sharp/flat offset 1.1 notehead widths; collision offset 0.8, minimum 0.5; ring 1.5 px (active), 2 px dashed (re-judged).
- UI rules (group `ui`): `levelThinThreshold` 10, `meterChipMinExcerpts` 5, `noSignalHintMs` 3000, `swapDelayMs` 400, `swapLatestFraction` 0.5, `wrapSwapFraction` 0.75 (v = 1), `crossfadeMs` 160, `rejudgeBannerShare` 0.10, `unmatchedGhostCapPerBar` 3, `brakeErrorsPerBar` 4, `wakeLockIdleMs` 300000.

### 7.4 Glyphs and icons (`src/ui/glyphs.svg`, `src/ui/glyph-ids.ts`)

One SVG sprite, every symbol on a 24-unit viewBox, referenced with `<use href="#id">`, coloured by `currentColor`. `glyph-ids.ts` exports the `GlyphId` union.

- Verdict glyphs: `dot`, `check`, `check-marginal`, `early` ◂, `late` ▸, `sharp` ▲, `flat` ▼, `wrong` ✕, `missed` ○, `octave` 8, `extra` +, `replay` ↺, `plus-n` (+ with a slot for a number).
- Ghost parts: `ghost-head` (Bravura `noteheadBlack` path, SIL OFL; the OFL notice is added to `LICENSES/`), `arrow-up`, `arrow-down`, `ledger-dashed`.
- Rank emblems `rank-1` … `rank-10`, geometric: ranks 1–3 a circle with 1–3 inner rings; 4–6 a diamond with 1–3 inner bars; 7–9 a hexagon with 1–3 inner chevrons; 10 a star inside a hexagon. Stroke width = size / 32 (2 px at 64). Achieved: filled `--text`; current: ringed `--accent`; future: outlined `--border-strong`.
- UI icons: a pinned Lucide subset (ISC licence) copied as paths: `mic`, `mic-off`, `settings`, `dice`, `play`, `stop`, `chevron-down`, `chevron-left`, `chevron-right`, `x`, `info`, `alert-triangle`, `alert-octagon`, `check-circle`, `download`, `upload`, `trash`, `volume-2`, `headphones`, `bluetooth`, `flame` (streak). 20 px, 1.75 px stroke.
- Instrument marks are text (abbreviations in `en.json`) in a 40 px circle, `--surface-2` with a `--border-strong` outline. No silhouettes in v1.

### 7.5 Components (`src/ui/components/`)

Every component has a fixture on `#/dev/components` showing every state below. Heights are "fine pointer / coarse pointer". Focus is always a 2 px `--focus-ring` outline with 2 px offset; disabled is always 40% opacity with `aria-disabled`.

| Component | Props | Height | Padding | Radius | Font | Colours: default / hover / pressed |
| --- | --- | --- | --- | --- | --- | --- |
| Button primary | `label`, `icon?`, `size: compact\|default\|hero`, `loading?` | 36/44, 44/44, 56/56 | 0 16 (hero 0 24) | m | body 600 | bg `--accent`, text `--on-accent` / `--accent-hover` / `--accent-pressed` |
| Button secondary | same | same | same | m | body 600 | bg `--surface-2`, 1 px `--border-strong`, text `--text` / `--surface-2-hover` / `--surface-2-pressed` |
| Button tertiary | same | same | 0 8 | m | body 600 | text `--accent` / underline / text `--accent-pressed` |
| Button danger | same | same | same | m | body 600 | bg `--danger`, text `--on-danger` / `--danger-hover` / `--danger-pressed` |
| RandomChip | `pressed`, `onToggle` | 32 visual, 44 hit (coarse) | 0 12 | s | small 500 | 1 px `--border-strong`, text `--text-muted`; pressed: 1 px `--accent`, text `--accent`, bg `--surface-2` / bg `--surface-2-hover` / bg `--surface-2-pressed` |
| SegmentedControl | `options[{value,label,disabled?,tooltip?}]`, `value` | 36/44 | segment 0 12 | m | body | track `--surface-2` with 1 px `--border-strong`; selected segment `--surface`, 1 px `--border-strong`, text `--text` 600; others `--text-muted` / `--surface-2-hover` / `--surface-2-pressed` |
| Select | native `<select>` | 40/44 | 0 12 | m | body | bg `--surface`, 1 px `--border-strong` / 1 px `--text` |
| Stepper | `value`, `min`, `max`, `disabledValues?` | buttons 36/44 square, value field 56 wide | | m | body tabular | as Button secondary |
| TempoSlider | `value`, `min`, `max`, `beatUnit` | track 4, thumb 20, hit 44; field 72 wide | | full / m | body tabular | track `--track`, fill and thumb `--accent` |
| Toggle | `checked`, `label` | track 36 × 20, thumb 16, hit 44 | | full | body | off: track `--border-strong`; on: `--accent`; thumb `--surface` |
| Card | `children` | auto | 24 (`lg`+) / 16 | l | | bg `--surface`, 1 px `--border` |
| Banner | `tone: info\|caution\|danger`, `text`, `action?`, `dismissible?` | min 48 | 12 16 | m | small | bg `--surface`, 1 px `--border`, 4 px left bar in `--accent` / `--caution` / `--danger`, 20 px icon |
| Sheet | `side: bottom\|right`, `peek?` | peek 56; right sheet 400 wide | 16 / 24 | xl (top corners) | | bg `--surface`, elevation, `--scrim`, z 40 |
| Modal | `title`, `children` | auto, max width 560 | 24 | l | | bg `--surface`, elevation, `--scrim`, z 50 |
| Popover | `anchor`, `children` | auto, max width 320 | 12 | m | small | bg `--surface`, 1 px `--border-strong`, elevation, z 45 |
| Toast | `text`, `action?` | min 48 | 12 16 | m | small | `--toast-bg` / `--toast-text`; 4 s; z 60; never during a take |
| BeatDots | `beatsPerBar`, `grouping`, `currentBeat`, `countIn` | 32 (count numbers) | gap 8, group gap 16 | full | count | outline `--text-muted`, active `--metro-active` |
| LevelMeter | `levelDb`, `gateDb`, `clipping` | 8 × 64 | | s | | track `--track`, fill `--text-muted`, clip zone `--danger` + "!" |
| ScanTimer | `remainingSec`, `totalSec`, `mode: ranked\|practice` | 28 ring, 3 px stroke | | full | caption tabular | ring `--accent` on `--track`; 0 in practice: `check` glyph |
| ChecklistItem | `checked`, `title`, `detail`, `active` | min 44 | 8 12 | m | body / small | active: 3 px left bar `--accent` |
| GradeBadge | `grade`, `score`, `size: 32\|72` | 32 / 72 square | | m | caption 700 / grade | text `--text`, 1 px `--border-strong` |
| StarRow | `stars`, `shine` | 20 (lists), 28 (results) | gap 4 | | | filled `--star`; empty 1.5 px `--border-strong` outline |
| ComponentBar | `label`, `value \| null`, `explainer`, `focus?` | 44 | 0 | | body tabular | 10 segments 12 × 8, gap 2; filled `--text`, empty `--track` |
| HeatStrip | `share` per bar | 6 | | | | per 6.5 |
| VerdictGlyph | `id: GlyphId`, `size: 9\|12\|14` | | | | | `currentColor` |
| RankEmblem | `rank`, `state`, `size: 24\|64\|96` | | | | | per 7.4 |
| TipCard | `tip`, `secondary?` | auto | 24 / 16 | l | caption, h2, body, small | bg `--surface`, evidence `--text-muted` |
| EmptyState | `icon`, `title`, `body`, `action?` | auto | 32 | | h3, body | |
| ScoreFrame | `layout`, `slots` | fills | safe-area padding | 0 | | `--paper`; owns the system SVGs and `ScoreView` |

### 7.6 Theming

Tokens are CSS custom properties; VexFlow is rendered with classes and `currentColor` so theme changes need no re-render. If VexFlow 5 needs explicit colours, the static score re-renders on theme change outside takes only. `color-scheme: light dark` is set for native controls.

---

## 8. Accessibility

Target: WCAG 2.2 AA everywhere outside the take. The take itself needs an instrument, which is the product's purpose; everything around it is operable by keyboard and screen reader.

### 8.1 Checklist

- 1.1.1: each system SVG has `role="img"` and the frame has a summary label ("Excerpt, 10 bars, E major, 6/8, treble clef, dotted quarter equals 60"); a "Read the music as text" disclosure gives a bar-by-bar list.
- 1.3.1: setup rows are `<fieldset>`/`<legend>`; Random chips are `aria-pressed` buttons described by their row.
- 1.4.1, 1.4.3, 1.4.11: 6.1 and 7.1, enforced by the contrast and grayscale tests.
- 1.4.4, 1.4.10: 200% zoom and 320 px reflow on every screen except the score frame, which uses slots and keeps note size.
- 1.4.13: popovers stay while hovered, close with Esc.
- 2.1.1, 2.1.2: everything keyboard operable; modals trap focus and release it.
- 2.2.1: the ranked scan is a timed reading task. It meets 2.2.1 because the cover states the time and offers untimed Practice one tap away before the timer starts.
- 2.3.1: no flash above 3 per second (5.4.3).
- 2.4.3, 2.4.7, 2.4.11: logical order; focus never hidden under sticky bars (`scroll-padding` equals sticky heights).
- 2.5.7: no drag-only control (slider has a numeric field).
- 2.5.8: targets per 4.1 and 7.5.
- 3.3.1, 3.3.3: import and calibration errors say what went wrong and what to do.
- 4.1.3: live regions per 8.4.

### 8.2 Focus order

- Home: skip link "Start practice" → app bar → banner → rows top to bottom (control, then its Random chip) → Start → Today → Credits.
- Scan: toolbar (Home, Start scan or Start playing, overflow) → STARS items → helpers → text-alternative disclosure. Start playing has initial focus once the cover is removed.
- Performance: focus on Stop; nothing else is focusable.
- Results: initial focus on the grade heading → components → diagnostics → counts buttons → score note navigation → XP → level card → Next excerpt → Try again.

### 8.3 Keyboard

Single-key shortcuts work only outside text fields and can be turned off (WCAG 2.1.4).

| Key | Context | Action |
| --- | --- | --- |
| Space | Scan | Start scan, then Start playing |
| Enter | Scan, Results, Tips | Primary action |
| Esc | Performance | Stop at once (no sheet); same rules as 5.10 for scoring |
| Esc | Sheets, popovers, modals | Close |
| N | Results, Tips | Next excerpt |
| R | Results | Try again (practice) |
| ← / → | Results score | Previous / next note |
| Shift+← / Shift+→ | Results score | Previous / next slip |
| ↑ / ↓ | Results score | Previous / next system |
| Enter | Results score, note focused | Note inspector |
| C | Results | My take / Clean score |
| ? | Anywhere outside takes | Shortcut list |

During a take only Esc is live; Space does nothing, so a second press of Start cannot stop the take.

The review score is one tab stop with a roving `tabindex` over notes rendered as focusable `<g role="button">`, each with an `aria-label` such as "Bar 6, beat 2, written F sharp 5 eighth note, you played F natural 5, 90 milliseconds late, wrong note". Pitches are spoken through a `speakPitch()` helper ("F sharp 5").

### 8.4 Screen readers during a take

- Speech through speakers would be heard by the mic. Before the count-in, one polite announcement: "Count-in, then play. Press Escape to stop." The scan shows, for everyone, "Screen reader on? Use headphones so speech isn't heard as notes."
- From count-in start to the `end` event, no `aria-live` update fires; overlay changes are `aria-hidden`; beat dots and the meter are `aria-hidden`.
- At the end: "Take finished. Scoring." Then the grade heading takes focus ("Grade B, 85 out of 100, 2 stars. Ranked."). With "Announce results automatically" on, a polite region adds the focus component and the tip headline.

---

## 9. Empty, error, and permission states

### 9.1 Empty states

| Where | Title | Body | Action |
| --- | --- | --- | --- |
| Progress, no attempts | Your progress starts with one take | Play an excerpt and your score, level and rank show up here. | [Start practising] |
| History, no attempts | No takes yet | Every take you play is saved on this device. | [Start practising] |
| History, filters match nothing | No takes match these filters | Try another instrument, or show practice takes too. | [Clear filters] |
| Common slips, fewer than 3 attempts | Not enough takes yet | After a few takes we'll show the slips you make most. | none |
| Selector returns `empty-pool` (01 §6.3) | No excerpt fits these settings | Built from the selector's suggestions, for example "Level 2 has no unseen music in 3/4 for flute yet." | One button per suggestion ("Set time to Random", "Practise a seen excerpt") |

### 9.2 Microphone permission

Detection uses `getUserMedia` errors only; `permissions.query` is never relied on for the microphone.

| Case | Detection | UI |
| --- | --- | --- |
| Not yet asked | no stream yet | Pre-prompt card (5.1) |
| Denied | `NotAllowedError` | "Microphone is blocked. The app can't hear you play." Steps by browser: Chrome/Edge "Click the icon left of the address, set Microphone to Allow, then reload."; Safari macOS "Safari > Settings for This Website > Microphone > Allow."; iOS Safari tab "Tap aA in the address bar > Website Settings > Microphone > Allow, then reload. Or Settings > Apps > Safari > Microphone."; iOS home-screen app "Close and reopen the app, then tap Allow when asked."; Firefox "Click the crossed-out mic in the address bar, remove the block, then reload." [Try again] [Practise without listening] |
| No device | `NotFoundError` | "We can't find a microphone. Plug one in or check your system settings." [Try again] |
| Busy | `NotReadableError` | "Another app is using the microphone. Close it and try again." [Try again] |
| Insecure context | `!isSecureContext` | "The microphone only works on a secure (https) page." |
| Revoked mid-take | track `ended` | Void, `voidReason: device-change` card |

**Practise without listening** (R13): scan, metronome, count-in and bar highlight run with no capture. Results show the score and "Not graded · no XP"; history records it as not graded. The excerpt is marked seen. No self-assessment in v1.

### 9.3 Errors and void cards

| Case | Where | Copy | Action |
| --- | --- | --- | --- |
| Void `interrupted` (call, lock, app switch) | Results void card | The take was interrupted, so it wasn't graded. | [Try again] |
| Void `no-signal` | Results void card | We couldn't hear you, so this take wasn't graded. | [Check microphone] [Try again] |
| Void `device-change` | Results void card | The microphone or speakers changed during the take. Recalibrate, then try again. | [Recalibrate] |
| Void `backlog` or `capture-gap` | Results void card | This device fell behind while listening, so the take wasn't graded. Close other apps and try again. | [Try again] |
| Clipping > 20% of frames | Results banner | The mic was overloaded, so some notes may be misjudged. Move back a little or play softer. | none |
| Calibration missing or stale | Home banner | Calibrate once so timing grades are fair. It takes 8 seconds. | [Calibrate] |
| Recheck shift > 10 ms (01 §7.7) | Results banner | Your audio delay changed. Recalibrate for fair timing. | [Recalibrate] |
| Many re-judged notes (6.6) | Results banner | Several marks changed after the take. Check your mic position. | none |
| Bluetooth suspected | Home banner, calibration | as 5.9 item 6 | [Recalibrate] |
| Clock-rate mismatch twice | Full card | Audio setup problem. Please reload the page. | [Reload] |
| Storage loss (05 W12) | Home card | Your progress on this device was cleared by the browser. If you have a backup, import it. | [Import backup] [Start fresh] |
| Storage blocked or full | Toast after an attempt, then Settings > Data | This browser isn't saving your progress (private browsing or storage full). | [Export this take] |
| Corpus failed to load | Home full card | Couldn't load the music library. Check your connection; after the first visit it works offline. | [Retry] |
| Import file invalid | Settings > Data inline | That file isn't a Sightread backup. | none |
| No AudioWorklet | Full page | This browser can't run the listening engine. Use a recent Chrome, Edge, Firefox or Safari. | [Practise without listening] |

---

## 10. Copy

### 10.1 Rules

- Voice: a calm, encouraging teacher. Short sentences, second person, no exclamation marks except the rank-up headline. Notes can be wrong; the player never is. Musicians' terms (bar, beat, sharp, flat, rush, drag).
- Every string is in `src/ui/copy/en.json` with dotted keys (`results.badge.incomplete`). Placeholders use `{name}`; plurals use `{n, plural, one {...} other {...}}`. A 60-line in-house formatter supports exactly these two forms (no dependency). A lint rule (`react/jsx-no-literals` in `src/app` and `src/ui`) bans hard-coded strings.
- Strings that depend on other roles' data are templates: level descriptions, pattern names and tip text come from 02's config; credit fields from the excerpt. Copy never restates a number another role owns (no rank thresholds, XP totals or tolerances in prose).

### 10.2 Key strings

| Key | Copy |
| --- | --- |
| `welcome.headline` | Read it. Play it. See how it went. |
| `welcome.body` | Real music, a few bars at a time. We listen while you play and show you every note. |
| `calibrate.intro` | Your speakers and mic add a small delay. We'll measure it so "late" really means late. |
| `scan.cover` | Take a moment to read before you play. Keep your eyes ahead. Every mark waits for you after the take. |
| `scan.ranked.notice` | You'll have {seconds} seconds to read, then the count-in starts by itself. Want more time? Switch to Practice. |
| `scan.startingIn` | Starting in {n} |
| `scan.practice.timeUp` | Scan time's up. Start when ready. |
| `play.status.bar` | Bar {n} of {total} |
| `results.scoring` | Scoring… |
| `grade.S` … `grade.F` | Performance-ready. / Excellent read. / Solid. A few slips. / Passed. Keep going. / Rough one. Stay at this level for now. / This one was a stretch. Try an easier level? |
| `ranked.reason.practice-mode` | Practice mode. |
| `ranked.reason.seen-before` | You've seen this excerpt before, so it isn't sight reading any more. |
| `ranked.reason.scan-extended` | The scan ran past the level's time. |
| `ranked.reason.tempo-below-90pct` | The tempo was below this level's range. |
| `ranked.reason.visual-metronome` | Visual-only metronome. |
| `ranked.reason.calibration` | Calibrate to earn XP on this device. |
| `ranked.reason.measurement` | The audio check didn't pass for this take. |
| `ranked.reason.familiar` | This tune is widely known, so it's practice. |
| `ranked.reason.skip-limit` | This one came after a skip, so it's practice. |
| `results.practice.tooltip` | Practice. Repeats earn a little XP the first time each day, then none. |
| `results.rejudged` | {n, plural, one {# note re-judged after the take} other {# notes re-judged after the take}} |
| `results.rejudged.why` | Listening live has a fraction of a second to decide. After the take we look at the whole performance. |
| `credit.line` | {composer} ({dates}) · {work} · bars {a}–{b} · {licenceShort} |
| `credit.work` / `credit.workOnly` | {title}, {catalog} / {title} (the caller picks one and passes it as `{work}`) |
| `credit.source` | Typeset by {encoder} · {corpus} · CC BY 4.0 |
| `credit.that-was` | That was: {credit} |
| `credit.adapted` | Adapted: {modifications}. Written for {instrument} in {writtenKey} (concert {concertKey}). |
| `mod.*` | excerpted, grace notes removed, ornaments removed, final fermata removed, words removed, note values doubled, final bar completed, transposed, moved by an octave |
| `licence.*` | Public domain / CC0 / CC BY 4.0 |
| `corpus.*` | OpenScore Lieder / OpenScore String Quartets / Mutopia Project |
| `rankup.headline` | New rank: {rank}! |
| `streak.atRisk` | 1 more ranked take today keeps your {days}-day streak. |
| `verdict.*` | right, early, late, sharp, flat, wrong note, wrong octave, missed, extra note, replayed, held too short |

01's `RankedReason` type uses different names from 02's enum; copy is keyed by 02's enum (open question 1).

---

## 11. Reuse from ear-to-staff

| Piece | Decision |
| --- | --- |
| `style.css` palette | Replace with 7.1 (the teal, gold and red trio is not colour-blind safe as a set). |
| Beat dots and count-in label (`showBeat`, `.beats.countin`) | Adapt: compound grouping, flash limit, audio-clock timing. |
| Live notes drawn grey inside VexFlow (`notation.js`) | Replace with the overlay; VexFlow renders once per exercise. |
| VexFlow system loop in `renderScore` | Adapt as the start of per-system rendering. |
| Pitch trace canvas | Adapt for `#/dev/replay` only. |
| Status line (`#status`) | Reuse as the quiet status line. |
| History panel | Adapt into History; the GitHub save flow is dropped. |
| Written and concert key captions | Reuse the wording pattern (R1). |
| MusicXML export, print menu | Not in v1. |

---

## 12. Artefacts frozen in wave 0

These files exist before any screen work. After the freeze a change needs an RFC in `docs/rfc/` (01 §14).

| File | Contents | Check |
| --- | --- | --- |
| `design/tokens.json` → `src/ui/tokens.css`, `src/ui/tokens.ts` | 7.1 colours for light, dark, high contrast and forced colours; state tokens; type; space; radius; elevation; z-index; motion; breakpoints and the pointer rule; score geometry; component sizes from 7.5; `ui` rules | generator is deterministic; contrast test; stylelint |
| `src/ui/glyphs.svg`, `src/ui/glyph-ids.ts` | 7.4 sprite and the `GlyphId` union | every id in the union exists in the sprite and vice versa; every symbol has a 24-unit viewBox |
| `src/ui/copy/en.json` (+ typed `copy.ts` key union) | every string in this section, the `rankedReason` and `voidReason` strings, permission and error copy, credit templates, instrument abbreviations | every key used in code exists; no unused keys; formatter tests |
| `src/notation/visual-states.ts` | 6.1 as `noteVisual()` and `ghostVisual()` plus the brake and cap rules | exhaustive unit test over every `NoteVisualState` combination × mode × braked |
| `src/ui/layout-table.ts` | 4.2 rows, system geometry, `barsPerSystem`, `slotCount`, `planSwaps` (4.3) | the worked cases of 4.3 as unit tests |

---

## 13. Automated design checks and acceptance (no human approval, R3)

### 13.1 Checks in CI

1. Stylelint: no hex, `rgb()`, `hsl()` or raw px outside `tokens.css`; every `transition` and `animation` uses motion tokens and is gated by the reduced-motion rule.
2. Contrast: a Vitest test recomputes every pair in 7.1 from `tokens.json` (text ≥ 4.5:1, graphics and boundaries ≥ 3:1, each claimed ratio within 0.1).
3. Sizes: Playwright bounding boxes at every acceptance viewport: hero Start 56 px tall; every interactive element ≥ 44 × 44 under `hasTouch`; nothing under the injected safe-area insets; sticky Start clears `--sai-bottom` by 8 px.
4. Grayscale distinctness: on `#/dev/components` each pair of verdict states is rendered, a `grayscale(1)` filter applied, and the notehead-plus-lane box must differ by ≥ 8% of pixels.
5. axe-core: zero serious or critical issues on every non-performance screen in both themes.
6. Keyboard E2E: onboarding → take (fake capture) → results → next excerpt with no mouse.
7. Live-region spy: no `aria-live` update between count-in start and `end`.
8. Reduced motion E2E: no transform animation on any screen.
9. Snapshots: self-baselined Playwright snapshots per screen, theme and viewport, used only as regression baselines.

### 13.2 Acceptance viewports

1280 × 720, 1440 × 900, 1024 × 768 (laptop); 1180 × 760 and 1024 × 1366 (iPad); 844 × 340 and 390 × 660 (iPhone Safari tab, WebKit with `isMobile`, `hasTouch`); 390 × 844 with insets 47 / 34 (home-screen app). 8, 10 and 12 bar excerpts render without scrolling on all laptop and iPad viewports; phone viewports follow 4.3.

---

## 14. Work packages (v1)

Sizes: S under about 150 lines plus tests, M 150 to 400, L above 400. Ids D*; dependencies on 01's packages use their ids (P0a, P0b, P0d, P0f, P6, P7, P9b, P12, P14, P15, P16). Full acceptance is in the structured response; summary:

| Id | Package | Depends on | Size / difficulty |
| --- | --- | --- | --- |
| D0a | Tokens, generator, stylelint rule, contrast test | P0a | M / routine |
| D0b | Glyph sprite and ids | P0a | M / moderate |
| D0c | Copy catalogue, formatter, no-literals lint | P0a | M / routine |
| D0d | `visual-states.ts` | P0b | S / moderate |
| D0e | `layout-table.ts` with slot planning | P0b | S / moderate |
| D1 | UI shell: routes, app bar, tabs, theme, reduced motion, sheet/modal/popover/toast primitives, `#/dev/components` | D0a–D0c | M / moderate |
| D2a | Form and container components | D1 | M / routine |
| D2b | Domain display components | D1, D0b | M / moderate |
| D3 | ScoreFrame: slots, page turns, freeze and scale, system numbers | P7, P15, D0d, D0e | M / hard |
| D4 | Onboarding and calibration screens, self-test card | D2a, P14 | M / moderate |
| D5 | Home and setup | D2a, D2b, P9b | M / moderate |
| D6 | Scan | D3, D2b, P16 | M / moderate |
| D7 | Performance screen | D3, D2b, P16 | M / moderate |
| D8a | Results panel | D2b, P12, P0f | M / moderate |
| D8b | Review interactions | D3, D8a | M / hard |
| D9 | Tips, session summary, rank-up, stop and skip sheets, install coach mark | D2b, D8a | M / routine |
| D10 | Progress, History, attempt detail | D2b, D8a, P6 | M / moderate |
| D11 | Settings, Data, About, Credits, source sheet | D2a, P6 | M / routine |
| D12 | Permission, empty, error and void states; practise without listening UI | D4–D8a | M / routine |
| D13 | Design QA automation (13.1) | D1–D12 | M / moderate |

---

## Open questions (still open after the rulings)

1. **`RankedReason` names.** 02 §5.2 (owner) and 01 §6.5 (types) use different enum values. This section keys copy by 02's enum. 01's type should adopt 02's values.
2. **Live sharp/flat window.** 02 §4.8 states an 80 ms window with +10 cents hysteresis; 01 §8.4 and §10 cite a 150 ms window. The 400 ms slot-swap delay holds if sharp/flat p95 stays ≤ 350 ms either way; it is a `tokens.json` value and will be raised if 01's measured p95 exceeds 350 ms.
3. **End-of-take delay.** 02 says last note + 1 bar, 01 seeds 1 beat. The UI only reacts to `end`, so either works; the overlay waits on "Scoring…" for whatever the config says.
4. **Real Safari chrome heights and the iOS 26 floating bar** are unverified without a device; slot counts use injected insets. Revisit with the device matrix (later).

## Dependencies on other roles

- **01**: `countEligible(instrument, level, meter?)` and the selector's list of relaxed preferences (served length differs) for 5.2 and 5.3; `PracticeSession` support to cancel and restart a take during the count-in on rotation; strict scan auto-start; `status` events (`come-in-at`, `lost-place`, `no-signal`, count-in restart); `rejudged` per note; `diagnostics.counts`; `xp.factors`; per-system SVGs, `setSlotSystems`, total `beatToPoint`; a VexFlow render counter for tests; the end-to-end trace hooks of §12; a CI flag for "Wood only in headphone modes".
- **02**: `levels.json` descriptions, `tips.json` pattern names, dimensions and evidence templates (already in 02 revision 2); the `rankedReason` enum; incomplete and practice XP rules.
- **03**: structured `source` fields (01 §6.1), `extremes: { highId, lowId }` per excerpt for the Signs highlight, `attributions.json` for the credits page, the modification vocabulary.
- **05**: capability `outputLatencyReported`, install-coach and storage-loss triggers, Bluetooth and AirPods heuristics; the fork plan reuses these tokens, glyphs and copy.

---

# Part B — Later (not in this build)

Brief by design. Nothing below is built in v1.

- **Playback and export** (R9): "Play the score", "Play what I played", listen-back of any kind, MusicXML and image export (must embed attribution), "Report a problem with this excerpt".
- **Practice tools**: tip drills on sub-excerpts, [Show me] mini excerpt, remedial bias from the focus card, Rhythms highlight in the scan (needs per-bar rhythm difficulty from 03), starting note for non-voice practice takes.
- **Progress views**: score trend chart, 12-week streak calendar, streak freezes, review filter chips (All, Pitch, Rhythm), history search and grade chips, per-take delete.
- **Profiles**: multiple local profiles per device (the data model is already per player, R5).
- **Notation and playhead options**: line playhead, playhead off, notation size Small/Large (browser zoom covers it), light paper in dark theme, live pitch dot, note names under notes, "Errors only" and "Calm" live modes, separate larger-glyph setting.
- **Metronome**: visual-only mode and the peripheral pulse, custom scan time, count-in length, subdivision and accent overrides.
- **Range**: extended-range setting, voice range check (02).
- **Assets and motion**: instrument silhouettes, XP count-up, S shine rotation, rank-up draw-in.
- **Practise without listening**: self-assessment buttons.
- **Validation**: manual VoiceOver and NVDA passes, device-matrix layout checks.
- **iOS fork** (R12): haptic metronome, native orientation lock, Dynamic Type mapping, Settings deep link, Capacitor permission flows.
- **Excluded by rulings**: lyrics (R8); swing, Web MIDI, polyphony, accounts, leaderboards, any backend (R9).

---

## Review log (revision 2)

Structure:
- Rewritten around v1 scope: a scope table (section 0), v1-only Part A, a brief Part B "Later". Owner table at the top; other roles' values are referenced by file and key, not restated.
- New sections: 4.3 slots and half-page turns, 4.4 freeze and resize, 5.12 attribution, 6.3 sequence and latency, 6.6 live-to-final, 12 frozen artefacts, 13 automated checks, 14 work packages.

Rulings applied:
- R1: key rows and the Adapted line put the written key first; concert key secondary.
- R2: grades, components, XP, rank and tips come from 02's config; the hand-written XP and rank examples were corrected (2,180 XP is Student, rank 3, 79% to Section player, needs level 4) and replaced by formulas; live and review read the same states.
- R3: designer approval and manual screen-reader passes removed from acceptance; replaced by 13.1; custom icons replaced by text abbreviations.
- R5: one player per device; rank and XP per player; level cards per instrument.
- R6: strict ranked scan with "Starting in 5" and auto count-in; the "+30 s" rule removed; custom scan time later.
- R7: voice octave displacement shows as correct (no red, no ghost, no "8"); reference tone plays before every voice count-in.
- R8: no lyrics line, no share-alike notice, modal excerpts only under Random key (from the selector).
- R9: playback, listen-back and export moved to Later.
- R10: React screens only; overlay outside React.
- R11: Full is the default; the density brake and "+n" rule no longer hide any matched-note error.
- R12: iOS Safari layouts, insets, wake lock and install coach mark in v1; haptics and native layouts later.
- R13: Practise without listening kept with no XP and no self-assessment; portrait takes use slots; landscape recommended in scan only.

My cross-examination answers applied:
- Q1: forward marks limited to the next matched note within `W_i`; per-note sequence (active ring, then red plus ghost); provisional pitch is the only live reversal; idempotent judgments; live-to-final crossfade, persistent ring, re-judged filter, inspector line, > 10% banner.
- Q2: no live text, tails or leaders; correct is quiet; fade the past at 60% and 40%; brake simplifies drawing only; collision minimum 0.5; 600-node budget with sprite `<use>`; Errors only cut.
- Q3: half-page turns with fixed slots, keep-behind, 400 ms swap delay, 160 ms crossfade, wrap marker, system numbers; phone review as a scroll; rotate hint in scan only.
- Q4: all 18 mismatches fixed (rank figures, XP factors, m_mode not tied to the playhead, strict scan, ranked reasons, incomplete and practice XP, focus by lost points, family explainers, voice octave, auto level-up card with Undo, streak rule, focus card in the session summary, generic evidence template, level-gated length and keys, partial-credit wording, level descriptions from config, pattern names from config). Note names under notes cut.
- Q5: wave-0 artefacts, state tokens, z-index, component size table, sprite instead of "SMuFL where available", automated checks.
- Q6: v1 screen list and cut list as in sections 0 and Part B.
- Q7: attribution placement; structured fields instead of the prebuilt string.
- Changed from my own answers: calibration is not mandatory on iOS (iOS and architect challenges, and 01 §7.8); the 5-component results became 3 components plus diagnostics (musician challenge); unmatched ghosts get a cap (musician challenge, modified); Space no longer stops a take; History "Play again" kept as a practice action.

Challenges answered (detail in the structured response): architect (forward marks, end-to-end acceptance, scope cuts, output and click settings, end rules, scan chip, lost-place styling) accepted, one with modification on iOS calibration; musician (brake, three components, strict scan, scope and skip/stop integrity, streak and end-of-take) accepted or accepted with modification, with the "Calm" mode and the 2 s "Get ready" rejected; researcher (CC BY source line, credit template, length preference and meter counts, scope cuts, STARS data) accepted or accepted with modification, with the Rhythms highlight moved to later; iOS (viewports, freeze, wake lock, never-block calibration, scope and permission copy) accepted.

Removed: SRF observations as claims, multi-profile UI, five-component breakdown, cents chip, live duration tails and leaders, density-brake ghost suppression, "+n" for matched ghosts, line and off playheads, notation size, light paper, live pitch dot, note names, Errors only, visual-only metronome, peripheral pulse, scan-time setting, count-in and subdivision settings, drill and Show me, focus [Practice this], trend chart, streak grid and freezes, filter chips, history search, grade chips and delete, playback, MusicXML export, self-assessment buttons, bespoke instrument icons, celebratory motion, old open questions 1 to 10.
