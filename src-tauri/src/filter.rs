use crate::log_file::LogFile;
use anyhow::Result;
use rayon::prelude::*;
use regex::bytes::{RegexSet, RegexSetBuilder};
use serde::Deserialize;
use std::time::Instant;

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub enum FilterAction {
    FilterIn,
    FilterOut,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub enum FilterCombineMode {
    Or,
    And,
}

#[derive(Deserialize, Clone, Debug)]
pub struct FilterRule {
    pub pattern: String,
    #[serde(default)]
    pub is_regex: bool,
    #[serde(default)]
    pub case_sensitive: bool,
    pub action: FilterAction,
}

/// Compute the visible physical line indices.
///
/// Performance:
///   - Patterns are merged into RegexSet (Aho-Corasick / lazy DFA, much
///     faster than running each Regex independently).
///   - Lines are scanned in parallel via rayon, with line offsets snapshotted
///     once up-front so worker threads don't fight a RwLock per line.
///
/// Combine mode:
///   - OR (default): a line is shown if it matches ANY include rule.
///   - AND: a line is shown only if it matches ALL include rules.
///   Exclude rules are always OR — matching any exclude rule hides the line.
pub fn filter_lines(
    file: &LogFile,
    rules: &[FilterRule],
    combine_mode: FilterCombineMode,
) -> Result<Vec<u32>> {
    let t0 = Instant::now();

    let mut inc_patterns: Vec<String> = Vec::new();
    let mut exc_patterns: Vec<String> = Vec::new();
    let mut case_inc = true;
    let mut case_exc = true;
    for r in rules {
        let src = if r.is_regex {
            r.pattern.clone()
        } else {
            regex::escape(&r.pattern)
        };
        match r.action {
            FilterAction::FilterIn => {
                inc_patterns.push(src);
                if r.case_sensitive {
                    case_inc = false;
                }
            }
            FilterAction::FilterOut => {
                exc_patterns.push(src);
                if r.case_sensitive {
                    case_exc = false;
                }
            }
        }
    }

    let inc_set = if !inc_patterns.is_empty() {
        Some(
            RegexSetBuilder::new(&inc_patterns)
                .case_insensitive(case_inc)
                .build()?,
        )
    } else {
        None
    };
    let exc_set = if !exc_patterns.is_empty() {
        Some(
            RegexSetBuilder::new(&exc_patterns)
                .case_insensitive(case_exc)
                .build()?,
        )
    } else {
        None
    };

    let has_include = inc_set.is_some();
    let inc_count = inc_patterns.len();
    let n = file.line_count();
    let t_compile = t0.elapsed();

    // Snapshot offsets ONCE so threads don't contend on the RwLock per line.
    let offsets = file.offsets_snapshot();
    let t_snapshot = t0.elapsed();

    let out: Vec<u32> = file.with_mmap(|mmap| {
        // Per-thread chunked scan. Each chunk produces a Vec<u32> of matches;
        // we then concatenate them in order. This avoids rayon's reduce
        // overhead (which is significant for short, cheap predicates).
        const CHUNK: usize = 32_768;
        let chunks: Vec<(usize, usize)> = (0..n)
            .step_by(CHUNK)
            .map(|s| (s, (s + CHUNK).min(n)))
            .collect();

        let partials: Vec<Vec<u32>> = chunks
            .par_iter()
            .map(|&(start, end)| {
                let mut local: Vec<u32> = Vec::with_capacity((end - start) / 16);
                for i in start..end {
                    let lo = offsets[i] as usize;
                    let hi = offsets[i + 1] as usize;
                    let line = strip_eol(&mmap[lo..hi]);
                    if check_visibility(
                        line,
                        has_include,
                        &inc_set,
                        &exc_set,
                        &combine_mode,
                        inc_count,
                    ) {
                        local.push(i as u32);
                    }
                }
                local
            })
            .collect();

        // Concat in order. partials are already in physical-line order because
        // chunks were ordered and rayon preserves index order via collect.
        let total: usize = partials.iter().map(|v| v.len()).sum();
        let mut merged: Vec<u32> = Vec::with_capacity(total);
        for v in partials {
            merged.extend_from_slice(&v);
        }
        merged
    });

    let t_total = t0.elapsed();
    eprintln!(
        "[filter_lines] n={n} hits={} compile={:?} snapshot={:?} scan={:?} total={:?} threads={}",
        out.len(),
        t_compile,
        t_snapshot - t_compile,
        t_total - t_snapshot,
        t_total,
        rayon::current_num_threads()
    );

    Ok(out)
}

#[inline]
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

#[inline]
fn check_visibility(
    line: &[u8],
    has_include: bool,
    inc_set: &Option<RegexSet>,
    exc_set: &Option<RegexSet>,
    combine_mode: &FilterCombineMode,
    inc_count: usize,
) -> bool {
    let visible = if has_include {
        match combine_mode {
            FilterCombineMode::Or => inc_set
                .as_ref()
                .map(|s| s.is_match(line))
                .unwrap_or(false),
            FilterCombineMode::And => inc_set
                .as_ref()
                .map(|s| s.matches(line).iter().count() == inc_count)
                .unwrap_or(false),
        }
    } else {
        true
    };
    if !visible {
        return false;
    }
    if let Some(s) = exc_set.as_ref() {
        if s.is_match(line) {
            return false;
        }
    }
    true
}
