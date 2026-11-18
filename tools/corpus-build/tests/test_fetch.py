from pathlib import Path

import pytest

from corpus_build import paths
from corpus_build.fetch import FetchError, fetch_records, fetch_source, head_sha, list_score_files, load_lock, verify_lock, write_lock
from corpus_build.sources import load_sources

from .conftest import git


def test_fetch_checks_out_the_pinned_sha_with_sparse_paths(world):
    src = world["sources"][0]
    d = fetch_source(src, world["cache"])
    assert head_sha(d) == src.sha
    assert (d / "LICENSE.txt").is_file()
    assert (d / "scores/Old,_Master/Set/Song_A/lc1.mxl").is_file()
    assert list_score_files(src, world["cache"])[0].startswith("scores/")
    assert "scores/readme.txt" not in list_score_files(src, world["cache"])


def test_fetch_is_idempotent_and_moves_back_to_the_pin(world):
    src = world["sources"][0]
    d = fetch_source(src, world["cache"])
    repo = world["repos"]["lieder"]
    (repo / "scores/Old,_Master/Set/Song_A/new.mxl").write_bytes(b"x")
    git(["add", "-A"], repo)
    git(["commit", "-q", "-m", "second"], repo)
    d2 = fetch_source(src, world["cache"])
    assert d2 == d and head_sha(d) == src.sha
    assert not (d / "scores/Old,_Master/Set/Song_A/new.mxl").exists()


def test_fetch_fails_for_an_unknown_sha(world):
    from dataclasses import replace
    bad = replace(world["sources"][0], sha="0" * 40)
    with pytest.raises(FetchError):
        fetch_source(bad, world["cache"])


def _lock(world):
    for s in world["sources"]:
        fetch_source(s, world["cache"])
    return write_lock(world["sources"], world["cache"], world["lock_path"], today="2026-01-01")


def test_lock_records_sha_file_hashes_and_licence_evidence(world):
    lock = _lock(world)
    ent = lock["sources"]["openscore-lieder"]
    assert ent["sha"] == world["sources"][0].sha
    assert ent["files"]["scores/Old,_Master/Set/Song_A/lc1.mxl"].startswith("sha256:")
    assert "LICENSE.txt" in ent["files"] and "data/composers.yaml" in ent["files"]
    assert ent["licenceEvidence"]["file"] == "LICENSE.txt"
    assert ent["licenceEvidence"]["sha256"] == ent["files"]["LICENSE.txt"]
    assert lock["sources"]["mutopia"]["licenceEvidence"]["policy"] == "per-file header"


def test_lock_is_byte_stable_and_keeps_locked_at(world):
    _lock(world)
    first = world["lock_path"].read_bytes()
    write_lock(world["sources"], world["cache"], world["lock_path"], today="2030-05-05")
    assert world["lock_path"].read_bytes() == first


def test_verify_detects_tampering_and_extra_files(world):
    _lock(world)
    lock = load_lock(world["lock_path"])
    assert verify_lock(world["sources"], world["cache"], lock) == []
    f = world["cache"] / "openscore-lieder/scores/Old,_Master/Set/Song_A/lc1.mxl"
    f.write_bytes(b"tampered")
    probs = verify_lock(world["sources"], world["cache"], lock)
    assert any("lc1.mxl hash differs" in p for p in probs)
    f.write_bytes(b"PK\x03\x04 not a real mxl, the gate never parses it")
    (world["cache"] / "openscore-lieder/scores/Old,_Master/Set/Song_A/extra.mxl").write_bytes(b"x")
    assert any("extra.mxl is not in the lock" in p for p in verify_lock(world["sources"], world["cache"], lock))


def test_verify_without_a_lock_fails(world):
    assert verify_lock(world["sources"], world["cache"], None)


def test_lock_requires_fetched_required_sources_but_not_optional_ones(world):
    fetch_source(world["sources"][0], world["cache"])
    with pytest.raises(FetchError):
        write_lock(world["sources"], world["cache"], world["lock_path"])
    fetch_source(world["sources"][1], world["cache"])
    lock = write_lock(world["sources"], world["cache"], world["lock_path"])
    assert "mutopia" not in lock["sources"]


def test_fetch_records_have_the_lock_hash_and_upstream_ref(world):
    lock = _lock(world)
    src = world["sources"][0]
    recs = fetch_records(src, world["cache"], lock["sources"][src.id])
    assert len(recs) == 6 and all(r["status"] == "pass" for r in recs)
    r = recs[0]
    assert r["upstream"] == f"{src.repo}@{src.sha}:{r['path']}"


def test_cache_location_is_outside_the_repo_and_overridable(monkeypatch, tmp_path):
    monkeypatch.delenv(paths.CACHE_ENV, raising=False)
    default = paths.cache_root()
    assert default == Path("~/.cache/sight-reading-corpus").expanduser().resolve()
    assert paths.TOOL_DIR not in default.parents
    monkeypatch.setenv(paths.CACHE_ENV, str(tmp_path / "c"))
    assert paths.cache_root() == (tmp_path / "c").resolve()
    assert paths.cache_root(tmp_path / "explicit") == (tmp_path / "explicit").resolve()


def test_sources_yaml_pins_the_spec_shas_and_the_fixture_lock():
    import json
    srcs = {s.id: s for s in load_sources()}
    assert set(srcs) == {"openscore-lieder", "openscore-quartets", "mutopia"}
    assert srcs["openscore-lieder"].sha == "38c5db510224d9facdc4b08d741fc788cfb58ea8"
    assert srcs["openscore-quartets"].sha == "2614b0b2958dd1ce3f52e172a43e5f4d0e29570f"
    assert srcs["mutopia"].sha == "2144afd6f52d56c5b6995b8b589ef1268b3139f0"
    assert srcs["mutopia"].optional and not srcs["openscore-lieder"].optional
    assert [srcs[i].dedupe_priority for i in ("openscore-lieder", "openscore-quartets", "mutopia")] == [1, 2, 3]
    fx = json.loads((paths.TOOL_DIR.parent.parent / "fixtures/corpus/sources.lock.json").read_text())
    for e in fx["sources"]:
        assert srcs[e["corpus"]].sha == e["commit"]


def test_committed_lock_is_consistent_with_sources_yaml():
    lock = load_lock()
    assert lock is not None and lock["version"] == 1
    for s in load_sources():
        if s.id in lock["sources"]:
            assert lock["sources"][s.id]["sha"] == s.sha
            assert lock["sources"][s.id]["files"], s.id
    for sid in ("openscore-lieder", "openscore-quartets"):
        assert lock["sources"][sid]["licenceEvidence"]["sha256"].startswith("sha256:")
