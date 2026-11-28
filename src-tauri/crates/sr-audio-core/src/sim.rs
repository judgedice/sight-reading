//! A simulated duplex device in virtual time (feature `sim`; always built for the crate's own tests).
//!
//! It drives [`Engine::render`] and [`CaptureHalf::capture`] the way two device streams would: each stream has
//! its own true rate (nominal rate and an error in ppm), buffer size, late-callback jitter and stalls, and
//! both callbacks read one host clock. What the engine renders is fed back to the input after a delay, through
//! a band-limited interpolator, with optional noise and an external signal added. Nothing sleeps and nothing
//! reads a real clock: time advances from callback to callback, and a seed fixes every random choice.
//!
//! The model, in true time `t` (seconds since the simulation began; `host_ns = host0_ns + t * 1e9`):
//!
//! * Output: callback `k` is due at `k * out_frames / f_out` and asks for engine frames
//!   `[k * out_frames, (k + 1) * out_frames)`. So the render head at time `t` is `f_out * t`, and engine frame
//!   `n` belongs to time `n / f_out`.
//! * Loop: what is written at engine frame `n` reaches the input at time `n / f_out + delay_sec`.
//! * Input: frame `m` is sampled at `input_start_sec + m / f_in` and delivered by the callback that is due
//!   when its buffer is complete. So `m` input frames have been delivered at the time frame `m` is sampled.
//!
//! With these, the engine position of input frame `m` is `f_out * (input_start_sec + m / f_in)`
//! ([`SimDuplex::true_engine_pos`]), and a sound scheduled at engine time `t` arrives at engine time
//! `t + delay_sec` exactly: the truth the capture tests compare against.
//!
//! Not modelled: output underruns (a late render is simply late), output stream restarts.

use std::f64::consts::PI;

use crate::resample::{kaiser, sinc};
use crate::synth::Rng;
use crate::{CaptureHalf, Engine};

/// Parameters of the simulated device.
#[derive(Debug, Clone, PartialEq)]
pub struct SimConfig {
    /// Nominal output rate, Hz; must be the engine's rate.
    pub engine_rate: u32,
    /// Nominal input rate, Hz.
    pub input_rate: u32,
    /// Output callback size, frames.
    pub out_frames: usize,
    /// Input callback size, frames.
    pub in_frames: usize,
    /// Output channels (every channel is rendered; channel 0 is looped back).
    pub out_channels: usize,
    /// Input channels (every channel carries the same signal).
    pub in_channels: usize,
    /// Output-to-input delay, seconds: the round trip on the engine clock.
    pub delay_sec: f64,
    /// Gain of the loop from output to input (0 = no path).
    pub loop_gain: f32,
    /// True output rate error against the host clock, ppm.
    pub out_ppm: f64,
    /// True input rate error against the host clock, ppm.
    pub in_ppm: f64,
    /// Each callback runs 0 to this many milliseconds late (uniform).
    pub jitter_ms: f64,
    /// Every this many callbacks a stream stalls and four callbacks run back to back (0 = never).
    pub burst_every: u32,
    /// RMS of white Gaussian noise added to the input (0 = none).
    pub noise_rms: f32,
    /// Time at which input frame 0 is sampled, seconds.
    pub input_start_sec: f64,
    /// Seed of every random choice.
    pub seed: u32,
    /// Host clock reading at time 0, nanoseconds.
    pub host0_ns: u64,
}

impl SimConfig {
    /// An ideal duplex device: both streams at `rate` Hz, 128-frame buffers, stereo out, mono in, no loop,
    /// no rate error, no jitter.
    pub fn ideal(rate: u32) -> Self {
        SimConfig {
            engine_rate: rate,
            input_rate: rate,
            out_frames: 128,
            in_frames: 128,
            out_channels: 2,
            in_channels: 1,
            delay_sec: 0.0,
            loop_gain: 0.0,
            out_ppm: 0.0,
            in_ppm: 0.0,
            jitter_ms: 0.0,
            burst_every: 0,
            noise_rms: 0.0,
            input_start_sec: 0.0,
            seed: 1,
            host0_ns: 3_000_000_000_000,
        }
    }
}

/// Which callback a step ran.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SimStream {
    /// The output callback ([`Engine::render`]).
    Output,
    /// The input callback ([`CaptureHalf::capture`]).
    Input,
}

/// One callback that was run.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SimStep {
    /// Which callback.
    pub stream: SimStream,
    /// True time at which it ran, seconds.
    pub time_sec: f64,
    /// The host clock reading it was given, nanoseconds.
    pub host_ns: u64,
}

