use crate::log_file::LogFile;
use anyhow::Result;
use regex::bytes::RegexBuilder;
use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
pub struct SearchHit {
    pub line: usize,
    pub col_start: usize,
    pub col_end: usize,
}

pub fn search(
    file: &LogFile,
    pattern: &str,
    is_regex: bool,
    case_sensitive: bool,
    max_hits: usize,
) -> Result<Vec<SearchHit>> {
    if pattern.is_empty() {
        return Ok(Vec::new());
    }
    let effective = if is_regex {
        pattern.to_string()
    } else {
        regex::escape(pattern)
    };
    let re = RegexBuilder::new(&effective)
        .case_insensitive(!case_sensitive)
        .build()?;

    // Walk lines; search each line's byte slice.
    let n = file.line_count();
    let mut hits: Vec<SearchHit> = Vec::new();
    file.with_mmap(|mmap| {
        for i in 0..n {
            if hits.len() >= max_hits {
                break;
            }
            let line = match file.line_bytes(mmap, i) {
                Some(b) => b,
                None => continue,
            };
            for m in re.find_iter(line) {
                hits.push(SearchHit {
                    line: i,
                    col_start: byte_to_char(line, m.start()),
                    col_end: byte_to_char(line, m.end()),
                });
                if hits.len() >= max_hits {
                    break;
                }
            }
        }
    });
    Ok(hits)
}

/// Convert byte offset to char offset in a UTF-8 string.
/// Columns in the frontend are chars (for correct highlighting with CJK).
fn byte_to_char(bytes: &[u8], byte_off: usize) -> usize {
    // Best-effort: if invalid UTF-8 we count bytes (acceptable for ASCII logs).
    let s = match std::str::from_utf8(&bytes[..byte_off.min(bytes.len())]) {
        Ok(s) => s,
        Err(_) => return byte_off,
    };
    s.chars().count()
}
