# corpus-build

Python pipeline that turns the pinned public-domain sources into the shipped corpus (spec: `docs/spec/03-score-corpus.md`).
This directory currently holds jobs C1 (fetch and lock), C2 (licence and public-domain gate), C3a (read and normalize) and C4 (melody extraction and part roles). Later stages (C5 onward)
register in `corpus_build/cli.py` and write to `build/<stage>/`.

## Run

```
pip install -r tools/corpus-build/requirements.txt
cd tools/corpus-build
python -m corpus_build                 # fetch, verify, composers, gate, read, normalize, extract
python -m corpus_build lock            # only after changing a pinned SHA in sources.yaml
python -m corpus_build verify gate     # re-run without the network
python -m corpus_build read normalize extract   # C3a and C4 only (about 3 minutes on 4 cores; --workers N, --corpus ID, --limit N)
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
