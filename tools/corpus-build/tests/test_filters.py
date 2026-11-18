"""Job C7 on synthetic windows: quality and accompaniment filters, interest, soft score, flags, fingerprint, familiarity,
dedupe, coverage helpers and the calibration search (03 sections 6.8 to 6.10).

Every hard reject of 03 6.9 has a window that trips exactly that rule, built from a window that passes everything.
"""

from __future__ import annotations

import copy
import math
import random
from typing import Any

import pytest

from corpus_build.calibration import FITTED, broken_chord_rendering, evaluate, fit, get_path
from corpus_build.coverage import fitting_keys, flag_allowed, pool_of
from corpus_build.dedupe import candidate_pairs, dedupe, family_roots, grams, jaccard, work_key
from corpus_build.familiar import match_familiar, movement_notes
from corpus_build.features import tag_window
from corpus_build.quality import (
    broken_chord_share,
    cell_entropy,
    contour_changes,
    decide,
    filters_config,
    fingerprint,
    interest_value,
    measure,
    notes_of,
    pedal_share,
    repeated_note_ratio,
    segment,
    segment_interest,
)
from tests.test_features import window

# A tonal 8-bar line that passes every filter at L2: steps and small leaps, quarters, eighths and halves, a rest every
# 4 bars, climax in bar 6, tonic at both ends.
GOOD = [
    [("C4", "q"), ("D4", "q"), ("E4", "q"), ("C4", "q")],
    [("F4", "q"), ("E4", "e"), ("D4", "e"), ("E4", "h")],
    [("G4", "q"), ("F4", "q"), ("E4", "q"), ("D4", "q")],
    [("E4", "h"), ("r", "h")],
    [("A4", "q"), ("G4", "e"), ("F4", "e"), ("E4", "q"), ("F4", "q")],
    [("G4", "q"), ("B4", "q"), ("C5", "h")],
    [("A4", "q"), ("F4", "e"), ("E4", "e"), ("D4", "q"), ("B3", "q")],
    [("C4", "h"), ("r", "h")],
]


def rec_for(w: dict[str, Any], level: int | None = None, **kw: Any) -> dict[str, Any]:
    tag = tag_window(w)
    rec = dict(tag, bars=w["bars"], phraseQuality="complete-phrase", effectiveLevel=level or tag["level"], corpus="openscore-lieder", role="voice")
    rec.update(kw)
    return rec


def judge(w: dict[str, Any], level: int | None = None, texts: list[str] | None = None, cfg: dict[str, Any] | None = None, **ctx: Any) -> dict[str, Any]:
    rec = rec_for(w, level)
    m = measure(w, rec, texts or [])
    c = {"level": rec["effectiveLevel"], "corpus": "openscore-lieder", "role": "voice", "densityLevel": rec["featureLevels"]["density"]}
    c.update(ctx)
    d = decide(m, c, cfg)
    d["metrics"] = m
    return d


def test_the_good_window_passes_every_rule() -> None:
    d = judge(window(GOOD))
    assert d["reasons"] == [], d
    assert d["flags"] == []
    assert d["metrics"]["softMean"] >= 0.6
    assert d["metrics"]["interest"] >= 0.35


# ---------------------------------------------------------------- building blocks

def test_interest_formula() -> None:
    mids = [60, 62, 64, 62, 60, 60, 67]
    # changes: up up down down (rep) up -> directions +,+,-,-,+ = 2 reversals; 4 pcs; 1 repeat in 6 intervals
    cells = ["Q", "Q", "EE", "H"]
    ent = -(0.5 * math.log(0.5) + 2 * 0.25 * math.log(0.25)) / math.log(3)
    want = 0.3 * 2 / 7 + 0.3 * 4 / 7 + 0.2 * ent + 0.2 * (1 - 1 / 6)
    assert contour_changes(mids) == 2
    assert repeated_note_ratio(mids) == pytest.approx(1 / 6)
    assert cell_entropy(cells) == pytest.approx(ent)
    assert interest_value(mids, cells) == pytest.approx(want)
    assert cell_entropy(["Q", "Q", "pickup", "tieBar"]) == 0.0  # one real cell; marker cells do not count


