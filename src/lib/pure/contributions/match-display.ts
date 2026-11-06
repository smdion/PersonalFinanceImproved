/** An employer match as a form shows and edits it, and as read-only text. */
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { PERCENT_MATCH, percentFromRate } from "@/lib/utils/match-rate";

type MatchType = string | null | undefined;
type Stored = string | number | null | undefined;

/** A stored match value as the figure a form shows and edits: a whole percent
 *  (the stored one, else its rate's) or dollars, "" when none.
 *  matchValueToStore stores a typed one. */
export function matchFigureForForm(
  type: MatchType,
  stored: Stored,
  rate?: Stored,
): string {
  if (stored != null) return String(stored);
  return type === PERCENT_MATCH && rate != null
    ? (percentFromRate(rate) ?? "")
    : "";
}

/** A profile entry's own match as a form figure (its value, else its
 *  rate's percent); null when it holds neither, so the account's shows. */
export function entryMatchFigure(
  type: MatchType,
  entry: { employerMatchValue?: Stored; employerMatchRate?: Stored },
): string | null {
  const { employerMatchValue: value, employerMatchRate: rate } = entry;
  if (value === undefined && rate === undefined) return null;
  return matchFigureForForm(type, value, rate);
}

/** An account row's match value as a form or full update resends it: its
 *  value, else its rate's whole percent (which writes back the same rate). */
export function rowMatchValue(row: {
  employerMatchType: MatchType;
  employerMatchValue: Stored;
  employerMatchRate?: Stored;
}): string | null {
  if (row.employerMatchValue != null) return String(row.employerMatchValue);
  const figure = matchFigureForForm(
    row.employerMatchType,
    null,
    row.employerMatchRate,
  );
  return figure === "" ? null : figure;
}

export function matchValueToStore(_type: MatchType, typed: string): string {
  return typed;
}

/** An account's employer match for read-only display; null for no match. A
 *  percent shows its stored rate, else its whole percent value. */
export function formatEmployerMatch(
  matchType: MatchType,
  matchValue: Stored,
  maxMatchPct: Stored,
  matchRate?: Stored,
): string | null {
  if (!matchType || matchType === "none") return null;
  const percent = matchType === PERCENT_MATCH && matchRate != null;
  const shown = percent ? percentFromRate(matchRate) : matchValue;
  const value = parseFloat(String(shown ?? "0"));
  if (matchType === PERCENT_MATCH) {
    const cap = parseFloat(String(maxMatchPct ?? "0"));
    return cap > 0 ? `${value}% of ${formatPercent(cap, 2)}` : `${value}%`;
  }
  return `${formatCurrency(value)}/yr`;
}
