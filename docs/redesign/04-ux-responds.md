# UX response to the design rating

Author: principal UX expert.
Reads: `01-design-rating.md` (designer) and `02-ux-rating.md` (mine).
Purpose: settle where we agree, argue where we do not, and set out the experience the spec and plan should build. Every open question gets a decision here. The designer may push back in the next round; until then these decisions stand.

## Summary

We agree on almost everything that matters. We both found that Key and Time look dead because of a Random chip far from them, that "Level" must become "Difficulty", that the range must be drawn as music, that the reference is unexplained, and that the app needs a way to hear the excerpt. We both keep calibration.

We differ on six points. In short:

1. No "My take" playback in v1. Play the written music only.
2. Listening before a ranked take is allowed, behind a confirm, and turns the take into practice. It is not "only after the take".
3. No band names for difficulty. Number of 10 plus the existing description.
4. No written/sounding toggle on the range strip. Written range first, sounding as text.
5. Key picker is a grid, not a circle.
6. Disabled meters are not shown on hover or focus. Unavailable meters are left out, with a visible note.

Build order: fix the owner's ten points and the setup screen first, the score frame and feedback marks second, the results moment third, brand and the smaller screens last. The designer puts the score frame first. I put it second because the owner's complaints are about setup and sound, and he will try those first.

## Where I agree with the designer

- **Overall verdict.** A 4 for looks and my 5 for use are the same story: a sound engine inside an unfinished shell.
- **Home is the weakest screen.** The designer's summary card with a big Start, and settings opened on demand, is the right model. Details below.
- **"Any" inside each control, not a separate chip.** This is the fix for owner points 4 and 5. We wrote it independently.
- **Six voices in a 3 by 2 grid**, named by voice alone under a "Voice" heading.
- **Difficulty everywhere**, and "rank" kept for XP progress so the two words never collide.
- **Range strip drawn on a staff** with the lowest and highest notes as whole notes and the note names beneath.
- **Calibration: keep the flow, one card, a stronger visual, a result in plain words.**
- **Metronome options named for what they sound like, each with a play button, and an accented downbeat.**
- **Move the voice reference up beside Start playing**, out of the checklist and out of the phone's bottom sheet.
- **Count-in in the centre of the screen.** The designer scored it 4 and I scored it 6. The designer is right that it lacks weight; my 6 was for clarity alone.
- **Feedback marks at notehead size, real margins on the page, one soft bar highlight** in place of three overlapping playhead shapes.
- **Void and review scores stay calm ink with only slips coloured.** This also fixes my "sea of red" finding for void takes: a void shows the clean score.
- **Tips screen.** Skip it when empty. I go further below: fold tips into results.
- **Drop the name field from the welcome screen.** It costs a step and adds nothing to the first take.
- **The iPhone sticky Start covering rows is a defect,** not a taste issue. Fix before any polish.

## Where I disagree, and why

### 1. "My take" playback in review

Designer: in review, "Listen" plays the written music and "My take" plays back the judged notes.

My view: not in v1. Ruling R9 puts listen-back after v1 and forbids stored audio. A synth replay of detected notes is not stored audio, but it is worse than none. Where detection is uncertain (soft onsets, vibrato, octave slips on voice) it plays notes the player did not play, in a synth voice, and invites "that's not what I did". The marked score already shows the difference precisely. v1 plays the written music only. Revisit after v1 with real listen-back.

### 2. Listening before a ranked take

Designer: either listening turns the take into practice, or allow it only after the take.

My view: allow it, make it practice, and confirm first. Blocking it in ranked would send the owner hunting for a feature that exists in one mode only. Hiding it until after the take ignores what he asked for ("a way to hear it" when he starts). The confirm protects the ranked player from an accident. Full rules are in "Hear it" below.

### 3. Difficulty band names

Designer: show difficulty as a 10-step meter with a name per band ("1 to 3 Beginner").

