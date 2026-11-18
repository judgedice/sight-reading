"""Stage `read` (03 section 6.3, job C3a): OpenScore `.mxl` to a plain, JSON-ready dump of each candidate part.

`music21.converter.parse` reads the file. A parse failure rejects the file with a reason (12 String Quartets files are
expected to fail) and nothing is dropped silently. Every part gets a `kind=part` record. Only candidate parts (6.5,
`roles.py`) are converted: piano parts are not read, so their measures are never dumped.

The dump keeps everything the normalizer (6.4) needs and nothing music21-specific: exact fractions as strings,
every note and rest with its voice, grace, cue and hidden flags, articulations, expressions, lyrics (text only), spanner
membership, barlines, repeat markers, tempo and key and time signatures. Measure numbers are kept as printed.

Cue notes: music21 ignores MusicXML `<cue/>`, so files that contain it are preprocessed once (the `<type>` of each cue
note gets `size="cue"`, which music21 keeps as `style.noteSize`). Every other file is parsed directly.
"""

from __future__ import annotations

import io
import re
import warnings
import zipfile
from fractions import Fraction
from pathlib import Path
from typing import Any
import xml.etree.ElementTree as ET

from .roles import PartInfo, classify_parts

TPQ = 480
SOUNDS_BARRIER = ("segno", "coda", "dacapo", "dalsegno", "fine", "tocoda")
REPEAT_TEXT_RE = re.compile(r"(d\.\s?c\.|d\.\s?s\.|da capo|dal segno|\bfine\b|to coda|al coda|al fine)", re.I)
LYRIC_END_CHARS = ",;:.!?"
GENERAL_NOTE = ("GeneralNote",)


def _exact(x: Any) -> str:
    """Exact Fraction string. music21 gives Fraction, int or float (binary floats are snapped to 1/10^6 at worst)."""
    if isinstance(x, Fraction):
        return str(x)
    f = Fraction(x)
    if f.denominator > 1000:
        f = f.limit_denominator(10**6)
    return str(f)


def _mxl_bytes(path: Path) -> bytes:
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        main = None
        if "META-INF/container.xml" in names:
            rf = ET.fromstring(z.read("META-INF/container.xml")).find(".//rootfile")
            if rf is not None and rf.get("full-path") in names:
                main = rf.get("full-path")
        if main is None:
            cand = [n for n in names if n.endswith((".xml", ".musicxml")) and not n.startswith("META-INF")]
            if not cand:
                raise ValueError("no MusicXML document inside the .mxl")
            main = cand[0]
        return z.read(main)


def preprocess_cues(data: bytes) -> tuple[bytes, int]:
    """Mark `<cue/>` notes so music21 keeps them as cue-sized. Returns (xml, number of cue notes)."""
    root = ET.fromstring(data)
    n = 0
    for note in root.iter("note"):
        if note.find("cue") is not None:
            n += 1
            t = note.find("type")
            if t is None:
                t = ET.Element("type")
                t.text = "quarter"  # only the size attribute is read
                note.append(t)
            t.set("size", "cue")
    out = io.BytesIO()
    ET.ElementTree(root).write(out, encoding="utf-8", xml_declaration=True)
    return out.getvalue(), n


def parse_score(path: Path) -> tuple[Any, int]:
    """Parse with music21. Returns (score, cue notes marked). Raises on failure."""
    from music21 import converter

    warnings.simplefilter("ignore")
    data = _mxl_bytes(path)
    if b"<cue" in data:
        xml, ncue = preprocess_cues(data)
        return converter.parse(xml.decode("utf-8"), format="musicxml"), ncue
    return converter.parse(str(path)), 0


def part_info(index: int, part: Any) -> PartInfo:
    inst = part.getInstrument(returnDefault=True)
    return PartInfo(
        index=index,
        id=str(part.id),
        name=str(part.partName or ""),
        instrument=str(inst.instrumentName or ""),
        sound=str(getattr(inst, "instrumentSound", None) or ""),
    )


def _pitch(p: Any) -> dict[str, Any]:
    acc = p.accidental
    d: dict[str, Any] = {"step": p.step, "alter": float(acc.alter) if acc is not None else 0.0, "octave": p.octave}
    micro = p.microtone.cents if p.microtone is not None else 0
    if micro:
        d["microtone"] = float(micro)
    return d


