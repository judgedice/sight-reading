"""Licence gate, step 1 (03 section 6.2): the encoding licence must be in the allowlist.

OpenScore: repository-wide CC0 1.0, evidenced by the hash of LICENSE.txt in the lock.
Mutopia: the `.ly` header's `license` or `copyright` field, matched by an exact table. A field that is a plain string
is matched exactly. A field that is a LilyPond \\markup (most Mutopia files) is matched on the licence URLs and phrases
it contains, and must match exactly one family.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .paths import CONFIG_DIR
from .yamlio import load_yaml


@dataclass(frozen=True)
class LicenceConfig:
    allowlist: tuple[str, ...]
    urls: dict[str, str]
    exact: dict[str, str]
    markup_families: dict[str, tuple[re.Pattern[str], ...]]
    markup_rejected: tuple[re.Pattern[str], ...]


def load_licence_config(path: Path | None = None) -> LicenceConfig:
    d = load_yaml(path or CONFIG_DIR / "licences.yaml")
    mm = d["mutopia_markup"]
    return LicenceConfig(
        allowlist=tuple(d["allowlist"]),
        urls=dict(d["urls"]),
        exact={_norm(k): v for k, v in d["mutopia_exact"].items()},
        markup_families={k: tuple(re.compile(p) for p in mm[k]) for k in mm if k != "rejected"},
        markup_rejected=tuple(re.compile(p) for p in mm["rejected"]),
    )


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower()


# ----------------------------------------------------------------------------------------------
# LilyPond header parsing
# ----------------------------------------------------------------------------------------------


@dataclass
class HeaderValue:
    kind: str  # "string" | "markup" | "other"
    text: str  # string content, or all string literals plus raw markup text, or the raw token


@dataclass
class LyHeader:
    fields: dict[str, list[HeaderValue]] = field(default_factory=dict)

    def get(self, key: str) -> HeaderValue | None:
        vals = self.fields.get(key)
        return vals[-1] if vals else None

    def text(self, key: str) -> str | None:
        v = self.get(key)
        return v.text if v else None


_IDENT = re.compile(r"[A-Za-z_][A-Za-z0-9_-]*")


def _strip_comments(src: str) -> str:
    """Remove `%{ ... %}` blocks and `% ...` line comments, leaving string literals alone."""
    out: list[str] = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c == '"':
            j = i + 1
            while j < n and src[j] != '"':
                j += 2 if src[j] == "\\" else 1
            out.append(src[i : j + 1])
            i = j + 1
        elif c == "%":
            if src.startswith("%{", i):
                j = src.find("%}", i + 2)
                i = n if j < 0 else j + 2
            else:
                j = src.find("\n", i)
                i = n if j < 0 else j
        else:
            out.append(c)
            i += 1
    return "".join(out)


def _read_string(s: str, i: int) -> tuple[str, int]:
    """s[i] == '"'. Returns (content, index after the closing quote)."""
    out: list[str] = []
    j = i + 1
    while j < len(s) and s[j] != '"':
        if s[j] == "\\" and j + 1 < len(s):
            out.append(s[j + 1])
            j += 2
        else:
            out.append(s[j])
            j += 1
    return "".join(out), j + 1


def _read_braced(s: str, i: int) -> tuple[str, int]:
    """s[i] == '{'. Returns (raw text including braces, index after the matching brace). Strings are skipped whole."""
    depth, j = 0, i
    while j < len(s):
        c = s[j]
        if c == '"':
            _, j = _read_string(s, j)
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return s[i : j + 1], j + 1
        j += 1
    return s[i:], len(s)


def _skip_ws(s: str, i: int) -> int:
    while i < len(s) and s[i] in " \t\r\n":
        i += 1
    return i


def _read_value(s: str, i: int) -> tuple[HeaderValue, int]:
    i = _skip_ws(s, i)
    if i >= len(s):
        return HeaderValue("other", ""), i
    if s[i] == '"':
        text, j = _read_string(s, i)
        # LilyPond allows string concatenation with no operator inside \header only via markup, so one literal is it.
        return HeaderValue("string", text), j
    if s.startswith("\\markup", i):
        j = _skip_ws(s, i + len("\\markup"))
        # \markup { ... } or \markup \command { ... } or \markup \command "text"
        start = j
        while j < len(s) and s[j] != "{" and s[j] not in "\n" and s[j] != '"':
            j += 1
        if j < len(s) and s[j] == "{":
            raw, j = _read_braced(s, j)
        elif j < len(s) and s[j] == '"':
            raw, j = _read_string(s, j)
        else:
            raw = s[start:j]
        return HeaderValue("markup", s[start:j] if raw is None else raw), j
    j = i
    while j < len(s) and s[j] not in " \t\r\n}":
        j += 1
    return HeaderValue("other", s[i:j]), j


def parse_ly_header(text: str) -> LyHeader:
    """Collect `key = value` pairs from every top-level `\\header { ... }` block (later duplicates are kept in order)."""
    s = _strip_comments(text)
    h = LyHeader()
    pos = 0
    while True:
        m = re.compile(r"\\header\s*\{").search(s, pos)
        if not m:
            break
        i = m.end()
        depth_end = _read_braced(s, m.end() - 1)[1]
        while i < depth_end - 1:
            i = _skip_ws(s, i)
            if i >= depth_end - 1:
                break
            im = _IDENT.match(s, i)
            if not im:
                i += 1
                continue
            key = im.group(0)
            j = _skip_ws(s, im.end())
            if j < len(s) and s[j] == "=":
                val, j = _read_value(s, j + 1)
                h.fields.setdefault(key, []).append(val)
                i = j
            else:
                i = im.end()
        pos = depth_end
    return h


def markup_text(raw: str) -> str:
    """All text a markup shows or links to: the string literals plus the raw text (for URLs inside \\with-url #"...")."""
    return raw


# ----------------------------------------------------------------------------------------------
# Classification
# ----------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class LicenceResult:
    id: str | None  # PD / CC0-1.0 / CC-BY-4.0, or None
    allowed: bool
    reason: str | None  # gate reason code when not allowed
    detail: str
    field: str | None = None
    evidence_text: str | None = None


def collapse(s: str, limit: int = 200) -> str:
    s = re.sub(r"\s+", " ", s).strip()
    return s if len(s) <= limit else s[: limit - 1] + "…"


def classify_value(value: HeaderValue, cfg: LicenceConfig) -> tuple[str | None, str | None, str]:
    """Returns (licence id or None, reason code or None, detail)."""
    if value.kind == "string":
        lic = cfg.exact.get(_norm(value.text))
        if lic:
            return lic, None, f"exact match: {collapse(value.text, 80)}"
        for pat in cfg.markup_rejected:
            if pat.search(value.text):
                return None, "licence-not-allowed", f"header names a licence outside the allowlist: {collapse(value.text, 80)}"
        low = _norm(value.text)
        if re.search(r"creative commons|cc[- ]by|licen[sc]e|copyright", low):
            return None, "licence-not-allowed", f"header names a licence outside the allowlist: {collapse(value.text, 80)}"
        return None, "licence-unrecognised", f"unrecognised licence text: {collapse(value.text, 80)}"
    if value.kind == "markup":
        for pat in cfg.markup_rejected:
            if pat.search(value.text):
                return None, "licence-not-allowed", "markup names a licence outside the allowlist"
        hits = sorted(fam for fam, pats in cfg.markup_families.items() if any(p.search(value.text) for p in pats))
        if len(hits) == 1:
            return hits[0], None, f"markup matches {hits[0]}"
        if len(hits) > 1:
            return None, "licence-ambiguous", f"markup matches more than one family: {', '.join(hits)}"
        return None, "licence-unrecognised", "markup names no recognised licence"
    return None, "licence-unrecognised", f"unsupported header value: {collapse(value.text, 80)}"


def classify_mutopia(header: LyHeader, cfg: LicenceConfig, fields: tuple[str, ...] = ("license", "copyright")) -> LicenceResult:
    """Resolve the licence of a Mutopia piece from `license` / `copyright`. If both are present they must agree."""
    results: list[tuple[str, str | None, str | None, str, HeaderValue]] = []
    for f in fields:
        for v in header.fields.get(f, []):
            lic, reason, detail = classify_value(v, cfg)
            results.append((f, lic, reason, detail, v))
    if not results:
        return LicenceResult(None, False, "licence-evidence-missing", "no license or copyright field in the header")
    ids = {r[1] for r in results if r[1]}
    bad = [r for r in results if r[2]]
    if bad:
        # A rejection by any field wins: a file that says BY-SA anywhere is never taken as PD.
        order = {"licence-not-allowed": 0, "licence-ambiguous": 1, "licence-unrecognised": 2}
        f, _, reason, detail, v = sorted(bad, key=lambda r: order.get(r[2] or "", 9))[0]
        return LicenceResult(None, False, reason, detail, f, collapse(v.text))
    if len(ids) > 1:
        f, _, _, _, v = results[0]
        return LicenceResult(None, False, "licence-ambiguous", f"fields disagree: {', '.join(sorted(ids))}", f, collapse(v.text))
    lic = next(iter(ids))
    f, _, _, detail, v = results[0]
    ok = lic in cfg.allowlist
    return LicenceResult(lic, ok, None if ok else "licence-not-allowed", detail, f, collapse(v.text))


def read_ly(path: Path) -> str:
    raw = path.read_bytes()
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("latin-1")


def repository_licence(src_licence: str, evidence_ok: bool, cfg: LicenceConfig, evidence_file: str, evidence_hash: str | None) -> LicenceResult:
    """OpenScore: repository-wide licence. Allowed only if the evidence file was verified against the lock."""
    if not evidence_ok:
        return LicenceResult(None, False, "licence-evidence-missing", f"{evidence_file} missing, changed or without the expected text", None, None)
    ok = src_licence in cfg.allowlist
    return LicenceResult(src_licence, ok, None if ok else "licence-not-allowed", f"repository-wide {src_licence} ({evidence_file})", None, evidence_hash)


def licence_block(res: LicenceResult, cfg: LicenceConfig, evidence: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": res.id if res.id else (collapse(res.evidence_text, 200) if res.evidence_text else None),
        "allowed": res.allowed,
        "url": cfg.urls.get(res.id) if res.id else None,
        "evidence": evidence,
    }
