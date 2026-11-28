//! Ports of the TypeScript sound renderers, sample for sample: `renderClick` (`src/core/click-sounds.ts`),
//! `renderListenNote` (`src/platform/shared/audio/listen-voice.ts`), the sanity tone `renderTone`
//! (`src/platform/shared/audio/render-tone.ts`) and the seeded generator they use (`src/core/rng.ts`).
//!
//! Production buffers come from TypeScript (the webview renders and uploads them). These ports serve the
//! loopback estimator (which must know the click it plays), device-free tests and headless tools. They are
//! checked against vectors written by `tools/native/golden.ts` (max difference 1e-6; the arithmetic is the
//! same `f64` arithmetic in the same order, so the difference is that of the two maths libraries, about 1e-7).
//!
//! Non-realtime: every function allocates its result.

use std::f64::consts::PI;

/// The seeded generator of `src/core/rng.ts` (mulberry32). Same seed, same numbers as the TypeScript one.
#[derive(Debug, Clone)]
pub struct Rng {
    a: u32,
}

impl Rng {
    /// A generator from a 32-bit seed.
    pub fn new(seed: u32) -> Self {
        Rng { a: seed }
    }

    /// The next number, uniform in `[0, 1)`.
    pub fn next_f64(&mut self) -> f64 {
        self.a = self.a.wrapping_add(0x6d2b_79f5);
        let mut t = self.a;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        (t ^ (t >> 14)) as f64 / 4_294_967_296.0
    }

    /// Uniform in `[lo, hi)`.
    pub fn uniform(&mut self, lo: f64, hi: f64) -> f64 {
        lo + self.next_f64() * (hi - lo)
    }
}

/// The click sounds (`ClickTimbre` of `src/core/types.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClickTimbre {
    /// Legacy Tick: 40 partials over 5.5 to 9 kHz. The calibration and loopback click.
    Tick,
    /// Legacy Wood: 40 partials over 1.5 to 4 kHz.
    Wood,
    /// The default metronome sound.
    Classic,
    /// Woodblock.
    Woodblock,
    /// Beep.
    Beep,
}

impl ClickTimbre {
    /// The TypeScript name.
    pub fn as_str(self) -> &'static str {
        match self {
            ClickTimbre::Tick => "tick",
            ClickTimbre::Wood => "wood",
            ClickTimbre::Classic => "classic",
            ClickTimbre::Woodblock => "woodblock",
            ClickTimbre::Beep => "beep",
        }
    }
}

const TICK_SEED: u32 = 0x71c4;
const WOOD_SEED: u32 = 0x300d;
/// Partials at or above this fraction of the sample rate are dropped.
const NYQUIST_GUARD: f64 = 0.475;
/// Raised-cosine fade at the end of every recipe sound, seconds.
const CLICK_FADE_SEC: f64 = 0.003;
/// Attack of the Tick layer, seconds.
const TICK_ATTACK_SEC: f64 = 0.002;

#[derive(Debug, Clone, Copy)]
enum Layer {
    Tick { a: f64, length_sec: f64 },
    Band { f1: f64, f2: f64, a: f64, attack_sec: f64, tau_sec: f64, seed: u32 },
    Partial { hz: f64, a: f64, attack_sec: f64, tau_sec: f64, half_cosine: bool },
    Tone { hz: f64, a: f64, ramp_sec: f64, length_sec: f64 },
}

const fn partial(hz: f64, a: f64, attack_sec: f64, tau_sec: f64, half_cosine: bool) -> Layer {
    Layer::Partial { hz, a, attack_sec, tau_sec, half_cosine }
}

