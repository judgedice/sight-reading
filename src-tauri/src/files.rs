//! Non-audio platform services of the native app: save a file the player exports, open a licence text, keep
//! the screen awake. The webview reaches them through the commands below; `src/platform/native/files.ts` is the
//! caller.
//!
//! * `save_file` shows the system save dialog (desktop) and writes the bytes to the path the player chose.
//!   The webview never sees or names a path, so it cannot write anywhere the player did not pick. Mobile has no
//!   save dialog that can be relied on, so it answers `not-available`, which the screens already show as a
//!   failed export. With both `SR_E2E_HOOKS=1` and `SR_E2E_SAVE_DIR` set (the end-to-end test only) the file goes
//!   to that directory without a dialog.
//! * `open_licence` opens a licence text of the app's own bundle (`LICENSES/*.txt`) in a window of its own.
//! * `keep_awake` holds a display and idle sleep lock (desktop crate) or the screen flag (mobile plugin).

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request};

/// Names of the commands of this module, for the build script's ACL manifest and the capability file.
pub const COMMANDS: &[&str] = &["save_file", "open_licence", "keep_awake"];

/// What `save_file` reports when it did not fail.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SaveStatus {
    /// The file was written.
    Saved,
    /// The player closed the dialog.
    Cancelled,
}

/// The error text of a platform without the service. The page tests for it.
pub const NOT_AVAILABLE: &str = "not-available";

/// A request body of `save_file`: `u32 LE nameLen`, the name (UTF-8), `u32 LE mimeLen`, the type (UTF-8), the bytes.
#[derive(Debug, PartialEq, Eq)]
pub struct SaveRequest<'a> {
    pub name: String,
    pub mime: String,
    pub bytes: &'a [u8],
}

fn take_len_prefixed<'a>(body: &mut &'a [u8], what: &str) -> Result<&'a [u8], String> {
    if body.len() < 4 {
        return Err(format!("save_file: truncated {what}"));
    }
    let n = u32::from_le_bytes([body[0], body[1], body[2], body[3]]) as usize;
    let rest = &body[4..];
    if rest.len() < n {
        return Err(format!("save_file: truncated {what}"));
    }
    let (field, tail) = rest.split_at(n);
    *body = tail;
    Ok(field)
}

/// Parses the request body of `save_file`.
pub fn parse_save_request(mut body: &[u8]) -> Result<SaveRequest<'_>, String> {
    let name = std::str::from_utf8(take_len_prefixed(&mut body, "name")?).map_err(|_| "save_file: the name is not UTF-8".to_string())?;
    let mime = std::str::from_utf8(take_len_prefixed(&mut body, "type")?).map_err(|_| "save_file: the type is not UTF-8".to_string())?;
    Ok(SaveRequest { name: safe_file_name(name), mime: mime.chars().take(100).collect(), bytes: body })
}

/// The last path component of a suggested name, without control characters, at most 120 characters; a fallback
/// when nothing is left. Used for the dialog's suggestion and for the end-to-end directory, so a name can never
/// climb out of the directory it is written to.
pub fn safe_file_name(name: &str) -> String {
    let last = name.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = last.chars().filter(|c| !c.is_control() && *c != ':').take(120).collect();
    let cleaned = cleaned.trim().trim_start_matches('.').to_string();
    if cleaned.is_empty() {
        "sightread-file".to_string()
    } else {
        cleaned
    }
}

/// The file extension (without the dot) of a name, lower case, when it is a short plain one.
pub fn extension_of(name: &str) -> Option<String> {
    let ext = Path::new(name).extension()?.to_str()?.to_ascii_lowercase();
    (!ext.is_empty() && ext.len() <= 8 && ext.chars().all(|c| c.is_ascii_alphanumeric())).then_some(ext)
}

/// The end-to-end save directory: only when `SR_E2E_HOOKS` is `1` and `SR_E2E_SAVE_DIR` names a directory.
/// `get` reads the environment (a closure so a test can supply one).
pub fn e2e_save_dir(get: impl Fn(&str) -> Option<String>) -> Option<PathBuf> {
    if get("SR_E2E_HOOKS").as_deref() != Some("1") {
        return None;
    }
    get("SR_E2E_SAVE_DIR").filter(|d| !d.trim().is_empty()).map(PathBuf::from)
}

/// Whether `name` is a licence text of the bundle: `Name.txt` of letters, digits, dots and dashes.
pub fn is_licence_name(name: &str) -> bool {
    let stem = name.strip_suffix(".txt").unwrap_or("");
    !stem.is_empty()
        && !stem.starts_with('.')
        && !name.contains("..")
        && stem.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
}

fn raw_body<'a>(request: &'a Request<'_>) -> Result<&'a [u8], String> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes),
        InvokeBody::Json(_) => Err("save_file: expected a raw (binary) request body".to_string()),
    }
}

