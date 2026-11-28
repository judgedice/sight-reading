# Native audio design

Status: design for review. Scope: the Rust audio layer of the Tauri 2 app and the TypeScript backend that drives it. Nothing here changes `src/dsp`, `src/follow`, `src/grade`, `src/notation` or any screen. Section numbers match the brief.

## 0. Decisions in one page

1. **Pitch analysis stays in TypeScript.** The existing DSP worker (`dsp-worker-core.ts`, `DspPipeline`, `LiveFollower`) runs unchanged in the webview. Rust sends raw mono float frames at the engine rate. Decimation, the 3 kHz low-pass and the 5 kHz hi-band energy run in TypeScript through the unchanged `CaptureCore` (`capture-processor.ts`), so a `CaptureBlock` is bit-identical to the web one for the same input frames, by construction. `pnpm gates` never touches native code and keeps its results.
2. **One primitive for playback.** Everything the web backend plays is a pre-rendered mono buffer started at a clock time (clicks, Listen voice, tones) or a sampled buffer with rate, loop and a linear gain envelope. Rust implements exactly that: a sample-accurate buffer voice. The existing TypeScript code keeps deciding what to play (`Metronome`, `renderClick`, `ListenVoiceCache`, `Sampler`, `planSampleNote`), through small adapters. Click samples are therefore identical to the web ones and the click templates used for bleed subtraction keep their meaning.
3. **One clock.** Engine time is the output stream's frame counter divided by its rate. Input frames are mapped onto it through a shared monotonic host clock and delivered on the engine's integer frame grid.
4. **Device library: cpal**, pinned, behind our own `DeviceIo` trait, with small per-platform modules for latency properties. Mobile session, permission and route work goes in a small Swift and Kotlin Tauri plugin.
5. **IPC: one Tauri `Channel` with raw binary payloads for capture**, JSON `invoke` commands for scheduling, one JSON `Channel` for engine events.
6. **Calibration.** A ranked try still needs a stored, measured calibration for its route (R16 unchanged, gate code untouched). Native makes that measurement rare (stable route keys, fixed buffers), cross-checked (OS-reported latency against the measurement) and shorter. Reported latency alone never ranks.

Rulings needed before milestone 2 ends (section 9 has the detail): a native value for `calibration.loopback.minRtlMs` (15 ms today, native routes can measure less), and new `PlatformKind` members for desktop and Android.

## 1. Crates and modules

All under `src-tauri/crates/` (the workspace glob already covers it).

### `sr-audio-core` (pure, `#![forbid(unsafe_code)]`, no device, no Tauri, no threads)

| Module | Main types | Purpose |
| --- | --- | --- |
| `clock` | `StreamClock`, `ClockBridge`, `ClockAnchor`, `RateCheck` | Host time to frame fits, input frame to engine frame map, clock-rate check (port of `clock-fit.ts`) |
| `resample` | `SincResampler`, `DriftController` | Variable-ratio windowed-sinc resampler (32 taps, 64 phases, Kaiser), PI ratio control |
| `capture` | `CaptureAligner`, `Packetizer`, `PacketHeader` | Downmix, locked or resampled path, fixed-size packets with headers and gap counts |
| `mixer` | `Scheduler`, `VoiceSpec`, `Voice`, `BufferStore`, `Envelope` | Sample-accurate voices: start frame, rate (4-point cubic), loop, linear gain segments, stop with fade; fixed capacity (1024 pending, 64 sounding), no allocation in `render` |
| `synth` | `render_click`, `render_listen_note`, `render_tone`, `Rng` | Ports of `core/click-sounds.ts`, `listen-voice.ts`, the sanity tone. Used by the loopback estimator, device-free tests and headless tools; production buffers come from TypeScript (decision 2) |
| `latency` | `LatencyParts`, `LatencyReport`, `TrustClass` | Sums reported parts, classifies trust, predicts round trip |
| `loopback` | `LoopbackEstimator`, `LoopbackEstimate` | Matched filter of a known click against captured input on the engine clock; median lag, MAD, SNR |
| `decode` | `decode_mp3_mono` | symphonia wrapper (pure Rust, so it lives here) |
| `wire` | `encode_packet`, `decode_put_buffer` | Binary layouts of section 3, shared with tests |

`Engine` (in `lib.rs`) owns `Scheduler`, `ClockBridge`, `CaptureAligner`. Its two entry points are plain functions the device layer calls from the callbacks: `render(&mut self, host_ns: u64, out: &mut [f32], channels: usize)` and `capture(&mut self, host_ns: u64, input: &[f32], channels: usize)`. Control reaches it through two `rtrb` single-producer rings (commands in, garbage and notifications out), so the callbacks never lock, allocate or free.

### `sr-audio-device` (thin, platform code allowed)