/// The recipe (length in seconds, layers) of a player's sound; `CLICK_RECIPES` of `click-sounds.ts`.
fn recipe(timbre: ClickTimbre, accent: bool) -> (f64, &'static [Layer]) {
    const CLASSIC_OFF: &[Layer] = &[
        Layer::Tick { a: 0.5, length_sec: 0.012 },
        Layer::Band { f1: 1800.0, f2: 3200.0, a: 1.0, attack_sec: 0.0005, tau_sec: 0.006, seed: WOOD_SEED },
        partial(1180.0, 0.45, 0.0005, 0.008, false),
        partial(3050.0, 0.2, 0.0005, 0.004, false),
    ];
    const CLASSIC_ACC: &[Layer] = &[
        Layer::Tick { a: 0.55, length_sec: 0.014 },
        Layer::Band { f1: 2200.0, f2: 3800.0, a: 1.0, attack_sec: 0.0005, tau_sec: 0.006, seed: WOOD_SEED },
        partial(1575.0, 0.5, 0.0005, 0.009, false),
        partial(4065.0, 0.22, 0.0005, 0.004, false),
        partial(2362.0, 0.22, 0.001, 0.018, false),
    ];
    const WOODBLOCK_OFF: &[Layer] = &[
        Layer::Tick { a: 0.35, length_sec: 0.01 },
        partial(1250.0, 1.0, 0.001, 0.014, true),
        partial(3150.0, 0.32, 0.001, 0.006, true),
        partial(5800.0, 0.15, 0.001, 0.0025, true),
    ];
    const WOODBLOCK_ACC: &[Layer] = &[
        Layer::Tick { a: 0.4, length_sec: 0.012 },
        partial(1670.0, 1.0, 0.001, 0.014, true),
        partial(4205.0, 0.32, 0.001, 0.006, true),
        partial(7740.0, 0.15, 0.001, 0.0025, true),
    ];
    const BEEP_OFF: &[Layer] = &[Layer::Tick { a: 0.3, length_sec: 0.008 }, Layer::Tone { hz: 2000.0, a: 0.8, ramp_sec: 0.002, length_sec: 0.03 }];
    const BEEP_ACC: &[Layer] = &[Layer::Tick { a: 0.3, length_sec: 0.008 }, Layer::Tone { hz: 3000.0, a: 0.8, ramp_sec: 0.002, length_sec: 0.03 }];
    match (timbre, accent) {
        (ClickTimbre::Classic, false) => (0.045, CLASSIC_OFF),
        (ClickTimbre::Classic, true) => (0.06, CLASSIC_ACC),
        (ClickTimbre::Woodblock, false) => (0.055, WOODBLOCK_OFF),
        (ClickTimbre::Woodblock, true) => (0.06, WOODBLOCK_ACC),
        (ClickTimbre::Beep, false) => (0.03, BEEP_OFF),
        (ClickTimbre::Beep, true) => (0.03, BEEP_ACC),
        // The legacy timbres have no recipe; `render_click` never asks for one.
        (ClickTimbre::Tick, _) | (ClickTimbre::Wood, _) => (0.012, &[]),
    }
}

/// Length of a rendered click, seconds (`clickLengthSec`).
pub fn click_length_sec(timbre: ClickTimbre, accent: bool) -> f64 {
    match timbre {
        ClickTimbre::Tick => {
            if accent {
                0.018
            } else {
                0.012
            }
        }
        ClickTimbre::Wood => 0.008,
        _ => recipe(timbre, accent).0,
    }
}

/// `Math.round` for the non-negative values used here.
fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

/// 40 seeded random-phase partials uniform in `[f1, f2]` as `(radians per sample, phase)`, those at or above
/// the Nyquist guard dropped.
fn band_partials(f1: f64, f2: f64, seed: u32, sample_rate: f64) -> Vec<(f64, f64)> {
    let mut rng = Rng::new(seed);
    let mut out = Vec::with_capacity(40);
    for _ in 0..40 {
        let f = f1 + rng.next_f64() * (f2 - f1);
        let ph = rng.next_f64() * 2.0 * PI;
        if f < NYQUIST_GUARD * sample_rate {
            out.push(((2.0 * PI * f) / sample_rate, ph));
        }
    }
    out
}

/// A click, peak-normalised to 1, at `sample_rate` Hz. Port of `renderClick`.
pub fn render_click(timbre: ClickTimbre, accent: bool, sample_rate: u32) -> Vec<f32> {
    let sr = sample_rate as f64;
    match timbre {
        ClickTimbre::Tick | ClickTimbre::Wood => render_legacy(timbre == ClickTimbre::Tick, accent, sr),
        _ => {
            let (length_sec, layers) = recipe(timbre, accent);
            render_recipe(length_sec, layers, sr)
        }
    }
}

