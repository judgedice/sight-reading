//! [`DeviceIo`] on cpal: one output stream, f32 preferred at the engine rate.
//!
//! The stream is built, played and dropped on one dedicated owner thread (some backends want a stream to stay
//! on the thread that made it, and it keeps [`CpalIo`] `Send` whatever the platform's `Stream` is).
//!
//! The data callback does, in this order: read the host clock (first statement), render, convert. It never locks
//! or allocates: the engine is owned by the closure, the conversion scratch is allocated before the stream
//! starts, and only atomics are touched besides.
//!
//! Input is a second cpal stream on the default input device. Its callback does the same (clock read first,
//! conversion into preallocated scratch, then `CaptureHalf::capture`). The capture half belongs to the engine
//! and can be taken once, so it is handed back when the input stream is dropped and used again by a later
//! `set_input(true)`.

use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{BufferSize, ErrorKind, InterfaceType, Sample, SampleFormat, SizedSample, StreamConfig, SupportedBufferSize};
use sr_audio_core::latency::{LatencyParts, LatencyReport, Platform, Transport};
use sr_audio_core::capture::ClockRelation;
use sr_audio_core::{CaptureHalf, Engine};

use crate::{
    current_platform, host_clock, stamps, DeviceError, DeviceEvent, DeviceIo, EngineFactory, InterruptionReason, OpenConfig, OpenInfo, RouteFacts,
    StreamKind,
};

/// Samples of conversion scratch (per callback; larger callbacks are rendered in several pieces).
const SCRATCH_SAMPLES: usize = 32 * 1024;
/// How long `open` waits for the first callback to learn the buffer size when the backend does not say.
const FIRST_CALLBACK_WAIT: Duration = Duration::from_millis(250);

/// A stream configuration a device offers: a rate range at a channel count and format.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Offer {
    /// Channel count.
    pub channels: u16,
    /// Lowest rate, Hz.
    pub min_rate: u32,
    /// Highest rate, Hz.
    pub max_rate: u32,
    /// Sample format.
    pub format: SampleFormat,
    /// Fixed buffer sizes the backend accepts, frames; `None` when it does not say.
    pub buffer: Option<(u32, u32)>,
}

/// The stream configuration picked by [`choose_config`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Choice {
    /// Channel count.
    pub channels: u16,
    /// Rate, Hz.
    pub rate: u32,
    /// Sample format.
    pub format: SampleFormat,
    /// Fixed buffer sizes the backend accepts, frames.
    pub buffer: Option<(u32, u32)>,
}

/// Formats the callback converts from f32.
pub fn convertible(format: SampleFormat) -> bool {
    matches!(format, SampleFormat::F32 | SampleFormat::I16 | SampleFormat::U16 | SampleFormat::I32 | SampleFormat::F64)
}

/// True when the default host lists at least one input device (what `audio_permission` can say on Linux and
/// Windows, where the OS does not gate the microphone for desktop programs in a way cpal can read).
pub fn input_device_available() -> bool {
    let host = cpal::default_host();
    host.default_input_device().is_some() || host.input_devices().map(|mut d| d.next().is_some()).unwrap_or(false)
}

/// Which channel count to prefer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChannelPref {
    /// Stereo, then mono (output).
    Stereo,
    /// Mono, then stereo (input).
    Mono,
}

fn rank(offer: &Offer, pref: ChannelPref) -> (u8, u8) {
    let layout = match (offer.channels, pref) {
        (2, ChannelPref::Stereo) | (1, ChannelPref::Mono) => 0,
        (1, ChannelPref::Stereo) | (2, ChannelPref::Mono) => 1,
        _ => 2,
    };
    (u8::from(offer.format != SampleFormat::F32), layout)
}

/// Picks the stream configuration: `preferred_rate` in f32 (then another convertible format), stereo before
/// mono before more channels; when no offer covers the rate, the device's default configuration; when that
/// cannot be converted either, the best convertible offer at the rate nearest to the preferred one.
pub fn choose_config(offers: &[Offer], default: Option<Choice>, preferred_rate: u32, pref: ChannelPref) -> Option<Choice> {
    let at_rate = offers.iter().filter(|o| convertible(o.format) && o.min_rate <= preferred_rate && preferred_rate <= o.max_rate).min_by_key(|o| rank(o, pref));
    if let Some(o) = at_rate {
        return Some(Choice { channels: o.channels, rate: preferred_rate, format: o.format, buffer: o.buffer });
    }
    if let Some(d) = default.filter(|d| convertible(d.format)) {
        return Some(d);
    }
    let any = offers.iter().filter(|o| convertible(o.format)).min_by_key(|o| rank(o, pref))?;
    Some(Choice { channels: any.channels, rate: preferred_rate.clamp(any.min_rate, any.max_rate), format: any.format, buffer: any.buffer })
}

