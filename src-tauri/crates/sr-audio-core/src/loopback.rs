//! Native loopback measurement (design section 5): play a known click a few times, find each one in the
//! captured input on the engine clock, and report the round trip.
//!
//! * [`LoopbackEstimator`]: the analysis. Capture and click are high-passed at 5 kHz (the band of the Tick
//!   click, away from voices and rumble) by the same filter, so its delay cancels; each click is found by a
//!   matched filter in a window after its scheduled frame; the peak is refined by a parabola; the result is the
//!   median lag, its median absolute deviation, and a signal-to-noise ratio.
//! * [`LoopbackDriver`]: the sequence around it, as a state machine the caller polls: start a capture,
//!   schedule the clicks through [`EngineHandle::schedule`], feed the full-rate capture packets to the
//!   estimator, stop, estimate. It runs on the control side; the audio thread only does what a capture and a
//!   few voices always cost.
//!
//! It measures on the single engine clock with no webview in the loop. It is a cross-check and a fast
//! pre-check; it does not write a calibration.

use std::f64::consts::PI;
use std::fmt;

use crate::capture::{CaptureConfig, CaptureError, CaptureEvent, CapturePath, CaptureReader, ClockRelation, DEFAULT_PACKET_FRAMES};
use crate::mixer::{AudioBuffer, Group, VoiceSpec};
use crate::synth::{render_click, ClickTimbre, Rng};
use crate::{ControlError, EngineHandle};

/// High-pass corner, Hz.
pub const HIGH_PASS_HZ: f64 = 5000.0;
/// Longest round trip searched, seconds. Shorter than the smallest gap between clicks, so a window never
/// holds the next click.
pub const MAX_LAG_SEC: f64 = 0.14;
/// A click counts as found when its matched-filter peak is this far above the rest of its window, dB.
/// Noise alone peaks at about 12.5 dB over the 6720 lags of a window.
pub const MIN_SNR_DB: f64 = 18.0;
/// Found clicks further than this from the median lag are not counted, seconds.
pub const MAX_SPREAD_SEC: f64 = 0.001;

/// The `LoopbackEstimate` of design section 3.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LoopbackEstimate {
    /// Clicks found in the capture.
    pub found: u32,
    /// Clicks scheduled.
    pub scheduled: u32,
    /// Median round trip of the found clicks, milliseconds; `None` when fewer than three were found.
    pub round_trip_ms: Option<f64>,
    /// Median absolute deviation of the found round trips, milliseconds.
    pub mad_ms: Option<f64>,
    /// Median matched-filter signal-to-noise ratio of the found clicks, dB.
    pub snr_db: Option<f64>,
    /// The round trip the reported latencies predict, milliseconds (passed in by the caller).
    pub predicted_ms: Option<f64>,
}

/// One click as found in the capture.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Arrival {
    /// Arrival minus scheduled start, seconds on the engine clock.
    pub lag_sec: f64,
    /// Matched-filter peak over the rest of the search window, dB.
    pub snr_db: f64,
}

/// Fourth-order Butterworth high-pass as two biquads (transposed direct form II).
#[derive(Debug, Clone)]
struct HighPass {
    /// `[b0, b1, b2, a1, a2]` per section.
    coef: [[f64; 5]; 2],
    state: [[f64; 2]; 2],
}

impl HighPass {
    fn new(hz: f64, rate: f64) -> Self {
        let w = 2.0 * PI * (hz / rate).min(0.49);
        let (sin, cos) = w.sin_cos();
        let section = |q: f64| {
            let alpha = sin / (2.0 * q);
            let a0 = 1.0 + alpha;
            [(1.0 + cos) / 2.0 / a0, -(1.0 + cos) / a0, (1.0 + cos) / 2.0 / a0, -2.0 * cos / a0, (1.0 - alpha) / a0]
        };
        // Butterworth pole pairs of order 4: Q = 1 / (2 cos(pi/8)), 1 / (2 cos(3 pi/8)).
        HighPass { coef: [section(0.541_196_100_146_197), section(1.306_562_964_876_376_5)], state: [[0.0; 2]; 2] }
    }

    fn run(&mut self, x: f32) -> f32 {
        let mut v = x as f64;
        for (c, s) in self.coef.iter().zip(self.state.iter_mut()) {
            let y = c[0] * v + s[0];
            s[0] = c[1] * v - c[3] * y + s[1];
            s[1] = c[2] * v - c[4] * y;
            v = y;
        }
        v as f32
    }
}

