/** An employer match as a form shows and edits it, and as read-only text. */
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { PERCENT_MATCH, percentFromRate } from "@/lib/utils/match-rate";

type MatchType = string | null | undefined;
type Stored = string | number | null | undefined;

/** A stored match as the figure a form shows and edits: a percent's rate as
 *  its whole percent (read first, as the engine reads it), else the stored
 *  value, "" when none. matchValueToStore stores a typed one. */
export function matchFigureForForm(
  type: MatchType,
  stored: Stored,
  rate?: Stored,
): string {
  const ratePercent =
    type === PERCENT_MATCH && rate != null ? percentFromRate(rate) : null;
  return ratePercent ?? (stored != null ? String(stored) : "");
}

/** A profile entry's own match as a form figure (matchFigureForForm over
 *  its own value and rate); null when it holds neither, so the account's
 *  shows. */
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

/** An account write from a form or full update: a cleared value (null)
 *  clears the match, so its rate goes too (a resent null keeps it). */
export function withMatchClear<T extends { employerMatchValue?: Stored }>(
  terms: T,
): T & { employerMatchRate?: null } {
  return terms.employerMatchValue === null
    ? { ...terms, employerMatchRate: null }
    : terms;
}

/** A full update's match value: the edited one (cleared: the match goes,
 *  withMatchClear), else the row's (rowMatchValue). */
export function resentMatchTerms(
  edited: string | null | undefined,
  row: Parameters<typeof rowMatchValue>[0],
): { employerMatchValue: string | null; employerMatchRate?: null } {
  return withMatchClear({
    employerMatchValue: edited === undefined ? rowMatchValue(row) : edited,
  });
}

export function matchValueToStore(_type: MatchType, typed: string): string {
  return typed;
}

/** An account's employer match for read-only display; null for no match. A
 *  percent shows its stored rate, else its whole percent value. */
export function formatEmployerMatch(
  matchType: MatchType,
  matchValue: Stored,
  maxMatchPercent: Stored,
  matchRate?: Stored,
): string | null {
  if (!matchType || matchType === "none") return null;
  const percent = matchType === PERCENT_MATCH && matchRate != null;
  const shown = percent ? percentFromRate(matchRate) : matchValue;
  const value = parseFloat(String(shown ?? "0"));
  if (matchType === PERCENT_MATCH) {
    const cap = parseFloat(String(maxMatchPercent ?? "0"));
    return cap > 0 ? `${value}% of ${formatPercent(cap, 2)}` : `${value}%`;
  }
  return `${formatCurrency(value)}/yr`;
}
