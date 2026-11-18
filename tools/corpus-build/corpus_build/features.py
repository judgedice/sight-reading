"""Difficulty features, level tagging and density for one window (job C6, 03 section 6.8, 02 sections 2.1 to 2.5).

Pure functions on a window's cut content (`window_stage.load_window`), no I/O except the two read-only configs
(`config/levels.json`, `config/measurement-budget.json`, found relative to the repository root).

- `analyse(content)` -> the 01 `DifficultyFeatures` plus rhythm cells, per-bar rhythm level, extremes, minorForm, range and breath gap.
- `tag_levels(meter, mode, minor_form, cells, features)` -> the nine `featureLevels` (meter, rhythm, interval, leaps, span, mode,
  chromatic, double, density). It reads only the two configs and agrees with every case in fixtures/levels/feature-vectors.json,
  with tools/fixtures/excerpt_lib.py `tag_levels` and with src/corpus/tagger (TypeScript).
- `tag_window(content)` = analyse + tag_levels + level (max) + levelConfidence.

Rhythm cells are taken per metronome beat (02 section 1 conventions): ticks are scaled so one beat is 480 (simple meters) or stays
720 (compound), so a quarter in 2/2 is half a beat and an eighth in 3/8 is a quarter-note cell. A beat group that matches no cell
is `other` (level 10, 02 section 2.2).
"""

from __future__ import annotations

import json
from fractions import Fraction
from functools import lru_cache
from typing import Any

from .paths import TOOL_DIR
from .phrase import MODE_SCALES, count_unit, tonic_pc

REPO = TOOL_DIR.parent.parent
FEATURE_KEYS = ("meter", "rhythm", "interval", "leaps", "span", "mode", "chromatic", "double", "density")
MAJOR_SCALE_PCS = (0, 2, 4, 5, 7, 9, 11)
MINOR_SCALE = (0, 2, 3, 5, 7, 8, 10)


@lru_cache(maxsize=1)
def levels_config() -> list[dict[str, Any]]:
    with open(REPO / "config" / "levels.json", encoding="utf-8") as f:
        return json.load(f)["levels"]


@lru_cache(maxsize=1)
def budget_config() -> dict[str, Any]:
    with open(REPO / "config" / "measurement-budget.json", encoding="utf-8") as f:
        return json.load(f)


def first_level(pred: Any) -> int:
    for lv in levels_config():
        if pred(lv):
            return lv["level"]
    return 10


def cell_level(cell: str) -> int:
    """First level whose rhythmCells list holds the cell; anything unknown is 10 (02 section 2.2, 'any other')."""
    return first_level(lambda lv: cell in lv["rhythmCells"])


def meter_unit(meter: str) -> int:
    beats, bt = (int(x) for x in meter.split("/"))
    return count_unit(beats, bt)


# ---------------------------------------------------------------- level tagger

def density_level(peak_notes_per_beat: float, min_ioi_ticks: int, unit: int) -> int:
    """Lowest level whose slowest tempo keeps the window's peak density under the NPS cap and its shortest pitch change
    above the smallest IOI floor (03 section 6.8; most permissive launch window class, 512)."""
    floors = budget_config()["ioiFloors"]
    smallest = min(floors["pitchChangeMs"]["512"], floors["repeatMs"]["tonguedOrStruck"])
    for lv in levels_config():
        bpm = lv["tempo"]["minBpm"]
        nps = peak_notes_per_beat * bpm / 60
        cap = min(lv["npsCap"]["512"], 1000 / floors["pitchChangeMs"]["512"])
        ioi_ms = min_ioi_ticks / unit * (60000 / bpm)
        if nps <= cap + 1e-9 and ioi_ms >= smallest:
            return lv["level"]
    return 10


