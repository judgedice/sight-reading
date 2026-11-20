# Sight-reading trainer

A web app for practising sight-reading on a real instrument. You pick an instrument (its range is drawn on a staff and a keyboard as you choose), a difficulty from 1 to 10, a key, a time signature, a tempo and a length (any of them can be left to chance). The app shows an 8 to 12 bar excerpt of real public-domain repertoire, gives you a short read-through and a count-in, then listens through the microphone while a metronome plays.

Before a take you can hear the tempo (one bar of clicks), hear the key chord (instruments) or the key chord and your first note (voices, "Hear starting pitch"), and listen to the whole excerpt. Nothing plays during a take. Listening to the excerpt first makes that take practice: in Ranked mode the app asks before it plays, the toolbar changes to Practice at once, and the results say "You listened first, so this one is practice." After the results, Listen plays the written music again with the bar highlighted, at the take's tempo or slower. The metronome has three sounds (Classic, Woodblock, Beep), each with a preview in Settings > Sound.

Notes are judged as you play. A note that is early or late appears on the staff where you played it and the written note turns red. A wrong or out-of-tune note appears as a ghost note at the pitch you played, and the written note turns red. Each take gets a score from 0 to 100 and a letter grade, earns XP toward a rank, and the results show at most two tips ("One thing to try") chosen from the mistakes you made.

Everything runs in the browser. There is no server, no account and no stored audio. Progress, history and settings live in the browser's storage and can be exported to a file and imported again.

Eight instrument families are the launch set and are covered by the accuracy gates: flute, B♭ clarinet, alto saxophone, B♭ trumpet, violin, cello, voice (soprano, mezzo-soprano, alto, tenor, baritone and bass) and piano (single line). Sixteen more ship as data with a beta label, behind "Show more instruments (less tested)".

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
- The practice loop: Playwright plays rendered audio into Chromium through its fake microphone and checks that a take lands on a graded result with the right red notes and ghosts (`e2e/loop`, `e2e/tour`).
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
- Calibration has been exercised on synthetic loopback and play-along only, not on real devices. A take without a measured calibration is practice (unranked).
- Not in v1: Web MIDI, polyphony, playback of your own take (Listen plays the written music, never your recording), swing, accounts and sync, and a native iOS app.

## Layout

| Path | What |
| --- | --- |
| `src/core/` | frozen shared types, module APIs and the platform seam |
| `src/theory`, `src/rules`, `src/instruments` | pitch spelling, configuration resolution, instrument data |
| `src/dsp/`, `src/follow/` | pitch and onset detection, live score following, final alignment |
| `src/grade/`, `src/tips/` | scoring, XP and rank, error patterns, tips |
| `src/corpus/`, `src/notation/` | excerpt selection and transposition, VexFlow rendering and the feedback overlay |
| `src/session/`, `src/calibration/` | the take state machine, latency calibration and gates |
| `src/platform/web/` | Web Audio backend, DSP worker, storage, service worker, iOS accommodations |
| `src/ui/`, `src/app/` | components, design tokens, copy, screens and the composition root |
| `config/`, `schemas/`, `fixtures/` | tolerances and level data, JSON schemas, test fixtures |
| `tools/` | corpus pipeline, corpus check, accuracy gates, size check, bare-runtime check |
| `public/corpus/v1/` | the shipped corpus |

Import rules between `src/` folders are enforced by ESLint and dependency-cruiser.
