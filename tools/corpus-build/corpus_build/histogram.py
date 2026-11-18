"""First histogram (job C6, 03 section 5.3), published before any tuning: `build/histogram.json` and `build/histogram.html`.

Counts kept windows (stage features, status pass), before dedupe, the quality filters (C7) and the review. It holds:
- windows per level, by source (corpus), meter and mode, and which feature binds the level;
- fitting excerpts per instrument x level x written key, as 02's open question 1 asks. The fit is the closed form of 03 7.3
  (instrument interval, tier band of the level from config/instruments.json and config/levels.json). A key counts for an
  excerpt of the same mode only; modal excerpts are served only under a random key (R8), so they are listed apart.
"""

from __future__ import annotations

import html
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from .features import FEATURE_KEYS, REPO, levels_config
from .phrase import tonic_pc

MAJOR_NAMES = ["Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#"]  # fifths -7..7
MINOR_NAMES = ["Abm", "Ebm", "Bbm", "Fm", "Cm", "Gm", "Dm", "Am", "Em", "Bm", "F#m", "C#m", "G#m", "D#m", "A#m"]
G2_MIN_KEYS, G2_MIN_EXCERPTS = 3, 10


def key_name(fifths: int, mode: str) -> str:
    return (MAJOR_NAMES if mode == "major" else MINOR_NAMES)[fifths + 7]


def instruments() -> list[dict[str, Any]]:
    with open(REPO / "config" / "instruments.json", encoding="utf-8") as f:
        return json.load(f)["instruments"]


def fits(lo: int, hi: int, band: tuple[int, int], chromatic: int, concert_tonic: int, target_concert_tonic: int) -> bool:
    """03 7.3: some whole-excerpt shift t = p + 12k puts [lo, hi] inside the written band, given the instrument interval."""
    t_min = band[0] - chromatic - lo
    t_max = band[1] - chromatic - hi
    if t_min > t_max:
        return False
    p = (target_concert_tonic - concert_tonic) % 12
    t0 = t_min + ((p - t_min) % 12)
    return t0 <= t_max


def fit_table(kept: list[dict[str, Any]]) -> dict[str, Any]:
    """instrument -> level -> {keys: {name: count}, keysWithAtLeast10, launchGate}."""
    lv_cfg = {lv["level"]: lv for lv in levels_config()}
    by_level: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for r in kept:
        if r.get("modal") is None and r["mode"] in ("major", "minor"):
            by_level[r["level"]].append(r)
    out: dict[str, Any] = {}
    for ins in instruments():
        chrom = ins["writtenMinusSounding"]["chromatic"]
        per_level: dict[str, Any] = {}
        for level in range(1, 11):
            cfg = lv_cfg[level]
            band = tuple(ins["tiers"][cfg["tier"]])
            wk = cfg["writtenKeys"]
            wins = by_level.get(level, [])
            counts: dict[str, int] = {}
            for mode in wk["modes"]:
                for f in range(-wk["maxAccidentals"], wk["maxAccidentals"] + 1):
                    target = (tonic_pc(f, mode) - chrom) % 12
                    n = 0
                    for r in wins:
                        if r["mode"] != mode:
                            continue
                        if fits(r["rangeConcert"]["min"], r["rangeConcert"]["max"], band, chrom, tonic_pc(r["fifths"], mode), target):
                            n += 1
                    counts[key_name(f, mode)] = n
            ok = sum(1 for v in counts.values() if v >= G2_MIN_EXCERPTS)
            per_level[str(level)] = {
                "band": list(band),
                "windows": len(wins),
                "keys": counts,
                "keysWithAtLeast10": ok,
                "minKey": min(counts.values()) if counts else 0,
                "maxKey": max(counts.values()) if counts else 0,
                "g2": ok >= G2_MIN_KEYS,
            }
        out[ins["id"]] = {"status": ins["status"], "levels": per_level}
    return out


