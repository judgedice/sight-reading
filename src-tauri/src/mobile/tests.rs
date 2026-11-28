use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use sr_audio_core::latency::{LatencyParts, LatencyReport, Platform, RouteTrustFacts, Transport, TrustClass};
use sr_audio_device::fake_io::{FakeConfig, FakeIo};
use sr_audio_device::{DeviceError, DeviceEvent, DeviceIo, EngineFactory, InterruptionReason, OpenConfig, OpenInfo, RouteFacts, StreamKind};
use tauri_plugin_sr_audio_session::{FocusState, PermissionState, Port, PortTransport, SessionConfig, SessionEvent, SessionInfo};

use super::*;
use crate::audio::{AudioEvent, AudioHost, InterruptionJson};

// ---- helpers ----------------------------------------------------------------------------------------------------

fn port(uid: &str, transport: PortTransport, active: bool) -> Port {
    Port { uid: uid.into(), port_type: None, name: None, transport, active }
}

/// What cpal gives on an iPhone before the plugin has spoken: buffers from the stream, nothing else.
fn cpal_info(platform: Platform, input: bool) -> OpenInfo {
    let facts = RouteFacts {
        output_uid: "cpal:out".into(),
        input_uid: input.then(|| "cpal:in".to_string()),
        output_transport: Transport::Unknown,
        input_transport: input.then_some(Transport::Unknown),
        platform,
        direct_hardware: false,
        low_latency_feature: false,
    };
    let parts = LatencyParts { out_buffer: Some(128.0 / 48_000.0), in_buffer: input.then_some(128.0 / 48_000.0), ..LatencyParts::default() };
    let latency = LatencyReport::new(parts, &facts.trust_facts());
    OpenInfo {
        engine_rate: 48_000,
        out_frames: 128,
        in_frames: input.then_some(128),
        input_rate: input.then_some(48_000),
        clock_relation: sr_audio_core::capture::ClockRelation::Unknown,
        route: facts,
        latency,
        session_type: None,
    }
}

fn ios_session() -> SessionInfo {
    SessionInfo {
        session_type: Some("play-and-record".into()),
        sample_rate: Some(48_000.0),
        io_buffer_duration: Some(0.005),
        input_latency: Some(0.0031),
        output_latency: Some(0.0042),
        inputs: vec![port("Built-In Microphone", PortTransport::BuiltIn, true)],
        outputs: vec![port("Speaker", PortTransport::BuiltIn, true)],
        ..SessionInfo::default()
    }
}

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() < 1e-12
}

// ---- mapping ----------------------------------------------------------------------------------------------------

#[test]
fn ios_values_fill_buffer_and_device_parts_and_the_route() {
    let mut info = cpal_info(Platform::Ios, true);
    apply_session(&mut info, &ios_session());
    let p = info.latency.parts;
    assert_eq!(p.out_buffer, Some(0.005));
    assert_eq!(p.in_buffer, Some(0.005));
    assert_eq!(p.out_device, Some(0.0042));
    assert_eq!(p.in_device, Some(0.0031));
    assert_eq!((p.out_safety, p.out_stream, p.in_safety, p.in_stream), (None, None, None, None));
    assert!(close(info.latency.output_sec.unwrap(), 0.0092));
    assert!(close(info.latency.input_sec.unwrap(), 0.0081));
    assert_eq!(info.latency.trust, TrustClass::A);
    assert_eq!(info.session_type.as_deref(), Some("play-and-record"));
    assert_eq!(info.route.output_uid, "Speaker");
    assert_eq!(info.route.input_uid.as_deref(), Some("Built-In Microphone"));
    assert_eq!((info.route.output_transport, info.route.input_transport), (Transport::BuiltIn, Some(Transport::BuiltIn)));
}

#[test]
fn without_an_input_the_input_side_stays_empty() {
    let mut info = cpal_info(Platform::Ios, false);
    apply_session(&mut info, &ios_session());
    assert_eq!(info.latency.parts.in_device, None);
    assert_eq!(info.latency.parts.in_buffer, None);
    assert_eq!(info.latency.input_sec, None);
    assert_eq!(info.route.input_uid, None);
    assert!(info.latency.output_sec.is_some());
}

