# Native app status

Branch `claude/native-tauri`, started from `claude/modest-hopper-enh3o5` at `4b84f11`. This file is the handoff: read it first when resuming.

## Milestones

| # | Milestone | State |
| --- | --- | --- |
| 1 | Tauri scaffold and Linux build | done |
| 2 | Native playback and clock | done; verified on the simulated device and in the Linux shell |
| 3 | Native capture and analysis feed | done; a synthetic try grades exactly as on the web (`tools/native/e2e-linux.sh`) |
| 4 | Calibration and latency | loopback and latency reporting done; native calibration service in progress |
| 5 | Parity pass and CI for all platforms | CI builds all five (commit `d22ae8c`: Linux with smoke and e2e, macOS, Windows, Android debug APK, iOS simulator app); export, import, storage, keep-awake and links done on Linux (see "Shell services"); macOS, Windows, iOS and Android unverified |
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
- Export no longer relies on a download link in the shell (see "Shell services"); the save dialog has only been seen on Linux.
- See the ranked risk list in `AUDIO-DESIGN.md` section 9.

## Shell services (export, import, storage, keep awake, links)

Code: `src-tauri/src/files.rs` (commands `save_file`, `open_licence`, `keep_awake`), `src/platform/native/files.ts`, the save seam `src/ui/save-file.ts`. The `data` scenario of `tools/native/e2e-linux.mjs` exercises all of it on Linux (`bash tools/native/e2e-linux.sh data` runs just that one; `SR_E2E_PORT` and `SR_E2E_OUT` let two runs go at once).

- **Save.** Every export (backup, diagnostics in Settings > Data and in the diagnostics dialog, calibration diagnostics) calls `saveFile(name, text or bytes, mime)`. On the web it is the Blob-URL link click, unchanged. In the shell `main.tsx` installs the native saver, which sends the bytes to `save_file`; Rust shows the system save dialog (`rfd`, desktop only) and writes the file the player chose. The page never names a path. Cancel shows nothing; a failure shows the existing "The export didn't work" line. iOS and Android answer `not-available` (shown as a failed export): no dialog that can be relied on was tried blind. A share sheet is the likely mobile route. R64 is untouched: only the transport changed.
- **Test bypass.** Only with both `SR_E2E_HOOKS=1` and `SR_E2E_SAVE_DIR` set does `save_file` write to that directory without a dialog (file name reduced to its last path component). A Rust unit test pins the two-variable rule.
- **Import.** The `<input type=file>` works in WebKitGTK: WebDriver set a path, the page read it and imported (the `data` scenario). No open-file command was added. Mac and mobile pickers are the system ones and untested here.
- **Storage.** Bundled origin: `tauri://localhost` on macOS, Linux and iOS; `http://tauri.localhost` on Windows and Android. `tauri.conf.json` sets `useHttpsScheme: false` explicitly, because Tauri's docs warn that changing it between releases moves IndexedDB, cookies and localStorage and strands the player's data; `false` also keeps the CSP's `http://ipc.localhost` valid. `androidTauriProtocolHostname` stays unset for the same reason. A vitest checks both (`src/platform/native/identity.test.ts`). The dev server (`http://localhost:5173`) is a different origin from the bundle, so dev data and installed-app data never mix and there is no migration. Observed on Linux: IndexedDB, the localStorage install mirror and a key-value marker survive quitting and relaunching. In WebKitGTK `isSecureContext` is true, `crypto.randomUUID` exists, and `navigator.storage` is **undefined** (no `persist`, `persisted`, `estimate`): the app already guards each (persist request returns null, storage size line is hidden). `idGen` now falls back to `getRandomValues` when `randomUUID` is missing (`src/platform/shared/uuid.ts`); the web build still calls `randomUUID`.
- **Keep awake.** `navigator.wakeLock` is not used in the shell. `keep_awake` holds an OS lock: desktop `keepawake` crate (display and idle), mobile the existing session plugin (`UIApplication.isIdleTimerDisabled`, `FLAG_KEEP_SCREEN_ON`; a few lines of Swift and Kotlin, not compiled anywhere yet). It sits behind the same `KeepAwakeController`, so the rules (start of practice, release on leave, five minutes idle on results) are unchanged. On Linux it needs a D-Bus session bus; without one (this container) it fails cleanly and the controller raises its hint flag, which only iPhone and iPad show.
- **Links.** A webview ignores `target=_blank`. In the shell a capture-phase click handler sends http(s) links to other origins to the system browser through the opener plugin, whose capability allows only `https://*` and `http://*` (`open_path` and every other opener command are not granted), and opens `LICENSES/<name>.txt` of the bundle in a small window of its own (`open_licence`, desktop). Mobile has no second window: licence links do nothing there yet (decision for the owner: an in-app view needs new UI). `mailto:` links are left to the webview.
- **Name and version.** `productName`, the window title and the copy catalogue's `app.name` are `Sightread`; the page title already ends with it; `tauri.conf.json`, `Cargo.toml` and `APP_VERSION` in `main.tsx` are all 0.1.0 (a vitest checks they agree).
- **Dependency note.** `tauri-plugin-dialog` could not be used: cargo resolves it only by downgrading `tauri` below the version the lock has. `rfd` (what the plugin wraps) is used directly, pinned, with its GTK 3 backend on Linux.
