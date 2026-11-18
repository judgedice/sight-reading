# 05 — iOS: Safari constraints, web accommodations, and the iOS fork

Owner: senior iOS engineer. Readers: overseer, technical architect (01), lead musician (02), score researcher (03), senior designer (04), and the implementers who build `audio/`, `store/`, `session/`, the PWA shell, and later the iOS target.

This section does four things:

1. States what iOS Safari and home-screen web apps can and cannot do for this product, so web v1 works on iPhone and iPad from day one.
2. Lists the accommodations the web team must build now (numbered W1 to W16, each with acceptance criteria).
3. Recommends the shape of the iOS fork (a Capacitor shell around the shared web UI and TypeScript core, with native audio, MIDI, haptics, and storage plugins) and lists which iOS-only features go into fork v1, later, or never.
4. Defines what the web codebase must keep portable, the fork architecture, a phased plan, and App Store and privacy requirements.

Platform facts below are as of iOS/iPadOS 18 and 26. Facts marked (verify) are behaviour that has changed across releases or is reported inconsistently. Each one has a test in the device matrix (section 2.4), and the code must feature-detect rather than assume.

---

## 1. Summary of decisions

| Area | Decision |
| --- | --- |
| Web v1 on iOS | Supported in Safari and as a home-screen web app on iOS/iPadOS 17.0+ (matches 01 section 2.3). Primary test targets iOS 18.x and 26.x. Every browser on iOS uses WebKit, so "Chrome on iPhone" has Safari's constraints. |
| Install prompt | Show an "Add to Home Screen" coach mark on iOS after the first graded attempt. Home-screen web apps get their own storage, are exempt from Safari's 7-day storage deletion, and support wake lock and web push. |
| Fork shape | Capacitor (current major, pinned) iOS target in the same repository (`ios/`), not a git fork. The WebView runs the same React UI, VexFlow renderer, and DOM-free core. Native Swift plugins replace audio I/O, metronome, storage, and add MIDI, haptics, and system integration. |
| DSP location in the fork | The shared TypeScript `DspPipeline` and `LiveFollower` keep running in the WebView's DSP worker. Native code captures, decimates to the same ~16 kHz analysis rate, timestamps on the native audio clock, and streams blocks over the bridge. No Swift port of `dsp/` or `follow/` in fork v1. |
| Fallback if the bridge is too slow | Run the same compiled `dsp`+`follow` bundle in a native `JSContext` (JavaScriptCore) on a dedicated thread and send only `FollowerEvent`s to the WebView. A Swift port of DSP is the last resort and needs the overseer's approval. |
| Native SwiftUI app | Rejected for fork v1. Rebuilding notation rendering and the overlay natively is the largest cost in the product and buys little. SwiftUI is used only for extensions (widgets, Watch) that cannot be web. |
| Native audio session | `AVAudioSession` category `.playAndRecord`, mode `.measurement`, options `[.defaultToSpeaker, .allowBluetoothA2DP]`, never `.allowBluetooth` (HFP) by default. Preferred IO buffer 5 ms. Built-in mic preferred via `setPreferredInput`. |
| Voice processing (AEC) | Off by default on both platforms. Experimental flag only. Bleed is handled by click design, filtering, and gating (01 section 5.6), plus the haptic metronome on iPhone. |
| Fork v1 headline features | Native low-latency audio with reported and measured latency, correct speaker routing, built-in mic with AirPods output, haptic metronome (iPhone), CoreMIDI keyboard input, offline bundled corpus, native document store, iPad landscape stand layout, idle-timer and orientation control. |
| Later | Game Center leaderboards, WidgetKit streak widget, local streak reminders, CloudKit private sync, Apple Watch haptic click, App Intents/Shortcuts, Live Activities, Pencil annotations for a teacher mode, on-device polyphonic transcription research. |
| Never | Sign in with Apple without a backend, background audio mode, ATT/tracking, OTA JavaScript updates in v1, Mac Catalyst build. |

---

## 2. What iOS Safari and home-screen web apps can and cannot do

### 2.1 Capability table

