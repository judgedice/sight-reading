# 04 Product design: screens, feedback rendering, design system, accessibility

Owner: senior product designer. Readers: the overseer merging the spec, and the front-end implementers who will build every screen without mockups.

This section owns how the product looks, reads, moves, and speaks. It plugs into the architect's interfaces (01: `ScoreView`, `NoteVisualState`, `GhostNote`, `FollowerEvent`, `PracticeSession`) and the lead musician's rules (02: tolerances, live verdicts, grades, XP, rank, tips, the STARS scan routine). Where 01 and 02 disagree on a number, this section follows 02 for grading, XP, and rank (the lead musician owns them) and lists the conflict in "Open questions".

Conventions: px are CSS pixels. "sp" is the staff space (distance between two staff lines) after scaling. Tokens are written `--token-name`. Every hex value listed here is final for v1; implementers must not invent colours.

---

## 1. How Sight Reading Factory falls short, and what we do instead

Observations from using SRF as a student (verify against the current release before marketing copy uses any of this):

| SRF today | Consequence | This design |
| --- | --- | --- |
| Exercises are generated algorithmically from settings. | Lines are correct but aimless: no phrases, cadences, or sequences, so players learn to decode notes rather than read music. | Every exercise is a real 8 to 12 bar excerpt (03 corpus). Results show title, composer, and source after the take, so the player sees they just read Mozart or a Bach chorale tune. |
| The student practice flow does not listen. The player plays along and decides for themselves how it went. | No objective feedback and no record of improvement. Wrong accidentals and rushing go unnoticed. | The app listens on the microphone and marks every note live on the staff, then grades the take. |
| No view of how the performance lined up with the page. | Players cannot see whether they were early, late, sharp, or reading the wrong note. | Ghost notes show what was actually played, where it was played, at its real pitch. A review view lets the player step through every slip. |
| Settings form first, music second. Dense, desktop-era controls. | High friction before the first note; random settings are easy to miss. | One setup screen with sensible defaults, a "Random" chip on every parameter, and "Start" reachable in one click from home. |
| Little structure for the moments before and after playing. | Players skip the scan and never get specific advice. | A built-in scan step (STARS checklist and timer), and an instrument-specific tip between exercises, chosen from the errors just made. |
| Little sense of progress for a self-directed learner. | Weak motivation to return daily. | Score, letter grade, XP, a 10-step rank ladder, per-instrument level, and streaks. |
| Cramped on phones. | Practising with a phone on a music stand is awkward. | Phone landscape is a first-class performance layout; 8 to 12 bars fit without scrolling on laptop and tablet landscape, and phones get a page-turn layout that always shows the next system. |

---

## 2. Design principles

1. **The music is the interface.** During a take, the score takes at least 75% of the viewport. Nothing else moves except the playhead and the beat pulse.
2. **Feedback lands behind the eye, never in front of it.** Live marks appear only at or left of the playhead. Nothing is drawn on music the player has not reached yet.
3. **Show, then explain.** Live view shows that something was wrong. The review view explains what (cents, milliseconds, the expected note, the played note).
4. **Never colour alone.** Every verdict has a shape, a glyph, and text in review, as well as a colour.
5. **Silence while playing.** The app makes no sound during a take other than the metronome, and screen readers are not asked to speak, because the microphone would hear it.
6. **Musician's language.** "Late" and "a sixteenth behind", not "timing error 92 ms". Numbers are available, never forced.

---

## 3. Information architecture

### 3.1 Route map

Hash routes, so static hosting needs no rewrites. React screens map one-to-one to routes.

```
#/welcome            Onboarding (first run only; steps are sub-states, not routes)
#/                   Home = Setup (default landing after onboarding)
#/practice/scan      Pre-performance scan        } one "practice" flow;
#/practice/play      Performance (count-in, take) } Back from any of these
#/practice/results   Results and review           } returns to Home
#/practice/tips      Tips interstitial            }
#/progress           Progress and rank
#/history            History list
#/history/:attemptId Attempt detail (results screen, read-only)
#/settings           Settings (sections as anchors: #/settings/audio, /display, ...)
#/calibrate          Latency calibration (also reachable from onboarding and banners)
```

### 3.2 Navigation model

- Persistent app bar on every screen except `play`: brand at left; "Practice", "Progress", "History" tabs in the centre (desktop) or bottom tab bar (phone portrait); profile avatar and settings gear at right.
- During `play` the app bar is replaced by the performance toolbar (section 5.2). There is no navigation chrome during a take.
- Leaving `scan` or `play` with Back or a tab shows a confirm sheet only if a take is in progress ("Stop this take? It won't be graded."). Leaving `scan` before the take discards nothing worth confirming.

### 3.3 Practice loop state flow

```
Home/Setup --Start--> Scan --Start playing / Space--> Count-in --> Take --> (finishing ≤ 1.5 s)
    ^                   |                                            |          |
    |                   +--Skip this excerpt--> (new excerpt) Scan   |          v
    |                                                     Esc/Stop --+     Results (review)
    |                                                                          |  Next excerpt (primary)
    |                                                                          v
    +--------------------------- Done for now <---------------------------- Tips interstitial
                                                         Next excerpt ---> Scan (new excerpt)
                                                         Try again ------> Scan (same excerpt, practice)
```

- Tips come after results, before the next scan. Results already preview the primary tip in one line; the interstitial gives room for the full tip and its drill.
- Every 10 attempts, or when the player chooses "Done for now", the session summary sheet appears over Home (section 4.10).
- Session states from 01 (`loading`, `ready`, `count-in`, `performing`, `finishing`, `results`, `error`) drive which sub-view is visible. React reads them; it never drives the audio.

---

## 4. Layout system and breakpoints

| Breakpoint | Width | Typical device | Layout columns | Page margin | Gutter |
| --- | --- | --- | --- | --- | --- |
| `xs` | < 568 | phone portrait | 4 | 16 | 12 |
| `sm` | 568–767 | phone landscape, small tablet | 8 | 16 (plus safe-area insets) | 12 |
| `md` | 768–1023 | tablet portrait | 8 | 24 | 16 |
| `lg` | 1024–1439 | laptop, tablet landscape | 12 | 32 | 24 |
| `xl` | ≥ 1440 | desktop | 12, content max 1360 wide | auto | 24 |

Height matters as much as width for the performance screen. The "short" modifier applies when viewport height is below 500 px (phone landscape): app chrome shrinks to a 44 px toolbar and all non-score panels move into sheets.

All screens other than performance use a centred content column of max 1120 px (`lg`/`xl`) with the 12-column grid.

---

## 5. Screens

Each screen lists purpose, layout, components, states, and acceptance criteria. Wireframes use: `[ ]` button, `( )` chip, `<>` select, `[x]` checkbox, `###` the score.

### 5.1 Onboarding

Five steps in one route, shown as a centred card (max 560 wide) with a step indicator ("Step 2 of 5") and Back. Each step is skippable except instrument choice.

**Step 1, welcome.** Headline, one sentence, a name field (optional, default "Player"), [Get started]. Copy in section 11.

**Step 2, instrument.** Grid of instrument cards grouped by family (Voice, Woodwinds, Brass, Strings, Keyboard and guitar). Card: icon, name, transposition note ("B♭, sounds a major 2nd lower"), "beta" badge where 02 marks beta. Voice opens a second row: Soprano, Alto, Tenor, Baritone/Bass. Piano asks right hand or left hand; guitar shows "single line". Cards are radio buttons (one choice, arrow keys move). Desktop 4 per row, phone 2 per row.

**Step 3, microphone pre-prompt.** Before the browser prompt, explain why and what happens:

```
+------------------------------------------------------+
|  Step 3 of 5                                          |
|        (mic icon, 48px)                               |
|  Let the app hear you play                            |
|  We listen while you play so we can mark each note.   |
|  Sound is analysed on this device and never           |
|  recorded or uploaded.                                |
|                                                       |
|  Tip: headphones keep the metronome out of the mic.   |
|  Built-in speakers work too.                          |
|                                                       |
|  [ Allow microphone ]        Not now                  |
+------------------------------------------------------+
```

[Allow microphone] calls `getUserMedia`. Outcomes: granted, go to step 4; denied, show the permission-denied state (section 9.2) inline in the card with browser-specific steps; "Not now", go to step 5 with a persistent "Microphone off" banner on Home.

**Step 4, latency calibration.** See 5.9 (same component, embedded). Default method is loopback.

**Step 5, level.** Two large options: "Find my level (3 short excerpts, about 3 minutes)" (recommended, primary) and "I'll choose" with a 1 to 10 level stepper and a one-line description of each level ("Level 3: quarters, eighths, dotted quarters, up to 2 sharps or flats"; text from 02 level table). Choosing placement goes to Scan with a "Placement 1 of 3" badge in the scan toolbar.

Acceptance: onboarding completes in ≤ 6 clicks with all defaults; the browser mic prompt never appears before the pre-prompt; the app is usable (Home, Settings, History) without microphone permission; a returning user never sees onboarding again unless they reset data.

### 5.2 Home and setup

Home is the setup screen. Returning players see their last settings already filled, so "Start" is one click.

Settings rows (each a labelled control with a trailing "Random" chip; when Random is on the control is disabled and shows "Random" in italic, and the chip is pressed):

| Row | Control | Options | Default |
| --- | --- | --- | --- |
| Instrument | select with family groups | from 02 | last used |
| Level | stepper 1–10 with description line | 1–10; Random picks L−1..L+1 (02 5.3) | suggested level |
| Key | select of written keys allowed at this level | major and minor keys within the level's accidental limit; disallowed keys are hidden, with a footnote "More keys unlock at level N" | Random |
| Time signature | segmented control of meters allowed at this level | from 02 level table | Random |
| Tempo | slider plus numeric field, bpm, beat unit shown ("♩ = 72", "♩. = 54") | level tempo range | level mid tempo |
| Length | segmented 8 / 10 / 12 | constrained by level (L1–L2: 8 only) | Random |
| Mode | segmented "Ranked" / "Practice" | ranked rules from 02 5.2 | Ranked |

- For transposing instruments the key row shows the concert key as secondary text: "E major (concert D major)". Key means the written key the player reads (01 open question 1; this design assumes it).
- XP hint under the settings: "Random key, meter, and tempo: +24% XP" (from 02 m_random), updated live.
- Below the settings, a "Today" strip: streak flame and day count, attempts today, XP today, rank progress bar (compact).
- Banners above settings when relevant: microphone off, calibration missing or stale, Bluetooth output detected, level-up offer pending.

Desktop (`lg`):