/// The buffer size to request: the caller's, else the platform's default of design section 1.
pub fn requested_buffer(cfg: &OpenConfig) -> Option<u32> {
    cfg.buffer_frames.or(if cfg!(any(target_os = "macos", target_os = "ios")) {
        Some(128)
    } else if cfg!(any(target_os = "android", target_os = "linux")) {
        Some(256)
    } else {
        None // WASAPI: the device period
    })
}

/// Transport from cpal's interface type (never guessed from names).
pub fn transport_of(interface: InterfaceType) -> Transport {
    match interface {
        InterfaceType::BuiltIn | InterfaceType::Pci => Transport::BuiltIn,
        InterfaceType::Usb | InterfaceType::Thunderbolt | InterfaceType::FireWire => Transport::Usb,
        InterfaceType::Bluetooth => Transport::Bluetooth,
        InterfaceType::Hdmi | InterfaceType::DisplayPort => Transport::Hdmi,
        InterfaceType::Line | InterfaceType::Spdif => Transport::Wired,
        InterfaceType::Network => Transport::Network,
        _ => Transport::Unknown,
    }
}

/// The error callbacks send through a std channel, which allocates a node per message. They run on a backend
/// thread that is not the data callback on every backend cpal has, and only when something has already gone
/// wrong, so this is left as it is.
///
/// What the error callback of `stream` tells the owner. An input device that disappears ends its track
/// (`track-ended`, as a removed microphone does on the web); a route change is `device-change`.
fn event_for(kind: ErrorKind, stream: StreamKind) -> Option<DeviceEvent> {
    let interruption = |reason| Some(DeviceEvent::Interruption { stream, reason });
    match kind {
        ErrorKind::Xrun => Some(DeviceEvent::Xrun(stream)),
        ErrorKind::RealtimeDenied => None,
        ErrorKind::DeviceNotAvailable if stream == StreamKind::Input => interruption(InterruptionReason::TrackEnded),
        ErrorKind::DeviceChanged | ErrorKind::DeviceNotAvailable | ErrorKind::StreamInvalidated => interruption(InterruptionReason::DeviceChange),
        _ => interruption(InterruptionReason::Interrupted),
    }
}

/// Gives a value back when the closure that owns it is dropped, so a failed build can be retried and a released
/// input stream returns the capture half.
struct Recover<T> {
    value: Option<T>,
    back: Sender<T>,
}

impl<T> Drop for Recover<T> {
    fn drop(&mut self) {
        if let Some(v) = self.value.take() {
            let _ = self.back.send(v);
        }
    }
}

/// The cpal device: an output stream and, on request, an input stream.
pub struct CpalIo {
    owner: Option<Owner>,
    info: Option<OpenInfo>,
}

struct Owner {
    commands: Sender<Cmd>,
    join: JoinHandle<()>,
}

enum Cmd {
    SetInput(bool, Sender<Result<OpenInfo, DeviceError>>),
    Refresh(Sender<OpenInfo>),
    Close,
}

impl Default for CpalIo {
    fn default() -> Self {
        Self::new()
    }
}

impl CpalIo {
    /// A closed device.
    pub fn new() -> Self {
        CpalIo { owner: None, info: None }
    }
}

fn unopened_route() -> RouteFacts {
    RouteFacts {
        output_uid: String::new(),
        input_uid: None,
        output_transport: Transport::Unknown,
        input_transport: None,
        platform: current_platform(),
        direct_hardware: false,
        low_latency_feature: false,
    }
}

impl Drop for CpalIo {
    fn drop(&mut self) {
        self.close();
    }
}

impl DeviceIo for CpalIo {
    fn open(&mut self, cfg: OpenConfig, make_engine: EngineFactory, events: Sender<DeviceEvent>) -> Result<OpenInfo, DeviceError> {
        if self.owner.is_some() {
            return Err(DeviceError::AlreadyOpen);
        }
        host_clock::init();
        stamps::init();
        stamps::OUTPUT.reset();
        stamps::INPUT.reset();
        let (ready_tx, ready_rx) = mpsc::channel::<Result<OpenInfo, DeviceError>>();
        let (cmd_tx, cmd_rx) = mpsc::channel::<Cmd>();
        let join = std::thread::Builder::new()
            .name("sr-audio-stream".into())
            .spawn(move || match Streams::open(&cfg, make_engine, events) {
                Ok(mut streams) => {
                    let _ = ready_tx.send(Ok(streams.info()));
                    while let Ok(cmd) = cmd_rx.recv() {
                        match cmd {
                            Cmd::SetInput(on, reply) => {
                                let r = if on { streams.open_input() } else { streams.close_input() };
                                let _ = reply.send(r.map(|()| streams.info()));
                            }
                            Cmd::Refresh(reply) => {
                                streams.refresh();
                                let _ = reply.send(streams.info());
                            }
                            Cmd::Close => break,
                        }
                    }
                    // The streams drop here, on the thread that made them.
                    drop(streams);
                    stamps::log_summary();
                }
                Err(e) => {
                    let _ = ready_tx.send(Err(e));
                }
            })
            .map_err(|e| DeviceError::Backend(e.to_string()))?;
        match ready_rx.recv() {
            Ok(Ok(info)) => {
                self.info = Some(info.clone());
                self.owner = Some(Owner { commands: cmd_tx, join });
                Ok(info)
            }
            Ok(Err(e)) => {
                let _ = join.join();
                Err(e)
            }
            Err(_) => {
                let _ = join.join();
                Err(DeviceError::Backend("the audio thread ended during open".into()))
            }
        }
    }

