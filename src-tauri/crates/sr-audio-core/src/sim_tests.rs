//! Tests of the capture path, the loopback measurement and the whole engine on the simulated duplex device.

use std::f64::consts::PI;

use crate::capture::{CaptureConfig, CaptureEvent, CapturePath, CaptureReader, CaptureStats, ClockRelation, StreamKind, FLAG_CLOCK_STEP};
use crate::loopback::{LoopbackConfig, LoopbackDriver, LoopbackEstimate, LoopbackEstimator, LoopbackStatus};
use crate::mixer::{AudioBuffer, Group, VoiceSpec};
use crate::sim::{SimConfig, SimDuplex};
use crate::synth::{render_click, ClickTimbre};
use crate::wire::{PacketHeader, FLAG_DRIFT, FLAG_INPUT_ZERO, FLAG_LAST, FLAG_RESAMPLED};
use crate::{engine, EngineConfig, EngineHandle, Notification};

struct Rig {
    sim: SimDuplex,
    handle: EngineHandle,
    reader: CaptureReader,
    events: Vec<CaptureEvent>,
    packets: Vec<(PacketHeader, Vec<f32>)>,
    notes: Vec<Notification>,
    bytes: Vec<u8>,
}

impl Rig {
    fn new(config: SimConfig) -> Self {
        let (engine, mut handle) = engine(EngineConfig::new(config.engine_rate));
        let reader = handle.take_capture_reader().expect("first take");
        assert!(handle.take_capture_reader().is_none());
        Rig { sim: SimDuplex::new(config, engine), handle, reader, events: Vec::new(), packets: Vec::new(), notes: Vec::new(), bytes: Vec::new() }
    }

    /// What the pump thread does.
    fn pump(&mut self) {
        self.handle.poll(&mut self.notes);
        while let Some(e) = self.reader.poll_event() {
            self.events.push(e);
        }
        loop {
            let mut samples = Vec::new();
            match self.reader.read_decoded(&mut self.bytes, &mut samples) {
                Some(h) => self.packets.push((h, samples)),
                None => break,
            }
        }
    }

    fn run_until(&mut self, t: f64) {
        while self.sim.time_sec() + 0.005 < t {
            self.sim.run_for(0.005);
            self.pump();
        }
        self.sim.run_until(t);
        self.pump();
    }

    /// Captures from `from` to `to` seconds and returns the statistics of the stop.
    fn capture(&mut self, from: f64, to: f64, config: CaptureConfig) -> CaptureStats {
        self.run_until(from);
        self.reader.start(config).unwrap();
        self.run_until(to);
        self.stop()
    }

    /// Asks for a capture and runs until it has begun (it waits for the clocks); returns the delay in seconds.
    fn start_and_wait(&mut self, config: CaptureConfig) -> f64 {
        let asked = self.sim.time_sec();
        self.reader.start(config).unwrap();
        while !self.events.iter().any(|e| matches!(e, CaptureEvent::Started { .. })) {
            assert!(self.sim.time_sec() < asked + 13.0, "a start never waits longer than MAX_START_WAIT_SEC");
            self.run_until(self.sim.time_sec() + 0.01);
        }
        self.sim.time_sec() - asked
    }

    fn stop(&mut self) -> CaptureStats {
        self.reader.stop().unwrap();
        let t = self.sim.time_sec() + 0.05;
        self.run_until(t);
        assert!(!self.reader.is_running());
        self.events.iter().find_map(|e| if let CaptureEvent::Stopped(s) = e { Some(*s) } else { None }).expect("stopped")
    }

    fn started(&self) -> (u64, CapturePath) {
        self.events.iter().find_map(|e| if let CaptureEvent::Started { origin_frame, path, .. } = e { Some((*origin_frame, *path)) } else { None }).expect("started")
    }

    /// The capture as one run of samples from the origin; checks numbering, continuity and the last packet.
    fn stream(&self) -> (u64, Vec<f32>) {
        let (origin, _) = self.started();
        let mut out = Vec::new();
        for (i, (h, s)) in self.packets.iter().enumerate() {
            assert_eq!(h.seq as usize, i);
            assert_eq!(h.dropped_before, 0);
            assert_eq!(h.first_frame, (origin + out.len() as u64) as f64, "packet {i} continues the grid");
            assert_eq!(h.flags & FLAG_LAST != 0, i + 1 == self.packets.len(), "only the last packet is flagged last");
            out.extend_from_slice(s);
        }
        (origin, out)
    }
}

/// A deterministic noise value for input frame `m`.
fn noise_at(m: u64) -> f32 {
    ((m.wrapping_mul(0x9e37_79b9_7f4a_7c15) >> 40) as f32) / (1u64 << 24) as f32 - 0.5
}

