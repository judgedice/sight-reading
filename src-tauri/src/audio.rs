//! The app side of the native audio layer (design section 3): the `AudioHost` state, the poll thread that
//! forwards engine notifications as JSON events and pumps capture packets into the webview channel, and the
//! Tauri commands.
//!
//! Locking: the `EngineHandle` sits behind one mutex and the capture reader (with its mode: idle, webview
//! capture, loopback run) behind another; order is handle, then capture. The poll thread takes both for a few
//! microseconds every 5 ms; packets are sent to the channel after the locks are released. Decoding and wire
//! parsing happen before a lock is taken. `audio_clock_sync` takes neither (it reads the lock-free
//! `ClockReader`). Commands that wait (open, capture start and stop, loopback) run on blocking threads.

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use sr_audio_core::capture::{CaptureConfig, CaptureEvent, CapturePath, CaptureStats, StreamKind as CaptureStreamKind};
use sr_audio_core::clock::ClockAnchor;
use sr_audio_core::loopback::{LoopbackConfig, LoopbackDriver, LoopbackError, LoopbackEstimate, LoopbackStatus};
use sr_audio_core::decode::decode_mp3_mono;
use sr_audio_core::latency::{LatencyParts, LatencyReport, Transport};
use sr_audio_core::mixer::{AudioBuffer, Group, VoiceSpec as CoreVoiceSpec};
use sr_audio_core::wire;
use sr_audio_core::{engine, CaptureReader, ClockReader, EngineConfig, EngineHandle, Notification};
use sr_audio_device::cpal_io::CpalIo;
use sr_audio_device::fake_io::{FakeConfig, FakeIo, SignalControl};
use sr_audio_device::{host_clock, DeviceError, DeviceEvent, DeviceIo, EngineFactory, InterruptionReason, OpenConfig, OpenInfo, RouteFacts, StreamKind};
use tauri::ipc::{Channel, InvokeBody, InvokeResponseBody, Request, Response};
use tauri::State;

/// How often the poll thread runs `EngineHandle::poll` and the packet pump.
const POLL_PERIOD: Duration = Duration::from_millis(5);
/// How long `audio_capture_start` waits for the engine to announce the capture.
const CAPTURE_START_WAIT: Duration = Duration::from_secs(3);
/// How long `audio_capture_stop` waits for the last packet.
const CAPTURE_STOP_WAIT: Duration = Duration::from_secs(3);
/// How long `audio_open` waits for the first clock anchor.
const FIRST_ANCHOR_WAIT: Duration = Duration::from_millis(1500);

// ---------------------------------------------------------------------------------------------------------------
// JSON shapes (section 3 of the design, camelCase where the TypeScript is)
// ---------------------------------------------------------------------------------------------------------------

/// `OutputMode` of `src/core/types.ts`. Accepted and validated; the engine does not use it yet.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OutputMode {
    /// Built-in or external speakers.
    Speakers,
    /// Wired headphones.
    Wired,
    /// Bluetooth.
    Bluetooth,
}

/// `'take' | 'sounds'`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GroupName {
    /// Clicks of a take.
    Take,
    /// Everything else.
    Sounds,
}

impl From<GroupName> for Group {
    fn from(g: GroupName) -> Group {
        match g {
            GroupName::Take => Group::Take,
            GroupName::Sounds => Group::Sounds,
        }
    }
}

/// `VoiceSpec` of the design. `gain` defaults to 1 when absent.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceSpecJson {
    /// Chosen by JS, unique per open.
    pub id: u32,
    /// Buffer id.
    pub buffer: u32,
    /// Engine seconds of the first played sample.
    pub t: f64,
    /// Linear gain before the envelope.
    #[serde(default = "one")]
    pub gain: f32,
    /// Playback rate against the buffer's own rate.
    pub rate: Option<f64>,
    /// Start position in the buffer, buffer seconds.
    pub offset_sec: Option<f64>,
    /// Loop start and end, buffer seconds.
    #[serde(rename = "loop")]
    pub loop_sec: Option<(f64, f64)>,
    /// `[engineSec, value]` points.
    pub env: Option<Vec<(f64, f32)>>,
    /// Engine seconds at which the voice is cut.
    pub stop_at: Option<f64>,
}

fn one() -> f32 {
    1.0
}

impl From<&VoiceSpecJson> for CoreVoiceSpec {
    fn from(v: &VoiceSpecJson) -> Self {
        CoreVoiceSpec {
            id: v.id,
            buffer: v.buffer,
            t: v.t,
            gain: v.gain,
            rate: v.rate.unwrap_or(1.0),
            offset_sec: v.offset_sec.unwrap_or(0.0),
            loop_sec: v.loop_sec,
            env: v.env.clone().unwrap_or_default(),
            stop_at: v.stop_at,
        }
    }
}

/// `ClockAnchor` of the design: `rate` is engine seconds per host second.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClockAnchorJson {
    /// Render head at `host_ms`, engine seconds.
    pub engine_sec: f64,
    /// Host monotonic time, ms.
    pub host_ms: f64,
    /// Engine seconds per host second.
    pub rate: f64,
}

impl From<ClockAnchor> for ClockAnchorJson {
    fn from(a: ClockAnchor) -> Self {
        ClockAnchorJson { engine_sec: a.engine_sec, host_ms: a.host_ms, rate: a.rate }
    }
}

/// Reply of `audio_clock_sync`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClockSync {
    /// Engine time at `host_ms`, seconds.
    pub engine_sec: f64,
    /// The host clock reading the engine time was evaluated at, ms.
    pub host_ms: f64,
}

/// Reply of `audio_clock_check`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClockCheck {
    /// Fractional rate error; `null` unless consistent.
    pub error: Option<f64>,
    /// True when the window is a usable measurement.
    pub consistent: bool,
    /// Measured engine frames per host second (`null` when no slope could be fitted).
    pub frames_per_sec: Option<f64>,
    /// Nominal engine rate.
    pub expected: f64,
    /// Input clock drift, ppm; always `null` until capture exists.
    pub input_drift_ppm: Option<f64>,
}

