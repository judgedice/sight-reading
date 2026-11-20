# Sight-reading trainer

A web app for practising sight-reading on a real instrument. You pick an instrument (its range is drawn on a staff and a keyboard as you choose), a difficulty from 1 to 10, a key, a time signature, a tempo and a length (any of them can be left to chance). The app shows an 8 to 12 bar excerpt of real public-domain repertoire, gives you a short read-through and a count-in, then listens through the microphone while a metronome plays.

Before a try you can hear the tempo (one bar of clicks), hear the key chord (instruments) or the key chord and your first note (voices, "Hear starting pitch"), and listen to the whole excerpt. On the instrument picker, "Play my range" plays your lowest note, the notes at this difficulty and your highest, in the instrument's own sound. Sounds play only when you ask for them. Apart from the metronome, nothing plays during a try. Listening to the excerpt first makes that try practice: in Ranked mode the app asks before it plays, the toolbar changes to Practice at once, and the results say "You listened first, so this one is practice." After the results, Listen plays the written music again with the bar highlighted, at the try's tempo or slower. The metronome has three sounds (Classic, Woodblock, Beep), each with a preview in Settings > Sound.

Notes are judged as you play. From difficulty 4, a note that is early or late appears on the staff where you played it and the written note turns red. A wrong or out-of-tune note appears as a ghost note at the pitch you played, and the written note turns red. At difficulties 1 to 3 the live marks are calmer: only green and red marks on the written notes, and only when the app is sure. The played notes (grey ghost notes) and the plus-sign extras wait for the results (PLAN R61, which amends ruling 11 for those difficulties). The Display setting "Show played notes live" (From difficulty 4, Always or Never) changes when they show. Each try gets a score from 0 to 100 and a letter grade, earns XP toward a rank, and the results show at most two tips ("One thing to try") chosen from the mistakes you made.

**Note colours** (Settings > Display, off by default, PLAN R69). Each notehead is filled in its letter name's colour on every score: C red, D orange, E yellow, F green, G blue, A purple, B pink. Sharps and flats keep their letter's colour, and a transposing instrument colours the note as written. Only the head is coloured; stems, beams, accidentals and ledger lines stay black. The row has a colour key with the letters. With note colours on, a written note marked wrong turns grey instead of red (its red mark under the staff stays), so a red C never looks like a mistake. Tries count as before: the setting changes nothing about ranked tries. The notes the app heard (ghost notes and the plus-sign extras) are grey in every theme, whether or not note colours are on.

Everything runs in the browser. There is no server, no account and no stored audio. Progress, history and settings live in the browser's storage and can be exported to a file and imported again.

**Match a note** is a warm-up, not a difficulty. It has its own screen at `#/match` and an entry on Practice: a row under the instrument card, or "Warm up: match a note" on a phone. It plays one note, shows a live needle, and says "You hit it" when you hold the note in tune. It has no score, XP, rank, streak or History entry, and it sits outside the 1 to 10 difficulty scale (PLAN R67). Onboarding has the same check as a step after calibration.

**Scales** are drill material, not sight-reading excerpts (PLAN R68). For an instrument that has them (only the baritone so far), Practice shows a "Scales" entry beside "Match a note" ("Warm up: sing a scale" on a phone). It opens a chooser that lists the scales from easy to harder, each with its range and tempo, and a tempo you can set for all of them. Choosing one goes straight to the read-through. The baritone's seven scales stay inside A2 to D4, which is the voice's tier B band: the difficulty 1 band (C3 to C4) plus a third below and a tone above, so the B♭ and A scales fit. They are the five-note scale (do re mi fa sol and back) in C, D and B♭, the one-octave major scale in C and B♭, the C major arpeggio (do mi sol do and back), and the A natural minor scale. Each is in 4/4 and bass clef, in quarter notes with the last note held. The default tempo is 60 to 66. A scale try runs like any try: starting pitch, count-in, live marks, grading with the difficulty 1 tolerances, Listen and diagnostics. It gets a score and a grade, but it is always practice: no XP, rank or streak, and it never changes your difficulty. The results say so in one line and offer "Next scale" and "Same scale again". History names scale tries and can show only pieces or only scales. Scales are generated from `config/scales.json` by `src/corpus/scales`. To add a voice or an instrument, add a set to that file. No code change is needed.

**Calibration status** stays on screen. The pill on Practice and in the read-through reads "Calibrated for {output}" once you have calibrated, and "Not calibrated" until then. Calibration lives at `#/calibrate`. Tries count as practice until you calibrate, and calibration never blocks a try. Once measured, the app takes the setup's delay off every note, so early and late are fair.