- `trait DeviceIo { fn open(&mut self, cfg: OpenConfig, engine: EngineHandle) -> Result<OpenInfo>; fn close(&mut self); fn route(&self) -> RouteFacts; fn latency(&self) -> LatencyParts; }`
- `cpal_io.rs`: the default implementation for all five platforms. Requests 48 kHz (falls back to the device default), mono or stereo f32, fixed buffer of 128 frames on Apple, 256 on Android, the device period on WASAPI, 256 on ALSA. Reads `Instant::now()` as the first statement of each callback and passes it as `host_ns`.
- `latency_macos.rs` (CoreAudio properties), `latency_windows.rs` (`IAudioClient`), `latency_linux.rs`, and on mobile the values the plugin hands in.
- `fake_io.rs` (feature `fake`): a simulated duplex device with configurable rates, buffer sizes, output-to-input delay, drift in ppm, callback jitter and bursts. CI and the Linux smoke test use it; it is the only way to test the whole engine without hardware.

Why cpal: it is pure Rust, builds for every target Tauri builds for, and covers CoreAudio (macOS and iOS, RemoteIO), WASAPI, ALSA (PipeWire and PulseAudio through the ALSA plugin) and AAudio. Alternatives: miniaudio needs a C toolchain for five targets and still leaves session work to us; rodio is playback only on top of cpal; oboe and coreaudio-rs are single-platform. What cpal lacks (device latency properties, session configuration, Android input preset) is small and isolated behind `DeviceIo`, so a platform can get a direct backend (`ndk::audio` AAudio, a RemoteIO unit through `coreaudio-rs`) without touching the core.

### App crate (`src-tauri/src/audio.rs`) and plugin

- Tauri commands and channels of section 3, a pump thread that drains the capture ring into the channel, state in `tauri::State<Mutex<AudioHost>>`.
- `tauri-plugin-sr-audio-session` (`src-tauri/plugins/`): Swift for iOS, Kotlin for Android, a no-op on desktop. Section 7 lists what it does.

## 2. Clock model

### Meanings

- **Engine time** `E`: seconds, `outputFrameIndex / engineRate`. Frame 0 is the first frame rendered after `audio_open`. It only moves forward. `engineRate` is the output stream's rate.
- **`now()`**: the render head, the engine time of the next frame the output callback will be asked for, interpolated between callbacks. Same meaning as `AudioContext.currentTime`. In TypeScript it is computed from the latest `ClockAnchor` and `performance.now()`; its error is about 1 ms, which is harmless because nothing graded is derived from JS `now()`.
- **Click time `t`** (`ClickSpec.t`, every `VoiceSpec.t`): the buffer's first sample is written to output frame `round(t * engineRate)`. It is heard `outputLatency` later. Scheduling is done by Rust in frames, so JS timing never moves a click.
- **`audibleNow()`**: `now() - reportedOutputSec` (0 when not reported). Playhead and beat line only.
- **`CaptureBlock.startT`**: engine time at which the block's first decimated sample arrived at the engine, as on the web. Always an exact integer engine frame divided by `engineRate`.
- A measured round trip is therefore output latency plus input latency plus the acoustic path, in engine seconds, exactly what `src/calibration` and `follow` already assume.

### Mapping two streams onto one clock

cpal's `StreamInstant` has a per-stream origin and cannot be compared across streams, so both callbacks stamp themselves with the same process-monotonic clock (`host_ns`).

- Output `StreamClock`: observation `(host_ns, framesRenderedBeforeThisCallback)`. Fit `R(h)`, the render head at host time `h`.
- Input `StreamClock`: observation `(host_ns, framesDeliveredIncludingThisCallback)`. Fit `A(m)`, the host time input frame `m` arrived.
- A callback can be late, never early. Each fit is a least-squares line through the earliest observation of each 100 ms bucket over a 4 s sliding window, refitted every 250 ms. This removes wake-up jitter and back-to-back bursts (the same reason the worklet stamps only the first quantum of a burst).
- Engine position of input frame `m`: `p(m) = R(A(m))`, in output frames. Ratio `r = dp/dm`.

`CaptureAligner` then picks a path when capture starts (both streams must have run for 1 s; they open at `unlock`):

- **Locked** (input rate equals engine rate and `|r - 1| < 5 ppm`, the usual built-in and single-interface case): samples pass through untouched. `p(m) = m + C`, `C` an integer fixed at capture start. The monitor reports `driftFrames = R(A(m)) - (m + C)`; above 1 ms it sets a flag in the packet header and the try keeps going (diagnostics, `clockRateError`).
- **Resampled** (different rate or clock domain): `SincResampler` produces samples at integer engine frames, ratio steered by `DriftController` (PI on the phase error, change limited to 50 ppm per second). Its group delay is subtracted from the frame stamps.

Either way the JS side sees contiguous frames on the engine grid, so `CaptureCore` computes `startT` from integer positions as it does today.

Drift budget: `measurement-budget.json` allows clock mapping 1 ms (laptop) and 2 ms (phone). Locked path error is bounded by the 1 ms monitor; resampled path target is under 0.2 ms.

If the output stream restarts (device change, interruption), engine time continues from `R(h)` so it never goes backwards; any capture in progress fires `device-change` or `interrupted`, which voids the try as today.

### What cpal reports, and how far to trust it

To be confirmed against the pinned cpal version in task M0-2; used only as within-stream differences.

