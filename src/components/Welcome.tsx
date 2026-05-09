import { FolderOpen, Keyboard, Radio, Zap, Sparkles } from "lucide-react";
import { openDialog } from "../lib/dialog";
import { openFile } from "../lib/ipc";
import { useAppStore } from "../store/app";
import { useRecentStore } from "../store/recent";

export function Welcome() {
  const addTab = useAppStore((s) => s.addTab);
  const pushFile = useRecentStore((s) => s.pushFile);

  async function open() {
    const p = await openDialog();
    if (!p) return;
    const info = await openFile(p);
    addTab(info);
    pushFile({ path: info.path, name: info.name });
  }

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-xl w-full space-y-8">
        <div className="space-y-2 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-gradient-to-br from-brand to-accent mb-2">
            <Zap className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-3xl font-semibold text-fg tracking-tight">
            LogMaster
          </h1>
          <p className="text-fg-muted text-sm">
            Fast, lightweight, modern log viewer.
          </p>
          <p className="text-fg-subtle text-xs">by miles</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Feature
            icon={<Zap className="w-4 h-4 text-accent" />}
            title="Blazing fast"
            desc="mmap + SIMD indexing handles multi-GB files"
          />
          <Feature
            icon={<Sparkles className="w-4 h-4 text-brand" />}
            title="Highlight rules"
            desc="Regex coloring, filter-in / filter-out"
          />
          <Feature
            icon={<Radio className="w-4 h-4 text-accent" />}
            title="Live tail"
            desc="Follow growing log files in real time"
          />
          <Feature
            icon={<Keyboard className="w-4 h-4 text-brand" />}
            title="Keyboard first"
            desc="Ctrl+O open · Ctrl+Shift+P command palette"
          />
        </div>

        <div className="flex items-center justify-center">
          <button
            onClick={open}
            className="btn btn-primary px-4 py-2"
          >
            <FolderOpen className="w-4 h-4" />
            Open a log file
          </button>
        </div>
      </div>
    </div>
  );
}

function Feature({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-panel p-3 hover:border-border-strong transition-colors">
      <div className="flex items-center gap-2 text-sm font-medium text-fg">
        {icon}
        {title}
      </div>
      <p className="text-xs text-fg-muted mt-1">{desc}</p>
    </div>
  );
}
