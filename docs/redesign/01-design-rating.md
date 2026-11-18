# Design rating: the current app

Reviewer role: principal product designer (consumer apps, music software).
Scope: visual quality of every screen, light and dark, desktop (1440 x 900) and iPhone (390 x 844).
Evidence: screenshots in `docs/redesign/shots-design/<project>/`, taken from the dev server with a fake microphone and a real take (one wrong note, one late note). File names below are relative to that folder.

## Verdict

**Overall: 4 / 10.**

The app works and is honest. It is not yet designed. It reads as a well-built engineering prototype: system font, default form rows, outlined boxes, one blue, and a score that looks like a VexFlow test page. Nothing on screen says "music", "craft" or "this is a pleasure to practise with". The best notation, tuner and language apps earn trust through a calm, opinionated look and one memorable moment per session. This app has neither yet.

The music itself is the strongest asset, and it is the weakest-looking thing on screen. Fixing the score frame, the feedback marks and the setup screen would move the whole product from 4 to 7.

## Scores by screen

| Screen | Score | Worst problem |
| --- | --- | --- |
| Welcome | 4 | A form card on a blank page. No music, no image, no promise shown. |
| Onboarding: instrument | 4 | Letter-in-a-circle tiles ("A.Sx", "Pno"), ragged grid, no range shown, no baritone. |
| Onboarding: microphone | 5 | Clean but generic; the best of onboarding. |
| Calibration (onboarding and page) | 4 | Card inside a card; ten 6 px rings as the only visual; page title misaligned with its card. |
| Onboarding: level | 4 | Bare stepper with hairline minus and heavy plus; says "level" where the owner means difficulty. |
| Home and setup | 3 | Disabled-looking Key and Time controls, Random chips stranded at the far right, three alignment columns. |
| Scan cover | 3 | Spec promises large key and time signatures; it shows a line of text that wraps badly on phones. |
| Scan | 5 | Score is small with a half-empty paper; "Hear the reference" is buried and unexplained. |
| Count-in | 4 | Grey 1 2 3 4 at 32 px in a toolbar; the moment has no weight. |
| Performance (live feedback) | 3 | Feedback marks are too small and too faint to read at playing distance; the playhead is three overlapping shapes. |
| Results and review | 4 | Teal-coloured score, hatched heat strip, colliding ghosts, jargon chips, rank bar that dwarfs the grade. |
| Tips | 3 | One card and a toggle on an empty page. |
| Progress | 5 | Most structured screen; rank ladder is dashed boxes with tiny emblems. |
| History list | 5 | Tidy, but the meta line says "random" instead of the meter played. |
| Attempt detail | 3 | No score shown; underlined attribution as a heading; 950 px empty rank bar. |
| Settings | 5 | Orderly two-column list; name field is a 28 px box beside 40 px selects. |
| Credits | 4 | Browser-blue links and bullets; reads like a plain HTML page. |
| Not found | 3 | Unstyled text and a default link. |

## What fails everywhere

### Brand character

- "Sightread" is set in the UI font at 20 px. There is no mark, no colour, no musical cue. The app bar looks like an admin console.
- One accent colour (`#2F4BD8` light, `#8FA1FF` dark) does every job: links, primary buttons, selected tabs, timer ring, slider, Random chip. Nothing is special because everything is blue.
- The dark theme's primary button is a pastel lilac slab with dark text (`desktop-dark/07-home.png`). It looks disabled.
- Excellent would look like: a small wordmark with a notation-derived glyph, a warm paper-and-ink palette that carries into the UI, one accent reserved for "go" and "now", and a second, quieter tone for selection.

### Typography

