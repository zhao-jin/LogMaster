import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Rule } from "../lib/ipc";

/**
 * A reusable Rule template — pattern + flags + colors. We deliberately do
 * NOT store `enabled` / `filter` state because those describe the rule's
 * runtime behavior, not its identity as a saved snippet.
 */
export interface RuleTemplate {
  id: string;
  name: string;
  pattern: string;
  is_regex: boolean;
  case_sensitive: boolean;
  fg?: string;
  bg?: string;
  bold: boolean;
  /** When was this template last used / saved. */
  updatedAt: number;
}

export interface SavedRuleset {
  id: string;
  name: string;
  rules: Rule[];
  updatedAt: number;
}

interface State {
  /** Auto-recorded history of recently-used patterns (LRU, deduped). */
  history: RuleTemplate[];
  /** User-curated favorites — never auto-evicted. */
  favorites: RuleTemplate[];
  /** Saved rule combinations (snapshots) */
  savedRulesets: SavedRuleset[];

  /**
   * Record a pattern usage in history. Deduped on (pattern, is_regex,
   * case_sensitive) so identical patterns just bubble to the top.
   */
  recordHistory: (t: Omit<RuleTemplate, "id" | "updatedAt">) => void;
  /** Toggle favorite status. Returns true if added, false if removed. */
  toggleFavorite: (t: Omit<RuleTemplate, "id" | "updatedAt">) => boolean;
  /** Is this pattern (with same flags) currently a favorite? */
  isFavorite: (
    t: Pick<RuleTemplate, "pattern" | "is_regex" | "case_sensitive">
  ) => boolean;
  removeFavorite: (id: string) => void;
  removeHistory: (id: string) => void;
  renameFavorite: (id: string, name: string) => void;
  clearHistory: () => void;

  saveRuleset: (name: string, rules: Rule[]) => void;
  removeRuleset: (id: string) => void;
  renameRuleset: (id: string, name: string) => void;
}

const HISTORY_MAX = 50;

function sameKey(
  a: Pick<RuleTemplate, "pattern" | "is_regex" | "case_sensitive">,
  b: Pick<RuleTemplate, "pattern" | "is_regex" | "case_sensitive">
): boolean {
  return (
    a.pattern === b.pattern &&
    a.is_regex === b.is_regex &&
    a.case_sensitive === b.case_sensitive
  );
}

function newId(prefix: string): string {
  return prefix + "-" + Math.random().toString(36).slice(2, 9);
}

export const useRuleLibrary = create<State>()(
  persist(
    (set, get) => ({
      history: [],
      favorites: [],
      savedRulesets: [],

      recordHistory: (t) => {
        // Skip empty patterns — they're never useful to recall.
        if (!t.pattern || !t.pattern.trim()) return;
        set((s) => {
          const existing = s.history.find((h) => sameKey(h, t));
          const entry: RuleTemplate = existing
            ? { ...existing, ...t, updatedAt: Date.now() }
            : { ...t, id: newId("h"), updatedAt: Date.now() };
          const next = [
            entry,
            ...s.history.filter((h) => !sameKey(h, t)),
          ].slice(0, HISTORY_MAX);
          return { history: next };
        });
      },

      toggleFavorite: (t) => {
        if (!t.pattern || !t.pattern.trim()) return false;
        const existing = get().favorites.find((f) => sameKey(f, t));
        if (existing) {
          set((s) => ({
            favorites: s.favorites.filter((f) => f.id !== existing.id),
          }));
          return false;
        }
        const entry: RuleTemplate = {
          ...t,
          id: newId("f"),
          updatedAt: Date.now(),
        };
        set((s) => ({ favorites: [entry, ...s.favorites] }));
        return true;
      },

      isFavorite: (t) =>
        get().favorites.some((f) => sameKey(f, t)),

      removeFavorite: (id) =>
        set((s) => ({ favorites: s.favorites.filter((f) => f.id !== id) })),

      removeHistory: (id) =>
        set((s) => ({ history: s.history.filter((h) => h.id !== id) })),

      renameFavorite: (id, name) =>
        set((s) => ({
          favorites: s.favorites.map((f) =>
            f.id === id ? { ...f, name, updatedAt: Date.now() } : f
          ),
        })),

      clearHistory: () => set({ history: [] }),

      saveRuleset: (name, rules) => {
        // Deep clone the rules and strip transient ID if needed (or keep for stability)
        const entry: SavedRuleset = {
          id: newId("sset"),
          name: name.trim() || `Ruleset ${(get().savedRulesets || []).length + 1}`,
          rules: JSON.parse(JSON.stringify(rules)),
          updatedAt: Date.now(),
        };
        set((s) => ({
          savedRulesets: [entry, ...(s.savedRulesets || [])],
        }));
      },

      removeRuleset: (id) =>
        set((s) => ({
          savedRulesets: (s.savedRulesets || []).filter((r) => r.id !== id),
        })),

      renameRuleset: (id, name) =>
        set((s) => ({
          savedRulesets: (s.savedRulesets || []).map((r) =>
            r.id === id ? { ...r, name, updatedAt: Date.now() } : r
          ),
        })),
    }),
    {
      name: "logmaster:rule-library",
      storage: createJSONStorage(() => localStorage),
      version: 1,
    }
  )
);
