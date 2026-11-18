# UX rating of the current build

Reviewer role: UX research and interaction design, music education.
Build: dev server on this branch, Chromium with a fake microphone, 18 Nov 2026.
Screenshots: `docs/redesign/shots-ux/` (desktop 1440x900 and iPhone 390x844, light and dark, scale 1).

## How this was tested

I walked the full loop three times, once as each person below. A synthetic take was played through the fake microphone, so the results screens show real grading. Where a finding comes from one run only, it says so.

| Person | Setup | Screenshots |
| --- | --- | --- |
| Owner: baritone, reads a little | Desktop, light, Voice (bass), Ranked, calibration skipped | `bari-*` |
| Adult returning clarinettist | Desktop, dark, Clarinet, Practice, tried calibration | `clar-*`, `probe-02-*` |
| Trumpet student, age 12 | iPhone, light and dark, Trumpet, Ranked | `tpt-*`, `ph-light-*`, `ph-dark-*` |

Scores are 1 to 10. They cover clarity of the next step, wording, findability, feedback, error recovery, effort, accessibility and trust in the grading. A 10 means a first-time user gets through without help and believes the result.

## Scores

| # | Screen | Score | Worst problem |
| --- | --- | --- | --- |
| 1 | Welcome | 7 | Practice, Progress and History tabs show during onboarding and lead to empty or half-set screens. |
| 2 | Choose instrument | 4 | No baritone or mezzo. No range shown, so a singer cannot tell which voice fits. |
| 3 | Microphone | 8 | Fine. "Not now" does not say that takes will not be graded. |
| 4 | Calibration | 7 | "Skip" does not say that every take will then be practice with almost no XP. |
| 5 | Starting level | 4 | A bare "2" with plus and minus and no label. It does not say what the number means or how many levels there are. |
| 6 | Practice setup (home) | 3 | The key dropdown and time selector are locked by a "Random" chip about 500 px away. They look broken. |
| 7 | Scan cover | 5 | The summary line is printed twice. "Skip" and "Practice instead" are not explained. |
| 8 | Scan | 4 | "Hear the reference", "Tuning note" and "STARS" are not explained. There is no way to hear the music. |
| 9 | Count-in and take | 6 | The live feedback is clear. The input meter has no label, and on the phone Stop is an icon with no text. |
| 10 | Results | 6 | A take started as Ranked comes back as "Practice" with a one-line reason. That damages trust. |
| 11 | Tips | 6 | When there are no tips, this screen adds a click and says nothing. |
| 12 | Progress | 5 | "Needs level 2" shows while the player is already at level 2. Five empty boxes are not labelled. |
| 13 | History | 6 | The meter column shows the raw value "random" instead of the meter that was played. |
| 14 | Settings | 6 | You cannot preview the click sound. "A4 reference" is jargon. |
| 15 | Error: "Audio setup problem" | 2 | A dead end: "Please reload the page" next to a "Retry" button, with no cause given. |

**Overall: 5.0 out of 10.** (This is the mean of the screen scores. The six core loop screens, 2, 5, 6, 8, 9 and 10, average 4.5.)

The engine is better than the interface around it. Grading, the red notes, the ghost notes and the results review all work and are believable. The setup screen and the scan screen are where people get stuck. Both use terms the app never explains.

## The owner's ten points, from a behaviour angle

### 1. Baritone voice

What happens: the voice group has four cards, Voice (soprano), (alto), (tenor) and (bass) (`d-light-03`). A baritone has to guess. In my run Voice (bass) served bars that reached down to B2 and up to G3, which suits a baritone, but nothing on screen says so. Choosing Tenor would put him near the top of his range.

What is needed: six voices, soprano, mezzo-soprano, alto, tenor, baritone and bass, in that order. Show each one's range on the card (see point 2). Name the cards by the voice alone ("Baritone", not "Voice (baritone)"), since the group heading already says "Voice". If baritone is added, check that the corpus serves a baritone range at every level. If only a few excerpts fit, show the "Not much music here yet" note on the card itself.

### 2. Range shown when an instrument is chosen

What happens: no range is shown anywhere: not in onboarding, not on the home dropdown, not in Progress. The only extra line, on transposing instruments, is "B♭: sounds a major 2nd lower". That is correct but means nothing to the 12-year-old.

What is needed: a small staff, with the clef and two whole notes (lowest and highest), plus the note names ("A2 to F4"). Put it on each instrument card and next to the instrument select on home. For transposing instruments, show the written range, since that is what the player reads, and give the sounding range as secondary text. For voices, the range is what helps a singer choose. Think of the range as the label, not as decoration.

