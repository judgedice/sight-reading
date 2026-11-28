//! Clocks (design section 2).
//!
//! * [`StreamClock`]: fits stream frames against a monotonic host clock from one observation per device
//!   callback, rejecting late callbacks and bursts.
//! * [`ClockBridge`]: the output clock `R(h)` (render head at host time `h`) that defines engine time.
//! * [`ClockAnchor`]: what the webview needs to compute `now()`.
//! * [`fit_clock_window`] and [`RateCheck`]: the clock-rate check, a port of `clock-fit.ts`.
//!
//! `StreamClock` and `ClockBridge` are used on the audio thread: fixed-size arrays, no allocation, no locks, and
//! a refit costs at most a few passes over [`WINDOW_BUCKETS`] points. The rate check allocates and belongs to
//! the non-realtime side.

use std::collections::VecDeque;

/// Width of one bucket of host time, nanoseconds (100 ms).
pub const BUCKET_NS: u64 = 100_000_000;
/// Number of closed buckets kept (a 4 s sliding window).
pub const WINDOW_BUCKETS: usize = 40;
/// Host time between refits, nanoseconds (250 ms).
pub const REFIT_NS: u64 = 250_000_000;
/// The slope is taken from the data once the kept points span this much host time, seconds. Before that the
/// nominal rate is used, because two nearby points give a slope hundreds of ppm off.
pub const MIN_SLOPE_SPAN_SEC: f64 = 1.0;
/// Width of one bucket of the long window that steadies the slope, nanoseconds (1 s).
pub const LONG_BUCKET_NS: u64 = 1_000_000_000;
/// Number of closed buckets of the long window (32 s).
pub const LONG_BUCKETS: usize = 32;
/// The long window sets the slope once it holds this many points.
pub const LONG_MIN_POINTS: usize = 8;
/// A step is declared when the newest [`STEP_RECENT_BUCKETS`] buckets sit this far, in seconds of stream time,
/// above or below the line through the older ones (an xrun: the stream lost or gained time for good).
pub const STEP_SEC: f64 = 0.0005;
/// Number of newest buckets compared with the older ones to find a step.
pub const STEP_RECENT_BUCKETS: usize = 5;
/// A fitted slope further than this fraction from nominal is not believed.
const MAX_SLOPE_DEVIATION: f64 = 0.25;

/// What the webview needs to follow engine time: `engine(hostMs') = engine_sec + (hostMs' - host_ms) / 1000 * rate`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ClockAnchor {
    /// Render head at `host_ms`, engine seconds.
    pub engine_sec: f64,
    /// Host monotonic time of the anchor, milliseconds (the `host_ns` clock of the callbacks, divided by 1e6).
    pub host_ms: f64,
    /// Engine seconds per host second (1 ± a few 1e-5 on real hardware).
    pub rate: f64,
}

impl ClockAnchor {
    /// Engine time at host time `host_ms`, seconds.
    pub fn engine_sec_at(&self, host_ms: f64) -> f64 {
        self.engine_sec + (host_ms - self.host_ms) / 1000.0 * self.rate
    }
}

/// One raw observation: a stream position and the host time it was observed at.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClockPoint {
    /// Host monotonic time, nanoseconds.
    pub host_ns: u64,
    /// Stream position, frames.
    pub frames: u64,
}

/// What [`StreamClock::observe`] did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ClockUpdate {
    /// The line was refitted in this call.
    pub refit: bool,
    /// A 100 ms bucket closed in this call; this is its earliest observation (the input of the clock-rate
    /// check).
    pub closed: Option<ClockPoint>,
    /// The refit found a step (the stream lost or gained more than [`STEP_SEC`] for good, as after an xrun)
    /// and started again from the newest buckets. Positions mapped before and after are on different lines.
    pub step: bool,
}

#[derive(Debug, Clone, Copy)]
struct Pt {
    /// Host time since the origin, nanoseconds.
    dn: u64,
    /// Host time since the origin, seconds.
    h: f64,
    /// Frames since the origin minus `nominal_rate * h` (how far ahead of the nominal line), frames.
    y: f64,
    raw: ClockPoint,
}

const PT0: Pt = Pt { dn: 0, h: 0.0, y: 0.0, raw: ClockPoint { host_ns: 0, frames: 0 } };

#[derive(Debug, Clone, Copy)]
struct Line {
    h0: f64,
    y0: f64,
    /// Frames per host second above nominal.
    ds: f64,
}

/// The earliest observation of each of the last `N` buckets of host time. Fixed size.
#[derive(Debug, Clone)]
struct Window<const N: usize> {
    width_ns: u64,
    pts: [Pt; N],
    /// Number of valid entries in `pts`, oldest first.
    len: usize,
    /// The best observation so far of the bucket in progress.
    open: Option<Pt>,
}

impl<const N: usize> Window<N> {
    fn new(width_ns: u64) -> Self {
        Window { width_ns, pts: [PT0; N], len: 0, open: None }
    }

    fn pts(&self) -> &[Pt] {
        &self.pts[..self.len]
    }

    fn span_sec(&self) -> f64 {
        match (self.pts().first(), self.pts().last()) {
            (Some(a), Some(b)) => b.h - a.h,
            _ => 0.0,
        }
    }

    fn clear(&mut self) {
        self.len = 0;
        self.open = None;
    }

    /// Keeps only the newest `k` closed buckets.
    fn keep_last(&mut self, k: usize) {
        if self.len > k {
            self.pts.copy_within(self.len - k..self.len, 0);
            self.len = k;
        }
    }

