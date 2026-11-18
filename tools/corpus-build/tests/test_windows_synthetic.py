"""Window proposal, hard rules H1 to H12, mode, cadences and augmentation (03 sections 6.6 to 6.8, job C5) on hand-built
normalized parts. No music21 and no clone cache needed. Each rejection test changes one thing in a passing phrase and
expects exactly its reason."""

from __future__ import annotations

from typing import Any

import pytest

from corpus_build.augment import AugmentError, augment_part, double_phrase, scale_window
from corpus_build.phrase import build_facts, degree_of, section_modes, tonic_pc
from corpus_build.windows import Candidate, End, Start, build_window, lyric_flags, phrase_quality, propose, select, window_key

from .partbuilder import bar, part

# An 8-bar C major phrase after a rest, ending on a PAC (D -> C) with no interior allowed end.
PHRASE = [
    "C4:q D4:q E4:q F4:q",
    "G4:h E4:h",
    "F4:q A4:q G4:q F4:q",
    "E4:h D4:h",
    "C4:q E4:q G4:q E4:q",
    "F4:q D4:q B3:q D4:q",
    "E4:q G4:q F4:q D4:q",
    "C4:h r:h",
]


def song(body: list[Any], pre: str = "r:w", post: Any = bar("r:w", finalBarline=True), **kw: Any) -> dict[str, Any]:
    return part([pre, *body, post] if post is not None else [pre, *body], **kw)


def windows_of(p: dict[str, Any], lyric: bool = False, bass: list[dict[str, Any]] | None = None) -> dict[str, Candidate]:
    pw = propose(p, lyric, bass)
    return {window_key(c): c for c in pw.candidates}


def only(p: dict[str, Any], key: str = "1-8", **kw: Any) -> Candidate:
    ws = windows_of(p, **kw)
    assert key in ws, sorted(ws)
    return ws[key]


def with_bar(i: int, b: Any) -> list[Any]:
    body = list(PHRASE)
    body[i] = b
    return body


# ---------------------------------------------------------------- the passing phrase

def test_phrase_after_a_rest_is_one_8_bar_window():
    p = song(PHRASE)
    pw = propose(p, False)
    assert [window_key(c) for c in pw.primary] == ["1-8"]
    c = pw.primary[0]
    assert c.reason is None and c.bars == 8 and c.start.kind == "after-rest"
    assert c.end.cadence == "PAC" and c.end.degree == 1 and c.end.followed_by == "rest"
    assert phrase_quality(c, pw.ends) == "complete-phrase"
    w = build_window(pw, c, "openscore-quartets")
    assert w["meter"] == {"beats": 4, "beatType": 4, "countUnitTicks": 480, "countsPerBar": 4}
    assert w["mode"] == "major" and w["modal"] is None and w["pickupTicks"] == 0 and w["lengthTicks"] == 8 * 1920
    assert w["modifications"] == ["excerpted"]
    assert [m["source"]["index"] for m in w["measures"]] == list(range(1, 9))
    ticks = [e["tick"] for m in w["measures"] for e in m["events"]]
    assert ticks == sorted(ticks) and ticks[0] == 0


def test_start_after_a_rest_of_one_beat_mid_piece():
    body = ["G4:w", "E4:h. r:q", *PHRASE]
    ws = windows_of(song(body))
    assert "3-10" in ws and ws["3-10"].reason is None and ws["3-10"].start.kind == "after-rest"


def test_no_start_without_a_rest_of_one_beat():
    body = ["G4:w", "E4:h. r:e B3:e", *PHRASE]  # bar 3's first note follows a note; the eighth rest before B3 is under a beat
    ws = windows_of(song(body))
    assert "3-10" not in ws


# ---------------------------------------------------------------- ends (H2)

def test_end_must_fall_on_a_strong_beat():
    ws = windows_of(song(with_bar(7, "r:q C4:h. ")))
    assert "1-8" not in ws


def test_end_on_beat_3_in_4_4_is_strong():
    c = only(song(with_bar(7, "D4:h C4:h")))
    assert c.end.degree == 1 and c.reason is None and c.end.cadence == "PAC"


def test_end_on_degree_5_is_a_half_cadence_from_level_3_and_needs_two_beats_and_a_rest():
    c = only(song(with_bar(7, "G4:h r:h")))
    assert c.end.cadence == "HC" and c.end.degree == 5 and c.reason is None
    assert "1-8" not in windows_of(song(with_bar(7, "G4:q r:q r:h")))


