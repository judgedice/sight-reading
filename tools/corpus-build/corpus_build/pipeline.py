"""Drivers for the stages `read`, `normalize` and `extract` (jobs C3a and C4).

Each stage reads the previous stage's output under build/, writes `build/<stage>/candidates.jsonl` (schema
candidate.schema.json), `summary.json` (deterministic counts) and, for read and normalize, per-file data blobs
(`partdata.py`). Timing goes to `timing.json` beside them, because it is the one thing that differs between runs.
Work is spread over processes. A worker writes its own blob and returns only small records.
"""

from __future__ import annotations

import json
import os
import time
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from typing import Any, Iterable

from .candidate import make_record, read_jsonl, write_jsonl
from .normalize import normalize_part, part_stats
from .partdata import blob_ref, load_blob, write_blob
from .roles import PartInfo, classify_parts, is_keyboard

SUPPORTED = ("openscore-lieder", "openscore-quartets")


def default_workers() -> int:
    return max(1, min(4, os.cpu_count() or 1))


def _write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, sort_keys=True, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _map(fn: Any, items: list[Any], workers: int) -> Iterable[Any]:
    if workers <= 1 or len(items) <= 1:
        yield from (fn(i) for i in items)
        return
    with ProcessPoolExecutor(max_workers=workers) as ex:
        yield from ex.map(fn, items, chunksize=1)


# ---------------------------------------------------------------- read

