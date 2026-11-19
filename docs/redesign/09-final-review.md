# Final review: design and experience

Reviewer role: principal product designer and UX reviewer.
Build: this branch after the redesign waves, production build (`vite build`) in Chromium with fake audio capture, 19 Nov 2026.
Walk: the owner's own path, scripted in `e2e/tour/owner-review.spec.ts` and run at 1440 x 900 and 390 x 844 (iPhone, touch), light and dark, deviceScaleFactor 2. Screenshots: `docs/screenshots/owner-<project>/` (this walk) and `docs/screenshots/<project>/` (the screen tour, every tab and settings page). Each was read beside its mockup in `docs/redesign/mockups/png/`.

Status in one line: the ten points are met on screen; the compound-meter defect found here (takes at difficulty 4 and 5 came back as practice) was fixed afterwards (section 5), and the two manual checks (owner's own run, the five-player 1 m test) still not run by people.

## 1. What the walk does

`e2e/tour/owner-review.spec.ts` (run with `-c e2e/tour/playwright.tour.config.ts`): welcome; picks **Baritone voice** and checks the range figure ("Baritone voice range: G2 to G4. At difficulty 2: C3 to C4."); skips calibration; chooses difficulty 2 on the onboarding step; on Practice raises **Difficulty to 4**, picks **G major** in the key grid and the **last time signature offered (6/8)**, keeps **Ranked**; Start; checks the cover says "Difficulty 4", "G major" and "6/8"; Show the music; **Hear the tempo** (caption "Tempo: ♩. = n" while it plays, gone after); the reference explanation (desktop: the (i) popover "What is the reference?"; phone: "What do these do?"); **Hear starting pitch** (caption "Key chord: G major", then the first note); **Listen first** in Ranked: the confirm "Listen first?" appears, "Listen, make it practice" plays with "Playing bar n of m" and the toolbar chip changes from "Ranked · 0:2x to read" to "Practice"; a take through the fake microphone with one late note; results (graded, and the reason line contains "You listened first, so this one is practice."); **Listen** after the results ("Playing bar n of m"); Settings > Sound: **Classic, Woodblock and Beep previewed** one after the other ("Playing: Classic" ...); Progress, History, Settings. Every screen is checked for the word "level", raw copy keys and horizontal overflow. Last run: 4 of 4 projects pass, no issues, no console errors.

## 2. Fixes made in this review

| # | Found | Fix | Files |
| --- | --- | --- | --- |
| 1 | **Previews and Listen were refused after a take once the audio context had been closed and reopened** (leaving Practice closes it). Settings > Sound showed nothing when Classic, Woodblock or Beep was pressed: the backend still held the finished take's end time from the old context's clock, and the new context's clock starts at zero, so every sound was refused as "a take is scheduled" for roughly the length of the take. Owner point 7 failed after his first take. | A new context clears the take's end time. Unit test added (it fails without the fix). | `src/platform/web/audio/web-audio-backend.ts`, `web-audio-backend.test.ts` |
| 2 | Results on desktop sat in the 70 rem app column (976 px of content, toolbar rule not full width) while the mockup and the read-through use the full page; with three ranked reasons the grade block was squeezed to "91 of / 100" and "Excellent / read." on two lines each. | Results get the full-bleed shell like the read-through; the grade block keeps its natural width, the reasons take the rest. | `src/app/app.css`, `src/app/screens/results/results.css` |
| 3 | Onboarding instrument step at 1440 px: the picker column is about 590 px, under the 40 rem container break, so Woodwinds, Brass, Strings and Keyboard fell to two columns with lone cards beside empty halves (Alto saxophone, Trumpet, Piano), unlike the mockup's packed rows. | A middle step of three columns: Woodwinds 3; Brass 1 plus Strings 2; Keyboard 1. Below 30 rem the old two-column fallback stays. | `src/ui/components/picker/picker.css`, `InstrumentGrid.tsx` |
| 4 | The reference popover on the read-through ran to 8 px from the window edge, past its card. | Viewport margin 16 px. | `src/ui/primitives/Popover.tsx` |
| 5 | README described "a level" and no listening. | README says difficulty, describes the sounds, Listen first and the three clicks, and lists the compound-tempo defect. | `README.md` |

New test: `e2e/tour/owner-review.spec.ts`. No test was weakened or skipped.

## 3. The owner's ten points

| # | Point | Met | Evidence |
| --- | --- | --- | --- |
| 1 | Baritone voice | Yes | Picker Voice group: Soprano, Mezzo, Alto, Tenor, **Baritone (G2 to G4)**, Bass, each with its ruler bar (`owner-desktop-light/02-onboarding-baritone-range.png`). PLAN ruling 57: the corpus serves baritone at every difficulty. The walk served G major 6/8 excerpts in the baritone range. |
| 2 | Range shown when an instrument is chosen | Yes | Selection panel: bass staff with full range G2 to G4 pale and C3 to C4 inside the band at difficulty 2, note chips that play, keyboard strip, "Full range" and "At difficulty 2" lines, and the singer's octave note. The same picture is on Practice (desktop left card, phone summary card ruler) and updates with difficulty ("At difficulty 4: A2 to D4", `06-home-time-chosen.png`). Accessible name: "Baritone voice range: G2 to G4. At difficulty 2: C3 to C4." |
| 3 | "Level" means difficulty | Yes | No visible text or accessible name in the walk matches `\blevels?\b` (spec check on every screen, all four projects); every catalogue string that once said level now says difficulty ({level} is only a placeholder). Stepper "2 of 10" with a 10-step meter and the description. |
| 4 | The key control works | Yes | Key grid of chips with drawn signatures plus "Any key"; G major chosen, checked, and served: cover "Difficulty 4 · G major · 6/8 ..." and the large signature on the cover (`07-scan-cover.png`); the score has one sharp. Keys a difficulty does not use are absent with "More keys from difficulty 5." |
| 5 | The time signature control works | Partly | Segments "Any", 4/4, 3/4, 2/4 (marked "few pieces"), 6/8; 2/2 left out with the visible note "No 2/2 music for Baritone voice at difficulty 4 yet." 6/8 chosen and served (cover and score). **But** a 6/8 take at difficulty 4 or 5 comes back as practice with "The tempo was below this difficulty's range": the app serves compound meters at 40 to 66 dotted beats (config `compound.dottedBpm`), and `src/grade/ranked.ts` compares that number with the difficulty's quarter-note minimum (66 at difficulty 4, ×0.9). The XP tempo factor in `src/grade/xp.ts` has the same unit mix. This is a silent downgrade, which principle 3 forbids; the fix is in `src/grade`, outside this round (ruling 60). Fixed afterwards: see section 5 item 1. |
| 6 | Calibration kept as it is | Yes (unchanged flow) | One mark per click, "0 of 10 heard", Try again / Play along instead / Skip, and the cost of skipping on Practice ("Calibrate to earn XP on this device" with "Calibrate now" on results). Exercised with skip and synthetic loopback only, never with a real speaker and microphone. |
| 7 | A metronome-sounding click | Yes, with a caveat | Settings > Sound: Classic (default), Woodblock, Beep, each with a waveform, a hint and its own play button; "Playing: Classic" while it sounds (`19-settings-sound-classic.png`); all three play after a take now (fix 1). Caveat: the sound gate (`pnpm test` output) passes Classic everywhere but Woodblock and Beep miss the onset F1 or click-extras floor in a few clean and phone cases at -10 dB. The owner has not auditioned the sounds (ruling 58). |
| 8 | "Hear the reference": explain it | Yes | Voice: "Hear starting pitch" with the visible line "Plays the key chord, then your first note."; the (i) opens "What is the reference?" on press, Enter, or a 400 ms hover (`10-scan-reference-info.png`); on phones "What do these do?" carries the same text; while it plays the caption reads "Key chord: G major" then "First note: B3" and the first note is ringed in brass on the score (`12-scan-listen-confirm.png`). Instruments get "Hear the key". |
| 9 | A way to hear the music | Yes | "Hear the tempo" (one bar of clicks); "Listen first" (Ranked: confirm every time, then the take is practice; the chip says Practice at once; results say "You listened first, so this one is practice."); "Listen" on results and History with "Slower", playing the written music with the bar highlighted. Playback of the player's own take is not offered (decision 8). |
| 10 | Overall quality | Mostly | See the scores below. The core loop now looks like one product: serif display type, warm paper, brass for "now", engraved music large on every screen, consistent cards and controls in both themes. What still falls short is in section 5. |

## 4. Scores per screen, before and after

Before: design scores from `01-design-rating.md`, UX scores from `02-ux-rating.md` (1 to 10). After: this review, same scales, from the screenshots of this build in light and dark at both sizes.

| Screen | Design before | UX before | Design after | UX after | Note on after |
| --- | --- | --- | --- | --- | --- |
| Welcome | 4 | 7 | 8 | 8 | A page of music on paper, one promise, one button. |
| Onboarding: instrument | 4 | 4 | 8 | 9 | Six voices, rulers on one axis, large range picture; packed groups after fix 3. |
| Onboarding: microphone | 5 | 8 | 7 | 8 | Plain and clear; the privacy line is visible. |
| Calibration | 4 | 7 | 7 | 7 | Unchanged flow, cleaner card; not tried on a device. |
| Onboarding: difficulty | 4 | 4 | 7 | 8 | "2 of 10", meter, description, range at that difficulty. The instrument name and "Difficulty 2" repeat the line above. |
| Practice (home and setup) | 3 | 3 | 8 | 8 | Every control live or absent with a reason, XP for Any shown at the point of choice, mode hint before Start. |
| Scan cover | 3 | 5 | 8 | 8 | Large clef, signature and meter; one summary line; ranked timing explained. |
| Read-through (scan) | 5 | 4 | 8 | 8 | Sounds group with visible captions, STARS checklist with lines, starting pitch ringed on the score. Phone shows three of four systems above the dock (section 5). |
| Count-in | 4 | 6 | 7 | 7 | Count band on the score, metronome click. |
| Performance | 3 | 6 | 7 | 7 | Marks below the staff and ghosts at the played pitch are readable at desk distance; the 1 m test is still open. |
| Results | 4 | 6 | 8 | 8 | Grade moment, reasons stated, Listen and slip stepper, "How it went"; full width after fix 2. |
| Tips | 3 | 6 | 8 | 8 | Folded into results as "One thing to try"; nothing shown when there is nothing to say. |
| Progress | 5 | 5 | 7 | 7 | Rank ladder with requirements in difficulty terms. |
| History and attempt | 5 / 3 | 6 | 7 | 7 | Meter shows what was played; attempt detail shows the marked score and Listen. |
| Settings | 5 | 6 | 8 | 8 | Sound previews, "Tuning pitch" in words, calibration line. |
| Not found (error screens) | 3 | 2 | 7 | not rated | Not found follows its mockup (icon, serif title, one way back). The audio error screens were not reached in this walk, so their UX score is not re-rated here. |
| **Overall** | **4** | **5.0** | **7.5** | **7.7** | |

## 5. What still falls short

1. ~~**Compound meters at difficulty 4 and 5 are always practice**~~ Fixed after this review (see "Post-redesign fixes" in `docs/BUILD-NOTES.md`): the ranked tempo check, the XP tempo factor and the level window's mid-tempo test now read the same tempo range selection serves (`levelTempo` in `src/rules/level-tempo.ts`), so a 6/8 take at difficulty 4 or 5 is judged against 40 to 66 dotted beats.
2. ~~**Read-through on a phone shows about six of eight bars above the dock.**~~ Fixed: the read purpose drops the 20 px verdict lane (126 px a system at 9.5 px staff space), so four systems fit above the dock at 390 x 844. The one-time "New: hear the tempo..." note still takes about 70 px on the first visit, when three systems and part of the fourth show.
3. ~~**Line numbers, not bar numbers.**~~ Fixed: with page turns the gutter shows the first bar of each line from the second line on, and the take toolbar says "Bars 3–10 of 12".
4. ~~**Two smaller mismatches with the mockups.**~~ Fixed: Start (desktop Practice, which now also starts on Space), Show the music and Start playing draw "Space" as a keycap; the Practice instrument card reads "Voice · bass clef" with the "Your range / Tap a note to hear it" header; the onboarding difficulty step no longer repeats the instrument name and "Difficulty N" under the stepper.
5. ~~**The read-through blamed the audio clock for every failure.**~~ Found by the owner on a Mac after this review and fixed: each session error now has its own text with a details line, Try again retries the failed step, and the cause found (audio closed while the page was hidden during the read-through) no longer fails the take. See "Post-redesign fixes" item 5 in `docs/BUILD-NOTES.md`.
6. **Sound gate** for Woodblock and Beep (point 7), and no owner audition yet.
7. **Manual checks open.** The owner's own walkthrough and the five-player legibility test at 1 m (`09-qa-report.md` sections 6 and 7) have not been run by people. The scripted walk proves each step exists and works; it does not prove he finds each step without help.
8. Real-device audio: calibration, the click through laptop speakers and iOS Safari are untested on hardware.

## 6. Command status at the end of this review

All run after the last change in this review:

- `pnpm install`: up to date. `pnpm typecheck`: clean.
- `eslint src e2e tools`, `lint:css`, `lint:cycles`: clean. `lint:copy`: 785 keys, 0 unused. A bare `eslint .` also lints the untracked build output in `dist-size/` and fails there; not touched.
- `pnpm test`: 160 files, 3726 tests passed (one new). The sound gate report still reads classic true, woodblock false, beep false.
- `pnpm build`: passes. `pnpm size`: initial 73.4 KB of 150, total 484.2 KB of 500, music font 247.2 KB of 260.
- Playwright, every config: root 96 passed (94 skipped by design); notation 22; audio 6; slice 1; loop 3; ios 48; synthetic 19; pwa 2; design 18; e2e/setup 10; sounds 10; setup component 9; fonts 3; a11y 28 passed (63 skipped by design, 2 workers); tour 12 (tour, first user and this owner walk on four projects; no issues, no console errors). WebKit projects were not run (WebKit is not installed here).
