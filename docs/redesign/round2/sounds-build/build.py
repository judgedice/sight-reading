#!/usr/bin/env python3
"""Build public/sounds/ from the chosen sample sources (see docs/redesign/round2/02-sounds.md).

Usage:
  python3 -I build.py fetch  CACHE_DIR       # download the source files into CACHE_DIR (curl, through the proxy)
  python3 -I build.py build  CACHE_DIR REPO  # trim, tune-check, loop, level and encode into REPO/public/sounds/
  python3 -I build.py check  REPO            # decode what was written and check pitch, loop and level

Needs ffmpeg (libmp3lame) and numpy. Run it from outside the cache directory.

Every output file is mono MP3, 44.1 kHz, 48 kbit/s. Sustained sounds get a baked crossfade loop
(loopStart/loopEnd in the manifest); decaying sounds (piano, guitar) are one-shots with a fade.
The voices are not samples: they are rendered here by a source-filter formant model (render_voice).
"""

from __future__ import annotations

import json
import math
import os
import subprocess
import sys
import tarfile

import numpy as np

SR = 44100
KBPS = 48
RMS_TARGET_DB = -20.0
PEAK_MAX_DB = -1.0

FLUID = "https://raw.githubusercontent.com/gleitz/midi-js-soundfonts/gh-pages/FluidR3_GM"
TINY_TGZ = "https://registry.npmjs.org/tiny-orchestra/-/tiny-orchestra-0.2.0.tgz"
SALAMANDER_TGZ = "https://registry.npmjs.org/@audio-samples/piano-mp3-velocity8/-/piano-mp3-velocity8-1.0.5.tgz"

NAMES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
NAMES_SHARP_S = ["C", "Cs", "D", "Ds", "E", "F", "Fs", "G", "Gs", "A", "As", "B"]
NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def note_name(midi: int, names: list[str]) -> str:
    return f"{names[midi % 12]}{midi // 12 - 1}"


# Sample sets. `notes` are sounding MIDI numbers. `range` is the sounding range the set must cover.
# kind: "sustain" (baked loop) or "decay" (one-shot). attack/release are the sampler's envelope, seconds.
SETS: dict[str, dict] = {
    # VSCO-2 CE (CC0), via tiny-orchestra 0.2.0 (CC0 edits of the same files)
    "flute": dict(src="vsco", dir="flute", notes=[60, 69, 76, 84, 93], range=[60, 96], kind="sustain", attack=0.03, release=0.2),
    "clarinet": dict(src="vsco", dir="clarinet", notes=[50, 58, 65, 74, 82, 89], range=[50, 89], kind="sustain", attack=0.02, release=0.2),
    "trumpet": dict(src="vsco", dir="trumpet", notes=[53, 60, 67, 74, 81], range=[52, 82], kind="sustain", attack=0.015, release=0.2),
    "oboe": dict(src="vsco", dir="oboe", notes=[58, 65, 74, 82, 89], range=[58, 91], kind="sustain", attack=0.02, release=0.2),
    "bassoon": dict(src="vsco", dir="bassoon", notes=[34, 41, 48, 55, 63, 72], range=[34, 76], kind="sustain", attack=0.03, release=0.2),
    "tuba": dict(src="vsco", dir="tuba", notes=[29, 34, 39, 46, 53, 62], range=[26, 65], kind="sustain", attack=0.03, release=0.3),
    "double-bass": dict(src="vsco", dir="basses", notes=[28, 34, 42, 49, 59], range=[28, 62], kind="sustain", attack=0.04, release=0.35),
    # FluidR3 GM (MIT, Frank Wen), rendered per note by gleitz/midi-js-soundfonts (CC BY 3.0)
    "violin": dict(src="fluid", gm="violin", notes=[55, 63, 71, 79, 87, 95], range=[55, 100], kind="sustain", attack=0.04, release=0.3),
    "viola": dict(src="fluid", gm="viola", notes=[48, 56, 64, 72, 80, 88], range=[48, 88], kind="sustain", attack=0.04, release=0.3),
    "cello": dict(src="fluid", gm="cello", notes=[40, 48, 56, 64, 72, 80], range=[40, 81], kind="sustain", attack=0.05, release=0.35),
    "sax-alto": dict(src="fluid", gm="alto_sax", notes=[49, 57, 65, 73, 81], range=[49, 81], kind="sustain", attack=0.02, release=0.15),
    "sax-tenor": dict(src="fluid", gm="tenor_sax", notes=[44, 52, 60, 68, 76], range=[44, 76], kind="sustain", attack=0.02, release=0.15),
    "sax-bari": dict(src="fluid", gm="baritone_sax", notes=[36, 44, 52, 60, 68], range=[36, 69], kind="sustain", attack=0.02, release=0.15),
    "horn": dict(src="fluid", gm="french_horn", notes=[35, 42, 49, 56, 63, 70, 77], range=[35, 77], kind="sustain", attack=0.04, release=0.3),
    "trombone": dict(src="fluid", gm="trombone", notes=[40, 47, 54, 61, 68, 74], range=[40, 74], kind="sustain", attack=0.03, release=0.25),
    "guitar": dict(src="fluid", gm="acoustic_guitar_nylon", notes=[40, 47, 54, 61, 68, 75], range=[40, 71], kind="decay", attack=0.002, release=0.25, maxLen=2.6),
    # Alternative voice for comparison only (a mixed choir, not a solo voice)
    "choir-aah": dict(src="fluid", gm="choir_aahs", notes=[41, 48, 55, 62, 69, 76, 83], range=[40, 84], kind="sustain", attack=0.08, release=0.35),
    # Salamander Grand Piano V3 (CC BY 3.0, Alexander Holm), velocity layer 8, via @audio-samples/piano-mp3-velocity8
    "piano": dict(src="salamander", notes=[36, 45, 54, 63, 72, 81, 90, 96], range=[36, 96], kind="decay", attack=0.002, release=0.3, maxLen=3.0),
}

