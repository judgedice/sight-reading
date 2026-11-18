"""Driver for the stage `filters` (job C7, 03 sections 6.8 familiarity and 6.9).

Reads `build/features/candidates.jsonl` (kept windows), measures each window (`quality.measure`), adds the quartet
context (Vn I's interest and onsets in the same bars, the other parts for the cello bass test, from the normalized
parts of `build/extract`), applies `config/filters.yaml` (`quality.decide`), matches `familiar.yaml` and writes
`build/filters/`:
- `candidates.jsonl`: one kind=window record per input window (stage filters). Status pass or reject with the first
  failing rule as `reason` (every failing rule is in `failedRules`). Every record carries `quality` {soft, softParts,
  interest, interestThreshold, interestMargin, metrics}, `flags` (noBreath, leapy, bass-line), `familiarity` (0 or 2,
  with `familiarMatch`), `fingerprint` (03 6.10 tokens) and, for quartet inner and cello parts, `melodicRole`.
- `summary.json`, `timing.json`.
"""

from __future__ import annotations

import time
from collections import Counter
from pathlib import Path
from typing import Any

from .candidate import make_record, read_jsonl, write_jsonl
from .familiar import load_familiar, match_familiar
from .partdata import load_blob
from .pipeline import _map, _write_json, default_workers
from .quality import bass_function, decide, filters_config, fingerprint, measure, notes_of, onset_coincidence, segment, segment_interest

CARRY_DROP = ("stage", "status", "schemaVersion", "kind", "id", "corpus", "reason", "detail")


def file_parts(build: Path) -> dict[str, dict[str, Any]]:
    """fileId -> {dataRef (normalized blob), parts: {partIndex: role}} from the extract stage (passing parts only)."""
    out: dict[str, dict[str, Any]] = {}
    for r in read_jsonl(build / "extract" / "candidates.jsonl"):
        if r["kind"] != "part" or r["status"] != "pass":
            continue
        e = out.setdefault(r["parentId"], {"dataRef": r["dataRef"], "parts": {}})
        e["parts"][str(r["partIndex"])] = {"role": r.get("role"), "roleLabel": r.get("roleLabel")}
    return out


def tempo_texts(part: dict[str, Any] | None, rec: dict[str, Any]) -> list[str]:
    texts = []
    t = rec.get("tempoAtStart") or {}
    if t.get("text"):
        texts.append(t["text"])
    if part:
        lo = rec.get("pickupMeasure") if rec.get("pickupMeasure") is not None else rec["firstMeasure"]
        for e in part.get("tempo") or []:
            if lo <= e["index"] <= rec["lastMeasure"] and e.get("text"):
                texts.append(e["text"])
    return texts


def quartet_context(parts: dict[str, Any], roles: dict[str, Any], rec: dict[str, Any], mids: list[int]) -> dict[str, Any]:
    """Vn I comparison (inner parts and cello) and the cello bass test, over the window's source bars."""
    out: dict[str, Any] = {}
    me = parts.get(str(rec["partIndex"]))
    vn1_idx = next((k for k, v in roles.items() if v["role"] == "vn1"), None)
    first, last = rec["firstMeasure"], rec["lastMeasure"]
    if me is None:
        return out
    seg_me = segment(me["measures"], first, last)
    seg_vn1 = segment(parts[vn1_idx]["measures"], first, last) if vn1_idx is not None and vn1_idx in parts else None
    out["partSegmentInterest"] = segment_interest(seg_me)
    out["vn1Interest"] = segment_interest(seg_vn1)
    out["vn1Coincidence"] = onset_coincidence(seg_me, seg_vn1)
    if rec.get("role") == "cello":
        others = [p["measures"] for k, p in sorted(parts.items()) if k != str(rec["partIndex"])]
        out["bass"] = bass_function(me["measures"], others, first, last, mids)
    return out


