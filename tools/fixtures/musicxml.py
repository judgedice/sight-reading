"""Minimal MusicXML reader for the P0e fixture extractor (stdlib only, no music21).

Reads an OpenScore `.mxl` (zipped MusicXML 3.1 partwise) and returns, per part, a list of measures
with monophonic events at TPQ = 480. It does not repair anything: every construct the excerpt
format cannot hold (chords, a second voice with notes, hidden notes, non-integer ticks, cue notes)
is recorded on the measure as a `problems` entry, so the window scanner can reject the window with
a reason (03 §6.4, §6.5, §6.9 "Encoding errors").

Run with `python3 -I`; the module is imported by `scan.py` and `extract.py` from the same folder.
"""

from __future__ import annotations

import re
import zipfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from fractions import Fraction

TPQ = 480
STEPS = "CDEFGAB"
STEP_SEMIS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
DYNAMICS = {"pp", "p", "mp", "mf", "f", "ff", "fp", "sfz"}
ORNAMENT_TAGS = {"trill-mark", "turn", "inverted-turn", "delayed-turn", "mordent", "inverted-mordent", "shake", "schleifer", "wavy-line"}


@dataclass
class Event:
    kind: str  # 'note' | 'rest'
    tick: int  # from measure start
    dur: int
    step: str | None = None
    alter: int = 0
    octave: int | None = None
    tie_start: bool = False
    tie_stop: bool = False
    slur_starts: int = 0
    slur_stops: int = 0
    tuplet: tuple[int, int] | None = None  # (actual, normal)
    tuplet_start: bool = False
    tuplet_stop: bool = False
    artic: list[str] = field(default_factory=list)
    dynamic: str | None = None
    hairpin: str | None = None
    breath: bool = False
    fermata: bool = False
    ornament: bool = False
    tremolo: bool = False
    lyric: bool = False
    lyric_line_end: bool = False
    measure_rest: bool = False

    def midi(self) -> int:
        assert self.step is not None and self.octave is not None
        return (self.octave + 1) * 12 + STEP_SEMIS[self.step] + self.alter


@dataclass
class MeasureData:
    number: str  # printed number, e.g. "12" or "12a"
    index: int  # 0-based position in the part
    movement: int  # 1-based, counted where the printed bar number restarts
    implicit: bool
    beats: int
    beat_type: int
    fifths: int
    mode: str | None
    clefs: list[str]  # clefs in force during the measure (sign+line codes), first = at start
    events: list[Event]
    problems: list[str]
    grace_removed: int = 0
    repeat_or_volta: bool = False  # repeat sign, volta, segno, coda or D.C./D.S. touches this measure
    final_barline: bool = False  # light-heavy or double barline at the end
    double_barline: bool = False
    tempo_words: list[str] = field(default_factory=list)
    metronome: float | None = None  # printed metronome mark, quarter-note equivalent bpm (playback <sound tempo> is ignored)
    time_change: bool = False
    key_change: bool = False

    def length(self) -> int:
        return sum(e.dur for e in self.events)

    def bar_ticks(self) -> int:
        return self.beats * TPQ * 4 // self.beat_type


@dataclass
class PartData:
    pid: str
    name: str
    instrument: str
    measures: list[MeasureData]


@dataclass
class ScoreData:
    work_title: str
    work_number: str
    movement_title: str
    composer: str
    parts: list[PartData]


def _text(el: ET.Element | None, path: str, default: str = "") -> str:
    if el is None:
        return default
    found = el.find(path)
    return (found.text or "").strip() if found is not None and found.text else default


def read_root(path: str) -> ET.Element:
    with zipfile.ZipFile(path) as z:
        names = [n for n in z.namelist() if n.endswith(".xml") and not n.startswith("META-INF")]
        container = z.read("META-INF/container.xml") if "META-INF/container.xml" in z.namelist() else None
        main = names[0]
        if container is not None:
            croot = ET.fromstring(container)
            rf = croot.find(".//rootfile")
            if rf is not None and rf.get("full-path"):
                main = rf.get("full-path") or main
        data = z.read(main)
    return ET.fromstring(data)


