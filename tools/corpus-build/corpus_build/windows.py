"""Window proposal and hard rules (03 sections 6.6 and 6.7, job C5) on one normalized part.

Flow per part:
1. `allowed_starts`: every phrase start 03 section 6.6 allows (section start, first note after a rest of at least one
   beat, a pickup of at most two beats after such a rest, the first note after a breath mark, and for Lieder the first
   note after a lyric line end). Each start names its first full bar and, optionally, a pickup in the bar before.
2. `allowed_end`: at most one allowed end per bar (the latest cadence note in the bar that 6.6 allows).
3. `propose`: every (start, end) pair spanning 8 to 12 full bars. Each pair goes through `check_rules` (H4 to H12 plus
   the 6.4 and 6.5 rejections). Rejected pairs keep their reason.
4. `select`: at most one window per first bar (best LBDM score plus the metrical prior), then a greedy pass that keeps
   windows overlapping an already kept one by at most 50% of the shorter one's bars. A kept window longer than 8 bars
   also keeps its 8-bar sub-window with the same start, when that passed, as a fallback (`fallbackFor`): C6 keeps the
   long window only if its level allows its length (02 §2.3 "Bars"), otherwise the fallback.

Levels are not known here (C6 tags them), so level-dependent rules are recorded as constraints: `minLevelBars` (from
config/levels.json `bars`), `minLevelCadence` (3 for a half cadence, 02 H2) and `minLevel`, the larger of the two.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

from .paths import TOOL_DIR
from .phrase import Chain, PartFacts, Section, build_facts, count_unit, degree_of, make_meter, section_modes, section_of, strong_positions

MIN_BARS, MAX_BARS = 8, 12
METRICAL_PRIOR = 0.15
MAX_OVERLAP = 0.5
CHURCH_MODES = {"dorian", "phrygian", "lydian", "mixolydian", "aeolian", "locrian"}
MOD_ORDER = ["excerpted", "grace-removed", "ornament-removed", "fermata-removed", "lyrics-removed", "rhythm-augmented-x2", "final-bar-completed"]
# Barrier marks a window may carry only at its own edges (H8): a forward repeat at the very start, a backward repeat at
# the very end. Everything else rejects: voltas, segno, coda, D.C./D.S. text.
ALLOWED_AT_START = {"repeat-start"}
ALLOWED_AT_END = {"repeat-end"}
BARRIER = {"repeat-start", "repeat-end", "volta", "volta-start", "segno", "coda", "repeat-text", "repeat-expression"}

# Tempo words and tempo-change words (6.4: a tempo change inside a window rejects it). Same list as the fixture
# extractor (tools/fixtures/excerpt_lib.py), so fixtures and pipeline agree.
TEMPO_WORD_RE = re.compile(
    r"\b(grave|largo|larghetto|lento|adagio|andantino|andante|moderato|allegretto|allegro|vivace|presto|prestissimo|sehr langsam|langsam|"
    r"m[aä](ss|ß)ig|bewegt|lebhaft|schnell|rasch|lent|mod[ée]r[ée]|anim[ée]|vif|vite|tempo di|minuetto|menuetto|scherzo|innig|ruhig|getragen|"
    r"zart|feierlich|munter|frisch|heiter|tempo|mouvement|mosso|moto|comodo|maestoso|sostenuto|tranquillo)",
    re.IGNORECASE,
)
TEMPO_CHANGE_RE = re.compile(
    r"\b(rit|ritard|rall|accel|stringendo|allarg|a tempo|tempo i|tempo primo|langsamer|schneller|zurückhalten|zur[uü]ck|ritenuto|riten|"
    r"c[ée]dez|retenu|en pressant|pressez|ad lib|a piacere|colla voce|fermate|morendo|smorzando|calando|perdendosi|nach und nach|"
    r"allmählich|string|stretto|recit|slent|volont|largament|animato|"
    r"(più|piu|meno|plus|moins|un peu|poco)\s+(mosso|moto|lento|lent|allegro|vivo|vif|presto|adagio|largo|tranquillo|animato|anim|vite|mouvement|langsam|lebhaft))",
    re.IGNORECASE,
)


@lru_cache(maxsize=1)
def bars_min_level() -> dict[int, int]:
    """Lowest level whose `bars` list allows each window length (config/levels.json, 02 §2.3)."""
    with open(TOOL_DIR.parent.parent / "config" / "levels.json", encoding="utf-8") as f:
        levels = json.load(f)["levels"]
    out: dict[int, int] = {}
    for lv in sorted(levels, key=lambda x: x["level"]):
        for b in lv["bars"]:
            out.setdefault(int(b), int(lv["level"]))
    return out


HC_MIN_LEVEL = 3  # 02 H2: half cadences from L3


def is_tempo_change(t: dict[str, Any]) -> bool:
    if t.get("bpm") is not None:
        return True
    txt = t.get("text") or ""
    return bool(TEMPO_WORD_RE.search(txt) or TEMPO_CHANGE_RE.search(txt))


# ---------------------------------------------------------------- starts and ends

@dataclass(frozen=True)
class Start:
    first: int  # first full bar (measure index)
    pickup_mi: int | None
    pickup_ei: int  # event index in the pickup bar where the window starts
    chain: int  # first chain of the window
    kind: str  # section-start, after-rest, after-breath, after-lyric-line, anacrusis
    pickup_ticks: int


@dataclass(frozen=True)
class End:
    last: int  # last bar (measure index)
    chain: int  # cadence chain
    degree: int | None
    cadence: str | None  # PAC, IAC, HC; None if the mode is unknown
    followed_by: str  # rest, barline, lyric-line, movement-end
    completed: bool  # notes after the cadence note in the last bar are replaced by rests
    mode_unknown: bool = False


def _bar_unit(m: dict[str, Any]) -> int:
    return count_unit(m["beats"], m["beatType"])


def _is_section_start(facts: PartFacts, mi: int) -> bool:
    ms = facts.measures
    m = ms[mi]
    lo, _hi = facts.movement_bounds[m["movement"]]
    if mi == lo:
        return True
    prev = ms[mi - 1]
    if prev["doubleBarline"] or prev["finalBarline"]:
        return True
    if m.get("leftBarline") in ("heavy-light", "light-light", "heavy-heavy") or "repeat-start" in m["marks"]:
        return True
    return bool(m.get("timeChange") or m.get("keyChange"))


def _start_signal(facts: PartFacts, c: Chain, lyric: bool) -> str | None:
    unit = _bar_unit(facts.measures[c.mi])
    if c.broken_tie or c.midi < 0:
        return None
    if c.rest_before >= unit:
        return "after-rest"
    prev = facts.chains[c.idx - 1] if c.idx > 0 and facts.chains[c.idx - 1].movement == c.movement else None
    if prev is not None and prev.breath:
        return "after-breath"
    if lyric and prev is not None and prev.lyric_end:
        return "after-lyric-line"
    return None


def allowed_starts(facts: PartFacts, lyric: bool) -> list[Start]:
    out: list[Start] = []
    ms = facts.measures
    for mi, m in enumerate(ms):
        evs = m["events"]
        # no pickup: the bar's first note, after leading rests only, is a chain head and a phrase start
        i0 = next((i for i, e in enumerate(evs) if e["kind"] == "note"), None)
        if i0 is not None and m["lengthTicks"] == m["barTicks"]:
            ci = facts.chain_at.get((mi, i0))
            c = facts.chains[ci] if ci is not None else None
            if c is not None and (c.mi, c.ei) == (mi, i0) and not c.broken_tie:
                kind = "section-start" if _is_section_start(facts, mi) else _start_signal(facts, c, lyric)
                if kind:
                    out.append(Start(mi, None, 0, c.idx, kind, 0))
        # pickup from the bar before: a tail of notes of at most 2 beats (any length below a bar for a movement's anacrusis)
        if mi == 0 or ms[mi - 1]["movement"] != m["movement"]:
            continue
        pm = ms[mi - 1]
        pevs = pm["events"]
        lo, _ = facts.movement_bounds[m["movement"]]
        anacrusis = mi - 1 == lo and pm["lengthTicks"] < pm["barTicks"]
        unit = _bar_unit(pm)
        tail = 0
        best: Start | None = None  # the longest qualifying pickup: one pickup start per bar keeps window ids unique
        for j in range(len(pevs) - 1, -1, -1):
            e = pevs[j]
            if e["kind"] != "note":
                break
            tail += e["dur"]
            if not (tail < pm["barTicks"] and (anacrusis or tail <= 2 * unit)):
                break
            ci = facts.chain_at.get((mi - 1, j))
            if ci is None:
                continue
            c = facts.chains[ci]
            if (c.mi, c.ei) != (mi - 1, j) or c.broken_tie:
                continue
            if anacrusis and c.rest_before >= 10**9:
                best = Start(mi, mi - 1, j, c.idx, "anacrusis", tail)
                continue
            kind = _start_signal(facts, c, lyric)
            if kind:
                best = Start(mi, mi - 1, j, c.idx, kind, tail)
        if best is not None:
            out.append(best)
    return out


def allowed_end(facts: PartFacts, sections: list[Section], mi: int, lyric: bool) -> End | None:
    """The latest cadence note in bar `mi` that 03 section 6.6 allows as a window end, or None."""
    ms = facts.measures
    m = ms[mi]
    evs = m["events"]
    sec = section_of(sections, mi)
    unit = _bar_unit(m)
    cands = sorted({facts.chain_at[(mi, i)] for i, e in enumerate(evs) if e["kind"] == "note" and (mi, i) in facts.chain_at}, reverse=True)
    for ci in cands:
        c = facts.chains[ci]
        if c.end_mi != mi or c.midi < 0:
            continue
        after = evs[c.end_ei + 1 :]
        if after and after[0]["kind"] == "note" and not (lyric and c.lyric_end):
            continue
        head_bar = ms[c.mi]
        rel = c.abs_tick - facts.starts[c.mi]
        if rel not in strong_positions(head_bar["beats"], head_bar["beatType"]):
            continue
        nxt = facts.next_event.get((mi, c.end_ei))
        if nxt is None:
            followed = "movement-end"
        elif ms[nxt[0]]["events"][nxt[1]]["kind"] == "rest":
            followed = "rest"
        elif not after and (m["doubleBarline"] or m["finalBarline"]):
            followed = "barline"
        elif lyric and c.lyric_end:
            followed = "lyric-line"
        else:
            continue
        rest_like = followed in ("rest", "movement-end")
        if c.dur < unit and not rest_like:
            continue
        completed = any(e["kind"] == "note" for e in after)
        if sec.mode is None:
            return End(mi, ci, None, None, followed, completed, mode_unknown=True)
        deg = degree_of(c.midi % 12, sec.fifths, sec.mode)
        if sec.mode in CHURCH_MODES:
            if deg != 1:
                continue
        elif deg in (5, 2):
            if not (c.dur >= 2 * unit and rest_like):
                continue
        elif deg not in (1, 3):
            continue
        return End(mi, ci, deg, cadence_label(facts, sec, c, deg), followed, completed)
    return None


def cadence_label(facts: PartFacts, sec: Section, c: Chain, deg: int) -> str:
    """PAC: degree 1 approached by step from 2 or 7; IAC: degree 3, or degree 1 approached otherwise; HC: 5 or 2."""
    if deg in (5, 2):
        return "HC"
    if deg == 3:
        return "IAC"
    prev = facts.chains[c.idx - 1] if c.idx > 0 and facts.chains[c.idx - 1].movement == c.movement else None
    if prev is not None and prev.midi >= 0 and 0 < abs(c.midi - prev.midi) <= 2:
        mode = sec.mode or "major"
        if degree_of(prev.midi % 12, sec.fifths, mode) in (2, 7):
            return "PAC"
    return "IAC"


# ---------------------------------------------------------------- hard rules

@dataclass
class Candidate:
    start: Start
    end: End
    bars: int
    reason: str | None = None
    detail: str | None = None
    score: float = 0.0
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def first(self) -> int:
        return self.start.first

    @property
    def last(self) -> int:
        return self.end.last


def window_key(c: Candidate) -> str:
    return f"{'p' if c.start.pickup_mi is not None else ''}{c.first}-{c.last}"


def _kept_events(facts: PartFacts, c: Candidate) -> list[tuple[int, int, dict[str, Any]]]:
    """(mi, ei, event) of the window as cut: pickup tail, full bars, the last bar up to the cadence chain's end (plus
    trailing source rests when nothing after the cadence note is replaced)."""
    ms = facts.measures
    out: list[tuple[int, int, dict[str, Any]]] = []
    if c.start.pickup_mi is not None:
        pm = c.start.pickup_mi
        out.extend((pm, i, e) for i, e in enumerate(ms[pm]["events"]) if i >= c.start.pickup_ei)
    for mi in range(c.first, c.last + 1):
        evs = ms[mi]["events"]
        if mi == c.last:
            ch = facts.chains[c.end.chain]
            stop = ch.end_ei + 1 if c.end.completed else len(evs)
            out.extend((mi, i, e) for i, e in enumerate(evs[:stop]))
        else:
            out.extend((mi, i, e) for i, e in enumerate(evs))
    return out


def check_rules(facts: PartFacts, sections: list[Section], c: Candidate) -> tuple[str, str] | None:
    """First failing hard rule as (reason, detail), or None. Order: 6.5/H9 content, H10, completeness, H8, 6.4 tempo,
    mode, fermata, H4/H12 ties, slurs and tuplets, H5 sequences."""
    ms = facts.measures
    s, e = c.start, c.end
    touched = ([s.pickup_mi] if s.pickup_mi is not None else []) + list(range(c.first, c.last + 1))
    first_m = ms[c.first]
    mv = first_m["movement"]
    for mi in touched:
        if ms[mi]["movement"] != mv:
            return "crosses-movement", f"bar index {mi} is in movement {ms[mi]['movement']}"
    for mi in touched:
        if ms[mi]["problems"]:
            p = ms[mi]["problems"][0]
            return f"measure-{p}", f"bar {ms[mi]['number']} (index {mi}): {', '.join(ms[mi]['problems'])}"
    for mi in touched:
        m = ms[mi]
        if (m["beats"], m["beatType"]) != (first_m["beats"], first_m["beatType"]):
            return "meter-change", f"bar {m['number']} is {m['beats']}/{m['beatType']}"
        if m["fifths"] != first_m["fifths"]:
            return "key-change", f"bar {m['number']} has {m['fifths']} fifths"
    for mi in range(c.first, c.last):
        m = ms[mi]
        if m["lengthTicks"] != m["barTicks"]:
            return "incomplete-bar", f"bar {m['number']} holds {m['lengthTicks']} of {m['barTicks']} ticks"
    lm = ms[c.last]
    hi = facts.movement_bounds[mv][1]
    if lm["lengthTicks"] > lm["barTicks"] or (lm["lengthTicks"] < lm["barTicks"] and not (c.last == hi or lm["finalBarline"])):
        return "incomplete-bar", f"last bar {lm['number']} holds {lm['lengthTicks']} of {lm['barTicks']} ticks"
    start_edge = s.pickup_mi if s.pickup_mi is not None else c.first
    for mi in touched:
        marks = set(ms[mi]["marks"])
        if "ottava" in marks:
            return "ottava", f"bar {ms[mi]['number']}"
        bad = marks & BARRIER
        if mi == start_edge:
            bad -= ALLOWED_AT_START
        if mi == c.last:
            bad -= ALLOWED_AT_END
        if bad:
            return "crosses-barrier", f"bar {ms[mi]['number']}: {', '.join(sorted(bad))}"
        if ms[mi]["finalBarline"] and mi != c.last:
            return "crosses-final-barline", f"bar {ms[mi]['number']}"
    # tempo: a marking after the window's first event rejects (6.4). A marking at the window start is its tempo.
    start_mi = s.pickup_mi if s.pickup_mi is not None else c.first
    start_tick = ms[start_mi]["events"][s.pickup_ei]["tick"] if s.pickup_mi is not None else 0
    for mi in touched:
        for t in ms[mi]["tempo"]:
            off = _offset_ticks(t["offset"])
            if mi == start_mi and off <= start_tick:
                continue
            if s.pickup_mi is not None and mi == c.first and off == 0:
                continue
            if mi == c.last and off >= _cut_tick(facts, c):
                continue
            if is_tempo_change(t):
                return "tempo-change", f"bar {ms[mi]['number']}: {t.get('text') or t.get('bpm')}"
    if e.mode_unknown:
        sec = section_of(sections, c.last)
        return "mode-unknown", f"signature {sec.fifths} fifths, final pitch class {sec.final_pc}"
    kept = _kept_events(facts, c)
    cad = facts.chains[e.chain]
    for mi, ei, ev in kept:
        if ev.get("fermata"):
            if facts.chain_at.get((mi, ei)) == cad.idx or (mi == c.last and ei > cad.end_ei):
                continue
            return "interior-fermata", f"bar {ms[mi]['number']}"
    if kept and kept[0][2].get("tieStop"):
        return "tie-cut-start", f"bar {ms[kept[0][0]]['number']}"
    in_window = {facts.chain_at[(mi, ei)] for mi, ei, ev in kept if ev["kind"] == "note" and (mi, ei) in facts.chain_at}
    for ci in sorted(in_window):
        ch = facts.chains[ci]
        if ch.broken_tie:
            return "tie-broken", f"tie stop without a start in bar {ms[ch.mi]['number']}"
        last_ev = ms[ch.end_mi]["events"][ch.end_ei]
        if last_ev.get("tieStart"):
            return ("tie-cut-end" if ci == cad.idx else "tie-broken"), f"tie start without a stop in bar {ms[ch.end_mi]['number']}"
    depth = 0
    for mi, _ei, ev in kept:
        if ev["kind"] != "note":
            continue
        depth -= int(ev.get("slurStops", 0))
        if depth < 0:
            return "slur-cut-start", f"slur stops in bar {ms[mi]['number']} without starting in the window"
        depth += int(ev.get("slurStarts", 0))
    if depth > 0:
        return "slur-cut-end", "a slur is still open at the window end"
    first_ev = kept[0][2]
    if first_ev.get("tuplet") and not first_ev.get("tupletStart"):
        return "tuplet-cut", "the window starts inside a tuplet"
    last_kept = kept[-1][2]
    if last_kept.get("tuplet") and not last_kept.get("tupletStop"):
        return "tuplet-cut", "the window ends inside a tuplet"
    if facts.seq_inside[cad.idx]:
        return "sequence-cut", f"the cadence note in bar {lm['number']} is inside a melodic sequence"
    return None


def _offset_ticks(off: str | float) -> int:
    from fractions import Fraction

    return int(Fraction(str(off)) * 480)


def _cut_tick(facts: PartFacts, c: Candidate) -> int:
    ch = facts.chains[c.end.chain]
    ev = facts.measures[ch.end_mi]["events"][ch.end_ei]
    return ev["tick"] + ev["dur"] if ch.end_mi == c.last else 0


# ---------------------------------------------------------------- phrase quality and scoring

def phrase_quality(c: Candidate, ends: dict[int, End | None]) -> str:
    """03 section 6.7: complete-phrase with no interior allowed end; period with one interior HC or IAC within a bar of
    the midpoint and a PAC at the end; phrase-pair otherwise."""
    interior: list[tuple[int, End]] = []
    for mi in range(c.first, c.last):
        e = ends.get(mi)
        if e is not None and not e.mode_unknown:
            interior.append((mi, e))
    if not interior:
        return "complete-phrase"
    mid = c.bars / 2 - 1
    if len(interior) == 1 and c.end.cadence == "PAC":
        pos = interior[0][0] - c.first
        if abs(pos - mid) <= 1 and interior[0][1].cadence in ("HC", "IAC"):
            return "period"
    return "phrase-pair"


def score(facts: PartFacts, c: Candidate) -> float:
    sc = facts.chains[c.start.chain]
    prev_b = facts.boundary[sc.idx - 1] if sc.idx > 0 and facts.chains[sc.idx - 1].movement == sc.movement else 1.0
    end_b = facts.boundary[c.end.chain] if c.end.followed_by != "movement-end" else 1.0
    return round(prev_b + end_b + (METRICAL_PRIOR if c.bars % 4 == 0 else 0.0), 6)


def lyric_flags(facts: PartFacts, c: Candidate) -> tuple[bool, bool]:
    """Silver-standard inputs (03 section 6.6): does the start / end coincide with a lyric-line boundary within 1 note?
    A boundary sits before chain k when chain k-1 ends a lyric line (or k opens the movement), and after chain k when
    k ends a lyric line (or closes the movement)."""
    ch = facts.chains

    def boundary_before(k: int) -> bool:
        if k <= 0 or k >= len(ch):
            return k == 0
        return ch[k - 1].movement != ch[k].movement or ch[k - 1].lyric_end

    def boundary_after(k: int) -> bool:
        if k < 0 or k >= len(ch):
            return False
        return ch[k].lyric_end or k == len(ch) - 1 or ch[k + 1].movement != ch[k].movement

    s, e = c.start.chain, c.end.chain
    return any(boundary_before(k) for k in (s - 1, s, s + 1)), any(boundary_after(k) for k in (e - 1, e, e + 1))


# ---------------------------------------------------------------- proposal and selection

@dataclass
class PartWindows:
    facts: PartFacts
    sections: list[Section]
    candidates: list[Candidate]  # every proposed pair, with reason set when a rule failed
    primary: list[Candidate]  # selected windows
    fallback: dict[int, Candidate]  # id(primary) -> 8-bar fallback
    ends: dict[int, End | None]
    starts: list[Start]
    tempo_marks: list[tuple[int, int, int, dict[str, Any]]] = field(default_factory=list)


def propose(part: dict[str, Any], lyric: bool, bass: list[dict[str, Any]] | None = None, lengths: range = range(MIN_BARS, MAX_BARS + 1),
            facts: PartFacts | None = None) -> PartWindows:
    facts = facts or build_facts(part)
    sections = section_modes(facts.measures, bass)
    ends = {mi: allowed_end(facts, sections, mi, lyric) for mi in range(len(facts.measures))}
    starts = allowed_starts(facts, lyric)
    cands: list[Candidate] = []
    for s in starts:
        for n in lengths:
            e = ends.get(s.first + n - 1)
            if e is None:
                continue
            c = Candidate(s, e, n)
            fail = check_rules(facts, sections, c)
            if fail:
                c.reason, c.detail = fail
            else:
                c.score = score(facts, c)
            cands.append(c)
    primary, fallback = select(cands)
    return PartWindows(facts, sections, cands, primary, fallback, ends, starts, tempo_marks(facts.measures))


def select(cands: list[Candidate]) -> tuple[list[Candidate], dict[int, Candidate]]:
    ok = [c for c in cands if c.reason is None]
    best: dict[int, Candidate] = {}
    for c in sorted(ok, key=lambda c: (-c.score, c.bars, c.start.pickup_mi is not None, c.start.pickup_ei, c.last)):
        if c.first not in best:
            best[c.first] = c
    for c in ok:
        if best.get(c.first) is not c:
            c.reason, c.detail = "start-measure-taken", f"a better window starts in bar index {c.first}"
    kept: list[Candidate] = []
    for c in sorted(best.values(), key=lambda c: (-c.score, c.first, c.bars)):
        clash = next((k for k in kept if _overlap(k, c) > MAX_OVERLAP), None)
        if clash is not None:
            c.reason, c.detail = "overlap-limit", f"overlaps {window_key(clash)} by more than half its bars"
            continue
        kept.append(c)
    kept.sort(key=lambda c: (c.first, c.last))
    fallback: dict[int, Candidate] = {}
    for c in kept:
        if c.bars > MIN_BARS:
            fb = next((x for x in ok if x.start == c.start and x.bars == MIN_BARS), None)
            if fb is not None:
                fb.reason, fb.detail = None, None
                fallback[id(c)] = fb
    return kept, fallback


def _overlap(a: Candidate, b: Candidate) -> float:
    lo, hi = max(a.first, b.first), min(a.last, b.last)
    inter = max(0, hi - lo + 1)
    return inter / min(a.bars, b.bars)


# ---------------------------------------------------------------- window content

def split_rest(start: int, length: int, unit: int) -> list[tuple[int, int]]:
    """Split a rest span into beat-aligned pieces: up to the next beat, then whole beats."""
    out = []
    t, end = start, start + length
    while t < end:
        nxt = min(end, (t // unit + 1) * unit)
        out.append((t, nxt - t))
        t = nxt
    return out


def build_window(pw: PartWindows, c: Candidate, corpus: str) -> dict[str, Any]:
    """The window as cut, in excerpt ticks (pickup start = 0), with source references on every event."""
    facts = pw.facts
    ms = facts.measures
    first_m = ms[c.first]
    meter = make_meter(first_m["beats"], first_m["beatType"])
    bar = first_m["barTicks"]
    unit = meter["countUnitTicks"]
    sec = section_of(pw.sections, c.last)
    cad = facts.chains[c.end.chain]
    tags: set[str] = set()
    mods: set[str] = {"excerpted"}
    if corpus == "openscore-lieder":
        mods.add("lyrics-removed")
    out_measures: list[dict[str, Any]] = []
    tick0 = 0
    src_bars: list[tuple[int, bool, list[tuple[int, dict[str, Any]]]]] = []
    if c.start.pickup_mi is not None:
        pm = c.start.pickup_mi
        src_bars.append((pm, True, [(i, e) for i, e in enumerate(ms[pm]["events"]) if i >= c.start.pickup_ei]))
    for mi in range(c.first, c.last + 1):
        src_bars.append((mi, False, list(enumerate(ms[mi]["events"]))))
    for k, (mi, is_pick, evs) in enumerate(src_bars):
        m = ms[mi]
        tags.update(m["tags"])
        base = evs[0][1]["tick"] if is_pick and evs else 0
        events: list[dict[str, Any]] = []
        last_bar = k == len(src_bars) - 1
        for i, e in evs:
            if last_bar and i > cad.end_ei and c.end.completed:
                break
            d = {kk: v for kk, v in e.items() if kk != "lyricLineEnd"}
            d["tick"] = tick0 + e["tick"] - base
            d["src"] = [mi, i]
            if d.pop("fermata", None):
                mods.add("fermata-removed")
            events.append(d)
        length = (m["lengthTicks"] - base) if is_pick else bar
        if last_bar:
            end_t = (events[-1]["tick"] + events[-1]["dur"] - tick0) if events else 0
            if c.end.completed:
                for t, du in split_rest(end_t, bar - end_t, unit):
                    events.append({"kind": "rest", "tick": tick0 + t, "dur": du, "completion": True})
                mods.add("final-bar-completed")
                tags.add("next-phrase-cut")
            elif m["lengthTicks"] < bar:
                if c.start.pickup_ticks and c.start.pickup_ticks + m["lengthTicks"] == bar:
                    length = m["lengthTicks"]  # H6: an incomplete final bar that balances the pickup is kept as written
                    tags.add("final-bar-balances-pickup")
                else:
                    for t, du in split_rest(end_t, bar - end_t, unit):
                        events.append({"kind": "rest", "tick": tick0 + t, "dur": du, "completion": True})
                    mods.add("final-bar-completed")
        out_measures.append({"index": k, "isPickup": is_pick, "startTick": tick0, "source": {"index": mi, "number": m["number"]}, "events": events})
        tick0 += length
    if "grace-removed" in tags:
        mods.add("grace-removed")
    if "ornament-removed" in tags:
        mods.add("ornament-removed")
    if c.start.pickup_mi is not None:
        tags.add("pickup")
    modal = sec.mode if sec.mode in CHURCH_MODES else None
    if modal:
        tags.add("modal")
    start_mi = c.start.pickup_mi if c.start.pickup_mi is not None else c.first
    start_tick = ms[start_mi]["events"][c.start.pickup_ei]["tick"] if c.start.pickup_mi is not None else 0
    tempo_at_start = tempo_at(pw.tempo_marks, first_m["movement"], (start_mi, start_tick), c.first if c.start.pickup_mi is not None else None)
    return {
        "meter": meter,
        "fifths": first_m["fifths"],
        "mode": sec.mode,
        "modal": modal,
        "modeBasis": sec.basis,
        "pickupTicks": c.start.pickup_ticks,
        "bars": c.bars,
        "lengthTicks": tick0,
        "measures": out_measures,
        "cadence": {"degree": c.end.degree, "label": c.end.cadence, "followedBy": c.end.followed_by, "midi": cad.midi, "durTicks": cad.dur},
        "tempoAtStart": tempo_at_start,
        "tags": sorted(tags),
        "modifications": [x for x in MOD_ORDER if x in mods],
    }


def tempo_marks(ms: list[dict[str, Any]]) -> list[tuple[int, int, int, dict[str, Any]]]:
    """(movement, measure index, offset ticks, {measure, bpm, text}) of every tempo marking, in score order."""
    out = []
    for mi, m in enumerate(ms):
        for t in m["tempo"]:
            if is_tempo_change(t):
                out.append((m["movement"], mi, _offset_ticks(t["offset"]), {"measure": m["number"], "bpm": t.get("bpm"), "text": t.get("text")}))
    return out


def tempo_at(marks: list[tuple[int, int, int, dict[str, Any]]], movement: int, at: tuple[int, int], also_bar: int | None) -> dict[str, Any] | None:
    """The last tempo marking of the movement at or before `at` (measure index, tick); with a pickup, a marking at
    the first full bar's downbeat (`also_bar`) also counts as the window's tempo."""
    found = None
    for mv, mi, off, t in marks:
        if mv != movement:
            continue
        if (mi, off) <= at or (also_bar is not None and mi == also_bar and off == 0):
            found = t
        elif mi > at[0] and (also_bar is None or mi > also_bar):
            break
    return found