My view: no band names. The app already has rank names (Novice, Section player, First call, Maestro). A second ladder of words ("Beginner", "Intermediate") next to the first will be confused with it, and the owner already found one collision ("level" for two things). Use "Difficulty 2 of 10", the 10-step meter, and the description line that already exists per level ("Adds eighths, minor keys and one-beat pickups"). The description tells the player more than a band name would.

### 4. Written / sounding toggle on the range strip

Designer: a small toggle "written / sounding" for transposing instruments.

My view: no toggle. A toggle is a control most players will never touch, and the 12-year-old trumpeter will not know which to pick. Show the written range on the staff, since that is what the player reads. Beneath it, one line: "Sounds a major 2nd lower: E3 to B♭5". Non-transposing instruments show no second line.

### 5. Key picker as a circle

Designer: "a row or circle of key buttons with their key signatures drawn".

My view: a grid, in key-signature order, not a circle of fifths. The circle is beautiful to people who already know it and intimidating to people who do not. A grid reads in one direction, wraps cleanly on a phone, and works with arrow keys. Keep the drawn key signatures; they are the best part of the idea.

### 6. Disabled meters with a reason on hover and focus

Designer: disabled meters show a reason on hover and focus.

My view: hover fails on phones, where half of my test runs happened. Do not show meters the player cannot choose. Under the control, one visible line: "3/4 and 2/4 arrive at difficulty 3." If a meter is available only in small numbers, show it with "few pieces" beneath it, still selectable. "Any" draws only from the meters shown. This also fixes the bug where Any served 3/4 after the screen said 3/4 had no music.

### 7. Settings "as a sentence you can edit"

Designer, final paragraph: settings shown as a sentence you can edit.

My view: right idea, wrong form. A sentence of six tappable words is hard to hit on a phone, wraps unpredictably, and reads badly to a screen reader. Use a summary card of labelled chips ("Baritone", "Difficulty 2", "Any key", "4/4", "♩ 72", "8 bars"). Each chip is a button with its row name in its accessible label ("Key: any key. Change").

### 8. Calibration visual

Designer: one large beat circle that fills on each detected click.

My view: keep the ten-dot progress row too. The owner likes calibration as it is, and the dots are why: they say "4 of 10 heard" at a glance. Put the large pulsing circle on top for the beat and keep the dots beneath for the count. One card, not two.

### 9. Metronome option names

Designer: "Classic metronome", "Woodblock", "Soft tick".

My view: replace "Soft tick" with "Beep". A soft tick is the sound the owner rejected, and it is the hardest sound for the calibration detector and for players in a loud room. The third option should be the one that cuts through: a short electronic beep.

### 10. Priority order

Designer: score frame and feedback marks first.

My view: second. See the summary. Both orders end in the same place; mine fixes what the owner reported before what he did not.

## The proposed experience

### Information architecture

Top level, in the app bar on desktop and a bottom tab bar on the phone:

| Tab | Holds |
| --- | --- |
| Practice | Home: setup summary, Start, today's progress, ranked or practice notice |
| Progress | Rank, XP, per-instrument difficulty, personal bests |
| History | Past takes; each opens a detail with its score and Listen |
| Settings | Sound (metronome, tuning pitch), calibration, appearance, data, about and credits |

Rules:

- Tabs are hidden during onboarding. Onboarding is a linear flow with Back.
- The practice loop is full screen with no tabs: read-through cover, read-through, count-in, take, results. Exit goes to Practice.
- Tips are not a screen. They appear on results as one "One thing to try" section, or not at all.
- Calibration is reachable from onboarding, from the home notice, and from Settings. It is the same card in all three.
- Credits move under Settings > About. The not-found page offers "Go to Practice".

### Flow from first launch to the third take

**First launch (onboarding, about 90 seconds):**

