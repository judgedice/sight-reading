# Build plan

This plan merges the five spec sections in `docs/spec/` after two review rounds (drafts, then cross-examination and revision). Where this file and a section disagree, this file wins. Where two sections disagree and this file is silent, the owner named in "Who owns what" wins.

## Product in one paragraph

A web sight-reading trainer. The player picks an instrument, level, key, meter, tempo, and length (any can be random). The app shows an 8 to 12 bar excerpt from real public-domain repertoire, runs a scan timer and a count-in, then listens through the microphone while a metronome plays. Notes are judged live: an early or late note appears on the staff where it was played and the written note turns red; a wrong or out-of-tune note appears as a ghost note at the played pitch and the written note turns red. Each take gets a 0 to 100 score and a letter grade, earns XP toward a rank, and is followed by at most two tips chosen from the errors the player made.

## Who owns what

| Area | Owner | File |
| --- | --- | --- |
| Stack, module boundaries, types, audio pipeline, score following, measurement floors | Architect | `spec/01-architecture.md` |
| Instruments, levels, tolerances, grading, XP, rank, tips | Lead musician | `spec/02-pedagogy-and-grading.md` |
| Sources, licences, corpus pipeline, excerpt schema fields, attribution | Score researcher | `spec/03-score-corpus.md` |
| Screens, feedback visuals, tokens, copy, accessibility | Designer | `spec/04-design.md` |
| iOS Safari accommodations, platform seam, fork plan | iOS engineer | `spec/05-ios-fork.md` |

Every tolerance and weight lives in `config/grading-config.json`. The follower, the renderer, and the grader all read it through one resolver. A CI floor check fails the build if any tolerance is below the architect's measurement budget (`config/measurement-budget.json`).

## Rulings from the first review (R1 to R13)

1. "Key" means the written key the player reads. Concert key is secondary text.
2. The lead musician's grading model is the only one. The architect decides what is physically measurable.
3. v1 is built by agents alone. Nothing in v1 depends on human encoding, human review, or real recordings.
4. Corpus sources must have a verified licence and be fetchable from GitHub.
5. Rank and XP are per player. Level is per instrument.
6. Ranked scan time is the strict level default.
7. Voice is graded on relative pitch with a reference tone, octave-equivalent.
8. No key or meter changes inside an excerpt. Modal excerpts only when key is random. No lyrics. No CC BY-SA.
9. No stored audio. Listen-back, swing, Web MIDI, polyphony, accounts, and backends are post-v1.
10. Strict TypeScript, Vite, pnpm, React for screens only, Zustand, VexFlow 5 with an SVG overlay, Vitest, Playwright, static PWA.
11. Live red-note and ghost-note feedback is the default mode and may not be weakened. "After the take" is the only alternative mode in v1.
12. iOS in this build: the web app works on iOS Safari (labelled beta), the platform seam exists, the fork plan is documented. No native code.
13. "Practise without listening" stays, with no XP. Phone portrait is allowed with page turns.

## Rulings on what the team could not settle (R14 to R33)

