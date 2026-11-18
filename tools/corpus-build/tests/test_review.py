"""Job C8: R1 outliers, the Krumhansl-Schmuckler check, review items, blind controls, the packet export, the verdict
file checks, control scoring and verdict application (03 section 6.12; PLAN rulings 29 and 48).

Synthetic tests need nothing but the repo. The real-build tests at the end need build/dedupe (run the pipeline through
`dedupe`) and skip otherwise.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import jsonschema
import pytest

from corpus_build.paths import SCHEMA_DIR, TOOL_DIR
from corpus_build.review import (
    IngestError,
    apply_review,
    check_verdict_file,
    decisions,
    ingest_packet,
    is_positive,
    review_config,
    review_triggers,
    score_controls,
    verdict_validator,
)
from corpus_build.review_items import (
    ControlError,
    bar_lines,
    content_hash,
    cut_early,
    dur_name,
    key_label,
    pitch_shuffle,
    render_item,
    retag,
    shift_beat,
)
from corpus_build.review_outliers import closely_related, key_check, outlier_flags, r1_decision, robust_z, tail_flags
from tests.test_features import window

CFG = review_config()
BUILD = TOOL_DIR / "build"

# --- R1 -----------------------------------------------------------------------------------------------------------------


def test_robust_z_uses_mad_then_mean_absolute_deviation() -> None:
    z = robust_z([1.0, 2.0, 3.0, 4.0, 100.0])
    assert z is not None and z[2] == 0 and z[4] > 60
    z0 = robust_z([5.0] * 9 + [6.0])  # MAD 0, mean AD 0.1
    assert z0 is not None and z0[-1] == pytest.approx(1 / (1.2533 * 0.1))
    assert robust_z([3.0] * 10) is None


def test_tail_flags_take_two_percent_per_side_and_skip_ties() -> None:
    ids = [f"w{i:03d}" for i in range(100)]
    vals = [float(i) for i in range(100)]
    hit = tail_flags(ids, vals, 2)
    assert sorted(hit) == ["w000", "w001", "w098", "w099"]
    assert hit["w099"][0] == "high" and hit["w000"][0] == "low"
    # fewer than 50 items: no tail at 2%
    assert tail_flags(ids[:49], vals[:49], 2) == {}
    # a tie across the tail boundary flags nothing on that side
    tied = [0.0] * 50 + [float(i) for i in range(1, 47)] + [99.0, 99.0, 99.0, 99.0]
    hit = tail_flags(ids, tied, 2)
    assert not any(side == "high" for side, _ in hit.values())
    # the result does not depend on input order
    rev = tail_flags(ids[::-1], vals[::-1], 2)
    assert rev == tail_flags(ids, vals, 2)


def rec(i: int, level: int = 5, **over: Any) -> dict[str, Any]:
    r = {
        "id": f"w{i:03d}",
        "corpus": "openscore-lieder",
        "role": "voice",
        "effectiveLevel": level,
        "bars": 8,
        "levelConfidence": 2,
        "features": {"noteCount": 40 + i % 7, "peakNotesPerBeat": 2 + i % 3, "restRatio": 0.05 + (i % 5) / 100, "spanSemis": 10 + i % 4, "syncopationIndex": (i % 6) / 50},
        "quality": {"interest": 0.5 + (i % 9) / 100, "interestMargin": 0.2},
    }
    r.update(over)
    return r


def test_outliers_reject_only_windows_flagged_on_two_metrics() -> None:
    recs = [rec(i) for i in range(100)]
    recs[7]["features"].update(noteCount=400, spanSemis=60)  # extreme on notes per bar and span
    recs[8]["features"].update(restRatio=0.9)  # extreme on one metric
    flags = outlier_flags(recs)
    assert {f["metric"] for f in flags["w007"]} >= {"notes_per_bar", "span"}
    assert r1_decision(recs[7], flags["w007"], None)[0] == "outlier"
    assert [f["metric"] for f in flags["w008"]] == ["rest_ratio"]
    assert r1_decision(recs[8], flags["w008"], None)[0] is None
    assert "one-outlier-flag" in review_triggers(recs[8], len(flags["w008"]))
    # per level: a level with fewer than 50 windows flags nothing
    small = [rec(i, level=2) for i in range(40)]
    small[3]["features"].update(noteCount=400, spanSemis=60)
    assert outlier_flags(small)["w003"] == []


def test_level_confidence_one_is_report_only_under_ruling_49() -> None:
    from corpus_build.review_outliers import level_confidence_reported

    from corpus_build.quality import filters_config

    ocfg = filters_config()["outliers"]
    assert ocfg["level_confidence_1_report_only"] is True
    assert r1_decision(rec(1, level=7, levelConfidence=1), [], None)[0] is None
    assert level_confidence_reported(rec(1, level=7, levelConfidence=1), ocfg)
    assert not level_confidence_reported(rec(1, level=6, levelConfidence=1), ocfg)
    assert not level_confidence_reported(rec(1, level=7, levelConfidence=2), ocfg)
    strict = {"outliers": {**ocfg, "level_confidence_1_report_only": False}}
    assert r1_decision(rec(1, level=7, levelConfidence=1), [], None, strict)[0] == "level-confidence"
    assert r1_decision(rec(1, level=6, levelConfidence=1), [], None)[0] is None
    assert r1_decision(rec(1, level=7, levelConfidence=2), [], None)[0] is None


C_TUNE = [
    [("C4", "q"), ("D4", "q"), ("E4", "q"), ("C4", "q")],
    [("F4", "q"), ("E4", "q"), ("D4", "h")],
    [("E4", "q"), ("F4", "q"), ("G4", "q"), ("E4", "q")],
    [("D4", "q"), ("B3", "q"), ("C4", "h")],
] * 2


def test_key_profile_agrees_on_the_signature_key_and_rejects_a_foreign_one() -> None:
    k = key_check(window(C_TUNE), CFG["key_profile"])
    assert k is not None and k["agrees"] and k["best"] == [0, "major"]
    # the same tune a major third up (E major) under a C major signature: KS says E major, not closely related
    up = window(C_TUNE)
    for m in up["measures"]:
        for e in m["events"]:
            if e["kind"] == "note":
                e["midi"] += 4
    k2 = key_check(up, CFG["key_profile"])
    assert k2 is not None and k2["best"] == [4, "major"] and not k2["agrees"]
    assert r1_decision(rec(1, level=3), [], k2)[0] == "key-profile"
    assert key_check(window(C_TUNE, modal="dorian", mode="dorian"), CFG["key_profile"]) is None


def test_closely_related_keys() -> None:
    c = (0, "major")
    for k in [(0, "major"), (7, "major"), (5, "major"), (9, "minor"), (4, "minor"), (2, "minor")]:
        assert closely_related(k, c), k
    for k in [(2, "major"), (0, "minor"), (4, "major"), (6, "major")]:
        assert not closely_related(k, c), k
    assert closely_related((7, "major"), (4, "minor"))  # G major and E minor


def test_review_triggers_follow_r2() -> None:
    assert review_triggers(rec(1, level=3), 0) == ["level-1-to-3"]
    assert review_triggers(rec(1, level=5), 0) == []
    assert review_triggers(rec(1, level=5, id="x@1-8-aug2"), 0) == ["augmented-variant"]
    assert review_triggers(rec(1, level=5, corpus="openscore-quartets", role="inner"), 0) == ["quartet-inner-or-cello"]
    assert review_triggers(rec(1, level=5, corpus="openscore-quartets", role="vn1"), 0) == []
    assert review_triggers(rec(1, level=5, quality={"interest": 0.4, "interestMargin": 0.05}), 0) == ["interest-near-threshold"]


# --- items --------------------------------------------------------------------------------------------------------------


def test_content_hash_is_stable_and_follows_the_notes() -> None:
    w = window(C_TUNE)
    h = content_hash(w)
    assert h.startswith("sha256:") and len(h) == 71
    assert content_hash(copy.deepcopy(w)) == h
    w2 = copy.deepcopy(w)
    w2["measures"][0]["events"][0]["midi"] += 1
    assert content_hash(w2) != h
    w3 = copy.deepcopy(w)
    w3["measures"][0]["events"][0]["dynamic"] = "pp"  # not musical content the reviewer judges
    assert content_hash(w3) == h


def test_readable_names() -> None:
    assert [dur_name(t) for t in (1920, 1440, 720, 480, 240, 160, 120)] == ["whole", "dotted half", "dotted quarter", "quarter", "eighth", "triplet eighth", "sixteenth"]
    assert dur_name(600) == "5/4 quarters"
    assert key_label(-2, "major") == "Bb major (2 flats)"
    assert key_label(1, "minor") == "E minor (1 sharp)"
    assert key_label(0, "dorian") == "D dorian (no sharps or flats)"


def test_render_item_is_reviewable_alone() -> None:
    w = window(C_TUNE, pickup=[("G3", "q")], fifths=0)
    w["measures"][2]["events"][-1]["tieStart"] = True
    w["tempoAtStart"] = {"text": "Andante", "bpm": None, "measure": "1"}
    meta = {"corpus": "openscore-quartets", "role": "inner", "roleLabel": "Va", "sourceMeasures": ["0", "8"], "level": 2, "featureLevels": {"rhythm": 2, "meter": 1}, "augmented": True}
    it = render_item("item-03", w, meta)
    jsonschema.validate(it, json.loads((SCHEMA_DIR / "review-packet.schema.json").read_text())["$defs"]["item"])
    assert it["key"] == "C major (no sharps or flats)" and it["meter"] == "4/4" and it["bars"] == 8 and it["pickup"] == "1 beat(s)"
    assert it["tempo"] == {"marking": "Andante", "markingBpm": None, "servedBpm": {"minBpm": 60, "maxBpm": 84}}
    assert it["taggedLevel"] == 2 and list(it["featureLevels"]) == ["meter", "rhythm"]
    assert it["source"] == {"collection": "OpenScore String Quartets", "part": "Viola", "measures": "0-8", "noteValuesDoubled": True}
    assert it["range"] == "G3 to G4"
    assert it["notes"][0] == {"bar": "pickup", "notes": "G3 quarter"}
    assert it["notes"][1] == {"bar": 1, "notes": "C4 quarter, D4 quarter, E4 quarter, C4 quarter"}
    assert it["notes"][2]["notes"].endswith("D4 half ~tied to next")
    assert len(bar_lines(w)) == 9


# --- controls -----------------------------------------------------------------------------------------------------------


def part_of(w: dict[str, Any], extra_bars: list[list[dict[str, Any]]] | None = None) -> dict[str, Any]:
    """A normalized part (bar-relative ticks) holding a window's bars, then `extra_bars`."""
    bt = 1920
    ms = []
    bars = [[dict(e, tick=e["tick"] - m["startTick"]) for e in m["events"]] for m in w["measures"]] + (extra_bars or [])
    for i, evs in enumerate(bars):
        ms.append({"index": i, "number": str(i + 1), "movement": 1, "beats": 4, "beatType": 4, "fifths": 0, "problems": [], "lengthTicks": bt, "barTicks": bt, "events": evs})
    return {"measures": ms}


