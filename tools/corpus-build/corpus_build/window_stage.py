"""Drivers for the stages `windows` and `augment` (job C5, 03 sections 6.6 to 6.8).

`windows` reads `build/extract/candidates.jsonl` (parts with status pass), proposes windows per part (`windows.py`)
and writes `build/windows/`:
- `candidates.jsonl`: one kind=window record per proposed (start, end) pair. Status pass for a selected window and
  for its 8-bar fallback (`fallbackFor`), reject with a reason for everything else (a hard rule, `start-measure-taken`
  or `overlap-limit`).
- `data/<corpus>/<digest>.json.gz`: per file, the cut content of every passing window, keyed by window id. Load it
  with `load_window(build, record)`.
- `summary.json` (deterministic counts, window counts per source, the silver-standard boundary check) and `timing.json`.

`augment` reads `build/windows/` and the normalized parts and writes `build/augment/`: every passing window copied
(stage augment, same id and dataRef), plus the x2 rhythmic augmentation variants (`augment.py`). C6 reads
`build/augment/candidates.jsonl`.
"""

from __future__ import annotations

import time
from collections import Counter
from pathlib import Path
from typing import Any

from .augment import augment_part
from .candidate import make_record, read_jsonl, write_jsonl
from .partdata import blob_ref, load_blob, write_blob
from .pipeline import _map, _write_json, default_workers
from .windows import PartWindows, Candidate, build_window, lyric_flags, propose, window_key

SILVER_START_MIN = 0.85
SILVER_END_MIN = 0.80


def load_window(build: Path, record: dict[str, Any]) -> dict[str, Any]:
    """The cut content of a passing window record (stage windows or augment)."""
    return load_blob(build, record["dataRef"])["windows"][record["id"]]


def _bass_for(parts: list[dict[str, Any]], blob: dict[str, Any], rec: dict[str, Any]) -> list[dict[str, Any]] | None:
    """Quartets: the cello's measures, used for the key-section final (phrase.section_modes)."""
    if rec["corpus"] != "openscore-quartets" or rec.get("role") == "cello":
        return None
    cello = next((p for p in parts if p.get("role") == "cello"), None)
    if cello is None:
        return None
    return blob["parts"][str(cello["partIndex"])]["measures"]


def window_meta(pw: PartWindows, c: Candidate, rec: dict[str, Any]) -> dict[str, Any]:
    ms = pw.facts.measures
    first, last = ms[c.first], ms[c.last]
    meta: dict[str, Any] = {
        "fileId": rec["parentId"],
        "partIndex": rec["partIndex"],
        "role": rec.get("role"),
        "roleLabel": rec.get("roleLabel"),
        "firstMeasure": c.first,
        "lastMeasure": c.last,
        "pickupMeasure": c.start.pickup_mi,
        "bars": c.bars,
        "sourceMeasures": [ms[c.start.pickup_mi]["number"] if c.start.pickup_mi is not None else first["number"], last["number"]],
        "movement": first["movement"],
        "meter": f"{first['beats']}/{first['beatType']}",
        "fifths": first["fifths"],
        "startKind": c.start.kind,
        "endFollowedBy": c.end.followed_by,
    }
    return meta


