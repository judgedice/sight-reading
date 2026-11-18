"""Automated threshold calibration for the quality filters (job C7, 03 section 6.9 "Threshold calibration, automated").

Control sets, drawn from the corpus by rule (no hand-labelled windows):
- positives: Vn I windows that open a movement (the window's first bar is the movement's first bar, or the first bar in
  which Vn I plays) and end in a PAC; complete Mutopia hymn phrases (none until job C3b yields files);
- negatives: viola and cello windows whose Vn I interest, over the same source bars, is at least 0.2 higher; plus a
  synthetic broken-chord rendering (Alberti figure in eighths) of the harmony of every control window's bars, built from
  the four quartet parts, cut and tagged like a real window.

Every control item is measured once (`quality.measure`); `evaluate` re-decides them under any thresholds. `fit` runs a
coordinate search over the thresholds 03 owns (FITTED), keeping 02's pedagogical rules fixed (rests, literal bar repeats,
pitch and rhythm variety, the soft-score cut, the 0.25 interest floor for quartet inner parts at L1 and L2). For each
threshold it picks, with the others fixed, the grid value with the highest positive acceptance among those that keep
negative rejection at or above the target; ties go to the value closest to the spec's starting point. So a threshold
moves only when moving it accepts more positive controls, and it is never tightened just because negatives allow it.

`python -m corpus_build calibrate` writes `build/calibration/report.json` and `build/calibration/filters.fitted.yaml`.
The fitted values are copied into `config/filters.yaml` by hand and committed (03: "the fitted values are committed"),
with the control counts and rates in its `calibration` block. tests/test_filters_real.py checks the committed values
still meet the target on the current build.
"""

from __future__ import annotations

import copy
from pathlib import Path
from typing import Any

from .candidate import read_jsonl
from .features import TooFewNotes, tag_window
from .filter_stage import file_parts, quartet_context, tempo_texts
from .partdata import load_blob
from .phrase import make_meter
from .quality import decide, filters_config, measure, notes_of
from .window_stage import load_window

NEG_INTEREST_GAP = 0.2
# harmonic rhythm of the synthetic accompaniment: chords per bar by counts per bar (one per bar otherwise)
HARMONIC_STEPS = {4: 2, 2: 1, 3: 1, 6: 2}

# (path in filters.yaml, grid). The spec's value is always on the grid.
FITTED: list[tuple[tuple[str, ...], list[float]]] = [
    (("hard_rejects", "repetition", "repeated_note_ratio_max"), [round(0.25 + 0.01 * i, 2) for i in range(36)]),
    (("hard_rejects", "broken_chord", "interval_share_max"), [round(0.3 + 0.05 * i, 2) for i in range(11)]),
    (("hard_rejects", "pedal_alternation_share_max"), [round(0.15 + 0.01 * i, 2) for i in range(31)]),
    (("hard_rejects", "static_contour", "contour_changes_per_note_min"), [round(0.05 + 0.01 * i, 2) for i in range(16)]),
    (("hard_rejects", "sustained_harmony_share_max"), [round(0.4 + 0.05 * i, 2) for i in range(11)]),
    (("hard_rejects", "fragments_min_notes_per_8_bars"), [float(v) for v in range(8, 17)]),
    (("hard_rejects", "quartet_melodic_role", "onset_coincidence_max"), [round(0.5 + 0.05 * i, 2) for i in range(9)]),
    (("interest", "reject_below"), [round(0.25 + 0.01 * i, 2) for i in range(21)]),
]


def get_path(cfg: dict[str, Any], path: tuple[str, ...]) -> Any:
    v: Any = cfg
    for k in path:
        v = v[k]
    return v


def set_path(cfg: dict[str, Any], path: tuple[str, ...], value: Any) -> None:
    v: Any = cfg
    for k in path[:-1]:
        v = v[k]
    v[path[-1]] = value


# ---------------------------------------------------------------- control sets

