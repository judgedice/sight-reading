"""Part roles (03 section 6.5, job C4). Pure metadata, no music21."""

from __future__ import annotations

from corpus_build.roles import PartInfo, classify_lieder, classify_parts, classify_quartet


def P(i: int, name: str, instrument: str = "", sound: str = "") -> PartInfo:
    return PartInfo(i, f"P{i}", name, instrument, sound)


def test_lieder_voice_by_instrument_or_name():
    assert classify_lieder(P(0, "Voice", "Voice", "voice.vocals")).accept
    for name in ("Singstimme", "Gesang.", "CHANT.", "Chant Voice", "Soprano", "Sopranos", "1er Dessus Voice 1", "Stimme"):
        d = classify_lieder(P(0, name))
        assert d.accept and d.role == "voice", name
    assert classify_lieder(P(0, "Mezzo", "Voice", "voice.vocals")).accept  # by instrument alone
    assert classify_lieder(P(0, "Ténors", "Tenor", "voice.tenor")).accept  # the accent defeats the name regex, the instrument decides


def test_lieder_piano_and_instruments_are_not_read_and_say_why():
    for name, sound in (("Piano", "keyboard.piano"), ("Pianoforte", "keyboard.piano.grand"), ("Klavier Piano", "keyboard.piano.grand"), ("Facilité", "keyboard.piano"), ("Harpsichord", "keyboard.harpsichord")):
        d = classify_lieder(P(1, name, "Piano", sound))
        assert not d.accept and d.reason == "piano-part-not-read", name
    d = classify_lieder(P(2, "Flute", "Flute", "wind.flutes.flute"))
    assert not d.accept and d.reason == "part-not-voice"


def test_lieder_part_named_voice_with_another_instrument_is_kept_but_marked():
    d = classify_lieder(P(0, "Voice", "Oboe", "wind.reed.oboe"))
    assert d.accept and d.instrument_mismatch


def test_quartet_roles():
    parts = [P(0, "Violin 1", "Violin", "strings.violin"), P(1, "Violin 2", "Violin", "strings.violin"), P(2, "Viola", "Viola", "strings.viola"), P(3, "Violoncello", "Violoncello", "strings.cello")]
    d = classify_quartet(parts)
    assert [(d[i].role, d[i].label) for i in range(4)] == [("vn1", "Vn I"), ("inner", "Vn II"), ("inner", "Va"), ("cello", "Vc")]


def test_quartet_roles_from_names_when_the_sound_is_missing():
    parts = [P(0, "Vn I"), P(1, "Vn II"), P(2, "Va."), P(3, "Vc.")]
    d = classify_quartet(parts)
    assert [d[i].role for i in range(4)] == ["vn1", "inner", "inner", "cello"]


def test_quartet_unknown_part_is_rejected_with_a_reason():
    d = classify_quartet([P(0, "Violin 1", "", "strings.violin"), P(1, "Piano", "Piano", "keyboard.piano")])
    assert d[1].reason == "part-role-unknown" and d[0].accept


def test_mutopia_is_not_handled_here():
    d = classify_parts("mutopia", [P(0, "Voice")])
    assert not d[0].accept and d[0].reason == "corpus-not-supported"