#[test]
fn bridge_locked_same_clock() {
    for (out_frames, in_frames, in_channels) in [(128usize, 128usize, 1usize), (256, 256, 1), (128, 256, 2), (512, 128, 1)] {
        // The input starts 10 ms (exactly 480 engine frames) after the output; no path chosen for it.
        let mut rig = Rig::new(SimConfig { out_frames, in_frames, in_channels, input_start_sec: 0.01, ..SimConfig::ideal(48_000) });
        rig.sim.set_input_signal(|m, _| noise_at(m));
        let stats = rig.capture(1.5, 4.5, CaptureConfig::default());
        let (origin, path) = rig.started();
        assert_eq!(path, CapturePath::Locked, "measured: equal rates, no rate difference, no scatter");
        let (_, samples) = rig.stream();
        // Engine frame e holds input frame e - 480, bit for bit.
        let wrong = samples.iter().enumerate().filter(|(i, s)| s.to_bits() != noise_at(origin + *i as u64 - 480).to_bits()).count();
        assert!(samples.len() > 140_000 && samples.len() < 146_000, "{}", samples.len());
        assert_eq!((stats.packets as usize, stats.frames as usize, stats.dropped_frames, stats.clock_steps), (rig.packets.len(), samples.len(), 0, 0));
        assert!(rig.packets.iter().all(|(h, _)| h.flags & !FLAG_LAST == 0));
        assert!(rig.packets[..rig.packets.len() - 1].iter().all(|(h, _)| h.n_frames == 512));
        println!(
            "bridge_locked_same_clock out {out_frames} in {in_frames} x{in_channels}: locked, {} samples, {wrong} not bit-identical, stamp error 0 frames (origin {origin} = first input frame + 480), ring max {:.1} ms",
            samples.len(), stats.max_ring_ms
        );
        assert_eq!(wrong, 0);
        assert!(stats.max_ring_ms < 40.0);
    }
}

#[test]
fn locked_path_with_jitter_and_a_shared_clock_hint() {
    // Real callbacks are late and bursty. The capture waits until the clocks place a frame within 0.1 ms, so
    // the integer offset of the locked path is right whenever the start was asked for.
    for (ask, seed) in [(1.5, 3u32), (4.0, 4), (12.0, 5), (12.0, 6), (0.2, 7)] {
        let mut rig = Rig::new(SimConfig { jitter_ms: 3.0, burst_every: 53, input_start_sec: 0.01, seed, ..SimConfig::ideal(48_000) });
        rig.sim.set_input_signal(|m, _| noise_at(m));
        rig.run_until(ask);
        let waited = rig.start_and_wait(CaptureConfig { relation: ClockRelation::Shared, ..CaptureConfig::default() });
        rig.run_until(rig.sim.time_sec() + 1.0);
        rig.stop();
        let (origin, path) = rig.started();
        assert_eq!(path, CapturePath::Locked);
        let (_, samples) = rig.stream();
        let error = (-200i64..=200).find(|d| samples.iter().take(64).enumerate().all(|(i, s)| s.to_bits() == noise_at((origin as i64 + i as i64 - 480 - d) as u64).to_bits())).expect("an offset within 200 frames");
        println!("locked with 3 ms jitter, asked at {ask} s: began {waited:.2} s later, stamp error {error} frames ({:.3} ms)", error as f64 / 48.0);
        assert!(error.abs() <= 5, "within 0.1 ms");
    }
}

/// Largest stamp error of a captured 1 kHz tone, seconds: the phase of each packet against the tone at the
/// true time of its engine frames.
fn tone_stamp_error(rig: &Rig, f_out: f64) -> f64 {
    packet_stamp_errors(rig, f_out, 1000.0).into_iter().map(|(_, e)| e.abs()).fold(0.0, f64::max)
}

/// The slow tone the long tests capture: 2 cycles per 512-frame packet at 48 kHz, unambiguous to 2.6 ms.
const SLOW_HZ: f64 = 187.5;

/// Signed stamp error of every full packet of a captured tone of `hz`, as (packet index, seconds).
fn packet_stamp_errors(rig: &Rig, f_out: f64, hz: f64) -> Vec<(usize, f64)> {
    packet_stamp_errors_shifted(rig, f_out, hz, 0.0)
}

/// As [`packet_stamp_errors`] when the engine's frame count is `shift` frames ahead of the device's (engine
/// time jumped forward over a restart).
fn packet_stamp_errors_shifted(rig: &Rig, f_out: f64, hz: f64, shift: f64) -> Vec<(usize, f64)> {
    let w = 2.0 * PI * hz;
    let mut out = Vec::new();
    for (n, (h, s)) in rig.packets.iter().enumerate().filter(|(_, (_, s))| s.len() >= 256) {
        let (mut i, mut q) = (0f64, 0f64);
        for (k, y) in s.iter().enumerate() {
            let (sin, cos) = (w * (h.first_frame - shift + k as f64) / f_out).sin_cos();
            i += *y as f64 * sin;
            q += *y as f64 * cos;
        }
        assert!((i * i + q * q).sqrt() / s.len() as f64 > 0.1, "the tone is there");
        out.push((n, q.atan2(i) / w));
    }
    out
}