1. **Welcome.** A large engraved phrase of real music, one sentence ("Real music, a few bars at a time. We listen and show you every note."), one button: "Get started". No name field.
2. **Choose your instrument.** Voice first as a 3 by 2 grid: Soprano, Mezzo, Alto, Tenor, Baritone, Bass. Then instrument families. Every card shows its range strip in small. Selecting a card shows the large range strip below the grid (see "Range picture"). "Show more instruments (less tested)" at the foot.
3. **Microphone.** As now. "Not now" says: "You can still practise, but takes won't be graded."
4. **Calibration.** As now, with the new click and the visual change in point 8 above. Skip says: "Takes will be practice only until you calibrate. You can do it later from Practice."
5. **Difficulty.** "Choose a starting difficulty." Stepper labelled "Difficulty 2 of 10", the 10-step meter, the description line, and the range served at that difficulty for the chosen instrument ("At difficulty 2: A2 to A3"). Default 2.
6. **Land on Practice.** Tabs appear. A one-time hint under the summary card: "Tap any setting to change it."

**Take 1 (fresh player, calibrated):**

1. Practice home: summary chips, a line "Ranked: full XP, fresh music, 30 seconds to read", big Start.
2. Read-through cover: the clef, key signature and time signature engraved at three times size, with tempo and bar count beneath. One summary line, not two. Button "Show the music". In ranked, one line: "You'll have 30 seconds to read, then the count-in starts."
3. Read-through: the score large and centred. Toolbar, left to right: countdown with text ("0:24 left"), Hear the tempo, Hear starting pitch (voice) or Hear the key (instruments), Listen, Start playing. The "Before you play" checklist (STARS as a small heading) sits beside the score on desktop and in a labelled sheet on the phone ("Before you play: 0 of 5"). The checklist is optional and says so: "Optional. Tick as you check."
4. First time only, a coach mark points at Listen and Hear starting pitch, each with its one-line explanation. It does not return.
5. Count-in in the centre: large beat numbers that pulse with the click, downbeat accented. For voice, the starting pitch plays first, as it does today, with "Your starting pitch" shown while it sounds.
6. Take with live feedback.
7. Results: grade and score, the score in calm ink with slips coloured, Listen, "One thing to try" if any. Primary button "Next piece". Secondary "Try again (practice)". Tertiary "Change setup".

**Take 2 (straight on):** "Next piece" keeps the setup and goes to the read-through cover of a new excerpt. No home screen in between. This is the fast loop.

**Take 3 (changing something):** from results, "Change setup" opens the setup sheet over the results; on close it goes to the cover of a new excerpt with the new setup. If the take earned a difficulty offer, results show it first: "Ready for difficulty 3? Adds 3/4 and 2/4, and keys up to 2 sharps or flats." with "Go to difficulty 3" and "Stay at 2".

If the player is not calibrated, the home line reads "Practice only on this device. Calibrate now (1 minute)." and Ranked is not offered until calibration passes. Nothing turns from Ranked into Practice after the take without having said so before Start, except listening first, which the player chooses in the moment.

### The setup model

One sheet, opened from any chip on the summary card. Same order on desktop and phone. Every control that offers random has "Any" as its first option, inside the control. Choosing a value turns random off for that row; choosing Any turns it on. No separate Random chips anywhere.

| Setting | Options | Random option | Default |
| --- | --- | --- | --- |
| Instrument | Voice: Soprano, Mezzo, Alto, Tenor, Baritone, Bass. Then families. | None. A player practises one instrument at a time, and difficulty and history are per instrument. | Onboarding choice |
| Difficulty | 1 to 10 (only served levels enabled), each with its description | "Mixed (1 to 2)": the selector's existing rule, at or below yours with some from one below | Your current difficulty |
| Key | Grid of written keys allowed at this difficulty, each with its drawn key signature and name. Transposing instruments show "concert E♭" beneath. | "Any key", first in the grid, with "+XP" tag | Any key |
| Time | Meters available at this difficulty, drawn as stacked numbers in the music font | "Any", first segment, with "+XP" tag | Any |
| Tempo | Slider plus number, limited to the difficulty's range ("60 to 84") | "Any tempo in range", a switch above the slider; when on, the slider is hidden, not greyed | Any |
| Length | Bar counts allowed at this difficulty | "Any" when more than one length exists | Any |