#[test]
fn bluetooth_output_is_trust_c_even_with_a_reported_latency() {
    let mut s = ios_session();
    s.outputs = vec![port("AA:BB", PortTransport::Bluetooth, true)];
    let mut info = cpal_info(Platform::Ios, true);
    apply_session(&mut info, &s);
    assert_eq!(info.route.output_transport, Transport::Bluetooth);
    assert_eq!(info.latency.trust, TrustClass::C);
    assert_eq!(info.latency.usable_output_sec(), None);
}

#[test]
fn a_zero_or_missing_latency_is_not_reported() {
    let mut s = ios_session();
    s.output_latency = None;
    s.input_latency = Some(0.0);
    let mut info = cpal_info(Platform::Ios, true);
    apply_session(&mut info, &s);
    assert_eq!(info.latency.parts.out_device, None);
    assert_eq!(info.latency.parts.in_device, None);
    assert_eq!(info.latency.output_sec, None);
    assert_eq!(info.latency.trust, TrustClass::C);
}

#[test]
fn android_reports_no_latency_so_nothing_is_invented() {
    let s = SessionInfo {
        output_frames_per_buffer: Some(192),
        output_sample_rate: Some(48_000),
        low_latency: true,
        inputs: vec![port("7", PortTransport::BuiltIn, false), port("9", PortTransport::Usb, true)],
        outputs: vec![port("2", PortTransport::Unknown, true)],
        ..SessionInfo::default()
    };
    let mut info = cpal_info(Platform::Android, true);
    info.route.output_transport = Transport::Wired; // an earlier source knew; an unknown word must not erase it
    apply_session(&mut info, &s);
    assert_eq!(info.route.output_transport, Transport::Wired);
    assert_eq!(info.route.input_transport, Some(Transport::Usb));
    assert_eq!(info.route.input_uid.as_deref(), Some("9"));
    assert!(info.route.low_latency_feature);
    assert_eq!(info.session_type, None);
    assert_eq!(info.latency.parts.out_device, None);
    assert_eq!(info.latency.parts.out_stream, None);
    assert_eq!(info.latency.output_sec, None);
    assert_eq!(info.latency.trust, TrustClass::C);
    let facts = RouteTrustFacts { platform: Platform::Android, output_transport: Transport::Wired, input_transport: Some(Transport::Usb), direct_hardware: false, low_latency_feature: true };
    assert_eq!(info.route.trust_facts(), facts);
}

#[test]
fn android_buffer_is_a_whole_number_of_bursts() {
    assert_eq!(android_buffer_frames(256, Some(192)), Some(384));
    assert_eq!(android_buffer_frames(256, Some(240)), Some(480));
    assert_eq!(android_buffer_frames(256, Some(128)), Some(256));
    assert_eq!(android_buffer_frames(256, Some(256)), Some(256));
    assert_eq!(android_buffer_frames(256, None), None);
    assert_eq!(android_buffer_frames(256, Some(0)), None);
    assert_eq!(android_buffer_frames(256, Some(100_000)), None);
}

#[test]
fn ios_buffer_is_five_milliseconds_at_48k() {
    assert_eq!(ios_buffer_frames(), 240);
}

#[test]
fn on_ios_the_default_buffer_is_the_sessions_preference() {
    let log = Arc::new(Mutex::new(Vec::new()));
    let script = Script::new(Arc::clone(&log), ios_session());
    let (sink, _rx) = collecting_sink();
    let mut device = SessionIo::new(Box::new(fake(&log, false)), script, Arc::clone(&sink));
    device.platform = Platform::Ios;
    let host = AudioHost::default();
    host.open_with(Box::new(device), OpenConfig::default(), sink).unwrap();
    assert_eq!(log.lock().unwrap()[1], "open buffer=Some(240)");
    host.close();
}

