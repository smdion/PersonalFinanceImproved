/**
 * A contribution row's yearly dollars and its employer match terms. Stored
 * percents are whole numbers (6 means 6%); they become a Fraction once, here.
 */
import {
  CONTRIBUTION_METHOD_VALUES,
  EMPLOYER_MATCH_TYPE_VALUES,
  type ContributionMethod,
  type EmployerMatchType,
} from "@/lib/config/enum-values";
import { storedCeiling, type Ceiling } from "@/lib/utils/ceiling";

/** A share as a fraction: 0.06 means 6%. */
export type Fraction = number & { readonly __unit: "fraction" };

/** A stored whole percent as a Fraction. */
export function fractionFromPercent(percent: number): Fraction {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the one conversion from a stored whole percent
  return (percent / 100) as Fraction;
}

/** A contribution row's yearly dollars. An unknown stored method reads as
 *  a fixed annual amount. */
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
    default: {
      const unreachable: never = method;
      throw new Error(`Unknown contribution method: ${String(unreachable)}`);
    }
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

/** A row's stored match terms: the rate a whole percent, the cap of pay a
 *  fraction (0 means no cap). An unknown or unset type reads as no match. */
export function parseEmployerMatch(
  storedType: string | null,
  value: number,
  maxMatchPct: number,
): EmployerMatch {
  const type: EmployerMatchType =
    EMPLOYER_MATCH_TYPE_VALUES.find((t) => t === storedType) ?? "none";
  switch (type) {
    case "none":
      return { kind: "none" };
    case "percent_of_contribution":
      return {
        kind: "percent_of_contribution",
        rate: fractionFromPercent(value),
        capOfPay: storedCeiling(maxMatchPct),
      };
    case "dollar_match":
    case "fixed_annual":
      return { kind: "flat", perYear: value };
    default: {
      const unreachable: never = type;
      throw new Error(`Unknown employer match type: ${String(unreachable)}`);
    }
  }
}
