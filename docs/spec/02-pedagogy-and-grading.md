# 02 Pedagogy, difficulty, grading, progression, and tips

Owner: lead musician and pedagogue. Readers: overseer, technical architect (01), music score researcher (03), senior designer (04), senior iOS (05), and the implementers who build the level tagger, the grading engine, the progression store, and the tip engine.

Conventions used throughout:

- Pitches use scientific pitch notation with MIDI numbers (C4 = 60, A4 = 440 Hz by default).
- "Written" means what the player reads. "Concert" means what sounds. Written = concert + `semis` for transposing instruments.
- "Beat" means the metronome beat: quarter in x/4, half in 2/2 and 3/2, eighth in 3/8, 5/8, 7/8 (at L1 to L6 3/8 is felt in one, see meters), and dotted quarter in 6/8, 9/8, 12/8.
- All keys, key gating, and key settings in the UI are **written keys** (what the player sees). The caption also shows the concert key. This differs from ear-to-staff, where "Key" meant concert key; for sight reading, difficulty lives in what is on the page.
- Numbers below are v1 defaults. Every threshold lives in one versioned config file (`grading-config.json`, `levels.json`, `tips.json`) so it can be tuned without code changes. Each graded attempt stores the config version it was graded with.

## 1. Supported instruments for v1

### 1.1 Families and instruments

v1 is monophonic. Every instrument below plays a single line. Families exist because tips, grading tolerances, and onset handling are set per family.

| Family id | Instruments (v1) | Pitch behaviour | Status |
| --- | --- | --- | --- |
| `voice` | Soprano, Alto, Tenor, Baritone/Bass | Continuous, drifts without reference | v1 |
| `flute` | Flute | Continuous (wind) | v1 |
| `double-reed` | Oboe, Bassoon | Continuous (wind) | v1 |
| `clarinet` | B♭ clarinet | Continuous (wind) | v1 |
| `sax` | E♭ alto, B♭ tenor, E♭ baritone saxophone | Continuous (wind) | v1 (baritone beta) |
| `high-brass` | B♭ trumpet (and cornet), F horn | Continuous (lip, partials) | v1 |
| `low-brass` | Trombone, Euphonium (bass clef and treble clef), Tuba (BB♭/CC) | Continuous (lip, partials) | v1 (tuba beta) |
| `upper-strings` | Violin, Viola | Continuous (fretless) | v1 |
| `low-strings` | Cello, Double bass | Continuous (fretless) | v1 (double bass beta) |
| `keyboard` | Piano, single line, right hand (treble) or left hand (bass) | Fixed pitch, decaying | v1, single line only |
| `guitar` | Classical/acoustic/electric guitar, single line | Fixed pitch (fretted), decaying | v1, single line only |

"Beta" means sounding fundamentals fall below ~70 Hz, where built-in laptop and phone mics roll off. The architect must confirm detection quality on real devices (see open questions). Beta instruments are selectable, are labelled "beta" in the picker, and their attempts are graded normally.

### 1.2 Polyphonic instruments (piano, guitar)

- v1: piano and guitar read and play **one line only**. Piano picks a hand: right hand uses treble clef excerpts, left hand uses bass clef excerpts. Guitar reads treble clef sounding an octave lower (treble-8vb), the standard guitar notation.
- v1 excerpt selection for these instruments uses the same melodic corpus; no chords, no double stops, no two-voice textures.
- Recommended v1.1 (architect decides): Web MIDI input for digital pianos (Chrome and Edge; not Safari). MIDI gives exact pitch and onset, so piano could then grade two-hand and chordal reading without polyphonic audio transcription.
- v2: chords and two-voice reading by audio need polyphonic transcription (for example a small in-browser model). Deferred. Grading for chords would be per-chord: all pitches present = full credit, partial = proportional.
- Bowed string double stops, multiphonics, and harmonics are excluded from v1 excerpts.

### 1.3 Written range, clef, and transposition

`semis` = written pitch minus concert pitch, in semitones (same convention as ear-to-staff `js/theory.js` INSTRUMENTS). Full written range is the outer bound the excerpt tagger will ever accept for the instrument.

| Instrument id | Clef(s) | semis | Full written range (MIDI) | Sounding lowest |
| --- | --- | --- | --- | --- |
| `voice-soprano` | treble | 0 | A3–C6 (57–84) | 220 Hz |
| `voice-alto` | treble | 0 | E3–F5 (52–77) | 165 Hz |
| `voice-tenor` | treble-8vb | 12 | written A3–A5 (57–81); sounds A2–A4 | 110 Hz |
| `voice-bass` | bass | 0 | E2–F4 (40–65) | 82 Hz |
| `flute` | treble | 0 | C4–C7 (60–96) | 262 Hz |
| `oboe` | treble | 0 | B♭3–G6 (58–91) | 233 Hz |
| `bassoon` | bass; tenor from L7 | 0 | B♭1–E5 (34–76) | 58 Hz |
| `clarinet-bb` | treble | 2 | E3–G6 (52–91) | 147 Hz |
| `sax-alto` | treble | 9 | B♭3–F♯6 (58–90) | 139 Hz |
| `sax-tenor` | treble | 14 | B♭3–F♯6 (58–90) | 104 Hz |
| `sax-bari` | treble | 21 | A3–F♯6 (57–90) | 65 Hz (beta) |
| `trumpet-bb` | treble | 2 | F♯3–C6 (54–84) | 165 Hz |
| `horn-f` | treble; bass (new notation) from L7 | 7 | F♯2–C6 (42–84) | 87 Hz |
| `trombone` | bass; tenor from L7 | 0 | E2–D5 (40–74) | 82 Hz |
| `euphonium-bc` | bass; tenor from L8 | 0 | E2–C5 (40–72) | 82 Hz |
| `euphonium-tc` | treble | 14 | F♯3–D6 (54–86) | 82 Hz |
| `tuba` | bass | 0 | D1–F4 (26–65) | 37 Hz (beta) |
| `violin` | treble | 0 | G3–E7 (55–100) | 196 Hz |
| `viola` | alto; treble from L5 | 0 | C3–E6 (48–88) | 131 Hz |
| `cello` | bass; tenor from L7; treble from L9 | 0 | C2–A5 (36–81) | 65 Hz |
| `double-bass` | bass; tenor/treble from L9 | 12 | written E2–D5 (40–74) | 41 Hz (beta) |
| `piano-rh` | treble | 0 | A2–C7 (45–96) | 110 Hz |
| `piano-lh` | bass | 0 | C1–C5 (24–72) | 33 Hz |
| `guitar` | treble-8vb | 12 | written E3–B5 (52–83) | 82 Hz |

Voice types: the player picks a voice type, then can optionally run a 20-second range check (sing lowest and highest comfortable sustained note). The comfortable band for the level is then intersected with the measured range, never widened beyond the table.

### 1.4 Comfortable sight-reading range by level

Excerpts are transposed (by key and by whole octaves) so all notes fall inside the band for the player's level. Range tiers map to levels: tier A = L1–L2, B = L3–L4, C = L5–L6, D = L7–L8, E = L9–L10. All values are **written** MIDI.

