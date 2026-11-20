# Round 2: detection

Role: detection engineer (pitch tracking, note segmentation, score following).
Scope: the owner's reports (a) "when it starts, it plays a tone and puts purple marks on the screen" and (b) "it seems to be hearing my notes and construing them as separate notes, like maybe my voice is trailing". Plus a diagnostics trace for every try.
Owns: `src/dsp`, `src/follow`, `src/testkit/untrained`, the `grading.detection` config, the session's capture gating and trace, `tools/diagnostics`. No screen or copy changes.

## Summary

1. The purple marks at the start are the starting-pitch reference. The session starts the microphone while the reference plays through the speakers, the mic hears it, and the follower draws each reference tone as an extra ghost before bar 1. Fixed: nothing before the first written note's window is judged or drawn, and the app's own tones and clicks are known to the follower.
2. Real singing. A new untrained-voice performer model reproduces the owner's report: 1.31 detected notes per sung note and 0.31 extra marks drawn per written note. After the fixes: 1.01 and 0.015. All 195 existing gates keep their status (194 pass, the voice room F1 limit of PLAN R54 is unchanged).
3. Every try now keeps a compact trace, the last 20 are stored on the device, and one call exports a try as a JSON file. The microphone audio is in it only if the player turns that on. `tools/diagnostics/replay.ts` re-runs a try from the file.

## 1. The tone and the purple marks at the start

### What happens

For voice, `beginTake` plays the reference (tonic triad, then the first note) and then, while it is still sounding, starts capture and schedules the count-in. Capture blocks queue in the DSP worker until its config arrives and are then analysed. The reference is a pure tone at -6 dBFS through the click bus. On built-in speakers the mic hears it. The segmenter finds four clean notes, the follower has no written note near them, and each becomes an extra. After 100 ms each is drawn as an extra ghost, and ghosts are purple (`colors.ghost`). Their score position is 9 to 11 beats before bar 1, so the overlay puts them at the start of the first line.

The count-in clicks did not make marks on speakers: click subtraction and the click time gate handle them. Without them (a speaker route reported as headphones) a click can start a short note.

### Reproduction

`FakeAudioBackend` now plays back what the app plays: `loopback.toneGainDb` mixes every `playTone` into the capture at the room delay, as the real backend renders it (sine, 10 ms fades), including tones scheduled before capture starts. With a baritone, difficulty 1, speakers, and bleed at -10, -20 and -30 dB, every level gave the same result before the fix: 4 extra ghosts (F3, A3, C4 and the first note) at score beats -11.2 to -9.5, one per reference tone. After the fix: none.

### Fix

- `FollowConfig.judgeFromScoreSec`: the first written note's onset minus its match window. A note that starts earlier gets no event at all, is not an extra and is left out of the final alignment and the stored detected notes.
- `FollowConfig.ownPlayback`: the app's own sounds at their scheduled times (the reference tones and every click). A note that starts inside a tone, plus a 200 ms room tail, at the tone's pitch class is the tone. An unmatched note that starts at a click is drawn and counted as an extra only once it has sounded 150 ms. A sung note on the beat still matches as before.
- The session fills both (`withOwnPlayback` in `src/follow/own-playback.ts`). The gate runner does the same, so the gates exercise it.
- Config: `grading.detection.ownPlayback` (`tailMs` 200, `clickMaxMs` 150, `toneCents` 70).

The DSP still analyses the reference and the count-in: the noise floor and the count-in recheck need that audio. Only the follower's view changes.

The UX plan (01-ux.md item 10) gives the reference its own labelled moment. That is a screen change; this fix holds whatever the screen does.

Tests: `src/session/practice-session.test.ts` "own playback in the capture" (three bleed levels, and a silent take where nothing may be detected), `src/follow/one-note.test.ts` "own playback".

## 2. Real singing

### How an untrained baritone differs from the synthetic voice

