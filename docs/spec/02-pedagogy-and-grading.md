# 02 Pedagogy, difficulty, grading, progression, and tips

Owner: lead musician and pedagogue. Readers: overseer, technical architect (01), score researcher (03), senior designer (04), senior iOS (05), and the implementers of the level tagger, `grade/`, `tips/`, the progression store, and the config files.

Revision 2 (review round). Every feature is marked **v1** or **later**. Sections 1 to 10 are v1 only. Everything later is in the "Later" annex at the end and must not be built in this build. The review log at the end lists what changed and why.

Conventions:

- Pitches use scientific pitch notation with MIDI numbers (C4 = 60, A4 = 440 Hz by default).
- **Key means the written key the player reads (R1).** Concert key is secondary text. Written = concert + `semis` for transposing instruments. All key gating in this section is by written key.
- "Beat" means the metronome beat: quarter in x/4, half in 2/2 and 3/2, eighth in 3/8, 5/8, 7/8, dotted quarter in 6/8, 9/8, 12/8.
- "IOI" is the inter-onset interval between neighbouring score notes.
- Every number below is a default stored in a versioned config file (section 10). Code never hard-codes them. Each graded attempt stores the config version it was graded with.
- This section owns grading, tolerances, XP, ranks, levels, and tips (R2). It does not own detection limits (01), the corpus pipeline (03), visual treatment (04), or platform gates (05). Where one of those values matters here, this section references it.

## 0. v1 scope at a glance

| Feature | Scope | Section |
| --- | --- | --- |
| 8 launch instruments (voice with 4 range presets, flute, B♭ clarinet, E♭ alto sax, B♭ trumpet, violin, cello from written E2, piano right hand single line) | v1 | 1 |
| 13 beta instruments behind "Show beta instruments", graded, universal tips only | v1 | 1.2 |
| 10-level ladder in `levels.json`, single key and single meter per excerpt (R8) | v1 | 2 |
| Stretch excerpts (rate 0.2) | v1 | 2.6 |
| Grading with three components: Pitch (P), Intonation (I), Rhythm (R) | v1 | 4 |
| One tolerance formula with family floors and IOI caps, read by follower, renderer and grader | v1 | 4.2 |
| Voice graded on relative pitch with a reference tone, octave-equivalent (R7) | v1 | 4.5 |
| Optional tuning note (winds, brass, strings) | v1 | 4.5 |
| Stop and restart handling; incomplete and void gates; S to F grades and stars | v1 | 4.6, 4.7 |
| Live verdicts including `correct-marginal`; ghost spelling rule (R11 default) | v1 | 4.8 |
| XP per player, rank per player, level per instrument (R5) | v1 | 5 |
| Ranked rules: never seen, strict scan (R6), measured calibration, skip limit | v1 | 5.2 |
| 16 tip patterns, universal tips, family tips for launch families | v1 | 6 |
| STARS scan routine | v1 | 7 |
| Practise without listening (no grade, no XP) (R13) | v1 | 5.2 |
| Voice range check, extended range, absolute-pitch toggle, streak freezes, remedial bias, drills, MIDI, haptic metronome, polyphony, swing, lyrics, key and meter changes, ornaments, listen-back, accounts, leaderboards | later | Later annex |

## 1. Instruments

### 1.1 Launch and beta instruments (v1)

v1 is monophonic. Families set tips; the onset class sets timing floors (4.2).

| Instrument id | Family | Onset class | v1 status | Testkit timbre (01 §11.2) | Why |
| --- | --- | --- | --- | --- | --- |
| `voice-soprano`, `voice-alto`, `voice-tenor`, `voice-bass` | `voice` | soft | launch | voice | Four range presets on one detector profile |
| `flute` | `flute` | hard | launch | flute | |
| `clarinet-bb` | `clarinet` | hard | launch | clarinet | |
| `sax-alto` | `sax` | hard | launch | sax | |
| `trumpet-bb` | `high-brass` | hard | launch | trumpet | |
| `violin` | `upper-strings` | soft | launch | violin | |
| `cello` | `low-strings` | soft | launch, clamped at written E2 | cello | C2 to D♯2 is below 80 Hz |
| `piano-rh` | `keyboard` | hard | launch | piano | Single line, treble clef |
| `sax-tenor` | `sax` | hard | beta | sax | Promotes first: same timbre, only transposition differs |
| `sax-bari` | `sax` | hard | beta | sax | Lowest fundamental 65 Hz |
| `oboe` | `double-reed` | hard | beta | none | No timbre |
| `bassoon` | `double-reed` | hard | beta | none | No timbre; 58 Hz |
| `horn-f` | `high-brass` | soft | beta | none | No timbre |
| `trombone` | `low-brass` | soft | beta | none | No timbre |
| `euphonium-bc`, `euphonium-tc` | `low-brass` | soft | beta | none | No timbre |
| `tuba` | `low-brass` | soft | beta | tuba | 37 Hz |
| `viola` | `upper-strings` | soft | beta | violin (family) | Promotes when the violin timbre passes over viola range |
| `double-bass` | `low-strings` | soft | beta | cello (family) | 41 Hz |
| `piano-lh` | `keyboard` | hard | beta | piano | Below 80 Hz from C2 down to E2 |
| `guitar` | `guitar` | hard | beta | none | No timbre |

Hard onset = tongued winds, brass with a hard attack, struck and plucked strings. Soft onset = voice, bowed strings, horn, low brass.

### 1.2 Launch criteria and beta behaviour (v1)

An instrument is `launch` only if all three automated checks pass. The check is a config change, never a human step.

1. A testkit timbre exists for its family (01 §11.2). A family timbre with the same onset profile counts (violin timbre over viola range).
2. 01's synthetic gates pass over the instrument's whole served band at every tier, under two conditions: click bleed at −20 dB, and the "phone mic" condition (2nd-order high-pass at 150 Hz, low-pass at 7 kHz, RT60 0.4 s, noise floor −45 dBFS). Gate values are 01's (§11.2): onset F1 ≥ 0.97 at ±30 ms, pitch-class accuracy ≥ 0.99, octave errors ≤ 0.5%, false extras ≤ 1 per attempt, judgment agreement ≥ 0.95. The phone-mic condition is the automated stand-in for real-device testing, which R3 moves to later.
3. The lowest sounding fundamental the instrument is ever served is ≥ 80 Hz.

Cello fails (3) below E2, so its bands are clamped at written E2 (MIDI 40) at every tier. Bass voice reaches E2 (82 Hz) at tier E and passes. If 01's P3 does not ship the sax or cello timbre, alto sax or cello becomes beta until it does.

Beta instruments in v1:

- Hidden behind "Show beta instruments" and labelled "beta".
- Graded, earn XP and level normally. All data is local with no leaderboard, so a misgrade affects only that player.
- Attempts carry `beta: true`.
- Tips come only from the universal set (6.3). Intonation patterns (E22, E23) are off.
- If the lowest served fundamental is under 80 Hz, the intonation weight moves to pitch (4.4).
- The per-take ranked gate (5.2) applies as for every instrument. There is no extra device gate.

### 1.3 Written range, clef, and transposition (v1 data)

`semis` = written pitch minus concert pitch (the ear-to-staff `js/theory.js` convention). Full written range is the outer bound ever served.

| Instrument id | Clef(s) | semis | Full written range (MIDI) | Sounding lowest |
| --- | --- | --- | --- | --- |
| `voice-soprano` | treble | 0 | A3–C6 (57–84) | 220 Hz |
| `voice-alto` | treble | 0 | E3–F5 (52–77) | 165 Hz |
| `voice-tenor` | treble-8vb | 12 | A3–A5 (57–81); sounds A2–A4 | 110 Hz |
| `voice-bass` | bass | 0 | E2–F4 (40–65) | 82 Hz |
| `flute` | treble | 0 | C4–C7 (60–96) | 262 Hz |
| `clarinet-bb` | treble | 2 | E3–G6 (52–91) | 147 Hz |
| `sax-alto` | treble | 9 | B♭3–F♯6 (58–90) | 139 Hz |
| `trumpet-bb` | treble | 2 | F♯3–C6 (54–84) | 165 Hz |
| `violin` | treble | 0 | G3–E7 (55–100) | 196 Hz |
| `cello` | bass; tenor from L7; treble from L9 | 0 | v1: E2–A5 (40–81). Data keeps C2 (36) for later | 82 Hz in v1 |
| `piano-rh` | treble | 0 | A2–C7 (45–96) | 110 Hz |
| beta: `oboe` | treble | 0 | B♭3–G6 (58–91) | 233 Hz |
| beta: `bassoon` | bass; tenor from L7 | 0 | B♭1–E5 (34–76) | 58 Hz |
| beta: `sax-tenor` | treble | 14 | B♭3–F♯6 (58–90) | 104 Hz |
| beta: `sax-bari` | treble | 21 | A3–F♯6 (57–90) | 65 Hz |
| beta: `horn-f` | treble; bass (new notation) from L7 | 7 | F♯2–C6 (42–84) | 87 Hz |
| beta: `trombone` | bass; tenor from L7 | 0 | E2–D5 (40–74) | 82 Hz |
| beta: `euphonium-bc` | bass; tenor from L8 | 0 | E2–C5 (40–72) | 82 Hz |
| beta: `euphonium-tc` | treble | 14 | F♯3–D6 (54–86) | 82 Hz |
| beta: `tuba` | bass | 0 | D1–F4 (26–65) | 37 Hz |
| beta: `viola` | alto; treble from L5 | 0 | C3–E6 (48–88) | 131 Hz |
| beta: `double-bass` | bass; tenor/treble from L9 | 12 | E2–D5 (40–74) | 41 Hz |
| beta: `piano-lh` | bass | 0 | v1: C2–C5 (36–72) (01: not detectable below C2) | 65 Hz |
| beta: `guitar` | treble-8vb | 12 | E3–B5 (52–83) | 82 Hz |

Voice: the player picks a voice type. The range check is later.

### 1.4 Range tiers by level (v1)

Tier A = L1–L2, B = L3–L4, C = L5–L6, D = L7–L8, E = L9–L10. Values are **written** MIDI. Every tier A and B band is at least 12 semitones (changed this round so that every L1–L2 excerpt, whose span is at most 12, fits every instrument in at least one key).