def _spanner_maps(part: Any) -> dict[str, Any]:
    from music21 import dynamics, spanner, expressions

    slur_start: dict[int, int] = {}
    slur_stop: dict[int, int] = {}
    wedge_start: dict[int, str] = {}
    wedge_stop: set[int] = set()
    trill_ext: set[int] = set()
    volta: dict[int, tuple[str, bool]] = {}
    ottava: set[int] = set()
    for sp in part.spannerBundle:
        els = sp.getSpannedElements()
        if not els:
            continue
        if isinstance(sp, spanner.Slur):
            slur_start[id(els[0])] = slur_start.get(id(els[0]), 0) + 1
            slur_stop[id(els[-1])] = slur_stop.get(id(els[-1]), 0) + 1
        elif isinstance(sp, dynamics.DynamicWedge):
            wedge_start[id(els[0])] = "cresc" if isinstance(sp, dynamics.Crescendo) else "dim"
            wedge_stop.add(id(els[-1]))
        elif isinstance(sp, expressions.TrillExtension):
            trill_ext.update(id(e) for e in els)
        elif isinstance(sp, spanner.RepeatBracket):
            for i, e in enumerate(els):
                volta[id(e)] = (str(sp.number or ""), i == 0)
        elif isinstance(sp, spanner.Ottava):
            ottava.update(id(e) for e in els)
    return {"slur_start": slur_start, "slur_stop": slur_stop, "wedge_start": wedge_start, "wedge_stop": wedge_stop,
            "trill_ext": trill_ext, "volta": volta, "ottava": ottava}


def _articulations(n: Any) -> tuple[list[str], bool]:
    from music21 import articulations as A

    out: list[str] = []
    breath = False
    for a in n.articulations:
        if isinstance(a, (A.Staccato, A.Staccatissimo, A.Spiccato)):
            out.append("staccato")
        elif isinstance(a, A.Tenuto):
            out.append("tenuto")
        elif isinstance(a, A.StrongAccent):
            out.append("marcato")
        elif isinstance(a, A.Accent):
            out.append("accent")
        elif isinstance(a, A.DetachedLegato):
            out.extend(["staccato", "tenuto"])
        elif isinstance(a, A.BreathMark):
            breath = True
    seen: list[str] = []
    for a in out:
        if a not in seen:
            seen.append(a)
    return seen, breath


def _expressions(n: Any, in_trill_ext: bool) -> dict[str, bool]:
    from music21 import expressions as E

    fermata = ornament = tremolo = False
    for e in n.expressions:
        if isinstance(e, E.Fermata):
            fermata = True
        elif isinstance(e, E.Tremolo):
            tremolo = True
        elif isinstance(e, E.Ornament):
            ornament = True
    return {"fermata": fermata, "ornament": ornament or in_trill_ext, "tremolo": tremolo}


def _element(n: Any, voice: str, offset: Any, sm: dict[str, Any]) -> dict[str, Any] | None:
    from music21 import chord, note

    if isinstance(n, note.Rest):
        kind = "rest"
    elif isinstance(n, chord.Chord):
        kind = "chord"
    elif isinstance(n, note.Unpitched):
        kind = "unpitched"
    elif isinstance(n, note.Note):
        kind = "note"
    else:
        return None
    dur = n.duration
    nid = id(n)
    e: dict[str, Any] = {
        "kind": kind,
        "voice": voice,
        "offset": _exact(offset),
        "ql": _exact(dur.quarterLength),
        "grace": bool(dur.isGrace),
    }
    style = getattr(n, "style", None)
    if style is not None:
        if getattr(style, "hideObjectOnPrint", False):
            e["hidden"] = True
        if getattr(style, "noteSize", None) == "cue":
            e["cue"] = True
    if kind == "rest":
        e["fullMeasure"] = bool(getattr(n, "fullMeasure", False) in (True, "always"))
    elif kind == "chord":
        e["pitches"] = [_pitch(p) for p in n.pitches]
    elif kind == "note":
        e["pitch"] = _pitch(n.pitch)
    if kind in ("note", "chord"):
        t = n.tie
        if t is not None:
            e["tieStart"] = t.type in ("start", "continue")
            e["tieStop"] = t.type in ("stop", "continue")
        arts, breath = _articulations(n)
        if arts:
            e["artic"] = arts
        if breath:
            e["breath"] = True
        if n.lyrics:
            ends = False
            for ly in n.lyrics:
                txt = (ly.text or "").strip()
                if txt and txt[-1] in LYRIC_END_CHARS:
                    ends = True
            e["lyric"] = True
            if ends:
                e["lyricLineEnd"] = True
    for k, v in _expressions(n, nid in sm["trill_ext"]).items():
        if v:
            e[k] = True
    if nid in sm["slur_start"]:
        e["slurStarts"] = sm["slur_start"][nid]
    if nid in sm["slur_stop"]:
        e["slurStops"] = sm["slur_stop"][nid]
    if nid in sm["wedge_start"]:
        e["hairpin"] = sm["wedge_start"][nid]
    elif nid in sm["wedge_stop"]:
        e["hairpin"] = "end"
    if nid in sm["ottava"]:
        e["ottava"] = True
    tups = dur.tuplets
    if tups:
        tp = tups[0]
        e["tuplet"] = [int(tp.numberNotesActual), int(tp.numberNotesNormal)]
        if tp.type == "start":
            e["tupletStart"] = True
        elif tp.type == "stop":
            e["tupletStop"] = True
    return e


def _barline(b: Any) -> dict[str, Any] | None:
    from music21 import bar

    if b is None:
        return None
    d: dict[str, Any] = {"type": str(b.type)}
    if isinstance(b, bar.Repeat):
        d["repeat"] = str(b.direction)
    return d


