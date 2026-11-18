"""Job C9: the emitter (03 sections 5.2 and 6.13; PLAN rulings 24, 25, 26, 44).

Synthetic tests need nothing but the repo. The real-build tests at the end need build/review/candidates.jsonl (run the
pipeline through `review`) and skip otherwise; they build the whole corpus in memory, so they take a few seconds.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import pytest

from corpus_build.emit import (
    MANIFEST_COLUMNS,
    build_corpus,
    dumps,
    emit_config,
    encode_manifest,
    excerpt_ids,
    hashed_name,
    load_inputs,
    make_events,
    manifest_entry,
    run_emit,
    slur_mark,
    spelling_counts,
    tempo_of,
    cap_levels_by_interest,
    trim_by_interest,
    viability,
)
from corpus_build.emit_checks import check_rules
from corpus_build.features import levels_config
from corpus_build.paths import PUBLIC_CORPUS, TOOL_DIR

LVS = {lv["level"]: lv for lv in levels_config()}
METER44 = {"beats": 4, "beatType": 4, "countUnitTicks": 480, "countsPerBar": 4}


def note(i: int, tick: int, dur: int, step: str = "C", octave: int = 4, **kw: Any) -> dict[str, Any]:
    return {"id": f"e{i}", "kind": "note", "tick": tick, "dur": dur, "pitch": {"step": step, "alter": 0, "octave": octave}, **kw}


def good_doc() -> dict[str, Any]:
    """Eight 4/4 bars of quarter notes C D E F G F E D ... ending on a half note C on beat 1 of bar 8 plus a rest."""
    measures = []
    n = 0
    steps = ["C", "D", "E", "F", "G", "F", "E", "D"]
    for b in range(8):
        evs = []
        if b < 7:
            for k in range(4):
                n += 1
                evs.append(note(n, b * 1920 + k * 480, 480, steps[(b + k) % 8]))
        else:
            n += 1
            evs.append(note(n, b * 1920, 960, "C"))
            n += 1
            evs.append({"id": f"e{n}", "kind": "rest", "tick": b * 1920 + 960, "dur": 960})
        measures.append({"index": b, "isPickup": False, "startTick": b * 1920, "events": evs})
    return {
        "id": "t-doc", "meter": METER44, "pickupTicks": 0, "measures": measures, "level": 1, "modal": None,
        "keyConcert": {"fifths": 0, "mode": "major"}, "featureLevels": {"meter": 1, "rhythm": 1},
    }


# ---------------------------------------------------------------------------------------------------- pieces


def test_slur_marks_flatten_nested_and_adjoining_slurs() -> None:
    assert slur_mark(0, 1, 0) == ("start", 1)
    assert slur_mark(1, 0, 1) == ("stop", 0)
    assert slur_mark(1, 1, 1) == ("continue", 1)   # an adjoining pair
    assert slur_mark(1, 1, 0) == (None, 2)         # a nested slur opens inside the outer one
    assert slur_mark(2, 0, 2) == ("stop", 0)       # both close together
    assert slur_mark(2, 0, 1) == (None, 1)
    assert slur_mark(0, 0, 0) == (None, 0)


def test_make_events_numbers_every_event_and_groups_tuplets() -> None:
    ms = [
        {"index": 0, "isPickup": False, "startTick": 0, "events": [
            {"kind": "note", "tick": 0, "dur": 480, "step": "C", "alter": 0, "octave": 4, "midi": 60, "tieStart": True, "slurStarts": 1, "artic": ["accent", "weird"], "dynamic": "mf"},
            {"kind": "note", "tick": 480, "dur": 320, "step": "D", "alter": 0, "octave": 4, "midi": 62, "tuplet": [3, 2], "tupletStart": True},
            {"kind": "rest", "tick": 800, "dur": 160, "tuplet": [3, 2]},
            {"kind": "note", "tick": 960, "dur": 160, "step": "E", "alter": -1, "octave": 4, "midi": 63, "tuplet": [3, 2], "tupletStop": True, "slurStops": 1},
        ]},
        {"index": 1, "isPickup": False, "startTick": 1920, "events": [
            {"kind": "note", "tick": 1920, "dur": 480, "step": "C", "alter": 0, "octave": 4, "midi": 60, "tieStop": True, "breath": True, "hairpin": "end"},
            {"kind": "rest", "tick": 2400, "dur": 480, "completion": True, "src": [1, 2]},
        ]},
    ]
    out = make_events(ms)
    ids = [e["id"] for m in out for e in m["events"]]
    assert ids == ["e1", "e2", "e3", "e4", "e5", "e6"]
    e = out[0]["events"]
    assert e[0]["tieStart"] is True and e[0]["slur"] == "start" and e[0]["artic"] == ["accent"] and e[0]["dynamic"] == "mf"
    assert e[1]["tuplet"] == {"actual": 3, "normal": 2, "groupId": "t1"} and e[2]["tuplet"]["groupId"] == "t1" and e[3]["tuplet"]["groupId"] == "t1"
    assert e[3]["slur"] == "stop" and e[3]["pitch"] == {"step": "E", "alter": -1, "octave": 4}
    assert out[1]["events"][0]["tieStop"] is True and out[1]["events"][0]["breath"] is True and out[1]["events"][0]["hairpin"] == "end"
    assert set(out[1]["events"][1]) == {"id", "kind", "tick", "dur"}
    assert set(e[2]) == {"id", "kind", "tick", "dur", "tuplet"}


def test_tempo_from_mark_word_and_default() -> None:
    t = emit_config()["tempo"]
    quarter = {"countUnitTicks": 480}
    dotted = {"countUnitTicks": 720}
    assert tempo_of({"tempoAtStart": {"bpm": 100.0, "text": "Allegro"}}, quarter, t) == {"markedBpm": 100, "minBpm": 90, "maxBpm": 110, "marking": "Allegro"}
    assert tempo_of({"tempoAtStart": {"bpm": None, "text": "Sehr langsam, innig"}}, quarter, t) == {"minBpm": 44, "maxBpm": 60, "marking": "Sehr langsam, innig"}
    assert tempo_of({"tempoAtStart": {"bpm": None, "text": "a tempo"}}, quarter, t) == {"minBpm": 60, "maxBpm": 120, "marking": "a tempo"}
    assert tempo_of({}, quarter, t) == {"minBpm": 60, "maxBpm": 120}
    # the tables are in quarter notes; a compound meter counts dotted quarters
    assert tempo_of({"tempoAtStart": {"bpm": 120.0, "text": None}}, dotted, t)["markedBpm"] == 80
    assert tempo_of({}, dotted, t) == {"minBpm": 40, "maxBpm": 80}


def test_spelling_counts_every_note_event() -> None:
    d = good_doc()
    d["measures"][0]["events"][0]["pitch"] = {"step": "B", "alter": -1, "octave": 3}
    sp = spelling_counts(d)
    assert sp["B-1"] == 1 and sum(sp.values()) == 29
    assert all(k[0] in "ABCDEFG" for k in sp)


def test_json_is_byte_stable_and_hash_names_follow_the_bytes() -> None:
    a = dumps({"b": 1, "a": [1, 2], "é": "ü"}, pretty=False)
    assert a == dumps({"é": "ü", "a": [1, 2], "b": 1}, pretty=False) == '{"a":[1,2],"b":1,"é":"ü"}\n'.encode()
    assert dumps({"a": 1}, pretty=True) == b'{\n "a": 1\n}\n'
    n = hashed_name("manifest", a, 10)
    assert n.startswith("manifest.") and n.endswith(".json") and len(n) == len("manifest.") + 10 + 5


def test_ids_are_readable_and_collisions_get_a_suffix() -> None:
    gate = {"f:1": {"path": "scores/Jaëll,_Marie/_/En_ramant/lc6157272.mxl"}}
    base = {"fileId": "f:1", "corpus": "openscore-lieder", "role": "voice", "movement": 1, "sourceMeasures": ["20", "27"], "pickupTicks": 0}
    recs = [dict(base, id="f:1#0@20-27"), dict(base, id="f:1#0@40-47"), dict(base, id="f:1#0@20-27-aug2", pickupTicks=480)]
    ids = excerpt_ids(recs, gate)
    assert ids["f:1#0@20-27"] == "jaell-lc6157272-voice-m20-27"
    assert ids["f:1#0@40-47"] == "jaell-lc6157272-voice-m20-27-2"
    assert ids["f:1#0@20-27-aug2"] == "jaell-lc6157272-voice-mp20-27-aug2"


def test_manifest_round_trips_through_the_column_encoding() -> None:
    d = good_doc()
    d.update(
        level=3, keyConcert={"fifths": 1, "mode": "major"}, modal=None, tempo={"minBpm": 60, "maxBpm": 90}, cadenceEnd="PAC", familiarity=0,
        featureLevels={"meter": 1}, flags=["leapy"], dedupeGroup="fp-1", work="w|1", tags=["lied", "pickup"], rangeConcert={"min": 60, "max": 67},
        features={"minIoiTicks": 480, "minRepeatIoiTicks": None, "peakNotesPerBeat": 1},
        source={"composer": "A B", "work": "W", "movement": "M", "corpus": "openscore-lieder", "license": "CC0-1.0", "originalInstrument": "voice"},
    )
    e = manifest_entry(d, "shard-L03-01")
    assert e["bars"] == 8 and e["pickup"] is False and e["meter"] == "4/4" and e["title"] == "M" and e["originalFamily"] == "voice" and e["rangeConcert"] == [60, 67]
    m = encode_manifest([e], {"servedLevels": [], "fit": {}}, "v")
    assert m["columns"] == MANIFEST_COLUMNS and len(m["rows"][0]) == len(MANIFEST_COLUMNS)
    row = dict(zip(m["columns"], m["rows"][0]))
    assert m["dict"]["composer"][row["composer"]] == "A B" and [m["dict"]["tags"][i] for i in row["tags"]] == ["lied", "pickup"]
    assert row["minRepeatIoiTicks"] is None and row["spelling"] == e["spelling"]


def test_trim_removes_the_same_share_from_every_level_lowest_interest_first() -> None:
    docs = [{"id": f"l{lv}-{i:02d}", "level": lv, "quality": {"interest": i / 100}} for lv in (3, 4) for i in range(20)]
    docs += [{"id": "l5-00", "level": 5, "quality": {"interest": 0.5}}]
    out = trim_by_interest(docs, 0.5)
    by: dict[int, list[str]] = {}
    for d in out:
        by.setdefault(d["level"], []).append(d["id"])
    assert len(by[3]) == len(by[4]) == 10 and len(by[5]) == 1
    assert all(int(i.split("-")[1]) >= 10 for i in by[3])


# ---------------------------------------------------------------------------------------------------- H-rules


def test_rules_accept_a_good_document() -> None:
    assert check_rules(good_doc(), LVS) == []


def test_rules_reject_a_bar_that_does_not_tile() -> None:
    d = good_doc()
    d["measures"][2]["events"][3]["dur"] = 240
    assert any("bar 2 sums" in p or "does not tile" in p for p in check_rules(d, LVS))


def test_rules_reject_a_wrong_bar_count_for_the_level() -> None:
    d = good_doc()
    d["measures"].pop(0)
    for k, m in enumerate(d["measures"]):
        m["index"] = k
        m["startTick"] -= 1920
        for e in m["events"]:
            e["tick"] -= 1920
    assert any("(H3)" in p for p in check_rules(d, LVS))


def test_rules_reject_a_weak_beat_ending_and_a_half_cadence_at_level_1() -> None:
    d = good_doc()
    last = d["measures"][7]["events"]
    last[0]["tick"] += 480
    last[0]["dur"] = 480
    last[1]["tick"] = last[0]["tick"] + 480
    last[1]["dur"] = 480
    d["measures"][7]["events"].insert(0, {"id": "e99", "kind": "rest", "tick": 7 * 1920, "dur": 480})
    assert any("strong beat" in p for p in check_rules(d, LVS))
    d = good_doc()
    d["measures"][7]["events"][0]["pitch"] = {"step": "G", "alter": 0, "octave": 4}
    assert any("half cadence below level 3" in p for p in check_rules(d, LVS))
    d["level"] = 3
    assert check_rules(d, LVS) == []


def test_rules_reject_cut_ties_slurs_and_tuplets() -> None:
    d = good_doc()
    d["measures"][7]["events"][0]["tieStart"] = True
    assert any("ends inside a tie" in p for p in check_rules(d, LVS))
    d = good_doc()
    d["measures"][3]["events"][0]["slur"] = "stop"
    assert any("starts inside a slur" in p or "slur stop" in p for p in check_rules(d, LVS))
    d = good_doc()
    d["measures"][0]["events"][0]["slur"] = "start"
    assert any("ends inside a slur" in p for p in check_rules(d, LVS))
    d = good_doc()
    # one group that crosses a barline is cut
    d["measures"][1]["events"][3]["tuplet"] = {"actual": 3, "normal": 2, "groupId": "t1"}
    d["measures"][2]["events"][0]["tuplet"] = {"actual": 3, "normal": 2, "groupId": "t1"}
    assert any("tuplet t1" in p for p in check_rules(d, LVS))


def test_rules_accept_a_short_final_bar_that_balances_the_pickup() -> None:
    d = good_doc()
    # pickup of one beat, then 8 bars whose last bar is three beats long (H6)
    for m in d["measures"]:
        m["index"] += 1
        m["startTick"] += 480
        for e in m["events"]:
            e["tick"] += 480
    d["measures"].insert(0, {"index": 0, "isPickup": True, "startTick": 0, "events": [note(98, 0, 480, "G", 3)]})
    d["pickupTicks"] = 480
    last = d["measures"][-1]["events"]
    last[0]["dur"] = 960
    last[1]["dur"] = 480
    assert [p for p in check_rules(d, LVS) if "H11" in p] == []
    last[1]["dur"] = 240
    assert any("H11" in p for p in check_rules(d, LVS))


# ---------------------------------------------------------------------------------------------------- the real build

BUILD = TOOL_DIR / "build"
needs_review_build = pytest.mark.skipif(not (BUILD / "review" / "candidates.jsonl").exists(), reason="needs build/review (run the pipeline through review)")


@pytest.fixture(scope="module")
def emission() -> Any:
    inp = load_inputs(BUILD)
    return inp, build_corpus(inp)


@needs_review_build
def test_every_gate_passes_on_the_real_build(emission: Any) -> None:
    inp, em = emission
    assert em.problems == []
    passing = sum(1 for r in inp.all_records if r["status"] == "pass")
    # the only reduction is the manifest-budget level cap, which spares every level at or under the cap
    assert len(em.docs) == (em.trimmed["manifestAfter"] if em.trimmed else passing) <= passing
    assert em.trimmed is None or em.trimmed["manifestBefore"] == passing


@needs_review_build
def test_a_second_build_is_byte_identical(emission: Any) -> None:
    inp, em = emission
    again = build_corpus(inp, validate=False)
    assert again.files == em.files


@needs_review_build
def test_documents_carry_effective_level_and_the_c6_event_ids(emission: Any) -> None:
    inp, em = emission
    by_hash = {r["contentHash"]: r for r in inp.records}
    for d in em.docs:
        r = by_hash[d["contentHash"]]
        assert d["level"] == r["effectiveLevel"]
        events = [e for m in d["measures"] for e in m["events"]]
        assert [e["id"] for e in events] == [f"e{i}" for i in range(1, len(events) + 1)]
        notes = [e for e in events if e["kind"] == "note"]
        mid = lambda e: 12 * (e["pitch"]["octave"] + 1) + {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}[e["pitch"]["step"]] + e["pitch"]["alter"]  # noqa: E731
        assert d["extremes"]["highId"] == next(e["id"] for e in notes if mid(e) == max(map(mid, notes)))
        assert d["extremes"]["lowId"] == next(e["id"] for e in notes if mid(e) == min(map(mid, notes)))
        assert d["rangeConcert"] == {"min": min(map(mid, notes)), "max": max(map(mid, notes))}
        assert d["source"]["composerDeath"] < 1931 and d["source"]["license"] == "CC0-1.0"


@needs_review_build
def test_manifest_stats_and_chunk_layout(emission: Any) -> None:
    inp, em = emission
    counts: dict[int, int] = {}
    for e in em.entries:
        counts[e["level"]] = counts.get(e["level"], 0) + 1
    assert em.stats["servedLevels"] == sorted(lv for lv, n in counts.items() if n >= 30)
    for c in em.index["chunks"]:
        chunk = json.loads(em.files[c["file"]])
        ids = [d["id"] for d in chunk["excerpts"]]
        assert ids == sorted(ids) and 1 <= len(ids) <= 64
        assert len({d["level"] for d in chunk["excerpts"]}) == 1
        assert c["shard"].startswith(f"shard-L{chunk['excerpts'][0]['level']:02d}-")
    shards = {c["shard"] for c in em.index["chunks"]}
    assert {e["shard"] for e in em.entries} == shards
    assert [e["id"] for e in em.entries] == sorted(e["id"] for e in em.entries)
    assert json.loads(em.files["withdrawn.json"]) == {"schemaVersion": 1, "ids": []}


@needs_review_build
def test_ruling_24_viability_on_the_real_build(emission: Any) -> None:
    inp, em = emission
    v = viability(em.docs, em.entries, em.stats, inp.cfg)
    assert v["total"] >= 300 and v["emptyCells"] == [] and v["ok"]
    assert v["servedLevels"] == em.stats["servedLevels"]


@needs_review_build
def test_gates_catch_a_missing_verdict_and_a_missing_licence_record(emission: Any) -> None:
    inp, em = emission
    accepted = [d for d in em.docs if d["review"]["llm"] == "accepted"]
    assert accepted
    verdicts, batches = inp.verdict_cache
    h = accepted[0]["contentHash"]
    no_verdict = copy.copy(inp)
    no_verdict.verdict_cache = ({k: v for k, v in verdicts.items() if k[0] != h}, batches)
    assert any(p.startswith("H-review") and accepted[0]["id"] in p for p in build_corpus(no_verdict, validate=False).problems)
    gate = dict(inp.gate)
    victim = next(r["fileId"] for r in inp.records)
    gate[victim] = dict(gate[victim], licence=dict(gate[victim]["licence"], evidence=None))
    no_evidence = copy.copy(inp)
    no_evidence.gate = gate
    assert any(p.startswith("H-licence") and "evidence" in p for p in build_corpus(no_evidence, validate=False).problems)


@needs_review_build
def test_run_emit_writes_the_committed_corpus_byte_for_byte(emission: Any, tmp_path: Path) -> None:
    inp, em = emission
    out = tmp_path / "v1"
    r = run_emit(BUILD, out_dir=out, licences_dir=tmp_path / "LICENSES", cache=None, report_path=tmp_path / "report.md")
    assert r["ok"] and r["determinism"]
    assert {p.name: p.read_bytes() for p in out.glob("*.json")} == em.files
    report = (tmp_path / "report.md").read_text(encoding="utf-8")
    assert "Ruling 24 gate" in report and "**PASS**" in report and "Control accuracy per packet" in report
    committed = {p.name: p.read_bytes() for p in PUBLIC_CORPUS.glob("*.json")}
    assert committed == em.files, "public/corpus/v1 is stale: run `python -m corpus_build emit`"


def test_level_cap_trims_crowded_levels_only_and_keeps_the_most_interesting() -> None:
    docs = [{"id": f"l{lv}-{i:02d}", "level": lv, "quality": {"interest": i / 100}} for lv in (5, 8) for i in range(20 if lv == 5 else 4)]
    out = cap_levels_by_interest(docs, 6)
    by: dict[int, list[str]] = {}
    for d in out:
        by.setdefault(d["level"], []).append(d["id"])
    assert len(by[8]) == 4 and len(by[5]) == 6
    assert all(int(i.split("-")[1]) >= 14 for i in by[5])
