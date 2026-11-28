# Native app status

Branch `claude/native-tauri`, started from `claude/modest-hopper-enh3o5` at `4b84f11`. This file is the handoff: read it first when resuming.

## Milestones

| # | Milestone | State |
| --- | --- | --- |
| 1 | Tauri scaffold and Linux build | done (Linux debug build and smoke test pass here; macOS and Windows builds only in CI, see below) |
| 2 | Native playback and clock | Rust done and verified (core, device crate, Tauri output commands); TypeScript backend in progress |
| 3 | Native capture and analysis feed | core done (aligner, resampler, packets); device and command wiring in progress |
| 4 | Calibration and latency | loopback estimator done in core (23.4 ms simulated path measured to 0.0003 ms); command, latency modules, calibration service not done |
| 5 | Parity pass and CI for all platforms | not started |
| 6 | Review and final verification | not started |

## In progress

- Mid-level engineer (Rust): input streams, duplex fake device, `audio_capture_start/stop`, `audio_measure_loopback`, permission, per-platform latency modules, virtual-device loopback test on Linux.
- Mid-level engineer (TypeScript): `src/platform/native/` (`NativeAudioBackend`, capture feed, voice adapters, boot switch in `main.tsx`), tests against `FakeNativeIpc`.

## Next step

1. Verify both (Rust: `cargo test --workspace --all-features`, clippy; web: every check in the brief), commit without `[skip ci]` so `native.yml` runs on all three desktop systems.
2. Integration: run the real TypeScript backend against the real Rust commands on the fake device (onboarding, calibration at 23.4 ms, one synthetic try graded as in the web e2e). Design section 8 test 6.
3. Milestone 4: native calibration service (stale guard, pre-check, short profile).
4. Milestone 5: export and import inside the shell, iOS and Android projects and plugin, CI jobs for both, entitlements and usage strings.
5. Milestone 6: independent review of the audio layer, merge `origin/claude/modest-hopper-enh3o5`, full verification, final report.

## Lessons

- While agents are editing, commit with explicit paths. A plain `git commit` once picked up half of a staged file move and broke CI.
- WIP checkpoint commits carry `[skip ci]` so they do not spend macOS and Windows minutes.
- `ubuntu-latest` names the WebKit WebDriver package `webkitgtk-webdriver`.
- Deviations of the code from `AUDIO-DESIGN.md` are listed in the agents' reports and still need folding into the design document (clock fit, split capture half, buffer store on the control side, strict path choice, loopback tap on the packet ring, `late` and `rejected` events).

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
