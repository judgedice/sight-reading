"""`build/report.md`: counts, review outcomes and gates of one emission (03 section 6.13; PLAN ruling 24).

Deterministic (no dates, no paths): a rerun on the same inputs gives the same bytes. Not shipped."""

from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any

TARGETS = {1: 60, 2: 80, **{lv: 120 for lv in range(3, 9)}, 9: 60, 10: 60}


def table(head: list[str], rows: list[list[Any]]) -> str:
    out = ["| " + " | ".join(head) + " |", "| " + " | ".join("---" for _ in head) + " |"]
    out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(out)


def pct(n: int, d: int) -> str:
    return f"{100 * n / d:.0f}%" if d else "0%"


def review_outcomes(inp: Any, docs: list[dict[str, Any]]) -> dict[str, Any]:
    """Per level: windows that reached the review stage and what happened to them."""
    from .review import decisions

    recs = inp.all_records
    kept = {r["id"] for r in recs if r["status"] == "pass"}
    per: dict[int, Counter[str]] = defaultdict(Counter)
    for r in recs:
        lv = r["effectiveLevel"]
        if r["status"] == "pass":
            per[lv]["accepted by agent veto" if r["review"]["llm"] == "accepted" else "kept on rules (no veto needed)"] += 1
        else:
            per[lv][r["reason"]] += 1
    releveled = sum(1 for r in recs if r["status"] == "pass" and r["effectiveLevel"] != r["level"])
    verdicts, batches = inp.verdict_cache
    queued = [r for r in recs if (r["status"] == "pass" and r["review"]["llm"] == "accepted") or r.get("reason") in ("review-rejected", "review-controls-failed", "review-missing")]
    hashes = sorted({r["contentHash"] for r in queued})
    dec = decisions(hashes, inp.rcfg, verdicts, batches)
    level_not_plausible = 0
    level_not_plausible_rejected = 0
    for h, d in dec.items():
        flags = [v for v in d["verdicts"] if not v["levelPlausible"]]
        if flags:
            level_not_plausible += 1
            level_not_plausible_rejected += d["status"] == "rejected"
    status = Counter(d["status"] for d in dec.values())
    packets: dict[str, dict[str, Any]] = defaultdict(dict)
    for b in batches:
        c = b["controls"]
        packets[b["packetId"]][b["promptVariant"]] = (b["attempt"], b["passed"], f"{c['negativesRejected']}/{c['negatives']}", f"{c['positivesAccepted']}/{c['positives']}")
    return {"perLevel": per, "releveled": releveled, "levelNotPlausible": level_not_plausible, "levelNotPlausibleRejected": level_not_plausible_rejected, "status": status, "packets": packets, "kept": len(kept)}


