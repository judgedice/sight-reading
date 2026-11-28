use serde::{ser::Serializer, Serialize};

/// Result of a plugin call.
pub type Result<T> = std::result::Result<T, Error>;

/// Why a plugin call failed.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The Swift or Kotlin side rejected the call or its reply did not parse.
    #[cfg(mobile)]
    #[error(transparent)]
    PluginInvoke(#[from] tauri::plugin::mobile::PluginInvokeError),
    /// Anything else, with a message.
    #[error("{0}")]
    Message(String),
}

impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}
