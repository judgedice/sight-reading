import json

import pytest

from corpus_build.candidate import read_jsonl, validate, write_jsonl
from corpus_build.composers import ComposerIndex, ExtraIndex, Extra, build_composers
from corpus_build.fetch import fetch_records, fetch_source, write_lock
from corpus_build.gate import Denylist, run_gate


def prepare(world, extras=None, deny=None, composers=None):
    for s in world["sources"]:
        fetch_source(s, world["cache"])
    lock = write_lock(world["sources"], world["cache"], world["lock_path"], today="2026-01-01")
    recs = []
    for s in world["sources"]:
        recs += fetch_records(s, world["cache"], lock["sources"][s.id])
    fpath = world["build"] / "fetch" / "candidates.jsonl"
    write_jsonl(fpath, recs)
    comp = composers or ComposerIndex(build_composers(world["sources"], world["cache"]))
    return lock, fpath, comp


def gate(world, extras=None, deny=None):
    lock, fpath, comp = prepare(world)
    extras = extras or ExtraIndex([Extra("mason_lowell", "Lowell Mason", 1792, 1872, ("https://example.org/ref",), ("MasonL",))])
    summary = run_gate(world["sources"], world["cache"], lock, fpath, comp, world["build"] / "gate", extras=extras, deny=deny or Denylist([]))
    recs = {r["path"]: r for r in read_jsonl(world["build"] / "gate" / "candidates.jsonl")}
    return summary, recs


def test_openscore_files_pass_or_reject_for_the_intended_reason(world):
    _, r = gate(world)
    assert r["scores/Old,_Master/Set/Song_A/lc1.mxl"]["status"] == "pass"
    assert r["scores/Old,_Master/Set/Song_A/lc1.mxl"]["licence"]["id"] == "CC0-1.0"
    assert r["scores/Edge,_Case/Set/Song/lc3.mxl"]["status"] == "pass"  # died 1930, matched through the (Alias) suffix
    assert r["scores/Late,_Composer/Set/Song/lc4.mxl"]["reason"] == "composer-not-public-domain"
    assert r["scores/Unknown,_Death/Set/Song/lc5.mxl"]["reason"] == "composer-death-unknown"
    assert r["scores/Nobody,_Listed/Set/Song/lc6.mxl"]["reason"] == "composer-not-in-metadata"


def test_mutopia_files_pass_or_reject_for_the_intended_reason(world):
    _, r = gate(world)
    m = lambda n: r[f"ftp/{n}"]
    assert m("Traditional/pd/pd.ly")["status"] == "pass" and m("Traditional/pd/pd.ly")["licence"]["id"] == "PD"
    assert m("Traditional/pd/pd.ly")["pd"] == {"basis": "edition-year", "cutoff": 1930, "editionYear": 1895, "passed": True}
    by4 = m("Traditional/by4/by4.ly")
    assert by4["status"] == "pass" and by4["licence"]["id"] == "CC-BY-4.0"
    assert m("Traditional/by25/by25.ly")["reason"] == "licence-not-allowed"
    assert m("Traditional/bysa/bysa.ly")["reason"] == "licence-not-allowed"
    assert m("Traditional/noyear/noyear.ly")["reason"] == "edition-year-missing"
    assert m("Traditional/late/late.ly")["reason"] == "edition-year-too-late"
    assert m("Traditional/arr/arr.ly")["reason"] == "arranger-unverified"
    assert m("Traditional/nolic/nolic.ly")["reason"] == "licence-evidence-missing"
    mason = m("MasonL/hymn/hymn.ly")
    assert mason["status"] == "pass" and mason["pd"]["basis"] == "composer-extra" and mason["composer"]["died"] == 1872


def test_every_record_validates_and_every_rejection_has_a_reason(world):
    summary, _ = gate(world)
    recs = read_jsonl(world["build"] / "gate" / "candidates.jsonl")
    assert len(recs) == summary["total"] == 6 + 1 + 9
    for r in recs:
        validate(r)
        assert r["stage"] == "gate" and r["kind"] == "file"
        if r["status"] == "reject":
            assert r["reason"] and r["detail"]
        else:
            assert r["licence"]["allowed"] and r["pd"]["passed"]


def test_summary_counts(world):
    summary, _ = gate(world)
    lieder = summary["byCorpus"]["openscore-lieder"]
    assert lieder["files"] == 6 and lieder["passed"] == 3
    assert lieder["rejectedByReason"] == {"composer-death-unknown": 1, "composer-not-in-metadata": 1, "composer-not-public-domain": 1}
    assert summary["byCorpus"]["mutopia"]["passedByLicence"] == {"CC-BY-4.0": 1, "PD": 2}


def test_gate_output_is_byte_identical_on_rerun(world):
    gate(world)
    p = world["build"] / "gate" / "candidates.jsonl"
    first = p.read_bytes()
    gate(world)
    assert p.read_bytes() == first