| Instrument | A (L1–2) | B (L3–4) | C (L5–6) | D (L7–8) | E (L9–10) |
| --- | --- | --- | --- | --- | --- |
| Soprano | D4–D5 (62–74) | C4–E5 (60–76) | C4–F5 (60–77) | B3–G5 (59–79) | A3–A5 (57–81) |
| Alto | A3–A4 (57–69) | G3–C5 (55–72) | F3–D5 (53–74) | F3–E5 (53–76) | E3–F5 (52–77) |
| Tenor (written) | D4–D5 (62–74) | C4–E5 (60–76) | C4–F5 (60–77) | B3–G5 (59–79) | A3–A5 (57–81) |
| Baritone/Bass | A2–A3 (45–57) | G2–C4 (43–60) | F2–D4 (41–62) | F2–E4 (41–64) | E2–F4 (40–65) |
| Flute | **F4–F5 (65–77)** | D4–G5 (62–79) | C4–C6 (60–84) | C4–G6 (60–91) | C4–C7 (60–96) |
| Clarinet | G3–B♭4 (55–70), below the break | E3–D5 (52–74) | E3–G5 (52–79) | E3–C6 (52–84) | E3–G6 (52–91) |
| Alto sax (all saxes) | **D4–D5 (62–74)** | C4–F5 (60–77) | B♭3–C6 (58–84) | B♭3–E6 (58–88) | B♭3–F♯6 (58–90); bari to A3 |
| Trumpet | C4–C5 (60–72) | B♭3–D5 (58–74) | G3–G5 (55–79) | F♯3–A5 (54–81) | F♯3–C6 (54–84) |
| Violin | D4–A5 (62–81) | G3–B5 (55–83) | G3–D6 (55–86) | G3–A6 (55–93) | G3–E7 (55–100) |
| Cello | G2–D4 (43–62) | **E2–D4 (40–62)** | **E2–A4 (40–69)** | **E2–D5 (40–74)** | **E2–A5 (40–81)** |
| Piano RH | **C4–C5 (60–72)** | **G3–D5 (55–74)** | G3–G5 (55–79) | C3–C6 (48–84) | A2–C7 (45–96) |
| beta: Oboe | **C4–C5 (60–72)** | C4–E5 (60–76) | B♭3–A5 (58–81) | B♭3–D6 (58–86) | B♭3–G6 (58–91) |
| beta: Bassoon | F2–C4 (41–60) | D2–D4 (38–62) | B♭1–G4 (34–67) | B♭1–C5 (34–72) | B♭1–E5 (34–76) |
| beta: Horn | G3–C5 (55–72) | F3–E5 (53–76) | C3–G5 (48–79) | G2–A5 (43–81) | F♯2–C6 (42–84) |
| beta: Trombone | B♭2–C4 (46–60) | F2–D4 (41–62) | E2–F4 (40–65) | E2–B♭4 (40–70) | E2–D5 (40–74) |
| beta: Euphonium (BC) | B♭2–C4 (46–60) | F2–E♭4 (41–63) | E2–F4 (40–65) | E2–B♭4 (40–70) | E2–C5 (40–72) |
| beta: Euphonium (TC) | C4–D5 (60–74) | G3–F5 (55–77) | F♯3–G5 (54–79) | F♯3–C6 (54–84) | F♯3–D6 (54–86) |
| beta: Tuba | B♭1–B♭2 (34–46) | F1–D3 (29–50) | F1–F3 (29–53) | D1–B♭3 (26–58) | D1–F4 (26–65) |
| beta: Viola | G3–D5 (55–74) | C3–E5 (48–76) | C3–G5 (48–79) | C3–C6 (48–84) | C3–E6 (48–88) |
| beta: Double bass (written) | **G2–G3 (43–55)** | E2–B3 (40–59) | E2–D4 (40–62) | E2–G4 (40–67) | E2–B4 (40–71) |
| beta: Piano LH | **C3–C4 (48–60)** | **G2–D4 (43–62)** | F2–F4 (41–65) | C2–C5 (36–72) | **C2–C5 (36–72)** |
| beta: Guitar (written) | G3–G4 (55–67) | E3–A4 (52–69) | E3–C5 (52–72) | E3–E5 (52–76) | E3–B5 (52–83) |

Bold = changed this round.

Rules:

- An excerpt fits if every written note, after whole-excerpt transposition, is inside the band. 03 §7.3 computes this in closed form.
- When several transpositions fit, prefer the one with the largest minimum margin to the band edges (a preference, not a rule).
- The tier band is the only range constraint. There is no separate ledger-line limit.
- If 03's level histogram shows that a launch instrument has fewer than 20 fitting excerpts in some written key allowed at L1 or L2, widen that instrument's tier A by 1 semitone at the top in config (open question 1).

## 2. Difficulty ladder (v1)

### 2.1 Principle

Difficulty is a vector of measurable, **intrinsic** features of the excerpt. Each feature has a per-level limit. An excerpt's level is the maximum level over its features. Intrinsic features are instrument-independent and computed once by the pipeline (03 §6.8): meter, rhythm cells, max interval and leaps, span, mode, chromatic notes, double accidentals.

Key, clef and range tier are **not** excerpt features. The selector sets them by transposition, so they never move an excerpt's level. They are request constraints in `levels.json`: the player's written key must be allowed at the level (row "Written key"), the clef comes from the instrument at that level, and the excerpt must fit the level's range tier.

Articulations above the level are removed (3.3), so articulation never raises a level.

### 2.2 Rhythm cell vocabulary

The tagger reduces each beat (or beat pair for two-beat cells) to a cell id.

| Cell id | Meaning | First level |
| --- | --- | --- |
| `W`, `H`, `Q`, `Wr`, `Hr`, `Qr`, `H.` | whole, half, quarter notes and rests, dotted half | 1 |
| `EE` | two eighths on a beat | 2 |
| `pickup1` | a single one-beat pickup note | 2 |
| `Q.E` | dotted quarter + eighth (simple meter) | 3 |
| `rE`, `Er` | eighth rest + eighth, eighth + eighth rest | 3 |
| `tieBar` | tie across a barline | 3 |
| `pickup` | any other anacrusis | 3 |
| `C.Q`, `C.QE`, `C.EQ`, `C.EEE`, `C.Qr.` | compound beat cells | 4 |
| `SSSS` | four sixteenths | 4 |
| `EQE` | eighth-quarter-eighth syncopation | 5 |
| `ESS`, `SSE` | eighth + two sixteenths, two sixteenths + eighth | 5 |
| `tieBeat` | tie across a beat inside the bar | 5 |
| `E.S` | dotted eighth + sixteenth | 6 |
| `T3E` | eighth-note triplet | 6 |
| `SES` | sixteenth-eighth-sixteenth | 6 |
| `C.E.SE`, `C.SSSSSS` | compound dotted figures, compound sixteenths | 6 |
| `S-sync` | syncopated sixteenths, sixteenth rests on the beat | 7 |
| `T3Q` | quarter-note triplet | 7 |
| `T` (32nd) | thirty-second notes | 8 |
| `T6S` | sextuplet sixteenths | 8 |
| `H..`, `Q..` | double-dotted values | 8 |
| `T5`, `T7` | quintuplets, septuplets | 9 |
| `hemiola`, `crossTie` | metric displacement across beats | 9 |
| any other | anything else (nested tuplets are excluded from the corpus) | 10 |

Grace notes, trills and other ornaments are never cells in v1: the pipeline removes them (03 §6.4).

### 2.3 Level table

"Leap" = interval of a 4th or larger. "Chromatic note" = pitch class outside the key signature (raised 6th and 7th in minor count as chromatic at L2 to L4 and as diatonic from L5). "Span" = highest minus lowest note in semitones. "Tonic-triad leap" = a leap whose two notes are both in the tonic triad.

| Feature | L1 | L2 | L3 | L4 | L5 | L6 | L7 | L8 | L9 | L10 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Meters | 4/4, 3/4, 2/4 | 4/4, 3/4, 2/4 | 4/4, 3/4, 2/4 | + 6/8, 2/2 | + 3/8, 3/2 | + 9/8, 12/8 | + 5/4, 5/8, 6/4 | + 7/8 | + 7/4, 11/8 | any single meter |
| Rhythm cells | L1 set | + `EE`, `pickup1` | + `Q.E`, `rE`, `Er`, `tieBar`, `pickup` | + compound cells, `SSSS` | + `EQE`, `ESS`, `SSE`, `tieBeat` | + `E.S`, `T3E`, `SES`, compound dotted | + `S-sync`, `T3Q` | + 32nds, `T6S`, double dots | + `T5`, `T7`, hemiola | all |
| Max interval, free | P4 | P5 | P5 | P8 | m7 (P8 allowed) | P8, any quality | M9 | P12 | any in range | any |
| Larger leaps allowed | tonic-triad leaps up to P8 | tonic-triad leaps up to P8 | leaps to P8 on tonic or dominant triad | - | - | - | - | - | - | - |
| Max leaps per 4 bars | 2 | 4 | 6 | 8 | 10 | 12 | no limit | no limit | no limit | no limit |
| Span (intrinsic) | ≤ 12 | ≤ 12 | ≤ 16 | ≤ 16 | band | band | band | band | band | band |
| Mode | major | + natural and harmonic minor | major, minor | major, minor | + melodic minor; dorian, mixolydian (random key only, R8) | + other church modes (random key only) | as L6 | as L6 | as L6 | as L6 |
| Chromatic notes per 4 bars | 0 | 0 (raised 7th in minor allowed) | 1 | 2 | 3 | 5 | 8 | 12 | no limit | no limit |
| Double sharps or flats | no | no | no | no | no | no | no | yes | yes | yes |
| Written key (request constraint): max accidentals | 1, major only | 1, + relative minors | 2 | 3 | 4 | 5 | 6 | 7 | 7 | 7 |
| Range tier (request constraint) | A | A | B | B | C | C | D | D | E | E |
| Tempo (bpm) | 60–76 | 60–84 | 66–92 | 66–100 | 72–112 | 72–120 | 80–132 | 80–144 | 88–160 | 92–176 |
| NPS cap (see 2.4) | 2.0 | 3.0 | 3.5 | 4.5 | 5.0 | 6.0 | 6.5 | 7.0 | 8.0 | 8.0 |
| Articulations shown | none | slurs, ties | + staccato, accent | + tenuto, hairpins, p mp mf f | + pp, ff, fp, sfz | as L5 | as L5 | as L5 | as L5 | as L5 |
| Clefs (request constraint) | primary | primary | primary | primary | + viola treble | as 1.3 | + tenor clef (cello, bassoon, trombone), horn bass clef | + euphonium tenor clef | + cello treble, bass tenor and treble | any of the instrument's clefs |
| Bars | 8 | 8 | 8–10 | 8–10 | 8–10 | 8–12 | 8–12 | 8–12 | 8–12 | 8–12 |
| Scan time, s (ranked = this value, R6) | 30 | 30 | 30 | 30 | 45 | 45 | 45 | 60 | 60 | 60 |
| Count-in bars | 2 | 2 | 2 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| Description (`levels.json`, ≤ 60 chars) | Steps and small leaps in quarters and halves | Adds eighths, minor keys and one-beat pickups | Dotted quarters, ties over the bar, 2 accidentals | 6/8 and 2/2, sixteenths, 3 sharps or flats | Syncopation, mixed sixteenths, 4 accidentals | Dotted eighths, triplets, 9/8 and 12/8 | Odd meters, quarter triplets, tenor clef | 32nds, sextuplets, double dots, 7 accidentals | Quintuplets, hemiola, wide leaps, fast tempos | Anything in range, free chromatic writing |

