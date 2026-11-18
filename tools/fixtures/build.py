"""P0e fixture corpus builder: scan real OpenScore sources, select 24 windows, emit runtime-format files.

Usage (run with an isolated interpreter; the sources are shallow clones outside the repo):

    python3 -I tools/fixtures/build.py scan    --lieder DIR --quartets DIR --out CANDIDATES.jsonl
    python3 -I tools/fixtures/build.py select  --candidates CANDIDATES.jsonl      # writes tools/fixtures/selection.json
    python3 -I tools/fixtures/build.py extract --lieder DIR --quartets DIR         # reads selection.json, writes fixtures/corpus/
    python3 -I tools/fixtures/build.py refresh                                     # re-derives analysis of fixtures/corpus/ in place

`scan` proposes every window that passes the fixture hard rules (03 §6.4 to §6.9, simplified) and records its
analysis. `select` greedily picks 24 windows that cover 01 §14 item 7 (clefs, pickup, ties across the barline,
triplets, meters, modes, accidentals, repeated notes, slurred run, rests) and a spread of levels, at most one window
per work. `extract` rebuilds exactly the selected windows from the sources (the selection names file, part and
measure range) and writes the ExcerptDocs as chunks plus manifest, index, attributions and withdrawn files.

No note is composed or edited: every event comes from the source MusicXML. The only changes are the ones the
excerpt format records in `modifications` (03 §6.4, H11).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import excerpt_lib as xl  # noqa: E402
import musicxml as mx  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SELECTION = os.path.join(HERE, "selection.json")
OUT_DIR = os.path.join(xl.REPO, "fixtures", "corpus")
VOICE_RE = re.compile(r"(voice|singstimme|gesang|chant|soprano|contralto|alto|tenor|baritone|bass|stimme)", re.I)
CORPUS_VERSION = "fixture-p0e-1"


# ----------------------------------------------------------------------------------------------
# Source metadata
# ----------------------------------------------------------------------------------------------


def read_composers(path: str) -> dict[str, dict]:
    """Minimal reader for OpenScore's StrictYAML composers file: path -> {name, born, died}."""
    out: dict[str, dict] = {}
    cur: dict = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            if re.match(r"^\S", line):
                if cur.get("path"):
                    out[cur["path"]] = cur
                cur = {}
                continue
            m = re.match(r"^\s+(\w+):\s*(.*)$", line)
            if m:
                cur[m.group(1)] = m.group(2).strip().strip("'\"")
    if cur.get("path"):
        out[cur["path"]] = cur
    return out


