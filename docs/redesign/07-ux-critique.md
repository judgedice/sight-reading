# UX critique of the design spec and mockups

Author role: principal UX expert.
Reads: `05-ux-spec.md` (the experience spec, binding for behaviour and copy), `06-design-spec.md`, and every render in `mockups/png/` (46 files, light and dark, desktop and phone). Detail was checked on crops at full resolution.
Status: required changes for the next design pass. Each change is numbered once (C1, C2, ...) and is written so a reviewer can check it as pass or fail. Viewports are CSS pixels: desktop 1440 x 900, phone 390 x 844.

---

## 1. Summary

The redesign is a big step up. The setup, range picture, key grid, read-through sounds and results all follow the experience spec, and the brand is calm and consistent in both themes. Baritone is there, "Difficulty" is used everywhere, and the reference is explained in words.

Five problems stop me from signing off:

1. The count-in card covers the music the player must read at the downbeat, and dims the first bar to about 20% (C32, C33).
2. On a 1440 x 900 laptop the primary action is below the fold on Practice and Results, and the instrument picker's range picture is below the fold (C1, C10, C40).
3. The phone "What do these do?" sheet shows "Check my tuning" for a baritone voice and uses different words for the reference than the desktop popover (C27, C28).
4. "Hear the click" is offered while calibration is listening; pressing it would spoil the measurement (C47).
5. The owner asked for a better click. A picture of a waveform cannot answer that. He needs to hear the three sounds before they are built (C52).

Scores are against `05-ux-spec.md`: does the screen do what the spec says, is it clear to a first-time player, and does it hold up at the stated viewports.

| Mockup | Score | Main reason |
| --- | --- | --- |
| `home` | 7 | Right flow and content. Start and Mode below the fold on desktop |
| `setup-sheet` | 8 | Faithful to the spec. Small gaps |
| `picker` | 6 | Range picture out of view on desktop and for most phone picks; mixed pitch frames on cards |
| `scan` | 7 | Sounds group and live caption work. Score too small; icon unclear |
| `scan-explain` | 5 | Wrong row for voice; copy drifts from the popover |
| `scan-confirm` | 8 | Correct and safe. Timer values disagree |
| `count-in` | 4 | Hides and dims bar 1 at the moment it matters most |
| `performance` | 7 | Marks are clear on desktop. Phone score too small; fade inconsistent |
| `results` | 7 | Good order. Actions below the fold; tip and weakest component disagree |
| `tips` | 7 | Folded in well. Labels and order need work |
| `calibration` | 7 | Flow kept. One unsafe button; marks wrap on phones |
| `settings` | 8 | Clear. Needs a rule for calibration after a sound change |

---

## 2. Required changes by mockup

### 2.1 `home` (Practice, desktop and phone): 7 of 10

Good: two-column layout, range picture with tappable notes and keyboard, difficulty meter with hollow segments and a visible reason, key grid with drawn signatures, time segments with "few pieces" and the missing-meter line, Mode with its hint, XP line. On the phone, Mode and Start are visible without scrolling (spec 16 item 7 passes).

C1. At 1440 x 900, "Start" and the Mode control are visible without scrolling on Practice. Today Start sits at about y = 1450. Fix by pinning the foot of the right column (Mode hint, XP line, Start) to the bottom of the viewport while the rows scroll, or by tightening rows. Check: Start's bounding box is fully inside the viewport on load at 1440 x 900 and at 1280 x 800.

C2. When the pinned foot is used, no row is ever hidden under it (same rule as the phone dock, spec 5.2). Check: scroll the right column to every position; no control's box intersects the pinned foot.

C3. Key chip signatures are too small to read. On the render the staff space is about 4.5 px, not the 6.2 px of design spec 6.3, and the sharp is a speck. Check: in the built chip the measured staff space is at least 6 px and the signature staff is at least 50% of the chip's inner width.

C4. In dark mode the keyboard strip's black keys are almost invisible: white keys `#2B2925` against black keys `#0E0E10` is about 1.3:1. Check: black keys against white keys at least 3:1 in both themes (keep white keys light-toned in dark mode, or draw a 1 px `border-strong` edge on every key).

C5. The phone summary chips need a lasting sign that they open something once the one-time hint is gone. Add a small chevron or pencil glyph in each chip, or keep the hint line permanently. Check: with the hint dismissed, five first-time users asked "how do you change the key?" find it within 5 seconds (manual).

