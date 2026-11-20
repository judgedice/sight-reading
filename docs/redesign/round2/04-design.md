# Round 2: design

Role: principal product designer, same as last round.
Input: the owner's second walk (15 points), `01-ux.md` (decisions), `02-sounds.md` (instrument and voice samples), `03-detection.md` (reference bleed, tolerance for tails and scoops, per-try trace).
Mockups: `docs/redesign/round2/mockups/*.html`, PNG at deviceScaleFactor 2 in `docs/redesign/round2/mockups/png/` (1440 x 900 and 390 x 844, light and dark unless a board says otherwise).
Build: `node docs/redesign/mockups/_build/round2.mjs`, then `node docs/redesign/mockups/_build/render2.cjs`. The round 1 build is untouched: `build.mjs` still writes byte-identical round 1 pages. `round2.mjs` reads the starting-pitch and count-in timings from `src/session/take-plan.ts` and `practice-session.ts`, and stops if it cannot.

Every mockup shows the owner's own state: baritone voice, difficulty 1, F major, built-in speakers, not calibrated, three practice tries today (two graded, one not graded).

## Where I disagree with the UX spec

1. **Keep the 2-bar count-in at difficulties 1 to 3.** `01-ux.md` §11 cuts it to 1 bar. The owner said counting 1 2 3 4 twice "is normal". His problem was not the length but not knowing which bar was the last. At ♩ = 60 a single bar is 4 seconds, right after a starting pitch, which is little for a beginner to settle the pulse and take a breath. So: leave `countInBars` in `config/levels.json` alone, and make the two bars look different (bar 1 grey and dashed, "Count-in: listen to the beat"; bar 2 brass, "Come in after 4"). If the owner prefers one bar, the frames still hold: drop the dashed group and frames C1.1 to C1.4.
2. **The track is not joined to the first notehead with a line.** A connector across the clef, key and time signature is noise. Both ends carry the same word and colour instead: the brass "Sing" cell on the track, and a brass ring with "Sing" above the first note, shown from the first click of the last bar.
3. **Label the button "Send diagnostics", not "Save diagnostics".** *Settled in 05 D3: "Send" only once a support address is configured and the dialog names it; until then "Save diagnostics", which is what the mockups now show.* The owner wants the team to get them. The button opens a short dialog that is honest about the mechanism: what is in the file, then "Share…" where the browser can share files (`navigator.canShare({ files })`), and "Save file" always. No backend is added (R9).
4. **The dialog carries the detection engineer's sound opt-in.** `01-ux.md` §15.4 says the file never holds the voice; `03-detection.md` adds an opt-in (`includeAudio`, off). They do not conflict if the switch is off by default, reads "Keep the sound of my next tries for diagnostics", and says it applies from the next try. The dialog states "This try has no sound" when that is true.
5. **One more live mark: "heard, not sure yet".** *Rejected in 05 D5 and removed from every board: an unsure note shows nothing live.* `01-ux.md` §15.1 allows only red and green live at difficulties 1 to 3. When the follower is not yet sure (frames do not agree, steady part not reached), a hollow grey ring sits in the lane instead of a red mark or nothing. It resolves after the try and never turns red live. Red is drawn only when the follower is sure. This is the "calmer marks when the app is unsure" the owner needs: something was heard, nothing is wrong yet.
6. **Key chips wrap at most once only up to about eight keys.** True at difficulties 1 to 4. From the difficulty where more keys exist, Key becomes one chip-button with the current value ("Any key ▾") that opens the same chips in a popover grid. *Drawn after the critique: `practice-d5`, `practice-d10`, `practice-d10-keys`.*
7. **The status strip says "Not listening yet" during the starting pitch**, *now "Marks start at bar 1" (05 D7)*, in place of the mic meter. It makes the rule "nothing before bar 1 is judged" visible, which is what the purple marks broke.

Everything else in `01-ux.md` stands as written.

## 1. Practice (`practice.html`)

Owner points 4, 6, 7, 8, 5, 3. PNG: `practice-desktop-*.png`, `practice-phone-*.png`.