def test_cut_early_moves_the_window_back_a_bar() -> None:
    w = window(C_TUNE)
    part = part_of(window([[("G3", "w")]] + C_TUNE))
    c, measures = cut_early(w, {"firstMeasure": 1, "lastMeasure": 8}, part)
    assert c["bars"] == 8 and measures == ["1", "8"]
    assert bar_lines(c)[0]["notes"] == "G3 whole"
    assert bar_lines(c)[-1]["notes"] == bar_lines(w)[-2]["notes"]  # ends a bar before the cadence
    with pytest.raises(ControlError):
        cut_early(w, {"firstMeasure": 0, "lastMeasure": 7}, part_of(w))


def test_shift_beat_rebars_with_ties() -> None:
    w = window(C_TUNE)
    nxt = [{"kind": "note", "tick": 0, "dur": 960, "midi": 67, "step": "G", "alter": 0, "octave": 4}, {"kind": "rest", "tick": 960, "dur": 960}]
    part = part_of(w, [nxt])
    c, measures = shift_beat(w, {"firstMeasure": 0, "lastMeasure": 7}, part)
    assert c["bars"] == 8 and measures == ["1", "8"]
    lines = [b["notes"] for b in bar_lines(c)]
    assert lines[0] == "D4 quarter, E4 quarter, C4 quarter, F4 quarter"
    assert lines[1] == "E4 quarter, D4 half, E4 quarter"
    assert lines[-1] == "B3 quarter, C4 half, G4 quarter"  # one beat into the next phrase (its half note cut)
    assert all(sum(e["dur"] for e in m["events"]) == 1920 for m in c["measures"])
    with pytest.raises(ControlError):
        shift_beat(w, {"firstMeasure": 0, "lastMeasure": 7}, part_of(w))  # no bar after the window


