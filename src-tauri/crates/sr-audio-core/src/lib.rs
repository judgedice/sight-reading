//! Pure audio core of the native app: no device, no Tauri, no threads of its own, no `unsafe`.
//!
//! | Module | Content |
//! | --- | --- |
//! | [`mixer`] | Sample-accurate buffer voices: [`mixer::BufferStore`], [`mixer::VoiceSpec`], [`mixer::Scheduler`] |
//! | [`clock`] | Host time to frame fits, the output clock, clock anchors, the clock-rate check |
//! | [`latency`] | Reported latency parts, sums, trust class, predicted round trip |
//! | [`decode`] | MP3 to mono PCM |
//! | [`wire`] | Binary layouts shared with the webview |
//!
//! This file ties them together for a device layer:
//!
//! * [`Engine`] is the realtime half. The device layer calls [`Engine::render`] from the output callback and
//!   [`Engine::capture`] (or [`CaptureHalf::capture`], when input runs on its own thread) from the input
//!   callback, each time with the callback's reading of one process-wide monotonic clock (`host_ns`).
//! * [`EngineHandle`] is the non-realtime half: buffers, scheduling, stops, notifications, the clock.
//!
//! The halves talk through three single-producer single-consumer rings (commands in; notifications out;
//! buffers to free out) and a few atomics, so the callbacks never lock, allocate, free or block.
//!
//! Units: audio samples are `f32`, full scale ±1. Time is `f64` seconds, or `u64` frames or nanoseconds.
//! Engine time is the output frame counter divided by the engine rate; frame 0 is the first frame rendered.

#![forbid(unsafe_code)]
#![warn(missing_docs)]

pub mod clock;
pub mod decode;
pub mod latency;
pub mod mixer;
pub mod resample;
pub mod synth;
pub mod wire;

#[cfg(test)]
mod testutil;

use std::fmt;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use rtrb::{Consumer, Producer, RingBuffer};

use clock::{ClockAnchor, ClockBridge, ClockPoint, RateCheck, RateCheckReport, StreamClock};
use mixer::{AudioBuffer, BufferStore, EventSink, Group, RejectReason, Scheduler, SpecError, Voice, VoiceEvent, VoiceSpec};

/// Sizes of an engine. Everything is allocated once, in [`engine`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EngineConfig {
    /// Engine rate: the output stream's sample rate, Hz.
    pub engine_rate: u32,
    /// Most voices waiting for their start frame.
    pub max_pending: usize,
    /// Most voices sounding at once.
    pub max_sounding: usize,
    /// Capacity of the command ring, commands (one per scheduled voice, one per 16 stopped ids).
    pub command_capacity: usize,
    /// Capacity of the notification ring, notifications.
    pub notification_capacity: usize,
    /// Capacity of the ring that carries finished voices' buffers back for freeing, buffers.
    pub garbage_capacity: usize,
}

impl EngineConfig {
    /// The design's sizes (1024 waiting, 64 sounding) for an engine at `engine_rate` Hz.
    pub fn new(engine_rate: u32) -> Self {
        EngineConfig {
            engine_rate,
            max_pending: mixer::DEFAULT_MAX_PENDING,
            max_sounding: mixer::DEFAULT_MAX_SOUNDING,
            command_capacity: 2048,
            notification_capacity: 4096,
            garbage_capacity: 2048,
        }
    }
}

/// Ids carried by one stop command.
const STOP_IDS: usize = 16;
/// Most commands taken in one render callback (bounds the work of a callback; quoted in the docs of `render`).
const MAX_COMMANDS_PER_RENDER: usize = 512;
/// Seconds of bucket points the handle keeps for the clock-rate check (one point per 100 ms).
const RATE_CHECK_POINTS: usize = 64;

/// Control messages, handle to engine. Crate-private: the capture work adds its own variants here.
enum Command {
    Schedule(Voice),
    Stop { ids: [u32; STOP_IDS], n: u8, fade_frames: f64 },
    Cancel { group: Group, fade_frames: f64 },
    OutputRestarted,
}

/// What the engine tells the non-realtime side, in order.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Notification {
    /// The voice will make no more sound (ran out, reached `stop_at`, faded out, or was stopped or cancelled
    /// before it started). Sent once per voice that was accepted.
    Ended {
        /// The voice's id.
        id: u32,
    },
    /// The voice's start was already behind the render head when the audio thread took it; it started at once
    /// from its given offset.
    Late {
        /// The voice's id.
        id: u32,
        /// How far behind the head the requested start was, engine frames.
        late_frames: u64,
    },
    /// The voice was dropped without sounding because a capacity was exhausted. No `Ended` follows.
    Rejected {
        /// The voice's id.
        id: u32,
        /// Which capacity.
        reason: RejectReason,
    },
    /// Frames of one render callback had to be limited to ±1.
    Clipped {
        /// Number of limited frames in the callback.
        frames: u32,
        /// Engine frame of the callback's first frame.
        at_frame: u64,
    },
    /// The output clock was refitted (every 250 ms). The `clock` event of the design.
    Clock(ClockAnchor),
}

