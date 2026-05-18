import { Settings as SettingsIcon, X, RotateCcw } from "lucide-react";
import { DEFAULT_SETTINGS, useSettingsStore } from "../store/settings";
import { useEffect } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SettingsPanel({ open, onClose }: Props) {
  const s = useSettingsStore();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-[8vh]"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[640px] max-w-[92vw] max-h-[84vh] flex flex-col bg-bg-panel border border-border rounded-lg shadow-2xl overflow-hidden"
      >
        <header className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <SettingsIcon className="w-4 h-4 text-brand" />
          <h2 className="text-sm font-semibold text-fg">Preferences</h2>
          <button
            className="btn ml-auto"
            title="Reset to defaults"
            onClick={() => {
              if (confirm("Reset all settings to defaults?")) s.reset();
            }}
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button className="btn" onClick={onClose}>
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-auto p-4 space-y-6">
          <Section title="Appearance">
            <Field label="Theme" hint="Light theme is experimental.">
              <div className="flex gap-2">
                {(["dark", "light"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => s.set("theme", t)}
                    className={
                      "btn " + (s.theme === t ? "btn-primary" : "")
                    }
                  >
                    {t === "dark" ? "Dark" : "Light"}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Font family" hint="Editor font family (monospace recommended).">
              <select
                className="input"
                value={s.fontFamily}
                onChange={(e) => s.set("fontFamily", e.target.value)}
              >
                <option value="Consolas, 'Courier New', monospace">Consolas</option>
                <option value="'Courier New', Courier, monospace">Courier New</option>
                <option value="'Lucida Console', Monaco, monospace">Lucida Console</option>
                <option value="Monaco, 'Courier New', monospace">Monaco</option>
                <option value="'Source Code Pro', Consolas, monospace">Source Code Pro</option>
                <option value="'Fira Code', Consolas, monospace">Fira Code</option>
                <option value="monospace">System Monospace</option>
              </select>
            </Field>
            <Field label="Font size" hint="Editor font size in pixels.">
              <NumberInput
                value={s.fontSize}
                min={10}
                max={24}
                step={1}
                onChange={(v) => s.set("fontSize", v)}
                suffix="px"
              />
            </Field>
            <Field
              label="Line height"
              hint="Row height. Larger value gives more spacing."
            >
              <NumberInput
                value={s.lineHeight}
                min={14}
                max={40}
                step={1}
                onChange={(v) => s.set("lineHeight", v)}
                suffix="px"
              />
            </Field>
            <Field
              label="Tab size"
              hint="A tab character is rendered as N spaces."
            >
              <NumberInput
                value={s.tabSize}
                min={1}
                max={8}
                step={1}
                onChange={(v) => s.set("tabSize", v)}
              />
            </Field>
            <Toggle
              label="Show line numbers"
              checked={s.showLineNumbers}
              onChange={(v) => s.set("showLineNumbers", v)}
            />
            <Toggle
              label="Word wrap"
              checked={s.wordWrap}
              onChange={(v) => s.set("wordWrap", v)}
            />
          </Section>

          <Section title="Tail (live follow)">
            <Toggle
              label="Auto-follow when starting tail"
              checked={s.followTailDefault}
              onChange={(v) => s.set("followTailDefault", v)}
            />
            <Field
              label="Update interval"
              hint="Throttle for new-line append events. Lower = more responsive, higher = less CPU."
            >
              <NumberInput
                value={s.tailIntervalMs}
                min={16}
                max={500}
                step={1}
                onChange={(v) => s.set("tailIntervalMs", v)}
                suffix="ms"
              />
            </Field>
          </Section>

          <Section title="Search">
            <Field
              label="Max hits"
              hint="Cap on the number of search matches returned per query."
            >
              <NumberInput
                value={s.searchMaxHits}
                min={100}
                max={100000}
                step={100}
                onChange={(v) => s.set("searchMaxHits", v)}
              />
            </Field>
          </Section>

          <Section title="Workspace">
            <Field
              label="File status refresh interval"
              hint="How often expanded folders update file status (size, modified time). New/deleted files update instantly via the watcher. Merge only — does not change sort order."
            >
              <NumberInput
                value={s.fileStatusRefreshIntervalSec}
                min={1}
                max={3600}
                step={1}
                onChange={(v) => s.set("fileStatusRefreshIntervalSec", v)}
                suffix="s"
              />
            </Field>
            <Field
              label="File sort interval"
              hint="How often the file list is re-sorted by modified time. Independent from status refresh."
            >
              <NumberInput
                value={s.fileSortIntervalSec}
                min={5}
                max={3600}
                step={5}
                onChange={(v) => s.set("fileSortIntervalSec", v)}
                suffix="s"
              />
            </Field>
          </Section>

          <Section title="About">
            <p className="text-sm text-fg-muted">
              LogMaster v0.1.0 — Fast, lightweight, modern log viewer.
            </p>
            <p className="text-xs text-fg-subtle mt-1">by miles</p>
            <p className="text-xs text-fg-subtle mt-1">
              Settings persist in browser localStorage. Defaults:{" "}
              {Object.entries(DEFAULT_SETTINGS).length} keys.
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="text-xs uppercase tracking-wide text-fg-subtle mb-2">
        {title}
      </h3>
      <div className="space-y-3 rounded border border-border bg-bg-elevated p-3">
        {children}
      </div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[200px_1fr] items-start gap-3">
      <div>
        <div className="text-sm text-fg">{label}</div>
        {hint && <div className="text-xs text-fg-subtle mt-0.5">{hint}</div>}
      </div>
      <div className="flex items-center min-h-[28px]">{children}</div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer text-sm text-fg">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-brand w-4 h-4"
      />
      {label}
    </label>
  );
}

function NumberInput({
  value,
  min,
  max,
  step,
  onChange,
  suffix,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        className="input w-24 tabular-nums"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
      {suffix && <span className="text-xs text-fg-subtle">{suffix}</span>}
    </div>
  );
}