| Capability | Status on iOS 17 to 26 | Consequence for this product |
| --- | --- | --- |
| `getUserMedia` audio | Supported in Safari and in home-screen web apps. Requires HTTPS and a user gesture for the prompt. Permission may be re-asked per session in home-screen apps and after reload (verify per version). | Pre-prompt screen (04 step 3) is required. Keep one stream open for a whole practice session instead of reopening per exercise. |
| Processing constraints `echoCancellation`, `noiseSuppression`, `autoGainControl` | Accepted as constraints. Whether `false` actually disables voice processing on iOS has varied by release; Safari has tended to treat the three as one switch (verify). | Request all three `false`. Read back `track.getSettings()` and store what was actually applied in the attempt (W5). Never trust the request. |
| Device selection (`deviceId`) and labels | `enumerateDevices` returns labels only after permission. Built-in mic and AirPods mic appear as separate inputs; honouring `deviceId` for the built-in mic while AirPods are connected is unreliable (verify). | `Calibration.deviceKey` must be computed after permission and must include the output route guess. Treat label strings as hints, not identity. |
| Bluetooth input | Opening the AirPods mic switches the route to HFP: narrowband capture (about 16 kHz sample rate or lower, voice processing applied) and degraded output. | Pitch detection above ~4 kHz is irrelevant, but HFP adds processing and latency and ruins click audio. Detect and warn (W8). The fork fixes this properly. |
| Bluetooth output (A2DP, AirPods) | Works for output only when the mic is the built-in one. Output latency 150 to 300 ms typical; AirPlay is worse (1 s or more). | Loopback calibration cannot hear the click in someone's ears; use play-along (01 section 5.7). Block AirPlay output during takes with a message. |
| AudioWorklet | Supported (Safari 14.1+). Module workers supported. `MessagePort` transfer from the worklet node to a worker works. | 01 section 5.2 graph works unchanged. No ScriptProcessor fallback needed. |
| `SharedArrayBuffer` | Requires COOP/COEP headers; GitHub Pages cannot send them. | Already decided in 01: MessagePort, no SAB. Keep it that way; it also keeps the WKWebView path simple. |
| `AudioContext.sampleRate` | Hardware is usually 48 kHz. Contexts created before capture starts have been reported to run at 44.1 kHz and then mis-resample when the mic opens, shifting detected pitch by about 147 cents or causing crackle (verify on each release). | Create the context after `getUserMedia` resolves, compare rates, recreate on mismatch, and run a pitch sanity tone during calibration (W3). |
| `baseLatency`, `outputLatency`, `getOutputTimestamp` | `outputLatency` is not reported (0 or undefined); `baseLatency` may be present but small and incomplete. | Calibration is mandatory on iOS; the "reported" method must never be the silent default on iOS (W6). |
| Output routing while recording | In some record configurations output goes to the earpiece receiver on iPhone, so the click is quiet. | Loopback calibration detects this (low click level). Play-along fallback plus a "turn volume up" hint. The fork fixes it with `.defaultToSpeaker`. |
| Ring/silent switch | Web Audio is muted by the silent switch unless the audio session is a playback or play-and-record type. Capture puts the page in play-and-record, but behaviour before capture starts differs (verify). | Set `navigator.audioSession.type = 'play-and-record'` before opening the mic where the API exists (Safari 16.4+). Detect a silent count-in via loopback and tell the player to flip the switch. |
| Audio Session API (`navigator.audioSession`) | Present since Safari 16.4 (`auto`, `playback`, `transient`, `transient-solo`, `ambient`, `play-and-record`). Effect on routing is limited. | Feature-detect and set. Record the value in diagnostics. Not a substitute for calibration. |
| Interruptions | Phone call, Siri, alarm, another app's audio, Control Center audio controls. Safari moves the context to a non-standard `interrupted` state and may mute the mic track. | Abort and void the take (04 section 9). Resume needs a new user gesture. |
| Background and screen lock | When the page is hidden or the screen locks, capture stops, timers are throttled or frozen, and the context suspends. No background audio for web content. | On `visibilitychange` to hidden: abort the take, stop mic tracks (removes the privacy indicator), do not grade. |
| Screen Wake Lock API | Supported in Safari 16.4+. In home-screen web apps it did not hold the screen until a later fix (reported fixed in 18.4; verify). Released on visibility change. | Request on take start, re-request on return to visible. Do not use the hidden looping video hack. |
| Vibration API | Not supported on iOS. | No haptic metronome on the web. Fork-only feature. |
| Web MIDI | Not supported in Safari, and not planned by WebKit. | Keyboard MIDI input on iOS exists only in the fork (CoreMIDI). |
| Fullscreen API | iPad: element fullscreen works. iPhone: video only. | Performance screen relies on the home-screen app (no browser chrome) on iPhone. |
| Orientation lock | `screen.orientation.lock()` unsupported; manifest `orientation` is not honoured on iOS (verify). | Layout must handle both orientations at all times (04 already does); show "rotate to landscape" hint on phone portrait during a take. The fork locks natively. |
| Storage (IndexedDB) | Safari tab: script-writable storage is deleted after 7 days of Safari use without visiting the site. Home-screen web apps have separate storage and are exempt. Quotas are a large fraction of free disk in Safari 17+. `navigator.storage.persist()` exists; grant is heuristic. | Install prompt, persist request, backup export, and a storage-loss detector (W12, W13). |
| Service worker | Supported in Safari and home-screen apps. Not available in WKWebView on a custom scheme (the Capacitor default) unless app-bound domains are configured. | Web: `vite-plugin-pwa` as planned. Fork: do not register the service worker; offline comes from bundled files (F1). |
| Web Push and Badging | Home-screen web apps only, Safari 16.4+. Push needs a server. | Not in web v1 (no backend). Local reminders are a fork feature. |
| Performance | iPhone 11-class A13 is the slowest device worth supporting. Low Power Mode throttles timers and CPU. | DSP budgets in 01 section 10 must be met on iPhone 12 (≤ 3 ms per hop); measure on A13 too and auto-degrade (W15). |

### 2.2 Latency expectations

Numbers are planning ranges, not guarantees. The device matrix replaces them with measurements before tolerances are frozen (02 open questions depend on these).

| Path | Round-trip latency (click out to captured sound) |
| --- | --- |
| iOS Safari, built-in speaker and mic | 40 to 120 ms, device and version dependent; jitter 2 to 5 ms |
| iOS Safari, wired headphones (USB-C or adapter) with built-in mic | Not measurable by loopback; play-along gives output 15 to 40 ms plus player bias |
| iOS Safari, AirPods output | 150 to 300 ms output; play-along only |
| Native AVAudioEngine, 5 ms buffer, built-in speaker and mic | Target 15 to 35 ms, reported by `AVAudioSession.inputLatency + outputLatency + 2 × ioBufferDuration` and confirmed by loopback |
| Native, AirPods output, built-in mic | Reported `outputLatency` plus play-along correction |
| Native, CoreMIDI keyboard input | Input path about 1 to 5 ms; compensation is output latency only (section 4.4) |

The architecture's clock model (01 section 5.1) needs only RTL. That holds on iOS for microphone input. For MIDI input it does not (section 4.4), so `Calibration` must also carry an output-only latency.

### 2.3 Metronome bleed on iOS specifically

Phone speakers and mics sit a few centimetres apart, and iPhone voice processing is tuned for speech. Order of preference:

1. Haptic metronome (fork, iPhone only): no acoustic bleed at all.
2. Wired headphones: no bleed; play-along calibration.
3. Built-in speaker with the 01 section 5.6 click design (high-passed noise burst), 4 kHz analysis low-pass, and click-window gating. Default.
4. `countInOnly` metronome mode after the count-in.
5. AEC (`echoCancellation: true` on the web, voice processing natively): experimental only. AEC treats sustained tones as echo, AGC moves the level mid-note, and both add latency. It may only be enabled if the synthetic suite (01 section 11.2) re-run with AEC captures shows pitch accuracy within ±10 cents and onset p90 within ±25 ms.

### 2.4 Device and version test matrix

Run the "iOS audio checklist" (W16) on each row before every web release that touches `audio/`, and record results in `docs/ios/latency-log.md`.

| Device | OS | Why |
| --- | --- | --- |
| iPhone SE (2nd or 3rd gen) or iPhone 11 | Oldest supported (17.x) | Performance floor (A13/A15), Touch ID layout |
| iPhone 13 or 14 | 18.x | Mainstream |
| iPhone 16 or 17 | 26.x | Current, Dynamic Island, newest WebKit |
| iPad (9th or 10th gen) | 17.x or 18.x | Cheapest iPad, Lightning or USB-C, music-stand use |
| iPad Air or Pro (M-series) | 26.x | Stage Manager and iPadOS 26 windowing, Pencil |
| Each of the above in Safari tab and home-screen app | | Storage, wake lock, and permission behaviour differ |
| With AirPods connected, with wired USB-C headphones, silent switch on and off, Low Power Mode on | | Routing and throttling |

---

## 3. Web-side accommodations to build now

These live in `audio/`, `store/`, `session/`, and `app/` (01 section 3). Each item has an owner module and acceptance criteria. Items W1 to W8 block a credible iOS launch of web v1.