| Backend | Source of `callback` and `capture`/`playback` | Use |
| --- | --- | --- |
| CoreAudio (macOS, iOS) | `mHostTime`; the difference is one buffer duration, computed, not device latency | Ignore the difference; latency from device properties or `AVAudioSession` |
| WASAPI | Output: device position and QPC plus queued padding. Input: QPC position of the packet | Good for buffer delay; excludes driver and enhancement latency |
| ALSA | `snd_pcm_status` timestamp and delay | Good on `hw:` devices; an estimate through the PipeWire or PulseAudio plugin |
| AAudio | `AAudioStream_getTimestamp` (frame, `CLOCK_MONOTONIC`) | Good for output on most devices; input timestamps are missing on some, then callback time |

## 3. IPC

### Capture: Rust to JS

Path: input callback → `CaptureAligner` → SPSC ring (2 s capacity) → pump thread → `Channel<InvokeResponseBody>` with `Raw` payloads → `onmessage(ArrayBuffer)` on the webview main thread → `NativeCaptureFeed` → `CaptureCore` → the session's sink (a `MessagePort` to the DSP worker, transferred buffers, or the relay callback).

Tauri IPC is only available on the main thread, so the main thread is on the path whatever we do. The work it does per packet is a header parse and two short filters (well under 0.1 ms).

Why a raw `Channel` and not events: events are JSON only (a float array as JSON text is 5 to 10 times larger and allocates per number), and are broadcast to every listener. A channel is per call, ordered, and carries bytes.

Packet, little-endian, 24-byte header then samples (24 is a multiple of 4, so `new Float32Array(buf, 24, n)` needs no copy):

| Offset | Type | Field |
| --- | --- | --- |
| 0 | u8 | kind = 1 |
| 1 | u8 | version = 1 |
| 2 | u16 | flags: bit 0 resampled path, bit 1 drift over 1 ms, bit 2 input all zero, bit 3 last packet |
| 4 | u32 | `seq`, from 0 per capture |
| 8 | f64 | `firstFrame`: engine frame of sample 0 (an integer value) |
| 16 | u32 | `nFrames` |
| 20 | u32 | `droppedBefore`: engine frames lost before this packet (ring overflow) |
| 24 | f32 × nFrames | mono samples, full scale ±1 |

- **Batching**: 512 frames per packet (10.7 ms at 48 kHz, about 2 KB, 94 packets per second, 192 KB/s). Configurable 256 to 2048. `CaptureCore` re-blocks to 256 frames, so the packet size never changes a `CaptureBlock`.
- **Expected latency (estimate)**: packet fill 5 ms mean and 10.7 ms worst, pump and channel 1 to 3 ms on desktop, 2 to 6 ms on mobile. This adds to live feedback delay only; timestamps are unaffected. Task M0-1 measures it on all five platforms.
- **Backpressure**: the audio callback never blocks. If the ring is full the aligner drops whole packets and counts the frames into the next header's `droppedBefore`. JS never asks Rust to slow down.
- **Gap detection in JS**: `seq` not previous + 1, or `droppedBefore > 0`, or `firstFrame` not previous end. The feed then pushes that many zero frames through `CaptureCore` (so `startT` of later blocks stays exact) and fires `onCaptureFault({ kind: 'capture-gap' })`, which voids the try as on the web. `CaptureBlock.seq` stays `CaptureCore`'s own counter.
- **Backlog**: as in the web relay, `queueMs = now() - blockEnd` per delivered block; above `capture.backlogVoidMs` (120) it fires `backlog`.

### Commands: JS to Rust (`invoke`, JSON unless marked raw)

