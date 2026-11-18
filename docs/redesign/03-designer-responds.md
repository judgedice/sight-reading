# Designer responds to the UX rating

Author role: principal product designer.
Reads: `01-design-rating.md` (mine), `02-ux-rating.md` (UX expert).
Purpose: settle where we agree, argue where we do not, and set a design direction the UX expert can push back on before we write the spec.

## In short

We agree on far more than we disagree. Both reviews find the same three failures: the setup screen looks broken, the reference and other terms are never explained, and there is no way to hear the music. Both keep calibration's flow.

Our scores differ because we measured different things. The UX rating asks "can a first-time user get through and trust the result?" (5.0). Mine asks "does it look and feel like a crafted music product?" (4). Where the UX expert scores higher (calibration 7 against my 4, take 6 against my 3), the behaviour works and the visuals do not. Both scores are true. The redesign has to fix both.

The UX rating changed my mind on five things. It found problems I missed: the silent Ranked-to-Practice downgrade, the void take shown as a sea of red, the dead-end audio error, onboarding tabs that lead nowhere, and the 3/4 excerpt served after the app said there was no 3/4 music. These are trust failures, and trust is a design problem, not only a copy problem.

## Where we agree

| Topic | Shared position |
| --- | --- |
| Voices | Six voices: soprano, mezzo, alto, tenor, baritone, bass. Cards named by the voice alone under a "Voice" heading. |
| Difficulty | "Difficulty" everywhere the user sees it, written "Difficulty 2 of 10" with its one-line description. "Rank" stays for XP. Gates read "Reach difficulty 2". |
| Random chips | Remove the separate Random chips. "Any" becomes the first option inside each control. |
| Calibration | Keep the flow and the three ways out. Add what Skip costs. |
| Click | A real metronome sound with an accented downbeat, a preview button beside each choice, and a measurement check against the calibration detector. |
| Reference | Rename it after what it does, explain it without hover, and move it near Start. |
| Hear the music | Listening on results is always allowed. Wire up "Hear the tempo" on scan, since the copy already promises it. |
| Phone Stop | Stop gets a visible text label. |
| Tips | Skip the screen when there is nothing to say. |
| Duplicates | Fix the doubled catalogue numbers and the doubled scan summary. |
| Hover | No explanation lives only in a hover title. Every hint is reachable by tap and by keyboard focus. |

## Where we disagree, and why

### 1. Range on every card, or a shared ruler plus one detail staff

UX: draw a small staff with two whole notes on every instrument card.

My view: a staff per card does not help a singer choose, because each card would use a different clef. Bass is in bass clef, tenor in octave-treble, baritone would be in bass clef. Nobody compares a bass-clef A2 with an octave-treble D3 at a glance. What helps choice is comparison on one axis.

Proposal: each card shows its range as a short bar on a shared pitch ruler (the same scale on every card), with the note names in text ("A2 to F4"). The selected instrument gets the full staff picture below the grid, large enough to read. The UX goal, "the range is the label", is kept. The staff appears once, at a readable size.

I would accept a staff on every card if a quick test with three singers shows they choose faster with it. I do not expect it to.

### 2. Key control: native select or key-signature chips

UX: one select, first option "Any key (random)".

My view: a native select cannot draw a key signature, and the key signature is the thing a sight-reader is choosing. At difficulty 1 to 4 there are only five to seven keys (C, G, F and their relative minors, then two sharps or flats). That fits a row of chips. This is a real choice; see "Setup: key control" below for both options.

### 3. Mode names

UX: rename Ranked and Practice to "Counts for XP" and "Just practice".

My view: keep "Ranked" and "Practice" as the names. They are short, they fit a chip on a phone, and people learn them from games. Add a visible one-line hint under the control ("Counts toward your rank. One try, timed reading." / "No timer, no rank. Repeat as you like."). I agree completely that the mode and any downgrade must be shown before Start, not after.

### 4. Calibration visual

I proposed one large pulsing circle in place of the ten small rings. The UX expert reports that the ten rings with "0 of 10 heard" are the clearest feedback in the app. I now agree: counting is the point. Keep ten marks, make them 20 px, put them on one card (no card inside a card), and let only the current mark pulse. This is a change of my view.

