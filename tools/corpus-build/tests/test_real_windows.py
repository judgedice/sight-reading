"""Stages `windows` and `augment` (job C5) on real files from the cached clones (skipped without them).

A fixed sample (every 15th Lieder file and four small to mid-size quartets) goes through read, normalize, extract, windows and
augment in a temporary build. Every passing window is re-checked against its source part independently of the rule
code. The silver-standard boundary check (03 section 6.6, an acceptance test of C5) runs on the sample and, when the
repository's build/ holds a full extract, on every Lieder voice part.
"""

from __future__ import annotations

import hashlib
import re
from collections import Counter
from pathlib import Path

import pytest

from corpus_build.candidate import read_jsonl, validate, write_jsonl
from corpus_build.partdata import load_blob, load_part
from corpus_build.paths import TOOL_DIR, cache_root
from corpus_build.pipeline import run_extract, run_normalize, run_read
from corpus_build.window_stage import SILVER_END_MIN, SILVER_START_MIN, load_window, run_augment, run_windows

cache = cache_root()
LIEDER = cache / "openscore-lieder"
QUARTETS = cache / "openscore-quartets"
pytestmark = pytest.mark.skipif(not (LIEDER / "scores").exists() or not (QUARTETS / "scores").exists(), reason="clone cache not fetched")

SHA = "0" * 40
ID_RE = re.compile(r"^.+#\d+@p?\d+-\d+(-aug2)?$")
BARRIER = {"repeat-start", "repeat-end", "volta", "volta-start", "segno", "coda", "repeat-text", "repeat-expression"}


def gate_record(corpus: str, root: Path, f: Path) -> dict:
    rel = f.relative_to(root).as_posix()
    return {"schemaVersion": 1, "stage": "gate", "kind": "file", "id": f"{corpus}:{rel}", "corpus": corpus, "status": "pass", "path": rel,
            "sha256": "sha256:" + hashlib.sha256(f.read_bytes()).hexdigest(), "upstream": f"X/{corpus}@{SHA}:{rel}"}


def sample() -> list[dict]:
    lieder = sorted((LIEDER / "scores").rglob("*.mxl"))[::15]
    quartets = sorted((QUARTETS / "scores").rglob("*.mxl"), key=lambda p: (p.stat().st_size, str(p)))[10:60:16]
    return [gate_record("openscore-lieder", LIEDER, p) for p in lieder] + [gate_record("openscore-quartets", QUARTETS, p) for p in quartets]


def run_all(b: Path, workers: int) -> tuple[dict, dict]:
    write_jsonl(b / "gate" / "candidates.jsonl", sample())
    run_read(cache, b, workers=workers)
    run_normalize(b, workers=workers)
    run_extract(b)
    return run_windows(b, workers=workers), run_augment(b, workers=workers)


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    b = tmp_path_factory.mktemp("build")
    ws, aug = run_all(b, 4)
    return b, ws, aug


def records(b: Path, stage: str) -> list[dict]:
    return read_jsonl(b / stage / "candidates.jsonl")


def test_every_proposed_window_has_a_valid_record_and_rejections_have_reasons(built):
    b, *_ = built
    recs = records(b, "windows")
    assert len(recs) > 500
    ids = [r["id"] for r in recs]
    assert len(ids) == len(set(ids))
    parts = {r["id"] for r in records(b, "extract") if r["status"] == "pass"}
    for r in recs:
        validate(r)
        assert r["kind"] == "window" and ID_RE.match(r["id"]) and r["parentId"] in parts
        if r["status"] == "reject":
            assert r["reason"] and r["detail"]
        else:
            assert r["dataRef"] and r["cadenceEnd"] in ("PAC", "IAC", "HC") and r["phraseQuality"] in ("complete-phrase", "period", "phrase-pair")
            assert 8 <= r["bars"] <= 12 and r["minLevel"] == max(r["minLevelBars"], r["minLevelCadence"])
    passed = [r for r in recs if r["status"] == "pass"]
    assert sum(1 for r in passed if r["corpus"] == "openscore-lieder") > 100
    assert sum(1 for r in passed if r["corpus"] == "openscore-quartets") > 20


def _check_content(w: dict, rec: dict) -> None:
    meter = w["meter"]
    bar = meter["countUnitTicks"] * meter["countsPerBar"]
    ms = w["measures"]
    assert len([m for m in ms if not m["isPickup"]]) == w["bars"] == rec["bars"]
    t = 0
    for i, m in enumerate(ms):
        assert m["startTick"] == t
        tt = t
        for e in m["events"]:
            assert e["tick"] == tt and e["dur"] > 0
            assert "lyricLineEnd" not in e and "fermata" not in e
            tt += e["dur"]
        length = tt - t
        if m["isPickup"]:
            assert i == 0 and 0 < length == w["pickupTicks"] < bar
        elif i == len(ms) - 1:
            assert length == bar or ("final-bar-balances-pickup" in w["tags"] and length + w["pickupTicks"] == bar)
        else:
            assert length == bar
        t += length
    assert t == w["lengthTicks"]
    notes = [e for m in ms for e in m["events"] if e["kind"] == "note"]
    assert notes and not notes[0].get("tieStop") and not notes[-1].get("tieStart")


def test_window_content_is_well_formed(built):
    b, *_ = built
    for r in records(b, "windows"):
        if r["status"] == "pass":
            _check_content(load_window(b, r), r)