def test_pitch_shuffle_keeps_rhythm_and_pitches_and_ends_off_the_triad() -> None:
    w = window(C_TUNE)
    s = pitch_shuffle(w, "x")
    durs = lambda c: [(e["tick"], e["dur"], e["kind"]) for m in c["measures"] for e in m["events"]]
    assert durs(s) == durs(w)
    mids = lambda c: sorted(e["midi"] for m in c["measures"] for e in m["events"] if e["kind"] == "note")
    assert mids(s) == mids(w)
    seq = lambda c: [e["midi"] for m in c["measures"] for e in m["events"] if e["kind"] == "note"]
    assert sum(a != b for a, b in zip(seq(s), seq(w))) >= 0.6 * len(seq(w))
    last = [e for m in s["measures"] for e in m["events"] if e["kind"] == "note"][-1]
    assert last["midi"] % 12 not in (0, 4, 7)
    assert pitch_shuffle(w, "x") == s and content_hash(pitch_shuffle(w, "y")) != content_hash(s)
    t = retag(s)
    assert 1 <= t["level"] <= 10 and set(t["featureLevels"]) >= {"rhythm", "interval"}


# --- verdict files, controls, application ---------------------------------------------------------------------------------


def key_doc(n_items: int = 8) -> dict[str, Any]:
    items = {}
    for i in range(1, n_items + 1):
        role = "negative" if i <= 4 else ("positive" if i <= 8 else "item")
        e: dict[str, Any] = {"role": role, "hash": f"sha256:{i:064x}", "windowId": f"w{i}"}
        if role == "negative":
            e["control"] = ["cut-early", "shift-beat", "pitch-shuffle", "accompaniment"][i - 1]
        items[f"item-{i:02d}"] = e
    return {"packetId": "packet-01", "packetHash": "sha256:" + "a" * 64, "promptVersion": CFG["prompt_version"], "items": items}


