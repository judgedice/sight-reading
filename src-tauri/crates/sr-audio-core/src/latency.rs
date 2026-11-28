//! Reported latency (design section 5): the parts a platform reports, their sums, how far to trust them, and
//! the round trip they predict. Pure arithmetic; the device layer fills [`LatencyParts`] and [`RouteTrustFacts`].

/// The parts of the reported latency, each in seconds, `None` when the platform does not report it.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct LatencyParts {
    /// Output buffer (the callback period, or the device period), seconds.
    pub out_buffer: Option<f64>,
    /// Output device latency (CoreAudio device latency, `AVAudioSession.outputLatency`, ALSA delay), seconds.
    pub out_device: Option<f64>,
    /// Output safety offset, seconds.
    pub out_safety: Option<f64>,
    /// Output stream latency (CoreAudio stream latency, `IAudioClient::GetStreamLatency`, AAudio timestamp
    /// delay), seconds.
    pub out_stream: Option<f64>,
    /// Input buffer, seconds.
    pub in_buffer: Option<f64>,
    /// Input device latency, seconds.
    pub in_device: Option<f64>,
    /// Input safety offset, seconds.
    pub in_safety: Option<f64>,
    /// Input stream latency, seconds.
    pub in_stream: Option<f64>,
}

/// Sum of one side. A side is reported only when its buffer part and at least one of its device and stream
/// parts are known and every known part is finite and not negative: every platform of design section 5
/// reports at least those two, and a buffer length alone would pass for a (far too small) latency. The safety
/// offset is added when known.
fn side_sum(buffer: Option<f64>, device: Option<f64>, safety: Option<f64>, stream: Option<f64>) -> Option<f64> {
    let parts = [buffer, device, safety, stream];
    if parts.iter().flatten().any(|x| !x.is_finite() || *x < 0.0) {
        return None;
    }
    if buffer.is_none() || (device.is_none() && stream.is_none()) {
        return None;
    }
    Some(parts.iter().flatten().sum())
}

impl LatencyParts {
    /// Reported output latency, seconds; `None` when a required part is missing.
    pub fn output_sec(&self) -> Option<f64> {
        side_sum(self.out_buffer, self.out_device, self.out_safety, self.out_stream)
    }

    /// Reported input latency, seconds; `None` when a required part is missing.
    pub fn input_sec(&self) -> Option<f64> {
        side_sum(self.in_buffer, self.in_device, self.in_safety, self.in_stream)
    }
}

/// How far a reported latency can be trusted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum TrustClass {
    /// Complete: the report covers the whole path of the route.
    A,
    /// Partial: driver, enhancement or device-internal delay may be missing.
    B,
    /// Not usable: nothing reported, or a route whose delay the OS does not know (Bluetooth, AirPlay, HDMI).
    C,
}

impl TrustClass {
    /// The wire letter, `"A"`, `"B"` or `"C"`.
    pub fn as_str(self) -> &'static str {
        match self {
            TrustClass::A => "A",
            TrustClass::B => "B",
            TrustClass::C => "C",
        }
    }
}

/// How a device is attached, as the OS reports it (never guessed from labels).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Transport {
    /// Built-in speakers or microphone.
    BuiltIn,
    /// Analogue jack.
    Wired,
    /// USB (also Thunderbolt and other wired digital audio interfaces).
    Usb,
    /// Bluetooth, any profile.
    Bluetooth,
    /// HDMI or DisplayPort.
    Hdmi,
    /// Network audio (AirPlay and the like).
    Network,
    /// The OS did not say.
    Unknown,
}

impl Transport {
    /// The wire name of design section 3.
    pub fn as_str(self) -> &'static str {
        match self {
            Transport::BuiltIn => "built-in",
            Transport::Wired => "wired",
            Transport::Usb => "usb",
            Transport::Bluetooth => "bluetooth",
            Transport::Hdmi => "hdmi",
            Transport::Network => "network",
            Transport::Unknown => "unknown",
        }
    }

    /// True for routes with a short, fixed path the OS can account for.
    fn direct(self) -> bool {
        matches!(self, Transport::BuiltIn | Transport::Wired | Transport::Usb)
    }
}

/// The platform whose latency properties were read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    /// macOS (CoreAudio device properties).
    MacOs,
    /// iOS and iPadOS (`AVAudioSession`).
    Ios,
    /// Windows (WASAPI).
    Windows,
    /// Linux (ALSA, directly or through a sound server).
    Linux,
    /// Android (AAudio).
    Android,
}

/// The facts about a route that decide its trust class.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RouteTrustFacts {
    /// Platform the report comes from.
    pub platform: Platform,
    /// Transport of the output device.
    pub output_transport: Transport,
    /// Transport of the input device; `None` when no input is open.
    pub input_transport: Option<Transport>,
    /// Linux only: both streams are on `hw:` devices (not through PipeWire or PulseAudio).
    pub direct_hardware: bool,
    /// Android only: the device declares the pro-audio or the low-latency feature.
    pub low_latency_feature: bool,
}