impl From<VoiceEvent> for Notification {
    fn from(e: VoiceEvent) -> Self {
        match e {
            VoiceEvent::Ended { id } => Notification::Ended { id },
            VoiceEvent::Late { id, late_frames } => Notification::Late { id, late_frames },
            VoiceEvent::Rejected { id, reason } => Notification::Rejected { id, reason },
        }
    }
}

/// Engine to handle. `Point` feeds the handle's clock-rate check and is not shown to the caller.
enum Out {
    Note(Notification),
    Point(ClockPoint),
}

/// State both halves read and write without locks.
#[derive(Debug, Default)]
struct Shared {
    engine_rate: u32,
    frames_rendered: AtomicU64,
    callbacks: AtomicU64,
    clipped_frames: AtomicU64,
    late_voices: AtomicU64,
    rejected_voices: AtomicU64,
    notifications_dropped: AtomicU64,
    input_frames: AtomicU64,
    /// Sequence lock over the three anchor words: odd while the render thread is writing; 0 = no anchor yet.
    anchor_seq: AtomicU64,
    anchor_engine_sec: AtomicU64,
    anchor_host_ms: AtomicU64,
    anchor_rate: AtomicU64,
}

impl Shared {
    /// Render thread only. Wait-free: five atomic stores.
    fn publish_anchor(&self, a: ClockAnchor) {
        let seq = self.anchor_seq.load(Ordering::Relaxed);
        self.anchor_seq.store(seq + 1, Ordering::SeqCst);
        self.anchor_engine_sec.store(a.engine_sec.to_bits(), Ordering::SeqCst);
        self.anchor_host_ms.store(a.host_ms.to_bits(), Ordering::SeqCst);
        self.anchor_rate.store(a.rate.to_bits(), Ordering::SeqCst);
        self.anchor_seq.store(seq + 2, Ordering::SeqCst);
    }

    /// Any thread. One attempt: `Err` when a write was in progress, `Ok(None)` before the first anchor.
    fn try_anchor(&self) -> Result<Option<ClockAnchor>, ()> {
        let s1 = self.anchor_seq.load(Ordering::SeqCst);
        if s1 == 0 {
            return Ok(None);
        }
        if s1 % 2 == 1 {
            return Err(());
        }
        let a = ClockAnchor {
            engine_sec: f64::from_bits(self.anchor_engine_sec.load(Ordering::SeqCst)),
            host_ms: f64::from_bits(self.anchor_host_ms.load(Ordering::SeqCst)),
            rate: f64::from_bits(self.anchor_rate.load(Ordering::SeqCst)),
        };
        if self.anchor_seq.load(Ordering::SeqCst) == s1 {
            Ok(Some(a))
        } else {
            Err(())
        }
    }
}

/// A cheap, cloneable, thread-safe view of the engine clock. Lock-free; usable from any thread, including a
/// Tauri command handler that must not wait for the handle.
#[derive(Debug, Clone)]
pub struct ClockReader {
    shared: Arc<Shared>,
}

impl ClockReader {
    /// Engine rate, Hz.
    pub fn engine_rate(&self) -> u32 {
        self.shared.engine_rate
    }

    /// The latest anchor of the output clock; `None` until the first render callback. Engine time at a host
    /// time is [`ClockAnchor::engine_sec_at`]. The writer holds the sequence lock for a few nanoseconds, so the
    /// retry loop ends at once in practice.
    pub fn anchor(&self) -> Option<ClockAnchor> {
        loop {
            if let Ok(a) = self.shared.try_anchor() {
                return a;
            }
            std::hint::spin_loop();
        }
    }

    /// Like [`ClockReader::anchor`] with at most `tries` attempts and no waiting, for realtime callers.
    /// `Err(())` when every attempt met a write in progress (keep using the previous anchor).
    #[allow(clippy::result_unit_err)]
    pub fn anchor_bounded(&self, tries: u32) -> Result<Option<ClockAnchor>, ()> {
        for _ in 0..tries {
            if let Ok(a) = self.shared.try_anchor() {
                return Ok(a);
            }
        }
        Err(())
    }

    /// Engine frames rendered so far: the render head as of the end of the last output callback, frames.
    pub fn frames_rendered(&self) -> u64 {
        self.shared.frames_rendered.load(Ordering::Relaxed)
    }
}

/// Counters since the engine was created.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct EngineStats {
    /// Engine frames rendered.
    pub frames_rendered: u64,
    /// Output callbacks run.
    pub callbacks: u64,
    /// Output frames limited to ±1.
    pub clipped_frames: u64,
    /// Voices that arrived behind the render head.
    pub late_voices: u64,
    /// Voices dropped for lack of capacity.
    pub rejected_voices: u64,
    /// Notifications lost because the handle did not poll (the ring was full).
    pub notifications_dropped: u64,
    /// Input frames seen by the capture half.
    pub input_frames: u64,
}