#[test]
fn an_explicit_buffer_request_is_kept() {
    let log = Arc::new(Mutex::new(Vec::new()));
    let script = Script::new(Arc::clone(&log), ios_session());
    let (sink, _rx) = collecting_sink();
    let mut device = SessionIo::new(Box::new(fake(&log, false)), script, Arc::clone(&sink));
    device.platform = Platform::Ios;
    let host = AudioHost::default();
    host.open_with(Box::new(device), OpenConfig { buffer_frames: Some(64), ..OpenConfig::default() }, sink).unwrap();
    assert_eq!(log.lock().unwrap()[1], "open buffer=Some(64)");
    host.close();
}

#[test]
fn session_events_map_to_interruptions_and_routes() {
    let interrupted = Some(DeviceEvent::Interruption { stream: StreamKind::Output, reason: InterruptionReason::Interrupted });
    assert_eq!(device_event_for(&SessionEvent::InterruptionBegan), interrupted);
    assert_eq!(device_event_for(&SessionEvent::MediaServicesReset), interrupted);
    assert_eq!(device_event_for(&SessionEvent::AudioFocus { state: FocusState::Lost }), interrupted);
    assert_eq!(device_event_for(&SessionEvent::AudioFocus { state: FocusState::Gained }), None);
    assert_eq!(device_event_for(&SessionEvent::InterruptionEnded { should_resume: true }), None);
    assert_eq!(device_event_for(&SessionEvent::RouteChange { reason: "x".into() }), None);
}

#[test]
fn no_session_is_installed_on_a_desktop_host() {
    // Nothing in this test binary installs one, so desktop paths see `None` and keep their own behaviour.
    assert!(session().is_none());
    assert_eq!(permission_state(), None);
    assert_eq!(request_permission(), None);
}

// ---- the wrapper around a device --------------------------------------------------------------------------------

type Handler = Arc<dyn Fn(SessionEvent) + Send + Sync>;

/// A scripted plugin: records the order of calls, answers `info` from a value the test can change.
struct Script {
    log: Arc<Mutex<Vec<String>>>,
    info: Mutex<SessionInfo>,
    configured_with: Mutex<Option<SessionConfig>>,
    handler: Mutex<Option<Handler>>,
}

impl Script {
    fn new(log: Arc<Mutex<Vec<String>>>, info: SessionInfo) -> Arc<Script> {
        Arc::new(Script { log, info: Mutex::new(info), configured_with: Mutex::new(None), handler: Mutex::new(None) })
    }

    fn note(&self, what: &str) {
        self.log.lock().unwrap().push(what.to_string());
    }

    fn send(&self, e: SessionEvent) {
        let h = self.handler.lock().unwrap().clone().expect("no handler registered");
        h(e);
    }
}

impl SessionApi for Script {
    fn permission_state(&self) -> Result<PermissionState, String> {
        Ok(PermissionState::Prompt)
    }
    fn request_permission(&self) -> Result<PermissionState, String> {
        Ok(PermissionState::Granted)
    }
    fn configure(&self, config: SessionConfig) -> Result<SessionInfo, String> {
        self.note("configure");
        *self.configured_with.lock().unwrap() = Some(config);
        Ok(self.info.lock().unwrap().clone())
    }
    fn deactivate(&self) -> Result<(), String> {
        self.note("deactivate");
        Ok(())
    }
    fn info(&self) -> Result<SessionInfo, String> {
        Ok(self.info.lock().unwrap().clone())
    }
    fn watch(&self, handler: Box<dyn Fn(SessionEvent) + Send + Sync>) -> Result<(), String> {
        self.note("watch");
        *self.handler.lock().unwrap() = Some(Arc::from(handler));
        Ok(())
    }
    fn unwatch(&self) -> Result<(), String> {
        self.note("unwatch");
        *self.handler.lock().unwrap() = None;
        Ok(())
    }
}

/// A device that logs when it opens and closes, around a fake one (or a refusal).
struct LogIo {
    inner: Option<FakeIo>,
    log: Arc<Mutex<Vec<String>>>,
}