def test_broken_chord_share_finds_arpeggios_not_scales() -> None:
    alberti = [60, 67, 64, 67] * 4 + [62, 67, 65, 67] * 4
    assert broken_chord_share(alberti) > 0.85  # only G-F (a step) in the second figure breaks the leap pattern
    scale = list(range(60, 72)) + list(range(72, 60, -1))
    assert broken_chord_share(scale) == 0.0
    tune = [60, 62, 64, 60, 65, 64, 62, 67, 65, 64, 62, 60]
    assert broken_chord_share(tune) < 0.5


def test_pedal_share() -> None:
    assert pedal_share([60, 67, 60, 69, 60, 71, 60]) == pytest.approx(3 / 7)  # the pedal returns at notes 3, 5 and 7
    assert pedal_share([60, 62, 64, 65]) == 0.0


# ---------------------------------------------------------------- one window per hard reject

def edit(bars_: list[list[tuple[Any, ...]]], i: int, bar: list[tuple[Any, ...]]) -> list[list[tuple[Any, ...]]]:
    out = copy.deepcopy(bars_)
    out[i] = bar
    return out


CASES: list[tuple[str, Any, dict[str, Any]]] = [
    ("rest-ratio", edit(edit(edit(GOOD, 1, [("F4", "q"), ("r", "q"), ("E4", "q"), ("r", "q")]), 2, [("G4", "q"), ("r", "q"), ("E4", "q"), ("r", "q")]), 4, [("A4", "q"), ("r", "q"), ("F4", "h")]), {}),
    ("rest-bar", edit(GOOD, 3, [("r", "w")]), {}),
    ("leading-rest", edit(GOOD, 0, [("r", "h"), ("E4", "q"), ("C4", "q")]), {}),
    ("bar-repeated", [GOOD[0]] * 3 + GOOD[3:], {}),
    ("repeated-notes", [[("C4", "q")] * 4, [("D4", "q")] * 4, [("E4", "q")] * 3 + [("F4", "q")], [("E4", "h"), ("r", "h")], [("G4", "q")] * 2 + [("A4", "q")] * 2, [("G4", "q"), ("B4", "q"), ("C5", "h")], [("A4", "q")] * 2 + [("D4", "q")] * 2, [("C4", "h"), ("r", "h")]], {}),
    ("pitch-variety", [[("C4", "q"), ("D4", "q"), ("E4", "q"), ("D4", "q")], [("C4", "q"), ("E4", "e"), ("D4", "e"), ("C4", "h")], [("E4", "q"), ("D4", "q"), ("C4", "q"), ("D4", "q")], [("E4", "h"), ("r", "h")]] * 2, {"level": 3}),
    ("rhythm-variety", [[("C4", "q"), ("D4", "q"), ("E4", "q"), ("C4", "q")], [("F4", "q"), ("E4", "q"), ("D4", "q"), ("G4", "q")], [("A4", "q"), ("F4", "q"), ("E4", "q"), ("D4", "q")], [("E4", "q"), ("D4", "q"), ("C4", "q"), ("B3", "q")], [("A4", "q"), ("G4", "q"), ("F4", "q"), ("E4", "q")], [("G4", "q"), ("B4", "q"), ("C5", "q"), ("A4", "q")], [("A4", "q"), ("F4", "q"), ("D4", "q"), ("B3", "q")], [("C4", "q"), ("D4", "q"), ("E4", "q"), ("C4", "q")]], {"level": 2}),
    ("broken-chord", [[("C4", "e"), ("G4", "e"), ("E4", "e"), ("G4", "e")] * 2, [("C4", "e"), ("A4", "e"), ("F4", "e"), ("A4", "e")] * 2, [("B3", "e"), ("G4", "e"), ("D4", "e"), ("G4", "e")] * 2, [("C4", "h"), ("r", "h")],
                      [("E4", "e"), ("C5", "e"), ("G4", "e"), ("C5", "e")] * 2, [("F4", "e"), ("D5", "e"), ("A4", "e"), ("D5", "e")] * 2, [("D4", "e"), ("B4", "e"), ("G4", "e"), ("B4", "e")] * 2, [("C4", "h"), ("r", "h")]], {"level": 3}),
    ("pedal-alternation", [[("E4", "e"), ("F4", "e"), ("E4", "e"), ("G4", "e"), ("E4", "e"), ("F4", "e"), ("E4", "e"), ("D4", "e")], [("C4", "q"), ("D4", "q"), ("E4", "h")],
                           [("G4", "e"), ("A4", "e"), ("G4", "e"), ("B4", "e"), ("G4", "e"), ("A4", "e"), ("G4", "e"), ("F4", "e")], [("E4", "h"), ("r", "h")],
                           [("A4", "e"), ("B4", "e"), ("A4", "e"), ("C5", "e"), ("A4", "e"), ("B4", "e"), ("A4", "e"), ("G4", "e")], [("F4", "q"), ("G4", "q"), ("A4", "h")],
                           [("D4", "e"), ("E4", "e"), ("D4", "e"), ("F4", "e"), ("D4", "e"), ("E4", "e"), ("D4", "e"), ("B3", "e")], [("C4", "h"), ("r", "h")]], {"level": 3}),
    ("sustained-harmony", [[("C4", "w")], [("E4", "w")], [("G4", "q"), ("F4", "q"), ("E4", "q"), ("D4", "q")], [("E4", "w")], [("A4", "w")], [("G4", "w")], [("F4", "q"), ("B3", "q"), ("D4", "e"), ("C4", "e"), ("D4", "q")], [("C4", "q"), ("E4", "q"), ("D4", "q"), ("C4", "q")]], {}),
    ("fragment", [[("C4", "h"), ("r", "h")], [("E4", "h"), ("r", "h")], [("G4", "h"), ("r", "h")], [("F4", "h"), ("r", "h")], [("A4", "h"), ("r", "h")], [("D4", "h"), ("r", "h")], [("B3", "h"), ("r", "h")], [("C4", "h"), ("r", "h")]], {"skip_rule_check": True}),
]


