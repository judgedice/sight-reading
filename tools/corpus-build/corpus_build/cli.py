"""Command line: `python -m corpus_build [stage ...]`. Run from tools/corpus-build (or put it on PYTHONPATH).

Stages: fetch, lock, verify, composers, gate, read, normalize, extract, windows, augment. With no stage, runs every stage except lock.
`lock` rewrites sources.lock.yaml and is never part of the default run, because the default run must not change
the pinned inputs. Later stages (C3a onward) register in STAGES.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Callable

from .candidate import write_jsonl
from .composers import ComposerIndex, build_composers, load_composers, write_composers
from .fetch import FetchError, fetch_records, fetch_source, load_lock, verify_lock, write_lock
from .gate import run_gate
from .pipeline import run_extract, run_normalize, run_read
from .window_stage import run_augment, run_windows
from .paths import COMPOSERS_YAML, build_root, cache_root
from .sources import Source, load_sources


class Ctx:
    def __init__(self, cache: Path, build: Path, sources: list[Source], workers: int | None = None, corpus: str | None = None, limit: int | None = None):
        self.cache, self.build, self.sources = cache, build, sources
        self.workers, self.corpus, self.limit = workers, corpus, limit


def stage_fetch(ctx: Ctx) -> int:
    for src in ctx.sources:
        try:
            d = fetch_source(src, ctx.cache)
        except FetchError as e:
            if src.optional:
                print(f"fetch: {src.id} skipped ({e}); optional source (ruling 27)", file=sys.stderr)
                continue
            print(f"fetch: {e}", file=sys.stderr)
            return 1
        print(f"fetch: {src.id} at {src.sha[:10]} in {d}")
    return 0


def stage_lock(ctx: Ctx) -> int:
    try:
        lock = write_lock(ctx.sources, ctx.cache)
    except FetchError as e:
        print(f"lock: {e}", file=sys.stderr)
        return 1
    for sid, ent in lock["sources"].items():
        print(f"lock: {sid} {len(ent['files'])} files")
    return 0


def stage_verify(ctx: Ctx) -> int:
    problems = verify_lock(ctx.sources, ctx.cache, load_lock())
    for p in problems:
        print(f"verify: {p}", file=sys.stderr)
    if problems:
        return 1
    lock = load_lock()
    out = []
    for src in ctx.sources:
        ent = lock["sources"].get(src.id)
        if ent:
            out.extend(fetch_records(src, ctx.cache, ent))
    n = write_jsonl(ctx.build / "fetch" / "candidates.jsonl", out)
    print(f"verify: lock matches the cache; {n} score files recorded in build/fetch/candidates.jsonl")
    return 0


def stage_composers(ctx: Ctx) -> int:
    data = build_composers(ctx.sources, ctx.cache)
    write_composers(data)
    print(f"composers: {len(data['composers'])} composers written to {COMPOSERS_YAML.name}")
    return 0


def stage_gate(ctx: Ctx) -> int:
    lock = load_lock()
    if lock is None:
        print("gate: sources.lock.yaml is missing. Run `lock`.", file=sys.stderr)
        return 1
    fetch_path = ctx.build / "fetch" / "candidates.jsonl"
    if not fetch_path.exists():
        print("gate: build/fetch/candidates.jsonl is missing. Run `verify` first.", file=sys.stderr)
        return 1
    summary = run_gate(ctx.sources, ctx.cache, lock, fetch_path, ComposerIndex(load_composers()), ctx.build / "gate")
    for corpus, s in summary["byCorpus"].items():
        print(f"gate: {corpus}: {s['passed']} of {s['files']} pass; rejected {s['rejectedByReason']}")
    if summary["skippedSources"]:
        print(f"gate: skipped optional sources: {', '.join(summary['skippedSources'])}")
    return 0


def _print_stage(name: str, summary: dict) -> None:
    for corpus, s in summary["byCorpus"].items():
        f, p = s.get("file"), s.get("part")
        bits = [f"files: {f['pass']} pass, {f['reject']} reject {f['rejectedByReason']}"] if f and f["records"] else []
        bits.append(f"parts: {p['pass']} pass, {p['reject']} reject {p['rejectedByReason']}")
        print(f"{name}: {corpus}: " + "; ".join(bits))
    t = summary.get("timing")
    if t and t["wallSeconds"]:
        print(f"{name}: {t['files']} files in {t['wallSeconds']:.1f} s, {t['files'] / t['wallSeconds']:.2f} files per second")


def stage_read(ctx: Ctx) -> int:
    if not (ctx.build / "gate" / "candidates.jsonl").exists():
        print("read: build/gate/candidates.jsonl is missing. Run `gate` first.", file=sys.stderr)
        return 1
    _print_stage("read", run_read(ctx.cache, ctx.build, ctx.workers, ctx.corpus, ctx.limit))
    return 0


def stage_normalize(ctx: Ctx) -> int:
    if not (ctx.build / "read" / "candidates.jsonl").exists():
        print("normalize: build/read/candidates.jsonl is missing. Run `read` first.", file=sys.stderr)
        return 1
    _print_stage("normalize", run_normalize(ctx.build, ctx.workers))
    return 0


def stage_extract(ctx: Ctx) -> int:
    if not (ctx.build / "normalize" / "candidates.jsonl").exists():
        print("extract: build/normalize/candidates.jsonl is missing. Run `normalize` first.", file=sys.stderr)
        return 1
    _print_stage("extract", run_extract(ctx.build))
    return 0


def stage_windows(ctx: Ctx) -> int:
    if not (ctx.build / "extract" / "candidates.jsonl").exists():
        print("windows: build/extract/candidates.jsonl is missing. Run `extract` first.", file=sys.stderr)
        return 1
    summary = run_windows(ctx.build, ctx.workers)
    for corpus, s in summary["byCorpus"].items():
        line = f"windows: {corpus}: {s['windows']} windows (+{s['fallbacks']} 8-bar fallbacks) from {s['partsWithWindows']} parts; {s['proposed']} proposed"
        if "silverStandard" in s:
            ss = s["silverStandard"]
            line += f"; silver standard starts {ss['startRate']:.1%} ends {ss['endRate']:.1%} ({'pass' if ss['passed'] else 'FAIL'})"
        print(line)
    print(f"windows: {summary['timing']['files']} files in {summary['timing']['wallSeconds']:.1f} s")
    return 0


def stage_augment(ctx: Ctx) -> int:
    if not (ctx.build / "windows" / "candidates.jsonl").exists():
        print("augment: build/windows/candidates.jsonl is missing. Run `windows` first.", file=sys.stderr)
        return 1
    summary = run_augment(ctx.build, ctx.workers)
    for corpus, s in summary["byCorpus"].items():
        print(f"augment: {corpus}: {s['variants']} x2 variants {s['variantsBySource']}; rejected {s['variantsRejectedByReason']}")
    return 0


STAGES: dict[str, Callable[[Ctx], int]] = {
    "fetch": stage_fetch,
    "lock": stage_lock,
    "verify": stage_verify,
    "composers": stage_composers,
    "gate": stage_gate,
    "read": stage_read,
    "normalize": stage_normalize,
    "extract": stage_extract,
    "windows": stage_windows,
    "augment": stage_augment,
}
DEFAULT_RUN = ["fetch", "verify", "composers", "gate", "read", "normalize", "extract", "windows", "augment"]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="corpus_build", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("stages", nargs="*", help=f"stages to run (default: {' '.join(DEFAULT_RUN)}). Available: {' '.join(STAGES)}")
    ap.add_argument("--cache", help="clone cache directory (default: $SIGHT_READING_CORPUS_CACHE or ~/.cache/sight-reading-corpus)")
    ap.add_argument("--build", help="stage output directory (default: tools/corpus-build/build)")
    ap.add_argument("--workers", type=int, help="processes for read and normalize (default: min(4, cpu count))")
    ap.add_argument("--corpus", help="read only this corpus id (openscore-lieder or openscore-quartets)")
    ap.add_argument("--limit", type=int, help="read only the first N gate-passed files (for trial runs)")
    args = ap.parse_args(argv)
    names = args.stages or DEFAULT_RUN
    for n in names:
        if n not in STAGES:
            ap.error(f"unknown stage {n!r}")
    ctx = Ctx(cache_root(args.cache), build_root(args.build), load_sources(), args.workers, args.corpus, args.limit)
    for n in names:
        rc = STAGES[n](ctx)
        if rc:
            print(f"stage {n} failed", file=sys.stderr)
            return rc
    return 0


if __name__ == "__main__":
    sys.exit(main())
