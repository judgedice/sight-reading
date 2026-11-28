# Native app status

Branch `claude/native-tauri`, started from `claude/modest-hopper-enh3o5` at `4b84f11`. This file is the handoff: read it first when resuming.

## Milestones

| # | Milestone | State |
| --- | --- | --- |
| 1 | Tauri scaffold and Linux build | done |
| 2 | Native playback and clock | done; verified on the simulated device and in the Linux shell |
| 3 | Native capture and analysis feed | done; a synthetic try grades exactly as on the web (`tools/native/e2e-linux.sh`) |
| 4 | Calibration and latency | loopback and latency reporting done; native calibration service in progress |
| 5 | Parity pass and CI for all platforms | CI builds all five (commit `d22ae8c`: Linux with smoke and e2e, macOS, Windows, Android debug APK, iOS simulator app); export, import, storage in progress |
| 6 | Review and final verification | independent review done, fixes in progress; final verification and merge of the web branch not done |

## In progress

- Senior audio engineer: fixes for the independent review (13 findings, 6 major: packet flags unread in TypeScript, locked path drift over long captures, re-anchor after output restart, no route refresh on device change, false clock steps under heavy jitter, device id lookup falling back to the default device) and `tools/native/gates-resampled.ts`.
- Mid-level engineer: native calibration service (short profile after a loopback pre-check, stale guard, cross-check).
- Mid-level engineer: export, import, storage, keep-awake, links inside the shell; `data` e2e scenario.

## Next step

1. Verify each (commands in the brief), commit with CI on.
2. Merge `origin/claude/modest-hopper-enh3o5`, fix what breaks, rerun everything: `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm size`, `pnpm test:e2e --trace off`, `pnpm gates`, `cargo test --workspace --all-features`, clippy, smoke, e2e, both workflows.
3. Notes in `docs/BUILD-NOTES.md`, owner steps for the Mac, final report to the main session, disable the safety-net task.

## Measured so far (simulated device unless stated)

- Scheduled sound starts on the exact frame (0 frames error).
- Loopback of a 23.4 ms path: 23.3997 ms, MAD 0.0001 ms. In the shell from the page: 23.400 ms three times.
- The app's own calibration reads 23.05 to 23.17 ms for 23.4 and 41.32 to 41.53 for 41.7 (its estimator reads 0.1 to 0.4 ms early; its gate is 1 ms).
- Synthetic try in the shell: 97 A, all 18 note verdicts, score and components identical to the web build.
- Packet delivery delay in the shell during a try: p50 about 5 ms, p99 16 to 26 ms, max 57 to 79 ms; no gap, backlog or xrun.
- Real audio library against a PulseAudio null sink (virtual path, not hardware): loopback 8 of 8, 7.09 to 7.15 ms, MAD under 0.005 ms.
- Reviewer's Mac-like simulation (128 frames, 0.3 ms jitter): click arrival error at most 0.012 ms.
- Nothing has run on real audio hardware.

## Lessons

- While agents are editing, commit with explicit paths. A plain `git commit` once picked up half of a staged file move and broke CI.
- WIP checkpoint commits carry `[skip ci]` so they do not spend macOS and Windows minutes.
- `ubuntu-latest` names the WebKit WebDriver package `webkitgtk-webdriver`.
- Timing assertions on the sleep-paced fake device must tolerate loaded CI runners.

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
