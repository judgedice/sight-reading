"""Review items (job C8, 03 section 6.12): the content hash, the readable form a reviewer sees, and the blind controls.

A review item is everything a reviewer needs to judge one window from the packet alone: key, meter, tempo, the tagged
level and per-feature levels, the source (collection, part and measures, never title or composer) and a bar-by-bar
note list with spelled pitches and note values. Controls are rendered by the same function, so nothing in an item tells
a control from a real window.

Negative controls (03 6.12 R3), all built from real windows of the build:
- `cut-early`: the 8 bars before a window's last bar (the window moved back one bar), so it ends a bar short of its
  cadence;
- `shift-beat`: the window's bars moved one beat later in the source part, re-barred with ties, so every phrase
  boundary falls one beat off the barline and the window ends one beat into the next phrase;
- `pitch-shuffle`: the window's rhythm with its pitches permuted (ties kept), ending off the tonic triad;
- `accompaniment`: a window the filters rejected as accompaniment (quartet inner or cello part subordinate to Vn I,
  broken chords, pedal alternation).
Positive controls are real queue items picked by rule: PAC-ending complete phrases with a high soft score, movement or
section openings first (03's "PAC-ending opening themes"; there are no hymn phrases because Mutopia is not in v1).
Every control is re-tagged with the C6 tagger, so its levels are honest, and a control whose level is above L3 is not
used.
"""

from __future__ import annotations

import copy
import hashlib
import json
import random
from fractions import Fraction
from typing import Any

from .features import TooFewNotes, levels_config, tag_window
from .histogram import MAJOR_NAMES, MINOR_NAMES
from .phrase import tonic_pc

COLLECTIONS = {
    "openscore-lieder": "OpenScore Lieder (19th-century art song)",
    "openscore-quartets": "OpenScore String Quartets",
    "mutopia": "Mutopia Project",
}
ROLE_LABELS = {"voice": "Voice", "vn1": "Violin I", "cello": "Cello"}
INNER_LABELS = {"Vn II": "Violin II", "Va": "Viola"}

DUR_NAMES = {
    2880: "dotted whole",
    1920: "whole",
    1680: "double-dotted half",
    1440: "dotted half",
    960: "half",
    840: "double-dotted quarter",
    720: "dotted quarter",
    480: "quarter",
    420: "double-dotted eighth",
    360: "dotted eighth",
    320: "triplet quarter",
    240: "eighth",
    180: "dotted sixteenth",
    160: "triplet eighth",
    120: "sixteenth",
    90: "dotted 32nd",
    80: "triplet sixteenth",
    60: "32nd",
}
ACC = {-2: "bb", -1: "b", 0: "", 1: "#", 2: "##"}


# --- hashing ----------------------------------------------------------------------------------------------------------


def canonical_content(content: dict[str, Any]) -> dict[str, Any]:
    """The musical content a verdict is about: meter, key, mode, pickup and every event's position, length and spelling."""
    m = content["meter"]
    evs = []
    for meas in content["measures"]:
        for e in meas["events"]:
            if e["kind"] == "note":
                evs.append([e["tick"], e["dur"], e["midi"], e.get("step"), e.get("alter", 0), e.get("octave"), bool(e.get("tieStart"))])
            else:
                evs.append([e["tick"], e["dur"], "r"])
    return {
        "meter": f"{m['beats']}/{m['beatType']}",
        "fifths": content["fifths"],
        "mode": content.get("modal") or content["mode"],
        "pickupTicks": content.get("pickupTicks", 0),
        "bars": [meas["startTick"] for meas in content["measures"]],
        "events": evs,
    }