Rules for the controls:

- **Instrument row shows the small range strip** beside the instrument name, on the summary card and in the sheet.
- **One option only:** when a difficulty allows one length (difficulty 2 allows 8 bars), show plain text, "8 bars (the only length at difficulty 2)", not a control.
- **Unavailable values:** left out, with a visible line beneath the control naming what arrives later.
- **Few pieces:** values with little music stay selectable, with "few pieces" beneath and, on select, "Some pieces may repeat."
- **XP for random:** each "Any" option carries its own small "+XP" tag. The summary card shows the total once: "Any key, time and tempo: +24% XP".
- **Mode:** a two-option control at the top of the sheet, above the fold on the phone: "Ranked" and "Practice", each with a visible hint. Ranked: "Full XP. Fresh music, timed read-through." Practice: "Quarter XP. Take your time, listen first if you like." If Ranked is blocked, it shows why and how to fix it.
- **Output** (speakers or headphones) moves to Settings > Sound. It is set once per device.

### Range picture

Three sizes of one component:

- **Card (small):** a single staff in the instrument's clef, two whole notes for the lowest and highest written notes, a filled bar between them, note names beneath ("G2 to G4").
- **Detail (large, under the grid and in the setup sheet):** the same staff wider. Two shades on the bar: the full range light, the range served at the current difficulty dark, labelled "At difficulty 2: C3 to C4". Changing difficulty moves the dark band. Transposing instruments add the sounding range as one line of text.
- **Summary chip:** the small strip without note names, 64 px wide.

Voice ranges come from `fullWrittenRange` and `tiers` in `config/instruments.json`. Proposed new entries, for the musician to confirm against the corpus:

| Voice | Clef | Full written range | Tier A |
| --- | --- | --- | --- |
| Mezzo | Treble | G3 to A5 (55 to 81) | C4 to C5 (60 to 72) |
| Baritone | Bass | G2 to G4 (43 to 67) | C3 to C4 (48 to 60) |

Order on screen: Soprano, Mezzo, Alto, Tenor, Baritone, Bass. Baritone and mezzo ship only if the corpus gate (R24) finds a non-empty selection at every served difficulty. If a difficulty has little music for a voice, the card says "Fewer pieces at difficulty 1" rather than hiding the voice.

A "find my voice" range test (sing your lowest and highest note) is useful, but not now. The owner knows he is a baritone.

### "Hear it": what plays, when, and what it costs

| Moment | Control | What it plays | Cost |
| --- | --- | --- | --- |
| Read-through | Hear the tempo | One bar of metronome clicks at the set tempo, downbeat accented | None, any mode |
| Read-through | Hear starting pitch (voice) | Key chord (root, third, fifth), then the first note | None, any mode |
| Read-through | Hear the key (instruments) | Key chord only, no first note | None, any mode |
| Read-through | Listen | The excerpt at the set tempo in the instrument's synth voice, sounding pitch, bar highlight following | Practice: none. Ranked: the take becomes practice, after a confirm |
| Count-in | Starting pitch (voice, automatic) | As today: key chord and first note, before the first click | None |
| Take | Nothing | No playback during a take. It would be heard by the microphone. | |
| Results | Listen | The excerpt at the take's tempo with the bar highlight. Tap a bar to start from it. "Slower" switch plays at 75%. | None |
| One thing to try | Listen to bar 5 | The bar the tip names, twice | None |
| History detail | Listen | As on results | None |

Details:

- Listen plays one bar of clicks first, then the music without clicks. A "Click along" switch keeps the clicks on.
- Pressing Listen again stops it. While it plays, the button reads "Stop".
- Listen and the ranked countdown: the countdown keeps running while music plays and while the confirm is open. Otherwise the confirm becomes a way to buy reading time.
- "Hear the tempo" needs wiring: the copy and the button slot exist, but nothing sets `hearTempo`.

### Listening before a ranked take

Decision: allowed, and it makes the take practice. The player is told three times, so it is never a surprise.

1. **On the button**, in ranked only: "Listen" with a small second line "makes this practice".
2. **A confirm sheet** on press, every time, in ranked only:
   - Title: "Listen first?"
   - Body: "Hearing the music before you play makes this a practice take. It earns a quarter of the XP and doesn't count for rank."
   - Buttons: "Listen, make it practice" and "Keep it ranked" (default focus).
   - No "don't ask again". The mistake cannot be undone, and a player who always wants to listen should choose Practice.
3. **After confirming:** the mode chip changes from "Ranked" to "Practice" with a short animation and a polite live-region announcement ("Now a practice take"). The results badge reads "Practice: you listened first."

Record it as a new `RankedReason`, `listened-first`, with that copy. In practice mode, Listen has no second line and no confirm.

Starting pitch and key chord never change the mode. They give no melody, and a given starting note and key chord is how sight-singing is examined.

### Explaining the reference

The owner guessed "maybe the reference is the key". He was half right. The control should say what it plays, and say it without a hover.

- **Name:** "Hear starting pitch" for voice. "Hear the key" for instruments.
- **Visible caption under the button, always shown:**
  - Voice: "Plays the key chord, then your first note. You're graded on pitch relative to this."
  - Instruments: "Plays the key chord so you can hear the key."
- **Info button (i) beside it** opens the same text plus one more line on tap, click or focus. Voice: "We play it again just before the count-in." This replaces any rollover. A native `title` is added too, for mouse users, but never as the only route.
- **While it plays,** the caption becomes the live state: "Key chord: D major…" then "First note: D3". The first note is also highlighted on the score.
- **"Tuning note"** becomes "Check my tuning", with caption "Hold any note for two seconds. We'll allow for your tuning." It is separate from the reference and stays for winds, brass and strings.

Do non-singers get a starting note? No. An instrumentalist produces the written note from the fingering, so the first note would only remove part of the reading task. The key chord helps them hear the key without giving away the line, so they get that, in ranked too.

### Metronome sound

Three options in Settings > Sound > Metronome, each with a play button that plays one bar:

| Option | Sound | Use |
| --- | --- | --- |
| Classic (default) | Mechanical metronome: short pitched click with low body, about 1.5 kHz with energy down to a few hundred hertz. Downbeat a fourth higher. | Most players |
| Woodblock | Hollow woodblock, two pitches, high on the downbeat | Players who like a softer, rounder click |
| Beep | Short electronic beep, high on the downbeat | Loud rooms, brass, speakers far away |

Rules:

- **Accented downbeat on by default,** with a switch "Accent the first beat".
- **Separate click volume** slider beside the options.
- **"Count-in only"** becomes "Click during the take: On / Count-in only".
- **Calibration uses the chosen click.** The calibration card has its own play button.
- **Every option must pass the calibration detector** at the configured gates before it ships. This is a sound-design task with a measurement check. If one fails, it does not ship; the other two do.
- Existing "Tick" settings migrate to Classic, "Wood" to Woodblock.

### Vocabulary

Internal names in code stay. Only what the player sees changes.

