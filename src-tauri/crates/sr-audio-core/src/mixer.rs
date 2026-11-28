//! Sample-accurate buffer voices (design sections 1 and 3).
//!
//! One primitive: a mono buffer started at an engine frame, with a playback rate (4-point cubic interpolation),
//! optional loop points, a linear gain envelope in engine time, a stop frame and a stop-with-fade.
//!
//! Split between the two sides:
//!
//! * Non-realtime: [`BufferStore`] (id to PCM), [`VoiceSpec`] (what the caller asks for) and [`Voice::new`], which
//!   validates a spec and resolves it into frames. All allocation and all failure happen here.
//! * Realtime: [`Scheduler`]. It holds resolved [`Voice`]s in vectors whose capacity is reserved up front and never
//!   grows, and it never drops a buffer: a finished voice's buffer goes to an internal list that the owner drains
//!   to another thread ([`Scheduler::drain_dead`]).
//!
//! Determinism: the output at engine frame `n` is a pure function of `n` and of the voices admitted (position,
//! envelope and fade are computed from `n`, never accumulated), and voices are summed in a fixed order (start
//! frame, then arrival). So the size of the render callbacks never changes a sample.

use std::collections::HashMap;
use std::fmt;
use std::sync::Arc;

/// Most points an [`Envelope`] can hold.
pub const MAX_ENV_POINTS: usize = 8;
/// Default capacity for voices waiting for their start frame.
pub const DEFAULT_MAX_PENDING: usize = 1024;
/// Default capacity for voices that are sounding.
pub const DEFAULT_MAX_SOUNDING: usize = 64;
/// Spare places in the dead-buffer list beyond one per voice, see [`Scheduler::has_room`].
const DEAD_SLACK: usize = 64;

/// Mono PCM and its sample rate. Cloning shares the samples.
#[derive(Debug, Clone, PartialEq)]
pub struct AudioBuffer {
    /// Mono samples, full scale ±1.
    pub samples: Arc<[f32]>,
    /// Sample rate of `samples`, Hz.
    pub sample_rate: u32,
}

impl AudioBuffer {
    /// Wraps samples at `sample_rate` Hz.
    pub fn new(samples: impl Into<Arc<[f32]>>, sample_rate: u32) -> Self {
        AudioBuffer { samples: samples.into(), sample_rate }
    }

    /// Length, seconds of buffer time.
    pub fn duration_sec(&self) -> f64 {
        self.samples.len() as f64 / self.sample_rate as f64
    }
}

/// Buffers by id, on the non-realtime side. The audio thread never sees this type: a scheduled voice carries its
/// own reference to the samples, so removing a buffer here never cuts a sounding voice, and the memory is freed
/// off the audio thread once the last voice using it has ended.
#[derive(Debug, Default)]
pub struct BufferStore {
    map: HashMap<u32, AudioBuffer>,
}

impl BufferStore {
    /// An empty store.
    pub fn new() -> Self {
        Self::default()
    }

    /// Stores `buffer` under `id`, returning the buffer it replaces.
    pub fn put(&mut self, id: u32, buffer: AudioBuffer) -> Option<AudioBuffer> {
        self.map.insert(id, buffer)
    }

    /// The buffer under `id`.
    pub fn get(&self, id: u32) -> Option<&AudioBuffer> {
        self.map.get(&id)
    }

    /// Removes the buffer under `id`.
    pub fn remove(&mut self, id: u32) -> Option<AudioBuffer> {
        self.map.remove(&id)
    }

    /// Number of buffers held.
    pub fn len(&self) -> usize {
        self.map.len()
    }

    /// True when no buffer is held.
    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }

    /// Total samples held (frames, all buffers).
    pub fn total_frames(&self) -> usize {
        self.map.values().map(|b| b.samples.len()).sum()
    }
}

/// Which cancel command a voice answers to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Group {
    /// Clicks and count-in of a take. Only `cancel(Take)` removes them.
    Take,
    /// Everything else (Listen playback, calibration clicks, tones). Only `cancel(Sounds)` removes them.
    Sounds,
}

/// A voice as the caller describes it (the `VoiceSpec` of design section 3). Times are engine seconds unless the
/// field says buffer seconds.
#[derive(Debug, Clone, PartialEq)]
pub struct VoiceSpec {
    /// Chosen by the caller, unique per open. Echoed in notifications.
    pub id: u32,
    /// Buffer id in the [`BufferStore`].
    pub buffer: u32,
    /// Engine time of the first played sample, seconds. It is written to output frame `round(t * engineRate)`.
    pub t: f64,
    /// Linear gain applied before the envelope (1 = unchanged).
    pub gain: f32,
    /// Playback rate against the buffer's own sample rate (1 = original pitch).
    pub rate: f64,
    /// Start position in the buffer, buffer seconds.
    pub offset_sec: f64,
    /// Loop start and end, buffer seconds. Once the position reaches the end it wraps to the start, for ever.
    pub loop_sec: Option<(f64, f64)>,
    /// Gain envelope: `(engine seconds, value)` points joined by straight lines; the value holds before the first
    /// and after the last point; two points at the same time make a step. Empty means constant 1. At most
    /// [`MAX_ENV_POINTS`].
    pub env: Vec<(f64, f32)>,
    /// Engine time at which the voice is cut, seconds (the frame `round(stop_at * engineRate)` is not played).
    pub stop_at: Option<f64>,
}

impl VoiceSpec {
    /// A voice with gain 1, rate 1, no offset, loop, envelope or stop.
    pub fn new(id: u32, buffer: u32, t: f64) -> Self {
        VoiceSpec { id, buffer, t, gain: 1.0, rate: 1.0, offset_sec: 0.0, loop_sec: None, env: Vec::new(), stop_at: None }
    }
}

/// Why a [`VoiceSpec`] was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpecError {
    /// A number is NaN or infinite.
    NotFinite,
    /// `rate` is not above 0, or `offset_sec` is negative.
    BadRate,
    /// Loop end not at least one buffer frame after loop start, or start outside the buffer.
    BadLoop,
    /// More than [`MAX_ENV_POINTS`] points, or times that go backwards.
    BadEnvelope,
}

impl fmt::Display for SpecError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            SpecError::NotFinite => "a voice field is not a finite number",
            SpecError::BadRate => "rate must be above 0 and the offset not negative",
            SpecError::BadLoop => "loop points are not inside the buffer or are shorter than one frame",
            SpecError::BadEnvelope => "envelope has too many points or times that go backwards",
        })
    }
}

