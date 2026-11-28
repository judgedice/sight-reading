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
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![app_info])
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