**W1. Gesture-bound audio startup.** `audio/` exposes `unlock()` called synchronously from the Start/Allow button handler. Order: set `navigator.audioSession.type = 'play-and-record'` if present; call `getUserMedia`; create the `AudioContext` after it resolves; `resume()`; add the worklet. Accept: on all matrix devices the first press of Start produces an audible count-in with no second tap; no `NotAllowedError` from `resume()`.

**W2. One session-long stream.** Keep the `MediaStream` and context alive across consecutive exercises in one practice session; close them on leaving the practice screen, on hide, and after 5 minutes idle on the results screen. Accept: ten exercises in a row on iOS produce at most one permission prompt; the mic indicator disappears within 2 s of leaving practice.

**W3. Sample-rate guard and pitch sanity tone.** After opening, compare `ctx.sampleRate` with `track.getSettings().sampleRate` (when reported). On mismatch, close and recreate the context once. During calibration, play a 300 ms sine at concert A4 (using the configured `a4Hz`) through the speaker and require the detector to read it within ±8 cents. Failure shows "Audio setup problem; please reload" and is logged in diagnostics. Accept: a forced 44.1/48 mismatch in a test harness is caught; on matrix devices the tone reads within ±8 cents.

**W4. Interruption and visibility handling.** Listen to `AudioContext.onstatechange` (treat `interrupted` and `suspended` alike), `MediaStreamTrack` `mute`/`ended`, `visibilitychange`, and `pagehide`. Any of these during `count-in` or `performing` aborts the take with reason `interrupted`, voids it (not graded, not counted, no points), stops tracks on hide, and requires a gesture to restart. Accept: an incoming call, Siri, locking the screen, and switching apps each void the take and leave the app restartable without reload.

**W5. Applied-constraints record.** Read `track.getSettings()` after opening and store `{ echoCancellation, noiseSuppression, autoGainControl, sampleRate, channelCount, deviceLabelHint }` in the calibration and in `AttemptRecord` (new optional field `audioEnv`, see section 5.3). Accept: values appear in the diagnostics screen and in exported attempts.

**W6. Calibration is mandatory on iOS.** On iOS (`/iP(hone|ad|od)/` in UA, or `Macintosh` with touch points > 1 for iPadOS), the first take cannot start until loopback or play-along calibration has succeeded for the current `deviceKey`. The `reported` method is allowed on iOS only after two failed attempts at both other methods, and then attempts are flagged. Accept: fresh install on an iPhone goes through calibration before the first take.

**W7. Route-change invalidation.** On `navigator.mediaDevices.ondevicechange`, recompute `deviceKey`; if it changed, mark calibration stale and require recalibration before the next take. If the change happens mid-take, void the take. Accept: connecting AirPods between takes forces recalibration; connecting them mid-take voids the take.

**W8. Bluetooth and AirPlay detection.** Heuristics: input label matches `/airpods|bluetooth|beats|headset/i`, or RTL > 120 ms, or a measured capture bandwidth that drops above about 4 kHz (energy above 4 kHz ≥ 30 dB below the 1 to 4 kHz band during the calibration noise burst). Show 04's "Bluetooth output detected" banner with text recommending the built-in mic and wired headphones, and on iOS add: "AirPods microphones reduce accuracy. Disconnect them or use the iPhone mic." Accept: AirPods mic is detected on matrix devices in at least 9 of 10 trials.

**W9. Metronome scheduled up front.** Because takes are at most 12 bars plus count-in (worst case about 60 clicks), schedule every click `AudioBufferSourceNode` at take start instead of relying on a lookahead timer. Keep the lookahead scheduler only for open-ended modes. Reason: iOS throttles main-thread timers under load and in Low Power Mode. Accept: with Low Power Mode on and a 200 ms main-thread stall injected mid-take, no click is late by more than 1 ms against its scheduled context time (measured in the loopback channel).

**W10. Pitched-click ban.** Already decided in 01 section 5.6; restated because ear-to-staff's square-wave click at 1.2 and 1.8 kHz must not be carried over. Accept: a lint rule or test fails if any `OscillatorNode` is created in `audio/metronome.ts`.

**W11. Wake lock.** Request `navigator.wakeLock.request('screen')` at count-in start, re-request on return to visible, release on results. Silent on failure (04 already says this). Accept: on iOS 18.4+ home-screen app, a 2-minute take at 40 bpm does not dim the screen with auto-lock set to 30 s.

**W12. Storage persistence and loss detection.** Request `navigator.storage.persist()` after the first completed attempt (01 section 9). Write a `kv` marker `{ installId, createdAt }` on first run and copy `installId` into `localStorage`. On start, if `localStorage` has an `installId` but IndexedDB is empty, or vice versa, show "Your progress on this device was cleared by the browser" with an import button. Accept: clearing website data in Settings > Safari produces the message, not a silent fresh start.

**W13. Install coach mark and backup nudge.** In iOS Safari tab mode (`navigator.standalone !== true` and not `display-mode: standalone`), after the first graded attempt show a one-time sheet explaining Share > Add to Home Screen and why ("keeps your progress safe and the screen awake"). Every 30 days in tab mode, nudge a backup export. Accept: sheet appears once, is dismissible, never appears in standalone mode.

**W14. Manifest and layout details.** `manifest.webmanifest` with `display: standalone`, icons including a 180×180 `apple-touch-icon`, `theme_color`; `viewport-fit=cover` and `env(safe-area-inset-*)` padding (04 section on phone landscape already requires it); `touch-action: manipulation` on the score and controls to remove double-tap zoom; no hover-only affordances; `-webkit-user-select: none` on the score. Accept: no zoom on rapid taps of Start/Stop; nothing under the notch or home indicator in landscape on iPhone 16.

**W15. Performance auto-degrade.** Measure DSP worker time per hop during the count-in. If p95 > 4 ms on the device, switch to the next smaller analysis window for the instrument family where 02 allows it, or disable spectral flux for `tongued-wind` and log `degraded: true` in the attempt. Accept: on an A13 device with Low Power Mode on, no `frames` backlog (worker queue depth > 4 blocks) occurs in a 60 s take.

**W16. Platform seam (the most important item for the fork).** Define `AudioBackend` and `PlatformServices` interfaces in `src/core/platform.ts` (section 5.1) and make `session/` depend only on them. The web implementation lives in `src/platform/web/`. Nothing outside `src/platform/web/` and `audio/` may touch `AudioContext`, `getUserMedia`, `navigator.wakeLock`, `navigator.storage`, or `indexedDB`. Enforce with `eslint-plugin-boundaries`. Accept: `session/` unit tests run against a fake `AudioBackend` that replays WAV fixtures; a grep in CI finds none of those globals outside the allowed folders.

