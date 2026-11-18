from corpus_build.composers import ComposerIndex, ExtraIndex, Extra, norm_key
from corpus_build.licence import parse_ly_header
from corpus_build.pd import edition_year, evaluate_death_year, evaluate_mutopia, evaluate_openscore, is_anonymous, load_pd_config, split_arrangers

CFG = load_pd_config()


def test_config_constants_match_ruling_28():
    assert CFG.composer_died_before == 1931
    assert CFG.edition_year_max == 1930


def test_death_year_boundary():
    assert evaluate_death_year(1930, CFG)[0] is True
    ok, reason, _ = evaluate_death_year(1931, CFG)
    assert (ok, reason) == (False, "composer-not-public-domain")
    assert evaluate_death_year(None, CFG)[1] == "composer-death-unknown"
    assert evaluate_death_year(1700, CFG)[0] is True


def _index(**kw):
    rec = {"key": "k", "name": "N", "born": 1800, "died": 1850, "paths": {"c": "N"}, **kw}
    return ComposerIndex({"composers": [rec]})


def test_openscore_decisions():
    assert evaluate_openscore("c", "N", _index(), CFG).passed
    d = evaluate_openscore("c", "N", _index(died=1931), CFG)
    assert (d.passed, d.reason) == (False, "composer-not-public-domain")
    assert evaluate_openscore("c", "N", _index(died=None), CFG).reason == "composer-death-unknown"
    assert evaluate_openscore("c", "Other", _index(), CFG).reason == "composer-not-in-metadata"
    d = evaluate_openscore("c", "N", _index(), CFG)
    assert d.basis == "composer-death" and d.composer["source"] == "openscore-composers"


def test_composer_dir_suffix_aliases_resolve():
    idx = ComposerIndex({"composers": [{"key": "k", "name": "N", "born": 1, "died": 1850, "paths": {"c": "Hensel,_Fanny_(Mendelssohn)"}},
                                       {"key": "j", "name": "M", "born": 1, "died": 1850, "paths": {"c": "Barnard,_C_-_aka_Claribel"}}]})
    assert idx.lookup("c", "Hensel,_Fanny")["key"] == "k"
    assert idx.lookup("c", "Hensel,_Fanny_(Mendelssohn)")["key"] == "k"
    assert idx.lookup("c", "Barnard,_C")["key"] == "j"
    assert idx.lookup("c", "Nobody") is None


def test_edition_year_takes_latest_plausible_year():
    assert edition_year("Carols Old and Carols New (Boston: Parish Choir, 1916), Carol #415", CFG) == 1916
    assert edition_year("Facsimile from 1685 edition", CFG) == 1685
    assert edition_year("reprint of 1895 edition, 1962", CFG) == 1962
    assert edition_year("www.cyberhymnal.org", CFG) is None
    assert edition_year("Op. 12345 no year", CFG) is None
    assert edition_year(None, CFG) is None


def test_anonymous_names_and_arrangers():
    for t in ["Traditional", "Anonymous", "Anon", "Anon.", "Finnish folk song", "Volksweise,", "HARDANGER", "trad. (coll. G. B. Gardiner)", ""]:
        assert is_anonymous(t, CFG), t
    assert not is_anonymous("Ludwig van Beethoven", CFG)
    assert split_arrangers("Arr. Y. Nagai, K. Obata") == ("", ["Y. Nagai", "K. Obata"])
    assert split_arrangers("trad. (coll. G. B. Gardiner), arr. Gustav von Holst") == ("trad. (coll. G. B. Gardiner)", ["Gustav von Holst"])
    assert split_arrangers("Traditional") == ("Traditional", [])


EXTRAS = ExtraIndex([
    Extra("mason_lowell", "Lowell Mason", 1792, 1872, ("https://a",), ("MasonL",)),
    Extra("early", "Early Arranger", 1700, 1760, (), ()),
    Extra("mid", "Mid Arranger", 1850, 1920, ("https://a",), ()),
    Extra("mid2", "Mid Two", 1850, 1920, ("https://a", "https://b"), ()),
    Extra("late", "Late Arranger", 1850, 1935, ("https://a", "https://b"), ()),
])


def mut(folder, composer="Traditional", source="Old Book, 1895"):
    h = parse_ly_header(f'\\header {{ composer = "{composer}" source = "{source}" }}')
    return evaluate_mutopia(folder, h, EXTRAS, CFG)


def test_mutopia_traditional_needs_an_edition_year_at_or_before_1930():
    assert mut("Traditional").passed and mut("Traditional").basis == "edition-year"
    assert mut("Traditional", source="x, 1930").passed
    assert mut("Traditional", source="x, 1931").reason == "edition-year-too-late"
    assert mut("Anonymous", source="no year").reason == "edition-year-missing"


def test_mutopia_named_folder_uses_composers_extra():
    d = mut("MasonL", composer="Lowell Mason", source="whatever")
    assert d.passed and d.basis == "composer-extra" and d.composer["died"] == 1872
    assert mut("Unlisted", composer="Somebody").reason == "composer-not-in-metadata"


def test_mutopia_arrangers_must_be_verified():
    assert mut("Traditional", composer="Arr. Nobody Known").reason == "arranger-unverified"
    assert mut("Traditional", composer="Traditional, arr. Early Arranger").reason == "extra-entry-missing-references"
    d = mut("Traditional", composer="Traditional, arr. Mid Two")
    assert d.passed and d.arrangers == ["Mid Two"]
    assert mut("Traditional", composer="Traditional, arr. Mid Arranger").reason == "extra-entry-missing-references"
    assert mut("Traditional", composer="Traditional, arr. Late Arranger").reason == "arranger-not-public-domain"


def test_extra_auto_pass_needs_one_reference_up_to_1900_and_two_after():
    from corpus_build.pd import evaluate_extra
    assert evaluate_extra(EXTRAS.lookup("Lowell Mason"), CFG)[0]
    assert not evaluate_extra(EXTRAS.lookup("Mid Arranger"), CFG)[0]
    assert evaluate_extra(EXTRAS.lookup("Mid Two"), CFG)[0]


def test_norm_key():
    assert norm_key("Arriaga, Juan Crisóstomo de") == "arriaga_juan_crisostomo_de"
    assert norm_key("MasonL") == "masonl"
