# Native app status

Branch `claude/native-tauri`, started from `claude/modest-hopper-enh3o5` at `4b84f11`. This file is the handoff: read it first when resuming.

## Milestones

| # | Milestone | State |
| --- | --- | --- |
| 1 | Tauri scaffold and Linux build | in progress |
| 2 | Native playback and clock | not started |
| 3 | Native capture and analysis feed | not started |
| 4 | Calibration and latency | not started |
| 5 | Parity pass and CI for all platforms | not started |
| 6 | Review and final verification | not started |

## In progress

- Senior audio engineer: writing `docs/native/AUDIO-DESIGN.md` (design only).
- Mid-level engineer: `src-tauri/` scaffold, Linux debug build, smoke test (`tools/native/smoke-linux.sh`), `.github/workflows/native.yml` for Linux, macOS and Windows.

## Next step

Review the design, record its decisions as rulings from R83 in `docs/PLAN.md`, commit milestone 1, then staff milestone 2 from the design's task list.

## Environment notes

- Linux system libraries for the build are installed per session with apt (`libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libasound2-dev libpulse-dev xvfb pulseaudio libxdo-dev`). A fresh container needs them again.
- This container cannot build or run Apple or Windows targets. CI is the only evidence for those.

## Open risks

- None recorded yet.
