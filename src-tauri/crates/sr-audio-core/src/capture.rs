//! The capture path (design sections 2 and 3): input callback to packets on the engine's frame grid.
//!
//! ```text
//! input callback -> CaptureHalf: input StreamClock, commands
//!                -> downmix -> CaptureAligner (locked: integer offset; resampled: SincResampler + DriftController)
//!                -> Packetizer -> byte ring (2 s) -> CaptureReader (pump thread) -> webview / loopback estimator
//! ```
//!
//! * [`CaptureHalf`] is the realtime side, called from the input callback.
//! * [`CaptureReader`] is the control side: start, stop, events, and whole packets for the pump thread.
//! * [`CaptureAligner`] and [`Packetizer`] are the two stages, usable on their own (tests, the golden example).
//!
//! Engine position of input frame `m`: `p(m) = R(A(m))`, where `A(m)` is the host time at which `m` input
//! frames had been delivered (the input stream's clock) and `R` is the render head (the output clock, read
//! through the anchor the render side publishes).
//!
//! Realtime: the callback pops at most four commands, makes one clock observation, and then does a fixed
//! amount of arithmetic per input frame (locked: a copy; resampled: 32 multiply-adds per output frame). All
//! buffers are allocated when the half is created or its input rate is set. Packets that do not fit in the ring
//! are dropped whole and counted; nothing blocks.

use std::fmt;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use rtrb::{Consumer, Producer, RingBuffer};

use crate::clock::{ClockAnchor, StreamClock};
use crate::resample::{DriftController, SincResampler, LOOKAHEAD, MAX_PUSH};
use crate::wire::{self, PacketHeader, FLAG_DRIFT, FLAG_INPUT_ZERO, FLAG_LAST, FLAG_RESAMPLED, PACKET_HEADER_BYTES};
use crate::{ClockReader, Shared};

/// Smallest packet, frames.
pub const MIN_PACKET_FRAMES: u32 = 256;
/// Largest packet, frames.
pub const MAX_PACKET_FRAMES: u32 = 2048;
/// Default packet, frames (10.7 ms at 48 kHz).
pub const DEFAULT_PACKET_FRAMES: u32 = 512;
/// Audio the packet ring holds, seconds.
pub const RING_SECONDS: f64 = 2.0;
/// The locked path is chosen on measurement only when the two clocks agree within this, with the
/// uncertainty of both fits added (5 ppm).
pub const LOCK_TOLERANCE: f64 = 5e-6;
/// The drift flag is set while the capture is this far from where the clocks put it, seconds (1 ms).
pub const DRIFT_FLAG_SEC: f64 = 0.001;
/// Packet flag, bit 4: a clock stepped during this capture (an xrun on either stream, or an output restart)
/// and the mapping was fixed again; the frame grid is broken at that point. Sticky until the capture ends.
pub const FLAG_CLOCK_STEP: u16 = 1 << 4;
/// Input frames handled per inner block.
const BLOCK: usize = 1024;

/// How input samples reach the engine grid.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CapturePath {
    /// Samples pass through untouched; engine frame = input frame + a fixed integer.
    Locked,
    /// Samples are resampled onto the engine grid, the ratio steered by the clocks.
    Resampled,
}

impl CapturePath {
    /// The wire name, `"locked"` or `"resampled"`.
    pub fn as_str(self) -> &'static str {
        match self {
            CapturePath::Locked => "locked",
            CapturePath::Resampled => "resampled",
        }
    }
}

/// What the device layer knows about the two streams' clocks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ClockRelation {
    /// Nothing known: the path is chosen by measurement. Locked needs equal nominal rates and the measured
    /// rate difference plus the uncertainty of both clock fits under [`LOCK_TOLERANCE`]; otherwise resampled.
    #[default]
    Unknown,
    /// Both streams run from one clock (a duplex device, or one clock domain as the OS reports it): locked
    /// when the nominal rates are equal.
    Shared,
    /// Known to be separate clocks: resampled.
    Separate,
}

/// Parameters of one capture.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CaptureConfig {
    /// Frames per packet, [`MIN_PACKET_FRAMES`] to [`MAX_PACKET_FRAMES`].
    pub packet_frames: u32,
    /// What is known about the clocks.
    pub relation: ClockRelation,
}

impl Default for CaptureConfig {
    fn default() -> Self {
        CaptureConfig { packet_frames: DEFAULT_PACKET_FRAMES, relation: ClockRelation::Unknown }
    }
}

/// Counters of one capture (`audio_capture_stop`'s reply).
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct CaptureStats {
    /// Packets written to the ring.
    pub packets: u64,
    /// Frames in those packets.
    pub frames: u64,
    /// Engine frames dropped because the ring was full.
    pub dropped_frames: u64,
    /// Fullest the ring has been, milliseconds of audio.
    pub max_ring_ms: f64,
    /// Clock steps (xruns, output restarts) during the capture.
    pub clock_steps: u64,
}

/// Which stream's clock stepped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamKind {
    /// The input stream.
    Input,
    /// The output stream.
    Output,
}