    /// Adds an observation. "Earliest" is judged against a line of slope `nominal + ds`: the observation
    /// furthest above it wins its bucket. Returns the bucket that this observation closed, if any.
    fn add(&mut self, p: Pt, ds: f64) -> Option<Pt> {
        let bucket = p.dn / self.width_ns;
        match self.open {
            Some(o) if o.dn / self.width_ns == bucket => {
                if p.y - ds * p.h > o.y - ds * o.h {
                    self.open = Some(p);
                }
                None
            }
            Some(o) => {
                let oldest_kept = bucket.saturating_sub(N as u64);
                let stale = self.pts().iter().take_while(|q| q.dn / self.width_ns < oldest_kept).count();
                let drop = if self.len == N && stale == 0 { 1 } else { stale };
                if drop > 0 {
                    self.pts.copy_within(drop..self.len, 0);
                    self.len -= drop;
                }
                // After a long gap the bucket being closed may itself be older than the window.
                if o.dn / self.width_ns >= oldest_kept {
                    self.pts[self.len] = o;
                    self.len += 1;
                }
                self.open = Some(p);
                Some(o)
            }
            None => {
                self.open = Some(p);
                None
            }
        }
    }
}

/// Largest height of `pts` above a line of slope `ds` through the origin, and the point that has it.
fn highest(pts: &[Pt], ds: f64) -> Option<Pt> {
    let mut best: Option<Pt> = None;
    for p in pts {
        if best.map_or(true, |b| p.y - ds * p.h > b.y - ds * b.h) {
            best = Some(*p);
        }
    }
    best
}

/// Slope of the edge of the upper convex hull of `pts` (in time order) that lies over their mean time.
fn hull_slope<const N: usize>(pts: &[Pt]) -> f64 {
    let mut hull = [0usize; N];
    let mut n = 0usize;
    let mut mean_h = 0.0;
    for (i, p) in pts.iter().enumerate().take(N) {
        mean_h += p.h;
        while n >= 2 {
            let (a, b) = (pts[hull[n - 2]], pts[hull[n - 1]]);
            if (b.h - a.h) * (p.y - a.y) - (b.y - a.y) * (p.h - a.h) >= 0.0 {
                n -= 1;
            } else {
                break;
            }
        }
        hull[n] = i;
        n += 1;
    }
    if n < 2 {
        return f64::NAN;
    }
    mean_h /= pts.len().min(N) as f64;
    let mut k = 0;
    while k + 2 < n && pts[hull[k + 1]].h < mean_h {
        k += 1;
    }
    let (a, b) = (pts[hull[k]], pts[hull[k + 1]]);
    (b.y - a.y) / (b.h - a.h)
}

/// Least-squares slope of `y` against `h`, and its standard error.
fn lsq_slope(pts: &[Pt]) -> (f64, f64) {
    let n = pts.len() as f64;
    let (mut mh, mut my) = (0.0, 0.0);
    for p in pts {
        mh += p.h;
        my += p.y;
    }
    mh /= n;
    my /= n;
    let (mut sxy, mut sxx) = (0.0, 0.0);
    for p in pts {
        sxy += (p.h - mh) * (p.y - my);
        sxx += (p.h - mh) * (p.h - mh);
    }
    let slope = sxy / sxx;
    let mut res = 0.0;
    for p in pts {
        let r = p.y - my - slope * (p.h - mh);
        res += r * r;
    }
    (slope, (res / (n - 2.0).max(1.0) / sxx).sqrt())
}

/// Stream frames as a line in host time, from callback observations `(host_ns, frames)`.
///
/// A callback can be late but not early, so at a given host time the true position is at or above every
/// observation. Per 100 ms bucket of host time only the earliest observation is kept (the one furthest above
/// the line), over a 4 s window; this alone removes wake-up jitter and back-to-back bursts.
///
/// The line through those points, refitted every 250 ms:
///
/// * Offset: the line touches the 4 s window's points from above. A least-squares line through them would sit
///   below the truth by the mean lateness that is left in a bucket's best callback (some 0.1 ms with 3 ms
///   of jitter), so least squares is used for the slope only.
/// * Slope: least squares through the earliest observation of each 1 s bucket over the last 32 s, once 8 of
///   them exist. Before that (from 1 s on) the slope of the edge of the 4 s window's upper convex hull over its
///   centre, which is the best one-sided fit of so short a stretch; before 1 s, the nominal rate.
/// * Step: when the newest 0.5 s lies more than 0.5 ms above or below the line through the rest of the window
///   (an xrun shifts the stream against the clock for good), the older points are dropped, the long window
///   starts again and the slope found so far is kept.
///
/// Accuracy with 0 to 3 ms of lateness on every callback and stalls of four callbacks (test
/// `clock_fit_rejects_jitter`): under 0.02 ms from 10 s on for 128, 256 and 480-frame callbacks; from 2 s on,
/// under 0.05 ms with 128-frame callbacks and up to 0.13 ms with 480-frame ones.
///
/// Realtime: fixed arrays, no allocation; a refit is a few passes over at most 40 + 32 points.
#[derive(Debug, Clone)]
pub struct StreamClock {
    nominal: f64,
    origin: Option<ClockPoint>,
    last_ns: u64,
    fine: Window<WINDOW_BUCKETS>,
    long: Window<LONG_BUCKETS>,
    /// Fitted slope above nominal, frames per host second; kept across steps.
    ds: f64,
    /// `ds` has come from data at least once.
    slope_fitted: bool,
    /// Rough standard error of `ds`, frames per host second (infinite until `slope_fitted`).
    ds_error: f64,
    line: Option<Line>,
    last_fit_ns: u64,
    steps: u64,
}

impl StreamClock {
    /// A clock for a stream whose nominal rate is `nominal_rate` Hz.
    pub fn new(nominal_rate: f64) -> Self {
        StreamClock {
            nominal: nominal_rate,
            origin: None,
            last_ns: 0,
            fine: Window::new(BUCKET_NS),
            long: Window::new(LONG_BUCKET_NS),
            ds: 0.0,
            slope_fitted: false,
            ds_error: f64::INFINITY,
            line: None,
            last_fit_ns: 0,
            steps: 0,
        }
    }

    /// Nominal rate, Hz.
    pub fn nominal_rate(&self) -> f64 {
        self.nominal
    }

    /// Forgets everything (stream restart).
    pub fn reset(&mut self) {
        *self = StreamClock::new(self.nominal);
    }