- **No scrolling at 1440 x 900 or 390 x 844.** Checked by the render script, which reports any viewport-only page taller than the window. Desktop content ends at about 795 px; phone at about 700 px, above the tab bar.
- **Header line** (desktop): "Practice", then "Streak 1 day · 3 tries · 18 XP today", then the rank "Novice · 12% to Apprentice" with a small ring, then the calibration pill. Thin rules separate the three. The banner row is gone.
- **Right panel** becomes a form with a 112 px label column, so no row needs its own label line:
  - Difficulty: stepper and 10-step meter on one line. Below: the description with a caution tag "Few pieces" (tooltip has the full sentence), then "Follow my progress" on the left and "Simpler? Match a note first" on the right. The "At difficulty 1: C3 to C4" line is gone (it is on the left card).
  - Key: one row of 42 px chips, each with a 28 px drawn signature: Any key, C major, F major, G major. Under it, one line: "Difficulty 1 uses major keys with up to 1 sharp or flat. Minor keys start at difficulty 2."
  - Time signature: segmented Any, 4/4, 3/4 (caution dot, tooltip "Few pieces"), with "No 2/4 at difficulty 1 yet." on the same line.
  - Tempo: segmented Any or Set (Set shows the ♩ stepper in place), range "♩ = 60 to 76". Length shares the row at the right: "Length 8 bars". When several lengths exist, it becomes a small segmented control in the same place.
  - Mode: Ranked (caution glyph, disabled) and Practice. One hint line: "Less XP, no time limit. Ranked needs calibration on this device. Calibrate" with Calibrate as the link. No second button.
  - Foot: "Choosing Any: +16% XP", Start (Space), then "Last try: **B** 84, Melody in F major · All tries".
- **Higher difficulties** (`practice-d5`, `practice-d10`, `practice-d10-keys`; content ends at about 790 px, no scrolling at 1, 5 or 10):
  - Key: when there are more than eight keys, one button with the current value ("Any key ▾") and the count beside it ("18 keys: major and minor, up to 4 sharps or flats."). It opens a popover: Major and Minor groups, five chips a row, ordered by number of sharps and flats, each with its drawn signature; Any key at the foot.
  - Time signature: every meter in the segmented control while there are seven or fewer (difficulty 5). Above that, Any, the five most used, and "More 15 ▾", which opens the rest; a meter chosen there takes the More button's place.
  - Length: its own row, segmented Any, 8, 9, 10 (… 12), when there is a choice. At difficulty 1 and 2 it stays plain text in the Tempo row.
  - "Few pieces" and "Simpler? Match a note first" show only where they apply (difficulty 1).
- **Left card**: instrument header, "Your range" with a "Play my range" button, the range picture with its four note chips, keyboard and legend, then a "Match a note" row: tuning-fork badge, "Match a note", "Sing one note and see if you hit it. Not graded.", chevron.
- **Phone**: title, then "Streak 1 day · 3 tries · 18 XP"; the line wraps under the title rather than drop a word. Summary chips put the label on its own line and the chevron on the value line, so no label can reach its chevron. Summary card: instrument row (ruler, "C3 to C4 at difficulty 1"), chips in a 3 + 2 grid (Difficulty, Key, Time signature; Tempo, Length), then the calibration line as the card's last row ("Not calibrated", "Calibrate ›"). Mode with one hint line, Start, the last-try line, then "Warm up: match a note". "Time signature" is never shortened.

## 2. Calibration status (`cal-status.html`, desktop board)

Owner point 4. Why the banner came back is in `01-ux.md` §4 (only accepted runs are stored, dismiss was in memory only, banner and Ranked used different tests). Design:

- A pill button in the Practice header, a line under "Start playing" on the read-through, the last row of the phone summary card, a line under the meta line on the phone read-through, and the first item of the read-through's phone menu (`scan-menu-phone-*.png`).
- States: "Not calibrated" (speaker glyph, ink-2), "Calibrated for MacBook Pro Speakers · today" (green tick, ink-2), "Output changed to AirPods. Calibrate again" (caution glyph and caution tint, the only coloured state), "Calibration didn't finish" (ink-2).
- Pressed: a popover with a title, the detail line from `01-ux.md` §4, and "Calibrate" or "Calibrate again" plus "Settings". On the read-through the popover adds "We'll bring you back to this music after."
- When the header is narrow, the calibrated text shortens to "Calibrated · today"; the popover names the output.

