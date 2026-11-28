//! Binary layouts shared with the TypeScript side (design section 3). Everything is little-endian.
//!
//! * Capture packet (engine to webview): 24-byte header, then `n_frames` mono `f32` samples.
//! * `audio_put_buffer` payload (webview to engine): 16-byte header starting with the bytes `S R B 1`, then samples.
//! * `audio_decode` request (`u32` buffer id, then the MP3 bytes) and reply (`u32` rate, `u32` frames, samples).
//!
//! The encoders that the audio path may use (`encode_packet_into`) write into a caller-owned slice and never
//! allocate. Decoders are for the non-realtime side and for tests.

use std::fmt;
use std::sync::Arc;

/// Size of the capture packet header, bytes. A multiple of 4, so the samples can be viewed in place as `f32`.
pub const PACKET_HEADER_BYTES: usize = 24;
/// `kind` byte of a capture packet.
pub const PACKET_KIND_CAPTURE: u8 = 1;
/// `version` byte of a capture packet.
pub const PACKET_VERSION: u8 = 1;

/// Packet flag, bit 0: the samples came through the resampled path (not the locked path).
pub const FLAG_RESAMPLED: u16 = 1 << 0;
/// Packet flag, bit 1: the locked-path drift monitor is over 1 ms.
pub const FLAG_DRIFT: u16 = 1 << 1;
/// Packet flag, bit 2: every input sample of the packet was exactly zero.
pub const FLAG_INPUT_ZERO: u16 = 1 << 2;
/// Packet flag, bit 3: last packet of the capture.
pub const FLAG_LAST: u16 = 1 << 3;

/// The bytes at offset 0 of an `audio_put_buffer` payload, in file order.
pub const PUT_BUFFER_MAGIC: [u8; 4] = *b"SRB1";
/// Size of the `audio_put_buffer` header, bytes.
pub const PUT_BUFFER_HEADER_BYTES: usize = 16;

/// Why a byte string is not a valid message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WireError {
    /// Fewer bytes than the fixed header.
    TooShort,
    /// The kind byte or the magic is not the expected one.
    BadKind,
    /// A version this code does not read.
    BadVersion,
    /// The byte count does not match the frame count in the header.
    LengthMismatch,
    /// `firstFrame` is not a non-negative integer value, or a rate of 0.
    BadValue,
    /// The destination slice is too small.
    NoSpace,
}

impl fmt::Display for WireError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            WireError::TooShort => "message shorter than its header",
            WireError::BadKind => "unknown message kind or magic",
            WireError::BadVersion => "unsupported message version",
            WireError::LengthMismatch => "byte length does not match the header's frame count",
            WireError::BadValue => "a header field has an invalid value",
            WireError::NoSpace => "destination too small",
        };
        f.write_str(s)
    }
}

impl std::error::Error for WireError {}

/// Header of one capture packet.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PacketHeader {
    /// Bit set of the `FLAG_*` constants.
    pub flags: u16,
    /// Packet number, from 0 per capture.
    pub seq: u32,
    /// Engine frame of sample 0. Always an integer value; carried as `f64` because JavaScript reads it as a number.
    pub first_frame: f64,
    /// Number of mono samples that follow the header.
    pub n_frames: u32,
    /// Engine frames lost before this packet (ring overflow), frames.
    pub dropped_before: u32,
}

impl PacketHeader {
    /// Total size of the packet this header describes, bytes.
    pub fn packet_bytes(&self) -> usize {
        PACKET_HEADER_BYTES + self.n_frames as usize * 4
    }

    /// Writes the 24 header bytes.
    pub fn write(&self, out: &mut [u8; PACKET_HEADER_BYTES]) {
        out[0] = PACKET_KIND_CAPTURE;
        out[1] = PACKET_VERSION;
        out[2..4].copy_from_slice(&self.flags.to_le_bytes());
        out[4..8].copy_from_slice(&self.seq.to_le_bytes());
        out[8..16].copy_from_slice(&self.first_frame.to_le_bytes());
        out[16..20].copy_from_slice(&self.n_frames.to_le_bytes());
        out[20..24].copy_from_slice(&self.dropped_before.to_le_bytes());
    }