    /// Adds the observation "at host time `host_ns` the stream position was `frames`". For an output stream
    /// pass the frames rendered before this callback, for an input stream the frames delivered including it.
    /// An observation older than the previous one is ignored. Realtime: constant work, plus a bounded refit
    /// every 250 ms.
    pub fn observe(&mut self, host_ns: u64, frames: u64) -> ClockUpdate {
        let origin = *self.origin.get_or_insert(ClockPoint { host_ns, frames });
        if host_ns < self.last_ns || host_ns < origin.host_ns || frames < origin.frames {
            return ClockUpdate::default();
        }
        self.last_ns = host_ns;
        let dn = host_ns - origin.host_ns;
        let h = dn as f64 * 1e-9;
        let p = Pt { dn, h, y: (frames - origin.frames) as f64 - self.nominal * h, raw: ClockPoint { host_ns, frames } };
        let mut update = ClockUpdate { closed: self.fine.add(p, self.ds).map(|c| c.raw), ..ClockUpdate::default() };
        // The long window only collects once a slope is known: across a 1 s bucket a wrong slope would pick
        // a late callback at one end over an early one at the other.
        if self.slope_fitted {
            self.long.add(p, self.ds);
        }
        if self.line.is_none() || host_ns - self.last_fit_ns >= REFIT_NS {
            update.step = self.refit();
            self.last_fit_ns = host_ns;
            update.refit = true;
        }
        update
    }

    /// Refits the line; returns true when a step was found.
    fn refit(&mut self) -> bool {
        let mut step = false;
        if self.slope_fitted && self.fine.len >= 2 * STEP_RECENT_BUCKETS {
            let (older, recent) = self.fine.pts().split_at(self.fine.len - STEP_RECENT_BUCKETS);
            if let (Some(a), Some(b)) = (highest(older, self.ds), highest(recent, self.ds)) {
                let jump = (b.y - self.ds * b.h) - (a.y - self.ds * a.h);
                if jump.abs() > STEP_SEC * self.nominal {
                    step = true;
                    self.steps += 1;
                    self.fine.keep_last(STEP_RECENT_BUCKETS);
                    self.long.clear();
                }
            }
        }
        let from_long = self.long.len >= LONG_MIN_POINTS;
        let (slope, long_error) = if from_long {
            lsq_slope(self.long.pts())
        } else if self.fine.span_sec() >= MIN_SLOPE_SPAN_SEC {
            (hull_slope::<WINDOW_BUCKETS>(self.fine.pts()), 0.0)
        } else {
            (f64::NAN, 0.0)
        };
        let fitted = slope.is_finite() && slope.abs() <= MAX_SLOPE_DEVIATION * self.nominal;
        if fitted {
            self.ds = slope;
            self.slope_fitted = true;
        }
        // The open bucket is used only until a bucket has closed: it may hold a single late callback.
        let touch = highest(self.fine.pts(), self.ds).or(self.fine.open);
        if let Some(t) = touch {
            self.line = Some(Line { h0: t.h, y0: t.y, ds: self.ds });
            if fitted {
                self.ds_error = if from_long {
                    long_error
                } else {
                    // Hull slope: the mean distance of the points below the line, over the span.
                    let pts = self.fine.pts();
                    let slack: f64 = pts.iter().map(|p| t.y + self.ds * (p.h - t.h) - p.y).sum::<f64>() / pts.len() as f64;
                    slack.max(0.0) / self.fine.span_sec().max(1e-3)
                };
            }
        }
        step
    }

    fn rel_sec(&self, origin: ClockPoint, host_ns: u64) -> f64 {
        if host_ns >= origin.host_ns {
            (host_ns - origin.host_ns) as f64 * 1e-9
        } else {
            -((origin.host_ns - host_ns) as f64 * 1e-9)
        }
    }

    /// Stream position at host time `host_ns`, frames (fractional). `None` before the first observation.
    pub fn frames_at(&self, host_ns: u64) -> Option<f64> {
        let (o, l) = (self.origin?, self.line?);
        let h = self.rel_sec(o, host_ns);
        Some(o.frames as f64 + self.nominal * h + l.y0 + l.ds * (h - l.h0))
    }

    /// Host time at which the stream position was (or will be) `frames`, nanoseconds on the `host_ns` clock
    /// (fractional, may be negative before the clock's zero). `None` before the first observation.
    pub fn host_ns_at(&self, frames: f64) -> Option<f64> {
        let (o, l) = (self.origin?, self.line?);
        let h = (frames - o.frames as f64 - l.y0 + l.ds * l.h0) / (self.nominal + l.ds);
        Some(o.host_ns as f64 + h * 1e9)
    }

    /// Stream position at the fractional host time `host_ns` (nanoseconds), frames. As
    /// [`StreamClock::frames_at`], for host times that come out of another clock's line.
    pub fn frames_at_f64(&self, host_ns: f64) -> Option<f64> {
        let (o, l) = (self.origin?, self.line?);
        let h = (host_ns - o.host_ns as f64) * 1e-9;
        Some(o.frames as f64 + self.nominal * h + l.y0 + l.ds * (h - l.h0))
    }

    /// True once the slope has been fitted from data (the stream has run for a good second). Before that
    /// positions can be a few milliseconds off.
    pub fn is_settled(&self) -> bool {
        self.slope_fitted
    }

    /// Rough standard error of the fitted rate as a fraction of the nominal rate (1e-6 = 1 ppm); infinite
    /// until [`StreamClock::is_settled`]. From the scatter of the points about the line, so it is 0 for
    /// perfectly regular callbacks.
    pub fn rate_uncertainty(&self) -> f64 {
        self.ds_error / self.nominal
    }

    /// Fitted rate, frames per host second. `None` before the first observation.
    pub fn frames_per_sec(&self) -> Option<f64> {
        self.line.map(|l| self.nominal + l.ds)
    }

    /// Host time covered by the kept 100 ms buckets, seconds.
    pub fn span_sec(&self) -> f64 {
        self.fine.span_sec()
    }

    /// Steps found since creation or reset.
    pub fn steps(&self) -> u64 {
        self.steps
    }

