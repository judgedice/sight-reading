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
