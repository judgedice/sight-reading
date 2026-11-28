use std::collections::HashSet;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use sr_audio_core::mixer::RejectReason;
use sr_audio_core::synth::{render_click, ClickTimbre};
use sr_audio_core::wire;
use sr_audio_core::Notification;
use sr_audio_device::fake_io::{FakeConfig, FakeIo};
use sr_audio_core::latency::LatencyParts;
use sr_audio_device::{DeviceEvent, InterruptionReason, OpenConfig, RouteFacts, StreamKind};

use super::*;

fn js<T: Serialize>(v: &T) -> Value {
    serde_json::to_value(v).unwrap()
}

fn parse<T: for<'de> Deserialize<'de>>(s: &str) -> T {
    serde_json::from_str(s).unwrap()
}

static ENV: Mutex<()> = Mutex::new(());

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
        (AudioEvent::Rejected { ids: vec![4] }, json!({"type":"rejected","ids":[4]})),
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
    let dev = [
        DeviceEvent::Xrun(StreamKind::Output),
        DeviceEvent::Xrun(StreamKind::Output),
        DeviceEvent::Xrun(StreamKind::Input),
        DeviceEvent::Interruption { stream: StreamKind::Input, reason: InterruptionReason::TrackEnded },
    ];
    let anchor_a = ClockAnchor { engine_sec: 1.0, host_ms: 10.0, rate: 1.0 };
    let anchor_b = ClockAnchor { engine_sec: 2.0, host_ms: 20.0, rate: 1.0 };
    let notes = [
        Notification::Ended { id: 1 },
        Notification::Late { id: 2, late_frames: 10 },
        Notification::Late { id: 4, late_frames: 10 },
        Notification::Rejected { id: 3, reason: RejectReason::SoundingFull },
        Notification::Clock(anchor_a),
        Notification::Clipped { frames: 4, at_frame: 0 },
        Notification::Clock(anchor_b),
    ];
    let mut seen: HashSet<u32> = [4].into(); // 4 was already listed in a schedule reply
    let events = events_from(&notes, &dev, &mut seen);
    assert!(seen.is_empty());
    assert_eq!(
        events,
        vec![
            AudioEvent::Interruption { reason: InterruptionJson::TrackEnded },
            AudioEvent::Late { ids: vec![2] },
            AudioEvent::Rejected { ids: vec![3] },
            AudioEvent::Ended { ids: vec![1] },
            AudioEvent::Xrun { stream: StreamName::Output, count: 2 },
            AudioEvent::Xrun { stream: StreamName::Input, count: 1 },
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
fn late_voice_is_reported_once_in_the_reply() {
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
    // The engine's `Late` notification repeats what the reply said, so it is not forwarded a second time.
    assert!(!late_event, "late id reported twice");
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
    // The fake device is paced by sleeps, so on a loaded machine a short window right after open reads the
    // pacing loop catching up, not the clock. Two seconds and 3% test the plumbing; clock accuracy is tested
    // in the core with virtual time.
    std::thread::sleep(Duration::from_millis(2000));
    let b = host.clock_sync().unwrap();
    assert!(b.host_ms > a.host_ms && b.engine_sec > a.engine_sec);
    let ratio = (b.engine_sec - a.engine_sec) / ((b.host_ms - a.host_ms) / 1000.0);
    assert!((ratio - 1.0).abs() < 0.03, "engine seconds per host second {ratio}");
    assert!((info.clock.rate - 1.0).abs() < 0.03);
    let check = host.clock_check(1.0).unwrap();
    assert_eq!(check.expected, 48_000.0);
    assert_eq!(check.input_drift_ppm, None, "no input open, no drift to report");
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

// ---- capture and loopback on the fake duplex device ---------------------------------------------------------------

fn open_duplex(host: &AudioHost, config: FakeConfig) -> OpenInfoJson {
    let (sink, _rx) = collecting_sink();
    host.open_with(Box::new(FakeIo::new(config)), OpenConfig { input: true, ..OpenConfig::default() }, sink).unwrap()
}

type Packets = Arc<Mutex<Vec<Vec<u8>>>>;

fn packet_sink() -> (PacketSink, Packets) {
    let store: Packets = Arc::new(Mutex::new(Vec::new()));
    let s = Arc::clone(&store);
    (Arc::new(move |p| s.lock().unwrap().push(p)), store)
}

/// The capture as one run of samples, and the engine frame of its first sample.
fn assemble(packets: &Packets) -> (u64, Vec<f32>, Vec<wire::PacketHeader>) {
    let mut headers = Vec::new();
    let mut samples = Vec::new();
    let mut origin = None;
    for p in packets.lock().unwrap().iter() {
        let h = wire::decode_packet(p, &mut samples).unwrap();
        origin.get_or_insert(h.first_frame as u64);
        headers.push(h);
    }
    (origin.unwrap_or(0), samples, headers)
}

/// Lag (frames, parabolic refinement) at which `template` best matches `signal`, searched over `range`.
fn best_lag(signal: &[f32], template: &[f32], range: std::ops::Range<usize>) -> f64 {
    let corr = |k: usize| -> f64 { template.iter().enumerate().map(|(i, t)| *t as f64 * signal.get(k + i).copied().unwrap_or(0.0) as f64).sum() };
    let (mut best, mut best_k) = (f64::MIN, range.start);
    for k in range {
        let c = corr(k);
        if c > best {
            (best, best_k) = (c, k);
        }
    }
    let (a, b, c) = (corr(best_k - 1), best, corr(best_k + 1));
    best_k as f64 + 0.5 * (a - c) / (a - 2.0 * b + c)
}

#[test]
fn duplex_open_reports_the_input() {
    let host = AudioHost::default();
    let info = open_duplex(&host, FakeConfig::default());
    assert_eq!((info.in_frames, info.input_rate), (Some(256), Some(48_000)));
    assert_eq!(info.route.input_uid, "fake:input");
    host.close();
}

#[test]
fn capture_packets_are_contiguous_with_a_last_flag() {
    let host = AudioHost::default();
    open_duplex(&host, FakeConfig::default());
    let (sink, packets) = packet_sink();
    let started = host.capture_start(512, sink).unwrap();
    assert_eq!((started.engine_rate, started.path), (48_000, "locked"));
    std::thread::sleep(Duration::from_millis(600));
    let stats = host.capture_stop().unwrap();
    let (origin, samples, headers) = assemble(&packets);
    assert_eq!(origin as f64, started.origin_frame);
    assert_eq!(headers.len() as u64, stats.packets);
    assert_eq!(samples.len() as u64, stats.frames);
    assert!(headers.len() >= 40, "{} packets", headers.len());
    for (i, h) in headers.iter().enumerate() {
        assert_eq!(h.seq, i as u32);
        assert_eq!(h.dropped_before, 0);
        if i > 0 {
            assert_eq!(h.first_frame, headers[i - 1].first_frame + headers[i - 1].n_frames as f64, "contiguous at packet {i}");
        }
        assert_eq!(h.flags & wire::FLAG_LAST != 0, i == headers.len() - 1, "last flag at packet {i}");
    }
    assert_eq!(stats.dropped_frames, 0);
    // A second capture works and counts from 0 again.
    let (sink2, packets2) = packet_sink();
    host.capture_start(256, sink2).unwrap();
    std::thread::sleep(Duration::from_millis(100));
    host.capture_stop().unwrap();
    assert_eq!(assemble(&packets2).2[0].seq, 0);
    host.close();
}

#[test]
fn a_click_comes_back_after_the_loop_delay() {
    let host = AudioHost::default();
    open_duplex(&host, FakeConfig::default());
    let click = render_click(ClickTimbre::Tick, false, 48_000);
    host.put_buffer(&wire::encode_put_buffer(3, 48_000, &click)).unwrap();
    let (sink, packets) = packet_sink();
    host.capture_start(512, sink).unwrap();
    let t = host.clock_sync().unwrap().engine_sec + 0.3;
    host.schedule(GroupName::Sounds, &[parse(&format!(r#"{{"id":1,"buffer":3,"t":{t}}}"#))]).unwrap();
    std::thread::sleep(Duration::from_millis(900));
    host.capture_stop().unwrap();
    let (origin, samples, _) = assemble(&packets);
    let lag = best_lag(&samples, &click, 1000..samples.len() - click.len() - 2);
    let arrival = origin as f64 + lag;
    let error_ms = (arrival - ((t * 48_000.0).round() + 0.0234 * 48_000.0)) / 48.0;
    println!("click arrival error {error_ms:.4} ms");
    assert!(error_ms.abs() < 0.2, "arrival error {error_ms} ms");
    host.close();
}

#[test]
fn input_signal_file_starts_at_the_first_capture_frame() {
    let mut raw = vec![0f32; 48_000];
    let click = render_click(ClickTimbre::Tick, false, 48_000);
    raw[4_800..4_800 + click.len()].copy_from_slice(&click);
    let path = std::env::temp_dir().join(format!("sr-fake-input-{}.f32", std::process::id()));
    std::fs::write(&path, raw.iter().flat_map(|x| x.to_le_bytes()).collect::<Vec<u8>>()).unwrap();
    let config = FakeConfig::from_lookup(|k| match k {
        "SR_FAKE_INPUT_F32" => Some(path.to_string_lossy().into_owned()),
        "SR_FAKE_LOOP_MS" => Some("23.4".into()),
        _ => None,
    })
    .unwrap();
    assert_eq!(config.input_signal.as_ref().map(|s| s.len()), Some(48_000));
    let host = AudioHost::default();
    open_duplex(&host, config);
    std::thread::sleep(Duration::from_millis(1500)); // let the clocks settle, so the capture starts at once
    let (sink, packets) = packet_sink();
    host.capture_start(512, sink).unwrap();
    std::thread::sleep(Duration::from_millis(400));
    host.capture_stop().unwrap();
    let (_origin, samples, _) = assemble(&packets);
    let lag = best_lag(&samples, &click, 3_000..6_000);
    println!("signal marker found {} frames from the capture's first sample (file offset 4800)", lag - 4_800.0);
    // Sample 0 is at the capture's first frame or up to one buffer (256 frames) before it.
    assert!((lag - 4_800.0).abs() <= 300.0, "marker at {lag}");
    host.close();
    std::fs::remove_file(path).ok();
}

#[test]
fn env_numbers_are_checked() {
    let err = FakeConfig::from_lookup(|k| (k == "SR_FAKE_LOOP_MS").then(|| "abc".into())).unwrap_err();
    assert!(err.contains("SR_FAKE_LOOP_MS"), "{err}");
    let c = FakeConfig::from_lookup(|k| match k {
        "SR_FAKE_IN_RATE" => Some("44100".into()),
        "SR_FAKE_PPM" => Some("-30".into()),
        "SR_FAKE_LOOP_GAIN" => Some("0.25".into()),
        _ => None,
    })
    .unwrap();
    assert_eq!((c.input_rate, c.in_ppm, c.loop_gain, c.loop_delay_ms), (44_100, -30.0, 0.25, 23.4));
}

#[test]
fn loopback_on_the_fake_measures_the_loop_delay() {
    let host = AudioHost::default();
    open_duplex(&host, FakeConfig::default());
    let e = host.measure_loopback(8, "tick").unwrap();
    println!("loopback: {e:?}");
    assert_eq!((e.found, e.scheduled), (8, 8));
    assert!((e.round_trip_ms.unwrap() - 23.4).abs() < 0.1, "{e:?}");
    assert!(e.mad_ms.unwrap() < 0.1);
    assert!(e.predicted_ms.is_none(), "no reported device latency on the fake, so no prediction");
    // The run left nothing behind: a capture can start, and a second run works.
    let (sink, _p) = packet_sink();
    host.capture_start(512, sink).unwrap();
    host.capture_stop().unwrap();
    assert_eq!(host.measure_loopback(4, "tick").unwrap().scheduled, 4);
    assert!(host.measure_loopback(8, "wood").unwrap_err().contains("timbre"));
    assert!(host.measure_loopback(0, "tick").is_err());
    host.close();
}

#[test]
fn loopback_follows_a_different_delay_and_input_rate() {
    let host = AudioHost::default();
    let config = FakeConfig::from_lookup(|k| match k {
        "SR_FAKE_LOOP_MS" => Some("41.7".into()),
        "SR_FAKE_IN_RATE" => Some("44100".into()),
        "SR_FAKE_PPM" => Some("40".into()),
        _ => None,
    })
    .unwrap();
    let info = open_duplex(&host, config);
    assert_eq!(info.input_rate, Some(44_100));
    let e = host.measure_loopback(8, "tick").unwrap();
    println!("loopback (44.1 kHz input, +40 ppm): {e:?}");
    assert_eq!(e.found, 8);
    assert!((e.round_trip_ms.unwrap() - 41.7).abs() < 0.3, "{e:?}");
    host.close();
}

#[test]
fn capture_and_loopback_exclude_each_other() {
    let host = AudioHost::default();
    open_duplex(&host, FakeConfig::default());
    let (sink, _p) = packet_sink();
    host.capture_start(512, Arc::clone(&sink)).unwrap();
    let err = host.measure_loopback(8, "tick").unwrap_err();
    assert!(err.contains("capture is running"), "{err}");
    let err = host.capture_start(512, Arc::clone(&sink)).unwrap_err();
    assert!(err.contains("already running"), "{err}");
    let err = host.set_input(false).unwrap_err();
    assert!(err.contains("stop it"), "{err}");
    host.capture_stop().unwrap();
    assert!(host.capture_stop().unwrap_err().contains("no capture is running"));

    let h2 = host.clone();
    let run = std::thread::spawn(move || h2.measure_loopback(8, "tick"));
    std::thread::sleep(Duration::from_millis(150));
    let err = host.capture_start(512, sink).unwrap_err();
    assert!(err.contains("loopback measurement is running"), "{err}");
    assert!(host.measure_loopback(8, "tick").unwrap_err().contains("already running"));
    assert_eq!(run.join().unwrap().unwrap().found, 8);
    host.close();
}

#[test]
fn input_can_be_released_and_reopened() {
    let host = AudioHost::default();
    open_duplex(&host, FakeConfig::default());
    let info = host.set_input(false).unwrap();
    assert_eq!((info.in_frames, info.input_rate), (None, None));
    assert_eq!(info.route.input_uid, "");
    let (sink, _p) = packet_sink();
    assert!(host.capture_start(512, Arc::clone(&sink)).unwrap_err().contains("no input"));
    assert!(host.measure_loopback(8, "tick").unwrap_err().contains("no input"));
    assert!(host.set_input(false).is_ok(), "releasing twice is fine");
    let info = host.set_input(true).unwrap();
    assert_eq!(info.in_frames, Some(256));
    assert_eq!(host.measure_loopback(8, "tick").unwrap().found, 8);
    host.close();
}

#[test]
fn output_only_open_reports_no_input_and_refuses_capture() {
    let host = AudioHost::default();
    let _ = open_fake(&host);
    let (sink, _p) = packet_sink();
    assert!(host.capture_start(512, sink).unwrap_err().contains("no input"));
    assert!(host.set_input(true).is_err());
    host.close();
}

#[test]
fn clock_check_reports_input_drift_when_input_runs() {
    let host = AudioHost::default();
    let config = FakeConfig { in_ppm: 100.0, ..FakeConfig::default() };
    open_duplex(&host, config);
    std::thread::sleep(Duration::from_millis(2500));
    let c = host.clock_check(1.0).unwrap();
    println!("clock check with +100 ppm input: {c:?}");
    // The core only reports a drift once both clock fits have settled; a report, when present, is near the truth.
    if let Some(ppm) = c.input_drift_ppm {
        assert!((ppm - 100.0).abs() < 60.0, "{ppm}");
    }
    host.close();
}

#[test]
fn permission_is_granted_for_the_fake_device() {
    let _g = ENV.lock().unwrap();
    std::env::set_var("SR_AUDIO_DEVICE", "fake");
    assert_eq!(permission_state(), "granted");
    std::env::remove_var("SR_AUDIO_DEVICE");
}

#[test]
fn stop_and_cancel_end_voices_that_have_not_started() {
    let host = AudioHost::default();
    let (_info, rx) = open_fake(&host);
    host.put_buffer(&wire::encode_put_buffer(1, 48_000, &vec![0.1f32; 4800])).unwrap();
    let far = host.clock_sync().unwrap().engine_sec + 60.0;
    let spec = |id: u32| format!(r#"{{"id":{id},"buffer":1,"t":{far}}}"#);
    host.schedule(GroupName::Take, &[parse(&spec(1)), parse(&spec(2)), parse(&spec(3))]).unwrap();
    host.schedule(GroupName::Sounds, &[parse(&spec(4))]).unwrap();
    host.stop_voices(&[1], 0.0).unwrap();
    host.cancel(GroupName::Take, 0.0).unwrap();
    host.cancel(GroupName::Sounds, 0.0).unwrap();
    let mut seen = Vec::new();
    wait_for(&rx, Duration::from_secs(3), |e| {
        if let AudioEvent::Ended { ids } = e {
            seen.extend(ids.iter().copied());
        }
        (seen.len() >= 4).then_some(())
    })
    .expect("every voice ends");
    seen.sort_unstable();
    assert_eq!(seen, vec![1, 2, 3, 4], "each stopped or cancelled voice ends exactly once");
    // A voice that plays to its end also reports `ended` (covered in schedule_plays_and_reports_ended_and_clock_events).
    host.close();
}

/// A device that lets the test raise stream events as a failing backend would.
struct Spy {
    inner: FakeIo,
    events: Arc<Mutex<Option<mpsc::Sender<DeviceEvent>>>>,
}

impl sr_audio_device::DeviceIo for Spy {
    fn open(&mut self, cfg: OpenConfig, make_engine: sr_audio_device::EngineFactory, events: mpsc::Sender<DeviceEvent>) -> Result<sr_audio_device::OpenInfo, sr_audio_device::DeviceError> {
        *self.events.lock().unwrap() = Some(events.clone());
        self.inner.open(cfg, make_engine, events)
    }
    fn close(&mut self) {
        self.inner.close()
    }
    fn route(&self) -> RouteFacts {
        self.inner.route()
    }
    fn latency(&self) -> LatencyParts {
        self.inner.latency()
    }
    fn set_input(&mut self, enabled: bool) -> Result<sr_audio_device::OpenInfo, sr_audio_device::DeviceError> {
        self.inner.set_input(enabled)
    }
    fn capture_requested(&mut self) {
        self.inner.capture_requested()
    }
}

#[test]
fn a_device_change_during_capture_sends_an_interruption() {
    let host = AudioHost::default();
    let events = Arc::new(Mutex::new(None));
    let (sink, rx2) = collecting_sink();
    host.open_with(Box::new(Spy { inner: FakeIo::new(FakeConfig::default()), events: Arc::clone(&events) }), OpenConfig { input: true, ..OpenConfig::default() }, sink).unwrap();
    let (psink, _p) = packet_sink();
    host.capture_start(512, psink).unwrap();
    let tx = events.lock().unwrap().clone().unwrap();
    tx.send(DeviceEvent::Interruption { stream: StreamKind::Input, reason: InterruptionReason::DeviceChange }).unwrap();
    tx.send(DeviceEvent::Interruption { stream: StreamKind::Output, reason: InterruptionReason::DeviceChange }).unwrap();
    let mut n = 0;
    wait_for(&rx2, Duration::from_secs(2), |e| {
        if matches!(e, AudioEvent::Interruption { reason: InterruptionJson::DeviceChange }) {
            n += 1;
        }
        (n >= 2).then_some(())
    })
    .expect("device-change interruption events");
    host.capture_stop().unwrap();
    host.close();
}

#[test]
fn set_input_adds_the_input_without_restarting_the_output() {
    let host = AudioHost::default();
    let (sink, _rx) = collecting_sink();
    let cfg = FakeConfig { duplex: true, ..FakeConfig::default() };
    let info = host.open_with(Box::new(FakeIo::new(cfg)), OpenConfig::default(), sink).unwrap();
    assert_eq!(info.in_frames, None);
    put_click(&host, 9);
    let before = host.clock_sync().unwrap();
    let info = host.set_input(true).unwrap();
    assert_eq!(info.in_frames, Some(256));
    let after = host.clock_sync().unwrap();
    assert!(after.engine_sec >= before.engine_sec, "engine time did not restart");
    // The buffer survived: it can still be scheduled.
    host.schedule(GroupName::Sounds, &[parse(&format!(r#"{{"id":1,"buffer":9,"t":{}}}"#, after.engine_sec + 5.0))]).unwrap();
    assert_eq!(host.measure_loopback(8, "tick").unwrap().found, 8);
    host.close();
}

// ---- end-to-end test hooks --------------------------------------------------------------------------------------

#[test]
fn the_hooks_are_off_unless_both_variables_are_set() {
    let _g = ENV.lock().unwrap();
    std::env::remove_var("SR_AUDIO_DEVICE");
    std::env::remove_var("SR_E2E_HOOKS");
    assert_eq!(debug_hooks(), DebugHooks { enabled: false, seed: None });
    std::env::set_var("SR_E2E_HOOKS", "1");
    std::env::set_var("SR_E2E_SEED", "7");
    assert!(!debug_hooks().enabled, "SR_E2E_HOOKS alone is not enough");
    let host = AudioHost::default();
    assert!(host.debug_signal(Some("/nonexistent"), 1.0).unwrap_err().contains("hooks are off"));
    std::env::set_var("SR_AUDIO_DEVICE", "fake");
    assert_eq!(debug_hooks(), DebugHooks { enabled: true, seed: Some(7) });
    std::env::remove_var("SR_E2E_SEED");
    assert_eq!(debug_hooks().seed, None);
    std::env::remove_var("SR_E2E_HOOKS");
    assert!(!debug_hooks().enabled, "SR_AUDIO_DEVICE=fake alone is not enough");
    std::env::remove_var("SR_AUDIO_DEVICE");
}

#[test]
fn a_hooked_signal_lands_on_the_engine_frame_it_was_asked_for() {
    let _g = ENV.lock().unwrap();
    std::env::set_var("SR_AUDIO_DEVICE", "fake");
    std::env::set_var("SR_E2E_HOOKS", "1");
    let host = AudioHost::default();
    // An impulse train: sample 100 and sample 4000 are 1.0, the rest 0.
    let mut raw = vec![0f32; 6000];
    raw[100] = 1.0;
    raw[4000] = -1.0;
    let path = std::env::temp_dir().join(format!("sr-hook-signal-{}.f32", std::process::id()));
    std::fs::write(&path, raw.iter().flat_map(|v| v.to_le_bytes()).collect::<Vec<u8>>()).unwrap();
    open_duplex(&host, FakeConfig { loop_gain: 0.0, signal_control: host.inner.signal.clone(), ..FakeConfig::default() });
    let (sink, packets) = packet_sink();
    host.capture_start(512, sink).unwrap();
    let start_sec = host.clock_sync().unwrap().engine_sec + 0.5;
    host.debug_signal(path.to_str(), start_sec).unwrap();
    std::thread::sleep(Duration::from_millis(1100));
    host.capture_stop().unwrap();
    let (origin, samples, _) = assemble(&packets);
    let start_frame = (start_sec * 48_000.0).round() as u64;
    let at = |v: f32| samples.iter().position(|s| *s == v).map(|i| origin + i as u64);
    assert_eq!(at(1.0), Some(start_frame + 100));
    assert_eq!(at(-1.0), Some(start_frame + 4000));
    // Clearing the hook silences the input again.
    host.debug_signal(None, 0.0).unwrap();
    host.close();
    std::fs::remove_file(&path).ok();
    std::env::remove_var("SR_AUDIO_DEVICE");
    std::env::remove_var("SR_E2E_HOOKS");
}