impl DeviceIo for LogIo {
    fn open(&mut self, cfg: OpenConfig, make_engine: EngineFactory, events: Sender<DeviceEvent>) -> Result<OpenInfo, DeviceError> {
        self.log.lock().unwrap().push(format!("open buffer={:?}", cfg.buffer_frames));
        match self.inner.as_mut() {
            Some(d) => d.open(cfg, make_engine, events),
            None => Err(DeviceError::NoOutputDevice),
        }
    }
    fn close(&mut self) {
        self.log.lock().unwrap().push("close".into());
        if let Some(d) = self.inner.as_mut() {
            d.close();
        }
    }
    fn route(&self) -> RouteFacts {
        self.inner.as_ref().unwrap().route()
    }
    fn latency(&self) -> LatencyParts {
        self.inner.as_ref().unwrap().latency()
    }
    fn set_input(&mut self, enabled: bool) -> Result<OpenInfo, DeviceError> {
        self.inner.as_mut().unwrap().set_input(enabled)
    }
}

fn fake(log: &Arc<Mutex<Vec<String>>>, duplex: bool) -> LogIo {
    LogIo { inner: Some(FakeIo::new(FakeConfig { duplex, ..FakeConfig::default() })), log: Arc::clone(log) }
}

fn collecting_sink() -> (EventSink, Receiver<AudioEvent>) {
    let (tx, rx) = mpsc::channel();
    let tx = Mutex::new(tx);
    (Arc::new(move |e| {
        let _ = tx.lock().unwrap().send(e);
    }), rx)
}

fn wait_for<T>(rx: &Receiver<AudioEvent>, mut pick: impl FnMut(AudioEvent) -> Option<T>) -> T {
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    loop {
        let left = deadline.saturating_duration_since(std::time::Instant::now());
        match rx.recv_timeout(left) {
            Ok(e) => {
                if let Some(v) = pick(e) {
                    return v;
                }
            }
            Err(_) => panic!("event did not arrive"),
        }
    }
}

#[test]
fn open_configures_first_fills_the_facts_and_close_deactivates_last() {
    let log = Arc::new(Mutex::new(Vec::new()));
    let script = Script::new(Arc::clone(&log), ios_session());
    let (sink, _rx) = collecting_sink();
    let device = SessionIo::new(Box::new(fake(&log, false)), script.clone(), Arc::clone(&sink));
    let host = AudioHost::default();
    let info = host.open_with(Box::new(device), OpenConfig::default(), sink).unwrap();

    assert_eq!(*script.configured_with.lock().unwrap(), Some(SessionConfig::default()));
    assert_eq!(info.session_type.as_deref(), Some("play-and-record"));
    assert_eq!(info.route.output_uid, "Speaker");
    assert_eq!(info.route.output_transport, "built-in");
    assert_eq!(info.latency.parts.out_device, Some(0.0042));
    assert_eq!(info.latency.parts.out_buffer, Some(0.005));
    assert_eq!(info.latency.output_sec.map(|s| (s * 1e6).round()), Some(9_200.0));
    // The fake device is the Linux platform, so trust follows that platform's rule, not iOS's: only the source of
    // the numbers is under test here.

    host.close();
    let calls = log.lock().unwrap().clone();
    assert_eq!(calls, ["configure", "open buffer=None", "watch", "unwatch", "close", "deactivate"], "{calls:?}");
}

#[test]
fn a_failed_open_gives_the_session_back() {
    let log = Arc::new(Mutex::new(Vec::new()));
    let script = Script::new(Arc::clone(&log), ios_session());
    let (sink, _rx) = collecting_sink();
    let device = SessionIo::new(Box::new(LogIo { inner: None, log: Arc::clone(&log) }), script, Arc::clone(&sink));
    let host = AudioHost::default();
    let err = host.open_with(Box::new(device), OpenConfig::default(), sink).unwrap_err();
    assert_eq!(err, DeviceError::NoOutputDevice);
    let calls = log.lock().unwrap().clone();
    assert_eq!(calls, ["configure", "open buffer=None", "deactivate"], "{calls:?}");
}