def git_sha(repo_dir: str) -> str:
    return subprocess.run(["git", "-C", repo_dir, "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()


def license_hash(repo_dir: str) -> str:
    with open(os.path.join(repo_dir, "LICENSE.txt"), "rb") as f:
        return "sha256:" + hashlib.sha256(f.read()).hexdigest()


def list_files(root: str) -> list[str]:
    out = []
    for d, _dirs, files in os.walk(os.path.join(root, "scores")):
        for f in files:
            if f.endswith(".mxl"):
                out.append(os.path.relpath(os.path.join(d, f), root))
    return sorted(out)


def nice(s: str) -> str:
    return s.replace("_", " ").strip()


CATALOG_RE = re.compile(r"((?:Op\.|D\.|WoO|BWV|Hob\.|K\.|MWV|S\.|Sz\.)\s?[\w.]+(?:\s?No\.\s?\d+)?)")


def role_of(corpus: str, part: mx.PartData, idx: int) -> str:
    if corpus == "openscore-lieder":
        return "voice"
    name = (part.name + " " + part.instrument).lower()
    if "viola" in name:
        return "viola"
    if "cello" in name or "violoncell" in name:
        return "cello"
    return "violin1" if idx == 0 else "violin2"


def candidate_parts(corpus: str, score: mx.ScoreData) -> list[tuple[int, mx.PartData, str]]:
    out = []
    for i, p in enumerate(score.parts):
        if corpus == "openscore-lieder":
            if "piano" in (p.name + p.instrument).lower():
                continue
            if VOICE_RE.search(p.name) or VOICE_RE.search(p.instrument):
                out.append((i, p, "voice"))
        else:
            if i < 4:
                out.append((i, p, role_of(corpus, p, i)))
    return out


def meta_for(corpus: str, rel: str, sha: str, composer: dict, score: mx.ScoreData, part: mx.PartData, role: str, w: xl.Window, mode: str) -> dict:
    segs = rel.split("/")  # scores/Composer/Set/Song/file.mxl or scores/Composer/Quartet/file.mxl
    file_id = os.path.splitext(segs[-1])[0]
    first = w.part.measures[w.first_mi]
    last = w.part.measures[w.first_mi + w.n_bars - 1]
    a_m = w.part.measures[w.pickup_mi] if w.pickup_mi is not None else first

    def num(m: mx.MeasureData) -> int:
        mm = re.match(r"\d+", m.number)
        return int(mm.group(0)) if mm else m.index + 1

    src: dict = {
        "composer": composer["name"],
        "composerDates": f"{composer['born']}–{composer['died']}",
        "composerDeath": int(composer["died"]),
    }
    if corpus == "openscore-lieder":
        song = nice(re.sub(r"^\d+_", "", segs[-2]))
        set_name = nice(segs[-3]) if len(segs) >= 5 else ""
        if set_name and set_name != "":
            cat = CATALOG_RE.search(set_name)
            src["work"] = set_name
            src["movement"] = song
            if cat:
                src["catalog"] = cat.group(1)
        else:
            src["work"] = song
        work_key = f"{xl.slug(composer['path'].split(',')[0])}|{file_id}"
    else:
        qname = nice(segs[-2])
        src["work"] = qname
        cat = CATALOG_RE.search(qname)
        if cat:
            src["catalog"] = cat.group(1)
        src["movement"] = f"Movement {first.movement}"
        work_key = f"{xl.slug(composer['path'].split(',')[0])}|{file_id}|mv{first.movement}"
    src["partName"] = " ".join((part.name or part.instrument or role).split())
    src["sourceMeasures"] = [num(a_m), num(last)]
    info = xl.CORPORA[corpus]
    src["encoder"] = info["encoder"]
    src["corpus"] = corpus
    src["upstreamRef"] = f"{info['repo']}@{sha[:8]}:{rel}"
    src["sourceUrl"] = info["url"]
    src["license"] = "CC0-1.0"
    src["licenseUrl"] = xl.CC0_URL
    src["originalInstrument"] = {"voice": "voice", "violin1": "violin", "violin2": "violin", "viola": "viola", "cello": "cello"}[role]
    # tempo: last tempo word and metronome mark at or before the window start, within the movement
    marking = None
    met = None
    lo = min(m.index for m in w.part.measures if m.movement == first.movement)
    start_idx = w.pickup_mi if w.pickup_mi is not None else w.first_mi
    for m in w.part.measures[lo : start_idx + 1]:
        for t in m.tempo_words:
            if xl.tempo_word(t):
                marking = t
        if m.metronome is not None:
            met = m.metronome
    meter = xl.make_meter(first.beats, first.beat_type)
    ratio = 480 / meter["countUnitTicks"]
    tempo: dict = {}
    if met is not None:
        mb = round(met * ratio)
        tempo["markedBpm"] = mb
        tempo["minBpm"], tempo["maxBpm"] = round(mb * 0.9), round(mb * 1.1)
    elif marking and xl.tempo_word(marking):
        _w, a, b = xl.tempo_word(marking)  # type: ignore[misc]
        tempo["minBpm"], tempo["maxBpm"] = round(a * ratio), round(b * ratio)
    else:
        tempo["minBpm"], tempo["maxBpm"] = round(60 * ratio), round(120 * ratio)
    if marking:
        tempo["marking"] = marking
    pick = "" if w.pickup_mi is None else "p"
    mv = "" if corpus == "openscore-lieder" else f"-mv{first.movement}"
    ex_id = f"{xl.slug(composer['path'].split(',')[0])}-{file_id}-{role}{mv}-m{pick}{src['sourceMeasures'][0]}-{src['sourceMeasures'][1]}"
    tags = ["lied" if corpus == "openscore-lieder" else "quartet", f"role:{role}", f"source-clef:{first.clefs[0]}"]
    return {"id": ex_id, "source": src, "tempo": tempo, "tags": tags, "work": work_key}


# ----------------------------------------------------------------------------------------------
# Quality filters (03 §6.9, the hard rejects a fixture needs)
# ----------------------------------------------------------------------------------------------


def quality_reject(doc: dict, role: str) -> str | None:
    f = doc["features"]
    full = [m for m in doc["measures"] if not m["isPickup"]]
    bt = xl.bar_ticks(doc["meter"])
    unit = doc["meter"]["countUnitTicks"]
    if f["restRatio"] > 0.25:
        return "rest-ratio"
    for e in xl.all_events(doc):
        if e["kind"] == "rest" and e["dur"] >= bt:
            return "bar-rest"
    first = full[0]["events"][0] if not doc["pickupTicks"] else doc["measures"][0]["events"][0]
    if first["kind"] == "rest" and first["dur"] > unit:
        return "leading-rest"
    if f["noteCount"] < 12 * len(full) / 8:
        return "fragment"
    ch = xl.chains(doc)
    mids = [c["midi"] for c in ch]
    pcs = len({m % 12 for m in mids})
    need = 3 if doc["level"] == 1 else 4 if doc["level"] == 2 else 5
    if pcs < need:
        return "pitch-variety"
    rep = sum(1 for a, b in zip(mids, mids[1:]) if a == b) / max(1, len(mids) - 1)
    if rep > 0.35:
        return "repeated-note-ratio"
    sigs = [xl.canonical([[e["kind"], e["tick"] - m["startTick"], e["dur"], e.get("pitch")] for e in m["events"]]) for m in full]
    for i in range(len(sigs) - 2):
        if sigs[i] == sigs[i + 1] == sigs[i + 2]:
            return "bar-repeated"
    # pedal alternation
    alt = sum(1 for i in range(2, len(mids)) if mids[i] == mids[i - 2] != mids[i - 1])
    if alt / len(mids) > 0.25:
        return "pedal-alternation"
    # a pedal figure lasting 8 notes or more anywhere is accompaniment, not melody
    flags = [i >= 2 and mids[i] == mids[i - 2] != mids[i - 1] for i in range(len(mids))]
    if any(sum(flags[i : i + 8]) >= 4 for i in range(max(1, len(flags) - 7))):
        return "pedal-figure"
    # broken chords and Alberti figures: a 2-, 3- or 4-interval pattern containing a leap, repeated over more
    # than half the intervals
    ivs = [b - a for a, b in zip(mids, mids[1:])]
    for k in (2, 3, 4):
        cov: set[int] = set()
        for i in range(len(ivs) - k):
            if ivs[i] == ivs[i + k] and max(abs(x) for x in ivs[i : i + k + 1]) >= 3:
                cov.update((i, i + k))
        if ivs and len(cov) / len(ivs) > 0.5:
            return "broken-chord"
    if doc["cadenceEnd"] == "HC" and doc["level"] < 3:
        return "half-cadence-below-L3"
    long_ticks = sum(c["dur"] for c in ch if c["dur"] >= bt)
    if long_ticks / (len(full) * bt) > 0.6:
        return "sustained"
    thr = 0.25 if role in ("violin2", "viola", "cello") and doc["level"] <= 2 else 0.35
    if xl.interest(doc) < thr:
        return "interest"
    if doc["level"] >= 2 and len(set(doc["rhythmCells"]) - {"pickup", "pickup1", "tieBar", "tieBeat"}) < 2:
        return "rhythm-variety"
    if doc["level"] not in [lv["level"] for lv in xl.LEVELS if len(full) in lv["bars"]]:
        return "bars-not-allowed-at-level"
    if "other" in doc["rhythmCells"]:
        return "unclassified-rhythm"
    # Detector limit (03 §6.9): the density tag is the first level whose minimum tempo keeps the peak density and
    # the shortest IOI within the caps; if even L10 fails, the window can never be served.
    if doc["featureLevels"]["density"] == 10 and not density_ok_at_l10(doc):
        return "detector-limit"
    return None


def density_ok_at_l10(doc: dict) -> bool:
    lv = xl.LEVELS[9]
    floors = xl.BUDGET["ioiFloors"]
    f = doc["features"]
    bpm = lv["tempo"]["minBpm"]
    nps = f["peakNotesPerBeat"] * bpm / 60
    cap = min(lv["npsCap"]["512"], 1000 / floors["pitchChangeMs"]["512"])
    ioi_ms = f["minIoiTicks"] / doc["meter"]["countUnitTicks"] * (60000 / bpm)
    return nps <= cap + 1e-9 and ioi_ms >= min(floors["pitchChangeMs"]["512"], floors["repeatMs"]["tonguedOrStruck"])


# Widely recognisable openings that occur in the sources (03 §6.8 familiar.yaml, agent-written; v1 uses 0 and 2).
# A match makes the excerpt practice-only. Keyed by work key and first source bar.
FAMILIAR = {("mozart|sq7353137|mv1", 0): "Mozart K.458 'Hunt' opening theme"}


# ----------------------------------------------------------------------------------------------
# Scan
# ----------------------------------------------------------------------------------------------


def scan_file(args: tuple[str, str, str, str, dict]) -> list[dict]:
    corpus, root, rel, sha, composers = args
    segs = rel.split("/")
    comp = composers.get(segs[1])
    if not comp or not comp.get("died", "").isdigit() or int(comp["died"]) >= xl.PD_CUTOFF_DEATH:
        return []
    try:
        score = mx.parse_score(os.path.join(root, rel))
    except Exception as exc:  # parse failure skips the file with a reason (03 §6.3)
        return [{"reject": f"parse:{type(exc).__name__}", "rel": rel}]
    out = []
    for pidx, part, role in candidate_parts(corpus, score):
        bounds = xl.movement_bounds(part)
        for mi in range(len(part.measures)):
            for n_bars in (8, 10, 12):
                if mi + n_bars > len(part.measures):
                    continue
                for pick_mi, pick_from in xl.start_ok(part, mi, bounds):
                    w = xl.Window(part, pick_mi, pick_from, mi, n_bars)
                    if xl.check_window(w, corpus):
                        continue
                    first = part.measures[mi]
                    if f"{first.beats}/{first.beat_type}" not in ("2/4", "3/4", "4/4", "6/8", "2/2"):
                        continue
                    mode = xl.section_mode(part, mi, score.parts)
                    if mode is None:
                        continue
                    if xl.end_info(w, mode) is None:
                        continue
                    meta = meta_for(corpus, rel, sha, comp, score, part, role, w, mode)
                    try:
                        doc = xl.build_doc(w, meta, mode)
                    except Exception as exc:
                        out.append({"reject": f"build:{type(exc).__name__}:{exc}", "rel": rel})
                        continue
                    rej = quality_reject(doc, role)
                    if rej:
                        continue
                    out.append(
                        {
                            "corpus": corpus,
                            "rel": rel,
                            "part": pidx,
                            "role": role,
                            "firstMeasureIndex": mi,
                            "bars": n_bars,
                            "pickupMeasureIndex": pick_mi,
                            "pickupFromEvent": pick_from,
                            "id": doc["id"],
                            "work": doc["work"],
                            "composer": doc["source"]["composer"],
                            "meter": xl.meter_str(doc["meter"]),
                            "mode": mode,
                            "minorForm": doc["_minorForm"],
                            "level": doc["level"],
                            "levelConfidence": doc["levelConfidence"],
                            "tags": doc["tags"],
                            "cells": doc["rhythmCells"],
                            "range": [doc["rangeConcert"]["min"], doc["rangeConcert"]["max"]],
                            "interest": doc["quality"]["interest"],
                            "cadence": doc["cadenceEnd"],
                            "mods": doc["modifications"],
                            "start": mi,
                        }
                    )
    return out


def cmd_scan(a: argparse.Namespace) -> None:
    jobs = []
    for corpus, root in (("openscore-lieder", a.lieder), ("openscore-quartets", a.quartets)):
        sha = git_sha(root)
        comps = read_composers(os.path.join(root, "data", "composers.yaml"))
        for rel in list_files(root):
            jobs.append((corpus, root, rel, sha, comps))
    n = 0
    with open(a.out, "w", encoding="utf-8") as f, ProcessPoolExecutor(max_workers=a.workers) as ex:
        for res in ex.map(scan_file, jobs, chunksize=4):
            for r in res:
                if "reject" in r:
                    continue
                f.write(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n")
                n += 1
    print(f"scan: {len(jobs)} files, {n} candidate windows -> {a.out}")


# ----------------------------------------------------------------------------------------------
# Select (greedy cover of 01 §14 item 7 plus a level spread)
# ----------------------------------------------------------------------------------------------

REQUIRED = [
    ("source-clef:treble", 3), ("source-clef:bass", 2), ("source-clef:alto", 2), ("source-clef:tenor", 1),
    ("pickup", 4), ("tie-across-barline", 3), ("triplet", 2), ("meter:2/4", 2), ("meter:3/4", 3), ("meter:4/4", 3),
    ("meter:6/8", 2), ("meter:2/2", 2), ("mode:major", 6), ("mode:minor", 4), ("accidentals", 4),
    ("repeated-notes", 2), ("slurred-run", 2), ("rests", 4), ("final-bar-completed", 1),
    ("level:1", 1), ("level:2", 2), ("level:3", 2), ("level:4", 2), ("level:5", 2), ("level:6", 2), ("level:7", 1),
    ("bars:10", 1), ("bars:12", 1), ("lied", 8), ("quartet", 8),
]


def features_of(c: dict) -> set[str]:
    s = set(c["tags"])
    s.add(f"meter:{c['meter']}")
    s.add(f"mode:{c['mode']}")
    s.add(f"level:{min(c['level'], 7)}")
    s.add(f"bars:{c['bars']}")
    if "final-bar-completed" in c["mods"]:
        s.add("final-bar-completed")
    return s


def cmd_select(a: argparse.Namespace) -> None:
    cands = [json.loads(line) for line in open(a.candidates, encoding="utf-8")]
    cands.sort(key=lambda c: (c["id"], c["bars"]))
    need = dict(REQUIRED)
    chosen: list[dict] = []
    works: set[str] = set()
    composers: dict[str, int] = {}
    while len(chosen) < 24:
        best = None
        best_score = -1.0
        for c in cands:
            if c["work"] in works or composers.get(c["composer"], 0) >= 3:
                continue
            fs = features_of(c)
            gain = sum(min(need.get(k, 0), 1) * (3 if k.startswith(("source-clef:tenor", "triplet", "meter:2/2", "meter:6/8", "level:1", "level:7")) else 1) for k in fs)
            score = gain + c["interest"] * 0.5
            if score > best_score:
                best, best_score = c, score
        if best is None:
            break
        chosen.append(best)
        works.add(best["work"])
        composers[best["composer"]] = composers.get(best["composer"], 0) + 1
        for k in features_of(best):
            if k in need:
                need[k] = max(0, need[k] - 1)
    missing = {k: v for k, v in need.items() if v > 0}
    sel = {
        "_comment": "Generated by `build.py select` from a scan of the pinned OpenScore clones; consumed by `build.py extract`.",
        "missingCoverage": missing,
        "windows": [
            {k: c[k] for k in ("id", "corpus", "rel", "part", "role", "firstMeasureIndex", "bars", "pickupMeasureIndex", "pickupFromEvent")}
            for c in sorted(chosen, key=lambda c: c["id"])
        ],
    }
    with open(SELECTION, "w", encoding="utf-8") as f:
        json.dump(sel, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")
    print(f"select: {len(chosen)} windows; unmet coverage: {missing}")
    for c in sorted(chosen, key=lambda c: c["id"]):
        print(f"  L{c['level']} {c['meter']:>4} {c['mode']:5} bars={c['bars']} {c['id']}  {sorted(features_of(c))}")


# ----------------------------------------------------------------------------------------------
# Extract and emit
# ----------------------------------------------------------------------------------------------


def write_json(path: str, obj) -> tuple[str, int]:
    text = json.dumps(obj, ensure_ascii=False, indent=1, sort_keys=True) + "\n"
    data = text.encode("utf-8")
    with open(path, "wb") as f:
        f.write(data)
    return "sha256:" + hashlib.sha256(data).hexdigest(), len(data)


def hashed_name(stem: str, obj) -> tuple[str, bytes]:
    data = (json.dumps(obj, ensure_ascii=False, indent=1, sort_keys=True) + "\n").encode("utf-8")
    return f"{stem}.{hashlib.sha256(data).hexdigest()[:10]}.json", data


MANIFEST_COLUMNS = [
    "id", "shard", "level", "meter", "fifths", "mode", "modal", "bars", "pickup", "rangeConcert", "minBpm", "maxBpm",
    "minIoiTicks", "minRepeatIoiTicks", "composer", "title", "work", "tags", "originalFamily", "cadenceEnd",
    "familiarity", "featureLevels", "flags", "dedupeGroup", "corpus", "license", "peakNotesPerBeat", "spelling",
]
FAMILY = {"voice": "voice", "violin": "upper-strings", "viola": "upper-strings", "cello": "low-strings"}


def manifest_entry(doc: dict, shard: str) -> dict:
    src = doc["source"]
    e = {
        "id": doc["id"],
        "shard": shard,
        "level": doc["level"],
        "meter": xl.meter_str(doc["meter"]),
        "fifths": doc["keyConcert"]["fifths"],
        "mode": doc["keyConcert"]["mode"],
        "modal": doc["modal"],
        "bars": sum(1 for m in doc["measures"] if not m["isPickup"]),
        "pickup": doc["pickupTicks"] > 0,
        "rangeConcert": [doc["rangeConcert"]["min"], doc["rangeConcert"]["max"]],
        "minBpm": doc["tempo"]["minBpm"],
        "maxBpm": doc["tempo"]["maxBpm"],
        "minIoiTicks": doc["features"]["minIoiTicks"],
        "minRepeatIoiTicks": doc["features"]["minRepeatIoiTicks"],
        "composer": src["composer"],
        "title": src.get("movement") or src["work"],
        "work": doc["work"],
        "tags": doc["tags"],
        "originalFamily": FAMILY[src["originalInstrument"]],
        "cadenceEnd": doc["cadenceEnd"],
        "familiarity": doc["familiarity"],
        "featureLevels": doc["featureLevels"],
        "flags": doc["flags"],
        "dedupeGroup": doc["dedupeGroup"],
        "corpus": src["corpus"],
        "license": src["license"],
        "peakNotesPerBeat": doc["features"]["peakNotesPerBeat"],
        "spelling": spelling_counts(doc),
    }
    return e


def spelling_counts(doc: dict) -> dict[str, int]:
    """ManifestEntry.spelling (PLAN ruling 44): note events per concert spelled pitch class, keyed letter + alter.

    Every note event counts, tie continuations included, exactly as the runtime spelling rule (03 §7.5 rule 3,
    src/corpus/transpose/spell.ts) counts double accidentals, so the rule is decided from the manifest alone.
    """
    out: dict[str, int] = {}
    for e in xl.all_events(doc):
        if e["kind"] == "note":
            k = f'{e["pitch"]["step"]}{e["pitch"]["alter"]}'
            out[k] = out.get(k, 0) + 1
    return dict(sorted(out.items()))


def fits(rng: tuple[int, int], fifths: int, mode: str, inst: dict, level: int) -> bool:
    """03 §7.3 closed form: some written key allowed at the level fits the tier band."""
    lv = xl.LEVELS[level - 1]
    tier = lv["tier"]
    b_min, b_max = inst["tiers"][tier]
    c_i = inst["writtenMinusSounding"]["chromatic"]
    d_i = inst["writtenMinusSounding"]["diatonic"]
    t_min = b_min - c_i - rng[0]
    t_max = b_max - c_i - rng[1]
    if t_min > t_max:
        return False
    if mode not in lv["writtenKeys"]["modes"]:
        return False
    f_i = interval_fifths(d_i, c_i)
    ks = xl.tonic_pc(fifths, mode)
    k = lv["writtenKeys"]["maxAccidentals"]
    for fw in range(-k, k + 1):
        fc = fw - f_i
        if abs(fc) > 7:
            continue
        p = (xl.tonic_pc(fc, mode) - ks) % 12
        # some t = p + 12k in [t_min, t_max]
        lo_k = -((p - t_min) // 12)
        if p + 12 * lo_k <= t_max:
            return True
    return False


def interval_fifths(d: int, c: int) -> int:
    """Number of perfect fifths f with 7f ≡ c (mod 12) and 4f ≡ d (mod 7), in -6..6 preferring the small one."""
    for f in sorted(range(-12, 13), key=lambda x: (abs(x), x)):
        if (7 * f - c) % 12 == 0 and (4 * f - d) % 7 == 0:
            return f
    raise ValueError((d, c))


def cmd_extract(a: argparse.Namespace) -> None:
    sel = json.load(open(SELECTION, encoding="utf-8"))
    roots = {"openscore-lieder": a.lieder, "openscore-quartets": a.quartets}
    shas = {k: git_sha(v) for k, v in roots.items()}
    comps = {k: read_composers(os.path.join(v, "data", "composers.yaml")) for k, v in roots.items()}
    docs = []
    for s in sel["windows"]:
        root = roots[s["corpus"]]
        score = mx.parse_score(os.path.join(root, s["rel"]))
        part = score.parts[s["part"]]
        w = xl.Window(part, s["pickupMeasureIndex"], s["pickupFromEvent"], s["firstMeasureIndex"], s["bars"])
        reason = xl.check_window(w, s["corpus"])
        assert reason is None, (s["id"], reason)
        first = part.measures[w.first_mi]
        mode = xl.section_mode(part, w.first_mi, score.parts)
        assert mode is not None
        meta = meta_for(s["corpus"], s["rel"], shas[s["corpus"]], comps[s["corpus"]][s["rel"].split("/")[1]], score, part, s["role"], w, mode)
        doc = xl.build_doc(w, meta, mode)
        assert doc["id"] == s["id"], (doc["id"], s["id"])
        rej = quality_reject(doc, s["role"])
        assert rej is None, (s["id"], rej)
        doc.pop("_minorForm")
        if (doc["work"], doc["source"]["sourceMeasures"][0]) in FAMILIAR:
            doc["familiarity"] = 2
        doc = xl.normalize_numbers(doc)
        doc["contentHash"] = xl.content_hash(doc)
        docs.append(doc)
    prov = [
        {"corpus": c, "repo": xl.CORPORA[c]["repo"], "commit": shas[c], "licenseSha256": license_hash(roots[c])}
        for c in sorted(shas)
    ]
    emit(docs, prov)


COVERAGE_TAGS = {"pickup", "tie-across-barline", "triplet", "rests", "accidentals", "repeated-notes", "slurred-run"}


def cmd_refresh(_a: argparse.Namespace) -> None:
    """Re-derive the analysis fields of the committed fixture docs and re-emit, without the source clones.

    The notes, ids, source fields and review are kept byte for byte; features, rhythm cells, levels, flags, coverage
    tags, interest and the content hash are recomputed by excerpt_lib (for example after PLAN ruling 46 changed how
    rhythm cells are read in 2/2 and 3/8). The provenance in sources.lock.json is kept.
    """
    index = json.load(open(os.path.join(OUT_DIR, "index.json"), encoding="utf-8"))
    docs = []
    for c in index["chunks"]:
        docs.extend(json.load(open(os.path.join(OUT_DIR, c["file"]), encoding="utf-8"))["excerpts"])
    prov = json.load(open(os.path.join(OUT_DIR, "sources.lock.json"), encoding="utf-8"))["sources"]
    out = []
    for doc in docs:
        doc = dict(doc)
        analysis = xl.analyse(doc)
        analysis.pop("_minorForm")
        doc.update(analysis)
        doc["cadenceEnd"] = xl.cadence_label(doc)
        doc["flags"] = xl.flags_for(doc)
        doc["tags"] = sorted((set(doc["tags"]) - COVERAGE_TAGS) | set(xl.coverage_tags(doc)))
        doc["quality"] = {**doc.get("quality", {}), "interest": round(xl.interest(doc), 4)}
        doc = xl.normalize_numbers(doc)
        doc["contentHash"] = xl.content_hash(doc)
        out.append(doc)
    emit(out, prov)


def emit(docs: list[dict], prov_sources: list[dict]) -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    for f in os.listdir(OUT_DIR):
        if f.endswith(".json"):
            os.remove(os.path.join(OUT_DIR, f))
    docs.sort(key=lambda d: (d["level"], d["id"]))
    by_level: dict[int, list[dict]] = {}
    for d in docs:
        by_level.setdefault(d["level"], []).append(d)
    chunks = []
    entries = []
    for level in sorted(by_level):
        group = sorted(by_level[level], key=lambda d: d["id"])
        for n in range(0, len(group), 64):
            shard = f"shard-L{level:02d}-{n // 64 + 1:02d}"
            body = {"schemaVersion": 1, "shard": shard, "excerpts": group[n : n + 64]}
            name, data = hashed_name(shard, body)
            with open(os.path.join(OUT_DIR, name), "wb") as f:
                f.write(data)
            chunks.append({"shard": shard, "file": name, "hash": "sha256:" + hashlib.sha256(data).hexdigest(), "bytes": len(data)})
            for d in group[n : n + 64]:
                entries.append(manifest_entry(d, shard))
    entries.sort(key=lambda e: e["id"])
    insts = xl.load_json("config/instruments.json")["instruments"]
    fit: dict = {}
    for inst in insts:
        per: dict = {}
        for e in entries:
            if fits((e["rangeConcert"][0], e["rangeConcert"][1]), e["fifths"], e["mode"], inst, e["level"]):
                per.setdefault(str(e["level"]), {}).setdefault(e["meter"], 0)
                per[str(e["level"])][e["meter"]] += 1
        fit[inst["id"]] = per
    counts: dict[int, int] = {}
    for e in entries:
        counts[e["level"]] = counts.get(e["level"], 0) + 1
    stats = {"servedLevels": sorted(lv for lv, n in counts.items() if n >= 30), "fit": fit}
    dict_cols = ["composer", "title", "work", "tags"]
    dicts: dict[str, list[str]] = {c: [] for c in dict_cols}
    for c in ("composer", "title", "work"):
        dicts[c] = sorted({e[c] for e in entries})
    dicts["tags"] = sorted({t for e in entries for t in e["tags"]})
    rows = []
    for e in entries:
        row = []
        for col in MANIFEST_COLUMNS:
            v = e.get(col)
            if col in ("composer", "title", "work"):
                v = dicts[col].index(v)
            elif col == "tags":
                v = [dicts["tags"].index(t) for t in v]
            row.append(v)
        rows.append(row)
    manifest = {"schemaVersion": 1, "corpusVersion": CORPUS_VERSION, "columns": MANIFEST_COLUMNS, "rows": rows, "dict": dicts, "stats": stats}
    mname, mdata = hashed_name("manifest", manifest)
    with open(os.path.join(OUT_DIR, mname), "wb") as f:
        f.write(mdata)
    attributions = {
        "schemaVersion": 1,
        "collections": [
            {"corpus": c, "name": xl.CORPORA[c]["name"], "url": xl.CORPORA[c]["url"], "licenses": ["CC0-1.0"]}
            for c in sorted({d["source"]["corpus"] for d in docs})
        ],
        "items": [],
    }
    aname, adata = hashed_name("attributions", attributions)
    with open(os.path.join(OUT_DIR, aname), "wb") as f:
        f.write(adata)
    index = {
        "schemaVersion": 1,
        "corpusVersion": CORPUS_VERSION,
        "manifest": {"file": mname, "hash": "sha256:" + hashlib.sha256(mdata).hexdigest(), "bytes": len(mdata)},
        "attributions": {"file": aname, "hash": "sha256:" + hashlib.sha256(adata).hexdigest(), "bytes": len(adata)},
        "chunks": chunks,
    }
    write_json(os.path.join(OUT_DIR, "index.json"), index)
    write_json(os.path.join(OUT_DIR, "withdrawn.json"), {"schemaVersion": 1, "ids": []})
    # Decoded manifest entries: the golden P9a's column decoder must reproduce.
    write_json(os.path.join(OUT_DIR, "manifest-entries.json"), entries)
    # Provenance of the source clones the fixtures were cut from.
    prov = {
        "_comment": "Source clones used by `build.py extract`. Both repositories are CC0 1.0 (03 §6.2).",
        "sources": prov_sources,
    }
    write_json(os.path.join(OUT_DIR, "sources.lock.json"), prov)
    print(f"extract: {len(docs)} excerpts, {len(chunks)} chunks -> {OUT_DIR}")


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("scan")
    s.add_argument("--lieder", required=True)
    s.add_argument("--quartets", required=True)
    s.add_argument("--out", required=True)
    s.add_argument("--workers", type=int, default=4)
    s2 = sub.add_parser("select")
    s2.add_argument("--candidates", required=True)
    s3 = sub.add_parser("extract")
    s3.add_argument("--lieder", required=True)
    s3.add_argument("--quartets", required=True)
    sub.add_parser("refresh")
    a = ap.parse_args()
    {"scan": cmd_scan, "select": cmd_select, "extract": cmd_extract, "refresh": cmd_refresh}[a.cmd](a)


if __name__ == "__main__":
    main()
