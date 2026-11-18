"""Driver for the stage `features` (job C6, 03 sections 6.8 and 5.3).

Reads `build/augment/candidates.jsonl` (passing windows, fallbacks and x2 variants), tags every window (`features.py`) and writes
`build/features/`:
- `candidates.jsonl`: one kind=window record per augment-stage window (stage features). Each carries `features`, `rhythmCells`,
  `featureLevels`, `level`, `levelConfidence`, `barRhythmLevel`, `extremes`, `rangeConcert`, `breathMaxGapBars`, `minorForm`
  (kept for the TypeScript tagger, which cannot read it from the document), `effectiveLevel` and `tagged: true`.
  Status pass for a window that is kept, reject (with a reason) for the rest:
  - `bars-exceed-level`: a 9 to 12 bar window whose level does not allow its length (03 6.7); its 8-bar `fallbackFor` window stands in;
  - `fallback-unused`: an 8-bar fallback whose primary window was kept;
  - `aug-level-above-3`: a x2 variant whose re-tagged level is above 3 (03 6.8, `requiresLevelMax`);
  - `no-notes`: fewer than two sounding notes, nothing to measure.
  `level` is exactly max(featureLevels) (02 2.1). `effectiveLevel` = max(level, minLevelCadence): a half cadence is only allowed from L3 (02 H2).
- `summary.json`, `timing.json`.
`build/histogram.json` and `build/histogram.html` (03 5.3) are written by `histogram.py` after tagging.
"""

from __future__ import annotations

import time
from collections import Counter
from pathlib import Path
from typing import Any

from .candidate import make_record, read_jsonl, write_jsonl
from .features import TooFewNotes, levels_config, tag_window
from .histogram import write_histogram
from .partdata import load_blob
from .pipeline import _map, _write_json, default_workers

TAG_FIELDS = ("features", "rhythmCells", "featureLevels", "level", "levelConfidence", "barRhythmLevel", "extremes", "rangeConcert", "breathMaxGapBars", "minorForm")


def _group(recs: list[dict[str, Any]]) -> list[tuple[str, str, list[dict[str, Any]]]]:
    by_ref: dict[str, list[dict[str, Any]]] = {}
    for r in recs:
        by_ref.setdefault(r["dataRef"], []).append(r)
    return [(ref, rs[0]["corpus"], sorted(rs, key=lambda r: r["id"])) for ref, rs in sorted(by_ref.items())]


def _task(args: tuple[str, str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    build, ref, recs = args
    blob = load_blob(Path(build), ref)["windows"]
    out: list[dict[str, Any]] = []
    for r in recs:
        w = blob[r["id"]]
        rec = {k: v for k, v in r.items() if k not in ("stage", "status", "schemaVersion", "kind", "id", "corpus", "reason", "detail")}
        try:
            tag = tag_window(w)
        except TooFewNotes as e:
            out.append(make_record("features", "window", r["id"], r["corpus"], "reject", reason="no-notes", detail=str(e), **rec))
            continue
        rec.update({k: tag[k] for k in TAG_FIELDS})
        rec["effectiveLevel"] = max(tag["level"], r.get("minLevelCadence", 1))
        rec["tagged"] = True
        out.append(make_record("features", "window", r["id"], r["corpus"], "pass", **rec))
    return out


def resolve(recs: list[dict[str, Any]]) -> None:
    """Apply the level-dependent rules C5 recorded as constraints (see README, 'Level constraints C6 applies'). Mutates records."""
    bars_ok = {lv["level"]: lv["bars"] for lv in levels_config()}
    by_id = {r["id"]: r for r in recs}
    # a primary window whose level does not allow its length is replaced by its 8-bar fallback
    replaced: set[str] = set()
    for r in recs:
        if r["status"] != "pass" or r.get("fallbackFor") or r["id"].endswith("-aug2"):
            continue
        if r["bars"] not in bars_ok[r["level"]]:
            r["status"] = "reject"
            r["reason"] = "bars-exceed-level"
            r["detail"] = f"{r['bars']} bars is not allowed at level {r['level']} (02 2.3 Bars); the 8-bar fallback stands in"
            replaced.add(r["id"])
    for r in recs:
        fb = r.get("fallbackFor")
        if not fb or r["status"] != "pass":
            continue
        if fb in replaced:
            continue
        r["status"] = "reject"
        r["reason"] = "fallback-unused"
        r["detail"] = "the primary window's level allows its length" if fb in by_id and by_id[fb]["status"] == "pass" else "the primary window was not tagged"
    for r in recs:
        if r["status"] == "pass" and r["id"].endswith("-aug2") and r["level"] > r.get("requiresLevelMax", 10):
            r["status"] = "reject"
            r["reason"] = "aug-level-above-3"
            r["detail"] = f"the x2 variant re-tags at level {r['level']}; variants are kept at levels 1 to {r['requiresLevelMax']}"
    # an 8-bar fallback used in place of a primary keeps the primary's id in `replaces`
    for r in recs:
        fb = r.get("fallbackFor")
        if fb and r["status"] == "pass":
            r["replaces"] = fb


def run_features(build: Path, workers: int | None = None) -> dict[str, Any]:
    recs0 = [r for r in read_jsonl(build / "augment" / "candidates.jsonl") if r["status"] == "pass"]
    jobs = [(str(build), ref, rs) for ref, _c, rs in _group(recs0)]
    t0 = time.perf_counter()
    out: list[dict[str, Any]] = []
    for part in _map(_task, jobs, workers or default_workers()):
        out.extend(part)
    wall = time.perf_counter() - t0
    resolve(out)
    write_jsonl(build / "features" / "candidates.jsonl", out)
    summary = features_summary(out)
    _write_json(build / "features" / "summary.json", summary)
    _write_json(build / "features" / "timing.json", {"files": len(jobs), "wallSeconds": round(wall, 2)})
    hist = write_histogram(build, out)
    summary["histogram"] = hist
    summary["timing"] = {"files": len(jobs), "wallSeconds": wall}
    return summary


def features_summary(recs: list[dict[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for corpus in sorted({r["corpus"] for r in recs}):
        rs = [r for r in recs if r["corpus"] == corpus]
        kept = [r for r in rs if r["status"] == "pass"]
        out[corpus] = {
            "tagged": sum(1 for r in rs if r.get("tagged")),
            "kept": len(kept),
            "rejectedByReason": dict(sorted(Counter(r["reason"] for r in rs if r["status"] == "reject").items())),
            "byLevel": {str(k): v for k, v in sorted(Counter(r["level"] for r in kept).items())},
            "variantsKept": sum(1 for r in kept if r["id"].endswith("-aug2")),
        }
    return {"byCorpus": out}
