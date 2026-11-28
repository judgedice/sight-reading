//! The host time each callback is stamped with (`host_ns` of the core's `render` and `capture`).
//!
//! Two sources:
//! * **Callback** (the default everywhere): the monotonic clock read as the callback's first statement.
//!   The core's clock fit is built for this: it keeps the earliest callbacks and ignores the late ones.
//! * **Device** (CoreAudio only, opt-in with `SR_AUDIO_STAMPS=device`): the `mHostTime` CoreAudio passes with
//!   each buffer, which cpal hands on as the callback's `StreamInstant`. It comes from the system's own model
//!   of the device clock, so it has no wake-up jitter at all. It is on the same clock as ours (mach absolute
//!   time; Rust's monotonic clock reads it too), so mapping it is one constant, measured once at open.
//!   Its meaning differs, though: for output it is when the buffer's first frame reaches the device, for input
//!   when the buffer's first frame was taken from it, not when the callback ran. With it, engine time is
//!   device time and a measured round trip no longer contains the two IO buffers and safety offsets. A
//!   calibration made with one source is therefore not valid with the other. That is why it is opt-in until
//!   it has been measured on hardware; see the measurement list in the design document.
//!
//! A device stamp further than [`MAX_APART_NS`] from the callback's own clock reading is not believed; from
//! then on the stream uses callback stamps (one switch, never back and forth).
//!
//! Every stream also keeps a few counters (atomics only) on its callback timing; `SR_AUDIO_STAMP_LOG=1`
//! prints them to stderr when the device closes. They are how the callback jitter of a machine is read.

use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::OnceLock;

/// A device stamp further than this from the callback's clock reading is rejected, nanoseconds (250 ms).
pub const MAX_APART_NS: u64 = 250_000_000;

/// The device stamp on our host clock, or `None` when it is implausible. `device_ns` is the device time on its
/// own epoch, `offset_ns` is `device epoch time - host clock time` for the same instant.
pub fn device_stamp(now_ns: u64, device_ns: u128, offset_ns: i64, max_apart_ns: u64) -> Option<u64> {
    let stamp = i128::try_from(device_ns).ok()? - offset_ns as i128;
    let stamp = u64::try_from(stamp).ok()?;
    (stamp.abs_diff(now_ns) <= max_apart_ns).then_some(stamp)
}

/// Callback timing counters of one stream.
#[derive(Debug)]
pub struct StampStats {
    callbacks: AtomicU64,
    last_now_ns: AtomicU64,
    min_interval_ns: AtomicU64,
    max_interval_ns: AtomicU64,
    /// Device stamp minus the callback's clock reading, nanoseconds (only where a device stamp exists).
    min_lead_ns: AtomicI64,
    max_lead_ns: AtomicI64,
    rejected: AtomicBool,
}

/// A copy of the counters.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StampSummary {
    /// Callbacks seen.
    pub callbacks: u64,
    /// Shortest and longest time between two callbacks, nanoseconds; `None` before the second callback.
    pub interval_ns: Option<(u64, u64)>,
    /// Smallest and largest (device stamp - callback clock), nanoseconds; `None` without device stamps.
    pub lead_ns: Option<(i64, i64)>,
    /// A device stamp was rejected and the stream fell back to callback stamps.
    pub device_stamps_rejected: bool,
}

impl StampStats {
    /// Fresh counters.
    pub const fn new() -> Self {
        StampStats {
            callbacks: AtomicU64::new(0),
            last_now_ns: AtomicU64::new(0),
            min_interval_ns: AtomicU64::new(u64::MAX),
            max_interval_ns: AtomicU64::new(0),
            min_lead_ns: AtomicI64::new(i64::MAX),
            max_lead_ns: AtomicI64::new(i64::MIN),
            rejected: AtomicBool::new(false),
        }
    }

    /// Back to fresh (a new stream).
    pub fn reset(&self) {
        self.callbacks.store(0, Ordering::Relaxed);
        self.last_now_ns.store(0, Ordering::Relaxed);
        self.min_interval_ns.store(u64::MAX, Ordering::Relaxed);
        self.max_interval_ns.store(0, Ordering::Relaxed);
        self.min_lead_ns.store(i64::MAX, Ordering::Relaxed);
        self.max_lead_ns.store(i64::MIN, Ordering::Relaxed);
        self.rejected.store(false, Ordering::Relaxed);
    }

