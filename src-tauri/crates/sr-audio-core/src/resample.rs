//! Variable-ratio resampling for the capture path (design section 2, "Resampled").
//!
//! * [`SincResampler`]: a windowed-sinc interpolator over a history of input samples. 32 taps, 64 phases with
//!   linear interpolation between neighbouring phases, Kaiser window. It evaluates the input at any fractional
//!   input position, so the ratio can change from sample to sample. The kernel is symmetric about the position
//!   asked for: the value returned for position `p` is the band-limited input at exactly `p`, with no group
//!   delay to subtract afterwards. What the 16-sample look-ahead costs is delivery time (0.33 ms at 48 kHz), not
//!   stamp accuracy.
//! * [`DriftController`]: steers the ratio (input frames per engine frame) so that the position being read
//!   follows the position the clocks ask for: feed-forward from the fitted clock rates, a PI term on the phase
//!   error, and a limit on how fast the ratio may change (50 ppm per second), so the pitch of what is captured
//!   never moves by more than a small fraction of a cent.
//!
//! Realtime: after construction (which allocates the table and the history) nothing allocates; reading one
//! sample is 32 multiply-adds.

use std::f64::consts::PI;

/// Kernel length, input samples.
pub const TAPS: usize = 32;
/// Phases per input sample in the coefficient table.
pub const PHASES: usize = 64;
/// Input samples the resampler needs after a position before it can be read (the look-ahead).
pub const LOOKAHEAD: u64 = (TAPS / 2) as u64;
/// Kaiser window shape. 11 gives a stopband below -100 dB with a transition band of ±0.115 of the input rate
/// about the cutoff (at 44.1 kHz: flat to 17 kHz, stopband from 27.1 kHz).
pub const KAISER_BETA: f64 = 11.0;
/// History kept, input samples (a power of two).
const HISTORY: usize = 4096;
/// Most samples one [`SincResampler::push`] takes.
pub const MAX_PUSH: usize = HISTORY - 2 * TAPS;

/// Modified Bessel function of the first kind, order 0.
fn bessel_i0(x: f64) -> f64 {
    let q = x * x / 4.0;
    let (mut sum, mut term) = (1.0, 1.0);
    for k in 1..64 {
        term *= q / (k as f64 * k as f64);
        sum += term;
        if term < sum * 1e-17 {
            break;
        }
    }
    sum
}

/// Kaiser window at `x` in `[-1, 1]` (0 outside), shape `beta`.
pub fn kaiser(x: f64, beta: f64) -> f64 {
    if x.abs() >= 1.0 {
        0.0
    } else {
        bessel_i0(beta * (1.0 - x * x).sqrt()) / bessel_i0(beta)
    }
}

/// `sin(pi x) / (pi x)`.
pub fn sinc(x: f64) -> f64 {
    if x.abs() < 1e-12 {
        1.0
    } else {
        (PI * x).sin() / (PI * x)
    }
}

/// Windowed-sinc interpolator over the last [`HISTORY`] input samples.
#[derive(Debug, Clone)]
pub struct SincResampler {
    /// `(PHASES + 1) * TAPS` coefficients; row `p` is the kernel for a fractional position of `p / PHASES`.
    table: Box<[f32]>,
    hist: Box<[f32]>,
    /// Index of the next input frame to be pushed (input frames, absolute).
    written: u64,
    /// Index of the first input frame ever pushed since the last reset.
    first: u64,
}

impl SincResampler {
    /// A resampler whose low-pass cutoff is `cutoff` times the input Nyquist frequency (1 when the output
    /// rate is at or above the input rate, `output / input` when it is below). Allocates.
    pub fn new(cutoff: f64) -> Self {
        let fc = cutoff.clamp(0.05, 1.0);
        let half = (TAPS / 2) as f64;
        let mut table = vec![0f32; (PHASES + 1) * TAPS];
        for p in 0..=PHASES {
            let frac = p as f64 / PHASES as f64;
            let mut row = [0f64; TAPS];
            let mut sum = 0.0;
            for (j, r) in row.iter_mut().enumerate() {
                // Tap j multiplies the input sample at offset j - 15 from floor(position).
                let d = frac - (j as f64 - (half - 1.0));
                *r = fc * sinc(fc * d) * kaiser(d / half, KAISER_BETA);
                sum += *r;
            }
            // Unit gain at 0 Hz for every phase.
            for (j, r) in row.iter().enumerate() {
                table[p * TAPS + j] = (r / sum) as f32;
            }
        }
        SincResampler { table: table.into(), hist: vec![0f32; HISTORY].into(), written: 0, first: 0 }
    }

