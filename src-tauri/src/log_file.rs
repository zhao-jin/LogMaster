use anyhow::{anyhow, Result};
use encoding_rs::{Encoding, UTF_8};
use memchr::memchr_iter;
use parking_lot::RwLock;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Open a file with maximum sharing flags so it doesn't block external
/// processes from writing/renaming/deleting it while we have it open.
///
/// On Windows the default `File::open` requests `GENERIC_READ` with only
/// `FILE_SHARE_READ`, which means another process cannot rename or delete
/// the file while LogMaster has it open. We override that with
/// `FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE` (= 0x7).
///
/// **Important**: we deliberately do NOT keep this `File` alive for the
/// lifetime of the `LogFile` (and we do NOT `mmap` it). Holding a long-
/// lived handle — and especially a memory-mapped section — prevents
/// other processes from `CreateFile(..., CREATE_ALWAYS, ...)`-overwriting
/// the log (Windows raises `ERROR_USER_MAPPED_FILE` / 1224 in that case).
/// UE4 / UE5 starts each run by truncating its log via `CREATE_ALWAYS`,
/// which would fail if we held a mapping.
///
/// Instead we slurp the whole file into an `Arc<Vec<u8>>` and immediately
/// drop the `File`. The frontend's tail watcher polls for size growth and
/// re-opens / reloads as needed.
fn open_shared(path: &Path) -> Result<File> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_SHARE_READ: u32 = 0x1;
        const FILE_SHARE_WRITE: u32 = 0x2;
        const FILE_SHARE_DELETE: u32 = 0x4;
        let f = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
            .open(path)?;
        Ok(f)
    }
    #[cfg(not(windows))]
    {
        Ok(File::open(path)?)
    }
}

/// Read the entire file into a buffer using a shared-mode handle, then
/// drop the handle so we don't hold a SECTION/lock that would block
/// external truncation. Returns the loaded bytes.
fn slurp_shared(path: &Path) -> Result<Vec<u8>> {
    let mut f = open_shared(path)?;
    let len = f.metadata().map(|m| m.len() as usize).unwrap_or(0);
    let mut buf: Vec<u8> = Vec::with_capacity(len);
    f.read_to_end(&mut buf)?;
    Ok(buf)
}

/// Read only the tail region `[from, file_end)`.
fn slurp_tail(path: &Path, from: u64) -> Result<Vec<u8>> {
    let mut f = open_shared(path)?;
    let total = f.metadata()?.len();
    if from >= total {
        return Ok(Vec::new());
    }
    f.seek(SeekFrom::Start(from))?;
    let mut buf: Vec<u8> = Vec::with_capacity((total - from) as usize);
    f.read_to_end(&mut buf)?;
    Ok(buf)
}

/// An opened log file: owns a read-only byte buffer of the file content
/// and a sorted Vec of line offsets.
///
/// Why not `mmap`? See [`open_shared`]. TL;DR — mmap on Windows holds a
/// file-section reference that blocks `CREATE_ALWAYS` from other
/// processes (UE4/UE5 fails to start). Buffering the bytes lets external
/// programs freely rotate / overwrite the file; the frontend's existence
/// & size polling drives reload.
///
/// `line_offsets[i]` = byte offset of the start of line i.
/// The sentinel last element equals current buffer length, so the length
/// of line i is `line_offsets[i+1] - line_offsets[i]` (trailing \n/\r
/// included, which we strip on read).
pub struct LogFile {
    pub path: PathBuf,
    pub encoding: &'static Encoding,
    /// Owned byte buffer of the file content. Wrapped in `Arc` so
    /// readers can cheaply clone the snapshot and drop the lock before
    /// long scans, but we still hold it via an `RwLock` so tail-append
    /// can swap in a grown buffer atomically.
    bytes: RwLock<Arc<Vec<u8>>>,
    /// First element is 0, last element is current buffer length.
    /// len == line_count + 1.
    offsets: RwLock<Vec<u64>>,
}