fn render_legacy(tick: bool, accent: bool, sr: f64) -> Vec<f32> {
    let (f1, f2) = if tick { (5500.0, 9000.0) } else { (1500.0, 4000.0) };
    let len_sec = if tick { if accent { 0.018 } else { 0.012 } } else { 0.008 };
    let attack_sec = if tick { 0.002 } else { 0.001 };
    let n = js_round(len_sec * sr).max(1.0) as usize;
    let partials = band_partials(f1, f2, if tick { TICK_SEED } else { WOOD_SEED }, sr);
    let mut out = vec![0f32; n];
    let mut peak = 0f64;
    for (i, o) in out.iter_mut().enumerate() {
        let t = i as f64 / sr;
        let env = (if t < attack_sec { t / attack_sec } else { 1.0 }) * ((-5.0 * t) / len_sec).exp();
        let mut s = 0f64;
        for &(w, ph) in &partials {
            s += (w * i as f64 + ph).sin();
        }
        let v = s * env;
        *o = v as f32;
        if v.abs() > peak {
            peak = v.abs();
        }
    }
    if peak > 0.0 {
        // As in TypeScript: the stored float32 is read back and divided by the float64 peak.
        for o in out.iter_mut() {
            *o = (*o as f64 / peak) as f32;
        }
    }
    out
}

/// One layer before its own normalisation, or `None` when the rate cannot carry it.
fn render_layer(l: &Layer, n: usize, sr: f64) -> Option<Vec<f64>> {
    let mut out = vec![0f64; n];
    match *l {
        Layer::Tick { .. } | Layer::Band { .. } => {
            let (ps, att) = match *l {
                Layer::Tick { .. } => (band_partials(5500.0, 9000.0, TICK_SEED, sr), TICK_ATTACK_SEC),
                Layer::Band { f1, f2, seed, attack_sec, .. } => (band_partials(f1, f2, seed, sr), attack_sec),
                _ => return None,
            };
            if ps.is_empty() {
                return None;
            }
            for (i, o) in out.iter_mut().enumerate() {
                let t = i as f64 / sr;
                let decay = match *l {
                    Layer::Tick { length_sec, .. } => ((-5.0 * t) / length_sec).exp(),
                    Layer::Band { tau_sec, .. } => (-t / tau_sec).exp(),
                    _ => 1.0,
                };
                let env = (t / att).min(1.0) * decay;
                let mut s = 0f64;
                for &(w, ph) in &ps {
                    s += (w * i as f64 + ph).sin();
                }
                *o = s * env;
            }
        }
        Layer::Partial { hz, .. } | Layer::Tone { hz, .. } => {
            if hz >= NYQUIST_GUARD * sr {
                return None;
            }
            let w = (2.0 * PI * hz) / sr;
            for (i, o) in out.iter_mut().enumerate() {
                let t = i as f64 / sr;
                let env = match *l {
                    Layer::Tone { ramp_sec, length_sec, .. } => {
                        if t > length_sec {
                            0.0
                        } else if t < ramp_sec {
                            0.5 - 0.5 * ((PI * t) / ramp_sec).cos()
                        } else if t > length_sec - ramp_sec {
                            0.5 - 0.5 * ((PI * (length_sec - t)) / ramp_sec).cos()
                        } else {
                            1.0
                        }
                    }
                    Layer::Partial { attack_sec, tau_sec, half_cosine, .. } => {
                        let a = if half_cosine {
                            if t < attack_sec {
                                0.5 - 0.5 * ((PI * t) / attack_sec).cos()
                            } else {
                                1.0
                            }
                        } else {
                            (t / attack_sec).min(1.0)
                        };
                        a * (-t / tau_sec).exp()
                    }
                    _ => 0.0,
                };
                *o = (w * i as f64).sin() * env;
            }
        }
    }
    Some(out)
}

