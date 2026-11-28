//! Latency parts, transport, device identity and clock relation on macOS (design section 5), read from
//! CoreAudio device properties.
//!
//! Two layers:
//! * Pure (built and tested on every platform): [`DeviceFacts`], what one device says about itself in one
//!   direction, and the maths that turns two of them into [`LatencyParts`], [`Transport`]s and a
//!   [`ClockRelation`].
//! * `hal` (macOS only): the property reads. All `unsafe` of this module is there.
//!
//! Fail soft: a property that cannot be read is `None`, a device that cannot be found gives `None`, and a part
//! without a source stays null. Nothing here is estimated. **Implemented, not yet verified on hardware.**
//!
//! What the properties mean (frames at the device's nominal rate):
//! * `kAudioDevicePropertyBufferFrameSize`: the IO buffer this process runs the device with.
//! * `kAudioDevicePropertySafetyOffset`: how far ahead of (output) or behind (input) the hardware position the
//!   system keeps the IO buffer.
//! * `kAudioDevicePropertyLatency`: the device's own delay (converters, DSP).
//! * `kAudioStreamPropertyLatency`: extra delay of the first stream of that direction.

use sr_audio_core::capture::ClockRelation;
use sr_audio_core::latency::{LatencyParts, Transport};

/// What one device reports for one direction. Every field is `None` when the property could not be read.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct DeviceFacts {
    /// `kAudioDevicePropertyDeviceUID`: stable across restarts and replugging.
    pub uid: Option<String>,
    /// `kAudioDevicePropertyTransportType`, the raw four-character code.
    pub transport_code: Option<u32>,
    /// `kAudioDevicePropertyNominalSampleRate`, Hz.
    pub nominal_rate: Option<f64>,
    /// `kAudioDevicePropertyBufferFrameSize`, frames.
    pub buffer_frames: Option<u32>,
    /// `kAudioDevicePropertyLatency` in this direction's scope, frames.
    pub device_latency_frames: Option<u32>,
    /// `kAudioDevicePropertySafetyOffset` in this direction's scope, frames.
    pub safety_offset_frames: Option<u32>,
    /// `kAudioStreamPropertyLatency` of the first stream of this direction, frames.
    pub stream_latency_frames: Option<u32>,
    /// `kAudioDevicePropertyClockDomain`: devices with the same non-zero value run from one clock.
    pub clock_domain: Option<u32>,
}

const fn fourcc(code: &[u8; 4]) -> u32 {
    u32::from_be_bytes(*code)
}

/// `kAudioDeviceTransportTypeAggregate`.
pub const TRANSPORT_AGGREGATE: u32 = fourcc(b"grup");

/// Our transport for a `kAudioDeviceTransportType*` code. Codes without a clear meaning for latency (virtual,
/// aggregate, automatic aggregate, unknown, anything new) are `Unknown`, which the trust rules treat as C.
pub fn transport_from_code(code: u32) -> Transport {
    match &code.to_be_bytes() {
        b"bltn" => Transport::BuiltIn,
        // PCI, USB, FireWire, Thunderbolt: wired digital interfaces.
        b"pci " | b"usb " | b"1394" | b"thun" => Transport::Usb,
        b"blue" | b"blea" => Transport::Bluetooth,
        b"hdmi" | b"dprt" => Transport::Hdmi,
        // AirPlay, AVB, and Continuity capture (a phone used as a microphone, wired or wireless).
        b"airp" | b"eavb" | b"ccwd" | b"ccwl" => Transport::Network,
        _ => Transport::Unknown,
    }
}

impl DeviceFacts {
    /// The transport, `Unknown` when the code is missing.
    pub fn transport(&self) -> Transport {
        self.transport_code.map_or(Transport::Unknown, transport_from_code)
    }

    fn secs(&self, frames: Option<u32>, fallback_rate: u32) -> Option<f64> {
        let rate = self.nominal_rate.filter(|r| r.is_finite() && *r >= 1000.0).unwrap_or(fallback_rate as f64);
        if rate >= 1000.0 {
            frames.map(|f| f as f64 / rate)
        } else {
            None
        }
    }
}

