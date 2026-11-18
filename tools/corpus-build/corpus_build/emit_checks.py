"""The emitter's hard gates, applied to the emitted documents and files (03 section 5.2): H-licence, H-credits, H-rules,
H-dedupe, H-review and H-budget. H-schema is in emit.py (it needs the schema files) and H-determinism is a comparison of
two builds (tests and the `emit` stage). H-render and the TS-side half of H-viable belong to C10.

H-rules re-derives what it can from the emitted `ExcerptDoc`s alone, not from the pipeline's state:
bar sums (every bar tiles exactly, a short final bar only when it balances the pickup, H6 and H11), H3 (bar count
allowed at the level), H2 (the last note starts on a strong beat and is at least a beat long or followed by a rest; the
degree is 1 or 3, 5 or 2 for a half cadence from L3 that lasts two beats, 1 only in a church mode), H4 (no tie, slur or
tuplet cut by the window edge, ties join equal pitches, event ids unique) and H7 (one meter and key: structural).
Not checkable from the documents: H1 (phrase start, needs the rest and barline context), H5 and H12 sequences and beam
groups (no beam data), H8 and H9 (source-side). The pipeline applied those, and their windows' records are the evidence.
"""

from __future__ import annotations

import gzip
import hashlib
import json
from collections import defaultdict
from typing import Any

from .coverage import needs_review
from .features import levels_config
from .phrase import degree_of, strong_positions
from .review import decisions
from .yamlio import load_yaml
from .paths import CONFIG_DIR

LICENCES = {"PD", "CC0-1.0", "CC-BY-4.0"}
CHURCH_MODES = {"dorian", "phrygian", "lydian", "mixolydian", "locrian"}