| Instrument | A (L1–2) | B (L3–4) | C (L5–6) | D (L7–8) | E (L9–10) |
| --- | --- | --- | --- | --- | --- |
| Soprano | D4–D5 (62–74) | C4–E5 (60–76) | C4–F5 (60–77) | B3–G5 (59–79) | A3–A5 (57–81) |
| Alto | A3–A4 (57–69) | G3–C5 (55–72) | F3–D5 (53–74) | F3–E5 (53–76) | E3–F5 (52–77) |
| Tenor (written) | D4–D5 (62–74) | C4–E5 (60–76) | C4–F5 (60–77) | B3–G5 (59–79) | A3–A5 (57–81) |
| Baritone/Bass | A2–A3 (45–57) | G2–C4 (43–60) | F2–D4 (41–62) | F2–E4 (41–64) | E2–F4 (40–65) |
| Flute | F4–D5 (65–74) | D4–G5 (62–79) | C4–C6 (60–84) | C4–G6 (60–91) | C4–C7 (60–96) |
| Oboe | D4–C5 (62–72) | C4–E5 (60–76) | B♭3–A5 (58–81) | B♭3–D6 (58–86) | B♭3–G6 (58–91) |
| Bassoon | F2–C4 (41–60) | D2–D4 (38–62) | B♭1–G4 (34–67) | B♭1–C5 (34–72) | B♭1–E5 (34–76) |
| Clarinet | G3–B♭4 (55–70), below the break | E3–D5 (52–74) | E3–G5 (52–79) | E3–C6 (52–84) | E3–G6 (52–91) |
| Saxes | D4–C5 (62–72) | C4–F5 (60–77) | B♭3–C6 (58–84) | B♭3–E6 (58–88) | B♭3–F♯6 (58–90); bari to A3 |
| Trumpet | C4–C5 (60–72) | B♭3–D5 (58–74) | G3–G5 (55–79) | F♯3–A5 (54–81) | F♯3–C6 (54–84) |
| Horn | G3–C5 (55–72) | F3–E5 (53–76) | C3–G5 (48–79) | G2–A5 (43–81) | F♯2–C6 (42–84) |
| Trombone | B♭2–C4 (46–60) | F2–D4 (41–62) | E2–F4 (40–65) | E2–B♭4 (40–70) | E2–D5 (40–74) |
| Euphonium (BC) | B♭2–C4 (46–60) | F2–E♭4 (41–63) | E2–F4 (40–65) | E2–B♭4 (40–70) | E2–C5 (40–72) |
| Euphonium (TC) | C4–D5 (60–74) | G3–F5 (55–77) | F♯3–G5 (54–79) | F♯3–C6 (54–84) | F♯3–D6 (54–86) |
| Tuba | B♭1–B♭2 (34–46) | F1–D3 (29–50) | F1–F3 (29–53) | D1–B♭3 (26–58) | D1–F4 (26–65) |
| Violin | D4–A5 (62–81) | G3–B5 (55–83) | G3–D6 (55–86) | G3–A6 (55–93) | G3–E7 (55–100) |
| Viola | G3–D5 (55–74) | C3–E5 (48–76) | C3–G5 (48–79) | C3–C6 (48–84) | C3–E6 (48–88) |
| Cello | G2–D4 (43–62) | C2–D4 (36–62) | C2–A4 (36–69) | C2–D5 (36–74) | C2–A5 (36–81) |
| Double bass (written) | A2–G3 (45–55) | E2–B3 (40–59) | E2–D4 (40–62) | E2–G4 (40–67) | E2–B4 (40–71) |
| Piano RH | C4–G4 (60–67) | C4–C5 (60–72) | G3–G5 (55–79) | C3–C6 (48–84) | A2–C7 (45–96) |
| Piano LH | C3–G3 (48–55) | C3–C4 (48–60) | F2–F4 (41–65) | C2–C5 (36–72) | C1–C5 (24–72) |
| Guitar (written) | G3–G4 (55–67) | E3–A4 (52–69) | E3–C5 (52–72) | E3–E5 (52–76) | E3–B5 (52–83) |

Rules:
- An excerpt fits a player if every written note (after transposition) is inside the band. Tier A and B additionally require a margin: the excerpt's span must be at least 1 semitone inside each edge when possible (pick the transposition that maximizes the minimum margin).
- The excerpt's own span must not exceed the band span (that is a range feature; see section 2).
- A player may select "extended range" in settings to use the next tier up for range only. That raises the excerpt's range feature level and therefore its difficulty level.

## 2. Difficulty ladder (10 levels)

### 2.1 Principle

Difficulty is a vector of measurable features. Each feature has a per-level limit. An excerpt's level for a given instrument is the **maximum** level over all its features (the hardest feature sets the level). The tagger computes features from the MusicXML after transposition for the target instrument; only range and clef depend on the instrument, everything else is instrument-independent and can be precomputed.

A "stretch" excerpt has exactly one feature at level L+1 and all others at ≤ L. The selector may serve one stretch excerpt in every five at level L (config `stretchRate = 0.2`); it is graded and credited as level L.

### 2.2 Rhythm cell vocabulary

The tagger reduces each beat (or beat pair for cells that span two beats) to a cell id. These ids are the rhythmic vocabulary.

| Cell id | Meaning | First level |
| --- | --- | --- |
| `W`, `H`, `Q`, `Wr`, `Hr`, `Qr` | whole, half, quarter notes and rests | 1 |
| `H.` | dotted half | 1 |
| `EE` | two eighths on a beat | 2 |
| `Q.E` | dotted quarter + eighth (simple meter) | 3 |
| `rE`, `Er` | eighth rest + eighth, eighth + eighth rest | 3 |
| `tieBar` | tie across a barline | 3 |
| `pickup` | anacrusis | 3 |
| `C.Q`, `C.QE`, `C.EQ`, `C.EEE`, `C.Qr.` | compound beat: dotted quarter, quarter-eighth, eighth-quarter, three eighths, dotted-quarter rest | 4 |
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
| `grace` | acciaccatura/appoggiatura (not graded) | 7 |
| `T` (32nd) | thirty-second notes | 8 |
| `T6S` | sextuplet sixteenths | 8 |
| `H..`, `Q..` | double-dotted values | 8 |
| `T5`, `T7` | quintuplets, septuplets | 9 |
| `hemiola`, `crossTie` | metric displacement across beats | 9 |
| any other | anything else (nested tuplets excluded from the corpus) | 10 |

### 2.3 Level table

"Leaps" are intervals of a 4th or larger. "Chromatic notes" are notes whose pitch class is outside the key signature (raised 6th/7th in minor count as chromatic at L2 to L4, as diatonic from L5). "NPS cap" is the peak notes per second in any one-beat window at the chosen tempo. Tempo is in beats per minute where the beat is as defined in the conventions.

| Feature | L1 | L2 | L3 | L4 | L5 | L6 | L7 | L8 | L9 | L10 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Meters | 4/4, 3/4 | + 2/4 | 2/4, 3/4, 4/4 | + 6/8, 2/2 | + 3/8, 3/2 | + 9/8, 12/8 | + 5/4, 5/8, 6/4 | + 7/8, meter changes | any incl. 7/4, 11/8 | any |
| Rhythm cells | L1 set | + `EE` | + `Q.E`, rests on &, ties over bar, pickups | + compound cells, `SSSS` | + `EQE`, `ESS`, `SSE`, `tieBeat` | + `E.S`, `T3E`, `SES` | + `S-sync`, `T3Q`, grace | + 32nds, sextuplets, double dots | + quint/septuplets, hemiola | all |
| Max melodic interval | M3 | P5 | P8 (leaps on tonic/dominant triad only) | P8 | m7 (P8 allowed) | P8, any quality | M9 | P12 | any in range | any |
| Max leaps per 4 bars | 2 | 4 | 6 | 8 | 10 | 12 | no limit | no limit | no limit | no limit |
| Range tier | A | A | B | B | C | C | D | D | E | E |
| Max key-signature accidentals (abs fifths) | 1, major only | 1, + relative minors | 2 | 3 | 4 | 5 | 6 | 7 | 7 | 7 |
| Modes | major | major, natural/harmonic minor | major, minor | major, minor | + melodic minor, dorian, mixolydian | + all church modes | + tonicizations/modulation | chromatic | chromatic, whole-tone fragments | free tonality |
| Chromatic notes per 4 bars | 0 | 0 (raised 7th in minor allowed) | 1 | 2 | 3 | 5 | 8 | 12 | no limit | no limit |
| Double sharps/flats | no | no | no | no | no | no | no | yes | yes | yes |
| Tempo range (bpm) | 60–76 | 60–84 | 66–92 | 66–100 | 72–112 | 72–120 | 80–132 | 80–144 | 88–160 | 92–176 |
| NPS cap | 2.0 | 3.0 | 3.5 | 4.5 | 5.0 | 6.0 | 6.5 | 7.0 | 8.0 | 8.0 |
| Articulations shown | none | slurs, ties | + staccato, accent | + tenuto, hairpins, p/mp/mf/f | + marcato, fp, sfz, pp/ff | + trills, fermata | + grace notes, tempo words | + rit./accel. text (metronome stays fixed) | any | any |
| Clefs | primary | primary | primary | primary | + viola treble | primary + secondary as listed in 1.3 | + tenor clef (cello, bassoon, trombone), horn bass clef | + euphonium tenor clef | + cello treble, bass tenor/treble | any of the instrument's clefs |
| Bars | 8 | 8 | 8–10 | 8–10 | 8–10 | 8–12 | 8–12 | 8–12 | 8–12 | 8–12 |
| Default scan time (s) | 30 | 30 | 30 | 30 | 45 | 45 | 45 | 60 | 60 | 60 |

Notes:
- The 8.0 NPS cap at L9–L10 is a detector limit, not a musical one: notes shorter than ~125 ms cannot be segmented reliably by an ear-to-staff-style segmenter (45 ms onset confirmation plus 70 ms minimum note). The architect owns the real number; if it moves, these caps move.
- The tempo for a given excerpt is clipped so that peak NPS ≤ cap. If the clipped tempo falls below the level's minimum tempo, the excerpt is not eligible for that level at that tempo setting.
- Compound meters at L4 to L5 are counted in dotted-quarter beats at 40–66 bpm (i.e., the tempo row applies to the eighth-note pulse divided by 3; the tagger converts). 3/8 at L5 is counted in eighths.
- Wind, brass, and voice extra rule (breath): at L1–L4 the excerpt must contain a rest, a fermata, or a phrase end (long note ≥ 1 beat followed by a new phrase) at least every 4 bars; at L5+ at least every 12 seconds at the chosen tempo. Excerpts failing this are excluded for those families, not re-leveled.

