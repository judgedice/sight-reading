//! Latency parts and endpoint identity on Windows (design section 5), read from WASAPI.
//!
//! Two layers, as in `latency_macos`: pure maths over [`EndpointFacts`] (built and tested everywhere) and the
//! COM calls in `wasapi` (Windows only, all `unsafe` of this module).
//!
//! What is read, per direction, from the endpoint the stream uses (by id, else the default endpoint):
//! * `IAudioClient::GetDevicePeriod`: the shared-mode engine period, reported as the buffer part.
//! * `IAudioClient::GetStreamLatency` on a client of our own, initialised in shared mode with the mix format
//!   and never started: reported as the stream part. It does not include driver or audio-enhancement delay,
//!   which is why Windows is trust class B at best.
//! * `IMMDevice::GetId`: the endpoint id.
//!
//! The clock relation is always `Unknown` here: WASAPI does not say whether a render and a capture endpoint
//! share an adapter clock in a way we could verify, so the capture path is chosen by measurement.
//!
//! Fail soft: any failing call leaves its value `None`. Nothing is estimated. **Implemented, not yet verified
//! on hardware.**

use sr_audio_core::capture::ClockRelation;
use sr_audio_core::latency::LatencyParts;

/// What one endpoint reports. Times are in WASAPI's 100-nanosecond units.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct EndpointFacts {
    /// `IMMDevice::GetId`.
    pub id: Option<String>,
    /// `GetDevicePeriod`, default (shared-mode) period, 100 ns units.
    pub period_hns: Option<i64>,
    /// `GetStreamLatency`, 100 ns units.
    pub stream_latency_hns: Option<i64>,
}

fn secs(hns: Option<i64>) -> Option<f64> {
    // More than 10 s is not a latency; a negative or zero period is not a period.
    hns.filter(|h| (0..=100_000_000).contains(h)).map(|h| h as f64 * 1e-7)
}

/// The latency parts of a route. `input` is `None` while no input stream is open.
pub fn parts(out: Option<&EndpointFacts>, input: Option<&EndpointFacts>) -> LatencyParts {
    let mut p = LatencyParts::default();
    if let Some(o) = out {
        p.out_buffer = secs(o.period_hns.filter(|h| *h > 0));
        p.out_stream = secs(o.stream_latency_hns);
    }
    if let Some(i) = input {
        p.in_buffer = secs(i.period_hns.filter(|h| *h > 0));
        p.in_stream = secs(i.stream_latency_hns);
    }
    p
}

/// Always `Unknown` (see the module text).
pub fn relation(_out: Option<&EndpointFacts>, _input: Option<&EndpointFacts>) -> ClockRelation {
    ClockRelation::Unknown
}

/// The facts of the endpoint with this id (as cpal's device id gives it), else of the default endpoint of
/// that direction. `None` when there is none or COM is unavailable.
#[cfg(target_os = "windows")]
pub fn query(id: &str, input: bool) -> Option<EndpointFacts> {
    wasapi::query(id, input)
}