    /// The stamp for a callback that read `now_ns` as its first statement. `device` is the device time of the
    /// frames the stamp refers to on its own epoch and the epoch offset, when the platform has one;
    /// `use_device` chooses it over `now_ns`. Realtime: a handful of atomic operations.
    #[inline]
    pub fn stamp(&self, now_ns: u64, device: Option<(u128, i64)>, use_device: bool) -> u64 {
        let n = self.callbacks.fetch_add(1, Ordering::Relaxed);
        let last = self.last_now_ns.swap(now_ns, Ordering::Relaxed);
        if n > 0 {
            let interval = now_ns.saturating_sub(last);
            self.min_interval_ns.fetch_min(interval, Ordering::Relaxed);
            self.max_interval_ns.fetch_max(interval, Ordering::Relaxed);
        }
        let Some((device_ns, offset_ns)) = device else { return now_ns };
        match device_stamp(now_ns, device_ns, offset_ns, MAX_APART_NS) {
            Some(stamp) => {
                let lead = stamp as i64 - now_ns as i64;
                self.min_lead_ns.fetch_min(lead, Ordering::Relaxed);
                self.max_lead_ns.fetch_max(lead, Ordering::Relaxed);
                if use_device && !self.rejected.load(Ordering::Relaxed) {
                    stamp
                } else {
                    now_ns
                }
            }
            None => {
                self.rejected.store(true, Ordering::Relaxed);
                now_ns
            }
        }
    }

    /// A copy of the counters.
    pub fn summary(&self) -> StampSummary {
        let callbacks = self.callbacks.load(Ordering::Relaxed);
        let (lo, hi) = (self.min_interval_ns.load(Ordering::Relaxed), self.max_interval_ns.load(Ordering::Relaxed));
        let (lead_lo, lead_hi) = (self.min_lead_ns.load(Ordering::Relaxed), self.max_lead_ns.load(Ordering::Relaxed));
        StampSummary {
            callbacks,
            interval_ns: (callbacks >= 2 && lo <= hi).then_some((lo, hi)),
            lead_ns: (lead_lo <= lead_hi).then_some((lead_lo, lead_hi)),
            device_stamps_rejected: self.rejected.load(Ordering::Relaxed),
        }
    }
}

impl Default for StampStats {
    fn default() -> Self {
        Self::new()
    }
}

/// Counters of the output stream.
pub static OUTPUT: StampStats = StampStats::new();
/// Counters of the input stream.
pub static INPUT: StampStats = StampStats::new();

#[derive(Debug, Clone, Copy)]
struct Config {
    /// Device epoch minus host clock, nanoseconds; `None` where the platform's stream time is not on a clock
    /// we can map.
    offset_ns: Option<i64>,
    use_device: bool,
}

static CONFIG: OnceLock<Config> = OnceLock::new();

/// What `SR_AUDIO_STAMPS` asks for: only the exact word `device` selects device stamps.
pub fn wants_device_stamps(value: Option<&str>) -> bool {
    value == Some("device")
}

/// Fixes the stamp source for the process (reads `SR_AUDIO_STAMPS`, measures the clock offset on macOS). Call
/// before a stream starts; later calls change nothing.
pub fn init() {
    CONFIG.get_or_init(|| {
        let offset_ns = crate::host_clock::device_epoch_offset_ns();
        let use_device = offset_ns.is_some() && wants_device_stamps(std::env::var("SR_AUDIO_STAMPS").ok().as_deref());
        Config { offset_ns, use_device }
    });
}

/// True when device stamps are in use.
pub fn using_device_stamps() -> bool {
    CONFIG.get().is_some_and(|c| c.use_device)
}

/// The stamp of an output callback: `callback_ns` is cpal's `timestamp().callback` in nanoseconds.
#[inline]
pub fn output(now_ns: u64, callback_ns: u128) -> u64 {
    match CONFIG.get() {
        Some(Config { offset_ns: Some(offset), use_device }) => OUTPUT.stamp(now_ns, Some((callback_ns, *offset)), *use_device),
        _ => OUTPUT.stamp(now_ns, None, false),
    }
}

/// The stamp of an input callback that delivers `frames` frames at `rate` Hz. The core wants the time at
/// which the frames including this buffer had been delivered, so the device time of the buffer's first frame
/// is moved to its end.
#[inline]
pub fn input(now_ns: u64, callback_ns: u128, frames: usize, rate: u32) -> u64 {
    match CONFIG.get() {
        Some(Config { offset_ns: Some(offset), use_device }) => {
            let buffer_ns = frames as u128 * 1_000_000_000 / rate.max(1) as u128;
            INPUT.stamp(now_ns, Some((callback_ns + buffer_ns, *offset)), *use_device)
        }
        _ => INPUT.stamp(now_ns, None, false),
    }
}