def tag_levels(meter: str, mode: str, minor_form: str | None, cells: list[str], f: dict[str, Any]) -> dict[str, int]:
    if mode == "major":
        mode_lv = first_level(lambda lv: "major" in lv["modes"])
    elif mode == "minor":
        form = minor_form or "natural"
        mode_lv = first_level(lambda lv: "minor" in lv["modes"] and form in lv["minorForms"])
    else:
        mode_lv = first_level(lambda lv: mode in lv["modal"])
    return {
        "meter": first_level(lambda lv: meter in lv["meters"]),
        "rhythm": max([1] + [cell_level(c) for c in cells]),
        "interval": first_level(
            lambda lv: lv["maxIntervalSemis"] is None
            or f["maxLeapSemis"] <= lv["maxIntervalSemis"]
            or (f["tonicTriadLeapsOnly"] and lv["largerLeaps"] is not None and f["maxLeapSemis"] <= lv["largerLeaps"]["maxSemis"])
        ),
        "leaps": first_level(lambda lv: lv["maxLeapsPer4Bars"] is None or f["leapsPer4BarsMax"] <= lv["maxLeapsPer4Bars"]),
        "span": first_level(lambda lv: lv["maxSpanSemis"] is None or f["spanSemis"] <= lv["maxSpanSemis"]),
        "mode": mode_lv,
        "chromatic": first_level(lambda lv: lv["chromaticPer4Bars"] is None or f["chromaticPer4BarsMax"] <= lv["chromaticPer4Bars"]),
        "double": first_level(lambda lv: lv["doubleAccidentals"]) if f["doubleAccidentals"] > 0 else 1,
        "density": density_level(f["peakNotesPerBeat"], f["minIoiTicks"], meter_unit(meter)),
    }


def level_of(feature_levels: dict[str, int]) -> tuple[int, int]:
    """(level, levelConfidence): the maximum over the features and the number of features at it (02 section 2.1)."""
    level = max(feature_levels.values())
    return level, sum(1 for v in feature_levels.values() if v == level)


# ---------------------------------------------------------------- rhythm cells

SIMPLE_NOTES = {
    (480,): "Q", (960,): "H", (1440,): "H.", (1920,): "W", (1680,): "H..",
    (720, 240): "Q.E", (240, 240): "EE", (240, 480, 240): "EQE", (120, 120, 120, 120): "SSSS",
    (240, 120, 120): "ESS", (720, 120, 120): "ESS", (120, 120, 240): "SSE", (120, 240, 120): "SES", (360, 120): "E.S", (840, 120): "Q..",
}
SIMPLE_RESTS = {(480,): "Qr", (960,): "Hr", (1440,): "Hr", (1920,): "Wr"}
COMPOUND_NOTES = {
    (720,): "C.Q", (1440,): "C.Q", (2160,): "C.Q", (480, 240): "C.QE", (240, 480): "C.EQ", (240, 240, 240): "C.EEE",
    (360, 120, 240): "C.E.SE", (120,) * 6: "C.SSSSSS", (240, 120, 120, 240): "C.SSSSSS", (240, 240, 120, 120): "C.SSSSSS",
    (120, 120, 240, 240): "C.SSSSSS", (1200, 240): "C.QE", (960, 480): "C.QE",
}