def clef_code(clef: ET.Element) -> str:
    sign = _text(clef, "sign")
    line = _text(clef, "line")
    octave = _text(clef, "clef-octave-change", "0")
    if sign == "G" and octave == "-1":
        return "treble-8vb"
    if sign == "G":
        return "treble"
    if sign == "F":
        return "bass"
    if sign == "C" and line == "3":
        return "alto"
    if sign == "C" and line == "4":
        return "tenor"
    return f"{sign}{line}"


def parse_score(path: str) -> ScoreData:
    root = read_root(path)
    work_title = _text(root, "work/work-title")
    work_number = _text(root, "work/work-number")
    movement_title = _text(root, "movement-title")
    composer = ""
    for c in root.findall("identification/creator"):
        if c.get("type") == "composer":
            composer = (c.text or "").strip()
    names: dict[str, tuple[str, str]] = {}
    for sp in root.findall("part-list/score-part"):
        names[sp.get("id", "")] = (_text(sp, "part-name"), _text(sp, "score-instrument/instrument-name"))
    parts = []
    for part in root.findall("part"):
        pid = part.get("id", "")
        pname, iname = names.get(pid, ("", ""))
        parts.append(PartData(pid, pname, iname, _parse_part(part)))
    return ScoreData(work_title, work_number, movement_title, composer, parts)


