//! A thread-driven fake output device (feature `fake`). It calls [`Engine::render`] from its own thread in real
//! time: one callback per buffer, each started by a sleep-until loop on the monotonic host clock, with the
//! callback's `host_ns` read right after the wake-up, exactly as a real driver thread would.
//!
//! Two modes, chosen by `OpenConfig::input`:
//!
//! * Output only: a plain render loop. Any rate and buffer size, a clock that runs fast or slow by some ppm,
//!   per-callback wake-up jitter, a [`Recorder`] of what was rendered, interruptions on demand.
//! * Duplex (`input: true`): `sr_audio_core::sim::SimDuplex` driven in real time. One thread sleeps until
//!   `next_time_sec()` of the simulation (on the monotonic clock, `host0 = host_clock::now_ns()` at start) and
//!   runs the next callback. What the engine renders returns to the input after `loop_delay_ms` at `loop_gain`,
//!   plus an optional input signal. The recorder is not filled in this mode (the simulation does not expose
//!   its output buffer).
//!
//! The input signal (`FakeConfig::input_signal`, or `SR_FAKE_INPUT_F32` through [`FakeConfig::from_env`]) is raw
//! mono `f32` at the input rate. **Sample 0 is input frame `m0`, the first input frame whose value the
//! simulation asks for after [`DeviceIo::capture_requested`] returned**: that is the first frame of the next
//! input callback, so its engine position is the render head at that moment plus up to one buffer. The app calls
//! `capture_requested` from `audio_capture_start` (and from `audio_measure_loopback`) before it asks the engine
//! for the capture, so with settled clocks the capture's first sample is the same frame or one callback later:
//! signal sample 0 lands at packet 0 sample 0, or up to one buffer (`buffer_frames`) before it (then the first
//! samples of the file are not in the capture). It plays once and is followed by silence; it is added to the
//! looped-back output. An exact end-to-end test should therefore find a marker in the packets rather than assume
//! an offset, or start the file with that much silence.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use sr_audio_core::capture::ClockRelation;
use sr_audio_core::latency::{LatencyParts, LatencyReport, Transport};
use sr_audio_core::sim::{SimConfig, SimDuplex};
use sr_audio_core::Engine;

use crate::{
    current_platform, host_clock, DeviceError, DeviceEvent, DeviceIo, EngineFactory, InterruptionReason, OpenConfig, OpenInfo, RouteFacts, StreamKind,
};

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
    /// Run the duplex simulation even when opened with `input: false`, so that `set_input(true)` works later
    /// (the app sets this through [`FakeConfig::from_env`]).
    pub duplex: bool,
    /// Duplex only: input stream rate, Hz (`SR_FAKE_IN_RATE`).
    pub input_rate: u32,
    /// Duplex only: delay from output to input, milliseconds (`SR_FAKE_LOOP_MS`).
    pub loop_delay_ms: f64,
    /// Duplex only: gain of the looped-back output (`SR_FAKE_LOOP_GAIN`).
    pub loop_gain: f32,
    /// Duplex only: the input clock runs this many ppm fast against its nominal rate (`SR_FAKE_PPM`).
    pub in_ppm: f64,
    /// Duplex only: mono samples at `input_rate`, see the module text for sample 0 (`SR_FAKE_INPUT_F32`).
    pub input_signal: Option<Arc<[f32]>>,
}

impl Default for FakeConfig {
    fn default() -> Self {
        FakeConfig {
            rate: 48_000,
            buffer_frames: 256,
            channels: 2,
            drift_ppm: 0.0,
            jitter_us: 0,
            record_frames: 0,
            duplex: false,
            input_rate: 48_000,
            loop_delay_ms: 23.4,
            loop_gain: 0.5,
            in_ppm: 0.0,
            input_signal: None,
        }
    }
}

