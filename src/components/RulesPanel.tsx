import { useEffect, useRef, useState } from "react";
import {
  Eye,
  EyeOff,
  Highlighter,
  Plus,
  Trash2,
  X,
  Ban,
  Star,
  History,
  ChevronDown,
  Globe,
} from "lucide-react";
import { useAppStore } from "../store/app";
import type { Rule } from "../lib/ipc";
import { cn } from "../lib/utils";
import { useRuleLibrary, type RuleTemplate } from "../store/ruleLibrary";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function RulesPanel({ open, onClose }: Props) {
  const {
    rules,
    addRule,
    updateRule,
    removeRule,
    setFilterEnabled,
    filterCombineMode,
    setFilterCombineMode,
  } = useAppStore();
  const [libraryOpen, setLibraryOpen] = useState(false);

  if (!open) return null;

  function handleAdd(template?: RuleTemplate) {
    const id = "r-" + Math.random().toString(36).slice(2, 8);
    addRule({
      id,
      name: template?.name ?? "New rule",
      pattern: template?.pattern ?? "",
      is_regex: template?.is_regex ?? false,
      case_sensitive: template?.case_sensitive ?? false,
      highlight: true,
      filter: "none",
      fg: template?.fg ?? "#fef08a",
      bg: template?.bg,
      bold: template?.bold ?? false,
      enabled: true,
    });
  }

  // True when any rule currently has a "Show only" filter active.
  const hasShowOnly = rules.some((r) => r.filter === "in");

  // Disable every rule's "Show only" filter so the full log becomes visible.
  // We don't touch "Hide" rules (filter === "out") or highlighting.
  function clearShowOnly() {
    for (const r of rules) {
      if (r.filter === "in") updateRule(r.id, { filter: "none" });
    }
  }

  return (
    <aside className="h-full flex flex-col bg-bg-panel">
      <header className="flex items-center justify-between px-3 py-2 border-b border-border">
        <h3 className="text-sm font-semibold text-fg">Rules</h3>
        <div className="flex items-center gap-1">
          <button
            className={cn(
              "btn",
              hasShowOnly
                ? "text-brand hover:text-brand"
                : "text-fg-subtle"
            )}
            onClick={clearShowOnly}
            disabled={!hasShowOnly}
            title={
              hasShowOnly
                ? "Show all lines — turn OFF every rule's 'Show only' filter"
                : "All lines already visible (no 'Show only' filters active)"
            }
          >
            <Globe className="w-4 h-4" />
          </button>
          <button
            className={cn(
              "btn font-mono text-xs tabular-nums",
              filterCombineMode === "and"
                ? "text-brand bg-brand/10"
                : "text-fg-subtle"
            )}
            onClick={() =>
              setFilterCombineMode(filterCombineMode === "or" ? "and" : "or")
            }
            title={
              filterCombineMode === "or"
                ? "Filter mode: OR (any matching rule shows the line). Click to switch to AND."
                : "Filter mode: AND (all 'Show only' rules must match). Click to switch to OR."
            }
          >
            {filterCombineMode === "or" ? "||" : "&"}
          </button>
          <button
            className={cn("btn", libraryOpen && "bg-bg-hover text-fg")}
            onClick={() => setLibraryOpen((v) => !v)}
            title="Browse saved patterns and recent history"
          >
            <History className="w-4 h-4" />
            <span className="hidden sm:inline">Library</span>
            <ChevronDown
              className={cn(
                "w-3 h-3 transition-transform",
                libraryOpen && "rotate-180"
              )}
            />
          </button>
          <button className="btn" onClick={() => handleAdd()} title="Add rule">
            <Plus className="w-4 h-4" />
          </button>
          <button className="btn" onClick={onClose} title="Close panel (Ctrl+N)">
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      {libraryOpen && (
        <LibraryDrawer
          onPick={(t) => {
            handleAdd(t);
            setLibraryOpen(false);
          }}
          onClose={() => setLibraryOpen(false)}
        />
      )}

      <div className="px-3 py-2 text-xs text-fg-subtle border-b border-border leading-relaxed">
        <span className="text-warn">Highlight</span> (color) and{" "}
        <span className="text-brand">Filter</span> (visibility) are independent.
        Filter takes effect only when the toolbar's{" "}
        <span className="text-fg">Filter</span> button is on.
      </div>

      <div className="flex-1 overflow-auto p-2 space-y-2">
        {rules.map((r) => (
          <RuleRow
            key={r.id}
            rule={r}
            onChange={(patch) => {
              updateRule(r.id, patch);
              if (patch.filter === "in" || patch.filter === "out") {
                setFilterEnabled(true);
              }
            }}
            onDelete={() => removeRule(r.id)}
          />
        ))}
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/*  Library drawer — Favorites + History                              */
/* ------------------------------------------------------------------ */

function LibraryDrawer({
  onPick,
  onClose: _onClose,
}: {
  onPick: (t: RuleTemplate) => void;
  onClose: () => void;
}) {
  const favorites = useRuleLibrary((s) => s.favorites);
  const history = useRuleLibrary((s) => s.history);
  const removeFav = useRuleLibrary((s) => s.removeFavorite);
  const removeHist = useRuleLibrary((s) => s.removeHistory);
  const renameFav = useRuleLibrary((s) => s.renameFavorite);
  const clearHistory = useRuleLibrary((s) => s.clearHistory);
  const toggleFav = useRuleLibrary((s) => s.toggleFavorite);
  const [tab, setTab] = useState<"fav" | "hist">("fav");

  const list = tab === "fav" ? favorites : history;

  return (
    <div className="border-b border-border bg-bg/40">
      <div className="flex items-center px-2 py-1 border-b border-border text-xs">
        <button
          onClick={() => setTab("fav")}
          className={cn(
            "px-2 py-1 rounded flex items-center gap-1 cursor-pointer",
            tab === "fav"
              ? "bg-warn/15 text-warn"
              : "text-fg-muted hover:text-fg hover:bg-bg-hover"
          )}
        >
          <Star className="w-3 h-3" />
          Favorites
          <span className="text-fg-subtle tabular-nums">
            ({favorites.length})
          </span>
        </button>
        <button
          onClick={() => setTab("hist")}
          className={cn(
            "px-2 py-1 rounded flex items-center gap-1 cursor-pointer ml-1",
            tab === "hist"
              ? "bg-brand/15 text-brand"
              : "text-fg-muted hover:text-fg hover:bg-bg-hover"
          )}
        >
          <History className="w-3 h-3" />
          History
          <span className="text-fg-subtle tabular-nums">
            ({history.length})
          </span>
        </button>
        <div className="flex-1" />
        {tab === "hist" && history.length > 0 && (
          <button
            onClick={clearHistory}
            className="text-fg-subtle hover:text-danger px-2 py-1 cursor-pointer"
            title="Clear all history"
          >
            Clear
          </button>
        )}
      </div>

      <div className="max-h-48 overflow-auto py-1">
        {list.length === 0 ? (
          <div className="px-3 py-4 text-xs text-fg-subtle text-center">
            {tab === "fav"
              ? "No favorites yet. Click ★ on any rule to save it here."
              : "No history yet. Recently-edited patterns appear here."}
          </div>
        ) : (
          list.map((t) => (
            <LibraryRow
              key={t.id}
              entry={t}
              isFav={tab === "fav"}
              onPick={() => onPick(t)}
              onPromoteToFav={() => {
                toggleFav(t);
                setTab("fav");
              }}
              onRename={
                tab === "fav"
                  ? (name) => renameFav(t.id, name)
                  : undefined
              }
              onDelete={() =>
                tab === "fav" ? removeFav(t.id) : removeHist(t.id)
              }
            />
          ))
        )}
      </div>
    </div>
  );
}

function LibraryRow({
  entry,
  isFav,
  onPick,
  onPromoteToFav,
  onRename,
  onDelete,
}: {
  entry: RuleTemplate;
  isFav: boolean;
  onPick: () => void;
  onPromoteToFav: () => void;
  onRename?: (name: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.name);

  return (
    <div className="group flex items-center gap-1.5 px-2 py-1 hover:bg-bg-hover/60">
      {/* Color dot */}
      <span
        className="shrink-0 w-2.5 h-2.5 rounded-sm border border-border"
        style={{
          backgroundColor: entry.bg ?? entry.fg ?? "#64748b",
        }}
      />

      {/* Name (editable for favorites) */}
      <div className="w-[110px] shrink-0 text-xs">
        {editing && onRename ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (draft.trim()) onRename(draft.trim());
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setDraft(entry.name);
                setEditing(false);
              }
            }}
            className="input w-full text-xs px-1 py-0.5"
          />
        ) : (
          <button
            type="button"
            onClick={() => onRename && (setDraft(entry.name), setEditing(true))}
            className={cn(
              "text-left truncate w-full text-fg",
              onRename && "hover:underline cursor-text"
            )}
            title={onRename ? "Click to rename" : entry.name}
          >
            {entry.name || "(unnamed)"}
          </button>
        )}
      </div>

      {/* Pattern preview */}
      <code
        className="flex-1 min-w-0 truncate text-xs font-mono text-fg-muted"
        title={entry.pattern}
      >
        {entry.pattern}
      </code>

      {/* Flags */}
      <div className="shrink-0 flex items-center gap-0.5 text-[10px] text-fg-subtle tabular-nums">
        {entry.is_regex && (
          <span className="px-1 rounded bg-bg-elevated">.*</span>
        )}
        {entry.case_sensitive && (
          <span className="px-1 rounded bg-bg-elevated">Aa</span>
        )}
      </div>

      {/* Actions */}
      <button
        onClick={onPick}
        title="Add as rule"
        className="shrink-0 px-1.5 py-0.5 text-xs rounded text-brand hover:bg-brand/15 cursor-pointer"
      >
        Use
      </button>
      {!isFav && (
        <button
          onClick={onPromoteToFav}
          title="Save to favorites"
          className="shrink-0 p-1 rounded text-fg-subtle hover:text-warn hover:bg-bg-hover cursor-pointer"
        >
          <Star className="w-3.5 h-3.5" />
        </button>
      )}
      <button
        onClick={onDelete}
        title={isFav ? "Remove favorite" : "Remove from history"}
        className="shrink-0 p-1 rounded text-fg-subtle hover:text-danger hover:bg-bg-hover cursor-pointer opacity-0 group-hover:opacity-100"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  RuleRow — two-row layout: meta + pattern                          */
/* ------------------------------------------------------------------ */

function RuleRow({
  rule,
  onChange,
  onDelete,
}: {
  rule: Rule;
  onChange: (p: Partial<Rule>) => void;
  onDelete: () => void;
}) {
  const accent =
    rule.filter === "in"
      ? "border-l-4 border-l-brand"
      : rule.filter === "out"
      ? "border-l-4 border-l-danger"
      : rule.highlight
      ? "border-l-4 border-l-warn"
      : "border-l-4 border-l-border";

  // Debounced auto-record into history when pattern stabilizes.
  const recordHistory = useRuleLibrary((s) => s.recordHistory);
  const lastRecorded = useRef<string>("");
  useEffect(() => {
    const p = rule.pattern.trim();
    if (!p) return;
    const key = `${p}::${rule.is_regex}::${rule.case_sensitive}`;
    if (key === lastRecorded.current) return;
    const t = window.setTimeout(() => {
      recordHistory({
        name: rule.name,
        pattern: rule.pattern,
        is_regex: rule.is_regex,
        case_sensitive: rule.case_sensitive,
        fg: rule.fg,
        bg: rule.bg,
        bold: rule.bold,
      });
      lastRecorded.current = key;
    }, 1500);
    return () => clearTimeout(t);
  }, [
    rule.pattern,
    rule.is_regex,
    rule.case_sensitive,
    rule.name,
    rule.fg,
    rule.bg,
    rule.bold,
    recordHistory,
  ]);

  // Favorite state — driven by the library, keyed on (pattern + flags).
  const isFavorite = useRuleLibrary((s) =>
    s.isFavorite({
      pattern: rule.pattern,
      is_regex: rule.is_regex,
      case_sensitive: rule.case_sensitive,
    })
  );
  const toggleFav = useRuleLibrary((s) => s.toggleFavorite);

  return (
    <div
      className={cn(
        "rounded border border-border bg-bg-elevated px-2 py-1.5",
        accent,
        !rule.enabled && "opacity-50"
      )}
    >
      {/* Row 1: meta — enable / name / actions */}
      <div className="flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={rule.enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })}
          className="accent-brand cursor-pointer shrink-0"
          title="Enable / disable rule"
        />

        <input
          className="input flex-1 min-w-0 text-xs px-1.5 py-1"
          value={rule.name}
          onChange={(e) => onChange({ name: e.target.value })}
          title="Rule name"
          placeholder="Rule name"
        />

        {/* Highlight icon-toggle */}
        <IconToggle
          active={rule.highlight}
          onClick={() => onChange({ highlight: !rule.highlight })}
          icon={<Highlighter className="w-3.5 h-3.5" />}
          title={rule.highlight ? "Highlight: ON" : "Highlight: OFF"}
          tone="warn"
        />

        {/* Filter tri-state */}
        <div className="flex items-center rounded border border-border overflow-hidden shrink-0">
          <SegBtn
            active={rule.filter === "none"}
            onClick={() => onChange({ filter: "none" })}
            icon={<Ban className="w-3.5 h-3.5" />}
            title="No filter"
            tone="muted"
          />
          <SegBtn
            active={rule.filter === "in"}
            onClick={() =>
              onChange({ filter: rule.filter === "in" ? "none" : "in" })
            }
            icon={<Eye className="w-3.5 h-3.5" />}
            title="Show only matches"
            tone="brand"
          />
          <SegBtn
            active={rule.filter === "out"}
            onClick={() =>
              onChange({ filter: rule.filter === "out" ? "none" : "out" })
            }
            icon={<EyeOff className="w-3.5 h-3.5" />}
            title="Hide matches"
            tone="danger"
          />
        </div>

        {/* Star — favorite snapshot of this rule */}
        <button
          type="button"
          onClick={() =>
            toggleFav({
              name: rule.name,
              pattern: rule.pattern,
              is_regex: rule.is_regex,
              case_sensitive: rule.case_sensitive,
              fg: rule.fg,
              bg: rule.bg,
              bold: rule.bold,
            })
          }
          title={
            isFavorite
              ? "Remove from favorites"
              : "Save this rule to favorites for reuse"
          }
          className={cn(
            "shrink-0 flex items-center justify-center w-7 h-7 rounded border cursor-pointer",
            isFavorite
              ? "bg-warn/20 text-warn border-warn/50"
              : "border-border text-fg-muted hover:text-warn hover:bg-bg-hover"
          )}
        >
          <Star
            className={cn("w-3.5 h-3.5", isFavorite && "fill-current")}
          />
        </button>

        {/* Delete */}
        <button
          className="btn shrink-0 px-1"
          onClick={onDelete}
          title="Delete rule"
        >
          <Trash2 className="w-3.5 h-3.5 text-danger" />
        </button>
      </div>

      {/* Row 2: pattern (full width) + flags + colors */}
      <div className="mt-1.5 flex items-center gap-1.5">
        <input
          className="input flex-1 min-w-0 font-mono text-sm px-2 py-1.5"
          placeholder="pattern (text or regex)…"
          value={rule.pattern}
          onChange={(e) => onChange({ pattern: e.target.value })}
          spellCheck={false}
          autoComplete="off"
        />

        <ModBtn
          active={rule.is_regex}
          onClick={() => onChange({ is_regex: !rule.is_regex })}
          label=".*"
          title="Regex"
        />
        <ModBtn
          active={rule.case_sensitive}
          onClick={() => onChange({ case_sensitive: !rule.case_sensitive })}
          label="Aa"
          title="Match case"
        />
        <ModBtn
          active={rule.bold}
          onClick={() => onChange({ bold: !rule.bold })}
          label="B"
          title="Bold"
          bold
        />

        <div className="flex items-center gap-0.5 shrink-0">
          <input
            type="color"
            value={rule.fg ?? "#e2e8f0"}
            onChange={(e) => onChange({ fg: e.target.value })}
            className="w-6 h-7 bg-transparent border border-border rounded cursor-pointer"
            title="Foreground color"
          />
          <input
            type="color"
            value={rule.bg ?? "#0b1220"}
            onChange={(e) => onChange({ bg: e.target.value })}
            className="w-6 h-7 bg-transparent border border-border rounded cursor-pointer"
            title="Background color"
          />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Small button primitives                                           */
/* ------------------------------------------------------------------ */

function IconToggle({
  active,
  onClick,
  icon,
  title,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  tone: "warn" | "brand" | "danger";
}) {
  const activeTone =
    tone === "warn"
      ? "bg-warn/20 text-warn border-warn/50"
      : tone === "brand"
      ? "bg-brand/20 text-brand border-brand/50"
      : "bg-danger/20 text-danger border-danger/50";

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "shrink-0 flex items-center justify-center w-7 h-7 rounded border cursor-pointer",
        active
          ? activeTone
          : "border-border text-fg-muted hover:text-fg hover:bg-bg-hover"
      )}
    >
      {icon}
    </button>
  );
}

function SegBtn({
  active,
  onClick,
  icon,
  title,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  tone: "brand" | "danger" | "muted";
}) {
  const activeTone =
    tone === "brand"
      ? "bg-brand/20 text-brand"
      : tone === "danger"
      ? "bg-danger/20 text-danger"
      : "bg-bg-hover text-fg";

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "flex items-center justify-center w-7 h-7 cursor-pointer",
        active ? activeTone : "text-fg-muted hover:text-fg hover:bg-bg-hover"
      )}
    >
      {icon}
    </button>
  );
}

function ModBtn({
  active,
  onClick,
  label,
  title,
  bold,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  title: string;
  bold?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "shrink-0 flex items-center justify-center w-7 h-7 rounded border text-xs cursor-pointer tabular-nums",
        bold && "font-bold",
        active
          ? "bg-brand/20 text-brand border-brand/50"
          : "border-border text-fg-muted hover:text-fg hover:bg-bg-hover"
      )}
    >
      {label}
    </button>
  );
}