/// When the callbacks of one stream run.
#[derive(Debug, Clone)]
struct Timer {
    period_sec: f64,
    /// Due time of callback 0, seconds.
    start_sec: f64,
    /// Time lost to stalls, seconds.
    lost_sec: f64,
    jitter_ms: f64,
    burst_every: u32,
    rng: Rng,
    k: u64,
    burst_left: u32,
    burst_sec: f64,
    last_sec: f64,
    pending: Option<f64>,
}

impl Timer {
    fn new(period_sec: f64, start_sec: f64, jitter_ms: f64, burst_every: u32, seed: u32) -> Self {
        Timer { period_sec, start_sec, lost_sec: 0.0, jitter_ms, burst_every, rng: Rng::new(seed), k: 0, burst_left: 0, burst_sec: 0.0, last_sec: f64::NEG_INFINITY, pending: None }
    }

    fn due(&self, k: u64) -> f64 {
        self.start_sec + self.lost_sec + k as f64 * self.period_sec
    }

    /// The time at which the next callback runs.
    fn peek(&mut self) -> f64 {
        if let Some(t) = self.pending {
            return t;
        }
        let jitter = |rng: &mut Rng, ms: f64| if ms > 0.0 { rng.uniform(0.0, ms) * 1e-3 } else { 0.0 };
        let mut t = if self.burst_left > 0 {
            self.burst_left -= 1;
            self.burst_sec += 20e-6; // back to back, 20 us apart
            self.burst_sec
        } else if self.burst_every > 0 && self.k > 0 && self.k % self.burst_every as u64 == 0 {
            // A stall: this callback and the next three all run when the fourth is due.
            self.burst_left = 3;
            self.burst_sec = self.due(self.k + 3) + jitter(&mut self.rng, self.jitter_ms);
            self.burst_sec
        } else {
            self.due(self.k) + jitter(&mut self.rng, self.jitter_ms)
        };
        if t <= self.last_sec {
            t = self.last_sec + 1e-6;
        }
        self.pending = Some(t);
        t
    }

    fn take(&mut self) -> f64 {
        let t = self.peek();
        self.pending = None;
        self.last_sec = t;
        self.k += 1;
        t
    }
}

const HISTORY: usize = 1 << 17;
/// Half-width of the loop's interpolation kernel, output frames.
const LOOP_HALF: i64 = 32;
const LOOP_BETA: f64 = 12.0;
const LOOP_TAPS: usize = 2 * LOOP_HALF as usize;
/// Phases of the loop kernel table per output frame (linear interpolation between them: images below -120 dB).
const LOOP_PHASES: usize = 512;

/// The loop's interpolation kernel for a cutoff of `fc` times the output Nyquist: `(LOOP_PHASES + 1)` rows of
/// `LOOP_TAPS` coefficients; row `p`, tap `j` weighs the output frame at offset `j + 1 - LOOP_HALF` from the
/// floor of a position whose fraction is `p / LOOP_PHASES`. Every row sums to 1.
fn loop_table(fc: f64) -> Box<[f64]> {
    let mut table = vec![0f64; (LOOP_PHASES + 1) * LOOP_TAPS];
    for p in 0..=LOOP_PHASES {
        let frac = p as f64 / LOOP_PHASES as f64;
        let row = &mut table[p * LOOP_TAPS..(p + 1) * LOOP_TAPS];
        let mut sum = 0.0;
        for (j, r) in row.iter_mut().enumerate() {
            let d = frac - (j as f64 + 1.0 - LOOP_HALF as f64);
            *r = fc * sinc(fc * d) * kaiser(d / LOOP_HALF as f64, LOOP_BETA);
            sum += *r;
        }
        for r in row.iter_mut() {
            *r /= sum;
        }
    }
    table.into()
}

type InputSignal = Box<dyn FnMut(u64, f64) -> f32 + Send>;

/// The simulated device with the engine's two realtime halves inside it.
pub struct SimDuplex {
    config: SimConfig,
    engine: Engine,
    capture: CaptureHalf,
    out_timer: Timer,
    in_timer: Timer,
    f_out: f64,
    f_in: f64,
    /// Engine frames rendered so far.
    rendered: u64,
    /// Input frames delivered so far.
    delivered: u64,
    /// Mono history of the output, indexed by engine frame modulo its length.
    history: Box<[f32]>,
    loop_table: Box<[f64]>,
    out_buf: Vec<f32>,
    in_buf: Vec<f32>,
    signal: Option<InputSignal>,
    noise: Rng,
    time_sec: f64,
    host_ns: u64,
    underruns: u64,
}