### 3. "Level" means difficulty

The word "level" does two jobs today: it is the difficulty of the music, and through rank it gates progress ("needs level 2"). Where people meet it:
- Onboarding step 5: a bare stepper, no word at all (`bari-05`).
- Home: "Level" row, "Level 2" in the scan summary, "Not much music here yet".
- Results and Progress: "needs level 2", "New best at level {level}", "Go to level {level}", "Stay at {level}".
- History rows and filters, the Progress instrument card.
- Copy keys: `row.level`, `progress.instrumentLevel`, `level.offer`, `level.autoUp`, `level.down`, `rank.bar`, `rank.bar.needsLevel`, `results.personalBest`, `action.goToLevel`, `action.stayAt`, `xp.factor.levelBase`, `xp.factor.belowLevel`, `scan.summary`, `home.levelNoMusic`, `home.levelFewMusic`, `home.keyFootnote`, `home.selector.noUnseen`.

What is needed: say "Difficulty" everywhere the user sees it, with the number written as "Difficulty 2 of 10". Pair the number with a one-line description, which already exists ("Adds eighths, minor keys and one-beat pickups"). Rank gates become "Reach difficulty 2". The onboarding stepper needs the label "Difficulty", the "of 10", and the description. Internal names can stay as they are.

### 4. The key dropdown does not work

What I saw: there are two behaviours, depending on the instrument.
- Clarinet and trumpet: the select is greyed out and holds one option, "Random" (`clar-08`, `tpt-06`). It only unlocks when you turn off the "Random" chip at the far right of the row (`probe-02`). Nobody connects the two. The caption under the select ("Any key up to 1 sharp or flat") reads like a promise the control does not keep.
- Voice (bass): the select is live and lists Random plus six keys, while the chip is also pressed (`bari-06`). So "Random" is offered in two places at once.
- On the iPhone run the trumpet select was live again with the chip pressed (`ph-light-03`). The same control behaves three ways.

What the control should do: use one control. A select whose first option is "Any key (random)" and whose other options are the keys. No separate chip. Choosing a key turns random off; choosing "Any key" turns it on. Show the XP bonus for random next to that option, not in a sentence under Mode.

### 5. The time signature selection does not work

What I saw: at difficulty 2 all three segments (4/4, 3/4 and 2/4) render greyed and italic while the Random chip is on, so none can be pressed (`bari-08`, `clar-08`). After the chip is turned off, only 4/4 is enabled. 3/4 and 2/4 explain themselves only through a hover title ("Not enough music in 3/4 at this level yet"). A phone has no hover, so on the phone they are simply dead. Then, in the clarinet run, the next random excerpt came up in 3/4 (`clar-16`): the app served the meter it had just said it did not have. The user is right that this does not work.

What the control should do: the same pattern as key, a segmented control whose first segment is "Any". Meters with no music are hidden or shown with a visible note under the control, not a tooltip. "Any" must only draw from meters that are shown as available, or the note must say "3/4 appears in random picks only".

### 6. Calibration

Keep the flow. It is the clearest screen in the app: one sentence on why, a row of ten circles that fill as clicks are heard, "0 of 10 heard", and three plain ways out (Try again, Play along instead, Skip) (`clar-05`). Two small fixes:
- Under Skip, say what skipping costs: "Takes will be practice only until you calibrate."
- In onboarding, calibration should use the same click the metronome will use (see point 7).

### 7. A metronome-sounding click

What happens: the default "Tick" is a 12 ms burst with almost no energy below 1 kHz. It sounds like a thin electronic tick, not a metronome. "Wood" is shorter still. Settings offers Tick and Wood with no way to hear either before choosing (`bari-20`).

What is needed: a default click that sounds like a mechanical or woodblock metronome. That means a short, pitched attack with some low body. The downbeat should be clearly accented, by a higher pitch or a bell. Add a play button next to each option in Settings, and on the calibration card. Whatever replaces it must still pass the calibration detector, so this is a sound-design task with a measurement check, not a free choice.

### 8. "Hear the reference": explain it

What happens: voice only. The scan screen shows a button, "Hear the reference" (`bari-11`). Hovering shows nothing: no title, no description, no popover (`bari-12`). Pressing it plays four pure tones: the tonic, third and fifth of the key, then the first note. Nothing on screen says this. The owner guessed "maybe the reference is the key", and he was half right.

Clarinet and trumpet get "Tuning note" with a microphone icon instead. It listens for a held note and offsets intonation. That is not explained either.