impl std::error::Error for SpecError {}

/// Linear gain segments on the engine frame axis. `Copy`, fixed size.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Envelope {
    n: u8,
    /// Point positions, engine frames (not rounded: segments are linear in engine time).
    frames: [f64; MAX_ENV_POINTS],
    /// Point values, linear gain.
    values: [f32; MAX_ENV_POINTS],
}

impl Envelope {
    /// Constant 1.
    pub const fn constant() -> Self {
        Envelope { n: 0, frames: [0.0; MAX_ENV_POINTS], values: [1.0; MAX_ENV_POINTS] }
    }

    /// From `(engine seconds, value)` points at `engine_rate` Hz.
    pub fn from_points(points: &[(f64, f32)], engine_rate: f64) -> Result<Self, SpecError> {
        if points.len() > MAX_ENV_POINTS {
            return Err(SpecError::BadEnvelope);
        }
        let mut e = Envelope::constant();
        for (i, &(t, v)) in points.iter().enumerate() {
            if !t.is_finite() || !v.is_finite() {
                return Err(SpecError::NotFinite);
            }
            if i > 0 && t < points[i - 1].0 {
                return Err(SpecError::BadEnvelope);
            }
            e.frames[i] = t * engine_rate;
            e.values[i] = v;
        }
        e.n = points.len() as u8;
        Ok(e)
    }

    /// Number of points.
    pub fn len(&self) -> usize {
        self.n as usize
    }

    /// True for the constant-1 envelope.
    pub fn is_empty(&self) -> bool {
        self.n == 0
    }

    /// Gain at engine frame `frame` (may be fractional). A pure function of `frame`. At most
    /// [`MAX_ENV_POINTS`] comparisons.
    #[inline]
    pub fn value_at(&self, frame: f64) -> f32 {
        let n = self.n as usize;
        if n == 0 {
            return 1.0;
        }
        // Last point at or before `frame`; with two points at one time the later one wins (a step).
        let mut i = usize::MAX;
        for k in 0..n {
            if self.frames[k] <= frame {
                i = k;
            } else {
                break;
            }
        }
        if i == usize::MAX {
            return self.values[0];
        }
        if i == n - 1 {
            return self.values[n - 1];
        }
        let (f0, f1) = (self.frames[i], self.frames[i + 1]);
        let (v0, v1) = (self.values[i] as f64, self.values[i + 1] as f64);
        (v0 + (v1 - v0) * ((frame - f0) / (f1 - f0))) as f32
    }
}

/// A stop in progress: gain falls linearly from 1 at `start` to 0 at `start + len`.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Fade {
    /// Engine frame at which the fade began.
    start: u64,
    /// Fade length, engine frames (may be fractional, 0 = cut).
    len: f64,
}

impl Fade {
    fn end(&self) -> u64 {
        self.start.saturating_add(self.len.ceil() as u64)
    }

    #[inline]
    fn gain_at(&self, n: u64) -> f32 {
        (1.0 - (n - self.start) as f64 / self.len).max(0.0) as f32
    }
}

/// A voice resolved into frames, ready for the audio thread. Built by [`Voice::new`] off the audio thread.
#[derive(Debug, Clone)]
pub struct Voice {
    id: u32,
    group: Group,
    buf: AudioBuffer,
    /// Engine frame of the first played sample.
    start_frame: u64,
    /// Engine frame at which the voice is cut (`u64::MAX` = never).
    stop_frame: u64,
    /// Engine frames from the start until the buffer runs out (`u64::MAX` when looping).
    natural_len: u64,
    gain: f32,
    /// Buffer frames advanced per engine frame.
    step: f64,
    /// Start position, buffer frames.
    offset: f64,
    /// Loop start and end, buffer frames.
    loop_frames: Option<(f64, f64)>,
    env: Envelope,
    fade: Option<Fade>,
    /// Arrival order, set by the scheduler; breaks ties in the summing order.
    seq: u64,
}

impl Voice {
    /// Validates `spec` and resolves it against `buffer` for an engine running at `engine_rate` Hz.
    /// Non-realtime (the envelope is copied into the fixed-size form here).
    pub fn new(spec: &VoiceSpec, group: Group, buffer: AudioBuffer, engine_rate: f64) -> Result<Voice, SpecError> {
        if !(spec.t.is_finite() && spec.gain.is_finite() && spec.rate.is_finite() && spec.offset_sec.is_finite()) {
            return Err(SpecError::NotFinite);
        }
        if spec.rate <= 0.0 || spec.offset_sec < 0.0 || buffer.sample_rate == 0 {
            return Err(SpecError::BadRate);
        }
        let buf_rate = buffer.sample_rate as f64;
        let len = buffer.samples.len() as f64;
        let step = spec.rate * buf_rate / engine_rate;
        let offset = spec.offset_sec * buf_rate;
        let loop_frames = match spec.loop_sec {
            None => None,
            Some((a, b)) => {
                if !(a.is_finite() && b.is_finite()) {
                    return Err(SpecError::NotFinite);
                }
                let (ls, le) = (a * buf_rate, (b * buf_rate).min(len));
                if ls < 0.0 || le - ls < 1.0 {
                    return Err(SpecError::BadLoop);
                }
                Some((ls, le))
            }
        };
        let natural_len = if loop_frames.is_some() {
            u64::MAX
        } else if offset >= len {
            0
        } else {
            ((len - offset) / step).ceil() as u64
        };
        let stop_frame = match spec.stop_at {
            None => u64::MAX,
            Some(s) if s.is_finite() => frame_of(s, engine_rate),
            Some(_) => return Err(SpecError::NotFinite),
        };
        Ok(Voice {
            id: spec.id,
            group,
            buf: buffer,
            start_frame: frame_of(spec.t, engine_rate),
            stop_frame,
            natural_len,
            gain: spec.gain,
            step,
            offset,
            loop_frames,
            env: Envelope::from_points(&spec.env, engine_rate)?,
            fade: None,
            seq: 0,
        })
    }

    /// The caller's id.
    pub fn id(&self) -> u32 {
        self.id
    }

    /// The voice's group.
    pub fn group(&self) -> Group {
        self.group
    }

    /// Engine frame of the first played sample.
    pub fn start_frame(&self) -> u64 {
        self.start_frame
    }