def answer(item: str, verdict: str, **over: Any) -> dict[str, Any]:
    ok = verdict == "accept"
    v = {"itemId": item, "completePhrase": ok, "conclusiveEnd": ok, "accompanimentLike": False, "idiomaticForWinds": True, "levelPlausible": True, "verdict": verdict, "reasons": [] if ok else ["ends mid-phrase"]}
    v.update(over)
    return v


def verdict_doc(key: dict[str, Any], letter: str, verdicts: dict[str, str]) -> dict[str, Any]:
    return {
        "packetId": key["packetId"],
        "packetHash": key["packetHash"],
        "promptVersion": CFG["prompt_version"],
        "promptVariant": CFG["variants"][letter],
        "model": "test-model",
        "verdicts": [answer(i, verdicts.get(i, "reject" if e["role"] == "negative" else "accept")) for i, e in key["items"].items()],
    }


def test_verdict_file_checks() -> None:
    key = key_doc(10)
    good = verdict_doc(key, "A", {})
    answers, warns = check_verdict_file(good, key, "A", CFG)
    assert len(answers) == 10 and warns == []
    bad = copy.deepcopy(good)
    bad["verdicts"].pop()
    with pytest.raises(IngestError, match="missing"):
        check_verdict_file(bad, key, "A", CFG)
    with pytest.raises(IngestError, match="prompt"):
        check_verdict_file(good, key, "B", CFG)
    stale = dict(good, packetHash="sha256:" + "b" * 64)
    with pytest.raises(IngestError, match="stale"):
        check_verdict_file(stale, key, "A", CFG)
    dup = copy.deepcopy(good)
    dup["verdicts"].append(dup["verdicts"][0])
    with pytest.raises(IngestError, match="twice"):
        check_verdict_file(dup, key, "A", CFG)
    noreason = copy.deepcopy(good)
    noreason["verdicts"][0]["reasons"] = []
    with pytest.raises(IngestError, match="schema"):
        check_verdict_file(noreason, key, "A", CFG)
    incons = copy.deepcopy(good)
    incons["verdicts"][5] = answer("item-06", "accept", conclusiveEnd=False)
    answers, warns = check_verdict_file(incons, key, "A", CFG)
    assert answers["item-06"]["verdict"] == "reject" and len(warns) == 1


