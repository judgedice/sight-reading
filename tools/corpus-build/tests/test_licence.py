from corpus_build.licence import classify_mutopia, classify_value, parse_ly_header, HeaderValue, load_licence_config

CFG = load_licence_config()


def lic(src: str):
    return classify_mutopia(parse_ly_header(src), CFG)


def test_plain_strings_follow_the_exact_table():
    assert lic('\\header { license = "Public Domain" }').id == "PD"
    assert lic('\\header { copyright = "Public Domain"  }').id == "PD"
    assert lic('\\header { license = "Creative Commons Attribution 4.0" }').id == "CC-BY-4.0"
    assert lic('\\header { license = "  public   DOMAIN " }').id == "PD"


def test_excluded_licences_reject_with_licence_not_allowed():
    for text in [
        "Creative Commons Attribution 2.5", "Creative Commons Attribution-ShareAlike 4.0", "Creative Commons Attribution-ShareAlike 3.0",
        "Creative Commons Attribution-ShareAlike 2.0", "Creative Commons Attribution 3.0", "Creative Commons Attribution-NonCommercial 4.0",
        "GPL", "MutopiaBSD licence"
    ]:
        r = lic(f'\\header {{ license = "{text}" }}')
        assert not r.allowed and r.id is None, text
        assert r.reason in ("licence-not-allowed", "licence-unrecognised"), text


def test_unknown_string_is_unrecognised_and_missing_field_is_missing_evidence():
    assert lic('\\header { license = "Whatever" }').reason == "licence-unrecognised"
    assert lic('\\header { title = "x" }').reason == "licence-evidence-missing"


def test_markup_licences():
    pd = r'''\header { copyright = \markup { \override #'(baseline-skip . 0) \column { \concat { "Placed in the " \with-url #"http://creativecommons.org/licenses/publicdomain" "public domain" " by the typesetter" } } } }'''
    by4 = r'''\header { copyright = \markup { \column { \with-url #"http://creativecommons.org/licenses/by/4.0/" "Creative Commons Attribution 4.0 International License" } } }'''
    bysa = r'''\header { copyright = \markup { \column { \with-url #"http://creativecommons.org/licenses/by-sa/4.0/" "Creative Commons Attribution ShareAlike 4.0 International License" } } }'''
    assert lic(pd).id == "PD"
    assert lic(by4).id == "CC-BY-4.0"
    r = lic(bysa)
    assert not r.allowed and r.reason == "licence-not-allowed"


def test_both_families_in_one_markup_is_ambiguous_not_allowed():
    m = r'''\header { copyright = \markup { "Placed in the public domain" \with-url #"http://creativecommons.org/licenses/by/4.0/" "x" } }'''
    r = lic(m)
    assert not r.allowed and r.reason == "licence-ambiguous"


def test_fields_that_disagree_or_include_a_rejected_licence_reject():
    r = lic('\\header { license = "Public Domain"\n copyright = "Creative Commons Attribution 4.0" }')
    assert r.reason == "licence-ambiguous"
    r = lic('\\header { license = "Public Domain"\n copyright = "Creative Commons Attribution-ShareAlike 4.0" }')
    assert r.reason == "licence-not-allowed"


def test_header_parser_ignores_comments_and_handles_nested_braces_and_escapes():
    src = r'''
% license = "Public Domain"
%{ license = "Public Domain" %}
\header {
  title = "A \"quoted\" title" % trailing comment
  composer = \markup { \column { "a" { nested } } }
  license = "Creative Commons Attribution 4.0"
  tagline = ##f
}
'''
    h = parse_ly_header(src)
    assert h.text("title") == 'A "quoted" title'
    assert h.get("composer").kind == "markup"
    assert h.get("tagline").kind == "other"
    assert classify_mutopia(h, CFG).id == "CC-BY-4.0"


def test_comment_marker_inside_a_string_is_kept():
    h = parse_ly_header('\\header { source = "http://x.org/a%20b" license = "Public Domain" }')
    assert h.text("source") == "http://x.org/a%20b"


def test_classify_value_other_kind_is_unrecognised():
    assert classify_value(HeaderValue("other", "##f"), CFG)[1] == "licence-unrecognised"
