import json
import re

import jsonschema
import pytest

from corpus_build import candidate
from corpus_build.paths import CONFIG_DIR, SCHEMA_DIR, TOOL_DIR
from corpus_build.yamlio import load_yaml


def base(**kw):
    r = {"schemaVersion": 1, "stage": "gate", "kind": "file", "id": "openscore-lieder:a", "corpus": "openscore-lieder", "status": "pass",
         "path": "a", "sha256": "sha256:" + "0" * 64, "upstream": "OpenScore/Lieder@" + "0" * 40 + ":a"}
    r.update(kw)
    return r


def test_schema_is_a_valid_draft_2020_12_schema():
    s = json.loads((SCHEMA_DIR / "candidate.schema.json").read_text())
    jsonschema.Draft202012Validator.check_schema(s)


def test_valid_records():
    candidate.validate(base())
    candidate.validate(base(status="reject", reason="licence-not-allowed", detail="x"))
    candidate.validate({"schemaVersion": 1, "stage": "windows", "kind": "window", "id": "w", "parentId": "p", "corpus": "mutopia", "status": "reject", "reason": "rest-ratio", "anything": 1})


@pytest.mark.parametrize("mut", [
    lambda r: r.pop("id"),
    lambda r: r.update(status="reject"),                                   # reject without a reason
    lambda r: r.update(status="reject", reason="Not Kebab"),
    lambda r: r.update(status="reject", reason="made-up-gate-reason"),     # gate reasons are an enum
    lambda r: r.update(corpus="imslp"),
    lambda r: r.update(stage="bogus"),
    lambda r: r.update(sha256="abc"),
    lambda r: r.update(upstream="no-sha"),
    lambda r: r.pop("path"),                                               # a file record needs its path
    lambda r: r.update(schemaVersion=2),
])
def test_invalid_records(mut):
    r = base()
    mut(r)
    with pytest.raises(jsonschema.ValidationError):
        candidate.validate(r)


def test_window_and_part_records_need_a_parent():
    for kind in ("window", "part"):
        with pytest.raises(jsonschema.ValidationError):
            candidate.validate({"schemaVersion": 1, "stage": "windows", "kind": kind, "id": "x", "corpus": "mutopia", "status": "pass"})


def test_jsonl_roundtrip_is_sorted_and_stable(tmp_path):
    recs = [base(id="b"), base(id="a")]
    n = candidate.write_jsonl(tmp_path / "x.jsonl", recs)
    assert n == 2
    back = candidate.read_jsonl(tmp_path / "x.jsonl")
    assert [r["id"] for r in back] == ["a", "b"]
    first = (tmp_path / "x.jsonl").read_bytes()
    candidate.write_jsonl(tmp_path / "x.jsonl", list(reversed(recs)))
    assert (tmp_path / "x.jsonl").read_bytes() == first
    with pytest.raises(jsonschema.ValidationError):
        candidate.write_jsonl(tmp_path / "bad.jsonl", [base(status="reject")])


def test_pd_yaml_and_licences_yaml_hold_the_ruled_values():
    pd = load_yaml(CONFIG_DIR / "pd.yaml")
    assert pd["composer_died_before"] == 1931 and pd["edition_year_max"] == 1930 and pd["extra"]["auto_pass_died_max"] == 1900
    lic = load_yaml(CONFIG_DIR / "licences.yaml")
    assert lic["allowlist"] == ["PD", "CC0-1.0", "CC-BY-4.0"]
    assert set(lic["mutopia_exact"].values()) <= set(lic["allowlist"])
    for pats in list(lic["mutopia_markup"].values()):
        for p in pats:
            re.compile(p)


def test_filters_yaml_carries_the_spec_thresholds():
    f = load_yaml(CONFIG_DIR / "filters.yaml")
    h = f["hard_rejects"]
    assert h["rests"]["rest_ratio_max"] == 0.25
    assert h["repetition"]["repeated_note_ratio_max"] == 0.35
    assert h["fragments_min_notes_per_8_bars"] == 12
    assert f["interest"]["reject_below"] == 0.35 and f["interest"]["reject_below_quartet_inner_and_cello_L1_L2"] == 0.25
    assert f["dedupe"]["near_duplicate_jaccard"] == 0.8 and f["dedupe"]["near_duplicate_jaccard_same_work"] == 0.7
    assert sum(f["interest"]["weights"].values()) == pytest.approx(1.0)
    assert f["outliers"]["tail_percent"] == 2 and f["control_calibration"]["negative_rejection_min"] == 0.9
    re.compile(h["repetition"]["tempo_text_reject"])


def test_requirements_pin_every_package_and_include_music21():
    lines = [l.strip() for l in (TOOL_DIR / "requirements.txt").read_text().splitlines() if l.strip() and not l.startswith("#")]
    assert all("==" in l for l in lines)
    names = {l.split("==")[0].lower() for l in lines}
    assert {"music21", "python-ly", "jsonschema", "pyyaml", "pytest"} <= names
    assert any(l.startswith("music21==10.5.") for l in lines)


def test_music21_and_ly_import_for_later_stages():
    import importlib
    import music21, ly  # noqa: F401
    assert music21.__version__.startswith("10.5")
    importlib.import_module("jsonschema")
