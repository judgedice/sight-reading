# Native app status

Branch `claude/native-tauri`, started from `claude/modest-hopper-enh3o5` at `4b84f11`. This file is the handoff: read it first when resuming.

## Milestones

| # | Milestone | State |
| --- | --- | --- |
| 1 | Tauri scaffold and Linux build | done (Linux debug build and smoke test pass here; macOS and Windows builds only in CI, see below) |
| 2 | Native playback and clock | in progress |
| 3 | Native capture and analysis feed | not started |
| 4 | Calibration and latency | not started |
| 5 | Parity pass and CI for all platforms | not started |
| 6 | Review and final verification | not started |

## In progress

- Senior audio engineer: `src-tauri/crates/sr-audio-core` first half (mixer, clock, wire, latency maths, MP3 decode, engine render).
- Mid-level engineer: move shared audio TypeScript to `src/platform/shared/audio/`, widen `PlatformKind` (R85).

## Next step

When both report: verify (`cargo test`, all web checks), commit. Then design tasks M2-4 (fake and cpal output, Tauri commands), M2-6 (`NativeAudioBackend` output half), M2-7 (decode and sampler), and the second half of the core (capture aligner, resampler, loopback estimator, synth ports).

## How to verify milestone 1

- `pnpm tauri build --debug --no-bundle` then `bash tools/native/smoke-linux.sh` (needs `cargo install tauri-driver --locked` and apt `webkit2gtk-driver xvfb`).
- CI: `.github/workflows/native.yml` (Linux, macOS, Windows). iOS and Android jobs are milestone 5.

## Environment notes

- Linux system libraries for the build are installed per session with apt (`libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libasound2-dev libpulse-dev xvfb pulseaudio libxdo-dev`). A fresh container needs them again.
- This container cannot build or run Apple or Windows targets. CI is the only evidence for those.

## Open risks

- Release builds inject CSP nonces; the smoke test has only run against a debug build.
- Export uses a blob download link, which a webview may ignore. Needs the dialog and fs plugins or a native save command (milestone 5).
- See the ranked risk list in `AUDIO-DESIGN.md` section 9.
