"""Reader and normalizer on tiny hand-written MusicXML (zipped as .mxl), one construct per test (03 sections 6.3, 6.4)."""

from __future__ import annotations

import zipfile
from pathlib import Path

import pytest

pytest.importorskip("music21")

from corpus_build.normalize import normalize_part  # noqa: E402
from corpus_build.read import read_file  # noqa: E402

HEAD = '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><work><work-title>T</work-title></work><part-list>{plist}</part-list>'
VOICE_LIST = '<score-part id="P1"><part-name>Voice</part-name></score-part>'


def n(step: str = "C", octave: int = 4, dur: int = 1, extra: str = "", notations: str = "", typ: str = "quarter", alter: int = 0) -> str:
    al = f"<alter>{alter}</alter>" if alter else ""
    nt = f"<notations>{notations}</notations>" if notations else ""
    return f"<note>{extra}<pitch><step>{step}</step>{al}<octave>{octave}</octave></pitch><duration>{dur}</duration><type>{typ}</type>{nt}</note>"


def attrs(beats: int = 4, fifths: int = 0) -> str:
    return f"<attributes><divisions>1</divisions><key><fifths>{fifths}</fifths></key><time><beats>{beats}</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>"


def mxl(tmp_path: Path, measures: list[str], plist: str = VOICE_LIST, extra_parts: str = "", name: str = "t.mxl") -> Path:
    body = "".join(f'<measure number="{i + 1}">{m}</measure>' for i, m in enumerate(measures))
    xml = HEAD.format(plist=plist) + f'<part id="P1">{body}</part>{extra_parts}</score-partwise>'
    p = tmp_path / name
    with zipfile.ZipFile(p, "w") as z:
        z.writestr("META-INF/container.xml", '<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>')
        z.writestr("score.xml", xml)
    return p


FOUR = n("C") + n("D") + n("E") + n("F")


def run(tmp_path: Path, measures: list[str], **kw) -> list[dict]:
    res = read_file(str(mxl(tmp_path, measures, **kw)), "openscore-lieder")
    assert res["ok"], res
    return normalize_part(res["parts"][0]["data"])["measures"]


def test_grace_and_ornament_and_fermata_and_lyrics(tmp_path: Path):
    grace = "<note><grace/><pitch><step>D</step><octave>4</octave></pitch><type>eighth</type></note>"
    trill = n("C", notations="<ornaments><trill-mark/></ornaments>")
    ferm = n("F", notations="<fermata/>")
    lyric = "<lyric><syllabic>end</syllabic><text>Welt,</text></lyric>"
    m1 = attrs() + grace + trill + n("D") + n("E") + ferm
    m2 = n("C", extra="").replace("</note>", lyric + "</note>") + n("D") + n("E") + n("F")
    ms = run(tmp_path, [m1, m2])
    assert ms[0]["tags"] == ["grace-removed", "ornament-removed"]
    assert [e["tick"] for e in ms[0]["events"]] == [0, 480, 960, 1440] and ms[0]["events"][3]["fermata"] is True
    assert ms[0]["problems"] == []
    assert ms[1]["events"][0]["lyricLineEnd"] is True and "lyric" not in ms[1]["events"][0]


def test_chord_and_second_voice_and_tremolo_are_problems(tmp_path: Path):
    chord = n("C") + n("E", extra="<chord/>") + n("D") + n("E") + n("F")
    ms = run(tmp_path, [attrs() + chord])
    assert ms[0]["problems"] == ["chord"]
    v1 = FOUR.replace("<duration>", "<voice>1</voice><duration>")
    v2 = attrs() + v1 + "<backup><duration>4</duration></backup>" + n("G", octave=3, dur=4, typ="whole", extra="").replace("<duration>", "<voice>2</voice><duration>")
    assert run(tmp_path, [v2], name="v2.mxl")[0]["problems"] == ["second-voice"]
    trem = attrs() + n("C", notations='<ornaments><tremolo type="single">3</tremolo></ornaments>') + n("D") + n("E") + n("F")
    assert run(tmp_path, [trem], name="tr.mxl")[0]["problems"] == ["tremolo"]


def test_cue_notes_are_removed(tmp_path: Path):
    cue = "<note><cue/><pitch><step>A</step><octave>5</octave></pitch><duration>4</duration><voice>2</voice><type>whole</type></note>"
    m = attrs() + FOUR + "<backup><duration>4</duration></backup>" + cue
    res = read_file(str(mxl(tmp_path, [m])), "openscore-lieder")
    assert res["cueNotes"] == 1
    ms = normalize_part(res["parts"][0]["data"])["measures"]
    assert ms[0]["tags"] == ["cue-removed"] and ms[0]["problems"] == [] and len(ms[0]["events"]) == 4