Count-in: 2 bars also at any tempo below 66 bpm. Compound meters at L4 to L5 count dotted-quarter beats with subdivision clicks.

L7 to L10 are defined only by single-key, single-meter features (rhythm cells, intervals, chromaticism, range, tempo, NPS, meter type, clef). There are no key changes, meter changes, ornaments, fermatas, tempo words or rit./accel. in v1 (R8).

### 2.4 Tempo, note density and breath (v1)

- **NPS cap** per level is the peak notes per second in any one-beat window at the chosen tempo. The effective cap is `min(levelCap, 1000 / pitchChangeFloorMs)`, where the floor comes from 01 per analysis window class (01 gives 70 ms for 512, 90 ms for 1024, 150 ms for 2048). For every launch instrument the level cap binds. For 2048-window beta instruments the cap is about 6.5.
- **Repeated notes**: tempo is also clipped so every same-pitch repeat IOI is at or above 01's repeat floor (01 gives 100 ms tongued or struck, 130 ms voice or bowed).
- The tempo for an excerpt is clipped so both limits hold. If the clipped tempo is below the level's minimum, the excerpt is not eligible at that level and tempo.
- Compound meters at L4 to L5 are counted in dotted-quarter beats at 40–66 bpm (the tagger converts). 3/8 at L5 is counted in eighths.
- **Breath rule** (winds, brass, voice): at L1–L4 the excerpt needs a rest or phrase end (a note of at least 1 beat followed by a new phrase) at least every 4 bars; at L5+ at least every 12 seconds at the chosen tempo. Failing excerpts are excluded for those families (03 flag `noBreath`), not re-levelled.

### 2.5 Excerpt tag record (input from 03)

03 owns the corpus schema. This is the subset grading and selection read. `key` is not a feature; `mode` is.

```json
{
  "excerptId": "schubert-d257-b1-8",
  "bars": 8,
  "meter": "2/4",
  "pickupBeats": 0,
  "concertKey": { "fifths": 1, "mode": "major" },
  "rhythmCells": ["Q", "EE", "H"],
  "maxIntervalSemis": 5,
  "tonicTriadLeapsOnly": true,
  "leapsPer4BarsMax": 2,
  "chromaticPer4BarsMax": 0,
  "doubleAccidentals": false,
  "spanSemis": 9,
  "peakNotesPerBeat": 2,
  "minIoiTicks": 240,
  "minRepeatIoiTicks": 480,
  "breathMaxGapBars": 4,
  "cadenceEnd": "PAC",
  "familiarity": 0,
  "modifications": ["rhythm-augmented-x2"],
  "dedupeGroup": "schubert-d257-phrase1",
  "featureLevels": { "meter": 1, "rhythm": 2, "interval": 2, "leaps": 1, "span": 1, "mode": 1, "chromatic": 1, "double": 1 },
  "baseLevel": 2
}
```

`familiarity`: v1 uses 0 (default) and 2 only. 2 = a widely recognisable tune, matched against 03's agent-written incipit list (`familiar.yaml`). Familiarity-2 excerpts are practice only (5.2). Familiarity 1 is later.

### 2.6 Selection rules (v1; 01 implements in the selector, 03 §7.3 does range fit)

For a request at level L on instrument X:

1. Candidates are excerpts with `baseLevel ≤ L` that fit X's tier band for L in the requested written key, in the requested meter, with an eligible tempo (2.4), and whose written key, clef and mode are allowed at L.
2. At most 20% of served excerpts come from `baseLevel = L − 1`. Excerpts at L − 2 or lower are never served as level L.
3. Stretch excerpts (exactly one feature at L + 1, all others ≤ L) are served at `stretchRate = 0.2` and graded and credited as level L. If fewer than 10 unseen eligible excerpts remain at L for this player, `stretchRate` rises to 0.5.
4. Ranked requests hard-exclude every `dedupeGroup` this player has seen on any instrument (5.3). If nothing is left, the UI offers practice or relaxing the settings. 01's "freshness weight" is replaced by this exclusion.
5. Modal excerpts are served only when the key setting is random (R8). Familiarity-2 excerpts only in practice.
6. Random key preferences: choose uniformly from keys allowed at L, then weight by idiom: strings weight sharp written keys ×1.5; concert B♭, E♭ and F instruments weight written keys with at most 2 accidentals ×1.5 at L1–L4. Never the same written key more than 2 times in a row.

## 3. Excerpt quality and cutting rules (v1; 03 implements)

### 3.1 What makes a good sight-reading excerpt

1. A complete musical thought: starts at a phrase beginning, ends on a cadence.
2. A clear pulse and a clear tonal centre at L1–L6.
3. It rewards reading ahead: chunkable patterns plus at least one event (a leap, an accidental, a rhythm change) worth spotting in the scan.
4. Idiomatic for a single line: no implied second voice, no keyboard-chord arpeggiation (exclude for winds at L1–L6 if more than 25% of intervals are leaps; 03 flag `leapy`).
5. Not trivially repetitive: no bar repeated literally more than twice in a row; at least 5 distinct pitch classes at L3+ (3 at L1, 4 at L2); at least 2 distinct rhythm cells at L2+.
6. Rests total ≤ 25% of the duration; no rest of a bar or longer.
7. Not famous (familiarity < 2) for ranked play.

v1 sources are 03's (OpenScore Lieder voice lines, OpenScore String Quartets all four parts, and the verified Mutopia PD and CC BY 4.0 single-line subset), all fetched from GitHub with per-file licence checks (R4). Method books, etudes and hymnals in our own encoding are later.

Requests to 03 for low levels:

- Quartet inner parts (violin II, viola, cello) are admitted at L1–L2 with the melodic-interest threshold lowered from 0.35 to 0.25, at those levels only. Stepwise half- and quarter-note inner lines are real ensemble reading.
- The pedagogical minimum for a comfortable level is about 60 unseen excerpts per level per launch instrument: level-up needs 5 ranked attempts and a beginner spends about 20 to 40 attempts per level. 03's G1 floors govern the build. If L1 ends below 60, L1 ships with what exists, placement already starts at L2, and L1 is mostly practice in new keys.
- No algorithmically composed melodies in v1. They would break the real-music premise (04 §1).

### 3.2 Cutting rules for 8 to 12 bars

Hard rules:

- H1. Start at a phrase start: bar 1 of a piece or section, or the first note after a rest of at least 1 beat, a double bar, or a cadence. A pickup is included and counted as bar 0.
- H2. End on a cadence: the last note falls on a strong beat (beat 1, beat 3 in 4/4, beat 4 in 6/8) and is at least 1 beat long or followed by a rest. L1–L2: scale degree 1 or 3. L3+: also a half cadence (degree 5 or 2) if the note is at least 2 beats long and followed by a rest.
- H3. 8 to 12 full bars plus pickup. Prefer 8 at L1–L5.
- H4. No cut inside a tie, slur, tuplet or beam group.
- H5. No cut inside a sequence.
- H6. An incomplete source final bar balancing a pickup is kept as written.
- H7. One key signature and one meter per excerpt (R8; matches 03's H10).

Soft rules (0 to 1 each; keep windows with mean ≥ 0.6): S1 phrase symmetry, S2 single climax not in bar 1, S3 first and last note in the tonic triad, S4 at least 3 rhythm cells (L1: 2), S5 a level-defining event in bars 3 to 7.

### 3.3 Allowed transformations

- Transposition to any key allowed by the level and the request, plus whole-octave displacement of the entire excerpt. Never displace part of an excerpt.
- **Rhythmic augmentation ×2** at build time, only where the meter survives:
  - a complete 4-bar phrase in 2/4 or 4/4 becomes 8 bars in the same meter;
  - 8 bars of 2/4 become 8 bars of 4/4 (old beat 2 becomes beat 3);
  - 8 bars of 3/8 become 8 bars of 3/4.
  Never into 2/2, 3/2 or 6/4, and never from 3/4 or 6/8. The output must be 8 to 12 bars. Original and variant share `dedupeGroup` and the variant is disclosed as "note values doubled". The variant is re-tagged.
- Removal of ornaments (trills, grace notes, turns) and of a fermata on the last note. The principal note stays.
- Removal of dynamics and articulations above the level's "Articulations shown" row.
- Lyrics are stripped (R8).
- Enharmonic re-spelling when transposition creates double accidentals below L8 or more than 7 accidentals.
- No other note changes. If an excerpt only fits after changing notes, it does not fit.

## 4. Grading (v1)

### 4.1 Inputs and alignment

- Inputs: expected notes (01 `ExpectedNote`, including `onsetKind` and IOIs) and detected notes (01 `DetectedNote`, including `stableMedianCents`, `steadyMs`, clarity). Everything is compared in concert pitch.
- The follower is anchored to the click and never waits. 01 implements the live matcher and the final banded alignment; the final alignment is authoritative for grading.
- **Match window** `W_i = max(tBad_i, min(max(250 ms, 0.5 beat), 0.5 × min(IOI_prev, IOI_next)))`. This value in `grading-config.json` replaces 01's own `W(e)`. A score note not matched by expected onset + `W_i` is missed.
- Tied notes are one score note.
- Unmatched played events of at least 100 ms that are not release tails (01) are extras. Events in a `displaced` segment (01's restart detector, 4.6) are not extras.

### 4.2 Tolerances: one formula for follower, renderer and grader

`grading-config.json` holds one tolerance table. The follower, the renderer and the grader all call the same pure resolver (`grade/resolve-tolerance.ts`, imported by `follow/`), so the live and final verdicts cannot disagree on thresholds. 01's table in §6.3, its 35 ms floor, and `intonationBonusCents` are withdrawn.

**Timing.** For X in {good, red, bad}, per score note:

```
t_X = max(levelAbs_X, frac_X × beatMs)       // level band value
t_X = min(t_X, cap_X × minIOI)              // IOI cap: good 0.3, red 0.4, bad 0.5
t_X = max(t_X, familyFloor_X)               // the family floor always wins
```

`minIOI` is the smaller neighbouring IOI of the note (the IOI cap is skipped if the note has no neighbour).

| Levels | good: abs / frac | red: abs / frac | bad: abs / frac |
| --- | --- | --- | --- |
| L1–L3 | 60 ms / 0.12 beat | 100 ms / 0.20 beat | 150 ms / 0.30 beat |
| L4–L6 | 50 ms / 0.10 beat | 85 ms / 0.17 beat | 120 ms / 0.25 beat |
| L7–L10 | 40 ms / 0.08 beat | 70 ms / 0.14 beat | 100 ms / 0.20 beat |

| Onset class (1.1) | floor good / red / bad |
| --- | --- |
| hard (flute, clarinet, sax, trumpet, piano, oboe, bassoon, guitar) | 40 / 60 / 90 ms |
| soft (voice, violin, cello, viola, double bass, horn, low brass) | 55 / 85 / 120 ms |

There is no keyboard "−10 ms" adjustment.

**Why these floors.** Perfect playing must rarely lose credit or turn red, which matters because R11 shows red marks live. The rule is `floor_good ≥ 2σ` and `floor_red ≥ 3σ`, where σ is 01's onset error (1σ, root-sum-square of detector, calibration and clock) on the worst supported path, a phone with play-along calibration (01 Q2): articulated 14 ms, slurred 16.6 ms, voice 25 ms. That needs articulated 28/42, slurred 33/50, voice 50/75. Hard floors 40/60 and soft floors 55/85 meet every case with margin, including slurred notes on hard-onset instruments. CI asserts the rule against σ as measured by 01's synthetic suite (published as a CI artifact). If 01 measures a larger σ, the floors widen in config, never in code. 04's proposed 50/80 everywhere is not needed for hard onsets by 01's budget.

**Worked examples** (table-driven unit test, values in ms: tGood / tRed / tBad, W):

| Case | beat | min IOI | Result | W |
| --- | --- | --- | --- | --- |
| Trumpet L1, 60 bpm, quarters | 1000 | 1000 | 120 / 200 / 300 | 500 |
| Trumpet L1, 132 bpm (formula check; outside L1 tempo) | 454.5 | 454.5 | 60 / 100 / 150 | 227 |
| Trumpet L5, 60 bpm (formula check), quarters | 1000 | 1000 | 100 / 170 / 250 | 500 |
| Trumpet L5, 60 bpm, sixteenths | 1000 | 250 | 75 / 100 / 125 | 125 |
| Trumpet L5, 132 bpm, quarters | 454.5 | 454.5 | 50 / 85 / 120 | 227 |
| Trumpet L5, 132 bpm, eighths | 454.5 | 227 | 50 / 85 / 114 | 114 |
| Trumpet L9, 60 bpm, quarters | 1000 | 1000 | 80 / 140 / 200 | 500 |
| Trumpet L9, 60 bpm, sixteenths | 1000 | 250 | 75 / 100 / 125 | 125 |
| Trumpet L9, 60 bpm, 32nds | 1000 | 125 | 40 / 60 / 90 (floor) | 90 |
| Trumpet L9, 132 bpm, quarters or eighths | 454.5 | ≥ 227 | 40 / 70 / 100 | ≥ 114 |
| Trumpet L9, 132 bpm, triplet eighths | 454.5 | 152 | 40 / 61 / 90 (floor) | 90 |
| Violin or voice L9, 132 bpm, quarters | 454.5 | 454.5 | 55 / 85 / 120 | 227 |

Four sixteenths at 132 bpm are 8.8 notes per second, above the L9 cap, so they are never served. At slow tempos the beat term dominates and hard and soft onsets come out the same.

**Intonation** (cents, good / red):

| Family | L1–L3 | L4–L6 | L7–L10 |
| --- | --- | --- | --- |
| `voice` (relative, 4.5) | 30 / 45 | 25 / 40 | 20 / 35 |
| winds, brass, strings | 25 / 40 | 20 / 35 | **20 / 35** (was 15 / 30) |
| `keyboard`, `guitar` | not graded | not graded | not graded |

Rule: `good ≥ 2 × c90` and `red ≥ 3 × c90 + 5`, with c90 = 10 cents (01's real-audio budget). CI asserts it against 01's measured c90.

**Minimum steady pitch** (`intonationMinSteadyMs`, values from 01 Q2):

- Non-vibrato families (winds, brass): 150 ms of steady pitch.
- Vibrato families (voice, strings): 180 ms. Between 180 and 360 ms the bands widen to at least 20 / 35.
- Below the minimum, the note gets no intonation grade and no sharp or flat state. The semitone is still graded.
- `|dev| > 50` cents means the nearest semitone is a different note: a wrong pitch, not an intonation error.

**Calibration and measurement quality.** Timing is only trustworthy with a measured latency. Attempts calibrated with 01's `reported` method, or failing 05's per-take measurement gate, are graded and shown but unranked (5.2).

### 4.3 Per-note credits

For each score note i (equal weight per note):

**Pitch credit p_i**
- Nearest played semitone equals the target: 1.
- Voice: an octave displacement (target ± 12, after the reference offset) also earns 1. It is recorded as `octaveDisplaced: true`, is not an error state, fires no pattern, and is shown at most as neutral information in review (04 decides the look).
- Other families: an octave error is a wrong pitch (0), judged after 01's score-informed octave correction (01 §5.4).
- Anything else, or missed: 0.
- The pitch of a played event is 01's `stableMedianCents` over the steady portion (01 excludes the attack per family).

**Intonation credit n_i** (only if p_i = 1, the note reaches `intonationMinSteadyMs`, and the family is not fixed pitch)
- dev = median cents from target after the tuning offset (instruments) or reference offset (voice).
- `n_i = 1` if |dev| ≤ good; linear to 0 at red; 0 beyond.

**Onset credit o_i** (if matched, regardless of pitch: a wrong note in time earns rhythm credit)
- Δ = played onset − expected onset.
- `o_i = 1` if |Δ| ≤ tGood; linear to 0 at tBad; 0 beyond or missed.

**Duration credit d_i** (only notes of at least 1 beat, not staccato, not at a phrase end before a rest; never for `keyboard` and `guitar`)
- h = played duration / written duration.
- `d_i = 1` if h ≥ 0.70; linear to 0 at h = 0.35. Notes before a rest count as fully held if h ≥ 0.55.

Replayed (displaced) notes earn no credit anywhere; the current notes they cover are missed.

### 4.4 Components and weights

Tempo stability and continuity are **not** separate components. With a click running, drift and jitter already lose onset credit in R, and a stop is a run of missed notes already counted in P and R. Counting them again would double or triple count. They remain as unweighted diagnostics (4.6).

- **Pitch P** = 100 × Σp_i / (N + 0.5 × extras).
- **Intonation I** = 100 × mean n_i over intonation-graded notes. If fewer than 3 notes qualify, I is "not enough notes to judge" and its weight moves to P for that attempt.
- **Rhythm R** = 100 × (0.8 × mean o_i + 0.2 × mean d_i over duration-graded notes). If no duration-graded notes, R = 100 × mean o_i.

| Family | Levels | P | I | R |
| --- | --- | --- | --- | --- |
| continuous pitch | L1–L3 | 0.55 | 0.05 | 0.40 |
| continuous pitch | L4–L6 | 0.50 | 0.10 | 0.40 |
| continuous pitch | L7–L10 | 0.45 | 0.15 | 0.40 |
| `keyboard`, `guitar` | all | 0.55 | 0 | 0.45 |

Beta instruments whose lowest served fundamental is under 80 Hz use I = 0 and add its weight to P.

Score = round(w_P × P + w_I × I + w_R × R), 0 to 100. The score is never modified by settings; only XP is.

### 4.5 Family rules

- **Fixed pitch (piano, guitar)**: no intonation, no duration credit. A wrong note is a wrong key or fret.
- **Voice (R7)**: graded on relative pitch, octave-equivalent.
  - Before the count-in the app plays the tonic triad and then the starting note, sounding in the singer's octave, through the same output path as the clicks. This is mandatory for voice in every mode.
  - A drift reference tracks the singer: offset = median dev of the last 4 correctly pitched notes, limited to ±50 cents from 0 and to a change of at most 15 cents per note. It is a pure function in `grade/` that `follow/` calls per note, so live and final use the same offset.
  - Pitch and intonation are judged against the nearest-octave target plus the offset.
  - Total drift above 40 cents fires E23 and is not otherwise penalised.
- **Winds, brass, strings**: absolute pitch relative to A4 (440 default, 415 to 446 setting) plus a tuning offset. The scan offers an optional 3 s tuning note (concert B♭ for winds and brass, A for strings). If used, offset = measured deviation, capped at ±25 cents. If not, offset = 0, and E22 may fire.
- **Brass (trumpet)**: a wrong partial (same valve combination, adjacent harmonic, not an octave) is a wrong pitch, classified as E16 for tips. Needs the trumpet valve table (data, 10).
- **Clarinet**: notes crossing written B♭4/B4 (70/71) are tracked for E31.

### 4.6 Stops, restarts and end of take

- **Stop**: a silence of at least max(1 beat, 600 ms), not covered by written rests, containing at least one missed note. It costs only the missed notes in P and R. Every note whose window passes in silence becomes missed live (hollow red notehead, R11).
- **Hint**: after at least 1 bar of silence not covered by rests, the status line shows "Keep going: come in at bar N" (N = the next downbeat at least 1 beat ahead). No modal.
- **Restart or skip ahead**: 01's displacement detector marks a run of unmatched notes that match earlier (or later) score notes at a constant beat shift as one `displaced` segment (01 owns the run length and matching rule). Replayed notes are drawn live as ghosts (R11), are excluded from the extras term in P, and earn no credit. Results group them as one event ("Restarted at bar 4, 6 notes replayed"). If the replay continues, the matched share falls under 50% and the incomplete gate applies.
- Skipping a bar and coming in on time at the next one costs only the skipped notes. That is the recovery we teach (E6, tip U06).
- **End of take**: the last expected note + 1 bar, or Stop. Silence never ends a take mid-excerpt. The only exception is the void rule: no voiced frames for 5 s after the count-in.
- **Diagnostics** (computed, never weighted, shown as text lines on results): stops with bar and length ("Stops: 1 (bar 5, 2 beats)"), drift from the least-squares slope of Δ against bar position ("Drifted 60 ms behind by the end", from slope × bars × beat), and restart events. They drive E1, E2 and E6.

### 4.7 Gates, total and grade

- **Incomplete**: matched notes (excluding displaced) / N < 0.5. Score is min(score, 50), no XP. A ranked incomplete attempt still enters the level window at its capped score, so stopping bad takes does not help.
- **Void**: 01's signal-quality flag (no voiced frames for 5 s after the count-in, clipping, interruption, device change, capture backlog per 05). No grade, no XP, not in the level window. A void after the first played note still burns the excerpt for ranked play.

| Score | Grade | Stars | Meaning |
| --- | --- | --- | --- |
| 97–100 | S | 3 + shine | performance-ready |
| 90–96 | A | 3 | excellent read |
| 80–89 | B | 2 | solid, minor slips |
| 70–79 | C | 1 | pass |
| 60–69 | D | 0 | rough, keep at this level |
| 0–59 | F | 0 | too hard right now |

Pass = C or better. Cutoffs are the same at every level.

### 4.8 Live verdicts (R11 default)

Each score note has a live state, using the same resolved thresholds as grading.

| State | Rule | Staff behaviour (04 styles) |
| --- | --- | --- |
| `pending` | not yet reached | normal |
| `correct` | p = 1, \|Δ\| ≤ tGood, \|dev\| ≤ good (or not intonation-graded) | confirmed, quiet |
| `correct-marginal` | p = 1, \|Δ\| ≤ tRed and \|dev\| ≤ red, but beyond good on one of them | shown as correct live, never red; nuance in review only |
| `early` / `late` | matched, \|Δ\| > tRed | original red; ghost at the played onset and pitch |
| `sharp` / `flat` | p = 1, intonation-graded, \|dev\| > red | original red; ghost at the same staff position with a ▲ or ▼ mark; cents numbers in review only |
| `wrong-pitch` | matched, p = 0 | original red; ghost at the played pitch, spelled per the rule below |
| `missed` | no match by expected onset + W_i | original red, hollow, no ghost |
| `extra` | unmatched played event, not displaced | ghost only |
| replayed | event in a displaced segment | ghost only, neutral; current notes still go missed |

- States combine (late + wrong pitch: one ghost, both flags).
- A note between tRed and tBad is red but earns partial onset credit; review explains "Late (partial credit)".
- Timing verdicts are final at onset.
- Live sharp or flat: emitted only for notes whose expected steady duration reaches `intonationMinSteadyMs`, after 80 ms of steady pitch, and only if |dev| > red + 10 cents (hysteresis, 01 Q4). The note may return to correct if the player corrects within the note. The final verdict uses the full steady median.
- Wrong pitch live: 01 emits it at confirmation when the confirming frames agree and sit at least 80 cents from the target; otherwise after the steady window.
- Voice octave displacement is `correct`.
- 04 may add quieter modes as options ("After the take"); the default may not be weakened (R11).

**Ghost spelling** (shows the reading mistake):
- Played pitch within ±2 semitones of the target: spell with the **target's letter** plus the needed accidental (target F♯, played F: F♮; target B♭, played B: B♮).
- Otherwise spell by the written key signature (sharps in sharp keys, flats in flat keys).

### 4.9 Grading acceptance tests

Synthetic event-list fixtures (`fixtures/grade/*.json`, no audio), each with assertion predicates rather than hand-computed totals:

1. Perfect performance at any level: P = I = R = 100, score 100, grade S, only E30 fires.
2. All onsets 30 ms late at L1, 80 bpm: R = 100.
3. All onsets late by exactly tBad, durations held, excerpt with duration-graded notes: R = 20, every note `late`.
4. Linear drift of +0.05 beat per bar over 8 bars at L4, 80 bpm (300 ms behind at the end, inside W): R ≤ 60, drift diagnostic reports "behind", E2 fires. A larger drift (for example 0.15 beat per bar) pushes later notes past W, so they are missed rather than late; the fixture asserts that too.
5. Every F♯ (key signature, D major) played as F♮: P drops by the share of F♯ notes, ghosts spelled F♮, E12 fires.
6. A 2-beat silence in bar 5 not covered by rests: 1 stop reported, E6 fires, P and R drop only by the missed-note share.
7. Voice uniformly 30 cents flat, drift compensation on, 40-note excerpt at L7: I ≥ 90.
8. Voice singing every note an octave low: P = 100, no red states, no pattern except E30 (if score ≥ 90).
9. Trumpet playing written G5 instead of written C6 twice (same open fingering): wrong pitch twice, E16 fires.
10. Fewer than half the notes matched: score ≤ 50, `gate: incomplete`, XP 0.
11. Restart: player replays bars 3–4 after bar 4 (6 notes): one displaced segment, extras term unchanged by the replay, the covered current notes missed.
12. Tolerance worked examples (4.2) reproduced exactly by `resolveTolerance`.
13. A note with 140 ms of steady pitch on flute: no intonation grade, no sharp or flat state.
14. A `reported`-calibration attempt: graded, `ranked: false`, reason `calibration`.
15. Same fixtures give byte-identical results in Vitest and the bare-runtime job (05).
16. CI floor check: hard and soft timing floors ≥ 2σ / 3σ and intonation good/red ≥ 2 × c90 / 3 × c90 + 5, using 01's published σ and c90.

## 5. Progression (v1)

Rank and XP are per player. Level is per instrument (R5). v1 has one local player per device; the data model is still per player.

### 5.1 Placement

- New instrument: offer a 3-excerpt placement or a direct level choice. Placement starts at L2; next excerpt L+2 if score ≥ 85, L−1 if < 60, same otherwise; final level = highest level with score ≥ 75, minimum L1.
- Placement attempts follow the normal ranked rules and earn XP, and they do not enter the level window.

### 5.2 Ranked and practice attempts

An attempt is **ranked** only if all of these hold. Each failing condition has a `rankedReason` enum value (04 owns the copy).

| Condition | `rankedReason` when it fails |
| --- | --- |
| The player chose Ranked mode | `practice-mode` |
| This player has never revealed this `dedupeGroup` on any instrument | `seen-before` |
| Scan used the strict level default (R6); 04 auto-starts the count-in at 0 | `scan-extended` |
| Tempo ≥ 90% of the level's minimum tempo | `tempo-below-90pct` |
| Metronome mode audible or count-in only | `visual-metronome` (visual-only mode is later) |
| Calibration measured for the current route: loopback, or play-along (01) | `calibration` |
| 05's per-take measurement gate passes: loopback MAD ≤ 3 ms or play-along MAD ≤ 15 ms, RTL ≤ 120 ms (so Bluetooth is unranked), count-in RTL recheck within ±10 ms, no capture gaps, no input processing reported on (05 Q2 (a) to (g)) | `measurement` |
| Familiarity < 2 | `familiar` |
| Not a replacement served after the post-reveal skip limit (5.3) | `skip-limit` |

Everything else is practice: graded and shown, earns practice XP (5.4), does not count for level rules.

**Practise without listening** (R13): the music and scan routine run with no mic; no grade, no XP, not in any window. It still reveals the excerpt, so it marks it seen.

### 5.3 Seen, skip and stop rules

- An excerpt is marked seen when it is revealed (scan start), per player, by `dedupeGroup`, across all instruments. Augmented variants and the same melody on another instrument count.
- Skip before reveal is free.
- Skip after reveal burns the excerpt. One post-reveal skip is allowed per 5 ranked attempts (no other post-reveal skip within the last 5 ranked attempts); beyond that the replacement is practice (`skip-limit`).
- Stop in a ranked take before the first detected note: re-runs the count-in once, still ranked. A second Stop before the first note voids the take (excerpt burned).
- Stop in a ranked take after the first note: the take is graded with the remaining notes missed (usually incomplete) and enters the level window at its score. 04's confirm copy says the take will be scored as it stands.
- Stop in practice: not graded.
- An interruption void (screen lock, call, device change) burns the excerpt and stays out of the level window.

### 5.4 XP

XP = round(base(L) × q(S) × m_tempo × m_random × m_mode × m_streak × m_daily × m_below) for ranked attempts.

- base(L) = 6 × L + 4 (L1 = 10, L5 = 34, L10 = 64), L = served level.
- q(S) = 0 if S < 30, else S / 100.
- m_tempo = clamp(tempo / level mid tempo, 0.75, 1.30); mid tempo = midpoint of the level's range.
- m_random = 1 + 0.08 for each of key, meter, tempo set to random; cap 1.25. Random level and random length add nothing.
- m_mode = 1.00 metronome; 1.10 count-in only, from L4. It depends only on the metronome mode.
- m_streak = 1 + 0.02 × min(streakDays, 10). A streak day is a local calendar day with at least 3 ranked attempts on any instrument. Missing a day breaks the streak. No freezes in v1.
- m_daily = 1.0 for the first 60 ranked attempts per player per local day, then 0.25.
- m_below = 0.25 when the served level ≤ the player's current level on that instrument − 2, else 1.

Practice XP:
- A practice attempt earns 25% of the formula above.
- A repeat of an excerpt earns 25% the first time that excerpt is repeated on a given day and 0 after that.
- Practice attempts count toward the daily cap.
- Incomplete, void and practise-without-listening attempts earn 0.

Worked example (for 04 and the tests): L5, S = 85, tempo at mid, random key, streak 6 days: 34 × 0.85 × 1.08 × 1.12 = 34.96 → 35 XP. The same L5 player farming L1 at S = 100 earns 10 × 1.0 × 0.25 = 2.5 → 3 XP, so farming never pays. `grade/` returns the factor list; the UI shows every factor that is not 1.00.

### 5.5 Rank (per player)

Rank needs both XP and a minimum current level on at least one instrument (beta included).

| Rank | Name | XP | Min level |
| --- | --- | --- | --- |
| 1 | Novice | 0 | 1 |
| 2 | Apprentice | 300 | 2 |
| 3 | Student | 1,000 | 3 |
| 4 | Section player | 2,500 | 4 |
| 5 | Ensemble player | 5,000 | 5 |
| 6 | Principal | 9,000 | 6 |
| 7 | Soloist | 15,000 | 7 |
| 8 | Session player | 24,000 | 8 |
| 9 | First call | 36,000 | 9 |
| 10 | Maestro | 52,000 | 10 |

Rank never goes down; XP never decreases. Pacing: an L5 player averaging S = 85 with no bonuses earns about 29 XP per attempt; at 12 attempts a day, Section player to Ensemble player takes about 7 to 8 days.

### 5.6 Level up and down (per instrument)

The level window is the last 5 ranked attempts at the current level on that instrument (incomplete ranked attempts included at their capped score; void excluded; stretch excerpts count as L).

- **Level-up offer**: at least 4 of the 5 scored ≥ 85, the mean is ≥ 85, and at least 2 of the 5 were played at or above the level's mid tempo. Declining suppresses the offer for 5 ranked attempts.
- **Auto level-up**: 8 consecutive ranked attempts ≥ 90 at L, at least 2 of them at or above mid tempo. Results offer Undo.
- **Level-down suggestion**: mean < 60, or 3 or more below 55. Never automatic.
- Manual change is always allowed and resets the window.

### 5.7 Stored progress shape

```json
{
  "playerId": "local-uuid",
  "xp": 4210,
  "rank": 4,
  "streak": { "days": 6, "lastDay": "2026-11-18" },
  "daily": { "day": "2026-11-18", "rankedCount": 14, "repeats": { "schubert-d257-b1-8": 1 } },
  "seenGroups": ["schubert-d257-phrase1"],
  "postRevealSkips": { "lastSkipRankedIndex": 137 },
  "rankedIndex": 141,
  "instruments": {
    "trumpet-bb": {
      "level": 5,
      "window": [ { "score": 88, "atMidTempo": true }, { "score": 91, "atMidTempo": false } ],
      "offerSuppressedUntil": null,
      "attemptsRanked": 142,
      "bestByLevel": { "4": 98, "5": 91 },
      "patternCounts": { "E12": 9, "E16": 14, "E1": 4 },
      "recentPrimaryPatterns": ["E16", "E12", "E16", "E30", "E1"],
      "tuningOffsetCents": -8
    }
  },
  "recentTips": ["U12", "HB01", "U02"],
  "configVersion": "grading-2.0.0"
}
```

No Elo rating and no per-verdict EWMAs: 01's §4.6 rating model is withdrawn (R2).

## 6. Tips (v1)

### 6.1 Flow and evidence rules

1. After grading, the detector evaluates the v1 patterns (6.2) on the final judgments.
2. Each firing pattern gets `lostPoints` = Σ over its notes of component weight × (1 − credit) × 100 / N, for the components the pattern concerns.
3. Global rules for every v1 pattern:
   - No tips from void attempts. Incomplete attempts may fire only E6, plus an encouragement card.
   - Signal quality: median clarity of matched notes ≥ 0.9 and clipping ≤ 2% of frames (01 supplies both); otherwise only E30 or nothing.
   - Timing patterns use offsets relative to the attempt's own median Δ, never absolute means, so calibration error cannot cause a false tip. Without a measured calibration, timing patterns are off.
   - Evidence must span at least 2 bars, except E6, E28 and E29.
   - Beta instruments: universal tips only; E22 and E23 off.
4. Choice: the primary tip is the highest-lostPoints pattern with lostPoints ≥ 3; a secondary tip needs ≥ 5. At most 2 tips. Show U18 (positive) if only E30 fires.
5. Prefer the family tip over the universal tip. A family tip with `assertsCause: true` (it names a physical cause: embouchure, bow, breath, fingering) is used only if that pattern was primary in at least 2 of the last 5 attempts on that instrument; otherwise the universal tip is shown.
6. Skip a tip shown in the last 3 tips for this player; take the next variant or pattern.
7. Every tip shows an evidence line with bar numbers. Default template `"Seen in bars {bars}."`; a pattern may carry its own template in `tips.json`.
8. Session summary (after "Done for now" or every 10 attempts): top 3 patterns of the session with their tips. If one pattern was primary in 3 of the last 5 attempts, the summary shows a text-only focus card.

`tips.json` records:

```json
{ "id": "HB01", "family": "high-brass", "instruments": ["trumpet-bb"], "pattern": "E16",
  "assertsCause": false, "minLevel": 1, "maxLevel": 10, "enabled": true, "text": "..." }
```

Pattern records carry `{ "id", "name" (≤ 40 chars), "dimension": "notes" | "in-tune" | "rhythm" | "flow", "enabled", "evidenceTemplate"?, thresholds }`.

### 6.2 v1 patterns (16, most precise first)

| Id | Name (≤ 40 chars) | Dimension | Detection rule | Minimum evidence |
| --- | --- | --- | --- | --- |
| E30 | Clean read | - | score ≥ 90 and no other pattern fired | - |
| E6 | Stopped or restarted | flow | a stop (4.6) or a displaced segment | 1 stop or restart |
| E12 | Missed key-signature notes | notes | wrong pitch where played = target with the key-signature accidental removed (or applied where not written); played semitone clear (within 30 cents) | ≥ 2 notes in ≥ 2 bars and ≥ 30% of the key-signature-altered notes |
| E13 | Missed written accidentals | notes | wrong pitch where played = target without its written accidental; same clarity rule | ≥ 2 notes |
| E22 | Out of tune overall | in-tune | median dev over notes with ≥ 150 ms steady pitch, \|median\| ≥ 20 cents, no tuning note this session; not voice | ≥ 8 notes |
| E23 | Pitch drifted (voice) | in-tune | \|final reference offset\| ≥ 40 cents, same sign as the offset at one third of the excerpt | ≥ 8 notes |
| E1 | Rushed ahead of the click | rhythm | slope b of relative Δ against bar ≤ −0.04 beat per bar, total drift ≥ max(tRed, 0.25 beat), r² ≥ 0.5 | ≥ 12 matched notes over ≥ 6 bars |
| E2 | Fell behind the click | rhythm | as E1 with b ≥ +0.04 beat per bar | as E1 |
| E28 | Late pickup | rhythm | pickup missed, or its Δ minus the median Δ of the next 8 notes ≥ max(tRed, 0.25 beat) | 1 |
| E29 | Late first entry | rhythm | as E28 for the first note when there is no pickup | 1 |
| E9 | Early after rests | rhythm | entries after rests of at least 1 beat, each ≥ tRed earlier than the attempt median Δ ("extras during rests" is not used: reverb and ring-through) | ≥ 3 entries |
| E7 | Dotted quarter-eighth evened out | rhythm | `Q.E` figures with median long:short ratio ≤ 2.0, only where the short IOI ≥ 150 ms | ≥ 3 figures |
| E8 | Dotted eighth-sixteenth evened out | rhythm | `E.S` figures with median ratio ≤ 2.2, only where the sixteenth IOI ≥ 120 ms | ≥ 3 figures |
| E4 | Hesitated at barlines | rhythm | downbeats not after a rest or phrase end with relative Δ ≥ max(0.12 beat, 50 ms) | ≥ 4 downbeats |
| E18 | Misread ledger-line notes | notes | wrong pitch on notes with ≥ 2 ledger lines, off by 1 or 2 diatonic steps | ≥ 2 notes and ≥ 40% of those notes |
| E26 | Busy passages broke down | notes | mean per-note credit in the densest 25% of beats ≥ 25 points below the rest | ≥ 4 dense beats |
| E16 | Wrong partial (trumpet) | notes | played and target share the valve combination, adjacent partial, not an octave apart | ≥ 2 notes |
| E31 | Clarinet break crossings | notes | wrong pitch or late onset on notes crossing written B♭4/B4 (70/71), at ≥ 2× the error rate elsewhere | ≥ 3 crossings with errors |

(E1/E2 and E28/E29 are pairs, so the 18 ids form 16 patterns.)

Acceptance (on 01's synthetic suite, with realistic noise and both bleed conditions):
- 300 perfect takes produce no pattern except E30.
- For each injected-error scenario, the intended pattern fires in ≥ 90% of runs and no other v1 pattern fires in more than 5%.

The other patterns (E3, E5, E10, E11, E14, E15, E17, E19, E20, E21, E24, E25, E27, E32 to E35) are data-only with `enabled: false` (Later annex).

### 6.3 Universal tips (v1, enabled)

| Id | Trigger | Tip |
| --- | --- | --- |
| U01 | E1 | You finished ahead of the click. Rushing usually comes from excitement and short notes. Let every long note take its full value, and feel the click land on every beat, not only beat 1. |
| U02 | E2 | You fell behind the click. Dragging means your eyes are too close to your sound. Keep your eyes at least one beat ahead, and keep moving when a note goes wrong: a wrong note on time beats a right note late. |
| U04 | E4 | You paused at barlines. Read across them: before you reach the end of a bar, your eyes should already be on the first note of the next bar. |
| U06 | E6 | You stopped or went back. In sight reading the beat is the boss. If you get lost, drop notes, find the next downbeat, and come back in. Count "1" on every downbeat so you always know where to re-enter. |
| U07 | E7 | Dotted quarter and eighth came out even. It is long-short, 3 to 1. Count "1-and-2-and" and put the eighth on the "and" of 2. |
| U08 | E8 | Dotted eighth and sixteenth is not a triplet. The sixteenth sits right against the next beat: count "1-e-and-a" and put it on "a". |
| U09 | E9 | You came in early after rests. Rests are counted silence. Keep counting through them and use the rest to prepare (breath, bow, hand) so the entry lands on time. |
| U12 | E12 | Notes from the key signature were missed (for example F instead of F♯). Before you start, name the key and its altered notes out loud ("D major: F♯ and C♯"). |
| U13 | E13 | Written accidentals were missed. During your scan, find every accidental before you play a note. |
| U16 | E18 | Ledger-line notes tripped you up. Learn landmark notes (middle C, the C two ledger lines above the treble staff) and read ledger notes as steps from the landmark. |
| U17 | E26 | Busy passages lost accuracy. Look for shapes: scales, arpeggios, repeated figures. Read a shape as one unit instead of note by note. |
| U18 | E30 | Clean read. Try the next one 8 bpm faster, or take a stretch excerpt at the next level. |
| U20 | E28, E29 | The first note was late. Prepare on the last count-in beat (breathe, set the bow, place the hand) so sound starts exactly on beat 1. Look at the pickup during the scan. |
| U22 | E22 | You were about {offset} cents {direction} throughout. Use the tuning note before the next exercise. |

E16, E23 and E31 have no universal tip: they fire only for trumpet, voice and clarinet, whose family tips cover them.

### 6.4 Family tips (v1, launch families)

`C` = `assertsCause: true` (needs the pattern primary in 2 of the last 5 attempts on that instrument).

| Id | Family / instrument | Trigger | C | Tip |
| --- | --- | --- | --- | --- |
| VO02 | voice | E23 | | Your pitch sank slowly across the exercise. Keep "do" in your ear: re-hear the tonic silently at each rest, and keep vowels bright. |
| VO04 | voice | E12, E13 | | Chromatic notes: use solfège. Sharps raise (fi, di, si), flats lower (te, le, me). A raised note usually wants to resolve up; hear the pull. |
| VO07 | voice | E6 | | If you stopped to breathe, plan breaths at rests and phrase ends during the scan, and take a quick low breath at each one. |
| VO08 | voice | E29 | | Your first note came in late. On the last count-in beat, hear the starting pitch in your head and start the tone right on it. |
| FL05 | flute | E12, E13 | C | Accidentals and key notes on flute often hide in B♭ and F♯. Choose thumb B♭ in flat keys and when no B naturals are near; decide in the scan. |
| FL06 | flute | E6 | | If you stopped to breathe, mark breaths in the scan, after long notes or before pickups, and take quick breaths through the corners of the mouth. |
| FL07 | flute | E26 | C | Fast passages fell apart. Keep fingers close to the keys and let the air lead the line. |
| CL01 | clarinet | E31 | C | Notes crossing the break failed. Keep right-hand fingers down when crossing up, and keep the air steady; do not pinch on the way up. |
| CL05 | clarinet | E26 | C | Fast passages tangled the little fingers. In the scan, find runs that need alternating left and right little-finger keys and decide which side each note takes. |
| SX04 | sax | E12, E13 with a B♭ involved | C | B♭ fingerings: use bis B♭ in flat keys, side B♭ in chromatic lines, and 1-and-1 next to B naturals. Choose in the scan. |
| SX06 | sax | E18 | | Palm-key notes (written D6 to F6) were misread. Learn them as steps above the high C at two ledger lines. |
| HB01 | trumpet | E16 | | You landed on a neighbouring partial (same fingering, different note). Brass needs you to hear the pitch first. In the scan, hum or buzz the tricky intervals. |
| US02 | violin | E12 | C | Key-signature notes were missed. Before you start, set the finger pattern for the key: high 2nd finger in sharp keys (F♯, C♯), low 2nd in flat keys. |
| US03 | violin | E13 | C | Accidentals change finger spacing. A half step means fingers touching; a whole step means a gap. |
| US05 | violin | E26 | C | Fast string crossings fell behind. Keep the bow near the next string level and move the elbow ahead of the change. |
| US07 | violin | E22 | | Your notes were out of tune throughout. Tune with the app's tuning note before the next exercise, and check 3rd and 4th fingers against open strings. |
| LS02 | cello | E12 | C | Sharp keys on cello need forward extensions. Find the F♯ and C♯ positions in the scan and decide where to extend. |
| LS07 | cello | E2 | | The bass line sets the time for everyone. Keep each note's start on the click and avoid waiting for the sound to bloom. |
| KB02 | piano-rh | E4, E6 | C | Hesitations often come from looking at your hands. Keep your eyes on the music and use the groups of two and three black keys as landmarks. |
| KB03 | piano-rh | E26 | C | Runs broke down. Decide fingering at position changes during the scan, including where the thumb passes under. |
| KB04 | piano-rh | E12 | | Key-signature notes were missed. Before you start, rest fingers over the black keys of the key (D major: F♯ and C♯). |
| KB05 | piano-rh | E18 | | Ledger-line notes were misread. Middle C is one ledger line below treble; read outward from it. |
| KB07 | piano-rh | E1 | C | Running notes rushed. Keep fingers close to the keys so they do not race ahead, and feel each beat land with the click. |

Removed this round because they assert causes we never measure: SX05 and old VO08 (scooping), HB06 (tired sound), LB08 and DR05 (air); VO07 and FL06 were rewritten as conditional. VO06 is removed (R7). Family tips for beta families stay as disabled data (Later annex).

### 6.5 Tip writing rules

One actionable instruction per tip; ≤ 280 characters; names the error in the first sentence; no jargon above the level's vocabulary ("pickup", not "anacrusis", below L5); never blames the player; never asserts a cause the app does not measure unless marked `assertsCause`.

## 7. Pre-performance routine (v1)

1. **Reveal and scan.** The excerpt is hidden until Start scan (reveal marks it seen). Ranked: the timer counts down the level default and the count-in starts automatically at 0 (04 owns the countdown display); starting earlier is always allowed. Practice: the timer runs but never starts the take. Custom scan lengths are later.
2. **STARS checklist** (04 owns the interaction):
   - **S**ignatures: say the key and its sharps or flats; what gets the beat and how many per bar.
   - **T**empo: how one beat feels; hear the click.
   - **A**ccidentals: find every accidental; note where the barline cancels it.
   - **R**hythms: find the hardest bar; count it silently once.
   - **S**igns and shape: highest and lowest note, leaps, clef, dynamics, the ending.
3. **Prepare.** Finger, bow or slide the hardest bar silently. Voice: the tonic triad and starting note (4.5), mandatory; the singer may hum once. Winds, brass and strings: the optional tuning note. Other instruments do not get the starting note in ranked takes.
4. **Count-in** per 2.3.
5. **During play** the display leads the eye; no auto-scroll on screens where the excerpt fits. Phone portrait uses page turns (04); landscape is recommended (R13).
6. **After play.** Grade, components, diagnostics, heat strip, at most 2 tips, then "Next excerpt" as primary. "Try again" is secondary and marked practice, with the practice XP rule stated.

## 8. Reuse from ear-to-staff (reference)

| Module | Verdict for this section |
| --- | --- |
| `js/theory.js` INSTRUMENTS | Adapt: keep `semis` and `diatonic`; extend with family, onset class, clefs by level, full range, tiers and status from section 1. Trumpet range narrows to 54–84. |
| `js/theory.js` `transposeKey`, `KEYS` | Reuse for written-key gating in both directions. |
| `js/theory.js` `noteName`, `vexKey` | Keep for ghost notes only, as the fallback spelling rule in 4.8. |
| `js/segmenter.js` | 01 adapts; this section only supplies per-family needs (onset class, minimum steady pitch). |
| `js/history.js` record format | Adapt the idea of a small JSON record per take; audio is never stored (R9). |

## 9. Attempt record (what grading emits)

01 owns the full `AttemptRecord` type; this is the score part `grade/` fills. It replaces 01's `AttemptScore` (`pitchPct`, `rhythmPct`, `durationPct`, `pointsEarned` are withdrawn).

```json
{
  "excerptId": "schubert-d257-b1-8",
  "instrument": "trumpet-bb",
  "level": 5,
  "beta": false,
  "settings": { "writtenKey": "D", "meter": "2/4", "tempo": 92, "random": ["key"], "metronomeMode": "audible", "a4": 440 },
  "ranked": true,
  "rankedReasons": [],
  "gate": "ok",
  "scanSeconds": 30,
  "notes": [
    { "i": 0, "bar": 1, "beat": 1, "targetWritten": 74, "state": "correct", "deltaMs": 12, "cents": -6, "p": 1, "n": 1, "o": 1, "d": null, "tol": { "good": 50, "red": 85, "bad": 120 } },
    { "i": 1, "bar": 1, "beat": 2, "targetWritten": 78, "state": "wrong-pitch", "playedWritten": 77, "ghostSpelling": "F♮5", "deltaMs": 140, "p": 0, "o": 0, "rejudged": false }
  ],
  "extras": [ { "onsetMs": 5120, "playedWritten": 72 } ],
  "displaced": [ { "fromIdx": 9, "toIdx": 14, "offsetBeats": -2 } ],
  "components": { "P": 86, "I": 91, "R": 82 },
  "weights": { "P": 0.50, "I": 0.10, "R": 0.40 },
  "total": 85,
  "grade": "B",
  "stars": 2,
  "diagnostics": { "stops": [ { "bar": 5, "beats": 2 } ], "driftMs": 60, "restarts": 1 },
  "patterns": [ { "id": "E12", "lostPoints": 6.1, "noteIdx": [1, 9, 14], "bars": [1, 3, 4] } ],
  "tipsShown": ["US02"],
  "xp": { "base": 34, "factors": { "q": 0.85, "m_random": 1.08, "m_streak": 1.12 }, "total": 35 },
  "configVersion": "grading-2.0.0"
}
```

## 10. Config files and data owned by this section (frozen before wave 1)

| File | Contents |
| --- | --- |
| `config/grading-config.json` | Level-band timing values, IOI caps, onset-class floors, match-window rule, intonation bands, `intonationMinSteadyMs`, live provisional window (80 ms) and hysteresis (+10 cents), component weights, gates, stop thresholds, diagnostics thresholds |
| `config/levels.json` | The 2.3 table per level, NPS and repeat-floor rule, stretch rate, selection fractions, descriptions |
| `config/instruments.json` (pedagogy fields) | Family, onset class, clefs by level, full range, tiers, status (launch or beta), testkit timbre, `assertsLowFundamental` check |
| `config/progression.json` | XP formula constants, rank table, level-window rules, placement, daily cap, practice XP, skip limit |
| `config/tips.json` | Pattern records (name, dimension, thresholds, enabled) and tip records (sections 6.3, 6.4, and the disabled data in the annex) |
| `data/trumpet-valves.json` | Written pitch → valve combination and partial number, written F♯3 to C6 |
| `grade/resolve-tolerance.ts` | The pure resolver of 4.2, imported by `follow/` and the renderer |
| `fixtures/grade/*.json`, `fixtures/levels/feature-vectors.json` | Tests 4.9 and golden feature-to-level cases shared by the TS and Python taggers |

## Open questions

1. **Key coverage at L1–L2.** With 12-semitone tier A bands and span ≤ 12, each excerpt fits every launch instrument in at least one key, but only short-span excerpts fit all of C, F and G. 03's first histogram job must report fitting excerpts per launch instrument × level × written key. If a key has fewer than 20, widen that tier A by 1 semitone at the top (1.4). This replaces my earlier claim that G2 passes "by construction".
2. **Measured σ and c90.** The floors in 4.2 rest on 01's budgets. The synthetic suite (with the phone-mic condition) will publish them; if they exceed the budget, the floors widen in config. Real-device numbers come later.
3. **Augmented Romantic phrases at L1–L2** may sound slow at ♩ = 60 to 76. Accepted for v1; revisit when method-book sources arrive (later).

## Dependencies on other roles

- **01**: σ and c90 per onset profile as a CI artifact; `onsetKind`, `steadyMs`, clarity and clipping per note; pitch-change and repeat IOI floors per window class; the displacement detector and `displaced` segments; the signal-quality flag; the end-of-take rule in 4.6 (no silence end mid-excerpt); follower imports `grade/resolve-tolerance.ts` and the voice drift function; sax and cello timbres in P3; the phone-mic synthetic condition; 01 §4.5–§4.6, §6.3 and §7 types revised to section 9 and 5.7.
- **03**: features in 2.5 with `key` removed and `mode` and `span` added; H2 half cadence from L3; augmentation per 3.3; interest threshold 0.25 for quartet inner parts at L1–L2; level histogram per instrument × level × written key; agent-written `familiar.yaml`; no separate ledger-line rule.
- **04**: the `rankedReason` copy; three component rows plus diagnostic text lines; `correct-marginal` as non-red; strict ranked scan with auto-start; level descriptions and pattern names from config; cents in review only; Stop and skip copy per 5.3.
- **05**: the per-take measurement gate (a) to (g) feeding `rankedReason: measurement`; `audioEnv` recorded on every attempt; the reference tone played through the click output path.
- **Overseer**: the unresolved items returned with this revision.

---

## Later (not in this build)

Keep brief. Nothing below is built in v1. Data marked "kept as data" ships in config with `enabled: false`.

### L-A Features moved to later

- Beta-to-launch promotion as timbres and gates pass (config change only). Cello below E2 once the phone-mic gates pass at C2.
- Real-device and real-recording validation of floors and patterns; re-tuning from measured data.
- Voice 20-second range check; absolute-pitch (no drift compensation) toggle, which will be unranked; extended-range setting.
- Streak freezes; remedial bias and focus-driven selection; bar drills at 75% tempo; custom scan time.
- Familiarity 1 tagging; modal excerpts on a fixed key; key and meter changes inside an excerpt (old H7: keys from L7, meters from L8); grace notes (old L7), trills and fermatas (old L6), tempo words and rit./accel. text (old L7–L8), marcato; lyrics.
- Method books, etudes, hymnals and folk books in our own encoding; PDMX; human calibration and review of levels.
- Grading tongued versus slurred articulation for winds and brass.
- Listen-back, "Play what I played", "Play the score", MusicXML export.
- Accounts, sync, leaderboards (need server re-grading from uploaded event lists), any backend.

### L-B MIDI, haptic metronome, polyphony

- MIDI input will be a separate instrument id (for example `piano-rh-midi`) with its own level, no intonation, fixed-pitch weights, and XP counting toward rank like any instrument. `inputPath` stays an optional field in v1 types.
- A haptic metronome is graded identically and counts for rank at all levels; `metronomeMode` is recorded in `audioEnv`.
- Polyphonic piano and guitar: per-chord credit (all pitches = full, partial = proportional), needs schema v2.
- Swing and feel options.

### L-C Disabled patterns (kept as data)

| Id | Rule (draft thresholds) | Why disabled in v1 |
| --- | --- | --- |
| E3 | runs of ≥ 3 eighths or sixteenths with played IOI < 0.85 × written, ≥ 2 runs | onset noise is a large share of short IOIs |
| E5 | notes after leaps ≥ P5 late by ≥ 0.12 beat vs others, ≥ 3 leaps | same |
| E10 | syncopated notes moved ≥ 0.15 beat toward the beat, ≥ 2 | same |
| E11 | triplet IOIs deviate > 25% from equal, ≥ 2 groups | same |
| E14 | accidental carried or dropped within or after the bar, ≥ 1 | evidence too rare |
| E15 | octave or register errors (clarinet ± 19), ≥ 1 | confounded with detector octave errors; never for voice (R7) |
| E17 | wrong-pitch rate after leaps ≥ 2 × elsewhere, ≥ 2 | low precision |
| E19 | clef confusion consistent with the primary clef, ≥ 2 | launch instruments rarely change clef at low levels |
| E20, E21 | register intonation ≥ ±15 cents in top or bottom 25%, ≥ 3 notes | offsets unverified without real recordings |
| E24 | unstable sustain, SD > 25 cents after vibrato removal | needs frame data not stored |
| E25 | slow response low register ≥ 0.10 beat | low-register latency confounded with the detector |
| E27 | last third ≥ 20 points below first third | low precision |
| E32 | long notes cut short (d < 0.5), ≥ 2 | offsets unverified without real recordings |
| E33, E34, E35 | trombone long positions, valve combinations 1-3 and 1-2-3, string shifts | need position, valve and shift tables |

### L-D Disabled universal tips (kept as data)

| Id | Trigger | Tip |
| --- | --- | --- |
| U03 | E3 | Runs of short notes got faster. Subdivide in your head ("1-e-and-a") and place each group against the click rather than letting the fingers lead. |
| U05 | E5 | You hesitated before leaps. Spot leaps during the scan and decide the landing note before you start, so the leap is already solved when you reach it. |
| U10 | E10 | Syncopated notes slid onto the beat. Feel the beat under the note: tap your foot on the beats and let the syncopation sit between taps. |
| U11 | E11 | Triplets were uneven. Say "tri-pl-et" evenly across one beat, and land the next beat exactly on the click. |
| U14 | E14 | An accidental lasts until the barline, for every note on that line or space, and the barline cancels it. Watch for both: keeping it through the bar and dropping it after. |
| U15 | E17 | Wrong notes clustered after leaps. Read leaps as intervals, not letter names: line to line is a 3rd, line to the next-but-one line a 5th. Hear or feel the interval before you play it. |
| U19 | E27 | Accuracy dropped near the end. Glance at the last line during your scan so the ending is not a surprise, and keep the same focus to the double bar. |
| U21 | E32 | Long notes were cut short. Count through every long note and release on the next beat, not before. |
| U23 | E19 | Clef reading: find the clef's anchor note first (alto clef: middle line is middle C; tenor clef: 4th line is middle C) and read by step from it. |

### L-E Disabled family tips (kept as data; draft text unchanged)

- Launch families, disabled patterns: VO01 (E20), VO03 (E17), VO05 (E24); FL01 (E20), FL02 (E21), FL03 (E15), FL04 (E25); CL02 (E15), CL03 (E20), CL04 (E21), CL06 (E25); SX01 (E20), SX02 (E25, E21), SX03 (E15); HB02 (E20), HB03 (E34), HB04 (E25), HB05 (E17); US01 (E35), US06 (E32); LS01 (E35), LS04 (E25), LS05 (E32); KB01 (E17).
- Beta families: DR01 to DR04, DR06, DR07 (double reeds); HB07, HB08 (horn); LB01 to LB07 (low brass); US04 (viola); LS03 (cello tenor clef, E19), LS06 (double bass); GT01 to GT07 (guitar).
- Their text is in revision 1 of this file (commit a2454fe, section 6.4) and is copied verbatim into `tips.json` with `enabled: false`. KB06 is dropped (it relied on the disabled "extras during rests" signal).
- Removed outright: VO06 (R7), SX05, old VO08, HB06, LB08, DR05 (unmeasured causes).

---

## Review log (revision 2)

Rulings applied:
- R1: key is the written key everywhere; key is a request constraint, not an excerpt feature.
- R2: one tolerance formula in `grading-config.json` with a shared resolver; 01's points model, Elo, tolerance table, 35 ms floor and `intonationBonusCents` marked withdrawn; floors justified against 01's σ and c90 with a CI check.
- R3: launch criteria, level calibration and tip validation are automated (synthetic phone-mic condition, histogram, tip-precision suite); human steps moved to later.
- R4: v1 sources are 03's verified GitHub sources only.
- R5: XP, rank, seen set and daily cap per player; level per instrument.
- R6: ranked scan = strict level default, with auto-start; the +30 s allowance removed.
- R7: voice octave displacement earns full credit; E15 and VO06 off for voice; reference tone mandatory.
- R8: no key or meter changes (H7 replaced), no ornaments, fermatas, tempo words, lyrics; L7–L10 redefined with single-key, single-meter features; modal only under random key.
- R9: listen-back, swing, MIDI, polyphony, accounts and backend moved to Later.
- R11: live verdict table kept as the default, with `correct-marginal` non-red and live sharp/flat hysteresis.
- R12, R13: practise without listening kept (no XP); phone page turns referenced.

My cross-examination answers applied:
- Q1: 8 launch instruments, automated launch criteria, beta behaviour; cello clamped at E2; piano LH beta and floored at C2.
- Q2: L1 max interval P4 with tonic-triad leaps to P8; L1 meters include 2/4; one-beat pickup from L2; span intrinsic (≤ 12 at L1–L2, ≤ 16 at L3–L4); tier A bands ≥ 12 semitones; augmentation only where the meter survives; inner parts at interest 0.25; pool needs stated; max-of-features kept.
- Q3: tempo stability (T) and continuity (C) removed as components; new P/I/R weights; drift and stops as diagnostics; tests 4 and 6 rewritten.
- Q4: tolerance formula, family floors, IOI caps, intonation floors, worked examples.
- Q5: stop, restart, end-of-take and ranked Stop rules.
- Q6: 16 v1 patterns with evidence rules; 19 disabled; cause-asserting tips rewritten or removed; tip-precision acceptance test.
- Q7: anti-gaming rules: seen at reveal by `dedupeGroup`, skip limit, m_below, per-player daily cap of 60, practice repeat XP, mid-tempo requirement for level-up.
- Q8: the scope split in section 0 and the Later annex.

Challenges answered:
- Architect, timing floors: accepted with modification (floors 40/60/90 hard, 55/85/120 soft, which exceed 01's minima; reported calibration unranked).
- Architect, minimum steady pitch and live provisional window: accepted (01's 150/180 ms, 80 ms provisional, +10 cents); my 150 ms / +5 cents proposal withdrawn.
- Architect, voice octave: accepted for voice; the 0.5 credit for other families is rejected (octave = wrong pitch after score-informed correction).
- Architect, NPS caps and piano LH: accepted (cap per window class, repeat floor, piano LH from C2).
- Architect, R6 and R8 conflicts: accepted (strict scan, L7–L10 redefined, trill and grace rules removed).
- Architect, patterns needing data: accepted with modification (E24, E33–E35 later; E16 kept with a trumpet valve table; E31 kept because it needs only written pitch; displaced notes excluded from extras with no partial credit; other draft patterns disabled for precision).
- Researcher, L1 relaxation and bands: accepted with modification (P4 free plus tonic-triad leaps to P8; all tier A and B bands ≥ 12); selection at level ±1 rejected in favour of 2.6 with a pool-exhaustion stretch fallback.
- Researcher, augmentation: accepted with modification (same-meter doubling plus 2/4 → 4/4 and 3/8 → 3/4).
- Researcher, key not a feature: accepted (mode feature added).
- Researcher, HC from L3: accepted.
- Researcher, ornament and modal rows and human sign-offs: accepted with modification (ornament rows later; modal kept but only under random key per R8; human sign-offs replaced by 03's automated gates).
- Designer, voice octave: accepted.
- Designer, strict scan, `rankedReasons`, m_mode: accepted (enum extended with `practice-mode`, `calibration`, `measurement`, `skip-limit`).
- Designer, 50/80 ms floors everywhere: accepted with modification (hard 40/60, soft 55/85 per 01's budget; L7+ good cents 20; keyboard −10 ms dropped).
- Designer, level descriptions and pattern names: accepted (2.3 and 6.2); live out-of-tune as a ghost with an arrow, cents in review only.
- iOS, voice octave: accepted with modification (full credit; informational flag only, no tip).
- iOS, tGood ≥ 40 ms: accepted (hard floor 40; widening driven by measured σ in config).
- iOS, measurement quality in ranked rules: accepted (05's gate feeds `measurement`; Bluetooth unranked; +30 s removed).
- iOS, beta derived from data: accepted with modification (80 Hz criterion plus timbre and gates); "beta ranked on iOS only after the device gate" rejected because the per-take gate already applies and the device gate cannot run in this build.

Other changes:
- Section 0 scope table, `levels.json` descriptions, pattern names and dimensions, `assertsCause` flag, practice XP and repeat rule, progress shape without freezes or Elo, attempt record aligned to P/I/R with diagnostics, config ownership table, new acceptance tests 8 and 11 to 16, open questions reduced to three.
- Test 4 uses 0.05 beat per bar, not the 0.15 in my Q3 answer: at 0.15 the notes after bar 3 fall outside W and are missed, so they never reach E2's slope fit.
- My Q2 claim that 03's G2 passes "by construction" was wrong for the 3-key condition; it is now open question 1.