def _read_task(args: tuple[str, dict[str, Any], str]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    from .read import read_file

    abs_path, rec, build = args
    t0 = time.perf_counter()
    res = read_file(abs_path, rec["corpus"])
    fid, corpus = rec["id"], rec["corpus"]
    base = {k: rec[k] for k in ("path", "sha256", "upstream")}
    out: list[dict[str, Any]] = []
    if not res["ok"]:
        out.append(make_record("read", "file", fid, corpus, "reject", reason=res.get("reason", "parse-failed"), detail=res["error"], **base))
        return out, {"seconds": time.perf_counter() - t0}
    out.append(make_record("read", "file", fid, corpus, "pass", parts=len(res["parts"]), scoreMeta=res["meta"] or None, cueNotes=res["cueNotes"] or None, **base))
    blob: dict[str, Any] = {"fileId": fid, "parts": {}}
    ref = blob_ref("read", corpus, fid)
    for p in res["parts"]:
        info = p["info"]
        converted = "data" in p
        out.append(make_record("read", "part", f"{fid}#{info['index']}", corpus, "pass", parentId=fid, partIndex=info["index"], partId=info["id"],
                               name=info["name"], instrument=info["instrument"], sound=info["sound"], converted=converted,
                               dataRef=ref if converted else None))
        if converted:
            blob["parts"][str(info["index"])] = p["data"]
    if blob["parts"]:
        write_blob(Path(build), ref, blob)
    return out, {"seconds": time.perf_counter() - t0}


def run_read(cache: Path, build: Path, workers: int | None = None, corpus: str | None = None, limit: int | None = None) -> dict[str, Any]:
    gate = read_jsonl(build / "gate" / "candidates.jsonl")
    todo = [r for r in gate if r["kind"] == "file" and r["status"] == "pass" and r["corpus"] in SUPPORTED and (corpus is None or r["corpus"] == corpus)]
    todo.sort(key=lambda r: r["id"])
    if limit:
        todo = todo[:limit]
    jobs = [(str(cache / r["corpus"] / r["path"]), r, str(build)) for r in todo]
    t0 = time.perf_counter()
    records: list[dict[str, Any]] = []
    cpu = 0.0
    for recs, stat in _map(_read_task, jobs, workers or default_workers()):
        records.extend(recs)
        cpu += stat["seconds"]
    wall = time.perf_counter() - t0
    write_jsonl(build / "read" / "candidates.jsonl", records)
    summary = _summary(records)
    _write_json(build / "read" / "summary.json", summary)
    _write_json(build / "read" / "timing.json", {"files": len(jobs), "wallSeconds": round(wall, 2), "filesPerSecond": round(len(jobs) / wall, 2) if wall else None, "workerSeconds": round(cpu, 2)})
    summary["timing"] = {"files": len(jobs), "wallSeconds": wall}
    return summary


def _summary(records: list[dict[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for corpus in sorted({r["corpus"] for r in records}):
        by_kind: dict[str, Any] = {}
        for kind in ("file", "part"):
            rs = [r for r in records if r["corpus"] == corpus and r["kind"] == kind]
            by_kind[kind] = {"records": len(rs), "pass": sum(r["status"] == "pass" for r in rs), "reject": sum(r["status"] == "reject" for r in rs),
                             "rejectedByReason": dict(sorted(Counter(r["reason"] for r in rs if r["status"] == "reject").items()))}
        out[corpus] = by_kind
    return {"byCorpus": out}


# ---------------------------------------------------------------- normalize

def _normalize_task(args: tuple[str, str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    build, ref, part_recs = args
    raw = load_blob(Path(build), ref)
    fid = raw["fileId"]
    out: list[dict[str, Any]] = []
    blob: dict[str, Any] = {"fileId": fid, "parts": {}}
    nref = blob_ref("normalize", part_recs[0]["corpus"], fid)
    for pr in part_recs:
        idx = str(pr["partIndex"])
        base = {"parentId": fid, "partIndex": pr["partIndex"], "partId": pr["partId"], "name": pr["name"], "instrument": pr["instrument"]}
        rawpart = raw["parts"].get(idx)
        try:
            if rawpart is None or not rawpart["measures"]:
                out.append(make_record("normalize", "part", pr["id"], pr["corpus"], "reject", reason="no-measures", detail="the part has no measures", **base))
                continue
            part = normalize_part(rawpart)
        except Exception as e:  # noqa: BLE001
            out.append(make_record("normalize", "part", pr["id"], pr["corpus"], "reject", reason="normalize-failed", detail=f"{type(e).__name__}: {str(e)[:200]}", **base))
            continue
        blob["parts"][idx] = part
        out.append(make_record("normalize", "part", pr["id"], pr["corpus"], "pass", stats=part_stats(part), dataRef=nref, **base))
    if blob["parts"]:
        write_blob(Path(build), nref, blob)
    return out


def run_normalize(build: Path, workers: int | None = None) -> dict[str, Any]:
    reads = read_jsonl(build / "read" / "candidates.jsonl")
    by_ref: dict[str, list[dict[str, Any]]] = {}
    for r in reads:
        if r["kind"] == "part" and r.get("converted"):
            by_ref.setdefault(r["dataRef"], []).append(r)
    jobs = [(str(build), ref, sorted(rs, key=lambda r: r["partIndex"])) for ref, rs in sorted(by_ref.items())]
    t0 = time.perf_counter()
    records: list[dict[str, Any]] = []
    for recs in _map(_normalize_task, jobs, workers or default_workers()):
        records.extend(recs)
    wall = time.perf_counter() - t0
    write_jsonl(build / "normalize" / "candidates.jsonl", records)
    summary = _summary(records)
    for corpus in summary["byCorpus"]:
        probs: Counter[str] = Counter()
        tags: Counter[str] = Counter()
        measures = notes = bad = 0
        for r in records:
            if r["corpus"] == corpus and r["status"] == "pass":
                s = r["stats"]
                probs.update(s["problems"])
                tags.update(s["tags"])
                measures += s["measures"]
                notes += s["notes"]
                bad += s["measuresWithProblems"]
        summary["byCorpus"][corpus]["measures"] = {"total": measures, "withProblems": bad, "notes": notes, "problems": dict(sorted(probs.items())), "tags": dict(sorted(tags.items()))}
    _write_json(build / "normalize" / "summary.json", summary)
    _write_json(build / "normalize" / "timing.json", {"files": len(jobs), "wallSeconds": round(wall, 2), "filesPerSecond": round(len(jobs) / wall, 2) if wall else None})
    summary["timing"] = {"files": len(jobs), "wallSeconds": wall}
    return summary


# ---------------------------------------------------------------- extract

def run_extract(build: Path) -> dict[str, Any]:
    reads = read_jsonl(build / "read" / "candidates.jsonl")
    norm = {r["id"]: r for r in read_jsonl(build / "normalize" / "candidates.jsonl")}
    by_file: dict[str, list[dict[str, Any]]] = {}
    for r in reads:
        if r["kind"] == "part":
            by_file.setdefault(r["parentId"], []).append(r)
    out: list[dict[str, Any]] = []
    unmatched: dict[str, Counter[str]] = {}
    keyboard: Counter[str] = Counter()
    roles: dict[str, Counter[str]] = {}
    for fid, parts in sorted(by_file.items()):
        corpus = parts[0]["corpus"]
        parts.sort(key=lambda r: r["partIndex"])
        infos = [PartInfo(r["partIndex"], r["partId"], r["name"], r["instrument"], r["sound"]) for r in parts]
        decisions = classify_parts(corpus, infos)
        for r, info in zip(parts, infos):
            d = decisions[info.index]
            base = {"parentId": fid, "partIndex": r["partIndex"], "partId": r["partId"], "name": r["name"], "instrument": r["instrument"]}
            if not d.accept:
                out.append(make_record("extract", "part", r["id"], corpus, "reject", reason=d.reason, detail=d.detail, **base))
                if d.reason == "piano-part-not-read" or is_keyboard(info):
                    keyboard[info.name] += 1
                else:
                    unmatched.setdefault(corpus, Counter())[f"{info.name} | {info.instrument}"] += 1
                continue
            n = norm.get(r["id"])
            if n is None or n["status"] != "pass":
                out.append(make_record("extract", "part", r["id"], corpus, "reject", reason="normalize-rejected" if n else "not-normalized",
                                       detail=(n or {}).get("reason", "the part has no normalized data"), **base))
                continue
            roles.setdefault(corpus, Counter())[d.role or ""] += 1
            out.append(make_record("extract", "part", r["id"], corpus, "pass", role=d.role, roleLabel=d.label, instrumentMismatch=d.instrument_mismatch or None,
                                   stats=n["stats"], dataRef=n["dataRef"], **base))
    write_jsonl(build / "extract" / "candidates.jsonl", out)
    summary = _summary(out)
    for corpus in summary["byCorpus"]:
        summary["byCorpus"][corpus]["rolesPassed"] = dict(sorted(roles.get(corpus, Counter()).items()))
        summary["byCorpus"][corpus]["unmatchedNames"] = dict(sorted(unmatched.get(corpus, Counter()).items()))
        for k in ("measures", "notes"):
            summary["byCorpus"][corpus][k] = sum(r["stats"][k] for r in out if r["corpus"] == corpus and r["status"] == "pass")
    summary["keyboardPartsNotRead"] = sum(keyboard.values())
    _write_json(build / "extract" / "summary.json", summary)
    return summary

