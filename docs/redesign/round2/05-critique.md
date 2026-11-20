# Round 2: UX critique of the design

Role: principal UX, same as `01-ux.md`.
Read: `04-design.md`, `01-ux.md`, `02-sounds.md`, `03-detection.md`, PLAN rulings, and all 72 PNGs in `docs/redesign/round2/mockups/png/` (every board, light and dark, desktop and phone).
Result: the design answers 12 of the owner's 15 points in full and 3 in part. Seven disagreements are settled below; `01-ux.md` is updated to match. 30 required changes follow, each one checkable on screen or in a test.

## 1. Scores

Scores are for the board as a build spec, light and dark together. 10 means build it as drawn.

| Board | Score | Why, in one line |
| --- | --- | --- |
| `practice` desktop | 9 | No scrolling, one form column, every owner point on this screen answered. |
| `practice` phone | 7 | Fits one screen, but "Time signature" runs into its chevron, the streak line lost the word "Streak", and the rank is gone. |
| `cal-status` | 8 | Clear states, caution only for "Output changed". No calibrated or failed state for the phone and read-through. |
| `picker-sound` | 8 | Playing state is easy to follow: chip, notehead and key move together. The step dots float far from the button. |
| `picker-states` | 7 | The stand-in line promises a future sound. Audio-blocked line has no tone of its own. |
| `match` | 8 | Readable from a metre, calm, not a grade. "A little low" with an up chevron can read as "high". |
| `match-hit` | 6 | The example is impossible: a baritone an octave under E3 sings E2, below his range (G2). |
| `match-states` | 7 | Six good states, but "too far", "wrong octave", the round summary and "no microphone" are missing. |
| `before-reference` | 8 | Answers "why is it playing a tone": the card says what is coming before any sound. |
| `before-countin-last` | 8 | The last bar and the entry are unmistakable. The "▸ Sing" cell looks like a button. Later systems are dimmed while the player should read ahead. |
| `before-frames` | 9 | A real build spec with times. Times must come from the code, not from the board. |
| `scan` desktop | 6 | The page still scrolls. "Nothing plays during the try" is not true for a voice: the starting pitch and count-in play. |
| `scan` and `scan-menu` phone | 6 | The calibration status is hidden in the menu. The owner asked for it to stay on screen. |
| `live-calm` | 6 | Calmer, but adds a new grey mark the owner never asked for (settled in D5). |
| `live-marks` | 8 | The before and after makes the change obvious. Keep as the reference for the gate. |
| `results` | 7 | "Try 2 at this piece" reads as an instruction ("try two"). Phone actions sit below the fold. |
| `send-diagnostics` | 7 | Honest about content. Nowhere says where to send the file. |
| `history` (filtered) | 8 | The filter line explains itself. |
| `history-all` | 7 | Shows 3 tries today; the Practice header in the same state says 2. |
| `try` | 7 | Good. Mic glyph on "Hear what we heard" suggests a recording. The pitch trace overlay is not drawn. |
| `try-heard` | 7 | Caption follows the bar. The toolbar reflows while playing. |

Average 7.4. The weak boards are the new or reworked screens (match states, read-through, live marks), not the restyle.

## 2. The owner's 15 points

| # | Point | Answered | Where, or what is missing |
| --- | --- | --- | --- |
| 1 | The design looks better | Yes | No restyle; new pieces use existing tokens. |
| 2 | Hear the instrument's timbre in the picker | Yes, pending his ear | `picker-sound`, `02-sounds.md`. The voices are synthesised; the owner has not heard them (R5). |
| 3 | Something simpler: sing one note | Yes | `match`, `match-hit`, `match-states`, Practice entry, onboarding step. States missing (R9). |
| 4 | Calibration status on screen, not a banner | In part | Desktop yes. Phone read-through hides it in the menu (R15). |
| 5 | "Tries", and see previous attempts | Yes | Copy throughout; `results` link, `history`, `try`, `try-heard`. Link label fixed in R20. |
| 6 | Tighter right panel, no scrolling | Yes | `practice` fits 1440 x 900 and 390 x 844. Higher difficulties not shown (R4). |
| 7 | "More keys from difficulty 2" | Yes | "Difficulty 1 uses major keys with up to 1 sharp or flat. Minor keys start at difficulty 2." |
| 8 | "Time signature" | Yes | Row, phone chip, read-through. |
| 9 | "The device's audio clock is running at the wrong speed" | In part | `01-ux.md` §9 decides it; no error screen is drawn (R27). |
| 10 | A tone and purple marks at the start | Yes | `before-reference`, `before-frames`; cause confirmed in `03-detection.md` §1 (the reference through the speakers). Expectation set in R13. |
| 11 | Count-in: when does it stop, when do I start | Yes | `before-countin-last`, `before-frames`. |
| 12 | "Reading time's up. Start when ready." | Yes | Deleted; one line under the score. |
| 13 | Remove the what's-new bubble | Yes | `scan` has none. |
| 14 | "Before you play" ticks | Yes | "Look before you play", no boxes, no self-ticking. |
| 15 | Trailing voice heard as notes; tolerance; diagnostics | In part | Tolerance in `03-detection.md`; calm live marks; diagnostics dialog. The pitch trace on results ("Show what the app hears", `01-ux.md` §15.4) is not drawn, and it is the one picture that shows him his own tail (R25). |

