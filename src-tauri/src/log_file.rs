use anyhow::{anyhow, Result};
use encoding_rs::{Encoding, UTF_8};
use memchr::memchr_iter;
use memmap2::Mmap;
use parking_lot::RwLock;
use std::fs::File;
use std::path::{Path, PathBuf};

/// An opened log file: owns its mmap and a sorted Vec of line offsets.
///
/// `line_offsets[i]` = byte offset of the start of line i.
/// The sentinel last element equals the file size, so the length of
/// line i is `line_offsets[i+1] - line_offsets[i]` (trailing \n/\r included,
/// which we strip on read).
pub struct LogFile {
    pub path: PathBuf,
    pub encoding: &'static Encoding,
    mmap: RwLock<Mmap>,
    /// First element is 0, last element is current file length.
    /// len == line_count + 1.
    offsets: RwLock<Vec<u64>>,
}

impl LogFile {
    pub fn open(path: &Path) -> Result<Self> {
        let file = File::open(path)?;
        let mmap = unsafe { Mmap::map(&file) }?;
        let encoding = detect_encoding(&mmap);
        let offsets = build_line_offsets(&mmap);
        Ok(Self {
            path: path.to_path_buf(),
            encoding,
            mmap: RwLock::new(mmap),
            offsets: RwLock::new(offsets),
        })
    }

    pub fn size(&self) -> u64 {
        *self.offsets.read().last().unwrap_or(&0)
    }

    pub fn line_count(&self) -> usize {
        let ofs = self.offsets.read();
        if ofs.len() <= 1 {
            0
        } else {
            ofs.len() - 1
        }
    }

    /// Return decoded strings for lines in `[start, end)`.
    pub fn read_lines(&self, start: usize, end: usize) -> Result<Vec<String>> {
        let ofs = self.offsets.read();
        let mmap = self.mmap.read();
        let n = if ofs.len() <= 1 { 0 } else { ofs.len() - 1 };
        let end = end.min(n);
        if start >= end {
            return Ok(Vec::new());
        }
        let mut out = Vec::with_capacity(end - start);
        for i in start..end {
            let lo = ofs[i] as usize;
            let hi = ofs[i + 1] as usize;
            let slice = &mmap[lo..hi];
            let trimmed = strip_eol(slice);
            let (cow, _, _) = self.encoding.decode(trimmed);
            // Replace tab with 4 spaces and strip other control chars except common
            let s = sanitize(cow.as_ref());
            out.push(s);
        }
        Ok(out)
    }

    /// Read arbitrary (not necessarily contiguous) line indices in one pass.
    pub fn read_lines_by_indices(&self, indices: &[u32]) -> Result<Vec<String>> {
        let ofs = self.offsets.read();
        let mmap = self.mmap.read();
        let n = if ofs.len() <= 1 { 0 } else { ofs.len() - 1 };
        let mut out = Vec::with_capacity(indices.len());
        for &idx in indices {
            let i = idx as usize;
            if i >= n {
                out.push(String::new());
                continue;
            }
            let lo = ofs[i] as usize;
            let hi = ofs[i + 1] as usize;
            let slice = &mmap[lo..hi];
            let trimmed = strip_eol(slice);
            let (cow, _, _) = self.encoding.decode(trimmed);
            out.push(sanitize(cow.as_ref()));
        }
        Ok(out)
    }