### 2.4 Excerpt tag record (input from the researcher's pipeline)

The researcher (03) owns the corpus schema; this is the subset grading and selection need. Instrument-independent features are stored once per excerpt; range and clef are computed at selection time.

```json
{
  "excerptId": "telemann-fantasia-03-m1-b9-16",
  "source": { "work": "...", "composer": "...", "license": "CC0", "edition": "..." },
  "bars": 8,
  "meter": ["3/4"],
  "pickupBeats": 1,
  "concertKey": { "fifths": -2, "mode": "major" },
  "modes": ["major"],
  "rhythmCells": ["Q", "EE", "Q.E", "H."],
  "maxIntervalSemis": 7,
  "leapsPer4BarsMax": 3,
  "chromaticPer4BarsMax": 1,
  "doubleAccidentals": false,
  "spanSemis": 12,
  "lowestConcert": 62,
  "highestConcert": 74,
  "peakNotesPerBeat": 2,
  "articulations": ["slur", "staccato"],
  "tuplets": [],
  "breathMaxGapBars": 4,
  "cadenceEnd": "PAC",
  "familiarity": 0,
  "featureLevels": { "meter": 1, "rhythm": 3, "interval": 2, "leaps": 1, "key": 2, "chromatic": 3, "articulation": 3 },
  "baseLevel": 3
}
```

`familiarity`: 0 = obscure, 1 = known to musicians, 2 = widely recognizable tune. Familiarity-2 excerpts are allowed in unranked practice only, because a known tune is played by ear, not read.

## 3. Excerpt quality and cutting rules

### 3.1 What makes a good sight-reading excerpt

1. It is a complete musical thought: starts at a phrase beginning, ends on a cadence.
2. It has a clear pulse and a clear tonal centre at L1–L6.
3. It rewards reading ahead: patterns (sequences, scales, arpeggios) that a reader can chunk, plus at least one "event" (a leap, an accidental, a rhythm change) worth spotting during the scan.
4. It is idiomatic for single-line performance: no implied second voice that needs simultaneous notes, no wide arpeggiated figures that are really keyboard chords (exclude for winds at L1–L6 if more than 25% of intervals are leaps).
5. It is not trivially repetitive: no bar repeated literally more than twice in a row; at least 5 distinct pitch classes at L3+ (3 at L1, 4 at L2); at least 2 distinct rhythm cells at L2+.
6. Rests total ≤ 25% of the excerpt's duration; no rest longer than one bar (no multi-bar rests).
7. It is not famous (familiarity < 2 for ranked play).

Good sources (researcher confirms licensing): folk-song collections, hymn and chorale melodies (top line), Baroque and Classical solo and orchestral melodies, and especially public-domain pedagogical etudes and solfège books (for example Concone and Panofka vocalises, Dannhauser solfège, Wohlfahrt and Kayser for strings, Ferling and Klosé for winds, Arban and Kopprasch for brass, Bona rhythm studies). Orchestral first-violin, flute, and cello lines from 18th and 19th century works give upper levels.

### 3.2 Cutting rules for 8 to 12 bars

The cutter proposes windows; a window is accepted only if it passes all hard rules and scores well on the soft rules.

Hard rules:
- H1. Start at a phrase start: bar 1 of a piece or section, or the first note after a rest, a fermata, a double bar, or a cadence. If the phrase begins with a pickup, include the pickup and count it as part of bar 0 (not toward the 8 to 12).
- H2. End on a cadence: the last note falls on a strong beat (beat 1, or beat 3 in 4/4, or beat 4 in 6/8) and is at least one beat long or followed by a rest; it is scale degree 1 (PAC/IAC) or, at L5+, degree 5 or 2 over an implied dominant (HC). L1–L4 require ending on degree 1 or 3.
- H3. Length 8 to 12 full bars (plus pickup). Prefer 8 at L1–L5 and when the source phrase structure is 4+4.
- H4. No cut inside a tie, slur, tuplet, beam group, trill, or grace-note group.
- H5. No cut inside a sequence: if bars k and k+1 repeat a melodic shape transposed, the window may not end between them.
- H6. If the last bar is incomplete in the source (final bar of a piece balancing a pickup), keep it as written; the renderer shows it as is.
- H7. A key or meter change inside the window is allowed only at L7+ (key) and L8+ (meter).

Soft rules (score 0 to 1 each, keep windows with mean ≥ 0.6):
- S1. Phrase symmetry: 4+4 or 4+4+4 phrase lengths score 1; 5+3 or ragged 0.5.
- S2. Contour: highest note not in the first bar; a single climax scores 1.
- S3. Tonal closure: first and last note in the tonic triad scores 1.
- S4. Variety: distinct rhythm cells ≥ 3 scores 1 (L1: ≥ 2).
- S5. Event density: at least one level-defining feature (leap, accidental, new rhythm cell) appears in bars 3 to 7, so the scan has something to find.

Allowed transformations (applied by the pipeline, tagged on the excerpt):
- Transposition to any key permitted by the level and the player's key setting, plus whole-octave displacement of the entire excerpt to fit the range band. Never displace part of an excerpt.
- Rhythmic augmentation or diminution by exactly 2 with matching meter renotation (2/4 in eighths to 2/2 in quarters, 3/8 to 3/4). The result is re-tagged.
- Removal of ornaments (trills, grace notes, turns) for target levels below the ornament's level. The principal note stays.
- Removal of dynamics and articulations below the level where they are introduced.
- Re-spelling enharmonically when transposition creates double accidentals below L8 or keys beyond 7 accidentals (pick the enharmonic key with fewer accidentals).
- No other note changes. If an excerpt only fits after changing notes, it does not fit.

Transposition preferences when the key setting is "random":
- Choose uniformly from keys allowed at the level, then weight by instrument idiom: strings and guitar weight sharp written keys ×1.5; concert-B♭/E♭/F instruments weight written keys with ≤ 2 accidentals ×1.5 at L1–L4. Do not pick the same written key in more than 2 consecutive exercises.

## 4. Grading rubric

### 4.1 Inputs and alignment

The grading engine receives the score (list of written notes with expected onset in beats, duration in beats, written MIDI, spelling, tie and articulation flags) and the performance (list of detected note events: onset seconds, offset seconds, median MIDI as a fractional value, per-frame pitch track). Everything is compared in **concert pitch** after subtracting `semis`.

Alignment (architect implements; these are the musical constraints):
- Expected onset time of note i = count-in end + beatIndex × beatSec, corrected for output and input latency (architect measures latency; pedagogy needs onset error accuracy within ±20 ms after correction).
- A played event may match score note i if its onset is within the match window `W_i = min(max(250 ms, 0.5 beat), 0.5 × min(IOI to previous, IOI to next))` but never less than 80 ms. Within the window, prefer the candidate with the correct pitch, then the nearest onset.
- Tied notes are one score note. Grace notes are not score notes; played events within 150 ms before a grace note's principal note are ignored. Trills: any pitch within the trill interval during the trilled note's duration counts as the principal note.
- Unmatched played events of ≥ 100 ms that are not during a written rest-tolerance zone are "extra notes".
- Score notes with no match are "missed".

### 4.2 Per-note credits

For each score note i (equal weight per note):

**Pitch credit p_i**
- Played nearest semitone equals the target: 1.
- Voice only: octave error (target ± 12): 0.5.
- Anything else, or missed: 0.
- The pitch of a played event is the median of the steady portion: exclude the first `attackExcludeMs` (voice 100, brass 80, winds 50, strings 50, keyboard and guitar 30) and the last 30 ms.

**Intonation credit n_i** (only if p_i = 1; fixed-pitch instruments skip this)
- dev = median cents from target over the steady portion, after the tuning offset (4.5).
- `n_i = 1` if |dev| ≤ goodCents; linear down to 0 at redCents; 0 beyond. Values in 4.4.

**Onset credit o_i** (if matched, regardless of pitch: a wrong note in the right place still earns rhythm credit)
- Δ = played onset − expected onset.
- `o_i = 1` if |Δ| ≤ tGood; linear to 0 at tBad; 0 beyond or missed.

**Duration credit d_i** (only for notes with written duration ≥ 1 beat, not staccato, not followed by a breath mark or rest at a phrase end; not graded for `keyboard` and `guitar`, whose sound decays)
- h = played duration / written duration.
- `d_i = 1` if h ≥ 0.70; linear to 0 at h = 0.35. Notes before a rest also count as fully held if h ≥ 0.55.

### 4.3 Components (each 0 to 100)

