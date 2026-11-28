//! [`DeviceIo`] on cpal: one output stream, f32 preferred at the engine rate.
//!
//! The stream is built, played and dropped on one dedicated owner thread (some backends want a stream to stay
//! on the thread that made it, and it keeps [`CpalIo`] `Send` whatever the platform's `Stream` is).
//!
//! The data callback does, in this order: read the host clock (first statement), render, convert. It never locks
//! or allocates: the engine is owned by the closure, the conversion scratch is allocated before the stream
//! starts, and only atomics are touched besides.
//!
//! **TODO (capture task):** input stream. `OpenConfig::input` is ignored; the seam is [`CpalIo::open`], after the
//! output stream is playing: take `Engine::split_capture()` before moving the engine into the output callback.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{BufferSize, ErrorKind, InterfaceType, SampleFormat, SizedSample, StreamConfig, SupportedBufferSize};
use sr_audio_core::latency::{LatencyParts, LatencyReport, Platform, Transport};
use sr_audio_core::Engine;

use crate::{
    current_platform, host_clock, DeviceError, DeviceEvent, DeviceIo, EngineFactory, InterruptionReason, OpenConfig, OpenInfo, RouteFacts,
    StreamKind,
};

/// Samples of conversion scratch (per callback; larger callbacks are rendered in several pieces).
const SCRATCH_SAMPLES: usize = 32 * 1024;
/// How long `open` waits for the first callback to learn the buffer size when the backend does not say.
const FIRST_CALLBACK_WAIT: Duration = Duration::from_millis(250);

/// A stream configuration a device offers: a rate range at a channel count and format.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Offer {
    /// Channel count.
    pub channels: u16,
    /// Lowest rate, Hz.
    pub min_rate: u32,
    /// Highest rate, Hz.
    pub max_rate: u32,
    /// Sample format.
    pub format: SampleFormat,
    /// Fixed buffer sizes the backend accepts, frames; `None` when it does not say.
    pub buffer: Option<(u32, u32)>,
}

/// The stream configuration picked by [`choose_config`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Choice {
    /// Channel count.
    pub channels: u16,
    /// Rate, Hz.
    pub rate: u32,
    /// Sample format.
    pub format: SampleFormat,
    /// Fixed buffer sizes the backend accepts, frames.
    pub buffer: Option<(u32, u32)>,
}

/// Formats the callback converts from f32.
pub fn convertible(format: SampleFormat) -> bool {
    matches!(format, SampleFormat::F32 | SampleFormat::I16 | SampleFormat::U16 | SampleFormat::I32 | SampleFormat::F64)
}

fn rank(offer: &Offer) -> (u8, u8) {
    let layout = match offer.channels {
        2 => 0,
        1 => 1,
        _ => 2,
    };
    (u8::from(offer.format != SampleFormat::F32), layout)
}

/// Picks the stream configuration: `preferred_rate` in f32 (then another convertible format), stereo before
/// mono before more channels; when no offer covers the rate, the device's default configuration; when that
/// cannot be converted either, the best convertible offer at the rate nearest to the preferred one.
pub fn choose_config(offers: &[Offer], default: Option<Choice>, preferred_rate: u32) -> Option<Choice> {
    let at_rate = offers.iter().filter(|o| convertible(o.format) && o.min_rate <= preferred_rate && preferred_rate <= o.max_rate).min_by_key(|o| rank(o));
    if let Some(o) = at_rate {
        return Some(Choice { channels: o.channels, rate: preferred_rate, format: o.format, buffer: o.buffer });
    }
    if let Some(d) = default.filter(|d| convertible(d.format)) {
        return Some(d);
    }
    let any = offers.iter().filter(|o| convertible(o.format)).min_by_key(|o| rank(o))?;
    Some(Choice { channels: any.channels, rate: preferred_rate.clamp(any.min_rate, any.max_rate), format: any.format, buffer: any.buffer })
}

