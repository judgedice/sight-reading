// The ACL manifest lists every app command, so a capability has to grant it (`allow-<name>` with dashes).
// Keep this list in step with `COMMANDS` in src/audio.rs and with capabilities/default.json; a test checks it.
const COMMANDS: &[&str] = &[
    "app_info",
    "audio_open",
    "audio_close",
    "audio_release_input",
    "audio_set_input",
    "audio_permission",
    "audio_clock_sync",
    "audio_clock_check",
    "audio_put_buffer",
    "audio_decode",
    "audio_drop_buffers",
    "audio_schedule",
    "audio_stop_voices",
    "audio_cancel",
    "audio_capture_start",
    "audio_capture_stop",
    "audio_measure_loopback",
    "audio_debug_hooks",
    "audio_debug_signal",
];

fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)))
        .expect("failed to run tauri-build");
}
