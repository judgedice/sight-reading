"""R1 statistical outliers (job C8, 03 section 6.12 R1).

Runs over the windows that survived dedupe (`build/dedupe/candidates.jsonl`, status pass), grouped by served level
(`effectiveLevel`). Three checks, every one of which can only reject:

1. Tails. For each metric in `config/filters.yaml` `outliers.metrics`, the items in the top and bottom `tail_percent`
   of their level are flagged. Items are ordered by robust z-score, (x - median) / (1.4826 * MAD); with MAD 0 the
   scale falls back to 1.2533 * mean absolute deviation, and a metric with no spread at all flags nothing. The tail
   holds floor(n * tail_percent / 100) items per side; items tied with the first item inside the body are not flagged,
   so a tail never exceeds its share and the result does not depend on input order. A window flagged on
   `reject_if_flagged_on_at_least` (2) or more metrics is rejected (`outlier`); one flagged on exactly one metric needs
   the agent veto (R2), which under ruling 48 means it is excluded above L3.
2. `levelConfidence == 1` above `reject_level_confidence_1_above_level` (L6) is report-only since ruling 49
   (`level_confidence_1_report_only: true`): `level_confidence_reported` says so and the review summary counts it, but nothing is
   rejected. With the flag false it rejects (`level-confidence`) as before.
3. Krumhansl-Schmuckler key. The duration-weighted pitch-class profile of the window is correlated with the 24
   Krumhansl-Kessler key profiles. Major and minor windows whose signature-plus-final key disagrees are rejected
   (`key-profile`). "Disagrees" is defined in `config/review.yaml` `key_profile` because strict best-key equality
   rejects about half of all windows: an 8 to 12 bar single line routinely correlates best with its dominant, its
   relative or its mediant minor (measured on the build of 2026-11-18: 51% of L1-L3 and 58% of L4+ survivors). The
   signature key agrees when it is the best key, or when the best key is closely related to it (the key signatures
   differ by at most one accidental) and, if `related_margin` is set, its correlation is within that margin of the
   best. With no margin this rejects 18 of 312 L1-L3 and 246 of 1944 L4+ survivors. Modal windows are not checked.

Metrics: notes per bar (noteCount / bars), peak notes per second (peakNotesPerBeat at the level's fastest served tempo),
rest ratio, interest (C7), span in semitones and the syncopation index (C6).
"""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Callable, Iterable
from typing import Any

from .features import levels_config
from .phrase import KK_MAJOR, KK_MINOR, tonic_pc
from .quality import filters_config

MAD_SCALE = 1.4826
MEAN_AD_SCALE = 1.2533


def _max_bpm(level: int) -> float:
    for lv in levels_config():
        if lv["level"] == level:
            return float(lv["tempo"]["maxBpm"])
    raise KeyError(level)


METRICS: dict[str, Callable[[dict[str, Any]], float | None]] = {
    "notes_per_bar": lambda r: r["features"]["noteCount"] / r["bars"] if r.get("bars") else None,
    "peak_notes_per_second": lambda r: r["features"]["peakNotesPerBeat"] * _max_bpm(r["effectiveLevel"]) / 60.0,
    "rest_ratio": lambda r: r["features"]["restRatio"],
    "interest": lambda r: (r.get("quality") or {}).get("interest"),
    "span": lambda r: r["features"]["spanSemis"],
    "syncopation_index": lambda r: r["features"]["syncopationIndex"],
}


def _median(xs: list[float]) -> float:
    s = sorted(xs)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


def robust_z(values: list[float]) -> list[float] | None:
    """Robust z-scores, or None when the values have no spread."""
    med = _median(values)
    mad = _median([abs(v - med) for v in values])
    scale = MAD_SCALE * mad
    if scale <= 0:
        scale = MEAN_AD_SCALE * (sum(abs(v - med) for v in values) / len(values))
    if scale <= 0:
        return None
    return [(v - med) / scale for v in values]


def tail_flags(ids: list[str], values: list[float], tail_percent: float) -> dict[str, tuple[str, float]]:
    """id -> ('high' | 'low', z) for the items in the top and bottom tail of one metric at one level."""
    n = len(values)
    k = math.floor(n * tail_percent / 100.0 + 1e-9)
    if k == 0:
        return {}
    z = robust_z(values)
    if z is None:
        return {}
    out: dict[str, tuple[str, float]] = {}
    order = sorted(range(n), key=lambda i: z[i])
    for side, seq in (("low", order), ("high", order[::-1])):
        boundary = z[seq[k]] if k < n else None
        for i in seq[:k]:
            if boundary is not None and z[i] == boundary:
                break
            if (side == "high" and z[i] <= 0) or (side == "low" and z[i] >= 0):
                break
            out.setdefault(ids[i], (side, round(z[i], 4)))
    return out


