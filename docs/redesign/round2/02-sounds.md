# Instrument and voice sounds

The owner asked to hear "the right timbre for voice and the instruments" when choosing an instrument. This note picks a source for every instrument, records the licence checks, and specifies the small sampler that plays them for four jobs:

- (a) the range preview in the instrument picker,
- (b) the starting-pitch reference,
- (c) Listen playback of an excerpt,
- (d) the "match a note" warm-up.

Everything is built. The files are in `public/sounds/` and the manifest is `public/sounds/index.json`. You can hear them on `docs/redesign/round2/sounds-demo.html`. `docs/redesign/round2/sounds-build/build.py` rebuilds them all. Nothing in `src/` is changed yet.

## Summary

| Source | Licence | Used for |
|---|---|---|
| VSCO-2 Community Edition (Versilian Studios), using the CC0 edits in `tiny-orchestra` 0.2.0 | CC0 1.0 | Flute, clarinet, trumpet, oboe, bassoon, tuba, double bass |
| Fluid (R3) GM SoundFont (Frank Wen), using the per-note renders in `gleitz/midi-js-soundfonts` | MIT (soundfont); the renders are published as CC BY 3.0 | Violin, viola, cello, alto, tenor and baritone sax, horn, trombone (also used for euphonium), guitar, plus a choir "aah" kept for comparison |
| Salamander Grand Piano V3 (Alexander Holm), using `@audio-samples/piano-mp3-velocity8` 1.0.5 | CC BY 3.0 | Piano (right and left hand) |
| Formant voice made by this project's build script | CC0 (our own work) | Soprano, mezzo, alto, tenor, baritone and bass voice |

- Size: 148 files, 1,787,422 bytes (1.75 MB) in all, against a 3 MB budget. One instrument loads 58 to 144 KB.
- Nothing is in the initial bundle. The service worker precaches only `js, css, html, woff2, png, svg` and the web manifest, so the MP3s and `index.json` are fetched only when an instrument is first used.
- Not found: a real solo voice under an acceptable licence, and any free euphonium samples. The voices are synthesised (see below). Euphonium uses trombone samples.

## Licence checks

Each licence was read in the source repository or package itself, not taken from a listing.

- **VSCO-2 CE.** `https://raw.githubusercontent.com/sgossner/VSCO-2-CE/master/LICENSE` is the CC0 1.0 Universal legal code. The README credits "Recorded by Sam Gossner & Simon Dalzell; Sample Cutting by Elan Hickler/Soundemote".
  - `tiny-orchestra` 0.2.0 (npm, Marian Becher) is licensed CC0-1.0. Its `LICENSE` is the CC0 legal code. Its `CREDITS.md` says every sample is a trimmed, mono, loudness-matched MP3 excerpt of VSCO-2 CE. It maps each folder; for example, `Woodwinds/Flute/susNV` becomes `flute`.
  - Its build script (`scripts/instruments.ts` in the GitHub repository) names the exact VSCO folders. It also measures pitch to fix VSCO's file names, which are an octave off.
  - We used these edits because the GitHub API and codeload are blocked from here. Without them we cannot list or fetch the upstream folders.
  - Licence file: `LICENSES/CC0-1.0.txt`, which was already present.
- **Fluid R3.** The original COPYING and README are reproduced in MuseScore's `share/sound/FluidR3Mono_License.md` (tag v3.6.2). They say: "Copyright (c) 2000-2002, 2008 Frank Wen … I hereby release Fluid under the MIT license".
  - The per-note MP3s come from `gleitz/midi-js-soundfonts`. Its README says the Fluid renders are "Released under Creative Commons Attribution 3.0 license", and its `LICENSE.txt` is MIT for the repository.
  - To cover both, we include the MIT notice and the CC BY 3.0 text, and we credit both Frank Wen and Benjamin Gleitzman.
  - We did not use the MusyngKite and FatBoy sets from the same repository, because they are CC BY-SA.
  - Licence files: `LICENSES/MIT-FluidR3.txt` (new) and `LICENSES/CC-BY-3.0.txt` (new; the SPDX copy of the legal code).