```ts
audio_open(a: { input: boolean; outputMode: OutputMode; events: Channel<AudioEvent> }): OpenInfo
audio_close(): void
audio_release_input(): void
audio_permission(a: { request: boolean }): 'granted' | 'denied' | 'prompt' | 'unknown'
audio_clock_sync(): { engineSec: number; hostMs: number }
audio_clock_check(a: { durSec: number }): { error: number | null; consistent: boolean; framesPerSec: number; expected: number; inputDriftPpm: number | null }
audio_put_buffer(raw): void            // header u32 magic 'SRB1', u32 bufferId, u32 sampleRate, u32 nFrames, then f32 samples
audio_decode(raw): raw                 // request: u32 bufferId, then the MP3 file bytes. Reply: u32 sampleRate, u32 nFrames, then f32 samples. Rust keeps the buffer under bufferId
audio_drop_buffers(a: { ids: number[] }): void
audio_schedule(a: { group: 'take' | 'sounds'; voices: VoiceSpec[] }): { late: number[] }
audio_stop_voices(a: { ids: number[]; fadeSec: number }): void
audio_cancel(a: { group: 'take' | 'sounds'; fadeSec: number }): void
audio_capture_start(a: { packets: Channel<ArrayBuffer>; packetFrames: number }): { originFrame: number; engineRate: number; path: 'locked' | 'resampled' }
audio_capture_stop(): { packets: number; frames: number; droppedFrames: number; maxRingMs: number }
audio_measure_loopback(a: { clicks: number; timbre: 'tick' }): LoopbackEstimate

interface VoiceSpec {
  id: number;            // chosen by JS, unique per open
  buffer: number;        // bufferId
  t: number;             // engine seconds of the first played sample
  gain: number;          // linear, applied before the envelope
  rate?: number;         // playback rate against the buffer's own sample rate, default 1
  offsetSec?: number;    // start position in the buffer, buffer seconds
  loop?: [number, number];           // buffer seconds
  env?: [number, number][];          // [engineSec, value] linear segments; absent = constant 1
  stopAt?: number;       // engine seconds
}
interface OpenInfo {
  engineRate: number; outFrames: number; inFrames: number | null; inputRate: number | null;
  route: { inputUid: string; outputUid: string; inputTransport: Transport; outputTransport: Transport;
           processing: { echoCancellation: boolean | null; noiseSuppression: boolean | null; autoGainControl: boolean | null } };
  latency: LatencyReport; clock: ClockAnchor; sessionType: string | null;
}
type Transport = 'built-in' | 'wired' | 'usb' | 'bluetooth' | 'hdmi' | 'network' | 'unknown';
interface LatencyReport { outputSec: number | null; inputSec: number | null; trust: 'A' | 'B' | 'C';
  parts: Record<'outBuffer' | 'outDevice' | 'outSafety' | 'outStream' | 'inBuffer' | 'inDevice' | 'inSafety' | 'inStream', number | null> }
interface ClockAnchor { engineSec: number; hostMs: number; rate: number }   // rate: engine seconds per host second
interface LoopbackEstimate { found: number; scheduled: number; roundTripMs: number | null; madMs: number | null; snrDb: number | null; predictedMs: number | null }
type AudioEvent =
  | { type: 'clock'; anchor: ClockAnchor }                       // every 250 ms
  | { type: 'route'; route: OpenInfo['route']; latency: LatencyReport; engineRate: number }
  | { type: 'interruption'; reason: 'interrupted' | 'hidden' | 'track-ended' | 'device-change' }
  | { type: 'ended'; ids: number[] }
  | { type: 'xrun'; stream: 'input' | 'output'; count: number };
```

Scheduling rules in Rust: start frame `round(t * engineRate)`; a voice whose start is already behind the render head starts at once from its given offset (as a Web Audio source does), and its id is returned in `late`. Group `take` is only cancelled by `audio_cancel('take')`, group `sounds` by `stopSounds`. Output is hard-limited to ±1 and clipped frames are counted. JSON commands cost about 1 ms; every sound is scheduled at least 50 ms ahead (takes 500 ms), so that never matters.

JS maps host time to `performance.now()` once per `audio_clock_sync` round trip (midpoint of the call, keep the sample with the shortest round trip of 5), then follows `clock` events.

## 4. TypeScript side

### Files moved to `src/platform/shared/audio/` (git move, no edits beyond import paths)

`capture-processor.ts`, `protocol.ts`, `metronome.ts`, `listen-voice.ts`, `sampler.ts`, `sample-manifest.ts`, `route.ts`, `clock-fit.ts`, `dsp-worker-core.ts`, `dsp.worker.ts`, `dsp-worker-factory.ts`, `synthetic-capture.ts`, with their tests. `src/platform/web/audio/index.ts` keeps exporting the same names. The eslint boundary table gains a `platform-shared` element, the composition-root file patterns and the no-oscillator rule follow the files, and `platform-native` is added with the same rights as `platform-web`. All of these are reused as-is; none is forked. `web-audio-backend.ts`, `capture.worklet.ts`, `worklet-url.ts` and `deps.ts` stay web-only.

### New files in `src/platform/native/`

| File | Content |
| --- | --- |
| `audio/ipc.ts` | `NativeIpc` interface (the commands above) and its Tauri implementation. The only file that imports `@tauri-apps/api` |
| `audio/engine-clock.ts` | `EngineClock`: anchors in, `now()` out |
| `audio/capture-feed.ts` | `NativeCaptureFeed`: parses packets, checks gaps, hosts one `CaptureCore` with an in-memory `CorePort`, `currentFrame = () => packet.firstFrame`, relay mode, and immediately returns pooled buffers |
| `audio/voice-context.ts` | `NativeVoiceContext`: implements `ClickContext` (for `Metronome`), `SamplerContext` and `Decoder` (for `Sampler`). `createBuffer` and `decodeAudioData` register buffers with Rust; `createBufferSource().start()` collects rate, loop and the gain node's ramps into one `VoiceSpec`; calls in the same task are batched into one `audio_schedule` |
| `audio/native-audio-backend.ts` | `NativeAudioBackend implements AudioBackend` |
| `audio/route.ts` | Route key: `routeKeyOf(inputUid + '>' + outputUid + '@' + inFrames + '/' + outFrames, outputMode, engineRate, osFamily)`; `inputKind` from `inputTransport` |
| `capabilities.ts` | `platform`, `outputLatencyReported = trust !== 'C'`, `serviceWorker: false`, `osFamily` from the OS |
| `boot.ts` | Builds the backend and runtime for `main.tsx` |

