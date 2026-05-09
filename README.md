# LogMaster

Fast, lightweight, modern log viewer built with **Tauri 2 + Rust + React**.

## Features

- ⚡ **Blazing fast** — memory-mapped (mmap) files with SIMD line indexing. GB-scale files open in seconds.
- 🪶 **Lightweight** — single portable executable (~10–15 MB), ~80 MB RAM idle.
- 🎨 **Highlight rules** — built-in rules for ERROR / WARN / INFO / DEBUG, fully customizable (regex, colors, bold).
- 🔎 **Search** — literal & regex, case-sensitive toggle, yellow in-place highlight.
- 📡 **Live tail** — follow growing log files in real time, handles log rotation / truncation.
- 🌙 **Modern dark IDE UI** — React + Tailwind + shadcn-inspired components.
- ⌨️ **Keyboard first** — `Ctrl+O` open · `Ctrl+F` find · `Ctrl+Shift+P` command palette.

## Architecture

```
Frontend (WebView) — React + TS + Tailwind + cmdk + @tanstack/react-virtual
        ▲ IPC
        ▼
Backend (Rust) — memmap2 · memchr · regex · notify · chardetng
```

- Rust backend holds the `Mmap` and a `Vec<u64>` of per-line byte offsets.
- Frontend's virtual scroller only renders ~50 DOM rows; line chunks (500 lines) are fetched on demand and cached.
- Tail watcher uses `notify` + ~30 Hz throttling to batch-emit append events.

## Development

Prerequisites: Node.js 18+, Rust 1.77+, and the Tauri prerequisites for your OS.

```bash
npm install
npm run tauri:dev      # safe: auto-frees port 1420 first
# or
npm run tauri dev      # raw
```

If port 1420 is stuck from a previous session, just run:

```bash
npm run kill:port
```

## Build

```bash
npm run tauri build
```

Output: `src-tauri/target/release/logmaster.exe` (≈ 10–15 MB, single file portable).

## Keybindings

| Shortcut | Action |
|----------|--------|
| `Ctrl+O` | Open file |
| `Ctrl+F` | Focus find |
| `Ctrl+Shift+P` | Command palette |

## Roadmap

- [ ] Filter-in / filter-out modes producing a view-only projection
- [ ] Bookmarks with `F2` navigation
- [ ] Minimap with hit density
- [ ] Multi-file time-aligned merge
- [ ] Import/export rule packs