def content_hash(content: dict[str, Any]) -> str:
    """'sha256:<hex>' of the canonical content. Verdicts are keyed by it (with the prompt version)."""
    body = json.dumps(canonical_content(content), sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(body.encode("utf-8")).hexdigest()


# --- readable form ----------------------------------------------------------------------------------------------------


def pitch_name(e: dict[str, Any]) -> str:
    step, alter, octave = e.get("step"), e.get("alter", 0) or 0, e.get("octave")
    if step is None or octave is None:
        names = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
        return f"{names[e['midi'] % 12]}{e['midi'] // 12 - 1}"
    return f"{step}{ACC[int(alter)]}{octave}"


def dur_name(ticks: int) -> str:
    if ticks in DUR_NAMES:
        return DUR_NAMES[ticks]
    q = Fraction(ticks, 480)
    return f"{q} quarters"


def key_label(fifths: int, mode: str) -> str:
    acc = "no sharps or flats" if fifths == 0 else f"{abs(fifths)} {'sharp' if fifths > 0 else 'flat'}{'s' if abs(fifths) > 1 else ''}"
    if mode == "major":
        name = MAJOR_NAMES[fifths + 7] + " major"
    elif mode in ("minor", "aeolian"):
        name = MINOR_NAMES[fifths + 7][:-1] + " minor"
    else:
        names = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
        name = f"{names[tonic_pc(fifths, mode)]} {mode}"
    return f"{name} ({acc})"


def bar_lines(content: dict[str, Any]) -> list[dict[str, Any]]:
    """[{bar, notes}] with bar 'pickup' for an anacrusis, then 1..n; notes as 'Bb3 quarter', 'rest half', '~' for a tie."""
    out = []
    n = 0
    for meas in content["measures"]:
        if meas.get("isPickup"):
            label: Any = "pickup"
        else:
            n += 1
            label = n
        toks = []
        for e in meas["events"]:
            if e["kind"] == "note":
                t = f"{pitch_name(e)} {dur_name(e['dur'])}"
                if e.get("tieStart"):
                    t += " ~tied to next"
            else:
                t = f"rest {dur_name(e['dur'])}"
            toks.append(t)
        out.append({"bar": label, "notes": ", ".join(toks)})
    return out


def served_tempo(level: int) -> dict[str, float]:
    for lv in levels_config():
        if lv["level"] == level:
            return {"minBpm": lv["tempo"]["minBpm"], "maxBpm": lv["tempo"]["maxBpm"]}
    raise KeyError(level)


def part_label(meta: dict[str, Any]) -> str:
    role = meta.get("role")
    if role == "inner":
        return INNER_LABELS.get(meta.get("roleLabel") or "", "Violin II or Viola")
    return ROLE_LABELS.get(role or "", meta.get("roleLabel") or "unknown part")


def render_item(item_id: str, content: dict[str, Any], meta: dict[str, Any]) -> dict[str, Any]:
    """One packet item. `meta`: corpus, role, roleLabel, sourceMeasures, level, featureLevels, augmented."""
    m = content["meter"]
    notes = [e for meas in content["measures"] for e in meas["events"] if e["kind"] == "note"]
    lo = min(notes, key=lambda e: e["midi"])
    hi = max(notes, key=lambda e: e["midi"])
    tempo = content.get("tempoAtStart") or {}
    sm = meta.get("sourceMeasures") or []
    beat = m["countUnitTicks"]
    pickup = content.get("pickupTicks", 0)
    return {
        "itemId": item_id,
        "key": key_label(content["fifths"], content.get("modal") or content["mode"]),
        "meter": f"{m['beats']}/{m['beatType']}",
        "bars": sum(1 for meas in content["measures"] if not meas.get("isPickup")),
        "pickup": f"{Fraction(pickup, beat)} beat(s)" if pickup else None,
        "tempo": {"marking": tempo.get("text"), "markingBpm": tempo.get("bpm"), "servedBpm": served_tempo(meta["level"])},
        "taggedLevel": meta["level"],
        "featureLevels": dict(sorted(meta["featureLevels"].items())),
        "source": {
            "collection": COLLECTIONS.get(meta["corpus"], meta["corpus"]),
            "part": part_label(meta),
            "measures": f"{sm[0]}-{sm[-1]}" if sm else None,
            "noteValuesDoubled": bool(meta.get("augmented")),
        },
        "range": f"{pitch_name(lo)} to {pitch_name(hi)}",
        "notes": bar_lines(content),
    }


# --- controls ---------------------------------------------------------------------------------------------------------


class ControlError(ValueError):
    pass


def _seed(*parts: str) -> random.Random:
    return random.Random(int(hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()[:16], 16))


NOTE_KEYS = ("kind", "midi", "step", "alter", "octave")


def _flatten(part: dict[str, Any], first: int, last: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Events of part measures first..last (inclusive) on one absolute timeline, after checks that the range is one
    movement, one meter and one key, with no problems and no tuplets."""
    ms = part["measures"]
    if first < 0 or last >= len(ms):
        raise ControlError("range outside the part")
    sel = ms[first : last + 1]
    m0 = sel[0]
    out: list[dict[str, Any]] = []
    t = 0
    for m in sel:
        if (m["movement"], m["beats"], m["beatType"], m["fifths"]) != (m0["movement"], m0["beats"], m0["beatType"], m0["fifths"]):
            raise ControlError("meter, key or movement changes")
        if m["problems"] or m["lengthTicks"] != m["barTicks"]:
            raise ControlError("measure problems or an incomplete bar")
        for e in m["events"]:
            if e.get("tuplet"):
                raise ControlError("tuplet")
            ev = {k: e[k] for k in NOTE_KEYS if k in e}
            ev.update(tick=t + e["tick"], dur=e["dur"])
            if e.get("tieStart"):
                ev["tieStart"] = True
            out.append(ev)
        t += m["lengthTicks"]
    return out, sel


def _rebar(events: list[dict[str, Any]], start: int, bars: int, bar_ticks: int, sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Cut [start, start + bars * bar_ticks) from an absolute event list into full bars, splitting notes at barlines
    with ties. Ticks are from the excerpt start."""
    end = start + bars * bar_ticks
    clipped = []
    for e in events:
        a, b = max(e["tick"], start), min(e["tick"] + e["dur"], end)
        if b <= a:
            continue
        ev = dict(e, tick=a - start, dur=b - a)
        if e["tick"] + e["dur"] > end:
            ev.pop("tieStart", None)
        clipped.append(ev)
    measures = []
    for i in range(bars):
        lo, hi = i * bar_ticks, (i + 1) * bar_ticks
        evs = []
        for e in clipped:
            a, b = max(e["tick"], lo), min(e["tick"] + e["dur"], hi)
            if b <= a:
                continue
            ev = dict(e, tick=a, dur=b - a)
            if e["kind"] == "note" and e["tick"] + e["dur"] > hi:
                ev["tieStart"] = True
            evs.append(ev)
        if sum(e["dur"] for e in evs) != bar_ticks:
            raise ControlError("a bar is not full")
        src = sources[min(i, len(sources) - 1)]
        measures.append({"index": i, "isPickup": False, "startTick": lo, "source": {"index": src["index"], "number": src["number"]}, "events": evs})
    return measures


def _content_from(base: dict[str, Any], measures: list[dict[str, Any]]) -> dict[str, Any]:
    c = {k: copy.deepcopy(v) for k, v in base.items() if k not in ("measures", "cadence")}
    c.update(measures=measures, pickupTicks=0, bars=len(measures), lengthTicks=sum(sum(e["dur"] for e in m["events"]) for m in measures), cadence=None, tags=[])
    return c


def _bar_ticks(content: dict[str, Any]) -> int:
    m = content["meter"]
    return m["beats"] * (480 * 4 // m["beatType"])


def cut_early(content: dict[str, Any], rec: dict[str, Any], part: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """The same number of bars, one bar earlier in the part: it ends a bar before the window's cadence."""
    if content.get("pickupTicks"):
        raise ControlError("pickup")
    first, last = rec["firstMeasure"], rec["lastMeasure"]
    events, sel = _flatten(part, first - 1, last - 1)
    bt = _bar_ticks(content)
    measures = _rebar(events, 0, last - first + 1, bt, sel)
    return _content_from(content, measures), [sel[0]["number"], sel[-1]["number"]]


def shift_beat(content: dict[str, Any], rec: dict[str, Any], part: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """The same number of bars, one beat later in the part, re-barred."""
    if content.get("pickupTicks"):
        raise ControlError("pickup")
    first, last = rec["firstMeasure"], rec["lastMeasure"]
    events, sel = _flatten(part, first, last + 1)
    bt = _bar_ticks(content)
    beat = content["meter"]["countUnitTicks"]
    if not any(e["kind"] == "note" and e["tick"] >= (last - first + 1) * bt for e in events):
        raise ControlError("no notes in the bar after the window")
    measures = _rebar(events, beat, last - first + 1, bt, sel)
    return _content_from(content, measures), [sel[0]["number"], sel[-2]["number"]]


def pitch_shuffle(content: dict[str, Any], rec_id: str) -> dict[str, Any]:
    """The window's rhythm with its notes' pitches permuted (tie chains keep one pitch). The last note is moved off
    the tonic triad, and at least 60% of the chains change pitch."""
    c = copy.deepcopy(content)
    chains: list[list[dict[str, Any]]] = []
    cont = False
    for m in c["measures"]:
        for e in m["events"]:
            if e["kind"] != "note":
                cont = False
                continue
            if cont and chains:
                chains[-1].append(e)
            else:
                chains.append([e])
            cont = bool(e.get("tieStart"))
    if len(chains) < 6:
        raise ControlError("too few notes")
    pitches: list[dict[str, Any]] = [{k: ch[0].get(k) for k in ("midi", "step", "alter", "octave")} for ch in chains]
    mode = c.get("modal") or c["mode"]
    t = tonic_pc(c["fifths"], mode)
    triad = {t, (t + (4 if mode == "major" else 3)) % 12, (t + 7) % 12}
    rng = _seed("pitch-shuffle", rec_id)
    for _ in range(200):
        perm = pitches[:]
        rng.shuffle(perm)
        changed = sum(1 for a, b in zip(perm, pitches) if a["midi"] != b["midi"])
        if perm[-1]["midi"] % 12 not in triad and changed >= 0.6 * len(chains):
            break
    else:
        raise ControlError("no permutation ends off the tonic triad")
    for ch, p in zip(chains, perm):
        for e in ch:
            e.update({k: v for k, v in p.items() if v is not None})
    c["cadence"] = None
    return c


def retag(content: dict[str, Any]) -> dict[str, Any]:
    """C6 levels for a control's content. Raises ControlError when the window has too few notes."""
    try:
        t = tag_window(content)
    except TooFewNotes as e:
        raise ControlError(str(e)) from e
    return {"level": t["level"], "featureLevels": t["featureLevels"]}


__all__ = [
    "ControlError",
    "bar_lines",
    "canonical_content",
    "content_hash",
    "cut_early",
    "dur_name",
    "key_label",
    "pitch_name",
    "pitch_shuffle",
    "render_item",
    "retag",
    "shift_beat",
]
