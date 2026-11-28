use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use sr_audio_core::mixer::RejectReason;
use sr_audio_core::wire;
use sr_audio_core::Notification;
use sr_audio_device::fake_io::{FakeConfig, FakeIo};
use sr_audio_device::{DeviceEvent, InterruptionReason, OpenConfig, StreamKind};

use super::*;

fn js<T: Serialize>(v: &T) -> Value {
    serde_json::to_value(v).unwrap()
}

fn parse<T: for<'de> Deserialize<'de>>(s: &str) -> T {
    serde_json::from_str(s).unwrap()
}

// ---- JSON shapes ------------------------------------------------------------------------------------------------

#[test]
fn voice_spec_parses_the_design_shape() {
    let v: VoiceSpecJson = parse(
        r#"{"id":3,"buffer":1,"t":0.5,"gain":0.8,"rate":1.5,"offsetSec":0.1,"loop":[0.1,0.9],"env":[[0.5,0.0],[0.6,1.0]],"stopAt":2.0}"#,
    );
    assert_eq!(v.id, 3);
    assert_eq!(v.loop_sec, Some((0.1, 0.9)));
    assert_eq!(v.env, Some(vec![(0.5, 0.0), (0.6, 1.0)]));
    assert_eq!((v.rate, v.offset_sec, v.stop_at), (Some(1.5), Some(0.1), Some(2.0)));
    let core = CoreVoiceSpec::from(&v);
    assert_eq!((core.rate, core.offset_sec, core.gain), (1.5, 0.1, 0.8));
    assert_eq!(core.env, vec![(0.5, 0.0), (0.6, 1.0)]);
}