## 3. Instrument picker with sound (`picker-sound.html`, `picker-states.html`)

Owner point 2. PNG: `picker-sound-*`, `picker-states-desktop-*`.

- Selected panel: "Play my range" (secondary, play glyph) with "or tap one note"; caption "Lowest, your notes at difficulty 1, highest."; the range picture.
- **Playing**: the button becomes "Stop" with a brass outline; a live caption "Playing C3"; four small step dots (2 of 4). The sounding note's chip turns brass with a speaker glyph, its notehead turns brass with a soft halo, and its key on the keyboard is brass. Each note 0.8 s, 0.15 s apart, rising.
- **"This is how it will sound"** line under the picture: "This is how it will sound. The starting pitch, Listen and Match a note use this sung “ah” in baritone range. It's made by the app, not recorded." The last sentence matters: the six voices are synthesised (`02-sounds.md`), and we should not let the owner think he is hearing a singer. Phone: "This is how it will sound: a sung “ah” made by the app, in baritone range."
- Stand-in sound (an instrument without its own samples, e.g. euphonium on trombone samples): "There's no euphonium sound yet. You'll hear a trombone." (`picker.play.fallback`). Audio blocked, in the caution tone: "That sound didn't play. Check your volume and try again."
- The four step dots sit right after "Playing C3". Choosing another card, closing the picker or pressing Stop ends the sound at once.
- Nothing plays when a card is chosen.

## 4. Match a note (`match.html`, `match-hit.html`, `match-states.html`)

Owner point 3. Route `#/match`, focused chrome: back, "Match a note", "Note 1 of 5" with five dots.

