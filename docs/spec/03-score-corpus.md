# 03 Score corpus: sources, ingestion, schema, transposition, licensing

Owner: music score researcher. Readers: the overseer and the implementers of `tools/corpus-build/` (Python pipeline), `src/corpus/` (runtime selector and transposer, built as 01's P9a to P9c), and the credits UI (04).

Status: revision 2 (after the overseer's rulings R1 to R13 and the cross-examination round). Part A is web v1, and everything in it ships in this build. Part B ("Later") is short and is not built now. The Review log at the end lists every change from the first draft.

This section decides where the music comes from, how it becomes 8 to 12 bar excerpts, what the shipped files contain, how an excerpt is moved to the player's instrument and written key, and what the app must show to stay legal. It uses 01's data model (`01-architecture.md` §6.1 and §6.2, TPQ = 480, spelled pitches) and 02's difficulty ladder, cutting rules and range tiers (`02-pedagogy-and-grading.md` §1.4, §2 and §3). It does not restate values that 02 or 01 own. It names the file and section instead.

"Key" means the written key the player reads (R1). Inside the pipeline every excerpt is stored in concert pitch, because the written key exists only once an instrument is chosen.

---

# Part A — Web v1

## 0. v1 scope at a glance

| Feature | Scope | Section |
| --- | --- | --- |
| Sources: OpenScore Lieder (voice parts), OpenScore String Quartets (all 4 parts), Mutopia single-line Traditional, Anonymous and Mason pieces marked PD or CC BY 4.0, all from GitHub at pinned commits | v1 | 3 |
| Licence allowlist PD, CC0-1.0, CC-BY-4.0; automated PD rule (composer died before 1931) | v1 | 6.2, 9 |
| MusicXML read directly (OpenScore commits `.mxl`); python-ly for Mutopia with strict bar-sum validation, non-blocking | v1 | 6.3 |
| Deterministic Python pipeline (music21 10.5.x): normalize, melody extraction, precision-first boundaries and cadences, hard rules, features and level, accompaniment filters, dedupe | v1 | 6 |
| Build-time rhythmic augmentation ×2, per 02 §3.3 | v1 | 6.8 |
| Automated review: rules, statistical outliers, two-pass agent veto with negative controls, cached verdicts | v1 | 6.12 |
| Seed target about 1,200 excerpts; CI hard gates, launch gates, report-only coverage gates | v1 | 5 |
| Emit: column manifest with fit statistics, chunks of at most 64 excerpts, attributions, withdrawn list, licence texts; generated corpus committed | v1 | 6.13 |
| Runtime range fit, spelled transposition, rejection rules | v1 | 7 |
| Structured attribution fields; credits data; a source line during scan and take for CC BY items only | v1 | 9 |
| PDMX, KernScores, IMSLP scans, in-house encoding, Mutopia CC BY 2.5 and 3.0, composers who died 1931 to 1955 | later | Part B |
| Lyrics, key or meter changes inside an excerpt, ornaments and grace notes, idiom-locked transposition, familiarity 1, polyphony (schema v2) | later | Part B |
| Human review queue, human calibration sample, human encoders | later | Part B |

## 1. Summary of decisions

1. **v1 sources are the three verified, fetchable GitHub sources only** (R4): OpenScore Lieder (CC0), OpenScore String Quartets (CC0), and the single-line Mutopia subset whose per-file header says Public Domain or CC BY 4.0. Everything else is later.
2. **The licence allowlist is `PD`, `CC0-1.0`, `CC-BY-4.0`.** CC BY-SA is excluded (R8). CC BY 2.5 and 3.0 are excluded from v1, because their attribution clause requires the title, and showing the title before the take would undermine sight reading (9.1). NC, ND, GPL, ODbL and unclear licences are always excluded.
3. **No human labour anywhere in the pipeline** (R3). Human review, the human calibration sample, hand-labelled thresholds and in-house encoding are replaced by deterministic rules, statistical outliers, an agent veto with negative controls, and control-set calibration (6.9, 6.12).
4. **No MuseScore.** Both OpenScore repositories commit MusicXML (`.mxl`), so the pipeline reads them directly. The first draft's MuseScore CLI step and the spike proposed in review are withdrawn.
5. **Seed target: about 1,200 excerpts** (measured projection 1,400 to 1,800 ±30%, section 4). Yield never turns CI red. CI fails only on correctness (schema, licence, attribution, rules, dedupe, determinism, render). Coverage is reported, and a small set of launch gates blocks only the v1.0 tag (5.2).
6. **Levels L1 and L2 are the weak spot.** They are filled by build-time rhythmic augmentation of complete 4-bar phrases (02 §3.3), Mutopia hymn and folk tunes, simple Lieder phrases and quartet inner parts. The pool stays small (section 4).
7. **Transposition is spelled (diatonic plus chromatic interval), never MIDI-then-respell.** The excerpt moves as a whole by a key shift plus whole octaves. If it does not fit the band, it is rejected for that request, never edited (7.5).
8. **Attribution is structured data, not a prose string.** The UI formats it from 04's copy file. Title and composer appear only after the take. CC BY items alone carry a quiet, non-identifying source line during scan and take (9.1).
9. **The generated corpus is committed** in `public/corpus/v1/`. Web CI never runs Python, and the corpus job runs only when `tools/corpus-build/` or the lock file changes.

## 2. What to reuse from ear-to-staff

| Ear-to-staff piece | Verdict | Why |
| --- | --- | --- |
| `js/theory.js` `KEYS` | Reuse as data | The same key set; 02's `levels.json` gates which keys a level allows. |
| `js/theory.js` `INSTRUMENTS` (`semis`, `diatonic`) | Adapt | The written-minus-sounding convention (alto sax = {5, 9}) is ours. Ranges are replaced by 02's tier bands. |
| `js/theory.js` `transposeKey` | Replace | It works by pitch class only. Corpus transposition needs a spelled interval (7.4). |
| `js/theory.js` `noteName`/`vexKey` | Ghost notes only | Real excerpts carry deliberate spellings that must survive transposition. Ghost spelling is 02 §4.8's rule. |
| `js/theory.js` `detectKey` (Krumhansl-Schmuckler) | Pipeline cross-check | music21's `analyze('key')` implements the same profiles (6.12 R1). |
| `js/musicxml.js` | Not used in v1 | MusicXML export is later (R9). |
| `transcriptions/` plus `build-index.mjs` | Pattern only | Hashed records plus a generated index, the same idea as our chunks plus manifest. |

## 3. Sources (v1)

### 3.1 Reachability report (this environment)

Checked with `git ls-remote` and `curl` during the review round.

| Host or repository | Result | Use |
| --- | --- | --- |
| `github.com/OpenScore/Lieder` | reachable, HEAD `38c5db510224d9facdc4b08d741fc788cfb58ea8` | v1 |
| `github.com/OpenScore/StringQuartets` | reachable, HEAD `2614b0b2958dd1ce3f52e172a43e5f4d0e29570f` | v1 |
| `github.com/MutopiaProject/MutopiaProject` | reachable, HEAD `2144afd6f52d56c5b6995b8b589ef1268b3139f0` | v1 (subset) |
| `github.com/pnlong/PDMX` | reachable, code only; the data is on zenodo | later |
| `github.com/MarkGotham/When-in-Rome` | reachable; CC BY-SA 4.0 by its README | excluded (R8) |
| DCMLab corpora | reachable; licence not checked | excluded until checked |
| `zenodo.org`, `mutopiaproject.org`, `kern.humdrum.org`, `imslp.org`, `huggingface.co` | unreachable (curl code 000) | not usable (R4) |

Tooling present or installable here: Python 3.13, `music21` 10.5.2 and `python-ly` from PyPI. `lilypond` 2.24.3 and `musescore3` are available from apt, but v1 does not need them.

### 3.2 v1 source table

Licences were read from the repositories' own files.

| Source | Licence (verified) | Files used | Metadata | Parts used | Serves |
| --- | --- | --- | --- | --- | --- |
| OpenScore Lieder | CC0 1.0 (`LICENSE.txt`). Credit with a link is requested as a courtesy. | `scores/<Composer>/<Set>/<Song>/lc*.mxl`: 1,462 files, 18.6 MB | `data/composers.yaml` (birth and death for 143 composers, used by the PD gate), `data/scores.yaml` (IMSLP id) | Voice part only. Part names seen: Voice, Singstimme, Gesang, Chant, Contralto, Baritone. Lyrics are stripped (R8). | Lyrical lines for every family, mostly L3 to L8 |
| OpenScore String Quartets | CC0 1.0 (`LICENSE.txt`) | `scores/<Composer>/<Work>/sq*.mxl`: 196 files, 40.4 MB, usually a whole quartet per file (up to 1,403 measures) | `data/composers.yaml`, `data/scores.yaml` | All 4 parts, behind the accompaniment and melodic-role filters (6.9) | Vn I L3 to L10; inner parts and cello for bass-clef and alto-clef readers |
| Mutopia Project, single-line subset | Per file, in the `.ly` header (`license =` or `copyright =`). In the three folders: 87 Public Domain (39 Japanese folk songs, 48 hymn and folk tunes), 1 CC BY 4.0, 57 CC BY 2.5 (all of them the Swedish 1814 dances), 9 CC BY-SA. | `ftp/Traditional/*` (125 pieces), `ftp/Anonymous/*` (26), `ftp/MasonL/*` (3). v1 takes the 88 PD and CC BY 4.0 pieces. | `.ly` header: title, composer, source edition, maintainer, licence | Single melodic line. For SATB hymns, the soprano only, and only if conversion passes (6.3). | Simple hymn and folk shapes, L1 to L4 |

Not used in v1, with the reason, so that no agent re-opens them: Essen (forbids embedding in teaching materials), `craigsapp/bach-370-chorales` (CC BY-NC-SA), The Session (ODbL, and its terms forbid LLM processing; agents must not download it), Nottingham (GPLv3), the music21 bundled corpus (per-directory licences unclear), When-in-Rome (BY-SA), PDMX, KernScores and IMSLP (unreachable). Part B lists what could come later.

### 3.3 Fetch

- OpenScore: `git clone --filter=blob:none --sparse <url>`, then `git sparse-checkout set --no-cone '/scores/**/*.mxl' '/data/*.yaml' '/LICENSE.txt'`, then `git checkout <pinned SHA>`. That is about 60 MB in total. Full checkouts would be 842 MB (Lieder) and 2.4 GB (String Quartets, mostly PDFs), so sparse is required.
- Mutopia: a blobless sparse clone of `ftp/Traditional`, `ftp/Anonymous` and `ftp/MasonL` at the pinned SHA.
- `sources.yaml` lists each source: id (`openscore-lieder`, `openscore-quartets`, `mutopia`, the same values as 01's `CorpusId`), URL, pinned SHA, sparse paths, licence policy (repository-wide CC0, or per-file header), part-selection rule, and dedupe priority.
- `sources.lock.yaml` pins the SHAs and records the SHA-256 of every file used, plus the SHA-256 of each upstream `LICENSE.txt` as licence evidence.
- Raw caches live in `tools/corpus-build/cache/`, which is git-ignored.

## 4. Measured yield and projection

Measured in this session by a prototype run over the full corpora. These numbers come from a crude version of the rules and are a sizing input, not a promise.

Prototype rules:
- Start at the piece start, or after a rest of at least 1 beat, with a pickup of at most 2 beats.
- 8 to 12 bars, one key and one meter.
- No chords, graces or second voice. No fermata except on the last note.
- Rest ratio at most 0.25, and no rest of a bar or longer.
- The final note is at least 1 beat long, on a strong beat, on degree 1 or 3, or on 5 or 2 (a half cadence, forced to L5+).
- Window overlap at most 50%, a crude accompaniment filter and a crude dedupe.
- Level = maximum feature level, with key excluded.
- The draft L1 rule (M3 maximum interval) was used, not 02's relaxed L1.

| Corpus | Files | Files with windows | Raw windows | After filters | L1 | L2 | L3 | L4 | L5 | L6 | L7 | L8 | L9 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Lieder | 1,462 | 695 | 1,882 | 1,263 | 0 | 6 | 204 | 175 | 340 | 443 | 61 | 34 | 0 |
| String Quartets (12 parse failures, mostly late-Romantic: Reger, Zemlinsky, Berg, Janáček, Busoni, Cras, Suk) | 196 | 184 | 6,612 | 3,982 | 3 | 25 | 479 | 546 | 943 | 651 | 340 | 718 | 277 |
| Augmented ×2 from Lieder | | | | 256 | 8 | 39 | | | | | | | |
| Augmented ×2 from String Quartets | | | | 773 | 11 | 58 | | | | | | | |

Other observations:
- Lieder: 15% of windows are minor. Cadences are 40% PAC, 22% ending on degree 3 and 38% HC.
- Haydn is 23% of the String Quartets windows.
- Mutopia: python-ly on a random 30 files gave 10 clean conversions, 13 with bar-duration errors and 7 failures, including every SATB hymn tried. Expect 20 to 40 v1 windows.

**Projected shippable** after the full rules (H1 to H12, sequence checks, slur and tie cuts, calibrated interest, near-duplicate dedupe, the PD gate and the agent veto). Assumed survival rates: Lieder 35%, String Quartets 25%, augmented 50%.

| L1 | L2 | L3 | L4 | L5 | L6 | L7 | L8 | L9 | L10 | Total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 15–30 | 50–90 | 200–300 | 150–250 | 250–350 | 250–320 | 80–130 | 120–200 | 50–90 | 10–30 | about 1,400–1,800 (±30%) |

02 has since relaxed L1: P4 free, tonic-triad leaps up to P8, 2/4 allowed, span at most 12 (02 §2.3). The L1 figure above predates that change and should rise. The first histogram from job C6 replaces this table (5.3).

## 5. Seed target and gates

### 5.1 Target

- About **1,200 shipped excerpts** after dedupe. Augmented variants count, and they share a `dedupeGroup` with their original.
- Pedagogical per-level targets are 02's (02 §3.1): L1 ≥ 60, L2 ≥ 80, L3 to L8 ≥ 120, L9 and L10 ≥ 60. The build reports progress against them; they are not gates.
- A level is **served** if it holds at least 30 excerpts after dedupe. Below that, the manifest marks the level unserved and 04 shows it as "More music coming" without offering it as a default. 02 §3.1 already starts placement at L2.

### 5.2 Gates

**CI hard gates.** The corpus build fails on any of these. None depends on yield beyond a minimum viable corpus.

| Id | Gate |
| --- | --- |
| H-schema | Every excerpt, the manifest, every chunk and `attributions.json` validate against `schemas/*.schema.json` (generated from 01's types). |
| H-licence | Every excerpt's licence is in the allowlist, its file has recorded licence evidence, and it passes the PD rule (9.2). |
| H-credits | The set of (corpus, licence) pairs in `attributions.json` equals the set in the manifest, and every CC BY item has a complete attribution record (9.3). |
| H-rules | An independent checker re-applies bar sums and H1 to H12 to the emitted documents (not to the pipeline's internal state). |
| H-dedupe | No two shipped excerpts share a fingerprint. No near-duplicate pair (6.10) lies outside one `dedupeGroup`. |
| H-determinism | Two builds from the same lock file are byte-identical. |
| H-render | Every excerpt renders in VexFlow in headless Chromium without exceptions, and transposes into band for at least 3 launch instruments in at least one allowed written key (01 §13.5). An excerpt that fails is listed with its reason in `review/excluded.yaml` and dropped on the next build. |
| H-review | Every shipped item that requires agent review (6.12) carries two accepting verdicts from a batch whose controls passed. |
| H-budget | Manifest and chunk sizes are within 01 §12. |
| H-viable | At least 300 excerpts in total (01's P5 milestone). For every launch instrument × served level, the selector returns an excerpt with random key and random meter. |

**Launch gates.** These block only the v1.0 release tag, not CI or `main` deploys:
- at least 1,000 excerpts in total;
- L2 to L9 each hold at least 40 excerpts;
- G2-launch: for every launch instrument × served level, at least 10 excerpts fit the tier band (02 §1.4) in at least 3 written keys allowed at that level, using the runtime fit function (7.3).

**Report-only gates.** These are printed in the gap table (`build/report.html`, a CI artifact):
- G1 meters. L1 and L2: 4/4 at least 60% of the level, and at least 10 excerpts in 3/4. L3+: 4/4, 3/4 and 2/4 each at least 15% of the level. From L4: at least 20 excerpts in 6/8 and at least 10 in 2/2 per level. Other meters at least 5 where allowed.
- G2-beta: as G2-launch, for beta instruments.
- G3 variety: no composer above 15% of a level (10% is impossible while Haydn is 23% of the String Quartets), no source above 75% of a level, and at least 2 sources per level from L3.
- G4 familiarity: at most 15% familiarity 2 per level.
- G5 mode: at least 12% minor per level from L2 (measured 15% in both corpora).
- Progress against the 5.1 targets.
- The agent level-agreement check (6.12 R4).

### 5.3 First histogram (published before any tuning)

Job C6 publishes `build/histogram.json` and a page in the report before C7 tunes anything. It holds:
- windows per level, by source, meter and mode;
- fitting excerpts per launch instrument × level × written key, as 02's open question 1 requests.

### 5.4 Repeat budget

Ranked play needs first sight. Ranked selection excludes every `dedupeGroup` the player has revealed on any instrument (02 §2.6 and §5.3). So **written keys do not multiply ranked capacity**, and augmented variants do not either. Under 02's pool rule (the level itself, at most 20% from L−1, stretch at 0.2):
- a player at L4 doing 10 ranked takes a day has about 3 to 5 weeks of first-sight material;
- at L1 the pool lasts days, so L1 is mostly practice in new keys (02 §3.1).

Growing L1 and L2 is the first job for later sources (Part B).

## 6. Ingestion pipeline (v1)

Location: `tools/corpus-build/`.
- Runtime: Python 3.12 or 3.13, `music21` pinned to 10.5.x, `python-ly` pinned, and `jsonschema` validating against `schemas/excerpt.schema.json`.
- Determinism: the same `sources.lock.yaml`, code and `review/verdicts.jsonl` produce byte-identical output. Keys are sorted, ids are stable, and the only date is `generatedAt` in the manifest, taken from the lock file.
- Interchange: every stage writes JSON Lines to `build/<stage>/` in the frozen candidate format `tools/corpus-build/schemas/candidate.schema.json`, with a `reason` on every rejection. Nothing is dropped silently.

### 6.0 Stage map

```
fetch -> licence + PD gate -> read/convert -> normalize -> melody extraction
  -> boundaries + cadences -> window proposal -> hard rules -> augmentation
  -> features + level -> quality + accompaniment filters -> dedupe
  -> automated review (rules, outliers, cached agent verdicts) -> emit -> validate (TS: render, fit)
```

### 6.1 Measured runtime

Measured on 4 vCPU and 15 GB RAM.
- Lieder: median parse 0.32 s per file, at most 0.72 s, 120 MB RSS per worker. A full parse plus window scan takes 167 s cold on 4 processes and 38 s warm from music21's pickle cache (59 MB).
- String Quartets: 409 s cold on 4 processes. The largest file (1,403 measures) takes 9.8 s at 462 MB peak.
- Projected full pipeline: about 15 minutes cold on 4 cores, with about 2 GB peak memory, excluding agent review.
- Agent review runs outside CI (6.12), so CI time does not depend on it.
- The corpus job runs only when `tools/corpus-build/**`, `sources.lock.yaml` or `review/verdicts.jsonl` change.

### 6.2 Licence and PD gate (per file, before parsing)

A file passes only if all of these hold:

1. **Encoding licence in the allowlist.**
   - OpenScore: repository-wide CC0 1.0, with the evidence being the hash of `LICENSE.txt` in the lock.
   - Mutopia: the `.ly` header's `license` or `copyright` field, matched by an exact table:
     - "Public Domain" maps to `PD`;
     - "Creative Commons Attribution 4.0" maps to `CC-BY-4.0`;
     - anything else rejects the file (BY-SA, BY 2.5, BY 3.0, MutopiaBSD, unknown).
2. **Composition public domain by the v1 rule** (9.2).
   - The composer's death year comes from OpenScore `data/composers.yaml`, normalised into the generated `composers.yaml`.
   - Composers outside that file are listed in `composers-extra.yaml`. In v1 this is only Lowell Mason (died 1872), plus any arranger a Mutopia header names. Each entry is agent-written and must cite a reference. It auto-passes only if the death year is 1900 or earlier. A later death needs two cited references, or the composer is rejected.
   - Traditional and anonymous pieces need a source-edition year of 1930 or earlier, parsed from the Mutopia header's `source` field. With no parseable year, the piece is rejected.
   - A composer with no verifiable death year is rejected. No human adds rows.
3. **Not on `denylist.yaml`** (takedowns and known misattributions; empty at launch).

### 6.3 Read and convert

| Input | Method | Acceptance |
| --- | --- | --- |
| OpenScore `.mxl` | `music21.converter.parse` directly | A parse failure skips the file with a reason (12 String Quartets files are expected to fail). |
| Mutopia `.ly` | `python-ly` (`ly musicxml`), then music21 | Accept only if every measure's duration equals the time signature (pickup and final bar excepted) and the conversion contains exactly one melodic part, or a soprano part that can be identified. Otherwise reject with a reason. Never queue for a human. |

This conversion step is job C3b and is **non-blocking**. If it yields nothing, the pipeline still passes. A LilyPond 2.24 event-listener export could rescue the SATB soprano lines; it is later.

Measure numbers are kept as printed (`measure.number`, plus `measureNumberWithSuffix` for "12a"), because attribution cites them.

### 6.4 Normalize

Applied to the whole part before windows are cut:

- Repeats and voltas stay as barline markers. Windows may not cross a repeat sign, a volta start, a segno, a coda or a D.C./D.S. instruction.
- Grace notes are removed with no time stolen, and the window is tagged `grace-removed`.
- Trills, turns and mordents: the ornament is removed, the principal note is kept, and the window is tagged `ornament-removed`. A measured tremolo rejects the window. These follow 02 §3.3.
- A fermata on the last note of a window is dropped and tagged `fermata-removed`. Any other fermata rejects the window.
- Dynamics, hairpins, articulations, slurs, ties and breath marks are kept as data. The renderer filters them by level, using 02's "Articulations shown" row.
- **Lyrics are stripped** (R8). Before stripping, the normalizer records an internal `lyricLineEnd` flag on notes whose syllable ends in `, ; : . ! ?`. It is used only as a boundary signal (6.6) and is never emitted.
- Clef changes are dropped. The app chooses the clef after transposition.
- Cue notes, ossia staves and editorial brackets are removed. A window containing an ossia is rejected.
- Tempo text and metronome marks are recorded at piece level. A tempo change inside a window rejects it.
- Durations are converted to ticks at TPQ = 480. A non-integer duration rejects the window.

### 6.5 Melody extraction

| Source | Candidate parts | Rule |
| --- | --- | --- |
| Lieder | Voice part only | Instrument is voice, or the part name matches `/(voice\|singstimme\|gesang\|chant\|soprano\|contralto\|alto\|tenor\|baritone\|bass\|stimme)/i`. Unmatched names are reported. Piano parts are not read. |
| String Quartets | Vn I, Vn II, Va, Vc | Each part is labelled with a role (`vn1`, `inner`, `cello`) for the filters in 6.9. |
| Mutopia | The single melodic line, or the soprano | Hymn bass lines are not used in v1. |

Within a part: a measure with a second voice that is not rests only, any chord or double stop, or any hidden note that carries needed duration rejects the window. There is no top-note simplification.

### 6.6 Boundaries and cadences (precision-first)

Published rule-based segmenters reach only about F1 0.6 to 0.7 against annotated folk-song boundaries (from memory of the Pearce, Müllensiefen and Wiggins comparison on Essen, not verified here). The design therefore needs **precision at window edges, not recall**.

**Allowed starts:** the piece or section start (double bar or rehearsal mark), the first note after a rest of at least 1 beat, a pickup of at most 2 beats that follows such a rest, the first note after a breath mark, or (Lieder) the first note after a `lyricLineEnd`. These match 02's H1.

**Allowed ends** (02 H2): the last note falls on a strong beat (beat 1, or beat 3 in 4/4, or beat 4 in 6/8), is at least 1 beat long or followed by a rest, and sits on a cadence degree:
- L1 and L2: degree 1 or 3;
- from L3: also a half cadence (degree 5 or 2) if the note is at least 2 beats long and followed by a rest (02 §3.2).

The end must also be followed by a rest, a barline of type double or final, or (Lieder) a `lyricLineEnd`.

Ranking only: LBDM (Cambouropoulos) over IOI, pitch interval and rest, plus a metrical prior (+0.15 at bar 4k+1 from the last strong boundary), orders candidate windows within a part. It never creates a start or an end.

Cadence labels for `cadenceEnd`:
- `PAC`: degree 1 approached by step from 2 or 7;
- `IAC`: degree 3, or degree 1 approached by leap;
- `HC`: degree 5 or 2.

**Key and mode.**
- Major and minor come from the key signature plus the piece's final note.
- If the piece's final is neither the major nor the minor tonic of its signature, the piece is modal. Its mode is derived from the signature plus the final (for example, 1 sharp with final A is A dorian), and windows must end on that final.
- Modal excerpts are tagged `modal` and served only when the key is random (R8, 02 §2.6).

**Silver-standard check** (automated, needs no human): on Lieder, at least 85% of window starts and at least 80% of window ends must coincide with a lyric-line boundary within 1 note. If they do not, the boundary rules are tightened before the build proceeds. This is a C5 acceptance test.

### 6.7 Window proposal and hard rules

**Proposal.** Propose every (allowed start, allowed end) pair spanning 8 to 12 full bars plus an optional pickup.
- At most one window may start in any given measure of a part.
- Windows from the same part may overlap by at most 50% of their bars.
- A 10- or 12-bar window is kept only if its level allows that length (02 §2.3 "Bars": L1 and L2 8 bars, L3 to L5 8 to 10, L6+ 8 to 12). Otherwise the pipeline tries the 8-bar sub-window with the same start. Bars are not a level feature.

**Hard rules.** Apply 02 §3.2 H1 to H7 as written, plus:
- H8. No crossing of a repeat sign, volta, segno, coda or D.C./D.S. instruction.
- H9. No unsupported content (the rejections in 6.4 and 6.5).
- H10. One key signature and one meter per window (R8; 02 H7). Tonicizations written with accidentals are fine.
- H11. If the window starts with a pickup, the final bar is completed with rests to a full bar (`final-bar-completed`). The exception is 02 H6: an incomplete source final bar that balances the pickup is kept as written.
- H12. No cut inside a slur, tie, tuplet or beam group (02 H4). No ending inside a sequence (02 H5). For H5, a sequence is a melodic interval pattern of at least 3 notes repeated at least twice at a transposition, and the window may not end before the pattern's last statement.

**Phrase-quality tag** (01's `phraseQuality`):
- `complete-phrase`: no interior allowed end;
- `period`: an interior HC or IAC near the midpoint, then a PAC at the end;
- `phrase-pair`: any other pair of complete phrases.

### 6.8 Features, level, augmentation, familiarity

**Features.** Computed per window, independent of the instrument, exactly as 02 §2.5 lists them:
- rhythm cells (02 §2.2), maximum interval, tonic-triad leaps, leaps per 4 bars, chromatic notes per 4 bars, double accidentals, span, mode, `peakNotesPerBeat`, `minIoiTicks`, `minRepeatIoiTicks`, `breathMaxGapBars`, `cadenceEnd`, `featureLevels` and `level`;
- 01's `DifficultyFeatures`.

**Level** = max(`featureLevels`) (02 §2.1).
- **Key is not a feature** (R1, 02 §2.1). The selector transposes, so the source key signature never moves the level. Mode is a feature.
- One derived feature, `density`, is added: the lowest level whose tempo range permits the window's peak density under 02's NPS cap and 01's IOI floors (`measurement-budget.json`, 01 §8.3), using the most permissive launch window class. Without it, a window could be tagged at a level where it can never be served.
- `levelConfidence` = the number of features at the maximum. A value of 1 means a single feature sets the level, which makes the window a stretch candidate.

Features defined here because 02 leaves them open:
- `syncopationIndex`: onsets on a weak subdivision whose duration crosses, or is tied across, the next stronger metrical position, divided by the note count.
- `restRatio`: rest ticks divided by window ticks, pickup excluded.
- `accidentalsOutsideKey`: pitch classes outside the key scale. In minor, the raised 6th and 7th are counted as `minorAlterations`, per 02's chromatic rule.
- `maxLeapSemis`: the largest interval between consecutive notes. Rests shorter than 1 beat do not break adjacency.
- `barRhythmLevel: number[]`: the rhythm feature level per measure, for 04's STARS "Rhythms" highlight.
- `extremes: { highId, lowId }`: event ids of the first highest and first lowest notes, for 04's "Signs" highlight.

**Augmentation ×2** follows 02 §3.3 exactly: a complete 4-bar phrase in 2/4 or 4/4 becomes 8 bars in the same meter; 8 bars of 2/4 become 8 bars of 4/4; 8 bars of 3/8 become 8 bars of 3/4. It never produces 2/2, 3/2 or 6/4, and never starts from 3/4 or 6/8.
- A variant is emitted whenever its re-tagged level is L1 to L3. These are the short levels, and the rule is fixed so the build stays deterministic.
- The variant's id gets the suffix `-aug2`, it carries `modifications += 'rhythm-augmented-x2'`, and it shares its original's `dedupeGroup`.
- The variant is disclosed in the source sheet as "note values doubled" (9.1).

**Familiarity.** v1 uses 0 and 2 only (02 §2.5).
- An agent writes `familiar.yaml`: about 40 well-known melodies that occur in the v1 sources, each as an incipit in the fingerprint format (6.10), plus a title list for Mutopia hymn tunes. Examples: Heidenröslein, Brahms's Wiegenlied, Die Forelle, Schubert's Ständchen, the Emperor Quartet theme, Old Hundredth, Ellacombe.
- A match on the first 8 fingerprint tokens, or an exact title match for Mutopia, sets familiarity 2. Familiarity-2 excerpts are practice only.
- A false positive only moves an item to unranked, so the list is not reviewed by a person.

### 6.9 Quality and accompaniment filters

**Hard rejects** (per window; thresholds live in `tools/corpus-build/config/filters.yaml`):

| Rule | Threshold |
| --- | --- |
| Rests | `restRatio > 0.25`, any rest of a bar or longer, or a leading rest over 1 beat |
| Repetition | a bar repeated literally more than twice in a row; repeated-note ratio > 0.35; tempo text matching `/recit/i` |
| Pitch variety | fewer distinct pitch classes than 02 §3.1 item 5 allows (3 at L1, 4 at L2, 5 at L3+) |
| Rhythm variety | fewer than 2 distinct rhythm cells at L2+ |
| Broken chords and Alberti figures | a 2-, 3- or 4-note interval pattern repeating over more than 50% of the intervals |
| Pedal alternation | n[i] = n[i−2] ≠ n[i−1] for more than 25% of the notes |
| Static contour | contour changes per note < 0.12, unless at least 70% of the intervals are steps (scales allowed) |
| Sustained harmony | more than 60% of the duration in notes of a bar or longer |
| String Quartets melodic role (inner parts and cello, L3+) | accepted only if interest ≥ Vn I's interest in the same bars, and fewer than 70% of the part's onsets coincide with Vn I onsets while Vn I has the higher interest. At L1 and L2 this test is skipped, and the lower interest threshold below applies (02 §3.1). |
| Cello bass function | more than 80% of downbeats are the lowest sounding pitch and more than 40% of intervals are 4ths or 5ths: tagged `bass-line`, kept only at L1 to L5 |
| Fragments | fewer than 12 notes per 8 bars |
| Detector limits | at the window's `density` level minimum tempo, the shortest pitch-change IOI or same-pitch repeat IOI is below the smallest floor in `measurement-budget.json` (01 §8.3). Per-instrument clipping happens at runtime (01 §6.3 step 6). |
| Encoding errors | a measure whose duration does not match the meter (pickup and final bar excepted), overlapping notes, or ties to a different pitch |

**Flags** (selection exclusions, not rejections):
- `noBreath`: fails 02 §2.4's breath rule; excluded for winds, brass and voice.
- `leapy`: more than 25% leaps at L1 to L6; excluded for winds and brass at those levels (02 §3.1 item 4).
- `bass-line`: see the cello bass-function rule above.

**Soft score**: 02's S1 to S5. Keep the window if the mean is at least 0.6.

**Melodic interest**: `interest = 0.3 × contourChanges/notes + 0.3 × min(1, distinctPCs/7) + 0.2 × rhythmCellEntropy/maxEntropy + 0.2 × (1 − repeatedNoteRatio)`.
- Reject below 0.35.
- For String Quartets inner parts and cello at L1 and L2, reject below 0.25 (02 §3.1).

**Threshold calibration, automated.** Each threshold in `filters.yaml` is fitted by C7 against two control sets drawn from the corpus by rule:
- positive controls: Vn I opening-theme windows ending in a PAC, and complete Mutopia hymn phrases;
- negative controls: viola and cello windows whose Vn I has interest at least 0.2 higher in the same bars, plus synthetic broken-chord renderings of the same harmony.

The target is at least 90% rejection of negatives at at least 70% acceptance of positives. The fitted values are committed. No hand-labelled windows are used.

### 6.10 Dedupe

- Fingerprint: the sequence of (interval in semitones, IOI ratio to the previous note quantized to {1/4, 1/3, 1/2, 2/3, 1, 3/2, 2, 3, 4}). It is invariant to transposition and to augmentation.
- Exact duplicate: identical fingerprint.
- Near duplicate: Jaccard similarity of 4-gram sets ≥ 0.8, or ≥ 0.7 within the same work. This catches Lieder strophes and quartet recapitulations.
- Survivor: the copy from the higher-priority source (OpenScore Lieder, then OpenScore String Quartets, then Mutopia), then the higher soft score, then the lower id. Losers are recorded with `dupOf`.
- An augmented variant joins its original's `dedupeGroup` by construction.
- `work` = composer + work key, shared by every window of a movement. G3 and 01's variety weight use it.

### 6.11 Attribution data

Each excerpt carries **structured** `source` fields (8.2), filled from source metadata and `composers.yaml`:
- composer, dates, work, catalogue, movement, part name, source measures;
- edition, encoder (OpenScore contributors, or the Mutopia maintainer), corpus, upstream reference (`repo@sha:path`);
- licence id and licence URL.

The pipeline writes no prose credit string. 04's `copy/en.json` formats the text, and the runtime appends the "Adapted" clause from `modifications` plus the actual transposition (9.1).

### 6.12 Automated review (replaces the human queue)

Every layer can only reject. Nothing waits for a person.

**R0 Rules.** Everything in 6.2 to 6.10, plus the TS-side render and fit check (H-render).

**R1 Statistical outliers**, per level:
- Flag the top and bottom 2% by robust z-score on notes per bar, peak notes per second, rest ratio, interest, span and syncopation index. Reject a window flagged on 2 or more metrics.
- Reject `levelConfidence == 1` above L6. At L6 and below these are kept as stretch candidates.
- Reject major or minor windows whose Krumhansl-Schmuckler key disagrees with the signature-plus-final key. The first draft sent these to human review.

**R2 Agent veto.** Required for:
- every candidate at L1 to L3;
- augmented variants;
- String Quartets inner-part and cello windows;
- items flagged on exactly 1 outlier metric;
- items with interest within 0.10 above its threshold.

Everything else at L4+ ships on R0 and R1 alone. How it works:
- `python -m corpus_build review-export` writes the queue (`review/queue/<promptVersion>/*.jsonl`). Each item has the window as ABC text, a bar-by-bar note list and its features. The title and composer are withheld.
- An agent job (C8r, outside CI) runs two independent passes with different prompt variants (`rubric-v1-a`, `rubric-v1-b`). It uses the strongest model tier for L1 to L3 and a mid-size model for the rest.
- Each verdict has the shape `review/verdict.schema.json`: complete phrase, conclusive end, accompaniment-like, idiomatic for winds, level plausible, accept or reject, and reasons.
- An item is accepted only if both passes accept it. An item that requires review but has no verdict for the current `promptVersion` is excluded from the build and reported. It does not fail the build.

**R3 Controls inside every batch.**
- 10% of each batch are blind controls:
  - negatives: a window cut 1 bar early, a window shifted by 1 beat, a rhythm-preserving pitch shuffle, an accompaniment part;
  - positives: PAC-ending opening themes, complete hymn phrases.
- A batch's verdicts are used only if its negatives are rejected at least 90% of the time and its positives accepted at least 75%.
- A failing batch is re-run once with the other prompt variant first. If it still fails, its items stay excluded, which is conservative. The report counts them.

**R4 Level agreement (report-only).** An agent rates the level of 200 stratified excerpts. A disagreement of more than 1 level on more than 20% of them is reported as a warning for 02. It is not blocking, because agents reading notation as text are a weak musical judge.

**Determinism.** Verdicts live in the committed `review/verdicts.jsonl`, keyed by `contentHash` plus `promptVersion`. CI only reads them and never calls a model. Rebuilds are byte-identical, and only new hashes need review.

**Honest limit.** The rules and outlier layers are the main gate. The agent layer is a veto, measured by its own controls.

### 6.13 Emit

Writes to `public/corpus/v1/` the files listed in 01 §6.2:
- `index.json` (no-cache): the corpus version, the hashed manifest name, and every chunk with its content hash and byte size (05 §5.4).
- `manifest.<hash>.json`: column-oriented and dictionary-encoded (7.1), with a `stats` block (7.1).
- `shard-L<level>-<n>.<hash>.json`: at most 64 excerpts per chunk, ordered by id within the level. The manifest entry names its chunk.
- `attributions.<hash>.json`: per collection and per CC BY item, structured credit records (9.3).
- `withdrawn.json` (no-cache, not hashed): ids removed after a takedown. The selector skips them even if a cached chunk still holds them.

It also writes:
- `LICENSES/` in the repo root: full texts of CC0 1.0 and CC BY 4.0, plus the corpus's own CC0 statement for our contributions.
- `build/report.html` and `build/histogram.json` (CI artifacts, not shipped): counts per cell, gates, rejections by reason and source, review status.

Size, at about 60 notes per excerpt with no lyrics: about 7.5 KB raw and 1.5 to 2 KB gzip per excerpt. That gives 9 to 14 MB raw (about 2.5 to 3.5 MB gzip) for 1,200 to 1,800 excerpts. The manifest is about 30 to 45 KB gzip and a chunk about 110 KB gzip, within 01 §12. The total is well under 05's 30 MB bundling ceiling.

## 7. Index, selection inputs, and transposition (v1)

01's P9 packages implement this section. 02 §2.6 owns the selection policy (pool mix, stretch, ranked exclusion). This section owns the fit, the spelling and the rejection rules.

### 7.1 Manifest entry and stats

```ts
interface ManifestEntry {
  id: string; shard: string; level: number; meter: string; fifths: number; mode: 'major' | 'minor';
  modal: Mode | null;                       // non-null only for modal pieces (6.6); random key only
  bars: number; pickup: boolean; rangeConcert: [number, number];
  minBpm: number; maxBpm: number; minIoiTicks: number; minRepeatIoiTicks: number;  // runtime tempo clipping without loading a chunk
  composer: string; title: string; work: string; tags: string[]; originalFamily?: string;   // dictionary-encoded
  cadenceEnd: 'PAC' | 'IAC' | 'HC'; familiarity: 0 | 2;
  featureLevels: Record<string, number>;    // stretch detection (02 2.6)
  flags: ('noBreath' | 'leapy' | 'bass-line')[];
  dedupeGroup: string; corpus: CorpusId; license: Licence;
}
interface ManifestStats {                   // for 04: hide or label empty combinations, disable thin meter chips
  servedLevels: number[];                   // levels with at least 30 excerpts (5.1)
  fit: Record<string /*instrumentId*/, Record<number /*level*/, Record<string /*meter*/, number>>>;  // excerpts fitting the tier band in at least one allowed written key
}
```

Serialization: `{ "columns": [...], "rows": [[...]], "dict": { "composer": [...], "title": [...], "work": [...], "tags": [...] }, "stats": {...} }`. A linear scan over 1,800 entries with typed-array columns takes well under 1 ms, so there is no inverted index. `originalFamily` is kept for later weighting and carries no weight in v1.

### 7.2 Filtering inputs

01 §6.3 step 3 applies these. This section defines what the flags mean:

- `familiarity == 2` is excluded from ranked attempts (02 §5.2).
- `noBreath` is excluded for winds, brass and voice. `leapy` is excluded for winds and brass at L1 to L6.
- `bass-line` is served only to instruments whose primary clef at that level is bass, and only at L1 to L5.
- `modal != null` is served only when the written key is random (R8).
- Ids in `withdrawn.json` are skipped.

### 7.3 Range fit in closed form

Notation:
- `I = {d_I, c_I}`: the instrument interval (written minus sounding, per 01 `Instrument.writtenMinusSounding`);
- `[bMin, bMax]`: the band for the level, the tier band in written MIDI from 02 §1.4 (`instruments.json`). The full band is used, with no margin;
- `[lo, hi]`: the excerpt's concert range.

The concert semitone shifts `t` that fit form the integer interval

```
tMin = bMin - c_I - lo
tMax = bMax - c_I - hi
fits iff tMin <= tMax
```

For a requested written key `Kw`:
1. The concert key is `Kc = transposeKey(Kw, −I)`.
2. The pitch-class shift from the excerpt's concert key `Ks` is `p = (pc(tonic(Kc)) − pc(tonic(Ks))) mod 12`.
3. The candidates are `t = p + 12k`. The excerpt fits that key if and only if some candidate lies in `[tMin, tMax]`.

This is O(1) per entry. The build uses the same function for `stats.fit` and G2.

### 7.4 Spelled transposition

1. **Choose `t`** among the fitting candidates: the largest minimum margin to the band edges (02 §1.4 preference), then the smallest `|t|`.
2. **Build the interval** `{diatonic, chromatic: t}`. `diatonic` is the letter distance from `tonic(Ks)` to `tonic(Kc)`, in the direction of `t`, extended by 7 per octave (`theory.intervalBetweenKeys`, 01 §5.3).
3. **Apply it.** `transposePitch` each note in concert pitch, then apply `I` for the written pitch. Original spellings (leading tones, chromatic passing notes) are preserved relative to the key.
4. **Key signature**: `transposeKey(Ks, interval)`. For modal excerpts, the signature and the final move by the same interval.
5. **Target key spelling**: exactly the requested written key. Random keys are drawn by 01 §6.3 from `levels.json` (02 §2.6).
6. **Clef**: among the instrument's clefs allowed at the level (02 §1.3 and §2.3), the one that minimizes ledger lines for this excerpt's written range. Ties go to the primary clef.

### 7.5 When to reject instead of transposing

The selector moves to the next candidate when any of these hold. Notes are never edited to make an excerpt fit.

1. No whole-excerpt shift fits the band in the requested key, including whole-octave displacement (7.3).
2. The excerpt's span exceeds the band's span.
3. The transposed spelling has a double sharp or double flat below L8, more than 2 at any level, or any triple accidental.
   - If the written key was random, retry once with the enharmonic key (C♯ ↔ D♭, F♯ ↔ G♭, B ↔ C♭), as 02 §3.3 allows.
   - If the player chose the key, reject, because the written key the player asked for must not change (R1).
4. Mode mismatch: major only to major targets and minor only to minor targets. Modal only under a random key.
5. Tempo: the excerpt's `[minBpm, maxBpm]`, intersected with the level's tempo range and clipped by 02's NPS cap and 01's IOI floors, is empty.

There is no separate ledger-line rule. The tier band is the only range constraint (02 §1.4). Idiom-locked keys are later.

## 8. Excerpt JSON schema

01 §6.1 is the binding type. It already folds in this section's first-round fields: `Licence`, `CorpusId`, no lyrics, `modifications`, `dedupeGroup`, `featureLevels` and `review`.

### 8.1 Example document

This example is illustrative. Pitches and ids are placeholders, and ticks are at TPQ = 480.

```json
{
  "schemaVersion": 1,
  "id": "schubert-d257-voice-m1-8-aug2",
  "source": {
    "composer": "Franz Schubert", "composerDates": "1797–1828", "composerDeath": 1828,
    "work": "Heidenröslein", "catalog": "D 257", "partName": "Voice",
    "sourceMeasures": [1, 4],
    "edition": "First edition, Vienna 1821 (as transcribed by OpenScore)",
    "encoder": "OpenScore Lieder contributors", "corpus": "openscore-lieder",
    "upstreamRef": "OpenScore/Lieder@38c5db51:scores/Schubert,_Franz/.../lc1234567.mxl",
    "sourceUrl": "https://github.com/OpenScore/Lieder",
    "license": "CC0-1.0", "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
    "originalInstrument": "voice"
  },
  "meter": { "beats": 2, "beatType": 4, "countUnitTicks": 480, "countsPerBar": 2 },
  "keyConcert": { "fifths": 1, "mode": "major" }, "modal": null,
  "tempo": { "minBpm": 60, "maxBpm": 84, "marking": "Lieblich" },
  "pickupTicks": 0,
  "measures": [ { "index": 0, "isPickup": false, "startTick": 0, "events": [
    { "id": "e1", "kind": "note", "tick": 0, "dur": 480, "pitch": { "step": "D", "alter": 0, "octave": 5 }, "slur": "start" },
    { "id": "e2", "kind": "note", "tick": 480, "dur": 480, "pitch": { "step": "D", "alter": 0, "octave": 5 }, "slur": "stop" } ] } ],
  "rangeConcert": { "min": 62, "max": 74 },
  "features": { "noteCount": 22, "notesPerBeat": 0.9, "shortestDur": 480, "maxLeapSemis": 5, "spanSemis": 12 },
  "rhythmCells": ["Q", "H"],
  "featureLevels": { "meter": 1, "rhythm": 1, "interval": 1, "leaps": 1, "span": 1, "mode": 1, "chromatic": 1, "double": 1, "density": 1 },
  "level": 1, "levelConfidence": 9,
  "barRhythmLevel": [1, 1, 1, 1, 1, 1, 1, 1],
  "extremes": { "highId": "e9", "lowId": "e14" },
  "cadenceEnd": "PAC", "phraseQuality": "complete-phrase", "breathMaxGapBars": 4,
  "familiarity": 2, "flags": [], "tags": ["lied", "stepwise"],
  "dedupeGroup": "fp-7c1e9a40", "work": "schubert|d257",
  "modifications": ["excerpted", "lyrics-removed", "rhythm-augmented-x2"],
  "quality": { "soft": 0.8, "interest": 0.46 },
  "review": { "rules": "rules-1.0.0", "llm": "accepted", "promptVersion": "rubric-v1",
              "llmVerdicts": [ { "pass": 1, "verdict": "accept", "reasons": [] }, { "pass": 2, "verdict": "accept", "reasons": [] } ] },
  "contentHash": "sha256:..."
}
```

(Heidenröslein is on `familiar.yaml`, so this excerpt is familiarity 2: practice only.)

### 8.2 Schema changes requested from 01 (fold into `src/core/types.ts` in P0b)

| Change | Why |
| --- | --- |
| Remove `source.attribution: string` | The UI formats the credit from structured fields and copy (04). |
| Remove `idiomLocked` | Idiom-locked transposition is later. |
| Add `barRhythmLevel: number[]` and `extremes: { highId: string; lowId: string }` | 04's STARS Rhythms and Signs highlights |
| Add `'density'` to the `featureLevels` keys | 6.8 |
| Add `source.sourceEditionYear?: number` | PD evidence for traditional and anonymous pieces (6.2) |
| Add `review.llm: 'accepted' \| 'not-required'` | Which items went through the agent veto (6.12). Rejected or unreviewed items are never emitted. |
| `familiarity: 0 \| 2` in v1 (keep `1` in the type for later) | 02 §2.5 |
| `ManifestEntry` as in 7.1 (adds `modal`, `minIoiTicks`, `minRepeatIoiTicks`, `corpus`) and a `ManifestStats` type | Runtime tempo clipping; 04's empty-state and chip logic |
| `modifications` vocabulary is 01's list. The runtime adds `transposed` and `octave-displaced`. | Unchanged |

## 9. Legal and attribution requirements

This is not legal advice. Counsel should review 9.2 before any paid launch.

### 9.1 What the UI must show (v1)

1. **Before and during the take: no title, no composer.** A recognised tune gets played by ear, not read. The scan cover shows only key, meter, tempo, bars and clef.
2. **CC BY items only (in v1, one Mutopia piece):** one quiet, non-identifying source line in the scan and performance chrome, for example "Typeset by {encoder} · Mutopia Project · CC BY 4.0", linking to the licence. CC BY 4.0 requires the creator credit and licence notice "in any reasonable manner based on the medium" while the work is displayed. It does not require the title. PD and CC0 items show no line.
3. **On-demand "About this music" sheet** in scan, as 04 proposes. It is allowed for every item, and opening it does not change ranked status.
4. **Stop or skip:** the confirm sheet and the skip toast end with the credit, so music that was displayed is always credited (04).
5. **Results header, history, attempt detail:** `{composer} ({dates}) · {work}, {catalog} · bars {a}–{b} · {licence short name}`, using the source bar numbers. For augmented items, the bars are the source bars.
6. **Source sheet:**
   - edition, encoder, corpus;
   - licence name linked to the licence URL;
   - the upstream link;
   - an "Adapted" line built at runtime from `modifications` plus the transposition, written key first (R1). Example: "Excerpted, note values doubled, transposed. Written for E♭ alto saxophone in G (concert B♭)."
7. **Credits page** (Settings > About, and a footer link on Home), generated from `attributions.json`:
   - every collection with its licence and link;
   - "OpenScore Lieder" and "OpenScore String Quartets" named, with links (their courtesy request);
   - "Mutopia Project" with a link;
   - a full TASL entry for every CC BY item (title, author, source, licence, changes);
   - links to the licence texts;
   - a "Report a rights problem" mailto link;
   - no source logos and no wording that implies endorsement.
8. **Takedown:** add the id to `withdrawn.json` and redeploy. The next build also adds it to `denylist.yaml`.
9. **iOS** (later fork): the same credits page and in-take line, bundled unchanged. The allowlist is referenced by id (`PD`, `CC0-1.0`, `CC-BY-4.0`), not restated.

Exports are later. The rule is fixed now: any future export embeds the attribution (MusicXML `<identification><rights>` and `<work>`).

### 9.2 Public-domain rule (v1, automated)

- **Composer** (and any arranger a Mutopia header names): died before 1 January 1931, by the source metadata or `composers-extra.yaml` (6.2). This satisfies life+70 (death before 1956 in 2026) with a wide margin. Because v1 has no per-work publication dates, it also makes US publication before 1931 near-certain for editions that OpenScore transcribes from IMSLP-hosted first or early editions. Composers who died between 1931 and 1955 are later, once publication dates can be verified.
- **Traditional and anonymous:** a source edition from 1930 or earlier (6.2).
- **Lyricists are irrelevant**, because no lyrics are shown (R8).
- **Editions:** OpenScore's first-edition policy plus its CC0 release, and Mutopia's rule that source editions must be PD. We never encode editorial fingerings or modern editorial markings.
- The cutoff year is a constant in `tools/corpus-build/config/pd.yaml`, recomputed each January.

### 9.3 Licence handling

- **PD and CC0:** no conditions. We credit anyway, as a courtesy and for provenance.
- **CC BY 4.0:** creator credit, licence notice and link, and an indication of changes. These are met by 9.1 items 2, 6 and 7. `attributions.json` holds a record per CC BY item: `{ id, title, creator, sourceUrl, licence, licenceUrl, changes }`.
- **Our corpus output** (segmentation, features, levels, augmented variants) is released under CC0 1.0. Upstream CC BY attributions stay attached to their excerpts.
- **Excluded in v1:** CC BY-SA (R8), CC BY 2.5 and 3.0 (title-attribution clause), NC, ND, GPL, ODbL, research-only, and anything unclear.

## 10. Repertoire by family (v1 sources only)

| Family (02 §1.1) | Best v1 material | Levels |
| --- | --- | --- |
| Voice | Lieder voice lines (Schubert, Schumann, Brahms, Mendelssohn, Fanny Hensel, Clara Schumann, Loewe, Wolf, Grieg and others in OpenScore) | L1 to L8 (L1 and L2 mostly augmented) |
| Flute, clarinet, sax, trumpet | Lieder lines (built from phrases, written for breath, tonal), String Quartets Vn I from L3, Mutopia hymn and folk tunes at L1 to L4 | L1 to L9 |
| Violin | String Quartets Vn I and Vn II, Lieder lines | L1 to L10 |
| Cello | String Quartets cello and viola lines (melodic-role filtered), `bass-line` windows at L1 to L5 | L1 to L10 |
| Piano RH | The treble melodic corpus | L1 to L8 |
| Beta bass-clef and alto-clef instruments | String Quartets cello and viola lines, and `bass-line` windows | as available |

Composer concentration is a known skew: Haydn in the String Quartets, and Parratt and Brahms in the low-level Lieder windows. G3 reports it, and 01's `work` variety weight softens it at runtime.

## 11. Acceptance criteria (v1)

1. `python -m corpus_build` from a clean checkout plus the fetched cache regenerates `public/corpus/v1/` byte-identically. CI runs it twice and diffs.
2. All CI hard gates in 5.2 pass. The gap table and histogram are published as CI artifacts.
3. Rule fixtures: at least 40 small MusicXML fixtures, each targeting one rejection path (6.4 to 6.9, H1 to H12, the licence and PD gates). Each fixture is rejected for exactly its intended reason.
4. Silver-standard boundary check on Lieder: at least 85% of starts and at least 80% of ends match a lyric-line boundary within 1 note.
5. Filter calibration: at least 90% negative-control rejection at at least 70% positive acceptance (6.9). Review controls per batch as in 6.12 R3.
6. Transposition property test over 10,000 random (excerpt, instrument, written key, level) requests. Whenever the selector returns an excerpt:
   - every written note is inside the band;
   - the key signature equals the request, or its enharmonic only when the key was random;
   - every interval between consecutive notes keeps its diatonic and chromatic size;
   - no double accidental appears below L8.
7. `withdrawn.json` removes an id at runtime without a rebuild (test with a cached chunk).
8. The credits page lists every (corpus, licence) present in the manifest (set equality test). A CC BY fixture excerpt renders the in-take source line. PD and CC0 fixtures render none.
9. `stats.fit` equals a brute-force recomputation with the runtime fit function on the fixture corpus.

## 12. v1 work packages

Sizes: S under about 150 lines plus tests, M 150 to 400, L above 400 or algorithmically subtle. Python jobs live in `tools/corpus-build/`. The runtime (7) is built as 01's P9a to P9c, and this section supplies their spec and the property test.

| Id | Package | Depends on | Size / difficulty |
| --- | --- | --- | --- |
| C1 | Fetch and lock | 01 P0a | S / routine |
| C2 | Licence and PD gate, `composers.yaml` generation | C1 | S / routine |
| C3a | MusicXML reader and normalizer (6.3, 6.4) | C1, frozen candidate schema | M / moderate |
| C3b | Mutopia converter (python-ly plus strict validation), non-blocking | C1, C2 | S / moderate |
| C4 | Melody extraction and part roles (6.5) | C3a | S / routine |
| C5 | Boundaries, cadences, mode, window proposal, H1 to H12, augmentation (6.6, 6.7, 6.8) | C4, 02 config | L / hard |
| C6 | Features, level tagger, `density`, histogram (6.8, 5.3) | C5, 02 `fixtures/levels/feature-vectors.json` | M / moderate |
| C7 | Quality and accompaniment filters, interest, control-set calibration, dedupe, `familiar.yaml` (6.8 to 6.10) | C6 | M / hard |
| C8 | Automated review layer: outliers, K-S check, queue export, controls, verdict cache and application (6.12) | C7, frozen verdict schema | M / hard |
| C8r | Agent review run: two passes over the queue, controls, R4 level report | C8 | M / hard (strongest model for L1 to L3) |
| C9 | Emitter: manifest columns and stats, chunks, `index.json`, attributions, withdrawn, LICENSES, report, gates (6.13, 5.2) | C8, 01 P0b schemas | M / moderate |
| C10 | TS corpus validation: VexFlow headless render, fit to 3 launch instruments, selector non-empty per instrument × served level, `stats.fit` cross-check (H-render, H-viable) | C9, 01 P7, P9b | S / moderate |

Order: C1 → C2 → C3a → C4 → C5 → C6 → C7 → C8 → C9 → C10. C3b runs in parallel after C2. C8r runs after C8 and then triggers a rebuild. 01's P5 milestone (at least 300 excerpts before wave 2 ends) is reachable after C9 without C8r, because L4+ items that need no review ship on R0 and R1.

## Open questions (still open after the rulings)

1. **L1 viability.** The L1 count under 02's relaxed L1 rules is unknown until C6's histogram. If L1 has fewer than 30 excerpts, this section marks it unserved (5.1). The overseer should confirm that shipping without a served L1 is acceptable, with placement at L2 and L1 as practice only. My recommendation is yes.
2. **CC BY in-take line.** 04's first draft shows credit only after the take and in an on-demand sheet. CC BY 4.0 needs the quiet source line during the take (9.1 item 2). v1 holds a single CC BY 4.0 piece. If 04 does not adopt the line, drop CC BY items from v1 (`pd.yaml` allowlist flag) rather than weaken the legal position.

## Dependencies on other roles

- **01:** the 8.2 type changes in P0b. `schemas/excerpt.schema.json` and the candidate and verdict schemas frozen in P0. P9a to P9c implement section 7 and run the 11.6 property test. P7 exposes a headless render entry point for C10. Budgets in §12 stay as they are (manifest ≤ 60 KB gzip, chunk ≤ 128 KB gzip).
- **02:** `levels.json` (cells, intervals, span, mode, bars, tempo, NPS) and `fixtures/levels/feature-vectors.json` before C6. Confirm the derived `density` feature (6.8). Tier bands in `instruments.json`. Widen tier A per 02's open question 1 if C6's histogram shows a thin key.
- **04:** the CC BY in-take source line (9.1 item 2); the results header and source sheet from structured fields; credits page; "More music coming" for unserved levels and meter chips disabled below 5 from `stats.fit`; the STARS highlights from `barRhythmLevel` and `extremes`.
- **05:** bundles `public/corpus/v1/` unchanged in the later fork, verifies `index.json` hashes, and honours `withdrawn.json`. The v1 size is 9 to 14 MB raw. Schema v2 for polyphony is not scheduled in this build.
- **Overseer:** schedule C8r as an agent task on the strongest model tier for L1 to L3; open questions 1 and 2.

---

# Part B — Later (not built in this build)

Brief by design. Each item needs an RFC before work starts.

- **Sources:**
  - PDMX CC0 and PDM subset (needs zenodo.org; the dataset-level licence still to confirm);
  - KernScores and humdrum repositories, and music21 corpus directories, each with a verified CC0 or CC BY licence;
  - Mutopia CC BY 2.5 and 3.0 items (the 57 Swedish 1814 dances) after counsel confirms delayed-title attribution;
  - Mutopia solo Baroque (Bach BWV 1001 to 1013, Telemann) and SATB soprano lines via the LilyPond 2.24 event-listener converter;
  - DCMLab corpora once their licences are checked.
- **In-house encoding and OMR** from PD scans (IMSLP once reachable): method books and etudes (Wohlfahrt, Kayser, Kopprasch, Arban 1864, Ferling, Concone, Dotzauer), Erk-Böhme folk songs and PD hymnals. The clean-room rule applies: encode only from the PD print, never from restricted encodings (Essen, the chorales, The Session). These are the main way to grow L1 and L2.
- **Composers who died 1931 to 1955** (Elgar, Ravel, Bartók, Berg, Strauss, Schoenberg, Quilter, Ives and others) once publication dates are verified per work.
- **Musical features:** modal excerpts on a fixed key; key and meter changes inside an excerpt; lyrics display (with the lyricist added to the PD rule); ornaments and graces; idiom-locked keys for open-string and natural-horn writing; familiarity 1; rhythmic diminution variants.
- **Review:** a human calibration sample and human review queue; "report a problem" feeding `withdrawn.json`.
- **Unranked "Familiar tunes" pack** (30 to 50 PD tunes), cross-checked between sources.
- **Schema v2 polyphony** (Lieder piano parts, keyboard works) for Web MIDI and two-hand reading.
- **Bundling growth:** above 30 MB, On-Demand Resources or a remote manifest (05).

---

## Review log (revision 2)

Rulings applied:
- R1: written key throughout. Key removed as an excerpt feature. An explicit written key is never respelled (7.5).
- R2: tier bands, tolerances, NPS caps, levels and selection policy referenced to 02 and 01 instead of restated. The 1-semitone band margin and the ledger-line limits were removed.
- R3: the human review queue, human calibration sample, hand-labelled interest calibration, human `composers.yaml` rows, idiom-lock sign-off and in-house encoding (C10, 120 to 150 hours) were removed. Replacements: rules, outliers, the agent veto with controls, control-set calibration, and composer dates from source metadata.
- R4: sources limited to three GitHub repositories with verified licences and a reachability report. PDMX, KernScores, IMSLP, the music21 corpus and the Mutopia website moved to Later.
- R8: lyrics, the lyricist PD check, the `has-lyrics` flag and `NoteEvt.lyric` removed (lyric punctuation kept as an internal boundary signal). CC BY-SA excluded. One key and one meter per excerpt. Modal only under a random key.
- R9: MusicXML export moved to Later.
- R12: iOS needs only the unchanged corpus files, the size estimate and the allowlist id reference.

Own cross-examination answers applied:
- Q1: new v1 source table with paths, counts, SHAs and licence evidence; sparse fetch; measured yield and projection (section 4); the MuseScore step removed.
- Q2: augmentation as the L1 and L2 route (now per 02 §3.3); Mutopia hymn and folk tunes; AI encoding from memory rejected (Later only as an unranked pack).
- Q3: the accompaniment and melodic-role filters, the recitative and repeated-note rules, and automatic threshold calibration (6.9).
- Q4: precision-first boundaries, the silver-standard lyric check, and the layered automated review with a committed verdict cache (6.6, 6.12).
- Q5: measured runtime, bundle sizes and the chunked lazy-loading layout (6.1, 6.13).
- Q6: allowlist narrowed to PD, CC0-1.0 and CC-BY-4.0; the in-take source line for CC BY items (9.1).
- Q7: the 1,200 target, per-level floors and gates G1 to G7, since restructured into CI hard gates, launch gates and report-only gates (5.2).

Changed from my answers after the other roles' input:
- The level ±1 pool is dropped; 02 §2.6 owns the pool mix.
- The repeat budget no longer multiplies by written keys, because ranked exclusion is by `dedupeGroup`.
- "The build fails below 1,000" became a launch gate. The LLM level-agreement gate became report-only.
- Agent review covers L1 to L3 and flagged items, not every candidate.
- Modal pieces are tagged and served under a random key, as 02 keeps them, instead of being rejected.
- 10- and 12-bar windows are kept only at levels that allow that length.
- A `density` feature was added.

Other changes:
- Section 0 scope table and Part B. Structured attribution replaces the prose string.
- `barRhythmLevel` and `extremes` added for 04.
- A `stats` block in the manifest for 04's empty states.
- `minIoiTicks` and `minRepeatIoiTicks` added to the manifest for runtime tempo clipping.
- `index.json` lists chunk hashes and sizes for 05.
- PD cutoff set at composer death before 1931.
- Work packages re-cut as C1 to C10, plus C3b and C8r.
- Open questions reduced from 8 to 2.