impl std::fmt::Debug for SimDuplex {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SimDuplex").field("time_sec", &self.time_sec).field("rendered", &self.rendered).field("delivered", &self.delivered).finish_non_exhaustive()
    }
}

impl SimDuplex {
    /// Wraps `engine` (whose rate must be `config.engine_rate`). Takes the engine's capture half and sets its
    /// input rate. Keep the engine's handle; the simulation only plays the device.
    ///
    /// # Panics
    /// When the engine's rate is not `config.engine_rate`, a buffer size or channel count is 0, or the
    /// capture half has already been taken.
    pub fn new(config: SimConfig, mut engine: Engine) -> Self {
        assert_eq!(engine.engine_rate(), config.engine_rate, "the simulated output runs at the engine's rate");
        assert!(config.out_frames > 0 && config.in_frames > 0 && config.out_channels > 0 && config.in_channels > 0);
        let mut capture = engine.split_capture().expect("the engine still holds its capture half");
        capture.set_input_rate(config.input_rate);
        let f_out = config.engine_rate as f64 * (1.0 + config.out_ppm * 1e-6);
        let f_in = config.input_rate as f64 * (1.0 + config.in_ppm * 1e-6);
        let out_period = config.out_frames as f64 / f_out;
        let in_period = config.in_frames as f64 / f_in;
        SimDuplex {
            out_timer: Timer::new(out_period, 0.0, config.jitter_ms, config.burst_every, config.seed),
            // An input buffer is delivered when its last frame has been sampled.
            in_timer: Timer::new(in_period, config.input_start_sec + in_period, config.jitter_ms, config.burst_every, config.seed ^ 0x5bd1_e995),
            f_out,
            f_in,
            rendered: 0,
            delivered: 0,
            history: vec![0f32; HISTORY].into(),
            // Band-limited to the lower of the two rates, as an input converter would be.
            loop_table: loop_table((f_in / f_out).min(1.0)),
            out_buf: vec![0f32; config.out_frames * config.out_channels],
            in_buf: vec![0f32; config.in_frames * config.in_channels],
            signal: None,
            noise: Rng::new(config.seed ^ 0x9e37_79b9),
            time_sec: 0.0,
            host_ns: config.host0_ns,
            underruns: 0,
            engine,
            capture,
            config,
        }
    }

    /// The configuration.
    pub fn config(&self) -> &SimConfig {
        &self.config
    }

    /// Adds an external signal to the input: `signal(m, t)` is the value of input frame `m`, sampled at true
    /// time `t` seconds.
    pub fn set_input_signal(&mut self, signal: impl FnMut(u64, f64) -> f32 + Send + 'static) {
        self.signal = Some(Box::new(signal));
    }

    /// True output and input rates, frames per second of host time.
    pub fn true_rates(&self) -> (f64, f64) {
        (self.f_out, self.f_in)
    }

    /// True time at which input frame `m` is sampled, seconds.
    pub fn true_input_time(&self, m: f64) -> f64 {
        self.config.input_start_sec + self.in_timer.lost_sec + m / self.f_in
    }

    /// The engine position (frames) at which input frame `m` is sampled: what `p(m)` should be.
    pub fn true_engine_pos(&self, m: f64) -> f64 {
        self.f_out * self.true_input_time(m)
    }

    /// Virtual time now, seconds: the later of the last callback run and the last [`SimDuplex::run_until`]
    /// target.
    pub fn time_sec(&self) -> f64 {
        self.time_sec
    }

    /// Host clock reading of the last callback run, nanoseconds.
    pub fn host_ns(&self) -> u64 {
        self.host_ns
    }

    /// True time at which the next callback will run, seconds (for a caller that paces it in real time).
    pub fn next_time_sec(&mut self) -> f64 {
        self.out_timer.peek().min(self.in_timer.peek())
    }

    /// Engine frames rendered and input frames delivered so far.
    pub fn frames(&self) -> (u64, u64) {
        (self.rendered, self.delivered)
    }

    /// Input samples that needed output not yet rendered (callbacks later than the loop delay). 0 in a sound
    /// test.
    pub fn underruns(&self) -> u64 {
        self.underruns
    }

    /// The input device stalls for `sec` seconds, as in an xrun: the frames it would have sampled meanwhile
    /// are never delivered, so every later input frame is sampled, and delivered, that much later.
    pub fn lose_input(&mut self, sec: f64) {
        self.in_timer.lost_sec += sec;
        self.in_timer.pending = None;
    }

    /// The interleaved buffer the last output callback rendered (`out_frames * out_channels` samples; silence
    /// before the first output callback). For a device wrapper that plays or inspects what was rendered.
    pub fn last_output(&self) -> &[f32] {
        &self.out_buf
    }

