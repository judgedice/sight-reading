# Native audio design

Status: as built for the Rust side (sections 1 to 3, 5, 6 and 8 describe the code in `src-tauri/`; where the first design was changed the text says so). Platform code for macOS and Windows is compile-checked and unit-tested but **not yet verified on hardware**; section 11 lists what must be measured. Scope: the Rust audio layer of the Tauri 2 app and the TypeScript backend that drives it. Nothing here changes `src/dsp`, `src/follow`, `src/grade`, `src/notation` or any screen. Section numbers match the brief.

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
| `clock` | `StreamClock`, `ClockBridge`, `ClockAnchor`, `RateCheck` | Host time to frame fits, the output clock, clock-rate check (port of `clock-fit.ts`) |
| `resample` | `SincResampler`, `DriftController` | Windowed-sinc interpolator (32 taps, 64 phases with linear interpolation between them, Kaiser beta 11), PI ratio control |
| `capture` | `CaptureHalf`, `CaptureReader`, `CaptureAligner`, `Packetizer` | Downmix, locked or resampled path, packets with headers and gap counts, start and stop |
| `mixer` | `Scheduler`, `VoiceSpec`, `Voice`, `BufferStore`, `Envelope` | Sample-accurate voices: start frame, rate (4-point cubic), loop, linear gain segments (at most 8 points), stop with fade; fixed capacity (1024 pending, 64 sounding), no allocation in `render` |
| `synth` | `render_click`, `render_listen_note`, `render_tone`, `Rng` | Bit-exact ports of `core/click-sounds.ts`, `listen-voice.ts`, `render-tone.ts`, `rng.ts`. Used by the loopback driver, tests and tools; production buffers come from TypeScript (decision 2) |
| `latency` | `LatencyParts`, `LatencyReport`, `TrustClass` | Sums reported parts, classifies trust, predicts round trip |
| `loopback` | `LoopbackEstimator`, `LoopbackDriver` | Matched filter of a known click against captured input on the engine clock; median lag, MAD, SNR; the driver that plays and captures |
| `decode` | `decode_mp3_mono` | symphonia 0.5.5 wrapper |
| `wire` | `encode_packet_into`, `decode_put_buffer` | Binary layouts of section 3 |
| `sim` (feature) | `SimDuplex` | A duplex device in virtual time: rates, buffers, loop delay, drift, jitter, stalls. The fake device and the tests run on it |

`engine(config)` returns the two halves. `Engine` (realtime) owns the `Scheduler` and the output `ClockBridge`; the device layer calls `render(&mut self, host_ns, out, channels)` from the output callback. The capture side is a separate `CaptureHalf` (`engine.split_capture()`), because with two cpal streams the input callback runs on another thread: it owns the input `StreamClock` and reads the output clock through an anchor the render side publishes with a sequence lock of atomics. `EngineHandle` (control) holds the `BufferStore`: a scheduled voice carries its own reference to the samples, so putting and dropping buffers never touches the audio thread. Three `rtrb` rings join the halves (commands in; notifications out; buffers of ended voices out, freed by `EngineHandle::poll`), plus a command, an event and a 2 s packet ring for capture. The callbacks never lock, allocate or free (`tests/rt_alloc.rs` counts allocator calls: 0).

### `sr-audio-device` (thin, platform code allowed)

- `trait DeviceIo { open(cfg, make_engine: EngineFactory, events) -> OpenInfo; close(); route(); latency(); set_input(bool) -> OpenInfo; }`. The engine rate is only known once the device has negotiated, so `open` takes an `EngineFactory` (`FnOnce(rate) -> Engine`) and calls it once. `OpenInfo` carries rates, buffer sizes, route facts, the latency report and the `ClockRelation` of the two streams.
- `cpal_io.rs`: cpal 0.18.2 on all desktop platforms. Requests 48 kHz (falls back to the device default), stereo out and mono in as f32 (other formats converted), fixed buffer of 128 frames on Apple, 256 on Linux and Android, the device period on WASAPI. Both streams live on one owner thread.
- `stamps.rs`, `host_clock.rs`: the callback stamp. Default: the monotonic clock read as the callback's first statement. CoreAudio only, opt-in with `SR_AUDIO_STAMPS=device`: the buffer's `mHostTime` (see section 2). `SR_AUDIO_STAMP_LOG=1` prints callback interval and stamp statistics at close.
- `latency_macos.rs` (CoreAudio properties, clock domain), `latency_windows.rs` (`IAudioClient`), `latency_linux.rs`; `permission.rs` (microphone permission). All `unsafe` is in these, each in one small inner module.
- `fake_io.rs` (feature `fake`): paces a `SimDuplex` in real time. Environment: `SR_AUDIO_DEVICE=fake` selects it (`SR_AUDIO_ALLOW_FAKE=1` allows it as a fallback when no device opens); `SR_FAKE_LOOP_MS`, `SR_FAKE_LOOP_GAIN`, `SR_FAKE_IN_RATE`, `SR_FAKE_PPM`, `SR_FAKE_INPUT_F32` set the loop and the input signal. CI and the Linux smoke test use it.