C6. Show the "Few pieces here: some may repeat." hint state on the Time row (3/4 selected) and the fallback note (spec 5.9, "Key set to Any: ...") in one mockup state each. Check: both states exist as renders.

### 2.2 `setup-sheet` (phone): 8 of 10

Good: same rows and order as desktop, range picture on top, tempo slider with "Hear the tempo".

C7. The "+8% XP" tag is missing from the Tempo switch in the sheet (it is present on desktop). Check: every "Any" option shows its tag in the sheet, matching desktop.

C8. Show the sheet opened from a chip, scrolled to that row with focus on its control (spec 5.2, 14 item 8). Check: a render of the sheet opened from the "Key" chip with the Key row at the top and a visible focus ring on the selected chip.

C9. The tempo line "♩ = 72" renders with a gap between the note and the "=". The design spec calls this a mockup limit. Check in the app: the gap between the ♩ glyph and "=" is no more than 0.35 em in every place the tempo appears (setup, toolbar summary, captions, count-in, status strip).

### 2.3 `picker` (instrument picker, desktop dialog and phone sheet): 6 of 10

Good: six voices with Baritone selectable, ruler bars on a shared axis, an axis explainer line, the large picture with full and served ranges, tappable notes, keyboard strip, voice line, "Show more instruments (less tested)".

This is the owner's point 2 ("when I pick the instrument, I should see the range"). The picture exists, but at the moment of picking it is often not on screen.

C10. Desktop: the large range picture must be visible at the moment of selection. At 1440 x 900 it starts at about y = 870 and is cut off. Put the picture in a right-hand column of the dialog (grid left, picture right, sticky), or shrink the grid. Check: at 1440 x 900, after clicking any card, the picture's staff and legend are fully inside the viewport without scrolling.

C11. Desktop: "Done" and "Cancel" stay visible (sticky dialog footer). Check: at 1440 x 900 both are inside the viewport whatever the scroll position.

C12. Phone: the picture sits under the voice group only. A player who picks Cello at the bottom of the sheet sees nothing change. Place the picture directly after the group that holds the selection (or in a sticky bottom panel showing a compact picture). Check: on a 390 x 844 sheet, after tapping any card, the picture's staff is inside the viewport without scrolling.

C13. Mixed pitch frames on one card. The tenor card says "A3 to A5" (written) while its bar is drawn at A2 to A4 (sounding, per design D3). A baritone comparing cards reads the tenor as an octave higher than it is. For voices, show the sung range in text ("A2 to A4") with a second line "written an octave higher". For transposing instruments keep written text and the existing "Sounds a ... lower" line, and add "Bars show sounding pitch" to that line. Check: on every card the text range and the bar refer to the same frame, or the card states which frame each uses.

C14. The axis line says "Dark is what you get at your difficulty." In dark mode the served band is light. Use theme-neutral words: "The bold part is what you get at your difficulty." Check: the string contains no colour or lightness word.

C15. Give the ruler a landmark. Without labels the ticks cannot be read. Mark middle C with a taller tick and a "C4" caption under the first card in each row, or once at the top of the grid. Check: middle C is visually distinct on every ruler and named once in text.

C16. The full-range band is almost invisible on the selected card's wash and in dark mode. Check: the full-range band against the ruler track is at least 1.5:1 and against the selected wash at least 1.5:1, in both themes (the served band keeps its 3:1).

C17. Cards in a row must share a height and align their parts (spec 6.2). Today Flute's range sits lower than Clarinet's, "Piano (right hand)" wraps and makes its row taller, and the Tenor bar sits higher than Baritone's and Bass's. Check: in each row, name baselines, range baselines and ruler bars are on one line.

C18. Phone grid: single orphan cards (Alto saxophone, Trumpet, Piano) waste a full row each. Allow mixed groups to flow together on phones as on desktop, or use one-column rows with the bar to the right. Check: no row on the phone sheet holds one card while another group's card could share it, or the one-column layout is used throughout.

C19. The phone sheet needs the axis explainer line that desktop has. Check: the line is present above the Voice group on phones.

### 2.4 `scan` (read-through): 7 of 10

Good: Start playing first; the sounds group in the order the spec sets; captions always visible; info button with a popover; live caption "Key chord: G major" with the key signature highlighted; mode chip with timer; "Nothing plays during the take".

