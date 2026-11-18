"""Part analysis for window proposal (03 section 6.6, job C5): note chains, rests, key sections and mode, cadence degrees,
LBDM boundary strengths and melodic sequences. Pure Python on a normalized part (`partdata.load_part`).

Everything here is per part and deterministic. Nothing creates a window: the allowed starts and ends are decided in
`windows.py` from the facts computed here.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

STEPS = "CDEFGAB"
STEP_SEMIS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
SHARP_ORDER = "FCGDAEB"

# Krumhansl-Kessler key profiles (the same profiles music21's analyze('key') uses). Only used to decide between a
# signature's major and relative minor when a voice part ends on a triad member rather than the tonic.
KK_MAJOR = (6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88)
KK_MINOR = (6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17)

# Mode names by the final's step above the signature's major tonic (03 section 6.6: "1 sharp with final A is A dorian").
MODAL_BY_DEGREE = {1: "major", 2: "dorian", 3: "phrygian", 4: "lydian", 5: "mixolydian", 6: "minor", 7: "locrian"}
MAJOR_STEPS = (0, 2, 4, 5, 7, 9, 11)
# semitones of each mode's degrees 1..7 above its own final
MODE_SCALES = {
    "major": (0, 2, 4, 5, 7, 9, 11),
    "dorian": (0, 2, 3, 5, 7, 9, 10),
    "phrygian": (0, 1, 3, 5, 7, 8, 10),
    "lydian": (0, 2, 4, 6, 7, 9, 11),
    "mixolydian": (0, 2, 4, 5, 7, 9, 10),
    "locrian": (0, 1, 3, 5, 6, 8, 10),
}


# ---------------------------------------------------------------- key helpers

def key_alter(fifths: int, step: str) -> int:
    if fifths > 0:
        return 1 if step in SHARP_ORDER[:fifths] else 0
    if fifths < 0:
        return -1 if step in SHARP_ORDER[::-1][:-fifths] else 0
    return 0


def major_tonic_pc(fifths: int) -> int:
    step = STEPS[(fifths * 4) % 7]
    return (STEP_SEMIS[step] + key_alter(fifths, step)) % 12


def tonic_pc(fifths: int, mode: str) -> int:
    """Pitch class of the final: major tonic, minor = degree 6 of the signature, church modes by their degree."""
    major = major_tonic_pc(fifths)
    if mode == "major":
        return major
    if mode in ("minor", "aeolian"):
        return (major + 9) % 12
    deg = {v: k for k, v in MODAL_BY_DEGREE.items()}[mode]
    return (major + MAJOR_STEPS[deg - 1]) % 12


def degree_of(pc: int, fifths: int, mode: str) -> int | None:
    """Scale degree 1..7 of a pitch class (minor counts the raised 6th and 7th as degrees 6 and 7), else None."""
    rel = (pc - tonic_pc(fifths, mode)) % 12
    if mode == "minor":
        return {0: 1, 2: 2, 3: 3, 5: 4, 7: 5, 8: 6, 9: 6, 10: 7, 11: 7}.get(rel)
    scale = MODE_SCALES.get(mode, MODE_SCALES["major"])
    return scale.index(rel) + 1 if rel in scale else None


# ---------------------------------------------------------------- meter helpers

def count_unit(beats: int, beat_type: int) -> int:
    """Ticks per metronome beat (02 conventions, src/core/time.ts makeMeter): compound meters count dotted beats."""
    unit = 480 * 4 // beat_type
    return unit * 3 if beat_type == 8 and beats >= 6 and beats % 3 == 0 else unit


def make_meter(beats: int, beat_type: int) -> dict[str, int]:
    u = count_unit(beats, beat_type)
    return {"beats": beats, "beatType": beat_type, "countUnitTicks": u, "countsPerBar": beats * (480 * 4 // beat_type) // u}


def strong_positions(beats: int, beat_type: int) -> set[int]:
    """Bar-relative ticks of strong beats for window ends (03 section 6.6, 02 H2): beat 1, beat 3 in 4/4, beat 4 in
    6/8. 12/8 also gets its half-bar (beat 7), the compound analogue of beat 3 in 4/4."""
    s = {0}
    if (beats, beat_type) == (4, 4):
        s.add(960)
    elif (beats, beat_type) == (6, 8):
        s.add(720)
    elif (beats, beat_type) == (12, 8):
        s.add(1440)
    return s


# ---------------------------------------------------------------- chains

@dataclass
class Chain:
    """One sounding note: a tie chain merged (01 §6.1: tie chains count once)."""

    idx: int
    mi: int  # measure index of the head
    ei: int  # event index of the head
    end_mi: int  # measure index of the last tied event
    end_ei: int
    abs_tick: int  # onset, ticks from the part start
    dur: int  # total sounding ticks of the chain
    midi: int
    movement: int
    rest_before: int  # rest ticks since the previous chain (a large number at a movement start)
    rest_after: int = 0
    lyric_end: bool = False  # lyricLineEnd on any event of the chain (internal boundary signal, never emitted)
    breath: bool = False  # breath mark on the chain
    broken_tie: bool = False  # tieStop without a matching tieStart before it


MOVEMENT_START_REST = 10**9


@dataclass
class PartFacts:
    measures: list[dict[str, Any]]
    starts: list[int]  # absolute tick of each measure start
    chains: list[Chain]
    chain_at: dict[tuple[int, int], int]  # (mi, ei) of every note event (heads and tied continuations) -> chain index
    next_event: dict[tuple[int, int], tuple[int, int] | None] = field(default_factory=dict)
    movement_bounds: dict[int, tuple[int, int]] = field(default_factory=dict)
    boundary: list[float] = field(default_factory=list)  # LBDM strength of the boundary after chain k
    seq_inside: list[bool] = field(default_factory=list)  # chain k lies in a sequence before its last statement ends


def build_facts(part: dict[str, Any]) -> PartFacts:
    measures = part["measures"]
    starts: list[int] = []
    t = 0
    for m in measures:
        starts.append(t)
        t += max(m["lengthTicks"], 0)
    chains: list[Chain] = []
    chain_at: dict[tuple[int, int], int] = {}
    flat: list[tuple[int, int, dict[str, Any]]] = [(mi, ei, e) for mi, m in enumerate(measures) for ei, e in enumerate(m["events"])]
    next_event: dict[tuple[int, int], tuple[int, int] | None] = {}
    for k, (mi, ei, _e) in enumerate(flat):
        nxt = flat[k + 1] if k + 1 < len(flat) else None
        next_event[(mi, ei)] = (nxt[0], nxt[1]) if nxt and measures[nxt[0]]["movement"] == measures[mi]["movement"] else None
    rest_run = MOVEMENT_START_REST
    cur: Chain | None = None
    movement = None
    for mi, ei, e in flat:
        mv = measures[mi]["movement"]
        if mv != movement:
            movement = mv
            rest_run = MOVEMENT_START_REST
            cur = None
        if e["kind"] == "rest":
            rest_run += e["dur"]
            if cur is not None:
                cur.rest_after += e["dur"]
            continue
        if e.get("tieStop") and cur is not None and cur.end_mi is not None and _ties_into(measures, cur, mi, ei, e):
            cur.end_mi, cur.end_ei = mi, ei
            cur.dur += e["dur"]
            cur.lyric_end = cur.lyric_end or bool(e.get("lyricLineEnd"))
            cur.breath = cur.breath or bool(e.get("breath"))
            chain_at[(mi, ei)] = cur.idx
            continue
        c = Chain(idx=len(chains), mi=mi, ei=ei, end_mi=mi, end_ei=ei, abs_tick=starts[mi] + e["tick"], dur=e["dur"], midi=e.get("midi", -1),
                  movement=mv, rest_before=rest_run, lyric_end=bool(e.get("lyricLineEnd")), breath=bool(e.get("breath")),
                  broken_tie=bool(e.get("tieStop")))
        chains.append(c)
        chain_at[(mi, ei)] = c.idx
        cur = c
        rest_run = 0
    # rest_after counts rests up to the next note or the movement end.
    bounds: dict[int, tuple[int, int]] = {}
    for m in measures:
        lo, hi = bounds.get(m["movement"], (m["index"], m["index"]))
        bounds[m["movement"]] = (min(lo, m["index"]), max(hi, m["index"]))
    facts = PartFacts(measures=measures, starts=starts, chains=chains, chain_at=chain_at, next_event=next_event, movement_bounds=bounds)
    facts.boundary = lbdm(chains)
    facts.seq_inside = sequences(chains)
    return facts


def _ties_into(measures: list[dict[str, Any]], cur: Chain, mi: int, ei: int, e: dict[str, Any]) -> bool:
    """A tieStop continues the open chain only if the chain's last event carries tieStart, has the same pitch, and the
    two are adjacent (no rest between)."""
    last = measures[cur.end_mi]["events"][cur.end_ei]
    return bool(last.get("tieStart")) and last.get("midi") == e.get("midi") and not cur.rest_after


# ---------------------------------------------------------------- LBDM (ranking only)

def lbdm(chains: list[Chain]) -> list[float]:
    """Cambouropoulos' Local Boundary Detection Model over pitch interval, IOI and rest, per movement. Returns the
    boundary strength after each chain, normalised to 0..1 per profile and weighted 0.25 / 0.5 / 0.25."""
    n = len(chains)
    out = [0.0] * n
    if n < 2:
        return out
    profiles: list[list[float]] = [[], [], []]
    for k in range(n - 1):
        a, b = chains[k], chains[k + 1]
        if a.movement != b.movement:
            profiles[0].append(0.0)
            profiles[1].append(0.0)
            profiles[2].append(0.0)
            continue
        profiles[0].append(float(abs(b.midi - a.midi)))
        profiles[1].append(float(b.abs_tick - a.abs_tick))
        profiles[2].append(float(a.rest_after))
    weights = (0.25, 0.5, 0.25)
    for p, w in zip(profiles, weights):
        s = []
        for k, x in enumerate(p):
            left = _r(p[k - 1], x) if k > 0 else 0.0
            right = _r(x, p[k + 1]) if k + 1 < len(p) else 0.0
            s.append(x * (left + right))
        mx = max(s) if s else 0.0
        if mx > 0:
            for k, v in enumerate(s):
                out[k] += w * v / mx
    return [round(v, 6) for v in out]


def _r(a: float, b: float) -> float:
    return abs(a - b) / (a + b) if a + b > 0 else 0.0


# ---------------------------------------------------------------- sequences (02 H5)

SEQ_MIN_INTERVALS = 2  # a pattern of at least 3 notes
SEQ_MAX_INTERVALS = 7


def sequences(chains: list[Chain]) -> list[bool]:
    """inside[k] is True when chain k lies in a melodic sequence before the end of its last statement.

    A sequence (03 section 6.7 H12, 02 H5) is an interval pattern of at least 3 notes stated at least twice in a row,
    each later statement transposed (non-zero) and with the same durations and the same rests between its notes.
    Statements are adjacent: the next statement starts on the note after the previous one ends. A rest of a bar or
    more, or a movement boundary, breaks a sequence. Reading: "repeated at least twice" is taken as two statements in
    all, the stricter reading, because precision at window ends matters more than yield (03 section 6.6).
    """
    n = len(chains)
    inside = [False] * n

    def sig(p: int, L: int) -> tuple | None:
        if p + L >= n:
            return None
        cs = chains[p : p + L + 1]
        if any(c.movement != cs[0].movement or c.midi < 0 for c in cs):
            return None
        if any(c.rest_before >= 1920 for c in cs[1:]):
            return None
        return (tuple(cs[i + 1].midi - cs[i].midi for i in range(L)), tuple(c.dur for c in cs), tuple(c.rest_before for c in cs[1:]))

    for L in range(SEQ_MIN_INTERVALS, SEQ_MAX_INTERVALS + 1):
        sigs = [sig(p, L) for p in range(n)]
        for p in range(n):
            s0 = sigs[p]
            if s0 is None or all(iv == 0 for iv in s0[0]):
                continue
            q = p
            count = 1
            while True:
                r = q + L + 1
                if r >= n or sigs[r] != s0 or chains[r].movement != chains[q].movement or chains[r].rest_before >= 1920:
                    break
                if chains[r].midi == chains[q].midi:
                    break  # a literal repeat, not a transposition
                q = r
                count += 1
            if count >= 2:
                last_end = q + L
                for k in range(p, last_end):
                    inside[k] = True
    return inside


# ---------------------------------------------------------------- key sections and mode

@dataclass
class Section:
    lo: int
    hi: int
    fifths: int
    movement: int
    mode: str | None  # major, minor, a church mode, or None (unknown)
    basis: str  # final, bass-final, profile, modal-final, unknown
    final_pc: int | None


def key_sections(measures: list[dict[str, Any]]) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    lo = 0
    for i in range(1, len(measures) + 1):
        if i == len(measures) or measures[i]["fifths"] != measures[lo]["fifths"] or measures[i]["movement"] != measures[lo]["movement"]:
            out.append((lo, i - 1))
            lo = i
    return out


def _last_note_pc(measures: list[dict[str, Any]], lo: int, hi: int) -> int | None:
    for mi in range(hi, lo - 1, -1):
        notes = [e for e in measures[mi]["events"] if e["kind"] == "note" and e.get("midi") is not None]
        if notes:
            return notes[-1]["midi"] % 12
    return None


def _dominant_pc(measures: list[dict[str, Any]], lo: int, hi: int) -> int | None:
    """The pitch class with the most sounding ticks in the bars (ties: the lowest pitch class)."""
    hist = [0] * 12
    for mi in range(lo, hi + 1):
        for e in measures[mi]["events"]:
            if e["kind"] == "note" and e.get("midi") is not None:
                hist[e["midi"] % 12] += e["dur"]
    best = max(hist)
    return hist.index(best) if best else None


def _profile_choice(measures: list[dict[str, Any]], lo: int, hi: int, fifths: int) -> str:
    hist = [0.0] * 12
    for mi in range(lo, hi + 1):
        for e in measures[mi]["events"]:
            if e["kind"] == "note" and e.get("midi") is not None:
                hist[e["midi"] % 12] += e["dur"]

    def corr(profile: tuple[float, ...], tonic: int) -> float:
        xs = [hist[(tonic + i) % 12] for i in range(12)]
        mx, my = sum(xs) / 12, sum(profile) / 12
        num = sum((x - mx) * (y - my) for x, y in zip(xs, profile))
        den = (sum((x - mx) ** 2 for x in xs) * sum((y - my) ** 2 for y in profile)) ** 0.5
        return num / den if den else 0.0

    return "major" if corr(KK_MAJOR, tonic_pc(fifths, "major")) >= corr(KK_MINOR, tonic_pc(fifths, "minor")) else "minor"


def section_modes(measures: list[dict[str, Any]], bass: list[dict[str, Any]] | None = None) -> list[Section]:
    """Major or minor from the key signature plus the section's final note (03 section 6.6).

    The final is the last note of the key section (a run of bars in one movement with one signature). For quartets the
    cello's last note in the same bars is used when its measures line up with this part's (`bass`), because an upper part
    often ends on the 3rd or 5th. Then:
    1. final = major tonic -> major; final = minor tonic -> minor;
    2. final a 3rd or 5th of the major or minor tonic triad: decided by the Krumhansl-Kessler profile of the section,
       since a Lieder voice (no piano part is read) often ends on a triad member while the piano closes on the tonic;
    3. otherwise, only for the last section of a movement, the piece is modal: the mode is named by the final's degree
       above the signature's major tonic (1 sharp, final A -> dorian). Precision guards: the final must also be the
       pitch class with the most sounding time in the section (a modal melody centres on its final), and no bass part
       may be available: in the quartets a "modal" final is a missing or stale signature, not a church mode. Locrian
       and a final outside the signature are unknown;
    4. anything else is unknown (None), and windows in that section are rejected (mode-unknown).
    """
    out: list[Section] = []
    secs = key_sections(measures)
    last_of_movement: dict[int, int] = {}
    for i, (lo, _hi) in enumerate(secs):
        last_of_movement[measures[lo]["movement"]] = i
    for i, (lo, hi) in enumerate(secs):
        fifths, mv = measures[lo]["fifths"], measures[lo]["movement"]
        basis = "final"
        f = None
        if bass is not None and len(bass) == len(measures):
            f = _last_note_pc(bass, lo, hi)
            basis = "bass-final"
        if f is None:
            f = _last_note_pc(measures, lo, hi)
            basis = "final"
        if f is None:
            out.append(Section(lo, hi, fifths, mv, None, "unknown", None))
            continue
        maj, mnr = tonic_pc(fifths, "major"), tonic_pc(fifths, "minor")
        if f == maj:
            out.append(Section(lo, hi, fifths, mv, "major", basis, f))
            continue
        if f == mnr:
            out.append(Section(lo, hi, fifths, mv, "minor", basis, f))
            continue
        maj_triad = {(maj + 4) % 12, (maj + 7) % 12}
        min_triad = {(mnr + 3) % 12, (mnr + 7) % 12}
        if f in maj_triad or f in min_triad:
            choice = _profile_choice(measures, lo, hi, fifths)
            ok = f in (maj_triad if choice == "major" else min_triad)
            out.append(Section(lo, hi, fifths, mv, choice if ok else None, "profile" if ok else "unknown", f))
            continue
        rel = (f - maj) % 12
        if bass is None and last_of_movement.get(mv) == i and rel in MAJOR_STEPS and _dominant_pc(measures, lo, hi) == f:
            mode = MODAL_BY_DEGREE[MAJOR_STEPS.index(rel) + 1]
            if mode in ("dorian", "phrygian", "lydian", "mixolydian"):
                out.append(Section(lo, hi, fifths, mv, mode, "modal-final", f))
                continue
        out.append(Section(lo, hi, fifths, mv, None, "unknown", f))
    return out


def section_of(sections: list[Section], mi: int) -> Section:
    for s in sections:
        if s.lo <= mi <= s.hi:
            return s
    raise IndexError(mi)