Why cpal: it is pure Rust, builds for every target Tauri builds for, and covers CoreAudio (macOS and iOS, RemoteIO), WASAPI, ALSA (PipeWire and PulseAudio through the ALSA plugin) and AAudio. Alternatives: miniaudio needs a C toolchain for five targets and still leaves session work to us; rodio is playback only on top of cpal; oboe and coreaudio-rs are single-platform. What cpal lacks (device latency properties, session configuration, Android input preset) is small and isolated behind `DeviceIo`, so a platform can get a direct backend (`ndk::audio` AAudio, a RemoteIO unit through `coreaudio-rs`) without touching the core.

### App crate (`src-tauri/src/audio.rs`) and plugin

- Tauri commands and channels of section 3, a pump thread that polls the handle and drains the capture ring into the channel, state in `tauri::State<AudioHost>`. Test hooks `audio_debug_hooks` and `audio_debug_signal` exist only with the fake device and `SR_E2E_HOOKS=1`.
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
- A callback can be late, never early, so the truth lies on or above every observation. Per 100 ms bucket only the earliest observation is kept, over a 4 s window. The line, refitted every 250 ms: its offset touches those points from above; its slope is a least-squares fit through the earliest observation of each 1 s bucket over 32 s once 8 exist, before that (from 1 s on) the edge of the 4 s window's upper convex hull over its centre, before 1 s the nominal rate. A plain least-squares line through the bucket points, as first designed, sits 0.14 to 0.43 ms below the truth with 3 ms of jitter. Measured: under 0.02 ms from 10 s on for 128, 256 and 480-frame callbacks; from 2 s on under 0.05 ms at 128 frames and up to 0.13 ms at 480.
- Step: when, in two refits running, the newest 0.5 s lies off the line through the rest by more than 0.5 ms and more than three times the window's own scatter (an xrun), the older points are dropped and `ClockUpdate.step` is set. Without the scatter term rough callback timing alone fired it (480 frames with 5 ms jitter: 3 steps in 120 s and 0.66 ms error; now 0 steps, 0.07 ms). A 10 ms xrun is found after 0.8 to 0.9 s. A capture in progress ends there: its last packet carries bits 3 and 4. A loss too small to be a step is not seen as one; on the locked path it shows as drift (below).
- Engine position of input frame `m`: `p(m) = R(A(m))`, in output frames. Ratio `r = dp/dm`.

A capture starts at the first input callback at which the two clock fits together place a frame within 0.1 ms (rate uncertainty over 2.5 s), and is announced by a `Started` event; `audio_capture_start` waits for it (up to 14 s). That is at once on streams that have run a while, about 1.2 s after open or after an output restart with regular callbacks, and 5 to 9 s with 3 ms of callback jitter; after 12 s it starts anyway, resampled. `CaptureAligner` then picks a path:

- **Locked**: samples pass through untouched. `p(m) = m + C`, `C = round(R(A(m)) - m)` fixed at capture start. Chosen when the device layer says the clocks are shared (`ClockRelation::Shared`: one device, or one non-zero CoreAudio clock domain), the rates are equal and the measurement does not contradict it (measured difference minus the uncertainty of both fits at most 2 ppm); or, with unknown clocks, when the rates are equal and the measured rate difference plus that uncertainty is under 0.5 ppm (0.3 ms over ten minutes; at 5 ppm, the first design, a 10-minute capture at +3 ppm ended 1.8 ms off). The monitor reports `drift = R(A(m)) - (m + C)`; once it has been over 0.4 ms for 0.5 s, flag bit 1 is set for the rest of the capture and the receiver voids it. So a locked capture is inside 0.5 ms or void: a claim of shared clocks that is wrong by 1.5 ppm is flagged after 265 s at 0.40 ms; one wrong by 20 ppm is overridden at the start once the clocks have settled.
- **Resampled** (different rate, separate clocks, or not yet known to be one): `SincResampler` reads the input at the position the clocks give for each integer engine frame. The kernel is centred on that position, so there is no group delay to subtract. `DriftController`: feed-forward from the two fitted rates, PI on the phase error (time constant 2 s), ratio change limited to 50 ppm per second while the phase error is under 50 microseconds and faster in proportion to the square of the error beyond (a flat limit left a capture started on young clocks 0.4 ms off for 8 s).

