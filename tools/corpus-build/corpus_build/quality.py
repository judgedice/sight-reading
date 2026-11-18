"""Quality and accompaniment-dependence filters, melodic interest and the soft score (job C7, 03 sections 6.8 and 6.9).

Two halves, so the calibration (`calibration.py`) can re-decide thousands of windows under new thresholds without
re-measuring them:

- `measure(content, ...)` computes every number a rule needs from a window's cut content (`window_stage.load_window`).
  It reads no threshold.
- `decide(metrics, ctx, cfg)` applies `config/filters.yaml` to those numbers and returns the first rejection reason (or
  None), the selection flags (`noBreath`, `leapy`, `bass-line`) and the tags.

Definitions 03 leaves open (also in the README):
- notes are tie-merged sounding notes; an interval joins consecutive notes; a leap is 5 semitones or more (02 2.3), a step 1 or 2;
- contour changes count direction reversals between consecutive non-zero intervals (repeated notes do not reverse);
- rhythm-cell entropy is the Shannon entropy of the per-beat cell occurrences (02 2.2 cells; the pickup and tie marker
  cells excluded), divided by log(number of distinct cells), the reading tools/fixtures uses; one distinct cell gives 0;
- the broken-chord test classes each interval as (direction, unison | step | leap of 3 semitones or more), so a figure
  keeps its class pattern when the harmony under it changes, and looks for a pattern of 2, 3 or 4 classes, at least half
  of them leaps, repeated back to back; the share is the fraction of intervals inside such repetitions;
- the melodic-role test compares the part and Vn I over the same source bars, both measured from the normalized parts
  with the same interest formula, so augmentation and the window cut do not bias the comparison.
"""

from __future__ import annotations

import itertools
import math
import re
from fractions import Fraction
from functools import lru_cache
from typing import Any

from .features import _chains, bar_cells, budget_config, levels_config
from .paths import CONFIG_DIR
from .phrase import MODE_SCALES, tonic_pc
from .yamlio import load_yaml

META_CELLS = frozenset({"pickup", "pickup1", "tieBar", "tieBeat"})
LEAP_SEMIS = 5  # 02 2.3: a leap is a 4th or larger
STEP_MAX = 2


@lru_cache(maxsize=1)
def filters_config() -> dict[str, Any]:
    return load_yaml(CONFIG_DIR / "filters.yaml")