fn median(xs: &mut [f64]) -> f64 {
    xs.sort_by(|a, b| a.total_cmp(b));
    let m = xs.len() / 2;
    if xs.len() % 2 == 1 {
        xs[m]
    } else {
        (xs[m - 1] + xs[m]) / 2.0
    }
}

/// Finds scheduled clicks in a capture on the engine frame grid. Non-realtime (allocates, and an estimate
/// costs a few million multiply-adds per click).
#[derive(Debug, Clone)]
pub struct LoopbackEstimator {
    rate: f64,
    /// The click, high-passed, with the filter's tail.
    template: Vec<f32>,
    /// Scheduled start frames of the clicks.
    clicks: Vec<u64>,
    filter: HighPass,
    /// The capture, high-passed, from engine frame `origin`.
    capture: Vec<f32>,
    origin: Option<u64>,
}

impl LoopbackEstimator {
    /// An estimator for `click` (the samples that are played, at the engine rate) on an engine at
    /// `engine_rate` Hz.
    pub fn new(engine_rate: u32, click: &[f32]) -> Self {
        let rate = engine_rate as f64;
        let mut hp = HighPass::new(HIGH_PASS_HZ, rate);
        let tail = (0.002 * rate) as usize;
        let template = click.iter().copied().chain(std::iter::repeat(0.0).take(tail)).map(|x| hp.run(x)).collect();
        LoopbackEstimator { rate, template, clicks: Vec::new(), filter: HighPass::new(HIGH_PASS_HZ, rate), capture: Vec::new(), origin: None }
    }

    /// Registers a click whose first sample is written at engine frame `start_frame`.
    pub fn add_click(&mut self, start_frame: u64) {
        self.clicks.push(start_frame);
    }

    /// Number of clicks registered.
    pub fn scheduled(&self) -> usize {
        self.clicks.len()
    }

    /// Adds captured samples whose first one is engine frame `first_frame` (a packet's `firstFrame`). A gap
    /// is filled with silence; samples before what is already held are ignored.
    pub fn push(&mut self, first_frame: u64, samples: &[f32]) {
        let origin = *self.origin.get_or_insert(first_frame);
        let have = origin + self.capture.len() as u64;
        let skip = have.saturating_sub(first_frame) as usize;
        for _ in have..first_frame {
            let y = self.filter.run(0.0);
            self.capture.push(y);
        }
        for &x in samples.iter().skip(skip) {
            let y = self.filter.run(x);
            self.capture.push(y);
        }
    }

    /// Forgets the registered clicks and the capture (for a fresh attempt with the same click).
    pub fn clear(&mut self) {
        self.clicks.clear();
        self.capture.clear();
        self.origin = None;
        self.filter = HighPass::new(HIGH_PASS_HZ, self.rate);
    }

    /// The first engine frame not yet captured (`None` before the first push).
    pub fn captured_until(&self) -> Option<u64> {
        self.origin.map(|o| o + self.capture.len() as u64)
    }

    /// The engine frame up to which capture is needed to search for every registered click.
    pub fn needed_until(&self) -> Option<u64> {
        let last = *self.clicks.iter().max()?;
        Some(last + (MAX_LAG_SEC * self.rate) as u64 + self.template.len() as u64 + 1)
    }

    /// Searches for the click scheduled at `start_frame`: the strongest matched-filter peak with a lag of 0 to
    /// [`MAX_LAG_SEC`], and how far it stands above the rest of that window. `None` when the window is not
    /// inside the capture or holds no signal at all.
    pub fn arrival(&self, start_frame: u64) -> Option<Arrival> {
        let origin = self.origin?;
        let base = start_frame.checked_sub(origin)? as usize;
        let lags = (MAX_LAG_SEC * self.rate) as usize;
        let n = self.template.len();
        if base + lags + n > self.capture.len() {
            return None;
        }
        let corr: Vec<f64> = (0..lags)
            .map(|lag| {
                let x = &self.capture[base + lag..base + lag + n];
                x.iter().zip(&self.template).map(|(a, b)| *a as f64 * *b as f64).sum()
            })
            .collect();
        let (peak_lag, peak) = corr.iter().enumerate().fold((0, 0f64), |best, (i, c)| if c.abs() > best.1 { (i, c.abs()) } else { best });
        if peak <= 0.0 {
            return None;
        }
        // Background: the window outside the click's own correlation skirt.
        let (mut sum, mut count) = (0f64, 0usize);
        for (i, c) in corr.iter().enumerate() {
            if i.abs_diff(peak_lag) > n {
                sum += c * c;
                count += 1;
            }
        }
        let background = if count > 0 { (sum / count as f64).sqrt() } else { 0.0 };
        let snr_db = if background > 0.0 { 20.0 * (peak / background).log10() } else { f64::INFINITY };
        // Parabola through the peak and its neighbours (of the rectified correlation).
        let mut lag = peak_lag as f64;
        if peak_lag > 0 && peak_lag + 1 < lags {
            let (a, b, c) = (corr[peak_lag - 1].abs(), peak, corr[peak_lag + 1].abs());
            let denom = a - 2.0 * b + c;
            if denom < 0.0 {
                lag += (0.5 * (a - c) / denom).clamp(-0.5, 0.5);
            }
        }
        Some(Arrival { lag_sec: lag / self.rate, snr_db })
    }