fn write_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    std::fs::write(path, bytes).map_err(|e| format!("save_file: {}: {e}", path.display()))
}

/// `save_file(raw)`: the body is described at [`parse_save_request`]. Replies `"saved"` or `"cancelled"`.
#[tauri::command]
pub async fn save_file(window: tauri::WebviewWindow, request: Request<'_>) -> Result<SaveStatus, String> {
    let req = parse_save_request(raw_body(&request)?)?;
    if let Some(dir) = e2e_save_dir(|k| std::env::var(k).ok()) {
        std::fs::create_dir_all(&dir).map_err(|e| format!("save_file: {}: {e}", dir.display()))?;
        write_file(&dir.join(&req.name), req.bytes)?;
        return Ok(SaveStatus::Saved);
    }
    save_with_dialog(window, req).await
}

#[cfg(desktop)]
async fn save_with_dialog(window: tauri::WebviewWindow, req: SaveRequest<'_>) -> Result<SaveStatus, String> {
    let mut dialog = rfd::AsyncFileDialog::new().set_parent(&window).set_file_name(req.name.as_str());
    if let Some(ext) = extension_of(&req.name) {
        dialog = dialog.add_filter(ext.to_uppercase(), &[ext.as_str()]);
    }
    let Some(chosen) = dialog.save_file().await else { return Ok(SaveStatus::Cancelled) };
    write_file(chosen.path(), req.bytes)?;
    Ok(SaveStatus::Saved)
}

#[cfg(mobile)]
async fn save_with_dialog(_window: tauri::WebviewWindow, _req: SaveRequest<'_>) -> Result<SaveStatus, String> {
    Err(NOT_AVAILABLE.to_string())
}

/// `open_licence({ name })`: the bundle's `LICENSES/<name>` in a small window. Desktop only.
#[tauri::command]
pub async fn open_licence(app: tauri::AppHandle, name: String) -> Result<(), String> {
    if !is_licence_name(&name) {
        return Err(format!("open_licence: {name:?} is not a licence file name"));
    }
    open_licence_window(&app, &name)
}

#[cfg(desktop)]
fn open_licence_window(app: &tauri::AppHandle, name: &str) -> Result<(), String> {
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
    let label = format!("licence-{}", name.replace('.', "_"));
    if let Some(w) = app.get_webview_window(&label) {
        return w.set_focus().map_err(|e| format!("open_licence: {e}"));
    }
    WebviewWindowBuilder::new(app, label, WebviewUrl::App(PathBuf::from("LICENSES").join(name)))
        .title(name)
        .inner_size(760.0, 840.0)
        .build()
        .map(|_| ())
        .map_err(|e| format!("open_licence: {e}"))
}

#[cfg(mobile)]
fn open_licence_window(_app: &tauri::AppHandle, _name: &str) -> Result<(), String> {
    Err(NOT_AVAILABLE.to_string())
}

/// The held lock (desktop). Dropping it gives the lock back.
#[derive(Default)]
pub struct AwakeLock {
    #[cfg(desktop)]
    held: std::sync::Mutex<Option<keepawake::KeepAwake>>,
}

/// `keep_awake({ on })`: idempotent. Failing to take the lock is an error the page treats as "could not".
#[tauri::command]
pub async fn keep_awake(app: tauri::AppHandle, lock: tauri::State<'_, AwakeLock>, on: bool) -> Result<(), String> {
    set_awake(&app, &lock, on)
}

#[cfg(desktop)]
fn set_awake(_app: &tauri::AppHandle, lock: &AwakeLock, on: bool) -> Result<(), String> {
    let mut held = lock.held.lock().map_err(|_| "keep_awake: lock poisoned".to_string())?;
    if !on {
        *held = None;
        return Ok(());
    }
    if held.is_none() {
        let k = keepawake::Builder::default()
            .display(true)
            .idle(true)
            .reason("Practice in progress")
            .app_name("Sightread")
            .app_reverse_domain("app.sightread.trainer")
            .create()
            .map_err(|e| format!("keep_awake: {e}"))?;
        *held = Some(k);
    }
    Ok(())
}