- **Pitch accuracy P** = 100 × Σp_i / (N + 0.5 × extras). Extras are penalized because playing during rests or adding notes is a reading error.
- **Intonation I** = 100 × mean n_i over notes with p_i = 1 (I = 100 if fewer than 3 such notes; component dropped for fixed-pitch families).
- **Rhythm R** = 100 × (0.8 × mean o_i + 0.2 × mean d_i over duration-graded notes). If no duration-graded notes, R = 100 × mean o_i.
- **Continuity C** = 100 × (matched notes / N) × max(0, 1 − 0.10 × stops). A stop is a silence ≥ max(1 beat, 600 ms) not covered by written rests or breath allowances, or a restart (the player re-plays already-matched material: two or more consecutive events that match earlier score notes better than the current ones).
- **Tempo stability T**: fit Δ_j (in beats) for all matched notes j against score position x_j (in bars) by least squares, Δ = a + b·x. Drift = |b| (beats per bar); jitter = standard deviation of residuals (beats). Requires ≥ 6 matched notes, else T = C.
  T = 100 × [0.6 × clamp(1 − drift / 0.10) + 0.4 × clamp(1 − max(0, jitter − 0.04) / 0.12)].
  A drift of 0.10 beat per bar (a full beat ahead or behind after 10 bars) zeroes the drift term.

### 4.4 Tolerances per level band and family

Timing (all families; keyboard and guitar use tGood − 10 ms because percussive onsets are sharper):

| Levels | tGood | tRed (shown red) | tBad (zero credit) |
| --- | --- | --- | --- |
| L1–L3 | max(60 ms, 0.12 beat) | max(100 ms, 0.20 beat) | max(150 ms, 0.30 beat) |
| L4–L6 | max(50 ms, 0.10 beat) | max(85 ms, 0.17 beat) | max(120 ms, 0.25 beat) |
| L7–L10 | max(40 ms, 0.08 beat) | max(70 ms, 0.14 beat) | max(100 ms, 0.20 beat) |

tBad is additionally capped at the match window W_i; a note matched beyond tBad gets o_i = 0 but is still drawn as a ghost at its real position.

Intonation (cents):

| Family | L1–L3 good / red | L4–L6 good / red | L7–L10 good / red |
| --- | --- | --- | --- |
| `voice` (relative, see 4.5) | 30 / 45 | 25 / 40 | 20 / 35 |
| `upper-strings`, `low-strings`, trombone | 25 / 40 | 20 / 35 | 15 / 30 |
| winds, `high-brass`, euphonium, tuba | 25 / 40 | 20 / 35 | 15 / 30 |
| beta instruments (tuba, double bass, bari sax) | 30 / 45 | 25 / 40 | 20 / 35 |
| `keyboard`, `guitar` | not graded | not graded | not graded |

Any |dev| > 50 cents means the nearest semitone is a different note, so it is a wrong pitch, not an intonation error.

### 4.5 Family differences