def bar_ticks(meter: dict[str, Any]) -> int:
    return int(meter["beats"] * (480 * 4 // meter["beatType"]))


# ---------------------------------------------------------------- building blocks

def notes_of(content: dict[str, Any]) -> list[dict[str, Any]]:
    """Tie-merged sounding notes in window order: tick, dur, midi, alter, measure0 (window measure index of the onset)."""
    return _chains(content["measures"])


def cell_occurrences(content: dict[str, Any]) -> list[str]:
    """One cell id per beat group, in order (02 2.2), the same grouping `features.analyse` uses."""
    meter = content["meter"]
    unit = meter["countUnitTicks"]
    comp = unit == 720
    bt = bar_ticks(meter)
    pickup = content.get("pickupTicks", 0)
    scale = Fraction(720, unit) if comp else Fraction(480, unit)
    out: list[str] = []
    for m in content["measures"]:
        if not m["events"]:
            continue
        base = m["startTick"] - (bt - pickup if m.get("isPickup") else 0)
        out.extend(bar_cells(m["events"], base, unit, scale))
    return out


def contour_changes(mids: list[int]) -> int:
    dirs = [(b > a) - (b < a) for a, b in itertools.pairwise(mids)]
    nz = [d for d in dirs if d]
    return sum(1 for a, b in itertools.pairwise(nz) if a != b)


def repeated_note_ratio(mids: list[int]) -> float:
    return sum(1 for a, b in itertools.pairwise(mids) if a == b) / max(1, len(mids) - 1)


def cell_entropy(cells: list[str]) -> float:
    """Normalised Shannon entropy of the cell occurrences, 0 to 1 (0 with fewer than 2 distinct cells)."""
    cs = [c for c in cells if c not in META_CELLS]
    counts: dict[str, int] = {}
    for c in cs:
        counts[c] = counts.get(c, 0) + 1
    if len(counts) < 2:
        return 0.0
    n = len(cs)
    ent = -sum((v / n) * math.log(v / n) for v in counts.values())
    return ent / math.log(len(counts))


def interest_value(mids: list[int], cells: list[str], weights: dict[str, float] | None = None) -> float:
    """03 6.9: 0.3 contourChanges/notes + 0.3 min(1, distinctPCs/7) + 0.2 entropy/maxEntropy + 0.2 (1 - repeatedNoteRatio)."""
    w = weights or filters_config()["interest"]["weights"]
    if not mids:
        return 0.0
    return (
        w["contour_changes_per_note"] * contour_changes(mids) / len(mids)
        + w["distinct_pcs_over_7"] * min(1.0, len({m % 12 for m in mids}) / 7)
        + w["rhythm_cell_entropy"] * cell_entropy(cells)
        + w["non_repeated_note"] * (1 - repeated_note_ratio(mids))
    )


def interval_class(iv: int) -> int:
    a = abs(iv)
    size = 0 if a == 0 else 1 if a <= STEP_MAX else 2
    return size if iv >= 0 else -size


def broken_chord_share(mids: list[int], pattern_lengths: tuple[int, ...] = (2, 3, 4)) -> float:
    """Largest share of intervals covered by a back-to-back repeated figure of interval classes containing leaps
    (arpeggios, Alberti basses, broken-chord accompaniments). See the module docstring."""
    ivs = [b - a for a, b in itertools.pairwise(mids)]
    if not ivs:
        return 0.0
    cls = [interval_class(v) for v in ivs]
    best = 0.0
    for k in pattern_lengths:
        cov = [False] * len(cls)
        j = 0
        while j + k <= len(cls):
            pat = cls[j : j + k]
            if sum(1 for v in pat if abs(v) >= 2) * 2 < k or all(v == 0 for v in pat):
                j += 1
                continue
            reps = 1
            while j + (reps + 1) * k <= len(cls) and cls[j + reps * k : j + (reps + 1) * k] == pat:
                reps += 1
            if reps >= 2:
                for i in range(j, j + reps * k):
                    cov[i] = True
                j += reps * k
            else:
                j += 1
        best = max(best, sum(cov) / len(cls))
    return best


def pedal_share(mids: list[int]) -> float:
    """03 6.9 pedal alternation: notes with n[i] = n[i-2] != n[i-1], over the note count."""
    if not mids:
        return 0.0
    return sum(1 for i in range(2, len(mids)) if mids[i] == mids[i - 2] != mids[i - 1]) / len(mids)


def fingerprint(notes: list[dict[str, Any]], quant: list[float] | None = None) -> list[str]:
    """03 6.10: per note after the first, (interval in semitones, IOI ratio to the previous note), the ratio quantised to
    the nearest of {1/4, 1/3, 1/2, 2/3, 1, 3/2, 2, 3, 4} on a log scale. A note's IOI runs to the next onset; the last
    note's IOI is its duration. Invariant to transposition and to augmentation. Tokens are 'interval:ratio' strings."""
    q = quant or filters_config()["dedupe"]["ioi_ratio_quantisation"]
    labels = {0.25: "1/4", 1 / 3: "1/3", 0.5: "1/2", 2 / 3: "2/3", 1: "1", 1.5: "3/2", 2: "2", 3: "3", 4: "4"}
    names = []
    for v in q:
        names.append(next((s for k, s in labels.items() if abs(k - v) < 1e-9), f"{v:g}"))
    logs = [math.log(v) for v in q]
    ioi = [b["tick"] - a["tick"] for a, b in itertools.pairwise(notes)] + ([notes[-1]["dur"]] if notes else [])
    out: list[str] = []
    for i in range(1, len(notes)):
        r = math.log(ioi[i] / ioi[i - 1]) if ioi[i] > 0 and ioi[i - 1] > 0 else 0.0
        k = min(range(len(logs)), key=lambda j: (abs(logs[j] - r), j))
        out.append(f"{notes[i]['midi'] - notes[i - 1]['midi']}:{names[k]}")
    return out


# ---------------------------------------------------------------- measurement

def _merged_rests(content: dict[str, Any]) -> list[tuple[int, int]]:
    """(start tick, length) of each run of consecutive rests."""
    out: list[tuple[int, int]] = []
    for e in (e for m in content["measures"] for e in m["events"]):
        if e["kind"] != "rest":
            continue
        if out and out[-1][0] + out[-1][1] == e["tick"]:
            out[-1] = (out[-1][0], out[-1][1] + e["dur"])
        else:
            out.append((e["tick"], e["dur"]))
    return out


def _bar_signature(m: dict[str, Any]) -> tuple[Any, ...]:
    return tuple((e["kind"], e["tick"] - m["startTick"], e["dur"], e.get("midi"), bool(e.get("tieStart"))) for e in m["events"])


def encoding_errors(content: dict[str, Any]) -> list[str]:
    """03 6.9 encoding errors on the cut content: a bar whose events do not fill the meter (pickup and final bar
    excepted), overlapping or gapped events, a tie to a different pitch."""
    meter = content["meter"]
    bt = bar_ticks(meter)
    ms = content["measures"]
    errs: list[str] = []
    full = [m for m in ms if not m.get("isPickup")]
    for m in full[:-1]:
        if sum(e["dur"] for e in m["events"]) != bt:
            errs.append(f"bar {m['index']} lasts {sum(e['dur'] for e in m['events'])} ticks, the meter needs {bt}")
    evs = [e for m in ms for e in m["events"]]
    for a, b in itertools.pairwise(evs):
        if b["tick"] != a["tick"] + a["dur"]:
            errs.append(f"event at {b['tick']} does not follow the one at {a['tick']} (+{a['dur']})")
            break
    for a, b in itertools.pairwise(evs):
        if a["kind"] == "note" and a.get("tieStart"):
            if b["kind"] != "note" or b["midi"] != a["midi"]:
                errs.append(f"tie at {a['tick']} goes to a different pitch")
                break
    return errs


def segment(measures: list[dict[str, Any]], first: int, last: int) -> dict[str, Any] | None:
    """Content-like view of normalized-part measures first..last (full bars, ticks from the first bar), for the
    melodic-role comparison. None if the range is out of the part or the meter changes."""
    if first < 0 or last >= len(measures) or first > last:
        return None
    ms = measures[first : last + 1]
    m0 = ms[0]
    if any((m["beats"], m["beatType"]) != (m0["beats"], m0["beatType"]) for m in ms):
        return None
    from .phrase import make_meter

    out = []
    t = 0
    for i, m in enumerate(ms):
        evs = []
        for e in m["events"]:
            ee = dict(e)
            ee["tick"] = t + e["tick"]
            evs.append(ee)
        out.append({"index": i, "isPickup": False, "startTick": t, "events": evs})
        t += m["lengthTicks"] if m.get("lengthTicks") else m["barTicks"]
    return {"meter": make_meter(m0["beats"], m0["beatType"]), "fifths": m0["fifths"], "mode": "major", "pickupTicks": 0, "measures": out}


def segment_interest(content: dict[str, Any] | None) -> float | None:
    if content is None:
        return None
    ch = notes_of(content)
    if len(ch) < 2:
        return 0.0
    return interest_value([c["midi"] for c in ch], cell_occurrences(content))


def onset_coincidence(part: dict[str, Any] | None, ref: dict[str, Any] | None) -> float | None:
    """Share of the part's note onsets that coincide with a reference-part onset (same bar range, same tick)."""
    if part is None or ref is None:
        return None
    po = [c["tick"] for c in notes_of(part)]
    ro = {c["tick"] for c in notes_of(ref)}
    if not po:
        return None
    return sum(1 for t in po if t in ro) / len(po)


def sounding_at(measures: list[dict[str, Any]], mi: int, tick: int) -> int | None:
    """MIDI pitch of a normalized part sounding at bar-relative tick of measure mi (None for a rest or no data)."""
    if mi < 0 or mi >= len(measures):
        return None
    for e in measures[mi]["events"]:
        if e["tick"] <= tick < e["tick"] + e["dur"]:
            return e.get("midi") if e["kind"] == "note" else None
    return None


def bass_function(cello: list[dict[str, Any]], others: list[list[dict[str, Any]]], first: int, last: int, mids: list[int]) -> dict[str, float | None]:
    """03 6.9 cello bass function: share of downbeats (where the cello sounds) at which it is the lowest sounding pitch,
    and share of intervals that are 4ths or 5ths (5 or 7 semitones, any octave)."""
    hits = n = 0
    for mi in range(first, last + 1):
        c = sounding_at(cello, mi, 0)
        if c is None:
            continue
        n += 1
        if all((o is None) or c <= o for o in (sounding_at(p, mi, 0) for p in others)):
            hits += 1
    ivs = [abs(b - a) for a, b in itertools.pairwise(mids) if b != a]
    ff = sum(1 for v in ivs if v % 12 in (5, 7)) / len(ivs) if ivs else 0.0
    return {"downbeatLowestShare": hits / n if n else None, "fourthFifthShare": ff}


def _tonic_triad(fifths: int, mode: str) -> set[int]:
    t = tonic_pc(fifths, mode)
    scale = (0, 2, 3, 5, 7, 8, 10) if mode == "minor" else MODE_SCALES.get(mode, MODE_SCALES["major"])
    return {t, (t + scale[2]) % 12, (t + scale[4]) % 12}


def soft_components(content: dict[str, Any], rec: dict[str, Any], ch: list[dict[str, Any]], level: int) -> dict[str, float]:
    """02 3.2 soft rules S1 to S5, each 0 to 1 (definitions in the README)."""
    bars = rec.get("bars") or sum(1 for m in content["measures"] if not m.get("isPickup"))
    mode = content.get("modal") or content["mode"]
    # S1 phrase symmetry: a period or a bar count in 4-bar units; 2-bar units half credit
    s1 = 1.0 if rec.get("phraseQuality") == "period" or bars % 4 == 0 else 0.5 if bars % 2 == 0 else 0.0
    # S2 a single climax, not in the first bar (or the pickup)
    mids = [c["midi"] for c in ch]
    hi = max(mids)
    first_full = next((m["index"] for m in content["measures"] if not m.get("isPickup")), 0)
    tops = [c for c in ch if c["midi"] == hi]
    in_bar1 = any(c["measure0"] <= first_full for c in tops)
    s2 = 0.0 if in_bar1 else 1.0 if len(tops) == 1 else 0.5
    # S3 first and last note in the tonic triad
    triad = _tonic_triad(content["fifths"], mode)
    s3 = 0.5 * (mids[0] % 12 in triad) + 0.5 * (mids[-1] % 12 in triad)
    # S4 at least 3 distinct rhythm cells (2 at L1)
    need = 2 if level <= 1 else 3
    distinct = len(set(rec.get("rhythmCells") or []) - META_CELLS)
    s4 = min(1.0, distinct / need)
    # S5 a level-defining event in bars 3 to 7: the bar with the highest rhythm level, the largest interval or a chromatic note
    lo_bar, hi_bar = first_full + 2, first_full + 6
    brl = rec.get("barRhythmLevel") or []
    s5 = 0.0
    if brl and any(lo_bar <= i <= hi_bar and v == max(brl) and v > 1 for i, v in enumerate(brl)):
        s5 = 1.0
    ivs = [(abs(b["midi"] - a["midi"]), b) for a, b in itertools.pairwise(ch)]
    big = max((v for v, _ in ivs), default=0)
    if big >= LEAP_SEMIS and any(v == big and lo_bar <= b["measure0"] <= hi_bar for v, b in ivs):
        s5 = 1.0
    scale_pcs = {(tonic_pc(content["fifths"], "major") + s) % 12 for s in (0, 2, 4, 5, 7, 9, 11)}
    if any(c["midi"] % 12 not in scale_pcs and lo_bar <= c["measure0"] <= hi_bar for c in ch):
        s5 = 1.0
    return {"S1": s1, "S2": s2, "S3": s3, "S4": s4, "S5": s5}


def measure(content: dict[str, Any], rec: dict[str, Any], tempo_texts: list[str] | None = None) -> dict[str, Any]:
    """Every number the 6.9 rules read, for one window. `rec` is the features-stage record (features, rhythmCells,
    featureLevels, barRhythmLevel, phraseQuality, bars); `tempo_texts` are the tempo words in force in the window."""
    meter = content["meter"]
    unit = meter["countUnitTicks"]
    bt = bar_ticks(meter)
    ms = content["measures"]
    full = [m for m in ms if not m.get("isPickup")]
    ch = notes_of(content)
    mids = [c["midi"] for c in ch]
    ivs = [b - a for a, b in itertools.pairwise(mids)]
    cells = cell_occurrences(content)
    level = rec.get("effectiveLevel") or rec.get("level") or 1
    f = rec.get("features") or {}

    rests = _merged_rests(content)
    evs = [e for m in ms for e in m["events"]]
    lead = 0
    for e in evs:
        if e["kind"] != "rest":
            break
        lead += e["dur"]
    sigs = [_bar_signature(m) for m in full]
    run = best = 1 if sigs else 0
    for a, b in itertools.pairwise(sigs):
        run = run + 1 if a == b else 1
        best = max(best, run)
    full_ticks = max(1, len(full) * bt)
    long_ticks = sum(c["dur"] for c in ch if c["dur"] >= bt)
    ioi_change = [b["tick"] - a["tick"] for a, b in itertools.pairwise(ch) if a["midi"] != b["midi"]]
    ioi_rep = [b["tick"] - a["tick"] for a, b in itertools.pairwise(ch) if a["midi"] == b["midi"]]
    rest_ticks = sum(e["dur"] for m in full for e in m["events"] if e["kind"] == "rest")
    m: dict[str, Any] = {
        "notes": len(ch),
        "bars": len(full),
        "restRatio": round(rest_ticks / full_ticks, 4),
        "longestRestBars": round(max((d for _, d in rests), default=0) / bt, 4),
        "leadingRestBeats": round(lead / unit, 4),
        "barRepeatRun": best,
        "repeatedNoteRatio": round(repeated_note_ratio(mids), 4),
        "recit": any(re.search(filters_config()["hard_rejects"]["repetition"]["tempo_text_reject"], t or "") for t in (tempo_texts or [])),
        "distinctPcs": len({x % 12 for x in mids}),
        "distinctCells": len(set(cells) - META_CELLS),
        "brokenChordShare": round(broken_chord_share(mids, tuple(filters_config()["hard_rejects"]["broken_chord"]["pattern_lengths"])), 4),
        "pedalShare": round(pedal_share(mids), 4),
        "contourChangesPerNote": round(contour_changes(mids) / len(mids), 4) if mids else 0.0,
        "stepShare": round(sum(1 for v in ivs if 1 <= abs(v) <= STEP_MAX) / len(ivs), 4) if ivs else 0.0,
        "leapShare": round(sum(1 for v in ivs if abs(v) >= LEAP_SEMIS) / len(ivs), 4) if ivs else 0.0,
        "sustainedShare": round(long_ticks / full_ticks, 4),
        "notesPer8Bars": round(len(ch) * 8 / max(1, len(full)), 4),
        "minPitchChangeIoiTicks": min(ioi_change) if ioi_change else None,
        "minRepeatIoiTicks": min(ioi_rep) if ioi_rep else None,
        "unit": unit,
        "encodingErrors": encoding_errors(content),
        "breathMaxGapBars": rec.get("breathMaxGapBars"),
        "beatsPerBar": bt / unit,
        "interest": round(interest_value(mids, cells), 4) if mids else 0.0,
        "cellEntropy": round(cell_entropy(cells), 4),
        "spanSemis": f.get("spanSemis", (max(mids) - min(mids)) if mids else 0),
        "soft": soft_components(content, rec, ch, level) if len(ch) >= 2 else {"S1": 0.0, "S2": 0.0, "S3": 0.0, "S4": 0.0, "S5": 0.0},
    }
    m["softMean"] = round(sum(m["soft"].values()) / 5, 4)
    return m


# ---------------------------------------------------------------- decision

def level_value(table: dict[str, Any], level: int) -> Any:
    """Read a per-level table keyed L1, L2, ..., with an 'L<k>_plus' key for level k and above."""
    if f"L{level}" in table:
        return table[f"L{level}"]
    plus = sorted((int(k[1:].split("_")[0]), v) for k, v in table.items() if k.endswith("_plus"))
    val = None
    for k, v in plus:
        if level >= k:
            val = v
    return val


def ioi_floor_ms() -> tuple[float, float]:
    floors = budget_config()["ioiFloors"]
    return float(min(floors["pitchChangeMs"].values())), float(min(floors["repeatMs"].values()))


def detector_limit(metrics: dict[str, Any], density_level: int) -> str | None:
    """03 6.9: at the minimum tempo of the window's density level, the shortest pitch-change or same-pitch repeat IOI
    must reach the smallest floor of measurement-budget.json (01 8.3)."""
    bpm = levels_config()[density_level - 1]["tempo"]["minBpm"]
    unit = metrics["unit"]
    pc_floor, rep_floor = ioi_floor_ms()
    ms_per_tick = 60000 / bpm / unit
    a, b = metrics["minPitchChangeIoiTicks"], metrics["minRepeatIoiTicks"]
    if a is not None and a * ms_per_tick < pc_floor - 1e-9:
        return f"shortest pitch change {a * ms_per_tick:.1f} ms at {bpm} bpm is under {pc_floor:g} ms"
    if b is not None and b * ms_per_tick < rep_floor - 1e-9:
        return f"shortest repeat {b * ms_per_tick:.1f} ms at {bpm} bpm is under {rep_floor:g} ms"
    return None


def interest_threshold(ctx: dict[str, Any], cfg: dict[str, Any]) -> float:
    i = cfg["interest"]
    if ctx.get("corpus") == "openscore-quartets" and ctx.get("role") in ("inner", "cello") and ctx["level"] <= 2:
        return float(i["reject_below_quartet_inner_and_cello_L1_L2"])
    return float(i["reject_below"])


def decide(metrics: dict[str, Any], ctx: dict[str, Any], cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    """Apply filters.yaml. ctx: level (the served level, effectiveLevel), corpus, role, densityLevel, and for quartet
    inner and cello parts `vn1Interest`, `partSegmentInterest`, `vn1Coincidence`, and for the cello `bass`.
    Returns {reason, detail, reasons (every failing rule, in rule order), flags, tags}."""
    cfg = cfg or filters_config()
    h = cfg["hard_rejects"]
    lv = int(ctx["level"])
    reasons: list[tuple[str, str]] = []

    def fail(code: str, detail: str) -> None:
        reasons.append((code, detail))

    m = metrics
    r = h["rests"]
    if m["restRatio"] > r["rest_ratio_max"] + 1e-9:
        fail("rest-ratio", f"rests are {m['restRatio']:.0%} of the window (max {r['rest_ratio_max']:.0%})")
    if m["longestRestBars"] >= r["max_rest_bars"] - 1e-9:
        fail("rest-bar", f"a rest of {m['longestRestBars']:g} bars")
    if m["leadingRestBeats"] > r["leading_rest_max_beats"] + 1e-9:
        fail("leading-rest", f"leading rest of {m['leadingRestBeats']:g} beats")
    rep = h["repetition"]
    if m["barRepeatRun"] > rep["literal_bar_repeat_max_in_a_row"]:
        fail("bar-repeated", f"a bar repeated literally {m['barRepeatRun']} times in a row")
    if m["repeatedNoteRatio"] > rep["repeated_note_ratio_max"] + 1e-9:
        fail("repeated-notes", f"repeated-note ratio {m['repeatedNoteRatio']:.2f}")
    if m["recit"]:
        fail("recitative", "tempo text marks a recitative")
    need = level_value(h["pitch_variety_min_distinct_pcs"], lv)
    if m["distinctPcs"] < need:
        fail("pitch-variety", f"{m['distinctPcs']} distinct pitch classes (L{lv} needs {need})")
    rv = h["rhythm_variety"]
    if lv >= rv["min_distinct_cells_from_level"] and m["distinctCells"] < rv["min_distinct_cells"]:
        fail("rhythm-variety", f"{m['distinctCells']} distinct rhythm cells")
    if m["brokenChordShare"] > h["broken_chord"]["interval_share_max"] + 1e-9:
        fail("broken-chord", f"{m['brokenChordShare']:.0%} of the intervals repeat a broken-chord figure")
    if m["pedalShare"] > h["pedal_alternation_share_max"] + 1e-9:
        fail("pedal-alternation", f"{m['pedalShare']:.0%} of the notes alternate with a pedal")
    sc = h["static_contour"]
    if m["contourChangesPerNote"] < sc["contour_changes_per_note_min"] - 1e-9 and m["stepShare"] < sc["step_share_exempt"] - 1e-9:
        fail("static-contour", f"{m['contourChangesPerNote']:.2f} contour changes per note, {m['stepShare']:.0%} steps")
    if m["sustainedShare"] > h["sustained_harmony_share_max"] + 1e-9:
        fail("sustained-harmony", f"{m['sustainedShare']:.0%} of the duration in notes of a bar or longer")
    tags: list[str] = []
    flags: list[str] = []
    is_inner = ctx.get("corpus") == "openscore-quartets" and ctx.get("role") in ("inner", "cello")
    qr = h["quartet_melodic_role"]
    if is_inner and lv >= qr["applies_from_level"]:
        vi, pi, co = ctx.get("vn1Interest"), ctx.get("partSegmentInterest"), ctx.get("vn1Coincidence")
        if vi is None or pi is None:
            fail("melodic-role-unknown", "Vn I is missing in these bars")
        elif vi > pi + 1e-9:
            if co is not None and co >= qr["onset_coincidence_max"] - 1e-9:
                fail("melodic-role-homorhythm", f"Vn I is more interesting ({vi:.2f} > {pi:.2f}) and {co:.0%} of the onsets coincide")
            else:
                fail("melodic-role-subordinate", f"Vn I is more interesting in the same bars ({vi:.2f} > {pi:.2f})")
    if ctx.get("corpus") == "openscore-quartets" and ctx.get("role") == "cello" and ctx.get("bass"):
        cb = h["cello_bass_function"]
        b = ctx["bass"]
        if (b.get("downbeatLowestShare") or 0) > cb["downbeat_lowest_share_min"] + 1e-9 and b["fourthFifthShare"] > cb["fourth_fifth_interval_share_min"] + 1e-9:
            flags.append("bass-line")
            tags.append("bass-line")
            if lv > cb["keep_up_to_level"]:
                fail("bass-line-above-level", f"a bass line at L{lv} (kept only to L{cb['keep_up_to_level']})")
    if m["notesPer8Bars"] < h["fragments_min_notes_per_8_bars"] - 1e-9:
        fail("fragment", f"{m['notesPer8Bars']:.1f} notes per 8 bars")
    dl = detector_limit(m, int(ctx.get("densityLevel") or lv))
    if dl:
        fail("detector-limit", dl)
    if m["encodingErrors"]:
        fail("encoding-error", m["encodingErrors"][0])
    if m["softMean"] < cfg["soft_score"]["keep_if_mean_at_least"] - 1e-9:
        fail("soft-score", f"soft score {m['softMean']:.2f} ({', '.join(f'{k} {v:g}' for k, v in m['soft'].items())})")
    thr = interest_threshold(ctx, cfg)
    if m["interest"] < thr - 1e-9:
        fail("interest", f"interest {m['interest']:.3f} below {thr:g}")
    # flags (selection exclusions, 03 6.9 and 7.2)
    if breath_fails(m, lv):
        flags.append("noBreath")
    lp = cfg["flags"]["leapy"]
    if lv in lp["levels"] and m["leapShare"] > lp["leap_share_max"] + 1e-9:
        flags.append("leapy")
    first = reasons[0] if reasons else (None, None)
    return {
        "reason": first[0],
        "detail": first[1],
        "reasons": [c for c, _ in reasons],
        "flags": sorted(set(flags), key=["noBreath", "leapy", "bass-line"].index),
        "tags": tags,
        "interestThreshold": thr,
    }


def breath_fails(m: dict[str, Any], level: int) -> bool:
    """02 2.4 breath rule (config/levels.json `breath`): at L1 to L4 a rest at least every 4 bars; from L5 at least every
    12 seconds, measured at the level's slowest tempo (the strictest reading, since the runtime tempo is not known at
    build time). A note-length phrase end without a rest is not credited (conservative)."""
    gap = m.get("breathMaxGapBars")
    if gap is None:
        return False
    rule = breath_rule()
    if level <= 4:
        return gap > rule["maxGapBarsUpToLevel4"] + 1e-9
    bpm = levels_config()[level - 1]["tempo"]["minBpm"]
    return gap * m["beatsPerBar"] * 60 / bpm > rule["maxGapSecFromLevel5"] + 1e-9


@lru_cache(maxsize=1)
def breath_rule() -> dict[str, Any]:
    import json

    from .features import REPO

    with open(REPO / "config" / "levels.json", encoding="utf-8") as f:
        return json.load(f)["breath"]


__all__ = [
    "bass_function", "broken_chord_share", "cell_entropy", "cell_occurrences", "contour_changes", "decide", "detector_limit",
    "encoding_errors", "filters_config", "fingerprint", "interest_value", "interval_class", "measure", "notes_of",
    "onset_coincidence", "pedal_share", "repeated_note_ratio", "segment", "segment_interest", "soft_components",
]
