"""Familiarity (03 section 6.8): `familiar.yaml` lists widely known melodies that occur in the v1 sources. A window whose
fingerprint (03 6.10) contains an entry's incipit, the first 8 fingerprint tokens of the tune, gets familiarity 2
(practice only, 02 5.2). Mutopia hymn tunes match by exact title (`titles`).

Each entry names where the tune is in the corpus (file path suffix, part role, movement, and optionally the printed
measure where it starts); `python -m corpus_build familiar` recomputes every incipit from the normalized parts and
rewrites the `incipit` fields, so the tokens are read from the sources, never typed from memory. A false positive only
moves a window to practice, so the list is not reviewed by a person (03 6.8).

Matching accepts the incipit anywhere in the window, not only at its start (03 says "a match on the first 8 fingerprint
tokens"): a familiar tune restated later in a song or movement is just as recognisable.
"""

from __future__ import annotations

import unicodedata
from pathlib import Path
from typing import Any

from .candidate import read_jsonl
from .partdata import load_blob
from .paths import TOOL_DIR
from .quality import fingerprint, filters_config
from .yamlio import dump_yaml, load_yaml

FAMILIAR_YAML = TOOL_DIR / "familiar.yaml"
INCIPIT_TOKENS = 8


def load_familiar(path: Path = FAMILIAR_YAML) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    data = load_yaml(path) or {}
    out = []
    for e in data.get("tunes") or []:
        if e.get("incipit"):
            out.append(dict(e, incipit=str(e["incipit"]).split()))
    return out


def match_familiar(fp: list[str], entries: list[dict[str, Any]]) -> str | None:
    """Id of the first entry whose incipit occurs in the fingerprint, else None."""
    if not fp:
        return None
    joined = "|" + "|".join(fp) + "|"
    for e in entries:
        inc = e["incipit"][:INCIPIT_TOKENS]
        if len(inc) == INCIPIT_TOKENS and ("|" + "|".join(inc) + "|") in joined:
            return e["id"]
    return None


def movement_notes(part: dict[str, Any], movement: int, from_measure: str | None = None) -> list[dict[str, Any]]:
    """Tie-merged notes of one movement of a normalized part, from its first note (or from a printed measure number),
    with absolute ticks."""
    out: list[dict[str, Any]] = []
    t = 0
    started = from_measure is None
    cur: dict[str, Any] | None = None
    for m in part["measures"]:
        if m["movement"] != movement:
            if out:
                break
            continue
        if not started and str(m["number"]) == str(from_measure):
            started = True
        if started:
            for e in m["events"]:
                if e["kind"] != "note":
                    cur = None
                    continue
                if cur is not None and e.get("tieStop"):
                    cur["dur"] += e["dur"]
                else:
                    cur = {"tick": t + e["tick"], "dur": e["dur"], "midi": e["midi"]}
                    out.append(cur)
                if not e.get("tieStart"):
                    cur = None
        t += m.get("lengthTicks") or m["barTicks"]
    return out


def compute_incipit(build: Path, entry: dict[str, Any], extract: list[dict[str, Any]]) -> list[str]:
    want = unicodedata.normalize("NFC", entry["file"])
    cands = [r for r in extract if r["kind"] == "part" and r["status"] == "pass" and unicodedata.normalize("NFC", r["parentId"]).endswith(want)]
    role = entry.get("part", "voice")
    cands = [r for r in cands if r.get("role") == role or r.get("roleLabel") == role]
    if not cands:
        raise LookupError(f"{entry['id']}: no extracted part {role!r} in a file ending {entry['file']!r}")
    r = sorted(cands, key=lambda r: r["id"])[0]
    part = load_blob(build, r["dataRef"])["parts"][str(r["partIndex"])]
    notes = movement_notes(part, int(entry.get("movement", 1)), entry.get("fromMeasure"))
    fp = fingerprint(notes[: INCIPIT_TOKENS + 2], filters_config()["dedupe"]["ioi_ratio_quantisation"])
    if len(fp) < INCIPIT_TOKENS:
        raise LookupError(f"{entry['id']}: only {len(fp)} tokens")
    return fp[:INCIPIT_TOKENS]


HEADER = """Familiar melodies (03 section 6.8). Agent-written list of widely known tunes that occur in the v1 sources.
A window whose fingerprint contains a tune's incipit (the first 8 tokens of 03 6.10) is familiarity 2: practice only.
Each tune says where it is in the corpus: `file` (path suffix of the upstream file), `part` (role: voice, vn1, inner,
cello, or a role label such as Va), `movement` (1-based) and optionally `fromMeasure` (printed number where the tune
starts; default the part's first note in the movement). The `incipit` ("interval:IOI-ratio" tokens) is generated:
run `python -m corpus_build familiar` after editing, never type them by hand. `titles` lists Mutopia hymn tunes that
match by exact title (none ship in v1 until job C3b yields files). A false positive only moves a window to practice.
"""


def write_familiar(build: Path, path: Path = FAMILIAR_YAML) -> dict[str, Any]:
    data = load_yaml(path) or {}
    extract = read_jsonl(build / "extract" / "candidates.jsonl")
    problems: list[str] = []
    for e in data.get("tunes") or []:
        try:
            e["incipit"] = " ".join(compute_incipit(build, e, extract))
        except LookupError as err:
            problems.append(str(err))
            e["incipit"] = ""
    path.write_text(dump_yaml(data, HEADER), encoding="utf-8")
    return {"tunes": len(data.get("tunes") or []), "problems": problems}