`src/app/main.tsx` picks the backend: when `__TAURI_INTERNALS__` is on the window it dynamically imports `platform/native/boot.ts` (a separate chunk, so the web bundle and `pnpm size` are unchanged), otherwise it builds `WebAudioBackend` as now. `workerFactory` is `createDspWorker` in both. `createCaptureChannel` is passed when `MessageChannel` exists, so blocks go from the main thread straight to the worker.

### `NativeAudioBackend`

Seam members: `capabilities`, `unlock` (opens streams, events channel, clock sync; no gesture needed but harmless), `permissionState`, `now`, `audibleNow`, `scheduleTake` (the shared `Metronome.scheduleTake` on a `NativeVoiceContext` in group `take`), `cancelTake`, `startCapture` (port or callback), `stopCapture`, `playCalibrationClicks`, `playTone` (same render loop as the web backend, moved into a shared `renderTone` function), `playNotes` (same branch as web: `playSampledNotes` when the set is ready, else `ListenVoiceCache`), `prepareSound`, `playClicks`, `stopSounds`, `measureClockRate`, `onRouteChange`, `onInterruption`, `close`, `captureRelay` (true: blocks pass the main thread), `releaseInput`, `audioInfo` (`contextSampleRate = engineRate`, `contextRecreated = false`, `audioSessionType` from the plugin, `clockRateError` from `audio_clock_check`).

Beyond-seam members the app already probes for: `setOutputMode`, `setInputEnabled`, `reopenInput`, `onCaptureFault`, `captureStats`, `checkClockRate`, `captureOrigin`, `soundState`, `clickHistory`. New optional ones for native calibration services: `latencyReport(): LatencyReport` and `measureLoopback(): Promise<LoopbackEstimate>`.

`AudioRouteInfo.reportedLatencySec` is the reported output latency (as the type says) when trust is A or B, absent for C.

## 5. Latency

### What each platform reports

| Platform | Output parts | Input parts | Trust |
| --- | --- | --- | --- |
| macOS | buffer frames + `kAudioDevicePropertyLatency` + `SafetyOffset` + `kAudioStreamPropertyLatency` (output scope) | same in input scope | A for built-in, wired, USB; C for Bluetooth, AirPlay, HDMI |
| iOS, iPadOS | `AVAudioSession.outputLatency` + `ioBufferDuration` | `inputLatency` + `ioBufferDuration` | A for built-in, wired, USB; C for Bluetooth, AirPlay |
| Windows | `IAudioClient::GetStreamLatency` + device period (queried on our own client for the same endpoint and format) | same on the capture endpoint | B (driver and enhancement delay not included); C for Bluetooth |
| Linux | cpal `playback - callback` (ALSA delay) + buffer | cpal `callback - capture` + buffer | B on `hw:` devices; C through PipeWire or PulseAudio |
| Android | AAudio timestamp delay (`playback - callback`) + burst | AAudio input timestamp delay when supported | B with `FEATURE_AUDIO_PRO` or low-latency feature; else C; C for Bluetooth |

`predictedMs = (outputSec + inputSec) * 1000`. Bluetooth is known from the OS transport type, not guessed from labels.

### Native loopback measurement

`audio_measure_loopback`: `synth::render_click('tick')`, 8 clicks at random 150 to 250 ms gaps after 200 ms of silence, scheduled through the same `Scheduler`; the full-rate captured input (before packetizing) is high-passed at 5 kHz and matched against the click; per-click lag by parabolic peak, result median and MAD. About 2 s. It measures on the single engine clock, with no JS in the loop. It is a cross-check and a fast pre-check; it does not write a `Calibration`.

### Mapping to the existing record

The `Calibration` record is still produced only by `src/calibration/run.ts` over the seam (it needs the low-band templates, click leak, noise floor, sanity tone and AEC signature that only that flow measures). On native: `method: 'loopback'` or `'play-along'` as today, `roundTripMs` and `spreadMs` from the same analysis, `outputLatencyMs = reportedLatencySec * 1000`, `clockRateError` from `checkClockRate`, `platform` per ruling. The native calibration service stores `{ predictedMs, measuredMs, trust }` in kv under `native:latency:<routeKey>`.

### When calibration can be skipped or shortened