    fn close(&mut self) {
        if let Some(owner) = self.owner.take() {
            let _ = owner.commands.send(Cmd::Close);
            let _ = owner.join.join();
        }
        self.info = None;
    }

    fn route(&self) -> RouteFacts {
        self.info.as_ref().map(|i| i.route.clone()).unwrap_or_else(unopened_route)
    }

    fn latency(&self) -> LatencyParts {
        self.info.as_ref().map(|i| i.latency.parts).unwrap_or_default()
    }

    fn refresh(&mut self) -> Option<OpenInfo> {
        let owner = self.owner.as_ref()?;
        let (tx, rx) = mpsc::channel();
        owner.commands.send(Cmd::Refresh(tx)).ok()?;
        let info = rx.recv().ok()?;
        self.info = Some(info.clone());
        Some(info)
    }

    fn set_input(&mut self, enabled: bool) -> Result<OpenInfo, DeviceError> {
        let owner = self.owner.as_ref().ok_or_else(|| DeviceError::Backend("the device is not open".into()))?;
        let (tx, rx) = mpsc::channel();
        owner.commands.send(Cmd::SetInput(enabled, tx)).map_err(|_| DeviceError::Backend("the audio thread is gone".into()))?;
        let info = rx.recv().map_err(|_| DeviceError::Backend("the audio thread is gone".into()))??;
        self.info = Some(info.clone());
        Ok(info)
    }
}

fn backend(e: cpal::Error) -> DeviceError {
    match e.kind() {
        ErrorKind::DeviceNotAvailable | ErrorKind::HostUnavailable => DeviceError::NoOutputDevice,
        ErrorKind::PermissionDenied => DeviceError::PermissionDenied,
        _ => DeviceError::Backend(e.to_string()),
    }
}

fn pick_device(host: &cpal::Host, wanted: Option<&str>) -> Result<cpal::Device, DeviceError> {
    match wanted {
        None => host.default_output_device().ok_or(DeviceError::NoOutputDevice),
        Some(name) => {
            let devices = host.output_devices().map_err(backend)?;
            for d in devices {
                let by_id = d.id().map(|i| i.to_string() == name).unwrap_or(false);
                let by_name = d.description().map(|x| x.name() == name).unwrap_or(false);
                if by_id || by_name {
                    return Ok(d);
                }
            }
            Err(DeviceError::DeviceNotFound(name.to_string()))
        }
    }
}

fn buffer_range(b: &SupportedBufferSize) -> Option<(u32, u32)> {
    match b {
        SupportedBufferSize::Range { min, max } => Some((*min, *max)),
        _ => None,
    }
}

/// The platform's own identifier out of cpal's device id: the CoreAudio device UID, the WASAPI endpoint id.
/// (cpal's `Display` of a device id is `<host>:<id>`, which is right for the route key and wrong for a
/// lookup in the platform's API.)
pub fn native_id(id: &cpal::DeviceId) -> String {
    id.id().to_string()
}

fn native_id_of(device: &cpal::Device) -> Option<String> {
    device.id().ok().map(|i| native_id(&i)).filter(|s| !s.is_empty())
}

fn uid_of(device: &cpal::Device) -> String {
    device.id().map(|i| i.to_string()).or_else(|_| device.description().map(|d| d.name().to_string())).unwrap_or_default()
}

fn transport_of_device(device: &cpal::Device) -> Transport {
    device.description().ok().map(|d| transport_of(d.interface_type())).unwrap_or(Transport::Unknown)
}

/// `Shared` only where the OS gives one clock per device (CoreAudio, WASAPI) and both streams are on the same
/// device; ALSA through a sound server and everything else is left to measurement (`Unknown`).
pub fn relation_of(out_uid: &str, in_uid: &str) -> ClockRelation {
    if cfg!(any(target_os = "macos", target_os = "ios", target_os = "windows")) && !out_uid.is_empty() && out_uid == in_uid {
        ClockRelation::Shared
    } else {
        ClockRelation::Unknown
    }
}

/// Buffer sizes to try: the request clamped to what the backend accepts, then the backend's default.
fn buffer_attempts(request: Option<u32>, range: Option<(u32, u32)>) -> Vec<BufferSize> {
    let mut v = Vec::new();
    if let Some(n) = request {
        v.push(BufferSize::Fixed(match range {
            Some((lo, hi)) => n.clamp(lo, hi),
            None => n,
        }));
    }
    v.push(BufferSize::Default);
    v
}

