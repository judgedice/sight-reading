"""Job C7 on the repository's real build (skipped when build/ does not hold the stages).

- The committed thresholds of config/filters.yaml meet the calibration target on the automated control sets (03 6.9:
  at least 90% of negatives rejected at at least 70% of positives accepted), and match what the calibration records.
- Stage `filters`: one record per kept features-stage window, reasons consistent, deterministic.
- Stage `dedupe`: no two kept windows share a fingerprint outside one dedupeGroup, and no near-duplicate pair lies across
  two groups (H-dedupe, 03 5.2, re-checked by brute force over the candidate index).
- familiar.yaml: every incipit equals its recomputation from the normalized parts.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from corpus_build.candidate import read_jsonl
from corpus_build.dedupe import candidate_pairs, grams, jaccard
from corpus_build.familiar import FAMILIAR_YAML, compute_incipit, load_familiar
from corpus_build.quality import filters_config
from corpus_build.yamlio import load_yaml

BUILD = Path(__file__).resolve().parent.parent / "build"
needs = pytest.mark.skipif(not (BUILD / "features" / "candidates.jsonl").exists() or not (BUILD / "extract" / "candidates.jsonl").exists(), reason="run the pipeline through `features` first")


@needs
def test_committed_thresholds_meet_the_calibration_target() -> None:
    from corpus_build.calibration import control_sets, evaluate

    cfg = filters_config()
    sets = control_sets(BUILD)
    ev = evaluate(sets, cfg)
    target = cfg["control_calibration"]
    assert ev["positives"] >= 30 and ev["negativesReal"] >= 100 and ev["negativesSynthetic"] >= 100
    assert ev["negativeRejection"] >= target["negative_rejection_min"], ev
    assert ev["positiveAcceptance"] >= target["positive_acceptance_min"], ev
    cal = cfg["calibration"]["atFittedValues"]
    assert ev["positiveAcceptance"] == pytest.approx(cal["positiveAcceptance"], abs=1e-4)
    assert ev["negativeRejection"] == pytest.approx(cal["negativeRejection"], abs=1e-4)


@needs
def test_filters_stage_records() -> None:
    p = BUILD / "filters" / "candidates.jsonl"
    if not p.exists():
        pytest.skip("run `python -m corpus_build filters` first")
    feats = {r["id"] for r in read_jsonl(BUILD / "features" / "candidates.jsonl") if r["status"] == "pass"}
    recs = read_jsonl(p)
    assert {r["id"] for r in recs} == feats
    for r in recs:
        assert (r["status"] == "reject") == bool(r["failedRules"])
        if r["status"] == "reject":
            assert r["reason"] == r["failedRules"][0]
        assert set(r["flags"]) <= {"noBreath", "leapy", "bass-line"}
        assert r["familiarity"] in (0, 2) and (r["familiarity"] == 2) == (r.get("familiarMatch") is not None)
        assert len(r["fingerprint"]) == r["features"]["noteCount"] - 1
        assert r["quality"]["interestMargin"] == pytest.approx(r["quality"]["interest"] - r["quality"]["interestThreshold"], abs=1e-4)
    kept = [r for r in recs if r["status"] == "pass"]
    assert len(kept) >= 1000
    assert sum(1 for r in kept if r["familiarity"] == 2) >= 10


@needs
def test_filters_are_deterministic_on_a_sample() -> None:
    from corpus_build.familiar import load_familiar as lf
    from corpus_build.filter_stage import _group, _task, file_parts

    recs = [r for r in read_jsonl(BUILD / "features" / "candidates.jsonl") if r["status"] == "pass"]
    groups = _group(recs)
    files = file_parts(BUILD)
    sample = groups[:: max(1, len(groups) // 25)]
    fam = lf()
    for ref, rs in sample:
        info = files.get(rs[0]["fileId"]) if rs[0]["corpus"] == "openscore-quartets" else None
        a = _task((str(BUILD), ref, rs, info, fam))
        b = _task((str(BUILD), ref, rs, info, fam))
        assert a == b


@needs
def test_dedupe_leaves_no_duplicate_across_groups() -> None:
    p = BUILD / "dedupe" / "candidates.jsonl"
    if not p.exists():
        pytest.skip("run `python -m corpus_build dedupe` first")
    recs = read_jsonl(p)
    kept = [r for r in recs if r["status"] == "pass"]
    by_id = {r["id"]: r for r in recs}
    seen: dict[tuple[str, ...], str] = {}
    for r in kept:
        fp = tuple(r["fingerprint"])
        if fp in seen:
            assert by_id[seen[fp]]["dedupeGroup"] == r["dedupeGroup"], (r["id"], seen[fp])
        seen.setdefault(fp, r["id"])
    sets = {r["id"]: grams(r["fingerprint"], 4) for r in kept}
    work = {r["id"]: r["work"] for r in kept}
    group = {r["id"]: r["dedupeGroup"] for r in kept}
    for a, b in candidate_pairs(sets, 0.7):
        j = jaccard(sets[a], sets[b])
        if j >= 0.8 or (work[a] == work[b] and j >= 0.7):
            assert group[a] == group[b], (a, b, j)
    for r in recs:
        if r["status"] == "reject":
            assert r["reason"] in ("duplicate", "near-duplicate") and by_id[r["dupOf"]]["status"] == "pass"


@needs
def test_familiar_incipits_are_read_from_the_sources() -> None:
    extract = read_jsonl(BUILD / "extract" / "candidates.jsonl")
    tunes = load_yaml(FAMILIAR_YAML)["tunes"]
    assert len(tunes) >= 35
    assert len(load_familiar()) == len(tunes)
    for e in tunes:
        assert compute_incipit(BUILD, e, extract) == e["incipit"].split(), e["id"]