#[cfg(target_os = "windows")]
mod wasapi {
    //! The COM calls. Every interface pointer is owned by a `windows` crate wrapper and released on drop;
    //! memory handed out by COM is freed with `CoTaskMemFree` on every path.

    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Media::Audio::{eCapture, eConsole, eRender, IAudioClient, IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator, AUDCLNT_SHAREMODE_SHARED};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED};

    use super::EndpointFacts;

    /// Balances a successful `CoInitializeEx` on this thread.
    struct ComGuard(bool);

    impl Drop for ComGuard {
        fn drop(&mut self) {
            if self.0 {
                // SAFETY: paired with the successful CoInitializeEx of this guard, on the same thread.
                unsafe { CoUninitialize() };
            }
        }
    }

    pub(super) fn query(id: &str, input: bool) -> Option<EndpointFacts> {
        // SAFETY: plain COM initialisation of the calling thread. A failure (the thread already runs another
        // apartment model) still leaves COM usable for these calls, so it is not an error here; only a
        // success is balanced by the guard.
        let _com = ComGuard(unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok());
        // SAFETY: standard activation of the device enumerator; the result is an owned interface pointer.
        let enumerator: IMMDeviceEnumerator = unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }.ok()?;
        let by_id = if id.is_empty() {
            None
        } else {
            let wide = HSTRING::from(id);
            // SAFETY: `wide` is a valid, NUL-terminated wide string that outlives the call.
            unsafe { enumerator.GetDevice(PCWSTR(wide.as_ptr())) }.ok()
        };
        let device: IMMDevice = match by_id {
            Some(d) => d,
            // SAFETY: plain COM call on a live enumerator.
            None => unsafe { enumerator.GetDefaultAudioEndpoint(if input { eCapture } else { eRender }, eConsole) }.ok()?,
        };
        let mut facts = EndpointFacts::default();
        // SAFETY: GetId returns a CoTaskMem-allocated, NUL-terminated wide string that we must free.
        if let Ok(pwstr) = unsafe { device.GetId() } {
            // SAFETY: `pwstr` is the valid string just returned; it is read before being freed, once.
            unsafe {
                facts.id = pwstr.to_string().ok();
                CoTaskMemFree(Some(pwstr.0 as *const _));
            }
        }
        // SAFETY: activation of an audio client on a live endpoint; no activation parameters.
        let Ok(client) = (unsafe { device.Activate::<IAudioClient>(CLSCTX_ALL, None) }) else { return Some(facts) };
        let mut period = 0i64;
        // SAFETY: `period` is a live local the call writes one REFERENCE_TIME into.
        if unsafe { client.GetDevicePeriod(Some(&mut period), None) }.is_ok() {
            facts.period_hns = Some(period);
        }
        // SAFETY: GetMixFormat returns a CoTaskMem-allocated WAVEFORMATEX; it is passed unchanged to
        // Initialize (shared mode, default buffer, no flags, never started) and freed on every path below.
        if let Ok(format) = unsafe { client.GetMixFormat() } {
            if !format.is_null() {
                // SAFETY: `format` is the valid mix format; the client is initialised at most once.
                unsafe {
                    if client.Initialize(AUDCLNT_SHAREMODE_SHARED, 0, 0, 0, format, None).is_ok() {
                        facts.stream_latency_hns = client.GetStreamLatency().ok();
                    }
                    CoTaskMemFree(Some(format as *const _));
                }
            }
        }
        Some(facts)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parts_come_only_from_what_was_read() {
        let out = EndpointFacts { id: Some("{0.0.0.00000000}.{a}".into()), period_hns: Some(100_000), stream_latency_hns: Some(107_000) };
        let input = EndpointFacts { id: Some("{0.0.1.00000000}.{b}".into()), period_hns: Some(100_000), stream_latency_hns: None };
        let p = parts(Some(&out), Some(&input));
        assert_eq!((p.out_buffer, p.out_stream), (Some(0.01), Some(107_000.0 * 1e-7)));
        assert!((p.output_sec().unwrap() - 0.0207).abs() < 1e-12);
        assert_eq!((p.in_buffer, p.in_stream, p.input_sec()), (Some(0.01), None, None), "a period alone is not a reported latency");
        assert_eq!((p.out_device, p.out_safety, p.in_device, p.in_safety), (None, None, None, None));
        assert_eq!(parts(None, None), LatencyParts::default());
        assert_eq!(parts(Some(&out), None).in_buffer, None);
        // Values that cannot be right are dropped, not passed on.
        let bad = EndpointFacts { id: None, period_hns: Some(0), stream_latency_hns: Some(-5) };
        assert_eq!(parts(Some(&bad), Some(&bad)), LatencyParts::default());
        let huge = EndpointFacts { id: None, period_hns: Some(100_000), stream_latency_hns: Some(i64::MAX) };
        assert_eq!(parts(Some(&huge), None).out_stream, None);
        // A zero stream latency is a value (the engine adds nothing), not a missing one.
        let zero = EndpointFacts { stream_latency_hns: Some(0), ..out.clone() };
        assert_eq!(parts(Some(&zero), None).output_sec(), Some(0.01));
        assert_eq!(relation(Some(&out), Some(&input)), ClockRelation::Unknown);
        assert_eq!(relation(Some(&out), Some(&out)), ClockRelation::Unknown);
    }

    /// Runs on a Windows machine or CI runner, with or without audio endpoints: the COM calls must not
    /// crash, and whatever they return must be null or sane. Prints what was found.
    #[cfg(target_os = "windows")]
    #[test]
    fn windows_default_endpoints_report_sane_values() {
        let (out, input) = (query("", false), query("", true));
        println!("Windows default render endpoint: {out:?}");
        println!("Windows default capture endpoint: {input:?}");
        let p = parts(out.as_ref(), input.as_ref());
        println!("Windows latency parts: {p:?}; output {:?} s, input {:?} s", p.output_sec(), p.input_sec());
        for part in [p.out_buffer, p.out_stream, p.in_buffer, p.in_stream].into_iter().flatten() {
            assert!(part.is_finite() && (0.0..=10.0).contains(&part));
        }
        // An endpoint that exists is found again by its id; an unknown id falls back to the default.
        if let Some(id) = out.as_ref().and_then(|o| o.id.clone()) {
            assert_eq!(query(&id, false).and_then(|o| o.id), Some(id));
        }
        assert_eq!(query("no-such-endpoint", false).is_some(), out.is_some());
    }
}