**Starting pitch and count-in.** For a voice, the app first plays your starting pitch (the key chord, then your first note) on a labelled card, with the score dimmed and "Marks start at bar 1" in the strip; nothing is marked while it plays. Settings > Practice can turn it off. Then the count-in: two bars at difficulties 1 to 3, one bar above that. A track over the music has one cell per beat. The first bar is grey ("Count-in: listen to the beat"), the last is brass ("Come in after 4", or after 3, 2 or 1 when the piece starts on a pickup), then the word "Sing" or "Play".

**Previous tries.** Every try is saved on the device. Practice shows the last try with "All tries", and the results show "See all tries". Both open History, where a try opens its detail: the marked score, Listen, "Hear what we heard" and the diagnostics button. The read-through has no timer in Practice mode, and "Look before you play" lists five things to spot, with no boxes to tick.

**Sounds and credits.** Each instrument plays its own sampled sound. The four voice types sing an open "ah" that the app synthesises for each voice type; it is not a recording of a singer. The samples come from VSCO 2 Community Edition (CC0), Fluid R3 (MIT, with per-note renders under CC BY 3.0) and Salamander Grand Piano (CC BY 3.0). The credits screen names every source. The licence texts are in `LICENSES/`, and `docs/redesign/round2/02-sounds.md` records how each licence was checked.

**Diagnostics and replay.** On the results, "Marks look wrong?" offers a button that saves a JSON file of what the app heard in that try: every note, every mark and the marks that changed after the try, and your settings and device with no names. The button reads "Send diagnostics" when a support address is set at build time (`VITE_SUPPORT_EMAIL`). The app never sends the file itself. "Share…" uses the system share sheet where the browser allows it. Settings > Data exports the last 20 tries as one file. A switch, "Keep the sound of my next tries for diagnostics", is off by default and applies from the next try. When it is on, those files include the microphone audio of the tries. This is the only stored audio the app keeps, and it is the exception to the no-stored-audio rule (PLAN R64). To replay a file with the current detector and follower, run `pnpm exec tsx tools/diagnostics/replay.ts <file.json> [--try N] [--fixture out.json]`. It prints the stored verdict and the replayed one for each written note, and marks every row that changed. A file with audio runs through the DSP worker core. A file without audio replays the traced notes through the follower and final alignment only.

Eight instrument families are the launch set and are covered by the accuracy gates: flute, B♭ clarinet, alto saxophone, B♭ trumpet, violin, cello, voice (soprano, mezzo-soprano, alto, tenor, baritone and bass) and piano (single line). Sixteen more ship as data with a beta label, behind "Show more instruments (less tested)".

The round 2 redesign answers the owner's fifteen points from his first real use; `docs/redesign/round2/07-final-review.md` goes through them one by one with evidence, and lists what still needs his voice and his Mac to verify.

The specification is in `docs/spec/`. `docs/PLAN.md` holds the rulings that override it, and `docs/BUILD-NOTES.md` records what each work package did and what it left open.

## Requirements

- Node 22 and pnpm 10.
- Python 3.12 or 3.13, only to rebuild the music corpus.
- A Chromium build for the browser tests. The sandbox uses `/opt/pw-browsers/chromium`; set `PW_CHROMIUM_PATH` to use another one.

## Run it locally

```sh
pnpm install
pnpm dev        # dev server on http://localhost:5173
```

The dev server also serves the developer routes: `#/dev/components` (component gallery) and `#/dev/replay` (load a render stream or an attempt export and scrub its events).

To try the production build:

```sh
pnpm build      # typecheck, then a static build in dist/
pnpm preview    # serves dist/ on http://localhost:4173
```

Use a browser on `localhost` or over HTTPS. The microphone, the audio worklet and the service worker need a secure context.

### Build variables

Two variables are read at build time. Both are optional.

- `VITE_SUPPORT_EMAIL`: the support address the diagnostics dialog names. When it is set, the button reads "Send diagnostics" and the dialog says where to send the file. The app does not send mail.
- `VITE_NOTATION_DEV=1`: includes the notation development screen in a production build. The dev server always includes it.

For example: `VITE_SUPPORT_EMAIL=support@example.org pnpm build`.

## Test it