Also required: an "iOS audio checklist" Playwright-free manual script in `docs/ios/checklist.md` (owned by QA or the iOS engineer) covering W1 to W13 on the matrix.

---

## 4. iOS fork: recommendation and reasoning

### 4.1 Options compared

| Criterion | PWA only | Capacitor/WKWebView shell + native plugins | Native SwiftUI app |
| --- | --- | --- | --- |
| Notation rendering and overlay | Shared | Shared (VexFlow in WKWebView) | Rebuild: no mature native engraver; port VexFlow layout or embed a WebView anyway |
| Grading identical to web | Yes | Yes, same TS code | Only via port plus conformance suite, or JavaScriptCore |
| Audio latency, routing, AirPods handling | Poor and version-dependent | Native: `AVAudioSession` control, reported latency, built-in mic with A2DP output | Native |
| Haptic metronome | No | Yes | Yes |
| MIDI keyboards | No | Yes (CoreMIDI plugin) | Yes |
| Widgets, Watch, Game Center, CloudKit | No | Yes (Swift extensions reading the native store) | Yes |
| App Store presence | No | Yes; native features clear guideline 4.2 | Yes |
| Effort to fork v1 | 0 (W1 to W16 only) | About 14 to 18 engineer-weeks | About 40 to 60 engineer-weeks |
| Ongoing cost | None | iOS team maintains `ios/` and plugins; UI changes ship to both | Every web feature built twice |

### 4.2 Recommendation

Ship the PWA first (it is the web v1 with W1 to W16). Then build the fork as a Capacitor iOS target with native plugins. Reasons:

1. The expensive, fast-changing parts of this product are the score view, feedback overlay, corpus selection, grading, and tips. They are already DOM-free TypeScript or web UI. Sharing them is the only way the iOS app keeps parity without a second team.
2. Everything iOS does better than Safari for this product is audio I/O, routing, MIDI, haptics, and system integration. Those are plugin-sized and well bounded.
3. Bridge traffic is small: about 16,000 samples per second of decimated audio (32 KB/s as Int16, about 43 KB/s base64), batched every 32 ms. Blocks carry native timestamps, so bridge jitter delays feedback by at most a frame or two and never changes grades.
4. A plain WKWebView host would also work, but Capacitor gives the plugin bridge, permission plumbing, splash and status-bar handling, and a standard project layout that contractors know. If Capacitor's major-version churn becomes a burden, the plugins are thin enough to rehost in a bare WKWebView.

"Fork" here means a product fork (a separate App Store app with extra features), not a git fork. A git fork would drift from the web core within weeks. The iOS target lives in `ios/` in the same repository and builds from the same commit as the web release.

### 4.3 Why not run the DSP natively

A Swift port of `dsp/` and `follow/` would be faster but creates two implementations that must agree to within ±5 cents and ±10 ms on 300 scenarios. The TS pipeline already fits the budget (01 section 10: ≤ 3 ms per 8 ms hop on iPhone 12) inside a worker. Decision: TS in the WebView worker for F1. Gate for change: if bridge delivery delay p95 exceeds 25 ms or the worker misses budget on the A13 device, move the same TS bundle into a native `JSContext` thread (fallback 1). Only if that fails, port to Swift with the conformance suite in section 5.5 (fallback 2).

### 4.4 MIDI changes the latency model

For microphone input, `scoreSec = onset − t0 − RTL` (01 section 5.1) is correct because both output and input latency apply. For MIDI input the player hears the click `outputLatency` late, plays, and the MIDI event arrives with about 1 to 5 ms delay. So `scoreSec = midiTime − t0 − outputLatency − midiInputLatency`. The fork's native audio plugin reports `outputLatency` from `AVAudioSession` and calibration can refine it by play-along on the keyboard. The web team must not hard-code RTL in `follow/`; it must take a `latencyCompensation` value computed per input path (section 5.3). This also prepares Web MIDI on desktop Chrome (02 v1.1 proposal).

---

## 5. What the web codebase must keep portable

### 5.1 Platform interfaces (new, in `src/core/platform.ts`)

```ts
export type InputPath = 'mic' | 'midi';
export type ClockSeconds = number;   // CtxSeconds on web; native audio-engine sample time / rate in the fork

export interface PlatformCapabilities {
  midiInput: boolean;            // web: Web MIDI present; fork: true
  hapticMetronome: boolean;      // fork on iPhone only
  reportedLatency: boolean;      // true when output/input latency are reported reliably (fork)
  wakeLock: boolean;
  orientationLock: boolean;
  persistentStorage: 'granted' | 'best-effort';
  platform: 'web' | 'ios';
  osVersion: string;             // diagnostics only
}

export interface AudioRouteInfo {
  routeKey: string;              // replaces UA-dependent deviceKey hashing; see 5.3
  inputKind: 'built-in' | 'wired' | 'bluetooth' | 'usb-interface' | 'unknown';
  outputKind: 'built-in-speaker' | 'receiver' | 'wired' | 'bluetooth' | 'airplay' | 'unknown';
  sampleRate: number;
  appliedProcessing: { echoCancellation: boolean | null; noiseSuppression: boolean | null; autoGainControl: boolean | null };
  reportedLatency?: { inputSec: number; outputSec: number; ioBufferSec: number };
}

export interface CaptureBlock {   // identical shape to the worklet's message in 01 section 5.2
  startT: ClockSeconds;           // time of the first sample, input timeline
  lowband: Float32Array;          // decimated ~16 kHz, low-passed at 4 kHz
  hiEnergy: Float32Array;         // ~1 ms sub-block energy above 4 kHz
  analysisRate: number;
}

export interface ClickSpec { beatIndex: number; accent: boolean; t: ClockSeconds }
export type MetronomeMode = 'audible' | 'countInOnly' | 'visual' | 'haptic' | 'haptic+audible';

export interface MidiNoteEvent { t: ClockSeconds; note: number; velocity: number; on: boolean; channel: number; sourceId: string }

export interface AudioBackend {
  readonly capabilities: PlatformCapabilities;
  unlock(): Promise<AudioRouteInfo>;                            // call from a user gesture
  now(): ClockSeconds;                                          // best estimate of the clock, for the playhead
  audibleNow(): ClockSeconds;                                   // now() minus output latency
  scheduleTake(p: { leadSec: number; bpm: number; beatsPerBar: number; countInBeats: number;
                    totalBeats: number; mode: MetronomeMode }): Promise<{ t0: ClockSeconds; clicks: ClickSpec[] }>;
  cancelTake(): void;
  capture(port: MessagePort | ((b: CaptureBlock) => void)): void; // web: transferred port; fork: callback fed by the bridge
  onMidi?(cb: (e: MidiNoteEvent) => void): () => void;
  playCalibrationClicks(times: ClockSeconds[]): Promise<void>;
  playTone(hz: number, durSec: number, at: ClockSeconds): Promise<void>; // W3 sanity tone
  onRouteChange(cb: (r: AudioRouteInfo) => void): () => void;
  onInterruption(cb: (reason: 'call' | 'system' | 'background' | 'device-lost') => void): () => void;
  close(): Promise<void>;
}

export interface PlatformServices {
  audio: AudioBackend;
  repos: StoreRepos;               // the 01 section 3.2 repo interfaces, unchanged
  keepAwake(on: boolean): Promise<void>;
  lockOrientation(o: 'landscape' | 'any'): Promise<void>; // no-op on web
  haptic?(kind: 'success' | 'warning' | 'error'): void;   // results feedback; no-op on web
  openSettings?(): void;           // fork: deep-link to app settings when mic is denied
}
```

