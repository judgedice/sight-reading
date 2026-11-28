//! The shapes that cross between Rust and the Swift and Kotlin classes (JSON, camelCase). Every field the
//! platform may not know is an `Option` that defaults to `None`: a value the OS did not report stays absent and
//! nothing downstream fills it with a guess.

use serde::{Deserialize, Serialize};

/// Preferred session sample rate when the caller names none, Hz.
pub const DEFAULT_SAMPLE_RATE: f64 = 48_000.0;
/// Preferred IO buffer duration when the caller names none, seconds (5 ms, design section 7).
pub const DEFAULT_IO_BUFFER_SEC: f64 = 0.005;

/// The microphone permission, with the words `audio_permission` already uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PermissionState {
    /// The microphone may be used.
    Granted,
    /// The user or a policy refused; only the system settings can change it.
    Denied,
    /// Not decided yet: a request shows the system prompt.
    Prompt,
    /// The platform does not say (also any word this side does not know).
    #[serde(other)]
    Unknown,
}

impl PermissionState {
    /// The wire word of `audio_permission`.
    pub fn as_str(self) -> &'static str {
        match self {
            PermissionState::Granted => "granted",
            PermissionState::Denied => "denied",
            PermissionState::Prompt => "prompt",
            PermissionState::Unknown => "unknown",
        }
    }
}

/// Reply of `permissionState` and `requestPermission`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PermissionReply {
    /// The state after the call.
    pub state: PermissionState,
}

/// Argument of `configureSession`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionConfig {
    /// Preferred hardware sample rate, Hz (iOS `setPreferredSampleRate`; Android only reads it).
    pub preferred_sample_rate: f64,
    /// Preferred IO buffer duration, seconds (iOS `setPreferredIOBufferDuration`).
    pub preferred_io_buffer_sec: f64,
}

impl Default for SessionConfig {
    fn default() -> Self {
        SessionConfig { preferred_sample_rate: DEFAULT_SAMPLE_RATE, preferred_io_buffer_sec: DEFAULT_IO_BUFFER_SEC }
    }
}

/// How a port is attached, in the words of `sr_audio_core::latency::Transport`. The Swift and Kotlin sides map
/// the platform's own port or device type; a type they do not know is `unknown`, never a guess.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PortTransport {
    /// Built-in speaker, receiver or microphone.
    BuiltIn,
    /// Analogue jack.
    Wired,
    /// USB.
    Usb,
    /// Bluetooth, any profile.
    Bluetooth,
    /// HDMI.
    Hdmi,
    /// Network audio (AirPlay and the like).
    Network,
    /// Not known.
    #[serde(other)]
    Unknown,
}

/// One input or output port of the current route.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Port {
    /// Stable id: the `AVAudioSessionPortDescription.uid` on iOS, the `AudioDeviceInfo.id` on Android.
    pub uid: String,
    /// The platform's own type name (`USBAudio`, `TYPE_BLUETOOTH_A2DP`), for logs and diagnostics.
    #[serde(default)]
    pub port_type: Option<String>,
    /// The name the OS shows.
    #[serde(default)]
    pub name: Option<String>,
    /// How it is attached.
    pub transport: PortTransport,
    /// Whether the OS routes audio through it now. iOS lists only active ports. Android lists every attached
    /// device and says which one it believes is in use (see the Kotlin class for how that is decided).
    #[serde(default = "yes")]
    pub active: bool,
}

fn yes() -> bool {
    true
}

/// What the platform says about the session and the route (`configureSession` and `sessionInfo`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SessionInfo {
    /// The web `AudioSession` type word of the session: `play-and-record` on iOS, absent on Android.
    pub session_type: Option<String>,
    /// Hardware sample rate now, Hz (iOS `sampleRate`).
    pub sample_rate: Option<f64>,
    /// IO buffer duration now, seconds (iOS `ioBufferDuration`).
    pub io_buffer_duration: Option<f64>,
    /// iOS `inputLatency`, seconds; absent when the OS reports zero or nothing.
    pub input_latency: Option<f64>,
    /// iOS `outputLatency`, seconds; absent when the OS reports zero or nothing.
    pub output_latency: Option<f64>,
    /// Android `PROPERTY_OUTPUT_FRAMES_PER_BUFFER`: the device's preferred burst, frames.
    pub output_frames_per_buffer: Option<u32>,
    /// Android `PROPERTY_OUTPUT_SAMPLE_RATE`, Hz.
    pub output_sample_rate: Option<u32>,
    /// Android `FEATURE_AUDIO_LOW_LATENCY`.
    pub low_latency: bool,
    /// Android `FEATURE_AUDIO_PRO`.
    pub pro_audio: bool,
    /// Input ports.
    pub inputs: Vec<Port>,
    /// Output ports.
    pub outputs: Vec<Port>,
}

impl SessionInfo {
    /// The input port the OS uses: the first active one.
    pub fn active_input(&self) -> Option<&Port> {
        self.inputs.iter().find(|p| p.active)
    }

    /// The output port the OS uses: the first active one.
    pub fn active_output(&self) -> Option<&Port> {
        self.outputs.iter().find(|p| p.active)
    }
}