def test_modified_file_is_rejected_with_hash_mismatch(world):
    lock, fpath, comp = prepare(world)
    (world["cache"] / "openscore-lieder/scores/Old,_Master/Set/Song_A/lc1.mxl").write_bytes(b"changed after locking")
    run_gate(world["sources"], world["cache"], lock, fpath, comp, world["build"] / "gate", extras=ExtraIndex([]), deny=Denylist([]))
    r = {x["path"]: x for x in read_jsonl(world["build"] / "gate" / "candidates.jsonl")}
    assert r["scores/Old,_Master/Set/Song_A/lc1.mxl"]["reason"] == "file-hash-mismatch"
    assert r["scores/Old,_Master/Set/Song_B/lc2.mxl"]["status"] == "pass"


def test_changed_licence_evidence_rejects_the_whole_repository(world):
    lock, fpath, comp = prepare(world)
    (world["cache"] / "openscore-lieder/LICENSE.txt").write_text("CC0 1.0 Universal plus an edit", encoding="utf-8")
    run_gate(world["sources"], world["cache"], lock, fpath, comp, world["build"] / "gate", extras=ExtraIndex([]), deny=Denylist([]))
    recs = [x for x in read_jsonl(world["build"] / "gate" / "candidates.jsonl") if x["corpus"] == "openscore-lieder"]
    assert recs and all(x["status"] == "reject" and x["reason"] == "licence-evidence-missing" for x in recs)


def test_licence_file_without_the_cc0_text_is_not_evidence(world):
    repo = world["repos"]["lieder"]
    (repo / "LICENSE.txt").write_text("All rights reserved", encoding="utf-8")
    from .conftest import git
    git(["add", "-A"], repo)
    git(["commit", "-q", "-m", "licence"], repo)
    from dataclasses import replace
    world["sources"][0] = replace(world["sources"][0], sha=git(["rev-parse", "HEAD"], repo))
    _, r = gate(world)
    assert r["scores/Old,_Master/Set/Song_A/lc1.mxl"]["reason"] == "licence-evidence-missing"


def test_denylist_by_id_path_prefix_and_composer(world):
    deny = Denylist([
        {"id": "openscore-lieder:scores/Old,_Master/Set/Song_A/lc1.mxl", "reason": "takedown"},
        {"path_prefix": "mutopia:ftp/Traditional/pd/"},
        {"composer": "edge_case"},
    ])
    _, r = gate(world, deny=deny)
    assert r["scores/Old,_Master/Set/Song_A/lc1.mxl"]["reason"] == "denylisted"
    assert r["scores/Old,_Master/Set/Song_B/lc2.mxl"]["status"] == "pass"
    assert r["scores/Edge,_Case/Set/Song/lc3.mxl"]["reason"] == "denylisted"
    assert r["ftp/Traditional/pd/pd.ly"]["reason"] == "denylisted"


def test_optional_source_with_nothing_fetched_is_skipped_but_required_is_not(world):
    lock, fpath, comp = prepare(world)
    recs = [r for r in read_jsonl(fpath) if r["corpus"] != "mutopia"]
    write_jsonl(fpath, recs)
    summary = run_gate(world["sources"], world["cache"], lock, fpath, comp, world["build"] / "gate", extras=ExtraIndex([]), deny=Denylist([]))
    assert summary["skippedSources"] == ["mutopia"]
    write_jsonl(fpath, [r for r in recs if r["corpus"] != "openscore-quartets"])
    with pytest.raises(RuntimeError):
        run_gate(world["sources"], world["cache"], lock, fpath, comp, world["build"] / "gate", extras=ExtraIndex([]), deny=Denylist([]))


def test_cli_stages_run_end_to_end(world, monkeypatch):
    from corpus_build import cli, fetch as fetch_mod
    monkeypatch.setattr(cli, "load_sources", lambda: world["sources"])
    monkeypatch.setattr(cli, "COMPOSERS_YAML", world["root"] / "composers.yaml")
    monkeypatch.setattr(cli, "write_composers", lambda data: __import__("corpus_build.composers", fromlist=["x"]).write_composers(data, world["root"] / "composers.yaml"))
    monkeypatch.setattr(cli, "load_composers", lambda: __import__("corpus_build.composers", fromlist=["x"]).load_composers(world["root"] / "composers.yaml"))
    lock_path = world["lock_path"]
    monkeypatch.setattr(cli, "write_lock", lambda s, c: fetch_mod.write_lock(s, c, lock_path, today="2026-01-01"))
    monkeypatch.setattr(cli, "load_lock", lambda: fetch_mod.load_lock(lock_path))
    argv = ["--cache", str(world["cache"]), "--build", str(world["build"])]
    assert cli.main([*argv, "fetch", "lock", "composers", "verify", "gate"]) == 0
    assert (world["build"] / "gate" / "candidates.jsonl").is_file()
    assert json.loads((world["build"] / "gate" / "summary.json").read_text())["total"] == 16
    with pytest.raises(SystemExit):
        cli.main([*argv, "nonsense"])