def _bar_ticks(m: dict[str, Any]) -> int:
    return m["beats"] * (480 * 4 // m["beatType"])


def check_rules(d: dict[str, Any], lvs: dict[int, dict[str, Any]]) -> list[str]:
    """H-rules on one document. Returns problem strings prefixed with the rule."""
    out: list[str] = []
    i = d["id"]
    meter = d["meter"]
    bar = _bar_ticks(meter)
    pickup = d["pickupTicks"]
    ms = d["measures"]
    if not ms:
        return [f"H-rules: {i}: no measures"]
    expect_start = 0
    ids: set[str] = set()
    full = [m for m in ms if not m["isPickup"]]
    if any(m["isPickup"] for m in ms[1:]) or (ms[0]["isPickup"] != bool(pickup)):
        out.append(f"H-rules: {i}: pickup bar and pickupTicks disagree")
    for k, m in enumerate(ms):
        if m["index"] != k:
            out.append(f"H-rules: {i}: measure {k} has index {m['index']}")
        if m["startTick"] != expect_start:
            out.append(f"H-rules: {i}: bar {k} starts at {m['startTick']}, expected {expect_start}")
        t = m["startTick"]
        for e in m["events"]:
            if e["id"] in ids:
                out.append(f"H-rules: {i}: duplicate event id {e['id']}")
            ids.add(e["id"])
            if e["tick"] != t:
                out.append(f"H-rules: {i}: bar {k}: event {e['id']} at {e['tick']}, expected {t} (bar does not tile)")
                break
            if e["dur"] <= 0:
                out.append(f"H-rules: {i}: event {e['id']} has duration {e['dur']}")
            t += e["dur"]
        length = t - m["startTick"]
        if m["isPickup"]:
            want = pickup
        elif k == len(ms) - 1 and pickup and length + pickup == bar:
            want = bar - pickup  # H6: an incomplete final bar that balances the pickup
        else:
            want = bar
        if length != want:
            out.append(f"H-rules: {i}: bar {k} sums to {length} ticks, expected {want} (H11/H6)")
        expect_start = m["startTick"] + length
    lv = lvs.get(d["level"])
    if lv is None:
        out.append(f"H-rules: {i}: unknown level {d['level']}")
    elif len(full) not in lv["bars"]:
        out.append(f"H-rules: {i}: {len(full)} bars at level {d['level']} (allowed {lv['bars']}) (H3)")
    if d["level"] != max(d["featureLevels"].values()) and d["level"] < max(d["featureLevels"].values()):
        out.append(f"H-rules: {i}: level {d['level']} is below its feature levels")

    evs = [e for m in ms for e in m["events"]]
    notes = [e for e in evs if e["kind"] == "note"]
    if len(notes) < 2:
        return out + [f"H-rules: {i}: fewer than two notes"]
    # H4: ties, slurs, tuplets
    if notes[0].get("tieStop"):
        out.append(f"H-rules: {i}: starts inside a tie (H4)")
    if notes[-1].get("tieStart"):
        out.append(f"H-rules: {i}: ends inside a tie (H4)")
    for a, b in zip(notes, notes[1:]):
        if a.get("tieStart") and not (b.get("tieStop") and b["pitch"] == a["pitch"] and b["tick"] == a["tick"] + a["dur"]):
            out.append(f"H-rules: {i}: tie from {a['id']} does not join {b['id']} (H4)")
        elif b.get("tieStop") and not a.get("tieStart"):
            out.append(f"H-rules: {i}: {b['id']} ends a tie that was not started (H4)")
    marks = [e["slur"] for e in notes if e.get("slur")]
    if marks and marks[0] != "start":
        out.append(f"H-rules: {i}: starts inside a slur (H4)")
    depth = 0
    for s in marks:
        depth += {"start": 1, "stop": -1, "continue": 0}[s]
        if depth < 0:
            out.append(f"H-rules: {i}: slur stop without a start (H4)")
            break
    if depth != 0:
        out.append(f"H-rules: {i}: ends inside a slur (H4)")
    groups: dict[str, list[tuple[int, dict[str, Any]]]] = defaultdict(list)
    for k, m in enumerate(ms):
        for e in m["events"]:
            if e.get("tuplet"):
                groups[e["tuplet"]["groupId"]].append((k, e))
    for gid, g in groups.items():
        t = g[0][1]["tuplet"]
        written = sum(e["dur"] for _, e in g) * t["actual"] / t["normal"]
        if len({k for k, _ in g}) != 1 or written != int(written) or int(written) % t["actual"] != 0:
            out.append(f"H-rules: {i}: tuplet {gid} is cut or incomplete (H4)")
    # H2: the ending
    out += check_ending(d, ms, evs, lv)
    return out


def check_ending(d: dict[str, Any], ms: list[dict[str, Any]], evs: list[dict[str, Any]], lv: dict[str, Any] | None) -> list[str]:
    i = d["id"]
    meter = d["meter"]
    unit = meter["countUnitTicks"]
    # the last sounding note, tied chains joined: start tick and total duration
    k = max(n for n, e in enumerate(evs) if e["kind"] == "note")
    last = evs[k]
    start, dur = last["tick"], last["dur"]
    j = k
    while evs[j].get("tieStop") and j > 0:
        j -= 1
        while evs[j]["kind"] != "note" and j > 0:
            j -= 1
        start, dur = evs[j]["tick"], dur + evs[j]["dur"]
    bar_start = next(m["startTick"] for m in ms if m["events"] and m["events"][0]["tick"] <= start < m["events"][-1]["tick"] + m["events"][-1]["dur"])
    rel = start - bar_start
    after = evs[k + 1 :]
    rest_like = (not after) or after[0]["kind"] == "rest"
    out: list[str] = []
    if rel not in strong_positions(meter["beats"], meter["beatType"]):
        out.append(f"H-rules: {i}: the last note starts at {rel} ticks into its bar, not on a strong beat (H2)")
    if dur < unit and not rest_like:
        out.append(f"H-rules: {i}: the last note is shorter than a beat and not followed by a rest (H2)")
    mode = d["modal"] or d["keyConcert"]["mode"]
    deg = degree_of(_midi(last["pitch"]) % 12, d["keyConcert"]["fifths"], mode)
    if mode in CHURCH_MODES:
        if deg != 1:
            out.append(f"H-rules: {i}: a {mode} excerpt ends on degree {deg} (H2)")
    elif deg in (5, 2):
        if d["level"] < 3:
            out.append(f"H-rules: {i}: a half cadence below level 3 (H2)")
        elif not (dur >= 2 * unit and rest_like):
            out.append(f"H-rules: {i}: a half cadence needs two beats and a rest (H2)")
    elif deg not in (1, 3):
        out.append(f"H-rules: {i}: ends on degree {deg} (H2)")
    return out


_STEP = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def _midi(p: dict[str, Any]) -> int:
    return 12 * (p["octave"] + 1) + _STEP[p["step"]] + p["alter"]


def check_documents(docs: list[dict[str, Any]], recs: list[dict[str, Any]], inp: Any, files: dict[str, bytes], index: dict[str, Any]) -> list[str]:
    """All emitter gates but H-schema, H-determinism, H-render and the TS half of H-viable."""
    problems: list[str] = []
    cfg = inp.cfg
    lvs = {lv["level"]: lv for lv in levels_config()}
    pd = load_yaml(CONFIG_DIR / "pd.yaml")
    ids = [d["id"] for d in docs]
    if len(set(ids)) != len(ids):
        problems.append("H-dedupe: duplicate excerpt ids")
    hashes = [d["contentHash"] for d in docs]
    if len(set(hashes)) != len(hashes):
        problems.append("H-dedupe: two excerpts share a contentHash")

    for d in docs:
        problems += check_rules(d, lvs)

    # H-licence
    for d, r in zip(docs, recs):
        s = d["source"]
        g = inp.gate.get(r["fileId"])
        if g is None:
            problems.append(f"H-licence: {d['id']}: no gate record for {r['fileId']}")
            continue
        lic = g["licence"]
        if s["license"] not in LICENCES or lic["id"] != s["license"] or not lic.get("allowed"):
            problems.append(f"H-licence: {d['id']}: licence {s['license']} is not allowed or differs from the gate record")
        if not lic.get("evidence"):
            problems.append(f"H-licence: {d['id']}: no recorded licence evidence")
        if not g["pd"]["passed"]:
            problems.append(f"H-licence: {d['id']}: the public-domain rule failed in the gate")
        death = s.get("composerDeath")
        if death is not None:
            if death >= pd["composer_died_before"]:
                problems.append(f"H-licence: {d['id']}: composer died {death}, not before {pd['composer_died_before']} (9.2)")
        elif s.get("sourceEditionYear", 9999) > pd["edition_year_max"]:
            problems.append(f"H-licence: {d['id']}: no composer death year and no edition year at or below {pd['edition_year_max']}")

    # H-credits: (corpus, licence) pairs of the attributions equal those of the manifest; CC BY records complete
    attrs = _json(files[index["attributions"]["file"]])
    pairs_attr = {(c["corpus"], lic) for c in attrs["collections"] for lic in c["licenses"]}
    pairs_docs = {(d["source"]["corpus"], d["source"]["license"]) for d in docs}
    if pairs_attr != pairs_docs:
        problems.append(f"H-credits: attribution pairs {sorted(pairs_attr)} differ from the corpus pairs {sorted(pairs_docs)}")
    by = {a["id"]: a for a in attrs["items"]}
    for d in docs:
        if d["source"]["license"] == "CC-BY-4.0":
            a = by.get(d["id"])
            if not a or not all(a.get(k) for k in ("title", "creator", "sourceUrl", "licenseUrl")):
                problems.append(f"H-credits: {d['id']}: CC BY item without a complete attribution record")
    if len(by) != sum(1 for d in docs if d["source"]["license"] == "CC-BY-4.0"):
        problems.append("H-credits: attribution items and CC BY excerpts differ")

    # H-dedupe: equal fingerprints share one dedupeGroup (fingerprints are augmentation invariant)
    fp: dict[tuple[str, ...], set[str]] = defaultdict(set)
    for r in recs:
        fp[tuple(r["fingerprint"])].add(r["dedupeGroup"])
    for key, groups in fp.items():
        if len(groups) > 1:
            problems.append(f"H-dedupe: one fingerprint in {len(groups)} dedupe groups: {sorted(groups)[:3]}")

    # H-review
    verdicts, batches = inp.verdict_cache
    dec = decisions([d["contentHash"] for d in docs], inp.rcfg, verdicts, batches)
    for d, r in zip(docs, recs):
        h = d["contentHash"]
        rv = d["review"]
        need = needs_review(r)
        accepted = dec[h]["status"] == "accepted"
        if rv["llm"] == "accepted":
            if not accepted or len(rv["llmVerdicts"]) != 2 or any(v["verdict"] != "accept" for v in rv["llmVerdicts"]):
                problems.append(f"H-review: {d['id']}: marked accepted without two accepting verdicts from batches whose controls passed")
            if rv["promptVersion"] != inp.rcfg["prompt_version"]:
                problems.append(f"H-review: {d['id']}: prompt version {rv['promptVersion']} is not the current one")
        elif need:
            problems.append(f"H-review: {d['id']}: requires agent review but has none")

    # H-budget and the index (hashes and sizes match the bytes)
    refs = [index["manifest"], index["attributions"], *index["chunks"]]
    for ref in refs:
        data = files[ref["file"]]
        if ref["hash"] != "sha256:" + hashlib.sha256(data).hexdigest() or ref["bytes"] != len(data):
            problems.append(f"H-budget: index entry for {ref['file']} does not match its bytes")
    mg = len(gzip.compress(files[index["manifest"]["file"]], 9, mtime=0))
    if mg > cfg["budget"]["manifest_gzip_max"]:
        problems.append(f"H-budget: manifest is {mg} bytes gzip (limit {cfg['budget']['manifest_gzip_max']})")
    for c in index["chunks"]:
        cg = len(gzip.compress(files[c["file"]], 9, mtime=0))
        if cg > cfg["budget"]["chunk_gzip_max"]:
            problems.append(f"H-budget: {c['file']} is {cg} bytes gzip (limit {cfg['budget']['chunk_gzip_max']})")
        n = len(_json(files[c["file"]])["excerpts"])
        if n > cfg["chunk_max_excerpts"]:
            problems.append(f"H-budget: {c['file']} holds {n} excerpts")
    return problems


def _json(b: bytes) -> Any:
    return json.loads(b)