#[test]
fn bridge_tracks_drift() {
    // Input 48 kHz + 200 ppm against a 48 kHz output, 120 s. First with ideal callbacks, then with 0 to 3 ms
    // of lateness and stalls on both streams.
    for (name, jitter_ms, burst_every) in [("ideal callbacks", 0.0, 0u32), ("3 ms jitter and stalls", 3.0, 53)] {
        let mut rig = Rig::new(SimConfig { in_ppm: 200.0, jitter_ms, burst_every, input_start_sec: 0.0037, seed: 11, ..SimConfig::ideal(48_000) });
        rig.sim.set_input_signal(|_, t| (0.5 * (2.0 * PI * 1000.0 * t).sin()) as f32);
        let stats = rig.capture(1.5, 121.5, CaptureConfig::default());
        let (_, path) = rig.started();
        assert_eq!(path, CapturePath::Resampled);
        let (_, samples) = rig.stream(); // asserts: no gap, nothing dropped
        let worst = tone_stamp_error(&rig, rig.sim.true_rates().0);
        let drift = rig.handle.rate_check(2.0).input_drift_ppm.expect("both clocks settled");
        println!(
            "bridge_tracks_drift, {name}: resampled, {:.1} s, max stamp error {:.4} ms (limit 0.2), no gap, measured input drift {drift:+.2} ppm, ring max {:.1} ms",
            samples.len() as f64 / 48_000.0, worst * 1e3, stats.max_ring_ms
        );
        assert!(samples.len() > 105 * 48_000, "with jitter the start waits for the clocks: {}", samples.len());
        assert!(worst < 0.2e-3, "stamp error {worst}");
        assert!((drift - 200.0).abs() < 3.0);
        assert!(rig.packets.iter().all(|(h, _)| h.flags & FLAG_RESAMPLED != 0 && h.flags & (FLAG_DRIFT | FLAG_CLOCK_STEP) == 0));
        assert_eq!((stats.dropped_frames, stats.clock_steps), (0, 0));
    }
}

#[test]
fn bridge_rate_convert() {
    for (name, jitter_ms, burst_every, start, limit_ms) in [("ideal callbacks", 0.0, 0u32, 1.5, 0.05), ("3 ms jitter and stalls", 3.0, 53, 12.0, 0.05)] {
        let mut rig = Rig::new(SimConfig { input_rate: 44_100, in_frames: 441, jitter_ms, burst_every, input_start_sec: 0.0021, seed: 21, ..SimConfig::ideal(48_000) });
        // One unit impulse every 100 ms of input.
        rig.sim.set_input_signal(|m, _| if m % 4410 == 1000 { 1.0 } else { 0.0 });
        rig.capture(start, start + 3.0, CaptureConfig::default());
        let (origin, path) = rig.started();
        assert_eq!(path, CapturePath::Resampled);
        let (_, y) = rig.stream();
        let (mut worst, mut count) = (0f64, 0);
        let mut m = 1000u64;
        loop {
            let want = rig.sim.true_engine_pos(m as f64) - origin as f64;
            m += 4410;
            if want < 40.0 {
                continue;
            }
            if want > y.len() as f64 - 40.0 {
                break;
            }
            let c = want.round() as usize;
            let k = (c - 20..=c + 20).max_by(|a, b| y[*a].total_cmp(&y[*b])).unwrap();
            assert!(y[k] > 0.5, "impulse {count} is there: {}", y[k]);
            let (a, b, d) = (y[k - 1] as f64, y[k] as f64, y[k + 1] as f64);
            let got = k as f64 + 0.5 * (a - d) / (a - 2.0 * b + d);
            worst = worst.max((got - want).abs() / 48_000.0);
            count += 1;
        }
        println!("bridge_rate_convert 44.1 kHz to 48 kHz, {name}: {count} impulses, max stamp error {:.4} ms (limit {limit_ms})", worst * 1e3);
        assert!(count >= 28);
        assert!(worst * 1e3 < limit_ms);
    }
}

#[test]
fn clock_step_ends_the_capture() {
    let mut rig = Rig::new(SimConfig { input_start_sec: 0.01, ..SimConfig::ideal(48_000) });
    rig.sim.set_input_signal(|m, _| noise_at(m));
    rig.run_until(1.5);
    rig.reader.start(CaptureConfig::default()).unwrap();
    rig.run_until(3.0);
    rig.sim.lose_input(0.01); // an input xrun: 480 frames of time are gone
    rig.run_until(5.0);
    let (origin, path) = rig.started();
    assert_eq!(path, CapturePath::Locked);
    assert!(!rig.reader.is_running(), "the capture ended by itself");
    let stopped = rig.events.iter().find_map(|e| if let CaptureEvent::Stopped(s) = e { Some(*s) } else { None }).expect("stopped");
    assert_eq!(rig.events.iter().filter(|e| matches!(e, CaptureEvent::ClockStep { stream: StreamKind::Input })).count(), 1);
    assert_eq!(stopped.clock_steps, 1);
    // Every packet is on the grid and carries what was captured; the last one has the step flag.
    let (_, samples) = rig.stream();
    assert!(samples.iter().enumerate().all(|(k, v)| v.to_bits() == noise_at(origin + k as u64 - 480).to_bits()));
    let (last, body) = rig.packets.split_last().unwrap();
    assert_eq!(last.0.flags, FLAG_LAST | FLAG_CLOCK_STEP);
    assert!(body.iter().all(|(h, _)| h.flags == 0));
    let found = (origin as f64 + samples.len() as f64 - 480.0) / 48_000.0 - 3.0;
    println!("clock step: 10 ms input xrun at 3.0 s ends the capture {found:.2} s later (frames of that stretch are stamped 10 ms early; the step flag voids the capture)");
    assert!(found > 0.5 && found < 1.2);
    assert_eq!(stopped.frames as usize, samples.len());
}