impl FakeConfig {
    /// The default configuration with the duplex settings of the environment applied: `SR_FAKE_LOOP_MS`,
    /// `SR_FAKE_LOOP_GAIN`, `SR_FAKE_IN_RATE`, `SR_FAKE_PPM`, `SR_FAKE_INPUT_F32` (path of a raw little-endian
    /// mono `f32` file at the input rate).
    pub fn from_env() -> Result<FakeConfig, String> {
        Self::from_lookup(|k| std::env::var(k).ok())
    }

    /// As [`FakeConfig::from_env`] with the variables read through `get` (tests).
    pub fn from_lookup(get: impl Fn(&str) -> Option<String>) -> Result<FakeConfig, String> {
        fn num<T: std::str::FromStr>(get: &impl Fn(&str) -> Option<String>, key: &str, into: &mut T) -> Result<(), String> {
            if let Some(v) = get(key) {
                *into = v.trim().parse().map_err(|_| format!("{key}: cannot parse {v:?}"))?;
            }
            Ok(())
        }
        let mut c = FakeConfig { duplex: true, ..FakeConfig::default() };
        num(&get, "SR_FAKE_LOOP_MS", &mut c.loop_delay_ms)?;
        num(&get, "SR_FAKE_LOOP_GAIN", &mut c.loop_gain)?;
        num(&get, "SR_FAKE_IN_RATE", &mut c.input_rate)?;
        num(&get, "SR_FAKE_PPM", &mut c.in_ppm)?;
        if let Some(path) = get("SR_FAKE_INPUT_F32") {
            let bytes = std::fs::read(&path).map_err(|e| format!("SR_FAKE_INPUT_F32 {path}: {e}"))?;
            if bytes.len() % 4 != 0 {
                return Err(format!("SR_FAKE_INPUT_F32 {path}: length is not a multiple of 4 bytes"));
            }
            c.input_signal = Some(bytes.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect());
        }
        Ok(c)
    }
}

/// The optional input signal and the moment it starts.
#[derive(Debug)]
struct SignalState {
    data: Arc<[f32]>,
    armed: AtomicBool,
    /// Input frame of sample 0; `u64::MAX` until the simulation first asks for a frame while armed.
    from: AtomicU64,
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
    /// Duplex mode only.
    duplex: Option<DuplexState>,
}

