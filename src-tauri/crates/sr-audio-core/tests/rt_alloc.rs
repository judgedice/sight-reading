//! Realtime safety of the audio callbacks: after warm-up, `Engine::render` and the capture seam must not call
//! the allocator at all (no allocation, no reallocation, no free).
//!
//! The counting allocator needs `unsafe`, which the library forbids for itself; it lives here, in a test
//! binary of its own. Only calls made by the test thread while it is "armed" are counted, so the test
//! harness's other threads cannot disturb the count.

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::sync::atomic::{AtomicU64, Ordering};

use sr_audio_core::mixer::{AudioBuffer, Group, VoiceSpec};
use sr_audio_core::{engine, EngineConfig, Notification};

struct Counting;

static CALLS: AtomicU64 = AtomicU64::new(0);

thread_local! {
    static ARMED: Cell<bool> = const { Cell::new(false) };
}

fn count() {
    // `try_with`: the allocator may run while the thread-local is being torn down.
    if ARMED.try_with(Cell::get).unwrap_or(false) {
        CALLS.fetch_add(1, Ordering::Relaxed);
    }
}

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        count();
        System.alloc(layout)
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        count();
        System.dealloc(ptr, layout)
    }
    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        count();
        System.alloc_zeroed(layout)
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        count();
        System.realloc(ptr, layout, new_size)
    }
}

#[global_allocator]
static GLOBAL: Counting = Counting;

/// Runs `f` with the counter armed and returns the number of allocator calls it made.
fn counted(f: impl FnOnce()) -> u64 {
    let before = CALLS.load(Ordering::Relaxed);
    ARMED.with(|a| a.set(true));
    f();
    ARMED.with(|a| a.set(false));
    CALLS.load(Ordering::Relaxed) - before
}

#[test]
fn render_does_not_allocate() {
    const RATE: u32 = 48_000;
    // The counter itself works.
    assert!(counted(|| drop(std::hint::black_box(vec![0u8; 64]))) >= 2);

    let (mut engine, mut handle) = engine(EngineConfig::new(RATE));
    let click: Vec<f32> = (0..1440).map(|i| ((i as f32) * 0.2).sin() * (-(i as f32) / 300.0).exp()).collect();
    let note: Vec<f32> = (0..17_640).map(|i| ((i as f32) * 0.0627).sin() * 0.3).collect();
    handle.put_buffer(1, AudioBuffer::new(click, RATE));
    handle.put_buffer(2, AudioBuffer::new(note, 44_100));

    let mut out = vec![0f32; 1024 * 2];
    let input = vec![0f32; 1024 * 2];
    let mut notes: Vec<Notification> = Vec::with_capacity(8192);
    let mut host_ns = 9_000_000_000u64;
    let mut next_id = 0u32;
    let mut allocator_calls = 0u64;
    let (mut callbacks, mut ended, mut late, mut clipped) = (0u32, 0u32, 0u32, 0u32);
    let sizes = [128usize, 128, 256, 441, 128, 1024, 64];

    // 0: warm-up second. 1..20: measured. Every "second" the control side schedules a take of clicks, looping
    // enveloped notes, a deliberately late voice and a loud pile-up; then stops, cancels and drops buffers.
    for second in 0..20u32 {
        let now = engine.head() as f64 / RATE as f64;
        let mut specs = Vec::new();
        for k in 0..16 {
            specs.push(VoiceSpec { gain: 0.6, ..VoiceSpec::new(next_id, 1, now + 0.05 + k as f64 * 0.06) });
            next_id += 1;
        }
        handle.schedule(Group::Take, &specs).unwrap();
        specs.clear();
        for k in 0..12 {
            let t = now + 0.02 + k as f64 * 0.07;
            specs.push(VoiceSpec {
                gain: 0.25,
                rate: 1.0 + k as f64 * 0.05,
                loop_sec: Some((0.1, 0.25)),
                env: vec![(t, 0.0), (t + 0.01, 1.0), (t + 0.5, 0.5), (t + 0.7, 0.0)],
                stop_at: Some(t + 0.7),
                ..VoiceSpec::new(next_id, 2, t)
            });
            next_id += 1;
        }
        specs.push(VoiceSpec::new(next_id, 1, now - 0.5)); // late
        next_id += 1;
        for _ in 0..6 {
            specs.push(VoiceSpec { gain: 0.9, ..VoiceSpec::new(next_id, 1, now + 0.4) }); // clips
            next_id += 1;
        }
        handle.schedule(Group::Sounds, &specs).unwrap();
        if second % 5 == 4 {
            // Replace a buffer while voices still use the old one: the old one is freed by `poll`, below.
            handle.drop_buffers(&[2]);
            handle.put_buffer(2, AudioBuffer::new(vec![0.1f32; 17_640], 44_100));
        }

        let target = engine.head() + RATE as u64;
        let mut i = 0usize;
        while engine.head() < target {
            let frames = sizes[i % sizes.len()];
            i += 1;
            if i == 40 {
                handle.stop_voices(&[next_id - 3, next_id - 9, 123_456], 0.01).unwrap();
            }
            if i == 80 && second % 2 == 1 {
                handle.cancel(Group::Sounds, 0.005).unwrap();
            }
            host_ns += frames as u64 * 1_000_000_000 / RATE as u64;
            let calls = counted(|| {
                engine.render(host_ns, &mut out[..frames * 2], 2);
                engine.capture(host_ns + 300_000, &input[..frames * 2], 2);
            });
            if second > 0 {
                allocator_calls += calls;
                callbacks += 1;
            }
            // The control side polls outside the measured region, as the pump thread would.
            if i % 4 == 0 {
                notes.clear();
                handle.poll(&mut notes);
                for n in &notes {
                    match n {
                        Notification::Ended { .. } => ended += 1,
                        Notification::Late { .. } => late += 1,
                        Notification::Clipped { .. } => clipped += 1,
                        _ => {}
                    }
                }
            }
        }
    }
    let stats = handle.stats();
    println!(
        "render_does_not_allocate: {allocator_calls} allocator calls in {callbacks} measured callbacks ({} voices scheduled, {ended} ended, {late} late, {clipped} clipped callbacks, {} notifications dropped)",
        next_id, stats.notifications_dropped
    );
    assert!(callbacks > 2500 && ended > 500 && late >= 15 && clipped > 0, "the run exercised every path");
    assert_eq!(stats.notifications_dropped, 0);
    assert_eq!(stats.rejected_voices, 0);
    assert_eq!(allocator_calls, 0, "the audio callbacks called the allocator");
}
