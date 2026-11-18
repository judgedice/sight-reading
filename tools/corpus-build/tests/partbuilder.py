"""Build normalized parts (the `normalize` stage's measure format, README 'Read, normalize, extract') from a compact text
notation, for the window and augmentation tests.

A bar is a space-separated list of tokens `<pitch>:<dur><flags>`:
- pitch: `C4`, `F#4`, `Bb3`, or `r` for a rest;
- dur: `w h q e s` with an optional `.` (dotted), or a tick count such as `720`;
- flags: `~` tie start (the next note of the same pitch gets tieStop), `!` fermata, `^` breath, `;` lyricLineEnd,
  `(` slur start, `)` slur stop, `t` triplet member (`[` / `]` mark the group's start and stop), `*` chord.
"""

from __future__ import annotations

import re
from typing import Any

DUR = {"w": 1920, "h": 960, "q": 480, "e": 240, "s": 120}
STEP = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
TOKEN = re.compile(r"^(r|[A-G](?:#|b|##|bb)?-?\d):(\d+|[whqes]\.?)([~!^;()t\[\]*]*)$")


def _dur(s: str) -> int:
    if s.isdigit():
        return int(s)
    d = DUR[s[0]]
    return d * 3 // 2 if s.endswith(".") else d


def _pitch(s: str) -> dict[str, Any]:
    m = re.match(r"^([A-G])(#|b|##|bb)?(-?\d)$", s)
    assert m, s
    step, acc, octave = m.group(1), m.group(2) or "", int(m.group(3))
    alter = {"": 0, "#": 1, "b": -1, "##": 2, "bb": -2}[acc]
    return {"step": step, "alter": alter, "octave": octave, "midi": (octave + 1) * 12 + STEP[step] + alter}


def bar(text: str, **kw: Any) -> dict[str, Any]:
    return {"text": text, **kw}


def part(bars: list[dict[str, Any] | str], beats: int = 4, beat_type: int = 4, fifths: int = 0) -> dict[str, Any]:
    """bars: strings or `bar(text, **overrides)`. Overrides may set beats, beatType, fifths, movement, marks, tempo,
    problems, finalBarline, doubleBarline, implicit, number, leftBarline."""
    measures = []
    state = {"beats": beats, "beatType": beat_type, "fifths": fifths, "movement": 1}
    prev_tie: dict[str, Any] | None = None
    for i, b in enumerate(bars):
        spec = b if isinstance(b, dict) else {"text": b}
        for k in ("beats", "beatType", "fifths", "movement"):
            if k in spec:
                state[k] = spec[k]
        bt = state["beats"] * (1920 // state["beatType"])
        events = []
        t = 0
        problems = set(spec.get("problems", []))
        for tok in spec["text"].split():
            m = TOKEN.match(tok)
            assert m, tok
            p, d, flags = m.group(1), _dur(m.group(2)), m.group(3)
            if p == "r":
                ev: dict[str, Any] = {"kind": "rest", "tick": t, "dur": d}
                prev_tie = None
            else:
                ev = {"kind": "note", "tick": t, "dur": d, **_pitch(p)}
                if prev_tie is not None and prev_tie["midi"] == ev["midi"]:
                    ev["tieStop"] = True
                prev_tie = None
                if "~" in flags:
                    ev["tieStart"] = True
                    prev_tie = ev
                if "^" in flags:
                    ev["breath"] = True
                if ";" in flags:
                    ev["lyricLineEnd"] = True
                if "(" in flags:
                    ev["slurStarts"] = 1
                if ")" in flags:
                    ev["slurStops"] = 1
                if "*" in flags:
                    ev["chord"] = 2
                    problems.add("chord")
            if "!" in flags:
                ev["fermata"] = True
            if "t" in flags or "[" in flags or "]" in flags:
                ev["tuplet"] = [3, 2]
                if "[" in flags:
                    ev["tupletStart"] = True
                if "]" in flags:
                    ev["tupletStop"] = True
            events.append(ev)
            t += d
        num = spec.get("number", str(i + 1))
        measures.append({
            "index": i, "number": num, "numeric": int(re.sub(r"\D.*$", "", num) or 0), "implicit": spec.get("implicit", False),
            "beats": state["beats"], "beatType": state["beatType"], "fifths": state["fifths"], "mode": None, "barTicks": bt, "lengthTicks": t,
            "events": events, "marks": sorted(spec.get("marks", [])), "barrier": False, "finalBarline": spec.get("finalBarline", False),
            "doubleBarline": spec.get("doubleBarline", spec.get("finalBarline", False)), "leftBarline": spec.get("leftBarline"),
            "rightBarline": None, "timeChange": spec.get("timeChange", False), "keyChange": spec.get("keyChange", False),
            "tempo": spec.get("tempo", []), "tags": sorted(spec.get("tags", [])), "problems": sorted(problems), "removed": {},
            "movement": state["movement"],
        })
    return {"measures": measures, "tempo": [], "tpq": 480}