Either way the JS side sees contiguous frames on the engine grid, so `CaptureCore` computes `startT` from integer positions as it does today.

Drift budget: `measurement-budget.json` allows clock mapping 1 ms (laptop) and 2 ms (phone). Measured on the simulated device with 3 ms of callback jitter and stalls: locked path offset error 0 frames from 4 s after open (2 frames at 1.5 s); resampled path 0.02 ms over 120 s at +200 ppm, and 0.14 ms for a capture that starts 1.5 s after open with 10 ms input callbacks.

If the output stream restarts (`EngineHandle::output_restarted`), engine time continues from `R(h)` so it never goes backwards; voices that lay wholly inside the gap end silently, longer ones carry on in place. A capture in progress ends (step flag on its last packet): the output clock is a single point after a restart and nothing can be placed on it. The next capture waits for the new clock as at open (measured: 2 to 6 s with 3 ms jitter, then 0.013 ms). The app also fires `device-change` or `interrupted`.

### What cpal reports, and how far to trust it

Read from cpal 0.18.2 for CoreAudio; the other rows are still to be confirmed. Used only as within-stream differences, except the opt-in CoreAudio device stamps below.

| Backend | Source of `callback` and `capture`/`playback` | Use |
| --- | --- | --- |
| CoreAudio (macOS, iOS) | `callback` is the buffer's `mHostTime` converted to nanoseconds; `playback`/`capture` add or subtract buffer + device latency + safety offset, read once at stream start | Ignore the difference; latency from device properties or `AVAudioSession` |
| WASAPI | Output: device position and QPC plus queued padding. Input: QPC position of the packet | Good for buffer delay; excludes driver and enhancement latency |
| ALSA | `snd_pcm_status` timestamp and delay | Good on `hw:` devices; an estimate through the PipeWire or PulseAudio plugin |
| AAudio | `AAudioStream_getTimestamp` (frame, `CLOCK_MONOTONIC`) | Good for output on most devices; input timestamps are missing on some, then callback time |

**CoreAudio in cpal 0.18.2 (read from source, unverified on hardware).** A fixed buffer size is checked against `kAudioDevicePropertyBufferFrameSizeRange` (out of range is an error; we clamp first and fall back to the default size) and then set as `kAudioDevicePropertyBufferFrameSize`, a device-level property, through the stream's audio unit. Input and output are separate HAL audio units; on one device the second request sets the same property, on two devices (the built-in microphone and speakers of a Mac are two) each gets its own. The default output uses the `DefaultOutput` unit, which follows a change of the system default device by itself; cpal then reports `DeviceChanged`, which the app maps to `device-change`. Callback sizes can differ from the device buffer when the unit converts rates, so the core never assumes a size.

**Which stamp.** `mHostTime` comes from the system's model of the device clock and has no wake-up jitter; it is on the clock Rust's monotonic clock also reads, so mapping it is one constant measured at open. But it means something else: when the buffer's first frame reaches (output) or left (input) the device, not when the callback ran. With it engine time becomes device time and a measured round trip loses the two IO buffers and safety offsets, so a calibration made with one stamp source is void with the other. CoreAudio IO threads are realtime threads and the fit already rejects late callbacks, so callback stamps are expected to be good on a Mac. Decision: callback stamps stay the default; device stamps are built behind `SR_AUDIO_STAMPS=device` with a plausibility guard (250 ms, then one switch back) and are to be judged by measurement (section 11).

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
| 2 | u16 | flags: bit 0 resampled path, bit 1 drift (0.4 ms for 0.5 s; stays set), bit 2 input all zero, bit 3 last packet, bit 4 a clock stepped and the capture ended |
| 4 | u32 | `seq`, from 0 per capture; counts packets written (a dropped packet shows in `droppedBefore` and `firstFrame`, not in `seq`) |
| 8 | f64 | `firstFrame`: engine frame of sample 0 (an integer value) |
| 16 | u32 | `nFrames` |
| 20 | u32 | `droppedBefore`: engine frames lost before this packet (ring overflow) |
| 24 | f32 × nFrames | mono samples, full scale ±1 |

