/** A contribution row's yearly dollars and its employer match terms. A
 *  stored whole percent (6 means 6%) becomes a Fraction once, here. */
import {
  CONTRIBUTION_METHOD_VALUES,
  EMPLOYER_MATCH_TYPE_VALUES,
  type ContributionMethod,
  type EmployerMatchType,
} from "@/lib/config/enum-values";
import { assertNever } from "@/lib/utils/assert-never";
import { storedCeiling, type Ceiling } from "@/lib/utils/ceiling";
import { formatCurrency, formatPercent } from "@/lib/utils/format";

/** A share as a fraction: 0.06 means 6%. */
export type Fraction = number & { readonly __unit: "fraction" };

/** A stored whole percent as a Fraction. */
export function fractionFromPercent(percent: number): Fraction {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the one conversion from a stored whole percent
  return (percent / 100) as Fraction;
}

/** A row's yearly dollars; an unknown stored method reads as fixed annual. */
export function computeAnnualContribution(
  storedMethod: string,
  value: number,
  salary: number,
  periodsPerYear: number,
): number {
  const method: ContributionMethod =
    CONTRIBUTION_METHOD_VALUES.find((m) => m === storedMethod) ??
    "fixed_annual";
  switch (method) {
    case "percent_of_salary":
      return salary * fractionFromPercent(value);
    case "fixed_per_period":
      return value * periodsPerYear;
    case "fixed_monthly":
      return value * 12;
    case "fixed_annual":
      return value;
    default:
      return assertNever(method);
  }
}

export type EmployerMatch =
  | { readonly kind: "none" }
  | {
      readonly kind: "percent_of_contribution";
      readonly rate: Fraction;
      /** The most of pay the match applies to. */
      readonly capOfPay: Ceiling;
    }
  | { readonly kind: "flat"; readonly perYear: number };

/** A row's stored match terms: its rate (else its whole percent value), the
 *  cap of pay a fraction (0: no cap). An unknown or unset type is no match. */
export function parseEmployerMatch(
  storedType: string | null,
  value: number,
  maxMatchPct: number,
  rate: Fraction | null = null,
): EmployerMatch {
  const type: EmployerMatchType =
    EMPLOYER_MATCH_TYPE_VALUES.find((t) => t === storedType) ?? "none";
  switch (type) {
    case "none":
      return { kind: "none" };
    case "percent_of_contribution":
      return {
        kind: "percent_of_contribution",
        rate: rate ?? fractionFromPercent(value),
        capOfPay: storedCeiling(maxMatchPct),
      };
    case "dollar_match":
    case "fixed_annual":
      return { kind: "flat", perYear: value };
    default:
      return assertNever(type);
  }
}

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