### 5. Live feedback legibility

UX scores the take at 6: the feedback is clear. I score it at 3: the verdict marks are 6 to 9 px at 60% opacity, 50 px below the staff. The UX expert read them in screenshots at arm's length. A player reads at music-stand distance, about 1 m from a laptop. I hold my position, and I propose a check instead of an argument: show a take on a 14 inch laptop at 1 m and ask five players to name each slip. If they cannot, the marks are too small.

### 6. Rename "Scan"

UX: "Read through" and "Start reading time".

I agree that "Scan" needs explaining, and "Read through" is good. I would not rename STARS; keep it as the small heading, with the plain title "Before you play" above it, as the UX table already suggests.

### 7. Hiding unavailable meters

UX allows either hiding meters with no music or showing them with a visible note.

My view: show them, with a visible note under the control ("No 3/4 music at difficulty 2 yet."). Hiding them makes the control change shape as difficulty changes, and people stop trusting it. Then "Any" must draw only from the meters shown as available. This is a bug the developer must fix; design cannot cover it.

## What the UX findings change in my direction

1. **Trust is a visual layer too.** The results screen needs a state model, not one layout. Graded, practice, void, and "not calibrated" each get a distinct, calm treatment. A void take shows the clean score in ink with one message, never a page of red circles.
2. **Mode lives on the setup summary.** The Start bar shows "Ranked" or "Practice" and, if ranked is not possible, says why with a "Calibrate now" link.
3. **Phone first for setup.** The sticky Start bar must never cover a row. Mode moves above the fold.
4. **Errors are screens, not banners.** Each error names a cause in plain words and offers "Back to practice". The current audio error (`bari-09`) is a banner on an empty page.
5. **Onboarding is a closed room.** No tab bar until the first setup is done.

## Two facts from the code that shape the design

- **Range changes with difficulty.** `config/instruments.json` gives each instrument five bands, one per two difficulty steps. Bass voice runs A2 to A3 at difficulty 1 and 2, and E2 to F4 at 9 and 10. So the range picture should show two things: the instrument's full range (pale) and the part of it this difficulty uses (ink). When the user changes difficulty, the ink band grows or shrinks. That one picture explains difficulty and range together.
- **Voice is graded on relative pitch, in any octave.** A baritone who sings the bass line an octave up is not marked wrong. The range picture for voices is about comfort, not about grading, and the copy must not imply otherwise. The reference exists so singers can set their own pitch, and it matters more than the UX rating suggests: it is the starting point for every voice take.

Baritone and mezzo need bands in the config and a corpus check at every difficulty. That is a music and data task. Design will draw whatever bands are agreed.

## Proposed direction

### Brand character

Sightread should feel like a good music room: warm paper, dark ink, quiet light, one brass detail that tells you where you are. It is serious about music and kind to the player. The music is always the largest thing on screen, set the way a printed part is set, with real margins. The interface steps back while you read and play, and steps forward only at three moments: the count-in, the end of the take, and the grade. No mascots, no confetti, no gamified chrome. Rank and XP are present but never louder than the music or the grade. The tone of voice is a patient teacher: short sentences, plain words, never blame.

### Type system

Today: system UI font only, one weight range, numbers in the label face.

The spec says "no web font" (04-design 7.2). I propose changing that rule. The app is an offline PWA that already caches a 247 KB music font (`src/notation/font/bravura.woff2`), so one subset text face adds little.

Roles:

| Role | Use | Size and weight (desktop / phone) |
| --- | --- | --- |
| Display | Grade letter, count-in numbers, rank-up | 96 / 72, display weight |
| Title | Screen titles | 32 / 28 |
| Section | Card titles | 20 / 18, semibold |
| Body | Text, controls | 16 / 16 |
| Small | Hints, captions | 14 / 14 |
| Data | Score, tempo, timer, bar count | Tabular numerals, 24 to 48 |
| Music | Clefs, key and time signatures in controls, range staff | Bravura (already bundled) |

Time signatures and key signatures in setup controls are drawn with Bravura, not typed as "3/4". That alone makes setup read as music.