Rules:

- `session/` receives `PlatformServices` through `SessionDeps`. It never imports from `src/platform/*`.
- `calibration` analysis (finding click arrivals in `hiEnergy`, medians, MAD checks) lives in pure TS (`audio/calibration-core.ts` or `dsp/`), not in the web backend, so the fork reuses it. Backends only play sounds and deliver blocks.
- The decimator and high-band energy computation are specified as pure functions with fixed coefficients (four cascaded biquads at 4 kHz, decimation factor `round(rate / 16000)`), so the Swift implementation can match them (conformance in 5.5).

### 5.2 Pure-core rules (adds to 01 section 2.1)

- `theory`, `instruments`, `corpus`, `dsp`, `follow`, `grade`, `tips`, `session`, and `core` must run in a plain `JSContext` with no `window`, `document`, `navigator`, `fetch`, `crypto.subtle`, `structuredClone`, `requestAnimationFrame`, or timers other than those injected. Add a CI job that bundles them with esbuild to one IIFE and executes the synthetic scenario suite in a minimal runtime (QuickJS or a Node `vm` context with only ES2022 globals). This proves JavaScriptCore fallback 1 is available.
- Randomness only through the seeded `Rng` in `core/rng.ts`; ids via an injected `idGen()` (web: `crypto.randomUUID`; fork: native UUID).
- Time only through injected clocks. No `Date.now()` in core; `createdAt` comes from `PlatformServices`.
- Config files (`grading-config.json`, `levels.json`, `tips.json`, instrument table, tolerance table) are loaded by the platform and passed in as data. Core never fetches.
- Asset URLs are relative (`./corpus/v1/...`), never origin-absolute, so they work from `capacitor://localhost`.
- No `eval` or `new Function` (CSP and App Review hygiene).
- `PracticeSession` must not assume `AudioContext` time: it treats `ClockSeconds` opaquely.

### 5.3 Data model additions (proposed to the architect)

All additive and optional, so web v1 schema version 1 does not change meaning.

```ts
export interface Calibration {
  deviceKey: string;                // keep the name; value = routeKey from AudioRouteInfo
  roundTripMs: number;
  outputLatencyMs?: number;         // needed for MIDI and haptic paths
  hapticLatencyMs?: number;         // fork, iPhone, play-along on haptic pulses
  method: 'loopback' | 'play-along' | 'reported' | 'reported+loopback';
  clickLeakDb: number; noiseFloorDb: number; measuredAt: string; spreadMs: number;
  platform?: 'web' | 'ios';
}

// AttemptRecord gains:
audioEnv?: {
  platform: 'web' | 'ios'; appBuild: string; coreVersion: string;   // coreVersion = version of the shared core bundle
  inputPath: InputPath; metronomeMode: MetronomeMode;
  route: Pick<AudioRouteInfo, 'inputKind' | 'outputKind' | 'sampleRate' | 'appliedProcessing'>;
  latencyCompensationMs: number;    // what follow/ actually subtracted
  degraded?: boolean;               // W15
};
```

