import { useEffect, useRef } from "react";
import { useAppStore } from "../store/app";

interface Props {
  onOpenRules: () => void;
}

/**
 * Side-effect-only component: when filter mode is turned on but there's no
 * active filter rule, automatically open the Rules panel exactly once so the
 * user can configure a rule. Triggers again only if the user toggles Filter
 * off and back on.
 */
export function FilterBanner({ onOpenRules }: Props) {
  const filterEnabled = useAppStore((s) => s.filterEnabled);
  const hasActiveFilter = useAppStore((s) =>
    s.rules.some(
      (r) => r.enabled && r.pattern.length > 0 && r.filter !== "none"
    )
  );

  // Track previous "should-prompt" state so we only open once per ON edge.
  const prevPrompt = useRef(false);

  useEffect(() => {
    const shouldPrompt = filterEnabled && !hasActiveFilter;
    if (shouldPrompt && !prevPrompt.current) {
      onOpenRules();
    }
    prevPrompt.current = shouldPrompt;
  }, [filterEnabled, hasActiveFilter, onOpenRules]);

  return null;
}