#[test]
fn voice_spec_minimal_defaults() {
    let v: VoiceSpecJson = parse(r#"{"id":1,"buffer":2,"t":1}"#);
    let core = CoreVoiceSpec::from(&v);
    assert_eq!((core.gain, core.rate, core.offset_sec), (1.0, 1.0, 0.0));
    assert!(core.loop_sec.is_none() && core.env.is_empty() && core.stop_at.is_none());
}

#[test]
fn command_arguments_parse() {
    assert_eq!(parse::<GroupName>("\"take\""), GroupName::Take);
    assert_eq!(parse::<GroupName>("\"sounds\""), GroupName::Sounds);
    assert_eq!(parse::<OutputMode>("\"bluetooth\""), OutputMode::Bluetooth);
    assert!(serde_json::from_str::<GroupName>("\"other\"").is_err());
}

#[test]
fn events_serialize_to_the_design_literals() {
    let anchor = ClockAnchorJson { engine_sec: 1.5, host_ms: 1000.25, rate: 1.0 };
    let cases: Vec<(AudioEvent, Value)> = vec![
        (AudioEvent::Clock { anchor }, json!({"type":"clock","anchor":{"engineSec":1.5,"hostMs":1000.25,"rate":1.0}})),
        (AudioEvent::Interruption { reason: InterruptionJson::DeviceChange }, json!({"type":"interruption","reason":"device-change"})),
        (AudioEvent::Interruption { reason: InterruptionJson::TrackEnded }, json!({"type":"interruption","reason":"track-ended"})),
        (AudioEvent::Ended { ids: vec![1, 2] }, json!({"type":"ended","ids":[1,2]})),
        (AudioEvent::Late { ids: vec![9] }, json!({"type":"late","ids":[9]})),
        (AudioEvent::Xrun { stream: StreamName::Output, count: 3 }, json!({"type":"xrun","stream":"output","count":3})),
    ];
    for (event, literal) in cases {
        assert_eq!(js(&event), literal);
        let back: AudioEvent = serde_json::from_value(literal).unwrap();
        assert_eq!(back, event);
    }
}

#[test]
fn route_event_shape() {
    let route = RouteJson {
        input_uid: String::new(),
        output_uid: "fake:output".into(),
        input_transport: "unknown".into(),
        output_transport: "built-in".into(),
        processing: ProcessingJson { echo_cancellation: None, noise_suppression: Some(true), auto_gain_control: None },
    };
    let latency = LatencyReportJson { output_sec: None, input_sec: None, trust: 'C', parts: LatencyParts::default().into() };
    let v = js(&AudioEvent::Route { route, latency, engine_rate: 48_000 });
    assert_eq!(v["type"], "route");
    assert_eq!(v["engineRate"], 48_000);
    assert_eq!(v["route"]["outputTransport"], "built-in");
    assert_eq!(v["route"]["processing"], json!({"echoCancellation":null,"noiseSuppression":true,"autoGainControl":null}));
    assert_eq!(v["latency"]["trust"], "C");
    assert_eq!(v["latency"]["parts"]["outBuffer"], Value::Null);
}

#[test]
fn replies_have_the_design_keys() {
    assert_eq!(js(&ClockSync { engine_sec: 2.0, host_ms: 5.0 }), json!({"engineSec":2.0,"hostMs":5.0}));
    assert_eq!(js(&ScheduleReply { late: vec![4] }), json!({"late":[4]}));
    assert_eq!(
        js(&ClockCheck { error: Some(1e-5), consistent: true, frames_per_sec: Some(48000.5), expected: 48000.0, input_drift_ppm: None }),
        json!({"error":1e-5,"consistent":true,"framesPerSec":48000.5,"expected":48000.0,"inputDriftPpm":null})
    );
}

#[test]
fn open_info_has_the_design_keys() {
    let host = AudioHost::default();
    let (sink, _rx) = collecting_sink();
    let info = host.open_with(Box::new(FakeIo::new(FakeConfig::default())), OpenConfig::default(), sink).unwrap();
    let v = js(&info);
    for key in ["engineRate", "outFrames", "inFrames", "inputRate", "route", "latency", "clock", "sessionType"] {
        assert!(v.get(key).is_some(), "missing {key} in {v}");
    }
    assert_eq!(v["engineRate"], 48_000);
    assert_eq!(v["outFrames"], 256);
    assert_eq!(v["inFrames"], Value::Null);
    assert_eq!(v["inputRate"], Value::Null);
    assert_eq!(v["route"]["inputUid"], "");
    assert_eq!(v["route"]["inputTransport"], "unknown");
    assert_eq!(v["latency"]["parts"]["outBuffer"].as_f64().unwrap(), 256.0 / 48_000.0);
    assert_eq!(v["latency"]["outputSec"], Value::Null);
    assert!(v["clock"]["engineSec"].is_number() && v["clock"]["hostMs"].is_number() && v["clock"]["rate"].is_number());
    host.close();
}

#[test]
fn build_script_and_capability_list_every_command() {
    let build = include_str!("../../build.rs");
    let cap: Value = serde_json::from_str(include_str!("../../capabilities/default.json")).unwrap();
    let granted: Vec<&str> = cap["permissions"].as_array().unwrap().iter().filter_map(Value::as_str).collect();
    for c in COMMANDS.iter().chain(["app_info"].iter()) {
        assert!(build.contains(&format!("\"{c}\"")), "{c} missing from build.rs");
        let perm = format!("allow-{}", c.replace('_', "-"));
        assert!(granted.contains(&perm.as_str()), "{perm} missing from capabilities/default.json");
    }
}

// ---- notification mapping ---------------------------------------------------------------------------------------

#[test]
fn notifications_map_to_events() {
    let (tx, rx) = mpsc::channel();
    tx.send(DeviceEvent::Xrun(StreamKind::Output)).unwrap();
    tx.send(DeviceEvent::Xrun(StreamKind::Output)).unwrap();
    tx.send(DeviceEvent::Interruption(InterruptionReason::Interrupted)).unwrap();
    let anchor_a = ClockAnchor { engine_sec: 1.0, host_ms: 10.0, rate: 1.0 };
    let anchor_b = ClockAnchor { engine_sec: 2.0, host_ms: 20.0, rate: 1.0 };
    let notes = [
        Notification::Ended { id: 1 },
        Notification::Late { id: 2, late_frames: 10 },
        Notification::Rejected { id: 3, reason: RejectReason::SoundingFull },
        Notification::Clock(anchor_a),
        Notification::Clipped { frames: 4, at_frame: 0 },
        Notification::Clock(anchor_b),
    ];
    let events = events_from(&notes, &rx);
    assert_eq!(
        events,
        vec![
            AudioEvent::Interruption { reason: InterruptionJson::Interrupted },
            AudioEvent::Late { ids: vec![2] },
            AudioEvent::Ended { ids: vec![1, 3] },
            AudioEvent::Xrun { stream: StreamName::Output, count: 2 },
            AudioEvent::Clock { anchor: anchor_b.into() },
        ]
    );
}

// ---- the host on the fake device --------------------------------------------------------------------------------

fn collecting_sink() -> (EventSink, mpsc::Receiver<AudioEvent>) {
    let (tx, rx) = mpsc::channel();
    let tx = Mutex::new(tx);
    (Arc::new(move |e| drop(tx.lock().unwrap().send(e))), rx)
}

fn wait_for<T>(rx: &mpsc::Receiver<AudioEvent>, timeout: Duration, mut pick: impl FnMut(&AudioEvent) -> Option<T>) -> Option<T> {
    let deadline = Instant::now() + timeout;
    while let Some(left) = deadline.checked_duration_since(Instant::now()) {
        if let Ok(e) = rx.recv_timeout(left) {
            if let Some(v) = pick(&e) {
                return Some(v);
            }
        }
    }
    None
}

fn open_fake(host: &AudioHost) -> (OpenInfoJson, mpsc::Receiver<AudioEvent>) {
    let (sink, rx) = collecting_sink();
    let info = host.open_with(Box::new(FakeIo::new(FakeConfig::default())), OpenConfig::default(), sink).unwrap();
    (info, rx)
}

fn put_click(host: &AudioHost, id: u32) {
    let mut samples = vec![0.0f32; 480];
    samples[0] = 1.0;
    host.put_buffer(&wire::encode_put_buffer(id, 48_000, &samples)).unwrap();
}

#[test]
fn schedule_plays_and_reports_ended_and_clock_events() {
    let host = AudioHost::default();
    let (_info, rx) = open_fake(&host);
    put_click(&host, 5);
    let now = host.clock_sync().unwrap();
    let t = now.engine_sec + 0.2;
    let reply = host.schedule(GroupName::Sounds, &[parse(&format!(r#"{{"id":11,"buffer":5,"t":{t},"gain":0.5}}"#))]).unwrap();
    assert!(reply.late.is_empty());
    let mut clocks = 0;
    let mut ended = false;
    wait_for(&rx, Duration::from_secs(5), |e| {
        match e {
            AudioEvent::Clock { .. } => clocks += 1,
            AudioEvent::Ended { ids } if ids == &[11] => ended = true,
            _ => {}
        }
        ended.then_some(())
    })
    .expect("ended event for voice 11");
    assert!(clocks >= 1, "clock events arrive about every 250 ms and the voice only ends after 200 ms");
    host.close();
}

#[test]
fn late_voice_is_returned_and_event_follows() {
    let host = AudioHost::default();
    let (_info, rx) = open_fake(&host);
    put_click(&host, 5);
    std::thread::sleep(Duration::from_millis(100));
    let reply = host.schedule(GroupName::Take, &[parse(r#"{"id":12,"buffer":5,"t":0.0}"#)]).unwrap();
    assert_eq!(reply.late, vec![12]);
    let mut late_event = false;
    wait_for(&rx, Duration::from_secs(3), |e| {
        if matches!(e, AudioEvent::Late { ids } if ids == &[12]) {
            late_event = true;
        }
        matches!(e, AudioEvent::Ended { ids } if ids == &[12]).then_some(())
    })
    .expect("ended");
    // `Late` is sent when the audio thread takes the voice, before it can end.
    assert!(late_event);
    host.close();
}

#[test]
fn stop_and_cancel_end_voices() {
    let host = AudioHost::default();
    let (_info, rx) = open_fake(&host);
    host.put_buffer(&wire::encode_put_buffer(1, 48_000, &vec![0.1f32; 48_000 * 10])).unwrap();
    let t = host.clock_sync().unwrap().engine_sec + 0.05;
    host.schedule(GroupName::Take, &[parse(&format!(r#"{{"id":1,"buffer":1,"t":{t}}}"#)), parse(&format!(r#"{{"id":2,"buffer":1,"t":{t}}}"#))]).unwrap();
    host.schedule(GroupName::Sounds, &[parse(&format!(r#"{{"id":3,"buffer":1,"t":{t}}}"#))]).unwrap();
    std::thread::sleep(Duration::from_millis(150));
    host.stop_voices(&[1], 0.01).unwrap();
    host.cancel(GroupName::Sounds, 0.0).unwrap();
    let mut seen = Vec::new();
    wait_for(&rx, Duration::from_secs(3), |e| {
        if let AudioEvent::Ended { ids } = e {
            seen.extend(ids.iter().copied());
        }
        (seen.len() >= 2).then_some(())
    })
    .expect("two voices end");
    seen.sort_unstable();
    assert_eq!(seen, vec![1, 3], "voice 2 (take group) keeps playing");
    host.cancel(GroupName::Take, 0.0).unwrap();
    host.close();
}

#[test]
fn errors_are_clear() {
    let host = AudioHost::default();
    let closed = host.schedule(GroupName::Take, &[]).unwrap_err();
    assert!(closed.contains("audio_open"), "{closed}");
    assert!(host.clock_sync().is_err() && host.put_buffer(&[]).is_err());
    let (_info, _rx) = open_fake(&host);
    let err = host.schedule(GroupName::Take, &[parse(r#"{"id":1,"buffer":99,"t":1.0}"#)]).unwrap_err();
    assert!(err.contains("no buffer 99"), "{err}");
    assert!(host.put_buffer(b"nope").is_err());
    host.close();
    host.close(); // idempotent
    assert!(host.cancel(GroupName::Take, 0.0).is_err());
}

#[test]
fn clock_sync_is_monotonic_and_tracks_the_host_clock() {
    let host = AudioHost::default();
    let (info, _rx) = open_fake(&host);
    let a = host.clock_sync().unwrap();
    std::thread::sleep(Duration::from_millis(300));
    let b = host.clock_sync().unwrap();
    assert!(b.host_ms > a.host_ms && b.engine_sec > a.engine_sec);
    let ratio = (b.engine_sec - a.engine_sec) / ((b.host_ms - a.host_ms) / 1000.0);
    assert!((ratio - 1.0).abs() < 0.01, "engine seconds per host second {ratio}");
    assert!((info.clock.rate - 1.0).abs() < 0.01);
    let check = host.clock_check(1.0).unwrap();
    assert_eq!(check.expected, 48_000.0);
    assert_eq!(check.input_drift_ppm, None);
    host.close();
}

#[test]
fn reopening_replaces_the_session() {
    let host = AudioHost::default();
    let (_a, _rx_a) = open_fake(&host);
    put_click(&host, 1);
    let (_b, rx_b) = open_fake(&host);
    // The buffers belonged to the old engine.
    assert!(host.schedule(GroupName::Take, &[parse(r#"{"id":1,"buffer":1,"t":9.0}"#)]).is_err());
    assert!(wait_for(&rx_b, Duration::from_secs(2), |e| matches!(e, AudioEvent::Clock { .. }).then_some(())).is_some());
    host.close();
}

#[test]
fn env_selects_the_fake_device() {
    static ENV: Mutex<()> = Mutex::new(());
    let _g = ENV.lock().unwrap();
    std::env::set_var("SR_AUDIO_DEVICE", "fake");
    let host = AudioHost::default();
    let (sink, _rx) = collecting_sink();
    let info = open_selected(&host, OpenConfig::default(), sink).unwrap();
    assert_eq!(info.route.output_uid, "fake:output");
    host.close();
    std::env::remove_var("SR_AUDIO_DEVICE");
}

// ---- decode -----------------------------------------------------------------------------------------------------

fn sound_file() -> Vec<u8> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../public/sounds/flute/A4.mp3");
    std::fs::read(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn request(id: u32, mp3: &[u8]) -> Vec<u8> {
    let mut v = id.to_le_bytes().to_vec();
    v.extend_from_slice(mp3);
    v
}

#[test]
fn decode_request_decodes_a_real_sample() {
    let mp3 = sound_file();
    let (id, buffer, reply) = decode_request(&request(77, &mp3)).unwrap();
    assert_eq!(id, 77);
    assert!(matches!(buffer.sample_rate, 22_050 | 24_000 | 32_000 | 44_100 | 48_000), "rate {}", buffer.sample_rate);
    assert!(buffer.samples.len() > buffer.sample_rate as usize / 10, "{} frames", buffer.samples.len());
    assert!(buffer.samples.iter().all(|s| s.is_finite() && s.abs() <= 1.5));
    assert!(buffer.samples.iter().any(|s| s.abs() > 0.01), "not silent");
    // Reply layout: u32 rate, u32 frames, f32 samples.
    assert_eq!(u32::from_le_bytes(reply[0..4].try_into().unwrap()), buffer.sample_rate);
    assert_eq!(u32::from_le_bytes(reply[4..8].try_into().unwrap()) as usize, buffer.samples.len());
    assert_eq!(reply.len(), 8 + 4 * buffer.samples.len());
    assert_eq!(f32::from_le_bytes(reply[8..12].try_into().unwrap()), buffer.samples[0]);
}

#[test]
fn decoded_buffer_is_kept_under_its_id_and_playable() {
    let host = AudioHost::default();
    let (_info, rx) = open_fake(&host);
    let (id, buffer, _reply) = decode_request(&request(8, &sound_file())).unwrap();
    host.store_decoded(id, buffer).unwrap();
    let t = host.clock_sync().unwrap().engine_sec + 0.1;
    host.schedule(GroupName::Sounds, &[parse(&format!(r#"{{"id":1,"buffer":8,"t":{t},"gain":0.2,"stopAt":{}}}"#, t + 0.05))]).unwrap();
    wait_for(&rx, Duration::from_secs(3), |e| matches!(e, AudioEvent::Ended { ids } if ids == &[1]).then_some(())).expect("ended");
    host.drop_buffers(&[8]).unwrap();
    assert!(host.schedule(GroupName::Sounds, &[parse(r#"{"id":2,"buffer":8,"t":5.0}"#)]).is_err());
    host.close();
}

#[test]
fn decode_request_rejects_garbage() {
    assert!(decode_request(&[1, 2]).is_err());
    let err = decode_request(&request(1, b"this is not an mp3 file at all, just text")).unwrap_err();
    assert!(err.starts_with("audio_decode:"), "{err}");
}