/// `LatencyReport` parts, seconds or `null`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LatencyPartsJson {
    /// Output buffer.
    pub out_buffer: Option<f64>,
    /// Output device.
    pub out_device: Option<f64>,
    /// Output safety offset.
    pub out_safety: Option<f64>,
    /// Output stream.
    pub out_stream: Option<f64>,
    /// Input buffer.
    pub in_buffer: Option<f64>,
    /// Input device.
    pub in_device: Option<f64>,
    /// Input safety offset.
    pub in_safety: Option<f64>,
    /// Input stream.
    pub in_stream: Option<f64>,
}

impl From<LatencyParts> for LatencyPartsJson {
    fn from(p: LatencyParts) -> Self {
        LatencyPartsJson {
            out_buffer: p.out_buffer,
            out_device: p.out_device,
            out_safety: p.out_safety,
            out_stream: p.out_stream,
            in_buffer: p.in_buffer,
            in_device: p.in_device,
            in_safety: p.in_safety,
            in_stream: p.in_stream,
        }
    }
}

/// `LatencyReport` of the design.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LatencyReportJson {
    /// Reported output latency, seconds.
    pub output_sec: Option<f64>,
    /// Reported input latency, seconds.
    pub input_sec: Option<f64>,
    /// `'A' | 'B' | 'C'`.
    pub trust: char,
    /// The parts.
    pub parts: LatencyPartsJson,
}

impl From<LatencyReport> for LatencyReportJson {
    fn from(r: LatencyReport) -> Self {
        LatencyReportJson { output_sec: r.output_sec, input_sec: r.input_sec, trust: r.trust.as_str().chars().next().unwrap_or('C'), parts: r.parts.into() }
    }
}

/// `route.processing`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessingJson {
    /// Echo cancellation applied by the OS; `null` = unknown.
    pub echo_cancellation: Option<bool>,
    /// Noise suppression.
    pub noise_suppression: Option<bool>,
    /// Automatic gain control.
    pub auto_gain_control: Option<bool>,
}

/// `OpenInfo['route']`. With no input open, `inputUid` is the empty string and `inputTransport` `'unknown'`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteJson {
    /// Input device id.
    pub input_uid: String,
    /// Output device id.
    pub output_uid: String,
    /// `Transport` of the input.
    pub input_transport: String,
    /// `Transport` of the output.
    pub output_transport: String,
    /// OS processing flags.
    pub processing: ProcessingJson,
}

impl From<&RouteFacts> for RouteJson {
    fn from(r: &RouteFacts) -> Self {
        RouteJson {
            input_uid: r.input_uid.clone().unwrap_or_default(),
            output_uid: r.output_uid.clone(),
            input_transport: r.input_transport.unwrap_or(Transport::Unknown).as_str().to_string(),
            output_transport: r.output_transport.as_str().to_string(),
            processing: ProcessingJson { echo_cancellation: None, noise_suppression: None, auto_gain_control: None },
        }
    }
}

/// Reply of `audio_open`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenInfoJson {
    /// Engine rate = output stream rate.
    pub engine_rate: u32,
    /// Output buffer, frames (0 = unknown).
    pub out_frames: u32,
    /// Input buffer, frames; `null` while capture is not implemented.
    pub in_frames: Option<u32>,
    /// Input rate; `null` while capture is not implemented.
    pub input_rate: Option<u32>,
    /// Route facts.
    pub route: RouteJson,
    /// Reported latency.
    pub latency: LatencyReportJson,
    /// Anchor of the engine clock at open.
    pub clock: ClockAnchorJson,
    /// Mobile session type.
    pub session_type: Option<String>,
}

/// Reason of an `interruption` event.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum InterruptionJson {
    /// Taken away.
    Interrupted,
    /// Backgrounded.
    Hidden,
    /// Track ended.
    TrackEnded,
    /// Device or route changed.
    DeviceChange,
}

impl From<InterruptionReason> for InterruptionJson {
    fn from(r: InterruptionReason) -> Self {
        match r {
            InterruptionReason::Interrupted => InterruptionJson::Interrupted,
            InterruptionReason::Hidden => InterruptionJson::Hidden,
            InterruptionReason::TrackEnded => InterruptionJson::TrackEnded,
            InterruptionReason::DeviceChange => InterruptionJson::DeviceChange,
        }
    }
}

/// `'input' | 'output'`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StreamName {
    /// Input stream.
    Input,
    /// Output stream.
    Output,
}

/// `AudioEvent` of the design. `Late` and `Rejected` are additions: voices that started behind the render head, and
/// voices the engine refused.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[allow(clippy::large_enum_variant)] // events are built and sent one at a time; boxing would only add noise
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum AudioEvent {
    /// Every 250 ms.
    Clock {
        /// The anchor.
        anchor: ClockAnchorJson,
    },
    /// Route or latency changed (not emitted yet).
    Route {
        /// The route.
        route: RouteJson,
        /// Latency report.
        latency: LatencyReportJson,
        /// Engine rate.
        engine_rate: u32,
    },
    /// The stream is no longer reliable.
    Interruption {
        /// Why.
        reason: InterruptionJson,
    },
    /// Voices that will make no more sound (ran out, stopped, cancelled). Rejected voices are not listed here.
    Ended {
        /// Their ids.
        ids: Vec<u32>,
    },
    /// Voices the engine refused (64 sounding, or its pending queue was full). They make no sound and get no `Ended`.
    Rejected {
        /// Their ids.
        ids: Vec<u32>,
    },
    /// Voices that started late (after the call that scheduled them returned).
    Late {
        /// Their ids.
        ids: Vec<u32>,
    },
    /// Under- or overruns reported by the backend since the last event.
    Xrun {
        /// Which stream.
        stream: StreamName,
        /// How many.
        count: u32,
    },
}