    /// Reads and checks a header from the start of `bytes`.
    pub fn read(bytes: &[u8]) -> Result<PacketHeader, WireError> {
        if bytes.len() < PACKET_HEADER_BYTES {
            return Err(WireError::TooShort);
        }
        if bytes[0] != PACKET_KIND_CAPTURE {
            return Err(WireError::BadKind);
        }
        if bytes[1] != PACKET_VERSION {
            return Err(WireError::BadVersion);
        }
        let first_frame = f64::from_le_bytes(arr(&bytes[8..16]));
        if !(first_frame >= 0.0 && first_frame.fract() == 0.0 && first_frame.is_finite()) {
            return Err(WireError::BadValue);
        }
        Ok(PacketHeader {
            flags: u16::from_le_bytes(arr(&bytes[2..4])),
            seq: u32::from_le_bytes(arr(&bytes[4..8])),
            first_frame,
            n_frames: u32::from_le_bytes(arr(&bytes[16..20])),
            dropped_before: u32::from_le_bytes(arr(&bytes[20..24])),
        })
    }
}

fn arr<const N: usize>(s: &[u8]) -> [u8; N] {
    let mut a = [0u8; N];
    a.copy_from_slice(s);
    a
}

fn write_samples(samples: &[f32], out: &mut [u8]) {
    for (s, o) in samples.iter().zip(out.chunks_exact_mut(4)) {
        o.copy_from_slice(&s.to_le_bytes());
    }
}

fn read_samples(bytes: &[u8], out: &mut Vec<f32>) {
    out.reserve(bytes.len() / 4);
    out.extend(bytes.chunks_exact(4).map(|c| f32::from_le_bytes(arr(c))));
}

/// Writes one capture packet into `out` and returns its length in bytes. `header.n_frames` is ignored and
/// written as `samples.len()`. Does not allocate (usable from the audio path).
pub fn encode_packet_into(header: &PacketHeader, samples: &[f32], out: &mut [u8]) -> Result<usize, WireError> {
    let n = PACKET_HEADER_BYTES + samples.len() * 4;
    if samples.len() > u32::MAX as usize {
        return Err(WireError::BadValue);
    }
    if out.len() < n {
        return Err(WireError::NoSpace);
    }
    let mut h = [0u8; PACKET_HEADER_BYTES];
    PacketHeader { n_frames: samples.len() as u32, ..*header }.write(&mut h);
    out[..PACKET_HEADER_BYTES].copy_from_slice(&h);
    write_samples(samples, &mut out[PACKET_HEADER_BYTES..n]);
    Ok(n)
}

/// Appends one capture packet to `out` (allocating version of [`encode_packet_into`]).
pub fn encode_packet(header: &PacketHeader, samples: &[f32], out: &mut Vec<u8>) {
    let start = out.len();
    out.resize(start + PACKET_HEADER_BYTES + samples.len() * 4, 0);
    // The slice has exactly the needed size and the frame count fits, so this cannot fail.
    let _ = encode_packet_into(header, samples, &mut out[start..]);
}

/// Reads one capture packet that fills `bytes` exactly. The samples are appended to `samples`.
pub fn decode_packet(bytes: &[u8], samples: &mut Vec<f32>) -> Result<PacketHeader, WireError> {
    let h = PacketHeader::read(bytes)?;
    if bytes.len() != h.packet_bytes() {
        return Err(WireError::LengthMismatch);
    }
    read_samples(&bytes[PACKET_HEADER_BYTES..], samples);
    Ok(h)
}

/// A decoded `audio_put_buffer` payload.
#[derive(Debug, Clone, PartialEq)]
pub struct PutBuffer {
    /// Buffer id chosen by the caller.
    pub buffer_id: u32,
    /// Sample rate of the samples, Hz.
    pub sample_rate: u32,
    /// Mono samples, full scale ±1.
    pub samples: Arc<[f32]>,
}

/// Reads an `audio_put_buffer` payload: bytes `SRB1`, `u32` buffer id, `u32` sample rate (Hz), `u32` frame
/// count, then that many `f32` samples.
pub fn decode_put_buffer(bytes: &[u8]) -> Result<PutBuffer, WireError> {
    if bytes.len() < PUT_BUFFER_HEADER_BYTES {
        return Err(WireError::TooShort);
    }
    if bytes[0..4] != PUT_BUFFER_MAGIC {
        return Err(WireError::BadKind);
    }
    let buffer_id = u32::from_le_bytes(arr(&bytes[4..8]));
    let sample_rate = u32::from_le_bytes(arr(&bytes[8..12]));
    let n = u32::from_le_bytes(arr(&bytes[12..16])) as usize;
    if sample_rate == 0 {
        return Err(WireError::BadValue);
    }
    if bytes.len() - PUT_BUFFER_HEADER_BYTES != n * 4 {
        return Err(WireError::LengthMismatch);
    }
    let mut v = Vec::new();
    read_samples(&bytes[PUT_BUFFER_HEADER_BYTES..], &mut v);
    Ok(PutBuffer { buffer_id, sample_rate, samples: v.into() })
}