**Option A (recommended): serif display, sans text.** A high-contrast book serif (for example Source Serif 4, open licence) for the display and title roles, the system sans for body and controls. The serif links the UI to engraved music and gives the grade a confident, printed look. Cost: one subset font file, about 40 to 60 KB for one weight with Latin and figures.

**Option B: one humanist sans.** A single open-licence sans with good tabular figures (for example Inter) for everything, with weight and size doing the work. Cheaper and more neutral, but the app keeps looking like a utility.

I recommend A. Option B is the fallback if the font budget or offline cache is a concern.

### Colour

Principles:

- Ink on paper for the music and for primary buttons. Primary buttons are ink-filled in light mode and paper-filled in dark mode. Blue stops being the colour of everything.
- One brass accent, reserved for "now": the playhead bar, the count-in pulse, the current calibration mark, the grade stars. Nothing else uses it.
- A quiet tint for "selected": a pale ink wash with a 2 px ink outline. Selection is clear but not loud.
- Vermilion only for slips (wrong, late, missed). Correct notes stay in ink. After a take the score looks like music with a few marks on it, not a traffic light.
- Caution (not calibrated, few pieces) uses an icon and text, not a second yellow.
- Dark mode: the paper is a lifted warm grey that reads as a page against a darker room. Today the dark paper is almost the background.

Every pair is checked to WCAG AA (4.5:1 for text, 3:1 for marks and control edges) in both themes before it enters `design/tokens.json`.

**Option A (recommended): paper, ink and brass.** As above.

**Option B: paper, ink and deep blue.** Keep a blue accent but deepen it to a Prussian blue and limit it to "now" and links, with brass used only for stars and the grade. Less of a change, so less risk, but blue already means "link" and "selected" to users, so the "now" signal is weaker.

I recommend A. Brass for "now" is the one colour idea that makes the product recognisable.

### Setup screen

Layout on desktop: two columns. The left column is the instrument and its range picture. The right column is the controls. The Start bar spans the bottom of the content with a one-line summary and the mode. On phone: instrument and range first, controls below, Start bar sticky with the content padded so it never covers a row.

**Instrument and range (owner points 1 and 2).**

- Instrument picker: equal tiles, one line-icon family, the voice tiles grouped under "Voice" in pitch order: Soprano, Mezzo, Alto, Tenor, Baritone, Bass. Each tile shows its name, its range in text ("A2 to F4") and a short bar on a shared pitch ruler. The ruler marks each C (C2, C3, C4, C5, C6) faintly, so tiles can be compared at a glance. On home the instrument is a button that opens the same picker as a sheet, not a native select.
- Range picture for the selected instrument, about 320 px wide on desktop and full width on phone:
  - A staff in the instrument's clef with two whole notes: lowest and highest of the full range, in pale ink.
  - Two filled whole notes in ink for the range at the chosen difficulty, joined by a soft ink bar behind the staff.
  - Note names under each note.
  - For transposing instruments, written pitch on the staff (what the player reads) and one line beneath: "Sounds a major 2nd lower: concert G3 to D5."
  - Tap a whole note to hear it. A singer can check "can I reach that?" before starting.
  - When difficulty changes, the ink band animates to its new size over 200 ms.
- The same picture appears, smaller, in the onboarding instrument step, so the first thing a new user sees is music.

**Difficulty (point 3).** A stepper labelled "Difficulty", the value written "2 of 10", and a ten-segment meter beside it with band names (1 to 2 Beginner, 3 to 4 Early, 5 to 6 Intermediate, 7 to 8 Advanced, 9 to 10 Expert; names to be agreed). The existing one-line description sits under it. "Any" is not offered for difficulty: the player chooses how hard.

**Key control (point 4).** "Any key" is always the first option and is selected by default. Choosing a key deselects Any. For transposing instruments each option also names the concert key in small text. Disabled keys never appear as greyed text without a visible reason.

