"use client";

import { safeDivide } from "@/lib/utils/math";
import { CONTRIBUTION_PERIOD_TEXT } from "@/lib/config/display-labels";
import { SegmentedControl, type SegmentedLook } from "./segmented-control";

export type ContributionPeriod = keyof typeof CONTRIBUTION_PERIOD_TEXT;

export function getPeriodSuffix(period: ContributionPeriod): string {
  return CONTRIBUTION_PERIOD_TEXT[period].suffix;
}

/**
 * Convert an annual amount to the selected period.
 * For paycheck, uses the person's periodsPerYear.
 */
export function getContributionMultiplier(
  period: ContributionPeriod,
  periodsPerYear: number,
): number {
  switch (period) {
    case "paycheck":
      return safeDivide(1, periodsPerYear, 0)!;
    case "monthly":
      return 1 / 12;
    case "annual":
    default:
      return 1;
  }
}

/** The household's paychecks a year for its totals: the people's
 *  average, 26 when no one is counted. */
export function householdPeriodsPerYear(periods: readonly number[]): number {
  const total = periods.reduce((sum, n) => sum + n, 0);
  return safeDivide(total, periods.length, 26);
}

/** An annual amount in the chosen period, by division; no pay periods
 *  gives $0 per paycheck, as getContribMultiplier does. */
export function toContributionPeriod(
  annual: number,
  periodsPerYear: number,
  period: ContributionPeriod,
): number {
  if (period === "monthly") return annual / 12;
  if (period === "paycheck") return safeDivide(annual, periodsPerYear, 0)!;
  return annual;
}

/** Each page's option order: Dashboard and Paycheck start from the
 *  paycheck, Contributions from the year. */
const ORDERS = {
  paycheckFirst: ["paycheck", "monthly", "annual"],
  annualFirst: ["annual", "monthly", "paycheck"],
} as const satisfies Record<string, readonly ContributionPeriod[]>;

export function ContributionPeriodToggle({
  value,
  onChange,
  className,
  order = "paycheckFirst",
  look,
}: {
  value: ContributionPeriod;
  onChange: (period: ContributionPeriod) => void;
  className?: string;
  order?: keyof typeof ORDERS;
  look?: SegmentedLook;
}) {
  return (
    <div className={className}>
      <SegmentedControl
        ariaLabel="Show amounts"
        value={value}
        options={ORDERS[order].map((v) => ({
          value: v,
          label: CONTRIBUTION_PERIOD_TEXT[v].label,
        }))}
        onChange={onChange}
        look={look}
      />
    </div>
  );
}