- **Fixed pitch (keyboard, guitar)**: no intonation component, no duration credit (decay), tighter timing. A wrong note is always a wrong key or fret. Guitar bends are not expected in excerpts.
- **Voice**: graded on relative pitch. Before the count-in the app plays the tonic triad and the starting note (sounding, in the singer's octave). A drift reference tracks the singer: reference offset = median dev of the last 4 correctly pitched notes, limited to ±50 cents from 0 and to a change of 15 cents per note. Pitch and intonation are judged against target + reference offset. Total drift (|final offset|) above 40 cents triggers the drift pattern (E23) but is not otherwise penalized. An "absolute pitch" toggle disables drift compensation (unranked).
- **Winds, brass, strings**: graded on absolute pitch relative to A4 (default 440, setting 415 to 446) plus the tuning offset. Tuning offset: the pre-performance routine includes an optional 3-second tuning note (concert B♭ for winds and brass, A for strings). If used, offset = measured deviation, capped at ±25 cents; otherwise offset = 0 and a whole-attempt median deviation beyond ±15 cents triggers E22 (tune your instrument) with intonation graded as measured.
- **Brass**: wrong partial (same valve or slide position, adjacent harmonic) is a wrong pitch for grading but is classified separately for tips (E16). Requires a fingering table per brass instrument (trumpet, horn F side, trombone positions, euphonium, tuba).
- **Clarinet**: wrong register (target ± 19, the 12th) is a wrong pitch, classified as E15.

### 4.6 Total score and grade

Weights (must sum to 1). Intonation weight grows with level, taken from pitch:

| Family | Levels | P | I | R | C | T |
| --- | --- | --- | --- | --- | --- | --- |
| continuous-pitch (all except keyboard, guitar) | L1–L3 | 0.45 | 0.05 | 0.30 | 0.10 | 0.10 |
| continuous-pitch | L4–L6 | 0.40 | 0.10 | 0.30 | 0.10 | 0.10 |
| continuous-pitch | L7–L10 | 0.35 | 0.15 | 0.30 | 0.10 | 0.10 |
| `keyboard`, `guitar` | all | 0.45 | 0 | 0.35 | 0.10 | 0.10 |

Score = round(Σ w × component), 0 to 100.

Gates:
- If matched notes / N < 0.5, the attempt is "incomplete": score is min(score, 50), no XP, does not count for level rules.
- If the microphone signal was unusable (architect's signal-quality flag, for example clipping or no voiced frames for 5 s after count-in), the attempt is "void": no score shown, no XP, prompt to fix input.

Letter grade and stars (stars are the compact display of the same thing; designer chooses where each appears):

| Score | Grade | Stars | Meaning |
| --- | --- | --- | --- |
| 97–100 | S | 3 + shine | performance-ready |
| 90–96 | A | 3 | excellent read |
| 80–89 | B | 2 | solid, minor slips |
| 70–79 | C | 1 | pass |
| 60–69 | D | 0 | rough, keep at this level |
| 0–59 | F | 0 | too hard right now |

Pass = C or better. Grade cutoffs are the same at every level; levels differ through features and tolerances.

### 4.7 Real-time verdicts (what the staff shows during play)

Each score note has a live state. These use the same thresholds as grading so the live display and the final grade never disagree.

| State | Rule | Staff behaviour (designer styles) |
| --- | --- | --- |
| `pending` | not yet reached | normal |
| `correct` | p = 1, |Δ| ≤ tRed, |dev| ≤ redCents | confirmed (green or check) |
| `early` / `late` | matched, |Δ| > tRed | original red; ghost drawn at the actual onset position, at the played pitch |
| `sharp` / `flat` | p = 1, |dev| > redCents | original red; ghost drawn at the same staff position with cents label (for example +38¢) and a direction mark |
| `wrong-pitch` | matched, p = 0 | original red; ghost drawn at the played pitch, spelled per the rule below |
| `missed` | no match by expected onset + W_i | original red, no ghost |
| `extra` | unmatched played event | ghost only, at its position and pitch |

States can combine (late + wrong pitch: one ghost, both flags). The live pitch verdict is provisional after 120 ms of steady pitch and final at note end; a note may move from `sharp` to `correct` if the player corrects within the note (the final grade uses the full steady portion median). Timing verdicts are final at onset.

Ghost-note spelling (pedagogically important, it shows the reading mistake):
- If the played pitch is within ±2 semitones of the target, spell it with the **target's letter** plus the needed accidental (target F♯, played F: show F♮; target B♭, played B: show B♮). This makes missed accidentals and key-signature misses visible.
- Otherwise spell it by the key signature (sharps in sharp keys, flats in flat keys), as ear-to-staff `noteName` does.

### 4.8 Grading acceptance criteria

Implementers must ship synthetic-performance tests (generated event lists, no audio) that pass:

1. Perfect performance (all onsets exact, pitches exact) at any level: every component 100, score 100, grade S.
2. All onsets 30 ms late at L1, 80 bpm: R = 100, T = 100.
3. All onsets late by exactly tBad: R ≈ 20 (duration part only), every note `late`.
4. A 0.15 beat-per-bar linear drift over 8 bars at L4: T ≤ 45 and pattern E1 or E2 fires.
5. Every F♯ (from key signature, D major) played as F♮: P drops by the share of F♯ notes, ghosts spelled F♮, pattern E12 fires.
6. A 2-beat silence in bar 5 not covered by rests: C reduced by 10 points times matched fraction, one stop counted, E6 fires.
7. Voice performance uniformly 30 cents flat with drift compensation on: I ≥ 90 after the first 4 notes.
8. Trumpet playing written G5 instead of written C6 (same open fingering): wrong pitch, classified E16.
9. Fewer than half the notes matched: score ≤ 50, attempt marked incomplete.
10. Same fixtures produce identical scores on web and iOS (grading is deterministic and config-driven).

## 5. Progression

Two separate measures: **level** (per instrument, what you are reading now) and **XP and rank** (per player, effort and skill over time, across instruments).

### 5.1 Placement

- New instrument: offer a 3-excerpt placement (start L2; next excerpt L+2 if score ≥ 85, L−1 if < 60, same if between; final level = highest level with score ≥ 75, minimum L1) or let the player choose a level directly.
- Placement attempts earn XP normally.

### 5.2 Ranked vs practice attempts

An attempt is **ranked** if all of: first time this player sees this excerpt on this instrument; scan time not exceeded by more than 30 s; tempo ≥ 90% of the level's minimum tempo; metronome or count-in-only mode; not an "absolute pitch off" voice toggle; not familiarity 2. Everything else is practice: graded and shown, earns 25% XP, does not count toward level rules. Repeating an excerpt is valuable practice but it is no longer sight reading.

### 5.3 XP per attempt

XP = round(base(L) × q(S) × m_tempo × m_random × m_mode × m_streak × m_daily), ranked attempts only (practice = 25% of this).

- base(L) = 6 × L + 4 (L1 = 10, L5 = 34, L10 = 64).
- q(S) = 0 if S < 30, else S / 100.
- m_tempo = clamp(chosen tempo / level mid tempo, 0.75, 1.30). Level mid tempo = midpoint of the level's tempo range.
- m_random: +8% for each of key, meter, tempo set to "random" (difficulty "random" picks level L−1 to L+1 and XP uses the served level; it does not add a bonus). Cap 1.25. Rationale: random settings remove the comfort of choosing a known key or meter.
- m_mode: metronome on 1.00; count-in only (inner pulse) 1.10, available from L4.
- m_streak = 1 + 0.02 × min(streakDays, 10) (max 1.20). A streak day is a calendar day (local time) with at least 3 ranked attempts on any instrument. Missing one day breaks the streak; one "rest day" freeze is earned per 7-day streak (max 2 banked).
- m_daily = 1.0 for the first 40 ranked attempts per instrument per day, 0.5 after.

The 0 to 100 score itself is never modified by settings; only XP is.

### 5.4 Rank

Rank requires both XP and a minimum current level on at least one instrument, so rank reflects reading skill, not just volume.

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

Rank never goes down. XP is cumulative and never decreases. Each instrument also shows its own level badge.

Pacing check: a player at L5 averaging S = 85 with no bonuses earns ~29 XP per attempt; 12 attempts per day reaches Ensemble player (5,000) from Section player (2,500) in about 7 to 8 days of practice, which is the intended pace.

### 5.5 Level-up and level-down (per instrument)

Evaluated after each ranked attempt, over the last ranked attempts at the current level:

- **Level up offer**: in the last 5 ranked attempts at level L, at least 4 scored ≥ 85 and the mean is ≥ 85. Player can accept or stay. Declining suppresses the offer for 5 attempts.
- **Auto level up**: 8 consecutive ranked attempts ≥ 90 at L.
- **Level down suggestion**: in the last 5 ranked attempts at L, mean < 60 or 3 or more below 55. Player can accept or stay.
- **Auto level down**: never. The player always keeps control of moving down; struggling players get a suggestion and an encouraging tip instead.
- Manual level change is always allowed. After a manual change the window resets.
- Stretch excerpts count toward level L.

### 5.6 Stored progress shape

```json
{
  "playerId": "local-uuid",
  "xp": 4210,
  "rank": 4,
  "streak": { "days": 6, "lastDay": "2026-11-18", "freezes": 0 },
  "instruments": {
    "trumpet-bb": {
      "level": 5,
      "window": [88, 91, 79, 86, 90],
      "attemptsRanked": 142,
      "bestByLevel": { "4": 98, "5": 91 },
      "patternCounts": { "E12": 9, "E16": 14, "E1": 4 },
      "tuningOffsetCents": -8
    }
  },
  "recentTips": ["U08", "HB01", "U02"],
  "configVersion": "grading-1.0.0"
}
```

Backend: none needed for v1 (local persistence). A backend becomes necessary only for cross-device sync, global or friends leaderboards, and teacher dashboards. Global leaderboards must only rank ranked attempts and need anti-cheat (server re-grading from uploaded event lists); that is out of scope for v1.

## 6. Tips system

### 6.1 Flow

1. After grading, the pattern detector evaluates every pattern in 6.2 against the attempt's per-note results.
2. Each firing pattern gets `lostPoints`: the score points attributable to its notes (Σ over its notes of component weight × (1 − credit) × 100 / N, for the components the pattern concerns).
3. Tip choice: highest lostPoints pattern with lostPoints ≥ 2. Prefer the instrument-family tip for that pattern over the universal tip if one exists. Skip a tip shown in the last 3 tips for this player; take the next variant or the next pattern.
4. Show at most 2 tips between exercises (one primary, one secondary only if its lostPoints ≥ 4). Show a positive tip (U18) if nothing fires.
5. Patterns accumulate in `patternCounts`. If the same pattern is primary in 3 of the last 5 attempts, the session summary shows a "focus" card for it (designer), and the selector may bias the next excerpts toward that feature at the current level (for example more dotted rhythms) — config `remedialBias = 0.3`.
6. Session summary (after the player ends a session or every 10 attempts): top 3 patterns of the session with tips.

Tip record:

```json
{ "id": "HB01", "family": "high-brass", "instruments": ["trumpet-bb", "horn-f"], "pattern": "E16",
  "condition": "count >= 2", "minLevel": 1, "maxLevel": 10, "priority": 2,
  "text": "...", "drill": { "type": "replay-bars", "bars": "pattern", "tempoFactor": 0.75 } }
```

`drill` is optional: the UI may offer "practice these bars slower" (unranked).

### 6.2 Error pattern taxonomy

All rules are evaluated per attempt. "Beat" units are fractions of the beat. Minimum evidence prevents firing on one stray note.

| Id | Pattern | Detection rule | Min evidence |
| --- | --- | --- | --- |
| E1 | Rushing | drift b < −0.04 beat/bar, or mean Δ < −0.08 beat | ≥ 8 matched notes |
| E2 | Dragging | drift b > +0.04 beat/bar, or mean Δ > +0.08 beat | ≥ 8 matched notes |
| E3 | Rushing subdivisions | in runs of ≥ 3 eighths or sixteenths, played IOI < 0.85 × written | ≥ 2 runs |
| E4 | Hesitation at barlines | mean Δ of beat-1 notes exceeds mean Δ of other notes by ≥ 0.12 beat | ≥ 3 bars |
| E5 | Hesitation before leaps | mean Δ of notes after a leap ≥ P5 exceeds others by ≥ 0.12 beat | ≥ 3 leaps |
| E6 | Stops or restarts | stops ≥ 1 (see C in 4.3) | 1 |
| E7 | Dotted quarter-eighth evened | for `Q.E`: played long:short ratio < 2.2 (written 3:1) | ≥ 2 figures |
| E8 | Dotted eighth-sixteenth as triplet or even | for `E.S`: played ratio < 2.4 | ≥ 2 figures |
| E9 | Rests not counted | notes after a rest have mean Δ ≤ −0.12 beat, or extras during rests | ≥ 2 |
| E10 | Syncopation flattened | syncopated notes (`EQE`, `S-sync`, tied-over-beat) with Δ moving them ≥ 0.15 beat toward the beat | ≥ 2 |
| E11 | Triplet distortion | in `T3E`/`T3Q`, played IOIs deviate from equal by > 25% | ≥ 2 groups |
| E12 | Key-signature misses | wrong pitch where played = target with the key-signature accidental removed (or applied when not written) | ≥ 2 notes or ≥ 30% of such notes |
| E13 | Missed written accidentals | wrong pitch where played = target without its explicit accidental | ≥ 1 at L3–L5, ≥ 2 at L6+ |
| E14 | Accidental carry errors | later note in same bar, same staff position, played without the carried accidental; or note in the next bar played with it | ≥ 1 |
| E15 | Octave or register errors | played = target ± 12 (clarinet: ± 19) | ≥ 1 |
| E16 | Wrong partial (brass) | played and target share the same valve/slide fingering, adjacent harmonic | ≥ 1 |
| E17 | Leap inaccuracy | wrong-pitch rate on notes after leaps ≥ P4 is ≥ 2 × rate elsewhere | ≥ 2 wrong after leaps |
| E18 | Ledger-line misreads | wrong pitch on notes with ≥ 2 ledger lines, error is 1 or 2 diatonic steps | ≥ 2 |
| E19 | Clef confusion | in alto or tenor clef (or bass clef for horn), wrong pitches consistent with reading in the instrument's primary clef | ≥ 2 |
| E20 | Out of tune high register | mean dev of notes in top 25% of excerpt range ≤ −15¢ (flat) or ≥ +15¢ (sharp) | ≥ 3 notes |
| E21 | Out of tune low register | same for bottom 25% | ≥ 3 notes |
| E22 | Overall tuning offset | whole-attempt median dev beyond ±15¢ (no tuning note used) | ≥ 6 notes |
| E23 | Pitch drift (voice) | |reference offset at end| > 40¢ | ≥ 8 notes |
| E24 | Unstable sustain | within-note pitch SD > 25¢ after removing regular vibrato (4–7 Hz component) on notes ≥ 1 beat | ≥ 2 notes |
| E25 | Slow response low register | Δ on bottom-25% notes ≥ 0.10 beat later than other notes | ≥ 3 notes |
| E26 | Dense passages break down | mean per-note credit in the densest 25% of beats is ≥ 25 points below the rest | ≥ 4 dense beats |
| E27 | Fading at the end | last third mean per-note credit ≥ 20 points below first third | excerpt ≥ 8 bars |
| E28 | Pickup error | pickup note missed, or its |Δ| > tRed | 1 |
| E29 | Late first entry | first note Δ > tRed (and not a pickup) | 1 |
| E30 | Clean read | score ≥ 90 and no other pattern fired | — |
| E31 | Clarinet break errors | wrong pitch or late onset on notes crossing written B♭4/B4 (70/71) | ≥ 2 crossings |
| E32 | Long notes cut short | d_i < 0.5 | ≥ 2 notes |
| E33 | Long-position sharpness (trombone) | mean dev ≥ +15¢ on notes in positions 5 to 7 | ≥ 3 notes |
| E34 | Valve-combination intonation | mean dev ≥ +15¢ on notes using 1-3 or 1-2-3 (trumpet, euphonium, tuba) | ≥ 2 notes |
| E35 | Shift intonation (strings) | |dev| ≥ 20¢ on the first note after a position shift (shift table per instrument, or approximate: interval ≥ P4 on the same string region) | ≥ 2 notes |

### 6.3 Universal tips (all families)

| Id | Trigger | Tip |
| --- | --- | --- |
| U01 | E1 | You finished ahead of the click. Rushing usually comes from excitement and short notes. Let every long note take its full value, and feel the click land on every beat, not only beat 1. |
| U02 | E2 | You fell behind the click. Dragging means your eyes are too close to your sound. Keep your eyes at least one beat ahead, and keep moving when a note goes wrong: a wrong note on time beats a right note late. |
| U03 | E3 | Runs of short notes got faster. Subdivide in your head ("1-e-and-a") and place each group against the click rather than letting the fingers lead. |
| U04 | E4 | You paused at barlines. Read across them: before you reach the end of a bar, your eyes should already be on the first note of the next bar. |
| U05 | E5 | You hesitated before leaps. Spot leaps during the scan and decide the landing note before you start, so the leap is already solved when you reach it. |
| U06 | E6 | You stopped. In sight reading the beat is the boss. If you get lost, drop notes, find the next downbeat, and come back in. Count "1" on every downbeat so you always know where to re-enter. |
| U07 | E7 | Dotted quarter and eighth came out even. It is long-short, 3 to 1. Count "1-and-2-and" and put the eighth on the "and" of 2. |
| U08 | E8 | Dotted eighth and sixteenth is not a triplet. The sixteenth sits right against the next beat: count "1-e-and-a" and put it on "a". |
| U09 | E9 | You came in early after rests. Rests are counted silence. Keep counting through them and use the rest to prepare (breath, bow, hand) so the entry lands on time. |
| U10 | E10 | Syncopated notes slid onto the beat. Feel the beat under the note: tap your foot on the beats and let the syncopation sit between taps. |
| U11 | E11 | Triplets were uneven. Say "tri-pl-et" evenly across one beat, and land the next beat exactly on the click. |
| U12 | E12 | Notes from the key signature were missed (for example F instead of F♯). Before you start, name the key and its altered notes out loud ("D major: F♯ and C♯"). |
| U13 | E13 | Written accidentals were missed. During your scan, find every accidental before you play a note. |
| U14 | E14 | An accidental lasts until the barline, for every note on that line or space, and the barline cancels it. Watch for both: keeping it through the bar and dropping it after. |
| U15 | E17 | Wrong notes clustered after leaps. Read leaps as intervals, not letter names: line to line is a 3rd, line to the next-but-one line a 5th. Hear or feel the interval before you play it. |
| U16 | E18 | Ledger-line notes tripped you up. Learn landmark notes (middle C, the C two ledger lines above the treble staff) and read ledger notes as steps from the landmark. |
| U17 | E26 | Busy passages lost accuracy. Look for shapes: scales, arpeggios, repeated figures. Read a shape as one unit instead of note by note. |
| U18 | E30 | Clean read. Try the next one 8 bpm faster, or take a stretch excerpt at the next level. |
| U19 | E27 | Accuracy dropped near the end. Glance at the last line during your scan so the ending is not a surprise, and keep the same focus to the double bar. |
| U20 | E28, E29 | The first note was late. Prepare on the last count-in beat (breathe, set the bow, place the hand) so sound starts exactly on beat 1. Look at the pickup during the scan. |
| U21 | E32 | Long notes were cut short. Count through every long note and release on the next beat, not before. |
| U22 | E22 | You were about {offset} cents {sharp/flat} throughout. Use the tuning note before the next exercise. |
| U23 | E19 | Clef reading: find the clef's anchor note first (alto clef: middle line is middle C; tenor clef: 4th line is middle C) and read by step from it. |

### 6.4 Instrument-family tips

Each tip applies when its pattern fires on an attempt by an instrument in the family (and the extra condition, if given, holds).

#### Voice (`voice`)

| Id | Trigger | Tip |
| --- | --- | --- |
| VO01 | E20 flat | High notes went flat. Keep breath flowing and the mouth space tall as you go up; think lighter, not harder, and keep the chin level. |
| VO02 | E23 | Your pitch sank slowly across the exercise. Keep "do" in your ear: re-hear the tonic silently at each rest, and keep vowels bright. |
| VO03 | E17 | Leaps missed. Connect each leap to a familiar sound: a 4th starts "Here Comes the Bride", a 5th starts "Twinkle Twinkle". Or sing through the chord silently (do-mi-sol) to find the top. |
| VO04 | E12, E13 | Chromatic notes: use solfège. Sharps raise (fi, di, si), flats lower (te, le, me). A raised note usually wants to resolve up; hear the pull. |
| VO05 | E24 | Long notes wavered. Support from the low ribs and narrow the vibrato while sight-singing until the pitch centre is secure. |
| VO06 | E15 | You switched octaves mid-line. Stay in one register for the whole line. If a note is out of reach, find it in the scan and plan a lighter tone for it. |
| VO07 | E6 | You ran out of breath. Plan breaths at rests and phrase ends during the scan; take a quick low breath at every comma. |
| VO08 | E29, E25 | You slid up into notes. Hear the pitch before you sing it, and start the tone right on the note instead of scooping. |

#### Flute (`flute`)

| Id | Trigger | Tip |
| --- | --- | --- |
| FL01 | E20 sharp | High notes ran sharp. Aim the air slightly lower by relaxing the lips and dropping the jaw; use faster, narrower air rather than more air. |
| FL02 | E21 flat | Low notes sagged flat. Do not roll the flute in. Keep a relaxed, open aperture with slower, warm air. |
| FL03 | E15 | Notes cracked to the wrong octave. For low notes open the aperture and slow the air; for octave jumps change the lip direction, not the force. |
| FL04 | E25 | Low notes spoke late. Start the air a moment early and use a soft "doo" tongue instead of "tu". |
| FL05 | E13, E12 | Accidentals and key notes on flute often hide in B♭ and F♯. Choose thumb B♭ in flat keys and when no B naturals are near; decide in the scan. |
| FL06 | E6 | You stopped to breathe. Mark breaths in the scan, after long notes or before pickups, and take quick breaths through the corners of the mouth. |
| FL07 | E26 | Fast passages fell apart. Keep fingers close to the keys and let the air lead the line. |

#### Double reeds (`double-reed`: oboe, bassoon)

| Id | Trigger | Tip |
| --- | --- | --- |
| DR01 | E20 sharp | High notes were sharp. Do not bite: cushion the reed with the lips and let air speed, not jaw pressure, raise the note. |
| DR02 | E21 | Low notes were out of tune. Keep embouchure corners firm and air support up on low notes; do not let the jaw drop or the reed slip out. |
| DR03 | E25 | Low notes spoke late. Use a lighter tongue with the air already moving, and check that the reed is wet before each exercise. |
| DR04 | E15 | Wrong octaves usually mean a late octave key or half-hole (oboe) or a missed flick key (bassoon). Find register crossings in the scan and prepare early. |
| DR05 | E6 | Oboe uses very little air, so players run out of oxygen, not air. At rests, breathe out first, then in. Plan both in the scan. |
| DR06 | E19, instrument = bassoon | Tenor clef: the 4th line is middle C. Read up and down from that anchor. |
| DR07 | E26, instrument = oboe | Fast passages with F: pick left F or forked F during the scan so the fingering is decided before you play. |

#### Clarinet (`clarinet`)

| Id | Trigger | Tip |
| --- | --- | --- |
| CL01 | E31 | Notes crossing the break failed. Keep right-hand fingers down when crossing up, and keep the air steady; do not pinch on the way up. |
| CL02 | E15 | Squeaks or 12th jumps: cover the tone holes completely and check the thumb is not leaking at the register key. |
| CL03 | E20 sharp | Upper notes were sharp. Do not bite; firm the corners and keep the tongue in an "ee" position with fast air. |
| CL04 | E21 sharp, notes written G4–B♭4 | Throat tones ran sharp and thin. Add right-hand resonance fingers on throat A and B♭. |
| CL05 | E26 | Fast passages tangled the pinkies. In the scan, find runs that need alternating left and right little-finger keys and decide which side each note takes. |
| CL06 | E25 | Low chalumeau notes spoke late. Keep the throat open ("oh") and start the air before the tongue releases. |

#### Saxophone (`sax`)

| Id | Trigger | Tip |
| --- | --- | --- |
| SX01 | E20 sharp | High notes went sharp. Loosen the bite, drop the jaw slightly, and keep the air fast; palm-key notes especially tend sharp. |
| SX02 | E25, E21 | Low notes cracked or spoke late. Open the throat, keep the air steady and supported, and do not push harder. Take a touch less mouthpiece for low notes. |
| SX03 | E15 | Octave errors: the thumb octave key must be down for D and above. Prepare the thumb during the note before an octave crossing. |
| SX04 | E12, E13, note B♭ involved | B♭ fingerings: use bis B♭ in flat keys, side B♭ in chromatic lines, and 1-and-1 next to B naturals. Choose in the scan. |
| SX05 | E24, E29 | You scooped into notes. Jazz scoops cost points here. Start each note on its centre with a firm "tah". |
| SX06 | E18 | Palm-key notes (written D6 to F6) were misread. Learn them as steps above the high C at two ledger lines. |

#### High brass (`high-brass`: trumpet, horn)

| Id | Trigger | Tip |
| --- | --- | --- |
| HB01 | E16 | You landed on a neighbouring partial (same fingering, different note). Brass needs you to hear the pitch first. In the scan, hum or buzz the tricky intervals. |
| HB02 | E20 flat | High notes went flat. Use faster air and firm corners, not more mouthpiece pressure. |
| HB03 | E34, instrument = trumpet | Low D and C♯ (1-3 and 1-2-3) run sharp. Kick the third-valve slide out on those notes. |
| HB04 | E25 | Low notes spoke late. Keep the aperture relaxed and start the air before the tongue. |
| HB05 | E17 | Leaps missed. Daily lip slurs train these. Move the air, not the face, and hear the top note before you get there. |
| HB06 | E27, E6 | Your sound tired near the end. Take the mouthpiece off the lips at long rests, and breathe at every rest even when you do not need to. |
| HB07 | E16, instrument = horn | Horn partials are close together in the middle register, so wrong partials are common. Sing the line in your head before playing; adjust with the right hand in the bell. |
| HB08 | E19, instrument = horn | Bass clef for horn (new notation) is transposed just like treble clef: read the bass-clef note and finger it as written. Anchor on written C4 (one ledger line above the bass staff), the same note as middle C in treble. |

#### Low brass (`low-brass`: trombone, euphonium, tuba)

| Id | Trigger | Tip |
| --- | --- | --- |
| LB01 | E33 | Notes in long positions were sharp: you are not reaching far enough. Extend fully for 5th, 6th, and 7th position. |
| LB02 | E25, instrument = trombone | Notes after slide moves spoke late or smeared. Move the slide quickly at the last moment and use a soft "doo" tongue on legato changes. |
| LB03 | E16 | You hit a neighbouring partial. Hear the note before you play it, and in the scan check which partial each leap lands on. |
| LB04 | E25 | Low notes spoke late. Big horns need the air started before the beat; use more air, not more tongue. |
| LB05 | E2 | Low brass tends to drag because low notes take time to speak. Put the front of each note on the click, which feels slightly early. |
| LB06 | E19 | Tenor clef: the 4th line is middle C. On trombone, tenor clef notes sit around the same positions as your upper bass-clef notes. |
| LB07 | E34 | Valve combinations 1-3 and 1-2-3 run sharp. Use the 4th valve where you have one, or lip and slide the note down. |
| LB08 | E6 | You ran short of air. Plan full breaths at every rest; big instruments use air quickly. |

#### Upper strings (`upper-strings`: violin, viola)

| Id | Trigger | Tip |
| --- | --- | --- |
| US01 | E35 | Notes after shifts missed their pitch. Hear the target before you shift, and slide on the old finger to a guide note before placing the new one. |
| US02 | E12 | Key-signature notes were missed. Before you start, set the finger pattern for the key: high 2nd finger in sharp keys (F♯, C♯), low 2nd in flat keys. |
| US03 | E13 | Accidentals change finger spacing. A half step means fingers touching; a whole step means a gap. |
| US04 | E19, instrument = viola | Alto clef: the middle line is middle C. Treble clef appears for high passages; switch your anchor when the clef changes. |
| US05 | E26 | Fast string crossings fell behind. Keep the bow near the next string level and move the elbow ahead of the change. |
| US06 | E32 | Long notes ran out of bow. Plan bow use: save bow on short notes before a long note, and keep the bow speed even. |
| US07 | E22, E21 | Your open strings or first-position notes were out of tune. Tune with the app's tuning note before the next exercise, and check 3rd and 4th fingers against open strings. |

#### Low strings (`low-strings`: cello, double bass)

| Id | Trigger | Tip |
| --- | --- | --- |
| LS01 | E35 | Shifts landed off pitch. Shift on the old finger, release pressure while moving, and hear the target first. |
| LS02 | E12, instrument = cello | Sharp keys on cello need forward extensions. Find the F♯ and C♯ positions in the scan and decide where to extend. |
| LS03 | E19, instrument = cello | Tenor clef: the 4th line is middle C, usually played in thumb or 4th position. Anchor there and read by step. |
| LS04 | E25 | Low notes spoke late. Start the bow with weight and a small "catch" at the string, right on the beat. |
| LS05 | E32 | Long notes faded or stopped early. Plan bow distribution and keep the contact point steady for the full value. |
| LS06 | E21, E22, instrument = double bass | Bass intonation: check notes against open strings and natural harmonics. Small pitch errors are easier to hear an octave up, so listen for the upper partial. |
| LS07 | E2 | The bass sets the time for everyone. Keep each note's start on the click and avoid waiting for the sound to bloom. |

#### Keyboard, single line (`keyboard`)

| Id | Trigger | Tip |
| --- | --- | --- |
| KB01 | E17 | Leaps missed. Feel intervals by hand shape (a 5th is thumb to pinky in a five-finger position) and find the landing by touch, not by looking down. |
| KB02 | E4, E5, E6 | Hesitations often come from looking at your hands. Keep your eyes on the music and use the groups of two and three black keys as landmarks. |
| KB03 | E26 | Runs broke down. Decide fingering at position changes during the scan, including where the thumb passes under. |
| KB04 | E12 | Key-signature notes were missed. Before you start, rest fingers over the black keys of the key (D major: F♯ and C♯). |
| KB05 | E18 | Ledger-line notes were misread. Middle C is one ledger line below treble and one above bass; read outward from it. |
| KB06 | E9 | You played into rests. Piano notes keep sounding until you lift: release the key exactly on the rest. |
| KB07 | E1, E3 | Running notes rushed. Turn on subdivision clicks and keep fingers close to the keys so they do not race ahead. |

#### Guitar, single line (`guitar`)

| Id | Trigger | Tip |
| --- | --- | --- |
| GT01 | E12 | Key-signature notes were missed. Play the scale of the key in one position before you start, so the key's sharps or flats are part of the fingering pattern. |
| GT02 | E18 | Low ledger lines tripped you up. Learn the anchors: written C4 (one ledger line below the staff) is the 5th string, 3rd fret; written E3 is the open 6th string. |
| GT03 | E26, E4 | You hesitated on position changes. Choose one position that covers the excerpt's range during the scan and stay there if you can. |
| GT04 | E15 | You played an octave off. Guitar sounds an octave below written. Written middle C is the 5th string, 3rd fret, not the 2nd string, 1st fret. |
| GT05 | E32 | Long notes stopped early. Keep left-hand fingers down for the full value. |
| GT06 | E9 | Notes rang through rests. Mute the string with the right hand or release left-hand pressure exactly on the rest. |
| GT07 | E5, E6 | Hesitations often come from looking at the fretboard. Keep eyes on the page and use the fret dots in peripheral vision. |

Counts: 23 universal tips; every family has at least 6 tips (voice 8, flute 7, double reeds 7, clarinet 6, sax 6, high brass 8, low brass 8, upper strings 7, low strings 7, keyboard 7, guitar 7).

Tip writing rules for future additions: one actionable instruction per tip; ≤ 280 characters; names the error in the first sentence; no jargon above the level's vocabulary (no "anacrusis" below L5: say "pickup"); never blames the player.

## 7. Pre-performance routine

The UI guides a fixed routine. It is the biggest single thing that separates trained sight readers from untrained ones, so it is built into the flow, not hidden in help.

1. **Reveal and scan timer.** The excerpt is hidden until the player presses Start scan. The scan timer runs (default per level in 2.3; range 10 to 120 s in settings; ranked attempts allow up to the level default + 30 s). The player can end the scan early. Skipping or shortening the scan is never penalized.
2. **Scan checklist (STARS)**, shown as a compact checklist next to the music, ticked by the player or auto-ticked as time passes (designer decides interaction):
   - **S**ignatures: key (say the key and its sharps or flats) and time signature (what gets the beat, how many per bar).
   - **T**empo: the metronome marking and how one beat feels; hear the click before starting.
   - **A**ccidentals: find every accidental; note where the barline cancels them.
   - **R**hythms: find the hardest bar; tap or count it silently once.
   - **S**igns and shape: highest and lowest note, leaps, repeats, clef changes, dynamics, the ending.
3. **Prepare.** Finger, bow, or slide the hardest bar silently (winds and brass may finger without blowing). Singers get the tonic triad and starting pitch (section 4.5) and may hum it once. Winds, brass, and strings may play the optional tuning note (first attempt of a session, or any time from settings).
4. **Count-in.** Default 1 bar (2 bars at L1 to L3 and at tempos below 66 bpm). Compound meters count dotted-quarter beats with subdivision clicks at L4 to L5. The UI shows beat numbers during the count-in.
5. **During play, the UI encourages reading ahead**: the playhead or bar highlight (designer) should lead the eye, not trail it. Do not auto-scroll the page during play for excerpts that fit on one screen; 8 to 12 bars must fit on one screen on laptop and tablet landscape.
6. **After play.** Grade, per-bar heat map, top tips, then "next excerpt" as the primary action. "Try again" is secondary and explicitly marked practice.

## 8. Reuse from ear-to-staff

| Module | Verdict | Notes for this spec |
| --- | --- | --- |
| `js/theory.js` INSTRUMENTS | Adapt | Keep the `semis` and `diatonic` convention. Extend each entry with family id, clefs by level, full written range, and range tiers from 1.3 and 1.4. Its alto/tenor/bari ranges (58–90) match this spec; trumpet (52–94) is wider than our full range and should be narrowed. |
| `js/theory.js` `transposeKey`, `KEYS` | Reuse | Written-key gating needs both directions (concert to written and back). Add modes beyond major/minor for L5+. |
| `js/theory.js` `noteName`, `vexKey` | Replace for score notes | The score supplies spelling. Keep for ghost notes only as the fallback rule in 4.7. |
| `js/theory.js` `detectKey` | Reuse in corpus tooling | Useful for the researcher to verify mode and tonal centre of excerpts; not needed at runtime. |
| `js/pitch.js` McLeod | Reuse | Per-instrument `minFreq`/`maxFreq` from 1.3 sounding ranges (with a margin of 3 semitones). Clarity threshold is an architect parameter. |
| `js/segmenter.js` | Adapt | Onset/offset logic is a good base. Changes needed for grading: per-family `changeCents` (voice 80, strings and winds 60, fixed pitch 40) and `attackExcludeMs`; score-aware segmentation (knowing an expected note change is coming lets it split repeated notes on articulation, which plain level re-trigger misses). Its 70 ms minimum note sets the NPS caps in 2.3. |
| `js/notation.js` quantization | Replace for grading | Grading compares against the known score, so no quantization is needed. VexFlow rendering knowledge is reusable for the staff and ghost notes. |
| `js/app.js` metronome | Reuse pattern | The lookahead scheduler (schedule clicks 200 ms ahead on the audio clock) is right. Add accent on beat 1, optional subdivision, compound-meter grouping, and count-in-only mode. |
| `RANGE_PRESETS` in `js/app.js` | Replace | Superseded by per-instrument data in 1.3. |
| `js/musicxml.js` | Adapt | Excerpts are MusicXML; the `<transpose>` element handling is the same convention. |
| `js/history.js` record format | Adapt | The idea of a small JSON record of notes and settings per take maps to the attempt record; audio is never stored (same privacy choice). |

## 9. Attempt record (what grading emits)

```json
{
  "attemptId": "uuid",
  "excerptId": "telemann-fantasia-03-m1-b9-16",
  "instrument": "trumpet-bb",
  "level": 5,
  "settings": { "writtenKey": "D", "meter": "3/4", "tempo": 92, "random": ["key"], "mode": "metronome", "a4": 440 },
  "ranked": true,
  "scanSeconds": 38,
  "notes": [
    { "i": 0, "bar": 1, "beat": 1, "targetWritten": 74, "state": "correct", "deltaMs": 12, "cents": -6, "p": 1, "n": 1, "o": 1, "d": null },
    { "i": 1, "bar": 1, "beat": 2, "targetWritten": 78, "state": "wrong-pitch", "playedWritten": 77, "ghostSpelling": "F♮5", "deltaMs": 140, "p": 0, "o": 0.35 }
  ],
  "extras": [ { "onsetMs": 5120, "playedWritten": 72 } ],
  "components": { "P": 86, "I": 91, "R": 82, "C": 100, "T": 88 },
  "score": 87,
  "grade": "B",
  "patterns": [ { "id": "E12", "lostPoints": 6.1, "notes": [1, 9, 14] } ],
  "tipsShown": ["US02"],
  "xp": 33,
  "configVersion": "grading-1.0.0"
}
```

## Open questions

1. Detector floor: can the architect confirm reliable pitch and onset on built-in mics for sounding fundamentals below 70 Hz (tuba, double bass, bari sax, bassoon low register)? If not, those instruments ship with their low tier raised or stay beta.
2. Minimum gradable note duration: the NPS caps assume ~125 ms. The architect should measure with the metronome bleeding from the same speaker and confirm or move the caps.
3. Onset accuracy after latency compensation: tGood at L7+ is 40 ms. If measured onset jitter on phones is above ~25 ms, the L7–L10 timing tolerances need to widen by the measured amount.
4. Staccato and slurred articulation are shown but not graded. Is that acceptable for v1, or should a v1.1 grade tongued versus slurred onsets for winds and brass?
5. Should ranked mode lock the scan to the level default (strict, like an audition) or keep the current lenient +30 s?
6. Is the corpus large enough at L1–L2 for melodic, non-random material? Real repertoire this simple is scarce outside folk songs and method books. If not, does the overseer accept public-domain method-book melodies (which are composed but musical) as the L1–L2 bulk?
7. Voice drift compensation default on: does the owner agree that sight-singing is graded on relative pitch?
8. Familiarity tagging needs a human or a heuristic. Who tags familiarity 2 tunes?
9. Should XP and rank be per instrument rather than per player? This spec chooses per player XP plus per instrument level.
10. Web MIDI for keyboards in v1.1: in or out of scope?

## Dependencies on other roles

- **Technical architect (01)**: latency measurement and compensation to ±20 ms; a per-note event stream with onset, offset, median pitch, and frame track; per-family segmenter parameters (`changeCents`, `attackExcludeMs`, `minFreq`/`maxFreq`); a signal-quality flag for void attempts; deterministic grading module shared by web and iOS that reads `grading-config.json`, `levels.json`, and `tips.json`; local persistence of progress and attempt records; confirmation of NPS caps and low-frequency limits (open questions 1 to 3); metronome with accent, subdivision, compound grouping, and count-in-only mode; brass fingering and trombone position tables and string shift tables as data.
- **Music score researcher (03)**: corpus in MusicXML with the tag fields in 2.4; cutting according to 3.2 (hard rules must be enforced automatically, soft-rule scores stored); transposition and allowed transformations in 3.2; licensing per excerpt; familiarity tags; enough excerpts per level and meter (suggested minimum 150 ranked excerpts per level for melodic instruments, so a daily player does not see repeats for months); bass clef and alto/tenor clef coverage for low instruments.
- **Senior designer (04)**: visual language for the live states in 4.7 (confirmed, marginal, red, ghost with cents label, missed, extra); placement of ghosts at real onset positions without collisions; STARS scan checklist and scan timer; count-in display; grade screen with components, per-bar heat map, and at most 2 tips; level-up and level-down offers; rank and streak display; 8 to 12 bars on one screen without scrolling.
- **Senior iOS (05)**: same grading module and config files; same instrument data; iOS mic latency and input-processing behaviour reported so tolerances can be checked; any iOS-only feature (for example haptic metronome, which helps because it does not bleed into the mic) should be graded identically and flagged in the attempt record.
- **Overseer**: decisions on open questions 5, 6, 7, and 9; approval of the 10-level ladder as the single difficulty scale shared by selection, grading thresholds, XP, and tips.