/// Writes an `audio_put_buffer` payload (the TypeScript side does this in production; tests and tools use it).
pub fn encode_put_buffer(buffer_id: u32, sample_rate: u32, samples: &[f32]) -> Vec<u8> {
    let mut out = vec![0u8; PUT_BUFFER_HEADER_BYTES + samples.len() * 4];
    out[0..4].copy_from_slice(&PUT_BUFFER_MAGIC);
    out[4..8].copy_from_slice(&buffer_id.to_le_bytes());
    out[8..12].copy_from_slice(&sample_rate.to_le_bytes());
    out[12..16].copy_from_slice(&(samples.len() as u32).to_le_bytes());
    write_samples(samples, &mut out[PUT_BUFFER_HEADER_BYTES..]);
    out
}

/// Splits an `audio_decode` request into its buffer id and the MP3 file bytes.
pub fn split_decode_request(bytes: &[u8]) -> Result<(u32, &[u8]), WireError> {
    if bytes.len() < 4 {
        return Err(WireError::TooShort);
    }
    Ok((u32::from_le_bytes(arr(&bytes[0..4])), &bytes[4..]))
}

/// Writes an `audio_decode` reply: `u32` sample rate (Hz), `u32` frame count, then the samples.
pub fn encode_decode_reply(sample_rate: u32, samples: &[f32]) -> Vec<u8> {
    let mut out = vec![0u8; 8 + samples.len() * 4];
    out[0..4].copy_from_slice(&sample_rate.to_le_bytes());
    out[4..8].copy_from_slice(&(samples.len() as u32).to_le_bytes());
    write_samples(samples, &mut out[8..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TestRng;

    #[test]
    fn packet_roundtrip() {
        let mut rng = TestRng::new(0x5eed_0001);
        let mut total = 0usize;
        for i in 0..500u32 {
            let n = match i % 5 {
                0 => 0,
                1 => 512,
                _ => rng.below(2049) as usize,
            };
            // Any bit pattern must survive, including NaN payloads and negative zero.
            let samples: Vec<f32> = (0..n).map(|k| if k % 97 == 0 { f32::from_bits(rng.next_u32()) } else { rng.uniform(-1.0, 1.0) as f32 }).collect();
            let header = PacketHeader {
                flags: (rng.next_u32() & 0xf) as u16,
                seq: rng.next_u32(),
                first_frame: (rng.next_u64() >> 11) as f64, // up to 2^53, exact in f64
                n_frames: n as u32,
                dropped_before: rng.next_u32(),
            };
            let mut bytes = Vec::new();
            encode_packet(&header, &samples, &mut bytes);
            assert_eq!(bytes.len(), 24 + 4 * n);
            assert_eq!((bytes[0], bytes[1]), (1, 1));
            let mut fixed = vec![0u8; bytes.len()];
            assert_eq!(encode_packet_into(&header, &samples, &mut fixed), Ok(bytes.len()));
            assert_eq!(fixed, bytes);

            let mut back = Vec::new();
            let h = decode_packet(&bytes, &mut back).expect("decodes");
            assert_eq!(h, header);
            assert_eq!(back.len(), n);
            assert!(back.iter().zip(&samples).all(|(a, b)| a.to_bits() == b.to_bits()));
            let mut again = Vec::new();
            encode_packet(&h, &back, &mut again);
            assert_eq!(again, bytes, "re-encoded bytes identical");
            total += n;
        }
        assert!(total > 100_000);

        // The checked-in capture stream (written by the `capture_golden` example, read by the TypeScript
        // parser too): every packet decodes, re-encodes to the same bytes and carries the fixed input.
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures/native/capture-48k.bin");
        let file = std::fs::read(&path).unwrap_or_else(|e| panic!("{}: {e} (run `cargo run -p sr-audio-core --example capture_golden`)", path.display()));
        let (input, stream) = crate::capture::golden_packet_stream();
        assert!(file == stream, "the fixture is the stream the packetizer writes today");
        let (mut at, mut samples, mut again, mut packets) = (0usize, Vec::new(), Vec::new(), 0u32);
        while at < file.len() {
            let h = PacketHeader::read(&file[at..]).expect("header");
            let bytes = &file[at..at + h.packet_bytes()];
            let before = samples.len();
            assert_eq!(decode_packet(bytes, &mut samples), Ok(h));
            assert_eq!((h.seq, h.first_frame, h.dropped_before), (packets, (crate::capture::GOLDEN_ORIGIN_FRAME + before as u64) as f64, 0));
            encode_packet(&h, &samples[before..], &mut again);
            let last = at + bytes.len() == file.len();
            assert_eq!(h.flags, if last { FLAG_LAST } else if before == 4096 { FLAG_INPUT_ZERO } else { 0 });
            assert_eq!(h.n_frames, if last { 384 } else { 512 });
            at += bytes.len();
            packets += 1;
        }
        assert!(again == file, "re-encoded fixture bytes identical");
        assert!(samples.len() == input.len() && samples.iter().zip(&input).all(|(a, b)| a.to_bits() == b.to_bits()));
        println!("packet_roundtrip: 500 random packets and the fixture ({packets} packets, {} bytes), bytes identical", file.len());
    }

    #[test]
    fn packet_layout_is_the_documented_one() {
        let h = PacketHeader { flags: FLAG_RESAMPLED | FLAG_LAST, seq: 0x0102_0304, first_frame: 48_000.0, n_frames: 1, dropped_before: 7 };
        let mut b = Vec::new();
        encode_packet(&h, &[0.5], &mut b);
        assert_eq!(&b[0..8], &[1, 1, 0b1001, 0, 4, 3, 2, 1]);
        assert_eq!(&b[8..16], &48_000.0f64.to_le_bytes());
        assert_eq!(&b[16..24], &[1, 0, 0, 0, 7, 0, 0, 0]);
        assert_eq!(&b[24..28], &0.5f32.to_le_bytes());
    }

    #[test]
    fn packet_rejects_bad_input() {
        let h = PacketHeader { flags: 0, seq: 0, first_frame: 0.0, n_frames: 2, dropped_before: 0 };
        let mut b = Vec::new();
        encode_packet(&h, &[0.0, 1.0], &mut b);
        let mut s = Vec::new();
        assert_eq!(decode_packet(&b[..20], &mut s), Err(WireError::TooShort));
        assert_eq!(decode_packet(&b[..28], &mut s), Err(WireError::LengthMismatch));
        let mut k = b.clone();
        k[0] = 2;
        assert_eq!(decode_packet(&k, &mut s), Err(WireError::BadKind));
        let mut v = b.clone();
        v[1] = 9;
        assert_eq!(decode_packet(&v, &mut s), Err(WireError::BadVersion));
        let mut f = b.clone();
        f[8..16].copy_from_slice(&1.5f64.to_le_bytes());
        assert_eq!(decode_packet(&f, &mut s), Err(WireError::BadValue));
        let mut small = [0u8; 27];
        assert_eq!(encode_packet_into(&h, &[0.0], &mut small), Err(WireError::NoSpace));
    }

    #[test]
    fn put_buffer_and_decode_messages() {
        let mut rng = TestRng::new(7);
        let samples: Vec<f32> = (0..1000).map(|_| rng.uniform(-1.0, 1.0) as f32).collect();
        let bytes = encode_put_buffer(42, 44_100, &samples);
        assert_eq!(&bytes[0..4], b"SRB1");
        let p = decode_put_buffer(&bytes).expect("decodes");
        assert_eq!((p.buffer_id, p.sample_rate), (42, 44_100));
        assert_eq!(&p.samples[..], &samples[..]);
        assert_eq!(decode_put_buffer(&bytes[..bytes.len() - 1]), Err(WireError::LengthMismatch));
        assert_eq!(decode_put_buffer(&bytes[..8]), Err(WireError::TooShort));
        let mut bad = bytes.clone();
        bad[3] = b'2';
        assert_eq!(decode_put_buffer(&bad), Err(WireError::BadKind));
        let mut zero_rate = bytes.clone();
        zero_rate[8..12].copy_from_slice(&0u32.to_le_bytes());
        assert_eq!(decode_put_buffer(&zero_rate), Err(WireError::BadValue));

        let req = [9u8, 0, 0, 0, 0xff, 0xfb];
        assert_eq!(split_decode_request(&req), Ok((9, &req[4..])));
        let reply = encode_decode_reply(44_100, &samples[..3]);
        assert_eq!(reply.len(), 20);
        assert_eq!(u32::from_le_bytes(arr(&reply[4..8])), 3);
    }
}
