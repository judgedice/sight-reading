// No webview commands: the app's audio layer calls the Swift and Kotlin classes through
// `PluginHandle::run_mobile_plugin`, which needs no entry in the ACL manifest or in a capability.
const COMMANDS: &[&str] = &[];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).android_path("android").ios_path("ios").build();
}
