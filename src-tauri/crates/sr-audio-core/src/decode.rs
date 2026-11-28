//! MP3 decode for the sample sets (design section 6): symphonia, MP3 only, gapless trimming on, downmixed to
//! mono. Non-realtime: allocates, and takes time proportional to the file.

use std::fmt;
use std::io::Cursor;

use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

use crate::mixer::AudioBuffer;

/// Why a file could not be decoded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DecodeError {
    /// Not recognised as an MP3 stream.
    Unrecognised(String),
    /// No audio track, or no sample rate in it.
    NoTrack,
    /// The stream broke off or is corrupt before any audio was decoded.
    Corrupt(String),
    /// The file decoded to no samples.
    Empty,
}

impl fmt::Display for DecodeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DecodeError::Unrecognised(e) => write!(f, "not an MP3 stream: {e}"),
            DecodeError::NoTrack => f.write_str("no audio track"),
            DecodeError::Corrupt(e) => write!(f, "corrupt MP3 stream: {e}"),
            DecodeError::Empty => f.write_str("the file holds no audio"),
        }
    }
}

impl std::error::Error for DecodeError {}

/// Decodes a whole MP3 file to mono `f32` at the file's own sample rate. Encoder delay and padding are trimmed
/// when the file says how much (gapless), so sample 0 is the first sample of the original audio. Stereo files
/// are averaged to mono. A stream that breaks off after some audio returns what was decoded.
pub fn decode_mp3_mono(bytes: &[u8]) -> Result<AudioBuffer, DecodeError> {
    let stream = MediaSourceStream::new(Box::new(Cursor::new(bytes.to_vec())), Default::default());
    let mut hint = Hint::new();
    hint.with_extension("mp3");
    let format_options = FormatOptions { enable_gapless: true, ..Default::default() };
    let probed = symphonia::default::get_probe()
        .format(&hint, stream, &format_options, &MetadataOptions::default())
        .map_err(|e| DecodeError::Unrecognised(e.to_string()))?;
    let mut format = probed.format;
    let track = format.tracks().iter().find(|t| t.codec_params.codec != CODEC_TYPE_NULL).ok_or(DecodeError::NoTrack)?;
    let track_id = track.id;
    let mut sample_rate = track.codec_params.sample_rate;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| DecodeError::Unrecognised(e.to_string()))?;

    let mut mono: Vec<f32> = Vec::new();
    let mut interleaved: Option<SampleBuffer<f32>> = None;
    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymphoniaError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(SymphoniaError::ResetRequired) => break,
            Err(e) if mono.is_empty() => return Err(DecodeError::Corrupt(e.to_string())),
            Err(_) => break,
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            // A damaged frame is skipped, as browser decoders do.
            Err(SymphoniaError::DecodeError(_)) | Err(SymphoniaError::IoError(_)) => continue,
            Err(e) if mono.is_empty() => return Err(DecodeError::Corrupt(e.to_string())),
            Err(_) => break,
        };
        let spec = *decoded.spec();
        sample_rate = Some(spec.rate);
        let channels = spec.channels.count().max(1);
        let need = decoded.capacity() as u64;
        if interleaved.as_ref().map_or(true, |b| (b.capacity() as u64) < need * channels as u64) {
            interleaved = Some(SampleBuffer::<f32>::new(need, spec));
        }
        let Some(buf) = interleaved.as_mut() else { continue };
        buf.copy_interleaved_ref(decoded);
        let samples = buf.samples();
        if channels == 1 {
            mono.extend_from_slice(samples);
        } else {
            let scale = 1.0 / channels as f32;
            mono.extend(samples.chunks_exact(channels).map(|f| f.iter().sum::<f32>() * scale));
        }
    }
    let sample_rate = sample_rate.ok_or(DecodeError::NoTrack)?;
    if mono.is_empty() {
        return Err(DecodeError::Empty);
    }
    Ok(AudioBuffer::new(mono, sample_rate))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// Seconds to the first sample above 3 % of the peak: `onsetSec` of `sampler.ts`.
    fn onset_sec(b: &AudioBuffer) -> f64 {
        let peak = b.samples.iter().fold(0f32, |m, x| m.max(x.abs()));
        let thr = peak * 0.03;
        b.samples.iter().position(|x| x.abs() > thr).unwrap_or(0) as f64 / b.sample_rate as f64
    }

    #[test]
    fn decode_mp3_fixture() {
        let sounds = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../public/sounds");
        // (file; frames and onset frame of a reference gapless decode (ffmpeg 6, `-f f32le`, onset by the rule
        // above); manifest onset and duration in seconds, from `public/sounds/index.json`).
        let fixtures = [("piano/C5.mp3", 132_300usize, 175usize, 0.004, 3.0), ("trumpet/C4.mp3", 84_252, 175, 0.004, 1.91), ("flute/C4.mp3", 84_163, 64, 0.004, 1.908)];
        for (file, ref_frames, ref_onset, manifest_onset, manifest_dur) in fixtures {
            let bytes = std::fs::read(sounds.join(file)).unwrap_or_else(|e| panic!("{file}: {e}"));
            let b = decode_mp3_mono(&bytes).expect("decodes");
            let onset = onset_sec(&b);
            let peak = b.samples.iter().fold(0f32, |m, x| m.max(x.abs()));
            println!(
                "decode_mp3_fixture {file}: {} Hz mono, {} frames (reference {ref_frames}), onset {:.3} ms (reference {:.3} ms, manifest {:.1} ms, priming 0 with gapless on), peak {peak:.3}",
                b.sample_rate, b.samples.len(), onset * 1e3, ref_onset as f64 / 44.1, manifest_onset * 1e3
            );
            assert_eq!(b.sample_rate, 44_100);
            assert!((b.samples.len() as i64 - ref_frames as i64).abs() <= 1, "length within 1 frame of the reference");
            assert!((b.duration_sec() - manifest_dur).abs() < 0.001);
            // No priming is left: the sound starts where the reference decode has it, and never later than
            // the manifest says (later is what `onsetShift` in `sampler.ts` would have to correct).
            assert!((onset - ref_onset as f64 / 44_100.0).abs() <= 0.001, "onset within 1 ms of the reference");
            assert!(onset <= manifest_onset + 0.001, "onset not later than the manifest plus 1 ms");
            // The design's two-sided form holds for piano and trumpet. The flute sample itself starts 2.5 ms
            // before its manifest onset in every decoder, so for it only the two checks above apply.
            if !file.starts_with("flute") {
                assert!((onset - manifest_onset).abs() <= 0.001, "onset within 1 ms of the manifest");
            }
            assert!(peak > 0.05 && peak <= 1.0 && b.samples.iter().all(|x| x.is_finite()));
        }
    }

    #[test]
    fn decode_rejects_what_is_not_mp3() {
        assert!(matches!(decode_mp3_mono(&[]), Err(DecodeError::Unrecognised(_))));
        assert!(decode_mp3_mono(&[0x12u8; 4096]).is_err());
    }
}
