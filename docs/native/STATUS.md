# Native app status

Branch `claude/native-tauri`, started from `claude/modest-hopper-enh3o5` at `4b84f11`. This file is the handoff: read it first when resuming.

## Milestones

| # | Milestone | State |
| --- | --- | --- |
| 1 | Tauri scaffold and Linux build | done |
| 2 | Native playback and clock | done |
| 3 | Native capture and analysis feed | done |
| 4 | Calibration and latency | done in code; no number from real hardware yet |
| 5 | Parity pass and CI for all platforms | done for desktop; mobile builds in CI, mobile export and licence links not implemented |
| 6 | Review and final verification | done: independent review, fixes, full verification on commit `738a4dd` |

## In progress

Nothing. Waiting for the owner's first run on a Mac (`docs/native/TRY-ON-MAC.md`).

## Final verification (commit `738a4dd`, Linux container)

- `pnpm typecheck`, `pnpm lint`, `pnpm lint:copy`, `pnpm schemas:check`, `pnpm validators:check`, `pnpm test:bare`, `pnpm build`, `pnpm size` (initial 73.5 KB): pass.
- `pnpm test`: 4679 of 4679. `pnpm test:e2e --trace off`: 105 passed, 151 skipped (the same skips as at the branch point).
- `pnpm gates`: 194 of 195, the known voice room limit (R54).
- `cargo test --workspace --all-features`: 159 passed. Clippy clean with `-D warnings`.
- `pnpm tauri build --debug --no-bundle`, `tools/native/smoke-linux.sh`, `tools/native/e2e-linux.sh` (main, timing, data): pass.
- `origin/claude/modest-hopper-enh3o5` had no commits after the branch point (`4b84f11`), so there was nothing to merge.

## Next step

1. Owner runs `docs/native/TRY-ON-MAC.md` and sends the numbers back.
2. From those numbers: confirm or change the 3 ms loopback floor (R86), decide the stamp source on CoreAudio (`AUDIO-DESIGN.md` section 11), and run the hardware acceptance (MAD at most 0.5 ms within a run, 1 ms across restarts).
3. Open items: mobile export (share sheet) and licence links on mobile; Android latency reporting; a device run on iPhone and Android; signing and notarisation once there is an Apple Developer account; `pnpm native:gates:resampled --quick` is not in CI.
4. When the web branch moves on, merge it here and rerun the list above.

## Measured so far (simulated device unless stated)

- Scheduled sound starts on the exact frame (0 frames error).
- Loopback of a 23.4 ms path: 23.400 ms from the page, MAD 0.
- The app's own calibration reads 23.05 to 23.17 ms for 23.4 and 41.32 to 41.53 for 41.7 (its estimator reads 0.1 to 0.4 ms early; its gate is 1 ms). Short profile about 11.5 s, standard 13 to 16 s.
- Synthetic try in the shell: 97 A, all 18 note verdicts, score and components identical to the web build.
- Packet delivery delay in the shell during a try: p50 about 5 ms, p99 16 to 26 ms, max 57 to 79 ms; no gap, backlog or xrun.
- Resampled-path gates (controlled): every gate keeps its result; onset change at most 0.008 ms; pitch p99 0.000 cent, one note 0.86 cent.
- Real audio library against a PulseAudio null sink (virtual path, not hardware): loopback 8 of 8, 7.09 to 7.15 ms, MAD under 0.005 ms.
- Nothing has run on real audio hardware.

## Lessons

- While agents are editing, commit with explicit paths. A plain `git commit` once picked up half of a staged file move and broke CI.
- WIP checkpoint commits carry `[skip ci]` so they do not spend macOS and Windows minutes.
- `ubuntu-latest` names the WebKit WebDriver package `webkitgtk-webdriver`.
- Timing assertions on the sleep-paced fake device must tolerate loaded CI runners. Two core timing tests failed once under heavy local load and passed on rerun.
- `pnpm gates` rewrites `docs/accuracy-report.md` and `tools/gates/artifacts/accuracy.json`; restore them unless the web branch owner wants them refreshed.

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
