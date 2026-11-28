//! The app side of the native audio layer (design section 3, output half): the `AudioHost` state, the poll
//! thread that forwards engine notifications as JSON events, and the Tauri commands.
//!
//! Capture is not here yet: `audio_open` accepts `input` and reports the input as absent.
//!
//! Locking: the `EngineHandle` sits behind one mutex that the poll thread takes for a few microseconds every
//! 10 ms and the commands take for one call. Decoding and wire parsing happen before the lock is taken.
//! `audio_clock_sync` does not take it at all (it reads the lock-free `ClockReader`).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use sr_audio_core::clock::ClockAnchor;
use sr_audio_core::decode::decode_mp3_mono;
use sr_audio_core::latency::{LatencyParts, LatencyReport, Transport};
use sr_audio_core::mixer::{AudioBuffer, Group, VoiceSpec as CoreVoiceSpec};
use sr_audio_core::wire;
use sr_audio_core::{engine, ClockReader, EngineConfig, EngineHandle, Notification};
use sr_audio_device::cpal_io::CpalIo;
use sr_audio_device::fake_io::{FakeConfig, FakeIo};
use sr_audio_device::{host_clock, DeviceError, DeviceEvent, DeviceIo, EngineFactory, InterruptionReason, OpenConfig, OpenInfo, RouteFacts, StreamKind};
use tauri::ipc::{Channel, InvokeBody, Request, Response};
use tauri::State;

/// How often the poll thread runs `EngineHandle::poll`.
const POLL_PERIOD: Duration = Duration::from_millis(10);
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

