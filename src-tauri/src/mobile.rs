//! Mobile session glue (design sections 5 and 7): the audio layer's view of the session plugin.
//!
//! The module compiles on every host so that the mapping from the plugin's facts to `OpenInfo` and to events is
//! tested on Linux; only [`register`] and the real [`SessionApi`] implementation exist in mobile builds, and
//! only mobile builds ever install an API, so desktop opens a plain `CpalIo` exactly as before.
//!
//! * [`SessionIo`] wraps a `DeviceIo`. `open` configures the session first (iOS: category, mode, preferred rate
//!   and buffer, `setActive(true)`), opens the streams, then fills the route, the latency parts and `sessionType`
//!   from what the plugin reports. `close` closes the streams, then deactivates the session.
//! * Plugin events become the existing events: an interruption, a media-services reset or a lost audio focus is an
//!   `interruption`; a route change is a `route` event with the facts and latency read again.
//! * Nothing is estimated. A latency part the platform does not report stays `None`.

#![cfg_attr(not(mobile), allow(dead_code))]

use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

use sr_audio_core::latency::{LatencyParts, LatencyReport, Platform, Transport};
use sr_audio_device::{DeviceError, DeviceEvent, DeviceIo, EngineFactory, InterruptionReason, OpenConfig, OpenInfo, RouteFacts, StreamKind};
use tauri_plugin_sr_audio_session::{FocusState, PermissionState, PortTransport, SessionConfig, SessionEvent, SessionInfo, DEFAULT_IO_BUFFER_SEC, DEFAULT_SAMPLE_RATE};

use crate::audio::{AudioEvent, EventSink};

/// What the audio layer needs from the session plugin. The real implementation calls Swift or Kotlin; tests use a
/// script. Every call may block until the platform answers, so none may run on the main thread.
pub trait SessionApi: Send + Sync {
    /// The microphone permission now.
    fn permission_state(&self) -> Result<PermissionState, String>;
    /// Prompts when undecided; returns the state after the answer.
    fn request_permission(&self) -> Result<PermissionState, String>;
    /// Configures and activates the session.
    fn configure(&self, config: SessionConfig) -> Result<SessionInfo, String>;
    /// Deactivates the session.
    fn deactivate(&self) -> Result<(), String>;
    /// The session and route now.
    fn info(&self) -> Result<SessionInfo, String>;
    /// Forwards session events to `handler` (replacing an earlier one).
    fn watch(&self, handler: Box<dyn Fn(SessionEvent) + Send + Sync>) -> Result<(), String>;
    /// Stops forwarding.
    fn unwatch(&self) -> Result<(), String>;
}

#[cfg(mobile)]
impl SessionApi for tauri_plugin_sr_audio_session::SrAudioSession<tauri::Wry> {
    fn permission_state(&self) -> Result<PermissionState, String> {
        tauri_plugin_sr_audio_session::SrAudioSession::permission_state(self).map_err(|e| e.to_string())
    }
    fn request_permission(&self) -> Result<PermissionState, String> {
        tauri_plugin_sr_audio_session::SrAudioSession::request_permission(self).map_err(|e| e.to_string())
    }
    fn configure(&self, config: SessionConfig) -> Result<SessionInfo, String> {
        self.configure_session(config).map_err(|e| e.to_string())
    }
    fn deactivate(&self) -> Result<(), String> {
        self.deactivate_session().map_err(|e| e.to_string())
    }
    fn info(&self) -> Result<SessionInfo, String> {
        self.session_info().map_err(|e| e.to_string())
    }
    fn watch(&self, handler: Box<dyn Fn(SessionEvent) + Send + Sync>) -> Result<(), String> {
        self.watch_events(handler).map_err(|e| e.to_string())
    }
    fn unwatch(&self) -> Result<(), String> {
        self.unwatch_events().map_err(|e| e.to_string())
    }
}

static SESSION: OnceLock<Arc<dyn SessionApi>> = OnceLock::new();

/// Makes `api` the session the audio layer uses. Mobile setup calls this once; later calls are ignored.
pub fn install(api: Arc<dyn SessionApi>) {
    let _ = SESSION.set(api);
}

/// The installed session API; `None` on desktop.
pub fn session() -> Option<Arc<dyn SessionApi>> {
    SESSION.get().cloned()
}

/// Registers the plugin and installs it, on a builder (mobile builds only).
#[cfg(mobile)]
pub fn register(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    use tauri_plugin_sr_audio_session::SrAudioSessionExt;
    builder.plugin(tauri_plugin_sr_audio_session::init()).setup(|app| {
        install(Arc::new(app.handle().sr_audio_session().clone()));
        Ok(())
    })
}

/// `audio_permission` without a request on mobile; `None` where no session is installed (desktop).
pub fn permission_state() -> Option<&'static str> {
    let api = session()?;
    Some(api.permission_state().map(PermissionState::as_str).unwrap_or("unknown"))
}