/// The buffer size of a running stream: from the backend, else the fixed size asked for, else what the first
/// callback delivered (waiting briefly for it); 0 when none of these is known.
fn settle_buffer_frames(stream: &cpal::Stream, used: BufferSize, first_frames: &AtomicU32) -> u32 {
    let mut frames = match used {
        BufferSize::Fixed(n) => n,
        BufferSize::Default => 0,
    };
    if let Ok(n) = stream.buffer_size() {
        frames = n;
    }
    if frames == 0 {
        let deadline = std::time::Instant::now() + FIRST_CALLBACK_WAIT;
        while first_frames.load(Ordering::Relaxed) == 0 && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(5));
        }
        frames = first_frames.load(Ordering::Relaxed);
    }
    frames
}

struct InputState {
    _stream: cpal::Stream,
    frames: u32,
    rate: u32,
    uid: String,
    /// The platform's own id of the device (see [`native_id`]); `None` when cpal could not give one.
    native: Option<String>,
    transport: Transport,
}

/// Everything the owner thread keeps alive.
struct Streams {
    host: cpal::Host,
    events: Sender<DeviceEvent>,
    engine_rate: u32,
    buffer_request: Option<u32>,
    _output: cpal::Stream,
    out_frames: u32,
    out_uid: String,
    /// The platform's own id of the output device.
    out_native: Option<String>,
    /// The output was opened as "the default device": on CoreAudio the stream then follows the system default.
    follows_default: bool,
    out_transport: Transport,
    direct_hardware: bool,
    delay: Option<Duration>,
    half: Option<CaptureHalf>,
    half_back: Receiver<CaptureHalf>,
    half_tx: Sender<CaptureHalf>,
    input: Option<InputState>,
}

impl Streams {
    fn open(cfg: &OpenConfig, make_engine: EngineFactory, events: Sender<DeviceEvent>) -> Result<Streams, DeviceError> {
        let host = cpal::default_host();
        let device = pick_device(&host, cfg.output_device.as_deref())?;

        let offers: Vec<Offer> = device
            .supported_output_configs()
            .map_err(backend)?
            .map(|r| Offer { channels: r.channels(), min_rate: r.min_sample_rate(), max_rate: r.max_sample_rate(), format: r.sample_format(), buffer: buffer_range(r.buffer_size()) })
            .collect();
        let default = device.default_output_config().ok().map(|c| Choice {
            channels: c.channels(),
            rate: c.sample_rate(),
            format: c.sample_format(),
            buffer: buffer_range(c.buffer_size()),
        });
        let choice = choose_config(&offers, default, cfg.preferred_rate, ChannelPref::Stereo)
            .ok_or_else(|| DeviceError::Unsupported("no f32, i16, u16, i32 or f64 output configuration".into()))?;

        // The engine rate is the stream rate; the factory is called once, here.
        let (back_tx, back_rx) = mpsc::channel::<Engine>();
        let mut engine = make_engine(choice.rate);
        let half = engine.split_capture();
        let mut engine = Some(engine);

        let first_frames = Arc::new(AtomicU32::new(0));
        let delay_ns = Arc::new(AtomicU64::new(u64::MAX));
        let buffer_request = requested_buffer(cfg);

        let mut last_err = DeviceError::Backend("no stream configuration worked".into());
        let mut built = None;
        for buffer_size in buffer_attempts(buffer_request, choice.buffer) {
            let Some(e) = engine.take().or_else(|| back_rx.try_recv().ok()) else { break };
            let config = StreamConfig { channels: choice.channels, sample_rate: choice.rate, buffer_size };
            let boxed = Recover { value: Some(e), back: back_tx.clone() };
            match build_output(&device, config, choice.format, boxed, events.clone(), Arc::clone(&first_frames), Arc::clone(&delay_ns)) {
                Ok(stream) => {
                    built = Some((stream, buffer_size));
                    break;
                }
                Err(err) => last_err = backend(err),
            }
        }
        let (stream, used_buffer) = built.ok_or(last_err)?;
        stream.play().map_err(backend)?;
        let out_frames = settle_buffer_frames(&stream, used_buffer, &first_frames);

        let (half_tx, half_back) = mpsc::channel();
        let mut s = Streams {
            host,
            events,
            engine_rate: choice.rate,
            buffer_request,
            _output: stream,
            out_frames,
            out_uid: uid_of(&device),
            out_native: native_id_of(&device),
            follows_default: cfg.output_device.is_none(),
            out_transport: transport_of_device(&device),
            // ALSA ids of raw hardware start with `hw:` (unverified on a real card; the container has none).
            direct_hardware: current_platform() == Platform::Linux && device.id().map(|i| i.id().starts_with("hw:")).unwrap_or(false),
            delay: match delay_ns.load(Ordering::Relaxed) {
                u64::MAX => None,
                n => Some(Duration::from_nanos(n)),
            },
            half,
            half_back,
            half_tx,
            input: None,
        };
        if cfg.input {
            s.open_input()?;
        }
        Ok(s)
    }

