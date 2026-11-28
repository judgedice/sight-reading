pub mod audio;
pub mod files;
pub mod mobile;

use serde::Serialize;

/// Static facts about the running build. Used by the native smoke test to prove IPC works.
#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct AppInfo {
    pub version: String,
    pub os: String,
    pub arch: String,
}

fn info() -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
    }
}

#[tauri::command]
fn app_info() -> AppInfo {
    info()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // Mobile only: the audio session plugin (microphone permission, session, route facts).
    #[cfg(mobile)]
    let builder = mobile::register(builder);
    // The system browser for http(s) links (allowed by pattern in capabilities/default.json).
    let builder = builder.plugin(tauri_plugin_opener::init());
    builder
        .manage(audio::AudioHost::default())
        .manage(files::AwakeLock::default())
        .invoke_handler(tauri::generate_handler![
            app_info,
            audio::audio_open,
            audio::audio_close,
            audio::audio_release_input,
            audio::audio_set_input,
            audio::audio_permission,
            audio::audio_clock_sync,
            audio::audio_clock_check,
            audio::audio_put_buffer,
            audio::audio_decode,
            audio::audio_drop_buffers,
            audio::audio_schedule,
            audio::audio_stop_voices,
            audio::audio_cancel,
            audio::audio_capture_start,
            audio::audio_capture_stop,
            audio::audio_measure_loopback,
            audio::audio_debug_hooks,
            audio::audio_debug_signal,
            files::save_file,
            files::open_licence,
            files::keep_awake,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Sightread");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_info_reports_build_facts() {
        let i = info();
        assert_eq!(i.version, env!("CARGO_PKG_VERSION"));
        assert!(!i.os.is_empty() && !i.arch.is_empty());
    }
}