C20. The score is too small for the space. On desktop the paper uses about 45% of the column height and the rest is empty; on phones there are about 85 px of empty space above the peek tab. Check: at 1440 x 900 the read-through staff space is at least 15 px with 8 bars on two systems; at 390 x 844 at least 9.5 px.

C21. "Hear starting pitch" icon (three stacked noteheads) reads as the digit 8 at 16 to 24 px. Replace it with a notehead and a short sound arc or a tuning-fork-free pitch symbol. Check: in a 5-person test, at least 4 say "note" or "pitch" when shown the icon alone.

C22. The phone peek tab "Before you play: 1 of 5" uses a down chevron. It opens a sheet upward. Check: the chevron points up when closed.

C23. Render the "Listen first" playing state: the button reads "Stop", the live caption reads "Playing bar 3 of 8", the bar highlight sits on bar 3 (spec 8.8, 9.3). Also render the Practice-mode read-through, where Listen first carries "Hear how it goes before you play." and plays without a confirm. Check: both renders exist, desktop and phone.

C24. Render the instrument variant: "Hear the key" with its caption, info popover text `reference.info.instrument`, and "Check my tuning" in the group. Check: a render with a B♭ clarinet excerpt exists.

C25. Render the first-time coach mark on the sounds group ("New: hear the tempo, the key and the music before you play." with "Got it", spec 4.2 step 4). Check: render exists; it does not cover Start playing.

C26. Owner's point 8 asks for "a rollover". The spec requires a press, and allows a native `title`. Keep the press, and on fine pointers also open the same popover after a 400 ms hover on the info button, closing on pointer leave unless it was opened by a press. Check: on desktop, hovering the (i) for 400 ms shows the popover; pressing it pins it open; on touch only the press works.

### 2.5 `scan-explain` (phone "What do these do?"): 5 of 10

C27. The sheet lists "Check my tuning" for a baritone voice. Tuning check is for winds, brass and strings only (spec 8.8). Check: for any `family: "voice"` instrument the sheet has exactly three rows; for winds, brass and strings it has four.

C28. The reference text differs from the desktop popover ("The reference is the key of the piece..." against "This is your reference. It's the key..."). Both must render `reference.info.voice` (or `.instrument`) verbatim (spec 16 item 13). Check: the popover body and the sheet body are the same string key.

C29. Row titles must use the full button names, so a player can map them to the dock: "Listen first", "Hear the tempo", "Hear starting pitch", "Check my tuning". The sheet may add the short label after it. Check: each row title equals the button's accessible name.

### 2.6 `scan-confirm` (ranked "Listen first?"): 8 of 10

Good: "Keep it ranked" is primary and focused; the cost is stated; the time left is stated; the countdown keeps running.

C30. The chip reads 0:24 while the dialog says 0:18 left. Both come from one timer. Check: the chip and the dialog show the same value in every render and update together.

C31. The phone confirm sheet has no grabber and no close. A sheet that looks swipeable must behave like "Keep it ranked" when swiped down (spec: Escape is "Keep it ranked"). Check: swipe-down or a tap on the scrim closes the sheet with nothing played and the take still ranked.

### 2.7 `count-in`: 4 of 10

The count-in is the last chance to look at bar 1. The card sits over bars 2 and 3 on desktop and over bars 3 to 6 on phones, and the whole score is dimmed to about 20% (dark mode is darker still). The design spec's D8 departs from the experience spec ("the score dimmed slightly"). I do not accept D8 as drawn.

C32. Bar 1 (the whole first system) is never covered and never dimmed during the count-in. Check: the count-in element's box does not intersect the first system's box, and the first system renders at full ink.

C33. Place the number where it does not cover music: in the space above the first system on desktop, and in the status strip area or a band above the score on phones. Other systems may dim, to no less than 50% opacity. Check: later systems' opacity is at least 0.5; the number's height stays at the `count` size.

C34. Render the voice state before the count-in: "Your starting pitch" with the live caption "Key chord: G major", then "First note: D3", and the first notehead highlighted (spec 8.9). Check: render exists for desktop and phone.

### 2.8 `performance` (take with live feedback): 7 of 10

Good: notehead-sized marks, a lane glyph under every slip, ghost in violet, one bar highlight, Stop with the word, Mic meter, "Bar 5 of 8".

C35. Phone staff space is 8.6 px with about 340 px of empty paper above and below the score. A player at a stand cannot read that. Check: at 390 x 844 the take staff space is at least 11 px, or the page shows fewer systems at a time with the existing page-turn rule.

