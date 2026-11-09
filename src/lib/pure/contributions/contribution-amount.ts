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
  maxMatchPercent: number,
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
        capOfPay: storedCeiling(maxMatchPercent),
      };
    case "dollar_match":
    case "fixed_annual":
      return { kind: "flat", perYear: value };
    default:
      return assertNever(type);
  }
}