/// Reply of `audio_schedule`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ScheduleReply {
    /// Ids of voices already late when the call was made.
    pub late: Vec<u32>,
}

// ---------------------------------------------------------------------------------------------------------------
// Capture and loopback shapes
// ---------------------------------------------------------------------------------------------------------------

/// Reply of `audio_capture_start`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStartReply {
    /// Engine frame of the first sample of packet 0.
    pub origin_frame: f64,
    /// Engine rate, Hz.
    pub engine_rate: u32,
    /// `'locked' | 'resampled'`.
    pub path: &'static str,
}

/// Reply of `audio_capture_stop`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStopReply {
    /// Packets written.
    pub packets: u64,
    /// Frames in them.
    pub frames: u64,
    /// Engine frames dropped because the ring was full.
    pub dropped_frames: u64,
    /// Fullest the ring has been, ms.
    pub max_ring_ms: f64,
}

/// `LoopbackEstimate` of the design.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoopbackEstimateJson {
    /// Clicks found.
    pub found: u32,
    /// Clicks scheduled.
    pub scheduled: u32,
    /// Median round trip, ms.
    pub round_trip_ms: Option<f64>,
    /// Median absolute deviation, ms.
    pub mad_ms: Option<f64>,
    /// Signal-to-noise ratio, dB.
    pub snr_db: Option<f64>,
    /// Round trip predicted by the reported latencies, ms.
    pub predicted_ms: Option<f64>,
}

impl From<LoopbackEstimate> for LoopbackEstimateJson {
    fn from(e: LoopbackEstimate) -> Self {
        LoopbackEstimateJson { found: e.found, scheduled: e.scheduled, round_trip_ms: e.round_trip_ms, mad_ms: e.mad_ms, snr_db: e.snr_db, predicted_ms: e.predicted_ms }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Host state
// ---------------------------------------------------------------------------------------------------------------

/// Where events go: a Tauri channel in production, a collector in tests.
pub type EventSink = Arc<dyn Fn(AudioEvent) + Send + Sync>;
/// Where capture packets go: a raw Tauri channel in production.
pub type PacketSink = Arc<dyn Fn(Vec<u8>) + Send + Sync>;

/// What the capture reader is doing. One user at a time: the reader has one owner.
enum Mode {
    Idle,
    /// A webview capture; packets go to the sink.
    Webview(PacketSink),
    /// A loopback measurement, which consumes the packets itself.
    Loopback(Box<LoopbackDriver>),
}

struct CaptureCtl {
    reader: CaptureReader,
    mode: Mode,
    /// Set by the poll thread when `Started` is seen.
    started: Option<(u64, u32, CapturePath)>,
    /// Set by the poll thread after the last packet of a webview capture has been sent.
    stopped: Option<CaptureStats>,
    /// Set by the poll thread when a loopback run ends.
    loopback: Option<Result<LoopbackEstimate, LoopbackError>>,
}

/// State shared between the commands and the poll thread. Lock order: `handle`, then `capture`.
struct Shared {
    handle: Mutex<EngineHandle>,
    capture: Mutex<CaptureCtl>,
    /// Ids already reported late in a `schedule` reply; their `Late` notification is then not forwarded again.
    late_seen: Mutex<HashSet<u32>>,
}

struct Session {
    device: Box<dyn DeviceIo>,
    shared: Arc<Shared>,
    clock: ClockReader,
    info: OpenInfo,
    stop: Arc<AtomicBool>,
    poller: Option<JoinHandle<()>>,
}

impl Session {
    fn input_open(&self) -> bool {
        self.info.in_frames.is_some()
    }

    fn shutdown(mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(p) = self.poller.take() {
            let _ = p.join();
        }
        self.device.close();
    }
}

#[derive(Default)]
struct HostInner {
    session: Mutex<Option<Session>>,
    /// The fake device's replaceable input signal (debug hook `audio_debug_signal`); unused by real devices.
    signal: SignalControl,
}

impl Drop for HostInner {
    fn drop(&mut self) {
        let s = self.session.get_mut().unwrap_or_else(|p| p.into_inner()).take();
        if let Some(s) = s {
            s.shutdown();
        }
    }
}

/// Tauri state: at most one open session. Cloning shares it (so slow commands can run on a blocking thread).
#[derive(Default, Clone)]
pub struct AudioHost {
    inner: Arc<HostInner>,
}

fn not_open() -> String {
    "audio is not open: call audio_open first".to_string()
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

/// The clock anchor evaluated now. Before the first refit there is no anchor yet: the render head and the host
/// clock at this instant stand in for it (rate 1).
fn anchor_now(clock: &ClockReader) -> ClockAnchorJson {
    match clock.anchor() {
        Some(a) => {
            let now = host_clock::now_ms();
            ClockAnchorJson { engine_sec: a.engine_sec_at(now), host_ms: now, rate: a.rate }
        }
        None => ClockAnchorJson { engine_sec: clock.frames_rendered() as f64 / clock.engine_rate() as f64, host_ms: host_clock::now_ms(), rate: 1.0 },
    }
}

fn wait_until(timeout: Duration, mut done: impl FnMut() -> bool) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if done() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}

impl AudioHost {
    fn session<R>(&self, f: impl FnOnce(&mut Session) -> Result<R, String>) -> Result<R, String> {
        let mut g = lock(&self.inner.session);
        f(g.as_mut().ok_or_else(not_open)?)
    }

    fn shared(&self) -> Result<Arc<Shared>, String> {
        self.session(|s| Ok(Arc::clone(&s.shared)))
    }

    /// Opens `device` and starts the poll thread. An already open session is closed first (a reloaded webview
    /// has lost its handle on the old one).
    pub fn open_with(&self, mut device: Box<dyn DeviceIo>, cfg: OpenConfig, sink: EventSink) -> Result<OpenInfoJson, DeviceError> {
        self.close();
        let slot: Arc<Mutex<Option<EngineHandle>>> = Arc::new(Mutex::new(None));
        let factory: EngineFactory = {
            let slot = Arc::clone(&slot);
            Box::new(move |rate| {
                let (e, h) = engine(EngineConfig::new(rate));
                *lock(&slot) = Some(h);
                e
            })
        };
        let (events_tx, events_rx) = mpsc::channel::<DeviceEvent>();
        let info = device.open(cfg, factory, events_tx)?;
        let mut handle = lock(&slot).take().ok_or_else(|| DeviceError::Backend("the device did not build the engine".into()))?;
        let reader = handle.take_capture_reader().ok_or_else(|| DeviceError::Backend("the engine has no capture reader".into()))?;
        let clock = handle.clock();
        let shared = Arc::new(Shared {
            handle: Mutex::new(handle),
            capture: Mutex::new(CaptureCtl { reader, mode: Mode::Idle, started: None, stopped: None, loopback: None }),
            late_seen: Mutex::new(HashSet::new()),
        });

        let deadline = Instant::now() + FIRST_ANCHOR_WAIT;
        while clock.anchor().is_none() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(5));
        }

        let stop = Arc::new(AtomicBool::new(false));
        let poller = {
            let (shared, stop) = (Arc::clone(&shared), Arc::clone(&stop));
            std::thread::Builder::new()
                .name("sr-audio-poll".into())
                .spawn(move || poll_loop(shared, events_rx, sink, stop))
                .map_err(|e| DeviceError::Backend(e.to_string()))?
        };
        let json = open_info_json(&info, anchor_now(&clock));
        *lock(&self.inner.session) = Some(Session { device, shared, clock, info, stop, poller: Some(poller) });
        Ok(json)
    }