```
+--------------------------------------------------------------------------------------+
| Sightread   Practice  Progress  History                                  (P)  (gear) |
+--------------------------------------------------------------------------------------+
|  [i] Calibration is 41 days old for this mic.  [Recalibrate]                    [x]  |
|                                                                                      |
|  Practice                                                  +-----------------------+ |
|                                                            | Today                 | |
|  Instrument   <B♭ trumpet            v>                    | Streak 6 days         | |
|  Level        [-]  5  [+]   Dotted rhythms, 4 sharps/flats | 9 takes · 214 XP      | |
|               (Random)                                     | Section player        | |
|  Key          <E major (concert D)   v>        (Random*)   | [=========-----] 63%  | |
|  Time         (2/4)(3/4)(4/4)(6/8)(2/2)        (Random*)   | to Ensemble player    | |
|  Tempo        ♩ = [ 92 ]  |-----o--------|      (Random)   +-----------------------+ |
|  Length       ( 8 )( 10 )( 12 )                (Random*)   |
|  Mode         ( Ranked* )( Practice )                      | Last take             | |
|                                                            | B  84  · 2 min ago    | |
|  Random key and meter: +16% XP                             | [Review]              | |
|                                                            +-----------------------+ |
|  [        Start        ]   (56px tall, 320 wide)                                     |
+--------------------------------------------------------------------------------------+
```

Phone portrait (`xs`):

```
+--------------------------------------+
| Sightread                  (P) (gear)|
+--------------------------------------+
| Streak 6 · 214 XP today · Sect. plyr |
| [=========---------] 63%             |
|--------------------------------------|
| Instrument                           |
| <B♭ trumpet                       v> |
| Level              [-] 5 [+] (Rand)  |
| Dotted rhythms, 4 sharps or flats    |
| Key                         (Rand*)  |
| <Random                           v> |
| Time                        (Rand*)  |
| (2/4)(3/4)(4/4)(6/8)(2/2)            |
| Tempo ♩=92 |----o-----|     (Rand)   |
| Length (8)(10)(12)          (Rand*)  |
| Mode   (Ranked*)(Practice)           |
| Random key and meter: +16% XP        |
|                                      |
| [            Start             ]     |  sticky bottom, above tab bar
|--------------------------------------|
|  Practice    Progress    History     |
+--------------------------------------+
```

Acceptance: "Start" is reachable by keyboard within 2 Tab stops of page load (a "Start" skip-link is first in tab order); changing Level re-filters Key and Time options without losing a still-valid choice; with every row on Random the screen still shows what Random means ("Any key up to 4 sharps or flats").

### 5.3 Pre-performance scan

Purpose: run the STARS routine (02 section 7) before the take, with the music visible.

States: `covered` (music hidden, metadata visible), `scanning` (music visible, timer running), `ready` (timer done or ended early; still scanning allowed until Start).

- `covered`: the score frame shows a paper-coloured cover with the excerpt's key signature, time signature, tempo, bar count, and clef drawn large, plus [Start scan] (Space). Title and composer are not shown before the take (they could cue familiarity); they appear in results.
- `scanning`: the full score renders exactly as it will during the take (same layout, so the eye learns the page). A scan timer ring sits in the toolbar showing remaining seconds; at 0 it turns to a filled check and the label reads "Scan time's up. Start when ready." The timer never auto-starts the take.
- STARS checklist panel: five rows, each a checkbox with a one-line prompt; rows auto-tick at evenly spaced times across the scan (a 30 s scan ticks one row every 6 s) unless the player ticks them first. Ticking is optional and has no score effect. The active row has a left accent bar. Each row can highlight its target on the score when hovered or focused: Signatures pulses the key and time signatures; Accidentals outlines every accidental in `--ink-accent-soft`; Rhythms outlines the bar with the highest rhythm-difficulty score (from excerpt tags); Signs outlines the highest and lowest note. These highlights are drawn in the overlay layer and removed at Start.
- Helpers in the panel: [Hear the tempo] (plays one bar of clicks), [Starting note] (voice only: tonic triad then first note, allowed in ranked takes per 02 4.5; for other instruments this button is shown only in practice mode, because hearing the first pitch removes part of the reading task), [Tuning note] (winds, brass, strings; opens a 3 s tuning capture with a needle meter; shows the measured offset "You're 8¢ flat; we'll allow for that").
- [Start playing] primary (Space or Enter). [Skip this excerpt] tertiary (marks nothing, serves another).
- Ranked badge: "Ranked" chip in toolbar. If the scan exceeds level default + 30 s, the chip changes to "Practice (scan time exceeded)" with a tooltip; this follows 02 5.2.

Desktop:

```
+--------------------------------------------------------------------------------------+
| < Home   Level 5 · E major · 6/8 · ♩.=60 · 10 bars   (Ranked)   (o 0:24)   [Start ▶] |
+--------------------------------------------------------------------------------------+
| +-----------------------------------------------------------------+ +--------------+ |
| |  ###########################################################   | | Scan (STARS) | |
| |  ###########################################################   | |[x] Signatures| |
| |                                                                 | |    E major,  | |
| |  ###########################################################   | |    4 sharps; | |
| |  ###########################################################   | |    6/8 in 2  | |
| |                                                                 | |[x] Tempo     | |
| |  ###########################################################   | |[ ]Accidentals| |
| |                                                                 | |[ ] Rhythms   | |
| +-----------------------------------------------------------------+ |[ ] Signs     | |
|                                                                     |--------------| |
|                                                                     |[Hear tempo]  | |
|                                                                     |[Tuning note] | |
|                                                                     |Skip excerpt  | |
|                                                                     +--------------+ |
+--------------------------------------------------------------------------------------+
```

The STARS panel is 280 px wide on `lg`/`xl`, sits right of the score, and the score frame width shrinks to fit (the score layout is computed for the performance width, which is the full width, and scaled down by CSS transform during scan so the page geometry is identical). On `md` and below the panel is a bottom sheet with a peek height of 56 px showing "Scan · 3 of 5" and the timer.

Acceptance: the score geometry (systems, bar breaks, note positions) during scan is identical to the performance screen; the Signatures row text is generated from the excerpt ("E major, 4 sharps: F♯ C♯ G♯ D♯. 6/8, felt in 2."); no checklist highlight remains when the count-in starts.

### 5.4 Performance

This is the core screen. Section 6 specifies feedback rendering; this subsection covers layout, playhead, count-in, and the metronome visual.

#### 5.4.1 Regions

1. **Performance toolbar** (top, 56 px; 44 px on short viewports): left [■ Stop] (Esc), centre the metronome strip, right the input level meter and the "Ranked/Practice" chip. Nothing else.
2. **Score frame**: the paper surface with all systems. Fills the remaining height. No scrolling on `lg`, `xl`, and `md` landscape.
3. **Status line** (bottom, 28 px, `md` and up only): one line of quiet text, for example "Bar 4 of 10" and the tempo. Hidden on short viewports.

No sidebars, no buttons inside the score frame, no tooltips during the take.

#### 5.4.2 Staff layout across breakpoints

The notation module lays out the excerpt once per exercise (01 `RenderOptions`). Rules for bars per system and scale:

| Viewport | Bars per system | Systems for 8 / 10 / 12 bars | Staff space (sp) | Notes |
| --- | --- | --- | --- | --- |
| `xl` ≥ 1440 | `ceil(N / 2)`, max 6 | 2 (4+4) / 2 (5+5) / 2 (6+6) | 11 px | If any system would exceed 9 noteheads per bar on average, use 3 systems (`ceil(N / 3)` bars each). |
| `lg` 1024–1439 | 4 | 2 / 3 (4+3+3) / 3 | 10 px | Uneven splits put the extra bars in the first system. |
| `md` 768–1023 landscape-ish | 4 | 2 / 3 / 3 | 9 px | |
| `md` portrait | 3 | 3 (3+3+2) / 4 (3+3+2+2) / 4 | 9 px | Fits without scrolling on 1024 px tall tablets. |
| `sm` landscape (short) | 4 | 2 / 3 / 3 | 7.5 px, min 7 | Page-turn mode if all systems do not fit (5.4.3). |
| `xs` portrait | 2 | 4 / 5 / 6 | 7.5 px | Page-turn mode always; a "Rotate for a bigger page" hint shows in scan. |

- System height budget: 4 sp of staff plus 4 sp above and 4 sp below for ledger lines and ghost notes, plus the 20 px verdict lane (6.2) and 12 px gap. At 10 px sp: 152 px per system; 3 systems fit in 480 px.
- Widths are proportional to the number of tickables per bar with a minimum bar width of 14 sp. First bar of each system carries clef and key signature; the time signature appears only in the first system (and at meter changes).
- The score is drawn at the size chosen in Settings ("Notation size": Small 0.85, Normal 1.0, Large 1.2, applied to sp). If Large does not fit, the layout falls back to page-turn mode rather than shrinking.
- Phone landscape safe areas: left and right padding = `max(16px, env(safe-area-inset-left/right))`.

#### 5.4.3 Page-turn mode (when not all systems fit)

- Visible window: as many whole systems as fit; never a partial system.
- Rule: the window always shows the current system and at least one system after it. When the playhead passes 50% of the last visible system's duration, the window turns: the top systems are replaced so the current system becomes the top one. Turn is a 160 ms crossfade (instant with reduced motion). No scroll animation; the eye must not chase moving music.
- A thin page indicator ("Systems 2–3 of 5") sits at the right of the status line or, on short viewports, as 4 px dots at the right edge of the toolbar.
- Ghosts and states on systems that have scrolled out are kept and shown again in review.

#### 5.4.4 Count-in

- Default length from 02 section 7 (1 bar; 2 bars at L1–L3 and below 66 bpm). Pickup bars count in the full bar and start the take on the pickup beat.
- Visual: the metronome strip shows large beat numbers (32 px, `--font-numeric`) counting "1 2 3 4" (for 6/8 in 2: "1 2"; with L4–L5 subdivision clicks, small dots between numbers). A 4 px progress rail under the first bar of the score fills from left to right over the count-in, ending exactly at bar 1 beat 1 (or the pickup), so the eye is already on the first note.
- The score is fully visible during count-in. The first note gets the `active` treatment (6.1) at the last count-in beat.
- Text in status line: "Count-in" then "Play".

#### 5.4.5 Metronome visual

The metronome strip lives in the toolbar centre:

```
   ●  ○  ○  ○        Bar 4 · ♩ = 92        (speaker icon: audible | count-in only | visual)
```