/// Pushes voice events into the notification ring. Realtime: a ring push and atomic adds.
struct RingSink<'a> {
    out: &'a mut Producer<Out>,
    shared: &'a Shared,
}

impl RingSink<'_> {
    fn send(&mut self, o: Out) {
        if self.out.push(o).is_err() {
            self.shared.notifications_dropped.fetch_add(1, Ordering::Relaxed);
        }
    }
}

impl EventSink for RingSink<'_> {
    fn voice_event(&mut self, event: VoiceEvent) {
        match event {
            VoiceEvent::Late { .. } => {
                self.shared.late_voices.fetch_add(1, Ordering::Relaxed);
            }
            VoiceEvent::Rejected { .. } => {
                self.shared.rejected_voices.fetch_add(1, Ordering::Relaxed);
            }
            VoiceEvent::Ended { .. } => {}
        }
        self.send(Out::Note(event.into()));
    }
}

/// The realtime half. Owned by the device layer; `Send`, so it can be moved into the output callback.
pub struct Engine {
    scheduler: Scheduler,
    bridge: ClockBridge,
    commands: Consumer<Command>,
    out: Producer<Out>,
    garbage: Producer<AudioBuffer>,
    shared: Arc<Shared>,
    /// The capture half, until [`Engine::split_capture`] takes it.
    capture: Option<CaptureHalf>,
}

impl fmt::Debug for Engine {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Engine").field("head", &self.scheduler.head()).field("rate", &self.shared.engine_rate).finish_non_exhaustive()
    }
}

/// Creates an engine and its handle. Allocates everything either half will need on the audio path.
pub fn engine(config: EngineConfig) -> (Engine, EngineHandle) {
    let (cmd_tx, cmd_rx) = RingBuffer::new(config.command_capacity.max(1));
    let (out_tx, out_rx) = RingBuffer::new(config.notification_capacity.max(1));
    let (garbage_tx, garbage_rx) = RingBuffer::new(config.garbage_capacity.max(1));
    let shared = Arc::new(Shared { engine_rate: config.engine_rate, ..Shared::default() });
    let reader = ClockReader { shared: Arc::clone(&shared) };
    let engine = Engine {
        scheduler: Scheduler::new(config.engine_rate, config.max_pending, config.max_sounding),
        bridge: ClockBridge::new(config.engine_rate),
        commands: cmd_rx,
        out: out_tx,
        garbage: garbage_tx,
        shared: Arc::clone(&shared),
        capture: Some(CaptureHalf::new(reader)),
    };
    let handle = EngineHandle {
        engine_rate: config.engine_rate,
        commands: cmd_tx,
        out: out_rx,
        garbage: garbage_rx,
        shared,
        store: BufferStore::new(),
        rate_check: RateCheck::new(config.engine_rate, RATE_CHECK_POINTS),
    };
    (engine, handle)
}

impl Engine {
    /// Engine rate, Hz.
    pub fn engine_rate(&self) -> u32 {
        self.shared.engine_rate
    }

    /// Engine frame of the next frame [`Engine::render`] will write.
    pub fn head(&self) -> u64 {
        self.scheduler.head()
    }