#[test]
fn capture_control_flags_and_errors() {
    use crate::capture::CaptureError;
    let mut rig = Rig::new(SimConfig::ideal(48_000));
    assert_eq!(rig.reader.start(CaptureConfig { packet_frames: 100, ..CaptureConfig::default() }), Err(CaptureError::BadPacketFrames));
    // A start before the clocks have settled waits; silence is flagged all zero; the last packet is short.
    rig.reader.start(CaptureConfig { packet_frames: 256, ..CaptureConfig::default() }).unwrap();
    rig.reader.start(CaptureConfig::default()).unwrap();
    rig.run_until(0.9);
    assert!(rig.packets.is_empty() && !rig.reader.is_running());
    assert_eq!(rig.events, vec![CaptureEvent::StartIgnored]);
    rig.run_until(2.0);
    assert!(rig.reader.is_running());
    let live = rig.reader.stats();
    assert!(live.packets > 100 && live.frames == live.packets * 256);
    let stats = rig.stop();
    let (origin, _) = rig.started();
    let started_at = origin as f64 / 48_000.0;
    assert!((1.0..1.5).contains(&started_at), "started once both clocks had run a good second: {started_at}");
    let (_, samples) = rig.stream();
    assert!(samples.iter().all(|x| *x == 0.0));
    let (last, body) = rig.packets.split_last().unwrap();
    assert!(body.iter().all(|(h, s)| h.flags == FLAG_INPUT_ZERO && s.len() == 256));
    assert!(last.0.flags & FLAG_LAST != 0 && last.1.len() < 256);
    assert_eq!(stats.frames as usize, samples.len());
    // Stop with nothing running, then a second capture: numbering starts again.
    rig.reader.stop().unwrap();
    rig.events.clear();
    rig.packets.clear();
    let t = rig.sim.time_sec();
    rig.capture(t + 0.1, t + 0.3, CaptureConfig::default());
    assert_eq!(rig.packets[0].0.seq, 0);
    assert!(rig.stream().1.len() > 8000);
    assert_eq!(rig.handle.rate_check(1.0).input_drift_ppm.map(|p| p.abs() < 0.01), Some(true));

}

/// Runs a loopback measurement on a simulated device.
fn measure(config: SimConfig, relation: ClockRelation, warmup_sec: f64) -> (LoopbackEstimate, Option<CapturePath>, f64) {
    let mut rig = Rig::new(config);
    rig.run_until(warmup_sec);
    let mut driver = LoopbackDriver::start(&mut rig.handle, &mut rig.reader, LoopbackConfig { relation, predicted_ms: Some(20.0), ..LoopbackConfig::default() }).unwrap();
    let began = rig.sim.time_sec();
    loop {
        rig.sim.run_for(0.01);
        rig.handle.poll(&mut rig.notes);
        match driver.poll(&mut rig.handle, &mut rig.reader) {
            LoopbackStatus::Running => assert!(rig.sim.time_sec() < began + 10.0, "the run ends"),
            LoopbackStatus::Done(e) => {
                assert_eq!(rig.sim.underruns(), 0);
                assert!(rig.handle.buffers().is_empty(), "the click buffer is dropped");
                assert!(!rig.reader.is_running());
                return (e, driver.path(), rig.sim.time_sec() - began);
            }
            LoopbackStatus::Failed(e) => panic!("loopback failed: {e}"),
        }
    }
}

/// RMS of the Tick click as the loopback driver plays it (gain 0.7), for setting a noise level.
fn click_rms() -> f32 {
    let c = render_click(ClickTimbre::Tick, false, 48_000);
    0.7 * (c.iter().map(|x| x * x).sum::<f32>() / c.len() as f32).sqrt()
}

