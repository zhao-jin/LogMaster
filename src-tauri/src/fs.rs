use anyhow::{anyhow, Result};
use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Serialize, Clone)]
pub struct DirEntryInfo {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: i64, // unix seconds
}

#[derive(Serialize, Clone)]
pub struct DeleteResult {
    pub path: String,
    pub ok: bool,
    pub error: Option<String>,
}

pub fn list_dir(path: &Path) -> Result<Vec<DirEntryInfo>> {
    let mut out: Vec<DirEntryInfo> = Vec::new();
    let rd = fs::read_dir(path)?;
    for entry in rd.flatten() {
        let p = entry.path();
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        out.push(DirEntryInfo {
            name,
            path: p.to_string_lossy().to_string(),
            is_dir: meta.is_dir(),
            size: if meta.is_file() { meta.len() } else { 0 },
            modified,
        });
    }
    // Sort: folders first, then by modified desc
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| b.modified.cmp(&a.modified))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(out)
}

/// Delete a list of paths. Each is processed independently so a partial
/// failure (e.g. one file is locked) doesn't abort the rest. Files use
/// `fs::remove_file`; directories require `recursive=true` and use
/// `fs::remove_dir_all`.
///
/// We deliberately do NOT move to the OS recycle bin here — adding that
/// would mean pulling in `trash` or shelling out, and the explorer's
/// confirm dialog already protects against accidents. If users want a
/// safer flow we can introduce it later behind a setting.
pub fn delete_paths(paths: &[String], recursive: bool) -> Vec<DeleteResult> {
    let mut out = Vec::with_capacity(paths.len());
    for p in paths {
        let path = Path::new(p);
        let res = if path.is_dir() {
            if recursive {
                fs::remove_dir_all(path).map_err(|e| anyhow!("{e}"))
            } else {
                Err(anyhow!("path is a directory; pass recursive=true"))
            }
        } else {
            fs::remove_file(path).map_err(|e| anyhow!("{e}"))
        };
        out.push(match res {
            Ok(()) => DeleteResult {
                path: p.clone(),
                ok: true,
                error: None,
            },
            Err(e) => DeleteResult {
                path: p.clone(),
                ok: false,
                error: Some(format!("{e}")),
            },
        });
    }
    out
}