/// The latency parts of a route. `stream_out_frames` / `stream_in_frames` are the buffer sizes the streams
/// actually settled on (used when the device did not report its buffer), `out_rate` / `in_rate` the stream
/// rates (used when the device did not report its nominal rate). A direction without facts keeps only its
/// buffer part, which alone never sums to a reported latency.
pub fn parts(out: Option<&DeviceFacts>, input: Option<&DeviceFacts>, stream_out_frames: u32, out_rate: u32, stream_in: Option<(u32, u32)>) -> LatencyParts {
    let none = DeviceFacts::default();
    let nonzero = |n: u32| (n > 0).then_some(n);
    let mut p = LatencyParts::default();
    let o = out.unwrap_or(&none);
    p.out_buffer = o.secs(o.buffer_frames.or(nonzero(stream_out_frames)), out_rate);
    p.out_device = o.secs(o.device_latency_frames, out_rate);
    p.out_safety = o.secs(o.safety_offset_frames, out_rate);
    p.out_stream = o.secs(o.stream_latency_frames, out_rate);
    if let Some((frames, rate)) = stream_in {
        let i = input.unwrap_or(&none);
        p.in_buffer = i.secs(i.buffer_frames.or(nonzero(frames)), rate);
        p.in_device = i.secs(i.device_latency_frames, rate);
        p.in_safety = i.secs(i.safety_offset_frames, rate);
        p.in_stream = i.secs(i.stream_latency_frames, rate);
    }
    p
}

/// Whether the two streams run from one clock: the same device (which includes an aggregate device used for
/// both directions; the system keeps its sub-devices together), or two devices that declare the same non-zero
/// clock domain. Everything else is `Unknown` and left to measurement; this function never says `Separate`.
pub fn relation(out: Option<&DeviceFacts>, input: Option<&DeviceFacts>) -> ClockRelation {
    let (Some(o), Some(i)) = (out, input) else { return ClockRelation::Unknown };
    let same_device = matches!((&o.uid, &i.uid), (Some(a), Some(b)) if !a.is_empty() && a == b);
    let same_domain = matches!((o.clock_domain, i.clock_domain), (Some(a), Some(b)) if a != 0 && a == b);
    if same_device || same_domain {
        ClockRelation::Shared
    } else {
        ClockRelation::Unknown
    }
}

/// The facts of the device with this UID (`kAudioDevicePropertyDeviceUID`, the bare id of cpal's device id)
/// for one direction. `None` when no device has that UID: there is no fallback to the default device, whose
/// facts would be reported for a stream that may run on another one.
#[cfg(target_os = "macos")]
pub fn query(uid: &str, input: bool) -> Option<DeviceFacts> {
    hal::device_by_uid(uid).map(|id| hal::facts(id, input))
}

/// The facts of the system default device of one direction.
#[cfg(target_os = "macos")]
pub fn query_default(input: bool) -> Option<DeviceFacts> {
    hal::default_device(input).map(|id| hal::facts(id, input))
}

#[cfg(target_os = "macos")]
mod hal {
    //! CoreAudio property reads. Every function checks the status and the size written before it trusts a
    //! value, and returns `None` otherwise.

    use std::ffi::c_void;
    use std::mem::{size_of, MaybeUninit};
    use std::ptr::{null, NonNull};

    use objc2_core_audio::{
        kAudioDevicePropertyBufferFrameSize, kAudioDevicePropertyClockDomain, kAudioDevicePropertyDeviceUID, kAudioDevicePropertyLatency, kAudioDevicePropertyNominalSampleRate,
        kAudioDevicePropertySafetyOffset, kAudioDevicePropertyStreams, kAudioDevicePropertyTransportType, kAudioHardwarePropertyDefaultInputDevice,
        kAudioHardwarePropertyDefaultOutputDevice, kAudioHardwarePropertyDevices, kAudioObjectPropertyElementMain, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyScopeInput,
        kAudioObjectPropertyScopeOutput, kAudioObjectSystemObject, kAudioStreamPropertyLatency, AudioObjectGetPropertyData, AudioObjectGetPropertyDataSize, AudioObjectID,
        AudioObjectPropertyAddress,
    };
    use objc2_core_foundation::{CFRetained, CFString};

    use super::DeviceFacts;

    const SYSTEM: AudioObjectID = kAudioObjectSystemObject as AudioObjectID;
    /// `kAudioObjectUnknown`.
    const UNKNOWN: AudioObjectID = 0;