    /// First engine frame the voice no longer plays (`u64::MAX` = open-ended).
    pub fn end_frame(&self) -> u64 {
        let mut e = self.start_frame.saturating_add(self.natural_len).min(self.stop_frame);
        if let Some(f) = &self.fade {
            e = e.min(f.end());
        }
        e
    }

    /// Adds frames `a..b` of this voice into channel 0 of `out`, whose first frame is engine frame `chunk_start`.
    /// Realtime: a fixed amount of arithmetic per frame, reads only the voice and its buffer.
    #[inline]
    fn mix(&self, a: u64, b: u64, chunk_start: u64, out: &mut [f32], channels: usize) {
        let x = &self.buf.samples[..];
        for n in a..b {
            let mut pos = self.offset + (n - self.start_frame) as f64 * self.step;
            if let Some((ls, le)) = self.loop_frames {
                if pos >= le {
                    pos = ls + (pos - ls) % (le - ls);
                }
            }
            let env = self.env.value_at(n as f64);
            let fade = match &self.fade {
                Some(f) => f.gain_at(n),
                None => 1.0,
            };
            let sample = match self.loop_frames {
                // Close to the end of the buffer the taps ahead of the position fall off it; in a loop they
                // belong to the loop start. (Elsewhere the taps read the buffer as it is: just past a loop
                // end that is not the buffer's end, the recorded continuation is the better neighbour.)
                Some((ls, le)) if pos + 2.0 >= x.len() as f64 => sample_at_looped(x, pos, (le - ls).round() as i64),
                _ => sample_at(x, pos),
            };
            out[(n - chunk_start) as usize * channels] += sample * (self.gain * env * fade);
        }
    }
}

/// `round(t * rate)` as a frame number; negative times map to frame 0.
#[inline]
pub fn frame_of(t_sec: f64, rate: f64) -> u64 {
    let f = (t_sec * rate).round();
    if f > 0.0 {
        f as u64
    } else {
        0
    }
}

#[inline]
fn tap(x: &[f32], i: i64) -> f32 {
    if i < 0 {
        0.0
    } else {
        x.get(i as usize).copied().unwrap_or(0.0)
    }
}

/// The buffer's value at fractional position `pos` (buffer frames): 4-point, third-order Catmull-Rom
/// interpolation; samples outside the buffer are 0. An integer position returns the stored sample exactly, so a
/// buffer played at its own rate is bit-identical to the buffer.
#[inline]
pub fn sample_at(x: &[f32], pos: f64) -> f32 {
    let fl = pos.floor();
    let i = fl as i64;
    let fr = (pos - fl) as f32;
    if fr == 0.0 {
        return tap(x, i);
    }
    let (y0, y1, y2, y3) = (tap(x, i - 1), tap(x, i), tap(x, i + 1), tap(x, i + 2));
    let c1 = 0.5 * (y2 - y0);
    let c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
    let c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    ((c3 * fr + c2) * fr + c1) * fr + y1
}

/// As [`sample_at`] for a looping voice near the end of the buffer: a tap past the last sample reads the
/// sample `loop_len` frames earlier.
#[inline]
fn sample_at_looped(x: &[f32], pos: f64, loop_len: i64) -> f32 {
    let wrapped = |i: i64| if i >= x.len() as i64 { tap(x, i - loop_len) } else { tap(x, i) };
    let fl = pos.floor();
    let i = fl as i64;
    let fr = (pos - fl) as f32;
    if fr == 0.0 {
        return wrapped(i);
    }
    let (y0, y1, y2, y3) = (wrapped(i - 1), wrapped(i), wrapped(i + 1), wrapped(i + 2));
    let c1 = 0.5 * (y2 - y0);
    let c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
    let c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    ((c3 * fr + c2) * fr + c1) * fr + y1
}

/// Why the scheduler could not take or start a voice.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RejectReason {
    /// Too many voices waiting for their start frame.
    PendingFull,
    /// Too many voices sounding at the voice's start frame.
    SoundingFull,
}

/// What happened to a voice, reported from `render` and the stop calls.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VoiceEvent {
    /// The voice will make no more sound: its buffer ran out, it reached its stop frame, its fade finished, or it
    /// was stopped or cancelled before it started.
    Ended {
        /// The voice's id.
        id: u32,
    },
    /// The voice's start frame was already behind the render head when it arrived. It starts at once from its
    /// given offset.
    Late {
        /// The voice's id.
        id: u32,
        /// How far behind the head the requested start was, engine frames.
        late_frames: u64,
    },
    /// The voice was dropped without sounding.
    Rejected {
        /// The voice's id.
        id: u32,
        /// Which capacity was exhausted.
        reason: RejectReason,
    },
}

/// Receives [`VoiceEvent`]s. On the audio thread the implementation must not allocate, lock or block.
pub trait EventSink {
    /// One event.
    fn voice_event(&mut self, event: VoiceEvent);
}

/// For tests and tools (allocates; not for the audio thread).
impl EventSink for Vec<VoiceEvent> {
    fn voice_event(&mut self, event: VoiceEvent) {
        self.push(event);
    }
}

/// Starts voices on their frame and mixes them. See the module text for the realtime and determinism rules.
#[derive(Debug)]
pub struct Scheduler {
    /// Engine rate, Hz.
    rate: f64,
    /// Engine frame of the next frame `render` will write.
    head: u64,
    next_seq: u64,
    /// Voices waiting for their start frame, in no order. Capacity `max_pending`, never grows.
    pending: Vec<Voice>,
    max_pending: usize,
    /// Lower bound of the earliest start frame in `pending`.
    next_start: u64,
    /// Sounding voices sorted by (start frame, arrival). Capacity `max_sounding`, never grows.
    sounding: Vec<Voice>,
    max_sounding: usize,
    /// Buffers of finished voices, waiting to be handed to another thread. Capacity fixed, see `has_room`.
    dead: Vec<AudioBuffer>,
    clipped_total: u64,
}

impl Scheduler {
    /// A scheduler at `engine_rate` Hz with room for `max_pending` waiting and `max_sounding` sounding voices.
    /// Allocates everything it will ever need.
    pub fn new(engine_rate: u32, max_pending: usize, max_sounding: usize) -> Self {
        Scheduler {
            rate: engine_rate as f64,
            head: 0,
            next_seq: 0,
            pending: Vec::with_capacity(max_pending),
            max_pending,
            next_start: u64::MAX,
            sounding: Vec::with_capacity(max_sounding),
            max_sounding,
            dead: Vec::with_capacity(max_pending + max_sounding + DEAD_SLACK),
            clipped_total: 0,
        }
    }