def movement_starts(part: dict[str, Any]) -> dict[int, set[int]]:
    """movement -> {index of its first measure, index of its first measure with a note}."""
    out: dict[int, set[int]] = {}
    seen_note: set[int] = set()
    for m in part["measures"]:
        mv = m["movement"]
        if mv not in out:
            out[mv] = {m["index"]}
        if mv not in seen_note and any(e["kind"] == "note" for e in m["events"]):
            out[mv].add(m["index"])
            seen_note.add(mv)
    return out


def is_opening(rec: dict[str, Any], starts: dict[int, set[int]]) -> bool:
    first = rec["pickupMeasure"] if rec.get("pickupMeasure") is not None else rec["firstMeasure"]
    return first in starts.get(rec["movement"], set()) or rec["firstMeasure"] in starts.get(rec["movement"], set())


def sounding(part: dict[str, Any], mi: int, tick: int) -> int | None:
    ms = part["measures"]
    if mi >= len(ms):
        return None
    for e in ms[mi]["events"]:
        if e["tick"] <= tick < e["tick"] + e["dur"] and e["kind"] == "note":
            return e["midi"]
    return None


def broken_chord_rendering(parts: dict[str, Any], rec: dict[str, Any], low: int) -> dict[str, Any] | None:
    """A synthetic negative: the harmony of the window's source bars (pitches sounding in the four parts on the downbeat,
    and on the half bar in meters of 4 or 6 counts, HARMONIC_STEPS), rendered as an Alberti figure (low, high, middle,
    high) in eighths from `low` upwards, ending on a held root. Same meter, same bars. None if the bars hold too little
    harmony."""
    any_part = next(iter(parts.values()))
    m0 = any_part["measures"][rec["firstMeasure"]]
    meter = make_meter(m0["beats"], m0["beatType"])
    unit = meter["countUnitTicks"]
    bt = meter["beats"] * (480 * 4 // meter["beatType"])
    sub = 240
    measures = []
    t = 0
    prev: list[int] | None = None
    k = 0
    for i, mi in enumerate(range(rec["firstMeasure"], rec["lastMeasure"] + 1)):
        evs: list[dict[str, Any]] = []
        last_bar = mi == rec["lastMeasure"]
        steps = HARMONIC_STEPS.get(meter["countsPerBar"], 1)
        hstep = bt // steps
        for beat in range(0, bt, unit):
            hb = (beat // hstep) * hstep
            pcs = sorted({p for p in (sounding(pt, mi, hb) for pt in parts.values()) if p is not None})
            if len({p % 12 for p in pcs}) >= 2:
                bass = pcs[0] % 12
                rest = sorted({(p - bass) % 12 for p in pcs} - {0})
                root = low + ((bass - low) % 12)
                chord = [root] + [root + r for r in rest]
                prev = chord
            if prev is None:
                continue
            if last_bar:
                evs.append({"kind": "note", "tick": t + beat, "dur": bt - beat, "midi": prev[0], "alter": 0})
                break
            for s in range(0, unit, sub):
                lo, mid, hi = prev[0], prev[1 % len(prev)], prev[-1]
                fig = (lo, hi, mid, hi)[k % 4]
                k += 1
                evs.append({"kind": "note", "tick": t + beat + s, "dur": sub, "midi": fig, "alter": 0})
        if not evs or evs[0]["tick"] != t:
            return None
        # fill a bar the harmony left short (no harmony on the first beats is rejected above)
        end = evs[-1]["tick"] + evs[-1]["dur"]
        if end < t + bt:
            evs[-1]["dur"] += t + bt - end
        measures.append({"index": i, "isPickup": False, "startTick": t, "events": evs})
        t += bt
    if not measures:
        return None
    return {"meter": meter, "fifths": m0["fifths"], "mode": "major", "modal": None, "pickupTicks": 0, "measures": measures, "bars": len(measures)}


def _item(metrics: dict[str, Any], ctx: dict[str, Any], id: str, kind: str) -> dict[str, Any]:
    return {"id": id, "kind": kind, "metrics": metrics, "ctx": ctx}


def control_sets(build: Path) -> dict[str, list[dict[str, Any]]]:
    """{positives, negatives, synthetic}: measured control items (metrics plus the decide() context)."""
    recs = [r for r in read_jsonl(build / "features" / "candidates.jsonl") if r["status"] == "pass" and r["corpus"] == "openscore-quartets" and not r["id"].endswith("-aug2")]
    files = file_parts(build)
    by_file: dict[str, list[dict[str, Any]]] = {}
    for r in recs:
        by_file.setdefault(r["fileId"], []).append(r)
    pos: list[dict[str, Any]] = []
    neg: list[dict[str, Any]] = []
    syn: list[dict[str, Any]] = []
    for fid in sorted(by_file):
        info = files.get(fid)
        if info is None:
            continue
        parts = load_blob(build, info["dataRef"])["parts"]
        roles = info["parts"]
        starts: dict[str, dict[int, set[int]]] = {}
        for r in sorted(by_file[fid], key=lambda r: r["id"]):
            role = r.get("role")
            control: str | None = None
            if role == "vn1" and r.get("cadenceEnd") == "PAC":
                k = str(r["partIndex"])
                if k not in starts:
                    starts[k] = movement_starts(parts[k])
                if is_opening(r, starts[k]):
                    control = "positive"
            elif r.get("roleLabel") in ("Va", "Vc"):
                content = load_window(build, r)
                q = quartet_context(parts, roles, r, [c["midi"] for c in notes_of(content)])
                vi, pi = q.get("vn1Interest"), q.get("partSegmentInterest")
                if vi is not None and pi is not None and vi - pi >= NEG_INTEREST_GAP - 1e-9:
                    control = "negative"
            if control is None:
                continue
            content = load_window(build, r)
            ctx = {"level": r.get("effectiveLevel") or r["level"], "corpus": r["corpus"], "role": role, "densityLevel": r["featureLevels"]["density"]}
            if role in ("inner", "cello"):
                ctx.update(quartet_context(parts, roles, r, [c["midi"] for c in notes_of(content)]))
            m = measure(content, r, tempo_texts(parts.get(str(r["partIndex"])), r))
            (pos if control == "positive" else neg).append(_item(m, ctx, r["id"], control))
            synth = broken_chord_rendering(parts, r, r["rangeConcert"]["min"])
            if synth is None:
                continue
            try:
                tag = tag_window(synth)
            except TooFewNotes:
                continue
            srec = dict(tag, bars=synth["bars"], phraseQuality="complete-phrase", effectiveLevel=tag["level"])
            sm = measure(synth, srec, [])
            sctx = {"level": tag["level"], "corpus": "synthetic", "role": "vn1", "densityLevel": tag["featureLevels"]["density"]}
            syn.append(_item(sm, sctx, r["id"] + "#broken-chord", "synthetic"))
    return {"positives": pos, "negatives": neg, "synthetic": syn}


# ---------------------------------------------------------------- evaluation and fit

def evaluate(sets: dict[str, list[dict[str, Any]]], cfg: dict[str, Any]) -> dict[str, Any]:
    def rejected(items: list[dict[str, Any]]) -> list[str | None]:
        return [decide(i["metrics"], i["ctx"], cfg)["reason"] for i in items]

    pr = rejected(sets["positives"])
    nr = rejected(sets["negatives"])
    sr = rejected(sets["synthetic"])
    npos, nneg = len(pr), len(nr) + len(sr)
    acc = sum(1 for x in pr if x is None) / npos if npos else 0.0
    rej = (sum(1 for x in nr if x) + sum(1 for x in sr if x)) / nneg if nneg else 0.0

    def counts(rs: list[str | None]) -> dict[str, int]:
        out: dict[str, int] = {}
        for x in rs:
            k = x or "accepted"
            out[k] = out.get(k, 0) + 1
        return dict(sorted(out.items()))

    return {
        "positives": npos,
        "negativesReal": len(nr),
        "negativesSynthetic": len(sr),
        "positiveAcceptance": round(acc, 4),
        "negativeRejection": round(rej, 4),
        "negativeRejectionReal": round(sum(1 for x in nr if x) / len(nr), 4) if nr else None,
        "negativeRejectionSynthetic": round(sum(1 for x in sr if x) / len(sr), 4) if sr else None,
        "positiveOutcomes": counts(pr),
        "negativeOutcomes": counts(nr),
        "syntheticOutcomes": counts(sr),
    }


def fit(sets: dict[str, list[dict[str, Any]]], cfg0: dict[str, Any], spec: dict[str, Any] | None = None, rounds: int = 4) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Coordinate search (see the module docstring). `spec` holds the starting values ties are broken towards."""
    cfg = copy.deepcopy(cfg0)
    spec = spec or cfg0
    target_neg = cfg["control_calibration"]["negative_rejection_min"]
    trace: list[dict[str, Any]] = []
    for rnd in range(rounds):
        changed = False
        for path, grid in FITTED:
            cur = get_path(cfg, path)
            start = get_path(spec, path)
            best: tuple[float, float, float] | None = None
            best_v = cur
            for v in sorted(set(grid) | {cur}):
                trial = copy.deepcopy(cfg)
                set_path(trial, path, v)
                ev = evaluate(sets, trial)
                if ev["negativeRejection"] < target_neg:
                    continue
                key = (ev["positiveAcceptance"], -abs(v - start), -abs(v - cur))
                if best is None or key > best:
                    best, best_v = key, v
            if best_v != cur:
                set_path(cfg, path, best_v)
                changed = True
                trace.append({"round": rnd + 1, "threshold": ".".join(path), "from": cur, "to": best_v, "positiveAcceptance": best[0] if best else None})
        if not changed:
            break
    return cfg, trace


def run_calibration(build: Path) -> dict[str, Any]:
    from .pipeline import _write_json
    from .yamlio import dump_yaml

    cfg = filters_config()
    spec = copy.deepcopy(cfg)
    starting = (cfg.get("calibration") or {}).get("startingValues") or {}
    for path, _ in FITTED:
        if ".".join(path) in starting:
            set_path(spec, path, starting[".".join(path)])
    sets = control_sets(build)
    at_spec = evaluate(sets, spec)
    at_committed = evaluate(sets, cfg)
    fitted, trace = fit(sets, spec, spec)
    at_fit = evaluate(sets, fitted)
    report = {
        "controls": {k: len(v) for k, v in sets.items()},
        "mutopiaHymnPhrases": 0,
        "target": cfg["control_calibration"],
        "atStartingValues": at_spec,
        "atCommittedValues": at_committed,
        "atFittedValues": at_fit,
        "fitted": {".".join(p): get_path(fitted, p) for p, _ in FITTED},
        "startingValues": {".".join(p): get_path(spec, p) for p, _ in FITTED},
        "trace": trace,
        "meetsTarget": at_fit["negativeRejection"] >= cfg["control_calibration"]["negative_rejection_min"] and at_fit["positiveAcceptance"] >= cfg["control_calibration"]["positive_acceptance_min"],
        "committedMeetsTarget": at_committed["negativeRejection"] >= cfg["control_calibration"]["negative_rejection_min"] and at_committed["positiveAcceptance"] >= cfg["control_calibration"]["positive_acceptance_min"],
        "controlIds": {k: [i["id"] for i in v] for k, v in sets.items()},
    }
    _write_json(build / "calibration" / "report.json", report)
    (build / "calibration").mkdir(parents=True, exist_ok=True)
    (build / "calibration" / "filters.fitted.yaml").write_text(dump_yaml(fitted), encoding="utf-8")
    return report


__all__ = ["FITTED", "broken_chord_rendering", "control_sets", "evaluate", "fit", "run_calibration"]