- `routeKey` on web: hash of `inputLabel | outputKindGuess | sampleRate | uaFamily` (01's definition). In the fork: hash of `AVAudioSessionPortDescription.uid` for input and output plus sample rate. Same field, different recipe; never compared across platforms.
- Attempts made with `inputPath: 'midi'` are graded by the same `grade/` code but are kept separate for rank and leaderboards (MIDI removes pitch-detection error and intonation, so they are not comparable). The lead musician decides whether MIDI attempts count toward rank at all (open question 3).
- All records are versioned JSON documents with ISO 8601 UTC timestamps and UUID ids, so the native store can hold them unchanged and the export file is the same on both platforms (import from web into iOS must work).

### 5.4 Corpus format

Already static JSON shards plus a manifest (01 section 4.2, 03). Requirements for the fork:

- Manifest lists every shard with a content hash and byte size, and the corpus version. The fork bundles `public/corpus/v1/` verbatim and verifies hashes on first launch.
- `attributions.json` and `withdrawn.json` are bundled; the credits page is the same web screen.
- Total corpus size target for bundling: ≤ 30 MB uncompressed. Above that, discuss On-Demand Resources or a remote manifest.
- Corpus files are data, not code, so updating them from a server later is allowed under App Review guideline 2.5.2.

### 5.5 Conformance suite shared by both platforms

- The 300 synthetic scenarios (01 section 11.2) and the real-recording set (11.3) run against: (a) Node, (b) the fork's WebView build in the iOS simulator through the bridge with a native fake input that plays fixture WAVs into the capture path, (c) any future native DSP.
- Swift decimator vs TS decimator on the fixture WAVs: SNR of the difference ≥ 80 dB, identical block boundaries and `startT` to within 1 sample period.
- Pass criteria identical to web: grades equal (same `AttemptScore.total` to ±0.5), judgments equal on ≥ 99% of notes. 02 acceptance item 10 ("same fixtures produce identical scores on web and iOS") is enforced here.

---

## 6. iOS-only features: value, effort, placement

Effort: S ≤ 1 engineer-week, M 1 to 3, L 3 to 6, XL > 6.

| Feature | Value | Effort | Placement | Notes |
| --- | --- | --- | --- | --- |
| Native audio engine (`AVAudioEngine`, `.measurement` mode, 5 ms IO buffer, reported latency, built-in mic preferred) | High: lower and stable latency, correct speaker routing, no AGC, AirPods output without HFP | L | Fork v1 | Core reason for the fork. Uses `AVAudioSinkNode` for input blocks with `AVAudioTime` stamps, `AVAudioPlayerNode` for clicks scheduled by sample time. Loopback calibration still runs to confirm reported numbers (accept if within 10 ms; else use measured). |
| Route and interruption handling | High | S | Fork v1 | `AVAudioSession.routeChangeNotification` and `interruptionNotification` map to `onRouteChange`/`onInterruption`. AirPlay output blocked during takes. |
| AirPods and headphone latency handling | High for headphone users | M | Fork v1 | Use `.allowBluetoothA2DP` (output) and keep built-in mic input. `outputLatency` from the session, refined by play-along. Show route in the take header. On iOS 26, evaluate the AirPods high-quality recording option for input (verify availability and latency) before allowing AirPods as a mic. |
| Voice processing (AEC) for metronome bleed | Low to medium; harms sustained tones | S to try, M to validate | Later, experimental flag | `inputNode.setVoiceProcessingEnabled(true)` with AGC disabled and other-audio ducking minimized where the OS allows. Same acceptance gate as section 2.3 item 5. |
| Haptic metronome (Core Haptics) | High: removes bleed entirely, silent practice, on-time pulse | M | Fork v1 (iPhone only; iPads have no Taptic Engine) | Transient events scheduled on `CHHapticEngine` time; offset to audio clock measured at engine start and `hapticLatencyMs` measured by play-along. Count-in can be audible plus haptic. Phone must touch the stand or the player's body to be felt; designer shows guidance. Graded identically; `metronomeMode` flagged in the attempt (02 requirement). |
| Apple Watch haptic click | Medium for players whose phone is on a stand | XL | Later (research spike first) | Requires a watch app with an extended runtime session, clock sync over WatchConnectivity (offset estimate by ping, ±10 ms target), and the watch scheduling its own taps. Watch taps are weak and their latency varies; spike must show jitter ≤ 15 ms before committing. |
| CoreMIDI input (USB and Bluetooth LE MIDI keyboards) | High for pianists: exact pitch and onset, path to two-hand reading | M | Fork v1 | `MIDIClient` plus `CABTMIDICentralViewController` for BLE pairing. Packet host-time stamps converted to the audio clock. Single-line reading in v1 (03 corpus is monophonic); polyphonic reading when corpus schema v2 exists. Same feature on desktop via Web MIDI is the architect's v1.1 call. |
| iPad landscape stand layout | High: iPad on a music stand is the natural device | S (layout is shared web code) | Fork v1 | 04's `lg` layout already fits 12 bars. Native adds orientation lock during takes, idle timer off, Stage Manager and iPadOS 26 window resizing handled by the responsive layout, keyboard shortcuts (Space start/stop) via UIKeyCommand passthrough. |
| Offline corpus and app packaging | High (App Store requirement for a usable offline app) | S | Fork v1 | Bundle web build and corpus in the app; no service worker in WKWebView. |
| Native document store (SQLite via GRDB, same JSON documents) | High: survives WebView data resets, readable by widgets, Game Center, and CloudKit code | M | Fork v1 | Implements the 01 repo interfaces through a plugin. One-time migration imports any IndexedDB data and the web export format. |
| Local streak reminders (UserNotifications) | Medium | S | Later (fork v1.1) | Opt-in after the 3rd practice day; at most one per day; no server. |
| WidgetKit streak and goal widget | Medium | S to M | Later (fork v1.1) | App Group container holds a small summary JSON written after each attempt. |
| Live Activities | Low: takes need the app in the foreground anyway | M | Later, low priority | Only if a timed practice-routine feature (multi-exercise sessions) exists. |
| Game Center leaderboards for rank | Medium (social motivation) | M | Later (fork v1.1) | One leaderboard per instrument family for weekly points, mic input only; MIDI separate. Scores are client-computed and can be faked; accept that or wait for a backend. Leaderboards are iOS-only, so web players are not on them; designer must not present them as global. |
| iCloud / CloudKit private sync | Medium: iPhone and iPad of the same user | M to L | Later (fork v1.2) | Private database, record per document, last-writer-wins on profile summary, append-only attempts. Does not sync with the web. Cross-platform sync needs the backend 01 section 9 describes; CloudKit JS on the web is not recommended because it forces Apple ID on web users. |
| Sign in with Apple | Only needed with accounts | S once a backend exists | Never without a backend; with backend, required if any other third-party login is offered (guideline 4.8) | |
| App Intents / Shortcuts ("Start alto sax practice") | Low | S | Later | Opens the app at the settings screen with an instrument preset. |
| Apple Pencil annotations | Low for sight reading (excerpts are one-off) | M | Later, only with a teacher mode | PencilKit overlay on the score frame, stored per excerpt. |
| On-device polyphonic transcription (Core ML, Neural Engine) for piano and guitar by mic | Medium to high, uncertain accuracy | XL | Later (research) | Score-informed verification (01 section 5.10) is the first approach on both platforms; a neural model is only worth it if templates fail. |
| Background audio mode | None (takes are foreground) | — | Never | Declaring it without need risks rejection. |
| OTA JavaScript updates (live update services) | Low; adds review risk and drift | — | Never in v1 | Ship web changes through App Store builds. |
| Mac Catalyst / iPad app on Mac | Low (the web app already serves Mac) | S | Never in v1 | Mark the iPad app "not available on Mac" in App Store Connect to avoid unsupported audio paths. |

---

## 7. Fork architecture

### 7.1 Layout

```
ios/                                  Capacitor iOS project (Xcode, Swift Package Manager)
  App/
    AppDelegate.swift, SceneDelegate   WKWebView host; idle timer, orientation, status bar
    Plugins/
      AudioEnginePlugin/               session config, AVAudioEngine, capture, decimator, clicks, tones, latency, route/interruption
      MidiPlugin/                      CoreMIDI client, BLE pairing UI, timestamp conversion
      HapticsPlugin/                   CHHapticEngine metronome and result haptics
      StorePlugin/                     GRDB SQLite document store implementing the repo interfaces
      SystemPlugin/                    keep awake, orientation lock, open Settings, app version, install id
    Resources/                         copied web build (dist/) incl. corpus, attributions, PrivacyInfo.xcprivacy
  AppTests/                            XCTest: decimator conformance, timestamp mapping, store migrations
  AppUITests/                          XCUITest smoke: onboarding, calibration, one fixture-fed take
  Widgets/ (later)                     WidgetKit extension reading the App Group summary
  Watch/ (later)                       watchOS app for haptic click
src/platform/ios/                      TS side of the bridge: AudioBackend and PlatformServices implementations
```

### 7.2 Data flow during a take

```
AVAudioSession (.playAndRecord, .measurement, [.defaultToSpeaker, .allowBluetoothA2DP])
AVAudioEngine
  inputNode -> AVAudioSinkNode (real-time thread: copy into lock-free ring, no allocation)
  playerNode (click buffers scheduled at AVAudioTime(sampleTime:)) -> mainMixer -> output
Worker thread (Swift): ring -> 4-biquad low-pass -> decimate -> hiEnergy -> CaptureBlock every 32 ms
  -> Int16 base64 (or Capacitor binary transfer if available) -> notifyListeners('capture', {startT, ...})
WebView main thread (src/platform/ios): decode -> transfer Float32Array to DSP worker
DSP worker: DspPipeline -> LiveFollower -> FollowerEvents -> main thread -> ScoreView overlay
MidiPlugin: MIDIPacket host time -> audio clock -> notifyListeners('midi', ...) -> follower (inputPath 'midi')
HapticsPlugin: taps scheduled from the same ClickSpec[] that AudioEnginePlugin returned
```

Clock: `ClockSeconds` in the fork is `engineSampleTime / sampleRate` from the engine's start, converted from `AVAudioTime` and from `mach_absolute_time` host times with `AVAudioTime.seconds(forHostTime:)`. The plugin returns `t0` and all `ClickSpec.t` in that clock. `now()` on the TS side extrapolates from the latest `{clock, performanceNow}` sync pair sent with each block (error ≤ 5 ms, visual only).

### 7.3 Bridge budgets and acceptance

| Metric | Budget |
| --- | --- |
| Real-time thread work per IO buffer | ≤ 20% of buffer duration, zero allocations, no locks, no Objective-C messaging |
| Block delivery delay (block end time to arrival in DSP worker) | p50 ≤ 10 ms, p95 ≤ 25 ms, p99 ≤ 50 ms on iPhone 12 |
| Click scheduling accuracy | Every click within 1 sample of its scheduled sample time |
| Reported vs loopback RTL | Within 10 ms; otherwise loopback wins and the delta is logged |
| Sound-in to ghost visible | ≤ 80 ms p95 (web budget 60 ms plus bridge) |
| Cold launch to Home | ≤ 1.5 s on iPhone 12 |
| App size | ≤ 60 MB download |

### 7.4 Permissions in the WebView

The web UI's pre-prompt flow stays. In the fork, the "Allow microphone" button calls `AudioEnginePlugin.requestPermission()` (`AVAudioApplication.requestRecordPermission`), not `getUserMedia`, so there is one system prompt, not a second WebKit prompt. If WebKit capture is ever used in the shell (phase F1a below), implement `WKUIDelegate.webView(_:requestMediaCapturePermissionFor:...)` to grant automatically once the app has permission, avoiding the double prompt. When denied, the 04 "Microphone is blocked" card shows iOS app-settings steps and an "Open Settings" button (`UIApplication.openSettingsURLString`).

---

## 8. Phased plan

Sizes assume one senior iOS engineer leading, with implementers for plugin internals and tests. The overseer maps sizes to model tiers.

### Phase F0 — web v1 is good on iOS (during web build; no Swift)

- W1 to W16, device matrix runs, latency log.
- Exit: on every matrix device, a fixture-quality real take (lead musician plays a level-3 excerpt) grades within ±5 points of the same take on a 2020 MacBook; calibration succeeds on built-in speaker in ≥ 9 of 10 runs; W12 loss detection works.

### Phase F1 — fork v1 (about 14 to 18 engineer-weeks)

F1a (2 to 3 weeks): Capacitor shell with bundled web build and corpus, service worker disabled, WebKit audio still used, `SystemPlugin` (keep awake, orientation), CI building the iOS target from the web commit, TestFlight internal build. Purpose: prove the shell and bridge plumbing early; not shipped.

F1b (5 to 7 weeks): `AudioEnginePlugin` with capture, decimation, click scheduling, tones, reported latency, route and interruption events; `src/platform/ios` `AudioBackend`; conformance suite in the simulator and on devices. Exit: section 5.5 pass criteria; section 7.3 budgets; RTL on built-in speaker ≤ 40 ms on iPhone 12 and later.

F1c (4 to 5 weeks): `StorePlugin` with import from IndexedDB and from the web export file; `HapticsPlugin` metronome with play-along haptic calibration; `MidiPlugin` with USB and BLE keyboards, MIDI input path in `follow/` configuration; iPad landscape polish.

F1d (2 to 3 weeks): privacy manifest, App Store assets, accessibility pass (VoiceOver and Dynamic Type per 04), external TestFlight with 20 to 50 players across instrument families, App Review submission.

Exit for F1: crash-free sessions ≥ 99.5% in TestFlight; no take voided for reasons other than real interruptions in ≥ 98% of takes; grading parity per section 5.5; App Review approval.

### Phase F2 — engagement (fork v1.1, about 6 to 8 engineer-weeks)

Local reminders, streak widget, Game Center leaderboards (if the lead musician and designer confirm rank rules for leaderboards), App Intents.

### Phase F3 — sync and devices (fork v1.2 and later)

CloudKit private sync between Apple devices; Apple Watch haptic click after a successful spike; AEC experiment results; polyphonic piano via MIDI once corpus schema v2 exists; cross-platform sync when a backend is approved (then Sign in with Apple if any third-party login exists).

---

## 9. App Store review and privacy

### 9.1 Microphone use

- `Info.plist` `NSMicrophoneUsageDescription`: "Sight Reading listens while you play so it can mark each note on the score and grade your timing and pitch. Audio is analysed on your device and is never recorded or uploaded." (Final wording with the designer; it must match actual behaviour.)
- Request permission only from the pre-prompt button, never at launch (guideline 5.1.1). The app must stay usable without the mic: Home, History, Settings, MIDI input, and "practise without listening" (04 already provides this).
- No raw audio is stored. If the architect's optional "listen back" clip (01 open question 5) is added, it stays in memory or local storage, is off by default, and the privacy text above is updated.
- The orange mic indicator must turn off when not practising (W2 behaviour mirrored natively: stop the engine on leaving practice and on background).
- No `UIBackgroundModes` audio. Takes end when the app leaves the foreground.

### 9.2 Privacy manifest and nutrition label

- `PrivacyInfo.xcprivacy`: `NSPrivacyTracking = false`, no tracking domains, collected data types empty in v1. Required-reason APIs declared for what the app and its dependencies actually use (typically `UserDefaults` CA92.1, file timestamp C617.1, disk space E174.1 if storage checks query free space, system boot time 35F9.1 if `mach_absolute_time`-style uptime APIs are used). Verify Capacitor and GRDB ship their own manifests.
- App Store privacy label: "Data Not Collected" for v1. Adding crash reporting or analytics later changes this (Diagnostics, not linked to identity) and must be reviewed before shipping.
- No App Tracking Transparency prompt (no tracking).
- Export compliance: `ITSAppUsesNonExemptEncryption = NO` (HTTPS only, and v1 makes no network calls).

### 9.3 Review risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Guideline 4.2 minimum functionality ("just a website") | Native audio engine, haptic metronome, MIDI, offline corpus, native storage are all in F1. Do not submit F1a. |
| 5.1.1 permission timing or purpose string mismatch | Pre-prompt, accurate string, app usable without mic. |
| 2.5.2 downloading code | No remote JS. Corpus updates are data only and come later. |
| Content licensing | Only the 03 allowlist (PD, CC0, CC BY); credits page reachable in two taps; `withdrawn.json` honoured at launch. Keep provenance records for review questions. |
| Kids category and children's privacy | Do not enter the Kids category in v1. Age rating from the questionnaire (no user-generated content, no web browsing, no chat). If schools or under-13 users become a target, revisit (Kids category rules, no third-party analytics). |
| 3.1.1 in-app purchase | If any paid tier or corpus pack is added, digital content in the iOS app uses IAP unless the storefront rules at that time allow otherwise; decide with the overseer before monetisation. |
| Game Center data | No PII in leaderboard names beyond the Game Center alias. |
| Account deletion (5.1.1(v)) | Not applicable in v1 (no accounts). Required in-app once accounts exist. |

---

## 10. Polyphonic instruments on iOS

- Piano: fork v1 offers CoreMIDI input for keyboards. MIDI gives exact multi-note input, so two-hand and chord reading become possible as soon as corpus schema v2 and a polyphonic follower exist (02, 03). Microphone piano stays single-line, as on the web (01 section 5.10).
- Guitar: microphone single-line only, as on the web. MIDI guitar pickups are rare; not targeted. Chordal guitar by mic waits for the score-informed verification work in 01 section 5.10, which runs in the shared core and so arrives on both platforms together.

---

## 11. Reuse from ear-to-staff (iOS-relevant view)

| Module | Verdict for iOS concerns |
| --- | --- |
| `js/pitch.js` (McLeod) | Reuse via the TS port in `dsp/` (01). It is pure and runs unchanged in WKWebView and JavaScriptCore. The O(n·τ) loop must become FFT-based (01) because the naive loop would exceed the A13 budget. |
| `js/segmenter.js` | Adapt as 01 says. Its frame-count parameters already scale with hop via `segmenterOptions(hopSec)`; keep that so a native or different hop works. |
| `js/theory.js` | Reuse in `theory/`; pure and portable. |
| `js/app.js` mic capture | Replace. It polls an `AnalyserNode` with `setInterval(…, 16)` on the main thread, which has no sample timestamps and is throttled on iOS. AudioWorklet (web) and `AVAudioSinkNode` (fork) replace it. |
| `js/app.js` metronome | Replace the click (square wave at 1.2/1.8 kHz sits in instrument range) and the 80 ms main-thread lookahead timer (W9 schedules all clicks up front). Keep the idea of scheduling on the audio clock. |
| `js/app.js` mic constraints toggle | Replace the user-facing "processing" toggle with forced-off processing plus a recorded `appliedProcessing` (W5). |
| `js/history.js` GitHub token in `localStorage` | Do not carry into either product. Storing a personal access token in web storage is not acceptable in an App Store app and is unnecessary here. |
| `js/musicxml.js` | Useful only for corpus tooling and an optional export; no iOS impact. |
| No-build vanilla ES modules | Not reused as a build approach (01 chose Vite and TS), but the lesson stands: core modules with no DOM dependency are what make the fork cheap. |

---

## Open questions

1. Product fork or git fork: the owner said the iOS version "can be a fork". This section recommends a separate App Store app built from the same repository (`ios/` target), not a diverging git fork. Confirm.
2. Minimum iOS version for web v1: 01 says Safari 17+. Wake lock in home-screen apps only works on later 18.x releases. Is degraded wake-lock behaviour acceptable on 17.x, or should the floor be 18.4?
3. Do MIDI attempts count toward rank, or only toward a separate MIDI rank? (Lead musician.)
4. Is the haptic metronome allowed for graded takes at all levels, or should higher levels require an audible click to match real ensemble conditions? (Lead musician.)
5. Should AirPods be allowed as the microphone on iOS 26 if the high-quality recording mode proves accurate, or always steer players to the built-in mic?
6. Are Game Center leaderboards wanted given they exclude web players and are client-trusted? If not, F2 shrinks to reminders and widgets.
7. Monetisation model for the iOS app (free, paid, IAP corpus packs), since it decides IAP work and review strategy.
8. Is a teacher or school mode planned? It changes the value of Pencil annotations, accounts, Sign in with Apple, and the Kids category decision.
9. Corpus size ceiling for bundling (this section assumes ≤ 30 MB). Score researcher to confirm the expected v1 and v2 sizes.

## Dependencies on other roles

- **Technical architect (01):** adopt the `AudioBackend` and `PlatformServices` seam (W16, section 5.1) and the eslint boundaries that enforce it; split calibration into pure analysis plus backend playback; specify the decimator and high-band energy as pure functions with fixed coefficients; add `outputLatencyMs`, `hapticLatencyMs`, and `audioEnv` (section 5.3); make `follow/` take a per-input-path latency compensation instead of RTL only (section 4.4); add the "core runs in a bare JS runtime" CI job (section 5.2); schedule all take clicks up front (W9); create the AudioContext after `getUserMedia` (W3). Confirm the iOS floor in 01 section 2.3.
- **Lead musician (02):** tolerances checked against the iOS latency log from F0; rules for MIDI and haptic attempts in grading and rank; whether intonation is graded for MIDI (it should not be); instrument-family guidance text for using the haptic metronome.
- **Music score researcher (03):** keep the licence allowlist App Store compatible; deliver `attributions.json` and `withdrawn.json` in a form the fork bundles; corpus size estimate; schema v2 timeline for polyphonic piano (enables MIDI two-hand reading).
- **Senior designer (04):** iOS install coach mark (W13), storage-loss message (W12), Bluetooth/AirPods banner copy (W8), calibration flows for loopback, play-along, and haptic; route indicator in the take header; native permission pre-prompt and Settings deep-link card; haptic metronome guidance; iPad stand layout check with orientation lock; Dynamic Type mapping and VoiceOver behaviour; App Store screenshots and the microphone purpose string.
- **Overseer:** confirm open question 1; schedule F0 inside the web waves (W1 to W16 belong to the `audio/`, `store/`, `session/`, and PWA work packages, P19 included); staff F1 after web v1 is stable; approve any move of DSP out of the WebView (section 4.3).
