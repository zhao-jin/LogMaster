use crate::log_file::LogFile;
use anyhow::Result;
use notify::{event::ModifyKind, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use serde::Serialize;
use std::path::Path;
use std::sync::mpsc::channel;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone)]
struct TailPayload {
    id: String,
    new_line_count: usize,
}

pub struct TailHandle {
    _watcher: RecommendedWatcher,
    pub stop: Arc<Mutex<bool>>,
}

pub fn start_tail(
    id: String,
    file: Arc<LogFile>,
    app: AppHandle,
) -> Result<TailHandle> {
    let (tx, rx) = channel::<notify::Result<notify::Event>>();
    let mut watcher = notify::recommended_watcher(move |res| {
        let _ = tx.send(res);
    })?;
    watcher.watch(Path::new(&file.path), RecursiveMode::NonRecursive)?;

    let stop = Arc::new(Mutex::new(false));
    let stop_cloned = stop.clone();
    let id_cloned = id.clone();
    let file_cloned = file.clone();
    let app_cloned = app.clone();

    thread::spawn(move || {
        let mut last_emit = Instant::now();
        let mut dirty = false;
        loop {
            if *stop_cloned.lock() {
                break;
            }
            match rx.recv_timeout(Duration::from_millis(50)) {
                Ok(Ok(ev)) => match ev.kind {
                    EventKind::Modify(ModifyKind::Data(_))
                    | EventKind::Modify(ModifyKind::Any)
                    | EventKind::Create(_)
                    | EventKind::Any => {
                        dirty = true;
                    }
                    _ => {}
                },
                Ok(Err(_)) => {}
                Err(_) => {} // timeout
            }

            // Throttle emits to ~30Hz
            if dirty && last_emit.elapsed() >= Duration::from_millis(33) {
                match file_cloned.refresh_append() {
                    Ok(new_count) => {
                        let _ = app_cloned.emit(
                            "log:append",
                            TailPayload {
                                id: id_cloned.clone(),
                                new_line_count: new_count,
                            },
                        );
                    }
                    Err(e) => eprintln!("refresh_append failed: {e}"),
                }
                last_emit = Instant::now();
                dirty = false;
            }
        }
    });

    Ok(TailHandle {
        _watcher: watcher,
        stop,
    })
}