def test_repeats_voltas_and_final_barline_are_markers(tmp_path: Path):
    m1 = attrs() + '<barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>' + FOUR
    m2 = FOUR + '<barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"/></barline>'
    m3 = '<barline location="left"><ending number="1" type="start"/></barline>' + FOUR + '<barline location="right"><ending number="1" type="stop"/></barline>'
    ms = run(tmp_path, [m1, m2, m3])
    assert "repeat-start" in ms[0]["marks"] and "repeat-end" in ms[1]["marks"] and ms[1]["finalBarline"]
    assert ms[0]["barrier"] and ms[1]["barrier"]


def test_segno_and_da_capo_are_barriers(tmp_path: Path):
    segno = '<direction><direction-type><segno/></direction-type></direction>' + FOUR
    dc = '<direction><direction-type><words>D.C. al Fine</words></direction-type></direction>' + FOUR
    ms = run(tmp_path, [attrs() + segno, dc])
    assert ms[0]["barrier"] and ms[1]["barrier"]


def test_tempo_printed_metronome_vs_sound(tmp_path: Path):
    met = '<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>72</per-minute></metronome></direction-type></direction>'
    snd = '<direction><direction-type><words>Langsam</words></direction-type><sound tempo="40"/></direction>'
    res = read_file(str(mxl(tmp_path, [attrs() + met + snd + FOUR])), "openscore-lieder")
    part = normalize_part(res["parts"][0]["data"])
    assert {(t["bpm"], t["text"]) for t in part["tempo"]} == {(72.0, None), (None, "Langsam")}


def test_ties_slurs_dynamics_articulations(tmp_path: Path):
    a = n("C", notations='<tied type="start"/><slur type="start" number="1"/><articulations><staccato/></articulations>', extra="<tie type=\"start\"/>")
    b = n("C", notations='<tied type="stop"/><slur type="stop" number="1"/>', extra="<tie type=\"stop\"/>")
    dyn = '<direction><direction-type><dynamics><mf/></dynamics></direction-type></direction>'
    ms = run(tmp_path, [attrs() + dyn + a + b + n("E") + n("F")])
    e = ms[0]["events"]
    assert e[0]["tieStart"] and e[1]["tieStop"] and e[0]["slurStarts"] == 1 and e[1]["slurStops"] == 1
    assert e[0]["artic"] == ["staccato"] and e[0]["dynamic"] == "mf"


def test_triplets_and_pickup(tmp_path: Path):
    tm = "<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>"
    trip = "".join(n("C", dur=1, typ="eighth").replace("</duration>", "</duration>").replace("<type>", tm.replace("<time-modification>", "").replace("</time-modification>", "") and "<type>") for _ in range(0))
    pickup = attrs().replace("<divisions>1", "<divisions>3") + n("G", dur=3)
    ms = run(tmp_path, [pickup, FOUR.replace("<duration>1<", "<duration>3<")])
    assert ms[0]["events"][0]["dur"] == 480 and ms[0]["lengthTicks"] == 480 and ms[0]["problems"] == []
    assert trip == ""


def test_measure_numbers_with_suffix(tmp_path: Path):
    xml = HEAD.format(plist=VOICE_LIST) + f'<part id="P1"><measure number="1">{attrs()}{FOUR}</measure><measure number="2a">{FOUR}</measure><measure number="2b">{FOUR}</measure></part></score-partwise>'
    p = tmp_path / "s.mxl"
    with zipfile.ZipFile(p, "w") as z:
        z.writestr("score.xml", xml)
    ms = normalize_part(read_file(str(p), "openscore-lieder")["parts"][0]["data"])["measures"]
    assert [m["number"] for m in ms] == ["1", "2a", "2b"] and {m["movement"] for m in ms} == {1}


def test_parse_failure_is_reported_not_raised(tmp_path: Path):
    p = tmp_path / "bad.mxl"
    p.write_bytes(b"not a zip")
    res = read_file(str(p), "openscore-lieder")
    assert res["ok"] is False and res["error"]


def test_piano_part_is_not_converted(tmp_path: Path):
    plist = VOICE_LIST + '<score-part id="P2"><part-name>Piano</part-name><score-instrument id="P2-I1"><instrument-name>Piano</instrument-name></score-instrument></score-part>'
    extra = f'<part id="P2"><measure number="1">{attrs()}{FOUR}</measure></part>'
    res = read_file(str(mxl(tmp_path, [attrs() + FOUR], plist=plist, extra_parts=extra)), "openscore-lieder")
    assert [("data" in p) for p in res["parts"]] == [True, False]