/// Trust class of a route (the table of design section 5). `output_reported` is whether an output latency
/// could be summed at all. The worse of the two transports decides.
pub fn classify_trust(facts: &RouteTrustFacts, output_reported: bool) -> TrustClass {
    if !output_reported {
        return TrustClass::C;
    }
    let direct = facts.output_transport.direct() && facts.input_transport.map_or(true, Transport::direct);
    if !direct {
        return TrustClass::C;
    }
    match facts.platform {
        Platform::MacOs | Platform::Ios => TrustClass::A,
        Platform::Windows => TrustClass::B,
        Platform::Linux => {
            if facts.direct_hardware {
                TrustClass::B
            } else {
                TrustClass::C
            }
        }
        Platform::Android => {
            if facts.low_latency_feature {
                TrustClass::B
            } else {
                TrustClass::C
            }
        }
    }
}

/// The `LatencyReport` of design section 3.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LatencyReport {
    /// Reported output latency, seconds; `None` when not reported.
    pub output_sec: Option<f64>,
    /// Reported input latency, seconds; `None` when not reported.
    pub input_sec: Option<f64>,
    /// How far the sums can be trusted.
    pub trust: TrustClass,
    /// The parts the sums were made from, seconds.
    pub parts: LatencyParts,
}

impl LatencyReport {
    /// Sums `parts` and classifies the route.
    pub fn new(parts: LatencyParts, facts: &RouteTrustFacts) -> Self {
        let output_sec = parts.output_sec();
        LatencyReport { output_sec, input_sec: parts.input_sec(), trust: classify_trust(facts, output_sec.is_some()), parts }
    }

    /// A report for a route about which nothing is known (trust C).
    pub fn unreported() -> Self {
        LatencyReport { output_sec: None, input_sec: None, trust: TrustClass::C, parts: LatencyParts::default() }
    }

    /// Predicted round trip, milliseconds: `(output + input) * 1000`. `None` unless both sides are reported.
    /// It leaves out the acoustic path and anything the OS does not know, so it is a cross-check, never a
    /// calibration.
    pub fn predicted_round_trip_ms(&self) -> Option<f64> {
        Some((self.output_sec? + self.input_sec?) * 1000.0)
    }