fn render_recipe(length_sec: f64, layers: &[Layer], sr: f64) -> Vec<f32> {
    let n = js_round(length_sec * sr).max(1.0) as usize;
    let mut sum = vec![0f64; n];
    for l in layers {
        let Some(x) = render_layer(l, n, sr) else { continue };
        let peak = x.iter().fold(0f64, |m, v| m.max(v.abs()));
        if peak <= 0.0 {
            continue;
        }
        let a = match *l {
            Layer::Tick { a, .. } | Layer::Band { a, .. } | Layer::Partial { a, .. } | Layer::Tone { a, .. } => a,
        };
        let g = a / peak;
        for (s, v) in sum.iter_mut().zip(&x) {
            *s += v * g;
        }
    }
    let fade = (js_round(CLICK_FADE_SEC * sr) as usize).min(n);
    for i in 0..fade {
        sum[n - 1 - i] *= 0.5 - 0.5 * ((PI * i as f64) / fade as f64).cos();
    }
    let peak = sum.iter().fold(0f64, |m, v| m.max(v.abs()));
    if peak > 0.0 {
        sum.iter().map(|v| (v / peak) as f32).collect()
    } else {
        vec![0f32; n]
    }
}

const LISTEN_ATTACK_SEC: f64 = 0.005;
const LISTEN_RELEASE_SEC: f64 = 0.06;
const LISTEN_DECAY_DB: f64 = -24.0;
const LISTEN_DECAY_MAX_SEC: f64 = 2.0;
const LISTEN_HARMONIC_DB: [f64; 3] = [0.0, -8.0, -16.0];

/// Envelope of the Listen voice at `t` seconds into a note of `dur_sec` (`listenEnvelope`).
pub fn listen_envelope(t: f64, dur_sec: f64) -> f64 {
    if t < 0.0 {
        return 0.0;
    }
    let decay_sec = dur_sec.clamp(1e-3, LISTEN_DECAY_MAX_SEC);
    let held = |u: f64| 10f64.powf((LISTEN_DECAY_DB / 20.0) * u.min(decay_sec) / decay_sec);
    let attack = if t < LISTEN_ATTACK_SEC { 0.5 - 0.5 * ((PI * t) / LISTEN_ATTACK_SEC).cos() } else { 1.0 };
    if t < dur_sec {
        return attack * held(t);
    }
    let r = (t - dur_sec) / LISTEN_RELEASE_SEC;
    if r >= 1.0 {
        return 0.0;
    }
    attack * held(dur_sec) * (0.5 + 0.5 * (PI * r).cos())
}

/// One Listen note, mono, peak-normalised to `peak` (0 to 1); the note plus its 60 ms release. Port of
/// `renderListenNote`.
pub fn render_listen_note(hz: f64, dur_sec: f64, sample_rate: u32, peak: f64) -> Vec<f32> {
    let sr = sample_rate as f64;
    let dur = dur_sec.max(0.01);
    let n = (((dur + LISTEN_RELEASE_SEC) * sr).ceil() as usize).max(1);
    let amps = LISTEN_HARMONIC_DB.map(|db| 10f64.powf(db / 20.0));
    let nyquist = sr / 2.0;
    let mut out = vec![0f32; n];
    let mut max = 0f64;
    for (i, o) in out.iter_mut().enumerate() {
        let t = i as f64 / sr;
        let mut s = 0f64;
        for (h, amp) in amps.iter().enumerate() {
            let f = hz * (h as f64 + 1.0);
            if f < nyquist {
                s += amp * (2.0 * PI * f * t).sin();
            }
        }
        s *= listen_envelope(t, dur);
        *o = s as f32;
        if s.abs() > max {
            max = s.abs();
        }
    }
    let scale = if max > 0.0 { peak.clamp(0.0, 1.0) / max } else { 0.0 };
    for o in out.iter_mut() {
        *o = (*o as f64 * scale) as f32;
    }
    out
}

