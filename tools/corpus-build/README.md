# corpus-build

Python pipeline that turns the pinned public-domain sources into the shipped corpus (spec: `docs/spec/03-score-corpus.md`).
This directory currently holds jobs C1 (fetch and lock), C2 (licence and public-domain gate), C3a (read and normalize), C4 (melody extraction and part roles) and C5 (boundaries,
cadences, mode, window proposal, hard rules, augmentation). Later stages (C6 onward) register in `corpus_build/cli.py` and write to `build/<stage>/`.

## Run

```
pip install -r tools/corpus-build/requirements.txt
cd tools/corpus-build
python -m corpus_build                 # fetch, verify, composers, gate, read, normalize, extract, windows, augment
python -m corpus_build lock            # only after changing a pinned SHA in sources.yaml
python -m corpus_build verify gate     # re-run without the network
python -m corpus_build read normalize extract   # C3a and C4 only (about 3 minutes on 4 cores; --workers N, --corpus ID, --limit N)
python -m corpus_build windows augment          # C5 only (about 50 s on 4 cores; needs build/extract)
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
| `config/filters.yaml` | quality and accompaniment thresholds for C7. Not read by C1 or C2. |
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