    /// [`CaptureHalf::capture_origin_input_frame`] of the capture half inside.
    pub fn capture_origin_input_frame(&self) -> Option<u64> {
        self.capture.capture_origin_input_frame()
    }

    /// The engine (render half).
    pub fn engine(&self) -> &Engine {
        &self.engine
    }

    /// The capture half.
    pub fn capture(&self) -> &CaptureHalf {
        &self.capture
    }

    /// Runs callbacks until the next one would be after `time_sec`.
    pub fn run_until(&mut self, time_sec: f64) {
        while self.next_time_sec() <= time_sec {
            self.step();
        }
        self.time_sec = self.time_sec.max(time_sec);
    }

    /// Runs callbacks for `sec` seconds of virtual time from [`SimDuplex::time_sec`].
    pub fn run_for(&mut self, sec: f64) {
        let until = self.time_sec + sec;
        self.run_until(until);
    }

    /// Runs the next callback (the output one when both are due at the same instant).
    pub fn step(&mut self) -> SimStep {
        let stream = if self.out_timer.peek() <= self.in_timer.peek() { SimStream::Output } else { SimStream::Input };
        let t = match stream {
            SimStream::Output => self.out_timer.take(),
            SimStream::Input => self.in_timer.take(),
        };
        self.time_sec = t;
        self.host_ns = self.config.host0_ns + (t * 1e9).round() as u64;
        match stream {
            SimStream::Output => {
                self.engine.render(self.host_ns, &mut self.out_buf, self.config.out_channels);
                for frame in self.out_buf.chunks_exact(self.config.out_channels) {
                    self.history[(self.rendered as usize) & (HISTORY - 1)] = frame[0];
                    self.rendered += 1;
                }
            }
            SimStream::Input => {
                let channels = self.config.in_channels;
                // Engine position whose sound reaches input frame m: ratio * m + offset.
                let ratio = self.f_out / self.f_in;
                let offset = self.f_out * (self.config.input_start_sec + self.in_timer.lost_sec - self.config.delay_sec);
                for i in 0..self.config.in_frames {
                    let m = self.delivered + i as u64;
                    let mut x = 0f32;
                    if self.config.loop_gain != 0.0 {
                        x += self.config.loop_gain * self.looped(m as f64 * ratio + offset, ratio);
                    }
                    if let Some(signal) = self.signal.as_mut() {
                        x += signal(m, self.config.input_start_sec + self.in_timer.lost_sec + m as f64 / self.f_in);
                    }
                    if self.config.noise_rms > 0.0 {
                        // Box-Muller.
                        let (u1, u2) = (self.noise.next_f64().max(1e-300), self.noise.next_f64());
                        x += self.config.noise_rms * ((-2.0 * u1.ln()).sqrt() * (2.0 * PI * u2).cos()) as f32;
                    }
                    self.in_buf[i * channels..(i + 1) * channels].fill(x);
                }
                self.delivered += self.config.in_frames as u64;
                self.capture.capture(self.host_ns, &self.in_buf, channels);
            }
        }
        SimStep { stream, time_sec: t, host_ns: self.host_ns }
    }

    /// The output at engine position `pos` (fractional): the stored sample at an integer position, otherwise
    /// a 64-tap Kaiser-windowed sinc from a table, band-limited to the lower of the two rates.
    fn looped(&mut self, pos: f64, ratio: f64) -> f32 {
        let sample = |sim: &mut Self, n: i64| -> f64 {
            if n < 0 || (n as u64) + (HISTORY as u64) <= sim.rendered {
                0.0
            } else if n as u64 >= sim.rendered {
                sim.underruns += 1;
                0.0
            } else {
                sim.history[(n as usize) & (HISTORY - 1)] as f64
            }
        };
        let fl = pos.floor();
        let frac = pos - fl;
        let i = fl as i64;
        if frac == 0.0 && ratio == 1.0 {
            return sample(self, i) as f32;
        }
        let ph = frac * LOOP_PHASES as f64;
        let p = (ph as usize).min(LOOP_PHASES - 1);
        let w = ph - p as f64;
        let mut acc = 0f64;
        for j in 0..LOOP_TAPS {
            let h = self.loop_table[p * LOOP_TAPS + j] + w * (self.loop_table[(p + 1) * LOOP_TAPS + j] - self.loop_table[p * LOOP_TAPS + j]);
            acc += h * sample(self, i + j as i64 + 1 - LOOP_HALF);
        }
        acc as f32
    }
}