def test_end_on_degree_4_is_not_allowed():
    assert "1-8" not in windows_of(song(with_bar(7, "F4:h r:h"), post=bar("C4:w", finalBarline=True)))


def test_short_end_note_needs_a_following_rest():
    # a one-beat note followed by a note is not an end; followed by a rest it is
    assert "1-8" not in windows_of(song(with_bar(7, "C4:e D4:e E4:h."), post=bar("F4:w", finalBarline=True)))
    assert only(song(with_bar(7, "C4:q r:q r:h"))).reason is None


def test_iac_on_degree_3_and_pac_needs_a_step_from_2_or_7():
    assert only(song(with_bar(7, "E4:h r:h"))).end.cadence == "IAC"
    body = with_bar(6, "E4:q G4:q F4:q G4:q")
    assert only(song(body)).end.cadence == "IAC"  # 1 approached by a leap from 5


def test_trailing_pickup_of_the_next_phrase_is_replaced_by_rests():
    p = song(with_bar(7, "C4:h r:q G3:q"), post=bar("C4:w", finalBarline=True))
    pw = propose(p, False)
    c = next(c for c in pw.candidates if window_key(c) == "1-8")
    assert c.reason is None and c.end.completed
    w = build_window(pw, c, "openscore-quartets")
    last = w["measures"][-1]["events"]
    assert [e["kind"] for e in last] == ["note", "rest", "rest"] and sum(e["dur"] for e in last) == 1920
    assert all(e.get("completion") for e in last[1:])
    assert "final-bar-completed" in w["modifications"] and "next-phrase-cut" in w["tags"]


# ---------------------------------------------------------------- hard rules, one reason each

RULES = [
    ("measure-chord", with_bar(2, "F4:q* A4:q G4:q F4:q")),
    ("measure-second-voice", with_bar(2, bar("F4:q A4:q G4:q F4:q", problems=["second-voice"]))),
    ("measure-tremolo", with_bar(2, bar("F4:q A4:q G4:q F4:q", problems=["tremolo"]))),
    ("measure-gap-or-overlap", with_bar(2, bar("F4:q A4:q G4:q F4:q", problems=["gap-or-overlap"]))),
    ("measure-hidden-note", with_bar(2, bar("F4:q A4:q G4:q F4:q", problems=["hidden-note"]))),
    ("incomplete-bar", with_bar(3, "E4:h")),
    ("crosses-barrier", with_bar(3, bar("E4:h D4:h", marks=["volta", "volta-start"]))),
    ("crosses-barrier", with_bar(3, bar("E4:h D4:h", marks=["repeat-end"]))),
    ("crosses-barrier", with_bar(3, bar("E4:h D4:h", marks=["segno"]))),
    ("crosses-barrier", with_bar(3, bar("E4:h D4:h", marks=["repeat-text"]))),
    ("crosses-final-barline", with_bar(3, bar("E4:h D4:h", finalBarline=True))),
    ("tempo-change", with_bar(4, bar("C4:q E4:q G4:q E4:q", tempo=[{"offset": "0", "bpm": None, "text": "rit."}]))),
    ("tempo-change", with_bar(4, bar("C4:q E4:q G4:q E4:q", tempo=[{"offset": "1", "bpm": 72.0, "text": None}]))),
    ("tempo-change", with_bar(4, bar("C4:q E4:q G4:q E4:q", tempo=[{"offset": "0", "bpm": None, "text": "Più mosso"}]))),
    ("interior-fermata", with_bar(1, "G4:h! E4:h")),
    ("slur-cut-start", with_bar(0, "C4:q) D4:q E4:q F4:q")),
    ("slur-cut-end", with_bar(7, "C4:h( r:h")),
    ("tuplet-cut", with_bar(0, "C4:160t D4:160t E4:160t] F4:q G4:h")),
]


@pytest.mark.parametrize("reason,body", RULES, ids=[r for r, _ in RULES])
def test_each_rule_rejects_for_exactly_its_reason(reason, body):
    c = only(song(body))
    assert c.reason == reason, (c.reason, c.detail)
    assert c.detail