| Real singing | P3 synthetic voice | What it did to the detector |
| --- | --- | --- |
| Scoops into the note from 60 to 250 c below over 60 to 200 ms | Starts on pitch | The scoop became its own note, matched to the written note with the wrong pitch (a red flash). The note after the scoop became an extra ghost. This was most of the problem. |
| Drift of 10 to 20 c inside a note | Fixed pitch | Small, but it adds to vibrato |
| Wide, irregular vibrato, 25 to 70 c, 4 to 7 Hz | Regular, at most 30 c, 5 to 6 Hz | Not a cause on its own at changeCents 80 |
| Breathy onsets, consonants ("da", "la") | Clean attacks | Noise before the voice; harmless once the noise floor is right |
| Ends that fall or wobble 40 to 200 c while the level dies | Clean release | The tail was split off as a short note at a lower pitch, drawn as an extra while it sounded |
| Breaths between notes, syllable dips of 4 to 15 dB | Short glottal dips | Same-pitch repeats with a dip at low level can merge (see "Left open") |
| Low level, -38 to -26 dBFS | -18 dBFS | Less headroom above the noise floor |
| Creaky onsets on low notes | None | No effect measured |
| Laptop mic rolls off below about 200 Hz, so 98 to 196 Hz fundamentals are weak | Full fundamental | No octave errors measured: 0 of 497 notes at or below G3 |

### The untrained-voice condition

`src/testkit/untrained/voice.ts` sings every written note once, on pitch (within 20 c), with timing jitter of about 22 ms, and draws per note: scoops (55%), drift, vibrato on longer notes (50%), breathy onsets (40%), consonants (30%), wobbling releases before breaths (75%), creak on low notes (35%), syllable dips between joined notes. The take level is -38 to -26 dBFS over a -66 to -56 dBFS noise floor, through a 4th-order high-pass at 180 to 260 Hz. `src/testkit/untrained/run.ts` draws 40 takes from the shipped corpus at difficulties 1 to 5, mostly baritone and bass, as speaker takes with click bleed at -20 dB, and runs them through the production path (DSP worker core, live follower, final alignment). Every extra, wrong pitch and missed note is false.

`pnpm gates` now runs it and reports it as its own non-blocking gate in `docs/accuracy-report.md` and `tools/gates/artifacts/accuracy.json` (`untrainedVoice`). Targets: at most 0.05 extra ghosts drawn and 0.05 final extras per written note, at most 3% false wrong pitch and 3% false missed.

### Before and after

40 takes, 1052 written notes. Before is the same code with the new rules turned off.

| Metric | Before | After |
| --- | --- | --- |
| Detected notes per written note | 1.307 | 1.010 |
| Extra ghosts drawn live, per written note | 0.309 | 0.015 |
| Final extras, per written note | 0.012 | 0.000 |
| Notes shown wrong pitch live at some point | 30.9% | 1.7% |
| False wrong pitch (final) | 0.29% | 0.48% |
| False missed (final) | 0.86% | 0.86% |
| Read an octave off | 0.00% | 0.00% |
| Gate | fail | pass |

By difficulty: 1 to 3 (8 takes): extra ghosts 0.239 to 0.016 per note. 4 to 5 (32 takes): 0.324 to 0.015. The shipped corpus has few difficulty 1 to 3 voice excerpts, so that row is small.

### What changed

Detector (`src/dsp/segmenter.ts`, voice only, through `DspConfig.oneNote`):

- Scoop. A pitch change within `scoopMs` of the onset re-pitches the note and does not split it. This applies only when every frame so far lies on one side of the new pitch and the note never held a pitch of its own. "Held" means `plateauMs` with every frame within `plateauCents`. A slow scoop starts flat and can look held, so the rule also accepts frames that glide towards the new pitch and end within `changeCents` of it.
- Written onsets. A pitch change that reaches the next written onset is always a new note. Fast slurred notes have no room for a plateau. This needs the onsets, so `DspConfig.onsetHints` now carries them, as `repeatHints` carries the repeats.
- Release. A pitch change whose confirming frames all lie `tailDropDb` below the note's loudest frame, and do not get louder, is the note dying away. Its frames stay out of the note. It is decided at the same frame as before, so a real change is not delayed (a first version that held such frames back raised the 512-window latency p95 to 60.3 ms).