- **Salamander Grand Piano V3.** The README of `sfzinstruments/SalamanderGrandPiano` says: "This work is licensed under a Creative Commons Attribution 3.0 Unported License".
  - The npm package `@audio-samples/piano-mp3-velocity8` says "Samples license: CC BY 3.0, Author: Alexander Holm". Its own MIT `LICENSE` covers only its code (Jan Forst).
  - Licence file: `LICENSES/CC-BY-3.0.txt`.
- **Rejected or not reachable:**
  - University of Iowa MIS and freepats: their hosts are blocked from here, so the terms could not be verified. We did not use them.
  - VCSL (CC0): it was checked, but no voice or saxophone folder could be confirmed without a directory listing.
  - `@minicut/music-samples-*`: unprocessed VSCO WAVs only (horn, trombone, tuba, upright piano, string sections). This adds nothing over the above.
  - MusyngKite and FatBoy: CC BY-SA.
  - The VSCO upright piano (CC0) could replace Salamander if we wanted no attribution at all. Its files are numbered rather than named, so each would need a pitch-measured mapping.

## Files and note sets

All MIDI numbers are **sounding** pitch. The app must convert written pitch to sounding pitch before it plays (for example, tenor voice −12, B♭ clarinet −2, alto sax −9). Notes are spaced 6 to 9 semitones apart, so no note is shifted more than about 4.5 semitones. Voices are spaced every 4 semitones, so a voice note shifts at most 2.

| Set (folder) | Used by app ids | Samples (MIDI) | Range covered | Kind | Size |
|---|---|---|---|---|---|
| flute | flute | 60 69 76 84 93 | 60–96 | loop | 59 KB |
| clarinet | clarinet-bb | 50 58 65 74 82 89 | 50–89 | loop | 70 KB |
| sax-alto | sax-alto | 49 57 65 73 81 | 49–81 | loop | 59 KB |
| trumpet | trumpet-bb | 53 60 67 74 81 | 52–82 | loop | 59 KB |
| violin | violin | 55 63 71 79 87 95 | 55–100 | loop | 70 KB |
| cello | cello | 40 48 56 64 72 80 | 40–81 | loop | 70 KB |
| piano | piano-rh, piano-lh | 36 45 54 63 72 81 90 96 | 36–96 | one-shot, 3.0 s | 144 KB |
| voice-soprano | voice-soprano | 57 61 65 69 73 77 81 84 | 57–84 | loop | 83 KB |
| voice-mezzo | voice-mezzo | 55 59 63 67 71 75 79 | 55–81 | loop | 72 KB |
| voice-alto | voice-alto | 52 56 60 64 68 72 76 | 52–77 | loop | 72 KB |
| voice-tenor | voice-tenor | 45 49 53 57 61 65 69 | 45–69 | loop | 72 KB |
| voice-baritone | voice-baritone | 43 47 51 55 59 63 67 | 43–67 | loop | 72 KB |
| voice-bass | voice-bass | 40 44 48 52 56 60 64 | 40–65 | loop | 72 KB |
| sax-tenor | sax-tenor | 44 52 60 68 76 | 44–76 | loop | 59 KB |
| sax-bari | sax-bari | 36 44 52 60 68 | 36–69 | loop | 58 KB |
| oboe | oboe | 58 65 74 82 89 | 58–91 | loop | 59 KB |
| bassoon | bassoon | 34 41 48 55 63 72 | 34–76 | loop | 70 KB |
| horn | horn-f | 35 42 49 56 63 70 77 | 35–77 | loop | 82 KB |
| trombone | trombone, euphonium-bc, euphonium-tc | 40 47 54 61 68 74 | 40–74 | loop | 70 KB |
| tuba | tuba | 29 34 39 46 53 62 | 26–65 | loop | 70 KB |
| viola | viola | 48 56 64 72 80 88 | 48–88 | loop | 70 KB |
| double-bass | double-bass | 28 34 42 49 59 | 28–62 | loop | 58 KB |
| guitar | guitar | 40 47 54 61 68 75 | 40–71 | one-shot, 2.6 s | 94 KB |
| choir-aah | (comparison only) | 41 48 55 62 69 76 83 | 40–84 | loop | 82 KB |