def outlier_flags(recs: Iterable[dict[str, Any]], cfg: dict[str, Any] | None = None) -> dict[str, list[dict[str, Any]]]:
    """id -> list of {metric, side, z} for every record, per level."""
    ocfg = (cfg or filters_config())["outliers"]
    by_level: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for r in recs:
        by_level[r["effectiveLevel"]].append(r)
    flags: dict[str, list[dict[str, Any]]] = {}
    for level in sorted(by_level):
        rs = sorted(by_level[level], key=lambda r: r["id"])
        for r in rs:
            flags[r["id"]] = []
        for metric in ocfg["metrics"]:
            fn = METRICS[metric]
            raw = [(r["id"], fn(r)) for r in rs]
            pairs = [(i, float(v)) for i, v in raw if v is not None]
            hit = tail_flags([i for i, _ in pairs], [v for _, v in pairs], float(ocfg["tail_percent"]))
            for rid, (side, z) in hit.items():
                flags[rid].append({"metric": metric, "side": side, "z": z})
    return flags


# --- Krumhansl-Schmuckler ---------------------------------------------------------------------------------------------


def pc_profile(content: dict[str, Any]) -> list[float]:
    h = [0.0] * 12
    for m in content["measures"]:
        for e in m["events"]:
            if e["kind"] == "note":
                h[e["midi"] % 12] += e["dur"]
    return h


def _corr(xs: list[float], profile: tuple[float, ...], tonic: int) -> float:
    p = [profile[(i - tonic) % 12] for i in range(12)]
    mx, my = sum(xs) / 12, sum(p) / 12
    num = sum((x - mx) * (y - my) for x, y in zip(xs, p))
    den = math.sqrt(sum((x - mx) ** 2 for x in xs) * sum((y - my) ** 2 for y in p))
    return num / den if den else 0.0


def key_scores(content: dict[str, Any]) -> dict[tuple[int, str], float]:
    h = pc_profile(content)
    sc = {(t, "major"): _corr(h, KK_MAJOR, t) for t in range(12)}
    sc.update({(t, "minor"): _corr(h, KK_MINOR, t) for t in range(12)})
    return sc


SIG_OF_MAJOR_TONIC = {0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 1: -5, 8: -4, 3: -3, 10: -2, 5: -1}


def signature_of(key: tuple[int, str]) -> int:
    """Key signature (fifths, flats negative; F sharp and G flat both 6 / -6 count as one) of (tonic pc, mode)."""
    t, m = key
    return SIG_OF_MAJOR_TONIC[(t + 3) % 12 if m == "minor" else t]


def closely_related(a: tuple[int, str], b: tuple[int, str]) -> bool:
    """The textbook relation: the two key signatures differ by at most one accidental (I, ii, iii, IV, V, vi of a major
    key; i, III, iv, v, VI, VII of a minor key, and the relative)."""
    d = (signature_of(a) - signature_of(b)) % 12
    return d in (0, 1, 11)


def key_check(content: dict[str, Any], kcfg: dict[str, Any]) -> dict[str, Any] | None:
    """None for modal windows; else {expected, best, rExpected, rBest, agrees}."""
    mode = content.get("modal") or content["mode"]
    if mode not in ("major", "minor"):
        return None
    sc = key_scores(content)
    exp = (tonic_pc(content["fifths"], mode), mode)
    best = max(sorted(sc), key=lambda k: sc[k])
    r_exp, r_best = sc[exp], sc[best]
    margin = kcfg.get("related_margin")
    agrees = best == exp or (closely_related(best, exp) and (margin is None or r_best - r_exp <= float(margin) + 1e-12))
    return {"expected": list(exp), "best": list(best), "rExpected": round(r_exp, 4), "rBest": round(r_best, 4), "agrees": agrees}


def level_confidence_reported(rec: dict[str, Any], ocfg: dict[str, Any]) -> bool:
    """True when the level rests on one feature above the configured level (rejected or, under ruling 49, only reported)."""
    return rec.get("levelConfidence") == 1 and rec["effectiveLevel"] > int(ocfg["reject_level_confidence_1_above_level"])


def r1_decision(rec: dict[str, Any], flags: list[dict[str, Any]], key: dict[str, Any] | None, cfg: dict[str, Any] | None = None) -> tuple[str | None, str | None]:
    """(reason, detail) when R1 rejects the window, else (None, None)."""
    ocfg = (cfg or filters_config())["outliers"]
    if len(flags) >= int(ocfg["reject_if_flagged_on_at_least"]):
        return "outlier", "flagged on " + ", ".join(f"{f['metric']} ({f['side']}, z {f['z']})" for f in flags)
    if not ocfg.get("level_confidence_1_report_only", False) and level_confidence_reported(rec, ocfg):
        return "level-confidence", f"a single feature sets level {rec['effectiveLevel']}"
    if key is not None and not key["agrees"]:
        return "key-profile", f"Krumhansl-Schmuckler best key {key['best']} (r {key['rBest']}) disagrees with the signature-plus-final key {key['expected']} (r {key['rExpected']})"
    return None, None


__all__ = ["METRICS", "closely_related", "key_check", "level_confidence_reported", "key_scores", "outlier_flags", "r1_decision", "robust_z", "signature_of", "tail_flags"]