    /// The output callback. Fills the interleaved `out` (`out.len() / channels` frames, every channel carrying
    /// the mono mix, limited to ±1). `host_ns` is the callback's reading of the process-wide monotonic clock,
    /// taken as its first statement.
    ///
    /// Realtime safety, path by path:
    /// * Commands: at most 512 ring pops (lock-free). A command is a plain value; a
    ///   voice in it was built and validated on the other side. A voice is only taken while the scheduler can
    ///   also hold its buffer after it ends, so nothing is ever freed here.
    /// * Clock: one observation, constant work; every 250 ms a refit over at most 40 points in fixed arrays,
    ///   and five atomic stores to publish the anchor.
    /// * Mix: see [`Scheduler::render`]; fixed-capacity lists, no allocation, bounded by the voice capacities.
    /// * Out: ring pushes of plain values; when the ring is full the notification is counted and dropped.
    ///   Buffers of ended voices are moved into the garbage ring; when that is full they stay where they are.
    ///
    /// No allocation, no lock, no system call, no unbounded loop (`tests/rt_alloc.rs` counts allocator calls).
    pub fn render(&mut self, host_ns: u64, out: &mut [f32], channels: usize) {
        let mut sink = RingSink { out: &mut self.out, shared: &self.shared };

        for _ in 0..MAX_COMMANDS_PER_RENDER {
            if matches!(self.commands.peek(), Ok(Command::Schedule(_))) && !self.scheduler.has_room() {
                break; // wait until the handle has collected garbage
            }
            match self.commands.pop() {
                Ok(Command::Schedule(voice)) => {
                    // `has_room` was checked, so the voice is always taken; a returned voice would be
                    // dropped here, which the check above rules out.
                    let _ = self.scheduler.add(voice, &mut sink);
                }
                Ok(Command::Stop { ids, n, fade_frames }) => {
                    for id in &ids[..n as usize] {
                        self.scheduler.stop_voice(*id, fade_frames, &mut sink);
                    }
                }
                Ok(Command::Cancel { group, fade_frames }) => self.scheduler.cancel_group(group, fade_frames, &mut sink),
                Ok(Command::OutputRestarted) => {
                    // Engine time continues from R(h): it jumps forward over the gap and never goes back.
                    if let Some(head) = self.bridge.render_head_at(host_ns) {
                        if head.is_finite() && head > 0.0 {
                            self.scheduler.skip_to(head.round() as u64);
                        }
                    }
                    self.bridge.reset_output();
                }
                Err(_) => break,
            }
        }

        let start = self.scheduler.head();
        let update = self.bridge.observe_output(host_ns, start);
        if let Some(point) = update.closed {
            sink.send(Out::Point(point));
        }
        if update.refit {
            if let Some(anchor) = self.bridge.anchor_at(host_ns) {
                self.shared.publish_anchor(anchor);
                sink.send(Out::Note(Notification::Clock(anchor)));
            }
        }

        let clipped = self.scheduler.render(out, channels, &mut sink);
        if clipped > 0 {
            self.shared.clipped_frames.fetch_add(clipped as u64, Ordering::Relaxed);
            sink.send(Out::Note(Notification::Clipped { frames: clipped, at_frame: start }));
        }

        let garbage = &mut self.garbage;
        self.scheduler.drain_dead(|buffer| {
            garbage.push(buffer).map_err(|rtrb::PushError::Full(buffer)| buffer)
        });

        self.shared.frames_rendered.store(self.scheduler.head(), Ordering::Relaxed);
        self.shared.callbacks.fetch_add(1, Ordering::Relaxed);
    }

    /// The input callback, for device layers whose input and output callbacks run on one thread (a duplex
    /// unit, the fake device). `input` is interleaved with `channels` channels at the input stream's rate;
    /// `host_ns` as in [`Engine::render`]. Does nothing after [`Engine::split_capture`].
    pub fn capture(&mut self, host_ns: u64, input: &[f32], channels: usize) {
        if let Some(c) = &mut self.capture {
            c.capture(host_ns, input, channels);
        }
    }

    /// Takes the capture half out, for device layers whose input callback runs on its own thread (two cpal
    /// streams). `None` the second time.
    pub fn split_capture(&mut self) -> Option<CaptureHalf> {
        self.capture.take()
    }
}

/// The capture side of the engine.
///
/// **STUB SEAM.** Only the clock observation is implemented. The capture aligner (downmix, locked and
/// resampled paths), the packetizer with its ring, and the loopback estimator's tap plug in at the marked
/// place in [`CaptureHalf::capture`], as new modules (`capture`, `resample`, `loopback`), without changes to
/// the render half: this half already has what they need from it, the output clock through a lock-free
/// [`ClockReader`].
#[derive(Debug)]
pub struct CaptureHalf {
    clock: ClockReader,
    /// `A(m)`: the input stream's clock. Created on the first callback at the engine rate; the device layer
    /// sets the real rate with [`CaptureHalf::set_input_rate`].
    input_clock: StreamClock,
    /// Input frames delivered so far, frames at the input rate.
    frames: u64,
    /// The last output anchor read (kept when a read meets a write in progress).
    anchor: Option<ClockAnchor>,
}

impl CaptureHalf {
    fn new(clock: ClockReader) -> Self {
        let rate = clock.engine_rate() as f64;
        CaptureHalf { clock, input_clock: StreamClock::new(rate), frames: 0, anchor: None }
    }