#[test]
fn interruptions_reach_the_app_as_interruption_events() {
    let log = Arc::new(Mutex::new(Vec::new()));
    let script = Script::new(Arc::clone(&log), ios_session());
    let (sink, rx) = collecting_sink();
    let device = SessionIo::new(Box::new(fake(&log, false)), script.clone(), Arc::clone(&sink));
    let host = AudioHost::default();
    host.open_with(Box::new(device), OpenConfig::default(), sink).unwrap();

    script.send(SessionEvent::InterruptionBegan);
    wait_for(&rx, |e| matches!(e, AudioEvent::Interruption { reason: InterruptionJson::Interrupted }).then_some(()));
    script.send(SessionEvent::MediaServicesReset);
    wait_for(&rx, |e| matches!(e, AudioEvent::Interruption { reason: InterruptionJson::Interrupted }).then_some(()));
    host.close();
}

#[test]
fn a_route_change_reads_the_session_again_and_emits_a_route_event() {
    let log = Arc::new(Mutex::new(Vec::new()));
    let script = Script::new(Arc::clone(&log), ios_session());
    let (sink, rx) = collecting_sink();
    let device = SessionIo::new(Box::new(fake(&log, false)), script.clone(), Arc::clone(&sink));
    let host = AudioHost::default();
    host.open_with(Box::new(device), OpenConfig::default(), sink).unwrap();

    // Headphones are plugged in: new port, new latency.
    {
        let mut s = script.info.lock().unwrap();
        s.outputs = vec![port("Headphones", PortTransport::Wired, true)];
        s.output_latency = Some(0.0011);
    }
    script.send(SessionEvent::RouteChange { reason: "new-device-available".into() });
    let (route, latency, rate) = wait_for(&rx, |e| match e {
        AudioEvent::Route { route, latency, engine_rate } => Some((route, latency, engine_rate)),
        _ => None,
    });
    assert_eq!(route.output_uid, "Headphones");
    assert_eq!(route.output_transport, "wired");
    assert_eq!(latency.parts.out_device, Some(0.0011));
    assert_eq!(rate, 48_000);
    host.close();
    // After close a late event changes nothing and sends nothing.
    assert!(script.handler.lock().unwrap().is_none());
}

#[test]
fn switching_the_input_reads_the_session_again() {
    let log = Arc::new(Mutex::new(Vec::new()));
    let script = Script::new(Arc::clone(&log), ios_session());
    let (sink, _rx) = collecting_sink();
    let device = SessionIo::new(Box::new(fake(&log, true)), script, Arc::clone(&sink));
    let host = AudioHost::default();
    let info = host.open_with(Box::new(device), OpenConfig::default(), sink).unwrap();
    assert_eq!(info.route.input_uid, "");
    assert_eq!(info.latency.parts.in_device, None);
    let with_input = host.set_input(true).unwrap();
    assert_eq!(with_input.route.input_uid, "Built-In Microphone");
    assert_eq!(with_input.latency.parts.in_device, Some(0.0031));
    let without = host.set_input(false).unwrap();
    assert_eq!(without.latency.parts.in_device, None);
    host.close();
}

#[test]
fn on_android_the_default_buffer_follows_the_burst() {
    let log = Arc::new(Mutex::new(Vec::new()));
    let script = Script::new(Arc::clone(&log), SessionInfo { output_frames_per_buffer: Some(192), ..SessionInfo::default() });
    let (sink, _rx) = collecting_sink();
    let mut device = SessionIo::new(Box::new(fake(&log, false)), script, Arc::clone(&sink));
    device.platform = Platform::Android;
    let host = AudioHost::default();
    host.open_with(Box::new(device), OpenConfig::default(), sink).unwrap();
    assert_eq!(log.lock().unwrap()[1], "open buffer=Some(384)");
    host.close();
}