#[test]
fn loopback_estimator_delay() {
    // 23.4 ms round trip, noise 20 dB below the click at the input.
    let loop_gain = 0.5;
    let config = SimConfig { delay_sec: 0.0234, loop_gain, noise_rms: loop_gain * click_rms() / 10.0, in_frames: 256, seed: 41, ..SimConfig::ideal(48_000) };
    let (e, path, took) = measure(config, ClockRelation::Unknown, 1.5);
    println!(
        "loopback_estimator_delay: {} of {} found, round trip {:.4} ms (true 23.4, limit 0.1), MAD {:.4} ms (limit 0.1), SNR {:.1} dB, path {path:?}, {took:.2} s",
        e.found, e.scheduled, e.round_trip_ms.unwrap(), e.mad_ms.unwrap(), e.snr_db.unwrap()
    );
    assert_eq!((e.found, e.scheduled, e.predicted_ms), (8, 8, Some(20.0)));
    assert!((e.round_trip_ms.unwrap() - 23.4).abs() < 0.1);
    assert!(e.mad_ms.unwrap() < 0.1);
    assert!(took < 2.6);
}

#[test]
fn loopback_estimator_rejects_silence() {
    // No path from output to input: only noise, then digital silence.
    for noise_rms in [0.02f32, 0.0] {
        let (e, _, _) = measure(SimConfig { delay_sec: 0.0234, loop_gain: 0.0, noise_rms, seed: 42, ..SimConfig::ideal(48_000) }, ClockRelation::Unknown, 1.5);
        println!("loopback_estimator_rejects_silence (noise rms {noise_rms}): found {} of {}, round trip {:?}", e.found, e.scheduled, e.round_trip_ms);
        assert_eq!((e.found, e.scheduled, e.round_trip_ms, e.mad_ms, e.snr_db), (0, 8, None, None, None));
    }
}

#[test]
fn loopback_with_drifting_input_at_another_rate() {
    // A 44.1 kHz input running 200 ppm fast, late and bursty callbacks, noise 20 dB down.
    let loop_gain = 0.5;
    let config = SimConfig { input_rate: 44_100, in_frames: 441, in_ppm: 200.0, delay_sec: 0.0234, loop_gain, noise_rms: loop_gain * click_rms() / 10.0, jitter_ms: 3.0, burst_every: 53, seed: 43, ..SimConfig::ideal(48_000) };
    for warmup in [1.5, 12.0] {
        let (e, path, _) = measure(config.clone(), ClockRelation::Unknown, warmup);
        println!(
            "loopback, 44.1 kHz + 200 ppm input, 3 ms jitter, started at {warmup} s: {} of {} found, round trip {:.4} ms (true 23.4), MAD {:.4} ms, SNR {:.1} dB",
            e.found, e.scheduled, e.round_trip_ms.unwrap(), e.mad_ms.unwrap(), e.snr_db.unwrap()
        );
        assert_eq!(path, Some(CapturePath::Resampled));
        assert_eq!(e.found, 8);
        assert!((e.round_trip_ms.unwrap() - 23.4).abs() < 0.2);
        assert!(e.mad_ms.unwrap() < 0.1);
    }
}

#[test]
fn whole_engine_click_arrivals() {
    // A take's worth of clicks through the whole engine: scheduled by the handle, rendered, looped back at
    // 23.4 ms, captured, packetized, decoded, and each arrival found on the engine clock.
    let cases = [
        ("locked (48 kHz duplex, ideal callbacks)", SimConfig { in_frames: 256, ..SimConfig::ideal(48_000) }, CapturePath::Locked, 0.02),
        ("resampled (44.1 kHz + 200 ppm input, ideal callbacks)", SimConfig { input_rate: 44_100, in_frames: 441, in_ppm: 200.0, ..SimConfig::ideal(48_000) }, CapturePath::Resampled, 0.05),
        ("resampled (44.1 kHz + 200 ppm input, 3 ms jitter and stalls)", SimConfig { input_rate: 44_100, in_frames: 441, in_ppm: 200.0, jitter_ms: 3.0, burst_every: 53, ..SimConfig::ideal(48_000) }, CapturePath::Resampled, 0.2),
    ];
    for (name, base, want_path, limit_ms) in cases {
        let delay = 0.0234;
        let mut rig = Rig::new(SimConfig { delay_sec: delay, loop_gain: 0.5, seed: 77, ..base });
        let click = render_click(ClickTimbre::Classic, false, 48_000);
        let accent = render_click(ClickTimbre::Classic, true, 48_000);
        let mut found = LoopbackEstimator::new(48_000, &click);
        let mut found_accent = LoopbackEstimator::new(48_000, &accent);
        rig.handle.put_buffer(1, AudioBuffer::new(click, 48_000));
        rig.handle.put_buffer(2, AudioBuffer::new(accent, 48_000));
        // 24 clicks at 132 bpm from an off-grid time, every fourth accented; capture starts 0.5 s before.
        rig.run_until(1.5);
        let waited = rig.start_and_wait(CaptureConfig::default());
        let t0 = rig.sim.frames().0 as f64 / 48_000.0 + 0.500_123;
        let specs: Vec<VoiceSpec> = (0..24).map(|k| VoiceSpec { gain: 0.8, ..VoiceSpec::new(k, if k % 4 == 0 { 2 } else { 1 }, t0 + k as f64 * 60.0 / 132.0) }).collect();
        assert!(rig.handle.schedule(Group::Take, &specs).unwrap().late.is_empty());
        rig.run_until(rig.sim.time_sec() + 0.5 + 24.0 * 60.0 / 132.0 + 0.4);
        rig.stop();
        assert_eq!(rig.started().1, want_path);
        assert_eq!(rig.sim.underruns(), 0);
        for (h, s) in &rig.packets {
            found.push(h.first_frame as u64, s);
            found_accent.push(h.first_frame as u64, s);
        }
        rig.stream(); // continuity
        let mut worst = 0f64;
        for spec in &specs {
            let frame = crate::mixer::frame_of(spec.t, 48_000.0);
            let est = if spec.buffer == 2 { &found_accent } else { &found };
            let a = est.arrival(frame).expect("inside the capture");
            assert!(a.snr_db > 30.0, "click {} found: {} dB", spec.id, a.snr_db);
            // The click was written at `frame`; it must arrive `delay` later on the engine clock.
            worst = worst.max((a.lag_sec - delay).abs());
        }
        assert_eq!(rig.notes.iter().filter(|n| matches!(n, Notification::Ended { .. })).count(), 24);
        println!("whole_engine_click_arrivals, {name}: capture began {waited:.2} s after it was asked for at 1.5 s; 24 clicks, max arrival error {:.4} ms (limit {limit_ms})", worst * 1e3);
        assert!(worst * 1e3 < limit_ms);
    }
}