def classify(pat: list[tuple[Fraction, bool]], tup: list[Any], span: Fraction, comp: bool) -> str:
    """One beat group (durations in beat-normalised ticks, with a flag for rests) to a cell id of 02 section 2.2."""
    durs = tuple(d for d, _ in pat)
    rests = tuple(r for _, r in pat)
    if tup:
        actual = {t[0] for t in tup}
        if actual == {5}:
            return "T5"
        if actual == {7}:
            return "T7"
        if actual != {3} and actual != {6}:
            return "other"  # duplets and quadruplets (compound meters) and anything nested are not in the vocabulary
        if actual == {6} or any(d % 80 == 0 and d < 160 for d in durs):
            return "T6S"
        return "T3E" if span <= 480 or all(d <= 160 for d in durs) else "T3Q"
    if any(d < 120 for d in durs):
        return "T"
    if comp:
        if all(rests):
            return "C.Qr."
        return COMPOUND_NOTES.get(durs, "other")
    if all(rests):
        return SIMPLE_RESTS.get(durs) or "Qr"
    if any(rests):
        if any(d == 120 and r for d, r in pat):
            return "S-sync"
        if durs == (240, 240):
            return "rE" if rests[0] else "Er"
        if durs[0] == 240 and rests[0] and len(durs) > 1:
            return "rE"
        if durs[-1] == 240 and rests[-1]:
            return "Er" if len(durs) == 2 else SIMPLE_NOTES.get(durs, "Er")
        return SIMPLE_NOTES.get(durs, "other")
    if durs in SIMPLE_NOTES:
        return SIMPLE_NOTES[durs]
    # a group that starts with whole beats and continues off-beat: split at the last beat boundary
    if durs[0] % 480 == 0:
        return classify(pat[1:], tup, span - durs[0], comp)
    if durs in ((240, 720), (240, 1200), (240, 960, 240)):
        return "EQE"
    return "other"


