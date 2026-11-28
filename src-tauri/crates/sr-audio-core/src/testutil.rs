//! Test-only helpers: a small deterministic random number generator (SplitMix64). Not part of the public API.

pub(crate) struct TestRng(u64);

impl TestRng {
    pub(crate) fn new(seed: u64) -> Self {
        TestRng(seed)
    }

    pub(crate) fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    pub(crate) fn next_u32(&mut self) -> u32 {
        (self.next_u64() >> 32) as u32
    }

    /// Uniform in `[0, 1)`.
    pub(crate) fn unit(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }

    /// Uniform in `[lo, hi)`.
    pub(crate) fn uniform(&mut self, lo: f64, hi: f64) -> f64 {
        lo + (hi - lo) * self.unit()
    }

    /// Uniform integer in `[0, n)`.
    pub(crate) fn below(&mut self, n: u64) -> u64 {
        (self.unit() * n as f64) as u64
    }
}
