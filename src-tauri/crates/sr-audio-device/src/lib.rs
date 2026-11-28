//! Device layer of the native audio engine (design section 1, `sr-audio-device`).
//!
//! * [`DeviceIo`]: what the app needs from an audio device, whatever drives it.
//! * [`cpal_io::CpalIo`]: the default implementation (output stream only for now).
//! * `fake_io::FakeIo` (feature `fake`): a thread-driven fake output device that renders in real time.
//! * [`host_clock`]: the monotonic clock all callbacks stamp themselves with.
//!
//! Deviations from the design's trait, forced by the core: the core's engine rate is fixed when the engine is
//! built, but the rate is only known once the device has been negotiated, so [`DeviceIo::open`] takes an
//! [`EngineFactory`] instead of a ready engine. The device calls it exactly once with the rate it settled on and
//! moves the returned realtime half into its callback; the non-realtime `EngineHandle` stays with whoever wrote
//! the factory. Notifications from the device (stream errors) travel on a plain channel of [`DeviceEvent`].

use std::fmt;
use std::sync::mpsc::Sender;

use sr_audio_core::capture::ClockRelation;
use sr_audio_core::latency::{LatencyParts, LatencyReport, Platform, RouteTrustFacts, Transport};
use sr_audio_core::Engine;

pub mod cpal_io;
pub mod host_clock;
pub mod latency_linux;
pub mod latency_macos;
pub mod latency_windows;
pub mod permission;
pub mod stamps;

#[cfg(feature = "fake")]
pub mod fake_io;

/// Builds the realtime engine for the engine rate the device settled on (Hz). Called once, inside `open`.
pub type EngineFactory = Box<dyn FnOnce(u32) -> Engine + Send>;

/// What the caller wants from the device.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenConfig {
    /// Preferred engine rate, Hz. The device falls back to its own default rate when it cannot run this one.
    pub preferred_rate: u32,
    /// Output buffer size in frames; `None` = the platform's default of design section 1 (128 on Apple, 256 on
    /// Android and ALSA, the device period on WASAPI).
    pub buffer_frames: Option<u32>,
    /// Open an input stream too (default input device). When it cannot be opened, `open` fails.
    pub input: bool,
    /// Output device by id or name; `None` = the system default.
    pub output_device: Option<String>,
}

impl Default for OpenConfig {
    fn default() -> Self {
        OpenConfig { preferred_rate: 48_000, buffer_frames: None, input: false, output_device: None }
    }
}

/// How the open stream looks (the `OpenInfo` of design section 3 without the clock anchor, which the app adds).
#[derive(Debug, Clone, PartialEq)]
pub struct OpenInfo {
    /// Engine rate = output stream rate, Hz.
    pub engine_rate: u32,
    /// Output buffer size in frames; 0 when the backend did not say and no callback was seen.
    pub out_frames: u32,
    /// Input buffer size in frames; `None` while no input is open.
    pub in_frames: Option<u32>,
    /// Input stream rate, Hz; `None` while no input is open.
    pub input_rate: Option<u32>,
    /// What the device layer knows about the two streams' clocks, for `CaptureConfig::relation`.
    pub clock_relation: ClockRelation,
    /// The route as the OS describes it.
    pub route: RouteFacts,
    /// Reported latency and its trust class.
    pub latency: LatencyReport,
    /// Mobile audio session type; `None` on desktop.
    pub session_type: Option<String>,
}

/// Facts about the open route (design section 3 `route`, plus what the trust class needs).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RouteFacts {
    /// Stable id of the output device (backend specific).
    pub output_uid: String,
    /// Stable id of the input device; `None` while no input is open.
    pub input_uid: Option<String>,
    /// How the output device is attached.
    pub output_transport: Transport,
    /// How the input device is attached.
    pub input_transport: Option<Transport>,
    /// Platform the facts come from.
    pub platform: Platform,
    /// Linux: the output is a `hw:` device, not a sound server.
    pub direct_hardware: bool,
    /// Android: the device declares the low-latency feature.
    pub low_latency_feature: bool,
}