    /// Every registered click's arrival, in registration order.
    pub fn arrivals(&self) -> Vec<Option<Arrival>> {
        self.clicks.iter().map(|c| self.arrival(*c)).collect()
    }

    /// The estimate over all registered clicks. `predicted_ms` is copied into the result.
    pub fn estimate(&self, predicted_ms: Option<f64>) -> LoopbackEstimate {
        let scheduled = self.clicks.len() as u32;
        let strong: Vec<Arrival> = self.arrivals().into_iter().flatten().filter(|a| a.snr_db >= MIN_SNR_DB).collect();
        let none = LoopbackEstimate { found: 0, scheduled, round_trip_ms: None, mad_ms: None, snr_db: None, predicted_ms };
        if strong.is_empty() {
            return none;
        }
        let centre = median(&mut strong.iter().map(|a| a.lag_sec).collect::<Vec<_>>());
        let found: Vec<Arrival> = strong.into_iter().filter(|a| (a.lag_sec - centre).abs() <= MAX_SPREAD_SEC).collect();
        if found.len() < 3 {
            return LoopbackEstimate { found: found.len() as u32, ..none };
        }
        let round_trip = median(&mut found.iter().map(|a| a.lag_sec).collect::<Vec<_>>());
        let mad = median(&mut found.iter().map(|a| (a.lag_sec - round_trip).abs()).collect::<Vec<_>>());
        let snr = median(&mut found.iter().map(|a| a.snr_db).collect::<Vec<_>>());
        LoopbackEstimate { found: found.len() as u32, scheduled, round_trip_ms: Some(round_trip * 1e3), mad_ms: Some(mad * 1e3), snr_db: Some(snr), predicted_ms }
    }
}

/// Parameters of a loopback run.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LoopbackConfig {
    /// Number of clicks (8).
    pub clicks: u32,
    /// Silence before the first click, seconds (0.2).
    pub lead_sec: f64,
    /// Smallest gap between click starts, seconds (0.15). Must be above [`MAX_LAG_SEC`].
    pub gap_min_sec: f64,
    /// Largest gap between click starts, seconds (0.25).
    pub gap_max_sec: f64,
    /// Linear gain of the clicks (the click is peak-normalised to 1).
    pub gain: f32,
    /// Seed of the random gaps.
    pub seed: u32,
    /// Buffer id to hold the click under while the run lasts; must not be in use.
    pub buffer_id: u32,
    /// Voice id of the first click; the others follow it.
    pub first_voice_id: u32,
    /// What is known about the two clocks (passed to the capture).
    pub relation: ClockRelation,
    /// The round trip the reported latencies predict, milliseconds; copied into the estimate.
    pub predicted_ms: Option<f64>,
    /// An attempt fails when it has not finished after this much engine time, seconds (6).
    pub timeout_sec: f64,
    /// How many times the run starts again after a clock step (an xrun) broke the capture (1). The voice ids
    /// of attempt `k` are `first_voice_id + k * clicks` onwards.
    pub retries: u32,
}

impl Default for LoopbackConfig {
    fn default() -> Self {
        LoopbackConfig {
            clicks: 8,
            lead_sec: 0.2,
            gap_min_sec: 0.15,
            gap_max_sec: 0.25,
            gain: 0.7,
            seed: 0x10_0b,
            buffer_id: 0xffff_ff00,
            first_voice_id: 0xffff_ff00,
            relation: ClockRelation::Unknown,
            predicted_ms: None,
            timeout_sec: 6.0,
            retries: 1,
        }
    }
}

/// Why a loopback run failed.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum LoopbackError {
    /// The capture could not be started or stopped.
    Capture(CaptureError),
    /// The clicks could not be scheduled.
    Control(ControlError),
    /// A click was scheduled behind the render head (the caller polled too rarely).
    Late,
    /// The capture did not start, or did not deliver, within the timeout (no input callbacks?).
    Timeout,
    /// The capture was stopped from outside, another capture was running, or a clock step (an xrun) broke
    /// it and no retry was left.
    Interrupted,
    /// The configuration is unusable (no clicks, or gaps not above the search window).
    BadConfig,
}

