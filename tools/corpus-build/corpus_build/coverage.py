"""Coverage after the quality filters and dedupe (job C7 report; the gates themselves are C9/C10's, 03 5.2).

For every instrument x level it counts the surviving windows that the runtime could serve, mirroring
src/corpus/select (02 2.6, 03 7.2 to 7.5) as far as the window records allow:
- `atLevel`: windows whose served level (`effectiveLevel`) is L and whose range fits the tier band of L, through a whole
  excerpt transposition into at least one written key allowed at L (03 7.3 closed form; modal windows: any shift, since
  they are served only under a random key);
- `selectable`: the 02 2.6 pool (level L, L-1, and stretch windows at L+1 with exactly one feature at L+1) after the
  level's bar counts, written modes, the flag exclusions (noBreath for winds, brass and voice; leapy for winds and brass
  at L1 to L6; bass-line only for instruments whose primary clef is bass, at L1 to L5), the range fit and a tempo check
  (the level's tempo range clipped by the instrument's IOI floors and the NPS cap at its window class). The excerpt's own
  marking-derived tempo range is not known before emit (C9), so it is not applied;
- `rankedSelectable`: as `selectable`, familiarity 0 only;
- `keysWith10`: written keys allowed at L in which at least 10 level-L windows fit (G2-launch needs 3).
Under ruling 29 every L1 to L3 item, every x2 variant and every quartet inner or cello window needs the agent veto before
it ships; `noReview*` counts what ships on the rules alone.
"""

from __future__ import annotations

import json
from collections import Counter
from typing import Any

from .features import REPO, budget_config, levels_config
from .histogram import fits, instruments, key_name
from .phrase import tonic_pc

SERVED_MIN = 30
VIABLE_TOTAL_MIN = 300
WIND_FAMILIES = {"flute", "double-reed", "clarinet", "sax"}
BRASS_FAMILIES = {"high-brass", "low-brass"}


def _levels_json() -> dict[str, Any]:
    with open(REPO / "config" / "levels.json", encoding="utf-8") as f:
        return json.load(f)


def needs_review(r: dict[str, Any]) -> bool:
    """03 6.12 R2 items this stage can see: L1 to L3, x2 variants, quartet inner and cello windows, interest within the
    near-threshold margin. (Single-metric outliers are C8's.)"""
    margin = (r.get("quality") or {}).get("interestMargin")
    from .quality import filters_config

    near = filters_config()["interest"]["near_threshold_margin"]
    return (
        r["effectiveLevel"] <= 3
        or r["id"].endswith("-aug2")
        or (r["corpus"] == "openscore-quartets" and r.get("role") in ("inner", "cello"))
        or (margin is not None and margin < near - 1e-9)
    )


def pool_of(r: dict[str, Any], level: int) -> str | None:
    lv = r["effectiveLevel"]
    if lv == level:
        return "level"
    if lv == level - 1:
        return "below"
    if lv == level + 1 and r.get("minLevelCadence", 1) <= level:
        fl = r["featureLevels"].values()
        if all(v <= level + 1 for v in fl) and sum(1 for v in fl if v == level + 1) == 1:
            return "stretch"
    return None


def flag_allowed(r: dict[str, Any], ins: dict[str, Any], level: int) -> bool:
    fam = ins["family"]
    wb = fam in WIND_FAMILIES or fam in BRASS_FAMILIES
    for f in r.get("flags") or []:
        if f == "noBreath" and (wb or fam == "voice"):
            return False
        if f == "leapy" and wb and level <= 6:
            return False
        if f == "bass-line" and (ins["clefs"][0]["clef"] != "bass" or level > 5):
            return False
    return True


def tempo_ok(r: dict[str, Any], ins: dict[str, Any], lvdef: dict[str, Any], lj: dict[str, Any]) -> bool:
    beats, bt = (int(x) for x in r["meter"].split("/"))
    unit = 480 * 4 // bt
    compound = bt == 8 and beats >= 6 and beats % 3 == 0
    if compound:
        unit *= 3
    lo, hi = lvdef["tempo"]["minBpm"], lvdef["tempo"]["maxBpm"]
    a, b = lj["compound"]["dottedBeatLevels"]
    if compound and a <= lvdef["level"] <= b:
        lo, hi = lj["compound"]["dottedBpm"]["minBpm"], lj["compound"]["dottedBpm"]["maxBpm"]
    floors = budget_config()["ioiFloors"]
    wc = str(ins["detection"]["windowSamples"])
    f = r["features"]
    mx = float("inf")
    if f.get("minIoiTicks"):
        mx = min(mx, 60000 * f["minIoiTicks"] / (unit * floors["pitchChangeMs"][wc]))
    if f.get("minRepeatIoiTicks"):
        soft = ins["detection"]["onsetProfile"] in ("voice", "bowed")
        rep = floors["repeatMs"]["voiceOrBowed" if soft else "tonguedOrStruck"]
        mx = min(mx, 60000 * f["minRepeatIoiTicks"] / (unit * rep))
    if f.get("peakNotesPerBeat"):
        cap = min(lvdef["npsCap"][wc], 1000 / floors["pitchChangeMs"][wc])
        mx = min(mx, cap * 60 / f["peakNotesPerBeat"])
    return lo <= min(hi, mx) + 1e-9


