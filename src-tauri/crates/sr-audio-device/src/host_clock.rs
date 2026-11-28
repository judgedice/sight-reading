//! The process-wide monotonic clock every audio callback stamps itself with (`host_ns`), and the one the app
//! uses to answer `audio_clock_sync`. Nanoseconds since the first call to [`init`] (or [`now_ns`]).

use std::sync::OnceLock;
use std::time::Instant;

static EPOCH: OnceLock<Instant> = OnceLock::new();

/// Fixes the epoch. Call before any audio callback can run, so the first callback never pays for the
/// initialisation (it would still be correct, only one atomic compare slower).
pub fn init() {
    EPOCH.get_or_init(Instant::now);
}

/// Nanoseconds on the monotonic host clock. A clock read and a subtraction: no allocation, no lock, safe in an
/// audio callback once [`init`] has run.
#[inline]
pub fn now_ns() -> u64 {
    let epoch = *EPOCH.get_or_init(Instant::now);
    Instant::now().saturating_duration_since(epoch).as_nanos() as u64
}

/// [`now_ns`] in milliseconds, the unit of `ClockAnchor::host_ms`.
pub fn now_ms() -> f64 {
    now_ns() as f64 / 1e6
}

/// The constant between the clock CoreAudio stamps buffers with and [`now_ns`]: `device epoch time - now_ns`
/// for the same instant, nanoseconds. CoreAudio's `mHostTime` is mach absolute time, which cpal converts to
/// nanoseconds since boot; Rust's monotonic clock on macOS reads the same counter, so the difference is fixed
/// for the life of the process. Measured by bracketing one mach reading between two of ours (best of five).
/// `None` on other platforms (their stream times are on per-stream clocks) or when the timebase is unreadable.
pub fn device_epoch_offset_ns() -> Option<i64> {
    #[cfg(target_os = "macos")]
    {
        let mut info = mach2::mach_time::mach_timebase_info { numer: 0, denom: 0 };
        // SAFETY: `info` is a live local the call fills in; it has no other effect.
        let status = unsafe { mach2::mach_time::mach_timebase_info(&mut info) };
        if status != 0 || info.denom == 0 {
            return None;
        }
        let mut best: Option<(u64, i64)> = None;
        for _ in 0..5 {
            let before = now_ns();
            // SAFETY: reads the system's monotonic tick counter; no arguments, no side effects.
            let ticks = unsafe { mach2::mach_time::mach_absolute_time() };
            let after = now_ns();
            let mach_ns = (ticks as u128 * info.numer as u128 / info.denom as u128) as i128;
            let offset = i64::try_from(mach_ns - (before as i128 + after as i128) / 2).ok()?;
            let width = after - before;
            if best.is_none_or(|(w, _)| width < w) {
                best = Some((width, offset));
            }
        }
        best.map(|(_, offset)| offset)
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_monotonic() {
        init();
        let a = now_ns();
        let b = now_ns();
        assert!(b >= a);
    }
}