impl fmt::Display for LoopbackError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LoopbackError::Capture(e) => write!(f, "capture: {e}"),
            LoopbackError::Control(e) => write!(f, "scheduling: {e}"),
            LoopbackError::Late => f.write_str("a click was scheduled too late"),
            LoopbackError::Timeout => f.write_str("the capture did not deliver in time"),
            LoopbackError::Interrupted => f.write_str("the capture was interrupted"),
            LoopbackError::BadConfig => f.write_str("unusable loopback configuration"),
        }
    }
}

impl std::error::Error for LoopbackError {}

/// Where a run is.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum LoopbackStatus {
    /// Still running: poll again in about 10 ms.
    Running,
    /// Finished.
    Done(LoopbackEstimate),
    /// Failed; the capture has been asked to stop and the click buffer is dropped.
    Failed(LoopbackError),
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Phase {
    WaitingForCapture,
    Capturing,
    Stopping,
    /// A clock step broke the attempt: waiting for the capture to stop before starting the next one.
    Restarting,
    Finished(LoopbackStatus),
}

/// Runs one loopback measurement (`audio_measure_loopback`). No capture may be running, and none may be
/// started, while it lasts (about 2 s). When a clock step (an xrun on either stream) breaks the capture, the
/// run starts again, once (`LoopbackConfig::retries`); a second step fails it with `Interrupted`.
#[derive(Debug)]
pub struct LoopbackDriver {
    config: LoopbackConfig,
    estimator: LoopbackEstimator,
    phase: Phase,
    path: Option<CapturePath>,
    /// Attempts begun so far (1 = no retry yet).
    attempts: u32,
    deadline_frame: u64,
    bytes: Vec<u8>,
    samples: Vec<f32>,
}

impl LoopbackDriver {
    /// Renders the click (`tick`, as calibration uses), stores it under `config.buffer_id` and asks for a
    /// capture. Then call [`LoopbackDriver::poll`] until it is done.
    pub fn start(handle: &mut EngineHandle, capture: &mut CaptureReader, config: LoopbackConfig) -> Result<Self, LoopbackError> {
        if config.clicks == 0 || config.gap_min_sec <= MAX_LAG_SEC || config.gap_max_sec < config.gap_min_sec {
            return Err(LoopbackError::BadConfig);
        }
        let rate = handle.engine_rate();
        let click = render_click(ClickTimbre::Tick, false, rate);
        let estimator = LoopbackEstimator::new(rate, &click);
        capture.start(CaptureConfig { packet_frames: DEFAULT_PACKET_FRAMES, relation: config.relation }).map_err(LoopbackError::Capture)?;
        handle.put_buffer(config.buffer_id, AudioBuffer::new(click, rate));
        let deadline_frame = handle.clock().frames_rendered() + (config.timeout_sec * rate as f64) as u64;
        Ok(LoopbackDriver { config, estimator, phase: Phase::WaitingForCapture, path: None, attempts: 1, deadline_frame, bytes: Vec::new(), samples: Vec::new() })
    }

    /// The capture path of the run, once the capture has started.
    pub fn path(&self) -> Option<CapturePath> {
        self.path
    }

    /// Attempts begun so far: 1, or 2 when a clock step made the run start again.
    pub fn attempts(&self) -> u32 {
        self.attempts
    }

    fn voice_ids(&self) -> Vec<u32> {
        let base = self.config.first_voice_id.wrapping_add((self.attempts - 1).wrapping_mul(self.config.clicks));
        (0..self.config.clicks).map(|k| base.wrapping_add(k)).collect()
    }

    /// The estimator (for diagnostics: per-click arrivals).
    pub fn estimator(&self) -> &LoopbackEstimator {
        &self.estimator
    }

    fn fail(&mut self, handle: &mut EngineHandle, capture: &mut CaptureReader, error: LoopbackError) -> LoopbackStatus {
        let _ = capture.stop();
        let _ = handle.stop_voices(&self.voice_ids(), 0.0);
        handle.drop_buffers(&[self.config.buffer_id]);
        self.phase = Phase::Finished(LoopbackStatus::Failed(error));
        LoopbackStatus::Failed(error)
    }

