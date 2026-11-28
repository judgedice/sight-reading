//! Output on a real cpal device. Runs only with `SR_TEST_REAL_AUDIO=1` (see tools/native/audio-null-sink.sh,
//! which sets up a PulseAudio null sink on a machine without a sound card); otherwise it prints a note and passes.

use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use sr_audio_core::mixer::{AudioBuffer, Group, VoiceSpec};
use sr_audio_core::{engine, EngineConfig, EngineHandle, Notification};
use sr_audio_device::cpal_io::CpalIo;
use sr_audio_device::{DeviceIo, OpenConfig};

#[test]
fn cpal_output_runs_the_engine() {
    if std::env::var("SR_TEST_REAL_AUDIO").as_deref() != Ok("1") {
        eprintln!("note: SR_TEST_REAL_AUDIO is not 1; skipping the real cpal output test");
        return;
    }
    let slot: Arc<Mutex<Option<EngineHandle>>> = Arc::new(Mutex::new(None));
    let slot2 = Arc::clone(&slot);
    let (tx, _rx) = mpsc::channel();
    let mut io = CpalIo::new();
    let info = io
        .open(
            OpenConfig::default(),
            Box::new(move |rate| {
                let (e, h) = engine(EngineConfig::new(rate));
                *slot2.lock().unwrap() = Some(h);
                e
            }),
            tx,
        )
        .expect("open the default cpal output device");
    eprintln!("opened: {info:?}");
    assert!(info.engine_rate >= 8_000);
    let mut h = slot.lock().unwrap().take().unwrap();
    let reader = h.clock();

    let deadline = Instant::now() + Duration::from_secs(5);
    while reader.frames_rendered() < info.engine_rate as u64 / 2 && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    let rendered = reader.frames_rendered();
    assert!(rendered >= info.engine_rate as u64 / 2, "the device callback is not running: {rendered} frames");

    let mut samples = vec![0.0f32; 4800];
    samples[0] = 0.1;
    h.put_buffer(1, AudioBuffer::new(samples, info.engine_rate));
    let t = reader.frames_rendered() as f64 / info.engine_rate as f64 + 0.2;
    h.schedule(Group::Sounds, &[VoiceSpec::new(1, 1, t)]).unwrap();
    let mut notes = Vec::new();
    let end = Instant::now() + Duration::from_secs(5);
    let mut ended = false;
    while Instant::now() < end && !ended {
        h.poll(&mut notes);
        ended = notes.iter().any(|n| matches!(n, Notification::Ended { id: 1 }));
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(ended, "voice did not end: {notes:?}");
    let check = h.rate_check(1.0);
    eprintln!("rate check: {check:?}");
    io.close();
}
