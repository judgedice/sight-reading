//! Microphone permission (`audio_permission`).
//!
//! * macOS: `AVCaptureDevice` authorization for audio. [`microphone_state`] only reads the status;
//!   [`request_microphone`] asks the system to show its prompt when the status is still undetermined and
//!   reports the answer to a callback, which the system calls on a queue of its own. Neither blocks, and
//!   neither needs the main thread. The app bundle must carry `NSMicrophoneUsageDescription`
//!   (`src-tauri/Info.plist`), or the system ends the process at the first microphone access.
//! * Windows and Linux: desktop programs are not gated in a way we can read, so the state is `granted` when an
//!   input device can be enumerated and `unknown` otherwise; a request changes nothing.
//! * iOS and Android: `unknown` here; the session plugin answers there.
//!
//! All `unsafe` is in the macOS `av` module. **The macOS part is implemented, not yet verified on hardware.**

/// The `audio_permission` reply.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Permission {
    /// The microphone may be used.
    Granted,
    /// The user or a policy refused; only the system settings can change it.
    Denied,
    /// Not decided yet: a request will show the system prompt.
    Prompt,
    /// The platform does not say.
    Unknown,
}

impl Permission {
    /// The wire word: `granted`, `denied`, `prompt` or `unknown`.
    pub fn as_str(self) -> &'static str {
        match self {
            Permission::Granted => "granted",
            Permission::Denied => "denied",
            Permission::Prompt => "prompt",
            Permission::Unknown => "unknown",
        }
    }

    /// From an `AVAuthorizationStatus` raw value: 0 not determined, 1 restricted, 2 denied, 3 authorized.
    pub fn from_av_status(status: isize) -> Permission {
        match status {
            0 => Permission::Prompt,
            1 | 2 => Permission::Denied,
            3 => Permission::Granted,
            _ => Permission::Unknown,
        }
    }
}

/// The current state, without prompting.
pub fn microphone_state() -> Permission {
    #[cfg(target_os = "macos")]
    {
        av::status()
    }
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        if crate::cpal_io::input_device_available() {
            Permission::Granted
        } else {
            Permission::Unknown
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        Permission::Unknown
    }
}

/// Asks for the microphone. `done` is called exactly once with the resulting state: at once, on the calling
/// thread, when there is nothing to ask (already decided, or a platform without a prompt); otherwise later,
/// from a system thread, when the user has answered. Returns without waiting for the user.
pub fn request_microphone(done: impl FnOnce(Permission) + Send + 'static) {
    let state = microphone_state();
    if state != Permission::Prompt {
        done(state);
        return;
    }
    #[cfg(target_os = "macos")]
    av::request(done);
    #[cfg(not(target_os = "macos"))]
    done(state);
}

#[cfg(target_os = "macos")]
mod av {
    use std::sync::Mutex;

    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_av_foundation::{AVCaptureDevice, AVMediaTypeAudio};

    use super::Permission;

    pub(super) fn status() -> Permission {
        // SAFETY: `AVMediaTypeAudio` is a constant exported by AVFoundation; reading the static is sound once
        // the framework is loaded, which linking against it guarantees.
        let Some(media) = (unsafe { AVMediaTypeAudio }) else { return Permission::Unknown };
        // SAFETY: a class method with a valid media type (audio is one of the two the method accepts, so it
        // does not raise); it only reads the authorization database.
        let status = unsafe { AVCaptureDevice::authorizationStatusForMediaType(media) };
        Permission::from_av_status(status.0)
    }

    pub(super) fn request(done: impl FnOnce(Permission) + Send + 'static) {
        // SAFETY: as in `status`.
        let Some(media) = (unsafe { AVMediaTypeAudio }) else {
            done(Permission::Unknown);
            return;
        };
        // The system calls the handler once, on an arbitrary queue. The block type is `Fn`, so the `FnOnce`
        // sits in a mutex and is taken out on the first call.
        let done = Mutex::new(Some(Box::new(done) as Box<dyn FnOnce(Permission) + Send>));
        let handler = RcBlock::new(move |granted: Bool| {
            let callback = done.lock().ok().and_then(|mut slot| slot.take());
            if let Some(callback) = callback {
                callback(if granted.as_bool() { Permission::Granted } else { Permission::Denied });
            }
        });
        // SAFETY: a class method with a valid media type and a heap block; AVFoundation copies the block and
        // keeps it until it has called it. It returns at once.
        unsafe { AVCaptureDevice::requestAccessForMediaType_completionHandler(media, &handler) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_words() {
        assert_eq!(Permission::from_av_status(0), Permission::Prompt);
        assert_eq!((Permission::from_av_status(1), Permission::from_av_status(2)), (Permission::Denied, Permission::Denied));
        assert_eq!(Permission::from_av_status(3), Permission::Granted);
        assert_eq!((Permission::from_av_status(4), Permission::from_av_status(-1)), (Permission::Unknown, Permission::Unknown));
        let words: Vec<&str> = [Permission::Granted, Permission::Denied, Permission::Prompt, Permission::Unknown].iter().map(|p| p.as_str()).collect();
        assert_eq!(words, ["granted", "denied", "prompt", "unknown"]);
    }

    /// Status only: never prompts, so it is safe on any machine and on CI.
    #[test]
    fn state_reads_without_prompting() {
        let state = microphone_state();
        println!("microphone permission state: {}", state.as_str());
        if cfg!(not(any(target_os = "macos", target_os = "windows", target_os = "linux"))) {
            assert_eq!(state, Permission::Unknown);
        }
        if cfg!(any(target_os = "windows", target_os = "linux")) {
            assert!(matches!(state, Permission::Granted | Permission::Unknown));
        }
    }

    /// Where nothing can be asked, the callback runs at once with the current state. (On macOS this test only
    /// runs the request when the state is already decided, so it never shows a prompt.)
    #[test]
    fn request_answers_at_once_when_there_is_nothing_to_ask() {
        let state = microphone_state();
        if cfg!(target_os = "macos") && state == Permission::Prompt {
            return;
        }
        let (tx, rx) = std::sync::mpsc::channel();
        request_microphone(move |p| {
            let _ = tx.send(p);
        });
        assert_eq!(rx.try_recv(), Ok(state));
    }
}