    /// Advances the run: takes capture events and packets, schedules the clicks once the capture has
    /// started, stops the capture when every click's window is in, and estimates. Never blocks.
    pub fn poll(&mut self, handle: &mut EngineHandle, capture: &mut CaptureReader) -> LoopbackStatus {
        if let Phase::Finished(status) = self.phase {
            return status;
        }
        let rate = handle.engine_rate() as f64;
        let mut stopped = false;
        while let Some(event) = capture.poll_event() {
            match event {
                CaptureEvent::Started { path, .. } if self.phase == Phase::WaitingForCapture => {
                    self.path = Some(path);
                    let mut rng = Rng::new(self.config.seed);
                    let mut t = handle.clock().frames_rendered() as f64 / rate + self.config.lead_sec;
                    let mut specs = Vec::with_capacity(self.config.clicks as usize);
                    for (k, id) in self.voice_ids().into_iter().enumerate() {
                        if k > 0 {
                            t += rng.uniform(self.config.gap_min_sec, self.config.gap_max_sec);
                        }
                        specs.push(VoiceSpec { gain: self.config.gain, ..VoiceSpec::new(id, self.config.buffer_id, t) });
                        self.estimator.add_click(crate::mixer::frame_of(t, rate));
                    }
                    match handle.schedule(Group::Sounds, &specs) {
                        Ok(outcome) if outcome.late.is_empty() => self.phase = Phase::Capturing,
                        Ok(_) => return self.fail(handle, capture, LoopbackError::Late),
                        Err(e) => return self.fail(handle, capture, LoopbackError::Control(e)),
                    }
                }
                CaptureEvent::Stopped(_) if self.phase == Phase::Restarting => {
                    // The broken attempt is over. Throw away what is left of its packets and start again.
                    while capture.read_packet(&mut self.bytes) {}
                    self.estimator.clear();
                    self.attempts += 1;
                    self.path = None;
                    self.deadline_frame = handle.clock().frames_rendered() + (self.config.timeout_sec * rate) as u64;
                    if let Err(e) = capture.start(CaptureConfig { packet_frames: DEFAULT_PACKET_FRAMES, relation: self.config.relation }) {
                        return self.fail(handle, capture, LoopbackError::Capture(e));
                    }
                    self.phase = Phase::WaitingForCapture;
                }
                CaptureEvent::Stopped(_) => stopped = true,
                CaptureEvent::ClockStep { .. } if self.phase == Phase::Restarting => {}
                CaptureEvent::ClockStep { .. } => {
                    // An xrun moved a stream against the clock: what was captured cannot be trusted. Once,
                    // the whole measurement starts again.
                    if self.attempts > self.config.retries {
                        return self.fail(handle, capture, LoopbackError::Interrupted);
                    }
                    let _ = handle.stop_voices(&self.voice_ids(), 0.0);
                    if self.phase != Phase::Stopping {
                        if let Err(e) = capture.stop() {
                            return self.fail(handle, capture, LoopbackError::Capture(e));
                        }
                    }
                    self.phase = Phase::Restarting;
                }
                CaptureEvent::StartIgnored if self.phase == Phase::WaitingForCapture => {
                    // Another capture is running: this run cannot have the input.
                    handle.drop_buffers(&[self.config.buffer_id]);
                    self.phase = Phase::Finished(LoopbackStatus::Failed(LoopbackError::Interrupted));
                    return LoopbackStatus::Failed(LoopbackError::Interrupted);
                }
                _ => {}
            }
        }
        loop {
            self.samples.clear();
            let Some(header) = capture.read_decoded(&mut self.bytes, &mut self.samples) else { break };
            if self.phase != Phase::Restarting {
                self.estimator.push(header.first_frame as u64, &self.samples);
            }
        }
        match self.phase {
            Phase::Capturing => {
                if let (Some(have), Some(need)) = (self.estimator.captured_until(), self.estimator.needed_until()) {
                    if have >= need {
                        if let Err(e) = capture.stop() {
                            return self.fail(handle, capture, LoopbackError::Capture(e));
                        }
                        self.phase = Phase::Stopping;
                    }
                }
                if stopped {
                    return self.fail(handle, capture, LoopbackError::Interrupted);
                }
            }
            Phase::Stopping if stopped => {
                handle.drop_buffers(&[self.config.buffer_id]);
                let status = LoopbackStatus::Done(self.estimator.estimate(self.config.predicted_ms));
                self.phase = Phase::Finished(status);
                return status;
            }
            _ => {}
        }
        if handle.clock().frames_rendered() > self.deadline_frame {
            return self.fail(handle, capture, LoopbackError::Timeout);
        }
        LoopbackStatus::Running
    }
}
