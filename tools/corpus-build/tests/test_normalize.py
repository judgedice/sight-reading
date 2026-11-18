"""Normalizer (03 section 6.4) on hand-written read dumps. No music21 and no clone cache needed."""

from __future__ import annotations

from typing import Any

from corpus_build.normalize import assign_movements, normalize_measure, normalize_part, part_stats


def note(offset: str, ql: str, step: str = "C", octave: int = 4, alter: float = 0.0, voice: str = "1", **kw: Any) -> dict[str, Any]:
    return {"kind": "note", "voice": voice, "offset": offset, "ql": ql, "grace": False, "pitch": {"step": step, "alter": alter, "octave": octave}, **kw}


def rest(offset: str, ql: str, voice: str = "1", **kw: Any) -> dict[str, Any]:
    return {"kind": "rest", "voice": voice, "offset": offset, "ql": ql, "grace": False, "fullMeasure": False, **kw}


def measure(index: int, elements: list[dict[str, Any]], **kw: Any) -> dict[str, Any]:
    m: dict[str, Any] = {"index": index, "number": index + 1, "suffix": "", "implicit": False, "elements": elements, "marks": [], "dynamics": [], "tempo": []}
    if index == 0:
        m["timeSig"] = {"num": 4, "den": 4, "offset": "0", "text": "4/4"}
        m["keySig"] = {"fifths": 0, "offset": "0"}
    m.update(kw)
    return m


def fresh() -> dict[str, Any]:
    return {"beats": 4, "beatType": 4, "fifths": 0, "mode": None, "pending": []}


def norm(elements: list[dict[str, Any]], **kw: Any) -> dict[str, Any]:
    return normalize_measure(measure(0, elements, **kw), fresh())


FOUR = [note("0", "1"), note("1", "1", "D"), note("2", "1", "E"), note("3", "1", "F")]


def test_plain_measure_becomes_ticks_at_480():
    m = norm(FOUR)
    assert [(e["tick"], e["dur"]) for e in m["events"]] == [(0, 480), (480, 480), (960, 480), (1440, 480)]
    assert m["events"][0]["midi"] == 60 and m["barTicks"] == 1920 and m["lengthTicks"] == 1920
    assert m["problems"] == [] and m["tags"] == []


def test_grace_notes_are_removed_without_stealing_time_and_tagged():
    grace = {**note("0", "0"), "grace": True}
    m = norm([grace, *FOUR])
    assert len(m["events"]) == 4 and m["events"][0]["tick"] == 0 and m["tags"] == ["grace-removed"] and m["problems"] == []
    assert m["removed"] == {"grace": 1}


def test_ornaments_are_removed_principal_note_kept():
    els = [note("0", "1", ornament=True), *FOUR[1:]]
    m = norm(els)
    assert m["events"][0]["midi"] == 60 and m["events"][0]["ornamentRemoved"] is True
    assert m["tags"] == ["ornament-removed"] and m["problems"] == []


def test_measured_tremolo_is_a_problem_for_the_window():
    m = norm([note("0", "1", tremolo=True), *FOUR[1:]])
    assert m["problems"] == ["tremolo"] and m["events"][0]["tremolo"] is True


def test_fermata_is_kept_on_the_event_for_the_window_rule():
    m = norm([*FOUR[:3], note("3", "1", "F", fermata=True)])
    assert m["events"][3]["fermata"] is True and m["problems"] == [] and m["tags"] == []


def test_cue_notes_are_removed_and_tagged():
    cue = {**note("0", "1", voice="2"), "cue": True}
    m = norm([*FOUR, cue])
    assert m["tags"] == ["cue-removed"] and len(m["events"]) == 4 and m["problems"] == []


def test_lyrics_are_stripped_to_the_line_end_flag():
    m = norm([note("0", "1", lyric=True, lyricLineEnd=True), *FOUR[1:]])
    e = m["events"][0]
    assert e["lyricLineEnd"] is True and "lyric" not in e and "lyrics" not in e


def test_chord_second_voice_hidden_and_unpitched_are_problems():
    chord = {"kind": "chord", "voice": "1", "offset": "0", "ql": "1", "grace": False, "pitches": [{"step": "C", "alter": 0.0, "octave": 4}, {"step": "E", "alter": 0.0, "octave": 4}]}
    assert "chord" in norm([chord, *FOUR[1:]])["problems"]
    two = norm([*FOUR, note("0", "4", "G", voice="2")])
    assert two["problems"] == ["second-voice"]
    assert "hidden-note" in norm([note("0", "1", hidden=True), *FOUR[1:]])["problems"]
    assert "unpitched" in norm([{"kind": "unpitched", "voice": "1", "offset": "0", "ql": "1", "grace": False}, *FOUR[1:]])["problems"]


