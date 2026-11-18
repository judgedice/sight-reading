"""Candidate parts and part roles (03 section 6.5, job C4). Pure functions on part metadata, no music21.

Lieder: voice parts only. The instrument is voice, or the part name matches the spec's regex. Piano parts are not read.
String quartets: Vn I, Vn II, Va, Vc, labelled with a role (`vn1`, `inner`, `cello`) for the filters in 6.9.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

VOICE_NAME_RE = re.compile(r"(voice|singstimme|gesang|chant|soprano|contralto|alto|tenor|baritone|bass|stimme)", re.I)
VOICE_INSTRUMENT_RE = re.compile(r"^voice\b", re.I)  # music21 instrumentSound: voice.vocals, voice.soprano, ...
KEYBOARD_RE = re.compile(r"^keyboard\b", re.I)
KEYBOARD_NAME_RE = re.compile(r"(piano|klavier|pianoforte|clavier|harpsichord|cembalo|organ|orgue)", re.I)

STRING_SOUND = {"strings.violin": "violin", "strings.viola": "viola", "strings.cello": "cello"}
STRING_NAME = (
    ("violoncello", "cello"), ("violincello", "cello"), ("cello", "cello"), ("violon", "violin"), ("violin", "violin"),
    ("viola", "viola"), ("alto", "viola"), ("bratsche", "viola"), ("vc", "cello"), ("vn", "violin"), ("va", "viola"),
)

ROLE_LABEL = {"vn1": "Vn I", "vn2": "Vn II", "va": "Va", "vc": "Vc"}


@dataclass(frozen=True)
class PartInfo:
    index: int
    id: str
    name: str
    instrument: str
    sound: str  # music21 instrumentSound, "" when unknown


@dataclass(frozen=True)
class Decision:
    accept: bool
    role: str | None = None
    label: str | None = None  # Vn I, Vn II, Va, Vc for quartets
    reason: str | None = None
    detail: str | None = None
    instrument_mismatch: bool = False


def is_keyboard(p: PartInfo) -> bool:
    return bool(KEYBOARD_RE.match(p.sound)) or bool(KEYBOARD_NAME_RE.search(p.name)) or bool(KEYBOARD_NAME_RE.search(p.instrument))


def classify_lieder(p: PartInfo) -> Decision:
    by_instrument = bool(VOICE_INSTRUMENT_RE.match(p.sound)) or p.instrument.strip().lower() == "voice"
    by_name = bool(VOICE_NAME_RE.search(p.name))
    if by_instrument or by_name:
        # A part named "Voice" whose instrument is an oboe is kept (the name matches), but marked.
        mismatch = not by_instrument and bool(p.sound) and not VOICE_INSTRUMENT_RE.match(p.sound)
        return Decision(True, role="voice", instrument_mismatch=mismatch)
    if is_keyboard(p):
        return Decision(False, reason="piano-part-not-read", detail=f"{p.name!r} is a keyboard part")
    return Decision(False, reason="part-not-voice", detail=f"name {p.name!r} and instrument {p.instrument!r} are not a voice")


def string_family(p: PartInfo) -> str | None:
    fam = STRING_SOUND.get(p.sound)
    if fam:
        return fam
    for hay in (p.instrument, p.name):
        low = hay.lower()
        for key, f in STRING_NAME:
            if len(key) <= 2:
                if re.search(rf"\b{key}\b", low):
                    return f
            elif key in low:
                return f
    return None


def classify_quartet(parts: list[PartInfo]) -> dict[int, Decision]:
    """Roles for every part of one quartet file. The first violin part is `vn1`, the second violin and the viola are
    `inner`, the cello is `cello`. Parts that are not strings are rejected."""
    out: dict[int, Decision] = {}
    violins = 0
    for p in parts:
        fam = string_family(p)
        if fam == "violin":
            violins += 1
            if violins == 1:
                out[p.index] = Decision(True, role="vn1", label=ROLE_LABEL["vn1"])
            else:
                out[p.index] = Decision(True, role="inner", label=ROLE_LABEL["vn2"] if violins == 2 else f"Vn {violins}")
        elif fam == "viola":
            out[p.index] = Decision(True, role="inner", label=ROLE_LABEL["va"])
        elif fam == "cello":
            out[p.index] = Decision(True, role="cello", label=ROLE_LABEL["vc"])
        else:
            out[p.index] = Decision(False, reason="part-role-unknown", detail=f"name {p.name!r} and instrument {p.instrument!r} are not a quartet string part")
    return out


def classify_parts(corpus: str, parts: list[PartInfo]) -> dict[int, Decision]:
    if corpus == "openscore-lieder":
        return {p.index: classify_lieder(p) for p in parts}
    if corpus == "openscore-quartets":
        return classify_quartet(parts)
    return {p.index: Decision(False, reason="corpus-not-supported", detail=f"{corpus} parts are read by job C3b") for p in parts}