    /// Opens the input stream on the default input device (a no-op while it is open).
    fn open_input(&mut self) -> Result<(), DeviceError> {
        if self.input.is_some() {
            return Ok(());
        }
        let device = self.host.default_input_device().ok_or(DeviceError::NoInputDevice)?;
        let offers: Vec<Offer> = device
            .supported_input_configs()
            .map_err(backend)?
            .map(|r| Offer { channels: r.channels(), min_rate: r.min_sample_rate(), max_rate: r.max_sample_rate(), format: r.sample_format(), buffer: buffer_range(r.buffer_size()) })
            .collect();
        let default = device.default_input_config().ok().map(|c| Choice {
            channels: c.channels(),
            rate: c.sample_rate(),
            format: c.sample_format(),
            buffer: buffer_range(c.buffer_size()),
        });
        // The engine rate where the device supports it, else its own default; the core is told the real rate.
        let choice = choose_config(&offers, default, self.engine_rate, ChannelPref::Mono)
            .ok_or_else(|| DeviceError::Unsupported("no convertible input configuration".into()))?;

        let mut half = Some(
            self.half
                .take()
                .or_else(|| self.half_back.try_recv().ok())
                .ok_or_else(|| DeviceError::Backend("the capture half of the engine is not available".into()))?,
        );
        let first_frames = Arc::new(AtomicU32::new(0));
        let mut last_err = DeviceError::Backend("no input stream configuration worked".into());
        let mut built = None;
        for buffer_size in buffer_attempts(self.buffer_request, choice.buffer) {
            let Some(mut h) = half.take() else { break };
            h.set_input_rate(choice.rate); // before the stream starts
            let config = StreamConfig { channels: choice.channels, sample_rate: choice.rate, buffer_size };
            let boxed = Recover { value: Some(h), back: self.half_tx.clone() };
            match build_input(&device, config, choice.format, boxed, self.events.clone(), Arc::clone(&first_frames)) {
                Ok(stream) => {
                    built = Some((stream, buffer_size));
                    break;
                }
                Err(err) => {
                    last_err = backend(err);
                    half = self.half_back.recv_timeout(Duration::from_secs(2)).ok();
                }
            }
        }
        let Some((stream, used)) = built else {
            self.half = half;
            return Err(last_err);
        };
        if let Err(e) = stream.play() {
            drop(stream);
            self.half = self.half_back.recv_timeout(Duration::from_secs(2)).ok();
            return Err(backend(e));
        }
        let frames = settle_buffer_frames(&stream, used, &first_frames);
        self.input = Some(InputState { _stream: stream, frames, rate: choice.rate, uid: uid_of(&device), native: native_id_of(&device), transport: transport_of_device(&device) });
        Ok(())
    }

    /// Drops the input stream and takes the capture half back (a no-op while closed).
    fn close_input(&mut self) -> Result<(), DeviceError> {
        if self.input.take().is_some() {
            self.half = self.half_back.recv_timeout(Duration::from_secs(2)).ok();
            if self.half.is_none() {
                return Err(DeviceError::Backend("the input stream did not hand the capture half back".into()));
            }
        }
        Ok(())
    }

    /// The facts of the open route. Latency parts, transports and the clock relation come from the platform's
    /// own module where there is one (CoreAudio properties, WASAPI); a value the platform does not give keeps
    /// what cpal says, and a latency part without a source stays null.
    fn info(&self) -> OpenInfo {
        let stream_in = self.input.as_ref().map(|i| (i.frames, i.rate));
        // The platform lookups get the platform's own ids. Without one the facts stay unknown: no fallback to
        // "the default device", which may be another device than the one the stream runs on.
        let in_native = self.input.as_ref().map(|i| i.native.as_deref().unwrap_or(""));
        let described = describe_route(self.out_native.as_deref().unwrap_or(""), in_native, self.out_frames, self.engine_rate, stream_in, self.delay, self.direct_hardware);
        let known = |t: Option<Transport>, fallback: Transport| t.filter(|t| *t != Transport::Unknown).unwrap_or(fallback);
        let facts = RouteFacts {
            output_uid: self.out_uid.clone(),
            input_uid: self.input.as_ref().map(|i| i.uid.clone()),
            output_transport: known(described.out_transport, self.out_transport),
            input_transport: self.input.as_ref().map(|i| known(described.in_transport, i.transport)),
            platform: current_platform(),
            direct_hardware: self.direct_hardware,
            low_latency_feature: false,
        };
        let latency = LatencyReport::new(described.parts, &facts.trust_facts());
        let by_uid = self.input.as_ref().map_or(ClockRelation::Unknown, |i| relation_of(&self.out_uid, &i.uid));
        OpenInfo {
            engine_rate: self.engine_rate,
            out_frames: self.out_frames,
            in_frames: self.input.as_ref().map(|i| i.frames),
            input_rate: self.input.as_ref().map(|i| i.rate),
            clock_relation: if self.input.is_none() { ClockRelation::Unknown } else { merge_relation(described.relation, by_uid) },
            route: facts,
            latency,
            session_type: None,
        }
    }
}