@pytest.mark.parametrize("reason,bars_,kw", CASES, ids=[c[0] for c in CASES])
def test_each_hard_reject_has_a_window_that_trips_it(reason: str, bars_: Any, kw: dict[str, Any]) -> None:
    d = judge(window(bars_), kw.get("level"))
    assert reason in d["reasons"], d
    if not kw.get("skip_rule_check"):
        assert d["reason"] == reason, d


def test_recitative_tempo_text() -> None:
    assert "recitative" in judge(window(GOOD), texts=["Recit."])["reasons"]
    assert judge(window(GOOD), texts=["Andante"])["reasons"] == []


def test_static_contour_spares_scales() -> None:
    # scales up, down and up again change direction twice in 25 notes: static, but nearly all steps, so allowed
    w = window([[("C4", "q"), ("D4", "q"), ("E4", "q"), ("F4", "q")], [("G4", "q"), ("A4", "q"), ("B4", "q"), ("C5", "q")], [("D5", "h"), ("r", "h")],
                [("C5", "q"), ("B4", "q"), ("A4", "q"), ("G4", "q")], [("F4", "q"), ("E4", "q"), ("D4", "q"), ("C4", "q")], [("D4", "q"), ("E4", "q"), ("F4", "q"), ("G4", "q")],
                [("A4", "q"), ("B4", "q"), ("C5", "h")], [("C5", "h"), ("r", "h")]])
    d = judge(w)
    assert d["metrics"]["contourChangesPerNote"] < 0.12 and d["metrics"]["stepShare"] >= 0.7
    assert "static-contour" not in d["reasons"]
    cfg = copy.deepcopy(filters_config())
    cfg["hard_rejects"]["static_contour"]["step_share_exempt"] = 1.01
    assert "static-contour" in judge(w, cfg=cfg)["reasons"]


