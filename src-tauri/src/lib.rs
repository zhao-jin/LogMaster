mod filter;
mod fs;
mod log_file;
mod search;
mod tail;

use crate::filter::FilterRule;
use crate::fs::DirEntryInfo;
use crate::log_file::LogFile;
use crate::search::SearchHit;
use crate::tail::TailHandle;
use dashmap::DashMap;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, State};
use uuid::Uuid;

#[derive(Serialize, Clone)]
pub struct FileInfo {
    pub id: String,
    pub path: String,
    pub name: String,
    pub size: u64,
    pub line_count: usize,
    pub encoding: String,
}

#[derive(Serialize)]
pub struct LineRange {
    pub start: usize,
    pub end: usize,
    pub lines: Vec<String>,
}

#[derive(Default)]
pub struct AppState {
    files: DashMap<String, Arc<LogFile>>,
    tails: DashMap<String, TailHandle>,
}

#[tauri::command]
async fn open_file(state: State<'_, AppState>, path: String) -> Result<FileInfo, String> {
    let p = PathBuf::from(&path);
    let file = LogFile::open(&p).map_err(|e| format!("{e}"))?;
    let id = Uuid::new_v4().to_string();
    let name = p
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());
    let info = FileInfo {
        id: id.clone(),
        path: path.clone(),
        name,
        size: file.size(),
        line_count: file.line_count(),
        encoding: file.encoding.name().to_string(),
    };
    state.files.insert(id, Arc::new(file));
    Ok(info)
}

#[tauri::command]
async fn close_file(state: State<'_, AppState>, id: String) -> Result<(), String> {
    if let Some((_, handle)) = state.tails.remove(&id) {
        *handle.stop.lock() = true;
    }
    state.files.remove(&id);
    Ok(())
}

#[tauri::command]
async fn read_lines(
    state: State<'_, AppState>,
    id: String,
    start: usize,
    end: usize,
) -> Result<LineRange, String> {
    let file = state
        .files
        .get(&id)
        .ok_or_else(|| "file not open".to_string())?
        .clone();
    let lines = file.read_lines(start, end).map_err(|e| format!("{e}"))?;
    Ok(LineRange {
        start,
        end: start + lines.len(),
        lines,
    })
}

#[tauri::command]
async fn read_lines_by_indices(
    state: State<'_, AppState>,
    id: String,
    indices: Vec<u32>,
) -> Result<Vec<String>, String> {
    let file = state
        .files
        .get(&id)
        .ok_or_else(|| "file not open".to_string())?
        .clone();
    file.read_lines_by_indices(&indices)
        .map_err(|e| format!("{e}"))
}

#[tauri::command(rename_all = "camelCase")]
async fn filter_lines(
    state: State<'_, AppState>,
    id: String,
    rules: Vec<FilterRule>,
) -> Result<Vec<u32>, String> {
    let file = state
        .files
        .get(&id)
        .ok_or_else(|| "file not open".to_string())?
        .clone();
    // Run on blocking pool so we don't block Tauri's async runtime.
    tauri::async_runtime::spawn_blocking(move || filter::filter_lines(&file, &rules))
        .await
        .map_err(|e| format!("join error: {e}"))?
        .map_err(|e| format!("{e}"))
}

#[tauri::command(rename_all = "camelCase")]
async fn search_file(
    state: State<'_, AppState>,
    id: String,
    pattern: String,
    is_regex: bool,
    case_sensitive: bool,
    max_hits: usize,
) -> Result<Vec<SearchHit>, String> {
    let file = state
        .files
        .get(&id)
        .ok_or_else(|| "file not open".to_string())?
        .clone();
    search::search(&file, &pattern, is_regex, case_sensitive, max_hits)
        .map_err(|e| format!("{e}"))
}

#[tauri::command(rename_all = "snake_case")]
async fn start_tail(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let file = state
        .files
        .get(&id)
        .ok_or_else(|| "file not open".to_string())?
        .clone();
    if state.tails.contains_key(&id) {
        return Ok(());
    }
    let handle =
        crate::tail::start_tail(id.clone(), file, app).map_err(|e| format!("{e}"))?;
    state.tails.insert(id, handle);
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
async fn stop_tail(state: State<'_, AppState>, id: String) -> Result<(), String> {
    if let Some((_, h)) = state.tails.remove(&id) {
        *h.stop.lock() = true;
    }
    Ok(())
}

#[tauri::command]
async fn list_dir(path: String) -> Result<Vec<DirEntryInfo>, String> {
    fs::list_dir(std::path::Path::new(&path)).map_err(|e| format!("{e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            open_file,
            close_file,
            read_lines,
            read_lines_by_indices,
            filter_lines,
            search_file,
            start_tail,
            stop_tail,
            list_dir,
        ])
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