    /// A resampler for input at `input_rate` Hz read at `output_rate` Hz.
    pub fn for_rates(input_rate: u32, output_rate: u32) -> Self {
        Self::new((output_rate as f64 / input_rate.max(1) as f64).min(1.0))
    }

    /// Forgets the history; the next sample pushed is input frame `first_frame`.
    pub fn reset(&mut self, first_frame: u64) {
        self.hist.fill(0.0);
        self.written = first_frame;
        self.first = first_frame;
    }

    /// Appends input samples (at most [`MAX_PUSH`]; more are ignored).
    pub fn push(&mut self, x: &[f32]) {
        for &s in x.iter().take(MAX_PUSH) {
            self.hist[(self.written as usize) & (HISTORY - 1)] = s;
            self.written += 1;
        }
    }

    /// Index of the next input frame to be pushed.
    pub fn written(&self) -> u64 {
        self.written
    }

    /// True when position `pos` (input frames) can be read: its look-ahead has been pushed and its oldest tap
    /// is still in the history.
    #[inline]
    pub fn can_read(&self, pos: f64) -> bool {
        if pos < 0.0 || pos.is_nan() {
            return false;
        }
        let i = pos.floor() as u64;
        i + LOOKAHEAD < self.written && i + (HISTORY as u64) > self.written + LOOKAHEAD
    }

    /// The band-limited input at position `pos` (input frames, fractional). Samples before the first one
    /// pushed count as 0. Call only when [`SincResampler::can_read`].
    #[inline]
    pub fn at(&self, pos: f64) -> f32 {
        let fl = pos.floor();
        let i = fl as u64;
        let ph = (pos - fl) * PHASES as f64;
        let p = (ph as usize).min(PHASES - 1);
        let w = (ph - p as f64) as f32;
        let (r0, r1) = (&self.table[p * TAPS..(p + 1) * TAPS], &self.table[(p + 1) * TAPS..(p + 2) * TAPS]);
        // Oldest tap: input frame i - 15. Frames before `first` were never written and read as the zeros
        // left by `reset`, except after the history has wrapped, when they are simply older samples; `can_read`
        // keeps the window inside what the history holds.
        let base = i.wrapping_sub(LOOKAHEAD - 1) as usize;
        let mut acc = 0f32;
        for j in 0..TAPS {
            let frame = i + j as u64;
            let x = if frame + 1 < self.first + LOOKAHEAD { 0.0 } else { self.hist[base.wrapping_add(j) & (HISTORY - 1)] };
            acc += x * (r0[j] + w * (r1[j] - r0[j]));
        }
        acc
    }
}

/// Largest change of the ratio per second, as a fraction of the ratio (50 ppm per second).
pub const MAX_RATIO_SLEW_PER_SEC: f64 = 50e-6;
/// Proportional gain: ratio correction (fraction) per second of phase error.
const KP: f64 = 1.0;
/// Integral gain: ratio correction (fraction) per second of phase error, per second.
const KI: f64 = 0.25;
/// The integral term is held within this fraction.
const MAX_INTEGRAL: f64 = 300e-6;

/// PI control of the resampling ratio with a slew limit. The loop is critically damped with a time constant
/// of 2 s, so a phase error left by a clock refit (some tens of microseconds) is taken out slowly and smoothly.
#[derive(Debug, Clone)]
pub struct DriftController {
    ratio: f64,
    integral: f64,
}

impl DriftController {
    /// Starts at `ratio` (input frames per engine frame).
    pub fn new(ratio: f64) -> Self {
        DriftController { ratio, integral: 0.0 }
    }