# Formant voices: sounding range and the /a/ ("ah") formants. Frequencies Hz, bandwidths Hz.
# Bass, tenor, alto and soprano values are the classic sung-vowel table (Csound manual, appendix "Formant
# values"); baritone and mezzo are interpolated. They feed a cascade (all-pole) filter, so the levels follow
# from the spacing; the close F3-F5 of the male voices make the singer's formant near 2.5-3 kHz.
VOICES: dict[str, dict] = {
    "voice-bass": dict(range=[40, 65], f=[600, 1040, 2250, 2450, 2750], bw=[60, 70, 110, 120, 130]),
    "voice-baritone": dict(range=[43, 67], f=[625, 1060, 2450, 2675, 3000], bw=[70, 80, 115, 125, 135]),
    "voice-tenor": dict(range=[45, 69], f=[650, 1080, 2650, 2900, 3250], bw=[80, 90, 120, 130, 140]),
    "voice-alto": dict(range=[52, 77], f=[800, 1150, 2800, 3500, 4950], bw=[80, 90, 120, 130, 140]),
    "voice-mezzo": dict(range=[55, 81], f=[800, 1150, 2850, 3700, 4950], bw=[80, 90, 120, 130, 140]),
    "voice-soprano": dict(range=[57, 84], f=[800, 1150, 2900, 3900, 4950], bw=[80, 90, 120, 130, 140]),
}
VOICE_STEP = 4  # one rendered note every 4 semitones (shift at most 2)

# App instrument id -> sample set id
INSTRUMENT_MAP = {
    "voice-soprano": "voice-soprano", "voice-mezzo": "voice-mezzo", "voice-alto": "voice-alto",
    "voice-tenor": "voice-tenor", "voice-baritone": "voice-baritone", "voice-bass": "voice-bass",
    "flute": "flute", "clarinet-bb": "clarinet", "sax-alto": "sax-alto", "trumpet-bb": "trumpet",
    "violin": "violin", "cello": "cello", "piano-rh": "piano",
    "sax-tenor": "sax-tenor", "sax-bari": "sax-bari", "oboe": "oboe", "bassoon": "bassoon",
    "horn-f": "horn", "trombone": "trombone", "euphonium-bc": "trombone", "euphonium-tc": "trombone",
    "tuba": "tuba", "viola": "viola", "double-bass": "double-bass", "piano-lh": "piano", "guitar": "guitar",
}
SUBSTITUTES = {"euphonium-bc": "trombone samples (no free euphonium set found)",
               "euphonium-tc": "trombone samples (no free euphonium set found)"}