- System UI font only, 16 px body, 600 to 700 weight headings. Headings like "Read it. Play it. See how it went." are bold but flat; there is no contrast in size, weight or face between display, label and data.
- Numbers that matter (score 93, tempo 72, timer 29) use the same face as labels. The timer "29" is 12 px inside a 28 px ring.
- Data lines are dot-separated strings that wrap mid-phrase: "Streak 0 days · 0 takes · 0 XP today" breaks before "today"; "needs level 2" breaks before "2" (`desktop-light/07-home.png`).
- Excellent would look like: a characterful display face for headings and grade, a neutral text face, tabular numerals at real display size for score, tempo and timer, and no orphaned single words.

### Layout and spacing

- Content columns drift. On Home the labels sit at x 208, the controls at x 332, captions fall back to x 208, and the Random chips float at x 847, far from what they control. On Calibrate the page title starts at x 192 and the card at x 440.
- Cards are 1 px bordered boxes with no elevation and the same radius everywhere. Calibration nests a bordered card inside a bordered card (`04-onboarding-calibration.png`).
- Desktop screens use the top third of a 900 px viewport and leave the rest empty (welcome, tips, not found, attempt detail).
- iPhone Home: the sticky Start button sits over the Time row, and "Credits" overlaps the tempo label underneath it (`iphone-light/08-home-fold.png`). This is a visible defect, not a taste issue.

### Iconography

- Instrument "icons" are text abbreviations in lavender circles: "S", "A", "T", "B", "Fl", "Cl", "A.Sx", "Tpt", "Vn", "Vc", "Pno". These are orchestral score labels, not icons. A user sees "A.Sx" before they see a saxophone.
- Stepper minus and plus have different stroke weights (hairline minus, heavy plus) (`06-onboarding-level-choose.png`).
- The Stop control on iPhone is an empty square with no label (`iphone-light/14-performing-errors.png`).
- Excellent would look like: a single line-icon family drawn for this product, instrument silhouettes at one stroke weight, and every icon-only button paired with a label or a clear shape.

### Colour in the score

- The dark "paper" (`#1B1E23`) is almost the background (`#121418`). There is no sense of a page in dark mode (`desktop-dark/10-scan.png`).
- After a take, every correct notehead turns teal, but beams and some stems stay black (`desktop-light/16-results.png`). The page becomes a traffic light and loses its look as music.

### Motion

- Screen changes are a plain fade. The count-in, the end of the take and the grade reveal have no motion at all. The best moment in the product, "you got an A", arrives as a static box.

## Notation and feedback marks

This is the heart of the product and the area that most needs a designer.

- **Margins.** In the take view the staff starts at x 0 and ends at x 1440. The clef touches the screen edge (`desktop-light/12-count-in.png`). Printed music always has margins; without them the page looks cropped.
- **Scale.** At 1440 x 900 the take shows two systems in the top 330 px and 520 px of empty paper below. At scan time the score is scaled into a 760 px box with the same emptiness. The music should be large, centred and calm.
- **Lane glyphs.** The live verdict row (dots, crosses, rings) is 6 to 9 px at 60% opacity, about 50 px below the staff (`desktop-light/14-performing-errors.png`, zoomed). At a music stand distance they are invisible. In dark mode the green dots almost vanish.
- **Ghost notes.** The wrong-pitch ghost is a pale violet outline at 15% fill, drawn on top of the red notehead one step away. It reads as a smudge, not as "you played this". The late ghost is the same faint ellipse beside the note.
- **Review ghosts.** In review the ghost gains a horizontal duration bar that runs through the next notehead and the following rest (`desktop-light/16-results.png`, `iphone-light/16-results.png`). In the Schubert take the second bar is a knot of red, violet and teal stems (`desktop-dark/16-results.png`).
- **Playhead.** Three shapes overlap: a lavender box with a grey border that drops 60 px below the staff, a grey vertical line through the bar, and a blue next-bar marker. None of them reads as "you are here".
- **Heat strip.** Red-hatched bars above each system look like a print error, not a summary.
- **Combined marks.** A late note was shown as "○ +" (missed plus extra). Two cryptic glyphs for one musical event.
- Excellent would look like: a centred page with real margins, notation at the size of a printed part, a single soft bar highlight, verdict marks drawn on or beside the notehead at notehead size, ghosts with enough fill to read at a glance, and a review that uses a calm ink score with only the slips coloured.