| Old term | New term | Note |
| --- | --- | --- |
| Level (music difficulty) | Difficulty | Written "Difficulty 2 of 10" where space allows |
| Starting level | Starting difficulty | Onboarding |
| needs level 2 | Reach difficulty 2 to unlock | Rank bar |
| Go to level 3 / Stay at 2 | Go to difficulty 3 / Stay at 2 | Level offer |
| New best at level 2 | New best at difficulty 2 | Results |
| Voice (soprano) and so on | Soprano, Mezzo, Alto, Tenor, Baritone, Bass | Under a "Voice" heading. History rows: "Baritone voice" |
| Random (chip) | Any key / Any / Any tempo in range / Any length | Inside each control |
| Mixed difficulty (did not exist) | Mixed (1 to 2) | Difficulty's random option |
| Scan | Read-through | Stage name |
| Start scan | Show the music | Cover button |
| Scan · 0 of 5 | Before you play: 0 of 5 | Phone sheet label |
| STARS | Before you play (STARS as small heading) | Each item keeps its letter |
| Hear the reference | Hear starting pitch (voice) / Hear the key (instruments) | With visible caption |
| Tuning note | Check my tuning | With caption |
| (no button) | Hear the tempo | Wired up |
| (no button) | Listen | Read-through, results, history |
| Ranked | Ranked | Kept, with visible hint |
| Practice | Practice | Kept, with visible hint |
| Practice / Practice mode. | Practice | Badge says it once; reason line only when it adds something |
| focus (under Notes) | Work on this | Or dropped if the tip covers it |
| Timing may be offset | Not calibrated: timing marks may be a little off | |
| Drifted 24 ms ahead | You sped up slightly by the end | Milliseconds in a detail line only |
| +5 XP (practice, 25%) | +5 XP (practice earns a quarter) | |
| Tick / Wood | Classic / Woodblock / Beep | |
| Count-in only | Click during the take: On / Count-in only | |
| A4 reference | Tuning pitch (A = 440 Hz) | Removes the second meaning of "reference" |
| Show beta instruments | Show more instruments (less tested) | |
| Not much music here yet | Few pieces here: some may repeat | |
| Audio setup problem. Please reload the page. | Names the cause, offers "Try again" and "Back to Practice" | Every error |

## Decisions on open questions

| Question | Decision |
| --- | --- |
| Add mezzo as well as baritone? | Yes, both, subject to the corpus gate |
| Voice order | Soprano, Mezzo, Alto, Tenor, Baritone, Bass |
| Random instrument? | No |
| Random difficulty? | Yes, as "Mixed (1 to N)" using the existing selection rule |
| Band names for difficulty? | No |
| Written / sounding toggle? | No; sounding as a text line |
| Key picker form | Grid with drawn key signatures, Any first |
| Unavailable meters | Left out, with a visible line naming when they arrive |
| Does Any draw from hidden meters? | Never |
| Listen before a ranked take | Allowed; confirm every time; becomes practice; new reason `listened-first` |
| Countdown during Listen or confirm | Keeps running |
| Playback during the take | Never |
| "My take" playback | Not in v1 |
| Listen speed | Take tempo, with a "Slower" (75%) switch on results and history |
| Starting note for instruments | No; key chord only |
| Does the key chord affect ranking? | No |
| Rollover for the reference | Replaced by a visible caption and an info button; `title` as extra only |
| Default metronome | Classic, downbeat accented |
| Metronome options | Classic, Woodblock, Beep, each with preview |
| Tips screen | Folded into results |
| Name field on welcome | Removed; optional in Settings |
| After results, primary action | Next piece, straight to the cover |
| Mode on phone | At the top of the setup sheet, above the fold |
| Ranked when not calibrated | Not offered; home says why with "Calibrate now" |
| Calibration visual | Large pulse circle above the ten-dot row, one card |
| Build order | Owner's points and setup; score frame and marks; results moment; brand and small screens |

## For the designer, next round

Please respond on the six disagreements, and design these first, since the spec depends on them:

1. The range strip at its three sizes, light and dark.
2. The key grid and the time segments with Any first, at desktop and 390 px.
3. The read-through toolbar with the three sound buttons, their captions and the ranked Listen second line, at 390 px, where space is tightest.
4. The listen-first confirm sheet and the mode chip change.
5. The calibration card with the pulse circle over the dots.