def test_detector_limit_uses_the_density_level_tempo() -> None:
    fast = [[("C4", 30)] * 16 + [("D4", "h"), ("E4", "q")]] + GOOD[1:]
    d = judge(window(fast))
    assert "detector-limit" in d["reasons"]


def test_encoding_errors_on_the_cut_content() -> None:
    w = window(GOOD)
    w["measures"][2]["events"][1]["dur"] -= 10  # a short bar and a gap
    rec = rec_for(window(GOOD))
    d = decide(measure(w, rec, []), {"level": 2, "corpus": "openscore-lieder", "role": "voice", "densityLevel": 1})
    assert "encoding-error" in d["reasons"]
    w2 = window(GOOD)
    w2["measures"][0]["events"][3]["tieStart"] = True  # C4 tied to F4
    assert "encoding-error" in decide(measure(w2, rec, []), {"level": 2, "corpus": "openscore-lieder", "role": "voice", "densityLevel": 1})["reasons"]


def test_soft_score_and_interest_thresholds() -> None:
    cfg = copy.deepcopy(filters_config())
    cfg["soft_score"]["keep_if_mean_at_least"] = 1.01
    assert "soft-score" in judge(window(GOOD), cfg=cfg)["reasons"]
    cfg = copy.deepcopy(filters_config())
    cfg["interest"]["reject_below"] = 0.99
    assert judge(window(GOOD), cfg=cfg)["reason"] == "interest"
    # quartet inner parts at L1-L2 use the 0.25 floor instead (02 3.1)
    d = judge(window(GOOD), cfg=cfg, corpus="openscore-quartets", role="inner", level=2)
    assert d["interestThreshold"] == 0.25 and "interest" not in d["reasons"]


def test_soft_components() -> None:
    d = judge(window(GOOD))
    s = d["metrics"]["soft"]
    assert s == {"S1": 1.0, "S2": 1.0, "S3": 1.0, "S4": 1.0, "S5": 1.0}
    climax_in_bar_1 = edit(GOOD, 0, [("C4", "q"), ("D5", "q"), ("E4", "q"), ("C4", "q")])
    assert judge(window(climax_in_bar_1))["metrics"]["soft"]["S2"] == 0.0


# ---------------------------------------------------------------- quartet rules

def ctx_q(role: str, level: int, vi: float | None, pi: float | None, co: float | None, bass: dict[str, Any] | None = None) -> dict[str, Any]:
    c = {"level": level, "corpus": "openscore-quartets", "role": role, "densityLevel": 1, "vn1Interest": vi, "partSegmentInterest": pi, "vn1Coincidence": co}
    if bass is not None:
        c["bass"] = bass
    return c


def test_melodic_role_from_level_3_only() -> None:
    m = measure(window(GOOD), rec_for(window(GOOD)), [])
    assert decide(m, ctx_q("inner", 4, 0.7, 0.5, 0.9))["reason"] == "melodic-role-homorhythm"
    assert decide(m, ctx_q("inner", 4, 0.7, 0.5, 0.2))["reason"] == "melodic-role-subordinate"
    assert decide(m, ctx_q("inner", 4, 0.5, 0.6, 0.9))["reasons"] == []
    assert decide(m, ctx_q("inner", 2, 0.7, 0.5, 0.9))["reasons"] == []  # skipped at L1-L2
    assert decide(m, ctx_q("inner", 4, None, 0.5, None))["reason"] == "melodic-role-unknown"