- One dot per beat of the bar (compound meters: one dot per dotted beat; 5/8 and 7/8 group by the excerpt's beaming, for example 3+2 as "● ○ ○ | ● ○" with a tiny gap). Downbeat dot 12 px, others 8 px; dots are `--ink-muted` outline, the current beat fills with `--metro-active`.
- Beat pulse: the active dot fills for 90 ms then eases back to 60% fill until the next beat. Rate limit: no element may flash more than 3 times per second (WCAG 2.3.1). Above 180 beats per minute the pulse shows on every second beat; dots still advance.
- Peripheral pulse: a 3 px bar along the top edge of the score frame brightens on each downbeat only (opacity 0.25 to 0.6). Off by default; on by default when metronome mode is "visual" or "count-in only", because then the eye needs the pulse.
- Timing: visual beats are driven from the audio clock mapped to audible time (01 5.1), not from timers, so the dot changes when the click is heard.

#### 5.4.6 Playhead

Three styles (Settings, "Playhead"), default "Bar highlight":

- **Bar highlight** (default): the current bar has a background tint `--playhead-bar` spanning the staff height plus 2 sp above and below. When the playhead passes 75% of the current bar, the next bar gets a 3 px top-edge marker in `--playhead-next` ("look here next"). This leads the eye, as 02 section 7 asks, without a moving line over the notes.
- **Line**: a 2 px vertical line in `--playhead-line` at the current score beat, moving continuously (requestAnimationFrame, position from `beatToPoint`). Plus the same next-bar marker.
- **Off**: no playhead; metronome strip only. Unlocks the "count-in only" XP mode from L4 (02 5.3) when combined with count-in-only metronome.

The playhead never covers noteheads: the bar tint is behind the ink layer; the line is drawn under the overlay layer at 60% opacity.

#### 5.4.7 Input level meter

A 64 × 8 px horizontal bar right of the metronome strip, showing input level (from `live-pitch.levelDb`, 30 Hz). Three zones: too quiet (below gate), good, clipping (top 3 dB). Shape and text back up colour: the zone label appears as a tooltip and the clipping zone shows a "!" glyph when hit. If the level stays below the gate for 5 s after bar 1, the status line says "We can't hear you. Move closer to the mic?" (no modal mid-take).

Optional live pitch dot (Settings, "Show live pitch", off by default): a 6 px dot in `--ghost` that tracks the currently sounding pitch at the playhead x on the staff. It disappears on silence. Off by default because it is the most distracting element; on for singers who want it.

#### 5.4.8 Wireframes

Desktop (`lg`, 10 bars, 3 systems, bar highlight):

```
+--------------------------------------------------------------------------------------+
| [■ Stop]        ○ ● ○ ○   Bar 6 · ♩ = 92   (spk)            [|||||||   ] (Ranked)   |
+--------------------------------------------------------------------------------------+
|                                                                                      |
|  &  ####  4/4 | ♩ ♩ ♪♪ ♩ | ♩. ♪ ♩ ♩ | ♩ ♩ ♩ ♩ | 𝅗𝅥   ♩ ♩ |                                |
|                 ✓ ✓ ✓✓ ✓   ✓  ◂ ✓ ✓   ✓ ▲ ✓ ✓   ✓    ✓ ✓      <- verdict lane          |
|                                                                                      |
|  &  ####      |[♩ ♪♪ ♩ ♩]| ♩ ♩ 𝅗𝅥   | ♩ ♩ ♩ ♩ |                                       |
|                 ✓ ··                                    <- bar 6 tinted; bar 7 marker |
|                                                                                      |
|  &  ####      | ♩ ♩ ♩ ♩ | ♩. ♪ ♩ ♩ | 𝅝          ||                                    |
|                                                                                      |
+--------------------------------------------------------------------------------------+
| Bar 6 of 10                                                                ♩ = 92    |
+--------------------------------------------------------------------------------------+
```

Phone landscape (`sm` short, 10 bars, page-turn window of 2 systems):

```
+------------------------------------------------------------------+
|[■]    ○ ● ○ ○  Bar 6 ♩=92          [||||   ]   · ●  · (systems)  |
+------------------------------------------------------------------+
| & #### |[♩ ♪♪ ♩ ♩]| ♩ ♩ 𝅗𝅥 | ♩ ♩ ♩ ♩ | ♩. ♪ ♩ ♩ |                 |
|          ✓ ··                                                    |
| & #### | ♩ ♩ ♩ ♩ | 𝅝   ||                                         |
+------------------------------------------------------------------+
```

Phone portrait (`xs`, page-turn, 2 bars per system, 3 systems visible):

```
+--------------------------------------+
|[■]  ○ ● ○ ○  Bar 6   [|||  ]  2/5    |
+--------------------------------------+
| & #### | ♩ ♪♪ ♩ ♩ | ♩ ♩ 𝅗𝅥 |          |
| & #### | ♩ ♩ ♩ ♩ | ♩. ♪ ♩ ♩ |         |
| & #### | ♩ ♩ ♩ ♩ | 𝅝 ||               |
|                                      |
|   Rotate your phone for a bigger     |
|   page. (shown in scan only)         |
+--------------------------------------+
```

#### 5.4.9 End of take

- The take ends on the follower's `end` event (last note plus its duration plus 1 beat, or Stop, or 8 s of silence).
- `finishing` (≤ 1.5 s, the final realignment): the toolbar centre shows "Scoring…" with a small indeterminate bar. The live overlay stays as is.
- Then the screen transitions to Results in place: the score stays where it is (no navigation flash), the toolbar is replaced by the results header, and the overlay re-renders in review style (6.6). On `lg`/`xl` the results panel slides in from the right (240 ms; instant with reduced motion) and the score reflows narrower only after the panel arrives.

Acceptance (performance):
- No scrolling during a take on `md`, `lg`, `xl` for any 8 to 12 bar excerpt at Normal notation size.
- In page-turn mode, the system after the current one is always visible from the moment the current system starts.
- From a `judgment` event to the note's visual change: ≤ 1 animation frame plus 16 ms (≤ 33 ms) on a mid-range laptop.
- Nothing is drawn to the right of the playhead except the next-bar marker, the static score, and (in the first 120 ms of an onset) the ghost of the note being played.
- Screen stays awake during a take (Screen Wake Lock API where supported; ignore failure silently).

### 5.5 Results

Purpose: the grade, what drove it, the annotated score, and the way forward.

#### 5.5.1 Layout

Desktop (`lg`): score frame on the left (8 columns) in review rendering; results panel on the right (4 columns, min 340 px). Phone: results panel first (scrollable), annotated score below with a [Full screen score] button that opens the score in landscape review.

```
+--------------------------------------------------------------------------------------+
| < Home    Minuet in G, BWV Anh. 114 · J. S. Bach (attr. Petzold) · bars 1–8 · CC0   |
+--------------------------------------------------------------------------------------+
| +--------------------------------------------------+ +-----------------------------+ |
| | heat: ▁ ▁ ▃ ▁ | ▁ ▆ ▁ ▁ | ...  (per-bar strip)   | |   B        84 / 100         | |
| |  ###### annotated score, review style ######     | |   ★ ★ ☆    Ranked           | |
| |  ✓ ✓ ◂ ✓ ...                                     | |                             | |
| |  ###########################################     | |  Notes      ████████░░  88  | |
| |  ✓ ▲ ✓ ✓ ...                                     | |  In tune    ██████████  95  | |
| |                                                  | |  Rhythm     ███████░░░  74  | |
| |  (Filter) (All*)(Pitch)(Rhythm)   (Show: my take | |  Flow       █████████░  92  | |
| |   ◉ / clean score)    [◀ prev slip] [next slip ▶]| |  Steady     ████████░░  81  | |
| +--------------------------------------------------+ |                             | |
|                                                      |  You tend to arrive late on | |
|                                                      |  the note after a dotted    | |
|                                                      |  quarter. (tip preview)     | |
|                                                      |                             | |
|                                                      |  +34 XP   (details v)       | |
|                                                      |  Section player [=====--]   | |
|                                                      |                             | |
|                                                      |  [    Next excerpt     ]    | |
|                                                      |  [ Try again (practice) ]   | |
|                                                      +-----------------------------+ |
+--------------------------------------------------------------------------------------+
```

#### 5.5.2 Grade block

- Letter grade (S, A, B, C, D, F from 02 4.6) at 72 px, numeric score at 32 px tabular, stars row (3 stars, S adds a shine ring around the stars). Grade letter has an accessible name "Grade B, 84 out of 100, 2 stars".
- Grade colours are not semantic red/green. The letter uses `--text`; the stars use `--star`. A low grade must not look like an error state; it is information.
- Badges: "Ranked" or "Practice" (with reason on hover: "Practice: you've played this excerpt before"); "Incomplete" when fewer than half the notes matched (02 gate; shows "Score capped at 50"); "Timing may be offset" when calibration method was "reported".
- Void attempt (signal unusable): no grade; the block shows the error state from section 9 with [Check microphone] and [Try again].
- First take ever, personal best at a level, or a new grade tier gets a one-line "New best at level 5" ribbon above the grade.

#### 5.5.3 Component breakdown

Five rows, in this order, with plain names (internal ids from 02 4.3 in parentheses for implementers):

| Label | Component | One-line explainer (shown on expand) |
| --- | --- | --- |
| Notes | P, pitch accuracy | Right notes, including accidentals and key signature. |
| In tune | I, intonation | How close your right notes were to the centre of the pitch. Hidden for piano and guitar. |
| Rhythm | R, rhythm | Notes starting on time and held for their value. |
| Flow | C, continuity | Keeping going without stopping or going back. |
| Steady | T, tempo stability | Staying with the beat from start to finish. |

Each row: label, 10-segment bar (segments, not a smooth bar, so values read without colour), value in tabular numerals, and an expand chevron that reveals the explainer and the counts that drove it ("6 late, 2 early, average 40 ms behind"). Bars use `--text` fill on `--track`. The lowest component gets a small "focus" tag.

Counts summary line under the bars: "42 notes · 35 right · 3 early or late · 2 out of tune · 1 wrong note · 1 missed · 1 extra". Each count is a button that filters the score to that verdict and jumps to the first instance.

#### 5.5.4 XP and rank block

- "+34 XP" headline, expandable to the multiplier list from 02 5.3 ("Level 5 base 34 · score 0.84 · random key +8% · streak +12% · = 34").
- Rank progress bar to next rank, with "Needs level 5 on any instrument" when the XP is reached but the min level is not.
- Count-up animation from old to new XP over 600 ms (instant with reduced motion). Rank-up shows the rank-up moment (7.3) as an overlay after the count-up.
- Level-up or level-down offer (02 5.5), when triggered, appears as a card in this panel, not a modal: "You're reading level 5 well. Move to level 6?" [Move up] [Stay at 5]. Level-down copy is encouraging and never says "failed".

#### 5.5.5 Live-to-final correction

01 6.5 says final realignment can change up to about 3% of live judgments. When a note's final state differs from its live state, that note shows a 2 px dashed ring in `--text-muted` for 2 s after results appear, and the counts line ends with "2 notes re-judged after the take" (link: "Why?" tooltip: "Listening live has a few milliseconds to decide. After the take we look at the whole performance."). With reduced motion the ring is static and stays until the first interaction.

#### 5.5.6 Actions

- Primary: [Next excerpt] (Enter, N). Goes to the tips interstitial, then scan.
- Secondary: [Try again] labelled "(practice)" when the next take would be practice (always, by 02 5.2). Goes to scan with the same excerpt, skipping the cover.
- Tertiary links: "Play the score" (synth playback of the expected notes at the take tempo, with the playhead), "Play what I played" (synth playback of the detected notes; audio is never stored, the detected notes are), "Export MusicXML" (excerpt plus a second part with what was played, using the ear-to-staff exporter), "Report a problem with this excerpt".

Acceptance: every component value, count, and verdict on the results screen comes from the final judgments in the `AttemptRecord`; reopening the attempt from History renders identically; the screen is fully operable by keyboard (section 8.3).

### 5.6 Tips interstitial

Between results and the next scan. Full-screen card on phone, centred 640 px card on desktop over a dimmed Home background.

```
+--------------------------------------------------------------+
|  Before the next one                                (1 of 2) |
|                                                              |
|  (trumpet icon)  Trumpet · Rhythm                            |
|                                                              |
|  Late after dotted quarters                                  |
|  Count the "and" of the dotted note out loud in your head,   |
|  then place the eighth right on it. Tongue the eighth a      |
|  little lighter so it doesn't drag.                          |
|                                                              |
|  Why this tip: 4 of 5 eighths after a dotted quarter were    |
|  late (bars 2, 3, 6, 9).    [Show me]                        |
|                                                              |
|  [ Drill bars 2–3 at ♩ = 69 ]   (practice, 75% tempo)       |
|                                                              |
|  ----------------------------------------------------------  |
|  Also: Breathe in rhythm at the rest in bar 4.     (expand)  |
|                                                              |
|  [   Next excerpt   ]          Done for now                  |
|  [x] Show tips between exercises                             |
+--------------------------------------------------------------+
```

- Content: primary tip plus at most one secondary, from 02 6.1. Header shows instrument family and the dimension (Rhythm, Notes, In tune, Flow, Steady, Tone/Technique).
- "Why this tip" names the evidence with bar numbers; [Show me] opens a mini annotated excerpt of those bars (review rendering, 3 sp smaller) in place.
- Drill button runs a practice take of the cited bars at the drill tempo (02 tip `drill`), using the same scan-less flow (count-in starts immediately). After the drill, return to this card with a small result line ("Drill: 4 of 5 on time").
- Positive outcome (no pattern fired): one card "Clean read" with a tip to raise difficulty or tempo, and a [Try level 6] suggestion if applicable.
- Focus card (02 6.1 step 5): when the same pattern was primary in 3 of the last 5 attempts, a highlighted card "This week's focus: late after dotted rhythms" with a [Practice this] button that biases selection (02 `remedialBias`).
- No auto-advance. Enter = Next excerpt. "Show tips between exercises" off moves tips into the results panel only.

Acceptance: never more than 2 tips; tip text is plain text ≤ 280 characters (01 8); the evidence line always cites at least one bar number; the drill never counts as ranked.

### 5.7 Progress and rank

Route `#/progress`. Desktop two columns; phone single column in this order.

1. **Rank header**: current rank emblem (64 px), rank name, "Rank 4 of 10", XP total, progress bar to next rank with numbers ("2,180 / 2,500 XP to Ensemble player · needs level 5"). Rank never goes down, so there is no "at risk" UI.
2. **Rank ladder**: horizontal (desktop) or vertical (phone) list of all 10 ranks. Achieved ranks: filled emblem with achieved date. Current: ring plus pointer. Future: outline emblem with XP and min level. Emblems are geometric (section 7.3), not illustrations.
3. **Instruments**: one card per played instrument: name, level badge ("Level 5"), level-up window as 5 small squares holding the last 5 ranked scores (filled with the score number, squares ≥ 85 get a check glyph), best score per level, attempts count.
4. **Streak**: current and best streak, rest-day freezes banked (snowflake glyph × n), a 12-week calendar grid (7 rows × 12 columns, 12 px cells, 3 px gap). Cell fill steps: 0 takes, 1–2, 3–5 (a streak day per 02), 6–11, 12+. Days meeting the 3-ranked-take rule get a dot glyph in the cell, so streak days do not rely on fill shade.
5. **Score trend**: line chart of the last 30 ranked scores for the selected instrument, x = attempt number, y = 0–100, with grade bands as faint horizontal rules labelled S/A/B/C. Points are 4 px circles; level changes are vertical dashed rules labelled "L5 → L6". Includes a text alternative table (section 8).
6. **Common slips**: horizontal bars of the top 5 patterns by count over the last 30 days (from `patternCounts`), labelled in musician language ("Late after dotted rhythms", "Missed key-signature sharps"), each with a [Tip] link to the tip card.

```
+--------------------------------------------------------------------------------------+
| Progress                                                           <B♭ trumpet  v>   |
| +-----------------------------------+  +-------------------------------------------+ |
| | (◆) Section player   Rank 4 of 10 |  | Score trend (last 30 ranked)              | |
| | 2,180 / 2,500 XP · needs level 5  |  |  100 -S---------------------------------  | |
| | [=================------]         |  |   90 -A--------o----o--o----------o-----  | |
| +-----------------------------------+  |   80 -B---o--o---o-------o--o--o------o-  | |
| | Ladder  ◆ ◆ ◆ ◈ ◇ ◇ ◇ ◇ ◇ ◇      |  |   70 -C-o----------------¦--------------  | |
| +-----------------------------------+  |                       L5→L6              | |
| | B♭ trumpet  Level 5               |  +-------------------------------------------+ |
| | Last 5: [88✓][91✓][79][86✓][90✓]  |  | Common slips                              | |
| | Level up offered                  |  | Late after dotted rhythms   ██████ 14 [Tip]| |
| +-----------------------------------+  | Wrong partial (same valve)  ████ 9    [Tip]| |
| | Streak 6 days (best 21) ❄ x1      |  | Missed key-signature sharps ███ 6     [Tip]| |
| | [12-week grid]                    |  +-------------------------------------------+ |
| +-----------------------------------+                                                |
+--------------------------------------------------------------------------------------+
```

Empty state (no attempts): section 9.1.

### 5.8 History

Route `#/history`. A list of attempts grouped by local day ("Today", "Yesterday", "Mon 16 Nov"), newest first, virtualised beyond 100 rows.

Row (56 px desktop, 72 px phone): grade letter in a 32 px square, score, excerpt title and composer (truncated with ellipsis, full on hover/focus), instrument, level, key and meter, tempo, Ranked/Practice chip, time. Click or Enter opens `#/history/:attemptId`, the results screen read-only (actions: [Play this excerpt again (practice)], "Export MusicXML", "Delete this take").

Filters above the list: instrument select, "Ranked only" toggle, grade range chips (S–A, B–C, D–F), search by title or composer. Filters persist in the URL query.

Phone: filters collapse into a [Filter] button opening a sheet.

### 5.9 Latency calibration

Used in onboarding, from Settings > Audio, and from the "Recalibrate" banner. One card, max 560 wide.

Flow (01 5.7):

1. Device row: input device select and output description ("Built-in speakers" / "Headphones"). A toggle "I'm using headphones" switches the method to play-along (loopback cannot hear clicks through headphones).
2. Loopback: "Stay quiet for about 8 seconds while we time the clicks." [Start]. During: 10 dots fill as clicks are detected (a detected click fills its dot; a missed one shows a hollow dot with a slash). Result: "Your setup adds 42 ms. We'll correct for it." with spread ("± 2 ms") in small text.
3. Play-along (fallback or headphones): "Play a short note on each click. 8 clicks." Visual beat dots plus a large "Play now" pulse on each click; each detected note fills a dot and shows its offset as a short tick left or right of the dot centre.
4. Failure: if loopback fails, show "We couldn't hear the clicks. Turn up the volume, or play along instead." [Try again] [Play along instead]. If play-along also fails: [Use an estimate] (method "reported") with the warning "Timing grades may be off by a few hundredths of a second."
5. Warnings: RTL above 120 ms shows "This looks like Bluetooth audio, which adds a lot of delay. Wired headphones or built-in speakers work better." AGC detected shows "Your device is adjusting the mic level automatically, which can hide quiet notes."

Acceptance: calibration result is stored per device key; a stale or missing calibration never blocks a take (it degrades to "reported" with the badge on results).

### 5.10 Session summary, rank-up, and modals

- **Session summary sheet** (after "Done for now" or every 10 attempts): takes, average score, XP earned, best take (with link), top 3 slips of the session with tip links, streak status ("Streak safe for today" / "1 more ranked take to keep your streak"). Actions [Keep going] [Finish].
- **Rank-up overlay**: centred 400 px card, rank emblem at 96 px, "You're now an Ensemble player", the next rank's requirement, [Continue]. Focus moves to Continue; Esc closes. Shown once per rank.
- **Stop confirm** (leaving during a take): sheet with "Stop this take? It won't be graded." [Keep playing] (default focus) [Stop].
- Modals and sheets use the focus-trap and restore rules in section 8.3. No modal ever opens during a take except the stop confirm, which the player initiates.

### 5.11 Settings

Route `#/settings`, left section list on `lg`/`xl` (sticky), single scrolling page with section headings on phone. Changes apply immediately (no Save button) and show a 2 s "Saved" toast only for data actions.

| Section | Settings (default first) |
| --- | --- |
| Profile | Display name; profiles list (switch, add, remove) for shared devices; active instrument. |
| Audio | Input device; [Calibrate latency] with last result and date; metronome sound volume (0–100, default 70); metronome mode (Audible, Count-in only, Visual only); accent downbeat (on); subdivision clicks (auto by level, on, off); count-in length (Auto, 1 bar, 2 bars); A4 reference (440, range 415–446); "I'm using headphones" (off). |
| Display | Theme (System, Light, Dark); Score paper in dark theme (Dark paper, Light paper); notation size (Normal, Small, Large); playhead (Bar highlight, Line, Off); live feedback (Full, Errors only, After the take); show cents and milliseconds in review (on); show live pitch dot (off); show note names under notes (off; practice only, makes takes unranked). |
| Practice | Scan time (Level default, or 10–120 s); show STARS checklist (on); show tips between exercises (on); placement test (run again). |
| Accessibility | Reduce motion (System, On, Off); high-contrast feedback (off; thicker strokes and larger glyphs, 7.2); larger verdict glyphs (off); announce results automatically (on); keyboard shortcuts list. |
| Data | Export all data (JSON); import; delete all data (typed confirmation "delete"); storage used. |
| About | Version, corpus version, excerpt sources and licences page, privacy note ("Audio never leaves this device"). |

"Live feedback: After the take" hides the overlay during the take (a "blind" take, like an audition) and reveals everything in review. "Errors only" draws no `correct` confirmations live.

---

## 6. Real-time feedback rendering

The binding behaviour is 01 6.6 (event to renderer) and 02 4.7 (verdict rules). This section fixes the visual treatment. All live marks live in the overlay SVG above the static VexFlow SVG; the static score is never re-rendered during a take. Note state changes are CSS classes on the note's `<g>` (found by `ScoreEvent.id`).

### 6.1 States of the expected (written) note

| State | When (02 4.7, 01 6.6) | Notehead, stem, accidental | Verdict lane glyph (live) | Verdict lane (review) |
| --- | --- | --- | --- | --- |
| `pending` | not reached | `--ink` | none | none |
| `active` | onset matched, verdict not yet final | `--ink`, plus a 1.5 px ring in `--active` around the notehead | none | n/a |
| `correct` | in tolerance (within tRed and redCents) | fill `--correct` | small filled dot (3 px) | check mark ✓ in `--correct` |
| `correct-marginal` | correct, but timing beyond tGood or cents beyond good | fill `--correct` | same dot | check mark with a tiny tick on the side of the deviation (◂✓ early-ish, ✓▸ late-ish) in `--text-muted` |
| `early` | matched, Δ < −tRed | fill and stroke `--error` | ◂ chevron | ◂ plus text "early" on focus/hover |
| `late` | matched, Δ > tRed | `--error` | ▸ chevron | ▸ |
| `sharp` | right note, dev > redCents | `--error` | ▲ | ▲ plus cents chip |
| `flat` | right note, dev < −redCents | `--error` | ▼ | ▼ plus cents chip |
| `wrong-pitch` | matched, wrong note | `--error` | ✕ small (5 px) | ✕ |
| `octave` | right pitch class, wrong octave | `--error` | "8" glyph | "8" |
| `missed` | no match by onset + W | `--error` outline-only notehead (fill removed, 1.5 px stroke), stem and accidental `--error` | ○ hollow ring | ○ plus "missed" |
| combined | for example late + wrong | `--error` | up to 2 glyphs stacked vertically in the lane (timing on top) | same |

Why these choices:
- The user story says the original note "turns red" for any timing or pitch error; it does, in every error state.
- Colour is never alone: the lane glyph differs per verdict, and `missed` changes notehead shape (hollowed) so it reads differently from "played wrong".
- Rests that receive extras get the `extra` glyph "+" in the lane under the rest; the rest itself stays `--ink`.

The **verdict lane** is a 20 px strip under each staff (below the lowest ledger allowance), aligned to note x. Glyphs are 9 px tall in live mode, 12 px in review. The lane keeps the notation itself clean: musicians can read the music with the eye and see verdicts with peripheral vision.

Colour transitions: 100 ms linear fill change (instant with reduced motion). Pitch verdicts are provisional after 120 ms of steady pitch (02 4.7); a provisional pitch error renders immediately, and if the player corrects within the note, the note fades back to `correct` over 100 ms. Timing verdicts are final at onset and never revert during the take.

### 6.2 Ghost notes (what was actually played)

A ghost is a notehead drawn in the overlay at the played pitch and the played time.

Geometry:
- Notehead: same glyph and size as a black notehead, rendered as an outline only (1.5 px stroke in `--ghost`, fill `--ghost` at 15% opacity). High-contrast setting: 2.25 px stroke, 30% fill.
- No stem and no flag in live mode (stems add clutter and imply a rhythmic value we have not decided yet). In review, ghosts get a stem in `--ghost` at 70% opacity pointing the same way as the expected note's stem.
- Duration tail: a 3 px tall bar in `--ghost` at 35% opacity extending right from the notehead centre for the held duration (`note-update.durationBeats` mapped through `beatToPoint`). It grows while the note sounds and stops at `note-end`. This is how the player sees "held too long" or "cut short".
- Ledger lines for ghosts: dashed (2 px on, 2 px off) in `--ghost`, so ghost ledger lines never look like real ones.
- Accidental: drawn in `--ghost` left of the ghost notehead when the spelling rule (02 4.7) needs one, including courtesy naturals (target F♯, played F: ghost shows ♮).
- Octave clamp: if the ghost would need more than 4 ledger lines, draw it at 4 ledger lines with a small "8va" or "8vb" label in `--ghost` (10 px), so wild octave errors stay on screen.

Position:
- x = `beatToPoint(ghost.scoreBeat)` for the played onset. A ghost of an early or late note therefore sits left or right of the expected note: the horizontal displacement is the error.
- Leader line for timing errors: a 1 px dotted line in `--ghost` from the ghost notehead's edge to the expected notehead's edge at the ghost's y, with a 4 px arrowhead pointing at the expected note ("it belonged here"). Drawn only if the gap is at least 1.5 notehead widths; for smaller gaps the lane chevron suffices.
- Same staff position as the expected note (sharp, flat, or an on-time note one step away that would overlap): offset the ghost to the right by 1.1 notehead widths, the way a second is written in a chord. If the expected note has a right-side accidental conflict (next note's accidental), offset left instead.
- Ghost lands across a barline or system break: draw it where it was played. If the played beat falls in the next system, draw it at that system's position. If it falls before bar 1 (very early start), clamp to the left margin of system 1 with the ◂ glyph.
- Ghost collisions: if two ghosts would overlap (within 0.8 notehead widths and 1 staff step), the later one is offset right by 0.8 widths. More than 3 ghosts within a beat: draw the first 2 and a "+n" label; review shows all.

Kinds (01 `GhostNote.kind`):

| Kind | Ghost pitch | Ghost x | Extra marks |
| --- | --- | --- | --- |
| `early` / `late` (right pitch) | expected pitch | played onset | leader line; lane ◂ / ▸ |
| `sharp` / `flat` | expected pitch (same staff position) | played onset, offset right 1.1 widths | cents chip (6.3); a 6 px arrow ▲/▼ attached to the ghost's top-right |
| `wrong-pitch` | played pitch, spelled per 02 4.7 | played onset | accidental per spelling rule; lane ✕ |
| `octave` | played pitch (clamped per above) | played onset | "8" in lane |
| `extra` | played pitch | played onset | ghost only, no expected note changes; lane "+" under the ghost |
| combined (late + wrong) | played pitch | played onset | one ghost; leader line plus accidental; lane shows both glyphs |

When the note is `correct`, no ghost is drawn (live or review). The player sees a confirmed note, not a duplicate.

### 6.3 Cents indicator

For `sharp` and `flat`:
- Live: a chip above the staff, centred over the note, 2 sp above the top line (or above the highest ledger line): text "+38¢" or "−22¢" in 11 px tabular numerals with the ▲/▼ glyph, `--error` text on `--surface-chip` with a 1 px `--error` border, 4 px radius. The chip shows for 1.5 s, then collapses into the lane glyph (fade 150 ms). At most one chip is visible at a time; a new chip replaces the old one immediately.
- Review: chips are hidden by default and appear on hover or focus of the note, and for all pitch errors when the "Pitch" filter is on. When "Show cents and milliseconds in review" is off, chips read "sharp" or "flat" instead of numbers.
- Notes that are correct but beyond the "good" band (marginal) never get a chip live; in review their tooltip gives the cents.
- Voice with drift compensation: cents shown are relative to the compensated target (02 4.5); the tooltip says "relative to where you'd drifted".

Optional "tuner" style (not in v1): a small vertical needle next to the note. Rejected for v1 because it pulls the eye down to the current note instead of ahead.

### 6.4 Timing indicator in review

Tooltip and focus description for timing errors give both units: "Late by 90 ms (about a sixteenth at this tempo)". The beat-fraction phrase uses the nearest of: a 32nd, a sixteenth, a triplet eighth, an eighth, a quarter (relative to the current tempo); "less than a sixteenth" below that.

### 6.5 Keeping the live view readable

Hard rules for live mode:

1. **No forward clutter.** No overlay element is drawn more than 0.5 beat right of the playhead, except a ghost's own notehead at onset, which is at the playhead by definition, and the next-bar marker.
2. **One transient at a time.** At most one cents chip is visible. No text other than the chip appears in the score frame during a take.
3. **No motion in the music.** Noteheads, systems, and the page never move during a take, except page turns in page-turn mode. Ghosts appear with an 80 ms fade, never a pop, scale, or bounce.
4. **Fade the past.** When the playhead leaves a system, all overlay marks on it drop to 60% opacity, so the current system is visually dominant.
5. **Correct is quiet.** Correct notes use the fill change and a 3 px lane dot only. In "Errors only" mode they stay `--ink`.
6. **Density brake.** If more than 4 error states fire within one bar, the remaining errors in that bar render the note colour and lane glyph but suppress ghosts until the next bar; the review view shows all ghosts. This prevents a wall of purple when a player is lost.
7. **No sound, no speech, no vibration** from feedback.
8. **Performance budget:** at most 150 overlay elements live at once (ghosts, tails, ledger lines, chips); the overlay uses one `<g>` per system, and opacity changes are applied per group.

"After the take" (blind) mode skips all of the above and shows only the playhead and metronome.

### 6.6 Review rendering (after the take)

Computed from the final judgments, not the live ones.

- All notes keep their final state colour. Correct notes show ✓ in the lane at 12 px.
- Ghosts are opaque (100% stroke, 20% fill) with stems; duration tails stay at 35%.
- Per-bar heat strip above each bar (6 px tall, full bar width), from bar error share: 0 errors: no fill, track only; up to 25% of notes wrong: one hatch line; up to 50%: two; above 50%: solid `--error` at 60%. Hatching (diagonal lines) carries the meaning without colour. Hover or focus on a bar's strip: "Bar 6: 2 of 5 notes off (1 late, 1 flat)".
- Filter chips over the score: All, Pitch (Notes and In tune), Rhythm (Rhythm and Steady). Filtering dims non-matching marks to 25% opacity; it does not hide the music.
- Toggle "Show: My take / Clean score". Clean score hides the overlay and restores ink colours, so the player can reread the passage.
- Note inspector: clicking or focusing any note opens a popover anchored to the note:

```
 +-------------------------------------+
 | Bar 6, beat 2                       |
 | Written  F♯5 (eighth)               |
 | Played   F♮5, 90 ms late            |
 | Held     80% of its value           |
 | "The F is sharp in E major."  [Tip] |
 +-------------------------------------+
```

  The quoted hint comes from the pattern that this note belongs to (02 6.2); omitted when none.
- [◀ prev slip] [next slip ▶] step through error notes in time order (also arrow keys, section 8.3). The page-turn layout in review shows the system containing the selected note.
- Playback in review moves the playhead line (review always uses the line style) and highlights each note as it sounds.

### 6.7 Feedback acceptance criteria

1. For every `FollowerEvent` in the 01 6.6 table, the corresponding visual change appears within 33 ms and matches the state table in 6.1.
2. A note played 100 ms late at ♩ = 60 with an 8th-note-dense bar: ghost drawn right of the expected note by `beatToPoint(onset)` minus `beatToPoint(expected)` within ±1 px.
3. Sharp by 38 cents: expected note red, ghost at the same staff position offset right by 1.1 notehead widths, chip "+38¢ ▲", lane ▲.
4. Target F♯ in E major played as F: ghost shows a natural sign.
5. A missed note shows a hollow red notehead and ○ in the lane, and no ghost.
6. An extra note during a rest shows a ghost and "+" in the lane; the rest stays ink-coloured.
7. With a Deuteranopia or Protanopia simulation filter applied (Chrome DevTools rendering emulation), every state in 6.1 remains identifiable by glyph and notehead shape alone; a visual regression test captures each state in both themes and in grayscale.
8. Live overlay never shows more than one cents chip, and nothing right of the playhead beyond the rules in 6.5 (E2E assertion on overlay element x positions).

---

## 7. Design system

### 7.1 Colour tokens

Two themes, plus the score "paper" which follows the theme by default. Contrast ratios are WCAG 2.x relative-luminance ratios measured against the listed surface.

UI tokens:

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` | `#F6F5F1` | `#121418` | App background |
| `--surface` | `#FFFFFF` | `#1A1D22` | Cards, panels |
| `--surface-2` | `#EFEDE6` | `#22262C` | Inputs, segmented controls, hover |
| `--surface-chip` | `#FFFFFF` | `#2A2F36` | Chips over the score |
| `--border` | `#D6D3CA` | `#323840` | Hairlines, dividers (decorative) |
| `--border-strong` | `#8E8A80` | `#6B727C` | Input borders (≥ 3:1 for non-text contrast) |
| `--text` | `#1B1D21` (16.9:1 on surface) | `#E9EBEE` (14.2:1) | Body text |
| `--text-muted` | `#575C66` (6.7:1) | `#A3A9B3` (7.2:1) | Secondary text |
| `--accent` | `#2F4BD8` (6.7:1) | `#8FA1FF` (7.0:1) | Primary buttons, links, focus |
| `--on-accent` | `#FFFFFF` (6.7:1 on accent) | `#121418` (7.6:1 on accent) | Text on primary buttons |
| `--focus-ring` | `#2F4BD8` | `#8FA1FF` | 2 px outline, 2 px offset |
| `--track` | `#E4E1D8` | `#2C3138` | Progress tracks |
| `--star` | `#8A6400` (5.4:1) | `#E0B341` (8.6:1) | Stars, streak flame |
| `--caution` | `#8A6400` | `#E0B341` | Warning banners (always with icon) |
| `--danger` | `#C5300A` | `#FF7B52` | Destructive buttons, error banners (always with icon) |

Score tokens:

| Token | Light paper | Dark paper | Ratio on paper (L / D) | Use |
| --- | --- | --- | --- | --- |
| `--paper` | `#FFFDF8` | `#1B1E23` | | Score background |
| `--ink` | `#1A1A1A` | `#ECE9E2` | 17.1 / 13.8 | Notation |
| `--staff-line` | `#7A7A7A` | `#8C9098` | 4.2 / 5.2 | Staff lines and barlines |
| `--correct` | `#00756A` | `#3FC7B4` | 5.5 / 8.0 | Correct notes, ✓ |
| `--error` | `#C5300A` | `#FF7B52` | 5.4 / 6.5 | Notes with any error ("red") |
| `--ghost` | `#7A3EC8` | `#BFA2FF` | 6.2 / 7.8 | Played notes, tails, ghost accidentals |
| `--active` | `#1A1A1A` | `#ECE9E2` | | Ring on the active note (shape, not hue) |
| `--playhead-bar` | `rgba(47,75,216,0.08)` | `rgba(143,161,255,0.10)` | | Current-bar tint |
| `--playhead-next` | `#2F4BD8` at 60% | `#8FA1FF` at 60% | | Next-bar top marker |
| `--playhead-line` | `#1A1A1A` at 45% | `#ECE9E2` at 45% | | Line playhead (neutral, so it never resembles the violet ghost) |
| `--ink-accent-soft` | `rgba(47,75,216,0.18)` | `rgba(143,161,255,0.22)` | | Scan highlights |
| `--metro-active` | `#1A1A1A` | `#ECE9E2` | | Active beat dot |

"Light paper" in dark theme uses the light-paper column inside a dark UI.

Colour-vision check (CIE Lab ΔE between simulated colours, Machado 2009 matrices, light paper): correct vs error 104 normal, 43 protanopia, 60 deuteranopia, 111 tritanopia; ghost vs error ≥ 85 in every simulation; ghost vs correct ≥ 41. Dark paper: correct vs error ≥ 37 in all simulations. Correct and error have nearly equal luminance (contrast 1.0 to 1.2 between them), so for monochromacy and grayscale they are separated only by glyph and shape, which section 6.1 guarantees. The playhead is deliberately neutral because the accent blue and the ghost violet collapse under protanopia (ΔE 7).

High-contrast feedback setting: `--error` becomes `#A32100` (light) / `#FF9A78` (dark), `--correct` `#005A52` / `#6FE0D0`, ghost stroke 2.25 px, lane glyphs 14 px, and error notes gain a 2 px underline bar under the notehead in `--error`.

Forced-colours mode (Windows High Contrast): map `--ink` to `CanvasText`, `--paper` to `Canvas`, `--error` to `Mark`/`Highlight`, `--ghost` to `LinkText`; glyphs carry the meaning.

### 7.2 Typography

- UI font: system stack `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` (no web font download; first paint matters on phones). Numbers use `font-variant-numeric: tabular-nums` wherever they update (scores, timers, XP, tempo).
- Music font: Bravura via VexFlow 5 (SMuFL). Ghost glyphs and lane glyphs ✓ ◂ ▸ ▲ ▼ ✕ ○ + use SMuFL code points from Bravura where available, else inline SVG paths shipped in `src/ui/glyphs.ts`; never rely on emoji fonts.
- Scale (px / line height / weight):

| Token | Size | Line | Weight | Use |
| --- | --- | --- | --- | --- |
| `--type-grade` | 72 | 1.0 | 700 | Grade letter |
| `--type-display` | 48 | 1.1 | 700 | Count-in numbers on phone full-screen, rank-up |
| `--type-h1` | 32 | 1.2 | 650 | Screen titles, numeric score |
| `--type-h2` | 24 | 1.25 | 600 | Section titles, tip headline |
| `--type-h3` | 20 | 1.3 | 600 | Card titles |
| `--type-body` | 16 | 1.5 | 400 | Body, controls |
| `--type-small` | 14 | 1.45 | 400 | Secondary text, table cells |
| `--type-caption` | 12 | 1.35 | 500 | Badges, chart labels, chips over the score (11 px allowed only for cents chips) |

Minimum text size anywhere: 12 px (cents chips 11 px bold, always duplicated in review tooltips). Text scales with browser zoom to 200% without loss (8.1).

### 7.3 Spacing, radii, elevation, iconography

- Spacing scale (4 px base): `--space-1` 4, `--space-2` 8, `--space-3` 12, `--space-4` 16, `--space-5` 24, `--space-6` 32, `--space-7` 48, `--space-8` 64.
- Radii: `--radius-s` 4 (chips), `--radius-m` 8 (buttons, inputs), `--radius-l` 12 (cards), `--radius-xl` 20 (sheets' top corners).
- Elevation: cards are flat with `--border`; sheets and popovers use `0 8px 24px rgba(0,0,0,0.16)` (light) / `0 8px 24px rgba(0,0,0,0.5)` (dark). The score frame has no shadow (paper on desk).
- Icons: 20 px line icons, 1.75 px stroke (Lucide, ISC licence). Instrument icons: a custom set of 24 single-colour silhouettes (one per instrument in 02 1.1), made by the designer as SVG; until delivered, use the family name initial in a circle.
- Rank emblems: geometric, generated from SVG primitives so they theme correctly. Ranks 1–3 a circle with 1–3 inner rings; 4–6 a diamond with 1–3 inner bars; 7–9 a hexagon with 1–3 inner chevrons; 10 a star inside a hexagon. Achieved emblems filled `--text`, current ringed in `--accent`, future outlined `--border-strong`. Shape plus count distinguishes ranks without colour.

### 7.4 Components

Each component lives in `src/ui/components/`, has a Storybook-style fixture page (`/#/dev/components`, dev builds only), and states: default, hover, focus-visible, active, disabled, and (where relevant) error. Hit targets are at least 44 × 44 px on touch and 32 × 32 px with a pointer (WCAG 2.5.8 needs 24).

| Component | Spec |
| --- | --- |
| Button | Variants primary (accent fill), secondary (surface-2 fill, border-strong), tertiary (text only, underline on hover), danger. Heights 36 (compact), 44 (default), 56 (hero: Start, Next excerpt). Label 16/600. Icon optional left. Loading state replaces label with a spinner and keeps width. |
| RandomChip | Toggle button "Random" with a dice icon, `aria-pressed`. Pressed: accent border and text, surface-2 fill. Sits trailing each setup row. |
| SegmentedControl | Radio group; 36 px tall; selected segment surface fill with border-strong; arrow keys move selection. |
| Select | Native `<select>` styled; never a custom listbox (accessibility and phone pickers). |
| Stepper | [-] value [+] with the value as an `<input type="number">`; long-press repeats at 8 Hz. |
| TempoSlider | Native range input plus numeric field, step 1 bpm, beat-unit glyph label. |
| Toggle | Switch with label on the left; `role="switch"`. |
| Card, Sheet, Modal, Popover, Toast | Sheet: bottom on phone, right side on desktop when attached to the score. Toast: bottom-centre, 4 s, never during a take. |
| Banner | Info, caution, danger; icon + text + optional action + dismiss. |
| BeatDots | Metronome strip; props `beatsPerBar`, `grouping`, `currentBeat`, `countIn`. |
| LevelMeter | Input level bar with gate and clip markers. |
| ScanTimer | 28 px ring, remaining seconds in the centre; at 0 shows a check. |
| ChecklistItem | Checkbox plus title plus detail line; `aria-describedby` to the detail. |
| GradeBadge | Letter in a square (32 px in lists, 72 px in results), with accessible name. |
| StarRow | 3 stars, filled/outlined (shape differs: filled vs outline) plus optional shine ring. |
| ComponentBar | Label, 10 segments, value, expand chevron. |
| HeatStrip | Per-bar 6 px strip with hatch levels. |
| VerdictGlyph | One of ✓ ◂ ▸ ▲ ▼ ✕ ○ 8 + at 9/12/14 px. |
| CentsChip | Text plus arrow; error colours. |
| RankEmblem | Props `rank`, `state` (achieved, current, future), size. |
| StreakGrid | 7 × 12 cells, 5 fill steps plus streak-day dot. |
| TrendChart | SVG line chart with grade bands, plus a visually hidden table. |
| TipCard | Header (instrument, dimension), headline, body, evidence line, drill button, expandable secondary. |
| EmptyState | 48 px icon, title, one sentence, one action. |
| ScoreFrame | Paper container; owns the VexFlow SVG and overlay SVG; exposes `ScoreView`. |

### 7.5 Motion

Tokens: `--dur-instant` 0 ms, `--dur-fast` 100 ms, `--dur-base` 200 ms, `--dur-slow` 320 ms; `--ease-out` `cubic-bezier(0.2, 0, 0, 1)`, `--ease-in-out` `cubic-bezier(0.4, 0, 0.2, 1)`.

Rules:
- During a take, only colour and opacity change, never position or size (except the line playhead and page turns). Max duration 100 ms for note states, 80 ms for ghost appearance, 150 ms for chip collapse, 160 ms for page-turn crossfade.
- Outside takes: screen transitions 200 ms fade plus 8 px slide; sheets 240 ms slide; results panel 240 ms slide.
- Celebration is restrained: rank-up emblem draws in over 320 ms (stroke-dash animation) with no particles or confetti; S grade shine ring rotates once over 800 ms.
- Nothing flashes more than 3 times per second (beat pulse rule in 5.4.5).

Reduced motion (`prefers-reduced-motion: reduce` or the in-app setting):
- All durations become 0 except opacity fades on transient chips (kept at 100 ms, opacity only).
- Line playhead becomes a stepped bar highlight (jumps per beat) unless the player explicitly chose "Line" after enabling reduced motion.
- Beat pulse: dots change fill instantly per beat with no ease-back; peripheral pulse off.
- Page turns are instant swaps.
- Count-up numbers, rank-up draw-in, S shine, and the live-to-final correction ring animation are replaced by the final state immediately.

### 7.6 Theming implementation

- Tokens are CSS custom properties on `:root[data-theme="light|dark"]` and `[data-paper="light|dark"]` on the score frame. VexFlow is rendered with `fillStyle`/`strokeStyle` set to `currentColor` where possible and classes, so theme switches do not require re-render; if VexFlow 5 needs explicit colours, re-render the static score on theme change (never during a take; theme change is disabled during takes).
- `color-scheme: light dark` is set so native controls match.

---

## 8. Accessibility

Target: WCAG 2.2 AA across the app. The score is a complex image with a full text alternative; the performance itself depends on playing an instrument, which is the product's purpose and not a barrier we can remove, but everything around it must be operable by keyboard and screen reader.

### 8.1 Requirements checklist

- 1.1.1: score SVG has `role="img"` and an `aria-label` summary ("Excerpt, 10 bars, E major, 6/8, treble clef, dotted quarter equals 60"); a "Read the music as text" disclosure gives a bar-by-bar list ("Bar 1: B4 dotted quarter, C♯5 eighth, ..."). Charts have hidden data tables.
- 1.3.1: settings rows are `<fieldset>` with `<legend>`; Random chips are `aria-pressed` buttons described by the row (`aria-describedby`).
- 1.4.1: no information by colour alone (section 6 and 7.1).
- 1.4.3 / 1.4.11: contrast values in 7.1; all meet 4.5:1 for text and 3:1 for graphics and control boundaries.
- 1.4.4 / 1.4.10: 200% zoom and 320 px reflow for every screen except the score frame, which switches to page-turn mode and keeps note size.
- 1.4.13: popovers stay while hovered, dismiss with Esc.
- 2.1.1 / 2.1.2: everything keyboard operable; no traps; modals trap focus intentionally and release on close.
- 2.2.1 timing: the scan timer never ends the scan; there is no timed action other than the musical performance itself. Stop is always available.
- 2.3.1: flash limit (5.4.5).
- 2.4.3 / 2.4.7 / 2.4.11: logical focus order; 2 px `--focus-ring` with 2 px offset, never removed; focused elements are not obscured by sticky bars (scroll padding equals sticky heights).
- 2.5.7: no drag-only interactions (slider has a numeric field; history has no swipe-only delete).
- 2.5.8: targets per 7.4.
- 3.3.1 / 3.3.3: import errors and calibration failures say what went wrong and how to fix it.
- 4.1.3: status messages via live regions as defined in 8.4.

### 8.2 Focus order per key screen

- Home: skip link "Start practice" → app bar → banners → settings rows top to bottom (control, then its Random chip) → Start → Today panel.
- Scan: toolbar (Home, Start scan / Start playing) → STARS items → helper buttons → score text alternative disclosure → Skip excerpt. Start playing has initial focus once the cover is removed.
- Performance: focus on Stop. Tab is limited to Stop and the metronome mode toggle is disabled during a take (no accidental changes).
- Results: initial focus on the grade block heading (so screen readers read the grade first) → component rows → counts buttons → filter chips → score note navigation → XP block → Next excerpt → Try again → links.

### 8.3 Keyboard shortcuts

Single-key shortcuts are active only when focus is not in a text field, and can be turned off in Settings (WCAG 2.1.4).

| Key | Context | Action |
| --- | --- | --- |
| Space | Scan | Start scan / Start playing |
| Enter | Scan, Results, Tips | Primary action |
| Esc | Performance | Stop take (no confirm; Esc is deliberate) |
| Esc | Sheets, popovers, modals | Close |
| N | Results, Tips | Next excerpt |
| R | Results | Try again (practice) |
| ← / → | Results score | Previous / next note (all notes) |
| Shift+← / Shift+→ | Results score | Previous / next slip (errors only) |
| ↑ / ↓ | Results score | Previous / next system |
| Enter | Results score, note focused | Open note inspector |
| C | Results | Toggle My take / Clean score |
| P | Results | Play the score / stop |
| ? | Anywhere | Shortcut list dialog |

During a take, only Esc and Space (Space = stop, same as the Stop button) are live, to avoid stray keys from a hand or knee.

The score in review is a single tab stop (`role="application"` is not used); inside it, a roving `tabindex` moves between notes rendered as focusable `<g>` elements with `role="button"` and an `aria-label` like "Bar 6, beat 2, written F sharp 5 eighth note, you played F natural 5, 90 milliseconds late, wrong note".

### 8.4 Screen-reader behaviour during a take

- Screen-reader speech through speakers would be picked up by the microphone and graded as extra notes, and per-note announcements are useless at tempo. So:
  - Before the count-in, one polite announcement: "Count-in, 4 beats, then play. Press Escape to stop." If the system reports no headphones (cannot be detected reliably on the web), the scan screen shows a visible and announced note for screen-reader users: "Use headphones so the screen reader doesn't interfere with listening."
  - During the take: the live region is muted. No `aria-live` updates fire. Note state changes are `aria-hidden` overlay changes.
  - Take end: "Take finished. Scoring." then on results, the grade block heading receives focus, which reads "Grade B, 84 out of 100, 2 stars. Ranked." If "Announce results automatically" is on, a polite region also reads the top component and the tip headline.
- The metronome strip is `aria-hidden` during the take (the click is the audible metronome). In "visual only" metronome mode, screen-reader users get a warning in setup that visual-only mode has no audible pulse.
- The input level meter has `role="meter"` with `aria-valuetext` ("good level") outside takes and is `aria-hidden` during takes.

### 8.5 Other

- Language: `lang="en"` on the document; note names are spelled for speech ("F sharp 5", not "F♯5") in all `aria-label`s via a `speakPitch()` helper.
- Motion: section 7.5.
- Cognitive load: one primary action per screen, consistent placement (primary bottom-right on desktop cards, full-width bottom on phone).

---

## 9. Empty, error, and permission states

### 9.1 Empty states

| Where | Title | Body | Action |
| --- | --- | --- | --- |
| Progress, no attempts | Your progress starts with one take | Play an excerpt and your score, level, and rank show up here. | [Start practising] |
| History, no attempts | No takes yet | Every take you play is saved on this device. | [Start practising] |
| History, filters match nothing | No takes match these filters | Try another instrument or grade range. | [Clear filters] |
| Common slips, fewer than 3 attempts | Not enough takes yet | After a few takes we'll show the slips you make most. | none |
| Corpus has no excerpt for the chosen settings | No excerpt fits these settings | Level 2 has no music in 7/8 yet. Try another time signature or set it to Random. | [Set time to Random] |

### 9.2 Microphone permission

| Case | Detection | UI |
| --- | --- | --- |
| Not yet asked | `permissions.query` = prompt, or unknown | Pre-prompt card (5.1). |
| Denied | `getUserMedia` NotAllowedError, or state = denied | Card with mic-off icon: "Microphone is blocked. The app can't hear you play." Browser-specific steps detected from UA: Chrome/Edge "Click the lock icon left of the address, set Microphone to Allow, then reload."; Safari macOS "Safari > Settings for This Website > Microphone > Allow"; iOS Safari "Settings > Safari > Microphone > Allow, then reload"; Firefox "Click the mic icon with a slash in the address bar, remove the block, then reload." [Reload] [Try again] [Practise without listening]. |
| No device | NotFoundError | "We can't find a microphone. Plug one in or check your system settings." [Try again] |
| Device busy | NotReadableError | "Another app is using the microphone. Close it and try again." [Try again] |
| Insecure context | `!isSecureContext` | "The microphone only works on a secure (https) page." (development only) |
| Revoked mid-session | track `ended` | Take aborts; results show the void state with "The microphone stopped." |

"Practise without listening" mode: the full flow works (scan, metronome, count-in, playhead), results show "Not graded: microphone off", no XP, and the self-assessment buttons "How did it go? [Clean] [A few slips] [Rough]" are recorded in history for the player's own reference. This keeps SRF-style use possible for players who cannot grant mic access.

### 9.3 Errors

| Case | Where shown | Copy | Action |
| --- | --- | --- | --- |
| AudioContext suspended (iOS interruption, call) | Performance → results void state | "The take was interrupted, so it wasn't graded." | [Try again] |
| No sound detected 5 s after bar 1 | Status line during take, then void if continued | "We can't hear you. Move closer to the mic?" | none during take |
| Clipping for > 20% of frames | Results banner | "The mic was overloaded, so some notes may be misjudged. Move back a little or turn down." | [Check level] |
| Calibration stale or missing | Home banner | "Calibrate once so timing grades are fair. It takes 8 seconds." | [Calibrate] |
| Consistent timing bias (01 5.7 rule) | Results banner | "You've been about 50 ms late on every take. That may be your device, not you." | [Recalibrate] |
| Bluetooth suspected | Home banner and calibration | see 5.9 | [Recalibrate] |
| Corpus failed to load (offline, first visit) | Home full-card error | "Couldn't load the music library. Check your connection; after the first visit it works offline." | [Retry] |
| Storage full or blocked (private mode) | Toast after attempt, then Settings > Data | "This browser isn't saving your progress (private browsing or storage full)." | [Export this take] |
| Import file invalid | Settings > Data inline | "That file isn't a Sightread backup." | none |
| Unsupported browser (no AudioWorklet) | Full-page | "This browser can't run the listening engine. Use a recent Chrome, Edge, Firefox, or Safari." | none |

---

## 10. Microcopy

Voice: a calm, encouraging teacher. Short sentences. Second person. No exclamation marks except the rank-up headline. Never "fail", "wrong" about the player (notes can be wrong; the player is not). Use musicians' terms (bar, beat, sharp, flat, rush, drag).

| Moment | Copy |
| --- | --- |
| Welcome headline | Read it. Play it. See how it went. |
| Welcome body | Real music, a few bars at a time. We listen while you play and show you every note. |
| Mic pre-prompt | Let the app hear you play. Sound is analysed on this device and never recorded or uploaded. |
| Calibration intro | Your speakers and mic add a small delay. We'll measure it so "late" really means late. |
| Calibration success | Your setup adds 42 ms. We'll correct for it. |
| Home Start button | Start |
| Scan cover | Take a moment to read before you play. |
| Scan time up | Scan time's up. Start when ready. |
| Count-in status | Count-in… |
| During take status | Bar 6 of 10 |
| Stop confirm | Stop this take? It won't be graded. [Keep playing] [Stop] |
| Scoring | Scoring… |
| Grade S | Performance-ready. |
| Grade A | Excellent read. |
| Grade B | Solid. A few slips. |
| Grade C | Passed. Keep going. |
| Grade D | Rough one. Stay at this level for now. |
| Grade F | This one was a stretch. Try an easier level? |
| Incomplete | Less than half the notes came through, so this one's capped at 50. |
| Practice badge tooltip | Practice: you've played this excerpt before, so it isn't sight reading any more. |
| Level-up offer | You're reading level 5 well. Move up to level 6? [Move up] [Stay at 5] |
| Level-down suggestion | Level 6 has been a stretch lately. A few takes at level 5 can build the reading back up. [Go to level 5] [Stay at 6] |
| Rank-up | You're now an Ensemble player! Next: Principal at 9,000 XP and level 6. |
| Streak at risk | One more ranked take today keeps your 6-day streak. |
| Tips header | Before the next one |
| Clean read | Clean read. Try it a little faster next time, or move up a level. |
| Re-judged notes | 2 notes re-judged after the take. |
| Not graded (mic off) | Not graded: the microphone is off. How did it go? |
| Excerpt credit (results) | {title} · {composer} · bars {a}–{b} · {licence} |

Verdict words (review tooltips, aria labels): "right", "early", "late", "sharp", "flat", "wrong note", "wrong octave", "missed", "extra note", "held too short", "held too long".

---

## 11. Reuse from ear-to-staff

| ear-to-staff piece | Decision | Notes |
| --- | --- | --- |
| `style.css` dark palette (`--bg`, `--panel`, `--accent` gold, `--accent-2` teal) | Replace | New token set (7.1) with light and dark themes and colour-blind-safe feedback colours. The ear-to-staff teal/gold/red trio is not CVD-safe as a set. |
| Beat dots and beat label (`showBeat`, `.beats.countin` in `js/app.js`, `index.html` 137–139) | Adapt | Same idea (one dot per beat, count-in label), extended with compound grouping, flash limit, and audio-clock timing. |
| Live notes rendered grey in VexFlow (`el.live` in `notation.js` `renderScore`) | Replace | Live feedback moves to a separate overlay SVG; VexFlow renders once per exercise (01). |
| VexFlow system layout loop in `renderScore` | Adapt | Starting point for fixed bars-per-system layout; add the breakpoint table (5.4.2) and `beatToPoint`. |
| Pitch trace canvas (teal accepted, grey rejected dots) | Adapt for the developer replay tool and the optional live pitch dot | Not shown to players by default. |
| Status line pattern (`#status`) | Reuse | One quiet line of text, now at the bottom of the performance screen. |
| History panel list | Adapt | Becomes the History screen with grouping and filters; the GitHub save flow is dropped. |
| Print menu and multi-part print | Drop for v1 | Possible later as "Print this excerpt". |
| MusicXML export (`js/musicxml.js`) | Reuse | "Export MusicXML" on results, with a second part for what was played. |
| Transposing instrument captions ("concert key" and written key) | Reuse the wording pattern | Setup shows written key with concert key secondary. |

---

## 12. Design acceptance summary (for QA)

1. Every screen in section 5 is implemented at `xs`, `sm` short, `md`, `lg`, and `xl`, with Playwright visual snapshots in light and dark themes.
2. 8, 10, and 12 bar excerpts render without scrolling on 1280 × 720, 1440 × 900, and 1024 × 768 (landscape) at Normal notation size; on 844 × 390 (phone landscape) and 390 × 844 (portrait) page-turn mode always shows the system after the current one.
3. Each feedback state in 6.1 and each ghost kind in 6.2 has a fixture page and a visual test; all pass a grayscale check by glyph and shape alone.
4. axe-core reports zero serious or critical issues on every non-performance screen; manual VoiceOver (Safari) and NVDA (Firefox) passes on Home, Scan, Results, and Settings.
5. Keyboard-only run-through: onboarding to a completed take to results to next excerpt with no mouse.
6. Reduced-motion run shows no transform animations (CSS audit: every `transition`/`animation` is gated by the motion tokens).
7. No `aria-live` update fires between count-in start and take end (E2E spy on live regions).
8. All copy in section 10 is in `src/ui/copy/en.json`; no hard-coded strings in components (prepares localisation).

---

## Open questions

1. **Key semantics.** This design assumes "Key" in setup means the written key for the player's instrument, with concert key shown as secondary text. Confirm with the lead musician and architect (01 open question 1).
2. **Grade and points model conflict.** 01 section 7 defines a weighted total with an extras penalty and "points" with a level multiplier; 02 sections 4.6 and 5.3 define five components (P, I, R, C, T), letter grades S–F, and XP. This design follows 02. The overseer should confirm and have 01's `AttemptScore` carry `components: {P, I, R, C, T}`, `grade`, `stars`, and an XP breakdown so the results screen can show it.
3. **State names.** 01 `NoteVisualState` has `timing-error`, `pitch-error`, `both-error`; 02 and this design use the specific verdicts (`early`, `late`, `sharp`, `flat`, `wrong-pitch`, `octave`) plus `correct-marginal`. The lane glyph needs the specific verdict. Proposal: `setNoteState(idx, state, detail?: { timing?: TimingVerdict; pitch?: PitchVerdict; marginal?: boolean })`.
4. **Title and composer before the take.** Hidden until results to protect sight reading. Licences that require attribution are satisfied in results and history; the score researcher should confirm that this placement is acceptable for CC-BY material.
5. **"Play what I played" synth playback** needs a small synth in the app (oscillator plus envelope is enough). Architect to confirm it fits the bundle and does not conflict with the audio graph.
6. **Practise without listening** mode with self-assessment: keep for v1 (it costs little and helps mic-denied users), or cut?
7. **Phone portrait performance.** Allowed with 2 bars per system in page-turn mode, or require landscape for takes? This design allows portrait and recommends landscape.
8. **Instrument icon set** (24 silhouettes) needs a designer or a licensed set; until then, initials.
9. **SRF comparison claims** need a fresh check against the current SRF release before any public-facing copy uses them.
10. **Live pitch dot default** for voice: on or off? Currently off for all instruments.

## Dependencies on other roles

- **Technical architect (01):**
  - `ScoreLayout.beatToPoint` must cover pickups (negative beats) and beats beyond the last barline, and return the system index so ghosts can land on the next system.
  - `setNoteState` needs the specific verdict detail (open question 3) and a `correct-marginal` flag, or a separate `setNoteDetail`.
  - Expose to the UI per attempt: final judgments with `timingErrorMs`, `centsError`, `heldRatio`, and the pattern id per note (for the note inspector hint); a "re-judged" flag per note when live and final differ.
  - Visual clock: a function returning the current audible score beat for the playhead and beat dots (01 5.1), at display refresh rate.
  - Signal-quality events for the UI: input level (already `live-pitch.levelDb`), sustained silence, clipping ratio, AudioContext interruption.
  - Calibration API that reports per-click detection for the 10-dot progress display, and headphone/loopback method switching.
  - Screen Wake Lock during takes; theme change disabled during takes; VexFlow colour handling via CSS classes or a cheap re-render outside takes.
  - Overlay performance: ≤ 150 live overlay elements and ≤ 33 ms event-to-paint.
- **Lead musician (02):**
  - Confirm `correct-marginal` (between tGood and tRed) as a visible but non-red state.
  - Plain-language names for every error pattern (E-codes) for "Common slips" and the note inspector, and the dimension label per pattern (Rhythm, Notes, In tune, Flow, Steady, Technique).
  - Short level descriptions (one line each, ≤ 60 characters) for the level stepper.
  - Tip evidence template per pattern ("4 of 5 eighths after a dotted quarter were late").
  - Confirm the density brake (6.5 rule 6) does not hide anything pedagogically important live.
- **Music score researcher (03):** title, composer, source, bar range, and licence text per excerpt for the results header and credits; a rhythm-difficulty "hardest bar" tag and highest and lowest note per excerpt for the STARS highlights; enough excerpts per meter and level that the "no excerpt fits" empty state is rare.
- **Senior iOS engineer (05):** reuse these tokens, states, glyphs, and copy; replace the visual peripheral pulse with an optional haptic metronome; native landscape lock for takes; VoiceOver behaviour identical to 8.4; Dynamic Type mapping of the type scale.
- **Overseer:** decide open questions 2, 3, 6, and 7; assign the design-system components (7.4) as the first front-end wave so screen builders work from shared components.