Not fully answered: 4, 9 and 15. Point 2 is answered on paper but only the owner's ear can close it.

## 3. Disagreements, settled

| # | Designer's position | Ruling | Reason |
| --- | --- | --- | --- |
| D1 | Keep the 2-bar count-in at difficulties 1 to 3 | **Designer wins.** `countInBars` stays as it is. `01-ux.md` §0 item 10 and §11 changed. | The owner called two bars "normal". His problem was not knowing which bar was last. The new track fixes that. At ♩ = 60 one bar after a starting pitch is short for a beginner. |
| D2 | No line joining the track to the first note | **Designer wins.** | Same word and colour at both ends is enough. `01-ux.md` §11 changed. |
| D3 | "Send diagnostics", not "Save diagnostics" | **Designer wins, with a condition.** The dialog must say where the file goes: "Email it to {supportEmail}." from config. While no address is configured, the button and title read "Save diagnostics" and that line is absent. | A "Send" button that only saves a file, with nowhere named to send it, is a promise the app does not keep. |
| D4 | The sound opt-in sits in the diagnostics dialog | **Designer wins.** Off by default, applies from the next try. Also in Settings > Data. This is an exception to PLAN R9 and needs the owner's ruling before it ships. | It is the only way the team can replay a real voice (`03-detection.md`, "Left open"). |
| D5 | New live mark: hollow grey ring, "heard, not sure yet" | **Rejected.** An unsure note shows nothing live. It resolves on the results. | The owner's complaint is marks he did not intend. A new mark type, live, is more of that. The mic meter already shows that he is heard. `01-ux.md` §15.1 now says this in words. |
| D6 | Key chips become a popover from the difficulty with many keys | **Designer wins, but draw it.** | "No scrolling" must hold at every difficulty, not only at 1. |
| D7 | Status strip "Not listening yet" during the starting pitch | **Agreed in purpose, changed in words:** "Marks start at bar 1". | The microphone is open (the browser shows it), so "not listening" is not true. What the player needs to know is that nothing is judged yet, and when that ends. |

## 4. Required changes

Each is testable: a screenshot, a DOM query or a unit test can show it is done.

### Practice

1. Phone summary chips: no label overlaps its chevron at 390 px. Test: the label's bounding box and the chevron's do not intersect for Difficulty, Key and Time signature, in English.
2. Phone today line keeps the word: "Streak 1 day · 2 tries · 18 XP". If it does not fit, it wraps under the title; it does not drop words.
3. One definition of "tries today": every try started today that reached bar 1, graded or not. The Practice header, the History day group count and the streak line use the same number. Test: seed 2 graded and 1 not-graded try today; all three places say 3.
4. Draw the Practice right panel at difficulty 5 or above (keys popover, three meters, more lengths). It must fit 1440 x 900 with no scrolling. Test: `scrollHeight <= clientHeight` at difficulties 1, 5 and 10.

### Instrument picker and sounds

5. Before build, the owner hears `sounds-demo.html` on his Mac: the formant baritone beside the choir. His choice is recorded in PLAN. The choir set is never used for the starting pitch or Match a note, because its ensemble detuning (±20 to 34 cents, `02-sounds.md`) is as wide as the in-tune band.
6. Stand-in line makes no promise: "There's no euphonium sound yet. You'll hear a trombone." Key `picker.play.fallback`.
7. The four step dots sit next to "Playing C3", not at the panel's far edge.
8. Switching cards while a sound plays stops it. Test: select Bass during playback; no audio node from the baritone set is still running.