```sh
pnpm typecheck       # app, pure packages (no DOM), DSP worker and Node configs
pnpm lint            # ESLint with module boundaries, Stylelint, dependency cycles
pnpm lint:copy       # every copy key in src/ui/copy is used
pnpm test            # Vitest unit and integration tests, plus a fast subset of the accuracy gates
pnpm test:bare       # pure packages bundled and run with only ES2022 globals, compared byte for byte with Node
pnpm size            # bundle budget: 150 KB gzip initial, 560 KB gzip total, music font 260 KB
pnpm gates           # full synthetic accuracy gates, about 6 minutes on 4 cores
pnpm corpus:check    # validates the shipped corpus in public/corpus/v1
pnpm validators:check  # the precompiled backup-file validator matches schemas/ (`pnpm validators` regenerates it)
```

`pnpm gates` writes `docs/accuracy-report.md` and `tools/gates/artifacts/accuracy.json`. Add `--report-only` to publish the report without failing, or `--no-write` to leave the files alone.

Browser tests use Playwright. Each suite has its own config because some need their own build, server or fake microphone:

```sh
pnpm exec playwright test                                            # root suite (Chromium)
pnpm exec playwright test -c e2e/notation/playwright.notation.config.ts
pnpm exec playwright test -c e2e/audio/playwright.audio.config.ts
pnpm exec playwright test -c e2e/slice/playwright.slice.config.ts
pnpm exec playwright test -c e2e/loop/playwright.loop.config.ts      # full practice loop to a graded result
pnpm exec playwright test -c e2e/ios/playwright.ios.config.ts
pnpm exec playwright test -c e2e/synthetic/playwright.synthetic.config.ts
pnpm exec playwright test -c src/platform/web/sw/playwright.pwa.config.ts   # offline and subpath
pnpm exec playwright test -c e2e/design/playwright.design.config.ts         # axe, tap targets, motion
pnpm exec playwright test -c e2e/setup/playwright.setup.config.ts           # Practice setup rows, sheet and fallbacks
pnpm exec playwright test -c e2e/a11y/playwright.a11y.config.ts             # accessibility walk, keyboard, owner walkthrough
pnpm exec playwright test -c e2e/tour/playwright.tour.config.ts             # screen tour and the owner's walk, write docs/screenshots/
```

WebKit projects are added to these configs only when `IOS_WEBKIT=1` is set and WebKit is installed (`pnpm exec playwright install webkit`). `pnpm test:e2e:webkit` sets the variable for the root suite.

CI (`.github/workflows/ci.yml`) runs all of the above, including the WebKit projects, the corpus pytest suite and the gates.

## Rebuild the music corpus

The shipped corpus is generated and committed in `public/corpus/v1/`. You only need to rebuild it after changing the pipeline, its config or the denylist. The pipeline is in `tools/corpus-build/` and its README describes every stage.

```sh
cd tools/corpus-build
pip install -r requirements.txt
python -m corpus_build          # fetch the pinned sources, gate, read, extract, window, tag, filter, review, emit
python -m corpus_build emit     # only re-emit public/corpus/v1 from the existing build/ output
python -m pytest                # pipeline tests
cd ../..
pnpm corpus:check               # render, fit, selector and source checks in TypeScript
```

The full fetch clones three OpenScore repositories from GitHub at pinned commits into `~/.cache/sight-reading-corpus` (or `$SIGHT_READING_CORPUS_CACHE`). The agent review verdicts for levels 1 to 3 are cached in `tools/corpus-build/review/`, so a rebuild does not need to call a model.

If `pnpm corpus:check` fails on individual excerpts, `pnpm corpus:check --write-denylist` adds their ids to `tools/corpus-build/denylist.yaml`. Then run `python -m corpus_build emit` again, which drops them. Repeat until the check passes. The denylist is also where takedowns go.

## Deploy

`pnpm build` produces a fully static site in `dist/`. Every URL in it is relative and routes are hash routes, so it works from any origin and any subpath (for example `https://example.org/tools/sightread/`) without server rewrites. Copy `dist/` to any static host. Serve it over HTTPS.

Recommended headers: a long cache lifetime for `assets/` and the hashed corpus files in `corpus/v1/` (their names change when their content does), and `no-cache` for `index.html`, `sw.js`, `manifest.webmanifest`, `corpus/v1/index.json` and `corpus/v1/withdrawn.json`.

The CI workflow deploys `dist/` to GitHub Pages on every push to `main` once all jobs pass.

The service worker caches the app shell and every corpus file it has fetched, so the app reloads and plays offline after the first visit. A new build is picked up on the next launch, after every tab of the app has been closed. There is no in-app update prompt.

## What is verified, and how

