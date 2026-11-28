//! Latency parts on Linux, as far as cpal and ALSA tell (design section 5).
//!
//! What is reported, and what is not:
//! * `*_buffer`: the stream's buffer in frames over its rate. Reported by every path.
//! * `out_device`: the delay the backend predicts between a callback and the first frame it wrote reaching the
//!   device (`playback - callback` of cpal's output timestamp, the ALSA `snd_pcm_status` delay). It is used only
//!   for a raw `hw:` device, where ALSA's number is the hardware delay; through PulseAudio or PipeWire it is an
//!   estimate of the plugin, and stays null. It already contains the buffer ring, so the sum of design section 5
//!   counts the buffer twice there (an upper bound); this is unverified on a real card.
//! * `out_safety`, `out_stream`, all `in_device`, `in_safety`, `in_stream`: not available from cpal, null.
//!
//! Nothing here is invented: a part without a source stays `None`.

use std::time::Duration;

use sr_audio_core::latency::LatencyParts;

fn secs(frames: u32, rate: u32) -> Option<f64> {
    (frames > 0 && rate > 0).then(|| frames as f64 / rate as f64)
}

/// Output parts. `delay` is the smallest `playback - callback` seen at the start of the stream, if any.
pub fn output_parts(out_frames: u32, rate: u32, delay: Option<Duration>, direct_hardware: bool) -> LatencyParts {
    LatencyParts {
        out_buffer: secs(out_frames, rate),
        out_device: if direct_hardware { delay.map(|d| d.as_secs_f64()) } else { None },
        ..LatencyParts::default()
    }
}

/// Adds the input buffer part to `parts`.
pub fn with_input(mut parts: LatencyParts, in_frames: u32, input_rate: u32) -> LatencyParts {
    parts.in_buffer = secs(in_frames, input_rate);
    parts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_is_invented() {
        let p = output_parts(0, 48_000, None, true);
        assert_eq!(p, LatencyParts::default());
        let p = output_parts(256, 48_000, Some(Duration::from_millis(8)), false);
        assert_eq!(p.out_device, None);
        assert_eq!(p.out_buffer, Some(256.0 / 48_000.0));
        let p = output_parts(256, 48_000, Some(Duration::from_millis(8)), true);
        assert_eq!(p.out_device, Some(0.008));
        assert_eq!(with_input(p, 128, 44_100).in_buffer, Some(128.0 / 44_100.0));
        assert!(with_input(p, 0, 44_100).in_buffer.is_none());
    }
}
