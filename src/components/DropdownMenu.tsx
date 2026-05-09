import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "../lib/utils";

interface MenuCtx {
  close: () => void;
}
const Ctx = createContext<MenuCtx | null>(null);

interface DropdownProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  /** Distance below the trigger (px) */
  offset?: number;
  align?: "start" | "end";
}

export function Dropdown({
  trigger,
  children,
  offset = 4,
  align = "start",
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (
        !menuRef.current?.contains(e.target as Node) &&
        !triggerRef.current?.contains(e.target as Node)
      ) {
        close();
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return (
    <Ctx.Provider value={{ close }}>
      <div className="relative inline-flex" ref={triggerRef}>
        <div
          onClick={() => setOpen((v) => !v)}
          className="inline-flex"
        >
          {trigger}
        </div>
        {open && (
          <div
            ref={menuRef}
            className={cn(
              "absolute z-40 min-w-[200px] py-1",
              "bg-bg-panel border border-border rounded-md shadow-2xl",
              align === "end" ? "right-0" : "left-0"
            )}
            style={{ top: `calc(100% + ${offset}px)` }}
            role="menu"
          >
            {children}
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}

interface ItemProps {
  icon?: React.ReactNode;
  shortcut?: string;
  onSelect?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}

export function MenuItem({
  icon,
  shortcut,
  onSelect,
  disabled,
  children,
}: ItemProps) {
  const ctx = useContext(Ctx);
  return (
    <button
      role="menuitem"
      type="button"
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        onSelect?.();
        ctx?.close();
      }}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-1.5 text-sm text-fg",
        "hover:bg-bg-hover focus:bg-bg-hover focus:outline-none",
        "disabled:text-fg-subtle disabled:cursor-not-allowed disabled:hover:bg-transparent",
        "cursor-pointer transition-colors"
      )}
    >
      <span className="w-4 h-4 shrink-0 text-fg-muted">{icon}</span>
      <span className="flex-1 text-left truncate">{children}</span>
      {shortcut && (
        <kbd className="text-xs text-fg-subtle px-1.5 py-0.5 rounded bg-bg-elevated border border-border">
          {shortcut}
        </kbd>
      )}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="my-1 h-px bg-border" />;
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-2 pb-1 text-xs text-fg-subtle uppercase tracking-wide">
      {children}
    </div>
  );
}

interface SubmenuProps {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Right-flying submenu. Hover/click to expand.
 */
export function Submenu({ label, icon, children }: SubmenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  return (
    <div
      ref={ref}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-1.5 text-sm text-fg",
          "hover:bg-bg-hover focus:bg-bg-hover focus:outline-none cursor-pointer"
        )}
      >
        <span className="w-4 h-4 shrink-0 text-fg-muted">{icon}</span>
        <span className="flex-1 text-left truncate">{label}</span>
        <ChevronRight className="w-3.5 h-3.5 text-fg-subtle" />
      </button>
      {open && (
        <div
          className={cn(
            "absolute top-0 left-full ml-1 min-w-[240px] py-1",
            "bg-bg-panel border border-border rounded-md shadow-2xl"
          )}
          role="menu"
        >
          {children}
        </div>
      )}
    </div>
  );
}