/// `AudioEvent` of the design. `Late` is an addition (see the report): later `Late` notifications of the engine.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
    /// Voices that will make no more sound (ran out, stopped, cancelled, or were rejected by a capacity).
    Ended {
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
// Host state
// ---------------------------------------------------------------------------------------------------------------

/// Where events go: a Tauri channel in production, a collector in tests.
pub type EventSink = Arc<dyn Fn(AudioEvent) + Send + Sync>;

struct Session {
    device: Box<dyn DeviceIo>,
    handle: Arc<Mutex<EngineHandle>>,
    clock: ClockReader,
    stop: Arc<AtomicBool>,
    poller: Option<JoinHandle<()>>,
}

impl Session {
    fn shutdown(mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(p) = self.poller.take() {
            let _ = p.join();
        }
        self.device.close();
    }
}

/// Tauri state: at most one open session.
#[derive(Default)]
pub struct AudioHost {
    session: Mutex<Option<Session>>,
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

impl AudioHost {
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
        let handle = lock(&slot).take().ok_or_else(|| DeviceError::Backend("the device did not build the engine".into()))?;
        let clock = handle.clock();
        let handle = Arc::new(Mutex::new(handle));

        let deadline = Instant::now() + FIRST_ANCHOR_WAIT;
        while clock.anchor().is_none() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(5));
        }

        let stop = Arc::new(AtomicBool::new(false));
        let poller = {
            let (handle, stop) = (Arc::clone(&handle), Arc::clone(&stop));
            std::thread::Builder::new()
                .name("sr-audio-poll".into())
                .spawn(move || poll_loop(handle, events_rx, sink, stop))
                .map_err(|e| DeviceError::Backend(e.to_string()))?
        };
        let json = open_info_json(&info, anchor_now(&clock));
        *lock(&self.session) = Some(Session { device, handle, clock, stop, poller: Some(poller) });
        Ok(json)
    }

    /// Stops the poll thread and the device. Idempotent.
    pub fn close(&self) {
        let session = lock(&self.session).take();
        if let Some(s) = session {
            s.shutdown();
        }
    }

    fn handle(&self) -> Result<Arc<Mutex<EngineHandle>>, String> {
        lock(&self.session).as_ref().map(|s| Arc::clone(&s.handle)).ok_or_else(not_open)
    }

    /// `audio_clock_sync`.
    pub fn clock_sync(&self) -> Result<ClockSync, String> {
        let clock = lock(&self.session).as_ref().map(|s| s.clock.clone()).ok_or_else(not_open)?;
        let a = anchor_now(&clock);
        Ok(ClockSync { engine_sec: a.engine_sec, host_ms: a.host_ms })
    }

    /// `audio_clock_check`.
    pub fn clock_check(&self, dur_sec: f64) -> Result<ClockCheck, String> {
        let handle = self.handle()?;
        let r = lock(&handle).rate_check(dur_sec);
        Ok(ClockCheck {
            error: r.error.filter(|e| e.is_finite()),
            consistent: r.consistent,
            frames_per_sec: Some(r.frames_per_sec).filter(|f| f.is_finite()),
            expected: r.expected,
            input_drift_ppm: None,
        })
    }

    /// `audio_put_buffer`: the raw body.
    pub fn put_buffer(&self, body: &[u8]) -> Result<(), String> {
        let pb = wire::decode_put_buffer(body).map_err(|e| format!("audio_put_buffer: {e}"))?;
        let handle = self.handle()?;
        lock(&handle).put_buffer(pb.buffer_id, AudioBuffer::new(pb.samples, pb.sample_rate));
        Ok(())
    }

    /// Second half of `audio_decode`: stores the decoded buffer.
    fn store_decoded(&self, id: u32, buffer: AudioBuffer) -> Result<(), String> {
        let handle = self.handle()?;
        lock(&handle).put_buffer(id, buffer);
        Ok(())
    }

    /// `audio_drop_buffers`.
    pub fn drop_buffers(&self, ids: &[u32]) -> Result<(), String> {
        let handle = self.handle()?;
        lock(&handle).drop_buffers(ids);
        Ok(())
    }

    /// `audio_schedule`.
    pub fn schedule(&self, group: GroupName, voices: &[VoiceSpecJson]) -> Result<ScheduleReply, String> {
        let handle = self.handle()?;
        let specs: Vec<CoreVoiceSpec> = voices.iter().map(CoreVoiceSpec::from).collect();
        let out = lock(&handle).schedule(group.into(), &specs).map_err(|e| format!("audio_schedule: {e}"))?;
        Ok(ScheduleReply { late: out.late })
    }

    /// `audio_stop_voices`.
    pub fn stop_voices(&self, ids: &[u32], fade_sec: f64) -> Result<(), String> {
        let handle = self.handle()?;
        let r = lock(&handle).stop_voices(ids, fade_sec);
        r.map_err(|e| format!("audio_stop_voices: {e}"))
    }

    /// `audio_cancel`.
    pub fn cancel(&self, group: GroupName, fade_sec: f64) -> Result<(), String> {
        let handle = self.handle()?;
        let r = lock(&handle).cancel(group.into(), fade_sec);
        r.map_err(|e| format!("audio_cancel: {e}"))
    }
}