C36. Past-system fading is inconsistent: in the left system the bar 4 missed ring and the bar 4 correct dots are full strength while bars 1 to 3 are faded. All slip marks and dots in a left system fade together (design spec 7). Check: every mark in system 1 has the same opacity.

C37. The ghost natural in bar 2 collides with the preceding eighth note on both sizes. The design spec says the app applies 04's collision rule. Check in the app: no ghost accidental overlaps another glyph's bounding box in the feedback acceptance suite.

C38. The missed note is drawn with a hollow head on what is a beamed eighth. A hollow head changes the written rhythm a reader sees. Keep the head shape of the written note and mark it with the ring only. Check: a missed quarter or eighth keeps a filled head.

### 2.9 `results`: 7 of 10

Good: grade, score, stars and badge on one line; marked score with My take or Clean score, Previous slip, Next slip, Slower and Listen; "One thing to try" with "Hear bar n"; components with a hatch on the weakest; actions in the spec's order.

C39. "One thing to try" talks about key-signature notes while "How it went" says "Rhythm is the one to work on." Two different first priorities confuse. Either the first tip addresses the weakest component, or the component sentence says what the tip covers ("Rhythm scored lowest. The tip above is about notes, which cost you more points."). Check: in a results state with tips, the first tip's component equals the weakest component, or the sentence links them explicitly.

C40. At 1440 x 900, "Next excerpt" is at about y = 1115, below the fold. Put the three actions in the header row on desktop (right side, under the XP line) or pin them. Check: "Next excerpt" is inside the viewport on load at 1440 x 900.

C41. On phones, "Next excerpt" is about 1,500 px down. Pin the actions in a bottom bar after the player scrolls past the header. Check: at 390 x 844 "Next excerpt" is reachable without scrolling to the end of the page.

C42. Render the Listen playing state on results (button "Stop", bar highlight moving, "Playing bar 3 of 8" caption) and the tapped-bar start (spec 9.3). Check: renders exist.

C43. Render the owner's likely next results state: Practice badge with "You listened first, so this one is practice." and practice XP "+3 XP (practice earns 25% of the XP)". Also render Void ("Not graded", clean score in ink). Check: both renders exist.

C44. Phone score in results is at about 8 px staff space and the slip glyphs are about 6 px. Players tap bars here to start Listen. Check: each bar's tap target is at least 44 px tall on phones.

### 2.10 `tips` ("One thing to try" expanded): 7 of 10

C45. "Hide 1 more tip" reads as a contradiction. Use "Show 1 more tip" closed and "Hide tip" open. Check: strings `results.tip.more` and a new `results.tip.less` exist and are used.

C46. Every tip that names bars gets "Hear bar n" buttons, including the second one ("Seen in bars 3 to 8" has none). For ranges longer than two bars use "Hear bars 3 to 4" for the first two named bars. Check: every expanded tip with a bar reference has at least one hear button.

C48. Turning off "Show a tip after each take" here shows a toast "Tips turned off. Turn them on in Settings > Practice." with "Undo". Check: after switching off, the toast appears for at least 6 seconds and Undo restores the card.

### 2.11 `calibration`: 7 of 10

Good: flow, words and choices unchanged; larger marks; heard, missed, pending and current differ by shape; "5 of 10 heard"; skip hint.

C47. "Hear the click" is shown and enabled while "Listening…". A click played during measurement corrupts the result. Show it only before Start and after a result; hide it (not grey it) while listening. Check: during the listening state the button is absent from the DOM.

C49. On phones the ten marks wrap to two rows (8 and 2), which breaks the count at a glance. Check: at 390 x 844 all ten marks fit on one row (for example 22 px marks with 8 px gaps).

C50. The skip hint is right-aligned and wraps raggedly on phones. Check: it is left-aligned with the card text on all sizes.

C51. The input and output selects stay editable while listening. Changing them mid-run should not be possible. Check: during listening both selects are `disabled` with the visible line "Stop to change devices."

### 2.12 `settings` (Sound): 8 of 10

Good: three metronome options with hints, a bar picture and "Play a bar"; accent switch with its effect named; click volume; "Click during the take"; calibration status; "Tuning pitch".

C52. Owner's point 7 is about sound, and he cannot judge a sound from a picture. Before build, render one bar at ♩ = 90 of Classic, Woodblock and Beep (accent on), plus today's Tick for comparison, from the design spec section 9 recipes, as WAV files in `docs/redesign/audio/`. The owner picks or rejects each. Check: four files exist and the owner's verdict is recorded in the plan. A sound he rejects is retuned within the ship gate or dropped.