/// The buffer size to request: the caller's, else the platform's default of design section 1.
pub fn requested_buffer(cfg: &OpenConfig) -> Option<u32> {
    cfg.buffer_frames.or(if cfg!(any(target_os = "macos", target_os = "ios")) {
        Some(128)
    } else if cfg!(any(target_os = "android", target_os = "linux")) {
        Some(256)
    } else {
        None // WASAPI: the device period
    })
}

/// Transport from cpal's interface type (never guessed from names).
pub fn transport_of(interface: InterfaceType) -> Transport {
    match interface {
        InterfaceType::BuiltIn | InterfaceType::Pci => Transport::BuiltIn,
        InterfaceType::Usb | InterfaceType::Thunderbolt | InterfaceType::FireWire => Transport::Usb,
        InterfaceType::Bluetooth => Transport::Bluetooth,
        InterfaceType::Hdmi | InterfaceType::DisplayPort => Transport::Hdmi,
        InterfaceType::Line | InterfaceType::Spdif => Transport::Wired,
        InterfaceType::Network => Transport::Network,
        _ => Transport::Unknown,
    }
}

/// What the error callback tells the owner.
fn event_for(kind: ErrorKind) -> Option<DeviceEvent> {
    match kind {
        ErrorKind::Xrun => Some(DeviceEvent::Xrun(StreamKind::Output)),
        ErrorKind::RealtimeDenied => None,
        ErrorKind::DeviceChanged | ErrorKind::DeviceNotAvailable | ErrorKind::StreamInvalidated => {
            Some(DeviceEvent::Interruption(InterruptionReason::DeviceChange))
        }
        _ => Some(DeviceEvent::Interruption(InterruptionReason::Interrupted)),
    }
}

/// Gives the engine back when the closure that owns it is dropped without ever having run (a failed build), so
/// the build can be retried with another buffer size.
struct EngineBox {
    engine: Option<Engine>,
    back: Sender<Engine>,
}

impl Drop for EngineBox {
    fn drop(&mut self) {
        if let Some(e) = self.engine.take() {
            let _ = self.back.send(e);
        }
    }
}

/// The cpal output device.
pub struct CpalIo {
    owner: Option<Owner>,
    route: RouteFacts,
    parts: LatencyParts,
}

struct Owner {
    stop: Sender<()>,
    join: JoinHandle<()>,
}

impl Default for CpalIo {
    fn default() -> Self {
        Self::new()
    }
}

impl CpalIo {
    /// A closed device.
    pub fn new() -> Self {
        CpalIo { owner: None, route: unopened_route(), parts: LatencyParts::default() }
    }
}

fn unopened_route() -> RouteFacts {
    RouteFacts {
        output_uid: String::new(),
        input_uid: None,
        output_transport: Transport::Unknown,
        input_transport: None,
        platform: current_platform(),
        direct_hardware: false,
        low_latency_feature: false,
    }
}

impl Drop for CpalIo {
    fn drop(&mut self) {
        self.close();
    }
}

impl DeviceIo for CpalIo {
    fn open(&mut self, cfg: OpenConfig, make_engine: EngineFactory, events: Sender<DeviceEvent>) -> Result<OpenInfo, DeviceError> {
        if self.owner.is_some() {
            return Err(DeviceError::AlreadyOpen);
        }
        host_clock::init();
        let (ready_tx, ready_rx) = mpsc::channel::<Result<OpenInfo, DeviceError>>();
        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        let join = std::thread::Builder::new()
            .name("sr-audio-stream".into())
            .spawn(move || match start_output(&cfg, make_engine, events) {
                Ok((stream, info)) => {
                    let _ = ready_tx.send(Ok(info));
                    let _ = stop_rx.recv(); // returns when `close` drops or sends on the stop channel
                    drop(stream);
                }
                Err(e) => {
                    let _ = ready_tx.send(Err(e));
                }
            })
            .map_err(|e| DeviceError::Backend(e.to_string()))?;
        match ready_rx.recv() {
            Ok(Ok(info)) => {
                self.route = info.route.clone();
                self.parts = info.latency.parts;
                self.owner = Some(Owner { stop: stop_tx, join });
                Ok(info)
            }
            Ok(Err(e)) => {
                let _ = join.join();
                Err(e)
            }
            Err(_) => {
                let _ = join.join();
                Err(DeviceError::Backend("the audio thread ended during open".into()))
            }
        }
    }