    /// Declares the input stream's nominal rate, Hz, and restarts its clock. Call before the stream starts
    /// (not from the callback).
    pub fn set_input_rate(&mut self, input_rate: u32) {
        self.input_clock = StreamClock::new(input_rate as f64);
        self.frames = 0;
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

    /// The input callback. Realtime: one clock observation (constant work, bounded refit), a bounded
    /// lock-free read of the output anchor, two atomic stores. No allocation, lock or system call.
    pub fn capture(&mut self, host_ns: u64, input: &[f32], channels: usize) {
        if channels == 0 {
            return;
        }
        self.frames += (input.len() / channels) as u64;
        self.input_clock.observe(host_ns, self.frames);
        if let Ok(a) = self.clock.anchor_bounded(4) {
            self.anchor = a;
        }
        self.clock.shared.input_frames.store(self.frames, Ordering::Relaxed);
        // ---- CAPTURE SEAM (next task) -------------------------------------------------------------------
        // Here: downmix `input` to mono; CaptureAligner (locked: pass through with an integer offset fixed at
        // capture start; resampled: SincResampler steered by DriftController) using `self.input_clock` and
        // `self.anchor`; Packetizer into the capture ring with `wire::encode_packet_into`; tap for the
        // LoopbackEstimator. Capture start and stop arrive as commands on a ring of this half's own.
        // -------------------------------------------------------------------------------------------------
    }
}

/// Why a control call did nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ControlError {
    /// A voice names a buffer id that is not in the store.
    UnknownBuffer {
        /// The voice's id.
        voice: u32,
        /// The missing buffer id.
        buffer: u32,
    },
    /// A voice's fields are invalid.
    BadSpec {
        /// The voice's id.
        voice: u32,
        /// What is wrong.
        error: SpecError,
    },
    /// The command ring has too little room for the whole call (the audio thread is not running, or far
    /// more is being scheduled than the engine was sized for). Nothing was sent.
    QueueFull,
    /// The engine has been dropped.
    EngineGone,
}

impl fmt::Display for ControlError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ControlError::UnknownBuffer { voice, buffer } => write!(f, "voice {voice}: no buffer {buffer}"),
            ControlError::BadSpec { voice, error } => write!(f, "voice {voice}: {error}"),
            ControlError::QueueFull => f.write_str("the engine's command queue is full"),
            ControlError::EngineGone => f.write_str("the engine is closed"),
        }
    }
}

impl std::error::Error for ControlError {}

/// Result of [`EngineHandle::schedule`].
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ScheduleOutcome {
    /// Ids of voices whose start frame was already behind the render head when the call was made; they start
    /// at once. A voice that only falls behind in the few milliseconds before the audio thread takes it is
    /// not listed here; it is reported by [`Notification::Late`], which is the authoritative record.
    pub late: Vec<u32>,
}

/// The non-realtime half: the API the Tauri layer and a fake device drive. Not shared between threads (wrap it
/// in the app's state mutex); for clock reads without that mutex, clone a [`ClockReader`].
///
/// Every method returns at once. Methods that send to the audio thread take effect at its next callback.
/// [`EngineHandle::poll`] must be called regularly (the pump thread, about every 10 ms): it is what frees
/// the buffers of ended voices and feeds the clock-rate check.
pub struct EngineHandle {
    engine_rate: u32,
    commands: Producer<Command>,
    out: Consumer<Out>,
    garbage: Consumer<AudioBuffer>,
    shared: Arc<Shared>,
    store: BufferStore,
    rate_check: RateCheck,
}

impl fmt::Debug for EngineHandle {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("EngineHandle").field("rate", &self.engine_rate).field("buffers", &self.store.len()).finish_non_exhaustive()
    }
}

impl EngineHandle {
    /// Engine rate, Hz.
    pub fn engine_rate(&self) -> u32 {
        self.engine_rate
    }

    /// Stores a buffer under `id` (`audio_put_buffer`, and the PCM of `audio_decode`), replacing any buffer
    /// with that id. Voices already scheduled keep the buffer they were scheduled with.
    pub fn put_buffer(&mut self, id: u32, buffer: AudioBuffer) {
        // A replaced buffer may be freed right here: this is not the audio thread.
        self.store.put(id, buffer);
    }

    /// The stored buffers.
    pub fn buffers(&self) -> &BufferStore {
        &self.store
    }

    /// Removes buffers from the store (`audio_drop_buffers`); returns how many existed. Voices already
    /// scheduled with them play on; the memory is freed by a later [`EngineHandle::poll`], never on the audio
    /// thread.
    pub fn drop_buffers(&mut self, ids: &[u32]) -> usize {
        ids.iter().filter(|id| self.store.remove(**id).is_some()).count()
    }

    /// Schedules voices in `group` (`audio_schedule`). All or nothing: on an error no voice is scheduled.
    /// Each voice's first sample is written to output frame `round(t * engineRate)`.
    pub fn schedule(&mut self, group: Group, specs: &[VoiceSpec]) -> Result<ScheduleOutcome, ControlError> {
        let rate = self.engine_rate as f64;
        let mut voices = Vec::with_capacity(specs.len());
        for spec in specs {
            let buffer = self.store.get(spec.buffer).ok_or(ControlError::UnknownBuffer { voice: spec.id, buffer: spec.buffer })?;
            voices.push(Voice::new(spec, group, buffer.clone(), rate).map_err(|error| ControlError::BadSpec { voice: spec.id, error })?);
        }
        self.reserve(voices.len())?;
        let head = self.shared.frames_rendered.load(Ordering::Relaxed);
        let late = voices.iter().filter(|v| v.start_frame() < head).map(Voice::id).collect();
        for voice in voices {
            self.send(Command::Schedule(voice));
        }
        Ok(ScheduleOutcome { late })
    }