def fitting_keys(r: dict[str, Any], ins: dict[str, Any], lvdef: dict[str, Any]) -> list[str]:
    band = tuple(ins["tiers"][lvdef["tier"]])
    chrom = ins["writtenMinusSounding"]["chromatic"]
    lo, hi = r["rangeConcert"]["min"], r["rangeConcert"]["max"]
    if r.get("modal") or r["mode"] not in ("major", "minor"):
        if r["mode"] not in lvdef["modal"]:
            return []
        return ["random"] if band[0] - chrom - lo <= band[1] - chrom - hi else []
    wk = lvdef["writtenKeys"]
    if r["mode"] not in wk["modes"]:
        return []
    out = []
    for f in range(-wk["maxAccidentals"], wk["maxAccidentals"] + 1):
        target = (tonic_pc(f, r["mode"]) - chrom) % 12
        if fits(lo, hi, band, chrom, tonic_pc(r["fifths"], r["mode"]), target):
            out.append(key_name(f, r["mode"]))
    return out


def coverage(kept: list[dict[str, Any]]) -> dict[str, Any]:
    lvs = {lv["level"]: lv for lv in levels_config()}
    lj = _levels_json()
    by_level = Counter(r["effectiveLevel"] for r in kept)
    served = [lv for lv in range(1, 11) if by_level.get(lv, 0) >= SERVED_MIN]
    no_review = [r for r in kept if not needs_review(r)]
    nr_by_level = Counter(r["effectiveLevel"] for r in no_review)
    nr_served = [lv for lv in range(1, 11) if nr_by_level.get(lv, 0) >= SERVED_MIN]
    table: dict[str, Any] = {}
    for ins in instruments():
        per: dict[str, Any] = {}
        for L in range(1, 11):
            d = lvs[L]
            at_level = 0
            key_counts: Counter[str] = Counter()
            sel = ranked = sel_nr = 0
            for r in kept:
                p = pool_of(r, L)
                if p is None:
                    continue
                keys = fitting_keys(r, ins, d)
                if p == "level" and keys:
                    at_level += 1
                    key_counts.update(keys)
                if not keys or r["bars"] not in d["bars"] or not flag_allowed(r, ins, L) or not tempo_ok(r, ins, d, lj):
                    continue
                sel += 1
                if r.get("familiarity", 0) < 2:
                    ranked += 1
                if not needs_review(r):
                    sel_nr += 1
            per[str(L)] = {
                "atLevel": at_level,
                "selectable": sel,
                "rankedSelectable": ranked,
                "noReviewSelectable": sel_nr,
                "keysWith10": sum(1 for k, v in key_counts.items() if v >= 10 and k != "random"),
            }
        table[ins["id"]] = {"status": ins["status"], "levels": per}
    launch = [i["id"] for i in instruments() if i["status"] == "launch"]

    def viable(served_levels: list[int], field: str, total: int) -> dict[str, Any]:
        empty = [f"{iid} L{L}" for iid in launch for L in served_levels if table[iid]["levels"][str(L)][field] == 0]
        return {"total": total, "totalOk": total >= VIABLE_TOTAL_MIN, "servedLevels": served_levels, "emptyCells": empty, "ok": total >= VIABLE_TOTAL_MIN and not empty}

    return {
        "_note": "Surviving windows after the C7 filters and dedupe; see corpus_build/coverage.py for what is and is not applied.",
        "kept": len(kept),
        "byLevel": {str(lv): by_level.get(lv, 0) for lv in range(1, 11)},
        "servedLevels": served,
        "noReviewKept": len(no_review),
        "noReviewByLevel": {str(lv): nr_by_level.get(lv, 0) for lv in range(1, 11)},
        "noReviewServedLevels": nr_served,
        "familiar": sum(1 for r in kept if r.get("familiarity") == 2),
        "byLevelAndCorpus": {str(lv): dict(sorted(Counter(r["corpus"] for r in kept if r["effectiveLevel"] == lv).items())) for lv in range(1, 11)},
        "instruments": table,
        "viabilityBeforeReview": viable(served, "selectable", len(kept)),
        "viabilityWithoutReview": viable(nr_served, "noReviewSelectable", len(no_review)),
    }