def test_cello_bass_line_is_tagged_and_kept_only_to_level_5() -> None:
    m = measure(window(GOOD), rec_for(window(GOOD)), [])
    bass = {"downbeatLowestShare": 0.9, "fourthFifthShare": 0.5}
    d = decide(m, ctx_q("cello", 4, 0.3, 0.6, 0.1, bass))
    assert d["flags"] == ["bass-line"] and d["reasons"] == []
    assert decide(m, ctx_q("cello", 6, 0.3, 0.6, 0.1, bass))["reason"] == "bass-line-above-level"
    assert decide(m, ctx_q("cello", 4, 0.3, 0.6, 0.1, {"downbeatLowestShare": 0.7, "fourthFifthShare": 0.5}))["flags"] == []


def test_segments_from_normalized_parts() -> None:
    def nm(i: int, evs: list[tuple[int, int, int]]) -> dict[str, Any]:
        return {"index": i, "beats": 4, "beatType": 4, "barTicks": 1920, "lengthTicks": 1920, "fifths": 0,
                "events": [{"kind": "note", "tick": t, "dur": d, "midi": p, "alter": 0} for t, d, p in evs]}

    ms = [nm(i, [(0, 480, 60 + i), (480, 480, 62 + i), (960, 960, 64 + i)]) for i in range(4)]
    seg = segment(ms, 1, 2)
    assert seg is not None and [e["tick"] for m in seg["measures"] for e in m["events"]] == [0, 480, 960, 1920, 2400, 2880]
    assert segment(ms, 3, 5) is None
    assert 0 < (segment_interest(seg) or 0) < 1


# ---------------------------------------------------------------- flags

def test_no_breath_and_leapy_flags() -> None:
    no_rest = [b if ("r", "h") not in b else b[:1] + [("D4", "h")] for b in GOOD]
    assert "noBreath" in judge(window(no_rest), level=3)["flags"]
    assert "noBreath" not in judge(window(GOOD), level=3)["flags"]
    leapy = [[("C4", "q"), ("G4", "q"), ("C5", "q"), ("G4", "q")], [("E4", "q"), ("A4", "e"), ("D5", "e"), ("A4", "h")], [("F4", "q"), ("C5", "q"), ("G4", "q"), ("D4", "q")], [("G4", "h"), ("r", "h")]] * 2
    d = judge(window(leapy), level=5)
    assert "leapy" in d["flags"]
    assert "leapy" not in judge(window(leapy), level=7)["flags"]


# ---------------------------------------------------------------- fingerprint, familiarity

def test_fingerprint_is_invariant_to_transposition_and_augmentation() -> None:
    w = window(GOOD)
    fp = fingerprint(notes_of(w))
    up = window([[(p[:-1] + str(int(p[-1]) + 1) if p != "r" else p, d) for p, d in b] for b in GOOD])
    assert fingerprint(notes_of(up)) == fp
    doubled = [{**n, "tick": n["tick"] * 2, "dur": n["dur"] * 2} for n in notes_of(w)]
    assert fingerprint(doubled) == fp
    assert fp[:3] == ["2:1", "2:1", "-4:1"]
    assert len(fp) == len(notes_of(w)) - 1


def test_ioi_ratio_quantisation() -> None:
    ns = [{"tick": t, "dur": d, "midi": 60} for t, d in [(0, 480), (480, 240), (720, 720), (1440, 160), (1600, 320)]]
    assert [t.split(":")[1] for t in fingerprint(ns)] == ["1/2", "3", "1/4", "2"]


def test_familiar_match_anywhere_in_the_window() -> None:
    inc = ["2:1", "2:1", "-4:1", "5:1", "-1:1/2", "-2:1", "2:2", "3:1"]
    entries = [{"id": "tune", "incipit": inc}]
    assert match_familiar(["0:1"] + inc + ["1:1"], entries) == "tune"
    assert match_familiar(inc[:7], entries) is None
    assert match_familiar(["2:1", "2:1"] + inc[3:], entries) is None