/// What the capture half reports, in order.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum CaptureEvent {
    /// The capture began (both clocks had settled). The reply of `audio_capture_start`.
    Started {
        /// Engine frame of the first sample of packet 0.
        origin_frame: u64,
        /// Engine rate, Hz (the rate of the samples in the packets).
        engine_rate: u32,
        /// The path chosen.
        path: CapturePath,
    },
    /// The capture ended; the last packet (flag bit 3) is in the ring.
    Stopped(CaptureStats),
    /// A clock stepped during the capture (the `xrun` event). The mapping was fixed again, the packets carry
    /// [`FLAG_CLOCK_STEP`], and their `firstFrame` may jump.
    ClockStep {
        /// The stream whose clock stepped.
        stream: StreamKind,
    },
    /// A start arrived while a capture was running or waiting; it was ignored.
    StartIgnored,
}

/// Why a capture control call did nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureError {
    /// `packet_frames` outside [`MIN_PACKET_FRAMES`] to [`MAX_PACKET_FRAMES`].
    BadPacketFrames,
    /// The command ring is full (the input callback is not running).
    QueueFull,
    /// The capture half has been dropped.
    EngineGone,
}

impl fmt::Display for CaptureError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            CaptureError::BadPacketFrames => "packet size out of range",
            CaptureError::QueueFull => "the capture command queue is full",
            CaptureError::EngineGone => "the capture side is closed",
        })
    }
}

impl std::error::Error for CaptureError {}

// ---------------------------------------------------------------------------------------------------------
// Packetizer
// ---------------------------------------------------------------------------------------------------------

/// Cuts runs of samples on the engine grid into packets and writes them, encoded, into a byte ring.
///
/// A packet holds `packet_frames` frames, except the last one of a capture and the one before a break in the
/// frame grid, which are shorter. A packet that does not fit in the ring is dropped whole; its frames are
/// counted into `droppedBefore` of the next packet that does fit. `seq` counts the packets written.
pub struct Packetizer {
    ring: Producer<u8>,
    /// Engine rate, Hz (for the ring statistics).
    rate: u32,
    packet_frames: usize,
    buf: Box<[f32]>,
    fill: usize,
    /// Engine frame of `buf[0]`.
    first_frame: u64,
    seq: u32,
    dropped_pending: u64,
    flags: u16,
    scratch: Box<[u8]>,
    stats: CaptureStats,
    max_ring_bytes: usize,
}

impl fmt::Debug for Packetizer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Packetizer").field("packet_frames", &self.packet_frames).field("seq", &self.seq).finish_non_exhaustive()
    }
}

/// Reads whole packets from the byte ring (the pump thread's side).
pub struct PacketReader {
    ring: Consumer<u8>,
}

impl fmt::Debug for PacketReader {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PacketReader").finish_non_exhaustive()
    }
}

/// Bytes a ring needs to hold `seconds` of audio at `rate` Hz in the smallest packets.
fn ring_bytes(rate: u32, seconds: f64) -> usize {
    let frames = (rate as f64 * seconds).ceil() as usize;
    frames * 4 + (frames / MIN_PACKET_FRAMES as usize + 2) * PACKET_HEADER_BYTES
}

/// A packet ring for `seconds` of audio at `engine_rate` Hz: the writer for the audio side, the reader for the
/// pump. Allocates everything both sides need.
pub fn packet_ring(engine_rate: u32, seconds: f64) -> (Packetizer, PacketReader) {
    let (tx, rx) = RingBuffer::new(ring_bytes(engine_rate, seconds));
    let packetizer = Packetizer {
        ring: tx,
        rate: engine_rate,
        packet_frames: DEFAULT_PACKET_FRAMES as usize,
        buf: vec![0f32; MAX_PACKET_FRAMES as usize].into(),
        fill: 0,
        first_frame: 0,
        seq: 0,
        dropped_pending: 0,
        flags: 0,
        scratch: vec![0u8; PACKET_HEADER_BYTES + MAX_PACKET_FRAMES as usize * 4].into(),
        stats: CaptureStats::default(),
        max_ring_bytes: 0,
    };
    (packetizer, PacketReader { ring: rx })
}

impl Packetizer {
    /// Starts a capture: packet numbering and statistics from 0, `packet_frames` per packet (clamped to the
    /// allowed range), `flags` in every header.
    pub fn begin(&mut self, packet_frames: u32, flags: u16) {
        self.packet_frames = packet_frames.clamp(MIN_PACKET_FRAMES, MAX_PACKET_FRAMES) as usize;
        self.fill = 0;
        self.seq = 0;
        self.dropped_pending = 0;
        self.flags = flags;
        self.stats = CaptureStats::default();
        self.max_ring_bytes = 0;
    }

    /// Sets header flag bits for the packets from the current one on.
    pub fn set_flags(&mut self, bits: u16) {
        self.flags |= bits;
    }

    /// Clears header flag bits for the packets from the current one on.
    pub fn clear_flags(&mut self, bits: u16) {
        self.flags &= !bits;
    }