impl RouteFacts {
    /// The subset `sr_audio_core::latency::classify_trust` reads.
    pub fn trust_facts(&self) -> RouteTrustFacts {
        RouteTrustFacts {
            platform: self.platform,
            output_transport: self.output_transport,
            input_transport: self.input_transport,
            direct_hardware: self.direct_hardware,
            low_latency_feature: self.low_latency_feature,
        }
    }
}

/// The platform this build runs on, as the latency maths names it.
pub fn current_platform() -> Platform {
    if cfg!(target_os = "macos") {
        Platform::MacOs
    } else if cfg!(target_os = "ios") {
        Platform::Ios
    } else if cfg!(target_os = "windows") {
        Platform::Windows
    } else if cfg!(target_os = "android") {
        Platform::Android
    } else {
        Platform::Linux
    }
}

/// Why a stream stopped or was interrupted (the `reason` of the `interruption` event).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InterruptionReason {
    /// The stream failed or was taken away (phone call, backend error).
    Interrupted,
    /// The app went to the background.
    Hidden,
    /// A media track ended.
    TrackEnded,
    /// The device was unplugged or the route changed.
    DeviceChange,
}

/// Which stream an event concerns.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamKind {
    /// The output stream.
    Output,
    /// The input stream.
    Input,
}

/// What a device tells its owner outside the realtime path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeviceEvent {
    /// A stream is no longer reliable; the owner should treat running takes as void and may reopen.
    Interruption {
        /// Which stream failed.
        stream: StreamKind,
        /// Why.
        reason: InterruptionReason,
    },
    /// The backend reported an under- or overrun.
    Xrun(StreamKind),
}

/// Why `open` failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeviceError {
    /// The host has no output device (no sound card, no sound server).
    NoOutputDevice,
    /// The named device does not exist.
    DeviceNotFound(String),
    /// The OS refused access to the input device (microphone permission).
    PermissionDenied,
    /// An input stream was requested and the host has no input device.
    NoInputDevice,
    /// The device offers no sample format or layout the engine can drive.
    Unsupported(String),
    /// The backend refused (message from the backend).
    Backend(String),
    /// `open` was called on an open device.
    AlreadyOpen,
}

impl fmt::Display for DeviceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DeviceError::NoOutputDevice => f.write_str("no audio output device found"),
            DeviceError::PermissionDenied => f.write_str("microphone access was denied by the system"),
            DeviceError::NoInputDevice => f.write_str("no audio input device found"),
            DeviceError::DeviceNotFound(n) => write!(f, "audio output device not found: {n}"),
            DeviceError::Unsupported(m) => write!(f, "audio device not supported: {m}"),
            DeviceError::Backend(m) => write!(f, "audio backend error: {m}"),
            DeviceError::AlreadyOpen => f.write_str("the audio device is already open"),
        }
    }
}

impl std::error::Error for DeviceError {}

/// An audio device the engine can run on.
pub trait DeviceIo: Send {
    /// Negotiates the stream, builds the engine through `make_engine` (once, with the engine rate), starts
    /// rendering, and returns what was settled. Stream errors afterwards arrive on `events`.
    fn open(&mut self, cfg: OpenConfig, make_engine: EngineFactory, events: Sender<DeviceEvent>) -> Result<OpenInfo, DeviceError>;
    /// Stops the stream and drops the engine. Idempotent.
    fn close(&mut self);
    /// The current route; a default value before `open`.
    fn route(&self) -> RouteFacts;
    /// The latency parts the backend reports for the current route.
    fn latency(&self) -> LatencyParts;
    /// Closes (`false`) or reopens (`true`) the input stream only; the output keeps running and the engine
    /// keeps its capture half. Returns the facts of the route as they are afterwards. Idempotent.
    fn set_input(&mut self, enabled: bool) -> Result<OpenInfo, DeviceError> {
        let _ = enabled;
        Err(DeviceError::Unsupported("this device has no switchable input".into()))
    }
    /// Reads the route again after a device change (the output device behind a stream that follows the system
    /// default may be another one now) and returns the facts as they are; `None` when the device has nothing to
    /// re-read or is not open.
    fn refresh(&mut self) -> Option<OpenInfo> {
        None
    }
    /// Told by the app that a capture is about to be requested. Real devices ignore it; the fake device uses it
    /// to start its optional input signal.
    fn capture_requested(&mut self) {}
}