1. **Ranked** needs a stored, non-stale `loopback` or `play-along` calibration for the route key. Unchanged; `isMeasuredFor`, `rankedAvailability` and gate (g) are not edited. R16 and R17 hold as written.
2. **Skipped** (the step is not offered): such a record exists for the native route key. The key is built from device UIDs, rate and granted buffer sizes, so it survives restarts and label changes, and with fixed buffers the round trip of a route is constant. Two guards: on every `unlock`, if `predictedMs` differs from the stored one by more than 2 ms the record is marked stale; on speakers the count-in recheck (R31) keeps checking every try.
3. **Shortened** (speakers, trust A or B): run `measureLoopback` first. If it finds at least 7 of 8 clicks, MAD at most 0.5 ms and a round trip under 100 ms, the run uses a native profile: the 2 s clock-rate window is replaced by the engine's running check, and click gaps are 200 to 350 ms instead of 400 to 700 (`randomClickTimes` already takes `gapSec`; `run.ts` gains an option to pass it, default unchanged). Click counts and every acceptance threshold stay. About 7 s instead of about 15 s. If the pre-check fails, the normal run plays.
4. **Without measuring**: practice only. With trust A or B the session's existing `reported` estimate is used (unranked, as today). With trust C nothing is reported and the 80 ms estimate applies.
5. **Bluetooth** (R17): transport type sets `inputKind: 'bluetooth'`; trust is C; play-along as today; anything measuring over 120 ms is unranked by the existing gate.
6. **Proposed, needs a ruling, not built here**: on trust A, a wired-headphone round trip derived from this device's own speaker measurement (`predicted(wired) + measured(speakers) - predicted(speakers)`) is likely within 2 ms, better than play-along's 11 ms. Until ruled it would be stored as `reported` and stay unranked.

### Expected round trip (estimates, to be replaced by measurements in M4)

| Route | Estimate |
| --- | --- |
| macOS built-in speakers and microphone, 128 frames | 15 to 30 ms (browser today: 95 to 101 ms) |
| macOS or iPad with a USB interface | 8 to 15 ms |
| iPhone, iPad built-in, 5 ms IO buffer, measurement mode | 12 to 25 ms |
| Windows WASAPI shared | 35 to 60 ms |
| Linux ALSA `hw:` | 10 to 25 ms |
| Linux PipeWire default quantum | 45 to 70 ms |
| Android pro-audio device | 20 to 40 ms |
| Android other | 40 to 120 ms |

## 6. Samples

Checked: `public/sounds/` holds 148 MP3 files (MPEG-1 Layer III, 44.1 kHz, mono, about 56 kbit/s, ID3v2.4 tags, 2.0 MB in total) in one folder per set, plus `index.json` (`format.container: "mp3"`, per-sample `midi`, `tune`, `onset`, loop points).

- The files ship once, as frontend assets in `dist/sounds/`. The unchanged `Sampler` fetches `index.json` and the MP3 bytes with the webview's `fetch` (same relative URLs, works in dev and in bundles on every platform).
- `NativeVoiceContext.decodeAudioData` sends the bytes to `audio_decode`. Rust decodes with `symphonia` (features `mp3` only, gapless trimming on), keeps the PCM as `Arc<[f32]>` under the buffer id, and returns the same PCM so the unchanged TypeScript code measures onset and rise on exactly the samples Rust will play. A set is about 2 MB of PCM crossing IPC once.
- Playback uses `rate * 44100 / engineRate` with cubic interpolation. The manifest's `onset` against the measured onset (`onsetShift`) already absorbs decoder priming differences.
- A failed decode rejects, and `Sampler` falls back to the additive voice as on the web.

## 7. Permissions and entitlements (list only)

- **macOS**: `NSMicrophoneUsageDescription`; entitlement `com.apple.security.device.audio-input` (hardened runtime); with the sandbox also `com.apple.security.app-sandbox`. Permission state and request through `AVCaptureDevice` (audio).
- **iOS, iPadOS**: `NSMicrophoneUsageDescription`. No background audio mode. Plugin: record permission; `AVAudioSession` category `playAndRecord`, mode `measurement`, options `defaultToSpeaker` and `allowBluetoothA2DP` (not `allowBluetooth`, to avoid the hands-free profile unless chosen), preferred rate 48000, preferred IO buffer 5 ms, `setActive`; reads `inputLatency`, `outputLatency`, `ioBufferDuration`, `sampleRate`, `currentRoute`; forwards interruption, route-change and media-services-reset notifications.
- **Android**: `RECORD_AUDIO` (runtime, requested by the plugin from the activity), `MODIFY_AUDIO_SETTINGS`; `uses-feature` `android.hardware.microphone` (required), `android.hardware.audio.low_latency` and `android.hardware.audio.pro` (not required). Plugin: permission, `AudioManager` device list and types, `AudioDeviceCallback`, audio focus, the two feature flags.
- **Windows**: nothing in an unpackaged app (the system microphone privacy switch for desktop apps applies); MSIX needs the `microphone` device capability.
- **Linux**: none natively; Flatpak needs the PipeWire or PulseAudio socket, Snap the `audio-record` and `audio-playback` plugs.
- **Tauri**: the plugin's permission set in `capabilities/default.json`. The CSP already allows `ipc:`.

Pure Rust: streams, mixing, clock, desktop latency properties, macOS permission. Swift or Kotlin plugin: mobile permission, session and focus, route facts, interruptions.

## 8. Test plan

### Rust core (`cargo test -p sr-audio-core`, no device)