    fn close(&mut self) {
        if let Some(owner) = self.owner.take() {
            let _ = owner.stop.send(());
            let _ = owner.join.join();
        }
    }

    fn route(&self) -> RouteFacts {
        self.route.clone()
    }

    fn latency(&self) -> LatencyParts {
        self.parts
    }
}

fn backend(e: cpal::Error) -> DeviceError {
    match e.kind() {
        ErrorKind::DeviceNotAvailable | ErrorKind::HostUnavailable => DeviceError::NoOutputDevice,
        _ => DeviceError::Backend(e.to_string()),
    }
}

fn pick_device(host: &cpal::Host, wanted: Option<&str>) -> Result<cpal::Device, DeviceError> {
    match wanted {
        None => host.default_output_device().ok_or(DeviceError::NoOutputDevice),
        Some(name) => {
            let devices = host.output_devices().map_err(backend)?;
            for d in devices {
                let by_id = d.id().map(|i| i.to_string() == name).unwrap_or(false);
                let by_name = d.description().map(|x| x.name() == name).unwrap_or(false);
                if by_id || by_name {
                    return Ok(d);
                }
            }
            Err(DeviceError::DeviceNotFound(name.to_string()))
        }
    }
}

fn start_output(cfg: &OpenConfig, make_engine: EngineFactory, events: Sender<DeviceEvent>) -> Result<(cpal::Stream, OpenInfo), DeviceError> {
    let host = cpal::default_host();
    let device = pick_device(&host, cfg.output_device.as_deref())?;

    let offers: Vec<Offer> = device
        .supported_output_configs()
        .map_err(backend)?
        .map(|r| Offer {
            channels: r.channels(),
            min_rate: r.min_sample_rate(),
            max_rate: r.max_sample_rate(),
            format: r.sample_format(),
            buffer: match r.buffer_size() {
                SupportedBufferSize::Range { min, max } => Some((*min, *max)),
                _ => None,
            },
        })
        .collect();
    let default = device.default_output_config().ok().map(|c| Choice {
        channels: c.channels(),
        rate: c.sample_rate(),
        format: c.sample_format(),
        buffer: match c.buffer_size() {
            SupportedBufferSize::Range { min, max } => Some((*min, *max)),
            _ => None,
        },
    });
    let choice = choose_config(&offers, default, cfg.preferred_rate)
        .ok_or_else(|| DeviceError::Unsupported("no f32, i16, u16, i32 or f64 output configuration".into()))?;

    // The engine rate is the stream rate; the factory is called once, here.
    let (back_tx, back_rx) = mpsc::channel::<Engine>();
    let mut engine = Some(make_engine(choice.rate));

    let first_frames = Arc::new(AtomicU32::new(0));
    let fixed = requested_buffer(cfg).map(|n| match choice.buffer {
        Some((lo, hi)) => n.clamp(lo, hi),
        None => n,
    });
    let mut attempts = Vec::new();
    if let Some(n) = fixed {
        attempts.push(BufferSize::Fixed(n));
    }
    attempts.push(BufferSize::Default);

    let mut last_err = DeviceError::Backend("no stream configuration worked".into());
    let mut built = None;
    for buffer_size in attempts {
        let Some(e) = engine.take().or_else(|| back_rx.try_recv().ok()) else { break };
        let config = StreamConfig { channels: choice.channels, sample_rate: choice.rate, buffer_size };
        let boxed = EngineBox { engine: Some(e), back: back_tx.clone() };
        match build_stream(&device, config, choice.format, boxed, events.clone(), Arc::clone(&first_frames)) {
            Ok(stream) => {
                built = Some((stream, buffer_size));
                break;
            }
            Err(err) => last_err = backend(err),
        }
    }
    let (stream, used_buffer) = built.ok_or(last_err)?;
    stream.play().map_err(backend)?;

    let mut out_frames = match used_buffer {
        BufferSize::Fixed(n) => n,
        BufferSize::Default => 0,
    };
    if let Ok(n) = stream.buffer_size() {
        out_frames = n;
    }
    if out_frames == 0 {
        let deadline = std::time::Instant::now() + FIRST_CALLBACK_WAIT;
        while first_frames.load(Ordering::Relaxed) == 0 && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(5));
        }
        out_frames = first_frames.load(Ordering::Relaxed);
    }

    let description = device.description().ok();
    let facts = RouteFacts {
        output_uid: device.id().map(|i| i.to_string()).or_else(|_| device.description().map(|d| d.name().to_string())).unwrap_or_default(),
        input_uid: None,
        output_transport: description.as_ref().map(|d| transport_of(d.interface_type())).unwrap_or(Transport::Unknown),
        input_transport: None,
        platform: current_platform(),
        // ALSA ids of raw hardware start with `hw:` (unverified on a real card; the container has none).
        direct_hardware: current_platform() == Platform::Linux && device.id().map(|i| i.id().starts_with("hw:")).unwrap_or(false),
        low_latency_feature: false,
    };
    // Generic part only: the buffer. Device, safety and stream parts belong to the per-platform modules (later task).
    let parts = LatencyParts {
        out_buffer: (out_frames > 0).then(|| out_frames as f64 / choice.rate as f64),
        ..LatencyParts::default()
    };
    let latency = LatencyReport::new(parts, &facts.trust_facts());
    let info = OpenInfo { engine_rate: choice.rate, out_frames, in_frames: None, input_rate: None, route: facts, latency, session_type: None };
    Ok((stream, info))
}

