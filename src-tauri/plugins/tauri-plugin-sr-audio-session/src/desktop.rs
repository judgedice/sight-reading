//! Desktop: nothing to configure, so every call answers with its neutral value. The app does not register the
//! plugin on desktop and the desktop audio layer never calls it; this exists so the crate builds and its
//! tests run on every host.

use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

pub fn init<R: Runtime, C: DeserializeOwned>(app: &AppHandle<R>, _api: PluginApi<R, C>) -> crate::Result<SrAudioSession<R>> {
    Ok(SrAudioSession(app.clone()))
}

/// Access to the session APIs (no-ops on desktop).
#[derive(Clone)]
pub struct SrAudioSession<R: Runtime>(#[allow(dead_code)] AppHandle<R>);

impl<R: Runtime> SrAudioSession<R> {
    /// `unknown`: desktop permission is read by the device crate.
    pub fn permission_state(&self) -> crate::Result<PermissionState> {
        Ok(PermissionState::Unknown)
    }

    /// `unknown`, without asking anything.
    pub fn request_permission(&self) -> crate::Result<PermissionState> {
        Ok(PermissionState::Unknown)
    }

    /// An empty `SessionInfo`.
    pub fn configure_session(&self, _config: SessionConfig) -> crate::Result<SessionInfo> {
        Ok(SessionInfo::default())
    }

    /// Nothing to deactivate.
    pub fn deactivate_session(&self) -> crate::Result<()> {
        Ok(())
    }

    /// An empty `SessionInfo`.
    pub fn session_info(&self) -> crate::Result<SessionInfo> {
        Ok(SessionInfo::default())
    }

    /// Accepts the handler and never calls it.
    pub fn watch_events<F: Fn(SessionEvent) + Send + Sync + 'static>(&self, _handler: F) -> crate::Result<()> {
        Ok(())
    }

    /// Nothing to stop.
    pub fn unwatch_events(&self) -> crate::Result<()> {
        Ok(())
    }
}
