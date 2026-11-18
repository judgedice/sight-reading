# corpus-build

Python pipeline that turns the pinned public-domain sources into the shipped corpus (spec: `docs/spec/03-score-corpus.md`).
This directory currently holds jobs C1 (fetch and lock) and C2 (licence and public-domain gate). Later stages (C3a onward)
register in `corpus_build/cli.py` and write to `build/<stage>/`.

## Run

```
pip install -r tools/corpus-build/requirements.txt
cd tools/corpus-build
python -m corpus_build                 # fetch, verify, composers, gate
python -m corpus_build lock            # only after changing a pinned SHA in sources.yaml
python -m corpus_build verify gate     # re-run without the network
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
