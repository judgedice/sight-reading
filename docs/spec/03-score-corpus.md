# 03 Score corpus: sources, ingestion, schema, transposition, licensing

Owner: music score researcher. Readers: the overseer and the implementers of `tools/corpus-build/` (Python pipeline), `src/corpus/` (runtime loader, selector, transposer), and the credits UI.

This section decides where the music comes from, how it becomes 8 to 12 bar excerpts, what the shipped files look like, how an excerpt is moved to the player's instrument and key, and what the app must show to stay legal. It conforms to the data model in `01-architecture.md` section 4 (`ExcerptDoc`, `CorpusManifest`, TPQ = 480, spelled pitches) and to the difficulty and cutting rules in `02-pedagogy-and-grading.md` sections 2 and 3. Where this section asks for a change to those types it says so in "Schema changes requested".

## 1. Summary of decisions

1. **The v1 licence allowlist is Public Domain, CC0 1.0, CC BY 3.0, and CC BY 4.0.** Anything NonCommercial, NoDerivatives, ShareAlike, GPL, ODbL, or "research only" is excluded from v1, even if the music itself is old. That keeps one licence regime across web and iOS, keeps the app free to charge money later, and avoids share-alike on the generated corpus.
2. **Two OpenScore corpora (CC0) are the backbone**: Lieder for vocal and lyrical lines, String Quartets for string lines and upper-level material.
3. **Lower levels (L1 to L4) come from public-domain method books, solfège books, hymn tunes, and folk-tune books.** The machine-readable versions of most of these carry restrictive licences (Essen, KernScores chorales, The Session) or unclear ones, so we take them from PDMX (CC0 and Public Domain Mark files only) or **encode them ourselves from public-domain printed editions** and release our encodings as CC0.
4. **Seed target: about 2,200 excerpts** across 10 levels (table in section 5), with hard coverage gates per instrument, level, and core meter.
5. **The corpus is built offline by a deterministic Python 3.12 + music21 pipeline** and shipped as static JSON shards. No backend is needed for the corpus in v1 or v2.
6. **Transposition is spelled (diatonic + chromatic interval), never MIDI-then-respell**, and the excerpt moves as a whole by key shift plus whole octaves. An excerpt that does not fit the range band without changing notes is rejected for that request, never edited.
7. **Every excerpt carries full attribution** (composer, dates, work, bars, source edition, encoder, corpus, licence, modifications). The exercise screen and a credits page show it.

## 2. What to reuse from ear-to-staff

Read: `README.md`, `js/theory.js`, `js/notation.js`, `js/musicxml.js`.

| Ear-to-staff piece | Verdict for the corpus | Why |
| --- | --- | --- |
| `theory.js` `KEYS` table (fifths/mode, 25 keys) | Reuse as data | Same key set the selector draws from. |
| `theory.js` `INSTRUMENTS` (`semis`, `diatonic`, written range) | Adapt | The written-minus-sounding convention (alto sax = {5, 9}) is the one we use. Ranges are replaced by the lead musician's tiered bands (02 section 1.4). |
| `theory.js` `transposeKey(key, semis)` | Replace | Works on key names by pitch class only. Corpus transposition needs a spelled interval so that every note's letter moves with the key. |
| `theory.js` `noteName`/`vexKey` (sharp-or-flat by key sign) | Replace for score notes, keep for ghost notes | Real excerpts have deliberate spellings (G♯ leading tone in A minor, chromatic passing tones) that must survive transposition. Spelling-by-key-sign is still right for ghost notes (architecture 6.x, `spellMidiInKey`). |
| `theory.js` `detectKey` (Krumhansl-Schmuckler) | Reuse in the pipeline only, as a cross-check | The source key signature plus final note is the primary key evidence; K-S flags mismatches (for example an excerpt cut from a modulating passage) for review. Port to Python or use music21's `analyze('key')`, which implements the same profiles. |
| `notation.js` 16th-note tick grid, quantizer | Do not use for corpus | The corpus is already metrical. Our grid is TPQ = 480 to represent triplets and dotted values exactly. |
| `musicxml.js` export | Not used by the corpus | The corpus is read from MusicXML, not written to it. An "export this excerpt as MusicXML" feature could reuse it later, carrying the attribution in `<identification>`. |
| `transcriptions/` record + `build-index.mjs` | Pattern only | The idea of hashed records plus a generated index is the same as our shards plus manifest. |

## 3. Candidate sources