#[cfg(mobile)]
fn set_awake(app: &tauri::AppHandle, _lock: &AwakeLock, on: bool) -> Result<(), String> {
    use tauri_plugin_sr_audio_session::SrAudioSessionExt;
    app.sr_audio_session().set_keep_awake(on).map_err(|e| format!("keep_awake: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn frame(name: &str, mime: &str, bytes: &[u8]) -> Vec<u8> {
        let mut v = Vec::new();
        v.extend((name.len() as u32).to_le_bytes());
        v.extend(name.as_bytes());
        v.extend((mime.len() as u32).to_le_bytes());
        v.extend(mime.as_bytes());
        v.extend(bytes);
        v
    }

    #[test]
    fn save_request_round_trips_and_rejects_truncation() {
        let body = frame("sightread-backup-2026-01-02.json", "application/json", b"{\"a\":1}");
        let r = parse_save_request(&body).unwrap();
        assert_eq!(r.name, "sightread-backup-2026-01-02.json");
        assert_eq!(r.mime, "application/json");
        assert_eq!(r.bytes, b"{\"a\":1}");
        assert_eq!(parse_save_request(&frame("a.txt", "text/plain", b"")).unwrap().bytes, b"");
        let header = 4 + "sightread-backup-2026-01-02.json".len() + 4 + "application/json".len();
        for cut in 0..header {
            assert!(parse_save_request(&body[..cut]).is_err(), "a body cut at {cut} is refused");
        }
        assert!(parse_save_request(&body[..header]).is_ok());
        assert!(parse_save_request(&[255, 255, 255, 255, 1]).is_err());
    }

    #[test]
    fn names_cannot_climb_out_of_a_directory() {
        assert_eq!(safe_file_name("../../etc/passwd"), "passwd");
        assert_eq!(safe_file_name("C:\\Users\\x\\a.json"), "a.json");
        assert_eq!(safe_file_name("a/b/"), "sightread-file");
        assert_eq!(safe_file_name(".hidden.json"), "hidden.json");
        assert_eq!(safe_file_name(""), "sightread-file");
        assert_eq!(safe_file_name("ok-name_1.json"), "ok-name_1.json");
    }

    #[test]
    fn extension_filter_is_plain() {
        assert_eq!(extension_of("a.JSON").as_deref(), Some("json"));
        assert_eq!(extension_of("noext"), None);
        assert_eq!(extension_of("a.toolongextension"), None);
    }

    #[test]
    fn the_save_bypass_needs_both_variables() {
        let env = |pairs: &'static [(&'static str, &'static str)]| move |k: &str| pairs.iter().find(|(n, _)| *n == k).map(|(_, v)| v.to_string());
        assert_eq!(e2e_save_dir(env(&[])), None);
        assert_eq!(e2e_save_dir(env(&[("SR_E2E_SAVE_DIR", "/tmp/x")])), None);
        assert_eq!(e2e_save_dir(env(&[("SR_E2E_HOOKS", "1")])), None);
        assert_eq!(e2e_save_dir(env(&[("SR_E2E_HOOKS", "0"), ("SR_E2E_SAVE_DIR", "/tmp/x")])), None);
        assert_eq!(e2e_save_dir(env(&[("SR_E2E_HOOKS", "1"), ("SR_E2E_SAVE_DIR", " ")])), None);
        assert_eq!(e2e_save_dir(env(&[("SR_E2E_HOOKS", "1"), ("SR_E2E_SAVE_DIR", "/tmp/x")])), Some(PathBuf::from("/tmp/x")));
    }

    #[test]
    fn licence_names_are_plain_text_files() {
        assert!(is_licence_name("CC0-1.0.txt"));
        assert!(is_licence_name("OFL-1.1-Source-Serif-4.txt"));
        for bad in ["", ".txt", "a.json", "../a.txt", "a/b.txt", "a..b.txt", ".hidden.txt", "a b.txt"] {
            assert!(!is_licence_name(bad), "{bad}");
        }
    }

    #[test]
    fn build_script_and_capability_list_every_file_command() {
        let build = include_str!("../build.rs");
        let cap: Value = serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        let granted: Vec<&str> = cap["permissions"].as_array().unwrap().iter().filter_map(Value::as_str).collect();
        for c in COMMANDS {
            assert!(build.contains(&format!("\"{c}\"")), "{c} missing from build.rs");
            let perm = format!("allow-{}", c.replace('_', "-"));
            assert!(granted.contains(&perm.as_str()), "{perm} missing from capabilities/default.json");
        }
    }

    #[test]
    fn the_opener_grant_is_http_and_https_only() {
        let cap: Value = serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        let grants: Vec<&Value> = cap["permissions"].as_array().unwrap().iter().filter(|p| p.is_object()).collect();
        let opener: Vec<&&Value> = grants.iter().filter(|g| g["identifier"] == "opener:allow-open-url").collect();
        assert_eq!(opener.len(), 1);
        let urls: Vec<&str> = opener[0]["allow"].as_array().unwrap().iter().filter_map(|a| a["url"].as_str()).collect();
        assert!(!urls.is_empty() && urls.iter().all(|u| u.starts_with("https://") || u.starts_with("http://")), "{urls:?}");
        let all: Vec<&str> = cap["permissions"].as_array().unwrap().iter().filter_map(Value::as_str).collect();
        assert!(!all.iter().any(|p| p.starts_with("opener:") || p.starts_with("dialog:") || p.starts_with("fs:")), "no broad plugin grants: {all:?}");
    }
}
