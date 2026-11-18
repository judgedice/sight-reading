# Sight-reading trainer

A web sight-reading trainer. Pick an instrument, level and key; read an excerpt of real public-domain repertoire while a metronome plays; the app listens through the microphone and marks early, late, wrong and out-of-tune notes live on the staff, then gives a score, a grade and up to two tips.

Specs are in `docs/spec/`; `docs/PLAN.md` overrides them where they differ.

## Requirements

Node 22 and pnpm 10.

## Run

```sh
pnpm install
pnpm dev            # dev server on http://localhost:5173
```

## Check

```sh
pnpm typecheck      # app, pure-package (no DOM), dsp (WebWorker) and node configs
pnpm lint           # eslint (module boundaries, restricted globals), stylelint, dependency cycles
pnpm lint:fixtures  # proves the negative lint fixtures in test/lint-fixtures/ fail as intended
pnpm test           # vitest (includes the lint fixtures)
pnpm test:e2e       # playwright, chromium projects
pnpm build          # static build to dist/ (relative URLs, serves from any subpath)
```

Playwright uses the preinstalled Chromium at `/opt/pw-browsers/chromium`; set `PW_CHROMIUM_PATH` to use another binary. WebKit projects run with `pnpm test:e2e:webkit` and need a WebKit install (CI only).

## Layout

See `docs/spec/01-architecture.md` section 4. Import rules between `src/` folders and the restricted browser globals are enforced by ESLint.