#[test]
fn loopback_retries_once_after_a_clock_step() {
    use crate::loopback::LoopbackError;
    // An input xrun 0.7 s into the measurement breaks the first attempt; with `second_step` another one
    // breaks the retry too.
    for second_step in [false, true] {
        let mut rig = Rig::new(SimConfig { delay_sec: 0.0234, loop_gain: 0.5, seed: 51, ..SimConfig::ideal(48_000) });
        rig.run_until(1.5);
        let mut driver = LoopbackDriver::start(&mut rig.handle, &mut rig.reader, LoopbackConfig::default()).unwrap();
        let began = rig.sim.time_sec();
        let mut steps_made = 0;
        let status = loop {
            rig.sim.run_for(0.01);
            rig.handle.poll(&mut rig.notes);
            let t = rig.sim.time_sec() - began;
            if (steps_made == 0 && t > 0.7) || (steps_made == 1 && second_step && driver.attempts() == 2 && driver.path().is_some()) {
                rig.sim.lose_input(0.01);
                steps_made += 1;
            }
            match driver.poll(&mut rig.handle, &mut rig.reader) {
                LoopbackStatus::Running => assert!(t < 12.0, "the run ends"),
                done => break done,
            }
        };
        let took = rig.sim.time_sec() - began;
        assert!(rig.handle.buffers().is_empty(), "the click buffer is dropped either way");
        if second_step {
            println!("loopback with two clock steps: {status:?} after {took:.2} s");
            assert_eq!(status, LoopbackStatus::Failed(LoopbackError::Interrupted));
            assert_eq!(driver.attempts(), 2);
        } else {
            let LoopbackStatus::Done(e) = status else { panic!("{status:?}") };
            println!("loopback with one clock step: retried, {} of {} found, round trip {:.4} ms (true 23.4), {took:.2} s in all", e.found, e.scheduled, e.round_trip_ms.unwrap());
            assert_eq!((driver.attempts(), e.found, e.scheduled), (2, 8, 8));
            assert!((e.round_trip_ms.unwrap() - 23.4).abs() < 0.1);
            // The clicks of the broken attempt were stopped: only the retry's eight ended on their own or
            // were cut, and none plays after the run.
            rig.run_until(rig.sim.time_sec() + 0.3);
            assert!(!rig.reader.is_running());
        }
    }
}

#[test]
fn accessors_for_a_device_wrapper() {
    let mut rig = Rig::new(SimConfig { out_frames: 256, ..SimConfig::ideal(48_000) });
    assert_eq!(rig.sim.last_output().len(), 512);
    assert_eq!(rig.sim.capture_origin_input_frame(), None);
    rig.handle.put_buffer(1, AudioBuffer::new(vec![0.25f32; 48_000], 48_000));
    rig.handle.schedule(Group::Sounds, &[VoiceSpec::new(1, 1, 0.0)]).unwrap();
    rig.capture(1.5, 1.7, CaptureConfig::default());
    // The capture began with the first frame of an input callback, and the grid origin is that frame's place.
    let origin_input = rig.sim.capture_origin_input_frame().expect("a capture ran");
    assert_eq!(origin_input % 128, 0);
    assert_eq!(rig.started().0, origin_input, "same clock, both streams from time 0: offset 0");
    assert_eq!(rig.sim.capture().capture_origin_input_frame(), Some(origin_input));
    let mut rig2 = Rig::new(SimConfig { out_frames: 256, ..SimConfig::ideal(48_000) });
    rig2.handle.put_buffer(1, AudioBuffer::new(vec![0.25f32; 48_000], 48_000));
    rig2.handle.schedule(Group::Sounds, &[VoiceSpec::new(1, 1, 0.0)]).unwrap();
    rig2.run_until(0.5);
    assert!(rig2.sim.last_output().iter().all(|x| *x == 0.25), "the last rendered buffer, interleaved");
}