def test_meter_change_inside_rejects():
    body = with_bar(4, bar("C4:q E4:q G4:q", beats=3))
    body[5] = bar("F4:q D4:q B3:q D4:q", beats=4)
    assert only(song(body)).reason == "meter-change"


def test_key_change_inside_rejects():
    body = with_bar(4, bar("C4:q E4:q G4:q E4:q", fifths=1))
    body[5] = bar("F4:q D4:q B3:q D4:q", fifths=0)
    assert only(song(body)).reason == "key-change"


def test_window_may_not_cross_a_movement():
    body = with_bar(4, bar("C4:q E4:q G4:q E4:q", movement=2, number="1"))
    c = windows_of(song(body)).get("1-8")
    assert c is not None and c.reason == "crosses-movement"


def test_non_tempo_text_does_not_reject():
    body = with_bar(4, bar("C4:q E4:q G4:q E4:q", tempo=[{"offset": "0", "bpm": None, "text": "cresc. poco a poco"}, {"offset": "1", "bpm": None, "text": "dolce"}]))
    assert only(song(body)).reason is None


def test_tempo_at_the_window_start_is_its_tempo_not_a_change():
    body = with_bar(0, bar("C4:q D4:q E4:q F4:q", tempo=[{"offset": "0", "bpm": None, "text": "Andante"}]))
    p = song(body)
    pw = propose(p, False)
    c = next(c for c in pw.primary if window_key(c) == "1-8")
    assert build_window(pw, c, "openscore-lieder")["tempoAtStart"] == {"measure": "2", "bpm": None, "text": "Andante"}


def test_fermata_on_the_last_note_is_dropped_and_tagged():
    p = song(with_bar(7, "C4:h! r:h"))
    pw = propose(p, False)
    c = next(c for c in pw.primary if window_key(c) == "1-8")
    w = build_window(pw, c, "openscore-quartets")
    assert "fermata-removed" in w["modifications"]
    assert not any(e.get("fermata") for m in w["measures"] for e in m["events"])


def test_repeat_signs_at_the_window_edges_are_allowed():
    body = with_bar(0, bar("C4:q D4:q E4:q F4:q", marks=["repeat-start"], leftBarline="heavy-light"))
    body[7] = bar("C4:h r:h", marks=["repeat-end"])
    assert only(song(body)).reason is None


def test_ending_inside_a_melodic_sequence_rejects():
    # bars 7-8 state D E C (q q, rest, h); bars 9-10 restate it a whole tone higher: the 8-bar end is inside (H5)
    body = with_bar(6, "D4:q E4:q r:h")
    body += ["E4:q F#4:q r:h", "D4:h r:h"]
    ws = windows_of(song(body, post=bar("C4:w", finalBarline=True)))
    assert ws["1-8"].reason == "sequence-cut"
    assert ws["1-10"].reason in (None, "start-measure-taken")  # ending after the last statement passes the rules


def test_mode_unknown_rejects():
    # the piece ends on F, neither tonic nor triad member of C major or A minor, and F is not its most common pitch
    c = only(song(PHRASE, post=bar("F4:q r:q r:h", finalBarline=True)))
    assert c.reason == "mode-unknown"


def test_grace_and_ornament_tags_become_modifications():
    body = with_bar(2, bar("F4:q A4:q G4:q F4:q", tags=["grace-removed", "ornament-removed"]))
    p = song(body)
    pw = propose(p, False)
    w = build_window(pw, pw.primary[0], "openscore-lieder")
    assert w["modifications"] == ["excerpted", "grace-removed", "ornament-removed", "lyrics-removed"]


def test_lyric_line_end_is_stripped_from_the_content():
    body = with_bar(3, "E4:h; D4:h")
    pw = propose(song(body), True)
    w = build_window(pw, pw.primary[0], "openscore-lieder")
    assert not any("lyricLineEnd" in e for m in w["measures"] for e in m["events"])


# ---------------------------------------------------------------- pickups (H1, H6, H11)

def test_pickup_of_one_beat_after_a_rest():
    p = song(PHRASE, pre="r:h r:q G3:q")
    pw = propose(p, False)
    c = next(c for c in pw.primary if window_key(c) == "p1-8")
    assert c.start.pickup_ticks == 480 and c.start.pickup_mi == 0
    w = build_window(pw, c, "openscore-quartets")
    assert w["pickupTicks"] == 480 and w["measures"][0]["isPickup"] and w["measures"][1]["startTick"] == 480
    assert w["lengthTicks"] == 480 + 8 * 1920  # H11: the final bar is a full bar