C53. Say what happens to calibration when the metronome sound changes. Calibration builds a template for the chosen sound (design spec 9.5). If the stored result still holds, say so under the options: "Changing the sound keeps your calibration." If it does not, show "Recalibrate for the new sound" with the button, and mark Ranked unavailable until then. Check: the line exists, and its claim matches what the gate predicate does.

C54. Pressing "Play a bar" on one option while another plays stops the first (spec 9.3, one sound at a time), and the playing option shows the brass playing state. Check: a render of the playing state exists; only one option can be in that state.

C55. Moving the click volume slider plays one click at the new level on release. Check: releasing the slider plays one click.

---

## 3. Across all screens

C56. Every live string in the mockups must match `05-ux-spec.md` section 13 exactly, or the spec is updated in the same change. Found drift: the reference sheet text (C28), "Hear the tempo" caption in the sheet ("so you feel the beat" added), "Check my tuning" sheet text. Check: a test compares rendered text of each mockup state against `en.json` keys.

C57. Missing screens. The owner will walk the whole loop before publishing, and these have no design yet: Welcome, onboarding steps 2 to 5 with the step counter, Cover, Progress, History and attempt detail, the Practice state with Ranked unavailable ("Ranked needs a calibrated setup on this device." with "Calibrate now"), the empty-selector card, the clock-rate error screen, and Not found. Check: each has at least a desktop and a phone render in both themes.

C58. Key grid at difficulty 5 and up (4 columns, design D2) and a transposing instrument's chips with the "concert F major" line. Check: renders exist; at difficulty 7 on a phone the grid scrolls with the sheet and no chip is narrower than 96 px.

C59. Focus states. Only "Keep it ranked" shows a focus ring. Check: one render per screen shows keyboard focus on a key chip, a time segment, a range note pill, an info button and a card in the picker, each with the 2 px ring and 2 px offset.

C60. High-contrast theme is specified but not rendered. Check: `performance` and `results` exist in high contrast, light and dark, and the contrast test covers them.

---

## 4. The owner's ten points: status

| # | Owner's point | Status | Still open |
| --- | --- | --- | --- |
| 1 | Baritone voice | Answered. Baritone card, bass clef icon, G2 to G4, served at difficulty 2. Mezzo added | Range values need the music lead's corpus check (spec 6.5); C13 so his comparison with Tenor is right |
| 2 | Range shown graphically when picking | Partly. The picture is good | Out of view at the moment of picking on desktop and for most phone picks (C10, C12) |
| 3 | "Difficulty", not "Level" | Answered in every mockup. No "level" found in any mockup file | Screens not yet designed must follow (C57) |
| 4 | Key dropdown | Answered as a key grid | Signatures too small to read (C3); higher difficulties and transposing instruments not shown (C58) |
| 5 | Time signature selection | Answered as segments with "few pieces" and the missing-meter line | Few-pieces hint state not shown (C6) |
| 6 | Keep calibration | Kept | "Hear the click" during listening is unsafe (C47); marks wrap on phones (C49) |
| 7 | Metronome-sounding click | Specified (Classic, Woodblock, Beep) with recipes | Not heard yet. The owner must audition renders before build (C52). Calibration after a sound change undefined (C53) |
| 8 | Explain the reference, maybe a rollover | Answered with captions, an (i) popover and a phone sheet; live caption shows what plays | Two different texts (C28); wrong row for voice (C27); hover not offered though he asked for it (C26); instrument variant and the automatic pre-count-in reference not shown (C24, C34) |
| 9 | A way to hear the music | Answered: "Listen first" on read-through, "Listen" and "Hear bar n" on results | Playing states never shown (C23, C42); the ranked cost and practice result need a render (C43) |
| 10 | Overall polish before publishing | Strong visual system in both themes | Count-in (C32, C33), primary actions below the fold on laptops (C1, C40, C41), missing screens (C57) |

---

## 5. On the design spec's departures (section 0)

- D1 (no tonal energy below 1 kHz): accepted for the detector's sake, with C52. A real mechanical metronome has a lower, woodier body; the owner must hear that Classic does not sound like the thin tick he rejected.
- D2, D3, D4, D5, D6, D7: accepted. D3 needs C13 so text and bar agree.
- D8 (count-in card over a 20% score): rejected. See C32 and C33.
