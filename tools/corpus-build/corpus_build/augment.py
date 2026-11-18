"""Rhythmic augmentation x2 (03 section 6.8, 02 §3.3, job C5).

Three sources, and only these (never into 2/2, 3/2 or 6/4, never from 3/4 or 6/8):
- 8 bars of 2/4 become 8 bars of 4/4 (old beat 2 becomes beat 3): every tick doubles, each bar maps to one bar;
- 8 bars of 3/8 become 8 bars of 3/4, the same way;
- a complete 4-bar phrase (a 4-bar window that passes every hard rule and has no interior allowed end) in 2/4 or
  4/4 becomes 8 bars in the same meter: each source bar becomes two bars, and notes that now cross a barline are
  split and tied.

The 8-bar sources are the passing windows of stage `windows`. 4-bar phrases are proposed here with the same start, end
and rule code (`windows.propose` with lengths {4}), one per start bar and at most 50% overlap among themselves.

A variant id is the source id plus `-aug2`. It carries `modifications += rhythm-augmented-x2`, `augmentOf` (the source
window or phrase), `dedupeWith` (passing windows of the same part that contain the same bars; C7 gives them one
`dedupeGroup`) and `requiresLevelMax: 3`: 03 section 6.8 emits a variant only when its re-tagged level is L1 to L3, and
the level is C6's to compute.
"""

from __future__ import annotations

from typing import Any

from .phrase import make_meter
from .windows import MOD_ORDER, build_window, lyric_flags, phrase_quality, propose, window_key

SCALE_MAP = {"2/4": (4, 4), "3/8": (3, 4)}
PHRASE_METERS = {"2/4", "4/4"}
LEVEL_MAX = 3


def _mods(mods: list[str]) -> list[str]:
    s = set(mods) | {"rhythm-augmented-x2"}
    return [m for m in MOD_ORDER if m in s]


def scale_window(content: dict[str, Any], beats: int, beat_type: int) -> dict[str, Any]:
    """Double every tick of an 8-bar window, one bar to one bar (2/4 -> 4/4, 3/8 -> 3/4)."""
    out = {k: v for k, v in content.items() if k not in ("measures", "meter", "pickupTicks", "lengthTicks", "cadence")}
    out["meter"] = make_meter(beats, beat_type)
    out["pickupTicks"] = content["pickupTicks"] * 2
    out["lengthTicks"] = content["lengthTicks"] * 2
    out["cadence"] = dict(content["cadence"], durTicks=content["cadence"]["durTicks"] * 2)
    out["measures"] = [
        dict(m, startTick=m["startTick"] * 2, events=[dict(e, tick=e["tick"] * 2, dur=e["dur"] * 2) for e in m["events"]]) for m in content["measures"]
    ]
    out["modifications"] = _mods(content["modifications"])
    out["tags"] = sorted(set(content["tags"]) | {"aug2"})
    return out


class AugmentError(Exception):
    def __init__(self, reason: str, detail: str):
        super().__init__(detail)
        self.reason, self.detail = reason, detail


def double_phrase(content: dict[str, Any]) -> dict[str, Any]:
    """Double a 4-bar phrase into 8 bars of the same meter. Notes crossing a new barline are split and tied."""
    meter = content["meter"]
    bar = meter["countUnitTicks"] * meter["countsPerBar"]
    unit = meter["countUnitTicks"]
    p2 = content["pickupTicks"] * 2
    if p2 and (p2 >= bar or p2 > 2 * unit):
        raise AugmentError("aug-pickup-too-long", f"the doubled pickup is {p2} ticks, the bar {bar}")
    evs: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for m in content["measures"]:
        for e in m["events"]:
            evs.append((m, dict(e, tick=e["tick"] * 2, dur=e["dur"] * 2)))
    total = content["lengthTicks"] * 2
    # bar boundaries in the doubled stream
    bounds = [0] + ([p2] if p2 else [])
    t = p2
    while t + bar < total:
        t += bar
        bounds.append(t)
    bounds.append(total)
    pieces: list[list[dict[str, Any]]] = [[] for _ in range(len(bounds) - 1)]
    for src_m, e in evs:
        start, end = e["tick"], e["tick"] + e["dur"]
        segs = []
        for k in range(len(bounds) - 1):
            lo, hi = bounds[k], bounds[k + 1]
            a, b = max(start, lo), min(end, hi)
            if a < b:
                segs.append((k, a, b))
        if len(segs) > 1 and e.get("tuplet"):
            raise AugmentError("aug-tuplet-across-barline", f"a tuplet note from source bar {src_m['source']['number']} would cross a barline")
        for n, (k, a, b) in enumerate(segs):
            d = dict(e, tick=a, dur=b - a)
            if len(segs) > 1 and e["kind"] == "note":
                first, last = n == 0, n == len(segs) - 1
                if not last:
                    d["tieStart"] = True
                    for key in ("slurStops", "breath"):
                        d.pop(key, None)
                if not first:
                    d["tieStop"] = True
                    for key in ("slurStarts", "artic", "dynamic", "hairpin", "tupletStart"):
                        d.pop(key, None)
                if last and e.get("tieStart"):
                    d["tieStart"] = True
                if not last:
                    d.pop("tupletStop", None)
            d.pop("measureRest", None)
            d["src"] = e.get("src")
            pieces[k].append(d)
    measures = []
    src_index = {}
    for m in content["measures"]:
        src_index[m["startTick"] * 2] = m["source"]
    for k in range(len(bounds) - 1):
        lo = bounds[k]
        is_pick = bool(p2) and k == 0
        # the source bar this new bar came from: the source measure whose doubled span contains lo
        src = None
        for m in content["measures"]:
            if m["startTick"] * 2 <= lo:
                src = m["source"]
        half = 0 if lo in src_index else 1
        measures.append({"index": k, "isPickup": is_pick, "startTick": lo, "source": dict(src or {}, half=half), "events": pieces[k]})
    full = [m for m in measures if not m["isPickup"]]
    if len(full) != 8:
        raise AugmentError("aug-length", f"{len(full)} bars after doubling")
    out = {k: v for k, v in content.items() if k not in ("measures", "pickupTicks", "lengthTicks", "cadence", "bars")}
    out.update(measures=measures, pickupTicks=p2, lengthTicks=total, bars=8, cadence=dict(content["cadence"], durTicks=content["cadence"]["durTicks"] * 2))
    out["modifications"] = _mods(content["modifications"])
    out["tags"] = sorted(set(content["tags"]) | {"aug2"})
    return out


