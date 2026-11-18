"""Runs the gate on the real pinned clones when they are in the cache. Skipped without them (fetch needs the network)."""

import pytest

from corpus_build.candidate import read_jsonl, write_jsonl
from corpus_build.composers import ComposerIndex, build_composers
from corpus_build.fetch import fetch_records, load_lock, verify_lock
from corpus_build.gate import run_gate
from corpus_build.paths import cache_root
from corpus_build.sources import load_sources

SRC = load_sources()
cache = cache_root()
have = all((s.dir(cache) / ".git").exists() for s in SRC if not s.optional) and load_lock() is not None
pytestmark = pytest.mark.skipif(not have, reason="clone cache not fetched; run `make fetch lock`")


def test_real_cache_matches_the_committed_lock():
    assert verify_lock(SRC, cache, load_lock()) == []


@pytest.fixture(scope="module")
def result(tmp_path_factory):
    out = tmp_path_factory.mktemp("build")
    lock = load_lock()
    recs = []
    for s in SRC:
        if s.id in lock["sources"]:
            recs += fetch_records(s, cache, lock["sources"][s.id])
    write_jsonl(out / "fetch" / "candidates.jsonl", recs)
    summary = run_gate(SRC, cache, lock, out / "fetch" / "candidates.jsonl", ComposerIndex(build_composers(SRC, cache)), out / "gate")
    return summary, read_jsonl(out / "gate" / "candidates.jsonl")


def test_every_file_is_decided_and_every_rejection_has_a_reason(result):
    summary, recs = result
    assert summary["total"] == len(recs) == 1462 + 196 + 168
    assert all(r["reason"] for r in recs if r["status"] == "reject")


def test_no_passed_file_violates_the_rules(result):
    _, recs = result
    passed = [r for r in recs if r["status"] == "pass"]
    assert len(passed) > 1000
    for r in passed:
        assert r["licence"]["id"] in ("PD", "CC0-1.0", "CC-BY-4.0") and r["licence"]["allowed"]
        c = r["composer"]
        if r["pd"]["basis"] in ("composer-death", "composer-extra"):
            assert c["died"] is not None and c["died"] < 1931, r["id"]
        else:
            assert r["pd"]["basis"] == "edition-year" and r["pd"]["editionYear"] <= 1930, r["id"]


def test_known_late_composers_are_rejected(result):
    _, recs = result
    bartok = [r for r in recs if r["path"].startswith("scores/Bartók")]
    assert bartok and all(r["reason"] == "composer-not-public-domain" for r in bartok)


def test_mutopia_excludes_by_sa_and_by_2_5(result):
    _, recs = result
    m = [r for r in recs if r["corpus"] == "mutopia" and r["status"] == "pass"]
    assert m and all(r["licence"]["id"] in ("PD", "CC-BY-4.0") for r in m)
    assert not [r for r in m if "swenska_folk_dansar" in r["path"]]