def test_control_thresholds() -> None:
    key = key_doc(10)

    def score(over: dict[str, str]) -> dict[str, Any]:
        answers, _ = check_verdict_file(verdict_doc(key, "A", over), key, "A", CFG)
        return score_controls(key, answers, CFG["controls"])

    assert score({})["passed"]
    assert score({"item-05": "reject"})["passed"]  # 3 of 4 positives accepted (75%)
    s = score({"item-05": "reject", "item-06": "reject"})
    assert not s["passed"] and s["positivesAccepted"] == 2
    s = score({"item-01": "accept"})  # one negative accepted: 75% < 90%
    assert not s["passed"] and s["negativesRejected"] == 3


def test_ingest_writes_valid_verdict_lines_and_batches(tmp_path: Path) -> None:
    key = key_doc(10)
    a, b = tmp_path / "a.json", tmp_path / "b.json"
    a.write_text(json.dumps(verdict_doc(key, "A", {"item-10": "reject"})))
    b.write_text(json.dumps(verdict_doc(key, "B", {})))
    lines, batches, warns = ingest_packet(key, {"A": [a], "B": [b]}, CFG)
    assert warns == []
    vv = verdict_validator()
    for line in lines:
        vv.validate(line)
    assert len(lines) == 12  # 6 real items (positives included) x 2 variants; negatives never get a verdict line
    assert {ln["pass"] for ln in lines if ln["promptVariant"] == CFG["variants"]["A"]} == {1}
    assert all(bt["passed"] for bt in batches) and len(batches[0]["contentHashes"]) == 6
    assert batches[0]["controls"]["negativeDetail"][0]["control"] == "cut-early"
    # a failed first attempt and a passing retry: the retry counts, the first attempt is recorded
    fail = tmp_path / "a1.json"
    fail.write_text(json.dumps(verdict_doc(key, "A", {"item-01": "accept"})))
    _, batches2, _ = ingest_packet(key, {"A": [fail, a]}, CFG)
    assert batches2[0]["attempt"] == 2 and batches2[0]["passed"] and not batches2[0]["previousAttempts"][0]["passed"]
    with pytest.raises(IngestError, match="attempts"):
        ingest_packet(key, {"A": [fail, fail, a]}, CFG)


def item_of(r: dict[str, Any], h: str, triggers: list[str], r1: str | None = None) -> dict[str, Any]:
    return {"rec": dict(r, kind="window", parentId="p", status="pass", stage="dedupe", schemaVersion=1), "content": None, "hash": h, "flags": [], "key": None, "r1Reason": r1, "r1Detail": "x" if r1 else None, "triggers": triggers}


def test_apply_review_needs_both_variants_and_passed_controls(tmp_path: Path) -> None:
    key = key_doc(10)
    a, b = tmp_path / "a.json", tmp_path / "b.json"
    a.write_text(json.dumps(verdict_doc(key, "A", {"item-10": "reject"})))
    b.write_text(json.dumps(verdict_doc(key, "B", {})))
    lines, batches, _ = ingest_packet(key, {"A": [a], "B": [b]}, CFG)
    verdicts = {(v["contentHash"], v["promptVersion"], v["promptVariant"]): v for v in lines}
    h = lambda i: f"sha256:{i:064x}"
    items = [
        item_of(rec(9, level=3), h(9), ["level-1-to-3"]),  # accepted by both
        item_of(rec(10, level=3), h(10), ["level-1-to-3"]),  # rejected by A
        item_of(rec(11, level=3), "sha256:" + "c" * 64, ["level-1-to-3"]),  # never reviewed
        item_of(rec(12, level=5), "sha256:" + "d" * 64, ["augmented-variant"]),  # ruling 48
        item_of(rec(13, level=5), "sha256:" + "e" * 64, []),  # ships on rules
        item_of(rec(14, level=2), h(5), ["level-1-to-3"], r1="outlier"),
    ]
    out = {r["id"]: r for r in apply_review(items, CFG, verdicts, batches)}
    assert out["w009"]["status"] == "pass" and out["w009"]["review"]["llm"] == "accepted"
    assert [v["pass"] for v in out["w009"]["review"]["llmVerdicts"]] == [1, 2]
    assert out["w010"]["reason"] == "review-rejected" and "ends mid-phrase" in out["w010"]["detail"]
    assert out["w011"]["reason"] == "review-missing"
    assert out["w012"]["reason"] == "review-not-run"
    assert out["w013"]["status"] == "pass" and out["w013"]["review"] == {"rules": CFG["rules_version"], "llm": "not-required", "llmVerdicts": [], "promptVersion": "none"}
    assert out["w014"]["reason"] == "outlier"
    # the same verdicts from a packet whose controls failed for variant B do not count
    failed = [dict(bt, passed=False) if bt["promptVariant"] == CFG["variants"]["B"] else bt for bt in batches]
    d = decisions([h(9)], CFG, verdicts, failed)[h(9)]
    assert d["status"] == "controls-failed" and d["perVariant"][CFG["variants"]["A"]] == "accept"
    # only one variant reviewed: missing
    only_a = [bt for bt in batches if bt["promptVariant"] == CFG["variants"]["A"]]
    assert decisions([h(9)], CFG, verdicts, only_a)[h(9)]["status"] == "missing"
    # a verdict for another prompt version does not count
    assert decisions([h(9)], dict(CFG, prompt_version="rubric-v2"), verdicts, batches)[h(9)]["status"] == "missing"