def _parse_part(part: ET.Element) -> list[MeasureData]:
    divisions = 1
    beats, beat_type = 4, 4
    fifths, mode = 0, None
    clef = "treble"
    movement = 1
    out: list[MeasureData] = []
    pending_dynamic: str | None = None
    pending_hairpin: str | None = None
    for mi, m in enumerate(part.findall("measure")):
        problems: list[str] = []
        time_change = key_change = False
        clefs = [clef]
        tempo_words: list[str] = []
        metronome = None
        repeat_or_volta = False
        final_barline = double_barline = False
        # voice -> list of (tick, Event)
        voices: dict[str, list[Event]] = {}
        pos = Fraction(0)
        last_note_start = Fraction(0)
        grace_removed = 0
        tuplet_stack: tuple[int, int] | None = None
        for el in m:
            tag = el.tag
            if tag == "attributes":
                d = el.find("divisions")
                if d is not None and d.text:
                    divisions = int(d.text)
                t = el.find("time")
                if t is not None and t.find("beats") is not None:
                    nb, nt = int(_text(t, "beats").split("+")[0]), int(_text(t, "beat-type"))
                    if "+" in _text(t, "beats"):
                        problems.append("composite-meter")
                    if (nb, nt) != (beats, beat_type) and mi > 0:
                        time_change = True
                    if (nb, nt) != (beats, beat_type) and pos > 0:
                        problems.append("mid-measure-time-change")
                    beats, beat_type = nb, nt
                k = el.find("key")
                if k is not None and k.find("fifths") is not None:
                    nf = int(_text(k, "fifths"))
                    nm = _text(k, "mode") or None
                    if (nf, nm) != (fifths, mode) and mi > 0:
                        key_change = True
                    if pos > 0 and nf != fifths:
                        problems.append("mid-measure-key-change")
                    fifths, mode = nf, nm
                for c in el.findall("clef"):
                    if c.get("number") not in (None, "1"):
                        continue
                    code = clef_code(c)
                    if pos == 0 and len(clefs) == 1:
                        clefs[0] = code
                    elif code != clefs[-1]:
                        clefs.append(code)
                    clef = code
                if el.find("staves") is not None and _text(el, "staves") not in ("", "1"):
                    problems.append("multi-staff")
                if el.find("measure-style/multiple-rest") is not None:
                    pass
            elif tag == "direction":
                for dt in el.findall("direction-type"):
                    for w in dt.findall("words"):
                        if w.text and w.text.strip():
                            txt = w.text.strip()
                            tempo_words.append(txt)
                            low = txt.lower()
                            if any(s in low for s in ("d.c.", "d.s.", "da capo", "dal segno", "fine", "to coda")):
                                repeat_or_volta = True
                    if dt.find("segno") is not None or dt.find("coda") is not None:
                        repeat_or_volta = True
                    dyn = dt.find("dynamics")
                    if dyn is not None:
                        for ch in dyn:
                            if ch.tag in DYNAMICS:
                                pending_dynamic = ch.tag
                    wedge = dt.find("wedge")
                    if wedge is not None:
                        wt = wedge.get("type")
                        pending_hairpin = {"crescendo": "cresc", "diminuendo": "dim", "stop": "end"}.get(wt or "", None)
                    met = dt.find("metronome")
                    if met is not None and met.find("per-minute") is not None:
                        try:
                            per = float(_text(met, "per-minute"))
                            unit = _text(met, "beat-unit")
                            dotted = met.find("beat-unit-dot") is not None
                            q = {"whole": 4, "half": 2, "quarter": 1, "eighth": 0.5, "16th": 0.25}.get(unit, 1) * (1.5 if dotted else 1)
                            metronome = per * q
                        except ValueError:
                            pass
            elif tag == "sound":
                if any(el.get(a) for a in ("segno", "coda", "dacapo", "dalsegno", "fine", "tocoda")):
                    repeat_or_volta = True
            elif tag == "backup":
                pos -= Fraction(int(_text(el, "duration", "0")), divisions)
            elif tag == "forward":
                pos += Fraction(int(_text(el, "duration", "0")), divisions)
            elif tag == "barline":
                if el.find("repeat") is not None or el.find("ending") is not None:
                    repeat_or_volta = True
                if el.find("segno") is not None or el.find("coda") is not None:
                    repeat_or_volta = True
                style = _text(el, "bar-style")
                if el.get("location", "right") == "right":
                    if style == "light-heavy":
                        final_barline = True
                    if style in ("light-light", "heavy-heavy", "light-heavy"):
                        double_barline = True
            elif tag == "note":
                if el.find("grace") is not None:
                    grace_removed += 1
                    continue
                if el.find("cue") is not None:
                    problems.append("cue-note")
                    continue
                dur_div = int(_text(el, "duration", "0"))
                is_chord = el.find("chord") is not None
                voice = _text(el, "voice", "1")
                start = last_note_start if is_chord else pos
                if is_chord:
                    problems.append("chord")
                    continue
                dur_q = Fraction(dur_div, divisions)
                ticks_f = dur_q * TPQ
                tick_f = start * TPQ
                if ticks_f.denominator != 1 or tick_f.denominator != 1:
                    problems.append("non-integer-ticks")
                if el.get("print-object") == "no" and el.find("rest") is None:
                    problems.append("hidden-note")
                ev = Event(kind="rest" if el.find("rest") is not None else "note", tick=int(tick_f), dur=int(ticks_f))
                if ev.kind == "rest":
                    r = el.find("rest")
                    ev.measure_rest = r is not None and r.get("measure") == "yes"
                else:
                    p = el.find("pitch")
                    if p is None:
                        problems.append("unpitched")
                        pos += dur_q
                        continue
                    ev.step = _text(p, "step")
                    alt = _text(p, "alter", "0")
                    try:
                        af = float(alt)
                    except ValueError:
                        af = 0
                    if af != int(af):
                        problems.append("microtone")
                    ev.alter = int(af)
                    ev.octave = int(_text(p, "octave"))
                    for t in el.findall("tie"):
                        if t.get("type") == "start":
                            ev.tie_start = True
                        if t.get("type") == "stop":
                            ev.tie_stop = True
                    if el.find("lyric") is not None:
                        ev.lyric = True
                        for ly in el.findall("lyric"):
                            txt = _text(ly, "text")
                            if txt and txt[-1] in ",;:.!?":
                                ev.lyric_line_end = True
                    if pending_dynamic:
                        ev.dynamic = pending_dynamic
                        pending_dynamic = None
                    if pending_hairpin:
                        ev.hairpin = pending_hairpin
                        pending_hairpin = None
                tm = el.find("time-modification")
                if tm is not None:
                    ev.tuplet = (int(_text(tm, "actual-notes")), int(_text(tm, "normal-notes")))
                    if tm.find("normal-type") is not None and tuplet_stack is None:
                        pass
                nots = el.findall("notations")
                for n in nots:
                    for s in n.findall("slur"):
                        if s.get("type") == "start":
                            ev.slur_starts += 1
                        elif s.get("type") == "stop":
                            ev.slur_stops += 1
                    for tup in n.findall("tuplet"):
                        if tup.get("type") == "start":
                            ev.tuplet_start = True
                        if tup.get("type") == "stop":
                            ev.tuplet_stop = True
                    if n.find("fermata") is not None:
                        ev.fermata = True
                    orn = n.find("ornaments")
                    if orn is not None:
                        for o in orn:
                            if o.tag in ORNAMENT_TAGS:
                                ev.ornament = True
                            if o.tag == "tremolo":
                                ev.tremolo = True
                    art = n.find("articulations")
                    if art is not None:
                        for a in art:
                            if a.tag in ("staccato", "staccatissimo", "spiccato"):
                                ev.artic.append("staccato")
                            elif a.tag == "tenuto":
                                ev.artic.append("tenuto")
                            elif a.tag == "accent":
                                ev.artic.append("accent")
                            elif a.tag == "strong-accent":
                                ev.artic.append("marcato")
                            elif a.tag == "breath-mark":
                                ev.breath = True
                            elif a.tag == "detached-legato":
                                ev.artic.extend(["staccato", "tenuto"])
                    if n.find("tied") is not None and ev.kind == "note":
                        for t in n.findall("tied"):
                            if t.get("type") == "start":
                                ev.tie_start = True
                            if t.get("type") == "stop":
                                ev.tie_stop = True
                    if n.find("arpeggiate") is not None:
                        problems.append("arpeggiate")
                # de-duplicate articulation list, keep order
                seen: list[str] = []
                for a in ev.artic:
                    if a not in seen:
                        seen.append(a)
                ev.artic = seen
                voices.setdefault(voice, []).append(ev)
                last_note_start = start
                pos += dur_q
        # Voice handling: keep the single voice that carries notes; others must be rests only.
        note_voices = [v for v, evs in voices.items() if any(e.kind == "note" for e in evs)]
        if len(note_voices) > 1:
            problems.append("second-voice")
        main_voice = note_voices[0] if note_voices else (sorted(voices)[0] if voices else "1")
        events = sorted(voices.get(main_voice, []), key=lambda e: e.tick)
        # contiguity check
        t = 0
        for e in events:
            if e.tick != t:
                problems.append("gap-or-overlap")
                break
            t += e.dur
        md = MeasureData(
            number=m.get("number", str(mi + 1)),
            index=mi,
            movement=movement,
            implicit=m.get("implicit") == "yes",
            beats=beats,
            beat_type=beat_type,
            fifths=fifths,
            mode=mode,
            clefs=clefs,
            events=events,
            problems=problems,
            grace_removed=grace_removed,
            repeat_or_volta=repeat_or_volta,
            final_barline=final_barline,
            double_barline=double_barline,
            tempo_words=tempo_words,
            metronome=metronome,
            time_change=time_change,
            key_change=key_change,
        )
        # A whole-measure rest is written with the bar's duration; normalise its tick length.
        if len(events) == 1 and events[0].kind == "rest" and events[0].measure_rest:
            events[0].dur = md.bar_ticks()
        out.append(md)
    # Movements: a new movement starts where the printed bar number restarts (OpenScore numbers each movement
    # from 1, or 0 for an anacrusis). Final barlines are not used: repeated sections inside a movement end in them.
    movement = 1
    prev_num: int | None = None
    for md in out:
        mnum = re.match(r"\d+", md.number)
        num = int(mnum.group(0)) if mnum else None
        if num is not None and prev_num is not None and num <= prev_num and not (num == prev_num and md.number != str(num)):
            movement += 1
        md.movement = movement
        if num is not None:
            prev_num = num
    return out