Follower (`src/follow`, through `FollowConfig.oneNote`):

- No wrong pitch at confirmation (`wrongAtConfirm` false). The pitch waits for the steady part (80 ms), as sharp and flat already do. A scoop no longer flashes red.
- An unmatched note is drawn and counted as an extra only once it has sounded `extraMinMs`. That is 200 ms at difficulties 1 to 3, against 02 §4.1's 100 ms.
- Absorbed. An unmatched note that starts within `absorbGapMs` of the end of the last matched note, at the same pitch class, is that note sung on. It needs `absorbMs` before it is drawn or counted.
- The final alignment's DP keeps the 02 §4.1 skip rule. The raised lengths only decide which unmatched notes are reported as extras, so a short written note is never easier to skip.

Octave errors: none measured on the model, so no new correction. The analyser's octave hysteresis and the follower's score-informed correction hold. An octave is correct for voice anyway (R7). The report keeps an "Read an octave off" column so a real recording that shows them is visible.

### Configuration

All in `config/grading-config.json` under `detection` (schema regenerated from `GradingConfig` in `src/core/types.ts`; `rules/resolveOneNote` picks the row). Only the voice profile has rows. Other profiles keep the 01 §7.5 segmenter and the 02 §4.1 extras rule.

| Difficulty | scoopMs | plateauMs | plateauCents | tailDropDb | wrongAtConfirm | extraMinMs | absorbMs | absorbGapMs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 to 3 | 250 | 60 | 35 | 12 | false | 200 | 350 | 120 |
| 4 to 6 | 220 | 60 | 35 | 12 | false | 170 | 300 | 100 |
| 7 to 10 | 180 | 60 | 35 | 12 | false | 140 | 250 | 80 |

Plus `detection.ownPlayback` (section 1).

### Existing gates

`pnpm gates`: 194 of 195 pass, 0 blocking, the same as before. The one failure is still voice room F1 (PLAN R54), now 0.8926 (it was 0.8870). Voice planned false extras per take fell from 2.12 to 0.70, and click-induced extras fell from 3 to 0. The clean and device voice rows are unchanged. Other instruments' clean and device rows are unchanged. Their planned false extras are a little lower because of the click rule. The 512-window latency p95 is 59.48 ms, as before. The tip-precision rows moved by one or two takes per pattern and all pass.

### Left open

- Same-pitch repeats joined by a 10 to 15 dB syllable dip at low level are sometimes merged (0.86% false missed, mostly at difficulties 1 to 3). The dip reaches the noise band, and an attack out of the floor must rise 15 dB above it. That is an old rule and changes for every instrument, so it is not touched here.
- The model is a model. The first real recording from the owner, exported with audio, should be replayed and its rows added to `src/testkit/untrained` as a fixed case.
- Only 8 of the 40 takes are at difficulties 1 to 3, because the shipped corpus has few voice excerpts there.

## 3. Diagnostics per try

### What a trace holds

`src/session/diagnostics.ts`, built at the end of every try (`TryTrace`, plain JSON):

- settings, excerpt, end reason, route and audio environment, the calibration used and the count-in recheck;
- the DSP and follow configs as the worker got them, without the shared configs (the replay loads those);
- the app's own playback: reference tones, count-in clicks, and the number of take clicks;
- pitch, clarity and level per analysis frame, decimated to about 50 Hz;
- every detected note (onset, offset, kind, pitch, clarity), marked when the follower ignored it;
- follower events with the session clock when they arrived (clock and level events left out);
- final judgments, extras, displaced runs, score and patterns, gate failures and dropped blocks.

