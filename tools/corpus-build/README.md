# corpus-build

Python pipeline that turns the pinned public-domain sources into the shipped corpus (spec: `docs/spec/03-score-corpus.md`).
This directory currently holds jobs C1 (fetch and lock), C2 (licence and public-domain gate), C3a (read and normalize), C4 (melody extraction and part roles) C5 (boundaries,
cadences, mode, window proposal, hard rules, augmentation), C6 (difficulty features, level tagging, density, first histogram) and C7 (quality and
accompaniment filters, interest, control-set calibration, familiarity, dedupe). Later stages (C8 onward) register in `corpus_build/cli.py` and write to `build/<stage>/`.

## Run

```
pip install -r tools/corpus-build/requirements.txt
cd tools/corpus-build
python -m corpus_build                 # fetch, verify, composers, gate, read, normalize, extract, windows, augment
python -m corpus_build lock            # only after changing a pinned SHA in sources.yaml
python -m corpus_build verify gate     # re-run without the network
python -m corpus_build read normalize extract   # C3a and C4 only (about 3 minutes on 4 cores; --workers N, --corpus ID, --limit N)
python -m corpus_build windows augment          # C5 only (about 50 s on 4 cores; needs build/extract)
python -m corpus_build features                 # C6 only (about 8 s; needs build/augment)
python -m corpus_build filters dedupe           # C7 only (about 15 s; needs build/features and build/extract)
python -m corpus_build calibrate                # C7 developer stage: refit config/filters.yaml thresholds (about 40 s)
python -m corpus_build familiar                 # C7 developer stage: recompute the incipits in familiar.yaml
python -m pytest                       # tests (real-source tests skip if the cache is empty)
```

`make -C tools/corpus-build all|lock|test` does the same. Python 3.12 or 3.13.

## Files

| Path | What |
| --- | --- |
| `sources.yaml` | the three sources: URL, pinned SHA, sparse paths, licence policy, dedupe priority. `id` equals `CorpusId`. |
| `sources.lock.yaml` | generated. SHA-256 of every file used and of each upstream `LICENSE.txt`. Committed. |
| `composers.yaml` | generated from OpenScore `data/composers.yaml` (name, born, died). Committed. |
| `composers-extra.yaml` | composers outside that file (Lowell Mason). Each entry cites references. |
| `denylist.yaml` | takedowns and misattributions, by id, path prefix or composer. Empty at launch. |
| `config/pd.yaml` | the public-domain cutoff constants (composer died before 1931, edition year 1930 or earlier). |
| `config/licences.yaml` | the allowlist (`PD`, `CC0-1.0`, `CC-BY-4.0`) and the Mutopia header table. |
| `config/filters.yaml` | quality and accompaniment thresholds (C7), with the calibration record of the fitted ones. |
| `familiar.yaml` | familiar tunes (03 6.8): where each is in the corpus, and its generated incipit. |
| `schemas/candidate.schema.json` | the JSON Lines record every stage writes. |
| `build/` | git-ignored stage output. |

## Clone cache

Clones live outside the repo: `$SIGHT_READING_CORPUS_CACHE`, else `~/.cache/sight-reading-corpus/<source id>`. Each is a
blobless sparse clone at the pinned SHA (about 50 MB, 80 MB and 9 MB). `--cache DIR` overrides both. `$SIGHT_READING_CORPUS_BUILD`
or `--build DIR` moves the stage output.

## Stages

1. `fetch` clones or updates each source and checks out its pinned SHA. A missing optional source (Mutopia, ruling 27) is skipped with a warning.
2. `lock` hashes every file and writes `sources.lock.yaml`. `lockedAt` is kept unless the contents change, so reruns are byte-identical.
3. `verify` fails if the cache differs from the lock in any file or SHA, then writes `build/fetch/candidates.jsonl` (one `kind=file` record per score file).
4. `composers` regenerates `composers.yaml`.
5. `gate` writes `build/gate/candidates.jsonl` and `summary.json`: one record per file, passed or rejected with a reason.

## The gate (03 section 6.2)

A file passes only if, in this order:

1. its bytes match the lock, and its licence is allowed. OpenScore: the repository's `LICENSE.txt` must match the lock's hash and contain "CC0 1.0 Universal". Mutopia: the header's `license` or `copyright` must resolve to `PD` or `CC-BY-4.0` (exact strings, or a LilyPond `\markup` that names exactly one allowed family). BY-SA, BY 2.5, BY 3.0, NC, ND, GPL, a missing or unknown licence, and fields that disagree all reject.
2. the composition is public domain: composer died before 1931 (OpenScore metadata or `composers-extra.yaml`; no death year means reject), or, for Traditional and Anonymous pieces, the `source` header names an edition year of 1930 or earlier (the latest year in the text counts; no year means reject). Arrangers named in the header must be verified in `composers-extra.yaml` too. An extra entry passes with one reference if the composer died in 1900 or earlier, and needs two otherwise.
3. it is not on `denylist.yaml`.

Rejection codes are in `schemas/candidate.schema.json` (`$defs.gateReason`).

## Adding a composers-extra entry

Only with citations, and only for a composer that a source actually names. Do not guess a death year. See the header of `composers-extra.yaml`.

## Read, normalize, extract (03 sections 6.3 to 6.5, jobs C3a and C4)

Input is `build/gate/candidates.jsonl` (files that passed). Mutopia files are not read here (job C3b).

| Stage | Module | Writes | What |
| --- | --- | --- | --- |
| `read` | `read.py` | `build/read/` | `music21.converter.parse` on each OpenScore `.mxl`. A parse failure rejects the file (`parse-failed`). Candidate parts (`roles.py`) are dumped to plain JSON; piano parts are not converted. Files with `<cue/>` are preprocessed once, because music21 ignores that element. |
| `normalize` | `normalize.py` | `build/normalize/` | 6.4 on the whole part: ticks at TPQ 480, grace, ornament and cue notes removed and tagged, lyrics reduced to `lyricLineEnd`, repeat and segno markers kept as `marks` and `barrier`, tempo recorded, per-measure `problems` (chord, second-voice, hidden-note, tremolo, non-integer-ticks, gap-or-overlap, ...) for C5 to reject windows with. |
| `extract` | `roles.py`, `pipeline.py` | `build/extract/` | 6.5: Lieder voice parts (`role: voice`), quartet parts (`vn1`, `inner`, `cello`, with `roleLabel` Vn I, Vn II, Va, Vc). Rejected parts carry `part-not-voice`, `piano-part-not-read` or `part-role-unknown`. `summary.json` lists unmatched part names. |

Each stage writes `candidates.jsonl` (one `kind=part` record per part, plus `kind=file` records in `read`), `summary.json`, `timing.json`
(the only non-deterministic file) and, for read and normalize, `data/<corpus>/<digest>.json.gz` blobs. C5 loads a part with
`corpus_build.partdata.load_part(build, record)` from any `extract` record with `status: pass`; the record's `dataRef` points at the normalized blob.
Everything except `timing.json` is byte-identical between runs. A normalized measure has: `number` (as printed, e.g. "12a"), `movement`, `beats`, `beatType`,
`fifths`, `mode`, `barTicks`, `lengthTicks`, `events` (note or rest, `tick`, `dur`, `midi`, ties, slurs, `artic`, `dynamic`, `hairpin`, `fermata`, `lyricLineEnd`, ...),
`marks`, `barrier`, `finalBarline`, `doubleBarline`, `tempo`, `tags` and `problems`.

## Windows and augmentation (03 sections 6.6 to 6.8, job C5)

| Stage | Module | Writes | What |
| --- | --- | --- | --- |
| `windows` | `phrase.py`, `windows.py`, `window_stage.py` | `build/windows/` | One `kind=window` record per proposed (allowed start, allowed end) pair of 8 to 12 full bars. `pass` = selected (or its 8-bar fallback, `fallbackFor`); `reject` carries the first failing rule. Passing windows' cut content is in `data/<corpus>/<digest>.json.gz`, keyed by window id. |
| `augment` | `augment.py` | `build/augment/` | Every passing window copied (stage `augment`), plus x2 variants: 8 bars of 2/4 to 4/4, 8 bars of 3/8 to 3/4, complete 4-bar phrases in 2/4 and 4/4 doubled to 8 bars (ties at the new barlines). C6 reads this file. |