impl Drop for AudioHost {
    fn drop(&mut self) {
        self.close();
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

/// Runs `EngineHandle::poll` every 10 ms and turns what it finds into events.
fn poll_loop(handle: Arc<Mutex<EngineHandle>>, device_events: Receiver<DeviceEvent>, sink: EventSink, stop: Arc<AtomicBool>) {
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
        notes.clear();
        lock(&handle).poll(&mut notes);
        for e in events_from(&notes, &device_events) {
            sink(e);
        }
    }
}

/// One tick's notifications and device events, as events in a fixed order: interruptions first, then voices
/// (`late`, `ended`), then xruns, then the latest clock anchor.
pub fn events_from(notes: &[Notification], device_events: &Receiver<DeviceEvent>) -> Vec<AudioEvent> {
    let mut out = Vec::new();
    let (mut ended, mut late, mut clock) = (Vec::new(), Vec::new(), None);
    for n in notes {
        match *n {
            Notification::Ended { id } => ended.push(id),
            // A rejected voice makes no sound and gets no `Ended`; JS waits for `ended`, so it is reported as one.
            Notification::Rejected { id, .. } => ended.push(id),
            Notification::Late { id, .. } => late.push(id),
            Notification::Clock(a) => clock = Some(a),
            Notification::Clipped { .. } => {}
        }
    }
    let mut xruns = 0u32;
    while let Ok(ev) = device_events.try_recv() {
        match ev {
            DeviceEvent::Interruption(r) => out.push(AudioEvent::Interruption { reason: r.into() }),
            DeviceEvent::Xrun(StreamKind::Output) => xruns += 1,
            DeviceEvent::Xrun(StreamKind::Input) => {}
        }
    }
    if !late.is_empty() {
        out.push(AudioEvent::Late { ids: late });
    }
    if !ended.is_empty() {
        out.push(AudioEvent::Ended { ids: ended });
    }
    if xruns > 0 {
        out.push(AudioEvent::Xrun { stream: StreamName::Output, count: xruns });
    }
    if let Some(a) = clock {
        out.push(AudioEvent::Clock { anchor: a.into() });
    }
    out
}

/// Which device to open: `SR_AUDIO_DEVICE=fake` forces the fake; otherwise cpal, and when cpal cannot open and
/// `SR_AUDIO_ALLOW_FAKE=1`, the fake. Otherwise the error says what happened.
pub fn open_selected(host: &AudioHost, cfg: OpenConfig, sink: EventSink) -> Result<OpenInfoJson, String> {
    let env = |k: &str| std::env::var(k).ok();
    if env("SR_AUDIO_DEVICE").as_deref() == Some("fake") {
        return host.open_with(Box::new(FakeIo::new(FakeConfig::default())), cfg, sink).map_err(|e| e.to_string());
    }
    match host.open_with(Box::new(CpalIo::new()), cfg.clone(), Arc::clone(&sink)) {
        Ok(info) => Ok(info),
        Err(e) if env("SR_AUDIO_ALLOW_FAKE").as_deref() == Some("1") => {
            eprintln!("audio: {e}; SR_AUDIO_ALLOW_FAKE=1, using the fake device");
            host.open_with(Box::new(FakeIo::new(FakeConfig::default())), cfg, sink).map_err(|e| e.to_string())
        }
        Err(e) => Err(format!("{e} (set SR_AUDIO_ALLOW_FAKE=1 to run on a silent fake device, or SR_AUDIO_DEVICE=fake to force it)")),
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
    "audio_permission",
    "audio_clock_sync",
    "audio_clock_check",
    "audio_put_buffer",
    "audio_decode",
    "audio_drop_buffers",
    "audio_schedule",
    "audio_stop_voices",
    "audio_cancel",
];

/// `audio_open({ input, outputMode, events })`.
#[tauri::command]
pub async fn audio_open(
    host: State<'_, AudioHost>,
    input: bool,
    output_mode: OutputMode,
    events: Channel<AudioEvent>,
) -> Result<OpenInfoJson, String> {
    let _ = output_mode; // validated by the type; routing by mode comes with the platform latency modules
    if input {
        eprintln!("audio: input requested but capture is not implemented yet; reporting it as absent");
    }
    let sink: EventSink = Arc::new(move |e| {
        let _ = events.send(e);
    });
    let cfg = OpenConfig { input, ..OpenConfig::default() };
    // Opening a device can take a while (and `close` joins threads), so it stays off the main thread: this is an
    // async command, which Tauri runs on its own pool.
    open_selected(&host, cfg, sink)
}

/// `audio_close()`.
#[tauri::command]
pub async fn audio_close(host: State<'_, AudioHost>) -> Result<(), String> {
    host.close();
    Ok(())
}

/// `audio_permission({ request })`: always `'unknown'` until the desktop permission work lands.
#[tauri::command]
pub async fn audio_permission(request: bool) -> Result<&'static str, String> {
    let _ = request;
    Ok("unknown")
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
    let (id, buffer, reply) = tauri::async_runtime::spawn_blocking(move || decode_request(&body))
        .await
        .map_err(|e| format!("audio_decode: decoder thread failed: {e}"))??;
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

#[cfg(test)]
mod tests;