def _windows_task(args: tuple[str, str, list[dict[str, Any]]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    build, ref, parts = args
    t0 = time.perf_counter()
    blob = load_blob(Path(build), ref)
    corpus = parts[0]["corpus"]
    fid = parts[0]["parentId"]
    wref = blob_ref("windows", corpus, fid)
    out: list[dict[str, Any]] = []
    content: dict[str, Any] = {}
    stats: Counter[str] = Counter()
    for rec in parts:
        part = blob["parts"][str(rec["partIndex"])]
        lyric = corpus == "openscore-lieder"
        pw = propose(part, lyric, _bass_for(parts, blob, rec))
        stats["starts"] += len(pw.starts)
        stats["ends"] += sum(1 for e in pw.ends.values() if e is not None)
        chosen = {id(c): "primary" for c in pw.primary}
        fb_of = {id(fb): p for p in pw.primary if (fb := pw.fallback.get(id(p))) is not None}
        for c in pw.candidates:
            wid = f"{rec['id']}@{window_key(c)}"
            meta = window_meta(pw, c, rec)
            if id(c) in chosen or id(c) in fb_of:
                w = build_window(pw, c, corpus)
                content[wid] = w
                ls, le = lyric_flags(pw.facts, c)
                min_bars = _bars_level(c.bars)
                min_cad = 3 if c.end.cadence == "HC" else 1
                fields: dict[str, Any] = dict(
                    meta, mode=w["mode"], modal=w["modal"], modeBasis=w["modeBasis"], pickupTicks=w["pickupTicks"], cadenceEnd=c.end.cadence,
                    endDegree=c.end.degree, phraseQuality=_pq(pw, c), minLevelBars=min_bars, minLevelCadence=min_cad, minLevel=max(min_bars, min_cad),
                    score=c.score, modifications=w["modifications"], tempoAtStart=w["tempoAtStart"], dataRef=wref,
                    lyricStart=ls if lyric else None, lyricEnd=le if lyric else None,
                    fallbackFor=f"{rec['id']}@{window_key(fb_of[id(c)])}" if id(c) in fb_of else None,
                )
                out.append(make_record("windows", "window", wid, corpus, "pass", parentId=rec["id"], tags=w["tags"], **fields))
            else:
                out.append(make_record("windows", "window", wid, corpus, "reject", parentId=rec["id"], reason=c.reason, detail=c.detail, **meta))
    if content:
        write_blob(Path(build), wref, {"fileId": fid, "windows": content})
    return out, {"seconds": time.perf_counter() - t0, **stats}


def _pq(pw: PartWindows, c: Candidate) -> str:
    from .windows import phrase_quality

    return phrase_quality(c, pw.ends)


def _bars_level(n: int) -> int:
    from .windows import bars_min_level

    return bars_min_level()[n]


def _group_parts(build: Path) -> list[tuple[str, str, list[dict[str, Any]]]]:
    ex = [r for r in read_jsonl(build / "extract" / "candidates.jsonl") if r["kind"] == "part" and r["status"] == "pass"]
    by_ref: dict[str, list[dict[str, Any]]] = {}
    for r in ex:
        by_ref.setdefault(r["dataRef"], []).append(r)
    return [(str(build), ref, sorted(rs, key=lambda r: r["partIndex"])) for ref, rs in sorted(by_ref.items())]


def run_windows(build: Path, workers: int | None = None) -> dict[str, Any]:
    jobs = _group_parts(build)
    t0 = time.perf_counter()
    records: list[dict[str, Any]] = []
    totals: Counter[str] = Counter()
    for recs, st in _map(_windows_task, jobs, workers or default_workers()):
        records.extend(recs)
        totals.update({k: v for k, v in st.items() if k != "seconds"})
    wall = time.perf_counter() - t0
    write_jsonl(build / "windows" / "candidates.jsonl", records)
    summary = windows_summary(records)
    summary["proposal"] = dict(sorted(totals.items()))
    _write_json(build / "windows" / "summary.json", summary)
    _write_json(build / "windows" / "timing.json", {"files": len(jobs), "wallSeconds": round(wall, 2)})
    summary["timing"] = {"files": len(jobs), "wallSeconds": wall}
    return summary


def windows_summary(records: list[dict[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for corpus in sorted({r["corpus"] for r in records}):
        rs = [r for r in records if r["corpus"] == corpus]
        primary = [r for r in rs if r["status"] == "pass" and not r.get("fallbackFor")]
        fallback = [r for r in rs if r["status"] == "pass" and r.get("fallbackFor")]
        s: dict[str, Any] = {
            "proposed": len(rs),
            "windows": len(primary),
            "fallbacks": len(fallback),
            "partsWithWindows": len({r["parentId"] for r in primary}),
            "filesWithWindows": len({r["fileId"] for r in primary}),
            "rejectedByReason": dict(sorted(Counter(r["reason"] for r in rs if r["status"] == "reject").items())),
            "byBars": dict(sorted(Counter(str(r["bars"]) for r in primary).items())),
            "byMeter": dict(sorted(Counter(r["meter"] for r in primary).items())),
            "byMode": dict(sorted(Counter(str(r["mode"]) for r in primary).items())),
            "byCadence": dict(sorted(Counter(r["cadenceEnd"] for r in primary).items())),
            "byPhraseQuality": dict(sorted(Counter(r["phraseQuality"] for r in primary).items())),
            "byStartKind": dict(sorted(Counter(r["startKind"] for r in primary).items())),
            "byMinLevel": dict(sorted(Counter(str(r["minLevel"]) for r in primary).items())),
            "byRole": dict(sorted(Counter(str(r.get("role")) for r in primary).items())),
            "withPickup": sum(1 for r in primary if r["pickupTicks"]),
        }
        if corpus == "openscore-lieder" and primary:
            st = sum(1 for r in primary if r["lyricStart"]) / len(primary)
            en = sum(1 for r in primary if r["lyricEnd"]) / len(primary)
            s["silverStandard"] = {"windows": len(primary), "startRate": round(st, 4), "endRate": round(en, 4),
                                   "startMin": SILVER_START_MIN, "endMin": SILVER_END_MIN, "passed": st >= SILVER_START_MIN and en >= SILVER_END_MIN}
        out[corpus] = s
    return {"byCorpus": out}


# ---------------------------------------------------------------- augment

def _augment_task(args: tuple[str, str, list[dict[str, Any]], list[dict[str, Any]]]) -> list[dict[str, Any]]:
    build, ref, parts, wins = args
    b = Path(build)
    blob = load_blob(b, ref)
    corpus = parts[0]["corpus"]
    fid = parts[0]["parentId"]
    aref = blob_ref("augment", corpus, fid)
    out: list[dict[str, Any]] = []
    content: dict[str, Any] = {}
    wblob = load_blob(b, wins[0]["dataRef"])["windows"] if wins else {}
    for w in wins:
        rec = dict(w)
        rec["stage"] = "augment"
        out.append(rec)
    by_part: dict[str, list[dict[str, Any]]] = {}
    for w in wins:
        by_part.setdefault(w["parentId"], []).append(w)
    for rec in parts:
        part = blob["parts"][str(rec["partIndex"])]
        pw_wins = by_part.get(rec["id"], [])
        for res in augment_part(part, rec, pw_wins, wblob, corpus == "openscore-lieder", _bass_for(parts, blob, rec)):
            if res["status"] == "pass":
                content[res["id"]] = res.pop("content")
                res["dataRef"] = aref
            out.append(make_record("augment", "window", res.pop("id"), corpus, res.pop("status"), **res))
    if content:
        write_blob(b, aref, {"fileId": fid, "windows": content})
    return out


def run_augment(build: Path, workers: int | None = None) -> dict[str, Any]:
    jobs0 = _group_parts(build)
    wins = [r for r in read_jsonl(build / "windows" / "candidates.jsonl") if r["status"] == "pass"]
    by_file: dict[str, list[dict[str, Any]]] = {}
    for w in wins:
        by_file.setdefault(w["fileId"], []).append(w)
    jobs = [(b, ref, parts, sorted(by_file.get(parts[0]["parentId"], []), key=lambda r: r["id"])) for b, ref, parts in jobs0]
    t0 = time.perf_counter()
    records: list[dict[str, Any]] = []
    for recs in _map(_augment_task, jobs, workers or default_workers()):
        records.extend(recs)
    wall = time.perf_counter() - t0
    write_jsonl(build / "augment" / "candidates.jsonl", records)
    out: dict[str, Any] = {}
    for corpus in sorted({r["corpus"] for r in records}):
        rs = [r for r in records if r["corpus"] == corpus]
        var = [r for r in rs if r["id"].endswith("-aug2")]
        out[corpus] = {
            "windows": sum(1 for r in rs if r["status"] == "pass" and not r["id"].endswith("-aug2") and not r.get("fallbackFor")),
            "fallbacks": sum(1 for r in rs if r["status"] == "pass" and r.get("fallbackFor")),
            "variants": sum(1 for r in var if r["status"] == "pass"),
            "variantsBySource": dict(sorted(Counter(r["augmentFrom"] for r in var if r["status"] == "pass").items())),
            "variantsRejectedByReason": dict(sorted(Counter(r["reason"] for r in var if r["status"] == "reject").items())),
        }
    summary = {"byCorpus": out}
    _write_json(build / "augment" / "summary.json", summary)
    _write_json(build / "augment" / "timing.json", {"files": len(jobs), "wallSeconds": round(wall, 2)})
    summary["timing"] = {"files": len(jobs), "wallSeconds": wall}
    return summary