    /// Engine rate, Hz.
    pub fn rate(&self) -> f64 {
        self.rate
    }

    /// Engine frame of the next frame `render` will write (the render head).
    pub fn head(&self) -> u64 {
        self.head
    }

    /// Voices waiting for their start frame.
    pub fn pending_len(&self) -> usize {
        self.pending.len()
    }

    /// Voices sounding.
    pub fn sounding_len(&self) -> usize {
        self.sounding.len()
    }

    /// Frames limited to ±1 since creation.
    pub fn clipped_total(&self) -> u64 {
        self.clipped_total
    }

    /// True when [`Scheduler::add`] can take a voice. Every voice handed in owns a buffer reference that must
    /// end in the dead list, which cannot grow; so the number of voices held plus dead buffers not yet drained
    /// is kept below that list's capacity. When the owner stops draining, this turns false and voices stay with
    /// the caller instead of being freed on the audio thread.
    pub fn has_room(&self) -> bool {
        self.pending.len() + self.sounding.len() + self.dead.len() < self.dead.capacity()
    }

    /// Takes a voice. A start frame behind the head is moved to the head and reported as [`VoiceEvent::Late`].
    /// Returns the voice when [`Scheduler::has_room`] is false. Realtime: no allocation (capacities are
    /// reserved), constant work.
    // The refused voice comes back by value: boxing it would allocate on the audio thread.
    #[allow(clippy::result_large_err)]
    pub fn add(&mut self, mut voice: Voice, sink: &mut impl EventSink) -> Result<(), Voice> {
        if !self.has_room() {
            return Err(voice);
        }
        if self.pending.len() >= self.max_pending {
            sink.voice_event(VoiceEvent::Rejected { id: voice.id, reason: RejectReason::PendingFull });
            self.dead.push(voice.buf);
            return Ok(());
        }
        if voice.start_frame < self.head {
            sink.voice_event(VoiceEvent::Late { id: voice.id, late_frames: self.head - voice.start_frame });
            voice.start_frame = self.head;
        }
        voice.seq = self.next_seq;
        self.next_seq += 1;
        self.next_start = self.next_start.min(voice.start_frame);
        self.pending.push(voice);
        Ok(())
    }

    /// Stops every voice with this id: a waiting voice is removed, a sounding one fades to 0 over `fade_frames`
    /// engine frames (0 = cut) and then ends. Realtime: one pass over both lists.
    pub fn stop_voice(&mut self, id: u32, fade_frames: f64, sink: &mut impl EventSink) {
        self.stop_where(|v| v.id == id, fade_frames, sink);
    }

    /// Stops every voice of `group`, as [`Scheduler::stop_voice`] does. Voices of the other group are untouched.
    pub fn cancel_group(&mut self, group: Group, fade_frames: f64, sink: &mut impl EventSink) {
        self.stop_where(|v| v.group == group, fade_frames, sink);
    }

    fn stop_where(&mut self, hit: impl Fn(&Voice) -> bool, fade_frames: f64, sink: &mut impl EventSink) {
        let mut i = 0;
        while i < self.pending.len() {
            if hit(&self.pending[i]) {
                let v = self.pending.swap_remove(i);
                sink.voice_event(VoiceEvent::Ended { id: v.id });
                self.dead.push(v.buf);
            } else {
                i += 1;
            }
        }
        let len = if fade_frames.is_finite() && fade_frames > 0.0 { fade_frames } else { 0.0 };
        let fade = Fade { start: self.head, len };
        for v in self.sounding.iter_mut().filter(|v| hit(v)) {
            // An earlier, shorter fade keeps running.
            if v.fade.map_or(true, |f| f.end() > fade.end()) {
                v.fade = Some(fade);
            }
        }
    }

    /// Moves the head forward to `frame` without rendering (output stream restart). Never moves it back.
    pub fn skip_to(&mut self, frame: u64) {
        self.head = self.head.max(frame);
    }

    /// Hands dead buffers to `accept` until it refuses one (which is kept for the next call). The owner calls
    /// this with a push into a ring that another thread drains, so no buffer is freed on the audio thread.
    pub fn drain_dead(&mut self, mut accept: impl FnMut(AudioBuffer) -> Result<(), AudioBuffer>) {
        while let Some(b) = self.dead.pop() {
            if let Err(b) = accept(b) {
                self.dead.push(b);
                break;
            }
        }
    }

    /// Number of dead buffers waiting for [`Scheduler::drain_dead`].
    pub fn dead_len(&self) -> usize {
        self.dead.len()
    }