    /// Stops the poll thread and the device. Idempotent.
    pub fn close(&self) {
        let session = lock(&self.inner.session).take();
        if let Some(s) = session {
            s.shutdown();
        }
    }

    /// `audio_set_input` and `audio_release_input`: closes or reopens the input stream; the output keeps playing.
    /// Refused while a capture or a loopback measurement runs.
    pub fn set_input(&self, enabled: bool) -> Result<OpenInfoJson, String> {
        self.session(|s| {
            if !matches!(lock(&s.shared.capture).mode, Mode::Idle) {
                return Err("a capture or loopback measurement is running: stop it before changing the input".into());
            }
            let info = s.device.set_input(enabled).map_err(|e| e.to_string())?;
            s.info = info;
            Ok(open_info_json(&s.info, anchor_now(&s.clock)))
        })
    }

    /// `audio_clock_sync`.
    pub fn clock_sync(&self) -> Result<ClockSync, String> {
        let clock = self.session(|s| Ok(s.clock.clone()))?;
        let a = anchor_now(&clock);
        Ok(ClockSync { engine_sec: a.engine_sec, host_ms: a.host_ms })
    }

    /// `audio_clock_check`.
    pub fn clock_check(&self, dur_sec: f64) -> Result<ClockCheck, String> {
        let shared = self.shared()?;
        let r = lock(&shared.handle).rate_check(dur_sec);
        Ok(ClockCheck {
            error: r.error.filter(|e| e.is_finite()),
            consistent: r.consistent,
            frames_per_sec: Some(r.frames_per_sec).filter(|f| f.is_finite()),
            expected: r.expected,
            input_drift_ppm: r.input_drift_ppm.filter(|p| p.is_finite()),
        })
    }

    /// `audio_put_buffer`: the raw body.
    pub fn put_buffer(&self, body: &[u8]) -> Result<(), String> {
        let pb = wire::decode_put_buffer(body).map_err(|e| format!("audio_put_buffer: {e}"))?;
        let shared = self.shared()?;
        lock(&shared.handle).put_buffer(pb.buffer_id, AudioBuffer::new(pb.samples, pb.sample_rate));
        Ok(())
    }

    /// Second half of `audio_decode`: stores the decoded buffer.
    fn store_decoded(&self, id: u32, buffer: AudioBuffer) -> Result<(), String> {
        let shared = self.shared()?;
        lock(&shared.handle).put_buffer(id, buffer);
        Ok(())
    }

    /// `audio_drop_buffers`.
    pub fn drop_buffers(&self, ids: &[u32]) -> Result<(), String> {
        let shared = self.shared()?;
        lock(&shared.handle).drop_buffers(ids);
        Ok(())
    }

    /// `audio_schedule`.
    pub fn schedule(&self, group: GroupName, voices: &[VoiceSpecJson]) -> Result<ScheduleReply, String> {
        let shared = self.shared()?;
        let specs: Vec<CoreVoiceSpec> = voices.iter().map(CoreVoiceSpec::from).collect();
        let mut h = lock(&shared.handle);
        let out = h.schedule(group.into(), &specs).map_err(|e| format!("audio_schedule: {e}"))?;
        // Recorded under the handle lock, so the poll thread cannot see the `Late` notification before this.
        lock(&shared.late_seen).extend(out.late.iter().copied());
        Ok(ScheduleReply { late: out.late })
    }

    /// `audio_stop_voices`.
    pub fn stop_voices(&self, ids: &[u32], fade_sec: f64) -> Result<(), String> {
        let shared = self.shared()?;
        let r = lock(&shared.handle).stop_voices(ids, fade_sec);
        r.map_err(|e| format!("audio_stop_voices: {e}"))
    }

    /// `audio_cancel`.
    pub fn cancel(&self, group: GroupName, fade_sec: f64) -> Result<(), String> {
        let shared = self.shared()?;
        let r = lock(&shared.handle).cancel(group.into(), fade_sec);
        r.map_err(|e| format!("audio_cancel: {e}"))
    }

