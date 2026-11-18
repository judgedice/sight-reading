"""Golden `ExpectedNote[]` for 6 fixture excerpts x flute, B-flat clarinet, alto sax (01 §6.4, §14 item 8).

Usage: python3 -I tools/fixtures/expected.py            # reads fixtures/corpus/, writes fixtures/expected/

Needs only the committed fixture corpus and config/. The TypeScript test `tools/fixtures/fixtures.test.ts`
recomputes every golden with an independent implementation and requires an empty diff.

Rules applied (each is a reading of the spec, named so P9c can match or challenge it):
- Transposition: 03 §7.3 closed-form fit against the instrument's tier band for the excerpt's level; written key =
  the allowed written key (02 §2.3 "Written key" row, mode must match) whose best shift has the largest minimum
  margin, ties to fewer accidentals then lower fifths; shift t = largest minimum margin, then smallest |t| (03 §7.4).
  The interval's diatonic size is the letter distance between the concert tonics, extended by 7 per octave.
- Tempo: the level's minimum bpm (the dotted-quarter range of `levels.json compound` for 6/8 at L4 and L5), raised
  to the excerpt's minimum if that is inside the level's range.
- A tie chain is one note. bar = displayed bar (pickup 0). beatInBar is 1-based in metronome beats, measured on the
  full-bar grid (a one-beat pickup in 4/4 sits on beat 4).
- onsetKind: 'repeat' if the previous note has the same concert pitch and no rest intervenes; else 'slurred' if a
  slur is open when the note starts; else 'articulated'.
- artic: staccato > accent (marcato counts as accent) > tenuto > normal, from the chain's first event.
- durationGraded (02 §4.3): at least `credit.duration.minBeats` beats, not staccato, not the final note (the phrase
  end), and never for keyboard or guitar families.
- keySigAltered: the written note takes a non-natural alteration from the written key signature.
  explicitAccidental: the written alteration differs from the key signature's (an accidental is in force).
- ledgerLines: for the written pitch in the chosen clef.
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import excerpt_lib as xl  # noqa: E402

CORPUS = os.path.join(xl.REPO, "fixtures", "corpus")
OUT = os.path.join(xl.REPO, "fixtures", "expected")
INSTRUMENTS = ["flute", "clarinet-bb", "sax-alto"]
WANT = ["pickup", "tie-across-barline", "triplet", "meter:6/8", "mode:minor", "slurred-run", "repeated-notes", "rests", "accidentals", "meter:2/2", "meter:3/4", "meter:2/4"]
STAFF_BOTTOM = {"treble": ("E", 4), "treble-8vb": ("E", 4), "bass": ("G", 2), "alto": ("F", 3), "tenor": ("D", 3)}


def load_docs() -> list[dict]:
    index = json.load(open(os.path.join(CORPUS, "index.json"), encoding="utf-8"))
    docs = []
    for c in index["chunks"]:
        docs.extend(json.load(open(os.path.join(CORPUS, c["file"]), encoding="utf-8"))["excerpts"])
    return sorted(docs, key=lambda d: d["id"])


def letter_index(step: str) -> int:
    return xl.STEPS.index(step)


def transpose_pitch(p: dict, iv: dict) -> dict:
    total = p["octave"] * 7 + letter_index(p["step"]) + iv["diatonic"]
    step = xl.STEPS[total % 7]
    octave = total // 7
    alter = xl.pitch_midi(p) + iv["chromatic"] - xl.midi_of(step, 0, octave)
    if abs(alter) > 2:
        raise ValueError(f"triple accidental transposing {p} by {iv}")
    return {"step": step, "alter": alter, "octave": octave}


def interval_fifths(iv: dict) -> int:
    for f in sorted(range(-12, 13), key=lambda x: (abs(x), x)):
        if (7 * f - iv["chromatic"]) % 12 == 0 and (4 * f - iv["diatonic"]) % 7 == 0:
            return f
    raise ValueError(iv)


def best_shift(lo: int, hi: int, p: int, band: list[int], c_i: int) -> tuple[int, int] | None:
    """(t, margin) for the best whole-excerpt shift t = p + 12k inside the band (03 §7.3, §7.4 step 1)."""
    t_min = band[0] - c_i - lo
    t_max = band[1] - c_i - hi
    best = None
    for k in range(-10, 11):
        t = p + 12 * k
        if t_min <= t <= t_max:
            margin = min(lo + c_i + t - band[0], band[1] - (hi + c_i + t))
            key = (-margin, abs(t), t)
            if best is None or key < best[0]:
                best = (key, t, margin)
    return None if best is None else (best[1], best[2])


def plan(doc: dict, inst: dict) -> dict | None:
    level = doc["level"]
    lv = xl.LEVELS[level - 1]
    band = inst["tiers"][lv["tier"]]
    wms = inst["writtenMinusSounding"]
    c_i = wms["chromatic"]
    mode = doc["keyConcert"]["mode"]
    if mode not in lv["writtenKeys"]["modes"]:
        return None
    fs = doc["keyConcert"]["fifths"]
    f_i = interval_fifths(wms)
    lo, hi = doc["rangeConcert"]["min"], doc["rangeConcert"]["max"]
    k = lv["writtenKeys"]["maxAccidentals"]
    best = None
    for fw in range(-k, k + 1):
        fc = fw - f_i
        if abs(fc) > 7:
            continue
        p = (xl.tonic_pc(fc, mode) - xl.tonic_pc(fs, mode)) % 12
        r = best_shift(lo, hi, p, band, c_i)
        if r is None:
            continue
        t, margin = r
        ls = letter_index(xl.tonic_of(fs, mode)[0])
        lc = letter_index(xl.tonic_of(fc, mode)[0])
        iv = {"diatonic": (lc - ls) % 7 + 7 * ((t - t % 12) // 12), "chromatic": t}
        if not spelling_ok(doc, iv, wms, level):
            continue
        key = (-margin, abs(fw), fw)
        if best is None or key < best[0]:
            best = (key, fw, fc, iv)
    if best is None:
        return None
    _key, fw, fc, iv = best
    return {"writtenKey": {"fifths": fw, "mode": mode}, "concertKey": {"fifths": fc, "mode": mode}, "transposition": iv, "clef": "treble"}


def spelling_ok(doc: dict, iv: dict, wms: dict, level: int) -> bool:
    """03 §7.5 item 3: no triple accidentals; no double accidentals in the written part below L8."""
    for m in doc["measures"]:
        for e in m["events"]:
            if e["kind"] != "note":
                continue
            try:
                w = transpose_pitch(transpose_pitch(e["pitch"], iv), wms)
            except ValueError:
                return False
            if abs(w["alter"]) == 2 and level < 8:
                return False
    return True


def ledger_lines(p: dict, clef: str) -> int:
    bs, bo = STAFF_BOTTOM[clef]
    bottom = bo * 7 + letter_index(bs)
    top = bottom + 8
    d = p["octave"] * 7 + letter_index(p["step"])
    if d < bottom:
        return (bottom - d) // 2
    if d > top:
        return (d - top) // 2
    return 0


def choose_bpm(doc: dict) -> int:
    lv = xl.LEVELS[doc["level"] - 1]
    lo, hi = lv["tempo"]["minBpm"], lv["tempo"]["maxBpm"]
    comp = xl.load_json("config/levels.json")["compound"]
    if xl.compound(doc["meter"]) and doc["level"] in comp["dottedBeatLevels"]:
        lo, hi = comp["dottedBpm"]["minBpm"], comp["dottedBpm"]["maxBpm"]
    if lo <= doc["tempo"]["minBpm"] <= hi:
        return doc["tempo"]["minBpm"]
    return lo


def expected_notes(doc: dict, inst: dict, pl: dict, bpm: int, cfg: dict) -> list[dict]:
    meter = doc["meter"]
    unit = meter["countUnitTicks"]
    bt = xl.bar_ticks(meter)
    pickup = doc["pickupTicks"]
    events = []
    for m in doc["measures"]:
        for e in m["events"]:
            events.append((m, e))
    wk = pl["writtenKey"]["fifths"]
    family = inst["family"]
    min_beats = cfg["credit"]["duration"]["minBeats"]
    chains = []
    depth = 0
    cur = None
    for i, (m, e) in enumerate(events):
        if e["kind"] == "rest":
            cur = None
            continue
        before = depth
        s = e.get("slur")
        if s in ("stop", "continue"):
            depth -= 1
        if s in ("start", "continue"):
            depth += 1
        if cur is not None and e.get("tieStop"):
            cur["ids"].append(e["id"])
            cur["dur"] += e["dur"]
            cur["lastIdx"] = i
        else:
            cur = {"ids": [e["id"]], "m": m, "e": e, "dur": e["dur"], "firstIdx": i, "lastIdx": i, "slurOpen": before > 0}
            chains.append(cur)
        if not e.get("tieStart"):
            cur = None
    out = []
    for n, c in enumerate(chains):
        m, e = c["m"], c["e"]
        bar_start = m["startTick"] - (bt - pickup) if m["isPickup"] else m["startTick"]
        onset_beat = (e["tick"] - pickup) / unit
        dur_beats = c["dur"] / unit
        concert = transpose_pitch(e["pitch"], pl["transposition"])
        written = transpose_pitch(concert, inst["writtenMinusSounding"])
        prev_ev = events[c["firstIdx"] - 1][1] if c["firstIdx"] > 0 else None
        next_ev = events[c["lastIdx"] + 1][1] if c["lastIdx"] + 1 < len(events) else None
        preceded = prev_ev is not None and prev_ev["kind"] == "rest"
        followed = next_ev is not None and next_ev["kind"] == "rest"
        cm = xl.pitch_midi(concert)
        if n > 0 and xl.pitch_midi(transpose_pitch(chains[n - 1]["e"]["pitch"], pl["transposition"])) == cm and not preceded:
            kind = "repeat"
        elif c["slurOpen"]:
            kind = "slurred"
        else:
            kind = "articulated"
        arts = e.get("artic", [])
        artic = "staccato" if "staccato" in arts else "accent" if ("accent" in arts or "marcato" in arts) else "tenuto" if "tenuto" in arts else "normal"
        ks = xl.key_alter(wk, written["step"])
        out.append(
            {
                "idx": n,
                "eventIds": c["ids"],
                "bar": m["index"] if doc["pickupTicks"] else m["index"] + 1,
                "beatInBar": 1 + (e["tick"] - bar_start) / unit,
                "onsetBeat": onset_beat,
                "durBeats": dur_beats,
                "onsetSec": onset_beat * 60 / bpm,
                "durSec": dur_beats * 60 / bpm,
                "concertMidi": cm,
                "writtenPitch": written,
                "ioiPrevSec": None,
                "ioiNextSec": None,
                "precededByRest": preceded,
                "followedByRest": followed,
                "onsetKind": kind,
                "artic": artic,
                "durationGraded": dur_beats >= min_beats and artic != "staccato" and n != len(chains) - 1 and family not in ("keyboard", "guitar"),
                "keySigAltered": ks != 0 and written["alter"] == ks,
                "explicitAccidental": written["alter"] != ks,
                "ledgerLines": ledger_lines(written, pl["clef"]),
            }
        )
    for a, b in zip(out, out[1:]):
        a["ioiNextSec"] = b["onsetSec"] - a["onsetSec"]
        b["ioiPrevSec"] = b["onsetSec"] - a["onsetSec"]
    return out


def feats(doc: dict) -> set[str]:
    return set(doc["tags"]) | {f"meter:{xl.meter_str(doc['meter'])}", f"mode:{doc['keyConcert']['mode']}"}


def choose(docs: list[dict], insts: dict) -> list[dict]:
    pool = [d for d in docs if all(plan(d, insts[i]) is not None for i in INSTRUMENTS)]
    need = set(WANT)
    chosen = []
    levels_seen: set[int] = set()
    while len(chosen) < 6 and pool:
        best = max(pool, key=lambda d: (len(feats(d) & need) + (0.5 if d["level"] not in levels_seen else 0), [-ord(ch) for ch in d["id"]]))
        chosen.append(best)
        pool.remove(best)
        need -= feats(best)
        levels_seen.add(best["level"])
    return sorted(chosen, key=lambda d: d["id"])


def main() -> None:
    docs = load_docs()
    insts = {i["id"]: i for i in xl.load_json("config/instruments.json")["instruments"]}
    cfg = xl.load_json("config/grading-config.json")
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        if f.endswith(".json"):
            os.remove(os.path.join(OUT, f))
    chosen = choose(docs, insts)
    listing = []
    for doc in chosen:
        bpm = choose_bpm(doc)
        for iid in INSTRUMENTS:
            inst = insts[iid]
            pl = plan(doc, inst)
            assert pl is not None
            golden = xl.normalize_numbers({
                "schemaVersion": 1,
                "excerptId": doc["id"],
                "instrumentId": iid,
                "level": doc["level"],
                "writtenKey": pl["writtenKey"],
                "bpm": bpm,
                "transposition": pl["transposition"],
                "clef": pl["clef"],
                "notes": expected_notes(doc, inst, pl, bpm, cfg),
            })
            name = f"{doc['id']}.{iid}.json"
            with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
                f.write(json.dumps(golden, ensure_ascii=False, indent=1, sort_keys=True) + "\n")
            listing.append(name)
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
        f.write(json.dumps({"files": listing, "instruments": INSTRUMENTS, "excerpts": [d["id"] for d in chosen]}, indent=1, sort_keys=True) + "\n")
    print(f"expected: {len(listing)} goldens for {len(chosen)} excerpts -> {OUT}")


if __name__ == "__main__":
    main()