def bar_cells(events: list[dict[str, Any]], base: int, unit: int, scale: Fraction) -> list[str]:
    """Cells of one bar. `base` is the tick of the bar start (negative for a pickup), `scale` maps ticks to beat-normalised ticks."""
    comp = unit == 720
    items = [(Fraction(e["tick"] - base) * scale, Fraction(e["dur"]) * scale, e["kind"] == "rest", e.get("tuplet")) for e in events]
    beat = Fraction(720 if comp else 480)
    cells: list[str] = []
    i, n = 0, len(items)
    while i < n:
        start = items[i][0]
        gstart = (start // beat) * beat
        gend = gstart + beat
        j = i
        while j < n and items[j][0] < gend:
            end = items[j][0] + items[j][1]
            gend = max(gend, -((-end) // beat) * beat)
            j += 1
        group = items[i:j]
        pat: list[tuple[Fraction, bool]] = []
        if start > gstart:
            pat.append((start - gstart, True))
        pat.extend((d, r) for (_t, d, r, _tu) in group)
        cells.append(classify(pat, [g[3] for g in group if g[3]], gend - gstart, comp))
        i = j
    return cells


# ---------------------------------------------------------------- features

def _chains(measures: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    cur: dict[str, Any] | None = None
    n = 0
    for m in measures:
        for e in m["events"]:
            n += 1
            if e["kind"] != "note":
                continue
            if cur is not None and e.get("tieStop"):
                cur["dur"] += e["dur"]
                cur["measure"] = m["index"]
                cur["tied"] = True
            else:
                cur = {"n": n, "tick": e["tick"], "dur": e["dur"], "midi": e["midi"], "alter": e["alter"], "measure0": m["index"], "measure": m["index"], "tied": False}
                out.append(cur)
            if not e.get("tieStart"):
                cur = None
    return out


def _per4(v: list[int]) -> int:
    if len(v) <= 4:
        return sum(v)
    return max(sum(v[i : i + 4]) for i in range(len(v) - 3))


def _tonic_triad(fifths: int, mode: str) -> set[int]:
    t = tonic_pc(fifths, mode)
    scale = MINOR_SCALE if mode == "minor" else MODE_SCALES.get(mode, MODE_SCALES["major"])
    return {t, (t + scale[2]) % 12, (t + scale[4]) % 12}


def _measure_index(starts: list[int], tick: int) -> int:
    idx = 0
    for i, s in enumerate(starts):
        if s <= tick:
            idx = i
    return idx


class TooFewNotes(ValueError):
    """A window with fewer than two sounding notes has no interval, IOI or density to measure."""


def analyse(w: dict[str, Any]) -> dict[str, Any]:
    """Features of a window's cut content (see `window_stage.load_window`)."""
    meter = w["meter"]
    unit = meter["countUnitTicks"]
    comp = unit == 720
    bt = meter["beats"] * (480 * 4 // meter["beatType"])
    fifths, mode = w["fifths"], w["mode"]
    ms = w["measures"]
    evs = [e for m in ms for e in m["events"]]
    ch = _chains(ms)
    if len(ch) < 2:
        raise TooFewNotes(f"{len(ch)} sounding notes")
    starts = [m["startTick"] for m in ms]
    pickup = w["pickupTicks"]
    total = sum(e["dur"] for e in evs)
    note_count = len(ch)
    scale = Fraction(720, unit) if comp else Fraction(480, unit)

    # rhythm cells, with the pickup and tie cells of 02 section 2.2
    bar_cell_lists: list[list[str]] = []
    for m in ms:
        base = m["startTick"] - (bt - pickup if m["isPickup"] else 0)
        bar_cell_lists.append(bar_cells(m["events"], base, unit, scale) if m["events"] else [])
    extra: set[str] = set()
    bar_extra: dict[int, set[str]] = {}
    tick_event = {e["tick"]: e for e in evs}
    for m in ms:
        for e in m["events"]:
            if e["kind"] == "note" and e.get("tieStart"):
                nxt = tick_event.get(e["tick"] + e["dur"])
                if nxt is None:
                    continue
                nm = next(x["index"] for x in ms if nxt in x["events"])
                cell = "tieBar" if nm != m["index"] else "tieBeat"
                extra.add(cell)
                bar_extra.setdefault(m["index"], set()).add(cell)
    if pickup:
        pm = ms[0]
        pn = [e for e in pm["events"] if e["kind"] == "note"]
        cell = "pickup1" if len(pm["events"]) == 1 and len(pn) == 1 and pickup == unit else "pickup"
        extra.add(cell)
        bar_extra.setdefault(0, set()).add(cell)
    cells = sorted({c for cs in bar_cell_lists for c in cs} | extra)
    bar_rhythm = [max([1] + [cell_level(c) for c in cs] + [cell_level(c) for c in bar_extra.get(m["index"], set())]) for m, cs in zip(ms, bar_cell_lists)]

    # intervals and leaps (rests under one beat do not break adjacency)
    intervals: list[tuple[dict[str, Any], dict[str, Any], int]] = []
    for a, b in zip(ch, ch[1:]):
        if b["tick"] - (a["tick"] + a["dur"]) < unit:
            intervals.append((a, b, abs(b["midi"] - a["midi"])))
    max_leap = max((iv for _, _, iv in intervals), default=0)
    triad = _tonic_triad(fifths, mode)
    big = [(a, b) for a, b, iv in intervals if iv > levels_config()[0]["maxIntervalSemis"]]
    triad_only = bool(big) and all(a["midi"] % 12 in triad and b["midi"] % 12 in triad for a, b in big)
    leaps_by_bar = [0] * len(ms)
    for a, b, iv in intervals:
        if iv >= 5:
            leaps_by_bar[_measure_index(starts, b["tick"])] += 1

    # chromatic notes: pitch classes outside the key signature; the raised 6th and 7th of a minor key are minorAlterations
    major_pcs = {(tonic_pc(fifths, "major") + s) % 12 for s in MAJOR_SCALE_PCS}
    tpc = tonic_pc(fifths, "minor") if mode == "minor" else tonic_pc(fifths, mode)
    raised = {(tpc + 9) % 12, (tpc + 11) % 12} if mode == "minor" else set()
    chrom_by_bar = [0] * len(ms)
    outside: set[int] = set()
    minor_alts = 0
    raised6 = raised7 = False
    for c in ch:
        pc = c["midi"] % 12
        if pc in major_pcs:
            continue
        if pc in raised:
            minor_alts += 1
            if pc == (tpc + 9) % 12:
                raised6 = True
            else:
                raised7 = True
            continue
        outside.add(pc)
        chrom_by_bar[_measure_index(starts, c["tick"])] += 1

    mids = [c["midi"] for c in ch]
    ioi_change: list[int] = []
    ioi_rep: list[int] = []
    for a, b in zip(ch, ch[1:]):
        (ioi_rep if a["midi"] == b["midi"] else ioi_change).append(b["tick"] - a["tick"])
    onsets = [c["tick"] for c in ch]
    peak = 0
    for t in onsets:
        peak = max(peak, sum(1 for u in onsets if t <= u < t + unit))
    sync = 0
    for c in ch:
        rel = (c["tick"] - pickup) % unit
        if rel != 0 and c["tick"] + c["dur"] > c["tick"] + (unit - rel):
            sync += 1
    full_bars = [m for m in ms if not m["isPickup"]]
    rest_ticks = sum(e["dur"] for m in full_bars for e in m["events"] if e["kind"] == "rest")
    window_ticks = max(1, len(full_bars) * bt)
    features = {
        "noteCount": note_count,
        "notesPerBeat": round(note_count / (total / unit), 4),
        "peakNotesPerBeat": peak,
        "shortestDur": min(e["dur"] for e in evs),
        "maxLeapSemis": max_leap,
        "tonicTriadLeapsOnly": triad_only,
        "leapsPer4BarsMax": _per4(leaps_by_bar),
        "chromaticPer4BarsMax": _per4(chrom_by_bar),
        "doubleAccidentals": sum(1 for c in ch if abs(c["alter"]) == 2),
        "spanSemis": max(mids) - min(mids),
        "minIoiTicks": min(ioi_change) if ioi_change else min(ioi_rep),
        "minRepeatIoiTicks": min(ioi_rep) if ioi_rep else None,
        "syncopationIndex": round(sync / note_count, 4),
        "restRatio": round(rest_ticks / window_ticks, 4),
        "accidentalsOutsideKey": len(outside),
        "minorAlterations": minor_alts,
    }
    hi, lo = max(mids), min(mids)
    return {
        "features": features,
        "rhythmCells": cells,
        "barRhythmLevel": bar_rhythm,
        "minorForm": "melodic" if raised6 else ("harmonic" if raised7 else "natural") if mode == "minor" else None,
        "rangeConcert": {"min": lo, "max": hi},
        # event ids are "e<n>" in window order from 1, the scheme of the fixture builder; C9 keeps them when it emits the excerpt
        "extremes": {"highId": f"e{next(c['n'] for c in ch if c['midi'] == hi)}", "lowId": f"e{next(c['n'] for c in ch if c['midi'] == lo)}"},
        "breathMaxGapBars": breath_gap(w),
    }


def breath_gap(w: dict[str, Any]) -> float:
    """Longest stretch of sound without a rest, in bars (02 section 2.4 input), rounded to 0.01."""
    meter = w["meter"]
    bt = meter["beats"] * (480 * 4 // meter["beatType"])
    evs = [e for m in w["measures"] for e in m["events"]]
    end = evs[-1]["tick"] + evs[-1]["dur"]
    spans: list[int] = []
    t = 0
    for e in evs:
        if e["kind"] == "rest":
            spans.append(e["tick"] - t)
            t = e["tick"] + e["dur"]
    spans.append(end - t)
    return round(max(spans) / bt, 2)


def tag_window(w: dict[str, Any]) -> dict[str, Any]:
    """Everything C6 adds to a window: features, rhythmCells, featureLevels, level, levelConfidence and the rest of `analyse`."""
    a = analyse(w)
    m = w["meter"]
    meter = f"{m['beats']}/{m['beatType']}"
    mode = w["modal"] or w["mode"]
    fl = tag_levels(meter, mode, a["minorForm"], a["rhythmCells"], a["features"])
    level, conf = level_of(fl)
    return dict(a, featureLevels=fl, level=level, levelConfidence=conf)


__all__ = ["FEATURE_KEYS", "TooFewNotes", "analyse", "breath_gap", "cell_level", "classify", "density_level", "level_of", "tag_levels", "tag_window"]
