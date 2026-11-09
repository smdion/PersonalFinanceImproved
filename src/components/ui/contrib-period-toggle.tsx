"use client";

import { safeDivide } from "@/lib/utils/math";
import { CONTRIBUTION_PERIOD_TEXT } from "@/lib/config/display-labels";
import { SegmentedControl, type SegmentedLook } from "./segmented-control";

export type ContribPeriod = keyof typeof CONTRIBUTION_PERIOD_TEXT;

export function getPeriodSuffix(period: ContribPeriod): string {
  return CONTRIBUTION_PERIOD_TEXT[period].suffix;
}

/**
 * Convert an annual amount to the selected period.
 * For paycheck, uses the person's periodsPerYear.
 */
export function getContribMultiplier(
  period: ContribPeriod,
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

/** An annual amount in the chosen period, by division; no pay periods
 *  gives $0 per paycheck, as getContribMultiplier does. */
export function toContributionPeriod(
  annual: number,
  periodsPerYear: number,
  period: ContribPeriod,
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
} as const satisfies Record<string, readonly ContribPeriod[]>;

export function ContribPeriodToggle({
  value,
  onChange,
  className,
  order = "paycheckFirst",
  look,
}: {
  value: ContribPeriod;
  onChange: (period: ContribPeriod) => void;
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
