# 05 — iOS: Safari constraints, web accommodations, and the fork plan

Owner: senior iOS engineer. Readers: the overseer, the technical architect (01), lead musician (02), score researcher (03), senior designer (04), and the AI implementers of `src/platform/web/`, `src/calibration/`, `src/session/`, the PWA shell and the WebKit test projects.

Status: revision 2 (after the overseer's rulings R1 to R13 and the cross-examination round). The Review log at the end lists every change from the first draft.

How to read the scope marks: every feature is marked **v1** or **later**. Part A is web v1 and ships in this build. Part B ("Later") is the fork plan and is not built now. Under R12 this build contains **no native code**: the iOS deliverable is (1) the web app works on iOS Safari, (2) the platform seam exists, (3) the fork plan is documented.

Ownership (R2). This section owns: the list of iOS-specific accommodations, the definition of each measurement-gate check (what is measured and how it fails), the `AudioEnv` record, the iOS layout and touch constraints, and the fork plan. It does not own tolerances or ranked thresholds (02, `config/grading-config.json`), measurement budgets and calibration acceptance values (01, `config/measurement-budget.json` and 01 §7.8), the platform seam file (joint with 01, `src/core/platform.ts`, 01 §5.2), or visual treatment and copy (04). Where one of those values matters here, this section names the file and section.

Facts marked (verify) are WebKit behaviour that has changed across releases or is reported inconsistently. No physical device is available in this build, so every (verify) item is **unverified at v1**. The code feature-detects instead of assuming, and the device checklist (Part B, B3) lists how each will be checked later.

---

# Part A — Web v1 on iOS

## 0. v1 scope at a glance

| Feature | Scope | Section |
| --- | --- | --- |
| Web app on iOS/iPadOS Safari 17.0+, in a tab and as a home-screen app | v1 | 1 |
| iOS Safari graded and ranked, labelled "iOS: beta" on the calibration screen and in About | v1 | 1, 4 |
| Platform seam (`src/core/platform.ts`), web backend in `src/platform/web/`, lint-enforced restricted globals, bare-runtime CI job | v1 (01 builds it) | 5 |
| W1 gesture-bound unlock, W2 one stream per practice session, W3 sample-rate and clock-rate guard | v1 | 3 |
| W4 interruption and visibility voids, W7 route-change invalidation | v1 | 3 |
| W5 applied constraints and `AudioEnv` on every attempt | v1 | 3, 5.2 |
| W6 capability-based calibration rule (never blocks; unmeasured means unranked) | v1 | 3 |
| W8 Bluetooth hint, reduced to input label plus RTL > 120 ms | v1 | 3 |
| W9 every take click scheduled at Start; W10 no `OscillatorNode` in the metronome | v1 (01 P11) | 3 |
| W11 wake lock from Start scan to leaving practice | v1 | 3 |
| W12 `persist()` and storage-loss detector; W13 install coach mark (once, tab mode) | v1 | 3 |
| W14 manifest, `viewport-fit=cover`, safe areas, `dvh`/`svh`, touch and overscroll rules, frozen layout during takes | v1 | 3, 7 |
| Capture hardening: zero-gain path, port with main-thread relay fallback, buffer pool, backlog void | v1 (01 §7.2) | 3 |
| Per-take count-in RTL recheck | v1 (01 §7.7) | 3, 4 |
| Measurement gate (a) to (g) feeding 02's ranked rules | v1 | 4 |
| In-app audio self-test (automated substitute for the device checklist) | v1 (01 §7.9) | 8 |
| WebKit Playwright projects: non-audio flows, oscillator-fed audio smoke test, iPhone and iPad layouts | v1 | 8 |
| `docs/ios/device-checklist.md`, written but not executed | v1 | 8, B3 |
| W15 performance auto-degrade | cut (replaced by backlog void plus logging) | 3 |
| W13 30-day backup nudge; W8 capture-bandwidth heuristic | later | Part B |
| Device matrix runs, latency log, device promotion gate that removes the beta label | later | B3 |
| Capacitor target in `ios/`, native audio, haptic metronome, CoreMIDI, native store, App Store submission | later | B1 to B6 |

## 1. Summary of decisions (v1)

| Area | Decision |
| --- | --- |
| Support floor | iOS/iPadOS 17.0+ (matches 01 §3). Every browser on iOS uses WebKit, so Chrome or Firefox on iPhone have Safari's constraints. Wake lock may fail in home-screen apps before 18.4 (verify); the app shows an Auto-Lock hint instead of raising the floor. |
| Graded on iOS? | Yes, graded and ranked, labelled "iOS: beta". Making iOS practice-only would take XP from every iPhone player on the strength of risks the app can detect at runtime. Every take passes the same per-take measurement gate (section 4) on every platform; iOS simply fails it more often. |
| Platform detection | Grading and ranking branches read `PlatformCapabilities`, never the user agent. One function (`detectCapabilities`) in `src/platform/web/` is the only code allowed to read `navigator.userAgent`, and only to fill `osFamily` for labels, copy and diagnostics. |
| Calibration on iOS | Never blocks a take. Because iOS Safari does not report output latency, the iOS onboarding presents calibration as a step with no Skip control; a take with no measured calibration for the current route is graded as practice with the "Calibrate to earn XP on this device" badge (W6). |
| Audio stored | None (R9). `AudioEnv` holds settings and measurements, never samples. |
| Metronome bleed on iOS | Default: speakers with 01's Tick click, template subtraction and click gating (01 §7.6). Options: Wood click, wired headphones (play-along calibration), count-in only. AEC and the haptic metronome are later. |
| Phone portrait | Allowed with page turns (R13). "Rotate for a bigger page" hint in scan only, never during the take. Landscape recommended. |
| Fork | Later: a Capacitor iOS target in `ios/` in the same repository, built from the same commit as the web release (R12). Nothing in v1 may block it (section 5). |

## 2. iOS Safari facts that shape v1

### 2.1 Capability table

| Capability | Status on iOS 17 to 26 | v1 consequence |
| --- | --- | --- |
| `getUserMedia` audio | Supported in a tab and in home-screen apps. Needs HTTPS and a gesture for the prompt. Home-screen apps may re-prompt at each launch (verify). | Pre-prompt (04). One stream per practice session (W2). |
| `echoCancellation`, `noiseSuppression`, `autoGainControl` | Accepted as constraints. Whether `false` really disables voice processing has varied by release; Safari has tended to treat the three as one switch (verify). | Request all three `false`, read back `getSettings()`, record it (W5), fail gate (d) if any reads `true`, and detect AEC by its signature (gate (c)). |
| Device labels and `deviceId` | Labels only after permission. Honouring `deviceId` for the built-in mic while AirPods are connected is unreliable (verify). The output device is not exposed. | `routeKey` uses the player-declared output mode, not an output label (01 §5.2). Labels are hints only. |
| Bluetooth input (AirPods mic) | Switches the route to HFP: narrowband capture (16 kHz or lower), voice processing on, degraded output. | W8 hint. Loopback is expected to fail at those rates; play-along is offered. |
| Bluetooth output | Output only, 150 to 300 ms; AirPlay 1 s or more. | Play-along only. RTL > 120 ms fails gate (g). |
| AudioWorklet | Supported. A worklet node not connected to the destination may never have `process()` called, because WebKit renders from the destination (verify). Transferring a `MessagePort` into `AudioWorkletGlobalScope` is unverified on WebKit. | 01 §7.2: worklet output of zeros through a zero gain to the destination; port path with main-thread relay fallback after 500 ms with no block. |
| `SharedArrayBuffer` | Needs COOP/COEP, which GitHub Pages cannot send. | Not used (01). |
| `AudioContext.sampleRate` | Usually 48 kHz hardware. A context at 44.1 kHz can mis-resample when the mic opens: pitch shifts by about 147 cents, or crackle (verify per release). `track.getSettings().sampleRate` is often absent. | W3: rate comparison when reported, plus 01's clock-rate check that needs no loopback, plus the sanity tone on speakers. |
| `baseLatency`, `outputLatency`, `getOutputTimestamp` | `outputLatency` reads 0 or undefined; `getOutputTimestamp` may be missing (verify). | `capabilities.outputLatencyReported = false`; the `reported` method is never a ranked basis (W6). `audibleNow()` falls back to `currentTime − baseLatency`, visuals only. |
| Output route while capturing | Output can move to the receiver or drop in level while capture runs. | Loopback sees a low click level; the player is told to turn the volume up, then offered play-along. |
| First output after resume | iOS can drop the first 100 to 300 ms of output while the route spins up. | 01 §7.1: one context per session, lead ≥ 0.5 s, first count-in click verified on speakers, count-in restarted once if missing. |
| IO buffer changes mid-session | Another app's audio or a background-and-return can change the IO buffer, shifting RTL by several ms. | Per-take count-in recheck (01 §7.7). |
| Ring/silent switch | Web Audio is muted by the switch unless the session is a playback or play-and-record type; behaviour before capture differs (verify). | Set `navigator.audioSession.type = 'play-and-record'` synchronously in the gesture where present (Safari 16.4+). Record the value. |
| Interruptions | Calls, Siri, alarms, other apps' audio. The context enters the non-standard `interrupted` state and tracks may be muted. Resume needs a new gesture. | W4. |
| Background and lock | Capture stops, timers freeze, the context suspends. | W4 voids the take and stops tracks. |
| Screen Wake Lock | Safari 16.4+. In home-screen apps it did not hold until a later fix, reported in 18.4 (verify). Released on visibility change. | W11, with the Auto-Lock hint on failure. |
| Vibration API, Web MIDI | Not supported. | No haptics and no MIDI on the web (R9, R12). |
| Fullscreen | iPad elements only; iPhone video only. | iPhone relies on the home-screen app for a chrome-free page. |
| Orientation lock | `screen.orientation.lock()` unsupported; manifest `orientation` not honoured (verify). | Layout handles both orientations at all times (section 7). |
| Storage | In a tab, script-writable storage is deleted after 7 days of Safari use without a visit. Home-screen apps have separate storage and are exempt. `persist()` exists; the grant is heuristic. | W12, W13. |
| Service worker | Supported in a tab and in home-screen apps. | `vite-plugin-pwa` behind `capabilities.serviceWorker` (the later Capacitor target turns it off). |
| `permissions.query({ name: 'microphone' })` | Unreliable on Safari (verify). | Never the only source of permission state; `permissionState()` falls back to `'unknown'`. |
| Viewport | In a Safari tab, landscape leaves about 844×340 usable on a 6.1-inch phone; the notch takes 47 to 59 px per side; the portrait toolbar takes 80 to 100 px; iOS 26's floating bar overlays content (verify). `100vh` includes the area under the toolbar. | Section 7. |
| Performance | A13 (iPhone 11 class) is the slowest device worth supporting. Low Power Mode and thermal throttling slow timers and CPU. | The follower runs on audio time, so a slow worker delays marks but never changes grades. Backlog void instead of auto-degrade (W15 cut). DSP budget on A13 is unverified at v1. |

### 2.2 Latency expectations (planning only, unverified)

| Path | Round-trip latency |
| --- | --- |
| iOS Safari, built-in speaker and mic | 40 to 120 ms, device and version dependent; can shift by a few ms between context instances |
| iOS Safari, wired headphones | Not measurable by loopback; play-along |
| iOS Safari, AirPods output | 150 to 300 ms; play-along only; unranked (gate (g)) |

These ranges are not inputs to any tolerance. The error budgets and floors are 01's (01 §8, `measurement-budget.json`); 01 already budgets the stored-calibration case at 5 ms σ on phones because of iOS RTL drift. If the later device gate (B3) measures onset p90 above 01's budget, 02 widens the floors in config (R2).

## 3. Web accommodations (W1 to W14, v1)

Each item names the package that builds it (01's P-ids or this section's IOS-ids, section 9) and an acceptance test an agent can run. Every acceptance below runs in CI against `FakeAudioBackend`, fake browser objects, Playwright Chromium fake capture or Playwright WebKit. None needs a device.

**W1. Gesture-bound unlock (v1; P11).** Inside the gesture handler (Allow microphone in onboarding, Start scan in practice), synchronously and with nothing awaited before: set `navigator.audioSession.type = 'play-and-record'` if present; `new AudioContext({ latencyHint: 'interactive' })`; `ctx.resume()`. Only then await `getUserMedia`, add the worklet, read `getSettings()`, run W3. This corrects the first draft, which created the context after `getUserMedia` and so depended on capture granting autoplay. Order is 01 §7.1. Accept: a spy test asserts the call order and that `resume()` is called in the same task as the click event; no `await` precedes it.

**W2. One stream and one context per practice session (v1; P11, IOS2).** Keep both alive across consecutive takes; close them on leaving the practice flow, on page hide, and after 5 minutes idle on results. Accept: ten fake-capture takes in a row call `getUserMedia` once; all tracks are stopped within 2 s of leaving practice.

**W3. Sample-rate guard (v1; P11, P14).** (1) If `track.getSettings().sampleRate` is reported and differs from `ctx.sampleRate`, recreate the context once. (2) Always run 01's clock-rate check (`measureClockRate(1.5)`, 01 §7.8), which needs no loopback and so also covers headphone mode; an error above 01's 2% threshold recreates the context once, and a second failure shows "Audio setup problem; please reload". (3) On speakers, calibration plays 01's 300 ms A4 sanity tone and requires 01's ±8 cent reading. Accept: a fake reporting 44.1 kHz context with a 48 kHz track recreates exactly once; a fake clock running 8.8% fast is caught; a second mismatch shows the error state. Known gap: a pure pitch-shift mis-resample with a correct clock rate, in headphone mode, is not detectable without the tone (unverified, B3).

**W4. Interruption and visibility voids (v1; IOS2, P16).** During `count-in` or `performing`, any of `visibilitychange` to hidden, `pagehide`, `freeze`, context state `interrupted` or a `suspended` the app did not request, track `mute` or `ended` aborts the take with `VoidReason 'interrupted'` (01 §6.5), stops tracks on hide, and needs a gesture to restart. Voids follow 02 §5.3 and §4.7: no grade, no XP, not in the level window; a void after the first played note still burns the excerpt. Accept: each event in each state, scripted on the fake backend, produces the void and the burned-excerpt flag; a restart without a gesture never calls `resume()`.

**W5. Applied constraints and `AudioEnv` (v1; IOS3).** After opening, record `getSettings()` (`echoCancellation`, `noiseSuppression`, `autoGainControl`, `sampleRate`, `channelCount`) in `AudioRouteInfo.appliedProcessing` and every attempt's `AudioEnv` (5.2). Accept: every attempt saved in a session E2E carries a complete `AudioEnv`, and it round-trips through export and import unchanged.

**W6. Capability-based calibration rule (v1; IOS3, P14, 04 screens).** Rewritten from "calibration is mandatory on iOS" (UA-based, blocking):
- On every platform, a ranked take needs a measured calibration (loopback or play-along) for the current `routeKey` that is not stale (02 §5.2). Missing, stale or `reported` calibration adds gate failure `calibration-unmeasured`.
- Nothing is ever blocked. Without a measured calibration, the take is graded as practice with the badge "Calibrate to earn XP on this device" (04 copy). Practise without listening never needs calibration (R13).
- Where `capabilities.outputLatencyReported` is false (iOS Safari, and Safari on macOS), onboarding's calibration step has no Skip control. Its exits are success, or, after loopback and play-along have each failed twice, "Use an estimate" (`reported`), which leads to unranked takes. In headphone mode the step goes straight to play-along, because loopback cannot hear the click. "Not now" at the microphone step skips calibration entirely and leaves practise without listening.
Accept: with `outputLatencyReported = false` and no calibration, a take starts, is graded, and has `ranked: false` with reason `calibration`; the onboarding step renders no Skip control in that capability state and does in the other.

**W7. Route-change invalidation (v1; IOS2).** On `devicechange`, recompute `routeKey`. Between takes, a changed key marks the calibration stale (the next take is unranked until recalibrated, W6). Mid-take, it voids the take (`device-change`). Changing the declared output mode also changes `routeKey`. Accept: scripted on the fake backend.

**W8. Bluetooth hint, reduced (v1; IOS3, 04 banner).** Show 04's Bluetooth banner when the input label matches `/airpods|bluetooth|beats|headset|hands-free/i`, or the measured RTL exceeds 120 ms (gate (g)). On iOS add the hint that AirPods microphones reduce accuracy and the iPhone mic works better. The 4 kHz capture-bandwidth heuristic is later (its acceptance test needs a device). Accept: label fixtures and a 150 ms fake calibration each raise the banner flag.

**W9. Every take click scheduled at Start (v1; P11).** About 170 `AudioBufferSourceNode`s in the worst case (2 count-in bars plus 12 bars of 12/8 with subdivision clicks). No main-thread lookahead timer during a take. Reason: iOS throttles main-thread timers under load and in Low Power Mode. Accept (01 P11): with a 200 ms main-thread stall injected mid-take, every click's scheduled start equals `t0 + k × beat` and the oscillator-fed WebKit test (IOS7) measures each click within 1 ms of schedule.

**W10. No pitched click (v1; P11).** Ear-to-staff's 1.2/1.8 kHz square-wave click must not be carried over. Accept: a lint rule fails if `OscillatorNode` or `createOscillator` appears in the metronome module (negative fixture in `test/lint-fixtures/`).

**W11. Wake lock from Start scan (v1; IOS4).** Request `navigator.wakeLock.request('screen')` in the Start-scan gesture, re-request on return to visible while in the practice flow, release on leaving practice or after 5 minutes idle on results. Reason: the scan lasts 30 to 60 s with no touch and iPhone Auto-Lock defaults to 30 s; a lock mid-scan hides the page, W4 stops the stream, and the next Start needs a new prompt and recalibration. If the request rejects, show the Auto-Lock hint once per session (IOS5, 04 copy). Accept: on a fake wake lock, request timing, re-request and release follow the rule; a rejection sets the hint flag once and is otherwise silent.

**W12. Storage persistence and loss detection (v1; P6, IOS4).** Request `navigator.storage.persist()` after the first completed attempt (01 §11). Write a `kv` marker `{ installId, createdAt }` on first run and mirror `installId` in `localStorage`. On start, if one exists without the other, or the marker exists but IndexedDB has no profile, show 04's storage-loss card with [Import backup]. Accept: P6's storage-loss test; `persist()` is called once, after the first attempt.

**W13. Install coach mark, reduced (v1; IOS5).** In iOS or iPadOS tab mode (`osFamily` is `ios` or `ipados` and `displayMode` is `browser`), after the first graded take, show 04's one-time sheet explaining Share > Add to Home Screen and why (progress kept safe from the 7-day deletion, screen kept awake). Never in standalone mode, never stacked with the rank-up card (it waits for the next results screen). It is the main defence against Safari's storage deletion. The 30-day backup nudge is later. Accept: trigger logic unit-tested over capability and history fixtures.

**W14. Manifest, meta and touch (v1; P19, IOS6).** `manifest.webmanifest` with `display: standalone`, `theme_color`, icons including a 180×180 `apple-touch-icon`; viewport meta with `viewport-fit=cover`; `apple-mobile-web-app-status-bar-style`; the layout and touch rules of section 7. Accept: P19's manifest test plus IOS6.

**Capture hardening (v1; 01 §7.2, P11).** Adopted by 01 from this section's review: worklet output through a zero gain to the destination; port transfer with main-thread relay fallback (`AudioEnv.captureRelay`); a buffer pool with drops counted; a capture gap voids the take (`capture-gap`). Accept: IOS7 runs them in WebKit.

**Per-take count-in recheck (v1; 01 §7.7, P14).** On speakers, the worker re-measures RTL from the count-in clicks of every take. This catches iOS IO-buffer changes that a once-per-route calibration misses. Its ranked consequence is gate (e).

**W15. Performance auto-degrade: cut.** Silently switching analysis windows would change grades and break the rule that the same input grades identically everywhere. Replacement: the DSP worker logs per-hop time (`AudioEnv.dspHopP95Ms`, diagnostics only), and a backlog above 01's threshold voids the take (`backlog`, 01 §7.9). Because the follower runs on audio time, a slow worker only delays marks; it never changes grades. No attempt is ever graded in a degraded mode, so 02 needs no degraded tolerance floors.

## 4. Measurement gate (v1)

Every take on every platform runs these checks. Each failing check appends a `GateId` to `AudioEnv.gateFailures` and makes the take unranked; the take is still graded and shown, with 04's reason badge. 05 defines what each check measures. Thresholds are 02's (ranked rules, `config/grading-config.json`, 02 §5.2) or 01's (calibration acceptance and budgets, 01 §7.7 to §7.9); this table names the source instead of restating the value.

| Check | `GateId` | What is measured | Threshold source |
| --- | --- | --- | --- |
| (a) Sample rate | `sample-rate` | After at most one context recreate, `ctx.sampleRate` equals the track's reported rate (when reported) and the clock-rate check passes | 01 §7.8 |
| (b) Calibration measured | `calibration-unmeasured` | A loopback or play-along calibration exists for the current `routeKey` and is not stale | 02 §5.2 |
| (b) Calibration quality | `calibration-quality` | The stored calibration's spread (MAD) and detected-click count | 02 §5.2 (MAD), 01 §7.8 (click count, RTL range) |
| (c) AEC suspected | `aec-suspected` | `Calibration.aecSuspected` (loopback fails on the built-in speaker and the sanity tone arrives far below the level predicted from the clicks), or the sanity tone reads outside its cents limit | 01 §7.8 |
| (d) Processing on | `processing-on` | `appliedProcessing` reports any of the three as `true` | none (boolean) |
| (e) Count-in recheck | `recheck` | Speakers only: the recheck found its minimum clicks with acceptable MAD, and its RTL agrees with the value used | 01 §7.7 (detection), 02 §5.2 (agreement); see open question 1 |
| (f) Capture continuity | `capture-gap` | Consecutive `CaptureBlock.seq` values are contiguous and no pool-empty drop occurred | none (any gap) |
| (g) Latency ceiling | `rtl-high` | `latencyCompensationSec` above the ranked ceiling (Bluetooth, AirPlay) | 02 §5.2 |

Mapping to 02's `rankedReason`: `calibration-unmeasured` gives `calibration`; every other `GateId` gives `measurement`. The detailed ids stay in `AudioEnv.gateFailures` so results can name the cause and attempts can be re-flagged later.

Voids are separate from gate failures: interruption, device change mid-take, backlog, no signal (01 §7.9). A void is never graded.

Beta instruments on iOS have no extra gate (02 §1.2 rejected the device-gate rule from my first round because the device gate cannot run in this build, and I accept that).

## 5. Platform seam and records (v1)

### 5.1 What 01 froze, and the additions this section needs in P0b

01 §5.2 adopted this section's seam: branded `ClockSeconds`; versioned `CaptureBlock` and `WorkerMessage`; a minimal `AudioBackend` (unlock, permission state, clocks, `scheduleTake` with every click scheduled up front, capture start and stop, calibration clicks, tones, clock-rate check, route and interruption callbacks, close); `PlatformServices` (repos, kv, keep-awake, wall clock, ids, relative-path assets, visibility); `AudioRouteInfo` with `routeKey`; `latencyCompensationSec` in `FollowConfig`; calibration analysis pure in `calibration/`. MIDI and haptic members are absent in v1 and arrive later as optional members, which is additive (01 §14 item 2). This section does not restate those types.

Two additions to `PlatformCapabilities` (01 §5.2), needed in P0b:

```ts
export type OsFamily = 'ios' | 'ipados' | 'macos' | 'android' | 'windows' | 'linux' | 'other';
export interface PlatformCapabilities {
  // ...01's fields: platform, outputLatencyReported, wakeLock, serviceWorker, persistentStorage
  osFamily: OsFamily;                     // labels, copy and diagnostics only; never a grading branch
  displayMode: 'browser' | 'standalone';  // W13, diagnostics
}
```

`osFamily` for iPadOS uses `Macintosh` in the user agent together with `navigator.maxTouchPoints > 1`. It is computed once in `detectCapabilities` (IOS1), the only reader of `navigator.userAgent`.

### 5.2 `AudioEnv` (01 §6.5 `AttemptRecord.audioEnv`)

Written on every attempt from day one, platform-neutral, JSON only. The later Capacitor target fills the same fields.

```ts
export type GateId = 'sample-rate' | 'calibration-unmeasured' | 'calibration-quality' | 'aec-suspected'
  | 'processing-on' | 'recheck' | 'capture-gap' | 'rtl-high';
export interface AudioEnv {
  platform: 'web' | 'ios';                 // 'ios' = the later native target
  osFamily: OsFamily; displayMode: 'browser' | 'standalone';
  appBuild: string; coreVersion: string;   // coreVersion = version of the shared pure core
  inputPath: 'mic';                        // 'midi' later (a separate instrument id per 02 Later L-B)
  metronomeMode: MetronomeMode;            // 'audible' | 'countInOnly' in v1; haptic modes later
  clickTimbre: ClickTimbre; outputMode: OutputMode;
  route: Pick<AudioRouteInfo, 'inputKind' | 'sampleRate' | 'appliedProcessing'>;
  contextSampleRate: number; contextRecreated: boolean; clockRateError: number | null;
  audioSessionType: string | null;         // navigator.audioSession.type as set, or null
  latencyCompensationMs: number;           // what follow/ subtracted
  calibrationMethod: 'loopback' | 'play-along' | 'reported' | 'none';
  captureRelay: boolean;                   // main-thread relay used (01 §7.2)
  droppedBlocks: number; maxQueueMs: number; dspHopP95Ms: number | null;
  gateFailures: GateId[];
}
```

No field identifies the person or the device (labels are reduced to `inputKind`).

### 5.3 Portability rules the web swarm must keep (v1)

These keep the later Capacitor target additive. Most are already in 01; listed so implementers have one checklist.

1. Restricted globals (01 §4.3) are banned outside `src/platform/web/`, `src/app/main.tsx` and `testkit/`, with a negative lint fixture. Add `navigator.userAgent` and `navigator.audioSession` to the list (only `detectCapabilities` and the backend may read them).
2. Pure packages compile with `lib: ["ES2022"]` (01 §3) and pass the bare-runtime job: an esbuild IIFE runs 20 synthetic scenarios in a Node `vm` context with only ES2022 globals, byte-identical to Vitest (01 §13.3). QuickJS and JavaScriptCore jobs are later.
3. Randomness, ids, wall time and assets only through injection (01 §5.2).
4. Every timestamp a take uses comes from the backend's `ClockSeconds`. Nothing in `session/`, `follow/` or `grade/` reads `AudioContext` time or `performance.now()`.
5. The decimator and high-band filters are pure functions with fixed coefficients in `dsp/` (01 §7.2), so a later Swift port can be checked against them.
6. Repositories are async and store JSON documents with ISO 8601 UTC timestamps and UUIDs; the export file is versioned and platform-neutral (01 §11). A web export must import into the later native store unchanged.
7. Build: Vite `base: './'`, hash routes, relative asset and corpus URLs only, nothing reads `location.origin`, Bravura and every asset bundled with no CDN, service worker registered only through `capabilities.serviceWorker` (01 §3, §13.4). The app boots from `dist/` under any origin and subpath.
8. Corpus files are data at stable relative paths: `index.json` lists chunk hashes and sizes, `attributions.*.json` and `withdrawn.json` stay plain JSON (03 §6.13). 03 measures 9 to 14 MB raw for v1, under this section's 30 MB bundling ceiling for the fork.
9. Licences are referenced by 03's allowlist ids (03 §1), not restated here. The fork reuses the web credits page and the in-take CC BY source line unchanged (03 §9.1).

## 6. Reuse from ear-to-staff (iOS view, v1)

| Module | Verdict |
| --- | --- |
| `js/app.js` mic capture | Replace. It polls an `AnalyserNode` with `setInterval(…, 16)` on the main thread, has no sample timestamps, and is throttled on iOS. |
| `js/app.js` metronome | Replace the square-wave click and the 80 ms main-thread lookahead timer (W9, W10). Keep scheduling on the audio clock. |
| `js/app.js` processing toggle | Replace with forced-off processing plus the recorded `appliedProcessing` (W5). |
| `js/history.js` GitHub token in `localStorage` | Do not carry over. A personal access token in web storage is unacceptable here and in any later App Store build. |
| `js/pitch.js`, `js/segmenter.js`, `js/theory.js` | 01 ports them; pure, so they run in WebKit and later in a WKWebView unchanged. |

## 7. Layout and touch on iPhone and iPad (v1)

04 owns the layout, the page-turn rules and the copy. These are the iOS constraints 04's layouts must satisfy and that IOS6 implements and tests.

1. **Viewport units.** Use `100dvh` (or `100svh` where the layout must not jump), never `100vh`, which on iOS includes the area under the toolbar and clips the bottom. A stylelint rule bans `100vh`.
2. **Safe areas.** Pad with `env(safe-area-inset-*)` read through variables, `var(--sai-left, env(safe-area-inset-left))` and so on, so Playwright can inject insets. Controls sit at least inset plus 8 px from any edge.
3. **Frozen layout during takes.** The layout is frozen when the count-in starts (01 §5.8). A resize while performing (Safari bars expanding after a rubber-band or an edge tap, rotation, a Stage Manager window resize) scales the frozen layout to fit with one CSS transform shared by the static score and the overlay; nothing re-renders VexFlow. A rotation during the count-in re-lays out and restarts the count-in once with no penalty. Scan and results re-lay out freely.
4. **No accidental gestures during takes.** `overscroll-behavior: none` on `html` and `body`; `touch-action: none` on the score frame; `touch-action: manipulation` on controls (iOS ignores `user-scalable=no`); `-webkit-touch-callout: none` and `user-select: none` on the score. Taps on the score do nothing during a take.
5. **Stop.** There is no Esc or Space on an iPhone, so Stop is the only take control: at least 44×44 px.
6. **Page turns** follow 04's fixed-slot half-page turn; each system has its own SVG and overlay group (01 §5.8), so a turn swaps slots without a render. Portrait at 2 bars per system and L5 112 bpm 4/4 turns about every 4 s, which is acceptable.
7. **Fonts offline.** Bravura bundled (01 §3). A CDN font load would break offline use, home-screen launches on a bad network, and the later `capacitor://` origin.
8. **Hints.** "Rotate for a bigger page" in scan only (R13). The Auto-Lock hint (W11) outside takes only.
9. **Denied-permission facts for 04's copy.** iOS 18 moved the Safari settings to Settings > Apps > Safari > Microphone; the per-site control is aA > Website Settings > Microphone in a tab; a home-screen app asks again on a later launch, so its copy says "Allow when asked next time" (verify).
10. **iPad.** 04's `lg` layout fits. Stage Manager widths of 320 to 700 px use the `sm` and `md` rules; live window resizes are covered by item 3.

Acceptance viewports (CSS px, Playwright WebKit with `isMobile` and `hasTouch` and injected insets):

| Id | Case | Viewport | Injected insets (top, right, bottom, left) |
| --- | --- | --- | --- |
| V1 | iPhone portrait, home-screen app | 390×844 | 47, 0, 34, 0 |
| V2 | iPhone portrait, Safari tab | 390×660 | 0, 0, 0, 0 |
| V3 | iPhone SE portrait, Safari tab | 375×553 | 0, 0, 0, 0 |
| V4 | iPhone landscape, Safari tab | 844×340 | 0, 47, 21, 47 |
| V5 | iPhone landscape, home-screen app | 844×390 | 0, 47, 21, 47 |
| V6 | iPad landscape, Safari tab | 1180×760 | 0, 0, 0, 0 |
| V7 | iPad portrait, home-screen app | 1024×1366 | 24, 0, 20, 0 |

The set merges 04's screen-size viewports (390×844, 375×667, 844×390), which hold for home-screen apps, with real Safari-tab usable sizes. Budget check at 7.5 px sp in V4: a 44 px toolbar plus two systems of about 122 px is about 288 px, which fits; a third does not, so page turns stay.

## 8. Definition of done for iOS in this build

### 8.1 Agent-checkable (all must pass in CI)

1. **Seam.** `src/core/platform.ts` has 01 §5.2 plus the 5.1 additions; `session/` imports only it; a negative lint fixture (`AudioContext` in `session/`, `navigator.userAgent` outside `detectCapabilities`) fails lint; a grep finds no restricted global outside the allowed folders.
2. **Bare runtime.** 01 §13.3 job passes.
3. **Fake-backend tests** (Vitest): W1 call order; W2 single `getUserMedia` over 10 takes; W3 recreate-once, clock-rate catch and second-failure error; W4 every event in every state voids and burns; W6 unranked without measured calibration and nothing blocked; W7 stale and mid-take void; W8 label and RTL triggers; W9 click schedule under a 200 ms stall; W10 lint fixture; W11 wake-lock timing and failure flag; W12 storage-loss card and single `persist()`; W13 trigger logic; every `GateId` at its threshold boundary; per-take recheck behaviour (01 P14).
4. **Playwright WebKit (Linux)** (01 P21 with IOS7): every non-audio flow (onboarding with mic denied, practise without listening, settings, a results fixture, history, import and export); the audio smoke test with the synthetic capture source: the worklet module loads, the zero-gain path renders, blocks reach the worker contiguously for 30 s by the port path and by the forced relay, and synthetic loopback measures injected delays of 25, 60 and 110 ms within ±1 ms.
5. **Layout** (IOS6) at V1 to V7: no score-frame overflow; in page-turn mode the next system is always visible; nothing inside the injected insets; Stop ≥ 44×44 px; `setViewportSize` mid-take causes zero VexFlow renders (render counter) and the overlay stays within 1 px of its notes; a width/height swap during the count-in restarts it once; computed styles show the section 7 item 4 rules during a take; no `100vh` in the CSS.
6. **PWA** (P19): standalone manifest with a 180×180 apple-touch-icon; `viewport-fit=cover`; Lighthouse installability in Chromium; no absolute `/assets` URLs in `dist/`; `dist/` served from another origin under a subpath with all third-party network blocked boots and completes a fixture take.
7. **Records.** Every saved attempt carries a complete `AudioEnv`, and it appears in the export.
8. **Labels and docs.** "iOS: beta" appears on the calibration screen and in About when `osFamily` is `ios` or `ipados` (Playwright with an iPhone user agent); `docs/ios/device-checklist.md` exists and lists every item in 8.2 with its procedure and pass threshold from B3.

The in-app audio self-test (01 §7.9: sanity tone, loopback, count-in recheck on a 1-bar test, clock-rate check, applied-constraints readback, rAF rate under overlay stress; pass/fail card plus a local diagnostics export with no audio) is the automated substitute a player can run on a real iPhone.

### 8.2 Unverified until a device test (later, B3)

- Real RTL values and their stability across sessions and context instances.
- Whether `echoCancellation`, `noiseSuppression` and `autoGainControl` set to `false` are honoured, and whether AEC cancels the loopback click.
- Receiver routing and quiet output while capturing; silent-switch behaviour before capture.
- The 44.1/48 kHz mis-resampling bug, including a pitch-shift form with a correct clock rate in headphone mode.
- Whether an unconnected worklet runs, and whether `MessagePort` transfer into the worklet works, on real iOS WebKit (Linux WebKit is a proxy only).
- First-output drop after resume and the first-click check.
- Wake lock in home-screen mode before and after 18.4.
- Permission re-prompt frequency in a tab and as a home-screen app; `permissions.query` behaviour.
- Interruption state transitions with real calls, Siri and alarms.
- AirPods and HFP behaviour and detection.
- DSP budget on A13 in Low Power Mode and under thermal throttling.
- Safari's 7-day storage deletion and the `persist()` grant.
- Real Safari chrome heights, the iOS 26 floating bar, Stage Manager live resize.
- VoiceOver behaviour.
- Low-instrument detection through iPhone mics.

## 9. v1 work packages

Sizes: S under about 150 lines plus tests, M 150 to 400. The W-items not listed here are built inside 01's packages (P6, P11, P14, P16, P19, P21), whose acceptance this section's tests extend.

| Id | Package | Depends on | Size / difficulty | Acceptance (every item an automated test) |
| --- | --- | --- | --- | --- |
| IOS1 | `detectCapabilities` (outputLatencyReported, wakeLock, serviceWorker, persistentStorage, osFamily, displayMode) | 01 P0b | S / routine | Table test over at least 10 environment stubs (iOS 17, 18 and 26 Safari tab and standalone, iPadOS desktop-mode UA with touch points, Chrome on iOS, Safari and Chrome on macOS, Chrome Android, Firefox desktop): every field as expected; `outputLatencyReported` false for every WebKit stub; a lint fixture reading `navigator.userAgent` elsewhere fails |
| IOS2 | Interruption and route policy: pure `interruptionPolicy(state, event)` plus web event wiring (W2 idle close, W4, W7) | 01 P11, P0g | M / moderate | Policy table test: every event × every session state gives the specified action (void with reason, stale calibration, ignore); with the fake backend, a void stops all tracks and burns the excerpt; restart without a gesture never calls `resume()`; 10 takes call `getUserMedia` once; 5 min idle on results closes the stream; Chromium fake-capture E2E: a dispatched `visibilitychange` mid-take yields a void record and no live track within 2 s |
| IOS3 | Measurement gate evaluator and `AudioEnv` builder (W5, W6, W8 flag, section 4) | 01 P0b, P0d, P14 | M / moderate | For each `GateId`, fixtures just inside and just outside its threshold (read from config; a grep finds no numeric threshold in the module) pass and fail; the `rankedReason` mapping matches section 4; no calibration with `outputLatencyReported` false gives `calibration-unmeasured`, a graded take and `ranked: false`; every attempt from a session E2E has a schema-valid `AudioEnv` that survives export and import deep-equal |
| IOS4 | Keep-awake controller and persist trigger (W11, W12 request) | 01 P0b, P6 | S / routine | Fake wake lock: requested in the Start-scan gesture, re-requested on visible while in practice, released on leaving practice and after 5 min idle on results, never requested outside practice; a rejection sets the hint flag once per session; `persist()` called exactly once, after the first completed attempt |
| IOS5 | iOS sheet and hint triggers: install coach mark, Auto-Lock hint, Bluetooth banner flag (W13, W11, W8) | IOS1, IOS4, 04 sheets and copy | S / routine | Pure trigger tests: coach mark only for `ios`/`ipados` in `browser` mode, once, after the first graded take, deferred when a rank-up card shows; never in standalone; Auto-Lock hint only after a wake-lock rejection and never during a take; Bluetooth flag from label fixtures and RTL > 120 ms; all strings resolve from `en.json` |
| IOS6 | iOS viewport, touch and frozen-layout controller (section 7) | 01 P7, P15, 04 `layout-table.ts` | M / moderate | Playwright WebKit at V1 to V7: no score-frame overflow; next system visible in page-turn mode; nothing inside injected insets; Stop ≥ 44×44 px and ≥ inset + 8 px from edges; mid-take `setViewportSize` causes 0 VexFlow renders and overlay within 1 px; a width/height swap during the count-in re-lays out once and restarts it; computed styles show `overscroll-behavior: none` and `touch-action: none` on the score frame during takes; stylelint rejects `100vh` |
| IOS7 | Synthetic capture source for WebKit tests (test-only) | 01 P11 | S / moderate | A test-only flag replaces `getUserMedia` with an `OscillatorNode` plus the scheduled click buffer through a `DelayNode` of d ms; absent from the production bundle (grep of `dist/`); in Playwright WebKit the worklet loads, blocks are contiguous by `seq` for 30 s on the port path and on the forced relay, and loopback measures d = 25, 60 and 110 ms within ±1 ms |
| IOS8 | `docs/ios/device-checklist.md` and the "iOS: beta" labels | IOS1, 04 copy | S / routine | The checklist lists every 8.2 item and every B3 measurement with a procedure and pass threshold (a test asserts the item count matches); Playwright with an iPhone UA shows the beta label on the calibration screen and in About, and a desktop UA does not |

---

# Part B — Later (fork plan; not built in this build)

Brief by design. Each item needs an RFC before work starts.

### B1 Fork shape

- A Capacitor iOS target in `ios/` in the same repository, built from the same commit as the web release (R12). A product fork, not a git fork, which would drift within weeks.
- The WKWebView runs the same React UI, VexFlow renderer and pure core. Native Swift plugins replace the web backend behind the same `AudioBackend` and `PlatformServices`: `AudioEnginePlugin` (`AVAudioSession` `.playAndRecord`, mode `.measurement`, `[.defaultToSpeaker, .allowBluetoothA2DP]`, never HFP by default, 5 ms IO buffer, built-in mic preferred; `AVAudioSinkNode` capture with the same decimator coefficients; clicks scheduled by sample time; reported latency confirmed by loopback), `StorePlugin` (SQLite via GRDB, same JSON documents, imports IndexedDB data and the web export), `SystemPlugin` (idle timer, orientation lock, Settings deep link, app version). Service worker off; offline from bundled files including the corpus.
- DSP stays in the WebView's worker. Fallback 1 if bridge delivery p95 exceeds 25 ms or the A13 budget fails: the same IIFE bundle in a native `JSContext` (the bare-runtime job is the first evidence this works). Fallback 2, a Swift port with a conformance suite, needs the overseer's approval.
- A native SwiftUI rebuild is rejected: notation and overlay are the most expensive parts and gain nothing natively.

### B2 Phases

- F1a: shell, bundled build and corpus, `SystemPlugin`, CI building the iOS target, internal TestFlight. Not shipped.
- F1b: `AudioEnginePlugin`, `src/platform/ios`, conformance suite in the simulator (fixture WAVs fed into the capture path; grades equal to ±0.5, judgments equal on ≥ 99% of notes).
- F1c: `StorePlugin`, haptic metronome (iPhone only; graded identically, `metronomeMode` recorded; 02 Later L-B), CoreMIDI keyboard input as a separate instrument id (02 Later L-B) with latency `midiTime − t0 − outputLatency − midiInputLatency` (01 Part B).
- F1d: privacy manifest, accessibility pass, external TestFlight, App Review.
- F2 and F3: reminders, WidgetKit streak widget, Game Center (only if leaderboards are approved), CloudKit private sync, Watch haptic click after a spike, AEC experiments, App Intents, Pencil with a teacher mode.

### B3 Device checklist and promotion gate (removes the "iOS: beta" label)

On an A13-class iPhone, a current iPhone and an iPad, each in a Safari tab and as a home-screen app, with results in `docs/ios/latency-log.md`:
- 20 calibrations per device; median RTL varies by ≤ 5 ms across sessions.
- A reference performance played from a second device: onset error p90 within 01's phone budget (01 §8.1) and pitch error p90 within 01's cents budget (01 §8.4).
- At least 95% of 50 takes pass the measurement gate, with zero spurious voids.
- A 60 s take on the A13 phone in Low Power Mode with no backlog.
- Every item in 8.2 checked and recorded.
If measured onset error exceeds 01's budget, 01 updates `measurement-budget.json` and 02 widens the floors in config (R2).

### B4 iOS-only features (placement)

Fork v1: native audio engine, route and interruption handling, AirPods output with built-in mic, haptic metronome, CoreMIDI, native store, offline bundle, iPad stand layout with orientation lock. Later: reminders, widget, Game Center, CloudKit, Watch click, App Intents, Live Activities, Pencil, AirPods as a microphone on iOS 26 (evaluate first), on-device polyphonic research. Never: background audio mode, tracking or ATT, OTA JavaScript updates, a Mac Catalyst build, Sign in with Apple without a backend.

### B5 App Store and privacy

- `NSMicrophoneUsageDescription` matching behaviour: audio analysed on the device, never recorded or uploaded (R9).
- Permission only from the pre-prompt; the app stays usable without the mic (Home, History, Settings, practise without listening).
- Mic indicator off outside practice; no `UIBackgroundModes` audio.
- `PrivacyInfo.xcprivacy` with tracking false and only the required-reason APIs actually used; privacy label "Data Not Collected"; `ITSAppUsesNonExemptEncryption = NO`.
- Review risks: guideline 4.2 met by native audio, haptics, MIDI and offline use (do not submit F1a); 2.5.2 met because corpus updates are data; content licences are 03's allowlist ids; no Kids category in fork v1; IAP decided with the overseer before any monetisation.

### B6 Later-only items cut from v1

W13's 30-day backup nudge; W8's 4 kHz bandwidth heuristic; the device matrix and latency log; the first draft's F0 exit test with a human-recorded take compared against a MacBook.

---

## Open questions (still open after the rulings)

1. **Recheck disagreement and ranking.** 01 §7.7 uses a fresh count-in RTL when it differs from the stored value by more than 5 ms, and marks the calibration stale above 10 ms. 02 §5.2 makes a take unranked when the recheck differs by more than ±10 ms. When the fresh value was itself measured (minimum clicks found, MAD within 01's limit) and used, the take's timing is trustworthy. Recommendation: gate (e) fails only when the recheck could not measure on speakers; a large but measured shift keeps the take ranked, uses the fresh value, and prompts recalibration. 02 to decide in `grading-config.json`.
2. **`rankedReason` names.** 01 §6.5 lists `calibration-unmeasured` and `bluetooth-latency`; 02 §5.2 uses `calibration` and `measurement`. 02 owns ranked rules (R2), so the enum should be 02's, with detail in `AudioEnv.gateFailures`. 01 to align in P0b.
3. **Backlog void threshold.** 01 §7.9 voids when the DSP queue exceeds 8 blocks. With posting every 2 quanta that is about 43 ms of audio, which a GC pause on an A13 could exceed and which would burn the player's excerpt for a delay that never changes grades. Recommendation: express it in time, at about 120 ms queued, below the 32-pair pool's 170 ms. 01 owns the value.
4. **Interruption voids and gaming.** 02 §5.3 lets an interruption void after the first note leave the level window, so locking the screen erases a bad ranked take at the cost of the excerpt. `AudioEnv` and `voidReason` record it; 02 may count such voids against the post-reveal skip limit.

## Dependencies on other roles

- **01:** add `osFamily` and `displayMode` to `PlatformCapabilities` and `navigator.userAgent` and `navigator.audioSession` to the restricted globals in P0b; adopt `AudioEnv` and `GateId` (5.2) in `src/core/types.ts`; open questions 2 and 3; P11 exposes a test-only capture-source hook for IOS7; P21 runs IOS6's viewports V1 to V7.
- **02:** ranked thresholds for gates (b), (e) and (g) in `grading-config.json`; open questions 1 and 4.
- **03:** none beyond 03 §9.1 item 9 (corpus files and credits bundled unchanged later).
- **04:** onboarding calibration step with no Skip control when `outputLatencyReported` is false (W6); badge "Calibrate to earn XP on this device"; one copy string per `GateId`; install coach-mark sheet, storage-loss card, Bluetooth banner, Auto-Lock hint and "iOS: beta" label in `en.json`; the iOS denied-permission copy (section 7 item 9); layouts that meet section 7 at V1 to V7.
- **Overseer:** open questions 1 to 4; staff the fork only after web v1 is stable.

---

## Review log (revision 2)

Rulings applied:
- R1: no key logic here; nothing to change.
- R2: removed every restated tolerance, ranked threshold and calibration value; the measurement gate defines checks and names 02's or 01's file for each threshold; the device gate widens floors through 01's budget and 02's config.
- R3: device matrix, latency log, manual checklist and the F0 exit test with a human-recorded take moved to later; replaced by fake-backend tests, the WebKit oscillator smoke test, iOS layout viewports and 01's in-app self-test. iOS audio stated as unverified at v1.
- R9: no audio stored; `AudioEnv` holds measurements only; MIDI and haptic paths moved to later.
- R11: no feedback change; frozen-layout rule keeps live marks aligned during resizes.
- R12: rewritten around the v1 deliverable (web on iOS Safari, seam, fork plan); fork material compressed into Part B; no native code.
- R13: practise without listening never needs calibration; portrait takes allowed with the rotate hint in scan only.

Own cross-examination answers applied:
- Q1: W-list reranked into v1 and later; W15 cut and replaced by backlog void plus logging; W8 and W13 reduced; per-take recheck added.
- Q2: iOS graded and ranked with an "iOS: beta" label; runtime measurement gate (a) to (g) defined (section 4); device promotion gate in B3.
- Q3: worklet zero-gain path, port relay fallback, buffer pool, block arithmetic, lead ≥ 0.5 s and first-click check, AEC signature, IO-buffer drift (adopted by 01; referenced, not restated).
- Q4: section 7 layout and touch rules and acceptance viewports.
- Q5: seam contents (adopted by 01 §5.2); portability checklist 5.3.
- Q6: definition of done 8.1 and the unverified list 8.2.

Challenges answered:
- Architect, device matrix and self-test: accepted. Device work moved to later; 01's self-test is the substitute.
- Architect, W6 blocking: accepted with modification. Nothing blocks; onboarding has no Skip control when output latency is unreported; unmeasured takes are practice.
- Architect, W3 `getSettings().sampleRate` absent: accepted. 01's clock-rate check is part of W3 and gate (a).
- Architect, W-list trims and QuickJS: accepted with modification. W15 cut with per-hop logging kept; W8 and W13 reduced; Node `vm` runtime; QuickJS later.
- Musician, device matrix and UA-fixture tests: accepted with modification. Branches key on capabilities; the single detector has user-agent fixture tests.
- Musician, W6: accepted (02 §5.2 holds the rule).
- Musician, W4 voids and W15 floors: accepted for voids (02 §5.3 rule; gaming noted as open question 4); the degraded-floor proposal is moot because W15 is cut.
- Musician, MIDI and haptic seam: accepted. `inputPath` and `metronomeMode` in `AudioEnv`; MIDI as a separate instrument id later.
- Researcher, v1 W-list: accepted with modification. W6, W7, W11 and W13 stay in v1 because they are small, testable with fakes, and needed for ranked correctness, the scan on a 30 s Auto-Lock, and storage survival.
- Researcher, corpus size: accepted. Size question closed (9 to 14 MB raw).
- Researcher, licences: accepted. Allowlist referenced by 03's ids.
- Designer, W6 for iOS: accepted with modification (as for the architect).
- Designer, automated viewports: accepted with modification. Viewport set merged with real Safari-tab sizes (V1 to V7).
- Designer, rotate hint during take: accepted. Scan only.
- Designer, haptic seam members: accepted with modification. Members are absent in v1 (01 §14), not marked `@future`, so no UI can be built for them.

Other changes:
- Removed: UA-based iOS detection in W6, the device-matrix table, the "iOS audio checklist" manual script, the claim that port transfer into the worklet works on WebKit, the "create the context after `getUserMedia`" order, native latency rows, the haptic and MIDI members of the seam, `deviceKey`, and open questions 1 to 9 of the first draft (answered by the rulings or moved to later).
- Added: `osFamily` and `displayMode` capabilities, the `AudioEnv` and `GateId` types, the portability checklist, the iOS acceptance viewports, eight v1 work packages, and four open questions.