/// Something the OS did to the session. The app turns these into its `interruption` and `route` events.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum SessionEvent {
    /// iOS `interruptionNotification`, type began (a call, an alarm, Siri). Streams stop.
    InterruptionBegan,
    /// iOS interruption ended; the session has been activated again when the OS allows.
    InterruptionEnded {
        /// The OS says the app may resume (`shouldResume`).
        #[serde(default)]
        should_resume: bool,
    },
    /// iOS `routeChangeNotification`, or Android `AudioDeviceCallback` (reason `devices-changed`).
    RouteChange {
        /// The OS reason as a word (`old-device-unavailable`, `new-device-available`, `devices-changed`, ...).
        #[serde(default)]
        reason: String,
    },
    /// iOS `mediaServicesWereResetNotification`: every audio object is dead, the session was set up again.
    MediaServicesReset,
    /// Android audio focus: `lost` (permanently or for a while) or `gained`.
    AudioFocus {
        /// `lost` or `gained`.
        state: FocusState,
    },
}

/// Android audio focus change.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FocusState {
    /// Another app took the focus.
    Lost,
    /// The focus is back.
    Gained,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permission_words_round_trip_and_unknown_words_are_unknown() {
        for (word, state) in [("granted", PermissionState::Granted), ("denied", PermissionState::Denied), ("prompt", PermissionState::Prompt)] {
            let reply: PermissionReply = serde_json::from_str(&format!(r#"{{"state":"{word}"}}"#)).unwrap();
            assert_eq!(reply.state, state);
            assert_eq!(state.as_str(), word);
        }
        let odd: PermissionReply = serde_json::from_str(r#"{"state":"prompt-with-rationale"}"#).unwrap();
        assert_eq!(odd.state, PermissionState::Unknown);
    }

    #[test]
    fn session_config_is_camel_case_with_the_design_defaults() {
        let v = serde_json::to_value(SessionConfig::default()).unwrap();
        assert_eq!(v, serde_json::json!({ "preferredSampleRate": 48000.0, "preferredIoBufferSec": 0.005 }));
    }

    /// The reply the Swift side sends: absent keys are `None`, every port word is read.
    #[test]
    fn ios_session_info_parses() {
        let json = r#"{
            "sessionType": "play-and-record", "sampleRate": 48000, "ioBufferDuration": 0.005333,
            "inputLatency": 0.0031, "outputLatency": 0.0042,
            "inputs": [{"uid": "Built-In Microphone", "portType": "MicrophoneBuiltIn", "name": "iPhone Microphone", "transport": "built-in"}],
            "outputs": [{"uid": "Speaker", "portType": "Speaker", "transport": "built-in"}]
        }"#;
        let info: SessionInfo = serde_json::from_str(json).unwrap();
        assert_eq!(info.session_type.as_deref(), Some("play-and-record"));
        assert_eq!(info.output_latency, Some(0.0042));
        assert_eq!(info.output_frames_per_buffer, None);
        assert!(!info.low_latency && !info.pro_audio);
        assert_eq!(info.active_input().map(|p| p.uid.as_str()), Some("Built-In Microphone"));
        assert_eq!(info.active_output().map(|p| p.transport), Some(PortTransport::BuiltIn));
    }

    #[test]
    fn android_session_info_parses_and_picks_the_active_port() {
        let json = r#"{
            "outputFramesPerBuffer": 192, "outputSampleRate": 48000, "lowLatency": true, "proAudio": false,
            "inputs": [{"uid": "7", "transport": "built-in", "active": false}, {"uid": "9", "transport": "usb", "active": true}],
            "outputs": [{"uid": "2", "transport": "mystery-word", "active": true}]
        }"#;
        let info: SessionInfo = serde_json::from_str(json).unwrap();
        assert_eq!((info.output_frames_per_buffer, info.output_sample_rate), (Some(192), Some(48_000)));
        assert!(info.low_latency);
        assert_eq!(info.active_input().map(|p| p.transport), Some(PortTransport::Usb));
        assert_eq!(info.active_output().map(|p| p.transport), Some(PortTransport::Unknown));
        assert!(SessionInfo::default().active_output().is_none());
    }

    #[test]
    fn events_parse_from_the_native_shapes() {
        let parse = |s: &str| serde_json::from_str::<SessionEvent>(s).unwrap();
        assert_eq!(parse(r#"{"kind":"interruptionBegan"}"#), SessionEvent::InterruptionBegan);
        assert_eq!(parse(r#"{"kind":"interruptionEnded","shouldResume":true}"#), SessionEvent::InterruptionEnded { should_resume: true });
        assert_eq!(parse(r#"{"kind":"interruptionEnded"}"#), SessionEvent::InterruptionEnded { should_resume: false });
        assert_eq!(parse(r#"{"kind":"routeChange","reason":"old-device-unavailable"}"#), SessionEvent::RouteChange { reason: "old-device-unavailable".into() });
        assert_eq!(parse(r#"{"kind":"mediaServicesReset"}"#), SessionEvent::MediaServicesReset);
        assert_eq!(parse(r#"{"kind":"audioFocus","state":"lost"}"#), SessionEvent::AudioFocus { state: FocusState::Lost });
    }
}