/// Prints both streams' counters to stderr when `SR_AUDIO_STAMP_LOG` is set (called when the device closes,
/// never from a callback).
pub fn log_summary() {
    if std::env::var_os("SR_AUDIO_STAMP_LOG").is_none() {
        return;
    }
    for (name, stats) in [("output", &OUTPUT), ("input", &INPUT)] {
        let s = stats.summary();
        let ms = |ns: i128| ns as f64 / 1e6;
        eprintln!(
            "sr-audio stamps {name}: {} callbacks; interval {} ms; device stamp minus callback clock {} ms; device stamps {}",
            s.callbacks,
            s.interval_ns.map_or("n/a".into(), |(lo, hi)| format!("{:.3} to {:.3}", ms(lo as i128), ms(hi as i128))),
            s.lead_ns.map_or("n/a".into(), |(lo, hi)| format!("{:+.3} to {:+.3} (spread {:.3})", ms(lo as i128), ms(hi as i128), ms(hi as i128 - lo as i128))),
            if using_device_stamps() && !s.device_stamps_rejected { "in use" } else if s.device_stamps_rejected { "rejected" } else { "not used" },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_stamps_map_onto_the_host_clock() {
        // Device epoch is 5 s ahead of the host clock.
        let offset = 5_000_000_000i64;
        assert_eq!(device_stamp(1_000_000_000, 6_002_000_000, offset, MAX_APART_NS), Some(1_002_000_000), "2 ms ahead of the callback");
        assert_eq!(device_stamp(1_000_000_000, 5_990_000_000, offset, MAX_APART_NS), Some(990_000_000), "10 ms behind");
        assert_eq!(device_stamp(1_000_000_000, 6_300_000_000, offset, MAX_APART_NS), None, "300 ms apart is not believed");
        assert_eq!(device_stamp(1_000_000_000, 0, offset, MAX_APART_NS), None, "a zero device time maps before the epoch");
        assert_eq!(device_stamp(1_000_000_000, u128::MAX, offset, MAX_APART_NS), None);
        // A host clock that started before the device epoch (negative offset).
        assert_eq!(device_stamp(9_000_000_000, 2_000_100_000, -7_000_000_000, MAX_APART_NS), Some(9_000_100_000));
        assert!(wants_device_stamps(Some("device")) && !wants_device_stamps(Some("callback")) && !wants_device_stamps(Some("")) && !wants_device_stamps(None));
    }

    #[test]
    fn stats_and_fallback() {
        let s = StampStats::new();
        assert_eq!(s.summary(), StampSummary { callbacks: 0, interval_ns: None, lead_ns: None, device_stamps_rejected: false });
        // Callback stamps: the clock reading passes through; intervals are tracked.
        assert_eq!(s.stamp(1_000, None, false), 1_000);
        assert_eq!(s.stamp(3_000, None, false), 3_000);
        assert_eq!(s.stamp(4_000, None, true), 4_000);
        assert_eq!(s.summary(), StampSummary { callbacks: 3, interval_ns: Some((1_000, 2_000)), lead_ns: None, device_stamps_rejected: false });
        s.reset();
        // Device stamps measured but not used, then used.
        let offset = 1_000_000i64;
        assert_eq!(s.stamp(10_000_000, Some((11_500_000, offset)), false), 10_000_000);
        assert_eq!(s.stamp(12_000_000, Some((13_400_000, offset)), true), 12_400_000);
        assert_eq!(s.summary().lead_ns, Some((400_000, 500_000)));
        // One implausible device stamp: this callback and every later one use the callback clock.
        assert_eq!(s.stamp(14_000_000, Some((900_000_000_000, offset)), true), 14_000_000);
        assert_eq!(s.stamp(16_000_000, Some((17_400_000, offset)), true), 16_000_000);
        let sum = s.summary();
        assert!(sum.device_stamps_rejected && sum.callbacks == 4 && sum.interval_ns == Some((2_000_000, 2_000_000)));
    }

    #[test]
    fn process_wide_entry_points() {
        init();
        init();
        // Off macOS there is no mappable device time; on macOS device stamps are opt-in.
        if cfg!(not(target_os = "macos")) {
            assert!(!using_device_stamps());
            assert_eq!(output(123, 999_999), 123);
            assert_eq!(input(456, 999_999, 128, 48_000), 456);
        } else if std::env::var("SR_AUDIO_STAMPS").is_err() {
            assert!(!using_device_stamps());
            let now = crate::host_clock::now_ns();
            assert_eq!(output(now, 0), now, "not in use: the callback clock, whatever the device time");
        }
        log_summary();
    }

    /// On macOS the two clocks are one: the offset is measured and stable, and a mach reading mapped through it
    /// lands on our clock reading.
    #[cfg(target_os = "macos")]
    #[test]
    fn macos_device_epoch_offset_is_stable() {
        let a = crate::host_clock::device_epoch_offset_ns().expect("mach timebase");
        std::thread::sleep(std::time::Duration::from_millis(50));
        let b = crate::host_clock::device_epoch_offset_ns().expect("mach timebase");
        println!("mach epoch minus host clock: {a} ns, 50 ms later {b} ns (difference {} ns)", b - a);
        assert!((a - b).abs() < 1_000_000, "the same clock: the offset does not move");
    }
}