/// `audio_permission({ request: true })` on mobile: prompts once, waits for the answer.
pub fn request_permission() -> Option<&'static str> {
    let api = session()?;
    Some(api.request_permission().map(PermissionState::as_str).unwrap_or("unknown"))
}

// ---------------------------------------------------------------------------------------------------------------
// Mapping (pure)
// ---------------------------------------------------------------------------------------------------------------

/// The latency maths' transport for a plugin port transport.
pub fn transport_of(t: PortTransport) -> Transport {
    match t {
        PortTransport::BuiltIn => Transport::BuiltIn,
        PortTransport::Wired => Transport::Wired,
        PortTransport::Usb => Transport::Usb,
        PortTransport::Bluetooth => Transport::Bluetooth,
        PortTransport::Hdmi => Transport::Hdmi,
        PortTransport::Network => Transport::Network,
        PortTransport::Unknown => Transport::Unknown,
    }
}

/// Fills `info` from what the session plugin reports. `info` comes from the device crate and already holds its own
/// values (cpal's buffer sizes, rates); a value the plugin does not report is left as it is.
///
/// * Route: the active input and output port's uid and transport (an unknown transport does not overwrite a known
///   one); the Android low-latency feature flags.
/// * Latency: the session's `ioBufferDuration` as the buffer part of both sides, `outputLatency` as the output
///   device part and `inputLatency` as the input device part (iOS). The input parts only where an input is open.
///   Android reports no latency, so its parts stay what cpal gave and its trust follows from that.
/// * `session_type` as the plugin names it.
pub fn apply_session(info: &mut OpenInfo, s: &SessionInfo) {
    let input_open = info.in_frames.is_some();
    if let Some(p) = s.active_output() {
        info.route.output_uid = p.uid.clone();
        if p.transport != PortTransport::Unknown {
            info.route.output_transport = transport_of(p.transport);
        }
    }
    if input_open {
        if let Some(p) = s.active_input() {
            info.route.input_uid = Some(p.uid.clone());
            if p.transport != PortTransport::Unknown {
                info.route.input_transport = Some(transport_of(p.transport));
            }
        }
    }
    info.route.low_latency_feature = s.low_latency || s.pro_audio;

    let mut parts: LatencyParts = info.latency.parts;
    if let Some(buffer) = s.io_buffer_duration.filter(|b| b.is_finite() && *b > 0.0) {
        parts.out_buffer = Some(buffer);
        if input_open {
            parts.in_buffer = Some(buffer);
        }
    }
    if let Some(l) = s.output_latency.filter(|l| l.is_finite() && *l > 0.0) {
        parts.out_device = Some(l);
    }
    if input_open {
        if let Some(l) = s.input_latency.filter(|l| l.is_finite() && *l > 0.0) {
            parts.in_device = Some(l);
        }
    }
    info.latency = LatencyReport::new(parts, &info.route.trust_facts());
    if s.session_type.is_some() {
        info.session_type = s.session_type.clone();
    }
}

/// Android callback size: the default request rounded up to a whole number of the device's burst, because AAudio
/// wants callbacks in multiples of the burst. `None` when the device did not say, or the burst is implausible.
pub fn android_buffer_frames(default_request: u32, burst: Option<u32>) -> Option<u32> {
    let burst = burst.filter(|b| (16..=2048).contains(b))?;
    Some(default_request.div_ceil(burst) * burst)
}

/// iOS callback size: the session's preferred IO buffer (5 ms) at the preferred rate, in frames. cpal sets the
/// session's IO buffer duration from the size it is asked for, after the plugin has configured the session, so the
/// preference only holds when this size is what cpal is asked for.
pub fn ios_buffer_frames() -> u32 {
    (DEFAULT_IO_BUFFER_SEC * DEFAULT_SAMPLE_RATE).round() as u32
}

/// The `route` event for `info`.
pub fn route_event(info: &OpenInfo) -> AudioEvent {
    AudioEvent::Route { route: (&info.route).into(), latency: info.latency.into(), engine_rate: info.engine_rate }
}

/// The device event a session event stands for, if any. Route changes are not one: they become `route` events.
pub fn device_event_for(e: &SessionEvent) -> Option<DeviceEvent> {
    let interrupted = Some(DeviceEvent::Interruption { stream: StreamKind::Output, reason: InterruptionReason::Interrupted });
    match e {
        SessionEvent::InterruptionBegan | SessionEvent::MediaServicesReset => interrupted,
        SessionEvent::AudioFocus { state: FocusState::Lost } => interrupted,
        SessionEvent::AudioFocus { state: FocusState::Gained } | SessionEvent::InterruptionEnded { .. } | SessionEvent::RouteChange { .. } => None,
    }
}

