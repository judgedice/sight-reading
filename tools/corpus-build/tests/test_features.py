"""Job C6: difficulty features, level tagger, density, resolution rules and the first histogram (03 6.8, 5.3).

The golden vectors (fixtures/levels/feature-vectors.json) are the contract: this tagger, the fixture tagger in
tools/fixtures/excerpt_lib.py and src/corpus/tagger (TypeScript) must agree on every case.
"""

from __future__ import annotations

import glob
import json
import sys
from pathlib import Path
from typing import Any

import pytest

from corpus_build.feature_stage import resolve
from corpus_build.features import (
    REPO,
    TooFewNotes,
    analyse,
    bar_cells,
    cell_level,
    density_level,
    level_of,
    meter_unit,
    tag_levels,
    tag_window,
)
from corpus_build.histogram import build_histogram, fits, key_name

GOLDEN = json.loads((REPO / "fixtures" / "levels" / "feature-vectors.json").read_text(encoding="utf-8"))["cases"]
STEP = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
DUR = {"w": 1920, "h": 960, "q": 480, "e": 240, "s": 120}


# ---------------------------------------------------------------- golden vectors

@pytest.mark.parametrize("case", GOLDEN, ids=[c["id"] for c in GOLDEN])
def test_golden_vectors(case: dict[str, Any]) -> None:
    fl = tag_levels(case["meter"], case["mode"], case.get("minorForm"), case["rhythmCells"], case["features"])
    assert fl == case["expected"]["featureLevels"]
    level, conf = level_of(fl)
    assert level == case["expected"]["level"]
    assert conf == sum(1 for v in case["expected"]["featureLevels"].values() if v == level)


def test_golden_cases_cover_every_level_and_feature() -> None:
    assert {c["expected"]["level"] for c in GOLDEN} == set(range(1, 11))


def test_agrees_with_the_fixture_tagger_on_every_non_modal_case() -> None:
    sys.path.insert(0, str(REPO / "tools" / "fixtures"))
    try:
        import excerpt_lib  # type: ignore[import-not-found]
    finally:
        sys.path.pop(0)
    n = 0
    for c in GOLDEN:
        if c["mode"] not in ("major", "minor"):
            continue
        theirs = excerpt_lib.tag_levels(c["meter"], c["mode"], c.get("minorForm") or "natural", c["rhythmCells"], c["features"])
        assert theirs == tag_levels(c["meter"], c["mode"], c.get("minorForm"), c["rhythmCells"], c["features"]), c["id"]
        n += 1
    assert n > 20


def test_cell_levels_and_unknown_cells() -> None:
    assert [cell_level(c) for c in ("Q", "EE", "Q.E", "SSSS", "EQE", "E.S", "S-sync", "T", "T5", "other", "nonsense")] == [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10]


def test_density_uses_the_most_permissive_window_class() -> None:
    # 2 notes per beat at 60 bpm is 2 per second: level 1 (cap 2.0). 3 per beat needs level 2 (cap 3.0 at 60 bpm).
    assert density_level(2, 480, 480) == 1
    assert density_level(3, 480, 480) == 2
    # a 64th note (30 ticks) at the slowest tempo is 62.5 ms, under the 70 ms pitch change floor at every level
    assert density_level(1, 30, 480) == 10
    assert density_level(1, 120, 480) == 1


# ---------------------------------------------------------------- synthetic windows

def note(pitch: str, dur: str | int, tick: int, **kw: Any) -> dict[str, Any]:
    step, rest = pitch[0], pitch[1:]
    alter = 0
    while rest and rest[0] in "#b":
        alter += 1 if rest[0] == "#" else -1
        rest = rest[1:]
    octave = int(rest)
    d = dur if isinstance(dur, int) else DUR[dur[0]] * (3 if dur.endswith(".") else 2) // 2
    return {"kind": "note", "tick": tick, "dur": d, "step": step, "alter": alter, "octave": octave, "midi": (octave + 1) * 12 + STEP[step] + alter, **kw}


