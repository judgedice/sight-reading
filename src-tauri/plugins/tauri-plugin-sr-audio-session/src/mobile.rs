//! iOS and Android: calls into the Swift and Kotlin plugin classes. These run on the calling thread and wait for
//! the reply, so the app calls them from its blocking worker threads (the commands already run there), never
//! from the main thread.

use serde::{de::DeserializeOwned, Serialize};
use tauri::{
    ipc::{Channel, InvokeResponseBody},
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.sightread.audiosession";

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_sr_audio_session);

/// Registers the Kotlin or Swift plugin class.
pub fn init<R: Runtime, C: DeserializeOwned>(_app: &AppHandle<R>, api: PluginApi<R, C>) -> crate::Result<SrAudioSession<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "AudioSessionPlugin")?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_sr_audio_session)?;
    Ok(SrAudioSession(handle))
}

/// Access to the session APIs.
pub struct SrAudioSession<R: Runtime>(PluginHandle<R>);

#[derive(Serialize)]
struct KeepAwakePayload {
    on: bool,
}

#[derive(Serialize)]
struct WatchPayload {
    channel: Channel,
}

impl<R: Runtime> SrAudioSession<R> {
    /// The microphone permission now, without prompting.
    pub fn permission_state(&self) -> crate::Result<PermissionState> {
        let reply: PermissionReply = self.0.run_mobile_plugin("permissionState", ())?;
        Ok(reply.state)
    }

    /// Shows the system prompt when the state is `prompt`, waits for the answer and returns the state after it.
    pub fn request_permission(&self) -> crate::Result<PermissionState> {
        let reply: PermissionReply = self.0.run_mobile_plugin("requestPermission", ())?;
        Ok(reply.state)
    }

    /// iOS: category `playAndRecord`, mode `measurement`, preferred rate and IO buffer, activate. Android: ask for
    /// audio focus. Returns the session as it is afterwards.
    pub fn configure_session(&self, config: SessionConfig) -> crate::Result<SessionInfo> {
        Ok(self.0.run_mobile_plugin("configureSession", config)?)
    }

    /// Releases what `configure_session` took (iOS `setActive(false)`, Android focus abandon). Call after the
    /// streams are closed; an active session with running IO refuses to deactivate.
    pub fn deactivate_session(&self) -> crate::Result<()> {
        Ok(self.0.run_mobile_plugin("deactivateSession", ())?)
    }

    /// The session and route now.
    pub fn session_info(&self) -> crate::Result<SessionInfo> {
        Ok(self.0.run_mobile_plugin("sessionInfo", ())?)
    }

    /// Starts forwarding interruption, route and focus events to `handler`, which runs on a thread of the
    /// platform's choosing. A second call replaces the first handler.
    pub fn watch_events<F: Fn(SessionEvent) + Send + Sync + 'static>(&self, handler: F) -> crate::Result<()> {
        let channel = Channel::new(move |body| {
            match body {
                InvokeResponseBody::Json(json) => match serde_json::from_str::<SessionEvent>(&json) {
                    Ok(event) => handler(event),
                    Err(e) => eprintln!("audio session: unreadable event {json}: {e}"),
                },
                InvokeResponseBody::Raw(_) => eprintln!("audio session: unexpected raw event"),
            }
            Ok(())
        });
        Ok(self.0.run_mobile_plugin("watchEvents", WatchPayload { channel })?)
    }

    /// Stops forwarding events.
    pub fn unwatch_events(&self) -> crate::Result<()> {
        Ok(self.0.run_mobile_plugin("unwatchEvents", ())?)
    }

    /// Keeps the screen on while `on` (iOS `isIdleTimerDisabled`, Android `FLAG_KEEP_SCREEN_ON`).
    pub fn set_keep_awake(&self, on: bool) -> crate::Result<()> {
        Ok(self.0.run_mobile_plugin("setKeepAwake", KeepAwakePayload { on })?)
    }
}

impl<R: Runtime> Clone for SrAudioSession<R> {
    fn clone(&self) -> Self {
        SrAudioSession(self.0.clone())
    }
}
