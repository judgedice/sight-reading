"""Stage `normalize` (03 section 6.4, job C3a): the whole part, before windows are cut. Pure Python on the read dump.

What is applied here, and what is left to window proposal (C5, which sees the window):
- Applied to the data: grace notes are removed (no time stolen), ornaments are removed and the principal note kept,
  cue notes are removed, lyrics are stripped to the internal `lyricLineEnd` flag, clef changes are not carried, durations
  become ticks at TPQ = 480. Each removal is counted on the measure `tags` (grace-removed, ornament-removed,
  cue-removed) so C5 can copy them onto any window that contains the measure.
- Kept as data for the renderer: dynamics, hairpins, articulations, slurs, ties, breath marks, tuplets.
- Kept as markers: repeats, voltas, segno, coda, D.C./D.S. (`marks`, `barrier`), fermatas (`fermata` on the event), final
  and double barlines. C5 applies "a window may not cross a barrier" and "a fermata only on the last note".
- Recorded as measure `problems` for C5 to reject a window with: chord, second-voice, hidden-note, unpitched,
  microtone, tremolo, non-integer-ticks, gap-or-overlap, mid-measure-time-change, mid-measure-key-change, ossia.
- Tempo text and metronome marks are recorded at piece level (`tempo`) and per measure.
- Measure numbers stay as printed (`number` is the label, e.g. "12a"). `movement` counts where the printed number restarts.
"""

from __future__ import annotations

from collections import Counter
from fractions import Fraction
from typing import Any

TPQ = 480
STEP_SEMIS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
BARRIER_MARKS = {"repeat-start", "repeat-end", "volta", "volta-start", "segno", "coda", "repeat-text", "repeat-expression"}
DOUBLE_BARLINES = {"double", "final", "heavy-heavy"}


def ticks(q: Fraction) -> tuple[int, bool]:
    """(ticks, exact). A non-integer tick count is truncated here and the measure gets `non-integer-ticks`."""
    t = q * TPQ
    return int(t), t.denominator == 1


def midi(step: str, alter: int, octave: int) -> int:
    return (octave + 1) * 12 + STEP_SEMIS[step] + alter


def _main_voice(voices: dict[str, list[dict[str, Any]]]) -> tuple[str | None, bool]:
    """The voice that carries the melody and whether another voice also has notes."""
    with_notes = sorted(v for v, els in voices.items() if any(e["kind"] != "rest" for e in els))
    if with_notes:
        return with_notes[0], len(with_notes) > 1
    if not voices:
        return None, False
    longest = sorted(voices, key=lambda v: (-sum(Fraction(e["ql"]) for e in voices[v]), v))
    return longest[0], False