    /// `audio_capture_start`: asks for a capture and waits (up to 3 s) for the engine to announce it.
    pub fn capture_start(&self, packet_frames: u32, sink: PacketSink) -> Result<CaptureStartReply, String> {
        let (shared, relation) = self.session(|s| {
            if !s.input_open() {
                return Err("audio_capture_start: no input is open (open with input: true, or audio_set_input)".into());
            }
            s.device.capture_requested();
            Ok((Arc::clone(&s.shared), s.info.clock_relation))
        })?;
        {
            let mut c = lock(&shared.capture);
            match c.mode {
                Mode::Idle => {}
                Mode::Webview(_) => return Err("audio_capture_start: a capture is already running".into()),
                Mode::Loopback(_) => return Err("audio_capture_start: a loopback measurement is running".into()),
            }
            c.started = None;
            c.stopped = None;
            c.reader.start(CaptureConfig { packet_frames, relation }).map_err(|e| format!("audio_capture_start: {e}"))?;
            c.mode = Mode::Webview(sink);
        }
        let ok = wait_until(CAPTURE_START_WAIT, || lock(&shared.capture).started.is_some());
        let mut c = lock(&shared.capture);
        match c.started {
            Some((origin, engine_rate, path)) if ok => Ok(CaptureStartReply { origin_frame: origin as f64, engine_rate, path: path.as_str() }),
            _ => {
                let _ = c.reader.stop();
                c.mode = Mode::Idle;
                Err("audio_capture_start: the capture did not start within 3 s (are input callbacks running?)".into())
            }
        }
    }

    /// `audio_capture_stop`: ends the capture, waits until its last packet has been sent, returns the counters.
    pub fn capture_stop(&self) -> Result<CaptureStopReply, String> {
        let shared = self.shared()?;
        {
            let mut c = lock(&shared.capture);
            if !matches!(c.mode, Mode::Webview(_)) {
                return Err("audio_capture_stop: no capture is running".into());
            }
            c.stopped = None;
            c.reader.stop().map_err(|e| format!("audio_capture_stop: {e}"))?;
        }
        let ok = wait_until(CAPTURE_STOP_WAIT, || lock(&shared.capture).stopped.is_some());
        let mut c = lock(&shared.capture);
        match c.stopped.take() {
            Some(s) if ok => Ok(CaptureStopReply { packets: s.packets, frames: s.frames, dropped_frames: s.dropped_frames, max_ring_ms: s.max_ring_ms }),
            _ => {
                c.mode = Mode::Idle;
                Err("audio_capture_stop: the capture did not stop within 3 s".into())
            }
        }
    }

    /// `audio_measure_loopback`: plays clicks and looks for them in the capture (about 2 s).
    pub fn measure_loopback(&self, clicks: u32, timbre: &str) -> Result<LoopbackEstimateJson, String> {
        if timbre != "tick" {
            return Err(format!("audio_measure_loopback: unknown timbre {timbre:?} (only \"tick\")"));
        }
        if !(1..=32).contains(&clicks) {
            return Err("audio_measure_loopback: clicks must be 1 to 32".into());
        }
        let (shared, config) = self.session(|s| {
            if !s.input_open() {
                return Err("audio_measure_loopback: no input is open".into());
            }
            s.device.capture_requested();
            let config = LoopbackConfig { clicks, relation: s.info.clock_relation, predicted_ms: s.info.latency.predicted_round_trip_ms(), ..LoopbackConfig::default() };
            Ok((Arc::clone(&s.shared), config))
        })?;
        {
            let mut h = lock(&shared.handle);
            let mut c = lock(&shared.capture);
            match c.mode {
                Mode::Idle => {}
                Mode::Webview(_) => return Err("audio_measure_loopback: a capture is running; stop it first".into()),
                Mode::Loopback(_) => return Err("audio_measure_loopback: a measurement is already running".into()),
            }
            c.loopback = None;
            let driver = LoopbackDriver::start(&mut h, &mut c.reader, config).map_err(|e| format!("audio_measure_loopback: {e}"))?;
            c.mode = Mode::Loopback(Box::new(driver));
        }
        let wait = Duration::from_secs_f64(config.timeout_sec + 3.0);
        let ok = wait_until(wait, || lock(&shared.capture).loopback.is_some());
        let mut c = lock(&shared.capture);
        match c.loopback.take() {
            Some(Ok(e)) if ok => Ok(e.into()),
            Some(Err(e)) => Err(format!("audio_measure_loopback: {e}")),
            _ => {
                c.mode = Mode::Idle;
                Err("audio_measure_loopback: no result".into())
            }
        }
    }
}

fn open_info_json(info: &OpenInfo, clock: ClockAnchorJson) -> OpenInfoJson {
    OpenInfoJson {
        engine_rate: info.engine_rate,
        out_frames: info.out_frames,
        in_frames: info.in_frames,
        input_rate: info.input_rate,
        route: RouteJson::from(&info.route),
        latency: info.latency.into(),
        clock,
        session_type: info.session_type.clone(),
    }
}

