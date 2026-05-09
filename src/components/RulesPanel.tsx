import { Eye, EyeOff, Highlighter, Plus, Trash2, X, Ban } from "lucide-react";
import { useAppStore } from "../store/app";
import type { Rule } from "../lib/ipc";
import { cn } from "../lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function RulesPanel({ open, onClose }: Props) {
  const { rules, addRule, updateRule, removeRule, setFilterEnabled } =
    useAppStore();

  if (!open) return null;

  function handleAdd() {
    const id = "r-" + Math.random().toString(36).slice(2, 8);
    addRule({
      id,
      name: "New rule",
      pattern: "",
      is_regex: false,
      case_sensitive: false,
      highlight: true,
      filter: "none",
      fg: "#fef08a",
      bg: undefined,
      bold: false,
      enabled: true,
    });
  }

  return (
    <aside className="w-[520px] shrink-0 flex flex-col bg-bg-panel border-l border-border">
      <header className="flex items-center justify-between px-3 py-2 border-b border-border">
        <h3 className="text-sm font-semibold text-fg">Rules</h3>
        <div className="flex items-center gap-1">
          <button className="btn" onClick={handleAdd} title="Add rule">
            <Plus className="w-4 h-4" />
          </button>
          <button className="btn" onClick={onClose}>
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>
      <div className="px-3 py-2 text-xs text-fg-subtle border-b border-border leading-relaxed">
        <span className="text-warn">Highlight</span> (color) and{" "}
        <span className="text-brand">Filter</span> (visibility) are independent.
        Filter takes effect only when the toolbar's <span className="text-fg">Filter</span>{" "}
        button is on.
      </div>
      <div className="flex-1 overflow-auto p-2 space-y-1.5">
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

  return (
    <div
      className={cn(
        "rounded border border-border bg-bg-elevated px-2 py-1.5",
        accent,
        !rule.enabled && "opacity-50"
      )}
    >
      <div className="flex items-center gap-1.5">
        {/* Enable */}
        <input
          type="checkbox"
          checked={rule.enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })}
          className="accent-brand cursor-pointer shrink-0"
          title="Enable / disable rule"
        />

        {/* Name (compact) */}
        <input
          className="input w-[88px] shrink-0 text-xs px-1.5 py-1"
          value={rule.name}
          onChange={(e) => onChange({ name: e.target.value })}
          title="Rule name"
        />

        {/* Pattern (flex) */}
        <input
          className="input flex-1 min-w-0 font-mono text-xs px-1.5 py-1"
          placeholder="pattern"
          value={rule.pattern}
          onChange={(e) => onChange({ pattern: e.target.value })}
        />

        {/* Highlight icon-toggle */}
        <IconToggle
          active={rule.highlight}
          onClick={() => onChange({ highlight: !rule.highlight })}
          icon={<Highlighter className="w-3.5 h-3.5" />}
          title={rule.highlight ? "Highlight: ON" : "Highlight: OFF"}
          tone="warn"
        />

        {/* Filter tri-state segmented */}
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

        {/* Modifier mini-toggles: .* / Aa / B */}
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

        {/* Color swatches */}
        <div className="flex items-center gap-0.5 shrink-0">
          <input
            type="color"
            value={rule.fg ?? "#e2e8f0"}
            onChange={(e) => onChange({ fg: e.target.value })}
            className="w-5 h-5 bg-transparent border border-border rounded cursor-pointer"
            title="Foreground color"
          />
          <input
            type="color"
            value={rule.bg ?? "#0b1220"}
            onChange={(e) => onChange({ bg: e.target.value })}
            className="w-5 h-5 bg-transparent border border-border rounded cursor-pointer"
            title="Background color"
          />
        </div>

        {/* Delete */}
        <button
          className="btn shrink-0 px-1"
          onClick={onDelete}
          title="Delete rule"
        >
          <Trash2 className="w-3.5 h-3.5 text-danger" />
        </button>
      </div>
    </div>
  );
}

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
        "shrink-0 flex items-center justify-center w-7 h-7 rounded border transition-colors cursor-pointer",
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
        "flex items-center justify-center w-7 h-7 transition-colors cursor-pointer",
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
        "shrink-0 flex items-center justify-center w-6 h-7 rounded border text-xs transition-colors cursor-pointer tabular-nums",
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
