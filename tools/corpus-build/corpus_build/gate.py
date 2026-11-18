"""C2: the licence and public-domain gate, run per file before any parsing (03 section 6.2).

Input: the fetch stage's records (build/fetch/candidates.jsonl) and the lock. Output: one gate record per file,
passed or rejected with a reason, in build/gate/candidates.jsonl, plus build/gate/summary.json.

A file passes only if all of these hold:
1. its encoding licence is in the allowlist and its licence evidence is recorded (and still matches the lock);
2. the composition is public domain by config/pd.yaml;
3. it is not on denylist.yaml.
The file's own hash must also match the lock, so a gate decision always refers to the bytes that were locked.
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

from .candidate import make_record, read_jsonl, write_jsonl
from .composers import ComposerIndex, ExtraIndex, load_extras
from .fetch import sha256_file
from .licence import (
    LicenceConfig, LicenceResult, classify_mutopia, collapse, licence_block, load_licence_config, parse_ly_header,
    read_ly, repository_licence,
)
from .paths import DENYLIST_YAML
from .pd import PdConfig, PdDecision, evaluate_mutopia, evaluate_openscore, load_pd_config
from .sources import Source
from .yamlio import load_yaml

SCHEMA_URL_NOTE = "Records follow schemas/candidate.schema.json (kind=file, stage=gate)."


class Denylist:
    def __init__(self, entries: list[dict[str, Any]]):
        self.ids = {e["id"] for e in entries if e.get("id")}
        self.prefixes = [e["path_prefix"] for e in entries if e.get("path_prefix")]
        self.composers = {e["composer"] for e in entries if e.get("composer")}

    def match(self, file_id: str, composer_key: str | None) -> str | None:
        if file_id in self.ids:
            return f"id {file_id}"
        for p in self.prefixes:
            if file_id.startswith(p):
                return f"path prefix {p}"
        if composer_key and composer_key in self.composers:
            return f"composer {composer_key}"
        return None


def load_denylist(path: Path = DENYLIST_YAML) -> Denylist:
    d = load_yaml(path) or {}
    return Denylist(d.get("denylist") or [])


def _openscore_meta(src: Source, rel: str) -> dict[str, str | None]:
    parts = rel.split("/")  # scores/<Composer>/<Set>/<Song>/file.mxl
    meta: dict[str, str | None] = {"work": None, "set": None, "scoreFile": parts[-1]}
    if len(parts) >= 4:
        meta["work"] = parts[2] if src.id == "openscore-quartets" else (parts[3] if len(parts) >= 5 else None)
    if len(parts) >= 5:
        meta["set"] = parts[2]
    return meta


def evidence_ok(src: Source, cache: Path, lock_entry: dict[str, Any]) -> tuple[bool, dict[str, Any]]:
    """Check the repository licence file against the lock and for the expected text."""
    pol = src.licence_policy
    ev_rel = pol["evidence_file"]
    locked = lock_entry["licenceEvidence"]
    p = src.dir(cache) / ev_rel
    block: dict[str, Any] = {"kind": "repository-licence-file", "file": ev_rel}
    if not p.is_file():
        return False, block
    h = sha256_file(p)
    block["sha256"] = h
    text_ok = pol.get("evidence_text", "") in p.read_text(encoding="utf-8", errors="replace")
    return (h == locked.get("sha256") and text_ok), block


def gate_source(
    src: Source,
    cache: Path,
    lock_entry: dict[str, Any],
    fetch_recs: list[dict[str, Any]],
    composers: ComposerIndex,
    extras: ExtraIndex,
    pd_cfg: PdConfig,
    lic_cfg: LicenceConfig,
    deny: Denylist,
) -> list[dict[str, Any]]:
    root = src.dir(cache)
    out: list[dict[str, Any]] = []
    repo_kind = src.licence_policy["kind"] == "repository"
    ev_ok, ev_block = evidence_ok(src, cache, lock_entry) if repo_kind else (True, {})

    for fr in fetch_recs:
        rel, fid = fr["path"], fr["id"]
        base_fields: dict[str, Any] = {"path": rel, "sha256": fr["sha256"], "upstream": fr["upstream"]}

        def reject(reason: str, detail: str, **extra: Any) -> None:
            out.append(make_record("gate", "file", fid, src.id, "reject", reason=reason, detail=detail, **base_fields, **extra))

        # Bytes must be the locked bytes.
        locked_hash = lock_entry["files"].get(rel)
        if locked_hash is None:
            reject("file-not-in-lock", "the file is not in sources.lock.yaml")
            continue
        actual = sha256_file(root / rel)
        if actual != locked_hash or fr["sha256"] != locked_hash:
            reject("file-hash-mismatch", f"locked {locked_hash}, found {actual}")
            continue

        meta: dict[str, str | None]
        if repo_kind:
            res: LicenceResult = repository_licence(src.licence_policy["licence"], ev_ok, lic_cfg, src.licence_policy["evidence_file"], ev_block.get("sha256"))
            lic_ev = dict(ev_block) if ev_block else {"kind": "repository-licence-file", "file": src.licence_policy["evidence_file"]}
            composer_dir = rel.split("/")[1]
            meta = _openscore_meta(src, rel)
            decision: PdDecision | None = None
        else:
            header = parse_ly_header(read_ly(root / rel))
            res = classify_mutopia(header, lic_cfg, tuple(src.licence_policy["fields"]))
            lic_ev = {"kind": "file-header", "file": rel, "sha256": locked_hash}
            if res.field:
                lic_ev["field"] = res.field
            if res.evidence_text:
                lic_ev["text"] = res.evidence_text
            meta = {k: (collapse(header.text(k) or "", 200) or None) for k in ("title", "composer", "source", "maintainer", "mutopiainstrument", "style")}
            composer_dir = rel.split("/")[1]

        lic = licence_block(res, lic_cfg, lic_ev)

        # Step 1: licence.
        if not res.allowed:
            reject(res.reason or "licence-not-allowed", res.detail, licence=lic, meta=meta)
            continue

        # Step 2: public domain.
        if repo_kind:
            decision = evaluate_openscore(src.id, composer_dir, composers, pd_cfg)
        else:
            decision = evaluate_mutopia(composer_dir, header, extras, pd_cfg)
        comp = decision.composer
        pd_block = decision.pd_block()
        if not decision.passed:
            reject(decision.reason or "composer-not-public-domain", decision.detail, licence=lic, composer=comp, pd=pd_block, meta=meta)
            continue

        # Step 3: denylist.
        hit = deny.match(fid, comp.get("key"))
        if hit:
            reject("denylisted", f"denylist.yaml matches {hit}", licence=lic, composer=comp, pd=pd_block, meta=meta)
            continue

        out.append(make_record("gate", "file", fid, src.id, "pass", detail=decision.detail, **base_fields, licence=lic, composer=comp, pd=pd_block, meta=meta))
    return out


def summarize(records: list[dict[str, Any]], skipped: list[str]) -> dict[str, Any]:
    by_corpus: dict[str, Any] = {}
    for corpus in sorted({r["corpus"] for r in records}):
        rs = [r for r in records if r["corpus"] == corpus]
        by_corpus[corpus] = {
            "files": len(rs),
            "passed": sum(r["status"] == "pass" for r in rs),
            "rejected": sum(r["status"] == "reject" for r in rs),
            "rejectedByReason": dict(sorted(Counter(r["reason"] for r in rs if r["status"] == "reject").items())),
            "passedByLicence": dict(sorted(Counter(r["licence"]["id"] for r in rs if r["status"] == "pass").items())),
            "passedComposers": len({r["composer"]["key"] for r in rs if r["status"] == "pass"}),
        }
    return {"total": len(records), "passed": sum(r["status"] == "pass" for r in records), "byCorpus": by_corpus, "skippedSources": sorted(skipped)}


def run_gate(
    sources: list[Source],
    cache: Path,
    lock: dict[str, Any],
    fetch_records_path: Path,
    composers: ComposerIndex,
    out_dir: Path,
    extras: ExtraIndex | None = None,
    pd_cfg: PdConfig | None = None,
    lic_cfg: LicenceConfig | None = None,
    deny: Denylist | None = None,
) -> dict[str, Any]:
    extras = extras or load_extras()
    pd_cfg = pd_cfg or load_pd_config()
    lic_cfg = lic_cfg or load_licence_config()
    deny = deny or load_denylist()
    fetched = read_jsonl(fetch_records_path)
    records: list[dict[str, Any]] = []
    skipped: list[str] = []
    for src in sources:
        entry = lock.get("sources", {}).get(src.id)
        recs = [r for r in fetched if r["corpus"] == src.id]
        if entry is None or not recs:
            # Optional sources (Mutopia, ruling 27) may yield nothing. A required source that is missing fails the run.
            if src.optional:
                skipped.append(src.id)
                continue
            raise RuntimeError(f"{src.id}: required source has no lock entry or no fetched files")
        records.extend(gate_source(src, cache, entry, recs, composers, extras, pd_cfg, lic_cfg, deny))
    write_jsonl(out_dir / "candidates.jsonl", records)
    summary = summarize(records, skipped)
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
    return summary