def build_histogram(recs: list[dict[str, Any]]) -> dict[str, Any]:
    kept = [r for r in recs if r["status"] == "pass"]
    tagged = [r for r in recs if r.get("tagged")]
    levels = range(1, 11)

    def by(key: Any, rs: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
        out: dict[str, dict[str, int]] = {}
        for lv in levels:
            c = Counter(str(key(r)) for r in rs if r["level"] == lv)
            out[str(lv)] = dict(sorted(c.items()))
        return out

    def mode_of(r: dict[str, Any]) -> str:
        return r.get("modal") or r["mode"]

    binding: dict[str, dict[str, int]] = {}
    for lv in levels:
        c: Counter[str] = Counter()
        for r in kept:
            if r["level"] == lv:
                for k in FEATURE_KEYS:
                    if r["featureLevels"][k] == lv:
                        c[k] += 1
        binding[str(lv)] = {k: c.get(k, 0) for k in FEATURE_KEYS}
    cells: Counter[str] = Counter(c for r in kept for c in r["rhythmCells"])
    per_level = {str(lv): sum(1 for r in kept if r["level"] == lv) for lv in levels}
    eff = {str(lv): sum(1 for r in kept if r["effectiveLevel"] == lv) for lv in levels}
    return {
        "schemaVersion": 1,
        "_note": "Kept windows after tagging (stage features), before dedupe, quality filters and review. x2 variants are counted as windows.",
        "windowsTagged": len(tagged),
        "windowsKept": len(kept),
        "windowsRejected": dict(sorted(Counter(r["reason"] for r in recs if r["status"] == "reject").items())),
        "byLevel": per_level,
        "byEffectiveLevel": eff,
        "byLevelOriginalsOnly": {str(lv): sum(1 for r in kept if r["level"] == lv and not r["id"].endswith("-aug2")) for lv in levels},
        "byLevelVariantsOnly": {str(lv): sum(1 for r in kept if r["level"] == lv and r["id"].endswith("-aug2")) for lv in levels},
        "byLevelAndSource": by(lambda r: r["corpus"], kept),
        "byLevelAndMeter": by(lambda r: r["meter"], kept),
        "byLevelAndMode": by(mode_of, kept),
        "byLevelAndMinorForm": by(lambda r: r.get("minorForm"), [r for r in kept if r["mode"] == "minor"]),
        "bindingFeatureByLevel": binding,
        "rhythmCellCounts": dict(sorted(cells.items(), key=lambda kv: (-kv[1], kv[0]))),
        "otherCellWindows": sum(1 for r in kept if "other" in r["rhythmCells"]),
        "fit": fit_table(kept),
    }


def render_html(h: dict[str, Any]) -> str:
    rows = "".join(f"<tr><td>L{lv}</td><td>{n}</td><td>{h['byEffectiveLevel'][lv]}</td><td>{h['byLevelOriginalsOnly'][lv]}</td><td>{h['byLevelVariantsOnly'][lv]}</td></tr>" for lv, n in h["byLevel"].items())
    fit_rows = []
    for iid, ins in h["fit"].items():
        cells = "".join(f"<td>{ins['levels'][str(lv)]['keysWithAtLeast10']}</td>" for lv in range(1, 11))
        fit_rows.append(f"<tr><td>{html.escape(iid)} ({ins['status']})</td>{cells}</tr>")
    head = "".join(f"<th>L{lv}</th>" for lv in range(1, 11))
    return (
        "<!doctype html><meta charset=utf-8><title>First histogram (03 5.3)</title>"
        "<style>body{font:14px system-ui;margin:2rem}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:2px 8px;text-align:right}</style>"
        f"<h1>First histogram</h1><p>{html.escape(h['_note'])} Kept: {h['windowsKept']} of {h['windowsTagged']} tagged.</p>"
        "<h2>Windows per level</h2><table><tr><th>Level</th><th>Windows</th><th>Effective level (half cadence from L3)</th><th>Originals</th><th>x2 variants</th></tr>"
        f"{rows}</table>"
        f"<h2>Written keys with at least {G2_MIN_EXCERPTS} fitting excerpts (G2 needs {G2_MIN_KEYS})</h2><table><tr><th>Instrument</th>{head}</tr>{''.join(fit_rows)}</table>"
        "<p>The full per-key counts, meters, modes, sources and binding features are in histogram.json.</p>"
    )


def write_histogram(build: Path, recs: list[dict[str, Any]]) -> dict[str, Any]:
    h = build_histogram(recs)
    build.mkdir(parents=True, exist_ok=True)
    (build / "histogram.json").write_text(json.dumps(h, sort_keys=True, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (build / "histogram.html").write_text(render_html(h), encoding="utf-8")
    return {"byLevel": h["byLevel"], "byEffectiveLevel": h["byEffectiveLevel"], "windowsKept": h["windowsKept"], "windowsTagged": h["windowsTagged"]}