fn slow_tone(rig: &mut Rig) {
    rig.sim.set_input_signal(|_, t| (0.5 * (2.0 * PI * SLOW_HZ * t).sin()) as f32);
}

/// Index of the first packet that carries the drift or the step flag.
fn first_void_flag(rig: &Rig) -> Option<usize> {
    rig.packets.iter().position(|(h, _)| h.flags & (FLAG_DRIFT | FLAG_CLOCK_STEP) != 0)
}

#[test]
fn ten_minute_capture_stays_inside_half_a_millisecond_or_is_flagged() {
    // Unknown clocks, ideal callbacks, the input 3 ppm fast: a 10-minute capture.
    let mut rig = Rig::new(SimConfig { in_ppm: 3.0, input_start_sec: 0.0137, seed: 7, ..SimConfig::ideal(48_000) });
    slow_tone(&mut rig);
    rig.capture(30.0, 630.0, CaptureConfig::default());
    let errors = packet_stamp_errors(&rig, 48_000.0, SLOW_HZ);
    let flagged = first_void_flag(&rig);
    let unflagged_worst = errors.iter().filter(|(n, _)| flagged.is_none_or(|f| *n < f)).map(|(_, e)| e.abs()).fold(0.0, f64::max);
    let end = errors.last().unwrap().1;
    println!(
        "10-minute capture, unknown clocks, input +3 ppm: path {:?}, stamp error at the end {:+.3} ms, largest before any drift or step flag {:.3} ms, first flag at {:?} s",
        rig.started().1, end * 1e3, unflagged_worst * 1e3, flagged.map(|n| (n as f64 * 512.0 / 48_000.0).round())
    );
    assert!(unflagged_worst < 0.5e-3, "inside 0.5 ms or flagged: {unflagged_worst}");
    assert_eq!(rig.started().1, CapturePath::Resampled, "3 ppm apart is not one clock");
    assert!(flagged.is_none() && end.abs() < 0.05e-3);
}

#[test]
fn small_rate_differences_are_not_locked() {
    for (ppm, jitter_ms) in [(2.0, 0.0), (4.0, 0.0), (2.0, 0.05), (-1.0, 0.0), (0.7, 0.0)] {
        let mut rig = Rig::new(SimConfig { in_ppm: ppm, jitter_ms, seed: 7, ..SimConfig::ideal(48_000) });
        rig.capture(30.0, 30.3, CaptureConfig::default());
        println!("unknown clocks, input {ppm:+} ppm, jitter {jitter_ms} ms, start at 30 s: {:?}", rig.started().1);
        assert_eq!(rig.started().1, CapturePath::Resampled);
    }
    // One clock, clean callbacks: still locked by measurement.
    for jitter_ms in [0.0, 0.02] {
        let mut rig = Rig::new(SimConfig { jitter_ms, seed: 8, ..SimConfig::ideal(48_000) });
        rig.capture(40.0, 40.3, CaptureConfig::default());
        println!("unknown clocks, one clock, jitter {jitter_ms} ms, start at 40 s: {:?}", rig.started().1);
        assert_eq!(rig.started().1, CapturePath::Locked);
    }
}

#[test]
fn a_wrong_shared_claim_is_overridden_or_flagged() {
    // The device layer says "one clock"; the input really runs 20 ppm fast.
    // (a) Settled, clean clocks: the measurement contradicts the claim and wins.
    let mut rig = Rig::new(SimConfig { in_ppm: 20.0, seed: 7, ..SimConfig::ideal(48_000) });
    slow_tone(&mut rig);
    rig.capture(30.0, 90.0, CaptureConfig { relation: ClockRelation::Shared, ..CaptureConfig::default() });
    let worst = packet_stamp_errors(&rig, 48_000.0, SLOW_HZ).into_iter().map(|(_, e)| e.abs()).fold(0.0, f64::max);
    println!("wrong shared claim (+20 ppm), settled clocks, 60 s: path {:?}, max stamp error {:.3} ms, first flag {:?}", rig.started().1, worst * 1e3, first_void_flag(&rig));
    assert_eq!(rig.started().1, CapturePath::Resampled);
    assert!(worst < 0.05e-3);

    // (b) A difference the clocks cannot tell from none (1.5 ppm): locked, and the drift flag comes before
    // the capture is 0.5 ms off, and stays.
    let mut rig = Rig::new(SimConfig { in_ppm: 1.5, seed: 7, ..SimConfig::ideal(48_000) });
    slow_tone(&mut rig);
    rig.capture(30.0, 430.0, CaptureConfig { relation: ClockRelation::Shared, ..CaptureConfig::default() });
    let errors = packet_stamp_errors(&rig, 48_000.0, SLOW_HZ);
    let flagged = first_void_flag(&rig);
    let before_flag = errors.iter().filter(|(n, _)| flagged.is_none_or(|f| *n < f)).map(|(_, e)| e.abs()).fold(0.0, f64::max);
    println!(
        "shared claim with the input 1.5 ppm fast, 400 s: path {:?}, error at the end {:+.3} ms, largest before the flag {:.3} ms, drift flag after {:?} s",
        rig.started().1, errors.last().unwrap().1 * 1e3, before_flag * 1e3, flagged.map(|n| (n as f64 * 512.0 / 48_000.0).round())
    );
    assert_eq!(rig.started().1, CapturePath::Locked);
    let at = flagged.expect("the drift is flagged");
    assert!(before_flag < 0.5e-3, "{before_flag}");
    assert!(rig.packets[at..].iter().all(|(h, _)| h.flags & FLAG_DRIFT != 0), "the flag stays");
}