fn build_stream(
    device: &cpal::Device,
    config: StreamConfig,
    format: SampleFormat,
    engine: EngineBox,
    events: Sender<DeviceEvent>,
    first_frames: Arc<AtomicU32>,
) -> Result<cpal::Stream, cpal::Error> {
    let channels = config.channels as usize;
    let rate = config.sample_rate;
    let on_error = move |e: cpal::Error| {
        if let Some(ev) = event_for(e.kind()) {
            let _ = events.send(ev);
        }
    };
    match format {
        SampleFormat::F32 => {
            let mut engine = engine;
            device.build_output_stream::<f32, _, _>(
                config,
                move |data, _| {
                    let host_ns = host_clock::now_ns();
                    if first_frames.load(Ordering::Relaxed) == 0 {
                        first_frames.store((data.len() / channels.max(1)) as u32, Ordering::Relaxed);
                    }
                    match engine.engine.as_mut() {
                        Some(e) => e.render(host_ns, data, channels),
                        None => data.fill(0.0),
                    }
                },
                on_error,
                None,
            )
        }
        SampleFormat::I16 => build_converting::<i16>(device, config, engine, on_error, first_frames, channels, rate),
        SampleFormat::U16 => build_converting::<u16>(device, config, engine, on_error, first_frames, channels, rate),
        SampleFormat::I32 => build_converting::<i32>(device, config, engine, on_error, first_frames, channels, rate),
        SampleFormat::F64 => build_converting::<f64>(device, config, engine, on_error, first_frames, channels, rate),
        other => Err(cpal::Error::with_message(ErrorKind::UnsupportedConfig, format!("sample format {other:?} is not converted"))),
    }
}

fn build_converting<T>(
    device: &cpal::Device,
    config: StreamConfig,
    engine: EngineBox,
    on_error: impl FnMut(cpal::Error) + Send + 'static,
    first_frames: Arc<AtomicU32>,
    channels: usize,
    rate: u32,
) -> Result<cpal::Stream, cpal::Error>
where
    T: SizedSample + cpal::FromSample<f32>,
{
    let mut engine = engine;
    let channels = channels.max(1);
    let mut scratch = vec![0f32; SCRATCH_SAMPLES - SCRATCH_SAMPLES % channels];
    device.build_output_stream::<T, _, _>(
        config,
        move |data, _| {
            let host_ns = host_clock::now_ns();
            if first_frames.load(Ordering::Relaxed) == 0 {
                first_frames.store((data.len() / channels) as u32, Ordering::Relaxed);
            }
            let Some(e) = engine.engine.as_mut() else {
                data.fill(T::EQUILIBRIUM);
                return;
            };
            let mut done = 0;
            while done < data.len() {
                let n = (data.len() - done).min(scratch.len()) / channels * channels;
                if n == 0 {
                    data[done..].fill(T::EQUILIBRIUM);
                    break;
                }
                // A callback larger than the scratch is rendered in pieces; each piece is stamped with its own
                // offset so the clock fit sees one steady line.
                let at_ns = host_ns + (done / channels) as u64 * 1_000_000_000 / rate as u64;
                e.render(at_ns, &mut scratch[..n], channels);
                for (d, s) in data[done..done + n].iter_mut().zip(&scratch[..n]) {
                    *d = T::from_sample(*s);
                }
                done += n;
            }
        },
        on_error,
        None,
    )
}