def test_pickup_longer_than_two_beats_is_not_a_start():
    p = song(PHRASE, pre="r:q G3:q A3:q B3:q")
    assert "p1-8" not in windows_of(p)


def test_anacrusis_and_a_balancing_final_bar_are_kept_as_written():
    body = list(PHRASE)
    body[7] = bar("C4:h.", finalBarline=True)
    p = part([bar("G3:q", implicit=True, number="0"), *body])
    pw = propose(p, False)
    c = next(c for c in pw.primary if window_key(c) == "p1-8")
    assert c.start.kind == "anacrusis"
    w = build_window(pw, c, "openscore-quartets")
    assert "final-bar-balances-pickup" in w["tags"] and "final-bar-completed" not in w["modifications"]
    assert w["lengthTicks"] == 480 + 7 * 1920 + 1440


def test_short_final_bar_without_a_pickup_is_completed_with_rests():
    body = list(PHRASE)
    body[7] = bar("C4:h.", finalBarline=True)
    p = part(["r:w", *body])
    pw = propose(p, False)
    c = next(c for c in pw.primary if window_key(c) == "1-8")
    w = build_window(pw, c, "openscore-quartets")
    assert "final-bar-completed" in w["modifications"] and w["lengthTicks"] == 8 * 1920


# ---------------------------------------------------------------- starts after breath and lyric lines

def test_start_after_a_breath_mark_and_after_a_lyric_line_end():
    body = ["G4:w", "E4:h. D4:q^", *PHRASE]
    c = windows_of(song(body)).get("3-10")
    assert c is not None and c.start.kind == "after-breath" and c.reason in (None, "overlap-limit")
    body = ["G4:w", "E4:h. D4:q;", *PHRASE]
    assert "3-10" not in windows_of(song(body), lyric=False)
    c = windows_of(song(body), lyric=True)["3-10"]
    assert c.start.kind == "after-lyric-line"


def test_lyric_flags_measure_the_silver_standard_boundary():
    body = ["G4:w", "E4:h. D4:q;", *with_bar(7, "C4:h; r:h")]
    pw = propose(song(body), True)
    c = next(c for c in pw.candidates if window_key(c) == "3-10")
    assert lyric_flags(pw.facts, c) == (True, True)
    body = ["G4:w", "E4:h. r:q", *PHRASE, "E4:h C4:h"]
    pw = propose(song(body), True)
    c = next(c for c in pw.candidates if window_key(c) == "3-10")
    assert lyric_flags(pw.facts, c) == (False, False)


# ---------------------------------------------------------------- mode (03 section 6.6)

def test_major_and_minor_from_the_signature_and_the_final():
    assert section_modes(song(PHRASE)["measures"])[0].mode == "major"
    am = ["A3:q B3:q C4:q D4:q", "E4:h C4:h", "D4:q F4:q E4:q D4:q", "C4:h B3:h", "A3:q C4:q E4:q C4:q", "D4:q B3:q G#3:q B3:q", "C4:q E4:q D4:q B3:q", "A3:h r:h"]
    secs = section_modes(song(am)["measures"])
    assert [(s.mode, s.basis) for s in secs] == [("minor", "final")]
    c = only(song(am))
    assert c.reason is None and c.end.degree == 1 and c.end.cadence == "PAC"  # G# (raised 7th) -> A


def test_voice_ending_on_a_triad_member_uses_the_key_profile():
    body = with_bar(7, "E4:h r:h")
    s = section_modes(song(body)["measures"])[0]
    assert (s.mode, s.basis) == ("major", "profile")


def test_quartet_upper_part_uses_the_cello_final():
    body = with_bar(7, "E4:h r:h")
    upper = song(body)["measures"]
    cello = song(with_bar(7, "C3:h r:h"))["measures"]
    s = section_modes(upper, cello)[0]
    assert (s.mode, s.basis) == ("major", "bass-final")


