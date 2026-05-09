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
  return invoke<LineRange>("read_lines", { id, start, end });
}

export async function readLinesByIndices(
  id: string,
  indices: number[]
): Promise<string[]> {
  return invoke<string[]>("read_lines_by_indices", { id, indices });
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

export async function listDir(path: string): Promise<DirEntryInfo[]> {
  return invoke<DirEntryInfo[]>("list_dir", { path });
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
