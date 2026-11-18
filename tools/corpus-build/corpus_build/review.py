"""Automated review layer (job C8, 03 section 6.12; PLAN rulings 29 and 48).

Three commands:

- `review` (default run, after dedupe): reads `build/dedupe/candidates.jsonl` and writes `build/review/candidates.jsonl`
  and `summary.json`. Every dedupe survivor gets R1 (corpus_build/review_outliers.py), then the R2 decision, read from
  the committed verdict cache only (no model is called):
  * not requiring the agent veto: passes with review {llm: 'not-required'};
  * at L1 to L3 (`queue_levels`): passes only with an accepting verdict from both prompt variants, each from a packet
    whose blind controls passed (review {llm: 'accepted'}). Otherwise rejected: `review-rejected`,
    `review-controls-failed` or `review-missing` (no verdict yet; excluded and reported, never a build failure);
  * requiring the veto above L3 (x2 variants, quartet inner and cello parts, one outlier flag, interest within 0.10 of
    its threshold): rejected as `review-not-run` (ruling 48: excluded in v1).
  Records carry `contentHash` (corpus_build/review_items.content_hash) and the ExcerptDoc `review` block for C9.
- `review-export` (developer stage): writes the queue as packets `build/review/packet-NN.json` (about 40 items each:
  `packet.real_items` queue windows with `packet.positives` positive controls among them, plus one negative control of
  each kind) and their keys `build/review-key/packet-NN.key.json`. Only L1-L3 R1 survivors without a usable decision
  for both variants are queued.
- `review-ingest` (developer stage): reads `build/review/packet-NN.verdict-{A,B}[.retry].json`, checks them against
  the packet and `schemas/review-packet-verdict.schema.json`, scores the controls (03 6.12 R3: negatives rejected at least
  90%, positives accepted at least 75%) and merges the result into the committed cache: `review/verdicts.jsonl`
  (ReviewVerdict lines, `schemas/review-verdict.schema.json` at the repo root, keyed by contentHash, promptVersion and
  promptVariant) and `review/batches.jsonl` (one record per packet and variant: which content hashes it held, how its
  controls scored, whether it passed).
"""

from __future__ import annotations

import functools
import hashlib
import json
import math
import random
from collections import Counter, defaultdict
from collections.abc import Iterable
from pathlib import Path
from typing import Any

import jsonschema

from .candidate import make_record, read_jsonl, write_jsonl
from .features import REPO
from .partdata import load_part
from .paths import CONFIG_DIR, SCHEMA_DIR, TOOL_DIR
from .pipeline import _write_json
from .quality import filters_config
from .review_items import ControlError, content_hash, cut_early, pitch_shuffle, render_item, retag, shift_beat
from .review_outliers import key_check, level_confidence_reported, outlier_flags, r1_decision
from .window_stage import load_window
from .yamlio import load_yaml

REVIEW_DIR = TOOL_DIR / "review"
VERDICTS_JSONL = REVIEW_DIR / "verdicts.jsonl"
BATCHES_JSONL = REVIEW_DIR / "batches.jsonl"
INSTRUCTIONS = (
    "Review every item with the prompt variant named in tools/corpus-build/REVIEW.md, judging each from this file alone. "
    "Write packet-NN.verdict-A.json (variant A) or packet-NN.verdict-B.json (variant B) next to this file."
)
CARRY_DROP = ("stage", "status", "schemaVersion", "kind", "id", "corpus", "reason", "detail")


def review_config() -> dict[str, Any]:
    return load_yaml(CONFIG_DIR / "review.yaml")


def _schema(path: Path) -> jsonschema.Validator:
    with open(path, encoding="utf-8") as f:
        s = json.load(f)
    cls = jsonschema.validators.validator_for(s)
    return cls(s)


def verdict_validator() -> jsonschema.Validator:
    return _schema(REPO / "schemas" / "review-verdict.schema.json")