def test_modal_final_names_the_church_mode_and_windows_end_on_it():
    # no signature, final D, D the most common pitch: D dorian
    dor = ["D4:q E4:q F4:q G4:q", "A4:h F4:h", "G4:q E4:q D4:q E4:q", "F4:h D4:h", "D4:q F4:q A4:q F4:q", "G4:q E4:q C4:q E4:q", "D4:q E4:q D4:q C4:q", "D4:h r:h"]
    p = song(dor)
    s = section_modes(p["measures"])[0]
    assert (s.mode, s.basis) == ("dorian", "modal-final")
    assert tonic_pc(0, "dorian") == 2 and degree_of(2, 0, "dorian") == 1
    pw = propose(p, True)
    c = next(c for c in pw.primary if window_key(c) == "1-8")
    w = build_window(pw, c, "openscore-lieder")
    assert w["modal"] == "dorian" and "modal" in w["tags"]
    # with a bass part available the same final is not taken as modal (precision guard)
    assert section_modes(p["measures"], song(dor)["measures"])[0].mode is None


# ---------------------------------------------------------------- selection

def _cand(first: int, last: int, sc: float, pickup: bool = False) -> Candidate:
    s = Start(first, first - 1 if pickup else None, 0, first, "after-rest", 480 if pickup else 0)
    e = End(last, last, 1, "PAC", "rest", False)
    c = Candidate(s, e, last - first + 1)
    c.score = sc
    return c


def test_one_window_per_start_bar_and_at_most_half_overlap():
    cs = [_cand(1, 8, 1.0), _cand(1, 12, 0.9), _cand(5, 12, 0.8), _cand(3, 10, 0.95), _cand(9, 16, 0.5)]
    kept, fb = select(cs)
    keys = [window_key(c) for c in kept]
    assert keys == ["1-8", "5-12", "9-16"]
    assert cs[1].reason == "start-measure-taken" and cs[3].reason == "overlap-limit"
    for a in kept:
        for b in kept:
            if a is not b:
                inter = max(0, min(a.last, b.last) - max(a.first, b.first) + 1)
                assert inter / min(a.bars, b.bars) <= 0.5


def test_long_window_keeps_its_8_bar_fallback_with_the_same_start():
    cs = [_cand(1, 10, 1.2), _cand(1, 8, 1.0)]
    cs[1] = Candidate(cs[0].start, End(8, 8, 1, "PAC", "rest", False), 8)
    cs[1].score = 1.0
    kept, fb = select(cs)
    assert [window_key(c) for c in kept] == ["1-10"]
    assert fb[id(kept[0])] is cs[1] and cs[1].reason is None


def test_fallback_needs_the_same_start_option():
    cs = [_cand(1, 10, 1.2), _cand(1, 8, 1.0, pickup=True)]
    kept, fb = select(cs)
    assert fb == {} and cs[1].reason == "start-measure-taken"


# ---------------------------------------------------------------- LBDM and facts

def test_lbdm_boundary_is_strongest_after_a_long_note_and_a_rest():
    facts = build_facts(song(PHRASE + ["G4:q A4:q B4:q C5:q", "D5:q C5:q B4:q A4:q"]))
    ch = facts.chains
    k = next(c.idx for c in ch if c.mi == 8)  # the cadence C4 in bar 8
    assert facts.boundary[k] == max(facts.boundary)


def test_tie_chains_are_one_note():
    facts = build_facts(part(["C4:h. D4:q~", "D4:h E4:h"]))
    durs = [(c.midi, c.dur) for c in facts.chains]
    assert durs == [(60, 1440), (62, 1440), (64, 960)]


# ---------------------------------------------------------------- augmentation (03 section 6.8, 02 §3.3)

TWO_FOUR = ["C4:q D4:q", "E4:q F4:q", "G4:q E4:q", "D4:h", "C4:q E4:q", "G4:q F4:q", "E4:e F4:e D4:q", "C4:q r:q"]


def test_8_bars_of_2_4_become_8_bars_of_4_4():
    p = song(TWO_FOUR, pre="r:h", post=bar("r:h", finalBarline=True), beats=2)
    pw = propose(p, False)
    c = next(c for c in pw.primary if window_key(c) == "1-8")
    w = build_window(pw, c, "openscore-quartets")
    v = scale_window(w, 4, 4)
    assert v["meter"]["beats"] == 4 and v["lengthTicks"] == 8 * 1920
    assert "rhythm-augmented-x2" in v["modifications"]
    assert [e["dur"] for e in v["measures"][0]["events"]] == [960, 960]
    assert v["measures"][6]["events"][0]["dur"] == 480 and v["measures"][6]["events"][2]["tick"] == 6 * 1920 + 960  # old beat 2 is beat 3