What is needed:
- Rename it after what it does: "Play key and first note".
- Put a one-line explanation under or next to the button, visible without hovering: "Plays the key chord, then your first note, so you can find your starting pitch. Singers are graded on pitch relative to this."
- An info button that opens the same text on tap, so it works on a phone.
- While it plays, show which tone is sounding: "Key chord… first note: D3".
- "Tuning note" becomes "Check my tuning" with "Hold any note for two seconds. We'll allow for your tuning."
- Allow the reference again right before the count-in for voice. Today it is only on the scan panel, and on the phone it is inside the "Scan · 0 of 5" sheet, so it is hard to find.

### 9. A way to hear the music

What happens: there is no playback of the excerpt anywhere: not on scan, not on results, not in history. The STARS item "Tempo" says "hear the click", but no "Hear the tempo" button exists. The copy is there, but the service is never wired up (`ScanScreen.tsx` renders the button only if `hearTempo` is set, and nothing sets it). So the app promises a sound it does not play.

What is needed, keeping sight-reading honest:
- **On results: "Listen to this excerpt".** Always available. It plays the written line at the take's tempo, with a playhead on the staff. A "My take / Clean score" switch is already there, so this fits next to it. This is the main answer to the owner.
- **On scan: "Hear the tempo".** One bar of clicks. Wire it up.
- **On scan: "Listen first" (practice only).** Playing the excerpt before a take makes the take practice. It earns no ranked XP, as the seen-before rule already does. Say so on the button: "Listen first (makes this a practice take)". Ranked users never hear it by accident, and practice users are not blocked.
- The excerpt does not repeat on "Try again". That already becomes practice, so playback adds nothing new there.

### 10. Overall quality

The person asked for polish. These are the behaviour problems that polish must fix, not paint over:
- **Unexplained terms.** Reference, Tuning note, STARS, Ranked, Practice, Scan, Level, Rank, "focus" (under Notes on results), "Timing may be offset", "Drifted 24 ms ahead", "Incomplete", the red and grey heat strips above each bar, "Count-in only", "A4 reference", "Show beta instruments". Each needs a plain label, or a visible one-line hint, or an info button. Hover-only titles do not count, because half of these people are on phones.
- **Silent downgrades.** Ranked turns into Practice after the take ("Calibrate to earn XP on this device", `bari-16`). The user should be told before Start, on the home screen, with a "Calibrate now" link.
- **Controls that look dead.** Key, Time, and the greyed Random chips.
- **Duplicated information.** The scan cover prints the summary line twice (`bari-10`). Results credit: "Gartenlieder, Op.3, Op.3".

## Findings by person

### Owner: baritone who reads a little

- Instrument step: looked for baritone, found none, picked Bass by guessing.
- Level step: "2" alone. He does not know if 2 is easy or hard, or out of how many.
- Home: changed the key to E minor. Start then landed on "Audio setup problem. Please reload the page." with a Retry button (`bari-09`). Going back home and setting the key to Random let Start work. I saw this once. It may be the test clock on this machine and not the key. Either way, the message gives no cause and no way back except the tab bar.
- Scan: did not know what STARS meant or whether he had to tick the boxes. Hovered "Hear the reference" and got nothing. Pressed it and heard four tones with no explanation.
- Scan: the 30-second ranked countdown is a 20 px circle beside the chip. The note that the count-in "starts by itself" appears only on the cover screen before it.
- Results: A, 96. Then he sees "Practice" and "Calibrate to earn XP on this device". He chose Ranked. Being told after the take feels like a trick.
- Results: no way to hear how the phrase should have gone. This is his point 9.
- History: the row reads "Voice (bass) · Level 2 · C major · random · 71 bpm". "random" should be "4/4".

### Adult returning clarinettist

- Calibration: tried it, got "0 of 10 heard" with clear choices. This is good behaviour (`clar-05`).
- Home: key greyed out, time greyed out. She assumes the build is unfinished. She found the chip only because I knew to look (`probe-02`).
- "Clarinet (B♭) · B♭: sounds a major 2nd lower": fine for her. Key options read "F major (concert E♭ major)": good.
- Scan: "Tuning note" with a mic icon. She assumed it would play an A. It listens instead. Nothing says so.
- Results: "Practice · Practice mode." The badge says the same thing twice. "Notes 97 focus": she reads "focus" as a separate stat.
- The excerpt was a song melody by Louise Reichardt. That is fine musically, but nothing tells her the corpus is mostly vocal and string lines, which explains its phrasing and slurs.
- Second excerpt: 3/4, after the home screen said there was not enough 3/4 music.

### Trumpet student, 12, on a phone

