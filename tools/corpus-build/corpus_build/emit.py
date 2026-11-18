"""Job C9: the emitter (03 section 6.13 and 5.2; PLAN rulings 24, 25, 26, 44).

Reads the reviewed windows (build/review/candidates.jsonl, written by `review` from the committed verdict cache) and
turns every survivor into an `ExcerptDoc`, then writes `public/corpus/v1/`:

- `shard-L<level>-<n>.<hash>.json`   at most 64 excerpts per chunk, ordered by id within the level
- `manifest.<hash>.json`             column oriented, dictionary encoded, with `stats` (servedLevels, fit)
- `attributions.<hash>.json`         per collection credits and one TASL record per CC BY excerpt
- `index.json` (no-cache)            corpus version, the manifest and attributions refs and every chunk
- `withdrawn.json` (no-cache)        ids removed after a takedown
- `LICENSES/` in the repo root       CC0 1.0 and CC BY 4.0 texts and the corpus' own CC0 statement
- `build/report.md`                  counts, review outcomes, gates (not shipped)

`build_corpus` is a pure function of the build directory, the committed verdict cache and the repo config: it returns
the bytes of every file and writes nothing, so determinism (H-determinism) is a comparison of two calls. Event ids are
`e<n>` from 1 over every event (notes and rests) in window order, the scheme C6 used for `extremes`. `level` is the
window's `effectiveLevel` (a half cadence is only allowed from L3, 02 H2).
"""

from __future__ import annotations

import gzip
import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import jsonschema

from .candidate import read_jsonl
from .coverage import fitting_keys, flag_allowed, needs_review, pool_of, tempo_ok, _levels_json
from .emit_checks import check_documents
from .emit_report import render
from .features import levels_config
from .gate import load_denylist
from .histogram import instruments
from .paths import LICENSES_DIR, PUBLIC_CORPUS, REPO_ROOT, SHIPPED_SCHEMA_DIR, CONFIG_DIR, TOOL_DIR
from .review import BATCHES_JSONL, VERDICTS_JSONL, load_cache, review_config
from .sources import load_sources
from .window_stage import load_window
from .yamlio import load_yaml

MANIFEST_COLUMNS = [
    "id", "shard", "level", "meter", "fifths", "mode", "modal", "bars", "pickup", "rangeConcert", "minBpm", "maxBpm",
    "minIoiTicks", "minRepeatIoiTicks", "composer", "title", "work", "tags", "originalFamily", "cadenceEnd",
    "familiarity", "featureLevels", "flags", "dedupeGroup", "corpus", "license", "peakNotesPerBeat", "spelling",
]
DICT_COLUMNS = ("composer", "title", "work", "tags")
ARTICULATIONS = {"staccato", "tenuto", "accent", "marcato"}
DYNAMICS = {"pp", "p", "mp", "mf", "f", "ff", "fp", "sfz"}
CATALOG_RE = re.compile(r"((?:Op\.|D\.|WoO|BWV|Hob\.|K\.|MWV|S\.|Sz\.)\s?[\w.]+(?:\s?No\.\s?\d+)?)")
ORIGINAL_INSTRUMENT = {"voice": "voice", "Vn I": "violin", "Vn II": "violin", "Va": "viola", "Vc": "cello"}
FAMILY = {"voice": "voice", "violin": "upper-strings", "viola": "upper-strings", "cello": "low-strings"}
CORPUS_TAG = {"openscore-lieder": "lied", "openscore-quartets": "quartet"}
ENCODER = {"openscore-lieder": "OpenScore Lieder contributors", "openscore-quartets": "OpenScore String Quartets contributors"}
MINOR_MODALS = {"dorian", "phrygian", "aeolian", "locrian"}
CC0_URL = "https://creativecommons.org/publicdomain/zero/1.0/"


class EmitError(RuntimeError):
    pass


def emit_config() -> dict[str, Any]:
    return load_yaml(CONFIG_DIR / "emit.yaml")


# ---------------------------------------------------------------------------------------------------- serialization


