"""Stage `dedupe` (job C7, 03 section 6.10).

Reads `build/filters/candidates.jsonl` (windows that passed the filters) and writes `build/dedupe/`:
- `candidates.jsonl`: one kind=window record per input window (stage dedupe). Survivors pass with `dedupeGroup` and
  `work`; losers are rejected (`duplicate` for an identical fingerprint, `near-duplicate` otherwise) with `dupOf` (the
  survivor's id), `dupJaccard` and the survivor's `dedupeGroup`.
- `summary.json`, and `coverage.json` (corpus_build/coverage.py: surviving windows per level and per instrument range).

Rules:
- Fingerprint: `quality.fingerprint` (interval, quantised IOI ratio), invariant to transposition and augmentation.
- Exact duplicate: identical fingerprint. Near duplicate: Jaccard similarity of the 4-gram sets at least 0.8, or at least
  0.7 within the same work (`work` = composer + file + movement, shared by every window of a movement).
- An augmented x2 variant belongs to its original's family by construction (C5's `dedupeWith`, else `augmentOf`): the
  family shares one `dedupeGroup` and is kept or dropped as a whole, and its members are never duplicates of each other.
- Survivor: families are taken in priority order (source `dedupe_priority` of sources.yaml, then the higher soft score,
  then the lower id); a family is dropped if any member duplicates a member of an already kept family.
- Candidate pairs come from an inverted index over each set's rarest 4-grams (prefix filtering at the lowest threshold,
  0.7), which finds every pair at or above it; each candidate is then verified exactly.
"""

from __future__ import annotations

import hashlib
import math
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from .candidate import make_record, read_jsonl, write_jsonl
from .coverage import coverage
from .pipeline import _write_json
from .quality import filters_config
from .sources import load_sources

CARRY_DROP = ("stage", "status", "schemaVersion", "kind", "id", "corpus", "reason", "detail")


def grams(fp: list[str], n: int) -> frozenset[tuple[str, ...]]:
    return frozenset(tuple(fp[i : i + n]) for i in range(len(fp) - n + 1))


def jaccard(a: frozenset[Any], b: frozenset[Any]) -> float:
    if not a and not b:
        return 1.0
    return len(a & b) / len(a | b)


def work_key(rec: dict[str, Any]) -> str:
    """composer slug | file stem | movement, e.g. 'mozart-wolfgang-amadeus|sq7353137|mv1'."""
    path = rec["fileId"].split(":", 1)[1]
    segs = path.split("/")
    composer = segs[1] if len(segs) > 1 else "unknown"
    slug = re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize("NFKD", composer).encode("ascii", "ignore").decode().lower()).strip("-")
    stem = segs[-1].rsplit(".", 1)[0]
    return f"{slug}|{stem}|mv{rec.get('movement') or 1}"


def family_roots(recs: list[dict[str, Any]]) -> dict[str, str]:
    """id -> family root id. Originals are their own root; an x2 variant joins its dedupeWith window (or augmentOf)."""
    ids = {r["id"] for r in recs}
    root: dict[str, str] = {}
    for r in recs:
        rid = r["id"]
        if rid.endswith("-aug2"):
            links = [x for x in (r.get("dedupeWith") or []) if x in ids and not x.endswith("-aug2")]
            if not links and r.get("augmentOf") in ids:
                links = [r["augmentOf"]]
            root[rid] = sorted(links)[0] if links else rid
        else:
            root[rid] = rid
    return root


def candidate_pairs(sets: dict[str, frozenset[Any]], threshold: float) -> set[tuple[str, str]]:
    """Every pair whose Jaccard can reach `threshold` (prefix filtering on globally rarest grams)."""
    freq: Counter[Any] = Counter(g for s in sets.values() for g in s)
    index: dict[Any, list[str]] = defaultdict(list)
    for rid in sorted(sets):
        s = sets[rid]
        if not s:
            continue
        order = sorted(s, key=lambda g: (freq[g], g))
        p = len(order) - math.ceil(threshold * len(order) - 1e-9) + 1
        for g in order[: max(1, p)]:
            index[g].append(rid)
    pairs: set[tuple[str, str]] = set()
    for ids in index.values():
        for i, a in enumerate(ids):
            for b in ids[i + 1 :]:
                pairs.add((a, b) if a < b else (b, a))
    return pairs