- Detection and grading accuracy: `pnpm gates` renders 1771 synthetic takes with the built-in synthesiser across the eight launch instruments. It covers clean capture, device conditions (click bleed, phone microphone, noise) and simulated rooms. Each take goes through the production analysis path: the decimator, the DSP worker, live score following, final alignment and grading. The report gives onset F1, timing error, intonation error, verdict agreement, false misses and extras, live-versus-final divergence, latency, displacement handling (stops, restarts, skips) and tip precision. See `docs/accuracy-report.md` for the current numbers and the gates that still fail.
- Measurement floors: a unit test fails the build if any grading tolerance in `config/grading-config.json` is tighter than the measurement budget in `config/measurement-budget.json`.
- The practice loop: Playwright plays rendered audio into Chromium through its fake microphone and checks that a try lands on a graded result with the right red notes and ghosts (`e2e/loop`, `e2e/tour`).
- The corpus: the Python pipeline enforces the licence and public-domain gate (CC0 sources, composers who died before 1931), notation rules, dedupe and the size budgets. `pnpm corpus:check` loads every shipped excerpt through the app's own selector, transposer and renderer. It checks that every launch instrument can be served at every served level, and that every excerpt carries a source, a licence and a credit.
- Accessibility and design: axe-core reports no serious or critical issues on every screen in light and dark themes. Tap targets are at least 44 px, and nothing animates under reduced motion. A contrast test covers every token pair.
- Offline and portability: the PWA suite boots the build from another origin under a subpath with third-party network blocked, then reloads it offline.

## Known limits

- Accuracy is proven on synthetic audio only. No real instrument recordings were used, so real-world accuracy is unverified until someone plays into it.
- Not every gate passes. Voice misses some short notes a semitone apart, and its false-miss and pitch-class rates are over their thresholds. Piano onsets under a steady noise floor are below the F1 gate. `docs/accuracy-report.md` lists the numbers and the causes, which are both in the segmenter (`src/dsp/segmenter.ts`).
- Reverberant rooms are a known limit, and voice is labelled beta outside quiet, dry rooms.
- Sharp and flat marks appear about 260 to 350 ms after a note starts. Notes shorter than about 150 ms are judged by semitone only.
- Instruments below about 70 Hz (tuba, double bass, baritone sax) are beta, because laptop and phone microphones roll off there.
- Difficulties 1, 2 and 9 have fewer than 30 excerpts each (7, 7 and 18) and are marked unserved. The CC0 sources are art songs and string quartets, which are thin on beginner material. Practice at those difficulties draws on a very small pool, mostly borrowed from the neighbouring levels.
- iOS Safari is beta. WebKit has not been run in this build's own environment, and nothing has been tested on a physical phone.
- Calibration has been exercised on synthetic loopback and play-along only, not on real devices. A try without a measured calibration is practice (unranked).
- Not in v1: Web MIDI, polyphony, playback of your own try (Listen plays the written music, never your recording), swing, accounts and sync, and a native iOS app. The one exception is the optional diagnostics sound described above.
- Live marks at difficulties 1 to 3 are calmer on purpose (PLAN R61). The owner has not yet confirmed that rule.
- Voices are synthesised, not sampled from a singer (PLAN R62). The owner has not yet chosen between the formant voices and the choir set.
- The sounds were checked by what the audio graph schedules and by pitch analysis of rendered samples, not by ear.
- The real-time browser tests that sing through the fake microphone (`e2e/loop`, `e2e/tour`) can fail under heavy CPU load. Run them on a quiet machine before reading a failure as a regression.

## Layout

| Path | What |
| --- | --- |
| `src/core/` | frozen shared types, module APIs and the platform seam |
| `src/theory`, `src/rules`, `src/instruments` | pitch spelling, configuration resolution, instrument data |
| `src/dsp/`, `src/follow/` | pitch and onset detection, live score following, final alignment |
| `src/grade/`, `src/tips/` | scoring, XP and rank, error patterns, tips |
| `src/corpus/`, `src/notation/` | excerpt selection and transposition, VexFlow rendering and the feedback overlay |
| `src/session/`, `src/calibration/` | the try state machine, the Match a note service, latency calibration and gates |
| `src/platform/web/` | Web Audio backend, DSP worker, storage, service worker, iOS accommodations |
| `src/ui/`, `src/app/` | components, design tokens, copy, screens and the composition root |
| `config/`, `schemas/`, `fixtures/` | tolerances and level data, JSON schemas, test fixtures |
| `tools/` | corpus pipeline, corpus check, accuracy gates, size check, bare-runtime check |
| `public/corpus/v1/` | the shipped corpus |

Import rules between `src/` folders are enforced by ESLint and dependency-cruiser.