/// The sanity tone: a sine at `hz` with 10 ms raised-cosine fades at both ends, peak `peak`. Port of
/// `renderTone`.
pub fn render_tone(hz: f64, dur_sec: f64, sample_rate: u32, peak: f64) -> Vec<f32> {
    let sr = sample_rate as f64;
    let n = js_round(dur_sec * sr).max(1.0) as usize;
    let fade = (js_round(0.01 * sr) as usize).min(n / 2);
    let w = (2.0 * PI * hz) / sr;
    (0..n)
        .map(|i| {
            let env = if i < fade {
                0.5 - 0.5 * ((PI * i as f64) / fade as f64).cos()
            } else if i >= n - fade {
                0.5 - 0.5 * ((PI * (n - 1 - i) as f64) / fade as f64).cos()
            } else {
                1.0
            };
            (peak * env * (w * i as f64).sin()) as f32
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    const RATES: [u32; 2] = [44_100, 48_000];

    fn golden(name: &str) -> Vec<f32> {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/golden").join(format!("{name}.f32"));
        let bytes = std::fs::read(&path).unwrap_or_else(|e| panic!("{}: {e} (run `pnpm exec tsx tools/native/golden.ts`)", path.display()));
        bytes.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()
    }

    /// Largest difference from the golden vector; lengths must match and the vector must not be silent.
    fn compare(name: &str, got: &[f32]) -> f64 {
        let want = golden(name);
        assert_eq!(got.len(), want.len(), "{name}: length");
        assert!(want.iter().any(|x| x.abs() > 0.1), "{name}: golden vector is not silent");
        got.iter().zip(&want).map(|(a, b)| (*a as f64 - *b as f64).abs()).fold(0.0, f64::max)
    }

    #[test]
    fn rng_matches_ts() {
        // createRng(0x71c4).next() x 3 and createRng(1).next(), printed by Node.
        let mut r = Rng::new(0x71c4);
        let got = [r.next_f64(), r.next_f64(), r.next_f64(), Rng::new(1).next_f64()];
        assert_eq!(got, RNG_GOLDEN);
    }
    const RNG_GOLDEN: [f64; 4] = [0.7282981369644403, 0.7133602625690401, 0.8284651029389352, 0.6270739405881613];

    #[test]
    fn synth_click_golden() {
        use ClickTimbre::*;
        let cases = [(Tick, false), (Tick, true), (Wood, false), (Classic, false), (Classic, true), (Woodblock, true), (Beep, false)];
        let mut worst = 0f64;
        let mut samples = 0usize;
        for rate in RATES {
            for (timbre, accent) in cases {
                let got = render_click(timbre, accent, rate);
                assert_eq!(got.len(), js_round(click_length_sec(timbre, accent) * rate as f64) as usize);
                let peak = got.iter().fold(0f32, |m, x| m.max(x.abs()));
                assert!((peak - 1.0).abs() < 1e-6);
                let d = compare(&format!("click-{}-{}-{rate}", timbre.as_str(), if accent { "accent" } else { "offbeat" }), &got);
                assert!(d <= 1e-6, "{timbre:?} accent {accent} at {rate}: {d}");
                worst = worst.max(d);
                samples += got.len();
            }
        }
        // Rates that drop partials: the top of the Tick band and whole layers at 16 kHz.
        assert!(render_click(Tick, false, 16_000).iter().any(|x| *x != 0.0));
        assert_eq!(render_click(Woodblock, true, 16_000).len(), 960);
        println!("synth_click_golden: 14 clicks, {samples} samples, max difference {worst:.2e} (limit 1e-6)");
    }

    #[test]
    fn synth_listen_golden() {
        let mut worst = 0f64;
        for rate in RATES {
            for (name, hz, dur, peak) in [("listen-c4", 261.6255653005986, 0.05, 1.0), ("listen-high", 9000.0, 0.02, 0.5)] {
                let d = compare(&format!("{name}-{rate}"), &render_listen_note(hz, dur, rate, peak));
                assert!(d <= 1e-6, "{name} at {rate}: {d}");
                worst = worst.max(d);
            }
        }
        assert_eq!(listen_envelope(-1.0, 1.0), 0.0);
        assert_eq!(listen_envelope(1.07, 1.0), 0.0);
        assert!((listen_envelope(1.0 - 1e-12, 1.0) - 10f64.powf(-24.0 / 20.0)).abs() < 1e-9);
        println!("synth_listen_golden: 4 notes, max difference {worst:.2e} (limit 1e-6)");
    }

    #[test]
    fn synth_tone_golden() {
        let mut worst = 0f64;
        for rate in RATES {
            for (name, hz, dur, peak) in [("tone-1k", 1000.0, 0.04, 0.25), ("tone-short", 440.0, 0.012, 1.0)] {
                let d = compare(&format!("{name}-{rate}"), &render_tone(hz, dur, rate, peak));
                assert!(d <= 1e-6, "{name} at {rate}: {d}");
                worst = worst.max(d);
            }
        }
        println!("synth_tone_golden: 4 tones, max difference {worst:.2e} (limit 1e-6)");
    }
}