    /// Renders `out.len() / channels` frames from the head: the mono mix, limited to ±1, copied to every channel
    /// of the interleaved `out`. Returns the number of frames that had to be limited.
    ///
    /// Realtime: no allocation (all lists have reserved capacity and `has_room` keeps the dead list within its
    /// own), no locks, no system calls. Work is bounded by `max_pending` (one scan, only in callbacks where a
    /// voice is due) plus `max_sounding * frames` interpolations.
    pub fn render(&mut self, out: &mut [f32], channels: usize, sink: &mut impl EventSink) -> u32 {
        if channels == 0 {
            return 0;
        }
        let frames = out.len() / channels;
        let start = self.head;
        let end = start + frames as u64;
        out.fill(0.0);

        // Move due voices from pending to sounding, keeping sounding sorted by (start frame, arrival).
        if self.next_start < end {
            let mut next = u64::MAX;
            let mut i = 0;
            while i < self.pending.len() {
                if self.pending[i].start_frame < end {
                    let v = self.pending.swap_remove(i);
                    if self.sounding.len() >= self.max_sounding {
                        sink.voice_event(VoiceEvent::Rejected { id: v.id, reason: RejectReason::SoundingFull });
                        self.dead.push(v.buf);
                    } else {
                        let key = (v.start_frame, v.seq);
                        let at = self.sounding.partition_point(|s| (s.start_frame, s.seq) < key);
                        self.sounding.insert(at, v);
                    }
                } else {
                    next = next.min(self.pending[i].start_frame);
                    i += 1;
                }
            }
            self.next_start = next;
        }

        // Mix in order; retire voices that end inside this callback.
        let mut i = 0;
        while i < self.sounding.len() {
            let v = &self.sounding[i];
            let v_end = v.end_frame();
            let (a, b) = (v.start_frame.max(start), v_end.min(end));
            if a < b {
                v.mix(a, b, start, out, channels);
            }
            if v_end <= end {
                let v = self.sounding.remove(i);
                sink.voice_event(VoiceEvent::Ended { id: v.id });
                self.dead.push(v.buf);
            } else {
                i += 1;
            }
        }

        // Hard limit and fan out to the other channels.
        let mut clipped = 0u32;
        for frame in out.chunks_exact_mut(channels) {
            let mut x = frame[0];
            if !(-1.0..=1.0).contains(&x) {
                clipped += 1;
                x = if x.is_nan() { 0.0 } else { x.clamp(-1.0, 1.0) };
            }
            frame.fill(x);
        }
        self.clipped_total += clipped as u64;
        self.head = end;
        clipped
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TestRng;
    use std::f64::consts::PI;

    fn buf(samples: Vec<f32>, rate: u32) -> AudioBuffer {
        AudioBuffer::new(samples, rate)
    }

    fn voice(spec: &VoiceSpec, group: Group, b: &AudioBuffer, rate: u32) -> Voice {
        Voice::new(spec, group, b.clone(), rate as f64).expect("valid spec")
    }

    /// Renders `total` frames in callbacks whose sizes come from `sizes` (cycled), returning channel 0.
    fn render_mono(s: &mut Scheduler, total: usize, sizes: &[usize], channels: usize, ev: &mut Vec<VoiceEvent>) -> Vec<f32> {
        let mut out = Vec::with_capacity(total);
        let mut scratch = vec![0f32; 4096 * channels];
        let mut k = 0;
        while out.len() < total {
            let n = sizes[k % sizes.len()].min(total - out.len());
            k += 1;
            let chunk = &mut scratch[..n * channels];
            s.render(chunk, channels, ev);
            for f in chunk.chunks_exact(channels) {
                assert!(f.iter().all(|c| c.to_bits() == f[0].to_bits()), "all channels carry the mono mix");
                out.push(f[0]);
            }
        }
        out
    }

    #[test]
    fn scheduler_starts_on_exact_frame() {
        for (rate, seed) in [(48_000u32, 11u64), (44_100, 12)] {
            let mut rng = TestRng::new(seed);
            let impulse = buf(vec![1.0], rate);
            let mut s = Scheduler::new(rate, DEFAULT_MAX_PENDING, DEFAULT_MAX_SOUNDING);
            let mut ev = Vec::new();
            let total = 10 * rate as usize;
            let mut expected = vec![0f32; total + 2048];
            let mut times = Vec::new();
            for id in 0..200u32 {
                let t = rng.uniform(0.05, 9.9);
                times.push(t);
                expected[(t * rate as f64).round() as usize] += 0.25;
                let spec = VoiceSpec { gain: 0.25, ..VoiceSpec::new(id, 0, t) };
                s.add(voice(&spec, Group::Take, &impulse, rate), &mut ev).expect("room");
            }
            let sizes: Vec<usize> = (0..997).map(|_| 64 + rng.below(961) as usize).collect();
            assert!(sizes.iter().any(|&n| n == 64 || n < 80) && sizes.iter().any(|&n| n > 1000));
            let out = render_mono(&mut s, total, &sizes, 2, &mut ev);
            let mut wrong = 0usize;
            for n in 0..total {
                if out[n].to_bits() != expected[n].to_bits() {
                    wrong += 1;
                }
            }
            let hits = out.iter().filter(|x| **x != 0.0).count();
            let distinct = { let mut f: Vec<u64> = times.iter().map(|t| (t * rate as f64).round() as u64).collect(); f.sort_unstable(); f.dedup(); f.len() };
            println!("scheduler_starts_on_exact_frame @{rate}: 200 impulses, {distinct} distinct frames, {wrong} frames wrong (max error 0 frames required)");
            assert_eq!(wrong, 0);
            assert_eq!(hits, distinct);
            assert_eq!(ev.iter().filter(|e| matches!(e, VoiceEvent::Ended { .. })).count(), 200);
            assert!(!ev.iter().any(|e| matches!(e, VoiceEvent::Late { .. } | VoiceEvent::Rejected { .. })));
        }
    }

    /// A stand-in click: a 30 ms decaying 1.6 kHz burst (the real click samples come from TypeScript).
    fn click(rate: u32) -> AudioBuffer {
        let n = (0.03 * rate as f64) as usize;
        buf((0..n).map(|i| { let t = i as f64 / rate as f64; ((2.0 * PI * 1600.0 * t).sin() * (-t / 0.006).exp()) as f32 }).collect(), rate)
    }

    fn tone(freq: f64, sec: f64, rate: u32) -> AudioBuffer {
        let n = (sec * rate as f64).round() as usize;
        buf((0..n).map(|i| (2.0 * PI * freq * i as f64 / rate as f64).sin() as f32).collect(), rate)
    }

    fn take_fixture(s: &mut Scheduler, rate: u32) {
        let mut ev = Vec::new();
        let c = click(rate);
        let note = tone(440.0, 0.4, 44_100);
        let mut id = 0;
        // A take: 40 clicks at 137 bpm from an off-grid origin, every fourth accented.
        for k in 0..40 {
            let t = 0.123_456_7 + k as f64 * 60.0 / 137.0;
            let spec = VoiceSpec { gain: if k % 4 == 0 { 0.9 } else { 0.55 }, ..VoiceSpec::new(id, 0, t) };
            s.add(voice(&spec, Group::Take, &c, rate), &mut ev).unwrap();
            id += 1;
        }
        // Sampled notes over it: rate, loop, envelope, stop, overlapping each other and the clicks.
        for k in 0..12 {
            let t = 0.31 + k as f64 * 0.777;
            let spec = VoiceSpec {
                gain: 0.2,
                rate: 2f64.powf((k as f64 - 5.0) / 12.0),
                offset_sec: 0.004,
                loop_sec: Some((0.1, 0.1 + 67.0 / 440.0)),
                env: vec![(t, 0.0), (t + 0.02, 1.0), (t + 1.3, 0.7), (t + 1.5, 0.0)],
                stop_at: Some(t + 1.5),
                ..VoiceSpec::new(id, 1, t)
            };
            s.add(voice(&spec, Group::Sounds, &note, rate), &mut ev).unwrap();
            id += 1;
        }
    }

    #[test]
    fn scheduler_chunking_invariant() {
        let rate = 48_000u32;
        let total = 19 * rate as usize;
        let mut runs: Vec<Vec<f32>> = Vec::new();
        for sizes in [&[128usize][..], &[441], &[1024], &[64, 1000, 97, 512, 1]] {
            let mut s = Scheduler::new(rate, DEFAULT_MAX_PENDING, DEFAULT_MAX_SOUNDING);
            take_fixture(&mut s, rate);
            let mut ev = Vec::new();
            runs.push(render_mono(&mut s, total, sizes, 1, &mut ev));
            assert_eq!(ev.iter().filter(|e| matches!(e, VoiceEvent::Ended { .. })).count(), 52);
            assert_eq!((s.pending_len(), s.sounding_len()), (0, 0));
        }
        let energy: f64 = runs[0].iter().map(|x| (*x as f64).powi(2)).sum();
        assert!(energy > 100.0, "the fixture is not silent");
        let mut differing = 0usize;
        for r in &runs[1..] {
            differing += r.iter().zip(&runs[0]).filter(|(a, b)| a.to_bits() != b.to_bits()).count();
        }
        println!("scheduler_chunking_invariant: {} frames x 4 chunkings (128, 441, 1024, mixed), {differing} samples differ", total);
        assert_eq!(differing, 0);
    }

    /// Frequency of a steady sine from its upward zero crossings (least-squares line through crossing times).
    fn zero_crossing_hz(x: &[f32], rate: f64) -> f64 {
        let mut times = Vec::new();
        for i in 1..x.len() {
            if x[i - 1] < 0.0 && x[i] >= 0.0 {
                let frac = -x[i - 1] as f64 / (x[i] as f64 - x[i - 1] as f64);
                times.push((i as f64 - 1.0 + frac) / rate);
            }
        }
        let n = times.len() as f64;
        let mk = (n - 1.0) / 2.0;
        let mt = times.iter().sum::<f64>() / n;
        let (mut sxy, mut sxx) = (0.0, 0.0);
        for (k, t) in times.iter().enumerate() {
            sxy += (k as f64 - mk) * (t - mt);
            sxx += (k as f64 - mk).powi(2);
        }
        1.0 / (sxy / sxx)
    }

    #[test]
    fn voice_rate_loop_envelope() {
        let rate = 48_000u32;
        let note = tone(440.0, 0.4, 44_100);
        let semis = 2f64.powf(3.0 / 12.0);
        // The loop is a whole number of periods (67) with a fractional end frame (11125.227), so a looping
        // voice is one continuous sine at 440 * 2^(3/12) Hz.
        let base = VoiceSpec { gain: 0.8, rate: semis, loop_sec: Some((0.1, 0.1 + 67.0 / 440.0)), ..VoiceSpec::new(1, 0, 0.25) };
        let env_points = vec![(0.3, 0.0), (0.5, 1.0), (1.2, 0.4), (2.0, 0.4), (2.0, 0.8), (2.6, 0.0)];
        let ideal = |t: f64| -> f64 {
            let p = &env_points;
            if t < p[0].0 { return p[0].1 as f64; }
            for w in p.windows(2).rev() {
                if t >= w[0].0 && w[1].0 > w[0].0 && t < w[1].0 {
                    return w[0].1 as f64 + (w[1].1 as f64 - w[0].1 as f64) * (t - w[0].0) / (w[1].0 - w[0].0);
                }
            }
            if t >= 2.6 { 0.0 } else { unreachable!() }
        };
        let total = 3 * rate as usize;
        let render = |spec: &VoiceSpec| {
            let mut s = Scheduler::new(rate, 16, 16);
            let mut ev = Vec::new();
            s.add(voice(spec, Group::Sounds, &note, rate), &mut ev).unwrap();
            render_mono(&mut s, total, &[256], 1, &mut ev)
        };
        let plain = render(&base);
        let shaped = render(&VoiceSpec { env: env_points.clone(), ..base.clone() });

        let start = (0.25f64 * rate as f64).round() as usize;
        assert!(plain[..start].iter().all(|x| *x == 0.0) && plain[start + 1] != 0.0);
        // Pitch over 2.5 s, 36 loop passes.
        let hz = zero_crossing_hz(&plain[start + 2400..], rate as f64);
        let cents = 1200.0 * (hz / (440.0 * semis)).log2();
        // Waveform against the ideal sine (interpolation error).
        let mut wave_err = 0f64;
        for (n, x) in plain.iter().enumerate().skip(start) {
            let t = (n - start) as f64 / rate as f64;
            wave_err = wave_err.max((*x as f64 - 0.8 * (2.0 * PI * 440.0 * semis * t).sin()).abs());
        }
        // Envelope against the linear ideal, on the same carrier.
        let mut env_err = 0f64;
        for n in 0..total {
            let want = plain[n] as f64 * ideal(n as f64 / rate as f64);
            env_err = env_err.max((shaped[n] as f64 - want).abs());
        }
        println!("voice_rate_loop_envelope: {hz:.4} Hz, {cents:+.5} cent (limit 0.5); envelope max error {env_err:.2e} (limit 1e-4); waveform max error {wave_err:.2e}");
        assert!(cents.abs() < 0.5);
        assert!(env_err < 1e-4);
        assert!(wave_err < 2e-3);
        assert!(shaped[(2.7 * rate as f64) as usize..].iter().all(|x| *x == 0.0));
    }

    #[test]
    fn loop_that_ends_with_the_buffer_has_no_hole() {
        // A loop whose end is the end of the buffer: the interpolation taps past the end must come from the
        // loop start, not be zeros. 441 Hz at 44.1 kHz, loop of 30 whole periods ending with the buffer.
        let rate = 48_000u32;
        let note = tone(441.0, 0.2, 44_100);
        assert_eq!(note.samples.len(), 8820);
        let spec = VoiceSpec { loop_sec: Some((0.2 - 3000.0 / 44_100.0, 0.2)), ..VoiceSpec::new(1, 0, 0.0) };
        let mut s = Scheduler::new(rate, 4, 4);
        let mut ev = Vec::new();
        s.add(voice(&spec, Group::Sounds, &note, rate), &mut ev).unwrap();
        let out = render_mono(&mut s, rate as usize, &[256], 1, &mut ev);
        let worst = out.iter().enumerate().map(|(n, x)| (*x as f64 - (2.0 * PI * 441.0 * n as f64 / rate as f64).sin()).abs()).fold(0.0, f64::max);
        println!("loop ending with the buffer: max deviation from the continuous tone {worst:.2e} over 1 s (5 wraps)");
        assert!(worst < 1e-3, "{worst}");
    }

    #[test]
    fn late_voice_reported() {
        let rate = 48_000u32;
        let ramp = buf((0..4800).map(|i| (i + 1) as f32 / 4800.0).collect(), rate);
        let mut s = Scheduler::new(rate, 16, 16);
        let mut ev = Vec::new();
        render_mono(&mut s, 48_000, &[128], 2, &mut ev);
        assert_eq!(s.head(), 48_000);
        // 10 ms behind the head, starting 5 ms into the buffer.
        let spec = VoiceSpec { offset_sec: 0.005, ..VoiceSpec::new(77, 0, 1.0 - 0.010) };
        s.add(voice(&spec, Group::Sounds, &ramp, rate), &mut ev).unwrap();
        assert_eq!(ev, vec![VoiceEvent::Late { id: 77, late_frames: 480 }]);
        let out = render_mono(&mut s, 128, &[128], 2, &mut ev);
        let wrong = (0..128).filter(|&n| out[n].to_bits() != ramp.samples[240 + n].to_bits()).count();
        println!("late_voice_reported: 480 frames late, first sample of the next callback is buffer frame 240, {wrong} of 128 samples wrong");
        assert_eq!(wrong, 0);
    }

    #[test]
    fn stop_fades_and_removes_waiting_voices() {
        let rate = 48_000u32;
        let dc = buf(vec![1.0; 96_000], rate);
        let mut s = Scheduler::new(rate, 16, 16);
        let mut ev = Vec::new();
        s.add(voice(&VoiceSpec::new(1, 0, 0.0), Group::Sounds, &dc, rate), &mut ev).unwrap();
        s.add(voice(&VoiceSpec::new(2, 0, 0.5), Group::Sounds, &dc, rate), &mut ev).unwrap();
        s.add(voice(&VoiceSpec::new(3, 0, 0.0), Group::Sounds, &dc, rate), &mut ev).unwrap();
        let before = render_mono(&mut s, 4800, &[480], 1, &mut ev);
        assert!(before.iter().all(|x| *x == 1.0), "two voices of 1.0 are limited to 1.0");
        assert_eq!(s.clipped_total(), 4800);
        s.stop_voice(3, 0.0, &mut ev); // cut
        s.stop_voice(2, 480.0, &mut ev); // still waiting: removed
        assert_eq!(ev, vec![VoiceEvent::Ended { id: 2 }]);
        let mid = render_mono(&mut s, 960, &[100], 1, &mut ev);
        assert!(mid.iter().all(|x| *x == 1.0));
        assert_eq!(ev, vec![VoiceEvent::Ended { id: 2 }, VoiceEvent::Ended { id: 3 }]);
        let h = s.head();
        s.stop_voice(1, 0.010 * rate as f64, &mut ev);
        s.stop_voice(1, 4800.0, &mut ev); // a later, longer stop does not stretch the fade
        let out = render_mono(&mut s, 1000, &[128], 1, &mut ev);
        let mut err = 0f64;
        for (k, x) in out.iter().enumerate() {
            let want = (1.0 - k as f64 / 480.0).max(0.0);
            err = err.max((*x as f64 - want).abs());
        }
        println!("stop fade: 480-frame linear fade from frame {h}, max error {err:.2e}");
        assert!(err < 1e-6);
        assert_eq!(ev.last(), Some(&VoiceEvent::Ended { id: 1 }));
        assert_eq!((s.pending_len(), s.sounding_len(), s.dead_len()), (0, 0, 3));
        let mut freed = 0;
        s.drain_dead(|b| { drop(b); freed += 1; Ok(()) });
        assert_eq!((freed, s.dead_len()), (3, 0));
    }

    #[test]
    fn cancel_is_per_group() {
        let rate = 48_000u32;
        let c = click(rate);
        let note = tone(330.0, 1.0, rate);
        let build = |with_sounds: bool, with_take: bool| {
            let mut s = Scheduler::new(rate, 64, 16);
            let mut ev = Vec::new();
            if with_take {
                for k in 0..8 {
                    let spec = VoiceSpec { gain: 0.5, ..VoiceSpec::new(k, 0, 0.01 + k as f64 * 0.25) };
                    s.add(voice(&spec, Group::Take, &c, rate), &mut ev).unwrap();
                }
            }
            if with_sounds {
                for k in 0..4 {
                    let spec = VoiceSpec { gain: 0.3, ..VoiceSpec::new(100 + k, 1, 0.005 + k as f64 * 0.6) };
                    s.add(voice(&spec, Group::Sounds, &note, rate), &mut ev).unwrap();
                }
            }
            s
        };
        let total = 2 * rate as usize;
        let cut = 30_000usize; // one note sounding, one click sounding, more of both waiting
        for (group, keep_take) in [(Group::Sounds, true), (Group::Take, false)] {
            let mut ev = Vec::new();
            let mut both = build(true, true);
            let mut out = render_mono(&mut both, cut, &[128], 1, &mut ev);
            both.cancel_group(group, 0.0, &mut ev);
            out.extend(render_mono(&mut both, total - cut, &[128], 1, &mut ev));
            let mut alone = build(!keep_take, keep_take);
            let reference = render_mono(&mut alone, total, &[128], 1, &mut Vec::new());
            let differ = (cut..total).filter(|&n| out[n].to_bits() != reference[n].to_bits()).count();
            let changed_before = (0..cut).filter(|&n| out[n].to_bits() != reference[n].to_bits()).count();
            println!("cancel {group:?}: {differ} samples of the other group differ after the cancel");
            assert_eq!(differ, 0, "the other group plays on untouched");
            assert!(changed_before > 0, "both groups were audible before the cancel");
            let cancelled: Vec<u32> = ev.iter().filter_map(|e| if let VoiceEvent::Ended { id } = e { Some(*id) } else { None }).collect();
            let ids_of_group = |id: &u32| (*id >= 100) == (group == Group::Sounds);
            assert_eq!(cancelled.iter().filter(|id| ids_of_group(id)).count(), if keep_take { 4 } else { 8 });
        }
        // With a fade the cancelled group decays to silence and the other one is still untouched afterwards.
        let mut ev = Vec::new();
        let mut both = build(true, true);
        render_mono(&mut both, cut, &[128], 1, &mut ev);
        both.cancel_group(Group::Sounds, 240.0, &mut ev);
        let tail = render_mono(&mut both, total - cut, &[128], 1, &mut ev);
        let mut alone = build(false, true);
        let reference = render_mono(&mut alone, total, &[128], 1, &mut Vec::new());
        assert!((0..240).any(|k| tail[k] != reference[cut + k]));
        assert!((240..total - cut).all(|k| tail[k].to_bits() == reference[cut + k].to_bits()));
    }

    #[test]
    fn limiter_counts_clipped_frames() {
        let rate = 48_000u32;
        let dc = buf(vec![1.0; 1000], rate);
        let mut s = Scheduler::new(rate, 8, 8);
        let mut ev = Vec::new();
        s.add(voice(&VoiceSpec { gain: 0.8, ..VoiceSpec::new(1, 0, 0.0) }, Group::Sounds, &dc, rate), &mut ev).unwrap();
        s.add(voice(&VoiceSpec { gain: 0.8, stop_at: Some(300.0 / 48_000.0), ..VoiceSpec::new(2, 0, 100.0 / 48_000.0) }, Group::Sounds, &dc, rate), &mut ev).unwrap();
        s.add(voice(&VoiceSpec { gain: -3.0, ..VoiceSpec::new(3, 0, 1500.0 / 48_000.0) }, Group::Sounds, &dc, rate), &mut ev).unwrap();
        let mut out = vec![0f32; 2 * 2048];
        let clipped = s.render(&mut out, 2, &mut ev);
        assert_eq!(clipped, 200 + 548);
        assert_eq!(s.clipped_total(), 748);
        assert_eq!(out[2 * 99], 0.8);
        assert_eq!((out[2 * 100], out[2 * 299], out[2 * 300]), (1.0, 1.0, 0.8));
        assert_eq!((out[2 * 1500], out[2 * 1500 + 1], out[2 * 2047]), (-1.0, -1.0, -1.0));
        assert!(out.iter().all(|x| x.abs() <= 1.0));
    }

    #[test]
    fn capacities_reject_instead_of_growing() {
        let rate = 48_000u32;
        let dc = buf(vec![0.01; 48_000], rate);
        let mut s = Scheduler::new(rate, 4, 2);
        let (cap_p, cap_s, cap_d) = (s.pending.capacity(), s.sounding.capacity(), s.dead.capacity());
        let mut ev = Vec::new();
        for id in 0..6 {
            s.add(voice(&VoiceSpec::new(id, 0, 0.0), Group::Sounds, &dc, rate), &mut ev).unwrap();
        }
        assert_eq!(ev, vec![
            VoiceEvent::Rejected { id: 4, reason: RejectReason::PendingFull },
            VoiceEvent::Rejected { id: 5, reason: RejectReason::PendingFull },
        ]);
        ev.clear();
        let mut out = vec![0f32; 64];
        s.render(&mut out, 1, &mut ev);
        assert_eq!(ev.iter().filter(|e| matches!(e, VoiceEvent::Rejected { reason: RejectReason::SoundingFull, .. })).count(), 2);
        assert_eq!((s.sounding_len(), s.pending_len(), s.dead_len()), (2, 0, 4));
        assert_eq!(out[0], 0.02);
        // Fill the dead list: the scheduler then refuses voices instead of freeing or growing.
        let mut refused = 0;
        for id in 10..200 {
            if let Err(v) = s.add(voice(&VoiceSpec::new(id, 0, 0.0), Group::Take, &dc, rate), &mut ev) {
                assert_eq!(v.id(), id);
                refused += 1;
            }
            s.cancel_group(Group::Take, 0.0, &mut ev);
        }
        assert!(refused > 0 && !s.has_room());
        assert_eq!((s.pending.capacity(), s.sounding.capacity(), s.dead.capacity()), (cap_p, cap_s, cap_d));
        s.drain_dead(|_| Ok(()));
        assert!(s.has_room());
    }

    #[test]
    fn envelope_holds_steps_and_interpolates() {
        let e = Envelope::from_points(&[(1.0, 0.2), (2.0, 1.0), (2.0, 0.5), (4.0, 0.0)], 100.0).unwrap();
        assert_eq!(e.value_at(0.0), 0.2);
        assert_eq!(e.value_at(100.0), 0.2);
        assert!((e.value_at(150.0) - 0.6).abs() < 1e-7);
        assert!((e.value_at(199.999) - 1.0).abs() < 1e-4);
        assert_eq!(e.value_at(200.0), 0.5);
        assert!((e.value_at(300.0) - 0.25).abs() < 1e-7);
        assert_eq!(e.value_at(400.0), 0.0);
        assert_eq!(e.value_at(1e9), 0.0);
        assert_eq!(Envelope::constant().value_at(5.0), 1.0);
        assert_eq!(Envelope::from_points(&[(2.0, 1.0), (1.0, 0.0)], 100.0), Err(SpecError::BadEnvelope));
        assert_eq!(Envelope::from_points(&[(0.0, 1.0); 9], 100.0), Err(SpecError::BadEnvelope));
    }

    #[test]
    fn specs_are_validated_and_store_keeps_buffers() {
        let b = buf(vec![0.0; 100], 44_100);
        let ok = VoiceSpec::new(1, 0, 0.0);
        let bad = |f: &dyn Fn(&mut VoiceSpec)| { let mut s = ok.clone(); f(&mut s); Voice::new(&s, Group::Take, b.clone(), 48_000.0).err() };
        assert_eq!(bad(&|s| s.t = f64::NAN), Some(SpecError::NotFinite));
        assert_eq!(bad(&|s| s.rate = 0.0), Some(SpecError::BadRate));
        assert_eq!(bad(&|s| s.offset_sec = -1.0), Some(SpecError::BadRate));
        assert_eq!(bad(&|s| s.loop_sec = Some((0.001, 0.001))), Some(SpecError::BadLoop));
        assert_eq!(bad(&|s| s.stop_at = Some(f64::INFINITY)), Some(SpecError::NotFinite));
        let v = Voice::new(&VoiceSpec { t: -3.0, ..ok.clone() }, Group::Take, b.clone(), 48_000.0).unwrap();
        assert_eq!(v.start_frame(), 0);
        // 100 frames at 44.1 kHz last ceil(100 * 48000 / 44100) = 109 engine frames.
        assert_eq!(v.end_frame(), 109);

        let mut store = BufferStore::new();
        assert!(store.put(3, b.clone()).is_none());
        assert!(store.put(3, buf(vec![1.0; 5], 48_000)).is_some());
        assert_eq!((store.len(), store.total_frames()), (1, 5));
        assert_eq!(store.get(3).map(|x| x.sample_rate), Some(48_000));
        assert!(store.remove(3).is_some() && store.is_empty());
    }
}