impl Streams {
    /// After a device change: on CoreAudio an output opened as the default device follows the system default
    /// by itself, so the device behind the stream may be another one now. Reads its identity again.
    fn refresh(&mut self) {
        if cfg!(target_os = "macos") && self.follows_default {
            if let Some(device) = self.host.default_output_device() {
                self.out_uid = uid_of(&device);
                self.out_native = native_id_of(&device);
                self.out_transport = transport_of_device(&device);
            }
        }
    }
}

/// What the platform's own module says about a route.
struct Described {
    parts: LatencyParts,
    relation: ClockRelation,
    out_transport: Option<Transport>,
    in_transport: Option<Transport>,
}

/// `Shared` when either source knows it; nothing here ever claims `Separate`.
pub fn merge_relation(platform: ClockRelation, by_uid: ClockRelation) -> ClockRelation {
    if platform == ClockRelation::Shared || by_uid == ClockRelation::Shared {
        ClockRelation::Shared
    } else {
        ClockRelation::Unknown
    }
}

#[allow(unused_variables)]
fn describe_route(out_uid: &str, in_uid: Option<&str>, out_frames: u32, engine_rate: u32, stream_in: Option<(u32, u32)>, delay: Option<Duration>, direct_hardware: bool) -> Described {
    #[cfg(target_os = "macos")]
    {
        use crate::latency_macos as mac;
        let out = mac::query(out_uid, false);
        let input = in_uid.and_then(|uid| mac::query(uid, true));
        Described {
            parts: mac::parts(out.as_ref(), input.as_ref(), out_frames, engine_rate, stream_in),
            relation: mac::relation(out.as_ref(), input.as_ref()),
            out_transport: out.as_ref().map(|o| o.transport()),
            in_transport: input.as_ref().map(|i| i.transport()),
        }
    }
    #[cfg(target_os = "windows")]
    {
        use crate::latency_windows as win;
        let out = win::query(out_uid);
        let input = in_uid.and_then(win::query);
        Described { parts: win::parts(out.as_ref(), input.as_ref()), relation: win::relation(out.as_ref(), input.as_ref()), out_transport: None, in_transport: None }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let mut parts = crate::latency_linux::output_parts(out_frames, engine_rate, delay, direct_hardware);
        if let Some((frames, rate)) = stream_in {
            parts = crate::latency_linux::with_input(parts, frames, rate);
        }
        Described { parts, relation: ClockRelation::Unknown, out_transport: None, in_transport: None }
    }
}

fn build_output(
    device: &cpal::Device,
    config: StreamConfig,
    format: SampleFormat,
    engine: Recover<Engine>,
    events: Sender<DeviceEvent>,
    first_frames: Arc<AtomicU32>,
    delay_ns: Arc<AtomicU64>,
) -> Result<cpal::Stream, cpal::Error> {
    let channels = config.channels as usize;
    let rate = config.sample_rate;
    let on_error = move |e: cpal::Error| {
        if let Some(ev) = event_for(e.kind(), StreamKind::Output) {
            let _ = events.send(ev);
        }
    };
    match format {
        SampleFormat::F32 => {
            let mut engine = engine;
            device.build_output_stream::<f32, _, _>(
                config,
                move |data, info| {
                    let host_ns = stamps::output(host_clock::now_ns(), info.timestamp().callback.as_nanos());
                    note_output(info, &first_frames, &delay_ns, data.len() / channels.max(1));
                    match engine.value.as_mut() {
                        Some(e) => e.render(host_ns, data, channels),
                        None => data.fill(0.0),
                    }
                },
                on_error,
                None,
            )
        }
        SampleFormat::I16 => build_output_converting::<i16>(device, config, engine, on_error, first_frames, delay_ns, channels, rate),
        SampleFormat::U16 => build_output_converting::<u16>(device, config, engine, on_error, first_frames, delay_ns, channels, rate),
        SampleFormat::I32 => build_output_converting::<i32>(device, config, engine, on_error, first_frames, delay_ns, channels, rate),
        SampleFormat::F64 => build_output_converting::<f64>(device, config, engine, on_error, first_frames, delay_ns, channels, rate),
        other => Err(cpal::Error::with_message(ErrorKind::UnsupportedConfig, format!("sample format {other:?} is not converted"))),
    }
}

/// Atomics only: the first callback's size, and the smallest positive `playback - callback`.
fn note_output(info: &cpal::OutputCallbackInfo, first_frames: &AtomicU32, delay_ns: &AtomicU64, frames: usize) {
    if first_frames.load(Ordering::Relaxed) == 0 {
        first_frames.store(frames as u32, Ordering::Relaxed);
    }
    let ts = info.timestamp();
    let d = ts.playback.duration_since(ts.callback).as_nanos() as u64;
    if d > 0 {
        delay_ns.fetch_min(d, Ordering::Relaxed);
    }
}