    /// Stops voices by id (`audio_stop_voices`): a voice that has not started is removed, a sounding one
    /// fades linearly to silence over `fade_sec` seconds (0 = cut). Unknown ids are ignored.
    pub fn stop_voices(&mut self, ids: &[u32], fade_sec: f64) -> Result<(), ControlError> {
        self.reserve(ids.len().div_ceil(STOP_IDS))?;
        let fade_frames = self.fade_frames(fade_sec);
        for chunk in ids.chunks(STOP_IDS) {
            let mut packed = [0u32; STOP_IDS];
            packed[..chunk.len()].copy_from_slice(chunk);
            self.send(Command::Stop { ids: packed, n: chunk.len() as u8, fade_frames });
        }
        Ok(())
    }

    /// Stops every voice of `group` (`audio_cancel`), as [`EngineHandle::stop_voices`] does. The other group is
    /// untouched.
    pub fn cancel(&mut self, group: Group, fade_sec: f64) -> Result<(), ControlError> {
        self.reserve(1)?;
        let fade_frames = self.fade_frames(fade_sec);
        self.send(Command::Cancel { group, fade_frames });
        Ok(())
    }

    /// Tells the engine that the output stream was restarted (device change, interruption). At the next
    /// callback engine time jumps forward over the gap, as the old clock fit predicts, and the fit starts
    /// again. Time has passed for the voices too: one that lay wholly inside the gap ends without sounding, a
    /// longer one carries on from where it would have been.
    pub fn output_restarted(&mut self) -> Result<(), ControlError> {
        self.reserve(1)?;
        self.send(Command::OutputRestarted);
        self.rate_check.clear();
        Ok(())
    }

    fn fade_frames(&self, fade_sec: f64) -> f64 {
        if fade_sec.is_finite() && fade_sec > 0.0 {
            fade_sec * self.engine_rate as f64
        } else {
            0.0
        }
    }

    fn reserve(&mut self, n: usize) -> Result<(), ControlError> {
        if self.commands.is_abandoned() {
            Err(ControlError::EngineGone)
        } else if self.commands.slots() < n {
            Err(ControlError::QueueFull)
        } else {
            Ok(())
        }
    }

    fn send(&mut self, command: Command) {
        // `reserve` saw enough free slots and only this side fills them. Should the push fail all the same,
        // the command (and a voice's buffer in it) is dropped here, on the non-realtime side.
        let _ = self.commands.push(command);
    }

    /// Moves pending notifications into `out`, in order, and returns how many. Also frees the buffers of
    /// ended voices and feeds the clock-rate check.
    pub fn poll(&mut self, out: &mut Vec<Notification>) -> usize {
        self.collect_garbage();
        let mut n = 0;
        while let Ok(o) = self.out.pop() {
            match o {
                Out::Note(note) => {
                    out.push(note);
                    n += 1;
                }
                Out::Point(point) => self.rate_check.push(point),
            }
        }
        n
    }

    /// Frees the buffers that ended voices handed back; returns how many references were released.
    pub fn collect_garbage(&mut self) -> usize {
        let mut n = 0;
        while let Ok(buffer) = self.garbage.pop() {
            drop(buffer);
            n += 1;
        }
        n
    }

    /// A thread-safe view of the clock, for callers that must not wait for this handle.
    pub fn clock(&self) -> ClockReader {
        ClockReader { shared: Arc::clone(&self.shared) }
    }

    /// The latest anchor of the output clock (`audio_clock_sync` is this evaluated at the caller's own
    /// reading of the host clock); `None` until the first render callback.
    pub fn anchor(&self) -> Option<ClockAnchor> {
        self.clock().anchor()
    }

    /// The running clock-rate check over the last `dur_sec` seconds (`audio_clock_check`), from the points
    /// that [`EngineHandle::poll`] has collected. Not consistent until that much time has been polled.
    pub fn rate_check(&self, dur_sec: f64) -> RateCheckReport {
        self.rate_check.check(dur_sec)
    }