def _dumps(o: Any) -> str:
    return json.dumps(o, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def _sha(o: Any) -> str:
    return "sha256:" + hashlib.sha256(_dumps(o).encode("utf-8")).hexdigest()


def _rng(*parts: str) -> random.Random:
    return random.Random(int(hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()[:16], 16))


# --- R2: which items need the agent veto --------------------------------------------------------------------------------


def review_triggers(rec: dict[str, Any], outlier_count: int, fcfg: dict[str, Any] | None = None) -> list[str]:
    """03 6.12 R2 reasons an item needs the agent veto (empty: it ships on R0 and R1)."""
    fcfg = fcfg or filters_config()
    near = float(fcfg["interest"]["near_threshold_margin"])
    margin = (rec.get("quality") or {}).get("interestMargin")
    out = []
    if rec["effectiveLevel"] <= 3:
        out.append("level-1-to-3")
    if rec["id"].endswith("-aug2"):
        out.append("augmented-variant")
    if rec["corpus"] == "openscore-quartets" and rec.get("role") in ("inner", "cello"):
        out.append("quartet-inner-or-cello")
    if outlier_count == 1:
        out.append("one-outlier-flag")
    if margin is not None and margin < near - 1e-9:
        out.append("interest-near-threshold")
    return out


# --- the committed cache ------------------------------------------------------------------------------------------------


def load_cache(verdicts_path: Path = VERDICTS_JSONL, batches_path: Path = BATCHES_JSONL) -> tuple[dict[tuple[str, str, str], dict[str, Any]], list[dict[str, Any]]]:
    verdicts = {(v["contentHash"], v["promptVersion"], v["promptVariant"]): v for v in (read_jsonl(verdicts_path) if verdicts_path.exists() else [])}
    batches = read_jsonl(batches_path) if batches_path.exists() else []
    return verdicts, batches


def decisions(hashes: Iterable[str], cfg: dict[str, Any], verdicts: dict[tuple[str, str, str], dict[str, Any]], batches: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """hash -> {status: accepted | rejected | controls-failed | missing, perVariant: {variant: state}, verdicts: [...]}.
    A variant's verdict counts only if a packet holding the hash passed its controls for that variant."""
    pv = cfg["prompt_version"]
    variants = [cfg["variants"][k] for k in sorted(cfg["variants"])]
    passed: dict[str, set[str]] = defaultdict(set)
    failed: dict[str, set[str]] = defaultdict(set)
    for b in batches:
        if b["promptVersion"] != pv:
            continue
        (passed if b["passed"] else failed)[b["promptVariant"]].update(b["contentHashes"])
    out: dict[str, dict[str, Any]] = {}
    for h in hashes:
        per: dict[str, str] = {}
        used: list[dict[str, Any]] = []
        for var in variants:
            v = verdicts.get((h, pv, var))
            if h in passed[var] and v is not None:
                per[var] = v["verdict"]
                used.append(v)
            elif h in failed[var]:
                per[var] = "controls-failed"
            else:
                per[var] = "missing"
        states = set(per.values())
        if states == {"accept"}:
            status = "accepted"
        elif "reject" in states:
            status = "rejected"
        elif "controls-failed" in states:
            status = "controls-failed"
        else:
            status = "missing"
        out[h] = {"status": status, "perVariant": per, "verdicts": used}
    return out


# --- loading the survivors with R1 --------------------------------------------------------------------------------------


def survivors_with_r1(build: Path, cfg: dict[str, Any], fcfg: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """Dedupe survivors, each as {rec, content, hash, flags, key, r1Reason, r1Detail, triggers}."""
    fcfg = fcfg or filters_config()
    recs = [r for r in read_jsonl(build / "dedupe" / "candidates.jsonl") if r["status"] == "pass"]
    flags = outlier_flags(recs, fcfg)
    out = []
    for r in sorted(recs, key=lambda r: r["id"]):
        content = load_window(build, r)
        key = key_check(content, cfg["key_profile"])
        reason, detail = r1_decision(r, flags[r["id"]], key, fcfg)
        out.append(
            {
                "rec": r,
                "content": content,
                "hash": content_hash(content),
                "flags": flags[r["id"]],
                "key": key,
                "r1Reason": reason,
                "r1Detail": detail,
                "triggers": review_triggers(r, len(flags[r["id"]]), fcfg),
            }
        )
    return out


# --- stage `review` -----------------------------------------------------------------------------------------------------


def review_block(cfg: dict[str, Any], decision: dict[str, Any] | None) -> dict[str, Any]:
    if decision is None:
        return {"rules": cfg["rules_version"], "llm": "not-required", "llmVerdicts": [], "promptVersion": "none"}
    return {
        "rules": cfg["rules_version"],
        "llm": "accepted",
        "promptVersion": cfg["prompt_version"],
        "llmVerdicts": [{"pass": v["pass"], "verdict": v["verdict"], "reasons": v["reasons"]} for v in sorted(decision["verdicts"], key=lambda v: v["pass"])],
    }


def apply_review(items: list[dict[str, Any]], cfg: dict[str, Any], verdicts: dict[tuple[str, str, str], dict[str, Any]], batches: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Stage `review` records for the survivors (see the module docstring)."""
    levels = set(cfg["queue_levels"])
    dec = decisions([it["hash"] for it in items], cfg, verdicts, batches)
    out = []
    for it in items:
        r = it["rec"]
        carry = {k: v for k, v in r.items() if k not in CARRY_DROP}
        carry.update(contentHash=it["hash"], outlierFlags=it["flags"], keyProfile=it["key"], reviewRequired=it["triggers"])
        if it["r1Reason"]:
            out.append(make_record("review", "window", r["id"], r["corpus"], "reject", reason=it["r1Reason"], detail=it["r1Detail"], **carry))
            continue
        if not it["triggers"]:
            out.append(make_record("review", "window", r["id"], r["corpus"], "pass", review=review_block(cfg, None), **carry))
            continue
        if r["effectiveLevel"] not in levels:
            detail = f"needs the agent veto ({', '.join(it['triggers'])}), which runs on L1-L3 only in v1 (ruling 48)"
            out.append(make_record("review", "window", r["id"], r["corpus"], "reject", reason="review-not-run", detail=detail, **carry))
            continue
        d = dec[it["hash"]]
        carry["reviewState"] = d["perVariant"]
        if d["status"] == "accepted":
            out.append(make_record("review", "window", r["id"], r["corpus"], "pass", review=review_block(cfg, d), **carry))
            continue
        reason = {"rejected": "review-rejected", "controls-failed": "review-controls-failed", "missing": "review-missing"}[d["status"]]
        reasons = sorted({x for v in d["verdicts"] if v["verdict"] == "reject" for x in v["reasons"]})
        detail = "; ".join(f"{k}: {v}" for k, v in sorted(d["perVariant"].items())) + (f" ({'; '.join(reasons)})" if reasons else "")
        out.append(make_record("review", "window", r["id"], r["corpus"], "reject", reason=reason, detail=detail, **carry))
    return out


def review_summary(recs: list[dict[str, Any]]) -> dict[str, Any]:
    kept = [r for r in recs if r["status"] == "pass"]
    lv = lambda r: str(r["effectiveLevel"])
    return {
        "windows": len(recs),
        "kept": len(kept),
        "keptByLevel": dict(sorted(Counter(lv(r) for r in kept).items(), key=lambda kv: int(kv[0]))),
        "keptByLlm": dict(sorted(Counter(r["review"]["llm"] for r in kept).items())),
        "rejectedByReason": dict(sorted(Counter(r["reason"] for r in recs if r["status"] == "reject").items())),
        "rejectedByLevelAndReason": {
            k: dict(sorted(v.items()))
            for k, v in sorted(
                ((lvk, Counter(r["reason"] for r in recs if r["status"] == "reject" and lv(r) == lvk)) for lvk in {lv(r) for r in recs}),
                key=lambda kv: int(kv[0]),
            )
            if v
        },
        "outlierFlagCounts": dict(sorted(Counter(len(r["outlierFlags"]) for r in recs).items())),
        "levelConfidence1Above": dict(sorted(Counter(lv(r) for r in recs if level_confidence_reported(r, filters_config()["outliers"])).items(), key=lambda kv: int(kv[0]))),
        "reviewRequiredByLevel": dict(sorted(Counter(lv(r) for r in recs if r["reviewRequired"]).items(), key=lambda kv: int(kv[0]))),
    }


def run_review(build: Path, verdicts_path: Path = VERDICTS_JSONL, batches_path: Path = BATCHES_JSONL) -> dict[str, Any]:
    cfg = review_config()
    items = survivors_with_r1(build, cfg)
    verdicts, batches = load_cache(verdicts_path, batches_path)
    recs = apply_review(items, cfg, verdicts, batches)
    write_jsonl(build / "review" / "candidates.jsonl", recs)
    summary = review_summary(recs)
    _write_json(build / "review" / "summary.json", summary)
    return summary


# --- stage `review-export` ----------------------------------------------------------------------------------------------


def is_positive(rec: dict[str, Any], pcfg: dict[str, Any]) -> bool:
    q = rec.get("quality") or {}
    return (
        rec.get("cadenceEnd") in pcfg["cadence_end"]
        and rec.get("phraseQuality") in pcfg["phrase_quality"]
        and float(q.get("soft") or 0) >= float(pcfg["soft_min"]) - 1e-9
        and float(q.get("interestMargin") or 0) >= float(pcfg["interest_margin_min"]) - 1e-9
        and not (set(rec.get("flags") or []) - set(pcfg["flags_allowed"]))
        and rec.get("familiarity", 0) == 0
    )


def pick_positives(queue: list[dict[str, Any]], pcfg: dict[str, Any], n: int) -> list[dict[str, Any]]:
    """Up to n queue items satisfying the positive rule, one per dedupe group, openings first, then soft score."""
    cands = [it for it in queue if is_positive(it["rec"], pcfg)]
    openings = set(pcfg["opening_start_kinds"])
    cands.sort(key=lambda it: (it["rec"].get("startKind") not in openings, -float(it["rec"]["quality"]["soft"]), -float(it["rec"]["quality"]["interestMargin"]), it["hash"]))
    out, groups = [], set()
    for it in cands:
        g = it["rec"].get("dedupeGroup")
        if g in groups:
            continue
        groups.add(g)
        out.append(it)
        if len(out) == n:
            break
    return out


def meta_of(rec: dict[str, Any], level: int | None = None, feature_levels: dict[str, int] | None = None, source_measures: list[str] | None = None) -> dict[str, Any]:
    return {
        "corpus": rec["corpus"],
        "role": rec.get("role"),
        "roleLabel": rec.get("roleLabel"),
        "sourceMeasures": source_measures or rec.get("sourceMeasures"),
        "level": level if level is not None else rec["effectiveLevel"],
        "featureLevels": feature_levels or rec["featureLevels"],
        "augmented": rec["id"].endswith("-aug2"),
    }


def _order_key(kind: str, rid: str) -> str:
    return hashlib.sha256(f"{kind}|{rid}".encode()).hexdigest()


def _item_order(kind: str, it: dict[str, Any]) -> str:
    return _order_key(kind, it["rec"]["id"])


def is_accompaniment(rec: dict[str, Any], acfg: dict[str, Any], max_level: int) -> bool:
    """A filters-stage reject that is clearly accompaniment: a quartet inner or cello window (not a variant) whose Vn I
    is much more interesting in the same bars, or that failed a broken-chord or pedal-alternation rule."""
    if rec["status"] != "reject" or rec["corpus"] != "openscore-quartets" or rec.get("role") not in acfg["roles"]:
        return False
    if rec["id"].endswith("-aug2") or not rec.get("dataRef") or rec.get("effectiveLevel", 99) > max_level:
        return False
    mr = rec.get("melodicRole") or {}
    gap = mr.get("vn1Interest") is not None and mr.get("partSegmentInterest") is not None and mr["vn1Interest"] - mr["partSegmentInterest"] >= float(acfg["vn1_interest_gap_min"]) - 1e-9
    return bool(gap or set(rec.get("failedRules") or []) & set(acfg["failed_rules_any"]))


class ControlFactory:
    """Builds negative controls of each kind from the build, each source window used at most once."""

    def __init__(self, build: Path, cfg: dict[str, Any], survivors: list[dict[str, Any]], max_level: int):
        self.build, self.cfg, self.max_level = build, cfg, max_level
        self.used: set[str] = set()
        self.parts: dict[str, dict[str, Any]] = {}
        self.extract = {r["id"]: r for r in read_jsonl(build / "extract" / "candidates.jsonl") if r["status"] == "pass"}
        base = [it for it in survivors if it["rec"]["effectiveLevel"] <= max_level and not it["rec"]["id"].endswith("-aug2")]
        self.pools: dict[str, list[dict[str, Any]]] = {}
        for kind in ("cut-early", "shift-beat", "pitch-shuffle"):
            self.pools[kind] = sorted(base, key=functools.partial(_item_order, kind))
        acfg = cfg["accompaniment"]
        acc = [r for r in read_jsonl(build / "filters" / "candidates.jsonl") if is_accompaniment(r, acfg, max_level)]
        self.pools["accompaniment"] = sorted(acc, key=lambda r: _order_key("accompaniment", r["id"]))

    def _part(self, rec: dict[str, Any]) -> dict[str, Any]:
        pid = rec["parentId"]
        if pid not in self.parts:
            self.parts[pid] = load_part(self.build, self.extract[pid])
        return self.parts[pid]

    def make(self, kind: str, avoid_parts: set[str], avoid_hashes: set[str]) -> dict[str, Any] | None:
        """{kind, content, meta, hash, sourceId} or None when the pool is exhausted."""
        for entry in self.pools[kind]:
            rec = entry if kind == "accompaniment" else entry["rec"]
            if rec["id"] in self.used or rec["parentId"] in avoid_parts:
                continue
            try:
                if kind == "accompaniment":
                    content = load_window(self.build, rec)
                    meta = meta_of(rec)
                else:
                    src = entry["content"]
                    measures = None
                    if kind == "pitch-shuffle":
                        content = pitch_shuffle(src, rec["id"])
                    elif rec["parentId"] not in self.extract:
                        continue
                    elif kind == "cut-early":
                        content, measures = cut_early(src, rec, self._part(rec))
                    else:
                        content, measures = shift_beat(src, rec, self._part(rec))
                    tag = retag(content)
                    if not 1 <= tag["level"] <= self.max_level:
                        continue
                    meta = meta_of(rec, tag["level"], tag["featureLevels"], measures)
            except ControlError:
                continue
            h = content_hash(content)
            if h in avoid_hashes:
                continue
            self.used.add(rec["id"])
            return {"kind": kind, "content": content, "meta": meta, "hash": h, "sourceId": rec["id"]}
        return None


def build_packets(build: Path, cfg: dict[str, Any], survivors: list[dict[str, Any]], verdicts: dict[tuple[str, str, str], dict[str, Any]], batches: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    """(packets, keys, report)."""
    levels = set(cfg["queue_levels"])
    eligible = [it for it in survivors if it["rec"]["effectiveLevel"] in levels and not it["r1Reason"]]
    dec = decisions([it["hash"] for it in eligible], cfg, verdicts, batches)
    seen: set[str] = set()
    queue = []
    for it in sorted(eligible, key=lambda it: it["hash"]):
        if it["hash"] in seen:
            continue
        seen.add(it["hash"])
        if dec[it["hash"]]["status"] in ("accepted", "rejected"):
            continue
        queue.append(it)
    pk = cfg["packet"]
    report: dict[str, Any] = {"eligible": len(eligible), "queued": len(queue), "alreadyDecided": len(eligible) - len(queue)}
    if not queue:
        return [], [], dict(report, packets=0)
    n_packets = math.ceil(len(queue) / int(pk["real_items"]))
    positives = pick_positives(queue, cfg["positive_rule"], n_packets * int(pk["positives"]))
    pos_ids = {it["hash"] for it in positives}
    rest = [it for it in queue if it["hash"] not in pos_ids]
    slots: list[list[tuple[str, dict[str, Any]]]] = [[] for _ in range(n_packets)]
    for i, it in enumerate(positives):
        slots[i % n_packets].append(("positive", it))
    # fill so packet sizes differ by at most one
    for it in rest:
        j = min(range(n_packets), key=lambda k: (len(slots[k]), k))
        slots[j].append(("item", it))
    factory = ControlFactory(build, cfg, survivors, max(levels))
    real_hashes = {it["hash"] for it in queue}
    packets, keys = [], []
    shortfalls: Counter[str] = Counter()
    for p, slot in enumerate(slots):
        pid = f"packet-{p + 1:02d}"
        entries = [{"role": role, "content": it["content"], "meta": meta_of(it["rec"]), "hash": it["hash"], "windowId": it["rec"]["id"]} for role, it in slot]
        avoid = {it["rec"]["parentId"] for _, it in slot}
        for kind in pk["negatives"]:
            c = factory.make(kind, avoid, real_hashes)
            if c is None:
                shortfalls[kind] += 1
                continue
            avoid.add(c["sourceId"].split("@", 1)[0])
            entries.append({"role": "negative", "control": kind, "content": c["content"], "meta": c["meta"], "hash": c["hash"], "windowId": c["sourceId"]})
        _rng(pid, *sorted(e["hash"] for e in entries)).shuffle(entries)
        items, key_items = [], {}
        for n, e in enumerate(entries, 1):
            iid = f"item-{n:02d}"
            items.append(render_item(iid, e["content"], e["meta"]))
            key_items[iid] = {k: e[k] for k in ("role", "hash", "windowId") if k in e} | ({"control": e["control"]} if "control" in e else {})
        phash = _sha(items)
        packets.append({"packetId": pid, "packetHash": phash, "promptVersion": cfg["prompt_version"], "variants": dict(cfg["variants"]), "instructions": INSTRUCTIONS, "itemCount": len(items), "items": items})
        keys.append({"packetId": pid, "packetHash": phash, "promptVersion": cfg["prompt_version"], "items": key_items})
    report.update(
        packets=len(packets),
        positives=len(positives),
        negatives=sum(1 for k in keys for v in k["items"].values() if v["role"] == "negative"),
        negativeShortfall=dict(sorted(shortfalls.items())),
        itemsPerPacket=[p["itemCount"] for p in packets],
    )
    return packets, keys, report


def run_review_export(build: Path, verdicts_path: Path = VERDICTS_JSONL, batches_path: Path = BATCHES_JSONL) -> dict[str, Any]:
    cfg = review_config()
    survivors = survivors_with_r1(build, cfg)
    verdicts, batches = load_cache(verdicts_path, batches_path)
    packets, keys, report = build_packets(build, cfg, survivors, verdicts, batches)
    out_dir, key_dir = build / "review", build / "review-key"
    out_dir.mkdir(parents=True, exist_ok=True)
    key_dir.mkdir(parents=True, exist_ok=True)
    for old in list(out_dir.glob("packet-??.json")) + list(key_dir.glob("packet-??.key.json")):
        old.unlink()
    validator = _schema(SCHEMA_DIR / "review-packet.schema.json")
    paths = []
    for p, k in zip(packets, keys):
        validator.validate(p)
        _write_json(out_dir / f"{p['packetId']}.json", p)
        _write_json(key_dir / f"{p['packetId']}.key.json", k)
        paths.append(str(out_dir / f"{p['packetId']}.json"))
    report["files"] = paths
    _write_json(key_dir / "export.json", report)
    return report


# --- stage `review-ingest` ----------------------------------------------------------------------------------------------


class IngestError(ValueError):
    pass


def check_verdict_file(doc: dict[str, Any], key: dict[str, Any], variant: str, cfg: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], list[str]]:
    """itemId -> verdict (after coercion), warnings. Raises IngestError when the file does not answer the packet."""
    errors = sorted(_schema(SCHEMA_DIR / "review-packet-verdict.schema.json").iter_errors(doc), key=lambda e: list(e.path))
    if errors:
        raise IngestError(f"schema: {errors[0].message} at {'/'.join(map(str, errors[0].path))}")
    if doc["packetId"] != key["packetId"] or doc["packetHash"] != key["packetHash"]:
        raise IngestError(f"answers {doc['packetId']} {doc['packetHash'][:15]}, not {key['packetId']} {key['packetHash'][:15]} (stale export?)")
    if doc["promptVersion"] != cfg["prompt_version"] or doc["promptVariant"] != cfg["variants"][variant]:
        raise IngestError(f"prompt {doc['promptVersion']}/{doc['promptVariant']}, expected {cfg['prompt_version']}/{cfg['variants'][variant]}")
    by_item: dict[str, dict[str, Any]] = {}
    for v in doc["verdicts"]:
        if v["itemId"] in by_item:
            raise IngestError(f"{v['itemId']} answered twice")
        by_item[v["itemId"]] = v
    missing = sorted(set(key["items"]) - set(by_item))
    extra = sorted(set(by_item) - set(key["items"]))
    if missing or extra:
        raise IngestError(f"items missing {missing}, unknown {extra}")
    warnings = []
    out = {}
    for iid, v in sorted(by_item.items()):
        v = dict(v)
        bad = [n for n, ok in (("completePhrase", v["completePhrase"]), ("conclusiveEnd", v["conclusiveEnd"]), ("not accompanimentLike", not v["accompanimentLike"]), ("levelPlausible", v["levelPlausible"])) if not ok]
        if v["verdict"] == "accept" and bad:
            warnings.append(f"{iid}: accept with failed checks {bad}; counted as reject")
            v["verdict"] = "reject"
            v["reasons"] = list(v["reasons"]) + [f"inconsistent accept: {', '.join(bad)}"]
        out[iid] = v
    return out, warnings


def score_controls(key: dict[str, Any], answers: dict[str, dict[str, Any]], ccfg: dict[str, Any]) -> dict[str, Any]:
    neg = [(iid, e) for iid, e in sorted(key["items"].items()) if e["role"] == "negative"]
    pos = [(iid, e) for iid, e in sorted(key["items"].items()) if e["role"] == "positive"]
    neg_rej = sum(1 for iid, _ in neg if answers[iid]["verdict"] == "reject")
    pos_acc = sum(1 for iid, _ in pos if answers[iid]["verdict"] == "accept")
    neg_rate = neg_rej / len(neg) if neg else None
    pos_rate = pos_acc / len(pos) if pos else None
    ok = neg_rate is not None and pos_rate is not None and neg_rate >= float(ccfg["negative_rejection_min"]) - 1e-9 and pos_rate >= float(ccfg["positive_acceptance_min"]) - 1e-9
    return {
        "negatives": len(neg),
        "negativesRejected": neg_rej,
        "positives": len(pos),
        "positivesAccepted": pos_acc,
        "negativeDetail": [{"contentHash": e["hash"], "control": e["control"], "verdict": answers[iid]["verdict"]} for iid, e in neg],
        "passed": ok,
    }


def ingest_packet(key: dict[str, Any], files: dict[str, list[Path]], cfg: dict[str, Any], model_default: str = "unknown") -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    """(verdict lines, batch records, warnings) for one packet. files: variant letter -> [first file, retry file?]."""
    lines: list[dict[str, Any]] = []
    batch_recs: list[dict[str, Any]] = []
    warnings: list[str] = []
    letters = sorted(cfg["variants"])
    for letter in letters:
        paths = files.get(letter) or []
        if not paths:
            continue
        if len(paths) > int(cfg["controls"]["max_attempts"]):
            raise IngestError(f"{key['packetId']} variant {letter}: more than {cfg['controls']['max_attempts']} attempts")
        attempts = []
        for path in paths:
            with open(path, encoding="utf-8") as f:
                doc = json.load(f)
            try:
                answers, warns = check_verdict_file(doc, key, letter, cfg)
            except IngestError as e:
                raise IngestError(f"{path.name}: {e}") from e
            warnings.extend(f"{path.name}: {w}" for w in warns)
            attempts.append((doc, answers, score_controls(key, answers, cfg["controls"])))
        doc, answers, ctl = attempts[-1]
        variant = cfg["variants"][letter]
        pass_no = letters.index(letter) + 1
        real = {iid: e for iid, e in key["items"].items() if e["role"] != "negative"}
        batch_recs.append(
            {
                "packetId": key["packetId"],
                "packetHash": key["packetHash"],
                "promptVersion": cfg["prompt_version"],
                "promptVariant": variant,
                "model": doc.get("model") or model_default,
                "attempt": len(attempts),
                "previousAttempts": [{k: v for k, v in a[2].items() if k != "negativeDetail"} for a in attempts[:-1]],
                "contentHashes": sorted(e["hash"] for e in real.values()),
                "controls": {k: v for k, v in ctl.items() if k != "passed"},
                "passed": ctl["passed"],
            }
        )
        for iid, ent in sorted(real.items()):
            a = answers[iid]
            line = {
                "contentHash": ent["hash"],
                "promptVersion": cfg["prompt_version"],
                "promptVariant": variant,
                "pass": pass_no,
                "completePhrase": a["completePhrase"],
                "conclusiveEnd": a["conclusiveEnd"],
                "accompanimentLike": a["accompanimentLike"],
                "idiomaticForWinds": a["idiomaticForWinds"],
                "levelPlausible": a["levelPlausible"],
                "verdict": a["verdict"],
                "reasons": list(a["reasons"]),
                "model": doc.get("model") or model_default,
            }
            lines.append(line)
    return lines, batch_recs, warnings


def _write_lines(path: Path, recs: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.writelines(_dumps(r) + "\n" for r in recs)


def run_review_ingest(build: Path, verdicts_path: Path = VERDICTS_JSONL, batches_path: Path = BATCHES_JSONL) -> dict[str, Any]:
    cfg = review_config()
    key_dir, out_dir = build / "review-key", build / "review"
    keys = sorted(key_dir.glob("packet-??.key.json"))
    if not keys:
        raise IngestError("no packet keys in build/review-key/. Run `review-export` first.")
    verdicts, batches = load_cache(verdicts_path, batches_path)
    vv = verdict_validator()
    report: dict[str, Any] = {"packets": {}, "warnings": []}
    for kp in keys:
        with open(kp, encoding="utf-8") as f:
            key = json.load(f)
        pid = key["packetId"]
        files = {}
        for letter in sorted(cfg["variants"]):
            fs = [out_dir / f"{pid}.verdict-{letter}.json", out_dir / f"{pid}.verdict-{letter}.retry.json"]
            files[letter] = [p for p in fs if p.exists()]
            if files[letter] and not fs[0].exists():
                raise IngestError(f"{fs[1].name} without {fs[0].name}")
        lines, brecs, warns = ingest_packet(key, files, cfg)
        report["warnings"].extend(warns)
        for line in lines:
            vv.validate(line)
            verdicts[(line["contentHash"], line["promptVersion"], line["promptVariant"])] = line
        for b in brecs:
            batches = [x for x in batches if not (x["packetHash"] == b["packetHash"] and x["promptVersion"] == b["promptVersion"] and x["promptVariant"] == b["promptVariant"])]
            batches.append(b)
        report["packets"][pid] = {b["promptVariant"]: {"passed": b["passed"], "attempt": b["attempt"], **{k: v for k, v in b["controls"].items() if k != "negativeDetail"}} for b in brecs}
    _write_lines(verdicts_path, [verdicts[k] for k in sorted(verdicts)])
    _write_lines(batches_path, sorted(batches, key=lambda b: (b["promptVersion"], b["packetId"], b["packetHash"], b["promptVariant"])))
    report["verdictLines"] = len(verdicts)
    report["batches"] = len(batches)
    return report


__all__ = [
    "IngestError",
    "apply_review",
    "build_packets",
    "check_verdict_file",
    "decisions",
    "ingest_packet",
    "is_positive",
    "load_cache",
    "review_config",
    "review_triggers",
    "run_review",
    "run_review_export",
    "run_review_ingest",
    "score_controls",
]