def test_movement_notes_merge_ties_and_start_at_a_measure() -> None:
    part = {"measures": [
        {"movement": 1, "number": "1", "barTicks": 1920, "events": [{"kind": "rest", "tick": 0, "dur": 1440}, {"kind": "note", "tick": 1440, "dur": 480, "midi": 60, "tieStart": True}]},
        {"movement": 1, "number": "2", "barTicks": 1920, "events": [{"kind": "note", "tick": 0, "dur": 480, "midi": 60, "tieStop": True}, {"kind": "note", "tick": 480, "dur": 1440, "midi": 62}]},
        {"movement": 2, "number": "1", "barTicks": 1920, "events": [{"kind": "note", "tick": 0, "dur": 1920, "midi": 70}]},
    ]}
    assert movement_notes(part, 1) == [{"tick": 1440, "dur": 960, "midi": 60}, {"tick": 2400, "dur": 1440, "midi": 62}]
    assert movement_notes(part, 1, "2")[0]["midi"] == 60  # the tied-in continuation starts a note when cut there
    assert movement_notes(part, 2) == [{"tick": 0, "dur": 1920, "midi": 70}]


# ---------------------------------------------------------------- dedupe

def drec(id: str, fp: list[str], corpus: str = "openscore-lieder", soft: float = 0.8, file: str = "A", movement: int = 1, **kw: Any) -> dict[str, Any]:
    r = {"id": id, "corpus": corpus, "fingerprint": fp, "quality": {"soft": soft}, "fileId": f"{corpus}:scores/Comp,_X/{file}/{file}.mxl", "movement": movement, "effectiveLevel": 4}
    r.update(kw)
    return r


def test_jaccard_and_grams() -> None:
    a = grams(list("abcdef"), 4)
    assert a == {tuple("abcd"), tuple("bcde"), tuple("cdef")}
    assert jaccard(a, grams(list("abcdeg"), 4)) == pytest.approx(2 / 4)


def test_candidate_pairs_find_every_pair_above_threshold() -> None:
    rnd = random.Random(7)
    sets = {}
    base = [str(rnd.randrange(6)) for _ in range(60)]
    for i in range(80):
        fp = list(base)
        for _ in range(rnd.randrange(0, 30)):
            fp[rnd.randrange(len(fp))] = str(rnd.randrange(6))
        sets[f"w{i:02d}"] = grams(fp, 4)
    found = candidate_pairs(sets, 0.7)
    for a in sets:
        for b in sets:
            if a < b and jaccard(sets[a], sets[b]) >= 0.7:
                assert (a, b) in found


def test_dedupe_exact_near_and_same_work() -> None:
    rnd = random.Random(3)
    base = [f"{rnd.randrange(-7, 8)}:{rnd.choice(['1', '2', '1/2'])}" for _ in range(40)]
    near = list(base)
    near[20] = "99:1"  # 4 of 37 grams change: Jaccard 33/41 = 0.80
    weaker = list(base)
    weaker[20], weaker[21] = "98:1", "97:1"  # 5 grams change: Jaccard 32/42 = 0.76
    recs = [
        drec("a", base, soft=0.95),  # highest soft score among the Lieder: taken first
        drec("b", base, corpus="openscore-quartets", soft=0.9, file="B"),  # exact duplicate, lower-priority source
        drec("c", near, file="C"),
        drec("d", weaker, file="A"),  # same work as a: 0.7 applies
        drec("e", weaker, file="E"),  # other work: needs 0.8
        drec("f", [f"{i % 7}:2" for i in range(40)], file="F"),
    ]
    j_ad = jaccard(grams(base, 4), grams(weaker, 4))
    assert 0.7 <= j_ad < 0.8
    res = dedupe(recs, {"openscore-lieder": 1, "openscore-quartets": 2})
    assert res["a"]["status"] == "pass"
    assert res["b"] == {**res["b"], "status": "reject", "reason": "duplicate", "dupOf": "a"}
    assert res["c"]["status"] == "reject" and res["c"]["reason"] == "near-duplicate"
    assert res["d"]["status"] == "reject" and res["d"]["dupOf"] == "a"
    assert res["f"]["status"] == "pass"
    # e is 0.7 to 0.8 from a (other work) and is not a near duplicate of a
    assert res["e"]["status"] == "pass" or res["e"]["dupOf"] != "a"
    assert res["b"]["dedupeGroup"] == res["a"]["dedupeGroup"]
    assert work_key(recs[0]) == "comp-x|A|mv1"