- Onboarding is readable at 390 px. The instrument cards fit in two columns.
- Home: the sticky Start bar covers the rows under it (`ph-light-03`, `ph-light-04`). Mode (Ranked or Practice) sits below Output, under the fold. He will never see it and will always play Ranked.
- Scan: STARS is collapsed into a bottom sheet labelled "Scan · 0 of 5". He does not know it opens. "Rotate for a bigger page" is a good hint.
- In one run, tapping "Start playing" timed out because something was over the button. The ranked timer then started the count-in by itself while he wasn't ready. The take was void: "We couldn't hear you, so this take wasn't graded" (`tpt-13`). I could not reproduce the blocked tap in a second run (`ph-light-07`), so treat it as intermittent.
- Take: Stop is a square icon with no label. The count-in dots are small. "Keep going: come in at bar 3" is a good, kind message.
- Void result: the whole score is red with every note circled. For a 12-year-old this reads as "you got everything wrong", when the truth is "we did not hear you". A void should show the clean score with one calm message, not a sea of red.
- Rank names (Section player, First call, Maestro) are motivating. The grid of ten cards is long on a phone, though, and "needs level 2" confuses him.

## Every unexplained term found

| Term | Where | Suggested plain version |
| --- | --- | --- |
| Level | Onboarding, home, scan, results, progress, history | Difficulty 2 of 10 |
| Ranked / Practice | Home Mode, scan chip, results badge | "Counts for XP" / "Just practice", with a one-line hint |
| Random (chip) | Key, Time, Tempo, Length, Level rows | Fold into each control as "Any" |
| Scan | Scan cover, "Start scan", "Scan · 0 of 5" | "Read through", "Start reading time" |
| STARS | Scan panel, Settings | "Before you play: 5 things to check" (keep STARS as the small heading) |
| Hear the reference | Scan, voice | "Play key and first note", with a visible explanation |
| Tuning note | Scan, winds, brass, strings | "Check my tuning", with "Hold any note" |
| focus | Results, under Notes | "Work on this" or drop it |
| Timing may be offset | Results badge | "Not calibrated: timing marks may be off by a little" |
| Drifted 24 ms ahead | Results | "You sped up slightly by the end" |
| Heat strip above bars | Results | A legend: "Red bars had slips" |
| Count-in only | Settings > Metronome | "Click during count-in only" |
| A4 reference | Settings | "Tuning pitch (A = 440 Hz)" |
| Show beta instruments | Onboarding, Settings | "Show more instruments (less tested)" |
| needs level 2 | Rank bar | "Reach difficulty 2 to unlock" |
| Not much music here yet | Home | Keep, but say what happens: "Some pieces may repeat" |

## Controls that did not respond, or looked as if they would not

- The key select, disabled behind the Random chip (clarinet, trumpet).
- The time segments, all disabled while Random is on, and 3/4 and 2/4 disabled with hover-only reasons.
- "Hear the reference" on hover: no tooltip exists.
- Tempo: the slider and number look live while Random is pressed. Their state is ambiguous.
- "Start playing" on the phone: one blocked tap (intermittent).
- "Retry" on "Audio setup problem": the text says reload, so it is not clear what Retry does.
- Onboarding tab bar: Practice, Progress and History can be clicked before setup is done.

## Accessibility notes

- Hover-only explanations (the time tooltips, and any planned "rollover" for reference) fail on touch and for keyboard users. Every explanation must be reachable by tap and by focus.
- Disabled segments use italic grey only. They need a text reason that screen readers announce without a hover.
- The phone Stop button needs a visible text label, not just its accessible name.
- The ranked auto-start countdown is announced only as a number. Add "Count-in starts in 10 seconds" at 10 and 5 seconds.
- Dark theme contrast is good on the screens I checked. The disabled Key select in dark mode (`clar-08`) is close to unreadable, which makes the "looks broken" problem worse.

## Priorities for the redesign

1. Setup controls: key, time and tempo get one "Any" option inside each control. Rename Level to Difficulty everywhere. Show Ranked or Practice before Start, with the reason.
2. Instrument choice: add baritone and mezzo, and draw the range staff on every card and next to the home select.
3. Sound: "Listen to this excerpt" on results; "Hear the tempo" and an opt-in "Listen first" (makes it practice) on scan; a real metronome click with previews.
4. Explain the reference: rename it, add a visible one-liner, and show what is playing.
5. Plain words for every term in the table above.
6. Phone: keep the sticky Start from covering rows, put Mode above the fold, label the STARS sheet, and make a void take look calm.
7. Error states: every error names a cause and offers a way back to home.