    /// Adds samples whose first one is engine frame `first_frame`. When that is not the frame after the last
    /// sample added, the packet in progress is closed short and a new one starts at `first_frame`. Realtime:
    /// copies, and one encode per packet.
    pub fn write(&mut self, first_frame: u64, samples: &[f32]) {
        if self.fill > 0 && first_frame != self.first_frame + self.fill as u64 {
            self.emit(false);
        }
        let mut done = 0;
        while done < samples.len() {
            if self.fill == 0 {
                self.first_frame = first_frame + done as u64;
            }
            let n = (self.packet_frames - self.fill).min(samples.len() - done);
            self.buf[self.fill..self.fill + n].copy_from_slice(&samples[done..done + n]);
            self.fill += n;
            done += n;
            if self.fill == self.packet_frames {
                self.emit(false);
            }
        }
    }

    /// Closes the packet in progress short, if it holds any frames (before a break in the grid).
    pub fn flush(&mut self) {
        if self.fill > 0 {
            self.emit(false);
        }
    }

    /// Ends the capture: writes what is pending as the last packet (flag bit 3), even when that is no frames
    /// at all, and returns the statistics.
    pub fn finish(&mut self) -> CaptureStats {
        self.emit(true);
        self.stats()
    }

    /// Statistics so far.
    pub fn stats(&self) -> CaptureStats {
        CaptureStats { max_ring_ms: self.max_ring_bytes as f64 / 4.0 / self.rate as f64 * 1000.0, ..self.stats }
    }

    fn emit(&mut self, last: bool) {
        let samples = &self.buf[..self.fill];
        let mut flags = self.flags;
        if last {
            flags |= FLAG_LAST;
        }
        if !samples.is_empty() && samples.iter().all(|x| *x == 0.0) {
            flags |= FLAG_INPUT_ZERO;
        }
        let header = PacketHeader {
            flags,
            seq: self.seq,
            first_frame: self.first_frame as f64,
            n_frames: samples.len() as u32,
            dropped_before: self.dropped_pending.min(u32::MAX as u64) as u32,
        };
        let written = match wire::encode_packet_into(&header, samples, &mut self.scratch) {
            Ok(len) => self.ring.push_entire_slice(&self.scratch[..len]).is_ok(),
            Err(_) => false,
        };
        if written {
            self.seq = self.seq.wrapping_add(1);
            self.dropped_pending = 0;
            self.stats.packets += 1;
            self.stats.frames += self.fill as u64;
            let used = self.ring.buffer().capacity() - self.ring.slots();
            self.max_ring_bytes = self.max_ring_bytes.max(used);
        } else {
            self.dropped_pending += self.fill as u64;
            self.stats.dropped_frames += self.fill as u64;
            self.max_ring_bytes = self.ring.buffer().capacity();
        }
        self.first_frame += self.fill as u64;
        self.fill = 0;
    }
}

impl PacketReader {
    /// Moves the next whole packet into `out` (cleared first). False when no packet is waiting.
    pub fn read_packet(&mut self, out: &mut Vec<u8>) -> bool {
        out.clear();
        let mut head = [0u8; PACKET_HEADER_BYTES];
        {
            let Ok(chunk) = self.ring.read_chunk(PACKET_HEADER_BYTES) else { return false };
            let (a, b) = chunk.as_slices();
            head[..a.len()].copy_from_slice(a);
            head[a.len()..].copy_from_slice(b);
            // Dropped without commit: the header stays in the ring.
        }
        let Ok(header) = PacketHeader::read(&head) else {
            // Not a packet: the stream is unusable. Discard everything so the reader cannot spin on it.
            let n = self.ring.slots();
            if let Ok(chunk) = self.ring.read_chunk(n) {
                chunk.commit_all();
            }
            return false;
        };
        // The writer commits a packet in one piece, so the whole packet is there.
        let Ok(chunk) = self.ring.read_chunk(header.packet_bytes()) else { return false };
        let (a, b) = chunk.as_slices();
        out.extend_from_slice(a);
        out.extend_from_slice(b);
        chunk.commit_all();
        true
    }

    /// Reads the next packet and decodes it: the header, with the samples appended to `samples`.
    pub fn read_decoded(&mut self, scratch: &mut Vec<u8>, samples: &mut Vec<f32>) -> Option<PacketHeader> {
        if !self.read_packet(scratch) {
            return None;
        }
        wire::decode_packet(scratch, samples).ok()
    }

    /// Bytes waiting in the ring.
    pub fn pending_bytes(&self) -> usize {
        self.ring.slots()
    }
}

/// Seed of the samples in the golden packet stream.
pub const GOLDEN_SEED: u32 = 0x5eed;
/// Engine frame of the first sample in the golden packet stream.
pub const GOLDEN_ORIGIN_FRAME: u64 = 48_000;