#[test]
fn output_restart_ends_a_running_capture() {
    for seed in 1..=6 {
        let mut rig = Rig::new(SimConfig { jitter_ms: 3.0, burst_every: 53, input_start_sec: 0.0137, seed, ..SimConfig::ideal(48_000) });
        slow_tone(&mut rig);
        rig.run_until(12.0);
        rig.reader.start(CaptureConfig { relation: ClockRelation::Shared, ..CaptureConfig::default() }).unwrap();
        rig.run_until(15.0);
        rig.handle.output_restarted().unwrap();
        rig.run_until(15.4);
        let ended = rig.events.iter().any(|e| matches!(e, CaptureEvent::Stopped(_)));
        let errors = packet_stamp_errors(&rig, 48_000.0, SLOW_HZ);
        let after: f64 = errors.iter().filter(|(n, _)| rig.packets[*n].0.first_frame > 15.5 * 48_000.0).map(|(_, e)| e.abs()).fold(0.0, f64::max);
        println!(
            "output restart during a locked capture, seed {seed}: capture ended by itself: {ended}; packets after the restart: {}; largest stamp error in them {:.3} ms",
            rig.packets.iter().filter(|(h, _)| h.first_frame > 15.5 * 48_000.0).count(), after * 1e3
        );
        assert!(ended, "the capture ends instead of going on with a mapping from a one-point clock");
        assert!(!rig.reader.is_running());
        let (last, _) = rig.packets.last().unwrap();
        assert_eq!(last.flags & (FLAG_LAST | FLAG_CLOCK_STEP), FLAG_LAST | FLAG_CLOCK_STEP);
        assert!(last.first_frame < 15.3 * 48_000.0);
        assert!(after == 0.0);
        assert!(rig.events.contains(&CaptureEvent::ClockStep { stream: StreamKind::Output }));
        // A new capture waits for the output clock to settle again, then is right.
        rig.events.clear();
        rig.packets.clear();
        rig.reader.start(CaptureConfig { relation: ClockRelation::Shared, ..CaptureConfig::default() }).unwrap();
        rig.run_until(22.0);
        rig.stop();
        let origin_sec = rig.started().0 as f64 / 48_000.0;
        // Engine time jumped forward over the restart by what the late callback added; the device's own
        // frame count did not, so the truth is shifted by the difference.
        let shift = rig.sim.engine().head() as f64 - rig.sim.frames().0 as f64;
        let worst = packet_stamp_errors_shifted(&rig, 48_000.0, SLOW_HZ, shift).into_iter().map(|(_, e)| e.abs()).fold(0.0, f64::max);
        println!("    next capture, asked for 0.4 s after the restart: began {:.2} s after it, max stamp error {:.3} ms (engine time jumped {shift} frames at the restart)", origin_sec - 15.0, worst * 1e3);
        assert!(origin_sec > 16.0, "not before the new output clock has run a second: {origin_sec}");
        assert!(worst < 0.15e-3, "seed {seed}: {worst}");
    }
}

#[test]
fn small_input_losses_cannot_add_up_unnoticed() {
    // Four input losses of 0.4 ms each, every one below what the step detector can see.
    let mut rig = Rig::new(SimConfig { input_start_sec: 0.0137, seed: 3, ..SimConfig::ideal(48_000) });
    slow_tone(&mut rig);
    rig.run_until(30.0);
    rig.reader.start(CaptureConfig { relation: ClockRelation::Shared, ..CaptureConfig::default() }).unwrap();
    for k in 0..4 {
        rig.run_until(33.0 + 3.0 * k as f64);
        rig.sim.lose_input(0.0004);
    }
    rig.run_until(52.0);
    rig.stop();
    let errors = packet_stamp_errors(&rig, 48_000.0, SLOW_HZ);
    let flagged = first_void_flag(&rig);
    println!(
        "four 0.4 ms input losses, locked: stamp error at the end {:+.3} ms; first drift or step flag after {:?} s of capture",
        errors.last().unwrap().1 * 1e3, flagged.map(|n| (n as f64 * 512.0 / 48_000.0 * 10.0).round() / 10.0)
    );
    assert!(flagged.is_some(), "0.8 ms and more of lost input is flagged");
}