def rest(dur: int, tick: int) -> dict[str, Any]:
    return {"kind": "rest", "tick": tick, "dur": dur}


def window(bars: list[list[tuple[Any, ...]]], beats: int = 4, beat_type: int = 4, fifths: int = 0, mode: str = "major", modal: str | None = None, pickup: list[tuple[Any, ...]] | None = None) -> dict[str, Any]:
    """bars: lists of (pitch|'r', dur, extras?). Ticks are laid out sequentially."""
    from corpus_build.phrase import make_meter

    meter = make_meter(beats, beat_type)
    bar_len = beats * (480 * 4 // beat_type)
    ms: list[dict[str, Any]] = []
    tick = 0
    pickup_ticks = 0
    for i, b in enumerate(([pickup] if pickup else []) + bars):
        is_pick = bool(pickup) and i == 0
        evs: list[dict[str, Any]] = []
        start = tick
        for tok in b:
            pitch, dur = tok[0], tok[1]
            extra = tok[2] if len(tok) > 2 else {}
            d = dur if isinstance(dur, int) else DUR[dur[0]] * (3 if dur.endswith(".") else 2) // 2
            evs.append(rest(d, tick) if pitch == "r" else note(pitch, d, tick, **extra))
            tick += d
        if is_pick:
            pickup_ticks = tick - start
        ms.append({"index": i, "isPickup": is_pick, "startTick": start, "events": evs, "source": {"index": i, "number": str(i)}})
    assert all(sum(e["dur"] for e in m["events"]) == (pickup_ticks if m["isPickup"] else bar_len) for m in ms), "bars must be full"
    return {"meter": meter, "fifths": fifths, "mode": mode, "modal": modal, "pickupTicks": pickup_ticks, "measures": ms, "bars": len(bars)}


QUARTERS = [("C4", "q"), ("D4", "q"), ("E4", "q"), ("F4", "q")]
HALVES = [("G4", "h"), ("E4", "h")]


def test_level_one_window() -> None:
    w = window([QUARTERS, HALVES, QUARTERS, [("C4", "w")]] * 2)
    t = tag_window(w)
    assert t["rhythmCells"] == ["H", "Q", "W"]
    assert set(t["featureLevels"].values()) == {1}
    assert t["level"] == 1 and t["levelConfidence"] == 9
    assert t["features"]["maxLeapSemis"] == 5 and t["features"]["spanSemis"] == 7
    assert t["minorForm"] is None
    assert t["rangeConcert"] == {"min": 60, "max": 67}
    assert t["extremes"] == {"highId": "e5", "lowId": "e1"}  # first G4 and first C4, ids in window order from 1
    assert t["barRhythmLevel"] == [1] * 8


def test_eighths_raise_rhythm_to_two_and_pickup1_is_a_cell() -> None:
    w = window([[("C4", "e"), ("D4", "e"), ("E4", "q"), ("F4", "h")]] + [QUARTERS] * 7, pickup=[("G3", "q")])
    t = tag_window(w)
    assert t["rhythmCells"] == ["EE", "H", "Q", "pickup1"]
    assert t["featureLevels"]["rhythm"] == 2 and t["level"] == 2
    assert t["barRhythmLevel"][:2] == [2, 2]  # the pickup bar carries pickup1 (level 2); bar 1 carries EE


def test_other_pickup_is_level_three_and_tie_across_bar_is_level_three() -> None:
    w = window(
        [[("C4", "q"), ("D4", "q"), ("E4", "q"), ("F4", "q", {"tieStart": True})], [("F4", "h", {"tieStop": True}), ("E4", "h")]] + [QUARTERS] * 6,
        pickup=[("G3", "e"), ("A3", "e")],
    )
    t = tag_window(w)
    assert "pickup" in t["rhythmCells"] and "tieBar" in t["rhythmCells"] and "pickup1" not in t["rhythmCells"]
    assert t["featureLevels"]["rhythm"] == 3


def test_tie_chains_count_once_and_tie_inside_a_bar_is_tieBeat() -> None:
    w = window([[("C4", "q", {"tieStart": True}), ("C4", "q", {"tieStop": True}), ("E4", "h")]] + [QUARTERS] * 7)
    t = tag_window(w)
    assert "tieBeat" in t["rhythmCells"] and t["featureLevels"]["rhythm"] == 5
    assert t["features"]["noteCount"] == 2 + 7 * 4


def test_tonic_triad_leap_keeps_level_one_other_leaps_do_not() -> None:
    triad = window([[("C4", "q"), ("G4", "q"), ("C5", "h")]] + [QUARTERS] * 7)
    t = tag_window(triad)
    assert t["features"]["maxLeapSemis"] == 12 and t["features"]["tonicTriadLeapsOnly"] is True
    assert t["featureLevels"]["interval"] == 1
    other = window([[("C4", "q"), ("D5", "q"), ("C4", "h")]] + [QUARTERS] * 7)
    t = tag_window(other)
    assert t["features"]["tonicTriadLeapsOnly"] is False and t["featureLevels"]["interval"] > 1


def test_rests_under_a_beat_do_not_break_adjacency_but_a_beat_does() -> None:
    fill = [("C4", "q"), ("D4", "q"), ("E4", "q"), ("D4", "q")]
    short = window([[("C4", "q"), ("r", "e"), ("A4", "e"), ("C4", "h")]] + [fill] * 7)
    assert analyse(short)["features"]["maxLeapSemis"] == 9 and analyse(short)["features"]["leapsPer4BarsMax"] == 2  # C4 to A4 across an eighth rest counts
    long = window([[("C4", "q"), ("r", "q"), ("A4", "q"), ("C4", "q")]] + [fill] * 7)
    assert analyse(long)["features"]["maxLeapSemis"] == 9  # only A4 to C4; C4 to A4 across a whole beat of rest is not adjacent
    assert analyse(long)["features"]["leapsPer4BarsMax"] == 1


def test_minor_form_comes_from_raised_sixth_and_seventh() -> None:
    nat = tag_window(window([[("A3", "q"), ("B3", "q"), ("C4", "q"), ("G3", "q")]] * 8, mode="minor"))
    assert nat["minorForm"] == "natural" and nat["featureLevels"]["mode"] == 2
    harm = tag_window(window([[("A3", "q"), ("B3", "q"), ("C4", "q"), ("G#3", "q")]] * 8, mode="minor"))
    assert harm["minorForm"] == "harmonic" and harm["features"]["minorAlterations"] == 8
    assert harm["features"]["chromaticPer4BarsMax"] == 0 and harm["featureLevels"]["mode"] == 2
    mel = tag_window(window([[("A3", "q"), ("F#4", "q"), ("G#4", "q"), ("A4", "q")]] * 8, mode="minor"))
    assert mel["minorForm"] == "melodic" and mel["featureLevels"]["mode"] == 5


def test_chromatic_notes_per_four_bars_and_double_accidentals() -> None:
    bars = [[("C4", "q"), ("C#4", "q"), ("D4", "q"), ("D#4", "q")]] + [QUARTERS] * 7
    t = tag_window(window(bars))
    assert t["features"]["chromaticPer4BarsMax"] == 2 and t["features"]["accidentalsOutsideKey"] == 2
    assert t["featureLevels"]["chromatic"] == 4
    dbl = window([[("C4", "q"), ("F##4", "q"), ("G4", "h")]] + [QUARTERS] * 7)
    t = tag_window(dbl)
    assert t["features"]["doubleAccidentals"] == 1 and t["featureLevels"]["double"] == 8


def test_modal_window_is_tagged_by_its_modal_list() -> None:
    w = window([[("D4", "q"), ("E4", "q"), ("F4", "q"), ("G4", "q")]] * 8, mode="dorian", modal="dorian", fifths=0)
    t = tag_window(w)
    assert t["featureLevels"]["mode"] == 5
    assert t["minorForm"] is None


def test_dense_windows_get_a_density_level() -> None:
    sixteenths = [[(p, "s") for p in ("C4", "D4", "E4", "F4", "G4", "F4", "E4", "D4", "C4", "D4", "E4", "F4", "G4", "F4", "E4", "D4")]] * 8
    t = tag_window(window(sixteenths))
    assert t["features"]["peakNotesPerBeat"] == 4 and t["rhythmCells"] == ["SSSS"]
    assert t["featureLevels"]["rhythm"] == 4
    assert t["featureLevels"]["density"] == 4  # 4 notes per beat needs the 4.5 cap of level 4 at 66 bpm (4.4 per second)
    assert t["level"] == 4 and t["levelConfidence"] >= 2


def test_compound_meter_counts_dotted_quarter_beats() -> None:
    bar = [("C4", "q."), ("D4", "e"), ("E4", "e"), ("F4", "e")]  # C.Q, C.EEE
    bar = [("C4", 720), ("D4", 240), ("E4", 240), ("F4", 240)]
    t = tag_window(window([bar] * 8, 6, 8))
    assert t["rhythmCells"] == ["C.EEE", "C.Q"]
    assert t["featureLevels"]["meter"] == 4 and t["featureLevels"]["rhythm"] == 4


def test_cells_are_per_metronome_beat_in_2_2_and_3_8() -> None:
    # 2/2: the beat is a half note, so a half note is the 'Q' cell and two quarters are 'EE'
    two_two = window([[("C4", "h"), ("D4", "q"), ("E4", "q")]] * 8, 2, 2)
    assert tag_window(two_two)["rhythmCells"] == ["EE", "Q"]
    # 3/8: the beat is an eighth, so an eighth is 'Q' and a dotted eighth + sixteenth is 'Q.E'-shaped (beat-normalised)
    three_eight = window([[("C4", 240), ("D4", 240), ("E4", 240)]] * 8, 3, 8)
    t = tag_window(three_eight)
    assert t["rhythmCells"] == ["Q"] and t["featureLevels"]["meter"] == 5
    assert meter_unit("3/8") == 240 and meter_unit("2/2") == 960 and meter_unit("6/8") == 720


def test_triplets_and_unknown_groups() -> None:
    tup = lambda: {"tuplet": [3, 2]}
    bar = [("C4", 160, tup()), ("D4", 160, tup()), ("E4", 160, tup()), ("F4", "q"), ("G4", "h")]
    t = tag_window(window([bar] * 8))
    assert "T3E" in t["rhythmCells"] and t["featureLevels"]["rhythm"] == 6
    odd = [("C4", "q"), ("D4", 120), ("E4", 360), ("F4", "q"), ("G4", "q")]  # sixteenth + dotted eighth is not in 02 2.2: 'other', level 10
    t = tag_window(window([odd] * 8))
    assert "other" in t["rhythmCells"] and t["featureLevels"]["rhythm"] == 10


def test_bar_cells_are_exact_fractions_for_scaled_meters() -> None:
    evs = [{"kind": "note", "tick": 0, "dur": 480}, {"kind": "note", "tick": 480, "dur": 480}]
    from fractions import Fraction

    assert bar_cells(evs, 0, 960, Fraction(1, 2)) == ["EE"]


def test_too_few_notes_raise() -> None:
    with pytest.raises(TooFewNotes):
        analyse(window([[("C4", "w")]]))


def test_syncopation_and_rest_ratio() -> None:
    bar = [("r", "e"), ("C4", "q", {}), ("D4", "q"), ("E4", "q"), ("r", "e")]
    t = tag_window(window([bar] * 8))
    assert t["features"]["syncopationIndex"] == 1.0  # every onset is off the beat and crosses the next beat
    assert t["features"]["restRatio"] == 0.25


# ---------------------------------------------------------------- the 24 fixture excerpts

def _doc_to_window(x: dict[str, Any]) -> dict[str, Any]:
    ms = []
    for m in x["measures"]:
        evs = []
        for e in m["events"]:
            d = dict(e)
            if e["kind"] == "note":
                p = e["pitch"]
                d.update(step=p["step"], alter=p["alter"], octave=p["octave"], midi=(p["octave"] + 1) * 12 + STEP[p["step"]] + p["alter"])
            if "tuplet" in e:
                d["tuplet"] = [e["tuplet"]["actual"], e["tuplet"]["normal"]]
            evs.append(d)
        ms.append(dict(m, events=evs))
    return {"meter": x["meter"], "fifths": x["keyConcert"]["fifths"], "mode": x["keyConcert"]["mode"], "modal": x["modal"], "pickupTicks": x["pickupTicks"], "measures": ms}


def _fixture_docs() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for f in sorted(glob.glob(str(REPO / "fixtures" / "corpus" / "shard-*.json"))):
        out.extend(json.loads(Path(f).read_text(encoding="utf-8"))["excerpts"])
    return out


FIXTURES = _fixture_docs()


@pytest.mark.parametrize("doc", FIXTURES, ids=[d["id"] for d in FIXTURES])
def test_reproduces_the_fixture_excerpt_features_and_levels(doc: dict[str, Any]) -> None:
    t = tag_window(_doc_to_window(doc))
    for k in ("features", "featureLevels", "level", "levelConfidence", "extremes", "rangeConcert", "breathMaxGapBars"):
        assert t[k] == doc[k], k
    # PLAN ruling 46: both builders read cells per metronome beat, so the ids agree in every meter, 2/2 and 3/8 included.
    assert t["rhythmCells"] == doc["rhythmCells"]
    assert t["barRhythmLevel"] == doc["barRhythmLevel"]


# ---------------------------------------------------------------- resolution rules

def rec(id: str, level: int, bars: int = 8, **kw: Any) -> dict[str, Any]:
    return {"id": id, "status": "pass", "corpus": "openscore-lieder", "level": level, "bars": bars, **kw}


def test_long_windows_fall_back_to_their_8_bar_window_when_the_level_does_not_allow_them() -> None:
    recs = [
        rec("a@p1-10", 2, 10),  # L2 allows only 8 bars: replaced
        rec("a@p1-8", 2, 8, fallbackFor="a@p1-10"),
        rec("b@p1-10", 3, 10),  # L3 allows 10: kept
        rec("b@p1-8", 3, 8, fallbackFor="b@p1-10"),
        rec("c@p1-12", 5, 12),  # L5 allows up to 10: replaced
        rec("c@p1-8", 5, 8, fallbackFor="c@p1-12"),
    ]
    resolve(recs)
    status = {r["id"]: (r["status"], r.get("reason")) for r in recs}
    assert status["a@p1-10"] == ("reject", "bars-exceed-level") and status["a@p1-8"][0] == "pass"
    assert status["b@p1-10"][0] == "pass" and status["b@p1-8"] == ("reject", "fallback-unused")
    assert status["c@p1-12"] == ("reject", "bars-exceed-level") and status["c@p1-8"][0] == "pass"
    assert recs[1]["replaces"] == "a@p1-10"


def test_variants_are_kept_only_at_levels_one_to_three() -> None:
    recs = [rec("a-aug2", 3, requiresLevelMax=3), rec("b-aug2", 4, requiresLevelMax=3), rec("c", 4)]
    resolve(recs)
    assert [r["status"] for r in recs] == ["pass", "reject", "pass"]
    assert recs[1]["reason"] == "aug-level-above-3"


# ---------------------------------------------------------------- histogram and fit

def test_fit_closed_form() -> None:
    # concert range 60..72 in C major on a Bb trumpet (chromatic 2), band 60..72: shift t must satisfy 60-2-60 <= t <= 72-2-72
    assert fits(60, 72, (60, 72), 2, 0, 0) is False  # span 12 needs t in [-2, -2]; p for C->C is 0, -2 mod 12 = 10: no
    assert fits(60, 72, (60, 72), 2, 0, 10) is True  # concert tonic Bb: shift -2
    assert fits(60, 74, (60, 72), 0, 0, 0) is False  # span 14 > band 12
    assert key_name(-1, "major") == "F" and key_name(0, "minor") == "Am" and key_name(3, "major") == "A"


def test_histogram_counts_and_fit_on_synthetic_records() -> None:
    def kept(id: str, level: int, lo: int, hi: int, corpus: str = "openscore-lieder", mode: str = "major") -> dict[str, Any]:
        fl = {k: 1 for k in ("meter", "rhythm", "interval", "leaps", "span", "mode", "chromatic", "double", "density")}
        fl["rhythm"] = level
        return {"id": id, "status": "pass", "corpus": corpus, "level": level, "effectiveLevel": level, "meter": "4/4", "mode": mode, "fifths": 0, "rangeConcert": {"min": lo, "max": hi},
                "featureLevels": fl, "rhythmCells": ["Q"], "tagged": True}

    recs = [kept("a", 1, 62, 70), kept("b", 1, 60, 72, "openscore-quartets"), kept("c", 2, 64, 72), kept("d-aug2", 1, 62, 70)]
    h = build_histogram(recs)
    assert h["byLevel"]["1"] == 3 and h["byLevel"]["2"] == 1 and h["windowsKept"] == 4
    assert h["byLevelVariantsOnly"]["1"] == 1 and h["byLevelOriginalsOnly"]["1"] == 2
    assert h["byLevelAndSource"]["1"] == {"openscore-lieder": 2, "openscore-quartets": 1}
    assert h["bindingFeatureByLevel"]["2"]["rhythm"] == 1
    flute_l1 = h["fit"]["flute"]["levels"]["1"]
    assert flute_l1["band"] == [65, 77] and set(flute_l1["keys"]) == {"F", "C", "G"}  # L1: major keys with at most one accidental
    # 62..70 needs a shift of +3..+7: only F (+5) and G (+7) fit, C (0 or 12) does not. 60..72 needs exactly +5: F only.
    assert flute_l1["keys"] == {"C": 0, "F": 3, "G": 2}


# ---------------------------------------------------------------- on the real build (skipped when it is absent)

BUILD = Path(__file__).resolve().parent.parent / "build"


@pytest.mark.skipif(not (BUILD / "features" / "candidates.jsonl").exists(), reason="run `python -m corpus_build features` first")
def test_real_build_invariants() -> None:
    from corpus_build.candidate import read_jsonl

    recs = read_jsonl(BUILD / "features" / "candidates.jsonl")
    kept = [r for r in recs if r["status"] == "pass"]
    assert kept and all(r["level"] == max(r["featureLevels"].values()) for r in kept)
    assert all(r["levelConfidence"] == sum(1 for v in r["featureLevels"].values() if v == r["level"]) for r in kept)
    assert all(r["effectiveLevel"] >= r["level"] for r in kept)
    assert all(("minorForm" in r) == (r["mode"] == "minor") for r in kept)
    assert all(r["level"] <= 3 for r in kept if r["id"].endswith("-aug2"))
    bars = {lv["level"]: lv["bars"] for lv in json.loads((REPO / "config" / "levels.json").read_text(encoding="utf-8"))["levels"]}
    assert all(r["bars"] in bars[r["level"]] for r in kept if not r["id"].endswith("-aug2"))
    # a primary and its fallback are never both kept
    ids = {r["id"] for r in kept}
    assert not any(r.get("fallbackFor") in ids for r in kept if r.get("fallbackFor"))
    hist = json.loads((BUILD / "histogram.json").read_text(encoding="utf-8"))
    assert sum(hist["byLevel"].values()) == len(kept) == hist["windowsKept"]
    for lv, row in hist["byLevelAndSource"].items():
        assert sum(row.values()) == hist["byLevel"][lv]