- **Batching**: a capture always ends with a packet carrying bit 3, possibly with no frames; the packet before a break in the grid is short. 512 frames per packet (10.7 ms at 48 kHz, about 2 KB, 94 packets per second, 192 KB/s). Configurable 256 to 2048. `CaptureCore` re-blocks to 256 frames, so the packet size never changes a `CaptureBlock`.
- **Expected latency (estimate)**: packet fill 5 ms mean and 10.7 ms worst, pump and channel 1 to 3 ms on desktop, 2 to 6 ms on mobile. This adds to live feedback delay only; timestamps are unaffected. Task M0-1 measures it on all five platforms.
- **Backpressure**: the audio callback never blocks. If the ring is full the aligner drops whole packets and counts the frames into the next header's `droppedBefore`. JS never asks Rust to slow down.
- **Void flags in JS**: bit 1 or bit 4 on any packet, an `xrun` event while capturing, or a `late` event for a voice of the `take` group fire the same `capture-gap` fault as a gap, once per capture; the session voids the try on it. A calibration run does not listen for faults, so `stopCapture` throws when a capture in which calibration clicks were scheduled is void, and the run fails instead of storing a number.
- **Gap detection in JS**: `seq` not previous + 1, or `droppedBefore > 0`, or `firstFrame` not previous end. The feed then pushes that many zero frames through `CaptureCore` (so `startT` of later blocks stays exact) and fires `onCaptureFault({ kind: 'capture-gap' })`, which voids the try as on the web. `CaptureBlock.seq` stays `CaptureCore`'s own counter.
- **Backlog**: as in the web relay, `queueMs = now() - blockEnd` per delivered block; above `capture.backlogVoidMs` (120) it fires `backlog`.

### Commands: JS to Rust (`invoke`, JSON unless marked raw)

```ts
audio_open(a: { input: boolean; outputMode: OutputMode; events: Channel<AudioEvent> }): OpenInfo
audio_close(): void
audio_release_input(): void
audio_set_input(a: { enabled: boolean }): OpenInfo   // closes or reopens the input stream only; the output keeps running
audio_permission(a: { request: boolean }): 'granted' | 'denied' | 'prompt' | 'unknown'
audio_clock_sync(): { engineSec: number; hostMs: number }
audio_clock_check(a: { durSec: number }): { error: number | null; consistent: boolean; framesPerSec: number; expected: number; inputDriftPpm: number | null }
audio_put_buffer(raw): void            // header: the bytes 'S','R','B','1', u32 bufferId, u32 sampleRate, u32 nFrames, then f32 samples
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
  | { type: 'route'; route: OpenInfo['route']; latency: LatencyReport; engineRate: number }   // after every device change, with the facts read again
  | { type: 'interruption'; reason: 'interrupted' | 'hidden' | 'track-ended' | 'device-change' }
  | { type: 'ended'; ids: number[] }
  | { type: 'late'; ids: number[] }                              // started late after `audio_schedule` had returned
  | { type: 'rejected'; ids: number[] }                          // refused for capacity; no sound, no `ended`
  | { type: 'xrun'; stream: 'input' | 'output'; count: number };
```

Scheduling rules in Rust: start frame `round(t * engineRate)`; a voice whose start is already behind the render head starts at once from its given offset (as a Web Audio source does). `audio_schedule` returns in `late` the voices already behind the head when the call was made; one that falls behind in the few milliseconds before the audio thread takes it arrives in a `late` event. A call is all or nothing (unknown buffer, bad field, full queue). An envelope has at most 8 points (two at one time make a step). With 64 voices sounding a new one is `rejected`, not stolen. Stopping a voice that has not started removes it and sends `ended`. Group `take` is only cancelled by `audio_cancel('take')`, group `sounds` by `stopSounds`. Output is hard-limited to ±1 and clipped frames are counted. JSON commands cost about 1 ms; every sound is scheduled at least 50 ms ahead (takes 500 ms), so that never matters.

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