def filter_window(content: dict[str, Any], rec: dict[str, Any], parts: dict[str, Any] | None, roles: dict[str, Any] | None, familiar: list[dict[str, Any]], cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    """Everything the filters stage adds to one features-stage record. Pure apart from the inputs."""
    cfg = cfg or filters_config()
    part = parts.get(str(rec["partIndex"])) if parts else None
    m = measure(content, rec, tempo_texts(part, rec))
    ch = notes_of(content)
    mids = [c["midi"] for c in ch]
    ctx: dict[str, Any] = {
        "level": rec.get("effectiveLevel") or rec["level"],
        "corpus": rec["corpus"],
        "role": rec.get("role"),
        "densityLevel": (rec.get("featureLevels") or {}).get("density"),
    }
    role_info: dict[str, Any] | None = None
    if rec["corpus"] == "openscore-quartets" and rec.get("role") in ("inner", "cello") and parts is not None and roles is not None:
        q = quartet_context(parts, roles, rec, mids)
        ctx.update(q)
        role_info = {k: (round(v, 4) if isinstance(v, float) else v) for k, v in q.items() if k != "bass"}
        if "bass" in q:
            role_info["bass"] = {k: (round(v, 4) if isinstance(v, float) else v) for k, v in q["bass"].items()}
    d = decide(m, ctx, cfg)
    fp = fingerprint(ch, cfg["dedupe"]["ioi_ratio_quantisation"])
    fam = match_familiar(fp, familiar)
    soft = m.pop("soft")
    quality = {
        "soft": m["softMean"],
        "softParts": soft,
        "interest": m["interest"],
        "interestThreshold": d["interestThreshold"],
        "interestMargin": round(m["interest"] - d["interestThreshold"], 4),
        "metrics": {k: v for k, v in m.items() if k not in ("softMean", "interest")},
    }
    return {
        "decision": d,
        "quality": quality,
        "flags": d["flags"],
        "familiarity": 2 if fam else 0,
        "familiarMatch": fam,
        "fingerprint": fp,
        "melodicRole": role_info,
        "tagsAdded": d["tags"],
    }


def _group(recs: list[dict[str, Any]]) -> list[tuple[str, list[dict[str, Any]]]]:
    by_ref: dict[str, list[dict[str, Any]]] = {}
    for r in recs:
        by_ref.setdefault(r["dataRef"], []).append(r)
    return [(ref, sorted(rs, key=lambda r: r["id"])) for ref, rs in sorted(by_ref.items())]


def _task(args: tuple[str, str, list[dict[str, Any]], dict[str, Any] | None, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    build, ref, recs, fileinfo, familiar = args
    b = Path(build)
    windows = load_blob(b, ref)["windows"]
    parts = roles = None
    if fileinfo is not None:
        parts = load_blob(b, fileinfo["dataRef"])["parts"]
        roles = fileinfo["parts"]
    out: list[dict[str, Any]] = []
    for r in recs:
        res = filter_window(windows[r["id"]], r, parts, roles, familiar)
        carry = {k: v for k, v in r.items() if k not in CARRY_DROP}
        carry["tags"] = sorted(set(r.get("tags") or []) | set(res["tagsAdded"]))
        d = res["decision"]
        fields = dict(
            carry,
            quality=res["quality"],
            flags=res["flags"],
            familiarity=res["familiarity"],
            familiarMatch=res["familiarMatch"],
            fingerprint=res["fingerprint"],
            melodicRole=res["melodicRole"],
            failedRules=d["reasons"],
        )
        if d["reason"]:
            out.append(make_record("filters", "window", r["id"], r["corpus"], "reject", reason=d["reason"], detail=d["detail"], **fields))
        else:
            out.append(make_record("filters", "window", r["id"], r["corpus"], "pass", **fields))
    return out


def run_filters(build: Path, workers: int | None = None) -> dict[str, Any]:
    recs0 = [r for r in read_jsonl(build / "features" / "candidates.jsonl") if r["status"] == "pass"]
    files = file_parts(build)
    familiar = load_familiar()
    jobs = []
    for ref, rs in _group(recs0):
        fid = rs[0]["fileId"]
        info = files.get(fid) if rs[0]["corpus"] == "openscore-quartets" else None
        jobs.append((str(build), ref, rs, info, familiar))
    t0 = time.perf_counter()
    out: list[dict[str, Any]] = []
    for part in _map(_task, jobs, workers or default_workers()):
        out.extend(part)
    wall = time.perf_counter() - t0
    write_jsonl(build / "filters" / "candidates.jsonl", out)
    summary = filters_summary(out)
    _write_json(build / "filters" / "summary.json", summary)
    _write_json(build / "filters" / "timing.json", {"files": len(jobs), "wallSeconds": round(wall, 2)})
    summary["timing"] = {"files": len(jobs), "wallSeconds": wall}
    return summary


def filters_summary(recs: list[dict[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for corpus in sorted({r["corpus"] for r in recs}):
        rs = [r for r in recs if r["corpus"] == corpus]
        kept = [r for r in rs if r["status"] == "pass"]
        fails: Counter[str] = Counter(c for r in rs for c in r["failedRules"])
        out[corpus] = {
            "windows": len(rs),
            "kept": len(kept),
            "rejectedByReason": dict(sorted(Counter(r["reason"] for r in rs if r["status"] == "reject").items())),
            "failingRuleCounts": dict(sorted(fails.items())),
            "keptByLevel": {str(k): v for k, v in sorted(Counter(r["effectiveLevel"] for r in kept).items())},
            "flags": dict(sorted(Counter(f for r in kept for f in r["flags"]).items())),
            "familiar": sum(1 for r in kept if r["familiarity"] == 2),
            "keptByRole": dict(sorted(Counter(r.get("roleLabel") or r.get("role") for r in kept).items())),
        }
    return {"byCorpus": out}
