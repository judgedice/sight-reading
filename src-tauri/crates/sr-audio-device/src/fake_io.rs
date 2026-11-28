//! A thread-driven fake output device (feature `fake`). It calls [`Engine::render`] from its own thread in real
//! time: one callback per buffer, each started by a sleep-until loop on the monotonic host clock, with the
//! callback's `host_ns` read right after the wake-up, exactly as a real driver thread would.
//!
//! What it can do: any rate and buffer size, a clock that runs fast or slow by some ppm, per-callback wake-up
//! jitter, recording what was rendered, and raising an interruption on demand. What it cannot: simulate an
//! input. **TODO (capture task):** a fake input and the duplex delay, beside `FakeConfig`.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use sr_audio_core::latency::{LatencyParts, LatencyReport, Transport};
use sr_audio_core::Engine;

use crate::{current_platform, host_clock, DeviceError, DeviceEvent, DeviceIo, EngineFactory, InterruptionReason, OpenConfig, OpenInfo, RouteFacts};

/// How the fake device behaves.
#[derive(Debug, Clone, PartialEq)]
pub struct FakeConfig {
    /// Stream rate, Hz (the engine rate).
    pub rate: u32,
    /// Frames per callback.
    pub buffer_frames: u32,
    /// Interleaved channels handed to the engine.
    pub channels: usize,
    /// The device clock runs this many parts per million fast (positive) or slow (negative) against the host.
    pub drift_ppm: f64,
    /// Each wake-up is delayed by a pseudo-random amount up to this many microseconds (never early).
    pub jitter_us: u32,
    /// Frames of channel 0 the recorder keeps (a ring: the oldest frames are overwritten); 0 = no recorder.
    pub record_frames: usize,
}

impl Default for FakeConfig {
    fn default() -> Self {
        FakeConfig { rate: 48_000, buffer_frames: 256, channels: 2, drift_ppm: 0.0, jitter_us: 0, record_frames: 0 }
    }
}

#[derive(Debug, Default)]
struct RecordInner {
    /// Engine frame of `samples[0]`.
    first_frame: u64,
    samples: VecDeque<f32>,
    /// Frames ever recorded.
    total: u64,
}

/// What the fake device rendered (channel 0, which carries the mono mix), as a ring of the latest frames.
#[derive(Debug, Clone)]
pub struct Recorder {
    inner: Arc<Mutex<RecordInner>>,
    capacity: usize,
}

impl Recorder {
    fn push(&self, head_before: u64, chunk: impl Iterator<Item = f32>) {
        let mut g = self.inner.lock().unwrap();
        if g.total == 0 {
            g.first_frame = head_before;
        }
        for s in chunk {
            if g.samples.len() == self.capacity {
                g.samples.pop_front();
                g.first_frame += 1;
            }
            g.samples.push_back(s);
            g.total += 1;
        }
    }

    /// Frames recorded since the device opened (including ones the ring has since overwritten).
    pub fn total_frames(&self) -> u64 {
        self.inner.lock().unwrap().total
    }

    /// The kept frames: the engine frame of the first one, and the samples.
    pub fn snapshot(&self) -> (u64, Vec<f32>) {
        let g = self.inner.lock().unwrap();
        (g.first_frame, g.samples.iter().copied().collect())
    }

    /// Blocks until at least `frames` frames have been recorded, or `timeout` passes; true when reached.
    pub fn wait_for_frames(&self, frames: u64, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if self.total_frames() >= frames {
                return true;
            }
            std::thread::sleep(Duration::from_millis(2));
        }
        self.total_frames() >= frames
    }
}

/// The fake output device.
pub struct FakeIo {
    config: FakeConfig,
    recorder: Option<Recorder>,
    running: Option<Running>,
    events: Option<Sender<DeviceEvent>>,
}

struct Running {
    stop: Arc<AtomicBool>,
    join: JoinHandle<()>,
}

impl FakeIo {
    /// A closed fake device.
    pub fn new(config: FakeConfig) -> Self {
        let recorder = (config.record_frames > 0)
            .then(|| Recorder { inner: Arc::new(Mutex::new(RecordInner::default())), capacity: config.record_frames });
        FakeIo { config, recorder, running: None, events: None }
    }

    /// The recorder, when `record_frames > 0`. Valid before and after `open`.
    pub fn recorder(&self) -> Option<Recorder> {
        self.recorder.clone()
    }

    /// Raises an interruption as a failing stream would (no effect while closed).
    pub fn inject_interruption(&self, reason: InterruptionReason) {
        if let Some(tx) = &self.events {
            let _ = tx.send(DeviceEvent::Interruption(reason));
        }
    }