struct DuplexState {
    /// Whether the input counts as open (the simulation keeps feeding it either way).
    input_open: Arc<AtomicBool>,
    signal: Option<Arc<SignalState>>,
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
        FakeIo { config, recorder, running: None, events: None, duplex: None }
    }

    /// The recorder, when `record_frames > 0`. Valid before and after `open`.
    pub fn recorder(&self) -> Option<Recorder> {
        self.recorder.clone()
    }

    /// Raises an interruption as a failing stream would (no effect while closed).
    pub fn inject_interruption(&self, reason: InterruptionReason) {
        if let Some(tx) = &self.events {
            let _ = tx.send(DeviceEvent::Interruption { stream: StreamKind::Output, reason });
        }
    }

    fn input_open(&self) -> bool {
        self.duplex.as_ref().is_some_and(|d| d.input_open.load(Ordering::Relaxed))
    }

    fn facts(&self) -> RouteFacts {
        let input = self.input_open();
        RouteFacts {
            output_uid: "fake:output".into(),
            input_uid: input.then(|| "fake:input".to_string()),
            output_transport: Transport::Unknown,
            input_transport: input.then_some(Transport::Unknown),
            platform: current_platform(),
            direct_hardware: false,
            low_latency_feature: false,
        }
    }

    fn parts(&self) -> LatencyParts {
        LatencyParts {
            out_buffer: Some(self.config.buffer_frames as f64 / self.config.rate as f64),
            in_buffer: self.input_open().then(|| self.config.buffer_frames as f64 / self.config.input_rate as f64),
            ..LatencyParts::default()
        }
    }

    fn info(&self) -> OpenInfo {
        let facts = self.facts();
        let latency = LatencyReport::new(self.parts(), &facts.trust_facts());
        let input = self.input_open();
        OpenInfo {
            engine_rate: self.config.rate,
            out_frames: self.config.buffer_frames,
            in_frames: input.then_some(self.config.buffer_frames),
            input_rate: input.then_some(self.config.input_rate),
            // One simulated clock when nothing drifts; otherwise left to measurement.
            clock_relation: if input && self.config.in_ppm == 0.0 { ClockRelation::Shared } else { ClockRelation::Unknown },
            route: facts,
            latency,
            session_type: None,
        }
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

fn run_duplex(cfg: FakeConfig, engine: Engine, signal: Option<Arc<SignalState>>, stop: Arc<AtomicBool>) {
    let frames = cfg.buffer_frames as usize;
    let sim_config = SimConfig {
        engine_rate: cfg.rate,
        input_rate: cfg.input_rate,
        out_frames: frames,
        in_frames: frames,
        out_channels: cfg.channels.max(1),
        in_channels: 1,
        delay_sec: cfg.loop_delay_ms / 1000.0,
        loop_gain: cfg.loop_gain,
        in_ppm: cfg.in_ppm,
        host0_ns: host_clock::now_ns(),
        ..SimConfig::ideal(cfg.rate)
    };
    let start = Instant::now();
    let mut sim = SimDuplex::new(sim_config, engine);
    if let Some(sig) = signal {
        sim.set_input_signal(move |m, _t| {
            let mut from = sig.from.load(Ordering::Relaxed);
            if from == u64::MAX {
                if !sig.armed.load(Ordering::Relaxed) {
                    return 0.0;
                }
                sig.from.store(m, Ordering::Relaxed);
                from = m;
            }
            sig.data.get((m - from) as usize).copied().unwrap_or(0.0)
        });
    }
    while !stop.load(Ordering::Relaxed) {
        let t = sim.next_time_sec();
        sleep_until(start + Duration::from_secs_f64(t));
        if stop.load(Ordering::Relaxed) {
            break;
        }
        sim.step();
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
        let duplex = (cfg.input || self.config.duplex).then(|| DuplexState {
            input_open: Arc::new(AtomicBool::new(cfg.input)),
            signal: self.config.input_signal.clone().map(|data| Arc::new(SignalState { data, armed: AtomicBool::new(false), from: AtomicU64::new(u64::MAX) })),
        });
        let join = {
            let (config, recorder, stop) = (self.config.clone(), self.recorder.clone(), Arc::clone(&stop));
            let signal = duplex.as_ref().and_then(|d| d.signal.clone());
            let is_duplex = duplex.is_some();
            std::thread::Builder::new()
                .name("sr-audio-fake".into())
                .spawn(move || if is_duplex { run_duplex(config, engine, signal, stop) } else { run(config, engine, recorder, stop) })
                .map_err(|e| DeviceError::Backend(e.to_string()))?
        };
        self.running = Some(Running { stop, join });
        self.events = Some(events);
        self.duplex = duplex;
        Ok(self.info())
    }

    fn set_input(&mut self, enabled: bool) -> Result<OpenInfo, DeviceError> {
        match &self.duplex {
            // The simulation keeps feeding the capture half either way; only the reported state changes.
            Some(d) => d.input_open.store(enabled, Ordering::Relaxed),
            None if !enabled => {}
            None => return Err(DeviceError::Unsupported("the fake device runs output only unless opened with input: true".into())),
        }
        Ok(self.info())
    }

    fn capture_requested(&mut self) {
        if let Some(sig) = self.duplex.as_ref().and_then(|d| d.signal.as_ref()) {
            sig.from.store(u64::MAX, Ordering::Relaxed);
            sig.armed.store(true, Ordering::Relaxed);
        }
    }

    fn close(&mut self) {
        if let Some(r) = self.running.take() {
            r.stop.store(true, Ordering::Relaxed);
            let _ = r.join.join();
        }
        self.events = None;
        self.duplex = None;
    }

    fn route(&self) -> RouteFacts {
        self.facts()
    }

    fn latency(&self) -> LatencyParts {
        self.parts()
    }
}