    /// The earliest observation of each closed 100 ms bucket in the 4 s window, oldest first.
    pub fn bucket_points(&self) -> impl Iterator<Item = ClockPoint> + '_ {
        self.fine.pts().iter().map(|p| p.raw)
    }
}

/// The output side of the clock bridge: the output stream's clock `R(h)`, which defines engine time.
///
/// It lives with the render callback. The input side (`A(m)`, and `p(m) = R(A(m))`) lives with the capture
/// callback, which on most backends runs on another thread; it reads `R` through the [`ClockAnchor`] that the
/// engine publishes lock-free after every refit (an anchor is exactly the fitted line), so neither callback
/// ever touches the other's state.
#[derive(Debug, Clone)]
pub struct ClockBridge {
    engine_rate: f64,
    output: StreamClock,
}

impl ClockBridge {
    /// A bridge for an engine (output stream) at `engine_rate` Hz.
    pub fn new(engine_rate: u32) -> Self {
        ClockBridge { engine_rate: engine_rate as f64, output: StreamClock::new(engine_rate as f64) }
    }

    /// Engine rate, Hz.
    pub fn engine_rate(&self) -> f64 {
        self.engine_rate
    }

    /// Output callback observation: at `host_ns`, `frames_before` engine frames had been rendered.
    pub fn observe_output(&mut self, host_ns: u64, frames_before: u64) -> ClockUpdate {
        self.output.observe(host_ns, frames_before)
    }

    /// `R(h)`: the render head at host time `host_ns`, engine frames.
    pub fn render_head_at(&self, host_ns: u64) -> Option<f64> {
        self.output.frames_at(host_ns)
    }

    /// The fitted line as an anchor at host time `host_ns`.
    pub fn anchor_at(&self, host_ns: u64) -> Option<ClockAnchor> {
        let head = self.output.frames_at(host_ns)?;
        let fps = self.output.frames_per_sec()?;
        Some(ClockAnchor { engine_sec: head / self.engine_rate, host_ms: host_ns as f64 / 1e6, rate: fps / self.engine_rate })
    }

    /// The output clock.
    pub fn output(&self) -> &StreamClock {
        &self.output
    }

    /// Forgets the output fit (output stream restart). Engine frames keep counting; only the fit starts again.
    pub fn reset_output(&mut self) {
        self.output.reset();
    }
}

// ---------------------------------------------------------------------------------------------------------
// Clock-rate check: a port of `clock-fit.ts`. Same arithmetic in the same order, so results agree to rounding.
// ---------------------------------------------------------------------------------------------------------

/// One `(wall, context time)` pair taken at one instant.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ClockSample {
    /// Wall (host) time, milliseconds.
    pub wall_ms: f64,
    /// Engine time of the same instant, seconds.
    pub ctx_sec: f64,
}

/// Options of [`fit_clock_window`].
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ClockFitOptions {
    /// Equal stretches of wall time fitted separately (default 4).
    pub sub_windows: usize,
    /// Largest allowed difference between a stretch's error and the median, fraction (default 0.004).
    pub agree_tol: f64,
    /// Fewest samples in each stretch (default 4).
    pub min_per_sub: usize,
    /// Intended window length, milliseconds; the samples must span at least `min_coverage` of it.
    pub window_ms: f64,
    /// Fraction of `window_ms` the samples must span (default 0.8).
    pub min_coverage: f64,
}

impl ClockFitOptions {
    /// The defaults of `clock-fit.ts` for a window of `window_ms` milliseconds.
    pub fn new(window_ms: f64) -> Self {
        ClockFitOptions { sub_windows: 4, agree_tol: 0.004, min_per_sub: 4, window_ms, min_coverage: 0.8 }
    }
}

/// Why a window is or is not consistent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FitReason {
    /// Consistent.
    Ok,
    /// Too few samples overall or in one stretch.
    TooFewSamples,
    /// The samples span less than the required part of the window.
    ShortSpan,
    /// One stretch disagrees with the median (a stall is a step, not a slope).
    Disagree,
}

/// Result of [`fit_clock_window`].
#[derive(Debug, Clone, PartialEq)]
pub struct ClockFit {
    /// Fractional error of the whole window's least-squares slope (0.088 = 8.8 % fast). NaN when not computed.
    pub error: f64,
    /// True when every stretch agrees; only then is `error` a measurement.
    pub consistent: bool,
    /// Why the window is not consistent.
    pub reason: FitReason,
    /// Fractional error of each stretch.
    pub sub_errors: Vec<f64>,
    /// Samples used after cleaning.
    pub n: usize,
    /// Wall time covered by the samples, milliseconds.
    pub span_ms: f64,
    /// Largest distance of a sample from the whole window's line, milliseconds. NaN when not computed.
    pub max_resid_ms: f64,
}

/// Least-squares slope of `ctx_sec` against wall seconds, and the largest residual in ms.
fn lsq(s: &[ClockSample]) -> (f64, f64) {
    let n = s.len() as f64;
    let (mut mx, mut my) = (0.0, 0.0);
    for p in s {
        mx += p.wall_ms / 1000.0;
        my += p.ctx_sec;
    }
    mx /= n;
    my /= n;
    let (mut sxy, mut sxx) = (0.0, 0.0);
    for p in s {
        let dx = p.wall_ms / 1000.0 - mx;
        sxy += dx * (p.ctx_sec - my);
        sxx += dx * dx;
    }
    let slope = if sxx > 0.0 { sxy / sxx } else { f64::NAN };
    let mut r = 0f64;
    for p in s {
        // `f64::max` ignores a NaN operand as `Math.max` does not; a NaN slope never reaches a caller that
        // reads the residual (it needs at least two distinct wall times to get here with samples).
        r = r.max((p.ctx_sec - my - slope * (p.wall_ms / 1000.0 - mx)).abs());
    }
    (slope, r * 1000.0)
}