/// One poll tick: engine notifications, device events, capture events and packets. Packets are sent after the
/// locks are released.
fn tick(shared: &Shared, device_events: &Receiver<DeviceEvent>, sink: &EventSink, notes: &mut Vec<Notification>) {
    notes.clear();
    let dev: Vec<DeviceEvent> = device_events.try_iter().collect();
    let mut extra = Vec::new();
    let mut packets: Vec<Vec<u8>> = Vec::new();
    let mut packet_sink: Option<PacketSink> = None;
    let mut stop_pending = None;
    {
        let mut h = lock(&shared.handle);
        h.poll(notes);
        for d in &dev {
            if matches!(d, DeviceEvent::Interruption { stream: StreamKind::Output, reason: InterruptionReason::DeviceChange }) {
                let _ = h.output_restarted();
            }
        }
        let mut guard = lock(&shared.capture);
        let CaptureCtl { reader, mode, started, loopback, .. } = &mut *guard;
        match mode {
            Mode::Idle => {
                // Nobody wants what a stray capture produces: keep the ring from filling.
                while reader.poll_event().is_some() {}
                let mut buf = Vec::new();
                while reader.read_packet(&mut buf) {}
            }
            Mode::Webview(s) => {
                while let Some(ev) = reader.poll_event() {
                    match ev {
                        CaptureEvent::Started { origin_frame, engine_rate, path } => *started = Some((origin_frame, engine_rate, path)),
                        CaptureEvent::Stopped(stats) => stop_pending = Some(stats),
                        CaptureEvent::ClockStep { stream } => {
                            let stream = if stream == CaptureStreamKind::Input { StreamName::Input } else { StreamName::Output };
                            extra.push(AudioEvent::Xrun { stream, count: 1 });
                        }
                        CaptureEvent::StartIgnored => {}
                    }
                }
                // Events first: `Stopped` is produced after the last packet, so reading the packets afterwards
                // takes every one of them.
                loop {
                    let mut buf = Vec::new();
                    if !reader.read_packet(&mut buf) {
                        break;
                    }
                    packets.push(buf);
                }
                packet_sink = Some(Arc::clone(s));
            }
            Mode::Loopback(driver) => match driver.poll(&mut h, reader) {
                LoopbackStatus::Running => {}
                LoopbackStatus::Done(e) => {
                    *loopback = Some(Ok(e));
                    *mode = Mode::Idle;
                }
                LoopbackStatus::Failed(e) => {
                    *loopback = Some(Err(e));
                    *mode = Mode::Idle;
                }
            },
        }
    }
    if let Some(s) = packet_sink {
        for p in packets {
            s(p);
        }
    }
    if let Some(stats) = stop_pending {
        let mut c = lock(&shared.capture);
        c.stopped = Some(stats);
        c.mode = Mode::Idle;
    }
    let mut events = events_from(notes, &dev, &mut lock(&shared.late_seen));
    events.extend(extra);
    for e in events {
        sink(e);
    }
}

/// Runs `EngineHandle::poll` and the capture pump every 5 ms and turns what they find into events.
fn poll_loop(shared: Arc<Shared>, device_events: Receiver<DeviceEvent>, sink: EventSink, stop: Arc<AtomicBool>) {
    let mut notes = Vec::with_capacity(256);
    let mut next = Instant::now() + POLL_PERIOD;
    while !stop.load(Ordering::Relaxed) {
        let now = Instant::now();
        if next > now {
            std::thread::sleep(next - now);
        }
        next += POLL_PERIOD;
        if next < Instant::now() {
            next = Instant::now() + POLL_PERIOD; // do not try to catch up after a stall
        }
        tick(&shared, &device_events, &sink, &mut notes);
    }
}

/// One tick's notifications and device events, as events in a fixed order: interruptions first, then voices
/// (`late`, `rejected`, `ended`), then xruns, then the latest clock anchor. A `Late` notification for an id that the
/// `audio_schedule` reply already listed is dropped (and forgotten); an `Ended` forgets its id.
pub fn events_from(notes: &[Notification], device_events: &[DeviceEvent], late_seen: &mut HashSet<u32>) -> Vec<AudioEvent> {
    let mut out = Vec::new();
    let (mut ended, mut late, mut rejected, mut clock) = (Vec::new(), Vec::new(), Vec::new(), None);
    for n in notes {
        match *n {
            Notification::Ended { id } => {
                late_seen.remove(&id);
                ended.push(id);
            }
            // A rejected voice makes no sound and gets no `Ended`: it is its own event (the TypeScript side ends it).
            Notification::Rejected { id, .. } => {
                late_seen.remove(&id);
                rejected.push(id);
            }
            Notification::Late { id, .. } => {
                if !late_seen.remove(&id) {
                    late.push(id);
                }
            }
            Notification::Clock(a) => clock = Some(a),
            Notification::Clipped { .. } => {}
        }
    }
    let (mut xrun_out, mut xrun_in) = (0u32, 0u32);
    for ev in device_events {
        match *ev {
            DeviceEvent::Interruption { reason, .. } => out.push(AudioEvent::Interruption { reason: reason.into() }),
            DeviceEvent::Xrun(StreamKind::Output) => xrun_out += 1,
            DeviceEvent::Xrun(StreamKind::Input) => xrun_in += 1,
        }
    }
    if !late.is_empty() {
        out.push(AudioEvent::Late { ids: late });
    }
    if !rejected.is_empty() {
        out.push(AudioEvent::Rejected { ids: rejected });
    }
    if !ended.is_empty() {
        out.push(AudioEvent::Ended { ids: ended });
    }
    if xrun_out > 0 {
        out.push(AudioEvent::Xrun { stream: StreamName::Output, count: xrun_out });
    }
    if xrun_in > 0 {
        out.push(AudioEvent::Xrun { stream: StreamName::Input, count: xrun_in });
    }
    if let Some(a) = clock {
        out.push(AudioEvent::Clock { anchor: a.into() });
    }
    out
}

fn fake_device(host: &AudioHost) -> Result<Box<dyn DeviceIo>, String> {
    Ok(Box::new(FakeIo::new(FakeConfig { signal_control: host.inner.signal.clone(), ..FakeConfig::from_env()? })))
}