- **Option A (recommended): key-signature chips.** A wrapping row of chips. Each chip shows the key signature drawn in Bravura on a tiny staff and the key name beneath ("G major", "E minor"). At high difficulty, when there are more than eight keys, the row shows the eight nearest and a "More keys" chip that opens a grid ordered by the circle of fifths. This turns the control into a small reading exercise and makes it obviously live.
- **Option B: one select (the UX proposal).** A styled select, "Any key (random)" first, keys as text. Simpler, native on phones, fully accessible by default. It does not show the signature.

I recommend A, because the signature is what a sight-reader practises. It must be built as a radio group with arrow-key movement and screen-reader names ("G major, one sharp"). If engineering time is short, B is acceptable for the first release.

**Time signature control (point 5).** A segmented control: "Any", then each meter as stacked Bravura numerals. Meters with no music at this difficulty stay visible, drawn in pale ink with a dashed outline, and a visible note under the control says why. Any must draw only from the available meters.

**Tempo.** "Any" or a set tempo. With Any, the slider shows the range the app will pick from as a shaded band. With a set tempo, a slider and a number, and a "Hear the tempo" button that plays one bar of clicks.

**Length.** Hidden when there is only one choice.

**Mode and Start.** The Start bar reads, for example: "Baritone · Difficulty 2 · Any key · 4/4 · ♩ 72 · 8 bars", then the mode chip, then Start. If ranked is not possible on this device, the chip reads "Practice" with "Calibrate to play ranked" as a link beside it. The XP bonus for Any sits next to each Any option ("+8% XP"), not in a sentence above Start.

### The "hear it" control (point 9)

One control, called **Listen**, with the same icon and behaviour wherever it appears: a play triangle with three short sound waves, and the label "Listen". While playing it becomes "Stop". The music plays at the set tempo with a soft count-in click, and the brass bar highlight follows the music, the same highlight used during the take. One sound for every instrument: a warm, piano-like tone, so the user hears the notes, not an imitation of their instrument.

Where:

- **Results, always.** A two-part control beside the score: "Listen" (the written music) and "My take" (the notes the app heard, played back from the judged notes, with slips in their wrong pitch and timing). Hearing the two side by side is the lesson. Engineering must confirm the judged notes hold enough to play back; recorded audio is not required.
- **History detail.** The same control, once the score is shown there.
- **Scan.** "Hear the tempo" (one bar of clicks) is always allowed. Hearing the music before the take is a real choice:

  - **Option A (recommended): "Listen first", which makes the take practice.** On scan the button reads "Listen first" with a hint beneath: "Makes this a practice take." On a ranked take, pressing it asks once: "Listening first makes this a practice take. Listen anyway?" The mode chip then changes to Practice in front of the user. Honest, and the owner gets what he asked for.
  - **Option B: listening only after the take.** Simpler and keeps every take a true sight-reading test, but it refuses the owner's request on the scan screen.

  I recommend A. It matches the existing seen-before rule, and the downgrade is shown at the moment it happens.

### The reference, explained (point 8)

The owner asked what the reference is. The plain answer, which the screen should say for itself: **the reference is the key.** It plays the home chord of the key, then the first note you will sing, so you can find your starting pitch. Singers are graded on pitch relative to that start, in any octave.

Design:

- **Name.** "Starting note". Short enough for a phone button. The full description does the rest.
- **Placement.** For voice, beside "Start playing" on scan, and again on the count-in screen as "Play starting note again" until the count-in begins. Not below the checklist, not inside a sheet.
- **Visible description.** One line under the button, always visible: "Plays the key chord, then your first note."
- **Info button.** An "i" button beside it opens a small popover on tap, click or focus (not hover only): "The reference is the key of the piece. You hear its home chord, then your first note. Sing from there. Your pitch is marked against this start, in any octave that suits your voice."
- **Show what plays.** While the chord sounds, the key signature on the score glows brass. While the first note sounds, the first notehead glows brass and its name appears beside it ("D3"). The reference explains itself by pointing at the music. This is the design idea I most want to keep.
- **Instruments.** The microphone "Tuning note" becomes "Check my tuning" with the line "Hold any note for two seconds. We'll allow for your tuning." Different name, different icon (a tuning fork), so nobody confuses it with listening.