#[cfg(test)]
mod tests {
    use super::*;

    fn offer(channels: u16, lo: u32, hi: u32, format: SampleFormat) -> Offer {
        Offer { channels, min_rate: lo, max_rate: hi, format, buffer: None }
    }

    #[test]
    fn prefers_f32_stereo_at_48k() {
        let offers = [
            offer(1, 8000, 96000, SampleFormat::I16),
            offer(2, 8000, 96000, SampleFormat::I16),
            offer(1, 8000, 96000, SampleFormat::F32),
            offer(2, 8000, 96000, SampleFormat::F32),
        ];
        let c = choose_config(&offers, None, 48_000).unwrap();
        assert_eq!((c.channels, c.rate, c.format), (2, 48_000, SampleFormat::F32));
    }

    #[test]
    fn converts_integer_formats_when_f32_is_missing() {
        let c = choose_config(&[offer(2, 44_100, 48_000, SampleFormat::I16)], None, 48_000).unwrap();
        assert_eq!((c.rate, c.format), (48_000, SampleFormat::I16));
    }

    #[test]
    fn falls_back_to_device_default_when_rate_is_not_offered() {
        let default = Choice { channels: 2, rate: 44_100, format: SampleFormat::F32, buffer: None };
        let c = choose_config(&[offer(2, 44_100, 44_100, SampleFormat::F32)], Some(default), 48_000).unwrap();
        assert_eq!(c, default);
    }

    #[test]
    fn unconvertible_default_falls_to_nearest_rate_offer() {
        let default = Choice { channels: 2, rate: 44_100, format: SampleFormat::I8, buffer: None };
        let offers = [offer(2, 44_100, 44_100, SampleFormat::I8), offer(6, 44_100, 44_100, SampleFormat::I16)];
        let c = choose_config(&offers, Some(default), 48_000).unwrap();
        assert_eq!((c.channels, c.rate, c.format), (6, 44_100, SampleFormat::I16));
    }

    #[test]
    fn nothing_convertible_is_none() {
        assert!(choose_config(&[offer(2, 1, 96000, SampleFormat::I8)], None, 48_000).is_none());
    }

    #[test]
    fn transports_follow_the_interface_type() {
        assert_eq!(transport_of(InterfaceType::Usb), Transport::Usb);
        assert_eq!(transport_of(InterfaceType::BuiltIn), Transport::BuiltIn);
        assert_eq!(transport_of(InterfaceType::Bluetooth), Transport::Bluetooth);
        assert_eq!(transport_of(InterfaceType::Unknown), Transport::Unknown);
    }

    #[test]
    fn stream_errors_map_to_events() {
        assert_eq!(event_for(ErrorKind::Xrun), Some(DeviceEvent::Xrun(StreamKind::Output)));
        assert_eq!(event_for(ErrorKind::DeviceNotAvailable), Some(DeviceEvent::Interruption(InterruptionReason::DeviceChange)));
        assert_eq!(event_for(ErrorKind::BackendError), Some(DeviceEvent::Interruption(InterruptionReason::Interrupted)));
        assert_eq!(event_for(ErrorKind::RealtimeDenied), None);
    }

    #[test]
    fn default_buffer_request_is_the_platforms() {
        assert_eq!(requested_buffer(&OpenConfig { buffer_frames: Some(64), ..OpenConfig::default() }), Some(64));
    }
}