def dedupe(recs: list[dict[str, Any]], priority: dict[str, int] | None = None, cfg: dict[str, Any] | None = None) -> dict[str, dict[str, Any]]:
    """id -> {status, reason, dupOf, dupJaccard, dedupeGroup, work} for every passing filters record."""
    cfg = (cfg or filters_config())["dedupe"]
    n, t_any, t_work = cfg["ngram"], cfg["near_duplicate_jaccard"], cfg["near_duplicate_jaccard_same_work"]
    priority = priority or {s.id: s.dedupe_priority for s in load_sources()}
    by_id = {r["id"]: r for r in recs}
    root = family_roots(recs)
    work = {rid: work_key(r) for rid, r in by_id.items()}
    fps = {rid: tuple(r.get("fingerprint") or []) for rid, r in by_id.items()}
    sets = {rid: grams(list(fp), n) for rid, fp in fps.items()}

    # duplicate edges between families
    edges: dict[str, dict[str, tuple[str, str, float, bool]]] = defaultdict(dict)

    def add(a: str, b: str, j: float, exact: bool) -> None:
        ra, rb = root[a], root[b]
        if ra == rb:
            return
        for x, y, xa, ya in ((ra, rb, a, b), (rb, ra, b, a)):
            prev = edges[x].get(y)
            if prev is None or (exact and not prev[3]) or j > prev[2]:
                edges[x][y] = (xa, ya, j, exact)

    by_fp: dict[tuple[str, ...], list[str]] = defaultdict(list)
    for rid, fp in fps.items():
        if fp:
            by_fp[fp].append(rid)
    for ids in by_fp.values():
        for i, a in enumerate(sorted(ids)):
            for b in sorted(ids)[i + 1 :]:
                add(a, b, 1.0, True)
    for a, b in sorted(candidate_pairs(sets, min(t_any, t_work))):
        j = jaccard(sets[a], sets[b])
        if j >= t_any - 1e-9 or (work[a] == work[b] and j >= t_work - 1e-9):
            add(a, b, j, fps[a] == fps[b])

    families: dict[str, list[str]] = defaultdict(list)
    for rid in sorted(by_id):
        families[root[rid]].append(rid)

    def rank(fr: str) -> tuple[int, float, str]:
        r = by_id[fr]
        return (priority.get(r["corpus"], 99), -float((r.get("quality") or {}).get("soft") or 0.0), fr)

    kept: list[str] = []
    out: dict[str, dict[str, Any]] = {}
    group_of: dict[str, str] = {}
    for fr in sorted(families, key=rank):
        hit = next((k for k in kept if k in edges.get(fr, {})), None)
        if hit is None:
            kept.append(fr)
            g = "fp-" + hashlib.sha1(" ".join(fps[fr]).encode("utf-8")).hexdigest()[:8]
            group_of[fr] = g
            for rid in families[fr]:
                out[rid] = {"status": "pass", "dedupeGroup": g, "work": work[rid]}
        else:
            loser, winner, j, exact = edges[fr][hit]
            for rid in families[fr]:
                out[rid] = {
                    "status": "reject",
                    "reason": "duplicate" if exact else "near-duplicate",
                    "detail": f"{'identical fingerprint' if exact else f'Jaccard {j:.2f}'} with {winner} (via {loser})",
                    "dupOf": hit,
                    "dupJaccard": round(j, 4),
                    "dedupeGroup": group_of[hit],
                    "work": work[rid],
                }
    return out


def run_dedupe(build: Path) -> dict[str, Any]:
    recs = [r for r in read_jsonl(build / "filters" / "candidates.jsonl") if r["status"] == "pass"]
    res = dedupe(recs)
    out = []
    for r in recs:
        d = res[r["id"]]
        carry = {k: v for k, v in r.items() if k not in CARRY_DROP}
        extra = {k: v for k, v in d.items() if k not in ("status", "reason", "detail")}
        if d["status"] == "pass":
            out.append(make_record("dedupe", "window", r["id"], r["corpus"], "pass", **carry, **extra))
        else:
            out.append(make_record("dedupe", "window", r["id"], r["corpus"], "reject", reason=d["reason"], detail=d["detail"], **carry, **extra))
    write_jsonl(build / "dedupe" / "candidates.jsonl", out)
    summary = dedupe_summary(out)
    _write_json(build / "dedupe" / "summary.json", summary)
    cov = coverage([r for r in out if r["status"] == "pass"])
    _write_json(build / "dedupe" / "coverage.json", cov)
    summary["coverage"] = cov
    return summary


def dedupe_summary(recs: list[dict[str, Any]]) -> dict[str, Any]:
    kept = [r for r in recs if r["status"] == "pass"]
    by_corpus: dict[str, Any] = {}
    for corpus in sorted({r["corpus"] for r in recs}):
        rs = [r for r in recs if r["corpus"] == corpus]
        by_corpus[corpus] = {
            "windows": len(rs),
            "kept": sum(1 for r in rs if r["status"] == "pass"),
            "rejectedByReason": dict(sorted(Counter(r["reason"] for r in rs if r["status"] == "reject").items())),
        }
    return {
        "byCorpus": by_corpus,
        "kept": len(kept),
        "groups": len({r["dedupeGroup"] for r in kept}),
        "keptByLevel": {str(k): v for k, v in sorted(Counter(r["effectiveLevel"] for r in kept).items())},
        "groupsByLevel": {str(k): v for k, v in sorted(Counter(lv for lv, _g in {(r["effectiveLevel"], r["dedupeGroup"]) for r in kept}).items())},
    }