File names use the note name with `s` for sharp, for example `public/sounds/voice-baritone/Ds3.mp3`. The exact sources:

- **VSCO sets:** `package/samples/<dir>/<Note>.mp3` from `https://registry.npmjs.org/tiny-orchestra/-/tiny-orchestra-0.2.0.tgz`.
- **Fluid sets:** `https://raw.githubusercontent.com/gleitz/midi-js-soundfonts/gh-pages/FluidR3_GM/<gm-name>-mp3/<Note>.mp3`. The GM names are violin, viola, cello, alto_sax, tenor_sax, baritone_sax, french_horn, trombone, acoustic_guitar_nylon and choir_aahs.
- **Piano:** `package/audio/<Note>v8.mp3` from `@audio-samples/piano-mp3-velocity8-1.0.5.tgz`.

## Encoding and processing

The build script does these steps for each sample:

1. Decode with ffmpeg to mono at 44.1 kHz.
2. Trim to 4 ms before the onset.
3. Measure f0 with YIN between 0.25 and 1.5 s. The offset from the nominal note goes into the manifest as `tune`, in cents.
4. **Sustained sounds:** cut to about 2.1 s. Choose a loop from 0.9 s that is about 0.95 s long and a whole number of periods. Bake a 120 ms equal-power crossfade into the loop end, so the wrap from `loopEnd` to `loopStart` is continuous.
5. **Piano and guitar:** keep 3.0 s and 2.6 s, with a 350 ms cos² fade at the end. They are not looped.
6. Normalise to −20 dBFS RMS over the sustain (or over the first 0.6 s of a decaying sound), with a −1 dBFS peak ceiling. Every note and every instrument then plays at about the same level.
7. Encode to MP3, mono, 44.1 kHz, 48 kbit/s CBR (libmp3lame), with no metadata.

Why MP3: every browser decodes it with `decodeAudioData`, including Safari. Opus in Ogg is only recent in Safari.

Measured `tune` values are mostly within ±7 cents. The exceptions:

- Salamander's upper notes are stretch-tuned, by +14 cents at F♯6 and +26 at C7.
- The choir is ±20 to 34 cents, which is ensemble detuning.
- The tuba's F1 is −17 cents over 0.25 to 1.5 s, but its pitch wanders from −30 cents in the attack to +5 in the loop; the manifest now holds −8.2, measured from 0.3 s to the loop end, the part a held note plays (Listen playback review). By the same measure the violin's B6 is now −5.3 (was +0.7) and the choir's C3 −20.6 (was −24.7); every other sustained sample is within 4 cents of its old value.

The sampler corrects all of these.

The CC0 VSCO edits were already MP3 (96 kbit/s), so those sets are encoded twice. At 48 kbit/s mono, with no pitch shift, the second encode should not be audible on laptop speakers. Rebuilding from the original VSCO WAVs needs GitHub listing access, which this sandbox does not have.

## The voices: formant synthesis

No real solo-voice vowel samples were found under an acceptable licence that could be fetched from here. The free General MIDI voice patches are choirs ("choir aahs") or synthetic "voice oohs". So the six voices are **synthesised**, using a source-filter model in `render_voice()`, and rendered offline to the same kind of sample files as the instruments. The app has one playback path.