Hierarchy on scan for voice, top to bottom of the action group: Start playing (primary), Starting note, Listen first, Hear the tempo. For instruments: Start playing, Listen first, Hear the tempo, Check my tuning.

### Metronome click (point 7)

The sound itself is a sound-design task with a calibration check, as the UX rating says. Design's part:

- Settings names the sounds by how they sound: "Metronome" (default), "Woodblock", "Soft tick". Each has a play button that plays one bar with the accented downbeat.
- The beat dots during count-in and take show the downbeat larger, so eye and ear agree.
- Calibration uses the same click the user picked, with a play button on the card.

### Performance screen

- The page is centred with printed-part margins (at least two staff spaces left and right on phone, 48 px or more on desktop). The clef never touches the screen edge.
- Notation is scaled to fill the page height for the bars shown, not left at the top with empty paper below.
- **Count-in.** The page dims slightly. A large brass number (96 px desktop, 72 px phone) pulses in the centre of the screen on each click, with "Bar 1 · ♩ 72" beneath it. On the last beat the number fades and the page brightens. For voice, "Play starting note again" sits under the count until the first beat.
- **Playhead.** One soft brass wash behind the current bar. The grey line and the extra next-bar marker go.
- **Slips.** Marks sit on or right beside the notehead, at notehead size, in vermilion, at full opacity. Wrong pitch: the written notehead turns vermilion and a ghost notehead with 40% fill sits at the pitch played. Late or early: a small arrow beside the notehead pointing the way the note moved. Missed: a vermilion ring around the notehead. One event gets one mark, never two glyphs.
- **Status strip** at the bottom: "Bar 5 of 8", a labelled input meter ("Mic"), and a Stop button with the word "Stop". 16 px text minimum.

### Results screen

- **Order.** Grade, then the music, then the numbers. On phone the score comes before the component bars, not below them.
- **Grade moment.** The grade letter in the display serif at 96 px, the score beside it in tabular numerals, the stars in brass. It lands with one short motion: the letter scales from 96% to 100% and fades in over 300 ms while the stars fill one by one. Reduced motion shows it still.
- **The score.** In ink, with only the slips marked as in the take. A "Prev slip / Next slip" pair moves the brass highlight. Listen and My take sit in the score's toolbar.
- **States.** Graded ranked; graded practice; practice because not calibrated; void. Each has its own header line in plain words. A void take shows the clean score in ink and one calm message ("We couldn't hear you, so this take wasn't graded.") with Check microphone and Try again. No red.
- **Components.** Pitch, intonation and rhythm as short horizontal bars with the number at the end, in ink, with the weakest one named in words ("Rhythm is the one to work on"). No "focus" label.
- **Rank and XP.** One line under the grade: "+12 XP · 40 to Apprentice", with a thin bar. Never wider than the grade block.
- **Credit.** One line, no repeats: composer, work, bars, licence.

### Smaller screens

Tips is skipped when empty. Errors become full screens with a cause and "Back to practice". Credits and Not found get the same type and colour. These follow once the core loop is done.

## Choices for the UX expert to answer

| Choice | Option A | Option B | My pick |
| --- | --- | --- | --- |
| Type | Serif display, sans text | One sans | A |
| Colour | Paper, ink, brass for "now" | Paper, ink, deep blue | A |
| Key control | Key-signature chips | Select, "Any key" first | A, B as fallback |
| Listening on scan | "Listen first" makes it practice | Listen only after the take | A |
| Range on cards | Shared ruler bar, one large staff | Staff on every card | A, unless a test says otherwise |

Questions back to the UX expert:

1. Will the key-signature chips confuse a beginner who cannot yet read signatures, given the key name is printed beneath?
2. Is a one-time confirm before "Listen first" on a ranked take enough, or should Listen first be absent in ranked mode altogether?
3. Do you accept the legibility test at 1 m as the way to settle the live-mark size?
4. "Starting note" or "Play key and first note" as the button label, given the visible line beneath it?
5. Band names for difficulty: should they appear at all, or only "2 of 10" and the description?

Once these are answered I will write the screen-by-screen spec and the token changes, with mockups for setup, scan, the take and results in both themes and both sizes.