## Screen notes

### Welcome (4)
A card with a heading, a name field and a button (`01-welcome.png`). No music on screen. Excellent: open on a beautifully set phrase of real music and one sentence, with the name field moved later or dropped.

### Onboarding: instrument (4)
Tiles vary in height (Flute is tall and empty because its neighbour wraps to four lines). The selected state is a 1 px blue outline. "Voice (soprano)" repeats "Voice" four times. Baritone and mezzo-soprano are missing. No range is shown, although the subtitle says "We pick music in your range". Excellent: equal tiles with a silhouette, the selected tile filled, and a range strip beneath the grid that updates as you choose (see owner point 2).

### Microphone (5)
The clearest screen. Large mic glyph, plain promise, two actions. It still looks like a form.

### Calibration (4)
The owner likes the flow; keep it. The visuals are a row of ten 6 px rings and a nested card. Excellent: one large pulsing beat circle that fills as each click is heard, a quiet waveform or level meter, and a single card.

### Level (4)
Stepper with an unlabelled number "2" and a caption. No sense of how hard level 2 is. The word "level" also collides with "rank level" and "needs level 2" elsewhere.

### Home and setup (3)
The screen the owner uses most and the weakest.
- Key and Time look disabled because Random is on by default, and the "on" Random chip differs from "off" only by text colour. This is likely why the owner thinks the key dropdown and time selection do not work.
- The Level stepper's Random chip is a different grey from the others.
- The tempo row has a "♩ = 72" label, a slider, a number field and a chip all at once.
- Length "Random / 8" is a two-option segmented control with one option.
- "Random key, meter and tempo: +24% XP" floats above Start without context.
- The Today card wraps badly and repeats "Novice" twice.
Excellent: a compact summary card ("Flute · Difficulty 2 · Any key · 4/4 · ♩ 72 · 8 bars") with a big Start, and an expandable panel where each setting is a clear choice with "Any" as one of its options, not a separate chip.

### Scan cover (3)
The spec says the cover shows the clef, key and time signatures drawn large. It shows a text string with a treble clef glyph in front (`09-scan-cover.png`). On iPhone it wraps to four lines (`iphone-light/09-scan-cover.png`). The screen-reader hint sits in the main visual. Excellent: an engraved clef, key signature and time signature at 3x size, with tempo and bar count beneath.

### Scan (5)
STARS panel is readable. The checkboxes, the 3 px active bar and the grey helper text are generic. "Hear the reference" (voice) and "Tuning note" sit at the bottom after five checklist rows; on iPhone they are hidden in a peek sheet labelled "Scan · 0 of 5" (`iphone-dark/26-scan-voice.png`). There is no "Hear the tempo" button, though the Tempo row says "hear the click". There is no way to hear the music.

### Count-in (4)
"1 2 3 4" in grey 32 px numbers squeezed into the toolbar beside "Bar 1 · ♩ = 79". The count-in is the most tense moment; it deserves the centre of the screen.

### Performance (3)
See the notation section. Also: the bottom status line "Bar 5 of 8" is 12 px, the input meter is a 60 px sliver, and the "Practice" chip repeats what the user chose.

### Results and review (4)
- The grade box "A" with "93" and stars is the right idea, done plainly.
- Two chips: "Practice / Practice mode." (says the same thing twice) and "Timing may be offset" (no explanation, blank second line).
- "Notes / focus": "focus" is an unexplained 11 px label.
- Component bars are black segment blocks; they look like loading bars.
- "+5 XP (practice, 25%)" is internal language.
- The rank bar is a 36 px grey slab with a 6 px blue fill and "2%" floating outside it. It is visually louder than the grade.
- The attribution line repeats the catalogue number ("K.157, K.157", "Op.22, Op.22").
- On iPhone the score comes after all the numbers, below the fold.