Verification status: I could fetch github.com and raw.githubusercontent.com from this environment. `kern.humdrum.org`, `www.mutopiaproject.org`, and `zenodo.org` did not resolve (blocked by the session's network allowlist). Claims marked **verified** were read from the source's own licence file or README. **Partly verified** means read from a mirror or search result, not the primary page. **Unverified** means from my own knowledge, to be checked before ingestion (task C0 in section 12).

### 3.1 Source table

| Source | Licence of the encodings | Ship in app? | Format | Size | Quality | Serves | Fetch |
| --- | --- | --- | --- | --- | --- | --- | --- |
| OpenScore Lieder | CC0, **verified** (README, LICENSE.txt). Asks for credit plus a link as a courtesy, not a condition. | Yes | MuseScore `.mscx` in git; MusicXML and PDF on musescore.com; batch conversion via `mscore -j data/corpus_conversion.json` (**verified**, README) | "over 1,200" 19th-century songs per the 2022 paper cited in the README (**verified** as a quote; current count unverified) | High. Proofread transcriptions of first or early editions, with lyrics. | Voice (all ranges); any lyrical melodic instrument L4 to L8 | `git clone https://github.com/OpenScore/Lieder` at a pinned commit, convert with MuseScore 4 CLI |
| OpenScore String Quartets | CC0, **verified**. Same credit request. | Yes | `.mscx` | Count not stated on the page (unverified; expect on the order of 100 works) | High | Violin I/II, viola (alto clef), cello; upper levels L6 to L10 for any instrument after transposition | `git clone https://github.com/OpenScore/StringQuartets` at a pinned commit |
| PDMX (Long et al., UC San Diego, NeurIPS 2024) | Files selected because they carried CC0 or Public Domain Mark on MuseScore.com (**partly verified**, GitHub README and search). The dataset as a whole is described as CC BY (search results; **unverified**, Zenodo blocked). 12.29% of songs (31,221) have conflicting licence metadata; authors recommend the `no_license_conflict` subset (**verified**, README). | Yes, gated: only `no_license_conflict` files whose public licence is CC0 or PDM, and only after our own PD check of the composition (section 9.2) | MusicXML, MXL, plus MusicRender JSON with metadata | More than 250,000 scores (**verified**); about 222,856 in `no_license_conflict` (search, partly verified) | Very uneven: user uploads, many arrangements of copyrighted songs mislabelled PD, duplicates, and errors. Has user ratings in metadata (unverified field name). | Mining PD method books and etudes (Wohlfahrt, Kayser, Ferling, Concone, Arban, Kopprasch) that users have typeset | Zenodo record 15571083 (needs `zenodo.org` allowlisted) |
| Mutopia Project | Per piece: Public Domain, CC BY (1.0 to 4.0), CC BY-SA (1.0 to 4.0), or legacy MutopiaBSD (**partly verified**, ibiblio mirror of `legal.html` via search). Source editions must be PD. | Yes for PD and CC BY pieces; no for BY-SA and MutopiaBSD in v1 | LilyPond `.ly` (**verified**, GitHub README); site also serves PDF and MIDI | About 2,000+ pieces (unverified) | High engraving quality; LilyPond to MusicXML conversion is lossy | Solo Baroque lines (Bach cello suites, flute works, Telemann), some etudes, Classical solos | `git clone https://github.com/MutopiaProject/MutopiaProject` (layout `ftp/<composer>/<opus>/<movement>`, **verified**); licence is in each `.ly` header (`license = ...`, unverified field name) |
| Essen Folksong Collection (kern, via CCARH GitHub and KernScores) | **Verified restrictive**: "personal use (single-user) only", academic research, and "under no circumstance is the data to be embedded or included in teaching materials." No commercial derivative editions. | **No** | Humdrum `**kern`, also EsAC | 6,249 songs (**verified**, index) | Good for research; monophonic folk songs | Would have been ideal for L1 to L4 | Do not fetch for the product |
| Essen subset in music21 (ABC by Seymour Schlien) | **Verified**: legal status "unclear"; permission for non-commercial distribution within music21 only | **No** | ABC | 30 files | - | - | - |
| KernScores (kern.humdrum.org) and humdrum-data mirrors | Per collection. `craigsapp/bach-370-chorales` is CC BY-NC-SA 4.0 (**verified**). The humdrum-data README says each repository carries its own licence in `.info` files (**verified**); KernScores' own terms unverified (site blocked). Many MuseData-derived files are non-commercial (unverified). | **No by default.** Per-repository opt-in only where the licence file says CC0 or CC BY. | `**kern` | Large (thousands of files) | High | Chorales, Classical keyboard, folk | Only after C0 verifies a specific repository's licence |
| music21 bundled corpus | **Verified**: corpus is separate from the BSD code; "there may be restrictions on commercial use"; per-directory licences apply | **No as a bundle.** Individual directories only after their licences are checked. | Mixed (MusicXML, kern, ABC, MIDI) | Hundreds of works | Mixed | Ryan's Mammoth (1883), O'Neill's 1850 (1903), airdsAirs are PD music but the ABC encodings' licences are unverified (no licence file in `ryansMammoth`, **verified**) | Use the printed books as sources and re-encode, or obtain the encoder's permission |
| The Session (thesession.org data) | **Verified restrictive**: ODbL for the database plus a content licence that forbids processing "with Large Language Models". | **No.** The ODbL share-alike is awkward, and our build and review agents are LLMs, so we may not even process it. Agents must not download it. | ABC in CSV/JSON/SQLite | Tens of thousands of settings (unverified) | Variable, crowd-sourced | Would suit fiddle, flute, whistle | Do not fetch |
| Nottingham dataset (jukedeck cleaned) | GPLv3 (**verified**). Original Nottingham Music Database licence unverified. | **No** (GPL on data shipped in an App Store build is a problem, and v1 excludes copyleft) | ABC + MIDI | About 1,000 tunes (unverified) | Chords and melody, folk dance tunes | - | - |
| IMSLP scans (method books, etudes, hymnals, folk books) | Scans are usually marked Public Domain in the US or Canada (unverified per file). We never ship scans; we use them only as the printed source for our own encoding, so what matters is that the **edition** is PD (section 9.2). IMSLP user typesets carry their own CC licences, some NC: do not use NC ones. | Yes, as our own CC0 encodings | PDF scans | Unlimited | Depends on our encoding work | All levels, especially L1 to L4 and instrument-specific etudes | Manual download, then OMR (Audiveris) and human correction in MuseScore, saved as MusicXML in `tools/corpus-build/sources/inhouse/` |
| Hymn tune collections | Open Hymnal Project: files tagged "copyright: public domain" (search result, **unverified**; no formal licence found). Hymnary.org terms unverified. | Not the encodings. Hymn **melodies** themselves are encoded in-house from PD hymnals. | ABC (Open Hymnal) | Hundreds of tunes | Good | L1 to L4 all families; bass lines for low brass | Encode from scans of PD hymnals (see 10.4) |

### 3.2 Why not Essen, chorales, and The Session

They are the obvious machine-readable folk and chorale corpora, and every one of them fails a hard licence rule: Essen forbids embedding in teaching materials, the 370 chorales are non-commercial, The Session forbids LLM processing. The melodies themselves are public domain. The pipeline gets them by **encoding from public-domain printed books** (Erk and Böhme's Deutscher Liederhort, 1893 to 1894; Breitkopf's 1875 chorale edition; O'Neill's Music of Ireland, 1903) so the encoding is ours. Agents encoding these must work from the scan, not from the restricted encodings (clean-room rule, section 9.4).

## 4. Ranked shortlist for v1

| Rank | Source | Role | Expected yield after filters (estimate) | Levels |
| --- | --- | --- | --- | --- |
| 1 | OpenScore Lieder (CC0) | Voice lines; lyrical melodies for every treble and bass instrument | 700 to 1,000 excerpts (1,200+ songs × about 3 candidate windows × about 25% acceptance) | L3 to L8, some L9 |
| 2 | OpenScore String Quartets (CC0) | Vn I, Va, Vc lines; Classical and Romantic upper levels | 400 to 700 (Vn II and viola often fail the melodic-interest filter) | L5 to L10 |
| 3 | In-house encodings from PD print (CC0, ours) | Method books, solfège, hymn melodies, folk tunes; fills L1 to L4 | 600 to 800 (planned work, section 10) | L1 to L5 |
| 4 | PDMX, CC0/PDM subset, gated | Shortcut for etudes users already typeset; every file re-checked | 200 to 400 | L3 to L9 |
| 5 | Mutopia PD and CC BY pieces | Baroque solo lines (cello suites, flute partita, Telemann fantasias), some etudes | 100 to 200 | L6 to L10 |

KernScores, the music21 bundle, The Session, Nottingham, and Essen are excluded from v1. A KernScores repository can be added later by a one-line allowlist entry once C0 confirms its licence is CC0 or CC BY.

## 5. Seed target

Target about 2,200 excerpts at v1 launch, inside the architecture's 1,500 to 3,000 budget (about 2 to 4 KB gzip each, so 5 to 9 MB total, loaded per level shard).

Excerpts per level and meter (meters per 02 section 2.3; "other" = 5/4, 5/8, 6/4, 7/8 and anything later):

| Level | 4/4 | 3/4 | 2/4 | 6/8 | 2/2 | 3/8 | 3/2 | 9/8 | 12/8 | other | Total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| L1 | 100 | 60 | - | - | - | - | - | - | - | - | 160 |
| L2 | 90 | 60 | 40 | - | - | - | - | - | - | - | 190 |
| L3 | 90 | 70 | 50 | - | - | - | - | - | - | - | 210 |
| L4 | 70 | 55 | 40 | 45 | 20 | - | - | - | - | - | 230 |
| L5 | 60 | 50 | 35 | 45 | 20 | 15 | 10 | - | - | - | 235 |
| L6 | 55 | 45 | 30 | 45 | 20 | 15 | 10 | 15 | 15 | - | 250 |
| L7 | 55 | 45 | 25 | 40 | 20 | 15 | 10 | 15 | 15 | 20 | 260 |
| L8 | 50 | 40 | 25 | 35 | 20 | 15 | 10 | 15 | 15 | 25 | 250 |
| L9 | 45 | 35 | 20 | 30 | 20 | 10 | 10 | 15 | 15 | 25 | 225 |
| L10 | 40 | 30 | 20 | 25 | 20 | 10 | 10 | 10 | 15 | 20 | 200 |
| Total | 655 | 490 | 285 | 265 | 140 | 80 | 60 | 70 | 75 | 90 | 2,210 |

Coverage gates (the build fails if any gate fails; CI prints the gap table):

- G1. Every cell above with a number has at least 70% of that number (core meters 4/4, 3/4, 2/4, 6/8) or at least 10 excerpts (other meters).
- G2. For every v1 instrument × level × core meter allowed at that level: at least 25 excerpts fit the instrument's range band for that level in at least 3 written keys allowed at that level, using the selector's own fit function (section 7.3). This is the gate that catches "no tuba material at L2".
- G3. Variety: no composer above 10% of a level; no single source above 40% of a level; at least 3 sources per level from L3 up.
- G4. Familiarity: at most 15% of each level is familiarity 2 (02 section 2.4: unranked only).
- G5. Each level has at least 20% minor or modal excerpts from L2 up.

Repeat budget: at 10 exercises a day at one level and one meter, a 200-excerpt level gives about 20 days before the 50-item freshness window forces repeats, more with key changes. Growth after v1 should go first to the cells that players actually use (telemetry is local-only, so this comes from user feedback, not analytics).

## 6. Ingestion pipeline

Location `tools/corpus-build/`. Python 3.12, music21 pinned (9.x), MuseScore 4 CLI for `.mscx` conversion, `jsonschema` for validation against `schemas/excerpt.schema.json` (generated from the TS types, architecture 3.1). Deterministic: the same `sources.lock.yaml` and code produce byte-identical outputs (sorted keys, stable ids, no timestamps except `generatedAt` in the manifest, which comes from the lock file's date).

### 6.0 Stage map

```
fetch -> licence gate -> convert -> parse/normalize -> melody extraction
  -> phrase boundaries -> window proposal -> hard rules -> features + level
  -> quality filters + soft score -> dedupe -> attribution -> review queue
  -> emit (shards, manifest, attributions, report)
```

Each stage writes JSON Lines to `build/<stage>/` with a `reason` on every rejection, so the build report can say why each candidate died. Rejected windows are never silently dropped.

### 6.1 Fetch and lock

- `sources.yaml` lists each source: id, type (`git`, `zenodo`, `inhouse`), URL, licence policy, part-selection rule, priority (for dedupe).
- `sources.lock.yaml` pins git commit SHAs, Zenodo record versions, and SHA-256 of every file used.
- Raw caches live in `tools/corpus-build/cache/` (git-ignored). In-house encodings live in `tools/corpus-build/sources/inhouse/` (committed, CC0), one MusicXML file per piece plus a sidecar `*.meta.yaml` (section 10.3).

### 6.2 Licence gate (per file, before any parsing work)

Pass only if all hold:

1. The file's encoding licence is in the allowlist: `PD`, `CC0-1.0`, `CC-BY-3.0`, `CC-BY-4.0`. For PDMX, the MuseScore public licence is CC0 or PDM and the file is in `no_license_conflict`.
2. The composition is public domain worldwide by our rule (section 9.2): every creator (composer, lyricist if lyrics are shown, arranger, editor whose text we keep) died before 1 January of (build year − 70), and the work was first published before 1 January of (build year − 95). For a 2026 build: died before 1956, published before 1931. Anonymous and traditional tunes: the source edition was published before 1931.
3. The composer and work are not on `denylist.yaml` (known misattributions, takedown requests, copyrighted arrangements commonly mislabelled PD in PDMX, such as film and pop titles).

Composer death years come from `composers.yaml` (hand-curated, one row per composer: name, slug, birth, death, nationality, source of dates). A composer not in that file fails the gate; the review queue lists missing composers so a human adds them.

### 6.3 Convert and parse

| Input | Conversion | Notes |
| --- | --- | --- |
| `.mscx` (OpenScore) | `mscore -j job.json` to `.musicxml` | Run headless (`QT_QPA_PLATFORM=offscreen`). Pin MuseScore version in the lock. |
| MusicXML / MXL (PDMX, in-house) | none | |
| ABC (in-house only) | music21 ABC parser | |
| LilyPond (Mutopia) | `python-ly` `ly musicxml`, experimental | Accept a converted file only if every measure's duration equals the time signature (pickup and final bar excepted) and the note count matches the MIDI rendering of the same `.ly` within 1%. Otherwise send it to the in-house encoding queue as a reference. |

Parse with music21 into a `Score`. Read the source measure numbers as printed (`measure.number`, keeping `measureNumberWithSuffix` for "12a"), because attribution cites them.

### 6.4 Normalize

Applied to the whole part before windows are cut:

- Expand nothing. Repeats and voltas stay as barline markers; windows may not cross a repeat sign, a volta start, a segno, a coda, or a D.C./D.S. instruction.
- Grace notes: removed (no time stolen). Tag `modifications += 'grace-removed'` on any window that contained one. At L7+ the pedagogy allows displayed graces; v1 removes them anyway because the follower does not grade them (architecture 4.1 exclusion list).
- Trills, turns, mordents, tremolos: ornament symbol removed, principal note kept, tag `ornament-removed`. A measured tremolo (repeated 32nds written as slashes) rejects the window.
- Fermatas: a fermata on the last note of a window is dropped and tagged; any other fermata rejects the window (architecture: no fermatas; the metronome cannot wait).
- Dynamics, hairpins, articulations, slurs, ties: kept as data. The renderer filters them by level (02 section 2.3 "Articulations shown").
- Lyrics: kept on the voice part as per-note syllables, only if the lyricist passes the PD rule; otherwise removed and tagged `lyrics-removed`.
- Clef changes: dropped (the app chooses the clef after transposition).
- Cue notes, ossia staves, editorial brackets: removed; a window containing an ossia is rejected.
- Tempo text and metronome marks: recorded at the piece level as `tempo.marking` and `markedBpm`; tempo changes inside a window reject it.
- Durations converted to ticks at TPQ = 480. A duration that is not an integer number of ticks (nested tuplets, unusual tuplets) rejects the window.

### 6.5 Melody extraction (one monophonic line)

Part selection rules by source:

| Source | Candidate parts | Rule |
| --- | --- | --- |
| Lieder | Voice part only | Part whose instrument is voice, or name matches `/(voice\|singstimme\|gesang\|soprano\|alto\|tenor\|bass\|stimme)/i`. Piano parts are kept in the cache for v2 but not used. |
| String Quartets | Each of the 4 parts | Every part is a candidate. Vn II and Va usually fail the melodic-interest filter (6.9); that is intended. |
| PDMX | Single-part scores only in v1 | Multi-part PDMX files are skipped. Piano solo files are skipped. |
| Mutopia | Solo-instrument pieces only | Ensemble pieces skipped in v1. |
| In-house | The encoded line | Hymn encodings may contain soprano and bass as two parts; both are candidates (bass tagged `bass-line`). |

Within a part:

- If the part has more than one voice in a measure, the window is rejected unless the extra voices are only rests.
- Chords (double stops, divisi): window rejected. No top-note simplification in v1; it changes the music and violinists would read a double stop as a mistake.
- Hidden or invisible notes: removed; if they carry duration needed to fill the bar, the window is rejected.

### 6.6 Phrase boundary detection

For each candidate line compute a boundary strength `b(t)` in [0, 1] at every note onset `t`, as the maximum of these signals:

| Signal | Strength |
| --- | --- |
| Start of piece, section (double barline, rehearsal mark, repeat start) | 1.0 |
| First note after a rest of at least 1 beat | 0.9 |
| First note after a fermata, breath mark, or end of a lyric line (lyric ending in `, ; : . ! ?`) | 0.9 |
| First note after a slur end that coincides with a note of at least 1 beat | 0.6 |
| Local boundary detection model (Cambouropoulos LBDM) over IOI, pitch interval, and rest, normalized per piece | value of LBDM peak, capped at 0.7 |
| Metrical prior: onset at bar 4k+1 counted from the last 1.0 boundary | +0.15 (added, then capped at 1.0) |

Cadence strength `c(t)` at every note that ends on a strong beat (02 H2: beat 1, beat 3 in 4/4, beat 4 in 6/8) and lasts at least 1 beat or is followed by a rest:

- PAC: scale degree 1, approached by step from 2 or 7, with the note before on a weaker beat: 1.0.
- IAC: degree 3 or 5 approached by step, or degree 1 approached by leap: 0.7.
- HC: degree 5 or 2 on a strong beat, long, followed by a boundary of at least 0.6: 0.6.
- Otherwise 0.

Scale degrees are taken from the window's key: the source key signature at that point plus mode inferred from the final cadence of the piece; K-S analysis of the window is a cross-check, and a disagreement sends the window to review instead of rejecting it.

### 6.7 Window proposal and hard rules

Proposal: for every boundary `s` with `b(s) ≥ 0.6` and every cadence end `e` with `c(e) ≥ 0.6` such that the span from `s` to the end of the measure containing `e` is 8 to 12 full measures (plus an optional pickup that begins at `s`), propose window `[s, e]`.

Then apply 02 section 3.2 hard rules H1 to H7 verbatim, plus these:

- H8. No crossing of repeat signs, voltas, segno, coda, D.C./D.S.
- H9. No unsupported content (6.4 and 6.5 rejections).
- H10. Single key signature and single meter inside the window in v1. 02 allows key changes at L7+ and meter changes at L8+; the architecture's `ExcerptDoc` has one `meter` and one `keyConcert`. Tonicizations written with accidentals are fine. (Open question 1.)
- H11. If the window starts with a pickup, the final bar is completed with rests to a full bar unless the source's final bar is itself the balancing short bar at the very end of the piece (02 H6 keeps it as written).
- H12. At most one window per source starting in any given measure, and windows from the same part may overlap each other by at most 50% of their bars.

Phrase quality tag (architecture `phraseQuality`):

- `complete-phrase`: one boundary at the start, one cadence at the end, no interior boundary of at least 0.9.
- `period`: an interior HC or IAC near the midpoint (bar 4 or 5 of 8, bar 5 to 7 of 12) followed by a PAC at the end.
- `phrase-pair`: two complete phrases, any interior cadence.

### 6.8 Features and level

Compute, per window, instrument-independently, exactly the fields 02 section 2.4 needs (rhythm cells per 02 section 2.2, max interval, leaps per 4 bars, chromatic per 4 bars, double accidentals, span, lowest and highest concert pitch, peak notes per beat, articulations, tuplets, `breathMaxGapBars`, `cadenceEnd`, `featureLevels`, `baseLevel`), plus the architecture's `DifficultyFeatures`. Definitions the two sections leave open:

- `syncopationIndex` = number of note onsets on a weak subdivision whose duration crosses the next stronger metrical position (or that are tied across it), divided by note count. Weak/strong from a standard metrical grid per meter (beat > half beat > quarter beat).
- `restRatio` = total rest ticks / window ticks (pickup excluded).
- `accidentalsOutsideKey` = notes whose pitch class is not in the key signature's scale; in minor, the raised 6th and 7th are counted separately as `minorAlterations` because 02 treats them as chromatic only at L2 to L4.
- `meanAbsInterval` in semitones; `maxLeapSemis` the largest interval between consecutive notes (rests do not break adjacency; a rest of at least 1 beat does).
- `familiarity`: 0 by default; 1 or 2 from `familiar.yaml`, a curated list of incipits (first 8 interval+rhythm tokens) of famous tunes (Ode to Joy, Twinkle, national anthems, carol and hymn favourites). Matching uses the same fingerprint as dedupe (6.10).

Level: `baseLevel = max(featureLevels)` per 02 section 2.1. The pipeline also stores `levelConfidence` = number of features within 0 levels of the max (1 means a single feature sets the level, likely a stretch candidate). The lead musician calibrates on a 200-excerpt hand-rated sample before launch; disagreements above 1 level on more than 15% of the sample block the build.

Rhythmic augmentation or diminution by 2 (02 section 3.2) is done at build time, not runtime: the pipeline emits the variant as its own excerpt with id suffix `-aug2` or `-dim2`, `modifications += 'rhythm-augmented-x2'`, renotated meter (2/4 in eighths to 2/2; 3/8 to 3/4), its own features and level, and the same `dedupeGroup` as the original so the selector never serves both to one player inside the freshness window. Only emit a variant if it lands in a cell short of its seed target.

### 6.9 Quality filters

Reject (hard) when any of these hold. Thresholds are defaults; 02 section 3.1 sets the musical intent.

| Rule | Threshold |
| --- | --- |
| Rests | `restRatio > 0.25`, or any rest longer than 1 bar |
| Repetition | a bar repeated literally more than twice in a row; or more than 50% of notes on one pitch |
| Pitch variety | distinct pitch classes < 3 (L1), < 4 (L2), < 5 (L3+) |
| Rhythm variety | distinct rhythm cells < 2 at L2+ |
| Accompaniment figures | an Alberti-like or broken-chord pattern (same 3- or 4-note interval shape repeating for 2 or more bars) covering more than 25% of the window; pedal-tone patterns (every other note the same pitch) for 2 or more bars |
| Winds and voice breath | 02 section 2.3 breath rule; failing windows are tagged `noBreath` and excluded for wind, brass, and voice families, not rejected outright |
| Leap density for winds | more than 25% leaps at L1 to L6: tag `leapy`, excluded for wind and brass at those levels |
| Range | span > 24 semitones; any concert note outside MIDI 28 to 103 |
| Encoding errors | any measure whose duration does not match the meter (except pickup and final bar); overlapping notes; ties to a different pitch |
| Detector limits | shortest IOI below the architecture's floor at the excerpt's minimum allowed tempo (70 ms for pitch changes, 90 ms for same-pitch repeats) |

Soft score: 02 soft rules S1 to S5, keep if mean ≥ 0.6; store each component in `quality` for review sorting.

Melodic-interest score (used to rank candidates within a source, and to reject inner parts): `interest = 0.3 × contourChanges/notes + 0.3 × min(1, distinctPCs/7) + 0.2 × rhythmCellEntropy/maxEntropy + 0.2 × (1 − repeatedNoteRatio)`. Reject below 0.35. Calibrate the threshold on 50 hand-labelled Vn II and viola windows.

### 6.10 Dedupe

Duplicates are common: the same hymn tune in many hymnals, the same folk tune in many books, Lieder strophes, recapitulations and repeated sections in quartets, PDMX copies of the same etude.

- Fingerprint = sequence of (interval in semitones, IOI ratio to previous note quantized to {1/4, 1/3, 1/2, 2/3, 1, 3/2, 2, 3, 4}) for the whole window. Transposition- and tempo-invariant.
- Exact duplicate: identical fingerprint. Near duplicate: Jaccard similarity of 4-gram sets ≥ 0.8, or ≥ 0.7 within the same work.
- Keep the copy from the higher-priority source (OpenScore > in-house > Mutopia > PDMX), then higher soft score, then lower id. Losers are recorded with `dupOf`.
- All windows from one source movement share a `work` key; the selector's variety bonus and G3 use it.

### 6.11 Attribution

Each excerpt carries `source` fields (section 8.1) filled from the source's metadata plus `composers.yaml`. `attribution` is a ready-to-display TASL string generated by the pipeline, for example:

`Franz Schubert (1797–1828), "Heidenröslein", D 257, bars 1–8. Encoding: OpenScore Lieder (CC0 1.0). Adapted: excerpted, transposed, ornaments removed.`

The final "Adapted" clause is generated at runtime from `modifications` plus the actual transposition, because the key is not known at build time.

### 6.12 Human review queue

`tools/corpus-build/review/` builds a static HTML page (Verovio Python for rendering, review use only) listing windows with the score, features, level, soft-score components, source link, and accept/reject/relevel buttons that write to `review.yaml` (committed). Review policy:

- 100% of L1 and L2 excerpts (small, and beginners notice bad music most).
- 100% of excerpts flagged by: K-S key disagreement, `levelConfidence == 1`, melodic-interest score between 0.35 and 0.45, PDMX source, any composer added to `composers.yaml` in this build.
- 15% random sample of everything else, stratified by level and source. If more than 10% of a sample is rejected, review that whole source-level cell.

Reviewers: lead musician (musicality, level) and score researcher (licence, attribution, encoding). Agents may pre-screen but only a human sets `status: accepted` on L1 to L2 and on PDMX items.

### 6.13 Emit

Writes to `public/corpus/v1/` exactly the files in architecture 4.2 (`index.json`, hashed manifest, one shard per level), plus:

- `public/corpus/v1/attributions.<hash>.json`: per source and per composer credit lines, licence names, licence URLs; the credits page renders from it.
- `public/corpus/v1/withdrawn.json` (un-hashed, no-cache like `index.json`): ids removed after a takedown; the selector skips them even if a cached shard still contains them.
- `LICENSES/` in the repo root: full texts of CC0 1.0, CC BY 3.0, CC BY 4.0, and the corpus's own licence statement.
- `build/report.html` (CI artifact, not shipped): counts per cell, gate results, rejections by reason and source, review status.

Every emitted excerpt is validated against `schemas/excerpt.schema.json`; any failure fails the build.

## 7. Index, selection inputs, and transposition

### 7.1 Manifest entry

The architecture's `ManifestEntry` plus these fields (all needed by the selector without loading a shard):

```ts
interface ManifestEntry {
  id: string; shard: string; level: number; meter: string; fifths: number; mode: 'major' | 'minor';
  bars: number; rangeConcert: [number, number]; minBpm: number; maxBpm: number;
  composer: string; title: string; tags: string[]; originalFamily?: string;
  // added by 03:
  modal?: 'dorian' | 'mixolydian' | 'phrygian' | 'lydian' | 'aeolian' | 'locrian'; // when not plain major/minor
  pickup: boolean;
  cadenceEnd: 'PAC' | 'IAC' | 'HC';
  familiarity: 0 | 1 | 2;
  featureLevels: Record<string, number>;   // 02 2.4 keys, for stretch selection and remedial bias
  flags: ('noBreath' | 'leapy' | 'bass-line' | 'has-lyrics')[];
  dedupeGroup: string;
  work: string;                            // composer + work key, for variety
  license: 'PD' | 'CC0-1.0' | 'CC-BY-3.0' | 'CC-BY-4.0';
}
```

Serialization: column-oriented to keep the manifest small. `{ "columns": ["id", "shard", ...], "rows": [[...], ...] }`, with `composer`, `title`, `tags`, `work` dictionary-encoded (`"dict": {"composer": [...]}` and integer references in rows). At 2,200 entries this is about 250 KB raw and under 60 KB gzip, well inside the 200 KB budget.

No inverted index is shipped. A linear scan over 2,200 to 3,000 entries with typed-array columns takes well under 1 ms in a browser, so filters are evaluated directly.

### 7.2 Filtering

The selector (architecture 4.3) filters by meter, level ±1, bars, and then fit. This section adds:

- Exclude `familiarity == 2` from ranked attempts (02 2.4).
- Exclude `flags` incompatible with the family (`noBreath` and `leapy` per 6.9 for wind, brass, voice).
- Exclude `bass-line` excerpts above L4 (they are a low-level stopgap for low brass and bass, not good reading at higher levels).
- Modal excerpts are served only when the key setting is random. (Open question 2.)
- Skip ids in `withdrawn.json`.

### 7.3 Range fit in closed form

For instrument interval `I = {d_I, c_I}` (written minus sounding, alto sax {5, 9}), level band `[bMin, bMax]` (written MIDI, 02 section 1.4), and excerpt concert range `[lo, hi]`, the set of concert semitone shifts `t` that fit is the integer interval

```
tMin = bMin - c_I - lo
tMax = bMax - c_I - hi
fits iff tMin <= tMax
```

(with the 02 tier A/B 1-semitone margin applied by shrinking the band by 1 on each side first, falling back to no margin if empty).

For a requested written key `Kw`, the concert key is `Kc = transposeKey(Kw, -I)`. The pitch-class shift from the excerpt's concert key `Ks` to `Kc` is `p = (pc(tonic(Kc)) - pc(tonic(Ks))) mod 12`. The candidate shifts are `t = p + 12k`. The excerpt fits that key iff some `t` in `[tMin, tMax]` has that form. This is O(1) per entry and is also how gate G2 is computed at build time.

### 7.4 Spelled transposition

1. Choose `t` among the fitting candidates: smallest `|t|`; on a tie, the one that puts the excerpt's median pitch nearest the band centre.
2. Build the interval `{diatonic, chromatic: t}` where `diatonic = letterDistance(tonic(Ks), tonic(Kc))` taken in the same direction as `t` and extended by 7 per octave (`theory.intervalBetweenKeys(Ks, Kc, octaveHint)` in the architecture's interface).
3. Apply `transposePitch` to every note (concert). Then apply `I` to get written pitch. Letters move by `diatonic`, alters adjust so the chromatic size is exact; original spellings (leading tones, chromatic passing tones) are preserved relative to the key.
4. Key signature: `transposeKey(Ks, interval)`. For minor, the relative-major fifths of the result. For modal excerpts, the signature transposes by the same interval and the final moves with it.
5. Enharmonic choice of target key: when the user picks a key, use exactly that spelling. When random, pick from keys with at most 6 accidentals (prefer F♯ minor over G♭ minor, D♭ major over C♯ major); 7-accidental keys only at L8+ per 02.
6. Clef: first clef in the instrument's list whose staff centres the written range best, within the clefs allowed at the level (02 section 2.3 "Clefs").

### 7.5 When to reject instead of transposing

For a given request, an excerpt is rejected (the selector moves to the next candidate) when any of these hold. The pipeline never edits notes to make an excerpt fit.

1. No whole-excerpt shift fits the band for the requested key (7.3), including whole-octave displacement.
2. The excerpt's span exceeds the band span (it cannot fit in any key).
3. The transposed spelling contains a double sharp or double flat below L8, or more than 2 at any level, or any triple accidental. Retry once with the enharmonic target key (C♯ ↔ D♭, F♯ ↔ G♭, B ↔ C♭); reject if still bad.
4. Mode mismatch: major only to major targets, minor only to minor targets (architecture rule).
5. Written ledger lines exceed the level's limit after clef choice. Default limits (lead musician to confirm): L1 to L3 at most 1 ledger line, L4 to L6 at most 3, L7+ at most 5.
6. Idiom lock: excerpts tagged `idiom-locked` keep their original key for their original family. These are string passages built on open strings (bariolage, open-string drones), natural-horn writing that depends on the harmonic series, and guitar or cello passages whose fingering logic depends on the key. The tag is set in review. For other families the excerpt transposes normally.
7. Transposition distance: if `|t| > 7` and an alternative candidate with `|t| ≤ 7` exists at the same level and meter, prefer the alternative (soft, through the architecture's `fit` weight). Never hard-reject on distance alone.
8. Tempo: the excerpt's `[minBpm, maxBpm]` intersected with the level's tempo range and the NPS cap (02 section 2.3) is empty.

## 8. Excerpt JSON schema

### 8.1 Example document

Illustrative. Pitches, bars, and id are placeholders, not taken from the real score. Ticks at TPQ = 480.

```json
{
  "schemaVersion": 1,
  "id": "schubert-d257-heidenroslein-voice-m1-8",
  "source": {
    "composer": "Franz Schubert",
    "composerDates": "1797–1828",
    "composerDeath": 1828,
    "lyricist": "Johann Wolfgang von Goethe",
    "lyricistDeath": 1832,
    "work": "Heidenröslein",
    "catalog": "D 257",
    "movement": null,
    "partName": "Voice",
    "sourceMeasures": [1, 8],
    "edition": "First edition, Vienna 1821 (as transcribed by OpenScore)",
    "encoder": "OpenScore Lieder contributors",
    "corpus": "openscore-lieder",
    "upstreamRef": "OpenScore/Lieder@<commit>:scores/Schubert,_Franz/.../lc1234567.mscx",
    "sourceUrl": "https://github.com/OpenScore/Lieder",
    "license": "CC0-1.0",
    "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
    "attribution": "Franz Schubert (1797–1828), \"Heidenröslein\", D 257, bars 1–8. Encoding: OpenScore Lieder (CC0 1.0).",
    "originalInstrument": "voice"
  },
  "meter": { "beats": 2, "beatType": 4, "countUnitTicks": 480, "countsPerBar": 2 },
  "keyConcert": { "fifths": 1, "mode": "major" },
  "modal": null,
  "tempo": { "markedBpm": null, "minBpm": 60, "maxBpm": 92, "marking": "Lieblich" },
  "pickupTicks": 0,
  "measures": [
    {
      "index": 0, "isPickup": false, "startTick": 0,
      "events": [
        { "id": "e1", "kind": "note", "tick": 0, "dur": 240,
          "pitch": { "step": "D", "alter": 0, "octave": 5 },
          "slur": "start", "lyric": { "text": "Sah", "syllabic": "single" } },
        { "id": "e2", "kind": "note", "tick": 240, "dur": 240,
          "pitch": { "step": "D", "alter": 0, "octave": 5 },
          "slur": "stop", "lyric": { "text": "ein", "syllabic": "single" } },
        { "id": "e3", "kind": "note", "tick": 480, "dur": 480,
          "pitch": { "step": "B", "alter": 0, "octave": 4 },
          "lyric": { "text": "Knab", "syllabic": "single" } }
      ]
    }
  ],
  "rangeConcert": { "min": 62, "max": 76 },
  "features": {
    "noteCount": 31, "notesPerBeat": 1.9, "shortestDur": 240, "maxLeapSemis": 5,
    "meanAbsInterval": 2.1, "accidentalsOutsideKey": 1, "minorAlterations": 0,
    "tupletCount": 0, "tieCount": 0, "syncopationIndex": 0.03, "restRatio": 0.06,
    "rangeSemis": 14
  },
  "rhythmCells": ["Q", "EE", "H"],
  "featureLevels": { "meter": 2, "rhythm": 2, "interval": 2, "leaps": 1, "key": 1, "chromatic": 3, "articulation": 2 },
  "level": 3,
  "levelConfidence": 1,
  "cadenceEnd": "PAC",
  "phraseQuality": "period",
  "breathMaxGapBars": 2,
  "familiarity": 1,
  "flags": ["has-lyrics"],
  "tags": ["romantic", "lied", "stepwise", "strophic"],
  "idiomLocked": false,
  "dedupeGroup": "fp-7c1e9a40",
  "modifications": ["excerpted"],
  "quality": { "soft": 0.8, "S1": 1, "S2": 1, "S3": 1, "S4": 0.5, "S5": 0.5, "interest": 0.52 },
  "review": { "status": "accepted", "by": "lead-musician", "date": "2027-01-10" },
  "contentHash": "sha256:..."
}
```

### 8.2 Schema changes requested from the architecture

Additions to `ExcerptDoc` (all optional except where marked), to be folded into `src/core/types.ts`:

| Field | Type | Why |
| --- | --- | --- |
| `source.composerDeath`, `source.lyricist`, `source.lyricistDeath` | number, string, number | PD checks are re-run at every build; credits show lyricist when lyrics display |
| `source.edition`, `source.encoder`, `source.upstreamRef`, `source.licenseUrl`, `source.partName` | string | Attribution and takedown traceability |
| `source.license` enum | `'PD' \| 'CC0-1.0' \| 'CC-BY-3.0' \| 'CC-BY-4.0'` | Replaces the architecture's `'CC0' \| 'CC-BY-4.0' \| 'CC-BY-SA-4.0'`; BY-SA dropped for v1, BY 3.0 added for Mutopia |
| `NoteEvt.lyric` | `{ text: string; syllabic: 'single' \| 'begin' \| 'middle' \| 'end' }` | Voice players read with words; designer decides display |
| `modal` | mode name or null | 02 allows dorian and mixolydian from L5 |
| `rhythmCells`, `featureLevels`, `levelConfidence`, `cadenceEnd`, `breathMaxGapBars`, `familiarity`, `flags` (required) | as in 02 2.4 | Selection and grading inputs |
| `idiomLocked` | boolean | Transposition rule 7.5.6 |
| `dedupeGroup` (required), `modifications` (required), `quality`, `review`, `contentHash` (required) | | Dedupe, attribution, review, cache integrity |

Rename map from 02's tag record: `excerptId` → `id`, `concertKey` → `keyConcert`, `pickupBeats` → derived from `pickupTicks`, `lowestConcert`/`highestConcert` → `rangeConcert`, `baseLevel` → `level`. 02's field names are documentation only; the architecture's names are binding.

`modifications` vocabulary: `excerpted`, `grace-removed`, `ornament-removed`, `fermata-removed`, `lyrics-removed`, `rhythm-augmented-x2`, `rhythm-diminished-x2`, `final-bar-completed`. Runtime adds `transposed` and `octave-displaced` when it applies them.

## 9. Legal and attribution requirements

Not legal advice. Before any paid launch, counsel should review sections 9.2 and 9.3.

### 9.1 What the UI must show

1. **On every exercise screen**: composer and dates, work title and catalogue number, bars (source numbering), for example "Schubert (1797–1828) · Heidenröslein, D 257 · bars 1–8". One tap or hover opens a source panel with edition, encoder, corpus, licence name linked to the licence URL, source link, and an "Adapted" line listing modifications including the transposition ("transposed from G to B♭ concert; written for E♭ alto saxophone in G").
2. **Credits page** (reachable from settings and the footer): every source collection with its licence and link; OpenScore credited as "OpenScore Lieder" and "OpenScore String Quartets" with links (their requested courtesy); PDMX credited by its paper citation; every CC BY item listed with title, author, source, licence (TASL) and a modification notice. Generated from `attributions.json`.
3. **No implied endorsement**: no source's logo; no wording that suggests OpenScore, MuseScore, Mutopia, IMSLP, or any composer's estate endorses the app.
4. **Licence texts**: CC licences are linked from the credits page and their full texts ship in `LICENSES/`.
5. **Exports and screenshots**: any feature that exports or shares an excerpt (image, MusicXML, PDF) embeds the attribution string (in MusicXML `<identification><rights>` and `<work>`; as a caption on images).
6. **Takedown**: a "report a rights problem" link on the credits page (mailto is enough in v1). Removal path: add the id to `withdrawn.json` and redeploy; the next build drops it from shards.
7. **iOS**: the same credits page in the fork. The v1 allowlist (PD, CC0, CC BY) is compatible with App Store distribution; this is one reason GPL and BY-SA are excluded.

### 9.2 Public-domain rule for compositions and editions

The web is worldwide, so the build applies the stricter of the US and life-plus-70 rules, recomputed each January:

- Every creator whose contribution is shown (composer, lyricist when lyrics display, arranger, editor) died more than 70 full years ago: for 2026, died before 1 January 1956.
- First publication more than 95 years ago (US): for 2026, published before 1 January 1931.
- The **edition** used as the source is PD too. Modern editions add copyrightable editorial material (fingerings, bowings, realized ornaments, articulation suggestions, editorial slurs). For in-house encodings, use first or early editions or editions old enough to pass both tests. For OpenScore, rely on its own first-edition policy and its CC0 release.
- Known traps the denylist must cover: Ralph Vaughan Williams (died 1958; his own hymn tunes such as SINE NOMINE are not PD until 2029 under life+70); Rochut's Bordogni arrangements (check Rochut's dates before use; unverified); modern Carl Fischer editions of Arban and Simandl (use 19th-century editions); Bartók and Kodály pedagogical works (not PD); Soviet-era etudes (Blazhevich) with unclear US status.
- Countries with longer terms (for example life+80 or life+100) are a residual risk; the rule above covers the US, EU, UK, Canada (life+70 since 2022), and Australia.

### 9.3 Licence handling

- PD, CC0: no conditions; we credit anyway (courtesy and provenance).
- CC BY 3.0 / 4.0: attribution (TASL), licence link, indication of changes. Met by 9.1 items 1, 2, 5.
- Our corpus output: our own contributions (segmentation, features, levels, in-house encodings) are released under CC0 1.0. Upstream CC BY attributions remain attached to their excerpts. The app code's licence is separate and is the overseer's call.
- Excluded in v1: CC BY-SA (share-alike would extend to the corpus files), any NC, any ND, GPL, ODbL, research-only, "permission for music21 only", and anything with an unclear licence.

### 9.4 Clean-room rule for in-house encodings

When a melody exists in a restricted encoding (Essen, chorales, The Session), the in-house encoder works only from a PD printed scan and records the scan's URL and page in the sidecar. Agents and contributors must not fetch, open, or copy the restricted files. The Session's licence forbids LLM processing outright, so its URLs are on the fetch denylist.

## 10. Repertoire by instrument family

The selector can transpose anything to any instrument, but these sources read idiomatically for each family and should be over-weighted (`originalFamily` match gives the architecture's variety and fit scoring a nudge; 02 owns the weight). Every named work must still pass 9.2 at ingestion; dates I have not verified are marked.

| Family | Strong repertoire | Levels |
| --- | --- | --- |
| Voice | OpenScore Lieder: Schubert, Schumann, Brahms, Mendelssohn, Fanny Hensel, Clara Schumann, Loewe, Wolf, Grieg. Concone 50 Lessons Op. 9; Vaccai Metodo pratico; Panofka vocalises; Dannhauser Solfège des solfèges; Bordogni vocalises; hymn melodies; folk songs from Erk-Böhme | L1 to L8 |
| Flute | Lieder melodies; Köhler Op. 33; Andersen Op. 41 (Andersen died 1909); Berbiguier 18 Exercises; Telemann 12 Fantasias TWV 40:2–13 and Bach Partita BWV 1013 (single-line passages only); Irish dance tunes from O'Neill 1903 (re-encoded) | L3 to L10 |
| Oboe, saxophone | Ferling 48 Studies Op. 31; Barret oboe method; Klosé saxophone exercises (unverified dates); Lieder melodies; quartet Vn I lines | L4 to L9 |
| Clarinet | Klosé Méthode; Baermann Op. 63; Cyrille Rose 32 and 40 Studies (Rose died 1903); Lieder melodies | L3 to L10 |
| Bassoon | Weissenborn Op. 8; Milde Op. 24 and 26 (Milde died 1937, unverified); quartet cello lines | L3 to L10 |
| Trumpet, cornet | Arban Method (1864 edition), especially the Art of Phrasing songs; Saint-Jacome; Kopprasch transposed; hymn melodies | L2 to L10 |
| Horn | Kopprasch 60 Studies Op. 6; Gallay studies; hymn melodies; Lieder melodies (horn reads them well in F) | L2 to L9 |
| Trombone, euphonium, tuba | Bordogni vocalises in bass clef (from the vocal originals); Kopprasch trombone studies; hymn bass lines (`bass-line`, L1 to L4); quartet cello lines | L1 to L9 |
| Violin | Wohlfahrt Op. 45 and Op. 74; Kayser Op. 20; Mazas Op. 36; Dancla; Kreutzer 42 (single-line studies only, L9 to L10); quartet Vn I; fiddle tunes from Ryan's Mammoth 1883 and O'Neill 1903 (re-encoded) | L2 to L10 |
| Viola | Quartet viola parts (alto clef); Campagnoli 41 Caprices Op. 22; Kayser transposed by us (our own transposition, not a later editor's) | L4 to L10 |
| Cello, double bass | Dotzauer 113 Studies; Lee Op. 31 and Op. 70; Werner method; Duport; quartet cello lines; Bach suites (single-line passages); Simandl (1881 edition only) for bass | L2 to L10 |
| Guitar (single line, treble-8vb) | Folk and hymn melodies; Lieder melodies; single-line exercises from Carulli and Carcassi methods. Polyphonic studies (Sor, Giuliani) deferred | L1 to L6 |
| Piano (one hand) | Right hand: the treble melodic corpus. Left hand: the bass-clef corpus (cello lines, hymn bass lines) | L1 to L8 |

### 10.1 Low levels (L1 to L2) are the hard part

Real repertoire rarely stays inside a major third with only half and quarter notes. L1 to L2 material comes from: the simplest hymn melodies (Genevan Psalter 1551 tunes, Lowell Mason, early Hymns Ancient and Modern 1861), children's songs from Erk-Böhme and Kinderlieder books before 1931, opening exercises of 19th-century beginner methods (Langey tutors, Hohmann violin method, Wohlfahrt Op. 38), and rhythmic augmentation of L3 folk melodies (6.8). Expect most L1 to L2 excerpts to be in-house encodings.

### 10.2 Polyphonic instruments

v1 corpus is monophonic only; piano and guitar read one line (02 section 1.2). For v2 two-hand piano and guitar chord reading, the pipeline already caches the full scores: OpenScore Lieder piano accompaniments (CC0) and Mutopia piano works are the first sources. That needs schema v2 (multiple staves and voices, chords) and, realistically, Web MIDI input rather than the microphone for grading; that decision belongs to the architect.

### 10.3 In-house encoding sidecar

Each in-house file `sources/inhouse/<composer>/<work>/<piece>.musicxml` has `<piece>.meta.yaml`:

```yaml
composer: Franz Wohlfahrt
composerDeath: 1884
work: 60 Studies, Op. 45
piece: No. 1
edition: "Leipzig, c. 1875"          # the printed source, must pass 9.2
scanUrl: https://imslp.org/...        # page-level reference
pages: [3]
encodedBy: corpus-team
method: omr-audiveris+manual          # or manual
proofedBy: lead-musician
license: CC0-1.0
editorialRemoved: [fingerings]        # we never encode fingerings or editorial slurs
```

### 10.4 In-house encoding budget

About 700 excerpts' worth of source material for L1 to L5. Working from scans via Audiveris OMR plus correction in MuseScore costs about 10 minutes per 8-bar line for simple music. That is roughly 120 to 150 hours for a first pass plus proofing. PDMX may already contain clean typesets of many of the same etudes (rank 4); try PDMX first per work and encode in-house only where PDMX fails the gate or quality check.

## 11. Acceptance criteria

1. `make corpus` (or `python -m corpus_build`) from a clean checkout plus fetched caches regenerates `public/corpus/v1/` byte-identically (CI runs it twice and diffs).
2. Every shipped excerpt validates against `schemas/excerpt.schema.json`, has a licence in the allowlist, a composer present in `composers.yaml` passing 9.2 for the build year, a non-empty `attribution`, and `review.status == 'accepted'` if it belongs to a 100%-review category.
3. Gates G1 to G5 pass; the build report lists each cell's count against target.
4. No two shipped excerpts share a fingerprint; no near-duplicate pair (Jaccard ≥ 0.8) outside the same `dedupeGroup`.
5. Every excerpt passes 02 hard rules H1 to H7 and this section's H8 to H12; a test suite of at least 30 hand-made MusicXML fixtures (each targeting one rule) proves each rejection path.
6. Transposition: property test over 10,000 random (excerpt, instrument, key, level) requests: whenever the selector returns an excerpt, every written note is inside the band, the key signature matches the request, interval spellings between consecutive notes are preserved (diatonic and chromatic sizes equal to the source), and no forbidden double accidental appears.
7. Manifest under 200 KB gzip; each shard under 150 KB gzip; per-excerpt average under 4 KB gzip.
8. The credits page lists every source and licence present in the manifest (test compares sets).
9. `withdrawn.json` removes an id at runtime without a rebuild (test with a cached shard).
10. Lead musician's calibration sample: level disagreement above 1 level on at most 15% of 200 excerpts; musicality rejection rate on the 15% random sample at most 10% per source.

## 12. Work breakdown for the corpus jobs

| Job | Scope | Size | Suggested model |
| --- | --- | --- | --- |
| C0 | Licence verification: confirm the unverified rows in 3.1 from primary pages (needs `mutopiaproject.org`, `kern.humdrum.org`, `zenodo.org`, `imslp.org` allowlisted), fill `composers.yaml` and `denylist.yaml` | S | Opus (judgement) + human sign-off |
| C1 | Fetchers, `sources.yaml`, lock file, cache | S | Sonnet |
| C2 | Licence and PD gate | S | Sonnet |
| C3 | Converters (MuseScore CLI, ABC, experimental LilyPond) and normalizer (6.4) | M | Sonnet |
| C4 | Melody extraction (6.5) | S | Sonnet |
| C5 | Boundary, cadence, window proposal, hard rules, phrase-quality tag (6.6, 6.7) | L | Opus |
| C6 | Features, rhythm cells, levels, augmentation variants (6.8) | M | Sonnet |
| C7 | Quality filters, melodic interest, dedupe, familiarity (6.9, 6.10) | M | Sonnet |
| C8 | Emitter, schema validation, manifest columns, attributions, report, gates (6.13, section 5) | M | Sonnet |
| C9 | Review HTML tool and `review.yaml` workflow (6.12) | S | Haiku |
| C10 | In-house encoding of L1 to L5 sources (10.1, 10.4) | L, human-heavy | Humans with OMR; agents may prepare OMR output and sidecars |
| C11 | Runtime transposition and fit functions in `src/corpus/` per section 7 (with the architect's P-job) | M | Sonnet |
| C12 | Rule fixtures and property tests (section 11 items 5, 6) | M | Haiku for fixtures, Sonnet for property tests |

Order: C0 → C1, C2 → C3, C4 → C5 → C6, C7 → C8 → C9; C10 runs in parallel from the start; C11 and C12 can start against a hand-made 20-excerpt fixture corpus on day one.

## Open questions

1. **Key and meter changes inside an excerpt.** 02 allows key changes at L7+ and meter changes at L8+; the architecture's `ExcerptDoc` has one meter and one key. This section rejects both in v1 (H10). Do we keep that, or extend the schema to per-measure meter and key now?
2. **Modal excerpts and the key setting.** When the player requests G major, should a dorian excerpt with a one-sharp signature (A dorian) be eligible? This section says modal excerpts appear only when the key is random. Lead musician and designer to confirm.
3. **Lyrics display for voice.** Show lyrics under the staff (helps singers, costs layout space), show solfège instead, or neither? Lyrics in German or other source languages only; we ship no translations.
4. **CC BY-SA.** Excluding it loses a slice of Mutopia. Is the overseer willing to ship a separate BY-SA shard later, with the corpus files for that shard under BY-SA?
5. **PDMX dataset-level licence.** Search results describe the dataset as CC BY while its files are CC0 or PDM. If the dataset licence applies to our extracted excerpts, the credits page must cite PDMX for each such excerpt; this section already credits it, but C0 must confirm from Zenodo.
6. **Human review capacity.** 100% review of L1 to L2 (about 350 excerpts) plus flagged items is roughly 25 to 35 hours of lead-musician time before launch. Is that budgeted?
7. **Famous-tune policy.** 02 limits familiarity-2 tunes to unranked play. Should they be excluded entirely from L1 to L2, where familiar tunes make beginners feel successful but they play by ear?
8. **Legal review.** Who signs off on the PD rule (9.2) before a paid launch, and in which jurisdictions do we claim availability?

## Dependencies on other roles

- **Technical architect**: fold the schema additions in 8.2 into `ExcerptDoc` and `ManifestEntry` (including the licence enum change and the `withdrawn.json` mechanism); confirm the column-oriented manifest encoding; confirm `intervalBetweenKeys` returns the spelled interval needed by 7.4; own the v2 polyphony input decision (10.2); allowlist `mutopiaproject.org`, `kern.humdrum.org`, `zenodo.org`, and `imslp.org` for the corpus-build environment.
- **Lead musician**: final level bands and comfortable ranges (02 section 1.4) used in G2 and 7.3; ledger-line limits per level (7.5.5); sign-off on `idiom-locked` tags; the 200-excerpt calibration sample; 100% review of L1 to L2; `familiar.yaml` incipit list; confirm the melodic-interest threshold and the repertoire list in section 10; tips content may cite the excerpt's source (for example "Wohlfahrt wrote this study for string crossings").
- **Senior designer**: exercise-screen attribution line and source panel (9.1 item 1), credits page (9.1 item 2), how modifications and transposition are described to players, lyrics display (open question 3), and the "report a rights problem" entry point.
- **Senior iOS engineer**: ship the same `public/corpus/v1/` files and `attributions.json` in the fork, render the same credits page, and honour `withdrawn.json` on app launch.
- **Overseer**: decisions on open questions 1, 4, 6, and 8; schedule C10 (human encoding) early because it is the long pole for L1 to L4 content.