    fn facts(&self) -> RouteFacts {
        RouteFacts {
            output_uid: "fake:output".into(),
            input_uid: None,
            output_transport: Transport::Unknown,
            input_transport: None,
            platform: current_platform(),
            direct_hardware: false,
            low_latency_feature: false,
        }
    }

    fn parts(&self) -> LatencyParts {
        LatencyParts { out_buffer: Some(self.config.buffer_frames as f64 / self.config.rate as f64), ..LatencyParts::default() }
    }
}

impl Drop for FakeIo {
    fn drop(&mut self) {
        self.close();
    }
}

/// xorshift64*, for the jitter.
fn next_rand(state: &mut u64) -> u64 {
    *state ^= *state >> 12;
    *state ^= *state << 25;
    *state ^= *state >> 27;
    state.wrapping_mul(0x2545_F491_4F6C_DD1D)
}

fn sleep_until(target: Instant) {
    // Coarse sleep, then yield-spin for the last 300 microseconds: the sleep granularity of a loaded CI machine
    // is the dominant error otherwise.
    let coarse = Duration::from_micros(300);
    loop {
        let now = Instant::now();
        if now >= target {
            return;
        }
        let left = target - now;
        if left > coarse {
            std::thread::sleep(left - coarse);
        } else {
            std::thread::yield_now();
        }
    }
}

fn run(cfg: FakeConfig, mut engine: Engine, recorder: Option<Recorder>, stop: Arc<AtomicBool>) {
    let frames = cfg.buffer_frames as usize;
    let channels = cfg.channels.max(1);
    let mut buf = vec![0f32; frames * channels];
    let mut mono = vec![0f32; if recorder.is_some() { frames } else { 0 }];
    let period = Duration::from_secs_f64(frames as f64 / cfg.rate as f64 / (1.0 + cfg.drift_ppm * 1e-6));
    let mut rng = 0x9E37_79B9_7F4A_7C15u64;
    let start = Instant::now() + period;
    let mut n: u32 = 0;
    while !stop.load(Ordering::Relaxed) {
        let nominal = start + period * n;
        let mut target = nominal;
        if cfg.jitter_us > 0 {
            target += Duration::from_micros(next_rand(&mut rng) % (cfg.jitter_us as u64 + 1));
        }
        sleep_until(target);
        if stop.load(Ordering::Relaxed) {
            break;
        }
        let host_ns = host_clock::now_ns();
        let head = engine.head();
        engine.render(host_ns, &mut buf, channels);
        if let Some(r) = &recorder {
            for (m, f) in mono.iter_mut().zip(buf.chunks_exact(channels)) {
                *m = f[0];
            }
            r.push(head, mono.iter().copied());
        }
        n = n.wrapping_add(1);
    }
}

impl DeviceIo for FakeIo {
    fn open(&mut self, cfg: OpenConfig, make_engine: EngineFactory, events: Sender<DeviceEvent>) -> Result<OpenInfo, DeviceError> {
        if self.running.is_some() {
            return Err(DeviceError::AlreadyOpen);
        }
        let _ = cfg; // the fake runs at its own configured rate and buffer size
        host_clock::init();
        if self.config.rate == 0 || self.config.buffer_frames == 0 {
            return Err(DeviceError::Unsupported("fake device needs a rate and a buffer size".into()));
        }
        let engine = make_engine(self.config.rate);
        let stop = Arc::new(AtomicBool::new(false));
        let join = {
            let (config, recorder, stop) = (self.config.clone(), self.recorder.clone(), Arc::clone(&stop));
            std::thread::Builder::new()
                .name("sr-audio-fake".into())
                .spawn(move || run(config, engine, recorder, stop))
                .map_err(|e| DeviceError::Backend(e.to_string()))?
        };
        self.running = Some(Running { stop, join });
        self.events = Some(events);
        let facts = self.facts();
        let latency = LatencyReport::new(self.parts(), &facts.trust_facts());
        Ok(OpenInfo {
            engine_rate: self.config.rate,
            out_frames: self.config.buffer_frames,
            in_frames: None,
            input_rate: None,
            route: facts,
            latency,
            session_type: None,
        })
    }

    fn close(&mut self) {
        if let Some(r) = self.running.take() {
            r.stop.store(true, Ordering::Relaxed);
            let _ = r.join.join();
        }
        self.events = None;
    }

    fn route(&self) -> RouteFacts {
        self.facts()
    }

    fn latency(&self) -> LatencyParts {
        self.parts()
    }
}
