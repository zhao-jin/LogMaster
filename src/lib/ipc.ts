import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface FileInfo {
  id: string;
  path: string;
  name: string;
  size: number;
  line_count: number;
  encoding: string;
}

export interface LineRange {
  start: number; // inclusive
  end: number;   // exclusive
  lines: string[];
}

export interface SearchHit {
  line: number;
  col_start: number;
  col_end: number;
}

export type FilterMode = "none" | "in" | "out";

export interface Rule {
  id: string;
  name: string;
  pattern: string;
  is_regex: boolean;
  case_sensitive: boolean;
  /** Whether to apply fg/bg/bold to matched text */
  highlight: boolean;
  /** Filter behavior, independent of highlight */
  filter: FilterMode;
  fg?: string;
  bg?: string;
  bold: boolean;
  enabled: boolean;
}

export async function openFile(path: string): Promise<FileInfo> {
  return invoke<FileInfo>("open_file", { path });
}

export async function closeFile(id: string): Promise<void> {
  return invoke("close_file", { id });
}

export async function readLines(
  id: string,
  start: number,
  end: number
): Promise<LineRange> {
  // Prefer the binary-packed path — ~3-5x faster than JSON invoke on
  // 2000-line chunks because we skip string allocation and JSON
  // serialization on both sides.
  const buf = await invoke<ArrayBuffer>("read_lines_bin", { id, start, end });
  const lines = unpackLines(buf);
  return { start, end: start + lines.length, lines };
}

export async function readLinesByIndices(
  id: string,
  indices: number[]
): Promise<string[]> {
  const buf = await invoke<ArrayBuffer>("read_lines_by_indices_bin", {
    id,
    indices,
  });
  return unpackLines(buf);
}

/**
 * Decode the binary wire format produced by the Rust `*_packed` functions:
 *   [u32 count] ([u32 byte_len] [utf-8 bytes])*     (all little-endian)
 *
 * Uses a single shared `TextDecoder`; `TextDecoder.decode` accepts a view
 * into the source buffer without copying, which makes this roughly as
 * fast as we can do string creation from bytes in the browser.
 */
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: false });
function unpackLines(buf: ArrayBuffer): string[] {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const count = view.getUint32(0, true);
  const out = new Array<string>(count);
  let off = 4;
  for (let i = 0; i < count; i++) {
    const len = view.getUint32(off, true);
    off += 4;
    if (len === 0) {
      out[i] = "";
    } else {
      // subarray is a view, not a copy — TextDecoder.decode handles it.
      out[i] = TEXT_DECODER.decode(bytes.subarray(off, off + len));
      off += len;
    }
  }
  return out;
}

export interface FilterRuleDto {
  pattern: string;
  is_regex: boolean;
  case_sensitive: boolean;
  action: "filter_in" | "filter_out";
}

export async function filterLines(
  id: string,
  rules: FilterRuleDto[]
): Promise<number[]> {
  // Tauri returns Uint32 as number[] via JSON; use Array.from in case of typed array.
  const r = await invoke<number[] | Uint32Array>("filter_lines", {
    id,
    rules,
  });
  return Array.isArray(r) ? r : Array.from(r);
}

export async function searchFile(
  id: string,
  pattern: string,
  isRegex: boolean,
  caseSensitive: boolean,
  maxHits: number
): Promise<SearchHit[]> {
  return invoke<SearchHit[]>("search_file", {
    id,
    pattern,
    isRegex,
    caseSensitive,
    maxHits,
  });
}

export async function startTail(id: string): Promise<void> {
  return invoke("start_tail", { id });
}

export async function stopTail(id: string): Promise<void> {
  return invoke("stop_tail", { id });
}

export interface DirEntryInfo {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: number;
}

export interface DeleteResult {
  path: string;
  ok: boolean;
  error: string | null;
}

export async function listDir(path: string): Promise<DirEntryInfo[]> {
  return invoke<DirEntryInfo[]>("list_dir", { path });
}

export async function deletePaths(
  paths: string[],
  recursive = false
): Promise<DeleteResult[]> {
  return invoke<DeleteResult[]>("delete_paths", { paths, recursive });
}

export async function fileExists(path: string): Promise<boolean> {
  return invoke<boolean>("file_exists", { path });
}

export async function reloadFile(id: string): Promise<number> {
  return invoke<number>("reload_file", { id });
}

export interface TailEvent {
  id: string;
  new_line_count: number; // current total
}

export async function onTail(
  cb: (e: TailEvent) => void
): Promise<UnlistenFn> {
  return listen<TailEvent>("log:append", (evt) => cb(evt.payload));
}