### Match a note

9. Draw and build the missing states: too far (with up or down), right note wrong octave (instruments), no microphone, round summary with "Five more" and "Done", and the onboarding variant with Continue and Skip.
10. The hit example must be possible: a baritone at E3 hits "You: E3, 6 cents high". The octave line appears only when the sung octave is inside the voice's full range.
11. The direction cue is a word, not only a chevron: "A little low. Go up." and "A little high. Go down." The chevron stays, next to the needle side.
12. A hit does not move on by itself in the onboarding step. In a round, the next note comes after 1.5 s, and tapping a range chip stays on that note until another is chosen.

### Before the music

13. For voice, the read-through Sounds group says what will play when he presses Start: "When you start: your starting pitch, then two bars of clicks." Replace "Nothing plays during the try" with that line. For instruments: "When you start: two bars of clicks."
14. Status strip during the starting pitch: "Marks start at bar 1" (D7). Key `countIn.notListening` renamed `countIn.marksStart`.
15. The "Sing" entry cell is not a control: no play glyph, no button border, `aria-hidden` cell with the word inside the live announcement. Test: no focusable element and no `button` role in the count-in track.
16. From the first count-in click, every system is at full ink. Dimming is for the starting pitch only. Readers need to look ahead.
17. Frame timings are taken from `VOICE_REFERENCE` (`src/session/take-plan.ts`), not from the board's numbers. Test: the card's step changes within 50 ms of each `ReferenceTone.atSec`.
18. No mark of any kind is drawn before bar 1 beat 1 (minus the match window), with the starting pitch played as samples through the speakers. Test: the `03-detection.md` bleed test re-run with the new voice samples instead of the sine.

### Read-through

19. Desktop: no page scrolling at 1440 x 900. "Look before you play" moves under the score in the left column, where the space is empty. Test: `scrollHeight <= clientHeight`.
20. The calibration line under Start playing reads "Not calibrated · Calibrate". Drop "tries count as practice": an uncalibrated player cannot be in Ranked, so the clause adds nothing.
21. Phone: the calibration status is visible without opening a menu, as one line under the meta line ("Not calibrated · Calibrate"). It stays in the menu too.
22. "Look before you play": a row whose fact is "None in the music" drops its advice line.

### Live marks

23. No grey ring, live or after (D5). Live at difficulties 1 to 3: green dot when sure it is right, red when sure it is wrong, nothing otherwise. Test: the trailing-voice gate run at difficulty 1 shows no element with the unsure class during the try.

### Results, tries, history, diagnostics

24. Results link: "{n} tries at this piece · See all tries" (opens History filtered), or "See all tries" when this is the first. Never "Try 2 at this piece", which reads as an instruction. Key `results.tries.atPiece`.
25. Draw and build "Show what the app hears": the pitch trace as a thin grey line on the results and try detail score, with tails visible next to their notes. The toggle sits in the score toolbar ("Show what we heard") as well as in Settings, so the owner can find it at the moment a mark looks wrong.
26. "Hear what we heard" uses the playback glyph, not the microphone. Its caption gets its own line under the toolbar, so the buttons do not move when it starts.
27. Draw the error screens of `01-ux.md` §9 ("The sound didn't start", "The microphone didn't open") with Try again, Back to Practice and the diagnostics button. Test: forcing a clock-rate failure in the fake backend reaches the count-in, and the results reason reads `ranked.reason.clockRate`.
28. One diagnostics file name: `sightread-try-{yyyy-mm-dd}-{hhmm}.json`, as in the dialog. Change `src/session/diagnostics.ts` to match.
29. Settings > Data: "Export diagnostics for recent tries" saves one file with every stored trace (the last 20, `03-detection.md` §3). This is how the team gets diagnostics "from each practice" without a backend.
30. Phone results: the primary action is reachable without scrolling past the score. A sticky "Next piece" bar at the bottom, or the actions under the grade.

## 5. What stays as drawn

The Practice desktop panel, the calibration pill and popovers, the picker playing state, the Match a note layout and meter, the starting-pitch card, the two-bar count-in track, the history list and the try detail. Build them as drawn, with the changes above.
