"""Read, normalize and extract on real files from the cached clones (skipped without them). Uses a small fixed sample, not
the whole corpus (that is the stage run in the README)."""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from corpus_build.candidate import read_jsonl, write_jsonl
from corpus_build.paths import cache_root
from corpus_build.partdata import load_part
from corpus_build.pipeline import run_extract, run_normalize, run_read

cache = cache_root()
LIEDER = cache / "openscore-lieder"
QUARTETS = cache / "openscore-quartets"
pytestmark = pytest.mark.skipif(not (LIEDER / "scores").exists() or not (QUARTETS / "scores").exists(), reason="clone cache not fetched")

SHA = "0" * 40


def gate_record(corpus: str, root: Path, f: Path) -> dict:
    rel = f.relative_to(root).as_posix()
    return {"schemaVersion": 1, "stage": "gate", "kind": "file", "id": f"{corpus}:{rel}", "corpus": corpus, "status": "pass", "path": rel,
            "sha256": "sha256:" + hashlib.sha256(f.read_bytes()).hexdigest(), "upstream": f"X/{corpus}@{SHA}:{rel}"}


def sample() -> list[dict]:
    lieder = sorted((LIEDER / "scores").rglob("*.mxl"))
    quartets = sorted((QUARTETS / "scores").rglob("*.mxl"), key=lambda p: (p.stat().st_size, str(p)))
    pick_l = [p for p in lieder if "Schumann,_Robert" in str(p) or "Mozart" in str(p)][:6]
    return [gate_record("openscore-lieder", LIEDER, p) for p in pick_l] + [gate_record("openscore-quartets", QUARTETS, p) for p in quartets[:3]]


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    b = tmp_path_factory.mktemp("build")
    write_jsonl(b / "gate" / "candidates.jsonl", sample())
    # The cache dir is the parent of the two clones, so cache / corpus / path is the file.
    s1 = run_read(cache, b, workers=2)
    s2 = run_normalize(b, workers=2)
    s3 = run_extract(b)
    return b, s1, s2, s3


def test_every_file_and_part_has_a_record_and_a_reason_when_rejected(built):
    b, *_ = built
    recs = read_jsonl(b / "read" / "candidates.jsonl")
    files = [r for r in recs if r["kind"] == "file"]
    assert len(files) == 9
    assert all(r["reason"] for r in recs if r["status"] == "reject")
    parts = [r for r in recs if r["kind"] == "part"]
    assert {r["parentId"] for r in parts} <= {r["id"] for r in files}


def test_lieder_voice_part_extracted_and_piano_not_read(built):
    b, *_ = built
    ex = read_jsonl(b / "extract" / "candidates.jsonl")
    lieder = [r for r in ex if r["corpus"] == "openscore-lieder"]
    passed = [r for r in lieder if r["status"] == "pass"]
    assert passed and all(r["role"] == "voice" for r in passed)
    rejected = [r for r in lieder if r["status"] == "reject"]
    assert rejected and {r["reason"] for r in rejected} <= {"piano-part-not-read", "part-not-voice"}
    # no piano part has data: its measures were never dumped
    reads = {r["id"]: r for r in read_jsonl(b / "read" / "candidates.jsonl") if r["kind"] == "part"}
    assert all(not reads[r["id"]]["converted"] for r in rejected)


def test_quartet_parts_get_roles(built):
    b, *_ = built
    q = [r for r in read_jsonl(b / "extract" / "candidates.jsonl") if r["corpus"] == "openscore-quartets" and r["status"] == "pass"]
    by_file: dict[str, list[str]] = {}
    for r in q:
        by_file.setdefault(r["parentId"], []).append(r["role"])
    assert by_file
    for roles in by_file.values():
        assert sorted(roles) == ["cello", "inner", "inner", "vn1"]


def test_normalized_part_loads_and_is_consistent(built):
    b, *_ = built
    r = next(x for x in read_jsonl(b / "extract" / "candidates.jsonl") if x["status"] == "pass" and x["corpus"] == "openscore-lieder")
    part = load_part(b, r)
    assert part["tpq"] == 480 and part["measures"]
    notes = [e for m in part["measures"] for e in m["events"] if e["kind"] == "note"]
    assert notes and all(e["dur"] > 0 and 0 <= e["midi"] <= 127 for e in notes)
    assert r["stats"]["notes"] == len(notes)
    for m in part["measures"]:
        assert all(set(e).isdisjoint({"lyric", "lyrics"}) for e in m["events"])
        if not m["problems"]:
            assert m["lengthTicks"] <= m["barTicks"]


def test_measure_numbers_are_kept_as_printed_strings(built):
    b, *_ = built
    r = next(x for x in read_jsonl(b / "extract" / "candidates.jsonl") if x["status"] == "pass")
    nums = [m["number"] for m in load_part(b, r)["measures"]]
    assert all(isinstance(n, str) for n in nums) and len(nums) == r["stats"]["measures"]


def test_rerun_is_byte_identical(built, tmp_path):
    b, *_ = built
    write_jsonl(tmp_path / "gate" / "candidates.jsonl", sample())
    run_read(cache, tmp_path, workers=1)
    run_normalize(tmp_path, workers=1)
    run_extract(tmp_path)
    for stage in ("read", "normalize", "extract"):
        for f in ("candidates.jsonl", "summary.json"):
            assert (b / stage / f).read_bytes() == (tmp_path / stage / f).read_bytes(), (stage, f)
    for blob in (b / "normalize" / "data").rglob("*.json.gz"):
        assert blob.read_bytes() == (tmp_path / blob.relative_to(b)).read_bytes()


def test_unparseable_file_is_rejected_with_a_reason_not_dropped(tmp_path):
    bad = tmp_path / "scores" / "bad.mxl"
    bad.parent.mkdir(parents=True)
    bad.write_bytes(b"not a zip")
    rec = gate_record("openscore-lieder", tmp_path, bad)
    b = tmp_path / "build"
    write_jsonl(b / "gate" / "candidates.jsonl", [rec])
    # the cache layout is <cache>/<corpus>/<path>
    c = tmp_path / "cache"
    (c / "openscore-lieder" / "scores").mkdir(parents=True)
    (c / "openscore-lieder" / "scores" / "bad.mxl").write_bytes(b"not a zip")
    run_read(c, b, workers=1)
    out = read_jsonl(b / "read" / "candidates.jsonl")
    assert len(out) == 1 and out[0]["status"] == "reject" and out[0]["reason"] == "parse-failed" and out[0]["detail"]