// ---------------------------------------------------------------------------------------------------------------
// The device wrapper
// ---------------------------------------------------------------------------------------------------------------

struct Live {
    /// What the wrapped device reported at open or after the last input switch.
    base: OpenInfo,
    /// `base` with the session's facts applied: what the app was told last.
    current: OpenInfo,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

/// A `DeviceIo` that runs the mobile session around another one.
pub struct SessionIo {
    inner: Box<dyn DeviceIo>,
    api: Arc<dyn SessionApi>,
    sink: EventSink,
    platform: Platform,
    live: Arc<Mutex<Option<Live>>>,
    configured: bool,
}

impl SessionIo {
    /// Wraps `inner`. `sink` receives the `route` events; interruptions travel on the device event channel that
    /// `open` is given.
    pub fn new(inner: Box<dyn DeviceIo>, api: Arc<dyn SessionApi>, sink: EventSink) -> Self {
        SessionIo { inner, api, sink, platform: sr_audio_device::current_platform(), live: Arc::new(Mutex::new(None)), configured: false }
    }

    fn patched(&self, base: &OpenInfo) -> OpenInfo {
        let mut info = base.clone();
        match self.api.info() {
            Ok(s) => apply_session(&mut info, &s),
            Err(e) => eprintln!("audio session: session info unavailable: {e}"),
        }
        info
    }

    fn start_watching(&self, events: Sender<DeviceEvent>) {
        let (api, live, sink) = (Arc::clone(&self.api), Arc::clone(&self.live), Arc::clone(&self.sink));
        let handler = move |e: SessionEvent| {
            if let Some(d) = device_event_for(&e) {
                let _ = events.send(d);
            }
            if matches!(e, SessionEvent::RouteChange { .. }) {
                // The reply to `session_info` may need the thread this event arrived on (the main thread on iOS),
                // so the route is read on a thread of its own.
                let (api, live, sink) = (Arc::clone(&api), Arc::clone(&live), Arc::clone(&sink));
                std::thread::spawn(move || {
                    let Ok(session) = api.info() else { return };
                    let event = {
                        let mut guard = lock(&live);
                        let Some(l) = guard.as_mut() else { return };
                        let mut info = l.base.clone();
                        apply_session(&mut info, &session);
                        l.current = info.clone();
                        route_event(&info)
                    };
                    sink(event);
                });
            }
        };
        if let Err(e) = self.api.watch(Box::new(handler)) {
            eprintln!("audio session: events unavailable: {e}");
        }
    }

    fn release(&mut self) {
        if self.configured {
            let _ = self.api.unwatch();
            *lock(&self.live) = None;
        }
    }
}

impl DeviceIo for SessionIo {
    fn open(&mut self, mut cfg: OpenConfig, make_engine: EngineFactory, events: Sender<DeviceEvent>) -> Result<OpenInfo, DeviceError> {
        let session = self.api.configure(SessionConfig::default()).map_err(|e| DeviceError::Backend(format!("audio session: {e}")))?;
        self.configured = true;
        if cfg.buffer_frames.is_none() {
            cfg.buffer_frames = match self.platform {
                Platform::Android => android_buffer_frames(256, session.output_frames_per_buffer),
                Platform::Ios => Some(ios_buffer_frames()),
                _ => None,
            };
        }
        let base = match self.inner.open(cfg, make_engine, events.clone()) {
            Ok(info) => info,
            Err(e) => {
                let _ = self.api.deactivate();
                self.configured = false;
                return Err(e);
            }
        };
        // Read again with the streams running: iOS reports its latencies once the route is live.
        let current = self.patched(&base);
        *lock(&self.live) = Some(Live { base, current: current.clone() });
        self.start_watching(events);
        Ok(current)
    }

    fn close(&mut self) {
        if !self.configured {
            return; // never opened, already closed, or the open failed and gave the session back
        }
        self.release();
        self.inner.close();
        let _ = self.api.deactivate();
        self.configured = false;
    }

    fn route(&self) -> RouteFacts {
        match lock(&self.live).as_ref() {
            Some(l) => l.current.route.clone(),
            None => self.inner.route(),
        }
    }

    fn latency(&self) -> LatencyParts {
        match lock(&self.live).as_ref() {
            Some(l) => l.current.latency.parts,
            None => self.inner.latency(),
        }
    }

    fn set_input(&mut self, enabled: bool) -> Result<OpenInfo, DeviceError> {
        let base = self.inner.set_input(enabled)?;
        let current = self.patched(&base);
        if let Some(l) = lock(&self.live).as_mut() {
            l.base = base;
            l.current = current.clone();
        }
        Ok(current)
    }

    fn capture_requested(&mut self) {
        self.inner.capture_requested();
    }
}

impl Drop for SessionIo {
    fn drop(&mut self) {
        self.close();
    }
}

#[cfg(test)]
mod tests;