/// The fixed capture behind `fixtures/native/capture-48k.bin` (the `capture_golden` example writes it, the
/// TypeScript packet parser and `packet_roundtrip` read it): the input samples and the packet stream.
///
/// Input: 48 000 samples, sample `i` = `fround((rng.next() * 2 - 1) * 0.5)` from the generator of
/// `src/core/rng.ts` seeded with [`GOLDEN_SEED`]; samples 4096 to 4607 are 0 instead (one all-zero packet).
/// Stream: 512-frame packets from engine frame [`GOLDEN_ORIGIN_FRAME`], written in 480-frame callbacks; 93
/// full packets and a last one of 384 frames with flag bit 3. 194 256 bytes.
pub fn golden_packet_stream() -> (Vec<f32>, Vec<u8>) {
    let mut rng = crate::synth::Rng::new(GOLDEN_SEED);
    let input: Vec<f32> = (0..48_000).map(|i| { let v = ((rng.next_f64() * 2.0 - 1.0) * 0.5) as f32; if (4096..4608).contains(&i) { 0.0 } else { v } }).collect();
    let (mut packetizer, mut reader) = packet_ring(48_000, RING_SECONDS);
    packetizer.begin(DEFAULT_PACKET_FRAMES, 0);
    for (k, block) in input.chunks(480).enumerate() {
        packetizer.write(GOLDEN_ORIGIN_FRAME + k as u64 * 480, block);
    }
    packetizer.finish();
    let (mut stream, mut packet) = (Vec::new(), Vec::new());
    while reader.read_packet(&mut packet) {
        stream.extend_from_slice(&packet);
    }
    (input, stream)
}

// ---------------------------------------------------------------------------------------------------------
// Aligner
// ---------------------------------------------------------------------------------------------------------

/// The two clocks as the capture side sees them at one moment.
#[derive(Debug, Clone, Copy)]
pub struct ClockView<'a> {
    /// The input stream's clock, `A`.
    pub input: &'a StreamClock,
    /// The output clock's line, `R`.
    pub anchor: ClockAnchor,
    /// Engine rate, Hz.
    pub engine_rate: f64,
}

impl ClockView<'_> {
    /// `p(m) = R(A(m))`: the engine position (frames) of input position `m` (frames).
    pub fn engine_pos(&self, m: f64) -> Option<f64> {
        let host_ns = self.input.host_ns_at(m)?;
        Some(self.anchor.engine_sec_at(host_ns / 1e6) * self.engine_rate)
    }

    /// The inverse: the input position (frames) that is at engine position `n` (frames).
    pub fn input_pos(&self, n: f64) -> Option<f64> {
        let host_ms = self.anchor.host_ms + (n / self.engine_rate - self.anchor.engine_sec) / self.anchor.rate * 1000.0;
        self.input.frames_at_f64(host_ms * 1e6)
    }

    /// Input frames per engine frame, from the two fitted rates.
    pub fn ratio(&self) -> Option<f64> {
        Some(self.input.frames_per_sec()? / (self.anchor.rate * self.engine_rate))
    }
}

/// Puts input samples on the engine's frame grid.
#[derive(Debug)]
pub struct CaptureAligner {
    path: CapturePath,
    input_rate: f64,
    /// Locked: engine frame = input frame + `offset`.
    offset: i64,
    resampler: SincResampler,
    control: DriftController,
    /// Resampled: the next engine frame to produce, and the input position it is read at.
    out_frame: u64,
    in_pos: f64,
    /// Where the capture is against where the clocks put it, seconds (positive: behind).
    drift_sec: f64,
    out: Box<[f32]>,
}

impl CaptureAligner {
    /// An aligner for input at `input_rate` Hz and an engine at `engine_rate` Hz. Allocates.
    pub fn new(input_rate: u32, engine_rate: u32) -> Self {
        CaptureAligner {
            path: CapturePath::Locked,
            input_rate: input_rate as f64,
            offset: 0,
            resampler: SincResampler::for_rates(input_rate, engine_rate),
            control: DriftController::new(input_rate as f64 / engine_rate as f64),
            out_frame: 0,
            in_pos: 0.0,
            drift_sec: 0.0,
            out: vec![0f32; BLOCK].into(),
        }
    }

    /// The path in use.
    pub fn path(&self) -> CapturePath {
        self.path
    }

    /// Where the capture is against where the clocks put it, seconds, as of the last [`CaptureAligner::steer`].
    pub fn drift_sec(&self) -> f64 {
        self.drift_sec
    }

    /// The resampling ratio in use, input frames per engine frame (resampled path).
    pub fn ratio(&self) -> f64 {
        self.control.ratio()
    }

    /// Fixes the mapping so that the next input frame handed to [`CaptureAligner::process`] is
    /// `first_input_frame`. Returns the engine frame of the first sample that will come out, or `None` when
    /// the clocks cannot place it (not settled, or before engine frame 0).
    ///
    /// Locked: the offset is `round(p(m) - m)`. Resampled: the first output is the first engine frame whose
    /// kernel lies wholly inside the new input.
    pub fn start(&mut self, path: CapturePath, first_input_frame: u64, view: &ClockView<'_>) -> Option<u64> {
        let m = first_input_frame as f64;
        self.path = path;
        self.drift_sec = 0.0;
        match path {
            CapturePath::Locked => {
                let offset = (view.engine_pos(m)? - m).round();
                if !offset.is_finite() || m + offset < 0.0 {
                    return None;
                }
                self.offset = offset as i64;
                Some((first_input_frame as i64 + self.offset) as u64)
            }
            CapturePath::Resampled => {
                let first = view.engine_pos(m + LOOKAHEAD as f64)?.ceil();
                if !first.is_finite() || first < 0.0 {
                    return None;
                }
                self.out_frame = first as u64;
                self.in_pos = view.input_pos(first)?;
                self.control = DriftController::new(view.ratio()?);
                self.resampler.reset(first_input_frame);
                Some(self.out_frame)
            }
        }
    }