| Platform | Output parts | Input parts | Trust | State |
| --- | --- | --- | --- | --- |
| macOS | buffer frames + `kAudioDevicePropertyLatency` + `SafetyOffset` + `kAudioStreamPropertyLatency` (output scope), at the device's nominal rate | same in input scope | A for built-in, wired, USB; C otherwise | implemented, unverified on hardware |
| iOS, iPadOS | `AVAudioSession.outputLatency` + `ioBufferDuration` | `inputLatency` + `ioBufferDuration` | A for built-in, wired, USB; C otherwise | not built (plugin, M5) |
| Windows | `IAudioClient::GetStreamLatency` + device period, on a client of our own for the same endpoint, never started | same on the capture endpoint | B (driver and enhancement delay not included); C for Bluetooth | implemented, unverified on hardware |
| Linux | buffer; cpal `playback - callback` (ALSA delay) only on `hw:` devices | buffer only | B on `hw:` devices; C through PipeWire or PulseAudio | implemented; `hw:` unverified |
| Android | AAudio timestamp delay + burst | AAudio input timestamp delay when supported | B with the pro-audio or low-latency feature; else C | not built (M5) |

A side's sum is null unless its buffer part and at least one of its device and stream parts are known; a part without a source stays null and nothing is estimated. Bluetooth, HDMI, network and unknown transports are trust C on every platform. Clock relation: macOS says `shared` for one device or one non-zero clock domain; Windows and Linux always say `unknown`. The platform lookups use the platform's own device id (cpal's display form `<host>:<id>` is only the route key) and return nothing for an id they cannot find; there is no fallback to the default device. After a device change (`DeviceChange` from cpal; on CoreAudio an output opened as the default follows the system default by itself) the device layer reads the identity of the device behind the stream again and the app sends `route`, so the webview's route key and latency are those of the device that now plays, and the calibration of the old route stops applying.

`predictedMs = (outputSec + inputSec) * 1000`. Bluetooth is known from the OS transport type, not guessed from labels.

### Native loopback measurement

`audio_measure_loopback` (`LoopbackDriver`): `synth::render_click('tick')`, 8 clicks at random 150 to 250 ms gaps after 200 ms of silence, scheduled through `EngineHandle::schedule`; the run is a capture whose full-rate packets are read on the Rust side (the matched filter cannot run on the audio thread, so no webview capture can run at the same time); capture and click are high-passed at 5 kHz and matched; per-click lag by parabolic peak; a click counts when its peak stands 18 dB above its window and within 1 ms of the median; result median and MAD, null below 3 found. A clock step during the run restarts it once. About 2 s, plus the wait for the clocks when the streams have just opened. It measures on the single engine clock, with no JS in the loop. It is a cross-check and a fast pre-check; it does not write a `Calibration`.

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

- **macOS** (built, unverified on hardware): `NSMicrophoneUsageDescription` in `src-tauri/Info.plist` (merged into the bundle, and embedded in the binary by `tauri dev`); entitlement `com.apple.security.device.audio-input` in `src-tauri/Entitlements.plist`, referenced from `bundle.macOS.entitlements` and applied when the bundle is signed (if an unsigned bundle build ever trips on it, remove that one line; the file stays); minimum system 11.0. Permission state and request through `AVCaptureDevice` (audio) in `permission.rs`: `audio_permission({ request: true })` waits for the user's answer on a worker thread, never on the main thread. With the sandbox also `com.apple.security.app-sandbox`.
- **iOS, iPadOS**: `NSMicrophoneUsageDescription`. No background audio mode. Plugin: record permission; `AVAudioSession` category `playAndRecord`, mode `measurement`, options `defaultToSpeaker` and `allowBluetoothA2DP` (not `allowBluetooth`, to avoid the hands-free profile unless chosen), preferred rate 48000, preferred IO buffer 5 ms, `setActive`; reads `inputLatency`, `outputLatency`, `ioBufferDuration`, `sampleRate`, `currentRoute`; forwards interruption, route-change and media-services-reset notifications.
- **Android**: `RECORD_AUDIO` (runtime, requested by the plugin from the activity), `MODIFY_AUDIO_SETTINGS`; `uses-feature` `android.hardware.microphone` (required), `android.hardware.audio.low_latency` and `android.hardware.audio.pro` (not required). Plugin: permission, `AudioManager` device list and types, `AudioDeviceCallback`, audio focus, the two feature flags.
- **Windows**: `audio_permission` is `granted` when an input device enumerates. Nothing in an unpackaged app (the system microphone privacy switch for desktop apps applies); MSIX needs the `microphone` device capability.
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
| `clock_fit_rejects_jitter` | callbacks with 0 to 3 ms late jitter and bursts of 4 | `R(h)` error under 0.05 ms from 2 s on at 128 frames, from 10 s on at 256 and 480 (under 0.2 ms before) |
| `bridge_locked_same_clock` | fake duplex, 0 ppm, 128 and 256-frame buffers | locked path; samples bit-identical to input; stamp error 0 frames |
| `bridge_tracks_drift` | input 48 kHz + 200 ppm, 120 s | resampled path; stamp error under 0.2 ms throughout; no gap |
| `bridge_rate_convert` | input 44.1 kHz, output 48 kHz, impulse train | each impulse stamped within 0.05 ms |
| `resampler_response` | sines 100 Hz to 10 kHz, ratio 1.0002 and 48/44.1 | passband within 0.05 dB to 10 kHz; images under -90 dB |
| `rate_check_matches_ts` | the vectors of `clock-fit.test.ts` | same `consistent` and `error` within 1e-9 |
| `synth_click_golden`, `synth_listen_golden` | vectors written by `tools/native/golden.ts` from `renderClick` and `renderListenNote` at 44.1 and 48 kHz | max difference 1e-6 |
| `loopback_estimator_delay` | fake device, 23.4 ms delay, 20 dB SNR noise | within 0.1 ms, MAD under 0.1 ms, 8 of 8 |
| `whole_engine_click_arrivals` | 24 clicks through the simulated device at 23.4 ms | arrival error under 0.02 ms locked, 0.2 ms resampled with jitter |
| `loopback_estimator_rejects_silence` | no path from output to input | `found = 0`, `roundTripMs = null` |
| `decode_mp3_fixture` | three files from `public/sounds` | 44.1 kHz mono, length within 1 frame of an ffmpeg gapless decode, onset within 1 ms of that decode and not later than the manifest plus 1 ms (38 of the 148 files start more than 1 ms off their manifest onset in any decoder) |
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
9. **Sleep, wake and hot-plug.** Streams can die silently. The app's poll loop watches the output callback count, and the input frame count while something captures: 500 ms without movement raises `interruption` (`interrupted`), once per stall.

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

## 11. To measure on the owner's Mac (nothing below has run on hardware)

Run the app from a terminal with `SR_AUDIO_STAMP_LOG=1`; built-in speakers and microphone unless noted.

1. First microphone use: the system prompt appears with the usage text, `audio_permission` goes `prompt` to `granted`, and the app is not killed. Repeat with a signed bundle (entitlement applied).
2. `audio_open` reply: `outFrames` and `inFrames` (128 expected), `engineRate` and `inputRate`, `route` (both transports `built-in`), the eight latency parts, `trust` (A expected). Then `audio_capture_start` within 5 s of open: `path` is `locked` only if the two built-in devices report one clock domain (the relation itself is not in the reply); note which.
3. Time from `audio_capture_start` to its reply right after open (the wait for the clocks: about 1.2 s expected with regular callbacks; note it if it is several seconds). Stamp log at close: callback interval minimum and maximum for both streams (the jitter the clock fit has to reject), and the spread of device stamp minus callback clock.
4. `audio_clock_check({ durSec: 2 })` after 15 s: `error`, `consistent`, `inputDriftPpm` (under 1 ppm expected on one clock).
5. `audio_measure_loopback` 20 times in one run and once after each of 5 restarts: `roundTripMs`, `madMs`, `found`, the capture path, `predictedMs`. Acceptance (M4-4): MAD at most 0.5 ms within a run, round trips within 1 ms across restarts. Note predicted minus measured.
6. The same with `SR_AUDIO_STAMPS=device`. Expect a smaller round trip by roughly both buffers and safety offsets; compare the spread across restarts with step 5. Device stamps become the default only if they are clearly steadier.
7. With a USB interface if one is at hand: steps 2 and 5 (one device: `shared`, locked path).
8. Unplug or switch the default output during playback: an `interruption` event with `device-change` arrives, then a `route` event with the new device's UID, transport and latency parts, and the app asks for calibration of the new route instead of using the old one. During a capture: the capture ends with the step flag and the try is void.
9. Does cpal report input xruns on CoreAudio at all (unverified)? Provoke one (heavy load, 128 frames) during a capture and check for an `xrun` event; losses below 0.5 ms are otherwise caught only as drift on the locked path once they add up to 0.4 ms.