    /// Output latency for `audibleNow()` and `reportedLatencySec`: the sum for trust A and B, `None` for C.
    pub fn usable_output_sec(&self) -> Option<f64> {
        if self.trust == TrustClass::C {
            None
        } else {
            self.output_sec
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mac_parts() -> LatencyParts {
        // 128 frames at 48 kHz, device 22 + safety 59 + stream 0 frames out; device 114 + safety 12 frames in.
        let f = |frames: f64| Some(frames / 48_000.0);
        LatencyParts { out_buffer: f(128.0), out_device: f(22.0), out_safety: f(59.0), out_stream: f(0.0), in_buffer: f(128.0), in_device: f(114.0), in_safety: f(12.0), in_stream: None }
    }

    fn facts(platform: Platform, out: Transport, input: Option<Transport>) -> RouteTrustFacts {
        RouteTrustFacts { platform, output_transport: out, input_transport: input, direct_hardware: false, low_latency_feature: false }
    }

    #[test]
    fn sums_parts_and_predicts_round_trip() {
        let r = LatencyReport::new(mac_parts(), &facts(Platform::MacOs, Transport::BuiltIn, Some(Transport::BuiltIn)));
        let (out, inp) = (r.output_sec.unwrap(), r.input_sec.unwrap());
        assert!((out - 209.0 / 48_000.0).abs() < 1e-15);
        assert!((inp - 254.0 / 48_000.0).abs() < 1e-15);
        let predicted = r.predicted_round_trip_ms().unwrap();
        println!("latency: output {:.3} ms + input {:.3} ms, predicted round trip {predicted:.4} ms (463 frames at 48 kHz = 9.6458)", out * 1e3, inp * 1e3);
        assert!((predicted - 463.0 / 48.0).abs() < 1e-12);
        assert_eq!(r.trust, TrustClass::A);
        assert_eq!(r.usable_output_sec(), r.output_sec);
        assert_eq!(r.parts, mac_parts());
    }

    #[test]
    fn missing_parts_give_null() {
        let all = mac_parts();
        // No buffer part, or neither device nor stream: that side is not reported.
        assert_eq!(LatencyParts { out_buffer: None, ..all }.output_sec(), None);
        assert_eq!(LatencyParts { out_device: None, out_stream: None, ..all }.output_sec(), None);
        assert_eq!(LatencyParts { in_buffer: None, ..all }.input_sec(), None);
        assert_eq!(LatencyParts::default().output_sec(), None);
        // The safety offset and one of device/stream may be missing (iOS and Windows report two parts).
        let ios = LatencyParts { out_buffer: Some(0.005), out_device: Some(0.008), in_buffer: Some(0.005), in_device: Some(0.004), ..LatencyParts::default() };
        assert!((ios.output_sec().unwrap() - 0.013).abs() < 1e-15);
        let win = LatencyParts { out_buffer: Some(0.010), out_stream: Some(0.0107), ..LatencyParts::default() };
        assert!((win.output_sec().unwrap() - 0.0207).abs() < 1e-15);
        // A nonsense part voids the side.
        assert_eq!(LatencyParts { out_device: Some(f64::NAN), ..all }.output_sec(), None);
        assert_eq!(LatencyParts { in_safety: Some(-0.001), ..all }.input_sec(), None);

        // One side missing: no predicted round trip, and with no output no trust either.
        let f = facts(Platform::MacOs, Transport::BuiltIn, Some(Transport::BuiltIn));
        let no_in = LatencyReport::new(LatencyParts { in_buffer: None, ..all }, &f);
        assert!(no_in.output_sec.is_some() && no_in.input_sec.is_none());
        assert_eq!(no_in.predicted_round_trip_ms(), None);
        assert_eq!(no_in.trust, TrustClass::A);
        let no_out = LatencyReport::new(LatencyParts { out_buffer: None, ..all }, &f);
        assert_eq!((no_out.predicted_round_trip_ms(), no_out.trust, no_out.usable_output_sec()), (None, TrustClass::C, None));
        let none = LatencyReport::unreported();
        assert_eq!((none.output_sec, none.input_sec, none.trust, none.predicted_round_trip_ms()), (None, None, TrustClass::C, None));
    }

    #[test]
    fn trust_rules() {
        use Platform::*;
        use Transport::*;
        let class = |f: RouteTrustFacts| classify_trust(&f, true);
        // Apple: A for built-in, wired, USB; C for Bluetooth, AirPlay, HDMI.
        for p in [MacOs, Ios] {
            for t in [BuiltIn, Wired, Usb] {
                assert_eq!(class(facts(p, t, Some(BuiltIn))), TrustClass::A);
                assert_eq!(class(facts(p, t, None)), TrustClass::A);
            }
            for t in [Bluetooth, Network, Hdmi, Unknown] {
                assert_eq!(class(facts(p, t, Some(BuiltIn))), TrustClass::C);
                assert_eq!(class(facts(p, BuiltIn, Some(t))), TrustClass::C, "the worse side decides");
            }
        }
        // Windows: B; C for Bluetooth.
        assert_eq!(class(facts(Windows, Usb, Some(Usb))), TrustClass::B);
        assert_eq!(class(facts(Windows, Bluetooth, Some(BuiltIn))), TrustClass::C);
        // Linux: B on hw: devices, C through a sound server.
        assert_eq!(class(facts(Linux, BuiltIn, Some(BuiltIn))), TrustClass::C);
        assert_eq!(class(RouteTrustFacts { direct_hardware: true, ..facts(Linux, BuiltIn, Some(BuiltIn)) }), TrustClass::B);
        assert_eq!(class(RouteTrustFacts { direct_hardware: true, ..facts(Linux, Bluetooth, Some(BuiltIn)) }), TrustClass::C);
        // Android: B with the pro-audio or low-latency feature, else C; C for Bluetooth.
        assert_eq!(class(facts(Android, BuiltIn, Some(BuiltIn))), TrustClass::C);
        assert_eq!(class(RouteTrustFacts { low_latency_feature: true, ..facts(Android, BuiltIn, Some(BuiltIn)) }), TrustClass::B);
        assert_eq!(class(RouteTrustFacts { low_latency_feature: true, ..facts(Android, Wired, Some(Bluetooth)) }), TrustClass::C);
        // Nothing reported is C whatever the route.
        assert_eq!(classify_trust(&facts(MacOs, BuiltIn, Some(BuiltIn)), false), TrustClass::C);
        // Flags of another platform do not leak.
        assert_eq!(class(RouteTrustFacts { low_latency_feature: true, ..facts(Linux, BuiltIn, None) }), TrustClass::C);
        assert!(TrustClass::A < TrustClass::B && TrustClass::B < TrustClass::C);
        assert_eq!((TrustClass::B.as_str(), Transport::BuiltIn.as_str(), Transport::Network.as_str()), ("B", "built-in", "network"));
        // Trust C hides the output latency from the playhead even when a number exists.
        let bt = LatencyReport::new(mac_parts(), &facts(MacOs, Bluetooth, Some(BuiltIn)));
        assert!(bt.output_sec.is_some() && bt.usable_output_sec().is_none() && bt.predicted_round_trip_ms().is_some());
    }
}