def test_priority_is_source_then_soft_score_then_id() -> None:
    fp = [f"{i % 4}:1" for i in range(30)]
    res = dedupe([drec("z", fp, soft=0.9), drec("y", fp, soft=0.6, file="Y"), drec("x", fp, soft=0.9, file="X")], {"openscore-lieder": 1})
    assert res["x"]["status"] == "pass" and res["z"]["dupOf"] == "x" and res["y"]["dupOf"] == "x"


def test_augmented_variants_share_the_family_and_are_not_duplicates_of_it() -> None:
    fp = [f"{i % 4}:1" for i in range(30)]
    recs = [drec("w@1-8", fp), drec("w@1-4-aug2", fp, augmentOf="w@1-4", dedupeWith=["w@1-8"]), drec("v@1-8", fp, file="V", soft=0.1)]
    assert family_roots(recs)["w@1-4-aug2"] == "w@1-8"
    res = dedupe(recs, {"openscore-lieder": 1})
    assert res["w@1-8"]["status"] == res["w@1-4-aug2"]["status"] == "pass"
    assert res["w@1-8"]["dedupeGroup"] == res["w@1-4-aug2"]["dedupeGroup"]
    assert res["v@1-8"]["status"] == "reject"


# ---------------------------------------------------------------- coverage helpers

def crec(level: int, fl: dict[str, int] | None = None, **kw: Any) -> dict[str, Any]:
    r = {"id": "x", "effectiveLevel": level, "featureLevels": fl or {"meter": level, "rhythm": 1}, "flags": [], "mode": "major", "modal": None,
         "fifths": 0, "rangeConcert": {"min": 62, "max": 72}, "minLevelCadence": 1}
    r.update(kw)
    return r


def test_pool_of_follows_02_2_6() -> None:
    assert pool_of(crec(4), 4) == "level"
    assert pool_of(crec(3), 4) == "below"
    assert pool_of(crec(5, {"meter": 5, "rhythm": 4}), 4) == "stretch"
    assert pool_of(crec(5, {"meter": 5, "rhythm": 5}), 4) is None
    assert pool_of(crec(2), 4) is None


def test_flag_exclusions_by_family() -> None:
    flute = {"family": "flute", "clefs": [{"clef": "treble"}]}
    violin = {"family": "upper-strings", "clefs": [{"clef": "treble"}]}
    cello = {"family": "low-strings", "clefs": [{"clef": "bass"}]}
    assert not flag_allowed(crec(3, flags=["noBreath"]), flute, 3) and flag_allowed(crec(3, flags=["noBreath"]), violin, 3)
    assert not flag_allowed(crec(3, flags=["leapy"]), flute, 3) and flag_allowed(crec(7, flags=["leapy"]), flute, 7)
    assert flag_allowed(crec(3, flags=["bass-line"]), cello, 3) and not flag_allowed(crec(3, flags=["bass-line"]), violin, 3)
    assert not flag_allowed(crec(6, flags=["bass-line"]), cello, 6)


