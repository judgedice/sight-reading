"""Shared logic for the P0e fixture extractor: window checks, ExcerptDoc construction, features and level tags.

Stdlib only. Run the entry scripts (`scan.py`, `extract.py`, `expected.py`) with `python3 -I`; they import this
module from the same folder. Everything here is deterministic: no clocks, no randomness, sorted keys on output.

The feature and level rules follow 02 §2.2 to §2.5 and 03 §6.6 to §6.9 as far as a fixture build needs them. The
level tagger mirrors the reference tagger in `fixtures/levels/feature-vectors.test.ts` (it reads only
`config/levels.json` and `config/measurement-budget.json`). It is a fixture-grade tagger: the authoritative
taggers are G2 (TypeScript) and C6 (Python pipeline), which must reproduce `fixtures/levels/feature-vectors.json`.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import unicodedata
from dataclasses import dataclass
from fractions import Fraction

import musicxml as mx

TPQ = 480
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
STEPS = "CDEFGAB"
STEP_SEMIS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
SHARP_ORDER = "FCGDAEB"

CORPORA = {
    "openscore-lieder": {
        "repo": "OpenScore/Lieder",
        "url": "https://github.com/OpenScore/Lieder",
        "encoder": "OpenScore Lieder contributors",
        "name": "OpenScore Lieder",
    },
    "openscore-quartets": {
        "repo": "OpenScore/StringQuartets",
        "url": "https://github.com/OpenScore/StringQuartets",
        "encoder": "OpenScore String Quartets contributors",
        "name": "OpenScore String Quartets",
    },
}
CC0_URL = "https://creativecommons.org/publicdomain/zero/1.0/"
PD_CUTOFF_DEATH = 1931  # PLAN ruling 28: composer died before 1931


def load_json(rel: str):
    with open(os.path.join(REPO, rel), encoding="utf-8") as f:
        return json.load(f)


LEVELS = load_json("config/levels.json")["levels"]
BUDGET = load_json("config/measurement-budget.json")


# ----------------------------------------------------------------------------------------------
# Pitch and key helpers
# ----------------------------------------------------------------------------------------------


def midi_of(step: str, alter: int, octave: int) -> int:
    return (octave + 1) * 12 + STEP_SEMIS[step] + alter


def pitch_midi(p: dict) -> int:
    return midi_of(p["step"], p["alter"], p["octave"])


def key_alter(fifths: int, step: str) -> int:
    """Alteration the key signature applies to a letter."""
    if fifths > 0:
        return 1 if step in SHARP_ORDER[:fifths] else 0
    if fifths < 0:
        return -1 if step in SHARP_ORDER[::-1][: -fifths] else 0
    return 0


def major_tonic(fifths: int) -> tuple[str, int]:
    """Spelled major tonic for a signature (-7..7)."""
    idx = (fifths * 4) % 7  # C=0, G=4 (C D E F G), ...
    step = STEPS[idx]
    return step, key_alter(fifths, step)


def tonic_of(fifths: int, mode: str) -> tuple[str, int]:
    if mode == "major":
        return major_tonic(fifths)
    step = STEPS[(STEPS.index(major_tonic(fifths)[0]) + 5) % 7]
    return step, key_alter(fifths, step)


def tonic_pc(fifths: int, mode: str) -> int:
    s, a = tonic_of(fifths, mode)
    return (STEP_SEMIS[s] + a) % 12


def scale_pcs(fifths: int) -> set[int]:
    return {(STEP_SEMIS[s] + key_alter(fifths, s)) % 12 for s in STEPS}


def degree_of(pc: int, fifths: int, mode: str) -> int | None:
    """Scale degree 1..7 of a pitch class in the key (diatonic or raised 6/7 in minor), else None."""
    t = tonic_pc(fifths, mode)
    rel = (pc - t) % 12
    table = {0: 1, 2: 2, 4: 3, 5: 4, 7: 5, 9: 6, 11: 7} if mode == "major" else {0: 1, 2: 2, 3: 3, 5: 4, 7: 5, 8: 6, 9: 6, 10: 7, 11: 7}
    return table.get(rel)


# ----------------------------------------------------------------------------------------------
# Meter (02 conventions; mirrors src/core/time.ts makeMeter)
# ----------------------------------------------------------------------------------------------


def make_meter(beats: int, beat_type: int) -> dict:
    unit = TPQ * 4 // beat_type
    if beat_type == 8 and beats >= 6 and beats % 3 == 0:
        return {"beats": beats, "beatType": beat_type, "countUnitTicks": unit * 3, "countsPerBar": beats // 3}
    return {"beats": beats, "beatType": beat_type, "countUnitTicks": unit, "countsPerBar": beats}


def bar_ticks(meter: dict) -> int:
    return meter["countUnitTicks"] * meter["countsPerBar"]


def meter_str(meter: dict) -> str:
    return f"{meter['beats']}/{meter['beatType']}"


def compound(meter: dict) -> bool:
    return meter["beatType"] == 8 and meter["beats"] >= 6 and meter["beats"] % 3 == 0


def strong_positions(meter: dict) -> set[int]:
    """Strong-beat positions for window ends (03 §6.6, 02 H2): beat 1, beat 3 in 4/4, beat 4 in 6/8."""
    s = {0}
    m = meter_str(meter)
    if m == "4/4":
        s.add(960)
    if m == "6/8":
        s.add(720)
    return s


# ----------------------------------------------------------------------------------------------
# Tempo (03 §6.4: tempo text and metronome recorded at piece level)
# ----------------------------------------------------------------------------------------------

# Quarter-note bpm ranges for common tempo words. A fixture-grade table; the pipeline's C4 owns the real one.
TEMPO_WORDS = [
    ("grave", 40, 50), ("largo", 44, 60), ("larghetto", 56, 72), ("lento", 50, 64), ("adagio", 56, 76),
    ("andantino", 72, 96), ("andante", 66, 92), ("moderato", 84, 112), ("allegretto", 100, 126),
    ("allegro", 116, 152), ("vivace", 132, 168), ("presto", 160, 200), ("sehr langsam", 44, 60),
    ("langsam", 50, 72), ("mässig", 72, 100), ("mäßig", 72, 100), ("massig", 72, 100), ("bewegt", 96, 126),
    ("lebhaft", 112, 144), ("schnell", 132, 168), ("lent", 50, 70), ("modéré", 80, 108),
    ("animé", 108, 140), ("tempo di minuetto", 100, 126), ("minuetto", 100, 126), ("menuetto", 100, 126),
    ("scherzo", 132, 168),
]
TEMPO_CHANGE_RE = re.compile(r"\b(rit|ritard|rall|accel|stringendo|a tempo|tempo i|tempo primo|più mosso|meno mosso|langsamer|schneller|zurückhalten|ritenuto|cédez|retenu)", re.I)


def tempo_word(text: str) -> tuple[str, int, int] | None:
    low = text.lower()
    best = None
    for word, lo, hi in TEMPO_WORDS:
        i = low.find(word)
        if i >= 0 and (best is None or i < best[0] or (i == best[0] and len(word) > len(best[1]))):
            best = (i, word, lo, hi)
    return None if best is None else (best[1], best[2], best[3])


# ----------------------------------------------------------------------------------------------
# Window validation (03 §6.4 to §6.7, simplified to what a fixture needs; every rejection has a reason)
# ----------------------------------------------------------------------------------------------


@dataclass
class Window:
    part: mx.PartData
    pickup_mi: int | None  # measure index of the source bar the pickup comes from
    pickup_from: int  # event index inside that bar where the pickup starts
    first_mi: int  # first full bar
    n_bars: int


def movement_bounds(part: mx.PartData) -> dict[int, tuple[int, int]]:
    out: dict[int, tuple[int, int]] = {}
    for m in part.measures:
        lo, hi = out.get(m.movement, (m.index, m.index))
        out[m.movement] = (min(lo, m.index), max(hi, m.index))
    return out


def section_mode(part: mx.PartData, mi: int, others: list[mx.PartData] | None = None) -> str | None:
    """Major or minor from the signature plus the final (03 §6.6); None = modal or unknown.

    The final is taken over the key section holding bar `mi`: the run of bars in the same movement with the same
    signature. MusicXML `<mode>` is ignored (notation software writes "major" by default). The part's own last
    note in the section is used; if it is neither tonic (a Lieder voice often ends on the 3rd or 5th while the piano
    closes), the last note of the lowest other part in the same bars decides."""
    ms = part.measures
    fifths, mv = ms[mi].fifths, ms[mi].movement
    lo = mi
    while lo > 0 and ms[lo - 1].fifths == fifths and ms[lo - 1].movement == mv:
        lo -= 1
    hi = mi
    while hi + 1 < len(ms) and ms[hi + 1].fifths == fifths and ms[hi + 1].movement == mv:
        hi += 1
    cands = [part] + [p for p in reversed(others or []) if p is not part]
    for p in cands:
        if len(p.measures) != len(ms):
            continue
        r = _final_mode(p.measures[lo : hi + 1], fifths)
        if r is not None:
            return r
    return None


def _final_mode(ms: list[mx.MeasureData], fifths: int) -> str | None:
    for m in reversed(ms):
        notes = [e for e in m.events if e.kind == "note"]
        if notes:
            pc = notes[-1].midi() % 12
            if pc == tonic_pc(fifths, "major"):
                return "major"
            if pc == tonic_pc(fifths, "minor"):
                return "minor"
            return None
    return None


def window_measures(w: Window) -> list[mx.MeasureData]:
    return w.part.measures[w.first_mi : w.first_mi + w.n_bars]


def check_window(w: Window, corpus: str) -> str | None:
    """Return a rejection reason, or None if the window passes the fixture hard rules."""
    ms = window_measures(w)
    if len(ms) < w.n_bars:
        return "past-end"
    first = ms[0]
    pick = w.part.measures[w.pickup_mi] if w.pickup_mi is not None else None
    allm = ([pick] if pick else []) + ms
    for m in allm:
        if m.problems:
            return "measure-problem:" + m.problems[0]
        if m.repeat_or_volta:
            return "repeat-or-volta"
        if (m.beats, m.beat_type, m.fifths) != (first.beats, first.beat_type, first.fifths):
            return "meter-or-key-change"
        if len(set(m.clefs)) != 1 or m.clefs[0] != first.clefs[0]:
            return "clef-change"
        if m.movement != first.movement:
            return "crosses-movement"
    for m in ms[1:]:
        for t in m.tempo_words:
            if tempo_word(t) or TEMPO_CHANGE_RE.search(t):
                return "tempo-change"
        if m.metronome is not None:
            return "tempo-change"
    for m in ms:
        if m.implicit or m.length() != m.bar_ticks():
            return "incomplete-bar"
    for m in ms[:-1]:
        if m.final_barline:
            return "crosses-final-barline"
    evs = window_events(w)
    if evs is None:
        return "bad-final-bar"
    notes = [e for e in evs if e.kind == "note"]
    if not notes:
        return "no-notes"
    for e in notes:
        if e.ornament or e.tremolo:
            return "ornament-or-tremolo"
        if e.fermata and e is not notes[-1]:
            return "interior-fermata"
        if e.tuplet is not None and e.tuplet != (3, 2):
            return "non-triplet-tuplet"
    if notes[0].tie_stop:
        return "starts-inside-tie"
    if notes[-1].tie_start:
        return "ends-inside-tie"
    for a, b in zip(notes, notes[1:]):
        if a.tie_start and (not b.tie_stop or a.midi() != b.midi()):
            return "bad-tie"
        if b.tie_stop and not a.tie_start:
            return "bad-tie"
    depth = 0
    for e in notes:
        depth -= e.slur_stops
        if depth < 0:
            return "starts-inside-slur"
        depth += e.slur_starts
        if depth > 1:
            return "nested-slur"
    if depth != 0:
        return "ends-inside-slur"
    # tuplet groups must be whole inside the window (bars are whole, so only check per bar)
    for m in allm:
        run = 0
        for e in m.events:
            if e.tuplet:
                run += e.dur
            elif run:
                if run % 480:
                    return "cut-tuplet"
                run = 0
        if run % 480:
            return "cut-tuplet"
    return None


def window_events(w: Window) -> list[mx.Event] | None:
    """Events of the window in order (pickup tail, then full bars), or None if the final bar cannot end."""
    out: list[mx.Event] = []
    if w.pickup_mi is not None:
        out.extend(w.part.measures[w.pickup_mi].events[w.pickup_from :])
    for m in window_measures(w):
        out.extend(m.events)
    return out


def end_info(w: Window, mode: str) -> dict | None:
    """Analyse the window end (03 §6.6 allowed ends). Returns None if the end is not allowed."""
    ms = window_measures(w)
    last = ms[-1]
    evs = last.events
    note_idx = [i for i, e in enumerate(evs) if e.kind == "note"]
    if not note_idx:
        return None
    # The cadence note: the last note before any trailing rest run that ends the phrase. Notes after it in the
    # bar must be preceded by a rest (the next phrase's pickup) and are replaced by rests (H11).
    cand = None
    for i in note_idx:
        later = evs[i + 1 :]
        if all(e.kind == "rest" for e in later):
            cand = i
            break
        if later and later[0].kind == "rest":
            cand = i
            break
    if cand is None:
        return None
    e = evs[cand]
    meter = make_meter(last.beats, last.beat_type)
    if e.tick not in strong_positions(meter):
        return None
    if e.tie_start or e.tie_stop:
        return None
    after = evs[cand + 1 :]
    nxt_rest = bool(after) and after[0].kind == "rest"
    if not after:
        nm = w.part.measures[last.index + 1] if last.index + 1 < len(w.part.measures) else None
        nxt_rest = nm is None or (bool(nm.events) and nm.events[0].kind == "rest")
    followed = nxt_rest or last.final_barline or last.double_barline or e.lyric_line_end
    if not followed:
        return None
    if e.dur < meter["countUnitTicks"] and not nxt_rest:
        return None
    deg = degree_of(e.midi() % 12, last.fifths, mode)
    if deg not in (1, 3, 5, 2):
        return None
    if deg in (5, 2) and not (e.dur >= 2 * meter["countUnitTicks"] and nxt_rest):
        return None
    completed = any(x.kind == "note" for x in after)
    return {"cadence_idx": cand, "degree": deg, "completed": completed}


def start_ok(part: mx.PartData, mi: int, bounds: dict[int, tuple[int, int]]) -> list[tuple[int | None, int]]:
    """Allowed starts at full bar `mi` (03 §6.6): returns [(pickup_mi, pickup_from_event_idx)] options."""
    m = part.measures[mi]
    out: list[tuple[int | None, int]] = []
    lo, _ = bounds[m.movement]
    prev = part.measures[mi - 1] if mi > 0 else None
    unit = make_meter(m.beats, m.beat_type)["countUnitTicks"]
    section_start = mi == lo or (prev is not None and (prev.double_barline or prev.final_barline))
    if prev is not None and prev.implicit and prev.movement == m.movement and prev.index == lo:
        # source anacrusis bar at the movement start
        notes_at = [i for i, e in enumerate(prev.events) if e.kind == "note"]
        if notes_at:
            first = notes_at[0]
            if all(e.kind == "note" for e in prev.events[first:]):
                out.append((prev.index, first))
        return out
    if m.events and m.events[0].kind == "note" and not m.events[0].tie_stop:
        if section_start or (prev is not None and prev.events and prev.events[-1].kind == "rest" and prev.events[-1].dur >= unit):
            out.append((None, 0))
    if m.events and m.events[0].kind == "note" and prev is not None and prev.movement == m.movement and not prev.implicit:
        # pickup of at most 2 beats after a rest of at least 1 beat, inside the previous bar
        evs = prev.events
        j = len(evs)
        while j > 0 and evs[j - 1].kind == "note":
            j -= 1
        tail = evs[j:]
        if tail and j > 0 and sum(e.dur for e in tail) <= 2 * unit and evs[j - 1].dur >= unit and not tail[0].tie_stop:
            out.append((prev.index, j))
    return out


# ----------------------------------------------------------------------------------------------
# ExcerptDoc construction
# ----------------------------------------------------------------------------------------------


def slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def split_rest(start: int, length: int, unit: int) -> list[tuple[int, int]]:
    """Split a rest span into beat-aligned pieces: up to the next beat, then whole beats."""
    out = []
    t = start
    end = start + length
    while t < end:
        nxt = min(end, (t // unit + 1) * unit)
        out.append((t, nxt - t))
        t = nxt
    return out


def build_doc(w: Window, meta: dict, mode: str) -> dict:
    """Build an ExcerptDoc (01 §6.1, 03 §8) from a validated window. `meta` carries source fields."""
    ms = window_measures(w)
    first = ms[0]
    meter = make_meter(first.beats, first.beat_type)
    bt = bar_ticks(meter)
    fifths = first.fifths
    ei = end_info(w, mode)
    assert ei is not None
    modifications = ["excerpted"]
    measures_out = []
    ev_id = 0
    tup_id = 0
    tick0 = 0
    src_bars: list[tuple[int | None, list[mx.Event], int]] = []  # (pickup?, events, bar offset in source bar)
    pickup_ticks = 0
    if w.pickup_mi is not None:
        pm = w.part.measures[w.pickup_mi]
        evs = pm.events[w.pickup_from :]
        pickup_ticks = sum(e.dur for e in evs)
        src_bars.append((1, evs, pm.length() - pickup_ticks))
    for k, m in enumerate(ms):
        evs = list(m.events)
        if k == len(ms) - 1:
            evs = evs[: ei["cadence_idx"] + 1]
            tail_start = evs[-1].tick + evs[-1].dur
            rest_evs = []
            for t, d in split_rest(tail_start, bt - tail_start, meter["countUnitTicks"]):
                rest_evs.append(mx.Event(kind="rest", tick=t, dur=d))
            # merge source trailing rests back if they were already rests (keep source rests when no completion)
            if ei["completed"]:
                modifications.append("final-bar-completed")
                evs = evs + rest_evs
            else:
                evs = list(m.events)
        src_bars.append((None, evs, 0))
    any_lyric = False
    grace = sum(m.grace_removed for m in ms) + (w.part.measures[w.pickup_mi].grace_removed if w.pickup_mi is not None else 0)
    fermata = False
    in_tuplet = False
    for idx, (is_pick, evs, _off) in enumerate(src_bars):
        events_out = []
        start_tick = tick0
        for e in evs:
            ev_id += 1
            rel = e.tick - evs[0].tick if is_pick else e.tick
            d: dict = {"id": f"e{ev_id}", "kind": e.kind, "tick": start_tick + rel, "dur": e.dur}
            if e.tuplet:
                if e.tuplet_start or not in_tuplet:
                    tup_id += 1
                in_tuplet = True
                d["tuplet"] = {"actual": e.tuplet[0], "normal": e.tuplet[1], "groupId": f"t{tup_id}"}
                if e.tuplet_stop:
                    in_tuplet = False
            else:
                in_tuplet = False
            if e.kind == "note":
                d["pitch"] = {"step": e.step, "alter": e.alter, "octave": e.octave}
                if e.tie_start:
                    d["tieStart"] = True
                if e.tie_stop:
                    d["tieStop"] = True
                if e.slur_starts and e.slur_stops:
                    d["slur"] = "continue"
                elif e.slur_starts:
                    d["slur"] = "start"
                elif e.slur_stops:
                    d["slur"] = "stop"
                if e.artic:
                    d["artic"] = list(e.artic)
                if e.dynamic in ("pp", "p", "mp", "mf", "f", "ff", "fp", "sfz"):
                    d["dynamic"] = e.dynamic
                if e.hairpin:
                    d["hairpin"] = e.hairpin
                if e.breath:
                    d["breath"] = True
                any_lyric = any_lyric or e.lyric
                fermata = fermata or e.fermata
            events_out.append(d)
        length = pickup_ticks if is_pick else bt
        measures_out.append({"index": idx, "isPickup": bool(is_pick), "startTick": start_tick, "events": events_out})
        tick0 += length
    if grace:
        modifications.append("grace-removed")
    if fermata:
        modifications.append("fermata-removed")
    if any_lyric:
        modifications.append("lyrics-removed")
    order = ["excerpted", "grace-removed", "ornament-removed", "fermata-removed", "lyrics-removed", "rhythm-augmented-x2", "final-bar-completed"]
    modifications = sorted(set(modifications), key=order.index)

    doc: dict = {
        "schemaVersion": 1,
        "id": meta["id"],
        "source": meta["source"],
        "meter": meter,
        "keyConcert": {"fifths": fifths, "mode": mode},
        "modal": None,
        "tempo": meta["tempo"],
        "pickupTicks": pickup_ticks,
        "measures": measures_out,
    }
    analysis = analyse(doc)
    doc.update(analysis)
    doc["cadenceEnd"] = cadence_label(doc)
    doc["familiarity"] = 0
    doc["flags"] = flags_for(doc)
    doc["tags"] = sorted(set(meta["tags"]) | set(coverage_tags(doc)))
    doc["dedupeGroup"] = "fp-" + hashlib.sha256(json.dumps(fingerprint(doc)).encode()).hexdigest()[:8]
    doc["work"] = meta["work"]
    doc["modifications"] = modifications
    doc["quality"] = {"interest": round(interest(doc), 4)}
    doc["review"] = {"rules": "p0e-fixture-1.0.0", "llm": "not-required", "llmVerdicts": [], "promptVersion": "none"}
    doc["contentHash"] = content_hash(doc)
    return doc


def normalize_numbers(obj):
    """Integral floats become ints, so the JSON text (and the content hash) is the same in Python and JavaScript."""
    if isinstance(obj, float) and obj.is_integer():
        return int(obj)
    if isinstance(obj, dict):
        return {k: normalize_numbers(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [normalize_numbers(v) for v in obj]
    return obj


def content_hash(doc: dict) -> str:
    body = normalize_numbers({k: v for k, v in doc.items() if k not in ("contentHash", "review")})
    return "sha256:" + hashlib.sha256(canonical(body).encode("utf-8")).hexdigest()


def canonical(obj) -> str:
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


# ----------------------------------------------------------------------------------------------
# Analysis: note chains, features, cells, levels
# ----------------------------------------------------------------------------------------------


def all_events(doc: dict) -> list[dict]:
    return [e for m in doc["measures"] for e in m["events"]]


def chains(doc: dict) -> list[dict]:
    """Tie chains as score notes: {ids, tick, dur, midi, pitch, first, last}."""
    out: list[dict] = []
    cur = None
    for e in all_events(doc):
        if e["kind"] != "note":
            continue
        if cur is not None and e.get("tieStop"):
            cur["ids"].append(e["id"])
            cur["dur"] += e["dur"]
            cur["last"] = e
        else:
            cur = {"ids": [e["id"]], "tick": e["tick"], "dur": e["dur"], "midi": pitch_midi(e["pitch"]), "pitch": e["pitch"], "first": e, "last": e}
            out.append(cur)
        if not e.get("tieStart"):
            cur = None
    return out


def measure_of_tick(doc: dict, tick: int) -> int:
    idx = 0
    for m in doc["measures"]:
        if m["startTick"] <= tick:
            idx = m["index"]
    return idx


def rhythm_cells_for_measure(m: dict, meter: dict, pickup_ticks: int) -> list[str]:
    """Cells of one bar, read per metronome beat (PLAN ruling 46, 02 §2.2).

    Ticks are scaled so that one metronome beat (`countUnitTicks`: the half note in 2/2, the eighth in 3/8, the dotted
    quarter in compound meters) is 480 ticks (720 in compound meters), exactly as tools/corpus-build features.bar_cells
    does. In 2/4, 3/4 and 4/4 the scale is 1, so those bars are unchanged.
    """
    bt = bar_ticks(meter)
    evs = m["events"]
    if not evs:
        return []
    base = m["startTick"] - (bt - pickup_ticks if m["isPickup"] else 0)
    comp = compound(meter)
    unit = 720 if comp else 480
    scale = Fraction(unit, meter["countUnitTicks"])
    items = [(Fraction(e["tick"] - base) * scale, Fraction(e["dur"]) * scale, e["kind"] == "rest", e.get("tuplet")) for e in evs]
    cells: list[str] = []
    i = 0
    n = len(items)
    while i < n:
        start = items[i][0]
        gstart = (start // unit) * unit
        gend = gstart + unit
        j = i
        while j < n and items[j][0] < gend:
            gend = max(gend, -(-(items[j][0] + items[j][1]) // unit) * unit)
            j += 1
        group = items[i:j]
        pat = []
        if start > gstart:
            pat.append((start - gstart, True))
        pat.extend((d, r) for (_t, d, r, _tu) in group)
        tup = [g[3] for g in group if g[3]]
        cells.append(classify(pat, tup, gend - gstart, comp))
        i = j
    return cells


SIMPLE_NOTES = {
    (480,): "Q", (960,): "H", (1440,): "H.", (1920,): "W", (1680,): "H..",
    (720, 240): "Q.E", (240, 240): "EE", (240, 480, 240): "EQE", (120, 120, 120, 120): "SSSS",
    (240, 120, 120): "ESS", (720, 120, 120): "ESS", (120, 120, 240): "SSE", (120, 240, 120): "SES", (360, 120): "E.S", (840, 120): "Q..",
}
SIMPLE_RESTS = {(480,): "Qr", (960,): "Hr", (1440,): "Hr", (1920,): "Wr", (240, 240): None}
COMPOUND_NOTES = {
    (720,): "C.Q", (1440,): "C.Q", (2160,): "C.Q", (480, 240): "C.QE", (240, 480): "C.EQ", (240, 240, 240): "C.EEE",
    (360, 120, 240): "C.E.SE", (120,) * 6: "C.SSSSSS", (240, 120, 120, 240): "C.SSSSSS", (240, 240, 120, 120): "C.SSSSSS",
    (120, 120, 240, 240): "C.SSSSSS", (1200, 240): "C.QE", (960, 480): "C.QE",
}


def classify(pat: list[tuple[int, bool]], tup: list, span: int, comp: bool) -> str:
    durs = tuple(d for d, _ in pat)
    rests = tuple(r for _, r in pat)
    if tup:
        if any(d % 80 == 0 and d < 160 for d in durs):
            return "T6S"
        return "T3E" if span <= 480 or all(d <= 160 for d in durs) else "T3Q"
    if any(d < 120 for d in durs):
        return "T"
    if comp:
        if all(rests):
            return "C.Qr."
        return COMPOUND_NOTES.get(durs, "other")
    if all(rests):
        return SIMPLE_RESTS.get(durs) or "Qr"
    if any(r for r in rests):
        if any(d == 120 and r for d, r in pat):
            return "S-sync"
        if durs == (240, 240):
            return "rE" if rests[0] else "Er"
        if durs[0] == 240 and rests[0] and len(durs) > 1:
            return "rE"
        if durs[-1] == 240 and rests[-1]:
            return "Er" if len(durs) == 2 else SIMPLE_NOTES.get(durs, "Er")
        return SIMPLE_NOTES.get(durs, "other")
    if durs in SIMPLE_NOTES:
        return SIMPLE_NOTES[durs]
    # a group that starts with whole beats and continues off-beat: split at the last beat boundary
    if durs[0] % 480 == 0:
        return classify(pat[1:], tup, span - durs[0], comp)
    if durs == (240, 720):
        return "EQE"
    if durs == (240, 1200) or durs == (240, 960, 240):
        return "EQE"
    return "other"


def cell_level(cell: str) -> int:
    for lv in LEVELS:
        if cell in lv["rhythmCells"]:
            return lv["level"]
    return 10


def first_level(pred) -> int:
    for lv in LEVELS:
        if pred(lv):
            return lv["level"]
    return 10


def analyse(doc: dict) -> dict:
    meter = doc["meter"]
    unit = meter["countUnitTicks"]
    bt = bar_ticks(meter)
    fifths = doc["keyConcert"]["fifths"]
    mode = doc["keyConcert"]["mode"]
    evs = all_events(doc)
    ch = chains(doc)
    total = sum(e["dur"] for e in evs)
    full_bars = [m for m in doc["measures"] if not m["isPickup"]]
    note_count = len(ch)
    # cells
    cells_per_bar: list[list[str]] = []
    for m in doc["measures"]:
        cells_per_bar.append(rhythm_cells_for_measure(m, meter, doc["pickupTicks"]))
    extra_cells: set[str] = set()
    bar_extra: dict[int, set[str]] = {}
    id_measure = {e["id"]: m["index"] for m in doc["measures"] for e in m["events"]}
    for m in doc["measures"]:
        for e in m["events"]:
            if e["kind"] == "note" and e.get("tieStart"):
                nxt = next(x for x in all_events(doc) if x["tick"] == e["tick"] + e["dur"])
                cell = "tieBar" if id_measure[nxt["id"]] != m["index"] else "tieBeat"
                extra_cells.add(cell)
                bar_extra.setdefault(m["index"], set()).add(cell)
    if doc["pickupTicks"]:
        pm = doc["measures"][0]
        pn = [e for e in pm["events"] if e["kind"] == "note"]
        cell = "pickup1" if len(pm["events"]) == 1 and len(pn) == 1 and doc["pickupTicks"] == unit else "pickup"
        extra_cells.add(cell)
        bar_extra.setdefault(0, set()).add(cell)
    cells = sorted({c for cs in cells_per_bar for c in cs} | extra_cells)
    bar_rhythm = []
    for m, cs in zip(doc["measures"], cells_per_bar):
        lv = max([1] + [cell_level(c) for c in cs] + [cell_level(c) for c in bar_extra.get(m["index"], set())])
        bar_rhythm.append(lv)
    # intervals and leaps
    seq = []  # (chain, break_before)
    prev_end = None
    for c in ch:
        brk = False
        if prev_end is not None:
            gap = c["tick"] - prev_end
            brk = gap >= unit
        seq.append((c, brk))
        prev_end = c["tick"] + c["dur"]
    intervals = []
    for (a, _), (b, brk) in zip(seq, seq[1:]):
        if not brk:
            intervals.append((a, b, abs(b["midi"] - a["midi"])))
    max_leap = max([iv for _, _, iv in intervals], default=0)
    triad = {tonic_pc(fifths, mode), (tonic_pc(fifths, mode) + (4 if mode == "major" else 3)) % 12, (tonic_pc(fifths, mode) + 7) % 12}
    free1 = LEVELS[0]["maxIntervalSemis"]
    big = [(a, b) for a, b, iv in intervals if iv > free1]
    triad_only = bool(big) and all(a["midi"] % 12 in triad and b["midi"] % 12 in triad for a, b in big)
    leaps_by_bar = [0] * len(doc["measures"])
    for a, b, iv in intervals:
        if iv >= 5:
            leaps_by_bar[measure_of_tick(doc, b["tick"])] += 1
    scale = scale_pcs(fifths)
    tpc = tonic_pc(fifths, mode)
    raised = {(tpc + 9) % 12, (tpc + 11) % 12} if mode == "minor" else set()
    chrom_by_bar = [0] * len(doc["measures"])
    outside: set[int] = set()
    minor_alts = 0
    raised6 = raised7 = False
    for c in ch:
        pc = c["midi"] % 12
        if pc in scale:
            continue
        if pc in raised:
            minor_alts += 1
            if pc == (tpc + 9) % 12:
                raised6 = True
            else:
                raised7 = True
            continue
        outside.add(pc)
        chrom_by_bar[measure_of_tick(doc, c["tick"])] += 1

    def per4(v: list[int]) -> int:
        if len(v) <= 4:
            return sum(v)
        return max(sum(v[i : i + 4]) for i in range(len(v) - 3))

    doubles = sum(1 for c in ch for e in [c["first"]] if abs(e["pitch"]["alter"]) == 2)
    mids = [c["midi"] for c in ch]
    span = max(mids) - min(mids)
    ioi_change = []
    ioi_rep = []
    for a, b in zip(ch, ch[1:]):
        d = b["tick"] - a["tick"]
        (ioi_rep if a["midi"] == b["midi"] else ioi_change).append(d)
    onsets = [c["tick"] for c in ch]
    peak = 0
    for t in onsets:
        peak = max(peak, sum(1 for u in onsets if t <= u < t + unit))
    shortest = min(e["dur"] for e in evs)
    # syncopation: onset off the beat whose chain crosses the next beat boundary
    sync = 0
    for c in ch:
        rel = (c["tick"] - doc["pickupTicks"]) % unit
        if rel != 0:
            nxt_beat = c["tick"] + (unit - rel)
            if c["tick"] + c["dur"] > nxt_beat:
                sync += 1
    rest_ticks = sum(e["dur"] for m in full_bars for e in m["events"] if e["kind"] == "rest")
    window_ticks = len(full_bars) * bt
    features = {
        "noteCount": note_count,
        "notesPerBeat": round(note_count / (total / unit), 4),
        "peakNotesPerBeat": peak,
        "shortestDur": shortest,
        "maxLeapSemis": max_leap,
        "tonicTriadLeapsOnly": triad_only,
        "leapsPer4BarsMax": per4(leaps_by_bar),
        "chromaticPer4BarsMax": per4(chrom_by_bar),
        "doubleAccidentals": doubles,
        "spanSemis": span,
        "minIoiTicks": min(ioi_change) if ioi_change else min(ioi_rep),
        "minRepeatIoiTicks": min(ioi_rep) if ioi_rep else None,
        "syncopationIndex": round(sync / note_count, 4),
        "restRatio": round(rest_ticks / window_ticks, 4),
        "accidentalsOutsideKey": len(outside),
        "minorAlterations": minor_alts,
    }
    minor_form = "melodic" if raised6 else ("harmonic" if raised7 else "natural")
    fl = tag_levels(meter_str(meter), mode, minor_form, cells, features)
    level = max(fl.values())
    hi = max(mids)
    lo = min(mids)
    return {
        "rangeConcert": {"min": lo, "max": hi},
        "features": features,
        "rhythmCells": cells,
        "featureLevels": fl,
        "barRhythmLevel": bar_rhythm,
        "extremes": {"highId": next(c["ids"][0] for c in ch if c["midi"] == hi), "lowId": next(c["ids"][0] for c in ch if c["midi"] == lo)},
        "level": level,
        "levelConfidence": sum(1 for v in fl.values() if v == level),
        "phraseQuality": phrase_quality(doc, ch),
        "breathMaxGapBars": breath_gap(doc, ch),
        "_minorForm": minor_form,
    }


def tag_levels(meter: str, mode: str, minor_form: str, cells: list[str], f: dict) -> dict:
    """Port of the reference tagger in fixtures/levels/feature-vectors.test.ts (02 §2.1, §2.3)."""
    unit = make_meter(*[int(x) for x in meter.split("/")])["countUnitTicks"]
    floors = BUDGET["ioiFloors"]

    def density() -> int:
        for lv in LEVELS:
            bpm = lv["tempo"]["minBpm"]
            nps = f["peakNotesPerBeat"] * bpm / 60
            cap = min(lv["npsCap"]["512"], 1000 / floors["pitchChangeMs"]["512"])
            ioi_ms = f["minIoiTicks"] / unit * (60000 / bpm)
            smallest = min(floors["pitchChangeMs"]["512"], floors["repeatMs"]["tonguedOrStruck"])
            if nps <= cap + 1e-9 and ioi_ms >= smallest:
                return lv["level"]
        return 10

    if mode == "major":
        mode_lv = first_level(lambda l: "major" in l["modes"])
    else:
        mode_lv = first_level(lambda l: "minor" in l["modes"] and minor_form in l["minorForms"])
    return {
        "meter": first_level(lambda l: meter in l["meters"]),
        "rhythm": max([1] + [cell_level(c) for c in cells]),
        "interval": first_level(
            lambda l: l["maxIntervalSemis"] is None
            or f["maxLeapSemis"] <= l["maxIntervalSemis"]
            or (f["tonicTriadLeapsOnly"] and l["largerLeaps"] is not None and f["maxLeapSemis"] <= l["largerLeaps"]["maxSemis"])
        ),
        "leaps": first_level(lambda l: l["maxLeapsPer4Bars"] is None or f["leapsPer4BarsMax"] <= l["maxLeapsPer4Bars"]),
        "span": first_level(lambda l: l["maxSpanSemis"] is None or f["spanSemis"] <= l["maxSpanSemis"]),
        "mode": mode_lv,
        "chromatic": first_level(lambda l: l["chromaticPer4Bars"] is None or f["chromaticPer4BarsMax"] <= l["chromaticPer4Bars"]),
        "double": first_level(lambda l: l["doubleAccidentals"]) if f["doubleAccidentals"] > 0 else 1,
        "density": density(),
    }


def phrase_quality(doc: dict, ch: list[dict]) -> str:
    """03 §6.7: complete-phrase if there is no interior allowed end; period if one near the midpoint."""
    meter = doc["meter"]
    unit = meter["countUnitTicks"]
    fifths, mode = doc["keyConcert"]["fifths"], doc["keyConcert"]["mode"]
    evs = all_events(doc)
    strong = strong_positions(meter)
    interior = []
    for c in ch[:-1]:
        m = doc["measures"][measure_of_tick(doc, c["tick"])]
        rel = c["tick"] - m["startTick"]
        if m["isPickup"] or rel not in strong:
            continue
        end = c["tick"] + c["dur"]
        nxt = next((e for e in evs if e["tick"] == end), None)
        if nxt is None or nxt["kind"] != "rest":
            continue
        deg = degree_of(c["midi"] % 12, fifths, mode)
        if deg in (1, 3, 5, 2):
            interior.append((measure_of_tick(doc, c["tick"]), deg))
    if not interior:
        return "complete-phrase"
    bars = [m["index"] for m in doc["measures"] if not m["isPickup"]]
    mid = (bars[0] + bars[-1]) / 2
    if len(interior) == 1 and abs(interior[0][0] - mid) <= 1.5 and interior[0][1] in (5, 2, 3):
        return "period"
    return "phrase-pair"


def breath_gap(doc: dict, ch: list[dict]) -> float:
    """Longest stretch of sound without a rest, in bars (02 §2.4 breath rule input), rounded to 0.01."""
    bt = bar_ticks(doc["meter"])
    evs = all_events(doc)
    end = evs[-1]["tick"] + evs[-1]["dur"]
    spans = []
    t = 0
    for e in evs:
        if e["kind"] == "rest":
            spans.append(e["tick"] - t)
            t = e["tick"] + e["dur"]
    spans.append(end - t)
    return round(max(spans) / bt, 2)


def cadence_label(doc: dict) -> str:
    ch = chains(doc)
    fifths, mode = doc["keyConcert"]["fifths"], doc["keyConcert"]["mode"]
    last = ch[-1]
    deg = degree_of(last["midi"] % 12, fifths, mode)
    if deg in (5, 2):
        return "HC"
    if deg == 3:
        return "IAC"
    prev = ch[-2]
    pdeg = degree_of(prev["midi"] % 12, fifths, mode)
    if abs(last["midi"] - prev["midi"]) <= 2 and pdeg in (2, 7):
        return "PAC"
    return "IAC"


def flags_for(doc: dict) -> list[str]:
    flags = []
    if doc["level"] <= 4 and doc["breathMaxGapBars"] > LOAD_BREATH["maxGapBarsUpToLevel4"]:
        flags.append("noBreath")
    if doc["level"] > 4:
        bpm = doc["tempo"]["minBpm"]
        secs = doc["breathMaxGapBars"] * doc["meter"]["countsPerBar"] * 60 / bpm
        if secs > LOAD_BREATH["maxGapSecFromLevel5"]:
            flags.append("noBreath")
    ch = chains(doc)
    ivs = [abs(b["midi"] - a["midi"]) for a, b in zip(ch, ch[1:])]
    if doc["level"] <= 6 and ivs and sum(1 for i in ivs if i >= 5) / len(ivs) > 0.25:
        flags.append("leapy")
    return flags


LOAD_BREATH = load_json("config/levels.json")["breath"]


def fingerprint(doc: dict) -> list:
    """03 §6.10: (interval, IOI ratio quantized) tokens; transposition and augmentation invariant."""
    ch = chains(doc)
    q = [0.25, 1 / 3, 0.5, 2 / 3, 1, 1.5, 2, 3, 4]
    toks = []
    for i in range(1, len(ch)):
        iv = ch[i]["midi"] - ch[i - 1]["midi"]
        ioi = ch[i]["tick"] - ch[i - 1]["tick"]
        if i >= 2:
            prev = ch[i - 1]["tick"] - ch[i - 2]["tick"]
            r = ioi / prev
            rq = min(q, key=lambda x: (abs(math.log(r / x)), x))
            toks.append([iv, round(rq, 4)])
        else:
            toks.append([iv, 1])
    return toks


def interest(doc: dict) -> float:
    """03 §6.9 melodic interest."""
    ch = chains(doc)
    mids = [c["midi"] for c in ch]
    dirs = [(b > a) - (b < a) for a, b in zip(mids, mids[1:])]
    nz = [d for d in dirs if d]
    changes = sum(1 for a, b in zip(nz, nz[1:]) if a != b)
    pcs = len({m % 12 for m in mids})
    cells = [c for cs in [rhythm_cells_for_measure(m, doc["meter"], doc["pickupTicks"]) for m in doc["measures"]] for c in cs]
    counts: dict[str, int] = {}
    for c in cells:
        counts[c] = counts.get(c, 0) + 1
    ncell = len(cells)
    ent = -sum((v / ncell) * math.log(v / ncell) for v in counts.values()) if ncell else 0
    max_ent = math.log(len(counts)) if len(counts) > 1 else 1
    rep = sum(1 for a, b in zip(mids, mids[1:]) if a == b) / max(1, len(mids) - 1)
    return 0.3 * changes / len(mids) + 0.3 * min(1, pcs / 7) + 0.2 * (ent / max_ent if len(counts) > 1 else 0) + 0.2 * (1 - rep)


def coverage_tags(doc: dict) -> list[str]:
    """Descriptive tags the fixture coverage test asserts (01 §14 item 7)."""
    tags = []
    evs = all_events(doc)
    notes = [e for e in evs if e["kind"] == "note"]
    ch = chains(doc)
    if doc["pickupTicks"]:
        tags.append("pickup")
    if "tieBar" in doc["rhythmCells"]:
        tags.append("tie-across-barline")
    if any("tuplet" in e for e in evs):
        tags.append("triplet")
    if any(e["kind"] == "rest" for e in evs):
        tags.append("rests")
    if doc["features"]["accidentalsOutsideKey"] or doc["features"]["minorAlterations"]:
        tags.append("accidentals")
    run = best = 1
    for a, b in zip(ch, ch[1:]):
        run = run + 1 if a["midi"] == b["midi"] and b["tick"] == a["tick"] + a["dur"] else 1
        best = max(best, run)
    if best >= 3:
        tags.append("repeated-notes")
    # slurred run: at least 4 consecutive notes under one slur, each at most a beat, stepwise
    depth = 0
    cur: list[dict] = []
    longest = 0
    unit = doc["meter"]["countUnitTicks"]
    for e in notes:
        s = e.get("slur")
        if s == "start":
            depth = 1
            cur = [e]
        elif depth and s in (None, "continue", "stop"):
            cur.append(e)
            if s == "stop":
                ok = all(x["dur"] <= unit for x in cur) and all(abs(pitch_midi(b["pitch"]) - pitch_midi(a["pitch"])) <= 2 for a, b in zip(cur, cur[1:]))
                if ok:
                    longest = max(longest, len(cur))
                depth = 0
                cur = []
            elif s == "continue":
                cur = [e]
    if longest >= 4:
        tags.append("slurred-run")
    return tags