    /// The ratio in use, input frames per engine frame.
    pub fn ratio(&self) -> f64 {
        self.ratio
    }

    /// One control step. `feed_forward` is the ratio the clock fits give; `phase_error_sec` is how far the
    /// position being read is behind the position the clocks ask for, in seconds (positive: read faster);
    /// `dt_sec` is the time since the last step. Returns the new ratio, moved by at most
    /// [`MAX_RATIO_SLEW_PER_SEC`] `* dt_sec` of its value.
    pub fn update(&mut self, feed_forward: f64, phase_error_sec: f64, dt_sec: f64) -> f64 {
        if !(feed_forward.is_finite() && phase_error_sec.is_finite() && dt_sec > 0.0) {
            return self.ratio;
        }
        let target = feed_forward * (1.0 + KP * phase_error_sec + self.integral);
        let max_step = MAX_RATIO_SLEW_PER_SEC * dt_sec * self.ratio;
        let step = target - self.ratio;
        if step.abs() <= max_step {
            self.ratio = target;
            // Integrate only while the output follows the command (no wind-up behind the slew limit).
            self.integral = (self.integral + KI * phase_error_sec * dt_sec).clamp(-MAX_INTEGRAL, MAX_INTEGRAL);
        } else {
            self.ratio += max_step.copysign(step);
        }
        self.ratio
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Reads `n` output samples of a sine of `hz` sampled at `input_rate`, at `step` input frames per output.
    fn resample_sine(hz: f64, input_rate: f64, step: f64, n: usize, cutoff: f64) -> Vec<f64> {
        let mut r = SincResampler::new(cutoff);
        let mut out = Vec::with_capacity(n);
        let mut pos = 40.25; // start inside the signal, off the sample grid
        let mut m = 0u64;
        let mut chunk = [0f32; 480];
        while out.len() < n {
            for c in chunk.iter_mut() {
                *c = (2.0 * PI * hz * m as f64 / input_rate).sin() as f32;
                m += 1;
            }
            r.push(&chunk);
            while out.len() < n && r.can_read(pos) {
                out.push(r.at(pos) as f64);
                pos += step;
            }
        }
        out
    }

    /// Least-squares fit of a sine of `cycles_per_sample` to `y`: (amplitude, residual rms).
    fn fit_sine(y: &[f64], cycles_per_sample: f64) -> (f64, f64) {
        let w = 2.0 * PI * cycles_per_sample;
        let (mut ss, mut cc, mut sc, mut ys, mut yc) = (0.0, 0.0, 0.0, 0.0, 0.0);
        for (k, v) in y.iter().enumerate() {
            let (s, c) = (w * k as f64).sin_cos();
            ss += s * s;
            cc += c * c;
            sc += s * c;
            ys += v * s;
            yc += v * c;
        }
        let det = ss * cc - sc * sc;
        let (a, b) = ((ys * cc - yc * sc) / det, (yc * ss - ys * sc) / det);
        let mut res = 0.0;
        for (k, v) in y.iter().enumerate() {
            let (s, c) = (w * k as f64).sin_cos();
            res += (v - a * s - b * c).powi(2);
        }
        ((a * a + b * b).sqrt(), (res / y.len() as f64).sqrt())
    }

    #[test]
    fn resampler_response() {
        // (name, input rate, input frames per output frame, cutoff)
        let cases = [("48 kHz + 200 ppm to 48 kHz", 48_000.0 * 1.0002, 1.0002, 1.0 / 1.0002), ("44.1 kHz to 48 kHz", 44_100.0, 44_100.0 / 48_000.0, 1.0)];
        for (name, input_rate, step, cutoff) in cases {
            let output_rate = input_rate / step;
            let (mut worst_gain, mut worst_image) = (0f64, f64::NEG_INFINITY);
            for hz in [100.0, 440.0, 1000.0, 2000.0, 3000.0, 5000.0, 7000.0, 8000.0, 9000.0, 10_000.0] {
                let y = resample_sine(hz, input_rate, step, 24_000, cutoff);
                let (amp, residual) = fit_sine(&y, hz / output_rate);
                let gain_db = 20.0 * amp.log10();
                // Everything that is not the tone (all images and aliases together, and rounding noise),
                // relative to the tone. Each single image is at or below this.
                let image_db = 20.0 * (residual / (amp / 2f64.sqrt())).log10();
                worst_gain = if gain_db.abs() > worst_gain.abs() { gain_db } else { worst_gain };
                worst_image = worst_image.max(image_db);
                assert!(gain_db.abs() < 0.05, "{name} {hz} Hz: gain {gain_db} dB");
                assert!(image_db < -90.0, "{name} {hz} Hz: images {image_db} dB");
            }
            println!("resampler_response {name}: passband 100 Hz to 10 kHz within {worst_gain:+.5} dB (limit 0.05); images and aliases together at most {worst_image:.1} dB (limit -90)");
        }
    }

    #[test]
    fn resampler_reads_integer_positions_exactly_and_tracks_fractions() {
        let mut r = SincResampler::for_rates(48_000, 48_000);
        r.reset(1000);
        let x: Vec<f32> = (0..256).map(|i| ((i * 37 % 101) as f32 / 101.0) - 0.5).collect();
        r.push(&x);
        assert_eq!(r.written(), 1256);
        assert!(!r.can_read(1240.0) && r.can_read(1239.9) && r.can_read(1000.0) && !r.can_read(-1.0));
        // At an integer position the kernel is a unit impulse (cutoff 1): the stored sample comes back.
        let worst = (1000..1239).map(|m| (r.at(m as f64) - x[m - 1000]).abs()).fold(0f32, f32::max);
        assert!(worst < 1e-6, "{worst}");
        // A unit impulse read off the grid gives the kernel, which peaks at the impulse's position.
        let mut r = SincResampler::new(1.0);
        let mut imp = vec![0f32; 200];
        imp[100] = 1.0;
        r.push(&imp);
        let peak = (0..2000).map(|k| 90.0 + k as f64 * 0.01).max_by(|a, b| r.at(*a).total_cmp(&r.at(*b))).unwrap();
        assert!((peak - 100.0).abs() < 0.011, "{peak}");
        assert!((kaiser(0.0, 9.0) - 1.0).abs() < 1e-15 && kaiser(1.0, 9.0) == 0.0 && sinc(0.0) == 1.0 && sinc(2.0).abs() < 1e-15);
    }

    #[test]
    fn drift_controller_locks_and_limits_slew() {
        // The clocks say 1.0 but the input really runs 200 ppm fast: the loop must find 1.0002.
        let true_ratio = 1.0002;
        let mut c = DriftController::new(1.0);
        let dt = 128.0 / 48_000.0;
        let (mut phase, mut worst_slew, mut worst_phase) = (0f64, 0f64, 0f64);
        let mut prev = c.ratio();
        for k in 0..(60.0 / dt) as usize {
            // Phase error grows by the ratio error, in seconds per second.
            phase += (true_ratio - c.ratio()) * dt;
            let r = c.update(1.0, phase, dt);
            worst_slew = worst_slew.max((r - prev).abs() / dt);
            prev = r;
            if k as f64 * dt > 30.0 {
                worst_phase = worst_phase.max(phase.abs());
            }
        }
        println!("drift controller: 200 ppm unknown offset, ratio error {:+.3} ppm after 60 s, phase error {:.1} us after 30 s, largest slew {:.1} ppm/s", (c.ratio() / true_ratio - 1.0) * 1e6, worst_phase * 1e6, worst_slew * 1e6);
        assert!((c.ratio() / true_ratio - 1.0).abs() < 1e-6);
        assert!(worst_phase < 20e-6);
        assert!(worst_slew <= MAX_RATIO_SLEW_PER_SEC * 1.0003);
        // With the right feed-forward nothing moves.
        let mut c = DriftController::new(0.91875);
        for _ in 0..1000 {
            assert_eq!(c.update(0.91875, 0.0, dt), 0.91875);
        }
        assert_eq!(c.update(f64::NAN, 0.0, dt), 0.91875);
    }
}