- **Source.** A glottal flow pulse in the Rosenberg/LF style. Its open quotient is 0.55 below 200 Hz, 0.62 below 400 Hz, and 0.7 above. The model differentiates the pulse to add lip radiation and renders at 4× oversampling, then decimates with a 255-tap windowed-sinc filter.
- **Pitch.** (Revised after the Listen playback review; the first version scooped 20 cents into every note and swung ±25 cents.) The note starts on its pitch, with no scoop. Vibrato is ±8 cents at about 5.5 Hz, ramping in between 0.4 and 0.85 s. A tiny flutter (±0.4 cents) keeps it from sounding machine-steady. Every modulation repeats exactly over the loop.
- **Breath.** Aspiration noise is gated by the open phase, at about −38 dB (was −29 dB). The onset is a 20 ms raised-cosine rise (was 70 ms). The set's attack is 20 ms and its release 0.2 s.
- **Filter.** A cascade (Klatt-style, all-pole) of five resonators for /a/ ("ah"). It has unity gain at 0 Hz, so low notes keep a strong fundamental. A parallel bank was tried first and lost the fundamental, so pitch trackers heard an octave too high. The values in Hz:

  | Voice | F1–F5 | Bandwidths |
  |---|---|---|
  | Bass | 600 1040 2250 2450 2750 | 60 70 110 120 130 |
  | Baritone | 625 1060 2450 2675 3000 | 70 80 115 125 135 |
  | Tenor | 650 1080 2650 2900 3250 | 80 90 120 130 140 |
  | Alto | 800 1150 2800 3500 4950 | 80 90 120 130 140 |
  | Mezzo | 800 1150 2850 3700 4950 | 80 90 120 130 140 |
  | Soprano | 800 1150 2900 3900 4950 | 80 90 120 130 140 |

  The bass, tenor, alto and soprano values are the standard sung-vowel table in the Csound manual. Baritone and mezzo are interpolated. The close F3 to F5 of the male voices give the singer's formant. When f0 nears F1 (high soprano and mezzo notes), F1 is raised to 1.1 × f0, as trained sopranos do.
- **Loop.** The loop starts at 0.9 s and is a whole number of glottal periods (about 0.73 s) and exactly 4 vibrato cycles, with a 150 ms baked crossfade, so the crossfade joins two copies of the same waveform. `build.py voices <repo>` rebuilds only the voices.

How real it sounds: it is clearly a sung "ah" in the right register, with the darker male and brighter female colour. It will not pass for a recorded singer. The comparison row on the demo page plays the Fluid "choir aahs" set. If the owner prefers it, voices can switch to `choir-aah`; the manifest has it under `alternates.voice`. An "oo" vowel only needs a second formant table (bass /u/ ≈ 350 600 2400 2675 2950) and another 70 KB per voice.

## Sampler design

The demo page holds the reference implementation (`SampleSet` in `sounds-demo.html`). `sampler_render()` in `build.py` is a Python version of the same design, used for the offline checks.

1. **Load.** On first use of an instrument, fetch `index.json` (once) and that instrument's set. Decode every sample and keep the AudioBuffers.
   - Measure the onset in the decoded buffer: the first sample above 3% of the peak. Compare it with `onset` in the manifest. The difference, `shift`, covers decoders that keep the 1105-sample MP3 priming. It is added to the start offset and to both loop points.
   - Chromium strips the priming. The measured shift was 0 to 5 ms, which is detector noise.
2. **Pick.** Choose the sample nearest in semitones to the target sounding MIDI note. On a tie, take the sample above, because shifting down sounds more natural than shifting up.
3. **Rate.** `playbackRate = (a4Hz / 440) · 2^((target − sample.midi − sample.tune/100) / 12)`. This follows the player's tuning setting (A4).
4. **Loop.** For `kind: "sustain"`, set `loop = true` with the manifest `loopStart`/`loopEnd` (plus `shift`). Loop points are in buffer time, so they do not change with the playback rate. Notes of any length sustain. One-shots (piano, guitar) play through and stop.
5. **Envelope.** A GainNode does a linear rise over the set's `attack` (2 ms for piano, 15 to 80 ms for others), holds for the note, then ramps linearly to 0 over the set's `release` (0.15 to 0.35 s). The source stops just after the release.
6. **Output.** Route through the existing Listen bus (`LISTEN_BUS_GAIN`, −12 dBFS). Voice count is not limited; at excerpt tempos, at most two notes overlap during a release.

How each job uses it:

- **(a) Picker preview.** Play the instrument's lowest note, a middle note and its highest note, sounding, about 0.6 s each. If the picker shows a tier range for the chosen difficulty, use that range instead. Start loading on hover or focus of the instrument row, so the first click plays at once.
- **(b) Starting pitch.** Play the first note, at the take's tempo, for one beat, on the player's own instrument timbre. This only changes the sound of the existing reference. Whether it plays by itself before the count-in (owner point 10) is a UX decision, not covered here.
- **(c) Listen.** Replace `renderListenNote` with the sampler for each instrument. Keep the current additive tone as the fallback while the set loads, or if a fetch fails or the browser is offline. To play offline, add a runtime cache rule (CacheFirst on `/sounds/`) to the service worker. Precaching them would add 1.75 MB to install.
- **(d) Match a note.** The sampler holds the target note as long as wanted (the loop). Use a longer attack (about 80 ms) so it does not mask the singer's onset.

The microphone hears the speakers. Any of these sounds that overlaps detection will be heard as input (see owner point 10). Gate detection off while the sampler is sounding, plus its release time.

## Checks

**Offline, Python** (`build.py check`). Each set renders the bottom, middle and top of its range through the sampler design, as 3 s held notes (1.5 s for one-shots), from the encoded MP3s.

- **Pitch.** f0 was measured with YIN across the loop. 72 renders were checked, with a worst error of 9.9 cents (tuba at D1, 3 semitones below its lowest sample). The next worst is the violin's top note at −8.9 cents, which is a 5-semitone shift. All other renders are within ±5.1 cents.
- **Fundamental.** The f0 bin is present wherever expected. It is weak (−20 to −50 dB below the strongest partial) at the bottom of the bassoon, oboe, double bass, tuba, viola, trombone and bari sax ranges. That is real instrument behaviour; the strongest partial is the 2nd to 4th harmonic.
- **Voices.** The fundamental is −2 to −17 dB re peak. Spectral centroids are about 1.0 kHz for the low voices and 1.0 to 1.1 kHz for the high ones.
- **Loop wrap.** The step at the wrap is 0.01 to 3.3 times the 99th-percentile sample step around it. That is within the waveform's own range, and the residual is MP3 coding noise, not a step.

**In Chromium** (the demo page's `selfTest()`, run headless with Playwright). It used `decodeAudioData` and an `OfflineAudioContext` with the real `AudioBufferSourceNode` loop and rate. All 72 renders were within 8.8 cents. The worst were tuba D1 (+8.8), violin E7 (−6.1) and soprano C6 (+7.4, measured across vibrato). The priming shift was at most 5 ms.

**Not checked:** listening by ear (this sandbox has no audio output), and Safari's MP3 priming behaviour. The onset-shift step is there for Safari. Someone should play each instrument row on the owner's Mac once.

## Attribution text for the credits page

> **Sounds**
> Woodwind, brass and double bass samples: VS Chamber Orchestra 2 Community Edition by Versilian Studios (Sam Gossner, Simon Dalzell; sample cutting by Elan Hickler), CC0 1.0, as edited by tiny-orchestra (Marian Becher), CC0 1.0.
> String, saxophone, horn, trombone and guitar samples: Fluid (R3) SoundFont © 2000–2002, 2008 Frank Wen, MIT licence; per-note recordings by Benjamin Gleitzman (midi-js-soundfonts), CC BY 3.0.
> Piano: Salamander Grand Piano V3 by Alexander Holm, CC BY 3.0. MP3 edition by Jan Forst.
> Voices: synthesised for this app.
> All samples were trimmed, looped, levelled and re-encoded for this app. Licence texts: LICENSES/CC0-1.0.txt, LICENSES/MIT-FluidR3.txt, LICENSES/CC-BY-3.0.txt.

## Rebuild

```sh
cd /tmp   # not inside the cache
python3 -I docs/redesign/round2/sounds-build/build.py fetch <cache-dir>
python3 -I docs/redesign/round2/sounds-build/build.py build <cache-dir> <repo>
python3 -I docs/redesign/round2/sounds-build/build.py check <repo>
```

To listen: run `pnpm exec vite`, then open `/docs/redesign/round2/sounds-demo.html`. It reads `/sounds/index.json` and `/config/instruments.json`.