def test_second_voice_of_rests_only_is_fine():
    m = norm([*FOUR, rest("0", "4", voice="2")])
    assert m["problems"] == [] and len(m["events"]) == 4


def test_non_integer_ticks_and_gaps_are_problems():
    # a 1/7 quarter is 68.57 ticks
    assert "non-integer-ticks" in norm([note("0", "1/7"), note("1/7", "27/7"), ])["problems"]
    assert "gap-or-overlap" in norm([note("0", "1"), note("2", "1")])["problems"]


def test_triplets_are_integer_ticks():
    t = [note("0", "1/3", tuplet=[3, 2], tupletStart=True), note("1/3", "1/3", tuplet=[3, 2]), note("2/3", "1/3", tuplet=[3, 2], tupletStop=True), note("1", "3")]
    m = norm(t)
    assert [e["dur"] for e in m["events"]] == [160, 160, 160, 1440] and m["problems"] == []


def test_microtone_and_hidden_pitch():
    assert "microtone" in norm([note("0", "1", alter=0.5), *FOUR[1:]])["problems"]


def test_markers_are_kept_and_make_a_barrier():
    m = norm(FOUR, marks=["repeat-end"], rightBarline={"type": "final"})
    assert m["barrier"] is True and m["marks"] == ["repeat-end"] and m["finalBarline"] is True and m["doubleBarline"] is True
    assert norm(FOUR, marks=["ottava"])["barrier"] is False


def test_whole_measure_rest_gets_the_bar_length():
    m = norm([rest("0", "3", fullMeasure=True)])
    assert m["events"][0]["dur"] == 1920 and m["events"][0]["measureRest"] is True


def test_time_signature_and_key_carry_forward_and_changes_are_flagged():
    a = measure(0, FOUR)
    b = measure(1, [note("0", "3"), ], timeSig={"num": 3, "den": 4, "offset": "0", "text": "3/4"}, keySig={"fifths": 2, "offset": "0", "mode": "major"})
    c = measure(2, [note("0", "3")])
    part = normalize_part({"measures": [a, b, c]})
    ms = part["measures"]
    assert [m["barTicks"] for m in ms] == [1920, 1440, 1440]
    assert [m["timeChange"] for m in ms] == [False, True, False] and [m["keyChange"] for m in ms] == [False, True, False]
    assert ms[2]["fifths"] == 2 and ms[2]["problems"] == []


def test_mid_measure_time_change_is_a_problem():
    m = norm(FOUR, timeSig={"num": 3, "den": 4, "offset": "2", "text": "3/4"})
    assert "mid-measure-time-change" in m["problems"]


def test_dynamics_attach_to_the_next_note_across_a_barline():
    a = measure(0, [rest("0", "4")], dynamics=[{"offset": "0", "value": "p"}])
    b = measure(1, FOUR)
    ms = normalize_part({"measures": [a, b]})["measures"]
    assert ms[1]["events"][0]["dynamic"] == "p"


def test_tempo_is_recorded_at_piece_level():
    a = measure(0, FOUR, tempo=[{"offset": "0", "bpm": None, "text": "Langsam"}, {"offset": "0", "bpm": 60.0, "text": None}])
    part = normalize_part({"measures": [a]})
    assert [t["text"] for t in part["tempo"]] == ["Langsam", None] and part["tempo"][1]["bpm"] == 60.0


def test_movements_start_where_the_printed_number_restarts():
    ms = [{"numeric": n, "number": str(n)} for n in (0, 1, 2, 3, 1, 2, 2, 3)]
    ms[6]["number"] = "2a"
    assign_movements(ms)  # type: ignore[arg-type]
    assert [m["movement"] for m in ms] == [1, 1, 1, 1, 2, 2, 2, 2]


def test_measure_numbers_are_kept_as_printed():
    m = measure(0, FOUR, suffix="a")
    m["number"] = 12
    assert normalize_measure(m, fresh())["number"] == "12a"


def test_stats():
    a = measure(0, FOUR)
    b = measure(1, [{**note("0", "0"), "grace": True}, *FOUR[:3], note("3", "2")])
    s = part_stats(normalize_part({"measures": [a, b]}))
    assert s["measures"] == 2 and s["notes"] == 8 and s["tags"] == {"grace-removed": 1} and s["measuresWithProblems"] == 0
