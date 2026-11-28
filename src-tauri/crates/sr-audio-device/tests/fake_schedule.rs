//! The whole output path on the fake device: put an impulse buffer, schedule it 200 ms ahead, and read the
//! recorded output to see which frame it landed on. No sound card involved.
#![cfg(feature = "fake")]

use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use sr_audio_core::mixer::{AudioBuffer, Group, VoiceSpec};
use sr_audio_core::{engine, EngineConfig, EngineHandle, Notification};
use sr_audio_device::fake_io::{FakeConfig, FakeIo};
use sr_audio_device::{DeviceEvent, DeviceIo, InterruptionReason, OpenConfig};

fn open(config: FakeConfig) -> (FakeIo, Arc<Mutex<Option<EngineHandle>>>, mpsc::Receiver<DeviceEvent>) {
    let mut io = FakeIo::new(config);
    let slot = Arc::new(Mutex::new(None));
    let slot2 = Arc::clone(&slot);
    let (tx, rx) = mpsc::channel();
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
        .expect("fake open");
    assert!(info.in_frames.is_none() && info.input_rate.is_none());
    (io, slot, rx)
}

fn scheduled_frame_error(rate: u32, buffer: u32, jitter_us: u32, drift_ppm: f64) -> i64 {
    let (mut io, slot, _rx) = open(FakeConfig { rate, buffer_frames: buffer, jitter_us, drift_ppm, record_frames: rate as usize * 2, ..FakeConfig::default() });
    let rec = io.recorder().unwrap();
    let mut guard = slot.lock().unwrap();
    let h = guard.as_mut().unwrap();
    h.put_buffer(1, AudioBuffer::new(vec![1.0f32], rate));

    // Wait for the first callbacks so that "now" means something, then schedule 200 ms ahead of the render head.
    assert!(rec.wait_for_frames(rate as u64 / 10, Duration::from_secs(5)));
    let head = h.clock().frames_rendered();
    let t = head as f64 / rate as f64 + 0.2 + 0.000_013; // not a whole frame on purpose
    let out = h.schedule(Group::Sounds, &[VoiceSpec::new(7, 1, t)]).unwrap();
    assert!(out.late.is_empty());
    let want = (t * rate as f64).round() as i64;

    let mut notes = Vec::new();
    let mut ended = false;
    for _ in 0..500 {
        h.poll(&mut notes);
        if notes.iter().any(|n| matches!(n, Notification::Ended { id: 7 })) {
            ended = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(ended, "voice never ended; notes {notes:?}");
    drop(guard);
    let (first, samples) = rec.snapshot();
    io.close();
    let hits: Vec<usize> = samples.iter().enumerate().filter(|(_, s)| **s != 0.0).map(|(i, _)| i).collect();
    assert_eq!(hits.len(), 1, "exactly one nonzero frame expected, got {}", hits.len());
    assert_eq!(samples[hits[0]], 1.0);
    first as i64 + hits[0] as i64 - want
}

#[test]
fn impulse_lands_on_the_scheduled_frame() {
    for (rate, buffer) in [(48_000, 256), (44_100, 480), (48_000, 1024)] {
        let err = scheduled_frame_error(rate, buffer, 0, 0.0);
        println!("rate {rate} buffer {buffer}: scheduled-frame error {err} frames");
        assert_eq!(err, 0);
    }
}

#[test]
fn impulse_lands_on_the_scheduled_frame_with_jitter_and_drift() {
    let err = scheduled_frame_error(48_000, 256, 1500, 200.0);
    println!("jitter 1.5 ms, drift +200 ppm: scheduled-frame error {err} frames");
    assert_eq!(err, 0);
}

#[test]
fn clock_anchor_follows_the_host_clock() {
    let (mut io, slot, _rx) = open(FakeConfig { drift_ppm: 100.0, ..FakeConfig::default() });
    let h = slot.lock().unwrap().take().unwrap();
    let reader = h.clock();
    let mut anchor = None;
    for _ in 0..400 {
        anchor = reader.anchor();
        if anchor.is_some() {
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    let a = anchor.expect("an anchor within 4 s");
    let now_ms = sr_audio_device::host_clock::now_ms();
    let predicted = a.engine_sec_at(now_ms);
    let rendered = reader.frames_rendered() as f64 / 48_000.0;
    assert!((predicted - rendered).abs() < 0.05, "predicted {predicted}, rendered {rendered}");
    assert!((a.rate - 1.0001).abs() < 0.001, "rate {}", a.rate);
    io.close();
}

#[test]
fn injected_interruption_reaches_the_channel_and_close_is_idempotent() {
    let (mut io, _slot, rx) = open(FakeConfig::default());
    io.inject_interruption(InterruptionReason::DeviceChange);
    assert_eq!(rx.recv_timeout(Duration::from_secs(1)).unwrap(), DeviceEvent::Interruption(InterruptionReason::DeviceChange));
    io.close();
    io.close();
}
