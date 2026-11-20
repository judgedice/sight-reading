# Round 2: final review

Role: final reviewer (principal designer and UX reviewer).
Build: this branch after wave 4, production build and dev server, Chromium with fake capture, 20 Nov 2026.
Walk: as the owner did. Baritone voice, difficulty 1, built-in speakers, desktop 1440 x 900, then phone 390 x 844, each in light and dark. Calibration skipped (the fake microphone cannot hear clicks), so the walk is "Not calibrated" throughout, as the owner's was.

Screenshots: the owner's walk is in `docs/screenshots/owner-<desktop|iphone>-<light|dark>/` (written by `e2e/tour/owner-review.spec.ts`, deviceScaleFactor 2), the screen tour in `docs/screenshots/<desktop|iphone>-<light|dark>/`, and the round 2 boards' screens in `docs/screenshots/round2/` (design QA, `08-qa.md`). The mockups are `mockups/png/`.

Sound: I cannot listen here. Where a point is about sound, the evidence is what the audio graph schedules (sampler note starts counted on `AudioBufferSourceNode.start`, the sample sets fetched) and the unit tests on the sampler.

## The owner's 15 points

| # | Point | Met | Evidence |
| --- | --- | --- | --- |
| 1 | "The design looks much better" | Yes, kept | No restyle this round. Every screen captured in the owner's walk, checked for overflow, raw copy keys and the old words (owner-review point 1). Side by side with the boards: `owner-desktop-light/08-practice.png` and `mockups/png/practice-desktop-light.png`, `14-read-through.png` and `scan-desktop-light.png`, `17-count-in-last-bar.png` and `before-countin-last-desktop-light.png`. |
| 2 | Hear the instrument in the picker, in its own timbre | Yes, by inspection | "Play my range" in the picker and on Practice plays 4 sampler notes from the `voice-baritone` set; the choir set is never fetched for a voice (owner-review point 2; `home.test.tsx` "Play my range plays the four range notes in the instrument sound"; `e2e/audio/sampler.spec.ts` renders every set within 10 cents). Instruments use sampled sets (VSCO 2, Fluid R3, Salamander). Voices use a synthesised sung "ah" per voice type: no licensed solo voice recordings were found (PLAN R62). Whether that sounds like a baritone is for the owner's ear. |
| 3 | An even simpler level: sing one note | Yes | Match a note at `#/match`: one note, a live needle, "You hit it". Entries: onboarding step 5 "Sing one note", the "Match a note" row on Practice, "Simpler? Match a note first" beside difficulty 1, "Warm up: match a note" on phone. Not graded and outside the 1 to 10 scale (PLAN R67). Owner-review point 3 reaches "You hit it" with a sung tone in the fake microphone; `match.test.tsx` covers flat, sharp, octave and not heard. Screens: `owner-*/06-onboarding-sing-one-note.png`, `12-match-hit.png`. |
| 4 | Calibration status should stay on screen | Yes | The banner is gone, and its last component and copy key were deleted in this review (`CalibrationMissingBanner`, `banner.calibrateNeeded`). A quiet pill on Practice ("Not calibrated" with a popover) and a line in the read-through ("Not calibrated · Calibrate"). Why it kept coming back: `07-calibration-cause.md` (a failed run stored nothing, the dismissal lasted one page load, the banner and Ranked used different tests, and the microphone's label changed its route key). The status now comes from the same test as Ranked (`calibration-status.test.ts` "one source of truth", 1,080 combinations). Owner-review point 4. |
| 5 | "Tries", not "takes"; load previous tries | Yes | Every player-facing string uses try and tries (`copy.test.ts`; the owner walk reads every screen, screen-reader text included, for the noun "take"). The streak rule reads "A streak day needs 3 ranked tries." Previous tries: results "See all tries" and Practice "Last try · All tries" open History; a try opens its detail with the marked score, Listen, and "Hear what we heard" (owner-review point 5; `21-history.png`, `22-try-detail-hear-what-we-heard.png`). |
| 6 | Tighter right panel, no scrolling | Yes | At 1440 x 900 the Practice page and every element in it fit: `scrollHeight == clientHeight` (900) at difficulty 1 in this walk; `e2e/setup/practice-fit.spec.ts` "no scrolling at 1440 x 900 (difficulties 1, 5, 10) and 390 x 844 (difficulty 1)". The right panel is a form with a label column, chip rows for key and time signature, tempo and length on one row, one XP line. |
| 7 | "More keys from difficulty 2" | Yes | Difficulty 1 now reads "Difficulty 1 uses major keys with up to 1 sharp or flat. Minor keys start at difficulty 2." (`practice-fit.spec.ts` "difficulty 1 says which keys it uses…"; `home.test.tsx`; owner-review point 7). |
| 8 | "Time signature" instead of "Time" | Yes | Row label and phone chip read "Time signature" (`practice-fit.spec.ts` "'Time signature' is never shortened"; owner-review point 8). |
| 9 | "Audio clock is running at the wrong speed" on Start | Yes for the screen; engineers own the measurement | A clock-rate result never stops a try: owner-review point 9 forces a large clock error and still reaches the count-in. No screen shows "wrong speed" on Start (`scan.test.tsx` "every session error code has its own text and none is the clock-rate message"). Start failures have their own screens, "The sound didn't start" and "The microphone didn't open", with Try again and the diagnostics button. `error.clockRate` survives only as a detail line in the diagnostics file. See "Still short" for the calibration check. |
| 10 | A tone and purple marks when the music starts | Yes | The marks were ghosts: the microphone heard the starting pitch through the speakers (`03-detection.md` section 1). Fixed in the follower: nothing before the first note's window is judged or drawn, and the app's own tones are known to it. On screen, the starting pitch now has its own labelled moment: a "Your starting pitch" card (key chord, then first note, then "Count-in next"), the score dimmed, "Marks start at bar 1" in the strip. In the walk the card showed for about 2 s, then the count-in, with no mark before bar 1 (walk frames, desktop and phone). The automatic starting pitch can be turned off in Settings > Practice. Owner-review point 10. |
| 11 | When does the count-in stop and I start? | Yes | Two bars stay at difficulties 1 to 3 (PLAN R65). The track above the music has one cell per beat: bar 1 grey, "Count-in: listen to the beat"; the last bar brass, "Come in after 4", then the word "Sing". Owner-review point 11; `perform.test.tsx` "count-in track". Fixed in this review: when a piece starts on a pickup the title said "Come in after 3" while the track still drew a fourth cell before "Sing"; the last bar now ends at the count the title names (`count-in-band.test.tsx`). |
| 12 | "Reading time's up. Start when ready." | Yes | Practice has no reading timer; the line is deleted. The read-through says "Read it through. Start when you are ready." (`scan.test.tsx` "practice has no reading timer: no time-up text after 40 s…"; owner-review point 12, 40 s on the read-through). |
| 13 | The what's-new bubble | Yes, removed | `CoachMark` and its stored flag are deleted. No `[data-coach]` anywhere (`scan.test.tsx`; owner-review point 13). |
| 14 | "Before you play" ticks | Yes | Now "Look before you play: Five things to spot before you start." Five rows (key and time, tempo, accidentals, rhythm, shape), no boxes, nothing ticks itself (`scan.test.tsx` "Look before you play: five rows with no boxes"; owner-review point 14). Fixed in this review: C major read "0 sharps"; it now reads "no sharps or flats". |
| 15 | Trailing voice heard as extra notes; diagnostics per practice | Yes on synthetic voices; needs the owner's voice | Detection: scoops and falling tails are folded into the note (`03-detection.md` section 2: an untrained-voice model went from 1.31 detected notes per sung note to 1.01, and from 0.31 extra marks per note to 0.015; `pnpm gates` "untrained voice"). Display: at difficulties 1 to 3 only green and red marks show live, and only when sure (PLAN R61, owner to confirm). Diagnostics: every try keeps a compact trace; "Save diagnostics" on the results and the try detail saves a JSON file; Settings > Data exports the last 20 tries; the sound opt-in is visible and off by default (PLAN R64); `tools/diagnostics/replay.ts` replays a file. Evidence: `e2e/loop/trailing.spec.ts` and owner-review point 15 (no purple mark during the try, no extra in the results, a valid file downloads). Fixed in this review: a held note the detector split in two still made one extra in about one run in four (see below); after the fix, the loop suite twice and the owner review in all four projects pass. |

## Fixed in this review

- Owner point 15, still open at the start of this review: the trailing-voice try left one extra in 2 of 7 real-time runs (`e2e/loop/trailing.spec.ts` once, owner-review desktop-dark once). The saved diagnostics file, replayed with `tools/diagnostics/replay.ts`, showed the cause: a held F♯3 (a half note) detected as two notes at the same pitch, 1.24 s and 0.77 s. The second half was longer than `oneNote.absorbMs` (350 ms), so the existing "sung on" rule did not cover it, and it became an extra. New rule in the final alignment (`src/follow/final-align.ts`, voice tolerances only): a re-articulation at the same pitch class that starts before the written end of the note the previous detected note matched is that note continuing, not an extra. Replaying all six saved tries: the failing one goes from 1 extra to 0, the rest stay at 0. Test: `src/follow/one-note.test.ts` "a held note split in two is one note" (fails without the rule). `pnpm test:bare` stays byte-identical and `pnpm gates` unchanged (194 of 195; untrained voice extras 0.000 per note). This touches `src/follow`, which the plan left with the detection engineer; the change is one filter on reported extras and is gated on the voice tolerances.

- The count-in track and the "Come in after N" title disagreed when a piece starts on a pickup (difficulty 2 and up). The last bar now shows only the counts before the entry, so "Sing" sits right after the count the title names. `src/ui/score-frame/CountInBand.tsx`, new `count-in-band.test.tsx`.
- "Show what we heard" on a try where the app heard no pitch said "This try is too old to include the pitch track", on a try played a minute earlier. It now says "We heard no steady pitch in this try, so there is no line to draw." (new key `diagnostics.noTrack.silent`; `heard.test.tsx`).
- The read-through's key line read "C major, 0 sharps." It now reads "C major, no sharps or flats." (`scan/model.ts`, `model.test.ts` updated).
- The last calibration banner component (`CalibrationMissingBanner`) and its copy key `banner.calibrateNeeded` ("Calibrate once so timing grades are fair") were still in the code, unused. Deleted, with their test; `copy.test.ts` now asserts the key is gone.
- Phone, during a try: status messages in the strip ("Keep going: come in at bar 3", "Lost your place? Rejoin at the next bar line.") were cut off with an ellipsis. On phones the strip's centre now takes the free width, the "Mic" word is dropped (the bars stay), and a message wraps to up to three caption lines inside the strip's own height, so the music does not move. `src/app/screens/perform/perform.css`.

## What still falls short

- Sound is checked by what is scheduled, not by ear. The voice sets are synthesised formant vowels. They are in the right range and in tune, but whether they sound like a singer is untested by anyone who can listen. The owner should compare `sounds-demo.html` (formant baritone beside the choir set) on his Mac and rule on PLAN R62.
- Live marks at difficulty 1 with the fake microphone: the fake device's beep is a steady tone, and the app drew red marks on the first notes as it should for a wrong pitch. That the calm rule shows nothing wrong for a real, slightly scooped voice is proven only on synthetic singing.
- The real-time tests that sing through the fake microphone (`e2e/loop`, `e2e/tour`) depend on the machine keeping up. The split held notes above may have come from capture under load as much as from the voice model; the new rule covers both, but the cause of the split itself (a level dip in the detector) is the detection engineer's to look at with a real recording.
- The calibration screen still has a check line that says the audio clock "seems to run at the wrong speed" (`calibrate.check.clockRate.fail`) when that check fails. It no longer blocks a try or Start, and the clock-rate engineers own the false failure. If the false failure is not fully fixed, the owner will meet that sentence on the calibration screen.
- Calibration cause 5 (the microphone's label changing between "Default - …" and the plain name) is confirmed by construction, not on a real Mac. Old calibrations under a prefixed label are adopted, but nobody has seen a real Mac label in this environment.
- The read-through's back button reads "Home" while the tab is called "Practice" (the board says "Practice"). Left as is: the header already has a "Practice" mode pill, and two "Practice" controls side by side read worse.
- On the boards, live marks on phone are dots and a triangle under the notes; the app rings the notehead. Not changed this round.
- Difficulty 1 has 7 pieces in the corpus ("Few pieces" shows). The owner will see repeats quickly.

## What needs the owner's voice and Mac

1. Sing into the built-in microphone with the built-in speakers on, at difficulty 1, and save diagnostics from two or three tries. The file and `tools/diagnostics/replay.ts` show what the app heard note by note, and turn the trailing-voice fix from synthetic proof into real proof.
2. Calibrate once on the Mac. The pill should read "Calibrated for speakers" and stay that way after a reload and after changing the default microphone in macOS. If it does not, the diagnostics file holds the route.
3. Press Start a few times. No "wrong speed" message should appear anywhere; if the calibration screen shows the clock line, report it.
4. Play "Play my range" and Match a note and say whether the baritone "ah" is good enough or the choir set is better (PLAN R62).
5. Confirm or overrule the calmer live marks at difficulties 1 to 3 (PLAN R61) and the diagnostics sound opt-in (PLAN R64).

## Command status

Final run on this tree (20 Nov 2026):

| Command | Result |
| --- | --- |
| `pnpm install` | up to date |
| `pnpm typecheck` | pass |
| `pnpm lint` | pass (ESLint, Stylelint, dependency-cruiser) |
| `pnpm lint:copy` | pass, 1007 keys, 0 unused |
| `pnpm test` | pass, 183 files, 4123 tests |
| `pnpm test:bare` | pass, 66 scenarios byte-identical |
| `pnpm gates` | 194 of 195, 0 blocking (the known room-F1 voice limit, PLAN R54) |
| `pnpm build` | pass |
| `pnpm size` | initial 73.4 KB of 150 KB, total 530.4 KB of 560 KB |
| e2e root (Chromium) | 96 passed, 116 skipped (WebKit projects) |
| e2e notation, audio, slice, ios, synthetic, pwa | 22, 11, 1, 48, 19, 2 passed |
| e2e loop | first full run 3 passed, 1 failed (trailing voice, an extra); after the fix, run twice: 8 passed |
| e2e design, setup, a11y | 28, 15 (1 skipped), 28 (63 skipped) passed; design rerun after the strip CSS change: 28 passed |
| e2e tour | first full run 11 passed, 1 failed (owner review desktop-dark, point 15); after the fix, owner review in all four projects: 4 passed, every point passes |

WebKit projects were not run (no WebKit in this environment).
