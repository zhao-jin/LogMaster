import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * Compact "X ago" relative time formatter. Accepts unix seconds.
 * Returns short forms like "3m", "2h", "5d", "Mar 4". Designed to fit in
 * a narrow column without truncating.
 */
export function formatRelativeTime(unixSec: number): string {
  if (!unixSec) return "";
  const now = Date.now() / 1000;
  const diff = Math.max(0, now - unixSec);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d`;
  // Older: show month + day; if last year, include year.
  const d = new Date(unixSec * 1000);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const m = d.toLocaleString("en-US", { month: "short" });
  return sameYear
    ? `${m} ${d.getDate()}`
    : `${m} ${d.getDate()}, ${d.getFullYear()}`;
}