#[allow(clippy::too_many_arguments)]
fn build_output_converting<T>(
    device: &cpal::Device,
    config: StreamConfig,
    engine: Recover<Engine>,
    on_error: impl FnMut(cpal::Error) + Send + 'static,
    first_frames: Arc<AtomicU32>,
    delay_ns: Arc<AtomicU64>,
    channels: usize,
    rate: u32,
) -> Result<cpal::Stream, cpal::Error>
where
    T: SizedSample + cpal::FromSample<f32>,
{
    let mut engine = engine;
    let channels = channels.max(1);
    let mut scratch = vec![0f32; SCRATCH_SAMPLES - SCRATCH_SAMPLES % channels];
    device.build_output_stream::<T, _, _>(
        config,
        move |data, info| {
            let host_ns = stamps::output(host_clock::now_ns(), info.timestamp().callback.as_nanos());
            note_output(info, &first_frames, &delay_ns, data.len() / channels);
            let Some(e) = engine.value.as_mut() else {
                data.fill(T::EQUILIBRIUM);
                return;
            };
            let mut done = 0;
            while done < data.len() {
                let n = (data.len() - done).min(scratch.len()) / channels * channels;
                if n == 0 {
                    data[done..].fill(T::EQUILIBRIUM);
                    break;
                }
                // A callback larger than the scratch is rendered in pieces; each piece is stamped with its own
                // offset so the clock fit sees one steady line.
                let at_ns = host_ns + (done / channels) as u64 * 1_000_000_000 / rate as u64;
                e.render(at_ns, &mut scratch[..n], channels);
                for (d, s) in data[done..done + n].iter_mut().zip(&scratch[..n]) {
                    *d = T::from_sample(*s);
                }
                done += n;
            }
        },
        on_error,
        None,
    )
}

fn build_input(
    device: &cpal::Device,
    config: StreamConfig,
    format: SampleFormat,
    half: Recover<CaptureHalf>,
    events: Sender<DeviceEvent>,
    first_frames: Arc<AtomicU32>,
) -> Result<cpal::Stream, cpal::Error> {
    let channels = config.channels as usize;
    let rate = config.sample_rate;
    let on_error = move |e: cpal::Error| {
        if let Some(ev) = event_for(e.kind(), StreamKind::Input) {
            let _ = events.send(ev);
        }
    };
    match format {
        SampleFormat::F32 => {
            let mut half = half;
            device.build_input_stream::<f32, _, _>(
                config,
                move |data, info| {
                    let host_ns = stamps::input(host_clock::now_ns(), info.timestamp().callback.as_nanos(), data.len() / channels.max(1), rate);
                    if first_frames.load(Ordering::Relaxed) == 0 {
                        first_frames.store((data.len() / channels.max(1)) as u32, Ordering::Relaxed);
                    }
                    if let Some(h) = half.value.as_mut() {
                        h.capture(host_ns, data, channels);
                    }
                },
                on_error,
                None,
            )
        }
        SampleFormat::I16 => build_input_converting::<i16>(device, config, half, on_error, first_frames, channels, rate),
        SampleFormat::U16 => build_input_converting::<u16>(device, config, half, on_error, first_frames, channels, rate),
        SampleFormat::I32 => build_input_converting::<i32>(device, config, half, on_error, first_frames, channels, rate),
        SampleFormat::F64 => build_input_converting::<f64>(device, config, half, on_error, first_frames, channels, rate),
        other => Err(cpal::Error::with_message(ErrorKind::UnsupportedConfig, format!("sample format {other:?} is not converted"))),
    }
}

