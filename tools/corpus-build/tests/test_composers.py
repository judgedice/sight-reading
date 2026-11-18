from corpus_build.composers import build_composers, load_extras, parse_year, read_openscore_composers
from corpus_build.fetch import fetch_source
from corpus_build.yamlio import load_strict_strings
from corpus_build.paths import COMPOSERS_EXTRA_YAML


def test_parse_year():
    assert parse_year("1851") == 1851
    assert parse_year(" 1851 ") == 1851
    for v in (None, "", "c. 1720", "?", "18"):
        assert parse_year(v) is None


def test_strict_loader_keeps_every_scalar_a_string(tmp_path):
    p = tmp_path / "c.yaml"
    p.write_text("123:\n  path: No\n  died: 1900\n  flag: yes\n  empty:\n", encoding="utf-8")
    d = load_strict_strings(p)
    assert d == {"123": {"path": "No", "died": "1900", "flag": "yes", "empty": ""}}


def test_build_composers_from_cloned_sources(world):
    for s in world["sources"]:
        fetch_source(s, world["cache"])
    src = world["sources"][0]
    raw = read_openscore_composers(src, world["cache"])
    assert raw["Old,_Master"]["died"] == 1770
    assert raw["Unknown,_Death"]["died"] is None
    data = build_composers(world["sources"], world["cache"])
    keys = [c["key"] for c in data["composers"]]
    assert keys == sorted(keys)
    old = next(c for c in data["composers"] if c["key"] == "old_master")
    assert old["paths"] == {"openscore-lieder": "Old,_Master", "openscore-quartets": "Old,_Master"}


def test_composers_extra_file_is_cited_and_indexed():
    idx = load_extras(COMPOSERS_EXTRA_YAML)
    mason = idx.lookup("MasonL")
    assert mason and mason.died == 1872 and len(mason.references) >= 1
    for e in idx.extras:
        assert e.references, f"{e.key} has no cited reference"