def _variant_fields(base: dict[str, Any], content: dict[str, Any], source_kind: str, of: str) -> dict[str, Any]:
    min_cad = base.get("minLevelCadence", 1)
    f = {k: v for k, v in base.items() if k not in ("id", "stage", "status", "schemaVersion", "kind", "corpus", "dataRef", "fallbackFor", "score", "reason", "detail")}
    f.update(
        meter=f"{content['meter']['beats']}/{content['meter']['beatType']}",
        bars=8, pickupTicks=content["pickupTicks"], minLevelBars=1, minLevelCadence=min_cad, minLevel=min_cad,
        modifications=content["modifications"], tags=content["tags"], augmentFrom=source_kind, augmentOf=of, requiresLevelMax=LEVEL_MAX,
    )
    return f


def augment_part(part: dict[str, Any], rec: dict[str, Any], wins: list[dict[str, Any]], wblob: dict[str, Any], lyric: bool,
                 bass: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Variant records for one part (dicts with id, status, reason/detail or content, and the record fields)."""
    out: list[dict[str, Any]] = []
    for w in sorted(wins, key=lambda r: r["id"]):
        if w["bars"] != 8 or w["meter"] not in SCALE_MAP:
            continue
        beats, bt = SCALE_MAP[w["meter"]]
        content = scale_window(wblob[w["id"]], beats, bt)
        fields = _variant_fields(w, content, f"{w['meter']}-to-{beats}/{bt}", w["id"])
        out.append(dict(fields, id=w["id"] + "-aug2", status="pass", parentId=w["id"], content=content, dedupeWith=[w["id"]]))
    ms = part["measures"]
    if not any(f"{m['beats']}/{m['beatType']}" in PHRASE_METERS for m in ms):
        return out
    pw = propose(part, lyric, bass, lengths=range(4, 5))
    corpus = rec["corpus"]
    for c in pw.primary:
        m0 = ms[c.first]
        meter = f"{m0['beats']}/{m0['beatType']}"
        pid = f"{rec['id']}@{window_key(c)}"
        vid = pid + "-aug2"
        if meter not in PHRASE_METERS:
            continue
        base = {
            "fileId": rec["parentId"], "partIndex": rec["partIndex"], "role": rec.get("role"), "roleLabel": rec.get("roleLabel"),
            "firstMeasure": c.first, "lastMeasure": c.last, "pickupMeasure": c.start.pickup_mi, "movement": m0["movement"], "fifths": m0["fifths"],
            "sourceMeasures": [ms[c.start.pickup_mi]["number"] if c.start.pickup_mi is not None else m0["number"], ms[c.last]["number"]],
            "startKind": c.start.kind, "endFollowedBy": c.end.followed_by, "cadenceEnd": c.end.cadence, "endDegree": c.end.degree,
            "minLevelCadence": 3 if c.end.cadence == "HC" else 1,
        }
        pq = phrase_quality(c, pw.ends)
        if pq != "complete-phrase":
            out.append(dict(base, id=vid, status="reject", parentId=rec["id"], reason="aug-not-complete-phrase", detail=f"the 4-bar window is a {pq}", meter=meter, bars=8))
            continue
        src = build_window(pw, c, corpus)
        try:
            content = double_phrase(src)
        except AugmentError as e:
            out.append(dict(base, id=vid, status="reject", parentId=rec["id"], reason=e.reason, detail=e.detail, meter=meter, bars=8))
            continue
        ls, le = lyric_flags(pw.facts, c)
        fields = _variant_fields(base, content, f"phrase4-{meter}", pid)
        fields.update(mode=content["mode"], modal=content["modal"], modeBasis=content["modeBasis"], phraseQuality="complete-phrase",
                      tempoAtStart=content["tempoAtStart"], lyricStart=ls if lyric else None, lyricEnd=le if lyric else None)
        contains = [w["id"] for w in wins if not w["id"].endswith("-aug2") and w["firstMeasure"] <= c.first and w["lastMeasure"] >= c.last]
        out.append(dict(fields, id=vid, status="pass", parentId=rec["id"], content=content, dedupeWith=sorted(contains)))
    return out