- **Target**: the note on a small staff (no barline), and its name at 88 px serif ("E3"), "Listen, then sing it." beneath.
- **State line** at 46 px serif, readable at a metre: "A little low. Go up." with the chevron on the left (the needle's side), "A little high. Go down." with the chevron on the right, "You hit it: E3." in green with a tick. Quiet states (listen, listening, no signal) are 22 px sans in ink-2.
- **"You" line**: "You: E3, 34 cents low". A hit reads "You: E3, 6 cents high". The octave line ("An octave lower. That counts.") shows only when the sung octave is inside the voice's full range; for a baritone at E3 that rules out E2.
- **Meter**: 760 px wide (full width on phone), 64 px track, ±50 cents. The in-tune band (difficulty 1 voice, ±25 cents) is a green wash with green edges and a green centre tick. The needle is 12 px wide and 104 px tall with an arrowhead, ink outside the band and green inside it. Labels Low, In tune, High. Flat and sharp are never red: this is a warm-up, not a grade.
- **States** (board, both sizes): 1 idle (the note plays, ring on the note, meter dimmed, "The note plays for 1.5 seconds. The microphone opens after it."), 2 listening (meter live, no needle, "Sing E3 and hold it.", mic level), 3 flat, 4 sharp, 5 hit (green note ring and needle, dot filled green), 6 no signal after 6 s ("We can't hear a steady note yet." and "Move a little closer to the mic and hold one note.").
- **Actions**: "Play it again"; "Or tap a note in your range: C3 E3 G3 C4". On phone both sit at the bottom, thumb reach, with Play it again full width.
- **More states** (board 7 to 12): too far low and too far high ("Higher. Try E3.", needle held at the edge), right note wrong octave (instruments), no microphone ("Allow microphone"), the round summary ("4 of 5 hit. On average you were 8 cents low.", Five more, Done), and the onboarding step.
- **Moving on**: in a round the next note comes 1.5 s after a hit. A note chosen from the range chips stays until another is chosen. The onboarding step never moves on by itself.
- **Onboarding "Sing one note"** (`match-onboarding.html`): the same screen with the onboarding title and lead, Skip at the top right, and Play it again and Continue after a hit. No range chips, no dots.

## 5. Before you sing (`before-reference.html`, `before-countin-last.html`, `before-frames.html`)

Owner points 10 and 11. The frames board is the build spec: 16 frames, each with its time from Start, what sounds, and what changes.

- **Cue zone**: a fixed band at the top of the score paper, 232 px on desktop and 196 px on phone. The reference card and the count-in track both live there, so the music never moves between the reference, the count-in and bar 1.
- **Reference** (voice only). Times come from the code: `VOICE_REFERENCE_LEAD_SEC` (0.1 s), `VOICE_REFERENCE` (chord tones 0.5 s with 0.05 s gaps, one more gap, first note 1.0 s) and `AFTER_REFERENCE_SEC` (0.5 s). The build reads them, so the board cannot drift.
  - R0, 0 s: the card appears with the press of Start; 100 ms later the first tone. Card: pitch glyph, "Your starting pitch", "So you know where to begin: the key chord, then your first note. You don't need to sing yet.", two pending steps "Key chord" and "First note". Score dimmed to 55% (later systems 30%). Status strip: "Starting pitch", "Marks start at bar 1".
  - R1, 0.1 s: F, A, C at 0.10, 0.65 and 1.20 s, 0.5 s each. Brass band on the key signature of the first system only. Step "Key chord: F major" live.
  - R2, 1.8 s: F3 for 1.0 s. Band goes; brass ring and "F3" on the first note.
  - R3, 2.8 s: 0.5 s of silence; the tone's room tail is not counted as the player's. Both steps ticked, "Count-in next".
- **Count-in** (C1.1 to C2.4, 3.3 s to 10.3 s): a line above a track of eight cells and the word Sing. From the first click every system is at full ink: dimming is for the starting pitch only.
  - Bar 1: dashed grey cells, the current one filled grey with its number large. Line: "Count-in: listen to the beat", "Count-in bar 1 of 2 · ♩ = 60".
  - Bar 2: brass cells, current one solid brass with a glow. Line in brass: "Come in after 4", "Count-in bar 2 of 2 · ♩ = 60". From its first click the first note gets its brass ring and "Sing" label.
  - C2.4, the last beat: cell 4 solid brass, and the word "Sing" gets a brass underline. Sing is a word at the end of the track, not a control: no glyph, no border, `aria-hidden`, and said in the live announcement. Nothing else moves. This is the one frame with an extra highlight, so it is the one the eye cannot miss.
  - No word on any beat. The status strip says "Count-in" with the mic meter (no second set of beat dots).
- **Music** (M1, 11.3 s): track gone, cue zone empty, the ring on the first note pulses once (300 ms) and fades, status "Bar 1 of 8". M2: the first green dot.
- Instruments skip R0 to R3.

## 6. Read-through (`scan.html`, `scan-menu.html`)

Owner points 12, 13, 14.

- No coach mark.
- Under the score: "Read it through. Start when you are ready." There is no timer in Practice; the mode chip just says "Practice".
- Under Start playing: "Not calibrated · Calibrate". Phone: the same line under the meta line, always visible; it stays in the menu too.
- Sounds group: "When you start: your starting pitch, then two bars of clicks." (instruments: "When you start: two bars of clicks."). "Nothing plays during the try" is gone; it was not true for a voice.
- **"Look before you play"**: "Five things to spot before you start." Five rows, no boxes, no letters, no STARS. Each row: a short label in ink-2 (Key and time, Tempo, Accidentals, Rhythm, Shape), then this piece's fact in ink ("F major, 1 flat: B♭. 4/4, felt in 4."), then one short line of advice in ink-2. A row whose fact is "None in the music" has no advice line. Phone peek: "Look before you play" with a chevron, no count.
- Desktop: the list sits under the score in the left column, one line per row (label, fact, advice). The page no longer scrolls at 1440 x 900 (`scrollHeight` 900).

## 7. Calmer live marks (`live-calm.html`, `live-marks.html`)

Owner point 15. With the tolerance from `03-detection.md` the trailing voice is part of its note, so the rest after bar 4's half note stays clean.

- Live at difficulties 1 to 3: green dot when the app is sure a note is right, red only when it is sure it is wrong (here one flat note in bar 2), nothing otherwise. No grey ring. No violet ghost or "+" during the try. Marks on a system already left fade to 70%.
- The board puts round 1 (violet B♭ ghost and "+" in the rest, a red flash on the scoop) beside round 2, and shows a results score of an Unsure try with its extra at 50%.

## 8. Results, tries and diagnostics (`results.html`, `send-diagnostics.html`)

Owner points 5 and 15.

- Copy uses "try" and "mistake" throughout: "Solid. A few mistakes.", "Next piece", "Previous mistake", "My marks / Clean score".
- Under the actions: "2 tries at this piece · See all tries" (history glyph), or "See all tries" for a first try. On phone it sits under the reason line.
- Phone: a sticky bar at the bottom with Next piece and Try again, so the next step never sits below the score. Change setup stays at the end of the page.
- Score toolbar: My marks / Clean score, a mistake stepper ("Mistake 1 of 3" with arrows), "Show what we heard" switch, Slower, Listen.
- "Not calibrated: timing marks may be a little off." is the only calibration line, and it is plain text.
- "How it went" ends with the "How sure we are" line in a quiet box with a 3-bar level glyph: "We heard you clearly. 27 of 28 notes were steady and clear." Under it: "Marks look wrong? Save what the app heard for the team." and a tertiary "Save diagnostics" ("Send diagnostics" and "Email it to {address}." once a support address is configured, 05 D3).
- **Save diagnostics dialog** (sheet on phone): "A file of what the app heard in this try, for the Sightread team to look at. No recording of your voice.", three bullets (notes, marks and changes, settings and device with no names), the sound opt-in switch (off), the file name `sightread-try-2026-11-19-1432.json` and size, a pointer to Settings › Data for recent tries, then Cancel, Share… (where the browser can share files), Save file.
- **Settings › Data** (`settings-data.html`): "Export diagnostics for recent tries", one file with every stored trace (the last 20), named `sightread-tries-{yyyy-mm-dd}-{hhmm}.json`; the sound opt-in switch; a pointer to Display for "Show what the app hears".

## 9. History and a previous try (`history.html`, `history-all.html`, `try.html`, `try-heard.html`)

- **List**: grouped by day. Each row: grade letter (serif) and score, or "Not graded" in words; title; summary; time and mode at the right (under the summary on phone); chevron. A not-graded row adds why ("we couldn't hear you").
- **Day groups count tries** with the one definition (every try started today that reached bar 1, graded or not): "Today · 3 tries", the same 3 as the Practice header and streak line. Filtered: "Today · 3 tries, 2 at this piece".
- **Filtered from results**: a dark "This piece ×" chip and "Showing 2 of 4 tries: the ones at Melody in F major. Show all tries".
- **Try detail**: title, summary and time; "Try 2 of 2 at this piece" with previous and next buttons; grade, score, mode and the calibration note; the marked score with My marks / Clean score, mistake stepping, "Show what we heard", Listen, and the primary "Hear what we heard" (playback glyph).
- **Show what we heard on** (`try.html`): the pitch track as a thin grey line over each note: a short scoop in, the held pitch, and a fall after the half notes into the rest of bar 4. One line above the score says what it is: "The pitch we heard. A line that falls after a note is your voice trailing off: it is part of that note, not a new one."
- **Hear what we heard playing**: the button becomes Stop with a brass outline. The caption has its own reserved line under the toolbar, so nothing moves when it starts: "What we heard, bar 3 of 8" and "The notes we detected, in your instrument's sound. Not a recording." The bar highlight follows.

## 9a. Error screens (`error-sound.html`, `error-mic.html`)

Only sound that did not start or a microphone that did not open stop a try (`01-ux.md` §9); a clock-rate result never does. Each screen: an icon, the heading, one sentence of cause, "Your piece is kept. Try again starts it from the beginning.", Try again (primary), Back to Practice, and "Save diagnostics" under "Keeps happening? Save what the app saw for the team."
- "How it went", the sure line and Send diagnostics, as on results.

## 10. New or changed copy (beyond `01-ux.md`)

| Key | Text |
| --- | --- |
| `picker.play.or` | or tap one note |
| `picker.sound.line` | This is how it will sound. The starting pitch, Listen and Match a note use this sung “ah” in {voice} range. It's made by the app, not recorded. |
| `picker.sound.line.short` | This is how it will sound: a sung “ah” made by the app, in {voice} range. |
| `picker.sound.instrument` | This is how it will sound. The starting pitch, Listen and Match a note use this {instrument} sound. |
| `home.matchEntry.body` | Sing one note and see if you hit it. Not graded. (instruments: "Play one note…") |
| `setup.difficulty.matchHint` | Simpler? Match a note first. |
| `setup.time.noneShort` | No {meter} at difficulty {level} yet. |
| `calStatus.ok.short` | Calibrated · {when} |
| `calStatus.readthrough.none` | Not calibrated · {link} (link: Calibrate) |
| `match.hint.idle` | The note plays for 1.5 seconds. The microphone opens after it. |
| `match.listening` | Sing {note} and hold it. |
| `match.hint.listening` | The needle moves when we hear a steady note. |
| `match.youCents` | You: {note}, {cents} cents {direction} |
| `match.hint.flat` | Lift it a little until the needle sits in the middle. |
| `match.hint.sharp` | Ease it down a little. |
| `match.hint.hit` | Next note in 1.5 seconds. |
| `match.hint.far` | Slide up slowly. The needle comes in when you are close. (down: "Slide down slowly…") |
| `match.hint.octave` | Instruments match the octave. Voices do not need to. |
| `match.summary.note` | Nothing is graded or saved. Practice and History are unchanged. |
| `match.onboarding.hint` | You're ready. Continue when you like. |
| `match.target` | Listen, then sing it. (instruments: "Listen, then play it.") |
| `countIn.marksStart` (was `countIn.notListening`) | Marks start at bar 1 |
| `scan.sounds.whenStart.voice` | When you start: your starting pitch, then two bars of clicks. |
| `scan.sounds.whenStart.instrument` | When you start: two bars of clicks. |
| `picker.play.fallback` | There's no {instrument} sound yet. You'll hear a {standIn}. |
| `setup.key.many` | {n} keys: major and minor, up to {max} sharps or flats. |
| `setup.key.pick` | Pick one key, or Any for more XP. |
| `setup.time.more` | More |
| `results.mistakeOf` | Mistake {n} of {total} |
| `results.showHeard.key` | The pitch we heard. A line that falls after a note is your voice trailing off: it is part of that note, not a new one. |
| `heard.caption.note` | The notes we detected, in your instrument's sound. Not a recording. |
| `history.day` | {day} · {n, plural, one {# try} other {# tries}} |
| `history.day.piece` | {day} · {n} tries, {m} at this piece |
| `error.kept` | Your piece is kept. Try again starts it from the beginning. |
| `error.diagnostics.prompt` | Keeps happening? Save what the app saw for the team. |
| `settings.data.diagnostics.lead` | What the app heard in each try, so the team can see why a mark appeared. Kept on this device for your last 20 tries. |
| `settings.data.exportDiagnostics.hint` | One file with all {n} tries: notes, timings, marks and settings. No recording of your voice. |
| `look.label.signatures` / `.tempo` / `.accidentals` / `.rhythm` / `.signs` | Key and time / Tempo / Accidentals / Rhythm / Shape |
| `diagnostics.prompt` | Marks look wrong? Save what the app heard for the team. (with an address: "Marks look wrong? Send us what the app heard.") |
| `diagnostics.title` | Save diagnostics (with an address: Send diagnostics) |
| `diagnostics.recentPointer` | Recent tries, all in one file: Settings › Data. |
| `diagnostics.body` | A file of what the app heard in this try, for the Sightread team to look at. No recording of your voice. |
| `diagnostics.item.notes` | Every note we heard: when, how long, what pitch, how sure |
| `diagnostics.item.marks` | Every mark, and the ones that changed after the try |
| `diagnostics.item.setup` | Your settings, calibration and device, no names |
| `diagnostics.keepSound` | Keep the sound of my next tries for diagnostics |
| `diagnostics.keepSound.hint` | Off. It stays on this device and is only in a file you send. |
| `diagnostics.noSound` | This try has no sound. |
| `diagnostics.save` / `diagnostics.share` | Save file / Share… |
| `history.filter.pieceLine` | Showing {n} of {total} tries: the ones at {title}. |
| `heard.note` | Hear what we heard plays the notes we detected, in your instrument's sound. It is not a recording. |
| `sure.clear` (with count) | We heard you clearly. {steady} of {total} notes were steady and clear. |

## 11. Not drawn this round

- The phone "Look before you play" sheet: the same rows as desktop.
- Settings › Display with "Show what the app hears" and "Show played notes live": copy is in `01-ux.md` §15.
- Nobody has heard the sounds yet. The picker line assumes the formant voice is good enough to call "a sung ah"; if the owner finds it unconvincing, the choir set (`02-sounds.md`) is the fallback, and the line stays true.

## 12. Files

- Build: `docs/redesign/mockups/_build/round2.mjs` (new), `render2.cjs` (new), `engrave.mjs` (additions only: extras in rests, the "unsure" lane mark (no longer used), rings on notes, a playing note in the range picture, a pressed key, first-system key highlight, a staff without a final barline, the pitch trace).
- Styles: `docs/redesign/round2/mockups/round2.css` on top of `docs/redesign/mockups/mockup.css`.
- Pages (27): `practice`, `practice-d5`, `practice-d10`, `practice-d10-keys`, `cal-status`, `picker-sound`, `picker-states`, `match`, `match-hit`, `match-states`, `match-onboarding`, `before-reference`, `before-countin-last`, `before-frames`, `scan`, `scan-menu`, `live-calm`, `live-marks`, `results`, `send-diagnostics`, `history`, `history-all`, `try`, `try-heard`, `error-sound`, `error-mic`, `settings-data`.

## Changes after critique

Each required change in `05-critique.md` §4, in order. "Done" means the board is redrawn and re-rendered (light and dark) and the PNG was looked at. Disagreement rulings D1 to D7 are applied: D3 ("Save diagnostics" until a support address is configured) on results, try detail, the dialog and the error screens; D5 (no grey ring) on every board; D7 ("Marks start at bar 1") on the strip and frames.

| # | Change | Status | Where, or why not |
| --- | --- | --- | --- |
| 1 | Phone chip label never meets its chevron | Done | Label on its own line, chevron on the value line (`practice-phone`). "Time signature" now has the full chip width. |
| 2 | Phone today line keeps "Streak" | Done | "Streak 1 day · 3 tries · 18 XP"; the line may wrap under the title, never drops words. |
| 3 | One count of tries today | Done | 3 everywhere: Practice header (desktop and phone), the streak line, `cal-status`, History "Today · 3 tries". Filtered History: "Today · 3 tries, 2 at this piece". |
| 4 | Right panel at difficulty 5 and above, no scrolling | Done | `practice-d5`, `practice-d10`, `practice-d10-keys`. Measured `scrollHeight` = 900 at 1440 x 900 for difficulties 1, 5 and 10. |
| 5 | Owner hears the voices before build; choir never for the starting pitch or Match a note | Done in spec, not mine to finish | The rule is in §3 and below. The listening session and the PLAN entry need the owner; I have not written his choice into PLAN. |
| 6 | Stand-in line makes no promise | Done | "There's no euphonium sound yet. You'll hear a trombone." (`picker.play.fallback`). The audio-blocked line now has the caution tone. |
| 7 | Step dots next to "Playing C3" | Done | `picker-sound`, desktop. |
| 8 | Switching cards stops the sound | Done in spec | Behaviour, stated on `picker-states` and in §3. The audio-node test is for the build. |
| 9 | Missing Match a note states | Done | `match-states` 7 to 12 (too far low and high, wrong octave, no microphone, round summary with Five more and Done, onboarding with Continue and Skip); full screen `match-onboarding`. |
| 10 | The hit example must be possible | Done | "You: E3, 6 cents high". The octave line shows only inside the voice's full range (§4). |
| 11 | Direction in words | Done | "A little low. Go up." and "A little high. Go down."; the chevron sits on the needle's side of the words. |
| 12 | No auto-advance in onboarding; 1.5 s in a round; chosen chip stays | Done | Copy "Next note in 1.5 seconds."; onboarding shows Continue and waits; rule in §4 and on the board lead. |
| 13 | Read-through Sounds says what plays at Start | Done | "When you start: your starting pitch, then two bars of clicks." (instruments: "… two bars of clicks."). |
| 14 | "Marks start at bar 1" | Done | Status strip on `before-reference` and every R and C frame. Key `countIn.marksStart`. |
| 15 | The Sing cell is not a control | Done | No play glyph, no border, no fill; the last beat underlines the word. `aria-hidden` cell, word in the live announcement. |
| 16 | Full ink from the first click | Done | `before-countin-last` and the C frames: all systems at 100%. Dimming only in R0 to R3. |
| 17 | Frame times from `VOICE_REFERENCE` | Done | The build reads `take-plan.ts` and `practice-session.ts`. The times changed: first tone 0.1 s (not 0.6), first note 1.8 s, count-in 3.3 s, bar 1 11.3 s. Note: with a 100 ms lead the card is on screen only a moment before the first tone. If the team wants the card read first, raise `VOICE_REFERENCE_LEAD_SEC` to 0.6; the board follows on the next build. |
| 18 | No mark before bar 1, re-run the bleed test with voice samples | Done in the boards; test is for engineering | No frame before M1 draws any mark. The re-run of the `03-detection.md` bleed test with the new samples is an engineering task. |
| 19 | Read-through desktop does not scroll | Done | "Look before you play" moved under the score, one line per row. `scrollHeight` = 900. |
| 20 | "Not calibrated · Calibrate" | Done | `scan`, `cal-status`. |
| 21 | Phone calibration line on screen | Done | Under the meta line on `scan-phone`; still first in the menu, with "Calibrate before this try. We'll bring you back here." |
| 22 | "None in the music" has no advice | Done | Accidentals row. |
| 23 | No grey ring | Done | Removed from `live-calm` and `live-marks`; the legend says "Not sure yet: nothing". |
| 24 | "2 tries at this piece · See all tries" | Done | `results`, desktop and phone. |
| 25 | Draw "Show what we heard" | Done | Switch in the score toolbar on results and try detail; `try` shows it on, with the trailing tails visible next to their notes and a one-line key. Settings pointer on `settings-data`. To fit, mistake stepping became "‹ Mistake 1 of 3 ›". |
| 26 | Playback glyph; caption on its own line | Done | `try`, `try-heard`: play glyph; reserved caption line under the toolbar, so the buttons do not move. |
| 27 | Error screens with Try again, Back to Practice, diagnostics | Done | `error-sound`, `error-mic`. The clock-rate test (fake backend reaches the count-in; reason `ranked.reason.clockRate`) is for the engineers fixing the clock check. |
| 28 | One diagnostics file name | Done in the design; code change declined here | The dialog shows `sightread-try-{yyyy-mm-dd}-{hhmm}.json`. `src/session/diagnostics.ts` still writes `sightread-diagnostics-{id8}.json`, and its test lives in `practice-session.test.ts`, which another engineer is changing now. Hand-off: `diagnosticsFileName` should build the name from the try's start time in local time; the multi-try export is `sightread-tries-{yyyy-mm-dd}-{hhmm}.json`. |
| 29 | Settings › Data export for recent tries | Done | `settings-data`: Export (one file, last 20 traces), the sound opt-in (off, from the next try; still needs the owner's ruling, D4). |
| 30 | Phone results: next step reachable | Done | Sticky bar with Next piece and Try again (`results-phone`, `results-phone-scrolled`). |

Also fixed from the score table: `cal-status` now shows the calibrated and failed states for the phone card and the read-through line.