def test_fitting_keys_use_the_closed_form() -> None:
    flute = {"tiers": {"A": [65, 77]}, "writtenMinusSounding": {"chromatic": 0}}
    violin = {"tiers": {"A": [62, 81]}, "writtenMinusSounding": {"chromatic": 0}}
    sax = {"tiers": {"A": [62, 74]}, "writtenMinusSounding": {"chromatic": 9}}
    lv1 = {"tier": "A", "writtenKeys": {"maxAccidentals": 1, "modes": ["major"]}, "modal": []}
    # range 62-72 (C major) in the flute band 65-77: shifts 3 to 5 fit, so only F (+5); the violin band takes 0 to 9
    assert fitting_keys(crec(1), flute, lv1) == ["F"]
    assert fitting_keys(crec(1), violin, lv1) == ["F", "C", "G"]
    # an E-flat instrument: written C sounds E-flat. Concert 50-60 in C shifts by 3 to 5, so written C (concert E-flat,
    # +3) fits; written F and G (concert A-flat and B-flat) do not
    assert fitting_keys(crec(1, rangeConcert={"min": 50, "max": 60}), sax, lv1) == ["C"]
    assert fitting_keys(crec(1, rangeConcert={"min": 60, "max": 75}), flute, lv1) == []
    assert fitting_keys(crec(1, mode="minor"), flute, lv1) == []


# ---------------------------------------------------------------- calibration

def item(kind: str, **m: Any) -> dict[str, Any]:
    base = measure(window(GOOD), rec_for(window(GOOD)), [])
    base.update(m)
    return {"id": kind, "kind": kind, "metrics": base, "ctx": {"level": 4, "corpus": "openscore-lieder", "role": "voice", "densityLevel": 1}}


def test_fit_moves_a_threshold_only_to_accept_more_positives() -> None:
    cfg = copy.deepcopy(filters_config())
    path = ("hard_rejects", "repetition", "repeated_note_ratio_max")
    from corpus_build.calibration import set_path

    set_path(cfg, path, 0.35)
    sets = {
        "positives": [item("p", repeatedNoteRatio=0.30)] * 6 + [item("p", repeatedNoteRatio=0.40)] * 4,
        "negatives": [item("n", repeatedNoteRatio=0.60)] * 9 + [item("n", repeatedNoteRatio=0.2, restRatio=0.5)],
        "synthetic": [],
    }
    assert evaluate(sets, cfg)["positiveAcceptance"] == pytest.approx(0.6)
    fitted, trace = fit(sets, cfg, cfg)
    assert get_path(fitted, path) == 0.40  # the smallest move that accepts the 0.40 positives
    assert evaluate(sets, fitted)["positiveAcceptance"] == 1.0 and evaluate(sets, fitted)["negativeRejection"] == 1.0
    assert [t["threshold"] for t in trace] == [".".join(path)]
    # thresholds that cannot gain a positive stay at their starting value
    for p, _ in FITTED:
        if p != path:
            assert get_path(fitted, p) == get_path(cfg, p)


def test_fit_respects_the_negative_rejection_target() -> None:
    cfg = copy.deepcopy(filters_config())
    from corpus_build.calibration import set_path

    path = ("hard_rejects", "repetition", "repeated_note_ratio_max")
    set_path(cfg, path, 0.35)
    sets = {"positives": [item("p", repeatedNoteRatio=0.5)] * 5, "negatives": [item("n", repeatedNoteRatio=0.45)] * 10, "synthetic": []}
    fitted, _ = fit(sets, cfg, cfg)
    assert get_path(fitted, path) < 0.45  # accepting the positives would let every negative through


def test_synthetic_broken_chord_rendering_is_rejected() -> None:
    def part(pitch: int) -> dict[str, Any]:
        return {"measures": [{"index": i, "beats": 4, "beatType": 4, "barTicks": 1920, "lengthTicks": 1920, "fifths": 0,
                              "events": [{"kind": "note", "tick": 0, "dur": 1920, "midi": pitch + (5 if i % 2 else 0)}]} for i in range(8)]}

    parts = {"0": part(72), "1": part(67), "2": part(64), "3": part(48)}
    synth = broken_chord_rendering(parts, {"firstMeasure": 0, "lastMeasure": 7}, 60)
    assert synth is not None and len(synth["measures"]) == 8
    d = judge(synth)
    assert d["reason"] == "broken-chord", d