def test_augment_part_emits_variants_only_from_allowed_meters():
    p = song(TWO_FOUR, pre="r:h", post=bar("r:h", finalBarline=True), beats=2)
    rec = {"id": "x#0", "parentId": "x", "partIndex": 0, "corpus": "openscore-quartets", "role": "vn1"}
    pw = propose(p, False)
    c = next(c for c in pw.primary if window_key(c) == "1-8")
    wid = "x#0@1-8"
    win = {"id": wid, "bars": 8, "meter": "2/4", "firstMeasure": 1, "lastMeasure": 8, "minLevelCadence": 1, "mode": "major", "parentId": "x#0"}
    out = augment_part(p, rec, [win], {wid: build_window(pw, c, "openscore-quartets")}, False, None)
    ids = {o["id"]: o for o in out}
    assert ids[wid + "-aug2"]["status"] == "pass" and ids[wid + "-aug2"]["augmentFrom"] == "2/4-to-4/4"
    assert ids[wid + "-aug2"]["requiresLevelMax"] == 3 and ids[wid + "-aug2"]["meter"] == "4/4"
    # 3/4 is never a source
    p34 = song(["C4:q D4:q E4:q", "F4:h.", "G4:q E4:q C4:q", "D4:h r:q"] * 2, pre="r:h.", post=bar("r:h.", finalBarline=True), beats=3)
    assert augment_part(p34, rec, [], {}, False, None) == []


def test_complete_4_bar_phrase_is_doubled_with_ties_across_the_new_barlines():
    four = ["C4:q D4:q E4:h", "F4:h. E4:q", "D4:q G4:q E4:q D4:q", "C4:h r:h"]
    p = song(four)
    pw = propose(p, False, lengths=range(4, 5))
    c = next(c for c in pw.primary if window_key(c) == "1-4")
    assert phrase_quality(c, pw.ends) == "complete-phrase"
    v = double_phrase(build_window(pw, c, "openscore-lieder"))
    assert len(v["measures"]) == 8 and v["lengthTicks"] == 8 * 1920
    for m in v["measures"]:
        assert sum(e["dur"] for e in m["events"]) == 1920
    # the doubled dotted half (2880) of source bar 2 crosses the new barline: a whole tied to a half
    b3, b4 = v["measures"][2]["events"], v["measures"][3]["events"]
    assert (b3[0]["dur"], b3[0].get("tieStart")) == (1920, True) and (b4[0]["dur"], b4[0].get("tieStop")) == (960, True)
    rec = {"id": "x#0", "parentId": "x", "partIndex": 0, "corpus": "openscore-lieder", "role": "voice"}
    out = augment_part(p, rec, [], {}, True, None)
    assert [o["id"] for o in out if o["status"] == "pass"] == ["x#0@1-4-aug2"] and out[0]["augmentFrom"] == "phrase4-4/4"


def test_doubled_tuplet_across_a_barline_and_long_pickup_are_rejected():
    # a triplet at beats 3-4 of the source bar stays inside the first new bar
    four = ["C4:q D4:q E4:320t[ F4:320t G4:320t]", "F4:h. E4:q", "D4:q G4:q E4:q D4:q", "C4:h r:h"]
    pw = propose(song(four), False, lengths=range(4, 5))
    double_phrase(build_window(pw, next(c for c in pw.primary if window_key(c) == "1-4"), "openscore-lieder"))
    # a triplet straddling the source half-bar (ticks 720 to 1200) would straddle the new barline
    four = ["C4:q D4:e E4:160t[ F4:160t G4:160t] A4:e B4:q", "F4:h. E4:q", "D4:q G4:q E4:q D4:q", "C4:h r:h"]
    pw = propose(song(four), False, lengths=range(4, 5))
    w = build_window(pw, next(c for c in pw.primary if window_key(c) == "1-4"), "openscore-lieder")
    with pytest.raises(AugmentError) as ei:
        double_phrase(w)
    assert ei.value.reason == "aug-tuplet-across-barline"
    # a doubled pickup that fills half a 4/4 bar or more is not a pickup any more
    w = dict(w, pickupTicks=960)
    with pytest.raises(AugmentError) as ei:
        double_phrase(w)
    assert ei.value.reason == "aug-pickup-too-long"