| Test | Signal | Pass |
| --- | --- | --- |
| `scheduler_starts_on_exact_frame` | 200 unit impulses at random times, render sizes 64 to 1024 mixed | every impulse at `round(t * rate)`, 0 frames error |
| `scheduler_chunking_invariant` | a take of clicks rendered in 128, 441 and 1024-frame callbacks | outputs bit-identical |
| `voice_rate_loop_envelope` | 440 Hz buffer, rate 2^(3/12), loop, linear envelope | pitch within 0.5 cent; envelope within 1e-4 of the linear ideal |
| `late_voice_reported` | voice 10 ms behind the head | starts in the next callback from its given offset, id in `late` |
| `clock_fit_rejects_jitter` | callbacks with 0 to 3 ms late jitter and bursts of 4 | `R(h)` error under 0.05 ms after 2 s |
| `bridge_locked_same_clock` | fake duplex, 0 ppm, 128 and 256-frame buffers | locked path; samples bit-identical to input; stamp error 0 frames |
| `bridge_tracks_drift` | input 48 kHz + 200 ppm, 120 s | resampled path; stamp error under 0.2 ms throughout; no gap |
| `bridge_rate_convert` | input 44.1 kHz, output 48 kHz, impulse train | each impulse stamped within 0.05 ms |
| `resampler_response` | sines 100 Hz to 10 kHz, ratio 1.0002 and 48/44.1 | passband within 0.05 dB to 10 kHz; images under -90 dB |
| `rate_check_matches_ts` | the vectors of `clock-fit.test.ts` | same `consistent` and `error` within 1e-9 |
| `synth_click_golden`, `synth_listen_golden` | vectors written by `tools/native/golden.ts` from `renderClick` and `renderListenNote` at 44.1 and 48 kHz | max difference 1e-6 |
| `loopback_estimator_delay` | fake device, 23.4 ms delay, 20 dB SNR noise | within 0.1 ms, MAD under 0.1 ms, 8 of 8 |
| `loopback_estimator_rejects_silence` | no path from output to input | `found = 0`, `roundTripMs = null` |
| `decode_mp3_fixture` | three files from `public/sounds` | 44.1 kHz mono, length within 1 frame of the reference, onset within 1 ms of the manifest plus priming |
| `packet_roundtrip`, `ring_overflow_counts` | random packets; pump stalled 3 s | bytes identical; `droppedBefore` equals frames lost, later `firstFrame` exact |

### TypeScript and Rust equivalence of the capture path

1. `capture-feed.test.ts` (Vitest): the same pseudo-random 48 kHz and 44.1 kHz signals go through `CaptureCore` in 128-frame quanta (the web path) and through `NativeCaptureFeed` in packets of 256, 512, 480 and irregular sizes. Every `CaptureBlock` must be equal bit for bit (`lowband`, `hiEnergy` compared as `Uint32Array`), with equal `seq`, `analysisRate` and `startT`.
2. `wire-golden.test.ts`: `cargo run -p sr-audio-core --example capture_golden` writes a packet stream for a fixed input (`fixtures/native/capture-48k.bin`, checked in). The TS parser must reproduce the input samples bit for bit; the Rust `packet_roundtrip` test reads the same file.
3. Gap handling: a stream with `droppedBefore = 1536` yields one `capture-gap` fault, and the next block's `startT` equals the gap-free run's.
4. Gates on the resampled path: `tools/native/gates-resampled.ts` passes the gate fixtures through the Rust resampler (44.1 to 48 kHz, and 48 kHz + 200 ppm) and runs `tools/gates`. Every gate must keep its pass or fail result, with onset times within 0.3 ms and pitch within 0.5 cent of the direct run. The locked path needs no such run: it is bit-identical.
5. Backend tests: `native-audio-backend.test.ts` against `FakeNativeIpc` (a TS model of the scheduler and clock), mirroring the cases of `web-audio-backend.test.ts` that apply (take schedule, click history, accents per output mode, sounds refused during a take, stop, faults, route change).
6. End to end on Linux CI: the Tauri app with `fake_io` at 23.4 ms round trip runs the calibration screen and one synthetic try (`synthetic-capture.ts` signal fed by the fake device). Calibration must report 23.4 ± 0.3 ms and the try must grade exactly as the same fixture does in the web e2e.

`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm gates`, `pnpm size` and the web e2e stay required and unchanged.

## 9. Risks and open questions, ranked