/// Which device to open: `SR_AUDIO_DEVICE=fake` forces the fake; otherwise cpal, and when cpal cannot open and
/// `SR_AUDIO_ALLOW_FAKE=1`, the fake. Otherwise the error says what happened.
pub fn open_selected(host: &AudioHost, cfg: OpenConfig, sink: EventSink) -> Result<OpenInfoJson, String> {
    let env = |k: &str| std::env::var(k).ok();
    if env("SR_AUDIO_DEVICE").as_deref() == Some("fake") {
        return host.open_with(fake_device(host)?, cfg, sink).map_err(|e| e.to_string());
    }
    match host.open_with(Box::new(CpalIo::new()), cfg.clone(), Arc::clone(&sink)) {
        Ok(info) => Ok(info),
        Err(e @ DeviceError::PermissionDenied) => Err(e.to_string()),
        Err(e) if env("SR_AUDIO_ALLOW_FAKE").as_deref() == Some("1") => {
            eprintln!("audio: {e}; SR_AUDIO_ALLOW_FAKE=1, using the fake device");
            host.open_with(fake_device(host)?, cfg, sink).map_err(|e| e.to_string())
        }
        Err(e) => Err(format!("{e} (set SR_AUDIO_ALLOW_FAKE=1 to run on a silent fake device, or SR_AUDIO_DEVICE=fake to force it)")),
    }
}

/// Whether the end-to-end test hooks are on: only on the fake device and only with `SR_E2E_HOOKS=1`. A release build
/// without both variables answers no to every hook command.
pub fn debug_hooks_enabled() -> bool {
    std::env::var("SR_AUDIO_DEVICE").as_deref() == Ok("fake") && std::env::var("SR_E2E_HOOKS").as_deref() == Ok("1")
}

/// Reply of `audio_debug_hooks`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct DebugHooks {
    /// The hook commands work and the page may expose its test handles.
    pub enabled: bool,
    /// `SR_E2E_SEED` (a 32-bit integer): the seed of the session's excerpt choice; `null` when unset or the hooks are off.
    pub seed: Option<u32>,
}

/// `audio_debug_hooks` without a host: the state of the environment.
pub fn debug_hooks() -> DebugHooks {
    let enabled = debug_hooks_enabled();
    DebugHooks { enabled, seed: if enabled { std::env::var("SR_E2E_SEED").ok().and_then(|v| v.trim().parse().ok()) } else { None } }
}

impl AudioHost {
    /// `audio_debug_signal`: the fake device's input carries the raw little-endian mono `f32` file at `path` (at the
    /// input rate) with sample 0 at engine second `engine_sec`; `None` removes it. Refused unless the hooks are on.
    pub fn debug_signal(&self, path: Option<&str>, engine_sec: f64) -> Result<(), String> {
        if !debug_hooks_enabled() {
            return Err("audio_debug_signal: the test hooks are off (they need SR_AUDIO_DEVICE=fake and SR_E2E_HOOKS=1)".into());
        }
        match path {
            None => self.inner.signal.clear(),
            Some(p) => {
                if !engine_sec.is_finite() {
                    return Err("audio_debug_signal: engineSec must be a finite number".into());
                }
                let bytes = std::fs::read(p).map_err(|e| format!("audio_debug_signal: {p}: {e}"))?;
                if bytes.len() % 4 != 0 {
                    return Err(format!("audio_debug_signal: {p}: length is not a multiple of 4 bytes"));
                }
                let data: Arc<[f32]> = bytes.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
                self.inner.signal.set(data, engine_sec);
            }
        }
        Ok(())
    }
}

/// `audio_permission` without a request: the microphone permission as the platform reports it, never prompting.
/// macOS: the capture authorization status (`granted`, `denied`, `prompt`). Linux and Windows: `granted` when an
/// input device can be enumerated, else `unknown`. The fake device is always `granted`.
pub fn permission_state() -> &'static str {
    if std::env::var("SR_AUDIO_DEVICE").as_deref() == Ok("fake") {
        return "granted";
    }
    sr_audio_device::permission::microphone_state().as_str()
}

/// `audio_permission` with `request: true`: where the state is still `prompt` (macOS), asks the system to show
/// its prompt and waits for the answer, up to two minutes; elsewhere the same as [`permission_state`]. It blocks
/// the calling thread, so the command runs it on a worker thread, never on the main thread (the system delivers
/// the answer on a queue of its own).
pub fn permission_request() -> &'static str {
    if std::env::var("SR_AUDIO_DEVICE").as_deref() == Ok("fake") {
        return "granted";
    }
    let (tx, rx) = std::sync::mpsc::channel();
    sr_audio_device::permission::request_microphone(move |p| {
        let _ = tx.send(p);
    });
    match rx.recv_timeout(std::time::Duration::from_secs(120)) {
        Ok(p) => p.as_str(),
        Err(_) => permission_state(),
    }
}

/// First half of `audio_decode`: request bytes to the id, the decoded buffer and the reply bytes. No host access,
/// so it can run on a blocking thread.
pub fn decode_request(body: &[u8]) -> Result<(u32, AudioBuffer, Vec<u8>), String> {
    let (id, mp3) = wire::split_decode_request(body).map_err(|e| format!("audio_decode: {e}"))?;
    let buffer = decode_mp3_mono(mp3).map_err(|e| format!("audio_decode: {e}"))?;
    let reply = wire::encode_decode_reply(buffer.sample_rate, &buffer.samples);
    Ok((id, buffer, reply))
}

fn raw_body<'a>(request: &'a Request<'_>, what: &str) -> Result<&'a [u8], String> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes),
        InvokeBody::Json(_) => Err(format!("{what}: expected a raw (binary) request body")),
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------------------------

/// Names of the commands of this module, for the build script's ACL manifest and the capability file.
pub const COMMANDS: &[&str] = &[
    "audio_open",
    "audio_close",
    "audio_release_input",
    "audio_set_input",
    "audio_permission",
    "audio_clock_sync",
    "audio_clock_check",
    "audio_put_buffer",
    "audio_decode",
    "audio_drop_buffers",
    "audio_schedule",
    "audio_stop_voices",
    "audio_cancel",
    "audio_capture_start",
    "audio_capture_stop",
    "audio_measure_loopback",
    "audio_debug_hooks",
    "audio_debug_signal",
];

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| format!("audio: worker thread failed: {e}"))?
}

