use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Portable settings file name (placed next to the executable).
const SETTINGS_FILE_NAME: &str = "logmaster.json";

/// Fallback directory inside %APPDATA% (Windows) or $XDG_CONFIG_HOME (Unix)
/// when we cannot write next to the executable.
fn fallback_dir() -> Option<PathBuf> {
    // Try %APPDATA%/LogMaster first (Windows)
    if let Ok(p) = env::var("APPDATA") {
        return Some(PathBuf::from(p).join("LogMaster"));
    }
    // Try $XDG_CONFIG_HOME/LogMaster (Linux)
    if let Ok(p) = env::var("XDG_CONFIG_HOME") {
        return Some(PathBuf::from(p).join("LogMaster"));
    }
    // Last resort: ~/.config/LogMaster (Linux/macOS)
    if let Some(home) = dirs::home_dir() {
        return Some(home.join(".config").join("LogMaster"));
    }
    None
}

/// Return the path for `logmaster.json`.
/// Priority:
///   1. <exe_dir>/logmaster.json   (portable mode)
///   2. <fallback_dir>/logmaster.json
fn settings_path() -> PathBuf {
    // 1. Try executable directory
    if let Ok(exe) = env::current_exe() {
        if let Some(dir) = exe.parent() {
            let p = dir.join(SETTINGS_FILE_NAME);
            // Quick write test: try to create the file (or open for append)
            // We do NOT actually write here; just check if the directory is writable.
            if dir_is_writable(dir) {
                return p;
            }
        }
    }
    // 2. Fallback to AppData / XDG config
    fallback_dir()
        .map(|d| {
            let _ = fs::create_dir_all(&d);
            d.join(SETTINGS_FILE_NAME)
        })
        .unwrap_or_else(|| PathBuf::from(SETTINGS_FILE_NAME))
}

/// Check if a directory is writable (best-effort).
fn dir_is_writable(dir: &Path) -> bool {
    // Try to create a temporary file in the directory.
    let probe = dir.join(".logmaster_write_test");
    match fs::File::create(&probe) {
        Ok(_) => {
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// Settings struct (mirrors the frontend `Settings` interface).
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub theme: String,
    pub font_size: i32,
    pub line_height: i32,
    pub tab_size: i32,
    pub follow_tail_default: bool,
    pub show_line_numbers: bool,
    pub search_max_hits: i32,
    pub tail_interval_ms: i32,
    pub side_panel_width: i32,
    pub left_panel_width: i32,
    pub left_panel_open: bool,
    pub word_wrap: bool,
}

#[tauri::command]
pub async fn get_settings() -> Result<Option<Settings>, String> {
    let path = settings_path();
    match fs::read_to_string(&path) {
        Ok(s) => match serde_json::from_str::<Settings>(&s) {
            Ok(mut cfg) => {
                // Migrate old fields if missing (serde default)
                apply_defaults(&mut cfg);
                Ok(Some(cfg))
            }
            Err(e) => {
                eprintln!("LogMaster: invalid settings JSON ({}), using defaults", e);
                Ok(None)
            }
        },
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => {
            eprintln!("LogMaster: cannot read settings ({}), using defaults", e);
            Ok(None)
        }
    }
}

#[tauri::command]
pub async fn save_settings(settings: Settings) -> Result<(), String> {
    let path = settings_path();
    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create dir: {e}"))?;
    }
    let json = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("serialize: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("write: {e}"))?;
    Ok(())
}

/// Fill in any missing fields with defaults (graceful migration).
fn apply_defaults(_cfg: &mut Settings) {
    // All fields are required in the struct, so serde will error if any are missing.
    // We keep this function for future migrations.
}
