"""Licence gate, step 2 (03 section 6.2 and 9.2): the composition must be in the public domain by the v1 rule.

The composer's death year comes from OpenScore data/composers.yaml (normalised into composers.yaml) or, for composers
outside it, from composers-extra.yaml with cited references. Traditional and anonymous pieces need a source-edition
year of 1930 or earlier, parsed from the Mutopia `source` header. Anything unverifiable is rejected. No human adds rows.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .composers import ComposerIndex, Extra, ExtraIndex, norm_key
from .licence import LyHeader
from .paths import CONFIG_DIR
from .yamlio import load_yaml

_YEAR_IN_TEXT = re.compile(r"(?<!\d)(\d{4})(?!\d)")
_ARR = re.compile(r"\b(arr\.?|arranged(?: by)?|arrangement(?: by)?)\s", re.I)


@dataclass(frozen=True)
class PdConfig:
    composer_died_before: int
    edition_year_max: int
    edition_year_plausible_min: int
    extra_auto_pass_died_max: int
    extra_min_refs_later: int
    extra_min_refs_auto: int
    anonymous_names: frozenset[str]
    anonymous_patterns: tuple[re.Pattern[str], ...]


def load_pd_config(path: Path | None = None) -> PdConfig:
    d = load_yaml(path or CONFIG_DIR / "pd.yaml")
    return PdConfig(
        composer_died_before=int(d["composer_died_before"]),
        edition_year_max=int(d["edition_year_max"]),
        edition_year_plausible_min=int(d["edition_year_plausible_min"]),
        extra_auto_pass_died_max=int(d["extra"]["auto_pass_died_max"]),
        extra_min_refs_later=int(d["extra"]["min_refs_later"]),
        extra_min_refs_auto=int(d["extra"]["min_refs_auto"]),
        anonymous_names=frozenset(str(n).strip().lower() for n in d["anonymous_composer_names"]),
        anonymous_patterns=tuple(re.compile(p) for p in d["anonymous_composer_patterns"]),
    )


@dataclass
class PdDecision:
    passed: bool
    reason: str | None
    detail: str
    basis: str  # composer-death | composer-extra | edition-year | none
    cutoff: int
    composer: dict[str, Any]
    edition_year: int | None = None
    arrangers: list[str] = field(default_factory=list)

    def pd_block(self) -> dict[str, Any]:
        out: dict[str, Any] = {"passed": self.passed, "basis": self.basis, "cutoff": self.cutoff}
        if self.edition_year is not None or self.basis == "edition-year":
            out["editionYear"] = self.edition_year
        if self.arrangers:
            out["arrangers"] = self.arrangers
        return out


def _composer_block(key: str, name: str, born: int | None, died: int | None, source: str, refs: tuple[str, ...] = ()) -> dict[str, Any]:
    b: dict[str, Any] = {"key": key, "name": name, "born": born, "died": died, "source": source}
    if refs:
        b["references"] = list(refs)
    return b


def evaluate_death_year(died: int | None, cfg: PdConfig) -> tuple[bool, str | None, str]:
    if died is None:
        return False, "composer-death-unknown", "no death year in the source metadata"
    if died >= cfg.composer_died_before:
        return False, "composer-not-public-domain", f"died {died}, not before {cfg.composer_died_before}"
    return True, None, f"died {died}, before {cfg.composer_died_before}"


def evaluate_extra(extra: Extra, cfg: PdConfig) -> tuple[bool, str | None, str, str]:
    """composers-extra.yaml entry. Returns (passed, reason, detail, reason-kind for arrangers)."""
    if extra.died is None:
        return False, "composer-death-unknown", f"{extra.name}: no death year in composers-extra.yaml", "unknown"
    if extra.died >= cfg.composer_died_before:
        return False, "composer-not-public-domain", f"{extra.name}: died {extra.died}, not before {cfg.composer_died_before}", "late"
    need = cfg.extra_min_refs_auto if extra.died <= cfg.extra_auto_pass_died_max else cfg.extra_min_refs_later
    if len(set(extra.references)) < need:
        return False, "extra-entry-missing-references", f"{extra.name}: died {extra.died}, needs {need} cited reference(s), has {len(set(extra.references))}", "refs"
    return True, None, f"{extra.name}: died {extra.died} (composers-extra.yaml, {len(set(extra.references))} reference(s))", "ok"


def evaluate_openscore(corpus: str, composer_dir: str, composers: ComposerIndex, cfg: PdConfig) -> PdDecision:
    rec = composers.lookup(corpus, composer_dir)
    if rec is None:
        name = composer_dir.replace("_", " ")
        return PdDecision(False, "composer-not-in-metadata", f"{composer_dir} is not in {corpus} data/composers.yaml", "none",
                          cfg.composer_died_before, _composer_block(norm_key(name), name, None, None, "none"))
    ok, reason, detail = evaluate_death_year(rec["died"], cfg)
    block = _composer_block(rec["key"], rec["name"], rec["born"], rec["died"], "openscore-composers")
    return PdDecision(ok, reason, detail, "composer-death" if ok else "none", cfg.composer_died_before, block)


def edition_year(source_text: str | None, cfg: PdConfig) -> int | None:
    """Latest plausible four-digit year in the Mutopia `source` header (the conservative choice), or None."""
    if not source_text:
        return None
    years = [int(y) for y in _YEAR_IN_TEXT.findall(source_text)]
    years = [y for y in years if cfg.edition_year_plausible_min <= y <= 2100]
    return max(years) if years else None


def is_anonymous(text: str, cfg: PdConfig) -> bool:
    t = re.sub(r"\s+", " ", text).strip().strip(",;.").lower()
    if not t or t in cfg.anonymous_names or t + "." in cfg.anonymous_names:
        return True
    return any(p.search(text.strip()) for p in cfg.anonymous_patterns)


def split_arrangers(composer_text: str) -> tuple[str, list[str]]:
    """'Traditional, arr. A. B, C. D' -> ('Traditional', ['A. B', 'C. D']). No 'arr' -> (text, [])."""
    m = _ARR.search(composer_text + " ")
    if not m:
        return composer_text.strip(), []
    base = composer_text[: m.start()].strip().rstrip(",;(").strip()
    rest = composer_text[m.end() - 1 :].strip().rstrip(")")
    arrangers = [a.strip() for a in re.split(r"\s*(?:,|;|&|\band\b)\s*", rest) if a.strip()]
    # "A. B" style initials split on none of the separators above, so names stay whole.
    return base, arrangers


def evaluate_mutopia(folder: str, header: LyHeader, extras: ExtraIndex, cfg: PdConfig) -> PdDecision:
    """folder is the ftp/<folder> composer directory (Traditional, Anonymous, MasonL)."""
    comp_text = (header.text("composer") or "").strip()
    src_text = header.text("source")
    base, arrangers = split_arrangers(comp_text) if comp_text else ("", [])

    # Named composer: only a folder that is a person's directory (MasonL) names one. In Traditional and Anonymous
    # folders the header `composer` is descriptive (a source, a region or "Anonymous"), so only its arrangers count.
    named: Extra | None = None
    named_label = ""
    folder_is_anon = folder.strip().lower() in cfg.anonymous_names
    if not folder_is_anon:
        named = extras.lookup(folder)
        named_label = folder
        if named is None:
            return PdDecision(False, "composer-not-in-metadata", f"{folder} is not in composers-extra.yaml", "none", cfg.composer_died_before,
                              _composer_block(norm_key(folder), folder, None, None, "none"))

    # Arrangers: each must be verified like a composer.
    arr_names: list[str] = []
    for a in arrangers:
        arr_names.append(a)
        e = extras.lookup(a)
        if e is None:
            return PdDecision(False, "arranger-unverified", f"arranger {a!r} is not in composers-extra.yaml", "none", cfg.composer_died_before,
                              _composer_block("anonymous" if named is None else named.key, named_label or "Traditional", None, None, "anonymous" if named is None else "composers-extra"),
                              arrangers=arr_names)
        ok, reason, detail, _ = evaluate_extra(e, cfg)
        if not ok:
            r = "arranger-not-public-domain" if reason in ("composer-not-public-domain", "composer-death-unknown") else reason
            return PdDecision(False, r, f"arranger {detail}", "none", cfg.composer_died_before,
                              _composer_block(e.key, e.name, e.born, e.died, "composers-extra", e.references), arrangers=arr_names)

    if named is not None:
        ok, reason, detail, _ = evaluate_extra(named, cfg)
        block = _composer_block(named.key, named.name, named.born, named.died, "composers-extra", named.references)
        return PdDecision(ok, reason, detail, "composer-extra" if ok else "none", cfg.composer_died_before, block, arrangers=arr_names)

    # Traditional or anonymous: the source edition decides.
    year = edition_year(src_text, cfg)
    block = _composer_block("anonymous", base or "Traditional", None, None, "anonymous")
    if year is None:
        return PdDecision(False, "edition-year-missing", f"no edition year in source {src_text!r}" if src_text else "no source header", "none",
                          cfg.edition_year_max, block, None, arr_names)
    if year > cfg.edition_year_max:
        return PdDecision(False, "edition-year-too-late", f"source edition {year} is after {cfg.edition_year_max}", "none", cfg.edition_year_max, block, year, arr_names)
    return PdDecision(True, None, f"traditional or anonymous, source edition {year}", "edition-year", cfg.edition_year_max, block, year, arr_names)
