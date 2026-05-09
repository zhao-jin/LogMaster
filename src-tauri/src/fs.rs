use anyhow::Result;
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
