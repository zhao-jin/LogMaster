use notify::{Config, Event, Error, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[derive(Serialize, Clone)]
pub struct FsChangeEvent {
    pub dir_path: String,
}

/// Tauri state: holds the active watcher so it stays alive.
struct WatcherState(Mutex<Option<RecommendedWatcher>>);

/// Called once at app startup to register the watcher state.
pub fn init_watcher(app: &tauri::App) -> anyhow::Result<()> {
    app.manage(WatcherState(Mutex::new(None)));
    Ok(())
}

/// Front-end calls this with the current workspace folder paths.
/// We tear down the old watcher (by dropping it) and create a new one
/// that recursively watches every path in `paths`.
#[tauri::command]
pub fn watch_workspace_folders(
    paths: Vec<String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let app_handle = app.clone();

    let mut watcher =
        RecommendedWatcher::new(
            move |res: Result<Event, Error>| match res {
                Ok(event) => {
                    use notify::EventKind;
                    match event.kind {
                        EventKind::Create(_)
                        | EventKind::Remove(_)
                        | EventKind::Modify(..) => {
                            for p in &event.paths {
                                let dir: PathBuf = if p.is_dir() {
                                    p.clone()
                                } else {
                                    p.parent()
                                        .map(|d| d.to_path_buf())
                                        .unwrap_or(p.clone())
                                };
                                let payload = FsChangeEvent {
                                    dir_path: dir.to_string_lossy().to_string(),
                                };
                                let _ = app_handle.emit("fs-change", payload);
                            }
                        }
                        _ => {}
                    }
                }
                Err(e) => {
                    eprintln!("[watcher] error: {e}");
                }
            },
            Config::default(),
        )
        .map_err(|e| format!("{e}"))?;

    for p in &paths {
        let pb = PathBuf::from(p);
        if pb.exists() {
            if let Err(e) = watcher.watch(&pb, RecursiveMode::Recursive) {
                eprintln!("[watcher] failed to watch {}: {e}", p);
            }
        }
    }

    let state = app.state::<WatcherState>();
    *state.0.lock().unwrap() = Some(watcher);

    Ok(())
}