Window id: `<part id>@[p]<first full bar index>-<last bar index>`, `p` when the window starts with a pickup from the bar before; `-aug2` for variants. Indices are 0-based
measure indices of the normalized part; printed numbers are in `sourceMeasures`. Load content with `corpus_build.window_stage.load_window(build, record)`.

Content (ticks from the excerpt start, pickup start = 0, like ExcerptDoc): `meter` (with `countUnitTicks`, `countsPerBar`), `fifths`, `mode` (major, minor or a church mode),
`modal` (non-null only for church modes, tag `modal`), `modeBasis`, `pickupTicks`, `bars`, `lengthTicks`, `measures[]` (`index`, `isPickup`, `startTick`, `source` {index, number},
`events` with `src` [measure index, event index] into the normalized part), `cadence`, `tempoAtStart`, `tags`, `modifications` (the `Modification` enum). `lyricLineEnd` and the
dropped final fermata are not in the content. Completion rests carry `completion: true`.

Rules, in the order `windows.check_rules` applies them (reason codes):

- starts (H1): section start (movement start, after a double or final barline, a forward repeat, a key or time change), the first note after a rest of at least one beat
  (rests in the bar before or leading rests in the first bar), a pickup of at most two beats after such a rest (any length below a bar for a movement's anacrusis), after a breath mark,
  and in Lieder after a `lyricLineEnd`. One pickup start per bar (the longest).
- ends (H2): the latest cadence chain in the bar on a strong beat (beat 1; beat 3 in 4/4; beat 4 in 6/8; beat 7 in 12/8), at least one beat or followed by a rest, followed by a rest,
  a double or final barline, the movement end or (Lieder) a `lyricLineEnd`; degree 1 or 3, or 5 or 2 when at least two beats and followed by a rest (half cadence, `minLevelCadence` 3);
  modal sections end only on the final. Notes after the cadence note in the last bar are replaced by rests (`final-bar-completed`, tag `next-phrase-cut`).
- `crosses-movement`; `measure-<problem>` for any normalize problem on a touched bar (chord, second-voice, tremolo, gap-or-overlap, hidden-note, ...); `meter-change`, `key-change`
  (H10); `incomplete-bar` (a short final bar is allowed only at a movement end or final barline: kept as written when it balances the pickup, H6, else completed with rests, H11);
  `ottava`; `crosses-barrier` (H8: a forward repeat only on the first bar, a backward repeat only on the last, never a volta, segno, coda or D.C./D.S.); `crosses-final-barline`;
  `tempo-change` (6.4: a metronome mark or tempo or tempo-change word after the window's first event); `mode-unknown`; `interior-fermata`; `tie-cut-start`, `tie-cut-end`,
  `tie-broken`; `slur-cut-start`, `slur-cut-end`; `tuplet-cut` (H4/H12); `sequence-cut` (H5).
- selection: at most one window per first bar (best score), `start-measure-taken` for the others; windows of a part overlap by at most 50% of the shorter one's bars, `overlap-limit`.
  Score = LBDM boundary strength before the start and after the end (pitch 0.25, IOI 0.5, rest 0.25) plus 0.15 when the bar count is a multiple of 4. It only ranks.

Level constraints C6 applies, because levels are not known here: `minLevelBars` (from `config/levels.json` `bars`: 8 from L1, 9 and 10 from L3, 11 and 12 from L6),
`minLevelCadence` (3 for a half cadence), `minLevel` (their maximum). When a window's level does not allow its length, use its `fallbackFor` 8-bar window instead (same start). Variants
carry `requiresLevelMax: 3` (keep only if re-tagged L1 to L3), `augmentOf` and `dedupeWith` (passing windows with the same bars, for one `dedupeGroup`).

Mode (03 section 6.6): per key section (one signature, one movement). The final is the section's last note, or the cello's for quartet upper parts. Final = major or minor tonic gives
that mode; a 3rd or 5th of either tonic triad is decided by the Krumhansl-Kessler profile (a Lieder voice often ends on a triad member while the piano closes); otherwise, in a
movement's last section, with no bass part and the final the most-sounded pitch class, the church mode named by the final (dorian, phrygian, lydian, mixolydian). Anything else is
`mode-unknown`.

`summary.json` has window counts per source, by bars, meter, mode, cadence, phrase quality, start kind, minimum level and role, and the silver-standard check: on Lieder at least 85%
of window starts and 80% of ends must sit on a lyric-line boundary within one note.

## Features, level, density, histogram (job C6, 03 sections 6.8 and 5.3)

`python -m corpus_build features` reads `build/augment/candidates.jsonl` and writes `build/features/` (`candidates.jsonl`, `summary.json`, `timing.json`) plus `build/histogram.json` and `build/histogram.html`.

- `corpus_build/features.py`: `analyse` (01 `DifficultyFeatures`, rhythm cells, `barRhythmLevel`, `extremes`, `rangeConcert`, `breathMaxGapBars`, `minorForm`), `tag_levels` (the nine `featureLevels`, reads only `config/levels.json` and `config/measurement-budget.json`), `tag_window`. `tag_levels` reproduces every case of `fixtures/levels/feature-vectors.json`, `tools/fixtures/excerpt_lib.py` `tag_levels`, and `src/corpus/tagger` (TypeScript).
- Rhythm cells are read per metronome beat (02 section 1): ticks are scaled to a 480 beat (simple meters) or kept at 720 (compound), so a half note is the `Q` cell in 2/2 and an eighth is `Q` in 3/8. A beat group that is not in 02 section 2.2 is `other` (level 10). Duplets and quadruplets, and 2:1 tuplets, are `other`.
- `level` = max(`featureLevels`). `levelConfidence` = how many features sit at it. `density` is the derived ninth feature. `minorForm` (natural, harmonic or melodic, from the raised 6th and 7th) is kept on every minor window because the tagger needs it and the excerpt document has no field for it.
- `effectiveLevel` = max(`level`, `minLevelCadence`): a half cadence is only allowed from L3 (02 H2). `level` itself is never changed.
- Event ids in `extremes` are `e<n>` in window order from 1, as in the fixture builder. C9 must emit event ids with the same scheme or remap these two.
- Resolution (reject reasons): `bars-exceed-level` (a 9 to 12 bar window whose level does not allow its length; its 8-bar `fallbackFor` window is kept in its place and carries `replaces`), `fallback-unused`, `aug-level-above-3` (an x2 variant must re-tag at L1 to L3), `no-notes` (fewer than two sounding notes).
- `histogram.json` counts kept windows (before dedupe, quality filters and review): per level by source, meter, mode and minor form, the binding feature per level, rhythm cell counts, and the fit of each instrument at each level in each allowed written key (03 7.3 closed form, tier band of the level; modal windows are excluded because they are served only under a random key).

## Quality filters, familiarity, calibration, dedupe (job C7, 03 sections 6.8 to 6.10)

| Stage | Module | Writes | What |
| --- | --- | --- | --- |
| `filters` | `quality.py`, `filter_stage.py`, `familiar.py` | `build/filters/` | Every kept features-stage window is measured and judged by `config/filters.yaml`. Rejected windows carry the first failing rule as `reason` and every failing rule in `failedRules`. All carry `quality` (soft score and S1 to S5, interest, its threshold and margin, the measured metrics), `flags`, `familiarity`, `fingerprint` and, for quartet inner and cello parts, `melodicRole` (Vn I's interest and onset coincidence in the same bars, the cello bass test). |
| `dedupe` | `dedupe.py`, `coverage.py` | `build/dedupe/` | Exact and near duplicates (03 6.10). Survivors pass with `dedupeGroup` and `work`; losers carry `dupOf`. `coverage.json` counts survivors per level and per instrument range (see below). |
| `calibrate` | `calibration.py` | `build/calibration/` | Developer stage, not in the default run: fits the 03-owned thresholds on the control sets and writes `report.json` and `filters.fitted.yaml`. Copy fitted values into `config/filters.yaml` and update its `calibration` block. |
| `familiar` | `familiar.py` | `familiar.yaml` | Developer stage: recomputes each tune's incipit from the normalized parts. |

The served level used by the level-dependent rules is `effectiveLevel` (C6: a half cadence is only allowed from L3).

Rule reason codes, in the order `quality.decide` checks them: `rest-ratio` (rests over 25% of the full bars), `rest-bar` (a run of rests of a bar
or longer), `leading-rest` (over one beat), `bar-repeated` (a bar repeated literally more than twice in a row), `repeated-notes` (ratio of
consecutive same-pitch notes), `recitative` (tempo text in force matches /recit/i), `pitch-variety` (3, 4, 5 pitch classes at L1, L2, L3+),
`rhythm-variety` (fewer than 2 cells from L2; pickup and tie marker cells do not count), `broken-chord`, `pedal-alternation`, `static-contour`,
`sustained-harmony`, `melodic-role-homorhythm` / `melodic-role-subordinate` / `melodic-role-unknown` (quartet inner parts and cello from L3: Vn I is
more interesting over the same bars, with or without 70% coinciding onsets), `bass-line-above-level`, `fragment`, `detector-limit` (at the density
level's slowest tempo the shortest pitch change is under 70 ms or the shortest repeat under 100 ms), `encoding-error`, `soft-score` (mean of S1 to S5
under 0.6) and `interest`.

Definitions 03 leaves open: notes are tie-merged; a leap is 5 semitones or more (02 2.3) and a step 1 or 2; contour changes are reversals between
non-zero intervals; the rhythm-cell entropy is normalised by log(distinct cells); the broken-chord test looks for a 2-, 3- or 4-interval figure of
interval classes (direction x unison, step, leap of 3 or more), at least half leaps, repeated back to back. Soft rules: S1 1 for a period or a bar
count in 4-bar units (0.5 for 2-bar units); S2 1 for a single highest note outside the first bar (0.5 if it recurs, 0 in bar 1); S3 0.5 each for a
first and a last note in the tonic triad; S4 distinct cells over 3 (2 at L1); S5 1 if bars 3 to 7 hold the bar of highest rhythm level, the largest
leap or a chromatic note. Flags: `noBreath` (02 2.4: no rest for more than 4 bars at L1-L4, or 12 seconds at the level's slowest tempo from L5),
`leapy` (over 25% of intervals are leaps, L1-L6), `bass-line` (cello: over 80% of downbeats lowest of the four parts and over 40% of intervals 4ths
or 5ths).

Familiarity: a window whose fingerprint contains a `familiar.yaml` incipit anywhere is familiarity 2. Fingerprint tokens are `interval:ratio`, the
IOI to the next onset divided by the previous one, quantised on a log scale; the last note's IOI is its duration.

Calibration (03 6.9): positives are Vn I windows that open a movement and end in a PAC; negatives are viola and cello windows whose Vn I is at least
0.2 more interesting in the same bars, plus a synthetic Alberti rendering of each control window's harmony. 02's pedagogical thresholds are fixed;
the 03-owned ones move only when moving them accepts more positives while negative rejection stays at least 90%.

Dedupe: exact (identical fingerprint) and near (4-gram Jaccard at least 0.8, or 0.7 in the same work = composer, file and movement) duplicates.
Augmented variants form one family with their original (`dedupeWith`, else `augmentOf`), share its `dedupeGroup` and are kept or dropped with it.
Priority: source `dedupe_priority`, then soft score, then id.

`coverage.json`: per instrument and level, `atLevel` (windows at L that fit the tier band in at least one written key allowed at L), `selectable`
(the 02 2.6 pool after bars, modes, flags, range fit and the tempo floors), `rankedSelectable` (familiarity 0), `noReviewSelectable` (items that need
no agent veto under ruling 29: not L1-L3, not a variant, not a quartet inner or cello part, interest at least 0.10 above its threshold) and
`keysWith10` (G2-launch). `viabilityBeforeReview` and `viabilityWithoutReview` apply ruling 24 (at least 300 excerpts, a non-empty selection for every
launch instrument at every served level of at least 30 excerpts).