1. **Clock bridge quality outside Apple platforms.** Callback timing on WASAPI shared mode, PipeWire and many Android devices is bursty, and input and output may sit on different clocks. If the measured round trip of a route is not stable to 1 ms, grading on that platform is no better than the web. Fallback: those routes are trust C and calibrate fully, the count-in recheck still protects each try, and a platform that fails M4's acceptance ships on `WebAudioBackend` inside the webview (WebView2 and Android WebView are Chromium), which is the current product.
2. **Raw channel delivery and main-thread stalls, mainly on Android.** A stalled main thread delays blocks; over 120 ms voids the try. Fallback, in order: 1024-frame packets; a loopback-only WebSocket opened by the DSP worker itself, which removes the main thread from the path (needs a CSP `connect-src` entry).
3. **cpal limits on mobile.** No session configuration on iOS, no control of the AAudio input preset or sharing mode, fixed buffer sizes not always honoured, device change handling varies. Fallback: a direct backend for that platform behind `DeviceIo` (`ndk::audio`, or one duplex RemoteIO unit, which would also give a single callback and a trivially shared clock).
4. **`calibration.loopback.minRtlMs` is 15.** `analyzeLoopback` and `calibrationQualityOk` reject a round trip under 15 ms, which native routes with an interface can reach. Needs a ruling: the native composition passes a budget copy with `minRtlMs` 3. Fallback without a ruling: the engine adds a fixed output delay so the round trip is at least 16 ms.
5. **`PlatformKind` is `'web' | 'ios'`.** Desktop and Android need values (`'desktop'`, `'android'` proposed; additive change to `types.ts` and the JSON schemas). Fallback: `'web'` with `osFamily` telling them apart, which is wrong in stored records and should not ship.
6. **Resampled path changes the input slightly.** Covered by test 4. Fallback: open the input at the engine rate wherever the OS allows, so only true cross-clock routes resample.
7. **MP3 decode differences** between symphonia and browser decoders (priming, length). Only Listen playback alignment is affected and `onsetShift` absorbs it. Fallback: decode in the webview with `OfflineAudioContext` and upload PCM with `audio_put_buffer`.
8. **Reported latency may be wrong on some models** (speaker DSP not included). It never ranks and only gates the short profile through the pre-check, so the cost is a normal-length calibration.
9. **Sleep, wake and hot-plug.** Streams can die silently. The engine watches for 500 ms without callbacks and raises `interruption`.

Open questions for the owner: items 4 and 5; whether rule 6 of section 5 (derived wired calibration) is wanted; whether the iOS onboarding Skip control should appear once latency is reported (R16's wording allows it).

## 10. Implementation tasks

Sizes are working days for one mid-level engineer. (S) needs the senior audio engineer, at least for review of the design-critical part.

**M0 Spikes (before committing to details)**
- M0-1 (S, 2 d) Raw channel benchmark app: 512-frame packets for 10 minutes on all five platforms; record delivery delay p50, p99, max and loss. Decides packet size and whether risk 2's fallback is needed.
- M0-2 (S, 2 d) Pin cpal; read its timestamp and buffer-size code per backend; correct the table in section 2; log real callback timing on macOS, Windows, one Android phone.

**M2 Playback and clock** (STATUS milestone 2)
- M2-1 (2 d) `sr-audio-core` skeleton, `wire`, `BufferStore`, command rings.
- M2-2 (S, 3 d) `Scheduler` and `Voice` with the first four tests of section 8.
- M2-3 (S, 3 d) `StreamClock`, `ClockBridge` (output side), `RateCheck`, their tests.
- M2-4 (2 d) `fake_io` and `cpal_io` output only; `audio_open`, `audio_close`, `audio_put_buffer`, `audio_schedule`, `audio_cancel`, `audio_stop_voices`, `audio_clock_sync`, events channel.
- M2-5 (2 d) Move the shared TS files, update eslint and dependency-cruiser tables; all web checks green.
- M2-6 (3 d) `ipc.ts`, `EngineClock`, `NativeVoiceContext` (click part), `NativeAudioBackend` output half, `FakeNativeIpc`, backend tests; `main.tsx` switch and `boot.ts`.
- M2-7 (2 d) `decode`, `audio_decode`, sampler adapter, `prepareSound` and `playNotes` with samples.
- M2-8 (1 d) `synth` ports and golden tool.

**M3 Capture** (milestone 3)
- M3-1 (S, 3 d) Input `StreamClock`, `CaptureAligner` locked path, `Packetizer`, ring, pump, `audio_capture_start/stop`.
- M3-2 (S, 4 d) `SincResampler`, `DriftController`, resampled path and tests.
- M3-3 (2 d) `NativeCaptureFeed`, faults, stats, equivalence tests 1 to 3.
- M3-4 (2 d) Desktop permission, route facts, route key, route and interruption events, `releaseInput`, `setInputEnabled`.
- M3-5 (2 d) Linux end-to-end test with `fake_io` (test 6) in CI.
- M3-6 (1 d) `gates-resampled` tool (test 4).

**M4 Calibration and latency** (milestone 4)
- M4-1 (2 d each) `latency_macos`, `latency_windows`, `latency_linux`.
- M4-2 (S, 2 d) `LoopbackEstimator`, `audio_measure_loopback`, tests.
- M4-3 (2 d) Native calibration service: kv latency record, stale guard, pre-check and short profile, budget override per ruling.
- M4-4 (S, 3 d) Hardware pass on the owner's Mac and one Windows machine: round trip, MAD over 20 runs and 5 restarts, predicted against measured. Acceptance: MAD at most 0.5 ms within a run, at most 1 ms across restarts. Fills the estimates table with measurements.

**M5 Mobile and parity** (milestone 5)
- M5-1 (S, 4 d) iOS plugin (Swift): permission, session, latency, notifications; device run.
- M5-2 (4 d) Android plugin (Kotlin): permission, devices, focus, features; device run; (S) decision on a direct AAudio backend.
- M5-3 (2 d) Sleep, wake, hot-plug and background handling on all platforms.
- M5-4 (S, 2 d) Per-platform go or fallback decision against risk 1, with the M4-4 method on each platform.