def test_passing_windows_rechecked_against_the_source_part(built):
    """Independent of windows.check_rules: the touched source bars have no problems, one meter, one key, one movement,
    no interior barrier, and every kept event is the source event (same pitch and duration)."""
    b, *_ = built
    ex = {r["id"]: r for r in records(b, "extract")}
    cache_parts: dict[str, dict] = {}
    n = 0
    for r in records(b, "windows"):
        if r["status"] != "pass":
            continue
        pid = r["parentId"]
        if pid not in cache_parts:
            cache_parts[pid] = load_part(b, ex[pid])
        src = cache_parts[pid]["measures"]
        w = load_window(b, r)
        idx = [m["source"]["index"] for m in w["measures"]]
        assert idx == sorted(idx) and idx == list(range(idx[0], idx[-1] + 1))
        touched = [src[i] for i in idx]
        assert all(not m["problems"] for m in touched)
        assert len({(m["beats"], m["beatType"], m["fifths"], m["movement"]) for m in touched}) == 1
        for k, m in enumerate(touched):
            marks = set(m["marks"]) & BARRIER
            if k == 0:
                marks -= {"repeat-start"}
            if k == len(touched) - 1:
                marks -= {"repeat-end"}
            assert not marks, (r["id"], m["number"], marks)
            assert "ottava" not in m["marks"]
        for m in w["measures"]:
            for e in m["events"]:
                if e.get("completion"):
                    continue
                mi, ei = e["src"]
                s = src[mi]["events"][ei]
                assert (s["kind"], s.get("midi"), s["dur"]) == (e["kind"], e.get("midi"), e["dur"])
        n += 1
    assert n > 100


def test_selection_rules_hold(built):
    b, *_ = built
    by_part: dict[str, list[dict]] = {}
    for r in records(b, "windows"):
        if r["status"] == "pass" and not r.get("fallbackFor"):
            by_part.setdefault(r["parentId"], []).append(r)
    for ws in by_part.values():
        firsts = [w["firstMeasure"] for w in ws]
        assert len(firsts) == len(set(firsts))
        for a in ws:
            for c in ws:
                if a is not c:
                    inter = max(0, min(a["lastMeasure"], c["lastMeasure"]) - max(a["firstMeasure"], c["firstMeasure"]) + 1)
                    assert inter / min(a["bars"], c["bars"]) <= 0.5
    for r in records(b, "windows"):
        if r.get("fallbackFor"):
            assert r["bars"] == 8 and r["status"] == "pass"


def test_silver_standard_on_the_sample(built):
    _, ws, _ = built
    ss = ws["byCorpus"]["openscore-lieder"]["silverStandard"]
    assert ss["windows"] > 100
    assert ss["startRate"] >= SILVER_START_MIN and ss["endRate"] >= SILVER_END_MIN, ss


def test_augment_copies_windows_and_adds_variants_only_from_allowed_meters(built):
    b, _, _ = built
    wins = {r["id"] for r in records(b, "windows") if r["status"] == "pass"}
    recs = records(b, "augment")
    copied = {r["id"] for r in recs if not r["id"].endswith("-aug2")}
    assert copied == wins
    var = [r for r in recs if r["id"].endswith("-aug2")]
    assert any(r["status"] == "pass" for r in var)
    for r in var:
        validate(r)
        if r["status"] == "reject":
            assert r["reason"].startswith("aug-") and r["detail"]
            continue
        assert r["augmentFrom"] in ("2/4-to-4/4", "3/8-to-3/4", "phrase4-2/4", "phrase4-4/4")
        assert r["meter"] in ("4/4", "3/4", "2/4") and r["bars"] == 8 and r["requiresLevelMax"] == 3
        assert "rhythm-augmented-x2" in r["modifications"]
        if not r["augmentFrom"].startswith("phrase4"):
            assert r["dedupeWith"] == [r["augmentOf"]] and r["augmentOf"] in wins
        w = load_window(b, r)
        _check_content(w, r)


def test_rerun_is_byte_identical(built, tmp_path):
    b, *_ = built
    run_all(tmp_path, 1)
    for stage in ("windows", "augment"):
        for f in ("candidates.jsonl", "summary.json"):
            assert (b / stage / f).read_bytes() == (tmp_path / stage / f).read_bytes(), (stage, f)
        for blob in (b / stage / "data").rglob("*.json.gz"):
            assert blob.read_bytes() == (tmp_path / blob.relative_to(b)).read_bytes()


FULL = TOOL_DIR / "build"


@pytest.mark.skipif(not (FULL / "extract" / "candidates.jsonl").exists(), reason="no full extract in tools/corpus-build/build")
def test_silver_standard_on_every_lieder_voice_part():
    """03 section 6.6 and 11.4: at least 85% of window starts and 80% of ends on a lyric-line boundary within 1 note."""
    from corpus_build.windows import lyric_flags, propose

    parts = [r for r in read_jsonl(FULL / "extract" / "candidates.jsonl") if r["status"] == "pass" and r["corpus"] == "openscore-lieder"]
    if not all((FULL / r["dataRef"]).exists() for r in parts):
        pytest.skip("normalize blobs missing")
    starts = ends = n = 0
    blobs: dict[str, dict] = {}
    for r in parts:
        if r["dataRef"] not in blobs:
            blobs.clear()
            blobs[r["dataRef"]] = load_blob(FULL, r["dataRef"])
        pw = propose(blobs[r["dataRef"]]["parts"][str(r["partIndex"])], True)
        for c in pw.primary:
            s, e = lyric_flags(pw.facts, c)
            starts += s
            ends += e
            n += 1
    assert n > 1000
    assert starts / n >= SILVER_START_MIN and ends / n >= SILVER_END_MIN, (n, starts / n, ends / n)


def test_reason_counts_are_reported(built):
    _, ws, _ = built
    for corpus, s in ws["byCorpus"].items():
        rejected = sum(s["rejectedByReason"].values())
        assert s["proposed"] == rejected + s["windows"] + s["fallbacks"], corpus
        assert sum(Counter(s["byBars"]).values()) == s["windows"]