def render(em: Any, inp: Any, via: dict[str, Any], gates: dict[str, str], determinism: str, notes: list[str]) -> str:
    docs, entries, stats, cfg = em.docs, em.entries, em.stats, inp.cfg
    levels = Counter(e["level"] for e in entries)
    served = stats["servedLevels"]
    total_bytes = sum(len(b) for b in em.files.values())
    L: list[str] = []
    L.append("# Corpus build report (C9)")
    L.append("")
    L.append(f"Corpus version `{em.index['corpusVersion']}`: {len(docs)} excerpts in {len(em.index['chunks'])} chunks, {total_bytes / 1e6:.2f} MB emitted to `public/corpus/v1/` (limit {cfg['size_limit_bytes'] / 1e6:.0f} MB). Served levels (at least {cfg['served_min']} excerpts): {', '.join('L' + str(x) for x in served) or 'none'}.")
    if em.trimmed:
        L.append(f"Trimmed by interest: {em.trimmed}. (`manifestLevelCap` is the per-level cap that keeps the manifest under its gzip budget; levels at or under it are untouched.)")
    L.append("")
    L.append("## Ruling 24 gate (CI)")
    L.append("")
    ok = via["ok"]
    L.append(f"**{'PASS' if ok else 'FAIL'}**: {via['total']} excerpts (minimum {cfg['viable_total_min']}): {'ok' if via['totalOk'] else 'FAIL'}; launch instruments x served levels with an empty selection: {via['emptyCells'] or 'none'}.")
    L.append("")
    L.append("The selection check is the Python mirror of 02 section 2.6 (level, L-1 and stretch pools, written modes, key fit, bar counts, flags, IOI and NPS tempo clipping) plus the excerpt's own tempo range, for random key and random meter. The TS selector run (C10) is the final check.")
    L.append("")
    L.append("Ruling 25: L1 holds " + str(levels.get(1, 0)) + " excerpts (fewer than " + str(cfg["served_min"]) + "), so L1 ships unserved and placement starts at L2" + ("." if 1 not in served else "; it is served.") + " L2 holds " + str(levels.get(2, 0)) + (" and is unserved." if 2 not in served else " and is served."))
    L.append("")
    L.append("## Hard gates (03 section 5.2)")
    L.append("")
    rows = [[k, v] for k, v in gates.items()]
    rows.append(["H-determinism", determinism])
    L.append(table(["Gate", "Result"], rows))
    L.append("")
    if em.problems:
        L.append("Problems:")
        L += [f"- {p}" for p in em.problems[:50]]
        L.append("")
    L.append("## Excerpts per level")
    L.append("")
    by_corpus: dict[int, Counter[str]] = defaultdict(Counter)
    minor: Counter[int] = Counter()
    fam: Counter[int] = Counter()
    aug: Counter[int] = Counter()
    for d in docs:
        by_corpus[d["level"]][d["source"]["corpus"]] += 1
        minor[d["level"]] += d["keyConcert"]["mode"] == "minor"
        fam[d["level"]] += d["familiarity"] == 2
        aug[d["level"]] += "rhythm-augmented-x2" in d["modifications"]
    rows = []
    for lv in range(1, 11):
        n = levels.get(lv, 0)
        c = by_corpus[lv]
        rows.append([f"L{lv}", n, "served" if lv in served else "unserved", TARGETS[lv], pct(n, TARGETS[lv]), c["openscore-lieder"], c["openscore-quartets"], aug[lv], pct(minor[lv], n), fam[lv]])
    rows.append(["total", len(docs), "", "", "", sum(c["openscore-lieder"] for c in by_corpus.values()), sum(c["openscore-quartets"] for c in by_corpus.values()), sum(aug.values()), pct(sum(minor.values()), len(docs)), sum(fam.values())])
    L.append(table(["Level", "Excerpts", "Status", "Target (5.1)", "Of target", "Lieder", "Quartets", "x2 variants", "Minor", "Familiar"], rows))
    L.append("")
    L.append("### Meters per level")
    L.append("")
    meters = sorted({e["meter"] for e in entries}, key=lambda m: (int(m.split("/")[1]), int(m.split("/")[0])))
    mc: dict[int, Counter[str]] = defaultdict(Counter)
    for e in entries:
        mc[e["level"]][e["meter"]] += 1
    L.append(table(["Level", *meters], [[f"L{lv}", *[mc[lv][m] or "" for m in meters]] for lv in range(1, 11)]))
    L.append("")
    L.append("## Per launch instrument")
    L.append("")
    L.append("Selectable excerpts (the 02 section 2.6 pool at the player's level, random key and meter, tempo clipping applied) for each launch instrument; `fit` is the number of excerpts at the level that fit the tier band in at least one allowed written key (`stats.fit`, all meters).")
    L.append("")
    rows = []
    for iid, per in via["instruments"].items():
        fit = stats["fit"].get(iid, {})
        row = [iid]
        for lv in range(1, 11):
            sel = per[str(lv)]["selectable"]
            f = sum(fit.get(str(lv), {}).values())
            row.append(f"{sel} ({f})")
        rows.append(row)
    L.append(table(["Instrument", *[f"L{lv}" for lv in range(1, 11)]], rows))
    L.append("")
    L.append("Cells show `selectable (fit)`. Unserved levels are listed for information only.")
    L.append("")
    ro = review_outcomes(inp, docs)
    L.append("## Review outcomes (03 section 6.12)")
    L.append("")
    L.append(f"Windows reaching the emitter: {len(inp.all_records)}; shipped {ro['kept']}. Ruling 48: the agent review ran on L1 to L3 only, so every other window that needs the veto (x2 variants, quartet inner and cello parts, one outlier flag, interest near its threshold) is excluded in v1 (`review-not-run`).")
    L.append("")
    reasons = sorted({k for c in ro["perLevel"].values() for k in c})
    L.append(table(["Level", *reasons], [[f"L{lv}", *[ro["perLevel"][lv][k] or "" for k in reasons]] for lv in range(1, 11)]))
    L.append("")
    st = ro["status"]
    L.append(f"Agent decisions over the {sum(st.values())} windows that needed the veto and reached it: accepted by both variants {st['accepted']}, rejected {st['rejected']}, controls failed {st['controls-failed']}, no verdict {st['missing']}.")
    L.append("")
    L.append(f"Releveled: {ro['releveled']} shipped excerpts carry `level` = `effectiveLevel` above the feature-based level (a half cadence is only allowed from L3, 02 H2). The agent marked {ro['levelNotPlausible']} windows `levelPlausible: false`, of which {ro['levelNotPlausibleRejected']} were rejected (a reject is the only effect; the agent never changes a level).")
    L.append("")
    L.append("### Control accuracy per packet")
    L.append("")
    rows = []
    for pid in sorted(ro["packets"]):
        for var in sorted(ro["packets"][pid]):
            a, p, n, ps = ro["packets"][pid][var]
            rows.append([pid, var, a, "pass" if p else "FAIL", n, ps])
    L.append(table(["Packet", "Variant", "Attempt", "Controls", "Negatives rejected", "Positives accepted"], rows))
    L.append("")
    L.append("Thresholds: negatives rejected at least 90% (4 of 4), positives accepted at least 75% (3 of 4).")
    L.append("")
    lg = cfg["launch_gates"]
    L.append("## Launch gates (block only the v1.0 tag)")
    L.append("")
    lo, hi = lg["level_range"]
    short = [f"L{lv} ({levels.get(lv, 0)})" for lv in range(lo, hi + 1) if levels.get(lv, 0) < lg["level_min"]]
    g2 = []
    for iid, per in via["instruments"].items():
        for lv in served:
            if per[str(lv)]["keysWith10"] < lg["g2_keys_min"]:
                g2.append(f"{iid} L{lv} ({per[str(lv)]['keysWith10']})")
    L.append(f"- Total at least {lg['total_min']}: {'met' if len(docs) >= lg['total_min'] else 'NOT met'} ({len(docs)}).")
    L.append(f"- L{lo} to L{hi} at least {lg['level_min']} each: {'met' if not short else 'NOT met: ' + ', '.join(short)}.")
    L.append(f"- G2-launch (at least 10 excerpts in at least {lg['g2_keys_min']} written keys, launch instrument x served level): {'met' if not g2 else 'NOT met: ' + ', '.join(g2)}.")
    L.append("")
    L.append("## Report-only gates")
    L.append("")
    g3 = []
    for lv in range(1, 11):
        n = levels.get(lv, 0)
        if not n:
            continue
        comp = Counter(d["source"]["composer"] for d in docs if d["level"] == lv)
        top, c = comp.most_common(1)[0]
        if c / n > 0.15 and n >= 10:
            g3.append(f"L{lv}: {top} {pct(c, n)}")
        if lv >= 3 and len({d["source"]["corpus"] for d in docs if d["level"] == lv}) < 2:
            g3.append(f"L{lv}: one source only")
    g4 = [f"L{lv}: {pct(fam[lv], levels[lv])}" for lv in range(1, 11) if levels.get(lv) and fam[lv] / levels[lv] > 0.15]
    g5 = [f"L{lv}: {pct(minor[lv], levels[lv])}" for lv in range(2, 11) if levels.get(lv) and minor[lv] / levels[lv] < 0.12]
    L.append(f"- G3 variety (no composer above 15% of a level with 10 or more excerpts, two sources per level from L3): {'met' if not g3 else 'not met: ' + '; '.join(g3)}.")
    L.append(f"- G4 familiarity (at most 15% familiar per level): {'met' if not g4 else 'not met: ' + '; '.join(g4)}.")
    L.append(f"- G5 mode (at least 12% minor per level from L2): {'met' if not g5 else 'not met: ' + '; '.join(g5)}.")
    L.append("- G1 meters: see the meter table above.")
    L.append("- R4 agent level agreement: not run (no R4 job exists in this build).")
    L.append("")
    if notes:
        L.append("## Notes")
        L.append("")
        L += [f"- {n}" for n in notes]
        L.append("")
    return "\n".join(L)