    fn address(selector: u32, scope: u32) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress { mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain }
    }

    /// Plain-data property types this module reads.
    trait Plain: Copy {}
    impl Plain for u32 {}
    impl Plain for f64 {}

    /// Reads a fixed-size plain-data property.
    fn get<T: Plain>(object: AudioObjectID, selector: u32, scope: u32) -> Option<T> {
        let addr = address(selector, scope);
        let mut size = size_of::<T>() as u32;
        let mut value = MaybeUninit::<T>::zeroed();
        // SAFETY: `addr`, `size` and `value` are live locals; `size` holds the capacity of `value`, so CoreAudio
        // writes at most `size_of::<T>()` bytes into it. No qualifier is passed.
        let status = unsafe { AudioObjectGetPropertyData(object, NonNull::from(&addr), 0, null(), NonNull::from(&mut size), NonNull::from(&mut value).cast::<c_void>()) };
        if status == 0 && size as usize == size_of::<T>() {
            // SAFETY: the call succeeded and wrote exactly `size_of::<T>()` bytes; `T` is plain data (u32 or
            // f64) for which every bit pattern is valid, and the storage was zeroed first.
            Some(unsafe { value.assume_init() })
        } else {
            None
        }
    }

    /// Reads a property that is a list of object ids.
    fn get_ids(object: AudioObjectID, selector: u32, scope: u32) -> Vec<AudioObjectID> {
        let addr = address(selector, scope);
        let mut size = 0u32;
        // SAFETY: `addr` and `size` are live locals; the call only writes `size`.
        let status = unsafe { AudioObjectGetPropertyDataSize(object, NonNull::from(&addr), 0, null(), NonNull::from(&mut size)) };
        let count = size as usize / size_of::<AudioObjectID>();
        if status != 0 || count == 0 || count > 4096 {
            return Vec::new();
        }
        let mut ids = vec![UNKNOWN; count];
        let mut size = (count * size_of::<AudioObjectID>()) as u32;
        let Some(out) = NonNull::new(ids.as_mut_ptr()) else { return Vec::new() };
        // SAFETY: `ids` has room for `size` bytes and CoreAudio writes at most `size` bytes, updating `size`
        // to what it wrote (the list can have shrunk since the size query, never past the capacity given).
        let status = unsafe { AudioObjectGetPropertyData(object, NonNull::from(&addr), 0, null(), NonNull::from(&mut size), out.cast::<c_void>()) };
        if status != 0 {
            return Vec::new();
        }
        ids.truncate(size as usize / size_of::<AudioObjectID>());
        ids
    }

    /// Reads a string property (returned by CoreAudio with a +1 reference, which is released here).
    fn get_string(object: AudioObjectID, selector: u32) -> Option<String> {
        let addr = address(selector, kAudioObjectPropertyScopeGlobal);
        let mut value: *mut CFString = std::ptr::null_mut();
        let mut size = size_of::<*mut CFString>() as u32;
        // SAFETY: for a CFString property CoreAudio writes one pointer into `value` (`size` is its capacity).
        let status = unsafe { AudioObjectGetPropertyData(object, NonNull::from(&addr), 0, null(), NonNull::from(&mut size), NonNull::from(&mut value).cast::<c_void>()) };
        if status != 0 || size as usize != size_of::<*mut CFString>() {
            return None;
        }
        let ptr = NonNull::new(value)?;
        // SAFETY: the call succeeded, so `ptr` is a valid CFString that we own one reference to (the create
        // rule applies to property data); `CFRetained` releases it when dropped.
        let string = unsafe { CFRetained::from_raw(ptr) };
        Some(string.to_string())
    }

    pub(super) fn default_device(input: bool) -> Option<AudioObjectID> {
        let selector = if input { kAudioHardwarePropertyDefaultInputDevice } else { kAudioHardwarePropertyDefaultOutputDevice };
        get::<u32>(SYSTEM, selector, kAudioObjectPropertyScopeGlobal).filter(|id| *id != UNKNOWN)
    }

    pub(super) fn device_by_uid(uid: &str) -> Option<AudioObjectID> {
        if uid.is_empty() {
            return None;
        }
        get_ids(SYSTEM, kAudioHardwarePropertyDevices, kAudioObjectPropertyScopeGlobal).into_iter().find(|id| get_string(*id, kAudioDevicePropertyDeviceUID).as_deref() == Some(uid))
    }

    pub(super) fn facts(device: AudioObjectID, input: bool) -> DeviceFacts {
        let scope = if input { kAudioObjectPropertyScopeInput } else { kAudioObjectPropertyScopeOutput };
        let global = kAudioObjectPropertyScopeGlobal;
        let first_stream = get_ids(device, kAudioDevicePropertyStreams, scope).into_iter().next();
        DeviceFacts {
            uid: get_string(device, kAudioDevicePropertyDeviceUID),
            transport_code: get::<u32>(device, kAudioDevicePropertyTransportType, global),
            nominal_rate: get::<f64>(device, kAudioDevicePropertyNominalSampleRate, global).filter(|r| r.is_finite() && *r > 0.0),
            buffer_frames: get::<u32>(device, kAudioDevicePropertyBufferFrameSize, global),
            device_latency_frames: get::<u32>(device, kAudioDevicePropertyLatency, scope),
            safety_offset_frames: get::<u32>(device, kAudioDevicePropertySafetyOffset, scope),
            stream_latency_frames: first_stream.and_then(|s| get::<u32>(s, kAudioStreamPropertyLatency, global)),
            clock_domain: get::<u32>(device, kAudioDevicePropertyClockDomain, global),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sr_audio_core::latency::{LatencyReport, Platform, RouteTrustFacts, TrustClass};

    fn built_in(uid: &str, domain: u32) -> DeviceFacts {
        DeviceFacts {
            uid: Some(uid.into()),
            transport_code: Some(fourcc(b"bltn")),
            nominal_rate: Some(48_000.0),
            buffer_frames: Some(128),
            device_latency_frames: Some(22),
            safety_offset_frames: Some(59),
            stream_latency_frames: Some(0),
            clock_domain: Some(domain),
        }
    }

    #[test]
    fn transport_codes() {
        let t = |c: &[u8; 4]| transport_from_code(fourcc(c));
        assert_eq!(fourcc(b"bltn"), 0x626c_746e, "the value of kAudioDeviceTransportTypeBuiltIn");
        assert_eq!(t(b"bltn"), Transport::BuiltIn);
        assert_eq!((t(b"usb "), t(b"thun"), t(b"1394"), t(b"pci ")), (Transport::Usb, Transport::Usb, Transport::Usb, Transport::Usb));
        assert_eq!((t(b"blue"), t(b"blea")), (Transport::Bluetooth, Transport::Bluetooth));
        assert_eq!((t(b"hdmi"), t(b"dprt")), (Transport::Hdmi, Transport::Hdmi));
        assert_eq!((t(b"airp"), t(b"eavb"), t(b"ccwl")), (Transport::Network, Transport::Network, Transport::Network));
        assert_eq!((t(b"virt"), t(b"grup"), t(b"fgrp"), t(b"\0\0\0\0"), t(b"zzzz")), (Transport::Unknown, Transport::Unknown, Transport::Unknown, Transport::Unknown, Transport::Unknown));
        assert_eq!(DeviceFacts::default().transport(), Transport::Unknown);
        assert_eq!(TRANSPORT_AGGREGATE, 0x6772_7570);
    }

    #[test]
    fn parts_come_only_from_what_was_read() {
        let (o, i) = (built_in("out", 1), DeviceFacts { device_latency_frames: Some(114), safety_offset_frames: Some(12), stream_latency_frames: None, ..built_in("in", 1) });
        let p = parts(Some(&o), Some(&i), 128, 48_000, Some((128, 48_000)));
        assert_eq!(p.out_buffer, Some(128.0 / 48_000.0));
        assert_eq!((p.out_device, p.out_safety, p.out_stream), (Some(22.0 / 48_000.0), Some(59.0 / 48_000.0), Some(0.0)));
        assert_eq!((p.in_device, p.in_safety, p.in_stream), (Some(114.0 / 48_000.0), Some(12.0 / 48_000.0), None));
        assert!((p.output_sec().unwrap() - 209.0 / 48_000.0).abs() < 1e-15);
        assert!((p.input_sec().unwrap() - 254.0 / 48_000.0).abs() < 1e-15);

        // No facts: only the stream's own buffer is known, and that alone is not a reported latency.
        let p = parts(None, None, 128, 48_000, Some((256, 44_100)));
        assert_eq!((p.out_buffer, p.in_buffer), (Some(128.0 / 48_000.0), Some(256.0 / 44_100.0)));
        assert_eq!((p.out_device, p.out_safety, p.out_stream, p.in_device), (None, None, None, None));
        assert_eq!((p.output_sec(), p.input_sec()), (None, None));
        // No input stream: no input parts at all. Nothing known: nothing reported.
        let p = parts(Some(&o), Some(&i), 128, 48_000, None);
        assert_eq!((p.in_buffer, p.in_device, p.in_safety), (None, None, None));
        assert_eq!(parts(None, None, 0, 48_000, None), LatencyParts::default());
        // Frames are at the device's nominal rate; a missing or absurd rate falls back to the stream rate.
        let odd = DeviceFacts { nominal_rate: Some(44_100.0), ..o.clone() };
        assert_eq!(parts(Some(&odd), None, 128, 48_000, None).out_device, Some(22.0 / 44_100.0));
        let no_rate = DeviceFacts { nominal_rate: Some(f64::NAN), ..o.clone() };
        assert_eq!(parts(Some(&no_rate), None, 128, 48_000, None).out_device, Some(22.0 / 48_000.0));
        assert_eq!(parts(Some(&no_rate), None, 128, 0, None), LatencyParts::default());
    }

    #[test]
    fn clock_relation_rules() {
        let (a, b) = (built_in("A", 7), built_in("B", 7));
        assert_eq!(relation(Some(&a), Some(&a)), ClockRelation::Shared, "one device");
        assert_eq!(relation(Some(&a), Some(&b)), ClockRelation::Shared, "one non-zero clock domain");
        assert_eq!(relation(Some(&built_in("A", 0)), Some(&built_in("B", 0))), ClockRelation::Unknown, "domain 0 says nothing");
        assert_eq!(relation(Some(&a), Some(&built_in("B", 8))), ClockRelation::Unknown);
        assert_eq!(relation(Some(&a), None), ClockRelation::Unknown);
        assert_eq!(relation(None, Some(&a)), ClockRelation::Unknown);
        let anonymous = DeviceFacts { uid: Some(String::new()), clock_domain: None, ..DeviceFacts::default() };
        assert_eq!(relation(Some(&anonymous), Some(&anonymous)), ClockRelation::Unknown, "an empty UID identifies nothing");
        // An aggregate device used for both directions is one device to this process.
        let agg = DeviceFacts { transport_code: Some(TRANSPORT_AGGREGATE), ..built_in("agg", 0) };
        assert_eq!(relation(Some(&agg), Some(&agg)), ClockRelation::Shared);
        assert_eq!(agg.transport(), Transport::Unknown);
    }

    #[test]
    fn built_in_route_is_trust_a_and_predicts_its_round_trip() {
        let (o, i) = (built_in("out", 1), built_in("in", 1));
        let p = parts(Some(&o), Some(&i), 128, 48_000, Some((128, 48_000)));
        let facts = RouteTrustFacts { platform: Platform::MacOs, output_transport: o.transport(), input_transport: Some(i.transport()), direct_hardware: false, low_latency_feature: false };
        let r = LatencyReport::new(p, &facts);
        assert_eq!(r.trust, TrustClass::A);
        assert!((r.predicted_round_trip_ms().unwrap() - 2.0 * 209.0 / 48.0).abs() < 1e-9);
    }

    /// Runs on a macOS machine or CI runner, with or without audio devices: the property reads must not
    /// crash, and whatever they return must be null or sane. Prints what was found.
    #[cfg(target_os = "macos")]
    #[test]
    fn macos_default_devices_report_sane_values() {
        let (out, input) = (query_default(false), query_default(true));
        println!("macOS default output device: {out:?}");
        println!("macOS default input device: {input:?}");
        for facts in [&out, &input].into_iter().flatten() {
            assert!(facts.nominal_rate.is_none_or(|r| r.is_finite() && r > 0.0));
            for frames in [facts.buffer_frames, facts.device_latency_frames, facts.safety_offset_frames, facts.stream_latency_frames].into_iter().flatten() {
                assert!(frames < 10_000_000, "a frame count, not garbage: {frames}");
            }
            // A device that exists can be found again by its UID.
            if let Some(uid) = facts.uid.as_deref().filter(|u| !u.is_empty()) {
                let again = query(uid, false).or_else(|| query(uid, true)).expect("found by UID");
                assert_eq!(again.uid.as_deref(), Some(uid));
            }
        }
        let p = parts(out.as_ref(), input.as_ref(), 0, 48_000, input.as_ref().map(|_| (0, 48_000)));
        println!("macOS latency parts: {p:?}; output {:?} s, input {:?} s; relation {:?}", p.output_sec(), p.input_sec(), relation(out.as_ref(), input.as_ref()));
        for part in [p.out_buffer, p.out_device, p.out_safety, p.out_stream, p.in_buffer, p.in_device, p.in_safety, p.in_stream].into_iter().flatten() {
            assert!(part.is_finite() && (0.0..10.0).contains(&part), "null or finite and not negative: {part}");
        }
        // An unknown UID, and cpal's display form of a known one, find nothing: no fallback to the default.
        assert_eq!(query("no-such-device-uid", false), None);
        assert_eq!(query("", true), None);
        if let Some(uid) = out.as_ref().and_then(|o| o.uid.clone()) {
            assert_eq!(query(&format!("coreaudio:{uid}"), false), None);
        }
    }
}
