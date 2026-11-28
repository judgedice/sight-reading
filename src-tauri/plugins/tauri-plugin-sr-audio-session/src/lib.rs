//! Audio session plugin for the Sightread mobile shells.
//!
//! It has no webview commands. The app's audio layer (`src-tauri/src/mobile.rs`) holds a [`SrAudioSession`] and
//! calls it from Rust: microphone permission, session configuration, route facts, and a stream of
//! [`SessionEvent`]s. On desktop every call is a no-op.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

#[cfg(desktop)]
mod desktop;
mod error;
#[cfg(mobile)]
mod mobile;
mod models;

pub use error::{Error, Result};
pub use models::*;

#[cfg(desktop)]
pub use desktop::SrAudioSession;
#[cfg(mobile)]
pub use mobile::SrAudioSession;

/// Extensions to [`tauri::App`], [`tauri::AppHandle`] and [`tauri::Window`] to reach the session API.
pub trait SrAudioSessionExt<R: Runtime> {
    /// The plugin's state.
    fn sr_audio_session(&self) -> &SrAudioSession<R>;
}

impl<R: Runtime, T: Manager<R>> SrAudioSessionExt<R> for T {
    fn sr_audio_session(&self) -> &SrAudioSession<R> {
        self.state::<SrAudioSession<R>>().inner()
    }
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("sr-audio-session")
        .setup(|app, api| {
            #[cfg(mobile)]
            let session = mobile::init(app, api)?;
            #[cfg(desktop)]
            let session = desktop::init(app, api)?;
            app.manage(session);
            Ok(())
        })
        .build()
}