    /// Counters since the engine was created.
    pub fn stats(&self) -> EngineStats {
        let s = &self.shared;
        EngineStats {
            frames_rendered: s.frames_rendered.load(Ordering::Relaxed),
            callbacks: s.callbacks.load(Ordering::Relaxed),
            clipped_frames: s.clipped_frames.load(Ordering::Relaxed),
            late_voices: s.late_voices.load(Ordering::Relaxed),
            rejected_voices: s.rejected_voices.load(Ordering::Relaxed),
            notifications_dropped: s.notifications_dropped.load(Ordering::Relaxed),
            input_frames: s.input_frames.load(Ordering::Relaxed),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    const RATE: u32 = 48_000;
    const HOST0: u64 = 77_000_000_000;

    /// Runs `callbacks` output callbacks of `quantum` frames on an ideal host clock, returning channel 0.
    fn run(engine: &mut Engine, callbacks: usize, quantum: usize) -> Vec<f32> {
        let mut out = Vec::new();
        let mut buf = vec![0f32; quantum * 2];
        for _ in 0..callbacks {
            let host_ns = HOST0 + engine.head() * 1_000_000_000 / RATE as u64;
            engine.render(host_ns, &mut buf, 2);
            out.extend(buf.chunks_exact(2).map(|f| f[0]));
        }
        out
    }

    fn poll(handle: &mut EngineHandle) -> Vec<Notification> {
        let mut v = Vec::new();
        handle.poll(&mut v);
        v
    }

    #[test]
    fn engine_schedules_through_the_rings() {
        let (mut engine, mut handle) = engine(EngineConfig::new(RATE));
        let samples: Arc<[f32]> = (0..480).map(|i| 0.5 - i as f32 / 960.0).collect();
        handle.put_buffer(7, AudioBuffer { samples: Arc::clone(&samples), sample_rate: RATE });
        assert_eq!(handle.anchor(), None);

        let outcome = handle.schedule(Group::Take, &[VoiceSpec::new(1, 7, 0.1), VoiceSpec::new(2, 7, 0.25)]).unwrap();
        assert!(outcome.late.is_empty());
        let out = run(&mut engine, 100, 128);
        assert_eq!(&out[4800..5280], &samples[..]);
        assert_eq!(&out[12_000..12_480], &samples[..]);
        assert!(out[..4800].iter().chain(&out[5280..12_000]).chain(&out[12_480..]).all(|x| *x == 0.0));
        let notes = poll(&mut handle);
        assert_eq!(notes.iter().filter(|n| matches!(n, Notification::Ended { .. })).collect::<Vec<_>>(), [&Notification::Ended { id: 1 }, &Notification::Ended { id: 2 }]);
        // 12 800 frames = 267 ms: the first callback and one refit 250 ms later.
        let anchors: Vec<ClockAnchor> = notes.iter().filter_map(|n| if let Notification::Clock(a) = n { Some(*a) } else { None }).collect();
        assert_eq!(anchors.len(), 2);
        assert_eq!(handle.anchor(), anchors.last().copied());
        let a = handle.clock().anchor().unwrap();
        assert!((a.engine_sec_at(HOST0 as f64 / 1e6 + 1000.0) - 1.0).abs() < 1e-9 && a.rate == 1.0);

        // A voice behind the head: predicted late by the handle, confirmed by the audio thread.
        let late = handle.schedule(Group::Sounds, &[VoiceSpec::new(3, 7, 0.2), VoiceSpec::new(4, 7, 5.0)]).unwrap();
        assert_eq!(late.late, vec![3]);
        let out = run(&mut engine, 4, 128);
        assert_eq!(&out[..480], &samples[..]);
        let notes = poll(&mut handle);
        assert!(notes.contains(&Notification::Late { id: 3, late_frames: 12_800 - 9600 }));
        assert!(notes.contains(&Notification::Ended { id: 3 }));

        // Cancel by group, stop by id.
        handle.schedule(Group::Take, &[VoiceSpec::new(5, 7, 5.0)]).unwrap();
        handle.cancel(Group::Sounds, 0.0).unwrap();
        run(&mut engine, 1, 128);
        assert_eq!(poll(&mut handle), vec![Notification::Ended { id: 4 }]);
        handle.stop_voices(&(0..40).collect::<Vec<u32>>(), 0.01).unwrap();
        run(&mut engine, 1, 128);
        assert_eq!(poll(&mut handle), vec![Notification::Ended { id: 5 }]);

        let stats = handle.stats();
        assert_eq!((stats.frames_rendered, stats.callbacks, stats.late_voices, stats.clipped_frames, stats.notifications_dropped), (13_568, 106, 1, 0, 0));
    }

    #[test]
    fn engine_reports_errors_and_clipping() {
        let (mut engine, mut handle) = engine(EngineConfig { command_capacity: 4, ..EngineConfig::new(RATE) });
        handle.put_buffer(1, AudioBuffer::new(vec![0.9f32; 256], RATE));
        assert_eq!(handle.schedule(Group::Take, &[VoiceSpec::new(9, 2, 0.0)]), Err(ControlError::UnknownBuffer { voice: 9, buffer: 2 }));
        let bad = VoiceSpec { rate: -1.0, ..VoiceSpec::new(8, 1, 0.0) };
        assert_eq!(handle.schedule(Group::Take, &[VoiceSpec::new(7, 1, 0.0), bad]), Err(ControlError::BadSpec { voice: 8, error: SpecError::BadRate }));
        let five: Vec<VoiceSpec> = (0..5).map(|i| VoiceSpec::new(i, 1, 0.0)).collect();
        assert_eq!(handle.schedule(Group::Take, &five), Err(ControlError::QueueFull));
        run(&mut engine, 1, 128);
        assert!(poll(&mut handle).iter().all(|n| matches!(n, Notification::Clock(_))), "a failed call schedules nothing");

        handle.schedule(Group::Take, &five[..2]).unwrap();
        let out = run(&mut engine, 3, 128);
        // Scheduled for t = 0 with the head at 128: both start at once, 2 x 0.9 for their 256 frames.
        assert!(out[..256].iter().all(|x| *x == 1.0) && out[256..].iter().all(|x| *x == 0.0));
        let notes = poll(&mut handle);
        assert!(notes.contains(&Notification::Clipped { frames: 128, at_frame: 128 }) && notes.contains(&Notification::Clipped { frames: 128, at_frame: 256 }));
        assert_eq!(handle.stats().clipped_frames, 256);

        drop(engine);
        assert_eq!(handle.cancel(Group::Take, 0.0), Err(ControlError::EngineGone));
    }

    #[test]
    fn buffers_are_freed_by_the_handle_not_the_engine() {
        let (mut engine, mut handle) = engine(EngineConfig::new(RATE));
        let samples: Arc<[f32]> = vec![0.25f32; 4800].into();
        handle.put_buffer(1, AudioBuffer { samples: Arc::clone(&samples), sample_rate: RATE });
        assert_eq!(Arc::strong_count(&samples), 2);
        handle.schedule(Group::Sounds, &[VoiceSpec::new(1, 1, 0.01), VoiceSpec::new(2, 1, 0.02)]).unwrap();
        assert_eq!(Arc::strong_count(&samples), 4);
        // Dropping the stored buffer does not cut the voices.
        assert_eq!(handle.drop_buffers(&[1, 99]), 1);
        assert!(handle.buffers().is_empty());
        let out = run(&mut engine, 60, 128);
        assert_eq!(out.iter().filter(|x| **x != 0.0).count(), 4800 + 480);
        // Both voices have ended; the engine still has not released their references.
        assert_eq!(Arc::strong_count(&samples), 3);
        assert_eq!(handle.collect_garbage(), 2);
        assert_eq!(Arc::strong_count(&samples), 1);
    }

    #[test]
    fn output_restart_moves_engine_time_forward() {
        let (mut engine, mut handle) = engine(EngineConfig::new(RATE));
        handle.put_buffer(1, AudioBuffer::new(vec![0.5f32; 64], RATE));
        run(&mut engine, 375, 128); // 1 s
        assert_eq!(engine.head(), 48_000);
        handle.schedule(Group::Sounds, &[VoiceSpec::new(1, 1, 1.2), VoiceSpec::new(2, 1, 2.0)]).unwrap();
        handle.output_restarted().unwrap();
        // The device comes back 0.5 s of host time later than the frame counter says.
        let mut buf = vec![0f32; 256];
        engine.render(HOST0 + 1_500_000_000, &mut buf, 2);
        assert_eq!(engine.head(), 72_000 + 128);
        assert!(buf.iter().all(|x| *x == 0.0), "the voice that lay inside the gap is over");
        let notes = poll(&mut handle);
        assert!(notes.contains(&Notification::Ended { id: 1 }) && !notes.iter().any(|n| matches!(n, Notification::Late { .. })));
        let a = handle.anchor().unwrap();
        assert!((a.engine_sec - 1.5).abs() < 1e-9);
        // The other voice still starts on its frame of the continued clock.
        let mut heard_at = None;
        for _ in 0..200 {
            let head = engine.head();
            engine.render(HOST0 + head * 1_000_000_000 / RATE as u64, &mut buf, 2);
            if let Some(i) = buf.chunks_exact(2).position(|f| f[0] != 0.0) {
                heard_at.get_or_insert(head + i as u64);
            }
        }
        assert_eq!(heard_at, Some(96_000));
    }

    #[test]
    fn capture_seam_observes_the_input_clock() {
        let (mut engine, handle) = engine(EngineConfig::new(RATE));
        let input = vec![0f32; 256];
        let mut buf = vec![0f32; 256];
        engine.render(HOST0, &mut buf, 2);
        engine.capture(HOST0 + 1_000_000, &input, 2);
        assert_eq!(handle.stats().input_frames, 128);
        // Split for a two-thread device layer: the half keeps its state and still sees the output clock.
        let mut half = engine.split_capture().expect("first split");
        assert!(engine.split_capture().is_none());
        engine.capture(HOST0 + 2_000_000, &input, 2); // no-op now
        half.capture(HOST0 + 3_666_667, &input, 2);
        assert_eq!((half.frames(), handle.stats().input_frames), (256, 256));
        assert_eq!(half.output_anchor(), handle.anchor());
        assert!(half.input_clock().frames_at(HOST0 + 1_000_000).is_some());
        fn assert_send<T: Send>(_: &T) {}
        assert_send(&engine);
        assert_send(&half);
        assert_send(&handle);
    }
}
