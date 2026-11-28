# Mobile builds (iOS and Android)

Status: compiled and unit-tested on Linux; the Android and iOS builds run only in CI (`.github/workflows/native-mobile.yml`). Nothing here has run on a phone yet.

## How the projects are made

`src-tauri/gen/` stays out of git. Each CI job (and each developer) runs `pnpm tauri android init` or `pnpm tauri ios init`, which writes the Gradle and Xcode projects from three inputs that are in git:

- `src-tauri/tauri.conf.json`: identifier `app.sightread.trainer`, `bundle.iOS.minimumSystemVersion` 15.0, `bundle.android.minSdkVersion` 26 (AAudio is always present). The development team is not stored; it comes from `APPLE_DEVELOPMENT_TEAM` or from Xcode.
- `src-tauri/Info.ios.plist`: `NSMicrophoneUsageDescription`, same wording as `Info.plist` on macOS. No background audio mode is declared.
- The plugin `src-tauri/plugins/tauri-plugin-sr-audio-session/`: its `AndroidManifest.xml` adds `RECORD_AUDIO` and `MODIFY_AUDIO_SETTINGS`, requires `android.hardware.microphone`, and lists `audio.low_latency` and `audio.pro` as not required. Gradle merges it into the app manifest. The Swift package is linked by the CLI.

Nothing needed committing from `gen/`. The one thing `init` gets wrong for us is the launcher icon: it writes the default one, so the jobs run `pnpm tauri icon src-tauri/icons/icon.png` after `init`, which rewrites the icons inside `gen/`. The source icon is 512 px; the App Store needs an opaque 1024 px master (see the checklist).

## What the plugin does

`tauri-plugin-sr-audio-session` has no webview commands. The Rust audio layer (`src-tauri/src/mobile.rs`) calls it, and only in mobile builds; desktop code paths are unchanged.

- Permission: `audio_permission` asks the plugin (iOS `AVAudioApplication` on 17 and later, `AVAudioSession` before; Android `RECORD_AUDIO` requested from the activity).
- `audio_open` configures the session first, then opens the cpal streams, then reads the facts again. iOS: category `playAndRecord`, mode `measurement`, options `defaultToSpeaker` and `allowBluetoothA2DP`, preferred rate 48000, preferred IO buffer 5 ms (cpal is asked for 240 frames, because it sets the session buffer from the size it is given), `setActive(true)`. `audio_close` closes the streams, then deactivates the session. Android: audio focus request and abandon.
- Latency: iOS `outputLatency` and `inputLatency` are the device parts, `ioBufferDuration` the buffer parts; trust follows the design (A for built-in, wired, USB). Android reports no latency, so its parts stay what cpal gives and trust is C. Nothing is estimated.
- Route: port uids and transports (built-in, wired, usb, bluetooth, hdmi, network) from `AVAudioSession.currentRoute` and from `AudioManager`; `sessionType` is `play-and-record` on iOS.
- Events: interruption began, media services reset and lost audio focus become `interruption`; route changes and Android device changes become `route`, with the facts read again. cpal also reports route changes and restarts its streams after an interruption, so the app may see both.

## What CI proves and what it cannot

- `android` job: the Android project generates, the Rust crates (cpal AAudio, symphonia, our audio crates) and the Kotlin plugin compile and link for arm64, and a debug APK is produced. The merged manifest is printed so the permissions and features can be read in the log.
- `ios` job: the Xcode project generates, Rust and the Swift plugin compile for the simulator without signing, and a `.app` is produced.
- Local Linux checks: `cargo check` of the whole app for `aarch64-linux-android` and `aarch64-apple-ios` (the latter needs a stub C compiler for one Objective-C build script), clippy on both, and unit tests of the mapping and the session wrapper against a scripted plugin.
- Only a phone shows: the permission prompt text and flow, whether `measurement` mode and the 5 ms buffer are honoured, the reported latencies against a measured loopback, interruption and route-change behaviour (call, headphones, Bluetooth), and AAudio behaviour on real devices.

## Run it on an iPhone

You need a Mac with Xcode and Rust; a free Apple ID (personal team) is enough for your own phone.

1. In Xcode, Settings, Accounts: add your Apple ID. Note the personal team id shown under the team.
2. `rustup target add aarch64-apple-ios`, `brew install xcodegen`, `pnpm install`.
3. `export APPLE_DEVELOPMENT_TEAM=<team id>`, then `pnpm tauri ios init` and `pnpm tauri icon src-tauri/icons/icon.png`.
4. Connect the phone, enable Developer Mode (Settings, Privacy and Security), then `pnpm tauri ios build --debug --open` and press Run in Xcode with the phone selected.
5. First launch: Settings, General, VPN and Device Management, trust the developer profile. The bundle id may be taken for a free team; change it in Xcode only, not in git. Personal-team builds expire after 7 days.
6. Allow the microphone when asked, open the onboarding, and note the route and latency the app reports.

## Run it on an Android phone

1. Open the latest `native-mobile` run on GitHub and download the artifact `sightread-android-debug-apk`.
2. On the phone, enable Developer options and USB debugging. On the computer: `adb install -r <file>.apk`.
3. Allow the microphone on first use. The debug build is signed with the Gradle debug key, which is fine for this and not for the Play Store.

## Store checklist for later

- Apple: Apple Developer Program membership; bundle id `app.sightread.trainer` registered; distribution certificate and App Store provisioning profile (or an App Store Connect API key for CI); an App Store Connect record; a 1024 px opaque icon; privacy nutrition label: microphone used for app functionality, no data collected, no tracking; export compliance answers; TestFlight before review. A signed job would add `APPLE_DEVELOPMENT_TEAM` and the key secrets and run `pnpm tauri ios build --export-method app-store-connect`.
- Google Play: a Play Console account; an upload keystore kept off the repository, wired in through a `keystore.properties` written by the job from secrets; `pnpm tauri android build --aab`; the data safety form (microphone audio is processed on the device and not collected or shared); content rating; target API level current at submission.
- Both: a privacy policy URL that says the sound stays on the device; screenshots; the usage text in `Info.ios.plist` is shown to users and to reviewers.

## Known gaps

- The iOS job's first attempt is `tauri ios build --target aarch64-sim`, which may stop at export for lack of a team; the job then builds with `xcodebuild` and signing off. Which path works is decided by the first CI run.
- iOS clock relation stays `unknown` (two separate cpal streams, no shared device id), so capture uses the resampled path.
- Android: the AAudio timestamp delay is not forwarded, so there is no reported latency and trust is C; the input preset (unprocessed) cannot be set through cpal.
- Android device selection is a guess before a stream exists (external device over built-in); from API 33 the output asks the system.
- `route.processing` flags are not reported on either platform.