SOURCES = {
    "vsco": dict(name="VSCO-2 Community Edition", by="Versilian Studios (Sam Gossner, Simon Dalzell, Elan Hickler)",
                 licence="CC0-1.0", licenceFile="LICENSES/CC0-1.0.txt",
                 url="https://github.com/sgossner/VSCO-2-CE",
                 via="tiny-orchestra 0.2.0 on npm (CC0 edits of VSCO-2 CE)"),
    "fluid": dict(name="Fluid (R3) General MIDI SoundFont", by="Frank Wen and contributors",
                  licence="MIT (soundfont); CC-BY-3.0 (per-note renders)", licenceFile="LICENSES/MIT-FluidR3.txt; LICENSES/CC-BY-3.0.txt",
                  url="https://github.com/gleitz/midi-js-soundfonts",
                  via="per-note MP3 renders by Benjamin Gleitzman, midi-js-soundfonts"),
    "salamander": dict(name="Salamander Grand Piano V3", by="Alexander Holm",
                       licence="CC-BY-3.0", licenceFile="LICENSES/CC-BY-3.0.txt",
                       url="https://github.com/sfzinstruments/SalamanderGrandPiano",
                       via="@audio-samples/piano-mp3-velocity8 1.0.5 on npm (Jan Forst)"),
    "formant": dict(name="Formant voice", by="this project", licence="CC0-1.0", licenceFile="LICENSES/CC0-1.0.txt",
                    url="", via="rendered by docs/redesign/round2/sounds-build/build.py"),
}


# ---------------------------------------------------------------- audio io

def decode(path: str) -> np.ndarray:
    out = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(out, dtype=np.float32).astype(np.float64)


def encode(x: np.ndarray, path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-",
                    "-c:a", "libmp3lame", "-b:a", f"{KBPS}k", "-map_metadata", "-1", path],
                   input=x.astype(np.float32).tobytes(), check=True)


# ---------------------------------------------------------------- analysis

