import { useEffect, useState } from "react";
import {
  ArrowUp,
  File as FileIcon,
  Folder as FolderIcon,
  X,
  RefreshCw,
} from "lucide-react";
import { listDir, openFile, type DirEntryInfo } from "../lib/ipc";
import { useAppStore } from "../store/app";
import { useRecentStore } from "../store/recent";
import { formatBytes } from "../lib/utils";

interface Props {
  open: boolean;
  initialPath: string | null;
  onClose: () => void;
}

export function FolderBrowser({ open, initialPath, onClose }: Props) {
  const { addTab } = useAppStore();
  const recent = useRecentStore();
  const [path, setPath] = useState<string | null>(initialPath);
  const [entries, setEntries] = useState<DirEntryInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPath(initialPath);
  }, [initialPath]);

  useEffect(() => {
    if (!open || !path) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    listDir(path)
      .then((es) => {
        if (!cancelled) setEntries(es);
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, path]);

  if (!open || !path) return null;

  function up() {
    if (!path) return;
    const parts = path.split(/[\\/]/);
    parts.pop();
    const parent = parts.join("/");
    if (parent && parent !== path) setPath(parent);
  }

  async function selectFile(entry: DirEntryInfo) {
    try {
      const info = await openFile(entry.path);
      addTab(info);
      recent.pushFile({ path: info.path, name: info.name });
      onClose();
    } catch (e) {
      alert(`Failed to open: ${e}`);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-[10vh]"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[720px] max-w-[92vw] max-h-[78vh] flex flex-col bg-bg-panel border border-border rounded-lg shadow-2xl overflow-hidden"
      >
        <header className="flex items-center gap-2 px-3 py-2 border-b border-border">
          <FolderIcon className="w-4 h-4 text-brand" />
          <span className="text-sm font-semibold text-fg">Open from folder</span>
          <button
            className="btn ml-auto"
            onClick={() => path && setPath(path)}
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button className="btn" onClick={onClose}>
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
          <button className="btn" onClick={up} title="Parent folder">
            <ArrowUp className="w-4 h-4" />
          </button>
          <input
            className="input flex-1 font-mono text-xs"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setPath((e.target as HTMLInputElement).value);
            }}
          />
        </div>

        <div className="flex-1 overflow-auto">
          {error && (
            <div className="p-4 text-sm text-danger">{error}</div>
          )}
          {loading && (
            <div className="p-4 text-sm text-fg-subtle">Loading…</div>
          )}
          {!loading && !error && entries.length === 0 && (
            <div className="p-6 text-sm text-fg-subtle text-center">
              Empty folder
            </div>
          )}
          {!loading && !error && entries.length > 0 && (
            <ul className="divide-y divide-border/50">
              {entries.map((e) => (
                <li
                  key={e.path}
                  onClick={() =>
                    e.is_dir ? setPath(e.path) : selectFile(e)
                  }
                  className="flex items-center gap-3 px-3 py-1.5 hover:bg-bg-hover cursor-pointer text-sm"
                >
                  {e.is_dir ? (
                    <FolderIcon className="w-4 h-4 text-brand shrink-0" />
                  ) : (
                    <FileIcon className="w-4 h-4 text-fg-muted shrink-0" />
                  )}
                  <span className="flex-1 truncate text-fg">{e.name}</span>
                  {!e.is_dir && (
                    <span className="text-fg-subtle text-xs tabular-nums">
                      {formatBytes(e.size)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