/// `audio_open({ input, outputMode, events })`.
#[tauri::command]
pub async fn audio_open(host: State<'_, AudioHost>, input: bool, output_mode: OutputMode, events: Channel<AudioEvent>) -> Result<OpenInfoJson, String> {
    let _ = output_mode; // validated by the type; routing by mode comes with the platform latency modules
    let sink: EventSink = Arc::new(move |e| {
        let _ = events.send(e);
    });
    let host = (*host).clone();
    blocking(move || open_selected(&host, OpenConfig { input, ..OpenConfig::default() }, sink)).await
}

/// `audio_close()`.
#[tauri::command]
pub async fn audio_close(host: State<'_, AudioHost>) -> Result<(), String> {
    let host = (*host).clone();
    blocking(move || {
        host.close();
        Ok(())
    })
    .await
}

/// `audio_release_input()`: closes the input stream; the output keeps playing.
#[tauri::command]
pub async fn audio_release_input(host: State<'_, AudioHost>) -> Result<(), String> {
    let host = (*host).clone();
    blocking(move || host.set_input(false).map(|_| ())).await
}

/// `audio_set_input({ enabled }) -> OpenInfo` (an addition): closes or reopens the input stream.
#[tauri::command]
pub async fn audio_set_input(host: State<'_, AudioHost>, enabled: bool) -> Result<OpenInfoJson, String> {
    let host = (*host).clone();
    blocking(move || host.set_input(enabled)).await
}

/// `audio_permission({ request })`.
#[tauri::command]
pub async fn audio_permission(request: bool) -> Result<&'static str, String> {
    blocking(move || Ok(if request { permission_request() } else { permission_state() })).await
}

/// `audio_clock_sync()`.
#[tauri::command]
pub async fn audio_clock_sync(host: State<'_, AudioHost>) -> Result<ClockSync, String> {
    host.clock_sync()
}

/// `audio_clock_check({ durSec })`.
#[tauri::command]
pub async fn audio_clock_check(host: State<'_, AudioHost>, dur_sec: f64) -> Result<ClockCheck, String> {
    host.clock_check(dur_sec)
}

/// `audio_put_buffer(raw)`.
#[tauri::command]
pub async fn audio_put_buffer(host: State<'_, AudioHost>, request: Request<'_>) -> Result<(), String> {
    host.put_buffer(raw_body(&request, "audio_put_buffer")?)
}

/// `audio_decode(raw) -> raw`: request `u32 bufferId` + MP3 bytes, reply `u32 sampleRate, u32 nFrames, f32...`.
#[tauri::command]
pub async fn audio_decode(host: State<'_, AudioHost>, request: Request<'_>) -> Result<Response, String> {
    let body = raw_body(&request, "audio_decode")?.to_vec();
    let (id, buffer, reply) = blocking(move || decode_request(&body)).await?;
    host.store_decoded(id, buffer)?;
    Ok(Response::new(reply))
}

/// `audio_drop_buffers({ ids })`.
#[tauri::command]
pub async fn audio_drop_buffers(host: State<'_, AudioHost>, ids: Vec<u32>) -> Result<(), String> {
    host.drop_buffers(&ids)
}

/// `audio_schedule({ group, voices })`.
#[tauri::command]
pub async fn audio_schedule(host: State<'_, AudioHost>, group: GroupName, voices: Vec<VoiceSpecJson>) -> Result<ScheduleReply, String> {
    host.schedule(group, &voices)
}

/// `audio_stop_voices({ ids, fadeSec })`.
#[tauri::command]
pub async fn audio_stop_voices(host: State<'_, AudioHost>, ids: Vec<u32>, fade_sec: f64) -> Result<(), String> {
    host.stop_voices(&ids, fade_sec)
}

/// `audio_cancel({ group, fadeSec })`.
#[tauri::command]
pub async fn audio_cancel(host: State<'_, AudioHost>, group: GroupName, fade_sec: f64) -> Result<(), String> {
    host.cancel(group, fade_sec)
}

/// `audio_capture_start({ packets, packetFrames })`: `packets` is a raw channel, one `ArrayBuffer` per packet.
#[tauri::command]
pub async fn audio_capture_start(host: State<'_, AudioHost>, packets: Channel<InvokeResponseBody>, packet_frames: u32) -> Result<CaptureStartReply, String> {
    let sink: PacketSink = Arc::new(move |bytes| {
        let _ = packets.send(InvokeResponseBody::Raw(bytes));
    });
    let host = (*host).clone();
    blocking(move || host.capture_start(packet_frames, sink)).await
}

/// `audio_capture_stop()`.
#[tauri::command]
pub async fn audio_capture_stop(host: State<'_, AudioHost>) -> Result<CaptureStopReply, String> {
    let host = (*host).clone();
    blocking(move || host.capture_stop()).await
}

/// `audio_measure_loopback({ clicks, timbre })`.
#[tauri::command]
pub async fn audio_measure_loopback(host: State<'_, AudioHost>, clicks: u32, timbre: String) -> Result<LoopbackEstimateJson, String> {
    let host = (*host).clone();
    blocking(move || host.measure_loopback(clicks, &timbre)).await
}

/// `audio_debug_hooks()`: whether the test hooks are on (`SR_AUDIO_DEVICE=fake` and `SR_E2E_HOOKS=1`) and the excerpt seed.
#[tauri::command]
pub async fn audio_debug_hooks() -> Result<DebugHooks, String> {
    Ok(debug_hooks())
}

/// `audio_debug_signal({ path, engineSec })`: test hook, see [`AudioHost::debug_signal`].
#[tauri::command]
pub async fn audio_debug_signal(host: State<'_, AudioHost>, path: Option<String>, engine_sec: f64) -> Result<(), String> {
    let host = (*host).clone();
    blocking(move || host.debug_signal(path.as_deref(), engine_sec)).await
}

#[cfg(test)]
mod tests;