/// Median of `xs` (mean of the middle two for an even count). NaN for an empty slice.
pub fn median(xs: &[f64]) -> f64 {
    if xs.is_empty() {
        return f64::NAN;
    }
    let mut a = xs.to_vec();
    a.sort_by(|x, y| x.total_cmp(y));
    let m = a.len() >> 1;
    if a.len() % 2 == 1 {
        a[m]
    } else {
        (a[m - 1] + a[m]) / 2.0
    }
}

/// Sorted by wall time, with non-finite samples and repeated wall or context readings dropped.
pub fn clean_samples(samples: &[ClockSample]) -> Vec<ClockSample> {
    let mut s: Vec<ClockSample> = samples.iter().copied().filter(|p| p.wall_ms.is_finite() && p.ctx_sec.is_finite()).collect();
    s.sort_by(|a, b| a.wall_ms.total_cmp(&b.wall_ms)); // stable, as the JavaScript sort is
    let mut out: Vec<ClockSample> = Vec::with_capacity(s.len());
    for p in s {
        if let Some(last) = out.last() {
            if p.wall_ms <= last.wall_ms || p.ctx_sec <= last.ctx_sec {
                continue;
            }
        }
        out.push(p);
    }
    out
}

/// Fits one window: the whole-window slope, and whether `sub_windows` equal stretches of it agree.
pub fn fit_clock_window(samples: &[ClockSample], o: &ClockFitOptions) -> ClockFit {
    let k = o.sub_windows;
    let s = clean_samples(samples);
    let n = s.len();
    let span_ms = if n > 0 { s[n - 1].wall_ms - s[0].wall_ms } else { 0.0 };
    let bad = |reason, error, max_resid_ms, sub_errors| ClockFit { error, consistent: false, reason, sub_errors, n, span_ms, max_resid_ms };
    if n < k * o.min_per_sub || n == 0 {
        return bad(FitReason::TooFewSamples, f64::NAN, f64::NAN, Vec::new());
    }
    let first = s[0].wall_ms;
    let (slope, max_resid_ms) = lsq(&s);
    let error = slope - 1.0;
    if span_ms < o.min_coverage * o.window_ms {
        return bad(FitReason::ShortSpan, error, max_resid_ms, Vec::new());
    }
    let mut sub_errors = Vec::with_capacity(k);
    for i in 0..k {
        let lo = first + (span_ms * i as f64) / k as f64;
        let hi = first + (span_ms * (i + 1) as f64) / k as f64;
        let part: Vec<ClockSample> = s.iter().copied().filter(|p| p.wall_ms >= lo && if i == k - 1 { p.wall_ms <= hi } else { p.wall_ms < hi }).collect();
        if part.len() < o.min_per_sub {
            return bad(FitReason::TooFewSamples, error, max_resid_ms, sub_errors);
        }
        sub_errors.push(lsq(&part).0 - 1.0);
    }
    let med = median(&sub_errors);
    let agree = sub_errors.iter().all(|e| (e - med).abs() <= o.agree_tol) && (error - med).abs() <= o.agree_tol;
    if !agree {
        return bad(FitReason::Disagree, error, max_resid_ms, sub_errors);
    }
    ClockFit { error, consistent: true, reason: FitReason::Ok, sub_errors, n, span_ms, max_resid_ms }
}

/// Result of [`RateCheck::check`] (the reply of `audio_clock_check`, without the input drift).
#[derive(Debug, Clone, PartialEq)]
pub struct RateCheckReport {
    /// Fractional rate error of the engine clock against host time; `None` unless `consistent`.
    pub error: Option<f64>,
    /// True when the window is a usable measurement.
    pub consistent: bool,
    /// Measured engine frames per host second (`expected * (1 + error)`); NaN when no slope could be fitted.
    pub frames_per_sec: f64,
    /// Nominal engine rate, Hz.
    pub expected: f64,
    /// Rate of the input stream's clock against the output stream's, parts per million (positive: the input
    /// delivers frames faster than its nominal rate, measured on the engine clock). `None` from
    /// [`RateCheck::check`] itself and until both clocks have settled; [`crate::EngineHandle::rate_check`]
    /// fills it in.
    pub input_drift_ppm: Option<f64>,
    /// The underlying fit.
    pub fit: ClockFit,
}

/// The engine's running clock-rate check: keeps the last seconds of bucket-earliest observations (one per
/// 100 ms, each a single-instant pair of host time and render head) and fits a window on request.
#[derive(Debug, Clone)]
pub struct RateCheck {
    engine_rate: f64,
    samples: VecDeque<ClockSample>,
    capacity: usize,
}

impl RateCheck {
    /// Keeps up to `capacity` samples for an engine at `engine_rate` Hz (64 samples cover 6.4 s).
    pub fn new(engine_rate: u32, capacity: usize) -> Self {
        RateCheck { engine_rate: engine_rate as f64, samples: VecDeque::with_capacity(capacity), capacity: capacity.max(1) }
    }

    /// Adds one observation of the output clock.
    pub fn push(&mut self, point: ClockPoint) {
        if self.samples.len() == self.capacity {
            self.samples.pop_front();
        }
        self.samples.push_back(ClockSample { wall_ms: point.host_ns as f64 / 1e6, ctx_sec: point.frames as f64 / self.engine_rate });
    }

    /// Forgets all samples (stream restart).
    pub fn clear(&mut self) {
        self.samples.clear();
    }

    /// Number of samples held.
    pub fn len(&self) -> usize {
        self.samples.len()
    }

    /// True when no sample is held.
    pub fn is_empty(&self) -> bool {
        self.samples.is_empty()
    }