impl LogFile {
    pub fn open(path: &Path) -> Result<Self> {
        let buf = slurp_shared(path)?;
        let encoding = detect_encoding(&buf);
        let offsets = build_line_offsets(&buf);
        Ok(Self {
            path: path.to_path_buf(),
            encoding,
            bytes: RwLock::new(Arc::new(buf)),
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

    /// Cheap clone of the current byte snapshot. Holds a reference until
    /// the returned `Arc` is dropped, but does NOT hold the `RwLock`.
    fn bytes_snapshot(&self) -> Arc<Vec<u8>> {
        self.bytes.read().clone()
    }

    /// Return decoded strings for lines in `[start, end)`.
    pub fn read_lines(&self, start: usize, end: usize) -> Result<Vec<String>> {
        let ofs = self.offsets.read();
        let buf = self.bytes_snapshot();
        let bytes: &[u8] = &buf;
        let n = if ofs.len() <= 1 { 0 } else { ofs.len() - 1 };
        let end = end.min(n);
        if start >= end {
            return Ok(Vec::new());
        }
        let mut out = Vec::with_capacity(end - start);
        for i in start..end {
            let lo = ofs[i] as usize;
            let hi = ofs[i + 1] as usize;
            let slice = &bytes[lo..hi];
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
        let buf = self.bytes_snapshot();
        let bytes: &[u8] = &buf;
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
            let slice = &bytes[lo..hi];
            let trimmed = strip_eol(slice);
            let (cow, _, _) = self.encoding.decode(trimmed);
            out.push(sanitize(cow.as_ref()));
        }
        Ok(out)
    }

    /// Binary-packed version of `read_lines` — returns a single `Vec<u8>`
    /// shaped as:
    ///   [u32 count]
    ///   ([u32 byte_len] [utf-8 bytes])*
    ///
    /// All integers little-endian. Designed to be streamed straight to the
    /// frontend via `tauri::ipc::Response` (raw binary body) so we avoid
    /// JSON serialization entirely — this is the hot path for scroll
    /// prefetching where a 2000-line chunk is requested many times per
    /// second during drag-scroll.
    pub fn read_lines_packed(&self, start: usize, end: usize) -> Result<Vec<u8>> {
        let ofs = self.offsets.read();
        let buf = self.bytes_snapshot();
        let bytes: &[u8] = &buf;
        let n = if ofs.len() <= 1 { 0 } else { ofs.len() - 1 };
        let end = end.min(n);
        let count = if start >= end { 0 } else { end - start };

        let mut bytes_guess = 4 + count * 4;
        if count > 0 {
            bytes_guess += (ofs[end] - ofs[start]) as usize;
        }
        let mut out: Vec<u8> = Vec::with_capacity(bytes_guess);
        out.extend_from_slice(&(count as u32).to_le_bytes());

        if count == 0 {
            return Ok(out);
        }
        for i in start..end {
            let lo = ofs[i] as usize;
            let hi = ofs[i + 1] as usize;
            let slice = &bytes[lo..hi];
            let trimmed = strip_eol(slice);
            let (cow, _, _) = self.encoding.decode(trimmed);
            let decoded = cow.as_ref();
            write_sanitized(&mut out, decoded);
        }
        Ok(out)
    }

    /// Binary-packed version of `read_lines_by_indices`. Same wire format
    /// as `read_lines_packed`.
    pub fn read_lines_by_indices_packed(&self, indices: &[u32]) -> Result<Vec<u8>> {
        let ofs = self.offsets.read();
        let buf = self.bytes_snapshot();
        let bytes: &[u8] = &buf;
        let n = if ofs.len() <= 1 { 0 } else { ofs.len() - 1 };

        let mut out: Vec<u8> = Vec::with_capacity(4 + indices.len() * 80);
        out.extend_from_slice(&(indices.len() as u32).to_le_bytes());

        for &idx in indices {
            let i = idx as usize;
            if i >= n {
                out.extend_from_slice(&0u32.to_le_bytes());
                continue;
            }
            let lo = ofs[i] as usize;
            let hi = ofs[i + 1] as usize;
            let slice = &bytes[lo..hi];
            let trimmed = strip_eol(slice);
            let (cow, _, _) = self.encoding.decode(trimmed);
            write_sanitized(&mut out, cow.as_ref());
        }
        Ok(out)
    }

    /// Read raw bytes of line `idx` (without decoding), used for search.
    pub fn line_bytes<'a>(&self, bytes: &'a [u8], idx: usize) -> Option<&'a [u8]> {
        let ofs = self.offsets.read();
        let n = if ofs.len() <= 1 { 0 } else { ofs.len() - 1 };
        if idx >= n {
            return None;
        }
        let lo = ofs[idx] as usize;
        let hi = ofs[idx + 1] as usize;
        Some(strip_eol(&bytes[lo..hi]))
    }

    /// Re-read the file and append new line offsets. Used by tail watcher
    /// when file size grows.
    ///
    /// On rotation/truncation (new size < old size, or first byte
    /// changed) we do a full reload. Otherwise we only read the tail
    /// segment `[old_size, new_size)` and extend the buffer in place.
    pub fn refresh_append(&self) -> Result<usize> {
        let old_len = self.size();
        let new_len = std::fs::metadata(&self.path).map(|m| m.len()).unwrap_or(0);

        if new_len == old_len {
            let ofs = self.offsets.read();
            return Ok(if ofs.len() <= 1 { 0 } else { ofs.len() - 1 });
        }

        if new_len < old_len {
            // file was truncated/rotated — re-index from scratch
            return self.reload();
        }

        // Try to extend: read only the new tail bytes.
        let tail = match slurp_tail(&self.path, old_len) {
            Ok(t) => t,
            Err(_) => return self.reload(),
        };

        // Build new line offsets relative to the full buffer.
        let mut new_offsets: Vec<u64> = Vec::new();
        for pos in memchr_iter(b'\n', &tail) {
            let off = old_len + pos as u64 + 1;
            new_offsets.push(off);
        }

        // Swap in extended bytes buffer.
        let extended: Vec<u8> = {
            let cur = self.bytes.read().clone();
            let mut v: Vec<u8> = Vec::with_capacity(cur.len() + tail.len());
            v.extend_from_slice(&cur);
            v.extend_from_slice(&tail);
            v
        };
        let final_len = extended.len() as u64;
        *self.bytes.write() = Arc::new(extended);

        {
            let mut o = self.offsets.write();
            // Replace the trailing sentinel (old buffer length) with actual line starts,
            // then push the new sentinel (new buffer length).
            if let Some(last) = o.last().copied() {
                if last == old_len {
                    o.pop();
                }
            }
            // If the last pre-existing char wasn't \n, the partial trailing line
            // remains merged into the first new "line" — which is the correct behavior.
            o.extend_from_slice(&new_offsets);
            o.push(final_len);
        }

        let ofs = self.offsets.read();
        Ok(if ofs.len() <= 1 { 0 } else { ofs.len() - 1 })
    }

    /// Run `f` against an immutable snapshot of the file's bytes. The
    /// snapshot is held only via an `Arc` clone — no `RwLock` is held
    /// for the duration of the closure, so this is safe to use from
    /// long-running parallel scans (search / filter).
    pub fn with_mmap<R>(&self, f: impl FnOnce(&[u8]) -> R) -> R {
        let snap = self.bytes_snapshot();
        f(&snap)
    }

    /// Force a full reload of the file from disk: re-detect encoding,
    /// rebuild the offset table, swap in a fresh byte buffer. Used by
    /// the per-tab "reload" button and by `refresh_append` whenever
    /// the file shrinks (rotation / truncation / full rewrite).
    pub fn reload(&self) -> Result<usize> {
        let buf = slurp_shared(&self.path)?;
        let offsets = build_line_offsets(&buf);
        *self.bytes.write() = Arc::new(buf);
        *self.offsets.write() = offsets;
        let ofs = self.offsets.read();
        Ok(if ofs.len() <= 1 { 0 } else { ofs.len() - 1 })
    }

    /// Cheap clone of the line-offset table. Useful for parallel scans where
    /// per-line `RwLock::read()` would otherwise become a bottleneck.
    pub fn offsets_snapshot(&self) -> Vec<u64> {
        self.offsets.read().clone()
    }
}

fn build_line_offsets(buf: &[u8]) -> Vec<u64> {
    let mut offsets: Vec<u64> = Vec::with_capacity(buf.len() / 80 + 2);
    offsets.push(0);
    for pos in memchr_iter(b'\n', buf) {
        offsets.push(pos as u64 + 1);
    }
    let total = buf.len() as u64;
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

fn detect_encoding(buf: &[u8]) -> &'static Encoding {
    // Check BOM first
    if buf.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return UTF_8;
    }
    if buf.starts_with(&[0xFF, 0xFE]) {
        return encoding_rs::UTF_16LE;
    }
    if buf.starts_with(&[0xFE, 0xFF]) {
        return encoding_rs::UTF_16BE;
    }
    // Sample up to 128KB for detection
    let sample = &buf[..buf.len().min(128 * 1024)];
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

/// Like [`sanitize`] but streams directly into a byte buffer, preceded by a
/// u32 little-endian length. Used by the binary-packed read paths so we
/// don't allocate an intermediate `String` per line.
fn write_sanitized(out: &mut Vec<u8>, s: &str) {
    // Reserve a slot for the length; we'll patch it after encoding.
    let len_pos = out.len();
    out.extend_from_slice(&0u32.to_le_bytes());

    let start = out.len();
    // Fast ASCII path: if the whole string is ASCII with no tabs/controls
    // we can copy wholesale. This covers most log lines.
    let bytes = s.as_bytes();
    let mut all_ascii_clean = true;
    for &b in bytes {
        if b == b'\t' || b < 0x20 || b == 0x7F {
            all_ascii_clean = false;
            break;
        }
        if b >= 0x80 {
            // Might still be clean UTF-8 multi-byte; fall through to the
            // slow path to handle control chars embedded in non-ASCII text.
            all_ascii_clean = false;
            break;
        }
    }
    if all_ascii_clean {
        out.extend_from_slice(bytes);
    } else {
        // Buffer tab expansion inline, drop bad controls.
        let mut tmp = [0u8; 4];
        for c in s.chars() {
            match c {
                '\t' => out.extend_from_slice(b"    "),
                '\0'..='\u{0008}' | '\u{000B}'..='\u{001F}' | '\u{007F}' => {}
                _ => {
                    let encoded = c.encode_utf8(&mut tmp);
                    out.extend_from_slice(encoded.as_bytes());
                }
            }
        }
    }

    let written = (out.len() - start) as u32;
    out[len_pos..len_pos + 4].copy_from_slice(&written.to_le_bytes());
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