def test_positive_rule() -> None:
    p = CFG["positive_rule"]
    good = {"cadenceEnd": "PAC", "phraseQuality": "complete-phrase", "quality": {"soft": 0.9, "interestMargin": 0.2}, "flags": ["leapy"], "familiarity": 0}
    assert is_positive(good, p)
    assert not is_positive(dict(good, cadenceEnd="HC"), p)
    assert not is_positive(dict(good, flags=["bass-line"]), p)
    assert not is_positive(dict(good, familiarity=2), p)
    assert not is_positive(dict(good, quality={"soft": 0.7, "interestMargin": 0.2}), p)


def test_committed_cache_is_valid() -> None:
    vv = verdict_validator()
    for line in (TOOL_DIR / "review" / "verdicts.jsonl").read_text().splitlines():
        if line.strip():
            vv.validate(json.loads(line))
    for line in (TOOL_DIR / "review" / "batches.jsonl").read_text().splitlines():
        if line.strip():
            b = json.loads(line)
            assert {"packetId", "packetHash", "promptVersion", "promptVariant", "contentHashes", "controls", "passed"} <= set(b)


def test_review_md_names_both_variants_and_the_answer_fields() -> None:
    text = (TOOL_DIR / "REVIEW.md").read_text()
    for v in CFG["variants"].values():
        assert v in text
    for field in ("completePhrase", "conclusiveEnd", "accompanimentLike", "idiomaticForWinds", "levelPlausible", "packet-NN.verdict-A.json", "packet-NN.verdict-B.json"):
        assert field in text


# --- the real build -------------------------------------------------------------------------------------------------------

needs_build = pytest.mark.skipif(not (BUILD / "dedupe" / "candidates.jsonl").exists() or not (BUILD / "filters" / "candidates.jsonl").exists(), reason="needs build/dedupe (run the pipeline through dedupe)")


@pytest.fixture(scope="module")
def exported(tmp_path_factory: pytest.TempPathFactory) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any], list[dict[str, Any]]]:
    from corpus_build.review import build_packets, survivors_with_r1

    survivors = survivors_with_r1(BUILD, CFG)
    packets, keys, report = build_packets(BUILD, CFG, survivors, {}, [])
    return packets, keys, report, survivors


@needs_build
def test_export_packets_on_the_real_build(exported: Any) -> None:
    packets, keys, report, survivors = exported
    validator = jsonschema.Draft202012Validator(json.loads((SCHEMA_DIR / "review-packet.schema.json").read_text()))
    queued = {it["hash"] for it in survivors if it["rec"]["effectiveLevel"] <= 3 and not it["r1Reason"]}
    assert report["queued"] == len(queued) > 0
    seen: set[str] = set()
    for p, k in zip(packets, keys):
        validator.validate(p)
        assert 36 <= p["itemCount"] <= 44, p["itemCount"]
        roles = [e["role"] for e in k["items"].values()]
        assert roles.count("negative") == 4 and roles.count("positive") >= 3
        assert sorted(e["control"] for e in k["items"].values() if e["role"] == "negative") == sorted(CFG["packet"]["negatives"])
        assert all(it["taggedLevel"] <= 3 for it in p["items"])  # ruling 48, controls included
        real = [e["hash"] for e in k["items"].values() if e["role"] != "negative"]
        assert not seen & set(real)
        seen |= set(real)
        # nothing in the packet tells a control from a real item, and title and composer are withheld
        text = json.dumps(p)
        for e in k["items"].values():
            assert e["windowId"] not in text and e["hash"] not in text
            comp = e["windowId"].split(":", 1)[1].split("/")[1] if "/" in e["windowId"] else ""
            assert not comp or comp not in text
        assert all(set(it) == set(p["items"][0]) for it in p["items"])
    assert seen == queued
    # one control source window is never used twice
    sources = [e["windowId"] for k in keys for e in k["items"].values() if e["role"] == "negative"]
    assert len(sources) == len(set(sources))