    /// Read raw bytes of line `idx` (without decoding), used for search.
    pub fn line_bytes<'a>(&self, mmap: &'a [u8], idx: usize) -> Option<&'a [u8]> {
        let ofs = self.offsets.read();
        let n = if ofs.len() <= 1 { 0 } else { ofs.len() - 1 };
        if idx >= n {
            return None;
        }
        let lo = ofs[idx] as usize;
        let hi = ofs[idx + 1] as usize;
        Some(strip_eol(&mmap[lo..hi]))
    }

    /// Re-map the file and append new line offsets. Used by tail watcher
    /// when file size grows.
    pub fn refresh_append(&self) -> Result<usize> {
        let file = File::open(&self.path)?;
        let new_len = file.metadata()?.len();
        let old_len = self.size();

        if new_len < old_len {
            // file was truncated/rotated — re-index from scratch
            let mmap = unsafe { Mmap::map(&file) }?;
            let offsets = build_line_offsets(&mmap);
            *self.mmap.write() = mmap;
            *self.offsets.write() = offsets;
            let ofs = self.offsets.read();
            return Ok(if ofs.len() <= 1 { 0 } else { ofs.len() - 1 });
        }
        if new_len == old_len {
            let ofs = self.offsets.read();
            return Ok(if ofs.len() <= 1 { 0 } else { ofs.len() - 1 });
        }

        // Remap (mmap is cheap)
        let mmap = unsafe { Mmap::map(&file) }?;
        // Scan only the new region [old_len, new_len)
        let slice = &mmap[old_len as usize..new_len as usize];
        let mut new_offsets: Vec<u64> = Vec::new();
        for pos in memchr_iter(b'\n', slice) {
            // offset of next line start = old_len + pos + 1
            let off = old_len + pos as u64 + 1;
            new_offsets.push(off);
        }
        {
            let mut o = self.offsets.write();
            // Replace the trailing sentinel (old file length) with actual line starts,
            // then push the new sentinel (new file length).
            if let Some(last) = o.last().copied() {
                if last == old_len {
                    o.pop();
                }
            }
            // If the last pre-existing char wasn't \n, the partial trailing line
            // remains merged into the first new "line" — which is the correct behavior.
            o.extend_from_slice(&new_offsets);
            o.push(new_len);
        }
        *self.mmap.write() = mmap;
        let ofs = self.offsets.read();
        Ok(if ofs.len() <= 1 { 0 } else { ofs.len() - 1 })
    }

    pub fn with_mmap<R>(&self, f: impl FnOnce(&[u8]) -> R) -> R {
        let mmap = self.mmap.read();
        f(&mmap)
    }

    /// Cheap clone of the line-offset table. Useful for parallel scans where
    /// per-line `RwLock::read()` would otherwise become a bottleneck.
    pub fn offsets_snapshot(&self) -> Vec<u64> {
        self.offsets.read().clone()
    }
}

fn build_line_offsets(mmap: &[u8]) -> Vec<u64> {
    let mut offsets: Vec<u64> = Vec::with_capacity(mmap.len() / 80 + 2);
    offsets.push(0);
    for pos in memchr_iter(b'\n', mmap) {
        offsets.push(pos as u64 + 1);
    }
    let total = mmap.len() as u64;
    if offsets.last().copied() != Some(total) {
        offsets.push(total);
    }
    offsets
}

fn strip_eol(slice: &[u8]) -> &[u8] {
    let mut end = slice.len();
    if end > 0 && slice[end - 1] == b'\n' {
        end -= 1;
    }
    if end > 0 && slice[end - 1] == b'\r' {
        end -= 1;
    }
    &slice[..end]
}

fn detect_encoding(mmap: &[u8]) -> &'static Encoding {
    // Check BOM first
    if mmap.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return UTF_8;
    }
    if mmap.starts_with(&[0xFF, 0xFE]) {
        return encoding_rs::UTF_16LE;
    }
    if mmap.starts_with(&[0xFE, 0xFF]) {
        return encoding_rs::UTF_16BE;
    }
    // Sample up to 128KB for detection
    let sample = &mmap[..mmap.len().min(128 * 1024)];
    let mut det = chardetng::EncodingDetector::new();
    det.feed(sample, true);
    det.guess(None, true)
}

fn sanitize(s: &str) -> String {
    // Expand tabs, drop NUL & weird control chars (keep common whitespace)
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '\t' => out.push_str("    "),
            '\0'..='\u{0008}' | '\u{000B}'..='\u{001F}' | '\u{007F}' => {}
            _ => out.push(c),
        }
    }
    out
}

/// Look up the line number containing a given absolute byte offset.
/// Returns (line_idx, col_offset_within_line).
#[allow(dead_code)]
pub fn byte_to_line(offsets: &[u64], byte: u64) -> (usize, usize) {
    // offsets is sorted; use binary search for the greatest offset <= byte.
    match offsets.binary_search(&byte) {
        Ok(i) => (i, 0),
        Err(i) => {
            let line = i.saturating_sub(1);
            let start = offsets[line];
            (line, (byte - start) as usize)
        }
    }
}

#[allow(dead_code)]
pub fn ensure_exists(path: &Path) -> Result<()> {
    if !path.exists() {
        return Err(anyhow!("file does not exist: {}", path.display()));
    }
    Ok(())
}