def normalize_measure(raw: dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    """`state` carries the time signature, key, pending dynamic and hairpin from one measure to the next."""
    problems: list[str] = []
    tags: list[str] = []
    counts = {"grace": 0, "ornament": 0, "cue": 0}
    ts = raw.get("timeSig")
    time_change = key_change = False
    if ts:
        nb, nt = ts["num"], ts["den"]
        if (nb, nt) != (state["beats"], state["beatType"]) and raw["index"] > 0:
            time_change = True
        if (nb, nt) != (state["beats"], state["beatType"]) and Fraction(ts["offset"]) > 0:
            problems.append("mid-measure-time-change")
        state["beats"], state["beatType"] = nb, nt
    ks = raw.get("keySig")
    if ks:
        mode = ks.get("mode")
        if (ks["fifths"], mode) != (state["fifths"], state["mode"]) and raw["index"] > 0:
            key_change = True
        if Fraction(ks["offset"]) > 0 and ks["fifths"] != state["fifths"]:
            problems.append("mid-measure-key-change")
        state["fifths"], state["mode"] = ks["fifths"], mode
    bar_ticks = state["beats"] * TPQ * 4 // state["beatType"]

    voices: dict[str, list[dict[str, Any]]] = {}
    for el in raw["elements"]:
        if el["grace"]:
            counts["grace"] += 1
            continue
        if el.get("cue"):
            counts["cue"] += 1
            continue
        voices.setdefault(el["voice"], []).append(el)
    main, second = _main_voice(voices)
    if second:
        problems.append("second-voice")
    events: list[dict[str, Any]] = []
    for el in sorted(voices.get(main, []) if main is not None else [], key=lambda e: Fraction(e["offset"])):
        tk, ok1 = ticks(Fraction(el["offset"]))
        du, ok2 = ticks(Fraction(el["ql"]))
        if not (ok1 and ok2):
            problems.append("non-integer-ticks")
        ev: dict[str, Any] = {"kind": "rest" if el["kind"] == "rest" else "note", "tick": tk, "dur": du}
        if el["kind"] == "rest":
            if el.get("fullMeasure") or (du == bar_ticks and len(voices.get(main, [])) == 1):
                ev["measureRest"] = True
                if el.get("fullMeasure"):
                    ev["dur"] = bar_ticks
        else:
            if el["kind"] == "chord":
                problems.append("chord")
                ev["chord"] = len(el["pitches"])
            if el["kind"] == "unpitched":
                problems.append("unpitched")
            p = el["pitch"] if "pitch" in el else (el["pitches"][0] if el.get("pitches") else None)
            if p is None:
                ev["step"] = None
            else:
                alter = p["alter"]
                if alter != int(alter) or p.get("microtone"):
                    problems.append("microtone")
                ev["step"], ev["alter"], ev["octave"] = p["step"], int(round(alter)), p["octave"]
                ev["midi"] = midi(p["step"], ev["alter"], p["octave"])
            if el.get("hidden"):
                problems.append("hidden-note")
            for k in ("tieStart", "tieStop"):
                if el.get(k):
                    ev[k] = True
            for k in ("slurStarts", "slurStops"):
                if el.get(k):
                    ev[k] = el[k]
            if el.get("artic"):
                ev["artic"] = el["artic"]
            if el.get("breath"):
                ev["breath"] = True
            if el.get("lyricLineEnd"):
                ev["lyricLineEnd"] = True  # internal boundary signal (6.6), never emitted
            if el.get("ornament"):
                ev["ornamentRemoved"] = True
                counts["ornament"] += 1
            if el.get("tremolo"):
                ev["tremolo"] = True
                problems.append("tremolo")
        if el.get("fermata"):
            ev["fermata"] = True
        if el.get("hairpin"):
            ev["hairpin"] = el["hairpin"]
        if el.get("tuplet"):
            ev["tuplet"] = el["tuplet"]
            if el.get("tupletStart"):
                ev["tupletStart"] = True
            if el.get("tupletStop"):
                ev["tupletStop"] = True
        events.append(ev)
    # contiguity from the bar start. A short pickup or final bar is fine: only gaps and overlaps are problems.
    t = 0
    for ev in events:
        if ev["tick"] != t:
            problems.append("gap-or-overlap")
            break
        t += ev["dur"]
    length = sum(ev["dur"] for ev in events)

    # dynamics attach to the first note at or after their offset (carried over barlines)
    for d in raw.get("dynamics", []):
        state["pending"].append((raw["index"], int(Fraction(d["offset"]) * TPQ), d["value"]))
    still: list[tuple[int, int, str]] = []
    for mi, tk, val in state["pending"]:
        target = next((e for e in events if e["kind"] == "note" and (mi < raw["index"] or e["tick"] >= tk)), None)
        if target is None:
            still.append((mi, tk, val))
        else:
            target["dynamic"] = val
    state["pending"] = still

    if counts["grace"]:
        tags.append("grace-removed")
    if counts["ornament"]:
        tags.append("ornament-removed")
    if counts["cue"]:
        tags.append("cue-removed")
    marks = sorted(set(raw.get("marks", [])))
    rb = raw.get("rightBarline", {}).get("type")
    lb = raw.get("leftBarline", {}).get("type")
    m: dict[str, Any] = {
        "index": raw["index"],
        "number": f"{raw['number']}{raw['suffix']}" if raw["number"] is not None else str(raw["index"] + 1),
        "numeric": raw["number"],
        "implicit": raw["implicit"],
        "beats": state["beats"],
        "beatType": state["beatType"],
        "fifths": state["fifths"],
        "mode": state["mode"],
        "barTicks": bar_ticks,
        "lengthTicks": length,
        "events": events,
        "marks": marks,
        "barrier": bool(BARRIER_MARKS & set(marks)),
        "finalBarline": rb == "final",
        "doubleBarline": rb in DOUBLE_BARLINES,
        "leftBarline": lb,
        "rightBarline": rb,
        "timeChange": time_change,
        "keyChange": key_change,
        "tempo": raw.get("tempo", []),
        "tags": tags,
        "problems": sorted(set(problems)),
        "removed": {k: v for k, v in counts.items() if v},
    }
    return m


def assign_movements(measures: list[dict[str, Any]]) -> None:
    """A new movement starts where the printed bar number restarts (OpenScore numbers each movement from 1, or 0 for an
    anacrusis). Final barlines are not used: repeated sections inside a movement end in them. Same rule as
    tools/fixtures/musicxml.py."""
    movement = 1
    prev: int | None = None
    for m in measures:
        num = m["numeric"]
        suffixed = m["number"] != str(num)
        if num is not None and prev is not None and num <= prev and not (num == prev and suffixed):
            movement += 1
        m["movement"] = movement
        if num is not None:
            prev = num


def normalize_part(raw_part: dict[str, Any]) -> dict[str, Any]:
    state: dict[str, Any] = {"beats": 4, "beatType": 4, "fifths": 0, "mode": None, "pending": []}
    measures = [normalize_measure(r, state) for r in raw_part["measures"]]
    assign_movements(measures)
    tempo = []
    for m in measures:
        for t in m["tempo"]:
            tempo.append({"measure": m["number"], "index": m["index"], "tick": int(Fraction(t["offset"]) * TPQ), "bpm": t["bpm"], "text": t["text"]})
    return {"measures": measures, "tempo": tempo, "tpq": TPQ}


def part_stats(part: dict[str, Any]) -> dict[str, Any]:
    prob: Counter[str] = Counter()
    tags: Counter[str] = Counter()
    notes = 0
    for m in part["measures"]:
        prob.update(m["problems"])
        tags.update(m["tags"])
        notes += sum(1 for e in m["events"] if e["kind"] == "note")
    return {
        "measures": len(part["measures"]),
        "notes": notes,
        "movements": max((m["movement"] for m in part["measures"]), default=0),
        "measuresWithProblems": sum(1 for m in part["measures"] if m["problems"]),
        "problems": dict(sorted(prob.items())),
        "tags": dict(sorted(tags.items())),
    }