Size: under 5 KB per second of capture without audio, so a 30 s try stays well under 200 KB (tested).

### Audio, opt-in

A device-local setting, off by default: `includeAudio`. When it is on, the worker keeps the analysed low band (16 kHz mono, as the detector hears it) and the trace stores it as 16-bit PCM in base64, about 43 KB per second. This is the one exception to the no-stored-audio ruling (PLAN 9): for the export only, local, explicit, never automatic. Audio is kept on the newest 5 traces only.

### Storage

Device-local `kv` keys under `diag:` (`isReservedKvKey` now covers the prefix): never in the backup export, kept on import, deleted by "Delete all data". The last 20 tries are kept. A failure to store a trace never touches the try or its record.

### Session methods (for the UI package)

On `PracticeSession`:

- `exportLastTry(): Promise<{ fileName; text; file } | null>`: the last try as one JSON file (`text`), with a file name such as `sightread-diagnostics-1a2b3c4d.json`.
- `exportAttempt(attemptId): Promise<{ fileName; text; file } | null>`: the same for a stored attempt. Null once its trace has left the last 20.
- `diagnosticsAttemptIds(): Promise<string[]>`: attempts that still have a trace, oldest first.
- `diagnosticsSettings(): Promise<{ includeAudio }>` and `setDiagnosticsSettings({ includeAudio })`: the opt-in. It applies from the next try.
- `diagnosticsError`: the last failure to store a trace, for the dev screens.

The types and helpers are exported from `src/session/index.ts` (`TryTrace`, `DiagnosticsFile`, `DiagnosticsStore`, `decodePcm16`).

### Replay

```sh
pnpm exec tsx tools/diagnostics/replay.ts sightread-diagnostics-1a2b3c4d.json [--try N] [--fixture out.json]
```

It rebuilds the configs with the current `config/` files. With audio, it re-runs the DSP worker core, so segmenter and follower changes both count. Without audio, it re-runs the live follower and the final alignment on the traced notes. It prints one row per written note: the stored verdict, the replayed verdict (marked `≠` when they differ), and the detected notes near it with pitch and length. Then it lists the extras. `--fixture` writes the inputs and verdicts as JSON, the start of a regression test. `tools/diagnostics/replay.test.ts` traces a synthetic untrained try and checks that both replays reproduce its verdicts.

## Files

- Config and types: `config/grading-config.json` (`detection`), `schemas/grading-config.schema.json`, `src/core/types.ts` (`FollowConfig.judgeFromScoreSec`, `ownPlayback`, `oneNote`; `DspConfig.oneNote`, `onsetHints`, `traceAudio`; `OwnSound`, `OneNoteBand`, `OneNoteTolerance`), `src/core/platform.ts` (`WorkerTrace`, 'done'.trace), `src/rules/one-note.ts`.
- Detector: `src/dsp/segmenter.ts`, `src/dsp/segmenter-options.ts`, `src/dsp/pipeline.ts`.
- Follower: `src/follow/own-playback.ts` (new), `src/follow/live-follower.ts`, `src/follow/final-align.ts`.
- Worker: `src/platform/web/audio/dsp-worker-core.ts` (player notes only in 'done'.detected; the trace).
- Session: `src/session/practice-session.ts` (own sounds, onset hints, trace, methods), `src/session/take-plan.ts`, `src/session/diagnostics.ts` (new), `src/store/keys.ts` (`diag:` is device-local).
- Testkit and tools: `src/testkit/fake-backend.ts` (tone bleed), `src/testkit/untrained/` (new), `src/testkit/gates/run-take.ts`, `tools/gates/run.ts`, `tools/diagnostics/replay.ts` (new).
- Tests: `src/session/practice-session.test.ts` (own playback, diagnostics), `src/session/diagnostics.test.ts`, `src/dsp/one-note.test.ts`, `src/follow/one-note.test.ts`, `src/testkit/untrained/untrained.test.ts`, `tools/diagnostics/replay.test.ts`.