    /// Once per callback, before [`CaptureAligner::process`]: measures the drift against the clocks and, on
    /// the resampled path, steers the ratio. `next_input_frame` is the first frame the callback delivers and
    /// `dt_sec` its length.
    pub fn steer(&mut self, next_input_frame: u64, dt_sec: f64, view: &ClockView<'_>) {
        match self.path {
            CapturePath::Locked => {
                let m = next_input_frame as f64;
                if let Some(p) = view.engine_pos(m) {
                    self.drift_sec = (p - (m + self.offset as f64)) / view.engine_rate;
                }
            }
            CapturePath::Resampled => {
                if let (Some(target), Some(ratio)) = (view.input_pos(self.out_frame as f64), view.ratio()) {
                    self.drift_sec = (target - self.in_pos) / self.input_rate;
                    self.control.update(ratio, self.drift_sec, dt_sec);
                }
            }
        }
    }

    /// Hands the mono input samples starting at `first_input_frame` to `emit` as runs on the engine grid:
    /// `emit(engine frame of the first sample, samples)`. Realtime: no allocation; locked is a pass-through.
    pub fn process(&mut self, mono: &[f32], first_input_frame: u64, emit: &mut impl FnMut(u64, &[f32])) {
        match self.path {
            CapturePath::Locked => {
                let first = first_input_frame as i64 + self.offset;
                if first >= 0 {
                    emit(first as u64, mono);
                }
            }
            CapturePath::Resampled => {
                for block in mono.chunks(MAX_PUSH.min(BLOCK)) {
                    self.resampler.push(block);
                    loop {
                        let ratio = self.control.ratio();
                        let mut k = 0;
                        while k < self.out.len() && self.resampler.can_read(self.in_pos) {
                            self.out[k] = self.resampler.at(self.in_pos);
                            self.in_pos += ratio;
                            k += 1;
                        }
                        if k == 0 {
                            break;
                        }
                        emit(self.out_frame, &self.out[..k]);
                        self.out_frame += k as u64;
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------------------
// The two halves
// ---------------------------------------------------------------------------------------------------------

enum CaptureCommand {
    Start(CaptureConfig),
    Stop,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum State {
    Idle,
    /// Started, waiting for both clocks to settle.
    Waiting(CaptureConfig),
    Running,
}

/// The capture side of the engine, called from the input callback. Obtained from
/// [`crate::Engine::split_capture`] when input runs on its own thread; otherwise [`crate::Engine::capture`]
/// drives it.
pub struct CaptureHalf {
    clock: ClockReader,
    input_rate: u32,
    /// `A(m)`: the input stream's clock.
    input_clock: StreamClock,
    /// Input frames delivered so far, frames at the input rate.
    frames: u64,
    /// The last output anchor read (kept when a read meets a write in progress).
    anchor: Option<ClockAnchor>,
    seen_output_steps: u64,
    commands: Consumer<CaptureCommand>,
    events: Producer<CaptureEvent>,
    packets: Packetizer,
    aligner: CaptureAligner,
    state: State,
    steps: u64,
    mono: Box<[f32]>,
}

impl fmt::Debug for CaptureHalf {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("CaptureHalf").field("input_rate", &self.input_rate).field("frames", &self.frames).field("state", &self.state).finish_non_exhaustive()
    }
}

/// Creates the two capture halves for an engine. Allocates the rings and every buffer.
pub(crate) fn channel(clock: ClockReader) -> (CaptureHalf, CaptureReader) {
    let rate = clock.engine_rate();
    let (cmd_tx, cmd_rx) = RingBuffer::new(16);
    let (ev_tx, ev_rx) = RingBuffer::new(64);
    let (packetizer, reader) = packet_ring(rate, RING_SECONDS);
    let shared = Arc::clone(&clock.shared);
    let half = CaptureHalf {
        clock,
        input_rate: rate,
        input_clock: StreamClock::new(rate as f64),
        frames: 0,
        anchor: None,
        seen_output_steps: 0,
        commands: cmd_rx,
        events: ev_tx,
        packets: packetizer,
        aligner: CaptureAligner::new(rate, rate),
        state: State::Idle,
        steps: 0,
        mono: vec![0f32; BLOCK].into(),
    };
    (half, CaptureReader { commands: cmd_tx, events: ev_rx, packets: reader, shared })
}

impl CaptureHalf {
    /// Declares the input stream's nominal rate, Hz, and restarts its clock. Builds the resampler for that
    /// rate (allocates): call before the stream starts, not from the callback.
    pub fn set_input_rate(&mut self, input_rate: u32) {
        self.input_rate = input_rate.max(1);
        self.input_clock = StreamClock::new(self.input_rate as f64);
        self.aligner = CaptureAligner::new(self.input_rate, self.clock.engine_rate());
        self.frames = 0;
    }

    /// The input stream's nominal rate, Hz.
    pub fn input_rate(&self) -> u32 {
        self.input_rate
    }

    /// The input stream's clock (`A(m)` is [`StreamClock::host_ns_at`]).
    pub fn input_clock(&self) -> &StreamClock {
        &self.input_clock
    }

    /// The output anchor this half last read; with [`CaptureHalf::input_clock`] it gives `p(m) = R(A(m))`.
    pub fn output_anchor(&self) -> Option<ClockAnchor> {
        self.anchor
    }

    /// Input frames delivered so far.
    pub fn frames(&self) -> u64 {
        self.frames
    }

    fn send(&mut self, event: CaptureEvent) {
        // A full event ring loses the event; the packet stream and the statistics still tell the story.
        let _ = self.events.push(event);
    }

    /// Chooses the path for a capture that starts now.
    fn choose_path(&self, relation: ClockRelation, view: &ClockView<'_>, output_uncertainty: f64) -> CapturePath {
        let same_rate = self.input_rate == self.clock.engine_rate();
        match relation {
            ClockRelation::Separate => CapturePath::Resampled,
            ClockRelation::Shared if same_rate => CapturePath::Locked,
            ClockRelation::Shared => CapturePath::Resampled,
            ClockRelation::Unknown => {
                let off = view.ratio().map_or(f64::INFINITY, |r| (r - 1.0).abs());
                if same_rate && off + self.input_clock.rate_uncertainty() + output_uncertainty < LOCK_TOLERANCE {
                    CapturePath::Locked
                } else {
                    CapturePath::Resampled
                }
            }
        }
    }

    /// The input callback. `input` is interleaved with `channels` channels at the input stream's rate;
    /// `host_ns` is the callback's reading of the process-wide monotonic clock, taken as its first statement.
    ///
    /// Realtime: see the module text. No allocation, lock or system call.
    pub fn capture(&mut self, host_ns: u64, input: &[f32], channels: usize) {
        if channels == 0 {
            return;
        }
        let shared = Arc::clone(&self.clock.shared); // a reference-count increment, no allocation
        let n = input.len() / channels;
        let first = self.frames;
        self.frames += n as u64;
        let update = self.input_clock.observe(host_ns, self.frames);
        if let Ok(a) = self.clock.anchor_bounded(4) {
            self.anchor = a;
        }
        let output_steps = shared.output_steps.load(Ordering::Relaxed);
        let output_stepped = output_steps != self.seen_output_steps;
        self.seen_output_steps = output_steps;
        let output_uncertainty = f64::from_bits(shared.output_uncertainty.load(Ordering::Relaxed));
        shared.input_frames.store(self.frames, Ordering::Relaxed);

        for _ in 0..4 {
            match self.commands.pop() {
                Ok(CaptureCommand::Start(config)) => {
                    if self.state == State::Idle {
                        self.state = State::Waiting(config);
                    } else {
                        self.send(CaptureEvent::StartIgnored);
                    }
                }
                Ok(CaptureCommand::Stop) => {
                    let stats = match self.state {
                        State::Running => CaptureStats { clock_steps: self.steps, ..self.packets.finish() },
                        _ => CaptureStats::default(),
                    };
                    if self.state != State::Idle {
                        self.send(CaptureEvent::Stopped(stats));
                    }
                    self.state = State::Idle;
                    shared.capture_running.store(0, Ordering::Relaxed);
                }
                Err(_) => break,
            }
        }

        let Some(anchor) = self.anchor else { return };
        let engine_rate = self.clock.engine_rate();
        let view = ClockView { input: &self.input_clock, anchor, engine_rate: engine_rate as f64 };
        let settled = self.input_clock.is_settled() && output_uncertainty.is_finite();
        if settled {
            // Input clock rate against the output clock's, for the clock-rate check.
            if let Some(ratio) = view.ratio() {
                let ppm = (ratio * engine_rate as f64 / self.input_rate as f64 - 1.0) * 1e6;
                shared.input_drift_ppm.store(ppm.to_bits(), Ordering::Relaxed);
            }
        }

        if let State::Waiting(config) = self.state {
            if !settled {
                return;
            }
            let path = self.choose_path(config.relation, &view, output_uncertainty);
            let Some(origin_frame) = self.aligner.start(path, first, &view) else { return };
            self.packets.begin(config.packet_frames, if path == CapturePath::Resampled { FLAG_RESAMPLED } else { 0 });
            self.steps = 0;
            self.state = State::Running;
            shared.capture_running.store(1, Ordering::Relaxed);
            let _ = self.events.push(CaptureEvent::Started { origin_frame, engine_rate, path });
        } else if self.state == State::Running && (update.step || output_stepped) {
            // The stream lost or gained time: fix the mapping again from here. The frame grid breaks, which
            // the receiver sees as a gap.
            self.steps += 1;
            self.packets.flush();
            self.packets.set_flags(FLAG_CLOCK_STEP);
            let path = self.aligner.path();
            let _ = self.aligner.start(path, first, &view);
            let _ = self.events.push(CaptureEvent::ClockStep { stream: if update.step { StreamKind::Input } else { StreamKind::Output } });
        }
        if self.state != State::Running {
            return;
        }

        self.aligner.steer(first, n as f64 / self.input_rate as f64, &view);
        if self.aligner.drift_sec().abs() > DRIFT_FLAG_SEC {
            self.packets.set_flags(FLAG_DRIFT);
        } else {
            self.packets.clear_flags(FLAG_DRIFT);
        }

        let (aligner, packets, mono) = (&mut self.aligner, &mut self.packets, &mut self.mono);
        let mut emit = |frame: u64, samples: &[f32]| packets.write(frame, samples);
        let mut done = 0usize;
        while done < n {
            let k = (n - done).min(BLOCK);
            let block = &input[done * channels..(done + k) * channels];
            if channels == 1 {
                aligner.process(block, first + done as u64, &mut emit);
            } else {
                let scale = 1.0 / channels as f32;
                for (m, frame) in mono.iter_mut().zip(block.chunks_exact(channels)) {
                    *m = frame.iter().sum::<f32>() * scale;
                }
                aligner.process(&mono[..k], first + done as u64, &mut emit);
            }
            done += k;
        }

        let stats = self.packets.stats();
        shared.capture_packets.store(stats.packets, Ordering::Relaxed);
        shared.capture_frames.store(stats.frames, Ordering::Relaxed);
        shared.capture_dropped.store(stats.dropped_frames, Ordering::Relaxed);
        shared.capture_max_ring_us.store((stats.max_ring_ms * 1000.0) as u64, Ordering::Relaxed);
    }
}

/// The control side of capture: start and stop, events, and the packets. One owner (the pump thread, or the
/// Tauri state next to the [`crate::EngineHandle`]); every method returns at once.
pub struct CaptureReader {
    commands: Producer<CaptureCommand>,
    events: Consumer<CaptureEvent>,
    packets: PacketReader,
    shared: Arc<Shared>,
}

impl fmt::Debug for CaptureReader {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("CaptureReader").field("running", &self.is_running()).finish_non_exhaustive()
    }
}

impl CaptureReader {
    fn command(&mut self, c: CaptureCommand) -> Result<(), CaptureError> {
        if self.commands.is_abandoned() {
            return Err(CaptureError::EngineGone);
        }
        self.commands.push(c).map_err(|_| CaptureError::QueueFull)
    }

    /// Asks for a capture (`audio_capture_start`). It begins at the first input callback at which both
    /// stream clocks have settled (about 1.2 s after the streams opened; at once later on) and is announced
    /// by [`CaptureEvent::Started`], which carries the reply's `originFrame` and `path`.
    pub fn start(&mut self, config: CaptureConfig) -> Result<(), CaptureError> {
        if !(MIN_PACKET_FRAMES..=MAX_PACKET_FRAMES).contains(&config.packet_frames) {
            return Err(CaptureError::BadPacketFrames);
        }
        self.command(CaptureCommand::Start(config))
    }

    /// Ends the capture (`audio_capture_stop`) at the next input callback: the pending frames go out as the
    /// last packet and [`CaptureEvent::Stopped`] carries the statistics.
    pub fn stop(&mut self) -> Result<(), CaptureError> {
        self.command(CaptureCommand::Stop)
    }

    /// The next event, if any.
    pub fn poll_event(&mut self) -> Option<CaptureEvent> {
        self.events.pop().ok()
    }

    /// Moves the next whole packet (header and samples, ready for the channel) into `out`, cleared first.
    /// False when none is waiting. The pump calls this until it returns false, about every 5 ms.
    pub fn read_packet(&mut self, out: &mut Vec<u8>) -> bool {
        self.packets.read_packet(out)
    }

    /// Reads the next packet and decodes it (for consumers on the Rust side): the header, with the samples
    /// appended to `samples`.
    pub fn read_decoded(&mut self, scratch: &mut Vec<u8>, samples: &mut Vec<f32>) -> Option<PacketHeader> {
        self.packets.read_decoded(scratch, samples)
    }

    /// True between [`CaptureEvent::Started`] and the stop being taken.
    pub fn is_running(&self) -> bool {
        self.shared.capture_running.load(Ordering::Relaxed) != 0
    }

    /// Statistics of the running (or last) capture, as of the last input callback.
    pub fn stats(&self) -> CaptureStats {
        let s = &self.shared;
        CaptureStats {
            packets: s.capture_packets.load(Ordering::Relaxed),
            frames: s.capture_frames.load(Ordering::Relaxed),
            dropped_frames: s.capture_dropped.load(Ordering::Relaxed),
            max_ring_ms: s.capture_max_ring_us.load(Ordering::Relaxed) as f64 / 1000.0,
            clock_steps: 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::synth::Rng;

    fn drain(reader: &mut PacketReader) -> Vec<(PacketHeader, Vec<f32>)> {
        let (mut bytes, mut out) = (Vec::new(), Vec::new());
        loop {
            let mut samples = Vec::new();
            match reader.read_decoded(&mut bytes, &mut samples) {
                Some(h) => out.push((h, samples)),
                None => return out,
            }
        }
    }

    #[test]
    fn ring_overflow_counts() {
        let rate = 48_000u32;
        let (mut p, mut reader) = packet_ring(rate, RING_SECONDS);
        p.begin(512, 0);
        let mut rng = Rng::new(9);
        let block: Vec<f32> = (0..480).map(|_| rng.uniform(-1.0, 1.0) as f32).collect();
        let origin = 1_000_000u64;
        let mut frame = origin;
        // The pump is stalled for 3 s while 10 ms callbacks keep coming.
        for _ in 0..300 {
            p.write(frame, &block);
            frame += 480;
        }
        let stalled = p.stats();
        // Then it drains, and one more second is captured with the pump running.
        let first = drain(&mut reader);
        let mut after = Vec::new();
        for _ in 0..100 {
            p.write(frame, &block);
            frame += 480;
            after.extend(drain(&mut reader));
        }
        let end = p.finish();
        after.extend(drain(&mut reader));

        let kept: u64 = first.iter().map(|(h, _)| h.n_frames as u64).sum();
        assert!(first.iter().all(|(h, s)| h.dropped_before == 0 && h.n_frames == 512 && s.len() == 512));
        assert!(first.iter().enumerate().all(|(i, (h, _))| h.seq == i as u32 && h.first_frame == (origin + i as u64 * 512) as f64));
        // 3 s were written into a 2 s ring: what did not fit was dropped whole.
        let lost = stalled.dropped_frames;
        assert_eq!(kept + lost, 300 * 480 / 512 * 512);
        // The ring holds 2 s plus the header room of the smallest packets.
        assert!((96_000..=97_024).contains(&kept), "{kept}");
        // The first packet after the stall says how much is missing and is stamped exactly.
        let (h, _) = &after[0];
        assert_eq!(h.dropped_before as u64, lost);
        assert_eq!(h.seq as usize, first.len());
        assert_eq!(h.first_frame, (origin + kept + lost) as f64);
        let mut expect = origin + kept + lost;
        for (i, (h, s)) in after.iter().enumerate() {
            assert_eq!(h.first_frame, expect as f64, "packet {i} after the stall");
            assert_eq!(h.dropped_before, if i == 0 { lost as u32 } else { 0 });
            expect += s.len() as u64;
        }
        assert_eq!(expect, frame);
        let (last, _) = after.last().unwrap();
        assert_eq!(last.flags & FLAG_LAST, FLAG_LAST);
        assert_eq!((end.dropped_frames, end.frames + end.dropped_frames), (lost, 400 * 480));
        println!(
            "ring_overflow_counts: pump stalled 3 s, {kept} frames kept ({:.0} ms, ring max {:.0} ms), {lost} dropped = droppedBefore of the next packet; {} later packets stamped exactly",
            kept as f64 / 48.0, end.max_ring_ms, after.len()
        );
        assert!(end.max_ring_ms >= 2000.0 && end.max_ring_ms <= 2050.0);
    }

    #[test]
    fn packetizer_flags_last_zero_and_breaks() {
        let (mut p, mut reader) = packet_ring(48_000, RING_SECONDS);
        p.begin(256, FLAG_RESAMPLED);
        p.write(1000, &[0.0; 256]); // all zero
        p.write(1256, &[0.5; 300]); // one full packet, 44 pending
        p.set_flags(FLAG_DRIFT);
        p.write(5000, &[0.25; 10]); // a break: the 44 go out short, then a new packet starts
        let stats = p.finish();
        let got = drain(&mut reader);
        let view: Vec<(u16, u32, f64, usize)> = got.iter().map(|(h, s)| (h.flags, h.seq, h.first_frame, s.len())).collect();
        assert_eq!(view, vec![
            (FLAG_RESAMPLED | FLAG_INPUT_ZERO, 0, 1000.0, 256),
            (FLAG_RESAMPLED, 1, 1256.0, 256),
            (FLAG_RESAMPLED | FLAG_DRIFT, 2, 1512.0, 44),
            (FLAG_RESAMPLED | FLAG_DRIFT | FLAG_LAST, 3, 5000.0, 10),
        ]);
        assert_eq!((stats.packets, stats.frames, stats.dropped_frames), (4, 566, 0));
        // A capture that ends on a packet boundary still gets a last packet, with no frames.
        p.begin(256, 0);
        p.write(0, &[0.0; 256]);
        p.finish();
        let got = drain(&mut reader);
        assert_eq!(got.len(), 2);
        assert_eq!((got[0].0.flags, got[1].0.flags, got[1].0.n_frames, got[1].0.first_frame), (FLAG_INPUT_ZERO, FLAG_LAST, 0, 256.0));
        // Out-of-range packet sizes are clamped.
        p.begin(10_000, 0);
        p.write(0, &[1.0; 2048]);
        assert_eq!(drain(&mut reader)[0].1.len(), 2048);
    }
}