def _convert_measure(m: Any, index: int, sm: dict[str, Any]) -> dict[str, Any]:
    from music21 import dynamics, expressions, key, meter, repeat, tempo

    out: dict[str, Any] = {
        "index": index,
        "number": int(m.number) if m.number is not None else None,
        "suffix": str(m.numberSuffix or ""),
        "implicit": bool(getattr(m, "showNumber", None) is not None and str(getattr(m.showNumber, "value", m.showNumber)) == "never"),
        "elements": [],
        "marks": [],
    }
    marks: list[str] = out["marks"]
    mid = id(m)
    if mid in sm["volta"]:
        marks.append("volta")
        if sm["volta"][mid][1]:
            marks.append("volta-start")
    if mid in sm["ottava"]:
        marks.append("ottava")
    for side, b in (("left", m.leftBarline), ("right", m.rightBarline)):
        bd = _barline(b)
        if bd:
            out[f"{side}Barline"] = bd
            if "repeat" in bd:
                marks.append(f"repeat-{bd['repeat']}")
    dyns: list[dict[str, Any]] = []
    tempi: list[dict[str, Any]] = []
    for el in m.getElementsByClass(GENERAL_NOTE):  # notes outside any Voice (all of them in a one-voice measure)
        e = _element(el, "1", el.offset, sm)
        if e is not None:
            out["elements"].append(e)
    for v in m.voices:
        for el in v.getElementsByClass(GENERAL_NOTE):
            e = _element(el, str(v.id), v.offset + el.offset, sm)
            if e is not None:
                out["elements"].append(e)
    for el in m.elements:
        if isinstance(el, meter.TimeSignature):
            out["timeSig"] = {"num": int(el.numerator), "den": int(el.denominator), "offset": _exact(el.offset), "text": str(el.ratioString)}
        elif isinstance(el, key.KeySignature):
            d: dict[str, Any] = {"fifths": int(el.sharps), "offset": _exact(el.offset)}
            if isinstance(el, key.Key):
                d["mode"] = str(el.mode)
            out["keySig"] = d
        elif isinstance(el, dynamics.Dynamic):
            dyns.append({"offset": _exact(el.offset), "value": str(el.value)})
        elif isinstance(el, tempo.MetronomeMark):
            if el.number is not None:  # a printed metronome mark. <sound tempo> (playback) has number=None.
                q = float(el.number) * float(el.referent.quarterLength) if el.referent is not None else float(el.number)
                tempi.append({"offset": _exact(el.offset), "bpm": round(q, 3), "text": str(el.text) if el.text and not el.textImplicit else None})
        elif isinstance(el, (expressions.TextExpression, tempo.TempoText)):
            txt = str(el.content if hasattr(el, "content") else el.text).strip()
            if txt:
                tempi.append({"offset": _exact(el.offset), "bpm": None, "text": txt})
                if REPEAT_TEXT_RE.search(txt):
                    marks.append("repeat-text")
        elif isinstance(el, repeat.RepeatExpression):
            marks.append("segno" if isinstance(el, repeat.Segno) else "coda" if isinstance(el, repeat.Coda) else "repeat-expression")
    out["dynamics"] = dyns
    out["tempo"] = tempi
    return out


def convert_part(part: Any) -> dict[str, Any]:
    from music21 import stream

    sm = _spanner_maps(part)
    measures = [_convert_measure(m, i, sm) for i, m in enumerate(part.getElementsByClass(stream.Measure))]
    return {"measures": measures}


def score_meta(score: Any) -> dict[str, Any]:
    md = score.metadata
    out: dict[str, Any] = {}
    if md is not None:
        for k, v in (("title", md.title), ("composer", md.composer), ("movementName", md.movementName), ("movementNumber", md.movementNumber)):
            if v:
                out[k] = str(v)
    return out


def read_file(abs_path: str, corpus: str) -> dict[str, Any]:
    """Worker. Returns {ok, error?, meta, parts: [{info, convert}], cueNotes}. Pure data, picklable."""
    try:
        score, ncue = parse_score(Path(abs_path))
    except Exception as e:  # noqa: BLE001 - any parse failure rejects the file with a reason
        return {"ok": False, "error": f"{type(e).__name__}: {str(e)[:200]}"}
    parts = list(score.parts)
    if not parts:
        return {"ok": False, "error": "no parts", "reason": "no-parts"}
    infos = [part_info(i, p) for i, p in enumerate(parts)]
    decisions = classify_parts(corpus, infos)
    res_parts: list[dict[str, Any]] = []
    for info, p in zip(infos, parts):
        entry: dict[str, Any] = {"info": {"index": info.index, "id": info.id, "name": info.name, "instrument": info.instrument, "sound": info.sound}}
        if decisions[info.index].accept:
            entry["data"] = convert_part(p)
        res_parts.append(entry)
    return {"ok": True, "meta": score_meta(score), "cueNotes": ncue, "parts": res_parts}