### Tips (3)
One card, one sentence ("No tips this time. Keep reading."), and a settings toggle floating outside the card. Excellent: either skip the screen when there is nothing to say, or show the one bar worth another look.

### Progress (5)
The best-structured screen. Weaknesses: the rank emblems are 20 px line drawings in dashed boxes; nine future ranks are as prominent as the current one; the per-instrument card shows five empty dashed squares with no legend. On iPhone the ladder is a 1,000 px list.

### History (5) and attempt detail (3)
The list row is clean. The meta line says "random" where the meter should be. The attempt detail has no score, so "review" is impossible; the title is an underlined link; the rank bar stretches 950 px.

### Settings (5)
Orderly. The name field is a 28 px input beside 40 px selects. The Config row prints a 70-character build string in the main column. "Click sound: Tick / Wood" has no preview button.

### Credits (4) and not found (3)
Browser-default link blue and bullets, unstyled 404. Small screens, but they are where a careful brand shows.

## The owner's ten points, from a visual angle

1. **Baritone.** Add baritone and mezzo-soprano. Rename the tiles "Soprano", "Mezzo", "Alto", "Tenor", "Baritone", "Bass" under a "Voice" heading. Six voices make a clean 3 x 2 grid on both sizes.
2. **Range picture.** On choosing an instrument, show a range strip: a grand-staff or single-clef snippet with the lowest and highest written notes as whole notes, a filled bar between them, the comfortable range darker, and the note names beneath ("A2 to F4"). For transposing instruments, a small toggle "written / sounding". Use the same strip, smaller, on the setup summary.
3. **Difficulty.** Replace "Level" with "Difficulty" in every label, stepper and caption. Show difficulty as a 10-step meter with a name per band (for example "1 to 3 Beginner"), not a bare number. Keep "rank" for XP progress, so the two words never collide.
4. **Key control.** Design a key picker that is clearly live: a row or circle of key buttons with their key signatures drawn, "Any key" as the first choice, and the concert key shown for transposing instruments. Never render it at 40% opacity unless it truly cannot be used, and then say why.
5. **Time signature control.** Same pattern: chips that show stacked time signatures in the music font (4 over 4), with "Any" as the first chip. Disabled meters show a reason on hover and focus.
6. **Calibration.** Keep the flow. Give it one strong visual: a large beat circle that fills on each detected click, and a result card that states the measured delay in plain words.
7. **Metronome click.** Visually: rename the options to what they sound like ("Classic metronome", "Woodblock", "Soft tick"), add a play button beside each, and show the downbeat accent in the beat dots. The sound itself should be a short, bright, pitched click with an accented first beat.
8. **Explain the reference.** Rename "Hear the reference" to "Hear starting note" and give it a tooltip and a one-line caption: "Plays the key chord, then your first note, so you can find your pitch. Voice only." Move it up beside the Start playing button, not below the checklist.
9. **Hear the music.** Add a "Listen" control in the scan toolbar and in review. In scan it plays the excerpt once at the set tempo, with the bar highlight following. For ranked takes, either make listening turn the take into practice, or allow it only after the take. In review, "Listen" plays the written music and "My take" plays back the judged notes, so the user can hear the difference.
10. **Overall quality.** Priorities, in order: the score frame and feedback marks; the setup screen; the results grade moment; brand type and colour; icons; then the smaller screens.

## What excellent looks like, in one paragraph

Open the app and you see a page of real music, engraved large on warm paper, with your instrument's silhouette and range beside it. One tap shows the settings as a sentence you can edit. Start, and the page settles into the centre with generous margins; a big, soft count-in pulses in the middle of the screen with a proper metronome click. As you play, slips appear on the notes themselves at notehead size. At the end the grade lands with a short, confident animation, the music stays on screen in ink with only your slips coloured, and one button lets you hear how it should have sounded.