def yin_f0(x: np.ndarray, fmin: float = 25.0, fmax: float = 2200.0) -> float:
    """YIN on one frame (cumulative mean normalised difference), parabolic refinement. Returns Hz or 0."""
    n = len(x)
    tau_max = min(int(SR / fmin), n // 2)
    tau_min = max(2, int(SR / fmax))
    w = n - tau_max
    x = x - x.mean()
    # difference function via FFT
    e = np.concatenate([[0.0], np.cumsum(x ** 2)])
    d = np.zeros(tau_max + 1)
    for tau in range(1, tau_max + 1):
        d[tau] = (e[w] - e[0]) + (e[w + tau] - e[tau]) - 2 * float(np.dot(x[:w], x[tau:tau + w]))
    cm = np.ones_like(d)
    cs = np.cumsum(d[1:])
    cm[1:] = d[1:] * np.arange(1, tau_max + 1) / np.maximum(cs, 1e-12)
    thr = 0.12
    tau = -1
    for t in range(tau_min, tau_max):
        if cm[t] < thr:
            while t + 1 < tau_max and cm[t + 1] < cm[t]:
                t += 1
            tau = t
            break
    if tau < 0:
        tau = int(np.argmin(cm[tau_min:tau_max])) + tau_min
    if 1 <= tau < tau_max:
        a, b, c = cm[tau - 1], cm[tau], cm[tau + 1]
        den = a - 2 * b + c
        frac = 0.5 * (a - c) / den if abs(den) > 1e-12 else 0.0
    else:
        frac = 0.0
    return SR / (tau + frac)


def median_f0(x: np.ndarray, t0: float, t1: float, expect_hz: float) -> float:
    frame = int(max(0.06, 6.0 / expect_hz) * SR)
    vals = []
    t = t0
    while t + frame / SR < t1:
        s = int(t * SR)
        f = yin_f0(x[s:s + frame], fmin=expect_hz / 2.3, fmax=expect_hz * 2.3)
        if f > 0:
            vals.append(f)
        t += 0.05
    return float(np.median(vals)) if vals else 0.0


def cents(f: float, ref: float) -> float:
    return 1200 * math.log2(f / ref) if f > 0 else float("nan")


def midi_hz(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


def onset_index(x: np.ndarray) -> int:
    env = np.abs(x)
    thr = env.max() * 0.03
    i = int(np.argmax(env > thr))
    return max(0, i - int(0.004 * SR))


def rms_db(x: np.ndarray) -> float:
    return 20 * math.log10(max(1e-9, float(np.sqrt(np.mean(x ** 2)))))


def bake_loop(x: np.ndarray, ls: int, le: int, xf: int) -> np.ndarray:
    """Crossfade the end of the loop into the material just before its start, so le -> ls wraps cleanly."""
    y = x.copy()
    w = np.sin(0.5 * np.pi * np.arange(xf) / xf) ** 2
    a = x[le - xf:le]
    b = x[ls - xf:ls]
    y[le - xf:le] = a * np.sqrt(1 - w) + b * np.sqrt(w)
    return y


# ---------------------------------------------------------------- formant voice

def lowpass_fir(cut: float, fs: float, taps: int = 255) -> np.ndarray:
    n = np.arange(taps) - (taps - 1) / 2
    h = np.sinc(2 * cut / fs * n) * np.blackman(taps)
    return h / h.sum()


def render_voice(midi: int, spec: dict, dur: float = 2.6, seed: int = 0) -> np.ndarray:
    """Source-filter sung /a/: LF-like glottal pulse with vibrato and jitter, aspiration noise,
    parallel formant bank applied in the frequency domain, radiation, soft onset."""
    rng = np.random.default_rng(seed + midi)
    os_ = 4
    fs = SR * os_
    n = int(dur * fs)
    t = np.arange(n) / fs
    f0 = midi_hz(midi)
    # vibrato: 5.5 Hz, depth ramps to +-25 cents from 0.25 s to 0.7 s; slow drift +-3 cents
    vib_depth = 25 * np.clip((t - 0.25) / 0.45, 0, 1)
    drift = 3 * np.interp(t, np.linspace(0, dur, 8), rng.uniform(-1, 1, 8))
    jitter = np.interp(t, np.linspace(0, dur, int(dur * 40)), rng.normal(0, 1.5, int(dur * 40)))
    # slight scoop into the note in the first 80 ms (-20 cents), as singers do
    scoop = -20 * np.clip(1 - t / 0.08, 0, 1)
    c = vib_depth * np.sin(2 * np.pi * 5.5 * t) + drift + jitter + scoop
    f = f0 * 2 ** (c / 1200)
    phase = np.cumsum(f / fs) % 1.0
    # open quotient: higher voices more open (softer source)
    oq = 0.55 if f0 < 200 else (0.62 if f0 < 400 else 0.7)
    tp, tn = oq * 0.72, oq * 0.28
    g = np.where(phase < tp, 0.5 * (1 - np.cos(np.pi * phase / tp)),
                 np.where(phase < tp + tn, np.cos(0.5 * np.pi * (phase - tp) / tn), 0.0))
    dg = np.diff(g, prepend=0.0) * fs / (2 * np.pi * f0)  # glottal flow derivative (includes lip radiation)
    # aspiration: noise gated by the open phase
    noise = rng.normal(0, 1, n) * (0.25 + 0.75 * g) * 0.035
    src = dg + noise
    # decimate to SR
    h = lowpass_fir(0.45 * SR, fs)
    src = np.convolve(src, h, mode="same")[::os_]
    m = len(src)
    # formant bank (parallel resonators), applied as a magnitude response with zero phase over the whole note
    nfft = 1 << int(math.ceil(math.log2(m + SR)))
    freqs = np.fft.rfftfreq(nfft, 1 / SR)
    H = np.ones_like(freqs, dtype=complex)
    # cascade of all-pole resonators (Klatt style): unity gain at 0 Hz, so the fundamental keeps its
    # natural strength and the formant levels follow from the formant spacing
    for k, (fk, bk) in enumerate(zip(spec["f"], spec["bw"])):
        fk = float(fk)
        # soprano/mezzo formant tuning: F1 rises to sit just above f0 when f0 approaches it
        if k == 0 and f0 * 1.05 > fk:
            fk = f0 * 1.1
        q = fk / bk
        r = freqs / fk
        H *= 1 / (1 - r ** 2 + 1j * r / q)
    # gentle high-frequency roll-off above 5 kHz so the bank does not ring at the top
    H *= 1 / (1 + (freqs / 6000) ** 4)
    y = np.fft.irfft(np.fft.rfft(src, nfft) * H, nfft)[:m]
    # onset envelope: 70 ms rise, breathy start
    env = np.clip(np.arange(m) / (0.07 * SR), 0, 1) ** 1.5
    y *= env
    return y


# ---------------------------------------------------------------- build

def fetch(cache: str) -> None:
    os.makedirs(cache, exist_ok=True)

    def curl(url: str, dest: str) -> None:
        if os.path.exists(dest) and os.path.getsize(dest) > 0:
            return
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        subprocess.run(["curl", "-sS", "--fail", "-m", "120", "-o", dest, url], check=True)

    for tgz, sub in ((TINY_TGZ, "tiny"), (SALAMANDER_TGZ, "salamander")):
        dest = os.path.join(cache, sub + ".tgz")
        curl(tgz, dest)
        outdir = os.path.join(cache, sub)
        if not os.path.isdir(outdir):
            with tarfile.open(dest) as tf:
                members = [mm for mm in tf.getmembers() if mm.isfile() and ".." not in mm.name and not mm.name.startswith("/")]
                tf.extractall(outdir, members=members, filter="data")
    for sid, s in SETS.items():
        if s["src"] != "fluid":
            continue
        for m in s["notes"]:
            nm = note_name(m, NAMES_FLAT)
            curl(f"{FLUID}/{s['gm']}-mp3/{nm}.mp3", os.path.join(cache, "fluid", s["gm"], nm + ".mp3"))
    print("fetched into", cache)


def source_path(cache: str, sid: str, s: dict, m: int) -> str:
    if s["src"] == "vsco":
        return os.path.join(cache, "tiny", "package", "samples", s["dir"], note_name(m, NAMES_SHARP_S) + ".mp3")
    if s["src"] == "fluid":
        return os.path.join(cache, "fluid", s["gm"], note_name(m, NAMES_FLAT) + ".mp3")
    if s["src"] == "salamander":
        return os.path.join(cache, "salamander", "package", "audio", note_name(m, NAMES_SHARP) + "v8.mp3")
    raise ValueError(sid)


def process_sustain(x: np.ndarray, f0: float) -> tuple[np.ndarray, float, float]:
    """Trim to 2.1 s with a baked loop of whole periods between about 0.9 s and 1.9 s."""
    ls = int(0.9 * SR)
    periods = max(1, round(0.95 * f0))
    le = ls + int(round(periods * SR / f0))
    xf = int(0.12 * SR)
    end = le + int(0.06 * SR)
    if len(x) < end:
        x = np.concatenate([x, np.zeros(end - len(x))])
    y = bake_loop(x, ls, le, xf)[:end]
    tail = int(0.06 * SR)
    y[-tail:] *= np.linspace(1, 0, tail)
    return y, ls / SR, le / SR


def process_decay(x: np.ndarray, max_len: float) -> np.ndarray:
    end = min(len(x), int(max_len * SR))
    y = x[:end].copy()
    fade = int(0.35 * SR)
    y[-fade:] *= np.cos(0.5 * np.pi * np.arange(fade) / fade) ** 2
    return y


def level(y: np.ndarray, kind: str) -> tuple[np.ndarray, float]:
    seg = y[int(0.15 * SR):int(0.8 * SR)] if kind == "sustain" else y[:int(0.6 * SR)]
    g = 10 ** ((RMS_TARGET_DB - rms_db(seg)) / 20)
    peak = np.abs(y).max() * g
    if peak > 10 ** (PEAK_MAX_DB / 20):
        g *= 10 ** (PEAK_MAX_DB / 20) / peak
    return y * g, 20 * math.log10(g)


def build(cache: str, repo: str) -> None:
    out_root = os.path.join(repo, "public", "sounds")
    manifest: dict = {
        "version": 1,
        "format": {"container": "mp3", "sampleRate": SR, "channels": 1, "kbps": KBPS},
        "notes": "MIDI numbers are sounding pitch. tune is the measured offset of the sample from its MIDI note, in cents; "
                 "the sampler plays at rate 2^((target - midi - tune/100)/12). loopStart/loopEnd are seconds from the first "
                 "decoded sample, onset is where the sound starts (the sampler compares it with its own decode to correct "
                 "for decoders that keep the MP3 priming).",
        "sources": SOURCES,
        "sets": {},
        "instruments": {},
    }
    report = []
    for sid, s in SETS.items():
        samples = []
        for m in s["notes"]:
            x = decode(source_path(cache, sid, s, m))
            x = x[onset_index(x):]
            f = median_f0(x, 0.25, min(1.5, len(x) / SR - 0.1), midi_hz(m))
            tune = cents(f, midi_hz(m))
            if s["kind"] == "sustain":
                y, ls, le = process_sustain(x, f if f > 0 else midi_hz(m))
            else:
                y, ls, le = process_decay(x, s.get("maxLen", 2.5)), None, None
            y, gain_db = level(y, s["kind"])
            fn = f"{note_name(m, NAMES_SHARP_S)}.mp3"
            encode(y, os.path.join(out_root, sid, fn))
            entry = {"file": fn, "midi": m, "tune": round(tune, 1), "onset": 0.004}
            if ls is not None:
                entry["loopStart"] = round(ls, 5)
                entry["loopEnd"] = round(le, 5)
            entry["duration"] = round(len(y) / SR, 3)
            samples.append(entry)
            report.append((sid, m, round(tune, 1), round(gain_db, 1)))
        manifest["sets"][sid] = dict(source=s["src"], kind=s["kind"], range=s["range"], attack=s["attack"],
                                     release=s["release"], samples=samples)
        print(sid, "ok", [(r[1], r[2]) for r in report if r[0] == sid])
    for vid, v in VOICES.items():
        lo, hi = v["range"]
        notes = list(range(lo, hi + 1, VOICE_STEP))
        if hi - notes[-1] > VOICE_STEP // 2:
            notes.append(hi)
        samples = []
        for m in notes:
            x = render_voice(m, v)
            x = x[onset_index(x):]
            # loop on whole vibrato cycles: 4 cycles of 5.5 Hz starting at 0.9 s
            ls = int(0.9 * SR)
            le = ls + int(round(4 / 5.5 * SR))
            y = bake_loop(x, ls, le, int(0.15 * SR))[:le + int(0.06 * SR)]
            y[-int(0.06 * SR):] *= np.linspace(1, 0, int(0.06 * SR))
            y, _ = level(y, "sustain")
            fn = f"{note_name(m, NAMES_SHARP_S)}.mp3"
            encode(y, os.path.join(out_root, vid, fn))
            samples.append({"file": fn, "midi": m, "tune": 0.0, "onset": 0.004, "loopStart": round(ls / SR, 5),
                            "loopEnd": round(le / SR, 5), "duration": round(len(y) / SR, 3)})
        manifest["sets"][vid] = dict(source="formant", kind="sustain", range=v["range"], attack=0.07, release=0.25,
                                     vowel="ah", samples=samples)
        print(vid, "ok", notes)
    for iid, sid in INSTRUMENT_MAP.items():
        e = {"set": sid}
        if iid in SUBSTITUTES:
            e["substitute"] = SUBSTITUTES[iid]
        manifest["instruments"][iid] = e
    manifest["alternates"] = {"voice": "choir-aah"}
    # sizes
    total = 0
    for sid in manifest["sets"]:
        d = os.path.join(out_root, sid)
        b = sum(os.path.getsize(os.path.join(d, f)) for f in os.listdir(d))
        manifest["sets"][sid]["bytes"] = b
        total += b
    manifest["totalBytes"] = total
    with open(os.path.join(out_root, "index.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)
        fh.write("\n")
    print("total bytes", total)


# ---------------------------------------------------------------- check (offline render through the sampler design)

def sampler_render(buf: np.ndarray, smp: dict, target: float, dur: float, attack: float, release: float) -> np.ndarray:
    """Python twin of the sampler in 02-sounds.md: nearest sample, rate shift, native-style loop, envelope."""
    rate = 2 ** ((target - smp["midi"] - smp["tune"] / 100) / 12)
    n = int((dur + release) * SR)
    pos = np.zeros(n)
    p = 0.0
    ls = smp.get("loopStart")
    le = smp.get("loopEnd")
    ls_i = ls * SR if ls is not None else None
    le_i = le * SR if le is not None else None
    for i in range(n):
        pos[i] = p
        p += rate
        if le_i is not None and p >= le_i:
            p -= (le_i - ls_i)
    pos = np.clip(pos, 0, len(buf) - 2)
    i0 = pos.astype(int)
    fr = pos - i0
    y = buf[i0] * (1 - fr) + buf[i0 + 1] * fr
    t = np.arange(n) / SR
    env = np.clip(t / attack, 0, 1)
    rel = np.clip(1 - (t - dur) / release, 0, 1) if release > 0 else (t < dur)
    env = env * np.where(t < dur, 1.0, rel)
    if le is None:
        y = np.where(pos >= len(buf) - 2, 0.0, y)
    return y * env


def nearest(samples: list[dict], target: float) -> dict:
    return min(samples, key=lambda s: (abs(s["midi"] - target), s["midi"] < target))


def check(repo: str) -> None:
    root = os.path.join(repo, "public", "sounds")
    man = json.load(open(os.path.join(root, "index.json")))
    rows = []
    worst = 0.0
    for sid, st in man["sets"].items():
        lo, hi = st["range"]
        mid = (lo + hi) // 2
        for target in (lo, mid, hi):
            smp = nearest(st["samples"], target)
            buf = decode(os.path.join(root, sid, smp["file"]))
            dur = 3.0 if st["kind"] == "sustain" else 1.5
            y = sampler_render(buf, smp, target, dur, st["attack"], st["release"])
            f = median_f0(y, 0.3, dur - 0.1, midi_hz(target))
            err = cents(f, midi_hz(target))
            # loop click: largest sample-to-sample jump across the wrap vs the median jump
            click = ""
            if "loopEnd" in smp:
                a = int(smp["loopEnd"] * SR) - 1
                b = int(smp["loopStart"] * SR)
                jump = abs(buf[b] - buf[a])
                typ = float(np.percentile(np.abs(np.diff(buf[b - 4000:b + 4000])), 99)) + 1e-9
                click = f"{jump / typ:.2f}"
            spec = np.abs(np.fft.rfft(y[int(0.3 * SR):int(1.3 * SR)] * np.hanning(SR)))
            fr = np.fft.rfftfreq(SR, 1 / SR)
            centroid = float((spec * fr).sum() / spec.sum())
            # strongest peak within +-1 semitone of f0, 2 f0, 3 f0: is the fundamental present?
            def band(hz: float) -> float:
                m = (fr > hz * 0.94) & (fr < hz * 1.06)
                return 20 * math.log10(spec[m].max() / spec.max() + 1e-12)
            on = onset_index(buf) / SR
            rows.append((sid, target, smp["midi"], round(err, 1), round(band(midi_hz(target)), 1), round(centroid), click,
                         round(on * 1000, 1)))
            if not math.isnan(err):
                worst = max(worst, abs(err))
    print("set | target | sample | f0 error cents | fundamental dB re peak | centroid Hz | loop jump / p99 step | onset ms")
    for r in rows:
        print(" | ".join(str(v) for v in r))
    print("worst |f0 error| cents:", round(worst, 1))


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "fetch":
        fetch(sys.argv[2])
    elif cmd == "build":
        build(sys.argv[2], sys.argv[3])
    elif cmd == "check":
        check(sys.argv[2])
    else:
        raise SystemExit(__doc__)