    /// Fits the most recent `dur_sec` seconds with the default options.
    pub fn check(&self, dur_sec: f64) -> RateCheckReport {
        let window_ms = dur_sec * 1000.0;
        let newest = self.samples.back().map_or(0.0, |s| s.wall_ms);
        let recent: Vec<ClockSample> = self.samples.iter().copied().filter(|s| s.wall_ms >= newest - window_ms).collect();
        let fit = fit_clock_window(&recent, &ClockFitOptions::new(window_ms));
        RateCheckReport {
            error: if fit.consistent { Some(fit.error) } else { None },
            consistent: fit.consistent,
            frames_per_sec: self.engine_rate * (1.0 + fit.error),
            expected: self.engine_rate,
            input_drift_ppm: None,
            fit,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TestRng;

    /// A simulated output device: period `quantum` frames at `true_rate` Hz of host time. Each callback wakes
    /// 0 to `jitter_ms` late; now and then the thread stalls and four callbacks run back to back.
    struct FakeCallbacks {
        rng: TestRng,
        quantum: u64,
        true_rate: f64,
        jitter_ms: f64,
        burst_every: u64,
        k: u64,
        last_ns: u64,
        burst_left: u32,
        burst_ns: u64,
        /// Host time the stream has lost to stalls, nanoseconds.
        lost_ns: u64,
    }

    impl FakeCallbacks {
        const HOST0_NS: u64 = 5_000_000_000_000; // an arbitrary large host clock reading

        fn new(seed: u64, quantum: u64, true_rate: f64, jitter_ms: f64, burst_every: u64) -> Self {
            FakeCallbacks { rng: TestRng::new(seed), quantum, true_rate, jitter_ms, burst_every, k: 0, last_ns: 0, burst_left: 0, burst_ns: 0, lost_ns: 0 }
        }

        /// True render head at host time `host_ns`, frames: a callback that is exactly on time sees its own
        /// first frame.
        fn truth(&self, host_ns: u64) -> f64 {
            (host_ns - Self::HOST0_NS - self.lost_ns) as f64 * 1e-9 * self.true_rate
        }

        /// The device stalls for `ns`: every later callback is that much later for the same frames.
        fn lose(&mut self, ns: u64) {
            self.lost_ns += ns;
        }

        /// The next callback: `(host_ns, frames rendered before it)`.
        fn next(&mut self) -> (u64, u64) {
            let frames = self.k * self.quantum;
            let due = |k: u64| Self::HOST0_NS + self.lost_ns + (k as f64 * self.quantum as f64 / self.true_rate * 1e9).round() as u64;
            let mut ns;
            if self.burst_left > 0 {
                self.burst_left -= 1;
                self.burst_ns += 20_000; // back to back, 20 us apart
                ns = self.burst_ns;
            } else if self.k > 0 && self.k % self.burst_every == 0 {
                // A stall: this callback and the next three all run when the fourth is due.
                self.burst_left = 3;
                self.burst_ns = due(self.k + 3) + (self.rng.uniform(0.0, self.jitter_ms) * 1e6) as u64;
                ns = self.burst_ns;
            } else {
                ns = due(self.k) + (self.rng.uniform(0.0, self.jitter_ms) * 1e6) as u64;
            }
            ns = ns.max(self.last_ns + 1_000);
            self.last_ns = ns;
            self.k += 1;
            (ns, frames)
        }
    }

    /// The plain least-squares line of the design through the bucket-earliest points, evaluated at `host_ns`.
    fn lsq_frames_at(c: &StreamClock, host_ns: u64) -> f64 {
        let pts: Vec<ClockPoint> = c.bucket_points().collect();
        let h0 = pts[0].host_ns;
        let xs: Vec<f64> = pts.iter().map(|p| (p.host_ns - h0) as f64 * 1e-9).collect();
        let ys: Vec<f64> = pts.iter().zip(&xs).map(|(p, x)| p.frames as f64 - c.nominal_rate() * x).collect();
        let n = pts.len() as f64;
        let (mx, my) = (xs.iter().sum::<f64>() / n, ys.iter().sum::<f64>() / n);
        let sxy: f64 = xs.iter().zip(&ys).map(|(x, y)| (x - mx) * (y - my)).sum();
        let sxx: f64 = xs.iter().map(|x| (x - mx).powi(2)).sum();
        let x = (host_ns - h0) as f64 * 1e-9;
        my + sxy / sxx * (x - mx) + c.nominal_rate() * x
    }

    #[test]
    fn clock_fit_rejects_jitter() {
        // (quantum, device rate error in ppm, seed). 128 frames is the design's Apple buffer, 256 the Android
        // and ALSA one, 480 a 10 ms WASAPI period.
        let cases = [(128u64, 0.0, 1u64), (128, 180.0, 3), (128, 0.0, 5), (128, 0.0, 6), (128, 50.0, 7), (256, 0.0, 2), (256, 0.0, 8), (256, 30.0, 9), (480, -120.0, 4)];
        let (mut worst_128, mut worst_steady, mut worst_warmup, mut worst_plain) = (0f64, 0f64, 0f64, 0f64);
        for (quantum, ppm, seed) in cases {
            let true_rate = 48_000.0 * (1.0 + ppm * 1e-6);
            let mut dev = FakeCallbacks::new(seed, quantum, true_rate, 3.0, 53);
            let mut clock = StreamClock::new(48_000.0);
            // Largest |R(h) - truth| in ms: before 2 s, from 2 to 10 s, from 10 s on; and for the plain
            // least-squares line through the same bucket points from 2 s on.
            let (mut first, mut warmup, mut steady, mut plain) = (0f64, 0f64, 0f64, 0f64);
            let (mut refits, mut closed, mut bursts) = (0u32, 0u32, 0u32);
            let mut prev_ns = 0u64;
            loop {
                let (ns, frames) = dev.next();
                let t = (ns - FakeCallbacks::HOST0_NS) as f64 * 1e-9;
                if t > 30.0 {
                    break;
                }
                if ns - prev_ns < 100_000 {
                    bursts += 1;
                }
                prev_ns = ns;
                let u = clock.observe(ns, frames);
                refits += u.refit as u32;
                closed += u.closed.is_some() as u32;
                assert!(!u.step, "jitter and bursts are not steps");
                let err_ms = ((clock.frames_at(ns).unwrap() - dev.truth(ns)) / 48.0).abs();
                if t < 2.0 {
                    first = first.max(err_ms);
                } else {
                    plain = plain.max(((lsq_frames_at(&clock, ns) - dev.truth(ns)) / 48.0).abs());
                    if t < 10.0 {
                        warmup = warmup.max(err_ms);
                    } else {
                        steady = steady.max(err_ms);
                    }
                }
            }
            let fps = clock.frames_per_sec().unwrap();
            println!(
                "clock_fit_rejects_jitter q={quantum} {ppm:+} ppm: max R(h) error {:.4} ms from 2 s on (2 to 10 s {warmup:.4}, from 10 s {steady:.4}; before 2 s {first:.2}; plain least squares {plain:.4}); rate error {:+.2} ppm; {bursts} burst callbacks",
                warmup.max(steady),
                (fps / true_rate - 1.0) * 1e6
            );
            assert!(bursts > 100);
            if quantum == 128 {
                worst_128 = worst_128.max(warmup.max(steady));
                assert!(warmup.max(steady) < 0.05, "the design's limit, from 2 s on");
            }
            // Longer callbacks give fewer observations per second: until the long window steadies the slope
            // (about 9 s) they can exceed the design's 0.05 ms (measured: up to 0.09 ms at 256 frames and
            // 0.13 ms at 480). A plain least-squares fit is at 0.14 to 0.43 ms throughout.
            assert!(warmup < 0.2);
            assert!(steady < 0.05, "the design's limit, in steady state");
            assert!(first < 3.0);
            assert!((fps / true_rate - 1.0).abs() < 5e-6);
            assert!((115..=125).contains(&refits), "a refit every 250 ms, got {refits}");
            assert!((295..=300).contains(&closed));
            assert_eq!((clock.bucket_points().count(), clock.steps()), (WINDOW_BUCKETS, 0));
            // The inverse map agrees with the forward one.
            let ns = FakeCallbacks::HOST0_NS + 29_000_000_000;
            let f = clock.frames_at(ns).unwrap();
            assert!((clock.host_ns_at(f).unwrap() - ns as f64).abs() < 100.0);
            worst_steady = worst_steady.max(steady);
            worst_warmup = worst_warmup.max(warmup);
            worst_plain = worst_plain.max(plain);
        }
        println!("clock_fit_rejects_jitter summary: 128-frame callbacks {worst_128:.4} ms from 2 s on; all sizes {worst_steady:.4} ms from 10 s on, {worst_warmup:.4} ms from 2 to 10 s; plain least squares {worst_plain:.4} ms (limit 0.05)");
    }

    #[test]
    fn stream_clock_follows_a_step() {
        // An xrun at 15 s: the device stalls and the stream is 10 ms behind the clock from then on.
        let mut dev = FakeCallbacks::new(31, 128, 48_000.0 * (1.0 + 60e-6), 3.0, 53);
        let mut clock = StreamClock::new(48_000.0);
        let (mut stepped_at, mut after, mut before, mut lost) = (None, 0f64, 0f64, false);
        loop {
            let (ns, frames) = dev.next();
            let t = (ns - FakeCallbacks::HOST0_NS) as f64 * 1e-9;
            if t > 25.0 {
                break;
            }
            if t >= 15.0 && !lost {
                dev.lose(10_000_000);
                lost = true;
                continue;
            }
            if clock.observe(ns, frames).step {
                assert!(stepped_at.is_none(), "one step");
                stepped_at = Some(t);
            }
            let err_ms = ((clock.frames_at(ns).unwrap() - dev.truth(ns)) / 48.0).abs();
            if (10.0..15.0).contains(&t) {
                before = before.max(err_ms);
            } else if t >= 16.0 {
                after = after.max(err_ms);
            }
        }
        let at = stepped_at.expect("the step is found");
        println!("stream clock step: 10 ms lost at 15 s, found at {at:.2} s; max error {before:.4} ms before, {after:.4} ms from 16 s on");
        assert!(at < 16.0 && clock.steps() == 1);
        assert!(before < 0.05 && after < 0.05);
    }

    #[test]
    fn stream_clock_edges() {
        let mut c = StreamClock::new(48_000.0);
        assert_eq!(c.frames_at(5), None);
        assert!(c.observe(1_000_000_000, 480).refit);
        // One observation: the nominal rate through it, both ways in time.
        let near = |got: Option<f64>, want: f64| assert!((got.unwrap() - want).abs() < 1e-6, "{got:?} vs {want}");
        near(c.frames_at(1_000_000_000), 480.0);
        near(c.frames_at(1_500_000_000), 24_480.0);
        near(c.frames_at(990_000_000), 0.0);
        // A reading from the past changes nothing.
        assert_eq!(c.observe(900_000_000, 0), ClockUpdate::default());
        // A gap longer than the window drops every old bucket.
        for k in 1..=30u64 {
            c.observe(1_000_000_000 + k * 100_000_000, 480 + k * 4800);
        }
        assert_eq!(c.bucket_points().count(), 30);
        c.observe(60_000_000_000, 480 + 59 * 48_000);
        assert_eq!(c.bucket_points().count(), 0);
        near(c.frames_at(60_050_000_000), (480 + 59 * 48_000 + 2400) as f64);
        c.observe(60_100_000_000, 480 + 59 * 48_000 + 4800);
        assert_eq!(c.bucket_points().count(), 1);
        c.reset();
        assert_eq!(c.frames_at(5), None);

        let mut b = ClockBridge::new(48_000);
        assert_eq!(b.anchor_at(0), None);
        b.observe_output(2_000_000_000, 96_000);
        let a = b.anchor_at(2_250_000_000).unwrap();
        assert_eq!((a.host_ms, a.rate), (2250.0, 1.0));
        near(Some(a.engine_sec), 2.25);
        near(Some(a.engine_sec_at(2300.0)), 2.3);
        near(b.render_head_at(2_010_000_000), 96_480.0);
        b.reset_output();
        assert_eq!(b.render_head_at(2_010_000_000), None);
    }

    /// The generator of `clock-fit.test.ts`: samples every 20 ms over `span_ms` of a clock running at
    /// `1 + err`, with uniform jitter of ±`jitter_ms` on the context side from the same 32-bit generator.
    fn line(err: f64, span_ms: u32, jitter_ms: f64) -> Vec<ClockSample> {
        let mut seed: u32 = 1;
        let mut out = Vec::new();
        let mut t = 0u32;
        while t <= span_ms {
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let rnd = seed as f64 / 4_294_967_296.0 * 2.0 - 1.0;
            let tf = t as f64;
            out.push(ClockSample { wall_ms: 1e6 + tf, ctx_sec: 3.0 + (tf / 1000.0) * (1.0 + err) + (jitter_ms * rnd) / 1000.0 });
            t += 20;
        }
        out
    }

    #[test]
    fn rate_check_matches_ts() {
        let o = ClockFitOptions::new(2000.0);
        let mut worst = 0f64;
        let mut close = |got: f64, want: f64| {
            worst = worst.max((got - want).abs());
            assert!((got - want).abs() < 1e-9, "got {got}, TypeScript gives {want}");
        };
        // Expected values printed by the TypeScript implementation for the same vectors.
        let consistent: [(f64, f64, [f64; 4], f64); 4] = [
            (0.0, 0.00010713491892722082, [-0.00046389687289583037, -0.00012622288928698655, 0.0016287053141557095, 0.00022204597568387108], 1.0738810342896254),
            (0.088, 0.08810713491892663, [0.08753610312709914, 0.08787377711070787, 0.08962870531415001, 0.08822204597567906], 1.073881034276969),
            (-0.0812, -0.08109286508107261, [-0.08166389687289033, -0.08132622288928149, -0.07957129468584001, -0.0809779540243113], 1.0738810342996175),
            (-0.037, -0.03689286508107292, [-0.03746389687289331, -0.03712622288928491, -0.035371294685842214, -0.03677795402431394], 1.0738810342950655),
        ];
        for (err, want_error, want_subs, want_resid) in consistent {
            let f = fit_clock_window(&line(err, 2000, 1.0), &o);
            assert!(f.consistent && f.reason == FitReason::Ok);
            assert_eq!((f.n, f.span_ms), (101, 2000.0));
            close(f.error, want_error);
            for (g, w) in f.sub_errors.iter().zip(want_subs) {
                close(*g, w);
            }
            close(f.max_resid_ms * 1e-3, want_resid * 1e-3);
            assert!((f.error - err).abs() < 0.0005, "the assertion of the TypeScript test");
        }

        // A step (render stall) is inconsistent.
        let step: Vec<ClockSample> = line(0.0, 2000, 0.0).into_iter().map(|p| if p.wall_ms - 1e6 > 1200.0 { ClockSample { ctx_sec: p.ctx_sec - 0.056, ..p } } else { p }).collect();
        let f = fit_clock_window(&step, &o);
        assert_eq!((f.consistent, f.reason, f.n), (false, FitReason::Disagree, 99));
        close(f.error, -0.039452357340662214);
        close(f.sub_errors[2], -0.16701030927839955);
        close(f.max_resid_ms * 1e-3, 29.5687349467178e-3);
        assert!(f.error < -0.02);

        // Too few samples, a short span, a gap that empties one stretch.
        let few = fit_clock_window(&line(0.0, 2000, 0.0)[..10], &o);
        assert_eq!((few.reason, few.n, few.span_ms), (FitReason::TooFewSamples, 10, 180.0));
        assert!(few.error.is_nan() && few.max_resid_ms.is_nan() && few.sub_errors.is_empty());
        let short = fit_clock_window(&line(0.0, 1000, 0.0), &o);
        assert_eq!((short.reason, short.n, short.span_ms), (FitReason::ShortSpan, 51, 1000.0));
        close(short.error, -1.432187701766452e-14);
        let gap: Vec<ClockSample> = line(0.0, 2000, 0.0).into_iter().filter(|p| p.wall_ms - 1e6 < 520.0 || p.wall_ms - 1e6 >= 1000.0).collect();
        let g = fit_clock_window(&gap, &o);
        assert_eq!((g.reason, g.n, g.sub_errors.len()), (FitReason::TooFewSamples, 77, 1));
        close(g.error, -3.219646771412954e-15);

        // Unchanged snapshots and out-of-order samples are dropped.
        let s = |wall_ms: f64, ctx_sec: f64| ClockSample { wall_ms, ctx_sec };
        let cleaned = clean_samples(&[s(10.0, 1.0), s(10.0, 1.0), s(30.0, 1.02), s(20.0, 1.01), s(40.0, 1.02), s(f64::NAN, 2.0)]);
        assert_eq!(cleaned, vec![s(10.0, 1.0), s(20.0, 1.01), s(30.0, 1.02)]);
        assert_eq!(median(&[3.0, 1.0, 2.0]), 2.0);
        assert_eq!(median(&[4.0, 1.0, 2.0, 3.0]), 2.5);
        println!("rate_check_matches_ts: 8 vectors, same consistent and reason, max |difference| {worst:.2e} (limit 1e-9)");
    }

    #[test]
    fn rate_check_runs_on_stream_clock_points() {
        for (ppm, seed) in [(0.0, 21u64), (350.0, 22)] {
            let true_rate = 48_000.0 * (1.0 + ppm * 1e-6);
            let mut dev = FakeCallbacks::new(seed, 128, true_rate, 3.0, 53);
            let mut clock = StreamClock::new(48_000.0);
            let mut check = RateCheck::new(48_000, 64);
            assert!(!check.check(2.0).consistent);
            for _ in 0..(6 * 375) {
                let (ns, frames) = dev.next();
                if let Some(p) = clock.observe(ns, frames).closed {
                    check.push(p);
                }
            }
            let r = check.check(2.0);
            println!("running rate check at {ppm:+} ppm: error {:+.1} ppm over {} samples, consistent {}", r.fit.error * 1e6, r.fit.n, r.consistent);
            assert!(r.consistent);
            assert!((r.error.unwrap() - ppm * 1e-6).abs() < 300e-6);
            assert!((r.frames_per_sec - true_rate).abs() < 15.0);
            assert_eq!(r.expected, 48_000.0);
            assert!(r.fit.n >= 20 && r.fit.n <= 22);
        }
    }
}
