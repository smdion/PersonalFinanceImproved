/** An employer match as a form shows and edits it, and as read-only text. */
import { formatCurrency, formatPercent } from "@/lib/utils/format";

type MatchType = string | null | undefined;
type Stored = string | number | null | undefined;

/** A stored match value as the figure a form shows and edits: a whole percent
 *  or dollars, "" when none. matchValueToStore stores a typed one. */
export function matchFigureForForm(_type: MatchType, stored: Stored): string {
  return stored == null ? "" : String(stored);
}

export function matchValueToStore(_type: MatchType, typed: string): string {
  return typed;
}

/** An account's employer match for read-only display; null for no match. */
export function formatEmployerMatch(
  matchType: MatchType,
  matchValue: Stored,
  maxMatchPct: Stored,
): string | null {
  if (!matchType || matchType === "none") return null;
  const value = parseFloat(String(matchValue ?? "0"));
  if (matchType === "percent_of_contribution") {
    const cap = parseFloat(String(maxMatchPct ?? "0"));
    return cap > 0 ? `${value}% of ${formatPercent(cap, 2)}` : `${value}%`;
  }
  return `${formatCurrency(value)}/yr`;
}