14. A take ends one beat after the last note's written end.
15. Results show three components (pitch, intonation, rhythm) plus diagnostics (stops, restarts, drift). The five-bar layout is withdrawn.
16. Calibration never blocks a take. A take without a measured calibration is practice (unranked). iOS onboarding has no Skip control when output latency is unreported.
17. Takes with round-trip latency above 120 ms (Bluetooth) are unranked.
18. The musician's config takes the architect's three floor fixes: `intonationMinSteadyMs` is 150 ms (180 ms for voice and strings), notes-per-second caps are per window class, and piano's served range stops at C2.
19. The live sharp/flat window starts at 80 ms with 10 cents hysteresis (the musician's value). If the synthetic gate shows more than 1% false reds on in-tune notes, raise it to 150 ms in config.
20. An octave error on a non-voice instrument earns no pitch credit.
21. The synth covers every launch instrument's timbre, including saxophone and cello.
22. Selection follows the musician's rule: level at or below the player's, at most 20% from one level down, stretch excerpts at the stated rate.
23. Timing floors are the musician's (hard 40/60 ms, soft 55/85 ms), subject to the floor check.
24. Corpus gates: CI fails only on correctness and minimum viability (at least 300 excerpts, and a non-empty selection for every launch instrument at every served level). Larger coverage targets are reported, and block only a v1.0 tag.
25. If fewer than 30 valid level 1 excerpts exist, level 1 ships unserved and placement starts at level 2. No composed or memory-encoded melodies, ever.
26. CC BY excerpts show one quiet credit line during the take. CC0 and public-domain excerpts keep title and composer hidden until results.
27. Mutopia is an optional, non-blocking source. The pipeline passes if it yields nothing.
28. Public-domain cutoff for v1: composer died before 1931.
29. An agent review pass (strongest model, two prompt variants, blind controls) replaces human review for levels 1 to 3 and flagged excerpts. Until it runs, those excerpts are excluded.
30. `RankedReason` uses the musician's enum. Per-check detail goes in `AudioEnv.gateFailures`.
31. A count-in latency recheck that measures a shift keeps the take ranked, uses the fresh value, and prompts recalibration. Only a recheck that could not measure on speakers fails the gate.
32. The capture backlog void threshold is 120 ms of queued audio.
33. An interruption void after the first note counts against the skip limit.

## Rulings after wave 0 (R34 to R38)

34. Stops, restarts, and skips must be detected by the follower itself. The final alignment's relabel pass turns runs of wrong-pitch matches, as well as runs of extras, into displaced segments when they match the score at another position. The fixtures in `fixtures/follow/` are the contract.
35. Where the musician's acceptance case 4b and the architect's alignment disagree (a slipped note counted as missed or as a wrong pitch), tests assert only what both readings share, as the fixture does.
36. A note-state event replaces every earlier mark for that note. When a provisional sharp or flat reverts, the follower sends the note's new state and the overlay removes the ghost. No ghost-removal event type is added.
37. `notation/` keeps its local glyph id type, checked against `ui/glyph-ids.ts` in a test. No import from `notation/` to `ui/`.
38. The two pressed-state colour pairs that miss 4.5:1 contrast are fixed by darkening or lightening `--surface-2-pressed` in `design/tokens.json` until both pass in both themes. The contrast test then covers them.

## Rulings after wave 1 (R39 to R41)

39. Bundle budget: the notation module loads as its own lazy chunk. The unused Academico fonts are removed from it (Vite alias or a vendored Bravura-only entry). Limits: at most 150 KB gzip for the initial chunk and 500 KB gzip in total. This replaces the 450 KB figure in 01 section 12.
40. The pitch-step crossing bias measured in wave 1 (up to 1.6 ms for a 1 semitone step on the 1024 window, up to 3.6 ms for larger steps) is accepted. It is two orders below the timing tolerances. The segmenter treats it as part of the onset error budget and P18 reports it.
41. Firefox reports `outputLatencyReported` as false. The conservative value stands.

## Rulings after wave 2 (R42 to R48)

42. Displacement range: a restart may go back up to 4 bars and a skip may jump ahead up to 2 bars. The follower's reading stands.
43. An S grade requires no wrong-pitch and no missed note in the take. A take that scores in the S band with either is graded A. The flag lives in `config/grading-config.json`.
44. The frozen types take the additions wave 2 asked for: `FollowConfig.analysisRate` and `writtenKey`, `DspConfig.attackExcludeMs` and `clickLeakDb`, a frames-agree flag on `DetectedNote`, the key signature on `GradeInput`, spelling data and `peakNotesPerBeat` on `ManifestEntry`, and `finalAlign` taking the live outcome. Local workarounds are then removed.
45. Room reverb: the segmenter gets vibrato-aware dip rejection. Target: onset F1 of at least 0.93 on every launch timbre under the planned room conditions, with no regression on clean capture. If the target is missed, the numbers are reported and reverberant rooms are listed as a known limit.
46. Rhythm cells are read per metronome beat, as 02 defines the beat. Fixture cell ids that differ in 2/2 and 3/8 are regenerated.
47. Note-on latency of 79 ms at the 95th percentile on the long analysis window is accepted against the 75 ms budget.
48. The agent review in ruling 29 runs in wave 3 on levels 1 to 3 only. Other flagged excerpts stay excluded in v1. Mutopia (C3b) is dropped from v1.

## Rulings after wave 3 (R49 to R55)

49. The corpus rule that rejects every excerpt above level 6 whose level rests on a single feature is report-only. It removed 687 of 762 candidates at levels 7 to 10 and left those levels unserved. The relaxed key-agreement reading (reject only when the best-fit key is not closely related to the signature) stands.
50. A ghost note keeps the written note's letter only when the played pitch is within 1 semitone. Beyond that it is spelled from the key signature, so it sits at the played pitch's own staff position.
51. The "clean read" tip appears only when the take has no red note.
52. The S-grade cap in ruling 43 also counts octave errors on non-voice instruments.
53. Size limits count JavaScript and CSS (150 KB initial, 500 KB total, gzip). The music font ships as a separate woff2 asset of at most 260 KB and is reported by the size check.
54. Ruling 45's room target was missed for voice, cello, violin, and flute in strong rooms. Reverberant rooms are a known limit, and voice is labelled beta outside quiet, dry rooms.
55. The DSP worker posts the count-in recheck and the voice drift reference, so speaker takes can be ranked in port mode and the voice drift pattern can fire. The session summary in 02 section 6.1 is built.

## Redesign (R56 to R60)

The owner asked for a designer and a UX expert to review the built app. Their specs are in `docs/redesign/` (05 UX spec, 06 design spec, 08 plan, mockups). For screens, copy, and behaviour of the interface, those documents now override `spec/04-design.md`.

56. "Level" is "Difficulty" everywhere the player sees it. Internal identifiers may stay.
57. Baritone and mezzo-soprano ship as launch voices. Status: both are in `config/instruments.json` as `launch`, in singing order; the shipped corpus serves both at every difficulty, and its re-emitted manifest (corpus c1-27c3bee0bf, 957 excerpts, 13 newly denylisted for H-serve) carries `stats.fit` for both; `pnpm corpus:check` passes.
58. The metronome gets three sounds (Classic, Woodblock, Beep), default Classic, each with a preview in settings. The build does not wait for the owner's audition; the owner can change the default later.
59. Listening to the excerpt before a take makes that take practice, recorded with the reason `listened-first`. The session sets this; `src/grade` is not changed. Listening after results is free.
60. The redesign build may not touch `src/dsp`, `src/follow`, or `src/grade`.

## Round 2 (R61 to R66)

Specs are in `docs/redesign/round2/`. They override earlier documents for what they cover.

61. At difficulties 1 to 3, only green and red marks show live, and only when the app is sure. Ghost notes and extras wait for results. This amends ruling 11 for those difficulties. Setting: `display.ghostsLive`, default from difficulty 4.
62. Voices use the synthesised formant sets until the owner hears them and rules otherwise. No licensed solo voice recordings were found.
63. "Try" and "tries" replace "take" and "takes" in everything the player reads. "Time signature" replaces "Time".
64. The diagnostics export may include the try's microphone audio when the player turns the setting on. It is off by default, local, and never sent automatically. This is the only exception to ruling 9. The setting is visible in normal builds, not hidden behind a build variable. The results button saves a file; there is no email sending.
65. The count-in stays 2 bars at difficulties 1 to 3, with a visual that makes the last bar and the entry clear.
66. Size limits: 150 KB initial and 560 KB total of JavaScript and CSS (gzip). Sound files load per instrument on demand and are outside this limit, at most 150 KB per instrument.

## What the owner should know

- Early, late, and wrong-note marks appear within about 150 ms of the note. Sharp and flat marks appear about 260 to 350 ms after the note starts, because pitch needs roughly 100 ms of steady tone after the attack before it can be measured to the cent.
- Notes shorter than about 150 ms are judged by semitone only. Intonation isn't graded on them.
- Detection quality is proven on synthetic audio in CI. No real instrument recordings exist in this build, so real-world accuracy is unverified until you play into it.
- Level 1 may ship empty (ruling 25). The CC0 sources are art songs and string quartets, which are thin on beginner material.
- Tuba, double bass, baritone sax, and other instruments below about 70 Hz are beta: laptop and phone mics roll off there.
- iOS Safari is beta until a device test. Nothing here was run on a physical phone.

## v1 scope

In: the practice loop (setup, scan, count-in, take, results, tips, next), live feedback, grading, XP and rank, per-instrument level with level-up offers, 16 error patterns and their tips, latency calibration (loopback and play-along), history and progress, settings, credits, light and dark themes, PWA install, local persistence with export and import.

Launch instruments (synthetic gates must pass): flute, B♭ clarinet, alto sax, B♭ trumpet, violin, cello, voice, piano (single line). The other 16 ship as data with a beta label.

Later: Web MIDI, polyphony, listen-back, swing, accounts and sync, leaderboards, teacher mode, the Capacitor iOS target and its native features, human-encoded beginner repertoire, composers who died from 1931 to 1955, a "calm" live mode.

## Work packages

Package ids refer to the "work plan" part of each section. Overlaps are merged: the musician's G1 and G9 are built in P2, G3 in P12, G4 in P12b, G5 in P13, and G8 in P9b. G6 and G7 (progression and ranked eligibility) are split out of P12 as their own package.

### Wave 0: foundation (sequential, frozen before anything else)

| Step | Packages | Model |
| --- | --- | --- |
| 0.1 | P0a scaffold and tooling | Sonnet 5.5 |
| 0.2 | P0b core types, platform seam, schemas (with 03's and 05's type additions) | Opus 5.5 |
| 0.3 in parallel | P0c utilities and onset definition; P0d + G0 config seeding and floor check; P0g minimal testkit; D0a tokens; D0b glyphs; D0c copy; D0d visual states; D0e layout table | Sonnet 5.5, Haiku 5.5 for D0a and D0c |
| 0.4 | P0e fixture corpus and golden expected notes | Opus 5.5 |
| 0.5 | P0f follow, grade, and render fixtures | Opus 5.5 |
| 0.6 | Review and repair: typecheck, lint, tests green | Opus 5.5 |

### Wave 1: independent modules

P1 theory (Sonnet). P2 rules (Opus). P3 full synth (Opus). P4a capture primitives, then P4b pitch (Sonnet). P6 store (Sonnet). P7 static notation (Opus). P9a corpus loading (Haiku). G2 level tagger (Sonnet). D1 shell, then D2a and D2b components (Sonnet, Haiku for D2a). IOS1 capabilities (Haiku). Corpus pipeline C1, C2 (Haiku), C3a, C4 (Sonnet).

### Wave 2: the hard core

P4c segmenter, then P4d click handling (Opus). P10a live follower, then P10b final alignment (Opus). P11 web audio backend (Opus). P9b selection and transposition (Opus), then P9c expected notes (Sonnet). P12 grade (Sonnet). G6 and G7 progression (Sonnet). P12b pattern detectors (Opus). P13 tips (Haiku). P15 overlay (Sonnet). C5 windowing (Opus), C6 features (Sonnet), C7 filters (Opus).

### Wave 3: integration and screens

S1 thin slice (Opus). P14 calibration (Opus). P16 session state machine (Opus). D3 score frame (Opus). D4 to D7, D8a, D10 screens (Sonnet). D9, D11, D12 (Haiku). D8b review interactions (Opus). IOS2, IOS3, IOS6, IOS7 (Sonnet). IOS4, IOS5, IOS8 (Haiku). C8 review layer (Opus), C8r agent review run (Opus), C9 emitter (Sonnet), C3b Mutopia (Sonnet, optional).

### Wave 4: gates and hardening

P18 synthetic accuracy gates (Opus). C10 corpus validation (Sonnet). P19 PWA (Haiku). P20 replay route (Haiku). P21 WebKit projects (Sonnet). D13 design QA (Sonnet). A final Opus review of the whole diff, then repairs.

## How the swarm runs

- Each wave is one orchestrated run. Fable reviews the result, commits, and decides whether the next wave starts.
- Each package has one implementer that owns a set of directories and may not edit outside them. Frozen artefacts change only through the overseer.
- Each implementer reads its section of the spec, writes tests first where the spec gives acceptance criteria, and returns the commands it ran and their results.
- Each wave ends with an Opus reviewer that runs the full typecheck, lint, and test suite and repairs integration breaks.
- Routine packages go to Haiku 5.5, moderate ones to Sonnet 5.5, hard ones to Opus 5.5.

## Definition of done for v1

1. `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass.
2. The synthetic accuracy gates in P18 pass for the eight launch instruments.
3. A Playwright run completes the practice loop with fake audio capture in Chromium and WebKit and lands on a graded result.
4. The corpus build passes the viability gate in ruling 24 and every shipped excerpt carries a source, licence, and credit.
5. The app builds to static files that serve from a subpath.