@needs_build
def test_export_is_deterministic(exported: Any) -> None:
    from corpus_build.review import build_packets

    packets, _, _, survivors = exported
    again, _, _ = build_packets(BUILD, CFG, survivors, {}, [])
    assert [p["packetHash"] for p in again] == [p["packetHash"] for p in packets]


@needs_build
def test_review_stage_on_the_real_build_with_an_empty_cache(exported: Any) -> None:
    _, _, _, survivors = exported
    out = apply_review(survivors, CFG, {}, [])
    low = [r for r in out if r["effectiveLevel"] <= 3]
    assert low and all(r["status"] == "reject" for r in low)  # ruling 29: nothing at L1-L3 ships unreviewed
    assert {r["reason"] for r in low} <= {"review-missing", "outlier", "key-profile"}
    kept = [r for r in out if r["status"] == "pass"]
    assert all(r["review"]["llm"] == "not-required" and not r["reviewRequired"] for r in kept)
    assert len(kept) >= 300  # ruling 24 minimum still holds on the rules alone
    assert all(r["contentHash"].startswith("sha256:") for r in out)


@needs_build
def test_round_trip_export_answer_ingest_apply(exported: Any, tmp_path: Path) -> None:
    """Answer every real packet as a perfect reviewer would (negatives rejected, everything else accepted), except one
    packet whose variant B accepts a negative: its items must stay out."""
    from corpus_build.review import run_review_ingest

    packets, keys, _, survivors = exported
    build = tmp_path / "build"
    (build / "review").mkdir(parents=True)
    (build / "review-key").mkdir()
    for p, k in zip(packets, keys):
        (build / "review" / f"{p['packetId']}.json").write_text(json.dumps(p))
        (build / "review-key" / f"{p['packetId']}.key.json").write_text(json.dumps(k))
        for letter in ("A", "B"):
            over = {}
            if p["packetId"] == "packet-02" and letter == "B":
                over = {next(i for i, e in k["items"].items() if e["role"] == "negative"): "accept"}
            (build / "review" / f"{p['packetId']}.verdict-{letter}.json").write_text(json.dumps(verdict_doc(k, letter, over)))
    vpath, bpath = tmp_path / "verdicts.jsonl", tmp_path / "batches.jsonl"
    rep = run_review_ingest(build, vpath, bpath)
    assert rep["packets"]["packet-02"][CFG["variants"]["B"]]["passed"] is False
    assert all(all(v["passed"] for v in per.values()) for pid, per in rep["packets"].items() if pid != "packet-02")
    from corpus_build.review import load_cache

    verdicts, batches = load_cache(vpath, bpath)
    out = apply_review(survivors, CFG, verdicts, batches)
    in_02 = {e["hash"] for k in keys if k["packetId"] == "packet-02" for e in k["items"].values() if e["role"] != "negative"}
    low = [r for r in out if r["effectiveLevel"] <= 3 and not (r["status"] == "reject" and r["reason"] in ("outlier", "key-profile"))]
    assert low
    for r in low:
        if r["contentHash"] in in_02:
            assert r["status"] == "reject" and r["reason"] == "review-controls-failed"
        else:
            assert r["status"] == "pass" and r["review"]["llm"] == "accepted" and len(r["review"]["llmVerdicts"]) == 2
    # a second ingest is idempotent
    first = vpath.read_bytes(), bpath.read_bytes()
    run_review_ingest(build, vpath, bpath)
    assert (vpath.read_bytes(), bpath.read_bytes()) == first