fn build_input_converting<T>(
    device: &cpal::Device,
    config: StreamConfig,
    half: Recover<CaptureHalf>,
    on_error: impl FnMut(cpal::Error) + Send + 'static,
    first_frames: Arc<AtomicU32>,
    channels: usize,
    rate: u32,
) -> Result<cpal::Stream, cpal::Error>
where
    T: SizedSample,
    f32: cpal::FromSample<T>,
{
    let mut half = half;
    let channels = channels.max(1);
    let mut scratch = vec![0f32; SCRATCH_SAMPLES - SCRATCH_SAMPLES % channels];
    device.build_input_stream::<T, _, _>(
        config,
        move |data, info| {
            let host_ns = stamps::input(host_clock::now_ns(), info.timestamp().callback.as_nanos(), data.len() / channels, rate);
            if first_frames.load(Ordering::Relaxed) == 0 {
                first_frames.store((data.len() / channels) as u32, Ordering::Relaxed);
            }
            let Some(h) = half.value.as_mut() else { return };
            let mut done = 0;
            while done < data.len() {
                let n = (data.len() - done).min(scratch.len()) / channels * channels;
                if n == 0 {
                    break;
                }
                for (d, s) in scratch[..n].iter_mut().zip(&data[done..done + n]) {
                    *d = f32::from_sample(*s);
                }
                done += n;
                // A callback larger than the scratch goes in pieces; each is stamped as of the end of its frames.
                let left_ns = ((data.len() - done) / channels) as u64 * 1_000_000_000 / rate as u64;
                h.capture(host_ns.saturating_sub(left_ns), &scratch[..n], channels);
            }
        },
        on_error,
        None,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn offer(channels: u16, lo: u32, hi: u32, format: SampleFormat) -> Offer {
        Offer { channels, min_rate: lo, max_rate: hi, format, buffer: None }
    }

    #[test]
    fn platform_lookups_get_the_bare_id() {
        let id = cpal::DeviceId::new(cpal::default_host().id(), "BuiltInSpeakerDevice");
        assert_eq!(native_id(&id), "BuiltInSpeakerDevice");
        assert_ne!(id.to_string(), native_id(&id), "cpal's display form carries the host name");
        assert!(id.to_string().ends_with(":BuiltInSpeakerDevice"));
    }

    #[test]
    fn prefers_f32_stereo_at_48k() {
        let offers = [
            offer(1, 8000, 96000, SampleFormat::I16),
            offer(2, 8000, 96000, SampleFormat::I16),
            offer(1, 8000, 96000, SampleFormat::F32),
            offer(2, 8000, 96000, SampleFormat::F32),
        ];
        let c = choose_config(&offers, None, 48_000, ChannelPref::Stereo).unwrap();
        assert_eq!((c.channels, c.rate, c.format), (2, 48_000, SampleFormat::F32));
    }

    #[test]
    fn converts_integer_formats_when_f32_is_missing() {
        let c = choose_config(&[offer(2, 44_100, 48_000, SampleFormat::I16)], None, 48_000, ChannelPref::Stereo).unwrap();
        assert_eq!((c.rate, c.format), (48_000, SampleFormat::I16));
    }

    #[test]
    fn falls_back_to_device_default_when_rate_is_not_offered() {
        let default = Choice { channels: 2, rate: 44_100, format: SampleFormat::F32, buffer: None };
        let c = choose_config(&[offer(2, 44_100, 44_100, SampleFormat::F32)], Some(default), 48_000, ChannelPref::Stereo).unwrap();
        assert_eq!(c, default);
    }

    #[test]
    fn unconvertible_default_falls_to_nearest_rate_offer() {
        let default = Choice { channels: 2, rate: 44_100, format: SampleFormat::I8, buffer: None };
        let offers = [offer(2, 44_100, 44_100, SampleFormat::I8), offer(6, 44_100, 44_100, SampleFormat::I16)];
        let c = choose_config(&offers, Some(default), 48_000, ChannelPref::Stereo).unwrap();
        assert_eq!((c.channels, c.rate, c.format), (6, 44_100, SampleFormat::I16));
    }

    #[test]
    fn nothing_convertible_is_none() {
        assert!(choose_config(&[offer(2, 1, 96000, SampleFormat::I8)], None, 48_000, ChannelPref::Stereo).is_none());
    }

    #[test]
    fn transports_follow_the_interface_type() {
        assert_eq!(transport_of(InterfaceType::Usb), Transport::Usb);
        assert_eq!(transport_of(InterfaceType::BuiltIn), Transport::BuiltIn);
        assert_eq!(transport_of(InterfaceType::Bluetooth), Transport::Bluetooth);
        assert_eq!(transport_of(InterfaceType::Unknown), Transport::Unknown);
    }

    #[test]
    fn stream_errors_map_to_events() {
        use StreamKind::{Input, Output};
        let int = |stream, reason| Some(DeviceEvent::Interruption { stream, reason });
        assert_eq!(event_for(ErrorKind::Xrun, Output), Some(DeviceEvent::Xrun(Output)));
        assert_eq!(event_for(ErrorKind::Xrun, Input), Some(DeviceEvent::Xrun(Input)));
        assert_eq!(event_for(ErrorKind::DeviceNotAvailable, Output), int(Output, InterruptionReason::DeviceChange));
        assert_eq!(event_for(ErrorKind::DeviceNotAvailable, Input), int(Input, InterruptionReason::TrackEnded));
        assert_eq!(event_for(ErrorKind::DeviceChanged, Input), int(Input, InterruptionReason::DeviceChange));
        assert_eq!(event_for(ErrorKind::BackendError, Output), int(Output, InterruptionReason::Interrupted));
        assert_eq!(event_for(ErrorKind::RealtimeDenied, Output), None);
    }

    #[test]
    fn input_prefers_mono() {
        let offers = [offer(2, 8000, 96000, SampleFormat::F32), offer(1, 8000, 96000, SampleFormat::F32)];
        assert_eq!(choose_config(&offers, None, 48_000, ChannelPref::Mono).unwrap().channels, 1);
    }

    #[test]
    fn shared_clock_needs_one_device_on_a_platform_with_one_clock_per_device() {
        assert_eq!(relation_of("a", "b"), ClockRelation::Unknown);
        assert_eq!(relation_of("", ""), ClockRelation::Unknown);
        let same = relation_of("a", "a");
        if cfg!(any(target_os = "macos", target_os = "ios", target_os = "windows")) {
            assert_eq!(same, ClockRelation::Shared);
        } else {
            assert_eq!(same, ClockRelation::Unknown);
        }
    }

    #[test]
    fn default_buffer_request_is_the_platforms() {
        assert_eq!(requested_buffer(&OpenConfig { buffer_frames: Some(64), ..OpenConfig::default() }), Some(64));
    }
}