def dumps(obj: Any, pretty: bool) -> bytes:
    """Byte-stable JSON: sorted keys, UTF-8, trailing newline. Chunks and the manifest are compact (size budget)."""
    if pretty:
        text = json.dumps(obj, ensure_ascii=False, indent=1, sort_keys=True)
    else:
        text = json.dumps(obj, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return (text + "\n").encode("utf-8")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def hashed_name(stem: str, data: bytes, n: int) -> str:
    return f"{stem}.{sha256(data)[:n]}.json"


def gz_size(data: bytes) -> int:
    return len(gzip.compress(data, 9, mtime=0))


# ---------------------------------------------------------------------------------------------------- tempo


def tempo_word(text: str, words: dict[str, list[int]]) -> tuple[str, int, int] | None:
    low = text.lower()
    best: tuple[int, int, str] | None = None
    for w in words:
        i = low.find(w)
        if i >= 0 and (best is None or i < best[0] or (i == best[0] and len(w) > len(best[2]))):
            best = (i, 0, w)
    if best is None:
        return None
    lo, hi = words[best[2]]
    return best[2], lo, hi


def tempo_of(rec: dict[str, Any], meter: dict[str, Any], tcfg: dict[str, Any]) -> dict[str, Any]:
    """Source tempo range in bpm of the metronome beat (`tempo.minBpm`/`maxBpm`). A printed mark gives mark +/- 10%,
    else a tempo word gives its table range, else the default range. The tables are in quarter-note bpm and are scaled
    to the count unit (6/8: dotted quarter)."""
    ratio = 480 / meter["countUnitTicks"]
    t = rec.get("tempoAtStart") or {}
    marking = (t.get("text") or "").strip() or None
    out: dict[str, Any] = {}
    word = tempo_word(marking, tcfg["words"]) if marking else None
    if t.get("bpm"):
        mb = round(t["bpm"] * ratio)
        sp = tcfg["marked_spread"]
        out["markedBpm"] = mb
        out["minBpm"], out["maxBpm"] = round(mb * (1 - sp)), round(mb * (1 + sp))
    elif word:
        out["minBpm"], out["maxBpm"] = round(word[1] * ratio), round(word[2] * ratio)
    else:
        lo, hi = tcfg["default_quarter_bpm"]
        out["minBpm"], out["maxBpm"] = round(lo * ratio), round(hi * ratio)
    if marking:
        out["marking"] = marking
    return out


# ---------------------------------------------------------------------------------------------------- source fields


def slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def nice(s: str) -> str:
    return s.replace("_", " ").strip()


def measure_number(s: Any) -> int:
    m = re.match(r"\d+", str(s))
    return int(m.group(0)) if m else 0


def source_names(corpus: str, path: str, movement: int) -> dict[str, str]:
    """work, movement and catalog from the repository path (scores/Composer/Set/Song/file.mxl, quartets without Set)."""
    segs = path.split("/")
    out: dict[str, str] = {}
    if corpus == "openscore-lieder":
        song = nice(re.sub(r"^\d+_", "", segs[-2]))
        set_name = nice(segs[-3]) if len(segs) >= 5 else ""
        if set_name and set_name != "_":
            out["work"] = set_name
            out["movement"] = song
            m = CATALOG_RE.search(set_name)
            if m:
                out["catalog"] = m.group(1)
        else:
            out["work"] = song
    else:
        q = nice(segs[-2])
        out["work"] = q
        m = CATALOG_RE.search(q)
        if m:
            out["catalog"] = m.group(1)
        out["movement"] = f"Movement {movement}"
    return out


@dataclass
class Inputs:
    """Everything the emitter reads, loaded once."""

    build: Path
    records: list[dict[str, Any]]
    all_records: list[dict[str, Any]]
    gate: dict[str, dict[str, Any]]
    parts: dict[str, dict[str, Any]]
    sources: dict[str, Any]
    verdict_cache: tuple[dict[tuple[str, str, str], dict[str, Any]], list[dict[str, Any]]]
    rcfg: dict[str, Any]
    cfg: dict[str, Any]
    sha_by_source: dict[str, str] = field(default_factory=dict)


def load_inputs(build: Path, verdicts_path: Path = VERDICTS_JSONL, batches_path: Path = BATCHES_JSONL) -> Inputs:
    rpath = build / "review" / "candidates.jsonl"
    if not rpath.exists():
        raise EmitError(f"{rpath} is missing. Run `review` first.")
    all_records = read_jsonl(rpath)
    kept = sorted((r for r in all_records if r["status"] == "pass"), key=lambda r: r["id"])
    gate = {r["id"]: r for r in read_jsonl(build / "gate" / "candidates.jsonl") if r["kind"] == "file" and r["status"] == "pass"}
    parts = {r["id"]: r for r in read_jsonl(build / "extract" / "candidates.jsonl") if r["kind"] == "part" and r["status"] == "pass"}
    srcs = {s.id: s for s in load_sources()}
    return Inputs(build, kept, all_records, gate, parts, srcs, load_cache(verdicts_path, batches_path), review_config(), emit_config())


# ---------------------------------------------------------------------------------------------------- documents


def slur_mark(depth: int, starts: int, stops: int) -> tuple[str | None, int]:
    """The flat `slur` mark of a note whose source carries `starts` and `stops` slur counts, given the open depth.

    ExcerptDoc has one mark per note, not a count, so nested and overlapping source slurs are flattened to their outer
    span: 'start' when the first slur opens, 'stop' when the last one closes, 'continue' when the last one closes and a
    new one opens on the same note (an adjoining pair), and no mark in between. The marks always balance."""
    mid = max(depth - stops, 0)
    after = mid + starts
    if depth == 0 and starts:
        return "start", after
    if depth > 0 and mid == 0:
        return ("continue" if starts else "stop"), after
    return None, after


def make_events(measures: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Window measures to `Measure[]` with ids e1.. in window order (the C6 numbering)."""
    out: list[dict[str, Any]] = []
    n = 0
    tup = 0
    in_tuplet = False
    slur_depth = 0
    for m in measures:
        events: list[dict[str, Any]] = []
        for e in m["events"]:
            n += 1
            d: dict[str, Any] = {"id": f"e{n}", "kind": e["kind"], "tick": e["tick"], "dur": e["dur"]}
            if e.get("tuplet"):
                if e.get("tupletStart") or not in_tuplet:
                    tup += 1
                in_tuplet = True
                d["tuplet"] = {"actual": e["tuplet"][0], "normal": e["tuplet"][1], "groupId": f"t{tup}"}
                if e.get("tupletStop"):
                    in_tuplet = False
            else:
                in_tuplet = False
            if e["kind"] == "note":
                d["pitch"] = {"step": e["step"], "alter": e["alter"], "octave": e["octave"]}
                if e.get("tieStart"):
                    d["tieStart"] = True
                if e.get("tieStop"):
                    d["tieStop"] = True
                mark, slur_depth = slur_mark(slur_depth, int(e.get("slurStarts") or 0), int(e.get("slurStops") or 0))
                if mark:
                    d["slur"] = mark
                art = [a for a in e.get("artic") or [] if a in ARTICULATIONS]
                if art:
                    d["artic"] = art
                if e.get("dynamic") in DYNAMICS:
                    d["dynamic"] = e["dynamic"]
                if e.get("hairpin"):
                    d["hairpin"] = e["hairpin"]
                if e.get("breath"):
                    d["breath"] = True
            events.append(d)
        out.append({"index": m["index"], "isPickup": bool(m["isPickup"]), "startTick": m["startTick"], "events": events})
    return out


def excerpt_ids(records: list[dict[str, Any]], gate: dict[str, dict[str, Any]]) -> dict[str, str]:
    """Stable, readable ids: <composer>-<score file>-<role>[-mv<n>]-m[p]<first>-<last>[-aug2]. A collision gets -2, -3
    in pipeline-id order."""
    base: dict[str, str] = {}
    for r in records:
        g = gate[r["fileId"]]
        composer = slug(g["path"].split("/")[1].split(",")[0])
        stem = Path(g["path"]).stem
        role = slug(r.get("roleLabel") or r.get("role") or "part")
        first, last = r["sourceMeasures"]
        pick = "p" if r.get("pickupTicks") else ""
        mv = f"-mv{r['movement']}" if r["corpus"] == "openscore-quartets" else (f"-mv{r['movement']}" if r["movement"] != 1 else "")
        i = f"{composer}-{stem}-{role}{mv}-m{pick}{slug(str(first))}-{slug(str(last))}"
        if r["id"].endswith("-aug2"):
            i += "-aug2"
        base[r["id"]] = i
    seen: Counter[str] = Counter()
    out: dict[str, str] = {}
    for r in sorted(records, key=lambda r: r["id"]):
        b = base[r["id"]]
        seen[b] += 1
        out[r["id"]] = b if seen[b] == 1 else f"{b}-{seen[b]}"
    return out


def make_doc(rec: dict[str, Any], doc_id: str, inp: Inputs) -> dict[str, Any]:
    w = load_window(inp.build, rec)
    g = inp.gate[rec["fileId"]]
    corpus = rec["corpus"]
    src_cfg = inp.sources[corpus]
    comp = g["composer"]
    lic = g["licence"]
    names = source_names(corpus, g["path"], rec["movement"])
    part = inp.parts.get(f"{rec['fileId']}#{rec['partIndex']}", {})
    source: dict[str, Any] = {
        "composer": comp["name"],
        "composerDates": f"{comp['born']}–{comp['died']}" if comp.get("born") and comp.get("died") else None,
        "composerDeath": int(comp["died"]) if comp.get("died") else None,
        **names,
        "partName": " ".join((part.get("name") or rec.get("roleLabel") or rec.get("role") or "").split()) or None,
        "sourceMeasures": [measure_number(rec["sourceMeasures"][0]), measure_number(rec["sourceMeasures"][1])],
        "encoder": ENCODER.get(corpus),
        "corpus": corpus,
        "upstreamRef": f"{src_cfg.repo}@{src_cfg.sha[:8]}:{g['path']}",
        "sourceUrl": src_cfg.url,
        "license": lic["id"],
        "licenseUrl": lic["url"],
        "originalInstrument": ORIGINAL_INSTRUMENT.get(rec.get("roleLabel") or rec.get("role") or ""),
    }
    source = {k: v for k, v in source.items() if v is not None}
    modal = w.get("modal")
    mode = w["mode"]
    if modal:
        mode = "minor" if modal in MINOR_MODALS else "major"
    elif mode not in ("major", "minor"):
        raise EmitError(f"{rec['id']}: mode {mode!r} without a modal name")
    tags = sorted(set(rec.get("tags") or []) | {CORPUS_TAG[corpus], f"role:{rec.get('role')}"})
    q = rec.get("quality") or {}
    quality = {k: q[k] for k in ("soft", "interest") if isinstance(q.get(k), (int, float))}
    review = dict(rec["review"])
    review["llmVerdicts"] = sorted(review["llmVerdicts"], key=lambda v: v["pass"])
    doc: dict[str, Any] = {
        "schemaVersion": 1,
        "id": doc_id,
        "source": source,
        "meter": w["meter"],
        "keyConcert": {"fifths": w["fifths"], "mode": mode},
        "modal": modal,
        "tempo": tempo_of(rec, w["meter"], inp.cfg["tempo"]),
        "pickupTicks": w["pickupTicks"],
        "measures": make_events(w["measures"]),
        "rangeConcert": rec["rangeConcert"],
        "features": rec["features"],
        "rhythmCells": rec["rhythmCells"],
        "featureLevels": rec["featureLevels"],
        "barRhythmLevel": rec["barRhythmLevel"],
        "extremes": rec["extremes"],
        "level": rec["effectiveLevel"],
        "levelConfidence": rec["levelConfidence"],
        "cadenceEnd": rec["cadenceEnd"],
        "phraseQuality": rec["phraseQuality"],
        "breathMaxGapBars": rec["breathMaxGapBars"],
        "familiarity": rec["familiarity"],
        "flags": rec["flags"],
        "tags": tags,
        "dedupeGroup": rec["dedupeGroup"],
        "work": rec["work"],
        "modifications": rec["modifications"],
        "quality": quality,
        "review": review,
        "contentHash": rec["contentHash"],
    }
    return doc


# ---------------------------------------------------------------------------------------------------- manifest


def spelling_counts(doc: dict[str, Any]) -> dict[str, int]:
    """ManifestEntry.spelling (PLAN ruling 44): note events per concert spelled pitch class, keyed letter + alteration.
    Every note event counts, tie continuations included, as the runtime spelling rule counts them."""
    out: Counter[str] = Counter()
    for m in doc["measures"]:
        for e in m["events"]:
            if e["kind"] == "note":
                out[f"{e['pitch']['step']}{e['pitch']['alter']}"] += 1
    return dict(sorted(out.items()))


def meter_str(m: dict[str, Any]) -> str:
    return f"{m['beats']}/{m['beatType']}"


def manifest_entry(doc: dict[str, Any], shard: str) -> dict[str, Any]:
    src = doc["source"]
    orig = src.get("originalInstrument")
    e: dict[str, Any] = {
        "id": doc["id"],
        "shard": shard,
        "level": doc["level"],
        "meter": meter_str(doc["meter"]),
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
    if orig in FAMILY:
        e["originalFamily"] = FAMILY[orig]
    return e


def fit_view(e: dict[str, Any]) -> dict[str, Any]:
    """The shape coverage.fitting_keys reads, built from the manifest entry (not from pipeline state)."""
    modal = e["modal"]
    return {"effectiveLevel": e["level"], "mode": modal or e["mode"], "modal": modal, "fifths": e["fifths"], "rangeConcert": {"min": e["rangeConcert"][0], "max": e["rangeConcert"][1]}}


def manifest_stats(entries: list[dict[str, Any]], served_min: int) -> dict[str, Any]:
    lvs = {lv["level"]: lv for lv in levels_config()}
    fit: dict[str, Any] = {}
    views = [(e, fit_view(e)) for e in entries]
    for ins in instruments():
        per: dict[str, dict[str, int]] = {}
        for e, v in views:
            if fitting_keys(v, ins, lvs[e["level"]]):
                per.setdefault(str(e["level"]), {}).setdefault(e["meter"], 0)
                per[str(e["level"])][e["meter"]] += 1
        fit[ins["id"]] = {k: dict(sorted(per[k].items())) for k in sorted(per, key=int)}
    counts = Counter(e["level"] for e in entries)
    return {"servedLevels": sorted(lv for lv, n in counts.items() if n >= served_min), "fit": fit}


def encode_manifest(entries: list[dict[str, Any]], stats: dict[str, Any], version: str) -> dict[str, Any]:
    dicts: dict[str, list[str]] = {c: sorted({e[c] for e in entries}) for c in ("composer", "title", "work")}
    dicts["tags"] = sorted({t for e in entries for t in e["tags"]})
    index = {c: {s: i for i, s in enumerate(dicts[c])} for c in DICT_COLUMNS}
    rows = []
    for e in entries:
        row: list[Any] = []
        for col in MANIFEST_COLUMNS:
            v = e.get(col)
            if col in ("composer", "title", "work"):
                v = index[col][v]
            elif col == "tags":
                v = [index["tags"][t] for t in v]
            row.append(v)
        rows.append(row)
    return {"schemaVersion": 1, "corpusVersion": version, "columns": MANIFEST_COLUMNS, "rows": rows, "dict": dicts, "stats": stats}


# ---------------------------------------------------------------------------------------------------- attributions


def make_attributions(docs: list[dict[str, Any]], inp: Inputs) -> dict[str, Any]:
    by_corpus: dict[str, set[str]] = defaultdict(set)
    items = []
    for d in docs:
        s = d["source"]
        by_corpus[s["corpus"]].add(s["license"])
        if s["license"] == "CC-BY-4.0":
            items.append(
                {
                    "id": d["id"],
                    "title": s.get("movement") or s["work"],
                    "creator": s.get("encoder") or s["composer"],
                    "sourceUrl": s["sourceUrl"],
                    "license": "CC-BY-4.0",
                    "licenseUrl": s["licenseUrl"],
                    "changes": d["modifications"],
                }
            )
    collections = [{"corpus": c, "name": inp.sources[c].name, "url": inp.sources[c].url, "licenses": sorted(by_corpus[c])} for c in sorted(by_corpus)]
    return {"schemaVersion": 1, "collections": collections, "items": sorted(items, key=lambda i: i["id"])}


# ---------------------------------------------------------------------------------------------------- trim


def trim_by_interest(docs: list[dict[str, Any]], keep_fraction: float) -> list[dict[str, Any]]:
    """Drop the lowest-interest excerpts, the same share from every level (task C9: evenly across levels)."""
    by_level: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for d in docs:
        by_level[d["level"]].append(d)
    keep: list[dict[str, Any]] = []
    for lv, group in sorted(by_level.items()):
        group = sorted(group, key=lambda d: (-d["quality"].get("interest", 0), d["id"]))
        keep.extend(group[: max(1, round(len(group) * keep_fraction))])
    return sorted(keep, key=lambda d: d["id"])


def cap_levels_by_interest(docs: list[dict[str, Any]], cap: int) -> list[dict[str, Any]]:
    """Keep at most `cap` excerpts per level, the most interesting first. Levels at or under the cap are untouched, so a
    thin level (L7 to L10) is never trimmed to pay for a crowded one (L5, L6)."""
    by_level: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for d in docs:
        by_level[d["level"]].append(d)
    keep: list[dict[str, Any]] = []
    for _, group in sorted(by_level.items()):
        keep.extend(sorted(group, key=lambda d: (-d["quality"].get("interest", 0), d["id"]))[:cap])
    return sorted(keep, key=lambda d: d["id"])


def manifest_gzip_bytes(docs: list[dict[str, Any]], served_min: int) -> int:
    """Gzip size of the manifest the given documents would produce (the H-budget measure)."""
    entries = sorted((manifest_entry(d, "shard-L%02d-01" % d["level"]) for d in docs), key=lambda e: e["id"])
    data = dumps(encode_manifest(entries, manifest_stats(entries, served_min), "c1-0000000000"), pretty=False)
    return len(gzip.compress(data, 9, mtime=0))


# ---------------------------------------------------------------------------------------------------- the build


@dataclass
class Emission:
    files: dict[str, bytes]
    docs: list[dict[str, Any]]
    entries: list[dict[str, Any]]
    stats: dict[str, Any]
    index: dict[str, Any]
    attributions: dict[str, Any]
    problems: list[str]
    trimmed: dict[str, Any] | None
    inputs: Inputs


def build_corpus(inp: Inputs, validate: bool = True) -> Emission:
    cfg = inp.cfg
    n_hex = cfg["hash_hex_chars"]
    ids = excerpt_ids(inp.records, inp.gate)
    rec_of = {ids[r["id"]]: r for r in inp.records}
    docs = [make_doc(r, ids[r["id"]], inp) for r in inp.records]
    trimmed = None
    # Excerpts named in denylist.yaml (takedowns, and C10's `corpus:check` failures by excerpt id) and excerpts that no
    # launch instrument could ever be served (03 7.5 rule 5: the excerpt's own tempo range, bars, flags or IOI/NPS
    # clipping) are dropped before any size trim, so the trims below spend their budget on servable excerpts.
    deny = load_denylist()
    before_serve = len(docs)
    denied = [d["id"] for d in docs if d["id"] in deny.ids]
    docs = [d for d in docs if d["id"] not in deny.ids]
    unservable = [d["id"] for d in docs if not servable(d)]
    docs = [d for d in docs if d["id"] not in set(unservable)]
    if denied or unservable:
        trimmed = {"servableBefore": before_serve, "denylisted": len(denied), "unservable": len(unservable), "servableAfter": len(docs)}

    def assemble(ds: list[dict[str, Any]]) -> tuple[dict[str, bytes], list[dict[str, Any]], dict[str, Any], dict[str, Any], dict[str, Any]]:
        ds = sorted(ds, key=lambda d: (d["level"], d["id"]))
        by_level: dict[int, list[dict[str, Any]]] = defaultdict(list)
        for d in ds:
            by_level[d["level"]].append(d)
        files: dict[str, bytes] = {}
        chunks = []
        entries = []
        size = cfg["chunk_max_excerpts"]
        for level in sorted(by_level):
            group = by_level[level]
            for n in range(0, len(group), size):
                shard = f"shard-L{level:02d}-{n // size + 1:02d}"
                part = group[n : n + size]
                data = dumps({"schemaVersion": 1, "shard": shard, "excerpts": part}, pretty=False)
                name = hashed_name(shard, data, n_hex)
                files[name] = data
                chunks.append({"shard": shard, "file": name, "hash": "sha256:" + sha256(data), "bytes": len(data)})
                entries.extend(manifest_entry(d, shard) for d in part)
        entries.sort(key=lambda e: e["id"])
        stats = manifest_stats(entries, cfg["served_min"])
        version = "c1-" + sha256("\n".join(f"{d['id']} {d['contentHash']}" for d in sorted(ds, key=lambda d: d["id"])).encode())[:10]
        mdata = dumps(encode_manifest(entries, stats, version), pretty=False)
        mname = hashed_name("manifest", mdata, n_hex)
        files[mname] = mdata
        attrs = make_attributions(ds, inp)
        adata = dumps(attrs, pretty=True)
        aname = hashed_name("attributions", adata, n_hex)
        files[aname] = adata
        index = {
            "schemaVersion": 1,
            "corpusVersion": version,
            "manifest": {"file": mname, "hash": "sha256:" + sha256(mdata), "bytes": len(mdata)},
            "attributions": {"file": aname, "hash": "sha256:" + sha256(adata), "bytes": len(adata)},
            "chunks": chunks,
        }
        files["index.json"] = dumps(index, pretty=True)
        files["withdrawn.json"] = dumps({"schemaVersion": 1, "ids": []}, pretty=True)
        return files, entries, stats, index, attrs

    files, entries, stats, index, attrs = assemble(docs)
    total = sum(len(b) for b in files.values())
    if total > cfg["size_limit_bytes"]:
        frac = cfg["size_limit_bytes"] / total * 0.97
        before = len(docs)
        docs = trim_by_interest(docs, frac)
        trimmed = {**(trimmed or {}), "before": before, "after": len(docs), "bytesBefore": total, "keepFraction": round(frac, 4)}
        files, entries, stats, index, attrs = assemble(docs)

    # The manifest budget (01 section 12) caps the number of excerpts: cap the crowded levels, never the thin ones.
    mmax = cfg["budget"]["manifest_gzip_max"]
    if manifest_gzip_bytes(docs, cfg["served_min"]) > mmax * 0.99:
        before = len(docs)
        lo, hi = 1, max(Counter(d["level"] for d in docs).values())
        while lo < hi:  # the largest per-level cap that fits (1% headroom for the shard names and version string)
            mid = (lo + hi + 1) // 2
            if manifest_gzip_bytes(cap_levels_by_interest(docs, mid), cfg["served_min"]) <= mmax * 0.99:
                lo = mid
            else:
                hi = mid - 1
        docs = cap_levels_by_interest(docs, lo)
        trimmed = {**(trimmed or {}), "manifestLevelCap": lo, "manifestBefore": before, "manifestAfter": len(docs)}
        files, entries, stats, index, attrs = assemble(docs)

    problems: list[str] = []
    if validate:
        problems += validate_files(files, docs, index)
    kept_recs = [rec_of[d["id"]] for d in docs]
    problems += check_documents(docs, kept_recs, inp, files, index)
    return Emission(files, docs, entries, stats, index, attrs, problems, trimmed, inp)


# ---------------------------------------------------------------------------------------------------- schemas (H-schema)


def schema_validator(name: str) -> jsonschema.Draft7Validator:
    with open(SHIPPED_SCHEMA_DIR / name, encoding="utf-8") as f:
        schema = json.load(f)
    return jsonschema.Draft7Validator(schema)


def validate_files(files: dict[str, bytes], docs: list[dict[str, Any]], index: dict[str, Any]) -> list[str]:
    problems: list[str] = []
    excerpt_v = schema_validator("excerpt.schema.json")
    chunk_v = schema_validator("excerpt-chunk.schema.json")
    manifest_v = schema_validator("manifest.schema.json")
    attr_v = schema_validator("attributions.schema.json")
    index_v = schema_validator("corpus-index.schema.json")
    with_v = schema_validator("withdrawn.schema.json")

    def run(v: jsonschema.Draft7Validator, obj: Any, what: str) -> None:
        errs = sorted(v.iter_errors(obj), key=lambda e: list(e.absolute_path))
        for e in errs[:3]:
            problems.append(f"H-schema: {what}: {'/'.join(str(p) for p in e.absolute_path)}: {e.message[:200]}")
        if len(errs) > 3:
            problems.append(f"H-schema: {what}: {len(errs) - 3} more errors")

    run(index_v, index, "index.json")
    run(with_v, json.loads(files["withdrawn.json"]), "withdrawn.json")
    run(manifest_v, json.loads(files[index["manifest"]["file"]]), index["manifest"]["file"])
    run(attr_v, json.loads(files[index["attributions"]["file"]]), index["attributions"]["file"])
    for c in index["chunks"]:
        chunk = json.loads(files[c["file"]])
        run(chunk_v, chunk, c["file"])
        for d in chunk["excerpts"]:
            run(excerpt_v, d, f"excerpt {d['id']}")
    return problems


# ---------------------------------------------------------------------------------------------------- viability (ruling 24)


def marking_tempo_ok(e: dict[str, Any], lvdef: dict[str, Any]) -> bool:
    """The excerpt's own [minBpm, maxBpm] meets the level's tempo range (compound dotted ranges included)."""
    lo, hi = lvdef["tempo"]["minBpm"], lvdef["tempo"]["maxBpm"]
    lj = _levels_json()
    beats, bt = (int(x) for x in e["meter"].split("/"))
    compound = bt == 8 and beats >= 6 and beats % 3 == 0
    a, b = lj["compound"]["dottedBeatLevels"]
    if compound and a <= lvdef["level"] <= b:
        lo, hi = lj["compound"]["dottedBpm"]["minBpm"], lj["compound"]["dottedBpm"]["maxBpm"]
    return max(lo, e["minBpm"]) <= min(hi, e["maxBpm"]) + 1e-9




def servable(doc: dict[str, Any]) -> bool:
    """True if some launch instrument can be served this excerpt at some level (its own, one above it as the level-down
    pool, or one below it as stretch), by the same checks `viability` counts as selectable."""
    lvs = {lv["level"]: lv for lv in levels_config()}
    lj = _levels_json()
    e = manifest_entry(doc, "shard")
    r = dict(fit_view(e), id=e["id"], meter=e["meter"], bars=e["bars"], flags=e["flags"], familiarity=e["familiarity"], features=doc["features"], featureLevels=doc["featureLevels"], minLevelCadence=3 if e["cadenceEnd"] == "HC" else 1)
    for ins in (i for i in instruments() if i["status"] == "launch"):
        for L in range(max(1, e["level"] - 1), min(10, e["level"] + 1) + 1):
            lvdef = lvs[L]
            if pool_of(r, L) is None or not fitting_keys(r, ins, lvdef):
                continue
            if r["bars"] in lvdef["bars"] and flag_allowed(r, ins, L) and tempo_ok(r, ins, lvdef, lj) and marking_tempo_ok(e, lvdef):
                return True
    return False


def viability(docs: list[dict[str, Any]], entries: list[dict[str, Any]], stats: dict[str, Any], cfg: dict[str, Any]) -> dict[str, Any]:
    """Ruling 24: at least 300 excerpts, and a non-empty selection for every launch instrument at every served level.

    The selection follows 02 section 2.6 as `coverage.py` does (level L, L-1 and stretch pools, written modes, key fit,
    flags, bar counts, IOI and NPS tempo clipping) and adds the excerpt's own tempo range, which only the emitter knows.
    Random key and random meter: any written key and any meter count. The TS selector (C10) is the final check."""
    lvs = {lv["level"]: lv for lv in levels_config()}
    lj = _levels_json()
    launch = [i for i in instruments() if i["status"] == "launch"]
    served = stats["servedLevels"]
    by_id = {d["id"]: d for d in docs}
    views = []
    for e in entries:
        d = by_id[e["id"]]
        r = dict(fit_view(e), id=e["id"], meter=e["meter"], bars=e["bars"], flags=e["flags"], familiarity=e["familiarity"], features=d["features"], featureLevels=d["featureLevels"], minLevelCadence=3 if e["cadenceEnd"] == "HC" else 1)
        views.append((e, r))
    table: dict[str, dict[str, Any]] = {}
    empty: list[str] = []
    for ins in launch:
        per: dict[str, Any] = {}
        for L in range(1, 11):
            lvdef = lvs[L]
            sel = ranked = at_level = tempo_only = 0
            key_counts: Counter[str] = Counter()
            for e, r in views:
                pool = pool_of(r, L)
                if pool is None:
                    continue
                keys = fitting_keys(r, ins, lvdef)
                if pool == "level" and keys:
                    at_level += 1
                    key_counts.update(k for k in keys if k != "random")
                if not keys or r["bars"] not in lvdef["bars"] or not flag_allowed(r, ins, L) or not tempo_ok(r, ins, lvdef, lj):
                    continue
                if not marking_tempo_ok(e, lvdef):
                    tempo_only += 1
                    continue
                sel += 1
                if r["familiarity"] < 2:
                    ranked += 1
            per[str(L)] = {"atLevel": at_level, "selectable": sel, "rankedSelectable": ranked, "lostToMarkedTempo": tempo_only, "keysWith10": sum(1 for v in key_counts.values() if v >= 10)}
            if L in served and sel == 0:
                empty.append(f"{ins['id']} L{L}")
        table[ins["id"]] = per
    total = len(entries)
    return {
        "total": total,
        "totalOk": total >= cfg["viable_total_min"],
        "servedLevels": served,
        "emptyCells": empty,
        "ok": total >= cfg["viable_total_min"] and not empty,
        "instruments": table,
    }


# ---------------------------------------------------------------------------------------------------- licences


def licence_texts(inp: Inputs) -> dict[str, str]:
    """Full texts for LICENSES/. The CC0 text is the OpenScore repository's own LICENSE.txt when the clone cache is
    present, else the committed copy is kept (the emitter then does not rewrite it)."""
    out: dict[str, str] = {}
    out["CORPUS-STATEMENT.txt"] = (
        "Contributions of this project to the score corpus\n"
        "=================================================\n\n"
        "The excerpts in public/corpus/v1/ are cut, normalized and annotated from OpenScore Lieder and OpenScore String\n"
        "Quartets, both released under CC0 1.0 Universal by their contributors. The cutting, the normalization, the\n"
        "level and feature annotations and the review records that this project adds are released under the same\n"
        "CC0 1.0 Universal dedication (https://creativecommons.org/publicdomain/zero/1.0/): to the extent possible under\n"
        "law, the authors of this project have waived all copyright and related or neighbouring rights to them.\n\n"
        "The underlying compositions are in the public domain: every composer included died before 1931 (PLAN ruling 28).\n"
        "Per-excerpt provenance (upstream repository, commit and path) is in each excerpt's `source` record.\n"
    )
    return out


def write_licences(inp: Inputs, cache: Path | None, licences_dir: Path) -> list[str]:
    """Writes LICENSES/CC0-1.0.txt (from the OpenScore clone), CORPUS-STATEMENT.txt. Returns notes for the report."""
    notes: list[str] = []
    licences_dir.mkdir(parents=True, exist_ok=True)
    for name, text in licence_texts(inp).items():
        (licences_dir / name).write_text(text, encoding="utf-8", newline="\n")
    src = None
    if cache is not None:
        for sid in ("openscore-lieder", "openscore-quartets"):
            p = cache / sid / "LICENSE.txt"
            if p.exists():
                src = p
                break
    target = licences_dir / "CC0-1.0.txt"
    if src is not None:
        target.write_bytes(src.read_bytes())
    elif not target.exists():
        notes.append("LICENSES/CC0-1.0.txt is missing and the OpenScore clone is not in the cache")
    if not (licences_dir / "CC-BY-4.0.txt").exists():
        notes.append("LICENSES/CC-BY-4.0.txt is missing")
    return notes


# ---------------------------------------------------------------------------------------------------- writing


def write_files(files: dict[str, bytes], out_dir: Path) -> None:
    """Writes the emission, removing stale hashed files and leaving anything that is not a corpus json (.gitkeep)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    for p in out_dir.glob("*.json"):
        if p.name not in files:
            p.unlink()
    for name, data in files.items():
        (out_dir / name).write_bytes(data)


# ---------------------------------------------------------------------------------------------------- the stage


GATE_PREFIXES = ["H-schema", "H-licence", "H-credits", "H-rules", "H-dedupe", "H-review", "H-budget"]


def run_emit(build: Path, out_dir: Path = PUBLIC_CORPUS, licences_dir: Path = LICENSES_DIR, cache: Path | None = None, report_path: Path | None = None) -> dict[str, Any]:
    """The emit stage. Builds twice (H-determinism), checks every gate, writes the corpus only if all pass, always writes
    the report. Returns a summary; `ok` is False if any hard gate failed."""
    inp = load_inputs(build)
    em = build_corpus(inp)
    em2 = build_corpus(inp, validate=False)
    deterministic = em.files == em2.files
    via = viability(em.docs, em.entries, em.stats, inp.cfg)
    gates: dict[str, str] = {}
    for g in GATE_PREFIXES:
        bad = [p for p in em.problems if p.startswith(g + ":")]
        gates[g] = "pass" if not bad else f"FAIL ({len(bad)})"
    gates["H-viable"] = "pass" if via["ok"] else "FAIL"
    gates["H-render"] = "not run here: C10 renders every excerpt in headless Chromium"
    determinism = "pass (two builds are byte-identical)" if deterministic else "FAIL (two builds differ)"
    ok = not em.problems and via["ok"] and deterministic
    notes: list[str] = []
    if ok:
        write_files(em.files, out_dir)
        notes += write_licences(inp, cache, licences_dir)
    else:
        notes.append("A hard gate failed: nothing was written to public/corpus/.")
    notes += [
        "Not checkable from the emitted documents, applied by the pipeline: H1 (phrase start), H5 and H12 sequences and beam groups (no beam data in the sources), H8 and H9 (source side).",
        "Nested or overlapping source slurs are flattened to their outer span in `slur` marks (ExcerptDoc has one mark per note).",
        "Modal excerpts carry `keyConcert.mode` 'minor' for dorian, phrygian, aeolian and locrian and 'major' for lydian and mixolydian (the third of the mode); `modal` names the mode and they are served only under a random key (R8).",
    ]
    report = render(em, inp, via, gates, determinism, notes)
    rp = report_path or build / "report.md"
    rp.parent.mkdir(parents=True, exist_ok=True)
    rp.write_text(report + "\n", encoding="utf-8", newline="\n")
    return {"ok": ok, "excerpts": len(em.docs), "chunks": len(em.index["chunks"]), "bytes": sum(len(b) for b in em.files.values()), "servedLevels": em.stats["servedLevels"], "problems": em.problems, "gates": gates, "determinism": deterministic, "viable": via["ok"], "emptyCells": via["emptyCells"], "trimmed": em.trimmed, "notes": notes, "report": str(rp)}
